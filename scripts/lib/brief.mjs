import { escapeSlack } from './slack.mjs';

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const wordCount = (v) => v.trim().split(/\s+/).length;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateBrief(brief, { candidateIds, minWords, maxWords }) {
  assert(brief && typeof brief === 'object', 'Brief must be an object');
  assert(candidateIds.includes(brief.ideaId), `ideaId "${brief.ideaId}" is not one of the candidates`);
  assert(isText(brief.intro), 'intro is required');
  assert(isText(brief.angle), 'angle is required');
  assert(wordCount(brief.intro) <= 35, 'intro must be 30 words or fewer');
  assert(wordCount(brief.angle) <= 35, 'angle must be 30 words or fewer; make it one sharp sentence');
  assert(brief.whyNow === undefined || typeof brief.whyNow === 'string', 'whyNow must be a string');
  assert(Array.isArray(brief.sections), 'sections must be an array');
  assert(brief.sections.length >= 3 && brief.sections.length <= 5, 'Use 3 to 5 sections');

  for (const [i, s] of brief.sections.entries()) {
    assert(isText(s.heading), `Section ${i + 1} needs a heading`);
    assert(Number.isInteger(s.words) && s.words > 0, `Section ${i + 1} needs a positive whole word target`);
    assert(Array.isArray(s.questions) && s.questions.length >= 1 && s.questions.length <= 3, `Section ${i + 1} needs 1 to 3 questions`);
    for (const q of s.questions) {
      assert(isText(q), `Section ${i + 1} has an empty question`);
      assert(q.length <= 240, `Section ${i + 1} has a question over 240 characters; keep prompts short`);
    }
  }

  const sum = brief.sections.reduce((total, s) => total + s.words, 0);
  assert(sum === brief.totalWords, `Section word targets add up to ${sum}, but totalWords is ${brief.totalWords}`);
  assert(sum >= minWords && sum <= maxWords, `totalWords ${sum} must be between ${minWords} and ${maxWords}`);
}

export function validateResearch(data, { existingTitles, maxIdeas }) {
  assert(data && Array.isArray(data.ideas), 'Expected { "ideas": [...] }');
  assert(data.ideas.length <= maxIdeas, `At most ${maxIdeas} ideas`);
  const seen = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  for (const [i, idea] of data.ideas.entries()) {
    assert(isText(idea.title), `Idea ${i + 1} needs a title`);
    assert(isText(idea.notes), `Idea ${i + 1} needs notes`);
    assert(/^https:\/\/\S+$/.test(idea.sourceUrl ?? ''), `Idea ${i + 1} needs an https sourceUrl`);
    assert(!seen.has(idea.title.trim().toLowerCase()), `Idea ${i + 1} duplicates "${idea.title}"`);
    seen.add(idea.title.trim().toLowerCase());
  }
}

/** The Slack message: readable in full from the notification. */
export function toSlackText(brief, { idea, channel, postDayLabel, notionUrl }) {
  const lines = [
    `*About ${brief.totalWords} words for ${channel.label}*, posting ${postDayLabel} at ${channel.postTime}`,
    '',
    `*${escapeSlack(idea.title)}*`,
    `_${escapeSlack(brief.intro)}_`,
    '',
    `*An angle to react to:* ${escapeSlack(brief.angle)}`,
  ];
  if (isText(brief.whyNow)) {
    const source = idea.sourceUrl ? ` <${idea.sourceUrl}|Source>` : '';
    lines.push(`*Why now:* ${escapeSlack(brief.whyNow)}${source}`);
  }
  brief.sections.forEach((s, i) => {
    lines.push('', `*${i + 1}. ${escapeSlack(s.heading)}* (about ${s.words} words)`);
    for (const q of s.questions) lines.push(`• ${escapeSlack(q)}`);
  });
  if (notionUrl) lines.push('', `<${notionUrl}|Start writing in Notion →>`);
  return lines.join('\n');
}

const rich = (content, annotations = {}) => [{ type: 'text', text: { content }, annotations }];
const emptyParagraph = () => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } });

/** Blocks appended to the idea's Notion page: the brief, then a space to write under each question. */
export function toNotionBlocks(brief, { idea, channel, postDayLabel }) {
  const blocks = [
    { object: 'block', type: 'divider', divider: {} },
    {
      object: 'block',
      type: 'callout',
      callout: {
        icon: { type: 'emoji', emoji: '🎙️' },
        rich_text: [
          ...rich(`About ${brief.totalWords} words for ${channel.label}, posting ${postDayLabel} at ${channel.postTime}.\n`, { bold: true }),
          ...rich(`${brief.intro}\n\n`),
          ...rich('An angle to react to: ', { bold: true }),
          ...rich(brief.angle),
        ],
      },
    },
  ];

  if (isText(brief.whyNow)) {
    const whyNow = [...rich('Why now: ', { bold: true }), ...rich(`${brief.whyNow} `)];
    if (idea.sourceUrl) whyNow.push({ type: 'text', text: { content: 'Source', link: { url: idea.sourceUrl } } });
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: whyNow } });
  }

  brief.sections.forEach((s, i) => {
    blocks.push({
      object: 'block',
      type: 'heading_3',
      heading_3: { rich_text: rich(`${i + 1}. ${s.heading} · about ${s.words} words`) },
    });
    blocks.push({
      object: 'block',
      type: 'quote',
      quote: { rich_text: rich(s.questions.join('\n'), { color: 'gray' }) },
    });
    blocks.push(emptyParagraph());
  });

  blocks.push(
    { object: 'block', type: 'divider', divider: {} },
    { object: 'block', type: 'heading_2', heading_2: { rich_text: rich('Finished post') } },
    emptyParagraph(),
  );
  return blocks;
}
