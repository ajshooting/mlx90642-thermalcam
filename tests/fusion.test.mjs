import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../web/fusion.js", import.meta.url), "utf8"), context);
const { defaults, restoreSettings, windowRect, videoCrop, edgePixels } = context.ThermalFusion;
function picture(width, height, valueAt) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, value = valueAt(x, y);
    rgba[i] = rgba[i + 1] = rgba[i + 2] = value; rgba[i + 3] = 255;
  }
  return rgba;
}
const maxAlpha = (pixels) => Math.max(...pixels.filter((_, i) => i % 4 === 3));

test("PiP retains every thermal pixel in portrait and widescreen camera views", () => {
  for (const [width, height] of [[358, 268.5], [358, 637], [640, 360]]) {
    for (const size of [15, 40, 100]) for (const x of [0, 50, 100]) for (const y of [0, 50, 100]) {
      const rect = windowRect(width, height, size, x, y, 8);
      assert.ok(Math.abs(rect.width / rect.height - 4 / 3) < .000001);
      assert.ok(rect.left >= 8 - .000001 && rect.top >= 8 - .000001);
      assert.ok(rect.left + rect.width <= width - 8 + .000001);
      assert.ok(rect.top + rect.height <= height - 8 + .000001);
    }
  }
});

test("edge sampling uses the camera region under the thermal window", () => {
  const rect = windowRect(640, 480, 50, 100, 0);
  const crop = videoCrop(rect, 640, 480, 1280, 960);
  assert.equal(crop.x, 640); assert.equal(crop.y, 0);
  assert.equal(crop.width, 640); assert.equal(crop.height, 480);
});

test("flat camera regions produce no outlines", () => {
  assert.equal(maxAlpha(edgePixels(picture(9, 9, () => 127), 9, 9, 100, 100)), 0);
});

test("both horizontal and vertical boundaries have outlines with a dark halo", () => {
  for (const valueAt of [(x) => x < 4 ? 0 : 255, (_x, y) => y < 4 ? 0 : 255]) {
    const input = picture(9, 9, valueAt), original = Uint8Array.from(input);
    const output = edgePixels(input, 9, 9, 65, 100);
    assert.equal(maxAlpha(output), 255);
    assert.ok(output.some((value, i) => i % 4 === 3 && value > 0 && output[i - 3] === 0));
    assert.deepEqual(Uint8Array.from(input), original);
  }
});

test("strength zero removes outlines, and sensitivity controls faint edges", () => {
  const input = picture(9, 9, (x) => x < 4 ? 100 : 140);
  assert.equal(maxAlpha(edgePixels(input, 9, 9, 100, 0)), 0);
  assert.equal(maxAlpha(edgePixels(input, 9, 9, 0, 100)), 0);
  assert.ok(maxAlpha(edgePixels(input, 9, 9, 100, 100)) > 0);
});

test("saved view settings are bounded and malformed data cannot replace defaults", () => {
  assert.equal(restoreSettings("not json").mode, "pip");
  assert.equal(restoreSettings('{"version":999}').mode, "pip");
  const restored = restoreSettings(JSON.stringify({ version: 1, mode: "edges", strength: 500,
    views: { pip: { size: -4, x: 200, y: "bad" }, edges: { size: 60, opacity: 80 } } }));
  assert.equal(restored.mode, "edges"); assert.equal(restored.strength, 100);
  assert.equal(restored.views.pip.size, 15); assert.equal(restored.views.pip.x, 100);
  assert.equal(restored.views.pip.y, 0); assert.equal(restored.views.edges.size, 60);
  const first = defaults(); first.views.pip.size = 99;
  assert.equal(defaults().views.pip.size, 40);
});
