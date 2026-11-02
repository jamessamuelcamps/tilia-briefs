// Tilia GTM: Claude drafts rows in the Tilia GTM database every Monday (routines/tilia-weekly-gtm.md).
// This is the only part that runs here: drafts get their image card, and an Approved LinkedIn post is added to
// the Tilia page's Buffer queue.
import { mkdir, writeFile } from 'node:fs/promises';
import { addToQueue } from './buffer.mjs';
import { FAILED_NOTE, imageSection, parseSpec, renderCard } from './card.mjs';
import { requireEnv } from './env.mjs';
import { appendBlocks, imageBlock, imageUrl, listBlocks, queryGtm, setStatus, uploadFile } from './notion.mjs';
import { notify } from './notify.mjs';
import { extractPost, linkedInText, slugify } from './post.mjs';
import { commitFile } from './site.mjs';

export const DRAFT_HEADING = 'Draft';
const LINKEDIN_LIMIT = 3000;
const MEDIA_LIVE_TIMEOUT_MS = 2 * 60 * 1000;

/** The post text under "Draft", ready for LinkedIn. Throws if it's missing or too long. */
export function draftText(blocks) {
  const text = linkedInText(extractPost(blocks, DRAFT_HEADING));
  if (text.length > LINKEDIN_LIMIT) throw new Error(`The draft is ${text.length} characters; LinkedIn allows ${LINKEDIN_LIMIT}`);
  return text;
}

const isTiliaLinkedIn = (item) => !item.channel || item.channel === 'Tilia LinkedIn';
const gtmReady = () => Boolean(process.env.NOTION_GTM_DATABASE_ID);

/** Approved Tilia LinkedIn posts, for the cheap check step. Empty if the GTM database or Buffer isn't set up. */
export async function approvedPosts() {
  const { BUFFER_API_KEY, BUFFER_CHANNEL_ID } = process.env;
  if (!gtmReady() || !BUFFER_API_KEY || !BUFFER_CHANNEL_ID) return [];
  return (await queryGtm({ type: 'LinkedIn post', status: 'Approved' })).filter(isTiliaLinkedIn);
}

/**
 * What a draft's "Image" section asks for: 'none' (no section, or `card: none`), 'image' (an image is already
 * there; the last one is posted), 'failed' (a card couldn't be made and the note is still there), or 'render'
 * with the card spec. Throws if the spec is wrong.
 */
export function imagePlan(blocks) {
  const section = imageSection(blocks);
  if (!section) return { action: 'none' };
  if (section.images.length) return { action: 'image', section, block: section.images.at(-1) };
  if (section.failed) return { action: 'failed', section };
  const spec = parseSpec(section.lines);
  return spec.card === 'none' ? { action: 'none' } : { action: 'render', section, spec };
}

const PREVIEW_DIR = 'cards/out';

/**
 * Renders the card for each Tilia LinkedIn draft at Needs approval that asks for one, and adds it to the page
 * under "Image" so James sees it before approving. A card that can't be made gets a note saying why, which
 * stops retries until he fixes the spec and deletes the note.
 */
export async function addCardsToDrafts({ dryRun = false } = {}) {
  if (!gtmReady()) return 0;
  const drafts = (await queryGtm({ type: 'LinkedIn post', status: 'Needs approval' })).filter(isTiliaLinkedIn);
  let made = 0;
  for (const item of drafts) {
    const blocks = await listBlocks(item.id);
    let plan;
    try {
      plan = imagePlan(blocks);
      if (plan.action !== 'render') continue;
      const png = await renderCard(plan.spec);
      if (dryRun) {
        await mkdir(PREVIEW_DIR, { recursive: true });
        const file = `${PREVIEW_DIR}/${slugify(item.title)}.png`;
        await writeFile(file, png);
        console.log(`Would add a ${plan.spec.card} card to "${item.title}" (dry run): ${file}`);
        continue;
      }
      const uploadId = await uploadFile(`${slugify(item.title)}.png`, png, 'image/png');
      await appendBlocks(item.id, [imageBlock(uploadId)], { after: plan.section.lastBlockId });
      made++;
      console.log(`Added a ${plan.spec.card} card to "${item.title}".`);
    } catch (error) {
      console.error(`Couldn't make the image for "${item.title}": ${error.message}`);
      process.exitCode = 1;
      const section = plan?.section ?? imageSection(blocks);
      if (dryRun || !section) continue;
      const note = `${FAILED_NOTE} ${error.message}. Fix the lines above and delete this note, and I'll try again.`;
      await appendBlocks(item.id, [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: note } }] } }], {
        after: section.lastBlockId,
      });
      await notify(item.id, { title: `Couldn't make the image for "${item.title}"`, lines: [error.message, 'There is a note under Image on the page.'] });
    }
  }
  return made;
}

/** Waits for a just-committed file to be served, since Buffer may try it straight away. */
async function waitForUrl(url) {
  const deadline = Date.now() + MEDIA_LIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (res?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`The image was committed but ${url} still isn't reachable`);
}

/**
 * The public URL of an approved post's image, or null for a text-only post. Notion's file links expire within
 * the hour and Buffer only fetches the image when the post goes out, so the PNG is committed to media/ in this
 * (public) repo and served from GitHub.
 */
async function publishImage(item, blocks, { dryRun }) {
  const plan = imagePlan(blocks);
  if (plan.action === 'none') return null;
  if (plan.action === 'failed') throw new Error("The image couldn't be made; fix the lines under Image and delete the note, or set the card to none");

  let png;
  if (plan.action === 'image') {
    const source = imageUrl(plan.block);
    if (!source) throw new Error("The image under Image isn't a file or a link I can download");
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Couldn't download the image under Image (${res.status})`);
    png = Buffer.from(await res.arrayBuffer());
  } else {
    png = await renderCard(plan.spec);
  }

  const repo = process.env.GITHUB_REPOSITORY ?? 'jamessamuelcamps/tilia-briefs';
  const ext = plan.action === 'image' && /\.jpe?g(\?|$)/i.test(imageUrl(plan.block)) ? 'jpg' : 'png';
  const path = `media/${slugify(item.title)}-${item.id.replace(/-/g, '').slice(0, 8)}.${ext}`;
  const url = `https://raw.githubusercontent.com/${repo}/main/${path}`;
  if (dryRun) return url;
  await commitFile({ repo, branch: 'main', path, content: png, message: `media: image for "${item.title}"`, token: requireEnv('GITHUB_TOKEN') });
  await waitForUrl(url);
  return url;
}

/** Queues each approved post in Buffer. A failure goes back to Needs approval with a comment saying why. */
export async function queueApprovedPosts({ dryRun = false } = {}) {
  const posts = await approvedPosts();
  for (const item of posts) {
    try {
      const blocks = await listBlocks(item.id);
      const text = draftText(blocks);
      const imageUrl = await publishImage(item, blocks, { dryRun });
      if (dryRun) {
        console.log(`\n--- Would queue "${item.title}" in Buffer (dry run) ---\n\n${text}\n\nImage: ${imageUrl ?? 'none'}\n`);
        continue;
      }
      await addToQueue({ channelId: process.env.BUFFER_CHANNEL_ID, text, imageUrl });
      await setStatus(item.id, 'Scheduled');
      await notify(item.id, {
        title: `Queued in Buffer: ${item.title}`,
        lines: [
          `It's at the end of the Tilia page's queue${imageUrl ? ', with the image' : ''}. Change the time or the text in Buffer if you need to.`,
        ],
      });
      console.log(`Queued "${item.title}" in Buffer${imageUrl ? ' with an image' : ''}.`);
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
