#!/usr/bin/env python3
"""YouTube subscription tracker. Standard library only.

Run:  python3 server.py   then open http://localhost:8000
"""
import json, re, threading, time, urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
CHANNELS_FILE = ROOT / "channels.json"
STATE_FILE = DATA / "state.json"      # watched ids, resolved channel ids, duration cache
PORT = 8000
REFRESH_EVERY = 15 * 60               # seconds between automatic checks
FEED_DEPTH = 8                        # recent uploads inspected per channel (to skip Shorts)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-GB,en;q=0.9",
    "Cookie": "CONSENT=YES+1; SOCS=CAI",
}

lock = threading.Lock()
state = {"watched": {}, "channel_ids": {}, "videos": {}}   # videos: id -> {seconds, short}
if STATE_FILE.exists():
    try:
        state.update(json.loads(STATE_FILE.read_text()))
    except Exception:
        pass
results = {"checked": None, "items": [], "refreshing": False}


def save_state():
    with lock:
        STATE_FILE.write_text(json.dumps(state, indent=1))


def fetch(url, follow=True):
    req = urllib.request.Request(url, headers=HEADERS)
    if follow:
        return urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace")

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    try:
        return urllib.request.build_opener(NoRedirect).open(req, timeout=20).status
    except urllib.error.HTTPError as e:
        return e.code


def resolve_channel(ch):
    """Return a channel id (UC...) from channels.json entry: channel_id, handle, or name search."""
    if ch.get("channel_id"):
        return ch["channel_id"]
    key = ch.get("handle") or ch["name"]
    if key in state["channel_ids"]:
        return state["channel_ids"][key]
    if ch.get("handle"):
        page = fetch("https://www.youtube.com/@" + ch["handle"].lstrip("@"))
        m = re.search(r'rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"', page) \
            or re.search(r'"channelId":"(UC[\w-]{22})"', page)
    else:
        q = urllib.parse.quote(ch["name"])
        page = fetch(f"https://www.youtube.com/results?search_query={q}&sp=EgIQAg%253D%253D")  # channels only
        m = re.search(r'"channelRenderer":\{"channelId":"(UC[\w-]{22})"', page)
    if not m:
        raise RuntimeError("Could not find channel - add a handle or channel_id in channels.json")
    state["channel_ids"][key] = m.group(1)
    return m.group(1)


def video_info(vid):
    """Duration in seconds and whether it is a Short (cached forever; neither changes)."""
    info = state["videos"].get(vid)
    if info:
        return info
    page = fetch("https://www.youtube.com/watch?v=" + vid)
    m = re.search(r'"lengthSeconds":"(\d+)"', page)
    upcoming = '"isUpcoming":true' in page
    seconds = int(m.group(1)) if m else 0
    short = fetch(f"https://www.youtube.com/shorts/{vid}", follow=False) == 200
    info = {"seconds": seconds, "short": short}
    if not upcoming and seconds:           # don't cache premieres/live streams, check again later
        state["videos"][vid] = info
    return {**info, "skip": upcoming or not seconds}


def latest_video(ch):
    cid = resolve_channel(ch)
    ns = {"a": "http://www.w3.org/2005/Atom", "y": "http://www.youtube.com/xml/schemas/2015"}
    root = ET.fromstring(fetch("https://www.youtube.com/feeds/videos.xml?channel_id=" + cid))
    channel_name = root.findtext("a:author/a:name", default=ch["name"], namespaces=ns)
    for entry in root.findall("a:entry", ns)[:FEED_DEPTH]:
        vid = entry.findtext("y:videoId", namespaces=ns)
        info = video_info(vid)
        if info.get("short") or info.get("skip"):
            continue
        return {
            "channel": ch["name"], "channelName": channel_name,
            "channelUrl": "https://www.youtube.com/channel/" + cid,
            "id": vid, "title": entry.findtext("a:title", namespaces=ns),
            "published": entry.findtext("a:published", namespaces=ns),
            "seconds": info["seconds"], "url": "https://www.youtube.com/watch?v=" + vid,
        }
    raise RuntimeError("No recent non-Short videos found")


def refresh():
    if results["refreshing"]:
        return
    results["refreshing"] = True
    try:
        channels = json.loads(CHANNELS_FILE.read_text())

        def one(ch):
            try:
                return latest_video(ch)
            except Exception as e:
                return {"channel": ch["name"], "error": str(e)}
        with ThreadPoolExecutor(4) as pool:
            items = list(pool.map(one, channels))
        results["items"] = items
        results["checked"] = datetime.now(timezone.utc).isoformat()
        save_state()
    finally:
        results["refreshing"] = False


def background():
    while True:
        try:
            refresh()
        except Exception as e:
            print("refresh failed:", e)
        time.sleep(REFRESH_EVERY)


def payload():
    items = [{**i, "watched": bool(state["watched"].get(i.get("id")))} for i in results["items"]]
    return {"checked": results["checked"], "refreshing": results["refreshing"], "items": items}


class Handler(BaseHTTPRequestHandler):
    def send(self, body, ctype="application/json", code=200):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.send((ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/videos":
            self.send(payload())
        else:
            self.send({"error": "not found"}, code=404)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path == "/api/refresh":
            threading.Thread(target=refresh, daemon=True).start()
            results["refreshing"] = True
            self.send({"ok": True})
        elif self.path == "/api/watched":
            req = json.loads(body)
            with lock:
                if req.get("watched"):
                    state["watched"][req["id"]] = datetime.now(timezone.utc).isoformat()
                else:
                    state["watched"].pop(req["id"], None)
            save_state()
            self.send({"ok": True})
        else:
            self.send({"error": "not found"}, code=404)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    threading.Thread(target=background, daemon=True).start()
    print(f"Open http://localhost:{PORT}  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
