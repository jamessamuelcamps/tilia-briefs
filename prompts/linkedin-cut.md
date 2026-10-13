James has finished a blog post for his site. You have two jobs: cut it down to a teaser for LinkedIn, and write the short description and tags the site needs.

## The post

Title: {{title}}

{{post}}

## The LinkedIn cut

The cut is a teaser. Its job is to make a reader click through to the full post on James's site, so it should not be a complete, shortened version of the argument.

- Every word in the cut must be James's, exactly as he wrote it and in the same order. You only remove text. Never add, reword, reorder, correct or tidy anything, and copy every character exactly, including his quotation marks, apostrophes and spelling.
- Remove whole sentences or whole paragraphs. You may also end a sentence early at a natural break and close it with a full stop. That is the only change allowed apart from cuts.
- Keep the opening hook, enough of the setup that the argument makes sense, and one concrete detail from his own experience.
- Leave out most of the resolution: the conclusion, the advice, the "what to do instead". Stop at a point that leaves the reader wanting the rest.
- {{minWords}} to {{maxWords}} words in total.
- Keep his paragraph breaks. Don't add a link or a sign-off; that's added afterwards.

## The description and tags

These are the only words on the page James won't have written, so keep them plain and in his voice: tight, professional but not corporate, British English, no "AI-isms" (no stock phrases, no inflated vocabulary, no em dashes).

- Description: one concise line saying what the post argues, 20 words or fewer. It's shown under the title on the site and in search results. State the point directly, as in "Why most unmoderated usability testing has become a box-ticking exercise, and what to do instead." Don't open with "Argues that", "This post" or "James".
- Tags: one to three short topic labels in sentence case, such as "Research" or "Usability testing". Three is the maximum; use fewer if fewer fit.

## Output

Reply with JSON only, no commentary, in exactly this shape:

```json
{
  "cut": ["First paragraph of the cut", "Second paragraph of the cut"],
  "description": "One sentence.",
  "tags": ["Research"]
}
```
