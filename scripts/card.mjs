// Renders image cards locally, to check them against the Figma file.
//   node scripts/card.mjs [out-dir]              every example in cards/examples.json
//   node scripts/card.mjs <pageId> [out-dir]     the card a Tilia GTM page asks for
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { imageSection, parseSpec, renderCard, validateSpec } from './lib/card.mjs';
import { listBlocks } from './lib/notion.mjs';

const [first, second] = process.argv.slice(2);
const isPageId = first && /^[0-9a-f-]{32,36}$/i.test(first);
const outDir = (isPageId ? second : first) ?? 'cards/out';
await mkdir(outDir, { recursive: true });

let specs;
if (isPageId) {
  const section = imageSection(await listBlocks(first));
  if (!section) throw new Error('That page has no "Image" heading');
  specs = [parseSpec(section.lines)];
} else {
  specs = JSON.parse(await readFile('cards/examples.json', 'utf8')).map(validateSpec);
}

for (const [i, spec] of specs.entries()) {
  if (spec.card === 'none') {
    console.log('The page asks for no image.');
    continue;
  }
  const file = join(outDir, `${i + 1}-${spec.card}.png`);
  await writeFile(file, await renderCard(spec));
  console.log(`Saved ${file}`);
}
