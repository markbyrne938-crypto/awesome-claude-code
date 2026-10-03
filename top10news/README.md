# Top10News

A live website showing the ten biggest world news stories right now, ranked by how prominently
Reuters, AP, AFP, BBC, NYT, The Washington Post, The Guardian, Al Jazeera, NPR, DW and France 24
place them. No dependencies — just Node 18+.

```
npm start        # http://localhost:3000, polls real feeds every 120s
npm run demo     # fictional headlines that rotate, to see live updates offline
npm test
```

Env vars: `PORT` (3000), `POLL_SECONDS` (120), `DEMO=1`.

## Putting it online
**GitHub Pages (no server, free):** `.github/workflows/top10news.yml` rebuilds the site every 5 minutes on GitHub's
servers (which can reach the news feeds) and publishes it. After this branch is merged to `main`:
1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Run the "Top10News site" workflow once (Actions tab → Run workflow).
The site appears at `https://<user>.github.io/<repo>/` and its page checks for new data every minute and flags new entrants.
(GitHub only runs scheduled workflows from the default branch, and may delay them a few minutes.)

**Any Node host (true push updates):** `npm start`, or build the included `Dockerfile` (Fly.io, Render, Railway, a VPS…).
The page detects the server and uses the live `/events` stream instead of polling.

Preview the static build locally: `DEMO=1 node scripts/build-static.js && npx serve dist`.

## How it works
- `lib/sources.js` – feed list and weights (wires 1.5, outlets 1.0, NPR/DW/France 24 0.8).
- `lib/cluster.js` – groups headlines about the same event (TF-IDF cosine similarity).
- `lib/rank.js` – score = Σ over sources of `weight × 1/(1+0.25·position)`, with a recency half-life of 18h; stories confirmed by 2+ sources outrank single-source ones.
- `lib/aggregator.js` – refreshes, keeps story ids stable, diffs the top 10 and emits an `update` event when a story enters, leaves or moves.
- `server.js` – serves `/api/top10` and a Server-Sent-Events stream at `/events`; the page (`public/`) updates instantly and flashes new entrants.

## Notes
- Reuters and AP no longer publish official RSS feeds, and AFP content is syndicated, so those three are read through
  Google News RSS searches (`approx: true` in `sources.js`). Their position reflects Google's ordering, not the outlet's homepage.
  Swap in licensed feeds or APIs there if you have them.
- Only headlines, short feed summaries and links are shown; every card links to each outlet's own article.
- "Unbiased" here means breadth: stories are ranked by agreement across many outlets and countries, wording is taken
  from the wire service when available, and all outlet versions are linked. It can't remove bias in the underlying sources.
