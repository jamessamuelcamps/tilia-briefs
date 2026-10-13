import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPost,
  hasCut,
  postMarkdown,
  restoreCut,
  slugify,
  toCutBlocks,
  toSiteMarkdown,
  validatePublish,
  validateReview,
} from '../scripts/lib/post.mjs';

const span = (plain_text, extra = {}) => ({ plain_text, annotations: {}, href: null, ...extra });
const block = (type, spans, id = type) => ({ id, type, [type]: { rich_text: spans } });
const heading = (title) => block('heading_2', [span(title)]);
const divider = () => ({ id: 'divider', type: 'divider', divider: {} });

const page = () => [
  block('heading_3', [span('1. Your take · about 60 words')]),
  block('paragraph', [span('An answer under a question, not the post.')]),
  divider(),
  heading('Finished post'),
  block('paragraph', [span('Hot take: most testing is '), span('pointless ', { annotations: { bold: true } }), span('these days.')], 'p1'),
  block('paragraph', [], 'empty'),
  block('paragraph', [span('See '), span('the report', { href: 'https://example.com' }), span('.')], 'p2'),
  block('bulleted_list_item', [span('One')], 'l1'),
  block('bulleted_list_item', [span('Two')], 'l2'),
  divider(),
  heading('LinkedIn cut'),
  block('paragraph', [span('An earlier cut.')]),
];

test('extracts only what is under "Finished post", with block ids', () => {
  const paragraphs = extractPost(page());
  assert.deepEqual(paragraphs.map((p) => p.id), ['p1', 'p2', 'l1', 'l2']);
  assert.equal(paragraphs[0].text, 'Hot take: most testing is pointless these days.');
});

test('converts formatting and lists to Markdown', () => {
  assert.equal(
    postMarkdown(extractPost(page())),
    'Hot take: most testing is **pointless** these days.\n\nSee [the report](https://example.com).\n\n- One\n- Two',
  );
});

test('rejects a page with no post or an unsupported block', () => {
  assert.throws(() => extractPost([heading('Something else')]), /no "Finished post" heading/);
  assert.throws(() => extractPost([heading('Finished post'), block('paragraph', [])]), /Nothing is written/);
  assert.throws(() => extractPost([heading('Finished post'), { id: 'i', type: 'image', image: {} }]), /"image" block/);
});

test('knows when a cut is already on the page', () => {
  assert.equal(hasCut(page()), true);
  assert.equal(hasCut(page().slice(0, 9)), false);
});

test('review comments must point at real paragraphs, once each', () => {
  const ok = { overall: 'Works well.', comments: [{ paragraph: 2, comment: 'Drop "I think".' }] };
  assert.doesNotThrow(() => validateReview(ok, { paragraphs: 3 }));
  assert.doesNotThrow(() => validateReview({ overall: 'Nothing to change.', comments: [] }, { paragraphs: 3 }));
  assert.throws(() => validateReview({ ...ok, comments: [{ paragraph: 4, comment: 'x' }] }, { paragraphs: 3 }), /from 1 to 3/);
  assert.throws(() => validateReview({ ...ok, comments: [ok.comments[0], ok.comments[0]] }, { paragraphs: 3 }), /two comments/);
  assert.throws(() => validateReview({ ...ok, overall: '' }, { paragraphs: 3 }), /overall is required/);
});

const post =
  'Hot take: most testing is pointless. Not because we shouldn’t test, but because it’s a box-ticking exercise, to confirm you showed it to users.\n\nI’d rather talk to two people than test with ten.';
const publishable = (cut) => ({ cut, description: 'Why most testing is box-ticking.', tags: ['Research'] });
const limits = { post, minWords: 5, maxWords: 20 };

test('a cut may only remove text', () => {
  const kept = ['Hot take: most testing is pointless.', 'I’d rather talk to two people than test with ten.'];
  assert.deepEqual(restoreCut(kept, post), kept);
  // Ending a sentence early with a full stop is allowed.
  const early = ['Not because we shouldn’t test, but because it’s a box-ticking exercise.'];
  assert.deepEqual(restoreCut(early, post), early);
  // Straightened apostrophes are put back as James typed them.
  assert.deepEqual(restoreCut(["Not because we shouldn't test.", "I'd rather talk to two people."], post), [
    'Not because we shouldn’t test.',
    'I’d rather talk to two people.',
  ]);
  // Rewording and reordering are rejected.
  assert.throws(() => restoreCut(['Hot take: most testing is useless.'], post), /"useless\." where the post doesn't/);
  assert.throws(() => restoreCut(['I’d rather talk to two people.', 'Hot take.'], post), /"Hot" where the post doesn't/);
});

test('validates the cut, description and tags together', () => {
  const cut = ['Hot take: most testing is pointless.', 'I’d rather talk to two people than test with ten.'];
  assert.doesNotThrow(() => validatePublish(publishable(cut), limits));
  assert.throws(() => validatePublish(publishable(['Most testing is a waste of time.']), limits), /only remove text/);
  assert.throws(() => validatePublish(publishable(['Hot take.']), limits), /between 5 and 20/);
  assert.throws(() => validatePublish({ ...publishable(cut), tags: ['A', 'B', 'C', 'D'] }, limits), /1 to 3 tags/);
  assert.throws(() => validatePublish({ ...publishable(cut), description: 'x'.repeat(161) }, limits), /160 characters/);
});

test('slugs match the site', () => {
  assert.equal(slugify('I’d rather talk to two people than test with ten'), 'id-rather-talk-to-two-people-than-test-with-ten');
  assert.equal(slugify('  Café research: a “quick” guide!  '), 'cafe-research-a-quick-guide');
});

test('site file has the front matter the writing collection expects', () => {
  const file = toSiteMarkdown({
    title: 'A "quoted" title',
    description: 'One line.',
    publishDate: '2026-10-13',
    tags: ['Research', 'Usability testing'],
    body: 'Body.',
  });
  assert.equal(
    file,
    '---\ntitle: "A \\"quoted\\" title"\ndescription: "One line."\npublishDate: 2026-10-13\ntags: ["Research", "Usability testing"]\n---\n\nBody.\n',
  );
});

test('cut blocks end with a link to the full post', () => {
  const blocks = toCutBlocks(['One.', 'Two.'], 'https://example.com/writing/a');
  assert.deepEqual(blocks.map((b) => b.type), ['divider', 'heading_2', 'paragraph', 'paragraph', 'paragraph']);
  assert.equal(blocks.at(-1).paragraph.rich_text.at(-1).text.link.url, 'https://example.com/writing/a');
});
