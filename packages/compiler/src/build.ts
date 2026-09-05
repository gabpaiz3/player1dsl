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
import { P1Error } from '@player1dsl/parser';
import {
  DIGIT_FONT,
  DIGIT_HEIGHT,
  digitPointers,
  emitFrame,
  emitRowGroup,
  emitTable,
  emitTransition,
  entryById,
  type ObjectBinding,
  type ObjectDraw,
  positioningRoutine,
  positionLines,
  type RowGroupCode,
  type Store,
  stores,
} from '@player1dsl/runtime';
import type { ActorIr, GameIr, SceneIr, ScoreIr, SpriteIr } from './ir.ts';
import { type LayoutIr, layout, type RowGroup } from './layout.ts';
import { buildLedger, type Ledger, type LedgerRow } from './ledger.ts';
import { allocateRam, kernelScratch, type RamMap } from './ram.ts';

export interface StaticBuild {
  /** Exactly 4096 bytes: a 4 KiB unbanked cartridge image. */
  readonly rom: Uint8Array;
  /** The assembly the ROM was made from. */
  readonly source: string;
  readonly ledger: Ledger;
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
 */
export function allocateGameRam(game: GameIr, objects: number, scores = 0): RamMap {
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

export function buildStatic(game: GameIr): StaticBuild {
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
  const firstBand = scene.bands[0];
  const firstBindings = ir.bindings.filter((b) => b.band === firstBand?.name);
  const firstScores = scene.scores.filter((s) => s.band === firstBand?.name);
  const glyphPointers = digitPointers(
    scene.scores.map((score, i) => ({ variable: `${score.name}_score`, pointer: `digit${i}Ptr` })),
    'DigitFont',
  );

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

  const source = emitFrame({
    ram: ramEquates(ram),
    init,
    setup: [...glyphPointers, ...setup],
    setupLines: positionLines(firstBindings.length),
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

  return { rom, source: `${source}\n`, ledger };
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
