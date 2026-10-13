# Tilia briefs

Weekly interview-style writing briefs for James: Claude picks a topic from a Notion database (and researches new ones), writes a brief, appends it to the Notion page and posts it to Slack. After that, status changes in Notion drive the rest (`scripts/watch.mjs`, polled by `.github/workflows/watch.yml`): Drafted gets a sub-edit as Notion comments, Ready publishes the post to the portfolio repo and writes the LinkedIn cut. See README.md for the flow and setup.

- Node 22.9+, ES modules, no dependencies. Notion and Slack are called with `fetch`; Claude runs via the `claude` CLI in print mode (`scripts/lib/claude.mjs`) so it uses James's subscription, not the API.
- Every Claude reply is JSON validated in `scripts/lib/brief.mjs` before anything is written. Add or adjust tests in `test/` when changing the brief shape.
- Briefs ask questions; they never write post copy. Keep that rule in `prompts/brief.md`.
- The same goes for the later steps: the sub-editor only comments, and the LinkedIn cut only removes text (`restoreCut` in `scripts/lib/post.mjs` enforces it). The site description and tags are the only copy Claude writes.
- The repo and its Action logs are public. Don't log draft text in CI.
- Secrets live in `.env` locally and GitHub secrets in CI. Never commit them.
- Run `npm test` and a dry run (`npm run dry:personal`, or `npm run dry:watch -- --review <pageId>` / `--publish <pageId>`) after changing prompts or validation.
