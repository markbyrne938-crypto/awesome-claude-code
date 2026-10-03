'use strict';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '#');
const WIRES = new Set(['reuters', 'ap', 'afp']);
let lastIds = null;

function render(data, changes = []) {
  $('demoBanner').hidden = !data.demo;
  $('error').hidden = !data.error;
  if (data.error) $('error').textContent = data.error + ' — showing last known stories.';

  const entered = new Set(changes.filter((c) => c.type === 'entered').map((c) => c.id));
  const list = $('list');
  list.replaceChildren(...data.stories.map((s) => {
    const li = el('li', 'story' + (entered.has(s.id) ? ' flash' : ''));
    li.appendChild(el('div', 'rank', String(s.rank)));
    const body = el('div');
    const badges = el('div', 'badges');
    if (s.isNew || entered.has(s.id)) badges.appendChild(el('span', 'badge new', 'NEW'));
    if (s.previousRank && s.previousRank !== s.rank) {
      const up = s.previousRank > s.rank;
      badges.appendChild(el('span', 'badge ' + (up ? 'up' : 'down'), (up ? '▲ ' : '▼ ') + Math.abs(s.previousRank - s.rank)));
    }
    badges.appendChild(el('span', 'badge', `${s.sourceCount} source${s.sourceCount === 1 ? '' : 's'}`));
    body.appendChild(badges);
    body.appendChild(el('h3', null, s.headline));
    if (s.summary) body.appendChild(el('p', null, s.summary));
    const chips = el('div', 'chips');
    for (const it of s.items) {
      const a = el('a', WIRES.has(it.source) ? 'wire' : '', it.sourceName);
      a.href = safeUrl(it.url); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = it.title;
      a.appendChild(el('small', null, '#' + it.position));
      chips.appendChild(a);
    }
    body.appendChild(chips);
    li.appendChild(body);
    return li;
  }));

  const ev = $('events');
  const items = (data.events || []).slice(0, 8).map((c) => {
    const t = new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const verb = c.type === 'entered' ? `entered at #${c.rank}` : c.type === 'exited' ? `left the top 10 (was #${c.from})` : `moved #${c.from} → #${c.rank}`;
    return el('li', null, `${t} · ${c.headline} ${verb}`);
  });
  ev.replaceChildren(...(items.length ? items : [el('li', 'muted', 'Nothing yet.')]));

  $('sources').replaceChildren(...(data.sources || []).map((s) =>
    el('li', s.ok ? '' : 'bad', `${s.name}${s.ok ? '' : ' (unavailable)'}`)));

  const when = data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : '—';
  setLive(true, `Live · updated ${when}`);

  const fresh = changes.filter((c) => c.type === 'entered');
  if (lastIds && fresh.length) toast(`New in the top 10: ${fresh[0].headline}`);
  lastIds = data.stories.map((s) => s.id);
}

function setLive(on, text) { $('live').className = 'live ' + (on ? 'on' : 'off'); $('liveText').textContent = text; }
function toast(msg) {
  const t = el('div', 'toast', msg); document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

// Static hosting (no Node server): poll the JSON file the scheduled build publishes.
async function pollStatic() {
  try {
    const data = await (await fetch('data/top10.json', { cache: 'no-store' })).json();
    const before = new Set(lastIds || []);
    const changes = lastIds
      ? data.stories.filter((s) => !before.has(s.id)).map((s) => ({ type: 'entered', id: s.id, headline: s.headline, rank: s.rank }))
      : [];
    render(data, changes);
  } catch { setLive(false, 'Offline — retrying'); }
}

function connectSSE() {
  const es = new EventSource('events');
  es.addEventListener('hello', (e) => render(JSON.parse(e.data)));
  es.addEventListener('update', (e) => { const d = JSON.parse(e.data); render(d, d.changes); });
  es.onerror = () => setLive(false, 'Reconnecting…');
  es.onopen = () => setLive(true, 'Live');
}

async function start() {
  let hasServer = false;
  try { hasServer = window.EventSource && (await fetch('api/top10')).ok; } catch {}
  if (hasServer) return connectSSE();
  pollStatic();
  setInterval(pollStatic, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollStatic(); });
}
start();
