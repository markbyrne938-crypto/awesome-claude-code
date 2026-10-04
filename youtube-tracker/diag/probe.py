import re, json, requests
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept-Language": "en-GB,en;q=0.9"}
s = requests.Session(); s.headers.update(UA); s.cookies.update({"CONSENT": "YES+1", "SOCS": "CAI"})
CH, VID = "UCnmGIkw-KdI0W5siakKPKog", "1w3XaMSIeR8"

def show(label, r):
    t = r.text
    print(f"== {label}: {r.status_code} len={len(t)} url={r.url[:80]}")
    return t

t = show("watch", s.get("https://www.youtube.com/watch", params={"v": VID}, timeout=30))
print("  lengthSeconds:", re.findall(r'"lengthSeconds":"(\d+)"', t)[:2], "| bot-gate:", "confirm you" in t or "not a bot" in t, "| consent:", "consent.youtube" in t)

t = show("uulf playlist", s.get("https://www.youtube.com/playlist", params={"list": "UULF" + CH[2:]}, timeout=30))
print("  lengthText:", re.findall(r'"lengthText":\{[^}]*?"simpleText":"([^"]+)"', t)[:5], "| publishedTimeText:", re.findall(r'"publishedTimeText":\{"simpleText":"([^"]+)"', t)[:3])

t = show("channel videos", s.get("https://www.youtube.com/channel/%s/videos" % CH, timeout=30))
print("  lengthText:", re.findall(r'"lengthText":\{[^}]*?"simpleText":"([^"]+)"', t)[:5])

for client, ver in [("ANDROID", "19.09.37"), ("IOS", "19.09.3"), ("TVHTML5_SIMPLY_EMBEDDED_PLAYER", "2.0"), ("WEB", "2.20240401.00.00")]:
    body = {"videoId": VID, "context": {"client": {"clientName": client, "clientVersion": ver, "hl": "en", "gl": "GB"},
            "thirdParty": {"embedUrl": "https://www.google.com"}}}
    try:
        r = s.post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", json=body, timeout=30)
        j = r.json()
        print(f"== innertube {client}: {r.status_code} status={j.get('playabilityStatus',{}).get('status')} reason={str(j.get('playabilityStatus',{}).get('reason'))[:60]} len={j.get('videoDetails',{}).get('lengthSeconds')}")
    except Exception as e:
        print(f"== innertube {client}: ERR {e}")
