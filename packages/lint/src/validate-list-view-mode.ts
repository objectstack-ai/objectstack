// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail for ADR-0053 list-view navigation modes.
//
// A pure `(stack) => Finding[]` rule (ADR-0019), run from `os validate` and
// reusable by AI authoring. It catches the "wrong context" authoring mistake
// the type system alone cannot surface at author time: `userFilters` /
// `quickFilters` placed on an object list view ("views" mode — where the
// ViewTabBar is the only nav control), where they are silently dropped. Those
// controls belong to a page list (InterfaceListPage, "filters" mode) only.
//
// Runs PRE-parse (on the normalizeStackInput output, before the
// ObjectStackDefinition parse): the object-list schema (ObjectListViewSchema)
// OMITS `userFilters`, so a post-parse stack has already had the field
// stripped and this rule would never see it. The layering is deliberate —
// tsc rejects it at author time, the schema strips it at runtime (no throw,
// back-compat), and this rule reports it at `os validate` with a fix hint.
// See objectui #2219 / #2220 and ADR-0053 phase 4.

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

/** Page filters-mode controls that must not appear on an object list view. */
const FORBIDDEN_FIELDS = ['userFilters', 'quickFilters'] as const;

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

/** Emit a finding for each forbidden field present on a single list-view def. */
function scanView(
  view: unknown,
  where: string,
  path: string,
  out: ListViewModeFinding[],
): void {
  if (!view || typeof view !== 'object') return;
  const rec = view as AnyRec;
  for (const field of FORBIDDEN_FIELDS) {
    if (rec[field] == null) continue;
    out.push({
      severity: 'error',
      rule: LIST_VIEW_FILTERS_IN_VIEWS_MODE,
      where,
      path: `${path}.${field}`,
      message:
        `\`${field}\` is a page filters-mode control and is ignored on an object ` +
        `list view ("views" mode) — the ViewTabBar is the only nav control here.`,
      hint:
        `Move \`${field}\` to a page list (InterfaceListPage, "filters" mode), or ` +
        `remove it. See ADR-0053.`,
    });
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
 * Flag ADR-0053 "views" mode violations: `userFilters` / `quickFilters` on an
 * object's built-in named views or a `defineView` default `list` / named
 * `listViews`. Returns the list of findings (empty = clean). Caller decides how
 * to surface / whether to fail the build.
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
