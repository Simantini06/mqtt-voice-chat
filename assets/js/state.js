// Shared mutable state for the chat session.
window.Chat = window.Chat || {};

Chat.state = {
  client: null,                                   // active mqtt.js client
  nick: "",                                       // display name
  room: "",                                       // joined room
  topic: "",                                       // resolved topic for the room
  clientId: "web-" + Math.random().toString(16).slice(2, 10), // unique per tab
  inbox: {},                                      // reassembly buffers for chunked voice
};
