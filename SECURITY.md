# Security Policy

GLM Radar is a static GitHub Pages site. It has no public administration endpoint, database password, session cookie, or browser-side API credential.

Report security issues privately through the repository’s GitHub Security Advisory form. Do not include a live API key, token, or private upstream content in an Issue.

The only runtime secret is the project-scoped `OPENAI_API_KEY` used by the scheduled collection job. Rotate it immediately if it appears in logs, artifacts, commits, or an untrusted environment. GitHub’s job token is ephemeral and each job receives only its declared permissions.
