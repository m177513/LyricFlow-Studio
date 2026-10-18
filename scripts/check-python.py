"""Offline runtime smoke check; no model downloads or user audio required."""
import io
import json
import wave

from faster_whisper.audio import decode_audio
from audio_separator.separator import Separator
import torch

sample = io.BytesIO()
with wave.open(sample, "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(16000)
    wav.writeframes(b"\x00\x00" * 1600)
sample.seek(0)
decoded = decode_audio(sample, sampling_rate=16000)
assert len(decoded) == 1600, "Whisper audio decoding failed"
print(json.dumps({"whisperDecode": True, "separatorImport": True, "torch": torch.__version__}))
