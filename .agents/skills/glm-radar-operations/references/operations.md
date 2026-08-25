# GLM Radar production operations

Use this reference only for GLM Radar data collection, GitHub Actions publication, Pages rebuilds, and recovery.

## 1. Authoritative data flow

```text
GitHub schedule or manual dispatch
  -> Daily GLM Sync / collect
     -> require refs/heads/main and enter the main-only production environment
     -> checkout main as source/
     -> checkout data as data/
     -> npm ci in source/
     -> GitHub REST incremental collection and resumable search backfill with github.token
     -> deterministic GLM relevance filter
     -> optional OpenAI structured summary with OPENAI_API_KEY
     -> write repository + original-created-month shards
     -> update manifest, events, daily report, candidates, search index, meta
     -> full relevance review of every daily increment, plus configured upstream source checks
     -> validate the complete data directory
     -> upload one-day artifact
  -> Daily GLM Sync / publish-data
     -> download the validated artifact
     -> commit only changed files to data
     -> dispatch data-updated
  -> Deploy GitHub Pages
     -> checkout main and data separately
     -> validate data from source
     -> build Astro with GLM_DATA_DIR=../data
     -> deploy the Pages artifact
```

The cron expression is `30 0 * * *`: approximately 08:30 Asia/Shanghai, with possible GitHub scheduling delay.

## 2. Read-only readiness audit

Run from the source checkout:

```bash
git status --short --branch
git remote -v
git branch -a --no-color
node --version
npm --version
npm test
npm run validate:data
npm run check
npm run build
```

Expected production baseline:

- Reviewed source is on `main`; do not publish an unreviewed dirty worktree.
- Node matches `.node-version` (`22.23.2`). A newer local Node passing tests is not equivalent to the pinned runtime.
- `origin` points to the intended GitHub Organization repository without embedded credentials.
- The four verification commands pass.
- The GitHub repository has Pages set to GitHub Actions, Actions write permission where organizational policy requires it, and protected `main`, `data`, and `github-pages` surfaces.
- The `production` Environment allows `main` only. `OPENAI_API_KEY` and any optional `GITCODE_TOKEN` exist only as environment secrets; no repository-level duplicates exist.
- `Daily GLM Sync / collect` has a `github.ref == 'refs/heads/main'` job guard and checks out source with `ref: main`. A manual dispatch from any other branch is skipped.

Local absence of `gh` does not block production because GitHub-hosted runners include it. Use the Actions UI unless the user explicitly authorizes installing or using a local CLI.

## 3. Tracked framework configuration

`config/repositories.json` is the authoritative registry. Change it only through a reviewed `main` Pull Request. There is no site administrator page.

### Add a framework

Add one repository object with:

- a stable public `slug` (`owner/repository`) and a unique lowercase `dataKey` used forever as the archive directory;
- an explicit `source.provider` (`github` or `gitcode`) and source `slug`; this is independently configurable for every repository;
- `canonicalSlug` only as legacy GitHub rename compatibility; prefer an explicit source slug for new changes;
- `historyStartAt` and `backfillPageLimit: 2` as retained legacy compatibility fields, plus framework display name, default branch, color, repository keywords, and `enabled: true`.

Never reuse a removed framework's `dataKey`. Keep the framework display name aligned with any entries retained or added in `config/capabilities.json`; new capability claims start as `unknown` until a maintainer verifies evidence.

Run `npm test`, `npm run validate:data`, `npm run check`, and `npm run build`. After the PR merges, the next production sync seeds the new incremental cursor and `searchBackfill` checkpoint. Inspect both in `data/manifest.json` before claiming the framework is fully tracked.

### Stop tracking without deleting history

Change only `enabled` to `false`. Do not delete the repository object, change its `slug` or `dataKey`, remove its item shards, or edit its manifest cursor/search-backfill checkpoint. Removing the object would make retained archives impossible to map back to their shard.

Changing `source` preserves the public `slug` and `dataKey`. The next sync detects the source fingerprint change, starts routine collection from the switch time, and resets bounded historical backfill for only that repository. Never reset manifest cursors manually.

After the change reaches production:

- upstream collection no longer calls that repository;
- public activity, reports, detail routes, metrics, filters, and capability rows no longer show it;
- `items/{dataKey}/`, events, summaries, manifest entries, search data, and backfill progress remain stored;
- `meta.json.repositories` reports `已停用，不再同步`.

### Resume tracking

Set the same object back to `enabled: true` without changing its stable identity fields. The next sync resumes from the retained cursor and backfill checkpoint. Validate the data artifact and Pages build before claiming visibility is restored.

## 4. First production `data` branch

Do not copy `fixtures/bootstrap-data`: normal synchronization merges by GitHub node ID and does not delete sample records.

First confirm that the remote branch does not already exist:

```bash
git ls-remote --exit-code --heads origin data
```

Exit 0 means `data` already exists: stop and inspect it. Exit 2 means it is absent.

If `.local-data/` already contains real collected data, preserve that work instead of starting another backfill. Before using it as the initial branch content, require all of the following:

```bash
npm run validate:data -- .local-data
npm run audit:data -- .local-data
```

Confirm `meta.sample` is `false`, `manifest.items` is non-empty, no manifest node ID begins with `SAMPLE_`, every enabled repository has an incremental cursor, and every completed history stream retains its `searchBackfill` checkpoint. `.local-data/` must remain Git-ignored on `main`; only its contents belong at the root of the separate `data` branch. This preserves the collected records and causes the first production sync to continue incrementally from the stored cursors.

Use the empty initializer below only when no validated real snapshot exists.

Create an empty temporary directory and initialize a clean schema-valid snapshot from the source checkout:

```bash
GLM_DATA_BOOTSTRAP="$(mktemp -d)"
node --import tsx .agents/skills/glm-radar-operations/scripts/initialize-production-data.ts --output "$GLM_DATA_BOOTSTRAP"
npm run validate:data -- "$GLM_DATA_BOOTSTRAP"
```

Inspect the paths before publishing:

```bash
find "$GLM_DATA_BOOTSTRAP" -maxdepth 3 -type f | sort
```

The root must contain `meta.json`, `manifest.json`, `schemas-version.json`, `search-index.json`, `candidates/capabilities.json`, plus tracked empty `items`, `events`, and `reports` directories. `meta.sample` must be `false`; items, reports, events, candidates, search index, and manifest items/cursors must be empty.

After the user explicitly authorizes creating and pushing the branch, initialize the selected data directory (`.local-data` after validation, otherwise `$GLM_DATA_BOOTSTRAP`) as its own checkout. Substitute the reviewed remote URL; do not include credentials. Never run this sequence against an existing remote `data` branch.

```bash
GLM_REMOTE_URL="https://github.com/ORG/REPO.git"
git -C "$GLM_DATA_BOOTSTRAP" init -b data
git -C "$GLM_DATA_BOOTSTRAP" config user.name "GLM Radar Maintainer"
git -C "$GLM_DATA_BOOTSTRAP" config user.email "maintainer@example.com"
git -C "$GLM_DATA_BOOTSTRAP" remote add origin "$GLM_REMOTE_URL"
git -C "$GLM_DATA_BOOTSTRAP" add .
git -C "$GLM_DATA_BOOTSTRAP" commit -m "data: initialize production snapshot"
git -C "$GLM_DATA_BOOTSTRAP" push origin data:data
```

Use the maintainer's verified no-reply GitHub email when privacy is required. Configure branch rules after the initial branch exists. Never overwrite an existing `data` branch with this procedure.

## 5. Credential and cost setup

- `GITHUB_TOKEN` in Actions is `${{ github.token }}`. Do not create a long-lived GitHub secret for the workflow unless private upstream access later requires a separately reviewed design.
- `GITCODE_TOKEN` is optional for public repositories. When configured for additional API stability, use a dedicated read-only Personal Access Token, send it only in an `Authorization: Bearer` header, and store it in the main-only `production` Environment. Never place it in a URL, workflow input, log, or generated JSON.
- `OPENAI_API_KEY` is a dedicated GLM Radar Project service-account key with only `api.responses.write`, stored in the main-only `production` Environment.
- The OpenAI Project allows only `gpt-5.6-luna`, enforces the RPM/TPM values mirrored in `config/openai.json`, and applies the documented USD 10 monthly platform limit. The local process does not implement RPM/TPM scheduling.
- The repository-side circuit breaker remains `config/openai.json`: at most 120 item reservations and USD 0.35 estimated spend per Beijing day with a 10% safety margin. `meta.json.ai` carries the current `budgetDate`, cumulative tokens, reservations, and estimated cost across same-day reruns.
- Require strict structured summary extraction as `problem`, `request`, or `change`, with nullable subject/problem/request/change/impact fields and source-labelled evidence. Validate the type-specific core field, compose a natural Chinese summary that is normally 80–300 characters and at most 2,000 Unicode characters, never cut a sentence or technical token in the middle, and avoid mechanical field labels in public text. Reuse a current-format AI summary unless the GitHub title or lifecycle state changes. A deliberate prompt-format version upgrade may enqueue one budgeted migration; body edits, label changes, comments, and timestamp-only updates must not. Items with no summary remain in the budgeted backlog.
- Spend the available summary budget on newly observed incremental records first, then unsummarized records already referenced by the current Beijing-day report, then the oldest historical backlog. This keeps the daily report summarized without abandoning history completion.
- Never configure `OPENAI_ADMIN_KEY` anywhere in the repository or Actions.

Add or rotate the key in GitHub's web Settings. Do not ask the user to paste a key into chat or a command.

## 6. Local real-data dry-run

Use this only to test upstream collection. It does not generate summaries without `OPENAI_API_KEY`, and that expected backlog is not a collector failure.

Clone the real `data` branch into a new temporary directory. Run all `npm` commands from the source checkout:

```bash
GLM_DATA_WORKTREE="$(mktemp -d)"
git clone --branch data --single-branch "$(git remote get-url origin)" "$GLM_DATA_WORKTREE"
npm run validate:data -- "$GLM_DATA_WORKTREE"
npm run sync -- --data-dir "$GLM_DATA_WORKTREE" --dry-run
npm run audit:data -- "$GLM_DATA_WORKTREE"
npm run validate:data -- "$GLM_DATA_WORKTREE"
```

The shell environment must already contain `GITHUB_TOKEN` for enabled GitHub sources. Public GitCode sources work anonymously; an optional read-only `GITCODE_TOKEN` improves API stability. Never print a token, place it on a command line, or read repository secrets back out of GitHub. Do not add `OPENAI_API_KEY` for a local dry-run unless the user separately authorizes the paid production-like call.

Expected output is one JSON object with `collected`, `published`, `backlogCount`, `rateLimitStop`, `summaryMode`, and `summaryStopReason`. Because `--dry-run` returns before writes, the final validation should match the starting snapshot.

## 7. First and routine production run

Use GitHub -> Actions -> `Daily GLM Sync` -> Run workflow. A local `gh workflow run` is acceptable only when `gh` is already installed, authenticated to the intended repository, and the user authorizes the dispatch.

Verify in order:

1. `collect` runs `npm run audit:data -- ../data`, writes `quality/YYYY/MM/DD.json`, then uploads `validated-glm-data`.
2. `publish-data` succeeds and creates or updates a `data: daily GLM sync` commit.
3. The `data-updated` repository dispatch starts `Deploy GitHub Pages`.
4. The Pages `build` validates the data branch and completes Astro build.
5. The Pages `deploy` job succeeds and reports the public URL.
6. The new `data/meta.json`, `manifest.json`, item shards, and `reports/YYYY/MM/DD.json` agree with the run.

The current pipeline does not update `meta.lastPublishedAt` during Pages deployment. Treat the successful Pages run and deployed artifact as publication proof, not that field alone.

### Daily quality audit

The audit resolves 当天日报中的全部增量 and reruns the deterministic GLM relevance filter and legal category checks for every item. GLM must appear directly in the title or substantive body; labels are corroborating metadata only and can never admit an item by themselves. It also compares title, state, update time, and original URL with GitHub using bounded concurrent requests, and detects stored rule classifications that drift from the current classifier. Historical backfill is excluded because it never enters the daily report. The audit does not call OpenAI.

结构错误或相关性排除会阻止发布. 分类和源数据差异产生复核警告, because those checks need maintainer judgment and must not turn a transient upstream change into data loss. A `review` relevance disposition remains visible in the report for maintainer follow-up; an `excluded` disposition blocks the artifact. Review warning entries in `quality/YYYY/MM/DD.json`; fix confirmed rule errors in source with tests, then rerun the complete workflow. Never edit the generated report to hide a warning.

### Explicit full summary and report backfill

Use this only after the user authorizes the paid maintenance run:

```bash
npm run sync:local -- --full-summary-backfill
```

This explicit mode bypasses the project's daily item and estimated-cost software gates, but not the configured model, API request timeout, provider rate limits, account balance, or provider hard limit. It keeps the cumulative token and estimated-cost ledger for auditability. Never place this flag in the scheduled GitHub Actions workflow.

Full maintenance mode permits up to three content-validation retries for a stubborn item; routine sync retains the configured single retry. Transport failures still open the circuit and stop later AI calls.

If a small residual backlog succeeds in isolated diagnostics but repeatedly fails through the local compatibility endpoint under concurrency, rerun only that residual set with `--full-summary-backfill --ai-concurrency 1`. The supported range is 1–3; do not raise it above the normal concurrency ceiling.

The same run creates missing historical daily reports from retained items' upstream `createdAt` Beijing date after summaries are processed. Existing report membership and creation timestamps are preserved while stale summary-completeness metadata is refreshed. This reconstructs daily Issue/PR creation activity only; it does not invent historical status-change events that are absent from the stored event log.

### Explicit single-repository source backfill

Use this only after the user authorizes an unbounded upstream scan and the associated summary cost:

```bash
npm run sync:local -- --repository Ascend/MindSpeed-LLM --full-source-backfill --full-summary-backfill
```

`--full-source-backfill` refuses to run without `--repository`. It completes all remaining Issue/PR history pages for only that enabled repository, while `--full-summary-backfill` removes local summary budget gates and refreshes missing historical reports. Other repositories retain their items, cursors, health timestamps, and backfill state. Never add either flag to a scheduled workflow.

## 8. Incremental versus historical data

- `manifest.cursors[repository]` tracks routine updated-since collection.
- `manifest.searchBackfill[repository]` tracks the active targeted history load independently as `issue` and `pr` streams. The `glm-title-v1` query searches explicit `GLM` mentions in titles; routine updated-since collection still catches relevant body changes, and the normal relevance filter remains authoritative.
- One run processes at most 10 search pages per repository. Issue/search pages come from REST, while all PR identities and merged states on one page are resolved by one compact GraphQL batch instead of one REST request per PR. Search, REST core, and GraphQL retain their own safety accounting; a fully processed page advances before a safety stop, while an interrupted PR batch remains unchanged for safe replay.
- `manifest.backfill[repository]`, `historyStartAt`, and `backfillPageLimit` are retained as legacy compatibility data and are not reset or deleted during migration.
- Historical records are filed at `items/{dataKey}/{createdAt year}/{createdAt month}.json`.
- Backfill expands “全部动态” but never enters the current daily report.
- Daily reports contain only incrementally observed new or meaningfully changed items for the Beijing date.

Never accelerate history by deleting the manifest, resetting `searchBackfill.nextPage`, or lowering either GitHub rate-limit stop.

## 9. Failure and recovery

| Symptom | Safe action |
| --- | --- |
| `collect` fails | Fix the credential, schema, rate, or budget condition; `data` remains unchanged; rerun |
| Quality audit structural/relevance failure | Fix the schema, category, or relevance rule in source or data; do not bypass the audit |
| Quality audit review warning | Inspect the source link and rule evidence; warnings do not block publication |
| `publish-data` fails | Inspect branch permissions and protection; rerun the full workflow rather than hand-copying the artifact |
| Pages build/deploy fails after good data | Run `Request Pages Rebuild`; this does not recollect or spend OpenAI budget |
| GitHub rate safety stop | Wait for reset, then rerun; an interrupted page and its incremental cursor remain unadvanced |
| OpenAI key missing/unavailable | The run continues in `github-only` mode; restore the environment secret or service and rerun later |
| OpenAI daily item/budget stop | Preserve collected GitHub data and wait for the next Beijing day; same-day reruns retain the cumulative ledger |
| Bad source/config | Revert through the protected `main` Pull Request flow |
| Bad data commit | Create a reviewed revert on `data`, validate it from the source checkout, then rebuild Pages |
| Sample IDs in production | Stop publication; clean or reinitialize before the first real run. Changing only `meta.sample` is insufficient |

For a data rollback, keep source and data checkouts separate:

```bash
git -C "$GLM_DATA_WORKTREE" log --oneline -10
git -C "$GLM_DATA_WORKTREE" revert BAD_COMMIT_SHA
npm run validate:data -- "$GLM_DATA_WORKTREE"
```

Push or merge the revert only after explicit authorization and according to `data` branch protection. Never force-push or delete the branch.

## 10. Completion evidence

Report the exact evidence available without exposing secrets:

- source commit/PR and passing CI;
- `data` branch commit SHA;
- Daily GLM Sync run status and URL or run identifier;
- Deploy GitHub Pages run status and published URL;
- `meta.lastSuccessfulSyncAt`, latest report date, item count, backlog count, and `searchBackfill` statuses;
- whether the site still contains any `SAMPLE_` node IDs.

If any evidence is unavailable, state that the pipeline is configured or validated locally, not live.
