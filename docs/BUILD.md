# Building drachtio and rtpengine

The webrtc proxy app requires the use of both drachtio and rtpengine.  They may be running on the same, or different servers.

## rtpengine

Instructions for building rtpengine are covered [on its github page](https://github.com/sipwise/rtpengine).

Additionally, an ansible role that automates the build process [can be found here](https://github.com/davehorton/ansible-role-rtpengine).

Finally, [a docker image is available](https://hub.docker.com/r/davehorton/rtpengine/) (`docker pull davehorton/rtpengine:latest`), but this is recommended only for test purposes.

## drachtio

Instructions for building drachtio are covered [on its github page](https://github.com/davehorton/drachtio-server/tree/develop).
> Note: please build and use the 'develop' branch when building the drachtio-server from source.

Additionally, an ansible role that automates the build process [can be found here](https://github.com/davehorton/ansible-role-drachtio).

Finally, [a docker image is available](https://hub.docker.com/r/drachtio/drachtio-server/) (`docker pull drachtio/drachtio-server:latest`), but this is recommended only for test purposes.

Additional detailed information about how to configure the drachtio server, as well as the APIs and frameworks for building apps can be found at [drachtio.org](https://drachtio.org).

### fail2ban

Optionally, you may wish to configure fail2ban to block SIP spam traffic.  An ansible role to install and configure fail2ban for drachtio [can be found here](https://github.com/davehorton/ansible-role-fail2ban-drachtio).

## A few notes on configuring the drachtio server
You should configure the drachtio server to listen for both udp and wss traffic.  In most cases, you will want to configure the server to listen on default ports (5060 for udp, 443 for wss), though you can certainly listen on non-standard ports if you like.

You will need TLS certificates in order to run wss.  We recommend [letsencrypt](https://letsencrypt.org/) as an easy and free way to generate them, but you may use any CA of your choosing.

Below is shown an example drachtio configuration file (which would be found at `/etc/drachtio.conf.xml`) that illustrates how to configure your certificate information and SIP ports.
> Note: the example below shows the configuration for a server that has a local (private) IP and a public IP that is assigned over the top by a hosted provider -- e.g. as with google or AWS clouds.  If you instead have a public IP address that is explicitly bound to a local interface (e.g. as Digital Ocean does), then you would eliminate the "external-ip" property and simply put the public IP address in the sip uri.

```xml
<drachtio>

    <!-- udp port to listen on for client connections and shared secret -->
    <admin port="9022" secret="cymru">10.132.0.28</admin>

    <!-- sip configuration -->
    <sip>
        <contacts>
            <contact external-ip="<yourpublicip>">sip:10.132.0.28;transport=udp</contact>
            <contact external-ip="<yourpublicip>">sips:10.132.0.28:443;transport=wss</contact>
        </contacts>

     <tls>
         <key-file>/etc/letsencrypt/live/<yourdomain>/privkey.pem</key-file>
         <cert-file>/etc/letsencrypt/live/<yourdomain>/cert.pem</cert-file>
         <chain-file>/etc/letsencrypt/live/<yourdomain>/chain.pem</chain-file>
     </tls>


        <spammers action="reject" tcp-action="discard">
            <header name="User-Agent">
                <value>sip-cli</value>
                <value>sipcli</value>
                <value>friendly-scanner</value>
            </header>
            <header>
                <value>sipvicious</value>
            </header>
        </spammers>

        <udp-mtu>4096</udp-mtu>

    </sip>

    <cdrs>true</cdrs>
            
    <!-- logging configuration -->
    <logging>

        <file>
            <name>/var/log/drachtio/drachtio.log</name>
            <archive>/var/log/drachtio/archive</archive>
            <size>5</size>
            <maxSize>10</maxSize>
            <auto-flush>true</auto-flush>
        </file>

        <!-- sofia internal log level, from 0 (minimal) to 9 (verbose) -->
        <sofia-loglevel>3</sofia-loglevel>
        
        <!-- notice, warning, error, info, debug.  Default: info -->
        <loglevel>info</loglevel>
    </logging>
        
</drachtio>
```