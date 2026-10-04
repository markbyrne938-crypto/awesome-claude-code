#!/usr/bin/env python3
"""Fetch the newest videos for each channel in channels.json -> videos.json.

Uses only YouTube's public RSS feeds and playlist pages (no API key). Channel IDs are
looked up once by name and cached back into channels.json as "id"; to fix a
wrong match, put the right "id" (UC...) in channels.json yourself.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

HERE = Path(__file__).parent
CONFIG = HERE / "channels.json"
OUTPUT = HERE / "videos.json"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept-Language": "en-GB,en;q=0.9"}
COOKIES = {"CONSENT": "YES+1", "SOCS": "CAI"}
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015",
      "m": "http://search.yahoo.com/mrss/"}

session = requests.Session()
session.headers.update(UA)
session.cookies.update(COOKIES)


def find_channel_id(query):
    """Return (channel_id, title) for the top channel search result."""
    r = session.get("https://www.youtube.com/results",
                    params={"search_query": query, "sp": "EgIQAg=="}, timeout=20)
    r.raise_for_status()
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", r.text, re.S)
    if not m:
        raise RuntimeError("search page format not recognised")
    found = []

    def walk(o):
        if isinstance(o, dict):
            if "channelRenderer" in o:
                c = o["channelRenderer"]
                title = c.get("title", {}).get("simpleText", "")
                found.append((c["channelId"], title))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(json.loads(m.group(1)))
    if not found:
        raise RuntimeError("no channel found")
    return found[0]


def parse_feed(xml_text):
    root = ET.fromstring(xml_text)
    videos = []
    for e in root.findall("a:entry", NS):
        videos.append({
            "id": e.findtext("yt:videoId", namespaces=NS),
            "title": e.findtext("a:title", namespaces=NS),
            "published": e.findtext("a:published", namespaces=NS),
        })
    return videos


def parse_duration(text):
    """'1:13:58' -> 4438; anything else (e.g. 'LIVE') -> None."""
    if not re.fullmatch(r"\d{1,2}(:\d{2}){1,2}", text or ""):
        return None
    secs = 0
    for part in text.split(":"):
        secs = secs * 60 + int(part)
    return secs


def _badge_text(o):
    if isinstance(o, dict):
        badge = o.get("thumbnailBadgeViewModel")
        if isinstance(badge, dict) and isinstance(badge.get("text"), str):
            return badge["text"]
        o = list(o.values())
    for v in o if isinstance(o, list) else []:
        found = _badge_text(v)
        if found:
            return found
    return None


def parse_playlist(html):
    """Map video id -> length in seconds (None if unknown) from a playlist page."""
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    if not m:
        raise RuntimeError("playlist page format not recognised")
    found = {}

    def walk(o):
        if isinstance(o, dict):
            lv = o.get("lockupViewModel")
            if isinstance(lv, dict) and lv.get("contentId"):
                found[lv["contentId"]] = parse_duration(_badge_text(lv))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(json.loads(m.group(1)))
    return found


def _playlist_html(channel_id, kind):
    r = session.get("https://www.youtube.com/playlist",
                    params={"list": kind + channel_id[2:]}, timeout=30)
    r.raise_for_status()
    return r.text


def channel_playlist(channel_id, kind):
    """kind: UULF = normal videos, UULV = live streams (UUSH = Shorts, see parse_shorts)."""
    return parse_playlist(_playlist_html(channel_id, kind))


def parse_shorts(html):
    """Shorts use a different layout, so just collect every video id on the page."""
    return set(re.findall(r'"(?:videoId|contentId)":"([\w-]{11})"', html))


def is_recent(published, max_age_days, now=None):
    """True if the ISO timestamp is no older than max_age_days."""
    now = now or datetime.now(timezone.utc)
    return datetime.fromisoformat(published) >= now - timedelta(days=max_age_days)


def keep_video(video_id, lengths, shorts, lives):
    """Normal uploads only: drop Shorts and live streams (past or present).

    `lengths` is the channel's normal-video list; when we have it, anything not
    in it (a Short, a stream, a premiere) is dropped as well.
    """
    if video_id in shorts or video_id in lives:
        return False
    return not lengths or video_id in lengths


def main():
    config = json.loads(CONFIG.read_text())
    limit = config.get("videos_per_channel", 5)
    max_age = config.get("max_age_days", 31)   # ~1 month: older videos are not shown
    previous = {}
    if OUTPUT.exists():
        for ch in json.loads(OUTPUT.read_text()).get("channels", []):
            for v in ch["videos"]:
                previous[v["id"]] = v

    out, changed = [], False
    for ch in config["channels"]:
        name = ch["name"]
        try:
            if not ch.get("id"):
                ch["id"], found_title = find_channel_id(ch.get("search", name))
                changed = True
                print(f"{name}: matched channel '{found_title}' ({ch['id']})")
            r = session.get("https://www.youtube.com/feeds/videos.xml",
                            params={"channel_id": ch["id"]}, timeout=20)
            r.raise_for_status()
            lengths, shorts, lives = {}, set(), set()
            for label, load in (
                ("lengths", lambda: lengths.update(channel_playlist(ch["id"], "UULF"))),
                ("Shorts", lambda: shorts.update(parse_shorts(_playlist_html(ch["id"], "UUSH")))),
                ("live streams", lambda: lives.update(channel_playlist(ch["id"], "UULV"))),
            ):
                try:
                    load()
                except Exception as exc:  # no info for this list; still show the videos
                    print(f"{name}: could not read {label} list ({exc})", file=sys.stderr)
            videos = []
            for v in parse_feed(r.text):
                if not keep_video(v["id"], lengths, shorts, lives) or not is_recent(v["published"], max_age):
                    continue
                seconds = lengths.get(v["id"]) or previous.get(v["id"], {}).get("seconds")
                v.update(seconds=seconds, url=f"https://www.youtube.com/watch?v={v['id']}")
                videos.append(v)
                if len(videos) >= limit:
                    break
            out.append({"name": name, "id": ch["id"], "videos": videos})
            print(f"{name}: {len(videos)} videos")
        except Exception as exc:  # keep going; show last known data for this channel
            print(f"{name}: FAILED ({exc})", file=sys.stderr)
            old = next((c for c in _old_channels() if c["name"] == name), None)
            out.append(old or {"name": name, "id": ch.get("id"), "videos": [], "error": str(exc)})

    if changed:
        CONFIG.write_text(json.dumps(config, indent=2) + "\n")
    OUTPUT.write_text(json.dumps(
        {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "channels": out},
        indent=1) + "\n")


def _old_channels():
    try:
        return json.loads(OUTPUT.read_text()).get("channels", [])
    except Exception:
        return []


if __name__ == "__main__":
    main()
