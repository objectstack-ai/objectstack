// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-action-row-patch-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageActionRowPatchRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { ACTION_CONTAINER_BLOCK_TYPES, ACTION_RUNNER_BLOCK_TYPES, isDict, stripKeys } from '../shared.js';

/**
 * A page action row's own `patch` leaves the contract (protocol 18, #24394 —
 * ADR-0049 enforce-or-remove; the `domain:spec` seat's route on the card).
 *
 * Two implementations of one write disagreed, and the governed side wins. A
 * row's `operation: 'update'` posts through the console runner's server
 * dispatch to the platform action route under the row's `name`. The route
 * resolves that declaration by name (ADR-0110 D2) and writes the
 * DECLARATION's `patch`, merged under the request's params. The row's own
 * `patch` reached no request. The runner posts the collected values alone and
 * reads the row's `patch` for its Undo snapshot only. The tombstones on
 * `ActionButtonProps`, `ActionIconProps` and each `action:group` /
 * `action:menu` member refuse it for a live author: the component-props gate
 * (`@objectstack/lint`) reports it at `os validate`, `os build`, `os lint` and
 * the metadata save door. The load path keeps a page's open `properties` bag
 * as written, so this entry carries stored rows and built artifacts.
 *
 * **A strip, not a move.** The values were never written, so deleting them
 * changes no write the route performs. Moving them into the named action's
 * `patch` is a judgement no walker can make: the action may live in another
 * package, carry a `patch` of its own, or not exist. That half is the D3 entry
 * `ui-page-action-row-patch-retired`. What the strip does change is the
 * console's Undo snapshot, which captured the row's `patch` keys.
 *
 * Three surfaces: `properties.patch` on an `action:button` / `action:icon`
 * node, and `patch` on each `action:group` / `action:menu` member of
 * `properties.actions`. Scoped by component `type`, never by key name: `patch`
 * is an ordinary name for an open-namespace component's own prop. A member
 * that is not an object, or a list that is not an array, is left as stored.
 * The reach is every position `mapPageComponents` visits (regions, slots,
 * nested containers), which is the props gate's own reach. Idempotent by
 * construction: `stripKeys` skips an absent key.
 *
 * Who writes the key: nobody measured. No page action row authors `patch` in
 * this repository's examples or apps, and objectui (pin and `main`) authors
 * none.
 */
const pageActionRowPatchRemoved: MetadataConversion = {
  id: 'page-action-row-patch-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.component.action:button.patch / page.component.action:icon.patch / '
    + 'page.component.action:group.actions[].patch / page.component.action:menu.actions[].patch',
  summary:
    "page action row 'patch' removed (a row's operation: 'update' runs the declared action its name names, and "
    + "the platform action route writes that action's own patch, never the row's)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      const type = component.type;
      if (typeof type !== 'string') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      if (ACTION_RUNNER_BLOCK_TYPES.has(type)) {
        const stripped = stripKeys(properties, ['patch'], emit, `${path}.properties`);
        return stripped === properties ? component : { ...component, properties: stripped };
      }
      if (!ACTION_CONTAINER_BLOCK_TYPES.has(type)) return component;
      const actions = properties.actions;
      if (!Array.isArray(actions)) return component;
      let changed = false;
      const nextActions = actions.map((member, i) => {
        if (!isDict(member)) return member;
        const stripped = stripKeys(member, ['patch'], emit, `${path}.properties.actions[${i}]`);
        if (stripped !== member) changed = true;
        return stripped;
      });
      return changed ? { ...component, properties: { ...properties, actions: nextActions } } : component;
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'task_record',
          regions: [
            {
              name: 'header',
              components: [
                // The shape the rows invited: the write the route never made.
                {
                  type: 'action:button',
                  properties: { label: 'Close', name: 'close_task', operation: 'update', patch: { status: 'done' } },
                },
                // A `patch` with no `operation`, which the rows already refused.
                { type: 'action:icon', properties: { icon: 'check', name: 'close_task', patch: { status: 'done' } } },
                // A row WITHOUT the key rides through untouched.
                { type: 'action:button', properties: { label: 'Reopen', name: 'reopen_task', operation: 'update' } },
                // ⚠️ The same key name on an open-namespace component — its own prop.
                { type: 'acme:quick_edit', properties: { patch: { status: 'done' } } },
                {
                  type: 'action:group',
                  properties: {
                    actions: [
                      { label: 'Close', name: 'close_task', operation: 'update', patch: { status: 'done' } },
                      { label: 'Reopen', name: 'reopen_task', operation: 'update' },
                    ],
                  },
                },
                // The nested position: a menu inside a card's `children`.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Triage',
                    children: [
                      {
                        type: 'action:menu',
                        properties: { actions: [{ label: 'Close', name: 'close_task', operation: 'update', patch: { status: 'done' } }] },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape.
        {
          name: 'task_record_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: {
              type: 'action:icon',
              properties: { icon: 'check', name: 'close_task', operation: 'update', patch: { status: 'done' } },
            },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'task_record',
          regions: [
            {
              name: 'header',
              components: [
                { type: 'action:button', properties: { label: 'Close', name: 'close_task', operation: 'update' } },
                { type: 'action:icon', properties: { icon: 'check', name: 'close_task' } },
                { type: 'action:button', properties: { label: 'Reopen', name: 'reopen_task', operation: 'update' } },
                { type: 'acme:quick_edit', properties: { patch: { status: 'done' } } },
                {
                  type: 'action:group',
                  properties: {
                    actions: [
                      { label: 'Close', name: 'close_task', operation: 'update' },
                      { label: 'Reopen', name: 'reopen_task', operation: 'update' },
                    ],
                  },
                },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Triage',
                    children: [
                      {
                        type: 'action:menu',
                        properties: { actions: [{ label: 'Close', name: 'close_task', operation: 'update' }] },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'task_record_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'action:icon', properties: { icon: 'check', name: 'close_task', operation: 'update' } },
          },
        },
      ],
    },
    // The button, the bare icon, the group member, the nested menu member and
    // the slotted header icon. The row without the key and the open-namespace
    // component emit none.
    expectedNotices: 5,
  },
};

export { pageActionRowPatchRemoved };
