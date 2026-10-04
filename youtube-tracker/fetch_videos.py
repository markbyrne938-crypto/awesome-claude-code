#!/usr/bin/env python3
"""Fetch the newest videos for each channel in channels.json -> videos.json.

Uses only YouTube's public RSS feeds and pages (no API key). Channel IDs are
looked up once by name and cached back into channels.json as "id"; to fix a
wrong match, put the right "id" (UC...) in channels.json yourself.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
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


def video_details(video_id):
    """Return (length_seconds, is_short, is_live_or_upcoming) from the watch page."""
    r = session.get("https://www.youtube.com/watch", params={"v": video_id}, timeout=20)
    m = re.search(r'"lengthSeconds":"(\d+)"', r.text)
    seconds = int(m.group(1)) if m else None
    upcoming = '"isUpcoming":true' in r.text
    # Shorts URL serves the page (200) for shorts and redirects for normal videos.
    s = session.head(f"https://www.youtube.com/shorts/{video_id}", allow_redirects=False, timeout=20)
    return seconds, s.status_code == 200, upcoming


def main():
    config = json.loads(CONFIG.read_text())
    limit = config.get("videos_per_channel", 5)
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
            videos = []
            for v in parse_feed(r.text):
                if v["id"] in previous and previous[v["id"]].get("seconds") is not None:
                    v = {**previous[v["id"]], "title": v["title"]}
                else:
                    sec, short, upcoming = video_details(v["id"])
                    v.update(seconds=sec, short=short, upcoming=upcoming)
                if v["short"] or v["upcoming"]:
                    continue
                v["url"] = f"https://www.youtube.com/watch?v={v['id']}"
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
