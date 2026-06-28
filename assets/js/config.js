// Static configuration for the MQTT chat client.
// No backend required — these constants describe how clients talk to the broker.
window.Chat = window.Chat || {};

Chat.config = {
  // HiveMQ's free public broker, over secure WebSockets (works on https:// and file://).
  BROKER_URL: "wss://broker.hivemq.com:8884/mqtt",

  // Base topic; the actual room topic is `${TOPIC_BASE}/<room>`.
  TOPIC_BASE: "mqttchat",

  // Base64 characters per MQTT message, so voice packets stay small enough for the broker.
  CHUNK_SIZE: 18000,

  // Hard cap on a single voice recording.
  MAX_VOICE_SECONDS: 60,
};
