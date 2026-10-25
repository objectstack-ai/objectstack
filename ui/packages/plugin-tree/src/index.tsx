/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { useSchemaContext } from '@object-ui/react';
import { ObjectTree } from './ObjectTree';
import type { ObjectTreeProps } from './ObjectTree';

export { ObjectTree };
export type { ObjectTreeProps };

// Renderer wrapper: pulls the dataSource from schema context, mirroring the
// other view plugins (object-map / object-gantt / …).
export const ObjectTreeRenderer: React.FC<any> = ({ schema, ...props }) => {
  const { dataSource } = useSchemaContext() || {};
  return <ObjectTree schema={schema} dataSource={dataSource} {...props} />;
};

// The keys `@objectstack/spec`'s `object-tree` row declares, each published
// because `ObjectTree` was measured to honour it (objectui#11168 slice 3,
// objectui#11111 decision 3 = B). Every description names only what the
// renderer was measured to do with the key; the members of each structured key
// are pinned in `__tests__/objectTreeInputs-11168.test.tsx`, and a renderer
// that changes any of them reddens a row there — the fix is to rewrite the
// description with it.
//
// `objectName` is NOT required: the record source is one of `data`,
// `staticData` and `objectName`, read in that order, so a tree on inline rows
// never reads it. Required, the page validator raised `missing-required-prop`
// on a tree the spec row and the renderer both accept. The list is a flat
// declaration with a boolean `required`, so it states the rule in the
// description rather than growing a one-of form — the `object-map` /
// `object-gantt` precedent (objectui#7470).
const treeInputs = [
  {
    name: 'objectName',
    type: 'string' as const,
    description:
      'ObjectQL object name. The record source is one of `data`, `staticData` and `objectName`, read in that order: a tree on `data` or `staticData` never queries this object. On a tree whose rows are inline it still names the record page a new-tab click opens.',
  },
  {
    name: 'tree',
    type: 'object' as const,
    description:
      'The field configuration: `parentField` names the field holding each record’s parent id (auto-detected from the object’s self-referencing field when omitted), `labelField` the field drawn indented in the first column (default `name`), `fields` the further fields drawn as flat columns after it, and `defaultExpandedDepth` how many levels open on first draw (`0` shows roots only; omitted, every level is open).',
  },
  {
    name: 'data',
    type: 'object' as const,
    description:
      'A `{ provider, … }` data-source configuration, read FIRST on the record-source ladder: a tree carrying one never reaches `staticData` and never queries `objectName`. `{ provider: \'value\', items }` draws those records and `{ provider: \'object\', object }` queries that object, both narrowed by `filter`. The `api` and `schema` providers draw no rows on the tree. A bare array is not this key’s shape and is not a record source: the tree falls through to `staticData`, then `objectName`, so inline rows belong under `staticData`.',
  },
  {
    name: 'staticData',
    type: 'array' as const,
    description:
      'Inline records, read SECOND on the record-source ladder: a `data` configuration wins and this key is then never reached, while `objectName` is read AFTER it, so a tree carrying both draws these rows and never queries that object. Each record is placed under the record its `parentField` value names, and one naming no record is drawn as a root. `filter` narrows these rows exactly as it does fetched ones.',
  },
  {
    name: 'filter',
    type: 'array' as const,
    description:
      'Base query filter in the rule-array form `[{ field, operator, value }, ...]`, narrowing the records the tree draws — fetched rows and inline (`staticData`, `{ provider: \'value\' }`) rows alike. Context tokens such as `{current_user_id}` are resolved first, then the filter is lowered to `$filter` on the query. A record whose parent the filter removed is drawn as a root. The MongoDB-style record form is not this key’s shape.',
  },
  {
    name: 'navigation',
    type: 'object' as const,
    description:
      'What a row click opens — the `{ mode, size, openNewTab, preventNavigation }` block a list view declares. With the key ABSENT a click opens nothing: this renderer supplies no drawer default. `mode` is an overlay (`drawer`, `modal`, `split`, `popover`), `new_window`, `page` or `none`, and a block written without `mode` takes the spec’s `page` default. `drawer`, `modal` and `popover` open the row’s record in that overlay, and `split` opens it beside the tree; `new_window` opens the record page in a new tab; `none` opens nothing. `page` opens the record page of `data.object` when `data` is the object provider, else of the tree’s `objectName`, through the record navigator the host publishes (the console publishes one on its custom pages, record pages and list views); under a host that publishes none, such as an embedded renderer, or on a tree that names neither (inline rows with no `objectName`), there is no record page to open and the click opens nothing. `preventNavigation: true` opens nothing whatever the mode, `openNewTab: true` opens the record page in a new tab and outranks every mode except `none`, and `size` sets the overlay width. A click handler from a parent view outranks the whole key.',
  },
];

ComponentRegistry.register('object-tree', ObjectTreeRenderer, {
  namespace: 'plugin-tree',
  label: 'Object Tree',
  category: 'view',
  inputs: treeInputs,
});

/**
 * ⛔ The bare `tree` node type key is RETIRED (objectui#10859 batch 8, the
 * seat's ruling on that card, by the objectui#10393 / objectui#8760 route).
 * `object-tree` is the one spelling this plugin serves.
 *
 * ## What was here, and why it went
 *
 * `ComponentRegistry.register('tree', ObjectTreeRenderer, { namespace: 'view',
 * ... })` — a second key on the SAME renderer with the SAME `inputs`, which
 * stored both `view:tree` and the bare `tree` fallback. Only `object-tree` has
 * a declaration: `@objectstack/spec`'s `ComponentPropsMap` row, which
 * `AnyComponentSchema` arms, while no arm claims `tree`. So `objectui validate`
 * refused a node authored `type: 'tree'` at `type` while the registry mounted
 * it. `PUBLIC_BLOCKS` already declined to curate it as "a second spelling of
 * this one block".
 *
 * ## Why unregistering is the whole retirement
 *
 * Nothing wrote the node: 0 producers in source, docs, examples or the
 * catalog, measured for the card. The other `tree` spellings in the stack are
 * different layers and stay untouched — the FIELD type `tree` (a self-reference
 * that `@object-ui/fields` renders as `field:lookup`) and a STORED list-view
 * type, which `@object-ui/plugin-list`'s `ListView` already composes into an
 * `object-tree` node. The console's lazy `tree` stub (`apps/console/src/register-plugins.ts`)
 * went in the same change, so no host keeps the key alive.
 */
