// Usage:
//   node scripts/run.mjs personal|tilia [--dry-run] [--force]
//   node scripts/run.mjs --scheduled   (GitHub Actions; works out the channel from the day and UK time)
import { askClaudeJson } from './lib/claude.mjs';
import { addDays, formatDay, londonOffsetHours, londonParts } from './lib/dates.mjs';
import { appendBlocks, createIdea, markBriefed, queryIdeas, BRIEFED_ONWARDS } from './lib/notion.mjs';
import { postToSlack } from './lib/slack.mjs';
import { fill, read } from './lib/template.mjs';
import { toNotionBlocks, toSlackText, validateBrief, validateResearch } from './lib/brief.mjs';

const BRIEF_HOUR_UK = 18;
const MAX_RESEARCH_IDEAS = 3;
const MAX_CANDIDATES = 40;

const CHANNEL_RULES = {
  personal:
    "This is James's personal profile, written as himself. Mention Tilia at most once, and only if the topic is directly about research tooling.",
  tilia:
    "This is the Tilia business page, introducing one feature. Interview James about: the problem it solves, who it's for, how it works in Tilia, and one concrete example of it in use. Keep it short and specific. Don't describe the feature yourself; ask him.",
};

const bullets = (items) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const channels = JSON.parse(await read('config/channels.json'));

/** Scheduled runs fire at both 17:00 and 18:00 UTC; only the one that is 18:00 in the UK goes ahead. */
function scheduledChannel() {
  const utcHour = Number((process.env.SCHEDULE ?? '').split(' ')[1]);
  const now = new Date();
  if (utcHour + londonOffsetHours(now) !== BRIEF_HOUR_UK) return null;
  const { weekday } = londonParts(now);
  return Object.keys(channels).find((key) => channels[key].briefDay === weekday) ?? null;
}

async function research(owner) {
  const existingTitles = (await queryIdeas(owner)).map((i) => i.title);
  const prompt = fill(await read('prompts/research.md'), {
    maxIdeas: MAX_RESEARCH_IDEAS,
    sources: await read('config/sources.md'),
    existingTitles: bullets(existingTitles),
  });
  const { ideas } = await askClaudeJson(prompt, (d) => validateResearch(d, { existingTitles, maxIdeas: MAX_RESEARCH_IDEAS }), {
    tools: ['WebSearch', 'WebFetch'],
  });
  for (const idea of ideas) {
    console.log(`Research idea: ${idea.title} (${idea.sourceUrl})`);
    if (!dryRun) await createIdea({ ...idea, owner, source: 'Research' });
  }
}

async function brief(key) {
  const channel = channels[key];
  const owner = channel.owner;
  const postDate = addDays(londonParts().date, channel.daysAhead);
  const postDayLabel = formatDay(postDate);

  if (!dryRun && !force) {
    const alreadyBriefed = (await queryIdeas(owner, BRIEFED_ONWARDS)).some((i) => i.postDate === postDate);
    if (alreadyBriefed) return console.log(`Already briefed ${owner} for ${postDate}; skipping.`);
  }

  if (channel.research) {
    // Research tops up the list; a failure here shouldn't stop the brief.
    await research(owner).catch((error) => console.warn(`Research skipped: ${error.message}`));
  }

  const candidates = (await queryIdeas(owner, ['Idea'])).slice(0, MAX_CANDIDATES);
  if (!candidates.length) {
    const message = `No ${owner} ideas left in Notion, so there's no brief for ${postDayLabel}. Add a few and I'll pick one next time.`;
    console.log(message);
    if (!dryRun) await postToSlack(message);
    return;
  }

  const recent = (await queryIdeas(owner, BRIEFED_ONWARDS))
    .sort((a, b) => (b.postDate ?? '').localeCompare(a.postDate ?? ''))
    .slice(0, 6)
    .map((i) => i.title);

  const prompt = fill(await read('prompts/brief.md'), {
    channelLabel: channel.label,
    postDay: postDayLabel,
    postTime: channel.postTime,
    minWords: channel.minWords,
    maxWords: channel.maxWords,
    channelRules: CHANNEL_RULES[key],
    voiceGuide: await read('config/voice-guide.md'),
    tiliaContext: await read('config/tilia.md'),
    candidates: JSON.stringify(
      candidates.map(({ id, title, notes, source, sourceUrl }) => ({ id, title, notes, source, sourceUrl })),
      null,
      2,
    ),
    recent: bullets(recent),
  });

  const result = await askClaudeJson(prompt, (d) =>
    validateBrief(d, { candidateIds: candidates.map((c) => c.id), minWords: channel.minWords, maxWords: channel.maxWords }),
  );
  const idea = candidates.find((c) => c.id === result.ideaId);
  const context = { idea, channel, postDayLabel, notionUrl: idea.url };

  if (dryRun) {
    console.log(`\n--- Slack message (dry run, nothing sent) ---\n\n${toSlackText(result, context)}\n`);
    return;
  }

  await appendBlocks(idea.id, toNotionBlocks(result, context));
  await markBriefed(idea.id, postDate);
  await postToSlack(toSlackText(result, context));
  console.log(`Briefed "${idea.title}" for ${postDate}.`);
}

const key = args.includes('--scheduled') ? scheduledChannel() : args.find((a) => !a.startsWith('--'));
if (!key) {
  console.log('Nothing scheduled for now.');
} else if (!channels[key]) {
  throw new Error(`Unknown channel "${key}". Use one of: ${Object.keys(channels).join(', ')}`);
} else {
  await brief(key);
}
