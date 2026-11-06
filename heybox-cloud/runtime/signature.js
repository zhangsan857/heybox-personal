// Web signing algorithm adapted from XiaHouSheng/heybox-core (MIT).
// See third-party/heybox-core-LICENSE and NOTICE.md.
import { createHash, randomBytes } from 'node:crypto';
const alphabet = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89';
const md5 = (value) => createHash('md5').update(value).digest('hex');
const mapChars = (text, chars) => [...text].map(c => chars[c.charCodeAt(0) % chars.length]).join('');
const double = (n) => n & 128 ? ((n << 1) ^ 27) & 255 : n << 1;
const triple = (n) => double(n) ^ n;
const k = (n) => triple(double(n));
const c = (n) => k(triple(double(n)));
const s = (n) => c(n) ^ k(n) ^ triple(n);
export const normalizePath = (path) => `/${path.split('/').filter(Boolean).join('/')}/`;
export function webSignature(path, time = Math.floor(Date.now() / 1000), nonce = randomBytes(16).toString('hex').toUpperCase()) {
    const parts = [mapChars(String(time + 1), alphabet.slice(0, -2)), mapChars(normalizePath(path), alphabet), mapChars(nonce, alphabet)];
    let mixed = '';
    for (let i = 0; i < Math.max(...parts.map(p => p.length)); i++) {
        for (const part of parts)
            mixed += part[i] ?? '';
    }
    const digest = md5(mixed.slice(0, 20));
    const input = [...digest.slice(-6)].map(char => char.charCodeAt(0));
    const transforms = [s, c, k, triple];
    // The original routine mutates the first four bytes and preserves the last two.
    const tail = input.slice(4).reduce((sum, n) => sum + n, 0);
    let total = tail;
    for (let row = 0; row < 4; row++) {
        total += input.slice(0, 4).reduce((n, value, col) => n ^ transforms[(col - row + 4) % 4](value), 0);
    }
    return { hkey: mapChars(digest.slice(0, 5), alphabet.slice(0, -4)) + String(total % 100).padStart(2, '0'), _time: String(time), nonce };
}
