import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRepeat, toCommentRichText, toSlackText } from '../scripts/lib/notify.mjs';
import { toIdea } from '../scripts/lib/notion.mjs';

const message = { title: 'Sub-edit done: A & B', lines: ['3 comments.'], link: { url: 'https://notion.so/x', label: 'Open in Notion' } };

test('the comment mentions James first, then the title in bold, the lines and the link', () => {
  const parts = toCommentRichText(message, 'user-1');
  assert.deepEqual(parts[0], { type: 'mention', mention: { type: 'user', user: { id: 'user-1' } } });
  assert.equal(parts[2].text.content, 'Sub-edit done: A & B');
  assert.equal(parts[2].annotations.bold, true);
  assert.equal(parts[3].text.content, '\n3 comments.');
  assert.deepEqual(parts.at(-1).text, { content: 'Open in Notion', link: { url: 'https://notion.so/x' } });
});

test('without a user id the comment still goes up, just without a mention', () => {
  const parts = toCommentRichText({ title: 'Hello' }, undefined);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text.content, 'Hello');
});

test('Slack text escapes control characters', () => {
  assert.equal(toSlackText(message), '*Sub-edit done: A &amp; B*\n3 comments.\n<https://notion.so/x|Open in Notion>');
});

test('a crash alert is a repeat only if the same title went up in the last 12 hours', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const comment = (created_time, text) => ({ created_time, rich_text: [{ plain_text: 'James ' }, { plain_text: text }] });
  assert.equal(isRepeat([comment('2026-10-29T06:00:00Z', 'The Notion watcher crashed')], 'The Notion watcher crashed', now), true);
  assert.equal(isRepeat([comment('2026-10-28T20:00:00Z', 'The Notion watcher crashed')], 'The Notion watcher crashed', now), false);
  assert.equal(isRepeat([comment('2026-10-29T11:00:00Z', 'Something else')], 'The Notion watcher crashed', now), false);
});

test('an idea reads fine when optional columns are missing from the database', () => {
  const idea = toIdea({ id: 'p1', url: 'https://notion.so/p1', properties: { Name: { title: [{ plain_text: 'Screeners' }] } } });
  assert.deepEqual(idea, {
    id: 'p1',
    url: 'https://notion.so/p1',
    title: 'Screeners',
    owner: null,
    status: null,
    notes: '',
    source: null,
    sourceUrl: null,
    postDate: null,
    format: null,
  });
});

test('an idea reads every column when they are all there', () => {
  const idea = toIdea({
    id: 'p2',
    url: 'u',
    properties: {
      Name: { title: [{ plain_text: 'Upload ' }, { plain_text: 'from markdown' }] },
      Owner: { select: { name: 'Tilia' } },
      Status: { select: { name: 'Drafted' } },
      Notes: { rich_text: [{ plain_text: 'n' }] },
      Source: { select: null },
      'Source URL': { url: null },
      'Post date': { date: { start: '2026-10-30T09:00:00.000+00:00' } },
    },
  });
  assert.equal(idea.title, 'Upload from markdown');
  assert.equal(idea.owner, 'Tilia');
  assert.equal(idea.postDate, '2026-10-30');
});
