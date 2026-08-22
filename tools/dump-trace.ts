/**
 * Print every TIA write of one frame, for measurement.
 *
 * The kernel-shape fixtures exist to be measured, not predicted, and this is
 * how the numbers come out. Run it, read the answer, THEN write the assertion.
 *
 *   npx tsx tools/dump-trace.ts scroll-field
 */

import { Machine } from '../packages/emulator/src/index.ts';
import { formatWrite } from '../packages/emulator/src/trace.ts';
import { romFor } from '../packages/emulator/test/support/roms.ts';

const name = process.argv[2];
if (!name) throw new Error('usage: tsx tools/dump-trace.ts <rom-name>');

const machine = new Machine(romFor(name));
machine.runFrame();
machine.runFrame(); // settle: region state carries across frames
for (const write of machine.runFrame({ trace: true }).writes ?? []) {
  console.log(formatWrite(write));
}
