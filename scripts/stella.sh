#!/bin/sh
# Build the tank-arena ROM from its .p1 and open it in Stella.
#
#   sh scripts/stella.sh
#   sh scripts/stella.sh examples/tank-arena          # any project directory
#   P1_EMULATOR="C:/path/to/Stella.exe" sh scripts/stella.sh
#
# WINDOWS: Stella is not on PATH after a default install, so the default below
# is the documented install location from docs/roadmap.md -- the same
# arrangement examples/tank-arena/reference/build.sh uses for DASM. Override
# with P1_EMULATOR=... anywhere else.
#
# WHAT A STELLA RUN PROVES, and what it does not:
#
#   It is a COMPATIBILITY check against a second implementation, plus a human
#   look at the picture. Our emulator and Stella agreeing that a ROM produces
#   262 scanlines is worth more than either saying so alone, and a human is
#   still the only thing that notices the arena is upside down.
#
#   It is NOT the automated check. A green Stella run never substitutes for a
#   red test, and nothing here may be tuned until Stella looks right -- if the
#   picture and the tests disagree, one of them is measuring the wrong thing and
#   that is the finding.
set -eu

cd "$(dirname "$0")/.."

PROJECT="${1:-examples/tank-arena}"
NAME=$(basename "$PROJECT")
OUT="build/$NAME.bin"
# P1_EMULATOR is the name SPEC 7 gives this, and what run.sh already honours.
STELLA="${P1_EMULATOR:-C:/Users/gabpa/tools/stella/Stella-7.0c/Stella.exe}"

# `tsc --build` emits declarations only, and each workspace package resolves to
# its TypeScript source through its own `exports`. There is no runnable
# dist/main.js to point node at, so the CLI runs through tsx -- which is already
# a devDependency for tools/gen-golden.ts.
npx tsx packages/cli/src/main.ts build "$PROJECT" -o "$OUT"

if ! command -v "$STELLA" >/dev/null 2>&1 && [ ! -f "$STELLA" ]; then
  echo ""
  echo "Stella not found. $OUT is built; open it by hand, or set P1_EMULATOR." >&2
  echo "  P1_EMULATOR=/path/to/stella sh scripts/stella.sh" >&2
  exit 127
fi

exec "$STELLA" "$OUT"
