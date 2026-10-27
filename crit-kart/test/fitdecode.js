// An independent FIT reader used by the tests: validates header/file CRCs and returns [{num, v}] messages.
const assert = require('assert');
require('../js/export.js');
const C = globalThis.Crit;

function decodeFit(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = bytes.length;
  assert.strictEqual(bytes[0], 14, 'header size'); assert.strictEqual(String.fromCharCode(...bytes.slice(8, 12)), '.FIT', '.FIT signature');
  const dataSize = dv.getUint32(4, true); assert.strictEqual(14 + dataSize + 2, n, 'declared data size matches the file');
  assert.strictEqual(C.fit.crc16(bytes.slice(0, 12)), dv.getUint16(12, true), 'header CRC');
  assert.strictEqual(C.fit.crc16(bytes.slice(0, n - 2)), dv.getUint16(n - 2, true), 'file CRC');
  const defs = {}, msgs = []; let pos = 14;
  while (pos < 14 + dataSize) {
    const h = bytes[pos++];
    if (h & 0x40) { // definition message
      assert.strictEqual(h & 0x20, 0, 'no developer fields'); pos++; const le = bytes[pos++] === 0; const num = dv.getUint16(pos, le); pos += 2; const nf = bytes[pos++], fields = [];
      for (let i = 0; i < nf; i++) { fields.push({ n: bytes[pos], size: bytes[pos + 1], type: bytes[pos + 2] }); pos += 3; }
      defs[h & 0x0f] = { num, le, fields };
    } else {
      const d = defs[h & 0x0f]; assert.ok(d, 'data message has a definition'); const v = {};
      for (const f of d.fields) {
        if (f.type === 0x07) { let str = ''; for (let i = 0; i < f.size && bytes[pos + i]; i++) str += String.fromCharCode(bytes[pos + i]); v[f.n] = str; }
        else if (f.size === 1) v[f.n] = bytes[pos]; else if (f.size === 2) v[f.n] = dv.getUint16(pos, d.le); else v[f.n] = f.type === 0x85 ? dv.getInt32(pos, d.le) : dv.getUint32(pos, d.le);
        pos += f.size;
      }
      msgs.push({ num: d.num, v });
    }
  }
  assert.strictEqual(pos, 14 + dataSize, 'consumed exactly the declared data');
  return msgs;
}

module.exports = { decodeFit };
