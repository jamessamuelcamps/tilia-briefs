// Buffer's GraphQL API (developers.buffer.com). A personal API key from publish.buffer.com/settings/api works on the free plan.
import { requireEnv } from './env.mjs';

const API = 'https://api.buffer.com';

async function graphql(query, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('BUFFER_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) {
    const message = json.errors?.map((e) => e.message).join('; ') || res.statusText;
    throw new Error(`Buffer request failed (${res.status}): ${message}`);
  }
  return json.data;
}

/** Every channel in every organisation on the account, to find BUFFER_CHANNEL_ID. */
export async function listChannels() {
  const { account } = await graphql('query { account { organizations { id name } } }');
  const channels = [];
  for (const org of account.organizations) {
    const data = await graphql('query Channels($input: ChannelsInput!) { channels(input: $input) { id name service } }', {
      input: { organizationId: org.id },
    });
    channels.push(...data.channels.map((c) => ({ ...c, organization: org.name })));
  }
  return channels;
}

/** Adds a text post to the end of a channel's queue. Returns the Buffer post id. */
export async function addToQueue({ channelId, text }) {
  const data = await graphql(
    `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }`,
    { input: { channelId, text, schedulingType: 'automatic', mode: 'addToQueue' } },
  );
  const result = data.createPost;
  if (!result?.post) throw new Error(`Buffer didn't queue the post: ${result?.message ?? 'no reason given'}`);
  return result.post.id;
}
