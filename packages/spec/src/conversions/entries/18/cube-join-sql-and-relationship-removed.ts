// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `cube-join-sql-and-relationship-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `cubeJoinSqlAndRelationshipRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `joins.<alias>.sql` and `joins.<alias>.relationship` — the authored ON clause
 * and the declared cardinality on a cube join (#18612, ADR-0049
 * enforce-or-remove; maintainer ruling 2026-09-18, director batch #154 item 4
 * letter 2, plus the same day's addendum that ordered this entry).
 *
 * Neither key was ever read. Both analytics strategies SYNTHESISE the join:
 * `NativeSQLStrategy#qualifyAndRegisterJoin` emits
 * `LEFT JOIN <name> <alias> ON "<parent>"."<alias>" = "<alias>"."id"` from the
 * dotted member path alone, and `ObjectQLStrategy#isCrossObjectField` resolves
 * the join through `cube.joins?.[alias]?.name` and lowers it to a relationship
 * traversal with no ON clause at all. An authored condition was therefore not
 * ignored but REPLACED, under a 200 (the #10298 shape), and `one_to_many`
 * parsed, changed no SQL and kept the many-to-one arithmetic.
 *
 * ## Why a D2 strip, when the same card also ships a D3 semantic entry
 *
 * The first cut of #18612 shipped the semantic entry alone, on the ruling's
 * clause 「zero producers, so no conversion is owed」. That clause counted
 * SOURCE authors; the refusal is on PERSISTED artifacts. `sql` was REQUIRED and
 * `relationship` carried `.default('many_to_one')`, so every cube artifact ever
 * written from the old schema's own parse output carries BOTH keys — and after
 * this retirement the boot door refuses it: `ObjectStackDefinitionSchema`
 * spreads `analyticsCubes: z.array(CubeSchema)` and `_parseAndRegisterArtifact`
 * re-parses stored metadata through it. A D3 entry is never replayed, so the
 * artifact at rest would have had no remedy short of hand-editing JSON (the
 * #12772 shape); only the D2 table is replayed at the rehydration seams
 * (`applyArtifactForwardConversions`, `applyConversionsToStoredItem`). The
 * strip is behaviour-lossless in the only sense that matters here: a key that
 * never had an effect has no effect to lose.
 *
 * The semantic entry `cube-join-sql-and-relationship-retired` stays beside this
 * one and is not redundant — the conversion removes the key, the entry tells a
 * HUMAN why: an author who wrote a non-FK `sql` wanted a join this runtime does
 * not perform, and that want is a decision, not a rewrite.
 *
 * Joins live in the cube's `joins` RECORD (keyed by alias), one level below the
 * collection item, so the top-level-only `stripKeys` runs per join, not per
 * cube — the `metric-filters-removed` shape one surface over. The emitted path
 * NAMES the cube rather than only indexing it: "which cube lost it" is the
 * record the semantic entry worried a mechanical strip would not keep, and an
 * index into the author's own `analyticsCubes[]` is a position, not a name.
 */
const cubeJoinSqlAndRelationshipRemoved: MetadataConversion = {
  id: 'cube-join-sql-and-relationship-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'analyticsCubes[].joins.<alias>.sql / analyticsCubes[].joins.<alias>.relationship',
  summary:
    "cube join keys 'sql' and 'relationship' removed (ADR-0049 — neither was ever read: "
    + 'both strategies synthesise the ON clause as a foreign-key equality, so an authored join '
    + 'condition was REPLACED under a 200 and a declared cardinality changed no SQL. Keep '
    + '`joins.<alias>.name` alone; the record KEY is the foreign-key field on the base object)',
  apply(stack, emit) {
    return mapCollection(stack, 'analyticsCubes', (cube, path) => {
      const joins = cube.joins;
      if (!isDict(joins)) return cube;
      // Name the cube, not just its index: the notice is the only record an
      // upgrading author gets of WHICH cube lost the key.
      const where = typeof cube.name === 'string' ? `${path}(${cube.name})` : path;
      let touched = false;
      const nextJoins: Record<string, unknown> = { ...joins };
      for (const [alias, join] of Object.entries(joins)) {
        if (!isDict(join)) continue;
        const stripped = stripKeys(join, ['sql', 'relationship'], emit, `${where}.joins.${alias}`);
        if (stripped === join) continue;
        nextJoins[alias] = stripped;
        touched = true;
      }
      if (!touched) return cube;
      return { ...cube, joins: nextJoins };
    });
  },
  fixture: {
    before: {
      analyticsCubes: [
        {
          name: 'delivery',
          sql: 'task',
          measures: { count: { label: 'Tasks', type: 'count', sql: 'id' } },
          dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } },
          joins: {
            // The persisted shape: `sql` was REQUIRED and `relationship` was
            // MATERIALIZED by the schema's own default, so this is what a cube
            // artifact written by 17.4-or-earlier tooling actually carries.
            project: {
              name: 'showcase_project',
              relationship: 'many_to_one',
              sql: '${task}.project = ${showcase_project}.id',
            },
            // Already canonical — rides through untouched. The fixture's own
            // control: the strip dispatches on key presence, and copy-on-write
            // keeps this reference.
            owner: { name: 'sys_user' },
          },
        },
        {
          // A SECOND cube, so the notices have to distinguish two of them.
          name: 'billing',
          sql: 'invoice',
          measures: { amount: { label: 'Amount', type: 'sum', sql: 'amount' } },
          dimensions: {
            issued_on: { label: 'Issued', type: 'time', sql: 'issued_on' },
          },
          joins: {
            // Only the cardinality — a join whose `sql` an author already
            // deleted by hand still carries the materialized default.
            customer: { name: 'crm_account', relationship: 'many_to_one' },
          },
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
          joins: {
            project: { name: 'showcase_project' },
            owner: { name: 'sys_user' },
          },
        },
        {
          name: 'billing',
          sql: 'invoice',
          measures: { amount: { label: 'Amount', type: 'sum', sql: 'amount' } },
          dimensions: {
            issued_on: { label: 'Issued', type: 'time', sql: 'issued_on' },
          },
          joins: {
            customer: { name: 'crm_account' },
          },
        },
      ],
    },
    // Three notices, one per STRIPPED SITE: `delivery.project` loses both keys,
    // `billing.customer` loses the materialized default, and `delivery.owner`
    // produces none.
    expectedNotices: 3,
  },
};

export { cubeJoinSqlAndRelationshipRemoved };
