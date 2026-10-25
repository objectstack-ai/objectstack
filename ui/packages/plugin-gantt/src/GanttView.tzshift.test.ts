/**
 * makeTzShift — business-time-zone rendering shim (业务时区).
 */
import { describe, it, expect } from 'vitest';
import { makeTzShift } from './GanttView';

describe('makeTzShift', () => {
  it('no timeZone → identity', () => {
    const s = makeTzShift(undefined);
    expect(s.delta).toBe(0);
    const d = new Date('2026-07-20T00:00:00Z');
    expect(s.to(d)).toBe(d);
    expect(s.from(d)).toBe(d);
  });

  it('invalid IANA name → identity fallback (no throw)', () => {
    const s = makeTzShift('Not/AZone');
    expect(s.delta).toBe(0);
  });

  it('to/from round-trips to the exact original instant', () => {
    const s = makeTzShift('Asia/Shanghai');
    for (const iso of ['2026-07-20T00:00:00Z', '2026-01-05T13:37:11Z', '2026-12-31T23:59:59Z']) {
      const d = new Date(iso);
      expect(s.from(s.to(d)).getTime()).toBe(d.getTime());
    }
  });

  it('display space reads the configured zone wall time', () => {
    const s = makeTzShift('Asia/Shanghai');
    // 2026-07-20T00:00Z = 08:00 Beijing. Its display-space Date must read
    // 08:00 on the BROWSER-LOCAL clock (that is the whole trick).
    const disp = s.to(new Date('2026-07-20T00:00:00Z'));
    expect(disp.getHours()).toBe(8);
    expect(disp.getDate()).toBe(20);
  });

  it('DST zone round-trips across both regimes', () => {
    const s = makeTzShift('America/New_York');
    for (const iso of ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z']) {
      const d = new Date(iso);
      expect(s.from(s.to(d)).getTime()).toBe(d.getTime());
      expect(s.to(d).getHours()).toBe(iso.startsWith('2026-01') ? 7 : 8);
    }
  });
});
