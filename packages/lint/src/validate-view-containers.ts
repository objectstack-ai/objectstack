// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail for the `defineView` container shape.
//
// A pure `(stack) => Finding[]` rule (ADR-0019), run from `os validate`. It
// catches the "flat view object" authoring mistake the schema alone cannot
// surface: `ViewSchema` is a container (`{ list, form, listViews, formViews }`)
// whose slots are all optional, and Zod strips unknown keys — so a flat list
// view (`{ name: 'all_tasks', label, type: 'grid', columns: [...] }`) parses
// to an EMPTY container. The stack validates, the loader finds nothing to
// expand, and the Console silently renders no view (no switcher entry). The
// third-party 15.1 evaluation hit exactly this via the old docs.
//
// Runs PRE-parse (on the normalizeStackInput output, before the
// ObjectStackDefinition parse): post-parse the flat keys are already stripped
// and the mistake is indistinguishable from an intentionally empty container.
//
// Independent ViewItems (`viewKind` + `config`) are legal `views: []` entries
// (the loader registers them as-is) and are not flagged.

export type ViewContainerSeverity = 'error' | 'warning';

export interface ViewContainerFinding {
  severity: ViewContainerSeverity;
  rule: string;
  /** Human-readable location, e.g. `views[0] ("all_tasks")`. */
  where: string;
  /** Config path, e.g. `views[0]`. */
  path: string;
  message: string;
  hint: string;
}

// Rule id (registry entry).
export const VIEW_CONTAINER_SHAPE = 'view-container-shape';

type AnyRec = Record<string, unknown>;

const CONTAINER_SLOT_KEYS = ['list', 'form', 'listViews', 'formViews'] as const;

/** Coerce an array-or-name-keyed-map collection to indexed entries. */
function asEntries(v: unknown): Array<{ key: string; value: unknown }> {
  if (Array.isArray(v)) return v.map((value, i) => ({ key: `[${i}]`, value }));
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, value]) => ({ key: `.${name}`, value }));
  }
  return [];
}

/** Number of views a parsed-or-raw container actually carries. */
function containerViewCount(rec: AnyRec): number {
  const named = (slot: unknown): number =>
    slot && typeof slot === 'object' && !Array.isArray(slot) ? Object.keys(slot as AnyRec).length : 0;
  return (rec.list ? 1 : 0) + (rec.form ? 1 : 0) + named(rec.listViews) + named(rec.formViews);
}

/**
 * Validate that every stack-level `views` entry is a real view container (or
 * an independent ViewItem). Flat list-view objects and view-less containers
 * are reported as errors with a wrap-it fix hint.
 */
export function validateViewContainers(stack: Record<string, unknown>): ViewContainerFinding[] {
  const out: ViewContainerFinding[] = [];
  if (!stack || typeof stack !== 'object') return out;

  for (const { key, value } of asEntries((stack as AnyRec).views)) {
    // Non-object entries are the schema step's problem, not this rule's.
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rec = value as AnyRec;

    // Independent ViewItem (`viewKind` discriminator) — registered as-is.
    if (rec.viewKind != null) continue;

    if (containerViewCount(rec) > 0) continue;

    const label = typeof rec.name === 'string' ? ` ("${rec.name}")` : '';
    const hasContainerSlot = CONTAINER_SLOT_KEYS.some((k) => k in rec);
    // Flat list-view fingerprint: view-ish keys at the top level where the
    // container slots should be.
    const looksFlat = !hasContainerSlot
      && ['type', 'columns', 'data', 'filter', 'sort'].some((k) => k in rec);

    out.push({
      severity: 'error',
      rule: VIEW_CONTAINER_SHAPE,
      where: `views${key}${label}`,
      path: `views${key}`,
      message: looksFlat
        ? 'Flat list-view object is not a view container: `ViewSchema` strips its keys, '
          + 'so it parses to an EMPTY container — zero views register and the Console '
          + 'renders no view for it.'
        : 'View container defines no views — all of `list` / `form` / `listViews` / '
          + '`formViews` are absent or empty, so nothing registers.',
      hint: 'Wrap every view in a defineView container: defineView({ list: { type, data, '
        + 'columns, ... }, listViews: { ... }, formViews: { ... } }). See '
        + 'examples/app-showcase/src/ui/views/task.view.ts.',
    });
  }

  return out;
}
