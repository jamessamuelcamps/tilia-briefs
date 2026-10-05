import { requireEnv } from './env.mjs';

export async function postToSlack(text) {
  const res = await fetch(requireEnv('SLACK_WEBHOOK_URL'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack webhook failed (${res.status}): ${await res.text()}`);
}

/** Slack mrkdwn treats &, < and > as control characters. */
export function escapeSlack(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
