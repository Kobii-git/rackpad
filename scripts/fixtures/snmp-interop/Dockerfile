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
# Both standard fixture roles use the snmp-agent alias. Direct custom-host runs
# should override --health-cmd to pass that host to healthcheck.mjs as well.
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "scripts/fixtures/snmp-interop/healthcheck.mjs"]
CMD ["node", "--import", "tsx", "scripts/fixtures/snmp-interop/runner.ts"]
