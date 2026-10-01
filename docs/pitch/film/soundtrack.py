"""Synthesize the NoX film soundtrack, synced to the cue list the page exports.

Music: a dark D-minor bed for the problem (0-24 s), a riser into the ignition at 24 s,
then a 120 BPM D-major build (D - A - Bm - G) under Atlas, the four seats and the
verification loop, resolving on D at 86 s. Sound effects come from cues.json.
"""
import json
import os
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

os.chdir(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
DUR = 90.0
N = int(SR * DUR)
rng = np.random.default_rng(42)

music = np.zeros((N, 2))
drums = np.zeros((N, 2))
sfx = np.zeros((N, 2))
verb_send = np.zeros((N, 2))


def note_hz(name):
    names = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6,
             "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
    p, o = name[:-1], int(name[-1])
    midi = 12 * (o + 1) + names[p]
    return 440.0 * 2 ** ((midi - 69) / 12)


def lp(x, f, order=2):
    sos = butter(order, min(f, SR / 2 * 0.95), btype="low", fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def hp(x, f, order=2):
    sos = butter(order, f, btype="high", fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def bp(x, lo, hi, order=2):
    sos = butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def add(buf, t0, sig, gain=1.0, pan=0.0, send=0.0):
    """Mix a mono or stereo signal into buf at time t0 (seconds)."""
    i = int(t0 * SR)
    if i >= N:
        return
    if sig.ndim == 1:
        l = np.sqrt(0.5 * (1 - pan)); r = np.sqrt(0.5 * (1 + pan))
        sig = np.stack([sig * l, sig * r], axis=1) * np.sqrt(2)
    j = min(N, i + len(sig))
    if i < 0:
        sig = sig[-i:]; i = 0
    buf[i:j] += sig[: j - i] * gain
    if send:
        verb_send[i:j] += sig[: j - i] * gain * send


def env_adsr(n, a, d, s, r):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    sus = max(0, n - a - d - r)
    e = np.concatenate([np.linspace(0, 1, max(a, 1)), np.linspace(1, s, max(d, 1)), np.full(sus, s), np.linspace(s, 0, max(r, 1))])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))


def saw(freq, dur, harm=14, detune=0.0):
    t = np.arange(int(dur * SR)) / SR
    f = freq * (1 + detune)
    out = np.zeros_like(t)
    ph = rng.uniform(0, 2 * np.pi)
    for k in range(1, harm + 1):
        if f * k > 12000:
            break
        out += np.sin(2 * np.pi * f * k * t + ph * k) / k
    return out * 0.55


# ---------------------------------------------------------------- music
def pad_chord(t0, dur, notes, gain, cutoff=1800, a=0.6, r=1.2, bright=False):
    n = int((dur + r) * SR)
    for i, nm in enumerate(notes):
        f = note_hz(nm)
        for side, det in ((-1, -0.004), (1, 0.0045)):
            s = saw(f, dur + r, harm=10 if not bright else 16, detune=det)
            s = s * env_adsr(n, a, 0.4, 0.8, r)
            pan = side * (0.35 + 0.1 * i)
            add(music, t0, lp(s, cutoff), gain / len(notes), pan=pan, send=0.5)


def sub_pulse(t0, f=46, gain=0.6, decay=0.45):
    n = int(0.6 * SR); t = np.arange(n) / SR
    fr = f + 40 * np.exp(-t / 0.03)
    s = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / decay)
    add(music, t0, s, gain)


def kick(t0, gain=0.9):
    n = int(0.5 * SR); t = np.arange(n) / SR
    fr = 48 + 110 * np.exp(-t / 0.035)
    s = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.28)
    click = hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.004) * 0.25
    add(drums, t0, np.tanh((s + click) * 1.4) * 0.9, gain)


def clap(t0, gain=0.35):
    n = int(0.35 * SR); t = np.arange(n) / SR
    e = np.zeros(n)
    for k, off in enumerate((0, 0.011, 0.022)):
        i = int(off * SR)
        e[i:] += np.exp(-(t[: n - i]) / (0.006 if k < 2 else 0.12))
    s = bp(rng.standard_normal(n), 900, 5200) * e
    s2 = bp(rng.standard_normal(n), 900, 5200) * e
    add(drums, t0, np.stack([s, s2], 1) * 0.6, gain, send=0.35)


def hat(t0, gain=0.12, open_=False):
    n = int((0.25 if open_ else 0.06) * SR); t = np.arange(n) / SR
    s = hp(rng.standard_normal(n), 7500) * np.exp(-t / (0.07 if open_ else 0.014))
    add(drums, t0, s, gain, pan=0.25)


def bass_note(t0, nm, dur, gain=0.5):
    f = note_hz(nm); n = int(dur * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * saw(f, dur, harm=6)
    s = np.tanh(s * 1.3) * env_adsr(n, 0.005, 0.08, 0.7, 0.05)
    add(music, t0, lp(s, 900), gain)


def pluck(t0, nm, gain=0.18, pan=0.0, dur=0.32):
    f = note_hz(nm); n = int(dur * SR); t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2 * f * t + 0.3) + 0.25 * np.sin(2 * np.pi * 3 * f * t)) * np.exp(-t / 0.09)
    s = lp(s, 4500)
    add(music, t0, s, gain, pan=pan, send=0.4)
    # ping-pong delay (dotted eighth)
    for k, p in ((1, -0.7), (2, 0.7), (3, -0.5)):
        add(music, t0 + 0.375 * k, s, gain * (0.38 ** k), pan=p, send=0.3)


# Problem section: D minor, heartbeat + clock
PRE = [(0, 6, ["D3", "A3", "E4", "F4"]), (6, 4, ["D3", "A3", "F4", "C5"]), (10, 4, ["Bb2", "F3", "D4", "A4"]),
       (14, 4, ["G2", "D3", "Bb3", "F4"]), (18, 4, ["A2", "E3", "G3", "C#4"]), (22, 1.8, ["A2", "E3", "A3", "C#4"])]
for t0, d, ch in PRE:
    pad_chord(t0, d, ch, 0.16 if t0 else 0.12, cutoff=1100 if t0 < 6 else 1500, a=1.0 if t0 == 0 else 0.5, r=1.0)
# low drone
n = int(23.8 * SR); tt = np.arange(n) / SR
drone = (np.sin(2 * np.pi * note_hz("D2") * tt) * 0.6 + 0.3 * np.sin(2 * np.pi * note_hz("A2") * tt)) * np.minimum(1, tt / 3) * np.minimum(1, (23.8 - tt) / 0.4)
add(music, 0, lp(drone, 400), 0.15)
for k in range(6, 22):
    sub_pulse(k, gain=0.34 + 0.016 * (k - 6))
    sub_pulse(k + 0.22, gain=0.22 + 0.01 * (k - 6))
for k in range(int((22 - 6) / 0.25)):
    tk = 6 + k * 0.25
    hat(tk, gain=0.035 + (0.02 if k % 2 else 0), open_=False)

# Main section from the ignition at 24 s: 120 BPM, D - A - Bm - G
BEAT = 0.5
PROG = [("D", ["D3", "F#3", "A3", "E4"], ["D", "F#", "A", "D", "E", "A"]),
        ("A", ["C#3", "E3", "A3", "B3"], ["A", "C#", "E", "A", "B", "E"]),
        ("B", ["B2", "D3", "F#3", "A3"], ["B", "D", "F#", "B", "C#", "F#"]),
        ("G", ["G2", "B2", "D3", "F#3"], ["G", "B", "D", "G", "A", "D"])]
BASS = {"D": "D2", "A": "A1", "B": "B1", "G": "G1"}
t = 24.0
bar = 0
while t < 86.0 - 1e-6:
    name, chord, arp = PROG[bar % 4]
    full = t >= 30.0
    pad_chord(t, 2.0, chord, 0.2 if full else 0.24, cutoff=2400 if full else 1700, a=0.08 if t > 24 else 0.02, r=0.6, bright=full)
    for b in range(4):
        tb = t + b * BEAT
        if tb >= 86:
            break
        in_break = 69.5 <= tb < 70.0 or 77.5 <= tb < 78.0
        if (full or b % 2 == 0) and not in_break:
            kick(tb, 0.85 if full else 0.6)
        if tb >= 46.0 and b in (1, 3) and not in_break:
            clap(tb, 0.3)
        if tb >= 42.0 and not in_break:
            hat(tb + BEAT / 2, 0.1, open_=(b == 3))
            hat(tb + BEAT / 4, 0.05)
            hat(tb + 3 * BEAT / 4, 0.05)
        # bass on eighths
        if t >= 30.0 or b % 2 == 0:
            for e in range(2):
                bass_note(tb + e * BEAT / 2, BASS[name], BEAT / 2 * 0.9, 0.34 if full else 0.28)
    # arp on sixteenths from the Atlas on
    if t >= 30.0:
        oct_ = 5 if t >= 46 else 4
        for k in range(16):
            tk = t + k * BEAT / 4
            if tk >= 86:
                break
            nm = arp[k % len(arp)] + str(oct_ + (1 if k % 8 >= 6 else 0))
            pluck(tk, nm, gain=0.075 if t < 46 else 0.09, pan=-0.4 if k % 2 else 0.4)
    t += 2.0
    bar += 1

# Ending: resolve on D with a long tail
pad_chord(86.0, 3.0, ["D3", "A3", "D4", "F#4", "E5"], 0.3, cutoff=2800, a=0.05, r=1.0, bright=True)
bass_note(86.0, "D2", 2.5, 0.4)
kick(86.0, 0.9)
pad_chord(88.1, 1.5, ["D4", "A4", "F#5", "A5"], 0.16, cutoff=5000, a=0.02, r=0.4, bright=True)

# sidechain pump on the music bus (from kicks)
pump = np.ones(N)
for tk in np.arange(30.0, 86.0, BEAT):
    if 69.5 <= tk < 70.0 or 77.5 <= tk < 78.0:
        continue
    i = int(tk * SR); m = min(N - i, int(0.4 * SR))
    tt = np.arange(m) / SR
    pump[i:i + m] = np.minimum(pump[i:i + m], 1 - 0.45 * np.exp(-tt / 0.11))
music *= pump[:, None]


# ---------------------------------------------------------------- sound effects
def varlp_noise(dur, f0, f1, curve=2.0):
    """Noise through a one-pole low-pass whose cutoff sweeps f0 -> f1 (log)."""
    n = int(dur * SR)
    x = rng.standard_normal(n)
    u = np.linspace(0, 1, n) ** curve
    fc = f0 * (f1 / f0) ** u
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty(n); z = 0.0
    for i in range(n):
        z = (1 - a[i]) * x[i] + a[i] * z
        y[i] = z
    return y


def whoosh(t0, d=0.6, soft=False):
    d = max(0.35, d)
    n = int(d * SR)
    up = varlp_noise(d, 300, 5500, 1.0)
    e = np.sin(np.linspace(0, np.pi, n)) ** 2
    s = hp(up, 180) * e
    pan = np.linspace(-0.6, 0.6, n)
    st = np.stack([s * np.sqrt(0.5 * (1 - pan)), s * np.sqrt(0.5 * (1 + pan))], 1) * 1.4
    add(sfx, t0 - d * 0.15, st, 0.16 if soft else 0.3, send=0.3)


def pop(t0, gain=0.22):
    n = int(0.09 * SR); t = np.arange(n) / SR
    f = 900 * np.exp(-t / 0.05) + 380
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.025)
    add(sfx, t0, s, gain, pan=rng.uniform(-0.3, 0.3), send=0.2)


def tick(t0, gain=0.14):
    n = int(0.03 * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * 2400 * t) * np.exp(-t / 0.005) + bp(rng.standard_normal(n), 3000, 9000) * np.exp(-t / 0.003) * 0.4
    add(sfx, t0, s, gain, pan=rng.uniform(-0.4, 0.4), send=0.1)


def key_click(t0, gain, bright=False):
    n = int(0.03 * SR); t = np.arange(n) / SR
    body = bp(rng.standard_normal(n), 1500 if not bright else 2600, 5000 if not bright else 9000) * np.exp(-t / 0.004)
    thump = np.sin(2 * np.pi * (180 if not bright else 900) * t) * np.exp(-t / 0.008) * 0.5
    add(sfx, t0, body + thump, gain, pan=rng.uniform(-0.25, 0.25))


def typing(t0, d, n_chars, human):
    count = max(3, int(n_chars * (1.0 if human else 0.55)))
    times = np.sort(t0 + rng.uniform(0, d, count))
    for tk in times:
        key_click(tk, (0.16 if human else 0.07) * rng.uniform(0.6, 1.0), bright=not human)


def bell(t0, f, gain=0.16, pan=0.0, decay=1.2):
    n = int(decay * 2 * SR); t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * t) * np.exp(-t / decay) + 0.45 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / (decay * 0.5))
         + 0.25 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t / (decay * 0.3)) + 0.12 * np.sin(2 * np.pi * f * 4.2 * t) * np.exp(-t / (decay * 0.2)))
    s *= np.minimum(1, t / 0.002)
    add(sfx, t0, s, gain, pan=pan, send=0.45)


DING = ["D5", "F#5", "A5", "B5", "D6", "E6"]


def impact(t0, soft=False):
    n = int(2.6 * SR); t = np.arange(n) / SR
    f = 30 + 55 * np.exp(-t / 0.18)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.9 if not soft else 0.5))
    nz = lp(rng.standard_normal(n), 1800) * np.exp(-t / 0.25) * 0.5
    crack = hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.05) * 0.35
    s = np.tanh((boom + nz + crack) * 1.5)
    add(sfx, t0, s, 0.55 if not soft else 0.32, send=0.6)


def riser(t0, d):
    n = int(d * SR); t = np.arange(n) / SR
    nz = varlp_noise(d, 200, 9000, 2.2) * (t / d) ** 2
    f = 110 * (8 ** (t / d))
    tone = (np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.5 * np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR)) * (t / d) ** 2.5 * 0.4
    s = hp(nz, 150) + tone
    s[-int(0.15 * SR):] *= np.linspace(1, 0, int(0.15 * SR))
    add(sfx, t0, s, 0.32, send=0.5)


def glitch(t0, d):
    d = max(0.12, d)
    n = int(d * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    step = int(0.022 * SR)
    for i in range(0, n, step):
        f = rng.choice([220, 330, 440, 660, 880, 1320, 1760])
        seg = np.sign(np.sin(2 * np.pi * f * t[i:i + step])) * 0.5 + rng.standard_normal(min(step, n - i)) * 0.3
        s[i:i + step] = seg * (rng.uniform() > 0.25)
    s = np.round(s * 6) / 6  # bit crush
    s *= np.minimum(1, (d - t) / 0.01)
    add(sfx, t0, lp(s, 6000), 0.09, pan=rng.uniform(-0.5, 0.5))


def hit(t0):
    n = int(0.8 * SR); t = np.arange(n) / SR
    f = 50 + 70 * np.exp(-t / 0.05)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.3) + lp(rng.standard_normal(n), 2500) * np.exp(-t / 0.06) * 0.5
    add(sfx, t0, np.tanh(s * 1.4), 0.38, send=0.4)


def click(t0):
    n = int(0.05 * SR); t = np.arange(n) / SR
    s = bp(rng.standard_normal(n), 1800, 7000) * np.exp(-t / 0.006) + np.sin(2 * np.pi * 1200 * t) * np.exp(-t / 0.01) * 0.4
    add(sfx, t0, s, 0.3)


def alert(t0):
    for k, f in enumerate((988, 740)):
        n = int(0.12 * SR); t = np.arange(n) / SR
        s = lp(np.sign(np.sin(2 * np.pi * f * t)), 3000) * env_adsr(n, 0.004, 0.02, 0.7, 0.04)
        add(sfx, t0 + k * 0.13, s, 0.08, send=0.3)


def error(t0):
    for k, f in enumerate((330, 247)):
        n = int(0.16 * SR); t = np.arange(n) / SR
        s = lp(saw(f, 0.16, harm=8), 2500) * env_adsr(n, 0.004, 0.03, 0.8, 0.05)
        add(sfx, t0 + k * 0.15, s, 0.2, send=0.3)


def success(t0, soft=False):
    for k, nm in enumerate(["D5", "F#5", "A5", "D6"]):
        bell(t0 + k * 0.07, note_hz(nm), 0.1 if soft else 0.14, pan=-0.3 + 0.2 * k, decay=1.0)


def count(t0, d):
    k = 0; tk = t0
    while tk < t0 + d:
        u = (tk - t0) / d
        n = int(0.025 * SR); t = np.arange(n) / SR
        s = np.sin(2 * np.pi * (1200 + 1400 * u) * t) * np.exp(-t / 0.006)
        add(sfx, tk, s, 0.08)
        tk += 0.11 * (1 - 0.7 * u) + 0.02
        k += 1
    bell(t0 + d, note_hz("A5"), 0.12)


def shimmer(t0, d):
    n = int((d + 1) * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for f in (note_hz("A6"), note_hz("D7"), note_hz("F#7"), note_hz("E7")):
        s += np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * (0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(5, 9) * t))
    s *= np.sin(np.linspace(0, np.pi, n)) ** 2
    add(sfx, t0, s, 0.025, send=0.6)


cues = json.load(open("cues.json"))
for c in cues:
    ty, t0 = c["type"], c["t"]
    if ty == "whoosh": whoosh(t0, c.get("d", 0.6), c.get("soft", False))
    elif ty == "pop": pop(t0)
    elif ty == "tick": tick(t0)
    elif ty == "typeH": typing(t0, c["d"], c["n"], True)
    elif ty == "typeA": typing(t0, c["d"], c["n"], False)
    elif ty == "ding": bell(t0, note_hz(DING[c.get("note", 0) % len(DING)]), 0.13, pan=rng.uniform(-0.3, 0.3))
    elif ty == "impact": impact(t0, c.get("soft", False))
    elif ty == "riser": riser(t0, c["d"])
    elif ty == "glitch": glitch(t0, c.get("d", 0.3))
    elif ty == "hit": hit(t0)
    elif ty == "click": click(t0)
    elif ty == "alert": alert(t0)
    elif ty == "error": error(t0)
    elif ty == "success": success(t0, c.get("soft", False))
    elif ty == "count": count(t0, c["d"])
    elif ty == "shimmer": shimmer(t0, c.get("d", 1))

# ---------------------------------------------------------------- reverb + mix
ir_n = int(2.8 * SR); ti = np.arange(ir_n) / SR
ir = np.stack([rng.standard_normal(ir_n), rng.standard_normal(ir_n)], 1) * np.exp(-ti / 0.7)[:, None]
ir = lp(ir, 6000)
ir[: int(0.012 * SR)] = 0
ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([fftconvolve(verb_send[:, 0], ir[:, 0])[:N], fftconvolve(verb_send[:, 1], ir[:, 1])[:N]], 1)

mix = music * 0.55 + drums * 0.62 + sfx * 1.0 + wet * 0.35
mix = hp(mix, 36)
# fade in / out
fi = int(0.4 * SR); mix[:fi] *= np.linspace(0, 1, fi)[:, None]
fo = int(1.2 * SR); mix[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
# gentle bus compression via soft clip, then normalise
peak = np.abs(mix).max()
mix = mix / peak * 1.6
mix = np.tanh(mix) / np.tanh(1.6)
mix *= 10 ** (-1.0 / 20)

import wave
pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2")
with wave.open("soundtrack.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

# loudness report per section
for a, b in [(0, 6), (6, 16), (16, 24), (24, 30), (30, 46), (46, 70), (70, 78), (78, 86), (86, 90)]:
    seg = mix[int(a * SR):int(b * SR)]
    print(f"{a:>4}-{b:<4} rms {20*np.log10(np.sqrt((seg**2).mean())+1e-9):6.1f} dBFS  peak {20*np.log10(np.abs(seg).max()+1e-9):5.1f}")
