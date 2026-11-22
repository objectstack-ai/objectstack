/**
 * deriveRelatedLists — the read-side mirror of `attachInlineSubforms`.
 *
 * Where `inlineEdit: true` on a child's `master_detail`/`lookup` field pulls
 * that child INTO the parent's entry form (write side), the detail-page
 * RELATED LIST is the read-side counterpart: a child collection surfaced on the
 * parent's record DETAIL page. Both intents live on the relationship in the
 * data model — not in a hand-authored page.
 *
 * This helper scans every object for fields whose `reference`
 * points back at the parent object and produces one related-list descriptor per
 * eligible FK. The detail page (`RecordDetailView`) feeds these into the
 * `record:related_list` renderers. (It also fed `DetailView.related`, which is
 * RETIRED as of objectui#7997 — that entry is a `?: never` tombstone on both
 * faces now, and this helper's output reaches the page only as
 * `record:related_list` nodes.)
 *
 * Rules (kept in lockstep with the relationship-level `relatedList` spec flag):
 *   - Owned children (`master_detail`) and `lookup` children are SHOWN by
 *     default. Set `relatedList: false` on the FK field to suppress a noisy
 *     association/audit link; set `relatedList: 'primary'` to make the list
 *     part of the record's MAIN CONTENT (objectstack#27069) — a body table
 *     rather than a side card; under the tabbed page it gets its own tab (the
 *     tab-vs-Related split is decided downstream in `buildDefaultTabs`). Absent
 *     on a `master_detail` FK (objectstack#35597: with or without `inlineEdit`)
 *     the list is primary by default; `relatedList: true` keeps it a side card.
 *   - `relatedListTitle` / `relatedListColumns` on the FK field override the
 *     derived title / columns (columns default to the child object's own list
 *     columns when omitted — resolved by the renderer).
 *   - `relatedListFilter` on the FK field is the list's own declared SCOPE
 *     (objectui#4664; the spec key landed upstream as objectstack#8704 / PR
 *     objectstack-ai/objectstack#8955 and ships from `@objectstack/spec` 17.1.0). It is carried through
 *     to the `record:related_list` node's existing `filter` prop, where
 *     `RelatedList` AND-composes it with `{ [referenceField]: parentId }`
 *     (objectstack#7118) — the parent condition is never negotiable, so the
 *     declared filter may only NARROW this parent's children.
 *   - ROW ORDER is inherited from the child object's DEFAULT LIST VIEW `sort`
 *     (objectui#5795). There is deliberately no field-level `relatedListSort`
 *     to pair with the keys above: the contract question was ruled on
 *     objectstack#11345 (maintainer, 2026-08-23) as direction 1 — inherit the
 *     child's list-view sort, and add NO new spec key. A related list is just
 *     another surface that lists that object, so it orders the way that
 *     object's own list orders, exactly as `columns` already defaults.
 *   - Audit FKs (`created_by` / `updated_by` / `owner_id`) are skipped — they
 *     exist on virtually every object and would balloon the detail page into
 *     dozens of duplicate cards.
 *   - ONE related list per eligible FK. A child may point at the parent through
 *     MORE THAN ONE relationship (e.g. `opportunity.primary_account` +
 *     `opportunity.partner_account`); each surfaces as its own list. When a
 *     child appears more than once and gave no explicit `relatedListTitle`, the
 *     FK's label is suffixed to the list's name (`options.listLabel`, the
 *     plural on the detail page) to disambiguate ("Opportunities · Partner
 *     Account").
 *   - Self-references are allowed (e.g. `account.parent_account` → `account`):
 *     the parent record lists the records whose self-FK points back at it
 *     ("Child Accounts"). Suppress with `relatedList: false` if unwanted.
 *   - ORDER is the parent's declared business order first: the parent object's
 *     `relatedLists` (objectstack#27069) names inbound relationships — a child
 *     object, or `object.field` for one FK — and those lists come first, in
 *     that order ({@link resolveRelatedListOrder}). Undeclared, every list
 *     follows in the derived order: owned (`master_detail`) children before
 *     plain `lookup` children, preserving discovery order within each group.
 *     The primary flag places a list and no longer orders it; consumers that
 *     split body tables from side cards keep this order within each half.
 *   - VISIBILITY (objectstack#35897): a DECLARED `relatedLists` is the record
 *     page's tab list, so a side list no entry names is not derived at all
 *     (the authoring surface, `includeHidden`, keeps it flagged
 *     `isUnlisted`). A body table (`isPrimary`) is the field groups' to place
 *     and is kept, after the listed ones, with no tab of its own (no
 *     `keepsTab`) unless an entry names it. Undeclared or empty: every list, as
 *     before. A side list ANOTHER package brings (the child and the parent
 *     belong to different packages, objectstack#35901) is the exception: the
 *     declared list does not hide it; that package places it (the server
 *     splices its `place` into `relatedLists`), and an unplaced one is kept
 *     after the listed ones, so the page draws it at the end of the tabs.
 *     The three built-in tab names (`RECORD_PAGE_BUILTIN_TABS` in
 *     `@objectstack/spec/data`) name the page's own tabs, never a child list;
 *     the synthesized page places those (`buildDefaultTabs`).
 *   - THE ENVIRONMENT'S TAB LIST (ADR-0146 D10): where the base's paired
 *     `.custom` package arranges the tabs, the server writes its list into the
 *     served `relatedLists` and says two more things beside it, in the served
 *     read's `_relatedListsArrangement` decoration (read through the spec's
 *     `readRelatedListsArrangement`), because only this derivation knows which
 *     lists exist for the reader. `hidden`: a side list one of those names
 *     names is not derived, whichever package brings it and whether or not
 *     `relatedLists` is declared (the authoring surface keeps it, flagged
 *     `isUnlisted`); a body table stays at its group and loses the tab it
 *     keeps. `unlisted: 'shown'`: a list no entry names is kept after the
 *     listed ones, as the automatic list the arrangement replaced showed it.
 *     With no decoration, nothing in this derivation changes.
 *   - An entry's own TITLE and COLUMNS (objectstack#35899): the object form
 *     `{ list, label, columns }` wins over the FK's `relatedListTitle` /
 *     `relatedListColumns`, for every list that entry names first, wherever
 *     the list is drawn (its tab, or the body table a field group places).
 *   - A child object the data API does not expose (`enable.apiEnabled:
 *     false`, e.g. a credential or device table) yields no record-page list:
 *     every read of its records answers `404 OBJECT_API_DISABLED`. The
 *     authoring surface (`includeHidden`) lists such a relationship flagged
 *     `isHidden`, as it lists a `relatedList: false` one.
 *   - Object-level READ permission gates the whole list (objectui#2359): the
 *     relationship graph says nothing about the CURRENT USER, so callers pass
 *     a `canRead` predicate (wired from `usePermissions().can`) and children
 *     the user cannot read are dropped — no header, no empty grid, no "New"
 *     button that would 403 on save. Data access was always enforced
 *     server-side; this closes the UI/DX gap.
 */

import {
  fieldGroupsPlaceRelationship,
  isBodyTableRelationship,
  isGroupPlaceableRelationship,
  isRecordPageBuiltinTab,
  readRelatedListsArrangement,
  relatedListEntryName,
} from '@objectstack/spec/data';
import { convertSortToQueryParams } from '@object-ui/core';
import { relatedListEntryNames } from '@object-ui/plugin-detail/core';

/** Audit/ownership FKs that exist on nearly every object — never related lists. */
const AUDIT_FK_FIELDS = new Set(['created_by', 'updated_by', 'owner_id']);

export interface DerivedRelatedList {
  /** Child object name (the `api` for the related list query). */
  childObject: string;
  /** Best-effort human label for the child object. */
  childLabel: string;
  /** FK field on the child pointing back at this parent. */
  referenceField: string;
  /** Title override from `relatedListTitle` (else derive from the object label). */
  title?: string;
  /** Explicit columns override from `relatedListColumns` (else auto-derived by the renderer). */
  columns?: any[];
  /**
   * The list's own declared SCOPE, from `relatedListFilter` on the FK field
   * (objectui#4664). A spec `FilterCondition` — the canonical Query-DSL object
   * a query `where` already speaks (`{ status: { $ne: 'deleted' } }`), which is
   * exactly the vocabulary `record:related_list.filter` already accepts. NO new
   * dialect is introduced on this side: the value travels verbatim to that
   * existing prop and is lowered by the repo's one filter→wire sink
   * (`toFilterNode` / `mergeFilterNodes` in `@object-ui/core`).
   *
   * AND-composed with `{ [referenceField]: parentId }`, never substituted for
   * it. That is the spec's own contract text on the key, and it is the whole
   * safety property: replacement would leak OTHER parents' rows, which reads on
   * screen as a plausible list rather than as a bug.
   *
   * An authored constraint, never a user-editable suggestion — it is not routed
   * through the filter bar (the same reason `record:related_list.filter` is not,
   * objectstack#7118).
   *
   * Absent (never `{}`) when the FK declares nothing, so the synthesized node
   * and the query it sends stay byte-identical to what they were before this
   * key had a producer — the same discipline `sort` and `columns` follow above.
   */
  filter?: Record<string, any>;
  /** True when the child→parent link is a `master_detail` (owned) relationship. */
  isOwned: boolean;
  /**
   * True when the list is part of the record's MAIN CONTENT — a body table: the
   * FK declares `relatedList: 'primary'`, or it is a `master_detail` FK that
   * declares no `relatedList` AND one of the parent's field groups names it
   * (`fieldGroups[].relatedList`, objectstack#35889: a master-detail child is a
   * tab by default, superseding objectstack#35597's "body table by default").
   * The verdict is `@objectstack/spec`'s `isBodyTableRelationship`
   * (objectstack#27478), handed whether a parent group places the list.
   * A placement, not an order: the body draws primary lists as full-width
   * tables, and every other list is a tab of its own.
   */
  isPrimary: boolean;
  /**
   * True when a field group of the parent MAY place this list
   * (`@objectstack/spec`'s `isGroupPlaceableRelationship`): a `'primary'` FK,
   * or a `master_detail` FK that declares no `relatedList` (objectstack#35889).
   * What Studio's field-group inspector offers; the spec refuses a group naming
   * any other list.
   */
  isPlaceable: boolean;
  /**
   * Present (true) on a body table that a parent field group MAKES one: a
   * `master_detail` FK declaring no `relatedList` that a group names. Such a
   * table keeps its tab on the record page too (objectstack#35889 item 4),
   * unless the parent DECLARES `relatedLists` and no entry names it: a declared
   * list decides the tabs (objectstack#35897), so the table stays at its group
   * with no tab. A
   * `'primary'` table is a body table without a group and keeps no tab, as
   * before, whether or not a group positions it.
   */
  keepsTab?: true;
  /**
   * Default row order, INHERITED from the child object's default list view
   * `sort` (objectui#5795; ruled on objectstack#11345, maintainer 2026-08-23:
   * direction 1 — inherit the child list view's sort, NO new spec key).
   *
   * Always the ARRAY arm of the `record:related_list.sort` union, never the
   * string arm. Both surfaces declare `string | Array<{field, order}>`, but
   * the two string arms are DIFFERENT dialects: a ListView string is the
   * legacy space-separated `'seq_no desc'`, while the related list's own
   * `normalizeSortSpec` reads `'field'` / `'-field'`. Passing the ListView
   * string through verbatim would order by a field literally named
   * `"seq_no desc"`. Translating at this boundary — the one place that knows
   * it is reading a ListView and writing a related list — is the whole point;
   * a tolerant reader on the consuming end would be the wrong fix (#0.1).
   *
   * Absent (never `[]`) when the child declares no default list view sort, so
   * the related list's query stays byte-identical to what it sent before.
   */
  sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
  /**
   * True when the FK declares `relatedList: false` — present only when the
   * caller asked for hidden relationships ({@link DeriveRelatedListsOptions.includeHidden}).
   * The record page never asks, so a hidden list never reaches it.
   */
  isHidden?: true;
  /**
   * True when the parent DECLARES `relatedLists` and no entry names this side
   * list (objectstack#35897), so the record page shows no tab for it — present
   * only when the caller asked for hidden relationships
   * ({@link DeriveRelatedListsOptions.includeHidden}), as `isHidden` is. Never
   * on a list another package brings (objectstack#35901): that one shows,
   * unless the environment's tab list hides it (ADR-0146 D10), which flags
   * any side list it names, whichever package brings it.
   */
  isUnlisted?: true;
  /**
   * The package the child object belongs to, when it is another package than
   * the parent's (objectstack#35901): a list that package brings, which the
   * parent's `relatedLists` does not hide and the package places itself.
   * Present only for the authoring surface
   * ({@link DeriveRelatedListsOptions.includeHidden}), which shows it read-only
   * with its source.
   */
  fromPackage?: string;
}

/**
 * An object definition AS THE CONSOLE HOLDS IT — after `MetadataProvider` has
 * merged the object's views onto it.
 *
 * ⚠️ Renamed off `ObjectLike` at objectui#7265, and the rename is the fix rather
 * than a workaround. `@objectstack/spec/system` exports an `ObjectLike` of its
 * own: the minimal object document `translateObject` consumes, `{ name, label,
 * pluralLabel, description, fields, actions }`, with `name` REQUIRED and no
 * index signature. This is a different layer in both directions at once, which
 * is why deriving it was not on the table:
 *
 *   - it carries `list`, a MERGED key. Nothing authors `object.list`; it is put
 *     there by `MetadataProvider.mergeViewsIntoObjects` after the fact, so the
 *     spec's shape has no member for it and, being closed, no room for one;
 *   - `name` is optional here because this shape also describes an object that
 *     is still LOADING — the guards below (`if (!objectDef?.name)`,
 *     `if (!child?.name)`) are the whole reason the derivation runs at all
 *     during the pre-catalog render.
 *
 * The spec name stays free for whatever genuinely is the spec's object
 * document; `spec-symbol-parity.test.ts` holds the two-way ratchet.
 */
interface MergedObjectLike {
  name?: string;
  label?: string;
  /**
   * The spec's optional `relatedLists` (objectstack#27069, objectstack#35897,
   * objectstack#35899): THIS object's record-page tabs, read when it is the
   * parent. Each entry is a child object name, `object.field`, a built-in tab
   * name, or `{ list, label?, columns? }`; see {@link resolveRelatedListOrder}.
   */
  relatedLists?: unknown[];
  /**
   * The served read's `_relatedListsArrangement` decoration (ADR-0146 D10),
   * present when the base's paired `.custom` package arranges this object's
   * tabs: `{ packageId, hidden, unlisted }`. Read only through the spec's
   * `readRelatedListsArrangement`.
   */
  _relatedListsArrangement?: unknown;
  /**
   * The spec's optional `fieldGroups`, read when this object is the parent: a
   * group's `relatedList` names the related list it places (objectstack#35889).
   */
  fieldGroups?: Array<{ relatedList?: unknown } | null | undefined>;
  /** The spec's optional `pluralLabel`, read by a caller's `listLabel` only. */
  pluralLabel?: string;
  fields?: Record<string, any> | any[];
  /**
   * The object's DEFAULT list view, as merged onto the object def by
   * `MetadataProvider.mergeViewsIntoObjects` (`merged.list = extra.primary`,
   * where `primary` is the expanded view item flagged `isDefault`). Its `sort`
   * is what a derived related list inherits.
   *
   * Optional on purpose: metadata of type `view` may arrive AFTER the objects
   * do, in which case this is undefined on the first derivation pass and the
   * descriptor carries no `sort`. That is not a silent hole — `objects` is a
   * fresh array once the views merge, so the memo over this derivation
   * recomputes and the sort appears.
   */
  list?: { sort?: Array<{ field?: string; order?: 'asc' | 'desc' }> };
  /**
   * The spec's `enable` block, read for `apiEnabled` only: an object declared
   * `apiEnabled: false` is not exposed through the data API, so a list of its
   * records can never be read on any record page.
   */
  enable?: { apiEnabled?: boolean };
  /**
   * The package that owns the object, as the server serves it (the registry
   * stamps its owner's package id; `'sys_metadata'` marks a definition bound
   * to no package). Read to tell a child list another package brings
   * (objectstack#35901).
   */
  _packageId?: unknown;
}

/** The package an object belongs to, or `undefined` for none (absent, empty, or bound to no package). */
function packageOf(object: MergedObjectLike | null | undefined): string | undefined {
  const id = object?._packageId;
  return typeof id === 'string' && id !== '' && id !== NO_PACKAGE ? id : undefined;
}

/** The `_packageId` the server stamps on a definition bound to no package. */
const NO_PACKAGE = 'sys_metadata';

/**
 * objectstack#35901 — does `child` come from another package than `parent`?
 * Both must belong to a package, and the two differ. A child of the parent's
 * own package, or one no package owns, is not: those stay the parent's to
 * list (objectstack#35897).
 */
function isOtherPackageChild(child: MergedObjectLike, parent: MergedObjectLike): boolean {
  const childPackage = packageOf(child);
  const parentPackage = packageOf(parent);
  return childPackage !== undefined && parentPackage !== undefined && childPackage !== parentPackage;
}

/**
 * The child object's inherited default row order, normalized to the ARRAY arm.
 *
 * Both arms are lowered through `convertSortToQueryParams` — the repo's ONE
 * definition of the authored-`sort` dialects (`@object-ui/core`) — so no second
 * parser of the legacy `'field desc'` string can drift from it. Its return is a
 * field→direction map; re-expanding it preserves the authored key order because
 * every ObjectStack field name matches `^[a-z_][a-z0-9_]*$` (spec
 * `field.zod.ts`), so none is an integer-like key that JS would hoist.
 *
 * Returns `undefined` — never `[]` — when nothing orderable was declared.
 */
function inheritedListViewSort(
  list: MergedObjectLike['list'],
): Array<{ field: string; order: 'asc' | 'desc' }> | undefined {
  const map = convertSortToQueryParams(list?.sort as any);
  if (!map) return undefined;
  const entries = Object.entries(map).map(([field, order]) => ({ field, order }));
  return entries.length > 0 ? entries : undefined;
}

/**
 * Did the FK actually DECLARE a `relatedListFilter`?
 *
 * A spec `FilterCondition` is a plain object; an array is the `ViewFilterRule[]`
 * vocabulary, which this key is not (upstream typed it `FilterConditionSchema`).
 * Returning `false` for everything else keeps a malformed value from travelling
 * as though it were authored — the renderer refuses to guess, exactly as #0.1
 * asks, rather than coercing it into something that "works".
 */
function isDeclaredFilter(value: unknown): value is Record<string, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

/**
 * The ONE resolution of related-list order (objectstack#27069): the parent's
 * declared `relatedLists` first, in the declared order; every list no entry
 * names after it, in the order `lists` already carries (the derived order).
 *
 * An entry names a child object (`'task'` — every list of that child, in their
 * derived order) or one FK (`'event.related_to'`). A list takes the position of
 * the FIRST entry that names it, so naming it again later changes nothing. An
 * entry that names no list here — a relationship hidden by `relatedList:
 * false`, a child the reader may not read, or a name the spec's `defineStack`
 * check would have refused — places nothing; it is not guessed at.
 *
 * Pure and order-stable: with no declared entries it returns `lists` as given.
 */
export function resolveRelatedListOrder<T extends { childObject: string; referenceField: string }>(
  lists: readonly T[],
  declared: readonly unknown[] | null | undefined,
): T[] {
  const naming = relatedListNamingEntries(lists, declared);
  if (!naming) return [...lists];
  const head = [...naming.keys()];
  return [...head, ...lists.filter((list) => !naming.has(list))];
}

/** The object form of one `relatedLists` entry, as a reader of a stored row sees it. */
interface RelatedListEntryObjectLike {
  list: string;
  label?: unknown;
  columns?: unknown;
}

/**
 * Each list a declared `relatedLists` names, mapped to the FIRST entry naming
 * it, in the declared order (a Map keeps insertion order). `null` when nothing
 * is declared (absent, or empty). An entry is read through the spec's
 * `relatedListEntryName` (a bare name, or the object form's `list`); a
 * built-in tab name names no list here.
 */
function relatedListNamingEntries<T extends { childObject: string; referenceField: string }>(
  lists: readonly T[],
  declared: readonly unknown[] | null | undefined,
): Map<T, unknown> | null {
  if (!Array.isArray(declared) || declared.length === 0) return null;
  const naming = new Map<T, unknown>();
  for (const entry of declared) {
    const name = relatedListEntryName(entry);
    if (name === undefined || isRecordPageBuiltinTab(name)) continue;
    for (const list of lists) {
      if (naming.has(list) || !relatedListEntryNames(name, list)) continue;
      naming.set(list, entry);
    }
  }
  return naming;
}

/** Is `entry` the object form of a `relatedLists` entry (objectstack#35899)? */
function isEntryObject(entry: unknown): entry is RelatedListEntryObjectLike {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry)
    && typeof (entry as { list?: unknown }).list === 'string';
}

/**
 * Does one `relatedLists` entry (or a field group's `relatedList`) name this
 * list? The ONE reading of an entry lives in `@object-ui/plugin-detail`, where
 * the synthesized record page places a body table by a field group's entry
 * (objectstack#27069); re-exported here for {@link resolveRelatedListOrder}
 * and the Studio editors that author entries.
 */
export { relatedListEntryNames };

/** Normalize an object's `fields` (record or array) into `[name, def]` pairs. */
function fieldEntries(fields: MergedObjectLike['fields']): Array<[string, any]> {
  if (!fields) return [];
  if (Array.isArray(fields)) {
    return fields
      .filter((f) => f && (f.name != null))
      .map((f) => [String(f.name), f] as [string, any]);
  }
  return Object.entries(fields);
}

export interface DeriveRelatedListsOptions {
  /**
   * Object-level READ gate for the current user (objectui#2359). Return
   * `false` to drop every related list whose child object the user cannot
   * read. Omit (or leave undefined) while permissions are still loading —
   * the derivation then stays purely relationship-driven, so lists never
   * flicker out during the fail-closed loading window.
   */
  canRead?: (objectName: string) => boolean;
  /**
   * What a LIST of the child's records is called, for the multi-FK title this
   * helper composes ("Opportunities · Partner Account"). The detail page
   * passes `useObjectLabel().objectPluralLabel`, the resolver its single-FK
   * titles use (objectui#11733), so both kinds of related-list title name the
   * list the same way. This helper holds no translation of its own; omitted,
   * the title keeps `childLabel`.
   */
  listLabel?: (child: MergedObjectLike & { name: string }) => string;
  /**
   * Keep the relationships whose FK declares `relatedList: false`, flagged
   * `isHidden`. For an AUTHORING surface only (Studio's `relatedLists`
   * editor): such a relationship is still one an entry may name (the spec's
   * `defineStack` check and `packages/lint` `validate-related-list-refs` count
   * it), so the editor lists it. The record page never sets this.
   */
  includeHidden?: boolean;
}

/**
 * Derive the detail-page related lists for `objectDef` from the full object
 * registry. Returns the lists `objectDef.relatedLists` names first, in that
 * order, then the rest: owned (`master_detail`) children, then `lookup`
 * children — of which, when `relatedLists` is declared, only the body tables
 * (objectstack#35897); deterministic and side-effect free (safe to memoize).
 */
export function deriveRelatedLists(
  objectDef: MergedObjectLike | null | undefined,
  objects: MergedObjectLike[] | null | undefined,
  options?: DeriveRelatedListsOptions,
): DerivedRelatedList[] {
  if (!objectDef?.name || !Array.isArray(objects) || objects.length === 0) return [];
  const parentName = objectDef.name;

  // Working entries carry the FK label and the list's name so we can
  // disambiguate multi-FK children after the full sweep; both are stripped
  // from the returned descriptors.
  type Working = DerivedRelatedList & { _fkLabel: string; _listLabel: string; _otherPackage: boolean };
  const owned: Working[] = [];
  const referenced: Working[] = [];

  const canRead = options?.canRead;
  const listLabel = options?.listLabel;

  for (const child of objects) {
    if (!child?.name) continue;
    // An object the data API does not expose (`enable.apiEnabled: false`)
    // answers every read of its records `404 OBJECT_API_DISABLED`, whoever
    // asks: a list of them is never derived for the record page. The
    // authoring surface still lists the relationship, flagged hidden, since an
    // entry may name it.
    const apiDisabled = child.enable?.apiEnabled === false;
    if (apiDisabled && !options?.includeHidden) continue;
    // Permission gate: a related list surfaces the CHILD object's records, so
    // it requires read access on the child — the FK's mere existence does not
    // grant the current user anything (objectui#2359).
    if (canRead && !canRead(child.name)) continue;
    // objectui#5795: every related list derived from this child inherits the
    // child's own default list-view order, so compute it once per child
    // rather than once per FK.
    const inheritedSort = inheritedListViewSort(child.list);
    const childLabel = child.label || child.name;
    // objectstack#35901 — a list another package brings is not the parent's to hide.
    const otherPackage = isOtherPackageChild(child, objectDef);
    const childListLabel = (listLabel && listLabel(child as MergedObjectLike & { name: string })) || childLabel;
    for (const [fieldName, fieldDef] of fieldEntries(child.fields)) {
      if (!fieldDef) continue;
      const type = fieldDef.type;
      if (type !== 'lookup' && type !== 'master_detail') continue;
      // objectui#6837 half 2 — maintainer 2026-08-31: protocol normalization
      // belongs on the SERVER, the front end just executes the protocol.
      // `reference` is the only target spelling `@objectstack/spec`'s
      // `FieldSchema` declares; it refuses `reference_to` by name with its own
      // "did you mean -> `reference`?" rename. objectstack#13847 rewrites
      // stored `reference_to` on the serve path and in `os migrate meta`. A
      // legacy-only def is canonicalised ONCE at the ingestion choke point
      // (`normalizeSchemaReferenceKeys`, which warns in dev) — never here.
      if (fieldDef.reference !== parentName) continue;
      if (AUDIT_FK_FIELDS.has(fieldName)) continue;
      // Explicit opt-out lives on the relationship.
      const hidden = fieldDef.relatedList === false || apiDisabled;
      if (hidden && !options?.includeHidden) continue;

      const isBody = isBodyTableRelationship(fieldDef, {
        placedByGroup: fieldGroupsPlaceRelationship(objectDef.fieldGroups, child.name, fieldName),
      });
      const entry: Working = {
        childObject: child.name,
        childLabel,
        referenceField: fieldName,
        isOwned: type === 'master_detail',
        // objectstack#35889 — a plain master-detail child is a body table
        // only where one of the parent's field groups names it.
        isPrimary: isBody,
        isPlaceable: isGroupPlaceableRelationship(fieldDef),
        // Item 4: a table the group MAKES a body table keeps its tab; a
        // `'primary'` one keeps none, as before.
        ...(isBody && fieldDef.relatedList !== 'primary' ? { keepsTab: true as const } : {}),
        ...(inheritedSort ? { sort: inheritedSort } : {}),
        ...(hidden ? { isHidden: true as const } : {}),
        _fkLabel: (typeof fieldDef.label === 'string' && fieldDef.label) || fieldName,
        _listLabel: childListLabel,
        _otherPackage: otherPackage,
        ...(otherPackage && options?.includeHidden ? { fromPackage: packageOf(child) } : {}),
        ...(typeof fieldDef.relatedListTitle === 'string' && fieldDef.relatedListTitle
          ? { title: fieldDef.relatedListTitle }
          : {}),
        ...(Array.isArray(fieldDef.relatedListColumns) && fieldDef.relatedListColumns.length > 0
          ? { columns: fieldDef.relatedListColumns }
          : {}),
        // `relatedListFilter` (objectui#4664). The same declared-vs-absent
        // discrimination its two siblings above do — a plain non-empty object
        // is a declaration, anything else is silence. This is NOT a tolerant
        // reader: no alias is accepted, no shape is coerced, and nothing is
        // defaulted. An empty object is a boolean identity by the spec's own
        // rule for empty combinators, so forwarding it would put a key on the
        // node that means exactly what saying nothing means.
        ...(isDeclaredFilter(fieldDef.relatedListFilter)
          ? { filter: fieldDef.relatedListFilter }
          : {}),
      };
      // NO `break`: a child object may reference this parent through several FKs.
      (entry.isOwned ? owned : referenced).push(entry);
    }
  }

  // objectstack#35897 — a declared `relatedLists` is the tab list: the lists it
  // names come first, in its order, and a side list it does not name is not
  // derived (the authoring surface keeps it, flagged). A body table is the
  // field groups' to place, so it stays, after the listed ones.
  // objectstack#35899 — the naming entry's own `label` / `columns` win over
  // the FK's `relatedListTitle` / `relatedListColumns`.
  // ADR-0146 D10 — what the paired `.custom` package's tab list says beside
  // the served `relatedLists`: the lists it hides, and whether a list no
  // entry names still shows. `undefined` (no such arrangement) changes nothing.
  const arrangement = readRelatedListsArrangement(objectDef);
  const hiddenByArrangement = (list: Working): boolean =>
    arrangement !== undefined && arrangement.hidden.some((name) => relatedListEntryNames(name, list));
  const unlistedShown = arrangement?.unlisted === 'shown';
  const derived = [...owned, ...referenced];
  const naming = relatedListNamingEntries(derived, objectDef.relatedLists);
  const all: Working[] = [];
  for (const list of resolveRelatedListOrder(derived, objectDef.relatedLists)) {
    if (hiddenByArrangement(list)) {
      // The environment hides this list's tab: a body table stays at its
      // group with no tab, a side list is not derived, whichever package
      // brings it. The authoring surface keeps it, flagged.
      if (list.isPrimary) {
        const { keepsTab: _hiddenTab, ...bodyOnly } = list;
        all.push(bodyOnly);
      } else if (options?.includeHidden) all.push({ ...list, isUnlisted: true });
      continue;
    }
    if (!naming) {
      all.push(list);
      continue;
    }
    const entry = naming.get(list);
    if (!naming.has(list)) {
      // ADR-0146 D10 — the environment's list replaced the AUTOMATIC one, in
      // which every list shows: a list it does not name still does, after
      // the listed ones, with the tab it had.
      if (unlistedShown) {
        all.push(list);
        continue;
      }
      // A body table no entry names stays at its group, with no tab: a
      // declared `relatedLists` decides the tabs, so the tab a group-placed
      // `master_detail` table keeps on the default page goes (the seat's
      // reading of objectstack#35897 against #35889 item 4).
      if (list.isPrimary) {
        const { keepsTab: _unlistedTab, ...bodyOnly } = list;
        all.push(bodyOnly);
      } else if (list._otherPackage) {
        // objectstack#35901 — a side list another package brings is not
        // hidden by the parent's list: that package places it with its object
        // extension's `place` (which the server splices into `relatedLists`,
        // so a placed one is named above); unplaced, it shows at the end of
        // the tabs (`arrangeDeclaredTabs`). Sales ruling 7073014077 flips the
        // hiding objectstack#35897 shipped (ruling 7072511859).
        all.push(list);
      } else if (options?.includeHidden) all.push({ ...list, isUnlisted: true });
      continue;
    }
    if (!isEntryObject(entry)) {
      all.push(list);
      continue;
    }
    all.push({
      ...list,
      ...(typeof entry.label === 'string' && entry.label ? { title: entry.label } : {}),
      ...(Array.isArray(entry.columns) && entry.columns.length > 0 ? { columns: entry.columns } : {}),
    });
  }
  // Multi-FK disambiguation: when a child object points here through more than
  // one relationship and gave no explicit title, suffix the FK label so the two
  // lists are distinguishable (e.g. "Opportunities · Partner Account"; the list
  // half is `options.listLabel`, see there).
  const counts: Record<string, number> = {};
  for (const r of all) counts[r.childObject] = (counts[r.childObject] || 0) + 1;

  return all.map(({ _fkLabel, _listLabel, _otherPackage, ...rest }) => {
    if (!rest.title && counts[rest.childObject] > 1) {
      return { ...rest, title: `${_listLabel} · ${_fkLabel}` };
    }
    return rest;
  });
}

/**
 * The relationship ids (`object.field`) of the BODY TABLES an AUTHORED record
 * page draws (objectstack#35597): every `record:related_list` placed anywhere
 * in the page's tree whose relationship the record page counts as a body table
 * (`isPrimary` on its derived list — `@objectstack/spec`'s
 * `isBodyTableRelationship`, the one predicate: a `'primary'` list, or a
 * master-detail list a field group of the parent places, objectstack#35889).
 * Such a list an author places gets the body-table treatment the synthesized
 * page gives it: drawn when empty, a server totals row, the row cap and
 * 「显示全部」.
 *
 * The synthesized page reads its body tables off its Details tab instead
 * (`bodyTableIdsOf` in `@object-ui/plugin-detail`): there the placement IS
 * the verdict. An authored page places lists where its author chose, so the
 * relationship decides. A node is read the way the related-list renderer reads
 * it: the ADR-0089 D3a `properties` bag over the node's own keys; a node that
 * names no `relationshipField` is no body table.
 */
export function authoredBodyTableIds(
  page: unknown,
  relations: ReadonlyArray<Pick<DerivedRelatedList, 'childObject' | 'referenceField' | 'isPrimary'>>,
): Set<string> {
  const bodies = new Set(
    relations.filter((relation) => relation.isPrimary).map((relation) => `${relation.childObject}.${relation.referenceField}`),
  );
  const ids = new Set<string>();
  if (bodies.size === 0) return ids;
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.type === 'record:related_list') {
      const bag = node.properties && typeof node.properties === 'object' ? (node.properties as Record<string, unknown>) : {};
      const props = { ...node, ...bag };
      if (typeof props.objectName === 'string' && typeof props.relationshipField === 'string') {
        const id = `${props.objectName}.${props.relationshipField}`;
        if (bodies.has(id)) ids.add(id);
      }
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(page);
  return ids;
}
