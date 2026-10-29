# Tilia briefs

Twice a week, at 18:00 two days before a post, an interview-style writing brief is added to that topic's page in Notion, with space under each question to write, and a comment on the page @mentions you so Notion notifies your phone and email. From there, changing the page's status in Notion gets the post sub-edited, published to the site and cut down for LinkedIn.

| Brief arrives | For | Length | Topics from |
| --- | --- | --- | --- |
| Sunday 18:00 | Tuesday 08:45 post on your LinkedIn | 250–350 words | Your list, plus up to 3 researched ideas a week |
| Tuesday 18:00 | Thursday 13:45 post on the Tilia page | 120–180 words | Tilia feature list |

## How it works

1. A GitHub Action runs on schedule ([.github/workflows/briefs.yml](.github/workflows/briefs.yml)).
2. On Sundays, Claude searches the web for current product, UX and research debates and adds up to 3 ideas to Notion, each with a real source link.
3. Claude picks one idea with status **Idea** and writes a brief: an angle to react to, then 3–5 sections of questions with word targets.
4. The brief is appended to that idea's Notion page, its status becomes **Briefed**, and a comment @mentions you.
5. You write the post under **Finished post** on that page, then set the status to **Drafted**.
6. A second Action checks Notion every 30 minutes from about 07:00 to 23:00 UK time, every day ([.github/workflows/watch.yml](.github/workflows/watch.yml)). For a Drafted page, Claude sub-edits the post: one overall comment on the page and comments on individual paragraphs. It never edits your text. The status becomes **Reviewed** and a comment @mentions you.
7. You act on the comments you agree with. For a Tilia post, schedule it on LinkedIn and set the status to **Posted**. For a personal post, set it to **Ready**.
8. For a Ready page, the post is committed to the portfolio repo, which deploys the site. Once it's live, a **LinkedIn cut** is added under the post in Notion with a link to the full post, the status becomes **Published** and a comment @mentions you.
9. You schedule the cut on LinkedIn and set the status to **Posted** (or **Dropped** at any point).

| Status | Set by | Meaning |
| --- | --- | --- |
| Idea | You or research | Waiting to be picked |
| Briefed | Script | Brief sent; write the post |
| Drafted | You | Ask for a sub-edit |
| Reviewed | Script | Comments are on the page |
| Ready | You | Personal posts only: publish to the site |
| Published | Script | Live on the site, LinkedIn cut written |
| Posted | You | Scheduled on LinkedIn; done |

Expect up to 30 minutes between changing a status and something happening, often more: GitHub runs scheduled jobs late, and sometimes hours late, when it's busy. Overnight the watcher doesn't run. To skip the wait, go to Actions → Watch Notion → Run workflow, or run `gh workflow run watch.yml`. If a step fails, a comment on the page says why and the status goes back to the one before, so setting it again retries. If a whole run crashes (Notion down, a column renamed), a comment on the **Tilia Briefs** page says so, once every 12 hours at most.

Notifications are Notion comments that @mention you. Check that Notion's mobile app has push notifications on and that **Settings → Notifications → Email** includes mentions. Slack is optional: if `SLACK_WEBHOOK_URL` is set, messages go there too.

The LinkedIn cut is a teaser of 150 to 200 words made only by removing text from your post. The script checks every word against the post and saves your original characters, so a cut with rewritten text is rejected. The site description and tags (three at most) are the only words Claude writes; edit them in the portfolio repo if you want to.

Claude runs through Claude Code with your Pro subscription, not the API. Usage is shared with your normal Claude usage; a brief is a couple of prompts, a sub-edit or a publish is one each.

## Adding ideas

Add a row to the **Content ideas** database in Notion: a name, **Owner** (Personal or Tilia) and **Status** Idea. Notes are optional but help the brief.

## Setup (one-off)

1. **Your Notion user ID.** This is who the notification comments @mention. Get it from `GET https://api.notion.com/v1/users` with the integration token (step 2), or ask Claude to look it up through the Notion connector. Optionally, also create a Slack incoming webhook if you want messages there too.
2. **Notion.** Go to notion.so/profile/integrations → New integration (internal) and copy the secret. Under **Capabilities**, tick **Read comments** and **Insert comments**, so the sub-editor can comment and alerts aren't repeated. Create a page (for example "Tilia content"), open its ••• menu → **Connections** and add the integration. Copy the page ID: the 32 characters at the end of the page URL.
3. **Create the database.** Copy `.env.example` to `.env`, fill in `NOTION_TOKEN` and `NOTION_PARENT_PAGE_ID`, then run `npm run setup:notion`. It creates the database, imports the GTM tracker topics, and prints `NOTION_DATABASE_ID`. Add that to `.env`.
4. **Claude token.** Run `claude setup-token` and copy the token it prints (valid for a year).
5. **Portfolio token.** Go to github.com/settings/personal-access-tokens → Generate new token (fine-grained). Give it access to the `portfolio` repository only, with **Contents: Read and write**. This is what publishes posts to the site.
6. **GitHub secrets.**
   ```sh
   gh secret set CLAUDE_CODE_OAUTH_TOKEN
   gh secret set NOTION_TOKEN
   gh secret set NOTION_DATABASE_ID
   gh secret set NOTION_USER_ID
   gh secret set SLACK_WEBHOOK_URL   # optional
   gh secret set PORTFOLIO_TOKEN
   ```
7. **Test.** Actions → Weekly briefs → Run workflow, with dry run ticked: the brief appears in the log. Run it again unticked to send a real one.

The repo is public, so Action logs are too. GitHub also pauses scheduled workflows in a public repo after 60 days without a commit; it emails first, and one click turns them back on.

## Running locally

```sh
npm run dry:personal   # print a brief, change nothing
npm run brief:tilia    # send a real Tilia brief now
npm run dry:watch      # print the sub-edit or publish for any Drafted or Ready page, change nothing
npm run watch          # do it for real
npm test
```

To try a step on one page whatever its status, pass the page ID: `npm run dry:watch -- --review <pageId>` or `--publish <pageId>`.

Local runs use your normal `claude` login.

## Tuning

- [config/voice-guide.md](config/voice-guide.md): how posts should sound.
- [config/tilia.md](config/tilia.md): what briefs know about Tilia. Update it when you ship.
- [config/sources.md](config/sources.md): where research looks first.
- [config/channels.json](config/channels.json): days, times and word ranges, plus the LinkedIn cut length and site repo for personal posts. If you change a brief day, update the cron days in both workflows too.
- [prompts/](prompts/): the brief, research, sub-edit and LinkedIn cut prompts.
