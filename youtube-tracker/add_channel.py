#!/usr/bin/env python3
"""Queue a channel change without revealing it in the public repo.

    python3 add_channel.py "Channel name"            # add (looked up by name on the next run)
    python3 add_channel.py "Channel name" UCxxxx...  # add with a known channel ID
    python3 add_channel.py --remove "Channel name"   # stop tracking a channel

Writes an encrypted file to channel-requests/. Commit and push it to main: the next
workflow run (it starts straight away) decrypts it with the password, updates the
encrypted channel list and deletes the request.
"""
import json
import secrets
import sys
from pathlib import Path

from tracker_crypto import seal_request

HERE = Path(__file__).parent


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 1
    if argv[0] == "--remove":
        request = {"remove": " ".join(argv[1:])}
    else:
        request = {"add": argv[0]}
        if len(argv) > 1:
            request["id"] = argv[1]
    pub = (HERE / "channels.pub").read_text().strip()
    out = HERE / "channel-requests" / f"{secrets.token_hex(8)}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(seal_request(pub, request)) + "\n")
    print(f"wrote {out.relative_to(HERE.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
