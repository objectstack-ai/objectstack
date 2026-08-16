// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0049 — references] Reference-integrity for dashboard header action
 * targets (issue #3367).
 *
 * ADR-0049 established the "enforce-or-remove" gate for spec *properties*: a
 * declared property the runtime does not honour is a false promise and must be
 * enforced, marked experimental, or removed. This rule applies the SAME honesty
 * principle to *references*. A dashboard header action names a target — a
 * `script`/`modal` action, or a `url` route — that must actually resolve. A
 * dangling target ships a button that renders and, on click, silently does
 * nothing: a false affordance, exactly the failure ADR-0049 exists to prevent,
 * just for a reference rather than a property.
 *
 * Nothing in the protocol schema can express this: `actionUrl` is a free string,
 * so `{ actionType: 'script', actionUrl: 'export_dashboard_pdf' }` parses and
 * ships even when no such action is defined anywhere in the stack.
 *
 * Surfaces checked:
 *   - dashboard `header.actions[]` — each `{ actionType, actionUrl }`
 *
 * ## The widget branch, and why it is gone (#5010)
 *
 * This rule used to check `widgets[].actionUrl` too, describing it as "the
 * per-widget button" and claiming in this docblock that it "mirrors the objectui
 * runtime dispatch". It did not: no renderer in either repo has ever drawn a
 * per-widget action button — all 14 `actionUrl` reads in `DashboardRenderer` are
 * scoped to `header.actions[]`. So the strictest arm of this rule (a dangling
 * `script`/`modal` target is an ERROR, i.e. a failed build) was enforcing
 * referential integrity for a button that could not render. An author could be
 * blocked from shipping because a control that does not exist pointed at an
 * action that also did not.
 *
 * That inversion — a rule written to delete false affordances, itself sustaining
 * one — is why the widget keys were retired rather than the check merely
 * relaxed: `widgets[].actionUrl` / `actionType` / `actionIcon` are now tombstoned
 * in `@objectstack/spec` 17.0.0, so authoring one is a `tsc` error and a parse
 * error carrying the prescription. There is no widget target left to resolve.
 *
 * Resolution mirrors the objectui runtime dispatch (`DashboardRenderer`
 * hands the target to the SHARED `useActionModal` since objectui#4782) so the
 * lint flags exactly what would fail to resolve at runtime:
 *
 *   actionType 'script' → `actionUrl` must name a DEFINED action (`stack.actions`
 *       or any `object.actions`, by `name`). A script target that names no
 *       defined action fails open at runtime ("action not found"). → ERROR.
 *
 *   actionType 'modal'  → `actionUrl` names a declared PAGE (`stack.pages`), and
 *       only a page — maintainer ruling objectstack#6739-A (2026-08-09). This
 *       rule used to accept a defined action name, a bare object name, and the
 *       `<verb>_<object>` convention (create_/new_/add_/edit_/update_ + object),
 *       on the claim that it mirrored `DashboardView`'s own modal handler. That
 *       handler — the convention's last live copy — was deleted by objectui#4782
 *       (after objectui#4764 retired the object fallback in `useActionModal`):
 *       the runtime resolves a string modal target against page metadata and
 *       REFUSES everything else, so each retired limb here blessed a button that
 *       dispatches to a named refusal at runtime. The ruling explicitly declined
 *       the middle shape (keep the prefix, reject bare object names): a target
 *       names the page `create_opportunity`, or it names nothing. Opening an
 *       object's form is `actionType: 'form'`. Otherwise → ERROR.
 *
 *   actionType 'url'    → a relative in-app path. WARN when a recognizable
 *       `<collection>/<name>` segment (objects/reports/dashboards/pages/views)
 *       names an entity that does not exist in this stack. External URLs
 *       (`http(s)://`, `//`), interpolated targets (`${…}`), and opaque routes
 *       (no recognized collection segment) are skipped — they cannot be resolved
 *       statically and may be host/app/plugin routes. → WARNING.
 *
 *   actionType 'flow' | 'api' — not checked: flow targets resolve against the
 *       automation engine / other packages, and api targets are opaque endpoints.
 *       Out of scope for #3367.
 *
 * Severity split follows the issue's acceptance criteria: an undefined
 * `script`/`modal` target FAILS validation (a genuine dead reference that fails
 * open at runtime as a dead button); an unresolved `url` route is advisory
 * (route resolution is app-context-dependent, and a path may be served by
 * another installed package or a host/console route). External, interpolated,
 * convention, and opaque targets are exempted to keep false positives near zero
 * — the same conservative posture as the sibling `lint-view-refs` and
 * `validate-capability-references` rules.
 */

export const DASHBOARD_ACTION_TARGET_UNDEFINED = 'dashboard-action-target-undefined';
export const DASHBOARD_ACTION_ROUTE_UNRESOLVED = 'dashboard-action-route-unresolved';

export type DashboardActionRefSeverity = 'error' | 'warning';

export interface DashboardActionRefFinding {
  /** `error` for a dangling script/modal action; `warning` for an unresolved url route. */
  severity: DashboardActionRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `dashboard "sales_overview" · header action "Export PDF"`. */
  where: string;
  /** Config path, e.g. `dashboards[2].header.actions[0].actionUrl`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** Coerce a collection (array or name-keyed map) to an array of records, injecting
 *  `name` from the map key — mirrors the helper in the sibling authoring lints so
 *  the rule works on both the parsed (array) and normalized (map) stack shapes. */
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

/** URL path segments that name a metadata collection, mapped to the stack key
 *  whose members can appear after them in an in-app route
 *  (`/…/objects/crm_lead`, `/reports/forecast`, `/dashboards/exec`, …). Both the
 *  singular and plural spellings are accepted. */
const URL_COLLECTION_TO_STACK_KEY: Record<string, 'objects' | 'reports' | 'dashboards' | 'pages' | 'views'> = {
  object: 'objects',
  objects: 'objects',
  report: 'reports',
  reports: 'reports',
  dashboard: 'dashboards',
  dashboards: 'dashboards',
  page: 'pages',
  pages: 'pages',
  view: 'views',
  views: 'views',
};

/** Derive the name a top-level `views` container registers under (mirrors the
 *  runtime loader's `resolveMetadataItemName('views', …)` fallbacks). */
function viewContainerName(item: AnyRec): string | undefined {
  return (
    strName(item.name) ??
    strName(item.id) ??
    strName(item.object) ??
    strName((item.list as AnyRec | undefined)?.data && ((item.list as AnyRec).data as AnyRec).object) ??
    strName((item.form as AnyRec | undefined)?.data && ((item.form as AnyRec).data as AnyRec).object)
  );
}

interface KnownTargets {
  /** Every action name defined in the stack (global + object-embedded). */
  actions: Set<string>;
  /** Object names (valid in `objects/<name>` routes). */
  objects: Set<string>;
  reports: Set<string>;
  dashboards: Set<string>;
  pages: Set<string>;
  /** View names routable as `views/<name>` — container names plus object names. */
  views: Set<string>;
}

/** Build the author-time "known target" sets from a stack. */
function collectKnownTargets(stack: AnyRec): KnownTargets {
  const actions = new Set<string>();
  const objects = new Set<string>();
  const reports = new Set<string>();
  const dashboards = new Set<string>();
  const pages = new Set<string>();
  const views = new Set<string>();

  const collectNames = (v: unknown, into: Set<string>, name: (rec: AnyRec) => string | undefined) => {
    for (const item of asArray(v)) {
      if (!item || typeof item !== 'object') continue;
      const n = name(item);
      if (n) into.add(n);
    }
  };

  collectNames(stack.actions, actions, (a) => strName(a.name));
  for (const obj of asArray(stack.objects)) {
    if (!obj || typeof obj !== 'object') continue;
    const n = strName(obj.name);
    if (n) objects.add(n);
    collectNames(obj.actions, actions, (a) => strName(a.name));
  }
  collectNames(stack.reports, reports, (r) => strName(r.name));
  collectNames(stack.dashboards, dashboards, (d) => strName(d.name));
  collectNames(stack.pages, pages, (p) => strName(p.name));
  collectNames(stack.views, views, viewContainerName);
  // An object's default view is routable by the object's own name too.
  for (const o of objects) views.add(o);

  return { actions, objects, reports, dashboards, pages, views };
}

/** Does a `script`/`modal` `actionUrl` resolve? */
function resolveActionTarget(
  actionType: 'script' | 'modal',
  target: string,
  known: KnownTargets,
): boolean {
  if (actionType === 'modal') {
    // A modal string target names a declared PAGE, and only a page
    // (objectstack#6739-A). The runtime resolves it against page metadata and
    // refuses everything else — a defined action name, a bare object name, and
    // the retired `<verb>_<object>` prefix convention all dispatch to a named
    // refusal, so accepting any of them here blesses a dead button.
    return known.pages.has(target);
  }
  return known.actions.has(target);
}

/**
 * Resolve a relative `url` in-app route. Returns:
 *   - `null` when the target is not statically resolvable (external, interpolated,
 *     or carries no recognized `<collection>/<name>` segment) — SKIP, no finding.
 *   - `{ collection, name }` for a recognized `<collection>/<name>` pair that does
 *     NOT exist in the stack — WARN.
 *   - `undefined` when a recognized pair DID resolve — OK, no finding.
 */
function resolveUrlRoute(
  target: string,
  known: KnownTargets,
): { collection: string; name: string } | null | undefined {
  // External / protocol-relative — leaves the app; not an in-app route.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith('//')) return null;
  // Interpolated — resolved by the renderer at click time, not statically known.
  if (target.includes('${')) return null;
  // Only relative in-app paths are considered.
  if (!target.startsWith('/')) return null;

  // Strip query + hash, then split into non-empty segments.
  const pathPart = target.split(/[?#]/, 1)[0];
  const segments = pathPart.split('/').filter(Boolean);

  for (let i = 0; i < segments.length - 1; i++) {
    const stackKey = URL_COLLECTION_TO_STACK_KEY[segments[i]];
    if (!stackKey) continue;
    const name = segments[i + 1];
    if (known[stackKey].has(name)) return undefined; // resolved
    return { collection: segments[i], name }; // recognized shape, unknown name
  }
  return null; // no recognized collection segment — opaque route, skip
}

interface HeaderAction {
  actionType?: string;
  actionUrl?: string;
  label?: string;
}

/**
 * Validate every dashboard header action reference in a stack. Returns
 * findings (empty = clean). `script`/`modal` dead targets are errors; `url`
 * unresolved routes are warnings.
 */
export function validateDashboardActionRefs(stack: AnyRec): DashboardActionRefFinding[] {
  const findings: DashboardActionRefFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const dashboards = asArray(stack.dashboards);
  if (dashboards.length === 0) return findings;

  const known = collectKnownTargets(stack);

  const checkOne = (
    action: HeaderAction,
    where: string,
    path: string,
  ) => {
    const target = strName(action.actionUrl);
    if (!target) return; // nothing referenced
    if (target.includes('${')) return; // dynamic target — not statically resolvable

    // Renderer default: a missing actionType is treated as a 'url' navigation
    // (DashboardRenderer builds header ActionDefs with `type: actionType || 'url'`).
    const actionType = strName(action.actionType) ?? 'url';

    if (actionType === 'script' || actionType === 'modal') {
      if (resolveActionTarget(actionType, target, known)) return;
      findings.push({
        severity: 'error',
        rule: DASHBOARD_ACTION_TARGET_UNDEFINED,
        where,
        path,
        message:
          actionType === 'modal'
            ? `modal action target "${target}" names no declared page — a modal target ` +
              `names a PAGE, only (objectstack#6739). The button renders but the runtime ` +
              `refuses the dispatch when clicked — a dangling reference ` +
              `(ADR-0049: a declared reference must resolve).`
            : `script action target "${target}" resolves to no defined action. ` +
              `The button renders but does nothing when clicked — a dangling reference ` +
              `the runtime cannot dispatch (ADR-0049: a declared reference must resolve).`,
        hint:
          actionType === 'modal'
            ? `Point actionUrl at a declared page (stack.pages), or use ` +
              `actionType: 'form' with an "<object>.<view>" form-view target to open ` +
              `an object's form, or remove the button.`
            : `Define a script action named "${target}" (stack.actions or the object's actions) ` +
              `with an inline body or a registered handler, or remove the button.`,
      });
      return;
    }

    if (actionType === 'url') {
      const route = resolveUrlRoute(target, known);
      if (!route) return; // skip (external/interpolated/opaque) or resolved
      findings.push({
        severity: 'warning',
        rule: DASHBOARD_ACTION_ROUTE_UNRESOLVED,
        where,
        path,
        message:
          `url action target "${target}" points at ${route.collection}/${route.name}, ` +
          `but no ${route.collection.replace(/s$/, '')} named "${route.name}" is registered ` +
          `in this stack — the button likely navigates to a dead route.`,
        hint:
          `Check the path for a typo, define the referenced ${route.collection.replace(/s$/, '')}, ` +
          `or ignore this if the route is served by another installed package or a host/console route.`,
      });
      return;
    }
    // 'flow' | 'api' | custom types are out of scope (see module header).
  };

  for (let di = 0; di < dashboards.length; di++) {
    const dash = dashboards[di];
    if (!dash || typeof dash !== 'object') continue;
    const dashName = strName(dash.name) ?? `(dashboard ${di})`;
    const dashPath = `dashboards[${di}]`;

    // Header actions.
    const headerActions = asArray((dash.header as AnyRec | undefined)?.actions);
    for (let ai = 0; ai < headerActions.length; ai++) {
      const action = headerActions[ai] as HeaderAction | null;
      if (!action || typeof action !== 'object') continue;
      const label = strName(action.label) ?? strName(action.actionUrl) ?? `#${ai}`;
      checkOne(
        action,
        `dashboard "${dashName}" · header action "${label}"`,
        `${dashPath}.header.actions[${ai}].actionUrl`,
      );
    }

    // Per-widget action buttons: NOT checked — they do not exist. See the
    // docblock (#5010). `widgets[].actionUrl` / `actionType` / `actionIcon` are
    // tombstoned in the spec as of 17.0.0, so a stack reaching this rule cannot
    // carry a widget target: the parse rejects it upstream with the
    // prescription. Re-adding a branch here would resurrect an ERROR-severity
    // gate over an affordance no renderer draws.
  }

  return findings;
}
