/**
 * Kernel templates as assembly.
 *
 * Every fragment here spends exactly the scanlines the LEDGER assigned it. The
 * line count arrives in `EmitContext` and is never recomputed: two places
 * computing the same number is two places to disagree, and the ledger is the
 * gate, so the emitter must be the side that obeys.
 *
 * The emitter also writes only the registers its catalog entry DECLARES.
 * `emit.test.ts` holds it to that, which is what keeps the catalog from being a
 * decorative table -- Task 13's agreement test checks fiction if the code
 * behind an entry writes something the entry never mentions.
 */

import type { ObjectBinding, RowGroupKind, TemplateEntry, TiaObject } from './catalog.ts';
import { registerMnemonic } from './registers.ts';

/** A value written to a TIA register or a RAM symbol, by name. */
export type Store = readonly [target: string, value: number];

/** One movable object drawn by a row group. */
export interface ObjectDraw {
  readonly object: TiaObject;
  readonly color: number;
  /** Label of the graphics table this object's rows are read from. */
  readonly table: string;
  /** Rows in that table. */
  readonly height: number;
  /** Zero-page symbol holding the object's top line, in loop-counter terms. */
  readonly y?: string;
  /** Zero-page symbol holding the next line's graphics byte. */
  readonly gfx?: string;
}

export interface RowGroupContent {
  /** PF0/PF1/PF2 across the lines this group renders. */
  readonly playfield: readonly [number, number, number];
  /** The objects this group draws, in binding order. */
  readonly objects: readonly ObjectDraw[];
  /** Blank lines above the first rendered glyph row. Glyph groups only. */
  readonly leading?: number;
  /** Zero-page symbol the field loop parks its counter in. Loop groups only. */
  readonly scratch?: string;
}

export interface EmitContext {
  /** The row group's kind, from the layout IR. */
  readonly kind: RowGroupKind;
  /** Line count for this row group, from the ledger. Never recomputed here. */
  readonly lines: number;
  /** Object bindings for this band, from the layout IR. */
  readonly bindings: readonly ObjectBinding[];
  /** What this row group draws. */
  readonly content: RowGroupContent;
  /** Prefix for this group's local labels, unique within the frame. */
  readonly label: string;
  /** One line of provenance, written above the fragment. */
  readonly note: string;
}

/**
 * A row group's code, in three parts.
 *
 * `hoist` is the part that does NOT belong on this group's own lines. It is
 * emitted onto the PREVIOUS group's setup line, and it exists because of a
 * measured hblank budget rather than a preference: this band's entry line
 * already spends its whole horizontal blank on PF0 (read at pixel 0), PF1 (16),
 * PF2 (48) and the two GRP clears -- the golden shows GRP0 landing at pixel 1,
 * which is already past the end of blank. Colour writes added there would land
 * around pixel 31. They happen to be safe only because that line clears GRP to
 * $00 by construction, so nothing reads COLUPx on it -- a write whose timing
 * nothing in the model constrains, one scene edit away from mattering. The
 * previous group's setup line has blank to spare, so they go there.
 *
 * The composer emits, for each group i: `setup[i]`, `hoist[i+1]`, `body[i]`.
 */
export interface RowGroupCode {
  readonly hoist: readonly string[];
  readonly setup: readonly string[];
  readonly body: readonly string[];
}

function hex(value: number): string {
  return `$${value.toString(16).padStart(2, '0').toUpperCase()}`;
}

/**
 * `lda #v` then a run of `sta`, reloading only when the value changes.
 *
 * Not a cosmetic saving. The reference reaches COLUP1 on the first visible line
 * at colour clock 66, two cycles inside a 68-clock horizontal blank; a
 * reload before every store spends six more cycles and puts that write in the
 * visible region.
 */
export function stores(pairs: readonly Store[]): string[] {
  const out: string[] = [];
  let loaded: number | null = null;
  for (const [target, value] of pairs) {
    if (loaded !== value) {
      out.push(`    lda #${hex(value)}`);
      loaded = value;
    }
    out.push(`    sta ${target}`);
  }
  return out;
}

/** A counted `sta WSYNC` loop, or nothing at all when the count is zero. */
function wsyncLoop(count: number, label: string): string[] {
  if (count < 0) throw new Error(`a row group cannot spend ${count} scanlines`);
  if (count === 0) return [];
  if (count === 1) return ['    sta WSYNC'];
  return [`    ldx #${count}`, label, '    sta WSYNC', '    dex', `    bne ${label}`];
}

/** The playfield stores for a row group, in deadline order: PF0, PF1, PF2. */
function playfieldStores(content: RowGroupContent): Store[] {
  const [pf0, pf1, pf2] = content.playfield;
  return [
    ['PF0', pf0],
    ['PF1', pf1],
    ['PF2', pf2],
  ];
}

/** `GRP0`/`GRP1` for the nth bound object. */
function grp(index: number): string {
  return registerMnemonic(index === 0 ? 0x1b : 0x1c);
}

function colup(index: number): string {
  return registerMnemonic(index === 0 ? 0x06 : 0x07);
}

/**
 * A glyph band: N blank lines, one indexed row per line, then a clear.
 *
 * The trailing `sta WSYNC` before the GRP clears is load-bearing and MEASURED.
 * The row loop falls through with no horizontal blank left, so clearing GRP
 * there lands at pixel 13 and pixel 22 -- blanking both players before the beam
 * reaches the digit columns. Symptom without it: row 7 of both digits missing.
 */
function emitGlyphs(ctx: EmitContext): RowGroupCode {
  const { content, label, lines } = ctx;
  const objects = content.objects;
  const height = objects[0]?.height ?? 0;
  const leading = content.leading ?? 0;
  const trailing = lines - leading - height - 1;

  if (trailing < 0) {
    throw new Error(
      `a ${lines}-line glyph band cannot hold ${leading} blank lines, ${height} glyph ` +
        'rows and the clear line that follows them',
    );
  }
  if (objects.some((object) => object.height !== height)) {
    throw new Error('a glyph band draws one row per line, so every glyph must be equally tall');
  }

  const rows = objects.flatMap((object, i) => [`    lda ${object.table},y`, `    sta ${grp(i)}`]);

  return {
    hoist: [],
    setup: stores([
      ...playfieldStores(content),
      ...objects.map((object, i): Store => [colup(i), object.color]),
    ]),
    body: [
      ...wsyncLoop(leading, `${label}Top`),
      '    ldy #0',
      `${label}Row`,
      '    sta WSYNC',
      ...rows,
      '    iny',
      `    cpy #${height}`,
      `    bne ${label}Row`,
      '    sta WSYNC               ; the row loop leaves no blank; clear on a fresh line',
      ...stores(objects.map((_, i): Store => [grp(i), 0])),
      ...wsyncLoop(trailing, `${label}Bottom`),
    ],
  };
}

/** A run of identical lines: write the playfield once, then spend the lines. */
function emitRun(ctx: EmitContext): RowGroupCode {
  return {
    hoist: [],
    setup: stores(playfieldStores(ctx.content)),
    body: wsyncLoop(ctx.lines, `${ctx.label}Line`),
  };
}

/**
 * The field loop's entry line: the setup its first rendered line depends on.
 *
 * Spends no WSYNC of its own. The line exists because the loop's per-line
 * writes follow its WSYNC, so the line this setup runs on renders the previous
 * region -- which is exactly what `cost.entryLines` measures, and why the
 * ledger charges it separately from the loop.
 */
function emitEntry(ctx: EmitContext): RowGroupCode {
  const { content } = ctx;
  return {
    hoist: stores(content.objects.map((object, i): Store => [colup(i), object.color])),
    setup: [],
    // Order matters and is MEASURED. The scratch bytes go before the GRP
    // clears so the two GRP writes land where the golden records them, at
    // pixels 1 and 10. Interleaving them costs GRP0 nothing visible today and
    // moves it, which is the sort of drift a golden exists to notice.
    body: stores([
      ...playfieldStores(content),
      ...content.objects.flatMap((object): Store[] => (object.gfx ? [[object.gfx, 0]] : [])),
      ...content.objects.map((_, i): Store => [grp(i), 0]),
    ]),
  };
}

/**
 * The open field: one line per iteration, graphics computed a line ahead.
 *
 * Computing ahead is what keeps both GRP writes inside horizontal blank. Doing
 * it inline pushes the second write into the visible region and tears whichever
 * sprite sits left of the beam. The cost is the entry line above, and the
 * consequence recorded in the reference: a sprite whose top row is computed at
 * counter N appears on line N-1.
 *
 * The trailing `sta WSYNC` is the loop's exit, not an extra line -- it ends the
 * loop's LAST rendered line, which is why `cost.exitLines` is 0. Without it the
 * region-change writes below land in the visible part of that line: measured as
 * a 16-pixel white sliver at the bottom right.
 */
function emitLoop(ctx: EmitContext): RowGroupCode {
  const { content, label, lines } = ctx;
  const scratch = content.scratch;
  if (!scratch) throw new Error('a field loop needs a zero-page symbol to park its counter in');

  const perObject = content.objects.flatMap((object, i): string[] => {
    const { gfx, y, table, height } = object;
    if (!gfx || !y) {
      throw new Error(`object ${object.object} is drawn by a scanning loop but has no gfx or y`);
    }
    const blank = `${label}Blank${i}`;
    const store = `${label}Store${i}`;
    return [
      `    lda ${y}`,
      '    sec',
      `    sbc ${scratch}`,
      `    cmp #${height}          ; unsigned: an underflow lands well above ${height}`,
      `    bcs ${blank}`,
      '    tay',
      `    lda ${table},y`,
      `    jmp ${store}`,
      blank,
      '    lda #0',
      store,
      `    sta ${gfx}`,
    ];
  });

  return {
    hoist: [],
    setup: [],
    body: [
      `    ldx #${lines}`,
      `${label}Line`,
      '    sta WSYNC',
      ...content.objects.flatMap((object, i): string[] =>
        object.gfx ? [`    lda ${object.gfx}`, `    sta ${grp(i)}`] : [],
      ),
      `    stx ${scratch}`,
      ...perObject,
      '    dex',
      `    bne ${label}Line`,
      '    sta WSYNC               ; ends the last rendered line; the exit costs none',
      ...stores(content.objects.map((_, i): Store => [grp(i), 0])),
    ],
  };
}

export function emitRowGroup(entry: TemplateEntry, ctx: EmitContext): RowGroupCode {
  switch (ctx.kind) {
    case 'glyphs':
      return emitGlyphs(ctx);
    case 'run':
      return emitRun(ctx);
    case 'entry':
      return emitEntry(ctx);
    case 'loop':
      return emitLoop(ctx);
    default:
      throw new Error(
        `template "${entry.id}" was asked to draw a "${ctx.kind}" row group, which no ` +
          'template draws: transitions are compiler-derived and emitted by emitTransition',
      );
  }
}

/** The TIA object index PosObjectX takes: 0 = P0, 1 = P1, 2..4 = M0, M1, ball. */
const OBJECT_INDEX: Readonly<Record<TiaObject, number>> = {
  p0: 0,
  p1: 1,
  m0: 2,
  m1: 3,
  ball: 4,
};

export interface TransitionContext {
  /** The objects to reposition, with the zero-page symbol holding each x. */
  readonly moves: readonly { readonly object: TiaObject; readonly x: string }[];
  /**
   * True when this boundary is inside the visible region.
   *
   * A visible boundary pays one extra line to absorb the HMOVE comb, which
   * cannot be suppressed and can only be placed. In vertical blank nothing is
   * drawn, so the comb costs nothing and the line is not spent. That is the
   * difference between `repositionLines` and `positionLines`.
   */
  readonly visible: boolean;
}

/** Reposition movable objects at a band boundary, or in vertical blank. */
export function emitTransition(ctx: TransitionContext): string[] {
  const calls = ctx.moves.flatMap(({ object, x }) => [
    `    lda ${x}`,
    `    ldx #${OBJECT_INDEX[object]}          ; ${object}`,
    '    jsr PosObjectX',
  ]);
  if (!ctx.visible) return calls;
  return [
    ...calls,
    '    sta WSYNC               ; absorb the HMOVE comb on a line still drawn black',
  ];
}

/**
 * The positioning routine, verbatim from the reference kernel.
 *
 * Two scanlines per object, which is what `positionLines` charges. The loop
 * body is 5 CPU cycles = 15 colour clocks, which is the only reason 15 appears
 * here; the hardware granularity is 3 colour clocks. HMPx then trims by -8..+7
 * and HMOVE applies it.
 *
 * HMP0+x covers $20-$24 and RESP0+x covers $10-$14, so one routine serves all
 * five movable objects.
 */
export function positioningRoutine(): string[] {
  return [
    'PosObjectX subroutine',
    '    sta WSYNC               ; line 1: begin from a known beam position',
    '    sec',
    '.divide',
    '    sbc #15                 ; each iteration advances the beam 15 colour clocks',
    '    bcs .divide',
    '    eor #7                  ; remainder -> fine-adjust nibble',
    '    asl',
    '    asl',
    '    asl',
    '    asl',
    '    sta HMP0,x              ; fine adjustment',
    '    sta RESP0,x             ; coarse: strobe at the current beam position',
    '    sta WSYNC               ; line 2',
    '    sta HMOVE               ; must be strobed in blank; costs the left 8 pixels',
    '    rts',
  ];
}

/**
 * A byte table, as assembly.
 *
 * `align` is not decoration. An indexed load that crosses a page boundary
 * costs an extra cycle, and a kernel whose per-line cost depends on where the
 * assembler happened to place a table has a timing nobody can reason about.
 * Aligning makes `lda Table,y` a fixed four cycles.
 */
export function emitTable(label: string, rows: readonly number[], align: number): string[] {
  return [
    `    align ${align}`,
    label,
    ...rows.map((byte) => `    .byte $${byte.toString(16).padStart(2, '0').toUpperCase()}`),
  ];
}
