# GLM Radar operations runbook

## Daily failure triage

1. Open the failed `Daily GLM Sync` run and identify whether failure happened in `collect` or `publish-data`.
2. Check the job summary and `data/meta.json`. Do not paste secret values, full prompts, or private organization data into an Issue.
3. If GitHub rate protection stopped the run, wait until the recorded reset time and manually rerun. Do not lower the safety threshold to force progress.
4. If the OpenAI daily budget or 120-item cap stopped summaries, leave records in the backlog until the next Beijing day. Same-day scheduled or manual reruns retain the cumulative ledger and cannot reset the limit. Do not enable a fallback model.
5. If the API reports permission, model allowlist, balance, or hard-limit errors, keep the circuit open and ask an authorized OpenAI Project administrator to inspect the project controls.
6. If schema validation fails, download the one-day artifact, reproduce with `npm run validate:data -- /path/to/artifact`, fix the normalizer or schema through a Pull Request, then rerun.
7. Inspect `quality/YYYY/MM/DD.json` when the daily quality audit fails or warns. The audit rechecks GLM relevance for every item in that day's report and verifies the configured GitHub or GitCode source with bounded concurrent requests. Structural failures and relevance exclusions block publication; classification or source drift requires review but does not block it.

The published site remains on the last successful Pages artifact when collection or deployment fails.

## Backlog recovery

Confirm the underlying permission/budget/rate condition is healthy, then manually run `Daily GLM Sync`. The pipeline de-duplicates by GitHub `node_id` and content hash. Never delete the manifest just to replay work; that can duplicate events and summaries.

For a first paid connectivity check against an isolated local data checkout, add `--max-ai-items 1`. This per-run limit can only be set between 1 and the configured daily item limit, so it cannot raise the 120-item or USD 0.35 Beijing-day circuit breakers. Verify one stored structured summary and the `meta.json.ai` token/cost ledger before allowing a normal production run.

For an explicitly authorized maintenance repair that must finish the complete summary backlog and reconstruct missing creation-day reports, run `npm run sync:local -- --full-summary-backfill`. This bypasses the local software budget gates and can incur substantially higher cost; provider hard limits still apply. Do not add the flag to the scheduled workflow. Existing reports are preserved, and missing reports are reconstructed from each retained item's upstream creation date rather than guessed historical state changes.

## Historical backfill

Each repository stores the active checkpoint under `manifest.json.searchBackfill[repository]`. The checkpoint records the current `issue` or `pr` search stream and its next page. The `glm-title-v1` query finds explicit `GLM` mentions in titles, while routine updated-since collection still catches relevant body changes; the normal deterministic relevance filter decides what is published. Each run processes at most ten targeted pages per repository; manually rerun `Daily GLM Sync` only when rate protection leaves a checkpoint incomplete.

GitHub Search, REST core, and GraphQL use separate rate-limit buckets. The collector obtains the Issue/PR wrappers through REST, then resolves every PR identity and merged state on that page in one compact GraphQL batch; it does not issue one REST detail request per PR. The pipeline protects each relevant safety floor. If a batch is interrupted, the page remains unadvanced; a fully processed page advances before the run stops. Wait for reset and rerun; replayed records are de-duplicated by node ID.

Backfilled records are written to `items/{repository-key}/{createdAt year}/{createdAt month}.json`. They expand the complete activity archive but never enter a daily report. The legacy `manifest.backfill` checkpoint remains stored for compatibility but is not advanced by the search bootstrap. Do not reset either checkpoint or delete the manifest to accelerate recovery.

## Key rotation

1. Confirm the GitHub `production` Environment permits `main` only and that no repository-level `OPENAI_API_KEY` exists.
2. Create a new key on the dedicated GLM Radar service account with only `api.responses.write`.
3. Replace `OPENAI_API_KEY` in the `production` Environment secrets.
4. Manually run a dry or small sync from `main` and verify only the approved model is called. A dispatch from another branch must skip `collect`.
5. Revoke the previous key.
6. If exposure is suspected, revoke first, inspect Actions artifacts/logs and Git history, then create the replacement.

An OpenAI administrator key must never enter GitHub Secrets.

## Data rollback

Use a reviewed revert commit on the `data` branch to restore known-good JSON; do not force-push. Run `npm run validate:data -- /path/to/data`, then trigger `Request Pages Rebuild`. Git history is the audit and recovery log.

## Capability evidence refresh

Open a Pull Request changing `config/capabilities.json`. Link the upstream documentation, merged PR, release note, or reproducible validation. Use `unknown` when evidence is insufficient. Automatic candidates under `data/candidates/capabilities.json` are review hints only.
