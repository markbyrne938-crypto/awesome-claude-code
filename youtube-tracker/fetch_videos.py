#!/usr/bin/env python3
"""Fetch the newest videos for each channel in channels.json -> videos.json.

Uses only YouTube's public RSS feeds and playlist pages (no API key); if a channel's feed
fails, its uploads playlist is used instead. Channel IDs are
looked up once by name and cached back into channels.json as "id"; to fix a
wrong match, put the right "id" (UC...) in channels.json yourself.
"""
import json
import re
import sys
import time
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


def _text(o):
    """Plain text of a YouTube text object ({"simpleText": ...} or {"runs": [...]})."""
    if not isinstance(o, dict):
        return ""
    if "simpleText" in o:
        return o["simpleText"]
    return "".join(r.get("text", "") for r in o.get("runs", []))


def parse_channel_search(html):
    """Channel results on a search page, in YouTube's order: [(id, title, info)].

    info is the handle / subscriber count text shown under the result.
    """
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    if not m:
        raise RuntimeError("search page format not recognised")
    found = []

    def walk(o):
        if isinstance(o, dict):
            if "channelRenderer" in o:
                c = o["channelRenderer"]
                info = " · ".join(t for t in (_text(c.get("subscriberCountText")),
                                              _text(c.get("videoCountText"))) if t)
                found.append((c["channelId"], _text(c.get("title")), info))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(json.loads(m.group(1)))
    return found


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def pick_channel(candidates, query):
    """Prefer a channel named exactly like the query (ignoring case, spaces and punctuation);
    otherwise YouTube's top result."""
    for c in candidates:
        if _norm(c[1]) == _norm(query):
            return c
    return candidates[0]


def find_channel_id(query):
    """Return ((channel_id, title, info), all_candidates) for a channel name."""
    r = session.get("https://www.youtube.com/results",
                    params={"search_query": query, "sp": "EgIQAg=="}, timeout=20)
    r.raise_for_status()
    candidates = parse_channel_search(r.text)
    if not candidates:
        raise RuntimeError("no channel found")
    return pick_channel(candidates, query), candidates


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


RELATIVE = re.compile(r"(\d+|an?|one)\s+(second|minute|hour|day|week|month|year)s?\s+ago", re.I)
UNIT_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400, "week": 604800,
                "month": 2629800, "year": 31557600}


def relative_to_iso(text, now):
    """'5 hours ago' -> ISO timestamp (approximate); None if the text has no age in it."""
    m = RELATIVE.search(text or "")
    if not m:
        return None
    n = 1 if m.group(1).lower() in ("a", "an", "one") else int(m.group(1))
    return (now - timedelta(seconds=n * UNIT_SECONDS[m.group(2).lower()])).isoformat(timespec="seconds")


def _strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from _strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from _strings(v)


def _lockup_title(lv):
    def find(o):
        if isinstance(o, dict):
            meta = o.get("lockupMetadataViewModel")
            if isinstance(meta, dict):
                t = meta.get("title")
                return t.get("content") if isinstance(t, dict) else t
            for v in o.values():
                r = find(v)
                if r:
                    return r
        elif isinstance(o, list):
            for v in o:
                r = find(v)
                if r:
                    return r
        return None
    return find(lv)


def parse_playlist_items(html):
    """Videos on a playlist page, in page order (newest first for uploads):
    [{"id", "title", "seconds", "ago"}]; "ago" is text like '5 hours ago' (or None)."""
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    if not m:
        raise RuntimeError("playlist page format not recognised")
    items, seen = [], set()

    def walk(o):
        if isinstance(o, dict):
            lv = o.get("lockupViewModel")
            if isinstance(lv, dict) and lv.get("contentId"):
                vid = lv["contentId"]
                if vid not in seen:
                    seen.add(vid)
                    ago = next((t for t in _strings(lv) if RELATIVE.search(t)), None)
                    items.append({"id": vid, "title": _lockup_title(lv),
                                  "seconds": parse_duration(_badge_text(lv)), "ago": ago})
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(json.loads(m.group(1)))
    return items


def parse_playlist(html):
    """Map video id -> length in seconds (None if unknown) from a playlist page."""
    return {it["id"]: it["seconds"] for it in parse_playlist_items(html)}


def feed_from_playlist(items, previous, now):
    """Stand-in for the RSS feed built from the uploads playlist: exact dates where we already
    know the video, otherwise the date worked out from '5 hours ago'."""
    feed = []
    for it in items:
        published = previous.get(it["id"], {}).get("published") or relative_to_iso(it["ago"], now)
        if published and it["title"]:
            feed.append({"id": it["id"], "title": it["title"], "published": published})
    return feed


def get_feed(channel_id, attempts=3):
    """The channel's RSS feed, retrying: YouTube sometimes answers 404/500 for a valid channel."""
    for attempt in range(attempts):
        try:
            r = session.get("https://www.youtube.com/feeds/videos.xml",
                            params={"channel_id": channel_id}, timeout=20)
            r.raise_for_status()
            return parse_feed(r.text)
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 * (attempt + 1))


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
            new_match = not ch.get("id")
            if new_match:
                (ch["id"], found_title, info), candidates = find_channel_id(ch.get("search", name))
                changed = True
                print(f"{name}: matched channel '{found_title}' ({ch['id']}) {info}")
                others = [f"'{t}' ({i})" for cid, t, i in candidates[:5] if cid != ch["id"]]
                if others:
                    print(f"{name}:   other search results: " + "; ".join(others))
            try:
                feed, feed_error = get_feed(ch["id"]), None
            except Exception as exc:
                feed, feed_error = None, exc
            lengths, shorts, lives, uploads = {}, set(), set(), []
            for label, load in (
                ("lengths", lambda: uploads.extend(parse_playlist_items(_playlist_html(ch["id"], "UULF")))),
                ("Shorts", lambda: shorts.update(parse_shorts(_playlist_html(ch["id"], "UUSH")))),
                ("live streams", lambda: lives.update(channel_playlist(ch["id"], "UULV"))),
            ):
                try:
                    load()
                except Exception as exc:  # no info for this list; still show the videos
                    print(f"{name}: could not read {label} list ({exc})", file=sys.stderr)
            lengths.update({it["id"]: it["seconds"] for it in uploads})
            if feed is None:
                if not uploads:
                    raise feed_error
                feed = feed_from_playlist(uploads, previous, datetime.now(timezone.utc))
                print(f"{name}: feed unavailable ({feed_error}); used the uploads list instead")
            if new_match and feed:
                print(f"{name}:   newest upload: '{feed[0]['title']}' ({feed[0]['published'][:10]})")
            videos = []
            for v in feed:
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
