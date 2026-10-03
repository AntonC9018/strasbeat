import io
import threading
import subprocess

from fastapi.testclient import TestClient
import numpy as np
import pytest
import soundfile as sf

from backend.app import MAX_BYTES, create_app


def wav(seconds=1, silent=False):
    rate = 22050
    t = np.arange(int(rate * seconds)) / rate
    audio = np.zeros_like(t) if silent else 0.25 * np.sin(2 * np.pi * 440 * t)
    buffer = io.BytesIO()
    sf.write(buffer, audio, rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


@pytest.fixture
def client():
    def model(path):
        assert path.exists()
        audio, rate = sf.read(path)
        assert rate == 22050 and audio.ndim == 1
        return [(0.1, 0.6, 69, 0.75, None)]

    with TestClient(create_app(model)) as client:
        yield client


def test_transcription_contract_and_health(client):
    assert client.get("/api/voice/health").json()["ok"]
    response = client.post(
        "/api/voice/transcribe", content=wav(), headers={"Content-Type": "audio/wav"}
    )
    assert response.status_code == 200
    assert response.json()["notes"] == [
        {"midi": 69, "time": 0.1, "duration": 0.5, "velocity": 0.75}
    ]
    assert response.json()["duration"] == 1


@pytest.mark.parametrize(
    "audio,content_type,status",
    [
        (b"", "audio/wav", 400),
        (b"broken", "audio/wav", 422),
        (b"x", "text/plain", 415),
        (b"x" * (MAX_BYTES + 1), "audio/webm", 413),
        (wav(silent=True), "audio/wav", 422),
        (wav(31), "audio/wav", 422),
    ],
    ids=["empty", "malformed", "unsupported", "oversized", "silent", "too-long"],
)
def test_invalid_recordings(client, audio, content_type, status):
    response = client.post(
        "/api/voice/transcribe", content=audio, headers={"Content-Type": content_type}
    )
    assert response.status_code == status
    # Each error releases the inference slot for the next request.
    assert (
        client.post(
            "/api/voice/transcribe",
            content=wav(),
            headers={"Content-Type": "audio/wav"},
        ).status_code
        == 200
    )


def test_temporary_recordings_removed_after_success_and_failure():
    paths = []

    def model(path):
        paths.append(path)
        if len(paths) == 1:
            raise RuntimeError("private failure detail")
        return []

    with TestClient(create_app(model)) as client:
        first = client.post(
            "/api/voice/transcribe",
            content=wav(),
            headers={"Content-Type": "audio/wav"},
        )
        assert first.status_code == 500
        assert "private failure" not in first.text
        assert (
            client.post(
                "/api/voice/transcribe",
                content=wav(),
                headers={"Content-Type": "audio/wav"},
            ).status_code
            == 422
        )
    assert all(not path.parent.exists() for path in paths)


def test_busy_model_rejects_second_request():
    entered, release = threading.Event(), threading.Event()

    def model(path):
        entered.set()
        assert release.wait(timeout=5)
        return [(0, 0.5, 60, 0.8, None)]

    with TestClient(create_app(model)) as client:
        thread = threading.Thread(
            target=lambda: client.post(
                "/api/voice/transcribe",
                content=wav(),
                headers={"Content-Type": "audio/wav"},
            )
        )
        thread.start()
        try:
            assert entered.wait(timeout=5)
            assert (
                client.post(
                    "/api/voice/transcribe",
                    content=wav(),
                    headers={"Content-Type": "audio/wav"},
                ).status_code
                == 503
            )
        finally:
            release.set()
            thread.join(timeout=5)


def test_cors_preflight(client):
    response = client.options(
        "/api/voice/transcribe",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    response = client.options(
        "/api/voice/transcribe",
        headers={
            "Origin": "https://other.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 400


@pytest.mark.parametrize(
    "extension,codec,content_type",
    [
        ("webm", "libopus", "audio/webm;codecs=opus"),
        ("ogg", "libopus", "audio/ogg;codecs=opus"),
        ("mp4", "aac", "audio/mp4"),
    ],
)
def test_browser_recording_formats(client, tmp_path, extension, codec, content_type):
    source = tmp_path / "input.wav"
    encoded = tmp_path / f"input.{extension}"
    source.write_bytes(wav())
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(source),
            "-c:a",
            codec,
            str(encoded),
        ],
        check=True,
    )
    response = client.post(
        "/api/voice/transcribe",
        content=encoded.read_bytes(),
        headers={"Content-Type": content_type},
    )
    assert response.status_code == 200, response.text
