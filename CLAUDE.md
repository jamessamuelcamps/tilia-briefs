# Tilia briefs

Weekly interview-style writing briefs for James: Claude picks a topic from a Notion database (and researches new ones), writes a brief, appends it to the Notion page and posts it to Slack. See README.md for the flow and setup.

- Node 22.9+, ES modules, no dependencies. Notion and Slack are called with `fetch`; Claude runs via the `claude` CLI in print mode (`scripts/lib/claude.mjs`) so it uses James's subscription, not the API.
- Every Claude reply is JSON validated in `scripts/lib/brief.mjs` before anything is written. Add or adjust tests in `test/` when changing the brief shape.
- Briefs ask questions; they never write post copy. Keep that rule in `prompts/brief.md`.
- Secrets live in `.env` locally and GitHub secrets in CI. Never commit them.
- Run `npm test` and a dry run (`npm run dry:personal`) after changing prompts or validation.
