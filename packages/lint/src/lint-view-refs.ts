// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time lint for VIEW REFERENCES — closes the gap where a form action can
 * point at the wrong view and only fail at runtime (a blank/broken form, or a
 * silent no-op submit). This shifts objectui's runtime `viewKind` guard left to
 * the build, where the author — very often an AI generating templates —
 * discovers the mistake on `os compile` instead of when an end user clicks.
 *
 * Severity follows the broken/fragile split, tuned so upgrading does NOT break
 * existing apps that merely have a colliding key — only a high-confidence,
 * genuinely-broken reference fails the build:
 *
 *   view-ref-form-target-kind — ERROR (fails the build)
 *     A `type:'form'` action whose `target` resolves to an existing LIST view
 *     opens a blank form (and a submit can silently no-op) at runtime. This is
 *     the concrete #2554 breakage and is high-confidence, so it fails the build.
 *
 *   view-key-collision (#2554) — WARNING
 *     List and form views share one `<object>.<key>` namespace during expansion,
 *     and the default `list` implicitly claims `<object>.default`. A colliding
 *     key is renamed (`<object>.<key>` → `<object>.<key>_2`) so the registry key
 *     stays unique. The rename alone is only *fragile* — it breaks something only
 *     if that name is referenced — so it warns rather than failing the build.
 *
 *   view-ref-form-target-missing — WARNING
 *     A `type:'form'` target that resolves to no view is probably a typo, but it
 *     may also be a view this lint failed to collect (a non-standard container
 *     shape), so it warns rather than risk a false-positive build failure.
 *
 *   view-ref-nav-view-missing — ERROR (fails the build)
 *     An app navigation entry whose `viewName` resolves to no list view on its
 *     own object. See the section below — this is the SECOND door into the same
 *     `listViews` namespace the two rules above guard, and the more travelled one.
 *
 * Deliberately conservative to keep false positives near zero: only `type:'form'`
 * targets are checked (the one type that unambiguously names a form view),
 * interpolated targets (`${…}`) are skipped as non-static, and non-qualified
 * targets (no `.`) are treated as opaque handler/modal refs rather than view
 * references.
 *
 * ## The navigation door (`view-ref-nav-view-missing`)
 *
 * A form action target is one way to name a view; an app's navigation is the
 * other, and it is the one an end user travels every day. `ObjectNavItemSchema`
 * documents `viewName` as *"Default list view to open. Defaults to 'all'"* — so
 * an unresolvable name does not fail, it **falls back**. Measured end to end:
 * mutating a real app's `viewName` to a name nothing declares leaves
 * `os validate --json` reporting `valid: true`, and `os build` green.
 *
 * What the author gets instead is a nav entry that keeps its authored label and
 * icon and opens a different view — a "Schedule" entry that opens the plain
 * grid. The runtime does notice: objectui's `ObjectView` calls the shared
 * `resolveViewId` matcher and, on a miss, `console.warn`s and falls back to
 * `defaultViewId || views[0]`. A browser-console warning is not an author-time
 * signal, which is why the check belongs here. The decay mode is worse than the
 * typo mode: renaming a list view silently degrades every nav entry pointing at
 * it, with every gate green and the diff reading correctly in review.
 *
 * **Resolution mirrors the runtime matcher exactly** (`resolveViewId` in
 * objectui's `@object-ui/core`), all three directions: exact id, short name
 * retried as `<object>.<name>`, and qualified name retried with the
 * `<object>.` prefix stripped. Reimplementing a *stricter* match here would red
 * names that work at runtime; a looser one would bless names that do not. The
 * `'all'` of the schema's doc line is not magic in that matcher either — it
 * resolves only when the object actually declares it — so this rule does not
 * special-case it.
 *
 * ERROR rather than the sibling's WARNING, because the false-positive vector
 * that made `view-ref-form-target-missing` advisory is closed by construction
 * here: the rule fires only when it has already collected a NON-EMPTY list-view
 * namespace for that object out of this stack. If the object is absent, carries
 * `requiresObject` (an explicit "another package provides this"), or contributed
 * no list view this lint could expand, the entry is skipped rather than guessed
 * at. What remains outside its knowledge is a runtime-SAVED view (`savedViews`
 * in `ObjectView`), which no author-time pass over declared metadata can see —
 * the same boundary every rule in this suite has.
 */

import { expandViewContainerWithDiagnostics, isAggregatedViewContainer } from '@objectstack/spec';
import { listNames, suggestName } from './object-graph.js';

export interface ViewRefFinding {
  where: string;
  message: string;
  hint: string;
  rule: string;
  severity: 'error' | 'warning';
}

type AnyRec = Record<string, any>;

/** Normalise a record-or-map metadata slot into an array, injecting `name` from
 *  the map key (mirrors the helper in the sibling authoring lints). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  return [];
}

export const VIEW_KEY_COLLISION = 'view-key-collision';
export const VIEW_REF_FORM_TARGET_MISSING = 'view-ref-form-target-missing';
export const VIEW_REF_FORM_TARGET_KIND = 'view-ref-form-target-kind';
export const VIEW_REF_NAV_VIEW_MISSING = 'view-ref-nav-view-missing';

/**
 * An interpolated name resolves at render time — the same conservative
 * exemption `validate-nav-target-refs` and `validate-object-references` use to
 * keep false positives near zero (ADR-0072 D1).
 */
const isInterpolated = (s: string): boolean => s.includes('${') || s.includes('{');

/**
 * Resolve a requested view name against an object's actual view ids, in all
 * three directions objectui's `resolveViewId` accepts. Kept deliberately in
 * lock-step with that matcher (`@object-ui/core`, objectstack#2217): a name
 * this returns false for is a name the runtime falls back on.
 */
function resolvesViewId(requested: string, ids: ReadonlySet<string>, object: string): boolean {
  if (ids.has(requested)) return true;
  const prefix = `${object}.`;
  if (!requested.includes('.') && ids.has(prefix + requested)) return true;
  if (requested.startsWith(prefix) && ids.has(requested.slice(prefix.length))) return true;
  return false;
}

/** The short, author-facing spelling of an expanded view id (`task.mine` → `mine`). */
const shortViewName = (id: string, object: string): string =>
  id.startsWith(`${object}.`) ? id.slice(object.length + 1) : id;

/** Pull the view-container slots out of an object definition (ADR-0017 nested
 *  "Object has-many View"). Absent slots stay undefined — the expander ignores
 *  them. */
function containerFromObject(obj: AnyRec): AnyRec {
  return { list: obj.list, form: obj.form, listViews: obj.listViews, formViews: obj.formViews };
}

/** Derive the object a top-level `defineView` container binds to. A container
 *  has no top-level `name`/`object`, so — exactly like the runtime loader's
 *  `resolveMetadataItemName('views', …)` — fall back to its inner default
 *  `list`/`form` data source. Kept in lock-step with that resolver so the lint's
 *  expansion keys match the ones the engine actually registers. */
function viewContainerObjectName(item: AnyRec): string | undefined {
  if (typeof item.name === 'string' && item.name) return item.name;
  if (typeof item.id === 'string' && item.id) return item.id;
  if (typeof item.object === 'string' && item.object) return item.object;
  if (typeof item.list?.data?.object === 'string') return item.list.data.object;
  if (typeof item.form?.data?.object === 'string') return item.form.data.object;
  return undefined;
}

export function lintViewRefs(stack: AnyRec): ViewRefFinding[] {
  const findings: ViewRefFinding[] = [];

  // Expanded view name -> the kind(s) registered under it. A Set (not a scalar)
  // so the target check stays correct even if a list and a form ever share a
  // name — a form target is satisfied iff `form` is among the kinds.
  const viewKinds = new Map<string, Set<'list' | 'form'>>();
  const indexKind = (name: string, kind: 'list' | 'form') => {
    let s = viewKinds.get(name);
    if (!s) viewKinds.set(name, (s = new Set()));
    s.add(kind);
  };

  // Per-object view ids, split by kind — what a navigation `viewName` resolves
  // against. Kept beside `viewKinds` (which is keyed by expanded name alone)
  // because navigation names a view WITHIN one object's namespace, so the
  // owning object is part of the question.
  const listViewIds = new Map<string, Set<string>>();
  const formViewIds = new Map<string, Set<string>>();
  const indexForObject = (object: string, name: string, kind: 'list' | 'form') => {
    const m = kind === 'list' ? listViewIds : formViewIds;
    let s = m.get(object);
    if (!s) m.set(object, (s = new Set()));
    s.add(name);
  };

  /** The object an already-expanded, independent ViewItem binds to. */
  const independentViewObject = (v: AnyRec): string | undefined => {
    for (const c of [v.object, v.objectName, v.data?.object, v.list?.data?.object]) {
      if (typeof c === 'string' && c) return c;
    }
    return undefined;
  };

  // 1) Gather every aggregated container: top-level `views` + object-nested.
  const containers: Array<{ object: string; container: AnyRec }> = [];
  for (const v of asArray(stack.views)) {
    if (v.viewKind) {
      // Already an independent, expanded ViewItem — index it directly.
      const kind = v.viewKind === 'form' ? 'form' : 'list';
      if (typeof v.name === 'string') {
        indexKind(v.name, kind);
        const owner = independentViewObject(v);
        if (owner) indexForObject(owner, v.name, kind);
      }
      continue;
    }
    if (!isAggregatedViewContainer(v)) continue;
    const object = viewContainerObjectName(v);
    if (object) containers.push({ object, container: v });
  }
  for (const obj of asArray(stack.objects)) {
    const object = typeof obj.name === 'string' ? obj.name : undefined;
    if (!object) continue;
    if (obj.list || obj.form || obj.listViews || obj.formViews) {
      containers.push({ object, container: containerFromObject(obj) });
    }
  }

  // 2) Expand each container: index names + report every collision as an error.
  for (const { object, container } of containers) {
    const { items, collisions } = expandViewContainerWithDiagnostics(object, container);
    for (const it of items) {
      indexKind(it.name, it.viewKind);
      // Index under the item's OWN object (`it.object`), not the container's —
      // they are the same here, but the expander is the authority on which
      // object a produced item belongs to.
      indexForObject(it.object ?? object, it.name, it.viewKind);
    }
    for (const col of collisions) {
      findings.push({
        where: `object '${object}' · view key '${col.key}'`,
        message:
          `View key collision: the ${col.viewKind} view '${col.requested}' clashes with another view ` +
          `in the same container and was renamed to '${col.renamedTo}'. Anything referencing ` +
          `'${col.requested}' (a form action target, a navigation viewName) resolves to the OTHER view, not this one.`,
        hint:
          `Give the ${col.viewKind} view a unique key — the default list implicitly claims '<object>.default'. ` +
          `Renaming key '${col.key}' fixes both this collision and any reference that targets it.`,
        rule: VIEW_KEY_COLLISION,
        severity: 'warning',
      });
    }
  }

  // 3) Validate every `type:'form'` action target against the expanded view set.
  //    An action often appears BOTH top-level and nested under its object, so
  //    dedupe by (name, target): a shared action is reported once, not twice.
  const seenFormTargets = new Set<string>();
  const checkAction = (action: AnyRec, ownerObject?: string) => {
    if (!action || action.type !== 'form') return;
    const target = action.target;
    if (typeof target !== 'string' || !target) return;
    if (target.includes('${')) return; // dynamic interpolation — not statically resolvable
    if (!target.includes('.')) return; // non-qualified — treated as an opaque ref, not a view

    const actionName = typeof action.name === 'string' ? action.name : '(unnamed)';
    const dedupeKey = `${actionName}\u0000${target}`;
    if (seenFormTargets.has(dedupeKey)) return;
    seenFormTargets.add(dedupeKey);
    const where = ownerObject ? `action '${actionName}' on object '${ownerObject}'` : `action '${actionName}'`;

    const kinds = viewKinds.get(target);
    if (!kinds) {
      findings.push({
        where,
        message:
          `Form action target '${target}' does not resolve to any view. A type:'form' action must point at ` +
          `an existing form view; at runtime this opens a blank/broken form.`,
        hint: `Check for a typo, or a form view renamed by a key collision. Expected a form view named '<object>.<formViewKey>'.`,
        rule: VIEW_REF_FORM_TARGET_MISSING,
        severity: 'warning',
      });
      return;
    }
    if (!kinds.has('form')) {
      const actual = [...kinds].join('/');
      findings.push({
        where,
        message:
          `Form action target '${target}' resolves to a ${actual} view, not a form view. Opening a ${actual} ` +
          `view through a form action renders an empty form (and a submit can silently no-op) at runtime.`,
        hint:
          `Point target at a form view (viewKind 'form'). If the form view was renamed by a key collision, ` +
          `fix the colliding key so '${target}' names the form again.`,
        rule: VIEW_REF_FORM_TARGET_KIND,
        severity: 'error',
      });
    }
  };

  // Object-nested first so the retained (deduped) finding keeps object context.
  for (const obj of asArray(stack.objects)) {
    const object = typeof obj.name === 'string' ? obj.name : undefined;
    for (const action of asArray(obj.actions)) checkAction(action, object);
  }
  for (const action of asArray(stack.actions)) checkAction(action);

  // 4) Validate every app-navigation `viewName` against its object's list views.
  //    The second door into the same `listViews` namespace as (3) — see the
  //    header. An entry is reported only when this stack actually declares list
  //    views for the object it names.
  const seenNavRefs = new Set<string>();
  const checkNavItem = (nav: AnyRec, appName: string) => {
    const objectName = typeof nav.objectName === 'string' ? nav.objectName : undefined;
    const viewName = typeof nav.viewName === 'string' ? nav.viewName : undefined;
    if (!objectName || !viewName) return;
    if (isInterpolated(viewName)) return; // resolved at render time — not static

    // `recordId` navigates straight to a record; the schema documents
    // `viewName` as IGNORED in that combination (and `app.test.ts` pins the
    // legacy pairing as tolerated), so the reference is not live.
    if (typeof nav.recordId === 'string' && nav.recordId) return;

    // `requiresObject` is the author's explicit "another package provides this
    // object" opt-in — the same exemption `validate-object-references` and
    // `stack.zod.ts`'s nav cross-reference block honour. Its views are not in
    // this stack to resolve against.
    if (nav.requiresObject) return;

    // Nothing collected for this object: it may live in another package, or
    // carry a container shape this lint could not expand. Indistinguishable
    // from a typo, so say nothing rather than guess.
    const ids = listViewIds.get(objectName);
    if (!ids || ids.size === 0) return;

    if (resolvesViewId(viewName, ids, objectName)) return;

    const navId =
      (typeof nav.id === 'string' && nav.id) || (typeof nav.label === 'string' && nav.label) || '(unnamed)';
    const dedupeKey = `${appName} ${navId} ${objectName} ${viewName}`;
    if (seenNavRefs.has(dedupeKey)) return;
    seenNavRefs.add(dedupeKey);

    const available = [...ids].map((id) => shortViewName(id, objectName));
    const formIds = formViewIds.get(objectName);
    const isFormView = !!formIds && resolvesViewId(viewName, formIds, objectName);

    findings.push({
      where: `app '${appName}' · nav '${navId}'`,
      message:
        `Navigation entry opens view '${viewName}' on object '${objectName}', which declares no such ` +
        `list view. ` +
        (isFormView
          ? `The name resolves to a FORM view of that object, which the object's view switcher never offers. `
          : '') +
        `At runtime the name does not resolve and the entry falls back to the object's default view, ` +
        `keeping its authored label and icon — so the sidebar still reads correctly while opening the ` +
        `wrong view. List views on '${objectName}': ${listNames(available)}.`,
      hint:
        `Correct the name, declare '${viewName}' in the object's \`listViews\`, or drop \`viewName\` ` +
        `to open the default view.` +
        (isFormView
          ? ` A form view is reachable from a type:'form' action target, not from navigation.`
          : '') +
        suggestName(viewName, available),
      rule: VIEW_REF_NAV_VIEW_MISSING,
      severity: 'error',
    });
  };

  const walkNav = (items: unknown, appName: string) => {
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const nav = raw as AnyRec;
      checkNavItem(nav, appName);
      // NOT gated on `type === 'group'`: an `object` nav item carries
      // `children` too, and a targeted child nested under one would be skipped
      // — the same reason `stack.zod.ts` and `validate-nav-target-refs` recurse
      // unconditionally.
      if (Array.isArray(nav.children)) walkNav(nav.children, appName);
    }
  };

  for (const [ai, app] of asArray(stack.apps).entries()) {
    const appName = typeof app.name === 'string' && app.name ? app.name : `#${ai}`;
    walkNav(app.navigation, appName);
    // `areas[]` is the other nav container; it was once skipped wholesale in
    // `stack.zod.ts`, so an areas-based app got no nav validation at all.
    for (const area of asArray(app.areas)) {
      walkNav(area.items, appName);
      walkNav(area.navigation, appName);
    }
  }

  return findings;
}
