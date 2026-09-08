/**
 * Layout plus catalog to a 4096-byte ROM.
 *
 * `buildStatic` runs layout -> selector -> ledger -> emitRowGroup per row ->
 * emitFrame -> assemble, and returns the assembly source alongside the bytes.
 * The source is returned deliberately: when a ROM is wrong, reading the text it
 * came from is the entire debugging story, and a build that threw the text away
 * would make every failure a hex dump.
 *
 * STATIC means nothing moves. No input, no collisions, no scoring -- the ROM
 * renders the scene's initial state forever. Everything a rule would change
 * lives in RAM and is written once at reset, which is the shape plan 4 needs
 * when the rules arrive.
 */

import { assembleSource } from '@player1dsl/assembler';
import { type Diagnostic, P1Error } from '@player1dsl/parser';
import {
  CPU_CYCLES_PER_SCANLINE,
  collisionLatch,
  cycleCost,
  DIGIT_FONT,
  DIGIT_HEIGHT,
  digitPointers,
  emitFrame,
  emitRowGroup,
  emitTable,
  emitTransition,
  entryById,
  fragmentCosts,
  type MovementBounds,
  movementBounds,
  NTSC_OVERSCAN_LINES,
  NTSC_VBLANK_LINES,
  type ObjectBinding,
  type ObjectDraw,
  PLAYFIELD_BIT_PIXELS,
  positioningRoutine,
  positionLines,
  type RowGroupCode,
  type Store,
  stores,
  type TiaObject,
} from '@player1dsl/runtime';
import type { ActorIr, GameIr, SceneIr, ScoreIr, SpriteIr } from './ir.ts';
import { type LayoutIr, layout, type RowGroup } from './layout.ts';
import { buildLedger, type Ledger, type LedgerRow } from './ledger.ts';
import { allocateRam, kernelScratch, type RamMap } from './ram.ts';
import { lowerAdd, lowerCollision, lowerMove } from './rules.ts';

export interface BuildResult {
  /** Exactly 4096 bytes: a 4 KiB unbanked cartridge image. */
  readonly rom: Uint8Array;
  /** The assembly the ROM was made from. */
  readonly source: string;
  readonly ledger: Ledger;
  readonly budget: CycleBudget;
}

/** Kept so nothing outside this file has to move. */
export type StaticBuild = BuildResult;

export interface BuildOptions {
  /**
   * Emit the scene's initial state and no rules.
   *
   * NAMED rather than default: `static-build.test.ts` compares this build
   * against golden frame 0, and a flag that silently started meaning "with
   * rules" would leave that test measuring something else while still passing.
   */
  readonly static?: boolean;
}

/**
 * CPU cycles vertical blank contains: 37 scanlines of 76.
 *
 * Positioning spends some of those lines; the rest is the rules'. An untracked
 * cost becomes an assumed zero the compiler will happily spend, which is the
 * property the line ledger exists to prevent, one region over.
 */
export const VBLANK_CYCLE_BUDGET = NTSC_VBLANK_LINES * CPU_CYCLES_PER_SCANLINE;

export interface CycleBudget {
  readonly available: number;
  readonly spent: number;
  readonly free: number;
}

/**
 * Scanlines a block of emitted rule code spends -- and the gate that makes the
 * question answerable at all.
 *
 * A WSYNC aligns the END of a fragment to a line boundary. It does NOT fix how
 * many boundaries the code crossed getting there: a fragment whose worst path
 * is 84 cycles and whose best is 30 spends two lines on one branch and one on
 * the other. So "one fragment, one line" -- which the frame driver's whole
 * WSYNC count rests on -- is true only while every fragment fits inside 76
 * cycles, and E706 is what makes it true rather than hoped for.
 *
 * MEASURED, and the first attempt was wrong. Charging `ceil(worst / 76)` lines
 * instead of refusing was tried first, on the theory that a long rule simply
 * costs more lines. It produced 261-line frames: the short branch really did
 * take one line, so the frame came out a line SHORT wherever contact did not
 * happen. A cost that depends on the input cannot be charged, only refused.
 *
 * The remainder is asserted rather than ignored. Rule blocks end on a WSYNC by
 * construction, so a non-zero remainder means the lowerer emitted a trailing
 * fragment whose cycles land on a line this function cannot see -- and silently
 * dropping them is the assumed zero the ledger exists to prevent.
 */
function ruleLines(rules: readonly string[], ram: RamMap, region: string): number {
  const costs = fragmentCosts(rules, { zeroPage: new Set(ram.slots.keys()) });
  if (costs.remainder !== 0) {
    throw new Error(
      `${region} rules end with ${costs.remainder} cycles after the last WSYNC. Every ` +
        'rule fragment must end on one, or its cost lands on a line nothing charged.',
    );
  }

  const over = costs.fragments.filter((f) => f.cycles > CPU_CYCLES_PER_SCANLINE);
  if (over.length > 0) {
    const worst = Math.max(...over.map((f) => f.cycles));
    throw new P1Error([
      {
        code: 'E706',
        message:
          `a ${region} rule runs ${worst} cycles between WSYNCs, and a scanline is only ` +
          `${CPU_CYCLES_PER_SCANLINE} -- so it spends two lines when its branch is taken ` +
          'and one when it is not',
        span: { file: '<budget>', offset: 0, length: 0, line: 1, column: 1 },
        hint:
          'a frame whose length depends on the input is what the line ledger exists to ' +
          'prevent. Split the rule: each `when` and each movement rule gets its own ' +
          'scanline, so fewer actions in one of them is the fix.',
      } satisfies Diagnostic,
    ]);
  }

  // Provably the line count now: every fragment fits in one line, on every
  // branch, so the count IS the number of WSYNCs the frame driver will see.
  return costs.fragments.length;
}

/**
 * Hold the frame's rules to what vertical blank can actually run.
 *
 * Worst case, counted by READING the emitted assembly rather than by modelling
 * what the lowerer meant to produce. The zero-page set matters: without it
 * `cycleCost` charges every unindexed symbol as absolute, and the allocator is
 * the only thing that knows which are not.
 *
 * `setupLines` here is POSITIONING'S alone. The rules' own lines are counted by
 * `ruleLines` and gated separately, so subtracting them from `available` too
 * would charge the same code twice -- which it did until 2026-09-08, making
 * E704's reported overrun smaller than the real one.
 *
 * REACHABILITY, stated rather than assumed: E705 fires first for every scene
 * tried so far, because a fragment costs at least a line and lines run out
 * before cycles do. E704 remains a true statement -- rules cannot spend more
 * cycles than the region holds -- and covers the un-lined code the line count
 * cannot see, but nothing has yet made it fire. That is recorded in
 * docs/session-logs/2026-09-08.md rather than left to be discovered.
 */
function checkBudget(
  rules: readonly string[],
  setupLines: number,
  ram: RamMap,
  ruleScanlines: number,
): CycleBudget {
  if (setupLines + ruleScanlines >= NTSC_VBLANK_LINES) {
    throw new P1Error([
      {
        code: 'E705',
        message:
          `the frame's rules need ${ruleScanlines} scanlines on top of positioning's ` +
          `${setupLines}, and vertical blank is only ${NTSC_VBLANK_LINES}`,
        span: { file: '<budget>', offset: 0, length: 0, line: 1, column: 1 },
        hint:
          'each movement direction and each collision rule ends on a WSYNC and so spends ' +
          'exactly one scanline -- E706 refuses any that would spend more. This is too ' +
          'many of them: fewer rules, or a kernel that gives vertical blank more lines.',
      },
    ]);
  }
  const available = VBLANK_CYCLE_BUDGET - setupLines * CPU_CYCLES_PER_SCANLINE;
  const spent = cycleCost(rules, { zeroPage: new Set(ram.slots.keys()) });
  if (spent > available) {
    throw new P1Error([
      {
        code: 'E704',
        message:
          `the frame's vertical-blank rules need ${spent} cycles but the region has ` +
          `${available} once positioning has taken its ${setupLines} lines -- ` +
          `${spent - available} over`,
        span: { file: '<budget>', offset: 0, length: 0, line: 1, column: 1 },
        hint:
          'worst case, counted by reading the emitted assembly. Rules that overrun push ' +
          'work into the visible region and tear the first band.',
      },
    ]);
  }
  return { available, spent, free: available - spent };
}

/** 4 KiB unbanked, which is the only cartridge shape the language accepts. */
const CARTRIDGE_BYTES = 4096;

/**
 * Playfield bytes for one horizontal slice of a `border` playfield.
 *
 * The bit order is not left to right: PF0 uses only D4-D7 with D4 leftmost,
 * PF1 runs D7 to D0, and PF2 runs D0 to D7. A fully lit line is therefore
 * $F0/$FF/$FF, and the narrowest left edge is PF0 D4 alone, $10.
 *
 * Side-wall WIDTH is not authored: `border thickness 8` is a scanline count for
 * the top and bottom runs. One playfield block is the narrowest a border can
 * be, and is what the reference draws.
 */
const SOLID_ROW: readonly [number, number, number] = [0xf0, 0xff, 0xff];
const SIDE_ROW: readonly [number, number, number] = [0x10, 0x00, 0x00];

/** D0 of CTRLPF is REF: the right half mirrors the left. */
const CTRLPF_MODE: Readonly<Record<string, number>> = {
  reflect: 0x01,
  repeat: 0x00,
  asymmetric: 0x00,
};

/** A symbol the assembler will accept, built from an authored name. */
function symbol(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '');
}

function spriteLabel(name: string): string {
  const clean = symbol(name);
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}Sprite`;
}

/** Zero-page names for one band's kernel scratch, by binding order. */
function gfxSymbol(index: number): string {
  return `gfx${index}`;
}

const SCRATCH = 'lineTmp';

/**
 * The zero page this build uses: declared variables and kernel scratch together.
 *
 * ONE allocator. The kernel's working bytes -- the graphics byte computed a line
 * ahead, the loop's parked counter -- are not declared by any source line, but
 * they compete for the same 128 bytes as the ones that are. A second allocator
 * would be a second answer to "which byte is free", and the symptom is a sprite
 * whose graphics change when a rule fires.
 *
 * Exported because `p1 check` prints a RAM map, and a map that omitted the
 * kernel's bytes would report free space the build has already spent.
 *
 * `scores` is REQUIRED rather than defaulted, and that is the whole guard. It
 * defaulted to 0 until 2026-09-08, and `p1 check` called this with two
 * arguments while `build` called it with three -- so the map omitted two bytes
 * per score and reported four more free than the build had left. Neither
 * caller was wrong on its face; the default made a missing argument look like
 * an answer. This is the disagreement the comment above says one allocator
 * exists to prevent, arriving through the parameter list instead.
 */
export function allocateGameRam(game: GameIr, objects: number, scores: number): RamMap {
  return allocateRam([...game.variables, ...kernelScratch(objects, scores)]);
}

/** The widest band's object count: how many graphics bytes the kernel needs. */
export function kernelObjects(ir: LayoutIr, scene: SceneIr): number {
  return Math.max(
    ...scene.bands.map((band) => ir.bindings.filter((b) => b.band === band.name).length),
  );
}

/**
 * Zero-page equates, from the one allocator that assigned them.
 *
 * Equates rather than `ds` reservations: `ds` makes the assembler the allocator,
 * and then two things assign addresses. The allocator decides, and the assembly
 * says what it decided.
 */
function ramEquates(map: RamMap): string[] {
  return [...map.slots].map(
    ([name, address]) => `${name.padEnd(16)}= $${address.toString(16).toUpperCase()}`,
  );
}

/**
 * The actor positions a static build writes once at reset.
 *
 * Only the actors. Scores are baked into the glyph pointers a static build
 * computes at assembly time, and the collision debounce has nothing to debounce
 * until rules exist -- writing either here would be initialising state no
 * emitted instruction reads.
 */
function initialState(game: GameIr): Store[] {
  return game.variables
    .filter((variable) => variable.initial !== 0)
    .map((variable): Store => [variable.name, variable.initial]);
}

/** The objects one glyph row group draws: one digit per score in the band. */
function glyphObjects(
  scores: readonly ScoreIr[],
  bindings: readonly ObjectBinding[],
): ObjectDraw[] {
  return scores.map((score, i) => ({
    object: bindings[i]?.object ?? 'p0',
    color: score.color,
    table: `digit${i}Ptr`,
    height: DIGIT_HEIGHT,
  }));
}

/** The objects one field row group draws: one sprite per actor in the band. */
function fieldObjects(
  actors: readonly ActorIr[],
  sprites: readonly SpriteIr[],
  bindings: readonly ObjectBinding[],
): ObjectDraw[] {
  return actors.map((actor, i) => {
    const sprite = sprites.find((s) => s.name === actor.sprite);
    if (!sprite) throw new Error(`actor ${actor.name} uses sprite ${actor.sprite}, which is gone`);
    return {
      object: bindings[i]?.object ?? 'p0',
      color: actor.color,
      table: spriteLabel(sprite.name),
      height: sprite.height,
      y: `${actor.name}_y`,
      gfx: gfxSymbol(i),
    };
  });
}

/**
 * Blank lines above a glyph band's first rendered row.
 *
 * The authored y is the count of blank lines the kernel spends, which renders
 * the first glyph row at y + 1: the band's priming line sits INSIDE its
 * authored height. That is the qualification docs/kernel-measurements.md
 * records under "an entry line can hide inside an authored height", and it is
 * why `bcd-score-band` costs zero entry lines despite having the priming shape.
 */
function leadingLines(scores: readonly ScoreIr[]): number {
  const first = scores[0];
  if (!first) return 0;
  const disagree = scores.find((score) => score.y !== first.y);
  if (disagree) {
    throw new P1Error([
      {
        code: 'E506',
        message:
          `scores "${first.name}" and "${disagree.name}" share a glyph band but sit at ` +
          `y ${first.y} and ${disagree.y}`,
        span: disagree.span,
        hint:
          'a glyph band draws one row of every glyph per scanline, so they all start ' +
          'on the same line. Give them the same y, or put them in separate bands.',
      },
    ]);
  }
  return first.y;
}

/** One row group as code, with the ledger's line count and the scene's content. */
function codeFor(
  group: RowGroup,
  row: LedgerRow,
  scene: SceneIr,
  sprites: readonly SpriteIr[],
  ir: LayoutIr,
  index: number,
): RowGroupCode {
  const label = `.r${index}`;
  const bindings = ir.bindings.filter((b) => b.band === group.band);

  if (group.kind === 'transition') {
    const moves = (group.moves ?? []).map((binding) => ({
      object: binding.object,
      x: `${binding.holder}_x`,
    }));
    return { hoist: [], setup: [], body: emitTransition({ moves, visible: true }) };
  }

  const template = group.template ? entryById(group.template) : undefined;
  if (!template) {
    throw new Error(
      `row group ${index} names template "${group.template}", which is not in ENTRIES`,
    );
  }

  const scores = scene.scores.filter((s) => s.band === group.band);
  const actors = scene.actors.filter((a) => a.band === group.band);

  const content =
    group.kind === 'glyphs'
      ? {
          playfield: [0, 0, 0] as const,
          objects: glyphObjects(scores, bindings),
          leading: leadingLines(scores),
        }
      : group.kind === 'run'
        ? { playfield: SOLID_ROW, objects: [] }
        : {
            playfield: SIDE_ROW,
            objects: fieldObjects(actors, sprites, bindings),
            scratch: SCRATCH,
          };

  return emitRowGroup(template, {
    kind: group.kind,
    lines: row.lines,
    bindings,
    content,
    label,
    note: row.note,
  });
}

/**
 * Every rule the game declares, lowered.
 *
 * Movement runs in VERTICAL BLANK, before positioning, because positioning
 * reads the bytes movement writes. Collision runs in OVERSCAN, because the
 * latches accumulate across the whole visible region and reading them in blank
 * would report the previous frame's contact.
 */
function lowerRules(
  game: GameIr,
  bounds: MovementBounds,
  bindingFor: (actor: string) => TiaObject,
): { readonly blank: string[]; readonly overscan: string[] } {
  const blank = game.everyFrame.actions.flatMap((action, i) =>
    action.kind === 'move' ? lowerMove(action, bounds, `.mv${i}`) : [],
  );

  const overscan = game.collisions.flatMap((rule, i) => {
    const latch = collisionLatch(bindingFor(rule.a), bindingFor(rule.b));
    const actions = rule.actions.flatMap((action, j) =>
      action.kind === 'add' ? lowerAdd(action, SCORE_WRAP, `.sc${i}_${j}`) : [],
    );
    const last = i === game.collisions.length - 1;
    return [
      ...lowerCollision(rule, latch, `.hit${i}`, actions),
      // CXCLR clears every latch at once, so it belongs to the frame rather
      // than to any one rule -- and it must come AFTER the last rule has read
      // what it needs, and BEFORE the WSYNC that ends the line. Strobing it
      // after the WSYNC put it a scanline later than the reference does, which
      // was the only divergence in all 90 golden frames.
      ...(last ? ['    sta CXCLR              ; clear the latches for next frame'] : []),
      // One line per rule, so the cost does not depend on whether contact
      // happened.
      '    sta WSYNC',
    ];
  });
  return { blank, overscan };
}

/** One BCD digit wraps 9 -> 0. SPEC 7.1: multi-digit scores need their own kernel. */
const SCORE_WRAP = 10;

export function build(game: GameIr, options: BuildOptions = {}): BuildResult {
  const scene = game.scene;
  const ir = layout(scene);
  const ledger = buildLedger(ir);

  // The ledger is built from these row groups in order, so the two lists line
  // up one to one. Asserting it rather than assuming it: if they ever stop
  // lining up, every row group below is emitted with another row's line count.
  if (ledger.rows.length !== ir.rowGroups.length) {
    throw new Error(
      `the ledger has ${ledger.rows.length} rows for ${ir.rowGroups.length} row groups`,
    );
  }

  const objects = kernelObjects(ir, scene);
  const ram = allocateGameRam(game, objects, scene.scores.length);

  const codes = ir.rowGroups.map((group, i) => {
    const row = ledger.rows[i];
    if (!row) throw new Error(`no ledger row for row group ${i}`);
    return { group, row, code: codeFor(group, row, scene, game.sprites, ir, i) };
  });

  // The composer: for each group, its own setup, then the NEXT group's hoist,
  // then its lines. The hoist rides this group's setup line because the next
  // group's first line has no horizontal blank left -- see RowGroupCode.
  const kernel = codes.flatMap(({ group, row, code }, i) => [
    '',
    `; ${group.band} ${group.kind}: ${row.lines} line${row.lines === 1 ? '' : 's'}, ` +
      `frame ${row.firstLine}-${row.lastLine}` +
      `${group.template ? ` (${group.template})` : ''}`,
    `;   ${row.note}`,
    ...code.setup,
    ...(codes[i + 1]?.code.hoist ?? []),
    ...code.body,
  ]);

  // The first band positions its objects in vertical blank, where the HMOVE
  // comb falls on a line nothing draws. That is why `positionLines` is charged
  // here and `repositionLines` -- one line more -- at the visible boundary.
  const fieldRow = ledger.rows.find((row) => row.note === 'the open field');
  const firstBand = scene.bands[0];
  const firstBindings = ir.bindings.filter((b) => b.band === firstBand?.name);
  const firstScores = scene.scores.filter((s) => s.band === firstBand?.name);
  const glyphPointers = digitPointers(
    scene.scores.map((score, i) => ({ variable: `${score.name}_score`, pointer: `digit${i}Ptr` })),
    'DigitFont',
  );

  const bounds = movementBounds({
    wallPixels: PLAYFIELD_BIT_PIXELS,
    spriteWidth: game.sprites[0]?.width ?? 8,
    spriteHeight: game.sprites[0]?.height ?? 8,
    fieldFirstLine: fieldRow?.firstLine ?? 0,
    fieldLastLine: fieldRow?.lastLine ?? 0,
    counterOrigin: (fieldRow?.lastLine ?? 0) + 2,
  });
  const bindingFor = (actor: string) => ir.bindings.find((b) => b.holder === actor)?.object ?? 'p0';
  const rules = options.static ? { blank: [], overscan: [] } : lowerRules(game, bounds, bindingFor);

  const setup = emitTransition({
    moves: firstBindings.map((binding, i) => ({
      object: binding.object,
      x: `#${firstScores[i]?.x ?? 0}`,
    })),
    visible: false,
  });

  const playfield = scene.playfields[0];
  const init = emitInit(
    scene,
    playfield?.color ?? 0,
    playfield?.mode ?? 'reflect',
    initialState(game),
  );

  const data = [
    '',
    ...positioningRoutine(),
    '',
    ...emitTable(
      'DigitFont',
      DIGIT_FONT.flatMap((glyph) => [...glyph]),
      256,
    ),
    '',
    '',
    ...game.sprites.flatMap((sprite) => [
      '',
      ...emitTable(spriteLabel(sprite.name), sprite.rows, 8),
    ]),
  ];

  // Rule lines are MEASURED from the emitted text, not multiplied out from a
  // per-rule constant. The frame driver counts WSYNCs, and a fragment spends
  // ceil(cycles / 76) of them -- so `moveRules * 4` was right only while every
  // fragment happened to fit inside one line, and a collision rule with three
  // actions produced a 263-line frame the moment one did not.
  const positioning = positionLines(firstBindings.length);
  const blankRuleLines = ruleLines(rules.blank, ram, 'vertical-blank');
  const overscanRuleLines = ruleLines(rules.overscan, ram, 'overscan');
  const setupLines = positioning + blankRuleLines;

  // Overscan's rules are NOT in this sum. They spend overscan's lines, and
  // charging their cycles against vertical blank made E704 report a region's
  // pressure using another region's code.
  const budget = checkBudget([...rules.blank, ...glyphPointers], positioning, ram, blankRuleLines);

  if (overscanRuleLines >= NTSC_OVERSCAN_LINES) {
    throw new P1Error([
      {
        code: 'E705',
        message:
          `the frame's collision rules need ${overscanRuleLines} scanlines and overscan ` +
          `is only ${NTSC_OVERSCAN_LINES}`,
        span: { file: '<budget>', offset: 0, length: 0, line: 1, column: 1 },
        hint:
          'collision rules run in overscan, because a latch read in vertical blank would ' +
          "report the PREVIOUS frame's contact. A rule spends ceil(cycles / 76) lines.",
      },
    ]);
  }

  const source = emitFrame({
    ram: ramEquates(ram),
    init,
    setup: [...rules.blank, ...glyphPointers, ...setup],
    setupLines,
    overscan: rules.overscan,
    overscanLines: overscanRuleLines,
    kernel,
    data,
  }).join('\n');

  const { rom } = assembleSource(`${source}\n`, `${game.title}.asm`);
  if (rom.byteLength !== CARTRIDGE_BYTES) {
    throw new Error(
      `the assembled image is ${rom.byteLength} bytes, not ${CARTRIDGE_BYTES}: ` +
        'a 4 KiB cartridge is defined by its vectors sitting at $FFFC',
    );
  }

  return { rom, source: `${source}\n`, ledger, budget };
}

/**
 * The static build, by name.
 *
 * Kept as its own function so a caller cannot get one by accident, and so
 * `static-build.test.ts` names what it is comparing against golden frame 0.
 */
export function buildStatic(game: GameIr): BuildResult {
  return build(game, { static: true });
}

/** One-time TIA state and the scene's starting positions. */
function emitInit(
  scene: SceneIr,
  wallColor: number,
  mode: string,
  positions: readonly Store[],
): string[] {
  return [
    '; --- one-time setup ---',
    ...stores([
      ['COLUBK', scene.background],
      ['COLUPF', wallColor],
      ['CTRLPF', CTRLPF_MODE[mode] ?? 0],
      ...positions,
    ]),
  ];
}
