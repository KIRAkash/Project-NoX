"""Optional narration for the NoX film, spoken by Kokoro (an open neural TTS model).

Each line has a slot on the timeline. A line is synthesised, measured, and sped up a
little if it would overrun its slot; it is then placed at its start time. The result is
narration.wav (48 kHz stereo) plus narration.json with the placed times.
"""
import json, os
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from kokoro_onnx import Kokoro

os.chdir(os.path.dirname(os.path.abspath(__file__)))
VOICE = os.environ.get("NOX_VOICE", "af_heart")
SR = 48000
N = int(90.0 * SR)

LINES = [
    (0.9, 5.2, "Every change in a company starts as one sentence."),
    (6.4, 13.3, "Then it travels. A ticket. A guess. A day in the code."),
    (13.9, 15.9, "And what ships isn't what was meant."),
    (16.2, 21.6, "Everyone has AI now. But each seat has its own chat, and nobody shares the context."),
    (25.2, 26.5, "This is Nox."),
    (27.0, 29.8, "A living map, and the journey every change takes."),
    (30.4, 36.6, "The Atlas turns every application into a cited code wiki, built from your code, docs and tickets."),
    (37.0, 41.4, "Written by a team of Gemini agents, and kept true on every push."),
    (42.3, 45.4, "Then one mission carries a change through four seats."),
    (46.5, 51.0, "The business user asks in plain words. Nox drafts. They approve."),
    (52.4, 57.0, "The product owner adds an edge case. Nox co-writes, grounded in the map."),
    (58.5, 62.6, "The engineering lead sees every caller before a contract changes."),
    (64.4, 69.0, "And the developer runs one command. Any coding agent gets the whole mission."),
    (70.4, 73.0, "Then it comes back, through the same people."),
    (73.4, 75.1, "Anything unmet goes straight back."),
    (75.2, 76.6, "Until the one who asked can say,"),
    (76.7, 78.3, "my sentence is now true."),
    (78.6, 81.8, "Shielded, connected and measured, on Google Cloud."),
    (82.5, 85.6, "People own every decision. Every claim is cited."),
    (85.95, 89.6, "Four people. Four files. One sentence, all the way to code and back."),
]

kok = Kokoro("tts/kokoro-v1.0.onnx", "tts/voices-v1.0.bin")
out = np.zeros(N, np.float32)
placed = []
for t0, t1, text in LINES:
    slot = t1 - t0
    speed = 1.0
    for _ in range(6):
        audio, sr = kok.create(text, voice=VOICE, speed=speed, lang="en-us")
        # trim the model's leading/trailing silence
        a = np.asarray(audio, np.float32)
        nz = np.where(np.abs(a) > 0.01)[0]
        a = a[max(0, nz[0] - int(0.02 * sr)): nz[-1] + int(0.08 * sr)] if len(nz) else a
        dur = len(a) / sr
        if dur <= slot or speed >= 1.18:
            break
        speed = min(1.18, speed * dur / slot * 1.02)
    y = resample_poly(a, SR, sr).astype(np.float32)
    i = int(t0 * SR)
    j = min(N, i + len(y))
    out[i:j] += y[: j - i]
    placed.append({"t": t0, "end": round(t0 + len(y) / SR, 2), "slot_end": t1, "speed": round(speed, 3), "text": text})
    print(f"{t0:5.1f}-{t0 + len(y) / SR:5.1f} (slot {t1:5.1f}) x{speed:.2f}  {text}")

sf.write("narration.wav", np.stack([out, out], 1), SR, subtype="PCM_24")
json.dump(placed, open("narration.json", "w"), indent=1)
print("wrote narration.wav")
