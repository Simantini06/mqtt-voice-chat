// Group voice call: a WebRTC mesh signalled over MQTT.
//
// Audio itself flows peer-to-peer via WebRTC; MQTT only carries the signaling
// (presence + SDP offers/answers + ICE candidates). This keeps the app
// backend-free while giving real-time, low-latency voice — unlike the chunked
// voice *messages* in voice.js.
//
// Pairing rule (avoids "glare" / duplicate offers): for any two peers, the one
// with the smaller clientId is the caller and creates the offer; the other
// waits and answers. Both sides learn about each other via call-join /
// call-present, so the rule is always applied symmetrically exactly once.
window.Chat = window.Chat || {};

(function () {
  const S = Chat.state;
  const C = Chat.config;
  const ui = Chat.ui;
  const dbg = (m, lvl) => Chat.debug.log(m, lvl);
  const short = (id) => (id || "").slice(-4);

  let inCall = false;
  let localStream = null;
  let muted = false;
  const peers = {}; // peerId -> { pc, audioEl, nick, pending: [candidates] }

  // --- Public API ----------------------------------------------------------

  async function toggle() {
    inCall ? leaveCall(false) : await joinCall();
  }

  async function joinCall() {
    if (inCall) return;
    if (!S.client || !S.client.connected) { ui.sys("Connect to a room first."); return; }
    Chat.debug.show(true); // surface the log panel so transmission is visible
    dbg("Joining call… requesting microphone", "info");
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      ui.sys("Microphone access denied — can't join the call.");
      dbg("getUserMedia failed: " + e.message, "err");
      return;
    }
    inCall = true;
    muted = false;
    ui.setMuted(false);
    const tracks = localStream.getAudioTracks();
    dbg("Mic ready: " + tracks.length + " track(s)" +
        (tracks[0] ? " [" + (tracks[0].label || "default") + "]" : ""), "ok");
    Chat.viz.ensureCtx();
    Chat.viz.attach("self", S.nick || "You", localStream, true);
    refreshBar();
    ui.sys("You joined the voice call.");
    // Announce ourselves; existing members will respond with call-present.
    dbg("→ broadcast call-join as " + short(S.clientId), "info");
    Chat.mqtt.publish({ type: "call-join" });
  }

  function leaveCall(silent) {
    if (!inCall) return;
    inCall = false;
    if (!silent) Chat.mqtt.publish({ type: "call-leave" });
    Object.keys(peers).forEach(closePeer);
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    Chat.viz.clearAll();
    refreshBar();
    ui.showEnableSound(false);
    if (!silent) { ui.sys("You left the voice call."); dbg("Left call", "info"); }
  }

  function toggleMute() {
    if (!inCall || !localStream) return;
    muted = !muted;
    localStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    ui.setMuted(muted);
  }

  // --- Signaling -----------------------------------------------------------

  function onSignal(m) {
    if (m.from === S.clientId) return;          // ignore our own broadcasts
    if (m.to && m.to !== S.clientId) return;    // ignore messages aimed at others

    switch (m.type) {
      case "call-join":
        if (!inCall) return;
        dbg("◀ call-join from " + short(m.from) + " (" + (m.nick || "?") + ")", "info");
        // A newcomer appeared: tell them we're here, then pair up.
        Chat.mqtt.publish({ type: "call-present", to: m.from });
        startPeer(m.from, m.nick);
        break;

      case "call-present":
        if (!inCall) return;
        dbg("◀ call-present from " + short(m.from) + " (" + (m.nick || "?") + ")", "info");
        // An existing member told us they're here: pair up.
        startPeer(m.from, m.nick);
        break;

      case "offer":
        if (!inCall) return;
        dbg("◀ offer from " + short(m.from), "info");
        handleOffer(m);
        break;

      case "answer":
        if (peers[m.from]) {
          dbg("◀ answer from " + short(m.from), "info");
          peers[m.from].pc.setRemoteDescription(m.sdp).then(() => flushCandidates(m.from));
        }
        break;

      case "ice":
        addCandidate(m.from, m.candidate);
        break;

      case "call-leave":
        if (peers[m.from]) {
          ui.sys((peers[m.from].nick || "Someone") + " left the call.");
          closePeer(m.from);
          refreshBar();
        }
        break;
    }
  }

  // --- Peer connection management ------------------------------------------

  function createPeer(peerId, nick) {
    const pc = new RTCPeerConnection({ iceServers: C.ICE_SERVERS });
    const peer = { pc, audioEl: null, nick: nick || "peer", pending: [], statsTimer: null };
    peers[peerId] = peer;
    dbg("Created peer connection with " + short(peerId), "info");

    const sent = localStream.getTracks();
    sent.forEach((t) => pc.addTrack(t, localStream));
    dbg("Added " + sent.length + " mic track(s) → " + short(peerId), "info");

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        Chat.mqtt.publish({ type: "ice", to: peerId, candidate: e.candidate });
      } else {
        dbg("ICE gathering complete for " + short(peerId), "info");
      }
    };

    pc.oniceconnectionstatechange = () =>
      dbg("ICE " + short(peerId) + ": " + pc.iceConnectionState,
          pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed" ? "ok"
          : pc.iceConnectionState === "failed" ? "err" : "info");

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      dbg("▼ remote " + e.track.kind + " track from " + short(peerId), "ok");
      if (!peer.audioEl) {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        audio.setAttribute("playsinline", ""); // iOS Safari needs the attribute
        audio.srcObject = stream;
        ui.el.audioSink.appendChild(audio);
        peer.audioEl = audio;
        Chat.viz.attach(peerId, peer.nick, stream, false);
        ui.sys((peer.nick || "Someone") + " connected to the call.");
        refreshBar();
        playAudio(audio);
      } else {
        peer.audioEl.srcObject = stream;
        Chat.viz.attach(peerId, peer.nick, stream, false);
        playAudio(peer.audioEl);
      }
    };

    pc.onconnectionstatechange = () => {
      dbg("PC " + short(peerId) + ": " + pc.connectionState,
          pc.connectionState === "connected" ? "ok"
          : pc.connectionState === "failed" ? "err" : "info");
      if (pc.connectionState === "connected") startStats(peerId);
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        if (peers[peerId]) { closePeer(peerId); refreshBar(); }
      }
    };

    return peer;
  }

  // Poll WebRTC stats so you can SEE bytes moving (↑ sent / ↓ received).
  function fmt(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + "MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + "KB";
    return bytes + "B";
  }

  function startStats(peerId) {
    const peer = peers[peerId];
    if (!peer || peer.statsTimer) return;
    let lastRecv = 0;
    peer.statsTimer = setInterval(async () => {
      if (!peer.pc) return;
      let sent = 0, recv = 0, pSent = 0, pRecv = 0;
      try {
        const stats = await peer.pc.getStats();
        stats.forEach((r) => {
          const audio = r.kind === "audio" || r.mediaType === "audio";
          if (r.type === "outbound-rtp" && audio) { sent = r.bytesSent || 0; pSent = r.packetsSent || 0; }
          if (r.type === "inbound-rtp" && audio) { recv = r.bytesReceived || 0; pRecv = r.packetsReceived || 0; }
        });
      } catch (e) { return; }
      const flowing = recv > lastRecv;
      lastRecv = recv;
      Chat.viz.setStats(peerId, "↑ " + fmt(sent) + " · ↓ " + fmt(recv) + (flowing ? " ●" : ""));
    }, 1500);
  }

  // Ensure a peer exists, then (if we're the designated caller) send an offer.
  function startPeer(peerId, nick) {
    if (peers[peerId]) {
      if (nick) peers[peerId].nick = nick;
      return;
    }
    createPeer(peerId, nick);
    if (S.clientId < peerId) {
      dbg("I'm the caller for " + short(peerId) + " → creating offer", "info");
      negotiate(peerId);
    } else {
      dbg("Waiting for offer from " + short(peerId), "info");
    }
  }

  async function negotiate(peerId) {
    const pc = peers[peerId].pc;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      dbg("→ offer to " + short(peerId), "info");
      Chat.mqtt.publish({ type: "offer", to: peerId, sdp: pc.localDescription });
    } catch (e) {
      ui.sys("Call negotiation error: " + e.message);
      dbg("negotiate error " + short(peerId) + ": " + e.message, "err");
    }
  }

  async function handleOffer(m) {
    let peer = peers[m.from];
    if (!peer) peer = createPeer(m.from, m.nick);
    else if (m.nick) peer.nick = m.nick;
    const pc = peer.pc;
    try {
      await pc.setRemoteDescription(m.sdp);
      flushCandidates(m.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      dbg("→ answer to " + short(m.from), "info");
      Chat.mqtt.publish({ type: "answer", to: m.from, sdp: pc.localDescription });
    } catch (e) {
      ui.sys("Call answer error: " + e.message);
      dbg("answer error " + short(m.from) + ": " + e.message, "err");
    }
  }

  // ICE candidates can arrive before the remote description is set — queue them.
  function addCandidate(peerId, candidate) {
    const peer = peers[peerId];
    if (!peer) return;
    if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) {
      peer.pc.addIceCandidate(candidate).catch(() => {});
    } else {
      peer.pending.push(candidate);
    }
  }

  function flushCandidates(peerId) {
    const peer = peers[peerId];
    if (!peer) return;
    peer.pending.forEach((c) => peer.pc.addIceCandidate(c).catch(() => {}));
    peer.pending = [];
  }

  function closePeer(peerId) {
    const peer = peers[peerId];
    if (!peer) return;
    if (peer.statsTimer) clearInterval(peer.statsTimer);
    try { peer.pc.close(); } catch (e) {}
    if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove(); }
    Chat.viz.detach(peerId);
    delete peers[peerId];
    dbg("Closed peer " + short(peerId), "info");
  }

  // --- UI ------------------------------------------------------------------

  // Browsers block autoplay of audio that starts outside a user gesture (the
  // remote track arrives seconds after the Join click). Try to play; if blocked,
  // surface an "Enable sound" button the user can tap to unlock playback.
  function playAudio(el) {
    const p = el.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => ui.showEnableSound(true));
    }
  }

  // Called from a user tap — plays every remote stream and hides the prompt.
  function unlockAudio() {
    ui.showEnableSound(false);
    const audios = ui.el.audioSink.querySelectorAll("audio");
    Array.prototype.forEach.call(audios, (el) => { el.play().catch(() => {}); });
  }

  function refreshBar() {
    const names = Object.keys(peers)
      .filter((id) => peers[id].audioEl) // only show fully-connected peers
      .map((id) => peers[id].nick || "peer");
    ui.setCallBar(inCall, names);
  }

  Chat.call = { toggle, joinCall, leaveCall, toggleMute, onSignal, unlockAudio };
})();
