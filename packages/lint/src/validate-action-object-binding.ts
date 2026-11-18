// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A standalone action that declares where it renders but names no object.
 *
 * Every location in `ACTION_LOCATIONS` (`@objectstack/spec/ui`) is a surface
 * of an object: its list toolbar, a list row, a record's header, menu,
 * related list or section. A standalone action (`stack.actions[]`) reaches
 * those surfaces only through its `objectName`, which `defineStack` folds into
 * that object's `actions` and the runtime keys its dispatch by. Without one the
 * action registers under the global scope: no object's list or record page
 * carries it, so the button it declares never renders and a call on an
 * object's action route answers "not found". The spec's own note on the
 * location vocabulary names the honest shape for an object-less action:
 * `locations: []`, headless.
 *
 * An action embedded in an object's own `actions` is bound by the object it is
 * written on and is never visited. An action that omits `locations` is
 * `action-no-placement`'s question, not this rule's.
 */

import { recordsOf } from './object-graph.js';

export const ACTION_NO_OBJECT_BINDING = 'action-no-object-binding';

export interface ActionObjectBindingFinding {
  severity: 'error';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

/** Flag every standalone action that declares a location and names no object. */
export function validateActionObjectBinding(stack: Record<string, unknown>): ActionObjectBindingFinding[] {
  const findings: ActionObjectBindingFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;
  const list: readonly unknown[] = Array.isArray(stack.actions) ? stack.actions : [];
  for (const action of recordsOf(stack.actions)) {
    if (typeof action.objectName === 'string' && action.objectName.length > 0) continue;
    const locations = Array.isArray(action.locations)
      ? action.locations.filter((l): l is string => typeof l === 'string')
      : [];
    if (locations.length === 0) continue;
    const name = typeof action.name === 'string' ? action.name : '(unnamed action)';
    findings.push({
      severity: 'error',
      rule: ACTION_NO_OBJECT_BINDING,
      where: `action "${name}"`,
      path: `actions[${list.indexOf(action)}].objectName`,
      message:
        `Action "${name}" declares ${locations.map((l) => `\`${l}\``).join(', ')} but no \`objectName\`, so it binds ` +
        'to no object: the button never renders, and a call on an object\'s action route answers "not found".',
      hint:
        `Set \`objectName\` to the object the action acts on, or write \`locations: []\` if it is headless ` +
        '(REST / MCP / AI only).',
    });
  }
  return findings;
}
