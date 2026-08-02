// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4509] Provenance stamp for `sys_email_template`.
 *
 * `sys_email_template` is RECORD-AUTHORITATIVE: a declared email template is a
 * boot seed ({@link bootstrapDeclaredEmailTemplates}), and the row — including
 * any admin rewording of a transactional mail — is the authority. The seeder
 * skips rows marked `customized`, so this hook is the half that DETECTS the
 * admin edit: any non-system update touching a `package`/`platform`-seeded row
 * stamps `customized: true` onto the payload.
 *
 * Why a data hook (and not a write gate or the REST layer), verbatim to the
 * sys_webhook / sys_sharing_rule rationale (#3461, #2909 T1):
 *  - admins edit templates through several doors (Studio metadata-admin, the
 *    generic data door, scripts) — an engine hook covers them all;
 *  - there is deliberately NO write gate here: templates are a first-class
 *    admin authoring surface, so edits are allowed — they just have to be
 *    remembered;
 *  - both provenance columns are `readonly`, and the engine's readonly strip
 *    exempts isSystem callers while snapshotting supplied keys BEFORE hooks run
 *    — so a caller can never forge/clear `customized`, while this hook's stamp
 *    survives.
 *
 * Known boundary: multi-row updates (no single `input.id`) are not stamped —
 * every template-editing UI path updates by id.
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

export const EMAIL_TEMPLATE_PROVENANCE_PACKAGE = 'plugin-email:template-provenance';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

export function bindEmailTemplateProvenanceStamp(
  engine: MinimalEngine,
  logger?: MinimalLogger,
  object = 'sys_email_template',
): void {
  if (typeof engine?.registerHook !== 'function') return;
  // Re-binding on a re-boot must not stack duplicate hooks.
  if (typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(EMAIL_TEMPLATE_PROVENANCE_PACKAGE);
  }
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
        const rows = await engine.find(object, {
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
        logger?.warn?.('[email] template provenance stamp failed (edit proceeds unstamped)', {
          id,
          error: err?.message,
        });
      }
    },
    { object, packageId: EMAIL_TEMPLATE_PROVENANCE_PACKAGE, priority: 150 },
  );
  logger?.info?.('[email] template provenance stamp hook bound');
}

export function unbindEmailTemplateProvenanceStamp(engine: MinimalEngine): void {
  if (typeof engine?.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(EMAIL_TEMPLATE_PROVENANCE_PACKAGE);
  }
}
