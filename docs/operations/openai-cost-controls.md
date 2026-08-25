# OpenAI permission and cost controls

Create a dedicated OpenAI Project and service account for GLM Radar. Do not reuse a personal key or a key from another application.

Configure the service account and key with only `api.responses.write`. Do not grant `member`, `owner`, Admin API, project-management, key-management, user-management, or billing permissions. Allow only `gpt-5.6-luna` and disable Web Search, File Search, MCP, Code Interpreter, Hosted Shell, image generation, and every other hosted tool.

Store the project key as `OPENAI_API_KEY` in the `production` GitHub Environment, restricted to `main`. Do not keep a repository-level duplicate. Never add an OpenAI administrator key. Rotate the key periodically and after any suspected exposure. Migrate to GitHub OIDC workload identity federation and short-lived OpenAI credentials when the account supports it.

Set these project controls:

- Monthly hard limit: USD 10.
- Alerts: USD 5, USD 8, and USD 9.50.
- Requests per minute: 30.
- Tokens per minute: 150,000.

The repository adds a second software boundary: only `gpt-5.6-luna`, no tools, `store: false`, at most 120 item reservations per Beijing calendar day, USD 0.35 daily estimated spend including a 10% safety margin, and one retry. `data/meta.json.ai` persists `budgetDate`, cumulative usage, and conservative estimated spend so manual reruns on the same day cannot reset the limit; a new Beijing day starts a fresh ledger. It never falls back to a different model. Backlogged records remain in public GitHub metadata and are retried after the limiting condition clears.

The `rpm` and `tpm` values in `config/openai.json` mirror required OpenAI Project controls for auditability; the platform, not the Node.js process, enforces those rate ceilings. A 429 response is retried once and then opens the local circuit for the rest of that sync run.

The strict structured output classifies each record as `problem`, `request`, or `change`, then extracts nullable subject, problem, request, change, impact, and source-labelled evidence fields. The application validates the type-specific required field and composes a natural Chinese summary, normally 80–300 characters and never more than 2,000 Unicode characters. It removes only complete optional clauses when necessary and never cuts a sentence or technical token in the middle. An existing current-format summary is regenerated only when the upstream title or lifecycle state changes (`open`, `closed`, or `merged`). A deliberate prompt-format version upgrade may enqueue a one-time budgeted migration; body edits, label changes, comments, and timestamp-only updates do not. Records that have never received a summary remain eligible for the daily backlog budget.
