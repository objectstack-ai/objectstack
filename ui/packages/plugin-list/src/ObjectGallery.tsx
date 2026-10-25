/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { useDataScope, SchemaRendererContext, useNavigationOverlay, useSafeFieldLabel, useSettledSchema, useDataInvalidation, useFilterScope, useResolvedFilter, usePredicateScope } from '@object-ui/react';
import { ComponentRegistry, buildExpandFields, getRecordDisplayName, isEmptyValue, isExpandableFieldType, isDeadlineSettled } from '@object-ui/core';
import { cn, Card, CardContent, NavigationOverlay } from '@object-ui/components';
import { usePermissions } from '@object-ui/permissions';
import type { DataSource, GalleryConfig, ObjectGallerySchema, QueryParams } from '@object-ui/types';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { getCellRenderer, resolveCellRendererType, readFileValues } from '@object-ui/fields';
import { useDisplayLocale } from '@object-ui/i18n';
import { RecordDetailPanel } from '@object-ui/plugin-detail';
import { ListEmptyState, hasDeclaredFilter } from './ListEmptyState';
import { useListViewTranslation } from './ListView';

export interface ObjectGalleryProps {
    /**
     * The `object-gallery` node — anchored to the exported schema type
     * (objectui#6576). Every `BaseSchema` member is writable, `bind` and
     * `className` included; the widget's own keys are declared there.
     */
    schema: ObjectGallerySchema;
    data?: Record<string, unknown>[];
    /**
     * The host's adapter. Declared as the published `DataSource` contract
     * (objectui#7912) — this used to be a hand-rolled `{ find(name, query:
     * unknown): Promise<unknown> }` stand-in, which is a second, weaker
     * spelling of a type this repo already publishes: it accepted any object
     * with a `find`, and it erased `find`'s real parameter and return types at
     * every call below.
     */
    dataSource?: DataSource;
    /** The other arm of the same `??` that feeds the hook — see `onRowClick` below (objectui#9357). */
    onCardClick?: (record: Record<string, unknown>, event?: any) => void;
    /**
     * Callback when a row/item is clicked (overrides NavigationConfig).
     *
     * TWO parameters since objectui#9357, and the second is not decoration: this
     * prop reaches `useNavigationOverlay` as its `onRowClick`, and `handleClick`
     * invokes it as `onRowClick(record, event)` — the modifier payload a host
     * needs to implement Cmd/Ctrl/middle-click for itself. Declaring one
     * parameter hid the second on the ONE line a host reads. Spelled `any` and
     * not `HandleClickModifiers` for the reason objectui#9341 measured on
     * `ObjectKanbanSchema.onCardClick`: that interface lives in
     * `@object-ui/react`, the published twins in `@object-ui/types` may not name
     * it, and a host that discovered the payload from the implementation
     * annotated it `React.MouseEvent` — which a narrower declaration refuses
     * contravariantly. `BaseSchema`'s own `onClick` / `onChange` / `onSubmit`
     * already use this spelling for exactly this situation.
     */
    onRowClick?: (record: Record<string, unknown>, event?: any) => void;
}

const GRID_CLASSES: Record<NonNullable<GalleryConfig['cardSize']>, string> = {
    small: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
    medium: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
    large: 'grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
};

const ASPECT_CLASSES: Record<NonNullable<GalleryConfig['cardSize']>, string> = {
    small: 'aspect-square',
    medium: 'aspect-[4/3]',
    large: 'aspect-[16/10]',
};

/**
 * Cell renderer types that produce bare values with no inherent visual
 * context. A card row rendered with one of these renderers is just a
 * number / string with no decoration — without a label prefix, the user
 * has no way to tell whether `5,000,000` is revenue, headcount, or
 * pipeline value. Self-describing renderers (badges, icons on links/
 * phone/email, dates, attachments) are excluded so the card layout
 * stays compact for those types.
 */
const LOW_SEMANTIC_RENDERER_TYPES: ReadonlySet<string> = new Set([
    'number',
    'currency',
    'percent',
    'integer',
    'decimal',
]);

/**
 * Deterministic palette for placeholder card covers (no-image fallback).
 * Index is derived from a tiny title hash so each record gets a stable —
 * but visually varied — soft gradient backdrop. Mirrors the home-page
 * AppCard accent treatment for cross-screen consistency.
 */
const PLACEHOLDER_GRADIENTS: ReadonlyArray<{ bg: string; ring: string; text: string }> = [
    { bg: 'from-indigo-500/15 via-indigo-500/5 to-purple-500/10', ring: 'ring-indigo-500/15', text: 'text-indigo-600/70 dark:text-indigo-300/70' },
    { bg: 'from-sky-500/15 via-sky-500/5 to-cyan-500/10',          ring: 'ring-sky-500/15',    text: 'text-sky-600/70 dark:text-sky-300/70' },
    { bg: 'from-emerald-500/15 via-emerald-500/5 to-teal-500/10',  ring: 'ring-emerald-500/15',text: 'text-emerald-600/70 dark:text-emerald-300/70' },
    { bg: 'from-amber-500/15 via-amber-500/5 to-orange-500/10',    ring: 'ring-amber-500/15',  text: 'text-amber-600/70 dark:text-amber-300/70' },
    { bg: 'from-rose-500/15 via-rose-500/5 to-pink-500/10',        ring: 'ring-rose-500/15',   text: 'text-rose-600/70 dark:text-rose-300/70' },
    { bg: 'from-violet-500/15 via-violet-500/5 to-fuchsia-500/10', ring: 'ring-violet-500/15', text: 'text-violet-600/70 dark:text-violet-300/70' },
];

function pickPlaceholderGradient(seed: string): typeof PLACEHOLDER_GRADIENTS[number] {
    // djb2-ish lightweight hash — stable across renders, no PRNG.
    let h = 5381;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) + h) + seed.charCodeAt(i);
    return PLACEHOLDER_GRADIENTS[Math.abs(h) % PLACEHOLDER_GRADIENTS.length];
}

/**
 * Card cover art with graceful degradation.
 *
 *  - `contain` covers (icons / logos) are centred at a capped size on a soft
 *    tinted backdrop so cards read as polished "app tiles" instead of a giant
 *    glyph stretched edge-to-edge.
 *  - `cover` covers (photos) fill the tile.
 *  - When there is no cover value — or the cover URL fails to load (404, dead
 *    CDN) — we fall back to the deterministic letter-avatar placeholder rather
 *    than leaving a broken `<img>` (alt text on a blank box).
 */
const GalleryCover: React.FC<{
    imageUrl?: string;
    title: string;
    coverFit: 'cover' | 'contain';
    aspectClass: string;
    placeholder: typeof PLACEHOLDER_GRADIENTS[number];
    hidden: boolean;
}> = ({ imageUrl, title, coverFit, aspectClass, placeholder, hidden }) => {
    const [errored, setErrored] = useState(false);
    const showImage = !!imageUrl && !errored;

    return (
        <div className={cn('w-full overflow-hidden relative', aspectClass)} hidden={hidden}>
            {showImage ? (
                coverFit === 'contain' ? (
                    <div className={cn('flex h-full w-full items-center justify-center bg-gradient-to-br', placeholder.bg)}>
                        <img
                            src={imageUrl}
                            alt={title}
                            loading="lazy"
                            onError={() => setErrored(true)}
                            className="h-1/2 w-1/2 max-h-24 max-w-24 object-contain transition-transform duration-300 ease-out group-hover:scale-[1.08]"
                        />
                    </div>
                ) : (
                    <img
                        src={imageUrl}
                        alt={title}
                        loading="lazy"
                        onError={() => setErrored(true)}
                        className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                    />
                )
            ) : (
                <div
                    className={cn(
                        'flex h-full w-full items-center justify-center bg-gradient-to-br ring-1 ring-inset',
                        placeholder.bg,
                        placeholder.ring,
                    )}
                >
                    <span className={cn('text-5xl font-semibold tracking-tight opacity-90', placeholder.text)}>
                        {title[0]?.toUpperCase()}
                    </span>
                </div>
            )}
        </div>
    );
};

/**
 * Small rounded icon tile used in the compact "app card" layout (icon-style
 * galleries, coverFit:'contain'). Renders the cover image at icon scale on a
 * soft tinted backdrop; falls back to the letter avatar on missing/broken art.
 */
const GalleryIconTile: React.FC<{
    imageUrl?: string;
    title: string;
    placeholder: typeof PLACEHOLDER_GRADIENTS[number];
}> = ({ imageUrl, title, placeholder }) => {
    const [errored, setErrored] = useState(false);
    const showImage = !!imageUrl && !errored;
    return (
        <div
            className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset',
                placeholder.bg,
                placeholder.ring,
            )}
        >
            {showImage ? (
                <img
                    src={imageUrl}
                    alt={title}
                    loading="lazy"
                    onError={() => setErrored(true)}
                    className="h-6 w-6 object-contain transition-transform duration-300 ease-out group-hover:scale-110"
                />
            ) : (
                <span className={cn('text-base font-semibold', placeholder.text)}>
                    {title[0]?.toUpperCase()}
                </span>
            )}
        </div>
    );
};

/**
 * The cover image URL for one record, whatever shape its file value arrived in.
 *
 * ADR-0104 D3 wave 2 made the **stored** value of a `file`/`image`/`avatar`/
 * `video`/`audio` field an opaque `sys_file` id, which the read path expands
 * in place into `{ id, name, size, mimeType, url }`. So a spec-correct cover
 * reaches this component as an **object**, and the old `item[coverField] as
 * string` read resolved to no usable URL for every conforming record: the only
 * values that ever rendered a cover were the inline `data:` URIs and external
 * links ADR-0104 retired (objectui#3317).
 *
 * Shape handling is delegated to `readFileValues` — the platform's single
 * arbiter of file value shapes (`@object-ui/fields`, `widgets/file-value`) —
 * rather than re-derived here, so the gallery cover, the `image` cell renderer
 * and the edit-form widgets can never disagree about what a value means. It
 * accepts the expanded object, a legacy bare URL string (still valid during the
 * dual-mode window), and a still-bare `sys_file` id, which it resolves to the
 * stable `/files/:id` download endpoint rather than dropping — a bare reference
 * is what the read path leaves behind when it did not expand, and that endpoint
 * is directly usable as an `<img src>`. A value carrying no resolvable URL at
 * all yields `undefined`, which collapses the cover area instead of emitting a
 * broken `<img src>`.
 *
 * A `multiple` file field arrives as an array; its first entry is the cover.
 */
const resolveCoverUrl = (
    item: Record<string, unknown> | undefined,
    coverField: string,
): string | undefined => {
    const raw = item?.[coverField];
    // THE FLOOR by name (objectui#8496), no extension: a cover field holding
    // `[]` has no first entry either, so the four members are one answer here.
    if (isEmptyValue(raw)) return undefined;
    return readFileValues(raw)[0]?.url;
};

export const ObjectGallery: React.FC<ObjectGalleryProps> = (props) => {
    const { schema } = props;
    const context = useContext(SchemaRendererContext);
    const dataSource = props.dataSource || context?.dataSource;
    const boundData = useDataScope(schema.bind);

    const [fetchedData, setFetchedData] = useState<Record<string, unknown>[]>([]);
    const [loading, setLoading] = useState(false);

    /**
     * The object definition, and whether the read for THIS object has SETTLED —
     * one piece of state, through the shared hook (objectui#7903).
     *
     * `ObjectGallery` sat outside the set objectui#6482 converged
     * (`ObjectKanban`, `ObjectView`, `ObjectCalendar`, `ObjectTree`; `ObjectGantt`
     * at objectui#7225 ask 2, `ObjectTimeline` at objectui#7895) and nothing
     * marked it a deliberate exclusion. It still held the definition in a local
     * `useState` fed by its own metadata effect, with `objectDef` listed in the
     * record-fetch effect's dependency array below — so every object-bound
     * gallery load issued the record query TWICE: once before the definition
     * landed, with `buildExpandFields` seeing no fields and therefore carrying
     * no `$expand` at all, and once after.
     *
     * Measured on THIS component before the change (objectui#6482's per-component
     * standard — the cost differs by component), instrumented renderer, one mount
     * per hold, `getObjectSchema` held 0/1/2/3/4/5/6/7/8/9/10/15/25/50/100 ms,
     * with `ObjectCalendar` as a positive control in the same run: 2 `find` calls
     * with expand sets `[null, ['owner']]` at EVERY hold, the issue order always
     * `schema:issued, find(unexpanded), schema:settled, find(expanded)`, two
     * distinct painted states (raw foreign-key ids, then the expanded rows), 3
     * late writes into the card grid after the first paint, and a first paint
     * FLAT at 3-8 ms across the whole 0->100 ms sweep. The control read 1 `find`
     * carrying `['owner']`, one painted state, and a first paint that TRACKS the
     * hold (33-69 ms at 0-15 ms, 77 ms at +50, 161 ms at +100).
     *
     * ⚠️ This component's visible cost is a TWO-step paint, not the three-step
     * one `ObjectCalendar` (objectui#6453) and `ObjectTimeline` (objectui#7895)
     * each measured. Those two make `loading` an unconditional early return, so
     * the re-run's `setLoading(true)` drops them back to their placeholder
     * between the two paints. Here the early return is `loading && !items.length`
     * — once the first (raw) rows are in state the skeleton cannot come back —
     * so the user sees raw foreign-key ids replaced in place by the expanded
     * rows. Measured, not inherited: `skelAfter=false` at every hold.
     *
     * ⚠️ The gate below is only safe because this resolution SETTLES ON EVERY
     * EXIT (objectui#7232) — no source, no `getObjectSchema`, no object name, and
     * a read that threw alike. The hand-written effect it replaces returned
     * WITHOUT settling on all four, which cost nothing while nothing waited on it
     * and would hold a gated query open forever.
     *
     * ⛔ `dataSource` is passed unconditionally, NOT `hasInlineData ? undefined :
     * dataSource` the way `ObjectCalendar` and `ObjectGantt` pass it — the same
     * departure `ObjectTimeline` made, and it applies here for a stronger reason.
     * Those two read metadata only to expand a record query, so an inline data
     * set has nothing to wait for. This component reads the definition on EVERY
     * path, query or not: `buildEnrichedField` above reads `objectDef.fields` for
     * each visible field's type, options, currency, precision, scale and
     * reference target, and `getRecordDisplayName(objectDef, item)` below resolves each
     * card's title under ADR-0079. Disabling the read for authored `data` /
     * `bind` items would strip cell semantics and card titles off exactly the
     * paths that issue no query — a second, unasked-for change riding on a
     * fetch-sequencing fix.
     *
     * The key is `schema.objectName` — the object the record query itself names
     * (`dataSource.find(schema.objectName, …)` below) and the one the replaced
     * effect read. ⛔ Not `resolveRecordSourceObjectName`, the same departure
     * `ObjectTimeline` made, and again for a stronger reason: that reader's
     * second rung is a resolved `data` BLOCK (`dataConfig.provider === 'object'`),
     * and `ObjectGallerySchema['data']` is typed `Record<string, unknown>[]` — a
     * bare inline record array, not a provider config. This component calls
     * `getDataConfig` nowhere, so there is no second name to read; the ladder
     * would degenerate to `schema.objectName` with extra spelling. Gating on a
     * key the query does not use is exactly the stale-key mismatch
     * `useSettledSchema`'s render-time comparison exists to make unrepresentable.
     */
    const { ready: objectDefReady, def: objectDef } = useSettledSchema<any>(
        schema.objectName ?? '',
        // No cast: `useSettledSchema` declares `DataSource<any> | null |
        // undefined` and, since objectui#7912, that is exactly what the seam
        // hands over.
        dataSource,
    );

    // Permissions context, read here rather than inside the fetch effect below:
    // an effect's DEPENDENCY ARRAY is evaluated during render, so `perms` has
    // to be a binding that already exists by the time this component's render
    // reaches that effect (objectui#7429, same structural note PR #7229 /
    // PR #7428 recorded for `ListView`'s memo and `ObjectCalendar`'s effect).
    const perms = usePermissions();

    // --- NavigationConfig support ---
    const navigation = useNavigationOverlay({
        navigation: schema.navigation,
        objectName: schema.objectName,
        onRowClick: props.onRowClick ?? props.onCardClick,
    });

    // Resolve GalleryConfig with backwards-compatible fallbacks
    const gallery = schema.gallery;
    const coverField = gallery?.coverField ?? schema.imageField ?? 'image';
    const coverFit = gallery?.coverFit ?? 'cover';
    const cardSize = gallery?.cardSize ?? 'medium';
    // ADR-0079: honour an author-chosen title field, but DON'T fall back to the
    // literal `'name'`. When unset, each card's title is resolved via the
    // unified `getRecordDisplayName` (titleFormat → object.displayNameField →
    // type-aware derivation → `Record #<id>`), so a gallery over an object whose
    // name lives in e.g. `activity_name` shows the real name, not "Untitled".
    const titleField = gallery?.titleField ?? schema.titleField;
    const visibleFields = gallery?.visibleFields;

    // i18n: translate select-field option labels in card cells
    const { fieldLabel, fieldOptionLabel } = useSafeFieldLabel();
    // The empty state's `list.*` copy and the locale it resolves against
    // (objectui#12217): the same translation hook `ListView` draws it with.
    const { t } = useListViewTranslation();
    const displayLocale = useDisplayLocale();

    // Build an enriched FieldMetadata for a given field name so the shared
    // cell renderer pipeline (used by Detail/Grid/Related) receives the
    // same context: type, options, currency, precision, scale, reference
    // target, etc. This is what keeps card output visually aligned with the
    // record detail page.
    // The host predicate scope a card's declared deadline is judged in
    // (objectui#11815).
    const predicateScope = usePredicateScope();
    const buildEnrichedField = useCallback((fieldName: string) => {
      const def = objectDef?.fields?.[fieldName];
      const enriched: Record<string, any> = { name: fieldName };
      if (def) {
        if (def.type) enriched.type = def.type;
        if (def.label) enriched.label = def.label;
        if (def.options) enriched.options = def.options;
        if (def.currency) enriched.currency = def.currency;
        if (def.precision !== undefined) enriched.precision = def.precision;
        // `scale` is the member the number and percent cell renderers pad
        // decimals to (`precision` is the TOTAL digit count, never read for
        // decimal places). Without it a gallery card rendered a `scale: 2`
        // percent as `25%` beside a Grid/Detail `25.00%` (objectui#9575).
        // Same presence test the ObjectGrid and RelatedList builders use.
        if (def.scale !== undefined) enriched.scale = def.scale;
        // The author's digit-grouping hint rides beside `scale`, whose scale-0
        // heuristic it overrides in the number cell (objectui#11026).
        if (def.useGrouping !== undefined) enriched.useGrouping = def.useGrouping;
        // A percent field's declared `max` is its STORAGE statement: the percent
        // cell reads it through the spec's `percentScaleOf` (a fraction unless
        // `max` is above 1) instead of guessing from the value. Dropped here, a
        // whole-stored `50` (`max: 100`) would read `5000%` on a card beside
        // `50%` in the grid (objectui#11475). Same presence test as `scale`.
        if (def.max !== undefined) enriched.max = def.max;
        if (def.format) enriched.format = def.format;
        // The field's deadline declaration (objectui#11815): the date cells
        // paint overdue from `dueLike` alone, so without it a card's declared
        // deadline never reads overdue.
        if (def.dueLike !== undefined) enriched.dueLike = def.dueLike;
        // objectui#6837 half 2 — maintainer 2026-08-31: protocol normalization
        // belongs on the SERVER, the front end just executes the protocol.
        // `reference` is the only target spelling `@objectstack/spec`'s
        // `FieldSchema` declares; it refuses `reference_to` by name with its own
        // "did you mean -> `reference`?" rename. objectstack#13847 rewrites
        // stored `reference_to` on the serve path and in `os migrate meta`. A
        // legacy-only def is canonicalised ONCE at the ingestion choke point
        // (`normalizeSchemaReferenceKeys`, which warns in dev) — never here.
        const refTarget = (def as any).reference;
        // The cell reads `reference` alone (objectui#11070 round 4).
        if (refTarget) enriched.reference = refTarget;
        if ((def as any).reference_field) enriched.reference_field = (def as any).reference_field;
      }
      // Route the field label through the i18n dictionary so the auto-
      // prepended labels on number/currency cards show up translated.
      if (schema.objectName) {
        const fallback = String(enriched.label ?? fieldName);
        enriched.label = fieldLabel(schema.objectName, fieldName, fallback);
      }
      // Translate select option labels via i18n, falling back to raw labels.
      if (schema.objectName && Array.isArray(enriched.options)) {
        enriched.options = enriched.options.map((opt: any) => {
          const value = String(opt?.value ?? opt);
          const fallback = String(opt?.label ?? value);
          return { ...opt, value, label: fieldOptionLabel(schema.objectName!, fieldName, value, fallback) };
        });
      }
      return enriched;
    }, [objectDef, schema.objectName, fieldLabel, fieldOptionLabel]);

    // objectui#10623 — the data-invalidation bus (`notifyDataChanged` from
    // `@object-ui/react`), read the objectui#10494 way: the nonce moves when a
    // write to the object this gallery QUERIES is declared, and the fetch
    // effect below names it, so the cards are re-read in place. The grid stays
    // mounted through the re-read (the placeholder below is drawn only while
    // there are no items yet), so collapsed groups and scroll survive.
    // Subscribed only when the gallery fetches for itself: host `data`,
    // authored `schema.data` and bound rows are not this effect's query.
    const fetchesForItself = !!schema.objectName && !boundData && !schema.data && !props.data;
    const invalidationNonce = useDataInvalidation(fetchesForItself ? schema.objectName : undefined);

    // objectui#10666 — the node's own `filter`, with every placeholder
    // (`{current_user_id}`, `{current_org_id}`, the date macros) resolved ONCE
    // through `@object-ui/core`'s shared `resolveFilterPlaceholders`, against
    // the session scope the host provides, and HELD by structure (see
    // `useResolvedFilter` in `@object-ui/react`, the hold `ListView` has used
    // since objectui#10607). A directly authored gallery sent the literal token
    // before; a gallery rendered as a `list-view` child was already handed a
    // resolved filter, and resolving it again changes nothing. The query and
    // the fetch effect's dependency list below read THIS, never the raw
    // `schema.filter`, so the effect does not re-run on every render.
    const filterScope = useFilterScope();
    const authoredFilter = useResolvedFilter(schema.filter, filterScope);

    useEffect(() => {
        let isMounted = true;

        if (props.data && Array.isArray(props.data)) {
            setFetchedData(props.data);
            return;
        }

        const fetchData = async () => {
            if (!dataSource || typeof dataSource.find !== 'function' || !schema.objectName) return;
            if (isMounted) setLoading(true);
            try {
                // Auto-inject $expand for lookup/master_detail fields.
                //
                // [objectui#7429] FIELD-LEVEL SECURITY ON `$expand` — the same
                // gate objectui#7215 / PR #7229 put on the two projection sites
                // in its scope, and objectui#7230 / PR #7428 applied unchanged
                // at four more; `ListView.tsx` in this same package already
                // carries it. `$select` on a denied lookup asks the server for
                // a bare foreign key; `$expand` asks it to RESOLVE the relation
                // and return the related record, the larger of the two
                // requests.
                //
                // THIS SITE PASSES NO COLUMN LIST, which makes it the sharp
                // one: `buildExpandFields` reads an absent column list as "no
                // column restriction" and falls back to EVERY declared
                // relation on the object, denied ones included. A standalone
                // gallery therefore asks for the maximum possible set by
                // default, not by configuration.
                //
                // Graded as objectui#7215 graded it, by measurement rather
                // than assumption: against ObjectStack this is
                // defence-in-depth, because `plugin-security`'s
                // `FieldMasker.maskRecord` does `delete result[field]` on
                // every unreadable key and objectql's expand path writes the
                // resolved record back under THAT SAME KEY, so one statement
                // removes the expanded object and the bare id alike; the
                // expansion sub-read itself takes the referenced object's full
                // CRUD + RLS + FLS treatment (objectstack#7626). It is
                // load-bearing for a backend that does not strip.
                //
                // THE GATE IS ON THE HELPER'S OUTPUT, and on this site the
                // alternative is not merely unsound but unreachable: the call
                // passes `undefined`, so there is no input to gate. Gating the
                // output also gives the required ordering structurally:
                // `buildExpandFields` returns a subset of the object's
                // DECLARED reference-bearing fields, so every name judged here
                // is declared by construction and the "`checkField` answers
                // false for an undeclared key" trap cannot be reached. Pinned
                // in `__tests__/ObjectGallery.expandFls-7429.test.tsx`.
                //
                // Deferral matches every other gate on this path: an
                // unanswered policy filters nothing, and `perms` is in this
                // effect's dependency list, so the expansion is rebuilt the
                // moment the answer arrives.
                const expandable = buildExpandFields(objectDef?.fields);
                const expand = !perms?.isLoaded
                  ? expandable
                  : expandable.filter((f) => perms.checkField(schema.objectName as string, f, 'read'));
                const results = await dataSource.find(schema.objectName, {
                    // `ObjectGallerySchema.filter` is declared `unknown` — the
                    // one view schema in `@object-ui/types` whose `filter` is
                    // not `any[]` — and its docblock says it is "forwarded
                    // verbatim as `$filter`". Typing the adapter above makes
                    // `find`'s parameter real, so the verbatim forward has to
                    // name the parameter's own type instead of riding on
                    // `unknown`. Asserted, not coerced. The value is the
                    // node's filter with its placeholders resolved
                    // (objectui#10666); a filter that carries none reaches
                    // the query structurally unchanged.
                    $filter: authoredFilter as QueryParams['$filter'],
                    ...(expand.length > 0 ? { $expand: expand } : {}),
                });

                // `find` now DECLARES `QueryResult<any>`, whose only required
                // member is `data` (objectui#7912 typed the adapter). This
                // block predates that declaration and sniffs three envelopes:
                // a bare array, `{ records }`, and the declared `{ data }`.
                //
                // Every branch is kept and every runtime path is unchanged. The
                // declared value is widened ONCE, here, so the existing checks
                // keep doing their own narrowing instead of being deleted on
                // the strength of a declaration: whether any adapter really
                // answers with the two UNDECLARED envelopes is a question about
                // the adapters, and answering it is not this card's business.
                const envelope: unknown = results;
                let data: Record<string, unknown>[] = [];
                if (Array.isArray(envelope)) {
                    data = envelope;
                } else if (envelope && typeof envelope === 'object') {
                    const r = envelope as Record<string, unknown>;
                    if (Array.isArray(r.records)) {
                        data = r.records as Record<string, unknown>[];
                    } else if (Array.isArray(r.data)) {
                        data = r.data as Record<string, unknown>[];
                    }
                }

                if (isMounted) {
                    setFetchedData(data);
                }
            } catch (e) {
                console.error('[ObjectGallery] Fetch error:', e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        if (fetchesForItself) {
            // ⭐ objectui#7903 — the object definition GATES this query; it does
            // not refine it afterwards. `objectDef` stays in the dependency list
            // below and the two are ONE mechanism, not two: the dependency is
            // what makes this effect re-run when the definition lands, and this
            // branch is what stops the first run from spending a query before it
            // has. Removing either half alone restores the double fetch.
            //
            // Scoped to the branch that actually issues the query. The authored
            // (`props.data` / `schema.data`) and bound (`bind`) paths never query,
            // so gating them would hold nothing useful — and this component still
            // reads the definition on those paths (cell semantics and ADR-0079
            // card titles), which is why the resolution above is not disabled for
            // them.
            if (!objectDefReady) {
                // ⚠️ Hold the placeholder across the gate window. `loading` starts
                // `false` here and was only ever flipped inside `fetchData`, so a
                // bare `return` would leave the gallery showing its empty state
                // — a FALSE one — for the whole metadata read,
                // where before the gate it showed the loading placeholder. The
                // two siblings get this for free from their own initial state
                // (`ObjectCalendar` starts `loading` at `true`; `ObjectTimeline`
                // computes the same thing in a lazy initializer); this component
                // does not, so the same guarantee is stated here, in the one
                // branch that knows a query is coming.
                if (isMounted) setLoading(true);
                return;
            }
            fetchData();
        }
        return () => { isMounted = false; };
    }, [schema.objectName, dataSource, boundData, schema.data, authoredFilter, props.data, objectDefReady, objectDef, perms, fetchesForItself, invalidationNonce]);

    const items: Record<string, unknown>[] = props.data || boundData || schema.data || fetchedData || [];

    // Hide the placeholder cover area when no item actually has an image.
    // Without this, gallery cards on data sets that have no `coverField` (or
    // an explicit one but no populated values) render with a giant empty
    // letter-placeholder block that dwarfs the actual content. By collapsing
    // it when there's nothing to show, the cards become information-dense.
    // Resolved through the very same `resolveCoverUrl` each card renders with:
    // when this predicate and the per-card read disagree about what counts as a
    // cover, the area collapses for values that would have rendered fine (the
    // objectui#3317 failure — a string-only test against an expanded object).
    const hasAnyCover = useMemo(
        () => items.some((it) => !!resolveCoverUrl(it, coverField)),
        [items, coverField],
    );
    // Show the cover area only when at least one record has a non-empty
    // cover image value. Previously, having `coverField` configured was
    // enough to force the cover area on — which produced giant letter-
    // placeholder blocks (200×200 gradients with a single character) on
    // datasets like Contacts where the field is declared but unpopulated.
    // The configured-but-empty state now matches the unconfigured state:
    // collapse to a compact card with just the title + visible fields.
    const showCoverArea = hasAnyCover;

    // --- Grouping support ---
    const groupingFields = schema.grouping?.fields;
    const isGrouped = !!(groupingFields && groupingFields.length > 0);

    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    // Initialize collapsed state from grouping config
    const defaultCollapsed = useMemo(() => {
        if (!groupingFields) return false;
        return groupingFields.some((f) => f.collapsed);
    }, [groupingFields]);

    const toggleGroup = useCallback((key: string) => {
        setCollapsedGroups((prev) => ({
            ...prev,
            [key]: prev[key] !== undefined ? !prev[key] : !defaultCollapsed,
        }));
    }, [defaultCollapsed]);

    const groupedItems = useMemo(() => {
        if (!isGrouped || !groupingFields) return [];
        const map = new Map<string, { label: string; items: Record<string, unknown>[] }>();
        const keyOrder: string[] = [];
        for (const item of items) {
            const key = groupingFields.map((f) => String(item[f.field] ?? '')).join(' / ');
            if (!map.has(key)) {
                const label = groupingFields
                    .map((f) => {
                        const val = item[f.field];
                        return val !== undefined && val !== null && val !== '' ? String(val) : '(empty)';
                    })
                    .join(' / ');
                map.set(key, { label, items: [] });
                keyOrder.push(key);
            }
            map.get(key)!.items.push(item);
        }
        const primaryOrder = groupingFields[0]?.order ?? 'asc';
        keyOrder.sort((a, b) => {
            const cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            return primaryOrder === 'desc' ? -cmp : cmp;
        });
        return keyOrder.map((key) => {
            const entry = map.get(key)!;
            const collapsed = key in collapsedGroups ? collapsedGroups[key] : defaultCollapsed;
            return { key, label: entry.label, items: entry.items, collapsed };
        });
    }, [items, groupingFields, isGrouped, collapsedGroups, defaultCollapsed]);

    if (loading && !items.length) return <div className="p-4 text-sm text-muted-foreground">Loading Gallery...</div>;
    // objectui#12217 — the empty state `ListView` draws for a grid, through the
    // one shared component. Under `ListView` this branch is not reached: the
    // view draws it itself, with the view's authored `emptyState` and the
    // toolbar's search and filters. Standalone, the gallery says what it
    // knows: the `object-gallery` node declares no `emptyState`, there is no
    // search box, user filter or add-record control here, and its own
    // `filter` emptied the list only when the gallery issued the query.
    if (!items.length) {
        return (
            <ListEmptyState
                hasUserQuery={false}
                hasBaseFilter={fetchesForItself && hasDeclaredFilter(authoredFilter)}
                t={t}
                displayLocale={displayLocale}
            />
        );
    }

    // Detail rows (description / tags / badges) shared by both card layouts.
    const renderFields = (item: Record<string, unknown>) => {
        if (!visibleFields || visibleFields.length === 0) return null;
        return (
            <div className="mt-1.5 space-y-1">
                {visibleFields.map((field) => {
                    const value = (item as any)[field];
                    // THE FLOOR by name (objectui#8496), no extension: a card
                    // row is OMITTED for a valueless field rather than drawn
                    // with a placeholder, so this asks the floor and nothing
                    // more. ⚠️ `[]` is a MEMBER, and it used to fall through
                    // here: the row survived and the shared renderer painted
                    // the em-dash affordance (objectui#8481) under a label, on
                    // a card that omits every other valueless field. ⛔ Do NOT
                    // trim — `'   '` is deliberately a value on this surface;
                    // only `record:details` and `RelatedList` extend that far.
                    if (isEmptyValue(value)) return null;
                    const enriched = buildEnrichedField(field);
                    const rendererType = resolveCellRendererType(enriched as any) || enriched.type || 'text';
                    const CellRenderer = getCellRenderer(rendererType);
                    // Auto-prepend a muted label for low-semantic field types
                    // (bare numbers/currency/percent) so a card row isn't an
                    // unlabeled "5,000,000". Types with inherent visual context
                    // (badges, links, dates) stay unlabeled for a clean look.
                    const fieldLabel: string | undefined =
                        (enriched as any)?.label && String((enriched as any).label).trim()
                            ? String((enriched as any).label)
                            : undefined;
                    const showLabel =
                        fieldLabel != null &&
                        LOW_SEMANTIC_RENDERER_TYPES.has(rendererType);
                    return (
                        <div
                            key={field}
                            className={cn(
                                'text-xs text-muted-foreground truncate [&_*]:!text-xs',
                                showLabel && 'flex items-baseline gap-1.5',
                            )}
                            onClick={(e) => {
                                // Don't navigate when interacting with rich cell
                                // content (email/phone/url links) inside a card.
                                const target = e.target as HTMLElement;
                                if (target.closest('a,button')) e.stopPropagation();
                            }}
                        >
                            {showLabel && (
                                <span className="shrink-0 text-muted-foreground/70 tabular-nums">
                                    {fieldLabel}
                                </span>
                            )}
                            <CellRenderer
                                value={value}
                                field={enriched as any}
                                deadlineSettled={isDeadlineSettled(objectDef?.fields?.[field], item, { scope: predicateScope, fields: objectDef?.fields })}
                            />
                        </div>
                    );
                })}
            </div>
        );
    };

    /**
     * The heading CONTENT of one card (objectui#12188).
     *
     * A title field of the reference-bearing family (`isExpandableFieldType`,
     * the `@object-ui/core` set: `lookup`, `master_detail`, `tree`, `user`)
     * renders through the cell renderer `renderFields` uses, enriched by the
     * same `buildEnrichedField` — the formatter the grid and this card's own
     * detail rows already draw that value with. Its value is the related
     * RECORD once `$expand`-ed (and a bare id when not), so the plain-text
     * heading used to print `[object Object]` (or the raw id) where the grid
     * printed the person's name. The cell names an embedded record and
     * resolves a bare id by its own fetch; ⛔ no second lookup-to-label path
     * lives here.
     *
     * Every other title — and a reference field with no value, or no
     * definition to type it — stays the TEXT `title`, byte for byte, so a
     * plain text heading is unchanged.
     */
    const renderTitleContent = (item: Record<string, unknown>, title: string): React.ReactNode => {
        if (titleField == null) return title;
        const value = item[titleField];
        if (isEmptyValue(value)) return title;
        const enriched = buildEnrichedField(titleField);
        if (!isExpandableFieldType(enriched)) return title;
        const CellRenderer = getCellRenderer(resolveCellRendererType(enriched));
        return <CellRenderer value={value} field={enriched as any} />;
    };

    const renderCard = (item: Record<string, unknown>, i: number) => {
        const id = (item.id ?? item._id ?? i) as string | number;
        // The title TEXT — the heading's tooltip, the cover / icon tile and the
        // placeholder seed all need a string. One call to the unified ADR-0079
        // resolver: its `titleField` option honours the author's field first
        // (an embedded record resolving through its display chain rather than
        // stringifying to `[object Object]`, objectui#12188) and otherwise
        // falls back to the object-level precedence, as before.
        const title = getRecordDisplayName(objectDef, item, { titleField });
        const titleContent = renderTitleContent(item, title);
        const imageUrl = resolveCoverUrl(item, coverField);
        const placeholder = pickPlaceholderGradient(String(id) + '|' + title);

        const cardClass = cn(
            'group relative overflow-hidden border-border/60 bg-card',
            'transition-all duration-200 ease-out',
            'hover:shadow-lg hover:border-border hover:-translate-y-0.5',
            (props.onCardClick || props.onRowClick || schema.navigation) && 'cursor-pointer',
        );

        // Icon-style galleries (coverFit:'contain' — app marketplaces, logo
        // catalogues) read far better as a compact "app card": a small rounded
        // icon tile beside the title with details below, instead of a giant
        // glyph stretched across a photo-sized cover. Photographic galleries
        // (coverFit:'cover') keep the full-bleed cover layout.
        const isAppCard = showCoverArea && coverFit === 'contain';

        if (isAppCard) {
            return (
                <Card key={id} role="listitem" className={cardClass} onClick={(e) => navigation.handleClick(item, e)}>
                    <div
                        aria-hidden
                        className={cn('absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r', placeholder.bg)}
                    />
                    <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                            <GalleryIconTile imageUrl={imageUrl} title={title} placeholder={placeholder} />
                            <div className="min-w-0 flex-1">
                                <h3 className="font-semibold tracking-tight truncate text-sm leading-tight text-foreground" title={title}>
                                    {titleContent}
                                </h3>
                                {renderFields(item)}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            );
        }

        return (
            <Card key={id} role="listitem" className={cardClass} onClick={(e) => navigation.handleClick(item, e)}>
                {/* Top accent strip: only for text-only cards (no cover area). */}
                {!showCoverArea && (
                    <div
                        aria-hidden
                        className={cn('absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r', placeholder.bg)}
                    />
                )}
                <GalleryCover
                    imageUrl={imageUrl}
                    title={title}
                    coverFit={coverFit}
                    aspectClass={ASPECT_CLASSES[cardSize]}
                    placeholder={placeholder}
                    hidden={!showCoverArea}
                />
                <CardContent className={cn('p-3', showCoverArea && 'border-t border-border/60')}>
                    <h3 className="font-semibold tracking-tight truncate text-sm leading-tight text-foreground" title={title}>
                        {titleContent}
                    </h3>
                    {renderFields(item)}
                </CardContent>
            </Card>
        );
    };

    const renderGrid = (gridItems: Record<string, unknown>[]) => (
        <div
            className={cn('grid gap-4 p-4 auto-rows-min content-start', GRID_CLASSES[cardSize], schema.className)}
            role="list"
        >
            {gridItems.map((item, i) => renderCard(item, i))}
        </div>
    );

    return (
        <>
            {isGrouped ? (
                <div className="space-y-2">
                    {groupedItems.map((group) => (
                        <div key={group.key} className="border rounded-md">
                            <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-left bg-muted/50 hover:bg-muted transition-colors"
                                onClick={() => toggleGroup(group.key)}
                            >
                                {group.collapsed
                                    ? <ChevronRight className="h-4 w-4 shrink-0" />
                                    : <ChevronDown className="h-4 w-4 shrink-0" />}
                                <span>{group.label}</span>
                                <span className="ml-auto text-xs text-muted-foreground">{group.items.length}</span>
                            </button>
                            {!group.collapsed && renderGrid(group.items)}
                        </div>
                    ))}
                </div>
            ) : (
                renderGrid(items)
            )}
            {navigation.isOverlay && (
                <NavigationOverlay {...navigation} title="Gallery Item">
                    {(record) => {
                        // objectui#13458 — the same payload the grid, tree, kanban,
                        // calendar and gantt overlays mount, in place of a raw
                        // key/value dump: declared labels, typed widgets, `hidden`
                        // honoured, the object's field order. Read-only, as on the
                        // grid and the tree: capability is handler presence, and
                        // this view hands the panel no write path.
                        const recordId = record.id ?? record._id;
                        if (schema.objectName && (typeof recordId === 'string' || typeof recordId === 'number')) {
                            return (
                                <div className="px-6 pt-6 pb-6">
                                    <RecordDetailPanel
                                        record={record}
                                        objectName={schema.objectName}
                                        recordId={recordId}
                                        dataSource={dataSource ?? undefined}
                                        objectSchema={objectDef}
                                        onClose={navigation.close}
                                    />
                                </div>
                            );
                        }
                        // No addressable record (inline rows with no object name or
                        // id): the panel needs both, so the plain reading of the row
                        // is the answer.
                        return (
                            <div className="space-y-3">
                                {Object.entries(record).map(([key, value]) => (
                                    <div key={key} className="flex flex-col">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                            {key.replace(/_/g, ' ')}
                                        </span>
                                        <span className="text-sm">{String(value ?? '—')}</span>
                                    </div>
                                ))}
                            </div>
                        );
                    }}
                </NavigationOverlay>
            )}
        </>
    );
};

ComponentRegistry.register('object-gallery', ObjectGallery, {
    namespace: 'plugin-list',
    label: 'Gallery View',
    category: 'view',
});
