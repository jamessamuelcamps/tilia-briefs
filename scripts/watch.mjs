// Usage:
//   node scripts/watch.mjs [--dry-run]                             sub-edit every Drafted page, publish every Ready one
//   node scripts/watch.mjs --check                                 (GitHub Actions) only report whether anything is waiting
//   node scripts/watch.mjs --review|--publish <pageId> [--dry-run] one page, whatever its status
import { appendFile } from 'node:fs/promises';
import { askClaudeJson } from './lib/claude.mjs';
import { londonParts } from './lib/dates.mjs';
import { addComment, appendBlocks, getIdea, listBlocks, queryIdeas, setStatus } from './lib/notion.mjs';
import {
  extractPost,
  hasCut,
  postMarkdown,
  postText,
  restoreCut,
  slugify,
  toCutBlocks,
  toFailedSlack,
  toPublishedSlack,
  toReviewedSlack,
  toSiteMarkdown,
  validatePublish,
  validateReview,
} from './lib/post.mjs';
import { wordCount } from './lib/brief.mjs';
import { commitFile, waitUntilLive } from './lib/site.mjs';
import { postToSlack } from './lib/slack.mjs';
import { fill, read } from './lib/template.mjs';

const POST_TYPES = {
  personal:
    "A blog article for James's site, james-sc.co.uk, about product and UX design more broadly. A shortened version is cross-posted to his personal LinkedIn.",
  tilia: "A short product or feature post for the Tilia business page on LinkedIn. It isn't published anywhere else.",
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const flagValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const channels = JSON.parse(await read('config/channels.json'));

const channelFor = (idea) => {
  const key = Object.keys(channels).find((k) => channels[k].owner === idea.owner);
  if (!key) throw new Error(`No channel is set up for owner "${idea.owner}"`);
  return { key, ...channels[key] };
};

async function review(idea) {
  const channel = channelFor(idea);
  const paragraphs = extractPost(await listBlocks(idea.id));
  const prompt = fill(await read('prompts/subedit.md'), {
    postType: POST_TYPES[channel.key],
    voiceGuide: await read('config/voice-guide.md'),
    tiliaContext: await read('config/tilia.md'),
    title: idea.title,
    paragraphs: paragraphs.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n'),
  });
  const result = await askClaudeJson(prompt, (d) => validateReview(d, { paragraphs: paragraphs.length }));

  if (dryRun) {
    console.log(`\n--- Sub-edit of "${idea.title}" (dry run, nothing sent) ---\n\nOverall: ${result.overall}\n`);
    for (const c of result.comments) console.log(`[${c.paragraph}] ${c.comment}\n`);
    return;
  }

  await addComment({ page_id: idea.id }, result.overall);
  for (const c of result.comments) await addComment({ block_id: paragraphs[c.paragraph - 1].id }, c.comment);
  await setStatus(idea.id, 'Reviewed');
  const nextStep = channel.site
    ? "When you're happy, set the status to Ready and I'll publish it."
    : "When you're happy, schedule it on LinkedIn and set the status to Posted.";
  await postToSlack(toReviewedSlack(result, { idea, nextStep }));
  console.log(`Sub-edited "${idea.title}": ${result.comments.length} comments.`);
}

async function publish(idea) {
  const channel = channelFor(idea);
  const { site } = channel;
  if (!site) throw new Error(`${idea.owner} posts aren't published to a site; schedule it on LinkedIn and set the status to Posted`);

  const blocks = await listBlocks(idea.id);
  const paragraphs = extractPost(blocks);
  const post = postText(paragraphs);
  // A post that's already short enough goes to LinkedIn whole.
  const limits = { minWords: Math.min(channel.cutMinWords, wordCount(post)), maxWords: channel.cutMaxWords };
  const prompt = fill(await read('prompts/linkedin-cut.md'), { ...limits, title: idea.title, post });
  const result = await askClaudeJson(prompt, (d) => validatePublish(d, { post, ...limits }));
  const cut = restoreCut(result.cut, post);

  const slug = slugify(idea.title);
  const url = `${site.url}/${slug}`;
  const file = toSiteMarkdown({
    title: idea.title,
    description: result.description,
    publishDate: idea.postDate ?? londonParts().date,
    tags: result.tags,
    body: postMarkdown(paragraphs),
  });

  if (dryRun) {
    console.log(`\n--- ${site.dir}/${slug}.md (dry run, nothing committed) ---\n\n${file}`);
    console.log(`--- LinkedIn cut ---\n\n${cut.join('\n\n')}\n\nThis is the short version. The full post is on my site: ${url}\n`);
    return;
  }

  await commitFile({ ...site, path: `${site.dir}/${slug}.md`, content: file, message: `content: publish "${idea.title}"` });
  await waitUntilLive(url);
  // A retry after a failed run shouldn't add a second cut.
  if (!hasCut(blocks)) await appendBlocks(idea.id, toCutBlocks(cut, url));
  await setStatus(idea.id, 'Published');
  await postToSlack(toPublishedSlack({ idea, url }));
  console.log(`Published "${idea.title}" at ${url}.`);
}

/** Runs one step; if it fails, says so in Slack and puts the status back so the next run doesn't retry forever. */
async function attempt(step, idea, { action, fallback }) {
  try {
    await step(idea);
  } catch (error) {
    console.error(`Couldn't ${action} "${idea.title}": ${error.message}`);
    process.exitCode = 1;
    if (dryRun) return;
    await setStatus(idea.id, fallback);
    await postToSlack(toFailedSlack({ idea, action, error, status: fallback }));
  }
}

const reviewOpts = { action: 'sub-edit', fallback: 'Briefed' };
const publishOpts = { action: 'publish', fallback: 'Reviewed' };

if (flagValue('--review')) {
  await attempt(review, await getIdea(flagValue('--review')), reviewOpts);
} else if (flagValue('--publish')) {
  await attempt(publish, await getIdea(flagValue('--publish')), publishOpts);
} else {
  const drafted = await queryIdeas(null, ['Drafted']);
  const ready = await queryIdeas(null, ['Ready']);
  console.log(`${drafted.length} drafted, ${ready.length} ready.`);

  if (args.includes('--check')) {
    const pending = drafted.length + ready.length > 0;
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `pending=${pending}\n`);
  } else {
    for (const idea of drafted) await attempt(review, idea, reviewOpts);
    for (const idea of ready) await attempt(publish, idea, publishOpts);
  }
}
