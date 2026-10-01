"""The NoX film score and sound design, synced to the timeline's cues.json.

Orchestral parts are written as MIDI and played by FluidSynth on the MuseScore General
soundfont; drums, bass, synth layers and sound effects are synthesized with numpy; effects
and mastering use Spotify's pedalboard; loudness is normalised to -14 LUFS.

Act I (0-24 s, D minor): a lone piano motif, a ticking string ostinato through the
telephone hops (the motif detunes a little more at each hop), a dissonant stab on the ≠,
tension and a riser into silence. Act II (24-70 s, D major, 120 BPM): the ignition hit,
then an orchestral-electronic groove under the Atlas, the trajectory theme and the four
seats. Act III (70-90 s, E major): the return journey, the climax on "My sentence is now
true", and the opening motif reprised in major.
"""
import json, os, subprocess, tempfile
import numpy as np
import pretty_midi
import soundfile as sf
import pyloudnorm as pyln
from scipy.signal import butter, sosfilt, fftconvolve
from pedalboard import Pedalboard, Reverb, Compressor, Limiter, HighpassFilter, LowpassFilter, Delay, Chorus, Distortion, Gain, LowShelfFilter, HighShelfFilter, Bitcrush

os.chdir(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
DUR = 90.0
N = int(SR * DUR)
SF2 = next(p for p in ["/usr/share/sounds/sf2/MuseScore_General_Full.sf2", "/usr/share/sounds/sf2/FluidR3_GM.sf2", "/usr/share/sounds/sf2/default-GM.sf2"] if os.path.exists(p))
rng = np.random.default_rng(7)
BEAT = 0.5

def nn(name):
    return pretty_midi.note_name_to_number(name)

def hz(name):
    return 440.0 * 2 ** ((nn(name) - 69) / 12)

# ------------------------------------------------------------------ MIDI parts
PARTS = {}
def part(name, program):
    PARTS.setdefault(name, {"program": program, "notes": [], "bends": []})
    return PARTS[name]

def play(name, program, t, d, pitches, vel):
    p = part(name, program)
    for pt in (pitches if isinstance(pitches, (list, tuple)) else [pitches]):
        p["notes"].append(pretty_midi.Note(velocity=int(np.clip(vel, 1, 127)), pitch=nn(pt) if isinstance(pt, str) else pt, start=max(0, t), end=t + d))

def bend(name, t, value):
    PARTS[name]["bends"].append(pretty_midi.PitchBend(pitch=int(value), time=t))

PIANO, STR, CELLO, CHOIR, BRASS, PIZZ, CELESTA, TIMP, HORN = 0, 48, 42, 52, 61, 45, 8, 47, 60

CH = {
    "Dm": ["D3", "A3", "F4", "E4"], "Bb": ["Bb2", "F3", "D4", "C4"], "Gm": ["G2", "D3", "Bb3", "F4"], "A7b9": ["A2", "E3", "C#4", "G3", "Bb3"],
    "Eb": ["Eb3", "Bb3", "G4"], "Asus": ["A2", "E3", "D4", "A3"], "A": ["A2", "E3", "C#4", "A3"],
    "D": ["D3", "A3", "F#4", "E4"], "A/C#": ["C#3", "E3", "A3", "B3"], "Bm": ["B2", "F#3", "D4", "A3"], "G": ["G2", "D3", "B3", "F#4"],
    "E": ["E3", "B3", "G#4", "F#4"], "B": ["B2", "F#3", "D#4", "C#4"], "C#m": ["C#3", "G#3", "E4", "B3"], "Amaj": ["A2", "E3", "C#4", "G#3"],
}
ROOT = {"Dm": "D", "Bb": "Bb", "Gm": "G", "A7b9": "A", "Eb": "Eb", "Asus": "A", "A": "A", "D": "D", "A/C#": "C#", "Bm": "B", "G": "G", "E": "E", "B": "B", "C#m": "C#", "Amaj": "A"}

def shift(p, octs):
    n = nn(p) + 12 * octs
    return pretty_midi.note_number_to_name(n)

# ---- Act I: one sentence (0-6) ----
for t, d, p, v in [(0.55, 0.8, "D5", 52), (1.30, 0.55, "F5", 48), (1.80, 1.35, "A5", 56), (3.15, 0.42, "G5", 46), (3.55, 0.42, "F5", 44), (3.95, 1.9, "E5", 50)]:
    play("piano", PIANO, t, d, p, v)
play("piano", PIANO, 0.55, 2.6, ["D3", "A3"], 40); play("piano", PIANO, 3.15, 2.9, ["Bb2", "F3"], 38)
play("strings", STR, 0.3, 5.9, ["D3", "A3", "F4"], 34)
play("piano", PIANO, 4.35, 1.8, ["A5", "D6"], 34)   # the idea lands

# ---- telephone (6-14) ----
TEL = [(6.0, "Dm", "D2"), (8.0, "Bb", "Bb1"), (10.0, "Gm", "G1"), (12.0, "A7b9", "A1")]
for t0, ch, low in TEL:
    end = min(t0 + 2.0, 13.4)
    play("strings", STR, t0, end - t0 + 0.15, CH[ch], 52 + (t0 - 6) * 2)
    k = 0
    tt = t0
    while tt < end - 1e-6:
        p = low if k % 2 == 0 else shift(low, 1)
        play("cello", CELLO, tt, 0.18, p, 74 + (12 if k % 4 == 0 else 0) + int((t0 - 6) * 2))
        tt += 0.25; k += 1
# the motif, a little more broken at each hop
HOPS = [7.4, 9.0, 10.6, 12.2]
for i, h in enumerate(HOPS):
    notes = ["D5", "F5", "A5"] if i < 2 else ["D5", "F5", "Ab5"] if i == 2 else ["D5", "Eb5", "Ab5"]
    for j, p in enumerate(notes):
        play("piano_decay", PIANO, h + 0.35 + j * 0.16, 0.5, p, 60 - i * 4)
# pitch drift on the decaying piano: more each hop
part("piano_decay", PIANO)
for i, h in enumerate(HOPS):
    bend("piano_decay", h + 0.3, -[0, 500, 1100, 1900][i])
    bend("piano_decay", h + 1.2, 0)
# the ≠ stab
play("brass", BRASS, 14.0, 0.9, ["D2", "Eb2", "A2"], 110)
play("timp", TIMP, 14.0, 1.6, ["D2"], 120)
play("piano", PIANO, 14.0, 2.0, ["D1", "Eb1", "A1"], 96)
play("strings", STR, 14.25, 1.9, ["D3", "Eb4"], 40)

# ---- AI everywhere (16-24) ----
for t0, ch in [(16.0, "Gm"), (18.0, "Eb"), (20.0, "Asus")]:
    play("strings", STR, t0, 2.05, CH[ch], 58 + (t0 - 16) * 3)
    tt = t0; k = 0
    while tt < t0 + 2 - 1e-6:
        play("cello", CELLO, tt, 0.18, shift(ROOT[ch] + "2", 0) if k % 2 == 0 else ROOT[ch] + "3", 78 + int((t0 - 16) * 3) + (10 if k % 4 == 0 else 0))
        tt += 0.25; k += 1
for h in (20.05, 20.6, 21.15):
    play("timp", TIMP, h, 0.8, ["A1"], 110)
    play("brass", BRASS, h, 0.35, ["A2", "E3"], 100)
# strings tremolo crescendo on the dominant into the drop
tt = 22.0; k = 0
while tt < 23.78:
    v = 50 + (tt - 22.0) / 1.8 * 70
    play("strings_trem", STR, tt, 0.13, ["A2", "E3", "A3", "C#4", "E4"], v)
    tt += 0.125; k += 1

# ---- Act II: the ignition (24) and D major ----
PROG_D = ["D", "A/C#", "Bm", "G"]
PROG_E = ["E", "B", "C#m", "Amaj"]
def chord_at(t):
    if t < 70:
        return PROG_D[int((t - 24) // 2) % 4]
    return PROG_E[int((t - 70) // 2) % 4]

play("brass", BRASS, 24.0, 2.2, ["D3", "A3", "D4", "F#4"], 118)
play("horn", HORN, 24.0, 2.4, ["D4", "A4"], 100)
play("choir", CHOIR, 24.0, 4.0, ["D4", "F#4", "A4"], 90)
play("timp", TIMP, 24.0, 2.0, ["D2"], 127)
play("timp", TIMP, 24.0, 2.0, ["A1"], 110)
for b in range(24, 86, 2):
    ch = chord_at(b)
    if 69.5 <= b < 70:
        continue
    vel = 78 if b < 30 else 60 if b < 46 else 64 if b < 70 else 70
    play("strings", STR, b, 2.02, CH[ch], vel)
    if b >= 76 or b < 28:
        play("choir", CHOIR, b, 2.02, [shift(x, 1) for x in CH[ch][:3]], 70 if b >= 76 else 64)
# piano cascade under the logo (24-30)
for b in (24, 26, 28):
    ch = CH[chord_at(b)]
    pitches = [shift(x, 1) for x in ch] + [shift(x, 2) for x in ch]
    for k in range(16):
        play("piano", PIANO, b + k * 0.125, 0.4, pitches[k % len(pitches)], 46 + (k % 4 == 0) * 10)
# pizzicato arp from the Atlas on
for b in range(30, 86, 2):
    if 69.5 <= b < 70:
        continue
    ch = CH[chord_at(b)]
    pat = [ch[0], ch[1], ch[2], ch[1], shift(ch[0], 1), ch[2], ch[1], ch[2]]
    for k in range(8):
        t = b + k * 0.25
        if 73.2 <= t < 73.7 or 77.5 <= t < 78.0:
            continue
        play("pizz", PIZZ, t, 0.2, shift(pat[k], 1), 70 + (k % 2 == 0) * 12)

# the trajectory theme (four bars over the progression), played at 42 and through the seats
THEME = [(0, 0.5, "A4"), (0.5, 0.5, "D5"), (1.0, 0.5, "F#5"), (1.5, 0.5, "A5"),
         (2.0, 0.75, "G5"), (2.75, 0.25, "F#5"), (3.0, 1.0, "E5"),
         (4.0, 0.5, "F#5"), (4.5, 0.5, "D5"), (5.0, 0.5, "B4"), (5.5, 0.5, "D5"),
         (6.0, 0.5, "E5"), (6.5, 0.5, "D5"), (7.0, 1.0, "A4")]
def theme(t0, inst, prog, vel, transpose=0, octave=0):
    for dt, d, p in THEME:
        play(inst, prog, t0 + dt, d * 0.95, pretty_midi.note_number_to_name(nn(p) + transpose + 12 * octave), vel)
theme(42.0, "celesta", CELESTA, 92, octave=1); theme(42.0, "piano", PIANO, 70)
theme(50.0, "piano", PIANO, 62)
theme(58.0, "celesta", CELESTA, 80, octave=1)
theme(62.0, "horn", HORN, 62, octave=-1)
# Act III: the theme in E, on the climax
theme(76.0, "strings_hi", STR, 92, transpose=2, octave=1)
theme(76.0, "piano", PIANO, 76, transpose=2, octave=1)
theme(78.0, "horn", HORN, 76, transpose=2)
# the send-back stab, and the climax hit
play("brass", BRASS, 73.2, 0.5, ["E3", "F3", "Bb3"], 105)
play("timp", TIMP, 73.2, 0.8, ["E2"], 100)
play("brass", BRASS, 76.25, 1.9, ["E3", "B3", "E4", "G#4"], 118)
play("timp", TIMP, 76.25, 1.8, ["E2"], 127)
play("choir", CHOIR, 76.25, 2.0, ["E4", "G#4", "B4", "E5"], 100)
# close: the opening motif, now in E major, and the final chord
for t, d, p, v in [(86.1, 0.75, "E5", 64), (86.85, 0.5, "G#5", 60), (87.35, 1.4, "B5", 66), (88.1, 2.0, "E6", 58)]:
    play("piano", PIANO, t, d, p, v)
play("piano", PIANO, 86.1, 3.8, ["E3", "B3"], 52)
play("strings", STR, 86.0, 4.0, ["E3", "B3", "G#4", "F#4"], 66)
play("choir", CHOIR, 88.1, 1.9, ["E4", "B4", "G#5"], 72)
play("celesta", CELESTA, 88.1, 1.8, ["B6", "E7"], 60)

# ------------------------------------------------------------------ render MIDI stems
def render(name):
    p = PARTS[name]
    pm = pretty_midi.PrettyMIDI(initial_tempo=120)
    ins = pretty_midi.Instrument(program=p["program"])
    ins.notes = sorted(p["notes"], key=lambda n: n.start)
    ins.pitch_bends = sorted(p["bends"], key=lambda b: b.time)
    pm.instruments.append(ins)
    with tempfile.TemporaryDirectory() as d:
        mid, wav = os.path.join(d, "p.mid"), os.path.join(d, "p.wav")
        pm.write(mid)
        subprocess.run(["fluidsynth", "-ni", "-q", "-R", "0", "-C", "0", "-g", "0.7", "-r", str(SR), "-F", wav, SF2, mid], check=True)
        x, sr = sf.read(wav, dtype="float32")
    assert sr == SR
    out = np.zeros((N, 2), np.float32)
    m = min(N, len(x)); out[:m] = x[:m]
    return out

stems = {name: render(name) for name in PARTS}
def wrms(x, a, b): seg = x[int(a * SR):int(b * SR)]; return round(float(20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9)), 1)
WIN = {"piano": (0.5, 5.5), "strings": (6, 13), "cello": (6, 13), "piano_decay": (7.7, 8.4), "brass": (24, 26), "timp": (24, 25), "strings_trem": (22, 23.7), "horn": (62, 70), "choir": (76, 78), "pizz": (30, 46), "celesta": (42, 50), "strings_hi": (76, 84)}
print("in-section rms dB:", {k: wrms(stems[k], *WIN[k]) for k in stems})

def fx(x, board):
    return board(x.T.copy(), SR).T

def verb(size=0.8, wet=0.3, damp=0.4, width=1.0):
    return Reverb(room_size=size, wet_level=wet, dry_level=1.0 - wet * 0.5, damping=damp, width=width)

stems["piano"] = fx(stems["piano"], Pedalboard([Gain(12), HighpassFilter(60), Compressor(threshold_db=-22, ratio=2, attack_ms=10, release_ms=200), verb(0.85, 0.32)]))
stems["piano_decay"] = fx(stems["piano_decay"], Pedalboard([Gain(7), Bitcrush(bit_depth=9), LowpassFilter(5000), verb(0.85, 0.35)]))
for s_, g in (("strings", 2), ("strings_trem", 16), ("strings_hi", 5)):
    stems[s_] = fx(stems[s_], Pedalboard([HighpassFilter(55), verb(0.92, 0.35, 0.5), Gain(g)]))
stems["cello"] = fx(stems["cello"], Pedalboard([HighpassFilter(45), Compressor(threshold_db=-18, ratio=2.5), verb(0.7, 0.2), Gain(6)]))
stems["choir"] = fx(stems["choir"], Pedalboard([HighpassFilter(120), verb(0.95, 0.42), Gain(-1)]))
stems["brass"] = fx(stems["brass"], Pedalboard([verb(0.85, 0.28), Gain(1)]))
stems["horn"] = fx(stems["horn"], Pedalboard([Gain(4), verb(0.9, 0.32)]))
stems["timp"] = fx(stems["timp"], Pedalboard([LowShelfFilter(cutoff_frequency_hz=120, gain_db=4), verb(0.85, 0.3), Gain(4)]))
stems["pizz"] = fx(stems["pizz"], Pedalboard([HighpassFilter(150), Delay(delay_seconds=0.375, feedback=0.28, mix=0.22), verb(0.7, 0.22), Gain(5)]))
stems["celesta"] = fx(stems["celesta"], Pedalboard([Gain(5), Delay(delay_seconds=0.375, feedback=0.3, mix=0.25), verb(0.9, 0.38)]))

# ------------------------------------------------------------------ synthesized layers
def lp(x, f, order=2): return sosfilt(butter(order, min(f, SR * 0.45), btype="low", fs=SR, output="sos"), x, axis=0)
def hp(x, f, order=2): return sosfilt(butter(order, f, btype="high", fs=SR, output="sos"), x, axis=0)
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x, axis=0)

def add(buf, t0, sig, gain=1.0, pan=0.0):
    i = int(round(t0 * SR))
    if i >= N or i + len(sig) <= 0: return
    if sig.ndim == 1:
        l, r = np.sqrt(0.5 * (1 - pan)), np.sqrt(0.5 * (1 + pan))
        sig = np.stack([sig * l, sig * r], 1) * np.sqrt(2)
    if i < 0: sig = sig[-i:]; i = 0
    j = min(N, i + len(sig))
    buf[i:j] += sig[: j - i] * gain

drums = np.zeros((N, 2), np.float32)
bass = np.zeros((N, 2), np.float32)
synth = np.zeros((N, 2), np.float32)
sfx = np.zeros((N, 2), np.float32)

def kick(t0, g=1.0):
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = 46 + 120 * np.exp(-t / 0.03)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.26)
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.003) * 0.3
    add(drums, t0, np.tanh((s + click) * 1.6) * 0.95, g)

def clap(t0, g=0.4):
    n = int(0.4 * SR); t = np.arange(n) / SR
    e = np.zeros(n)
    for k, off in enumerate((0, 0.009, 0.019, 0.03)):
        i = int(off * SR); e[i:] += np.exp(-t[: n - i] / (0.005 if k < 3 else 0.11))
    l = bp(rng.standard_normal(n), 900, 6000) * e; r = bp(rng.standard_normal(n), 900, 6000) * e
    add(drums, t0, np.stack([l, r], 1) * 0.55, g)

def hat(t0, g=0.1, open_=False, pan=0.2):
    n = int((0.3 if open_ else 0.06) * SR); t = np.arange(n) / SR
    s = hp(rng.standard_normal(n), 7000) * np.exp(-t / (0.08 if open_ else 0.013))
    add(drums, t0, s, g, pan)

def snare(t0, g=0.3):
    n = int(0.25 * SR); t = np.arange(n) / SR
    s = bp(rng.standard_normal(n), 1500, 7000) * np.exp(-t / 0.06) + np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.04) * 0.6
    add(drums, t0, s, g)

def crash(t0, g=0.4, dur=2.6):
    n = int(dur * SR); t = np.arange(n) / SR
    noise = hp(rng.standard_normal((n, 2)), 4500) * np.exp(-t / 0.9)[:, None]
    ring = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) for f in (3120, 4470, 5530, 6920, 8340)) * np.exp(-t / 0.7) * 0.05
    add(drums, t0, noise * 0.5 + ring[:, None], g)

def reverse_cymbal(t_end, dur=1.4, g=0.35):
    n = int(dur * SR); t = np.arange(n) / SR
    s = hp(rng.standard_normal((n, 2)), 3500) * ((t / dur) ** 3)[:, None]
    add(sfx, t_end - dur, s, g)

def sub(t0, d, note, g=0.5):
    f = hz(note); n = int(d * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t)
    env = np.minimum(1, t / 0.008) * np.minimum(1, (d - t) / 0.03)
    add(bass, t0, np.tanh(s * 1.4) * env * 0.8, g)

def supersaw(t0, d, notes, g=0.12, cutoff=3200):
    n = int((d + 0.6) * SR); t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for nt in notes:
        f = hz(nt)
        for k in range(7):
            det = (k - 3) * 0.0045
            ph = rng.uniform(0, 1)
            w = 2 * ((t * f * (1 + det) + ph) % 1) - 1
            pan = (k - 3) / 3
            out[:, 0] += w * np.sqrt(0.5 * (1 - pan)); out[:, 1] += w * np.sqrt(0.5 * (1 + pan))
    env = np.minimum(1, t / 0.15) * np.clip((d + 0.6 - t) / 0.6, 0, 1)
    out = lp(out * env[:, None], cutoff) / (7 * len(notes)) * 3
    add(synth, t0, out, g)

def braam(t0, root="D", g=0.6):
    n = int(3.2 * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for f in (hz(root + "1"), hz(root + "2"), hz(root + "2") * 1.5, hz(root + "1") * 1.003):
        s += 2 * ((t * f) % 1) - 1
    s = np.tanh(s * 2.5)
    cut = 300 + 2500 * np.exp(-t / 0.5)
    y = np.zeros(n); z = 0.0
    a = np.exp(-2 * np.pi * cut / SR)
    for i in range(0, n, 64):  # block-wise one-pole for a swept filter
        aa = a[i]; seg = s[i:i + 64]; out = np.empty_like(seg)
        for j, v in enumerate(seg):
            z = (1 - aa) * v + aa * z; out[j] = z
        y[i:i + 64] = out
    y *= np.minimum(1, t / 0.02) * np.exp(-t / 1.4)
    add(synth, t0, np.stack([y, np.roll(y, 240)], 1) * 0.5, g)

def boom(t0, g=0.7, soft=False):
    n = int(2.8 * SR); t = np.arange(n) / SR
    f = 28 + 60 * np.exp(-t / 0.15)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (1.0 if not soft else 0.55))
    add(sfx, t0, np.tanh(s * 1.8), g * (0.6 if soft else 1))

# drums and bass, bar by bar
for b in np.arange(24.0, 86.0, BEAT):
    b = round(b, 3)
    if 69.5 <= b < 70.0 or 73.2 <= b < 73.7 or 77.5 <= b < 78.0 or 23.8 <= b < 24.0:
        continue
    beat_in_bar = int(round((b - 24.0) / BEAT)) % 4
    full = b >= 30.0
    if full or beat_in_bar in (0, 2):
        kick(b, 0.9 if full else 0.75)
    if b >= 42.0 and beat_in_bar in (1, 3):
        clap(b, 0.36)
    if b >= 30.0:
        hat(b + 0.25, 0.09, open_=(beat_in_bar == 3), pan=0.25)
        if b >= 42.0:
            hat(b + 0.125, 0.04, pan=-0.2); hat(b + 0.375, 0.04, pan=-0.2)
    ch = chord_at(b)
    root = ROOT[ch] + ("1" if ROOT[ch] in ("A", "B", "Bb", "G") else "2")
    if b >= 30.0:
        sub(b, 0.23, root, 0.55); sub(b + 0.25, 0.23, root, 0.45)
    elif beat_in_bar == 0:
        sub(b, 1.95, root, 0.55)
# snare fills into each seat and section change
for t_end in (30.0, 42.0, 46.0, 52.0, 58.0, 64.0, 70.0, 76.25, 78.0):
    for k in range(8):
        tt = t_end - 0.5 + k * 0.0625
        snare(tt, 0.08 + k * 0.025)
# snare roll into the drop
tt = 22.0
while tt < 23.75:
    k = (tt - 22.0) / 1.75
    snare(tt, 0.06 + 0.3 * k ** 2)
    tt += 0.125 * (1 - 0.55 * k)
# act I heartbeat
def heartbeat(t0, g):
    n = int(0.3 * SR); t = np.arange(n) / SR
    f = 52 + 38 * np.exp(-t / 0.03)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.11)
    add(drums, t0, np.tanh(s * 1.3), g)
for k in range(6, 22):
    if 13.4 <= k < 14.6: continue
    heartbeat(k, 0.30 + 0.012 * (k - 6)); heartbeat(k + 0.22, 0.18 + 0.008 * (k - 6))
# hits
for t0 in (24.0, 76.25):
    crash(t0, 0.5); braam(t0, "D" if t0 < 70 else "E", 0.55); boom(t0, 0.7)
    supersaw(t0, 2.0 if t0 < 70 else 9.6, [shift(x, 1) for x in CH["D" if t0 < 70 else "E"][:3]], 0.13)
supersaw(24.0, 6.0, ["D4", "F#4", "A4"], 0.08, 2200)
crash(30.0, 0.32); crash(42.0, 0.3); crash(70.0, 0.34); crash(78.0, 0.36); crash(86.0, 0.38)
reverse_cymbal(24.0, 1.8, 0.4); reverse_cymbal(70.0, 1.2, 0.3); reverse_cymbal(76.25, 1.0, 0.28); reverse_cymbal(30.0, 0.9, 0.22)
kick(86.0, 1.0); boom(88.1, 0.5, soft=True)
# AI-section pulse: filtered saw sixteenths on D
pn = int(5.5 * SR); tp = np.arange(pn) / SR
saw = 2 * ((tp * hz("D3")) % 1) - 1
gate = (np.sin(2 * np.pi * 8 * tp) > 0).astype(float)
pulse = lp(saw * gate * np.minimum(1, tp / 3), 900) * 0.5
add(synth, 16.0, np.stack([pulse, pulse], 1), 0.32)

# ------------------------------------------------------------------ sound effects from the cues
def varlp_noise(dur, f0, f1, curve=1.0):
    n = int(dur * SR); x = rng.standard_normal(n)
    u = np.linspace(0, 1, n) ** curve; fc = f0 * (f1 / f0) ** u
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty(n); z = 0.0
    for i in range(n): z = (1 - a[i]) * x[i] + a[i] * z; y[i] = z
    return y

def whoosh(t0, d=0.6, soft=False):
    d = max(0.35, d); n = int(d * SR)
    up = varlp_noise(d, 250, 6000, 1.0)
    e = np.sin(np.linspace(0, np.pi, n)) ** 2
    s = hp(up, 150) * e
    pan = np.linspace(-0.7, 0.7, n)
    st = np.stack([s * np.sqrt(0.5 * (1 - pan)), s * np.sqrt(0.5 * (1 + pan))], 1) * 1.5
    add(sfx, t0 - d * 0.12, st, 0.17 if soft else 0.32)

def pop(t0, g=0.2):
    n = int(0.1 * SR); t = np.arange(n) / SR
    f = 1000 * np.exp(-t / 0.04) + 420
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.028)
    add(sfx, t0, s, g, rng.uniform(-0.3, 0.3))

def tick(t0, g=0.12):
    n = int(0.03 * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * 2600 * t) * np.exp(-t / 0.005) + bp(rng.standard_normal(n), 3000, 9000) * np.exp(-t / 0.003) * 0.4
    add(sfx, t0, s, g, rng.uniform(-0.4, 0.4))

def key_click(t0, g, bright=False):
    n = int(0.035 * SR); t = np.arange(n) / SR
    body = bp(rng.standard_normal(n), 1400 if not bright else 2600, 5200 if not bright else 9500) * np.exp(-t / 0.004)
    thump = np.sin(2 * np.pi * (160 if not bright else 900) * t) * np.exp(-t / 0.009) * 0.55
    add(sfx, t0, body + thump, g, rng.uniform(-0.25, 0.25))

def typing(t0, d, n_chars, human):
    count = max(3, int(n_chars * (1.0 if human else 0.5)))
    for tk in np.sort(t0 + rng.uniform(0, d, count)):
        key_click(tk, (0.15 if human else 0.06) * rng.uniform(0.6, 1.0), bright=not human)

def bell(t0, f, g=0.12, pan=0.0, decay=1.1):
    n = int(decay * 2 * SR); t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * t) * np.exp(-t / decay) + 0.4 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / (decay * 0.5))
         + 0.2 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t / (decay * 0.3)))
    add(sfx, t0, s * np.minimum(1, t / 0.002), g, pan)

def key_of(t):
    return ["D5", "F#5", "A5", "B5", "D6", "E6"] if t < 70 else ["E5", "G#5", "B5", "C#6", "E6", "F#6"]

def impact(t0, soft=False):
    n = int(2.0 * SR); t = np.arange(n) / SR
    nz = lp(rng.standard_normal(n), 1600) * np.exp(-t / 0.22) * 0.5
    crack = hp(rng.standard_normal(n), 3000) * np.exp(-t / 0.04) * 0.3
    add(sfx, t0, np.tanh((nz + crack) * 1.5), 0.3 if not soft else 0.2)
    boom(t0, 0.6 if not soft else 0.4, soft)

def riser(t0, d):
    n = int(d * SR); t = np.arange(n) / SR
    nz = varlp_noise(d, 200, 9000, 2.0) * (t / d) ** 2
    # Shepard-ish rising tone: three octaves of a glide, crossfaded
    tone = np.zeros(n)
    for o in range(3):
        f = 110 * 2 ** o * (2 ** (t / d))
        w = np.sin(np.pi * ((o + t / d) / 3))
        tone += np.sin(2 * np.pi * np.cumsum(f) / SR) * w
    s = hp(nz, 150) + tone * (t / d) ** 2.2 * 0.25
    s[-int(0.12 * SR):] *= np.linspace(1, 0, int(0.12 * SR))
    add(sfx, t0, s, 0.3)

def glitch(t0, d):
    d = max(0.12, d); n = int(d * SR); t = np.arange(n) / SR
    s = np.zeros(n); step = int(0.022 * SR)
    for i in range(0, n, step):
        f = rng.choice([220, 330, 440, 660, 880, 1320, 1760])
        seg = np.sign(np.sin(2 * np.pi * f * t[i:i + step])) * 0.5 + rng.standard_normal(min(step, n - i)) * 0.3
        s[i:i + step] = seg * (rng.uniform() > 0.25)
    s = np.round(s * 6) / 6 * np.minimum(1, (d - t) / 0.01)
    add(sfx, t0, lp(s, 6000), 0.08, rng.uniform(-0.5, 0.5))

def hit(t0):
    n = int(0.8 * SR); t = np.arange(n) / SR
    f = 52 + 70 * np.exp(-t / 0.05)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.3) + lp(rng.standard_normal(n), 2500) * np.exp(-t / 0.05) * 0.5
    add(sfx, t0, np.tanh(s * 1.4), 0.32)

def click(t0):
    n = int(0.05 * SR); t = np.arange(n) / SR
    s = bp(rng.standard_normal(n), 1800, 7000) * np.exp(-t / 0.006) + np.sin(2 * np.pi * 1200 * t) * np.exp(-t / 0.01) * 0.4
    add(sfx, t0, s, 0.26)

def alert(t0):
    for k, f in enumerate((988, 740)):
        n = int(0.12 * SR); t = np.arange(n) / SR
        s = lp(np.sign(np.sin(2 * np.pi * f * t)), 3000) * np.minimum(1, t / 0.004) * np.minimum(1, (0.12 - t) / 0.04)
        add(sfx, t0 + k * 0.13, s, 0.06)

def error(t0):
    for k, f in enumerate((330, 247)):
        n = int(0.16 * SR); t = np.arange(n) / SR
        s = lp(2 * ((t * f) % 1) - 1, 2200) * np.minimum(1, t / 0.004) * np.minimum(1, (0.16 - t) / 0.05)
        add(sfx, t0 + k * 0.15, s, 0.14)

def success(t0, soft=False):
    for k, p in enumerate(key_of(t0)[:4]):
        bell(t0 + k * 0.07, hz(p), 0.08 if soft else 0.11, -0.3 + 0.2 * k)

def count(t0, d):
    tk = t0
    while tk < t0 + d:
        u = (tk - t0) / d; n = int(0.025 * SR); t = np.arange(n) / SR
        add(sfx, tk, np.sin(2 * np.pi * (1200 + 1400 * u) * t) * np.exp(-t / 0.006), 0.07)
        tk += 0.11 * (1 - 0.7 * u) + 0.02
    bell(t0 + d, hz("A5"), 0.11)

def shimmer(t0, d):
    n = int((d + 1) * SR); t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * hz(p) * t + rng.uniform(0, 6)) * (0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(5, 9) * t)) for p in ("A6", "D7", "F#7", "E7"))
    add(sfx, t0, s * np.sin(np.linspace(0, np.pi, n)) ** 2, 0.02)

cues = json.load(open("cues.json"))
for c in cues:
    ty, t0 = c["type"], c["t"]
    if ty == "whoosh": whoosh(t0, c.get("d", 0.6), c.get("soft", False))
    elif ty == "pop": pop(t0)
    elif ty == "tick": tick(t0)
    elif ty == "typeH": typing(t0, c["d"], c["n"], True)
    elif ty == "typeA": typing(t0, c["d"], c["n"], False)
    elif ty == "ding": bell(t0, hz(key_of(t0)[c.get("note", 0) % 6]), 0.11, rng.uniform(-0.3, 0.3))
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

sfx = fx(sfx, Pedalboard([verb(0.6, 0.18, 0.5)]))
drums = fx(drums, Pedalboard([Compressor(threshold_db=-14, ratio=3, attack_ms=3, release_ms=80), Gain(1)]))
synth = fx(synth, Pedalboard([Chorus(rate_hz=0.6, depth=0.25, mix=0.3), verb(0.9, 0.35)]))
bass = fx(bass, Pedalboard([LowpassFilter(700), Compressor(threshold_db=-16, ratio=3)]))

# ------------------------------------------------------------------ mix
orch = sum(stems[k] for k in stems)
music = orch * 1.0 + synth * 1.0
# sidechain pump on the music and bass from the kicks
pump = np.ones(N, np.float32)
for b in np.arange(30.0, 86.0, BEAT):
    if 69.5 <= b < 70.0 or 73.2 <= b < 73.7 or 77.5 <= b < 78.0: continue
    i = int(b * SR); m = min(N - i, int(0.42 * SR)); tt = np.arange(m) / SR
    pump[i:i + m] = np.minimum(pump[i:i + m], 1 - 0.32 * np.exp(-tt / 0.12))
music *= pump[:, None]; bass *= pump[:, None]
# the suck-out before the drop
i0, i1 = int(23.78 * SR), int(24.0 * SR)
for buf in (music, drums, bass):
    buf[i0:i1] *= np.linspace(1, 0.05, i1 - i0)[:, None]

def rms_db(x): return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)
print("stems rms dB:", {k: round(rms_db(v), 1) for k, v in [("music", music), ("drums", drums), ("bass", bass), ("sfx", sfx)]})
mix = music * 1.0 + drums * 0.72 + bass * 0.85 + sfx * 0.78
mix = mix.astype(np.float32)
# master: gentle glue, then a brickwall limiter (pedalboard's Limiter adds make-up gain so its threshold lands at 0 dBFS)
master = Pedalboard([HighpassFilter(28), LowShelfFilter(cutoff_frequency_hz=90, gain_db=1.0), HighShelfFilter(cutoff_frequency_hz=9000, gain_db=1.5),
                     Compressor(threshold_db=-18, ratio=2.0, attack_ms=20, release_ms=180), Limiter(threshold_db=-3.0, release_ms=120)])
mix = fx(mix, master)
fi = int(0.3 * SR); mix[:fi] *= np.linspace(0, 1, fi)[:, None]
fo = int(1.4 * SR); mix[-fo:] *= (np.linspace(1, 0, fo) ** 1.6)[:, None]
meter = pyln.Meter(SR)
lufs = meter.integrated_loudness(mix)
mix = mix * 10 ** ((-14.0 - lufs) / 20)
peak = 20 * np.log10(np.abs(mix).max())
print("LUFS", round(lufs, 2), "->", round(meter.integrated_loudness(mix), 2), "peak dBFS", round(peak, 2))
for a, b in [(0, 6), (6, 16), (16, 24), (24, 30), (30, 46), (46, 70), (70, 78), (78, 86), (86, 90)]:
    seg = mix[int(a * SR):int(b * SR)]
    print(f"{a:>4}-{b:<4} {rms_db(seg):6.1f} dB rms")
sf.write("score.wav", mix, SR, subtype="PCM_24")
print("wrote score.wav")
