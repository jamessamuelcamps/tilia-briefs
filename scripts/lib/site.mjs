import { requireEnv } from './env.mjs';

const API = 'https://api.github.com';
const LIVE_TIMEOUT_MS = 10 * 60 * 1000;
const LIVE_POLL_MS = 20 * 1000;

async function github(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv('PORTFOLIO_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tilia-briefs',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === 'GET') return null;
  const json = await res.json();
  if (!res.ok) throw new Error(`GitHub ${method} ${path} failed (${res.status}): ${json.message}`);
  return json;
}

/** Commits one file to the site repo, replacing it if it's already there. The push starts the site's own deploy. */
export async function commitFile({ repo, branch, path, content, message }) {
  const existing = await github(`/repos/${repo}/contents/${path}?ref=${branch}`);
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  if (existing && existing.content.replace(/\s/g, '') === encoded) return false;
  await github(`/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: { message, content: encoded, branch, sha: existing?.sha },
  });
  return true;
}

/** Waits for the deploy to finish by asking the site for the page. */
export async function waitUntilLive(url) {
  const deadline = Date.now() + LIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, LIVE_POLL_MS));
  }
  throw new Error(`The post was committed but ${url} still isn't live after 10 minutes. Check the site's deploy.`);
}
