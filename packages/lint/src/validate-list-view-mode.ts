// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail for ADR-0047 list-view navigation modes.
//
// A pure `(stack) => Finding[]` rule (ADR-0019), run from `os validate` and
// reusable by AI authoring. It catches the "wrong context" authoring mistake
// the type system alone cannot surface at author time on an object list view
// ("views" mode — where the ViewTabBar owns the tab-bar role):
//   - `quickFilters` — never valid on an object list view;
//   - `userFilters` with `element: 'tabs'` (or carrying `tabs`) — the tab-bar
//     preset style is page-only; it would collide with the ViewTabBar.
// A `dropdown` (value-chip) `userFilters` IS allowed on object views since the
// ADR-0047 amendment (framework #2679 / objectui #2338) and is NOT flagged.
//
// Registered `input: 'normalized'` — which means "needs no PARSED stack", so
// `os lint` (which never parses) can run it and its findings survive an
// unrelated schema error that would stop the parse.
//
// ## It is NOT the last line of defence any more (#6073)
//
// This header used to say the schema "strips a `tabs` user-filter at runtime
// (no throw, back-compat)" and that a post-parse stack would therefore have
// lost the evidence. Measured false at #6073: since #4001 `ObjectListViewSchema`
// is strict and refuses `quickFilters` BY NAME (with the
// `quickFilters` → `userFilters` suggestion), and `ObjectUserFiltersSchema`
// refuses `element: 'tabs'` by enum ("Expected one of: dropdown, toggle").
// `defineStack` throws on both, so a TS config carrying either never loads —
// `os lint` and `os validate` report the schema's message, not this rule's.
//
// The rule still earns its place on the doors the strict parse never sees:
// `os lint` on a raw object-literal config (measured: it names
// `list-view-filters-in-views-mode` twice where `os validate` stops at the
// schema step), `defineStack(x, { strict: false })`, and direct API callers.
// tsc rejects it at author time on top of all of that. See objectui #2338 and
// ADR-0047.

export type ListViewModeSeverity = 'error' | 'warning';

export interface ListViewModeFinding {
  severity: ListViewModeSeverity;
  rule: string;
  /** Human-readable location, e.g. `object "task" › listViews.my_pending`. */
  where: string;
  /** Config path, e.g. `objects[0].listViews.my_pending.userFilters`. */
  path: string;
  message: string;
  hint: string;
}

// Rule id (registry entry).
export const LIST_VIEW_FILTERS_IN_VIEWS_MODE = 'list-view-filters-in-views-mode';

type AnyRec = Record<string, unknown>;

/** Coerce an array-or-name-keyed-map collection to an array (name injected). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({
      name,
      ...(def as AnyRec),
    }));
  }
  return [];
}

/** Emit a finding for each wrong-context filter control on a single list-view def. */
function scanView(
  view: unknown,
  where: string,
  path: string,
  out: ListViewModeFinding[],
): void {
  if (!view || typeof view !== 'object') return;
  const rec = view as AnyRec;

  // `quickFilters` is never valid on an object list view.
  if (rec.quickFilters != null) {
    out.push({
      severity: 'error',
      rule: LIST_VIEW_FILTERS_IN_VIEWS_MODE,
      where,
      path: `${path}.quickFilters`,
      message:
        '`quickFilters` is a page filters-mode control and is ignored on an object ' +
        'list view ("views" mode) — the ViewTabBar owns nav here.',
      hint:
        'Move `quickFilters` to a page list (InterfaceListPage, "filters" mode), or ' +
        'remove it. See ADR-0047.',
    });
  }

  // `userFilters` is allowed on object views ONLY as `dropdown` (value chips).
  // The `tabs` preset style — or any `userFilters` carrying `tabs` — collides
  // with the ViewTabBar and stays page-only.
  const uf = rec.userFilters;
  if (uf && typeof uf === 'object') {
    const ufRec = uf as AnyRec;
    if (ufRec.element === 'tabs' || ufRec.tabs != null) {
      out.push({
        severity: 'error',
        rule: LIST_VIEW_FILTERS_IN_VIEWS_MODE,
        where,
        path: `${path}.userFilters`,
        message:
          '`userFilters` with `element: "tabs"` is page-only and is ignored on an ' +
          'object list view ("views" mode) — it would collide with the ViewTabBar.',
        hint:
          'Use `listViews` for named presets on an object (each becomes a segmented ' +
          'tab), switch to `element: "dropdown"` for value chips, or move the `tabs` ' +
          'filter to a page list (InterfaceListPage, "filters" mode). See ADR-0047.',
      });
    }
  }
}

/** Scan a `listViews` record (name → list-view def). */
function scanListViews(
  listViews: unknown,
  wherePrefix: string,
  pathPrefix: string,
  out: ListViewModeFinding[],
): void {
  if (!listViews || typeof listViews !== 'object') return;
  for (const [name, view] of Object.entries(listViews as AnyRec)) {
    scanView(
      view,
      `${wherePrefix} › listViews.${name}`,
      `${pathPrefix}.listViews.${name}`,
      out,
    );
  }
}

/**
 * Flag ADR-0047 "views" mode violations on an object's built-in named views or a
 * `defineView` default `list` / named `listViews`: `quickFilters`, or a `tabs`
 * `userFilters`. A `dropdown` `userFilters` is allowed and not flagged. Returns
 * the list of findings (empty = clean). Caller decides how to surface / whether
 * to fail the build.
 *
 * Feed the PRE-parse stack (normalizeStackInput output) — see file header.
 */
export function validateListViewMode(stack: AnyRec): ListViewModeFinding[] {
  const out: ListViewModeFinding[] = [];

  // Object built-in named views (object.zod.ts `listViews`).
  asArray(stack.objects).forEach((obj, i) => {
    const label = typeof obj.name === 'string' ? `object "${obj.name}"` : `objects[${i}]`;
    scanListViews(obj.listViews, label, `objects[${i}]`, out);
  });

  // `defineView` aggregates (stack `views`: default `list` + named `listViews`).
  asArray(stack.views).forEach((view, i) => {
    const named =
      typeof view.objectName === 'string'
        ? view.objectName
        : typeof view.name === 'string'
          ? view.name
          : undefined;
    const label = named ? `view "${named}"` : `views[${i}]`;
    scanView(view.list, `${label} › list`, `views[${i}].list`, out);
    scanListViews(view.listViews, label, `views[${i}]`, out);
  });

  return out;
}
