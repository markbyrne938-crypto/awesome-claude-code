'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseFeed } = require('../lib/rss');
const { SOURCES } = require('../lib/sources');
const { Aggregator } = require('../lib/aggregator');
const { makeDemoFetch, feed } = require('../lib/demo');

test('parseFeed reads RSS, CDATA and entities', () => {
  const xml = `<rss><channel><item><title><![CDATA[Rates &amp; markets]]></title><link>https://a.test/1</link>
  <description>&lt;p&gt;Hello&lt;/p&gt; world</description><pubDate>Fri, 03 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const [it] = parseFeed(xml);
  assert.equal(it.title, 'Rates & markets');
  assert.equal(it.summary, 'Hello world');
  assert.equal(it.published, Date.parse('2026-10-03T10:00:00Z'));
});

test('parseFeed reads Atom links', () => {
  const [it] = parseFeed('<feed><entry><title>T</title><link href="https://a.test/x"/><updated>2026-10-03T10:00:00Z</updated></entry></feed>');
  assert.equal(it.url ?? it.link, 'https://a.test/x');
});

test('stories covered by many sources outrank single-source stories', async () => {
  const now = Date.now();
  const mk = (t, l, d) => ({ t, l, d, p: now - 60000 });
  const big = (s) => mk('Earthquake strikes coast of Tamarinda, buildings damaged', `https://x/${s}/eq`, 'A strong earthquake struck off Tamarinda.');
  const solo = mk('Local bakery wins regional pastry prize', 'https://x/bbc/bake', 'A bakery won a prize.');
  const feeds = {
    reuters: [big('reuters')], ap: [big('ap')], nyt: [big('nyt')], guardian: [big('guardian')],
    bbc: [solo, big('bbc')],
  };
  const agg = new Aggregator({ sources: SOURCES, fetchText: async (s) => feed(feeds[s.id] || []) });
  const snap = await agg.refresh();
  assert.match(snap.stories[0].headline, /Earthquake/);
  assert.equal(snap.stories[0].sourceCount, 5);
  assert.ok(snap.stories[0].items.every((i) => /^https?:/.test(i.url)));
});

test('demo feed produces 10 stories and emits update when a new story enters', async () => {
  const agg = new Aggregator({ sources: SOURCES, fetchText: makeDemoFetch() });
  const updates = [];
  agg.on('update', (u) => updates.push(u));
  const first = await agg.refresh();
  assert.equal(first.stories.length, 10);
  assert.deepEqual(first.stories.map((s) => s.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (let i = 0; i < 6; i++) await agg.refresh();
  assert.ok(updates.length > 0, 'expected at least one live update');
  assert.ok(updates.some((u) => u.changes.some((c) => c.type === 'entered')));
});

test('ids stay stable across refreshes', async () => {
  const agg = new Aggregator({ sources: SOURCES, fetchText: makeDemoFetch() });
  const a = await agg.refresh();
  const b = await agg.refresh();
  assert.deepEqual(new Set(b.stories.map((s) => s.id)).size, 10);
  const shared = a.stories.filter((s) => b.stories.some((t) => t.id === s.id));
  assert.ok(shared.length >= 8);
});

test('failed sources are reported but do not break the page', async () => {
  const agg = new Aggregator({
    sources: SOURCES,
    fetchText: async (s) => { if (s.id !== 'bbc') throw new Error('boom'); return feed([{ t: 'Only story here today', l: 'https://x/1', d: '', p: Date.now() }]); },
  });
  const snap = await agg.refresh();
  assert.equal(snap.sources.filter((s) => s.ok).length, 1);
  assert.equal(snap.stories.length, 1);
});

test('restore resumes ids and records changes between builds', async () => {
  const a = new Aggregator({ sources: SOURCES, fetchText: makeDemoFetch() });
  await a.refresh();
  const saved = JSON.parse(JSON.stringify(a.publicSnapshot()));
  const b = new Aggregator({ sources: SOURCES, fetchText: makeDemoFetch() });
  b.restore(saved);
  const snap = await b.refresh();
  const kept = snap.stories.filter((s) => saved.stories.some((t) => t.id === s.id));
  assert.ok(kept.length >= 8);
});
