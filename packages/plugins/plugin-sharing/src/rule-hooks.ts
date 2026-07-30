// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SharingRuleService } from './sharing-rule-service.js';
import type { SharingRuleRow } from '@objectstack/spec/contracts';
import { isMatchAllCriteria, SharingCriteriaValidationError } from './rule-criteria.js';

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

interface MinimalEngine {
  registerHook(event: string, handler: (ctx: any) => any | Promise<any>, options?: {
    object?: string | string[];
    priority?: number;
    packageId?: string;
  }): void;
  unregisterHooksByPackage(packageId: string): number;
}

interface MinimalLogger {
  info?: (msg: any, ...rest: any[]) => void;
  warn?: (msg: any, ...rest: any[]) => void;
}

/**
 * Bind afterInsert/afterUpdate hooks for every distinct object_name in
 * `rules`. Each hook calls `service.evaluateAllForRecord(object, id, …)`
 * with SYSTEM_CTX so the evaluator can write `sys_record_share` rows
 * without being blocked by its own enforcement.
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
    if (r.object_name) objects.add(r.object_name);
  }
  for (const objectName of objects) {
    const handler = async (ctx: any) => {
      if ((ctx?.session as any)?.isSystem) return;
      try {
        const data = ctx?.result ?? ctx?.input?.data ?? {};
        const id = String((data as any)?.id ?? ctx?.input?.id ?? '');
        if (!id) return;
        await service.evaluateAllForRecord(objectName, id, SYSTEM_CTX as any);
      } catch (err: any) {
        logger?.warn?.('[sharing-rule] hook evaluation failed', { object: objectName, error: err?.message });
      }
    };
    engine.registerHook('afterInsert', handler, { object: objectName, packageId: SHARING_RULE_HOOK_PACKAGE, priority: 180 });
    engine.registerHook('afterUpdate', handler, { object: objectName, packageId: SHARING_RULE_HOOK_PACKAGE, priority: 180 });
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
