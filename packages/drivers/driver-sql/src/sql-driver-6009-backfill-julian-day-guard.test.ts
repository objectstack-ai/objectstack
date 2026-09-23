// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6009 — the canonical temporal backfill must not write SQLite's JULIAN-DAY
 * reading of a bare-numeric cell over the bytes that are on disk.
 *
 * `sqliteCanonicalDatetimeSql`'s `else` arm is
 * `coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', col), col)`, and its stated contract
 * is that an uninterpretable value falls through the `coalesce` unchanged.
 * SQLite's time-value grammar has one limb that breaks that reasoning: a BARE
 * NUMBER is a julian day (`DDDD.DDDD`, the last documented format), and `now` is
 * the wall clock. For those `strftime` returns a confident wrong answer instead
 * of NULL, so `coalesce` never fires.
 *
 * On a READ that is a temporary misreading and the disk is untouched. On the SET
 * side of `backfillCanonicalDatetimes` / `backfillCanonicalTimes` it is a WRITE,
 * and the original value cannot be recovered afterwards.
 *
 * ## Why the fixture rebuilds the physical column as TEXT
 *
 * A column knex creates for `Field.datetime` is declared `datetime`, which is
 * NUMERIC affinity, so SQLite converts `'2026'` to INTEGER 2026 on the way in
 * and the row takes the expression's integer/real branch instead. The
 * bare-numeric TEXT shape needs a TEXT-affinity column — which is what
 * `RemoteTransport.mapFieldTypeToSQL` declares for every temporal column, and
 * what an externally-provisioned SQLite file can carry (`initObjects` adds
 * missing columns to a table that already exists; it never retypes one). So the
 * fixture declares `at` / `tod` TEXT and keeps a second NUMERIC-affinity
 * datetime column `ep` for the integer/real epoch control — one table, both
 * storage classes, which is the situation the repair expression exists for.
 *
 * ⛔ The fix is a guard on the BACKFILL SET SIDE ONLY. The maintainer's
 * 2026-08-03 ruling on cloud#1005 refused teaching the shared READ expression to
 * recognise numeric-looking text — it is a public contract for every SQLite
 * consumer, it runs on every read, and there it would misread a legitimate
 * numeric-string column. The first describe below PINS that the read path still
 * misreads, so a later "improvement" to it fails this suite rather than slipping
 * through it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LegacyStorageDriver } from '../src/legacy-datetime-storage.testkit.js';

const makeDriver = (): LegacyStorageDriver =>
  new LegacyStorageDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

const OBJECT = {
  name: 'evt',
  fields: {
    label: { type: 'string' },
    at: { type: 'datetime' },
    ep: { type: 'datetime' },
    tod: { type: 'time' },
  },
} as any;

/**
 * Re-declare `columns` as TEXT on an EMPTY table, preserving every other column
 * and the column order — the `RemoteTransport.mapFieldTypeToSQL` storage shape,
 * reproduced against the local driver so the SET-side guard can be exercised
 * where the values it is about to overwrite actually exist.
 */
async function retypeAsText(driver: LegacyStorageDriver, table: string, columns: string[]) {
  const knex = (driver as any).knex;
  const info = await knex(table).columnInfo();
  const defs = Object.entries(info).map(([name, meta]: [string, any]) => {
    const type = columns.includes(name) ? 'text' : (meta?.type || 'text');
    return `"${name}" ${type}${name === 'id' ? ' primary key' : ''}`;
  });
  await knex.raw(`alter table ?? rename to ??`, [table, `${table}__pre6009`]);
  await knex.raw(`create table ?? (${defs.join(', ')})`, [table]);
  await knex.raw(`drop table ??`, [`${table}__pre6009`]);
}

/**
 * The card's own measured table, verbatim. `stored` is what is on disk;
 * `julianRead` is what the SHARED READ EXPRESSION answers for it — the value the
 * un-guarded backfill wrote in its place.
 */
const JULIAN_ONLY: Array<{ id: string; stored: string; julianRead: string }> = [
  { id: 'j-12', stored: '12', julianRead: '-4713-12-06T12:00:00.000Z' },
  { id: 'j-0', stored: '0', julianRead: '-4713-11-24T12:00:00.000Z' },
  { id: 'j-1999', stored: '1999', julianRead: '-4707-05-15T12:00:00.000Z' },
  { id: 'j-2026', stored: '2026', julianRead: '-4707-06-11T12:00:00.000Z' },
  { id: 'j-86400', stored: '86400', julianRead: '-4476-06-15T12:00:00.000Z' },
  // The julian EPOCH. SQLite's answer here happens to be a plausible modern
  // instant, which is exactly why it is in the fixture: it is still a julian
  // read of a cell no ObjectStack write path could have produced (a canonical
  // spelling always carries `-` / `:` / `T` / `Z`), so the guard treats it like
  // the rest. Its READ answer is unchanged either way — see the query-answer
  // describe below — so declining to rewrite it costs nothing and buys the
  // bytes back.
  { id: 'j-epoch', stored: '2440587.5', julianRead: '1970-01-01T00:00:00.000Z' },
];

/** TEXT values the shared expression interprets through a real date spelling. */
const CONVERGES: Array<{ id: string; stored: string; canonical: string }> = [
  { id: 'c-naive', stored: '2026-03-20 12:00:00', canonical: '2026-03-20T12:00:00.000Z' },
  { id: 'c-offset', stored: '2026-03-20T20:00:00+08:00', canonical: '2026-03-20T12:00:00.000Z' },
  { id: 'c-day', stored: '2026-08-06', canonical: '2026-08-06T00:00:00.000Z' },
  { id: 'c-canon', stored: '2026-03-20T12:00:00.000Z', canonical: '2026-03-20T12:00:00.000Z' },
];

/** Unparseable — already a fixpoint of the `coalesce`, guard or no guard. */
const FIXPOINTS: Array<{ id: string; stored: string | null }> = [
  { id: 'f-junk', stored: 'not-a-date' },
  { id: 'f-epoch-text', stored: '1753660800000.0' }, // past the julian range -> strftime NULL
  { id: 'f-neg', stored: '-1' },
  { id: 'f-nil', stored: null },
];

/** The integer/real epoch branch, in a NUMERIC-affinity column. */
const EPOCH_MS = Date.parse('2026-03-20T12:00:00.000Z');

const ALL = [...JULIAN_ONLY, ...CONVERGES, ...FIXPOINTS];

const seed = async (driver: LegacyStorageDriver) => {
  await driver.seedLegacyRows(
    'evt',
    'at',
    ALL.map((r) => ({ id: r.id, label: r.id, at: r.stored, ep: EPOCH_MS })),
  );
  driver.forgetCanonical('evt', 'ep');
  driver.forgetCanonicalTime('evt', 'tod');
};

const storedMap = async (driver: LegacyStorageDriver, field: string) =>
  Object.fromEntries((await driver.storedForms('evt', field)).map((r) => [r.id, r.value]));

const freshDriver = async (): Promise<LegacyStorageDriver> => {
  const driver = makeDriver();
  await driver.initObjects([OBJECT]);
  await retypeAsText(driver, 'evt', ['at', 'tod']);
  await seed(driver);
  return driver;
};

describe('#6009 premise — the SHARED READ EXPRESSION still reads a bare number as a julian day', () => {
  let driver: LegacyStorageDriver;

  beforeEach(async () => { driver = await freshDriver(); });
  afterEach(async () => { await driver.disconnect(); });

  it('stores the bare numbers as TEXT — the premise the julian branch needs', async () => {
    const forms = await driver.storedForms('evt', 'at');
    const types = Object.fromEntries(forms.map((r) => [r.id, r.type]));
    for (const row of JULIAN_ONLY) expect(types[row.id], `${row.id} storage class`).toBe('text');
    // …while the second column really did keep the numeric storage class.
    const epTypes = Object.fromEntries((await driver.storedForms('evt', 'ep')).map((r) => [r.id, r.type]));
    expect(epTypes['j-12']).toBe('integer');
  });

  it('answers a BC date for every bare-numeric cell — `coalesce` does not fire', async () => {
    // ⛔ This pins the REFUSED fix (cloud#1005) as still unimplemented, on
    // purpose. If this assertion fails because the shared expression learned to
    // recognise numeric text, a maintainer ruling was reversed without a ruling
    // — re-read cloud#1005 before touching the pin.
    const expr = (driver as any).sqliteCanonicalDatetimeSql('at');
    const res: any = await driver.execute(`select id, ${expr} as canon from evt`);
    const rows: any[] = Array.isArray(res) ? res : (res?.rows ?? []);
    const read = Object.fromEntries(rows.map((r) => [r.id, r.canon]));

    for (const row of JULIAN_ONLY) {
      expect(read[row.id], `${row.id} (${row.stored}) read through the repair`).toBe(row.julianRead);
      // The misreading is never NULL — which is the whole reason `coalesce`
      // cannot save this branch.
      expect(read[row.id]).not.toBeNull();
    }
  });
});

describe('#6009 — backfillCanonicalDatetimes leaves the julian-only rows on disk', () => {
  let driver: LegacyStorageDriver;

  beforeEach(async () => { driver = await freshDriver(); });
  afterEach(async () => { await driver.disconnect(); });

  it('writes NO julian-day-derived value to disk', async () => {
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    const forms = await storedMap(driver, 'at');
    for (const row of JULIAN_ONLY) {
      expect(forms[row.id], `${row.id} stored bytes`).toBe(row.stored);
      expect(forms[row.id], `${row.id} must not be the julian reading`).not.toBe(row.julianRead);
    }
  });

  it('still converges every legitimately interpretable TEXT shape (it discriminates)', async () => {
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    const forms = await storedMap(driver, 'at');
    for (const row of CONVERGES) {
      expect(forms[row.id], `${row.id} converged`).toBe(row.canonical);
    }
  });

  it('leaves the INTEGER epoch branch exactly as it was before the guard existed', async () => {
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    const forms = await storedMap(driver, 'ep');
    for (const row of ALL) {
      expect(forms[row.id], `${row.id} epoch column`).toBe('2026-03-20T12:00:00.000Z');
    }
    // A column with nothing withheld still earns the mark, so the read paths
    // drop their repair — the #3912 payoff is untouched.
    expect((driver as any).needsLegacyDatetimeRepair('evt', 'ep')).toBe(false);
  });

  it('leaves the `coalesce` fixpoints exactly as they were, as it always did', async () => {
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    const forms = await storedMap(driver, 'at');
    for (const row of FIXPOINTS) {
      expect(forms[row.id], `${row.id} preserved`).toBe(row.stored);
    }
  });

  it('is idempotent — a second run rewrites nothing', async () => {
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    const before = await driver.storedForms('evt', 'at');
    driver.forgetCanonical('evt', 'at');
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    expect(await driver.storedForms('evt', 'at')).toEqual(before);
  });
});

describe('#6009 — a withheld row blocks the canonical mark, so no query answer moves', () => {
  let driver: LegacyStorageDriver;

  beforeEach(async () => { driver = await freshDriver(); });
  afterEach(async () => { await driver.disconnect(); });

  it('keeps the read-side repair while julian-only rows remain', async () => {
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    // A withheld row is NOT a fixpoint of the repair — dropping the repair
    // would compare the raw `'2026'` as TEXT and change what it matches — so
    // the column cannot be marked clean.
    expect((driver as any).needsLegacyDatetimeRepair('evt', 'at')).toBe(true);
    expect((driver as any).filterColumnExpr('evt', 'at', 'at')).not.toBeNull();
  });

  it('marks the column clean once no julian-only row is left', async () => {
    await (driver as any).knex('evt').whereIn('id', JULIAN_ONLY.map((r) => r.id)).del();
    driver.forgetCanonical('evt', 'at');
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    expect((driver as any).needsLegacyDatetimeRepair('evt', 'at')).toBe(false);
    expect((driver as any).filterColumnExpr('evt', 'at', 'at')).toBeNull();
  });

  it('returns the identical rows for a window filter before and after the backfill', async () => {
    // The invariant #6004/#6006 established, and the one this change must not
    // break: the backfill is a storage change, never an answer change. The
    // window DISCRIMINATES — through the repair `'2026'` compares as `-4707-…`
    // and is out; compared raw as TEXT it would be in.
    const window = { at: { $gte: '1900-01-01T00:00:00.000Z' } };
    const before = (await driver.find('evt', { where: window })).map((r: any) => r.id).sort();
    // The repair is in effect, so `'2026'` is compared as `-4707-…` and is OUT.
    // Compared raw as TEXT it would be IN — which is what makes this window a
    // discriminating probe rather than a tautology.
    expect(before).toEqual(['c-canon', 'c-day', 'c-naive', 'c-offset', 'f-junk', 'j-epoch']);

    await (driver as any).backfillCanonicalDatetimes('evt', true);

    const after = (await driver.find('evt', { where: window })).map((r: any) => r.id).sort();
    expect(after).toEqual(before);
  });

  it('answers identically for a window that ADMITS the julian epoch cell', async () => {
    const window = { at: { $gte: '1000-01-01T00:00:00.000Z', $lte: '9999-12-31T23:59:59.999Z' } };
    const before = (await driver.find('evt', { where: window })).map((r: any) => r.id).sort();
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    const after = (await driver.find('evt', { where: window })).map((r: any) => r.id).sort();
    expect(after).toEqual(before);
    // `'2440587.5'` reads as 1970 through the repair, so it IS in this window —
    // before and after. Not rewriting its bytes cost the query nothing.
    expect(after).toContain('j-epoch');
  });

  it('says so once, naming the count and the consequence', async () => {
    const warnings: Array<{ msg: string; meta: any }> = [];
    (driver as any).logger.warn = (msg: string, meta?: any) => warnings.push({ msg, meta });
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    // Keyed on the message's own words, not on a tracker id: `check:doc-authoring`
    // forbids an issue number in a runtime string, so one here would be a pin on
    // a spelling the repo does not allow.
    const hit = warnings.filter((w) => w.msg.includes('JULIAN DAY'));
    expect(hit).toHaveLength(1);
    expect(hit[0].meta.rowsWithheld).toBe(JULIAN_ONLY.length);
    expect(hit[0].meta.field).toBe('at');
    expect(hit[0].msg).toContain('Reads are unchanged');
  });
});

describe('#6009 — the `os migrate plan` preview promises exactly what apply does', () => {
  let driver: LegacyStorageDriver;

  beforeEach(async () => { driver = await freshDriver(); });
  afterEach(async () => { await driver.disconnect(); });

  it('counts only the rows the migration will actually rewrite', async () => {
    const existing = new Set(Object.keys(await (driver as any).knex('evt').columnInfo()));
    const planned = await (driver as any).previewDatetimeConvergence('evt', OBJECT.fields, existing);
    const entry = planned.find((p: any) => p.kind === 'normalize_datetime_storage');
    expect(entry).toBeDefined();

    const before = [
      ...(await driver.storedForms('evt', 'at')),
      ...(await driver.storedForms('evt', 'ep')),
    ];
    await (driver as any).backfillCanonicalDatetimes('evt', true);
    const after = [
      ...(await driver.storedForms('evt', 'at')),
      ...(await driver.storedForms('evt', 'ep')),
    ];
    const rewritten = before.filter((row, i) => row.value !== after[i].value).length;

    expect(entry.rows).toBe(rewritten);
    expect(entry.columns.sort()).toEqual(['at', 'ep']);
  });
});

describe('#6009 — the Field.time twin, on the same terms', () => {
  let driver: LegacyStorageDriver;

  beforeEach(async () => {
    driver = makeDriver();
    await driver.initObjects([OBJECT]);
    await retypeAsText(driver, 'evt', ['at', 'tod']);
    await driver.seedLegacyTimeRows('evt', 'tod', [
      { id: 't-2026', label: 't-2026', tod: '2026' },
      { id: 't-12', label: 't-12', tod: '12' },
      { id: 't-hhmm', label: 't-hhmm', tod: '12:30' },
      { id: 't-iso', label: 't-iso', tod: '2026-08-06T01:02:03.000Z' },
      { id: 't-junk', label: 't-junk', tod: 'not-a-time' },
    ]);
  });

  afterEach(async () => { await driver.disconnect(); });

  it('leaves a bare number on disk instead of writing its julian time-of-day', async () => {
    await (driver as any).backfillCanonicalTimes('evt', true);
    const forms = await storedMap(driver, 'tod');
    // Without the guard both of these become '12:00:00' — julian noon.
    expect(forms['t-2026']).toBe('2026');
    expect(forms['t-12']).toBe('12');
    expect(forms['t-junk']).toBe('not-a-time');
  });

  it('still converges the real time spellings', async () => {
    await (driver as any).backfillCanonicalTimes('evt', true);
    const forms = await storedMap(driver, 'tod');
    expect(forms['t-hhmm']).toBe('12:30:00');
    expect(forms['t-iso']).toBe('01:02:03');
  });

  it('keeps the read-side repair while a withheld row remains', async () => {
    await (driver as any).backfillCanonicalTimes('evt', true);
    expect((driver as any).needsLegacyTimeRepair('evt', 'tod')).toBe(true);
  });
});

describe('#6009 — sqliteNonTemporalTextSql discriminates by SHAPE, not by magnitude', () => {
  let driver: LegacyStorageDriver;

  beforeEach(async () => {
    driver = makeDriver();
    await driver.initObjects([OBJECT]);
  });

  afterEach(async () => { await driver.disconnect(); });

  const guarded = async (driver: LegacyStorageDriver, value: unknown): Promise<boolean> => {
    const expr = (driver as any).sqliteNonTemporalTextSql('?');
    const res: any = await driver.execute(`select ${expr} as g`, [value, value, value, value]);
    const rows: any[] = Array.isArray(res) ? res : (res?.rows ?? []);
    return Boolean(rows[0].g);
  };

  it('matches every cell the parser reaches through the julian or `now` limb, and nothing else', async () => {
    const cases: Array<[string, boolean]> = [
      // bare numbers — the julian limb. Note `'2440587.5'` and `'5373484'` sit
      // at opposite ends of the range and are treated alike: the predicate never
      // asks how big the number is.
      ['12', true], ['0', true], ['2026', true], ['86400', true],
      ['2440587.5', true], ['1e5', true], [' 2026 ', true], ['5373484', true],
      ['now', true],                       // the other non-literal limb
      // every format reached through parseYyyyMmDd (a `-`) or parseHhMmSs (a `:`)
      ['2026-08-06', false], ['2026-08-06T00:00:00.000Z', false],
      ['2026-03-20 12:00:00', false], ['2026-03-20T20:00:00+08:00', false],
      ['12:30', false], ['12:30:05.250', false],
      // not a time value at all — `strftime` returns NULL, so the `coalesce`
      // fixpoint already covers them and the guard need not
      ['not-a-date', false], ['1753660800000.0', false], ['5373485', false],
      ['-1', false], ['', false],
    ];
    for (const [value, matched] of cases) {
      expect(await guarded(driver, value), `${JSON.stringify(value)} guarded?`).toBe(matched);
    }
  });

  it('never matches an INTEGER/REAL cell — the epoch branch is untouched', async () => {
    for (const value of [1753660800000, 1753660800000.5, 12, 0]) {
      expect(await guarded(driver, value), `${value} guarded?`).toBe(false);
    }
  });
});
