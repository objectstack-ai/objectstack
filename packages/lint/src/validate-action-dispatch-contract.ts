// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0049 — references] The bulk **dispatch contract** a list view wires an
 * action under, checked against the contract the action's body declares it was
 * written for (issue #17319; maintainer ruling, decision batch #121 item 3,
 * 2026-09-12).
 *
 * ## The gap this closes
 *
 * A list view can wire the same declared action two ways, and the two deliver
 * OPPOSITE input to the same body:
 *
 *  - `bulkActions: ['<name>']` — the bare-string form. The renderer promotes
 *    the action to a def and dispatches it **once per selected row**: each call
 *    carries that row's `recordId` and **no** `_selectedIds`.
 *  - a `bulkActionDefs` entry with `execution: 'aggregate'` — **one** dispatch
 *    for the whole selection: every id arrives in `params._selectedIds` and
 *    there is **no** `recordId`.
 *
 * Both mismatches used to fail quietly, in opposite directions: an aggregate
 * body wired bare-string reads `_selectedIds` as `undefined`, takes its
 * single-record branch, and reports success for one row out of ten; a
 * per-record body wired aggregate finds no `recordId` and throws its own
 * "nothing selected", which reads like a selection bug rather than a wiring
 * one.
 *
 * ## Why nothing else can catch it
 *
 * The ADR-0104 strict params gate is structurally blind here, and that is worth
 * stating precisely rather than assuming: `validateActionParams` admits every
 * member of `ACTION_PARAM_BUILTIN_KEYS` — `recordId`, `objectName`,
 * `_selectedIds` — without a declaration, and declaring one is refused by
 * construction. So the two bags the two wirings produce differ in exactly the
 * keys that gate is required to wave through, and it returns zero issues for
 * both (pinned from the other side in `packages/spec/src/ui/action-params.test.ts`).
 * The schema cannot see it either: the wiring lives on the VIEW and the
 * declaration on the ACTION, so no single parse has both.
 *
 * ## What this rule refuses — and what it deliberately does not
 *
 * It refuses a **mismatch**: an action that DECLARES `execution` wired by a
 * list view under the other contract. It names the action, the view and BOTH
 * contracts, because the fix is a choice between them and a message naming one
 * is a message that has already chosen.
 *
 * It says nothing about an action that declares NO `execution`. That is not a
 * gap left open, it is the ruling's 「创业阶段不渐进」 in the one place it
 * lands: there is **no silent default**, so undeclared means undeclared — not
 * "per-record until proven otherwise" — and refusing it would refuse every
 * app that predates the key. Undeclared is also the honest state of a body
 * written to serve both contracts (it reads `recordId` AND `_selectedIds` and
 * copes with either); the showcase ships one. Existing sources get their
 * declarations from the ADR-0087 semantic migration entry
 * `action-bulk-dispatch-contract-undeclared`, which derives them from these
 * same wirings where they are unambiguous — so the population this rule judges
 * grows by migration, never by guess. That is the ADR-0072 D1 zero-false-
 * positive posture the sibling members hold.
 *
 * Nor does it re-check that the name resolves at all: `validateActionNameRefs`
 * owns `action-name-undefined`, and a dead name gets one finding, not two.
 */

import { recordsOf } from './object-graph.js';

export const ACTION_DISPATCH_CONTRACT_MISMATCH = 'action-dispatch-contract-mismatch';

export type ActionDispatchContractSeverity = 'error' | 'warning';

/** The two dispatch contracts, spelled as `bulkActionDefs.execution` spells them. */
export type ActionDispatchContract = 'perRecord' | 'aggregate';

export interface ActionDispatchContractFinding {
  /** Always `error` — the body is handed input it was not written for, silently. */
  severity: ActionDispatchContractSeverity;
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

const CONTRACTS: readonly ActionDispatchContract[] = ['perRecord', 'aggregate'];

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function contractOf(v: unknown): ActionDispatchContract | undefined {
  return CONTRACTS.find((c) => c === v);
}

/**
 * One sentence per contract, written so the pair reads as a choice: each says
 * how many dispatches happen and which of the two builtin keys arrives. Both
 * sentences appear in every finding — the declared one and the wired one —
 * because naming only the one that is "wrong" presumes which end the author
 * meant to change.
 */
const CONTRACT_PROSE: Readonly<Record<ActionDispatchContract, string>> = {
  perRecord:
    "`execution: 'perRecord'` (the view's `bulkActions: ['<name>']` bare-string form) — the "
    + "renderer promotes the action to a def and dispatches it ONCE PER selected row, each call "
    + "carrying that row's `recordId` and NO `_selectedIds`",
  aggregate:
    "`execution: 'aggregate'` (a `bulkActionDefs` entry naming the action) — ONE dispatch for the "
    + 'whole selection, carrying every selected id in `params._selectedIds` and NO `recordId`',
};

/** What the body actually sees when it is written for one contract and wired the other. */
const MISFIRE: Readonly<Record<ActionDispatchContract, string>> = {
  perRecord:
    'a body written per-record finds no `recordId` on the single aggregate call and typically '
    + 'throws its own "nothing selected" — which reads in the console like a selection bug rather '
    + 'than a wiring one',
  aggregate:
    'a body written for the aggregate call reads `_selectedIds` as `undefined` on every per-row '
    + 'dispatch, falls through to its single-record branch, and reports success for one row out of '
    + 'however many were selected',
};

/**
 * Every action name in the stack that DECLARES a dispatch contract, mapped to
 * the contract it declares.
 *
 * A name declared more than once (a global action and an object-embedded one,
 * or two objects) contributes only when every declaration agrees: two
 * declarations that disagree are a defect in the DECLARATIONS, not in any
 * wiring, and charging a view for it would name the wrong file. Undeclared
 * names are absent from the map, which is what makes "undeclared is not
 * defaulted" structural here rather than a branch someone can drop.
 */
function collectDeclaredContracts(stack: AnyRec): Map<string, ActionDispatchContract> {
  const seen = new Map<string, Set<ActionDispatchContract | 'none'>>();

  const note = (action: unknown) => {
    if (!action || typeof action !== 'object') return;
    const a = action as AnyRec;
    const name = strName(a.name);
    if (!name) return;
    const declared = contractOf(a.execution) ?? 'none';
    if (!seen.has(name)) seen.set(name, new Set());
    seen.get(name)!.add(declared);
  };

  for (const action of recordsOf(stack.actions)) note(action);
  for (const obj of recordsOf(stack.objects)) {
    if (!obj || typeof obj !== 'object') continue;
    for (const action of recordsOf(obj.actions)) note(action);
  }

  const declared = new Map<string, ActionDispatchContract>();
  for (const [name, contracts] of seen) {
    if (contracts.size !== 1) continue;
    const only = [...contracts][0]!;
    if (only !== 'none') declared.set(name, only);
  }
  return declared;
}

/**
 * Validate every list-view bulk wiring in a stack against the wired action's
 * own dispatch declaration. Returns findings (empty = clean).
 */
export function validateActionDispatchContract(stack: AnyRec): ActionDispatchContractFinding[] {
  const findings: ActionDispatchContractFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const declaredBy = collectDeclaredContracts(stack);
  if (declaredBy.size === 0) return findings;

  const check = (
    name: string,
    wired: ActionDispatchContract,
    where: string,
    path: string,
    viewLabel: string,
  ) => {
    const declared = declaredBy.get(name);
    if (declared === undefined || declared === wired) return;

    const rewire = wired === 'perRecord'
      ? `move the wiring to \`bulkActionDefs: [{ name: '${name}', operation: 'custom', execution: 'aggregate' }]\``
      : `drop the def and name the action in the view's \`bulkActions: ['${name}']\` instead`;

    findings.push({
      severity: 'error',
      rule: ACTION_DISPATCH_CONTRACT_MISMATCH,
      where,
      path,
      message:
        `Action "${name}" declares ${CONTRACT_PROSE[declared]}, but ${viewLabel} wires it as `
        + `${CONTRACT_PROSE[wired]}. The two contracts deliver opposite input to the same body: `
        + `${MISFIRE[declared]}. Nothing refuses this at runtime — \`recordId\` and `
        + '`_selectedIds` are both builtin action params (ADR-0104), so the strict params gate '
        + 'admits either bag without a word.',
      hint:
        `Pick the contract the body is actually written for and make both ends say it: either `
        + `change the action's declaration to \`execution: '${wired}'\` (if the body was written `
        + `for the wiring), or ${rewire} (if the body was written for the declaration). If the `
        + `two wirings are both wanted, they are two actions — one call and N calls have `
        + `different side effects, which is why the platform will not silently unify them.`,
    });
  };

  /**
   * One list container: the default `list`, a `listViews.<key>` entry, or an
   * object-embedded one. Shared for the reason `validate-action-name-refs`
   * shares its own — an object has no top-level `list`, and its `listViews`
   * are a tier that has been missed before.
   */
  const checkListContainer = (
    container: unknown,
    owner: string,
    label: string,
    path: string,
  ) => {
    if (!container || typeof container !== 'object') return;
    const list = container as AnyRec;
    const viewLabel = `${owner} · ${label}`;

    const bare = Array.isArray(list.bulkActions) ? list.bulkActions : [];
    for (let ai = 0; ai < bare.length; ai++) {
      const name = strName(bare[ai]);
      if (!name) continue;
      check(name, 'perRecord', `${viewLabel} · bulkActions`, `${path}.bulkActions[${ai}]`, viewLabel);
    }

    // Only an `execution: 'aggregate'` def NAMES an action (#4457): an
    // `update`/`delete` def is a data-plane mass mutation whose `name` is a
    // button id, and a hand-inlined `actionDef` carries its own dispatcher and
    // resolves against nothing — the same two skips the name-ref sibling makes,
    // for the same reasons.
    const defs = Array.isArray(list.bulkActionDefs) ? (list.bulkActionDefs as AnyRec[]) : [];
    for (let di = 0; di < defs.length; di++) {
      const def = defs[di];
      if (!def || typeof def !== 'object') continue;
      if (def.execution !== 'aggregate') continue;
      if (def.actionDef !== undefined) continue;
      const name = strName(def.name);
      if (!name) continue;
      check(
        name,
        'aggregate',
        `${viewLabel} · bulkActionDefs[${di}]`,
        `${path}.bulkActionDefs[${di}]`,
        viewLabel,
      );
    }
  };

  // ── List views: `list` + each `listViews.<key>`, on views AND on objects ──
  const views = recordsOf(stack.views);
  for (let vi = 0; vi < views.length; vi++) {
    const view = views[vi];
    if (!view || typeof view !== 'object') continue;
    const viewName = strName(view.name) ?? strName(view.object) ?? `#${vi}`;
    const owner = `view "${viewName}"`;

    checkListContainer(view.list, owner, 'list', `views[${vi}].list`);
    const listViews = view.listViews;
    if (listViews && typeof listViews === 'object' && !Array.isArray(listViews)) {
      for (const [key, lv] of Object.entries(listViews as AnyRec)) {
        checkListContainer(lv, owner, `listViews.${key}`, `views[${vi}].listViews.${key}`);
      }
    }
  }

  const objects = recordsOf(stack.objects);
  for (let oi = 0; oi < objects.length; oi++) {
    const obj = objects[oi];
    if (!obj || typeof obj !== 'object') continue;
    const objListViews = obj.listViews;
    if (!objListViews || typeof objListViews !== 'object' || Array.isArray(objListViews)) continue;
    const owner = `object "${strName(obj.name) ?? `#${oi}`}"`;
    for (const [key, lv] of Object.entries(objListViews as AnyRec)) {
      checkListContainer(lv, owner, `listViews.${key}`, `objects[${oi}].listViews.${key}`);
    }
  }

  return findings;
}
