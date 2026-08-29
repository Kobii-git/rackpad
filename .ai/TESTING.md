# Testing and validation map

Choose checks by changed behavior and risk. CI is the release authority, but a
local agent must run the smallest sufficient set and broader checks for CAUTION
work. Never translate an unrun check into a pass.

| Change class | Minimum validation |
| --- | --- |
| TypeScript/React source | `lint`, `lint:proof`, affected type check |
| Client helper/model | `typecheck:client`, `test:client`, `build` |
| Server route/library | `typecheck:server`, `typecheck:tests`, `test:server` |
| User-visible UI | client checks, `check:i18n`, `build`; E2E when behavior/layout matters |
| Locale/string | `check:i18n`, client type check/build |
| Schema/migration | server/test types, full server tests, migration compatibility, backup coverage |
| Backup/restore | schema coverage, scoped-grant round trip, newer-schema guard, atomic rejection tests |
| IPAM/DHCP/DNS | server tests covering duplicate ownership, scope/zone boundaries, atomic failure |
| Auth/authz/OIDC | server tests including unauthenticated, wrong-role, and cross-lab negatives |
| Outbound HTTP/monitoring | net-guard plus integration tests for blocked ranges, DNS/redirects, timeouts |
| CSP/security headers | server/build checks and Playwright CSP behavior |
| Env/Compose/Docker | `check:config`, Compose rendering when Docker exists, privilege/data review |
| Proxmox native LXC | `check:proxmox`, Bash syntax, ShellCheck, metadata/config parity, privilege and rollback review; real PVE guest tests before release |
| Bundle/lazy loading | `build`, then `check:bundle` |
| AI docs/commands | `check:docs` and direct path/link review |
| Beta/main release | `check:full`, shell and PowerShell syntax checks, Compose render, smoke plan |

`npm run check` is standard local pre-completion validation. `npm run check:full`
adds Playwright and is the full application CI/release gate. Workflow lint and
Bash syntax, ShellCheck, actionlint, and PowerShell syntax remain CI steps
because tool availability is platform specific.

All destructive restore/migration behavior must use an isolated temporary
database. The server suite already sets `DATABASE_PATH` under the OS temp
directory; do not point tests at a working-tree or deployment database.
