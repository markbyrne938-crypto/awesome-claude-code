import requests, secrets, json
ORIGIN = "https://markbyrne938-crypto.github.io"
H = lambda r: {k: v for k, v in r.headers.items() if k.lower().startswith("access-control") or k.lower() in ("location", "content-type", "cache-control")}

def show(label, r, body=True):
    print(f"-- {label}: {r.status_code} {H(r)}" + (f" body={r.text[:100]!r}" if body else ""))

# 1) textdb.dev: client-chosen key, text value
key = "yt-probe-" + secrets.token_urlsafe(18)
base = f"https://textdb.dev/api/data/{key}"
try:
    show("textdb preflight", requests.options(base, headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}, timeout=20))
    show("textdb POST", requests.post(base, data=json.dumps({"hello": 1}), headers={"Origin": ORIGIN, "Content-Type": "text/plain"}, timeout=20))
    show("textdb GET", requests.get(base, headers={"Origin": ORIGIN}, timeout=20))
    show("textdb POST overwrite", requests.post(base, data=json.dumps({"hello": 2}), headers={"Origin": ORIGIN, "Content-Type": "text/plain"}, timeout=20))
    show("textdb GET 2", requests.get(base, headers={"Origin": ORIGIN}, timeout=20))
    show("textdb GET missing", requests.get(base + "-nope", headers={"Origin": ORIGIN}, timeout=20))
except Exception as e:
    print("textdb ERR", e)

# 2) jsonblob.com: server-chosen id returned in Location
try:
    r = requests.post("https://jsonblob.com/api/jsonBlob", json={"hello": 1}, headers={"Origin": ORIGIN, "Accept": "application/json"}, timeout=20)
    show("jsonblob POST", r)
    loc = r.headers.get("Location")
    if loc:
        show("jsonblob preflight PUT", requests.options(loc, headers={"Origin": ORIGIN, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type"}, timeout=20), False)
        show("jsonblob PUT", requests.put(loc, json={"hello": 2}, headers={"Origin": ORIGIN, "Accept": "application/json"}, timeout=20))
        show("jsonblob GET", requests.get(loc, headers={"Origin": ORIGIN, "Accept": "application/json"}, timeout=20))
except Exception as e:
    print("jsonblob ERR", e)
