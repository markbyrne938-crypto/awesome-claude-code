#!/usr/bin/env python3
"""Run the tracker locally: python3 serve.py  ->  http://localhost:8000
The Refresh button on the page calls /refresh, which re-runs fetch_videos.py."""
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def do_POST(self):
        if self.path != "/refresh":
            return self.send_error(404)
        p = subprocess.run([sys.executable, str(HERE / "fetch_videos.py")], capture_output=True, text=True)
        self.send_response(200 if p.returncode == 0 else 500)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write((p.stdout + p.stderr).encode())

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print("Open http://localhost:8000")
    ThreadingHTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
