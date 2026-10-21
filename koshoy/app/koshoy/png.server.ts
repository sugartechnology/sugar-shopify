/**
 * Small PNG reader for the room analysis files: 8 bit grey masks (255 =
 * inside) and the 16 bit grey depth map, as the analysis writes them
 * (non-interlaced). Any other kind of PNG gives null; the measurements then
 * simply leave that value out.
 */
import { inflateSync } from "node:zlib";

/** One raw value per pixel, row by row from the top left: 0..255 or 0..65535. */
export interface GreyImage {
  width: number;
  height: number;
  values: Uint16Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Same ceiling as the analysis (30 megapixels) plus room. */
const MAX_PIXELS = 40_000_000;

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : upLeft;
}

/** Undoes the per-row PNG filters in place; `bpp` = bytes per pixel. */
function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array | null {
  const out = new Uint8Array(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const at = row * stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? out[at + i - bpp] : 0;
      const up = row > 0 ? out[at - stride + i] : 0;
      const upLeft = row > 0 && i >= bpp ? out[at - stride + i - bpp] : 0;
      let predictor: number;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) predictor = paeth(left, up, upLeft);
      else return null;
      out[at + i] = (line[i] + predictor) & 0xff;
    }
  }
  return out;
}

export function decodeGreyPng(bytes: Uint8Array): GreyImage | null {
  if (bytes.length < 8 || SIGNATURE.some((value, index) => bytes[index] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  const idat: Uint8Array[] = [];

  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (data.length !== length) return null;
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (colorType !== 0 || (bitDepth !== 8 && bitDepth !== 16) || interlace !== 0) return null;
      if (!width || !height || width * height > MAX_PIXELS) return null;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  if (!width || !idat.length) return null;

  const bpp = bitDepth / 8;
  const stride = width * bpp;
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  } catch {
    return null;
  }
  if (raw.length < height * (stride + 1)) return null;
  const pixels = unfilter(raw, height, stride, bpp);
  if (!pixels) return null;

  const values = new Uint16Array(width * height);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = bpp === 1 ? pixels[i] : (pixels[i * 2] << 8) | pixels[i * 2 + 1];
  }
  return { width, height, values };
}
