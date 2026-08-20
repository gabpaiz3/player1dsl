/**
 * Regenerate the committed golden trace.
 *
 * The golden is generated from the HAND-WRITTEN reference ROM, not from any
 * compiler output -- it is a golden of the artifact step 1 produced, which is
 * what makes it a meaningful target for step 3 rather than a tautology.
 *
 * Run: npm run golden
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assemble } from '../packages/assembler/src/index.ts';
import {
  expandScript,
  type InputScript,
  Machine,
  serialiseGolden,
  SWCHB_IDLE,
  toGoldenFrame,
} from '../packages/emulator/src/index.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = `${root}tests/goldens/tank-arena.input.json`;
const outPath = `${root}tests/goldens/tank-arena.trace`;
const romSource = 'examples/tank-arena/reference/tank-arena.asm';

const script = JSON.parse(readFileSync(scriptPath, 'utf8')) as InputScript;
const { rom } = assemble(`${root}${romSource}`, {
  includeDirs: [`${root}kernels/include`],
});

const machine = new Machine(rom);
// Frame 0 is cut short by reset code and frame 1 begins with VBLANK never
// having been set, so its blanked lines misclassify as visible. Frame 2 on is
// steady state -- the same reason frame-timing.test.ts discards two.
for (let i = 0; i < script.settleFrames; i += 1) machine.runFrame();

const swchaByFrame = expandScript(script);
const frames = swchaByFrame.map((swcha, index) =>
  toGoldenFrame(index, swcha, SWCHB_IDLE, machine.runFrame({ swcha, trace: true })),
);

writeFileSync(
  outPath,
  serialiseGolden(frames, {
    rom: romSource,
    input: 'tests/goldens/tank-arena.input.json',
    frames: frames.length,
    settleFrames: script.settleFrames,
  }),
  'utf8',
);

const records = frames.reduce((n, f) => n + f.records.length, 0);
console.log(`wrote ${outPath}: ${frames.length} frames, ${records} records`);
