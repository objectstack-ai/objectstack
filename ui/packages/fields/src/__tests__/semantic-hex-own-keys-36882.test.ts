/**
 * objectstack#36882 (seat note N4) — `getSemanticHex` maps a palette family to
 * its -500 hex for inline-style painters (the gantt bar and alert stroke). The
 * gantt now hands it author input, a declared option colour, so a name spelled
 * like an inherited key must take the fallback like any other unknown name.
 */
import { describe, it, expect } from 'vitest';
import { getSemanticHex } from '../index';

describe('getSemanticHex reads own palette keys only (objectstack#36882)', () => {
  it('a family maps to its palette hex', () => {
    expect(getSemanticHex('blue', 'x')).toBe('#3b82f6');
    expect(getSemanticHex('red', 'x')).toBe('#ef4444');
  });

  it('a name spelled like an inherited key takes the fallback, never a function', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(getSemanticHex(name, name)).toBe(name);
    }
  });
});
