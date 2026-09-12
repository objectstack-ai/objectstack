// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17175] The shared non-raising table-presence probe.
 *
 * ## What this file is FOR, in one line
 *
 * Two things, and the second is the one that can be got wrong quietly: that a
 * recognised dialect never runs the raising probe at all, and that "the catalog
 * says no" and "the probe could not run" never answer the same.
 *
 * ## ⛔ The fence, pinned in BOTH directions
 *
 * The failure mode of this repair is its own: a catalog arm mis-compiled for
 * some dialect raises, is caught by the same \`catch\` the expected miss uses,
 * and reads as "the table is not there" — turning a stored-row data repair into
 * a SILENT no-op on whichever dialect nobody exercised. That is strictly worse
 * than the noisy log this card removes. So both directions are asserted here:
 * an ANSWERED absence is \`'absent'\`, and a refused probe is \`'unreadable'\` and
 * never \`'absent'\`.
 *
 * ## Dialect coverage, stated rather than implied
 *
 * The statement TEXT of all three arms is pinned here, and it is pinned against
 * every knex client spelling \`SqlDriver\` emits for, so a spelling dropped from
 * one family does not silently fall through to the fallback probe.
 *
 * ⚠️ Running those statements against a live SERVER is a different claim, and
 * this file does not make it. The MySQL arm is executed against a real server in
 * \`seed-tenancy-backfill.live-mysql.test.ts\`; the SQLite arm end to end against
 * a real \`SqlDriver\` in \`packages/runtime\`'s
 * \`seed-tenancy-autonumber-split.integration.test.ts\`. ⛔ The POSTGRES arm is
 * NOT MEASURED against a live server anywhere — this package has no live-PG
 * harness, no \`pg\` dependency, and its CI leg supplies \`OS_TEST_MYSQL_URL\`
 * only while filtering to \`live-mysql\`. Recorded here rather than left to be
 * discovered.
 */

import { describe, it, expect } from 'vitest';
import { buildTablePresenceSql, readTablePresence, type ReadProbeExec } from './read-probe.js';
import { SEQUENCES_TABLE } from './seed-tenancy-backfill.js';

const TABLE = SEQUENCES_TABLE;
/** The caller's pre-#17175 statement — what the fallback arm runs, and nothing else may. */
const FALLBACK_SQL = `SELECT "tenant_id" FROM "${TABLE}" WHERE 1 = 0`;

const SQLITE_CLIENTS = ['sqlite3', 'sqlite', 'better-sqlite3'];
const POSTGRES_CLIENTS = ['postgres', 'pg', 'postgresql', 'pgnative'];
const MYSQL_CLIENTS = ['mysql', 'mysql2'];

/** A seam that records every statement it is handed, then answers `answer(sql)`. */
function recordingExec(answer: (sql: string) => unknown): { exec: ReadProbeExec; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    exec: async (sql: string) => {
      seen.push(sql);
      const out = answer(sql);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

const ONE_ROW = [{ present: 1 }];

describe('[#17175] buildTablePresenceSql — one arm per dialect family, and no guessing', () => {
  it('every SQLite spelling compiles the sqlite_master arm', () => {
    for (const client of SQLITE_CLIENTS) {
      expect(buildTablePresenceSql(TABLE, client)).toBe(
        `SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = '${TABLE}'`,
      );
    }
  });

  it('every Postgres spelling compiles the to_regclass arm', () => {
    for (const client of POSTGRES_CLIENTS) {
      expect(buildTablePresenceSql(TABLE, client)).toBe(
        `SELECT 1 WHERE to_regclass('"${TABLE}"') IS NOT NULL`,
      );
    }
  });

  it('every MySQL spelling compiles the information_schema arm, scoped to the connected schema', () => {
    for (const client of MYSQL_CLIENTS) {
      expect(buildTablePresenceSql(TABLE, client)).toBe(
        `SELECT 1 FROM information_schema.tables ` +
          `WHERE table_schema = DATABASE() AND table_name = '${TABLE}'`,
      );
    }
  });

  it('no arm can be refused for the reason the old probe was — none names the table in a FROM', () => {
    // The whole mechanism, asserted rather than described: the statement the
    // probe runs does not read FROM the table it is asking about, so a missing
    // table cannot make it fail. That is what stops the driver composing a
    // `DATABASE_ERROR` line on the happy path.
    for (const client of [...SQLITE_CLIENTS, ...POSTGRES_CLIENTS, ...MYSQL_CLIENTS]) {
      const sql = buildTablePresenceSql(TABLE, client) as string;
      expect(sql).not.toContain('WHERE 1 = 0');
      expect(sql).not.toContain(`FROM "${TABLE}"`);
      expect(sql).not.toContain(`FROM \`${TABLE}\``);
      expect(sql).not.toMatch(new RegExp(`FROM\\s+${TABLE}\\b`));
    }
  });

  it('⛔ an unrecognised client compiles NOTHING — a default arm would be a guess', () => {
    for (const client of ['oracledb', 'mssql', 'cockroachdb', 'libsql', '', undefined]) {
      expect(buildTablePresenceSql(TABLE, client)).toBeUndefined();
    }
  });

  it('⛔ a name that is not a plain identifier compiles nothing — it reaches SQL as a literal', () => {
    for (const table of [`x'; DROP TABLE y; --`, 'has space', 'has"quote', '1leading_digit', '']) {
      for (const client of ['better-sqlite3', 'pg', 'mysql2']) {
        expect(buildTablePresenceSql(table, client)).toBeUndefined();
      }
    }
  });
});

describe('[#17175] readTablePresence — the catalog arm, on a recognised dialect', () => {
  it('a row means present, and ⛔ the raising probe is never issued', async () => {
    const { exec, seen } = recordingExec(() => ONE_ROW);

    const result = await readTablePresence(exec, { table: TABLE, client: 'better-sqlite3', fallbackSql: FALLBACK_SQL });

    expect(result).toEqual({ verdict: 'present', probe: 'catalog' });
    // ⭐ The card's whole point: on a recognised dialect the seam never sees the
    // statement whose refusal the driver logs.
    expect(seen).toEqual([buildTablePresenceSql(TABLE, 'better-sqlite3')]);
    expect(seen.join('\n')).not.toContain('WHERE 1 = 0');
  });

  it('zero rows means ABSENT — in all three dialect result-set spellings, and with no detail', async () => {
    const empties: Array<[string, unknown]> = [
      ['better-sqlite3', []],
      ['pg', { rows: [], rowCount: 0 }],
      ['mysql2', [[], []]],
    ];
    for (const [client, empty] of empties) {
      const { exec, seen } = recordingExec(() => empty);

      const result = await readTablePresence(exec, { table: TABLE, client, fallbackSql: FALLBACK_SQL });

      expect(result).toEqual({ verdict: 'absent', probe: 'catalog' });
      expect(result.detail).toBeUndefined();
      expect(seen.join('\n')).not.toContain('WHERE 1 = 0');
    }
  });

  it('a non-empty result set in each dialect spelling means PRESENT', async () => {
    const filled: Array<[string, unknown]> = [
      ['better-sqlite3', ONE_ROW],
      ['pg', { rows: ONE_ROW, rowCount: 1 }],
      ['mysql2', [ONE_ROW, []]],
    ];
    for (const [client, rows] of filled) {
      const { exec } = recordingExec(() => rows);
      const result = await readTablePresence(exec, { table: TABLE, client, fallbackSql: FALLBACK_SQL });
      expect(result.verdict).toBe('present');
    }
  });

  it('a seam that answers NOTHING is no-answer — #10789, unchanged and still separated by detail', async () => {
    const { exec } = recordingExec(() => null);

    const result = await readTablePresence(exec, { table: TABLE, client: 'pg', fallbackSql: FALLBACK_SQL });

    expect(result.verdict).toBe('no-answer');
    expect(result.detail).toMatch(/no result set/);
  });

  it('⛔ THE FENCE: a refused catalog statement is UNREADABLE, never absent', async () => {
    // A mis-compiled arm, a permission denial and a dropped connection all land
    // here. Reading any of them as "the table is not there" is what would make
    // the repair decline in silence on an unexercised dialect.
    for (const refusal of [
      new Error('near "to_regclass": syntax error'),
      new Error('permission denied for table pg_class'),
      new Error('ECONNREFUSED 127.0.0.1:5432'),
    ]) {
      const { exec } = recordingExec(() => refusal);

      const result = await readTablePresence(exec, { table: TABLE, client: 'pg', fallbackSql: FALLBACK_SQL });

      expect(result.verdict).toBe('unreadable');
      expect(result.verdict).not.toBe('absent');
      expect(result.probe).toBe('catalog');
      expect(result.detail).toContain(refusal.message);
    }
  });

  it('⛔ even a refusal whose words LOOK like absence is unreadable on the catalog arm', async () => {
    // The catalog statement does not read from the target table, so a phrase
    // naming it cannot be evidence about it — it is evidence that something
    // else is wrong. ⛔ Do not add an `isMissingTableError` branch here: it
    // would re-open the exact conflation this card closes, one layer down.
    const { exec } = recordingExec(() => new Error(`no such table: ${TABLE}`));

    const result = await readTablePresence(exec, { table: TABLE, client: 'better-sqlite3', fallbackSql: FALLBACK_SQL });

    expect(result.verdict).toBe('unreadable');
  });
});

describe('[#17175] readTablePresence — the fallback arm, on a dialect with no catalog statement', () => {
  const UNKNOWN = { table: TABLE, client: 'oracledb', fallbackSql: FALLBACK_SQL };

  it('runs the CALLER\'s own statement — not one invented here', async () => {
    const { exec, seen } = recordingExec(() => []);

    const result = await readTablePresence(exec, UNKNOWN);

    expect(seen).toEqual([FALLBACK_SQL]);
    expect(result).toEqual({ verdict: 'present', probe: 'fallback' });
  });

  it('a refusal this table\'s own absence explains is ABSENT — the pre-#17175 answer, kept', async () => {
    const { exec } = recordingExec(() => new Error(`no such table: ${TABLE}`));

    const result = await readTablePresence(exec, UNKNOWN);

    expect(result).toEqual({ verdict: 'absent', probe: 'fallback' });
  });

  it('⛔ a refusal naming a DIFFERENT relation is unreadable — #13324 narrowing, not absence', async () => {
    const { exec } = recordingExec(() => new Error('no such table: some_other_table'));

    const result = await readTablePresence(exec, UNKNOWN);

    expect(result.verdict).toBe('unreadable');
    expect(result.verdict).not.toBe('absent');
  });

  it('⛔ THE FENCE on this arm too: a refusal that is not about absence is unreadable', async () => {
    const { exec } = recordingExec(() => new Error('ECONNREFUSED 127.0.0.1:3306'));

    const result = await readTablePresence(exec, UNKNOWN);

    expect(result.verdict).toBe('unreadable');
    expect(result.detail).toContain('ECONNREFUSED');
  });

  it('a seam that answers nothing is no-answer here too', async () => {
    const { exec } = recordingExec(() => undefined);

    const result = await readTablePresence(exec, UNKNOWN);

    expect(result.verdict).toBe('no-answer');
    expect(result.detail).toMatch(/no result set/);
  });

  it('POSITIVE CONTROL: the same seam on a RECOGNISED dialect takes the other arm', async () => {
    // Without this, every assertion above would still pass if
    // `catalogFamilyOf` had silently stopped recognising anything — the whole
    // file would be testing the fallback and reporting success.
    const { exec, seen } = recordingExec((sql) => (sql.includes('sqlite_master') ? ONE_ROW : []));

    const result = await readTablePresence(exec, { ...UNKNOWN, client: 'better-sqlite3' });

    expect(result.probe).toBe('catalog');
    expect(seen).not.toContain(FALLBACK_SQL);
  });
});
