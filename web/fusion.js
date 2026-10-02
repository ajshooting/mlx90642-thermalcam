"use strict";

// Geometry and ordinary Sobel image processing; no inference or dependencies.
(() => {
  const MODES = ["pip", "overlay", "edges"];
  const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
  function defaults() {
    return { version: 1, mode: "pip", mirrorX: false, strength: 70, sensitivity: 65, views: {
      pip: { size: 40, x: 100, y: 0, opacity: 100 },
      overlay: { size: 70, x: 50, y: 50, opacity: 55 },
      edges: { size: 70, x: 50, y: 50, opacity: 100 }
    } };
  }
  function restoreSettings(raw) {
    const result = defaults();
    let source;
    try { source = JSON.parse(raw); } catch { return result; }
    if (!source || source.version !== 1) return result;
    if (MODES.includes(source.mode)) result.mode = source.mode;
    if (typeof source.mirrorX === "boolean") result.mirrorX = source.mirrorX;
    for (const key of ["strength", "sensitivity"]) {
      if (Number.isFinite(source[key])) result[key] = clamp(source[key], 0, 100);
    }
    for (const mode of MODES) for (const key of ["size", "x", "y", "opacity"]) {
      const value = source.views?.[mode]?.[key];
      if (Number.isFinite(value)) result.views[mode][key] = clamp(value, key === "size" ? 15 : 0, 100);
    }
    return result;
  }
  // Position is a fraction of available travel, so the whole 4:3 thermal
  // window stays on screen even for portrait and widescreen camera streams.
  function windowRect(width, height, size, x, y, margin = 0) {
    const inset = Math.min(Math.max(0, margin), width / 4, height / 4);
    const innerWidth = width - 2 * inset, innerHeight = height - 2 * inset;
    const w = Math.min(innerWidth, innerHeight * 4 / 3) * clamp(size, 15, 100) / 100;
    const h = w * 3 / 4;
    return { left: inset + (innerWidth - w) * clamp(x, 0, 100) / 100,
      top: inset + (innerHeight - h) * clamp(y, 0, 100) / 100, width: w, height: h };
  }
  function videoCrop(rect, stageWidth, stageHeight, videoWidth, videoHeight) {
    return { x: rect.left / stageWidth * videoWidth, y: rect.top / stageHeight * videoHeight,
      width: rect.width / stageWidth * videoWidth, height: rect.height / stageHeight * videoHeight };
  }
  function edgePixels(rgba, width, height, sensitivity, strength) {
    const count = width * height, gray = new Float32Array(count), mask = new Uint8Array(count);
    const output = new Uint8ClampedArray(count * 4);
    if (strength <= 0) return output;
    const threshold = 120 - clamp(sensitivity, 0, 100) * 1.1;
    const opacity = clamp(strength, 0, 100) / 100;
    for (let i = 0; i < count; i++) gray[i] = .299 * rgba[i * 4] + .587 * rgba[i * 4 + 1] + .114 * rgba[i * 4 + 2];
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const a = gray[i - width - 1], b = gray[i - width], c = gray[i - width + 1];
      const d = gray[i - 1], f = gray[i + 1];
      const g = gray[i + width - 1], h = gray[i + width], j = gray[i + width + 1];
      const gx = -a + c - 2 * d + 2 * f - g + j;
      const gy = -a - 2 * b - c + g + 2 * h + j;
      const magnitude = Math.hypot(gx, gy) / 4;
      mask[i] = Math.round(clamp((magnitude - threshold) / (255 - threshold), 0, 1) * 255);
    }
    // Add a dark one-pixel halo so white edges remain visible on hot colors.
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x, offset = i * 4;
      if (mask[i]) {
        output[offset] = output[offset + 1] = output[offset + 2] = 255;
        output[offset + 3] = mask[i] * opacity;
      } else {
        let nearby = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nearby = Math.max(nearby, mask[i + dy * width + dx]);
        output[offset + 3] = nearby * opacity * .7;
      }
    }
    return output;
  }
  globalThis.ThermalFusion = Object.freeze({ defaults, restoreSettings, windowRect, videoCrop, edgePixels });
})();
