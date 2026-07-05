// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SharingRuleService } from './sharing-rule-service.js';
import type { SharingRuleRow } from '@objectstack/spec/contracts';

const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as const;

export const SHARING_RULE_HOOK_PACKAGE = 'plugin-sharing:rules';

/**
 * Package id for the `sys_sharing_rule` DATA-change triggers that re-run the
 * bind (#2592). Deliberately distinct from {@link SHARING_RULE_HOOK_PACKAGE}
 * so {@link unbindAllRuleHooks} — which the rebind itself calls — can never
 * tear down the triggers that drive it.
 */
export const RULE_REBIND_TRIGGER_PACKAGE = 'plugin-sharing:rule-rebind';

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
