// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24183] `format=json` honours an explicit `?fields=` list.
 *
 * The route's doc comment declares `fields=a,b,c` for every format. The CSV
 * and XLSX arms write exactly the listed columns, in list order; the JSON arm
 * wrote each row as the read returned it, so objectui's list-view export —
 * which sends `format=json` with the view's visible columns — downloaded every
 * readable field, and no status told the caller its `fields` was ignored.
 *
 * Driven through the REAL export route: a real `RestServer` on a real
 * `ObjectStackProtocolImplementation` on a real `ObjectQL` with a better-sqlite3
 * `:memory:` driver. The protocol's `findData` is observed, so every pin can
 * show what the read handed the route next to what the route answered — the
 * projection is the route's, not the read's.
 *
 * What is pinned:
 *   - the CSV arm, measured: `?fields=title` writes the `Title` column and no
 *     other, so the CSV arm adds no always-written key and JSON adds none;
 *   - JSON rows carry exactly the named keys, in list order, on every chunk;
 *   - values keep the export's readable formatting;
 *   - a named key the read did not return (the stripped `__search` companion)
 *     is absent from the row, never invented as `null` — the same answer the
 *     list door's `$select` gives;
 *   - the projection does not depend on a security service being composed.
 *
 * Out of scope here: `format=json` with no `?fields=` — its column set is a
 * separate decision (the export's schema-derived default does not carry `id`
 * on an object that does not declare it).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL, provisionSearchCompanion } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * `title` is the name field, so the companion's real producer declares
 * `__search` on this object (and the read strips its value). `done` is a
 * boolean, so a projected value is visibly formatted (`是` / `否`).
 */
const NOTE = provisionSearchCompanion({
  name: 'note',
  label: 'Note',
  nameField: 'title',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    title: { name: 'title', type: 'text' as const, label: 'Title' },
    internal_code: { name: 'internal_code', type: 'text' as const, label: 'Internal Code', hidden: true },
    done: { name: 'done', type: 'boolean' as const, label: 'Done' },
  },
});

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: string[] = [];
  const res: any = {
    write: (s: string) => { chunks.push(typeof s === 'string' ? s : String(s)); return true; },
    end: () => {},
    header: () => res,
    status: () => res,
    json: () => res,
  };
  return { res, text: () => chunks.join('') };
}

async function boot(opts: { withSecurity: boolean; rowCount?: number }) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  engine.registry.registerObject(NOTE as any);
  await engine.syncSchemas();
  const rowCount = opts.rowCount ?? 2;
  for (let i = 1; i <= rowCount; i++) {
    await engine.insert('note', { id: String(i), title: `Note ${i}`, internal_code: `IC-${i}`, done: i % 2 === 1 });
  }
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  // Every row the route reads, as the read handed it over, and how many reads.
  const readRows: Array<Record<string, unknown>> = [];
  const reads = { count: 0 };
  const findData = protocol.findData.bind(protocol);
  (protocol as any).findData = async (args: any) => {
    const result: any = await findData(args);
    if (args?.object === 'note') {
      reads.count += 1;
      for (const r of result?.records ?? []) readRows.push({ ...r });
    }
    return result;
  };
  // plugin-security's answer for a caller no field-level rule restricts.
  const getReadableFields = (object: string) => Object.keys((engine.registry.getObject(object) as any)?.fields ?? {});
  const securityServiceProvider = opts.withSecurity ? async () => ({ getReadableFields }) : undefined;
  const rest = new RestServer(
    createMockServer() as any,
    protocol as any,
    { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    securityServiceProvider,
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
  )!;
  return { route, readRows, reads };
}

async function exportOf(route: any, query: Record<string, string>): Promise<string> {
  const { res, text } = makeRes();
  await route.handler({ params: { object: 'note' }, query } as any, res);
  return text();
}

async function jsonOf(route: any, query: Record<string, string>): Promise<Array<Record<string, unknown>>> {
  return JSON.parse(await exportOf(route, { format: 'json', ...query }));
}

describe('format=json honours an explicit ?fields= (#24183)', () => {
  it('the CSV arm, measured: `?fields=title` writes that one column and no always-written key', async () => {
    const { route, readRows } = await boot({ withSecurity: true });
    const lines = (await exportOf(route, { format: 'csv', fields: 'title' })).split('\r\n').filter(Boolean);
    expect(lines).toEqual(['Title', 'Note 1', 'Note 2']);
    // The read handed the route more than the one column it wrote.
    expect(Object.keys(readRows[0])).toEqual(expect.arrayContaining(['id', 'title', 'internal_code', 'done']));
  });

  it('JSON `?fields=title`: each row carries exactly `title`, though the read returned more', async () => {
    const { route, readRows } = await boot({ withSecurity: true });
    const rows = await jsonOf(route, { fields: 'title' });
    expect(rows).toEqual([{ title: 'Note 1' }, { title: 'Note 2' }]);
    expect(readRows).toHaveLength(2);
    expect(Object.keys(readRows[0])).toEqual(expect.arrayContaining(['id', 'title', 'internal_code', 'done']));
  });

  it('JSON: an explicit list keeps its order, and the values keep the export formatting', async () => {
    const { route } = await boot({ withSecurity: true });
    const rows = await jsonOf(route, { fields: 'done,internal_code,title,id' });
    expect(rows.map((r) => Object.keys(r))).toEqual([
      ['done', 'internal_code', 'title', 'id'],
      ['done', 'internal_code', 'title', 'id'],
    ]);
    expect(rows[0]).toEqual({ done: '是', internal_code: 'IC-1', title: 'Note 1', id: '1' });
    expect(rows[1]).toEqual({ done: '否', internal_code: 'IC-2', title: 'Note 2', id: '2' });
  });

  it('JSON: a named key the read did not return is absent, never invented as null (the stripped companion)', async () => {
    const { route, readRows } = await boot({ withSecurity: true });
    const rows = await jsonOf(route, { fields: 'title,__search' });
    expect(readRows.every((r) => !('__search' in r))).toBe(true);
    expect(rows).toEqual([{ title: 'Note 1' }, { title: 'Note 2' }]);
    // The CSV arm answers the same list with an empty column.
    const lines = (await exportOf(route, { format: 'csv', fields: 'title,__search' })).split('\r\n').filter(Boolean);
    expect(lines).toEqual(['Title,Search Index', 'Note 1,', 'Note 2,']);
  });

  it('JSON: the projection holds on every chunk, not only the first', async () => {
    const { route, readRows, reads } = await boot({ withSecurity: true, rowCount: 60 });
    // `page` is the chunk size; its floor is 50, so 60 rows read in two chunks.
    const rows = await jsonOf(route, { fields: 'id', page: '50' });
    expect(reads.count).toBe(2);
    expect(readRows).toHaveLength(60);
    expect(rows).toHaveLength(60);
    expect(rows.every((r) => Object.keys(r).length === 1 && typeof r.id === 'string')).toBe(true);
    expect(rows[59]).toEqual({ id: expect.any(String) });
  });

  it('JSON: the projection does not depend on a security service being composed', async () => {
    const { route } = await boot({ withSecurity: false });
    const rows = await jsonOf(route, { fields: 'title,id' });
    expect(rows).toEqual([{ title: 'Note 1', id: '1' }, { title: 'Note 2', id: '2' }]);
  });
});
