const utils = require('./utils');
const parseUri = require('drachtio-srf').parseUri ;
const SipError = require('drachtio-srf').SipError;
const config = require('config');
const debug = require('debug')('drachtio-rtpengine-webrtcproxy') ;

class CallProcessor {

  /**
   * creates an instance of the call processor.  this is intended to be a singleton instance.
   * you call the 'start' method to kick it off
   */
  constructor(logger) {
    this._logger = logger;

    // we need to track these only so we can fixup REFER messages for attended transfer
    this.calls = new Map() ;
  }
   
  get logger() {
    return this._logger;
  }

  /**
   * invoked one time to start call processing
   * @param  {[Object]} srf       srf framework instance for managing sip signaling
   * @param  {[Object]} rtpEngine rtpEngine instance for managing rtp proxy operations
   * @param  {[Object]} registrar registrar for managing state of calls and transactions
   */
  start(srf, rtpEngine, registrar) {
    const offer = rtpEngine.offer.bind(rtpEngine, config.get('rtpengine'));
    const answer = rtpEngine.answer.bind(rtpEngine, config.get('rtpengine'));
    const del = rtpEngine.delete.bind(rtpEngine, config.get('rtpengine'));

    srf.invite(async(req, res) => {
      this.logger.info(
        `received invite from ${req.protocol}/${req.source_address}:${req.uri} with request uri ${req.uri}`);

      // determine whether this is a call from or to a webrtc client
      const callid = req.get('Call-Id');
      const from = req.getParsedHeader('From');
      let remoteUri = req.uri ;
      let callDirection = 'outbound' ;
      const parsedUri = parseUri(req.uri);
      const user = parsedUri.user ;
      const trunk = parsedUri.host;
      let rtpEngineIdentifyingDetails = {
        'call-id': callid,
        'from-tag': from.params.tag,
      } ;
      let inviteSent;
      
      if (registrar.hasUser(user)) {
        const details = registrar.getUser(user) ;
        remoteUri = details.uri ;
        callDirection = 'inbound' ;
        debug(`inbound call with details: ${JSON.stringify(details)}`) ;
      }
      
      const rtpEngineOpts = utils.makeRtpEngineOpts(req, ('outbound' === callDirection), ('inbound' === callDirection));
      const optsOffer = {
        ...rtpEngineOpts.common,
        ...rtpEngineOpts.uac.mediaOpts,
       'from-tag': rtpEngineOpts.uas.tag,
        sdp: req.body
      };
      
      try {
        const response = await offer(optsOffer);
        this.logger.info({offer: optsOffer, response}, 'initial offer to rtpengine');
        if ('ok' !== response.result) {
          throw new Error(`failed allocating endpoint from rtpengine: ${JSON.stringify(response)}`);
        }
       
        if ('outbound' === callDirection) {
          console.log('removing webrtc attributes for outbound INVITE');
          response.sdp = utils.removeWebrtcAttributes(response.sdp);
        }

        const opts = this._createHeaders(registrar, response.sdp, callid);
        const sdpGenerator = produceSdpUas.bind(null, answer, rtpEngineOpts);
        const callOpts = {
          headers: opts.headers,
          localSdpA: sdpGenerator,
          localSdpB: opts.sdp,
          proxyRequestHeaders: ['from', 'to', 'proxy-authorization', 'authorization',
            'supported', 'allow', 'content-type', 'user-agent', 'Diversion', 'X-Connect-Info'],
          proxyResponseHeaders: ['proxy-authenticate', 'www-authenticate', 'accept', 'allow', 'allow-events']
        };

        // check to see if we are sending to a trunk that we hold sip credentials for
        if (trunk && config.has('credentials')) {
          const t = config.get('credentials').find((c) => c.trunk === trunk);
          if (t) {
            Object.assign(callOpts, {auth: t.auth});
            this.logger.info(`we will be handling auth challenges for this call to ${trunk}`);
          }
        }
        this.logger.info(`sending INVITE to B with ${JSON.stringify(callOpts)}`);
        const {uas, uac} = await srf.createB2BUA(req, res, remoteUri, callOpts, {
          cbRequest: (err, req) => inviteSent = req
        });
        
        rtpEngineOpts.uac.tag = uac.sip.remoteTag;
        const key = makeReplacesStr(uas) ;
        const value = makeReplacesStr(uac) ;
        this.calls.set(key, value) ;
        this.logger.info(`after adding call there are now ${this.calls.size} calls in progress`);

        uas.on('destroy', this._onDestroy.bind(this, uas, uac,
          this.calls.delete.bind(this.calls, key), deleteProxy.bind(null, del, rtpEngineIdentifyingDetails)));
        uac.on('destroy', this._onDestroy.bind(this, uac, uas,
          this.calls.delete.bind(this.calls, key), deleteProxy.bind(null, del, rtpEngineIdentifyingDetails)));

        uas.on('refer', this._handleRefer.bind(this, uas, uac)) ;
        uac.on('refer', this._handleRefer.bind(this, uac, uas)) ;

        uas.on('info', this._handleInfo.bind(this, uas, uac)) ;
        uac.on('info', this._handleInfo.bind(this, uac, uas)) ;

        uas.on('modify', this._handleReinvite.bind(this, uas, offer, answer, rtpEngineOpts));
        uac.on('modify', this._handleReinvite.bind(this, uac, offer, answer, rtpEngineOpts));
	     
      } catch (err) {
        deleteProxy(del, rtpEngineIdentifyingDetails) ;
        if (err instanceof SipError && [401, 407].includes(err.status)) {
          this.logger.info(`invite challenged with ${err.status}`);
          registrar.addTransaction({
            aCallId: callid,
            bCallId: inviteSent.get('Call-Id'),
            bCseq: inviteSent.get('CSeq')
          });
        }
        else if (487 === err.status) {
          this.logger.info('caller hung up');
        }
        else {
          this.logger.info(`Error connecting call: ${err}`);
        }
      }
    });
  }

  _createHeaders(registrar, sdp, callid) {
    // check if we have a call-id / cseq that we used previously on a 407-challenged INVITE
    const headers = {} ;
    const obj = registrar.getNextCallIdAndCSeq(callid);
    if (obj) {
      Object.assign(headers, obj);
      registrar.removeTransaction(callid);
    }
    else {
      Object.assign(headers, {'CSeq': '1 INVITE'}) ;
    }
    return {headers, sdp};
  }

  /**
   * call has been terminated from one side or the other
   * @param  {[Object]} dlg           dialog that was closed
   * @param  {[Object]} dlgOther      the opposing dialog, which we must close
   * @param  {[Function]} fnDeleteCall  function that will remove the call info from the map
   * @param  {[Function]} fnDeleteProxy function that will free the rtp media resources
   */
  _onDestroy(dlg, dlgOther, fnDeleteCall, fnDeleteProxy) {
    dlgOther.destroy() ;
    fnDeleteCall() ;
    fnDeleteProxy() ;
    this.logger.info(`after hanging up call there are now ${this.calls.size} calls in progress`);
  }

  /**
   * REFER has been received from one side to initiate a call transfer.  Proxy to the other side
   * @param  {[Object]} dlg      dialog that initiated the REFER
   * @param  {[Object]} dlgOther opposing dialog
   * @param  {[Object]} req      sip request
   * @param  {[Object]} res      sip response
   */
  async _handleRefer(dlg, dlgOther, req, res) {
    let referTo = req.get('Refer-To') ;
    const arr = /(.*)Replaces=(.*)>/.exec(referTo) ;

    // for attended transfer: fixup the Replaces part of the Refer-To header
    if (arr) {
      const key = arr[2] ;
      if (this.calls.has(key)) {
        referTo = `${arr[1]}Replaces=${this.calls.get(key)}>` ;
      }
      else {
        this.logger.error(`attended transfer but we cant find ${key}`);
      }
    }

    try {
     let reqHeaders = req.get('Authorization') ? 
          { 'Authorization' : req.get('Authorization'), 'Refer-To': referTo, 'Referred-By': req.get('Referred-By') } :
          { 'Refer-To': referTo, 'Referred-By': req.get('Referred-By') }
      let response = await dlgOther.request({
        method: 'REFER',
        headers: reqHeaders
      });
      if (response.status === 401) {
        let resHeaders = { 'headers': { 'www-authenticate': response.get('www-authenticate') } }
        res.send(response.status, response.reason, resHeaders); 
      }
      else {
        res.send(202);
      }
         
    } catch (err) {
      this.logger.info(err, 'Error handling REFER');
    }
  }

  /**
   * INFO has been received from one side.  Respond 200 OK and proxy if it pertains to video updates
   * @param  {[Object]} dlg      dialog initiating the INFO
   * @param  {[Object]} dlgOther opposing dialog
   * @param  {[Object]} req      sip request
   * @param  {[Object]} res      sip response
   */
  _handleInfo(dlg, dlgOther, req, res) {
    this.logger.info(`received info with content-type: ${req.get('Content-Type')}`);
    res.send(200) ;

    if (req.get('Content-Type') === 'application/media_control+xml') {
      dlgOther.request({
        method: 'INFO',
        headers: {
          'Content-Type': req.get('Content-Type'),
        },
        body: req.body
      });
    }
  }

  /**
   * re-INVITE has been received. 
   * @param  {[Object]} dlg         dialog receiving the re-INVITE
   * @param  {[Object]} offer       rtpEngine.offer bind
   * @param  {[Object]} answer      rtpEngine.answer bind
   * @param  {[Object]} req         sip request
   * @param  {[Object]} res         sip response
   */
   async _handleReinvite(dlg, offer, answer, rtpEngineOpts, req, res) {
    this.logger.info({ rtpEngineOpts: dlg.rtpEngineOpts, sdp: req.body }, `received reinvite on ${dlg.type} leg`);

    try {
      const offerMedia = dlg.type === 'uas' ? rtpEngineOpts.uac.mediaOpts : rtpEngineOpts.uas.mediaOpts;
      const answerMedia = dlg.type === 'uas' ? rtpEngineOpts.uas.mediaOpts : rtpEngineOpts.uac.mediaOpts;
      let fromTag = dlg.other.sip.localTag;
      let toTag = dlg.other.sip.remoteTag;
      if (dlg.type === 'uac') {
        fromTag = dlg.sip.remoteTag;
        toTag = dlg.sip.localTag;
      }
      const optsOffer = {
        ...rtpEngineOpts.common,
        ...offerMedia,
        'from-tag': fromTag,
        'to-tag': toTag,
        sdp: req.body
      };
      let response = await offer(optsOffer);
      if ('ok' !== response.result) {
        res.send(488);
        throw new Error(`_onReinvite: rtpengine failed: offer: ${JSON.stringify(response)}`);
      }
      this.logger.info({ optsOffer, response }, 'sent offer for reinvite to rtpengine');

      let optsSdp;
      let ackFunc;
      if(!req.body) {
        //handle late offer reInvite by not letting the ACK be generated until we receive the sender's ACK with sdp.
        const {sdp, ack} = await dlg.other.modify(response.sdp, {noAck:true});
        optsSdp = sdp;
        ackFunc = ack;
      }
       else {
        const sdp = await dlg.other.modify(response.sdp);
        optsSdp = sdp;
      }

      const optsAnswer = {
        ...rtpEngineOpts.common,
        ...answerMedia,
        'from-tag': fromTag,
        'to-tag': toTag,
        sdp: optsSdp
    };
      response = await answer(optsAnswer);
      if ('ok' !== response.result) {
        res.send(488);
        throw new Error(`_onReinvite: rtpengine failed: ${JSON.stringify(response)}`);
      }
      this.logger.info({ optsAnswer, response }, 'sent answer for reinvite to rtpengine');
      res.send(200, { body: response.sdp });

      if(!req.body && !dlg.hasAckListener) {
        // set listener for ACK, so that we can apply use that SDP to create the ACK for the other leg.
        dlg.once('ack', this._handleAck.bind(this, dlg, answer, offer, ackFunc, optsSdp, rtpEngineOpts));
      }
      
     } catch (err) {
      this.logger.info(err, 'Error handling reinvite');
    }
  }
  
  /**
   * Handle ACK for late offer reInvite
   * @param {*} dlg     dialog receiving the re-INVITE
   * @param {*} answer  rtpEngine.answer bind
   * @param {*} offer   rtpEngine.offer bind
   * @param {*} ack     function to send the ACK w/sdp
   * @param {*} offerSdp sdp sent in the 200 OK
   * @param {*} req     sip request
   */
  async _handleAck(dlg, answer, offer, ack, offerSdp, rtpEngineOpts, req) {
    this.logger.info('Received ACK with late offer: ', req.body);
    
    try {
        let fromTag = dlg.other.sip.remoteTag;
        let toTag = dlg.other.sip.localTag;
        if (dlg.type === 'uac') {
          fromTag = dlg.sip.localTag;
          toTag = dlg.sip.remoteTag;
        }
        const offerMedia = dlg.type === 'uas' ? rtpEngineOpts.uas.mediaOpts : rtpEngineOpts.uac.mediaOpts;
        let answerMedia = dlg.type === 'uas' ? rtpEngineOpts.uac.mediaOpts : rtpEngineOpts.uas.mediaOpts;
        //if uas is webrtc facing, we need to keep that side as the active ssl role, so use passive in the ACK sdp
        if (dlg.type === 'uas' && JSON.stringify(answerMedia).includes('SAVPF')) {
          let mediaStringified = JSON.stringify(answerMedia);
          mediaStringified = mediaStringified.replace('SAVPF\"', 'SAVPF\",\"DTLS\":\"passive\"');
          answerMedia = JSON.parse(mediaStringified);
        }

        const optsOffer = {
          ...rtpEngineOpts.common,
          ...offerMedia,
          'from-tag': fromTag,
          'to-tag': toTag,
          sdp: offerSdp
        };
        //send an offer first so that rtpEngine knows that DTLS fingerprint needs to be in the answer sdp.
        let response = await offer(optsOffer);
        if ('ok' !== response.result) {
          throw new Error(`_handleAck: rtpengine failed: offer: ${JSON.stringify(response)}`);
        }
        this.logger.info({optsOffer, response}, 'sent offer to use for ACK to rtpengine');

        const optsAnswer = {
          ...rtpEngineOpts.common,
          ...answerMedia,
          'from-tag': fromTag,
          'to-tag': toTag,
          sdp: req.body
        };
        const ackResponse = await answer(optsAnswer);
        if ('ok' !== ackResponse.result) {
          throw new Error(`_handleAck: rtpengine failed: answer: ${JSON.stringify(ackResponse)}`);
        }
        this.logger.info({optsAnswer, ackResponse},'sent answer to rtpEngine');
        //send the ACK with sdp
        ack(ackResponse.sdp);
      
    } catch (err) {
        this.logger.info(err, 'Error handling ACK');
    }
  }
}

module.exports = CallProcessor ;


function deleteProxy(del, rtpEngineIdentifyingDetails) {
  del(rtpEngineIdentifyingDetails) ;
}

function produceSdpUas(answer, opts, remoteSdp, res) {
  if ('inbound' === opts.callDirection) {
    remoteSdp = utils.removeWebrtcAttributes(remoteSdp);
  }
  Object.assign(opts, {
    'sdp': remoteSdp,
    ...opts.common,
    ...opts.uas.mediaOpts,
    'from-tag': opts.uas.tag,
    'to-tag': res.getParsedHeader('To').params.tag
  }) ;
  console.log(`sending rtpEngine#answer with opts: ${JSON.stringify(opts)}`);
  return answer(opts)
    .then((response) => {
      console.log(`response from rtpEngine#answer: ${JSON.stringify(response)}`) ;
      return response.sdp;
    });
}

function makeReplacesStr(dlg) {
  var s = '';
  if (dlg.type === 'uas') {
    s = encodeURIComponent(`${dlg.sip.callId};to-tag=${dlg.sip.localTag};from-tag=${dlg.sip.remoteTag}`);
  }
  else {
    s = encodeURIComponent(`${dlg.sip.callId};to-tag=${dlg.sip.remoteTag};from-tag=${dlg.sip.localTag}`);
  }
  return s ;
}
