// DOM references and rendering helpers.
window.Chat = window.Chat || {};

(function () {
  const S = Chat.state;
  const $ = (id) => document.getElementById(id);

  const el = {
    messages: $("messages"),
    dot: $("dot"),
    statusText: $("statusText"),
    nick: $("nick"),
    room: $("room"),
    connectBtn: $("connectBtn"),
    text: $("text"),
    sendBtn: $("sendBtn"),
    voiceBtn: $("voiceBtn"),
    recbar: $("recbar"),
    recTime: $("recTime"),
    callBtn: $("callBtn"),
    callBar: $("callBar"),
    callInfo: $("callInfo"),
    callPeers: $("callPeers"),
    muteBtn: $("muteBtn"),
    leaveCallBtn: $("leaveCallBtn"),
    audioSink: $("audioSink"),
  };

  function setStatus(state, text) {
    el.dot.className =
      "dot" + (state === "on" ? " on" : state === "connecting" ? " connecting" : "");
    el.statusText.textContent = text;
  }

  function scroll() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function sys(text) {
    const node = document.createElement("div");
    node.className = "sysmsg";
    node.textContent = text;
    el.messages.appendChild(node);
    scroll();
  }

  function timeStr(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Build the shared bubble shell (avatar name + timestamp) for a message.
  function bubble(m) {
    const node = document.createElement("div");
    node.className = "msg" + (m.from === S.clientId ? " me" : "");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = '<span class="name"></span><span class="time"></span>';
    meta.querySelector(".name").textContent = m.from === S.clientId ? "You" : (m.nick || "anon");
    meta.querySelector(".time").textContent = timeStr(m.ts);
    node.appendChild(meta);
    return node;
  }

  function renderText(m) {
    const node = bubble(m);
    const t = document.createElement("div");
    t.className = "text";
    t.textContent = m.text;
    node.appendChild(t);
    el.messages.appendChild(node);
    scroll();
  }

  function renderVoice(m, b64) {
    const node = bubble(m);
    const label = document.createElement("div");
    label.className = "text";
    label.textContent = "🎤 Voice message";
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = "data:" + (m.mime || "audio/webm") + ";base64," + b64;
    node.appendChild(label);
    node.appendChild(audio);
    el.messages.appendChild(node);
    scroll();
  }

  function enableChat(on) {
    el.text.disabled = el.sendBtn.disabled = el.voiceBtn.disabled = el.callBtn.disabled = !on;
  }

  // Show/refresh the call bar. `peerNames` is an array of connected participant labels.
  function setCallBar(inCall, peerNames) {
    el.callBar.style.display = inCall ? "flex" : "none";
    el.callBtn.textContent = inCall ? "📞 In call" : "📞 Join call";
    el.callBtn.classList.toggle("active", inCall);
    if (inCall) {
      const n = peerNames.length;
      el.callInfo.textContent = n ? "🔊 In call — you + " + n + " other" + (n > 1 ? "s" : "") : "🔊 In call — waiting for others…";
      el.callPeers.innerHTML = "";
      peerNames.forEach((name) => {
        const chip = document.createElement("span");
        chip.className = "peer-chip";
        chip.textContent = name;
        el.callPeers.appendChild(chip);
      });
    }
  }

  function setMuted(muted) {
    el.muteBtn.textContent = muted ? "🔇 Unmute" : "🎙️ Mute";
    el.muteBtn.classList.toggle("danger", muted);
    el.muteBtn.classList.toggle("ghost", !muted);
  }

  Chat.ui = {
    el, setStatus, sys, scroll, timeStr, bubble, renderText, renderVoice, enableChat,
    setCallBar, setMuted,
  };
})();
