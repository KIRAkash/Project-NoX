#!/usr/bin/env bash
# Build the NoX film into docs/pitch/nox-film.mp4 (and the narrated cut, unless NARRATION=0).
#
# Needs: Node 18+ with Playwright's Chromium, ffmpeg, Python 3 with the packages in
# requirements.txt, FluidSynth and the MuseScore General soundfont
# (apt install fluidsynth musescore-general-soundfont-lossless).
# A full render takes about an hour on 4 CPU cores (WebGL runs in software).
set -euo pipefail
cd "$(dirname "$0")"
REPO=$(git rev-parse --show-toplevel)
OUT="$REPO/docs/pitch"

# 1. assets: three.js, GSAP and its plugins, fonts, logos
npm install --no-audit --no-fund --silent
mkdir -p vendor/fonts vendor/three
cp node_modules/gsap/dist/{gsap,SplitText,ScrambleTextPlugin,DrawSVGPlugin,CustomEase}.min.js vendor/
cp node_modules/three/build/three.module.js vendor/three/
rm -rf vendor/three/addons && cp -r node_modules/three/examples/jsm vendor/three/addons
cp node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-{normal,italic}.woff2 vendor/fonts/
cp node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2 vendor/fonts/
cp node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-{400,500,600,700}-normal.woff2 vendor/fonts/
rm -rf vendor/logos && cp -r "$REPO/apps/web/public/logos" vendor/logos

# 2. picture: frames -> seg_*.mp4 (with motion blur), plus cues.json for the sound
node render.mjs video "${WORKERS:-4}"

# 3. sound: the score, synced to cues.json
python3 score.py

# 4. grade (soft highlight glow, fine luma grain) and encode
GRADE="format=gbrp,split[a][b];[b]scale=480:270,curves=all='0/0 0.6/0.04 1/1',gblur=sigma=6,scale=1920:1080[g];[a][g]blend=all_mode=screen:all_opacity=0.32,format=yuv444p,noise=c0s=5:c0f=t+u,format=yuv420p"
ffmpeg -y -loglevel error -f concat -safe 0 -i segs.txt -vf "$GRADE" -c:v libx264 -preset slow -crf 20 -tune film -profile:v high -pix_fmt yuv420p -an graded.mp4
ffmpeg -y -loglevel error -i graded.mp4 -i score.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT/nox-film.mp4"
ffmpeg -y -loglevel error -ss 25.9 -i graded.mp4 -frames:v 1 -q:v 2 "$OUT/nox-film-poster.jpg"

# 5. optional narrated cut (Kokoro TTS, model files from the kokoro-onnx GitHub release)
if [ "${NARRATION:-1}" = "1" ]; then
  mkdir -p tts
  base=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
  [ -f tts/kokoro-v1.0.onnx ] || curl -sSL -o tts/kokoro-v1.0.onnx "$base/kokoro-v1.0.onnx"
  [ -f tts/voices-v1.0.bin ] || curl -sSL -o tts/voices-v1.0.bin "$base/voices-v1.0.bin"
  python3 narrate.py
  python3 mix_narrated.py
  ffmpeg -y -loglevel error -i graded.mp4 -i score_narrated.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT/nox-film-narrated.mp4"
fi
echo "wrote $OUT/nox-film.mp4"
