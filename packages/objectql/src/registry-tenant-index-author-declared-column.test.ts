// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8459] On a multi-tenant deployment the platform declares the tenant-scope
 * index whenever the object carries `organization_id` — whether the PLATFORM
 * provisioned that column or the AUTHOR declared it.
 *
 * ## The behaviour this file replaces
 *
 * `provisionTenantScopeIndex` gated the index on the column being the
 * platform's own definition (`isInjectedColumnDefinition`, byte-for-byte). An
 * author who declared their own `organization_id` — a natural, additive-looking
 * move: adding a label, making it `required`, pointing it at their own org
 * table — kept their column and silently lost the index on it. The column is
 * still THE tenant isolation key: `computeTenantLayer0Filter`
 * (plugin-security) AND-composes `organization_id = <org>` onto essentially
 * every read of that object, so the deployment's hottest predicate ran
 * unindexed. Not a security hole — isolation still holds; it is slow, not
 * wrong, which is exactly why nobody files it.
 *
 * The condition was never argued for: before #8375 the index push sat
 * physically nested inside the field-injection branch, so "the author declared
 * the column" and "the platform declares no index" were the same condition by
 * NESTING. #8375 lifted the decision into one named predicate and preserved the
 * behaviour exactly rather than widening it inside a convergence fix, which is
 * what made it a decision that could be taken on purpose.
 *
 * Maintainer ruling, 2026-08-13 (option A): one rule, stated once — the wall's
 * predicate is indexed on a walled deployment. Type-inspecting variants were
 * rejected: a `text` org code must get the index too, so the `text` case below
 * is a pin against re-introducing that judgement, not an incidental variant.
 *
 * ## What each case here is FOR
 *
 * Three behaviours have to hold at once and a pin proving one is silent about
 * the others, so each is asserted on the stored/answered VALUE:
 *
 *  1. the author-declared column now carries the index (the change);
 *  2. an object that already declares its own tenant index still gets none from
 *     the platform (the deliberate opt-out for a different index shape);
 *  3. the author's column DEFINITION is still never overwritten.
 *
 * Plus the two controls that a change indexing unconditionally would fail: a
 * single-tenant deployment declares no tenant index at all, and an object that
 * opts out of the tenant column keeps withholding it.
 *
 * ⛔ Never assert a LENGTH or a DELTA on `indexes` here. `indexes` concatenates
 * under `mergeObjectDefinitions`, which makes "the list did not grow" look like
 * a strong claim; it is not. Measured with the write-side strip fully ablated,
 * the served list goes `undefined -> 1 -> 1 -> 1` across round trips — one
 * phantom entry, then it stabilizes, because `declaresTenantIndex` guards the
 * append. A count assertion is therefore green with the change absent. Every
 * assertion below reads the stored entry itself.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SchemaRegistry, applySystemFields } from './registry.js';

/** The platform's own entry — the exact value the seam appends. */
const PLATFORM_TENANT_INDEX = { fields: ['organization_id'] };

/**
 * An author-declared tenant column, in the two shapes the ruling names.
 *
 * `lookup` is the card's own repro: the same reference the platform uses, with
 * the author's label — the shape an author reaches for when all they wanted was
 * a nicer label on a column they already have. `text` is the shape option C
 * would have excluded ("a `text` org code loses the index and looks fine"), and
 * is pinned for exactly that reason.
 */
const DECLARED_LOOKUP = { type: 'lookup', reference: 'sys_organization', label: 'Org' };
const DECLARED_TEXT = { type: 'text', label: 'Org Code' };

const AUTHOR_COLUMNS: Array<[string, Record<string, unknown>]> = [
  ['lookup to sys_organization with the author’s own label', DECLARED_LOOKUP],
  ['a plain text org code', DECLARED_TEXT],
];

/** A business object carrying the author's own `organization_id`. */
const leadWith = (organization_id: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({
    name: 'lead',
    label: 'Lead',
    fields: {
      first_name: { type: 'text', label: 'First name' },
      organization_id: { ...organization_id },
    },
    ...extra,
  }) as any;

/** Declared indexes whose column list is exactly `['organization_id']`. */
const tenantIndexes = (def: any) =>
  (def?.indexes ?? []).filter(
    (i: any) => Array.isArray(i?.fields) && i.fields.length === 1 && i.fields[0] === 'organization_id',
  );

/** The stored (post-injection) definition, as `registerObject` left it. */
const storedDefinition = (registry: SchemaRegistry, name = 'lead') =>
  (registry as any).objectContributors.get(name)[0].definition as any;

/**
 * The registry-backed `/meta` surface, with no DB behind it: every overlay
 * lookup answers empty, so the served answer comes through the read exit's
 * materialization seam ({@link SchemaRegistry.materializeServedObjectOnto}) —
 * the SECOND caller of `provisionTenantScopeIndex`, and the half a
 * producer-only assertion cannot see.
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

describe('[#8459] an author-declared organization_id gets the platform tenant index', () => {
  // ── 1. The change ───────────────────────────────────────────────────────────

  describe.each(AUTHOR_COLUMNS)('multiTenant, author-declared column (%s)', (_label, column) => {
    it('the PRODUCER (applySystemFields) declares the tenant index', () => {
      const out: any = applySystemFields(leadWith(column), { multiTenant: true });

      // The whole list, by value — not `.length`, not "contains something
      // tenant-shaped". This is the entry a driver materializes from.
      expect(out.indexes).toEqual([PLATFORM_TENANT_INDEX]);
      // No `name` (each driver derives its own, table-qualified on SQL) and no
      // `unique` — a plain lookup index, never a constraint. Pinned because a
      // UNIQUE index on the tenant column would make every table single-row
      // per organization.
      expect(out.indexes[0].name).toBeUndefined();
      expect(out.indexes[0].unique).toBeUndefined();
    });

    it('the REGISTRY answers it — the card’s own repro, inverted', () => {
      // `registry.getObject(name).indexes ==> undefined` is what the card
      // reported. It is the resolved answer every consumer reads.
      const { registry } = metaSurface(true, leadWith(column));

      expect(tenantIndexes(registry.getObject('lead'))).toEqual([PLATFORM_TENANT_INDEX]);
      expect(tenantIndexes(storedDefinition(registry))).toEqual([PLATFORM_TENANT_INDEX]);
    });

    it('the READ EXIT serves it — the second caller of the same predicate', async () => {
      // [A1] `provisionTenantScopeIndex` has two callers: the producer above and
      // `materializeBaseLayer`, which every `/meta` read exit replays. A change
      // reaching only one of them fixes half the surface and the other half
      // disagrees silently — which is the exact defect #8375 closed.
      const { registry, protocol } = metaSurface(true, leadWith(column));
      const item: any = (await protocol.getMetaItem({ type: 'object', name: 'lead' })).item;
      const listed: any = (await protocol.getMetaItems({ type: 'object' })).items.find(
        (i: any) => i.name === 'lead',
      );

      expect(tenantIndexes(item)).toEqual([PLATFORM_TENANT_INDEX]);
      expect(tenantIndexes(listed)).toEqual([PLATFORM_TENANT_INDEX]);
      // Written against the registry's own answer as well as the literal: the
      // claim is that the two are ONE answer, not two derivations that agree.
      expect(item.indexes).toEqual(registry.getObject('lead')!.indexes);
      // The served document still reads back clean — the #6810 channel. An
      // index declaration that made `/meta` report the platform's own object
      // invalid would be the same defect one key over.
      expect(item._diagnostics).toEqual({ valid: true });
    });
  });

  // ── 3. The field half stays exactly as it was ───────────────────────────────

  describe.each(AUTHOR_COLUMNS)('the author’s column definition is untouched (%s)', (_label, column) => {
    it('is served byte-identical to what the author declared', async () => {
      // The ruling lifts the injected-column condition off the INDEX half ONLY.
      // The platform still must not overwrite an author-declared
      // `organization_id`; `registry.test.ts`'s "does NOT overwrite an
      // author-declared organization_id" pins the producer, and this is the
      // same claim on the SERVED document, beside the index that now travels
      // with it. Asserted as the whole definition: a merge that layered the
      // platform's `readonly`/`hidden`/`system` on top would satisfy any
      // single-key check while taking the author's column over.
      const { protocol } = metaSurface(true, leadWith(column));
      const item: any = (await protocol.getMetaItem({ type: 'object', name: 'lead' })).item;

      expect(item.fields.organization_id).toEqual(column);
    });
  });

  // ── 2. The opt-out is not bypassed ──────────────────────────────────────────

  describe.each(AUTHOR_COLUMNS)('an author who declares their OWN tenant index (%s)', (_label, column) => {
    it('gets no platform entry beside it — the list is byte-identical to theirs', () => {
      // The deliberate escape hatch for anyone who wants a different index
      // shape. It is load-bearing precisely BECAUSE of this card: before it,
      // the platform never stamped on an author-declared column, so nothing
      // could duplicate. Now the append is live on exactly these objects and
      // `declaresTenantIndex` is the only thing stopping it.
      const authored = leadWith(column, {
        indexes: [{ fields: ['organization_id'] }, { fields: ['first_name'] }],
      });
      const out: any = applySystemFields(authored, { multiTenant: true });

      expect(out.indexes).toEqual([
        { fields: ['organization_id'] },
        { fields: ['first_name'] },
      ]);
    });

    it('gets no platform entry beside a NAMED tenant index either', () => {
      // `declaresTenantIndex` matches the single-column shape, named or not —
      // an author who named their index has still declared one.
      const authored = leadWith(column, {
        indexes: [{ name: 'my_tenant_idx', fields: ['organization_id'] }],
      });
      const out: any = applySystemFields(authored, { multiTenant: true });

      expect(out.indexes).toEqual([{ name: 'my_tenant_idx', fields: ['organization_id'] }]);
    });

    it('DOES get one beside a composite index that merely LEADS with the column', () => {
      // The other side of that boundary, unchanged by this card and asserted so
      // the widening cannot quietly swallow it: a composite is a leading-column
      // match on some dialects and not on others, so it is not a substitute for
      // the single-column index.
      const authored = leadWith(column, {
        indexes: [{ fields: ['organization_id', 'first_name'] }],
      });
      const out: any = applySystemFields(authored, { multiTenant: true });

      expect(out.indexes).toEqual([
        { fields: ['organization_id', 'first_name'] },
        PLATFORM_TENANT_INDEX,
      ]);
    });
  });

  // ── The two controls ────────────────────────────────────────────────────────

  describe.each(AUTHOR_COLUMNS)('a SINGLE-TENANT deployment (%s)', (_label, column) => {
    it('declares no tenant index on an author-declared column either', async () => {
      // The control that fails for a change which indexes unconditionally.
      // Nothing filters by organization on an unwalled stack
      // (`computeTenantLayer0Filter` returns null for the `single` posture), so
      // the index is dead weight — the absence IS the declaration, per #6810.
      const { registry, protocol } = metaSurface(false, leadWith(column));
      const item: any = (await protocol.getMetaItem({ type: 'object', name: 'lead' })).item;

      expect(applySystemFields(leadWith(column), { multiTenant: false }).indexes).toBeUndefined();
      expect(registry.getObject('lead')!.indexes).toBeUndefined();
      expect(item.indexes).toBeUndefined();
      // …and the COLUMN is still the author's, on either deployment.
      expect(item.fields.organization_id).toEqual(column);
    });
  });

  describe.each(AUTHOR_COLUMNS)('an object that opts OUT of the tenant column (%s)', (_label, column) => {
    it('declares no tenant index even though it carries an organization_id', () => {
      // The boundary this card does NOT move, stated as a pin because the
      // ruling's sentence ("whenever the object carries organization_id") reads
      // wider than the eligibility gate that stays.
      //
      // `systemFields.tenant: false` is the object saying it is not
      // tenant-scoped, and plugin-security reads the same declaration:
      // `computeTenantLayer0Filter` returns null when `tenancyDisabled`, so the
      // wall composes NO predicate on this object and there is nothing for an
      // index to serve. Withholding it here is the same reasoning as
      // `multiTenant: false`, not a leftover of the condition that was lifted.
      const opted = leadWith(column, { systemFields: { tenant: false } });
      const out: any = applySystemFields(opted, { multiTenant: true });

      expect(out.indexes).toBeUndefined();
      // The author's column is still theirs — opting out of the INJECTION never
      // deletes a declared field.
      expect(out.fields.organization_id).toEqual(column);
    });
  });

  // ── Idempotence, which the widening puts back at risk ──────────────────────

  it('stamping twice appends once — the seam runs at registration AND at every read', () => {
    // `provisionTenantScopeIndex` runs at the tail of `applySystemFields` and
    // again at the materialization seam, so on an author-declared column the
    // second pass now has a live append to make. An array push is the one part
    // of this injection that is not naturally idempotent.
    const once: any = applySystemFields(leadWith(DECLARED_LOOKUP), { multiTenant: true });
    const twice: any = applySystemFields(once, { multiTenant: true });

    expect(twice.indexes).toEqual([PLATFORM_TENANT_INDEX]);
    expect(twice.indexes).toEqual(once.indexes);
  });
});
