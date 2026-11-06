import { createHmac, randomInt } from 'node:crypto';
/** APP 1.3.398 / shader 14 SHA512 variant, recovered from the native payload.
 * Constants, changed rotations, Ch, and pads are recovered from the decoded
 * bytecode. This is deliberately NOT advertised as standard SHA-512/HMAC.
 */
const K = [
    0x428a2f98d728ae22n,
    0x7137449123ef65cdn,
    0xb5c0fbcfec4d3b2fn,
    0xe9b5dba58189dbbcn,
    0x3956c25bf348b538n,
    0x59f111f1b605d019n,
    0x923f82a4af194f9bn,
    0xab1c5ed5da6d8118n,
    0xd807aa98a3030242n,
    0x12835b0145706fben,
    0x243185be4ee4b28cn,
    0x550c7dc3d5ffb4e2n,
    0x72be5d74f27b896fn,
    0x80deb1fe3b1696b1n,
    0x9bdc06a725c71235n,
    0xc19bf174cf692694n,
    0xe49b69c19ef14ad2n,
    0xefbe4786384f25e3n,
    0xfc19dc68b8cd5b5n,
    0x240ca1cc77ac9c65n,
    0x2de92c6f592b0275n,
    0x4a7484aa6ea6e483n,
    0x5cb0a9dcbd41fbd4n,
    0x76f988da831153b5n,
    0x983e5152ee66dfabn,
    0xa831c66d2db43210n,
    0xb00327c898fb213fn,
    0xbf597fc7beef0ee4n,
    0xc6e00bf33da88fc2n,
    0xd5a79147930aa725n,
    0x6ca6351e003826fn,
    0x142929670a0e6e70n,
    0x27b70a8546d22ffcn,
    0x2e1b21385c26c926n,
    0x4d2c6dfc5ac42aedn,
    0x53380d139d95b3dfn,
    0x650a73548baf63den,
    0x766a0abb3c77b2a8n,
    0x81c2c92e47edaee6n,
    0x92722c851482353bn,
    0xa2bfe8a14cf10364n,
    0xa81a664bbc423001n,
    0xc24b8b70d0f89791n,
    0xc76c51a30654be30n,
    0xd192e819d6ef5218n,
    0xd69906245565a910n,
    0xf40e35855771202an,
    0x106aa07032bbd1b8n,
    0x19a4c116b8d2d0c8n,
    0x1e376c085141ab53n,
    0x2748774cdf8eeb99n,
    0x34b0bcb5e19b48a8n,
    0x391c0cb3c5c95a63n,
    0x4ed8aa4ae3418acbn,
    0x5b9cca4f7763e373n,
    0x682e6ff3d6b2b8a3n,
    0x748f82ee5defb2fcn,
    0x78a5636f43172f60n,
    0x84c87814a1f0ab72n,
    0x8cc702081a6439ecn,
    0x7ba0ea2d98160007n,
    0x7eabf2d0c21f964an,
    0x8dbe8d038b409545n,
    0x90bb1721582e8285n,
    0x99a2ad45936d4e61n,
    0x9f86e289fe03e73an,
    0xa84c4472faa9a82fn,
    0xb3df34fce89e0532n,
    0xb99bb8d7b173534fn,
    0xbc76cbab1aea1f9cn,
    0xc226a69a780f3cc3n,
    0xd304f19aa233957dn,
    0xde1be20a212129ddn,
    0xe39bb43755141950n,
    0xee84927cea48ddd2n,
    0xf3edd2773c523b67n,
    0xfbfdfe53a8d32f2an,
    0xbee2c7ab77e9e25n,
    0xe90181cf1b09e56n,
    0x25f57204c725bed8n,
];
const MASK = (1n << 64n) - 1n;
const IV = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n, 0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
const ror = (x, bits) => ((x >> BigInt(bits)) | (x << BigInt(64 - bits))) & MASK;
const S0 = (x) => ror(x, 21) ^ ror(x, 31) ^ ror(x, 39);
const S1 = (x) => ror(x, 14) ^ ror(x, 18) ^ ror(x, 41);
const s0 = (x) => ror(x, 1) ^ ror(x, 8) ^ (x >> 7n);
const s1 = (x) => ror(x, 38) ^ ror(x, 55) ^ (x >> 6n);
const Ch = (x, y, z) => (x & (y ^ z)) ^ y;
const Maj = (x, y, z) => (x & (y | z)) | (y & z);
function customSHA512(input) {
    const data = Buffer.from(input);
    const size = Math.ceil((data.length + 1 + 16) / 128) * 128;
    const padded = Buffer.alloc(size);
    data.copy(padded);
    padded[data.length] = 0x80;
    const bits = BigInt(data.length) * 8n;
    padded.writeBigUInt64BE(bits >> 64n, size - 16);
    padded.writeBigUInt64BE(bits & MASK, size - 8);
    const state = [...IV];
    for (let offset = 0; offset < size; offset += 128) {
        const W = Array(80).fill(0n);
        for (let i = 0; i < 16; i++)
            W[i] = padded.readBigUInt64BE(offset + i * 8);
        for (let i = 16; i < 80; i++)
            W[i] = (s1(W[i - 2]) + W[i - 7] + s0(W[i - 15]) + W[i - 16]) & MASK;
        let [a, b, c, d, e, f, g, h] = state;
        for (let i = 0; i < 80; i++) {
            const t1 = (h + S1(e) + Ch(e, f, g) + K[i] + W[i]) & MASK;
            const t2 = (S0(a) + Maj(a, b, c)) & MASK;
            [a, b, c, d, e, f, g, h] = [(t1 + t2) & MASK, a, b, c, (d + t1) & MASK, e, f, g];
        }
        const v = [a, b, c, d, e, f, g, h];
        for (let i = 0; i < 8; i++)
            state[i] = (state[i] + v[i]) & MASK;
    }
    const out = Buffer.alloc(64);
    state.forEach((x, i) => out.writeBigUInt64BE(x, i * 8));
    return out;
}
function customHmacSHA512(keyInput, data) {
    let key = Buffer.from(keyInput);
    if (key.length > 128)
        key = customSHA512(key);
    const ipad = Buffer.alloc(128, 0x52), opad = Buffer.alloc(128, 0x6c);
    for (let i = 0; i < key.length; i++) {
        ipad[i] ^= key[i];
        opad[i] ^= key[i];
    }
    return customSHA512(Buffer.concat([opad, customSHA512(Buffer.concat([ipad, Buffer.from(data)]))]));
}
// Native eE2/eE3 callbacks. The native buffers truncate UTF-8 input to 127 bytes.
function eE2(input) {
    const bytes = Buffer.from(input, 'utf8');
    const nul = bytes.indexOf(0);
    const output = Buffer.from(bytes.subarray(0, Math.min(127, nul < 0 ? bytes.length : nul)));
    for (let i = 0; i < output.length; i++) {
        const c = output[i];
        const x = (c & 0x7f) ^ 0x37;
        output[i] = x === 0 || (i + 1) % 3 === 0 ? ((c & 7) << 4) ^ 0x37 : x;
    }
    return output;
}
function eE3(input) {
    const output = eE2(input);
    for (let i = 0; i < output.length; i++) {
        const c = output[i];
        const x = (c & 0x7f) ^ 0x46;
        output[i] = x === 0 || (i + 1) % 5 === 0 ? ((c & 31) << 2) ^ 0x46 : x;
    }
    return output;
}
const DAILY_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const HKEY_KEY = Buffer.from('LFEJGJJOKCEHODNMNFIKKONFBKIHJFKB', 'ascii');
function utcDateKey(timeSeconds) {
    const date = new Date(Number(timeSeconds) * 1000);
    return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}
function dailyNonceAlphabet(timeSeconds) {
    const day = utcDateKey(timeSeconds);
    return Array.from({ length: 32 }, (_, i) => DAILY_ALPHABET[(day + 705 + i * 7) % 62]).join('');
}
/** Native uses 32 independent uniform draws from a daily 32-character alphabet. */
export function makeNativeNonce(timeSeconds, indexSource = randomInt) {
    const alphabet = dailyNonceAlphabet(timeSeconds);
    return Array.from({ length: 32 }, () => alphabet[indexSource(32)]).join('');
}
function reflectedCrc32(bytes, polynomial) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ ((crc & 1) ? polynomial : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function hex(value) { return value.toString(16).toUpperCase(); }
export function signNative(input) {
    const digest = createHmac('sha512', HKEY_KEY).update(input.path + input.time + input.debugInfo, 'utf8').digest();
    const hash = customHmacSHA512(eE2(input.path + input.time), eE3(input.debugInfo + input.osVersion + input.version)).toString('hex');
    return {
        _time: input.time,
        nonce: makeNativeNonce(input.time),
        hkey: hex(reflectedCrc32(digest, 0x88a4b5a0)),
        _rnd: '14:' + hex(reflectedCrc32(Buffer.from(hash, 'ascii'), 0xad350290)),
    };
}
