/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useContext } from 'react';
import { elementDataSourceBlock, isElementDataSourceConfig, isListViewVisualization } from '@object-ui/core';
import { useObjectTranslation } from '@object-ui/i18n';
import { usePageRegionPosture } from '@object-ui/components';
import { usePermissions } from '@object-ui/permissions';
import {
  ElementDataSourceGate,
  SchemaRendererContext,
  isConfigBag,
  useRelatedRecordActions,
  type ElementDataSourceMapping,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView, type ListViewHandle, type ListViewProps } from './ListView';
import { CompactListDestinationContext, type CompactListDestination } from './ListViewCompact';

/**
 * Which schema keys `ListView` actually reads, so the composed binding lands on
 * those and nothing else.
 *
 * `list-view` is the block that reads all five: `columns` is a FIELD projection
 * here (so a saved view's column list belongs on it), `filter` and `sort` go to
 * the query, the row cap is read as `pagination.pageSize`, and a saved view's
 * kind picks which view kind renders when the node states none — naming a saved
 * kanban view and rendering a grid would be a silently wrong answer.
 *
 * `objectName` (the mapping's default object key) and `viewType` are the keys
 * the gate WRITES for `ListView` to read. They are this block's hand-off to the
 * component, not what a page node is written in: see {@link toListViewHandOff}.
 */
const LIST_VIEW_DATA_SOURCE: ElementDataSourceMapping = {
  columns: true,
  filter: true,
  sort: true,
  limit: 'pagination.pageSize',
  viewType: true,
};

/**
 * What `SchemaRenderer` hands this block beside the hoisted keys. Its
 * `properties` hoist copies a node's bag onto the node and keeps the bag
 * itself, and it never copies the bag's `type` up: the node's own `type` is the
 * registry key that chose this renderer. So the bag is where this block reads
 * the list kind. Typed here, beside its one reader, and not on the authoring
 * face: `SchemaRenderer` is the producer, not an author.
 */
interface PageNodeBag {
  properties?: unknown;
}

/** The spellings a page `list-view` node no longer carries; see {@link toListViewHandOff}. */
const RETIRED_PAGE_KEYS = ['objectName', 'viewType'] as const;

/** One warning per retired key per process, as `normalizeListViewSchema` warns. */
const warnedRetiredPageKeys = new Set<string>();

const RETIRED_PAGE_KEY_REMEDY: Record<(typeof RETIRED_PAGE_KEYS)[number], string> = {
  objectName: "Name the object in `data: { provider: 'object', object }` or in `dataSource.object`",
  viewType: 'Write the list kind as `type` in the node\'s `properties`',
};

function warnRetiredPageKey(key: (typeof RETIRED_PAGE_KEYS)[number]): void {
  if (warnedRetiredPageKeys.has(key)) return;
  warnedRetiredPageKeys.add(key);
  console.warn(
    `[object-ui] list-view: a page node's \`${key}\` is not read. ${RETIRED_PAGE_KEY_REMEDY[key]}.`,
  );
}

/**
 * The page carrier's spelling, turned into the props `ListView` reads
 * (objectstack-ai/objectstack#22444, ruling C; objectui#12099).
 *
 * A page `list-view` node is written in `@objectstack/spec`'s list view
 * spelling: it names its object with `data: { provider: 'object', object }`
 * (or the node's `dataSource` binding) and its kind with `type`. On a metadata
 * page that `type` sits in `properties`, because the node's own `type` is the
 * registry key. `ListView`'s own props spell the two `objectName` and
 * `viewType`, so this is where one spelling becomes the other:
 *
 *  - the kind: `properties.type`, when it names a visualization `ListView`
 *    draws, becomes `viewType`. A value that names none is dropped, and the
 *    list draws a grid, the spec's default kind. Absent, the kind is still
 *    open: a bound saved view's kind applies, else a grid. Written BEFORE the
 *    gate, so a kind the node states outranks the saved view's, like every
 *    other key the node writes itself.
 *  - the object: `data` passes through as it is, and `normalizeListViewSchema`
 *    lands an `object` provider's `object` on `objectName`.
 *  - ⛔ the node's own `objectName` and `viewType` are not read. They are
 *    removed here, so neither reaches the gate or `ListView`, and each draws
 *    one console warning naming what to write. A stored node that still
 *    carries them is converted on the platform side (an ADR-0087 conversion in
 *    the spec), never read back here. A node bound by neither `data` nor
 *    `dataSource.object` gets the "no object named" hint below.
 *
 * Returns the input by reference when there is nothing to do, so a node
 * written in the spec spelling keeps its identity for `ListView`'s memos.
 */
function toListViewHandOff(schema: ListViewSchema): ListViewSchema {
  const bag = (schema as ListViewSchema & PageNodeBag).properties;
  const kind = isConfigBag(bag) ? bag.type : undefined;
  const retired = RETIRED_PAGE_KEYS.filter((key) => schema[key] !== undefined);
  if (kind === undefined && retired.length === 0) return schema;
  for (const key of retired) warnRetiredPageKey(key);
  const { objectName: _objectName, viewType: _viewType, ...rest } = schema;
  return isListViewVisualization(kind) ? { ...rest, viewType: kind } : rest;
}

/**
 * Whether the bound schema names where its records come from: an object the
 * `dataSource` binding landed on `objectName` (the node's own was removed by
 * {@link toListViewHandOff}), or a `data` record source. An `object` provider
 * counts only when it names a non-empty object, the test the gate applies to
 * `objectName`; rows, a `value` provider and any other provider are the list's
 * own source.
 */
function namesRecordSource(schema: ListViewSchema): boolean {
  const bound = schema.objectName;
  if (typeof bound === 'string' && bound.trim().length > 0) return true;
  const data: unknown = schema.data;
  if (data == null) return false;
  if (isConfigBag(data) && data.provider === 'object') {
    return typeof data.object === 'string' && data.object.trim().length > 0;
  }
  return true;
}

/**
 * Where the compact list's "View all" link goes (objectui#12703, part 2): the
 * host's list destination for the object this block reads, on the saved view
 * the block binds (`dataSource.view`) when it binds one, else the object's own
 * list. `null` when the host publishes no `listHref`, answers `null`, or the
 * block names no object, and the compact list then draws no link.
 *
 * Only the object and the view name are handed over. ⛔ The block's own
 * `filter`, `columns` and `sort` (inline, or the binding's additions to the
 * view) are never encoded: the destination is a list a user can open on its
 * own, and the block's header count stays the answer to "what this block
 * shows".
 *
 * Plain function, not a hook: it is called inside the gate's render callback.
 */
function compactListDestination(
  host: RelatedRecordActionsValue | null,
  bound: ListViewSchema,
): CompactListDestination | null {
  if (!host?.listHref) return null;
  const objectName = boundObjectName(bound);
  if (!objectName) return null;
  const binding: unknown = (bound as { dataSource?: unknown }).dataSource;
  const viewName = isElementDataSourceConfig(binding) && typeof binding.view === 'string' && binding.view !== ''
    ? binding.view
    : undefined;
  const href = host.listHref(objectName, viewName);
  if (!href) return null;
  const openList = host.openList;
  // No SPA open published: the anchor navigates on its own.
  return openList ? { href, open: () => openList(objectName, viewName) } : { href };
}

/** The object the bound schema reads: the binding's (landed on `objectName`) or an `object` provider's. */
function boundObjectName(schema: ListViewSchema): string | undefined {
  const bound = schema.objectName;
  if (typeof bound === 'string' && bound.trim().length > 0) return bound;
  const data: unknown = schema.data;
  if (isConfigBag(data) && data.provider === 'object' && typeof data.object === 'string' && data.object.trim().length > 0) {
    return data.object;
  }
  return undefined;
}

/**
 * The Add button of a page `list-view` node (objectui#13074), and the node
 * `ListView` draws it from.
 *
 * `ListView` draws the button from `addRecord.enabled` and calls its host's
 * `onAddRecord` prop, which a page node never receives. So the click goes to
 * the `onCreate` a `RelatedRecordActionsContext` provider serves for the
 * object this block lists (`resolve({ objectName })`), the handler the
 * `record:related_list` block's "+ New" calls. No host prop and no new export.
 * The input names no `relationshipField`, which is how a host tells this
 * object-scoped list from a related list whose parent did not resolve
 * (`ResolveRelatedRecordActionsInput`). The console's page host serves it the
 * record-form create the object list opens (objectui#13089).
 *
 *  - A host that hands this block `onAddRecord` itself keeps it: an explicit
 *    prop outranks the provider, as the explicit `dataSource` adapter does.
 *  - A provider omits `onCreate` when the viewer may not create records of the
 *    object, and no provider serves one at all with no host (the designer, a
 *    standalone embed). The button is then withheld, with `addRecord` taken
 *    off the node, rather than drawn as a control that does nothing. So is a
 *    create the provider greys (`createDisabled`), because `ListView` draws no
 *    greyed Add button.
 *
 * Plain function, not a hook: it is called inside the gate's render callback,
 * on the node after the binding, so it reads the object the binding names.
 */
function pageAddRecord(
  hostProp: (() => void) | undefined,
  host: RelatedRecordActionsValue | null,
  bound: ListViewSchema,
): { schema: ListViewSchema; onAddRecord: (() => void) | undefined } {
  if (hostProp || bound.addRecord?.enabled !== true) return { schema: bound, onAddRecord: hostProp };
  const objectName = boundObjectName(bound);
  const handlers = objectName && host ? host.resolve({ objectName }) : undefined;
  if (handlers?.onCreate && handlers.createDisabled !== true) {
    return { schema: bound, onAddRecord: handlers.onCreate };
  }
  const { addRecord: _withheld, ...rest } = bound;
  return { schema: rest, onAddRecord: undefined };
}

/**
 * The "no object named" hint, in the gate's own words (the `view.noObject`
 * message), naming the page key this block reads: `data.object`. The gate's
 * own hint names its mapping's object key, which here is `objectName`, the
 * hand-off key a page node is not written in.
 */
function ListViewNoObjectHint(): React.ReactElement {
  const { t } = useObjectTranslation();
  return (
    <div className="p-4 text-sm text-muted-foreground my-2" data-testid="list-view-no-object">
      {t('view.noObject', {
        property: 'data.object',
        defaultValue: 'No object named: set {{property}} or dataSource.object.',
      })}
    </div>
  );
}

/**
 * Registry entry point for `<ListView>` — two bridges in one component.
 *
 * ## 1. The data-source ADAPTER (#3144)
 *
 * `ListView` reads `props.dataSource` (the injected adapter), and
 * `SchemaRenderer` never passes it — it only puts the data source on
 * `SchemaRendererContext`. Registering the component bare meant that on the
 * registry/SDUI path (a metadata page, a `kind:'react'` page, the designer
 * preview) it received no data source at all: its `getObjectSchema` effect
 * returned immediately, nothing was ever fetched, and it rendered the "Nothing
 * here" empty state — while its registry `inputs` declared `objectName`
 * **required**. The app never showed this because the console reaches ListView
 * through `ObjectView`'s `renderListView` render-prop, which passes a data
 * source itself. That is the objectstack#4413 shape (a declared binding nothing
 * can consume), caught by
 * `apps/console/src/__tests__/public-block-binding-reach.test.tsx` rather than by
 * hand. `object-form`, `object-kanban` and `object-calendar` carry the same
 * one-line bridge.
 *
 * An explicit `dataSource` prop still wins — hosts that pass their own (as
 * `ObjectView` does) are unaffected. `useContext` rather than
 * `useSchemaContext()` because the latter throws outside a provider, and a bare
 * `<ListView>` with a host-supplied data source must keep working.
 *
 * ## 2. The spec's per-element data BINDING (objectstack#5576)
 *
 * `PageComponentSchema.dataSource` — `{ object, view?, filter?, sort?, limit? }` —
 * is how a page component declares what to query. It was published and unread:
 * `resolveElementDataSource` dropped `view`, had no caller outside its own test,
 * and nothing mapped `object` onto `objectName`. Worse, the binding and the
 * adapter above collide by NAME, so a page that wrote the binding the spec
 * documents got the plain `{ object, view }` object where the adapter belongs:
 * the first `dataSource.find(…)` threw `dataSource.find is not a function` and
 * the list rendered **"Couldn't load records"**. Three `list-view` components on
 * one home page, the two without `dataSource` fine and the spec-compliant one
 * broken, is the single-variable reproduction in the issue.
 *
 * `SchemaRenderer` no longer spreads the schema's `dataSource` as a prop, which
 * removes the collision at its source. This component completes the other half:
 * it maps the binding onto the props `ListView` actually reads, resolving a named
 * saved view through `ElementDataSourceGate`.
 *
 * ### Where the precedence table lives (objectui#4038)
 *
 * It is NOT here. objectstack#5576 landed this block's own ~45-line copy of
 * "binding overrides the component key / a view is only a baseline / `filter`
 * AND-combines / an empty `columns` counts as unauthored / the row cap lands on
 * `pagination.pageSize` / `viewType` only when undeclared", and objectstack#6953
 * then lifted that same table into `@object-ui/react` when the other eight
 * object-bound blocks needed it. Two copies of one table is how the spec's
 * "*additional* filter criteria" quietly becomes two dialects — the next person
 * to change the rules changes one side. So the table now lives ONCE, in
 * {@link ElementDataSourceGate}, and this block contributes only the part that is
 * genuinely its own: {@link LIST_VIEW_DATA_SOURCE}, the names of the keys it
 * reads. The behaviour is unchanged in both directions — that objectstack#5576's
 * whole suite passes here untouched is the acceptance criterion of the
 * convergence, not a happy accident.
 *
 * An unresolvable `view` still fails loudly (the gate renders the configuration
 * error rather than falling back to the object's default view): silently widening
 * a named view to "all records" is the failure class the binding exists to
 * remove, and the one an AI-authored page hides best.
 */
const ListViewBlock = elementDataSourceBlock(React.forwardRef<ListViewHandle, ListViewProps>((props, ref) => {
  // Read AS DECLARED (objectui#7209) — no cast, so an undeclared member is a
  // compile error here. Pinned by `ListViewBlock.schemaRendererContextRead-7209.test.ts`.
  const context = useContext(SchemaRendererContext);

  // Defence in depth for the collision above: even though SchemaRenderer no
  // longer spreads it, a host (or an older cached bundle) handing us the spec
  // BINDING under this prop name must never be mistaken for an adapter. The gate
  // carries the same guard for its own resolution; this one also decides what
  // `ListView` itself receives as its adapter, which the gate cannot do for us.
  const explicitAdapter = isElementDataSourceConfig(props.dataSource)
    ? undefined
    : props.dataSource;
  const adapter = explicitAdapter ?? context?.dataSource;

  // The page node in the props `ListView` reads (objectui#12099). Memoised for
  // cost only: `toListViewHandOff` returns its input by reference when there is
  // nothing to do, and a recomputed copy is equal key by key.
  const handOff = React.useMemo(() => toListViewHandOff(props.schema), [props.schema]);

  // The page region's posture (objectui#12703), measured by the page renderer:
  // a region narrower than half the page asks for the compact list. `null`
  // (no page region around this block, or a width not known yet) keeps the
  // full list. Read here, on the page block, and not in `ListView`, so the
  // object list page and every other host of `ListView` are untouched.
  const compact = usePageRegionPosture() === 'compact';
  // The host's list destination builder, for the compact list's "View all"
  // link (objectui#12703, part 2), read only when the posture is compact, and
  // the `onCreate` it serves for the Add button (objectui#13074).
  const host = useRelatedRecordActions();

  // A list that names its records in neither place has nothing to fetch, and
  // drew the "Nothing here yet" empty state, which reads as an empty query
  // (objectui#11605). Judged in the child below, after the binding is applied,
  // and not by the gate's `requiresObject`, whose hint names the gate's object
  // key (objectui#12099).
  // objectui#12920 — the unresolvable-view panel's title reads the bundle.
  const { t } = useObjectTranslation();
  const perms = usePermissions();

  /**
   * The audience gate (objectui#13074): `requiredPermissions` on a page
   * `list-view` node is the spec's capability list, ALL required, the meaning
   * the key carries on the record blocks, an app, a navigation item and an
   * action. Read the way the record blocks read it (`record-details.tsx`
   * writes the doctrine once): through `hasCapabilities` over the reported
   * `systemPermissions`, never through the object-action path. An unheld
   * capability puts the same insufficient-permissions notice (`role="status"`)
   * in place of the list, and returns before the gate below, so no saved view
   * is resolved and no query is sent.
   *
   * A provider that never reports capabilities (no provider, the role-based
   * `PermissionProvider`, a backend predating ADR-0066) still opens the gate:
   * `hasCapabilities`'s ruled unreported-vs-empty doctrine (objectui#4656). A
   * reported empty array gates strictly.
   *
   * Only the page node reads it here. A list view the server serves (the
   * object list page, which draws `ListView` itself) is gated by the server
   * before it is served, and `ListView` reads nothing for it.
   */
  const required: string[] = Array.isArray(handOff.requiredPermissions)
    ? handOff.requiredPermissions
    : [];
  if (required.length > 0 && !perms.hasCapabilities(required)) {
    return (
      <div className={props.className} role="status" aria-live="polite" data-testid="list-view-insufficient-permissions">
        <p className="text-sm text-muted-foreground italic">
          Insufficient permissions to view list.
        </p>
      </div>
    );
  }

  return (
    <ElementDataSourceGate
      schema={handOff}
      mapping={LIST_VIEW_DATA_SOURCE}
      dataSource={adapter}
      testId="list-view"
      errorTitle={t('element.listView.sourceUnresolved', {
        defaultValue: 'This list view’s data source could not be resolved',
      })}
    >
      {(schema) => {
        if (!namesRecordSource(schema)) return <ListViewNoObjectHint />;
        // objectui#13074 — the Add button calls the provider's `onCreate`.
        const add = pageAddRecord(props.onAddRecord, host, schema);
        // A named local, not `add.schema` inline: it is the same document (less a
        // withheld `addRecord`), and `check-handler-key-read-sites` follows the
        // hop into `ListView` only through a document-derived name.
        const listSchema = add.schema;
        return (
          <CompactListDestinationContext.Provider value={compact ? compactListDestination(host, schema) : null}>
            <ListView
              ref={ref}
              {...props}
              schema={listSchema}
              dataSource={adapter}
              compact={compact}
              onAddRecord={add.onAddRecord}
            />
          </CompactListDestinationContext.Provider>
        );
      }}
    </ElementDataSourceGate>
  );
}));
ListViewBlock.displayName = 'ListViewBlock';

export { ListViewBlock };
