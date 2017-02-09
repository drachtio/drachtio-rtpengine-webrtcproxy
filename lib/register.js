'use strict' ;

const mw = require('drachtio-mw-registration-parser') ;
const parseUri = require('drachtio-sip').parser.parseUri ;
const stringifyContact = require('./utils').stringifyContact ;
const isValidRegister = require('./utils').isValidRegister ;
const debug = require('debug')('drachtio-rtpengine-webrtcproxy') ;

class Register  {

  constructor() {
  }

  start( srf, registrar ) {
    srf.register( mw, ( req, res) => {
      let callid = req.get('Call-Id');

      debug(`UAC registering: ${req.protocol}/${req.source_address}:${req.source_port} with uri ${req.uri}`) ;

      if( !isValidRegister( req ) ) {
        console.error(`invalid register request`) ;
        return res.send(503);
      }
      let instanceId = req.registration.contact[0].params['+sip.instance'] ;
      let regId = req.registration.contact[0].params['reg-id'] ;
      let uri = parseUri( req.uri ) ;
      let headers = {} ;

      // check if we have a call-id / cseq that we are using for this transaction
      let obj = registrar.getNextCallIdAndCSeq( callid ) ;
      if( obj ) {
        Object.assign( headers, obj ) ;
      }
      else {
        Object.assign( headers, {'CSeq': '1 REGISTER'}) ;
      }

      ['from','to','authorization','supported','allow','user-agent'].forEach( function(hdr) { 
        if( req.has(hdr) ) { headers[hdr] = req.get(hdr) ; }
      }) ;

      let uacContact = req.getParsedHeader('Contact') ;
      let from = req.getParsedHeader('From') ;
      let user = parseUri( from.uri ).user ;

      headers.contact = '<sip:' + user + '@localhost>;expires=' + req.registration.expires ;

      srf.request({
          uri: req.uri,
          method: req.method,
          headers: headers
        },
        ( err, request ) => {
          if( err ) { 
            return console.error('Error forwarding register to %s: ', uri.host, err );
          }
          request.on('response', (response) => { 
            headers = {} ;
            ['www-authenticate'].forEach( function(hdr) { 
              if( response.has(hdr) ) { headers[hdr] = response.get(hdr) ; } 
            }) ;

            // construct a contact header 
            let expires, contact ;
            if( response.has('Contact') ) {
              contact = response.getParsedHeader('Contact') ;
              expires = parseInt( contact[0].params.expires ) ;
              uacContact[0].params.expires = expires ;

              headers.contact = stringifyContact( uacContact ) ;            
            }

            res.send(response.status, response.reason, {
              headers: headers
            }) ;

            if( 200 === response.status ) {

              let arr = /^(sip:.*);transport=(.*)$/.exec( req.registration.contact[0].uri ) ;
              if( arr && arr.length > 1 ) {

                let via = req.getParsedHeader('Via') ;
                let transport = (via[0].protocol).toLowerCase() ;

                if( 'register' === req.registration.type ) {
                  registrar.addUser( user, {
                    expires: Date.now() + (expires * 1000),
                    transport: transport,
                    source_address: req.source_address,
                    source_port: req.source_port,
                    uri: arr[1] ,
                    instanceId:instanceId,
                    regId: regId,
                    aor: req.registration.aor
                  }) ; 
                  if( !registrar.hasTransaction( callid ) ) {
                    registrar.addTransaction({
                      aCallId: callid,
                      bCallId: response.get('Call-Id'),
                      bCseq: response.get('CSeq')
                    }) ;
                  }              
                }
                else {
                  registrar.removeUser( user) ;
                  registrar.removeTransaction( req.get('call-id') ) ;
                }
              }
            }
            else if( [401,407].indexOf( response.status ) !== -1 ) {
              registrar.addTransaction({
                aCallId: callid,
                bCallId: response.get('Call-Id'),
                bCseq: response.get('CSeq')
              }) ;
            }
            else {
              debug(`register failed with ${response.status}`) ;
            }
          }) ;
        });
    });
  }
} 

module.exports = exports = Register ;
