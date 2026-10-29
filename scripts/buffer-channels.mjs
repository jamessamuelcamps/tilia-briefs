// Usage: npm run buffer:channels   Lists your Buffer channels, to find BUFFER_CHANNEL_ID for the Tilia LinkedIn page.
import { listChannels } from './lib/buffer.mjs';

for (const c of await listChannels()) console.log(`${c.id}  ${c.service}  ${c.name}  (${c.organization})`);
