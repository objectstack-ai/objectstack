// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An upsert import's match lookup reaches the database as
 * `organization_id = ? and <key> = ?`, so it is one probe of the
 * `(organization_id, <key>)` unique index instead of a scan of the table per
 * row. Measured through the real `runImport`, the real protocol `findData`
 * and a real `SqlDriver` (better-sqlite3 `:memory:`), under the `single`
 * posture, where the engine adds no tenant scope to a read (ADR-0131 D11).
 *
 * At the base the lookup was `select * from <object> where <key> = ? …`, and
 * SQLite planned it as a SCAN: a 100,000-row pull took an hour, slowing as the
 * table grew. The unit pins of the rule (which column, which organization,
 * when the lookup stays the key alone) are in
 * `packages/core/src/utils/import-runner-match-organization.test.ts`.
 *
 * CONTROL: a key with no index, and an object with no tenant column, still
 * match the stored row and update it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { runImport, type ImportProtocolLike } from '@objectstack/core';
import type { ExportFieldMeta } from './export-format.js';

const ITEM = {
  name: 'mo_item_31812', label: 'Item',
  fields: {
    external_id: { name: 'external_id', type: 'text' as const, label: 'External id', unique: true },
    code: { name: 'code', type: 'text' as const, label: 'Code' },
    title: { name: 'title', type: 'text' as const, label: 'Title' },
  },
};

/** No tenant column: `systemFields: false` injects none. */
const PLAIN = {
  name: 'mo_plain_31812', label: 'Plain', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    external_id: { name: 'external_id', type: 'text' as const, label: 'External id' },
    title: { name: 'title', type: 'text' as const, label: 'Title' },
  },
};

const ORG = 'org_31812';
const JOB_CONTEXT = { isSystem: true, tenantId: ORG };

const metaMap = new Map<string, ExportFieldMeta>([
  ['external_id', { name: 'external_id', type: 'text' }],
  ['code', { name: 'code', type: 'text' }],
  ['title', { name: 'title', type: 'text' }],
]);

const live: ObjectQL[] = [];
afterEach(async () => {
  while (live.length) {
    try { await live.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Statement { sql: string; bindings: unknown[] }

async function boot() {
  const engine = new ObjectQL();
  live.push(engine);
  engine.setTenancyPostureProvider(() => 'single');
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [ITEM, PLAIN, SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  await engine.syncSchemas();
  const knex = (driver as unknown as { knex: any }).knex;
  for (let i = 0; i < 20; i++) {
    await engine.insert(ITEM.name, { external_id: `E${i}`, code: `C${i}`, title: 'old' }, { context: JOB_CONTEXT });
    await engine.insert(PLAIN.name, { id: `p${i}`, external_id: `E${i}`, title: 'old' }, { context: JOB_CONTEXT });
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any) as unknown as ImportProtocolLike;

  /** Run an upsert import and return the SELECTs it sent for `object`. */
  const upsert = async (object: string, matchField: string, rows: Array<Record<string, unknown>>) => {
    const seen: Statement[] = [];
    const onQuery = (q: Statement) => {
      if (/^select \*/i.test(q.sql) && q.sql.includes(`\`${object}\``)) seen.push({ sql: q.sql, bindings: q.bindings });
    };
    knex.on('query', onQuery);
    try {
      const summary = await runImport({
        p: protocol, objectName: object, context: JOB_CONTEXT, rows, metaMap,
        writeMode: 'upsert', matchFields: [matchField], dryRun: false, runAutomations: false,
        trimWhitespace: true, createMissingOptions: false, skipBlankMatchKey: false,
      });
      return { summary, lookups: seen.filter((s) => s.sql.includes(`\`${matchField}\` = ?`)) };
    } finally {
      knex.removeListener('query', onQuery);
    }
  };
  const planOf = async (s: Statement): Promise<string[]> =>
    ((await knex.raw(`explain query plan ${s.sql}`, s.bindings)) as Array<{ detail: string }>).map((r) => r.detail);
  const titles = async (object: string) =>
    ((await knex(object).select('external_id', 'title').orderBy('external_id')) as Array<{ external_id: string; title: string }>);
  return { upsert, planOf, titles };
}

describe('the upsert match lookup is an index probe under the single posture', () => {
  it('the lookup carries the organization beside the key, and SQLite searches the unique index', async () => {
    const { upsert, planOf, titles } = await boot();
    const { summary, lookups } = await upsert(ITEM.name, 'external_id', [
      { external_id: 'E7', title: 'updated' },
      { external_id: 'E99', title: 'created' },
    ]);
    expect(summary).toMatchObject({ errors: 0, updated: 1, created: 1 });
    expect(lookups).toHaveLength(2);
    for (const [i, key] of (['E7', 'E99'] as const).entries()) {
      expect(lookups[i].sql).toMatch(/where `organization_id` = \? and `external_id` = \?/);
      expect(lookups[i].bindings.slice(0, 2)).toEqual([ORG, key]);
      expect((await planOf(lookups[i])).join(' | ')).toMatch(
        /^SEARCH mo_item_31812 USING INDEX uniq_mo_item_31812_organization_id_external_id \(organization_id=\? AND external_id=\?\)/,
      );
    }
    const stored = await titles(ITEM.name);
    expect(stored.find((r) => r.external_id === 'E7')?.title).toBe('updated');
    expect(stored.filter((r) => r.external_id === 'E99')).toEqual([{ external_id: 'E99', title: 'created' }]);
    expect(stored).toHaveLength(21);
  });

  it('CONTROL: a key with no index still matches the stored row and updates it', async () => {
    const { upsert, titles } = await boot();
    const { summary, lookups } = await upsert(ITEM.name, 'code', [{ code: 'C3', title: 'by code' }]);
    expect(summary).toMatchObject({ errors: 0, updated: 1, created: 0 });
    expect(lookups[0].sql).toMatch(/where `organization_id` = \? and `code` = \?/);
    expect((await titles(ITEM.name)).find((r) => r.external_id === 'E3')?.title).toBe('by code');
  });

  it('CONTROL: an object with no tenant column matches on the key alone, as before', async () => {
    const { upsert, titles } = await boot();
    const { summary, lookups } = await upsert(PLAIN.name, 'external_id', [
      { external_id: 'E5', title: 'updated' },
      { external_id: 'E77', title: 'created' },
    ]);
    expect(summary).toMatchObject({ errors: 0, updated: 1, created: 1 });
    expect(lookups[0].sql).toMatch(/where `external_id` = \?/);
    expect(lookups[0].sql).not.toContain('organization_id');
    const stored = await titles(PLAIN.name);
    expect(stored.find((r) => r.external_id === 'E5')?.title).toBe('updated');
    expect(stored).toHaveLength(21);
  });
});
