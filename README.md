# drachtio-rtpengine-webrtcproxy

Open-source webrtc proxy server built using [drachtio](https://github.com/davehorton/drachtio-server) (SIP Proxy) and [rtpengine](https://github.com/sipwise/rtpengine) (RTP proxy).

## Installation

As mentioned above, the following are pre-requisites and should be installed first:

* [drachtio](https://github.com/davehorton/drachtio-server) 
* [rtpengine](https://github.com/sipwise/rtpengine)

Installation instructions for both can be found by following the links above.

Having done that, simply check out and install this repository:

```bash
$ git clone https://github.com/davehorton/drachtio-rtpengine-webrtcproxy.git
$ cd drachtio-rtpengine-webrtcproxy
$ npm install
```

Next, copy <code>config.json.example</code> to <code>config.json</code>, and edit to specify the coordinates of your drachtio server and rtpengine processes.

Then fire it up!

```bash
$ node app.js
```





