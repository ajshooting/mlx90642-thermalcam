"use strict";

// No frames leave the browser: this controller only attaches a local stream.
(() => {
  function create({ video, onState, onError }) {
    let stream = null, generation = 0, state = "idle";
    function update(next) { state = next; onState(next); }
    function stop() {
      generation++;
      if (stream) {
        for (const track of stream.getTracks()) {
          track.onended = null;
          track.stop();
        }
      }
      stream = null;
      video.pause(); video.srcObject = null;
      update("idle");
    }
    async function start() {
      stop();
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        onError("カメラには信頼済みのHTTPS接続が必要です。証明書設定後にHTTPS版を開いてください。");
        return;
      }
      const attempt = generation;
      update("pending");
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 },
          frameRate: { ideal: 30, max: 30 }
        } });
        if (attempt !== generation) { acquired.getTracks().forEach((track) => track.stop()); return; }
        stream = acquired;
        video.srcObject = acquired;
        await video.play();
        if (attempt !== generation) return;
        for (const track of acquired.getVideoTracks()) track.onended = () => {
          stop(); onError("カメラが停止しました。もう一度「背面カメラを使う」を押してください。");
        };
        update("active");
      } catch (error) {
        if (attempt !== generation) return;
        stop();
        const messages = {
          NotAllowedError: "カメラを許可してください。拒否した場合はSafariのこのサイトのカメラ設定を確認してください。",
          NotFoundError: "使用できるカメラが見つかりません。",
          NotReadableError: "カメラを開始できません。ほかのカメラアプリを閉じて試してください。",
          OverconstrainedError: "このカメラでは指定した映像を取得できません。"
        };
        onError(messages[error.name] || `カメラを開始できません：${error.message}`);
      }
    }
    return { start, stop, get state() { return state; } };
  }
  globalThis.ThermalCamera = Object.freeze({ create });
})();
