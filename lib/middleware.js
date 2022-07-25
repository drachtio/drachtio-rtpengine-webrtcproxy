const {parseUri} = require('drachtio-srf');

module.exports = function(srf, logger) {

  const initLocals = (req, res, next) => {
    const callid = req.get('Call-Id');
    const from = req.getParsedHeader('From');
    req.locals = {logger: logger.child({callid}), from, callid};
    next();
  };

  const identifyCallDirection =  (req, res, next) => {
    const {registrar} = req.srf.locals;
    const {logger} = req.locals;
    const parsedUri = parseUri(req.uri);
    const user = parsedUri.user ;

    let remoteUri = req.uri ;
    let callDirection = 'outbound';
    if (registrar.hasUser(user)) {
      const details = registrar.getUser(user) ;
      callDirection = 'inbound' ;
      remoteUri = details.uri ;
      logger.debug(`inbound call with details: ${JSON.stringify(details)}`) ;
    }
    else logger.debug(`outbound call to: ${remoteUri}`);

    req.locals = {
      ...req.locals,
      callDirection,
      remoteUri
    };

    next();
  };

  return {
    initLocals,
    identifyCallDirection
  };
};
