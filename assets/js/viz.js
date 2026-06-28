// Live audio waveforms (oscilloscope) for the local mic and each remote peer.
// A moving green wave = sound present on that stream. This is a visual way to
// confirm your mic is capturing and that a peer's audio is arriving.
window.Chat = window.Chat || {};

(function () {
  const ui = Chat.ui;
  let ctx = null;
  const tiles = {}; // id -> { wrap, canvas, c2d, analyser, source, data, raf, statsEl }

  // The AudioContext must be (re)started from a user gesture (the Join click).
  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function attach(id, label, stream, isLocal) {
    ensureCtx();
    if (tiles[id]) detach(id);

    const wrap = document.createElement("div");
    wrap.className = "wave-tile" + (isLocal ? " local" : "");

    const lab = document.createElement("div");
    lab.className = "wave-label";
    lab.textContent = (isLocal ? "🎙️ " : "🔊 ") + label;

    const canvas = document.createElement("canvas");
    canvas.className = "wave-canvas";
    canvas.width = 240;
    canvas.height = 48;

    const stats = document.createElement("div");
    stats.className = "wave-stats";
    stats.textContent = isLocal ? "your mic" : "connecting…";

    wrap.appendChild(lab);
    wrap.appendChild(canvas);
    wrap.appendChild(stats);
    ui.el.waveforms.appendChild(wrap);

    let analyser = null, source = null;
    try {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser); // analysis only — NOT connected to output (no echo)
    } catch (e) {
      Chat.debug.log("waveform attach failed for " + id + ": " + e.message, "err");
    }

    const data = analyser ? new Uint8Array(analyser.fftSize) : null;
    const c2d = canvas.getContext("2d");
    const tile = { wrap, canvas, c2d, analyser, source, data, statsEl: stats, raf: 0 };
    tiles[id] = tile;

    function draw() {
      tile.raf = requestAnimationFrame(draw);
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      const w = canvas.width, h = canvas.height;
      c2d.clearRect(0, 0, w, h);

      let sumSq = 0;
      c2d.lineWidth = 2;
      c2d.beginPath();
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128; // -1..1
        sumSq += v * v;
        const x = (i / (data.length - 1)) * w;
        const y = h / 2 + v * (h / 2) * 0.9;
        i ? c2d.lineTo(x, y) : c2d.moveTo(x, y);
      }
      const rms = Math.sqrt(sumSq / data.length);
      const active = rms > 0.015;
      c2d.strokeStyle = active ? "#2ecc71" : "#4f8cff"; // green when sound present
      c2d.stroke();

      // level meter strip along the bottom
      c2d.fillStyle = active ? "#2ecc71" : "#2c3142";
      c2d.fillRect(0, h - 3, Math.min(1, rms * 4) * w, 3);
    }
    draw();
    return tile;
  }

  function setStats(id, text) {
    if (tiles[id]) tiles[id].statsEl.textContent = text;
  }

  function detach(id) {
    const t = tiles[id];
    if (!t) return;
    cancelAnimationFrame(t.raf);
    try { if (t.source) t.source.disconnect(); } catch (e) {}
    try { if (t.analyser) t.analyser.disconnect(); } catch (e) {}
    if (t.wrap && t.wrap.parentNode) t.wrap.parentNode.removeChild(t.wrap);
    delete tiles[id];
  }

  function clearAll() { Object.keys(tiles).forEach(detach); }

  Chat.viz = { ensureCtx, attach, detach, setStats, clearAll };
})();
