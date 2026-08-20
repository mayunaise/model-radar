# GLM Radar operations runbook

## Daily failure triage

1. Open the failed `Daily GLM Sync` run and identify whether failure happened in `collect` or `publish-data`.
2. Check the job summary and `data/meta.json`. Do not paste secret values, full prompts, or private organization data into an Issue.
3. If GitHub rate protection stopped the run, wait until the recorded reset time and manually rerun. Do not lower the safety threshold to force progress.
4. If the OpenAI daily budget or 120-item cap stopped summaries, leave records in the backlog and let the next scheduled/manual run continue. Do not enable a fallback model.
5. If the API reports permission, model allowlist, balance, or hard-limit errors, keep the circuit open and ask an authorized OpenAI Project administrator to inspect the project controls.
6. If schema validation fails, download the one-day artifact, reproduce with `npm run validate:data -- /path/to/artifact`, fix the normalizer or schema through a Pull Request, then rerun.

The published site remains on the last successful Pages artifact when collection or deployment fails.

## Backlog recovery

Confirm the underlying permission/budget/rate condition is healthy, then manually run `Daily GLM Sync`. The pipeline de-duplicates by GitHub `node_id` and content hash. Never delete the manifest just to replay work; that can duplicate events and summaries.

## Key rotation

1. Create a new key on the dedicated GLM Radar service account with only `api.responses.write`.
2. Replace `OPENAI_API_KEY` in GitHub Actions Secrets.
3. Manually run a dry or small sync and verify only the approved model is called.
4. Revoke the previous key.
5. If exposure is suspected, revoke first, inspect Actions artifacts/logs and Git history, then create the replacement.

An OpenAI administrator key must never enter GitHub Secrets.

## Data rollback

Use a reviewed revert commit on the `data` branch to restore known-good JSON; do not force-push. Run `npm run validate:data -- /path/to/data`, then trigger `Request Pages Rebuild`. Git history is the audit and recovery log.

## Capability evidence refresh

Open a Pull Request changing `config/capabilities.json`. Link the upstream documentation, merged PR, release note, or reproducible validation. Use `unknown` when evidence is insufficient. Automatic candidates under `data/candidates/capabilities.json` are review hints only.
