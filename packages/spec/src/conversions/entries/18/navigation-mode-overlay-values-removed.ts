// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `navigation-mode-overlay-values-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helper
// `NAVIGATION_CARRIER_BLOCK_TYPES` is read by this conversion alone). A LEAF:
// it imports neither `registry.ts` nor another conversion's module.
// `registry.ts` imports `navigationModeOverlayValuesRemoved` and lists it where
// it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, mapPageComponents, mapPages, mapViewPayloads } from '../../walk.js';
import { type Dict, isDict } from '../shared.js';

/**
 * The page component types whose `properties.navigation` is the list view's
 * own `NavigationConfigSchema` — the members
 * {@link navigationModeOverlayValuesRemoved} reaches on a page, beside the
 * list views and the list page's `interfaceConfig.recordAction`.
 */
const NAVIGATION_CARRIER_BLOCK_TYPES: ReadonlySet<unknown> = new Set([
  'list-view',
  'object-grid',
  'object-kanban',
  'object-calendar',
  'object-map',
  'object-gantt',
  'object-tree',
  'object-timeline',
]);

/**
 * The record-open overlay members `modal`, `split` and `popover` leave
 * `navigation.mode`, and `modal` leaves `interfaceConfig.recordAction`
 * (protocol 18, #26677 — maintainer ruling 2026-10-27, record-page-v2 epic
 * ruling 1: one default way to open a record per object, the drawer, which
 * expands to the full page; `page` only where it is declared; `modal`
 * retired; split and popover become a reader's own preference).
 *
 * Authoring refuses each member by name (`enumWithRetiredValues` on
 * `NavigationModeSchema`, `ui/view.zod.ts`, and on `recordAction`,
 * `ui/page.zod.ts`), and the navigation block's `mode` now defaults to
 * `drawer`. Deleting the retired member is therefore the whole edit: the block
 * lands on the drawer, which is exactly what the prescription tells an author
 * to do by hand — the conversion invents no mode. Every other key of the block
 * (`size`, `width`, `openNewTab`, `preventNavigation`) stays; a block left
 * with no key at all stays as an empty block, the same choice
 * `add-record-mode-form-view-removed` makes for its own container.
 *
 * Reach — every carrier of `NavigationConfigSchema` and of `recordAction`:
 *
 * - a view's list payloads, in all three persisted spellings
 *   ({@link mapViewPayloads});
 * - an object's `listViews.*`;
 * - a page's `interfaceConfig.recordAction`;
 * - a page node of {@link NAVIGATION_CARRIER_BLOCK_TYPES}, `properties.navigation`.
 *
 * Studio's list-view inspector offered every `NavigationModeSchema` member in
 * its click-to-open select and `PUT /meta/view` persisted the choice, so
 * stored `view` rows CAN carry a retired member; `applyConversionsToStoredItem`
 * replays this entry over them. **Retired from the load path from day one**,
 * as {@link addRecordModeFormViewRemoved} is: a live author meets the parse's
 * prescription, and this entry serves the two paths that rewrite EXISTING
 * data, stored-row rehydration and `os migrate meta`. Idempotent by
 * construction: a converted block carries no retired member.
 *
 * The D3 entry `ui-record-open-overlay-modes-retired` carries what the edit
 * cannot decide: whether an object that opened as a centred dialog should
 * declare `page` instead of taking the drawer.
 */
const navigationModeOverlayValuesRemoved: MetadataConversion = {
  id: 'navigation-mode-overlay-values-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface:
    "view.list.navigation.mode / object.listViews.*.navigation.mode / page.component.<list block>.navigation.mode "
    + "('modal' | 'split' | 'popover') / page.interfaceConfig.recordAction ('modal')",
  summary:
    "record-open overlay modes removed: `navigation.mode` 'modal' / 'split' / 'popover' and "
    + "`interfaceConfig.recordAction` 'modal' (an object opens its records one way — the drawer, which "
    + 'expands to the full page, by default, or the full page where `page` is declared; a side-by-side '
    + 'pane is a reader\'s own preference). The retired member is deleted, which lands the block on the '
    + '`drawer` default',
  apply(stack, emit) {
    const RETIRED_MODES: ReadonlySet<unknown> = new Set(['modal', 'split', 'popover']);
    const inPayload = (payload: Dict, path: string): Dict => {
      const block = payload.navigation;
      if (!isDict(block) || !RETIRED_MODES.has(block.mode)) return payload;
      emit({ from: String(block.mode), to: '(removed)', path: `${path}.navigation.mode` });
      const nextBlock: Dict = { ...block };
      delete nextBlock.mode;
      return { ...payload, navigation: nextBlock };
    };

    let next = mapViewPayloads(stack, (payload, kind, path) => (kind === 'list' ? inPayload(payload, path) : payload));

    next = mapCollection(next, 'objects', (obj, path) => {
      const listViews = obj.listViews;
      if (!isDict(listViews)) return obj;
      let changed = false;
      const rebuilt: Dict = { ...listViews };
      for (const [name, entry] of Object.entries(listViews)) {
        if (!isDict(entry)) continue;
        const mapped = inPayload(entry, `${path}.listViews.${name}`);
        if (mapped === entry) continue;
        rebuilt[name] = mapped;
        changed = true;
      }
      return changed ? { ...obj, listViews: rebuilt } : obj;
    });

    next = mapPages(next, (page, path) => {
      const cfg = page.interfaceConfig;
      if (!isDict(cfg) || cfg.recordAction !== 'modal') return page;
      emit({ from: 'modal', to: '(removed)', path: `${path}.interfaceConfig.recordAction` });
      const nextCfg: Dict = { ...cfg };
      delete nextCfg.recordAction;
      return { ...page, interfaceConfig: nextCfg };
    });

    return mapPageComponents(next, (component, path) => {
      if (!NAVIGATION_CARRIER_BLOCK_TYPES.has(component.type) || !isDict(component.properties)) return component;
      const props = component.properties;
      const mapped = inPayload(props, `${path}.properties`);
      return mapped === props ? component : { ...component, properties: mapped };
    });
  },
  fixture: {
    before: {
      views: [
        {
          object: 'nav_contact',
          // A retired mode beside other navigation keys: only `mode` goes.
          list: { type: 'grid', columns: ['name'], navigation: { mode: 'modal', size: 'lg' } },
          listViews: {
            // A block whose only key was the retired mode: it stays, empty.
            beside: { type: 'grid', columns: ['name'], navigation: { mode: 'split' } },
            // Live members ride through by reference.
            full: { type: 'grid', columns: ['name'], navigation: { mode: 'page' } },
            peek: { type: 'grid', columns: ['name'], navigation: { mode: 'drawer', size: 'md' } },
          },
        },
      ],
      objects: [
        { name: 'nav_contact', label: 'Contact', listViews: { quick: { type: 'grid', columns: ['name'], navigation: { mode: 'popover' } } } },
      ],
      pages: [
        {
          name: 'nav_contacts',
          label: 'Contacts',
          type: 'list',
          interfaceConfig: { source: 'nav_contact', recordAction: 'modal' },
        },
        {
          name: 'nav_people',
          label: 'People',
          type: 'list',
          // A live recordAction is left alone.
          interfaceConfig: { source: 'nav_contact', recordAction: 'page' },
        },
        {
          name: 'nav_board',
          label: 'Board',
          regions: [{
            name: 'main',
            components: [
              { type: 'object-kanban', properties: { objectName: 'nav_contact', navigation: { mode: 'popover', openNewTab: false } } },
              // Not a navigation carrier: an unrelated `navigation` member is not this entry's.
              { type: 'page:card', properties: { title: 'Note', navigation: { mode: 'modal' } } },
            ],
          }],
        },
      ],
    },
    after: {
      views: [
        {
          object: 'nav_contact',
          list: { type: 'grid', columns: ['name'], navigation: { size: 'lg' } },
          listViews: {
            beside: { type: 'grid', columns: ['name'], navigation: {} },
            full: { type: 'grid', columns: ['name'], navigation: { mode: 'page' } },
            peek: { type: 'grid', columns: ['name'], navigation: { mode: 'drawer', size: 'md' } },
          },
        },
      ],
      objects: [
        { name: 'nav_contact', label: 'Contact', listViews: { quick: { type: 'grid', columns: ['name'], navigation: {} } } },
      ],
      pages: [
        {
          name: 'nav_contacts',
          label: 'Contacts',
          type: 'list',
          interfaceConfig: { source: 'nav_contact' },
        },
        {
          name: 'nav_people',
          label: 'People',
          type: 'list',
          interfaceConfig: { source: 'nav_contact', recordAction: 'page' },
        },
        {
          name: 'nav_board',
          label: 'Board',
          regions: [{
            name: 'main',
            components: [
              { type: 'object-kanban', properties: { objectName: 'nav_contact', navigation: { openNewTab: false } } },
              { type: 'page:card', properties: { title: 'Note', navigation: { mode: 'modal' } } },
            ],
          }],
        },
      ],
    },
    // One notice per retired member removed: the view's `list` (1), its
    // `listViews.beside` (1), the object's `listViews.quick` (1), the list
    // page's `recordAction` (1), the kanban node's `navigation` (1).
    expectedNotices: 5,
  },
};

export { navigationModeOverlayValuesRemoved };
