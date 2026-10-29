// Tells James something happened. The main route is a Notion comment that @mentions him, which Notion
// sends to his phone and email. Slack is an optional extra, used only while SLACK_WEBHOOK_URL is set.
import { addComment, hubPageId, listComments } from './notion.mjs';
import { escapeSlack, postToSlack } from './slack.mjs';

// The same crash alert isn't repeated within this window, so a broken run every 30 minutes stays one message.
const REPEAT_AFTER_HOURS = 12;

const plain = (content, extra = {}) => ({ type: 'text', text: { content: String(content).slice(0, 2000), ...extra } });

/**
 * A message is { title, lines?, link? } with link { url, label }.
 * The comment starts with the mention so the notification preview reads "James ... <title>".
 */
export function toCommentRichText({ title, lines = [], link }, userId) {
  const parts = [];
  if (userId) parts.push({ type: 'mention', mention: { type: 'user', user: { id: userId } } }, plain(' '));
  parts.push({ ...plain(title), annotations: { bold: true } });
  for (const line of lines) parts.push(plain(`\n${line}`));
  if (link) parts.push(plain('\n'), plain(link.label, { link: { url: link.url } }));
  return parts;
}

export function toSlackText({ title, lines = [], link }) {
  return [`*${escapeSlack(title)}*`, ...lines.map(escapeSlack), ...(link ? [`<${link.url}|${escapeSlack(link.label)}>`] : [])].join('\n');
}

const commentText = (comment) => comment.rich_text.map((t) => t.plain_text).join('');

/** True if a comment with the same title went up recently, so a repeated failure isn't announced again. */
export function isRepeat(comments, title, now = Date.now()) {
  const since = now - REPEAT_AFTER_HOURS * 60 * 60 * 1000;
  return comments.some((c) => Date.parse(c.created_time) >= since && commentText(c).includes(title));
}

/**
 * Notifies on a page, or on the Tilia Briefs page above the database when pageId is null (for crashes).
 * Throws only if every route failed.
 */
export async function notify(pageId, message, { dedupe = false } = {}) {
  const userId = process.env.NOTION_USER_ID;
  if (!userId) console.warn('NOTION_USER_ID is not set, so the comment will not mention you or send a notification.');
  const errors = [];
  let sent = false;

  try {
    const target = pageId ?? (await hubPageId());
    if (dedupe && isRepeat(await listComments(target), message.title)) {
      console.log(`Already told you "${message.title}" in the last ${REPEAT_AFTER_HOURS} hours; not repeating it.`);
      return;
    }
    await addComment({ page_id: target }, toCommentRichText(message, userId));
    sent = true;
  } catch (error) {
    errors.push(error);
  }

  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      await postToSlack(toSlackText(message));
      sent = true;
    } catch (error) {
      errors.push(error);
    }
  }

  for (const error of errors) console.error(`Notification failed: ${error.message}`);
  if (!sent) throw errors[0] ?? new Error('No notification route is set up');
}

/** The Actions run, for crash messages. Null locally. */
export function runLink() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_RUN_ID) return null;
  return { url: `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`, label: 'See the run log' };
}
