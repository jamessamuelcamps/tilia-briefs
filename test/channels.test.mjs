import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { channelKeyFor, channelsBriefedOn, matchesChannel } from '../scripts/lib/channels.mjs';

const channels = JSON.parse(await readFile(new URL('../config/channels.json', import.meta.url), 'utf8'));
const idea = (owner, format = null) => ({ owner, format });

test('an untyped personal idea can be an article or a short post, but not a Make', () => {
  assert.equal(matchesChannel(idea('Personal'), channels.personal), true);
  assert.equal(matchesChannel(idea('Personal'), channels['personal-short']), true);
  assert.equal(matchesChannel(idea('Personal'), channels.make), false);
});

test('a typed idea only matches its own format', () => {
  assert.equal(matchesChannel(idea('Personal', 'Make'), channels.make), true);
  assert.equal(matchesChannel(idea('Personal', 'Make'), channels.personal), false);
  assert.equal(matchesChannel(idea('Personal', 'Short post'), channels.personal), false);
  assert.equal(matchesChannel(idea('Tilia'), channels.personal), false);
});

test('a briefed page goes back to the channel its format names; old pages count as articles', () => {
  assert.equal(channelKeyFor(idea('Personal', 'Short post'), channels), 'personal-short');
  assert.equal(channelKeyFor(idea('Personal', 'Make'), channels), 'make');
  assert.equal(channelKeyFor(idea('Personal', 'Article'), channels), 'personal');
  assert.equal(channelKeyFor(idea('Personal'), channels), 'personal');
  assert.equal(channelKeyFor(idea('Tilia'), channels), 'tilia');
  assert.throws(() => channelKeyFor(idea('Nobody'), channels), /No channel/);
});

test('Sunday sends the article, plus the Make brief in the first week; Tuesday sends the short post', () => {
  assert.deepEqual(channelsBriefedOn({ weekday: 'Sunday', date: '2026-11-01' }, channels), ['personal', 'make']);
  assert.deepEqual(channelsBriefedOn({ weekday: 'Sunday', date: '2026-11-08' }, channels), ['personal']);
  assert.deepEqual(channelsBriefedOn({ weekday: 'Tuesday', date: '2026-11-03' }, channels), ['personal-short']);
  assert.deepEqual(channelsBriefedOn({ weekday: 'Wednesday', date: '2026-11-04' }, channels), []);
});

test('the Tilia channel is never briefed on a schedule now', () => {
  assert.equal(channels.tilia.briefDay, undefined);
});
