#!/usr/bin/env bash
# Install the nox CLI from this checkout: links `nox` onto your PATH. Needs Node 18+.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null || { echo "nox needs Node 18 or newer: https://nodejs.org" >&2; exit 1; }
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 18 ] || { echo "nox needs Node 18 or newer (found $(node -v))" >&2; exit 1; }
bin_dir="${NOX_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$bin_dir"
ln -sf "$here/bin/nox.mjs" "$bin_dir/nox"
echo "✓ nox → $bin_dir/nox"
case ":$PATH:" in *":$bin_dir:"*) ;; *) echo "  add $bin_dir to your PATH" ;; esac
echo "Next: nox login --api <your NoX API url>, then in a repo: nox init antigravity"
