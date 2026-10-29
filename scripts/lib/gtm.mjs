// Tilia GTM: Claude drafts rows in the Tilia GTM database every Monday (routines/tilia-weekly-gtm.md).
// This is the only part that runs here: an Approved LinkedIn post is added to the Tilia page's Buffer queue.
import { addToQueue } from './buffer.mjs';
import { listBlocks, queryGtm, setStatus } from './notion.mjs';
import { notify } from './notify.mjs';
import { extractPost, linkedInText } from './post.mjs';

export const DRAFT_HEADING = 'Draft';
const LINKEDIN_LIMIT = 3000;

/** The post text under "Draft", ready for LinkedIn. Throws if it's missing or too long. */
export function draftText(blocks) {
  const text = linkedInText(extractPost(blocks, DRAFT_HEADING));
  if (text.length > LINKEDIN_LIMIT) throw new Error(`The draft is ${text.length} characters; LinkedIn allows ${LINKEDIN_LIMIT}`);
  return text;
}

/** Approved Tilia LinkedIn posts, for the cheap check step. Empty if the GTM database or Buffer isn't set up. */
export async function approvedPosts() {
  const { NOTION_GTM_DATABASE_ID, BUFFER_API_KEY, BUFFER_CHANNEL_ID } = process.env;
  if (!NOTION_GTM_DATABASE_ID || !BUFFER_API_KEY || !BUFFER_CHANNEL_ID) return [];
  const approved = await queryGtm({ type: 'LinkedIn post', status: 'Approved' });
  return approved.filter((item) => !item.channel || item.channel === 'Tilia LinkedIn');
}

/** Queues each approved post in Buffer. A failure goes back to Needs approval with a comment saying why. */
export async function queueApprovedPosts({ dryRun = false } = {}) {
  const posts = await approvedPosts();
  for (const item of posts) {
    try {
      const text = draftText(await listBlocks(item.id));
      if (dryRun) {
        console.log(`\n--- Would queue "${item.title}" in Buffer (dry run) ---\n\n${text}\n`);
        continue;
      }
      await addToQueue({ channelId: process.env.BUFFER_CHANNEL_ID, text });
      await setStatus(item.id, 'Scheduled');
      await notify(item.id, {
        title: `Queued in Buffer: ${item.title}`,
        lines: ["It's at the end of the Tilia page's queue. Change the time or the text in Buffer if you need to."],
      });
      console.log(`Queued "${item.title}" in Buffer.`);
    } catch (error) {
      console.error(`Couldn't queue "${item.title}": ${error.message}`);
      process.exitCode = 1;
      if (dryRun) continue;
      await setStatus(item.id, 'Needs approval');
      await notify(item.id, {
        title: `Couldn't queue "${item.title}" in Buffer`,
        lines: [error.message, "I've set it back to Needs approval, so approving it again retries."],
      });
    }
  }
  return posts.length;
}
