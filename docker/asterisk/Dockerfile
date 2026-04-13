FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update             && apt-get install -y --no-install-recommends asterisk             && rm -rf /var/lib/apt/lists/*

COPY asterisk/base /etc/asterisk

EXPOSE 8088 5038 5060/udp 10000-10100/udp

CMD ["asterisk", "-f"]
