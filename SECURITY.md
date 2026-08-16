# Security Policy

Rackpad is intended for self-hosted inventory and operations use, often on
private LANs or behind VPNs and reverse proxies. Security issues still matter,
especially because the app stores infrastructure topology, addressing, and
account data.

## Supported versions

Security fixes are expected to land on:

- the latest tagged release
- `main`, if it is ahead of the latest release

Older tags may not receive backported fixes.

## Reporting a vulnerability

Please do not open a public issue for a sensitive security report.

Use one of these private paths instead:

1. GitHub Security Advisories for the repository, if enabled
2. A private maintainer contact through the repository owner profile

When reporting, include:

- Rackpad version or commit
- deployment method (`Docker`, `Node`, reverse proxy, and OS)
- reproduction steps
- impact assessment
- whether authentication is required

## Disclosure expectations

Rackpad is a self-hosted project without a commercial SLA, but good-faith
private reports are appreciated and should receive triage before public
disclosure whenever practical.

## Automated scanning

Rackpad runs CodeQL and Trivy against development, beta, and stable branches.
Fixable high and critical dependency, secret, and configuration findings block
release builds.

Scanner exceptions must identify one advisory, explain why Rackpad is not
affected, and include an expiry date. An expired exception fails the scan again
until it is removed, renewed with current evidence, or replaced by an upstream
fix.

## Hardening guidance

Before exposing Rackpad beyond a trusted LAN, use:

- HTTPS termination at a reverse proxy
- trusted host and origin settings
- reverse-proxy rate limiting for `/api/auth/*`
- a strong admin password
- backups of the Rackpad database or JSON exports
- administrator-only control of discovery scans and active monitor configuration

Rackpad backup exports still contain user password hashes so restores remain
possible, but stored notification delivery secrets are redacted from the JSON
export before download. Exports also contain lab-scoped authorization grants and
the schema version; active sessions are intentionally excluded and invalidated
on restore. Treat every database and JSON export as sensitive.

See:

- [INSTALL.md](./INSTALL.md)
- [deploy/Caddyfile.example](./deploy/Caddyfile.example)
- [deploy/nginx-rackpad.conf](./deploy/nginx-rackpad.conf)
