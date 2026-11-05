// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-list-view-object-name-view-type-to-data-type`
// conversion (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageListViewObjectNameViewTypeToDataType` and lists it where it
// stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents, renameKey } from '../../walk.js';
import { isDict } from '../shared.js';

/**
 * A page `list-view` node's `properties.objectName` → `properties.data`, and its
 * `properties.viewType` → `properties.type` (protocol 18, #22444; ruling C, the
 * maintainer's 「同意」: the page carrier converges on the spec spelling, and
 * stored nodes in the old spelling are carried by this conversion, ⛔ never by a
 * fallback read in objectui).
 *
 * The page carrier spelled a list view's binding and kind its own way —
 * `objectName` and `viewType`, the two words the react tier retired on
 * `ListView` with no window — while every other list view door spells them
 * `data` and `type`. The pinned console reads only the spec spelling off a page
 * `list-view` node (objectui#12668), and the node's props row
 * (`ComponentPropsMap['list-view']`) refuses both aliases by name.
 *
 * ## What converts
 *
 * - `objectName: 'deal'` (a non-empty string) → `data: { provider: 'object',
 *   object: 'deal' }`, the list view's own object source — the meaning the
 *   console's old fold gave the alias. When `data` already names the same
 *   object through the `object` provider, the alias is a redundant twin and is
 *   deleted.
 * - `viewType: 'kanban'` → `type: 'kanban'` (the value carried verbatim; the
 *   row judges it against the list view's kind enum). When `type` already
 *   holds the same value, the alias is a redundant twin and is deleted.
 *
 * ## What is left exactly as stored — reported as a TODO
 *
 * An alias that is not a non-empty string, an `objectName` beside a `data`
 * source that names something else, an `objectName` beside a node-level
 * `dataSource.object` that names a different object, and a `viewType` beside a
 * different `type`. Each is two answers to one question, and which one the
 * author meant is not a walker's call; the row refuses the alias by name, so
 * the next save asks the author.
 *
 * ## Reach
 *
 * Every page component {@link mapPageComponents} visits (regions, slots,
 * nested containers such as `page:tabs` items) whose `type` is `list-view`.
 * The same keys on any other component are not this entry's surface: an
 * `object-grid`'s `objectName` is that row's own declared binding.
 *
 * ## Why `retiredFromLoadPath`
 *
 * An author writing either alias meets the row's refusal, which names the
 * spelling, instead of having it quietly rewritten at `defineStack` /
 * `validate`. Data at rest has no author to teach: stored `sys_metadata` rows
 * (`applyConversionsToStoredItem`), the artifact-ingestion door and the
 * package registration door replay this, and `os migrate meta --write`
 * rewrites a source where it can prove the edit. The paired D3 entry is
 * `page-list-view-object-name-view-type-retired`.
 */
const pageListViewObjectNameViewTypeToDataType: MetadataConversion = {
  id: 'page-list-view-object-name-view-type-to-data-type',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.component(list-view).properties.objectName / .viewType',
  summary:
    "a page `list-view` node's `properties.objectName` becomes `properties.data: { provider: 'object', "
    + "object }` and its `properties.viewType` becomes `properties.type` — the list view's own spelling of "
    + 'its object source and its kind, which every other list view door uses (one list view, one set of '
    + 'property names wherever it is embedded); an alias that disagrees with the spec spelling beside it is '
    + 'left as stored and reported as a TODO',
  apply(stack, emit, context) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'list-view' || !isDict(component.properties)) return component;
      const base = `${path}.properties`;
      const leave = (key: string, value: unknown, why: string) => {
        context?.reportTodo?.({
          path: `${base}.${key}`,
          from: JSON.stringify(value),
          reason: `On this page \`list-view\`, \`${key}\` ${why} Left as stored; the node's props refuse \`${key}\` `
            + 'by name, so rewrite it by hand.',
        });
      };

      let props = component.properties;

      if ('objectName' in props) {
        const objectName = props.objectName;
        const data = props.data;
        const bound = isDict(component.dataSource) ? component.dataSource.object : undefined;
        if (typeof objectName !== 'string' || objectName === '') {
          leave('objectName', objectName, 'is not an object name.');
        } else if (typeof bound === 'string' && bound !== '' && bound !== objectName) {
          leave('objectName', objectName, `names a different object than the node's \`dataSource.object\` (\`${bound}\`).`);
        } else if (data === undefined) {
          const source = { provider: 'object', object: objectName };
          const { objectName: _alias, ...rest } = props;
          props = { ...rest, data: source };
          emit({ from: JSON.stringify(objectName), to: JSON.stringify(source), path: `${base}.data` });
        } else if (isDict(data) && data.provider === 'object' && data.object === objectName) {
          const { objectName: _twin, ...rest } = props;
          props = rest;
          emit({ from: JSON.stringify(objectName), to: JSON.stringify(data), path: `${base}.data` });
        } else {
          leave('objectName', objectName, 'sits beside a `data` source that does not name the same object.');
        }
      }

      if ('viewType' in props) {
        const viewType = props.viewType;
        const renamed = typeof viewType === 'string' && viewType !== '' ? renameKey(props, 'viewType', 'type') : null;
        if (renamed) {
          props = renamed;
          emit({ from: JSON.stringify(viewType), to: JSON.stringify(viewType), path: `${base}.type` });
        } else {
          leave(
            'viewType',
            viewType,
            typeof viewType === 'string' && viewType !== ''
              ? `sits beside a different \`type\` (${JSON.stringify(props.type)}).`
              : 'is not a list kind.',
          );
        }
      }

      return props === component.properties ? component : { ...component, properties: props };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'sales_home',
          label: 'Sales Home',
          regions: [
            {
              name: 'main',
              components: [
                // The shipped shape: both aliases on one node.
                {
                  type: 'list-view',
                  id: 'open_deals',
                  properties: {
                    objectName: 'deal',
                    viewType: 'kanban',
                    columns: ['name', 'amount'],
                    kanban: { groupByField: 'stage', columns: ['name'] },
                  },
                },
                // Nested in a tab: reached, and a redundant twin is deleted.
                {
                  type: 'page:tabs',
                  properties: {
                    items: [
                      {
                        label: 'Leads',
                        children: [
                          {
                            type: 'list-view',
                            properties: {
                              objectName: 'lead',
                              data: { provider: 'object', object: 'lead' },
                              viewType: 'grid',
                              type: 'grid',
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
                // Two answers to one question: left as stored, reported.
                {
                  type: 'list-view',
                  properties: {
                    objectName: 'deal',
                    data: { provider: 'object', object: 'account' },
                    viewType: 'kanban',
                    type: 'gallery',
                  },
                },
                // Another component's `objectName` is its own binding: untouched.
                { type: 'object-grid', properties: { objectName: 'deal' } },
              ],
            },
          ],
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'sales_home',
          label: 'Sales Home',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'list-view',
                  id: 'open_deals',
                  properties: {
                    columns: ['name', 'amount'],
                    kanban: { groupByField: 'stage', columns: ['name'] },
                    data: { provider: 'object', object: 'deal' },
                    type: 'kanban',
                  },
                },
                {
                  type: 'page:tabs',
                  properties: {
                    items: [
                      {
                        label: 'Leads',
                        children: [
                          {
                            type: 'list-view',
                            properties: {
                              data: { provider: 'object', object: 'lead' },
                              type: 'grid',
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
                {
                  type: 'list-view',
                  properties: {
                    objectName: 'deal',
                    data: { provider: 'object', object: 'account' },
                    viewType: 'kanban',
                    type: 'gallery',
                  },
                },
                { type: 'object-grid', properties: { objectName: 'deal' } },
              ],
            },
          ],
        },
      ],
    },
    // Two per converted node — its `objectName` and its `viewType` — on the
    // region node and the nested one. The conflicting node and the grid emit none.
    expectedNotices: 4,
  },
};

export { pageListViewObjectNameViewTypeToDataType };
