/**
 * Minimal, dependency-free SHA-256 and HMAC-SHA256.
 *
 * The provably-fair verifier has to produce byte-identical results on the
 * server (Node) and in the player's browser, synchronously and without a
 * bundler polyfilling node:crypto. A small pure implementation gives us that
 * guarantee; the test suite cross-checks it against node:crypto.
 */

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const BLOCK_SIZE = 64;

export function utf8Encode(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

export function bytesToHex(bytes: Uint8Array): string {
    let hex = '';

    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }

    return hex;
}

function toBytes(input: string | Uint8Array): Uint8Array {
    return typeof input === 'string' ? utf8Encode(input) : input;
}

export function sha256(input: string | Uint8Array): Uint8Array {
    const message = toBytes(input);
    const bitLength = message.length * 8;
    const paddedLength = Math.ceil((message.length + 9) / BLOCK_SIZE) * BLOCK_SIZE;
    const padded = new Uint8Array(paddedLength);
    padded.set(message);
    padded[message.length] = 0x80;

    const view = new DataView(padded.buffer);
    // Messages are far below 2^53 bits, so the high word is derived by division.
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(paddedLength - 4, bitLength >>> 0);

    const hash = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    const w = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += BLOCK_SIZE) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(offset + i * 4);
        }

        for (let i = 16; i < 64; i++) {
            const x = w[i - 15];
            const y = w[i - 2];
            const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
            const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        let a = hash[0];
        let b = hash[1];
        let c = hash[2];
        let d = hash[3];
        let e = hash[4];
        let f = hash[5];
        let g = hash[6];
        let h = hash[7];

        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);

    for (let i = 0; i < 8; i++) {
        outView.setUint32(i * 4, hash[i]);
    }

    return out;
}

export function hmacSha256(key: string | Uint8Array, message: string | Uint8Array): Uint8Array {
    let keyBytes = toBytes(key);

    if (keyBytes.length > BLOCK_SIZE) {
        keyBytes = sha256(keyBytes);
    }

    const block = new Uint8Array(BLOCK_SIZE);
    block.set(keyBytes);

    const inner = new Uint8Array(BLOCK_SIZE);
    const outer = new Uint8Array(BLOCK_SIZE);

    for (let i = 0; i < BLOCK_SIZE; i++) {
        inner[i] = block[i] ^ 0x36;
        outer[i] = block[i] ^ 0x5c;
    }

    const messageBytes = toBytes(message);
    const innerInput = new Uint8Array(BLOCK_SIZE + messageBytes.length);
    innerInput.set(inner);
    innerInput.set(messageBytes, BLOCK_SIZE);
    const innerHash = sha256(innerInput);

    const outerInput = new Uint8Array(BLOCK_SIZE + innerHash.length);
    outerInput.set(outer);
    outerInput.set(innerHash, BLOCK_SIZE);

    return sha256(outerInput);
}

export function sha256Hex(input: string | Uint8Array): string {
    return bytesToHex(sha256(input));
}

export function hmacSha256Hex(key: string | Uint8Array, message: string | Uint8Array): string {
    return bytesToHex(hmacSha256(key, message));
}
