import { describe, expect, it } from 'vitest';

import { resolveSeed, resolveSeedRecord } from './seed-eval';
import type { Expression } from '@objectstack/spec';

const cel = (source: string): Expression => ({ dialect: 'cel', source });

describe('resolveSeed', () => {
  it('passes through primitives unchanged', () => {
    expect(resolveSeed('hello', {})).toEqual({ ok: true, value: 'hello' });
    expect(resolveSeed(42, {})).toEqual({ ok: true, value: 42 });
    expect(resolveSeed(true, {})).toEqual({ ok: true, value: true });
    expect(resolveSeed(null, {})).toEqual({ ok: true, value: null });
  });

  it('passes through Date objects unchanged', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const r = resolveSeed(d, {});
    expect(r).toEqual({ ok: true, value: d });
  });

  it('evaluates Expression leaves with provided context', () => {
    const pinned = new Date('2026-01-15T10:00:00Z');
    const r = resolveSeed(cel('daysFromNow(30)'), { now: pinned });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as Date).toISOString()).toBe('2026-02-14T10:00:00.000Z');
  });

  it('walks arrays', () => {
    const r = resolveSeed([1, cel('2 + 2'), 'x'], {});
    expect(r).toEqual({ ok: true, value: [1, 4, 'x'] });
  });

  it('walks nested objects', () => {
    const r = resolveSeed(
      {
        name: 'Acme',
        meta: { score: cel('10 * 2') },
      },
      {},
    );
    expect(r).toEqual({ ok: true, value: { name: 'Acme', meta: { score: 20 } } });
  });

  it('returns first error encountered', () => {
    const r = resolveSeed(
      {
        a: 1,
        bad: cel('1 +'),
        c: 3,
      },
      {},
    );
    expect(r.ok).toBe(false);
  });

  it('resolveSeedRecord pins now() so multiple expressions see same clock', () => {
    const r = resolveSeedRecord(
      {
        a: cel('now()'),
        b: cel('now()'),
      },
      {},
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = (r.value.a as Date).toISOString();
      const b = (r.value.b as Date).toISOString();
      expect(a).toBe(b);
    }
  });

  it('honors explicit ctx.now snapshot', () => {
    const pinned = new Date('2026-06-01T12:00:00Z');
    const r = resolveSeedRecord(
      { close_date: cel('daysFromNow(30)') },
      { now: pinned },
    );
    expect(r.ok).toBe(true);
    if (r.ok)
      expect((r.value.close_date as Date).toISOString()).toBe('2026-07-01T12:00:00.000Z');
  });
});
