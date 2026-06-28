# 📡 MQTT Chat — Voice &amp; Text

A **serverless** browser chat app that sends **text and voice messages** over MQTT.
There is no backend to run: the browser talks directly to the free public
[HiveMQ](https://www.hivemq.com/) broker over secure WebSockets, and every client
in the same room subscribes to the same topic.

## ✨ Features

- 💬 Real-time **text** chat
- 🎤 **Voice** messages (recorded with the browser `MediaRecorder` API)
- 📞 **Group voice calls** — live, low-latency, peer-to-peer via WebRTC, with
  MQTT as the signaling channel (mute toggle + live participant list)
- 🧩 Large voice clips are **chunked** so they fit the broker's packet limits, then
  reassembled on the receiving side
- 🟢 Live connection status + join/leave notices
- 🗂️ Pick any **room name** to create a private-ish channel
- 🚫 **No server, no build step, no dependencies** to install — just open the page

## 🚀 Quick start

### Option A — open the file directly
Open `index.html` in a modern browser (Chrome, Edge, Firefox). It works straight
from `file://`. Open it in two tabs / devices, join the **same room**, and chat.

### Option B — host it (recommended for sharing)
Serve the folder over any static host, e.g.:

```bash
# Python
python -m http.server 8080
# then visit http://localhost:8080
```

Or enable **GitHub Pages** on this repo (Settings → Pages → deploy from `main`,
root) to get a public URL.

> 🎙️ Microphone access requires a **secure context** — `https://` or `file://`
> work; plain `http://` (other than `localhost`) will block the mic.

## 🏗️ Project structure

```
mqtt-voice-chat/
├── index.html              # markup + script/style includes
├── assets/
│   ├── css/
│   │   └── styles.css      # all styling
│   └── js/
│       ├── config.js       # broker URL, topic, chunk size, limits
│       ├── state.js        # shared session state
│       ├── ui.js           # DOM refs + message rendering
│       ├── mqtt-client.js  # connect / publish / route messages
│       ├── voice.js        # record, chunk-send, reassemble
│       ├── call.js         # group voice call (WebRTC mesh over MQTT)
│       └── app.js          # entry point + event wiring
├── README.md
└── LICENSE
```

## 🔌 How it works

There's no application server because **the broker is the backend**. Clients just
agree on a small JSON protocol published to the topic `mqttchat/<room>`:

| `type`        | Payload                                  | Meaning                       |
| ------------- | ---------------------------------------- | ----------------------------- |
| `text`         | `{ text }`                              | a chat message                |
| `join`         | —                                       | someone joined the room       |
| `leave`        | —                                       | someone left the room         |
| `voice-chunk`  | `{ id, i, n, mime, data }`              | one base64 slice of audio     |
| `call-join`    | —                                       | I joined the voice call       |
| `call-present` | `{ to }`                                | "I'm already in the call"     |
| `call-leave`   | —                                       | I left the voice call         |
| `offer`        | `{ to, sdp }`                           | WebRTC offer                  |
| `answer`       | `{ to, sdp }`                           | WebRTC answer                 |
| `ice`          | `{ to, candidate }`                     | WebRTC ICE candidate          |

Every envelope also carries `from` (unique client id), `nick`, and `ts`.

Voice **message** flow: record → `Blob` → base64 → split into `CHUNK_SIZE` pieces
→ publish each as a `voice-chunk` → receiver buffers by `id` until all `n` parts
arrive → decode and play.

### Group voice call

The **call** is real WebRTC: only the signaling travels over MQTT, while the
audio streams peer-to-peer. It forms a **mesh** (every participant connects to
every other), so it's best for small groups (~2–5 people).

1. Click **📞 Join call**. The browser asks for mic permission and broadcasts
   `call-join`.
2. Everyone already in the call replies `call-present`, so both sides discover
   each other.
3. For each pair, the peer with the **smaller client id** sends the `offer`; the
   other replies with an `answer`. `ice` candidates are exchanged as they're
   found. This deterministic rule prevents duplicate/colliding offers ("glare").
4. Audio then flows directly between browsers (via the public STUN servers in
   `config.js`). Use **🎙️ Mute** to toggle your mic and **Leave call** to drop
   out.

> 🔇 **Can't hear anyone?** Browsers block audio that starts outside a tap/click.
> If a stream arrives after your Join click "expires", an orange **🔊 Enable
> sound** button appears in the call bar — tap it once to unlock playback.
> Testing with two tabs on one computer causes echo/feedback; use two separate
> devices or headphones.

## ⚙️ Configuration

Edit `assets/js/config.js`:

| Key                 | Default                              | Purpose                          |
| ------------------- | ------------------------------------ | -------------------------------- |
| `BROKER_URL`        | `wss://broker.hivemq.com:8884/mqtt`  | MQTT-over-WSS endpoint           |
| `TOPIC_BASE`        | `mqttchat`                           | topic prefix                     |
| `CHUNK_SIZE`        | `18000`                              | base64 chars per voice packet    |
| `MAX_VOICE_SECONDS` | `60`                                 | recording length cap             |

## ⚠️ Notes &amp; limitations

- **Public broker** — anyone who guesses your room name can read messages. Fine
  for demos; don't send secrets. For isolation, switch to a
  [HiveMQ Cloud](https://www.hivemq.com/mqtt-cloud-broker/) free account
  (username/password + TLS) and update `BROKER_URL` / connect options.
- **No history** — MQTT is not a database. You only see messages received while
  connected.
- **Call group size** — the call is a full mesh, so each participant uploads
  their mic to every other. It works great for a handful of people; it won't
  scale to large rooms (that needs an SFU media server, which would break the
  no-backend design).
- **NAT traversal** — uses free public STUN only. Most networks work, but peers
  behind strict/symmetric NATs may fail to connect without a TURN server.

## 📄 License

[MIT](LICENSE)
