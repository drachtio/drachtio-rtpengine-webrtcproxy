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

    srf.invite((req, res) => {
      this.logger.info(
        `received invite from ${req.protocol}/${req.source_address}:${req.uri} with request uri ${req.uri}`);

      // determine whether this is a call from or to a webrtc client
      const callid = req.get('Call-Id');
      const from = req.getParsedHeader('From');
      let remoteUri = req.uri ;
      let direction = 'outbound' ;
      const user = parseUri(req.uri).user ;
      const rtpEngineIdentifyingDetails = {
        'call-id': callid,
        'from-tag': from.params.tag,
      } ;

      const voipProviderFacingProxyCharacteristics = {
        'transport protocol': 'RTP/AVP',
        'DTLS': 'off',
        'SDES': 'off',
        'ICE': 'remove',
        'rtcp-mux': ['demux']
      };
      const webrtcFacingProxyCharacteristics = {
        'ICE': 'force',
        'DTLS': 'passive'
      } ;

      if (registrar.hasUser(user)) {
        const details = registrar.getUser(user) ;
        remoteUri = details.uri ;
        direction = 'inbound' ;
        debug(`inbound call with details: ${JSON.stringify(details)}`) ;
      }
      else if ('udp' === req.protocol) {
        console.error('rejecting call attempt because it is not to a registered webrtc client');
        return res.send(404);
      }

      const opts = Object.assign(
        {'sdp': req.body, 'replace': ['origin', 'session-connection']},
        'outbound' === direction ? voipProviderFacingProxyCharacteristics : webrtcFacingProxyCharacteristics,
        'inbound' === direction ? {'transport-protocol': 'UDP/TLS/RTP/SAVPF'} : {},
        rtpEngineIdentifyingDetails
      );

      let inviteSent;
      debug(`sending offer with opts: ${JSON.stringify(opts)}`);

      return offer(opts)
        .then((response) => {
          if ('ok' !== response.result) {
            throw new Error(`failed allocating endpoint from rtpengine: ${JSON.stringify(response)}`);
          }
          debug(`response from offer: ${JSON.stringify(response)}`);
          return this._createHeaders(registrar, response.sdp, callid);
        })
        .then((opts) => {
          const sdpGenerator = produceSdpUas.bind(null, answer,
            Object.assign({}, rtpEngineIdentifyingDetails,
              'outbound' === direction ? webrtcFacingProxyCharacteristics : voipProviderFacingProxyCharacteristics)
          );
          debug(`sending INVITE to B with ${JSON.stringify(opts)}`);
          return srf.createB2BUA(req, res, remoteUri, {
            headers: opts.headers,
            localSdpA: sdpGenerator,
            localSdpB: opts.sdp,
            proxyRequestHeaders: ['from', 'to', 'proxy-authorization', 'authorization',
              'supported', 'allow', 'content-type', 'user-agent'],
            proxyResponseHeaders: ['proxy-authenticate', 'www-authenticate', 'accept', 'allow', 'allow-events']
          }, {
            cbRequest: (err, req) => inviteSent = req
          });
        })
        .then(({uas, uac}) => {
          if (uas) {
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
          }
          return;
        })
        .catch((err) => {
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
        });
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
  _handleRefer(dlg, dlgOther, req, res) {
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

    dlgOther.request({
      method: 'REFER',
      headers: {
        'Refer-To': referTo
      }
    });

    res.send(202);
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
}

module.exports = CallProcessor ;


function deleteProxy(del, rtpEngineIdentifyingDetails) {
  del(rtpEngineIdentifyingDetails) ;
}

function produceSdpUas(answer, opts, remoteSdp, res) {
  Object.assign(opts, {
    'sdp': remoteSdp,
    'to-tag': res.getParsedHeader('To').params.tag
  }) ;
  debug(`sending rtpEngine#answer with opts: ${JSON.stringify(opts)}`);
  return answer(opts)
    .then((response) => {
      debug(`response from rtpEngine#answer: ${JSON.stringify(response)}`) ;
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
