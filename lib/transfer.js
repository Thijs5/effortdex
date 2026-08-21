// @ts-check
// Encodes/decodes a device-transfer payload (the array `Store#exportPayload`
// returns) into a single string safe to embed as one hash path segment,
// for sharing via a link (see lib/router.js's #/import/<payload> route).
//
// Format: "<version>:<base64url data>". Version "1" gzip-compresses the
// JSON first (a roster's JSON commonly runs tens of KB — far too long for
// a URL without compression); version "0" is the plain uncompressed
// fallback for browsers without CompressionStream (older Safari). The
// base64url alphabet (+/  ->  -_, no padding) needs no extra encoding to
// live safely inside a URL hash.

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** @param {Uint8Array} bytes @returns {string} */
function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} str @returns {Uint8Array} */
function fromBase64Url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** @param {Uint8Array} bytes @returns {Promise<Uint8Array>} */
async function gzip(bytes) {
  const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @param {Uint8Array} bytes @returns {Promise<Uint8Array>} */
async function gunzip(bytes) {
  const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** `parties` is the array from `Store#exportPayload()`. Resolves to a shareable string.
 * @param {import('./store.js').ExportedParty[]} parties @returns {Promise<string>} */
export async function encodeTransferPayload(parties) {
  const json = textEncoder.encode(JSON.stringify(parties));
  if (typeof CompressionStream === 'function') {
    return `1:${toBase64Url(await gzip(json))}`;
  }
  return `0:${toBase64Url(json)}`;
}

/** Reverses `encodeTransferPayload`. Throws on malformed input.
 * @param {string} str @returns {Promise<import('./store.js').ExportedParty[]>} */
export async function decodeTransferPayload(str) {
  const sep = str.indexOf(':');
  if (sep === -1) throw new Error('Malformed transfer payload');
  const version = str.slice(0, sep);
  const bytes = fromBase64Url(str.slice(sep + 1));
  const json = version === '1' ? await gunzip(bytes) : version === '0' ? bytes : null;
  if (!json) throw new Error(`Unknown transfer payload version: ${version}`);
  const parsed = JSON.parse(textDecoder.decode(json));
  if (!Array.isArray(parsed)) throw new Error('Malformed transfer payload');
  return parsed;
}
