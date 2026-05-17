FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    wget \
    nodejs \
    tzdata \
    libssl-dev \
    libncurses5-dev \
    libnewt-dev \
    libxml2-dev \
    libsqlite3-dev \
    uuid-dev \
    libjansson-dev \
    libedit-dev \
    binutils-dev \
    libsrtp2-dev \
    libopus-dev \
    redis-tools \
    tshark \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN cd /usr/src && \
    wget -q http://downloads.asterisk.org/pub/telephony/asterisk/asterisk-20-current.tar.gz && \
    tar xzf asterisk-20-current.tar.gz && \
    AST_DIR=$(find /usr/src -maxdepth 1 -type d -name 'asterisk-20*' | head -1) && \
    cd "$AST_DIR" && \
    ./configure --with-jansson-bundled && \
    make menuselect.makeopts && \
    menuselect/menuselect \
        --enable res_ari \
        --enable res_ari_channels \
        --enable res_ari_bridges \
        --enable res_ari_applications \
        --enable res_ari_events \
        --enable res_ari_recordings \
        --enable res_stasis \
        --enable res_stasis_playback \
        --enable res_stasis_recording \
        --enable res_stasis_answer \
        --enable res_stasis_snoop \
        --enable res_http_websocket \
        --enable res_pjsip \
        --enable res_pjsip_session \
        --enable chan_pjsip \
        --enable app_stasis \
        --enable codec_opus \
        menuselect.makeopts && \
    make -j$(nproc) && \
    make install && \
    make samples && \
    make config && \
    mkdir -p /tmp/codec_opus && \
    OPUS_ARCH="$(uname -m)" && \
    if [ "$OPUS_ARCH" = "x86_64" ]; then OPUS_ARCH_DIR="x86-64"; else OPUS_ARCH_DIR="$OPUS_ARCH"; fi && \
    OPUS_URL="https://downloads.digium.com/pub/telephony/codec_opus/asterisk-20.0/${OPUS_ARCH_DIR}/codec_opus-20.0_current-${OPUS_ARCH}.tar.gz" && \
    if ! curl -fsSL "$OPUS_URL" -o /tmp/codec_opus.tar.gz; then \
        curl -fsSL "https://downloads.digium.com/pub/telephony/codec_opus/asterisk-20.0/x86-64/codec_opus-20.0_current-x86_64.tar.gz" -o /tmp/codec_opus.tar.gz; \
    fi && \
    tar -xzf /tmp/codec_opus.tar.gz -C /tmp/codec_opus && \
    find /tmp/codec_opus -name '*.so' -exec cp {} /usr/lib/asterisk/modules/ \; && \
    mkdir -p /var/lib/asterisk/documentation/thirdparty && \
    find /tmp/codec_opus -name 'codec_opus_config-*.xml' -exec cp {} /var/lib/asterisk/documentation/thirdparty/ \; && \
    rm -rf /tmp/codec_opus /tmp/codec_opus.tar.gz && \
    ldconfig && \
    groupadd -f wireshark && \
    (id -u asterisk >/dev/null 2>&1 && usermod -aG wireshark asterisk || true)

RUN cat >> /etc/asterisk/rtp.conf << 'EOF'

[general]
rtcpstats=yes
rtcpinterval=5000
EOF

EXPOSE 8088 5038 5060/udp
EXPOSE 10000-10100/udp

COPY capture-sidecar.js /usr/local/bin/capture-sidecar.js
COPY entrypoint.sh /usr/local/bin/asterisk-entrypoint.sh
RUN chmod +x /usr/local/bin/capture-sidecar.js /usr/local/bin/asterisk-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/asterisk-entrypoint.sh"]
