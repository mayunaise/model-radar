# GitHub identity and repository security

GLM Radar uses GitHub identity instead of a site administrator password.

Before enabling production workflows:

1. Transfer or create the repository inside the intended GitHub Organization.
2. Replace `@wayne` in `.github/CODEOWNERS` if the actual owner or maintainer team uses a different handle.
3. Require passkeys or phishing-resistant 2FA for maintainers and prohibit shared accounts.
4. Protect `main`: require a pull request, one approving CODEOWNER review, successful `CI / verify`, resolved conversations, and blocked force-push/deletion.
5. Protect `data`: permit the Daily GLM Sync workflow and named maintainers only; block force-push/deletion.
6. Protect the `github-pages` environment and restrict deployments to `main`.
7. Create a separate `production` environment, restrict its deployment branches to `main`, and store `OPENAI_API_KEY` there as an environment secret. Remove any repository-level duplicate.
8. Confirm `Daily GLM Sync / collect` has both a `github.ref == 'refs/heads/main'` job guard and an explicit `ref: main` source checkout. Manual runs from other branches must be skipped before secrets are exposed.
9. Enable secret scanning, push protection, Dependabot alerts, and private vulnerability reporting.
10. Do not create a long-lived personal access token. The workflows use GitHub’s ephemeral job token with job-scoped permissions.

The `data` branch must exist before the first scheduled sync. Follow the repository's `.agents/skills/glm-radar-operations/SKILL.md` procedure to generate a clean, schema-valid production snapshot in an empty directory, validate it from the source checkout, and push it once. Never copy `fixtures/bootstrap-data/` into production because sample node IDs survive normal synchronization merges.
