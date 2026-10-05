import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

/**
 * Runs Claude Code headlessly. Locally it uses your `claude` login; in CI it uses
 * CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`), so usage comes from your plan.
 */
export function askClaude(prompt, { tools = [] } = {}) {
  const args = ['-p', '--output-format', 'json', '--model', process.env.CLAUDE_MODEL || 'sonnet'];
  if (tools.length) args.push('--allowedTools', tools.join(','));

  return new Promise((resolve, reject) => {
    // Run outside the repo so this project's CLAUDE.md isn't loaded into the prompt.
    // On Windows `claude` is a .cmd shim, so it needs a shell; the args are fixed flags, never user input.
    const child =
      process.platform === 'win32'
        ? spawn(`claude ${args.join(' ')}`, { cwd: tmpdir(), shell: true })
        : spawn('claude', args, { cwd: tmpdir() });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      let envelope;
      try {
        envelope = JSON.parse(out);
      } catch {
        return reject(new Error(`claude exited ${code} with unexpected output: ${(err || out).slice(0, 800)}`));
      }
      if (code !== 0 || envelope.is_error) return reject(new Error(`claude failed: ${envelope.result ?? err}`));
      resolve(envelope.result);
    });
    child.stdin.end(prompt);
  });
}

export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

/** Asks for JSON, validates it, and retries once with the validation error if it's wrong. */
export async function askClaudeJson(prompt, validate, options) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const fullPrompt =
      attempt === 1
        ? prompt
        : `${prompt}\n\nYour previous reply was invalid: ${lastError.message}\nReply again with corrected JSON only.`;
    const reply = await askClaude(fullPrompt, options);
    try {
      const data = extractJson(reply);
      validate(data);
      return data;
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt} invalid: ${error.message}`);
    }
  }
  throw lastError;
}
