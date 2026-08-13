// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7729] Recompute sharing-rule grants when the BUSINESS-UNIT GRAPH moves.
 *
 * ## The defect
 *
 * `bindRuleHooks` registers its recompute hooks scoped to each rule's own
 * `object_name`, and nothing anywhere registered one on `sys_business_unit` or
 * `sys_business_unit_member`. So the materialised `sys_record_share` grants of
 * a rule whose recipient resolves through the BU tree only moved when the
 * SHARED RECORD was next written — a re-parent or a membership edit moved
 * nothing at all.
 *
 * The measured matrix on the QA run this was extracted from:
 * `inSubtree=1`, `reparentedOut(no touch)=1`, `reparentedOut(touched)=0`,
 * `restored(no touch)=0`, `restored(touched)=1`. Read the second column: after
 * a business unit is moved OUT of a shared subtree its members KEEP read
 * access, and keep it until someone happens to write the shared record. That
 * is a revocation with no bound in time, which is the security half of this
 * issue; the grant direction (`restored(no touch)=0`) is the availability half
 * and moves the same way here.
 *
 * ## Which recipient kinds this covers, measured rather than assumed
 *
 * `SharingRuleService.expandRecipient` is the one switch that decides, and it
 * reads the BU tree for TWO of the six kinds:
 *
 * | recipient_type          | resolver                                    | reads the BU tree |
 * |-------------------------|---------------------------------------------|---|
 * | `user`                  | the literal id                              | no |
 * | `team`                  | `TeamGraphService` (`sys_team_member`, `sys_member`, `sys_user`) | no |
 * | `business_unit`         | `BusinessUnitGraphService.expandUnitMembers` | YES |
 * | `position`              | `PositionGraphService` (`sys_user_position`, `sys_member`) | no |
 * | `unit_and_subordinates` | `BusinessUnitGraphService.expandUsers`      | YES |
 * | `queue`                 | returns `[]` (no `sys_queue` yet)           | no |
 *
 * `business_unit` stays in that set after #7807 narrowed it to exactly one
 * unit's members. The divergence this file originally noted — `expandRecipient`
 * routing it through the SAME subtree `expandUsers` call as
 * `unit_and_subordinates`, against a spec declaring it as "exactly one business
 * unit's members (no subtree)" — was resolved in favour of the declaration, and
 * membership here was correct under either reading for the reason that fix
 * confirmed: a unit-only expansion still reads `sys_business_unit` for its own
 * `active` flag and tenant scope, and `sys_business_unit_member` for its
 * members. What changed is the blast radius, not the coverage — a re-parent no
 * longer moves a `business_unit` rule's recipients (its anchor's own membership
 * is what moves them), while a deactivation or a membership edit still does.
 *
 * Everything else is deliberately NOT recomputed. That exclusion is a
 * requirement, not an optimisation: a fix that recomputed every rule on every
 * BU write would close the security hole and replace it with a load problem —
 * see {@link BU_TREE_RECIPIENT_TYPES}.
 *
 * ## The design: synchronous revoke, asynchronous re-grant
 *
 * This is the #4779 ruling applied on a different axis, deliberately reusing
 * its seam rather than inventing a second one — the safety half runs to
 * completion before the write returns, the expensive restoration half is
 * queued on the shared {@link ruleRegrantQueue}:
 *
 *  - **Revoke (synchronous, complete).**
 *    `revokeRuleGrantsForRetiredRecipients` re-expands the rule's recipients
 *    and deletes the grants of everyone who dropped out, set-based. Cost is
 *    one grant query + one subtree walk + one member query + a chunked delete
 *    PER AFFECTED RULE — no record scan, so it does not grow with how many
 *    records the rule matches. A BU moved out of a shared subtree has lost its
 *    access by the time the re-parent returns: no window.
 *  - **Re-grant (asynchronous, coalesced).** A BU moved INTO a shared subtree
 *    needs new grants for up to (matched records × new members) pairs, which
 *    is exactly the fan-out that must not sit on a write path. It is queued as
 *    a full `evaluateRule` pass, serialized behind every other queued
 *    re-grant. Under-granting for the length of that queue is the wobble the
 *    ruling already accepts, and `kernel:bootstrapped`'s backfill repairs a
 *    re-grant lost to a crash.
 *
 * ## What this costs on a bulk BU write, stated rather than hidden
 *
 * A predicate write over the BU tree dispatches these hooks once per matched
 * row, and the synchronous half runs on EVERY dispatch — it is not memoised
 * per write, and must not be. Memoising it would mean judging the whole batch
 * from the tree as it looked at the first row, which re-opens the hole for
 * rows 2..N (their units would still read as in-subtree). The revoke is
 * idempotent and converges, so the repeats are wasted work rather than wrong
 * work, and each repeat is bounded by the per-rule cost above with no record
 * scan in it. The `granted.size === 0` short-circuit inside the service
 * absorbs the common case (nothing granted yet → nothing to walk). The
 * asynchronous half IS coalesced per rule, so a thousand-row import collapses
 * into one re-grant pass per rule instead of a thousand.
 */

import type { SharingRuleRow, SharingRuleRecipientType } from '@objectstack/spec/contracts';
import { ruleRegrantQueue } from './rule-hooks.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * Package id for the BU-graph recompute hooks.
 *
 * Distinct from `SHARING_RULE_HOOK_PACKAGE` for the same reason
 * `RULE_REBIND_TRIGGER_PACKAGE` is: `unbindAllRuleHooks` runs on every rule
 * rebind, and these hooks must survive it. They carry no rule snapshot to go
 * stale — the handler reads `listRules()` live — so there is nothing for a
 * rebind to refresh here.
 */
export const BU_TREE_RECOMPUTE_PACKAGE = 'plugin-sharing:bu-tree-recompute';

/**
 * The recipient kinds whose expansion reads the business-unit graph.
 *
 * This set is the non-regression guarantee. A rule recipient that never reads
 * the BU tree (`user` / `team` / `position` / `queue`) is not recomputed by a
 * BU write at all — not more cheaply, not at all — so a deployment whose rules
 * are all `user`-recipient pays one `sys_sharing_rule` read per BU write and
 * nothing else.
 */
export const BU_TREE_RECIPIENT_TYPES: ReadonlySet<SharingRuleRecipientType> = new Set<SharingRuleRecipientType>([
  'business_unit',
  'unit_and_subordinates',
]);

/** The two tables whose writes can move a BU-tree recipient expansion. */
export const BU_GRAPH_OBJECTS = ['sys_business_unit', 'sys_business_unit_member'] as const;

/**
 * Columns of `sys_business_unit` that `BusinessUnitGraphService.expandUsers`
 * actually reads: `parent_business_unit_id` (the descent), `active` (a hard
 * filter that stops descent and blanks an inactive seed) and
 * `organization_id` (the tenant scope every BU query is predicated on).
 *
 * A patch touching none of them — a rename, a new `manager_user_id`, an icon —
 * cannot change who the rule expands to, so it is skipped. Anything this
 * cannot read confidently is treated as "might have" and recomputed.
 */
const BU_EXPANSION_FIELDS = ['parent_business_unit_id', 'active', 'organization_id'] as const;

/**
 * Columns of `sys_business_unit_member` the same expansion reads. `is_primary`
 * is deliberately absent: it drives the `sys_user.primary_business_unit_id`
 * projection (`primary-bu-projection.ts`, ADR-0057 D12), which no sharing-rule
 * recipient expansion consults.
 */
const MEMBER_EXPANSION_FIELDS = ['business_unit_id', 'user_id'] as const;

interface MinimalEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => any | Promise<any>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ): void;
  unregisterHooksByPackage(packageId: string): number;
}

interface MinimalLogger {
  info?: (msg: any, ...rest: any[]) => void;
  warn?: (msg: any, ...rest: any[]) => void;
}

/** The slice of {@link SharingRuleService} this module drives. */
export interface BuTreeRecomputeRuleService {
  listRules(
    filter: { object?: string; activeOnly?: boolean },
    context: any,
  ): Promise<SharingRuleRow[]>;
  revokeRuleGrantsForRetiredRecipients(rule: SharingRuleRow): Promise<number>;
  evaluateRule(idOrName: string, context: any): Promise<unknown>;
}

/**
 * Rules with a re-grant queued and not yet started.
 *
 * Module-scoped for the reason {@link ruleRegrantQueue} is: the binding can be
 * torn down and re-established, and a per-binding set would let that orphan
 * the coalescing of re-grants still in flight. The entry is released BEFORE
 * the pass runs, so a BU write that lands while a re-grant is executing queues
 * a fresh pass rather than being swallowed by the one that is already past
 * reading the tree.
 */
const pendingRegrants = new Set<string>();

/** Test seam: are any coalesced re-grants outstanding? */
export function pendingBuTreeRegrants(): number {
  return pendingRegrants.size;
}

/**
 * Could this write have changed a BU-tree recipient expansion?
 *
 * Inserts and deletes always could. An update is judged on the columns its
 * patch carries, and anything unreadable (a non-object payload, an absent one)
 * answers `true` — "we cannot tell" must never collapse into "nothing
 * changed", which is the direction that silently skips the revocation.
 */
export function writeCanChangeExpansion(objectName: string, event: string, hookCtx: any): boolean {
  if (event !== 'afterUpdate') return true;
  const data = hookCtx?.input?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return true;
  const fields = objectName === 'sys_business_unit' ? BU_EXPANSION_FIELDS : MEMBER_EXPANSION_FIELDS;
  return fields.some((f) => Object.prototype.hasOwnProperty.call(data, f));
}

/**
 * Bind the BU-graph recompute hooks.
 *
 * Six hooks: `afterInsert` / `afterUpdate` / `afterDelete` on each of
 * {@link BU_GRAPH_OBJECTS}.
 *
 * **`after`, not `before`** — unlike the row-set stash in `bulk-recompute.ts`,
 * nothing here needs the pre-write state. What the revoke needs is the tree as
 * it is NOW, and the write is what makes that true.
 *
 * **System writes are NOT skipped**, which is the opposite of what
 * `bindRuleHooks` does and is deliberate. Its skip is about grant
 * MATERIALISATION, which the boot backfill re-does anyway. Here the payload is
 * REVOCATION, and the realistic production trigger for a re-parent is an HRIS
 * or directory sync — a system write. Skipping those would leave the hole open
 * on the very path most likely to open it. `primary-bu-projection.ts` reached
 * the same conclusion for the same table.
 */
export function bindBusinessUnitTreeRecompute(
  engine: MinimalEngine,
  service: BuTreeRecomputeRuleService,
  logger?: MinimalLogger,
): void {
  if (typeof engine.registerHook !== 'function') return;
  if (typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(BU_TREE_RECOMPUTE_PACKAGE);
  }

  /**
   * Queue the re-grant half for one rule, at most one pass outstanding.
   *
   * Never awaited by the caller: this is the half whose cost scales with
   * (matched records × recipients), and a write path must not carry it.
   */
  const queueRegrant = (rule: SharingRuleRow): void => {
    const ruleId = String(rule.id);
    if (pendingRegrants.has(ruleId)) return;
    pendingRegrants.add(ruleId);
    ruleRegrantQueue.enqueue(
      async () => {
        // Released first: a BU write landing during this pass must be able to
        // queue its own, since this one may already have read the tree.
        pendingRegrants.delete(ruleId);
        await service.evaluateRule(ruleId, SYSTEM_CTX as any);
      },
      (err: any) => {
        pendingRegrants.delete(ruleId);
        logger?.warn?.(
          '[sharing-rule] business-unit re-grant failed — recipients who moved INTO a shared subtree stay '
            + 'without access until the next reconcile (any sharing-rule write, or a restart); grants that '
            + 'were withdrawn stay withdrawn',
          { rule: rule.name ?? ruleId, error: err?.message },
        );
      },
    );
  };

  const onGraphWrite = (objectName: string, event: string) => async (hookCtx: any): Promise<void> => {
    try {
      if (!writeCanChangeExpansion(objectName, event, hookCtx)) return;
      const rules = await service.listRules({ activeOnly: true }, SYSTEM_CTX as any);
      const affected = (rules ?? []).filter((r) => BU_TREE_RECIPIENT_TYPES.has(r.recipient_type));
      if (affected.length === 0) return;
      for (const rule of affected) {
        // Safety half — synchronous and complete. Failing one rule must not
        // stop the next: a throw here would leave the remaining rules' stale
        // grants in place, which is the direction this whole module exists to
        // prevent.
        try {
          const retired = await service.revokeRuleGrantsForRetiredRecipients(rule);
          if (retired > 0) {
            logger?.info?.(
              '[sharing-rule] business-unit graph changed — withdrew grants from recipients the rule no '
                + 'longer reaches',
              { rule: rule.name ?? rule.id, object: objectName, event, recipientsRetired: retired },
            );
          }
        } catch (err: any) {
          logger?.warn?.(
            '[sharing-rule] business-unit revocation failed — this rule may still grant access to '
              + 'recipients it no longer reaches until the next reconcile',
            { rule: rule.name ?? rule.id, object: objectName, error: err?.message },
          );
        }
        // Restoration half — queued, coalesced, never awaited.
        queueRegrant(rule);
      }
    } catch (err: any) {
      // A hook must not fail an operator's write.
      logger?.warn?.('[sharing-rule] business-unit recompute failed', {
        object: objectName,
        event,
        error: err?.message,
      });
    }
  };

  for (const objectName of BU_GRAPH_OBJECTS) {
    for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) {
      engine.registerHook(event, onGraphWrite(objectName, event), {
        object: objectName,
        packageId: BU_TREE_RECOMPUTE_PACKAGE,
        // Behind the primary-BU projection (150) so the denormalised
        // `sys_user.primary_business_unit_id` is already in step, and behind
        // the rule recompute's own 180 for the same reason it sits there.
        priority: 190,
      });
    }
  }

  logger?.info?.('[sharing-rule] business-unit graph recompute hooks bound', {
    objects: [...BU_GRAPH_OBJECTS],
    recipientTypes: [...BU_TREE_RECIPIENT_TYPES],
  });
}

export function unbindBusinessUnitTreeRecompute(engine: MinimalEngine): number {
  if (typeof engine.unregisterHooksByPackage !== 'function') return 0;
  return engine.unregisterHooksByPackage(BU_TREE_RECOMPUTE_PACKAGE);
}
