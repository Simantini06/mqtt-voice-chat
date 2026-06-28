// Voice capture (MediaRecorder), chunked sending, and reassembly on receive.
window.Chat = window.Chat || {};

(function () {
  const S = Chat.state;
  const C = Chat.config;
  const ui = Chat.ui;

  let mediaRecorder = null;
  let recChunks = [];
  let recTimer = null;
  let recStart = 0;
  let recording = false;

  // --- Receiving: collect chunks by id, play once all parts arrive ---------
  function handleChunk(m) {
    let buf = S.inbox[m.id];
    if (!buf) buf = S.inbox[m.id] = { n: m.n, parts: new Array(m.n), got: 0 };
    if (buf.parts[m.i] === undefined) {
      buf.parts[m.i] = m.data;
      buf.got++;
    }
    if (buf.got === buf.n) {
      const b64 = buf.parts.join("");
      delete S.inbox[m.id];
      ui.renderVoice(m, b64);
    }
  }

  // --- Sending -------------------------------------------------------------
  async function startRecording() {
    if (recording) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      ui.sys("Microphone access denied or unavailable.");
      return;
    }

    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

    recChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      sendVoice(blob);
    };

    mediaRecorder.start();
    recording = true;
    recStart = Date.now();
    ui.el.voiceBtn.classList.add("rec");
    ui.el.voiceBtn.textContent = "■ Stop";
    ui.el.recbar.style.display = "inline-flex";
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      ui.el.recTime.textContent = s + "s";
      if (s >= C.MAX_VOICE_SECONDS) stopRecording();
    }, 250);
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    clearInterval(recTimer);
    ui.el.voiceBtn.classList.remove("rec");
    ui.el.voiceBtn.textContent = "🎤 Voice";
    ui.el.recbar.style.display = "none";
    try { mediaRecorder.stop(); } catch (e) {}
  }

  // Base64-encode the blob and split into broker-friendly chunks.
  function sendVoice(blob) {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(",")[1] || "";
      const id = S.clientId + "-" + Date.now().toString(36);
      const mime = blob.type || "audio/webm";
      const n = Math.ceil(b64.length / C.CHUNK_SIZE) || 1;
      for (let i = 0; i < n; i++) {
        Chat.mqtt.publish({
          type: "voice-chunk",
          id, i, n, mime,
          data: b64.slice(i * C.CHUNK_SIZE, (i + 1) * C.CHUNK_SIZE),
        });
      }
    };
    reader.readAsDataURL(blob);
  }

  function toggle() {
    recording ? stopRecording() : startRecording();
  }

  Chat.voice = { handleChunk, startRecording, stopRecording, toggle };
})();
