/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DrillDownConfig` — declared = delivered (objectui#3354).
 *
 * Five widgets share this interface (ObjectChart / ObjectDataTable /
 * ObjectPivotTable / ObjectMetricWidget / PivotTable), and it is the shape the
 * protocol's own `drillDown` declaration is being derived from
 * (objectstack#5022). Two of its keys were read by nothing in the repo:
 *
 *  - `view?: string`, self-described as "reserved" — the drawer rendered its
 *    inline `object-data-table` no matter what an author put there;
 *  - `sort?: Array<{ field; dir? }>`, documented as the drill list's default
 *    sort — no widget ever put it into the drilled table schema.
 *
 * They were removed, not implemented: nothing asked for them, and a dead key on
 * this interface was about to be promoted into a dead key with protocol
 * authority. The pins below are what stops them drifting back in — a re-added
 * `view` / `sort` fails to compile here, so the next person to want one has to
 * land a reader and delete a pin in the same change.
 *
 * ## These assertions are compile-time only
 *
 * Same mechanism as `page-node-type-contract.test.ts`: they mean something
 * because this package type-checks its tests — `tsconfig.json` excludes test
 * files (they must not emit into `dist`) and `tsconfig.test.json` picks them
 * back up, chained off the package's `type-check` script. Vitest alone would
 * NOT catch a broken pin: it strips types without checking them. Verified by
 * re-adding `view?: string` to the interface, which turns
 * `pnpm --filter @object-ui/types type-check` red on the `_ViewIsGone` line.
 */

import { describe, it, expect } from 'vitest';
// Through the package entrypoint, not `../data-display`: the barrel is the
// surface every consumer (plugin-charts, plugin-dashboard, core) sees.
import type { DrillDownConfig } from '../index';

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off type-check. */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

describe('DrillDownConfig declares no key that no renderer reads', () => {
  it('is pinned at compile time', () => {
    // Keeps the pins below from passing vacuously: `keyof any` admits every
    // key, so an `any` `DrillDownConfig` would report `HasKey<…, 'view'>` as
    // `true` and the "gone" pins would look like the failure instead.
    type _ConfigIsReal = Assert<Equal<IsAny<DrillDownConfig>, false>>;

    // Removed in objectui#3354 — zero readers repo-wide. Do not re-add either
    // one without a renderer that reads it.
    type _ViewIsGone = Assert<Equal<HasKey<DrillDownConfig, 'view'>, false>>;
    type _SortIsGone = Assert<Equal<HasKey<DrillDownConfig, 'sort'>, false>>;

    // The control: keys that DID survive, because widgets read them. If the
    // interface were emptied or renamed wholesale, these fail and the two pins
    // above stop being evidence of anything.
    type _FilterSurvives = Assert<HasKey<DrillDownConfig, 'filter'>>;
    type _ColumnsSurvives = Assert<HasKey<DrillDownConfig, 'columns'>>;
    type _MaxRowsSurvives = Assert<HasKey<DrillDownConfig, 'maxRows'>>;
    type _TargetSurvives = Assert<HasKey<DrillDownConfig, 'target'>>;

    // `'navigate'` is delivered by every block whose drill shape admits it:
    // `DrillDownDrawer.navigateOnly` for pivot / metric, and ObjectChart's own
    // branch since objectui#3354. `object-data-table` drills to the one record
    // its row already is, so its own shape narrows the arm away instead
    // (`ObjectDataTableDrillDownConfig`, objectui#10685); the shared union stays
    // whole. Narrowing it here would be a spec change, not a cleanup.
    type _TargetUnion = Assert<
      Equal<NonNullable<DrillDownConfig['target']>, 'drawer' | 'dialog' | 'navigate'>
    >;

    expect(true).toBe(true);
  });
});
