# Durable known risks

This records accepted product trade-offs and compensating controls, not an issue
tracker. Reconsider a risk when its trigger occurs.

## Private-range egress by design

Monitoring and inventory must reach RFC1918/unique-local targets. The compensating
control is `requestPinnedUrl`: scheme/credential validation, DNS pinning, address
classification, bounded redirects, TLS behavior, and timeouts. Reconsider if
Rackpad becomes multi-tenant SaaS or processes untrusted public user URLs.

## Bearer sessions in localStorage

Bearer storage removes ambient-cookie CSRF but exposes a session to successful
same-origin script execution. Strict shared CSP, no arbitrary scripts, escaped
React rendering, and server authorization compensate. Reconsider before broad
internet exposure, third-party scripts, or a different frontend trust model.

## Single-instance in-memory throttle/state

Login attempts and some OIDC/scheduling state are process-local and reset on
restart. Reverse-proxy auth rate limiting is recommended. Reconsider before
horizontal scaling or a formal availability/security SLA.

## Forward-only migrations

There are no down migrations and old binaries may not understand newer schemas.
Pre-upgrade backups/volume snapshots and a newer-schema restore guard compensate.
Reconsider when automated rollback or stronger RPO/RTO commitments are required.

## Privileged discovery profile

Host discovery may run root with host networking and network capabilities. It is
isolated in an opt-in Compose file and should run only on a trusted host/network.
Reconsider if discovery can move to a separate least-privilege worker/agent.

## SQLite and embedded images

One SQLite file simplifies install and complete backups; base64 images keep state
self-contained. Costs include single-writer/instance limits, database growth, and
large logical exports. Reconsider if media volume, concurrency, or backup duration
becomes operationally significant.

## Legacy SNMP algorithms

SNMPv3 USM interoperability supports device-selected MD5/SHA1. Exceptions are
inline and limited to `server/lib/snmp-v3.ts`; application passwords and secret
encryption must not inherit them. Reconsider when supported devices no longer
require legacy protocols.

## Remaining validation gaps

Authorization remains per-handler without a robust route-inventory gate. CodeQL’s
global missing-rate-limit exception exists because the query does not model the
Fastify plugin and must be reviewed by its dated comment. These are manual review
obligations, not completed automation.
