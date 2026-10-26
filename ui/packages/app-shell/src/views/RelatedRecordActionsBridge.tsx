/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RelatedRecordActionsBridge — supplies the console's object-aware CRUD +
 * action handlers to the `record:related_list` renderers on a detail page.
 *
 * The renderer (in `@object-ui/plugin-detail`) knows the child object, the FK
 * back to the parent, and the parent id — but not the SPA routes, the
 * create/edit form pages, or the per-object lifecycle affordances. This bridge
 * (mounted inside the page's `ActionProvider`) closes that gap:
 *
 *   - 查看详情 → navigate to the child record's detail route
 *   - 增 / 改   → open the child form as an OVERLAY on the parent detail
 *                 (objectstack-ai/objectstack#2604 D3: a child task's return target is ALWAYS the parent
 *                 detail with the subtable refreshed — never a route, which
 *                 would drop the parent's scroll/tab context and refetch it).
 *                 Implemented by pushing the console's record-form URL params
 *                 (`?form=…&formObject=…&formLink=…`) — the ONE global record
 *                 form overlay in `AppContent` picks them up, pre-links the
 *                 parent from `formLink`, sizes to the CHILD object, and on
 *                 save stays put + refetches the child's related lists
 *                 (`notifyRelatedChanged`). URL-driven means browser Back
 *                 closes the overlay and a refresh reopens it STILL correctly
 *                 parent-linked.
 *   - 删        → `dataSource.delete(child, id)` (RelatedList shows the confirm
 *                 dialog and refreshes afterwards)
 *   - 查看全部  → the child object's list page scoped to this parent
 *                 (`onViewAll`, the related list's "View all" link,
 *                 objectui#12741)
 *   - 子对象 action → the child object's `list_item` actions, and its
 *                 `record_related` ones when a parent record is in scope,
 *                 executed against the clicked row through the page's shared
 *                 ActionRunner
 *
 * Each affordance is gated by {@link resolveEffectiveCrudAffordances} so system /
 * append-only children never show New / Edit / Delete. When this bridge is
 * absent (e.g. the Studio designer) the related list stays read-only.
 *
 * ## The related-list toolbar's create predicates (objectui#4646)
 *
 * `@objectstack/spec@17.0.0` widened `userActions.create` from a bare boolean
 * to `z.union([z.boolean(), RowCrudActionOverrideSchema])`, so
 * `resolveCrudAffordances` now emits `createPredicates` beside the
 * `editPredicates` / `deletePredicates` the row surfaces have consumed since
 * objectui#2614. Nothing read them: the spec's CHANGELOG named "the
 * related-list toolbar honouring `create.visibleWhen`" as objectui's downstream
 * card, and this is that card. A parent record entering a frozen state greyed
 * its children's row Edit/Delete correctly while "+ New" stayed live, so the
 * user filled in the whole child form to earn a 409.
 *
 * The binding is the spec docblock's, not an invention here: unlike the ROW
 * predicates, `createPredicates` evaluates **once per toolbar, against the
 * record of the scope the toolbar sits in** — on a record page's related list
 * that is the HOST PARENT record, which is why `parentRecord` had to be
 * threaded in beside the `parentRecordId` this bridge already carried. (An id
 * cannot answer `record.status != 'frozen'`.) A standalone object list has no
 * record in scope and evaluates nothing — it never reaches this bridge at all.
 *
 * Evaluated WITHOUT a hook, deliberately: `resolve` answers for a VARIABLE
 * number of related lists inside one `useMemo`, so a `useRowPredicate` per
 * child object would tie the hook count to the page's related-list count. This
 * is the same constraint — and the same resolution — as `plugin-grid`'s
 * `evalRowActionVisibility`, whose row loop faces it per action. The evaluator
 * underneath is the canonical one either way (`evalRowPredicate`), and the fail
 * directions below are the record header's verbatim.
 */

import { useCallback, useMemo } from 'react';
import { useHref, useNavigate, useSearchParams } from 'react-router-dom';
import {
  RelatedRecordActionsProvider,
  notifyDataChanged,
  useAction,
  useActionTextLocalizer,
  usePredicateScope,
  type ActionTextLocalizer,
  type RelatedRecordActionsValue,
  type RelatedRecordHandlers,
  type RelatedRowActionDef,
} from '@object-ui/react';
import { evalRowPredicate, isMultiValueRelationship, resolveAffordance, type ActionDef, type RowCrudPredicates } from '@object-ui/core';
import { actionRendersAt, type ActionLocation } from '@object-ui/types';
import { usePermissions } from '@object-ui/permissions';
import { RECORD_FORM_PARAM, RECORD_FORM_OBJECT_PARAM, RECORD_FORM_LINK_PARAM, RECORD_TRAIL_PARAM, appendRecordTrail } from '../urlParams.js';
import { documentHref } from './documentHref.js';
import { recordListPath } from './useOpenRecordList.js';
import { resolveRecordFormTarget } from '../utils/recordFormNavigation.js';

/**
 * Notify open related lists for `objectName` to refetch.
 *
 * Since #2269 this is a thin alias over the data-invalidation bus — the bus
 * dispatches the legacy `objectui:related-changed` window event RelatedList
 * listens for, plus every `useDataInvalidation` reader. Kept for callers
 * whose writes BYPASS the dataSource (row actions over the ActionRunner);
 * dataSource writes need no manual call (the MutationEvent bridge covers
 * them).
 */
export function notifyRelatedChanged(objectName: string): void {
  notifyDataChanged({ objectName });
}

/**
 * [#4646] Evaluate one toolbar-scope create predicate the way the record
 * header's edit/delete predicates are evaluated — on the canonical CEL engine,
 * failing CLOSED with a diagnosable warning — but WITHOUT a hook.
 *
 * Mirrors `useRowPredicate(pred, record, { fallback: false, warnOnError: true,
 * label, fields })` exactly, boolean short-circuit included. The short-circuit
 * is not an optimisation: a boolean handed to the engine faults ("AST-only
 * evaluation not yet supported") and would fail closed, which is how
 * `visible: true` once hid a bulk button from everyone (objectui#3492).
 *
 * Hook-free for the reason `plugin-grid`'s `evalRowActionVisibility` is: the
 * caller answers for a VARIABLE number of related lists inside one `useMemo`.
 *
 * Whether a gate was DECLARED is not decided here — each caller below answers
 * that first, by its own rule (`?? true` for `visibleWhen`, `!= null` for
 * `disabledWhen`). An empty predicate that reaches an evaluator is unevaluable
 * and fails closed like any other.
 */
function evalCreatePredicate(
  pred: unknown,
  record: Record<string, any> | null | undefined,
  scope: Record<string, unknown>,
  label: string,
  fields: unknown,
): boolean {
  if (typeof pred === 'boolean') return pred;
  if (pred == null || pred === '') return false;
  return evalRowPredicate(pred as never, record ?? {}, {
    fallback: false,
    scope,
    warnOnError: true,
    label,
    fields: fields as never,
  });
}

/**
 * The names of the objects a console host can route to: one record route
 * exists per object definition it holds (objectui#12673).
 *
 * Shared by this bridge and the object list host (`listRecordActionsValue` in
 * `ObjectView`), which both read the console's `objects` prop, so the two
 * cannot disagree on which targets are linkable.
 */
export function routableObjectNames(objects: ReadonlyArray<unknown> | null | undefined): Set<string> {
  return new Set(
    (objects ?? [])
      .map((o) => (o as { name?: unknown } | null | undefined)?.name)
      .filter((name): name is string => typeof name === 'string' && name !== ''),
  );
}

/**
 * THE record-detail route shape, as a ROUTER path (no basename):
 * `/apps/:app/:object/record/:id` (objectui#12673).
 *
 * `null` when the host cannot route there: no app segment, or an object that
 * is not in this console's metadata. Consumers render `null` as the plain
 * value, so a non-routable target never yields a link to a page that would
 * refuse. The record page's bridge adds its `?from=` trail on top; the list
 * host, which has no parent record, uses it as is.
 */
export function appRecordPath(
  appName: string | undefined,
  routableObjects: ReadonlySet<string>,
  objectName: string,
  recordId: string | number,
): string | null {
  if (!appName || !objectName || !routableObjects.has(objectName)) return null;
  return `/apps/${appName}/${objectName}/record/${encodeURIComponent(String(recordId))}`;
}

export interface RelatedRecordActionsBridgeProps {
  /** Current app segment used to build `/apps/:appName/...` routes. */
  appName?: string;
  /** All object definitions (to resolve the child object + its actions). */
  objects: any[];
  /** Data source for delete + action dispatch. */
  dataSource: any;
  /**
   * The record this bridge is mounted under — the PARENT of any related row a
   * user drills into. Threaded into the child record's `?from=` trail so the
   * breadcrumb can offer a path back (`Account → #parent → Invoice → #child`).
   * Omit when there is no parent context (e.g. a standalone list).
   */
  parentObjectName?: string;
  parentRecordId?: string;
  parentTitle?: string;
  /**
   * [#4646] The parent record ITSELF — the subject the child objects'
   * `userActions.create` predicates are evaluated against, per the spec
   * docblock ("the record in scope where the toolbar renders"). `parentRecordId`
   * above cannot stand in for it: `record.status != 'frozen'` needs the fields,
   * not the key.
   *
   * Omitting it leaves every create predicate unevaluable, which fails CLOSED
   * for `visibleWhen` exactly as it does on the record header — so a host that
   * gates creation on the parent must pass the record, and a host with no
   * parent record in hand should not be declaring create predicates on its
   * children. Hosts that declare none are untouched either way: with no
   * `createPredicates` there is nothing to evaluate.
   */
  parentRecord?: Record<string, any> | null;
  /**
   * [#4646] The PARENT object's field definitions, handed to the predicate for
   * the same reason the row kebab and the record header pass theirs: a relation
   * field must bind as the stored FOREIGN KEY rather than whatever `$expand`
   * substituted for it on this surface, or `record.owner == os.user.id` answers
   * a different question here than it does on the list.
   *
   * The parent's, not the child's — the record being bound is the parent.
   */
  parentObjectFields?: unknown;
  /**
   * What this bridge publishes, derived from the value it builds (objectui#12870).
   *
   * Absent, the bridge publishes its own value, which is what the record page
   * mounts. A custom page passes `pageRecordActionsValue` here: the page keeps
   * its own record and list navigator, and serves this bridge's related-list
   * executor to the lists that bound a parent through `parentDataSource`. So a
   * page list's authored actions run through the executor below, under the
   * page's own `ActionProvider`, and no second executor exists.
   *
   * Called on every render, and nothing rests on the identity of what it
   * returns (AGENTS.md #10).
   */
  serve?: (bridge: RelatedRecordActionsValue) => RelatedRecordActionsValue;
  /**
   * The parent record of each related list is the one the LIST names (the
   * `parentId` it resolves with), not one record this bridge is mounted under
   * (objectui#12870). Set by a custom page, whose lists bind their parents
   * through `parentDataSource`, each its own. Absent, the mount's
   * `parentRecordId` decides, as on the record page.
   */
  parentFromList?: boolean;
  children: React.ReactNode;
}

/**
 * The locations a related list places on each ROW, by whether a parent record
 * is in scope (objectui#11270).
 *
 * `list_item` places an action on the child's rows wherever the child is
 * listed. `record_related` places it on them only inside a parent record's
 * related-list section: objectstack-ai/objectstack#20937's enforce answer
 * (triage `5919625056`) read the spec's "actions on a related list section
 * inside a record" as row placement, and the runtime counts the location among
 * those that require a record. The child object's own list view reads
 * `list_item` alone, in `ObjectView`.
 */
const ROW_LOCATIONS_IN_RECORD = ['list_item', 'record_related'] as const;
const ROW_LOCATIONS = ['list_item'] as const;
const TOOLBAR_LOCATIONS = ['list_toolbar'] as const;

/**
 * Derive the child object's actions for a related-list surface (the row menu
 * or the header buttons), localized and shaped for the related-list bridge.
 *
 * An action renders on the surface when it declares ANY of the surface's
 * locations, read through the platform's one placement rule
 * (`actionRendersAt`), so an action declaring two of them renders once, in the
 * child object's declared order.
 */
function deriveActions(
  childDef: any,
  localizeActionTexts: ActionTextLocalizer,
  locations: readonly ActionLocation[],
): RelatedRowActionDef[] {
  const actions = Array.isArray(childDef?.actions) ? childDef.actions : [];
  return actions
    .filter((a: any) => locations.some((location) => actionRendersAt(a, location)))
    // One bundle entry, one fate (objectui#4265): the row menu's label used to
    // be the ONLY string resolved here, so `runRowAction` below dispatched the
    // child action's `confirmText` / `successMessage` in the authored language
    // next to a translated menu item.
    .map((a: any) => localizeActionTexts(childDef.name, a) as RelatedRowActionDef);
}

export function RelatedRecordActionsBridge({
  appName,
  objects,
  dataSource,
  parentObjectName,
  parentRecordId,
  parentTitle,
  parentRecord,
  parentObjectFields,
  serve,
  parentFromList = false,
  children,
}: RelatedRecordActionsBridgeProps) {
  const navigate = useNavigate();
  const { runner } = useAction();
  const [, setSearchParams] = useSearchParams();
  const perms = usePermissions();
  // [#4646] The host predicate scope (`features.*` / `os.user.*` / …), read
  // ONCE here rather than per resolved child list — `resolve` is hook-free by
  // construction (see the module note). This is the same scope
  // `useRowPredicate` reads for the record header's edit/delete predicates, so
  // a `create` predicate and an `edit` predicate on the same page see the same
  // globals.
  const predicateScope = usePredicateScope();
  // The child action's authored strings go through the ONE shared resolver
  // (objectui#4265). This used to arrive as an `actionLabel` prop injected by
  // RecordDetailView — an injection point that could only ever carry the LABEL,
  // which is precisely how the row menu ended up translated while its confirm
  // dialog stayed in the authored language.
  const localizeActionTexts = useActionTextLocalizer();
  const base = appName ? `/apps/${appName}` : '';
  // The router's href for its root, basename included (see `documentHref`).
  // Read once here, because `recordHref` below runs per rendered lookup.
  const routerRootHref = useHref('/');
  /** A parent record is in scope: the related lists below sit inside it. */
  const hasParentRecord = parentRecordId != null && parentRecordId !== '';

  /** Objects this host can route to — the record route exists per object def. */
  const routableObjects = useMemo(() => routableObjectNames(objects), [objects]);

  /**
   * THE record-detail route for this page — one route shape, one place.
   *
   * A ROUTER path (`/apps/:app/:object/record/:id`, no basename), which is what
   * `navigate` takes. Both of this page's ways of reaching a record derive from
   * it: the related list's row navigation (`onView`, through `openRecord`) and
   * the href the lookup values render (`recordHref`), so the two cannot address
   * different records.
   *
   * `null` when the host cannot route there (no app segment, or an object that
   * is not in this console's metadata), which renders as the plain value.
   */
  const recordPath = useCallback(
    (objectName: string, recordId: string | number): string | null => {
      const url = appRecordPath(appName, routableObjects, objectName, recordId);
      if (url === null) return null;
      // Carry the parent record into the target's `?from=` trail so the
      // breadcrumb (and the record body's back link) can path back up.
      // Read the current trail off the live URL — this bridge outlives a
      // single search-params snapshot, so a fresh read avoids a stale
      // closure and keeps nested drill-ins accumulating correctly.
      if (parentObjectName && parentRecordId) {
        const rawFrom = new URLSearchParams(window.location.search).get(RECORD_TRAIL_PARAM);
        const trail = appendRecordTrail(rawFrom, {
          o: parentObjectName,
          i: parentRecordId,
          ...(parentTitle ? { t: parentTitle } : {}),
        });
        const sp = new URLSearchParams();
        sp.set(RECORD_TRAIL_PARAM, trail);
        return `${url}?${sp.toString()}`;
      }
      return url;
    },
    [appName, routableObjects, parentObjectName, parentRecordId, parentTitle],
  );

  /**
   * The same destination as an HREF, for the lookup values rendered anywhere
   * under this bridge (objectui#4336): a lookup points at a record of another
   * object, and `LookupCellRenderer` has no router, so it asks for the href
   * instead of re-deriving `/apps/:app/:object/record/:id` a second time (the
   * #4472 lesson — one resolver).
   *
   * The browser reads an href, not the router, so it carries the router's
   * basename (objectui#12233; see {@link documentHref}). The published
   * contract offers it for "open in new tab" and "copy link address", and a
   * console mounted at `/_console` used to hand out the bare route instead:
   * only a plain left click, which `openRecord` routes, reached the record.
   */
  const recordHref = useCallback(
    (objectName: string, recordId: string | number): string | null => {
      const path = recordPath(objectName, recordId);
      return path === null ? null : documentHref(routerRootHref, path);
    },
    [recordPath, routerRootHref],
  );

  /**
   * SPA-navigate to the destination {@link recordHref} addresses — by its
   * router path, because `navigate` applies the basename itself.
   */
  const openRecord = useCallback(
    (objectName: string, recordId: string | number) => {
      const path = recordPath(objectName, recordId);
      if (path) navigate(path);
    },
    [recordPath, navigate],
  );

  // objectstack-ai/objectstack#2604 D3 — open a child create/edit task as the console's global record
  // form overlay, by URL params. Pushes ONE history entry (Back = close, the
  // parent detail stays mounted underneath). The read side lives in
  // `AppContent` (see its record-form URL contract).
  //
  // objectui#13089 — a create linked to NO parent is not a child task: it is
  // the object's own create (a page `list-view` node's Add button), so it
  // takes the object list's create semantics. For an `editMode: 'page'`
  // object that is the full-page create route `AppContent`'s `handleEdit`
  // navigates to (`resolveRecordFormTarget`), not the overlay.
  const openChildForm = useCallback(
    (opts: { objectName: string; recordId?: string; link?: { field: string; parentId: string | number } }) => {
      if (opts.recordId == null && !opts.link) {
        const target = resolveRecordFormTarget({
          objectDef: objects.find((o: any) => o?.name === opts.objectName),
          baseUrl: base,
          record: null,
        });
        if (target.kind === 'page') {
          navigate(target.url);
          return;
        }
      }
      const sp = new URLSearchParams(window.location.search);
      sp.set(RECORD_FORM_PARAM, opts.recordId ?? 'new');
      sp.set(RECORD_FORM_OBJECT_PARAM, opts.objectName);
      if (opts.link) sp.set(RECORD_FORM_LINK_PARAM, `${opts.link.field}:${opts.link.parentId}`);
      else sp.delete(RECORD_FORM_LINK_PARAM);
      setSearchParams(sp); // push → Back closes the overlay
    },
    [setSearchParams, objects, base, navigate],
  );

  // Execute a child object's row action against the clicked record. Reuses the
  // page's ActionRunner (confirm dialog, toast, param collection are handled by
  // it) and retargets it at the CHILD object + row in two ways:
  //
  //   - the row is the dispatch's EXECUTION CONTEXT (objectui#13063): the
  //     runner's context names the page, the parent record, and the row is a
  //     record of the child object. Handed as `{ record, objectName }`, every
  //     executor reads the row as the record the action runs against, exactly
  //     as a dispatch from the child's own record page does. A `type: 'form'`
  //     action needs nothing else: `executeForm` reads the record and its
  //     object from the context only (it ignores `action.objectName`,
  //     objectui#4292), so with the page's context it compared the child's
  //     view against the parent object and opened a blank create form;
  //   - the action's `objectName` / `recordId` and the `_rowRecord` stash stay
  //     on the definition, which the record-detail and console handlers
  //     (`api`, `flow`, `script`) and the update path read.
  //
  // A toolbar dispatch (no row) keeps the page's context.
  const runRowAction = useCallback(
    async (childObject: string, record: any, action: RelatedRowActionDef) => {
      const id = record?.id ?? record?._id;
      // Same dispatch shape as ObjectGrid.onActionDef: a metadata action's
      // `params` is the ActionParam[] COLLECTION DEFINITION — surface it as
      // `actionParams` (the runner's param-dialog input) and reserve `params`
      // for the `_rowRecord` stash (apiHandler row-id injection +
      // `defaultFromRow` prefill). Spreading the array into `params` used to
      // produce `{0: {...}}`, which downstream consumers sent to the data API
      // as a fields map → INVALID_FIELD: Unknown field '0'.
      const { params: rawParams, ...rest } = action as unknown as ActionDef & { params?: unknown };
      const def: any = {
        ...rest,
        objectName: childObject,
        ...(id != null ? { recordId: String(id) } : {}),
        params: { _rowRecord: record },
      };
      if (Array.isArray(rawParams) && rawParams.length > 0) {
        def.actionParams = rawParams;
      }
      const rowContext = record && typeof record === 'object'
        ? { record, objectName: childObject }
        : undefined;
      const res = await runner.execute(def as ActionDef, rowContext);
      // Refresh open related lists for this child object after a successful
      // mutating action (the row menu handler is otherwise fire-and-forget).
      if (res?.success) notifyRelatedChanged(childObject);
    },
    [runner],
  );

  const value = useMemo<RelatedRecordActionsValue>(
    () => ({
      resolve: ({ objectName, relationshipField, parentId }) => {
        const childDef = objects.find((o: any) => o?.name === objectName);
        if (!childDef || !base) return {} as RelatedRecordHandlers;
        // [objectstack#3546] Intersect the child object's bucket affordances with the
        // server-resolved effective API operation set for THAT child
        // (`/me/permissions` `apiOperations`), so a related list never offers
        // Create/Edit/Delete on the child the server would 405. `undefined`
        // (unrestricted / old backend) leaves the affordances untouched.
        //
        // [#4096] …then with the CURRENT PRINCIPAL's permission on the child
        // (`allowCreate` / `allowEdit` / `allowDelete`). `apiOperations` is the
        // child object's exposure surface and is identical for every account,
        // so on its own it fails open: a related list used to offer Edit and
        // Delete to a principal with no write grant on the child. `can()`
        // answers `true` with no `PermissionProvider`, which keeps standalone
        // embeds exactly where they were.
        //
        // [objectui#12082] All three layers are the child's rows of the
        // affordance-to-grant map — `relatedNew`, `relatedRowEdit`,
        // `relatedRowDelete` — resolved by `resolveAffordance` from
        // `@object-ui/core`, the one verdict every console affordance reads.
        const source = { objectSchema: childDef, objectName, perms };
        const newVerdict = resolveAffordance('relatedNew', source);
        const objectCanCreate = newVerdict.allowed;
        // [#4646] The per-scope layer, on top of the object-level verdict above.
        // Surfaced only when that verdict passed — the same posture
        // `resolveRowCrudAffordances` takes for the row predicates
        // (`editPredicates: canEdit ? aff.editPredicates : undefined`): a
        // predicate cannot re-open an affordance the bucket, the effective API
        // operations or the principal's grant already closed.
        const createPredicates: RowCrudPredicates | undefined = newVerdict.predicates;
        /**
         * `visibleWhen` — fails CLOSED, and counts as DECLARED by `!= null`
         * rather than by truthiness, so `visibleWhen: false` hides "+ New"
         * instead of reading as "ungated" (the objectui#3492 invariant).
         * `?? true` expresses the ungated default as a boolean, which the
         * evaluator short-circuits without touching the engine — so a child
         * object with no `userActions.create` predicates takes no evaluation at
         * all and this gate is a literal `true`.
         */
        const createVisible = evalCreatePredicate(
          createPredicates?.visibleWhen ?? true,
          parentRecord,
          predicateScope,
          'builtin:create:visibleWhen',
          parentObjectFields,
        );
        /**
         * `disabledWhen` — fails SOFT (an unevaluable predicate must not grey a
         * button forever), and the `!= null` gate lives OUTSIDE the evaluation,
         * so `disabledWhen: ''` reads as "no condition" rather than as
         * "disable". Verbatim the posture of the record header (PR #4515) and
         * of `DataTableBuiltinRowActionItem`.
         */
        const createDisabled =
          createPredicates?.disabledWhen != null &&
          evalCreatePredicate(
            createPredicates.disabledWhen,
            parentRecord,
            predicateScope,
            'builtin:create:disabledWhen',
            parentObjectFields,
          );
        const aff = {
          create: objectCanCreate && createVisible,
          edit: resolveAffordance('relatedRowEdit', source).allowed,
          delete: resolveAffordance('relatedRowDelete', source).allowed,
        };
        const handlers: RelatedRecordHandlers = {
          // Viewing a child record is always allowed when the list is visible.
          // Same route the lookup links address — `recordPath` above.
          onView: (id) => openRecord(objectName, id),
        };

        /**
         * "View all" (objectui#12741): the child object's list page, scoped to
         * this parent on the list's own relationship. The destination is the
         * ADR-0055 bare data surface (`recordListPath`, the route
         * `useOpenRecordList` drills to). It is not anchored to a saved view,
         * so the page shows every related record rather than the related
         * records some default view also lets through.
         *
         * Offered only where that route can say "this parent's children". Its
         * `filter[FIELD]=VALUE` arm is EQUALITY, so the handler is withheld:
         *   - without a relationship or a parent value: an unscoped list is
         *     every record of the object, not this parent's;
         *   - on a `multiple: true` relationship: membership has no URL
         *     spelling, and equality against an array of ids matches nothing
         *     (the reason `RelatedList`'s raw-URL fetch refuses it, objectui#7299);
         *   - on a relationship field the viewer cannot read: `ObjectDataPage`
         *     drops that condition and would open the whole table.
         * A withheld handler draws no link: no link is better than a wrong list.
         */
        if (
          relationshipField &&
          parentId != null &&
          parentId !== '' &&
          !isMultiValueRelationship(childDef.fields, relationshipField) &&
          perms.checkField(objectName, relationshipField, 'read')
        ) {
          const viewAllPath = recordListPath(appName, objectName, { [relationshipField]: parentId });
          handlers.onViewAll = () => navigate(viewAllPath);
        }

        if (aff.create) {
          // [#4646] Greyed, not gone: `onCreate` is still supplied so the list
          // keeps offering "+ New" as a visible-but-inert affordance. The
          // hidden case is `aff.create` being false above.
          if (createDisabled) handlers.createDisabled = true;
          handlers.onCreate = () => {
            const canLink =
              relationshipField && parentId != null && parentId !== '';
            openChildForm({
              objectName,
              link: canLink
                ? { field: relationshipField as string, parentId: parentId as string | number }
                : undefined,
            });
          };
        }
        if (aff.edit) {
          handlers.onEdit = (id) =>
            openChildForm({ objectName, recordId: String(id) });
        }
        if (aff.delete) {
          handlers.onDelete = async (id) => {
            await dataSource?.delete?.(objectName, String(id));
          };
        }

        // [objectui#11270] `record_related` joins the row menu only when this
        // bridge is mounted under a parent record — the record page mounts it
        // with one; a mount without (the "standalone list" these props allow)
        // places `list_item` alone.
        //
        // [objectui#12870] With `parentFromList` (a custom page) the parent is
        // each list's own: a list that bound its parent through
        // `parentDataSource` names that record's key as `parentId`, and sits
        // inside it exactly as a record page's list sits inside the page record.
        const inParentRecord = parentFromList ? parentId != null && parentId !== '' : hasParentRecord;
        const rowActions = deriveActions(
          childDef,
          localizeActionTexts,
          inParentRecord ? ROW_LOCATIONS_IN_RECORD : ROW_LOCATIONS,
        );
        if (rowActions.length > 0) {
          handlers.rowActions = rowActions;
          handlers.onRowAction = (action, record) =>
            runRowAction(objectName, record, action);
        }

        // List-level actions (e.g. sys_invitation's `invite_user`) render as
        // header buttons — the related-list equivalent of the object list's
        // toolbar. Executed through the same dispatch as row actions, just
        // without a row record.
        const toolbarActions = deriveActions(childDef, localizeActionTexts, TOOLBAR_LOCATIONS);
        if (toolbarActions.length > 0) {
          handlers.toolbarActions = toolbarActions;
          handlers.onToolbarAction = (action) =>
            runRowAction(objectName, undefined, action);
        }

        return handlers;
      },
      recordHref,
      openRecord,
    }),
    // `parentRecord` / `parentObjectFields` / `predicateScope` join the deps for
    // the #4646 create predicates: a parent record that changes (a save, a
    // status transition) must re-resolve "+ New" for every related list under
    // it, or the toolbar keeps answering for the record's previous state.
    [objects, base, appName, navigate, dataSource, localizeActionTexts, runRowAction, openChildForm, recordHref, openRecord, perms, parentRecord, parentObjectFields, predicateScope, hasParentRecord, parentFromList],
  );

  return (
    <RelatedRecordActionsProvider value={serve ? serve(value) : value}>{children}</RelatedRecordActionsProvider>
  );
}
