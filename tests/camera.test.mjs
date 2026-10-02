import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

function environment(getUserMedia, secure = true, play = async () => {}) {
  const states = [], errors = [];
  const video = { srcObject: null, pause() {}, play };
  const context = vm.createContext({ isSecureContext: secure, navigator: { mediaDevices: { getUserMedia } } });
  vm.runInContext(readFileSync(new URL("../web/camera.js", import.meta.url), "utf8"), context);
  const camera = context.ThermalCamera.create({ video, onState: (state) => states.push(state), onError: (message) => errors.push(message) });
  return { camera, video, states, errors };
}
function stream() {
  const track = { stops: 0, stop() { this.stops++; }, onended: null };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

test("HTTP cannot request camera permission", async () => {
  let requests = 0;
  const { camera, errors } = environment(() => { requests++; }, false);
  await camera.start();
  assert.equal(requests, 0);
  assert.equal(camera.state, "idle");
  assert.match(errors[0], /HTTPS/);
});

test("rear video is requested without audio and stop releases the stream", async () => {
  const acquired = stream();
  let constraints;
  const { camera, video } = environment(async (value) => { constraints = value; return acquired; });
  await camera.start();
  assert.equal(constraints.audio, false);
  assert.equal(constraints.video.facingMode.ideal, "environment");
  assert.equal(camera.state, "active");
  assert.equal(video.srcObject, acquired);
  camera.stop();
  assert.equal(acquired.track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(camera.state, "idle");
});

test("a delayed permission response cannot restart a cancelled camera", async () => {
  let allow;
  const acquired = stream();
  const { camera, video } = environment(() => new Promise((resolve) => { allow = resolve; }));
  const starting = camera.start();
  assert.equal(camera.state, "pending");
  camera.stop();
  allow(acquired);
  await starting;
  assert.equal(acquired.track.stops, 1);
  assert.equal(camera.state, "idle");
  assert.equal(video.srcObject, null);
});

test("denial and playback failure leave no active camera", async () => {
  const denied = environment(async () => { throw Object.assign(new Error(), { name: "NotAllowedError" }); });
  await denied.camera.start();
  assert.equal(denied.camera.state, "idle");
  assert.match(denied.errors[0], /許可/);
  const acquired = stream();
  const failed = environment(async () => acquired, true, async () => { throw new Error("playback failed"); });
  await failed.camera.start();
  assert.equal(acquired.track.stops, 1);
  assert.equal(failed.video.srcObject, null);
  assert.match(failed.errors[0], /playback failed/);
});

test("track termination resets camera state and releases every track", async () => {
  const acquired = stream();
  const { camera, video, errors } = environment(async () => acquired);
  await camera.start();
  acquired.track.onended();
  assert.equal(camera.state, "idle");
  assert.equal(video.srcObject, null);
  assert.equal(acquired.track.stops, 1);
  assert.match(errors[0], /停止/);
});
