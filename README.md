# Ish Recorders

A browser-based voice **recorder + live transcriber**. Everything runs client-side — no server, no API keys, no uploads. Your audio and transcripts never leave your machine.

## Features

- 🎙️ **Record audio** from your microphone (MediaRecorder API)
- 📝 **Live transcription** as you speak (Web Speech API)
- ⏸️ Pause / resume while recording
- 📊 Real-time waveform visualizer
- 💾 **Local library** — recordings saved in your browser (IndexedDB)
- ▶️ Play back any recording
- ✏️ Edit titles and transcripts, copy transcript to clipboard
- ⬇️ Download audio (`.webm`/`.m4a`) and transcript (`.txt`)

## Usage

It's a static site — just open `index.html`.

```bash
# Option A: open the file directly
open index.html        # macOS   (or: xdg-open index.html on Linux)

# Option B: serve it (recommended — some browsers restrict mic on file://)
python3 -m http.server 8000
# then visit http://localhost:8000
```

Click **Record**, allow microphone access, and talk. Click **Stop & Save** to
add it to your library.

## Browser support

- **Audio recording** works in all modern browsers (Chrome, Edge, Firefox, Safari).
- **Live transcription** uses the Web Speech API, which currently works best in
  **Chrome** and **Edge**. In other browsers, recording still works — you just
  won't get the automatic transcript.

## How it works

| Piece | Tech |
|-------|------|
| Capture | `getUserMedia` + `MediaRecorder` |
| Transcription | `SpeechRecognition` (Web Speech API) |
| Storage | `IndexedDB` (audio blobs + metadata) |
| Visualizer | `AudioContext` + `AnalyserNode` on a `<canvas>` |

No build step, no dependencies. `index.html`, `css/styles.css`, and the two
scripts in `js/` are the whole app.

## Train Home (`train/`)

A separate mini-app: open `train/index.html` and it tells you the **quickest train
home** from where you are right now — when to leave, which lines to take, and when
you'll get home — plus a map of the route and other options.

- Uses Google's **Routes API** (transit directions) and **Maps JavaScript API** (the map).
- First run asks for your home address and a Google Maps API key. Both are saved
  only in your browser (`localStorage`), never committed or uploaded anywhere but Google.
- Create a key at <https://console.cloud.google.com/google/maps-apis>, enable
  *Routes API* and *Maps JavaScript API*, and ideally restrict it to your site's URL.
- "Trains only" limits results to subway/rail/light rail; untick it to allow buses.

## Privacy

All data stays in your browser. Clearing your browser's site data for this page
removes every saved recording.
