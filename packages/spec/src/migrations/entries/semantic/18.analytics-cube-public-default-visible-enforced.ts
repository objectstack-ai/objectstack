// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A declared-default correction plus the enforcement that makes the key real —
// the shape of `17.approval-escalation-enabled-default-flip`. There is no D2
// conversion: no spelling moves, and a written `public: false` is a legitimate
// value that the chain cannot tell from a materialized old default, so the
// judgement is the author's. The `data/Cube:public` row of
// `DEFAULT_CHANGES_BY_MAJOR` records the default move itself. No backticks in
// `surface`: the upgrade guide renders it inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'analytics-cube-public-default-visible-enforced',
  surface:
    'data.Cube.public — an analytics cube that declares public: false, and every cube in an '
    + 'artifact built by os compile before this release (the compiler writes the parsed stack, so '
    + 'it carries a materialized public: false on each cube that omitted the key)',
  replacement:
    'nothing, to keep a cube queryable: cubes are visible by default. Delete an authored '
    + '`public: false` that only restated the old default, and write it only on a cube that must '
    + 'stay out of the analytics API. Recompile every `os compile` artifact built before this '
    + 'release',
  reason:
    'A DECLARED-DEFAULT CORRECTION plus the enforcement that makes the key real. The analytics '
    + 'cube schema declared `public` with a default of `false` under an access-control comment, '
    + 'and nothing read it: `/analytics/meta` listed every cube and every query door answered it. '
    + 'The analytics service now reads it. A cube declared `public: false` is left out of '
    + '`/analytics/meta`, and `/analytics/query` and `/analytics/sql` refuse it with 404 '
    + '`CUBE_NOT_FOUND` — the same refusal, byte for byte, that an unknown cube name gets, so the '
    + 'refusal does not confirm a hidden cube exists. Enforcing the old default as declared would '
    + 'have hidden every cube that omits the key, so the default moves to `true` in the same '
    + 'change, and a cube that omits the key stays visible exactly as it was. Two holdings change '
    + 'behaviour on upgrade. An authored `public: false` — including one copied from the example '
    + 'app, which carried it — now hides the cube and refuses its queries. And an artifact built '
    + 'by `os compile` before this release carries a materialized `public: false` on every cube '
    + 'that omitted the key, because the compiler writes the parsed stack with its defaults '
    + 'applied; a host that registers cubes from such an artifact hides all of them until the '
    + 'artifact is recompiled. The key is visibility, not row security: records stay governed by '
    + 'object permissions and row-level security on every door, and the metadata door keeps '
    + 'serving cube definitions.',
  acceptanceCriteria:
    '`GET /analytics/meta` lists every cube your dashboards and reports query, and a query naming '
    + 'each one answers 200. For each authored `public: false`, either delete it (the cube is meant '
    + 'to be queried) or keep it and confirm that `/analytics/meta` omits the cube and that a query '
    + 'naming it answers 404 `CUBE_NOT_FOUND`. Every compiled artifact in use was built by '
    + '`os compile` from this release or later.',
  relevantWhen: { kind: 'stack-declares', keys: ['analyticsCubes'] },
};
