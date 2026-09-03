#!/usr/bin/env bash
# Патчи amo1c из git (uchetn1/deploy/amo1c-patch) → живой public_html на tech35.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${AMO1C_PATCH_SRC:-$SCRIPT_DIR/amo1c-patch/amo}"
DST="${AMO1C_PUBLIC_AMO:-/root/amo1c_pnevmopodveska1_ru/public_html/amo}"

if [[ ! -d "$SRC" ]]; then
  echo "amo1c-sync: skip (no $SRC)"
  exit 0
fi

shopt -s nullglob
files=("$SRC"/*)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "amo1c-sync: skip (empty patch dir)"
  exit 0
fi

mkdir -p "$DST"
rsync -a "$SRC/" "$DST/"
echo "OK amo1c-sync: ${#files[@]} file(s) → $DST"
