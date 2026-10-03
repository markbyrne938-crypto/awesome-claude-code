'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { SOURCES } = require('./lib/sources');
const { Aggregator } = require('./lib/aggregator');

const PORT = Number(process.env.PORT) || 3000;
const POLL_MS = (Number(process.env.POLL_SECONDS) || 120) * 1000;
const DEMO = process.env.DEMO === '1';
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const agg = new Aggregator(
  DEMO ? { sources: SOURCES, fetchText: require('./lib/demo').makeDemoFetch() } : { sources: SOURCES }
);
const clients = new Set();

const payload = () => ({ ...agg.publicSnapshot(), demo: DEMO, pollSeconds: POLL_MS / 1000 });

agg.on('update', ({ changes }) => {
  const msg = `event: update\ndata: ${JSON.stringify({ ...payload(), changes })}\n\n`;
  for (const res of clients) res.write(msg);
});

async function poll() {
  try { await agg.refresh(); } catch (e) { console.error('refresh failed:', e.message); }
  const s = agg.snapshot;
  console.log(`[${new Date().toISOString()}] ${s.stories.length} stories, ${s.sources.filter((x) => x.ok).length}/${s.sources.length} sources ok`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/top10') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify(payload()));
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: hello\ndata: ${JSON.stringify(payload())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

poll().then(() => {
  setInterval(poll, POLL_MS);
  server.listen(PORT, () => console.log(`Top10News on http://localhost:${PORT}${DEMO ? ' (DEMO DATA)' : ''}`));
});
