# Tilia briefs

Twice a week, at 18:00 the evening before a post, a Slack message arrives with an interview-style writing brief. The same brief is added to that topic's page in Notion, with space under each question to write.

| Brief arrives | For | Length | Topics from |
| --- | --- | --- | --- |
| Monday 18:00 | Tuesday 08:45 post on your LinkedIn | 250–350 words | Your list, plus up to 3 researched ideas a week |
| Wednesday 18:00 | Thursday 13:45 post on the Tilia page | 120–180 words | Tilia feature list |

## How it works

1. A GitHub Action runs on schedule ([.github/workflows/briefs.yml](.github/workflows/briefs.yml)).
2. On Mondays, Claude searches the web for current product, UX and research debates and adds up to 3 ideas to Notion, each with a real source link.
3. Claude picks one idea with status **Idea** and writes a brief: an angle to react to, then 3–5 sections of questions with word targets.
4. The brief is appended to that idea's Notion page, its status becomes **Briefed**, and the brief is posted to Slack with a link.
5. You write in Notion, post on LinkedIn, then set the status to **Posted** (or **Dropped**).

Claude runs through Claude Code with your Pro subscription, not the API. Usage is shared with your normal Claude usage; a brief is a couple of prompts.

## Adding ideas

Add a row to the **Content ideas** database in Notion: a name, **Owner** (Personal or Tilia) and **Status** Idea. Notes are optional but help the brief.

## Setup (one-off)

1. **Slack.** Go to api.slack.com/apps → Create New App → From scratch, pick your workspace. Open **Incoming Webhooks**, turn it on, **Add New Webhook**, and choose a channel (for example a private `#briefs`). Copy the webhook URL. In the Slack app, set that channel's notifications to **All new messages**.
2. **Notion.** Go to notion.so/profile/integrations → New integration (internal) and copy the secret. Create a page (for example "Tilia content"), open its ••• menu → **Connections** and add the integration. Copy the page ID: the 32 characters at the end of the page URL.
3. **Create the database.** Copy `.env.example` to `.env`, fill in `NOTION_TOKEN` and `NOTION_PARENT_PAGE_ID`, then run `npm run setup:notion`. It creates the database, imports the GTM tracker topics, and prints `NOTION_DATABASE_ID`. Add that to `.env`.
4. **Claude token.** Run `claude setup-token` and copy the token it prints (valid for a year).
5. **GitHub secrets.**
   ```sh
   gh secret set CLAUDE_CODE_OAUTH_TOKEN
   gh secret set NOTION_TOKEN
   gh secret set NOTION_DATABASE_ID
   gh secret set SLACK_WEBHOOK_URL
   ```
6. **Test.** Actions → Weekly briefs → Run workflow, with dry run ticked: the brief appears in the log. Run it again unticked to send a real one.

## Running locally

```sh
npm run dry:personal   # print a brief, change nothing
npm run brief:tilia    # send a real Tilia brief now
npm test
```

Local runs use your normal `claude` login.

## Tuning

- [config/voice-guide.md](config/voice-guide.md): how posts should sound.
- [config/tilia.md](config/tilia.md): what briefs know about Tilia. Update it when you ship.
- [config/sources.md](config/sources.md): where research looks first.
- [config/channels.json](config/channels.json): days, times and word ranges. If you change a brief day, update the cron days in the workflow too.
- [prompts/](prompts/): the brief and research prompts.
