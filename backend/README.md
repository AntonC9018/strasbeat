# Voice transcription service

The **Voice** button records a sung/hummed melody with `getUserMedia` and
`MediaRecorder`, sends the clip here, then uses the existing MIDI-to-Strudel
translation core to preview editable code. **Open as pattern** saves a new
browser-library pattern and opens its tab. Current edits remain in their tab.
The dev **save** button can then write it to `patterns/` for version control.

## Run locally

Use **Python 3.10**. Basic Pitch 0.4's platform dependencies are not compatible
with Python 3.12+. Python 3.10 also avoids installing TensorFlow; this service
explicitly uses the bundled ONNX model on CPU. Install `ffmpeg` on your PATH
(e.g. `brew install ffmpeg` or `sudo apt-get install ffmpeg`).

From the repository root:

```sh
python3.10 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Alternatively, `uv venv --python 3.10 .venv` and
`uv pip install --python .venv/bin/python -r backend/requirements.txt` create
the same environment. In a second terminal, run `pnpm dev`. Vite proxies
`/api/voice/*` to `http://127.0.0.1:8000`; set `VOICE_BACKEND_URL` in the Vite
process environment to change that target. Startup loads the model once,
and health checks succeed only after loading finishes. No API key, GPU, or
separate model download is required. First inference may take longer while
audio-processing routines compile.

## Hosted frontend

The existing static Vercel deployment does not run this Python service. Run
the backend on a server with Python 3.10 and ffmpeg, and expose it via HTTPS.
Build the frontend with `VITE_VOICE_API_URL=https://your-voice-service.example`
(no trailing path) and set backend `VOICE_ALLOWED_ORIGINS` to the frontend's
exact origin. Multiple origins can be comma-separated. Alternatively, route
`/api/voice/*` through your own reverse proxy and leave `VITE_VOICE_API_URL`
empty. Microphone access requires HTTPS or localhost.

For a public service, configure access control and rate limits at the reverse
proxy appropriate to your deployment. CORS is an origin policy, not
authentication. The service rejects concurrent inference per worker with 503
rather than keeping an unbounded queue. Run one worker unless you intend to
load additional copies of the model.

## API

- `GET /api/voice/health` → `{ "ok": true, "model": "basic-pitch", "maxDuration": 30 }`
- `POST /api/voice/transcribe`: raw audio bytes in the request body, with an
  `audio/webm`, `audio/ogg`, `audio/mp4`, or `audio/wav` Content-Type
  (codec parameters are accepted). Returns:

```json
{
  "model": "basic-pitch",
  "duration": 2.0,
  "notes": [{ "midi": 60, "time": 0.1, "duration": 0.5, "velocity": 0.8 }]
}
```

Note times/durations are seconds and velocities are normalized to 0–1.
Errors use FastAPI's `{ "detail": "..." }`: empty input 400, oversized input
413, unsupported type 415, undecodable/silent/long/no-note input 422, busy
503, unexpected model failures 500. Uploads are capped at 8 MB and 30 seconds.
FFmpeg decodes WebM/Opus (Chrome/Firefox), Ogg and MP4/AAC (Safari) to mono
22.05 kHz PCM before inference. Temporary audio files are deleted after each
request, including failures; recordings are not retained by the service.

This captures **musical pitches**, not spoken-word dictation. A clear solo
melody works best. Set the tempo before opening the generated pattern and use
the quantization controls to adjust rhythm. Leading microphone silence is
trimmed in the pattern; pauses within the phrase are preserved. The draft
plays on `gm_piano`, and you can change the sound in the editor. Pitch bends,
lyrics, beatboxing and automatic tempo detection are outside this first flow.

## Community projects and reuse

Investigated [MIDI-grep](https://github.com/dygy/MIDI-grep), which combines
stem separation, Basic Pitch and Strudel code generation, and
[Basic Pitch TS](https://github.com/spotify/basic-pitch-ts), its browser/JS
sibling. The requested server model fits the Python
[Spotify Basic Pitch](https://github.com/spotify/basic-pitch) package best.
We reuse its bundled ONNX model, inference and note extraction through the
published package (Copyright Spotify AB, Apache-2.0). No upstream code is
vendored. MIDI-grep's transcription flow informed the integration, but its
full-song separation/cleanup pipeline is unnecessary for a short solo voice
clip. Strasbeat's existing shared translation core handles pattern generation.

## Tests

```sh
.venv/bin/python -m pip install -r backend/requirements-dev.txt
.venv/bin/python -m pytest backend -q
# Optional: also run real model inference on a generated three-note phrase.
VOICE_MODEL_TEST=1 .venv/bin/python -m pytest backend -q
pnpm test
```
