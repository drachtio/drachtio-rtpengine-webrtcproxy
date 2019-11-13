const Srf = require('drachtio-srf');
const srf = new Srf();
const logger = require('pino')();
const Register = require('./lib/register');
const Registrar = require('./lib/registrar');
const Subscriber = require('./lib/subscriber');
const CallProcessor = require('./lib/call-processor');
const registrar = new Registrar(logger);
const register = new Register(logger);
const subscriber = new Subscriber(logger);
const callProcessor = new CallProcessor(logger);
const config = require('config');
const Client = require('rtpengine-client').Client;
const rtpengine = new Client(config.get('rtpengine.local-port'));

if (config.get('drachtio.mode') === 'outbound') {
  srf.listen(config.get('drachtio'))
} else {
  srf.connect(config.get('drachtio'))
  .on('connect', (err, hostport) => {
    console.log(`connected to drachtio listening for SIP on hostport ${hostport}`);
  })
  .on('error', (err) => {
    console.error(`Error connecting to drachtio server: ${err.message}`);
  });
}

register.start(srf, registrar);
subscriber.start(srf, registrar);
callProcessor.start(srf, rtpengine, registrar);
