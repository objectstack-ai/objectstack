// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8608] The tenant-scope INDEX follows the WALL, not the injection plan.
 *
 * ## The disagreement this file closes
 *
 * Two places answered "is this object tenant-scoped?" and read different
 * declarations. `provisionTenantScopeIndex` (this package) asked the spec's
 * INJECTION plan — `resolveInjectedSystemColumns(...).tenant` — while
 * plugin-security's Layer 0 derives `tenancyDisabled` from exactly two clauses:
 *
 *     tenancy.enabled === false || systemFields.tenant === false
 *
 * Three of the plan's opt-out rows appear in both readings and agree.
 * `systemFields: false` — the hard object-level opt-out — appears only in the
 * plan. So an object using it while declaring its OWN `organization_id` had the
 * wall's predicate AND-composed onto essentially every read with no index
 * behind it: the "hottest predicate unindexed" shape #6810 and #8459 exist to
 * prevent, reached by a third route.
 *
 * Both halves were measured end to end before the fix, not inferred from the
 * source (the card asserted its security half from source and flagged that it
 * had not run it). For `systemFields: false` + an author-declared
 * `organization_id`, on merged `main`:
 *
 *     applySystemFields(obj, { multiTenant: true }).indexes  =>  null
 *     SecurityPlugin#getReadFilter('lead', <member of org-1>) =>  { organization_id: 'org-1' }
 *
 * ## The ruling
 *
 * Triage, 2026-08-14, option A, on the standing meta-rule that when one
 * question has two disagreeing implementations the GOVERNED side wins and the
 * ungoverned side rebinds to it: the wall's derivation is authoritative, the
 * index follows it. ⛔ Option B (teach plugin-security to treat
 * `systemFields: false` as tenancy-disabled) was REJECTED — it narrows a wall,
 * which only an explicit product ruling can do.
 *
 * ## Why all three of the card's rows are pinned here, not just the one moving
 *
 * "Grant more indexes" passes row 1 trivially. The card's table has two rows
 * that must NOT move — the object that opted out of the tenant column, and the
 * plain object #8459 already covered — and a change that indexes on the
 * deployment flag alone, or one that drops the wall's clauses instead of
 * adopting them, is green on row 1 and red on those. They are asserted side by
 * side, in one file, so the fix is visibly one row wide.
 *
 * ⛔ Never assert a LENGTH or a DELTA on `indexes` here, for the reason
 * `registry-tenant-index-author-declared-column.test.ts` records in full:
 * `indexes` concatenates under `mergeObjectDefinitions` and `declaresTenantIndex`
 * guards the append, so a count assertion is green with the change absent. Every
 * assertion below reads the entry itself.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SchemaRegistry, applySystemFields } from './registry.js';

/** The platform's own entry — the exact value the seam appends. */
const PLATFORM_TENANT_INDEX = { fields: ['organization_id'] };

/** The author's own tenant column: the card's repro shape. */
const DECLARED_ORG = { type: 'lookup', reference: 'sys_organization', label: 'Org' };

/**
 * A business object carrying the author's own `organization_id`, plus whatever
 * opt-out row the case is about.
 */
const leadWith = (extra: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) =>
  ({
    name: 'lead',
    label: 'Lead',
    fields: {
      first_name: { type: 'text', label: 'First name' },
      organization_id: { ...DECLARED_ORG },
      ...fields,
    },
    ...extra,
  }) as any;

/** Declared indexes whose column list is exactly `['organization_id']`. */
const tenantIndexes = (def: any) =>
  (def?.indexes ?? []).filter(
    (i: any) => Array.isArray(i?.fields) && i.fields.length === 1 && i.fields[0] === 'organization_id',
  );

/**
 * The registry-backed `/meta` surface with no DB behind it, so the served answer
 * comes through the read exit's materialization seam
 * ({@link SchemaRegistry.materializeServedObjectOnto}) — the SECOND caller of
 * `provisionTenantScopeIndex`. Same double as the #8459 file's, kept in step
 * with it deliberately: both write verbs are pinned to the producer's own
 * dispatch decisions.
 */
function metaSurface(multiTenant: boolean, object: any) {
  const registry = new SchemaRegistry({ multiTenant, searchCompanion: false } as never);
  registry.registerObject(object, 'crm', 'crm', 'own');
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

describe('[#8608] the tenant index follows the wall’s derivation', () => {
  // ── The card's measurement table, all three rows, side by side ─────────────

  describe('the card’s measurement table', () => {
    it('ROW 1 (the change): `systemFields: false` + an author-declared organization_id gets the index', () => {
      // The one row where the two derivations disagreed. The wall composes
      // `organization_id = <org>` here — measured, see the head of this file —
      // so the platform now indexes the column it filters on.
      const out: any = applySystemFields(leadWith({ systemFields: false }), { multiTenant: true });

      expect(out.indexes).toEqual([PLATFORM_TENANT_INDEX]);
      // No `name` (each driver derives its own, table-qualified on SQL) and no
      // `unique` — a plain lookup index, never a constraint: a UNIQUE index on
      // the tenant column would make every table single-row per organization.
      expect(out.indexes[0].name).toBeUndefined();
      expect(out.indexes[0].unique).toBeUndefined();
    });

    it('ROW 2 (control): `systemFields.tenant: false` still gets none', () => {
      // Security AGREES this object is not walled — `computeTenantLayer0Filter`
      // returns `null` when `tenancyDisabled`, and this is one of its two
      // clauses — so there is no predicate for an index to serve. A fix that
      // read the field map alone, or the deployment flag alone, grants here and
      // is wrong.
      const out: any = applySystemFields(leadWith({ systemFields: { tenant: false } }), {
        multiTenant: true,
      });

      expect(out.indexes).toBeUndefined();
      // Opting out of the INJECTION never deletes a declared field.
      expect(out.fields.organization_id).toEqual(DECLARED_ORG);
    });

    it('ROW 3 (control): a plain object keeps #8459’s answer', () => {
      const out: any = applySystemFields(leadWith(), { multiTenant: true });

      expect(out.indexes).toEqual([PLATFORM_TENANT_INDEX]);
    });
  });

  // ── The wall's clause set, adopted exactly — no more, no fewer ─────────────

  it('`tenancy.enabled: false` gets none either — the wall’s OTHER clause', () => {
    // The second of the two clauses plugin-security reads. Pinned beside row 2
    // so the pair cannot be half-adopted: dropping either one starts indexing
    // objects the wall never filters (`sys_package`, the Marketplace catalog,
    // and every other cross-org shared table).
    const out: any = applySystemFields(leadWith({ tenancy: { enabled: false } }), {
      multiTenant: true,
    });

    expect(out.indexes).toBeUndefined();
  });

  it('`managedBy: better-auth` + a declared organization_id GETS the index — the wall reads no managedBy clause', () => {
    // Not an accident of the rewrite; the ruling's predicate, applied. The wall
    // derives `tenancyDisabled` from two clauses and `managedBy` is in neither,
    // so a better-auth table that DECLARES `organization_id` is walled on that
    // column exactly like any other object — and adding an exclusion here that
    // the wall does not have would re-open the drift this card closes.
    //
    // Its real instance is `sys_member` (`managedBy: 'better-auth'`, declares
    // `organization_id`, and its only tenant-leading index is the COMPOSITE
    // `['organization_id', 'user_id']` — which `declaresTenantIndex`
    // deliberately does not accept as a substitute, a leading-column match
    // being dialect-dependent). It is the ONE shipped platform object whose
    // answer this card changes; every other table that would qualify already
    // declares its own single-column tenant index (`sys_invitation`,
    // `sys_team`, `sys_scim_provider`) or is tenancy-disabled
    // (`sys_sso_provider`).
    const out: any = applySystemFields(leadWith({ managedBy: 'better-auth' }), {
      multiTenant: true,
    });

    expect(out.indexes).toEqual([PLATFORM_TENANT_INDEX]);
  });

  it('the hard opt-out with NO organization_id gets none — nothing to filter on', () => {
    // Clause 2 of the predicate, alone. `systemFields: false` injects no tenant
    // column, so unless the AUTHOR declared one there is no column for the wall
    // to name and no index to declare. This is what stops the rebinding from
    // becoming "index every object on a walled deployment".
    const bare: any = {
      name: 'lead',
      label: 'Lead',
      systemFields: false,
      fields: { first_name: { type: 'text', label: 'First name' } },
    };
    const out: any = applySystemFields(bare, { multiTenant: true });

    expect(out.indexes).toBeUndefined();
    expect(Object.keys(out.fields)).not.toContain('organization_id');
  });

  // ── The injection half is untouched ───────────────────────────────────────

  it('the hard opt-out still injects NOTHING — the index does not drag the columns back', () => {
    // `systemFields: false` is the seed/migration-table opt-out: no audit
    // family, no ownership anchors, no injected tenant column. The fix routes
    // that exit through the index decision, and this is the pin that the exit
    // still decides only the INDEX. A regression here would put four platform
    // columns onto tables that exist precisely to have none.
    const out: any = applySystemFields(leadWith({ systemFields: false }), { multiTenant: true });

    expect(Object.keys(out.fields).sort()).toEqual(['first_name', 'organization_id']);
    // …and the author's column is still byte-identical to what they declared.
    expect(out.fields.organization_id).toEqual(DECLARED_ORG);
  });

  // ── The read exit — the second caller of the same predicate ────────────────

  it('the READ EXIT serves it, and the registry answers it', async () => {
    // `provisionTenantScopeIndex` has two callers: the producer above and
    // `materializeBaseLayer`, which every `/meta` read exit replays. A change
    // reaching only one of them fixes half the surface and the other half
    // disagrees silently — the exact defect #8375 closed.
    const { registry, protocol } = metaSurface(true, leadWith({ systemFields: false }));
    const item: any = (await protocol.getMetaItem({ type: 'object', name: 'lead' })).item;
    const listed: any = (await protocol.getMetaItems({ type: 'object' })).items.find(
      (i: any) => i.name === 'lead',
    );

    expect(tenantIndexes(registry.getObject('lead'))).toEqual([PLATFORM_TENANT_INDEX]);
    expect(tenantIndexes(item)).toEqual([PLATFORM_TENANT_INDEX]);
    expect(tenantIndexes(listed)).toEqual([PLATFORM_TENANT_INDEX]);
    // Written against the registry's own answer as well as the literal: the
    // claim is that the two are ONE answer, not two derivations that agree.
    expect(item.indexes).toEqual(registry.getObject('lead')!.indexes);
  });

  // ── The controls a "grant more indexes" change fails ──────────────────────

  it('a SINGLE-TENANT deployment declares none on the same object', () => {
    // Nothing filters by organization on an unwalled stack
    // (`computeTenantLayer0Filter` returns `null` for the `single` posture), so
    // the index is dead weight and its ABSENCE is the declaration (#6810).
    const opted = leadWith({ systemFields: false });
    const { registry } = metaSurface(false, opted);

    expect(applySystemFields(opted, { multiTenant: false }).indexes).toBeUndefined();
    expect(registry.getObject('lead')!.indexes).toBeUndefined();
  });

  it('an author who declares their OWN tenant index gets no platform entry beside it', () => {
    // The deliberate escape hatch for a different index shape, and now live on
    // this row too: `declaresTenantIndex` is the only thing standing between
    // the newly-enabled append and a duplicate entry.
    const authored = leadWith({
      systemFields: false,
      indexes: [{ fields: ['organization_id'] }, { fields: ['first_name'] }],
    });
    const out: any = applySystemFields(authored, { multiTenant: true });

    expect(out.indexes).toEqual([{ fields: ['organization_id'] }, { fields: ['first_name'] }]);
  });

  it('stamping twice appends once — the seam runs at registration AND at every read', () => {
    // An array push is the one part of this injection that is not naturally
    // idempotent, and the hard-opt-out row now has a live append to make.
    const once: any = applySystemFields(leadWith({ systemFields: false }), { multiTenant: true });
    const twice: any = applySystemFields(once, { multiTenant: true });

    expect(twice.indexes).toEqual([PLATFORM_TENANT_INDEX]);
    expect(twice.indexes).toEqual(once.indexes);
  });
});
