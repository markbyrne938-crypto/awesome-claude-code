# YouTube Watchlist

Tracks the newest videos from your favourite channels. Each video shows title, length and upload time, with a tick box — tick it when you've watched it and it disappears (tick "Show watched" to see/undo). Ticks are remembered in your browser.

## Run it locally
```
pip install requests
python3 serve.py          # then open http://localhost:8000
```
Click **Refresh** to check for new uploads (or run `python3 fetch_videos.py`).

## Change channels
Edit `channels.json`. On first run each channel name is searched on YouTube and the matched channel ID is saved
(the log prints the matched channel name — check they're right). If one is wrong, put the correct `"id": "UC..."` in.

## Put it online (free, updates itself)
1. Merge this branch into your repo's `main` branch.
2. In the repo go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Go to the **Actions** tab, open **YouTube tracker website** and click **Run workflow**.
4. After a minute your site is live at `https://<your-username>.github.io/<repo-name>/` (shown in the workflow run). Bookmark it on your phone.

The site re-checks YouTube on a 10-minute schedule from 8am to 10pm (UTC+2; the cron in the workflow is in UTC: `*/10 6-19 * * *`). GitHub sometimes runs scheduled jobs late at busy times, so expect 10–25 minutes. To stop updates, disable the workflow in the Actions tab; to update right away, click **Run workflow**. Ticks are saved in the browser **and** synced to a free anonymous text store (textdb.dev) under a long random key that is part of the page address (`#k=...`). **Bookmark the address with the `#k=…` part** (or add it to your Home Screen): opening it on any device shows the same ticks, even if the browser forgot its data. Only YouTube video IDs and tick times are stored. The **☁ Sync** button shows the address and a manual backup code; if the sync service is down, ticks are still saved on the device and sync when it returns.
