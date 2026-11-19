// The v2 adapter-service frame codec: a 4-byte big-endian length, then that
// many bytes of JSON {protocol_version: 1, kind, payload}.
// Upstream format (spt docs harness-contract/adapter-v2.md): copy verbatim.

export const MAX_FRAME = 16 * 1024 * 1024;

// [impl->REQ-FRAME-CODEC]
export function encode(kind, payload) {
  const json = Buffer.from(JSON.stringify({ protocol_version: 1, kind, payload }));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length);
  return Buffer.concat([len, json]);
}

// Feed raw socket chunks; get back every complete frame. Throws on a frame
// that is longer than MAX_FRAME (spt never sends one).
export class FrameReader {
  #buf = Buffer.alloc(0);

  push(chunk) {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const out = [];
    while (this.#buf.length >= 4) {
      const len = this.#buf.readUInt32BE(0);
      if (len > MAX_FRAME) throw new Error(`frame too long: ${len}`);
      if (this.#buf.length < 4 + len) break;
      out.push(JSON.parse(this.#buf.subarray(4, 4 + len).toString('utf8')));
      this.#buf = this.#buf.subarray(4 + len);
    }
    return out;
  }
}
