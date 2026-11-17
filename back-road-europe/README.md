# Back Road Europe

A daily game about Europe. Each day at midnight Central European time, everyone gets the same seven prompts, such as "Name a Greek island" or "Name a town in Austria with over 20,000 people". Each prompt has many right answers. The less obvious your answer, the more it scores, up to 100 a stop. Every answer drives you to its place on a map of Europe.

There are two ways to run it:

- **As a claude.ai artifact**: one HTML page (`dist/index.html`). Scores, tables and duels are shared through the artifact's storage.
- **On your own server**: `server/server.mjs` serves the same page. It adds public sign-up, a server-side clock and server-side scoring.

## How a day works

- **The route.** Seven slots: countries, places, food & drink, sport, history, culture, and science & life.
  - Each slot works through its own shuffled list, so a prompt doesn't come back until its whole slot has been used.
  - Prompts that share a theme never appear on the same day.
  - The bank holds 336 prompts: 181 hand-written and 155 generated from country and town data.
- **Answers.** Matching accepts native names and common alternatives (Deutschland, Wien, Man U, Bayern München), small typos, and missing accents.
  - Typos are strict: "Australia" doesn't count as Austria.
  - A wrong answer gets a reason ("England is part of the United Kingdom, which doesn't fit this one").
  - Each answer, and each country, can be used once per route.
- **Points.** Points come from how many players would give the same answer.
  - Before there's real data, the estimate is based on how well known each answer is.
  - Answers from earlier routes then pull the estimate towards what people actually said.
  - The road types run from Motorway (obvious) to Dirt track (rare).
- **Ties.** Points first, then more rare answers, then the faster total time.

## Project layout

| Path | What it is |
|---|---|
| `data/prompts/*.txt` | The hand-written prompts, one file per category |
| `data/countries.mjs` | The 50 countries, their capitals and other names, and the sets the generated prompts use (EU, NATO, euro, Danube...) |
| `data/clauses.mjs` | The wording of generated prompts, in five languages |
| `data/places-en.txt` | English names, extra spellings and corrections for towns from the gazetteer |
| `tools/` | Download script and the gazetteer filter (drops districts of bigger cities) |
| `build.mjs` | Builds the map, the town list and the prompts, and writes `dist/` |
| `src/` | The page: `core.js` (matching, scoring, dealing), `map.js`, `net.js` (artifact, server or local storage), `ui.js`, `multi.js` (tables, challenges, duels), `main.js`, `i18n.js` (English, French, German, Spanish, Italian) |
| `server/server.mjs` | The standalone server |
| `test/` | Automated checks (Playwright) |
| `legacy/` | Version 1, kept for reference |

## Build

Node 18 or later.

```sh
npm install
npm run fetch     # once: Natural Earth layers and World Bank population into cache/
npm run build     # writes dist/index.html, dist/engine.js and dist/report.txt
```

- `dist/report.txt` lists every generated prompt and its answer count, plus any warnings. Answers that can't be placed on the map show up as warnings.
- `node build.mjs --dev` skips minification.

## Editing prompts

Each prompt in `data/prompts/*.txt` is a header line followed by one line of answers:

```
= food | Name a French cheese. | A cheese | FR | cheese
Brie / Brie de Meaux:10@Meaux | Camembert:10@48.89,0.18 | Roquefort:7@43.98,2.99 | ...
```

- **Header.** Category, question, a short answer hint, the default country, and theme tags. Prompts that share a tag never appear on the same day.
- **Answers.** Each answer is `Name / other accepted names : fame : country @ town or lat,lon`.
  - Fame runs from 1 to 10, where 10 is most people's first answer.
  - The country defaults to the header's.
  - Use `:-` for answers outside Europe; they count but get no map stop.
- **Checking.** Run `npm run build`, then check `dist/report.txt`.

The owner can also schedule a prompt for a future day from inside the game (the key icon). That prompt replaces the same category's prompt on that day.

## Tests

```sh
npm test
```

- **`test/run.cjs`** (168 checks) uses a stand-in for the artifact host, so two or more browser pages share one store. It covers:
  - matching, the deal over 200 days, scoring and challenge codes
  - translations and colour contrast in both themes
  - a full route, plus resume after reload
  - layouts at seven screen widths
  - two-player tables, hidden answers, owner scheduling and a live duel
- **`test/server.cjs`** (24 checks) starts the real server with a throwaway database and plays through it in two browsers.

Screenshots go to `test/out/`.

## Running your own server

```sh
npm run build
PORT=8080 npm start
```

**Settings**

- Data lives in one JSON file, `server/db.json` by default. Set `DB_PATH` to move it. It is written atomically, and flushed on shutdown.
- The first account created is the owner. Open the site yourself before sharing the link, or set `OWNER_IDS=u_xxx` to the owner account ids.
- To publish it, put it behind HTTPS with a reverse proxy (Caddy, nginx). The server reads `X-Forwarded-Proto` for the reminder link.

**What it enforces**

- **Clock.** The server starts each prompt's clock and records each answer as it arrives. It refuses answers after the time limit (plus 2 s for the network), prompts played out of order, and a second go at the day's route.
- **Scoring.** The server judges each typed answer and works out the points itself, using the same code as the page (`dist/engine.js`). A modified page can't post a better score. A result the server didn't see played counts as "played later" and stays out of the tables.
- **Hidden answers.** Today's answers are never sent to other players until midnight. Prompts scheduled for future days go only to the owner.
- **Rarity.** Counted from checked answers on earlier routes. The counts are fixed at the first request each day, so everyone that day is scored the same way.
- **Extras.** Leagues with join codes, a weekly table, a live room for duels, and a daily calendar reminder (`api/reminder.ics`, offered in Settings).

**What it doesn't do**

- **Accounts** are a token kept in the browser. There are no passwords or email, so clearing site data loses the account.
- **No lookups prevented.** Nothing stops a player from looking answers up during the 25 seconds.
- **One process.** It keeps everything in memory and writes one file. That is fine for friends, a club or a class, but not for thousands of players at once.

## Limits of the artifact version

- **Shared storage.** Only people with access to the artifact can post to the shared tables. Everyone else can still play, and compare by challenge link or result code.
- **Integrity.**
  - The page stores answers privately, so a run can't be replayed after a reload.
  - Today's answers stay hidden until midnight.
  - Codes carry a checksum.
  - A page running in someone's browser can't fully stop a determined cheat. The server version can.
- **Translation.** The interface and the generated prompts are in five languages. The hand-written prompts are in English.

## Data and credits

- Map: [Natural Earth](https://www.naturalearthdata.com/) (public domain), via `world-atlas`.
- Towns and populations: [GeoNames](https://www.geonames.org/) (CC BY 4.0), via `all-the-cities`.
- Country data: [world-countries](https://github.com/mledoze/countries) (ODbL) and `i18n-iso-countries`.
- Population: [World Bank](https://data.worldbank.org/) (CC BY 4.0), via `datasets/population`.
- Fonts: Overpass, Figtree and Noto Color Emoji from Google Fonts.
