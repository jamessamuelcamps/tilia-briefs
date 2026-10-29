// Usage: node scripts/alert.mjs "<title>"   (GitHub Actions: a failure outside the scripts, with a link to the run)
import { notify, runLink } from './lib/notify.mjs';

const title = process.argv[2] ?? 'A briefs workflow failed';
const link = runLink();
await notify(null, link ? { title, link } : { title });
