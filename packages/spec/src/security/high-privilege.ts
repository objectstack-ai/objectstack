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

import { PLATFORM_CAPABILITY_NAMES } from './capabilities';

/** Tolerant JSON access: value may be the parsed object or a JSON string column. */
function coerceRecord(v: unknown): Record<string, unknown> | undefined {
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return undefined; }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * [#17189, ADR-0066 D1] What the anchor predicates need to know about the
 * stack they are judging a set FOR.
 *
 * The predicates are pure and synchronous — they read one permission-set
 * definition and nothing else — so the one fact they cannot discover for
 * themselves is which capability names this stack DECLARED. The caller holds
 * it: at boot from the `sys_capability` rows carrying `managed_by: 'package'`
 * provenance, at authoring time from the stack's own `capabilities` array.
 *
 * ⛔ Never synthesize this from the set under test. The point of the input is
 * that a set cannot vouch for its own tokens; a "declared" list derived from
 * `systemPermissions` would excuse every token by construction and turn the
 * gate off.
 */
export interface AnchorBindingContext {
  /**
   * Capability names declared by the packages installed in this stack — plain
   * names, or declarations/`sys_capability` rows carrying a `name` (every other
   * field on such a row is ignored, so a caller hands over what it already has
   * and never transcribes). Omit it (or pass an empty list) and the predicates
   * refuse exactly as they did before the input existed.
   */
  declaredCapabilities?: Iterable<string | { name?: unknown; [key: string]: unknown }>;
}

/**
 * The app-declared names that may be excused, with the platform floor applied.
 *
 * Returns `undefined` when nothing is excusable, so the caller keeps the
 * pre-#17189 code path verbatim rather than filtering against an empty set.
 */
function appDeclaredCapabilityNames(
  context: AnchorBindingContext | undefined,
): ReadonlySet<string> | undefined {
  const declared = context?.declaredCapabilities;
  if (!declared) return undefined;
  const names = new Set<string>();
  for (const entry of declared) {
    const name = typeof entry === 'string'
      ? entry
      : (entry && typeof entry === 'object' ? (entry as { name?: unknown }).name : undefined);
    if (typeof name !== 'string' || name.length === 0) continue;
    // THE PLATFORM FLOOR. A platform capability stays high-privilege no matter
    // who declares a capability of that name — otherwise declaring
    // `manage_users` would launder it past the anchor gate, and the widening
    // would be a bypass rather than a distinction.
    if (PLATFORM_CAPABILITY_NAMES.has(name)) continue;
    names.add(name);
  }
  return names.size > 0 ? names : undefined;
}

/**
 * Does a permission-set definition carry bits too dangerous for an audience
 * anchor (`everyone` / `guest`)? Returns a human-readable description of the
 * first offending bit, or `null` when the set is anchor-safe.
 *
 * Offending bits — the ADR-0090 D5 list: a `systemPermissions` entry naming a
 * PLATFORM system permission, View/Modify All Data (VAMA), or
 * delete/purge/transfer on any object, plus bulk `export` (#3544).
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
 *
 * ## [#17189] `systemPermissions` carries TWO unlike kinds of token
 *
 * One list, two things: the platform's own powers (`manage_users` and friends
 * — the curated `PLATFORM_CAPABILITIES`), and a capability an APP declared for
 * itself (ADR-0066 D1 `defineCapability`, entering the `sys_capability`
 * registry at boot with `managed_by: 'package'` + `package_id` provenance).
 * Until `context` existed the predicate saw only a list of NAMES and judged
 * both alike, so an app could not ship the "every employee holds this" set its
 * own navigation gates on: the set's own token made it unbindable to
 * `everyone`, and the app was pushed toward not declaring gates at all.
 *
 * {@link AnchorBindingContext.declaredCapabilities} supplies the missing half —
 * the capability names THIS stack declared. A name on that list is the app's
 * own gate and is not counted as a system permission. The discriminator is
 * **provenance**, not spelling: ⛔ never infer "app token" from the shape of a
 * name (a dotted segment, a prefix). A spelling rule misjudges in silence the
 * first platform permission that is dotted or the first app token that is not,
 * and it is the CALLER — which can read what this stack declared — that holds
 * the fact, never the string.
 *
 * Two properties keep the widening honest, both fail-CLOSED:
 *
 *  - **The platform floor is absolute.** A name in
 *    {@link PLATFORM_CAPABILITY_NAMES} is high-privilege however it is
 *    declared, so an app cannot launder `manage_users` past the anchor gate by
 *    declaring a capability of that name.
 *  - **Omission refuses.** With no `context` — or with a token absent from it —
 *    the verdict is exactly the pre-parameter one: a non-empty
 *    `systemPermissions` offends. A caller that cannot enumerate the stack's
 *    declarations errs toward REFUSING a binding, never toward granting one.
 */
export function describeHighPrivilegeBits(def: any, context?: AnchorBindingContext): string | null {
  if (!def || typeof def !== 'object') return null;
  const sysRaw = def.systemPermissions ?? def.system_permissions;
  const sys = typeof sysRaw === 'string'
    ? (() => { try { return JSON.parse(sysRaw); } catch { return undefined; } })()
    : sysRaw;
  if (Array.isArray(sys) && sys.length > 0) {
    const declared = appDeclaredCapabilityNames(context);
    // A non-string entry is never excused: only a name can be matched against a
    // declaration, so anything else stays on the offending side.
    const unexcused = declared
      ? sys.filter((token: unknown) => typeof token !== 'string' || !declared.has(token))
      : sys;
    if (unexcused.length > 0) return 'system permissions';
  }
  const objects = coerceRecord(def.objects ?? def.object_permissions);
  if (objects) {
    for (const [objName, rawPerm] of Object.entries(objects)) {
      const p: any = rawPerm ?? {};
      if (p.viewAllRecords || p.modifyAllRecords) return `View/Modify All Data on '${objName}'`;
      // The class message keeps the D5 name "delete/purge/transfer", but the
      // `allowPurge` READ is gone (#12497): the bit is a retiredKey tombstone —
      // no authored or freshly-parsed set can carry it, and a legacy stored row
      // that still does grants nothing (no `purge` operation exists, and the
      // evaluator's mapping row retired with the bit), so flagging it guarded
      // nothing real. When the M2 batch restores the bit and its gate row,
      // restore the read here in the same PR — anchor bindings are re-checked
      // at boot, so a legacy value regains no privilege silently.
      if (p.allowDelete || p.allowTransfer) return `delete/purge/transfer on '${objName}'`;
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
  context?: AnchorBindingContext,
): string | null {
  // [#17189] The D5 app-capability excusal is the `everyone` tier's alone. D9
  // gives `guest` the STRICTEST tier, and an app token handed to `guest` is
  // handed to anonymous visitors — a different act from handing it to the
  // authenticated members D5 speaks for, and one this ruling did not decide.
  // So the guest tier asks the question with NO context and keeps refusing any
  // non-empty `systemPermissions`.
  const high = describeHighPrivilegeBits(def, anchor === 'guest' ? undefined : context);
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
