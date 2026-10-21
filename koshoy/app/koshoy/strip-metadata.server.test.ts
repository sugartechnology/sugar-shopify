import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { decodeGreyPng } from "./png.server";
import { stripImageMetadata } from "./strip-metadata.server";

/**
 * 8×8 JPEG written by Pillow, then given the blocks a generated image
 * carries: APP11 (C2PA / JUMBF), APP13 (Photoshop) and APP1 (EXIF, Make "Google").
 */
const JPEG_WITH_METADATA =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/6wAlSlAAAWMycGEgR29vZ2xlIEMyUEEgTWVkaWEgU2VydmljZXP/7QAWUGhvdG9zaG9wIDMuMABHb29nbGX/4QAqRXhpZgAATU0AKgAAAAgAAQEPAAIAAAAHAAAAGgAAAABHb29nbGUAAP/bAEMAAwICAwICAwMDAwQDAwQFCAUFBAQFCgcHBggMCgwMCwoLCw0OEhANDhEOCwsQFhARExQVFRUMDxcYFhQYEhQVFP/bAEMBAwQEBQQFCQUFCRQNCw0UFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFP/AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/ANOiiiv5yP30/9k=";

/** Segment markers up to the start of scan (SOS). */
function jpegMarkers(bytes: Uint8Array): number[] {
  const markers: number[] = [];
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1];
    markers.push(marker);
    if (marker === 0xda) break;
    at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
  }
  return markers;
}

function startOfScan(bytes: Uint8Array): Buffer {
  const buffer = Buffer.from(bytes);
  return buffer.subarray(buffer.indexOf(Buffer.from([0xff, 0xda])));
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** 4×2 grey PNG with the text and provenance chunks a generator writes. */
function pngWithMetadata(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  const rows = Buffer.from([0, 10, 20, 30, 40, 0, 50, 60, 70, 80]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.from("Software\0Google Generative AI")),
    chunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>Google</x:xmpmeta>")),
    chunk("caBX", Buffer.from("jumb c2pa Google C2PA Media Services")),
    chunk("IDAT", deflateSync(rows)),
    chunk("eXIf", Buffer.from("MM\0*Google")),
    chunk("IEND", new Uint8Array()),
  ]);
}

describe("koshoy render metadata", () => {
  it("drops the JPEG metadata blocks and copies the compressed pixels as they are", () => {
    const original = Buffer.from(JPEG_WITH_METADATA, "base64");
    // A comment (COM) as well, right after the JFIF header.
    const text = Buffer.from("Created by Google Generative AI");
    const comment = Buffer.concat([Buffer.from([0xff, 0xfe, 0, text.length + 2]), text]);
    const input = Buffer.concat([original.subarray(0, 20), comment, original.subarray(20)]);
    assert.deepEqual(jpegMarkers(input).slice(0, 5), [0xe0, 0xfe, 0xeb, 0xed, 0xe1]);

    const stripped = stripImageMetadata(input);
    assert.ok(!/google|c2pa|photoshop|exif/i.test(Buffer.from(stripped).toString("latin1")));
    assert.ok(jpegMarkers(stripped).every((marker) => ![0xe1, 0xeb, 0xed, 0xfe].includes(marker)));
    assert.deepEqual(jpegMarkers(stripped).slice(0, 2), [0xe0, 0xdb], "JFIF and the tables stay");
    assert.deepEqual(startOfScan(stripped), startOfScan(input), "pixels untouched");
  });

  it("drops PNG text and provenance chunks and keeps the image", () => {
    const input = pngWithMetadata();
    const stripped = stripImageMetadata(input);
    assert.ok(!/google|c2pa|xmp/i.test(Buffer.from(stripped).toString("latin1")));
    assert.deepEqual([...decodeGreyPng(stripped)!.values], [...decodeGreyPng(input)!.values]);
  });

  it("leaves anything else alone", () => {
    const webp = Buffer.from("RIFF\0\0\0\0WEBPVP8 ");
    assert.equal(stripImageMetadata(webp), webp);
    const broken = Buffer.from([0xff, 0xd8, 0x00, 0x01, 0x02]);
    assert.deepEqual(stripImageMetadata(broken), broken);
    const shortPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6]);
    assert.deepEqual(stripImageMetadata(shortPng), shortPng, "no IEND: nothing is cut off");
  });
});
