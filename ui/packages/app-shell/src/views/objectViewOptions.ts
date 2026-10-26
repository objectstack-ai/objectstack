/**
 * The view-options family of the Console `ObjectView` (`./ObjectView.tsx`):
 * the per-kind `options` blocks it hands `ListView`, the stored legacy bag,
 * the by-value options comparison and the view-patch dispatcher, moved out of
 * that file verbatim (objectstack#25992, slice 2). `ObjectView.tsx` re-exports
 * every name it exported before.
 */

import { detectStatusField } from '@object-ui/types';

/**
 * The `options.timeline` config this page hands to `ListView`.
 *
 * Deliberately does NOT resolve the date axis. `ListView.resolveTimelineDateBinding`
 * is the single read-site that decides which field a timeline buckets by, and it
 * reads the calendar binding when the view carries no timeline one. This face used
 * to fabricate `startDateField: 'due_date'` for every object view — a field name
 * the view never declared and most objects do not have — which both looked like a
 * real binding downstream and, because it is always present, shadowed the calendar
 * fallback entirely. The result on a calendar-bound view was a Timeline the
 * switcher offered and the renderer bucketed wholly into "No date" (objectui#3129).
 *
 * What stays here is the view's OWN declared config, floored at `'name'`. An
 * object-level `objectDef.titleField` leg used to sit in the middle of that
 * chain; it was removed in objectui#6557 because `@objectstack/spec`'s object
 * schema is a `strictObject` that REJECTS the key with `unrecognized_keys`, so
 * no legal object metadata could ever reach it (objectui#6531 established the
 * measurement, and dropped the twin read inside `getRecordDisplayName`).
 *
 * ⚠️ WHAT THE SIBLING BRANCHES BELOW ACTUALLY DO (`5f4514f7b`). The sentence
 * above used to end "— the same two-rung shape the calendar and gantt branches
 * below already use", and for gantt that was FALSE the whole time it stood: the
 * gantt branch floored `startDateField` / `endDateField` at `'start_date'` /
 * `'end_date'`, which is precisely the one-rung fabrication this note declares
 * retired. A note is the authority the next fixer consults, so it vouched for
 * the lines that were broken. Each branch is therefore stated as MEASURED, not
 * as a family:
 *
 *   - `calendarViewOptions` below — forwards a declared block or emits no
 *     `calendar` key at all; it never floors a date axis (objectui#7029).
 *   - `ganttViewOptions` below — forwards the declared block, title floored at
 *     `'name'`, and invents neither date field. Its `'start_date'` / `'end_date'`
 *     floors were deleted by `5f4514f7b`; that is what makes `ObjectGantt`'s
 *     own "Gantt configuration required" screen reachable from this route.
 *   - the TIMELINE axis at the two SIBLING FACES — `plugin-list/ListView.tsx`
 *     and `plugin-view/ObjectView.tsx`. Both floored `startDateField` at
 *     `'created_at'`, the very literal objectui#3129 retired HERE, and
 *     `ListView` carried it as a stated DECISION ("`created_at` stays the last
 *     resort for a view that declares no date axis anywhere") — two faces
 *     holding documented and OPPOSITE postures on one field name. That is what
 *     `5f4514f7b` routed to a single ruling instead of settling per-face, and
 *     the ruling (2026-09-01, 总监批 #28) answered it as house posture:
 *     日期轴永不虚构 — a date axis is never fabricated. Its step ③ deleted both
 *     floors, so all three faces now forward a declared axis or none, and
 *     `ObjectTimeline`'s own refusal screen (step ①, objectui#7459) is reachable
 *     from every one of them. This note no longer describes only THIS face.
 *
 * Exported for the regression suite.
 */
export function timelineViewOptions(viewDef: any): Record<string, unknown> {
    // The spec key only. objectui#6152 round 14 retired the pre-#2231
    // `timeline.dateField` rung: every list-view door refuses the alias by name,
    // and `ListView` no longer reads it either.
    const declaredStart = viewDef?.timeline?.startDateField;
    return {
        // Spread the full view-defined timeline config first so the spec fields
        // (startDateField/endDateField/groupByField/colorField/scale) survive.
        ...(viewDef?.timeline || {}),
        // Only ever restate a binding the view actually declared.
        ...(declaredStart ? { startDateField: declaredStart } : {}),
        titleField: viewDef?.timeline?.titleField || 'name',
        // objectui#6152 round 12: no `descriptionField`. The spec's timeline block
        // has no such member, the bag refuses it, and nothing drew it: it landed
        // only in the generated node's nested block, which `ObjectTimeline` never
        // reads for a description (measured on objectui#6152, report 6070437445).
    };
}

/**
 * The `options.calendar` config this page hands to `ListView` — or NOTHING.
 *
 * objectui#7029 (ruled on objectstack#13748, director batch #19, option A).
 * This face used to fabricate `startDateField: 'due_date'` and
 * `titleField: 'name'` for EVERY object view, declared or not. Downstream that
 * is indistinguishable from a real binding, and it is what made the calendar
 * renderer's own refusal screen ("Calendar configuration required…",
 * `ObjectCalendar.tsx`) unreachable from this route: the renderer decides by
 * asking whether a start-date binding is PRESENT, and this face always said
 * yes. Measured on hotcrm's `crm_leave_request` (real fields `start_date` /
 * `end_date`, no `calendar:` block): all nine records piled onto today's cell
 * with titles resolved through the display-name chain — a plausible, fully
 * wrong screen with zero signal to the author.
 *
 * The same fabrication also fed two gates that read this bag:
 * `ListView.availableViews` offered the Calendar toggle for every object view,
 * and `resolveTimelineDateBinding` accepts a calendar binding as a legitimate
 * timeline axis — so the invented name silently answered for the Timeline
 * switcher too.
 *
 * What stays is the view's OWN declared block, forwarded verbatim (spread, not
 * whitelisted, so every spec key survives), and `undefined` when the view
 * declared none. Exactly the shape the sibling faces already converged on:
 * `timelineViewOptions` above (objectui#3129 retired this very literal from the
 * timeline axis), the kanban branch's `detectStatusField` (ADR-0085, "never
 * invents a field the object doesn't have"), and `defaultCalendarFromObject`
 * in `InterfaceListPage` (a binding or `undefined`, never a guess).
 *
 * ⚠️ A view that carried no `calendar:` block and happened to sit on an object
 * with a real `due_date` field was rendering by luck; it now reaches the
 * refusal screen instead. That is the ruled loud-over-silent direction.
 *
 * Exported for the regression suite.
 */
export function calendarViewOptions(viewDef: any): Record<string, unknown> | undefined {
    const declared = viewDef?.calendar;
    if (!declared || typeof declared !== 'object') return undefined;
    // Forward what the author wrote — nothing invented, nothing floored.
    return { ...declared };
}

/**
 * The `options.gantt` config this page hands to `ListView`.
 *
 * `5f4514f7b` — the same class objectui#7029 removed from the calendar branch,
 * reported separately by PR #7062 rather than fixed alongside it. This face used
 * to floor `startDateField` at `'start_date'` and `endDateField` at `'end_date'`
 * for EVERY object view, declared or not — field names no view had written and
 * most objects do not carry. Downstream that is indistinguishable from a real
 * binding, and it is what made `ObjectGantt`'s own refusal screen ("Gantt
 * configuration required. Please specify startDateField, endDateField, and
 * titleField.") unreachable from this route: `getGanttConfig` takes its flat
 * branch as soon as BOTH date props are present, and this face always supplied
 * both. It also answered the ADR-0047 capability gate in `ListView.availableViews`
 * (`schema.options?.gantt?.startDateField`), so the Gantt toggle was live on
 * every object view in the product.
 *
 * ⚠️ MEASURED BEFORE THE DELETION, because #7029's mechanic is only correct
 * where a refusal path exists: `ObjectGantt` REFUSES an absent binding — it does
 * not render empty and does not throw. Pinned as the seam in
 * `plugin-gantt/src/ObjectGantt.unconfiguredRefusal-7070.test.tsx`.
 *
 * What stays is the view's OWN declared block, spread whole so every spec key
 * the renderer reads survives (parentField/typeField for the summary→step
 * hierarchy, baseline*, groupByField, resourceView/assignee*, tooltipFields,
 * quickFilters, …) — a bare whitelist here once dropped every field past
 * colorField and flattened the chart. `titleField` keeps its `'name'` floor:
 * that is a display-name default, not a date axis, and it is the same rung
 * `timelineViewOptions` above carries.
 *
 * Exported for the regression suite.
 */
export function ganttViewOptions(viewDef: any): Record<string, unknown> {
    return {
        ...(viewDef?.gantt || {}),
        // Only ever restates what the view declared — no date field is floored.
        titleField: viewDef?.gantt?.titleField || 'name',
    };
}

/**
 * The `options.gallery` config this page hands to `ListView`.
 *
 * objectui#7547 — the last surviving member of the objectui#7029 / `5f4514f7b` /
 * #7500 class on this face. It floored `imageField` at `'image'` for EVERY
 * object view, declared or not: a cover binding no view had written, on a field
 * name most objects do not carry.
 *
 * ⚠️ WHAT THAT LITERAL ACTUALLY DID, which is not what it looks like. The
 * screen damage was small — `ObjectGallery` resolves the cover per record and
 * COLLAPSES the cover area when no record yields one, so an invented `'image'`
 * degraded to a gallery of coverless cards. The damage was to the GATE. This
 * bag feeds `ListView.availableViews`, whose gallery check reads
 * `schema.options?.gallery?.imageField`; a value that is always present makes
 * that check answer YES for every object view that whitelists `gallery`, so
 * ADR-0047's whitelist ∩ resolvable — the mechanism that exists to stop a
 * visualization being offered with nothing behind it — was answering about a
 * name this file wrote rather than one the author did. Gallery was offered
 * without a block, and stayed watchable only because the renderer happens to
 * degrade politely. That is a coincidence, not a design, and it is the same
 * second-order effect objectui#7029 measured for `calendar` and `5f4514f7b`
 * for `gantt`.
 *
 * ⚠️ MEASURED BEFORE THE DELETION, the discipline `5f4514f7b` wrote down:
 * #7029's mechanic — delete the literal, let the read site answer — is only
 * correct where the read site's answer is honest. `ObjectGallery` floors its
 * own `coverField` at `'image'` too, and that rung STAYS: it is the component's
 * own decision about an unconfigured record, and it is honest because the cover
 * area collapses when the guess yields nothing. What this face must not do is
 * pre-empt that decision and light the capability gate on the way past.
 *
 * What stays here is the view's OWN declared block, spread whole so every spec
 * key survives (`cardSize` / `visibleFields` / `coverFit` / …), the cover
 * binding under `coverField` BUT ONLY WHEN ONE WAS DECLARED, and the
 * `titleField` `'name'` floor — a display-name default, not a binding, exactly
 * as `ganttViewOptions` above keeps it.
 *
 * objectui#6152 round 12 (seat answer Q1 → A): the legacy `imageField` is no
 * longer written beside `coverField`. `@object-ui/types` judges this bag as the
 * spec's list overlay judges it, and that refuses `options.gallery.imageField`
 * by name. The gate the paragraph above describes learned
 * `options.gallery.coverField` in the same round, so the toggle still lights
 * from what this writes and still stays dark when the view declared no cover.
 *
 * objectui#6152 round 14: the legacy READ is retired too. The cover binding is
 * read from the spec's `coverField` alone, so a stored `gallery.imageField`
 * binds no cover here, offers no Gallery toggle, and leaves `ObjectGallery` on
 * its own `'image'` floor.
 *
 * Exported for the regression suite.
 */
export function galleryViewOptions(viewDef: any): Record<string, unknown> {
    const gallery = viewDef?.gallery;
    // The cover binding goes out under the spec's `coverField` ONLY, read from
    // `coverField` ONLY, and is never invented. objectui#6152 round 12 dropped the
    // legacy `imageField` this used to cross-fill beside it, and round 14 retired
    // the alias rung that still READ it.
    const declaredCover = gallery?.coverField;
    return {
        ...(gallery || {}),
        ...(declaredCover ? { coverField: declaredCover } : {}),
        // Spelled through `viewDef` rather than the `gallery` local above, and
        // that is load-bearing: `ObjectView.titleFieldConvergence.test.tsx`
        // (objectui#6557) pins all six `titleField` / `labelField` seams to ONE
        // expression shape — a chain of VIEW-declared rungs floored at 'name',
        // with `viewDef` as the mechanical proxy for "view-declared". Reading
        // the local here still resolves the same value but blinds that scan to
        // the thing it hunts, so the seam keeps the family spelling.
        titleField: viewDef?.gallery?.titleField || 'name',
    };
}

/**
 * The view-level KANBAN block this face forwards — the fifth member of the
 * `timelineViewOptions` / `calendarViewOptions` / `ganttViewOptions` /
 * `galleryViewOptions` family above, and the last one still inlined as an
 * anonymous IIFE inside the schema literal (objectui#8193).
 *
 * ⭐ THE LANE KEY IS `groupByField`, THE SPEC'S OWN SPELLING. This used to emit
 * the legacy `groupField` alias instead — never the canonical key, even though
 * it already READ the canonical key first. The sibling producer
 * `defaultKanbanFromObject` (`InterfaceListPage.tsx`) had migrated already and
 * left the reasoning next to itself — "that read-site now prefers the spec key,
 * so one key is enough" — but this twin twelve hundred lines away was not
 * carried along, so ONE producer surface spoke two vocabularies for one concept
 * depending on which entry point you arrived through.
 *
 * ⚠️ objectui#8193 changed only what this face WRITES; the alias READS stayed
 * until objectui#6152 round 14 retired them here and in `ListView` alike. The
 * lane is read from `groupByField` alone now, so a stored `kanban.groupField`
 * no longer names it: the lane falls to the object's declared lifecycle, as for
 * a view that names none.
 *
 * ⚠️ WRITING THE CANONICAL KEY HERE REQUIRED THE GATE TO LEARN IT, and that is
 * the half a reader will not guess from this file. `ListView.availableViews`
 * consulted the `options.<kind>` bag for the LEGACY spelling only
 * (`schema.options?.kanban?.groupField`), so emitting `groupByField` alone made
 * the Kanban capability stop resolving and the toggle vanish from every object
 * view — measured, not reasoned: `{groupBy, groupField}` offered Kanban, and
 * `{groupBy, groupByField}` did not. The gate now reads both spellings out of
 * the bag, the same one-question-two-sites repair objectui#5042 made for `map`
 * and objectui#7544 for `chart`. Pinned in `ObjectView.kanbanLane-8193` here
 * and in `ListView.kanbanOptionsBagCanonical-8193` in `plugin-list`.
 *
 * ⭐ `groupBy` IS RETIRED HERE (objectui#8213) — the THIRD spelling of the one
 * concept this expression already writes canonically. Measured against
 * `@objectstack/spec` 17.3.0's strict `KanbanConfigSchema`, which declares
 * `groupByField` / `summarizeField` / `columns` and refuses `groupBy` BY NAME,
 * on a call where one control fires (`zzzBogusKey` is refused by name) and
 * another accepts (`groupByField` alone draws no `unrecognized_keys`). Upstream
 * knows the OTHER alias by name — probing `groupField` answers "Did you mean
 * `groupField` → `groupByField`?" — and knows nothing at all about `groupBy`.
 *
 * ⚠️ THE PRODUCER CENSUS THE CARD MADE A PRECONDITION, run before the deletion.
 * A structural scan of every tracked file for a bare `groupBy` inside a
 * view-level `kanban`/`calendar`/`gallery`/`timeline`/`gantt` object literal
 * found NO runtime producer but this one; the lit control on the same
 * instrument (`groupByField` in the same position) returned 58 sites, so the
 * empty reading is a reading. The only other authors are FIXTURES: the two arms
 * of `ListView.kanbanOptionsBagCanonical-8193` that pin this very bag, and one
 * stale metadata payload in `data-objectstack`'s `updateView.draft.test.ts`.
 * The sibling producer `defaultKanbanFromObject` emits `{ groupByField }` alone
 * and always has.
 *
 * ⚠️ WHY THE ONE READER WAS UNHARMED (as measured then). `ListView`'s two
 * projection/expand collectors listed `v.groupByField, v.groupField, v.groupBy`
 * as candidates for the same lane value, so `groupBy` did contribute a field
 * NAME to the query projection — and this same expression writes that
 * identical value under `groupByField`, which those collectors read first. The
 * capability gate never read `groupBy` at all, and neither did the render
 * branch. Since objectui#6152 round 14 the collectors, the gate and the render
 * branch read `groupByField` alone.
 *
 * ⚠️ WHAT THIS CLOSED AND WHAT IT DID NOT — and what has since closed the rest.
 * `ListView`'s kanban branch destructured
 * `columns`/`groupByField`/`groupField`/`cardFields`/`titleField` out of the
 * merged config and spread the REST *after* its own `groupBy: laneField`, so a
 * surviving `groupBy` overrode the lane it had just resolved. This deletion
 * removed the only producer in this repo that fed that override; the override
 * itself stayed reachable from an author-written `kanban.groupBy` riding this
 * repo's `.passthrough()` mirror, and was carried on its own card.
 * ⭐ THAT CARD HAS LANDED (objectui#8365, maintainer ruling of 2026-09-12 —
 * decision batch #117 item 5, option B): `groupBy` is now stripped in
 * `ListView`'s destructure, so the canonical lane wins, AND the view-level
 * `KanbanConfig` mirror (`@object-ui/types`, `zod/objectql.zod.ts`) declares it
 * as an alias refusal naming `groupByField`, so the key is refused BY NAME at
 * the read door instead of riding the passthrough. ⛔ Do not re-file it.
 *
 * ⭐ THE CARD FIELDS GO OUT AS `columns`, THE SPEC'S SPELLING (objectui#6152
 * round 12, seat answer Q1 → A). This wrote the legacy `cardFields` alias, which
 * objectui#8213 left as a known residual. `@object-ui/types` now judges this bag
 * as the spec's list overlay does and refuses `options.kanban.cardFields` by
 * name, and `ListView`'s kanban branch reads `columns` for the cards when no
 * `cardFields` is present: measured on objectui#6152 (report 6070437445), the
 * generated node and the `$select` are identical under either spelling.
 * `titleField` is a member of the spec's kanban block (measured on 17.7.0). Every key this
 * expression writes is therefore a spec key, and
 * `ObjectView.kanbanGroupByRetired-8213` pins that, so an undeclared key
 * reddens instead of joining them quietly.
 *
 * ADR-0085: when the view doesn't pick a lane field, the object's declared
 * lifecycle (`stageField`) decides — including the strict `stageField: false`
 * suppression (no default lanes; the status-shaped field is declared
 * non-linear) and the shared name/type heuristic, which never invents a field
 * the object doesn't have (the old hard-coded 'status' did).
 *
 * objectui#11629: `summarizeField` (the spec's "Field to sum at top of column")
 * is relayed only when the view declares it. This block is the only kanban
 * config `ListView` receives on this page when the stored row carries no
 * `options.kanban` bag. Without the relay, the key never reached `ListView`'s
 * projection or the board's column headers, so a view that declared it
 * rendered counts with no totals. Like the lane, an absent key stays absent:
 * no default field is invented.
 *
 * Exported for the pin test.
 */
export function kanbanViewOptions(viewDef: any, objectDef: any): Record<string, unknown> {
    const lane =
        viewDef?.kanban?.groupByField ||
        detectStatusField(objectDef as any) ||
        undefined;
    const summarizeField = viewDef?.kanban?.summarizeField;
    return {
        ...(lane ? { groupByField: lane } : {}),
        titleField: viewDef?.kanban?.titleField || 'name',
        // The spec's own spelling of the card fields (objectui#6152 round 12): the
        // bag refuses the legacy `cardFields` this used to write, and `ListView`
        // reads `columns` for the cards, so the board is unchanged.
        columns: viewDef?.kanban?.columns,
        ...(summarizeField ? { summarizeField } : {}),
    };
}

/**
 * objectui#10380 — the stored row's legacy `options` bag, as this page hands it
 * to `ListView`. A row with no bag (or a bag that is not an object) gives `{}`.
 *
 * `@objectstack/spec`'s flattened list overlay declares this bag
 * (`ListViewOverlayOptionsSchema`). The view write door judges each
 * `options.KIND` block key by key with that kind's own block schema, refuses
 * an out-of-contract key by name, and stores what it accepts. The spec
 * describes the bag as an underlay: the top-level `KIND` block "wins per key
 * where both set one". The interface page has always forwarded the bag, so one
 * stored row rendered two ways. Ruling A on objectui#10380 (comment
 * 5824043998) keeps that forward ("what passes the door is legal"), so the
 * object page now forwards the bag too.
 *
 * The relay below does three things with it, and none of them merges keys:
 *   - `options` carries the bag. For each kind the bag carries, the bag's block
 *     REPLACES this page's synthesized block (`kanbanViewOptions` and its
 *     siblings). This is the rule `InterfaceListPage` applies to its `mapCfg`
 *     (`view.options.map ?? derived`). A synthesized block stands in only for a
 *     kind the bag does not carry, so a row with no bag is relayed exactly as
 *     before.
 *   - For each kind the bag carries, the view's own top-level block also goes
 *     out at the top level, where `InterfaceListPage` puts it as well.
 *   - `ListView` then lays the top-level block over the bag per key. That merge
 *     already exists in each render branch (`{ ...options.KIND, ...KIND }`),
 *     and it is the spec's precedence. ⛔ No second merge is written here.
 *
 * Exported for the pin test.
 */
export function storedLegacyOptions(viewDef: unknown): Record<string, any> {
    const bag = viewDef && typeof viewDef === 'object' ? (viewDef as { options?: unknown }).options : undefined;
    return bag && typeof bag === 'object' && !Array.isArray(bag) ? (bag as Record<string, unknown>) : {};
}

/**
 * objectui#10046 — is `a` the same `options` bag as `b`, compared by VALUE?
 * (objectui#7237 holds the resolved `filter` through the same comparison.)
 *
 * `renderListView` rebuilds `fullSchema.options` as a fresh object literal on
 * every call, and `plugin-view`'s `ObjectView` calls it on every one of its
 * renders. `ListView` names `schema.options` BY IDENTITY in its fetch effect's
 * dependency list (objectui#4567 ruled that dependency correct and put
 * stabilisation at the PRODUCER), so each host re-render that changed nothing
 * re-issued the identical `dataSource.find`: one extra at mount (the record
 * count landing), two on opening a record and two on closing it.
 *
 * A copy of `plugin-view`'s `isStructurallyEqual` (`stableIdentity.ts`,
 * objectui#6460), kept module-local because that one is not exported and
 * exporting it would publish a new name. Same safety invariant: every
 * uncertainty (an unmodelled type — function, `Map`, class instance —, a
 * differing key count, a structure deeper than the bound) answers "not
 * equal", which hands `ListView` a new identity and therefore a refetch. It can
 * only ever remove a REDUNDANT query; it can never withhold a needed one.
 * ⛔ Not `JSON.stringify`: that calls `{ a: undefined }` and `{}` equal (a
 * missed refetch) and throws on a cycle.
 */
export function isSameOptionsValue(a: unknown, b: unknown, depth = 0): boolean {
    if (Object.is(a, b)) return true;
    if (depth >= 12) return false;
    if (a instanceof Date || b instanceof Date) {
        return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((item, i) => isSameOptionsValue(item, b[i], depth + 1));
    }
    const isPlain = (v: unknown): v is Record<string, unknown> => {
        if (v === null || typeof v !== 'object') return false;
        const proto = Object.getPrototypeOf(v);
        return proto === Object.prototype || proto === null;
    };
    if (isPlain(a) && isPlain(b)) {
        const keys = Object.keys(a);
        if (keys.length !== Object.keys(b).length) return false;
        return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && isSameOptionsValue(a[k], b[k], depth + 1));
    }
    return false;
}

/**
 * Issue one `updateView` per patch — **as a method call on the adapter**
 * (objectui#4463).
 *
 * This exists to make one specific bug unwritable. `handleSetDefaultView` and
 * `handleReorderViews` both used to detach the method before calling it (the
 * reorder no longer writes a view at all since objectui#12418 — it is the
 * user's preference):
 *
 * ```ts
 * const updateView = (dataSource as any).updateView;   // detached
 * …
 * updateView(objectName, target, patch);               // `this` === undefined
 * ```
 *
 * The adapter's `updateView` opens with `await this.connect()`, so every write
 * in the list rejected with `TypeError: Cannot read properties of undefined
 * (reading 'connect')` **before any request was issued** — the user got a toast
 * and the server never heard about it. "Set as Default" was dead on every saved
 * view for exactly this reason, while rename and pin worked from the same menu:
 * `handlePinView` always called it as a method, which is the in-file convention
 * this restores.
 *
 * The call site routes through here, so there is a single place in the file
 * that calls `updateView` over a patch list — and it has no local to detach into.
 */
export function dispatchViewPatches(
    dataSource: any,
    objectName: string,
    patches: ReadonlyArray<{ viewId: string; patch: Record<string, any> }>,
): Array<Promise<unknown>> {
    return patches.map(
        ({ viewId, patch }) => dataSource.updateView(objectName, viewId, patch),
    );
}
