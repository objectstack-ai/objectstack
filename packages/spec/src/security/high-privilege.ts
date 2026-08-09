// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D5/D9/D7] High-privilege predicates over permission-set shapes.
 *
 * Shared by the runtime audience-anchor gate (`@objectstack/plugin-security`)
 * and the authoring-time security linter (`@objectstack/lint`
 * `validateSecurityPosture`), so "too dangerous for an anchor" has exactly ONE
 * definition — the lint and the gate can never drift apart (ADR-0049: a lint
 * the runtime cannot enforce is not shipped as advisory security).
 *
 * Accepts BOTH the authored spec shape (`objects`, `systemPermissions`) and
 * the `sys_permission_set` ROW shape (`object_permissions` /
 * `system_permissions` JSON-string columns) — callers pass whatever they have.
 */

/** Tolerant JSON access: value may be the parsed object or a JSON string column. */
function coerceRecord(v: unknown): Record<string, unknown> | undefined {
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return undefined; }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * Does a permission-set definition carry bits too dangerous for an audience
 * anchor (`everyone` / `guest`)? Returns a human-readable description of the
 * first offending bit, or `null` when the set is anchor-safe.
 *
 * Offending bits — the ADR-0090 D5 list: any `systemPermissions`,
 * View/Modify All Data (VAMA), or delete/purge/transfer on any object, plus
 * bulk `export` (#3544).
 * A plain `'*'` wildcard grant is NOT high-privilege by itself (D5 permits a
 * read — or read/create/edit-own — baseline to cover all objects; the
 * platform's own `viewer_readonly` is exactly that shape, and `member_default`
 * has carried no wildcard since #5491); the wildcard ban is the GUEST
 * tier's stricter rule (D9 "explicit objects only") — see
 * {@link describeAnchorForbiddenBits}. Fixes #2753: the former blanket
 * wildcard rejection made the then-wildcard-carrying default baseline
 * unbindable to `everyone`, forcing it through the separate fallback channel
 * D5 explicitly rejected.
 *
 * [#3544] `allowExport` joins the list because the export axis is an OPT-IN
 * grant: making export deliberate at the permission-set layer accomplishes
 * nothing if a set carrying it can still be bound to `everyone` (or `guest`),
 * which would hand bulk table egress back to every authenticated user — or to
 * anonymous visitors — and quietly restore the "can-list ⇒ can-export" posture
 * the axis exists to end. It sits in the same class as delete/purge/transfer:
 * not a baseline right, and never something an anchor should confer wholesale.
 * (`member_default` deliberately carries no `allowExport`, so the platform's
 * own baseline stays anchor-bindable.)
 */
export function describeHighPrivilegeBits(def: any): string | null {
  if (!def || typeof def !== 'object') return null;
  const sysRaw = def.systemPermissions ?? def.system_permissions;
  const sys = typeof sysRaw === 'string'
    ? (() => { try { return JSON.parse(sysRaw); } catch { return undefined; } })()
    : sysRaw;
  if (Array.isArray(sys) && sys.length > 0) return 'system permissions';
  const objects = coerceRecord(def.objects ?? def.object_permissions);
  if (objects) {
    for (const [objName, rawPerm] of Object.entries(objects)) {
      const p: any = rawPerm ?? {};
      if (p.viewAllRecords || p.modifyAllRecords) return `View/Modify All Data on '${objName}'`;
      if (p.allowDelete || p.allowPurge || p.allowTransfer) return `delete/purge/transfer on '${objName}'`;
      if (p.allowExport) return `bulk export on '${objName}'`;
    }
  }
  return null;
}

/**
 * [ADR-0090 D9] Anchor-tier predicate. `everyone` uses the high-privilege
 * predicate as-is; `guest` faces the STRICTEST tier — additionally no `'*'`
 * wildcard (explicit objects only) and no edit bit on any object (guest
 * bindings are read-only by default; create is the single case-by-case
 * exception, e.g. public form intake).
 *
 * Returns a description of the first offending bit, or `null` when the set
 * may be bound to the given anchor.
 */
export function describeAnchorForbiddenBits(
  def: any,
  anchor: 'everyone' | 'guest',
): string | null {
  const high = describeHighPrivilegeBits(def);
  if (high) return high;
  if (anchor !== 'guest') return null;
  const objects = coerceRecord(def?.objects ?? def?.object_permissions);
  if (objects) {
    for (const [objName, rawPerm] of Object.entries(objects)) {
      const p: any = rawPerm ?? {};
      if (objName === '*') return "a '*' wildcard grant (guest bindings admit explicit objects only)";
      if (p.allowEdit) return `edit on '${objName}' (guest bindings are read-only; create is the only case-by-case write)`;
    }
  }
  return null;
}
