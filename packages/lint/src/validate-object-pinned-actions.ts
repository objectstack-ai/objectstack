// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { recordsOf } from './object-graph.js';

/**
 * An object's pinned header actions (`pinnedActions`, objectstack#36366) that
 * name no action the header can draw.
 *
 * `pinnedActions.list` / `.record` name, in order, the actions a page header
 * draws as buttons; every other action it places goes to 「More」. The schema
 * refuses the SHAPE at every door (more than three, an entry twice, a
 * malformed entry, a `$` built-in the page does not have). What it cannot see
 * is the REFERENCE: whether a name is an action of the object, and whether
 * that action is placed on the page the arm pins it on. A name that is not
 * would draw no button at all, so the author's pin is lost without a word.
 * This rule refuses it, at `error`, naming the reason:
 *
 * - `object-pinned-action-unknown`: no action of that name is declared on the
 *   object (its own `actions`, or a stack action whose `objectName` is it);
 * - `object-pinned-action-not-placed`: the action is declared but not placed
 *   on that page: `list_toolbar` for the `list` arm, `record_header` or
 *   `record_more` for the `record` arm (the record header draws both).
 *
 * Both object positions are judged: an object's own `pinnedActions`, and an
 * `objectExtensions` entry's, against the object it extends. An extension of
 * an object this stack does not define is not judged (its actions are in the
 * other package, ADR-0072 D1: no finding the graph cannot back). `$` built-ins
 * are the schema's; they are skipped here.
 *
 * Where it runs: `os validate`, `os build` and `os lint`, where the whole stack
 * is visible. The runtime publish gate's per-write snapshot carries objects
 * but not the stack's `actions` collection, so there an action bound by
 * `objectName` would read as unknown; the design mode's 「Save」 checks the
 * names against the object as served (every package's actions) before it
 * writes, and a pin that reaches the server another way names nothing the
 * header draws, so it draws no button.
 */

export const OBJECT_PINNED_ACTION_UNKNOWN = 'object-pinned-action-unknown';
export const OBJECT_PINNED_ACTION_NOT_PLACED = 'object-pinned-action-not-placed';

export interface ObjectPinnedActionsFinding {
  /** Always `error`: the pin draws nothing. */
  severity: 'error';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `object "crm_lead"`. */
  where: string;
  /** Config path, e.g. `objects[0].pinnedActions.record[1]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** The locations an arm's actions are placed at: the page's header draws an action placed at one of them. */
const ARM_LOCATIONS: Readonly<Record<'list' | 'record', readonly string[]>> = {
  list: ['list_toolbar'],
  record: ['record_header', 'record_more'],
};

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** The object's declared actions by name: its own `actions`, then the stack's bound to it by `objectName`. */
function actionsOf(stack: AnyRec, object: AnyRec, objectName: string): Map<string, AnyRec> {
  const out = new Map<string, AnyRec>();
  for (const action of recordsOf(object.actions)) {
    const name = strName(action.name);
    if (name && !out.has(name)) out.set(name, action);
  }
  for (const action of recordsOf(stack.actions)) {
    const name = strName(action.name);
    if (name && action.objectName === objectName && !out.has(name)) out.set(name, action);
  }
  return out;
}

/**
 * Refuse every pinned name that names no action of the object, or one not
 * placed on the page its arm pins. Returns findings (empty = clean).
 */
export function validateObjectPinnedActions(stack: AnyRec): ObjectPinnedActionsFinding[] {
  const findings: ObjectPinnedActionsFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const objects = recordsOf(stack.objects);
  const byName = new Map<string, AnyRec>();
  for (const object of objects) {
    const name = strName(object.name);
    if (name && !byName.has(name)) byName.set(name, object);
  }

  const judge = (pinned: unknown, objectName: string, object: AnyRec, at: string, where: string): void => {
    if (!pinned || typeof pinned !== 'object' || Array.isArray(pinned)) return;
    const actions = actionsOf(stack, object, objectName);
    for (const arm of ['list', 'record'] as const) {
      const pins = (pinned as AnyRec)[arm];
      if (!Array.isArray(pins)) continue;
      const locations = ARM_LOCATIONS[arm];
      const page = arm === 'list' ? 'list page' : 'record page';
      pins.forEach((pin, index) => {
        const name = strName(pin);
        if (!name || name.startsWith('$')) return;
        const path = `${at}.pinnedActions.${arm}[${index}]`;
        const action = actions.get(name);
        if (!action) {
          findings.push({
            severity: 'error',
            rule: OBJECT_PINNED_ACTION_UNKNOWN,
            where,
            path,
            message: `"${objectName}" pins "${name}" on its ${page} header, and "${objectName}" declares no action of that name, so the pin draws no button`,
            hint:
              `Pin an action of "${objectName}" by its name (its own actions, or a stack action with objectName: ` +
              `'${objectName}'), or remove "${name}" from pinnedActions.${arm}`,
          });
          return;
        }
        const placed = Array.isArray(action.locations) && action.locations.some((l) => locations.includes(l as string));
        if (!placed) {
          findings.push({
            severity: 'error',
            rule: OBJECT_PINNED_ACTION_NOT_PLACED,
            where,
            path,
            message:
              `"${objectName}" pins "${name}" on its ${page} header, and that action is not placed there ` +
              `(locations ${locations.map((l) => `'${l}'`).join(' or ')}), so the pin draws no button`,
            hint:
              `Add ${locations.map((l) => `'${l}'`).join(' or ')} to the locations of "${name}", or remove it ` +
              `from pinnedActions.${arm}`,
          });
        }
      });
    }
  };

  objects.forEach((object, i) => {
    const name = strName(object.name);
    if (name) judge(object.pinnedActions, name, object, `objects[${i}]`, `object "${name}"`);
  });
  recordsOf(stack.objectExtensions).forEach((extension, i) => {
    const target = strName(extension.extend);
    const object = target ? byName.get(target) : undefined;
    if (target && object) {
      judge(extension.pinnedActions, target, object, `objectExtensions[${i}]`, `object extension of "${target}"`);
    }
  });

  return findings;
}
