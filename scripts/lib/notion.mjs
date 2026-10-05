import { requireEnv } from './env.mjs';

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

export const STATUSES = ['Idea', 'Briefed', 'Posted', 'Dropped'];
export const SOURCES = ['Spreadsheet', 'Research', 'Manual'];
export const OWNERS = ['Personal', 'Tilia'];

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv('NOTION_TOKEN')}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Notion ${method} ${path} failed (${res.status}): ${json.message}`);
  return json;
}

const text = (content) => [{ type: 'text', text: { content: String(content).slice(0, 2000) } }];
const select = (names) => ({ select: { options: names.map((name) => ({ name })) } });

export async function createDatabase(parentPageId) {
  return call('/databases', {
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: parentPageId },
      title: text('Content ideas'),
      properties: {
        Name: { title: {} },
        Owner: select(OWNERS),
        Status: select(STATUSES),
        Notes: { rich_text: {} },
        Source: select(SOURCES),
        'Source URL': { url: {} },
        'Post date': { date: {} },
      },
    },
  });
}

function toIdea(page) {
  const p = page.properties;
  return {
    id: page.id,
    url: page.url,
    title: p.Name.title.map((t) => t.plain_text).join(''),
    owner: p.Owner.select?.name ?? null,
    status: p.Status.select?.name ?? null,
    notes: p.Notes.rich_text.map((t) => t.plain_text).join(''),
    source: p.Source.select?.name ?? null,
    sourceUrl: p['Source URL'].url ?? null,
    postDate: p['Post date'].date?.start?.slice(0, 10) ?? null,
  };
}

/** All ideas for an owner, optionally limited to some statuses. */
export async function queryIdeas(owner, statuses = STATUSES) {
  const databaseId = requireEnv('NOTION_DATABASE_ID');
  const filter = {
    and: [
      { property: 'Owner', select: { equals: owner } },
      { or: statuses.map((s) => ({ property: 'Status', select: { equals: s } })) },
    ],
  };
  const ideas = [];
  let cursor;
  do {
    const res = await call(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: { filter, page_size: 100, start_cursor: cursor },
    });
    ideas.push(...res.results.map(toIdea));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return ideas;
}

export async function createIdea({ title, owner, notes = '', source = 'Manual', sourceUrl = null, status = 'Idea' }) {
  const page = await call('/pages', {
    method: 'POST',
    body: {
      parent: { database_id: requireEnv('NOTION_DATABASE_ID') },
      properties: {
        Name: { title: text(title) },
        Owner: { select: { name: owner } },
        Status: { select: { name: status } },
        Notes: { rich_text: notes ? text(notes) : [] },
        Source: { select: { name: source } },
        'Source URL': { url: sourceUrl },
      },
    },
  });
  return toIdea(page);
}

export async function markBriefed(pageId, postDate) {
  return call(`/pages/${pageId}`, {
    method: 'PATCH',
    body: { properties: { Status: { select: { name: 'Briefed' } }, 'Post date': { date: { start: postDate } } } },
  });
}

export async function appendBlocks(pageId, children) {
  return call(`/blocks/${pageId}/children`, { method: 'PATCH', body: { children } });
}
