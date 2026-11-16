// Every screen an image card can show, for reviewing posts: each part of the demo reports that `show:` can zoom
// in on (found on the page, so the list can't drift from what works), each method page picture for `visual:`, and
// each template as a `template:` card shows it. Writes PNGs and manifest.json to cards/out/kitchen-sink/.
//   npm run kitchen-sink
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_SCREENS, DEMO_REPORTS, EXPLORE_DEMOS, METHOD_VISUALS, demoReportUrl, findBox, screenshotApp, screenshotDemo, screenshotPart, screenshotTemplate, withChromePage } from './lib/card.mjs';

const OUT = 'cards/out/kitchen-sink';
const SITE = 'https://tilialabs.io';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// Runs in the page: every box a card can zoom in on, each with the first text inside it that `show:` resolves back
// to that same box (the rule findBox uses: the first element with exactly that text, then its nearest box).
const findParts = `(() => {
  const norm = (s) => (s ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const isBox = (n) => { const s = getComputedStyle(n); return parseFloat(s.borderTopLeftRadius) > 0 && (parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== 'none'); };
  const boxOf = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (isBox(n)) return n; return el; };
  const leaves = [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && norm(e.textContent));
  // A box with only an image (a heatmap) is found by its alt text or aria-label, which findBox also matches.
  const named = [...document.querySelectorAll('[alt], [aria-label]')];
  const resolve = (text) => leaves.find((e) => norm(e.textContent) === norm(text))
    ?? named.find((e) => norm(e.getAttribute('alt')) === norm(text) || norm(e.getAttribute('aria-label')) === norm(text));
  const parts = [];
  for (const box of document.querySelectorAll('body *')) {
    const r = box.getBoundingClientRect();
    if (!isBox(box) || r.width < 160 || r.height < 80) continue;
    const label = [...box.querySelectorAll('*')]
      .flatMap((e) => [e.children.length === 0 ? e.textContent : '', e.getAttribute('alt') ?? '', e.getAttribute('aria-label') ?? ''])
      .map((t) => t.replace(/\\s+/g, ' ').trim())
      .filter((t) => t.length >= 3 && t.length <= 80)
      .slice(0, 8)
      .find((t) => { const el = resolve(t); return el && boxOf(el) === box; });
    if (label && !parts.includes(label)) parts.push(label);
  }
  return parts;
})()`;

/** Each zoomable part of a demo study's shared report, captured the way a card captures it. */
async function reportParts(method, dir) {
  const url = await demoReportUrl(method);
  return withChromePage(async (send) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 520, height: 1000, deviceScaleFactor: 2, mobile: false });
    await send('Page.navigate', { url });
    await delay(6000);
    const labels = (await send('Runtime.evaluate', { expression: findParts, returnByValue: true })).result.value ?? [];
    const parts = [];
    for (const show of labels) {
      const clip = (await send('Runtime.evaluate', { expression: findBox(show), returnByValue: true })).result.value;
      if (!clip) continue;
      await delay(300);
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
      const file = `report-${slug(method)}-${slug(show)}.png`;
      await writeFile(join(OUT, file), Buffer.from(data, 'base64'));
      parts.push({ kind: 'report', group: method, lines: [`report: ${method}`, `show: ${show}`], file });
    }
    return parts;
  }, { dir });
}

/** The templates in tilia-labs/ux-research-templates that a template card can show: tree tests and card sorts. */
async function templateLinks() {
  const links = [];
  for (const folder of ['tree-tests', 'card-sorts']) {
    const res = await fetch(`https://api.github.com/repos/tilia-labs/ux-research-templates/contents/templates/${folder}`, { headers: { 'User-Agent': 'tilia-briefs' } });
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for the ${folder} templates`);
    for (const { name } of await res.json()) if (name.endsWith('.md')) links.push(`https://github.com/tilia-labs/ux-research-templates/blob/main/templates/${folder}/${name}`);
  }
  return links;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const dir = await mkdtemp(join(tmpdir(), 'kitchen-sink-'));
const items = [];
try {
  for (const method of Object.keys(DEMO_REPORTS)) {
    const parts = await reportParts(method, dir);
    console.log(`${method}: ${parts.length} parts`);
    items.push(...parts);
  }
  for (const [method, { path, pictures }] of Object.entries(METHOD_VISUALS)) {
    for (const [i, picture] of pictures.entries()) {
      const file = `visual-${slug(method)}-${picture}.png`;
      await writeFile(join(OUT, file), await screenshotPart(`${SITE}${path}`, { picture: i }, { dir }));
      items.push({ kind: 'visual', group: method, lines: [`visual: ${method} ${picture}`], file });
    }
    console.log(`${method}: ${pictures.length} pictures`);
  }
  for (const name of Object.keys(EXPLORE_DEMOS)) {
    const file = `demo-${slug(name)}.png`;
    await writeFile(join(OUT, file), await screenshotDemo(name, { dir }));
    items.push({ kind: 'demo', group: 'feature demos', lines: [`demo: ${name}`], file });
    console.log(`demo: ${name}`);
  }
  for (const name of Object.keys(APP_SCREENS)) {
    const file = `app-${slug(name)}.png`;
    await writeFile(join(OUT, file), await screenshotApp(name, { dir }));
    items.push({ kind: 'app', group: 'app screens', lines: [`app: ${name}`], file });
    console.log(`app: ${name}`);
  }
  for (const link of await templateLinks()) {
    const name = link.split('/').pop().replace('.md', '');
    const file = `template-${name}.png`;
    await writeFile(join(OUT, file), await screenshotTemplate(link, { dir }));
    items.push({ kind: 'template', group: link.includes('/tree-tests/') ? 'tree test' : 'card sort', lines: [`template: ${link}`], file });
    console.log(`template: ${name}`);
  }
} finally {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
const made = new Date().toISOString().slice(0, 10);
await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ made, items }, null, 2));
await writeFile(join(OUT, 'index.html'), page(items, made));
console.log(`${items.length} screens in ${OUT}; publish ${OUT}/index.html with the PNGs beside it`);

function page(items, made) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SECTIONS = [
    ['report', 'Demo report parts', 'Zoomed-in parts of the demo studies’ shared reports. Use on a <code>headline</code> card (or <code>template</code>, though a template card should show its own template).'],
    ['visual', 'Method pictures', 'Still pictures from the method pages on tilialabs.io. Use on a <code>compare</code> card as <code>left visual:</code> and <code>right visual:</code>, or on a <code>headline</code> card as <code>visual:</code>.'],
    ['demo', 'Feature demos', 'The feature demos from the app’s Explore page, on the still frame each rests on. Use on a <code>headline</code> card as <code>demo:</code>. Features that aren’t live yet are left out.'],
    ['app', 'App screens', 'Parts of the real app, opened as the demo account. Use on a <code>headline</code> card as <code>app:</code>. A screen that’s empty here is empty in the demo account too.'],
    ['template', 'Templates', 'Each template as a <code>template</code> card shows it, in tilia’s participant view. On a draft, use the link to the template’s PR branch until it’s merged.'],
  ];
  const card = (i) => `
      <figure class="shot">
        <button class="frame" type="button" data-full="${esc(i.file)}" aria-label="Show ${esc(i.lines.at(-1))} full size"><img src="${esc(i.file)}" alt="" loading="lazy"></button>
        <figcaption>
          <pre>${esc(i.lines.join('\n'))}</pre>
          <button class="copy" type="button" data-copy="${esc(i.lines.join('\n'))}">Copy</button>
        </figcaption>
      </figure>`;
  const sections = SECTIONS.map(([kind, title, note]) => {
    const groups = [...new Set(items.filter((i) => i.kind === kind).map((i) => i.group))];
    return `
  <section id="${kind}">
    <header class="section-head"><h2>${title}</h2><p>${note}</p></header>
    ${groups.map((g) => `
    <h3>${esc(g)}</h3>
    <div class="grid">${items.filter((i) => i.kind === kind && i.group === g).map(card).join('')}
    </div>`).join('')}
  </section>`;
  }).join('');
  return `<title>Card Screen Catalogue</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600&family=Fraunces:opsz,wght@9..144,600&display=swap">
<style>
/* A contact sheet: tilia's own palette and type, one grid of screens per method, spec lines under each. */
:root {
  --bg: #f6f3ec; --surface: #fffdf8; --sunken: #ece6da; --line: #ddd4c4;
  --ink: #13110c; --muted: #5f5949; --accent: #475636; --accent-ink: #ffffff;
  --display: "Fraunces", Georgia, serif;
  --text: "Bricolage Grotesque", system-ui, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #171a13; --surface: #20241b; --sunken: #2a2f23; --line: #3a4130;
  --ink: #f1eee6; --muted: #b3ad9d; --accent: #a9bf8a; --accent-ink: #171a13; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #171a13; --surface: #20241b; --sunken: #2a2f23; --line: #3a4130;
  --ink: #f1eee6; --muted: #b3ad9d; --accent: #a9bf8a; --accent-ink: #171a13; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 400 15px/1.5 var(--text);
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 32px 64px; }
.wrap { max-width: 1240px; margin: 0 auto; display: grid; gap: 48px; }
h1, h2, h3 { font-family: var(--display); font-weight: 600; text-wrap: balance; margin: 0; }
h1 { font-size: clamp(30px, 4vw, 44px); line-height: 1.05; }
h2 { font-size: 26px; }
h3 { font-size: 13px; font-family: var(--text); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 28px 0 12px; }
.intro { display: grid; gap: 12px; max-width: 68ch; }
.intro p { margin: 0; color: var(--muted); }
nav { display: flex; flex-wrap: wrap; gap: 8px; }
nav a { color: var(--accent); border: 1px solid var(--line); border-radius: 999px; padding: 4px 14px; text-decoration: none; font-weight: 500; }
nav a:hover, nav a:focus-visible { background: var(--surface); }
code { font-family: var(--mono); font-size: 0.9em; background: var(--sunken); padding: 1px 5px; border-radius: 4px; }
.section-head { display: grid; gap: 6px; border-bottom: 1px solid var(--line); padding-bottom: 12px; }
.section-head p { margin: 0; color: var(--muted); max-width: 72ch; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 270px), 1fr)); gap: 16px; align-items: start; }
.shot { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; display: grid; min-width: 0; }
.frame { all: unset; cursor: zoom-in; display: flex; align-items: flex-start; justify-content: center; background: var(--sunken); height: 240px; overflow: hidden; padding: 12px; }
.frame:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.frame img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
figcaption { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-top: 1px solid var(--line); min-width: 0; }
pre { flex: 1; min-width: 0; margin: 0; font: 12.5px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.copy { font: 500 12px var(--text); color: var(--accent-ink); background: var(--accent); border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer; flex: none; }
.copy:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
dialog { border: 0; padding: 0; background: transparent; max-width: min(96vw, 1100px); max-height: 92vh; }
dialog::backdrop { background: rgb(0 0 0 / 0.7); }
dialog img { display: block; max-width: 100%; max-height: 92vh; border-radius: 8px; background: var(--surface); }
</style>
<div class="wrap">
  <header class="intro">
    <h1>Card screen catalogue</h1>
    <p>Every screen an image card can show, captured ${made}. Copy the lines under a screen into a draft’s Image section to swap its screen. The report parts were found on the reports themselves, so each line zooms to exactly the part shown.</p>
    <nav>${SECTIONS.map(([kind, title]) => `<a href="#${kind}">${title}</a>`).join('')}</nav>
  </header>
  ${sections}
</div>
<dialog id="viewer"><img alt=""></dialog>
<script>
const viewer = document.getElementById('viewer');
document.addEventListener('click', async (e) => {
  const frame = e.target.closest('.frame');
  if (frame) { viewer.querySelector('img').src = frame.dataset.full; viewer.showModal(); return; }
  if (e.target === viewer || e.target.closest('dialog')) { viewer.close(); return; }
  const copy = e.target.closest('.copy');
  if (!copy) return;
  try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = 'Copied'; }
  catch { const range = document.createRange(); range.selectNodeContents(copy.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(range); copy.textContent = 'Selected'; }
  setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
});
</script>
`;
}
