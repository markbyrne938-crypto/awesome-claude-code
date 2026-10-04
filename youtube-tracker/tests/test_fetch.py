import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from fetch_videos import parse_feed

FEED = """<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
xmlns="http://www.w3.org/2005/Atom"><entry><yt:videoId>abc123</yt:videoId>
<title>Hello &amp; welcome</title><published>2026-10-01T12:00:00+00:00</published></entry></feed>"""

def test_parse_feed():
    assert parse_feed(FEED) == [{"id": "abc123", "title": "Hello & welcome", "published": "2026-10-01T12:00:00+00:00"}]
