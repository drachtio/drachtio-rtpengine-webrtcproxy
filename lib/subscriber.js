'use strict' ;

const parseUri = require('drachtio-sip').parser.parseUri ;
const debug = require('debug')('drachtio-rtpengine-webrtcproxy') ;

class Subscriber {

  constructor() {
  }

  start( srf, registrar ) {
    srf.subscribe( ( req, res ) => {

      debug(`UAC subscribing: ${req.protocol}/${req.source_address}:${req.source_port}`) ;

      // only registered users are allowed to subscribe
      var from = req.getParsedHeader('from') ;
      var fromUser = parseUri( from.uri ).user ;
      var callid = req.get('Call-Id');

      if( !registrar.hasUser( fromUser ) ) {
        console.error(`invalid user ${fromUser} attempting to subscribe`) ;
        return res.send(503);
      }

      // check if we have a call-id / cseq that we used previously on a 401-challenged SUBSCRIBE
      var headers = {} ;
      var obj = registrar.getNextCallIdAndCSeq( callid ) ;
      if( obj ) {
        Object.assign( headers, obj ) ;
        registrar.removeTransaction( callid ) ;
      }
      else {
        Object.assign( headers, {'CSeq': '1 INVITE'}) ;
      }

      var subscribeSent ;

      srf.createBackToBackDialogs( req, res, req.uri, {
        method: 'SUBSCRIBE',
        headers: headers,
        proxyRequestHeaders: ['event','expires','allow','authorization','accept'],
        proxyResponseHeaders: ['subscription-state','expires','allow-events','www-authenticate']
      }, (err) => {
        if( err ) {
          if( [401,407].indexOf( err.status ) !== -1 ) {
            if( subscribeSent ) {
              registrar.addTransaction({
                aCallId: callid,
                bCallId: subscribeSent.get('Call-Id'),
                bCseq: subscribeSent.get('CSeq')
              }) ;              
            }
          }
          else {
            return console.error('Error establishing subscribe dialog: ', err.status || err) ;
          }
        }
      }).then( function( uacRequest ) {
        subscribeSent = uacRequest ;
      }) ;
    });
  }
}

module.exports = exports = Subscriber ;