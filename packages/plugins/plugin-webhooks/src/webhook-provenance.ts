// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#3461] Provenance stamp for `sys_webhook`.
 *
 * `sys_webhook` is RECORD-AUTHORITATIVE: a code-declared webhook is a boot seed
 * (`bootstrapDeclaredWebhooks`), and the row — including any admin tuning such
 * as flipping a noisy webhook to `active: false` — is the authority. The seeder
 * skips rows marked `customized`, so this hook is the half that DETECTS the
 * admin edit: any non-system update touching a `package`/`platform`-seeded row
 * stamps `customized: true` onto the payload.
 *
 * Why a data hook (and not a write gate or the REST layer), verbatim to the
 * sys_sharing_rule rationale (#2909 T1):
 *  - admins edit webhooks through several doors (Setup UI generic data door,
 *    scripts, console) — an engine hook covers them all;
 *  - there is deliberately NO write gate here: webhooks are a first-class admin
 *    authoring surface, so edits are allowed — they just have to be remembered;
 *  - both provenance columns are `readonly`, and the engine's readonly strip
 *    exempts isSystem callers while snapshotting supplied keys BEFORE hooks run
 *    — so a caller can never forge/clear `customized`, while this hook's stamp
 *    survives.
 *
 * Known boundary: multi-row updates (no single `input.id`) are not stamped —
 * every webhook-editing UI path updates by id.
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

export const WEBHOOK_PROVENANCE_PACKAGE = 'plugin-webhooks:provenance';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

export function bindWebhookProvenanceStamp(engine: MinimalEngine, logger?: MinimalLogger): void {
  if (typeof engine?.registerHook !== 'function') return;
  engine.registerHook(
    'beforeUpdate',
    async (ctx: any) => {
      // Seeder / boot reconcilers write with isSystem — the package door, not
      // an admin customization.
      if ((ctx?.session as any)?.isSystem) return;
      const id = ctx?.input?.id ?? (ctx?.input?.data as any)?.id;
      if (!id) return; // multi-row update — see boundary note above
      const data = ctx?.input?.data;
      if (!data || typeof data !== 'object') return;
      try {
        // `previous` is not resolved before beforeUpdate hooks run — read the
        // current row ourselves (system ctx: this is a provenance check, not
        // an authorization decision).
        const rows = await engine.find('sys_webhook', {
          where: { id },
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
        logger?.warn?.('[webhook] provenance stamp failed (edit proceeds unstamped)', {
          id,
          error: err?.message,
        });
      }
    },
    { object: 'sys_webhook', packageId: WEBHOOK_PROVENANCE_PACKAGE, priority: 150 },
  );
  logger?.info?.('[webhook] provenance stamp hook bound');
}

export function unbindWebhookProvenanceStamp(engine: MinimalEngine): void {
  if (typeof engine?.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(WEBHOOK_PROVENANCE_PACKAGE);
  }
}
