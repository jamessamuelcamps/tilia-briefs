import { requireEnv } from './env.mjs';

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

// In the order a post moves through them. You set Drafted, Ready and Posted; the scripts set the rest.
export const STATUSES = ['Idea', 'Briefed', 'Drafted', 'Reviewed', 'Ready', 'Published', 'Posted', 'Dropped'];
export const BRIEFED_ONWARDS = STATUSES.filter((s) => s !== 'Idea' && s !== 'Dropped');
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

/** Adds any statuses the database doesn't have yet, keeping the existing options. Returns the ones added. */
export async function ensureStatuses() {
  const databaseId = requireEnv('NOTION_DATABASE_ID');
  const existing = (await call(`/databases/${databaseId}`)).properties.Status.select.options;
  const missing = STATUSES.filter((name) => !existing.some((o) => o.name === name));
  if (!missing.length) return missing;
  const options = [
    ...STATUSES.map((name) => existing.find((o) => o.name === name) ?? { name }),
    ...existing.filter((o) => !STATUSES.includes(o.name)),
  ];
  await call(`/databases/${databaseId}`, { method: 'PATCH', body: { properties: { Status: { select: { options } } } } });
  return missing;
}

/** Ideas with one of the given statuses, for one owner or (with owner null) for everyone. */
export async function queryIdeas(owner, statuses = STATUSES) {
  const databaseId = requireEnv('NOTION_DATABASE_ID');
  const filter = {
    and: [
      ...(owner ? [{ property: 'Owner', select: { equals: owner } }] : []),
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

export async function getIdea(pageId) {
  return toIdea(await call(`/pages/${pageId}`));
}

export async function setStatus(pageId, status) {
  return call(`/pages/${pageId}`, { method: 'PATCH', body: { properties: { Status: { select: { name: status } } } } });
}

/** Every top-level block on a page, in order. */
export async function listBlocks(pageId) {
  const blocks = [];
  let cursor;
  do {
    const res = await call(`/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

/** Comments on a page ({ page_id }) or on one block ({ block_id }). The integration needs the "Insert comments" capability. */
export async function addComment(parent, content) {
  return call('/comments', { method: 'POST', body: { parent, rich_text: text(content) } });
}
