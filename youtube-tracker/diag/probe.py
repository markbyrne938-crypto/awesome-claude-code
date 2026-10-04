import re, requests
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept-Language": "en-GB,en;q=0.9"}
s = requests.Session(); s.headers.update(UA); s.cookies.update({"CONSENT": "YES+1", "SOCS": "CAI"})
CH, VID = "UCnmGIkw-KdI0W5siakKPKog", "1w3XaMSIeR8"
for label, url in [("uulf playlist", "https://www.youtube.com/playlist?list=UULF" + CH[2:]),
                   ("channel videos", f"https://www.youtube.com/channel/{CH}/videos")]:
    t = s.get(url, timeout=30).text
    print("==", label, len(t), "has ytInitialData:", "ytInitialData" in t)
    for key in ["thumbnailOverlayTimeStatusRenderer", "lengthText", "lockupViewModel", "videoRenderer", "playlistVideoRenderer", "thumbnailBadgeViewModel", VID]:
        print("  ", key, t.count(key))
    for key in ["thumbnailBadgeViewModel", "thumbnailOverlayTimeStatusRenderer", "playlistVideoRenderer", "lengthSeconds"]:
        i = t.find(key)
        if i >= 0: print("  --", key, "->", t[max(0, i-100):i+400].replace("\n", " "))
print("== times:", re.findall(r'"(?:text|simpleText)":"(\d{1,2}:\d\d(?::\d\d)?)"', t)[:8])
