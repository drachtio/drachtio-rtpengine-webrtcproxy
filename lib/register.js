const mw = require('drachtio-mw-registration-parser') ;
const parseUri = require('drachtio-srf').parseUri ;
const {stringifyContact, isValidRegister} = require('./utils') ;
const debug = require('debug')('drachtio:rtpengine-webrtcproxy') ;

class Register  {

  constructor(logger) {
    this._logger = logger;
  }

  get logger() {
    return this._logger;
  }

  start(srf, registrar) {
    srf.register(mw, (req, res) => {
      const callid = req.get('Call-Id');

      debug(`UAC registering: ${req.protocol}/${req.source_address}:${req.source_port} with uri ${req.uri}`) ;

      if (!isValidRegister(req)) {
        this.logger.info(`invalid register request: ${req.get('Call-Id')} ${req.get('CSeq')}`) ;
        return res.send(503);
      }
      const instanceId = req.registration.contact[0].params['+sip.instance'] ;
      const regId = req.registration.contact[0].params['reg-id'] ;
      const uri = parseUri(req.uri) ;
      const headers = {} ;

      // check if we have a call-id / cseq that we are using for this transaction
      const obj = registrar.getNextCallIdAndCSeq(callid) ;
      if (obj) {
        Object.assign(headers, obj) ;
      }
      else {
        Object.assign(headers, {'CSeq': '1 REGISTER'}) ;
      }

      ['from', 'to', 'authorization', 'supported', 'allow', 'user-agent'].forEach((hdr) => {
        if (req.has(hdr)) headers[hdr] = req.get(hdr) ;
      }) ;

      const uacContact = req.getParsedHeader('Contact') ;
      const from = req.getParsedHeader('From') ;
      const user = parseUri(from.uri).user ;

      // NB: drachtio server will replace 'localhost' appropriately
      headers.contact = `<sip:${user}@localhost>;expires=${req.registration.expires}` ;

      srf.request({
        uri: req.uri,
        method: req.method,
        headers
      }, (err, request) => {
        if (err) {
          return this.logger.info(`Error forwarding register to ${uri.host}: ${err}`);
        }
        request.on('response', (response) => {
          const headers = {} ;
          ['www-authenticate'].forEach((hdr) => {
            if (response.has(hdr)) headers[hdr] = response.get(hdr);
          });

          // construct a contact header
          let expires, contact ;
          if (response.has('Contact')) {
            contact = response.getParsedHeader('Contact') ;
            expires = parseInt(contact[0].params.expires) ;
            uacContact[0].params.expires = expires ;

            headers.contact = stringifyContact(uacContact) ;
          }

          res.send(response.status, response.reason, {headers}) ;
          if (200 === response.status) {
            const arr = /^(sip:.*);transport=(.*)$/.exec(req.registration.contact[0].uri);
            if (arr) {
              const via = req.getParsedHeader('Via') ;
              const transport = (via[0].protocol).toLowerCase() ;

              if ('register' === req.registration.type) {
                registrar.addUser(user, {
                  expires: Date.now() + (expires * 1000),
                  transport: transport,
                  source_address: req.source_address,
                  source_port: req.source_port,
                  uri: arr[1],
                  instanceId:instanceId,
                  regId: regId,
                  aor: req.registration.aor
                });
                if (!registrar.hasTransaction(callid)) {
                  registrar.addTransaction({
                    aCallId: callid,
                    bCallId: response.get('Call-Id'),
                    bCseq: response.get('CSeq')
                  }) ;
                }
              }
              else {
                registrar.removeUser(user) ;
                registrar.removeTransaction(req.get('call-id')) ;
              }
            }
          }
          else if ([401, 407].includes(response.status)) {
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
