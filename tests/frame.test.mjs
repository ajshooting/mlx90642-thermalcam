import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { after, test } from "node:test";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../web/frame.js", import.meta.url), "utf8"), context);
const { decodeFrame, statistics, pixelAt } = context.ThermalFrame;
const directory = mkdtempSync(join(tmpdir(), "thermalcam-frame-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const executable = join(directory, "fixture");
const compile = spawnSync("clang++", ["-std=c++17", "-Wall", "-Wextra", "-Werror",
  fileURLToPath(new URL("./frame_fixture.cpp", import.meta.url)), "-o", executable]);
assert.equal(compile.status, 0, compile.stderr.toString());
const fixture = spawnSync(executable);
assert.equal(fixture.status, 0);
const bytes = Uint8Array.from(fixture.stdout);
const buffer = bytes.buffer;

// Use a packet emitted by the real C++ header, not a JavaScript encoder that
// could duplicate the same byte-offset or temperature-scale mistake.
test("C++ wire packet decodes with signed temperatures and little-endian header", () => {
  assert.equal(bytes.length, 1556);
  const frame = decodeFrame(buffer);
  assert.equal(frame.sequence, 0x01020304);
  assert.equal(frame.capturedAtMs, 0xf1020304);
  assert.equal(frame.ta, -5.25);
  assert.equal(frame.pixels.length, 768);
  assert.equal(frame.pixels[0], -40);
  assert.equal(frame.pixels[767], 260);
  assert.ok(Math.abs(frame.pixels[400] - 42.02) < .00001);
});

test("raw statistics retain corner hot/cold pixels and the Python viewer's center", () => {
  const stats = statistics(decodeFrame(buffer).pixels);
  assert.equal(stats.min, -40); assert.equal(stats.minIndex, 0);
  assert.equal(stats.max, 260); assert.equal(stats.maxIndex, 767);
  assert.ok(Math.abs(stats.center - 42.02) < .00001);
});

test("invalid packets cannot replace measured temperatures", () => {
  assert.throws(() => decodeFrame(buffer.slice(0, 100)), /フレーム長/);
  for (const offset of [0, 4, 6, 18]) {
    const invalid = buffer.slice(0);
    new Uint8Array(invalid)[offset] ^= 1;
    assert.throws(() => decodeFrame(invalid), /フレーム形式/);
  }
});

test("phone and resized desktop coordinates select the same raw pixel", () => {
  assert.equal(pixelAt(179.75, 134.8, 359.5, 269.6), 400);
  assert.equal(pixelAt(320, 240, 640, 480), 400);
  assert.equal(pixelAt(-1, -1, 359.5, 269.6), 0);
  assert.equal(pixelAt(359.5, 269.6, 359.5, 269.6), 767);
});

test("mirrored taps select the measured pixel shown at that position", () => {
  const frame = decodeFrame(buffer);
  assert.equal(frame.pixels[pixelAt(639, 0, 640, 480, true)], -40);
  assert.equal(frame.pixels[pixelAt(0, 479, 640, 480, true)], 260);
  for (const [width, height] of [[640, 480], [359.5, 269.6]]) {
    // Include exact pixel boundaries and points outside the image.
    for (const x of [-1, 0, width / 4, width / 2, width]) {
      for (const y of [-1, 0, height / 2, height]) {
        const normal = pixelAt(x, y, width, height);
        const mirrored = pixelAt(x, y, width, height, true);
        assert.equal(Math.floor(mirrored / 32), Math.floor(normal / 32));
        assert.equal(mirrored % 32, 31 - normal % 32);
      }
    }
  }
});
