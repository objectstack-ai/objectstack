// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `action-block-endpoint-to-target` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `actionBlockEndpointToTarget` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents, renameKey } from '../../walk.js';
import { ACTION_RUNNER_BLOCK_TYPES, type Dict, describeBlock, isDict } from '../shared.js';

/**
 * `action:button` / `action:icon` component prop `endpoint` → `target`
 * (protocol 18, #21005).
 *
 * One concept — the endpoint an `api` action calls — with two verdicts in one
 * release. `ActionSchema` has always refused `endpoint` with the rename
 * "Did you mean `endpoint` → `target`?", while the two `ComponentPropsMap`
 * rows declared it as a key of their own. The renderers forward it, and
 * objectui's console registers its own `api` handler, which reads
 * `action.target || action.name` and never `endpoint` — so an `api` button
 * authored with `endpoint` passed the props gate and called nothing. The rows
 * now refuse it with the same rename, read from the one table both files share
 * (`ui/action-target-aliases.ts`); this entry carries the sources and stored
 * rows that wrote it.
 *
 * **Scoped to `actionType: 'api'`, deliberately** — the one meaning the key
 * declared ("API endpoint for an `api` action"). There the rename is lossless
 * for every host: the console's handler reads `target`, and the runner's
 * built-in `api` executor resolves `api || endpoint || target`. Anywhere else
 * it is not, so the site is left as stored and reported as a TODO
 * (`context.reportTodo`, ADR-0087 D3's model):
 *
 * - no `actionType` — the runner's legacy fallback dispatches an `endpoint`
 *   with no type as an API call, and a `target` with no type as nothing, so a
 *   bare rename would leave the button with no executor;
 * - another `actionType` — that executor reads `target` as its URL, script or
 *   flow, and never read `endpoint`, so moving the value there would make a
 *   dead key decide what the action does;
 * - a non-string `endpoint` — not the string the row declared, and `target`
 *   takes a string only.
 *
 * Precedence is {@link renameKey}'s house rule (#4923): an already-canonical
 * `target` WINS — a redundant twin is dropped, a DISAGREEING pair is left for
 * the author to reconcile (and reported as a TODO, since the strict row
 * refuses `endpoint` there). The reach is every position `mapPageComponents`
 * visits — regions, slots, nested containers — which is the props gate's own
 * reach. A member of `action:group` / `action:menu` is an action object, not a
 * page component, and is not this entry's surface.
 *
 * **Retired from the load path from day one** — the `field-reference-to-alias`
 * shape: the authoring door keeps teaching with the rows' rename, and this
 * entry serves the two paths that rewrite EXISTING data, stored-row
 * rehydration and `os migrate meta`. Census at landing (objectstack
 * `2821e9f15b`, objectui `5262f7dd`): zero producers author `endpoint` on
 * either block.
 */
const actionBlockEndpointToTarget: MetadataConversion = {
  id: 'action-block-endpoint-to-target',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.5.0',
  surface: 'page.component.action:button.endpoint / page.component.action:icon.endpoint',
  summary:
    "action:button / action:icon component prop 'endpoint' → 'target' on an `api` action — the "
    + "rename `ActionSchema` already prescribes; the console's `api` handler reads `target` only. "
    + 'An `endpoint` on a block with no `actionType` or another one is left as stored and reported '
    + 'as a TODO',
  apply(stack, emit, context) {
    return mapPageComponents(stack, (component, path) => {
      const type = component.type;
      if (typeof type !== 'string' || !ACTION_RUNNER_BLOCK_TYPES.has(type)) return component;
      const properties = component.properties;
      if (!isDict(properties) || properties.endpoint == null) return component;
      const endpoint = properties.endpoint;
      const at = `${path}.properties.endpoint`;
      const todo = (reason: string): Dict => {
        context?.reportTodo?.({
          path: at,
          from: JSON.stringify(endpoint),
          reason: `On ${describeBlock(component)}, ${reason}`,
        });
        return component;
      };
      if (typeof endpoint !== 'string') {
        return todo('`endpoint` is not a string, so it is not the URL `target` takes. Rewrite it '
          + 'by hand as the `target` string the `api` action should call.');
      }
      const actionType = properties.actionType;
      if (actionType === undefined) {
        return todo('there is no `actionType`, and the action runner calls an `endpoint` with no '
          + 'type through its legacy API fallback, while a `target` with no type runs nothing. '
          + "Set `actionType: 'api'` and rename `endpoint` to `target`.");
      }
      if (actionType !== 'api') {
        return todo(`\`actionType\` is ${JSON.stringify(actionType)}, whose executor reads `
          + '`target` and never read `endpoint`. Delete `endpoint`, or move its value to `target` '
          + 'if that is what the action should run.');
      }
      const renamed = renameKey(properties, 'endpoint', 'target');
      if (!renamed) {
        return todo('`target` and `endpoint` name different endpoints; the console calls `target`. '
          + 'Keep the one the button should call, as `target`, and delete `endpoint`.');
      }
      emit({ from: 'endpoint', to: 'target', path: `${path}.properties.target` });
      return { ...component, properties: renamed };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'ops_console',
          regions: [
            {
              name: 'main',
              components: [
                // The measured defect: an `api` button written with `endpoint`.
                {
                  type: 'action:button',
                  properties: { label: 'Sync now', actionType: 'api', endpoint: '/api/v1/ops/sync', method: 'POST' },
                },
                // Both spellings, SAME endpoint: the redundant twin goes (#4923).
                {
                  type: 'action:icon',
                  properties: { icon: 'refresh-cw', actionType: 'api', target: '/api/v1/ops/refresh', endpoint: '/api/v1/ops/refresh' },
                },
                // Both spellings, DIFFERENT endpoints: kept for the author.
                {
                  type: 'action:button',
                  properties: { label: 'Both', actionType: 'api', target: '/api/v1/a', endpoint: '/api/v1/b' },
                },
                // No `actionType`: no lossless rewrite (the runner's legacy fallback) — kept.
                { type: 'action:button', properties: { label: 'Legacy', endpoint: '/api/v1/legacy' } },
                // Canonical already: untouched.
                { type: 'action:icon', properties: { icon: 'play', actionType: 'api', target: '/api/v1/run' } },
                // `endpoint` on another block is not this entry's business.
                { type: 'element:text', properties: { endpoint: '/not/an/action' } },
                // Nested one container down, where a toolbar button usually sits.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Integrations',
                    children: [
                      { type: 'action:icon', properties: { icon: 'upload', actionType: 'api', endpoint: '/api/v1/ops/push' } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // A slotted record page's named slot.
        {
          name: 'ops_job_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'action:button', properties: { label: 'Retry', actionType: 'api', endpoint: '/api/v1/ops/retry' } },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'ops_console',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'action:button',
                  properties: { label: 'Sync now', actionType: 'api', target: '/api/v1/ops/sync', method: 'POST' },
                },
                {
                  type: 'action:icon',
                  properties: { icon: 'refresh-cw', actionType: 'api', target: '/api/v1/ops/refresh' },
                },
                {
                  type: 'action:button',
                  properties: { label: 'Both', actionType: 'api', target: '/api/v1/a', endpoint: '/api/v1/b' },
                },
                { type: 'action:button', properties: { label: 'Legacy', endpoint: '/api/v1/legacy' } },
                { type: 'action:icon', properties: { icon: 'play', actionType: 'api', target: '/api/v1/run' } },
                { type: 'element:text', properties: { endpoint: '/not/an/action' } },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Integrations',
                    children: [
                      { type: 'action:icon', properties: { icon: 'upload', actionType: 'api', target: '/api/v1/ops/push' } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'ops_job_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'action:button', properties: { label: 'Retry', actionType: 'api', target: '/api/v1/ops/retry' } },
          },
        },
      ],
    },
    // Sync now (rename), the redundant twin (dropped), the nested icon and the
    // slotted header. The disagreeing pair and the type-less button are TODOs,
    // which are not notices.
    expectedNotices: 4,
  },
};

export { actionBlockEndpointToTarget };
