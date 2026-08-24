# Command catalog

`package.json` is the executable source of truth. This file maps intent to script
names and never duplicates command bodies. “Canonical” means maintained as a
repository gate, not that it passed in the current task; report executed results
separately.

| Intent | Script | Status and use |
| --- | --- | --- |
| TypeScript/React lint | `lint` | Canonical, non-mutating, zero warnings allowed |
| Prove lint rejects TSX | `lint:proof` | Canonical gate-coverage proof |
| Client types | `typecheck:client` | Canonical targeted check |
| Server types | `typecheck:server` | Canonical targeted check |
| Test/E2E types | `typecheck:tests` | Canonical targeted check |
| All types | `typecheck` | Canonical standard check |
| Translation integrity | `check:i18n` | Canonical after visible strings/locales |
| Server/domain tests | `test:server` | Canonical after server/data/security work |
| Client unit tests | `test:client` | Canonical after client helper/model work |
| Browser/accessibility | `test:e2e` | Environment-heavy; required by full CI/release |
| Documentation screenshots | `screenshots:update` | Isolated deterministic 1920×1200 capture; outside normal E2E discovery |
| Non-browser tests | `test` | Canonical local aggregation |
| All tests | `test:full` | Canonical environment-heavy aggregation |
| Production build | `build` | Canonical client/server build |
| Bundle/lazy locales | `check:bundle` | Run after `build` |
| Env and Docker ignores | `check:config` | Canonical deployment/config gate |
| AI-doc consistency | `check:docs` | Canonical durable-context gate |
| Standard completion | `check` | Local pre-completion source of truth |
| Full CI/release | `check:full` | Standard check plus Playwright |

For a small change, run the directly mapped targeted scripts plus the affected
type check. For CAUTION work, run `check`; add `test:e2e` when user-visible,
security-header, routing, or release risk requires it. CI also runs actionlint and
shell/PowerShell syntax checks because those depend on platform tools.

Long-running servers, package installation, Git mutation, Docker build/run,
restore, password reset, push/tag/publish, and deployment are not validation
scripts. Follow `AGENTS.md` approval boundaries before executing them.
