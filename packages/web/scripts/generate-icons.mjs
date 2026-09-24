import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const i = row + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const GREEN = [47, 122, 75];
const CREAM = [251, 252, 249];

// A seedling: one stem, two leaves angled up and out from its tip.
const STEM_TOP = -0.10, STEM_BOTTOM = 0.78, STEM_HALF = 0.055;
const LEAF_PHI = 0.61;     // radians above horizontal
const LEAF_REACH = 0.26;   // centre distance from the stem tip
const LEAF_LONG = 0.34, LEAF_SHORT = 0.145;
// The mark spans roughly -0.40 to 0.78 vertically; shift it so it sits centred.
const Y_SHIFT = 0.19;

function seedling(maskable) {
  return (x, y, size) => {
    const s = 4;
    let hits = 0;
    for (let sy = 0; sy < s; sy++) {
      for (let sx = 0; sx < s; sx++) {
        // Maskable icons must keep their content inside a safe circle.
        const k = maskable ? 0.60 : 0.72;
        const px = (((x + (sx + 0.5) / s) / size) * 2 - 1) / k;
        const py = (((y + (sy + 0.5) / s) / size) * 2 - 1) / k + Y_SHIFT;

        const stem = Math.abs(px) < STEM_HALF && py > STEM_TOP && py < STEM_BOTTOM;

        let leaf = false;
        for (const dir of [-1, 1]) {
          const phi = dir * -LEAF_PHI;
          const cx = Math.cos(phi) * LEAF_REACH * dir;
          // abs(): both leaves rise by the same amount. Using sin(phi) directly
          // sent one up and the other down, which is why they looked mismatched.
          const cy = -Math.abs(Math.sin(phi)) * LEAF_REACH + STEM_TOP;
          const lx = px - cx;
          const ly = py - cy;
          // Rotate into the leaf's own frame, then test the ellipse.
          const rx = lx * Math.cos(phi) + ly * Math.sin(phi);
          const ry = -lx * Math.sin(phi) + ly * Math.cos(phi);
          if ((rx / LEAF_LONG) ** 2 + (ry / LEAF_SHORT) ** 2 < 1) leaf = true;
        }
        if (stem || leaf) hits++;
      }
    }
    const cover = hits / (s * s);
    return [
      Math.round(GREEN[0] + (CREAM[0] - GREEN[0]) * cover),
      Math.round(GREEN[1] + (CREAM[1] - GREEN[1]) * cover),
      Math.round(GREEN[2] + (CREAM[2] - GREEN[2]) * cover),
      255,
    ];
  };
}

/**
 * Regenerates the PWA icons. No image library is installed and none is worth
 * adding for four flat marks, so the pixels are drawn here and PNG-encoded by
 * hand. Run with: node packages/web/scripts/generate-icons.mjs
 */
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
]) {
  writeFileSync(`packages/web/public/icons/${name}`, png(size, seedling(maskable)));
}
console.log('regenerated');
