"use strict";

(() => {
  const { WIDTH, HEIGHT, PIXELS, decodeFrame, statistics, pixelAt } = ThermalFrame;
  const byId = (id) => document.getElementById(id);
  const canvas = byId("image"), context = canvas.getContext("2d");
  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = WIDTH; rawCanvas.height = HEIGHT;
  const rawContext = rawCanvas.getContext("2d"), image = rawContext.createImageData(WIDTH, HEIGHT);
  const status = byId("status"), range = byId("range"), palette = byId("palette");
  const lower = byId("lower"), upper = byId("upper"), smooth = byId("smooth");
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

  function setStatus(message, state) {
    if (status.textContent !== message) status.textContent = message;
    status.dataset.state = state;
  }
  function invalidate(message) {
    stale = true;
    canvas.dataset.stale = "true";
    for (const id of ["minimum", "maximum", "center"]) byId(id).textContent = "—";
    byId("picked").textContent = "選択点：—";
    byId("ambient").textContent = "Ta：—";
    byId("fps").textContent = "0 fps";
    setStatus(message, "error");
  }
  function draw() {
    if (!frame) return;
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
    context.drawImage(rawCanvas, 0, 0, canvas.width, canvas.height);
    const x = (picked % WIDTH + .5) / WIDTH * canvas.width;
    const y = (Math.floor(picked / WIDTH) + .5) / HEIGHT * canvas.height;
    context.beginPath(); context.moveTo(x - 9, y); context.lineTo(x + 9, y);
    context.moveTo(x, y - 9); context.lineTo(x, y + 9);
    context.strokeStyle = "#10131a"; context.lineWidth = 4; context.stroke();
    context.strokeStyle = "#fff"; context.lineWidth = 2; context.stroke();
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
  palette.addEventListener("change", () => {
    byId("gradient").style.background = palette.value === "gray" ? "linear-gradient(90deg, #000, #fff)" : "";
    draw();
  });
  canvas.addEventListener("click", (event) => {
    if (stale) return;
    const rect = canvas.getBoundingClientRect();
    picked = pixelAt(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
    draw();
  });
  canvas.addEventListener("keydown", (event) => {
    if (stale || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const x = picked % WIDTH, y = Math.floor(picked / WIDTH);
    const dx = (event.key === "ArrowRight") - (event.key === "ArrowLeft");
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
    if (document.hidden) disconnect(); else connect();
  });
  window.addEventListener("pagehide", disconnect);
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
