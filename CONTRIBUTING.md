# Contributing to Rackpad

Thanks for helping improve Rackpad! This guide covers local setup, how we branch and release, and what we expect in pull requests.

## Development setup

1. **Requirements:** Node.js 22.x (see `package.json` engines).
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Run the app locally** (Vite frontend + API server):
   ```bash
   npm run dev:all
   ```
   The UI is typically at `http://localhost:5173` (Vite) with the API on its configured port.

## Branch model

We use a simple promotion flow:

```
dev  →  beta  →  main
```

- **`dev`** — day-to-day integration; feature work lands here first.
- **`beta`** — pre-release testing; semver tags like `1.6.0-beta.4`.
- **`main`** — stable releases.

Beta versions use `-beta.N` suffixes (e.g. `1.6.0-beta.4`). Do not bump the version in drive-by PRs unless explicitly asked.

## Validation before you open a PR

Run the canonical standard validation and fix any failures:

```bash
npm run check
```

`npm run check:full` adds the environment-heavy Playwright accessibility/browser
suite used by CI and releases. Package scripts are the executable source of truth;
see [`.ai/COMMANDS.md`](./.ai/COMMANDS.md) for risk-based targeted selection.

`check:i18n` catches wrong-language values (for example French strings copied
into non-French locales). Run it after editing translation files.

Changes under `scripts/` or `deploy/proxmox/` must also pass the native helper
contract and shell checks:

```bash
npm run check:proxmox
find scripts deploy/proxmox -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n
find scripts deploy/proxmox -type f -name '*.sh' -print0 | xargs -0 shellcheck
```

Keep public dispatchers, release assets, JSON metadata, systemd hardening,
persistent paths, and pinned origins aligned. Do not add Docker commands or
`git pull` to the native helper path.

## Internationalization (i18n)

Rackpad uses **English source strings as keys**:

```ts
t("Broadcast wireless networks")
```

All locale files use `satisfies TranslationMap`, so **key parity is enforced at build time** — every locale must define every key from `en`.

| Location | Locales |
|----------|---------|
| `src/i18n/translations.ts` | `en`, `fr`, `zh`, `es`, `hi`, `ar`, `ja` (inline) |
| `src/i18n/locales/*.ts` | All other locales |

**Rules:**

1. Add new UI strings to `export const en` in `translations.ts` first.
2. Run `node scripts/sync-i18n-keys.mjs` to back-fill missing keys in file locales (English fallback).
3. Translate values in each target locale — do not copy another locale's translations wholesale.
4. Run `npm run check:i18n` to detect value contamination before committing.

Helper scripts live in `scripts/` (`sync-i18n-keys.mjs`, `check-i18n-values.mjs`).

## Pull request expectations

- **Scope:** One logical change per PR when possible; link related issues.
- **Description:** What changed, why, and how you tested it.
- **i18n:** If you add or change user-visible strings, update all locales (or run sync + translate).
- **Tests:** Add or update server tests when behavior changes.
- **No drive-by refactors** unrelated to the task.
- **Do not commit** `.env`, credentials, or local-only scripts unless explicitly requested.

Questions? Open a [discussion](https://github.com/your-org/rackpad/discussions) or an issue — we're happy to help you get unblocked.
