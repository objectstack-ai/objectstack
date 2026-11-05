// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `cube-member-inner-name-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `cubeMemberInnerNameRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { type Dict, isDict } from '../shared.js';

/**
 * `measures.<metric>.name` and `dimensions.<dimension>.name` — the inner name a
 * cube member used to REQUIRE (#20300, ADR-0049 enforce-or-remove; triage
 * verdict RETIRE by the maintainer's criterion: Cube.dev and LookML key a
 * member by its declared name, with no second inner name that can disagree).
 *
 * `measures` and `dimensions` are RECORDS, and every consumer resolves a member
 * by its KEY — `AnalyticsService#getMeta` and the in-memory driver publish
 * `<cube>.<key>`, `NativeSQLStrategy#lookupMember` and the in-memory driver's
 * `resolveMeasure` / `resolveDimension` index the bag by key. The inner `name`
 * was a second copy of the identity that nothing read.
 *
 * ## Why a D2 strip, and why it strips a DISAGREEING value too
 *
 * The key was REQUIRED, so every cube artifact written from the old schema's
 * parse output, and every stored `analytics_cube` row, carries it on every
 * member — and after the tombstone the boot door refuses it
 * (`ObjectStackDefinitionSchema` spreads `analyticsCubes: z.array(CubeSchema)`).
 * Only the D2 table is replayed at the rehydration seams
 * (`applyArtifactForwardConversions`, `applyConversionsToStoredItem`), so this
 * entry is what keeps a deployed cube booting.
 *
 * A value EQUAL to its key is the lossless case the triage named. A value that
 * DISAGREES is stripped as well, and that is not a guess about intent: the key
 * already won everywhere, so the running system never saw the inner spelling,
 * and deleting it changes no query and no discovery answer. Leaving it in place
 * would change one — the cube would stop loading. What the strip cannot decide
 * is which spelling the author MEANT, so the notice prints both (`from` carries
 * the inner value, `to` names the key that stays) and the paired D3 entry
 * `cube-member-inner-name-retired` addresses that judgement to the author.
 *
 * Members live one level below the collection item, in two records, so the
 * walk runs per member — the `metric-filters-removed` shape, over both bags.
 * The emitted path NAMES the cube, as `cube-join-sql-and-relationship-removed`
 * does: an index into the author's `analyticsCubes[]` is a position, not a name.
 */
const cubeMemberInnerNameRemoved: MetadataConversion = {
  id: 'cube-member-inner-name-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'analyticsCubes[].measures.<metric>.name / analyticsCubes[].dimensions.<dimension>.name',
  summary:
    "cube member key 'name' removed from measures and dimensions (ADR-0049 enforce-or-remove — nothing read it: "
    + 'every consumer resolves a member by its record KEY, published and queried as `<cube>.<key>`. The '
    + 'record key is the member\'s name; to rename a member, rename its key)',
  apply(stack, emit) {
    return mapCollection(stack, 'analyticsCubes', (cube, path) => {
      const where = typeof cube.name === 'string' ? `${path}(${cube.name})` : path;
      let next: Dict = cube;
      for (const bag of ['measures', 'dimensions'] as const) {
        const members = cube[bag];
        if (!isDict(members)) continue;
        let touched = false;
        const nextMembers: Dict = { ...members };
        for (const [key, member] of Object.entries(members)) {
          if (!isDict(member) || !('name' in member)) continue;
          const { name, ...rest } = member;
          const at = `${where}.${bag}.${key}.name`;
          emit(name === key
            ? { from: 'name', to: '(removed)', path: at }
            : { from: `name ${JSON.stringify(name)}`, to: `(removed; the record key "${key}" is the name)`, path: at });
          nextMembers[key] = rest;
          touched = true;
        }
        if (touched) next = { ...next, [bag]: nextMembers };
      }
      return next;
    });
  },
  fixture: {
    before: {
      analyticsCubes: [
        {
          name: 'orders',
          sql: 'orders',
          measures: {
            // The persisted shape: `name` was REQUIRED, and every producer in
            // the repo wrote it equal to the key it filed the member under.
            count: { name: 'count', label: 'Orders', type: 'count', sql: '*' },
            total_amount: { name: 'total_amount', label: 'Total', type: 'sum', sql: 'amount' },
          },
          dimensions: {
            status: { name: 'status', label: 'Status', type: 'string', sql: 'status' },
          },
        },
        {
          // A SECOND cube, so the notices have to distinguish two of them.
          name: 'events',
          sql: 'event',
          measures: {
            // DISAGREEING — the in-memory driver's own fixtures authored this
            // shape and queried `events.eventCount`: the key won, the inner
            // spelling was inert. Stripped, and the notice prints both.
            eventCount: { name: 'event_count', label: 'Events', type: 'count', sql: '*' },
          },
          dimensions: {
            // Already canonical — rides through untouched. The fixture's own
            // control: the strip dispatches on key presence.
            kind: { label: 'Kind', type: 'string', sql: 'kind' },
          },
        },
      ],
    },
    after: {
      analyticsCubes: [
        {
          name: 'orders',
          sql: 'orders',
          measures: {
            count: { label: 'Orders', type: 'count', sql: '*' },
            total_amount: { label: 'Total', type: 'sum', sql: 'amount' },
          },
          dimensions: {
            status: { label: 'Status', type: 'string', sql: 'status' },
          },
        },
        {
          name: 'events',
          sql: 'event',
          measures: {
            eventCount: { label: 'Events', type: 'count', sql: '*' },
          },
          dimensions: {
            kind: { label: 'Kind', type: 'string', sql: 'kind' },
          },
        },
      ],
    },
    // Four notices, one per STRIPPED KEY: three equal names on `orders`, one
    // disagreeing name on `events`, and none for the canonical `events.kind`.
    expectedNotices: 4,
  },
};

export { cubeMemberInnerNameRemoved };
