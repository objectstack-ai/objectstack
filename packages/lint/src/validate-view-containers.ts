// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail for the `defineView` container shape.
//
// A pure `(stack) => Finding[]` rule (ADR-0019), run from `os validate`. It
// catches the container that registers ZERO views: `ViewSchema` is a container
// (`{ list, form, listViews, formViews }`) whose slots are all optional, so a
// container with none of them set is schema-valid, the loader finds nothing to
// expand, and the Console silently renders no view (no switcher entry). The
// third-party 15.1 evaluation hit exactly this via the old docs.
//
// ## The flat-list-view arm is now the SCHEMA's verdict, not this rule's (#6073)
//
// This header used to say `ViewSchema` "strips unknown keys — so a flat list
// view (`{ name: 'all_tasks', label, type: 'grid', columns: [...] }`) parses to
// an EMPTY container", and that the rule therefore had to run pre-parse.
// Measured false at #6073: `ViewSchema` went `.strict()` at #4001. `defineStack`
// now THROWS on that shape, naming `type` / `data` / `columns` and printing the
// wrap-it-in-defineView fix; `os lint` and `os validate` on an example app
// carrying it both refuse the config at LOAD, before any rule runs. `defineView`
// refuses it a step earlier still (`view.zod.ts:1951`, viewCount === 0).
//
// So `input: 'normalized'` in the registry means "this rule needs no PARSED
// stack" — which is what lets `os lint` (which never parses) run it, and what
// keeps its findings alive when an unrelated schema error stops the parse. It
// does NOT mean the rule is the only thing standing between the author and the
// flat-view mistake; the schema is, and it says it better.
//
// The `looksFlat` branch below is kept deliberately: it still fires on the
// non-`defineStack` doors the strict parse never sees — `os lint` on a raw
// object-literal config (measured: reports `view-container-shape` where
// `os validate` stops at the schema step), `defineStack(x, { strict: false })`,
// and direct API callers.
//
// ## Independent ViewItems are NOT legal `views: []` entries any more (#5320)
//
// This header used to say a ViewItem (`viewKind` + `config`) "is registered
// as-is by the loader" and skip it. That was a description of the runtime
// loop's UNDECLARED wider acceptance — the exact "runtime wider than schema"
// hole #5320 records — not of the declared contract, which was always
// container-only (`stack.zod.ts`, `z.array(ViewSchema)`). The 2026-08-12 fork
// ruling tightened the loop to the declared contract, so this rule's verdict
// aligns: a `viewKind`-bearing entry in `views:` is now an ERROR with the same
// wrap-it prescription the schema and the loop carry. Standalone views are
// authored through the metadata door; runtime-ASSEMBLED manifests carry
// non-container view artifacts under the machine-only `viewItems:` channel
// (`ui/assembled-views.zod.ts`), which this rule flags when hand-authored —
// the schema refuses it too, but `os lint` never parses, so the pre-parse
// door needs its own voice.

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

  // [#5320] `viewItems:` is the machine-assembled channel, never an authoring
  // surface — the stack schema types it `never`, and this pre-parse door says
  // the same thing to `os lint` callers the parse never reaches.
  const viewItems = (stack as AnyRec).viewItems;
  if (viewItems != null && asEntries(viewItems).length > 0) {
    out.push({
      severity: 'error',
      rule: VIEW_CONTAINER_SHAPE,
      where: 'viewItems',
      path: 'viewItems',
      message:
        '`viewItems` is the machine-assembled channel for non-container view artifacts in '
        + 'runtime-assembled manifests (package export, environment artifacts) — it is not an '
        + 'authoring surface.',
      hint: 'Author views as defineView containers in `views:`; author a standalone view through '
        + 'the metadata door (Studio / `PUT /api/v1/meta/view`), not in stack source.',
    });
  }

  for (const { key, value } of asEntries((stack as AnyRec).views)) {
    // Non-object entries are the schema step's problem, not this rule's.
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rec = value as AnyRec;

    // [#5320] Independent ViewItem (`viewKind` discriminator) in `views:` —
    // refused by the schema AND (since the tighten) by the registration loop;
    // this rule now reaches the same verdict pre-parse, prescription included.
    if (rec.viewKind != null) {
      const label = typeof rec.name === 'string' ? ` ("${rec.name}")` : '';
      out.push({
        severity: 'error',
        rule: VIEW_CONTAINER_SHAPE,
        where: `views${key}${label}`,
        path: `views${key}`,
        message:
          'A ViewItem record is not a view container: the stack `views:` collection carries '
          + 'containers only — `viewKind` belongs to a single VIEW, not to the container. The '
          + 'registration loop refuses this entry (#5320).',
        hint: 'Wrap it in a defineView container: defineView({ list: { type, data, columns, ... }, '
          + 'listViews: { ... } }) — or author the standalone view through the metadata door '
          + '(Studio / `PUT /api/v1/meta/view`). Machine-assembled manifests carry it under '
          + '`viewItems:`.',
      });
      continue;
    }

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
