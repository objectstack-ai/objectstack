import { describe, it, expect } from 'vitest';
import {
  parseHHMM,
  normalizeShiftSegments,
  shiftDayStart,
  bandAt,
} from './shifts';

const HOUR = 60 * 60 * 1000;

describe('parseHHMM', () => {
  it('parses valid times to minutes after midnight', () => {
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('08:00')).toBe(480);
    expect(parseHHMM('20:30')).toBe(1230);
    expect(parseHHMM('23:59')).toBe(1439);
  });
  it('rejects malformed / out-of-range values', () => {
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('8')).toBeNull();
    expect(parseHHMM('08:60')).toBeNull();
    expect(parseHHMM(undefined)).toBeNull();
    expect(parseHHMM('')).toBeNull();
  });
});

describe('normalizeShiftSegments', () => {
  it('returns null for empty / missing config', () => {
    expect(normalizeShiftSegments(null)).toBeNull();
    expect(normalizeShiftSegments(undefined)).toBeNull();
    expect(normalizeShiftSegments({ bands: [] })).toBeNull();
  });

  it('normalizes the 08:00/20:00 two-shift factory', () => {
    const seg = normalizeShiftSegments({
      dayStart: '08:00',
      bands: [
        { key: 'day', label: '白班', start: '08:00', end: '20:00' },
        { key: 'night', label: '夜班', start: '20:00', end: '08:00' },
      ],
    });
    expect(seg).not.toBeNull();
    expect(seg!.dayStartMin).toBe(480);
    expect(seg!.bands).toHaveLength(2);
    // both halves are 12h
    expect(seg!.bands[0].durMs).toBe(12 * HOUR);
    expect(seg!.bands[1].durMs).toBe(12 * HOUR); // 20:00 → 08:00 crosses midnight
  });

  it('defaults dayStart to midnight and synthesizes band keys', () => {
    const seg = normalizeShiftSegments({
      bands: [
        { label: 'AM', start: '00:00', end: '12:00' },
        { label: 'PM', start: '12:00', end: '00:00' },
      ],
    });
    expect(seg!.dayStartMin).toBe(0);
    expect(seg!.bands[0].key).toBe('band0');
    expect(seg!.bands[1].durMs).toBe(12 * HOUR); // 12:00 → 00:00 = 12h
  });

  it('rejects a config with a malformed band time', () => {
    expect(
      normalizeShiftSegments({ bands: [{ label: 'x', start: 'oops', end: '08:00' }] }),
    ).toBeNull();
  });
});

describe('shiftDayStart', () => {
  const seg = normalizeShiftSegments({
    dayStart: '08:00',
    bands: [
      { key: 'day', label: '白班', start: '08:00', end: '20:00' },
      { key: 'night', label: '夜班', start: '20:00', end: '08:00' },
    ],
  })!;

  it('floors an afternoon instant to the same-day 08:00', () => {
    const r = shiftDayStart(new Date(2026, 5, 4, 15, 0), 480);
    expect(r.getTime()).toBe(new Date(2026, 5, 4, 8, 0).getTime());
  });

  it('floors a post-midnight night-shift instant back to the PREVIOUS 08:00', () => {
    // 6/5 03:00 is still 6/4 night shift → shift-day is 6/4 08:00
    const r = shiftDayStart(new Date(2026, 5, 5, 3, 0), 480);
    expect(r.getTime()).toBe(new Date(2026, 5, 4, 8, 0).getTime());
  });

  it('floors exactly 08:00 to itself', () => {
    const r = shiftDayStart(new Date(2026, 5, 4, 8, 0), 480);
    expect(r.getTime()).toBe(new Date(2026, 5, 4, 8, 0).getTime());
  });

  void seg;
});

describe('bandAt — attribution by start', () => {
  const seg = normalizeShiftSegments({
    dayStart: '08:00',
    bands: [
      { key: 'day', label: '白班', start: '08:00', end: '20:00' },
      { key: 'night', label: '夜班', start: '20:00', end: '08:00' },
    ],
  })!;

  it('08:00 start → 白班', () => {
    expect(bandAt(new Date(2026, 5, 4, 8, 0), seg)!.key).toBe('day');
  });
  it('19:59 start → 白班 (boundary just before 20:00)', () => {
    expect(bandAt(new Date(2026, 5, 4, 19, 59), seg)!.key).toBe('day');
  });
  it('20:00 start → 夜班', () => {
    expect(bandAt(new Date(2026, 5, 4, 20, 0), seg)!.key).toBe('night');
  });
  it('post-midnight 03:00 → 夜班 of the PREVIOUS shift-day', () => {
    expect(bandAt(new Date(2026, 5, 5, 3, 0), seg)!.key).toBe('night');
  });
});
