#!/usr/bin/env bash
# Build the NoX film into docs/pitch/nox-film.mp4.
# Needs Node 18+, Playwright with Chromium, Python 3 with numpy and scipy, and ffmpeg.
set -euo pipefail
cd "$(dirname "$0")"
REPO=$(git rev-parse --show-toplevel)

npm install --no-audit --no-fund --silent
mkdir -p fonts logos
cp node_modules/gsap/dist/gsap.min.js .
cp node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-{normal,italic}.woff2 fonts/
cp node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2 fonts/
cp node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-{400,500,600,700}-normal.woff2 fonts/
cp "$REPO"/apps/web/public/logos/*.svg logos/

node render.mjs video "${WORKERS:-4}"   # frames -> seg_*.mp4, plus cues.json for the sound
python3 soundtrack.py                   # cues.json -> soundtrack.wav
ffmpeg -y -loglevel error -f concat -safe 0 -i segs.txt -i soundtrack.wav -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest ../nox-film.mp4
ffmpeg -y -loglevel error -ss 26.2 -i ../nox-film.mp4 -frames:v 1 -q:v 3 ../nox-film-poster.jpg
echo "wrote docs/pitch/nox-film.mp4"
