#!/bin/sh
# Assemble the hand-written tank-arena reference kernel.
#
# DASM is a dev-only dependency: it assembles step 1 and later serves as the
# cross-check for our own TypeScript assembler. It is never a runtime or CI
# dependency. Override its location with DASM=/path/to/dasm.
#
# Output goes to build/reference/, not build/. build/<name>.bin belongs to
# `p1 build`, and one name for both meant a compiler run replaced this baseline.
set -eu

DASM="${DASM:-C:/Users/gabpa/tools/dasm/dasm.exe}"

# Run from the repository root so every path below is relative and portable.
cd "$(dirname "$0")/../../.."
mkdir -p build/reference

"$DASM" examples/tank-arena/reference/tank-arena.asm \
  -Ikernels/include \
  -f3 -v0 \
  -obuild/reference/tank-arena.bin \
  -lbuild/reference/tank-arena.lst \
  -sbuild/reference/tank-arena.sym

size=$(wc -c < build/reference/tank-arena.bin | tr -d ' ')
if [ "$size" -ne 4096 ]; then
  echo "FAIL: ROM is $size bytes, expected 4096 (4 KiB unbanked, SPEC 3)" >&2
  exit 1
fi
echo "OK: build/reference/tank-arena.bin ($size bytes)"
