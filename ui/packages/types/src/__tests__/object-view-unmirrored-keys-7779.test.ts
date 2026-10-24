/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#7779 — `ObjectViewSchema`'s ten unmirrored declared keys, closed
 * nine-for-ten under maintainer ruling B (2026-09-06: liveness first, then
 * mirror-or-retire per key), with `listViews` left in the parity ledger by
 * measurement.
 *
 * ## The defect
 *
 * `ObjectViewSchema` in `../objectql.ts` declared ten keys its Zod mirror in
 * `../zod/objectql.zod.ts` never did (objectui#7279's `UnmirroredDeclared`
 * reading). `BaseSchema` is `.passthrough()`, so a document authoring any of
 * them passed the validator UNEXAMINED while the published type invited the
 * author to write it: `defaultViewType: 'tree'`, `navigation: 'page'`,
 * `searchableFields: 'name'` all parsed green and rendered with the key
 * ignored — declared, not enforced.
 *
 * ## What this file pins, and the shapes it borrows
 *
 * The mirror half is `object-kanban-group-by-limit-7322.test.ts`: membership is
 * asserted on the mirror's OWN `.shape`, never on parse acceptance (under
 * `.passthrough()` acceptance cannot tell "declared" from "admitted
 * unexamined"); every mirrored key carries an accepted-and-survives assertion
 * AND a wrong-typed refusal AT the key — the pairing that makes the pin a
 * reading rather than a tolerance; and the read set is DERIVED off the renderer
 * with a positive control, so a zero is a reading.
 *
 * The by-reference half is `spec-subschema-parity.test.ts`: the three spec keys
 * are pinned by IDENTITY against the spec slot (`SpecListViewSchema.shape.*`),
 * not against a copy, so a spec-side change moves them; the two view-switcher
 * keys the same way against the sibling `ViewSwitcherSchema` slots the renderer
 * forwards them into verbatim.
 *
 * The retire half is `TimelineSchema.timeScale` (objectui#6355) /
 * `ObjectKanbanSchema.groupField` (objectui#7322): `?: never` on the TS face and
 * `retirementTombstone()` on the mirror, BOTH halves, so the retired spelling is
 * refused BY NAME on each face rather than deleted into the index signature.
 *
 * ## The one that stayed, and how it was closed (objectui#7928)
 *
 * `listViews` was NOT mirrored by this card. The ruling's own fallback clause
 * fired on the measurement below: the declaration's value was the local
 * `NamedListView` — 64 declared top-level members, of which the renderer read
 * 21, leaving 43 that a key-for-key local mirror would enforce unread.
 *
 * ⭐ objectui#7928 closed it on the OTHER value type: ruling A (maintainer
 * 「同意」, comment 5565628927) mirrors it BY REFERENCE to the spec's
 * `ViewSchema.shape.listViews`, staged behind objectui#8254 (the renderer
 * honours a spec-shaped named view) and objectui#8255 (the docs teach one). The
 * one key the renderer still read that the protocol refuses, `options`, was
 * disposed by the director ruling on that card (comment 5856694523): refused on
 * the authoring face, no longer read off a named view, and folded at
 * `@object-ui/app-shell`'s `ViewPreview` for a stored body. The census below was
 * RE-TAKEN on that tree — 20 read / 44 unread — and the pins that said "still
 * unmirrored" were inverted rather than deleted.
 *
 * ⭐ objectui#10758 re-took it again: bucket ① of the objectui#7924 ruling (the
 * twenty-three protocol members no route read off a named view) is read off the
 * named view by the host delegation now, first ahead of the host `views` entry
 * and the node. The partition moved from 20 / 44 to 43 / 21, bucket ① is empty,
 * and every pin that held one of those members UNREAD is inverted, not deleted.
 * ⛔ Quote neither pair from here: the census re-derives both on every run.
 *
 * ⭐ objectui#13118 moved one member back the other way, by retirement rather
 * than by a lost read: `@objectstack/spec` 18 retires the list view's
 * `filterableFields` (objectstack#24640, maintainer ruling C — no per-view
 * Filter-panel whitelist replaces it), so its one reader, `ListView`'s Filter
 * panel whitelist, and every relay rung that fed it came out. `NamedListView`
 * declares it as a `?: never` tombstone; the node's member follows the spec's
 * slot by reference, as its zod twin does, so both of the node's faces flip at
 * the pin bump that takes the retirement. objectui's own spec pin
 * predates that retirement, so the installed protocol still calls the key LIVE:
 * the census reads it in a sixth bucket, {@link BUCKET_SPEC_RETIRED_AHEAD_OF_PIN},
 * which empties itself into the protocol-retired buckets at the pin bump that
 * takes the retirement. On the node, the key stays MIRRORED (the spec's slot by
 * reference carries the tombstone in at that bump) and is READ no longer
 * ({@link SPEC_RETIRED_UNREAD}).
 *
 * ⭐ objectui#13261 was that bump: the pin moved to `@objectstack/spec` 18.0.0,
 * which carries the tombstone. The sixth bucket emptied into the
 * protocol-retired ones, and the node's mirror now refuses the key by name with
 * the spec's own prescription.
 *
 * ⚠️ BOTH FIGURES WERE RE-TAKEN at objectui#8980 and are NOT the ones this file
 * was written with. It measured 47 declared / 6 read / 41 unread, plus a
 * SEVENTH read, `data`, that was declared nowhere and reached the renderer
 * through an `as any` cast — which is why the read set had seven entries while
 * the arithmetic subtracted only six. The director-seat ruling of 2026-09-13
 * (objectui#8980) declared the seventeen members the protocol declares on this
 * surface and objectui did not, `data` among them with the cast removed, and
 * wired a read point for each. So the read set and the declared set no longer
 * disagree on a single name, and the arithmetic subtracts the whole read set.
 * ⛔ Do not quote 47 / 6 / 41 from anywhere: they are this file's history, not
 * its reading. The spec's
 * `ViewSchema.listViews` is a record of the STRICT `ObjectListViewSchema`, and
 * the spec value refuses the local named-view dialect this package's docs
 * taught until objectui#8255 (a view with no `columns`, an ObjectQL tuple
 * filter). Both facts are asserted against the SPEC schema here, so the day the
 * spec relaxes (or the renderer's read set moves) the measurement — and the
 * stop — is re-taken rather than remembered. objectui#8255 rewrote those docs in
 * the spec shape, and the `listViews` block below parses every named view they
 * author through that same schema, so the docs cannot drift back unseen.
 *
 * ## objectui#7924 — the same measurement, now PER MEMBER
 *
 * The two figures above were a COUNT and a name list. objectui#7924 asks which
 * members, by name, are on each side, because that is the input the `listViews`
 * value-type ruling (objectui#7928) needs: tombstoning the unread ones narrows a
 * published accept set, and making the renderer read them is capability growth.
 * ⛔ Neither is dispatched or decided here — this file only measures.
 *
 * The census lives in the last describe block and changes the INSTRUMENT as well
 * as the resolution:
 *
 * - the declared set is walked with the TypeScript parser (`ts.createSourceFile`,
 *   the interface's own `PropertySignature` members), ⛔ not a regex and ⛔ not a
 *   brace-depth count — a brace parser on this repo has already failed to
 *   terminate at an object's close (objectui#8071). The two regexes are kept and
 *   asserted AGAINST the parser, so the instrument swap is itself a reading:
 *   strict regex 47 = parser 47, loose regex 59.
 * - the read set is derived by walking every route from `schema.listViews` to a
 *   named view, and every occurrence of that record is CLASSIFIED — so a new
 *   route fails as `UNCLASSIFIED` instead of silently shrinking the read set.
 *   That found a named-view read the old `currentNamedViewConfig?.KEY` regex
 *   cannot see: `{view.label || key}` on the tab strip.
 * - each of the 47 members is then pinned BY NAME on its side of the partition,
 *   so a member moving between read and unread fails in EITHER direction.
 *
 * ⚠️ The distinction the whole finding turns on: a member reached through
 * `activeView?.KEY` — the host's `views` prop — is NOT read off the named view.
 * `allowExport`, read off the node only (off `activeView` too until
 * objectui#11013), is the pinned counter-control below (it was `rowHeight`
 * until objectui#10758 made the delegation read that one off the named view
 * first).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import type { z } from 'zod';
import {
  ListViewSchema as SpecListViewSchema,
  ObjectListViewSchema as SpecObjectListViewSchema,
  NavigationConfigSchema as SpecNavigationConfigSchema,
  ViewSchema as SpecViewSchema,
} from '@objectstack/spec/ui';

import { ObjectViewSchema } from '../zod/objectql.zod';
import { stripImportedDefaults } from '../zod/imported-defaults.js';
import { ViewSwitcherSchema } from '../zod/views.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type { ObjectViewSchema as TsObjectViewSchema, NamedListView, ListViewSchema as TsListViewSchema } from '../objectql';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
/** The `object-view` NODE renderer — registered by `plugin-view/src/index.tsx`. */
const READER = 'packages/plugin-view/src/ObjectView.tsx';
/** The switcher the renderer composes; it reads the two forwarded keys. */
const SWITCHER = 'packages/plugin-view/src/ViewSwitcher.tsx';
const REGISTRATION = 'packages/plugin-view/src/index.tsx';
const MIRROR = 'packages/types/src/zod/objectql.zod.ts';
const DECLARATION = 'packages/types/src/objectql.ts';
const README = 'packages/plugin-view/README.md';
const DOC = 'content/docs/plugins/plugin-view.mdx';

const SPEC_REFERENCED = ['navigation', 'searchableFields', 'filterableFields'] as const;
const SIBLING_REFERENCED = ['allowCreateView', 'viewActions'] as const;
const LOCAL_LITERALS = ['defaultViewType', 'defaultListView', 'showViewSwitcher'] as const;
const MIRRORED = [...SPEC_REFERENCED, ...SIBLING_REFERENCED, ...LOCAL_LITERALS] as const;
type Mirrored = (typeof MIRRORED)[number];
/**
 * objectui#13118 — the one MIRRORED key the renderer reads no longer.
 * `@objectstack/spec` 18 retires the list view's `filterableFields`
 * (objectstack#24640, ruling C: no per-view Filter-panel whitelist replaces
 * it). The node's mirror slot is still the spec's own by reference, which is
 * what carries the spec's tombstone in at the pin bump that takes the
 * retirement, and the TypeScript face reads the same slot by reference, so
 * both faces flip there together. Its read pins are inverted below, not
 * deleted.
 */
const SPEC_RETIRED_UNREAD = 'filterableFields' as const;
type ReadMirrored = Exclude<Mirrored, typeof SPEC_RETIRED_UNREAD>;
/** The mirrored keys the renderer still reads: every one but {@link SPEC_RETIRED_UNREAD}. */
const READ_MIRRORED = MIRRORED.filter((k): k is ReadMirrored => k !== SPEC_RETIRED_UNREAD);
const RETIRED = 'viewTabBar';
/** Ledgered until objectui#7928; the spec's own record, by reference, since. */
const LEDGERED = 'listViews';

/**
 * Exact source text of the reads, as they stand today. Line numbers drift and
 * live in the docblocks' prose only; the READ is the fact.
 */
const READ_TEXT: Record<ReadMirrored, ReadonlyArray<readonly [file: string, text: string]>> = {
  // objectui#10885: the node's `navigation` is still read, now as the fallback
  // behind the active named view's.
  navigation: [[READER, 'const navigationConfig: ViewNavigationConfig | undefined = currentNamedViewConfig?.navigation ?? schema.navigation;']],
  searchableFields: [[READER, 'searchableFields: currentNamedViewConfig?.searchableFields ?? activeView?.searchableFields ?? (schema as any).searchableFields,']],
  allowCreateView: [
    [READER, 'allowCreateView: schema.allowCreateView,'],
    [SWITCHER, 'const createViewButton = schema.allowCreateView ? ('],
  ],
  viewActions: [
    [READER, 'viewActions: schema.viewActions,'],
    [SWITCHER, '{schema.viewActions.map((action, idx) => {'],
  ],
  defaultViewType: [[READER, "return schema.defaultViewType || 'grid';"]],
  defaultListView: [[READER, 'if (schema.defaultListView && namedListViews?.[schema.defaultListView]) {']],
  showViewSwitcher: [[READER, 'const showViewSwitcherToggle = schema.showViewSwitcher === true;']],
};

/** The registration's editable-props meta names the three local literals too. */
const REGISTRATION_TEXT: readonly string[] = [
  "{ name: 'defaultViewType', type: 'enum', enum: ['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'map'] },",
  "{ name: 'defaultListView', type: 'string' },",
  "{ name: 'showViewSwitcher', type: 'boolean' },",
];

/** A declared-keys-only control of the read set: read, declared, untouched. */
const READ_CONTROL_KEY = 'objectName';
/**
 * A plausible view-chrome spelling the renderer never reads. It stays undeclared
 * on both faces — the proof that this change declares the keys the card measured
 * and nothing else.
 */
const CONTROL_KEY = 'viewSwitcherPosition';

/**
 * The `NamedListView` members the renderer reads off a named view. Forty-two
 * since objectui#13118 stopped reading `filterableFields` (the spec retires
 * it); forty-three from objectui#10758, which made the host delegation read
 * bucket ① — the
 * twenty-three protocol members no route read off the named view — from the
 * named view first; twenty from objectui#7928, which stopped reading the legacy
 * `options` bag off a named view (it is folded at `ViewPreview` instead);
 * twenty-one from objectui#8980, which wired a read point for each of the
 * seventeen protocol members it declares; seven before that, of which `data`
 * was the undeclared cast.
 */
const NAMED_VIEW_READS = [
  'addRecord', 'allowPrinting', 'appearance', 'aria', 'bulkActionDefs', 'bulkActions',
  'calendar', 'chart', 'columns', 'compactToolbar', 'conditionalFormatting', 'data',
  'description', 'emptyState', 'exportOptions', 'fieldOrder', 'filter',
  'gallery', 'gantt', 'grouping', 'hiddenFields', 'inlineEdit', 'kanban', 'label', 'map',
  'name', 'navigation', 'pagination', 'resizable', 'rowActions', 'rowColor', 'rowHeight',
  'searchableFields', 'selection', 'sharing', 'showRecordCount', 'sort', 'timeline', 'tree',
  'type', 'userActions', 'userFilters',
] as const;

/* ── objectui#7924 — the per-member liveness census ───────────────────────────
 * Both halves below are RE-DERIVED at test time (`namedListViewMembers()` /
 * `deriveNamedViewReads()`); the literals are the pinned READING, so a member
 * that moves between the two sets — in EITHER direction — fails by name.
 */

/** Every top-level member `NamedListView` declares. 65 today (47 + objectui#8980's seventeen + objectui#12341's `requiredPermissions`), sorted. */
const NAMED_LIST_VIEW_DECLARED = [
  'addDeleteRecordsInline', 'addRecord', 'addRecordViaForm', 'allowExport', 'allowPrinting',
  'appearance', 'aria', 'bulkActionDefs', 'bulkActions', 'calendar', 'chart',
  'clickIntoRecordDetails', 'collapseAllByDefault', 'color', 'columns', 'compactToolbar',
  'conditionalFormatting', 'data', 'densityMode', 'description', 'emptyState', 'exportOptions',
  'fieldOrder', 'fieldTextColor', 'filter', 'filterableFields', 'gallery', 'gantt', 'grouping',
  'hiddenFields', 'inlineEdit', 'kanban', 'label', 'map', 'name', 'navigation', 'options',
  'pageName', 'pagination', 'prefixField', 'requiredPermissions', 'resizable', 'rowActions', 'rowColor', 'rowHeight',
  'searchableFields', 'selection', 'sharing', 'showColor', 'showDensity', 'showDescription',
  'showFilters', 'showGroup', 'showHideFields', 'showRecordCount', 'showSearch', 'showSort',
  'sort', 'tabs', 'timeline', 'tree', 'type', 'userActions', 'userFilters', 'wrapHeaders',
] as const;

/**
 * The DECLARED members the renderer reads off a named view. All 42 of them
 * (43 until objectui#13118 stopped reading `filterableFields`; 20 until
 * objectui#10758 added bucket ①; 21 until objectui#7928 dropped `options`) —
 * the read set and the declared set disagree on no name since objectui#8980,
 * which is what closed {@link NAMED_VIEW_READ_UNDECLARED}.
 */
const NAMED_VIEW_READ_DECLARED = [
  'addRecord', 'allowPrinting', 'appearance', 'aria', 'bulkActionDefs', 'bulkActions',
  'calendar', 'chart', 'columns', 'compactToolbar', 'conditionalFormatting', 'data',
  'description', 'emptyState', 'exportOptions', 'fieldOrder', 'filter',
  'gallery', 'gantt', 'grouping', 'hiddenFields', 'inlineEdit', 'kanban', 'label', 'map',
  'name', 'navigation', 'pagination', 'resizable', 'rowActions', 'rowColor', 'rowHeight',
  'searchableFields', 'selection', 'sharing', 'showRecordCount', 'sort', 'timeline', 'tree',
  'type', 'userActions', 'userFilters',
] as const;

/**
 * Read off a named view but NOT declared on `NamedListView`. EMPTY since
 * objectui#8980, and the emptiness is the reading.
 *
 * This held exactly one name, `data`, reached through an `as any` cast on the
 * named-view config — objectui#7928's open half. The director-seat ruling of
 * 2026-09-13 answered it by name ("`data` replaces the `as any` read …: declare
 * it"), so the member is declared, the cast is gone, and the census arithmetic
 * now subtracts the whole read set rather than the read set minus one.
 *
 * ⛔ A name reappearing here is not a test to update: it is a renderer reading a
 * key off a named view that nothing declares, which is the class objectui#7928
 * sends to a ruling.
 */
const NAMED_VIEW_READ_UNDECLARED = [] as const;

/**
 * The census result: declared, and NOT read off a named view. 23 today: the
 * 44 of objectui#7928 minus bucket ①'s twenty-three, which objectui#10758 made
 * the host delegation read off the named view, plus `requiredPermissions`
 * (objectui#12341), plus `filterableFields`, read no longer since objectui#13118
 * and retired by the installed protocol since objectui#13261. What is left is
 * bucket ② (the legacy `show*` spellings), bucket ③ (objectui-only members), the
 * three protocol-retired members ({@link BUCKET_PROTOCOL_RETIRED_TOMBSTONED}) and the one LIVE
 * protocol member the SERVER enforces ({@link BUCKET_SERVER_ENFORCED_UNREAD}) —
 * no other live protocol member is on it.
 *
 * ⭐ TWO OF THEM WERE objectui#8980's OWN, the ruled outcome then: `tabs` and
 * `pageName`. Since objectui#11073 both are `?: never` tombstones, following the
 * protocol's retirement; the paragraph below is the record of why they were
 * declared at all. The ruling's item 2 requires a member
 * with no renderer behaviour to attach to be DECLARED and REPORTED with its
 * measurement — ⛔ not silently declared inert and ⛔ not dropped from the type.
 * The measurements, reported on objectui#8980: objectui's tab bar for an object
 * is the host-owned saved-view switcher (ADR-0053), so nothing on this surface
 * reads the list shape's `ViewTabSchema[]`; and `page` is not a member of
 * `NamedListView['type']`, so no authored named view can select the branch
 * `pageName` configures.
 */
const NAMED_LIST_VIEW_UNREAD = [
  'addDeleteRecordsInline', 'addRecordViaForm', 'allowExport', 'clickIntoRecordDetails',
  'collapseAllByDefault', 'color', 'densityMode', 'fieldTextColor', 'filterableFields', 'options', 'pageName',
  'prefixField', 'requiredPermissions', 'showColor', 'showDensity', 'showDescription', 'showFilters', 'showGroup',
  'showHideFields', 'showSearch', 'showSort', 'tabs', 'wrapHeaders',
] as const;

/**
 * The two members of the unread set that the renderer did not mention AT ALL
 * until objectui#10758 — not off the named view, not off `activeView`, not off
 * the node. They were the sharp end of the census: no host-side twin to weigh
 * against the "declared, unenforced, unread" reading. objectui#10758 gave each a
 * rung on the host delegation, named view first, so the pin that held their
 * ABSENCE is inverted below rather than deleted.
 */
const WERE_ABSENT_FROM_RENDERER = ['bulkActionDefs', 'exportOptions'] as const;

/**
 * The named-view read probe's FIRING CONTROL, and its negative twin. Both are
 * declared members; the control is read off a named view and the counter-control
 * is not, so a probe that returns them correctly is a probe that is running.
 *
 * The negative twin was `rowHeight` until objectui#10758 made the delegation
 * read it off the named view too. `allowExport` replaces it on the same
 * footing: declared, read off the node, and NOT off a named view — objectui's
 * own member, which the protocol does not declare there. Since objectui#11013
 * it is a `?: never` tombstone and no longer read off `activeView` either; a
 * tombstone is still a declared member, which is what its refusal by name is.
 */
const NAMED_VIEW_READ_CONTROL = 'columns';
const NAMED_VIEW_UNREAD_CONTROL = 'allowExport';
/** A plausible list-view spelling that is neither declared nor read. */
const NAMED_VIEW_ABSENT_CONTROL = 'stickyHeader';

/* ── objectui#7924 — the DISPOSITION buckets, derived against the protocol ───
 * The census above answers "declared, and read off a named view?". It does not
 * answer the question the disposition turns on: does the PROTOCOL declare the
 * member? That is what separates "the renderer sources it from the wrong place"
 * from "objectui invented a spelling". The 2026-09-16 director-seat ruling on
 * objectui#7924 is written in those terms, and its bucket lists were prose with
 * no assertion that could fail — the same shape that let "about 52 members"
 * survive two corrections. Everything below is DERIVED at test time from the
 * installed `@objectstack/spec`, the declaration and the runtime fold; the
 * literals are the pinned reading.
 */

/**
 * The protocol's own member set for a named list view — `ObjectListViewSchema`'s
 * shape, off `@objectstack/spec` as installed (18.1.0). ⛔ Not a copy of the
 * objectui face and ⛔ not a hand list: it is read off the schema object, so a
 * spec bump that moves a key moves this.
 */
const PROTOCOL_LIST_VIEW_KEYS = [
  'addRecord', 'allowPrinting', 'appearance', 'aria', 'bordered', 'bulkActionDefs', 'bulkActions',
  'calendar', 'chart', 'columns', 'compactToolbar', 'conditionalFormatting', 'data', 'description',
  'emptyState', 'exportOptions', 'fieldOrder', 'filter', 'filterableFields', 'gallery', 'gantt',
  'grouping', 'hiddenFields', 'inlineEdit', 'kanban', 'label', 'map', 'name', 'navigation',
  'pageName', 'pagination', 'performance', 'requiredPermissions', 'resizable', 'responsive', 'rowActions', 'rowColor',
  'rowHeight', 'searchableFields', 'selection', 'sharing', 'showRecordCount', 'sort', 'striped',
  'tabs', 'timeline', 'tree', 'type', 'userActions', 'userFilters', 'virtualScroll',
] as const;

/**
 * Eight of those 51 are RETIREMENT TOMBSTONES, refused by name with the
 * protocol's own `[REMOVED]` text (seven until the pin move to
 * `@objectstack/spec` 18.0.0 took the retirement of `filterableFields`,
 * objectui#13261; five until `@objectstack/spec` 17.5.0 retired `pageName` and
 * `tabs`, objectui#11073). ⚠️ They are why a raw key-count diff reads
 * objectui as "narrower" and is wrong to: not declaring a key the protocol
 * refuses is agreement, not a gap. Derived by the tombstone's own marker, not
 * listed by hand.
 */
const PROTOCOL_RETIRED_KEYS = ['bordered', 'filterableFields', 'pageName', 'performance', 'responsive', 'striped', 'tabs', 'virtualScroll'] as const;

/**
 * The FIFTH bucket — LIVE protocol members DECLARED here and read off no named view BY
 * DESIGN, because the SERVER enforces them before a view is served.
 *
 * `requiredPermissions` is the audience gate `@objectstack/spec` 18 adds
 * (objectstack#22611, ruling A). objectui#12030 pinned it here as PENDING, the
 * one live protocol key objectui did not declare; objectui#12341 declared it
 * (by reference, `ListViewSchema['requiredPermissions']`) and moved the pin to
 * this bucket. The server lists only the views a caller may open, refuses a
 * by-name read with `403` and prunes an object's `listViews` (objectstack PR
 * #22731); the console surfaces the refusal (objectui#12112). A renderer read
 * would be a second, client-side gate, which the card forbids — so this member
 * is NOT bucket ① ("implementation owed"), and the census keeps it apart.
 *
 * ⛔ Not a place to park a key the renderer should read: a member lands here
 * only with a named server-side enforcement point.
 */
const BUCKET_SERVER_ENFORCED_UNREAD = ['requiredPermissions'] as const;

/**
 * The SIXTH bucket (objectui#13118) — a member the installed protocol still
 * calls LIVE, that `@objectstack/spec` has RETIRED on objectstack `main`
 * AHEAD of objectui's own pin, and that objectui therefore reads nowhere and
 * declares only as a `?: never` tombstone.
 *
 * `filterableFields`: objectstack#24640 (maintainer ruling C, pulled into
 * 18.0) retires the list view's per-view Filter-panel whitelist, and no key
 * replaces it. The renderer change does not depend on the pin — dropping a
 * reader of a retired key is safe at any pin — so it landed ahead of the bump.
 *
 * ⛔ Not a place to park a key the renderer should read: a member lands here
 * only with a named spec retirement on objectstack `main`. ⭐ The bucket is
 * SELF-EXPIRING: the per-member row below asserts the installed spec does not
 * carry the tombstone yet, so the pin bump that takes the retirement reddens
 * it, and the member moves to {@link PROTOCOL_RETIRED_KEYS} and
 * {@link BUCKET_PROTOCOL_RETIRED_TOMBSTONED} in that same bump.
 *
 * EMPTY since objectui#13261: the pin move to `@objectstack/spec` 18.0.0 took
 * the retirement, and `filterableFields` moved to both lists in that bump.
 */
const BUCKET_SPEC_RETIRED_AHEAD_OF_PIN = [] as const;

/** The marker every protocol tombstone's description opens with. */
const PROTOCOL_TOMBSTONE_MARKER = '[REMOVED]';

/**
 * BUCKET ① — declared by BOTH faces and read off no named view. EMPTY since
 * objectui#10758, and the emptiness is the reading.
 *
 * It held twenty-three members ({@link BUCKET_ONE_READ_SINCE_10758}): the
 * behaviour was the protocol's and only the SOURCE the renderer read it from
 * was wrong. The ruling on objectui#7924 (comment 5690906005) sent them to
 * implementation, ⛔ not declaration — a `?: never` tombstone would have put
 * objectui narrower than the protocol — and objectui#10758 made the host
 * delegation read each of them off the named view first.
 *
 * ⛔ A name appearing here is a protocol member the renderer stopped reading off
 * a named view (or a new protocol member it never read): implementation owed,
 * not a test to update.
 */
const BUCKET_PROTOCOL_DECLARED_UNREAD = [] as const;

/**
 * The bucket-① members still read, by name — the pinned reading of what moved
 * from unread to read at objectui#10758. Twenty-three moved; twenty-two stay
 * read, because objectui#13118 stopped reading `filterableFields` when the spec
 * retired it ({@link BUCKET_ONE_UNREAD_SINCE_13118}). Each is asserted READ, per
 * member, below; the census above asserts the same from the other side.
 */
const BUCKET_ONE_READ_SINCE_10758 = [
  'addRecord', 'allowPrinting', 'aria', 'bulkActionDefs', 'bulkActions', 'compactToolbar',
  'conditionalFormatting', 'description', 'emptyState', 'exportOptions',
  'hiddenFields', 'inlineEdit', 'navigation', 'pagination', 'resizable', 'rowActions', 'rowHeight',
  'searchableFields', 'selection', 'sharing', 'showRecordCount', 'userFilters',
] as const;

/**
 * The one objectui#10758 bucket-① member read no longer: `filterableFields`,
 * whose reader objectui#13118 removed with the spec's retirement of the key.
 * Its READ pin is inverted below, not deleted.
 */
const BUCKET_ONE_UNREAD_SINCE_13118 = ['filterableFields'] as const;

/**
 * BUCKET ② — the eight legacy `show*` SPELLINGS: declared by objectui alone,
 * each with a canonical protocol twin the runtime already folds onto. The
 * mapping is objectui's own (`SHOW_FLAG_TO_USER_ACTION` + the `showDescription`
 * fold), and it is re-derived off disk below rather than trusted from here.
 */
const LEGACY_SHOW_SPELLING_TWINS: Readonly<Record<string, readonly [string, string]>> = {
  showSearch: ['userActions', 'search'],
  showSort: ['userActions', 'sort'],
  showFilters: ['userActions', 'filter'],
  showDensity: ['userActions', 'rowHeight'],
  showGroup: ['userActions', 'group'],
  showHideFields: ['userActions', 'hideFields'],
  showColor: ['userActions', 'rowColor'],
  showDescription: ['appearance', 'showDescription'],
};
const BUCKET_LEGACY_SHOW_SPELLINGS = [
  'showColor', 'showDensity', 'showDescription', 'showFilters', 'showGroup', 'showHideFields',
  'showSearch', 'showSort',
] as const;

/**
 * BUCKET ③ — eleven members the protocol declares NOWHERE, outside the `show*`
 * fold table, and read off no named view by the `object-view` renderer: ten at
 * objectui#7924's retirement, plus `options` since objectui#7928
 * ({@link LOCAL_ONLY_READ}).
 *
 * ⚠️ CORRECTED at objectui#7924's retirement: this block used to add "no runtime
 * fold, and no reader on any path". Two of the ten falsified it —
 * `allowExport` ({@link BUCKET_LOCAL_ONLY_RETAINED}) and `densityMode`, retired
 * later by ruling A′ ({@link DENSITY_MODE_RETIRED}) — because the `object-view` renderer is not
 * the only host of a named view: `app-shell`'s object page holds the active
 * named view as a flat `NamedListView` and relays members off it into the
 * `list-view` node. The membership below is unchanged (it is derived by the
 * protocol and the fold table, and both still place all eleven here); only the
 * "unread on any path" gloss was wrong.
 */
const BUCKET_LOCAL_ONLY_UNREAD = [
  'addDeleteRecordsInline', 'addRecordViaForm', 'allowExport', 'clickIntoRecordDetails',
  'collapseAllByDefault', 'color', 'densityMode', 'fieldTextColor', 'options', 'prefixField', 'wrapHeaders',
] as const;

/**
 * The bucket-③ member objectui#7924 did NOT tombstone, because it was read and
 * acted on: both relays carried `allowExport` off the active view, and
 * `ListView` gates its export control on it.
 *
 * ⚠️ This held TWO names until ruling A′ (objectui#7924): `densityMode` was kept
 * because both relays of a named view carried it by name into the fold. Once
 * both relays read the density THROUGH the fold (`normalizeListViewSchema`),
 * nothing outside the fold reads it, so it retired as a legacy spelling of
 * top-level `rowHeight` — see {@link DENSITY_MODE_RETIRED}.
 *
 * ⚠️ …and it holds NONE since objectui#11013 (ruling 甲 on objectstack#20051,
 * the seat's disposition on objectstack#20456: no producer, no declared
 * spelling). Both relays stopped reading `allowExport` off a view, so it
 * retired too — see {@link RETIRED_BY_11013}. `ListView`'s gate now hears the
 * `list-view` node only.
 */
const BUCKET_LOCAL_ONLY_RETAINED = [] as const;

/**
 * The bucket-③ member objectui#11013 retired as a `?: never` tombstone once no
 * relay read it off a view: the eighteenth objectui-only tombstone, and the one
 * objectui#7924 did not put there. Kept apart from
 * {@link NAMED_LIST_VIEW_TOMBSTONES}, which is that card's set and carries its
 * marker, the way the objectui#11073 pair is kept apart below.
 */
const RETIRED_BY_11013 = ['allowExport'] as const;

/**
 * The `?: never` tombstone objectui#13118 put on `NamedListView`: the
 * twenty-first, and the first for a key the installed protocol still calls
 * live ({@link BUCKET_SPEC_RETIRED_AHEAD_OF_PIN}). Kept apart from
 * {@link NAMED_LIST_VIEW_TOMBSTONES} for the same reason as
 * {@link RETIRED_BY_11013}.
 */
const RETIRED_BY_13118 = ['filterableFields'] as const;

/**
 * The bucket-③ member retired LATER than its neighbours, by ruling A′ on
 * objectui#7924: a legacy spelling of top-level `rowHeight` whose only reader
 * is the runtime fold.
 */
const DENSITY_MODE_RETIRED = 'densityMode';

/**
 * Every `?: never` tombstone objectui#7924 put on `NamedListView`: the eight
 * bucket-② spellings plus the nine bucket-③ members nothing outside the fold
 * reads (`densityMode` joined the eight at ruling A′). `options`, unread off a
 * named view since objectui#7928, is the eleventh bucket-③ member and is held
 * rather than tombstoned ({@link BUCKET_LOCAL_ONLY_HELD}). Derived off the AST (a
 * member whose type node is the `never` keyword).
 */
const NAMED_LIST_VIEW_TOMBSTONES = [
  'addDeleteRecordsInline', 'addRecordViaForm', 'clickIntoRecordDetails', 'collapseAllByDefault',
  'color', 'densityMode', 'fieldTextColor', 'prefixField', 'showColor', 'showDensity',
  'showDescription', 'showFilters', 'showGroup', 'showHideFields', 'showSearch', 'showSort',
  'wrapHeaders',
] as const;

/**
 * The two members objectui#8980 declared KNOWING nothing reads them ("declared
 * inert", the protocol declared them). `@objectstack/spec` 17.5.0 RETIRED both,
 * and the seat's Q4 ruling on objectui#11073 retired them on objectui's face as
 * `?: never` tombstones: the one bucket of protocol keys objectui still names,
 * named only to refuse them.
 *
 * `filterableFields` joined at the pin move to `@objectstack/spec` 18.0.0
 * (objectui#13261), out of {@link BUCKET_SPEC_RETIRED_AHEAD_OF_PIN}: objectui#13118
 * had tombstoned it on objectui's face ahead of the pin, and the installed
 * protocol now retires it too (objectstack#24640).
 */
const BUCKET_PROTOCOL_RETIRED_TOMBSTONED = ['filterableFields', 'pageName', 'tabs'] as const;

/** The marker each protocol-retired member's `?: never` docblock carries: the card that tombstoned it here. */
const PROTOCOL_RETIRED_TOMBSTONE_DOC: Readonly<Record<(typeof BUCKET_PROTOCOL_RETIRED_TOMBSTONED)[number], string>> = {
  filterableFields: 'RETIRED (objectui#13118)',
  pageName: 'RETIRED (objectui#11073)',
  tabs: 'RETIRED (objectui#11073)',
};

/**
 * The one objectui-only member that WAS read off a named view, until
 * objectui#7928. It was the whole cost of a by-reference mirror in one name: the
 * strict protocol value refuses it, and the renderer read it. The director
 * ruling on that card (comment 5856694523) removed the read and folds a stored
 * body's bag at `ViewPreview`, so it joined bucket ③. It is NOT tombstoned:
 * Q2 (i) of the same ruling keeps `NamedListView` exported and unchanged; its
 * retirement or narrowing follows objectui#7924's ruling A′ (which retired
 * `densityMode` and left `options` declared) and the `allowExport` ruling, not
 * that card ({@link BUCKET_LOCAL_ONLY_HELD}).
 */
const LOCAL_ONLY_READ = 'options';

/**
 * Bucket-③ members kept declared and NOT tombstoned by a ruling rather than by
 * a read: `options`, under objectui#7928's Q2 (i).
 */
const BUCKET_LOCAL_ONLY_HELD = [LOCAL_ONLY_READ] as const;

/** The `SHOW_FLAG_TO_USER_ACTION` fold lives here, and is read off disk. */
const FOLD = 'packages/core/src/utils/normalize-list-view.ts';

/** The syntactic roles every occurrence of the named-views RECORD may take. */
const RECORD_ROLES = [
  'COMPARISON', 'CONDITION', 'DECLARATION', 'ELEMENT_ACCESS', 'HOOK_DEPENDENCY',
  'OBJECT_ENTRIES', 'OBJECT_KEYS',
] as const;

/** The documented node; every assertion below is a delta on it. */
const NODE = { type: 'object-view', objectName: 'accounts' } as const;

/**
 * One value per mirrored key that the declaration admits — the accept leg.
 *
 * ⛔ `navigation` carries no `view` member: objectstack#18619 retired
 * `navigation.view` as an ADR-0049 tombstone (objectui#9667). `size` replaces
 * it as the second authored member, so the round-trip legs below still measure
 * "more than one authored member survives the parse".
 *
 * ⭐ Note for anyone tracing why this site was NOT among the diagnostics the
 * `Spec Main Shape Gate` printed: this annotation's VALUE type is `unknown`, so
 * no excess/incompatible-property check ever fires on the object literal — and
 * the one place it reaches a typed literal re-casts it (`as Record<Mirrored,
 * never>`). Two independent erasures; the site was invisible to `tsc`, ⛔ not
 * cleared by it.
 */
const ACCEPTED: Record<Mirrored, unknown> = {
  navigation: { mode: 'drawer', size: 'lg' },
  searchableFields: ['name', 'email'],
  filterableFields: ['status'],
  allowCreateView: true,
  viewActions: [{ type: 'share', icon: 'share-2' }, { type: 'delete' }],
  defaultViewType: 'kanban',
  defaultListView: 'all',
  showViewSwitcher: true,
};

/**
 * {@link ACCEPTED} without the key whose spec slot is a retirement tombstone at
 * the installed pin (objectui#13261): the value the accept legs below parse.
 * `filterableFields` is still MIRRORED — its slot is the spec's by reference —
 * but that slot is now the spec's `never`, so its leg is the refusal one.
 */
const ACCEPTED_LIVE = Object.fromEntries(
  Object.entries(ACCEPTED).filter(([key]) => key !== SPEC_RETIRED_UNREAD),
) as Record<ReadMirrored, unknown>;

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends (1 & T) ? true : false;

type ViewKind = 'grid' | 'kanban' | 'gallery' | 'calendar' | 'timeline' | 'gantt' | 'map';

// `defaultViewType`: the declaration's SEVEN-value union, optional, not `any`.
export type _DefaultViewTypeIsSevenUnion = Expect<Equal<TsObjectViewSchema['defaultViewType'], ViewKind | undefined>>;
export type _DefaultViewTypeIsNotAny = Expect<Equal<IsAny<TsObjectViewSchema['defaultViewType']>, false>>;
// `viewTabBar`: a `?: never` tombstone — the only value it admits is absence.
// Deleting the member instead would make this pin red (`any` through the index
// signature until objectui#8347, a non-compiling indexed access since), which is
// the point: the tombstone is load-bearing.
export type _ViewTabBarIsTombstone = Expect<Equal<TsObjectViewSchema['viewTabBar'], undefined>>;
export type _ViewTabBarIsNotAny = Expect<Equal<IsAny<TsObjectViewSchema['viewTabBar']>, false>>;
// `filterableFields` (objectui#13118): the spec retires the key and nothing
// reads it, but on this node the TS face is the list view's spec-derived slot
// BY REFERENCE — the same slot the zod twin carries — so the pin bump that
// takes the retirement narrows both faces at once. A local restatement (a
// `string[]` or a `?: never` written here) makes this pin red.
export type _FilterableFieldsIsTheSpecSlot = Expect<Equal<TsObjectViewSchema['filterableFields'], TsListViewSchema['filterableFields']>>;
export type _FilterableFieldsIsNotAny = Expect<Equal<IsAny<TsObjectViewSchema['filterableFields']>, false>>;
// `listViews`: the protocol's record since objectui#7928 — inverted from "STILL the
// declaration's local value", which this card (objectui#7779) pinned.
export type _ListViewsIsNoLongerTheLocalRecord = Expect<Equal<Equal<TsObjectViewSchema['listViews'], Record<string, NamedListView> | undefined>, false>>;
export type _ListViewsIsTheSpecRecord = Expect<Equal<TsObjectViewSchema['listViews'], Record<string, z.input<typeof SpecObjectListViewSchema>> | undefined>>;
// The control key is NOT declared: it resolved to `any` through the index
// signature, exactly as the ten did on the zod side before this card, until
// objectui#8347 removed the signature; it is no member now.
export type _ControlKeyIsNoMember = Expect<Equal<'viewSwitcherPosition' extends keyof TsObjectViewSchema ? true : false, false>>;
// Lit control for the detector: `IsAny` does answer `true`, so the `IsNotAny` lines are readings.
export type _IsAnyCanAnswerTrue = Expect<IsAny<any>>;

// The TS face accepts the documented shape on a literal.
export const literal: TsObjectViewSchema = { ...NODE, ...(ACCEPTED as Record<Mirrored, never>) };
// …REFUSES the retired spelling on a literal (an object is not `never`). This
// directive goes unused — and the type-check goes red with TS2578 — the moment
// the tombstone is widened back to `ViewTabBarConfig`. A deletion keeps it used
// since objectui#8347 (the key is refused as undeclared) and is caught by the
// tombstone `Equal` row above instead.
// @ts-expect-error — `viewTabBar` is RETIRED on this node (objectui#7779); it was never read
export const retiredLiteral: TsObjectViewSchema = { ...NODE, viewTabBar: { showAddButton: true } };
// …and REFUSES the host-only view kind: `tree` is not authorable here (objectui#5321).
// @ts-expect-error — `defaultViewType` is the seven-value union; `tree` is host composition only
export const hostOnlyLiteral: TsObjectViewSchema = { ...NODE, defaultViewType: 'tree' };

/* ── Off-disk derivations ─────────────────────────────────────────────────── */

function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** Every `schema.KEY` / `(schema as any).KEY` read in a source file, off disk. */
function schemaReads(rel: string): Set<string> {
  const src = readRepo(rel);
  return new Set([...src.matchAll(/\bschema(?: as any\))?\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
}

/** Every `currentNamedViewConfig?.KEY` read in the renderer — the named-view read set. */
function namedViewReads(): string[] {
  const src = readRepo(READER);
  return [...new Set([...src.matchAll(/currentNamedViewConfig(?: as any\))?\?\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))].sort();
}

/** Top-level members of `NamedListView`, counted off the declaration source. */
function namedListViewMemberCount(): number {
  const src = readRepo(DECLARATION);
  const start = src.indexOf('export interface NamedListView {');
  expect(start, 'NamedListView is no longer declared where this pin reads it').toBeGreaterThan(-1);
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end);
  return [...body.matchAll(/^ {2}[A-Za-z_$][\w$]*\??:/gm)].length;
}

/**
 * The SAME count with the indent anchor dropped — the looser instrument. It also
 * matches nested object-literal lines inside the members' inline types, which is
 * why it reads higher. Kept so the gap between the two instruments is an
 * assertion rather than a sentence: the retired "about 52 members" is a hand
 * figure that sits between them and is neither.
 */
function namedListViewLooseMemberCount(): number {
  const src = readRepo(DECLARATION);
  const start = src.indexOf('export interface NamedListView {');
  const end = src.indexOf('\n}\n', start);
  return [...src.slice(start, end).matchAll(/^\s*[A-Za-z_$][\w$]*\??:/gm)].length;
}

/* ── objectui#7924: the census instruments, by the TypeScript parser ────────
 * ⛔ NOT a regex and ⛔ NOT a brace-depth count. A brace parser on this repo has
 * already failed to terminate at an object's close (objectui#8071), and the two
 * regexes above are the instrument this pair replaces — they are kept only as
 * the cross-check that the reading did not move when the instrument did.
 */

function sourceFileOf(rel: string, kind: ts.ScriptKind): ts.SourceFile {
  const abs = join(REPO_ROOT, rel);
  return ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

function allNodes(sf: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = [];
  (function walk(n: ts.Node) { out.push(n); ts.forEachChild(n, walk); })(sf);
  return out;
}

/** Strip the wrappers an access rides through: `( )`, `!`, `as T`, `satisfies T`. */
function unwrapExpr(e: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) {
      e = e.expression;
      continue;
    }
    return e;
  }
}

/** Is `node` the call `Object.METHOD(...)`? */
function isObjectStatic(node: ts.Node, method: string): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrapExpr(node.expression);
  return ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && callee.expression.text === 'Object'
    && callee.name.text === method;
}

const DEP_ARRAY_HOOKS = new Set(['useMemo', 'useCallback', 'useEffect', 'useLayoutEffect']);

/**
 * The type names that mark a binding as ONE named view. `NamedViewConfig` is the
 * renderer's local alias for an entry of the mirrored `ObjectViewSchema['listViews']`
 * (objectui#7928); the pin below re-reads its definition, so the alias cannot
 * drift onto something else while this census keeps trusting the name.
 */
const NAMED_VIEW_TYPE_NAMES = new Set(['NamedListView', 'NamedViewConfig']);

interface NamedListViewCensus {
  /** Declared member names, in declaration order. */
  names: string[];
  /** The members with no `?` — the census records shape, not only names. */
  required: string[];
  /** Anything that is not a plain named property signature (index signature, call signature…). */
  nonProperty: string[];
  heritage: string[];
  /** The members whose declared type is the `never` keyword — `?: never` tombstones (objectui#7924). */
  tombstones: string[];
  /** Member name → the comment text immediately above it (its docblock). */
  docs: Record<string, string>;
}

/** `NamedListView`'s top-level members, walked off the interface's own AST. */
function namedListViewMembers(): NamedListViewCensus {
  const sf = sourceFileOf(DECLARATION, ts.ScriptKind.TS);
  let iface: ts.InterfaceDeclaration | undefined;
  for (const n of allNodes(sf)) {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'NamedListView') iface = n;
  }
  expect(iface, `\`NamedListView\` is no longer an interface declaration in ${DECLARATION}`).toBeDefined();
  const names: string[] = [];
  const required: string[] = [];
  const nonProperty: string[] = [];
  const tombstones: string[] = [];
  const docs: Record<string, string> = {};
  for (const m of iface!.members) {
    if (!ts.isPropertySignature(m)) { nonProperty.push(ts.SyntaxKind[m.kind]); continue; }
    const name = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : null;
    if (name === null) { nonProperty.push('ComputedPropertyName'); continue; }
    names.push(name);
    if (!m.questionToken) required.push(name);
    if (m.type?.kind === ts.SyntaxKind.NeverKeyword) tombstones.push(name);
    docs[name] = sf.text.slice(m.getFullStart(), m.getStart(sf));
  }
  return { names, required, nonProperty, tombstones, docs, heritage: (iface!.heritageClauses ?? []).map((h) => h.getText(sf)) };
}

interface NamedViewReadDerivation {
  /** Variables bound to the named-views RECORD (`schema.listViews`). */
  record: string[];
  /** Variables holding a single named VIEW. */
  valueBindings: string[];
  /** Property names read off a named view, sorted. */
  reads: string[];
  /** Read name → the 1-based lines it is read on. */
  readSites: Record<string, number[]>;
  /** `line:ROLE` for every occurrence of a record binding. */
  recordRoles: string[];
}

/**
 * What the renderer reads OFF A NAMED VIEW — kept strictly apart from what it
 * reads off `activeView` (the host's `views` prop), which is the whole finding:
 * `rowHeight`, read off `activeView` through the fold, is NOT a named-view read.
 *
 * Every route from the record to a named view is derived, not listed:
 *   RECORD  — a variable initialised from `schema.listViews`.
 *   VALUE   — a binding annotated `NamedListView`, or `NamedViewConfig` (the
 *             entry type of the mirrored `ObjectViewSchema['listViews']`,
 *             which types `currentNamedViewConfig` since objectui#7928); the
 *             value binding of
 *             `Object.entries(RECORD).map(([key, view]) => …)` (through an
 *             intermediate `const entries = …` too); or an element access
 *             straight off the RECORD.
 *   READ    — a property access whose object is a VALUE, after `( )` / `!` /
 *             `as any` are stripped. The cast is why `data` is found at all.
 *
 * `recordRoles` is the completeness half: every occurrence of the RECORD is
 * classified, so a NEW route to a named view lands as `UNCLASSIFIED` and fails
 * before this census can silently under-count.
 */
function deriveNamedViewReads(): NamedViewReadDerivation {
  const sf = sourceFileOf(READER, ts.ScriptKind.TSX);
  const all = allNodes(sf);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const record = new Set<string>();
  for (const n of all) {
    if (!ts.isVariableDeclaration(n) || !n.initializer || !ts.isIdentifier(n.name)) continue;
    const init = unwrapExpr(n.initializer);
    if (ts.isPropertyAccessExpression(init) && ts.isIdentifier(init.expression)
      && init.expression.text === 'schema' && init.name.text === LEDGERED) {
      record.add(n.name.text);
    }
  }

  const valueBindings = new Set<string>();
  for (const n of all) {
    if (!ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name) || !n.type) continue;
    let mentions = false;
    (function walk(t: ts.Node) {
      if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && NAMED_VIEW_TYPE_NAMES.has(t.typeName.text)) mentions = true;
      ts.forEachChild(t, walk);
    })(n.type);
    if (mentions) valueBindings.add(n.name.text);
  }

  const entryBindings = new Set<string>();
  for (const n of all) {
    if (!ts.isVariableDeclaration(n) || !n.initializer || !ts.isIdentifier(n.name)) continue;
    const init = unwrapExpr(n.initializer);
    if (!isObjectStatic(init, 'entries')) continue;
    const arg = init.arguments[0] && unwrapExpr(init.arguments[0]);
    if (arg && ts.isIdentifier(arg) && record.has(arg.text)) entryBindings.add(n.name.text);
  }
  const isEntriesOfRecord = (e: ts.Expression): boolean => {
    const x = unwrapExpr(e);
    if (ts.isIdentifier(x) && entryBindings.has(x.text)) return true;
    if (isObjectStatic(x, 'entries')) {
      const arg = x.arguments[0] && unwrapExpr(x.arguments[0]);
      return !!arg && ts.isIdentifier(arg) && record.has(arg.text);
    }
    return false;
  };
  for (const n of all) {
    if (!ts.isCallExpression(n)) continue;
    const callee = unwrapExpr(n.expression);
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'map') continue;
    if (!isEntriesOfRecord(callee.expression)) continue;
    const cb = n.arguments[0];
    if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) continue;
    const p0 = cb.parameters[0];
    if (!p0 || !ts.isArrayBindingPattern(p0.name)) continue;
    const el = p0.name.elements[1];
    if (el && ts.isBindingElement(el) && ts.isIdentifier(el.name)) valueBindings.add(el.name.text);
  }

  const isNamedViewValue = (e: ts.Expression): boolean => {
    const x = unwrapExpr(e);
    if (ts.isIdentifier(x) && valueBindings.has(x.text)) return true;
    if (ts.isElementAccessExpression(x)) {
      const obj = unwrapExpr(x.expression);
      return ts.isIdentifier(obj) && record.has(obj.text);
    }
    return false;
  };

  const readSites: Record<string, number[]> = {};
  for (const n of all) {
    if (!ts.isPropertyAccessExpression(n) || !isNamedViewValue(n.expression)) continue;
    (readSites[n.name.text] ??= []).push(lineOf(n));
  }

  const recordRoles: string[] = [];
  for (const n of all) {
    if (!ts.isIdentifier(n) || !record.has(n.text) || !n.parent) continue;
    const p = n.parent;
    const gp = p.parent as ts.Node | undefined;
    let role = 'UNCLASSIFIED';
    if (ts.isVariableDeclaration(p) && p.name === n) role = 'DECLARATION';
    else if (ts.isElementAccessExpression(p) && p.expression === n) role = 'ELEMENT_ACCESS';
    else if (ts.isNonNullExpression(p) && gp && ts.isElementAccessExpression(gp) && gp.expression === p) role = 'ELEMENT_ACCESS';
    else if (isObjectStatic(p, 'keys')) role = 'OBJECT_KEYS';
    else if (isObjectStatic(p, 'entries')) role = 'OBJECT_ENTRIES';
    else if (ts.isNonNullExpression(p) && gp && isObjectStatic(gp, 'keys')) role = 'OBJECT_KEYS';
    else if (ts.isNonNullExpression(p) && gp && isObjectStatic(gp, 'entries')) role = 'OBJECT_ENTRIES';
    else if (ts.isBinaryExpression(p)) role = 'COMPARISON';
    else if (ts.isIfStatement(p) && p.expression === n) role = 'CONDITION';
    else if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) role = 'CONDITION';
    else if (ts.isArrayLiteralExpression(p) && gp && ts.isCallExpression(gp) && gp.arguments[1] === p
      && ts.isIdentifier(gp.expression) && DEP_ARRAY_HOOKS.has(gp.expression.text)) role = 'HOOK_DEPENDENCY';
    recordRoles.push(`${lineOf(n)}:${role}`);
  }

  return {
    record: [...record].sort(),
    valueBindings: [...valueBindings].sort(),
    reads: Object.keys(readSites).sort(),
    readSites,
    recordRoles,
  };
}

function shapeKeys(schema: unknown): string[] {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

function shapeMember(schema: unknown, key: string): unknown {
  return (schema as { shape: Record<string, unknown> }).shape[key];
}

interface Issue {
  path?: readonly (string | number)[];
  message?: string;
  code?: string;
  /** zod 4 `invalid_union`: the issues of every option that was tried. */
  errors?: readonly (readonly Issue[])[];
}

/**
 * Every issue as `path` + `message`, with the nested option errors of an
 * `invalid_union` flattened in: `AnyComponentSchema` is a plain `z.union`, so
 * a refusal inside the `object-view` arm surfaces as one root `invalid_union`
 * issue whose `errors` carry the per-arm paths.
 */
function issueEntries(issues: readonly Issue[], prefix: readonly (string | number)[] = []): Array<{ path: string; message: string; code: string }> {
  const out: Array<{ path: string; message: string; code: string }> = [];
  for (const issue of issues) {
    const path = [...prefix, ...(issue.path ?? [])];
    out.push({ path: path.join('.'), message: issue.message ?? '', code: issue.code ?? '' });
    for (const nested of issue.errors ?? []) out.push(...issueEntries(nested, path));
  }
  return out;
}

function issuePaths(issues: readonly Issue[]): string[] {
  return issueEntries(issues).map((e) => e.path);
}

/** Does any issue sit AT the key or below it (`key`, `key.0`, `key.mode`)? */
function refusedAt(issues: readonly Issue[], key: string): boolean {
  return issuePaths(issues).some((p) => p === key || p.startsWith(`${key}.`));
}

/* ── The reads ────────────────────────────────────────────────────────────── */

describe('objectui#7779 — the renderer reads the eight mirrored keys, which is the fact the mirror records', () => {
  it('the batch is exactly the eight keys the card mirrored, in its three dispositions', () => {
    // Non-vacuity for every per-key assertion below, and the card's own bound.
    expect(SPEC_REFERENCED).toHaveLength(3);
    expect(SIBLING_REFERENCED).toHaveLength(2);
    expect(LOCAL_LITERALS).toHaveLength(3);
    expect(MIRRORED).toHaveLength(8);
    expect(new Set<string>(MIRRORED).size).toBe(8);
  });

  it.each(READ_MIRRORED)('`%s` is still read, as the exact text the docblocks cite', (key) => {
    for (const [file, text] of READ_TEXT[key]) {
      expect(readRepo(file), `${file} no longer reads \`${key}\` as \`${text}\``).toContain(text);
    }
  });

  it('the registration still exposes the three local literals as editable props', () => {
    const src = readRepo(REGISTRATION);
    for (const text of REGISTRATION_TEXT) expect(src).toContain(text);
  });

  it('the read set, derived from the renderer and the switcher, contains every mirrored key it still reads and the read control — and NOT the retired keys or the control key', () => {
    const reads = new Set([...schemaReads(READER), ...schemaReads(SWITCHER)]);
    for (const key of READ_MIRRORED) expect(reads.has(key), `renderer no longer reads schema.${key}`).toBe(true);
    // objectui#13118: the spec-retired mirrored key is read no longer — on the
    // same query that still finds its two spec-referenced siblings above.
    expect(reads.has(SPEC_RETIRED_UNREAD), `renderer reads schema.${SPEC_RETIRED_UNREAD} again`).toBe(false);
    // The positive control: the query that returns zero for `viewTabBar` is
    // the same query that returns `objectName`, so the zero is a reading.
    expect(reads.has(READ_CONTROL_KEY)).toBe(true);
    // The retirement's premise: nothing on this node ever read `viewTabBar`.
    // If the renderer starts reading it, the tombstone is wrong and this turns
    // red BEFORE anyone re-authors the key.
    expect(reads.has(RETIRED)).toBe(false);
    // Non-vacuity for the control key: if the renderer ever starts reading it,
    // this turns red and the control must be re-chosen, not declared on the
    // way past.
    expect(reads.has(CONTROL_KEY)).toBe(false);
  });

  it('INVERTED (objectui#13118): `filterableFields` is read off no source — not the node, not a named view, not the host `views` entry', () => {
    // Was "`filterableFields` is still read, as the exact text the docblocks
    // cite" — the three-rung relay into `ListView`'s Filter-panel whitelist.
    // `@objectstack/spec` 18 retires the key (objectstack#24640, ruling C) and
    // no per-view whitelist replaces it, so the relay and its reader came out.
    const src = readRepo(READER);
    expect(src).not.toMatch(/\bfilterableFields\s*:/);
    expect(namedViewReads()).not.toContain(SPEC_RETIRED_UNREAD);
    expect(src).not.toContain('activeView?.filterableFields');
    // Control on the same file and the same spelling: its sibling's rung stands.
    expect(src).toContain('searchableFields: currentNamedViewConfig?.searchableFields ?? activeView?.searchableFields ?? (schema as any).searchableFields,');
    // …and `NamedListView` carries the tombstone, while the node's two faces keep
    // the spec's slot by reference, which carries the spec's own tombstone in at
    // the pin bump that takes the retirement.
    expect(readRepo(DECLARATION).match(/filterableFields\?: never;/g)).toHaveLength(1);
    expect(readRepo(DECLARATION)).toContain("filterableFields?: ListViewSchema['filterableFields'];");
    expect(readRepo(DECLARATION)).toContain('RETIRED (objectui#13118)');
    expect(readRepo(MIRROR)).toContain('filterableFields: stripImportedDefaults(SpecListViewSchema).shape.filterableFields,');
  });

  it('`viewTabBar` reaches the tab bar only as a component PROP from the host, never off the node', () => {
    // The boundary the retirement's docblock states: `ViewTabBar` takes
    // `config?: ViewTabBarConfig` as a prop; the node renderer renders no tab
    // bar itself (ADR-0053, host owns the switcher).
    expect(readRepo('packages/plugin-view/src/ViewTabBar.tsx')).toContain('config?: ViewTabBarConfig;');
    expect(readRepo(READER)).not.toMatch(/<ViewTabBar\b/);
    expect(readRepo(READER)).not.toMatch(/\bviewTabBar\b/);
  });
});

/* ── The zod mirror: membership ───────────────────────────────────────────── */

describe('objectui#7779 — the zod mirror declares the eight keys and the tombstone; `listViews` joined them at objectui#7928', () => {
  it.each([...MIRRORED, RETIRED])('`%s` is a member of the mirror shape (membership cannot be read off acceptance under passthrough)', (key) => {
    expect(shapeKeys(ObjectViewSchema)).toContain(key);
  });

  it('`listViews` IS a member since objectui#7928 — the ledger entry the fallback clause kept is gone, and this pin moved with it', () => {
    // Inverted from "STILL not a member" (the objectui#7779 fallback clause).
    expect(shapeKeys(ObjectViewSchema)).toContain(LEDGERED);
  });

  it('`listViews` IS the spec\'s `ViewSchema.shape.listViews`, crossed through the import boundary — the record, by reference', () => {
    expect(shapeMember(ObjectViewSchema, LEDGERED)).toBe(shapeMember(stripImportedDefaults(SpecViewSchema), LEDGERED));
    // …whose value is the protocol's strict named-view schema (defaults stripped).
    const slot = shapeMember(ObjectViewSchema, LEDGERED) as { unwrap(): { def?: { valueType?: unknown }; _def?: { valueType?: unknown } } };
    const inner = slot.unwrap();
    expect((inner.def ?? inner._def)?.valueType).toBe(stripImportedDefaults(SpecObjectListViewSchema));
  });

  it('the control key is undeclared on the mirror too', () => {
    expect(shapeKeys(ObjectViewSchema)).not.toContain(CONTROL_KEY);
  });
});

/* ── By reference: the spec slots and the sibling slots ───────────────────── */

describe('objectui#7779 — the three spec-modelled keys are the spec\'s own slots BY REFERENCE', () => {
  it.each(SPEC_REFERENCED)('`%s` IS `SpecListViewSchema.shape.%s` — the same object, not a copy', (key) => {
    // ⭐ objectui#8317 (decision batch #90): the spec enters this package through
    // `stripImportedDefaults`, so the object to compare against is
    // `SpecListViewSchema` AS IT ARRIVES HERE. That hop removes the imported
    // `ZodDefault`s and nothing else — a slot with none comes back
    // reference-equal, which is why `searchableFields` and `filterableFields`
    // are unchanged by it and `navigation` (four defaults) is not.
    // ⛔ Still `toBe`: a local restatement is the drift objectui#4588 measured.
    expect(
      shapeMember(ObjectViewSchema, key),
      `ObjectViewSchema.${key} must be stripImportedDefaults(SpecListViewSchema).shape.${key} by ` +
        'reference — a local restatement is the drift objectui#4588 measured; if the spec slot is ' +
        'wrong, fix the spec',
    ).toBe(shapeMember(stripImportedDefaults(SpecListViewSchema), key));
  });

  it.each(SPEC_REFERENCED)('`%s` is also the slot `ObjectListViewSchema` carries under that name (the spec models it on both view faces)', (key) => {
    // Not identity — the spec builds the two objects separately — but the same
    // accept set on the probes below, which is what "models it" means.
    const a = shapeMember(SpecListViewSchema, key) as { safeParse(v: unknown): { success: boolean } };
    const b = shapeMember(SpecObjectListViewSchema, key) as { safeParse(v: unknown): { success: boolean } };
    for (const probe of [undefined, ACCEPTED[key], 'page', 42, ['a'], { mode: 'bogus' }]) {
      expect(a.safeParse(probe).success, `${key} disagrees on ${JSON.stringify(probe)}`).toBe(b.safeParse(probe).success);
    }
  });

  it('`navigation` parses exactly as the spec\'s `NavigationConfigSchema` does (the slot is that schema, optional)', () => {
    const slot = shapeMember(ObjectViewSchema, 'navigation') as { safeParse(v: unknown): { success: boolean; data?: unknown } };
    // The spec declares `mode: NavigationModeSchema.default('page')`, so a
    // config that omits the mode is legal authored metadata — the exact input
    // the hand copy of objectui#4588 refused. ⭐ It is STILL accepted, and since
    // objectui#8317 (decision batch #90) the parsed document no longer carries a
    // `mode` the author did not write: acceptance unchanged, substitution gone.
    //
    // ⛔ The carrier is `preventNavigation`, ⛔ not the `view` these legs used to
    // author: objectstack#18619 retired `navigation.view` (objectui#9667). These
    // are `safeParse` legs, so `view` was invisible to `tsc` here and the
    // `Spec Main Shape Gate` never printed them — but a tombstoned key REFUSES
    // at the parse, so on the spec that carries the retirement these three
    // assertions go red at RUNTIME. That is the break this repair removes, and
    // it is a different instrument from the type-level sites.
    const defaulted = slot.safeParse({ preventNavigation: true });
    expect(defaulted.success).toBe(true);
    expect((defaulted.data as { mode?: string }).mode).toBeUndefined();
    expect(defaulted.data).toEqual({ preventNavigation: true });
    // …and a document that DOES write it round-trips unchanged, which is what
    // separates "stopped substituting" from "stopped declaring".
    expect(slot.safeParse({ preventNavigation: true, mode: 'page' }).data)
      .toEqual({ preventNavigation: true, mode: 'page' });
    // ⚠️ Two comparisons, deliberately. The first is against the spec slot AS IT
    // ENTERS THIS PACKAGE — the object actually under test. The second is
    // against the RAW spec slot, and it is the measurement that says the strip
    // moved no accept set: every probe agrees with upstream, defaults or not.
    const enteredSlot = stripImportedDefaults(SpecNavigationConfigSchema).optional();
    for (const probe of [{ mode: 'drawer' }, { mode: 'bogus' }, 'page', { mode: 'page', bogus: 1 }, undefined]) {
      expect(slot.safeParse(probe).success, JSON.stringify(probe)).toBe(enteredSlot.safeParse(probe).success);
      expect(
        slot.safeParse(probe).success,
        `${JSON.stringify(probe)} — the strip must move no accept set`,
      ).toBe(SpecNavigationConfigSchema.optional().safeParse(probe).success);
    }
    // A string is refused at `navigation`, an unknown mode at `navigation.mode`:
    // the spec's strict object, not a local `z.any()`.
    expect(SpecNavigationConfigSchema.safeParse({ mode: 'bogus' }).success).toBe(false);
    expect(SpecNavigationConfigSchema.safeParse({ mode: 'page', bogus: 1 }).success).toBe(false);
  });

  // Inverted at objectui#13261: this row read "the spec describes
  // `filterableFields` as the legacy shorthand". The pin at `@objectstack/spec`
  // 18.0.0 carries the retirement, and the mirror inherits the tombstone by
  // reference — the flip the by-reference slot was kept for.
  it('the spec describes `filterableFields` as RETIRED — the tombstone the mirror now inherits by reference', () => {
    const slot = shapeMember(ObjectViewSchema, 'filterableFields') as { description?: string };
    expect(slot.description?.startsWith(PROTOCOL_TOMBSTONE_MARKER)).toBe(true);
    expect(slot.description).not.toMatch(/legacy shorthand for userFilters\.fields/i);
  });
});

describe('objectui#7779 — `allowCreateView` / `viewActions` are the sibling `ViewSwitcherSchema` slots BY REFERENCE', () => {
  it.each(SIBLING_REFERENCED)('`%s` IS `ViewSwitcherSchema.shape.%s` — one shape for the key the renderer forwards verbatim', (key) => {
    expect(shapeMember(ObjectViewSchema, key)).toBe(shapeMember(ViewSwitcherSchema, key));
  });

  it('the switcher slot admits exactly the four action types the declaration spells, and refuses a fifth', () => {
    const slot = shapeMember(ObjectViewSchema, 'viewActions') as { safeParse(v: unknown): { success: boolean } };
    for (const type of ['share', 'settings', 'duplicate', 'delete']) {
      expect(slot.safeParse([{ type }]).success, type).toBe(true);
    }
    expect(slot.safeParse([{ type: 'archive' }]).success).toBe(false);
    expect(slot.safeParse([{ icon: 'x' }]).success).toBe(false);
  });
});

/* ── The accept leg and the refusal leg, per key ──────────────────────────── */

describe('objectui#7779 — each mirrored key is accepted with its declared value and the value SURVIVES the parse', () => {
  it('the documented node with the seven live keys parses green, directly and through the union door', () => {
    // Seven since objectui#13261: the eighth, `filterableFields`, is the spec's
    // tombstone at the installed pin, and its leg is the refusal below.
    const doc = { ...NODE, ...ACCEPTED_LIVE };
    const r = ObjectViewSchema.safeParse(doc);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    const u = safeValidateSchema(doc);
    expect(u.success, u.success ? '' : JSON.stringify(u.error.issues)).toBe(true);
  });

  it('`filterableFields` is REFUSED by name on both entry paths — the mirrored slot is the spec\'s retirement tombstone (objectui#13261)', () => {
    const doc = { ...NODE, ...ACCEPTED_LIVE, [SPEC_RETIRED_UNREAD]: ACCEPTED[SPEC_RETIRED_UNREAD] };
    const r = ObjectViewSchema.safeParse(doc);
    expect(r.success).toBe(false);
    if (!r.success) {
      const issues = r.error.issues as readonly Issue[];
      expect(refusedAt(issues, SPEC_RETIRED_UNREAD)).toBe(true);
      expect(issues.some((i) => (i.message ?? '').includes('was removed in @objectstack/spec 18'))).toBe(true);
    }
    expect(safeValidateSchema(doc).success).toBe(false);
  });

  it.each(READ_MIRRORED)('`%s` survives the parse with its value (spec defaults may be added, nothing is dropped)', (key) => {
    const r = ObjectViewSchema.safeParse({ ...NODE, [key]: ACCEPTED_LIVE[key] });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (!r.success) return;
    const out = (r.data as Record<string, unknown>)[key];
    if (key === 'navigation') {
      // `NavigationConfigSchema` fills its defaults on parse; the authored
      // members are still there and unchanged.
      expect(out).toMatchObject(ACCEPTED_LIVE.navigation as Record<string, unknown>);
    } else {
      expect(out).toEqual(ACCEPTED_LIVE[key]);
    }
  });

  it.each(READ_MIRRORED)('`%s` is optional: the node without it parses green on both entry paths', (key) => {
    const doc: Record<string, unknown> = { ...NODE, ...ACCEPTED_LIVE };
    delete doc[key];
    expect(ObjectViewSchema.safeParse(doc).success).toBe(true);
    expect(safeValidateSchema(doc).success).toBe(true);
  });
});

describe('objectui#7779 — each mirrored key REFUSES a wrong-typed value AT its key: the enforcement mirroring adds', () => {
  it.each([
    ['navigation', 'page'],
    ['navigation', { mode: 'bogus' }],
    ['searchableFields', 'name'],
    ['searchableFields', [1]],
    ['filterableFields', 'status'],
    ['allowCreateView', 'yes'],
    ['viewActions', 'share'],
    ['viewActions', [{ type: 'archive' }]],
    ['defaultViewType', 'tree'],
    ['defaultViewType', 42],
    ['defaultListView', 7],
    ['showViewSwitcher', 'true'],
  ] as const)('refuses `%s` = %j at the key, directly and through the union door', (key, value) => {
    // Before this card every one of these rode `.passthrough()` unexamined.
    // This is the verdict that moves, and it moves toward refusal.
    const r = ObjectViewSchema.safeParse({ ...NODE, [key]: value });
    expect(r.success).toBe(false);
    if (!r.success) expect(refusedAt(r.error.issues as readonly Issue[], key), JSON.stringify(issuePaths(r.error.issues as readonly Issue[]))).toBe(true);
    const u = safeValidateSchema({ ...NODE, [key]: value });
    expect(u.success).toBe(false);
    if (!u.success) expect(refusedAt(u.error.issues as readonly Issue[], key), JSON.stringify(issuePaths(u.error.issues as readonly Issue[]))).toBe(true);
  });

  it('`defaultViewType` admits exactly the seven declared kinds — not the spec\'s nine (`chart` / `tree` are host composition only, objectui#5321)', () => {
    const slot = shapeMember(ObjectViewSchema, 'defaultViewType') as { safeParse(v: unknown): { success: boolean } };
    for (const kind of ['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'map']) {
      expect(slot.safeParse(kind).success, kind).toBe(true);
    }
    for (const kind of ['chart', 'tree', 'list', 'detail']) {
      expect(slot.safeParse(kind).success, kind).toBe(false);
    }
  });
});

/* ── The zod mirror: the retired key ──────────────────────────────────────── */

describe('objectui#7779 — the zod mirror REFUSES `viewTabBar` by name', () => {
  it('a `viewTabBar`-authored node is refused AT `viewTabBar`, and the message says why and what owns the config now', () => {
    const r = ObjectViewSchema.safeParse({ ...NODE, viewTabBar: { showAddButton: true } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const entries = issueEntries(r.error.issues as readonly Issue[]);
    const hit = entries.find((e) => e.path === RETIRED);
    expect(hit, JSON.stringify(entries)).toBeDefined();
    expect(hit?.message).toContain('RETIRED (objectui#7779)');
    expect(hit?.message).toContain('ViewTabBar');
    expect(hit?.message).toContain('config');
    // A tombstone reports `invalid_type` — the same code a bare `z.never()`
    // reports — so tooling that classifies refusals is unchanged.
    expect(hit?.code).toBe('invalid_type');
  });

  it('…and through the published union entry point', () => {
    const u = safeValidateSchema({ ...NODE, viewTabBar: {} });
    expect(u.success).toBe(false);
    if (!u.success) expect(refusedAt(u.error.issues as readonly Issue[], RETIRED)).toBe(true);
  });

  it('absent stays valid on both entry paths — a node that never wrote the key is untouched', () => {
    expect(ObjectViewSchema.safeParse(NODE).success).toBe(true);
    expect(safeValidateSchema(NODE).success).toBe(true);
  });

  it('the guidance is the SAME string on both author-facing channels (message and describe)', () => {
    const slot = shapeMember(ObjectViewSchema, RETIRED) as { description?: string };
    const r = ObjectViewSchema.safeParse({ ...NODE, viewTabBar: true });
    expect(r.success).toBe(false);
    if (r.success) return;
    const hit = issueEntries(r.error.issues as readonly Issue[]).find((e) => e.path === RETIRED);
    expect(slot.description).toBe(hit?.message);
  });

  it('both faces carry the tombstone, lockstep — off disk, so deleting either half is caught', () => {
    expect(readRepo(DECLARATION)).toContain('viewTabBar?: never;');
    expect(readRepo(DECLARATION)).toContain('RETIRED (objectui#7779)');
    expect(readRepo(MIRROR)).toContain('viewTabBar: retirementTombstone(');
  });
});

/* ── `listViews`: the measurement that keeps it in the ledger ─────────────── */

/**
 * The pages that author named list views (objectui#8255): three on an
 * `object-view` node, plus the CRUD guide's object definition, whose
 * `listViews` the spec types with the same `ObjectListViewSchema` value.
 */
const NAMED_VIEW_DOCS = [README, DOC, 'content/docs/api/schema-reference.md', 'content/docs/guide/building-crud-app.md'] as const;

/** A literal expression's value. Anything else THROWS, so a reading is never silently partial. */
function literalValue(node: ts.Expression, where: string): unknown {
  const e = unwrapExpr(node);
  if (ts.isObjectLiteralExpression(e)) {
    const out: Record<string, unknown> = {};
    for (const p of e.properties) {
      if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
        throw new Error(`${where}: \`${p.getText()}\` is not a literal property, so this reading cannot judge it`);
      }
      out[p.name.text] = literalValue(p.initializer, where);
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(e)) return e.elements.map((x) => literalValue(x, where));
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (e.kind === ts.SyntaxKind.NullKeyword) return null;
  throw new Error(`${where}: \`${e.getText()}\` is not a literal, so this reading cannot judge it`);
}

/**
 * Every named view a page authors, off disk: each fenced block that mentions
 * `listViews` is parsed with the TypeScript parser (a `json` body inside an
 * initializer), and the entries of every `listViews` property come back by name.
 */
function docNamedViews(rel: string): Array<{ where: string; view: unknown }> {
  const text = readRepo(rel);
  const out: Array<{ where: string; view: unknown }> = [];
  for (const m of text.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)) {
    const lang = m[1] ?? '';
    const body = m[2] ?? '';
    if (!body.includes('listViews')) continue;
    const at = `${rel}:${text.slice(0, m.index ?? 0).split('\n').length}`;
    const code = /^jsonc?$/.test(lang) ? `const doc = ${body};` : body;
    const sf = ts.createSourceFile(`${at}.tsx`, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const n of allNodes(sf)) {
      if (!ts.isPropertyAssignment(n) || !(ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) || n.name.text !== 'listViews') continue;
      const views = literalValue(n.initializer, at) as Record<string, unknown>;
      for (const [name, view] of Object.entries(views)) out.push({ where: `${at} listViews.${name}`, view });
    }
  }
  return out;
}

describe('objectui#7779 → objectui#7928 — `listViews` was ledgered on the fallback clause and is mirrored by reference now; the measurement stays pinned against the SPEC', () => {
  it('the spec slot `ViewSchema.listViews` is a record whose value is the strict `ObjectListViewSchema`', () => {
    const slot = shapeMember(SpecViewSchema, 'listViews') as { unwrap(): { def?: { type?: string; valueType?: unknown }; _def?: { type?: string; valueType?: unknown } } };
    const inner = slot.unwrap();
    const def = inner.def ?? inner._def;
    expect(def?.type).toBe('record');
    expect(def?.valueType).toBe(SpecObjectListViewSchema);
    // Strict: an unknown key is refused, not stripped — the reason a spec-typed
    // value cannot admit the local `NamedListView` vocabulary.
    const r = SpecObjectListViewSchema.safeParse({ label: 'x', columns: ['a'], options: {} });
    expect(r.success).toBe(false);
    if (!r.success) expect((r.error.issues as readonly Issue[]).some((i) => i.code === 'unrecognized_keys')).toBe(true);
  });

  it('the spec value REFUSES the named-view dialect this package\'s docs taught until objectui#8255 — the behaviour a by-reference mirror would have lost', () => {
    // README / plugin-view.mdx taught `listViews: { all: { label: 'All Users' } }`
    // — "each needs a `label`", nothing else. The spec requires `columns`.
    const labelOnly = SpecObjectListViewSchema.safeParse({ label: 'All Users' });
    expect(labelOnly.success).toBe(false);
    if (!labelOnly.success) expect(refusedAt(labelOnly.error.issues as readonly Issue[], 'columns')).toBe(true);
    // README taught a `filter`-only view with `type: 'grid'` and no `columns`.
    const filtered = SpecObjectListViewSchema.safeParse({ label: 'Under 100', type: 'grid', filter: [{ field: 'price', operator: 'less_than', value: 100 }] });
    expect(filtered.success).toBe(false);
    if (!filtered.success) expect(refusedAt(filtered.error.issues as readonly Issue[], 'columns')).toBe(true);
    // schema-reference.md taught an ObjectQL tuple filter. None of these three
    // forms has a doc side any more: objectui#8255 rewrote every one in the spec
    // shape, and the next test parses what those pages author now.
    const tuple = SpecObjectListViewSchema.safeParse({ label: 'My Deals', columns: ['name'], filter: [['owner', '=', '${currentUser.id}']] });
    expect(tuple.success).toBe(false);
    if (!tuple.success) expect(refusedAt(tuple.error.issues as readonly Issue[], 'filter')).toBe(true);
    // `flagged` has NO doc side, and its removal was deliberate: objectui#7923
    // (PR objectui#7991) deleted the per-view `default: true` flag from that
    // same `object-view` example, because `NamedListView` never declared the
    // key and `ObjectView` never read it. What is left is a refusal pinned on
    // its OWN merits — the spec closes `default` too, which is why that doc fix
    // is not merely cosmetic — so this case is no longer a reading of any shape
    // the docs teach. ⚠️ Nothing re-derives that absence: read the sentence
    // above as history, not as a live reading of that file.
    const flagged = SpecObjectListViewSchema.safeParse({ label: 'My Deals', columns: ['name'], default: true });
    expect(flagged.success).toBe(false);
    // The control: the shape the schema catalog authors IS accepted, so the
    // refusals above are readings of the dialect, not of the schema being
    // uniformly closed.
    expect(SpecObjectListViewSchema.safeParse({ label: 'Directory', columns: ['name', 'email'] }).success).toBe(true);
  });

  it('the docs now teach the spec shape — every named view the four pages author parses under `ObjectListViewSchema` (objectui#8255, off disk)', () => {
    // The predicate, and the SAME function the positive control below runs.
    const refused = (entries: ReadonlyArray<{ where: string; view: unknown }>): string[] =>
      entries.filter((e) => !SpecObjectListViewSchema.safeParse(e.view).success).map((e) => e.where);
    for (const doc of NAMED_VIEW_DOCS) {
      const entries = docNamedViews(doc);
      expect(entries.length, `${doc} authors no \`listViews\` entry any more — this reading would pass vacuously`).toBeGreaterThan(0);
      expect(
        refused(entries),
        `${doc} teaches a named view the spec's ObjectListViewSchema refuses. Every entry needs \`columns\`, and \`filter\` is \`{ field, operator, value }\` rule objects, never an ObjectQL tuple.`,
      ).toEqual([]);
    }
    // POSITIVE CONTROL: the predicate goes red on the dialect these pages taught
    // before objectui#8255, and stays quiet on the spec shape, so the empty
    // readings above are readings.
    expect(refused([
      { where: 'label-only', view: { label: 'All Users' } },
      { where: 'tuple', view: { label: 'My Deals', columns: ['name'], filter: [['owner', '=', '${currentUser.id}']] } },
      { where: 'spec', view: { label: 'Directory', columns: ['name', 'email'] } },
    ])).toEqual(['label-only', 'tuple']);
  });

  it('the renderer reads forty-two keys off a named view — every one of them a declared `NamedListView` member — of a declaration with 65, the reason a local key-for-key mirror was never the answer', () => {
    // ⚠️ The REGEX instrument sees forty-one, not forty-two: `name` is read only
    // at the tab strip (`view.name`), which `currentNamedViewConfig?.KEY` cannot
    // see. The AST derivation below finds it; the gap between the two is
    // asserted by name there rather than papered over here.
    expect(namedViewReads()).toEqual([...NAMED_VIEW_READS].filter((k) => k !== 'name'));
    // The tab strip reads `label` off the entries too — same member, second
    // site — and since objectui#8980 `name` between it and the record key.
    // objectui#7928 resolves it as the protocol's `I18nLabel` first; `view.label`
    // is still the read.
    expect(readRepo(READER)).toContain('{resolveInlineI18nLabel(view.label, displayLocale) || view.name || key}');
    // ALL forty-two are declared `NamedListView` members (objectui#10758's
    // bucket-① reads are protocol members declared since objectui#8980 or
    // before; objectui#13118 took `filterableFields` out of the read set). Since objectui#8980:
    // the seventeen the protocol declares on this surface landed with a read
    // point each, and `data` — which used to reach the renderer through an
    // `as any` cast on the named-view config — is one of them. So the "unread"
    // arithmetic below subtracts the whole read set rather than the read set
    // minus one. Both directions stay pinned: a member added or removed moves
    // the exact count and fails here; a read dropped shortens
    // `namedViewReads()` and fails above.
    const declared = namedListViewMembers().names.length;
    // HOW THIS NUMBER IS TAKEN: `namedListViewMembers()` — the TypeScript parser
    // walking the interface's own `PropertySignature` members (objectui#7924).
    // It REPLACED the regex `namedListViewMemberCount()`, which is kept beside it
    // and asserted to agree, so the instrument change is itself a measurement.
    // A looser count that drops that regex's two-space indent anchor also matches
    // nested object-literal lines inside the members' inline types and gives 59 on
    // the same declaration; a hand figure between the two is where the retired
    // "about 52 members" came from. ⛔ Do not re-derive the loose number and quote
    // it beside this one — they measure different things. The three instruments
    // are pinned against each other in the objectui#7924 census below.
    // Pinned EXACT rather than floored: the retired `>= 40` floor permitted the
    // declaration to shed seven members, including a shrink toward the read set,
    // which is exactly the condition that re-opens the `listViews` decision
    // (objectui#7928); and a floor cannot catch growth at all, so the quoted
    // figures could stale silently in either direction.
    expect(
      declared,
      'NamedListView\'s top-level member count moved (was 65 — 47 plus objectui#8980\'s seventeen plus objectui#12341\'s requiredPermissions). Re-derive it with this file\'s own namedListViewMemberCount() regex, then update the "64 declared / 43 unread" figures in the three files that carry them together — .changeset/object-view-unmirrored-keys-7779.md, packages/types/src/zod/objectql.zod.ts and packages/types/src/__tests__/zod-mirror-parity.test.ts — plus this file\'s own header. A shrink toward the read set also re-opens the listViews decision (objectui#7928).',
    ).toBe(65);
    expect(declared).toBeGreaterThan(NAMED_VIEW_READS.length);
  });

  it('the TS face declares `listViews` as the SPEC record since objectui#7928 — no longer the local one', () => {
    // Inverted from "still declares the local record (neither face moved)".
    expect(readRepo(DECLARATION)).not.toContain('listViews?: Record<string, NamedListView>;');
    expect(readRepo(DECLARATION)).toContain('listViews?: Record<string, z.input<typeof SpecObjectListViewSchema>>;');
    // The renderer types its named-view config off that member, not off `NamedListView`.
    expect(readRepo(READER)).toContain("type NamedViewConfig = NonNullable<ObjectViewSchema['listViews']>[string];");
    expect(readRepo(READER)).toContain('const currentNamedViewConfig: NamedViewConfig | null = useMemo(() => {');
  });
});

/* ── objectui#7924: the per-member liveness census ────────────────────────── */

describe('objectui#7924 — the per-member liveness census on `NamedListView`, re-derived by the TypeScript parser', () => {
  it('the declaration is a plain interface — no heritage clause, no index signature, no computed member — so its property signatures ARE the population', () => {
    const { nonProperty, heritage, required } = namedListViewMembers();
    // Each of these would silently widen the population the census claims to
    // cover: inherited members are not walked, and an index signature admits
    // names no member list can enumerate.
    expect(nonProperty, 'a non-property member appeared; "the property signatures" is no longer the whole population').toEqual([]);
    expect(heritage, '`NamedListView` gained a heritage clause; inherited members are NOT in this census').toEqual([]);
    // `label` is the one member without a `?`. The census records shape, not
    // just names: a member turning required (or optional) moves what an author
    // must write, so it is pinned too.
    expect(required).toEqual(['label']);
  });

  it('the declared member set is EXACTLY the census, by name', () => {
    expect([...namedListViewMembers().names].sort()).toEqual([...NAMED_LIST_VIEW_DECLARED].sort());
    expect(NAMED_LIST_VIEW_DECLARED).toHaveLength(65);
    expect(new Set<string>(NAMED_LIST_VIEW_DECLARED).size).toBe(65);
  });

  it('all three instruments read the same declaration, and the two that disagree disagree for a stated reason', () => {
    const ast = namedListViewMembers().names.length;
    // The parser and the strict regex agree — that agreement is what licenses
    // replacing the regex without re-opening the number.
    expect(ast).toBe(65);
    expect(namedListViewMemberCount()).toBe(ast);
    // …and the loose regex does NOT, by 9, because it also counts nested
    // object-literal lines. The gap stayed exactly 12 through objectui#8980:
    // every one of the seventeen new members is a single-line type reference,
    // so none of them adds a nested object literal for the loose instrument to
    // over-count. objectui#11227 took it from 12 to 9: `emptyState` stopped
    // restating `{ title, message, icon }` as a nested literal and indexes
    // `ListViewSchema['emptyState']` instead, so its three nested lines left
    // and the member count did not move. objectui#12341's `requiredPermissions`
    // is a single-line type reference too, so it moved both counts by one and
    // left the gap at 9. Pinned so "a figure between two
    // instruments is neither" stays a reading rather than a remembered sentence.
    expect(namedListViewLooseMemberCount()).toBe(74);
    expect(namedListViewLooseMemberCount()).toBeGreaterThan(ast);
  });

  it('every route from `schema.listViews` to a named view is the one this census walks', () => {
    const d = deriveNamedViewReads();
    expect(d.record, 'the named-views record is bound somewhere new').toEqual(['namedListViews']);
    // Two bindings hold a single named view: the memoised active config, and
    // the tab strip's `Object.entries(...).map(([key, view]) => …)` element.
    expect(d.valueBindings).toEqual(['currentNamedViewConfig', 'view']);
  });

  it('every occurrence of the record sits in a CLASSIFIED role — a new route fails here before the census can go stale', () => {
    const roles = deriveNamedViewReads().recordRoles;
    expect(roles.length).toBeGreaterThan(0);
    const unclassified = roles.filter((r) => r.endsWith(':UNCLASSIFIED'));
    expect(
      unclassified,
      'a new syntactic route from `schema.listViews` to a named view appeared at these lines. '
        + 'The read set below cannot be trusted until it is walked too: extend `deriveNamedViewReads()`, '
        + 'then re-derive the census — do NOT add the role to RECORD_ROLES to make this green.',
    ).toEqual([]);
    for (const role of roles) {
      expect(RECORD_ROLES as readonly string[]).toContain(role.split(':')[1]);
    }
  });

  it('the renderer reads exactly forty-two names off a named view — every one of them declared', () => {
    const d = deriveNamedViewReads();
    expect(d.reads).toEqual([...NAMED_VIEW_READS]);
    // 43 until objectui#13118 stopped reading the spec-retired `filterableFields`.
    expect(d.reads).toHaveLength(42);
    // ⭐ THE INSTRUMENTS NOW DISAGREE BY ONE NAME, and the difference is pinned
    // rather than smoothed over. The AST finds STRICTLY more than the
    // `currentNamedViewConfig?.KEY` regex it replaced — that was already true
    // for SITES (`{view.label || …}` on the tab strip is a named-view read the
    // regex cannot see), and objectui#8980 made it true for a NAME as well:
    // `name` is read ONLY at that tab strip. So the regex is a subset, and the
    // members it cannot see are asserted by name.
    const regexOnly = namedViewReads();
    expect(regexOnly.filter((r) => !d.reads.includes(r)), 'the regex found a read the AST did not — the AST is the authority and must be extended').toEqual([]);
    expect(
      d.reads.filter((r) => !regexOnly.includes(r)),
      'the set of named-view reads the `currentNamedViewConfig?.KEY` regex cannot see moved. '
        + 'It is the tab strip\'s `view.KEY` reads; re-derive it rather than widening this expectation.',
    ).toEqual(['name']);
    expect(d.readSites.label.length, '`label` is read at two sites: the delegation and the tab strip').toBe(2);
    expect(d.readSites.name.length, '`name` is read at exactly one site: the tab strip\'s display fallback').toBe(1);
  });

  it('the census partitions the declaration exactly: 42 read + 23 unread = 65, disjoint and exhaustive (43 + 22 until objectui#13118)', () => {
    const declared = new Set(namedListViewMembers().names);
    const reads = new Set(deriveNamedViewReads().reads);
    const read = [...declared].filter((m) => reads.has(m)).sort();
    const unread = [...declared].filter((m) => !reads.has(m)).sort();
    expect(read).toEqual([...NAMED_VIEW_READ_DECLARED]);
    expect(unread).toEqual([...NAMED_LIST_VIEW_UNREAD]);
    expect(read).toHaveLength(42);
    expect(unread).toHaveLength(23);
    expect(read.length + unread.length).toBe(declared.size);
    expect(read.filter((m) => unread.includes(m))).toEqual([]);
  });

  it('`data` is READ off a named view and now DECLARED — objectui#7928\'s open half, answered by the objectui#8980 ruling', () => {
    const declared = new Set(namedListViewMembers().names);
    const reads = deriveNamedViewReads();
    const undeclared = reads.reads.filter((r) => !declared.has(r));
    // EMPTY, and the emptiness is the reading: nothing the renderer reads off a
    // named view is undeclared any more. A name appearing here is a new
    // cast-only read, which is the class objectui#7928 sends to a ruling — ⛔ do
    // not add it to NAMED_VIEW_READ_UNDECLARED to make this green.
    expect(undeclared).toEqual([...NAMED_VIEW_READ_UNDECLARED]);
    expect(undeclared).toHaveLength(0);
    expect(declared.has('data'), '`data` is a declared member since objectui#8980; the census arithmetic subtracts the whole read set').toBe(true);
    expect(reads.reads).toContain('data');
    // …and it is reached through the DECLARED path: the cast on the named-view
    // config is gone. The two neighbouring casts are untouched and stay — the
    // host `views` entry is an untyped host shape, and `data` on the node is one
    // of the 27 objectui#5097 host-composition keys.
    expect(readRepo(READER)).toContain('data: currentNamedViewConfig?.data ?? (activeView as any)?.data ?? (schema as any).data,');
    expect(readRepo(READER)).not.toContain('(currentNamedViewConfig as any)?.data');
  });

  it.each(NAMED_VIEW_READ_DECLARED)('READ — `%s` is declared AND read off a named view', (member) => {
    expect(namedListViewMembers().names, `\`${member}\` is no longer declared`).toContain(member);
    expect(deriveNamedViewReads().reads, `\`${member}\` is no longer read off a named view`).toContain(member);
  });

  it.each(NAMED_LIST_VIEW_UNREAD)('UNREAD — `%s` is declared and NOT read off a named view', (member) => {
    expect(namedListViewMembers().names, `\`${member}\` is no longer declared`).toContain(member);
    expect(
      deriveNamedViewReads().reads,
      `\`${member}\` is now READ off a named view. That is the census moving, not a test to update: `
        + 'move it to NAMED_VIEW_READ_DECLARED, re-derive the counts, and say so on objectui#7924 — '
        + 'the listViews mirror decision (objectui#7928) reads these two sets.',
    ).not.toContain(member);
  });

  it('the controls fire on the same instruments that produce every zero above', () => {
    const declared = namedListViewMembers().names;
    const reads = deriveNamedViewReads().reads;
    // ⭐ The firing control. The query that returns NOTHING for the unread
    // members is the query that returns `columns` — so a zero is a reading and
    // not a parser that found nothing.
    expect(reads).toContain(NAMED_VIEW_READ_CONTROL);
    expect(declared).toContain(NAMED_VIEW_READ_CONTROL);
    // …and its negative twin: declared, and NOT read off a named view. It is
    // read off the node instead — which is the distinction the whole finding
    // turns on. (`rowHeight` held this role until objectui#10758 made the
    // delegation read it off the named view first; objectui#11013 dropped the
    // `activeView` half of this read.)
    expect(declared).toContain(NAMED_VIEW_UNREAD_CONTROL);
    expect(reads).not.toContain(NAMED_VIEW_UNREAD_CONTROL);
    expect(readRepo(READER)).toContain('allowExport: (schema as any).allowExport,');
    // A spelling that is in neither set: non-vacuity for both probes at once.
    expect(declared).not.toContain(NAMED_VIEW_ABSENT_CONTROL);
    expect(reads).not.toContain(NAMED_VIEW_ABSENT_CONTROL);
  });

  it('INVERTED (objectui#10758): the two members that were absent from the renderer ENTIRELY are read off a named view now', () => {
    // Was "two unread members are absent from the renderer ENTIRELY — no
    // named-view read, no `activeView` read, no node read". objectui#10758 gave
    // each a rung on the host delegation: the named view first, then the host
    // `views` entry, and ⛔ no node read (the objectui#5097 exemption is fixed
    // at 27 names). So the absence became a read, in both instruments.
    const src = readRepo(READER);
    const reads = deriveNamedViewReads().reads;
    for (const member of WERE_ABSENT_FROM_RENDERER) {
      expect(NAMED_LIST_VIEW_UNREAD as readonly string[]).not.toContain(member);
      expect(reads, `\`${member}\` is no longer read off a named view`).toContain(member);
      expect(src).toContain(`${member}: currentNamedViewConfig?.${member} ?? activeView?.${member},`);
      expect(src, `\`${member}\` is now read off the object-view NODE — a 28th objectui#5097 exemption`)
        .not.toContain(`(schema as any).${member}`);
    }
    // The control for those two node-absences: a member that IS read off the
    // node, measured by the same query. Without it "not found" is an unrun grep.
    expect(src).toContain(`(schema as any).${NAMED_VIEW_UNREAD_CONTROL}`);
  });
});

/* ── Controls: what did NOT move ──────────────────────────────────────────── */

describe('objectui#7779 — neighbouring keys did not move, and the passthrough envelope is untouched', () => {
  it.each(['showSearch', 'showFilters', 'showSort', 'showCreate', 'showRefresh', 'layout', 'operations', 'table', 'form', 'title', 'description'])(
    '`%s` is still a mirror member',
    (key) => {
      expect(shapeKeys(ObjectViewSchema)).toContain(key);
    },
  );

  it('a neighbour still refuses a wrong-typed value the way it did before (`showSearch`, `layout`)', () => {
    const a = ObjectViewSchema.safeParse({ ...NODE, showSearch: 'yes' });
    expect(a.success).toBe(false);
    if (!a.success) expect(refusedAt(a.error.issues as readonly Issue[], 'showSearch')).toBe(true);
    const b = ObjectViewSchema.safeParse({ ...NODE, layout: 'popover' });
    expect(b.success).toBe(false);
    if (!b.success) expect(refusedAt(b.error.issues as readonly Issue[], 'layout')).toBe(true);
  });

  it('the host-composition surface still rides the passthrough (objectui#5097) — this card declared the measured keys and nothing else', () => {
    const r = ObjectViewSchema.safeParse({ ...NODE, wrapHeaders: true, [CONTROL_KEY]: 'left' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).wrapHeaders).toBe(true);
      expect((r.data as Record<string, unknown>)[CONTROL_KEY]).toBe('left');
    }
  });

  it('the mirror still requires the discriminator and the object binding', () => {
    expect(ObjectViewSchema.safeParse({ objectName: 'accounts' }).success).toBe(false);
    expect(ObjectViewSchema.safeParse({ type: 'object-view' }).success).toBe(false);
  });
});

/* ── Docs: the two tables that taught `viewTabBar` as authorable ──────────── */

describe('objectui#7779 — the docs no longer teach `viewTabBar` as an `object-view` node key', () => {
  it.each([README, DOC])('%s lists `ViewTabBarConfig` as the `ViewTabBar` prop, and drops `viewTabBar` from the node row', (file) => {
    const src = readRepo(file);
    const nodeRow = src.split('\n').find((line) => line.startsWith('| `ObjectViewSchema` |'));
    expect(nodeRow, 'the import table lost its ObjectViewSchema row').toBeDefined();
    expect(nodeRow).not.toMatch(/`viewTabBar`,/);
    expect(nodeRow).toContain('`viewTabBar` is retired');
    const configRow = src.split('\n').find((line) => line.startsWith('| `ViewTabBarConfig` |'));
    expect(configRow).toContain('`config` prop of `ViewTabBar`');
  });
});

/* ── objectui#7924 — the disposition buckets, against the PROTOCOL ────────── */

/** The protocol's named-list-view member set, off the installed schema object. */
function protocolListViewKeys(): string[] {
  return shapeKeys(SpecObjectListViewSchema).sort();
}

/** The protocol keys whose slot carries the retirement marker in its description. */
function protocolRetiredKeys(): string[] {
  return protocolListViewKeys()
    .filter((key) => ((shapeMember(SpecObjectListViewSchema, key) as { description?: string } | undefined)?.description ?? '')
      .startsWith(PROTOCOL_TOMBSTONE_MARKER))
    .sort();
}

/** `SHOW_FLAG_TO_USER_ACTION`, read off the runtime fold rather than restated. */
function foldFlagMap(): Record<string, string> {
  const src = readRepo(FOLD);
  const start = src.indexOf('const SHOW_FLAG_TO_USER_ACTION: Record<string, string> = {');
  expect(start, `\`SHOW_FLAG_TO_USER_ACTION\` is no longer declared in ${FOLD}`).toBeGreaterThan(-1);
  const end = src.indexOf('\n};', start);
  const body = src.slice(start, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^ {2}([A-Za-z_$][\w$]*):[ ]'([^']+)',$/gm)) out[m[1]] = m[2];
  return out;
}

describe('objectui#7924 — the unread members, in the FOUR buckets the ruling was written in plus the server-enforced fifth (objectui#12341) and the retired-ahead-of-the-pin sixth (objectui#13118), derived against the installed protocol (bucket ① empty since objectui#10758)', () => {
  it('the protocol declares 51 keys for a named list view, and the instrument that reads them fires', () => {
    const keys = protocolListViewKeys();
    expect(keys).toEqual([...PROTOCOL_LIST_VIEW_KEYS]);
    expect(keys).toHaveLength(51);
    // Firing control + its negative twin, on the same query that produces every
    // "the protocol declares this nowhere" zero below.
    expect(keys).toContain(NAMED_VIEW_READ_CONTROL);
    expect(keys).not.toContain(NAMED_VIEW_ABSENT_CONTROL);
  });

  it('eight of the 51 are RETIREMENT TOMBSTONES, refused BY NAME — so objectui not declaring them LIVE is agreement, not narrowness', () => {
    expect(protocolRetiredKeys()).toEqual([...PROTOCOL_RETIRED_KEYS]);
    const base = { label: 'Directory', columns: ['name', 'email'] };
    // The accept leg first: without it every refusal below is a schema that
    // refuses everything rather than a reading of these eight keys.
    expect(SpecObjectListViewSchema.safeParse(base).success).toBe(true);
    for (const key of PROTOCOL_RETIRED_KEYS) {
      const r = SpecObjectListViewSchema.safeParse({ ...base, [key]: true });
      expect(r.success, `the protocol no longer refuses the retired \`${key}\``).toBe(false);
      if (!r.success) {
        const issues = r.error.issues as readonly Issue[];
        // Refused AT the key with the protocol's own prescription — ⛔ not
        // swallowed as an unknown key, which is what a deleted member would do.
        expect(refusedAt(issues, key)).toBe(true);
        expect(issues.some((i) => (i.message ?? '').includes(PROTOCOL_TOMBSTONE_MARKER)
          || (i.message ?? '').includes('was removed in @objectstack/spec'))).toBe(true);
      }
    }
    // …and none of the eight is declared LIVE on the objectui face. Five were
    // never declared; the two objectui#8980 declared are `?: never` tombstones
    // since objectui#11073, and `filterableFields` since objectui#13118, each
    // refused by name on this face as on the protocol's.
    const { names, tombstones } = namedListViewMembers();
    const declaredLive = names.filter((n) => !tombstones.includes(n));
    expect(PROTOCOL_RETIRED_KEYS.filter((k) => declaredLive.includes(k))).toEqual([]);
    expect(PROTOCOL_RETIRED_KEYS.filter((k) => tombstones.includes(k))).toEqual([...BUCKET_PROTOCOL_RETIRED_TOMBSTONED]);
  });

  it('objectui declares every LIVE protocol key on this surface — the narrower-than-protocol direction is EMPTY (inverted from "but the one pending its ruling" at objectui#12341)', () => {
    const declared = new Set(namedListViewMembers().names);
    const live = protocolListViewKeys().filter((k) => !protocolRetiredKeys().includes(k));
    // 43 since objectui#13261 took the retirement of `filterableFields`.
    expect(live).toHaveLength(43);
    const missing = live.filter((k) => !declared.has(k));
    // ⭐ objectui#8979 measured SEVENTEEN live protocol keys missing here; the
    // objectui#8980 ruling declared them (PR #9534) and this is the zero that
    // records it. ⛔ A name appearing here is objectui going narrower than the
    // protocol — the direction the maintainer principle forbids.
    //
    // ⚠️ ONE name stood here from `@objectstack/spec` 18 until objectui#12341,
    // pinned PENDING by objectui#12030: `requiredPermissions`, the audience gate
    // the SERVER enforces before it serves a view. objectui#12341 declared it
    // and the census reads it in its own server-enforced bucket
    // ({@link BUCKET_SERVER_ENFORCED_UNREAD}), ⛔ not bucket ①.
    expect(missing, 'objectui is narrower than the protocol on these live keys').toEqual([]);
    for (const key of BUCKET_SERVER_ENFORCED_UNREAD) expect(declared.has(key)).toBe(true);
    // The control for that zero: the SAME set difference over the SAME two key
    // sets is non-empty in the other direction, so the emptiness is a reading.
    const localOnly = [...declared].filter((k) => !protocolListViewKeys().includes(k)).sort();
    expect(localOnly).toHaveLength(19);
    // `options` is counted once: it sits in bucket ③ since objectui#7928.
    expect(localOnly).toEqual([
      ...BUCKET_LEGACY_SHOW_SPELLINGS, ...BUCKET_LOCAL_ONLY_UNREAD,
    ].sort());
    expect(BUCKET_LOCAL_ONLY_UNREAD as readonly string[]).toContain(LOCAL_ONLY_READ);
  });

  it('NO objectui-only member is read off a named view since objectui#7928 — the one that was, `options`, is folded at `ViewPreview`', () => {
    const reads = deriveNamedViewReads().reads;
    const protocolKeys = protocolListViewKeys();
    const localOnlyRead = reads.filter((r) => !protocolKeys.includes(r));
    // Inverted from `[LOCAL_ONLY_READ]`: the renderer read `options` off a named
    // view until the director ruling on objectui#7928 removed both reads.
    expect(localOnlyRead).toEqual([]);
    expect(localOnlyRead).not.toContain(LOCAL_ONLY_READ);
    expect(readRepo(READER)).not.toContain(`currentNamedViewConfig?.${LOCAL_ONLY_READ}`);
    // Control on the same query: a canonical block IS read off the same binding.
    expect(readRepo(READER)).toContain('currentNamedViewConfig?.kanban');
    // And the strict protocol value refuses it BY NAME, which is why the mirror
    // is still not a drop-in — the same fact objectui#7928 weighs.
    const r = SpecObjectListViewSchema.safeParse({ label: 'x', columns: ['a'], [LOCAL_ONLY_READ]: {} });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect((r.error.issues as readonly Issue[]).some((i) => i.code === 'unrecognized_keys')).toBe(true);
    }
  });

  it('`.omit().extend().superRefine()` STILL refuses unknown keys under zod 4 — measured, not read off `strictObject`', () => {
    // ⚠️ Carried as NOT MEASURED by the 2026-09-10 protocol sweep and by the
    // triage that answered it; executed here. If this ever flips, bucket ③'s
    // "the protocol refuses these" weakens to "does not declare these".
    const base = { label: 'Directory', columns: ['name', 'email'] };
    expect(SpecObjectListViewSchema.safeParse(base).success).toBe(true);
    for (const key of [LOCAL_ONLY_READ, 'showSearch', 'densityMode', NAMED_VIEW_ABSENT_CONTROL]) {
      const r = SpecObjectListViewSchema.safeParse({ ...base, [key]: key === LOCAL_ONLY_READ ? {} : true });
      expect(r.success, `the strict protocol value now ADMITS \`${key}\``).toBe(false);
      if (!r.success) {
        const issues = r.error.issues as readonly Issue[];
        expect(issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
      }
    }
  });

  it('the 23 unread members partition SIX ways — 0 + 8 + 11 + 3 + 1 + 0 since objectui#13261 (0 + 8 + 11 + 2 + 1 + 1 since objectui#13118, 0 + 8 + 11 + 2 + 1 before it, 0 + 8 + 11 + 2 before objectui#12341, 23 + 8 + 11 + 2 before objectui#10758) — disjoint and exhaustive', () => {
    const unread = new Set(NAMED_LIST_VIEW_UNREAD as readonly string[]);
    const protocolKeys = new Set(protocolListViewKeys());
    const retiredTombstoned = new Set<string>(BUCKET_PROTOCOL_RETIRED_TOMBSTONED);
    const serverEnforced = new Set<string>(BUCKET_SERVER_ENFORCED_UNREAD);
    const retiredAheadOfPin = new Set<string>(BUCKET_SPEC_RETIRED_AHEAD_OF_PIN);
    const spellings = new Set<string>(BUCKET_LEGACY_SHOW_SPELLINGS);

    const protocolLive = [...unread].filter((m) => protocolKeys.has(m) && !retiredTombstoned.has(m));
    const protocolDeclared = protocolLive.filter((m) => !serverEnforced.has(m) && !retiredAheadOfPin.has(m)).sort();
    expect(protocolLive.filter((m) => serverEnforced.has(m)).sort()).toEqual([...BUCKET_SERVER_ENFORCED_UNREAD]);
    expect(protocolLive.filter((m) => retiredAheadOfPin.has(m)).sort()).toEqual([...BUCKET_SPEC_RETIRED_AHEAD_OF_PIN]);
    const localOnly = [...unread].filter((m) => !protocolKeys.has(m)).sort();
    const legacy = localOnly.filter((m) => spellings.has(m)).sort();
    const inventedOnly = localOnly.filter((m) => !spellings.has(m)).sort();

    expect(protocolDeclared).toEqual([...BUCKET_PROTOCOL_DECLARED_UNREAD]);
    expect(legacy).toEqual([...BUCKET_LEGACY_SHOW_SPELLINGS]);
    expect(inventedOnly).toEqual([...BUCKET_LOCAL_ONLY_UNREAD]);
    expect([...retiredTombstoned].sort()).toEqual([...BUCKET_PROTOCOL_RETIRED_TOMBSTONED]);
    // Bucket ① is EMPTY since objectui#10758: every protocol member left on the
    // unread side is one of the two the protocol retired at 17.5.0 (objectui#8980's
    // "declared inert" pair, tombstoned since objectui#11073). Derived, not assumed.
    expect(protocolDeclared).toHaveLength(0);
    expect(legacy).toHaveLength(8);
    expect(inventedOnly).toHaveLength(11);
    expect(BUCKET_PROTOCOL_RETIRED_TOMBSTONED).toHaveLength(3);
    expect(BUCKET_SERVER_ENFORCED_UNREAD).toHaveLength(1);
    expect(BUCKET_SPEC_RETIRED_AHEAD_OF_PIN).toHaveLength(0);
    // Exhaustive and disjoint against the census's own unread set: a member that
    // lands in no bucket, or in two, fails here — which is the event that makes
    // the 2026-09-16 disposition ruling stale.
    const union = [
      ...protocolDeclared, ...legacy, ...inventedOnly, ...BUCKET_PROTOCOL_RETIRED_TOMBSTONED, ...BUCKET_SERVER_ENFORCED_UNREAD,
      ...BUCKET_SPEC_RETIRED_AHEAD_OF_PIN,
    ];
    expect(union).toHaveLength(23);
    expect(new Set(union).size).toBe(23);
    expect([...union].sort()).toEqual([...unread].sort());
  });

  it('the runtime fold maps seven of the eight legacy spellings, and folds the eighth — read off the fold, not restated', () => {
    const map = foldFlagMap();
    expect(Object.keys(map).sort()).toEqual(
      BUCKET_LEGACY_SHOW_SPELLINGS.filter((s) => s !== 'showDescription').slice().sort(),
    );
    for (const [flag, action] of Object.entries(map)) {
      expect(LEGACY_SHOW_SPELLING_TWINS[flag]).toEqual(['userActions', action]);
    }
    // The eighth is folded by its own branch, not by the table.
    const src = readRepo(FOLD);
    expect(src).toContain('appearance.showDescription = s.showDescription;');
    expect(src).toContain('delete next.showDescription;');
    // Control: a flag the fold does NOT know, measured by the same query.
    expect(map).not.toHaveProperty('showRecordCount');
  });

  it('BUCKET ① is EMPTY since objectui#10758 — no LIVE protocol member is left unread off a named view', () => {
    expect([...BUCKET_PROTOCOL_DECLARED_UNREAD]).toEqual([]);
    const reads = deriveNamedViewReads().reads;
    const live = protocolListViewKeys().filter((k) => !protocolRetiredKeys().includes(k));
    const declared = namedListViewMembers().names;
    const unreadProtocol = live.filter((k) => declared.includes(k) && !reads.includes(k)).sort();
    // Was the objectui#8980 pair until `@objectstack/spec` 17.5.0 retired both;
    // a retired key is not live, so the set was empty (objectui#11073). Since
    // objectui#12341 it holds the server-enforced bucket — a live protocol
    // member read off no named view BY DESIGN — and since objectui#13118 the
    // member retired on objectstack `main` ahead of this pin; nothing else.
    const accounted = [...BUCKET_SERVER_ENFORCED_UNREAD, ...BUCKET_SPEC_RETIRED_AHEAD_OF_PIN] as readonly string[];
    expect(unreadProtocol).toEqual([...accounted].sort());
    expect(unreadProtocol.filter((k) => !accounted.includes(k))).toEqual([]);
    // Control on the same derivation: it still finds the bucket-② / ③ members
    // unread, so the empty bucket is a reading and not a probe that reads all.
    expect(declared.filter((k) => !reads.includes(k))).toContain(NAMED_VIEW_UNREAD_CONTROL);
  });

  it.each(BUCKET_ONE_READ_SINCE_10758)('BUCKET ① → READ (objectui#10758) — `%s` is declared by BOTH faces and now read off a named view (inverted from "read off no named view")', (member) => {
    expect(namedListViewMembers().names).toContain(member);
    expect(protocolListViewKeys()).toContain(member);
    expect(deriveNamedViewReads().reads).toContain(member);
    expect(NAMED_VIEW_READ_DECLARED as readonly string[]).toContain(member);
    expect(NAMED_LIST_VIEW_UNREAD as readonly string[]).not.toContain(member);
  });

  it.each(BUCKET_ONE_UNREAD_SINCE_13118)('INVERTED (objectui#13118) — `%s` was a bucket-① member read off a named view since objectui#10758, and is read off none now: the spec retires it', (member) => {
    expect(namedListViewMembers().names).toContain(member);
    expect(namedListViewMembers().tombstones).toContain(member);
    expect(protocolListViewKeys()).toContain(member);
    expect(deriveNamedViewReads().reads).not.toContain(member);
    expect(NAMED_VIEW_READ_DECLARED as readonly string[]).not.toContain(member);
    expect(NAMED_LIST_VIEW_UNREAD as readonly string[]).toContain(member);
    // In the protocol-retired bucket since objectui#13261 (the sixth until then).
    expect(BUCKET_PROTOCOL_RETIRED_TOMBSTONED as readonly string[]).toContain(member);
  });

  it.each(BUCKET_LEGACY_SHOW_SPELLINGS)('BUCKET ② — `%s` is a legacy SPELLING: the protocol declares it nowhere, and the runtime already folds it onto its canonical twin', (member) => {
    const [block, canonical] = LEGACY_SHOW_SPELLING_TWINS[member];
    expect(namedListViewMembers().names).toContain(member);
    expect(protocolListViewKeys()).not.toContain(member);
    expect(deriveNamedViewReads().reads).not.toContain(member);
    // The canonical twin is a real protocol key on this very surface, and the
    // block that carries it is declared on the objectui face too — which is the
    // condition the 2026-09-16 ruling attached to retiring the spelling.
    expect(protocolListViewKeys()).toContain(block);
    expect(namedListViewMembers().names).toContain(block);
    const inner = shapeMember(SpecObjectListViewSchema, block) as { unwrap(): unknown };
    expect(shapeKeys(inner.unwrap())).toContain(canonical);
  });

  it.each(BUCKET_LOCAL_ONLY_UNREAD)('BUCKET ③ — `%s` is objectui-only, outside the show* fold table, and read off no named view by object-view', (member) => {
    expect(namedListViewMembers().names).toContain(member);
    expect(protocolListViewKeys()).not.toContain(member);
    expect(foldFlagMap()).not.toHaveProperty(member);
    expect(deriveNamedViewReads().reads).not.toContain(member);
    // ⛔ "The protocol declares it nowhere" is the reading; the strict value
    // refusing it is the measurement that backs it.
    const r = SpecObjectListViewSchema.safeParse({ label: 'x', columns: ['a'], [member]: true });
    expect(r.success).toBe(false);
  });

  it.each(BUCKET_PROTOCOL_RETIRED_TOMBSTONED)('RETIRED BY THE PROTOCOL — `%s` is a protocol tombstone (spec 17.5.0 retired the objectui#11073 pair, spec 18.0.0 retired `filterableFields`) and a `?: never` tombstone here, read nowhere', (member) => {
    const { names, tombstones, docs } = namedListViewMembers();
    expect(names).toContain(member);
    expect(tombstones).toContain(member);
    expect(docs[member]).toContain(PROTOCOL_RETIRED_TOMBSTONE_DOC[member]);
    expect(protocolRetiredKeys()).toContain(member);
    expect(deriveNamedViewReads().reads).not.toContain(member);
    expect(NAMED_LIST_VIEW_UNREAD as readonly string[]).toContain(member);
  });

  // The sixth bucket's self-expiry fired at objectui#13261: the row that read
  // "RETIRED AHEAD OF THE PIN — live at the installed spec" went red there, as
  // written, and its member moved into the protocol-retired buckets.
  it('RETIRED AHEAD OF THE PIN is EMPTY since objectui#13261 — the installed spec carries the tombstone objectui#13118 put here first', () => {
    expect([...BUCKET_SPEC_RETIRED_AHEAD_OF_PIN]).toEqual([]);
    for (const member of RETIRED_BY_13118) {
      expect(protocolRetiredKeys()).toContain(member);
      expect(BUCKET_PROTOCOL_RETIRED_TOMBSTONED as readonly string[]).toContain(member);
      expect(namedListViewMembers().tombstones).toContain(member);
      expect(deriveNamedViewReads().reads).not.toContain(member);
    }
  });
});

/* ── objectui#7924 — the retirement: bucket ② A and bucket ③ ─────────────────
 * Director-seat ruling of 2026-09-16 on objectui#7924: `NamedListView` carries
 * the protocol's `userActions` and `appearance` blocks (it already did, since
 * objectui#8980), so the eight legacy `show*` spellings retire; the bucket-③
 * members the protocol declares nowhere and nobody reads retire with them. Both
 * as `?: never` tombstones on the TypeScript face only — the runtime fold in
 * `normalizeListViewSchema` stays, so stored documents keep parsing.
 *
 * Two bucket-③ members were measured READ at retirement time and were NOT
 * tombstoned then. Ruling A′ (objectui#7924) retired one of them later:
 * `densityMode`, once both relays of a named view read the density through the
 * fold instead of by name. objectui#11013 retired the other, `allowExport`, once
 * both relays stopped reading it off a view ({@link RETIRED_BY_11013}).
 */

const LISTVIEW = 'packages/plugin-list/src/ListView.tsx';
const APP_SHELL_OBJECT_VIEW = 'packages/app-shell/src/views/ObjectView.tsx';

/** A named view's one required member; every literal below is a delta on it. */
const BASE_VIEW = { label: 'All' } as const;

type Tombstone = (typeof NAMED_LIST_VIEW_TOMBSTONES)[number];
type TombstoneTypes = { [K in Tombstone]: NamedListView[K] };
// Every tombstone admits absence and nothing else. Widening ANY one of them back
// (to `boolean`, `string`, or `any` through a deletion) makes this union not
// `undefined`, and the type-check goes red.
export type _EveryTombstoneAdmitsOnlyAbsence = Expect<Equal<TombstoneTypes[Tombstone], undefined>>;
// `allowExport` — this pin asserted the member RETAINED (`boolean`) until
// objectui#11013; re-pointed, not deleted, it now asserts the tombstone.
export type _AllowExportTombstoned = Expect<Equal<NamedListView['allowExport'], undefined>>;
// `densityMode` — this pin asserted the member RETAINED (its three-value union)
// until ruling A′ (objectui#7924); re-pointed, not deleted, it now asserts the
// tombstone: the member admits absence and nothing else.
export type _DensityModeTombstoned = Expect<Equal<NamedListView['densityMode'], undefined>>;
// The canonical blocks are the `list-view` node's own spec-derived members.
export type _UserActionsIsTheSpecDerivedSlot = Expect<Equal<NamedListView['userActions'], TsListViewSchema['userActions']>>;
export type _AppearanceIsTheSpecDerivedSlot = Expect<Equal<NamedListView['appearance'], TsListViewSchema['appearance']>>;

// Each tombstone REFUSES a value at compile time. Every directive below goes
// unused — TS2578, and the type-check is red — the moment its member is widened
// back or deleted into an accepting shape.
// @ts-expect-error — `showSearch` is RETIRED (objectui#7924): author `userActions.search`
export const _refusedShowSearch: NamedListView = { ...BASE_VIEW, showSearch: true };
// @ts-expect-error — `showSort` is RETIRED (objectui#7924): author `userActions.sort`
export const _refusedShowSort: NamedListView = { ...BASE_VIEW, showSort: true };
// @ts-expect-error — `showFilters` is RETIRED (objectui#7924): author `userActions.filter`
export const _refusedShowFilters: NamedListView = { ...BASE_VIEW, showFilters: true };
// @ts-expect-error — `showHideFields` is RETIRED (objectui#7924): author `userActions.hideFields`
export const _refusedShowHideFields: NamedListView = { ...BASE_VIEW, showHideFields: true };
// @ts-expect-error — `showGroup` is RETIRED (objectui#7924): author `userActions.group`
export const _refusedShowGroup: NamedListView = { ...BASE_VIEW, showGroup: true };
// @ts-expect-error — `showColor` is RETIRED (objectui#7924): author `userActions.rowColor`
export const _refusedShowColor: NamedListView = { ...BASE_VIEW, showColor: true };
// @ts-expect-error — `showDensity` is RETIRED (objectui#7924): author `userActions.rowHeight`
export const _refusedShowDensity: NamedListView = { ...BASE_VIEW, showDensity: true };
// @ts-expect-error — `showDescription` is RETIRED (objectui#7924): author `appearance.showDescription`
export const _refusedShowDescription: NamedListView = { ...BASE_VIEW, showDescription: true };
// @ts-expect-error — `addDeleteRecordsInline` is RETIRED (objectui#7924): protocol-silent and unread
export const _refusedAddDeleteRecordsInline: NamedListView = { ...BASE_VIEW, addDeleteRecordsInline: true };
// @ts-expect-error — `addRecordViaForm` is RETIRED (objectui#7924): see `userActions.addRecordForm`
export const _refusedAddRecordViaForm: NamedListView = { ...BASE_VIEW, addRecordViaForm: true };
// @ts-expect-error — `clickIntoRecordDetails` is RETIRED (objectui#7924): protocol-silent and unread
export const _refusedClickIntoRecordDetails: NamedListView = { ...BASE_VIEW, clickIntoRecordDetails: true };
// @ts-expect-error — `collapseAllByDefault` is RETIRED (objectui#7924): protocol-silent and unread
export const _refusedCollapseAllByDefault: NamedListView = { ...BASE_VIEW, collapseAllByDefault: true };
// @ts-expect-error — `color` is RETIRED (objectui#7924): author `rowColor: { field }`
export const _refusedColor: NamedListView = { ...BASE_VIEW, color: 'status' };
// @ts-expect-error — `fieldTextColor` is RETIRED (objectui#7924): protocol-silent and unread
export const _refusedFieldTextColor: NamedListView = { ...BASE_VIEW, fieldTextColor: 'status' };
// @ts-expect-error — `prefixField` is RETIRED (objectui#7924): protocol-silent and unread
export const _refusedPrefixField: NamedListView = { ...BASE_VIEW, prefixField: 'code' };
// @ts-expect-error — `wrapHeaders` is RETIRED (objectui#7924): protocol-silent and unread
export const _refusedWrapHeaders: NamedListView = { ...BASE_VIEW, wrapHeaders: true };
// @ts-expect-error — `densityMode` is RETIRED (objectui#7924, ruling A′): author top-level `rowHeight`
export const _refusedDensityMode: NamedListView = { ...BASE_VIEW, densityMode: 'compact' };
// `filterableFields` — objectui#13118's tombstone: the spec retires the key.
export type _FilterableFieldsTombstoned = Expect<Equal<NamedListView['filterableFields'], undefined>>;
// @ts-expect-error — `filterableFields` is RETIRED (objectui#13118): the spec retires it; curate a filter bar with `userFilters`
export const _refusedFilterableFields: NamedListView = { ...BASE_VIEW, filterableFields: ['stage'] };

// …and the canonical blocks ACCEPT a protocol-shaped value on a literal. The
// same values are parsed against the protocol's own slots below, so "protocol
// shaped" is a measurement, not a claim.
const PROTOCOL_USER_ACTIONS = {
  search: false, sort: true, filter: true, rowHeight: false, group: true,
  hideFields: false, rowColor: true, addRecordForm: true,
} as const;
const PROTOCOL_APPEARANCE = { showDescription: true } as const;
export const _acceptedCanonical: NamedListView = {
  ...BASE_VIEW,
  userActions: { ...PROTOCOL_USER_ACTIONS },
  appearance: { ...PROTOCOL_APPEARANCE },
  rowColor: { field: 'status' },
};
// `allowExport` is refused like the rest since objectui#11013…
// @ts-expect-error — `allowExport` is RETIRED (objectui#11013): the list-view node's gate, not a view key
export const _refusedAllowExport: NamedListView = { ...BASE_VIEW, allowExport: false };
// …and the density the retired `densityMode` spelled is authored as the
// protocol's top-level `rowHeight`, which a named view accepts.
export const _acceptedDensityCanonical: NamedListView = { ...BASE_VIEW, rowHeight: 'compact' };

describe('objectui#7924 — the retirement: seventeen `?: never` tombstones, objectui#11013\'s eighteenth, the canonical blocks', () => {
  it('the tombstone set is EXACTLY bucket ② plus bucket ③ minus the objectui#11013 retirement and the one held member, derived off the AST', () => {
    const { tombstones: allTombstones, names } = namedListViewMembers();
    // The objectui#11073 pair are protocol-retirement tombstones, censused in
    // their own bucket above, and `allowExport` is objectui#11013's; this row is
    // about objectui#7924's seventeen.
    const tombstones = allTombstones.filter((t) => !(BUCKET_PROTOCOL_RETIRED_TOMBSTONED as readonly string[]).includes(t)
      && !(RETIRED_BY_11013 as readonly string[]).includes(t)
      && !(RETIRED_BY_13118 as readonly string[]).includes(t));
    // 20 until objectui#13118 tombstoned `filterableFields`.
    expect(allTombstones).toHaveLength(21);
    for (const m of RETIRED_BY_13118) expect(allTombstones).toContain(m);
    expect([...tombstones].sort()).toEqual([...NAMED_LIST_VIEW_TOMBSTONES]);
    expect(tombstones).toHaveLength(17);
    expect(BUCKET_LOCAL_ONLY_RETAINED).toHaveLength(0);
    for (const m of RETIRED_BY_11013) expect(allTombstones).toContain(m);
    const expected = [
      ...BUCKET_LEGACY_SHOW_SPELLINGS,
      ...BUCKET_LOCAL_ONLY_UNREAD.filter((m) => !(RETIRED_BY_11013 as readonly string[]).includes(m)
        && !(BUCKET_LOCAL_ONLY_HELD as readonly string[]).includes(m)),
    ].sort();
    expect([...tombstones].sort()).toEqual(expected);
    // A tombstone is still a declared member — that is what makes the refusal
    // BY NAME — so the declared census does not move.
    for (const t of tombstones) expect(names).toContain(t);
    // Control on the same walk: a live member is NOT reported as a tombstone.
    expect(tombstones).not.toContain(NAMED_VIEW_READ_CONTROL);
    expect(tombstones).not.toContain('userActions');
  });

  it('no tombstone is protocol-declared, and none is read off a named view — nothing live was retired', () => {
    const protocol = protocolListViewKeys();
    const reads = deriveNamedViewReads().reads;
    for (const t of NAMED_LIST_VIEW_TOMBSTONES) {
      expect(protocol, `\`${t}\` is a protocol key; tombstoning it puts objectui narrower than the protocol`).not.toContain(t);
      expect(reads, `\`${t}\` is read off a named view`).not.toContain(t);
    }
  });

  it.each(BUCKET_LEGACY_SHOW_SPELLINGS)('BUCKET ② — the `%s` tombstone names its canonical key, and the canonical block is declared', (member) => {
    const [block, key] = LEGACY_SHOW_SPELLING_TWINS[member];
    const { docs, names, tombstones } = namedListViewMembers();
    expect(tombstones).toContain(member);
    expect(docs[member]).toContain('RETIRED (objectui#7924)');
    expect(docs[member]).toContain(`\`${block}.${key}\``);
    expect(names).toContain(block);
    expect(tombstones).not.toContain(block);
  });

  it('the bucket-③ tombstones that have a likely canonical intent say so — ⛔ with no alias mapping behind it', () => {
    const { docs } = namedListViewMembers();
    // `color` names the row-colour CONFIGURATION and warns off the toggle.
    expect(docs.color).toContain('`rowColor`');
    expect(docs.color).toContain('Not `userActions.rowColor`');
    expect(docs.addRecordViaForm).toContain('`userActions.addRecordForm`');
    // `densityMode` names the top-level VALUE and warns off the toggle.
    expect(docs[DENSITY_MODE_RETIRED]).toContain('top-level `rowHeight`');
    expect(docs[DENSITY_MODE_RETIRED]).toContain('Not `userActions.rowHeight`');
    for (const m of NAMED_LIST_VIEW_TOMBSTONES) expect(docs[m]).toContain('RETIRED (objectui#7924)');
    // No alias: the fold table does not learn any bucket-③ member.
    const map = foldFlagMap();
    for (const m of BUCKET_LOCAL_ONLY_UNREAD) expect(map).not.toHaveProperty(m);
  });

  it('`allowExport` is RETIRED (objectui#11013): neither relay reads it off a view, and ListView gates export on the node\'s value', () => {
    // Re-pointed from the RETAINED pin it replaces: that pin held the app-shell
    // relay line naming the key; this one holds the tombstone, the absence of
    // the view read at BOTH relays, and — as the firing control on the same
    // files — the node read upstream and the `ListView` gate that reads it.
    const { tombstones, docs } = namedListViewMembers();
    expect(tombstones).toContain('allowExport');
    expect(docs.allowExport).toContain('RETIRED (objectui#11013)');
    const appShell = readRepo(APP_SHELL_OBJECT_VIEW);
    const pluginView = readRepo(READER);
    expect(appShell).not.toContain('viewDef.allowExport');
    expect(pluginView).not.toContain('activeView?.allowExport');
    expect(pluginView).toContain('allowExport: (schema as any).allowExport,');
    expect(readRepo(LISTVIEW)).toContain('schema.allowExport !== false &&');
  });

  it('`densityMode` is RETIRED by ruling A′: both relays read the density THROUGH the fold, and the fold still maps stored views', () => {
    // Re-pointed from the RETAINED pin it replaces (objectui#7924): that pin
    // held the app-shell relay line naming the key; this one holds its absence
    // at BOTH relays, with the fold-through line as the firing control on the
    // same file, so an absence is a reading and not a missed file.
    expect(namedListViewMembers().tombstones).toContain(DENSITY_MODE_RETIRED);
    const appShell = readRepo(APP_SHELL_OBJECT_VIEW);
    const pluginView = readRepo(READER);
    expect(appShell).not.toContain('densityMode: viewDef.densityMode');
    expect(appShell).toContain('(normalizeListViewSchema(viewDef ?? {}) as Pick<ListViewSchema, \'rowHeight\'>).rowHeight');
    expect(pluginView).not.toContain('densityMode: activeView?.densityMode');
    // objectui#10758 put the named view's own `rowHeight` ahead of the host
    // entry's fold; the host hop still reads THROUGH the fold, and the named
    // view is read as itself (the strict record refuses `densityMode`).
    expect(pluginView).toContain('rowHeight: currentNamedViewConfig?.rowHeight ?? (normalizeListViewSchema(activeView ?? {})');
    expect(pluginView).not.toContain('currentNamedViewConfig?.densityMode');
    // The fold is the one reader left, and stored views keep rendering through it.
    const fold = readRepo(FOLD);
    expect(fold).toContain('const legacyDensity = s.densityMode;');
    expect(fold).toContain('delete next.densityMode;');
  });

  it('`options` is HELD, not tombstoned: unread off a named view since objectui#7928, and `NamedListView` stays unchanged by that ruling\'s Q2 (i)', () => {
    const { tombstones, names } = namedListViewMembers();
    expect(names).toContain(LOCAL_ONLY_READ);
    expect(tombstones).not.toContain(LOCAL_ONLY_READ);
    expect(readRepo(DECLARATION)).toContain('options?: Record<string, any>;');
    // …while the named-view record refuses it: `ObjectViewSchema.listViews` is
    // the protocol's strict value by reference.
    const r = ObjectViewSchema.safeParse({ ...NODE, listViews: { v1: { label: 'x', columns: ['a'], [LOCAL_ONLY_READ]: {} } } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect((r.error.issues as readonly Issue[]).some((i) => i.code === 'unrecognized_keys' && (i.path ?? []).join('.') === 'listViews.v1')).toBe(true);
    }
  });

  it('objectui#11013: app-shell relays neither `prefixField` nor `allowExport` off a view, and ListView still reads only the second', () => {
    // app-shell used to relay `prefixField` exactly as it relayed
    // `allowExport`; objectui#11013 dropped both rungs (no producer writes either
    // onto a view). The reader side is the control: nothing downstream reads
    // `prefixField`, while `ListView` still reads `allowExport` — off the node's
    // value now. Same files, same query, opposite answers.
    const appShell = readRepo(APP_SHELL_OBJECT_VIEW);
    expect(appShell).not.toContain('viewDef.prefixField');
    expect(appShell).not.toContain('viewDef.allowExport');
    // Firing control on the same file: the relay still reads other keys off the view.
    expect(appShell).toContain('rowColor: viewDef.rowColor ?? listSchema.rowColor,');
    const listView = readRepo(LISTVIEW);
    expect(listView).not.toMatch(/\bprefixField\b/);
    expect(listView).toMatch(/\ballowExport\b/);
  });

  it('the canonical blocks accept a PROTOCOL-shaped value: the literals above parse against the protocol\'s own slots', () => {
    const ua = shapeMember(SpecObjectListViewSchema, 'userActions') as { safeParse(v: unknown): { success: boolean } };
    const ap = shapeMember(SpecObjectListViewSchema, 'appearance') as { safeParse(v: unknown): { success: boolean } };
    expect(ua.safeParse(PROTOCOL_USER_ACTIONS).success).toBe(true);
    expect(ap.safeParse(PROTOCOL_APPEARANCE).success).toBe(true);
    // The whole canonical view parses against the strict protocol value…
    expect(SpecObjectListViewSchema.safeParse({ ..._acceptedCanonical, columns: ['name'] }).success).toBe(true);
    // …and the legacy spelling does not: the control that the parse is strict.
    expect(SpecObjectListViewSchema.safeParse({ ...BASE_VIEW, columns: ['name'], showSearch: true }).success).toBe(false);
  });
});
