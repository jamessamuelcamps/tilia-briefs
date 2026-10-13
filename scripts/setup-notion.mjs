// One-off: creates the "Content ideas" database and imports the GTM tracker topics.
// Safe to re-run with NOTION_DATABASE_ID set: it only adds the statuses and topics that aren't there yet.
import { readFile } from 'node:fs/promises';
import { requireEnv } from './lib/env.mjs';
import { createDatabase, createIdea, ensureStatuses, queryIdeas, OWNERS } from './lib/notion.mjs';

if (!process.env.NOTION_DATABASE_ID) {
  const database = await createDatabase(requireEnv('NOTION_PARENT_PAGE_ID'));
  process.env.NOTION_DATABASE_ID = database.id;
  console.log(`Created database: ${database.url}`);
  console.log(`\nNOTION_DATABASE_ID=${database.id}\n\nAdd that line to .env and as a GitHub secret.\n`);
}

const added = await ensureStatuses();
if (added.length) console.log(`Added statuses: ${added.join(', ')}`);

const seed = JSON.parse(await readFile(new URL('../data/seed-topics.json', import.meta.url), 'utf8'));
const existing = new Set();
for (const owner of OWNERS) {
  for (const idea of await queryIdeas(owner)) existing.add(`${owner}:${idea.title.toLowerCase()}`);
}

let imported = 0;
for (const topic of seed) {
  if (existing.has(`${topic.owner}:${topic.title.toLowerCase()}`)) continue;
  await createIdea({ ...topic, source: 'Spreadsheet' });
  imported++;
}
console.log(`Imported ${imported} topics (${seed.length - imported} already there).`);
