// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0049 — references] Action-NAME reference integrity for the surfaces that
 * bind an action by name (issue #3583).
 *
 * `locations` is an action's primary binding, but several surfaces reference
 * actions **by name** instead (see `content/docs/ui/actions.mdx` — "Surfaces can
 * also reference actions by name"). Every one of those fields is a plain
 * `z.array(z.string())` / `z.string()`, so a name that matches no defined action
 * parses and ships:
 *
 *   - list views — `rowActions[]` / `bulkActions[]` (both the default `list`
 *     container and each `listViews.<key>` entry)
 *   - page components — `record:quick_actions` → `properties.actionNames[]`
 *   - app navigation — `{ type: 'action', actionDef: { actionName } }`
 *
 * The HotCRM audit shipped `bulkActions: ['mass_update', 'mass_delete',
 * 'assign_owner']` with none of the three defined anywhere: the toolbar renders
 * the buttons, selecting rows enables them, and clicking does nothing.
 *
 * This is the same failure `validate-dashboard-action-refs` catches for
 * dashboard header/widget buttons (`DASHBOARD_ACTION_TARGET_UNDEFINED`), so it
 * carries the same severity: **error**. It is a genuine dead reference, and —
 * unlike an object name — there is no cross-package escape hatch to soften it
 * with. The runtime ships NO built-in action names (there is no
 * `BUILTIN_ACTIONS` registry; `list_toolbar`/`list_item` are *locations*, not
 * actions), so a name resolving nowhere is dead, full stop.
 *
 * Scope note: this rule asks only "is this action defined ANYWHERE in the
 * stack?". It deliberately does NOT check that a view's action belongs to the
 * view's own object, nor that the action declares the matching `location` —
 * both are real but distinct classes, and folding them in here would trade the
 * zero-false-positive posture (ADR-0072 D1) for coverage this issue did not ask
 * for. An action defined by another installed package is the one legitimate
 * miss; it is called out in the hint rather than guessed at.
 */

import { walkPageComponents } from './page-walk.js';

export const ACTION_NAME_UNDEFINED = 'action-name-undefined';

export type ActionNameRefSeverity = 'error' | 'warning';

export interface ActionNameRefFinding {
  /** Always `error` — a name-bound action that resolves nowhere is a dead button. */
  severity: ActionNameRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `view "crm_lead" · list "all" · bulkActions`. */
  where: string;
  /** Config path, e.g. `views[0].list.bulkActions[1]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

function suggest(target: string, known: Iterable<string>): string {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of known) {
    const d = distance(target, candidate);
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  const limit = Math.max(2, Math.floor(target.length / 3));
  return best && bestScore <= limit ? ` Did you mean "${best}"?` : '';
}

/** Every action name defined in the stack (global + object-embedded). */
function collectActionNames(stack: AnyRec): Set<string> {
  const names = new Set<string>();
  for (const action of asArray(stack.actions)) {
    const n = strName(action?.name);
    if (n) names.add(n);
  }
  for (const obj of asArray(stack.objects)) {
    if (!obj || typeof obj !== 'object') continue;
    for (const action of asArray(obj.actions)) {
      const n = strName(action?.name);
      if (n) names.add(n);
    }
  }
  return names;
}

/**
 * Validate every name-bound action reference in a stack. Returns findings
 * (empty = clean).
 */
export function validateActionNameRefs(stack: AnyRec): ActionNameRefFinding[] {
  const findings: ActionNameRefFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const known = collectActionNames(stack);

  const check = (name: string, where: string, path: string, surface: string) => {
    if (known.has(name)) return;
    findings.push({
      severity: 'error',
      rule: ACTION_NAME_UNDEFINED,
      where,
      path,
      message:
        `${surface} names action "${name}", which is defined by no action in this stack ` +
        `(neither \`stack.actions\` nor any object's \`actions\`). The button renders and ` +
        `does nothing when clicked — a dead affordance the runtime cannot dispatch.` +
        suggest(name, known),
      hint:
        `Define an action named "${name}" (in \`stack.actions\` or the object's \`actions\`) ` +
        `with the location this surface needs, remove the reference, or ignore this if the ` +
        `action is contributed by another installed package.` +
        (known.size > 0 ? ` Defined actions: ${[...known].sort().join(', ')}.` : ''),
    });
  };

  // ── List views: rowActions / bulkActions on `list` + each `listViews.<key>` ──
  const views = asArray(stack.views);
  for (let vi = 0; vi < views.length; vi++) {
    const view = views[vi];
    if (!view || typeof view !== 'object') continue;
    const viewName = strName(view.name) ?? strName(view.object) ?? `#${vi}`;

    const checkListContainer = (container: unknown, label: string, path: string) => {
      if (!container || typeof container !== 'object') return;
      const list = container as AnyRec;
      for (const key of ['rowActions', 'bulkActions'] as const) {
        const names = strList(list[key]);
        for (let ai = 0; ai < names.length; ai++) {
          check(
            names[ai],
            `view "${viewName}" · ${label} · ${key}`,
            `${path}.${key}[${ai}]`,
            key === 'bulkActions' ? 'Bulk-action menu' : 'Row-action menu',
          );
        }
      }
    };

    checkListContainer(view.list, 'list', `views[${vi}].list`);
    const listViews = view.listViews;
    if (listViews && typeof listViews === 'object' && !Array.isArray(listViews)) {
      for (const [key, lv] of Object.entries(listViews as AnyRec)) {
        checkListContainer(lv, `listViews.${key}`, `views[${vi}].listViews.${key}`);
      }
    }
  }

  // ── Page components: record:quick_actions → properties.actionNames ──
  const pages = asArray(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!page || typeof page !== 'object') continue;
    const pageName = strName(page.name) ?? `#${pi}`;

    // Traversal is shared (`page-walk.ts`): the component tree is NOT where a
    // first reading suggests. Components hang off `regions[].components[]` and
    // `slots`, never a top-level `page.components`, and sub-trees nest inside
    // the untyped `properties` bag rather than under a `children` key.
    for (const { component, path } of walkPageComponents(page, `pages[${pi}]`)) {
      const props = component.properties as AnyRec | undefined;
      if (!props || typeof props !== 'object') continue;
      const names = strList(props.actionNames);
      for (let ai = 0; ai < names.length; ai++) {
        check(
          names[ai],
          `page "${pageName}" · component "${strName(component.type) ?? '?'}"`,
          `${path}.properties.actionNames[${ai}]`,
          'Quick-actions bar',
        );
      }
    }
  }

  // ── App navigation: { type: 'action', actionDef: { actionName } } ──
  const apps = asArray(stack.apps);
  for (let ai = 0; ai < apps.length; ai++) {
    const app = apps[ai];
    if (!app || typeof app !== 'object') continue;
    const appName = strName(app.name) ?? `#${ai}`;

    const walkNav = (items: unknown, basePath: string) => {
      const navItems = asArray(items);
      for (let ni = 0; ni < navItems.length; ni++) {
        const nav = navItems[ni];
        if (!nav || typeof nav !== 'object') continue;
        const navPath = `${basePath}[${ni}]`;
        const actionDef = nav.actionDef as AnyRec | undefined;
        const actionName = strName(actionDef?.actionName);
        if (nav.type === 'action' && actionName) {
          check(
            actionName,
            `app "${appName}" · nav "${strName(nav.id) ?? `#${ni}`}"`,
            `${navPath}.actionDef.actionName`,
            'Navigation action item',
          );
        }
        if (Array.isArray(nav.children)) walkNav(nav.children, `${navPath}.children`);
      }
    };

    walkNav(app.navigation, `apps[${ai}].navigation`);
    const areas = asArray(app.areas);
    for (let ri = 0; ri < areas.length; ri++) {
      walkNav(areas[ri]?.navigation, `apps[${ai}].areas[${ri}].navigation`);
    }
  }

  return findings;
}
