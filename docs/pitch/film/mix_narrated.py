"""Mix the optional narration over the score: the score ducks under the voice."""
import os
import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy.ndimage import maximum_filter1d, uniform_filter1d
from pedalboard import Pedalboard, HighpassFilter, Compressor, PeakFilter, HighShelfFilter, Reverb, Gain, Limiter

os.chdir(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
score, sr = sf.read("score.wav", dtype="float32"); assert sr == SR
vo, sr = sf.read("narration.wav", dtype="float32"); assert sr == SR
n = min(len(score), len(vo)); score, vo = score[:n], vo[:n]

voice = Pedalboard([HighpassFilter(85), Compressor(threshold_db=-24, ratio=3, attack_ms=5, release_ms=80),
                    PeakFilter(cutoff_frequency_hz=3200, gain_db=2.5, q=0.8), HighShelfFilter(cutoff_frequency_hz=10000, gain_db=1.5),
                    Reverb(room_size=0.25, wet_level=0.08, dry_level=1.0, damping=0.6), Gain(2)])
vo = voice(vo.T.copy(), SR).T

# ducking envelope from the voice: hold, then smooth
lvl = np.abs(vo).mean(1)
lvl = maximum_filter1d(lvl, int(0.25 * SR))
lvl = uniform_filter1d(lvl, int(0.12 * SR))
on = np.clip(lvl / 0.02, 0, 1)
duck = 1 - 0.5 * on          # about -6 dB under the voice
mix = score * duck[:, None] + vo * 1.0
meter = pyln.Meter(SR)
mix = Pedalboard([Limiter(threshold_db=-2.0, release_ms=100)])(mix.T.copy(), SR).T
l = meter.integrated_loudness(mix)
mix = mix * 10 ** ((-14.0 - l) / 20)
print("narrated mix LUFS", round(meter.integrated_loudness(mix), 2), "peak dBFS", round(20 * np.log10(np.abs(mix).max()), 2))
sf.write("score_narrated.wav", mix, SR, subtype="PCM_24")
