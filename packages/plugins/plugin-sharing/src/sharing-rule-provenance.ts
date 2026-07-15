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
 * Known boundary (recorded in the ADR): multi-row updates (no single
 * `input.id`) are not stamped — every rule-editing UI path updates by id.
 */

interface MinimalEngine {
  find(object: string, opts?: any): Promise<any[]>;
  registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void;
  unregisterHooksByPackage(packageId: string): number;
}

interface MinimalLogger {
  info?: (msg: string, meta?: Record<string, any>) => void;
  warn?: (msg: string, meta?: Record<string, any>) => void;
}

export const SHARING_RULE_PROVENANCE_PACKAGE = 'plugin-sharing:rule-provenance';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

export function bindRuleProvenanceStamp(engine: MinimalEngine, logger?: MinimalLogger): void {
  engine.registerHook(
    'beforeUpdate',
    async (ctx: any) => {
      // Seeder / defineRule / boot reconcilers write with isSystem — those
      // are the package door, not an admin customization.
      if ((ctx?.session as any)?.isSystem) return;
      const id = ctx?.input?.id ?? (ctx?.input?.data as any)?.id;
      if (!id) return; // multi-row update — see boundary note above
      const data = ctx?.input?.data;
      if (!data || typeof data !== 'object') return;
      try {
        // `previous` is not resolved before beforeUpdate hooks run — read the
        // current row ourselves (system ctx: this is a provenance check, not
        // an authorization decision).
        const rows = await engine.find('sys_sharing_rule', {
          filter: { id },
          fields: ['id', 'managed_by', 'customized'],
          limit: 1,
          context: SYSTEM_CTX,
        });
        const row = Array.isArray(rows) ? rows[0] : undefined;
        if (!row) return;
        if ((row.managed_by === 'package' || row.managed_by === 'platform') && row.customized !== true) {
          (data as any).customized = true;
        }
      } catch (err: any) {
        logger?.warn?.('[sharing-rule] provenance stamp failed (edit proceeds unstamped)', {
          id,
          error: err?.message,
        });
      }
    },
    { object: 'sys_sharing_rule', packageId: SHARING_RULE_PROVENANCE_PACKAGE, priority: 150 },
  );
  logger?.info?.('[sharing-rule] provenance stamp hook bound');
}

export function unbindRuleProvenanceStamp(engine: MinimalEngine): number {
  return engine.unregisterHooksByPackage(SHARING_RULE_PROVENANCE_PACKAGE);
}
