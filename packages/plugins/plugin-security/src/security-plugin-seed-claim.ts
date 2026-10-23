// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 11] `SecurityPlugin#claimSeedOwnershipOnSettle`, moved out of
 * `security-plugin.ts`: the seed-ownership claim that `init()` subscribes to
 * `app:seeded`, run whenever a seed settles, on every boot. It runs together
 * with the two readers it asks the published `seed-settlement` contract
 * through: `readSeedSettlementSnapshot` (has this boot's seed settled?) and
 * `readSeededRecordIds` (which rows did it land on?).
 *
 * A MOVE, not a redesign. The function below is the body of the method of the
 * same name as it stood, re-indented one level and otherwise unedited: the
 * same engine lookup, the same target (the bootstrap's named admin, else the
 * bootstrap's own `findExistingPlatformAdmin` rule), the same claim with the
 * same settlement readings, and the same best-effort warning. The two readers
 * moved with their docblocks unedited and gained `export` and nothing else.
 * `security-plugin.ts` imports them back, because the promotion-time pass
 * `start()` runs on `kernel:ready` asks both too. Each one's signature names a
 * contract type, and an export from `security-plugin.ts` whose signature names
 * another module's type reorders the published `.d.ts` (cut 6). So they moved,
 * rather than gaining `export` where they stood.
 *
 * ## How the moved body reaches the class
 *
 * The shape cuts 1 to 10 used (`security-plugin-object-inputs.ts`, whose
 * header carries the reasoning). The class keeps the method, its docblock and
 * its position, and the `app:seeded` subscription in `init()` still calls it
 * on the plugin. Its body is one literal of exactly the {@link SeedClaimHost}
 * members it reads, plus a `.call`. The method was async and the function
 * still is; the method now returns its function's promise.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `bootstrapPermissionSets` is declared `readonly`, so it goes by value.
 * `claimTargetAdminUserId` is not, because the promotion-time pass assigns it
 * when it names the admin. So it goes as a GETTER, and the claim reads it when
 * it runs, exactly as before.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */
import type { PluginContext } from '@objectstack/core';
import {
  SEED_SETTLEMENT_SERVICE,
  type IObjectQLEngine,
  type ISeedSettlementService,
  type SeedSettlementSnapshot,
} from '@objectstack/spec/contracts';
import type { SecurityPlugin } from './security-plugin.js';
import { findExistingPlatformAdmin } from './bootstrap-platform-admin.js';
import { claimSeedOwnership } from './claim-seed-ownership.js';

/**
 * The `SecurityPlugin` members the function below reads — every one of them,
 * and no other; the function's `this` is the `Pick` of the members it reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface SeedClaimHost {
  readonly bootstrapPermissionSets: SecurityPlugin['bootstrapPermissionSets'];
  readonly claimTargetAdminUserId: SecurityPlugin['claimTargetAdminUserId'];
}

/**
 * "Has this boot's own seed data finished landing?", asked through the
 * published `seed-settlement` contract rather than by sniffing the runtime's
 * internal `seed-datasets` service — that array's presence says a seed source
 * EXISTS, never whether it has SETTLED, and the gap between those two facts is
 * the whole defect. `undefined` means no seed pipeline registered on this
 * kernel, which by `kernel:ready` is a fact and not a not-yet (every source is
 * declared in Phase 2 `start()`). Read per use, never cached.
 */
export function readSeedSettlementSnapshot(ctx: PluginContext): SeedSettlementSnapshot | undefined {
  try {
    const svc = (ctx as any).getService?.(SEED_SETTLEMENT_SERVICE) as
      | ISeedSettlementService
      | undefined;
    if (!svc || typeof svc.snapshot !== 'function') return undefined;
    return svc.snapshot();
  } catch {
    return undefined;
  }
}

/**
 * [#23354] "Which rows did this process's boot seed write?", through the same
 * published contract as {@link readSeedSettlementSnapshot} — the seed loader's
 * own report of the rows it landed on, so the seed-ownership claim hands over
 * the seed's rows and leaves every other unowned row unowned (ADR-0138 D1).
 * `undefined` when no host publishes it; the claim then re-owns no NULL-owner
 * row and its pass report says so. Bound per pass; the tally is read per call.
 */
export function readSeededRecordIds(ctx: PluginContext): ((objectName: string) => readonly string[]) | undefined {
  try {
    const svc = (ctx as any).getService?.(SEED_SETTLEMENT_SERVICE) as
      | ISeedSettlementService
      | undefined;
    if (!svc || typeof svc.seededRecordIds !== 'function') return undefined;
    return (objectName: string) => svc.seededRecordIds!(objectName);
  } catch {
    return undefined;
  }
}

/** The body of `SecurityPlugin#claimSeedOwnershipOnSettle`; the method's docblock there is its contract. */
export async function claimSeedOwnershipOnSettle(
  this: Pick<SeedClaimHost, 'bootstrapPermissionSets' | 'claimTargetAdminUserId'>,
  ctx: PluginContext,
  payload?: { appId?: string; overBudget?: boolean },
): Promise<void> {
  let ql: IObjectQLEngine | undefined;
  try {
    ql = ctx.getService<IObjectQLEngine>('objectql');
  } catch {
    return;
  }
  if (!ql) return;
  try {
    const adminUserId =
      this.claimTargetAdminUserId ??
      (await findExistingPlatformAdmin(ql, this.bootstrapPermissionSets));
    if (!adminUserId) return;
    await claimSeedOwnership(ql, adminUserId, {
      logger: ctx.logger,
      seedSettlement: readSeedSettlementSnapshot(ctx),
      seededRecordIds: readSeededRecordIds(ctx),
    });
  } catch (e) {
    // Best-effort, exactly like the promotion-time call: a failed claim
    // leaves the rows unowned and the next run claims them, because the
    // predicate is still true of them. It must not break the boot — `trigger`
    // dispatch PROPAGATES, and a seed that landed must not fail on this.
    ctx.logger.warn('[security] seed-settle ownership claim failed', {
      appId: payload?.appId,
      overBudget: payload?.overBudget,
      error: (e as Error).message,
    });
  }
}
