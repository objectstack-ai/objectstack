import { afterEach, describe, expect, it } from 'vitest';

import { celEngine } from './cel-engine';
import { inferExpressionType, validateExpression } from './validate';

/**
 * `isoDate(t)` / `isoDatetime(t)` — the string form of a CEL timestamp.
 *
 * ## What they must reproduce
 *
 * The flow template dialect's date macros (`service-automation`
 * `builtin/template.ts`, `resolveToken`) write `new Date().toISOString()` for
 * `{NOW()}`, its first ten characters for `{TODAY()}`, and shift the instant by
 * whole UTC days (`setUTCDate`) for `{TODAY() ± N}` / `{NOW() ± N}`. The
 * expected strings in {@link TEMPLATE_BYTES} are that function's own output,
 * measured through `interpolateString` at these instants under six host
 * zones. The host zone changed no byte of it.
 *
 * ## The scope these pins evaluate in
 *
 * A flow value envelope is evaluated with `AutomationEngine.celScope`, which
 * passes `{ extra, record }` and nothing else, so the engine runs on the UTC
 * calendar with the wall clock. Here `now` pins the clock to the row's instant
 * and nothing else differs.
 */

const flowScope = (at: string) => ({ now: new Date(at), extra: {}, record: {} });

function value(source: string, at: string): unknown {
  const r = celEngine.evaluate({ dialect: 'cel', source }, flowScope(at));
  if (!r.ok) throw new Error(`${source} @ ${at}: ${r.error.kind}: ${r.error.message}`);
  return r.value;
}

/** `interpolateString` output at each instant, per token (measured; see the header). */
const TEMPLATE_BYTES = [
  { at: '2026-10-08T17:55:06.123Z', today: '2026-10-08', now: '2026-10-08T17:55:06.123Z', plus3: '2026-10-11', minus1: '2026-10-07', nowPlus1: '2026-10-09T17:55:06.123Z' },
  { at: '2026-10-08T00:00:00.000Z', today: '2026-10-08', now: '2026-10-08T00:00:00.000Z', plus3: '2026-10-11', minus1: '2026-10-07', nowPlus1: '2026-10-09T00:00:00.000Z' },
  { at: '2026-01-31T23:59:59.999Z', today: '2026-01-31', now: '2026-01-31T23:59:59.999Z', plus3: '2026-02-03', minus1: '2026-01-30', nowPlus1: '2026-02-01T23:59:59.999Z' },
  { at: '2026-02-28T12:00:00.000Z', today: '2026-02-28', now: '2026-02-28T12:00:00.000Z', plus3: '2026-03-03', minus1: '2026-02-27', nowPlus1: '2026-03-01T12:00:00.000Z' },
  { at: '2028-02-28T12:00:00.000Z', today: '2028-02-28', now: '2028-02-28T12:00:00.000Z', plus3: '2028-03-02', minus1: '2028-02-27', nowPlus1: '2028-02-29T12:00:00.000Z' },
  { at: '2026-12-31T23:30:00.000Z', today: '2026-12-31', now: '2026-12-31T23:30:00.000Z', plus3: '2027-01-03', minus1: '2026-12-30', nowPlus1: '2027-01-01T23:30:00.000Z' },
  { at: '2026-03-08T07:30:00.000Z', today: '2026-03-08', now: '2026-03-08T07:30:00.000Z', plus3: '2026-03-11', minus1: '2026-03-07', nowPlus1: '2026-03-09T07:30:00.000Z' },
  { at: '2026-03-29T00:30:00.000Z', today: '2026-03-29', now: '2026-03-29T00:30:00.000Z', plus3: '2026-04-01', minus1: '2026-03-28', nowPlus1: '2026-03-30T00:30:00.000Z' },
  { at: '2026-11-01T23:30:00.000Z', today: '2026-11-01', now: '2026-11-01T23:30:00.000Z', plus3: '2026-11-04', minus1: '2026-10-31', nowPlus1: '2026-11-02T23:30:00.000Z' },
] as const;

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe('the two shapes write the template dialect\'s bytes', () => {
  // A host zone east of every boundary instant's UTC day, one west, and UTC:
  // the renderer reads the UTC calendar only, so all three must agree.
  for (const hostZone of ['UTC', 'Pacific/Auckland', 'America/New_York']) {
    it(`over every instant, with the host process in ${hostZone}`, () => {
      process.env.TZ = hostZone;
      for (const row of TEMPLATE_BYTES) {
        expect(value('isoDate(today())', row.at), `{TODAY()} @ ${row.at}`).toBe(row.today);
        expect(value('isoDatetime(now())', row.at), `{NOW()} @ ${row.at}`).toBe(row.now);
        expect(value('isoDate(daysFromNow(3))', row.at), `{TODAY() + 3} @ ${row.at}`).toBe(row.plus3);
        expect(value('isoDate(addDays(today(), 3))', row.at), `{TODAY() + 3} @ ${row.at}`).toBe(row.plus3);
        expect(value('isoDate(daysAgo(1))', row.at), `{TODAY() - 1} @ ${row.at}`).toBe(row.minus1);
        expect(value('isoDatetime(addDays(now(), 1))', row.at), `{NOW() + 1} @ ${row.at}`).toBe(row.nowPlus1);
      }
    });
  }

  it('isoDate renders the UTC calendar, so isoDate(today()) is the reference-timezone day', () => {
    // 23:30Z on Oct 8 is already Oct 9 in Auckland. today() under that
    // reference zone is Oct 9 at UTC midnight (ADR-0053 D1), and the instant
    // itself is still Oct 8 on the UTC calendar. A renderer that read the
    // reference zone would print the day before today() in every zone west of
    // UTC (the New York case below).
    const ctx = { now: new Date('2026-10-08T23:30:00.000Z'), timezone: 'Pacific/Auckland' };
    expect(celEngine.evaluate({ dialect: 'cel', source: 'isoDate(today())' }, ctx)).toEqual({ ok: true, value: '2026-10-09' });
    expect(celEngine.evaluate({ dialect: 'cel', source: 'isoDate(now())' }, ctx)).toEqual({ ok: true, value: '2026-10-08' });
    const west = { now: new Date('2026-10-08T02:00:00.000Z'), timezone: 'America/New_York' };
    expect(celEngine.evaluate({ dialect: 'cel', source: 'isoDate(today())' }, west)).toEqual({ ok: true, value: '2026-10-07' });
  });
});

describe('the build agrees with the run', () => {
  it('accepts both spellings in a value slot and infers text', () => {
    for (const source of ['isoDate(today())', 'isoDatetime(now())', 'isoDate(daysFromNow(3))']) {
      expect(validateExpression('value', { dialect: 'cel', source }), source).toEqual({ ok: true, errors: [], warnings: [] });
      expect(inferExpressionType({ dialect: 'cel', source }), source).toBe('text');
    }
  });

  it('refuses a misspelling with the unknown-function did-you-mean', () => {
    for (const [source, name, suggestion] of [
      ['isoDte(today())', 'isoDte', 'isoDate'],
      ['isoDateTime(now())', 'isoDateTime', 'isoDatetime'],
    ] as const) {
      const v = validateExpression('value', { dialect: 'cel', source });
      expect(v.ok, source).toBe(false);
      expect(v.errors.map((e) => e.code), source).toEqual(['cel-unknown-function']);
      expect(v.errors[0].params, source).toMatchObject({ name, suggestion });
      expect(celEngine.evaluate({ dialect: 'cel', source }, flowScope(TEMPLATE_BYTES[0].at)).ok, source).toBe(false);
    }
  });

  it('keeps string(timestamp) refused, so each shape has exactly one spelling', () => {
    // CEL defines string(timestamp) as RFC 3339 text that drops a zero
    // fraction (`…T00:00:00Z`), which is not the template's `.000Z`. A cel-js
    // upgrade that starts accepting it turns this red, and a person decides.
    for (const source of ['string(today())', 'string(now())']) {
      const v = validateExpression('value', { dialect: 'cel', source });
      expect(v.errors.map((e) => e.code), source).toEqual(['invalid-cel']);
      expect(String(v.errors[0].params && 'detail' in v.errors[0].params ? v.errors[0].params.detail : ''), source)
        .toContain('string(google.protobuf.Timestamp)');
      expect(celEngine.evaluate({ dialect: 'cel', source }, flowScope(TEMPLATE_BYTES[0].at)).ok, source).toBe(false);
    }
  });
});

describe('a non-timestamp argument is refused loudly, never rendered', () => {
  it('at build, when the argument\'s type is known', () => {
    for (const [source, overload] of [
      ["isoDate('2026-10-08')", 'isoDate(string)'],
      ['isoDatetime(20261008)', 'isoDatetime(int)'],
      ['isoDate(null)', 'isoDate(null)'],
    ] as const) {
      const v = validateExpression('value', { dialect: 'cel', source });
      expect(v.errors.map((e) => e.code), source).toEqual(['invalid-cel']);
      expect(String(v.errors[0].params && 'detail' in v.errors[0].params ? v.errors[0].params.detail : ''), source).toContain(overload);
    }
  });

  it('at run, when the value arrives as text, a number or null', () => {
    const record = { d: '2026-10-08', n: 5, z: null };
    for (const [source, overload] of [
      ['isoDate(record.d)', 'isoDate(string)'],
      ['isoDatetime(record.n)', 'isoDatetime(double)'],
      ['isoDate(record.z)', 'isoDate(null)'],
    ] as const) {
      const r = celEngine.evaluate({ dialect: 'cel', source }, { now: new Date(TEMPLATE_BYTES[0].at), record });
      expect(r.ok, source).toBe(false);
      if (!r.ok) {
        expect(r.error.kind, source).toBe('runtime');
        expect(r.error.message, source).toContain(overload);
      }
    }
    // The prescribed repair for ISO text: parse it first.
    expect(celEngine.evaluate({ dialect: 'cel', source: 'isoDate(date(record.d))' }, { record }))
      .toEqual({ ok: true, value: '2026-10-08' });
  });

  it('at run, for an invalid or out-of-range timestamp', () => {
    for (const [source, fn] of [
      ["isoDate(date('not a date'))", 'isoDate(t)'],
      ["isoDatetime(addDays(timestamp('9999-12-31T00:00:00Z'), 1))", 'isoDatetime(t)'],
      ["isoDate(addDays(timestamp('0001-01-01T00:00:00Z'), -1))", 'isoDate(t)'],
    ] as const) {
      const r = celEngine.evaluate({ dialect: 'cel', source }, flowScope(TEMPLATE_BYTES[0].at));
      expect(r.ok, source).toBe(false);
      if (!r.ok) {
        expect(r.error.kind, source).toBe('runtime');
        expect(r.error.message, source).toContain(`${fn}: \`t\` is not a renderable timestamp`);
      }
    }
  });
});

describe('no write path changes', () => {
  // Measured through a real AutomationEngine create_record over a real ObjectQL
  // engine and a recording driver: each of these reaches the store as a Date,
  // in a text, date or datetime column alike. Adding a spelling must not move
  // that, so the envelope's value is pinned as the same Date at the same instant.
  it('an envelope returning a timestamp still yields a Date', () => {
    const at = '2026-01-31T23:59:59.999Z';
    for (const [source, iso] of [
      ['today()', '2026-01-31T00:00:00.000Z'],
      ['now()', '2026-01-31T23:59:59.999Z'],
      ['daysFromNow(3)', '2026-02-03T00:00:00.000Z'],
      ['addDays(today(), 3)', '2026-02-03T00:00:00.000Z'],
    ] as const) {
      const v = value(source, at);
      expect(v, source).toBeInstanceOf(Date);
      expect((v as Date).toISOString(), source).toBe(iso);
    }
  });
});
