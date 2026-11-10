# Watchlist

A private page showing the newest videos from my favourite YouTube channels: title, length and
upload time, newest first, with a "Watched" button that hides a video (undo from *Recently watched*).

## Privacy

The repo and the GitHub Pages site are public (free GitHub accounts can't put Pages behind a login),
so everything private is encrypted with one password, the `TRACKER_PASSWORD` Actions secret:

* **Videos** – the site serves only `data.json`, encrypted (AES-256-GCM, key from the password via
  PBKDF2-SHA256, 600,000 rounds). The page decrypts it in the browser after you type the password.
  Without it, visitors see a lock screen and search engines are told not to index the page.
* **Channel list** – kept as `channels.enc.json`, encrypted the same way.
* **Watched ticks** – synced between devices through textdb.dev under a random key in the page
  address (`#k=…`), encrypted with the password before they leave the device.
* **Run logs** – public for a public repo, so the updater logs only "channel 3/20: 2 videos".

"Remember me on this device" stores the derived key (not the password) in the browser. **Lock this
device** in the ⋯ menu forgets it.

Changing the password: the updater can't decrypt `channels.enc.json` with a different password, so a
run fails until the old one is restored. To change it, re-add the channels after setting the new one.

## Setup

1. **Settings → Secrets and variables → Actions → New repository secret**: name `TRACKER_PASSWORD`,
   value your password.
2. **Settings → Pages → Source**: GitHub Actions.
3. **Actions → YouTube tracker website → Run workflow**. The first run encrypts the channel list
   (`channels.json` → `channels.enc.json`) and publishes the site.
4. Open `https://<user>.github.io/<repo>/`, unlock, and add it to your Home Screen.

## Adding or removing channels

The channel list is encrypted, so changes are sealed with the public key the updater publishes
(`channels.pub`) and applied by the next run:

```
pip install cryptography
python3 add_channel.py "Channel name"           # looked up on YouTube by name
python3 add_channel.py --remove "Channel name"
git add channel-requests && git commit -m "Channel change" && git push   # starts a run
```

When a channel is added, the page shows which YouTube channel was matched (subscriber count and
newest upload) so a wrong match is easy to spot.

## How it updates

`.github/workflows/youtube-tracker.yml` runs every 10 minutes from 8am to 10pm (UTC+2; the cron is in
UTC: `*/10 6-19 * * *`). GitHub often starts scheduled runs late, so expect 10–25 minutes. Each run
reads the channels' RSS feeds (retrying, and falling back to the channel's uploads page when a feed
fails), skips Shorts, live streams and anything older than a month, and publishes the encrypted
result. To update right away: **Run workflow**.

## Run it locally

```
pip install requests cryptography
TRACKER_PASSWORD='your password' python3 serve.py   # then open http://localhost:8000
```
