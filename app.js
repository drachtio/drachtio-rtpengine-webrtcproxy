'use strict';

const drachtio = require('drachtio') ;
const app = drachtio() ;
const Srf = require('drachtio-srf') ;
const srf = new Srf(app) ;
const Register = require('./lib/register') ;
const Registrar = require('./lib/registrar') ;
const Subscriber = require('./lib/subscriber') ;
const CallProcessor = require('./lib/call-processor') ;
const registrar = new Registrar() ;
const register = new Register() ;
const subscriber = new Subscriber() ;
const callProcessor = new CallProcessor() ;
const Rtpengine = require('./lib/rtpengine') ;
const config = require('./config') ;
const rtpengine = new Rtpengine( config.rtpengine['ng-address'], config.rtpengine['ng-port'], config.rtpengine['local-address'], config.rtpengine['local-port']) ;
//const debug = require('debug')('drachtio-rtpengine-webrtcproxy') ;

srf.connect(config.drachtio) 
.on('connect', function(err, hostport) {
  console.log('connected to drachtio listening for SIP on %s', hostport) ;
})
.on('error', function(err){
  console.error('Error connecting to drachtio server: ', err.message ) ;
})
.on('reconnecting', function(opts) {
  console.error('attempting to reconect: ', opts) ;
}) ;


register.start(srf, registrar) ;
subscriber.start(srf, registrar) ;
callProcessor.start( srf, rtpengine, registrar ) ;

/*
rtpengine.on('listening', function() {
  rtpengine.ping( (err, response) => {
    if( err ) {
      console.error(`error sending ping: ${JSON.stringify(err)}`);
    }
    debug(`ping result: ${response.result}`);
  }) ;
}) ;
*/
