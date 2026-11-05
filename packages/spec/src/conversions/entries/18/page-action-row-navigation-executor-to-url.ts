// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-action-row-navigation-executor-to-url` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageActionRowNavigationExecutorToUrl` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { ACTION_CONTAINER_BLOCK_TYPES, ACTION_RUNNER_BLOCK_TYPES, isDict } from '../shared.js';

/**
 * A page action row's executor value `'navigation'` → `'url'` (protocol 18).
 *
 * objectui's action runner keeps `'navigation'` as a local alias of the url
 * executor: its built-in table sends the alias to `executeNavigation`, which
 * reads `to || target || redirect` and hands off to `navigateTo`, the
 * navigator `executeUrl` calls with `target || redirect`. On a page action row
 * the two spellings are the same navigation — the alias's own keys (`to`,
 * `redirect`, `external`, `newTab`, `replace`) are not row keys, and both read
 * the row's `target` and `openIn`. The rows judged a url `target` only when
 * the executor read `'url'`, so the alias spelling carried a target the click
 * refuses past the parse. The rows now refuse the alias at the executor key
 * (`refuseRowUrlExecutorAlias`, `ui/component.zod.ts`) with the rename onto
 * `'url'`, and this entry carries the sources and stored rows that wrote it.
 *
 * **The rewrite is lossless, so the chain owes it** (ADR-0087's launch-window
 * section: a lossless break lands as a `retiredFromLoadPath` conversion beside
 * its D3 entry, `ui-page-action-row-navigation-executor-refused`). A page's
 * `properties` is not parsed on the metadata load path, so a stored row
 * written with the alias keeps working only while the runner keeps it; the
 * stored-row seam and `os migrate meta --write` carry it across.
 *
 * Two surfaces, both value renames and nothing else: `properties.actionType`
 * on an `action:button` / `action:icon` node, and `type` on each
 * `action:group` / `action:menu` member of `properties.actions`. Every other
 * executor value is left alone — the key stays open, and a host-registered
 * handler name (`navigate_edit`, …) is not this entry's. A member that is not
 * an object, or a list that is not an array, is left as stored. The reach is
 * every position `mapPageComponents` visits — regions, slots, nested
 * containers — which is the props gate's own reach. Idempotent by
 * construction: a rewritten value reads `'url'`, which this entry never
 * touches.
 *
 * **Retired from the load path from day one**, as
 * {@link actionBlockEndpointToTarget} is: the authoring door keeps teaching
 * with the rows' refusal, and this entry serves the two paths that rewrite
 * EXISTING data, stored-row rehydration and `os migrate meta`.
 */
const pageActionRowNavigationExecutorToUrl: MetadataConversion = {
  id: 'page-action-row-navigation-executor-to-url',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.component.action:button.actionType / page.component.action:icon.actionType / '
    + 'page.component.action:group.actions[].type / page.component.action:menu.actions[].type',
  summary:
    "page action row executor 'navigation' → 'url' — objectui's runner-local alias of the url executor; "
    + 'on a row both spellings run one navigator on the same `target`, so the rename is lossless and the '
    + 'url scheme set then judges `target`',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      const type = component.type;
      if (typeof type !== 'string') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      if (ACTION_RUNNER_BLOCK_TYPES.has(type)) {
        if (properties.actionType !== 'navigation') return component;
        emit({ from: 'navigation', to: 'url', path: `${path}.properties.actionType` });
        return { ...component, properties: { ...properties, actionType: 'url' } };
      }
      if (!ACTION_CONTAINER_BLOCK_TYPES.has(type)) return component;
      const actions = properties.actions;
      if (!Array.isArray(actions)) return component;
      let changed = false;
      const nextActions = actions.map((member, i) => {
        if (!isDict(member) || member.type !== 'navigation') return member;
        changed = true;
        emit({ from: 'navigation', to: 'url', path: `${path}.properties.actions[${i}].type` });
        return { ...member, type: 'url' };
      });
      return changed ? { ...component, properties: { ...properties, actions: nextActions } } : component;
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'ops_links',
          regions: [
            {
              name: 'main',
              components: [
                // The measured shape: a url button spelled with the runner's alias.
                {
                  type: 'action:button',
                  properties: { label: 'Runbook', actionType: 'navigation', target: '/apps/ops/runbook', openIn: 'new-tab' },
                },
                { type: 'action:icon', properties: { icon: 'external-link', actionType: 'navigation', target: 'https://status.example.com' } },
                // Canonical already: untouched.
                { type: 'action:button', properties: { label: 'Home', actionType: 'url', target: '/apps/ops' } },
                // A host-registered handler name: the key stays open, untouched.
                { type: 'action:button', properties: { label: 'Edit', actionType: 'navigate_edit' } },
                // An `element:button` inline action keeps the parse's own fold — not this entry's.
                { type: 'element:button', properties: { label: 'Pricing', action: { type: 'navigation', to: '/pricing' } } },
                // A container member: only the alias member is renamed.
                {
                  type: 'action:group',
                  properties: {
                    actions: [
                      { label: 'Runs', type: 'navigation', target: '/apps/ops/runs' },
                      { label: 'Run', type: 'api', target: '/api/v1/ops/run' },
                    ],
                  },
                },
                // Nested one container down.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Links',
                    children: [
                      { type: 'action:menu', properties: { actions: [{ label: 'Wiki', type: 'navigation', target: 'https://wiki.example.com' }] } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // A slotted record page's named slot.
        {
          name: 'ops_link_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'action:icon', properties: { icon: 'book', actionType: 'navigation', target: './docs' } },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'ops_links',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'action:button',
                  properties: { label: 'Runbook', actionType: 'url', target: '/apps/ops/runbook', openIn: 'new-tab' },
                },
                { type: 'action:icon', properties: { icon: 'external-link', actionType: 'url', target: 'https://status.example.com' } },
                { type: 'action:button', properties: { label: 'Home', actionType: 'url', target: '/apps/ops' } },
                { type: 'action:button', properties: { label: 'Edit', actionType: 'navigate_edit' } },
                { type: 'element:button', properties: { label: 'Pricing', action: { type: 'navigation', to: '/pricing' } } },
                {
                  type: 'action:group',
                  properties: {
                    actions: [
                      { label: 'Runs', type: 'url', target: '/apps/ops/runs' },
                      { label: 'Run', type: 'api', target: '/api/v1/ops/run' },
                    ],
                  },
                },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Links',
                    children: [
                      { type: 'action:menu', properties: { actions: [{ label: 'Wiki', type: 'url', target: 'https://wiki.example.com' }] } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'ops_link_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'action:icon', properties: { icon: 'book', actionType: 'url', target: './docs' } },
          },
        },
      ],
    },
    // The button, the icon, the group member, the nested menu member and the
    // slotted header icon.
    expectedNotices: 5,
  },
};

export { pageActionRowNavigationExecutorToUrl };
