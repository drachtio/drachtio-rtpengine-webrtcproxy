'use strict';

const Emitter = require('events').EventEmitter ;
const parseUri = require('drachtio-sip').parser.parseUri ;
const debug = require('debug')('drachtio-rtpengine-webrtcproxy') ;
const async = require('async') ;

class CallProcessor extends Emitter {

  /**
   * creates an instance of the call processor.  this is intended to be a singleton instance
   */
  constructor( ) {
    super() ;

    // we need to track these only so we can fixup REFER messages for attended transfer
    this.calls = new Map() ;
  }

  /**
   * invoked one time to start call processing
   * @param  {[Object]} srf       srf framework instance for managing sip signaling
   * @param  {[Object]} rtpEngine rtpEngine instance for managing rtp proxy operations
   * @param  {[Object]} registrar registrar for managing state of calls and transactions
   */
  start( srf, rtpEngine, registrar ) {
    srf.invite( ( req, res ) => {
      debug(`received invite from ${req.protocol}/${req.source_address}:${req.uri} with request uri ${req.uri}` ) ;

      // determine whether this is a call from or to a webrtc client 
      let callid = req.get('Call-Id');
      let from = req.getParsedHeader('From') ;    
      let remoteUri = req.uri ;
      let direction = 'outbound' ;
      let user = parseUri( req.uri ).user ;
      let rtpEngineIdentifyingDetails = {
        'call-id': callid,
        'from-tag': from.params.tag,        
      } ;

      let voipProviderFacingProxyCharacteristics = {
        'transport protocol': 'RTP/AVP',
        'DTLS': 'off',
        'SDES': 'off',
        'ICE': 'remove'
      };
      let webrtcFacingProxyCharacteristics = {
        'ICE': 'force',
        'DTLS': 'passive',
        'rtcp-mux': ['de-mux']
      } ;

      if( registrar.hasUser( user ) ) {
        let details = registrar.getUser( user ) ;
        remoteUri = details.uri ;
        direction = 'inbound' ;
        debug(`inbound call with details: ${JSON.stringify(details)}`) ;
      }
      else if( 'udp' === req.protocol ) {
        console.error(`rejecting call attempt because it is not to a registered webrtc client`) ;
        return res.send(404);  
      }

      async.waterfall(
        [
          // 1. call rtpEngin#offer to allocate media proxy endpoints for the call
          (callback) => {
            let opts = Object.assign(
              {'sdp': req.body,'replace': ['origin', 'session-connection']}, 
              'outbound' === direction ? voipProviderFacingProxyCharacteristics: webrtcFacingProxyCharacteristics,
              'inbound' === direction ? {'transport-protocol': 'UDP/TLS/RTP/SAVPF'} :{},
              rtpEngineIdentifyingDetails
            ) ;

            rtpEngine.offer( opts, (err, response) => {
              if( err ) { 
                return callback( err ); 
              }
              else if( 'ok' !== response.result ) {
                return callback( new Error(`failed allocating endpoint from rtpengine: ${JSON.stringify(response)}`));
              }
              callback(null, response.sdp) ;
            }) ;
          }, 

          // 2. create the B2BUA
          (sdpUac, callback) => {
            // check if we have a call-id / cseq that we used previously on a 407-challenged INVITE
            let headers = {} ;
            let obj = registrar.getNextCallIdAndCSeq( callid ) ;
            if( obj ) {
              Object.assign( headers, obj ) ;
              registrar.removeTransaction( callid ) ;
            }
            else {
              Object.assign( headers, {'CSeq': '1 INVITE'}) ;
            }

            let inviteSent ;
            let sdpGenerator = produceSdpUas.bind( null, 
              rtpEngine, 
              Object.assign(
                {}, 
                rtpEngineIdentifyingDetails, 
                'outbound' === direction ? webrtcFacingProxyCharacteristics : voipProviderFacingProxyCharacteristics
              )
            ) ;

            srf.createBackToBackDialogs( req, res, remoteUri, {
              localSdpA: sdpGenerator,
              localSdpB: sdpUac, 
              headers: headers,
              proxyRequestHeaders: ['from','to','proxy-authorization','authorization','supported','allow','content-type','user-agent'],
              proxyResponseHeaders: ['proxy-authenticate','www-authenticate','accept','allow','allow-events']
            }, ( err, uas, uac ) => {
              if( err ) {
                if( [401,407].indexOf( err.status ) !== -1 ) {
                  debug(`{callid}: invite challenged with: ${err.status}`) ;
                  if( inviteSent ) {
                    registrar.addTransaction({
                      aCallId: callid,
                      bCallId: inviteSent.get('Call-Id'),
                      bCseq: inviteSent.get('CSeq')
                    }) ;              
                  }
                }
                else {
                  debug(`{callid}: error completing call: ${err.status || err}`) ;
                }

                // call was not set up for whatever reason, so free the allocated media proxying resources
                deleteProxy( rtpEngine, rtpEngineIdentifyingDetails ) ;

                return callback(err);
              }

              debug(`${callid}: call successfully established`) ;
              callback(null, uas, uac) ;
            }).then( function(request) {
              inviteSent = request ;
            });
          }, 

          // 3. set up in-dialog handlers
          (uas, uac, callback) => {
            let key = makeReplacesStr(uas) ;
            let value = makeReplacesStr(uac) ;
            this.calls.set(key, value) ;

            debug(`after adding call there are now ${this.calls.size} calls in progress`);

            uas.on('destroy', this._onDestroy.bind( this, uas, uac, this.calls.delete.bind( this.calls, key ), deleteProxy.bind( null, rtpEngine, rtpEngineIdentifyingDetails ))) ;
            uac.on('destroy', this._onDestroy.bind( this, uac, uas, this.calls.delete.bind( this.calls, key ), deleteProxy.bind( null, rtpEngine, rtpEngineIdentifyingDetails ))) ;

            uas.on('refer', this._handleRefer.bind( this, uas, uac ) ) ;
            uac.on('refer', this._handleRefer.bind( this, uac, uas ) ) ;

            uas.on('info', this._handleInfo.bind( this, uas, uac ) ) ;
            uac.on('info', this._handleInfo.bind( this, uac, uas ) ) ;

            callback( null, uas, uac ) ;

          }
        ], (err/* , uas, uac */) => {
          if( err ) { 
            return ;
          }
          // success!!
        }) ;
    }) ;
  }

  /**
   * call has been terminated from one side or the other
   * @param  {[Object]} dlg           dialog that was closed
   * @param  {[Object]} dlgOther      the opposing dialog, which we must close
   * @param  {[Function]} fnDeleteCall  function that will remove the call info from the map
   * @param  {[Function]} fnDeleteProxy function that will free the rtp media resources
   */
  _onDestroy( dlg, dlgOther, fnDeleteCall, fnDeleteProxy ) {
    dlgOther.destroy() ;
    fnDeleteCall() ;
    fnDeleteProxy() ;
  }

  /**
   * REFER has been received from one side to initiate a call transfer.  Proxy to the other side
   * @param  {[Object]} dlg      dialog that initiated the REFER
   * @param  {[Object]} dlgOther opposing dialog
   * @param  {[Object]} req      sip request
   * @param  {[Object]} res      sip response
   */
  _handleRefer( dlg, dlgOther, req, res ) {
    let referTo = req.get('Refer-To') ;
    let arr = /(.*)Replaces=(.*)>/.exec(referTo) ;

    // for attended transfer: fixup the Replaces part of the Refer-To header
    if( arr ) {
      let key = arr[2] ;
      if( this.calls.has( key ) ) {
        referTo = arr[1] + 'Replaces=' + this.calls.get( key ) + '>' ;
      }
      else {
        console.error(`attended transfer but we cant find ${key}`);
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
  _handleInfo( dlg, dlgOther, req, res ) {
    debug(`received info with content-type: ${req.get('Content-Type')}`);
    res.send(200) ;

    if( req.get('Content-Type') === 'application/media_control+xml' ) {
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


function deleteProxy( rtpEngine, rtpEngineIdentifyingDetails ) {
  rtpEngine.delete( rtpEngineIdentifyingDetails ) ;
}

function produceSdpUas( rtpEngine, opts, remoteSdp, res, callback ) {
  Object.assign( opts, {
    'sdp': remoteSdp,
    'to-tag': res.getParsedHeader('To').params.tag
  }) ;
  rtpEngine.answer(opts, (err, response) => {
    if( err ) {
      return callback(err) ;
    }
    debug(`response from rtpEngine#answer: ${JSON.stringify(response)}`) ;
    callback( null, response.sdp ) ;
  }) ;
}

function makeReplacesStr( dlg ) {
  var s = '';
  if( dlg.type === 'uas') {
    s = encodeURIComponent( dlg.sip.callId + ';to-tag=' + dlg.sip.localTag + ';from-tag=' + dlg.sip.remoteTag ) ;
  }
  else {
    s = encodeURIComponent( dlg.sip.callId + ';to-tag=' + dlg.sip.remoteTag + ';from-tag=' + dlg.sip.localTag ) ;    
  }
  return s ;
}
