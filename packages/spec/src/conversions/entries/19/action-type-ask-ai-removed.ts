// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConversionContext, MetadataConversion } from '../../types.js';
import { mapCollection, mapPageComponents, removePageComponents } from '../../walk.js';
import { ACTION_CONTAINER_BLOCK_TYPES, ACTION_RUNNER_BLOCK_TYPES, isDict, type Dict, type Emit } from '../shared.js';

/**
 * The `ask_ai` action type leaves the spec (protocol 19; ADR-0160 D7 as its
 * seventh amendment rules, "What a legacy `ask_ai` action meets").
 *
 * `ask_ai` was published only on the 19 prerelease line (`19.0.0-next.0`) and
 * in no stable release. The maintainer retired it with no compatibility shim:
 * the shell's 「问 AI」 entry is the one way into the assistant, and nothing
 * converts an `ask_ai` action into something else. So every edit here is a
 * DELETE, and every authoring surface refuses the value with its prescription
 * (`ui/action-ask-ai-retired.ts`); this entry is retired from the load path
 * from the day it lands.
 *
 * What it deletes, in each slot that takes an action type:
 *
 * - a declared action, `actions[]` or an object's own `objects[].actions[]`,
 *   whose `type` is `ask_ai` — the entry;
 * - an `action:button` / `action:icon` row whose `properties.actionType` is
 *   `ask_ai`, and an `element:button` whose inline `properties.action.type` is
 *   `ask_ai` — the component, the smallest part that leaves the page
 *   parseable (a button left without its executor would draw and do nothing);
 * - an `action:group` / `action:menu` member whose `type` is `ask_ai` — the
 *   member, the rest of the list kept in order.
 *
 * Where it reads decides how much (`ConversionContext.atRest`):
 *
 * - **Over sources** (`os migrate meta --from 18`) it deletes a declared
 *   action only when NOTHING in the stack names it. "Names" is tested
 *   conservatively: the action's name appearing as any string value outside
 *   the `ask_ai` entries themselves keeps it, so the stack it leaves names no
 *   action it does not define on any surface the rule `ACTION_NAME_UNDEFINED`
 *   walks — and where it cannot tell, it keeps the action. A kept action stays
 *   as written with each reference, so the source still meets the refusal;
 *   the D3 entry `ui-action-type-ask-ai-retired` says what is done by hand.
 *   The conversion never deletes a reference.
 * - **At rest** (a stored row, a built artifact) it deletes every `ask_ai`
 *   action, named or not: there is no author to teach, and a reference left
 *   resolving nowhere is what an undefined action name already does.
 *
 * Inline rows and members are deleted on both paths: nothing names them. A
 * stored `action` row that IS one such action yields no item at all, which the
 * stored seam answers as such (`applyConversionsToStoredItem`).
 *
 * Idempotent by construction: a pass finds no `ask_ai` left to delete, and a
 * kept one is kept again for the same reference.
 */

const ASK_AI = 'ask_ai';

const isAskAiAction = (entry: unknown): entry is Dict => isDict(entry) && entry.type === ASK_AI;

/**
 * Every string value in `value`, skipping the declared `ask_ai` entries (an
 * entry's own `name` does not name it, and two copies of one action do not
 * name each other).
 */
function collectStrings(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 64) return;
  if (typeof value === 'string') {
    into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, into, depth + 1);
    return;
  }
  if (!isDict(value)) return;
  for (const v of Object.values(value)) collectStrings(v, into, depth + 1);
}

function namedStrings(stack: Dict): Set<string> {
  const strings = new Set<string>();
  for (const [key, value] of Object.entries(stack)) {
    if (key === 'actions' && Array.isArray(value)) {
      for (const entry of value) if (!isAskAiAction(entry)) collectStrings(entry, strings);
      continue;
    }
    if (key === 'objects' && Array.isArray(value)) {
      for (const obj of value) {
        if (!isDict(obj)) {
          collectStrings(obj, strings);
          continue;
        }
        for (const [objKey, objValue] of Object.entries(obj)) {
          if (objKey === 'actions' && Array.isArray(objValue)) {
            for (const entry of objValue) if (!isAskAiAction(entry)) collectStrings(entry, strings);
          } else {
            collectStrings(objValue, strings);
          }
        }
      }
      continue;
    }
    collectStrings(value, strings);
  }
  return strings;
}

function removeDeclared(
  list: unknown[],
  basePath: string,
  emit: Emit,
  keep: (action: Dict) => boolean,
  context: ConversionContext | undefined,
): unknown[] {
  let changed = false;
  const next = list.filter((entry, i) => {
    if (!isAskAiAction(entry)) return true;
    const path = `${basePath}[${i}]`;
    if (keep(entry)) {
      context?.reportTodo?.({
        path,
        from: ASK_AI,
        reason:
          `the \`ask_ai\` action \`${String(entry.name)}\` is named elsewhere in the stack, so it is left as written `
          + 'with each reference: delete the action and every reference to it by hand',
      });
      return true;
    }
    changed = true;
    emit({ from: ASK_AI, to: '(removed)', path });
    return false;
  });
  return changed ? next : list;
}

const actionTypeAskAiRemoved: MetadataConversion = {
  id: 'action-type-ask-ai-removed',
  toMajor: 19,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'action.type / object.actions[].type / page.component.action:button.actionType / '
    + 'page.component.action:icon.actionType / page.component.element:button.action.type / '
    + 'page.component.action:group.actions[].type / page.component.action:menu.actions[].type',
  summary:
    "action type 'ask_ai' removed (ADR-0160 D7): the shell's 「问 AI」 entry is the one way into the "
    + 'assistant. An `ask_ai` action, row or member is deleted; over sources a declared action that '
    + 'something names is left with its references, for the author to delete by hand',
  apply(stack, emit, context) {
    const atRest = context?.atRest === true;
    let referenced: Set<string> | undefined;
    const keep = (action: Dict): boolean => {
      if (atRest || typeof action.name !== 'string') return false;
      referenced ??= namedStrings(stack);
      return referenced.has(action.name);
    };

    let next = stack;
    if (Array.isArray(next.actions)) {
      const kept = removeDeclared(next.actions, 'actions', emit, keep, context);
      if (kept !== next.actions) next = { ...next, actions: kept };
    }
    next = mapCollection(next, 'objects', (obj, path) => {
      if (!Array.isArray(obj.actions)) return obj;
      const kept = removeDeclared(obj.actions, `${path}.actions`, emit, keep, context);
      return kept === obj.actions ? obj : { ...obj, actions: kept };
    });

    next = removePageComponents(next, (component, path) => {
      const type = component.type;
      const properties = component.properties;
      if (typeof type !== 'string' || !isDict(properties)) return false;
      if (ACTION_RUNNER_BLOCK_TYPES.has(type) && properties.actionType === ASK_AI) {
        emit({ from: ASK_AI, to: '(removed)', path: `${path}.properties.actionType` });
        return true;
      }
      if (type === 'element:button' && isAskAiAction(properties.action)) {
        emit({ from: ASK_AI, to: '(removed)', path: `${path}.properties.action.type` });
        return true;
      }
      return false;
    });

    return mapPageComponents(next, (component, path) => {
      const type = component.type;
      const properties = component.properties;
      if (typeof type !== 'string' || !ACTION_CONTAINER_BLOCK_TYPES.has(type) || !isDict(properties)) return component;
      const members = properties.actions;
      if (!Array.isArray(members) || !members.some(isAskAiAction)) return component;
      const kept = members.filter((member, i) => {
        if (!isAskAiAction(member)) return true;
        emit({ from: ASK_AI, to: '(removed)', path: `${path}.properties.actions[${i}].type` });
        return false;
      });
      return { ...component, properties: { ...properties, actions: kept } };
    });
  },
  fixture: {
    // Only what both paths delete: no `ask_ai` action here is named anywhere,
    // so the source run and the at-rest read agree. The named case is pinned
    // by `action-type-ask-ai-removed.test.ts`.
    before: {
      actions: [
        { name: 'ask_about_ticket', label: 'Ask AI', objectName: 'ticket', type: 'ask_ai', locations: ['record_page'] },
        { name: 'close_ticket', label: 'Close', objectName: 'ticket', type: 'script', locations: ['record_page'] },
      ],
      objects: [
        {
          name: 'ticket',
          actions: [
            { name: 'ask_about_ticket_row', label: 'Ask AI', type: 'ask_ai', locations: ['record_row'] },
            { name: 'reopen_ticket', label: 'Reopen', type: 'script' },
          ],
        },
      ],
      pages: [
        {
          name: 'ticket_desk',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'action:button', properties: { label: 'Ask AI', actionType: 'ask_ai' } },
                { type: 'action:button', properties: { label: 'Escalate', actionType: 'flow', target: 'escalate' } },
                { type: 'element:button', properties: { label: 'Ask', action: { type: 'ask_ai', label: 'Ask' } } },
                {
                  type: 'action:group',
                  properties: {
                    actions: [
                      { label: 'Ask AI', type: 'ask_ai' },
                      { label: 'Run', type: 'api', target: '/api/v1/tickets/run' },
                    ],
                  },
                },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Help',
                    children: [{ type: 'action:icon', properties: { icon: 'sparkles', actionType: 'ask_ai' } }],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'ticket_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'action:icon', properties: { icon: 'sparkles', actionType: 'ask_ai' } },
            details: [{ type: 'action:menu', properties: { actions: [{ label: 'Ask AI', type: 'ask_ai' }] } }],
          },
        },
      ],
    },
    after: {
      actions: [
        { name: 'close_ticket', label: 'Close', objectName: 'ticket', type: 'script', locations: ['record_page'] },
      ],
      objects: [
        {
          name: 'ticket',
          actions: [{ name: 'reopen_ticket', label: 'Reopen', type: 'script' }],
        },
      ],
      pages: [
        {
          name: 'ticket_desk',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'action:button', properties: { label: 'Escalate', actionType: 'flow', target: 'escalate' } },
                {
                  type: 'action:group',
                  properties: { actions: [{ label: 'Run', type: 'api', target: '/api/v1/tickets/run' }] },
                },
                { type: 'page:card', properties: { title: 'Help', children: [] } },
              ],
            },
          ],
        },
        {
          name: 'ticket_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: [{ type: 'action:menu', properties: { actions: [] } }],
          },
        },
      ],
    },
    // Two declared actions, the button, the element button, the group member,
    // the nested icon, the slotted header icon and the slotted menu member.
    expectedNotices: 8,
  },
};

export { actionTypeAskAiRemoved };
