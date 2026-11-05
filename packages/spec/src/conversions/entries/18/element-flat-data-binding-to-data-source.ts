// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `element-flat-data-binding-to-data-source` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helpers
// `ELEMENT_FLAT_BINDING_KEYS_BY_TYPE`, `isRuleObjectArray`,
// `FlatBindingDisposition`, `flatBindingDisposition` are read by this
// conversion alone). A LEAF: it imports neither `registry.ts` nor another
// conversion's module. `registry.ts` imports
// `elementFlatDataBindingToDataSource` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { deepEqualAuthored } from '../../../shared/deep-equal.js';
import { type Dict, describeBlock, isDict, stripKeys } from '../shared.js';

/**
 * The element layer's retired flat data-binding keys, per element type — the
 * keys {@link elementFlatDataBindingToDataSource} moves onto the node-level
 * `dataSource`. Declared here rather than imported from
 * `ui/component.zod.ts`, whose list is module-private (exporting it would widen
 * a retirement that only narrows) and which this module is kept free of, so
 * the page-component schemas are not dragged into every bundle of the
 * `./shared` entry (see {@link CONVERSIONS_BY_MAJOR}).
 * `element-flat-data-binding-to-data-source.test.ts` holds this list equal to
 * the tombstones `ComponentPropsMap` carries.
 */
const ELEMENT_FLAT_BINDING_KEYS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  'element:record_picker': ['object', 'filter', 'sort', 'limit'],
  'element:number': ['object', 'filter'],
  'element:repeater': ['object', 'filter', 'sort', 'limit'],
};

/** A rule array, as far as a mechanical append can tell: an array of plain objects. */
function isRuleObjectArray(value: unknown): value is Dict[] {
  return Array.isArray(value) && value.every(isDict);
}

/**
 * What {@link elementFlatDataBindingToDataSource} does with one flat key, by
 * the element's OLD resolution of it — the rule each renderer applied before
 * objectui#11880 moved all three onto `dataSource` alone:
 *
 * - `element:record_picker`, and `element:number`'s `object`: the binding (or
 *   the saved view it names) first, the flat key second
 *   (`composed?.<key> ?? props.<key>`);
 * - `element:number`'s `filter`: AND-combined with the binding's;
 * - `element:repeater`: the flat keys ONLY — the binding was not read at all
 *   (objectui#11880 then put the binding first, keeping the flat keys as a
 *   fallback, so a value the two disagree on was applied differently by the
 *   two console versions).
 */
type FlatBindingDisposition =
  | { kind: 'move' }
  | { kind: 'drop' }
  | { kind: 'append'; rules: Dict[] }
  | { kind: 'todo'; reason: string };

function flatBindingDisposition(
  type: string,
  key: string,
  value: unknown,
  binding: Dict | undefined,
): FlatBindingDisposition {
  const bound = binding !== undefined && binding[key] !== undefined;
  const view = binding && typeof binding.view === 'string' && binding.view.length > 0 ? binding.view : undefined;

  if (type === 'element:repeater') {
    if (bound) {
      if (deepEqualAuthored(binding![key], value)) return { kind: 'drop' };
      return {
        kind: 'todo',
        reason: `\`dataSource.${key}\` is set to a different value than this flat \`${key}\`. The list read `
          + 'only its flat keys until the console moved it onto the binding, and reads the binding first since, '
          + 'so which of the two it applied depends on the console version. Keep the value you mean in '
          + `\`dataSource.${key}\` and delete this key.`,
      };
    }
    if (view !== undefined && key !== 'object') {
      return {
        kind: 'todo',
        reason: `the binding names the saved view \`${view}\`, which the list did not read until the console `
          + `moved it onto the binding. On the binding, this \`${key}\` combines with the view's own (a filter `
          + 'ANDs, a sort or a limit overrides it), which an older console never applied. Decide whether the list '
          + `should apply the view, then write the \`${key}\` you mean on \`dataSource\` and delete this key.`,
      };
    }
    return { kind: 'move' };
  }

  if (type === 'element:number' && key === 'filter') {
    if (!bound) return { kind: 'move' };
    if (isRuleObjectArray(binding!.filter) && isRuleObjectArray(value)) {
      return { kind: 'append', rules: [...binding!.filter, ...value] };
    }
    return {
      kind: 'todo',
      reason: 'this flat `filter` and `dataSource.filter` both carry rules, and the element AND-combined '
        + 'them; one of the two is not a rule array, so they cannot be appended mechanically. Write the rules '
        + 'of both into `dataSource.filter` (they AND) and delete this key.',
    };
  }

  // `element:record_picker`, and `element:number`'s `object`.
  if (bound) return { kind: 'drop' };
  if (view !== undefined && key !== 'object') {
    return {
      kind: 'todo',
      reason: `this flat \`${key}\` sits beside \`dataSource.view: '${view}'\`, and the binding sets no \`${key}\` `
        + 'of its own. It was read only when that view supplied none, so whether it ever applied depends on '
        + `the view, which no conversion reads. If the view sets no \`${key}\`, move this one to `
        + `\`dataSource.${key}\`; if it does, delete it.`,
    };
  }
  return { kind: 'move' };
}

/**
 * The element layer's flat data-binding keys move onto the node-level
 * `dataSource` binding (protocol 18, #11509 — ruling A-narrow: in v18 an
 * element binds data through `dataSource` only, so one node carries one door
 * with one precedence).
 *
 * Ten keys on three elements: `element:record_picker` `object` / `filter` /
 * `sort` / `limit`, `element:number` `object` / `filter`, and
 * `element:repeater` `object` / `filter` / `sort` / `limit`. Each was the
 * same query as a key of `ElementDataSourceSchema`, resolved per renderer by
 * three different rules, and objectui#11880 (objectui `5bc55c0c5a1e`) moved
 * all three renderers onto the binding — the picker and `element:number` read
 * it alone, the repeater reads it first and keeps its flat keys as a fallback
 * — in the order the ruling set, so this rewrite never moves a working list's
 * query into a position its renderer does not read.
 *
 * Mechanical where the OLD rule decides the answer
 * ({@link flatBindingDisposition}):
 *
 * - the binding lacks the key → the value MOVES there, unchanged;
 * - the record picker (and `element:number`'s `object`) where the binding
 *   already sets the key → the flat key is DELETED: the binding always won,
 *   so the flat value never applied;
 * - `element:number`'s `filter` beside the binding's → APPENDED to it: the
 *   renderer AND-combined the two, and a rule array is an AND;
 * - the repeater where the binding already holds the SAME value → deleted.
 *
 * Left as stored, and reported as a TODO, where it does not: a record-picker
 * key the binding lacks beside a `dataSource.view` (whether the view's own key
 * displaced it depends on the view, which no conversion reads); a repeater key
 * the binding sets to a different value, or beside a `view` (the repeater read
 * neither before objectui#11880 and reads the binding first since, so what it
 * applied depends on the console version); and an `element:number` filter pair
 * that is not two rule arrays. A
 * key left as stored no longer reaches a query, and its tombstone refuses it
 * at the next parse with the same prescription.
 *
 * Runs BEFORE `page-component-filter-record-to-rule-array` (order 35.5, below
 * its 36): a flat `filter` in the retired record form moves onto
 * `dataSource.filter`, where that entry converts it like any other binding
 * filter — so neither entry carries an element-layer `properties.filter` arm.
 *
 * Retired from the load path: an author writing a flat key is refused at the
 * parse with the prescription; stored rows, artifacts and
 * `os migrate meta --from 17` replay it. Idempotent by construction — a node
 * with no flat key left is returned by reference.
 */
const elementFlatDataBindingToDataSource: MetadataConversion = {
  id: 'element-flat-data-binding-to-data-source',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface:
    'page.component.element:record_picker.object / page.component.element:record_picker.filter / '
    + 'page.component.element:record_picker.sort / page.component.element:record_picker.limit / '
    + 'page.component.element:number.object / page.component.element:number.filter / '
    + 'page.component.element:repeater.object / page.component.element:repeater.filter / '
    + 'page.component.element:repeater.sort / page.component.element:repeater.limit',
  summary:
    "the element layer's flat data-binding keys removed — 'object' / 'filter' / 'sort' / 'limit' on "
    + "element:record_picker and element:repeater, 'object' / 'filter' on element:number — each the "
    + "same query as a key of the node-level 'dataSource' binding, the one door the element reads: a "
    + 'key the binding lacks moves there unchanged, one the binding already set is deleted where the '
    + "binding always won (and element:number's filter is appended to the binding's, since the two "
    + "always AND-combined); a key whose effect depended on a saved 'dataSource.view', or that "
    + "disagrees with a binding the repeater never read, is left as stored and reported as a TODO",
  apply(stack, emit, context) {
    return mapPageComponents(stack, (component, path) => {
      const type = component.type;
      if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(ELEMENT_FLAT_BINDING_KEYS_BY_TYPE, type)) return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const keys = ELEMENT_FLAT_BINDING_KEYS_BY_TYPE[type]!.filter((key) => key in properties);
      if (keys.length === 0) return component;

      const original = isDict(component.dataSource) ? component.dataSource : undefined;
      let binding = original;
      let props: Dict = properties;
      const block = describeBlock(component);

      for (const key of keys) {
        const value = props[key];
        const disposition = value === undefined
          ? ({ kind: 'drop' } as const)
          : flatBindingDisposition(type, key, value, binding);
        switch (disposition.kind) {
          case 'todo':
            context?.reportTodo?.({
              path: `${path}.properties.${key}`,
              from: JSON.stringify(value),
              reason: `On ${block}, ${disposition.reason} Left as stored, this key reaches no query.`,
            });
            continue;
          case 'drop':
            props = stripKeys(props, [key], emit, `${path}.properties`);
            continue;
          case 'append': {
            const { [key]: _appended, ...rest } = props;
            props = rest;
            binding = { ...binding, filter: disposition.rules };
            emit({ from: `properties.${key}`, to: `dataSource.${key} (rules appended; they AND)`, path: `${path}.dataSource.${key}` });
            continue;
          }
          case 'move': {
            const { [key]: _moved, ...rest } = props;
            props = rest;
            binding = { ...binding, [key]: value };
            emit({ from: `properties.${key}`, to: `dataSource.${key}`, path: `${path}.dataSource.${key}` });
            continue;
          }
        }
      }

      if (props === properties) return component;
      return binding === original
        ? { ...component, properties: props }
        : { ...component, dataSource: binding, properties: props };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'deal_desk',
          regions: [
            {
              name: 'main',
              components: [
                // No binding: all four flat keys move onto a new one.
                {
                  type: 'element:record_picker',
                  id: 'p1',
                  properties: {
                    object: 'deal',
                    labelField: 'name',
                    filter: [{ field: 'stage', operator: 'equals', value: 'open' }],
                    sort: [{ field: 'amount', order: 'desc' }],
                    limit: 20,
                  },
                },
                // The binding already names the object: the flat one never
                // applied (the binding won) and is deleted; the binding lacks a
                // limit, so the flat one moves.
                {
                  type: 'element:record_picker',
                  id: 'p2',
                  dataSource: { object: 'deal' },
                  properties: { object: 'lead', limit: 10 },
                },
                // Beside a saved view the binding sets no filter of its own:
                // whether the flat filter ever applied depends on the view, so
                // it is left as stored — a TODO, no notice.
                {
                  type: 'element:record_picker',
                  id: 'p3',
                  dataSource: { object: 'deal', view: 'hot_deals' },
                  properties: { filter: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }] },
                },
                {
                  type: 'page:card',
                  properties: {
                    children: [
                      // Nested, no binding: `object` and `filter` move.
                      {
                        type: 'element:number',
                        id: 'n1',
                        properties: {
                          object: 'deal',
                          aggregate: 'count',
                          filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
                        },
                      },
                      // Both filters set: the element AND-combined them, so the
                      // flat rules are appended to the binding's.
                      {
                        type: 'element:number',
                        id: 'n2',
                        dataSource: { object: 'deal', filter: [{ field: 'stage', operator: 'equals', value: 'won' }] },
                        properties: {
                          aggregate: 'sum',
                          field: 'amount',
                          filter: [{ field: 'amount', operator: 'greater_than', value: 0 }],
                        },
                      },
                    ],
                  },
                },
                // `object` on an element outside the family (the metadata
                // owner of a viewer) is not this entry's key.
                {
                  type: 'element:metadata_viewer',
                  properties: { type: 'state_machine', name: 'deal_stage', object: 'deal' },
                },
              ],
            },
          ],
        },
        // The named-slot shape: a repeater, which read its flat keys alone
        // before the console put its binding first.
        {
          name: 'deal_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            side: {
              type: 'element:repeater',
              id: 'r1',
              properties: {
                object: 'deal_note',
                titleField: 'subject',
                filter: [{ field: 'pinned', operator: 'equals', value: true }],
                sort: [{ field: 'created_at', order: 'desc' }],
                limit: 5,
              },
            },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'deal_desk',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'element:record_picker',
                  id: 'p1',
                  properties: { labelField: 'name' },
                  dataSource: {
                    object: 'deal',
                    filter: [{ field: 'stage', operator: 'equals', value: 'open' }],
                    sort: [{ field: 'amount', order: 'desc' }],
                    limit: 20,
                  },
                },
                {
                  type: 'element:record_picker',
                  id: 'p2',
                  dataSource: { object: 'deal', limit: 10 },
                  properties: {},
                },
                {
                  type: 'element:record_picker',
                  id: 'p3',
                  dataSource: { object: 'deal', view: 'hot_deals' },
                  properties: { filter: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }] },
                },
                {
                  type: 'page:card',
                  properties: {
                    children: [
                      {
                        type: 'element:number',
                        id: 'n1',
                        properties: { aggregate: 'count' },
                        dataSource: {
                          object: 'deal',
                          filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
                        },
                      },
                      {
                        type: 'element:number',
                        id: 'n2',
                        dataSource: {
                          object: 'deal',
                          filter: [
                            { field: 'stage', operator: 'equals', value: 'won' },
                            { field: 'amount', operator: 'greater_than', value: 0 },
                          ],
                        },
                        properties: { aggregate: 'sum', field: 'amount' },
                      },
                    ],
                  },
                },
                {
                  type: 'element:metadata_viewer',
                  properties: { type: 'state_machine', name: 'deal_stage', object: 'deal' },
                },
              ],
            },
          ],
        },
        {
          name: 'deal_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            side: {
              type: 'element:repeater',
              id: 'r1',
              properties: { titleField: 'subject' },
              dataSource: {
                object: 'deal_note',
                filter: [{ field: 'pinned', operator: 'equals', value: true }],
                sort: [{ field: 'created_at', order: 'desc' }],
                limit: 5,
              },
            },
          },
        },
      ],
    },
    // One per flat key moved, deleted or appended: 4 on `p1`, 2 on `p2`, 0 on
    // `p3` (its TODO), 2 on `n1`, 1 on `n2`, 4 on `r1`.
    expectedNotices: 13,
  },
};

export { elementFlatDataBindingToDataSource };
