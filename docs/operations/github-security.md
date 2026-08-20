# GitHub identity and repository security

GLM Radar uses GitHub identity instead of a site administrator password.

Before enabling production workflows:

1. Transfer or create the repository inside the intended GitHub Organization.
2. Replace `@wayne` in `.github/CODEOWNERS` if the actual owner or maintainer team uses a different handle.
3. Require passkeys or phishing-resistant 2FA for maintainers and prohibit shared accounts.
4. Protect `main`: require a pull request, one approving CODEOWNER review, successful `CI / verify`, resolved conversations, and blocked force-push/deletion.
5. Protect `data`: permit the Daily GLM Sync workflow and named maintainers only; block force-push/deletion.
6. Protect the `github-pages` environment and restrict deployments to `main`.
7. Enable secret scanning, push protection, Dependabot alerts, and private vulnerability reporting.
8. Do not create a long-lived personal access token. The workflows use GitHub’s ephemeral job token with job-scoped permissions.

The `data` branch must exist before the first scheduled sync. Bootstrap it by copying the contents of `fixtures/bootstrap-data/` to the root of an orphan `data` branch, reviewing the files, and pushing that branch once.
