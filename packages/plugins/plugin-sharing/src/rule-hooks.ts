// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SharingRuleService } from './sharing-rule-service.js';
import type { SharingRuleRow } from '@objectstack/spec/contracts';
import { isMatchAllCriteria, SharingCriteriaValidationError } from './rule-criteria.js';
import {
  RULE_RECOMPUTE_ROW_CAP,
  RuleRegrantQueue,
  stashAffectedRows as stashAffectedRowsOnCtx,
  readAffectedRows,
  type AffectedRows,
} from './bulk-recompute.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

export const SHARING_RULE_HOOK_PACKAGE = 'plugin-sharing:rules';

/**
 * Package id for the `sys_sharing_rule` DATA-change triggers that re-run the
 * bind (#2592). Deliberately distinct from {@link SHARING_RULE_HOOK_PACKAGE}
 * so {@link unbindAllRuleHooks} — which the rebind itself calls — can never
 * tear down the triggers that drive it.
 */
export const RULE_REBIND_TRIGGER_PACKAGE = 'plugin-sharing:rule-rebind';

/**
 * Package id for the `sys_sharing_rule` criteria guard (#3896). Separate from
 * both packages above so neither rebind can unregister it.
 */
export const RULE_CRITERIA_GUARD_PACKAGE = 'plugin-sharing:rule-criteria-guard';

/*
 * RETIRED — the `isSystem` materialisation skip, and with it the INFO line that
 * announced it (`SYSTEM_WRITE_SKIP_NOTICE`, #6783 / #4707 demand 3).
 *
 * The notice existed because the skip was silent: a fresh install could carry
 * active rules, matching records and an empty `sys_record_share`, and nothing
 * said so. Its wording named the two remedies — re-evaluate the rules, or
 * restart to backfill — and both were real. What made it obsolete is that the
 * skip it described is gone, so there is no longer a silent window to announce.
 *
 * Maintainer ruling 2026-08-31 (verbatim, untranslated — an accepted decision
 * is reversed only by a later one, AGENTS.md Prime Directive #13):
 *
 *   裁定:系统写参与逐记录共享物化 —— 删除 `plugin-sharing` 两个钩子里的
 *   `isSystem` 跳过,⛔ 不加声明式开关、不以文档代修。
 *
 * The reasoning that binds here: a sharing rule's declared semantics
 * (`status == "approved"` implies the team can see it) is a published promise,
 * and a hook that skipped the write which satisfies it made declared different
 * from enforced. `isSystem` says the platform is the OPERATOR; it never says
 * the consequence need not happen. The specimen was an approval write-back —
 * a `lockRecord: true` node mirrors the decision onto the record under a system
 * context (`plugin-approvals` `approval-service.ts` `mirrorStatusField`), which
 * is the ONLY write that can land while the record is locked — after which a
 * teammate relying on the rule could not see the record until somebody ran
 * `POST /api/v1/sharing/rules/:id/evaluate` or restarted the server.
 *
 * The boot backfill in `sharing-plugin.ts` is unaffected and still needed: it
 * covers rows written while a rule was inactive or before its hooks were bound,
 * and it is the only pass that purges a deactivated rule's grants.
 */

interface MinimalEngine {
  registerHook(event: string, handler: (ctx: any) => any | Promise<any>, options?: {
    object?: string | string[];
    priority?: number;
    packageId?: string;
  }): void;
  unregisterHooksByPackage(packageId: string): number;
  /**
   * [#4779] Needed to resolve a predicate write's row set in the `before`
   * hook. Optional so a caller holding only the hook-registry surface still
   * type-checks; absent, every predicate write is treated as unbounded — the
   * safe direction (revoke everything, re-grant asynchronously), never the
   * silent no-op this issue was filed for.
   */
  find?(object: string, options?: any): Promise<any[]>;
}

interface MinimalLogger {
  info?: (msg: any, ...rest: any[]) => void;
  /**
   * Non-optional because this logger is FORWARDED into `stashAffectedRowsOnCtx`
   * (bulk-recompute.ts), whose sink guarantees a `warn` channel under #9754. A
   * `warn?` here would re-open the silence one module downstream of the place it
   * was closed — the forwarding seam is exactly where a guarantee gets lost, and
   * `tsc` reported it the moment the callee's contract tightened (#10556).
   *
   * This shape declares no `error` at all, so it is not itself in the
   * optional-error-sink population; what it must not do is hand a
   * silence-permitting value to something that promises otherwise.
   */
  warn: (msg: any, ...rest: any[]) => void;
}

/**
 * The in-process executor for the asynchronous re-grant half of #4779.
 *
 * Module-scoped on purpose: `bindRuleHooks` is called again on every rule
 * rebind (`bindRuleRebindTriggers` unbinds and re-binds the whole package on
 * each `sys_sharing_rule` write), and a per-call queue would let a rebind
 * orphan re-grants that were still in flight. One queue per process keeps the
 * chain — and therefore the serialization guarantee — continuous across
 * rebinds. Exported for tests to await; production code never does.
 */
export const ruleRegrantQueue = new RuleRegrantQueue();

/**
 * Bind the sharing-rule recompute hooks for every distinct object_name in
 * `rules`. Everything runs with SYSTEM_CTX so the evaluator can write
 * `sys_record_share` without being blocked by its own enforcement.
 *
 * Five hooks per object:
 *
 *  - `afterInsert` — recompute the inserted row (unchanged behaviour).
 *  - `beforeUpdate` / `beforeDelete` — resolve the affected row set and stash
 *    it for the `after` half (`AFFECTED_ROWS_STASH_KEY`). Must be
 *    `before`: the write is what makes those rows unfindable. Runs for system
 *    writes too, and has to: `afterUpdate` now materialises for them, and with
 *    no stash `readAffectedRows` answers `unbounded` — which would send every
 *    single-row system update down the object-wide revoke branch below.
 *    [#6966] The stash rides `HookContext.dispatch.scope`, the engine's
 *    per-write scratch — NOT the context object. A predicate write dispatches
 *    `before*` per row (#5574) and builds a fresh context for each, so the
 *    older "the engine reuses one HookContext across the pair" assumption held
 *    only for single-id writes and silently dropped every bulk write's stash.
 *  - `afterUpdate` — recompute per row when the set is bounded (which grants
 *    AND revokes, so a bulk update INTO a rule's criteria is covered as well
 *    as one out of it); otherwise revoke the object's rule grants set-based
 *    and queue the re-grant.
 *  - `afterDelete` — revoke the deleted rows' rule grants. Nothing can
 *    re-grant them: `evaluateRule` iterates records that still exist, so a
 *    grant whose record is gone is unreachable by every reconcile path and
 *    outlives restarts (the orphan noted at the tail of #4779).
 *
 * [#5103] This package covers `source: 'rule'` rows only, and only on objects
 * that HAVE a rule — which left a manual share on a deleted record orphaned
 * forever. The general invariant ("the record is gone, so no share on it can
 * be valid") is not the rule subsystem's to enforce and now lives in
 * `record-share-cascade.ts`, bound on every sharing-capable object regardless
 * of rules. The two are deliberately independent: this one keeps working if
 * the cascade is unbound, and its unbounded-delete branch (revoke the object's
 * rule grants, re-grant asynchronously) is a rule-only trade the cascade must
 * never make on manual rows.
 *
 * [#4779] `if (!id) return` — the line these hooks used to open with — is
 * gone. It read as a cheap guard and was in fact the whole defect: predicate
 * (`multi: true`) writes never populate `input.id`, so every bulk write
 * skipped recompute entirely and left stale `sys_record_share` rows granting
 * access the rules no longer imply.
 *
 * [#13533] GRANT MATERIALISATION no longer asks whether the writer is the
 * platform. The `afterInsert` / `afterUpdate` skips on `session.isSystem` — and
 * the `before*` stash skip they depended on — are gone, so a system write
 * materialises exactly as a user write does. See the retirement note at the top
 * of this file for the ruling and the specimen. `afterDelete` still skips, on
 * its own separate grounds, spelled out at that hook.
 *
 * Caller is responsible for invoking {@link unbindAllRuleHooks} before
 * re-binding when the rule set changes.
 */
export function bindRuleHooks(
  engine: MinimalEngine,
  service: SharingRuleService,
  rules: SharingRuleRow[],
  logger?: MinimalLogger,
): void {
  const objects = new Set<string>();
  for (const r of rules) {
    if (r.active === false) continue;
    if (!r.object_name) continue;
    objects.add(r.object_name);
  }

  for (const objectName of objects) {
    const opts = { object: objectName, packageId: SHARING_RULE_HOOK_PACKAGE, priority: 180 };

    /** Recompute one record; never throws (a hook must not fail the write). */
    const recomputeRow = async (id: string): Promise<void> => {
      await service.evaluateAllForRecord(objectName, id, SYSTEM_CTX as any);
    };

    /**
     * The unbounded branch: revoke now, re-grant later. Ordered so that the
     * process can die between the two and still be safe — the grants are
     * already gone, and the `kernel:bootstrapped` backfill re-grants on the
     * next start.
     */
    const revokeThenQueueRegrant = async (reason: string): Promise<void> => {
      await service.revokeRuleGrantsForObject(objectName);
      logger?.warn?.(
        '[sharing-rule] a bulk write touched more rows than can be recomputed inline — every rule grant on ' +
          'this object was revoked and is being re-granted in the background; recipients may briefly lose ' +
          'access to records they still qualify for (a restart re-runs the same reconcile)',
        { object: objectName, reason, cap: RULE_RECOMPUTE_ROW_CAP },
      );
      ruleRegrantQueue.enqueue(
        () => service.evaluateAllRulesForObject(objectName).then(() => undefined),
        (err: any) => logger?.warn?.(
          '[sharing-rule] background re-grant failed — grants stay revoked until the next reconcile ' +
            '(any sharing-rule write, or a restart)',
          { object: objectName, error: err?.message },
        ),
      );
    };

    /**
     * [#5103] Delegates to the shared stash: the record-delete cascade binds
     * its own `beforeDelete` on the same objects, and whichever of the two runs
     * first resolves the row set for both.
     *
     * [#13533] Unconditional. It used to skip system writes, on the reasoning
     * that the recompute half left seeds to the boot backfill — which was true
     * only while `afterUpdate` skipped them too. It no longer does, and an
     * `after` hook with no stash does not read as "nothing changed": it reads
     * as `unbounded` (`readAffectedRows`, deliberately), so the skip would have
     * turned every single-row system update — the approval write-back the
     * ruling is about — into an object-wide revoke plus an asynchronous
     * re-grant. Resolving is also nearly free on that shape: a write that names
     * its row short-circuits in `resolveAffectedRows` step 1 without querying.
     */
    const stashAffectedRows = async (ctx: any) => {
      await stashAffectedRowsOnCtx(engine, objectName, ctx, logger);
    };

    /** What the `after` hook should act on when no `before` hook ran. */
    const affectedFrom = (ctx: any): AffectedRows => readAffectedRows(ctx);

    /**
     * [#6966] Has this write's `after` work already been done by an earlier row
     * of the same fan-out?
     *
     * What the `after` hooks below act on is the WRITE's row set, not the row
     * they happen to be dispatched for — `affectedFrom` returns the whole
     * union, and both branches (per-row recompute, object-wide revoke) are
     * batch-scoped. A predicate write dispatches them once per matched row, so
     * running them unguarded does the batch's work N times: N identical
     * object-wide revokes on the unbounded branch, and N×N `recomputeRow` calls
     * on the bounded one — quadratic in the batch size, which for a write at
     * the cap is a million recomputes for a thousand rows.
     */
    const alreadyHandledThisWrite = (ctx: any): boolean =>
      ctx?.dispatch?.mode === 'per-row' && ctx.dispatch.index !== 0;

    engine.registerHook('afterInsert', async (ctx: any) => {
      try {
        const data = ctx?.result ?? ctx?.input?.data ?? {};
        const id = String((data as any)?.id ?? ctx?.input?.id ?? '');
        if (!id) return;
        await recomputeRow(id);
      } catch (err: any) {
        logger?.warn?.('[sharing-rule] hook evaluation failed', { object: objectName, error: err?.message });
      }
    }, opts);

    engine.registerHook('beforeUpdate', stashAffectedRows, opts);
    engine.registerHook('beforeDelete', stashAffectedRows, opts);

    engine.registerHook('afterUpdate', async (ctx: any) => {
      // [#13533] An `isSystem` update INTO a rule's criteria owes grants the
      // same way an insert does — that update IS the approval write-back — and
      // `evaluateRule` is diff-based, so one out of the criteria revokes just
      // as symmetrically. Neither direction asks who wrote the row any more.
      if (alreadyHandledThisWrite(ctx)) return;
      try {
        const affected = affectedFrom(ctx);
        if (affected.kind === 'rows') {
          for (const id of affected.ids) await recomputeRow(id);
          return;
        }
        await revokeThenQueueRegrant(affected.reason);
      } catch (err: any) {
        logger?.warn?.('[sharing-rule] hook evaluation failed', { object: objectName, error: err?.message });
      }
    }, opts);

    engine.registerHook('afterDelete', async (ctx: any) => {
      // [#13533] The one system-write skip that SURVIVED the ruling, because
      // what it skips is a different payload. The insert/update skips dropped
      // MATERIALISATION — a grant the rule's own declared semantics promised,
      // with nothing else on the write path to deliver it. A delete skips
      // REVOCATION, and that consequence is delivered anyway: the general
      // invariant "the record is gone, so no share on it can be valid" belongs
      // to `record-share-cascade.ts`, which binds on every sharing-capable
      // object and stashes for system writes on its own account (#5103), with
      // the boot orphan sweep behind it. So this is not `isSystem` used as a
      // blanket silencer; it is one subscriber declining work another
      // subscriber owns. Removing it would double-revoke, and the rule-only
      // trade below (revoke the object's grants, re-grant asynchronously) is
      // one the cascade must never make on manual rows.
      if ((ctx?.session as any)?.isSystem) return;
      if (alreadyHandledThisWrite(ctx)) return;
      try {
        const affected = affectedFrom(ctx);
        if (affected.kind === 'rows') {
          await service.revokeRuleGrantsForRecords(objectName, affected.ids);
          return;
        }
        // The deleted set is unknown, so which grants are orphaned is unknown
        // too. Revoke them all and let the re-grant restore those whose record
        // survived — the same trade the update path makes.
        await revokeThenQueueRegrant(affected.reason);
      } catch (err: any) {
        logger?.warn?.('[sharing-rule] hook evaluation failed', { object: objectName, error: err?.message });
      }
    }, opts);
  }
  logger?.info?.('[sharing-rule] hooks bound', { objects: Array.from(objects), ruleCount: rules.length });
}

export function unbindAllRuleHooks(engine: MinimalEngine): number {
  return engine.unregisterHooksByPackage(SHARING_RULE_HOOK_PACKAGE);
}

/**
 * [#3896] Reject `sys_sharing_rule` writes whose criteria would share every
 * record of the target object.
 *
 * `SharingRuleService.defineRule` gates the programmatic + REST
 * (`POST {basePath}/sharing/rules`) entries, but authoring a rule in Setup is
 * a plain data INSERT on this table — it never reaches that method. Without
 * this hook the UI path keeps producing rules the evaluator now refuses to
 * act on: safe, but silently inert, which is its own authoring trap
 * (ADR-0078). Failing the write instead tells the admin the criteria is
 * missing while they are still looking at the form.
 *
 * LAYERING since ADR-0113: the field now declares `required: true` (write
 * contract), so the record validator already rejects a missing/null criteria
 * on insert and an explicit null-out on update — with the same non-regression
 * update semantics this hook pioneered (only a patch that SUPPLIES
 * `criteria_json` is checked; a legacy null row can still be `active: false`d).
 * This hook remains for what `required` cannot express: the NON-null
 * match-all shapes — `'{}'`, an all-vacuous `$and`/`$or`, unparsable JSON, a
 * bare scalar — where `isMatchAllCriteria` is the judge and the rejection
 * names the offending shape instead of saying "required". Defense in depth on
 * the null cases costs one property check and keeps this guard's better
 * message on paths where hooks fire before validation.
 */
export function bindRuleCriteriaGuard(engine: MinimalEngine, logger?: MinimalLogger): void {
  if (typeof engine.registerHook !== 'function') return;
  if (typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(RULE_CRITERIA_GUARD_PACKAGE);
  }
  const guard = (insert: boolean) => (ctx: any) => {
    const data = ctx?.input?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const supplied = Object.prototype.hasOwnProperty.call(data, 'criteria_json');
    if (!insert && !supplied) return;
    if (!isMatchAllCriteria(data.criteria_json)) return;
    throw new SharingCriteriaValidationError();
  };
  const opts = { object: 'sys_sharing_rule', packageId: RULE_CRITERIA_GUARD_PACKAGE, priority: 100 };
  engine.registerHook('beforeInsert', guard(true), opts);
  engine.registerHook('beforeUpdate', guard(false), opts);
  logger?.info?.('[sharing-rule] criteria guard bound on sys_sharing_rule (ADR-0049)');
}
