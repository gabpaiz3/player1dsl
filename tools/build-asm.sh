#!/bin/sh
# Assemble any .asm in this repo against kernels/include.
#   sh tools/build-asm.sh tests/fixtures/timing/wsync-only.asm
# Writes build/reference/<name>.bin plus .lst and .sym.
#
# NOT build/<name>.bin. That is where `p1 build` writes the ROM the COMPILER
# produced, and the two colliding meant a `p1 build` run silently replaced the
# DASM baseline the parity test compares against -- which then reported our
# assembler disagreeing with DASM about a file DASM never assembled.
set -eu
DASM="${DASM:-C:/Users/gabpa/tools/dasm/dasm.exe}"
src="$1"
cd "$(dirname "$0")/.."
name=$(basename "$src" .asm)
mkdir -p build/reference
"$DASM" "$src" -Ikernels/include -f3 -v0 \
  -o"build/reference/$name.bin" -l"build/reference/$name.lst" -s"build/reference/$name.sym"
size=$(wc -c < "build/reference/$name.bin" | tr -d ' ')
[ "$size" -eq 4096 ] || { echo "FAIL: $name is $size bytes, expected 4096" >&2; exit 1; }
echo "OK: build/reference/$name.bin ($size bytes)"
