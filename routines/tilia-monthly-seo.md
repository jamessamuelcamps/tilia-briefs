# Tilia: monthly SEO page and template

Once a month you open two pull requests for James to review: one new search page on tilialabs.io in `tilia-labs/tilia`, and one new public template in `tilia-labs/ux-research-templates`. Then you record both in the Notion database "Tilia GTM", along with a LinkedIn post announcing the template. You never merge, deploy, post or contact anyone.

## Read first

- `tilia/CLAUDE.md`, especially "Git workflow" and "Copy", and `tilia/client/CLAUDE.md`, especially "Prerendered marketing pages", "Method guides" and "Competitor comparison pages". Follow them exactly: they're how pages ship without breaking.
- `tilia/docs/done/seo-pages-design.md`, `tilia/docs/pricing.md`, `tilia/docs/roadmap.md`.
- `ux-research-templates/README.md`, `ux-research-templates/docs/markdown-format.md` and the existing files in `ux-research-templates/templates/`.

House rules: British English. **No em dashes** in any copy (`npm run check:copy` enforces it). Short, plain sentences. Every claim about tilia must be true to the code and docs. tilia's own prices come from code, never typed into copy. Anything about a competitor lives only in `client/src/data/competitors.js` with an official source. No feature tables.

## 1. One search page (tilia-labs/tilia)

Pick **one** page that doesn't exist yet and that a founder, PM or solo researcher would search for. Check `client/src/entry-server.jsx` routes and open PRs (`gh pr list`) so you don't duplicate one. Good candidates, roughly in order:
- "Free tree testing tool", "free card sorting tool", "free first-click testing": what the method is for, what free covers in tilia, and how to start.
- "How many participants for a tree test" (or card sort): a plain answer with the reasoning, and links to the method guide.
- A glossary entry for one IA or research term (information scent, findability, closed vs open sort), if there's a pattern for it.
- "Alternatives to <competitor>", only as an extension of the existing compare page pattern, never with facts outside `competitors.js`.

Build it the way existing marketing pages are built (route in `entry-server.jsx` with its `file`, `PUBLIC_PATHS`, a `robots.txt` Allow line, a page title like `Page | tilia`, and a meta description). Prefer extending an existing data-driven template, such as `methodPages.js`, over a new one-off component. Keep it short: show, then tell.

Then:
1. Branch `feat/seo-<slug>` from `main`.
2. Install dependencies as needed, and run `npm test --prefix client`, `npm run check:copy` and `npm run build --prefix client`. Fix any failure.
3. Commit (author `hello@james-sc.co.uk`, message ending `Co-Authored-By: Claude <noreply@anthropic.com>`), push, and open a PR with `gh pr create`. Title: a plain line a user would understand. Don't add the `changelog` label. In the body, say who the page is for, what search it targets, every factual claim with the file it comes from, and what to check before merging.

## 2. One template (tilia-labs/ux-research-templates)

Add **one** new template that people would use as is. Pick a domain or structure not already covered (e.g. an e-commerce category tree, a SaaS settings menu, a charity website, a hospital or GP practice site, or an open card sort for a news site). Follow `docs/markdown-format.md` exactly and match the style of the existing templates. If `tilia` is cloned next to it, run `npm run check:templates --prefix tilia -- ../ux-research-templates` (or from the tilia folder, `npm run check:templates`) and fix any problem. List the new template in the README the same way as the others. Don't edit `CHANGELOG.md`.

Branch `feat/template-<slug>`, commit as above, push, and open a PR describing who it's for, the realistic tasks it includes, and how it was checked.

## 3. Record it in Notion

In "Tilia GTM" (`collection://d3104d2a-56d7-4ead-b25c-96feaa91ab98`; fetch it first for the schema), create three rows, each with Status `Needs approval` and Week set to the Monday of this week:
- Type `SEO page`, Channel `tilialabs.io`. Name: the page title. Target URL: the PR link. Body: what to check before merging.
- Type `Template`, Channel `GitHub`. Name: the template name. Target URL: the PR link. Body: as above.
- Type `LinkedIn post`, Channel `Tilia LinkedIn`. Name: "Template drop: <template name>". Due: a week from today. Body: two lines saying it should only be approved after the template PR is merged, then a heading 2 titled exactly `Draft`, then a post of 80 to 150 words with the template's GitHub link (`https://github.com/tilia-labs/ux-research-templates/blob/main/templates/...`). Then a divider.

Add a page comment on the LinkedIn post row mentioning James (`user://782c3151-92a2-4129-a28f-710dc5c42ad7`), saying both PRs are ready to review, with their links.

## Finish

End with a short summary: both PR links, what each adds, and anything that needs James's decision. If something fails and can't be fixed, still open what you can, and explain the rest in the summary and in the Notion comment.
