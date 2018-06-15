# drachtio-rtpengine-webrtcproxy

Open-source webrtc proxy server built using [drachtio](https://drachtio.org) and [rtpengine](https://github.com/sipwise/rtpengine).

## Installation

As mentioned above, the following are pre-requisites and should be installed somewhere in your network:

* [drachtio](https://github.com/davehorton/drachtio-server) 
* [rtpengine](https://github.com/sipwise/rtpengine)

Installation instructions for both can be found by following the links above.

Having done that, simply check out and install this repository:

```bash
$ git clone https://github.com/davehorton/drachtio-rtpengine-webrtcproxy.git
$ cd drachtio-rtpengine-webrtcproxy
$ npm install
```

Next, modify<code>config/default.json</code> as needed.

Then fire it up!

```bash
$ node app.js
```





