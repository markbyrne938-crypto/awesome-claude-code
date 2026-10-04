# YouTube Watchlist

Shows the latest (non-Short) video from each channel in `channels.json` with title, length and upload date.
Tick the box when you've watched it and it disappears until that channel uploads something new.

## Run
    python3 server.py
then open http://localhost:8000. No installs needed (Python 3.8+). It re-checks every 15 minutes; "Check now" forces it.

## Notes
- Channels are found by name search on first run and remembered in `data/state.json`. Each card shows the channel
  name it matched — if one is wrong, add `"handle": "TheirHandle"` or `"channel_id": "UC..."` to its entry in `channels.json`.
- Watched ticks are stored in `data/state.json`.
- Only the newest video per channel is shown.
