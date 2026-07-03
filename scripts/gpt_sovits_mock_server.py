#!/usr/bin/env python3
"""Small GPT-SoVITS-compatible test server.

This implements the GET `/tts` endpoint used by `gpt_sovits_tts.py`.
It is only a connectivity/mock server; run the real GPT-SoVITS API for
actual voice cloning.
"""

from __future__ import annotations

import math
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse


app = FastAPI(title="GPT-SoVITS Mock TTS")


def synthesize_tone(text: str, sample_rate: int = 24000) -> Path:
    duration = max(0.4, min(5.0, 0.075 * len(text)))
    samples = int(sample_rate * duration)
    timeline = np.linspace(0.0, duration, samples, endpoint=False)

    # Vary the tone a little so different input is audibly different.
    frequency = 220.0 + (sum(text.encode("utf-8")) % 280)
    carrier = np.sin(2.0 * math.pi * frequency * timeline)
    overtone = 0.25 * np.sin(2.0 * math.pi * frequency * 2.0 * timeline)
    fade = min(sample_rate // 20, samples // 2)
    envelope = np.ones(samples, dtype=np.float32)
    if fade > 0:
        envelope[:fade] = np.linspace(0.0, 1.0, fade)
        envelope[-fade:] = np.linspace(1.0, 0.0, fade)

    audio = (0.18 * (carrier + overtone) * envelope).astype(np.float32)
    output = Path(tempfile.NamedTemporaryFile(prefix="gpt_sovits_mock_", suffix=".wav", delete=False).name)
    sf.write(output, audio, sample_rate)
    return output


@app.get("/tts")
def tts(
    text: str = Query(...),
    text_lang: str = "en",
    ref_audio_path: str = "",
    prompt_lang: str = "en",
    prompt_text: str = "",
    text_split_method: str = "cut5",
    batch_size: str = "1",
    media_type: str = "wav",
    streaming_mode: str = "false",
) -> FileResponse:
    if media_type != "wav":
        raise HTTPException(status_code=400, detail="Mock server only supports media_type=wav")

    if ref_audio_path and not Path(ref_audio_path).exists():
        raise HTTPException(status_code=400, detail=f"ref_audio_path not found: {ref_audio_path}")

    output = synthesize_tone(text)
    return FileResponse(output, media_type="audio/wav", filename=output.name)


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=9880)


if __name__ == "__main__":
    main()
