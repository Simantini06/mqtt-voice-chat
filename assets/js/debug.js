// On-screen debug log so you can see what the call is doing without devtools.
window.Chat = window.Chat || {};

(function () {
  const MAX_LINES = 400;
  let panel = null;
  let logEl = null;

  function init() {
    panel = document.getElementById("debugPanel");
    logEl = document.getElementById("debugLog");
  }

  function stamp() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour12: false }) +
      "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  // level: "info" | "ok" | "warn" | "err"
  function log(msg, level) {
    if (!logEl) init();
    if (!logEl) return;
    const line = document.createElement("div");
    line.className = "log-line " + (level || "info");
    line.textContent = "[" + stamp() + "] " + msg;
    logEl.appendChild(line);
    while (logEl.childNodes.length > MAX_LINES) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
    try { console.log("[chat] " + msg); } catch (e) {}
  }

  function toggle() { if (!panel) init(); if (panel) panel.classList.toggle("open"); }
  function show(on) { if (!panel) init(); if (panel) panel.classList.toggle("open", !!on); }
  function clear() { if (!logEl) init(); if (logEl) logEl.innerHTML = ""; }

  Chat.debug = { log, toggle, show, clear };
})();
