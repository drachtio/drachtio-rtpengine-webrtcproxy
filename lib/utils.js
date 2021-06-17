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
    'flags': ['SDES-no', 'generate mid']
  };
  
  const rtpCharacteristics = {
    'transport protocol': 'RTP/AVP',
    'DTLS': 'off',
    'ICE': 'remove',
    'rtcp-mux': ['demux'], 
    'flags':['SDES-no']
  };

  const dstOpts = dstIsUsingSrtp ? srtpCharacteristics : rtpCharacteristics;
  const srctOpts = srcIsUsingSrtp ? srtpCharacteristics : rtpCharacteristics;
  const callDirection = srcIsUsingSrtp? 'outbound' : 'inbound';
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
    },
    callDirection
  };
}

/**
 * Function to remove all webrtc attributes from the sdp before sending a request or response
 * to the pure SIP and RTP side. 
 * If a transfer is later done to a non-webrtc number, these attributes will not be relevant
 * and the removal of them causes Chrome to remove the receiving stream, resulting in one way audio. 
 * @param sdp sdp to modify
 * @returns sdp without ssrc and msid attributes
 */

function removeWebrtcAttributes(sdp) {
  if (!sdp.includes('a=ssrc')){
    return sdp;
  }
  let sdpArray = sdp.split(/\r\n/);
  sdpArray = sdpArray.filter(attribute => !attribute.includes('a=ssrc') && !attribute.includes('a=msid'));
  return sdpArray.join('\r\n');
}

module.exports = {
  stringifyContact,
  isValidRegister, 
  makeRtpEngineOpts,
  removeWebrtcAttributes
};
