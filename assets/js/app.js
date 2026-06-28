// Entry point: seed defaults and wire UI events to the modules.
window.Chat = window.Chat || {};

(function () {
  const ui = Chat.ui;
  const mqtt = Chat.mqtt;
  const voice = Chat.voice;

  // Friendly random default name.
  ui.el.nick.value = "user" + Math.floor(Math.random() * 1000);

  function sendText() {
    const text = ui.el.text.value.trim();
    if (!text) return;
    mqtt.publish({ type: "text", text });
    ui.el.text.value = "";
    ui.el.text.focus();
  }

  ui.el.connectBtn.onclick = mqtt.connect;
  ui.el.sendBtn.onclick = sendText;
  ui.el.text.addEventListener("keydown", (e) => { if (e.key === "Enter") sendText(); });
  ui.el.voiceBtn.onclick = voice.toggle;

  window.addEventListener("beforeunload", () => {
    if (Chat.state.client) {
      try { mqtt.publish({ type: "leave" }); } catch (e) {}
    }
  });
})();
