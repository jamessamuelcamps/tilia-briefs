import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNotionBlocks, toSlackText, validateBrief, validateResearch } from '../scripts/lib/brief.mjs';
import { extractJson } from '../scripts/lib/claude.mjs';
import { addDays, formatDay, londonOffsetHours } from '../scripts/lib/dates.mjs';

const channel = { label: 'your LinkedIn', postTime: '08:45', minWords: 250, maxWords: 350 };
const limits = { candidateIds: ['a'], minWords: 250, maxWords: 350 };

const goodBrief = () => ({
  ideaId: 'a',
  intro: "Let's talk about research you were never trained for.",
  angle: 'Most product designers do research nobody trained them for.',
  whyNow: '',
  totalWords: 300,
  sections: [
    { heading: 'Your take', words: 60, questions: ['Is untrained research a problem to fix or a reality to design for?'] },
    { heading: 'The moment', words: 100, questions: ['Think back to the first study you ran alone. What were you asked to find out?'] },
    { heading: 'What changed', words: 100, questions: ['Which habit do you trust now, and why?', 'What would you tell yourself then?'] },
    { heading: 'Close', words: 40, questions: ['What should a designer in that spot try this week?'] },
  ],
});

test('accepts a well-formed brief', () => {
  assert.doesNotThrow(() => validateBrief(goodBrief(), limits));
});

test('rejects an idea that was not a candidate', () => {
  assert.throws(() => validateBrief({ ...goodBrief(), ideaId: 'made-up' }, limits), /not one of the candidates/);
});

test('rejects section targets that do not add up', () => {
  const brief = goodBrief();
  brief.totalWords = 320;
  assert.throws(() => validateBrief(brief, limits), /add up to 300/);
});

test('rejects a total outside the channel range', () => {
  const brief = goodBrief();
  brief.sections[1].words = 300;
  brief.totalWords = 500;
  assert.throws(() => validateBrief(brief, limits), /between 250 and 350/);
});

test('rejects too few sections and over-long prompts', () => {
  const short = goodBrief();
  short.sections = short.sections.slice(0, 2);
  assert.throws(() => validateBrief(short, limits), /3 to 5 sections/);

  const wordy = goodBrief();
  wordy.sections[0].questions = ['x'.repeat(300)];
  assert.throws(() => validateBrief(wordy, limits), /over 240 characters/);
});

test('research ideas need real links and no duplicates', () => {
  const opts = { existingTitles: ['Tree tests are underrated'], maxIdeas: 3 };
  const ok = { ideas: [{ title: 'Navigation debt', notes: 'Hook.', sourceUrl: 'https://example.com/a' }] };
  assert.doesNotThrow(() => validateResearch(ok, opts));
  assert.throws(
    () => validateResearch({ ideas: [{ title: 'Navigation debt', notes: 'Hook.', sourceUrl: 'example.com' }] }, opts),
    /https sourceUrl/,
  );
  assert.throws(
    () => validateResearch({ ideas: [{ title: 'tree tests are underrated', notes: 'Hook.', sourceUrl: 'https://x.com' }] }, opts),
    /duplicates/,
  );
  assert.throws(() => validateResearch({ ideas: Array(4).fill(ok.ideas[0]) }, opts), /At most 3/);
});

test('Slack text escapes control characters and links to Notion', () => {
  const brief = goodBrief();
  brief.angle = 'Research < shipping & that is fine';
  const text = toSlackText(brief, {
    idea: { title: 'Tools & tricks', sourceUrl: null },
    channel,
    postDayLabel: 'Tuesday 6 October',
    notionUrl: 'https://notion.so/page',
  });
  assert.match(text, /Research &lt; shipping &amp; that is fine/);
  assert.match(text, /\*Tools &amp; tricks\*/);
  assert.match(text, /<https:\/\/notion\.so\/page\|Start writing in Notion →>/);
  assert.match(text, /\*1\. Your take\* \(about 60 words\)/);
});

test('Notion blocks give each section a heading, prompt and space to write', () => {
  const blocks = toNotionBlocks(goodBrief(), { idea: { sourceUrl: null }, channel, postDayLabel: 'Tuesday 6 October' });
  assert.equal(blocks.filter((b) => b.type === 'heading_3').length, 4);
  assert.equal(blocks.filter((b) => b.type === 'quote').length, 4);
  assert.equal(blocks.at(-2).type, 'heading_2');
});

test('extracts JSON from fenced or bare replies', () => {
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('{"a":2}'), { a: 2 });
});

test('UK dates and offsets', () => {
  assert.equal(addDays('2026-10-05', 1), '2026-10-06');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(formatDay('2026-10-06'), 'Tuesday 6 October');
  assert.equal(londonOffsetHours(new Date('2026-07-01T12:00:00Z')), 1);
  assert.equal(londonOffsetHours(new Date('2026-01-15T12:00:00Z')), 0);
});
