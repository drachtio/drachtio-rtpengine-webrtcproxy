const parseUri = require('drachtio-srf').parseUri ;
const SipError = require('drachtio-srf').SipError;

class Subscriber {

  constructor(logger) {
    this._logger = logger;
  }

  get logger() {
    return this._logger;
  }

  start(srf, registrar) {
    srf.subscribe((req, res) => {

      this.logger.info(`UAC subscribing: ${req.protocol}/${req.source_address}:${req.source_port}`) ;

      // only registered users are allowed to subscribe
      const from = req.getParsedHeader('from') ;
      const fromUser = parseUri(from.uri).user ;
      const callid = req.get('Call-Id');

      if (!registrar.hasUser(fromUser)) {
        this.logger.fino(`invalid/unknown user ${fromUser} attempting to subscribe`) ;
        return res.send(503);
      }

      // check if we have a call-id / cseq that we used previously on a 401-challenged SUBSCRIBE
      const headers = {} ;
      const obj = registrar.getNextCallIdAndCSeq(callid) ;
      if (obj) {
        Object.assign(headers, obj) ;
        registrar.removeTransaction(callid) ;
      }
      else {
        Object.assign(headers, {'CSeq': '1 INVITE'}) ;
      }

      let subscribeSent ;

      return srf.createB2BUA(req, res, req.uri, {
        method: 'SUBSCRIBE',
        headers: headers,
        proxyRequestHeaders: ['event', 'expires', 'allow', 'authorization', 'accept'],
        proxyResponseHeaders: ['subscription-state', 'expires', 'allow-events', 'www-authenticate']
      }, {
        cbRequest: (err, req) => subscribeSent = req
      })
        .catch((err) => {
          if (err instanceof SipError && [401, 407].includes(err.status)) {
            if (subscribeSent) {
              registrar.addTransaction({
                aCallId: callid,
                bCallId: subscribeSent.get('Call-Id'),
                bCseq: subscribeSent.get('CSeq')
              }) ;
            }
          }
          else {
            this.logger.error('Error establishing subscribe dialog: ', err.status || err) ;
          }
        });
    });
  }
}

module.exports = exports = Subscriber ;
