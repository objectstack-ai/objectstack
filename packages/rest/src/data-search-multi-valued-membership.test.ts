// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21009] `$search` over a MULTI-VALUED field answers by membership, through
 * the door a caller uses: `POST /api/v1/data/:object/query` with `search` →
 * `RestServer` → `ObjectStackProtocolImplementation.findData` → `ObjectQL.find`
 * (the search expander) → a real `SqlDriver`.
 *
 * Such a field is stored as a JSON array, and every operator but the membership
 * pair is refused on it (`INVALID_FILTER` / 400). The expander used to emit `$in`
 * for a label term and `$icontains` otherwise, so one multi-valued field in the
 * resolved set failed the WHOLE search. Measured on `origin/main` `7a606a9a3`
 * over the two objects below:
 *
 * | search                                    | SQLite              | PostgreSQL 16.14 |
 * |:--|:--|:--|
 * | task, a term matching no label            | 200 (by subject)    | 500              |
 * | task, a term matching a `tags` label      | 400 (the `$in`)     | 400              |
 * | note with a declared searchable `tags`    | 200 (substrings of the serialized array) | 500 |
 *
 * With the text family refused on a JSON column too, every one of them answered
 * 400 on both dialects until the expander emitted membership. Now a label term
 * finds the rows HOLDING that option value, a raw member term finds the rows
 * holding it, and a term that is no member finds none from that field — with no
 * 400 and no 500 on any term. The scalar fields beside them are the control.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set and are a named skip
 * otherwise; each owns its tables, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

/** `examples/app-todo`'s `todo_task.tags` shape: a `select` declared `multiple: true`, in the auto-default set. */
const TASK = {
  name: 'rest_search_task_21009',
  label: 'Task 21009',
  fields: {
    subject: { name: 'subject', type: 'text' as const },
    tags: {
      name: 'tags', type: 'select' as const, multiple: true,
      options: [{ label: 'Important', value: 'important' }, { label: 'Quick Win', value: 'quick_win' }],
    },
    status: {
      name: 'status', type: 'select' as const,
      options: [{ label: 'Open', value: 'open' }, { label: 'Done', value: 'done' }],
    },
  },
};

/** A declared searchable `tags` field (no options), beside a scalar text one. */
const NOTE = {
  name: 'rest_search_note_21009',
  label: 'Note 21009',
  searchableFields: ['title', 'labels'],
  fields: {
    title: { name: 'title', type: 'text' as const },
    labels: { name: 'labels', type: 'tags' as const },
  },
};

const TASK_ROWS = [
  { id: 't1', subject: 'Write meeting notes', tags: ['important'], status: 'open' },
  { id: 't2', subject: 'Plan sprint', tags: ['quick_win'], status: 'done' },
  { id: 't3', subject: 'Call vendor', tags: ['important', 'quick_win'], status: 'open' },
  { id: 't4', subject: 'Archive', tags: [], status: 'done' },
  { id: 't5', subject: 'Misc', tags: null, status: null },
];

const NOTE_ROWS = [
  { id: 'n1', title: 'Grocery list', labels: ['red', 'home'] },
  { id: 'n2', title: 'Red alert', labels: ['work'] },
  { id: 'n3', title: 'Blue sky', labels: ['redwood'] },
];

/** [object, term, the ids the search answers, what the row pins] */
const CASES: ReadonlyArray<readonly [string, string, string[], string]> = [
  [TASK.name, 'Important', ['t1', 't3'], 'a label term finds the rows holding that value'],
  [TASK.name, 'quick', ['t2', 't3'], 'a partial label term finds the rows holding the matched value'],
  [TASK.name, 'quick_win', ['t2', 't3'], 'a raw member term (no label contains it) finds the rows holding it'],
  [TASK.name, 'zebra', [], 'a term that is no member and no label finds none'],
  [TASK.name, 'meeting', ['t1'], 'a term only the scalar subject holds still finds by the subject'],
  [TASK.name, 'Open', ['t1', 't3'], 'control: the scalar select keeps its label → value match'],
  [NOTE.name, 'red', ['n1', 'n2'], 'a raw member term finds the member row; the scalar title finds its own'],
  [NOTE.name, 'redwood', ['n3'], 'a member term finds the row holding exactly that member'],
  [NOTE.name, 'wood', [], 'a substring of a member is not a member'],
  [NOTE.name, 'Blue', ['n3'], 'control: the scalar text field still folds case'],
];

interface Cell {
  id: 'sqlite' | 'pg' | 'mysql';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
}

const CELLS: readonly Cell[] = [
  { id: 'sqlite', label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
  {
    id: 'mysql',
    label: 'live mysql',
    env: 'OS_TEST_MYSQL_URL',
    config: () => (process.env.OS_TEST_MYSQL_URL ? { client: 'mysql2', connection: process.env.OS_TEST_MYSQL_URL } : null),
  },
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21009] POST /data/:object/query with search — a multi-valued field answers by membership — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      let driver: any;
      let post: (object: string, body: Record<string, unknown>) => Promise<{ status: number; json: any }>;

      const dropTables = async () => {
        if (cell.id === 'sqlite') return;
        for (const o of [TASK, NOTE]) await driver?.execute(`drop table if exists ${o.name}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(TASK as any);
        engine.registry.registerObject(NOTE as any);
        await engine.syncSchemas();
        for (const row of TASK_ROWS) await engine.insert(TASK.name, { ...row } as any);
        for (const row of NOTE_ROWS) await engine.insert(NOTE.name, { ...row } as any);
        vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
        expect(route).toBeDefined();
        post = async (object, body) => {
          const res = makeRes();
          await route!.handler({ params: { object }, body: JSON.parse(JSON.stringify(body)) } as any, res);
          return { status: res._status ?? 200, json: res._json };
        };
      }, 60_000);

      afterAll(async () => {
        await dropTables();
        await engine?.destroy().catch(() => {});
      }, 60_000);

      it('stored every row — the premise of every answer below', async () => {
        for (const [object, rows] of [[TASK.name, TASK_ROWS], [NOTE.name, NOTE_ROWS]] as const) {
          const r = await post(object, {});
          expect(r.status, JSON.stringify(r.json)).toBe(200);
          expect(r.json.records.map((x: any) => x.id).sort()).toEqual(rows.map((x) => x.id).sort());
        }
      }, 60_000);

      for (const [object, term, ids, what] of CASES) {
        it(`${object === TASK.name ? 'task' : 'note'} search "${term}": 200 ${JSON.stringify(ids)} — ${what}`, async () => {
          const r = await post(object, { search: term });
          expect(r.status, JSON.stringify(r.json)).toBe(200);
          expect(r.json.records.map((x: any) => x.id).sort()).toEqual(ids);
        }, 60_000);
      }
    },
  );
}
