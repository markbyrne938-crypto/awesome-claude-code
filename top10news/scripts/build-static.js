'use strict';
// Builds a static copy of the site into ./dist with a fresh data/top10.json.
// Run on a schedule (see .github/workflows/top10news.yml) and publish dist/ to any static host.
//   PREV_JSON=path   previous top10.json, so ranks/ids/"recent changes" carry over
//   DEMO=1           use fictional offline data
const fs = require('fs');
const path = require('path');
const { SOURCES } = require('../lib/sources');
const { Aggregator } = require('../lib/aggregator');

(async () => {
  const root = path.join(__dirname, '..');
  const dist = path.join(root, 'dist');
  const demo = process.env.DEMO === '1';
  const agg = new Aggregator(demo ? { sources: SOURCES, fetchText: require('../lib/demo').makeDemoFetch() } : { sources: SOURCES });

  try { agg.restore(JSON.parse(fs.readFileSync(process.env.PREV_JSON || path.join(dist, 'data/top10.json'), 'utf8'))); } catch {}

  await agg.refresh();
  const snap = agg.publicSnapshot();
  if (!snap.stories.length) { console.error('No stories fetched; not publishing.'); process.exit(1); }

  fs.rmSync(dist, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
  fs.mkdirSync(path.join(dist, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'data/top10.json'), JSON.stringify({ ...snap, demo, static: true }));
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');
  console.log(`Built ${snap.stories.length} stories from ${snap.sources.filter((s) => s.ok).length}/${snap.sources.length} sources`);
})();
