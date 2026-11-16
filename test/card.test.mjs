import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, FAILED_NOTE, cardHtml, imageSection, parseSpec, validateSpec } from '../scripts/lib/card.mjs';
import { draftText, imagePlan } from '../scripts/lib/gtm.mjs';

const span = (plain_text) => ({ plain_text, annotations: {}, href: null });
const block = (type, text, id = text) => ({ id, type, [type]: { rich_text: [span(text)] } });
const heading = (text) => block('heading_2', text);
const divider = (id = 'div') => ({ id, type: 'divider', divider: {} });
const image = (id, url) => ({ id, type: 'image', image: { type: 'file', file: { url } } });

const page = (...imageBlocks) => [
  heading('Draft'),
  block('paragraph', 'Tree tests show where people get lost.'),
  divider('d1'),
  heading('Image'),
  ...imageBlocks,
  divider('d2'),
  block('paragraph', 'Sources'),
];

test('the image section is everything between the "Image" heading and the next divider', () => {
  const section = imageSection(page(block('paragraph', 'card: headline', 'p1'), block('paragraph', 'headline: Your labels are lost', 'p2')));
  assert.deepEqual(section.lines, ['card: headline', 'headline: Your labels are lost']);
  assert.equal(section.lastBlockId, 'p2');
  assert.equal(imageSection([heading('Draft')]), null);
});

test('a spec in one block with line breaks reads the same', () => {
  const section = imageSection(page(block('code', 'card: mistake\ntitle: Guessed labels\nmistake: Labels you wrote\nfix: Card sort first')));
  assert.deepEqual(parseSpec(section.lines), { card: 'mistake', title: 'Guessed labels', mistake: 'Labels you wrote', fix: 'Card sort first' });
});

test('the draft stops before the image section even without a divider', () => {
  const blocks = [heading('Draft'), block('paragraph', 'Post text'), heading('Image'), block('paragraph', 'card: none')];
  assert.equal(draftText(blocks), 'Post text');
});

test('every card type validates with its required fields', () => {
  const examples = {
    stat: { stat: '73%', label: 'found it first time' },
    mistake: { title: 't', mistake: 'a', fix: 'b' },
    headline: { headline: 'Labels, not users' },
    compare: { headline: 'Open or closed?', left: 'Open', 'left text': 'a', right: 'Closed', 'right text': 'b' },
    template: { type: 'Tree test', name: 'SaaS settings' },
  };
  assert.deepEqual(Object.keys(examples), Object.keys(CARDS));
  for (const [card, fields] of Object.entries(examples)) assert.deepEqual(validateSpec({ card, ...fields }), { card, ...fields });
  assert.deepEqual(validateSpec({ card: 'None' }), { card: 'none' });
});

test('a wrong spec is refused with a reason', () => {
  assert.throws(() => parseSpec(['stat: 73%']), /no "card:" line/);
  assert.throws(() => parseSpec(['card: carousel']), /isn't a card/);
  assert.throws(() => parseSpec(['card: stat', 'label: x']), /needs a "stat:" line/);
  assert.throws(() => parseSpec(['card: stat', 'stat: 1,234,567', 'label: x']), /"stat" is 9 characters/);
  assert.throws(() => parseSpec(['card: mistake', 'title: t', 'mistake: a', 'fix: b', 'colour: red']), /doesn't use "colour"/);
  assert.throws(() => parseSpec(['card: headline', 'just some text']), /isn't a "key: value" line/);
  assert.throws(() => validateSpec({ card: 'headline', headline: 'x', url: 'https://example.com' }), /only show pages on https:\/\/tilialabs.io/);
  assert.throws(() => validateSpec({ card: 'headline', headline: 'x', url: 'tilialabs.io' }), /isn't a URL/);
  assert.throws(() => validateSpec({ card: 'headline', headline: 'x', show: 'Task 3' }), /needs a "report:" or "url:"/);
  assert.throws(() => validateSpec({ card: 'template', type: 'x', name: 'y', url: 'https://tilialabs.io/', report: 'card sort' }), /not both/);
  assert.throws(() => validateSpec({ card: 'headline', headline: 'x', report: 'interviews' }), /isn't a demo study/);
  assert.throws(() => validateSpec({ card: 'screenshot', caption: 'x', report: 'card sort' }), /isn't a card/);
});

const compare = { card: 'compare', headline: 'Open or closed?', left: 'Open', 'left text': 'a', right: 'Closed', 'right text': 'b' };

test('headline, template and compare cards can show demo study reports', () => {
  assert.deepEqual(validateSpec({ card: 'headline', headline: 'x', report: 'Card sort' }), { card: 'headline', headline: 'x', report: 'card sort' });
  const template = { card: 'template', type: 'Tree test', name: 'y', report: 'tree test', show: 'Task 1' };
  assert.deepEqual(validateSpec(template), template);
  const both = { ...compare, 'left report': 'Card sort', 'left show': 'Cluster dendrogram', 'right report': 'tree test' };
  assert.deepEqual(validateSpec(both), { ...both, 'left report': 'card sort' });
});

test('a compare card has a screen on both sides or neither', () => {
  assert.throws(() => validateSpec({ ...compare, 'left report': 'card sort' }), /both sides or neither/);
});

test('a zoomed screen is never shown bigger than its own pixels', async () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(744, 16);
  png.writeUInt32BE(570, 20);
  const html = await cardHtml({ card: 'headline', headline: 'x', report: 'tree test', show: 'Task 3' }, { screens: { '': png } });
  assert.match(html, /class="frame zoom"/);
  assert.match(html, /max-width:min\(100%,744px\)/);
  assert.doesNotMatch(await cardHtml({ card: 'headline', headline: 'x' }), /class="frame/);
});

test('card text is escaped', async () => {
  const html = await cardHtml({ card: 'headline', headline: '<script>alert(1)</script> & "you"' });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&#60;script&#62;alert(1)&#60;/script&#62; &#38; &#34;you&#34;'));
});

test('the Figma examples are all valid specs', async () => {
  const examples = JSON.parse(await readFile(new URL('../cards/examples.json', import.meta.url), 'utf8'));
  for (const example of examples) validateSpec(example);
});

test('the image plan: none, render, an existing image, or a failed card', () => {
  assert.equal(imagePlan([heading('Draft'), block('paragraph', 'text')]).action, 'none');
  assert.equal(imagePlan(page(block('paragraph', 'card: none'))).action, 'none');

  const render = imagePlan(page(block('paragraph', 'card: headline', 'p1'), block('paragraph', 'headline: Hi', 'p2')));
  assert.equal(render.action, 'render');
  assert.deepEqual(render.spec, { card: 'headline', headline: 'Hi' });

  // James's own image (added below the generated card) is the one that's posted.
  const withImages = imagePlan(page(block('paragraph', 'card: headline'), image('i1', 'https://a'), image('i2', 'https://b')));
  assert.equal(withImages.action, 'image');
  assert.equal(withImages.block.id, 'i2');

  const failed = imagePlan(page(block('paragraph', 'card: stat'), block('paragraph', `${FAILED_NOTE} A stat card needs a "stat:" line.`)));
  assert.equal(failed.action, 'failed');

  assert.throws(() => imagePlan(page(block('paragraph', 'card: stat'))), /needs a "stat:" line/);
});
