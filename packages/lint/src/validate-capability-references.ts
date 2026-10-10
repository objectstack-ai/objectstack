// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0066 ⑨] Authoring-time validation for capability references.
 *
 * `requiredPermissions` (on objects, fields, apps, actions, list views and
 * dashboards) and `systemPermissions` (on permission sets) are free capability
 * strings. A typo
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
import { recordsOf } from './object-graph.js';

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
  for (const cap of recordsOf(stack.capabilities)) {
    if (typeof cap.name === 'string' && cap.name.length > 0) known.add(cap.name);
  }
  for (const ps of recordsOf(stack.permissions)) {
    for (const cap of asCapArray(ps.systemPermissions)) known.add(cap);
  }
  for (const seed of recordsOf(stack.data)) {
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

  // [#22639] A list view's `requiredPermissions` is an AUDIENCE gate: the
  // `/meta` read gate serves a gated list view only to a caller who holds every
  // capability it names, so a misspelled one hides the view from everyone,
  // silently. Each named entry of a `listViews` map is resolved like any other
  // reference.
  const flagListViews = (listViews: unknown, owner: string, path: string) => {
    if (!listViews || typeof listViews !== 'object' || Array.isArray(listViews)) return;
    for (const [key, view] of Object.entries(listViews as AnyRec)) {
      if (!view || typeof view !== 'object') continue;
      for (const cap of asCapArray((view as AnyRec).requiredPermissions)) {
        flag(cap, `list view "${owner}.${key}"`, `${path}.${key}.requiredPermissions`);
      }
    }
  };

  // ── Objects (D3) + their fields (D3) + embedded actions (D4) ──
  const objects = recordsOf(stack.objects);
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || typeof obj !== 'object') continue;
    const objName = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    const objPath = `objects[${i}]`;

    for (const { cap, key } of flattenObjectRequired(obj.requiredPermissions)) {
      flag(cap, `object "${objName}"`, `${objPath}.requiredPermissions${key ? `.${key}` : ''}`);
    }

    const fields = recordsOf(obj.fields);
    for (const f of fields) {
      const fname = typeof f.name === 'string' ? f.name : '(field)';
      for (const cap of asCapArray(f.requiredPermissions)) {
        flag(cap, `field "${objName}.${fname}"`, `${objPath}.fields.${fname}.requiredPermissions`);
      }
    }

    for (const [ai, action] of recordsOf(obj.actions).entries()) {
      const aName = typeof action.name === 'string' ? action.name : `(action ${ai})`;
      for (const cap of asCapArray(action.requiredPermissions)) {
        flag(cap, `action "${objName}.${aName}"`, `${objPath}.actions[${ai}].requiredPermissions`);
      }
    }

    // [#22639] An object's own list views — the audience gate the `/meta`
    // read gate applies to them inside the object definition.
    flagListViews(obj.listViews, objName, `${objPath}.listViews`);
  }

  // ── Top-level actions (D4) ──
  for (const [i, action] of recordsOf(stack.actions).entries()) {
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
  const apps = recordsOf(stack.apps);
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

  // ── [#22639] Views: a container's default `list` and each `listViews` entry,
  //    or ONE view — a view item (its list body under `config`) or a
  //    flattened list view (the key at the top level). Every position the key
  //    is declared at is resolved; a view carries the one its shape declares. ──
  const views = recordsOf(stack.views);
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    if (!view || typeof view !== 'object') continue;
    const viewPath = `views[${i}]`;
    const viewName = typeof view.name === 'string' ? view.name
      : typeof view.object === 'string' ? view.object
        : `(view ${i})`;
    for (const cap of asCapArray(view.requiredPermissions)) {
      flag(cap, `view "${viewName}"`, `${viewPath}.requiredPermissions`);
    }
    const config = view.config;
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      for (const cap of asCapArray((config as AnyRec).requiredPermissions)) {
        flag(cap, `view "${viewName}"`, `${viewPath}.config.requiredPermissions`);
      }
    }
    const list = view.list;
    if (list && typeof list === 'object' && !Array.isArray(list)) {
      for (const cap of asCapArray((list as AnyRec).requiredPermissions)) {
        flag(cap, `list view "${viewName}"`, `${viewPath}.list.requiredPermissions`);
      }
    }
    flagListViews(view.listViews, viewName, `${viewPath}.listViews`);
  }

  // ── [#22639] Dashboards: the audience gate on the whole board. ──
  for (const [i, board] of recordsOf(stack.dashboards).entries()) {
    const bName = typeof board.name === 'string' ? board.name : `(dashboard ${i})`;
    for (const cap of asCapArray(board.requiredPermissions)) {
      flag(cap, `dashboard "${bName}"`, `dashboards[${i}].requiredPermissions`);
    }
  }

  return findings;
}
