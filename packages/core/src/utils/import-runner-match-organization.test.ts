// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An update or upsert import's match lookup reads the record by its key IN
 * THE CALLER'S ORGANIZATION: the `where` it sends carries the target's tenant
 * column set to the context's `tenantId` beside the key fields.
 *
 * Why it matters: under the `single` posture the engine adds no tenant scope
 * to a read (ADR-0131 D11), so a lookup on the key fields alone could not use
 * the `(organization_id, <key>)` unique index and scanned the table once per
 * row. The organization is the same one a created row is stamped with, so the
 * lookup finds exactly the record an insert of that key would collide with.
 *
 * The tenant column is read off the target's declaration (`getMetaItem`) by
 * the platform's one rule: `tenancy.enabled: false` and an `external` object
 * have none, a declared `tenancy.tenantField` the object has wins, else
 * `organization_id` when the object has it. A real `SqlDriver` reading of the
 * same seam, with its query plan, is in
 * `packages/rest/src/import-upsert-match-organization.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type FindArgs = Parameters<ImportProtocolLike['findData']>[0];

const OBJECT = 'mo_item';
const STORED = { id: 'r1', organization_id: 'org_a', company_id: 'org_a', external_id: 'E1', title: 'old' };

const metaMap = new Map<string, ExportFieldMeta>([
  ['external_id', { name: 'external_id', type: 'text' }],
  ['title', { name: 'title', type: 'text' }],
  ['organization_id', { name: 'organization_id', type: 'text' }],
]);

const TENANT_FIELDS = {
  organization_id: { type: 'lookup', reference: 'sys_organization' },
  external_id: { type: 'text', unique: true },
  title: { type: 'text' },
};

/** A protocol over one stored record whose declaration is `item` (or none, or a throw). */
function protocol(item: Record<string, unknown> | undefined, opts: { noMeta?: boolean; metaThrows?: boolean } = {}) {
  const findData = vi.fn(async (args: FindArgs) => {
    const where = (args.query?.where ?? {}) as Record<string, unknown>;
    return Object.entries(where).every(([k, v]) => (STORED as Record<string, unknown>)[k] === v) ? [STORED] : [];
  });
  const getMetaItem = vi.fn(async ({ name }: { type: string; name: string }) => {
    if (opts.metaThrows) throw new Error('metadata store unavailable');
    return { type: 'object', name, item: item && { name, ...item } };
  });
  const p: ImportProtocolLike = {
    findData,
    createData: vi.fn(async (a) => ({ id: 'new', ...a.data })),
    updateData: vi.fn(async (a) => ({ id: a.id, ...a.data })),
    ...(opts.noMeta ? {} : { getMetaItem }),
  };
  return { p, findData, getMetaItem };
}

const run = (
  p: ImportProtocolLike,
  context: Record<string, unknown> | undefined,
  extra: { writeMode?: 'update' | 'upsert'; matchFields?: string[] | string[][]; dryRun?: boolean; rows?: Array<Record<string, unknown>> } = {},
) =>
  runImport({
    p, context, objectName: OBJECT, metaMap,
    writeMode: extra.writeMode ?? 'upsert', matchFields: extra.matchFields ?? ['external_id'], dryRun: extra.dryRun ?? false,
    runAutomations: false, trimWhitespace: true, createMissingOptions: false, skipBlankMatchKey: false,
    rows: extra.rows ?? [{ external_id: 'E1', title: 'new' }, { external_id: 'E2', title: 'fresh' }],
  });

/** The `where` of every match lookup the import made on the target, in order. */
const lookups = (findData: ReturnType<typeof protocol>['findData']) =>
  findData.mock.calls.map(([a]) => a).filter((a) => a.object === OBJECT).map((a) => a.query?.where);

const JOB = { isSystem: true, tenantId: 'org_a' };
const SESSION = { userId: 'u1', tenantId: 'org_a' };

describe('the match lookup carries the caller\'s organization on a tenant-scoped target', () => {
  for (const [label, context] of [['a job context', JOB], ['a session context', SESSION]] as const) {
    for (const writeMode of ['upsert', 'update'] as const) {
      it(`${label}, ${writeMode}: the where is the tenant column plus the key, and the stored row is matched`, async () => {
        const { p, findData } = protocol({ fields: TENANT_FIELDS });
        const summary = await run(p, context, { writeMode });
        expect(lookups(findData)).toEqual([
          { organization_id: 'org_a', external_id: 'E1' },
          { organization_id: 'org_a', external_id: 'E2' },
        ]);
        expect(summary.results[0]).toMatchObject({ ok: true, action: 'updated', id: 'r1' });
      });
    }
  }

  it('the dry run matches the same way', async () => {
    const { p, findData } = protocol({ fields: TENANT_FIELDS });
    await run(p, JOB, { dryRun: true });
    expect(lookups(findData)).toEqual([
      { organization_id: 'org_a', external_id: 'E1' },
      { organization_id: 'org_a', external_id: 'E2' },
    ]);
  });

  it('ordered key sets: the set a row is matched by carries the organization too', async () => {
    const { p, findData } = protocol({ fields: TENANT_FIELDS });
    await run(p, JOB, { matchFields: [['external_id'], ['title']], rows: [{ title: 'old' }] });
    expect(lookups(findData)).toEqual([{ organization_id: 'org_a', title: 'old' }]);
  });

  it('a declared `tenancy.tenantField` is the column the lookup scopes by', async () => {
    const { p, findData } = protocol({
      tenancy: { tenantField: 'company_id' },
      fields: { ...TENANT_FIELDS, company_id: { type: 'text' } },
    });
    await run(p, JOB);
    expect(lookups(findData)[0]).toEqual({ company_id: 'org_a', external_id: 'E1' });
  });

  it('the target declaration is read once per import, not per row', async () => {
    const { p, getMetaItem } = protocol({ fields: TENANT_FIELDS });
    await run(p, JOB, { rows: [{ external_id: 'E1' }, { external_id: 'E2' }, { external_id: 'E3' }] });
    expect(getMetaItem.mock.calls.filter(([r]) => r.name === OBJECT)).toHaveLength(1);
  });
});

describe('CONTROL: the lookup is the key alone where there is no organization to scope by', () => {
  const KEY_ONLY = [{ external_id: 'E1' }, { external_id: 'E2' }];

  for (const [label, item, context, opts] of [
    ['a target with no tenant column', { fields: { external_id: TENANT_FIELDS.external_id, title: TENANT_FIELDS.title } }, JOB, {}],
    ['a target with `tenancy.enabled: false`', { tenancy: { enabled: false }, fields: TENANT_FIELDS }, JOB, {}],
    ['an external (federated) target', { external: { remoteName: 'items' }, fields: TENANT_FIELDS }, JOB, {}],
    ['a declared tenantField the object lacks, and no organization_id', { tenancy: { tenantField: 'company_id' }, fields: { external_id: TENANT_FIELDS.external_id } }, JOB, {}],
    ['a context with no organization', { fields: TENANT_FIELDS }, { isSystem: true }, {}],
    ['a context with a blank organization', { fields: TENANT_FIELDS }, { isSystem: true, tenantId: '' }, {}],
    ['no context at all', { fields: TENANT_FIELDS }, undefined, {}],
    ['a protocol with no declaration read', { fields: TENANT_FIELDS }, JOB, { noMeta: true }],
    ['a declaration read that fails', { fields: TENANT_FIELDS }, JOB, { metaThrows: true }],
  ] as const) {
    it(`${label}: the where is the key fields, and the stored row still matches`, async () => {
      const { p, findData } = protocol(item as Record<string, unknown>, opts);
      const summary = await run(p, context as Record<string, unknown> | undefined);
      expect(lookups(findData)).toEqual(KEY_ONLY);
      expect(summary.results[0]).toMatchObject({ ok: true, action: 'updated', id: 'r1' });
    });
  }

  it('a key set that names the tenant column keeps the row\'s own value: the caller\'s is not written over it', async () => {
    const { p, findData } = protocol({ fields: TENANT_FIELDS });
    await run(p, { isSystem: true, tenantId: 'org_b' }, {
      matchFields: ['organization_id', 'external_id'],
      rows: [{ organization_id: 'org_a', external_id: 'E1', title: 'new' }],
    });
    expect(lookups(findData)).toEqual([{ organization_id: 'org_a', external_id: 'E1' }]);
  });
});
