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

The global API limiter, login attempts, and some OIDC/scheduling state are
process-local and reset on restart. An upstream proxy limit remains recommended
for exposed deployments. Reconsider before horizontal scaling or a formal
availability/security SLA.

## Forward-only migrations

There are no down migrations and old binaries may not understand newer schemas.
Pre-upgrade backups/volume snapshots and a newer-schema restore guard compensate.
Reconsider when automated rollback or stronger RPO/RTO commitments are required.

## Privileged discovery profile

Host discovery may run root with host networking and network capabilities. It is
isolated in an opt-in Compose file and should run only on a trusted host/network.
Reconsider if discovery can move to a separate least-privilege worker/agent.

## Native LXC requires real-Proxmox validation

The native helper, update transaction, rollback, and discovery modes have
isolated contract fixtures but have not yet passed the planned fresh-install,
cross-version rollback, reboot, and soak gates on Proxmox VE 9.x Debian 13 and
Ubuntu 24.04 guests. Public documentation keeps the installer pre-release until
that evidence exists. Reconsider support claims only after Phases 4-6 of the
native LXC roadmap pass.

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

API routes now require typed public/authenticated/admin/lab/conditional metadata;
app construction rejects inventory drift and public/admin enforcement is central.
Lab ID resolution and row-based lab guards remain handler-specific and require
manual review plus negative tests. CodeQL's global `js/missing-rate-limiting`
exception exists because the query does not model the Fastify plugin. Runtime
cross-route and proxy-identity tests plus the ESLint single-app-factory rule and
its `lint:proof` probe compensate. Owner `@Kobii-git` must review or remove the
exception by 2026-11-30.
