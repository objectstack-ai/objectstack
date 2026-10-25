/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8365 — `kanban.groupBy` is a DECLARED REFUSAL on this mirror, on both
 * faces.
 *
 * The runtime half and the whole reading live in `plugin-list`'s
 * `ListView.strayGroupByRefused-8365.test.tsx`, beside the render branch the
 * refusal protects. THIS file exists for the half that file cannot carry: the
 * TYPE face.
 *
 * ⭐ WHY IT IS A SEPARATE FILE, and why that is not duplication. `z.never()` at a
 * member position makes `z.input` of that member `undefined`, so the inferred
 * authoring face carries `groupBy?: never` and `tsc` refuses the key at the
 * AUTHORING SITE — before anything runs. A pin on that face is a compile-time
 * assertion: vitest erases it, and a green vitest run says nothing whatsoever
 * about it. The gate that enforces it is `tsc`, and in this package that is
 * `pnpm --filter @object-ui/types type-check`, whose `tsconfig.test.json`
 * compiles exactly this directory. ⛔ Do not "verify" the arms below by running
 * vitest over them.
 *
 * ⚠️ `@ts-expect-error` is the assertion, not a suppression: if a later edit
 * makes `kanban: { groupBy }` compile again, tsc reports the directive itself as
 * unused and this file goes RED. That is the failure mode the pin is for.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * remove the `groupBy` arm from `KanbanConfig` and `tsc -p tsconfig.test.json`
 * goes RED here with TS2578 ("Unused '@ts-expect-error' directive"), while the
 * two positive controls below stay silent in both worlds.
 */

import { describe, it, expect } from 'vitest';
import { ListViewSchema } from '../zod/objectql.zod';
import type { ListViewInferred } from '../zod/objectql.zod';

/** COMPILE-TIME PIN. Erased before vitest runs — `tsc` is the only gate here. */
const strayGroupByIsRefusedByTsc: ListViewInferred = {
  type: 'list-view',
  objectName: 'deal',
  kanban: {
    groupByField: 'stage',
    // @ts-expect-error objectui#8365 — `groupBy` is a declared refusal on
    // `KanbanConfig`; write `groupByField` (above). Removing the arm makes this
    // directive unused → TS2578.
    groupBy: 'stage',
  },
};

/** POSITIVE CONTROL: the canonical key compiles, so the pin is not "kanban is unwritable". */
const canonicalCompiles: ListViewInferred = {
  type: 'list-view',
  objectName: 'deal',
  kanban: { groupByField: 'stage' },
};

/**
 * The legacy alias, which this card left compiling (it narrowed ONE key). objectui#6152
 * round 11 refused it too, by name, naming `groupByField`: this row was the control that
 * said "only `groupBy`", and it is re-spelled by the round that moved it.
 */
const legacyAliasRefusedByTsc: ListViewInferred = {
  type: 'list-view',
  objectName: 'deal',
  kanban: {
    // @ts-expect-error objectui#6152 round 11 — `groupField` is a declared refusal now.
    groupField: 'stage',
  },
};

describe('objectui#8365 · the type face refuses `kanban.groupBy`', () => {
  it('the compile-time fixtures above are real program inputs', () => {
    // The arms that matter are the `@ts-expect-error` and the two controls, and
    // they are checked by `tsc`, not here. This runtime arm exists so the file
    // is not an empty suite and so the fixtures cannot be dropped as unused.
    expect(canonicalCompiles.kanban).toEqual({ groupByField: 'stage' });
    expect((legacyAliasRefusedByTsc.kanban as Record<string, unknown>).groupField).toBe('stage');
    expect((strayGroupByIsRefusedByTsc.kanban as Record<string, unknown>).groupBy).toBe('stage');
  });

  it('and the runtime door refuses the same key, so the two faces agree', () => {
    const result = ListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'deal',
      kanban: { groupByField: 'stage', groupBy: 'stage' },
    });
    expect(result.success).toBe(false);
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.path.join('.') === 'kanban.groupBy');
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.message).toContain('Did you mean `groupBy` → `groupByField`?');
  });
});
