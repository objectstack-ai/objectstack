// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7] The #12699 deployment declaration made total, in the registry:
 * "an object a deployment declares platform-global gets no organization column
 * on that deployment (the injected-columns plan reads the declaration), so
 * Layer 0 and the driver agree by having nothing to scope".
 *
 * The registry is where the plan is applied, so these pins read its answers
 * directly — the registered object, the tenant index beside it, the `/meta`
 * read exit's convergence and the write-side strip — each with the control a
 * wrong fix fails:
 *
 *  - a declared object registered AFTER the declaration is installed, and one
 *    registered BEFORE it (re-planned at install — the engine plugin installs
 *    at `start()`, after objects registered in other plugins' `init()`);
 *  - a non-declared object on the same deployment keeps its column and index;
 *  - an absent / empty declaration leaves every answer byte-identical;
 *  - an object that DECLARES its own `organization_id` keeps it (the author's
 *    column, not the platform's), and the install reports it.
 *
 * The booted-kernel pins — the provider, the DDL, Layer 0 and the driver — are
 * in plugin-security's `platform-global-no-organization-column.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { applyInjectedSystemColumns, assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { TENANT_SCOPE_FIELD_DEF } from '@objectstack/spec/data';
import { SchemaRegistry } from './registry.js';
import { assertEngineFindOnePredicate } from './engine-findone-predicate.js';
import type { EngineFindOneQueryInput } from './engine-findone-predicate.js';

const DECLARED = 'sys_widget_registry';
const SIBLING = 'crm_task';
const PLATFORM_TENANT_INDEX = { fields: ['organization_id'] };

const objectNamed = (name: string, extra: Record<string, unknown> = {}) =>
  ({
    name,
    label: name,
    fields: { title: { type: 'text', label: 'Title' } },
    ...extra,
  }) as any;

const tenantIndexes = (def: any) =>
  (def?.indexes ?? []).filter(
    (i: any) => Array.isArray(i?.fields) && i.fields.length === 1 && i.fields[0] === 'organization_id',
  );

function registry(): SchemaRegistry {
  return new SchemaRegistry({ multiTenant: true, searchCompanion: false } as never);
}

/** The registry-backed `/meta` surface with no DB behind it (the #8608 double). */
function metaSurface(reg: SchemaRegistry) {
  const engine = {
    registry: reg,
    find: async () => [],
    findOne: async (table: string, query?: EngineFindOneQueryInput) => {
      assertEngineFindOnePredicate(table, query);
      return null;
    },
    insert: async () => ({ id: 'x' }),
    update: async (_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) => {
      assertEngineUpdateDispatch(data, opts);
      return { id: 'x' };
    },
    delete: async (_t: string, opts?: Record<string, unknown>) => {
      assertEngineDeleteDispatch(opts);
      return { deleted: 0 };
    },
    count: async () => 0,
    aggregate: async () => [],
  } as any;
  return new ObjectStackProtocolImplementation(engine);
}

describe('[ADR-0131 D7] a declared platform-global object gets no organization column — the registry', () => {
  it('registered AFTER the install: no organization_id, no tenant index, and systemFields.tenant false recorded', () => {
    const reg = registry();
    reg.setDeploymentPlatformGlobalObjects([DECLARED]);
    reg.registerObject(objectNamed(DECLARED), 'test', 'test', 'own');
    reg.registerObject(objectNamed(SIBLING), 'test', 'test', 'own');

    const declared: any = reg.getObject(DECLARED);
    expect(declared.fields.organization_id).toBeUndefined();
    expect(tenantIndexes(declared)).toEqual([]);
    expect(declared.systemFields).toEqual({ tenant: false });
    // The rest of the plan is the authored one: the audit family is still there.
    expect(declared.fields.created_at).toBeDefined();

    // CONTROL — a non-declared object on the same deployment keeps both.
    const sibling: any = reg.getObject(SIBLING);
    expect(sibling.fields.organization_id).toEqual(TENANT_SCOPE_FIELD_DEF);
    expect(tenantIndexes(sibling)).toEqual([PLATFORM_TENANT_INDEX]);
    expect(sibling.systemFields).toBeUndefined();
  });

  it('registered BEFORE the install: re-planned — the provider may register after the objects', () => {
    const reg = registry();
    reg.registerObject(objectNamed(DECLARED), 'test', 'test', 'own');
    reg.registerObject(objectNamed(SIBLING), 'test', 'test', 'own');
    reg.registerObject(
      { name: DECLARED, fields: { extra: { type: 'text', label: 'Extra' } } } as any,
      'ext',
      'ext',
      'extend',
    );
    // Premise: before the install the declared object carries the column.
    expect((reg.getObject(DECLARED) as any).fields.organization_id).toBeDefined();

    const result = reg.setDeploymentPlatformGlobalObjects(new Set([DECLARED]));

    expect(result).toEqual({ replanned: [DECLARED], keptAuthoredColumn: [] });
    const declared: any = reg.getObject(DECLARED);
    expect(declared.fields.organization_id).toBeUndefined();
    expect(declared.fields.extra).toBeDefined();
    expect(tenantIndexes(declared)).toEqual([]);
    expect(declared.systemFields).toEqual({ tenant: false });
    // Every contributor layer, not only the merged answer.
    for (const c of reg.getObjectContributors(DECLARED)) {
      expect((c.definition.fields as any).organization_id).toBeUndefined();
    }
    // CONTROL
    expect((reg.getObject(SIBLING) as any).fields.organization_id).toEqual(TENANT_SCOPE_FIELD_DEF);
    expect(tenantIndexes(reg.getObject(SIBLING))).toEqual([PLATFORM_TENANT_INDEX]);
  });

  it('an absent or empty declaration leaves every registered object byte-identical', () => {
    const plain = registry();
    const empty = registry();
    empty.setDeploymentPlatformGlobalObjects([]);
    for (const reg of [plain, empty]) {
      reg.registerObject(objectNamed(DECLARED), 'test', 'test', 'own');
      reg.registerObject(objectNamed(SIBLING, { ownership: 'org' }), 'test', 'test', 'own');
    }
    for (const name of [DECLARED, SIBLING]) {
      expect(JSON.stringify(empty.getObject(name))).toBe(JSON.stringify(plain.getObject(name)));
    }
    expect((plain.getObject(DECLARED) as any).fields.organization_id).toEqual(TENANT_SCOPE_FIELD_DEF);
  });

  it('an object that DECLARES its own organization_id keeps it — the author\'s column — and the install names it', () => {
    const authored = { type: 'lookup', reference: 'sys_organization', label: 'Org' };
    const reg = registry();
    reg.registerObject(
      objectNamed(DECLARED, { fields: { title: { type: 'text', label: 'Title' }, organization_id: authored } }),
      'test',
      'test',
      'own',
    );
    const result = reg.setDeploymentPlatformGlobalObjects([DECLARED]);

    expect(result).toEqual({ replanned: [], keptAuthoredColumn: [DECLARED] });
    const obj: any = reg.getObject(DECLARED);
    expect(obj.fields.organization_id).toEqual(authored);
    expect(obj.systemFields).toBeUndefined();
  });

  it('an object that opted out itself is left exactly as it was (nothing to record)', () => {
    const reg = registry();
    reg.setDeploymentPlatformGlobalObjects([DECLARED, SIBLING]);
    reg.registerObject(objectNamed(DECLARED, { tenancy: { enabled: false } }), 'test', 'test', 'own');
    reg.registerObject(objectNamed(SIBLING, { systemFields: false }), 'test', 'test', 'own');
    expect((reg.getObject(DECLARED) as any).systemFields).toBeUndefined();
    expect((reg.getObject(SIBLING) as any).systemFields).toBe(false);
  });

  it('the /meta read exit serves the registry\'s answer — it does not re-inject the column', async () => {
    const reg = registry();
    reg.setDeploymentPlatformGlobalObjects([DECLARED]);
    reg.registerObject(objectNamed(DECLARED), 'test', 'test', 'own');
    reg.registerObject(objectNamed(SIBLING), 'test', 'test', 'own');
    const protocol = metaSurface(reg);

    const item: any = (await protocol.getMetaItem({ type: 'object', name: DECLARED })).item;
    expect(item.fields.organization_id).toBeUndefined();
    expect(item.systemFields).toEqual({ tenant: false });
    expect(tenantIndexes(item)).toEqual([]);
    // CONTROL
    const sibling: any = (await protocol.getMetaItem({ type: 'object', name: SIBLING })).item;
    expect(sibling.fields.organization_id).toEqual(TENANT_SCOPE_FIELD_DEF);
  });

  it('a body the registry never materialized converges at the read seam, and the write seam takes the record back off', () => {
    const reg = registry();
    reg.setDeploymentPlatformGlobalObjects([DECLARED]);
    reg.registerObject(objectNamed(DECLARED), 'test', 'test', 'own');
    // A stored body (an overlay row / a metadata-service body), as the read
    // exit's own injection pass serves it: the authored plan adds the column.
    const stored = objectNamed(DECLARED);
    const injected: any = applyInjectedSystemColumns(stored);
    expect(injected.fields.organization_id).toBeDefined();

    const served: any = reg.materializeServedObjectOnto(injected);
    expect(served.fields.organization_id).toBeUndefined();
    expect(served.systemFields).toEqual({ tenant: false });

    // Write side: the recorded deployment fact comes back off, so a Studio
    // GET → PUT persists the body the author wrote (#4326).
    const back: any = reg.stripMaterializedStampsFrom(served);
    expect(back.systemFields).toBeUndefined();
    // CONTROL: an author's own other systemFields member survives the strip.
    const withAudit: any = reg.stripMaterializedStampsFrom({ ...served, systemFields: { tenant: false, audit: false } });
    expect(withAudit.systemFields).toEqual({ audit: false });
    // …and a non-declared object's systemFields are never touched.
    const sibling = { name: SIBLING, fields: {}, systemFields: { tenant: false } };
    expect(reg.stripMaterializedStampsFrom(sibling)).toBe(sibling);
  });
});
