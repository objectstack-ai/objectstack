// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { recordsOf } from './object-graph.js';

/**
 * An object's action layout (`actionLayout`, objectstack#36366) naming an
 * action its scope cannot draw.
 *
 * `actionLayout.list` / `.record` arrange one action scope each: `pinned`
 * names, in order, the actions drawn as buttons, `more` the order of the
 * 「More」 menu. The schema refuses the SHAPE at every door (more than three
 * pinned, an entry twice, a malformed entry, a `$` built-in the scope does not
 * have). What it cannot see is the REFERENCE: whether a name is an action of
 * the object, and whether that action is placed in the scope the arm arranges.
 * A name that is not draws nothing, so the author's arrangement is lost
 * without a word. This rule refuses it, at `error`, naming the reason:
 *
 * - `object-action-layout-unknown`: no action of that name is declared on the
 *   object (its own `actions`, or a stack action whose `objectName` is it);
 * - `object-action-layout-not-placed`: the action is declared but not placed
 *   in that scope: `list_toolbar` for the `list` arm, `record_header` or
 *   `record_more` for the `record` arm (the record header draws both). A
 *   record action named in the `list` arm, or the reverse, is this.
 *
 * Both object positions are judged: an object's own `actionLayout`, and an
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
 * writes, and a name that reaches the server another way names nothing the
 * scope draws, so it draws nothing.
 */

export const OBJECT_ACTION_LAYOUT_UNKNOWN = 'object-action-layout-unknown';
export const OBJECT_ACTION_LAYOUT_NOT_PLACED = 'object-action-layout-not-placed';

export interface ObjectActionLayoutFinding {
  /** Always `error`: the name draws nothing. */
  severity: 'error';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `object "crm_lead"`. */
  where: string;
  /** Config path, e.g. `objects[0].actionLayout.record.pinned[1]`. */
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
 * Refuse every name in an arm (`pinned` or `more`) that names no action of
 * the object, or one not placed in the scope its arm arranges. Returns findings (empty = clean).
 */
export function validateObjectActionLayout(stack: AnyRec): ObjectActionLayoutFinding[] {
  const findings: ObjectActionLayoutFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const objects = recordsOf(stack.objects);
  const byName = new Map<string, AnyRec>();
  for (const object of objects) {
    const name = strName(object.name);
    if (name && !byName.has(name)) byName.set(name, object);
  }

  const judge = (layout: unknown, objectName: string, object: AnyRec, at: string, where: string): void => {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return;
    const actions = actionsOf(stack, object, objectName);
    for (const arm of ['list', 'record'] as const) {
      const value = (layout as AnyRec)[arm];
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const locations = ARM_LOCATIONS[arm];
      const scope = arm === 'list' ? 'list toolbar' : 'record header';
      for (const part of ['pinned', 'more'] as const) {
        const names = (value as AnyRec)[part];
        if (!Array.isArray(names)) continue;
        const role = part === 'pinned' ? `the ${scope}'s buttons` : `the ${scope}'s 「More」 menu`;
        names.forEach((entry, index) => {
          const name = strName(entry);
          if (!name || name.startsWith('$')) return;
          const path = `${at}.actionLayout.${arm}.${part}[${index}]`;
          const action = actions.get(name);
          if (!action) {
            findings.push({
              severity: 'error',
              rule: OBJECT_ACTION_LAYOUT_UNKNOWN,
              where,
              path,
              message: `"${objectName}" names "${name}" for ${role}, and "${objectName}" declares no action of that name, so it draws nothing`,
              hint:
                `Name an action of "${objectName}" (its own actions, or a stack action with objectName: ` +
                `'${objectName}'), or remove "${name}" from actionLayout.${arm}.${part}`,
            });
            return;
          }
          const placed = Array.isArray(action.locations) && action.locations.some((l) => locations.includes(l as string));
          if (!placed) {
            findings.push({
              severity: 'error',
              rule: OBJECT_ACTION_LAYOUT_NOT_PLACED,
              where,
              path,
              message:
                `"${objectName}" names "${name}" for ${role}, and that action is not placed in the ${arm} scope ` +
                `(locations ${locations.map((l) => `'${l}'`).join(' or ')}), so it draws nothing there`,
              hint:
                `Add ${locations.map((l) => `'${l}'`).join(' or ')} to the locations of "${name}", or remove it ` +
                `from actionLayout.${arm}.${part}`,
            });
          }
        });
      }
    }
  };

  objects.forEach((object, i) => {
    const name = strName(object.name);
    if (name) judge(object.actionLayout, name, object, `objects[${i}]`, `object "${name}"`);
  });
  recordsOf(stack.objectExtensions).forEach((extension, i) => {
    const target = strName(extension.extend);
    const object = target ? byName.get(target) : undefined;
    if (target && object) {
      judge(extension.actionLayout, target, object, `objectExtensions[${i}]`, `object extension of "${target}"`);
    }
  });

  return findings;
}
