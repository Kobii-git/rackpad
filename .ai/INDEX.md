# AI context router

Always read `AGENTS.md` and this router. Then load only the smallest relevant set
below—normally one to three files—and inspect the affected source and tests.

| Task | Read next |
| --- | --- |
| API route or server behavior | `ARCHITECTURE.md`, `GUARDRAILS.md`, `SECURITY.md`, `TESTING.md` |
| Schema or migration | `DATA_MODEL.md`, `GUARDRAILS.md`, `TESTING.md`, `KNOWN_RISKS.md` |
| Backup or restore | `DATA_MODEL.md`, `GUARDRAILS.md`, `TESTING.md`, `KNOWN_RISKS.md` |
| UI, visualizer, or i18n | `ARCHITECTURE.md`, `TESTING.md`; inspect the current components and design patterns |
| Authentication, authorization, OIDC, CSP, or egress | `SECURITY.md`, `GUARDRAILS.md`, `KNOWN_RISKS.md` |
| Docker, Compose, environment, or operations | `DEPLOYMENT.md`, `GUARDRAILS.md`, `SECURITY.md` |
| Validation or CI | `COMMANDS.md`, `TESTING.md`, `REVIEW_CHECKLIST.md` |
| Release preparation | `DEPLOYMENT.md`, `COMMANDS.md`, `REVIEW_CHECKLIST.md` |
| Diff review | `REVIEW_CHECKLIST.md`, `GUARDRAILS.md` |
| Architectural decision | `ARCHITECTURE.md`, `DECISIONS.md`, `KNOWN_RISKS.md` |

Do not treat `docs/SNMP_IMPLEMENTATION_PLAN.md`,
`docs/BETA_1_5_ISSUE_MAP.md`, or local reviewer reports as current fact. They are
historical evidence; current source and durable documents take precedence.
