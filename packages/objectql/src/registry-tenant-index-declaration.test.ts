// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #6810 — the injected `organization_id` no longer carries a key `FieldSchema`
// rejects, so a registry-backed object reads back `_diagnostics: { valid: true }`.
//
// The defect: `applySystemFields` provisioned the tenant column with
// `indexed: opts.multiTenant`. `indexed` is not a `FieldSchema` key — #2377 /
// ADR-0049 removed it because a field-level index flag built no index — and
// `FieldSchema` is a `strictObject`, so it was rejected BY NAME with a
// purpose-written message. `registerObject` runs `applySystemFields` BEFORE
// storing and `getItem('object', …)` serves that post-injection document, so the
// key travelled out to `/meta`, where `decorateMetadataItem` re-parsed the served
// body and stamped `valid: false` on it. Measured on `origin/main` @ `4fedb11`:
// BOTH tenancy modes, BOTH read exits, on every registry-backed object — a
// defect report the platform wrote about its OWN column, on a document the
// author never wrote and could not fix, in the exact channel Studio renders
// invalid-metadata banners from and an AI author reads to judge its own work.
//
// The fix declares the tenant index in the object's `indexes[]` instead, which
// is where every other index in this system is declared. So these tests pin two
// halves that must travel together: the false verdict is gone, AND the index is
// still declared — a fix that merely deleted the key would pass the first half
// while silently dropping the intent.
//
// Driven through the REAL `SchemaRegistry` + the REAL
// `ObjectStackProtocolImplementation`, i.e. the same path a `/meta` request
// takes at runtime. Nothing about the parse or the decoration is stubbed.

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SchemaRegistry, applySystemFields } from './registry.js';

/** A plain business object — one authored field, nothing else. */
const LEAD = { name: 'lead', label: 'Lead', fields: { first_name: { type: 'text' } } } as any;

/**
 * The registry-backed `/meta` surface for a tenancy-enabled object, with no DB
 * behind it: every overlay lookup answers empty, so both exits are served from
 * the SchemaRegistry — the path the defect lived on.
 */
function metaSurface(multiTenant: boolean) {
  const registry = new SchemaRegistry({ multiTenant });
  registry.registerObject(LEAD, 'crm', 'crm', 'own');
  const engine = {
    registry,
    find: async () => [],
    findOne: async () => null,
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
  return { registry, protocol: new ObjectStackProtocolImplementation(engine) };
}

/** The stored (post-injection) definition, as `registerObject` left it. */
const storedDefinition = (registry: SchemaRegistry) =>
  (registry as any).objectContributors.get('lead')[0].definition;

/** Declared indexes whose column list is exactly `['organization_id']`. */
const tenantIndexes = (def: any) =>
  (def.indexes ?? []).filter(
    (i: any) => Array.isArray(i?.fields) && i.fields.length === 1 && i.fields[0] === 'organization_id',
  );

describe('#6810 — a registry-backed object reads back valid at both /meta exits', () => {
  for (const multiTenant of [true, false]) {
    describe(`multiTenant=${multiTenant}`, () => {
      it('getMetaItem answers _diagnostics: { valid: true }', async () => {
        const { protocol } = metaSurface(multiTenant);
        const res: any = await protocol.getMetaItem({ type: 'object', name: 'lead' });

        // Asserted as the whole object, not `.valid` alone: the pre-fix body
        // carried an `errors` array alongside the verdict, and a fix that left
        // errors behind a `true` verdict would be a different defect.
        expect(res.item._diagnostics).toEqual({ valid: true });
      });

      it('getMetaItems (the list exit) answers _diagnostics: { valid: true }', async () => {
        const { protocol } = metaSurface(multiTenant);
        const res: any = await protocol.getMetaItems({ type: 'object' });
        const lead = res.items.find((i: any) => i.name === 'lead');

        expect(lead).toBeDefined();
        expect(lead._diagnostics).toEqual({ valid: true });
      });

      it('no served field carries the retired `indexed` key', async () => {
        // The verdict is the symptom; this is the cause. Asserted across EVERY
        // injected column so a future injection cannot reintroduce the shape
        // one field over (`owner_id`, `owning_business_unit_id`, the audit
        // family) and be caught only by the aggregate verdict above.
        const { protocol } = metaSurface(multiTenant);
        const res: any = await protocol.getMetaItem({ type: 'object', name: 'lead' });

        const carrying = Object.entries(res.item.fields as Record<string, any>)
          .filter(([, f]) => f && Object.hasOwn(f, 'indexed'))
          .map(([name]) => name);
        expect(carrying).toEqual([]);
      });
    });
  }

  it('multiTenant=true DECLARES the tenant index in indexes[]', async () => {
    // The other half of the fix. Deleting the key would satisfy every
    // assertion above while silently dropping the index the flag was asking
    // for — so the declaration is pinned in its own right, at the surface the
    // drivers actually materialize from.
    const { registry } = metaSurface(true);
    const def = storedDefinition(registry);

    expect(tenantIndexes(def)).toEqual([{ fields: ['organization_id'] }]);
    // No `name`: each driver derives its own. SQL's is table-qualified
    // (`idx_lead_organization_id`) because index names are schema-global there;
    // Mongo's is not, because they are per-collection. A name pinned here could
    // not be right for both.
    expect(tenantIndexes(def)[0].name).toBeUndefined();
    // A lookup index, never a constraint.
    expect(tenantIndexes(def)[0].unique).toBeUndefined();
  });

  it('multiTenant=false declares NO tenant index — absence, not a false flag', async () => {
    // What `indexed: false` used to say, said the way `indexes[]` says it.
    // Nothing filters by organization on an unwalled stack, so the index is
    // dead weight.
    const { registry } = metaSurface(false);
    const def = storedDefinition(registry);

    expect(tenantIndexes(def)).toEqual([]);
    // And the COLUMN is still provisioned either way — that decoupling is
    // older than this fix and must survive it (sudo writers stamp the column
    // on single-tenant stacks; it just stays NULL).
    expect(def.fields.organization_id).toBeDefined();
  });

  it('the served document is otherwise byte-identical to the pre-fix one, minus the key', async () => {
    // Scopes the blast radius: this changed exactly two things about the served
    // field — nothing about type, reference, or the governance keys that decide
    // who may write it.
    const out: any = applySystemFields(LEAD, { multiTenant: true });
    expect(out.fields.organization_id).toEqual({
      type: 'lookup',
      reference: 'sys_organization',
      label: 'Organization',
      required: false,
      hidden: true,
      readonly: true,
      system: true,
      description:
        'Tenant scope (auto-populated by org-scoping on insert; NULL on single-tenant stacks).',
    });
  });

  it("appends to an author's indexes[] rather than replacing them", async () => {
    const authored: any = {
      name: 'lead',
      fields: { code: { type: 'text' } },
      indexes: [{ name: 'lead_code_idx', fields: ['code'], unique: true }],
    };
    const out: any = applySystemFields(authored, { multiTenant: true });

    expect(out.indexes).toEqual([
      { name: 'lead_code_idx', fields: ['code'], unique: true },
      { fields: ['organization_id'] },
    ]);
  });

  it("does not duplicate an author's own single-column organization_id index", async () => {
    // An array append is the one part of this injection that is not naturally
    // idempotent, unlike the field merge beside it.
    const authored: any = {
      name: 'lead',
      fields: { code: { type: 'text' } },
      indexes: [{ name: 'my_tenant_idx', fields: ['organization_id'] }],
    };
    const out: any = applySystemFields(authored, { multiTenant: true });

    expect(out.indexes).toEqual([{ name: 'my_tenant_idx', fields: ['organization_id'] }]);
  });

  it('leaves objects that opt out of the tenant column entirely alone', async () => {
    // `systemFields: false` is the hard opt-out — no column, and therefore no
    // index declaration either.
    const optedOut: any = { name: 'seed_table', fields: { code: { type: 'text' } }, systemFields: false };
    const out: any = applySystemFields(optedOut, { multiTenant: true });

    expect(out.fields.organization_id).toBeUndefined();
    expect(out.indexes).toBeUndefined();
  });
});
