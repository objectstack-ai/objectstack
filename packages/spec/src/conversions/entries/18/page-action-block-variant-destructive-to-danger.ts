// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-action-block-variant-destructive-to-danger`
// conversion (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageActionBlockVariantDestructiveToDanger` and lists it where it
// stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { ACTION_CONTAINER_BLOCK_TYPES, ACTION_RUNNER_BLOCK_TYPES, isDict } from '../shared.js';

/**
 * An action block's `variant: 'destructive'` → `'danger'` (protocol 18, #26779).
 *
 * The action variant was spelled in two dialects. `ActionSchema.variant`, the
 * declaration the action runner dispatches, says `danger`; the four action
 * blocks' rows (`action:button`, `action:icon`, `action:group`, `action:menu`
 * and the containers' members) took the Button primitive's word,
 * `destructive`, and refused `danger`. So one destructive action changed
 * spelling between a declaration and a block, and each block renderer mapped
 * `destructive` onto `danger` at its forward to the runner (#26665). The rows
 * now take `danger` and refuse `destructive` with the rename
 * (`refuseActionBlockDestructiveVariant`, `ui/component.zod.ts`).
 *
 * **Lossless**: on a block both spellings draw the primitive's destructive
 * button and ask a `confirmText` question through the destructive confirm
 * button, so the rewrite changes no rendering and no run. A page's
 * `properties` is not parsed on the metadata load path, so a stored page
 * written with `destructive` keeps rendering only while a renderer keeps the
 * old word; this entry carries it across at the stored-row seam, the
 * artifact door and `os migrate meta --write`, which is why the block
 * renderers forward `danger` directly and keep no `destructive` bridge.
 *
 * Its surfaces are value renames and nothing else: `properties.variant` on
 * each of the four block nodes (the containers' own value is their trigger's),
 * and `variant` on each `action:group` / `action:menu` member of
 * `properties.actions`. `action:bar` is visited too, though it has no row
 * here: the bar spreads each member of `properties.actions` and
 * `properties.systemActions` onto an `action:button` (or folds it into its
 * `action:menu`) with `variant: member.variant || properties.variant`, so a
 * stored bar written `destructive` reaches the block renderers, which no
 * longer read that word, and would fall back to a plain button with no
 * refusal anywhere to say so. Its own `variant` and its members' are renamed
 * as the four blocks' are. Every other value is left alone, and so is every
 * other component type, which this entry never reads: `element:button`
 * already spells the arm `danger` and refuses `destructive`, and the record
 * blocks that forward a variant to the Button primitive unchanged
 * (`record:quick_actions`, a `record:alert` action) keep the primitive's own
 * `destructive`. A member that is not an object, or a list that is not an
 * array, is left as stored. The reach is every position `mapPageComponents`
 * visits — regions, slots, nested containers — the props gate's own reach.
 * Idempotent by construction: a rewritten value reads `'danger'`, which this
 * entry never touches.
 *
 * **Retired from the load path from day one**, as
 * {@link pageActionRowNavigationExecutorToUrl} is: the authoring door teaches
 * with the rows' refusal, and this entry serves the paths that rewrite
 * EXISTING data.
 */
const pageActionBlockVariantDestructiveToDanger: MetadataConversion = {
  id: 'page-action-block-variant-destructive-to-danger',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface: 'page.component.action:button.variant / page.component.action:icon.variant / '
    + 'page.component.action:group.variant / page.component.action:menu.variant / '
    + 'page.component.action:group.actions[].variant / page.component.action:menu.actions[].variant / '
    + 'page.component.action:bar.variant / page.component.action:bar.actions[].variant / '
    + 'page.component.action:bar.systemActions[].variant',
  summary:
    "action block variant 'destructive' → 'danger' — the spelling ActionSchema.variant and the action runner "
    + 'use; on a block both draw the destructive button and confirm through the destructive confirm button, '
    + 'so the rename is lossless',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      const type = component.type;
      if (typeof type !== 'string') return component;
      const memberLists = ACTION_CONTAINER_BLOCK_TYPES.has(type)
        ? ['actions'] as const
        : type === 'action:bar'
          ? ['actions', 'systemActions'] as const
          : ACTION_RUNNER_BLOCK_TYPES.has(type) ? [] as const : undefined;
      if (!memberLists) return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      let next = properties;
      if (properties.variant === 'destructive') {
        emit({ from: 'destructive', to: 'danger', path: `${path}.properties.variant` });
        next = { ...next, variant: 'danger' };
      }
      for (const key of memberLists) {
        const members = properties[key];
        if (!Array.isArray(members)) continue;
        let changed = false;
        const nextMembers = members.map((member, i) => {
          if (!isDict(member) || member.variant !== 'destructive') return member;
          changed = true;
          emit({ from: 'destructive', to: 'danger', path: `${path}.properties.${key}[${i}].variant` });
          return { ...member, variant: 'danger' };
        });
        if (changed) next = { ...next, [key]: nextMembers };
      }
      return next === properties ? component : { ...component, properties: next };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'ops_cleanup',
          regions: [
            {
              name: 'main',
              components: [
                // The measured shape: a destructive button with a confirm question.
                {
                  type: 'action:button',
                  properties: { label: 'Purge', actionType: 'script', variant: 'destructive', confirmText: 'This cannot be undone.' },
                },
                { type: 'action:icon', properties: { icon: 'trash', actionType: 'script', variant: 'destructive' } },
                // Canonical already, and another value: untouched.
                { type: 'action:button', properties: { label: 'Archive', actionType: 'script', variant: 'danger' } },
                { type: 'action:button', properties: { label: 'Open', actionType: 'url', target: '/apps/ops', variant: 'outline' } },
                // Another component type: not this entry's, whatever it holds (its own row refuses `destructive`).
                { type: 'element:button', properties: { label: 'Reset', variant: 'destructive' } },
                // A container's trigger and one of its members: both renamed, the other member untouched.
                {
                  type: 'action:group',
                  properties: {
                    variant: 'destructive',
                    actions: [
                      { label: 'Delete', type: 'script', variant: 'destructive' },
                      { label: 'Copy', type: 'script', variant: 'ghost' },
                    ],
                  },
                },
                // Nested one container down.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Danger zone',
                    children: [
                      { type: 'action:menu', properties: { actions: [{ label: 'Drop', type: 'script', variant: 'destructive' }] } },
                    ],
                  },
                },
                // A bar: no row of its own, but its members reach the block renderers.
                {
                  type: 'action:bar',
                  properties: {
                    actions: [{ name: 'purge', label: 'Purge', type: 'script', variant: 'destructive' }],
                    systemActions: [{ name: 'sys_delete', label: 'Delete', type: 'script', variant: 'destructive' }],
                  },
                },
              ],
            },
          ],
        },
        // A slotted record page's named slot.
        {
          name: 'ops_cleanup_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'action:icon', properties: { icon: 'trash', actionType: 'script', variant: 'destructive' } },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'ops_cleanup',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'action:button',
                  properties: { label: 'Purge', actionType: 'script', variant: 'danger', confirmText: 'This cannot be undone.' },
                },
                { type: 'action:icon', properties: { icon: 'trash', actionType: 'script', variant: 'danger' } },
                { type: 'action:button', properties: { label: 'Archive', actionType: 'script', variant: 'danger' } },
                { type: 'action:button', properties: { label: 'Open', actionType: 'url', target: '/apps/ops', variant: 'outline' } },
                { type: 'element:button', properties: { label: 'Reset', variant: 'destructive' } },
                {
                  type: 'action:group',
                  properties: {
                    variant: 'danger',
                    actions: [
                      { label: 'Delete', type: 'script', variant: 'danger' },
                      { label: 'Copy', type: 'script', variant: 'ghost' },
                    ],
                  },
                },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Danger zone',
                    children: [
                      { type: 'action:menu', properties: { actions: [{ label: 'Drop', type: 'script', variant: 'danger' }] } },
                    ],
                  },
                },
                {
                  type: 'action:bar',
                  properties: {
                    actions: [{ name: 'purge', label: 'Purge', type: 'script', variant: 'danger' }],
                    systemActions: [{ name: 'sys_delete', label: 'Delete', type: 'script', variant: 'danger' }],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'ops_cleanup_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'action:icon', properties: { icon: 'trash', actionType: 'script', variant: 'danger' } },
          },
        },
      ],
    },
    // The button, the icon, the group's trigger, the group member, the nested
    // menu member, the bar's two members and the slotted header icon.
    expectedNotices: 8,
  },
};

export { pageActionBlockVariantDestructiveToDanger };
