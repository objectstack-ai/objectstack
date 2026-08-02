// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0072 — reference resolvability] App-navigation targets that are not
 * object names: `page`, `report`, `dashboard`.
 *
 * ## The hole this closes is inside an EXISTING check, not a missing one
 *
 * `defineStack`'s `validateCrossReferences` already validates these three
 * (`stack.zod.ts`, the "Validate app navigation → object/dashboard/page/report
 * references" block). But each of the three is guarded on the collection being
 * non-empty:
 *
 * ```ts
 * if (nav.type === 'page' && typeof nav.pageName === 'string'
 *     && pageNames.size > 0 && !pageNames.has(nav.pageName)) { … }
 * ```
 *
 * So a stack that declares **no `pages` at all** has its page-nav check
 * silently switched off, and `{ type: 'page', pageName: 'anything' }` sails
 * through. That is precisely the state a stack is in when the target was never
 * written — the most likely way to get here, not the least.
 *
 * Note the asymmetry the guard creates. The `object` arm of the same block has
 * no size gate: it errors unless the item carries `requiresObject`, an
 * EXPLICIT opt-in to "another package provides this". Objects therefore say so
 * out loud; pages, reports and dashboards get an implicit exemption that
 * depends on an unrelated property of the stack.
 *
 * This rule restores the coverage with the ADR-0072 severity posture rather
 * than by tightening the parse-time throw — a throw has no escape hatch for a
 * legitimately cross-package page, and ADR-0072 D1's rule is that one dead
 * finding costs more than a missed one.
 *
 * ## Severity: warning, and why it is not error
 *
 * `validate-object-references` can say ERROR for an unresolved *object*
 * because it resolves against a curated `PLATFORM_PROVIDED_OBJECT_NAMES`
 * registry — it knows which cross-package names are real. No such registry
 * exists for pages, reports or dashboards, so "unresolved" genuinely cannot be
 * distinguished from "provided by a package we cannot see from here".
 * Advisory is the honest ceiling. When `defineStack`'s own check is live (the
 * collection is non-empty) it still hard-fails first; this rule is what speaks
 * when that check has switched itself off.
 *
 * ## Deliberately NOT covered — each verified, not assumed
 *
 * - **`action`** (`actionDef.actionName`) — already owned by
 *   `validate-action-name-refs`, which walks app navigation explicitly. Adding
 *   it here would double-report the same finding.
 * - **`component`** (`componentRef`) — verified a NON-rule. An unregistered ref
 *   does NOT fail silently: `ComponentNavView` renders a named diagnostic
 *   ("Component not registered … Ensure the plugin that provides this surface
 *   is installed and has called `registerAppComponent()`"), and the registry
 *   exists precisely so plugin-provided surfaces may legitimately be absent.
 *   Flagging it would break valid plugin nav and prescribe a fix for something
 *   already reported better at runtime.
 * - **`url`** — external by definition; nothing to resolve against.
 */

import type { ReferenceIntegrityFinding } from './reference-integrity-suite.js';

export type NavTargetRefSeverity = 'error' | 'warning';
export type NavTargetRefFinding = ReferenceIntegrityFinding;

/** Emitted when a nav item targets a page/report/dashboard the stack cannot resolve. */
export const NAV_TARGET_UNRESOLVED = 'nav-target-unresolved';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter(isRec);
  if (isRec(v)) return Object.entries(v).map(([name, def]) => (isRec(def) ? { name, ...def } : { name }));
  return [];
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * An interpolated target resolves at render time — the same conservative
 * exemption `validate-object-references` and `validate-dashboard-action-refs`
 * use to keep false positives near zero (ADR-0072 D1).
 */
const isInterpolated = (s: string): boolean => s.includes('${') || s.includes('{');

/** nav `type` → [target property, stack collection, human noun]. */
const NAV_TARGETS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['page', 'pageName', 'pages', 'page'],
  ['report', 'reportName', 'reports', 'report'],
  ['dashboard', 'dashboardName', 'dashboards', 'dashboard'],
];

function namesOf(collection: unknown): Set<string> {
  const out = new Set<string>();
  for (const entry of asArray(collection)) {
    const n = strName(entry.name);
    if (n) out.add(n);
  }
  return out;
}

export function validateNavTargetRefs(stack: unknown): NavTargetRefFinding[] {
  const findings: NavTargetRefFinding[] = [];
  if (!isRec(stack)) return findings;

  const apps = asArray(stack.apps);
  if (apps.length === 0) return findings;

  const declared = new Map<string, Set<string>>();
  for (const [, , collection] of NAV_TARGETS) {
    declared.set(collection, namesOf((stack as AnyRec)[collection]));
  }

  for (const [ai, app] of apps.entries()) {
    const appName = strName(app.name) ?? `#${ai}`;

    const walk = (items: unknown, basePath: string): void => {
      if (!Array.isArray(items)) return;
      for (const [ni, raw] of items.entries()) {
        if (!isRec(raw)) continue;
        const nav = raw;
        const navPath = `${basePath}[${ni}]`;

        for (const [type, prop, collection, noun] of NAV_TARGETS) {
          if (nav.type !== type) continue;
          const target = strName(nav[prop]);
          if (!target || isInterpolated(target)) continue;
          const known = declared.get(collection)!;
          if (known.has(target)) continue;

          const emptyCollection = known.size === 0;
          findings.push({
            severity: 'warning',
            rule: NAV_TARGET_UNRESOLVED,
            where: `app "${appName}" · nav "${strName(nav.id) ?? strName(nav.label) ?? `#${ni}`}"`,
            path: `${navPath}.${prop}`,
            message:
              `Navigation targets ${noun} '${target}', which this stack does not declare in `
              + `\`${collection}\`. `
              + (emptyCollection
                ? `The stack declares NO ${collection} at all, so \`defineStack\`'s own `
                  + `cross-reference check skipped this entry entirely (it is gated on `
                  + `\`${collection === 'pages' ? 'pageNames' : collection === 'reports' ? 'reportNames' : 'dashboardNames'}.size > 0\`) — `
                  + `nothing else will report it. `
                : '')
              + `The entry renders in the sidebar and resolves to nothing when clicked. If another `
              + `package provides this ${noun}, this is expected and advisory only.`,
            hint:
              `Declare the ${noun} in \`${collection}\`, correct the name, or remove the nav entry `
              + `if the ${noun} is gone.`,
          });
        }

        // Recurse: an `object` nav item carries `children` too, not just a
        // `group` — the same reason `stack.zod.ts` does not gate its recursion
        // on the item type.
        if (Array.isArray(nav.children)) walk(nav.children, `${navPath}.children`);
      }
    };

    walk(app.navigation, `apps[${ai}].navigation`);
    // `areas[]` is the other nav container; it was once skipped wholesale in
    // `stack.zod.ts`, so an areas-based app got no nav validation at all.
    for (const [ari, area] of asArray(app.areas).entries()) {
      walk(area.items, `apps[${ai}].areas[${ari}].items`);
      walk(area.navigation, `apps[${ai}].areas[${ari}].navigation`);
    }
  }

  return findings;
}
