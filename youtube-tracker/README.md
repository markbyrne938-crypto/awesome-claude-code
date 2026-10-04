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

The site re-checks YouTube about every 10 minutes. GitHub's own scheduler is unreliable (and often doesn't run at all in forks), so each run starts the next one after ~10 minutes; the cron line is just a backup. To stop updates, disable the workflow in the Actions tab; to restart, click **Run workflow**. Ticks are stored in each browser/device separately; use **Backup** on the page to copy your watched list to another device or keep a safety copy.
