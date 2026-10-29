import { assert, isText, rich, wordCount } from './brief.mjs';

const POST_HEADING = 'Finished post';
const CUT_HEADING = 'LinkedIn cut';

const MARKDOWN_PREFIX = {
  paragraph: '',
  heading_1: '## ',
  heading_2: '## ',
  heading_3: '### ',
  bulleted_list_item: '- ',
  numbered_list_item: '1. ',
  quote: '> ',
};
const isListItem = (type) => type.endsWith('_list_item');

const plain = (richText) => richText.map((t) => t.plain_text).join('');
const isHeading = (block, title) => block.type === 'heading_2' && plain(block.heading_2.rich_text).trim() === title;

function toMarkdown(richText) {
  return richText
    .map((t) => {
      // Markers go inside any surrounding spaces, or Markdown won't treat them as emphasis.
      const [, lead, core, trail] = t.plain_text.match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (!core) return t.plain_text;
      const a = t.annotations ?? {};
      let out = core;
      if (a.code) out = `\`${out}\``;
      if (a.bold) out = `**${out}**`;
      if (a.italic) out = `*${out}*`;
      if (t.href) out = `[${out}](${t.href})`;
      return lead + out + trail;
    })
    .join('');
}

export const hasCut = (blocks) => blocks.some((b) => isHeading(b, CUT_HEADING));

/** The paragraphs James wrote under "Finished post", each with its Notion block id so comments can attach to it. */
export function extractPost(blocks) {
  const start = blocks.findIndex((b) => isHeading(b, POST_HEADING));
  assert(start !== -1, `There's no "${POST_HEADING}" heading on the page`);

  const paragraphs = [];
  for (const block of blocks.slice(start + 1)) {
    if (block.type === 'divider' || isHeading(block, CUT_HEADING)) break;
    const prefix = MARKDOWN_PREFIX[block.type];
    assert(prefix !== undefined, `The finished post has a "${block.type}" block, which can't be published yet; use text, headings, lists or quotes`);
    const richText = block[block.type].rich_text;
    const text = plain(richText).trim();
    if (text) paragraphs.push({ id: block.id, type: block.type, text, markdown: prefix + toMarkdown(richText).trim() });
  }
  assert(paragraphs.length, `Nothing is written under "${POST_HEADING}" yet`);
  return paragraphs;
}

export const postText = (paragraphs) => paragraphs.map((p) => p.text).join('\n\n');

export function postMarkdown(paragraphs) {
  return paragraphs
    .map((p, i) => (i && isListItem(p.type) && p.type === paragraphs[i - 1].type ? '\n' : i ? '\n\n' : '') + p.markdown)
    .join('');
}

export function validateReview(review, { paragraphs }) {
  assert(review && typeof review === 'object', 'Review must be an object');
  assert(isText(review.overall), 'overall is required');
  assert(wordCount(review.overall) <= 90, 'overall must be 80 words or fewer');
  assert(Array.isArray(review.comments), 'comments must be an array');
  assert(review.comments.length <= 8, 'At most 8 comments; keep only the ones that matter');

  const seen = new Set();
  for (const [i, c] of review.comments.entries()) {
    assert(Number.isInteger(c.paragraph) && c.paragraph >= 1 && c.paragraph <= paragraphs, `Comment ${i + 1} must point at a paragraph from 1 to ${paragraphs}`);
    assert(!seen.has(c.paragraph), `Paragraph ${c.paragraph} has two comments; combine them into one`);
    seen.add(c.paragraph);
    assert(isText(c.comment), `Comment ${i + 1} is empty`);
    assert(wordCount(c.comment) <= 70, `Comment ${i + 1} is over 70 words; suggest a small tweak, not a rewrite`);
  }
}

// Words are compared without closing punctuation, so a sentence can be ended early, and without
// caring whether quote marks are curly, which Claude tends to straighten.
const core = (word) => word.replace(/[.,;:!?–—-]+$/, '');
const key = (word) => core(word).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const tokens = (v) => v.split(/\s+/).filter(Boolean);

/**
 * Checks the cut only removes text from the post, and returns it rebuilt from the post's own words,
 * so what's saved is character for character what James wrote.
 */
export function restoreCut(cut, post) {
  const source = tokens(post);
  let i = 0;
  return cut.map((paragraph) =>
    tokens(paragraph)
      .map((word) => {
        if (!key(word)) return word;
        while (i < source.length && key(source[i]) !== key(word)) i++;
        assert(i < source.length, `cut has "${word}" where the post doesn't; only remove text, never add, reorder or reword it`);
        const original = source[i++];
        const ending = word.slice(core(word).length);
        return ending === original.slice(core(original).length) ? original : core(original) + ending;
      })
      .join(' '),
  );
}

export function validatePublish(data, { post, minWords, maxWords }) {
  assert(data && typeof data === 'object', 'Reply must be an object');

  assert(Array.isArray(data.cut) && data.cut.length && data.cut.every(isText), 'cut must be a non-empty array of paragraphs');
  const count = restoreCut(data.cut, post).join(' ').split(/\s+/).filter(key).length;
  assert(count >= minWords && count <= maxWords, `cut is ${count} words; it must be between ${minWords} and ${maxWords}`);

  assert(isText(data.description), 'description is required');
  assert(data.description.length <= 160 && !data.description.includes('\n'), 'description must be one line of 160 characters or fewer');

  assert(Array.isArray(data.tags) && data.tags.length >= 1 && data.tags.length <= 3, 'Use 1 to 3 tags');
  for (const tag of data.tags) assert(isText(tag) && tag.length <= 30, 'Each tag must be a short phrase of 30 characters or fewer');
  assert(new Set(data.tags.map((t) => t.toLowerCase())).size === data.tags.length, 'tags must not repeat');
}

/** "I’d rather talk…" → "id-rather-talk" */
export function slugify(title) {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ'’‘]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The file committed to the site: front matter the writing collection expects, then the post. */
export function toSiteMarkdown({ title, description, publishDate, tags, body }) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `publishDate: ${publishDate}`,
    `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

const paragraph = (richText) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText } });

/** Blocks appended under the finished post: the cut, then the link to the full post. */
export function toCutBlocks(cut, url) {
  return [
    { object: 'block', type: 'divider', divider: {} },
    { object: 'block', type: 'heading_2', heading_2: { rich_text: rich(CUT_HEADING) } },
    ...cut.map((text) => paragraph(rich(text))),
    paragraph([...rich('This is the short version. The full post is on my site: '), { type: 'text', text: { content: url, link: { url } } }]),
  ];
}

const openInNotion = (idea) => ({ url: idea.url, label: 'Open in Notion' });

export function toReviewedMessage(review, { idea, nextStep }) {
  const count = review.comments.length;
  return {
    title: `Sub-edit done: ${idea.title}`,
    lines: [`${count} comment${count === 1 ? '' : 's'} on the draft, plus an overall note. ${nextStep}`],
    link: openInNotion(idea),
  };
}

export function toPublishedMessage({ idea, url }) {
  return {
    title: `Published: ${idea.title}`,
    lines: [`It's live at ${url}, and the LinkedIn cut is under the post. Schedule it on LinkedIn, then set the status to Posted.`],
    link: openInNotion(idea),
  };
}

export function toFailedMessage({ idea, action, error, status }) {
  return {
    title: `Couldn't ${action} "${idea.title}"`,
    lines: [error.message, `I've set it back to ${status}, so setting it again retries.`],
    link: openInNotion(idea),
  };
}
