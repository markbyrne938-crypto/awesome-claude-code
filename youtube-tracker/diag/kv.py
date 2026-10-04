import requests, secrets
for size in (5_000, 20_000, 100_000, 400_000):
    key = "yt-probe-" + secrets.token_urlsafe(18)
    base = f"https://textdb.dev/api/data/{key}"
    body = ("abcdefghijk,1,12345\n" * (size // 20 + 1))[:size]
    try:
        p = requests.post(base, data=body, headers={"Content-Type": "text/plain"}, timeout=30)
        g = requests.get(base, timeout=30)
        print(f"size {size}: POST {p.status_code} GET {g.status_code} roundtrip_ok={g.text == body} got={len(g.text)}")
    except Exception as e:
        print(f"size {size}: ERR {e}")
# a different key must not see another's data, and a short key behaves the same
k = "yt-probe-" + secrets.token_urlsafe(18)
requests.post(f"https://textdb.dev/api/data/{k}", data="secret", headers={"Content-Type": "text/plain"}, timeout=20)
print("other key sees:", repr(requests.get(f"https://textdb.dev/api/data/{k}x", timeout=20).text))
