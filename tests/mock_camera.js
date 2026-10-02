// Local preview fixture: synthetic video only; no physical camera permission.
(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 480;
  const context = canvas.getContext("2d");
  let timer = null;
  function paint() {
    context.fillStyle = "#31585c"; context.fillRect(0, 0, 640, 480);
    context.fillStyle = "#8ec5a9"; context.fillRect(100, 90, 440, 300);
    context.fillStyle = "#183f46"; context.fillRect(260, 190, 120, 100);
    context.fillStyle = "#fff"; context.font = "24px sans-serif";
    context.fillText("MOCK CAMERA", 24, 44);
  }
  navigator.mediaDevices.getUserMedia = async () => {
    clearInterval(timer); paint();
    const stream = canvas.captureStream(15);
    timer = setInterval(paint, 70);
    const track = stream.getVideoTracks()[0];
    const originalStop = track.stop.bind(track);
    track.stop = () => { clearInterval(timer); originalStop(); };
    return stream;
  };
})();
