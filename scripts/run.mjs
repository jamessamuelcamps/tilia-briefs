// Usage:
//   node scripts/run.mjs personal|personal-short|make|tilia [--dry-run] [--force]
//   node scripts/run.mjs --scheduled   (GitHub Actions; works out the channels from the day and UK time)
import { askClaudeJson } from './lib/claude.mjs';
import { channelKeyFor, channelsBriefedOn, matchesChannel } from './lib/channels.mjs';
import { addDays, formatDay, londonOffsetHours, londonParts } from './lib/dates.mjs';
import { appendBlocks, createIdea, markBriefed, queryIdeas, BRIEFED_ONWARDS } from './lib/notion.mjs';
import { notify, runLink } from './lib/notify.mjs';
import { fill, read } from './lib/template.mjs';
import { briefHeadline, toNotionBlocks, toSlackText, validateBrief, validateResearch } from './lib/brief.mjs';

const BRIEF_HOUR_UK = 18;
const MAX_RESEARCH_IDEAS = 3;
const MAX_CANDIDATES = 40;

const THOUGHT_LEADERSHIP =
  'The goal is to establish him as a thought leader in product and UX design: interview him towards a distinctive, arguable position that peers will remember him for. Most of these posts won\'t mention Tilia. If building it gives him a genuinely relevant example, a question can invite it, but never steer the post towards promoting it.';

const CHANNEL_RULES = {
  personal: `This is a blog article for James's site, written as himself; a shortened version goes on his personal LinkedIn. ${THOUGHT_LEADERSHIP}`,
  'personal-short': `This is a short post written natively for James's personal LinkedIn, as himself. It isn't published anywhere else. One sharp observation is enough: a specific moment from his work, the point it proves, and what readers should take from it. Use 3 sections, with one or two questions each. ${THOUGHT_LEADERSHIP}`,
  make: 'This brief scopes something James will build and give away to the product and UX community: a small free tool or a template kit.',
  tilia:
    "This is the Tilia business page, introducing one feature. Interview James about: the problem it solves, who it's for, how it works in Tilia, and one concrete example of it in use. Keep it short and specific. Don't describe the feature yourself; ask him.",
};

const bullets = (items) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const channels = JSON.parse(await read('config/channels.json'));

/** Scheduled runs fire at both 17:00 and 18:00 UTC; only the one that is 18:00 in the UK goes ahead. */
function scheduledChannels() {
  const utcHour = Number((process.env.SCHEDULE ?? '').split(' ')[1]);
  const now = new Date();
  if (utcHour + londonOffsetHours(now) !== BRIEF_HOUR_UK) return [];
  return channelsBriefedOn(londonParts(now), channels);
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
  const postDate = addDays(londonParts().date, channel.daysAhead ?? 2);
  const postDayLabel = formatDay(postDate);
  const onThisChannel = (idea) => channelKeyFor(idea, channels) === key;

  if (!dryRun && !force) {
    const alreadyBriefed = (await queryIdeas(owner, BRIEFED_ONWARDS)).some((i) => onThisChannel(i) && i.postDate === postDate);
    if (alreadyBriefed) return console.log(`Already briefed ${key} for ${postDate}; skipping.`);
  }

  if (channel.research) {
    // Research tops up the list; a failure here shouldn't stop the brief.
    await research(owner).catch((error) => console.warn(`Research skipped: ${error.message}`));
  }

  const candidates = (await queryIdeas(owner, ['Idea'])).filter((i) => matchesChannel(i, channel)).slice(0, MAX_CANDIDATES);
  if (!candidates.length) {
    const kind = channel.format ? `${channel.format} ideas` : `${owner} ideas`;
    const message = `No ${kind} left in Notion, so there's no brief for ${postDayLabel}. Add a few and I'll pick one next time.`;
    console.log(message);
    if (!dryRun) await notify(null, { title: `No ${kind} left`, lines: [message] });
    return;
  }

  const recent = (await queryIdeas(owner, BRIEFED_ONWARDS))
    .filter(onThisChannel)
    .sort((a, b) => (b.postDate ?? '').localeCompare(a.postDate ?? ''))
    .slice(0, 6)
    .map((i) => i.title);

  const prompt = fill(await read(channel.prompt ?? 'prompts/brief.md'), {
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
    console.log(`\n--- ${key} brief (dry run, nothing sent) ---\n\n${toSlackText(result, context)}\n`);
    return;
  }

  await appendBlocks(idea.id, toNotionBlocks(result, context));
  await markBriefed(idea.id, postDate, channel.format);
  await notify(idea.id, {
    title: `New brief: ${idea.title}`,
    lines: [briefHeadline(result, context), result.intro],
    link: { url: idea.url, label: channel.postTime ? 'Start writing in Notion' : 'Answer it in Notion' },
  });
  console.log(`Briefed "${idea.title}" (${key}) for ${postDate}.`);
}

/** Runs one brief; a failure is reported and doesn't stop the next one. */
async function attempt(key) {
  try {
    await brief(key);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    if (dryRun) return;
    const link = runLink();
    const message = { title: `The ${key} brief failed`, lines: [error.message] };
    await notify(null, link ? { ...message, link } : message).catch(() => {});
  }
}

const keys = args.includes('--scheduled') ? scheduledChannels() : args.filter((a) => !a.startsWith('--'));
const unknown = keys.filter((k) => !channels[k]);
if (unknown.length) throw new Error(`Unknown channel "${unknown[0]}". Use one of: ${Object.keys(channels).join(', ')}`);
if (!keys.length) console.log('Nothing scheduled for now.');
for (const key of keys) await attempt(key);
