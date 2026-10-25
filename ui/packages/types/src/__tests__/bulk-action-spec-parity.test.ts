/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * BulkAction* ↔ `@objectstack/spec` drift guard (objectui#3334).
 *
 * Spec 17.0.0-rc.2 absorbed the bulk-action vocabulary (`BulkActionDefSchema`
 * et al. on `@objectstack/spec/ui`). `BulkActionOperation` is identical and is
 * imported from the spec at its declaration in `objectql.ts`; the interfaces
 * `BulkActionParam` / `BulkActionDef` stay objectui-side dialects (ALLOW
 * entries in scripts/check-spec-symbol-derivation.mjs) because they type what
 * the renderer EXECUTES, not what an author may write:
 *
 *  - a def promoted at runtime from `bulkActions: ['<name>']` carries the
 *    source object action as `actionDef` (objectui#3002/#3139) — a resolution
 *    artifact the spec's strict schema rejects by design;
 *  - a promoted def's params come from the object action, so the renderer's
 *    param `type` is an open string with a widget-config catch-all, while the
 *    spec closes `type` over the authored FieldWidget enum.
 *
 * Each divergence is pinned here: if the spec starts ACCEPTING `actionDef`,
 * or the two shapes converge some other way, a pin fails and the dialect must
 * be reconciled (derive/re-export) instead of silently drifting.
 */

import { describe, it, expect } from 'vitest';
import {
  BulkActionDefSchema as SpecBulkActionDefSchema,
  BulkActionParamSchema as SpecBulkActionParamSchema,
  BulkActionOperationSchema as SpecBulkActionOperationSchema,
} from '@objectstack/spec/ui';
import type { BulkActionDef, BulkActionOperation } from '../objectql';

const minimalDef = { name: 'close_won', operation: 'update' as const };

describe('BulkAction* ↔ spec parity (objectui#3334)', () => {
  it('BulkActionOperation is the spec union, verbatim', () => {
    // Compile-time: the re-exported type accepts exactly the spec's members …
    const ops: BulkActionOperation[] = ['update', 'delete', 'custom'];
    // … and runtime: the spec enum still holds exactly those members.
    expect([...SpecBulkActionOperationSchema.options].sort()).toEqual(
      [...ops].sort(),
    );
  });

  it('spec def schema still REJECTS the runtime `actionDef` artifact', () => {
    // The reason the local dialect exists. If the spec starts accepting
    // `actionDef`, the shapes may have converged — reconcile, don't shadow.
    const res = SpecBulkActionDefSchema.safeParse({
      ...minimalDef,
      actionDef: { name: 'approve', type: 'script' },
    });
    expect(res.success).toBe(false);

    // Sanity: the strictness is specific to the unknown key, not the base def.
    expect(SpecBulkActionDefSchema.safeParse(minimalDef).success).toBe(true);

    // The local dialect carries it (compile-time pin).
    const local: BulkActionDef = {
      ...minimalDef,
      actionDef: { name: 'approve', type: 'script' },
    };
    expect(local.actionDef).toBeDefined();
  });

  it('spec param `type` stays a closed enum the renderer deliberately widens', () => {
    // A runtime-promoted param may carry an action-declared widget name the
    // authored enum does not model; the local open `type: string` accepts it.
    const res = SpecBulkActionParamSchema.safeParse({
      name: 'assignee',
      type: 'not_an_authored_widget',
    });
    expect(res.success).toBe(false);

    // Shared vocabulary sanity: an authored widget type parses on both sides.
    expect(
      SpecBulkActionParamSchema.safeParse({ name: 'assignee', type: 'lookup' })
        .success,
    ).toBe(true);
  });
});
