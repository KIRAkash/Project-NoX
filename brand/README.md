# NoX logo

The wordmark is N●X: the star stands in for the O. It matches the mark in the web app (`apps/web/components/app/nox-mark.tsx`).

| File | Use it for |
| --- | --- |
| `nox-wordmark-on-dark.svg` | The wordmark on dark backgrounds (light letters) |
| `nox-wordmark-on-light.svg` | The wordmark on light backgrounds (dark letters) |
| `nox-mark.svg` | The star alone, transparent background |
| `nox-app-icon.svg` | The star on a void tile, for avatars and app icons |
| `png/` | The same at 512 to 2048 px, plus a 1200×630 social card |

Colours: void `#05060B`, ink `#ECEFF8`, star `#FFF7E2 → #FFDD82 → #F7B542 → #E9713C`.

Every file here and the web app's `favicon.ico`, `icon.svg` and `apple-icon.png` come from `scripts/brand.mjs`. Change the shapes there and run `node scripts/brand.mjs`, rather than editing the files by hand.
