/**
 * The saved-view helpers of the Console `ObjectView` (`./ObjectView.tsx`):
 * default columns, view overrides, the switcher's tabs and the view-config
 * save body, moved out of that file verbatim (objectstack#25992, slice 1).
 * `ObjectView.tsx` re-exports every name it exported before.
 */

import { leadWithNameField } from '@object-ui/core';
import { isFilterValueComplete } from '@object-ui/components';
import { isSystemManagedField } from '@object-ui/types';
import { narrowPersonalizationOverlay } from '@object-ui/data-objectstack';
import { isViewFilterOrGroup, ListViewSchema as SpecListViewSchema, normalizeFilterOperator, VIEW_CONSOLE_ROUND_TRIP_KEYS } from '@objectstack/spec/ui';
import { VALUELESS_FILTER_OPERATORS } from './viewFilterFold.js';
import { viewEnvelope, type ViewEnvelope } from './runtime-metadata-persistence.js';
import { buildNewViewSpec } from './newViewSpec.js';
import { viewRowId, viewEntry } from '../utils/viewIdentity.js';

/**
 * Default list columns for an object that declares no explicit list view.
 *
 * Priority: the object's name field ALWAYS leads (see below); then the
 * `highlightFields` semantic role (ADR-0085) verbatim (only dropping names with
 * no field def); otherwise the first `limit` business fields in declared order.
 * Framework-injected system / audit / ownership columns are excluded via the
 * shared `isSystemManagedField` classifier — its single source of truth is the
 * spec `system` flag stamped by `applySystemFields`, with a name-set fallback
 * covering the injected, non-hidden / non-readonly `owner_id` and
 * `organization_id`. Without this, `applySystemFields` (which spreads injected
 * fields to the FRONT of the field map) would surface `owner_id` as a leading
 * raw-id column (#2702, #2777).
 *
 * The name-field lead is `leadWithNameField` from `@object-ui/core`
 * (objectui#7245). `highlightFields` is NOT a column list — it is ADR-0085's
 * "most important fields", and its first consumer, the detail highlight strip,
 * deliberately DROPS the title field because the page H1 above it already shows
 * one. So metadata that is entirely well-authored routinely omits the name:
 * `showcase_account` declares `["status", "industry", "annual_revenue"]` and its
 * default grid rendered 14 rows a user could not tell apart. A list has no H1,
 * so the same role needs the opposite treatment here. Applied to BOTH branches:
 * the fallback walk is declaration-ordered, so an object whose name field is
 * declared late lost it off the end of the `limit` slice.
 *
 * `opts.orgAttribution` (ADR-0105 group posture): reads span every
 * organization the member belongs to, so cross-org rows need attribution —
 * append `organization_id` as a TRAILING column when the object carries the
 * field. Trailing keeps business fields leading; render-time only, never
 * persisted into saved view metadata (a saved view must not fossilize a
 * posture-dependent column set).
 */
export function defaultListColumnsFromObject(
    objectDef: any,
    limit = 5,
    opts?: { orgAttribution?: boolean },
): string[] {
    const withOrgAttribution = (cols: string[]): string[] =>
        opts?.orgAttribution && objectDef?.fields?.organization_id && !cols.includes('organization_id')
            ? [...cols, 'organization_id']
            : cols;
    const curated = objectDef?.highlightFields;
    if (Array.isArray(curated) && curated.length > 0) {
        return withOrgAttribution(
            leadWithNameField(objectDef, curated.filter((n: string) => objectDef?.fields?.[n])),
        );
    }
    const fields = objectDef?.fields;
    if (fields && typeof fields === 'object') {
        return withOrgAttribution(
            // Lead BEFORE the slice: slicing first could drop the very column
            // the lead exists to guarantee, on an object that declares its name
            // field after `limit` others.
            leadWithNameField(
                objectDef,
                Object.entries(fields)
                    .filter(([name, f]: [string, any]) => f && !f.hidden && !isSystemManagedField(name, f))
                    .map(([name]) => name),
            ).slice(0, limit),
        );
    }
    return [];
}

/**
 * The action names a list view wires to its selection bar, as `ObjectGrid`
 * folds them from the two keys this page relays to it (`resolveBulkActions` in
 * `@object-ui/plugin-grid`), sorted and JSON-encoded so a memo keys on a
 * primitive (objectui#12462).
 *
 * - `bulkActions`: every non-empty name except `delete` (any case). The grid
 *   sends `delete` to its built-in bulk delete, never to an object action of
 *   that name, so the bar does not carry such an action.
 * - `bulkActionDefs`: the `name` of every entry the grid can render, which is
 *   an object with a non-empty string `name` (`isUsableBulkActionDef`).
 *
 * The legacy `batchActions` spelling is not read: this page never relays it.
 */
export function bulkWiredActionNamesKey(view: unknown): string {
    const { bulkActions, bulkActionDefs } = (view ?? {}) as { bulkActions?: unknown; bulkActionDefs?: unknown };
    const names = new Set<string>();
    if (Array.isArray(bulkActions)) {
        for (const name of bulkActions) {
            if (typeof name === 'string' && name !== '' && name.toLowerCase() !== 'delete') names.add(name);
        }
    }
    if (Array.isArray(bulkActionDefs)) {
        for (const def of bulkActionDefs) {
            const name = def && typeof def === 'object' ? (def as { name?: unknown }).name : undefined;
            if (typeof name === 'string' && name !== '') names.add(name);
        }
    }
    return JSON.stringify([...names].sort());
}

/**
 * Assemble the list-view `spec` the add-view door (`handleViewCreate`: the
 * Create View dialog from the view tab bar, and the view-config panel's create
 * mode) hands to `viewEnvelope`.
 *
 * This door resolves only its own fallback columns: the object's default
 * business columns (`defaultListColumnsFromObject` keeps the framework-injected
 * `owner_id` / audit columns out of the lead, #2702 / #2777, so a new view
 * never opens on a raw id). The spec itself, with every type-specific rule
 * (the columns mirrored into `kanban.columns` and `gallery.visibleFields`), is
 * built by `buildNewViewSpec`, the one builder this door shares with "Save as
 * view" (objectui#11581).
 *
 * Exported for `CreateViewDialog.viewTypeParse-11581.test.tsx`. @internal
 */
export function buildAddViewSpec(config: Record<string, any>, objectDef: any): Record<string, any> {
    return buildNewViewSpec(config, { fallbackColumns: defaultListColumnsFromObject(objectDef, 5) });
}

/**
 * Read the persisted per-view overrides (density, column widths, sort, hidden
 * columns, inlineEdit …) for `ids`, preferring the adapter's one-request batch
 * enumeration and falling back to a per-view `getView`.
 *
 * Extracted from the effect below so the three-way branch is pinnable on its
 * own (objectui#3774) — the file's existing precedent for this is
 * {@link defaultListColumnsFromObject}.
 *
 * The batch/fallback choice hangs entirely on how `listViewOverrides` ANSWERS,
 * so the two are spelled out:
 *
 * - RESOLVES (including to an empty map) → authoritative. The adapter looked
 *   and reports what exists; an object whose views were never customized
 *   legitimately has no overrides, and we take that answer and skip N GETs.
 *   That is the whole point of the batch call — do not "helpfully" re-probe
 *   per view on an empty map, that reinstates the 404 flurry it removes.
 * - REJECTS → the adapter could not tell, which is NOT the same fact as
 *   "nothing is there". Fall through to the per-view reads.
 *
 * An adapter that swallows its own failures into `{}` collapses those two into
 * the authoritative branch and makes the fallback below unreachable code —
 * that was objectui#3774's second half, fixed in `@object-ui/data-objectstack`.
 */
/**
 * Strip conditions an overlay must never impose, and drop the `filter` key
 * entirely when nothing effective is left (objectui#4155).
 *
 * A view override is merged over the source-declared view as `{ ...source,
 * ...override }`, so its `filter` key REPLACES the view's declared filter
 * wholesale. That made two overlay bodies destructive:
 *
 *   `filter: [{ field: 'x', operator: 'equals', value: '' }]`
 *        — an incomplete filter-panel row. The live query never applied it
 *          (`convertFilterGroupToAST` skips empty values), but as a stored
 *          overlay it became the view's ENTIRE filter and returned `total: 0`:
 *          the "empty list that used to have rows" this issue reports.
 *   `filter: []`
 *        — what "Clear all" wrote. Not a poisoned filter, but still an override
 *          that silently deletes the source declaration (an archived-records
 *          exclusion, say) for everyone.
 *
 * Both are neutralized HERE, on the read path, so an install already carrying a
 * poisoned row self-heals on the next load rather than needing a `sys_metadata`
 * delete plus a service restart. The write that created them is gone too (the
 * filter panel no longer persists anything) — this is the recovery half.
 *
 * Consequence, deliberate and worth naming: an overlay can no longer express
 * "this view has NO filter" over a source view that declares one. That is the
 * strictly safer side of the trade — the shape that expressed it is the same
 * shape that silently erased source declarations, and an author who genuinely
 * wants no filter edits the view (an explicit save), which writes the view body
 * rather than an overlay.
 *
 * Filter entries are matched in both at-rest shapes: spec `ViewFilterRule`
 * objects (`{ field, operator, value }`, what the fold writes) and the legacy
 * runtime triple `[field, operator, value]` a source view may declare and which
 * the console's toolbar write (`persistViewPatch`) USED TO copy into the
 * overlay along with the rest of the view, until objectui#5233 narrowed it to
 * the patch. That write is retired (objectui#12504), so a triple can only reach
 * this pass from a row written before objectui#5233, or from a saved view's own
 * body.
 *
 * Whether a matched entry's VALUE counts as supplied is asked of the builder's
 * own {@link isFilterValueComplete}, not of a local predicate (objectstack#8815,
 * objectui#5025). This pass used to spell the question out here:
 *
 * ```ts
 * value == null || value === '' || (Array.isArray(value) && value.length === 0)
 * ```
 *
 * — right for `scalar` and `list`, blind to `pair`. A `between` carrying one
 * bound is `['2024-01-01', '']`, an array of length 2, so the recovery pass read
 * it as a real condition and handed it back. That is the one shape this pass
 * most needs to strip: `ViewFilterRuleSchema` ACCEPTS a half-filled range
 * (measured on `@objectstack/spec` 17.1.0 — it counts the two slots, not what is
 * in them), so authoring validation is green on it and it only dies at query
 * time, where the server refuses the WHOLE view (`400 INVALID_FILTER`) for every
 * user on every later read. The builder's two write paths were converted to the
 * arity-aware reading; this is the read-path half, and it was the third verbatim
 * copy of a predicate that had already been indicted twice.
 *
 * The split of duties is the helper's own: it answers the VALUE question only,
 * while which operators want no value at all stays with
 * {@link VALUELESS_FILTER_OPERATORS} above.
 *
 * That membership is asked of the row's spelling FOLDED through the spec's own
 * `normalizeFilterOperator` (objectui#9306), never of the raw spelling — the
 * same both-sides fold objectui#9302 / #9359 put on the builder's gate and the
 * live grid, and that {@link isFilterValueComplete} already applies to the
 * arity question. The set's members are protocol ids (plus `exists` /
 * `notExists`), on which the fold is the identity, so folding the row is
 * folding both sides. It became load-bearing when the builder's ids became the
 * protocol's: a row stored under the deprecated camelCase id —
 * `{ operator: 'isEmpty', value: '' }` — no longer matches the set raw, and a
 * raw lookup would hand it to the value test, which reads `''` as unfilled and
 * DROPS it, so the stored filter would lose a condition on read.
 */
export function sanitizeViewOverride(override: any): any {
    if (!override || typeof override !== 'object') return override;
    // objectui#5233 — a PERSONALIZATION overlay contributes only the keys it
    // owns (density / sort / hiddenFields / columnState / inlineEdit). Every
    // other key on such a row is a copy of the source view taken when the
    // user last dragged a column, and the merge below hands it authority over
    // the source declaration it was copied from. Narrowed FIRST and returned:
    // a narrowed row can no longer carry a `filter` at all, so the
    // recovery pass below has nothing left to do for it. The predicate is the
    // adapter's (`@object-ui/data-objectstack` owns the row's shape and stamps
    // its marker) so a saved view's OWN body — enumerated by the same batch
    // read — is returned untouched, exactly as `listViews()` classifies it.
    const narrowed = narrowPersonalizationOverlay(override);
    if (narrowed !== override) return narrowed;
    if (!Array.isArray(override.filter)) return override;

    // Folded before the lookup — see the docblock (objectui#9306).
    const isValueless = (operator: unknown): boolean =>
        VALUELESS_FILTER_OPERATORS.has(normalizeFilterOperator(String(operator)));
    const isEffectiveRule = (entry: any): boolean => {
        if (!entry || typeof entry !== 'object') return false;
        if (typeof entry.field !== 'string' || entry.field === '') return false;
        if (isValueless(entry.operator)) return true;
        const value = entry.value;
        return isFilterValueComplete(String(entry.operator), value);
    };
    let changed = false;
    const kept = override.filter.flatMap((entry: any) => {
        if (Array.isArray(entry)) {
            // Legacy runtime triple: [field, operator, value]
            const effective = entry.length >= 2
                && (isValueless(entry[1]) || isFilterValueComplete(String(entry[1]), entry[2]));
            if (!effective) changed = true;
            return effective ? [entry] : [];
        }
        // An any-of group (`{ or: [rule, ...] }`, objectstack#28020) is judged
        // by its members, the way the live query reads an OR group's rows: an
        // unfinished member is not a condition, so it leaves the group, and a
        // group with no effective member left carries no condition at all. A
        // group whose `or` is not an array is kept as it is, so the server's
        // refusal of that shape is still what the author sees.
        if (isViewFilterOrGroup(entry)) {
            if (!Array.isArray(entry.or)) return [entry];
            const members = entry.or.filter(isEffectiveRule);
            if (members.length === entry.or.length) return [entry];
            changed = true;
            return members.length > 0 ? [{ ...entry, or: members }] : [];
        }
        const effective = isEffectiveRule(entry);
        if (!effective) changed = true;
        return effective ? [entry] : [];
    });

    // The empty-array case is checked FIRST: `filter: []` (Clear all's write)
    // leaves `kept.length === override.filter.length`, so an "unchanged"
    // shortcut ahead of this would hand the destructive empty override straight
    // back.
    if (kept.length === 0) {
        // Nothing effective survives → the overlay carries no opinion about the
        // filter, so the SOURCE-declared filter must win again. Dropping the key
        // (rather than writing `[]`) is what makes the `{ ...source, ...override }`
        // merge fall through to it.
        const { filter: _dropped, ...rest } = override;
        return rest;
    }
    if (!changed) return override;
    return { ...override, filter: kept };
}

export async function loadViewOverrides(
    dataSource: any,
    objectName: string,
    ids: string[],
): Promise<Record<string, any>> {
    if (typeof dataSource?.listViewOverrides === 'function') {
        try {
            const all = await dataSource.listViewOverrides(objectName);
            if (all && typeof all === 'object') {
                const map: Record<string, any> = {};
                for (const id of ids) {
                    if (all[id]) map[id] = sanitizeViewOverride(all[id]);
                }
                return map;
            }
        } catch {
            // fall through to per-view fetch
        }
    }
    if (typeof dataSource?.getView !== 'function') return {};
    const entries = await Promise.all(
        ids.map(async (id) => {
            try {
                const v = await dataSource.getView(objectName, id);
                return [id, v] as const;
            } catch {
                return [id, null] as const;
            }
        })
    );
    const map: Record<string, any> = {};
    for (const [id, v] of entries) {
        if (v && typeof v === 'object') map[id] = sanitizeViewOverride(v);
    }
    return map;
}

/**
 * Build the switcher's tab list — the ONE place a tab's identity is decided
 * (objectui#4211).
 *
 * Views reach this function from two independent reads of the same
 * `type='view'` metadata namespace:
 *
 *   - `definedViews` — `objectDef.listViews`, keyed by the composer's runtime
 *     identity (`MetadataProvider.applyViewItem`, `<object>.<key>`);
 *   - `savedViews` — the adapter's `listViews()` overlay rows, keyed by
 *     {@link viewRowId}.
 *
 * The two must produce the SAME string for the same view, because everything
 * downstream that decides whether a view is mutable — the tab's `readonly`
 * flag, `isSavedView`, and the early return in every mutating handler — asks
 * whether the tab's id is among the overlay keys. When they disagreed, a saved
 * view was presented as a system view: its set-default / rename / delete menu
 * entries were not rendered at all, so the click the QA run reported produced
 * no adapter write because there was nothing left to click.
 *
 * They disagreed because the metadata side spelled identity `{ id: key,
 * ...body, ...override }` — `id` FIRST, so an `id` key inside the stored body
 * or the stored override silently replaced it. Both are stored documents that
 * really do carry one: the console's toolbar write (`persistViewPatch` →
 * `updateViewConfig`, both retired in objectui#12504) WROTE the whole tab
 * object, its `id` included — objectui#5233 narrowed an overlay to the patch,
 * but a saved view's own row kept the whole body, and every row written before
 * that still carries an `id` — and a duplicated view copies its
 * source artifact's `id` verbatim. `viewEntry` stamps identity LAST at all
 * three sites, so the tab id is now a property of the key the caller looked the
 * view up by, and can never be a property of the data.
 *
 * Extracted from the `views` memo so the seam is assertable without mounting
 * the view; the memo still owns the concerns that need render context (default
 * columns, labels, the per-user sort).
 *
 * @param fallbackTab - the auto-generated "all records" tab, built lazily
 *   because it needs the translated label and the object's default columns.
 *   Used only when the object declares no views at all.
 */
export function buildViewTabs({
    definedViews,
    primary,
    primaryId,
    savedViews,
    viewOverrides,
    fallbackTab,
}: {
    definedViews: Record<string, any>;
    primary?: any;
    primaryId?: string;
    savedViews: readonly any[];
    viewOverrides: Record<string, any>;
    fallbackTab: () => Record<string, any> & { id: string };
}): Array<Record<string, any> & { id: string }> {
    const viewList = Object.entries(definedViews || {}).map(([key, value]: [string, any]) => {
        const override = viewOverrides[key];
        // Override wins per-key — saved overrides represent org-wide shared
        // view settings (density, column widths, etc. — objectstack#7494's
        // ruling: this store has no per-user scope, so "personal" is not an
        // accurate description of what it persists) that should shadow the
        // embedded definition — but NOT over the tab's identity.
        return viewEntry(key, value, override, {
            type: (override?.type) || value?.type || 'grid',
        });
    });

    // Honor `objectDef.list` (the primary list view, per @objectstack/spec
    // ViewSchema). MetadataProvider mirrors it into `listViews` so it's
    // already in `viewList` above; promote it to the front and mark it as
    // the default so `defaultViewId` picks it over secondary listViews.
    //
    // Its id is the composer's runtime identity (objectui#3770), which is
    // what the tab label / description / emptyState are translated under:
    // `viewLabel` reads `objects.<object>._views.<bare key>.label`, and for a
    // default list declared without a `name` that bare key is `default`.
    if (primaryId) {
        const idx = viewList.findIndex(v => v.id === primaryId);
        if (idx >= 0) {
            const [entry] = viewList.splice(idx, 1);
            viewList.unshift(viewEntry(primaryId, entry, { isDefault: true }));
        } else {
            const override = viewOverrides[primaryId];
            viewList.unshift(viewEntry(primaryId, primary, override, {
                type: (override?.type) || primary?.type || 'grid',
                isDefault: true,
            }));
        }
    }

    if (viewList.length === 0) viewList.push(fallbackTab());

    // Merge user-defined views (overlay rows) after metadata-defined views.
    // Dedup by id so a saved view that shadows a metadata view wins.
    const metaIds = new Set(viewList.map(v => v.id));
    for (const sv of savedViews) {
        const id = viewRowId(sv);
        if (!id) continue;
        // Drop undefined fields so a partial overlay (e.g. baseline row
        // with no user customization) does not stomp `isDefault`/`columns`
        // populated from the metadata view it shadows.
        const rawNormalized: Record<string, any> = {
            label: sv.label || sv.name || id,
            type: sv.type || 'grid',
            columns: sv.columns,
            filter: sv.filter,
            sort: sv.sort,
            // objectui#11013 — no `showSearch` / `showFilters` / `showSort`
            // picks: the toolbar policy's declared spelling is `userActions`,
            // which the row carries (and the spread below keeps) like any key.
            isPinned: sv.isPinned,
            isDefault: sv.isDefault,
            visibility: sv.visibility,
            sortOrder: sv.sortOrder,
            ...sv,
            id,
        };
        const normalized: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawNormalized)) {
            if (v !== undefined) normalized[k] = v;
        }
        if (metaIds.has(id)) {
            const idx = viewList.findIndex(v => v.id === id);
            viewList[idx] = viewEntry(id, viewList[idx], normalized);
        } else {
            viewList.push(viewEntry(id, normalized));
        }
    }
    return viewList;
}

/**
 * The `updateView` writes a "set this view as default" must issue
 * (objectui#4211).
 *
 * Extracted from `handleSetDefaultView` so the write set is assertable without
 * mounting the whole view: the QA symptom this issue records is *zero* adapter
 * writes, and a claim about how many writes a click produces has to be measured
 * against the code that produces them, not a replica of it.
 *
 * The list is never empty — clearing `isDefault` elsewhere is conditional, but
 * setting it here is not. So a set-default that reaches this function always
 * writes; the only way to observe no write at all is to be refused before it,
 * by the `isSavedViewId` guard in the handler (and, upstream of that, by the
 * menu entry the same predicate hides).
 */
export function setDefaultViewPatches(
    savedViews: readonly any[],
    vid: string,
): Array<{ viewId: string; patch: { isDefault: boolean } }> {
    const patches = savedViews
        .filter((sv: any) => viewRowId(sv) !== vid && sv.isDefault)
        .map((sv: any) => ({ viewId: viewRowId(sv) as string, patch: { isDefault: false } }));
    patches.push({ viewId: vid, patch: { isDefault: true } });
    return patches;
}

/**
 * Item-level keys a switcher tab carries that belong to the ROW, not to the
 * view body — the ones this surface's own handlers write through `updateView`
 * (`isDefault`, `isPinned`, `sortOrder`; the adapter merges them at the row's
 * top level), the tab's `visibility`, and `columnState`, the runtime-only key
 * the spec declares on the ViewItem wire face rather than on the list-view
 * body (objectstack `d5552ca13`). A view-config save is a whole-document PUT, so
 * these are carried forward at the envelope's top level; dropping them would
 * erase the default flag, the pin and the column widths the row held.
 *
 * objectui#11013 — read off the spec, not retyped: the keys of
 * `VIEW_CONSOLE_ROUND_TRIP_KEYS` (objectstack#20456) declared on the `viewItem`
 * member, which is the member this save's envelope is judged by. `_isOverride`
 * is declared on the list overlay only, so it is not carried here. The same
 * derivation is `@object-ui/data-objectstack`'s, where `listViews()` carries
 * these keys back off the stored record.
 */
const VIEW_ROW_STATE_KEYS: readonly string[] = (
    Object.keys(VIEW_CONSOLE_ROUND_TRIP_KEYS) as Array<keyof typeof VIEW_CONSOLE_ROUND_TRIP_KEYS>
).filter((key) => (VIEW_CONSOLE_ROUND_TRIP_KEYS[key] as readonly string[]).includes('viewItem'));

/**
 * The keys a list view's `config` may carry — read off the spec's own closed
 * `ListViewSchema`, never hand-listed, so the set moves with the spec.
 * Computed on first use: the schema is a lazy proxy and nothing else on this
 * module's load path needs it materialised.
 */
let listViewConfigKeys: ReadonlySet<string> | undefined;
function getListViewConfigKeys(): ReadonlySet<string> {
    listViewConfigKeys ??= new Set(Object.keys(SpecListViewSchema.shape));
    return listViewConfigKeys;
}

/**
 * The body "Edit view config → Save" persists: a canonical ViewItem envelope
 * `{ name, object, viewKind: 'list', label, config }` (objectui#10210).
 *
 * The panel hands its host the FLAT runtime tab, and this save used to persist
 * it as-is. On a code-defined view the server then inherits `viewKind: 'list'`
 * from the registry entry the row shadows (`viewIdentityPatch`), and a flat
 * row carrying `viewKind` is exactly the shape the adapter's legacy-overlay
 * net reads as a personalization overlay — so `listViews()` dropped the row,
 * the tab lost its saved-view status and was stamped read-only, and publishing
 * made that permanent. The create path never had the defect because it writes
 * through {@link viewEnvelope}; this is the same envelope, for an existing view.
 *
 * Three rules, each measured against the platform's write door:
 *
 * - **Identity is the row key.** `name` is the tab id the save is addressed
 *   to, verbatim, so the write lands on the row it always landed on and never
 *   forks a second view. `viewEnvelope` re-qualifies a name it is given; for a
 *   `<object>.<key>` id that is the same string, and pinning it here keeps that
 *   true for any id.
 * - **`config` carries only list-view keys.** The spec's list-view shape is
 *   closed: an envelope whose `config` carried the tab's own `id` / `isDefault`
 *   was refused outright (`422 INVALID_METADATA`, "Unrecognized key(s) on this
 *   list view"). The tab also carries identity (`name`, `object`, `viewKind`),
 *   read decorations (`_draft`, `_diagnostics`), registry bookkeeping and, when
 *   a toolbar overlay was merged into it, the overlay marker — none of which is
 *   view body. So `config` is the draft narrowed to the keys `ListViewSchema`
 *   declares, with the object binding stamped by `viewEnvelope`.
 * - **Row state is carried forward** at the top level — see
 *   {@link VIEW_ROW_STATE_KEYS}.
 *
 * Extracted so the persisted shape is assertable without mounting the view,
 * like {@link buildViewTabs} above.
 */
export function buildViewConfigSaveBody(
    objectName: string | undefined,
    draft: Record<string, unknown>,
): ViewEnvelope & Record<string, unknown> {
    const vid = String(draft?.id ?? '');
    const configKeys = getListViewConfigKeys();
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(draft ?? {})) {
        if (value !== undefined && configKeys.has(key)) body[key] = value;
    }
    const rowState: Record<string, unknown> = {};
    for (const key of VIEW_ROW_STATE_KEYS) {
        if (draft?.[key] !== undefined) rowState[key] = draft[key];
    }
    const label = typeof draft?.label === 'string' ? draft.label : undefined;
    const env = viewEnvelope(objectName, body, { name: vid, label });
    return { ...env, ...rowState, name: vid };
}
