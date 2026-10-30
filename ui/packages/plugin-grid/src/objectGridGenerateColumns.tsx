/**
 * `generateColumns` of `ObjectGrid` (`./ObjectGrid.tsx`): the callback that
 * turns the authored columns, or the object's fields, into the column drafts
 * the grid hands to `data-table`, moved out of the component verbatim
 * (objectstack#25994, slice 8). Every input is passed in; the component reads
 * the returned callback.
 */

import React, { useCallback } from 'react';
import type { ObjectGridSchema, DataSource, ListColumn, ViewData } from '@object-ui/types';
import { isSystemManagedField } from '@object-ui/types';
import { useNavigationOverlay, useAction, useSafeFieldLabel, usePredicateScope } from '@object-ui/react';
import { resolveGridCellRendering, gridCellRendererForFixedKey, linkCellRenderer, BADGE_PREFIX_RENDERER_KEY } from './cellRendererResolution';
import { isWithheldGridColumn } from './maskedColumn';
import { humanizeLabel, MaskedCellRenderer } from '@object-ui/fields';
import { Button, EmptyValue } from '@object-ui/components';
import { isDeadlineSettled, leadWithNameField, columnIdentity } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import { Type, Hash, Calendar, CheckSquare, User, Tag, Clock } from 'lucide-react';
import { applyRelationalMeta } from './relationalMetaKeys';
import { resolvesToDataColumn } from './columnSpellingDiagnostics';
import { formatActionLabel } from './components/RowActionMenu';
import { type ObjectGridColumnDraft, normalizeColumns, resolveColumnLabel } from './objectGridColumns';
import { LinkCell, recordPointerFace, rowRecordId } from './objectGridLinkCell';
import { useGridTranslation } from './objectGridTranslations';
import type { useObjectGridQueryInputs } from './objectGridQueryInputs';

type QueryInputs = ReturnType<typeof useObjectGridQueryInputs>;

/**
 * `ObjectGrid`'s column generator, memoised on the same dependency list as
 * before. `ObjectGrid` calls it where the callback used to stand, so the order
 * of the component's hooks does not change.
 */
export function useObjectGridGenerateColumns({
  schema, dataSource, data, dataConfig, hasInlineData, objectName, objectSchema, objectFields,
  objectTypesPending, schemaFields, schemaColumns, perms, navigation, executeAction, predicateScope,
  resolveFieldLabel, translateOptions, uiLanguage, recordLinkAdornment,
}: {
  schema: ObjectGridSchema;
  dataSource: DataSource | undefined;
  data: any[];
  dataConfig: ViewData | { provider: string; items: unknown[] } | null;
  hasInlineData: boolean;
  objectName: string | undefined;
  objectSchema: any;
  objectFields: Record<string, any> | undefined;
  objectTypesPending: boolean;
  schemaFields: QueryInputs['schemaFields'];
  schemaColumns: QueryInputs['schemaColumns'];
  perms: ReturnType<typeof usePermissions>;
  navigation: ReturnType<typeof useNavigationOverlay>;
  executeAction: ReturnType<typeof useAction>['execute'];
  predicateScope: ReturnType<typeof usePredicateScope>;
  resolveFieldLabel: ReturnType<typeof useSafeFieldLabel>['fieldLabel'];
  translateOptions: ReturnType<typeof useSafeFieldLabel>['translateOptions'];
  uiLanguage: ReturnType<typeof useGridTranslation>['language'];
  /** objectstack#26681 — the host's node beside a row's record link (`ObjectGrid`'s prop). */
  recordLinkAdornment?: (record: any) => React.ReactNode;
}) {
  const generateColumns = useCallback((): ObjectGridColumnDraft[] => {
    // objectui#11815 — the host's verdict on a declared deadline's
    // `settledWhen` for ONE row, handed to the cell as `deadlineSettled`. The
    // one helper in `@object-ui/core`, with the scope and relation collapse
    // this grid's conditional formatting uses; a field that is not a declared
    // deadline answers `false` before any predicate runs.
    //
    // objectstack#25884 — every column cell built below also carries
    // `inGridColumn`, so a `date` field with no declared `format` reads in
    // one absolute face down the column (`CellRendererProps.inGridColumn`).
    // The record panel and the mobile card's slots draw their cells without
    // it, outside this function.
    const settledFor = (field: unknown, row: Record<string, unknown> | undefined): boolean =>
      isDeadlineSettled(field as Parameters<typeof isDeadlineSettled>[0], row, { scope: predicateScope, fields: objectFields });
    // Map field type to column header icon (Airtable-style)
    const getTypeIcon = (fieldType: string | null): React.ReactNode => {
      if (!fieldType) return <Type className="h-3.5 w-3.5" />;
      const iconMap: Record<string, React.ReactNode> = {
        text: <Type className="h-3.5 w-3.5" />,
        number: <Hash className="h-3.5 w-3.5" />,
        currency: <Hash className="h-3.5 w-3.5" />,
        percent: <Hash className="h-3.5 w-3.5" />,
        date: <Calendar className="h-3.5 w-3.5" />,
        datetime: <Clock className="h-3.5 w-3.5" />,
        boolean: <CheckSquare className="h-3.5 w-3.5" />,
        user: <User className="h-3.5 w-3.5" />,
        select: <Tag className="h-3.5 w-3.5" />,
      };
      return iconMap[fieldType] || <Type className="h-3.5 w-3.5" />;
    };

    // Auto-infer column type from field name and data values (Airtable-style)
    const inferColumnType = (col: ListColumn): string | null => {
      if (col.type) return col.type; // Explicit type takes priority

      const fieldLower = col.field.toLowerCase();

      // Infer boolean fields
      const booleanFields = ['completed', 'is_completed', 'done', 'active', 'enabled', 'archived'];
      if (booleanFields.some(f => fieldLower === f || fieldLower === `is_${f}`)) {
        return 'boolean';
      }

      // Infer datetime fields (fields with time component: created_time, modified_time, *_at patterns)
      const datetimePatterns = ['created_time', 'modified_time', 'updated_time', 'created_at', 'updated_at', 'modified_at', 'last_login', 'logged_at'];
      if (datetimePatterns.some(p => fieldLower === p || fieldLower.endsWith(`_${p}`))) {
        return 'datetime';
      }

      // Infer date fields from name patterns
      const datePatterns = ['date', 'due', 'created', 'updated', 'deadline', 'start', 'end', 'expires'];
      if (datePatterns.some(p => fieldLower.includes(p))) {
        // Verify with data: check if sample values look like dates
        if (data.length > 0) {
          const sample = data.find(row => row[col.field] != null)?.[col.field];
          if (typeof sample === 'string' && !isNaN(Date.parse(sample))) {
            return 'date';
          }
        }
        return 'date';
      }

      // Infer percent fields from name patterns
      const percentFields = ['probability', 'percent', 'percentage', 'completion', 'progress', 'rate'];
      if (percentFields.some(f => fieldLower.includes(f))) {
        if (data.length > 0) {
          const sample = data.find(row => row[col.field] != null)?.[col.field];
          if (typeof sample === 'number') {
            return 'percent';
          }
        }
      }

      // Infer select/badge fields (status, priority, category, etc.)
      const selectFields = ['status', 'priority', 'category', 'stage', 'type', 'severity', 'level'];
      if (selectFields.some(f => fieldLower.includes(f))) {
        if (data.length > 0) {
          const uniqueValues = new Set(data.map(row => row[col.field]).filter(Boolean));
          if (uniqueValues.size > 0 && uniqueValues.size <= 10) {
            return 'select';
          }
        }
      }

      // Infer user/assignee fields
      const userFields = ['assignee', 'owner', 'author', 'reporter', 'creator', 'user'];
      if (userFields.some(f => fieldLower.includes(f))) {
        return 'user';
      }

      // Infer currency/amount fields
      const currencyFields = ['amount', 'price', 'total', 'revenue', 'cost', 'budget', 'salary'];
      if (currencyFields.some(f => fieldLower.includes(f))) {
        if (data.length > 0) {
          const sample = data.find(row => row[col.field] != null)?.[col.field];
          if (typeof sample === 'number') {
            return 'currency';
          }
        }
      }

      // Fallback: detect ISO date strings in data values (catch-all for unmatched field names)
      if (data.length > 0) {
        const sample = data.find(row => row[col.field] != null)?.[col.field];
        if (typeof sample === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(sample)) {
          return 'datetime';
        }
      }

      return null;
    };

    // Use normalized columns (support both new and legacy)
    const cols = normalizeColumns(schemaColumns);
    
    if (cols) {
      // FLS on the AUTHORED `columns` path (objectui#6799 — maintainer ruling
      // 2026-08-30, inheriting objectui#6723's 2026-08-29 reasoning verbatim).
      //
      // This was the LAST of `generateColumns()`'s three default paths that did
      // not re-apply field-level security. The object-schema path always did;
      // the inline-data path does as of objectui#6723. Leaving this one out was
      // the worst of the three to leave, because it is the MOST REACHABLE:
      // objectui#6723's path needs a host to hand rows down, while this one runs
      // whether the grid fetches its own rows or not. Three paths of one
      // function, two checking and one not, is a bypass around the field gate
      // rather than an inconsistency.
      //
      // ⭐ THE LIMIT IS LOAD-BEARING, NOT AN OPTIMISATION — and it bites harder
      // here than on the inline-data path. Only keys the OBJECT DECLARES are
      // judged; everything else passes through untouched. A `ListColumn` carries
      // `label` / `link` / `action` / `prefix` / `width`, so a column whose
      // `field` the object does not declare is not a mistake — it is a
      // legitimate authored derived or host-joined column (`computed_score`, a
      // flattened `account.name`), and deleting it would destroy authoring work.
      // `checkField` answers `false` for a field the policy has never heard of,
      // so asking it about a derived key is not a stricter reading of the same
      // rule — it is a different, wrong one. `hasOwnProperty` rather than a
      // truthiness read so an inherited name (`constructor`, `toString`) cannot
      // be mistaken for a declared field.
      //
      // ⛔ THE JUDGED KEY IS READ THROUGH `columnIdentity`, NEVER OFF A BARE
      // STRING (the ruling says so by name). `columnIdentity` folds the three
      // authored identity spellings — `'salary'`, `{ field: 'salary' }` and the
      // legacy `{ name: 'salary' }` — which is why ONE predicate serves both
      // arms below. A gate reading `col.field` directly would find no identity
      // on the legacy spelling and wave a denied declared field straight
      // through. `resolvesToDataColumn` keeps owning its own decisions and runs
      // first: this gate narrows what survives, it never resurrects a hidden or
      // unresolvable column.
      //
      // Redundant through `ListView`, which filters its own `effectiveFields`
      // through this same gate before forwarding them as `columns` — and that
      // redundancy IS the point: the invariant must not rest on every future
      // host having read the docs. Measured in-repo hosts that do NOT filter
      // first: `ObjectView`, `ObjectManager`, `FieldDesigner`. Pinned in
      // `authoredColumnsFls-6799.test.tsx`.
      const passesFieldGate = (entry: unknown): boolean => {
        if (!perms?.isLoaded || !schema.objectName) return true;
        const fieldName = columnIdentity(entry);
        // No readable identity ⇒ nothing to ask the policy about.
        if (!fieldName) return true;
        // Undeclared ⇒ host-joined / derived ⇒ not this gate's business.
        if (!Object.prototype.hasOwnProperty.call(objectFields ?? {}, fieldName)) return true;
        return perms.checkField(schema.objectName, fieldName, 'read');
      };
      // ObjectStack's DECLARED column spelling is the only one read
      // (objectui#5068). `ObjectGridSchema.columns` is `string[] | ListColumn[]`,
      // and `ListColumnSchema` in `@objectstack/spec/ui` is a STRICT object:
      // `field` is required, `accessorKey` / `header` are refused BY NAME with
      // `unrecognized_keys`. A branch here used to accept that refused spelling
      // anyway — it sniffed `columns[0]` for an `accessorKey` and synthesized a
      // `ListColumn` from it — so one key had two spellings, one the schema
      // admits and one only the runtime did. That second de-facto contract is
      // what AGENTS.md #0.1 forbids, and objectui#3951 already settled the
      // shape of the fix for this defect family: unify at the PRODUCER, no
      // consumer-side tolerance alias. The one in-repo producer that spoke it,
      // `bridgeListView` in `@object-ui/react`, was migrated in the same PR.
      //
      // The `columns[0]` sniff goes with it. Column identity is a per-column
      // property, and the filter below is the one place that judges it: a
      // mis-spelled column is now dropped alone, where the sniff let the FIRST
      // entry decide the fate of the whole array (a declared column standing
      // behind an undeclared one was lost with it; the reverse order threw).
      //
      // `accessorKey` keeps its job on the way OUT — it is the data-table
      // adapter's key, which `@object-ui/core` deliberately holds outside the
      // metadata identity fold (`TABLE_ADAPTER_COLUMN_KEY`) and which this
      // component still writes below. Metadata vocabulary in, adapter
      // vocabulary out, one translation.
      if (cols.length > 0 && typeof cols[0] === 'object' && cols[0] !== null) {
        // The drop decision lives in `resolvesToDataColumn`
        // (`columnSpellingDiagnostics.ts`) so the diagnostic that reports a
        // dropped column cannot drift from the filter that drops it — one
        // predicate, two readers (objectui#5349). Semantics unchanged:
        // `col?.field && typeof col.field === 'string' && !col.hidden`.
        return (cols as ListColumn[])
          .filter((col) => resolvesToDataColumn(col))
          .filter((col) => passesFieldGate(col))
          .map((col, colIndex, shown) => {
            // The column's own `label` is the spec's "Display label override"
            // (`ListColumnSchema`), so when the author wrote one it IS the
            // header, and the field-label lookup is not consulted
            // (objectui#12110 item 1). It used to be handed to that lookup as
            // its FALLBACK, so any bundle translating the field — which a
            // deployed app's bundle does for every field — replaced the
            // override with the field's label.
            //
            // With no override, fall back to the SCHEMA FIELD's label before
            // prettifying the machine name — otherwise a column declared as bare
            // { field } shows an English name-derived header (e.g. "Request
            // title") even when the field has a localized label (e.g. "申请标题")
            // on a non-English app.
            const authoredHeader = resolveColumnLabel(col.label, uiLanguage);
            const rawHeader = resolveColumnLabel(objectFields?.[col.field]?.label, uiLanguage)
              || col.field.charAt(0).toUpperCase() + col.field.slice(1).replace(/_/g, ' ');
            const header = authoredHeader
              || (schema.objectName ? resolveFieldLabel(schema.objectName, col.field, rawHeader) : rawHeader);

            // Build custom cell renderer based on column configuration
            let cellRenderer: ((value: any, row: any) => React.ReactNode) | undefined;

            // Type-based cell renderer: explicit col type > objectDef type > heuristic inference.
            // Format hints (e.g. `text` + `format: 'phone'`) promote to the
            // richer renderer (PhoneCellRenderer) via the grid's one shared
            // resolve, `./cellRendererResolution` (objectui#8920).
            const objectDefField = objectFields?.[col.field];
            // objectui#10657 — an untyped column while the object's field types
            // are unknown is WITHHELD: drawn as the mask, never as text, and
            // flagged masked (`isWithheldGridColumn`). No type is inferred for
            // it — a heuristic guess from the name or the values is exactly
            // how a credential field ended up drawn as text.
            const withheld = isWithheldGridColumn(col.type, objectTypesPending);
            // ⭐ ANNOTATED, and the annotation is load-bearing (objectui#6004).
            // `objectSchema` is `useState<any>`, so `objectDefField?.type` is
            // `any` — and an `any` SPREAD into an object literal collapses the
            // WHOLE literal to `any`, which silently un-checks every other key
            // in it. Measured: without this annotation the emit below infers
            // `any[]`, and `ObjectGridColumnDraft` cannot bite on any member. Naming
            // the producer vocabulary here stops `any` at this one boundary.
            const baseInferredType: string | null = withheld
              ? null
              : col.type || objectDefField?.type || inferColumnType({ field: col.field }) || null;
            // objectui#6458 — the column-level `format` read is RETIRED. The
            // object-field fallback below is now the only road, which is what
            // every measured author already used.
            const formatHint = objectDefField?.format;
            // Both answers, from the one shared resolve (objectui#8920):
            // `baseInferredType` is the DECLARED type the inline editor reads,
            // `inferredType` the renderer key it promotes to.
            // The `widget` hint promotes the same way (objectui#12613): an
            // `object-ref` / `recipient-picker` text column draws the label of
            // what it references, through the cell its widget names.
            const { rendererType: inferredType, Renderer } = resolveGridCellRendering({
              type: baseInferredType,
              format: formatHint,
              widget: objectDefField?.widget,
            });
            const CellRenderer = withheld ? MaskedCellRenderer : inferredType ? Renderer : null;

            // Build field metadata for cell renderers with objectDef enrichment
            const fieldMeta: Record<string, any> = { name: col.field, type: inferredType || 'text' };
            // Merge objectDef field properties (options with colors, currency, precision, etc.)
            if (objectDefField) {
              // The label the header above prints — `header`, resolved once
              // (objectui#11689). A face that names its own column (the
              // boolean face's checkbox, by its accessible name) reads
              // `field.label`, so
              // handing it the authored label made a translated header sit
              // over a cell naming the column in the authored language. Handed
              // where the authored label used to be, so an unlabelled field
              // keeps the face's own fallback.
              if (objectDefField.label) fieldMeta.label = header;
              if (objectDefField.currency) fieldMeta.currency = objectDefField.currency;
              // objectui#10354 — `currencyConfig` is the spec's one fixed-currency
              // spelling (a field key `currency` is refused by name), so a
              // JPY-fixed field reaches the cell only through it. Copied
              // VERBATIM: the cell's `resolveFieldCurrency` owns what it means,
              // `currencyMode` included, so this bag holds no second opinion.
              // Dropped, the cell fell through to the tenant currency while the
              // metric tile and every whole-def cell read the field's own.
              if (objectDefField.currencyConfig) fieldMeta.currencyConfig = objectDefField.currencyConfig;
              // A formula's declared `returnType` picks its face in the
              // formula cell (`FormulaCellRenderer`): `currency` draws through
              // the currency cell with the `currencyConfig` above. Dropped
              // here, a money formula fell to its value's JS type and read as a
              // bare number (`90,000.00`) beside its currency sources.
              if (objectDefField.returnType !== undefined) fieldMeta.returnType = objectDefField.returnType;
              if (objectDefField.precision !== undefined) fieldMeta.precision = objectDefField.precision;
              if ((objectDefField as any).scale !== undefined) (fieldMeta as any).scale = (objectDefField as any).scale;
              // objectui#11026 — the author's digit-grouping hint rides beside
              // `scale`, its heuristic fallback: dropped here, the cell never
              // sees it and a `useGrouping: false` year still reads `2,026`.
              if (objectDefField.useGrouping !== undefined) fieldMeta.useGrouping = objectDefField.useGrouping;
              // objectui#11475 — a percent field's declared `max` is its STORAGE
              // statement (`percentScaleOf`: a fraction unless `max` is above
              // 1), which the percent cell now reads instead of guessing from
              // the value. Dropped here, a whole-stored `50` (`max: 100`) would
              // read `5000%` in this cell.
              if (objectDefField.max !== undefined) fieldMeta.max = objectDefField.max;
              if (objectDefField.format) fieldMeta.format = objectDefField.format;
              // objectui#11815 — the deadline declaration rides on every
              // builder: `dueLike` is what the date cells paint from, and
              // `settledWhen` is what `isDeadlineSettled` judges per row.
              // Dropped here, a declared deadline never read overdue.
              if (objectDefField.dueLike !== undefined) fieldMeta.dueLike = objectDefField.dueLike;
              if (objectDefField.settledWhen !== undefined) fieldMeta.settledWhen = objectDefField.settledWhen;
              if (objectDefField.options) fieldMeta.options = translateOptions(schema.objectName, col.field, objectDefField.options);
            }
            // Preserve relational metadata (reference, displayField, …) so
            // lookup CELLS resolve ids to names. ⛔ Not the inline picker — that
            // reads the schema def directly, see `renderCellEditor` (objectui#7154).
            applyRelationalMeta(fieldMeta, objectDefField as any);
            // Auto-generate options from data for inferred select without existing options
            if (inferredType === 'select' && !fieldMeta.options) {
              const uniqueValues = Array.from(new Set(data.map(row => row[col.field]).filter(Boolean)));
              fieldMeta.options = uniqueValues.map(v => ({ value: v, label: humanizeLabel(String(v)) }));
            }
            // Honor metadata-defined appearance only — the objectDef FIELD's
            // `appearance`, which since objectui#6458 is the only road (the
            // column-level read is retired). When unset, the cell renders its
            // default badge style — same as detail / form views.
            const explicitAppearance = objectDefField?.appearance;
            if (explicitAppearance != null) {
              fieldMeta.appearance = explicitAppearance;
            }

            // Auto-link primary field (first column) to record detail (Airtable-style)
            const isPrimaryField = colIndex === 0 && !col.link && !col.action;
            const isLinked = col.link || isPrimaryField;
            // objectstack#26681 — the host's `recordLinkAdornment` goes beside
            // ONE link per row: the first column the author linked
            // (`link: true`), else the auto-linked primary field. A view that
            // links its name column keeps the node off the first column's
            // auto-link (an avatar, a status).
            const firstAuthoredLink = shown.findIndex((c) => !!c.link);
            const adornsLink = firstAuthoredLink === -1 ? isPrimaryField : colIndex === firstAuthoredLink;
            // The face the value takes INSIDE the link: never an anchor of its
            // own (objectui#11817, `linkCellRenderer`).
            const LinkContentRenderer = linkCellRenderer(inferredType, CellRenderer);
            // A `referenceVia` pointer column draws the record it names
            // (objectui#12608); `null` per row falls through to the faces below.
            const pointerFace = withheld ? null : recordPointerFace(col.field, baseInferredType, objectDefField, dataSource);

            if ((col.link && col.action) || (isPrimaryField && col.action)) {
              // Both link and action: link takes priority for navigation, action executes on secondary interaction
              cellRenderer = (value: any, row: any) => {
                const displayContent = pointerFace?.(row) ?? (LinkContentRenderer
                  ? <LinkContentRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />
                  : (value != null && value !== '' ? String(value) : <EmptyValue />));
                return (
                  <LinkCell
                    testId={isPrimaryField ? 'primary-field-link' : 'link-cell'}
                    onActivate={() => navigation.handleClick(row)}
                    objectName={schema.objectName}
                    recordId={rowRecordId(row)}
                    wrap={col.wrap}
                    trailing={adornsLink ? recordLinkAdornment?.(row) : undefined}
                  >
                    {displayContent}
                  </LinkCell>
                );
              };
            } else if (isLinked) {
              // Link column: clicking navigates to the record detail
              cellRenderer = (value: any, row: any) => {
                const displayContent = pointerFace?.(row) ?? (LinkContentRenderer
                  ? <LinkContentRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />
                  : (value != null && value !== '' ? String(value) : <EmptyValue />));
                return (
                  <LinkCell
                    testId={isPrimaryField ? 'primary-field-link' : 'link-cell'}
                    onActivate={() => navigation.handleClick(row)}
                    objectName={schema.objectName}
                    recordId={rowRecordId(row)}
                    wrap={col.wrap}
                    trailing={adornsLink ? recordLinkAdornment?.(row) : undefined}
                  >
                    {displayContent}
                  </LinkCell>
                );
              };
            } else if (col.action) {
              // Action column: render as action button
              cellRenderer = (value: any, row: any) => {
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    data-testid="action-cell"
                    onClick={(e) => {
                      e.stopPropagation();
                      executeAction({
                        type: col.action!,
                        params: { record: row, field: col.field, value },
                      });
                    }}
                  >
                    {formatActionLabel(col.action!)}
                  </Button>
                );
              };
            } else if (CellRenderer) {
              // Type-only cell renderer (no link/action). The row rides as
              // `dependentValues` for a cell whose value only means something
              // beside a sibling column (objectui#12613).
              cellRenderer = (value: any, row: any) => (
                pointerFace?.(row) ?? <CellRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />
              );
            } else {
              // Default renderer with empty value handling
              cellRenderer = (value: any) => (
                value != null && value !== ''
                  ? <span>{String(value)}</span>
                  : <EmptyValue />
              );
            }

            // Wrap with prefix compound cell renderer (Airtable-style: [Badge] Text in same cell)
            // `prefix` needs NO cast: `ListColumn` DECLARES it (objectui#6458).
            // The cast was pure noise, and it cost twice — it made a declared,
            // schema-admitted key look exactly like the four genuinely undeclared
            // reads around it, and it threw away `ColumnPrefix`'s own typing, so
            // `prefixConfig.field` was `any` at every use below.
            //
            // ⭐ The four undeclared reads that used to sit in this branch —
            // `format`, `options`, `appearance`, `essential` — are RETIRED
            // (objectui#6458, maintainer ruling 2026-08-28, "B on all four").
            // `ListColumnSchema` is a strict object that refuses all four at
            // publish, so honouring them here was the `declared != enforced`
            // split AGENTS.md #0.1 exists to stop. The retirement route (rather
            // than declaring them on `@objectstack/spec`) follows the standing
            // zero-authors rule: a key with no measured authors is retired at
            // once, with no deprecation window. Re-measured on this ref before
            // the deletion — zero authored occurrences of any of the four on a
            // column across `examples/` and `apps/`.
            //
            // ⚠️ Retired for want of authors, NOT forbidden forever. If a real
            // request for semantic mobile-column control arrives, the declare
            // route reopens — objectstack#12715 is the precedent (removed while
            // unenforced, re-introduced once demand and enforcement met). What
            // is forbidden is the third road: a renderer-side tolerance for a
            // key the schema refuses. `columnReadBoundary-6458.test.ts` now
            // bounds this branch's undeclared cast reads to the EMPTY SET, so a
            // new one goes red on arrival instead of accreting quietly.
            const prefixConfig = col.prefix;
            if (prefixConfig?.field) {
              const baseCellRenderer = cellRenderer;
              // ⭐ The one site whose contract is NOT "declared type + format
              // hint": a FIXED registry key for the badge, owned by this
              // component rather than by the prefixed field (objectui#8920).
              // Named and routed through the same module so it reads as the
              // declared exception it is, not as a fifth silent convention.
              const PrefixRenderer = prefixConfig.type === 'badge' ? gridCellRendererForFixedKey(BADGE_PREFIX_RENDERER_KEY) : null;
              cellRenderer = (value: any, row: any) => {
                const prefixValue = row[prefixConfig.field];
                const prefixEl = prefixValue != null && prefixValue !== ''
                  ? PrefixRenderer
                    ? <PrefixRenderer value={prefixValue} field={{ name: prefixConfig.field, type: BADGE_PREFIX_RENDERER_KEY } as any} />
                    : <span className="text-muted-foreground text-xs mr-1.5">{String(prefixValue)}</span>
                  : null;
                return (
                  <span className="flex items-center gap-1.5">
                    {prefixEl}
                    {baseCellRenderer(value, row)}
                  </span>
                );
              };
            }

            // Auto-infer alignment from field type if not explicitly set
            const numericTypes = ['number', 'currency', 'percent'];
            const effectiveType = inferredType || col.type;
            const inferredAlign = col.align || (effectiveType && numericTypes.includes(effectiveType) ? 'right' as const : undefined);

            // Determine if column should be hidden on mobile
            const isEssential = colIndex === 0;

            return {
              header,
              accessorKey: col.field,
              // Forward the resolved (base) field type so the inline editor can
              // pick a type-aware control. Use baseInferredType (date/number/...)
              // rather than the renderer type so e.g. `date` stays `date`.
              ...(baseInferredType && { type: baseInferredType }),
              ...(schema.showColumnTypeIcons && { headerIcon: getTypeIcon(inferredType) }),
              ...(!isEssential && { className: 'hidden sm:table-cell' }),
              ...(col.width && { width: col.width }),
              ...(inferredAlign && { align: inferredAlign }),
              sortable: col.sortable !== false,
              ...(col.resizable !== undefined && { resizable: col.resizable }),
              ...(cellRenderer && { cell: cellRenderer }),
              ...(col.pinned && { pinned: col.pinned }),
              // objectui#6650 (maintainer ruling 2026-09-02, Option B). The hop
              // objectui#5453 deleted, returning WITH a reader:
              // `data-table.tsx` renders a `wrap: true` cell
              // `whitespace-normal break-words` instead of `truncate`. Spelled
              // `!== undefined` rather than truthy so an explicit `wrap: false`
              // is forwarded as the author wrote it and reaches the consumer as
              // a decision, not as an absence.
              ...(col.wrap !== undefined && { wrap: col.wrap }),
            };
          });
      }
      
      // String array format - enrich with objectDef field metadata for type-aware rendering
      return (cols as string[])
        .filter((fieldName) => typeof fieldName === 'string' && fieldName.trim().length > 0)
        .filter((fieldName) => passesFieldGate(fieldName))
        .map((fieldName, colIndex) => {
          const fieldDef = objectFields?.[fieldName];
          // objectui#10657 — a bare field name carries no type of its own, so
          // while the object's field types are unknown it is WITHHELD (see
          // path A): the mask, no inferred type.
          const withheld = isWithheldGridColumn(undefined, objectTypesPending);
          const rawFieldLabel = fieldDef?.label;
          const rawHeader = rawFieldLabel || fieldName.charAt(0).toUpperCase() + fieldName.slice(1).replace(/_/g, ' ');
          const header = schema.objectName ? resolveFieldLabel(schema.objectName, fieldName, rawHeader) : rawHeader;

          // TWO resolves, two names (objectui#8920). "Resolve type" here means
          // objectDef type > heuristic inference — WHICH TYPE THE FIELD HAS,
          // and that is `declaredType`. The published second step, WHICH
          // RENDERER THE TYPE MAPS TO, is `rendererType`; this path used to
          // skip it entirely, so a `text` + `format: 'phone'` column got
          // `TextCellRenderer` and the hint vanished with no diagnostic.
          // A local called `resolvedType` holding only the FIRST answer is the
          // trap that hid that for four of the six sites.
          //
          // The `string | null` annotation path A's `baseInferredType` needs
          // (objectui#6004: `fieldDef` is `any`, and an `any` reaching the
          // `...(declaredType && { type: declaredType })` spread below
          // collapses the emit literal) now lives on `GridCellRendering`'s
          // members — it moved into the helper's return type, it did not go
          // away.
          const { declaredType, rendererType, Renderer } = resolveGridCellRendering({
            type: withheld ? null : fieldDef?.type || inferColumnType({ field: fieldName }),
            format: fieldDef?.format,
            widget: fieldDef?.widget,
          });
          const CellRenderer = withheld ? MaskedCellRenderer : rendererType ? Renderer : null;

          // Build field metadata with objectDef enrichment
          const fieldMeta: Record<string, any> = { name: fieldName, type: rendererType || 'text' };
          if (fieldDef) {
            // The header's label, as path A hands it (objectui#11689).
            if (fieldDef.label) fieldMeta.label = header;
            if (fieldDef.currency) fieldMeta.currency = fieldDef.currency;
            // Verbatim, as the ListColumn path copies it (objectui#10354).
            if (fieldDef.currencyConfig) fieldMeta.currencyConfig = fieldDef.currencyConfig;
            // The formula's face, as path A copies it.
            if (fieldDef.returnType !== undefined) fieldMeta.returnType = fieldDef.returnType;
            if (fieldDef.precision !== undefined) fieldMeta.precision = fieldDef.precision;
            if ((fieldDef as any).scale !== undefined) fieldMeta.scale = (fieldDef as any).scale;
            // Beside `scale`, as path A copies it (objectui#11026).
            if (fieldDef.useGrouping !== undefined) fieldMeta.useGrouping = fieldDef.useGrouping;
            // The percent storage statement, as path A copies it (objectui#11475).
            if (fieldDef.max !== undefined) fieldMeta.max = fieldDef.max;
            if (fieldDef.format) fieldMeta.format = fieldDef.format;
            // The deadline declaration, as path A copies it (objectui#11815).
            if (fieldDef.dueLike !== undefined) fieldMeta.dueLike = fieldDef.dueLike;
            if (fieldDef.settledWhen !== undefined) fieldMeta.settledWhen = fieldDef.settledWhen;
            if (fieldDef.options) fieldMeta.options = translateOptions(schema.objectName, fieldName, fieldDef.options);
          }
          // Preserve relational metadata (reference, displayField, …) so
          // lookup CELLS resolve ids to names. ⛔ Not the inline picker — that
          // reads the schema def directly, see `renderCellEditor` (objectui#7154).
          applyRelationalMeta(fieldMeta, fieldDef as any);
          // Auto-generate select options from data when no options defined
          if (rendererType === 'select' && !fieldMeta.options) {
            const uniqueValues = Array.from(new Set(data.map(row => row[fieldName]).filter(Boolean)));
            fieldMeta.options = uniqueValues.map((v: any) => ({ value: v, label: humanizeLabel(String(v)) }));
          }
          if ((rendererType === 'select' || rendererType === 'status') && (fieldDef as any)?.appearance != null) {
            fieldMeta.appearance = (fieldDef as any).appearance;
          }

          const numericTypes = ['number', 'currency', 'percent'];
          const inferredAlign = rendererType && numericTypes.includes(rendererType) ? 'right' as const : undefined;

          // Auto-link primary field (first column) to record detail
          const isPrimaryField = colIndex === 0;
          let cellRenderer: ((value: any, row?: any) => React.ReactNode) | undefined;

          // The face the value takes inside the link (objectui#11817).
          const LinkContentRenderer = linkCellRenderer(rendererType, CellRenderer);
          // A `referenceVia` pointer column (objectui#12608), as path A.
          const pointerFace = withheld ? null : recordPointerFace(fieldName, declaredType, fieldDef, dataSource);

          if (isPrimaryField && LinkContentRenderer) {
            cellRenderer = (value: any, row: any) => {
              const displayContent = pointerFace?.(row) ?? <LinkContentRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />;
              return (
                <LinkCell
                  testId="primary-field-link"
                  onActivate={() => navigation.handleClick(row)}
                  objectName={schema.objectName}
                  recordId={rowRecordId(row)}
                  trailing={recordLinkAdornment?.(row)}
                >
                  {displayContent}
                </LinkCell>
              );
            };
          } else if (isPrimaryField) {
            cellRenderer = (value: any, row: any) => (
              <LinkCell
                testId="primary-field-link"
                onActivate={() => navigation.handleClick(row)}
                objectName={schema.objectName}
                recordId={rowRecordId(row)}
                trailing={recordLinkAdornment?.(row)}
              >
                {value != null && value !== '' ? String(value) : <EmptyValue />}
              </LinkCell>
            );
          } else if (CellRenderer) {
            cellRenderer = (value: any, row: any) => pointerFace?.(row) ?? <CellRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />;
          }

          return {
            header,
            accessorKey: fieldName,
            // Forward the DECLARED type for the type-aware inline editor — the
            // renderer key would make a `format`-hinted text column edit as a
            // phone/currency control it never declared. Path A forwards
            // `baseInferredType` for exactly this reason (objectui#8920).
            ...(declaredType && { type: declaredType }),
            ...(schema.showColumnTypeIcons && rendererType && { headerIcon: getTypeIcon(rendererType) }),
            ...(inferredAlign && { align: inferredAlign }),
            ...(cellRenderer && { cell: cellRenderer }),
            sortable: fieldDef?.sortable !== false,
          };
        });
    }

    // Legacy support: use 'fields' if columns not provided.
    //
    // ⭐ THE ORDER OF THIS PATH AND THE OBJECT-SCHEMA PATH BELOW IS
    // LOAD-BEARING (objectui#6677).
    //
    // `hasInlineData` is `dataConfig.provider === 'value'`, and `dataConfig` is
    // built as `provider: 'value'` from the `data` PROP before anything else.
    // So this path is taken by EVERY grid whose rows were handed down instead
    // of fetched — which is every object-bound grid reached through a fetching
    // host (`ListView`, `ObjectView`, …). It used to return unconditionally
    // whenever rows were present, which made the object-schema path below
    // unreachable for all of them: the branch that knows the object was the one
    // that never ran. Measured, same page / source / object, one variable:
    // grid-fetches rendered the policy's 5 columns, host-fetches rendered 10 —
    // the payload's keys, including `id` (`hidden: true`) and the four audit
    // columns (`system`), exactly what the policy exists to exclude.
    //
    // The yield is as NARROW as the defect. Only the ROW-KEY FALLBACK
    // (`Object.keys(inlineData[0])`) is wrong for an object-bound grid, so only
    // that is given up, and only once there is a policy to give it up TO:
    //
    //   - `schemaFields` present ⇒ this path keeps it. An authored projection
    //     is the author's contract, and the schema path would silently drop a
    //     name the object does not declare (`if (!field) return;`) — a host may
    //     legitimately join or derive keys. `!schemaFields` is exactly the
    //     condition under which the `||` below reaches for the row keys, so the
    //     gate and the fallback cannot drift apart.
    //   - `objectSchema` still `null` ⇒ this path keeps it. ⚠️ Gating on
    //     `objectName` ALONE is the trap: the schema arrives from an async
    //     fetch, so `objectSchema` is null on first paint and the grid would
    //     fall straight through to `if (!objectSchema) return []` and render an
    //     empty header row before flipping — a worse defect than this one. It
    //     is also the graceful fallback when the schema fetch fails or the data
    //     source has no `getObjectSchema`: the row keys stay the answer instead
    //     of the grid going blank.
    //
    // Both are pinned in `hostFetchedDefaultColumns-6677.test.tsx`, together
    // with the case this file's own comment calls the right one for this path:
    // inline data with no object behind it at all.
    const rowKeysWouldOutrankSchemaPolicy = !schemaFields && !!objectName && !!objectSchema;
    if (hasInlineData && !rowKeysWouldOutrankSchemaPolicy) {
      const inlineData = dataConfig?.provider === 'value' ? dataConfig.items as any[] : [];
      if (inlineData.length > 0) {
        // FLS on the inline-data path (objectui#6723 — maintainer ruling
        // 2026-08-29: the NARROW defence-in-depth fix, not a convergence).
        //
        // The object-schema path below re-applies field-level security to the
        // columns it derives; this path did not. So whether an object-bound
        // grid re-checked FLS depended on WHO FETCHED THE ROWS: same object,
        // same authored projection, rows the grid fetched went through the
        // gate and rows a host handed down did not. That is the asymmetry, and
        // a security invariant may not be decided by the data's provenance.
        //
        // ⭐ THE LIMIT IS LOAD-BEARING, NOT AN OPTIMISATION. Only keys the
        // OBJECT DECLARES are judged; everything else passes through
        // untouched. A host may legitimately join or derive columns
        // (`computed_score`, a flattened `account.name`), and keeping those is
        // this path's whole reason to exist — the object-schema path drops
        // them outright (`if (!field) return;`). Judging an undeclared key
        // would silently drop derived columns, which is the failure
        // objectui#6723's own analysis warned about and which the ruling
        // refuses by name. `checkField` answers `false` for a field the
        // policy has never heard of, so asking it about a derived key is not
        // a stricter reading of the same rule — it is a different, wrong one.
        //
        // Redundant through `ListView`, which filters its own `effectiveFields`
        // through this same gate before forwarding (its source says so), and
        // that redundancy IS the point: the invariant must not rest on every
        // future host having read the docs. Pinned as a byte-for-byte no-op on
        // that path in `inlineDataFls-6723.test.tsx`.
        const fieldsToShow = (schemaFields || Object.keys(inlineData[0])).filter((fieldName) => {
          if (!perms?.isLoaded || !schema.objectName) return true;
          // Undeclared ⇒ host-joined / derived ⇒ not this gate's business.
          // `hasOwnProperty` rather than a truthiness read so an inherited
          // name (`constructor`, `toString`) cannot be mistaken for a declared
          // field and dropped.
          if (!Object.prototype.hasOwnProperty.call(objectFields ?? {}, fieldName)) return true;
          return perms.checkField(schema.objectName, fieldName, 'read');
        });
        return fieldsToShow.map((fieldName) => {
          const fieldDef = objectFields?.[fieldName];
          // objectui#10657 — a row key carries no type of its own, so while
          // the object's field types are unknown it is WITHHELD (see path A):
          // the mask, no inferred type. This is the path a host-fetched grid
          // with no authored columns paints first.
          const withheld = isWithheldGridColumn(undefined, objectTypesPending);
          // The same two resolves as path B, through the same shared owner
          // (objectui#8920) — and the same objectui#6004 annotation, now
          // carried by `GridCellRendering`'s `string | null` members.
          const { declaredType, rendererType, Renderer } = resolveGridCellRendering({
            type: withheld ? null : fieldDef?.type || inferColumnType({ field: fieldName }),
            format: fieldDef?.format,
            widget: fieldDef?.widget,
          });
          const CellRenderer = withheld ? MaskedCellRenderer : rendererType ? Renderer : null;
          const header = fieldDef?.label || fieldName.charAt(0).toUpperCase() + fieldName.slice(1).replace(/_/g, ' ');

          // Build field metadata with objectDef enrichment
          const fieldMeta: Record<string, any> = { name: fieldName, type: rendererType || 'text' };
          if (fieldDef) {
            // The header's label, as path A hands it (objectui#11689).
            if (fieldDef.label) fieldMeta.label = header;
            if (fieldDef.currency) fieldMeta.currency = fieldDef.currency;
            // Verbatim, as the ListColumn path copies it (objectui#10354).
            if (fieldDef.currencyConfig) fieldMeta.currencyConfig = fieldDef.currencyConfig;
            // The formula's face, as path A copies it.
            if (fieldDef.returnType !== undefined) fieldMeta.returnType = fieldDef.returnType;
            if (fieldDef.precision !== undefined) fieldMeta.precision = fieldDef.precision;
            if ((fieldDef as any).scale !== undefined) fieldMeta.scale = (fieldDef as any).scale;
            // Beside `scale`, as path A copies it (objectui#11026).
            if (fieldDef.useGrouping !== undefined) fieldMeta.useGrouping = fieldDef.useGrouping;
            // The percent storage statement, as path A copies it (objectui#11475).
            if (fieldDef.max !== undefined) fieldMeta.max = fieldDef.max;
            if (fieldDef.format) fieldMeta.format = fieldDef.format;
            // The deadline declaration, as path A copies it (objectui#11815).
            if (fieldDef.dueLike !== undefined) fieldMeta.dueLike = fieldDef.dueLike;
            if (fieldDef.settledWhen !== undefined) fieldMeta.settledWhen = fieldDef.settledWhen;
            if (fieldDef.options) fieldMeta.options = translateOptions(schema.objectName, fieldName, fieldDef.options);
          }
          // Preserve relational metadata (reference, displayField, …) so
          // lookup CELLS resolve ids to names. ⛔ Not the inline picker — that
          // reads the schema def directly, see `renderCellEditor` (objectui#7154).
          applyRelationalMeta(fieldMeta, fieldDef as any);
          // Auto-generate select options from data when no options defined
          if (rendererType === 'select' && !fieldMeta.options) {
            const uniqueValues = Array.from(new Set(data.map(row => row[fieldName]).filter(Boolean)));
            fieldMeta.options = uniqueValues.map((v: any) => ({ value: v, label: humanizeLabel(String(v)) }));
          }
          if ((rendererType === 'select' || rendererType === 'status') && (fieldDef as any)?.appearance != null) {
            fieldMeta.appearance = (fieldDef as any).appearance;
          }

          const numericTypes = ['number', 'currency', 'percent'];
          const inferredAlign = rendererType && numericTypes.includes(rendererType) ? 'right' as const : undefined;
          // A `referenceVia` pointer column (objectui#12608), as path A.
          const pointerFace = withheld ? null : recordPointerFace(fieldName, declaredType, fieldDef, dataSource);

          return {
            header,
            accessorKey: fieldName,
            // Forward the DECLARED type for the type-aware inline editor — the
            // renderer key would make a `format`-hinted text column edit as a
            // phone/currency control it never declared. Path A forwards
            // `baseInferredType` for exactly this reason (objectui#8920).
            ...(declaredType && { type: declaredType }),
            ...(schema.showColumnTypeIcons && rendererType && { headerIcon: getTypeIcon(rendererType) }),
            ...(inferredAlign && { align: inferredAlign }),
            ...(CellRenderer && {
              cell: (value: any, row: any) => pointerFace?.(row) ?? <CellRenderer value={value} field={fieldMeta as any} dependentValues={row} deadlineSettled={settledFor(fieldMeta, row)} inGridColumn />,
            }),
            sortable: fieldDef?.sortable !== false,
          };
        });
      }
    }

    if (!objectSchema) return [];

    const generatedColumns: ObjectGridColumnDraft[] = [];
    // Default columns priority (when schema doesn't specify columns):
    //   1. The object's `highlightFields` semantic role (ADR-0085).
    //   2. Otherwise, all schema fields with system-managed fields pushed to the end.
    //
    // Also drop fields that are platform-managed identifiers/audit columns or
    // marked `hidden: true`/`readonly: true` so default list views show only
    // the business fields users actually care about. Callers can still opt-in
    // to system columns by passing an explicit `fields` / `columns` prop.
    //
    // "System-managed" is decided by `isSystemManagedField`, which branches on
    // the framework's `field.system` flag (single source of truth stamped by
    // `applySystemFields`) — this is what keeps the injected, non-readonly
    // `owner_id` from leading the auto-derived columns, and covers any future
    // injected field without editing a name list here.
    const highlightFields: string[] | undefined = (objectSchema as any)?.highlightFields;
    const allFieldNames = Object.keys(objectSchema.fields || {});
    let fieldsToShow: string[];
    if (schemaFields) {
      fieldsToShow = schemaFields;
    } else if (highlightFields?.length) {
      // Lead with the object's name field (objectui#7245). `highlightFields` is
      // ADR-0085's "most important fields" role, not a column list — the detail
      // highlight strip, its first consumer, deliberately drops the title field
      // because the page H1 above it already shows one. A grid has no H1, so a
      // declared list like `["status", "industry", "annual_revenue"]` left rows
      // with nothing to tell them apart. `leadWithNameField` is the shared
      // helper the two app-shell synthesis faces use, so all three agree.
      //
      // Only the SYNTHESIZED branch. `schemaFields` above is author-declared and
      // is never reordered — that would be the renderer second-guessing metadata
      // (AGENTS.md Commandment #0.1).
      fieldsToShow = leadWithNameField(
        objectSchema,
        highlightFields.filter((n) => objectSchema.fields?.[n]),
      );
    } else {
      // No name-field lead here, and that is measured, not an oversight: this
      // branch takes EVERY visible field with no cap, so — unlike the two
      // app-shell faces, which slice to 5 / 6 — the name field cannot fall off
      // the end. It is already present; only its position could differ, and a
      // row that carries its name column somewhere is still identifiable. The
      // objectui#7245 defect is "no name column at all", which is unreachable
      // from here.
      //
      // Drop hidden + readonly system-managed fields, then push the remaining
      // system/audit/ownership columns (e.g. the injected, editable `owner_id`)
      // to the end as a fallback so business fields lead.
      const visibleFields = allFieldNames.filter((n) => {
        const f = objectSchema.fields?.[n];
        if (!f) return false;
        if (f.hidden) return false;
        // Drop readonly bookkeeping columns (created_at/by, updated_at/by, …).
        if (f.readonly && isSystemManagedField(n, f)) return false;
        return true;
      });
      fieldsToShow = [
        ...visibleFields.filter((n) => !isSystemManagedField(n, objectSchema.fields?.[n])),
        ...visibleFields.filter((n) => isSystemManagedField(n, objectSchema.fields?.[n])),
      ];
    }

    fieldsToShow.forEach((fieldName) => {
      const field = objectSchema.fields?.[fieldName];
      if (!field) return;

      // FLS: drop columns the current user cannot read (server-resolved
      // /me/permissions via checkField — the schema itself carries no
      // per-caller permission bits, objectstack#3661). Same gate ListView
      // applies to its auto-derived columns.
      if (perms?.isLoaded && schema.objectName
        && !perms.checkField(schema.objectName, fieldName, 'read')) return;

      // Annotated for the same reason as paths A-C (objectui#6004): `field` is
      // `any`, so these values have to be named before they reach a spread
      // below — the naming now lives on `GridCellRendering`'s `string | null`
      // members. `fieldType` is the DECLARED type the emit forwards to the
      // inline editor; the renderer comes from the `format`-promoted key, which
      // this path used to skip (objectui#8920).
      const { declaredType: fieldType, rendererType, Renderer: CellRenderer } = resolveGridCellRendering(field);
      const numericTypes = ['number', 'currency', 'percent'];
      const translatedField = field.options
        ? { ...field, options: translateOptions(schema.objectName, fieldName, field.options) }
        : field;
      const header = schema.objectName ? resolveFieldLabel(schema.objectName, fieldName, field.label || fieldName) : field.label || fieldName;
      // The face is handed the header's label, as paths A-C hand it
      // (objectui#11689).
      const fieldForCell: any = field.label ? { ...translatedField, label: header } : translatedField;
      // A `referenceVia` pointer column (objectui#12608), as path A.
      const pointerFace = recordPointerFace(fieldName, fieldType, field, dataSource);
      generatedColumns.push({
        header,
        accessorKey: fieldName,
        // Forward the field type for the type-aware inline editor.
        ...(fieldType && { type: fieldType }),
        // Aligned on the RENDERER key, like paths A-C: a `text` column with
        // `format: 'currency'` renders as currency, so it aligns as currency.
        ...(!!rendererType && numericTypes.includes(rendererType) && { align: 'right' as const }),
        cell: (value: any, row: any) => pointerFace?.(row) ?? <CellRenderer value={value} field={fieldForCell} dependentValues={row} deadlineSettled={settledFor(fieldForCell, row)} inGridColumn />,
        sortable: field.sortable !== false,
      });
    });

    return generatedColumns;
  }, [objectSchema, objectFields, objectTypesPending, schemaFields, schemaColumns, dataConfig, hasInlineData, objectName, navigation.handleClick, executeAction, data, resolveFieldLabel, translateOptions, schema.objectName, perms, uiLanguage, dataSource, predicateScope, recordLinkAdornment]);

  return { generateColumns };
}
