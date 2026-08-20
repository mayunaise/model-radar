# OpenAI permission and cost controls

Create a dedicated OpenAI Project and service account for GLM Radar. Do not reuse a personal key or a key from another application.

Configure the service account and key with only `api.responses.write`. Do not grant `member`, `owner`, Admin API, project-management, key-management, user-management, or billing permissions. Allow only `gpt-5.6-luna` and disable Web Search, File Search, MCP, Code Interpreter, Hosted Shell, image generation, and every other hosted tool.

Store the project key as the GitHub Actions secret `OPENAI_API_KEY`. Never add an OpenAI administrator key. Rotate the key periodically and after any suspected exposure. Migrate to GitHub OIDC workload identity federation and short-lived OpenAI credentials when the account supports it.

Set these project controls:

- Monthly hard limit: USD 10.
- Alerts: USD 5, USD 8, and USD 9.50.
- Requests per minute: 30.
- Tokens per minute: 150,000.

The repository adds a second software boundary: only `gpt-5.6-luna`, no tools, `store: false`, at most 120 item summaries per Beijing calendar day, USD 0.35 daily estimated spend including a 10% safety margin, and one retry. It never falls back to a different model. Backlogged records remain in public GitHub metadata and are retried by a later approved run.
