// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3 / D9] Every seed row is stamped with its organization, or the
 * load refuses it.
 *
 * Two changes, pinned with their discriminating controls:
 *
 *  1. The `sys_` / `cloud_` / `ai_` exemption is WITHDRAWN. Platform seeds used
 *     to skip the sole-organization fallback as "intentionally global"; there
 *     are no platform-global seeds left, and a seeded `sys_business_unit` is
 *     the organization's own business unit. It now carries the organization.
 *  2. Zero or several organizations no longer mean "keep the historical NULL".
 *     In a composition that REGISTERS the organization object, a row of an
 *     organization-owned object with no owner to stamp is refused — counted,
 *     named, nothing written. The composition with NO organization object
 *     keeps today's branch (ADR-0131 C8 decides whether D9 reaches it); that
 *     case is pinned as-is.
 */

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

type Row = Record<string, unknown> & { id?: string };

const BUSINESS_UNIT = {
  name: 'sys_business_unit',
  fields: { name: { type: 'text' }, code: { type: 'text' } },
};
const WIDGET = {
  name: 'my_app_widget',
  fields: { name: { type: 'text' }, sku: { type: 'text' } },
};
/** ADR-0066: the declared way to hold rows that belong to no organization. */
const LICENSE = {
  name: 'billing_license',
  tenancy: { enabled: false },
  fields: { name: { type: 'text' }, sku: { type: 'text' } },
};
const ORGANIZATION = { name: 'sys_organization', fields: { name: { type: 'text' }, slug: { type: 'text' } } };

/**
 * Equality only: a combinator this double does not implement is refused, never
 * read as a field name (`check:where-matcher`).
 */
function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
    return row[k] === v;
  });
}

function createEngine(store: Record<string, Row[]>) {
  let idCounter = 0;
  const inserted: Array<{ object: string; row: Row }> = [];
  const engine = {
    find: vi.fn(async (object: string, query?: { where?: Record<string, unknown>; limit?: number }) => {
      let rows = store[object] ?? [];
      if (query?.where) {
        const where = query.where;
        rows = rows.filter((r) => matchesWhere(r, where));
      }
      return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
    }),
    insert: vi.fn(async (object: string, data: Row | Row[]) => {
      const write = (d: Row) => {
        const row = { ...d, id: d.id ?? `gen-${++idCounter}` };
        (store[object] ??= []).push(row);
        inserted.push({ object, row });
        return row;
      };
      return Array.isArray(data) ? data.map(write) : write(data);
    }),
    count: vi.fn(async (object: string) => (store[object] ?? []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;
  return { engine, inserted };
}

/** Object definitions by name; `sys_organization` is present only when `registered`. */
function createMetadata(registered: boolean): IMetadataService {
  const defs: Record<string, unknown> = {
    sys_business_unit: BUSINESS_UNIT,
    my_app_widget: WIDGET,
    billing_license: LICENSE,
    ...(registered ? { sys_organization: ORGANIZATION } : {}),
  };
  return {
    getObject: vi.fn(async (name: string) => defs[name]),
    listObjects: vi.fn(async () => Object.values(defs)),
    register: vi.fn(async () => {}),
    get: vi.fn(async (_type: string, name: string) => defs[name]),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

function seeds(organizationId?: string) {
  return {
    seeds: [
      { object: 'sys_business_unit', externalId: 'code', mode: 'insert', env: ['prod', 'dev', 'test'],
        records: [{ name: 'Head Office', code: 'HQ' }] },
      { object: 'my_app_widget', externalId: 'sku', mode: 'insert', env: ['prod', 'dev', 'test'],
        records: [
          { name: 'Gizmo', sku: 'G-1' },
          // Carries its own organization: that IS an explicit owner.
          { name: 'Pinned', sku: 'P-1', organization_id: 'org_named_by_author' },
        ] },
      { object: 'billing_license', externalId: 'sku', mode: 'insert', env: ['prod', 'dev', 'test'],
        records: [{ name: 'Site licence', sku: 'L-1' }] },
    ],
    config: {
      dryRun: false, haltOnError: false, multiPass: true, defaultMode: 'insert', batchSize: 1000,
      transaction: false, ...(organizationId ? { organizationId } : {}),
    },
  } as never;
}

const orgOf = (inserted: Array<{ object: string; row: Row }>, object: string) =>
  inserted.filter((i) => i.object === object).map((i) => i.row.organization_id ?? null);

describe('[ADR-0131 D3] the platform-namespace seed exemption is withdrawn', () => {
  it('a `sys_business_unit` seed carries the install\'s sole organization, like a business seed', async () => {
    const { engine, inserted } = createEngine({ sys_organization: [{ id: 'org_default' }] });
    const result = await new SeedLoaderService(engine, createMetadata(true), silentLogger()).load(seeds());
    expect(result.errors).toEqual([]);
    expect(orgOf(inserted, 'sys_business_unit')).toEqual(['org_default']);
    // The business object takes it too; the author's explicit organization wins.
    expect(orgOf(inserted, 'my_app_widget')).toEqual(['org_default', 'org_named_by_author']);
    // CONTROL — an object with no organization column gets no stamp: the real
    // engine refuses an undeclared `organization_id` and the row would be lost.
    expect(orgOf(inserted, 'billing_license')).toEqual([null]);
  });

  it('a pinned `config.organizationId` stamps the platform seed as well', async () => {
    const { engine, inserted } = createEngine({ sys_organization: [{ id: 'org_a' }, { id: 'org_b' }] });
    const result = await new SeedLoaderService(engine, createMetadata(true), silentLogger()).load(seeds('org_b'));
    expect(result.errors).toEqual([]);
    expect(orgOf(inserted, 'sys_business_unit')).toEqual(['org_b']);
    // The pinned organization is no stamp on an object with no organization column either.
    expect(orgOf(inserted, 'billing_license')).toEqual([null]);
  });
});

describe('[ADR-0131 D9] no derivable owner — the rows of an organization-owned object are REFUSED', () => {
  it.each([
    ['NO organization', [] as Row[], 'no organization at all'],
    ['several organizations', [{ id: 'org_a' }, { id: 'org_b' }], 'several organizations'],
  ])('%s: refused by name, nothing written, and the controls still land', async (_label, organizations, phrase) => {
    const { engine, inserted } = createEngine({ sys_organization: organizations });
    const result = await new SeedLoaderService(engine, createMetadata(true), silentLogger()).load(seeds());

    // The two unowned rows (the platform seed and the unpinned business row)
    // are refused, counted, and named — never written NULL.
    type RefusalRow = { field: string; sourceObject: string; message: string };
    const refused = (result.errors as RefusalRow[]).filter((e) => e.field === 'organization_id');
    expect(refused.map((e) => e.sourceObject).sort()).toEqual(['my_app_widget', 'sys_business_unit']);
    for (const e of refused) {
      expect(e.message).toContain('was REFUSED');
      expect(e.message).toContain(phrase);
      expect(e.message).toContain('config.organizationId');
    }
    expect(result.success).toBe(false);
    expect(orgOf(inserted, 'sys_business_unit')).toEqual([]);

    // CONTROL 1 — a row that names its own organization is not refused.
    expect(orgOf(inserted, 'my_app_widget')).toEqual(['org_named_by_author']);
    // CONTROL 2 — an object that declares no tenancy has no owner to need.
    expect(orgOf(inserted, 'billing_license')).toEqual([null]);
  });
});

describe('[ADR-0131 Q2, held as-is] a composition with NO organization object keeps today\'s branch', () => {
  it('nothing is stamped and nothing is refused', async () => {
    // The engine answers an empty organization read, but the composition
    // registers no organization object: no organization can exist here.
    const { engine, inserted } = createEngine({});
    const result = await new SeedLoaderService(engine, createMetadata(false), silentLogger()).load(seeds());
    expect(result.errors).toEqual([]);
    expect(orgOf(inserted, 'sys_business_unit')).toEqual([null]);
    expect(orgOf(inserted, 'my_app_widget')).toEqual([null, 'org_named_by_author']);
  });

  it('the engine refusing the unregistered organization name reads the same way', async () => {
    const { engine, inserted } = createEngine({});
    type Find = (object: string, q?: unknown) => Promise<Row[]>;
    const find = engine.find as unknown as { getMockImplementation(): Find | undefined; mockImplementation(f: Find): void };
    const base = find.getMockImplementation()!;
    find.mockImplementation(async (object: string, q?: unknown) => {
      if (object === 'sys_organization') {
        throw Object.assign(new Error("object 'sys_organization' not found"), {
          code: 'OBJECT_NOT_FOUND', object: 'sys_organization',
        });
      }
      return base(object, q);
    });
    const result = await new SeedLoaderService(engine, createMetadata(false), silentLogger()).load(seeds());
    expect(result.errors).toEqual([]);
    expect(orgOf(inserted, 'sys_business_unit')).toEqual([null]);
  });
});
