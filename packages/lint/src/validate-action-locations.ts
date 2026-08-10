// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0078 Phase 3 — Tier-A `action-locations`] An action nobody placed.
 *
 * `locations` is an action's placement declaration. An action that omits it —
 * and that no view names in `bulkActions` / `bulkActionDefs` / `rowActions` —
 * has no surface at all: it parses, it publishes, Setup lists it, and no user
 * can ever click it. ADR-0078 names this shape in its opening paragraph ("a
 * `summary` with no `summaryOperations`; **an `action` with no `locations`**;
 * … Each parses, 'renders', reports success — and does nothing") and Phase 3
 * asks for exactly this rule, one verified shape at a time.
 *
 * The renderer half is now unambiguous: objectui#3142 collapsed four
 * disagreeing renderers onto one predicate — an action renders at a location
 * only if it DECLARES that location. Before that, `action:bar` and the record
 * header showed an undeclared action *everywhere*, which is what made this
 * shape look alive; it is measurably inert as of objectui 17.1.
 *
 * ## What is NOT flagged, and why
 *
 * **`locations: []` — a deliberate headless action.** `content/docs/ui/
 * actions.mdx` ("Headless actions: declare it, then hide it") documents the
 * empty array as a first-class shape: the action stays callable over REST /
 * MCP / AI and keeps its capability gate, param contract and audit trail,
 * while claiming no UI surface. ADR-0110 D3 refuses an *undeclared* handler,
 * so a headless declaration is the only legal way to expose such an action —
 * flagging it would fight that ADR. The distinction this rule draws is
 * therefore between an author who said "nowhere, deliberately" (`[]`) and one
 * who never said anything at all (key absent).
 *
 * **Actions a view places by NAME.** Naming an action in a list view's
 * `bulkActions` or `bulkActionDefs` IS its placement — the selection bar is
 * driven by the view, never by `locations` (that is what the retired
 * `action.bulkEnabled` tombstone prescribes, and what objectui#3139's
 * aggregate bulk mode relies on: an action that only makes sense over a
 * selection has no single-record location by construction). `rowActions` is
 * exempted on the same zero-false-positive posture (ADR-0072 D1): it is the
 * same field pair on the same container, and an author who named an action
 * there has stated an intent — a name that resolves to nothing is already
 * `action-name-undefined`'s job, not this rule's.
 *
 * Scope note: this rule asks only "did anyone place this action?". It
 * deliberately does NOT check that a declared location is one a renderer
 * actually serves, nor that a view's named action belongs to that view's
 * object — distinct classes with their own rules. Cross-package placement (a
 * view in another installed package naming this action) is the one legitimate
 * miss, which is why this is a **warning**: like every other "declared but
 * does nothing" finding in this package (`validateSemanticRoles`,
 * `lintLivenessProperties`), it is high-signal and never fatal.
 */

export const ACTION_NO_PLACEMENT = 'action-no-placement';

export type ActionLocationsSeverity = 'error' | 'warning';

export interface ActionLocationsFinding {
  /** Always `warning` — cross-package placement is a legitimate miss. */
  severity: ActionLocationsSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `action "crm_convert_lead"`. */
  where: string;
  /** Config path, e.g. `actions[2]` or `objects[0].actions[1]`. */
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

/**
 * Every action name a view places by NAME, across all three list-view tiers:
 * `views[i].list`, `views[i].listViews.<key>`, and the object-embedded
 * `objects[i].listViews.<key>` (an object has no top-level `list`). Missing
 * the object-embedded tier would flag actions that an object's own view
 * places — the trap `validate-list-view-mode.ts` already walks around.
 */
function collectNamePlacedActions(stack: AnyRec): Set<string> {
  const placed = new Set<string>();

  const harvest = (container: unknown): void => {
    if (!container || typeof container !== 'object') return;
    const list = container as AnyRec;
    for (const key of ['rowActions', 'bulkActions'] as const) {
      for (const n of strList(list[key])) placed.add(n);
    }
    // A `bulkActionDefs` entry is a loose record; its `name` is the action it
    // dispatches. Inline field-patch defs (`operation: 'update'`) carry a name
    // that matches no action — harmless here, since an unmatched name simply
    // never exempts anything.
    for (const def of asArray(list.bulkActionDefs)) {
      const n = strName(def?.name);
      if (n) placed.add(n);
    }
  };

  const harvestListViews = (listViews: unknown): void => {
    if (!listViews || typeof listViews !== 'object' || Array.isArray(listViews)) return;
    for (const lv of Object.values(listViews as AnyRec)) harvest(lv);
  };

  for (const view of asArray(stack.views)) {
    if (!view || typeof view !== 'object') continue;
    harvest(view.list);
    harvestListViews(view.listViews);
  }
  for (const obj of asArray(stack.objects)) {
    if (!obj || typeof obj !== 'object') continue;
    harvestListViews(obj.listViews);
  }

  return placed;
}

/**
 * Flag every action that declares no placement and that no view places by
 * name. Returns findings (empty = clean).
 */
export function validateActionLocations(stack: AnyRec): ActionLocationsFinding[] {
  const findings: ActionLocationsFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const namePlaced = collectNamePlacedActions(stack);

  const check = (action: AnyRec | undefined, path: string): void => {
    if (!action || typeof action !== 'object') return;
    // `[]` is the documented headless shape — the author said "nowhere" on
    // purpose. Only a MISSING key is unstated placement.
    if ('locations' in action) return;
    const name = strName(action.name);
    if (!name) return; // nameless actions are `action-name-*`'s problem
    if (namePlaced.has(name)) return;

    findings.push({
      severity: 'warning',
      rule: ACTION_NO_PLACEMENT,
      where: `action "${name}"`,
      path,
      message:
        `Action "${name}" declares no \`locations\` and no view places it by name, ` +
        'so it renders on no surface — the button exists in metadata and nowhere in the UI.',
      hint:
        'Add the surface it belongs on, e.g. `locations: [\'record_header\']` (or `list_item`, ' +
        '`list_toolbar`, `record_more`, `record_section`, `record_related`); or ' +
        "place it from a list view's `bulkActions` / `bulkActionDefs` if it acts on a selection. " +
        'If it is meant to be callable over REST / MCP / AI with no UI surface, say so explicitly ' +
        'with `locations: []` — an empty array is the documented headless shape and is never flagged.',
    });
  };

  const actions = asArray(stack.actions);
  for (let i = 0; i < actions.length; i++) check(actions[i], `actions[${i}]`);

  const objects = asArray(stack.objects);
  for (let oi = 0; oi < objects.length; oi++) {
    const obj = objects[oi];
    if (!obj || typeof obj !== 'object') continue;
    const own = asArray(obj.actions);
    for (let ai = 0; ai < own.length; ai++) check(own[ai], `objects[${oi}].actions[${ai}]`);
  }

  return findings;
}
