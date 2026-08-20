#!/bin/sh
# Assemble any .asm in this repo against kernels/include.
#   sh tools/build-asm.sh tests/fixtures/timing/wsync-only.asm
# Writes build/<name>.bin plus .lst and .sym.
set -eu
DASM="${DASM:-C:/Users/gabpa/tools/dasm/dasm.exe}"
src="$1"
cd "$(dirname "$0")/.."
name=$(basename "$src" .asm)
mkdir -p build
"$DASM" "$src" -Ikernels/include -f3 -v0 \
  -o"build/$name.bin" -l"build/$name.lst" -s"build/$name.sym"
size=$(wc -c < "build/$name.bin" | tr -d ' ')
[ "$size" -eq 4096 ] || { echo "FAIL: $name is $size bytes, expected 4096" >&2; exit 1; }
echo "OK: build/$name.bin ($size bytes)"
