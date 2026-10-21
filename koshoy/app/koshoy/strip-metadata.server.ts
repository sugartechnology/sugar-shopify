/**
 * Removes metadata from a render result before it is stored (CONTRACT
 * v2.2-3): the image provider writes its name into the file (C2PA "Created
 * by … Generative AI", XMP, EXIF). Only whole metadata blocks are dropped;
 * the compressed pixels are copied as they are, never re-encoded.
 *
 * JPEG: APP1 (EXIF / XMP), APP11 (JUMBF / C2PA), APP13 (Photoshop / IPTC)
 * and COM segments. PNG: caBX (C2PA), iTXt, tEXt, zTXt and eXIf chunks.
 * Anything else, or a file that cannot be read, comes back unchanged.
 */

const JPEG_DROPPED_MARKERS = new Set([0xe1, 0xeb, 0xed, 0xfe]); // APP1, APP11, APP13, COM
const PNG_DROPPED_CHUNKS = new Set(["caBX", "iTXt", "tEXt", "zTXt", "eXIf"]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * JPEG: walks the segments up to the start of scan (SOS); from there on the
 * file is compressed pixels and is copied untouched.
 */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return bytes; // not a segment: leave the file alone
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xda) {
      kept.push(bytes.subarray(at)); // SOS and everything after it
      return concat(kept);
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) return bytes;
    if (!JPEG_DROPPED_MARKERS.has(marker)) kept.push(bytes.subarray(at, end));
    at = end;
  }
  return bytes;
}

/** PNG: keeps every chunk except the text and provenance ones; a file without a clean IEND is left alone. */
function stripPng(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (end > bytes.length) return bytes;
    if (!PNG_DROPPED_CHUNKS.has(type)) kept.push(bytes.subarray(at, end));
    if (type === "IEND") return concat(kept);
    at = end;
  }
  return bytes;
}

export function stripImageMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return stripJpeg(bytes);
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return stripPng(bytes);
  return bytes;
}
