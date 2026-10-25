/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list` — renders a list of records related to the current
 * record (parent-child / lookup back-reference), or to the record its
 * `parentDataSource` binding reads (objectui#12294). Props mirror the spec
 * `RecordRelatedListComponentProps` shape; the existing RelatedList expects
 * the legacy `referenceField` / `pageSize` names, so we adapt here.
 */

import React from 'react';
import {
  ElementDataSourceGate,
  useActionTextLocalizer,
  useMetadataItem,
  useRecordContext,
  useSafeFieldLabel,
  useRelatedRecordActions,
  type ElementDataSourceMapping,
  type RelatedRowActionDef,
} from '@object-ui/react';
import { useFieldPermissions, usePermissions } from '@object-ui/permissions';
import { useObjectTranslation, pickLocalized } from '@object-ui/i18n';
import { humanizeLabel } from '@object-ui/fields';
import {
  columnIdentity,
  elementDataSourceBlock,
  resolveAffordance,
  type ElementDataSourceConfig,
} from '@object-ui/core';
import type { RecordRelatedListComponentProps } from '@object-ui/types';
import { RelatedList } from '../RelatedList';
import { useRecordAriaProps } from './recordComponentAria';
import { ParentRecordBinding } from './recordBinding';
import {
  describeRelatedListActionRefusals,
  placeAuthoredRelatedListActions,
  relatedListActionsNeedLookup,
  type PlacedRelatedListActions,
} from './relatedListActions';

/**
 * Normalize a column entry (string | {field} | {name} | {key}) to its name.
 * `key` is kept as a tail fallback rather than folded into `columnIdentity`:
 * it is a generic entry key, not ObjectStack metadata identity (#3104).
 */
const colName = (entry: any): string | null =>
  columnIdentity(entry) || (entry && typeof entry === 'object' ? entry.key : null) || null;

/**
 * `columns[].label` on the spec's column-object arm is an `I18nLabel`
 * (`ComponentPropsMap['record:related_list'].columns` declares the saved-view
 * union, `string[]` or `ListColumn[]`, since `@objectstack/spec` 17.5.0): a
 * plain string or an inline per-locale map (objectui#10993). `RelatedList`
 * turns an object column's `label` into the table's `header` through
 * `columnHeader`, which takes a string only, so a map handed on raw drew a
 * BLANK header while the same column with a string label drew it.
 *
 * Resolved here, against the UI language, beside this block's `title` and
 * `add.label`. Only the map arm is touched: a string label, a bare-string
 * column or any other value is handed on as authored, and the input array is
 * returned BY REFERENCE when no column carries a map, so the common path keeps
 * `RelatedList`'s column memo on the array it always received.
 */
function localizeColumnLabels<T>(columns: T[], language: string): T[] {
  let out: T[] | null = null;
  for (let idx = 0; idx < columns.length; idx++) {
    const column = columns[idx];
    const label: unknown =
      column && typeof column === 'object' ? (column as { label?: unknown }).label : undefined;
    if (label === null || typeof label !== 'object') continue;
    out ??= [...columns];
    out[idx] = { ...(column as object), label: pickLocalized(label, language) } as T;
  }
  return out ?? columns;
}

/** Extract a record's primary key, tolerating the `id` / `_id` split. */
const rowId = (row: any): string | number | null => row?.id ?? row?._id ?? null;

/**
 * Spec default for `RecordRelatedListProps.limit` (`.default(5)` — "Number of
 * records to display initially"). Zod materializes defaults only when the
 * metadata passes through a spec parse; the synthesized default record page
 * hands us raw nodes, so the renderer enforces the contract's default itself
 * (issue #2711 — without it related lists rendered ALL child rows unpaged).
 */
const SPEC_DEFAULT_LIMIT = 5;

/**
 * The ADR-0066 capability that answers "may this viewer change the page" —
 * the console's metadata-edit capability, read here for the action-refusal
 * notice's audience (objectui#11768).
 *
 * It is the name `@object-ui/app-shell` exports as `AUTHORING_CAPABILITY` and
 * reads through `useCanAuthorMetadata()`, the answer Studio's affordances (the
 * App → Studio bridge, the page editor entry, the builder CTAs) consult. It is
 * spelled out rather than imported because this package cannot import
 * app-shell (app-shell depends on this package, not the reverse) and no package
 * this one depends on exports the name. Module-local on purpose: it is not
 * part of this package's surface.
 */
const METADATA_AUTHORING_CAPABILITY = 'manage_metadata';

/**
 * Dev mode, in this repository's established spelling for it — the build's
 * `NODE_ENV` — the same guard `plugin-gantt`, `plugin-map` and
 * `@object-ui/core` put on their authoring diagnostics. Read per call, not
 * captured at module load, so the answer is the running build's.
 *
 * What it answers where this renderer runs: the console's production bundle
 * folds the expression to `false` at build time (Vite's `NODE_ENV` define),
 * so the console's `window.process` shim in `index.html`, which claims
 * `development`, never reaches it there; the console's dev server leaves the
 * expression as written and that shim answers `true`; a published consumer
 * gets whatever its own bundler defines.
 */
const isDevBuild = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.NODE_ENV !== 'production';

const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style, ...rest } = props || {};
  return { designer: { 'data-obj-id': id, 'data-obj-type': type, style }, rest };
};

export interface RecordRelatedListRendererProps {
  /**
   * The AUTHORED node, before the per-element `dataSource` binding is resolved.
   *
   * `objectName` is optional HERE and required everywhere else, and the
   * difference is the whole point of objectstack#6953: the exported name is the
   * `ElementDataSourceGate` wrapper below, and the gate maps the binding's
   * `object` onto `objectName` (its default target — see `ElementDataSourceGate`
   * `objectKey = 'objectName'`) before `RecordRelatedListBody` ever sees the
   * schema. A related list authored as `{ relationshipField, dataSource: {
   * object, view } }` is therefore legal input to this component and illegal
   * input to the spec's `RecordRelatedListProps`, which is correct on both
   * sides — one describes what an author writes, the other what the block reads.
   *
   * Spelling it `RecordRelatedListComponentProps` flat said the opposite, and
   * said it about the wrapper: the exact authoring shape objectstack-ai/objectstack#6953 added did not
   * type-check against the component that exists to accept it. The body already
   * reads the key defensively (`objectName && …`, `objectName || ''`) precisely
   * because it can arrive unbound; this declaration now agrees with that code.
   *
   * ## The looseness is NAMED, not open (objectui#9963)
   *
   * That is the whole of it: `objectName` optional, and `dataSource` admitted
   * as the binding the gate reads — typed with the gate's own declaration of
   * it, `ElementDataSourceConfig`. Every other member is the mirror's. This
   * type used to add `& Record<string, any>` (and the interface
   * `[k: string]: any`), which admitted ANY key at `any`, so a misspelled
   * declared key type-checked at every read below, cast or not — the refusal
   * the mirror declares stopped one layer short of the reads it exists for.
   *
   * The field-security triple (`requiredPermissions`, `enforceFieldSecurity`,
   * `redactFields`) arrives through the mirror like every other member:
   * `@objectstack/spec` 17.5.0 declares it on `record:related_list`, and
   * objectui#8649 declared it on `RecordRelatedListComponentProps` and removed
   * the casts its reads used to go through. ⛔ Still do not reopen this type to
   * admit a key the contract does not declare on this block.
   */
  schema?: Omit<RecordRelatedListComponentProps, 'objectName'> &
    Partial<Pick<RecordRelatedListComponentProps, 'objectName'>> & {
      /**
       * The per-element binding (`@objectstack/spec` `PageComponentSchema.dataSource`,
       * objectstack#6953). Read by `ElementDataSourceGate`, never by the body:
       * the gate maps it onto `objectName` / `columns` / `filter` / `sort` /
       * `limit` first.
       */
      dataSource?: ElementDataSourceConfig;
    };
  className?: string;
  /**
   * The designer's host props — the three keys `splitDesigner` reads and puts
   * back on the container. The registry's own call is untyped
   * (`ComponentRenderer<T = any>`), so what it forwards and nothing here reads
   * is deliberately NOT declared.
   */
  style?: React.CSSProperties;
  'data-obj-id'?: string;
  'data-obj-type'?: string;
}

const RecordRelatedListBody: React.FC<RecordRelatedListRendererProps> = ({
  // ⛔ NOT `{} as any` — the annotation-erasing default objectui#8649 repaired.
  // The mechanism and why the spelling tracks the annotation are written once,
  // at the same site in `record-details.tsx`.
  schema = {} as NonNullable<RecordRelatedListRendererProps['schema']>,
  className,
  ...props
}) => {
  const ctx = useRecordContext();
  const { designer } = splitDesigner(props);
  /**
   * The block's authored `aria` bag, honoured through the family's ONE read
   * point (objectui#9556). Called here, with the other hooks, because every
   * renderer below it has early returns.
   *
   * ⛔ No `defaultRole`: with nothing authored this container stays the bare
   * `div` it has always been, so a page that never wrote `aria` renders
   * byte-identical DOM. An author who does write one gets a `region` to carry
   * it — see `recordComponentAria.ts` for why the attribute alone would reach
   * nobody.
   */
  const ariaProps = useRecordAriaProps(schema.aria);
  const i18n = useSafeFieldLabel();
  const { language } = useObjectTranslation();

  const objectName = schema.objectName;

  // Resolve a human-friendly title:
  //   1. authored `schema.title` wins — via pickLocalized so inline-i18n
  //      shapes (`{ en, 'zh-CN' }`) resolve instead of rendering "[object Object]"
  //   2. translated object PLURAL label via i18n (key `objects.{name}.pluralLabel`),
  //      else the translated label (key `objects.{name}.label`) — the block
  //      lists the related object's records, so it is named as that object's
  //      list page is (objectui#11733)
  //   3. humanized objectName (e.g. `opportunity_quote` → "Opportunity Quote")
  //   4. literal `'Related'` as final fallback
  const resolvedObjectLabel = objectName && 'objectPluralLabel' in i18n
    ? i18n.objectPluralLabel({ name: objectName, label: humanizeLabel(objectName) })
    : objectName
      ? humanizeLabel(objectName)
      : '';
  const title = pickLocalized(schema.title, language) || resolvedObjectLabel || 'Related';

  const perms = usePermissions();
  const { readableFields } = useFieldPermissions(objectName || '');

  // Host-provided CRUD + action handlers for this child object. Absent when no
  // host wired the provider (Studio designer, standalone embed) — the related
  // list then stays read-only. The host decides, per child object, which of
  // create / edit / delete / view it exposes (lifecycle affordances + FLS), so
  // we simply wire whatever comes back. `resolve` is passed the relationship so
  // a newly-created child is pre-linked to the current parent.
  // [ADR-0090 SDUI panels] Which PARENT field the junction's relationshipField
  // stores (spec `relationshipValueField`, default 'id'). Name-keyed junctions
  // (the junction column stores the parent's machine name) set 'name' —
  // the resolved value drives the list filter, the Add-picker link value, AND
  // the pre-filled create form, so all three stay consistent. While the parent
  // record is still loading a non-id value resolves to null, which RelatedList
  // treats as "don't fetch yet".
  //
  // Read UN-CAST (objectui#9475). The mirror declares the key
  // (`RecordRelatedListComponentProps.relationshipValueField`, aligned to the
  // contract by objectui#9469/#8649), and a cast here unwrapped that
  // declaration at the one site it was added for: the read carried `any`, so
  // the annotation bought nothing HERE — the same declaration-defeated-by-a-cast
  // shape that card's contract review recorded as D1 on `record-reference-rail.tsx`.
  // What the un-cast read carries, and what it still does NOT refuse, is
  // re-derived every run by `record-related-list.relationshipValueFieldUncast-9475.test.tsx`
  // rather than written down here (AGENTS.md #9).
  const relationshipValueField: string = schema.relationshipValueField || 'id';
  const parentLinkValue: string | number | null =
    relationshipValueField === 'id'
      ? ((ctx?.recordId ?? null) as string | number | null)
      : ((ctx?.data as any)?.[relationshipValueField] ?? null);

  const relatedActions = useRelatedRecordActions();
  const handlers = React.useMemo(
    () =>
      // The `objectName &&` gate is the objectui#8649 erasure repair surfacing a
      // latent contract violation, not a behaviour change. `schema.objectName`
      // is OPTIONAL on this component by declaration (see the annotation above:
      // the gate binds it from `dataSource`, so it can arrive unbound), while
      // `ResolveRelatedRecordActionsInput.objectName` is `string`. Until the
      // default stopped erasing the annotation both read `any` and the mismatch
      // was invisible; `tsc` names it as TS2322 now.
      //
      // Output-identical, and both halves are measured rather than assumed:
      // `resolve` is pure and its only use of the key is
      // `objects.find((o) => o?.name === objectName)`, which finds nothing for
      // `undefined` and returns `{}`; and `handlers` is never read on this path
      // — the `if (!objectName)` placeholder return below (kept AFTER the hooks
      // for hook-order stability) discards it. So the gate replaces a discarded
      // `{}` with a discarded `null` and skips a lookup that could never hit.
      objectName
        ? (relatedActions?.resolve({
            objectName,
            relationshipField: schema.relationshipField,
            parentId: parentLinkValue,
          }) ?? null)
        : null,
    [relatedActions, objectName, schema.relationshipField, parentLinkValue],
  );

  /**
   * `actions` — the authored action ids, READ (objectui#11163; the maintainer's
   * ENFORCE ruling on objectstack-ai/objectstack#20665). The key was declared
   * and published with no read site, so an authored list changed nothing.
   *
   * THE COMPOSITION RULE, with the host bridge the handlers above come from:
   *
   *   - ABSENT → the host's actions, untouched (`handlers.toolbarActions` /
   *     `handlers.rowActions`, the child object's `list_toolbar` actions and
   *     its `list_item` / `record_related` ones), and no metadata lookup is
   *     made for this key.
   *   - AUTHORED → the authored list is what renders, in authored order:
   *     each id resolves against the RELATED object's registered `actions`
   *     and is placed by its own `locations` (see `relatedListActions.ts`).
   *     `[]` is the author's choice of no actions.
   *
   * The bridge offers no per-list channel of its own — `resolve` is keyed on
   * the child OBJECT (`objectName`, `relationshipField`, `parentId`), so two
   * lists of one object get one set — which is why this key is the per-list
   * one rather than a duplicate of it. Built-in New / Edit / Delete / View are
   * NOT action ids (the runtime ships no built-in action names) and stay the
   * host's either way. Running an authored action stays the host's too: it is
   * handed to the bridge's `onToolbarAction` / `onRowAction`, the executor
   * that already runs the child object's actions against the clicked row, so
   * with no host the list stays read-only exactly as it always has.
   *
   * The lookup is `useMetadataItem('object', …)`, the entry
   * `record:quick_actions.actionNames` and `page:header.actions` resolve
   * through, requested only when there is an id to resolve (`null` is its
   * documented no-op). Called here, with the other hooks, because the early
   * returns below would otherwise change the hook count.
   */
  const authoredActions: unknown = schema.actions;
  const actionsAuthored = authoredActions !== undefined;
  const needsActionLookup = !!objectName && relatedListActionsNeedLookup(authoredActions);
  /**
   * The FALLBACK remove (below, `onRowDelete`): offered with an `add` config
   * when no host handed over a delete. It deletes a row of THIS list's object,
   * so it reads that object's `relatedRowDelete` row of the affordance-to-grant
   * map (`resolveAffordance` in `@object-ui/core`, objectui#12082) — the row
   * the host's own delete reads — with the object's registered schema. So it
   * never offers a delete the host withheld: on a record page the host
   * withholds `onDelete` exactly when that row is closed, and the fallback used
   * to put the delete straight back. With no host and no permission provider
   * every grant reads open, as before. Withheld while the schema is in flight.
   */
  const removeFallbackCandidate = !!objectName && !!schema.add && !!ctx?.dataSource && !handlers?.onDelete;
  const { item: relatedObjectMeta, loading: relatedObjectMetaLoading } = useMetadataItem(
    'object',
    needsActionLookup || removeFallbackCandidate ? objectName : null,
  );
  const removeFallbackGranted =
    removeFallbackCandidate &&
    !relatedObjectMetaLoading &&
    resolveAffordance('relatedRowDelete', { objectSchema: relatedObjectMeta, objectName, perms }).allowed;
  const localizeActionTexts = useActionTextLocalizer();
  const placedActions = React.useMemo((): PlacedRelatedListActions<RelatedRowActionDef> | null => {
    if (!actionsAuthored) return null;
    // In flight: nothing is drawn and nothing is refused yet — refusing here
    // would name an id on every first paint that the lookup is about to find.
    if (needsActionLookup && relatedObjectMetaLoading) return { toolbar: [], row: [], refused: [] };
    const registered: RelatedRowActionDef[] = Array.isArray(relatedObjectMeta?.actions)
      ? (relatedObjectMeta.actions as RelatedRowActionDef[])
      : [];
    const placed = placeAuthoredRelatedListActions<RelatedRowActionDef>(authoredActions, registered);
    // Localized once, before the defs reach the list, so the button and the
    // dialog the host runs from the SAME def read one bundle entry
    // (objectui#4265) — the resolver the bridge applies to its own defaults.
    const localize = (a: RelatedRowActionDef) =>
      localizeActionTexts(objectName || undefined, a) as RelatedRowActionDef;
    return {
      toolbar: placed.toolbar.map(localize),
      row: placed.row.map(localize),
      refused: placed.refused,
    };
  }, [
    actionsAuthored,
    authoredActions,
    needsActionLookup,
    relatedObjectMeta,
    relatedObjectMetaLoading,
    objectName,
    localizeActionTexts,
  ]);

  // Missing objectName renders a designer placeholder — checked AFTER the hooks
  // above so hook order stays stable across renders.
  if (!objectName) {
    return (
      <div className={className} {...designer}>
        <div className="text-xs text-muted-foreground italic px-3 py-2 border border-dashed rounded">
          record:related_list — missing objectName
        </div>
      </div>
    );
  }

  // Automatic object-level read gate (objectui#2359). Related lists surface
  // the CHILD object's records, so they require `read` on that object — the
  // schema author never has to remember an explicit `requiredPermissions`
  // opt-in for this baseline. When the permission system has loaded and
  // denies read, the whole section vanishes (no header, no empty grid, no
  // "New" button that would 403 on save). Gated on `isLoaded` so unmounted /
  // still-loading permission contexts (Studio designer, standalone embeds)
  // keep rendering — the server enforces data access either way.
  if (perms.isLoaded && !perms.can(objectName, 'read')) {
    return null;
  }

  // Read UN-CAST (objectui#8649), like `enforceFieldSecurity` and
  // `redactFields` below. The mechanism is written once, at the same read in
  // `record-details.tsx`.
  const required: string[] = Array.isArray(schema.requiredPermissions)
    ? schema.requiredPermissions
    : [];
  /**
   * Block-level ADR-0066 CAPABILITY gate, read fail-closed (objectui#10155 —
   * the sibling family of objectui#10058, ruling batch #192 item 5 letter B).
   *
   * `requiredPermissions` on a record block is a **system capability set** —
   * the one meaning the word carries on `action`, `app`, `field` and
   * `bulkAction` — so it is read through the permission context's capability
   * path (`hasCapabilities` over the reported `systemPermissions`). An unheld
   * or unrecognised capability withholds the section's content, and an
   * insufficient-permissions notice (`role="status"`) renders in its place:
   * the block is not hidden. That is what the contract's describe on
   * `RecordRelatedListProps.requiredPermissions` says ("an
   * insufficient-permissions notice takes its place"). The automatic
   * child-object read gate above is a different gate and does hide the
   * section: it returns `null`.
   *
   * ⛔ NOT `perms.can(objectName, name)`. That call's second argument is the
   * closed object-action enum, and the stock `/me/permissions` provider maps
   * only eight verbs (`read`, `view`, `create`, `update`, `edit`, `delete`,
   * `import`, `export`) before its `?? 'allowRead'` tail sends everything else
   * to the object's read bit — so a capability nobody holds passed for every
   * reader of the object, with no refusal, no warning and no log. The full
   * reproduction behind that sentence is written once, at the same gate in
   * `record-quick-actions.tsx`, and is not restated here.
   *
   * ⛔ The object name is deliberately ABSENT from the verdict: a system
   * capability is not object-scoped. This site never carried the
   * `&& objectName` conjunct its siblings did and never needed one — the
   * "record:related_list — missing objectName" placeholder above returns
   * first — but the name it handed to the object-action path was the wrong
   * question either way.   *
   * ⚠️ A provider that never REPORTS capabilities (`systemPermissions`
   * `undefined` — the role-based `PermissionProvider`, a backend predating
   * ADR-0066, or no provider at all) still opens this gate. That is
   * `hasCapabilities`'s own ruled unreported-vs-empty doctrine
   * (objectui#4656), shared with every other capability gate in the tree; a
   * REPORTED empty array (`[]`, "holds nothing") is a real answer and gates
   * strictly.
   */
  if (required.length > 0 && !perms.hasCapabilities(required)) {
    return (
      <div className={className} {...designer} role="status" aria-live="polite">
        <p className="text-sm text-muted-foreground italic">
          Insufficient permissions to view related list.
        </p>
      </div>
    );
  }

  const enforceFLS = schema.enforceFieldSecurity === true;
  const redact: string[] = Array.isArray(schema.redactFields)
    ? schema.redactFields
    : [];
  const rawColumns: any[] = Array.isArray(schema.columns) ? (schema.columns as any[]) : [];
  let filteredColumns: any[] = rawColumns;
  if (enforceFLS || redact.length > 0) {
    const names = rawColumns.map(colName).filter((n): n is string => !!n);
    const allowed = new Set(
      (enforceFLS ? readableFields(names) : names).filter((n) => !redact.includes(n)),
    );
    filteredColumns = rawColumns.filter((c) => {
      const n = colName(c);
      // Fail CLOSED on an entry this fold cannot NAME (objectui#8793). The
      // else-branch used to KEEP such an entry, and that was the bypass: the
      // block resolves identity through `colName`, which deliberately refuses
      // the table library's own `accessorKey` (objectui#3104), while
      // `RelatedList` renders a column as `accessorKey || columnIdentity(c)`.
      // So a column authored `{ accessorKey: 'salary' }` was named by nobody
      // here, skipped both `enforceFieldSecurity` and `redactFields`, and then
      // painted its real values through the table's own key. An entry the
      // security fold cannot check is an entry it must not pass.
      //
      // Since objectui#9090 that example has a second gate below it: the block
      // now hands `redactFields` DOWN and `RelatedList` filters by the same
      // `accessorKey || columnIdentity` pair, as `filterFLS` beside it always
      // did for a declared field FLS denies. What this arm alone still decides
      // is a key the permission evaluator has no opinion about — one the child
      // object never declares, which `checkField` default-ALLOWS downstream.
      //
      // Scoped to the filtering path only: with neither key set this whole
      // branch is skipped and `columns` is handed down by reference, so an
      // ordinary related list renders exactly what it always did.
      return n ? allowed.has(n) : false;
    });
  }

  // The actions the list draws — see `placedActions` above for the rule. An
  // authored surface is handed down only beside the host's executor for it:
  // an action offered with nothing to run it would be a dead button.
  const toolbarActions = placedActions
    ? handlers?.onToolbarAction && placedActions.toolbar.length > 0
      ? placedActions.toolbar
      : undefined
    : handlers?.toolbarActions;
  const rowActions = placedActions
    ? handlers?.onRowAction && placedActions.row.length > 0
      ? placedActions.row
      : undefined
    : handlers?.rowActions;
  const refusedActions = placedActions?.refused ?? [];
  /**
   * Authored actions that resolved and were placed, but that no host executor
   * can run here, so the list does not draw them (objectui#12870). An action
   * offered with nothing to run it would be a dead button, so it stays undrawn,
   * but never without a word: the notice below names it.
   *
   * The usual case is a list on a custom page whose parent did not resolve to a
   * record: the page serves the record page's executor only to a list that has
   * a parent in scope (`parentDataSource`). With no provider at all (the Studio
   * designer, a standalone embed) the same notice names the same entries.
   */
  const unservedActions: string[] = placedActions
    ? [
        ...(handlers?.onToolbarAction ? [] : placedActions.toolbar),
        ...(handlers?.onRowAction ? [] : placedActions.row),
      ]
        .map((a) => String(a.name))
        .filter((name, idx, all) => all.indexOf(name) === idx)
    : [];
  /**
   * WHO sees the refusal notice (objectui#11768). An authored id this list
   * cannot draw is an authoring fault, and `os validate` already refuses it at
   * build time (objectstack-ai/objectstack#20936); the notice is its runtime
   * echo for the person who can fix the page. So it is drawn for a viewer
   * holding the metadata-edit capability, or in dev mode — never for an end
   * user, who can act on neither the id nor the object it names.
   *
   * What does NOT depend on the viewer: the refused entry stays undrawn for
   * everyone, and the entries that did resolve render for everyone. Only the
   * notice's audience is scoped.
   *
   * The capability is read as `useCanAuthorMetadata()` reads it — through
   * `hasCapabilities`, which fails OPEN when the provider never reported
   * `systemPermissions` (a backend predating ADR-0066, the role-based
   * provider, no provider at all: the Studio designer and standalone embeds)
   * and gates strictly on a reported set, a reported empty one included
   * (objectui#4656). The hosted workspace owner whose reported set carries no
   * `manage_metadata` (objectstack#8270) therefore does not see it.
   */
  const authoringAudience = isDevBuild() || perms.hasCapabilities([METADATA_AUTHORING_CAPABILITY]);
  const showActionRefusals = refusedActions.length > 0 && authoringAudience;
  // The unserved-actions notice has the refusal notice's audience: both name an
  // authoring fault for the person who can fix the page (objectui#11768).
  const showUnservedActions = unservedActions.length > 0 && authoringAudience;
  /**
   * `showViewAll` — READ (objectui#12741; ENFORCE, the objectui half of
   * objectstack-ai/objectstack#23941). The contract declares it
   * `z.boolean().default(true)`, "Show 'View All' link to see all related
   * records". Before this read the key changed nothing and the link never drew.
   *
   *   - ABSENT or `true` → the link draws when the host offers a destination
   *     (`handlers.onViewAll`: the child object's list scoped to this parent,
   *     on this list's relationship) and the list has records.
   *   - `false` → no link, whatever the host offers.
   *
   * The destination is the host's, like every route on this list: the bridge
   * withholds it when no route it has can show this parent's children, and
   * with no host there is nothing to open. `RelatedList` draws no link on an
   * empty list.
   */
  const onViewAll = schema.showViewAll === false ? undefined : handlers?.onViewAll;

  return (
    <div className={className} {...designer} {...ariaProps}>
      {showActionRefusals && (
        // The author-visible refusal the ruling asks for: an authored entry
        // this list cannot draw is named here, where the lookup answered,
        // never dropped without a word. Beside the list, not in place of it —
        // the entries that did resolve still render.
        <div
          role="status"
          aria-live="polite"
          data-testid="record-related-list-actions-refused"
          className="mb-2 text-xs text-muted-foreground italic px-3 py-2 border border-dashed rounded"
        >
          {describeRelatedListActionRefusals(refusedActions, objectName, !!relatedObjectMeta)}
        </div>
      )}
      {showUnservedActions && (
        // Beside the refusal notice: these entries resolved, and nothing here
        // can run them (objectui#12870).
        <div
          role="status"
          aria-live="polite"
          data-testid="record-related-list-actions-unserved"
          className="mb-2 text-xs text-muted-foreground italic px-3 py-2 border border-dashed rounded"
        >
          {`record:related_list — actions not drawn: ${unservedActions.map((n) => `"${n}"`).join(', ')}. ` +
            (parentLinkValue == null || parentLinkValue === ''
              ? 'This list has no parent record in scope, so nothing can run its actions: bind the parent with `parentDataSource`, or place the list on a record page.'
              : 'No host on this page offers an executor for them.')}
        </div>
      )}
      <RelatedList
        title={title}
        type="table"
        api={objectName}
        objectName={objectName}
        referenceField={schema.relationshipField}
        parentId={parentLinkValue as any}
        // A column object's `label` locale map resolves to the UI language
        // first (`localizeColumnLabels`, objectui#10993); the same array, by
        // reference, when no column carries one.
        columns={localizeColumnLabels(filteredColumns, language) as any}
        // [objectui#9053] The same list, pushed down to the component that
        // DECIDES columns. Filtering the authored array here only ever reached
        // one of the three paths that decide them: redacting every authored
        // column emptied this array, `RelatedList` read the empty array as "no
        // columns were authored", and its auto-derivation — which this list
        // never reached — brought the redacted field back. Passed by reference
        // (and `undefined` when unauthored) so the column memo downstream keeps
        // a stable dependency.
        redactFields={redact.length > 0 ? redact : undefined}
        pageSize={
          typeof schema.limit === 'number' && schema.limit > 0
            ? schema.limit
            : SPEC_DEFAULT_LIMIT
        }
        defaultSort={schema.sort}
        // The list's own scope, ANDed with the parent relationship by
        // `RelatedList` (spec `RecordRelatedListProps.filter`,
        // objectstack#7118). When a `dataSource` binding is present this key
        // already carries the composed component-AND-view-AND-binding filter —
        // `ElementDataSourceGate` wrote it here, which is only legitimate now
        // that the value is read.
        filter={schema.filter}
        dataSource={ctx?.dataSource}
        add={
          // Read UN-CAST (objectui#9964). The cast that used to stand here was
          // load-bearing for one reason only: the mirror typed
          // `add.picker.filter` as `unknown` while this component's own prop
          // types it `ViewFilterRule[]`, so un-casting was a TS2322 — the
          // divergence, kept invisible by the cast. The mirror now carries the
          // protocol's array, so the declaration reaches this read and a
          // wrong-shaped picker filter is refused here instead of downstream.
          schema.add
            ? {
                ...schema.add,
                // The Add-button label may carry inline translations too.
                label: pickLocalized(schema.add.label, language) || undefined,
              }
            : undefined
        }
        rowActions={rowActions}
        onRowAction={handlers?.onRowAction}
        toolbarActions={toolbarActions}
        onToolbarAction={handlers?.onToolbarAction}
        // Create a new child, pre-linked to this parent (增). Host omits when
        // create is denied by lifecycle/permissions, hiding the "New" button.
        onNew={handlers?.onCreate}
        // [#4646] …and greys it — without hiding it — when the child object's
        // `userActions.create.disabledWhen` holds for THIS parent record. The
        // host owns both verdicts (it is the side that has the parent record
        // and the predicate evaluator); this renderer only wires them.
        newDisabled={handlers?.createDisabled}
        // "View all": the child object's list page, scoped to this parent —
        // see `onViewAll` above for when it is offered.
        onViewAll={onViewAll}
        // Open the child record's detail page on row click (查看记录详情).
        onRowClick={
          handlers?.onView
            ? (row: any) => {
                const id = rowId(row);
                if (id != null) handlers.onView!(id, row);
              }
            : undefined
        }
        // Open the child record's edit form (改).
        onRowEdit={
          handlers?.onEdit
            ? (row: any) => {
                const id = rowId(row);
                if (id != null) handlers.onEdit!(id, row);
              }
            : undefined
        }
        onRowDelete={
          // Delete the child record (删). Prefer the host handler (gated by
          // lifecycle affordance + permissions); fall back to the generic
          // link/junction remove when an `add` config is present so managed
          // assignment lists keep working without a host provider — and only
          // where the map's `relatedRowDelete` row allows it
          // (`removeFallbackGranted` above, objectui#12082). RelatedList
          // shows the confirm dialog and refreshes after this resolves.
          handlers?.onDelete
            ? (row: any) => {
                const id = rowId(row);
                if (id != null) return handlers.onDelete!(id, row);
              }
            : removeFallbackGranted
              ? async (row: any) => {
                  const id = row?.id ?? row?._id;
                  if (id != null) await ctx?.dataSource?.delete?.(objectName, String(id));
                }
              : undefined
        }
      />
    </div>
  );
};

/**
 * What this block reads for its own query: `objectName`, `columns` (a FIELD
 * list), `filter`, `sort` (`defaultSort`) and `limit` (`pageSize`).
 *
 * `filter` was the one key deliberately left unmapped when this wiring landed
 * (objectstack#6953), because the block DECLARED it and no code read it: writing
 * the composed filter onto a dead key would have reproduced the very defect that
 * change removed, one layer deeper. objectstack#7118 gave it a read site —
 * `RelatedList` now ANDs it with the parent-relationship condition, whose
 * spelling follows the relationship field's arity (`=` for a single-valued
 * field, `$contains` for a `multiple: true` one — objectui#7299) — so the
 * mapping follows, and with it the consequence recorded here as open: a saved
 * view named on this block no longer contributes columns/sort/limit while its
 * FILTER is dropped, i.e. the list can no longer be wider than the view it names.
 */
const RECORD_RELATED_LIST_DATA_SOURCE: ElementDataSourceMapping = {
  columns: true,
  filter: true,
  sort: true,
  limit: 'limit',
};

/**
 * Stable stand-in for a missing `schema`. A fresh `{}` per render would give the
 * body a new schema identity every time — the churn `useElementDataSourceSchema`
 * avoids by returning the schema BY REFERENCE when there is no binding.
 */
const NO_SCHEMA = {} as RecordRelatedListRendererProps['schema'];

/**
 * The CHILD rows: the spec's per-element `dataSource` binding mapped onto the
 * keys the body reads (objectstack#6953), under whichever record context is the
 * parent's.
 */
const RecordRelatedListChildRows: React.FC<RecordRelatedListRendererProps> = (props) => {
  // The record context's adapter, not the schema-renderer context's: this list
  // reads its rows through `ctx.dataSource`, and resolving `view` against a
  // different source than the rows come from could report a view as missing on
  // a host that has it.
  const ctx = useRecordContext();
  // objectui#12920 — the unresolvable-view panel's title reads the bundle.
  const { t } = useObjectTranslation();
  return (
    <ElementDataSourceGate
      schema={props.schema ?? NO_SCHEMA}
      mapping={RECORD_RELATED_LIST_DATA_SOURCE}
      dataSource={ctx?.dataSource}
      testId="record-related-list"
      errorTitle={t('element.relatedList.sourceUnresolved', {
        defaultValue: 'This related list’s data source could not be resolved',
      })}
    >
      {(bound) => <RecordRelatedListBody {...props} schema={bound as any} />}
    </ElementDataSourceGate>
  );
};

/**
 * The loud absence `parentDataSource` owes when no row answers (the spec's
 * describe: "never an empty list, which would read as 'this record has no
 * related records'"). Drawn in the block's own place, on the block's own
 * container, so the designer still selects it.
 */
const NoParentRecord: React.FC<{
  object: unknown;
  className?: string;
  designer: Record<string, unknown>;
}> = ({ object, className, designer }) => (
  <div className={className} {...designer}>
    <div
      role="status"
      aria-live="polite"
      data-testid="record-related-list-parent-absent"
      className="text-sm text-muted-foreground px-3 py-2 border border-dashed rounded"
    >
      {`No “${typeof object === 'string' ? object : 'parent'}” record matches this related list’s parent binding, so there is no parent record to list related records for.`}
    </div>
  </div>
);

/**
 * `record:related_list`, with its TWO bindings (ruling B on objectui#12296):
 *
 *  - the PARENT record — `parentDataSource`, the spec row's member, read by
 *    {@link ParentRecordBinding}: the first row of the binding by its `sort`
 *    becomes the record context the body reads, and no row is a loud absence.
 *    Absent, the parent is the record page's record context, as it always was;
 *  - the CHILD rows — the node's `dataSource`, mapped onto the keys the body
 *    reads by {@link RecordRelatedListChildRows}. It keeps its published
 *    meaning and is never read as the parent.
 *
 * The parent scope sits OUTSIDE the child gate because the child gate and the
 * body read the parent's record context (its id, its row, its adapter).
 *
 * The gates wrap the EXPORTED name rather than being added at the registration
 * site, so a host that imports this renderer directly gets both bindings too — a
 * block bound under one entry point and unbound under another is the same
 * "declared but not reached" shape in miniature.
 */
export const RecordRelatedListRenderer: React.FC<RecordRelatedListRendererProps> = elementDataSourceBlock((props) => {
  const { schema, className, ...rest } = props;
  const parentBinding = schema?.parentDataSource;
  // objectui#12920 — the parent-read panel's title reads the bundle.
  const { t } = useObjectTranslation();
  return (
    <ParentRecordBinding
      binding={parentBinding}
      blockKey="record:related_list"
      testId="record-related-list-parent"
      errorTitle={t('element.relatedList.parentUnreadable', {
        defaultValue: 'This related list’s parent record could not be read',
      })}
      absent={<NoParentRecord object={parentBinding?.object} className={className} designer={splitDesigner(rest).designer} />}
    >
      <RecordRelatedListChildRows {...props} />
    </ParentRecordBinding>
  );
});

export default RecordRelatedListRenderer;
