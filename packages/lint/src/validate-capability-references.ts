// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0066 ⑨] Authoring-time validation for capability references.
 *
 * `requiredPermissions` (on objects, fields, apps, and actions) and
 * `systemPermissions` (on permission sets) are free capability strings. A typo
 * — `mange_users` for `manage_users` — is Zod-valid and fails CLOSED at runtime
 * (the caller is denied), which is the safe direction but UNDISCOVERABLE: nothing
 * tells the author the referenced capability exists nowhere. This rule closes
 * that gap by resolving every `requiredPermissions` reference against the set of
 * capabilities known at author time and warning on the unresolved ones —
 * "reject at the producer" (Prime Directive / ADR-0049 honesty).
 *
 * The author-time "known" set is:
 *   1. the built-in platform capabilities (`PLATFORM_CAPABILITY_NAMES`),
 *   2. every capability the stack DECLARES via `defineCapability`
 *      (`stack.capabilities`) — the explicit, package-provenanced declaration
 *      (ADR-0066 D1), materialized at boot by `bootstrapDeclaredCapabilities`,
 *   3. every capability a permission set in this stack GRANTS via
 *      `systemPermissions` (granting a capability also declares it — mirrors
 *      the runtime `bootstrapSystemCapabilities` derived-defaults rule), and
 *   4. any `sys_capability` row shipped as seed data.
 *
 * WARNING, not error: a single package's lint cannot see capabilities declared
 * by OTHER installed packages, and the reference fails closed at runtime anyway,
 * so a dangling reference is "almost certainly a typo" — surface it, don't break
 * the build. Assignment (`systemPermissions`) is NOT flagged: it is the
 * declaration side, and a package legitimately introduces new capabilities there.
 */

import { PLATFORM_CAPABILITY_NAMES } from '@objectstack/spec/security';

export const CAPABILITY_REFERENCE_UNKNOWN = 'capability-reference-unknown';

export type CapabilityRefSeverity = 'error' | 'warning';

export interface CapabilityRefFinding {
  /** Always `warning` — the reference fails closed at runtime (see module note). */
  severity: CapabilityRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `object "sys_license"`. */
  where: string;
  /** Config path, e.g. `objects[3].requiredPermissions`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/** The capability strings in a `string[]` value. */
function asCapArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : [];
}

/**
 * Flatten an object-level `requiredPermissions` — either a `string[]` (all
 * operations) or a per-operation `{ read, create, update, delete }` map (ADR-0066
 * ⑤) — into `[{ cap, key }]`, where `key` is the map key (or `undefined` for the
 * array form) so a finding can point at the exact operation slice.
 */
function flattenObjectRequired(v: unknown): Array<{ cap: string; key?: string }> {
  if (Array.isArray(v)) return asCapArray(v).map((cap) => ({ cap }));
  if (v && typeof v === 'object') {
    const out: Array<{ cap: string; key?: string }> = [];
    for (const [key, val] of Object.entries(v as AnyRec)) {
      for (const cap of asCapArray(val)) out.push({ cap, key });
    }
    return out;
  }
  return [];
}

/**
 * Validate every capability reference in a stack. Returns findings (empty =
 * clean). Advisory only — callers must not fail the build on these alone.
 */
export function validateCapabilityReferences(stack: AnyRec): CapabilityRefFinding[] {
  const findings: CapabilityRefFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  // ── Build the author-time "known capability" set ──
  const known = new Set<string>(PLATFORM_CAPABILITY_NAMES);
  // [ADR-0066 D1] Capabilities the stack explicitly DECLARES via defineCapability.
  for (const cap of asArray(stack.capabilities)) {
    if (typeof cap.name === 'string' && cap.name.length > 0) known.add(cap.name);
  }
  for (const ps of asArray(stack.permissions)) {
    for (const cap of asCapArray(ps.systemPermissions)) known.add(cap);
  }
  for (const seed of asArray(stack.data)) {
    if (seed.object !== 'sys_capability') continue;
    for (const rec of Array.isArray(seed.records) ? seed.records : []) {
      const name = (rec as AnyRec | null)?.name;
      if (typeof name === 'string' && name.length > 0) known.add(name);
    }
  }

  const hint =
    'Fix the capability name, define it with defineCapability (stack.capabilities), ' +
    'declare it on a permission set’s systemPermissions, ship a sys_capability seed row, ' +
    'or ignore this if the capability is provided by another installed package ' +
    '(references fail closed at runtime).';

  const flag = (cap: string, where: string, path: string) => {
    if (known.has(cap)) return;
    findings.push({
      severity: 'warning',
      rule: CAPABILITY_REFERENCE_UNKNOWN,
      where,
      path,
      message:
        `requiredPermissions references capability "${cap}" which is registered ` +
        `nowhere — no built-in capability, no permission set in this package grants ` +
        `it via systemPermissions, and no sys_capability seed declares it`,
      hint,
    });
  };

  // ── Objects (D3) + their fields (D3) + embedded actions (D4) ──
  const objects = asArray(stack.objects);
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || typeof obj !== 'object') continue;
    const objName = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    const objPath = `objects[${i}]`;

    for (const { cap, key } of flattenObjectRequired(obj.requiredPermissions)) {
      flag(cap, `object "${objName}"`, `${objPath}.requiredPermissions${key ? `.${key}` : ''}`);
    }

    const fields = asArray(obj.fields);
    for (const f of fields) {
      const fname = typeof f.name === 'string' ? f.name : '(field)';
      for (const cap of asCapArray(f.requiredPermissions)) {
        flag(cap, `field "${objName}.${fname}"`, `${objPath}.fields.${fname}.requiredPermissions`);
      }
    }

    for (const [ai, action] of asArray(obj.actions).entries()) {
      const aName = typeof action.name === 'string' ? action.name : `(action ${ai})`;
      for (const cap of asCapArray(action.requiredPermissions)) {
        flag(cap, `action "${objName}.${aName}"`, `${objPath}.actions[${ai}].requiredPermissions`);
      }
    }
  }

  // ── Top-level actions (D4) ──
  for (const [i, action] of asArray(stack.actions).entries()) {
    const aName = typeof action.name === 'string' ? action.name : `(action ${i})`;
    for (const cap of asCapArray(action.requiredPermissions)) {
      flag(cap, `action "${aName}"`, `actions[${i}].requiredPermissions`);
    }
  }

  // ── Apps: requiredPermissions can appear at the app and nav-item
  //    (recursively through groups) levels. Walk each app subtree. `areas` is
  //    still traversed, but only to REACH the nav items nested inside it: the
  //    area itself stopped carrying `requiredPermissions` in 17.0.0 (#4651 — it
  //    was a fail-open gate nothing enforced), so the generic check below no
  //    longer fires on an area node. Dropping the traversal would strand every
  //    area-nested item. ──
  const apps = asArray(stack.apps);
  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];
    if (!app || typeof app !== 'object') continue;
    const appName = typeof app.name === 'string' ? app.name : `(app ${i})`;
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((child, ci) => walk(child, `${path}[${ci}]`));
        return;
      }
      const rec = node as AnyRec;
      for (const cap of asCapArray(rec.requiredPermissions)) {
        flag(cap, `app "${appName}"`, `${path}.requiredPermissions`);
      }
      // Recurse only into the sub-structures that carry requiredPermissions.
      if (rec.navigation) walk(rec.navigation, `${path}.navigation`);
      if (rec.areas) walk(rec.areas, `${path}.areas`);
      if (rec.tabs) walk(rec.tabs, `${path}.tabs`);
      if (rec.children) walk(rec.children, `${path}.children`);
      if (rec.items) walk(rec.items, `${path}.items`);
    };
    walk(app, `apps[${i}]`);
  }

  return findings;
}
