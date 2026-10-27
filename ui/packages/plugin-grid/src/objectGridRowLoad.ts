/**
 * The row load of `ObjectGrid` (`./ObjectGrid.tsx`): the data-invalidation
 * nonce, the one async load effect (object definition, then rows, totals and
 * the server-grouped row query), the host `findParams` reset of "select all
 * matching" and the page-1 reset on a query change, moved out of the component
 * verbatim with `toOrderByClause`, the load effect's own `$orderby` join
 * (objectstack#25994, slice 5). Every input is passed in; the component reads
 * the returned nonce.
 */

import React, { useEffect } from 'react';
import type { ObjectGridSchema, DataSource, DependsOnInput, ViewData } from '@object-ui/types';
import { useDataInvalidation } from '@object-ui/react';
import { resolveDependsOnFields, declaredNameField, buildExpandFields, columnIdentity, collectPredicateFieldRefs, collectGroupingFieldRefs, listViewPredicates, isProjectableField, convertSortToQueryParams, normalizeSortEntries, type QuerySortEntry } from '@object-ui/core';
import type { usePermissions } from '@object-ui/permissions';
import { findParamsSignature } from './objectGridQuery';
import { normalizeColumns } from './objectGridColumns';
import { OCC_TOKEN_FIELD } from './objectGridRowVersion';
import type { ObjectGridExternalPaginationProps } from './objectGridProps';
import type { useObjectGridQueryInputs } from './objectGridQueryInputs';
import type { useObjectGridGroupingDecisions } from './objectGridGroupingDecisions';

type QueryInputs = ReturnType<typeof useObjectGridQueryInputs>;
type GroupingDecisions = ReturnType<typeof useObjectGridGroupingDecisions>;

/**
 * A declared `sort` → the `"field order"` join string THIS block sends as
 * `$orderby` (objectui#8973).
 *
 * ⚠️ Read the split before editing either half. WHICH entries survive and what
 * a missing `order` means is `normalizeSortEntries`' decision — the governed
 * one in `@object-ui/core`, shared with `convertSortToQueryParams` and every
 * sibling block. Only the JOIN is this block's, because only this block sends
 * a join string: the sink's `{field: direction}` map is route B on
 * objectui#8767, declined by the maintainer 2026-09-10 pending a card that
 * measures the server contract and both readers. So the operation with two
 * copies (the normalization) has one implementation, and the shape the
 * declination protects does not move.
 *
 * What this closes: the arms below used to interpolate every key
 * unconditionally, so an entry missing `field` or `order` reached the wire as
 * the literal text `undefined`. `$orderby: 'name undefined'` is not a
 * degraded ordering — `normalizeSortNodes` (`@objectstack/metadata-protocol`,
 * the one normalizer every server ingress funnels through) reads `undefined`
 * as a direction that is "neither 'asc' nor 'desc'" and answers
 * `400 INVALID_QUERY`.
 *
 * @returns `undefined` when nothing orderable survives, so the caller omits
 * `$orderby` entirely instead of sending `""` — the same correction
 * `toFilterNode` already made for `$filter: {}` on the filter leg above.
 */
function toOrderByClause(sort: QuerySortEntry[] | undefined | null): string | undefined {
  const ordered = normalizeSortEntries(sort);
  if (!ordered) return undefined;
  return ordered.map((s) => `${s.field} ${s.order}`).join(', ');
}

export function useObjectGridRowLoad({
  schema, dataSource, objectName, dataConfig, hasInlineData, perms, refreshKey, hostFindParams,
  lastFindParamsRef, setData, setLoading, setError, setObjectSchema, setTotalMatching,
  setSelectAllMatching, schemaFields, schemaColumns, carriesConcurrencyToken, rowColorField,
  groupingProjectionKey, predicateProjectionKey, schemaFilter, schemaFilterRefusal, schemaSort,
  schemaPagination, schemaPageSize, serverPage, setServerPage, headerSort, querySearchTerm,
  searchFieldsKey, serverGroupedFetch, groupingNeedsHeaderQuery, fetchWindow, setGroupRowQuery,
}: {
  schema: ObjectGridSchema;
  dataSource: DataSource | undefined;
  objectName: string | undefined;
  dataConfig: ViewData | { provider: string; items: unknown[] } | null;
  hasInlineData: boolean;
  perms: ReturnType<typeof usePermissions>;
  refreshKey: number;
  hostFindParams: ObjectGridExternalPaginationProps['findParams'];
  lastFindParamsRef: React.RefObject<Record<string, unknown> | null>;
  setData: React.Dispatch<React.SetStateAction<unknown[]>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<Error | null>>;
  setObjectSchema: React.Dispatch<React.SetStateAction<unknown>>;
  setTotalMatching: React.Dispatch<React.SetStateAction<number | undefined>>;
  setSelectAllMatching: React.Dispatch<React.SetStateAction<boolean>>;
  schemaFields: QueryInputs['schemaFields'];
  schemaColumns: QueryInputs['schemaColumns'];
  carriesConcurrencyToken: QueryInputs['carriesConcurrencyToken'];
  rowColorField: QueryInputs['rowColorField'];
  groupingProjectionKey: QueryInputs['groupingProjectionKey'];
  predicateProjectionKey: QueryInputs['predicateProjectionKey'];
  schemaFilter: QueryInputs['schemaFilter'];
  schemaFilterRefusal: QueryInputs['schemaFilterRefusal'];
  schemaSort: QueryInputs['schemaSort'];
  schemaPagination: QueryInputs['schemaPagination'];
  schemaPageSize: QueryInputs['schemaPageSize'];
  serverPage: QueryInputs['serverPage'];
  setServerPage: QueryInputs['setServerPage'];
  headerSort: QueryInputs['headerSort'];
  querySearchTerm: QueryInputs['querySearchTerm'];
  searchFieldsKey: QueryInputs['searchFieldsKey'];
  serverGroupedFetch: GroupingDecisions['serverGroupedFetch'];
  groupingNeedsHeaderQuery: GroupingDecisions['groupingNeedsHeaderQuery'];
  fetchWindow: GroupingDecisions['fetchWindow'];
  setGroupRowQuery: GroupingDecisions['setGroupRowQuery'];
}) {
  // objectui#10035 — the refresh input this grid had none of, so a host could
  // show it a write only by remounting it (AGENTS.md #8's corollary: refresh
  // data, don't rebuild UI). The nonce moves when the data-invalidation bus
  // reports a change to the object this grid FETCHES, and the load effect below
  // names it, so the rows are re-read in place — the table stays mounted
  // (`RefreshIndicator`, not the skeleton), and with it selection, scroll,
  // column state and any open inline edit. Subscribed only when the grid
  // fetches for itself: rows a host handed down (`data`, `bind`, an inline
  // `value` set) are the host's to refresh, and a nonce there would only
  // re-render for nothing.
  const invalidationNonce = useDataInvalidation(hasInlineData ? undefined : objectName);

  // --- Unified async data loading effect ---
  // Combines schema fetch + data fetch into a single async flow with AbortController.
  // This avoids the fragile "chained effects" pattern where Effect 1 sets objectSchema,
  // triggering Effect 2 to call fetchData — a pattern prone to infinite loops when
  // fetchData's reference is unstable.
  useEffect(() => {
    if (hasInlineData) return;
    // A refused `schema.filter` never reaches the wire (objectui#9050). The
    // malformed-filter branch in the render shows it instead; this guard is
    // what keeps "no filter node" from being read as "no filter" by the query
    // built below.
    if (schemaFilterRefusal) return;

    let cancelled = false;

    const loadSchemaAndData = async () => {
      setLoading(true);
      setError(null);
      try {
        // --- Step 1: Resolve object schema ---
        let resolvedSchema: any = null;
        const cols = normalizeColumns(schemaColumns) || schemaFields;

        if (objectName && dataSource) {
          // Always fetch full schema for field type metadata (enables rich type-aware rendering)
          if (typeof dataSource.getObjectSchema === 'function') {
            const schemaData = await dataSource.getObjectSchema(objectName);
            if (cancelled) return;
            resolvedSchema = schemaData;
          } else {
            resolvedSchema = { name: objectName, fields: {} };
          }
        } else if (cols && objectName) {
          // Fallback: minimal schema stub when no dataSource available
          resolvedSchema = { name: objectName, fields: {} };
        } else if (!objectName) {
          throw new Error('Object name required for data fetching');
        } else {
          throw new Error('DataSource required');
        }

        if (!cancelled) {
          setObjectSchema(resolvedSchema);
        }

        // --- Step 2: Fetch data ---
        // [objectui#10881] A grouping this data source cannot count is refused
        // before any row is asked for; the render names the missing member.
        if (groupingNeedsHeaderQuery) return;
        if (dataSource && objectName) {
          // [objectui#7179] The fields the view GROUPS BY. `grouping` is a
          // sibling of `columns` in the spec, not a subset of it, so a grid may
          // legitimately group by a field it never shows — and until this
          // harvest existed, `$select` (built from `columns` alone) never asked
          // for it, so every row carried `undefined` and `useGroupedData`
          // labelled ONE group `(empty)` holding every record.
          //
          // Raw here, GATED at each of its two use sites below, because the two
          // sites need different gates: the projection has to intersect with
          // the declared fields (an unknown `$select` key ZEROES the list on
          // backends that reject rather than ignore it), while `$expand` is
          // gated structurally by `buildExpandFields` itself.
          const groupingFieldRefs = collectGroupingFieldRefs(schema.grouping);
          const getSelectFields = () => {
            // Always include 'id' so row click / navigation handlers can resolve
            // the record key — without it `record.id` is undefined and the
            // primary-field link silently no-ops.
            // Both halves used to resolve identity differently — the probe was
            // name-first while the projection below read `c.field` alone — so a
            // legacy `{name}` column was projected as `undefined` while the
            // probe happily saw its name (#3104). One reader now, both halves.
            const ensureId = (list: any[]): any[] => {
              const names = list.map((f: any) => columnIdentity(f));
              return names.includes('id') ? list : ['id', ...list];
            };
            // [objectui#6898] FIELD-LEVEL SECURITY ON THE PROJECTION — the FETCH
            // half of the gap objectui#6799 closed on the RENDER half.
            //
            // objectui#6799 made `generateColumns()` drop a column naming a
            // declared field the principal cannot read. That is what reaches the
            // SCREEN. This is what goes on the WIRE: without this gate the same
            // field name is still handed to the server in `$select`, so a
            // backend that does not enforce FLS on the projection would return
            // the value into `data` with no column on screen to reveal it.
            //
            // ⭐ MEASURED, not assumed (the escalation gate this card was graded
            // on). ObjectStack's own server DOES enforce it — but on the RECORD,
            // not on the projection. `plugin-security`'s read middleware runs
            // `FieldMasker.maskResults`, whose `maskRecord` DELETES an unreadable
            // key from every returned row, and `predicate-guard.ts` says in terms
            // that the projection is deliberately NOT guarded because "selecting
            // a hidden field is harmless because FieldMasker strips it from the
            // result". Pinned end-to-end over real HTTP by objectstack's
            // `showcase-fls-read-mask-strip.dogfood.test.ts`: an explicit
            // `?select=name,<denied>` answers 200 with the denied key ABSENT.
            // So against ObjectStack this gate is defence-in-depth (p2), exactly
            // as triage graded it — it is NOT load-bearing for that backend, and
            // this comment is what stops a future reader from concluding it is.
            // It becomes load-bearing for any other backend, which is the same
            // argument the objectui#6723 / objectui#6799 rulings accepted: the
            // invariant must not rest on every future backend having enforced it.
            //
            // ⭐ THE DECLARED-KEY LIMIT IS THE SAME ONE, AND THE CARD IS RIGHT
            // THAT THE REASONING DOES NOT TRANSFER AUTOMATICALLY — it has to be
            // re-derived here, and it lands in the same place. On the render path
            // an undeclared key is a legitimate derived / host-joined column. In
            // a `$select` an undeclared key is what the host asked the SERVER
            // for, so the question is genuinely different. It resolves the same
            // way for a reason that is about `checkField`, not about drawing:
            // `checkField` answers FALSE for a field the policy has never heard
            // of, so judging an undeclared key is not a stricter reading of this
            // rule — it is a different, wrong one, and it would strip a host's
            // derived or joined column out of its own query. Undeclared ⇒ not
            // this gate's business, on both halves.
            //
            // ⛔ NAVIGATION IS PRESERVED STRUCTURALLY, NOT BY A SPECIAL CASE:
            // every call below composes `ensureId(...)` AFTER this gate, so `id`
            // is re-added even in the pathological case where a policy marks it
            // unreadable. A gate that filtered `id` out last would break row
            // click / navigation for everyone — the naive-filter failure the
            // card names by name. Keeping the restoration in the composition
            // rather than in a branch here means it cannot drift out of one arm.
            //
            // Keyed on `objectName` (the object actually being FETCHED —
            // `dataConfig.object` when a data block names one) rather than the
            // render half's `schema.objectName`: the projection is judged against
            // whatever object the server is about to read.
            const passesProjectionGate = (entry: unknown): boolean => {
              // Not loaded ⇒ nothing to ask yet; never filter on an unanswered
              // policy. Same deferral as the render half — and the fetch effect
              // re-runs on `perms.isLoaded` so the projection is rebuilt the
              // moment the answer arrives (without that dep this gate would be
              // dead on the first, and usually only, fetch).
              if (!perms?.isLoaded || !objectName) return true;
              const fieldName = columnIdentity(entry);
              // No readable identity ⇒ nothing to ask the policy about.
              if (!fieldName) return true;
              // Undeclared ⇒ host-joined / derived / platform column ⇒ see above.
              // `hasOwnProperty` rather than a truthiness read so an inherited
              // name (`constructor`, `toString`) cannot be mistaken for a
              // declared field and dropped out of the query.
              if (!Object.prototype.hasOwnProperty.call(resolvedSchema?.fields ?? {}, fieldName)) return true;
              return perms.checkField(objectName, fieldName, 'read');
            };
            // Fields the view's PREDICATES read but no column shows
            // (objectui#3501). Without them the projection asks the
            // server for everything except the field a row action is gated on,
            // and CEL faults on the absent key (`No such key`) rather than
            // reading it as null — which fail-closed hides the button for
            // everyone, with nothing pointing at the projection. Kept to fields
            // the object actually declares: an unknown key in `$select` is not
            // ignored by every backend, and a typo'd predicate must not be able
            // to zero the list.
            const declared = resolvedSchema?.fields;
            const predicateFields = declared
              ? collectPredicateFieldRefs(listViewPredicates({
                  conditionalFormatting: schema.conditionalFormatting as unknown[] | undefined,
                  // NON-AUTHOR SURFACE, same ruling as the seed above
                  // (objectui#5091, maintainer 2026-08-19): this cast read is
                  // deliberate, not a missed manifest entry. It is the SECOND
                  // of the key's two read sites and the one with teeth — a def
                  // gated on `record.<field>` puts that field in `$select`, so
                  // deleting this read would leave the predicate's operand out
                  // of the payload and CEL would fault on the absent key
                  // (objectui#3501, the whole reason this harvest exists).
                  // Pinned by `__tests__/gridNonAuthorKeys.test.tsx`.
                  rowActionDefs: (schema as any).rowActionDefs,
                  bulkActionDefs: (schema as any).bulkActionDefs,
                  objectActions: (resolvedSchema as any)?.actions,
                  // KEY COLLISION — `userActions` names TWO different blocks,
                  // and only the OBJECT's is interpretable here. This read is
                  // therefore `resolvedSchema`-only; it must never regain a
                  // `(schema as any).userActions ??` left operand. Maintainer
                  // ruling of 2026-08-20 on objectui#5240 (Q1=A), on these
                  // measurements against `@objectstack/spec@17.0.0`:
                  //
                  //   - VIEW-level `userActions` is TOOLBAR POLICY —
                  //     `UserActionsConfigSchema` (`sort`, `search`, `filter`,
                  //     `refresh`, `rowHeight`, `addRecordForm`, `editInline`,
                  //     `buttons`), which REJECTS `edit` BY NAME
                  //     (`unrecognized_keys`). `ListViewSchema` accepts it, so
                  //     it is spec-legal and really authored: `react/src/
                  //     spec-bridge/bridges/list-view.ts` copies it onto the
                  //     `object-grid` node this component receives as `schema`,
                  //     and `app-shell/src/views/ObjectView.tsx` builds one
                  //     unconditionally. It is NOT an unwritten key.
                  //   - OBJECT-level `userActions` is the CRUD-PREDICATE block
                  //     (`edit` / `delete` / `create` carrying `visibleWhen` /
                  //     `disabledWhen`, objectui#2614) — what
                  //     `resolveRowCrudAffordances` consumes above, and the only
                  //     shape `listViewPredicates` can read: its loop skips
                  //     every non-object value, so a toolbar block yields ZERO
                  //     predicates.
                  //
                  // Read view-first, a legitimately authored toolbar block
                  // therefore SHADOWED the object's CRUD predicates and dropped
                  // their operands from `$select`; CEL then faults `No such
                  // key`, fails CLOSED, and the row Edit/Delete button vanishes
                  // for everyone with nothing pointing at the projection
                  // (objectui#3501 — the whole reason this harvest exists).
                  // Both halves of the collision, and this read itself, are
                  // pinned by `__tests__/gridNonAuthorKeys.test.tsx`.
                  userActions: (resolvedSchema as any)?.userActions,
                })).filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  // [objectui#6898] A predicate operand the principal cannot read
                  // is dropped from the projection too. This costs nothing that
                  // was working: against ObjectStack the server already DELETES
                  // that key from every row (measured above), so the operand was
                  // never arriving and the CEL predicate was already faulting
                  // `No such key` and failing CLOSED. Dropping it from `$select`
                  // changes what we ASK for, not what we got. Against a
                  // non-enforcing backend it converts "the button works, and the
                  // denied value sits in memory" into "the button hides" — which
                  // is the correct direction for a predicate gated on a field
                  // this principal may not read.
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#7179] The GROUPING fields, through the SAME two gates
            // the predicate operands take, for the same two measured reasons.
            //
            // `isProjectableField` first: a `grouping.fields[]` entry is
            // SPECULATIVE in exactly the sense that gate exists for. Its
            // `field` is a bare `z.ZodString` and this card's whole premise is
            // that it is NOT among the columns, so nothing has validated it.
            // Some backends answer an unknown `$select` key with an EMPTY
            // RESULT SET rather than ignoring it (the cloud multi-tenant
            // runtime does exactly that), so an unguarded union would trade
            // this card's bug — one `(empty)` group holding all the rows — for
            // a strictly worse one: NO rows, equally silently. The current bug
            // at least shows the data.
            //
            // `passesProjectionGate` second (objectui#6898): a grouping field
            // names a field just as capable of being denied as a column is, and
            // this is the half that goes on the WIRE. Gating here rather than
            // after the union is what keeps that card closed.
            const groupingFields = declared
              ? groupingFieldRefs
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#12292] The row's concurrency token. An inline-editable
            // grid's default save sends it as `If-Match` (`rowVersionOf`), so
            // every row has to carry it. A projection built from the columns
            // left it off each row no column showed it on, and the save went
            // out with no token at all. The same two gates as the harvests
            // above: a platform column, and one this principal may read.
            const concurrencyFields = carriesConcurrencyToken && declared
              ? [OCC_TOKEN_FIELD]
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#12393] The ROW COLOUR's field. `useRowColor` paints a
            // row from `row[rowColor.field]`, and the spec sets no column
            // requirement on that field, so a grid tinted by a field no column
            // shows fetched rows without it and painted nothing, with no error.
            // `ListView`'s harvest gained this arm in objectui#12376, but a
            // grouped grid owns its fetch (`gridOwnsGroupedFetch`) and so does
            // a standalone `object-grid`: this projection is the one their rows
            // arrive through. The same two gates as the harvests above: a field
            // the object declares (or a platform column), and one this
            // principal may read.
            const rowColorFields = rowColorField && declared
              ? [rowColorField]
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#11815] A shown DECLARED deadline's `settledWhen`
            // operands. The predicate reads the row exactly as a row action's
            // gate does, so a grid showing only Title and Due fetched rows
            // without `status`, CEL faulted `No such key`, and a done row's
            // deadline still read overdue. The same two gates as the harvests
            // above.
            const shownColumns = (schemaFields ?? (Array.isArray(schemaColumns) ? schemaColumns : [])) as unknown[];
            const deadlineFields = declared
              ? collectPredicateFieldRefs(
                  shownColumns
                    .map((entry) => (declared as Record<string, { dueLike?: unknown; settledWhen?: unknown } | undefined>)[columnIdentity(entry) ?? ''])
                    .filter((def) => def?.dueLike === true && def.settledWhen != null)
                    .map((def) => def!.settledWhen),
                )
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#13036] A shown `referenceVia` pointer column's TYPE
            // half. `recordPointerFace` resolves the record through
            // `resolveRecordPointer` (objectui#12608), which reads the sibling
            // off the ROW and answers null when it is absent, so a grid whose
            // columns show the id half but not its sibling fetched rows
            // without it and drew the raw record id. `ListView`'s harvest
            // carries the same arm; this is the projection a grouped grid that
            // owns its fetch (`gridOwnsGroupedFetch`) and a standalone
            // `object-grid` send. Asked of the columns this projection keeps (a
            // pointer the principal may not read is not drawn), then the same
            // two gates as the harvests above: a sibling the principal may not
            // read is not asked, and that row keeps the stored text.
            const referenceViaFields = declared
              ? shownColumns
                  .filter(passesProjectionGate)
                  .map((entry) => (declared as Record<string, { referenceVia?: unknown } | undefined>)[columnIdentity(entry) ?? '']?.referenceVia)
                  .filter((f): f is string => typeof f === 'string' && f !== '')
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#13214] A shown column's DECLARED `dependsOn` siblings.
            // A faced column reads them off the ROW (`dependentValues={row}`):
            // the `recipient-picker` face names a stored id by the row's
            // `recipient_type`, and draws the stored text when it is absent.
            // So a grid showing `recipient_id` but not `recipient_type` fetched
            // rows without the kind and drew the raw user id. Driven by the
            // declaration alone: every sibling the field names, nothing mapped
            // by name here. Asked of the columns this projection keeps and the
            // grid draws: a column the principal may not read, or one authored
            // `hidden: true`, pulls nothing. Then the same two gates as the
            // harvests above: a sibling the object does not declare is never
            // sent, and one the principal may not read is never asked.
            const dependsOnFields = declared
              ? shownColumns
                  .filter((entry) => !(entry && typeof entry === 'object' && (entry as { hidden?: unknown }).hidden === true))
                  .filter(passesProjectionGate)
                  .flatMap((entry) => resolveDependsOnFields(
                    (declared as Record<string, { dependsOn?: DependsOnInput } | undefined>)[columnIdentity(entry) ?? '']?.dependsOn,
                  ))
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // [objectui#13107] The object's DECLARED name field. The bulk
            // confirm step names each affected record from the row this
            // projection fetched (`getRecordDisplayName`, ADR-0079), so a
            // `nameField` no column shows arrived absent and the step listed
            // another text field in its place (a contact's job title). Asked
            // by name whatever its type: the server serves a formula field
            // like any other. Fetched, never drawn: it joins the projection,
            // not the columns. The same two gates as the harvests above.
            const declaredName = declaredNameField(resolvedSchema);
            const nameFields = declared && typeof declaredName === 'string' && declaredName !== ''
              ? [declaredName]
                  .filter((f) => isProjectableField(f, declared as Record<string, unknown>))
                  .filter((f) => passesProjectionGate(f))
              : [];
            // A UNION, never an append: a grouping field that IS also a column
            // must not produce a duplicate `$select` entry.
            const extraFields = [...predicateFields, ...groupingFields, ...concurrencyFields, ...rowColorFields, ...deadlineFields, ...referenceViaFields, ...dependsOnFields, ...nameFields];
            const withHarvestedFields = (list: any[]): any[] => {
              if (extraFields.length === 0) return list;
              const names = new Set(list.map((f: any) => columnIdentity(f)));
              const seen = new Set<string>();
              const extra = extraFields.filter(
                (f) => !names.has(f) && !seen.has(f) && (seen.add(f), true),
              );
              return extra.length > 0 ? [...list, ...extra] : list;
            };
            // [objectui#11105] ONE projection for BOTH branches: gate, then read
            // each entry's field NAME through `columnIdentity`, then drop the
            // entries that have none. Only names go on the wire.
            //
            // The `schemaFields` branch used to return its entries UNMAPPED,
            // and `ListView` hands its effective column entries to the grid as
            // `fields` AND `columns` alike. So a view whose columns are objects
            // (`{ field, width }`) put the objects themselves into `$select`,
            // which the adapter's `join(',')` serialized as `[object Object]`.
            // Harmless while grouped grids got inline rows; since the grid
            // groups on the server (objectui#7189) every group's row page
            // carries this `$select`, and a server that refuses unknown select
            // keys answered INVALID_FIELD in every group. For a `fields` entry
            // that is already a name, `columnIdentity` hands it back unchanged.
            const projectFieldNames = (entries: unknown[]): string[] =>
              entries
                .filter(passesProjectionGate)
                .map((entry) => columnIdentity(entry))
                .filter((v): v is string => !!v);
            if (schemaFields) {
              return withHarvestedFields(ensureId(projectFieldNames(schemaFields as unknown[])));
            }
            if (schemaColumns && Array.isArray(schemaColumns)) {
              return withHarvestedFields(ensureId(projectFieldNames(schemaColumns)));
            }
            return undefined;
          };

          const params: any = {
            $select: getSelectFields(),
            $top: fetchWindow,
            $skip: (serverPage - 1) * fetchWindow,
          };

          // The block's declared `filter` input, already lowered to an AST at
          // the read point above. `undefined` means "no filter declared" —
          // including a declared-but-empty array, which `toFilterNode` folds
          // away so an empty `$filter` never goes out. The `Array.isArray` guard
          // this replaces predates the lowering and was itself a silent drop:
          // it read false for the MongoDB-style object shape, so such a filter
          // went missing and the grid answered with every record.
          if (schemaFilter !== undefined) {
            params.$filter = schemaFilter;
          }

          // Sort. A column-header click (objectui#3106) replaces the view's
          // declared sort for the whole collection — which is what makes the
          // arrow in the header true of the list rather than of this page.
          // The `SortNode[]` form goes out rather than the `"field order"`
          // string: it is the shape the server names in its own error messages,
          // and it survives a field name containing a space.
          if (headerSort && headerSort.length > 0) {
            params.$orderby = headerSort.map((s) => ({ field: s.field, order: s.order }));
          } else if (schemaSort) {
            if (typeof schemaSort === 'string') {
              // objectui#8767 — the legacy string `sort` clause is RETIRED
              // (objectui#8221, decision batch #77) and is REFUSED here rather
              // than lowered. This block owns a PRIVATE lowering, so #8758's
              // narrowing of the shared sink never reached it: a bare
              // `object-grid` went on honouring a spelling `object-view`
              // already refuses — one key meaning two things depending on which
              // block you are on, which is the per-block divergence the #8221
              // ruling declined by name.
              //
              // The refusal is #8758's OWN, not a second one: calling the
              // shared sink on this arm reports the retired spelling once per
              // spelling and answers `undefined`, so the query carries no
              // `$orderby`. Its return value is deliberately unused — the wire
              // shape stays this block's, and the array arm below is untouched
              // (with it the export path). The header-arrow reader
              // `parseSchemaSort` was left parsing the string HERE, and read
              // this same key more widely than this refusal until objectui#8961
              // narrowed it to the declared array; the two now agree. Routing
              // the whole key through the sink is still a different card: it
              // would send the sink's `{field: direction}` map where every grid
              // today sends a `"field order"` string.
              //
              // Read through `unknown`, exactly as the sink does: types are
              // erased, so the array-only `ObjectGridSchema.sort` declaration
              // cannot stop a string arriving from authored JSON, a stored
              // `sys_metadata` row or an `as any` bag.
              convertSortToQueryParams(schemaSort as unknown as QuerySortEntry[]);
            } else if (Array.isArray(schemaSort)) {
              // objectui#8973 — normalize before joining. Every key used to be
              // interpolated unconditionally, so `[{ field: 'name' }]` went out
              // as `'name undefined'` and `[]` as `''`. The join, and only the
              // join, stays this block's (see {@link toOrderByClause}).
              const orderBy = toOrderByClause(schemaSort as unknown as QuerySortEntry[]);
              if (orderBy !== undefined) {
                params.$orderby = orderBy;
              }
            }
          }
          // objectui#5861 — there is no third arm. The legacy single-entry
          // `defaultSort` was retired under ADR-0049: `@objectstack/spec`
          // refuses it by name on `object-grid` (since 17.3.0), so this chain
          // reads `sort` alone, and the header reader below reads the same key
          // the same way.

          // Search (objectui#3118). The term the toolbar box holds is a question
          // about the collection, so it goes to the server rather than to a
          // `.filter()` over the window we happen to be holding. Per ADR-0061 the
          // client sends only the term; the server resolves which fields it
          // matches from the object's metadata. `$searchFields` goes along only
          // when the view declared `searchableFields` — it can narrow that
          // server-resolved set, never widen it — which is exactly what the
          // ListView toolbar sends.
          const trimmedSearch = querySearchTerm.trim();
          if (trimmedSearch) {
            params.$search = trimmedSearch;
            if (schema.searchableFields && schema.searchableFields.length > 0) {
              params.$searchFields = schema.searchableFields;
            }
          }

          // Auto-inject $expand for lookup/master_detail fields
          //
          // [objectui#7179] The grouping fields ride along. `$select` alone
          // fetches a lookup as its BARE FOREIGN KEY, so a grid grouped by a
          // lookup would bucket by raw id ("8UY9zHWBfjYjYor4") instead of by
          // name — better than one `(empty)` bucket, still not right, and the
          // identical failure `expandFields` in `plugin-list` already records
          // for kanban. No `isProjectableField` gate is needed on THIS half:
          // `buildExpandFields` returns a subset of the object's declared
          // reference-bearing fields, so an unknown or non-relational grouping
          // field is dropped structurally and cannot reach the query.
          //
          // Only augment when a column list actually narrows the expansion —
          // with no columns, `buildExpandFields` already expands every relation
          // and the grouping fields are covered by that superset. Passing an
          // array here unconditionally would NARROW that case to the grouping
          // fields alone.
          //
          // [objectui#7215] FIELD-LEVEL SECURITY ON `$expand` — the half
          // objectui#6898 left open. That card gated `$select`, which asks for
          // a denied lookup's BARE FOREIGN KEY; `$expand` asks the server to
          // RESOLVE the same field and hand back the related record, so the
          // larger of the two disclosures was the ungated one.
          //
          // Graded the same way #6898 was, and by measurement rather than
          // assumption: against ObjectStack this is defence-in-depth, because
          // `plugin-security`'s `FieldMasker.maskRecord` does `delete
          // result[field]` on every unreadable key and objectql's expand path
          // writes the resolved record back under THAT SAME KEY
          // (`record[fieldName] = recordMap.get(...)`), so one statement
          // deletes the expanded object and the bare id alike. It is
          // load-bearing for a backend that does not strip.
          //
          // ⭐ THE GATE GOES ON THE OUTPUT, NOT ON THE COLUMN LIST, and both
          // reasons are measured (`__tests__/expandFls-7215.test.tsx` pins
          // each):
          //
          //  - `buildExpandFields` reads an EMPTY column list as "no column
          //    restriction" and falls back to every declared relation, so
          //    filtering its INPUT would WIDEN a view whose only relational
          //    column is denied from that one field to all of them;
          //  - the no-columns case passes `undefined`, so it has no input to
          //    gate at all — and it is the case that expands the most.
          //
          // Gating the output also satisfies, structurally, the ordering the
          // `$select` gate above spells out by hand (intersect with the
          // DECLARED fields first, ask `checkField` only about survivors):
          // `buildExpandFields` returns a subset of the object's declared
          // reference-bearing fields, so every name judged here is declared by
          // construction and the "`checkField` answers false for an undeclared
          // key" trap is unreachable. That is why this gate is SHORTER than
          // `passesProjectionGate` rather than a copy of it — no undeclared-key
          // arm, and no identity read, because these are resolved root names
          // rather than column entries.
          //
          // Deferral is the same as every other gate on this path: an
          // unanswered policy filters nothing, and the effect re-runs on
          // `perms.isLoaded`, so the expansion is rebuilt the moment the answer
          // arrives.
          const expandReadable = (fieldName: string): boolean => {
            if (!perms?.isLoaded || !objectName) return true;
            return perms.checkField(objectName, fieldName, 'read');
          };
          const expandColumns = schemaColumns ?? schemaFields;
          const expand = buildExpandFields(
            resolvedSchema?.fields,
            expandColumns ? [...(expandColumns as any[]), ...groupingFieldRefs] : undefined,
          ).filter(expandReadable);
          if (expand.length > 0) {
            params.$expand = expand;
          }

          // [objectui#7189] Server-grouped: no flat window is fetched. The
          // query is resolved here all the same — every gate above applies to
          // each group's rows exactly as it would to the flat page — and each
          // group's row page supplies its own filter and window.
          if (serverGroupedFetch) {
            const { $top: _top, $skip: _skip, ...groupQuery } = params;
            setGroupRowQuery(groupQuery);
            lastFindParamsRef.current = { ...groupQuery };
            setSelectAllMatching(false);
            return;
          }

          const result = await dataSource.find(objectName, params);
          if (cancelled) return;
          setData(result.data || []);
          // Capture total matching count + the params we used, so the bulk
          // selection banner can offer "Select all N matching" and the
          // dispatcher can re-issue the query to expand selection.
          const totalFromResult = (result as { total?: number }).total;
          setTotalMatching(typeof totalFromResult === 'number' ? totalFromResult : undefined);
          lastFindParamsRef.current = { ...params };
          // Reset cross-page flag whenever the underlying query changes.
          setSelectAllMatching(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadSchemaAndData();

    return () => {
      cancelled = true;
    };
  // `perms.isLoaded` (objectui#6898): the projection is FLS-gated above, and
  // `/me/permissions` resolves asynchronously — on the first render it is still
  // `false`, so the gate defers and the first request goes out ungated. Without
  // this dep nothing would ever rebuild it and the gate would be dead on the
  // only fetch most grids make. The boolean, not `perms` itself: it flips
  // false -> true exactly once, so this costs at most one refetch, where the
  // context object's identity would re-fetch the grid on every render.
  // `PermissionProvider` reports `true` synchronously and the no-provider
  // default stays `false` forever, so neither of those pays anything.
  // `groupingProjectionKey` (objectui#7179): the grouping fields are part of
  // the projection now, and grouping is RUNTIME-MUTABLE (the toolbar popover
  // rewrites it), so without this dep switching the grouping field would leave
  // the query asking for the OLD one and the new grouping would read
  // `undefined` on every row — the very `(empty)` bucket this card fixes,
  // reachable a second way.
  // `invalidationNonce` (objectui#10035): a write to this object, reported on
  // the data-invalidation bus — see its declaration above.
  // `groupingNeedsHeaderQuery` (objectui#10881): it flips when the object's
  // types land and show the only grouping key masked, and the flat fetch it
  // withheld must then go out.
  // `predicateProjectionKey` and `searchFieldsKey` (objectui#10689): the
  // harvested predicate operands and the `$searchFields` this query sends, each
  // a string compared by value — see their declarations above.
  // `carriesConcurrencyToken` (objectui#12292): a boolean, so turning inline
  // edit on re-reads the rows WITH their token — see its declaration above.
  // `rowColorField` (objectui#12393): a string, so a rule naming a new field
  // re-reads the rows with it — see its declaration above.
  }, [objectName, schemaFields, schemaColumns, schemaFilter, schemaFilterRefusal, schemaSort, headerSort, querySearchTerm, schemaPagination, schemaPageSize, serverPage, fetchWindow, dataSource, hasInlineData, dataConfig, refreshKey, perms.isLoaded, groupingProjectionKey, predicateProjectionKey, searchFieldsKey, invalidationNonce, serverGroupedFetch, groupingNeedsHeaderQuery, carriesConcurrencyToken, rowColorField]);

  // The same reset, for the path the loader above never runs on (objectui#4501
  // clause 2). "All N matching are selected" is a claim about ONE query, so it
  // must not survive that query changing — the loader drops it in place (three
  // lines up, next to its `lastFindParamsRef` write), and under a host-driven
  // fetch the host's params changing is the identical signal. Without this a
  // user could escalate, change the filter in the host's toolbar, and keep an
  // escalation that now reads against a match set they never saw.
  //
  // Keyed on the CONTENT signature, not the prop's identity: a host re-render
  // that rebuilds an equal object is not a query change, and dropping the
  // escalation on one would make the affordance unusable.
  const hostFindParamsKey = React.useMemo(
    () => findParamsSignature(hostFindParams),
    [hostFindParams],
  );
  React.useEffect(() => {
    setSelectAllMatching(false);
  }, [hostFindParamsKey]);

  // Reset to page 1 whenever the query itself changes (object / filter / sort /
  // search), so we never request a page index that no longer exists for the new
  // result set (e.g. applying a filter while sitting on page 5 of the old
  // query). A new search term is the sharpest case of this: 3075 rows can
  // become 2, and "page 5" of that is nothing at all.
  React.useEffect(() => {
    setServerPage(1);
  }, [objectName, schemaFilter, schemaSort, headerSort, querySearchTerm]);

  return { invalidationNonce };
}
