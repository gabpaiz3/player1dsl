/**
 * Count the scanlines a fragment of emitted assembly spends, by READING it.
 *
 * This is deliberately not a copy of the emitter's arithmetic. The emitter
 * decides a loop's counter from a ledger row; this walks the text it produced
 * and works out how many times `sta WSYNC` actually executes. Two independent
 * routes to the same number is the only reason asserting it proves anything --
 * a helper that asked the emitter would assert that the emitter agrees with
 * itself.
 *
 * It understands exactly the two loop idioms the emitter writes:
 *
 *     ldx #N / label / ... sta WSYNC ... / dex / bne label
 *     ldy #0 / label / ... sta WSYNC ... / iny / cpy #N / bne label
 *
 * and THROWS on a loop containing a WSYNC whose trip count it cannot read. A
 * counter that silently skipped what it did not understand would report a
 * plausible number for a kernel it had not actually measured, which is the
 * "detector that cannot fail" defect this project keeps finding.
 */

const LABEL = /^([.\w]+)$/;
const BNE = /^bne\s+([.\w]+)$/;
const WSYNC = /^sta\s+WSYNC$/;
const LDX_IMM = /^ldx\s+#(\d+)$/;
const CP_IMM = /^cp[xy]\s+#(\d+)$/;

function clean(line: string): string {
  const semi = line.indexOf(';');
  return (semi === -1 ? line : line.slice(0, semi)).trim();
}

/** Trip count of the loop running from `start` to the `bne` at `end`. */
function tripCount(text: readonly string[], start: number, end: number): number {
  // `cpy #N` / `cpx #N` inside the body: the loop runs N times from zero.
  for (let i = start; i <= end; i += 1) {
    const compare = CP_IMM.exec(text[i] ?? '');
    if (compare) return Number(compare[1]);
  }
  // Otherwise a down-counter loaded before the label.
  for (let i = start - 1; i >= 0; i -= 1) {
    const load = LDX_IMM.exec(text[i] ?? '');
    if (load) return Number(load[1]);
  }
  throw new Error(
    `cannot read the trip count of the loop at line ${start + 1}: ` +
      `"${text[start] ?? ''}". This counter understands only the emitter's two ` +
      'loop idioms, and refuses to guess at a third.',
  );
}

export function wsyncLines(lines: readonly string[]): number {
  const text = lines.map(clean);
  const repeats = text.map(() => 1);

  for (let i = 0; i < text.length; i += 1) {
    const branch = BNE.exec(text[i] ?? '');
    if (!branch) continue;
    const label = branch[1];
    const start = text.findIndex((t) => LABEL.test(t) && t === label);
    if (start < 0 || start > i) continue; // a forward branch is not a loop
    if (!text.slice(start, i + 1).some((t) => WSYNC.test(t))) continue; // spends no lines

    const count = tripCount(text, start, i);
    for (let k = start; k <= i; k += 1) repeats[k] = (repeats[k] ?? 1) * count;
  }

  return text.reduce((total, t, i) => (WSYNC.test(t) ? total + (repeats[i] ?? 1) : total), 0);
}
