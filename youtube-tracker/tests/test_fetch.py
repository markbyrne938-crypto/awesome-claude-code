import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from fetch_videos import parse_feed

FEED = """<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
xmlns="http://www.w3.org/2005/Atom"><entry><yt:videoId>abc123</yt:videoId>
<title>Hello &amp; welcome</title><published>2026-10-01T12:00:00+00:00</published></entry></feed>"""

def test_parse_feed():
    assert parse_feed(FEED) == [{"id": "abc123", "title": "Hello & welcome", "published": "2026-10-01T12:00:00+00:00"}]


def test_parse_duration():
    from fetch_videos import parse_duration
    assert parse_duration("1:13:58") == 4438
    assert parse_duration("22:05") == 1325
    assert parse_duration("LIVE") is None


def test_parse_playlist():
    import json
    from fetch_videos import parse_playlist
    lv = lambda vid, text: {"lockupViewModel": {"contentId": vid, "contentImage": {"thumbnailViewModel": {"overlays": [
        {"thumbnailBottomOverlayViewModel": {"badges": [{"thumbnailBadgeViewModel": {"text": text}}]}}]}}}}
    data = {"contents": [lv("aaa", "42:04"), lv("bbb", "1:13:58"), lv("ccc", "LIVE")]}
    html = f"<script>var ytInitialData = {json.dumps(data)};</script>"
    assert parse_playlist(html) == {"aaa": 2524, "bbb": 4438, "ccc": None}
