---
name: glm-radar-operations
description: Use when bringing GLM Radar's GitHub Actions data pipeline online, explaining or running daily collection and historical backfill, validating the data branch, rebuilding GitHub Pages, or recovering a failed production data update. Do not use for ordinary UI changes.
---

# GLM Radar Operations

Operate the repository as two separate surfaces: the source checkout executes code from `main`; a separate `data` checkout stores generated JSON. Production collection and publication run through GitHub Actions.

## Start Here

1. Resolve the repository root and inspect the current versions of `.github/workflows/daily-sync.yml`, `.github/workflows/deploy-pages.yml`, `config/repositories.json`, `config/openai.json`, and `docs/operations/runbook.md`.
2. Classify the request as audit, first deployment, local dry-run, routine operation, backfill, Pages rebuild, or recovery.
3. Read [references/operations.md](references/operations.md) for the matching procedure before suggesting or executing commands.
4. Report blockers before mutations. Obtain explicit authorization immediately before a push, workflow dispatch, secret change, branch creation, revert, or production-cost API call.

## Non-Negotiable Boundaries

- Never bootstrap production by copying `fixtures/bootstrap-data`; sample node IDs survive normal merging even after `meta.sample` becomes `false`.
- Create the initial production snapshot with `scripts/initialize-production-data.ts`, or seed it from an existing validated `.local-data` snapshot when preserving already collected real data. Never use fixtures.
- Never run `npm` commands from the `data` branch. It intentionally has no `package.json`.
- Never print, log, commit, echo, or place a credential in a URL, command argument, workflow input, Issue, artifact, or generated JSON.
- Store `OPENAI_API_KEY` and any optional `GITCODE_TOKEN` only as secrets in the `production` GitHub Environment, whose deployment branch rule allows `main` only. Never duplicate them as repository secrets. A configured `GITCODE_TOKEN` must be read-only; public GitCode repositories can be collected anonymously. Never use an OpenAI administrator key. GitHub Actions uses its short-lived `${{ github.token }}`.
- Production collection must run reviewed code from `main`. Keep the job-level `github.ref == 'refs/heads/main'` guard and the source checkout's explicit `ref: main`; a manual dispatch from another branch must remain skipped.
- Do not delete or reset `manifest.json`, its incremental cursors, search-backfill checkpoints, or legacy backfill records. Never force-push `main` or `data`.
- A dry-run may read real upstream data but must use `--dry-run`; a normal local sync must target an isolated data checkout, never fixtures.
- Do not claim publication from file timestamps alone. Require a successful sync run, a validated `data` commit, and a successful Pages deployment run.
- Never add `--full-summary-backfill` or `--full-source-backfill` to the scheduled workflow. Full source backfill additionally requires an explicit `--repository`; these maintenance modes require explicit authorization for each paid or unbounded run, and provider hard limits still apply.

## Response Contract

Lead with the current outcome or blocker. Then provide the exact next safe command or GitHub UI action, its expected success signal, and the next verification. Distinguish read-only checks from writes and paid OpenAI calls.

## Quick Reference

| Goal | Authoritative action |
| --- | --- |
| First production data | Validate and publish the existing real `.local-data` snapshot, or initialize an empty snapshot when none exists |
| Test collection | Run `npm run sync -- --data-dir <data-checkout> --dry-run` from source |
| Daily production update | Run `Daily GLM Sync` in GitHub Actions |
| Full summary/report repair | After explicit cost authorization, run `npm run sync:local -- --full-summary-backfill` against the intended persistent data checkout |
| Full one-source data repair | After explicit authorization, run `npm run sync:local -- --repository owner/repository --full-source-backfill --full-summary-backfill` |
| Audit collection quality | Run `npm run audit:data -- <data-checkout>`; confirm every daily increment appears in `quality/YYYY/MM/DD.json` |
| Add a tracked framework | Add a unique enabled entry with an explicit GitHub or GitCode source to `config/repositories.json` through a reviewed PR |
| Stop tracking a framework | Set its existing entry to `enabled: false`; never delete its config or data |
| Resume tracking | Set the same entry back to `enabled: true`, preserving `slug` and `dataKey` |
| Rebuild without collection | Run `Request Pages Rebuild` |
| Check history progress | Inspect `data/manifest.json.searchBackfill`; all enabled repositories should reach `complete` |
| Recover bad data | Revert the bad `data` commit, validate from source, rebuild Pages |
