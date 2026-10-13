FROM node:22-trixie-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ snmp snmpd snmptrapd \
 && rm -rf /var/lib/apt/lists/* \
 && chown -R node:node /var/lib/snmp
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
COPY scripts/fixtures/snmp-interop ./scripts/fixtures/snmp-interop
USER node
CMD ["node", "--import", "tsx", "scripts/fixtures/snmp-interop/runner.ts"]
