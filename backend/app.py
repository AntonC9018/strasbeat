"""Short microphone recordings → timed notes via Spotify Basic Pitch."""

from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
import numpy as np
import soundfile as sf

MAX_BYTES = 8 * 1024 * 1024
MAX_SECONDS = 30
SAMPLE_RATE = 22050
AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav"}
logger = logging.getLogger(__name__)


def load_transcriber():
    # Reuse Basic Pitch itself, the transcription model also used by MIDI-grep.
    # Keep one model loaded across requests rather than loading it for each clip.
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model, predict

    model = Model(build_icassp_2022_model_path(FilenameSuffix.onnx))

    def transcribe(path):
        _, _, events = predict(
            # Default confidence thresholds avoid treating vocal harmonics as
            # extra notes while retaining short sung/hummed notes.
            path,
            model,
            onset_threshold=0.5,
            frame_threshold=0.3,
            minimum_note_length=80,
            minimum_frequency=65.4,
            maximum_frequency=2093.0,
        )
        return events

    return transcribe


def transcribe_audio(data, transcriber):
    # ffmpeg handles MediaRecorder's WebM/Opus and Safari's MP4/AAC. Decode only
    # one second beyond the limit so a tiny compressed file cannot expand forever.
    with tempfile.TemporaryDirectory(prefix="strasbeat-voice-") as directory:
        source = Path(directory) / "recording"
        wav = Path(directory) / "recording.wav"
        source.write_bytes(data)
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-format_whitelist",
                    "matroska,webm,ogg,mov,wav",
                    "-i",
                    str(source),
                    "-t",
                    str(MAX_SECONDS + 1),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    str(SAMPLE_RATE),
                    "-c:a",
                    "pcm_s16le",
                    str(wav),
                ],
                check=True,
                timeout=15,
                capture_output=True,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            raise HTTPException(
                422, "Could not decode this recording. Try recording again."
            )
        audio, rate = sf.read(wav, dtype="float32")
        duration = len(audio) / rate
        if duration > MAX_SECONDS + 0.1:
            raise HTTPException(
                422, f"Recordings must be at most {MAX_SECONDS} seconds."
            )
        if duration < 0.1:
            raise HTTPException(422, "Recording is too short.")
        if not np.isfinite(audio).all():
            raise HTTPException(422, "Recording contains invalid audio samples.")
        if float(np.sqrt(np.mean(audio**2))) < 0.001:
            raise HTTPException(
                422, "No notes detected. Sing or hum closer to the microphone."
            )
        events = transcriber(wav)
        notes = [
            {
                "midi": int(pitch),
                "time": float(start),
                "duration": float(end - start),
                "velocity": float(np.clip(amplitude, 0, 1)),
            }
            for start, end, pitch, amplitude, _ in events
            if 0 <= start < end <= duration + 0.1 and 0 <= pitch <= 127
        ]
        notes.sort(key=lambda note: (note["time"], note["midi"]))
        if not notes:
            raise HTTPException(
                422, "No notes detected. Try a clear sung or hummed melody."
            )
        return {"notes": notes, "duration": duration, "model": "basic-pitch"}


def create_app(transcriber=None):
    @asynccontextmanager
    async def lifespan(app):
        if not shutil.which("ffmpeg"):
            raise RuntimeError("Install ffmpeg before starting the voice backend.")
        app.state.transcriber = transcriber or await run_in_threadpool(load_transcriber)
        yield

    app = FastAPI(title="Strasbeat voice capture", lifespan=lifespan)
    origins = os.environ.get(
        "VOICE_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[x.strip() for x in origins.split(",") if x.strip()],
        allow_methods=["POST", "GET"],
        allow_headers=["Content-Type"],
    )
    # One inference per worker; reject excess work instead of queueing model jobs
    # and keeping unbounded uploads in memory.
    slot = threading.BoundedSemaphore(1)

    @app.get("/api/voice/health")
    async def health():
        return {"ok": True, "model": "basic-pitch", "maxDuration": MAX_SECONDS}

    @app.post("/api/voice/transcribe")
    async def transcribe(request: Request):
        content_type = (
            request.headers.get("content-type", "").split(";")[0].strip().lower()
        )
        if content_type not in AUDIO_TYPES:
            raise HTTPException(415, "Send a WebM, Ogg, MP4 or WAV audio recording.")
        if not slot.acquire(blocking=False):
            raise HTTPException(
                503, "Voice transcription is busy. Try again in a moment."
            )
        try:
            data = bytearray()
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_BYTES:
                    raise HTTPException(413, "Recording exceeds the 8 MB upload limit.")
                data.extend(chunk)
            if not data:
                raise HTTPException(400, "Recording is empty.")
            try:
                return await run_in_threadpool(
                    transcribe_audio, data, request.app.state.transcriber
                )
            except HTTPException:
                raise
            except Exception:
                logger.exception("Voice transcription failed")
                raise HTTPException(500, "Transcription failed. Try recording again.")
        finally:
            slot.release()

    return app


app = create_app()
