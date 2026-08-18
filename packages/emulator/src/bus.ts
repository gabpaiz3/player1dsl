import type { Riot } from './riot.ts';
import type { Tia } from './tia.ts';

/**
 * 6507 address decoding.
 *
 * The 6507 bonds out only 13 address lines, so the whole address space is
 * 8 KiB and everything above mirrors down into it. That is also why a 4 KiB
 * cartridge is the unbanked maximum.
 *
 *   A12 set        -> cartridge ROM
 *   A7 clear       -> TIA
 *   A9 set         -> RIOT registers
 *   otherwise      -> RIOT RAM ($80-$FF)
 */
export class Bus {
  constructor(
    private readonly rom: Uint8Array,
    readonly tia: Tia,
    readonly riot: Riot,
  ) {
    if (rom.length !== 4096) {
      throw new Error(`expected a 4096-byte ROM, got ${rom.length} bytes`);
    }
  }

  read(address: number): number {
    const addr = address & 0x1fff;

    if ((addr & 0x1000) !== 0) {
      return this.rom[addr & 0x0fff] ?? 0;
    }
    if ((addr & 0x0080) === 0) {
      return this.tia.read(addr & 0x0f);
    }
    if ((addr & 0x0200) !== 0) {
      return this.riot.read(addr & 0x029f);
    }
    return this.riot.ram[addr & 0x7f] ?? 0;
  }

  write(address: number, value: number): void {
    const addr = address & 0x1fff;
    const v = value & 0xff;

    if ((addr & 0x1000) !== 0) {
      return; // ROM writes are ignored on an unbanked cartridge
    }
    if ((addr & 0x0080) === 0) {
      this.tia.write(addr & 0x3f, v);
      return;
    }
    if ((addr & 0x0200) !== 0) {
      this.riot.write(addr & 0x029f, v);
      return;
    }
    this.riot.ram[addr & 0x7f] = v;
  }
}
