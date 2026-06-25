# Rackpad Agent Instructions

## Working Style

- Be proactive. If the user asks to fix, build, or push, implement it rather than only proposing a plan.
- Read GitHub issues and all comments before deciding scope. Important details are often in follow-up comments, screenshots, or sub-issues.
- Keep replies to GitHub issues short, human, and non-corporate. Thank the reporter, say what changed, and mention what to test.
- Do not ask for GitHub tokens. Use the existing authenticated session, CLI, or browser session, or ask the user to authenticate through the normal GitHub flow.

## Git Safety

- Never revert unrelated local changes.
- Check `git status` before staging.
- Stage only files related to the task.
- Leave unrelated untracked or generated files alone unless explicitly requested.
- Use clear commit messages with the Rackpad version when releasing.

## Branch And Release Workflow

- `dev` is for active development and testing.
- `beta` is for beta Docker builds.
- `main` is the stable release branch.
- Beta releases should bump `package.json` and `package-lock.json`, update `CHANGELOG.md`, commit, tag, push `dev`, push `HEAD:beta`, and push the tag.
- Main releases should only happen after beta smoke testing passes.
- Docker images are built from pushed branches and tags, so GHCR may take a few minutes to publish after a push.

## Versioning

- Dev branch pushes must use a distinct next dev prerelease version in
  `package.json` and `package-lock.json`, for example `1.6.7-dev.0`, so the
  in-app version never looks like the current beta or stable release.
- When work lands on `dev`, bump to the next intended app version with a `-dev.N`
  suffix before pushing, unless the user explicitly says not to change version
  metadata.
- Use beta versions like `1.6.2-beta.2`.
- Use main versions like `1.6.2`.
- If a release contains many user-facing features, consider a minor version bump.
- Small fixes can be patch bumps.

## Required Validation

Before pushing beta or main, run:

- `npm run check:i18n`
- `npm run build`
- `npm run lint`
- `npm run test:server`
- Any relevant script syntax check, for example `bash -n scripts/collect-proxmox.sh`

If any test cannot run, say why clearly.

## Changelog Expectations

Every beta or main push should update `CHANGELOG.md` with:

- Added
- Fixed
- Changed, when needed
- User-facing test notes, when useful

## Docker Pull Commands

For beta:

```bash
cd ~/Rackpad
sudo sed -i.bak 's/^RACKPAD_TAG=.*/RACKPAD_TAG=beta/' .env
sudo docker compose pull
sudo docker compose up -d
```

For main/latest:

```bash
cd ~/Rackpad
sudo sed -i.bak 's/^RACKPAD_TAG=.*/RACKPAD_TAG=latest/' .env
sudo docker compose pull
sudo docker compose up -d
```

## UI And UX Preferences

- Rackpad should look clean, professional, dense, and practical.
- Avoid marketing-style layouts.
- Prefer compact operational UI, clear tables, good spacing, strong dark mode, and readable controls.
- Visualizer and diagram work must be tested visually where possible.
- Labels must not truncate important device names unless there is a usable expanded or detail state.

## i18n Rules

- Keep English as the fallback language.
- New visible UI strings need translation keys.
- Run `npm run check:i18n`.
- Missing locale keys should fail or clearly fall back to English.

## Issue Areas To Treat Carefully

- IPAM, DHCP, gateway, and DNS logic must avoid duplicate or conflicting IP ownership.
- Discovery should distinguish new, imported, dismissed, technical, and reserved records correctly.
- Proxmox imports must not silently drop VMs or containers.
- Bulk operations should be atomic where possible.
- SNMP features must be secure, permission-aware, and documented.
- Lab permissions must prevent cross-lab data leaks.

## User Preferences

- The user prefers direct action and beta pushes when asked.
- The user dislikes repeated auth or token questions.
- The user wants concise status updates and practical test checklists.
- The user often asks for GitHub issue replies; keep them short and natural.
- The user wants broad issue review based on actual repo and GitHub state, not stale memory.
