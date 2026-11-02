// Image cards for Tilia LinkedIn posts, from the Figma file "Tilia Social Templates" (1080 x 1350).
// A draft asks for one under a heading 2 "Image", one "key: value" per line:
//
//   card: stat
//   stat: 73%
//   label: of participants found the billing page on the first try
//
// The card is plain HTML with the fonts and photo inlined, screenshotted by headless Chrome.
import { execFile } from 'node:child_process';
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

// Each card's fields, named after the Figma text layers, with the most characters that fit the layout.
export const CARDS = {
  stat: { stat: 6, label: 80, source: { max: 60, optional: true } },
  mistake: { mistake: 80, fix: 80 },
  headline: { headline: 50, support: { max: 110, optional: true } },
  template: { type: 20, name: 40, github: { max: 30, optional: true } },
  screenshot: { caption: 40, url: 300 },
};
const SCREENSHOT_HOSTS = ['tilialabs.io', 'www.tilialabs.io'];

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
  if (card === 'screenshot') {
    let url;
    try {
      url = new URL(out.url);
    } catch {
      throw new Error(`"${out.url}" isn't a URL`);
    }
    assert(url.protocol === 'https:' && SCREENSHOT_HOSTS.includes(url.hostname), 'Screenshot cards only show pages on https://tilialabs.io');
  }
  return out;
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
    <div class="content stack" style="gap:24px">
      <div class="block mistake"><p class="block-heading">The mistake</p><p class="block-text">${escape(s.mistake)}</p></div>
      <div class="block fix"><p class="block-heading">The fix</p><p class="block-text">${escape(s.fix)}</p></div>
    </div>`,
  headline: (s) => `
    <div class="content stack" style="gap:48px">
      <p class="headline">${escape(s.headline)}</p>
      ${s.support ? `<p class="support">${escape(s.support)}</p>` : ''}
    </div>`,
  template: (s, a) => `
    <div class="content stack" style="gap:40px">
      <p class="pill">${escape(s.type)}</p>
      <p class="name">${escape(s.name)}</p>
      <div class="github"><span class="icon"><img src="${a.github}" width="32.0187" height="35.3333" alt=""></span><p>${escape(s.github ?? 'Free on GitHub')}</p></div>
    </div>`,
  screenshot: (s, a) => `
    <div class="content stack" style="top:200px;height:993px;gap:48px">
      <p class="caption">${escape(s.caption)}</p>
      <div class="frame"><img src="${a.screenshot}" alt=""></div>
    </div>`,
};

/** The card as a self-contained HTML page. `screenshot` is a PNG of the page, for screenshot cards. */
export async function cardHtml(spec, { screenshot } = {}) {
  const assets = {
    background: await dataUri('assets/background.jpg', 'image/jpeg'),
    github: await dataUri('assets/github.svg', 'image/svg+xml'),
    fraunces: await dataUri('fonts/Fraunces.ttf', 'font/ttf'),
    bricolage: await dataUri('fonts/BricolageGrotesque.ttf', 'font/ttf'),
    screenshot: screenshot ? `data:image/png;base64,${screenshot.toString('base64')}` : '',
  };
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: Fraunces; src: url(${assets.fraunces}); font-weight: 100 900; }
@font-face { font-family: Bricolage; src: url(${assets.bricolage}); font-weight: 200 800; font-stretch: 75% 100%; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
.card { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; background: #fff url(${assets.background}) 0 0 / ${WIDTH}px ${HEIGHT}px no-repeat; overflow: hidden; overflow-wrap: break-word; }
.serif { font-family: Fraunces; font-variation-settings: "SOFT" 0, "WONK" 1; }
.sans, .label, .source, .support, .block-heading, .block-text, .pill, .github p, .url { font-family: Bricolage; font-variation-settings: "opsz" 14, "wdth" 100; }
.logo { position: absolute; left: 64px; top: 64px; font-weight: 600; font-size: 70.405px; line-height: 1; letter-spacing: -1.4081px; color: #13110c; }
.content { position: absolute; left: 64px; top: 232px; width: 952px; }
.stack { display: flex; flex-direction: column; align-items: flex-start; }
.stack > * { flex-shrink: 0; }
.url { position: absolute; left: 64px; top: 1241px; font-weight: 500; font-size: 32px; line-height: 1.4; color: #faf7f2; white-space: nowrap; }
.stat { font-family: Fraunces; font-variation-settings: "SOFT" 0, "WONK" 1; font-weight: 600; font-size: 280px; line-height: 1; letter-spacing: -11.2px; color: #384329; width: 100%; }
.label { font-weight: 500; font-size: 48px; line-height: 1.35; letter-spacing: -0.48px; color: #13110c; width: 100%; }
.source { font-weight: 400; font-size: 32px; line-height: 1.4; color: #5f5949; width: 100%; }
.block { display: flex; gap: 16px; align-items: flex-start; width: 100%; padding: 48px; border: 1px solid; border-radius: 16px; }
.block.mistake { background: #faf7f2; border-color: #7d4220; }
.block.fix { background: #f1f3ec; border-color: #384329; }
.block-heading { flex: 0 0 200px; height: 40px; display: flex; align-items: center; font-weight: 600; font-size: 24px; line-height: 1.4; letter-spacing: 1.2px; text-transform: uppercase; }
.mistake .block-heading { color: #7d4220; }
.fix .block-heading { color: #475636; }
.block-text { flex: 1 0 0; min-width: 1px; font-weight: 400; font-size: 32px; line-height: 1.15; color: #13110c; }
.headline { font-family: Fraunces; font-variation-settings: "SOFT" 0, "WONK" 1; font-weight: 600; font-size: 104px; line-height: 1.05; color: #13110c; width: 100%; }
.support { font-weight: 400; font-size: 40px; line-height: 1.35; color: #5f5949; width: 100%; }
.pill { background: #475636; color: #fff; padding: 12px 28px; border-radius: 9999px; font-weight: 500; font-size: 32px; line-height: 1.4; white-space: nowrap; }
.name { font-family: Fraunces; font-variation-settings: "SOFT" 0, "WONK" 1; font-weight: 600; font-size: 112px; line-height: 1.05; color: #13110c; width: 100%; }
.github { display: flex; gap: 16px; align-items: center; }
.github .icon { position: relative; width: 40px; height: 40px; flex: none; overflow: hidden; }
.github .icon img { position: absolute; left: 2.33px; top: 2.33px; display: block; }
.github p { font-weight: 600; font-size: 36px; line-height: 1.4; color: #384329; white-space: nowrap; }
.caption { font-family: Fraunces; font-variation-settings: "SOFT" 0, "WONK" 1; font-weight: 400; font-size: 48px; line-height: 1.15; letter-spacing: -0.48px; color: #13110c; width: 100%; }
.frame { flex: 1 0 0 !important; min-height: 1px; width: 100%; background: #f2ede4; border: 2px solid #e5ddd0; border-radius: 16px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.16); overflow: hidden; }
.frame img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
</style></head><body>
<div class="card">
  <p class="logo serif">tilia</p>
  ${BODIES[spec.card](spec, assets)}
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

/** Renders a card spec to PNG bytes. */
export async function renderCard(spec) {
  assert(spec.card in CARDS, `"${spec.card}" can't be rendered`);
  const dir = await mkdtemp(join(tmpdir(), 'tilia-card-'));
  try {
    // The frame is 948 x 886 inside its border. A 1200px window still gets the desktop layout, with text big enough to read.
    const screenshot = spec.card === 'screenshot' ? await screenshotPage(spec.url, { width: 1200, height: 1122, dir }) : undefined;
    const html = join(dir, 'card.html');
    await writeFile(html, await cardHtml(spec, { screenshot }));
    return await screenshotPage(pathToFileURL(html).href, { width: WIDTH, height: HEIGHT, dir });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
