/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry, elementDataSourceBlock } from '@object-ui/core';
import {
  ElementDataSourceGate,
  useObjectTranslation,
  useSchemaContext,
  type ElementDataSourceMapping,
} from '@object-ui/react';
import { ObjectMap } from './ObjectMap';
import type { ObjectMapProps } from './ObjectMap';

export { ObjectMap };
export type { ObjectMapProps };

/**
 * What `ObjectMap` reads for its own query: `objectName` (via `getDataConfig`),
 * `filter` and `sort` (`ObjectMap.tsx` — `$filter: schema.filter`,
 * `$orderby: convertSortToQueryParams(schema.sort)`).
 *
 * No `columns` and no row cap are mapped: a map projects the fields its `map`
 * config names (latitude/longitude/title/description) and its fetch issues no
 * `$top`, so neither key has a read site to write to.
 *
 * `filter` here means the query filter and nothing else. `getMapConfig` used to
 * ALSO accept the map's own configuration stashed under `schema.filter.map` (a
 * shape predating the `map` input); that read is gone as of objectui#4034 —
 * the map config is read from the declared `map` input only, and a schema still
 * carrying the legacy stash gets a dev-mode warning instead of silently losing
 * its markers. Nothing here ever relied on it.
 */
const OBJECT_MAP_DATA_SOURCE: ElementDataSourceMapping = {
  filter: true,
  sort: true,
};

// Register component
export const ObjectMapRenderer: React.FC<any> = elementDataSourceBlock(({ schema, ...props }) => {
  const { dataSource } = useSchemaContext() || {};
  // The spec's `PageComponentSchema.dataSource` binding (objectstack#7121): a map
  // authored with the binding and no flat `objectName` got a null data config, so
  // it rendered an empty map — no markers, no request, no diagnostic.
  // objectui#12920 — the unresolvable-view panel's title reads the bundle.
  const { t } = useObjectTranslation();
  return (
    <ElementDataSourceGate
      schema={schema}
      mapping={OBJECT_MAP_DATA_SOURCE}
      dataSource={dataSource}
      testId="object-map"
      errorTitle={t('element.map.sourceUnresolved', {
        defaultValue: 'This map’s data source could not be resolved',
      })}
    >
      {(bound) => <ObjectMap schema={bound} dataSource={dataSource} {...props} />}
    </ElementDataSourceGate>
  );
});

// `objectName` is NOT a required input (objectui#7470): `getDataConfig` reads
// `data`, then `staticData`, then `objectName`, and the `object-map` zod schema
// (`requireRecordSource`, `77cb489b4`) is where "one of the three" is
// enforced. Since objectui#10859 batch 5 the authored node's arm,
// `ObjectMapBlockSchema`, reads the three in its `properties` bag and also
// counts the node's `dataSource` binding, which `ElementDataSourceGate` above
// lands on `objectName`. The input list is a flat declaration with a boolean
// `required`, so it states the rule in the description rather than growing a
// one-of form.
//
// `data` and `staticData` are declared (objectui#10394): `ObjectMapSchema`
// declares both, and without an input the html tier's `validateTree` reported
// a block authored on either as `unknown-prop`. Their arms are the schema's:
// `data` is `ViewDataSchema`, a `{ provider, … }` OBJECT — the ladder is called
// on the `'view-data'` arm, so a bare array under `data` is not a record source
// (objectui#8348) and `SchemaRenderer` does not spread it as a prop either —
// and `staticData` is an array of records. Each description names only what
// `ObjectMap` was measured to do with the key, including that the `api`
// provider plots nothing here (`API provider not yet implemented for
// ObjectMap`).
//
// `filter` and `sort` are declared (objectui#8220): `ObjectMap` lowers both onto
// its query (`$filter` / `$orderby`), and `@objectstack/spec`'s `object-map`
// row declares both, so without an input the html tier's `validateTree`
// reported a working key as `unknown-prop`. `filter` is the RULE-ARRAY arm
// only — the spec refuses the MongoDB-style record form at this door, and
// `type: 'array'` makes the html tier refuse it too. Pinned in
// `__tests__/queryKeysDeclared-8220.test.tsx`.
//
// `mapStyle`, `navigation` and `enableClustering` are declared (objectui#11168
// slice 3, objectui#11111 decision 3 = B): `@objectstack/spec` 17.5.0's
// `object-map` row declares all three, the repo-wide registry parity guard now
// loads this plugin and judges the registration, and each was measured honoured
// through the real `SchemaRenderer` first — so without an input the html tier
// reported a working key as `unknown-prop`. Each description states what the
// renderer was measured to do. `mapStyle`'s is the spec row's own describe,
// verbatim: the renderer used to read a `style` inside the `map` block first,
// against that describe ("Read before `map.style`"), and the seat ruled the
// renderer follows the spec (option A) — `getMapConfig` now reads `mapStyle`
// first on every path, pinned both ways. The members
// of every structured key here are pinned in
// `__tests__/objectMapInputs-11168.test.tsx`; `dataSource`'s in
// `ObjectMap.elementDataSource.test.tsx`.
//
// The list is spelled INLINE rather than spread from a shared constant:
// `check:component-surface-parity` cannot name the entries of a spread, so a
// spread list would drop this registration out of that reader's population.
// The declaration is pinned in `index.recordSourceInputs-10394.test.tsx`.
ComponentRegistry.register('object-map', ObjectMapRenderer, {
  namespace: 'plugin-map',
  label: 'Object Map',
  category: 'view',
  inputs: [
    { name: 'objectName', type: 'string', description: 'ObjectQL object name. The record source is one of `data`, `staticData` and `objectName`, or the node’s `dataSource` binding; the `object-map` schema refuses a block that declares none of them.' },
    { name: 'map', type: 'object', description: 'The field configuration: `latitudeField` / `longitudeField` (or one `locationField` holding a `"lat,lng"` string, a `{ lat, lng }` object or a `[lat, lng]` pair) place each record’s marker, and a record with no readable coordinates is not plotted; `titleField` and `descriptionField` name what the marker popup shows; `zoom` and `center` (`[latitude, longitude]`) set the initial camera, which otherwise fits the markers; `style` is a MapLibre style URL, read after the node’s `mapStyle`.' },
    { name: 'data', type: 'object', description: 'A `{ provider, … }` data-source configuration, read FIRST on the record-source ladder: a map carrying one never reaches `staticData` and never queries `objectName`. `{ provider: \'value\', items }` plots those rows and `{ provider: \'object\', object }` queries that object, both narrowed by `filter` and ordered by `sort`. A bare array is not this key’s shape and is not a record source: the map falls through to `staticData`, then `objectName`, so inline rows belong under `staticData`.' },
    { name: 'staticData', type: 'array', description: 'Inline records, read SECOND on the record-source ladder: a `data` configuration wins and this key is then never reached, while `objectName` is read AFTER it, so a map carrying both plots these rows and never queries that object. `filter` and `sort` narrow and order these rows exactly as they do fetched ones.' },
    { name: 'filter', type: 'array', description: 'Base query filter in the rule-array form `[{ field, operator, value }, ...]`, narrowing the markers the map plots — fetched rows and inline (`staticData`, `{ provider: \'value\' }`) rows alike. Context tokens such as `{current_user_id}` are resolved first, then the filter is lowered to `$filter` on the query. The MongoDB-style record form is not this key’s shape.' },
    { name: 'sort', type: 'array', description: 'Marker order in `[{ field, order }]` form, ordering the rows the map plots. Lowered to `$orderby` on the same query.' },
    { name: 'mapStyle', type: 'string', description: 'MapLibre style URL or spec, overriding the public demo tiles. Read before `map.style`; NOT the base node `style`, which is an inline CSS record' },
    { name: 'navigation', type: 'object', description: 'What a marker click opens — the `{ mode, size, openNewTab, preventNavigation }` block a list view declares. With the key ABSENT a click opens nothing: this renderer supplies no drawer default. `mode` is an overlay (`drawer`, `modal`, `split`, `popover`), `new_window`, `page` or `none`, and a block written without `mode` takes the spec’s `page` default. `drawer`, `modal` and `popover` open the marker’s record in that overlay, but `split` opens nothing, because the map hands the split shell no main panel; `new_window` opens the record page in a new tab; `none` opens nothing. `page` opens the record page of the map’s `objectName` through the record navigator the host publishes (the console publishes one on its custom pages, record pages and list views); under a host that publishes none, such as an embedded renderer, or on a map that names no `objectName`, there is no record page to open and the click opens nothing. `preventNavigation: true` opens nothing whatever the mode, `openNewTab: true` opens the record page in a new tab and outranks every mode except `none`, and `size` sets the overlay width. A click handler from a parent view outranks the whole key.' },
    { name: 'enableClustering', type: 'boolean', description: 'Group nearby markers into one numbered cluster. Absent, the map clusters only above 100 markers; `false` turns clustering off at any count.' },
  ],
});

/**
 * ⛔ The bare `map` node type key is RETIRED (objectui#10393, executing the
 * objectui#8008 family ruling of 2026-09-09, route 3). `object-map` is the one
 * spelling this plugin serves.
 *
 * ## What was here, and why it went
 *
 * `ComponentRegistry.register('map', ObjectMapRenderer, { namespace: 'view',
 * ... })` — a second key on the SAME renderer, which stored both `view:map`
 * and the bare `map` fallback. The declared face admitted only one of the two:
 * `ObjectMapSchema.type` is the literal `'object-map'` and `AnyComponentSchema`
 * has no `map` arm, so a node authored `type: 'map'` failed validation
 * (`invalid_union`) while the registry mounted it. Two published faces,
 * opposite verdicts — the shape objectui#8008 retired for `gantt`.
 *
 * ## Why unregistering is the whole retirement here — measured, not assumed
 *
 * ⚠️ `BaseSchemaCore` ends `.passthrough()` (and `BaseSchema` closed with
 * `[key: string]: any` until objectui#8347), so a dropped MEMBER KEY is KEPT,
 * not refused, on the zod face (the objectui#7664 failure). That hazard needs a schema face to arise on, and this
 * TYPE NAME never had one: in `@object-ui/types` the literal `'map'` appears
 * only in the stored view-type unions (`NamedListView.type`,
 * `defaultViewType`), never as a component node type, against a firing control
 * of two for `object-map` (`objectql.ts` + its Zod mirror). There is no arm to
 * convert into a named refusal, so unregistering IS the retirement.
 *
 * ## ⛔ Two layers, and only one of them moved
 *
 * The string `map` also names a STORED `NamedListView.type` — the value
 * `CreateViewDialog` writes and every tenant's database holds. That layer is
 * untouched: `plugin-view`'s `ObjectView` and `plugin-list`'s `ListView` each
 * map a stored `map` view onto the node type they emit (their `case 'map'`
 * branches), and both already emit `object-map`. ⇒ Every map view any user
 * ever created through the console already renders through the surviving
 * spelling; this retirement moves zero stored documents.
 *
 * Pinned in `src/index.bareMapKeyRetired-10393.test.tsx`.
 */
