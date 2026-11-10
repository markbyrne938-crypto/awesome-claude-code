"""Encryption for the watchlist, so the public repo and website only ever hold ciphertext.

Everything hangs off one password (the TRACKER_PASSWORD Actions secret):

* data key   = PBKDF2-HMAC-SHA256(password, DATA_SALT, ITERATIONS) -> 32 bytes
  Used with AES-256-GCM for the site data (data.json) and the channel list
  (channels.enc.json). The page derives the same key in the browser (WebCrypto),
  so the format must stay in step with decryptEnvelope() in index.html.
* request key = an X25519 key pair derived from the data key. Its public half is
  committed as channels.pub, so channel changes can be sealed by anyone who has the
  repo (see add_channel.py) and opened only by the workflow, which knows the password.
"""
import base64
import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

DATA_SALT = b"yt-watchlist/data/v1"
ITERATIONS = 600_000
REQUEST_INFO = b"yt-watchlist channel request v1"


def b64(data):
    return base64.b64encode(data).decode()


def unb64(text):
    return base64.b64decode(text)


def data_key(password):
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=DATA_SALT, iterations=ITERATIONS)
    return kdf.derive(password.encode("utf-8"))


def encrypt_json(key, obj):
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode("utf-8"), None)
    return {"v": 1, "iv": b64(iv), "ct": b64(ct)}


def decrypt_json(key, envelope):
    """Raises cryptography.exceptions.InvalidTag for a wrong key or tampered data."""
    plain = AESGCM(key).decrypt(unb64(envelope["iv"]), unb64(envelope["ct"]), None)
    return json.loads(plain.decode("utf-8"))


def is_envelope(obj):
    return isinstance(obj, dict) and obj.get("v") == 1 and "iv" in obj and "ct" in obj


def _request_private_key(key):
    seed = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"channel-requests").derive(key)
    return X25519PrivateKey.from_private_bytes(seed)


def request_public_key(key):
    return b64(_request_private_key(key).public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))


def _request_cipher_key(shared, epk, pub):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=epk + pub, info=REQUEST_INFO).derive(shared)


def seal_request(public_key_b64, obj):
    """Encrypt a channel change so only the workflow (which knows the password) can read it."""
    pub = unb64(public_key_b64)
    eph = X25519PrivateKey.generate()
    epk = eph.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    k = _request_cipher_key(eph.exchange(X25519PublicKey.from_public_bytes(pub)), epk, pub)
    iv = os.urandom(12)
    ct = AESGCM(k).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode("utf-8"), None)
    return {"v": 1, "epk": b64(epk), "iv": b64(iv), "ct": b64(ct)}


def open_request(key, sealed):
    priv = _request_private_key(key)
    pub = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    epk = unb64(sealed["epk"])
    k = _request_cipher_key(priv.exchange(X25519PublicKey.from_public_bytes(epk)), epk, pub)
    return json.loads(AESGCM(k).decrypt(unb64(sealed["iv"]), unb64(sealed["ct"]), None).decode("utf-8"))
