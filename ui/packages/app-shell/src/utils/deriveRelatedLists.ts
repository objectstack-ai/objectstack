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
 *     on a `master_detail` FK that sets `inlineEdit`, the list is primary by
 *     default; `relatedList: true` keeps it a side card.
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
 *     that order ({@link resolveRelatedListOrder}). Every unlisted list follows
 *     in the derived order: owned (`master_detail`) children before plain
 *     `lookup` children, preserving discovery order within each group. The
 *     primary flag places a list and no longer orders it; consumers that split
 *     body tables from side cards keep this order within each half.
 *   - Object-level READ permission gates the whole list (objectui#2359): the
 *     relationship graph says nothing about the CURRENT USER, so callers pass
 *     a `canRead` predicate (wired from `usePermissions().can`) and children
 *     the user cannot read are dropped — no header, no empty grid, no "New"
 *     button that would 403 on save. Data access was always enforced
 *     server-side; this closes the UI/DX gap.
 */

import { convertSortToQueryParams } from '@object-ui/core';
import { relatedListEntryNames } from '@object-ui/plugin-detail';

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
   * True when the list is part of the record's MAIN CONTENT: the FK declares
   * `relatedList: 'primary'`, or it is a `master_detail` FK that sets
   * `inlineEdit` and declares no `relatedList` at all (objectstack#27069 — line
   * items edited inside the parent's form are drawn under it, not beside it).
   * A placement, not an order: the body draws primary lists as full-width
   * tables, the tabbed page gives each its OWN tab, and non-primary lists are
   * the side cards (a single "Related" tab on the tabbed page).
   */
  isPrimary: boolean;
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
   * The spec's optional `relatedLists` (objectstack#27069): the business order
   * of THIS object's related lists, read when it is the parent. Each entry is
   * a child object name or `object.field`; see {@link resolveRelatedListOrder}.
   */
  relatedLists?: string[];
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
 * Is this FK's list part of the record's main content (`isPrimary`)?
 *
 * `relatedList: 'primary'` says so explicitly. Left unset, a `master_detail`
 * FK that sets `inlineEdit` (any arm: `true`, `'grid'`, `'form'`) is primary
 * by default — the spec's own reading of the key (objectstack#27069). An
 * explicit `true` is the author keeping the list a side card, so the default
 * applies only to an ABSENT `relatedList`.
 */
export function isMainContentList(type: string, fieldDef: Record<string, any>): boolean {
  if (fieldDef.relatedList === 'primary') return true;
  if (fieldDef.relatedList !== undefined) return false;
  const inlineEdit = fieldDef.inlineEdit;
  return type === 'master_detail' && (inlineEdit === true || inlineEdit === 'grid' || inlineEdit === 'form');
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
  if (!Array.isArray(declared) || declared.length === 0) return [...lists];
  const placed = new Set<T>();
  const head: T[] = [];
  for (const entry of declared) {
    if (typeof entry !== 'string') continue;
    for (const list of lists) {
      if (placed.has(list) || !relatedListEntryNames(entry, list)) continue;
      placed.add(list);
      head.push(list);
    }
  }
  return [...head, ...lists.filter((list) => !placed.has(list))];
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
 * children; deterministic and side-effect free (safe to memoize).
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
  type Working = DerivedRelatedList & { _fkLabel: string; _listLabel: string };
  const owned: Working[] = [];
  const referenced: Working[] = [];

  const canRead = options?.canRead;
  const listLabel = options?.listLabel;

  for (const child of objects) {
    if (!child?.name) continue;
    // Permission gate: a related list surfaces the CHILD object's records, so
    // it requires read access on the child — the FK's mere existence does not
    // grant the current user anything (objectui#2359).
    if (canRead && !canRead(child.name)) continue;
    // objectui#5795: every related list derived from this child inherits the
    // child's own default list-view order, so compute it once per child
    // rather than once per FK.
    const inheritedSort = inheritedListViewSort(child.list);
    const childLabel = child.label || child.name;
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
      const hidden = fieldDef.relatedList === false;
      if (hidden && !options?.includeHidden) continue;

      const entry: Working = {
        childObject: child.name,
        childLabel,
        referenceField: fieldName,
        isOwned: type === 'master_detail',
        isPrimary: isMainContentList(type, fieldDef),
        ...(inheritedSort ? { sort: inheritedSort } : {}),
        ...(hidden ? { isHidden: true as const } : {}),
        _fkLabel: (typeof fieldDef.label === 'string' && fieldDef.label) || fieldName,
        _listLabel: childListLabel,
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

  const all = resolveRelatedListOrder([...owned, ...referenced], objectDef.relatedLists);
  // Multi-FK disambiguation: when a child object points here through more than
  // one relationship and gave no explicit title, suffix the FK label so the two
  // lists are distinguishable (e.g. "Opportunities · Partner Account"; the list
  // half is `options.listLabel`, see there).
  const counts: Record<string, number> = {};
  for (const r of all) counts[r.childObject] = (counts[r.childObject] || 0) + 1;

  return all.map(({ _fkLabel, _listLabel, ...rest }) => {
    if (!rest.title && counts[rest.childObject] > 1) {
      return { ...rest, title: `${_listLabel} · ${_fkLabel}` };
    }
    return rest;
  });
}
