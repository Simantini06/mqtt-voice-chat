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
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      ui.sys("Microphone access denied — can't join the call.");
      return;
    }
    inCall = true;
    muted = false;
    ui.setMuted(false);
    refreshBar();
    ui.sys("You joined the voice call.");
    // Announce ourselves; existing members will respond with call-present.
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
    refreshBar();
    if (!silent) ui.sys("You left the voice call.");
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
        // A newcomer appeared: tell them we're here, then pair up.
        Chat.mqtt.publish({ type: "call-present", to: m.from });
        startPeer(m.from, m.nick);
        break;

      case "call-present":
        if (!inCall) return;
        // An existing member told us they're here: pair up.
        startPeer(m.from, m.nick);
        break;

      case "offer":
        if (!inCall) return;
        handleOffer(m);
        break;

      case "answer":
        if (peers[m.from]) {
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
    const peer = { pc, audioEl: null, nick: nick || "peer", pending: [] };
    peers[peerId] = peer;

    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) Chat.mqtt.publish({ type: "ice", to: peerId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      if (!peer.audioEl) {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.srcObject = e.streams[0];
        ui.el.audioSink.appendChild(audio);
        peer.audioEl = audio;
        ui.sys((peer.nick || "Someone") + " connected to the call.");
        refreshBar();
      }
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        if (peers[peerId]) { closePeer(peerId); refreshBar(); }
      }
    };

    return peer;
  }

  // Ensure a peer exists, then (if we're the designated caller) send an offer.
  function startPeer(peerId, nick) {
    if (peers[peerId]) {
      if (nick) peers[peerId].nick = nick;
      return;
    }
    createPeer(peerId, nick);
    if (S.clientId < peerId) negotiate(peerId); // smaller id is the caller
  }

  async function negotiate(peerId) {
    const pc = peers[peerId].pc;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      Chat.mqtt.publish({ type: "offer", to: peerId, sdp: pc.localDescription });
    } catch (e) {
      ui.sys("Call negotiation error: " + e.message);
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
      Chat.mqtt.publish({ type: "answer", to: m.from, sdp: pc.localDescription });
    } catch (e) {
      ui.sys("Call answer error: " + e.message);
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
    try { peer.pc.close(); } catch (e) {}
    if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove(); }
    delete peers[peerId];
  }

  // --- UI ------------------------------------------------------------------

  function refreshBar() {
    const names = Object.keys(peers)
      .filter((id) => peers[id].audioEl) // only show fully-connected peers
      .map((id) => peers[id].nick || "peer");
    ui.setCallBar(inCall, names);
  }

  Chat.call = { toggle, joinCall, leaveCall, toggleMute, onSignal };
})();
