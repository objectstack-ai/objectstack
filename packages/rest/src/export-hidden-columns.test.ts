// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24143] The export's DEFAULT columns skip a field declared `hidden`.
 *
 * `FieldSchema.hidden` is "Hidden from default UI". The export's schema-derived
 * column set (no `?fields=`) used to take every field of the object, so the
 * hidden `__search` search companion — which `provisionSearchCompanion`
 * declares `hidden` + `system` + `readonly` on every object with a CJK-eligible
 * name field, and which the data reads strip from every row — became a
 * "Search Index" column that was empty on every row. Measured on a dev boot of
 * `examples/app-showcase`: `GET /api/v1/data/showcase_task/export?format=csv`
 * ended its header with `Search Index`.
 *
 * Driven through the REAL export route: a real `RestServer` on a real
 * `ObjectStackProtocolImplementation` on a real `ObjectQL` with a better-sqlite3
 * `:memory:` driver, the companion declared by its real producer. The security
 * service answers `getReadableFields` the way plugin-security does for a caller
 * no field-level rule restricts — every field of the object, the companion
 * included — which is the composition the showcase measurement ran under.
 *
 * Both halves of the ruling are pinned:
 *   - the default columns drop every `hidden` field, and keep the rest;
 *   - an explicit `?fields=` naming a hidden field is answered exactly as it was
 *     (the header names it; the companion's cells stay empty because the read
 *     strips its value, an author-declared hidden field's cells carry its value).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL, provisionSearchCompanion } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';
import { loadXlsxWorkbook } from './xlsx-test-loader.js';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * `title` is the name field, so the companion's real producer declares
 * `__search` on this object. `internal_code` is an author-declared hidden field
 * that carries a real value, so a column that survives shows it.
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

function makeBinRes() {
  const chunks: Buffer[] = [];
  const res: any = {
    write: (c: any) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return true; },
    end: () => {},
    header: () => res,
    status: () => res,
    json: () => res,
  };
  return { res, getBuffer: () => Buffer.concat(chunks) };
}

function parseCsv(text: string): string[][] {
  return text.split('\r\n').filter((l) => l.length > 0).map((l) => l.split(','));
}

/**
 * @param withSecurity whether a security service answers `getReadableFields`
 *   (the showcase's composition), or none is composed (the masked-row fallback).
 */
async function boot(opts: { withSecurity: boolean; rows?: boolean }) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  engine.registry.registerObject(NOTE as any);
  await engine.syncSchemas();
  if (opts.rows !== false) {
    await engine.insert('note', { id: '1', title: 'First', internal_code: 'IC-1' });
    await engine.insert('note', { id: '2', title: 'Second', internal_code: 'IC-2' });
  }
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  // plugin-security's answer for a caller no field-level rule restricts: every
  // schema field NOT marked non-readable — the companion included.
  const readableAsked: string[][] = [];
  const getReadableFields = (object: string) => {
    const answer = Object.keys((engine.registry.getObject(object) as any)?.fields ?? {});
    readableAsked.push(answer);
    return answer;
  };
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
  return { engine, route, readableAsked };
}

async function csvOf(route: any, query: Record<string, string>): Promise<string[][]> {
  const { res, text } = makeRes();
  await route.handler({ params: { object: 'note' }, query: { format: 'csv', ...query } } as any, res);
  return parseCsv(text());
}

describe('export default columns skip `hidden` fields (#24143)', () => {
  it('the fixture is not vacuous: the companion is declared hidden, and the readable projection admits it', async () => {
    const { engine, route, readableAsked } = await boot({ withSecurity: true });
    const fields = (engine.registry.getObject('note') as any).fields;
    expect(fields.__search).toMatchObject({ label: 'Search Index', hidden: true });
    expect(fields.internal_code.hidden).toBe(true);
    await csvOf(route, {});
    // The FLS projection the route asked would have kept both hidden fields.
    expect(readableAsked).toHaveLength(1);
    expect(readableAsked[0]).toEqual(expect.arrayContaining(['__search', 'internal_code', 'title']));
  });

  it('CSV, schema-derived: no column for a hidden field — `__search` included — and the visible ones stay', async () => {
    const { route } = await boot({ withSecurity: true });
    const rows = await csvOf(route, {});
    expect(rows[0]).toEqual(['ID', 'Title']);
    expect(rows.slice(1)).toEqual([['1', 'First'], ['2', 'Second']]);
  });

  it('CSV, schema-derived, no security service (the masked-row fallback): the hidden field is dropped there too', async () => {
    const { route } = await boot({ withSecurity: false });
    const rows = await csvOf(route, {});
    expect(rows[0]).toEqual(['ID', 'Title']);
    expect(rows.slice(1)).toEqual([['1', 'First'], ['2', 'Second']]);
  });

  it('CSV, schema-derived, zero rows: the projected header carries no hidden column', async () => {
    const { route } = await boot({ withSecurity: true, rows: false });
    expect(await csvOf(route, {})).toEqual([['ID', 'Title']]);
  });

  it('XLSX, schema-derived: the header row skips the hidden fields', async () => {
    const { route } = await boot({ withSecurity: true });
    const { res, getBuffer } = makeBinRes();
    await route.handler({ params: { object: 'note' }, query: { format: 'xlsx' } } as any, res);
    const ws = (await loadXlsxWorkbook(getBuffer())).worksheets[0];
    expect((ws.getRow(1).values as any[]).slice(1)).toEqual(['ID', 'Title']);
    expect((ws.getRow(2).values as any[]).slice(1)).toEqual(['1', 'First']);
  });

  it('explicit ?fields= naming hidden fields is answered as before: both columns kept, the companion empty, the hidden field valued', async () => {
    const { route } = await boot({ withSecurity: true });
    const rows = await csvOf(route, { fields: 'title,internal_code,__search' });
    expect(rows[0]).toEqual(['Title', 'Internal Code', 'Search Index']);
    expect(rows.slice(1)).toEqual([['First', 'IC-1', ''], ['Second', 'IC-2', '']]);
  });
});
