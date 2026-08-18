import type { Bus } from './bus.ts';

/**
 * 6507 CPU core (a 6502 with 13 address lines).
 *
 * Integer discipline throughout: every register is masked on write, every
 * address is masked to 16 bits before the bus masks it to 13. No value is ever
 * allowed to leave its width, because a silent overflow here surfaces later as
 * a graphics glitch rather than an exception.
 *
 * Unknown opcodes THROW. A partial core that silently treats an unimplemented
 * opcode as a NOP produces plausible-but-wrong timing, which is precisely the
 * failure this emulator exists to catch.
 */

const FLAG_C = 0x01;
const FLAG_Z = 0x02;
const FLAG_I = 0x04;
const FLAG_D = 0x08;
const FLAG_B = 0x10;
const FLAG_U = 0x20;
const FLAG_V = 0x40;
const FLAG_N = 0x80;

export class Cpu {
  a = 0;
  x = 0;
  y = 0;
  sp = 0xfd;
  pc = 0;
  status = FLAG_U | FLAG_I;

  /** Cycles consumed by the most recent step(). */
  private cycles = 0;

  constructor(private readonly bus: Bus) {}

  reset(): void {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xfd;
    this.status = FLAG_U | FLAG_I;
    const lo = this.bus.read(0xfffc);
    const hi = this.bus.read(0xfffd);
    this.pc = ((hi << 8) | lo) & 0xffff;
  }

  // --- flag helpers --------------------------------------------------------
  private setFlag(mask: number, on: boolean): void {
    this.status = on ? this.status | mask : this.status & ~mask & 0xff;
  }

  private getFlag(mask: number): boolean {
    return (this.status & mask) !== 0;
  }

  private setZN(value: number): number {
    const v = value & 0xff;
    this.setFlag(FLAG_Z, v === 0);
    this.setFlag(FLAG_N, (v & 0x80) !== 0);
    return v;
  }

  // --- memory helpers ------------------------------------------------------
  private fetch(): number {
    const v = this.bus.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v & 0xff;
  }

  private fetch16(): number {
    const lo = this.fetch();
    const hi = this.fetch();
    return ((hi << 8) | lo) & 0xffff;
  }

  private push(value: number): void {
    this.bus.write(0x0100 | (this.sp & 0xff), value & 0xff);
    this.sp = (this.sp - 1) & 0xff;
  }

  private pull(): number {
    this.sp = (this.sp + 1) & 0xff;
    return this.bus.read(0x0100 | (this.sp & 0xff)) & 0xff;
  }

  // --- addressing modes ----------------------------------------------------
  private addrZeroPage(): number {
    return this.fetch();
  }

  private addrZeroPageX(): number {
    return (this.fetch() + this.x) & 0xff;
  }

  private addrZeroPageY(): number {
    return (this.fetch() + this.y) & 0xff;
  }

  private addrAbsolute(): number {
    return this.fetch16();
  }

  /** Absolute,X. Adds a cycle on page cross when `penalise` is set (reads). */
  private addrAbsoluteX(penalise: boolean): number {
    const base = this.fetch16();
    const addr = (base + this.x) & 0xffff;
    if (penalise && (base & 0xff00) !== (addr & 0xff00)) this.cycles += 1;
    return addr;
  }

  private addrAbsoluteY(penalise: boolean): number {
    const base = this.fetch16();
    const addr = (base + this.y) & 0xffff;
    if (penalise && (base & 0xff00) !== (addr & 0xff00)) this.cycles += 1;
    return addr;
  }

  private addrIndirectX(): number {
    const zp = (this.fetch() + this.x) & 0xff;
    const lo = this.bus.read(zp);
    const hi = this.bus.read((zp + 1) & 0xff);
    return ((hi << 8) | lo) & 0xffff;
  }

  private addrIndirectY(penalise: boolean): number {
    const zp = this.fetch();
    const lo = this.bus.read(zp);
    const hi = this.bus.read((zp + 1) & 0xff);
    const base = ((hi << 8) | lo) & 0xffff;
    const addr = (base + this.y) & 0xffff;
    if (penalise && (base & 0xff00) !== (addr & 0xff00)) this.cycles += 1;
    return addr;
  }

  // --- operations ----------------------------------------------------------
  private branch(condition: boolean): void {
    const offset = this.fetch();
    if (!condition) return;
    const signed = offset < 0x80 ? offset : offset - 0x100;
    const target = (this.pc + signed) & 0xffff;
    this.cycles += (this.pc & 0xff00) !== (target & 0xff00) ? 2 : 1;
    this.pc = target;
  }

  private adc(value: number): void {
    const v = value & 0xff;
    const carry = this.getFlag(FLAG_C) ? 1 : 0;
    if (this.getFlag(FLAG_D)) {
      // The 6507 has working decimal mode, unlike the NES's 2A03. This is what
      // makes a BCD score kernel sound.
      let lo = (this.a & 0x0f) + (v & 0x0f) + carry;
      let hi = (this.a >> 4) + (v >> 4);
      if (lo > 9) {
        lo += 6;
        hi += 1;
      }
      this.setFlag(FLAG_Z, ((this.a + v + carry) & 0xff) === 0);
      this.setFlag(FLAG_N, (hi & 0x08) !== 0);
      this.setFlag(FLAG_V, false);
      if (hi > 9) hi += 6;
      this.setFlag(FLAG_C, hi > 15);
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff;
      return;
    }
    const sum = this.a + v + carry;
    const result = sum & 0xff;
    this.setFlag(FLAG_C, sum > 0xff);
    this.setFlag(FLAG_V, ((this.a ^ result) & (v ^ result) & 0x80) !== 0);
    this.a = this.setZN(result);
  }

  private sbc(value: number): void {
    const v = value & 0xff;
    if (this.getFlag(FLAG_D)) {
      const carry = this.getFlag(FLAG_C) ? 1 : 0;
      let lo = (this.a & 0x0f) - (v & 0x0f) - (1 - carry);
      let hi = (this.a >> 4) - (v >> 4);
      if (lo & 0x10) {
        lo -= 6;
        hi -= 1;
      }
      if (hi & 0x10) hi -= 6;
      const diff = this.a - v - (1 - carry);
      this.setFlag(FLAG_C, (diff & 0x100) === 0);
      this.setFlag(FLAG_V, ((this.a ^ diff) & (this.a ^ v) & 0x80) !== 0);
      this.setZN(diff & 0xff);
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff;
      return;
    }
    this.adc(v ^ 0xff);
  }

  private compare(register: number, value: number): void {
    const diff = (register - (value & 0xff)) & 0x1ff;
    this.setFlag(FLAG_C, register >= (value & 0xff));
    this.setZN(diff & 0xff);
  }

  private aslMem(addr: number): void {
    const v = this.bus.read(addr);
    this.setFlag(FLAG_C, (v & 0x80) !== 0);
    this.bus.write(addr, this.setZN((v << 1) & 0xff));
  }

  private lsrMem(addr: number): void {
    const v = this.bus.read(addr);
    this.setFlag(FLAG_C, (v & 0x01) !== 0);
    this.bus.write(addr, this.setZN(v >> 1));
  }

  private rolMem(addr: number): void {
    const v = this.bus.read(addr);
    const carry = this.getFlag(FLAG_C) ? 1 : 0;
    this.setFlag(FLAG_C, (v & 0x80) !== 0);
    this.bus.write(addr, this.setZN(((v << 1) | carry) & 0xff));
  }

  private rorMem(addr: number): void {
    const v = this.bus.read(addr);
    const carry = this.getFlag(FLAG_C) ? 0x80 : 0;
    this.setFlag(FLAG_C, (v & 0x01) !== 0);
    this.bus.write(addr, this.setZN((v >> 1) | carry));
  }

  private bitTest(addr: number): void {
    const v = this.bus.read(addr) & 0xff;
    this.setFlag(FLAG_Z, (this.a & v) === 0);
    this.setFlag(FLAG_N, (v & 0x80) !== 0);
    this.setFlag(FLAG_V, (v & 0x40) !== 0);
  }

  /** Execute one instruction. Returns the CPU cycles it consumed. */
  step(): number {
    const opcode = this.fetch();
    this.cycles = BASE_CYCLES[opcode] ?? 0;

    switch (opcode) {
      // --- LDA ---
      case 0xa9: this.a = this.setZN(this.fetch()); break;
      case 0xa5: this.a = this.setZN(this.bus.read(this.addrZeroPage())); break;
      case 0xb5: this.a = this.setZN(this.bus.read(this.addrZeroPageX())); break;
      case 0xad: this.a = this.setZN(this.bus.read(this.addrAbsolute())); break;
      case 0xbd: this.a = this.setZN(this.bus.read(this.addrAbsoluteX(true))); break;
      case 0xb9: this.a = this.setZN(this.bus.read(this.addrAbsoluteY(true))); break;
      case 0xa1: this.a = this.setZN(this.bus.read(this.addrIndirectX())); break;
      case 0xb1: this.a = this.setZN(this.bus.read(this.addrIndirectY(true))); break;

      // --- LDX / LDY ---
      case 0xa2: this.x = this.setZN(this.fetch()); break;
      case 0xa6: this.x = this.setZN(this.bus.read(this.addrZeroPage())); break;
      case 0xb6: this.x = this.setZN(this.bus.read(this.addrZeroPageY())); break;
      case 0xae: this.x = this.setZN(this.bus.read(this.addrAbsolute())); break;
      case 0xbe: this.x = this.setZN(this.bus.read(this.addrAbsoluteY(true))); break;
      case 0xa0: this.y = this.setZN(this.fetch()); break;
      case 0xa4: this.y = this.setZN(this.bus.read(this.addrZeroPage())); break;
      case 0xb4: this.y = this.setZN(this.bus.read(this.addrZeroPageX())); break;
      case 0xac: this.y = this.setZN(this.bus.read(this.addrAbsolute())); break;
      case 0xbc: this.y = this.setZN(this.bus.read(this.addrAbsoluteX(true))); break;

      // --- STA / STX / STY ---
      case 0x85: this.bus.write(this.addrZeroPage(), this.a); break;
      case 0x95: this.bus.write(this.addrZeroPageX(), this.a); break;
      case 0x8d: this.bus.write(this.addrAbsolute(), this.a); break;
      case 0x9d: this.bus.write(this.addrAbsoluteX(false), this.a); break;
      case 0x99: this.bus.write(this.addrAbsoluteY(false), this.a); break;
      case 0x81: this.bus.write(this.addrIndirectX(), this.a); break;
      case 0x91: this.bus.write(this.addrIndirectY(false), this.a); break;
      case 0x86: this.bus.write(this.addrZeroPage(), this.x); break;
      case 0x96: this.bus.write(this.addrZeroPageY(), this.x); break;
      case 0x8e: this.bus.write(this.addrAbsolute(), this.x); break;
      case 0x84: this.bus.write(this.addrZeroPage(), this.y); break;
      case 0x94: this.bus.write(this.addrZeroPageX(), this.y); break;
      case 0x8c: this.bus.write(this.addrAbsolute(), this.y); break;

      // --- transfers ---
      case 0xaa: this.x = this.setZN(this.a); break;
      case 0xa8: this.y = this.setZN(this.a); break;
      case 0x8a: this.a = this.setZN(this.x); break;
      case 0x98: this.a = this.setZN(this.y); break;
      case 0xba: this.x = this.setZN(this.sp); break;
      case 0x9a: this.sp = this.x & 0xff; break;

      // --- stack ---
      case 0x48: this.push(this.a); break;
      case 0x68: this.a = this.setZN(this.pull()); break;
      case 0x08: this.push(this.status | FLAG_B | FLAG_U); break;
      case 0x28: this.status = (this.pull() | FLAG_U) & ~FLAG_B & 0xff; break;

      // --- logic ---
      case 0x29: this.a = this.setZN(this.a & this.fetch()); break;
      case 0x25: this.a = this.setZN(this.a & this.bus.read(this.addrZeroPage())); break;
      case 0x35: this.a = this.setZN(this.a & this.bus.read(this.addrZeroPageX())); break;
      case 0x2d: this.a = this.setZN(this.a & this.bus.read(this.addrAbsolute())); break;
      case 0x3d: this.a = this.setZN(this.a & this.bus.read(this.addrAbsoluteX(true))); break;
      case 0x39: this.a = this.setZN(this.a & this.bus.read(this.addrAbsoluteY(true))); break;
      case 0x09: this.a = this.setZN(this.a | this.fetch()); break;
      case 0x05: this.a = this.setZN(this.a | this.bus.read(this.addrZeroPage())); break;
      case 0x15: this.a = this.setZN(this.a | this.bus.read(this.addrZeroPageX())); break;
      case 0x0d: this.a = this.setZN(this.a | this.bus.read(this.addrAbsolute())); break;
      case 0x1d: this.a = this.setZN(this.a | this.bus.read(this.addrAbsoluteX(true))); break;
      case 0x19: this.a = this.setZN(this.a | this.bus.read(this.addrAbsoluteY(true))); break;
      case 0x49: this.a = this.setZN(this.a ^ this.fetch()); break;
      case 0x45: this.a = this.setZN(this.a ^ this.bus.read(this.addrZeroPage())); break;
      case 0x55: this.a = this.setZN(this.a ^ this.bus.read(this.addrZeroPageX())); break;
      case 0x4d: this.a = this.setZN(this.a ^ this.bus.read(this.addrAbsolute())); break;
      case 0x5d: this.a = this.setZN(this.a ^ this.bus.read(this.addrAbsoluteX(true))); break;
      case 0x59: this.a = this.setZN(this.a ^ this.bus.read(this.addrAbsoluteY(true))); break;
      case 0x24: this.bitTest(this.addrZeroPage()); break;
      case 0x2c: this.bitTest(this.addrAbsolute()); break;

      // --- arithmetic ---
      case 0x69: this.adc(this.fetch()); break;
      case 0x65: this.adc(this.bus.read(this.addrZeroPage())); break;
      case 0x75: this.adc(this.bus.read(this.addrZeroPageX())); break;
      case 0x6d: this.adc(this.bus.read(this.addrAbsolute())); break;
      case 0x7d: this.adc(this.bus.read(this.addrAbsoluteX(true))); break;
      case 0x79: this.adc(this.bus.read(this.addrAbsoluteY(true))); break;
      case 0xe9: this.sbc(this.fetch()); break;
      case 0xe5: this.sbc(this.bus.read(this.addrZeroPage())); break;
      case 0xf5: this.sbc(this.bus.read(this.addrZeroPageX())); break;
      case 0xed: this.sbc(this.bus.read(this.addrAbsolute())); break;
      case 0xfd: this.sbc(this.bus.read(this.addrAbsoluteX(true))); break;
      case 0xf9: this.sbc(this.bus.read(this.addrAbsoluteY(true))); break;
      case 0xc9: this.compare(this.a, this.fetch()); break;
      case 0xc5: this.compare(this.a, this.bus.read(this.addrZeroPage())); break;
      case 0xd5: this.compare(this.a, this.bus.read(this.addrZeroPageX())); break;
      case 0xcd: this.compare(this.a, this.bus.read(this.addrAbsolute())); break;
      case 0xdd: this.compare(this.a, this.bus.read(this.addrAbsoluteX(true))); break;
      case 0xd9: this.compare(this.a, this.bus.read(this.addrAbsoluteY(true))); break;
      case 0xe0: this.compare(this.x, this.fetch()); break;
      case 0xe4: this.compare(this.x, this.bus.read(this.addrZeroPage())); break;
      case 0xec: this.compare(this.x, this.bus.read(this.addrAbsolute())); break;
      case 0xc0: this.compare(this.y, this.fetch()); break;
      case 0xc4: this.compare(this.y, this.bus.read(this.addrZeroPage())); break;
      case 0xcc: this.compare(this.y, this.bus.read(this.addrAbsolute())); break;

      // --- inc / dec ---
      case 0xe6: { const a = this.addrZeroPage(); this.bus.write(a, this.setZN(this.bus.read(a) + 1)); break; }
      case 0xf6: { const a = this.addrZeroPageX(); this.bus.write(a, this.setZN(this.bus.read(a) + 1)); break; }
      case 0xee: { const a = this.addrAbsolute(); this.bus.write(a, this.setZN(this.bus.read(a) + 1)); break; }
      case 0xfe: { const a = this.addrAbsoluteX(false); this.bus.write(a, this.setZN(this.bus.read(a) + 1)); break; }
      case 0xc6: { const a = this.addrZeroPage(); this.bus.write(a, this.setZN(this.bus.read(a) - 1)); break; }
      case 0xd6: { const a = this.addrZeroPageX(); this.bus.write(a, this.setZN(this.bus.read(a) - 1)); break; }
      case 0xce: { const a = this.addrAbsolute(); this.bus.write(a, this.setZN(this.bus.read(a) - 1)); break; }
      case 0xde: { const a = this.addrAbsoluteX(false); this.bus.write(a, this.setZN(this.bus.read(a) - 1)); break; }
      case 0xe8: this.x = this.setZN(this.x + 1); break;
      case 0xc8: this.y = this.setZN(this.y + 1); break;
      case 0xca: this.x = this.setZN(this.x - 1); break;
      case 0x88: this.y = this.setZN(this.y - 1); break;

      // --- shifts ---
      case 0x0a: this.setFlag(FLAG_C, (this.a & 0x80) !== 0); this.a = this.setZN(this.a << 1); break;
      case 0x06: this.aslMem(this.addrZeroPage()); break;
      case 0x16: this.aslMem(this.addrZeroPageX()); break;
      case 0x0e: this.aslMem(this.addrAbsolute()); break;
      case 0x1e: this.aslMem(this.addrAbsoluteX(false)); break;
      case 0x4a: this.setFlag(FLAG_C, (this.a & 0x01) !== 0); this.a = this.setZN(this.a >> 1); break;
      case 0x46: this.lsrMem(this.addrZeroPage()); break;
      case 0x56: this.lsrMem(this.addrZeroPageX()); break;
      case 0x4e: this.lsrMem(this.addrAbsolute()); break;
      case 0x5e: this.lsrMem(this.addrAbsoluteX(false)); break;
      case 0x2a: { const c = this.getFlag(FLAG_C) ? 1 : 0; this.setFlag(FLAG_C, (this.a & 0x80) !== 0); this.a = this.setZN((this.a << 1) | c); break; }
      case 0x26: this.rolMem(this.addrZeroPage()); break;
      case 0x36: this.rolMem(this.addrZeroPageX()); break;
      case 0x2e: this.rolMem(this.addrAbsolute()); break;
      case 0x3e: this.rolMem(this.addrAbsoluteX(false)); break;
      case 0x6a: { const c = this.getFlag(FLAG_C) ? 0x80 : 0; this.setFlag(FLAG_C, (this.a & 0x01) !== 0); this.a = this.setZN((this.a >> 1) | c); break; }
      case 0x66: this.rorMem(this.addrZeroPage()); break;
      case 0x76: this.rorMem(this.addrZeroPageX()); break;
      case 0x6e: this.rorMem(this.addrAbsolute()); break;
      case 0x7e: this.rorMem(this.addrAbsoluteX(false)); break;

      // --- jumps and subroutines ---
      case 0x4c: this.pc = this.addrAbsolute(); break;
      case 0x6c: {
        const ptr = this.addrAbsolute();
        const lo = this.bus.read(ptr);
        // The documented JMP (indirect) page-boundary bug: the high byte is
        // fetched from the same page, not the next one.
        const hi = this.bus.read((ptr & 0xff00) | ((ptr + 1) & 0xff));
        this.pc = ((hi << 8) | lo) & 0xffff;
        break;
      }
      case 0x20: {
        const target = this.addrAbsolute();
        const ret = (this.pc - 1) & 0xffff;
        this.push((ret >> 8) & 0xff);
        this.push(ret & 0xff);
        this.pc = target;
        break;
      }
      case 0x60: {
        const lo = this.pull();
        const hi = this.pull();
        this.pc = (((hi << 8) | lo) + 1) & 0xffff;
        break;
      }
      case 0x40: {
        this.status = (this.pull() | FLAG_U) & ~FLAG_B & 0xff;
        const lo = this.pull();
        const hi = this.pull();
        this.pc = ((hi << 8) | lo) & 0xffff;
        break;
      }

      // --- branches ---
      case 0x10: this.branch(!this.getFlag(FLAG_N)); break;
      case 0x30: this.branch(this.getFlag(FLAG_N)); break;
      case 0x50: this.branch(!this.getFlag(FLAG_V)); break;
      case 0x70: this.branch(this.getFlag(FLAG_V)); break;
      case 0x90: this.branch(!this.getFlag(FLAG_C)); break;
      case 0xb0: this.branch(this.getFlag(FLAG_C)); break;
      case 0xd0: this.branch(!this.getFlag(FLAG_Z)); break;
      case 0xf0: this.branch(this.getFlag(FLAG_Z)); break;

      // --- flags ---
      case 0x18: this.setFlag(FLAG_C, false); break;
      case 0x38: this.setFlag(FLAG_C, true); break;
      case 0x58: this.setFlag(FLAG_I, false); break;
      case 0x78: this.setFlag(FLAG_I, true); break;
      case 0xb8: this.setFlag(FLAG_V, false); break;
      case 0xd8: this.setFlag(FLAG_D, false); break;
      case 0xf8: this.setFlag(FLAG_D, true); break;

      case 0xea: break; // NOP
      case 0x00: {      // BRK
        this.pc = (this.pc + 1) & 0xffff;
        this.push((this.pc >> 8) & 0xff);
        this.push(this.pc & 0xff);
        this.push(this.status | FLAG_B | FLAG_U);
        this.setFlag(FLAG_I, true);
        const lo = this.bus.read(0xfffe);
        const hi = this.bus.read(0xffff);
        this.pc = ((hi << 8) | lo) & 0xffff;
        break;
      }

      default:
        throw new Error(
          `unimplemented opcode $${opcode.toString(16).padStart(2, '0')} at $${((this.pc - 1) & 0xffff).toString(16).padStart(4, '0')}`,
        );
    }

    return this.cycles;
  }
}

/** Base cycle counts; addressing modes and branches add penalties. */
const BASE_CYCLES: readonly number[] = [
  7, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 0, 4, 6, 0, // 0x
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0, // 1x
  6, 6, 0, 0, 3, 3, 5, 0, 4, 2, 2, 0, 4, 4, 6, 0, // 2x
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0, // 3x
  6, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 3, 4, 6, 0, // 4x
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0, // 5x
  6, 6, 0, 0, 0, 3, 5, 0, 4, 2, 2, 0, 5, 4, 6, 0, // 6x
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0, // 7x
  0, 6, 0, 0, 3, 3, 3, 0, 2, 0, 2, 0, 4, 4, 4, 0, // 8x
  2, 6, 0, 0, 4, 4, 4, 0, 2, 5, 2, 0, 0, 5, 0, 0, // 9x
  2, 6, 2, 0, 3, 3, 3, 0, 2, 2, 2, 0, 4, 4, 4, 0, // Ax
  2, 5, 0, 0, 4, 4, 4, 0, 2, 4, 2, 0, 4, 4, 4, 0, // Bx
  2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0, // Cx
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0, // Dx
  2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0, // Ex
  2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0, // Fx
];
