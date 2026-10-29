import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftText } from '../scripts/lib/gtm.mjs';
import { toGtmItem } from '../scripts/lib/notion.mjs';
import { linkedInText } from '../scripts/lib/post.mjs';

const span = (plain_text) => ({ plain_text, annotations: {}, href: null });
const block = (type, text, id = text) => ({ id, type, [type]: { rich_text: [span(text)] } });
const heading = (text) => block('heading_2', text);

test('LinkedIn text has no Markdown and keeps list items on consecutive lines', () => {
  const paragraphs = [
    { type: 'paragraph', text: 'Three things:' },
    { type: 'bulleted_list_item', text: 'one' },
    { type: 'bulleted_list_item', text: 'two' },
    { type: 'paragraph', text: 'Steps:' },
    { type: 'numbered_list_item', text: 'first' },
    { type: 'numbered_list_item', text: 'second' },
    { type: 'paragraph', text: 'Try it free.' },
  ];
  assert.equal(linkedInText(paragraphs), 'Three things:\n\n• one\n• two\n\nSteps:\n\n1. first\n2. second\n\nTry it free.');
});

test('the draft is what sits under "Draft", up to the next divider', () => {
  const blocks = [
    block('paragraph', 'Why this post: a note from Claude'),
    heading('Draft'),
    block('paragraph', 'Tree tests show where people get lost.'),
    block('paragraph', 'tilialabs.io'),
    { id: 'd', type: 'divider', divider: {} },
    block('paragraph', 'Notes after the divider are ignored'),
  ];
  assert.equal(draftText(blocks), 'Tree tests show where people get lost.\n\ntilialabs.io');
});

test('a page without a Draft heading, or an over-long draft, is refused', () => {
  assert.throws(() => draftText([block('paragraph', 'text')]), /no "Draft" heading/);
  assert.throws(() => draftText([heading('Draft'), block('paragraph', 'x'.repeat(3001))]), /LinkedIn allows 3000/);
});

test('a GTM row reads with missing columns', () => {
  assert.deepEqual(toGtmItem({ id: 'g', url: 'u', properties: { Name: { title: [span('Post')] }, Type: { select: { name: 'LinkedIn post' } } } }), {
    id: 'g',
    url: 'u',
    title: 'Post',
    type: 'LinkedIn post',
    status: null,
    channel: null,
  });
});
