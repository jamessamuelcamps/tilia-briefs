// Which channel an idea belongs to. Personal ideas split by Format: Article, Short post or Make.
// An idea with no Format can become an article or a short post; Make ideas are always marked.

/** True if the idea can be briefed for this channel. */
export function matchesChannel(idea, channel) {
  if (idea.owner !== channel.owner) return false;
  if (!channel.format) return true;
  if (idea.format) return idea.format === channel.format;
  return channel.format !== 'Make';
}

/**
 * The channel key for an idea that's already been briefed (briefing sets its Format).
 * Pages briefed before Format existed have none and count as articles.
 */
export function channelKeyFor(idea, channels) {
  const keys = Object.keys(channels).filter((k) => channels[k].owner === idea.owner);
  const exact = keys.find((k) => (channels[k].format ?? null) === (idea.format ?? null));
  const fallback = keys.find((k) => !channels[k].format || channels[k].format === 'Article');
  const key = exact ?? fallback;
  if (!key) throw new Error(`No channel is set up for owner "${idea.owner}"`);
  return key;
}

/** The channels whose brief goes out today. firstWeekOnly ones only run in the first seven days of the month. */
export function channelsBriefedOn({ weekday, date }, channels) {
  const dayOfMonth = Number(date.slice(8, 10));
  return Object.keys(channels).filter((k) => channels[k].briefDay === weekday && (!channels[k].firstWeekOnly || dayOfMonth <= 7));
}
