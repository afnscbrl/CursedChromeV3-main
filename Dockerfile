FROM node:18-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/* && \
    ln -s /usr/bin/python3 /usr/bin/python

RUN mkdir /work/
WORKDIR /work/

COPY package.json /work/
RUN npm install --registry https://registry.npmmirror.com --no-audit --no-optional

COPY ./anyproxy /work/anyproxy/
RUN chmod +x /work/anyproxy/bin/*
RUN /work/anyproxy/bin/anyproxy-ca --generate
RUN mkdir /work/ssl/ && \
    cp /root/.anyproxy/certificates/rootCA.crt /work/ssl/ && \
    cp /root/.anyproxy/certificates/rootCA.key /work/ssl/

COPY gui/index.html /work/gui/index.html
COPY utils.js       /work/
COPY database.js    /work/
COPY api-server.js  /work/
COPY server.js      /work/
COPY docker-entrypoint.sh /work/
RUN chmod +x /work/docker-entrypoint.sh

ENTRYPOINT ["/work/docker-entrypoint.sh"]
