// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20537] The REMOTE face's half of #20432: a declared index the remote
 * transport skips, because a key column never materializes, is reported at
 * `error` on the durability sink.
 *
 * ## The defect this pins
 *
 * `RemoteTransport.buildDeclaredIndexDDL` plans no DDL for a declared index
 * whose key column is not a stored column: a misspelt name (`statsu` on a
 * table whose column is `status`), or a virtual `formula` field. That skip is
 * right, since DDL naming a column that does not exist would fail the whole
 * sync. But it was reported through the DIAGNOSTIC sink, which `TursoDriver`
 * wires to `logger.warn`. For a UNIQUE index that is the AGENTS.md
 * durability-degradation shape: every write keeps succeeding, duplicates are
 * accepted, and the only trace was a `warn`. The same transport already has a
 * second, durability sink (wired to `logger.error`) for exactly this class,
 * and its retrofit arm already reports a unique AND a plain index it could not
 * create there. The local face (`SqlDriver.syncDeclaredIndexes`) logs the same
 * skip through `logDurabilityFailure`, for unique and plain alike.
 *
 * ## What is asserted
 *
 * The CHANNEL (durability sink, never the diagnostic one), the number of lines
 * (one per skipped index per sync), the named subjects (table, index name,
 * missing column), and the one word that says which kind of index it is
 * (`UNIQUE`, or its absence). The prose is not pinned beyond that. The
 * consequence the line reports is also checked against the database: the
 * index really is absent.
 *
 * The matrix is {misspelt, formula} x {unique, plain}, as the card asks, over
 * all four ways a sync reaches the skip: `syncSchema` and `syncSchemasBatch`,
 * each against a new table and against one that already exists (the retrofit
 * leg). The four share one builder, and a card that fixes one call site is
 * the shape AGENTS.md Prime Directive #10 warns about.
 *
 * The client is the real `@libsql/client` over `file::memory:`, as the
 * declared-index parity suite uses, so "the index is absent" is read off
 * `sqlite_master` rather than inferred from a string. The last `describe`
 * drives the whole `TursoDriver` in remote mode and reads the LEVEL, because
 * the sink-to-level wiring lives in `turso-driver.ts`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { buildIndexName } from '@objectstack/driver-sql';
import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';

type ObjectDef = {
  name: string;
  fields: Record<string, any>;
  indexes?: Array<{ fields: string[]; unique?: boolean }>;
};

interface Cell {
  label: string;
  table: string;
  fields: Record<string, any>;
  /** The key column that never materializes. */
  column: string;
  unique: boolean;
}

const CELLS: Cell[] = [
  {
    label: 'a misspelt key column, UNIQUE index',
    table: 'os20537_misspelt_unique',
    fields: { status: { type: 'text', maxLength: 64 } },
    column: 'statsu',
    unique: true,
  },
  {
    label: 'a misspelt key column, plain index',
    table: 'os20537_misspelt_plain',
    fields: { status: { type: 'text', maxLength: 64 } },
    column: 'statsu',
    unique: false,
  },
  {
    label: 'a formula key column, UNIQUE index',
    table: 'os20537_formula_unique',
    fields: { amount: { type: 'number' }, doubled: { type: 'formula', expression: 'amount * 2' } },
    column: 'doubled',
    unique: true,
  },
  {
    label: 'a formula key column, plain index',
    table: 'os20537_formula_plain',
    fields: { amount: { type: 'number' }, doubled: { type: 'formula', expression: 'amount * 2' } },
    column: 'doubled',
    unique: false,
  },
];

const withIndex = (cell: Cell): ObjectDef => ({
  name: cell.table,
  fields: Object.fromEntries(Object.entries(cell.fields).map(([k, v]) => [k, { ...v }])),
  indexes: [{ fields: [cell.column], ...(cell.unique ? { unique: true } : {}) }],
});

const withoutIndex = (cell: Cell): ObjectDef => {
  const { indexes: _dropped, ...rest } = withIndex(cell);
  return rest;
};

type SyncPath = 'syncSchema' | 'syncSchemasBatch';
const PATHS: SyncPath[] = ['syncSchema', 'syncSchemasBatch'];
type TableState = 'new table' | 'existing table';
const STATES: TableState[] = ['new table', 'existing table'];

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

/** A transport over an in-memory libsql database, with both sinks captured. */
function transport(): { t: RemoteTransport; client: Client; durability: string[]; diagnostic: string[] } {
  const client = createClient({ url: 'file::memory:' });
  cleanups.push(() => client.close());
  const t = new RemoteTransport();
  t.setClient(client);
  const durability: string[] = [];
  const diagnostic: string[] = [];
  t.setDurabilitySink((m) => durability.push(m));
  t.setDiagnosticSink((m) => diagnostic.push(m));
  return { t, client, durability, diagnostic };
}

const sync = (t: RemoteTransport, path: SyncPath, def: ObjectDef): Promise<void> =>
  path === 'syncSchema'
    ? t.syncSchema(def.name, def)
    : t.syncSchemasBatch([{ object: def.name, schema: def }]);

const indexNames = async (client: Client, table: string): Promise<string[]> =>
  (await client.execute({ sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`, args: [table] }))
    .rows.map((r) => String(r.name));

const tableExists = async (client: Client, table: string): Promise<boolean> =>
  (await client.execute({ sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, args: [table] }))
    .rows.length === 1;

describe('[#20537] a declared index the remote face skips is reported on the durability sink', () => {
  for (const cell of CELLS) {
    const INDEX = buildIndexName(cell.table, [cell.column], cell.unique);

    describe(cell.label, () => {
      for (const path of PATHS) {
        for (const state of STATES) {
          it(`${path}, ${state}: one durability line naming the index, and no diagnostic line`, async () => {
            const { t, client, durability, diagnostic } = transport();
            if (state === 'existing table') {
              await sync(t, path, withoutIndex(cell));
              expect(await tableExists(client, cell.table)).toBe(true);
              durability.length = 0;
              diagnostic.length = 0;
            }

            // The sync goes on: the skip never fails it.
            await expect(sync(t, path, withIndex(cell))).resolves.toBeUndefined();
            expect(await tableExists(client, cell.table)).toBe(true);

            const lines = durability.filter((m) => m.includes(`"${INDEX}"`));
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain(`"${cell.table}"`);
            expect(lines[0]).toContain(`'${cell.column}'`);
            if (cell.unique) expect(lines[0]).toContain('UNIQUE');
            else expect(lines[0]).not.toContain('UNIQUE');
            // Nothing else reached the durability sink for this object.
            expect(durability).toEqual(lines);

            // The level MOVED; it did not gain a second line. Before the fix this
            // skip reached ONLY the diagnostic sink, naming the column.
            expect(diagnostic.filter((m) => m.includes(cell.column) || m.includes(INDEX))).toEqual([]);

            // The consequence the line reports is real: nothing was built.
            expect(await indexNames(client, cell.table)).not.toContain(INDEX);
          });
        }
      }
    });
  }
});

describe('[#20537] through TursoDriver in remote mode, the skip lands on logger.error, not logger.warn', () => {
  for (const cell of CELLS.filter((c) => c.column === 'statsu')) {
    it(cell.label, async () => {
      const client = createClient({ url: 'file::memory:' });
      const driver = new TursoDriver({ url: 'libsql://unbuildable-declared-index.turso.io', client });
      await driver.connect();
      cleanups.push(() => driver.disconnect());
      expect(driver.transportMode).toBe('remote');
      const logger = (driver as unknown as { logger: { warn: (m: string) => void; error: (m: string) => void } })
        .logger;
      const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const INDEX = buildIndexName(cell.table, [cell.column], cell.unique);

      await expect(driver.initObjects([withIndex(cell)] as never)).resolves.toBeUndefined();

      const errors = error.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(`"${INDEX}"`));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`'${cell.column}'`);
      expect(warn.mock.calls.some((c) => String(c[0]).includes(cell.column))).toBe(false);
      expect(await indexNames(client, cell.table)).not.toContain(INDEX);
    });
  }
});
