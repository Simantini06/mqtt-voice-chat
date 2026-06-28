# 📡 MQTT Chat — Voice &amp; Text

A **serverless** browser chat app that sends **text and voice messages** over MQTT.
There is no backend to run: the browser talks directly to the free public
[HiveMQ](https://www.hivemq.com/) broker over secure WebSockets, and every client
in the same room subscribes to the same topic.

## ✨ Features

- 💬 Real-time **text** chat
- 🎤 **Voice** messages (recorded with the browser `MediaRecorder` API)
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
│       └── app.js          # entry point + event wiring
├── README.md
└── LICENSE
```

## 🔌 How it works

There's no application server because **the broker is the backend**. Clients just
agree on a small JSON protocol published to the topic `mqttchat/<room>`:

| `type`        | Payload                                  | Meaning                       |
| ------------- | ---------------------------------------- | ----------------------------- |
| `text`        | `{ text }`                               | a chat message                |
| `join`        | —                                        | someone joined the room       |
| `leave`       | —                                        | someone left the room         |
| `voice-chunk` | `{ id, i, n, mime, data }`               | one base64 slice of audio     |

Every envelope also carries `from` (unique client id), `nick`, and `ts`.

Voice flow: record → `Blob` → base64 → split into `CHUNK_SIZE` pieces → publish
each as a `voice-chunk` → receiver buffers by `id` until all `n` parts arrive →
decode and play.

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

## 📄 License

[MIT](LICENSE)
