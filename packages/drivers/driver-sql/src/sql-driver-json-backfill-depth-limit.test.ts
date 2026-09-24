// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19912] The local `Field.json` storage backfill
 * (`SqlDriver.backfillCanonicalJsonEncoding`, #12380) lets the driver's own
 * codec decide which cell to rewrite. SQL only pre-filters.
 *
 * The defect: the backfill was one `UPDATE … set col = json_quote(col) where
 * typeof(col) = 'text' and json_valid(col) = 0`. SQLite's `json_valid()`
 * answers 0 for JSON nested past its depth limit (1000 levels in the bundled
 * better-sqlite3), while `JSON.parse` — what `formatOutput` reads every json
 * TEXT cell with — reads it. So a deep array the current write door stored
 * correctly was quoted into a JSON string on the next `syncSchema`, and read
 * back as a string from then on. Nothing failed; the cell was simply wrong.
 *
 * What is pinned:
 *
 * 1. The card's reproduction: `bare`, a 1001-level array and `[1,2]` → only
 *    `bare` is quoted, and the array still reads as an array after a SECOND
 *    backfill.
 * 2. Idempotence: a re-run over a converged table (withheld cell included)
 *    changes zero rows.
 * 3. Preservation: legacy bare text that is not JSON is still converted to
 *    exactly the bytes the old `json_quote()` statement wrote.
 * 4. The rule is the read codec: a cell is rewritten exactly when the driver
 *    reads it back as its own text.
 * 5. Compare-and-set: a value written between the page read and the write is
 *    not overwritten.
 * 6. Paging: a column with more candidates than one page converges in one pass.
 *
 * The same round-trip through `TursoDriver`'s local face lives in
 * `driver-turso/src/turso-local-json-backfill-depth-limit.test.ts`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqlDriver } from './sql-driver.js';
import { recoverUnencodedJsonText } from './unencoded-json-text.js';

const T = 'json_depth_19912';
const FIELDS = { label: { type: 'text' }, val: { type: 'json' } };
const SCHEMA = { name: T, fields: FIELDS };

/** An array nested `levels` deep: `[]` is 1, `[[]]` is 2. */
function deepArray(levels: number): unknown {
  let v: unknown = [];
  for (let i = 1; i < levels; i++) v = [v];
  return v;
}

function deepObject(levels: number): unknown {
  let v: unknown = {};
  for (let i = 1; i < levels; i++) v = { a: v };
  return v;
}

function arrayDepth(v: unknown): number {
  let d = 0;
  while (Array.isArray(v)) {
    d++;
    v = v[0];
  }
  return d;
}

const open: SqlDriver[] = [];
const dirs: string[] = [];

async function makeDriver(filename = ':memory:'): Promise<SqlDriver> {
  const d = new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
  (d as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
  open.push(d);
  await d.connect();
  return d;
}

afterEach(async () => {
  for (const d of open.splice(0)) await d.disconnect();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A cell the way a pre-#12380 door (or any raw writer) left it: bound as-is. */
async function plantRaw(d: SqlDriver, id: string, val: unknown): Promise<void> {
  await d.execute(`insert into "${T}" ("id", "label", "val") values (?, ?, ?)`, [id, id, val as any]);
}

async function disk(d: SqlDriver, id: string): Promise<{ t: string; v: unknown }> {
  const rows = (await d.execute(`select typeof("val") as t, "val" as v from "${T}" where "id" = ?`, [id])) as any[];
  return rows[0];
}

async function readAll(d: SqlDriver): Promise<Map<string, unknown>> {
  const rows = (await d.find(T, {})) as Array<Record<string, unknown>>;
  return new Map(rows.map((r) => [r.id as string, r.val]));
}

async function totalChanges(d: SqlDriver): Promise<number> {
  const rows = (await d.execute('select total_changes() as n')) as any[];
  return Number(rows[0].n);
}

describe('[#19912] the local json backfill leaves JSON nested past SQLite\'s depth limit as stored', () => {
  it('the card\'s reproduction: only `bare` is quoted; the 1001-level array reads as an array after a SECOND backfill', async () => {
    const d = await makeDriver();
    await d.syncSchema(T, SCHEMA); // creates the table: no backfill
    await plantRaw(d, 'bare', 'bare'); // the pre-#12380 form of the string 'bare'
    await d.create(T, { id: 'deep', label: 'deep', val: deepArray(1001) }, { bypassTenantAudit: true });
    await d.create(T, { id: 'pair', label: 'pair', val: [1, 2] }, { bypassTenantAudit: true });

    const deepText = JSON.stringify(deepArray(1001));
    // The current door stored the array encoded — and the pre-filter selects it,
    // so it is the codec, not SQL, that must keep it.
    expect(await disk(d, 'deep')).toEqual({ t: 'text', v: deepText });
    const valid = (await d.execute(`select json_valid("val") as ok from "${T}" where "id" = 'deep'`)) as any[];
    expect(valid[0].ok).toBe(0);
    expect(arrayDepth((await readAll(d)).get('deep'))).toBe(1001);
    const pairBefore = await disk(d, 'pair');

    await d.syncSchema(T, SCHEMA); // first backfill
    expect(await disk(d, 'bare')).toEqual({ t: 'text', v: '"bare"' });
    expect(await disk(d, 'deep')).toEqual({ t: 'text', v: deepText });
    expect(await disk(d, 'pair')).toEqual(pairBefore);

    await d.syncSchema(T, SCHEMA); // second backfill
    const read = await readAll(d);
    expect(Array.isArray(read.get('deep'))).toBe(true);
    expect(arrayDepth(read.get('deep'))).toBe(1001);
    expect(read.get('bare')).toBe('bare');
    expect(read.get('pair')).toStrictEqual([1, 2]);
    expect(await disk(d, 'deep')).toEqual({ t: 'text', v: deepText });
  });

  it('is idempotent: a re-run over a converged table changes zero rows, withheld cell included', async () => {
    const d = await makeDriver();
    await d.syncSchema(T, SCHEMA);
    await plantRaw(d, 'bare', 'bare');
    await d.create(T, { id: 'deep', label: 'deep', val: deepArray(1001) }, { bypassTenantAudit: true });
    await d.syncSchema(T, SCHEMA); // converges `bare`, withholds `deep`

    const before = await totalChanges(d);
    await d.syncSchema(T, SCHEMA);
    await d.syncSchema(T, SCHEMA);
    expect(await totalChanges(d)).toBe(before);
  });

  it('preservation: legacy bare text that is not JSON is converted to exactly the bytes json_quote() wrote', async () => {
    const d = await makeDriver();
    await d.syncSchema(T, SCHEMA);
    const LEGACY = [
      'America/New_York',
      '',
      '{bad json',
      '[1,2',
      'quote " and backslash \\ and slash /',
      'line\nbreak\ttab\rreturn',
      'a\u0000b', // an embedded NUL: better-sqlite3 stores and reads it verbatim
      '\u0001\u001f\u007f',
      '  ',
      '﻿leading BOM',
      'emoji 😀 and 中文',
    ];
    for (const [i, s] of LEGACY.entries()) await plantRaw(d, `l${i}`, s);
    for (const [i, s] of LEGACY.entries()) expect(await disk(d, `l${i}`), `l${i} planted`).toEqual({ t: 'text', v: s });

    await d.syncSchema(T, SCHEMA);
    const read = await readAll(d);
    for (const [i, s] of LEGACY.entries()) {
      // What the retired statement wrote, computed by SQLite itself.
      const quoted = ((await d.execute('select json_quote(?) as q', [s])) as any[])[0].q;
      expect(await disk(d, `l${i}`), `l${i}`).toEqual({ t: 'text', v: quoted });
      expect(quoted, `l${i}: json_quote and JSON.stringify agree`).toBe(JSON.stringify(s));
      expect(read.get(`l${i}`), `l${i} reads as the string it is`).toBe(s);
    }
  });

  it('the rule is the read codec: a cell is rewritten exactly when the driver reads it back as its own text', async () => {
    const d = await makeDriver();
    await d.syncSchema(T, SCHEMA);
    const TEXTS = [
      JSON.stringify(deepArray(1000)),
      JSON.stringify(deepArray(1001)),
      JSON.stringify(deepArray(2001)),
      JSON.stringify(deepObject(1001)),
      '{"a":1}',
      '"already quoted"',
      ' [1] ',
      '1e400',
      '"\\ud800"',
      'bare',
      '',
      '{bad json',
      '[1,]',
    ];
    for (const [i, s] of TEXTS.entries()) await plantRaw(d, `t${i}`, s);
    const readBefore = await readAll(d);

    await d.syncSchema(T, SCHEMA);
    for (const [i, s] of TEXTS.entries()) {
      const readsAsItself = readBefore.get(`t${i}`) === s;
      const rule = recoverUnencodedJsonText(s);
      expect(rule !== null, `t${i}: the rule rewrites iff the read answers the text itself`).toBe(readsAsItself);
      expect((await disk(d, `t${i}`)).v, `t${i} on disk`).toBe(rule ?? s);
    }
    // …and no read moved.
    const readAfter = await readAll(d);
    for (const [i] of TEXTS.entries()) {
      expect(readAfter.get(`t${i}`), `t${i} reads the same`).toStrictEqual(readBefore.get(`t${i}`));
    }
  });

  it('compare-and-set: a value written between the page read and the write is not overwritten', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-19912-'));
    dirs.push(dir);
    const file = join(dir, 'cas.db');
    const d = await makeDriver(file);
    await d.syncSchema(T, SCHEMA);
    await plantRaw(d, 'raced', 'bare');
    await plantRaw(d, 'calm', 'also bare');

    // A second connection — another process on the same file — writes the deep
    // array into `raced` right after the backfill has read its candidates.
    const other = new Database(file);
    const deepText = JSON.stringify(deepArray(1001));
    const knex = (d as any).knex;
    let injected = 0;
    const onResponse = (_res: unknown, q: { sql?: string }) => {
      if (injected === 0 && /json_valid/.test(q.sql ?? '') && /^select/i.test(q.sql ?? '')) {
        other.prepare(`update "${T}" set "val" = ? where "id" = 'raced'`).run(deepText);
        injected++;
      }
    };
    knex.on('query-response', onResponse);
    try {
      await d.syncSchema(T, SCHEMA);
    } finally {
      knex.removeListener('query-response', onResponse);
      other.close();
    }

    expect(injected).toBe(1);
    // The concurrent write survives: the backfill decided on 'bare', and the
    // cell no longer holds 'bare'.
    expect(await disk(d, 'raced')).toEqual({ t: 'text', v: deepText });
    expect(arrayDepth((await readAll(d)).get('raced'))).toBe(1001);
    // The row nobody raced converged as usual.
    expect(await disk(d, 'calm')).toEqual({ t: 'text', v: '"also bare"' });
  });

  it('pages: a column with more candidates than one page converges in one pass, withheld cells on the page edges', async () => {
    const d = await makeDriver();
    await d.syncSchema(T, SCHEMA);
    const knex = (d as any).knex;
    const deepText = JSON.stringify(deepArray(1001));
    const DEEP_AT = new Set([0, 499, 500, 999, 1099]);
    const rows = Array.from({ length: 1100 }, (_, i) => ({
      id: `r${String(i).padStart(4, '0')}`,
      label: 'x',
      val: DEEP_AT.has(i) ? deepText : `legacy ${i}`,
    }));
    await knex.batchInsert(T, rows, 200);

    await d.syncSchema(T, SCHEMA);

    const left = (await d.execute(
      `select "id", "val" from "${T}" where json_valid("val") = 0 order by "id"`,
    )) as Array<{ id: string; val: string }>;
    expect(left.map((r) => r.id)).toEqual([...DEEP_AT].map((i) => `r${String(i).padStart(4, '0')}`));
    for (const r of left) expect(r.val).toBe(deepText);
    const converted = (await d.execute(
      `select count(*) as n from "${T}" where "val" = json_quote('legacy ' || (substr("id", 2) + 0))`,
    )) as any[];
    expect(Number(converted[0].n)).toBe(1100 - DEEP_AT.size);

    const info = ((d as any).logger.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(info).toContainEqual({ rowsConverted: 1100 - DEEP_AT.size });
    expect(info).toContainEqual({ rowsWithheld: DEEP_AT.size });
  });
});

describe('[#19912] recoverUnencodedJsonText — the shared rule', () => {
  it('leaves text that parses; rewrites text that does not as its JSON string', () => {
    expect(recoverUnencodedJsonText(JSON.stringify(deepArray(1001)))).toBeNull();
    expect(recoverUnencodedJsonText('{"a":1}')).toBeNull();
    expect(recoverUnencodedJsonText('123')).toBeNull();
    expect(recoverUnencodedJsonText('"x"')).toBeNull();
    expect(recoverUnencodedJsonText('bare')).toBe('"bare"');
    expect(recoverUnencodedJsonText('')).toBe('""');
    expect(recoverUnencodedJsonText('a\u0000b')).toBe('"a\\u0000b"');
  });
});
