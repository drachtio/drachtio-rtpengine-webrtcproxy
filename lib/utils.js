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

function makeRtpEngineOpts(req, srcIsUsingSrtp, dstIsUsingSrtp) {
  const from = req.getParsedHeader('from');
  const srtpCharacteristics = {
    'transport-protocol': 'UDP/TLS/RTP/SAVPF',
    'ICE': 'force',
    'rtcp-mux': ['require'],
    'flags': ['SDES-no', 'generate mid', 'codec-strip-all', 'codec-except-G722', 'codec-except-PCMU','codec-except-PCMA', 'codec-offer-telephone-event']
  };

  const rtpCharacteristics = {
    'transport protocol': 'RTP/AVP',
    'DTLS': 'off',
    'ICE': 'remove',
    'rtcp-mux': ['demux'], 
    'flags':['SDES-no', 'codec-strip-all', 'codec-except-G722', 'codec-except-PCMU', 'codec-except-PCMA', 'codec-offer-telephone-event']
  };

  const dstOpts = dstIsUsingSrtp ? srtpCharacteristics : rtpCharacteristics;
  const srctOpts = srcIsUsingSrtp ? srtpCharacteristics : rtpCharacteristics;
  const common = {
    'call-id': req.get('Call-ID'),
    'replace': ['origin', 'session-connection']
  };
  return {
    common,
    uas: {
      tag: from.params.tag,
      mediaOpts: srctOpts
    },
    uac: {
      tag: null,
      mediaOpts: dstOpts
    }
  };
}

module.exports = {
  stringifyContact,
  isValidRegister, 
  makeRtpEngineOpts
};
