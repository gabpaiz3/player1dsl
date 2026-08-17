#!/bin/sh
# Build the tank-arena reference kernel and launch it in an emulator.
#
# Honours P1_EMULATOR, per SPEC.md 7: "It must accept an explicit emulator
# executable so no user-specific installation path is assumed." The default
# below is a convenience for this machine, not an assumption baked into the
# project.
#
#   sh examples/tank-arena/reference/run.sh
#   P1_EMULATOR="/c/path/to/Stella.exe" sh examples/tank-arena/reference/run.sh
set -eu

EMU="${P1_EMULATOR:-C:/Users/gabpa/tools/stella/Stella-7.0c/Stella.exe}"

cd "$(dirname "$0")/../../.."
sh examples/tank-arena/reference/build.sh

if [ ! -x "$EMU" ] && [ ! -f "$EMU" ]; then
  echo "FAIL: emulator not found at: $EMU" >&2
  echo "      set P1_EMULATOR to your Stella executable" >&2
  exit 1
fi

echo "launching: $EMU build/tank-arena.bin"
exec "$EMU" build/tank-arena.bin
