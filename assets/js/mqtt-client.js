// Broker connection, publish, and inbound message routing.
window.Chat = window.Chat || {};

(function () {
  const S = Chat.state;
  const C = Chat.config;
  const ui = Chat.ui;

  // Publish a JSON envelope to the room topic, stamped with sender identity.
  function publish(obj) {
    if (!S.client || !S.client.connected) return;
    obj.from = S.clientId;
    obj.nick = S.nick;
    obj.ts = obj.ts || Date.now();
    S.client.publish(S.topic, JSON.stringify(obj), { qos: 0 });
  }

  function connect() {
    S.nick = (ui.el.nick.value || "anon").trim();
    S.room = (ui.el.room.value || "lobby").trim().replace(/[#+\/\s]/g, "_");
    S.topic = C.TOPIC_BASE + "/" + S.room;

    ui.setStatus("connecting", "Connecting…");
    ui.el.connectBtn.disabled = true;

    S.client = mqtt.connect(C.BROKER_URL, {
      clientId: S.clientId,
      clean: true,
      reconnectPeriod: 2000,
      connectTimeout: 8000,
    });

    Chat.debug.log("Connecting to broker " + C.BROKER_URL, "info");
    S.client.on("connect", () => {
      ui.setStatus("on", "Connected · room: " + S.room);
      Chat.debug.log("Broker connected · subscribing to " + S.topic, "ok");
      S.client.subscribe(S.topic, { qos: 0 }, (err) => {
        if (err) { ui.sys("Subscribe error: " + err.message); Chat.debug.log("Subscribe error: " + err.message, "err"); }
      });
      ui.enableChat(true);
      ui.el.connectBtn.textContent = "Disconnect";
      ui.el.connectBtn.disabled = false;
      ui.el.connectBtn.onclick = disconnect;
      ui.el.room.disabled = ui.el.nick.disabled = true;
      publish({ type: "join" });
    });

    S.client.on("reconnect", () => ui.setStatus("connecting", "Reconnecting…"));
    S.client.on("error", (e) => ui.setStatus("", "Error: " + e.message));
    S.client.on("close", () => { if (S.client) ui.setStatus("", "Disconnected"); });
    S.client.on("message", (t, payload) => onMessage(t, payload));
  }

  function disconnect() {
    if (Chat.call) Chat.call.leaveCall(true); // tear down any active voice call first
    if (S.client) {
      try { publish({ type: "leave" }); } catch (e) {}
      S.client.end(true);
      S.client = null;
    }
    ui.setStatus("", "Disconnected");
    ui.enableChat(false);
    ui.el.connectBtn.textContent = "Connect";
    ui.el.connectBtn.onclick = connect;
    ui.el.room.disabled = ui.el.nick.disabled = false;
  }

  function onMessage(t, payload) {
    let m;
    try { m = JSON.parse(payload.toString()); } catch (e) { return; }

    switch (m.type) {
      case "text":
        ui.renderText(m);
        break;
      case "join":
        if (m.from !== S.clientId) ui.sys(m.nick + " joined");
        break;
      case "leave":
        if (m.from !== S.clientId) ui.sys(m.nick + " left");
        break;
      case "voice-chunk":
        Chat.voice.handleChunk(m);
        break;
      case "call-join":
      case "call-present":
      case "call-leave":
      case "offer":
      case "answer":
      case "ice":
        Chat.call.onSignal(m);
        break;
    }
  }

  Chat.mqtt = { connect, disconnect, publish };
})();
