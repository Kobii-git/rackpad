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

Please run these locally and fix any failures:

```bash
npm run lint
npm run build
npm run test:server
npm run check:i18n
```

`check:i18n` catches wrong-language values (for example French strings copied into non-French locales). Run it after editing translation files.

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
