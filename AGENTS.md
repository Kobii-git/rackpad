# Rackpad Agent Instructions

## Project identity

Rackpad is a self-hosted infrastructure inventory and operations application.
It is a React, Fastify, and SQLite modular monolith shipped as one Node process
and normally one hardened container. Preserve that shape unless a concrete
product requirement justifies an architectural change.

This file contains shared operating rules. Start every task here, then use the
task router in `.ai/INDEX.md` to load only the relevant durable context. Inspect
the affected source and tests even when documentation appears complete.

## Evidence and precedence

- Current source and safely executed behavior outrank documentation.
- Report and correct material documentation drift when discovered.
- Distinguish observed facts, inferences, proposals, and unverified claims.
- Never claim a command passed unless it was run and its output inspected.
- A quick or silent green gate is not proof until its coverage is understood.
- If a required check cannot run, state which check, why, and what remains open.
- Do not invent product intent, remote configuration, test results, or release state.

## Git and workspace safety

- Inspect `git status --short --untracked-files=all` before editing.
- Record the active branch and starting HEAD for substantial work.
- Preserve unrelated tracked, untracked, staged, and generated user work.
- Never revert or overwrite changes you did not create for the current task.
- Do not use destructive checkout, hard reset, clean, rebase, or force-push.
- Stage only task-related paths after reviewing the actual diff.
- Do not commit, push, tag, merge, publish, release, or deploy without an
  explicit request covering that external action.
- Never touch real `*.db*` files or `rackpad-backup-*.json` during routine work.
- Run destructive data behavior only against a temporary database outside the
  repository.
- Never print, copy, or commit secret values, credentials, private data, or
  machine-local context.

## Scope and change discipline

- Implement the smallest coherent change that fully solves the request.
- Avoid unrelated refactors, dependency migrations, mass formatting, or cleanup.
- Preserve current product behavior unless the request authorizes a change.
- Do not replace React, Fastify, SQLite, direct parameterized SQL, or the
  modular-monolith boundary without a demonstrated need.
- Do not hand-edit generated output such as `dist/`, `dist-server/`, `.tsbuild/`,
  or generated screenshots.
- Update `package-lock.json` through the package manager, never by hand.
- Update durable documentation only when durable truth changed.
- Do not create task diaries, transcripts, copied source, or current-state files.

## Default workflow

1. Orient with this file and `.ai/INDEX.md`.
2. Inspect Git state, affected source, neighboring patterns, tests, and config.
3. Classify task type and risk together; the highest risk governs the task.
4. Separate current facts from proposed changes.
5. Plan substantial work across behavior, data, security, compatibility,
   deployment, tests, documentation, and rollback implications.
6. Implement the smallest coherent change and preserve unrelated work.
7. Run the validation mapped in `.ai/TESTING.md` and `.ai/COMMANDS.md`.
8. Walk `.ai/GUARDRAILS.md` for every touched file or change category.
9. Review the complete diff for correctness, scope, secrets, data, and drift.
10. Synchronize durable knowledge only when a durable fact changed.
11. Report changes, rationale, executed validation, unverified items, and risks.

## Risk model

### SAFE

Examples include isolated copy or layout changes, translations, tests,
documentation corrected to match source, and pure helpers with coverage.

- Implement autonomously when intent is clear.
- Run targeted checks plus type/build validation appropriate to the change.
- Independent review is optional.

### CAUTION

Examples include API routes, authorization, schema or migrations, backup and
restore, outbound network code, dependencies, Docker or Compose, CI workflows,
environment variables, OIDC, CSP, and public interfaces.

- Implement autonomously when intent is clear and the change stays compatible.
- Inspect wider blast radius and run domain checks plus the standard gate.
- Obtain approval before an externally observable contract change, release,
  deployment, or destructive real-data operation.
- Independent review is expected for authorization, migrations, and backup or
  restore changes.

### RESTRICTED

Examples include real secrets or databases, destructive production operations,
weakening authentication, authorization, CSP, SSRF defenses, or rate limits,
adding public paths, editing applied migrations, broad scanner suppressions,
history rewriting, and release or deployment actions.

- Do not execute without explicit and specific user authority.
- Rehearse destructive behavior only with isolated temporary data.
- Require full relevant validation and independent review.

## Approval boundaries

- Reading source, running non-destructive checks, and editing in-scope files are
  allowed for implementation tasks.
- Ask before changing a public API or environment-variable name, default network
  exposure, authentication/session semantics, stored-data retention, licensing,
  or release-channel meaning unless the request already decides it.
- Never weaken a control merely to make a build, scan, or test pass.
- Keep privileged host networking and root discovery explicitly opt-in.
- If product intent cannot be proven, preserve the safer compatible behavior and
  record the decision as unresolved.

## Role contracts

### Planner

- Inspect source before planning and cite actual files and symbols.
- Label observations and proposals separately.
- Cover risk, compatibility, data, deployment, tests, docs, and rollback.
- Produce an implementer-ready plan and do not edit when asked only to plan.

### Implementer

- Verify every plan assumption against the current tree.
- Report stale assumptions and intentional deviations.
- Make the smallest correct change, validate it, walk guardrails, and inspect
  the final diff.
- Update only durable documentation and never record hidden reasoning.

### Reviewer

- Read the original request and actual diff rather than relying on a summary.
- Review correctness, architecture, security, authorization, compatibility,
  data integrity, tests, deployment, documentation, and scope.
- Rank actionable findings by severity; do not manufacture issues.
- State explicitly when no actionable defect is found.

## Completion contract

A task is complete only when:

- the requested outcome is implemented or the requested analysis is delivered;
- unrelated user work is preserved;
- applicable guardrails were checked;
- relevant checks ran and their output was inspected, or gaps were reported;
- no secret, local database, backup, or private context entered the diff;
- the actual diff was self-reviewed;
- durable documentation changed if and only if durable truth changed;
- behavior changes, compromises, deferred work, and residual risks are explicit.

Use `.ai/REVIEW_CHECKLIST.md` before final reporting on substantial work.
