"use strict";

// The firmware and the browser share the THM1 binary frame format.
(() => {
  const WIDTH = 32, HEIGHT = 24, PIXELS = WIDTH * HEIGHT, HEADER_BYTES = 20;
  function decodeFrame(buffer) {
    if (buffer.byteLength !== HEADER_BYTES + PIXELS * 2) throw new Error("フレーム長が一致しません");
    const data = new DataView(buffer);
    if ([84, 72, 77, 49].some((value, i) => data.getUint8(i) !== value) ||
        data.getUint16(4, true) !== WIDTH || data.getUint16(6, true) !== HEIGHT ||
        data.getUint16(18, true) !== 0) throw new Error("未対応のフレーム形式です");
    const pixels = new Float32Array(PIXELS);
    for (let i = 0; i < PIXELS; i++) pixels[i] = data.getInt16(HEADER_BYTES + i * 2, true) / 50;
    return { sequence: data.getUint32(8, true), capturedAtMs: data.getUint32(12, true),
      ta: data.getInt16(16, true) / 100, pixels };
  }
  function statistics(pixels) {
    let minIndex = 0, maxIndex = 0;
    for (let i = 1; i < PIXELS; i++) {
      if (pixels[i] < pixels[minIndex]) minIndex = i;
      if (pixels[i] > pixels[maxIndex]) maxIndex = i;
    }
    return { min: pixels[minIndex], max: pixels[maxIndex], minIndex, maxIndex,
      center: pixels[Math.floor(HEIGHT / 2) * WIDTH + Math.floor(WIDTH / 2)] };
  }
  function pixelAt(x, y, width, height, mirrorX = false) {
    const column = Math.min(WIDTH - 1, Math.max(0, Math.floor(x / width * WIDTH)));
    return Math.min(HEIGHT - 1, Math.max(0, Math.floor(y / height * HEIGHT))) * WIDTH +
      (mirrorX ? WIDTH - 1 - column : column);
  }
  globalThis.ThermalFrame = Object.freeze({ WIDTH, HEIGHT, PIXELS, decodeFrame, statistics, pixelAt });
})();
