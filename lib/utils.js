function stringifyContact(h) {
  let s = `<${h[0].uri}>`;
  Object.keys(h[0].params).forEach((p) => s += `;${p}=${h[0].params[p]}`);
  return s;
}

function isValidRegister(req) {
  if (!req.has('Contact')) return false ;

  const contact = req.getParsedHeader('Contact') ;
  if (!contact || !contact.length) return false ;
  if (!req.registration) return false ;

  if (!req.registration.contact || req.registration.contact.length !== 1) return false ;

  return true ;
}

module.exports = {
  stringifyContact,
  isValidRegister
};
