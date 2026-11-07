import json, sys
sys.path.insert(0, "youtube-tracker")
import fetch_videos as fv
rid = "UCnmGIkw-KdI0W5siakKPKog"  # Ryan Trahan
try:
    r = fv.session.get("https://www.youtube.com/feeds/videos.xml", params={"channel_id": rid}, timeout=20)
    print("RSS status for Ryan Trahan:", r.status_code)
except Exception as e:
    print("RSS error:", e)
items = fv.parse_playlist_items(fv._playlist_html(rid, "UULF"))
print("uploads list items:", len(items))
for it in items[:4]:
    print("  ", it)
out = json.load(open("youtube-tracker/videos.json"))
print("checked:", out["updated"])
for c in out["channels"]:
    print(f"{c['name']}: " + " | ".join(f"{v['published'][:16]} {v['title'][:40]}" for v in c["videos"][:2]) + (f"  [error: {c['error'][:60]}]" if c.get("error") else ""))
