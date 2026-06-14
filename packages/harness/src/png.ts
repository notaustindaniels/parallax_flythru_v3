// Minimal PNG decoder → grayscale (SPEC §8.3 "pure TS, no native deps"). Uses node:zlib
// (a Node builtin — no native addon, like the renderer test's node:crypto) to inflate
// IDAT; parses IHDR, unfilters scanlines, and converts to 8-bit luma. Supports the only
// shape Playwright emits for our screenshots: bit depth 8, colour type 2 (RGB) or 6
// (RGBA), no interlace. Anything else throws (caught by PIN #2's validation before the
// invariant-2 gate trusts it). Luma = 0.299R + 0.587G + 0.114B (rounded).

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export interface GrayImage {
  width: number;
  height: number;
  gray: Uint8Array; // row-major, width*height
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePngToGray(buf: Buffer): GrayImage {
  for (let i = 0; i < 8; i++)
    if (buf[i] !== PNG_SIG[i]) throw new Error('decodePng: not a PNG (bad signature)');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8]!;
      colorType = buf[dataStart + 9]!;
      interlace = buf[dataStart + 12]!;
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataStart + len));
    } else if (type === 'IEND') {
      break;
    }
    off = dataStart + len + 4; // skip data + CRC
  }

  if (bitDepth !== 8) throw new Error(`decodePng: unsupported bit depth ${bitDepth} (expected 8)`);
  if (interlace !== 0) throw new Error('decodePng: interlaced PNG unsupported');
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (channels === 0)
    throw new Error(`decodePng: unsupported colour type ${colorType} (expected 2 RGB or 6 RGBA)`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height)
    throw new Error('decodePng: inflated data too short for declared dimensions');

  // Unfilter into a contiguous RGB(A) buffer, then reduce to luma.
  const recon = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const inRow = y * (stride + 1) + 1;
    const outRow = y * stride;
    const prevRow = outRow - stride;
    for (let x = 0; x < stride; x++) {
      const f = raw[inRow + x]!;
      const a = x >= channels ? recon[outRow + x - channels]! : 0;
      const b = y > 0 ? recon[prevRow + x]! : 0;
      const c = x >= channels && y > 0 ? recon[prevRow + x - channels]! : 0;
      let v: number;
      switch (filter) {
        case 0: v = f; break;
        case 1: v = f + a; break;
        case 2: v = f + b; break;
        case 3: v = f + ((a + b) >> 1); break;
        case 4: v = f + paeth(a, b, c); break;
        default: throw new Error(`decodePng: bad filter type ${filter} at row ${y}`);
      }
      recon[outRow + x] = v & 0xff;
    }
  }

  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    gray[i] = Math.round(0.299 * recon[p]! + 0.587 * recon[p + 1]! + 0.114 * recon[p + 2]!);
  }
  return { width, height, gray };
}

export function loadGrayPng(path: string): GrayImage {
  return decodePngToGray(readFileSync(path));
}
