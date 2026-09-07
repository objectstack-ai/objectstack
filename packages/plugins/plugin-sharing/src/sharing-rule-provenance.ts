// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#2909 T1] Provenance stamp for `sys_sharing_rule`.
 *
 * sys_sharing_rule is RECORD-AUTHORITATIVE (ADR-0094 addendum): declared
 * rules are a boot seed, and the row — including any admin tuning such as
 * deactivating an over-sharing rule — is the authority. The seeder
 * (defineRule in seed mode) skips rows marked `customized`, so this hook is
 * the half that DETECTS the admin edit: any non-system update touching a
 * package/platform-seeded row stamps `customized: true` onto the payload.
 *
 * Why a data hook (and not a write gate or the REST layer):
 *  - admins edit rules through several doors (Setup UI generic data door,
 *    scripts, console) — an engine hook covers them all;
 *  - unlike sys_position/sys_capability there is deliberately NO
 *    SYSTEM_ROW_PROVENANCE write gate here: sharing rules are a first-class
 *    admin authoring surface, so edits are allowed — they just have to be
 *    remembered;
 *  - both provenance columns are `readonly`, and the engine's readonly strip
 *    exempts isSystem callers while snapshotting supplied keys BEFORE hooks
 *    run — so a caller can never forge/clear `customized`, while this hook's
 *    stamp survives.
 *
 * Multi-row updates ARE stamped, once per matched row. [#15302] Since #5574
 * the engine dispatches `beforeUpdate` PER MATCHED ROW of a predicate
 * (`multi: true`) write, each context carrying that row's `id` and `previous`
 * (the `HookContext` contract; ADR-0058 Addendum II D1-D7). The inference this
 * hook used to draw - "no single `input.id` means a bulk write, decline" -
 * therefore answered "single write" on every row of a batch and guarded
 * nothing. It is deleted rather than re-expressed against the engine's
 * `dispatch` marker: taking part in EVERY write shape is the intent, so there
 * is no decision left for the marker to gate (#6966 asks it in
 * `file-reference-lifecycle.ts` because that guard REFUSES; this one stamps).
 *
 * What an operator's bulk edit does, measured on the real engine rather than
 * assumed: the payload is BATCH-scoped (D3 - `driver.updateMany` takes ONE
 * `SET` clause for N rows). Matched rows that AGREE are all stamped in that one
 * clause and the write lands. Matched rows that DISAGREE would stamp some and
 * not others, and the engine refuses the whole batch
 * (`MULTI_UPDATE_HOOK_KEY_DIVERGENCE`, 400) rather than widening one row's
 * stamp to the rest - which is what makes a row-conditioned rewrite safe to
 * leave here.
 *
 * Declining on a predicate write was weighed and REJECTED (#15302): the seeder
 * skips only rows marked `customized`, so the rows left unstamped would be
 * exactly the ones the next boot clobbers - discarding the operator edit this
 * stamp exists to remember.
 */

import type { OptionalSharingLogger } from './logger-shapes.js';

interface MinimalEngine {
  registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void;
  unregisterHooksByPackage(packageId: string): number;
}

export const SHARING_RULE_PROVENANCE_PACKAGE = 'plugin-sharing:rule-provenance';

export function bindRuleProvenanceStamp(engine: MinimalEngine, logger?: OptionalSharingLogger): void {
  engine.registerHook(
    'beforeUpdate',
    async (ctx: any) => {
      // Seeder / defineRule / boot reconcilers write with isSystem — those
      // are the package door, not an admin customization.
      if ((ctx?.session as any)?.isSystem) return;
      const data = ctx?.input?.data;
      if (!data || typeof data !== 'object') return;
      // [#15302] The engine has ALREADY read this row. `ctx.previous` is
      // its pre-image, bound before `beforeUpdate` runs on BOTH write shapes
      // (#5574 / #5846: the by-id path reads it ahead of the dispatch, and
      // every per-row context of a predicate write carries its own), and it
      // is the published `HookContext` contract rather than an engine
      // internal. This hook used to issue its own `engine.find` here - on a
      // predicate write, one extra read PER MATCHED ROW of a row the engine
      // had just read.
      const previous = ctx?.previous as Record<string, any> | undefined;
      if (!previous || typeof previous !== 'object') return;
      if ((previous.managed_by === 'package' || previous.managed_by === 'platform') && previous.customized !== true) {
        (data as any).customized = true;
      }
    },
    { object: 'sys_sharing_rule', packageId: SHARING_RULE_PROVENANCE_PACKAGE, priority: 150 },
  );
  logger?.info?.('[sharing-rule] provenance stamp hook bound');
}

export function unbindRuleProvenanceStamp(engine: MinimalEngine): number {
  return engine.unregisterHooksByPackage(SHARING_RULE_PROVENANCE_PACKAGE);
}
