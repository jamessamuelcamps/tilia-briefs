// Image cards for Tilia LinkedIn posts, from the Figma file "Tilia Social Templates" (1080 x 1350).
// A draft asks for one under a heading 2 "Image", one "key: value" per line:
//
//   card: stat
//   stat: 73%
//   label: of participants found the billing page on the first try
//
// The card is plain HTML with the fonts and photo inlined, screenshotted by headless Chrome.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { assert } from './brief.mjs';

export const IMAGE_HEADING = 'Image';
const ROOT = new URL('../../cards/', import.meta.url);
const WIDTH = 1080;
const HEIGHT = 1350;

// A screen from the app or site, for the cards with a screenshot frame. `report` (a method) shows the shared results
// report of that study in tilia's demo account; `url` shows a page on tilialabs.io. `show` zooms in on the boxed part
// of the page holding that exact text, such as a heading. `visual` is one of the still pictures on a method page
// (see METHOD_VISUALS), `demo` one of the feature demos on the Explore page (EXPLORE_DEMOS), and `app` a part of the
// app opened by a short recipe (APP_SCREENS). All optional: without a screen, the card is text only.
const screenFields = (prefix = '') => ({
  [`${prefix}report`]: { max: 20, optional: true },
  [`${prefix}url`]: { max: 300, optional: true },
  [`${prefix}show`]: { max: 80, optional: true },
  [`${prefix}visual`]: { max: 30, optional: true },
  [`${prefix}demo`]: { max: 30, optional: true },
  [`${prefix}app`]: { max: 30, optional: true },
});

// Each card's fields, named after the Figma text layers, with the most characters that fit the layout.
export const CARDS = {
  stat: { stat: 6, label: 80, source: { max: 60, optional: true } },
  mistake: { title: 50, mistake: 80, fix: 80 },
  headline: { headline: 50, support: { max: 110, optional: true }, ...screenFields() },
  // Two options side by side under a question, e.g. tree test or card sort. The sides are small, so each shows one
  // piece of the tool (a method page's picture), not a page: a visual on both sides or neither.
  compare: { headline: 50, left: 20, 'left text': 90, right: 20, 'right text': 90, 'left visual': { max: 30, optional: true }, 'right visual': { max: 30, optional: true } },
  // `template` is the template's GitHub link: the card shows it in tilia's participant view (see templateStudy).
  template: { type: 20, name: 40, template: { max: 300, optional: true }, ...screenFields() },
};

// The still pictures on tilialabs.io's method pages (tilia/client/src/components/methods/MethodVisuals.jsx), in the
// order the page shows them: what a participant sees, what the researcher gets back, then any extra.
export const METHOD_VISUALS = {
  'tree test': { path: '/tree-test', pictures: ['task', 'results'] },
  'card sort': { path: '/card-sort', pictures: ['task', 'results', 'dendrogram'] },
  'first-click': { path: '/first-click', pictures: ['task', 'results'] },
  'five-second': { path: '/five-second', pictures: ['task', 'results'] },
  'preference test': { path: '/preference-test', pictures: ['task', 'results'] },
  survey: { path: '/survey', pictures: ['task', 'results'] },
};
const VISUAL_NAMES = Object.entries(METHOD_VISUALS).flatMap(([method, { pictures }]) => pictures.map((p) => `${method} ${p}`));

// The feature demos on the app's Explore page (tilia/client/src/components/explore/features.js), by the title on
// each tile. They're drawn from the app's own pieces and hold still on a chosen frame under reduced motion. Leave a
// feature out here until it's live for Free or Pro users (Transcripts and Projects are admin-only until launch).
export const EXPLORE_DEMOS = {
  'first study': 'Your first study',
  'create with ai': 'Create with AI',
  templates: 'Templates',
  preview: 'Preview',
  'study settings': 'Study settings',
  screeners: 'Screeners',
  prolific: 'Recruit on Prolific',
  'ai synthesis': 'AI synthesis',
  repository: 'Repository',
  'shareable reports': 'Shareable reports',
  workspaces: 'Workspaces',
  team: 'Team',
};

// Parts of the real app, opened as the read-only demo user: a page, the buttons to press (text, optionally only
// inside the element that also holds `within`), and the text whose section to show (`from`, to the bottom of the
// window). `{draft}` is the demo account's draft study.
export const APP_SCREENS = {
  'repository filter': { path: '/repository', clicks: [{ text: 'Filter' }, { text: 'information-architecture', within: 'All studies' }], from: 'Repository' },
  'study composer': { path: '/dashboard', from: 'What do you want to learn?', height: 520 },
  'survey questions': { path: '/studies/{draft}/edit', clicks: [{ text: 'Survey questions' }], from: 'Survey questions' },
  'study settings': { path: '/studies/{draft}/edit', clicks: [{ text: 'Settings' }], from: 'Settings' },
  screeners: { path: '/studies/{draft}/edit', clicks: [{ text: 'Screeners' }], from: 'Screeners' },
};
// Where each card can show a screen, as the prefix of its screen fields.
const SCREEN_SLOTS = { headline: [''], template: [''], compare: ['left ', 'right '] };
const SCREENSHOT_HOSTS = ['tilialabs.io', 'www.tilialabs.io'];
const SITE = 'https://tilialabs.io';

// The methods with a study in the demo account (tilia/server/scripts/seed-demo.js), by study type.
export const DEMO_REPORTS = {
  'tree test': 'treejack',
  'card sort': 'card_sort',
  'first-click': 'first_click',
  survey: 'survey',
  'preference test': 'preference',
};

/**
 * The shared report of the demo account's study of this method. Report links change each time the demo is
 * reseeded, so it's looked up when the card is made: log in as the read-only demo user, then find the study.
 */
export async function demoReportUrl(method) {
  const type = DEMO_REPORTS[method];
  const cookie = (await demoLogin()).map(({ name, value }) => `${name}=${value}`).join('; ');
  const get = async (path) => {
    const res = await fetch(`${SITE}${path}`, { headers: { cookie } });
    assert(res.ok, `tilia's demo account returned ${res.status} for ${path}`);
    return res.json();
  };
  const list = await get('/api/studies');
  const studies = Array.isArray(list) ? list : (list.studies ?? []);
  const live = studies.filter((s) => s.type === type && s.status !== 'draft');
  assert(live.length, `tilia's demo account has no ${method} study`);
  for (const { id } of live) {
    const body = await get(`/api/studies/${id}`);
    const token = (body.study ?? body).report_token;
    if (token) return `${SITE}/r/${token}`;
  }
  throw new Error(`The demo ${method} study has no shared report`);
}

/** The session cookies of tilia's read-only demo user, as { name, value }. */
async function demoLogin() {
  const login = await fetch(`${SITE}/api/auth/demo`, { redirect: 'manual' });
  const cookies = login.headers.getSetCookie().map((c) => {
    const [name, ...value] = c.split(';')[0].split('=');
    return { name, value: value.join('=') };
  });
  assert(cookies.length, `Couldn't log in to tilia's demo account (${login.status})`);
  return cookies;
}

const plain = (richText) => richText.map((t) => t.plain_text).join('');
const isHeading2 = (block, title) => block.type === 'heading_2' && (title === undefined || plain(block.heading_2.rich_text).trim() === title);

/**
 * The "Image" section of a page: its spec lines, any image blocks in it, and the id of its last block (to add
 * the rendered card after). Null if the page has no such heading. It ends at the next heading 2 or divider.
 */
export function imageSection(blocks) {
  const start = blocks.findIndex((b) => isHeading2(b, IMAGE_HEADING));
  if (start === -1) return null;
  const section = { lines: [], images: [], failed: false, lastBlockId: blocks[start].id };
  for (const block of blocks.slice(start + 1)) {
    if (block.type === 'divider' || isHeading2(block)) break;
    section.lastBlockId = block.id;
    if (block.type === 'image') section.images.push(block);
    const richText = block[block.type]?.rich_text;
    if (!richText) continue;
    const text = plain(richText).trim();
    if (text.startsWith(FAILED_NOTE)) section.failed = true;
    else if (text) section.lines.push(...text.split('\n'));
  }
  return section;
}

/** Marks a section whose card couldn't be made, so the watcher doesn't retry every half hour. */
export const FAILED_NOTE = "Couldn't make the image:";

/** The card spec from the section's lines. { card: 'none' } means text only. Throws with a reason if it's wrong. */
export function parseSpec(lines) {
  const spec = {};
  for (const line of lines) {
    const match = line.match(/^\s*([a-z ]+?)\s*:\s*(.*)$/i);
    assert(match, `"${line.slice(0, 40)}" isn't a "key: value" line`);
    spec[match[1].toLowerCase()] = match[2].trim();
  }
  return validateSpec(spec);
}

export function validateSpec(spec) {
  const card = spec.card?.toLowerCase();
  assert(card, 'The Image section has no "card:" line');
  if (card === 'none') return { card };
  const fields = CARDS[card];
  assert(fields, `"card: ${spec.card}" isn't a card; use ${[...Object.keys(CARDS), 'none'].join(', ')}`);

  const out = { card };
  for (const [key, rule] of Object.entries(fields)) {
    const { max, optional } = typeof rule === 'number' ? { max: rule } : rule;
    const value = spec[key]?.trim() ?? '';
    assert(value || optional, `A ${card} card needs a "${key}:" line`);
    assert(value.length <= max, `"${key}" is ${value.length} characters; the ${card} card fits ${max}`);
    if (value) out[key] = value;
  }
  const unknown = Object.keys(spec).filter((k) => k !== 'card' && !(k in fields));
  assert(!unknown.length, `A ${card} card doesn't use ${unknown.map((k) => `"${k}"`).join(', ')}; it takes ${Object.keys(fields).join(', ')}`);
  const slots = SCREEN_SLOTS[card] ?? [];
  const withScreen = slots.filter((prefix) => validateScreen(out, prefix));
  assert(withScreen.length === 0 || withScreen.length === slots.length, `A ${card} card needs a visual on both sides or neither`);
  return out;
}

/** Checks one screen's fields in place (lower-casing `report` and `visual`). True if the card shows a screen there. */
function validateScreen(out, prefix) {
  const [report, url, show, visual, template, demo, app] = ['report', 'url', 'show', 'visual', 'template', 'demo', 'app'].map((k) => `${prefix}${k}`);
  for (const [field, names, what] of [[demo, EXPLORE_DEMOS, 'feature demo'], [app, APP_SCREENS, 'app screen']]) {
    if (!out[field]) continue;
    const others = [report, url, show, visual, template, demo, app].filter((k) => k !== field && out[k]);
    assert(!others.length, `Use "${field}:" on its own, without ${others.map((k) => `"${k}:"`).join(' or ')}`);
    out[field] = out[field].toLowerCase().replace(/\s+/g, ' ');
    assert(out[field] in names, `"${field}: ${out[field]}" isn't a ${what}; use ${Object.keys(names).join(', ')}`);
    return true;
  }
  if (out[template]) {
    assert(!out[url] && !out[report] && !out[show] && !out[visual], `Use "${template}:" on its own, without another screen`);
    assert(templateRawUrl(out[template]), `"${template}:" must be a template's link, like ${TEMPLATE_BLOB}main/templates/tree-tests/banking-app.md`);
    return true;
  }
  if (out[visual]) {
    assert(!out[url] && !out[report] && !out[show], `Use "${visual}:" on its own, without "${report}:", "${url}:" or "${show}:"`);
    out[visual] = out[visual].toLowerCase().replace(/\s+/g, ' ');
    assert(VISUAL_NAMES.includes(out[visual]), `"${visual}: ${out[visual]}" isn't a method page picture; use ${VISUAL_NAMES.join(', ')}`);
    return true;
  }
  assert(!(out[url] && out[report]), `Use "${url}:" (a page on tilialabs.io) or "${report}:" (a demo study), not both`);
  if (!out[url] && !out[report]) {
    assert(!out[show], `"${show}:" needs a "${report}:" or "${url}:" line to zoom in on`);
    return false;
  }
  if (out[report]) {
    out[report] = out[report].toLowerCase();
    assert(out[report] in DEMO_REPORTS, `"${report}: ${out[report]}" isn't a demo study; use ${Object.keys(DEMO_REPORTS).join(', ')}`);
    return true;
  }
  let parsed;
  try {
    parsed = new URL(out[url]);
  } catch {
    throw new Error(`"${out[url]}" isn't a URL`);
  }
  assert(parsed.protocol === 'https:' && SCREENSHOT_HOSTS.includes(parsed.hostname), 'Screens can only show pages on https://tilialabs.io');
  return true;
}

// Templates live in a public GitHub repo. A link names a branch, so a template still in its PR can be shown.
const TEMPLATE_BLOB = 'https://github.com/tilia-labs/ux-research-templates/blob/';

/** The raw file for a template's GitHub link, or null if it isn't one. */
export function templateRawUrl(link) {
  const match = link.match(/^https:\/\/github\.com\/tilia-labs\/ux-research-templates\/blob\/([\w./-]+?)\/(templates\/[\w/-]+\.md)$/);
  return match && `https://raw.githubusercontent.com/tilia-labs/ux-research-templates/${match[1]}/${match[2]}`;
}

/**
 * A study for tilia's preview from a template's markdown (docs/markdown-format.md in the templates repo), read
 * the way tilia's importer reads it (tilia/client/src/utils/parseIAMarkdown.js). A tree test has "The tree" and
 * "Tasks" with each task's correct answers; a card sort has "The cards", and a closed sort also has its categories.
 */
export function templateStudy(markdown) {
  const section = (heading) => markdown.split(/^## /m).find((s) => s.startsWith(heading))?.slice(heading.length) ?? '';
  const bullets = (text) => text.split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l));
  const title = markdown.match(/^# (.+)$/m)?.[1].trim() ?? 'Template';
  const treeLines = bullets(section('The tree'));
  if (treeLines.length) {
    const root = { label: '', children: [] };
    const stack = [{ node: root, indent: -1 }];
    for (const line of treeLines) {
      const indent = line.search(/\S/);
      const node = { label: line.replace(/^\s*[-*]\s*/, '').trim(), children: [] };
      while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();
      stack.at(-1).node.children.push(node);
      stack.push({ node, indent });
    }
    const tree = root.children.length === 1 ? root.children[0] : { label: 'Home', children: root.children };
    const tasks = [...section('Tasks').matchAll(/^\d+\.\s+(.+)\n\s+Correct answers?:\s*(.+)$/gm)].map(([, question, answers], i) => ({
      id: `task-${i + 1}`,
      question: question.trim(),
      correct_answers: answers.split(/,\s*or\s+/).map((path) => path.split('›').map((label) => label.trim())),
    }));
    assert(tasks.length, `The template "${title}" has no tasks with correct answers`);
    return { title, type: 'treejack', config: { tree, tasks } };
  }
  const label = (l) => l.replace(/^\s*[-*]\s*/, '').trim();
  const cards = bullets(section('The cards')).map((l, i) => ({ id: `c${i + 1}`, label: label(l) }));
  assert(cards.length, `The template "${title}" has neither a tree nor cards`);
  // A closed sort's categories are a numbered list.
  const categories = [...section('Categories').matchAll(/^\s*\d+\.\s+(.+)$/gm)].map(([, l], i) => ({ id: `g${i + 1}`, label: l.trim() }));
  return { title, type: 'card_sort', config: { cards, categories, variant: categories.length ? 'closed' : 'open' } };
}

/** The screens a spec asks for: the field prefix, and the report method or URL, plus the text or picture to zoom in on. */
function screensFor(spec) {
  return (SCREEN_SLOTS[spec.card] ?? []).flatMap((prefix) => {
    if (spec[`${prefix}template`]) return [{ prefix, template: spec[`${prefix}template`] }];
    if (spec[`${prefix}demo`]) return [{ prefix, demo: spec[`${prefix}demo`] }];
    if (spec[`${prefix}app`]) return [{ prefix, app: spec[`${prefix}app`] }];
    const visual = spec[`${prefix}visual`];
    if (visual) {
      const [, method, picture] = visual.match(/^(.+) (\w+)$/);
      const { path, pictures } = METHOD_VISUALS[method];
      return [{ prefix, url: `${SITE}${path}`, picture: pictures.indexOf(picture) }];
    }
    if (!spec[`${prefix}report`] && !spec[`${prefix}url`]) return [];
    return [{ prefix, report: spec[`${prefix}report`], url: spec[`${prefix}url`], show: spec[`${prefix}show`] }];
  });
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Big type: escaped, with hyphenated words kept on one line ("five-second", not "five-" then "second").
const words = (s) => escape(s).replace(/\S+-\S+/g, (w) => `<span style="white-space:nowrap">${w}</span>`);
const dataUri = async (file, type) => `data:${type};base64,${(await readFile(new URL(file, ROOT))).toString('base64')}`;

const BODIES = {
  stat: (s) => `
    <div class="content stack" style="gap:32px">
      <p class="stat">${escape(s.stat)}</p>
      <p class="label">${escape(s.label)}</p>
      ${s.source ? `<p class="source">${escape(s.source)}</p>` : ''}
    </div>`,
  mistake: (s) => `
    <div class="content stack" style="gap:48px">
      <p class="title">${words(s.title)}</p>
      <div class="block mistake">${ICONS.cross}<div class="stack" style="gap:32px"><p class="block-heading">The mistake</p><p class="block-text">${escape(s.mistake)}</p></div></div>
      <div class="block fix">${ICONS.tick}<div class="stack" style="gap:32px"><p class="block-heading">The fix</p><p class="block-text">${escape(s.fix)}</p></div></div>
    </div>`,
  compare: (s, screens) => {
    const [left, right] = [screens['left '], screens['right ']];
    // Both pictures sit in backdrops of the same height, fitted to the taller one at the backdrop's inner width
    // (400px less 20px padding each side), so the two sides line up.
    const ratio = (png) => png.readUInt32BE(20) / png.readUInt32BE(16);
    const height = left && right ? Math.min(420, Math.round(360 * Math.max(ratio(left), ratio(right))) + 40) : 0;
    const picture = (png) => (png ? `<div class="frame picture" style="height:${height}px"><img src="data:image/png;base64,${png.toString('base64')}" alt=""></div>` : '');
    return `
    <div class="content stack" style="gap:56px">
      <p class="headline">${words(s.headline)}</p>
      <div class="pair${height ? ' with-screens' : ''}">
        <div class="side left">${picture(left)}<p class="side-name">${words(s.left)}</p><p class="side-text">${escape(s['left text'])}</p></div>
        <div class="side right">${picture(right)}<p class="side-name">${words(s.right)}</p><p class="side-text">${escape(s['right text'])}</p></div>
        <p class="or" style="${height ? `top:${32 + height / 2}px` : ''}">or</p>
      </div>
    </div>`;
  },
  headline: (s, screens) => `
    <div class="content stack" style="gap:64px;${screens[''] ? 'height:953px' : ''}">
      <div class="stack" style="gap:24px;width:100%">
        <p class="headline">${words(s.headline)}</p>
        ${s.support ? `<p class="support">${escape(s.support)}</p>` : ''}
      </div>
      ${frame(screens[''], s.show || s.visual || s.demo || s.app)}
    </div>`,
  template: (s, screens) => `
    <p class="pill">Free download</p>
    <div class="content stack" style="gap:64px;${screens[''] ? 'height:945px' : ''}">
      <div class="stack" style="gap:24px;width:100%">
        <p class="support">${escape(s.type)} template</p>
        <p class="title">${words(s.name)}</p>
      </div>
      ${frame(screens[''], s.show || s.visual || s.template || s.demo || s.app)}
    </div>`,
};

// The cross and tick from the Figma mistake card.
const ICONS = {
  cross: `<svg class="icon" width="88" height="88" viewBox="0 0 88 88"><rect width="88" height="88" rx="44" fill="#7D4220"/><path d="M63.43 60.67a1.95 1.95 0 0 1-2.76 2.76L44.5 47.26 28.33 63.43a1.95 1.95 0 0 1-2.76-2.76L41.74 44.5 25.57 28.33a1.95 1.95 0 0 1 2.76-2.76L44.5 41.74l16.17-16.17a1.95 1.95 0 0 1 2.76 2.76L47.26 44.5z" fill="#fff"/></svg>`,
  tick: `<svg class="icon" width="88" height="88" viewBox="0 0 88 88"><rect width="88" height="88" rx="44" fill="#475636"/><path d="M67.45 30.23 37.37 60.45a1.88 1.88 0 0 1-2.66 0L21.55 47.22a1.89 1.89 0 0 1 2.66-2.67l11.83 11.89 28.75-28.89a1.88 1.88 0 0 1 2.66 2.68z" fill="#fff"/></svg>`,
};

/** A screenshot frame for this PNG (zoomed in if it's one part: a `show` or a `visual`), or nothing without one. */
function frame(png, zoomed) {
  if (!png) return '';
  // A zoomed part fills the frame's width but is never shown bigger than its own pixels, so a small one stays sharp
  // (the width is in the PNG header). A part taller than the frame shows its top, which is where the heading is.
  const size = zoomed ? `max-width:min(100%,${png.readUInt32BE(16)}px)` : '';
  return `<div class="frame${zoomed ? ' zoom' : ''}"><img src="data:image/png;base64,${png.toString('base64')}" style="${size}" alt=""></div>`;
}

/** The card as a self-contained HTML page. `screens` holds a PNG for each screen the card shows, by field prefix ('' for one screen). */
export async function cardHtml(spec, { screens = {} } = {}) {
  const assets = {
    background: await dataUri('assets/background.jpg', 'image/jpeg'),
    fraunces: await dataUri('fonts/Fraunces.ttf', 'font/ttf'),
    bricolage: await dataUri('fonts/BricolageGrotesque.ttf', 'font/ttf'),
  };
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: Fraunces; src: url(${assets.fraunces}); font-weight: 100 900; }
@font-face { font-family: Bricolage; src: url(${assets.bricolage}); font-weight: 200 800; font-stretch: 75% 100%; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
.card { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; background: #fff url(${assets.background}) 0 0 / ${WIDTH}px ${HEIGHT}px no-repeat; overflow: hidden; overflow-wrap: break-word; }
.serif { font-family: Fraunces; font-variation-settings: "SOFT" 0, "WONK" 1; }
.serif, .stat, .headline, .title, .block-heading, .side-name, .or { font-family: Fraunces; font-variation-settings: "SOFT" 0, "WONK" 1; font-weight: 600; }
.label, .source, .support, .block-text, .side-text, .pill, .url { font-family: Bricolage; font-variation-settings: "opsz" 14, "wdth" 100; }
.logo { position: absolute; left: 64px; top: 64px; font-weight: 600; font-size: 70.405px; line-height: 1; letter-spacing: -1.4081px; color: #13110c; }
.content { position: absolute; left: 64px; top: 232px; width: 952px; }
.stack { display: flex; flex-direction: column; align-items: flex-start; }
.stack > * { flex-shrink: 0; }
.url { position: absolute; left: 64px; top: 1241px; font-weight: 500; font-size: 32px; line-height: 1.4; color: #faf7f2; white-space: nowrap; }
.stat { font-size: 280px; line-height: 1; letter-spacing: -11.2px; color: #384329; width: 100%; }
.label { font-weight: 500; font-size: 48px; line-height: 1.35; letter-spacing: -0.48px; color: #13110c; width: 100%; }
.source { font-weight: 400; font-size: 32px; line-height: 1.4; color: #5f5949; width: 100%; }
.headline { font-size: 104px; line-height: 1.05; color: #13110c; width: 100%; text-wrap: balance; }
.title { font-size: 64px; line-height: 1.05; color: #13110c; width: 100%; text-wrap: balance; }
.support { font-weight: 400; font-size: 40px; line-height: 1.35; color: #5f5949; width: 100%; }
.block { display: flex; gap: 48px; align-items: center; width: 100%; padding: 48px; border: 1px solid; border-radius: 16px; }
.block > .stack { flex: 1 0 0; min-width: 1px; }
.block .icon { flex: none; display: block; }
.block.mistake { background: #faf7f2; border-color: #7d4220; }
.block.fix { background: #f1f3ec; border-color: #384329; }
.block-heading { font-size: 48px; line-height: 1.05; }
.mistake .block-heading { color: #7d4220; }
.fix .block-heading { color: #475636; }
.block-text { font-weight: 400; font-size: 32px; line-height: 1.25; color: #13110c; width: 100%; }
.pair { position: relative; display: flex; gap: 24px; width: 100%; }
.side { flex: 1 0 0; min-width: 1px; display: flex; flex-direction: column; gap: 24px; padding: 32px; border: 1px solid; border-radius: 16px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.16); }
.side.left { background: #faf7f2; border-color: #e5ddd0; color: #13110c; }
.side.right { background: #475636; border-color: #384329; color: #faf7f2; }
.side-name { font-size: 56px; line-height: 1.05; }
.left .side-name { color: #475636; }
.side-text { font-weight: 400; font-size: 30px; line-height: 1.28; }
.frame.picture { flex: none !important; padding: 20px; border: none; border-radius: 10px; box-shadow: none; background: #efe9dd; }
.right .frame.picture { background: rgba(255, 255, 255, 0.1); }
.pair:not(.with-screens) { gap: 120px; }
.pair:not(.with-screens) .side { padding: 40px; }
.pair:not(.with-screens) .side-name { font-size: 64px; }
.pair:not(.with-screens) .side-text { font-size: 36px; }
.or { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 96px; height: 96px; border-radius: 50%; background: #fff; border: 2px solid #e5ddd0; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.16); display: flex; align-items: center; justify-content: center; font-size: 44px; line-height: 1; padding-bottom: 6px; color: #13110c; }
.pill { position: absolute; right: 64px; top: 64px; background: #475636; color: #fff; padding: 12px 28px; border-radius: 9999px; font-weight: 500; font-size: 32px; line-height: 1.4; white-space: nowrap; }
.frame { flex: 1 0 0 !important; min-height: 1px; width: 100%; background: #f2ede4; border: 2px solid #e5ddd0; border-radius: 16px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.16); overflow: hidden; }
.frame img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.frame.zoom { position: relative; background: #faf7f2; padding: 40px 40px 0; display: flex; flex-direction: column; align-items: center; justify-content: safe center; }
.frame.zoom img { flex: none; width: 100%; height: auto; }
.frame.picture img { width: 100%; height: 100%; object-fit: contain; }
.frame.zoom::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 64px; background: linear-gradient(rgba(250, 247, 242, 0), #faf7f2); }
</style></head><body>
<div class="card">
  <p class="logo serif">tilia</p>
  ${BODIES[spec.card](spec, screens)}
  <p class="url">tilialabs.io</p>
</div>
</body></html>`;
}

const run = promisify(execFile);

/** Chrome or Edge: CHROME_PATH, then the usual install locations on Linux, macOS and Windows. */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw new Error('No Chrome to render the image with; install it or set CHROME_PATH');
  return found;
}

/** A PNG of a page (a file or https URL) at this window size. */
async function screenshotPage(target, { width, height, dir }) {
  const out = join(dir, `shot-${Date.now()}.png`);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--mute-audio',
    '--force-device-scale-factor=1',
    // Without this, a page's entrance animations are caught half-way and the text is missing.
    '--run-all-compositor-stages-before-draw',
    `--user-data-dir=${join(dir, 'profile')}`,
    `--window-size=${width},${height}`,
    '--virtual-time-budget=10000',
    `--screenshot=${out}`,
    // GitHub's Ubuntu runners block Chrome's sandbox; it only ever opens our own card or tilialabs.io.
    ...(process.env.CI ? ['--no-sandbox'] : []),
    target,
  ];
  await run(findChrome(), args, { timeout: 60_000 });
  assert(existsSync(out), `Chrome didn't save a screenshot of ${target}`);
  return readFile(out);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `fn(send)` against a page in headless Chrome, where `send(method, params)` is a DevTools Protocol call. */
export async function withChromePage(fn, { dir }) {
  // A new profile each time: a compare card captures two screens, and the first Chrome's port file would be read again.
  const profile = await mkdtemp(join(dir, 'cdp-profile-'));
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--mute-audio', `--user-data-dir=${profile}`, '--remote-debugging-port=0'];
  const chrome = spawn(findChrome(), [...args, ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    let port;
    for (let i = 0; i < 100 && !port; i++) {
      if (existsSync(portFile)) port = (await readFile(portFile, 'utf8')).split('\n')[0].trim();
      if (!port) await delay(200);
    }
    assert(port, "Chrome didn't start");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("Couldn't connect to Chrome"));
    });
    let nextId = 0;
    const pending = new Map();
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      const call = pending.get(msg.id);
      if (!call) return;
      pending.delete(msg.id);
      if (msg.error) call.reject(new Error(`Chrome: ${msg.error.message}`));
      else call.resolve(msg.result);
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    try {
      return await fn(send);
    } finally {
      ws.close();
    }
  } finally {
    chrome.kill();
  }
}

// Runs in the page: the box (bordered or shadowed, with rounded corners) around the element whose text, alt
// text or aria-label is exactly `show`, scrolled into view, as a clip rectangle. Null until the page has rendered it.
export const findBox = (show) => `(() => {
  const norm = (s) => (s ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const want = ${JSON.stringify(show.replace(/\s+/g, ' ').trim().toLowerCase())};
  const all = [...document.querySelectorAll('body *')];
  const match = all.find((e) => e.children.length === 0 && norm(e.textContent) === want)
    ?? all.find((e) => norm(e.getAttribute('alt')) === want || norm(e.getAttribute('aria-label')) === want)
    ?? all.reverse().find((e) => norm(e.textContent) === want);
  if (!match) return null;
  let box = match;
  for (let n = match.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (parseFloat(s.borderTopLeftRadius) > 0 && (parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== 'none')) { box = n; break; }
  }
  box.scrollIntoView({ block: 'center' });
  const r = box.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left + scrollX - 2, y: r.top + scrollY - 2, width: r.width + 4, height: r.height + 4 };
})()`;

// Runs in the page: a method page's picture (a figure.methodVisual), by its place on the page, as a clip rectangle.
// Only the picture's card, on a see-through page: the figure's backdrop changes colour from one section to the next
// and would show at the card's rounded corners. The margin keeps the card's shadow.
const findPicture = (index) => `(() => {
  const card = document.querySelectorAll('figure.methodVisual')[${index}]?.firstElementChild;
  if (!card) return null;
  for (let n = card.parentElement; n; n = n.parentElement) n.style.setProperty('background', 'transparent', 'important');
  card.scrollIntoView({ block: 'center' });
  const r = card.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left + scrollX - 8, y: r.top + scrollY - 6, width: r.width + 16, height: r.height + 16 };
})()`;

// Narrow enough that the app's text is large once the part is scaled to fill the frame.
const ZOOM_WIDTH = 520;

/**
 * A PNG of one part of a page, rendered at a narrow width and triple resolution: the box holding the text `show`,
 * or the method page picture at `picture` (its place on the page).
 */
export async function screenshotPart(url, { show, picture }, { dir }) {
  const expression = show ? findBox(show) : findPicture(picture);
  return withChromePage(async (send) => {
    // A method page picture is captured a little narrower: it's shown in a compare card's half-width side.
    await send('Emulation.setDeviceMetricsOverride', { width: show ? ZOOM_WIDTH : 420, height: 1000, deviceScaleFactor: 3, mobile: false });
    if (!show) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send('Page.navigate', { url });
    let clip = null;
    for (let i = 0; i < 40 && !clip; i++) {
      await delay(500);
      clip = (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    }
    assert(clip, show ? `Couldn't find "${show}" on ${url}` : `${url} has no picture ${picture + 1}`);
    // Let charts finish animating, then measure again in case the layout moved.
    await delay(1500);
    clip = (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value ?? clip;
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
    return Buffer.from(data, 'base64');
  }, { dir });
}

// Runs in the page: the participant view's content, without the preview banner, as a clip rectangle: only the
// rows holding `labels` (a tree test's tree) if given, otherwise everything. Null until it has rendered.
const findExercise = (labels) => `(() => {
  const only = ${JSON.stringify(labels ?? null)};
  const banner = [...document.querySelectorAll('body *')].findLast((e) => e.textContent.includes("Responses won't be recorded"));
  let n = banner;
  while (n && n.parentElement && n.parentElement.textContent.trim().length < 160) n = n.parentElement;
  if (n) n.style.display = 'none';
  const rects = [...document.querySelectorAll('body *')]
    .filter((e) => only ? e.children.length === 0 && only.includes(e.textContent.trim()) : (e.children.length === 0 && e.textContent.trim()) || e.tagName === 'BUTTON')
    .map((e) => (only ? e.closest('button, [role=treeitem], li') ?? e.parentElement : e).getBoundingClientRect())
    .filter((r) => r.width && r.height);
  if (rects.length < 3) return null;
  const top = Math.min(...rects.map((r) => r.top)) - 24;
  const bottom = Math.max(...rects.map((r) => r.bottom)) + 24;
  return { x: 0, y: Math.max(0, top + scrollY), width: document.documentElement.clientWidth, height: bottom - Math.max(0, top) };
})()`;

const treeLabels = (node) => [node.label, ...node.children.flatMap(treeLabels)];

/**
 * A PNG of a template as a participant sees it, in tilia's preview (which saves nothing). A tree test is opened
 * along its first task's answer, so the card shows the template's own tree, not just its top level.
 */
export async function screenshotTemplate(link, { dir }) {
  const res = await fetch(templateRawUrl(link));
  assert(res.ok, `GitHub returned ${res.status} for ${link}`);
  const { title, type, config } = templateStudy(await res.text());
  const study = { id: 'template-preview', title, type, config: { ...config, randomise_cards: false } };
  const path = type === 'treejack' ? config.tasks[0].correct_answers[0] : [];
  const cookies = await demoLogin();
  return withChromePage(async (send) => {
    // Wider than other parts, so a whole tree opened at one branch fits the template card's frame.
    await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 1200, deviceScaleFactor: 3, mobile: false });
    // Preview needs someone signed in: the read-only demo user.
    for (const cookie of cookies) await send('Network.setCookie', { ...cookie, url: SITE });
    // Preview reads the study from localStorage on tilia's own origin.
    await send('Page.navigate', { url: `${SITE}/about` });
    await delay(2000);
    const value = JSON.stringify({ studyId: study.id, study });
    await send('Runtime.evaluate', { expression: `localStorage.setItem('tilia_preview_study', ${JSON.stringify(value)})` });
    await send('Page.navigate', { url: `${SITE}/preview/exercise` });
    // Wait for the tree's first branch or the first card.
    const first = JSON.stringify(path[0] ?? config.cards[0].label);
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      await delay(500);
      ready = (await send('Runtime.evaluate', { expression: `document.body.innerText.includes(${first})`, returnByValue: true })).result.value;
    }
    if (!ready) {
      const text = (await send('Runtime.evaluate', { expression: 'document.body.innerText.slice(0, 200)', returnByValue: true })).result.value;
      throw new Error(`The preview of ${title} didn't show ${first}; it shows: ${text}`);
    }
    for (const label of path) {
      const expression = `(() => { const el = [...document.querySelectorAll('body *')].findLast((e) => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(label)}); if (el) el.click(); return !!el; })()`;
      assert((await send('Runtime.evaluate', { expression, returnByValue: true })).result.value, `The preview of ${title} has no "${label}" in its tree`);
      await delay(400);
    }
    await delay(800);
    // A tree test shows only its tree: the post already asks the task's question.
    const labels = type === 'treejack' ? treeLabels(config.tree) : null;
    const clip = (await send('Runtime.evaluate', { expression: findExercise(labels), returnByValue: true })).result.value;
    assert(clip, `The preview of ${title} didn't load`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
    return Buffer.from(data, 'base64');
  }, { dir });
}

// Runs in the page: hides the demo account's banner and preview's banner, which aren't part of the product.
const HIDE_BANNERS = `(() => {
  for (const text of ['exploring tilia in demo mode', "Responses won't be recorded"]) {
    let n = [...document.querySelectorAll('body *')].findLast((e) => e.textContent.includes(text));
    while (n && n.parentElement && n.parentElement.textContent.trim().length < 160) n = n.parentElement;
    if (n) n.style.display = 'none';
  }
})()`;

/** Opens a page in the app as the read-only demo user, and waits until it shows `text`. */
async function openAsDemo(send, path, text, { width, scale, reduced = false }) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: scale, mobile: false });
  if (reduced) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const cookie of await demoLogin()) await send('Network.setCookie', { ...cookie, url: SITE });
  await send('Page.navigate', { url: `${SITE}${path}` });
  for (let i = 0; i < 40; i++) {
    await delay(500);
    if ((await send('Runtime.evaluate', { expression: `document.body.innerText.includes(${JSON.stringify(text)})`, returnByValue: true })).result.value) {
      await delay(1000);
      await send('Runtime.evaluate', { expression: HIDE_BANNERS });
      return;
    }
  }
  throw new Error(`${SITE}${path} didn't show "${text}"`);
}

/** Presses the last button-like element whose text is exactly `text`, optionally inside the element holding `within`. */
async function press(send, { text, within }) {
  const expression = `(() => {
    const scope = ${JSON.stringify(within ?? null)};
    const inScope = (e) => !scope || [...document.querySelectorAll('body *')].some((p) => p.contains(e) && p !== e && p.textContent.includes(scope) && p.textContent.length < 2000);
    const want = ${JSON.stringify(text)};
    const all = [...document.querySelectorAll('button, a, [role=tab], [role=button]')].filter(inScope);
    // One whose text starts with it, else the smallest one that holds it (a tile with a label above its title).
    const el = all.findLast((e) => e.textContent.trim().startsWith(want))
      ?? all.filter((e) => e.textContent.includes(want)).sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (el) el.click();
    return !!el;
  })()`;
  assert((await send('Runtime.evaluate', { expression, returnByValue: true })).result.value, `Couldn't find "${text}" to press`);
  await delay(1200);
}

/** A PNG of a feature demo from the Explore page, on the still frame it rests on under reduced motion. */
export async function screenshotDemo(name, { dir }) {
  const title = EXPLORE_DEMOS[name];
  return withChromePage(async (send) => {
    await openAsDemo(send, '/explore', title, { width: 1200, scale: 3, reduced: true });
    await press(send, { text: title });
    await delay(1000);
    // The demo's stage is the labelled picture in the dialog that opened, which comes last in the page.
    const expression = `(() => { const s = [...document.querySelectorAll('[role=img][aria-label]')].at(-1); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`;
    const clip = (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    assert(clip, `The ${title} demo didn't open`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
    return Buffer.from(data, 'base64');
  }, { dir });
}

/** A PNG of a part of the app, opened by its recipe in APP_SCREENS. Narrow, so the app's text reads at card size. */
export async function screenshotApp(name, { dir }) {
  const { path, clicks = [], from, height } = APP_SCREENS[name];
  let target = path;
  if (path.includes('{draft}')) {
    const cookie = (await demoLogin()).map(({ name: n, value }) => `${n}=${value}`).join('; ');
    const list = await (await fetch(`${SITE}/api/studies`, { headers: { cookie } })).json();
    const draft = (Array.isArray(list) ? list : (list.studies ?? [])).find((s) => s.status === 'draft');
    assert(draft, "tilia's demo account has no draft study");
    target = path.replace('{draft}', draft.id);
  }
  return withChromePage(async (send) => {
    await openAsDemo(send, target, clicks[0]?.text ?? from, { width: 820, scale: 2 });
    for (const click of clicks) await press(send, click);
    // From the heading (or tab) that names this part down to the bottom of the window, across the main column.
    const expression = `(() => {
      window.scrollTo(0, 0);
      // The innermost element whose whole text is the name: a heading, or a tab with an icon beside its label.
      const want = ${JSON.stringify(from)};
      const el = [...document.querySelectorAll('body *')].find((e) => e.textContent.trim() === want && ![...e.children].some((c) => c.textContent.trim() === want));
      if (!el) return null;
      const main = (el.closest('main') ?? document.body).getBoundingClientRect();
      const top = Math.max(0, el.getBoundingClientRect().top - 24);
      return { x: main.left, y: top, width: main.width, height: ${height ?? 'innerHeight - top'} };
    })()`;
    const clip = (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    assert(clip, `Couldn't find "${from}" on ${path}`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
    return Buffer.from(data, 'base64');
  }, { dir });
}

/** Renders a card spec to PNG bytes. */
export async function renderCard(spec) {
  assert(spec.card in CARDS, `"${spec.card}" can't be rendered`);
  const dir = await mkdtemp(join(tmpdir(), 'tilia-card-'));
  try {
    const screens = {};
    for (const { prefix, report, url, show, picture, template, demo, app } of screensFor(spec)) {
      if (template || demo || app) {
        screens[prefix] = template ? await screenshotTemplate(template, { dir }) : demo ? await screenshotDemo(demo, { dir }) : await screenshotApp(app, { dir });
        continue;
      }
      const target = report ? await demoReportUrl(report) : url;
      // A whole page is shown from the top, cropped to the frame. A 1200px window still gets the desktop layout.
      const part = show || picture !== undefined;
      screens[prefix] = part ? await screenshotPart(target, { show, picture }, { dir }) : await screenshotPage(target, { width: 1200, height: 900, dir });
    }
    const html = join(dir, 'card.html');
    await writeFile(html, await cardHtml(spec, { screens }));
    return await screenshotPage(pathToFileURL(html).href, { width: WIDTH, height: HEIGHT, dir });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
