import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { decodeGreyPng } from "./png.server";

/** Written by another encoder (Pillow): 6×4 8 bit and 5×3 16 bit grey. */
const PILLOW_8 =
  "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAAAAACIbxGfAAAAF0lEQVR4nGNk0NDQ0NBg4uXl5eXlRaUAHOUBuoTOVR8AAAAASUVORK5CYII=";
const PILLOW_8_VALUES = Array.from({ length: 24 }, (_, i) => ((i % 6) * 40 + Math.floor(i / 6) * 13) % 256);
const PILLOW_16 =
  "iVBORw0KGgoAAAANSUhEUgAAAAUAAAADEAAAAAAuzUZnAAAAFUlEQVR4nGNkYDCwhEAmZk4YRGICADD2AiLhFf5sAAAAAElFTkSuQmCC";
const PILLOW_16_VALUES = Array.from({ length: 15 }, (_, i) => ((i % 5) * 12345 + Math.floor(i / 5) * 777) % 65536);

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** 8 bit grey PNG whose row r uses PNG filter r % 5, so every filter is read back. */
function pngWithEveryFilter(width: number, height: number, value: (x: number, y: number) => number): Buffer {
  const rows: number[] = [];
  const pixel = (x: number, y: number) => (x < 0 || y < 0 ? 0 : value(x, y));
  for (let y = 0; y < height; y += 1) {
    const filter = y % 5;
    rows.push(filter);
    for (let x = 0; x < width; x += 1) {
      const left = pixel(x - 1, y);
      const up = pixel(x, y - 1);
      const upLeft = pixel(x - 1, y - 1);
      const p = left + up - upLeft;
      const paeth =
        Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft)
          ? left
          : Math.abs(p - up) <= Math.abs(p - upLeft)
            ? up
            : upLeft;
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter];
      rows.push((value(x, y) - predictor) & 0xff);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grey
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", new Uint8Array()),
  ]);
}

describe("koshoy grey PNG reader", () => {
  it("reads 8 and 16 bit grey PNGs written by another encoder", () => {
    const mask = decodeGreyPng(Buffer.from(PILLOW_8, "base64"));
    assert.equal(mask?.width, 6);
    assert.equal(mask?.height, 4);
    assert.deepEqual([...(mask?.values ?? [])], PILLOW_8_VALUES);
    const depth = decodeGreyPng(Buffer.from(PILLOW_16, "base64"));
    assert.deepEqual([depth?.width, depth?.height], [5, 3]);
    assert.deepEqual([...(depth?.values ?? [])], PILLOW_16_VALUES);
  });

  it("undoes every PNG row filter", () => {
    const value = (x: number, y: number) => (x * 37 + y * 91 + x * y * 5) % 256;
    const image = decodeGreyPng(pngWithEveryFilter(9, 10, value));
    assert.ok(image);
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 9; x += 1) assert.equal(image.values[y * 9 + x], value(x, y), `${x},${y}`);
    }
  });

  it("refuses what it does not read", () => {
    assert.equal(decodeGreyPng(new Uint8Array([1, 2, 3])), null);
    const rgb = Buffer.from(PILLOW_8, "base64");
    rgb[25] = 2; // colour type RGB (the CRC is not checked, the type is)
    assert.equal(decodeGreyPng(rgb), null);
  });
});
