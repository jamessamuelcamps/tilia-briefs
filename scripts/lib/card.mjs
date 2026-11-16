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
// of the page holding that exact text, such as a heading. All optional: without a screen, the card is text only.
const screenFields = (prefix = '') => ({
  [`${prefix}report`]: { max: 20, optional: true },
  [`${prefix}url`]: { max: 300, optional: true },
  [`${prefix}show`]: { max: 80, optional: true },
});

// Each card's fields, named after the Figma text layers, with the most characters that fit the layout.
export const CARDS = {
  stat: { stat: 6, label: 80, source: { max: 60, optional: true } },
  mistake: { title: 50, mistake: 80, fix: 80 },
  headline: { headline: 50, support: { max: 110, optional: true }, ...screenFields() },
  // Two options side by side under a question, e.g. open vs closed card sort, each with its own screen or neither.
  compare: { headline: 50, left: 20, 'left text': 90, right: 20, 'right text': 90, ...screenFields('left '), ...screenFields('right ') },
  template: { type: 20, name: 40, ...screenFields() },
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
  const login = await fetch(`${SITE}/api/auth/demo`, { redirect: 'manual' });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert(cookie, `Couldn't log in to tilia's demo account (${login.status})`);
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
  assert(withScreen.length === 0 || withScreen.length === slots.length, `A ${card} card needs a screen on both sides or neither`);
  return out;
}

/** Checks one screen's fields in place (lower-casing `report`). True if the card shows a screen there. */
function validateScreen(out, prefix) {
  const [report, url, show] = ['report', 'url', 'show'].map((k) => `${prefix}${k}`);
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

/** The screens a spec asks for: the field prefix, and the report method or URL, plus the text to zoom in on. */
function screensFor(spec) {
  return (SCREEN_SLOTS[spec.card] ?? [])
    .filter((prefix) => spec[`${prefix}report`] || spec[`${prefix}url`])
    .map((prefix) => ({ prefix, report: spec[`${prefix}report`], url: spec[`${prefix}url`], show: spec[`${prefix}show`] }));
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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
      <p class="title">${escape(s.title)}</p>
      <div class="block mistake">${ICONS.cross}<div class="stack" style="gap:32px"><p class="block-heading">The mistake</p><p class="block-text">${escape(s.mistake)}</p></div></div>
      <div class="block fix">${ICONS.tick}<div class="stack" style="gap:32px"><p class="block-heading">The fix</p><p class="block-text">${escape(s.fix)}</p></div></div>
    </div>`,
  compare: (s, screens) => `
    <div class="content stack" style="gap:56px">
      <p class="headline">${escape(s.headline)}</p>
      <div class="pair${screens['left '] ? ' with-screens' : ''}">
        <div class="side left">${frame(screens['left '], s['left show'])}<p class="side-name">${escape(s.left)}</p><p class="side-text">${escape(s['left text'])}</p></div>
        <div class="side right">${frame(screens['right '], s['right show'])}<p class="side-name">${escape(s.right)}</p><p class="side-text">${escape(s['right text'])}</p></div>
        <p class="or">or</p>
      </div>
    </div>`,
  headline: (s, screens) => `
    <div class="content stack" style="gap:64px;${screens[''] ? 'height:953px' : ''}">
      <div class="stack" style="gap:24px;width:100%">
        <p class="headline">${escape(s.headline)}</p>
        ${s.support ? `<p class="support">${escape(s.support)}</p>` : ''}
      </div>
      ${frame(screens[''], s.show)}
    </div>`,
  template: (s, screens) => `
    <p class="pill">Free download</p>
    <div class="content stack" style="gap:64px;${screens[''] ? 'height:945px' : ''}">
      <div class="stack" style="gap:24px;width:100%">
        <p class="support">${escape(s.type)} template</p>
        <p class="title">${escape(s.name)}</p>
      </div>
      ${frame(screens[''], s.show)}
    </div>`,
};

// The cross and tick from the Figma mistake card.
const ICONS = {
  cross: `<svg class="icon" width="88" height="88" viewBox="0 0 88 88"><rect width="88" height="88" rx="44" fill="#7D4220"/><path d="M63.43 60.67a1.95 1.95 0 0 1-2.76 2.76L44.5 47.26 28.33 63.43a1.95 1.95 0 0 1-2.76-2.76L41.74 44.5 25.57 28.33a1.95 1.95 0 0 1 2.76-2.76L44.5 41.74l16.17-16.17a1.95 1.95 0 0 1 2.76 2.76L47.26 44.5z" fill="#fff"/></svg>`,
  tick: `<svg class="icon" width="88" height="88" viewBox="0 0 88 88"><rect width="88" height="88" rx="44" fill="#475636"/><path d="M67.45 30.23 37.37 60.45a1.88 1.88 0 0 1-2.66 0L21.55 47.22a1.89 1.89 0 0 1 2.66-2.67l11.83 11.89 28.75-28.89a1.88 1.88 0 0 1 2.66 2.68z" fill="#fff"/></svg>`,
};

/** A screenshot frame for this PNG (zoomed in if `show` picked one part), or nothing without one. */
function frame(png, show) {
  if (!png) return '';
  // A zoomed part fills the frame's width but is never shown bigger than its own pixels, so a small one stays sharp
  // (the width is in the PNG header). A part taller than the frame shows its top, which is where the heading is.
  const size = show ? `max-width:min(100%,${png.readUInt32BE(16)}px)` : '';
  return `<div class="frame${show ? ' zoom' : ''}"><img src="data:image/png;base64,${png.toString('base64')}" style="${size}" alt=""></div>`;
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
.side .frame { flex: none !important; height: 300px; border-radius: 10px; border: none; box-shadow: none; }
.side .frame.zoom { padding: 16px 16px 0; }
.side .frame.zoom::after { height: 32px; }
.pair:not(.with-screens) { gap: 120px; }
.pair:not(.with-screens) .side { padding: 40px; }
.pair:not(.with-screens) .side-name { font-size: 64px; }
.pair:not(.with-screens) .side-text { font-size: 36px; }
.right .frame { background: #5c6b4a; }
.or { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 96px; height: 96px; border-radius: 50%; background: #fff; border: 2px solid #e5ddd0; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.16); display: flex; align-items: center; justify-content: center; font-size: 44px; line-height: 1; padding-bottom: 6px; color: #13110c; }
.with-screens .or { top: 182px; }
.pill { position: absolute; right: 64px; top: 64px; background: #475636; color: #fff; padding: 12px 28px; border-radius: 9999px; font-weight: 500; font-size: 32px; line-height: 1.4; white-space: nowrap; }
.frame { flex: 1 0 0 !important; min-height: 1px; width: 100%; background: #f2ede4; border: 2px solid #e5ddd0; border-radius: 16px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.16); overflow: hidden; }
.frame img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.frame.zoom { position: relative; background: #faf7f2; padding: 40px 40px 0; display: flex; flex-direction: column; align-items: center; justify-content: safe center; }
.frame.zoom img { flex: none; width: 100%; height: auto; }
.frame.zoom::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 64px; background: linear-gradient(rgba(250, 247, 242, 0), #faf7f2); }
.right .frame.zoom::after { background: none; }
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
async function withChromePage(fn, { dir }) {
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
const findBox = (show) => `(() => {
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

// Narrow enough that the app's text is large once the part is scaled to fill the frame.
const ZOOM_WIDTH = 520;

/** A PNG of the boxed part of a page that holds the text `show`, rendered at a narrow width and triple resolution. */
async function screenshotPart(url, show, { dir }) {
  return withChromePage(async (send) => {
    await send('Emulation.setDeviceMetricsOverride', { width: ZOOM_WIDTH, height: 1000, deviceScaleFactor: 3, mobile: false });
    await send('Page.navigate', { url });
    let clip = null;
    for (let i = 0; i < 40 && !clip; i++) {
      await delay(500);
      clip = (await send('Runtime.evaluate', { expression: findBox(show), returnByValue: true })).result.value;
    }
    assert(clip, `Couldn't find "${show}" on ${url}`);
    // Let charts finish animating, then measure again in case the layout moved.
    await delay(1500);
    clip = (await send('Runtime.evaluate', { expression: findBox(show), returnByValue: true })).result.value ?? clip;
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
    return Buffer.from(data, 'base64');
  }, { dir });
}

/** Renders a card spec to PNG bytes. */
export async function renderCard(spec) {
  assert(spec.card in CARDS, `"${spec.card}" can't be rendered`);
  const dir = await mkdtemp(join(tmpdir(), 'tilia-card-'));
  try {
    const screens = {};
    for (const { prefix, report, url, show } of screensFor(spec)) {
      const target = report ? await demoReportUrl(report) : url;
      // A whole page is shown from the top, cropped to the frame. A 1200px window still gets the desktop layout.
      screens[prefix] = show ? await screenshotPart(target, show, { dir }) : await screenshotPage(target, { width: 1200, height: 900, dir });
    }
    const html = join(dir, 'card.html');
    await writeFile(html, await cardHtml(spec, { screens }));
    return await screenshotPage(pathToFileURL(html).href, { width: WIDTH, height: HEIGHT, dir });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
