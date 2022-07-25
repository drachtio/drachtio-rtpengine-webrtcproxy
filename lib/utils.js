const rtpCharacteristics = require('../data/rtp-transcoding');
const srtpCharacteristics = require('../data/srtp-transcoding');

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

/**
 * Function to remove all webrtc attributes from the sdp before sending a request or response
 * to the pure SIP and RTP side.
 * If a transfer is later done to a non-webrtc number, these attributes will not be relevant
 * and the removal of them causes Chrome to remove the receiving stream, resulting in one way audio.
 * @param sdp sdp to modify
 * @returns sdp without ssrc and msid attributes
 */

function removeWebrtcAttributes(sdp) {
  if (!sdp.includes('a=ssrc')) {
    return sdp;
  }
  let sdpArray = sdp.split(/\r\n/);
  sdpArray = sdpArray.filter((attribute) => !attribute.includes('a=ssrc') && !attribute.includes('a=msid'));
  return sdpArray.join('\r\n');
}

/**
 * Function to generate the options to be passed to dialog.modify().
 * @param req the request to use to modify the dialog
 * @param noAck boolean identifying if the ACK should be handled outside of the modify funciton
 * @returns modifyOpts
 */
function makeModifyDialogOpts(req, noAck) {
  let modifyOpts = { noAck };

  //Retain the P-Asserted-Identity header that BW adds on the reInvite to perform a warm transfer.
  if (req.get('P-Asserted-Identity') && (req.get('Privacy') && (req.get('Privacy') == 'none'))) {
    modifyOpts = {
      headers: { 'P-Asserted-Identity': req.get('P-Asserted-Identity') },
      noAck: noAck
    };
  }
  return modifyOpts;
}

module.exports = {
  stringifyContact,
  isValidRegister,
  makeRtpEngineOpts,
  removeWebrtcAttributes,
  makeModifyDialogOpts
};
