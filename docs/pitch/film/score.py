"""The NoX film score and sound design, synced to the timeline's cues.json.

A cinematic hybrid: a felt piano carries the motif, a spiccato cello and contrabass drive the
groove, low strings hold the harmony, taiko drums keep the beat and big hits land on the reveals.
Orchestral parts are written as MIDI and played by FluidSynth on the MuseScore General
soundfont; taiko, shakers, the sub and every sound effect are synthesized with numpy; effects
and mastering use Spotify's pedalboard; loudness is normalised to -14 LUFS.

Act I (0-24 s, D minor): the lone piano motif, a ticking cello ostinato through the telephone
hops (the motif detunes a little more at each hop), a low brass cluster on the ≠, a string
tremolo into silence. Act II (24-70 s, D major, 120 BPM): the taiko hit at the ignition, then
the drive under the Atlas, the trajectory theme and the spec book. Act III (70-90 s, E major):
the return journey, the climax on "My sentence is now true", the opening motif in major.
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

PIANO, STR, CELLO, CBASS, TBONE, TUBA, HORN = 0, 48, 42, 43, 57, 58, 60

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

# ---- cues first: the dings and chimes are played by the felt piano ----
cues = json.load(open("cues.json"))
def key_of(t):
    return ["D5", "F#5", "A5", "B5", "D6", "E6"] if t < 70 else ["E5", "G#5", "B5", "C#6", "E6", "F#6"]
for c in cues:
    if c["type"] == "ding":
        p = key_of(c["t"])[c.get("note", 0) % 6]
        play("piano_fx", PIANO, c["t"], 1.2, [p, shift(p, -1)], 58)
    elif c["type"] == "success":
        for k, p in enumerate(key_of(c["t"])[:4]):
            play("piano_fx", PIANO, c["t"] + k * 0.08, 1.4, p, 50 if c.get("soft") else 60)
    elif c["type"] in ("alert", "error"):
        play("piano_fx", PIANO, c["t"], 0.6, ["D3", "Eb3"] if c["t"] < 70 else ["E3", "F3"], 70)

# ---- Act I: one sentence (0-6) ----
for t, d, p, v in [(0.55, 0.8, "D5", 52), (1.30, 0.55, "F5", 48), (1.80, 1.35, "A5", 56), (3.15, 0.42, "G5", 46), (3.55, 0.42, "F5", 44), (3.95, 1.9, "E5", 50)]:
    play("piano", PIANO, t, d, p, v)
play("piano", PIANO, 0.55, 2.6, ["D3", "A3"], 40); play("piano", PIANO, 3.15, 2.9, ["Bb2", "F3"], 38)
play("strings", STR, 0.3, 5.9, ["D3", "A3"], 30)
play("bass", CBASS, 0.3, 5.9, ["D2"], 40)
play("piano", PIANO, 4.35, 1.8, ["A5", "D6"], 34)

# ---- telephone (6-14) ----
TEL = [(6.0, "Dm", "D2"), (8.0, "Bb", "Bb1"), (10.0, "Gm", "G1"), (12.0, "A7b9", "A1")]
for t0, ch, low in TEL:
    end = min(t0 + 2.0, 13.4)
    play("strings", STR, t0, end - t0 + 0.15, CH[ch][:3], 46 + (t0 - 6) * 2)
    play("bass", CBASS, t0, end - t0 + 0.1, [low], 60)
    k = 0; tt = t0
    while tt < end - 1e-6:
        p = shift(low, 1) if k % 2 == 0 else shift(low, 2)
        play("cello", CELLO, tt, 0.16, p, 72 + (12 if k % 4 == 0 else 0) + int((t0 - 6) * 2))
        tt += 0.25; k += 1
HOPS = [7.4, 9.0, 10.6, 12.2]
for i, h in enumerate(HOPS):
    notes = ["D5", "F5", "A5"] if i < 2 else ["D5", "F5", "Ab5"] if i == 2 else ["D5", "Eb5", "Ab5"]
    for j, p in enumerate(notes):
        play("piano_decay", PIANO, h + 0.35 + j * 0.16, 0.5, p, 60 - i * 4)
part("piano_decay", PIANO)
for i, h in enumerate(HOPS):
    bend("piano_decay", h + 0.3, -[0, 500, 1100, 1900][i])
    bend("piano_decay", h + 1.2, 0)
# the ≠: a low brass cluster and the piano's lowest notes
play("lowbrass", TBONE, 14.0, 1.2, ["D2", "Eb2", "A2"], 112)
play("tuba", TUBA, 14.0, 1.4, ["D1"], 110)
play("piano", PIANO, 14.0, 2.0, ["D1", "Eb1", "A1"], 96)
play("strings", STR, 14.25, 1.9, ["D3", "Eb4"], 36)

# ---- AI everywhere (16-24) ----
for t0, ch in [(16.0, "Gm"), (18.0, "Eb"), (20.0, "Asus")]:
    play("strings", STR, t0, 2.05, CH[ch][:3], 52 + (t0 - 16) * 3)
    play("bass", CBASS, t0, 2.0, [ROOT[ch] + "1"], 64)
    tt = t0; k = 0
    while tt < t0 + 2 - 1e-6:
        play("cello", CELLO, tt, 0.14, ROOT[ch] + "2" if k % 2 == 0 else ROOT[ch] + "3", 78 + int((t0 - 16) * 3) + (10 if k % 4 == 0 else 0))
        tt += 0.125 if t0 >= 18 else 0.25; k += 1
for h in (20.05, 20.6, 21.15):
    play("lowbrass", TBONE, h, 0.35, ["A2", "E3"], 100)
tt = 22.0
while tt < 23.78:
    v = 50 + (tt - 22.0) / 1.8 * 70
    play("strings_trem", STR, tt, 0.13, ["A2", "E3", "A3", "C#4", "E4"], v)
    tt += 0.125

# ---- Act II: the ignition (24) and D major ----
PROG_D = ["D", "A/C#", "Bm", "G"]
PROG_E = ["E", "B", "C#m", "Amaj"]
def chord_at(t):
    if t < 70:
        return PROG_D[int((t - 24) // 2) % 4]
    return PROG_E[int((t - 70) // 2) % 4]
BREAKS = lambda t: 69.5 <= t < 70 or 73.2 <= t < 73.7 or 77.5 <= t < 78.0
play("lowbrass", TBONE, 24.0, 2.0, ["D2", "A2", "D3", "F#3"], 120)
play("tuba", TUBA, 24.0, 2.2, ["D1"], 118)
play("horn", HORN, 24.0, 2.4, ["D4", "A4"], 96)
for b in range(24, 86, 2):
    if BREAKS(b): continue
    ch = chord_at(b)
    play("strings", STR, b, 2.02, CH[ch][:3], 56 if b < 46 else 60 if b < 70 else 70)
# felt piano arpeggio under the logo (24-30)
for b in (24, 26, 28):
    ch = CH[chord_at(b)]
    pitches = [shift(x, 1) for x in ch] + [shift(x, 2) for x in ch]
    for k in range(16):
        play("piano", PIANO, b + k * 0.125, 0.4, pitches[k % len(pitches)], 44 + (k % 4 == 0) * 10)
# the drive: spiccato cello sixteenths and contrabass eighths, from the Atlas on
for b in np.arange(30.0, 86.0, 0.125):
    b = round(float(b), 3)
    if BREAKS(b): continue
    ch = CH[chord_at(b)]; k = int(round((b - 30.0) / 0.125)) % 8
    root2 = ROOT[chord_at(b)] + "2"
    pat = [root2, shift(root2, 1), ch[1], shift(root2, 1), root2, ch[1], shift(root2, 1), ch[1]]
    play("cello", CELLO, b, 0.1, pat[k], 70 + (k % 4 == 0) * 16 + (10 if b >= 70 else 0))
    if k % 2 == 0:
        play("bass", CBASS, b, 0.2, ROOT[chord_at(b)] + "1", 72 + (k == 0) * 12)

THEME = [(0, 0.5, "A4"), (0.5, 0.5, "D5"), (1.0, 0.5, "F#5"), (1.5, 0.5, "A5"),
         (2.0, 0.75, "G5"), (2.75, 0.25, "F#5"), (3.0, 1.0, "E5"),
         (4.0, 0.5, "F#5"), (4.5, 0.5, "D5"), (5.0, 0.5, "B4"), (5.5, 0.5, "D5"),
         (6.0, 0.5, "E5"), (6.5, 0.5, "D5"), (7.0, 1.0, "A4")]
def theme(t0, inst, prog, vel, transpose=0, octave=0, legato=0.95):
    for dt, d, p in THEME:
        play(inst, prog, t0 + dt, d * legato, pretty_midi.note_number_to_name(nn(p) + transpose + 12 * octave), vel)
theme(42.0, "piano", PIANO, 72); theme(42.0, "piano", PIANO, 50, octave=1)
theme(50.0, "piano", PIANO, 64)
theme(58.0, "cello_solo", CELLO, 78, octave=-1, legato=1.05)
theme(62.0, "piano", PIANO, 60, octave=1)
theme(76.0, "strings_hi", STR, 92, transpose=2, octave=1)
theme(76.0, "piano", PIANO, 76, transpose=2, octave=1)
theme(78.0, "horn", HORN, 74, transpose=2)
theme(78.0, "cello_solo", CELLO, 70, transpose=2, octave=-1, legato=1.05)
play("lowbrass", TBONE, 73.2, 0.5, ["E2", "F2", "Bb2"], 108)
play("lowbrass", TBONE, 76.25, 1.9, ["E2", "B2", "E3", "G#3"], 120)
play("tuba", TUBA, 76.25, 2.0, ["E1"], 120)
play("horn", HORN, 76.25, 2.0, ["E4", "B4"], 100)
for t, d, p, v in [(86.1, 0.75, "E5", 64), (86.85, 0.5, "G#5", 60), (87.35, 1.4, "B5", 66), (88.1, 2.0, "E6", 58)]:
    play("piano", PIANO, t, d, p, v)
play("piano", PIANO, 86.1, 3.8, ["E3", "B3"], 52)
play("strings", STR, 86.0, 4.0, ["E3", "B3", "G#4"], 60)
play("cello_solo", CELLO, 86.0, 3.9, ["E2"], 70)
play("bass", CBASS, 86.0, 3.9, ["E1"], 60)


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

def fx(x, board):
    return board(x.T.copy(), SR).T

def verb(size=0.8, wet=0.3, damp=0.4, width=1.0):
    return Reverb(room_size=size, wet_level=wet, dry_level=1.0 - wet * 0.5, damping=damp, width=width)

# the felt piano: a piano with the hammers softened (the top rolled off) and a close, warm room
FELT = lambda g: Pedalboard([Gain(g), HighpassFilter(55), LowpassFilter(2300), LowShelfFilter(cutoff_frequency_hz=220, gain_db=2.5),
                            Compressor(threshold_db=-24, ratio=2.2, attack_ms=15, release_ms=220), Distortion(drive_db=3), verb(0.7, 0.3, 0.6)])
stems["piano"] = fx(stems["piano"], FELT(13))
stems["piano_fx"] = fx(stems["piano_fx"], Pedalboard([FELT(9), Delay(delay_seconds=0.375, feedback=0.22, mix=0.18)]))
stems["piano_decay"] = fx(stems["piano_decay"], Pedalboard([FELT(8), Bitcrush(bit_depth=10)]))
for s_, g in (("strings", 0), ("strings_trem", 15), ("strings_hi", 4)):
    stems[s_] = fx(stems[s_], Pedalboard([HighpassFilter(55), LowpassFilter(5000), verb(0.92, 0.36, 0.55), Gain(g)]))
stems["cello"] = fx(stems["cello"], Pedalboard([HighpassFilter(55), LowpassFilter(6500), Compressor(threshold_db=-20, ratio=3, attack_ms=4, release_ms=90), verb(0.75, 0.24), Gain(8)]))
stems["cello_solo"] = fx(stems["cello_solo"], Pedalboard([HighpassFilter(55), Compressor(threshold_db=-20, ratio=2), verb(0.88, 0.32), Gain(7)]))
stems["bass"] = fx(stems["bass"], Pedalboard([HighpassFilter(35), LowpassFilter(1800), Compressor(threshold_db=-18, ratio=3), verb(0.7, 0.18), Gain(7)]))
stems["lowbrass"] = fx(stems["lowbrass"], Pedalboard([Gain(5), Distortion(drive_db=4), LowpassFilter(3200), verb(0.88, 0.3)]))
stems["tuba"] = fx(stems["tuba"], Pedalboard([Gain(6), LowpassFilter(900), verb(0.85, 0.25)]))
stems["horn"] = fx(stems["horn"], Pedalboard([Gain(4), verb(0.9, 0.34)]))

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

# ---- taiko and hand percussion (circular-membrane modes, a stick transient, a room) ----
def taiko(t0, g=1.0, f=62.0, decay=0.75, pan=0.0):
    n = int((decay * 2.2) * SR); t = np.arange(n) / SR
    glide = f * (1 + 0.55 * np.exp(-t / 0.018))
    s = np.zeros(n)
    for ratio, amp, dk in ((1.0, 1.0, 1.0), (1.59, 0.45, 0.55), (2.14, 0.28, 0.4), (2.30, 0.18, 0.3), (2.65, 0.12, 0.25)):
        s += amp * np.sin(2 * np.pi * np.cumsum(glide * ratio) / SR + rng.uniform(0, 6)) * np.exp(-t / (decay * dk))
    stick = lp(rng.standard_normal(n), 1100) * np.exp(-t / 0.012) * 0.8
    skin = bp(rng.standard_normal(n), 200, 900) * np.exp(-t / 0.09) * 0.25
    add(drums, t0, np.tanh((s + stick + skin) * 1.3) * 0.9, g, pan)

def shime(t0, g=0.25, pan=0.0):
    n = int(0.3 * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * 360 * t) * np.exp(-t / 0.07) + 0.4 * np.sin(2 * np.pi * 360 * 1.59 * t) * np.exp(-t / 0.04)
    crack = bp(rng.standard_normal(n), 1800, 6500) * np.exp(-t / 0.008) * 0.7
    add(drums, t0, s * 0.6 + crack, g, pan)

def frame(t0, g=0.3, pan=0.0):
    n = int(0.5 * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * np.cumsum(140 * (1 + 0.3 * np.exp(-t / 0.01))) / SR) * np.exp(-t / 0.16)
    slap = bp(rng.standard_normal(n), 600, 3500) * np.exp(-t / 0.02) * 0.6
    add(drums, t0, s + slap, g, pan)

def shaker(t0, g=0.06, pan=0.3, long_=False):
    n = int(0.12 * SR); t = np.arange(n) / SR
    env = np.minimum(1, t / 0.012) * np.exp(-t / (0.05 if long_ else 0.028))
    add(drums, t0, bp(rng.standard_normal(n), 3500, 10000) * env, g, pan)

def taiko_roll(t_end, d=0.5, g=0.35):
    tt = t_end - d; k = 0
    while tt < t_end - 1e-6:
        u = (tt - (t_end - d)) / d
        (frame if k % 2 else shime)(tt, g * (0.35 + 0.65 * u), pan=-0.3 if k % 2 else 0.3)
        tt += 0.0625; k += 1

def sub(t0, d, note, g=0.5):
    f = hz(note); n = int(d * SR); t = np.arange(n) / SR
    env = np.minimum(1, t / 0.01) * np.minimum(1, (d - t) / 0.04)
    add(bass, t0, np.sin(2 * np.pi * f * t) * env * 0.8, g)

def boom(t0, g=0.7, soft=False):
    n = int(2.8 * SR); t = np.arange(n) / SR
    f = 30 + 50 * np.exp(-t / 0.18)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (1.1 if not soft else 0.6))
    add(sfx, t0, np.tanh(s * 1.6), g * (0.6 if soft else 1))

def swell(t_end, dur=1.4, g=0.3):
    """an orchestral suck-in: reversed, darkened noise and air rising into the hit"""
    n = int(dur * SR); t = np.arange(n) / SR
    s = lp(rng.standard_normal((n, 2)), 2500) * ((t / dur) ** 3)[:, None]
    add(sfx, t_end - dur, s, g)

def big_hit(t0, g=1.0, soft=False):
    for k, (dt, f, pan) in enumerate(((0, 52, 0), (0.018, 64, -0.4), (0.04, 78, 0.4))):
        taiko(t0 + dt, g * (0.95 - 0.15 * k), f, 1.1, pan)
    boom(t0, 0.65 * g, soft)

# the beat: the same grid as before, played on taiko, shime, frame drum and shaker
for b in np.arange(24.0, 86.0, BEAT):
    b = round(b, 3)
    if BREAKS(b) or 23.8 <= b < 24.0:
        continue
    beat_in_bar = int(round((b - 24.0) / BEAT)) % 4
    full = b >= 30.0
    if full or beat_in_bar in (0, 2):
        if beat_in_bar == 0: taiko(b, 0.95 if full else 0.8, 56, 0.8)
        elif beat_in_bar == 2: taiko(b, 0.75, 66, 0.6, -0.2)
        else: taiko(b, 0.5, 74, 0.45, 0.25)
    if b >= 42.0 and beat_in_bar in (1, 3):
        shime(b, 0.24, 0.15); frame(b + 0.01, 0.2, -0.15)
    if b >= 30.0:
        shaker(b + 0.25, 0.07, 0.3, long_=(beat_in_bar == 3))
        if b >= 42.0:
            shaker(b + 0.125, 0.035, -0.3); shaker(b + 0.375, 0.035, -0.3)
    ch = chord_at(b)
    root = ROOT[ch] + ("1" if ROOT[ch] in ("A", "B", "Bb", "G") else "2")
    if b >= 30.0:
        sub(b, 0.45, root, 0.4)
    elif beat_in_bar == 0:
        sub(b, 1.95, root, 0.45)
# taiko rolls into each page turn and section change
for t_end in (30.0, 42.0, 46.0, 51.0, 56.0, 61.0, 65.0, 70.0, 76.25, 78.0):
    taiko_roll(t_end, 0.5, 0.32)
# the roll into the ignition
tt = 22.0
while tt < 23.75:
    k = (tt - 22.0) / 1.75
    taiko(tt, 0.12 + 0.55 * k ** 2, 70 + 20 * (int(tt * 16) % 2), 0.3, -0.3 if int(tt * 16) % 2 else 0.3)
    tt += 0.125 * (1 - 0.55 * k)
# act I: a distant heartbeat on a low drum
for k in range(6, 22):
    if 13.4 <= k < 14.6: continue
    taiko(k, 0.22 + 0.01 * (k - 6), 48, 0.35); taiko(k + 0.22, 0.13 + 0.006 * (k - 6), 46, 0.3)
# the hits
big_hit(14.0, 0.8)
for h in (20.05, 20.6, 21.15): taiko(h, 0.7, 60, 0.7)
for t0 in (24.0, 76.25):
    big_hit(t0, 1.0); swell(t0, 1.6, 0.35)
big_hit(73.2, 0.6, soft=True)
for t0 in (30.0, 42.0, 70.0, 78.0): taiko(t0, 0.7, 54, 1.0)
big_hit(86.0, 0.7, soft=True); boom(88.1, 0.4, soft=True)

# ------------------------------------------------------------------ sound effects from the cues
def varlp_noise(dur, f0, f1, curve=1.0):
    n = int(dur * SR); x = rng.standard_normal(n)
    u = np.linspace(0, 1, n) ** curve; fc = f0 * (f1 / f0) ** u
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty(n); z = 0.0
    for i in range(n): z = (1 - a[i]) * x[i] + a[i] * z; y[i] = z
    return y

def whoosh(t0, d=0.6, soft=False):
    """air moving past: a dark swept band, with a low swell underneath"""
    d = max(0.35, d); n = int(d * SR); t = np.arange(n) / SR
    up = varlp_noise(d, 180, 2600, 1.2)
    e = np.sin(np.linspace(0, np.pi, n)) ** 2
    body = np.sin(2 * np.pi * np.cumsum(60 + 40 * t / d) / SR) * e * 0.35
    s = hp(up, 90) * e + body
    pan = np.linspace(-0.6, 0.6, n)
    st = np.stack([s * np.sqrt(0.5 * (1 - pan)), s * np.sqrt(0.5 * (1 + pan))], 1) * 1.4
    add(sfx, t0 - d * 0.12, st, 0.14 if soft else 0.26)

def paper(t0, d=0.5, g=0.22):
    """a page turning: a crisp flick, a soft rush of paper, and the page settling"""
    n = int(d * SR); t = np.arange(n) / SR
    rush = bp(rng.standard_normal(n), 1200, 7000) * (np.sin(np.linspace(0, np.pi, n)) ** 1.5) * (0.6 + 0.4 * rng.random(n) ** 4)
    flick = bp(rng.standard_normal(n), 2500, 9000) * np.exp(-t / 0.01) * 0.9
    settle = np.zeros(n); i = int(0.8 * n); m = n - i
    settle[i:] = lp(rng.standard_normal(m), 900) * np.exp(-np.arange(m) / SR / 0.03) * 1.2
    add(sfx, t0, rush * 0.6 + flick + settle, g, rng.uniform(-0.3, 0.3))

def pop(t0, g=0.22):
    """a wooden knock: a felt mallet on a block"""
    n = int(0.25 * SR); t = np.arange(n) / SR
    f = 620
    s = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.05) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.018)
    add(sfx, t0, s + lp(rng.standard_normal(n), 2500) * np.exp(-t / 0.004) * 0.3, g, rng.uniform(-0.3, 0.3))

def tick(t0, g=0.13):
    """a clock's escapement: a small dry wooden click"""
    n = int(0.05 * SR); t = np.arange(n) / SR
    s = bp(rng.standard_normal(n), 1500, 5000) * np.exp(-t / 0.004) + np.sin(2 * np.pi * 1450 * t) * np.exp(-t / 0.008) * 0.4
    add(sfx, t0, s, g, rng.uniform(-0.4, 0.4))

def key_press(t0, g):
    """a mechanical key: the switch's click, then the keycap bottoming out"""
    n = int(0.06 * SR); t = np.arange(n) / SR
    click = bp(rng.standard_normal(n), 2200, 7500) * np.exp(-t / 0.0025)
    thock = (np.sin(2 * np.pi * rng.uniform(280, 360) * t) * np.exp(-t / 0.012) + lp(rng.standard_normal(n), 1200) * np.exp(-t / 0.006) * 0.6)
    s = click * 0.5 + np.roll(thock, int(0.006 * SR)) * 0.9
    add(sfx, t0, s, g, rng.uniform(-0.2, 0.2))

def pencil(t0, d, n_chars):
    """NoX writing: a soft graphite scratch in short strokes, one per word or so"""
    n = int(d * SR); t = np.arange(n) / SR
    grain = bp(rng.standard_normal(n), 2500, 9000) * (0.5 + 0.5 * rng.random(n) ** 3)
    strokes = np.zeros(n); tk = 0.0
    while tk < d:
        L = rng.uniform(0.05, 0.14); i, j = int(tk * SR), int(min(d, tk + L) * SR)
        strokes[i:j] = np.sin(np.linspace(0, np.pi, j - i)) * rng.uniform(0.5, 1.0)
        tk += L + rng.uniform(0.02, 0.07)
    add(sfx, t0, grain * strokes, 0.05, rng.uniform(-0.2, 0.2))

def typing(t0, d, n_chars, human):
    if not human:
        return pencil(t0, d, n_chars)
    count = max(3, int(n_chars * 0.9))
    for tk in np.sort(t0 + rng.uniform(0, d, count)):
        key_press(tk, 0.16 * rng.uniform(0.6, 1.0))

def stamp(t0, g=0.34):
    """a rubber stamp on paper on a desk: a soft thud, a press, a lift"""
    n = int(0.35 * SR); t = np.arange(n) / SR
    thud = np.sin(2 * np.pi * np.cumsum(90 + 60 * np.exp(-t / 0.01)) / SR) * np.exp(-t / 0.07)
    press = lp(rng.standard_normal(n), 1800) * np.exp(-t / 0.02) * 0.7
    add(sfx, t0, np.tanh((thud + press) * 1.5), g)
    paper(t0 + 0.12, 0.18, 0.06)

def impact(t0, soft=False):
    big_hit(t0, 0.6 if soft else 0.85, soft)

def riser(t0, d):
    swell(t0 + d, d, 0.3)
    tt = t0 + d * 0.4
    while tt < t0 + d:
        taiko(tt, 0.1 + 0.4 * ((tt - t0) / d) ** 2, 80, 0.25); tt += 0.125

def glitch(t0, d):
    """the message garbling: tape stutter on a short slice of noise and piano-ish tone"""
    d = max(0.12, d); n = int(d * SR); t = np.arange(n) / SR
    s = np.zeros(n); step = int(0.03 * SR)
    for i in range(0, n, step):
        f = rng.choice([147, 220, 294, 440, 587])
        seg = np.sin(2 * np.pi * f * t[i:i + step]) * np.exp(-np.arange(min(step, n - i)) / SR / 0.02)
        s[i:i + step] = seg * (rng.uniform() > 0.3)
    add(sfx, t0, lp(s + bp(rng.standard_normal(n), 800, 4000) * 0.15, 4500), 0.12, rng.uniform(-0.5, 0.5))

def hit(t0):
    taiko(t0, 0.6, 58, 0.8)

def count(t0, d):
    tk = t0
    while tk < t0 + d:
        tick(tk, 0.1); u = (tk - t0) / d
        tk += 0.11 * (1 - 0.7 * u) + 0.02

def shimmer(t0, d):
    """NoX drafting a page: a breath of paper and air"""
    n = int((d + 0.6) * SR); t = np.arange(n) / SR
    s = bp(rng.standard_normal(n), 800, 6000) * np.sin(np.linspace(0, np.pi, n)) ** 2
    add(sfx, t0, s, 0.035, rng.uniform(-0.3, 0.3))

for c in cues:
    ty, t0 = c["type"], c["t"]
    if ty == "whoosh":
        whoosh(t0, c.get("d", 0.6), c.get("soft", False))
    elif ty == "page": paper(t0, 0.55, 0.26)
    elif ty == "pop": pop(t0)
    elif ty == "tick": tick(t0)
    elif ty == "typeH": typing(t0, c["d"], c["n"], True)
    elif ty == "typeA": typing(t0, c["d"], c["n"], False)
    elif ty == "click": stamp(t0)
    elif ty == "impact": impact(t0, c.get("soft", False))
    elif ty == "riser": riser(t0, c["d"])
    elif ty == "glitch": glitch(t0, c.get("d", 0.3))
    elif ty == "hit": hit(t0)
    elif ty == "count": count(t0, c["d"])
    elif ty == "shimmer": shimmer(t0, c.get("d", 1))
    # ding, success, alert and error are played by the felt piano (see the top)

sfx = fx(sfx, Pedalboard([verb(0.55, 0.16, 0.6)]))
drums = fx(drums, Pedalboard([Compressor(threshold_db=-16, ratio=2.5, attack_ms=8, release_ms=120), verb(0.85, 0.28, 0.45), Gain(2)]))
bass = fx(bass, Pedalboard([LowpassFilter(260), Compressor(threshold_db=-16, ratio=3)]))

# ------------------------------------------------------------------ mix
orch = sum(stems[k] for k in stems)
music = orch * 1.0
i0, i1 = int(23.78 * SR), int(24.0 * SR)
for buf in (music, drums, bass):
    buf[i0:i1] *= np.linspace(1, 0.05, i1 - i0)[:, None]

def rms_db(x): return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)
print("stems rms dB:", {k: round(rms_db(v), 1) for k, v in [("music", music), ("drums", drums), ("bass", bass), ("sfx", sfx)]})
print("in-section rms dB:", {k: wrms(stems[k], 24, 70) for k in stems})
mix = music * 1.0 + drums * 0.5 + bass * 0.75 + sfx * 0.85
mix = mix.astype(np.float32)
master = Pedalboard([HighpassFilter(28), LowShelfFilter(cutoff_frequency_hz=90, gain_db=1.5), HighShelfFilter(cutoff_frequency_hz=9000, gain_db=0.5),
                     Compressor(threshold_db=-18, ratio=2.0, attack_ms=25, release_ms=200), Limiter(threshold_db=-3.0, release_ms=120)])
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
