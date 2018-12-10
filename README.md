# drachtio-rtpengine-webrtcproxy

An open-source webrtc proxy server built using [drachtio](https://drachtio.org) and [rtpengine](https://github.com/sipwise/rtpengine) that allows webrtc clients to place or receive calls from their VoIP provider. The server can optionally be configured to handle authentication against SIP trunks requiring digest authentication (otherwise, digest challenges are passed back to the client).

## Installation

As mentioned above, drachtio and rtpengine are pre-requisites and you will need each installed and reachable on hosted servers with public IP addresses.  You can run both on the same server, or run them on different servers.

For further details on building drachtio and rtpengine servers, please refer to [docs/BUILD.md](docs/BUILD.md)

Once you have drachtio and rtpengine installed and running, you can install, configure and run the webrtc proxy app.

```bash
$ git clone https://github.com/voxbone/drachtio-rtpengine-webrtcproxy.git
$ cd drachtio-rtpengine-webrtcproxy
$ npm install
```

Before starting the app you will need to copy `config/default.json.example` to `config/default.json` and modify it to your needs (details below). At point, simply start the app:

```bash
$ npm start
```
### Configuration
The example configuration file (in config/default.json.example) looks like this:
```
{
  "drachtio": {
    "host": "127.0.0.1",
    "port": 9022,
    "secret": "cymru"
  }, 
  "rtpengine": {
    "host": "127.0.0.1",
    "port": 22222,
    "local-port": 2223
  },
  "credentials": [
    {
      "trunk": "my.voipprovider.com",
      "auth": {
        "username": "<yourusername>",
        "password": "<yourpassword>"  
      }
    }
  ]
}
```
The information is provided as follows:
* `drachtio`: This is the location where the drachtio server is running and listening to connections from applications.  In the example, the application would be running on the drachtio server itself, and thus the 'host' value is '127.0.0.1'.  You could alternatively have the application running on a different server and connect to the drachtio server across the network, if you wish.
* `rtpengine`: Similarly, this is the information needed for the application to connect to the rtpengine server, using the 'ng' protocol.
* `credentials`: this is an optionaly array of SIP trunks that the webrtc proxy holds authorization credentials for, such that when an INVITE is being sent to that trunk and is subsequently challenged with a 401/407, the webrtc proxy will generate a new INVITE using the credentials provided.  

## Basic operation

The basic operation of the application is to enable *outbound* calls from webrtc clients to SIP endpoints or PSTN phone numbers.

Once started the application listens on the configured interfaces for SIP INVITEs over secure web sockets (wss).  The drachtio server should be configured to listen for wss traffic on a public IP address, and most commonly will be configured to listen on the default wss port 443 (although you can configure it to listen on an alternate port if desired).

When an incoming SIP INVITE is received, the application will allocate endpoints on the rtpengine server to transcode the media stream from SRTP to RTP and will generate an INVITE offering RTP to the Request-URI of the SIP INVITE.  An SRTP-to-RTP call will thus be established.

If the host part of the Request-URI matches one of the configured trunks, the webrtc application will handle digest challenges from the far end.  

Calls can be therefore be made to the PSTN (i.e. regular phone numbers) using a VoIP carrier, or to any reachable SIP URI (e.g. an IP PBX).

## Advanced features

The application also supports *inbound* calls to registered webrtc clients.  These would be RTP to SRTP calls (i.e. the reverse of outbound calls) and require the use of a third-party registrar or VoIP carrier that you can register sip credentials with.  

To receive inbound calls, a webrtc client should send REGISTER requests.  The application will forward the REGISTER requests on to the hosted service (specified in the Request-URI of the received REGISTER message) over udp.  Any subsequent INVITEs received from the VoIP carrier for that registered user will be sent to the webrtc client over wss.
