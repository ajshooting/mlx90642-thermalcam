"use strict";

(() => {
  const { WIDTH, HEIGHT, PIXELS, decodeFrame, statistics, pixelAt } = ThermalFrame;
  const byId = (id) => document.getElementById(id);
  const canvas = byId("image"), context = canvas.getContext("2d");
  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = WIDTH; rawCanvas.height = HEIGHT;
  const rawContext = rawCanvas.getContext("2d"), image = rawContext.createImageData(WIDTH, HEIGHT);
  const status = byId("status"), range = byId("range"), palette = byId("palette");
  const lower = byId("lower"), upper = byId("upper"), smooth = byId("smooth"), mirrorX = byId("mirror-x");
  const temperature = (value) => `${value.toFixed(1)} °C`;
  const stops = [[11, 10, 48], [114, 32, 112], [204, 59, 66], [244, 155, 57], [255, 244, 191]];
  const colors = Array.from({ length: 256 }, (_, i) => {
    const position = i / 255 * (stops.length - 1), a = Math.min(stops.length - 2, Math.floor(position));
    return stops[a].map((channel, c) => Math.round(channel + (stops[a + 1][c] - channel) * (position - a)));
  });
  let socket = null, generation = 0, reconnectTimer = null, connectTimer = null, backoff = 500;
  let frame = null, picked = Math.floor(HEIGHT / 2) * WIDTH + Math.floor(WIDTH / 2);
  let lastSequence = null, lastFrameAt = 0, lastActivityAt = 0, sensor = "waiting", stale = true;
  let fpsStart = 0, fpsFrames = 0, manualRange = [20, 45];

  const stage = byId("viewer-stage"), cameraVideo = byId("camera-video");
  const thermalWindow = byId("thermal-window"), edgeCanvas = byId("edges");
  const edgeContext = edgeCanvas.getContext("2d"), edgeImage = edgeContext.createImageData(160, 120);
  const samplingCanvas = document.createElement("canvas");
  samplingCanvas.width = 160; samplingCanvas.height = 120;
  const samplingContext = samplingCanvas.getContext("2d", { willReadFrequently: true });
  const cameraButton = byId("camera-toggle"), cameraStatus = byId("camera-status");
  const STORAGE_KEY = "thermalcam.display.v1";
  let displaySettings;
  try { displaySettings = ThermalFusion.restoreSettings(localStorage.getItem(STORAGE_KEY)); }
  catch { displaySettings = ThermalFusion.defaults(); }
  let geometry = null, edgeAnimation = null, lastEdgeAt = -Infinity, geometryKey = "";
  const corners = { "top-right": [100, 0], "top-left": [0, 0], "bottom-right": [100, 100], "bottom-left": [0, 100] };
  function saveDisplaySettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(displaySettings)); } catch { /* Private browsing/storage limits must not stop the viewer. */ }
  }
  function syncDisplayControls() {
    const mode = displaySettings.mode, view = displaySettings.views[mode];
    byId("view-mode").value = mode;
    mirrorX.checked = displaySettings.mirrorX;
    byId("opacity").value = String(view.opacity); byId("overlay-size").value = String(view.size);
    byId("overlay-x").value = String(view.x); byId("overlay-y").value = String(view.y);
    byId("edge-strength").value = String(displaySettings.strength);
    byId("edge-sensitivity").value = String(displaySettings.sensitivity);
    byId("pip-position").value = Object.entries(corners).find(([, [x, y]]) => x === view.x && y === view.y)?.[0] || "custom";
    byId("pip-position-control").hidden = mode !== "pip";
    byId("edge-controls").hidden = mode !== "edges";
    byId("mode-hint").textContent = {
      pip: "小窓は独立した熱画像です。カメラの同じ位置を示すものではありません。",
      overlay: "カメラと熱画像の位置を手動で合わせます。",
      edges: "カメラの輪郭を熱画像に足します。位置を合わせて使ってください。"
    }[mode];
  }
  function stopEdges() {
    if (edgeAnimation !== null) cancelAnimationFrame(edgeAnimation);
    edgeAnimation = null;
    edgeCanvas.hidden = true;
    edgeContext.clearRect(0, 0, 160, 120);
    lastEdgeAt = -Infinity;
  }
  function canDrawEdges() {
    return camera.state === "active" && displaySettings.mode === "edges" && !stale && !document.hidden && displaySettings.strength > 0;
  }
  function edgeTick(now) {
    edgeAnimation = null;
    if (!canDrawEdges()) { stopEdges(); return; }
    // Only sample a small image at up to 8 Hz; camera playback remains native.
    if (now - lastEdgeAt >= 125 && geometry && cameraVideo.readyState >= 2) {
      try {
        const crop = ThermalFusion.videoCrop(geometry.rect, geometry.width, geometry.height, cameraVideo.videoWidth, cameraVideo.videoHeight);
        samplingContext.drawImage(cameraVideo, crop.x, crop.y, crop.width, crop.height, 0, 0, 160, 120);
        const rgba = samplingContext.getImageData(0, 0, 160, 120).data;
        edgeImage.data.set(ThermalFusion.edgePixels(rgba, 160, 120, displaySettings.sensitivity, displaySettings.strength));
        edgeContext.putImageData(edgeImage, 0, 0);
        edgeCanvas.hidden = false;
        lastEdgeAt = now;
      } catch {
        displaySettings.mode = "overlay"; syncDisplayControls(); updateOverlay();
        cameraStatus.textContent = "輪郭を生成できないため、重ね合わせ表示に切り替えました。";
        return;
      }
    }
    edgeAnimation = requestAnimationFrame(edgeTick);
  }
  function updateEdges() {
    if (!canDrawEdges()) stopEdges();
    else if (edgeAnimation === null) edgeAnimation = requestAnimationFrame(edgeTick);
  }
  function updateOverlay() {
    const active = camera.state === "active", mode = displaySettings.mode, view = displaySettings.views[mode];
    const aspect = active && cameraVideo.videoWidth && cameraVideo.videoHeight ? `${cameraVideo.videoWidth} / ${cameraVideo.videoHeight}` : "4 / 3";
    if (stage.style.aspectRatio !== aspect) stage.style.aspectRatio = aspect;
    const bounds = stage.getBoundingClientRect();
    const rect = active ? ThermalFusion.windowRect(bounds.width, bounds.height, view.size, view.x, view.y, mode === "pip" ? 8 : 0) :
      { left: 0, top: 0, width: bounds.width, height: bounds.height };
    geometry = { rect, width: bounds.width, height: bounds.height };
    const key = [active, mode, bounds.width, bounds.height, view.size, view.x, view.y, displaySettings.strength, displaySettings.sensitivity].join(":");
    if (geometryKey !== key) { stopEdges(); geometryKey = key; }
    thermalWindow.dataset.mode = active ? mode : "thermal";
    thermalWindow.style.left = `${rect.left}px`; thermalWindow.style.top = `${rect.top}px`;
    thermalWindow.style.width = `${rect.width}px`; thermalWindow.style.height = `${rect.height}px`;
    thermalWindow.style.setProperty("--thermal-opacity", active ? view.opacity / 100 : 1);
    byId("pip-label").hidden = !active || mode !== "pip";
    byId("opacity-value").value = `${view.opacity}%`; byId("overlay-size-value").value = `${view.size}%`;
    byId("edge-strength-value").value = `${displaySettings.strength}%`; byId("edge-sensitivity-value").value = `${displaySettings.sensitivity}%`;
    byId("image-hint").textContent = active && mode === "pip" ? "小窓の熱画像をタップすると、その位置の温度を表示します。" : "熱画像をタップすると、その位置の温度を表示します。";
    updateEdges();
  }
  const camera = ThermalCamera.create({ video: cameraVideo,
    onState(state) {
      cameraVideo.hidden = state !== "active";
      byId("camera-controls").hidden = state !== "active";
      cameraButton.textContent = state === "active" ? "カメラを止める" : state === "pending" ? "カメラの開始をキャンセル" : "背面カメラを使う";
      cameraStatus.textContent = state === "active" ? "カメラを表示しています。" : state === "pending" ? "カメラの許可を待っています…" : "カメラは停止しています。";
      updateOverlay();
    },
    onError(message) { cameraStatus.textContent = message; }
  });
  syncDisplayControls();
  updateOverlay();
  byId("camera-setup").hidden = globalThis.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
  cameraButton.addEventListener("click", () => { if (camera.state === "idle") camera.start(); else camera.stop(); });
  byId("view-mode").addEventListener("change", () => {
    displaySettings.mode = byId("view-mode").value;
    syncDisplayControls(); updateOverlay(); saveDisplaySettings();
  });
  for (const [id, key] of [["opacity", "opacity"], ["overlay-size", "size"], ["overlay-x", "x"], ["overlay-y", "y"]]) byId(id).addEventListener("input", () => {
    displaySettings.views[displaySettings.mode][key] = byId(id).valueAsNumber;
    syncDisplayControls(); updateOverlay(); saveDisplaySettings();
  });
  for (const [id, key] of [["edge-strength", "strength"], ["edge-sensitivity", "sensitivity"]]) byId(id).addEventListener("input", () => {
    displaySettings[key] = byId(id).valueAsNumber;
    updateOverlay(); saveDisplaySettings();
  });
  byId("pip-position").addEventListener("change", () => {
    const position = corners[byId("pip-position").value];
    if (!position) return;
    [displaySettings.views.pip.x, displaySettings.views.pip.y] = position;
    syncDisplayControls(); updateOverlay(); saveDisplaySettings();
  });
  byId("overlay-reset").addEventListener("click", () => {
    displaySettings.views[displaySettings.mode] = ThermalFusion.defaults().views[displaySettings.mode];
    if (displaySettings.mode === "edges") { displaySettings.strength = 70; displaySettings.sensitivity = 65; }
    syncDisplayControls(); updateOverlay(); saveDisplaySettings();
  });
  cameraVideo.addEventListener("resize", updateOverlay);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(updateOverlay).observe(stage);
  else window.addEventListener("resize", updateOverlay);

  function setStatus(message, state) {
    if (status.textContent !== message) status.textContent = message;
    status.dataset.state = state;
  }
  function invalidate(message) {
    stale = true;
    canvas.dataset.stale = "true";
    updateEdges();
    for (const id of ["minimum", "maximum", "center"]) byId(id).textContent = "—";
    byId("picked").textContent = "選択点：—";
    byId("ambient").textContent = "Ta：—";
    byId("fps").textContent = "0 fps";
    setStatus(message, "error");
  }
  function draw() {
    if (!frame) return;
    updateEdges();
    const stats = statistics(frame.pixels);
    let min, max;
    if (range.value === "fixed") [min, max] = manualRange;
    else {
      min = stats.min; max = stats.max;
      if (max - min < 1) { const midpoint = (min + max) / 2; min = midpoint - .5; max = midpoint + .5; }
    }
    for (let i = 0; i < PIXELS; i++) {
      const colorIndex = Math.round(Math.max(0, Math.min(1, (frame.pixels[i] - min) / (max - min))) * 255);
      const color = palette.value === "gray" ? [colorIndex, colorIndex, colorIndex] : colors[colorIndex];
      image.data.set([...color, 255], i * 4);
    }
    rawContext.putImageData(image, 0, 0);
    context.imageSmoothingEnabled = smooth.checked;
    context.imageSmoothingQuality = "high";
    // Reflect only the thermal image and its marker; camera/edges stay in camera coordinates.
    context.save();
    if (displaySettings.mirrorX) { context.translate(canvas.width, 0); context.scale(-1, 1); }
    context.drawImage(rawCanvas, 0, 0, canvas.width, canvas.height);
    const x = (picked % WIDTH + .5) / WIDTH * canvas.width;
    const y = (Math.floor(picked / WIDTH) + .5) / HEIGHT * canvas.height;
    context.beginPath(); context.moveTo(x - 9, y); context.lineTo(x + 9, y);
    context.moveTo(x, y - 9); context.lineTo(x, y + 9);
    context.strokeStyle = "#10131a"; context.lineWidth = 4; context.stroke();
    context.strokeStyle = "#fff"; context.lineWidth = 2; context.stroke();
    context.restore();
    byId("scale-min").textContent = temperature(min); byId("scale-max").textContent = temperature(max);
    if (!stale) {
      byId("minimum").textContent = temperature(stats.min);
      byId("maximum").textContent = temperature(stats.max);
      byId("center").textContent = temperature(stats.center);
      byId("ambient").textContent = `Ta：${temperature(frame.ta)}`;
      byId("picked").textContent = `選択点 (${picked % WIDTH}, ${Math.floor(picked / WIDTH)})：${temperature(frame.pixels[picked])}`;
    }
  }
  function validateRange() {
    const valid = lower.validity.valid && upper.validity.valid && lower.valueAsNumber < upper.valueAsNumber;
    const invalid = range.value === "fixed" && !valid;
    byId("fixed-range").hidden = range.value !== "fixed";
    byId("range-error").hidden = !invalid;
    byId("range-error").textContent = invalid ? "−40〜260 °Cで、下限を上限より小さくしてください。直前の範囲を表示しています。" : "";
    lower.setAttribute("aria-invalid", String(invalid)); upper.setAttribute("aria-invalid", String(invalid));
    if (valid) manualRange = [lower.valueAsNumber, upper.valueAsNumber];
    draw();
  }
  for (const control of [range, lower, upper]) control.addEventListener("change", validateRange);
  for (const control of [lower, upper]) control.addEventListener("input", validateRange);
  smooth.addEventListener("change", draw);
  mirrorX.addEventListener("change", () => {
    displaySettings.mirrorX = mirrorX.checked;
    draw(); saveDisplaySettings();
  });
  palette.addEventListener("change", () => {
    byId("gradient").style.background = palette.value === "gray" ? "linear-gradient(90deg, #000, #fff)" : "";
    draw();
  });
  canvas.addEventListener("click", (event) => {
    if (stale) return;
    const rect = canvas.getBoundingClientRect();
    picked = pixelAt(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, displaySettings.mirrorX);
    draw();
  });
  canvas.addEventListener("keydown", (event) => {
    if (stale || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const x = picked % WIDTH, y = Math.floor(picked / WIDTH);
    const dx = ((event.key === "ArrowRight") - (event.key === "ArrowLeft")) * (displaySettings.mirrorX ? -1 : 1);
    const dy = (event.key === "ArrowDown") - (event.key === "ArrowUp");
    picked = Math.max(0, Math.min(HEIGHT - 1, y + dy)) * WIDTH + Math.max(0, Math.min(WIDTH - 1, x + dx));
    draw();
  });

  function disconnect() {
    generation++;
    clearTimeout(reconnectTimer); clearTimeout(connectTimer);
    if (socket) { socket.onclose = null; socket.close(); socket = null; }
  }
  function connect() {
    disconnect();
    if (document.hidden) return;
    const attempt = generation;
    lastSequence = null; fpsStart = 0; fpsFrames = 0; lastFrameAt = 0; sensor = "waiting";
    lastActivityAt = performance.now();
    invalidate("接続しています…");
    let connection;
    try { connection = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`); }
    catch { setStatus("接続できません。ThermalCamのWi-Fiに接続してください。", "error"); return; }
    socket = connection;
    connection.binaryType = "arraybuffer";
    connectTimer = setTimeout(() => { if (attempt === generation) connection.close(); }, 8000);
    connection.onopen = () => {
      if (attempt !== generation) return;
      clearTimeout(connectTimer);
      backoff = 500; lastActivityAt = performance.now();
      setStatus("接続済み · センサのデータを待っています", "waiting");
    };
    connection.onmessage = (event) => {
      if (attempt !== generation) return;
      lastActivityAt = performance.now();
      try {
        if (typeof event.data === "string") {
          const info = JSON.parse(event.data);
          if (info.type !== "status") return;
          sensor = info.sensor;
          byId("demo").hidden = info.demo !== true;
          if (sensor === "read_error") invalidate("センサを読み取れません。電源・SDA・SCLの接続を確認してください。");
          else if (sensor === "config_error") invalidate("センサが連続温度測定モードになっていません。");
          return;
        }
        const next = decodeFrame(event.data);
        if (next.sequence === lastSequence) return;
        lastSequence = next.sequence; frame = next; lastFrameAt = performance.now(); sensor = "ok";
        stale = false; canvas.dataset.stale = "false";
        setStatus("接続済み · ライブ表示", "live");
        if (!fpsStart) fpsStart = lastFrameAt;
        else fpsFrames++;
        if (lastFrameAt - fpsStart >= 1000) {
          byId("fps").textContent = `${(fpsFrames * 1000 / (lastFrameAt - fpsStart)).toFixed(1)} fps`;
          fpsStart = lastFrameAt; fpsFrames = 0;
        }
        draw();
      } catch (error) { invalidate(`受信エラー：${error.message}`); }
    };
    connection.onerror = () => {
      if (attempt === generation) setStatus("接続できません。給電とThermalCamのWi-Fi接続を確認してください。", "error");
    };
    connection.onclose = () => {
      if (attempt !== generation) return;
      clearTimeout(connectTimer); socket = null;
      invalidate("接続が切れました。自動で再接続します。");
      reconnectTimer = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 5000);
    };
  }
  byId("reconnect").addEventListener("click", connect);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { disconnect(); camera.stop(); } else connect();
  });
  window.addEventListener("pagehide", () => { disconnect(); camera.stop(); });
  window.addEventListener("pageshow", () => { if (!socket && !document.hidden) connect(); });
  setInterval(() => {
    if (document.hidden || !socket || socket.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (now - lastActivityAt > 5000) { socket.close(); return; }
    if (now - lastFrameAt > 3000 && sensor !== "read_error" && sensor !== "config_error")
      invalidate("センサの更新を待っています。画像は最後に受信したフレームです。");
  }, 1000);
  validateRange();
  connect();
})();
