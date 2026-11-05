// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `cube-refresh-key-removed` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `cubeRefreshKeyRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `refreshKey` — a cube's refresh cadence (`every`) and data-change probe
 * (`sql`), retired whole (#20637, ADR-0049 enforce-or-remove; maintainer ruling
 * letter C).
 *
 * Nothing read either key, and there was nothing for them to key on: no
 * analytics result is cached, so a declared cadence refreshed nothing. The
 * tombstone on `CubeSchema` refuses the key at parse (see
 * `CUBE_REFRESH_KEY_REMOVED` in `analytics.zod.ts`).
 *
 * ## Why a D2 strip
 *
 * The key was optional with no default, so a persisted cube carries it only
 * where an author wrote it — as the showcase did. After the tombstone the boot
 * door refuses such a cube (`ObjectStackDefinitionSchema` spreads
 * `analyticsCubes: z.array(CubeSchema)`), and only the D2 table is replayed at
 * the rehydration seams (`applyArtifactForwardConversions`,
 * `applyConversionsToStoredItem`), so a built artifact or a stored
 * `analytics_cube` row that carries the key loads only through this entry. The
 * strip is lossless: a key that never had an effect has none to lose.
 *
 * The WHOLE block leaves, whatever it holds — `every`, `sql`, both, neither, or
 * a value no longer an object: the tombstone refuses every value, so a partial
 * strip would leave a cube that still cannot load. The emitted path NAMES the
 * cube, as `cube-join-sql-and-relationship-removed` does: an index into the
 * author's `analyticsCubes[]` is a position, not a name. The D3 record is the
 * semantic entry `cube-refresh-key-retired`.
 */
const cubeRefreshKeyRemoved: MetadataConversion = {
  id: 'cube-refresh-key-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.5.0',
  surface: 'analyticsCubes[].refreshKey',
  summary:
    "cube key 'refreshKey' removed, with its 'every' and 'sql' (ADR-0049 enforce-or-remove — nothing read "
    + 'it: no analytics result is cached, so a declared refresh cadence refreshed nothing. Delete the key; '
    + 'a refresh cadence is declared again when a result cache exists)',
  apply(stack, emit) {
    return mapCollection(stack, 'analyticsCubes', (cube, path) => {
      // Name the cube, not just its index: the notice is the only record an
      // upgrading author gets of WHICH cube lost the key.
      const where = typeof cube.name === 'string' ? `${path}(${cube.name})` : path;
      return stripKeys(cube, ['refreshKey'], emit, where);
    });
  },
  fixture: {
    before: {
      analyticsCubes: [
        {
          // The showcase's shape: a cadence alone.
          name: 'delivery',
          sql: 'task',
          measures: { count: { label: 'Tasks', type: 'count', sql: 'id' } },
          dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } },
          refreshKey: { every: '1 hour' },
        },
        {
          // A SECOND cube, so the notices have to distinguish two of them: both
          // keys, the probe included.
          name: 'billing',
          sql: 'invoice',
          measures: { amount: { label: 'Amount', type: 'sum', sql: 'amount' } },
          dimensions: { issued_on: { label: 'Issued', type: 'time', sql: 'issued_on' } },
          refreshKey: { every: '1 day', sql: 'SELECT MAX(updated_at) FROM invoice' },
        },
        {
          // Already canonical — rides through untouched. The fixture's own
          // control: the strip dispatches on key presence, and copy-on-write
          // keeps this reference.
          name: 'accounts',
          sql: 'account',
          measures: { count: { label: 'Accounts', type: 'count', sql: 'id' } },
          dimensions: { tier: { label: 'Tier', type: 'string', sql: 'tier' } },
        },
      ],
    },
    after: {
      analyticsCubes: [
        {
          name: 'delivery',
          sql: 'task',
          measures: { count: { label: 'Tasks', type: 'count', sql: 'id' } },
          dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } },
        },
        {
          name: 'billing',
          sql: 'invoice',
          measures: { amount: { label: 'Amount', type: 'sum', sql: 'amount' } },
          dimensions: { issued_on: { label: 'Issued', type: 'time', sql: 'issued_on' } },
        },
        {
          name: 'accounts',
          sql: 'account',
          measures: { count: { label: 'Accounts', type: 'count', sql: 'id' } },
          dimensions: { tier: { label: 'Tier', type: 'string', sql: 'tier' } },
        },
      ],
    },
    // Two notices, one per STRIPPED KEY (the whole block is one key): `delivery`
    // and `billing`, none for the canonical `accounts`.
    expectedNotices: 2,
  },
};

export { cubeRefreshKeyRemoved };
