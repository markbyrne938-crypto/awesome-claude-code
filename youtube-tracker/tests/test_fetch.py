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


def test_parse_shorts():
    from fetch_videos import parse_shorts
    html = '{"videoId":"abcdefghijk"} {"contentId":"lmnopqrstuv"} {"videoId":"short"}'
    assert parse_shorts(html) == {"abcdefghijk", "lmnopqrstuv"}


def test_keep_video():
    from fetch_videos import keep_video
    lengths = {"a": 100, "b": 200, "c": 300}
    assert keep_video("a", lengths, set(), set())
    assert not keep_video("s", lengths, {"s"}, set())      # Short
    assert not keep_video("b", lengths, set(), {"b"})      # live stream, even if also listed as a video
    assert not keep_video("z", lengths, set(), set())      # not a normal upload (e.g. premiere)
    assert keep_video("z", {}, set(), set())               # no lists available: don't hide anything


def test_is_recent():
    from datetime import datetime, timezone
    from fetch_videos import is_recent
    now = datetime(2026, 10, 4, tzinfo=timezone.utc)
    assert is_recent("2026-09-10T12:00:00+00:00", 31, now)
    assert not is_recent("2026-08-30T12:00:00+00:00", 31, now)


def test_channel_search_prefers_exact_name():
    import json
    from fetch_videos import parse_channel_search, pick_channel
    ch = lambda cid, title, subs: {"channelRenderer": {"channelId": cid, "title": {"simpleText": title},
                                                       "videoCountText": {"simpleText": subs}}}
    data = {"contents": [ch("UC1", "Ben Morris Music", "50K subscribers"),
                         ch("UC2", "Ben Morris", "200K subscribers"),
                         ch("UC3", "Ben Morris", "3K subscribers")]}
    found = parse_channel_search(f"<script>var ytInitialData = {json.dumps(data)};</script>")
    assert found[0] == ("UC1", "Ben Morris Music", "50K subscribers")
    assert pick_channel(found, "Ben Morris")[0] == "UC2"            # first exact name match wins
    assert pick_channel(found, "Steve Marsh")[0] == "UC1"           # no exact match: top result
    assert pick_channel([("UC9", "SteveMarsh", "")], "Steve Marsh")[0] == "UC9"   # spaces ignored
