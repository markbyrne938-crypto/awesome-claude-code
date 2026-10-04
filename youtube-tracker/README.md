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

## Automatic updates (optional)
`.github/workflows/youtube-tracker.yml` refreshes `videos.json` hourly and commits it; serve the folder with GitHub Pages to use it from your phone. Note ticks live in each browser's storage, not synced between devices.
