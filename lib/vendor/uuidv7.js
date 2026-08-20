// A small, dependency-free UUIDv7 (RFC 9562) generator: a 48-bit
// big-endian Unix-millisecond timestamp, a 4-bit version, a 12-bit
// monotonic counter (RFC 9562 §6.2 Method 1, "Fixed-Length Dedicated
// Counter Bits" — keeps ids generated within the same millisecond in
// strict creation order instead of relying on tie-break luck), a 2-bit
// variant, and 62 random bits. Vendored rather than hand-rolled ad hoc
// because getting the monotonic-counter edge case right matters here:
// the app's device-transfer merge logic relies on ids it generates
// sorting in creation order.
//
// crypto.getRandomValues is native (no library needed for randomness);
// only the RFC's bit layout is worth pulling in as a small vetted unit.

let lastMs = 0;
let counter = 0;

function randomBits(bits) {
  const bytes = Math.ceil(bits / 8);
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let value = 0n;
  for (const b of buf) value = (value << 8n) | BigInt(b);
  return value >> BigInt(bytes * 8 - bits);
}

export function uuidv7() {
  const ms = Date.now();
  if (ms > lastMs) {
    lastMs = ms;
    counter = Number(randomBits(12)); // reseeded per RFC 9562, not reset to 0
  } else {
    // Same millisecond (or the wall clock went backward, or a prior
    // overflow already pushed lastMs ahead of real time) — keep
    // advancing from lastMs so ids never stop sorting in creation order.
    counter += 1;
    if (counter > 0xfff) {
      lastMs += 1; // 12-bit counter exhausted this ms — advance rather than reseed non-monotonically
      counter = Number(randomBits(12));
    }
  }

  let value = BigInt(lastMs) & 0xffffffffffffn; // bits 127-80: 48-bit timestamp
  value = (value << 4n) | 0x7n; // bits 79-76: version 7
  value = (value << 12n) | BigInt(counter); // bits 75-64: monotonic counter
  value = (value << 2n) | 0x2n; // bits 63-62: variant (10)
  value = (value << 62n) | randomBits(62); // bits 61-0: random

  const hex = value.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
