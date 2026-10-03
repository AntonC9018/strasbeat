"""Opt-in smoke test of the actual bundled model; no external audio fixture."""

import os

from fastapi.testclient import TestClient
import numpy as np
import pytest
import soundfile as sf
import io

from backend.app import create_app


@pytest.mark.skipif(
    os.environ.get("VOICE_MODEL_TEST") != "1",
    reason="Set VOICE_MODEL_TEST=1 for real inference",
)
def test_real_model_transcribes_three_note_phrase():
    rate = 22050
    parts = []
    for pitch in (60, 64, 67):
        t = np.arange(int(rate * 0.8)) / rate
        frequency = 440 * 2 ** ((pitch - 69) / 12)
        envelope = np.minimum(1, t / 0.02) * np.minimum(1, (0.8 - t) / 0.05)
        tone = (
            sum(
                0.2 / harmonic * np.sin(2 * np.pi * frequency * harmonic * t)
                for harmonic in (1, 2, 3)
            )
            * envelope
        )
        parts.extend([tone, np.zeros(int(rate * 0.2))])
    buffer = io.BytesIO()
    sf.write(buffer, np.concatenate(parts), rate, format="WAV", subtype="PCM_16")
    with TestClient(create_app()) as client:
        response = client.post(
            "/api/voice/transcribe",
            content=buffer.getvalue(),
            headers={"Content-Type": "audio/wav"},
        )
    assert response.status_code == 200, response.text
    assert {note["midi"] for note in response.json()["notes"]} == {60, 64, 67}
