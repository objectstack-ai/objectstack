// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9257 — the SORT axis' authoring gate] A list view's declared `sort` must
 * name a field the object actually has, and one the runtime will agree to
 * order by.
 *
 * This is the SORT-axis twin of `validate-searchable-fields.ts` (#6674), added
 * for the same reason and judging by the same spec predicate. The runtime
 * already refuses both halves; nothing read the DECLARATION.
 *
 * ── Why an authoring gate, when the runtime already refuses ───────────────
 *
 * Two doors close this at request time, and neither can reach the author:
 *
 *   - `assertSortFieldsExist` (`@objectstack/metadata-protocol`, #6994) — the
 *     REST ingress. Precedence `unknown` > `dotted` > unmaterializable, all
 *     three answering `400 INVALID_SORT`.
 *   - `assertOrderByIsMaterializable` (`@objectstack/objectql` `engine.ts`,
 *     #7095) — the engine's own boundary, for callers that never pass ingress.
 *     Third verdict only, same `400 INVALID_SORT`.
 *
 * A list view's `sort` is what the renderer puts on that view's FIRST fetch, so
 * a declaration naming a `formula` field — or naming nothing at all — is a
 * `400` on first load and on every load, with the cause being an authoring
 * typo made long before. That is the failure `validate-searchable-fields`'
 * docblock describes for the search axis, one axis over and strictly larger:
 * a refused search is one optional interaction, a refused sort is the view's
 * initial fetch.
 *
 * Nothing caught it before this rule. `ListViewSchema.sort`
 * (`packages/spec/src/ui/view.zod.ts`) is
 * `z.union([z.string(), z.array({ field: z.string(), order })])` — the field
 * name is a bare string, exactly as `searchableFields` entries were before
 * #6674, so Zod validates the SHAPE and can say nothing about the NAME.
 *
 * ── What is checked ──────────────────────────────────────────────────────
 *
 * 1. EXISTENCE (`sort-field-unknown`): a name that resolves to no field at all.
 *    Judged on the HEAD segment, which is the ingress gate's own rule
 *    (`!gate.known.has(f.split('.')[0])`) — so linter and gate agree about
 *    which names are "unknown" rather than disagreeing on dotted paths.
 *
 * 2. VIRTUALITY (`sort-field-unsortable`): a `formula` entry names a real
 *    field, so check 1 passes it, but the value is computed on read with no
 *    stored column, so no driver materialises anything to ORDER BY. Measured
 *    on this repo's own conformance suite: `orderBy <formula> asc` and
 *    `orderBy <formula> desc` return BYTE-IDENTICAL row order (insertion
 *    order), carrying the very values they were asked to be ordered by — the
 *    answer contradicts the request in plain view and still reports success.
 *    Since #6994/#7095 both doors refuse it by name instead.
 *
 * 3. AUTHOR-DECLARED (`sort-field-unsortable`, #30023): a stored field whose
 *    author declared `sortable: false`. Since #29896 the Data API list door
 *    (`assertSortFieldsExist`) refuses an ORDER BY over it with
 *    `400 INVALID_SORT` (`a field on '<object>' that declares
 *    \`sortable: false\``), so a declaration naming it is the same
 *    first-fetch refusal as check 2, and is graded the same: `error`.
 *
 * Checks 2 and 3 are ONE question — the served sortability projection's
 * `sortable: false` — answered by `resolveObjectSortability`
 * (`@objectstack/spec/api`), the resolver the list door refuses by, never by a
 * second reading of `type` or `sortable` here. A virtual field that also
 * declares `sortable: false` keeps the projection's `virtual-type` reason.
 *
 * The verdict is `error`, not the advisory level the field-existence rules for
 * pages and forms use, for the reason `validate-searchable-fields` gives at
 * `error`: those describe a consumer that SKIPS an unknown name and renders the
 * rest; this one describes a declaration the runtime REFUSES outright.
 *
 * ── The predicate, and the type list this rule must NOT use ──────────────
 *
 * Virtuality is judged, through the projection, by `isVirtualSearchField` /
 * `SEARCH_VIRTUAL_TYPES` (`@objectstack/spec/data`), pinned to `formula` alone — the same spec fact
 * the search ingress gate, the engine's search resolution and the FILTER axis'
 * dotted-head classifier (#8296) already read. That constant documents itself
 * as a STORAGE fact rather than a search taste judgment, which is what makes it
 * the right authority for an axis that asks "is there a column to order by".
 *
 * ⛔ NOT the spec's `COMPUTED_VALUE_TYPES` (`formula` / `summary` /
 * `autonumber`). That is the WRITE contract — "never client-written" — and
 * gating a sort with it would refuse the two types that sort CORRECTLY:
 * `summary` is a `table.float` maintained by the engine and `autonumber` a
 * `table.string` the engine assigns. The distinction is pinned by name in the
 * engine's own conformance suite and restated in `protocol.ts`'s
 * `UNMATERIALIZED_SORT_TYPES` note; widening here would produce the false
 * finding that makes authors stop trusting the linter (ADR-0072 D1).
 *
 * ── Which sort positions are walked, and which were checked and are not ──
 *
 * Walked — every author-written `sort` that lowers into an engine `orderBy`
 * over the bound object's OWN fields, which is the same set of surfaces
 * `validateSearchableFields` walks for `searchableFields`:
 *
 *   - `objects[].listViews.<key>.sort` — built-in named list views;
 *   - `views[].list.sort` — a `defineView` aggregate's default list;
 *   - `views[].listViews.<key>.sort` — its named list views;
 *   - `views[].sort` on a FLATTENED LIST OVERLAY (#9313) — a `views[]` entry
 *     that IS a single list view (`viewKind: 'list'`, no nested `config`,
 *     no container slots): `ViewMetadataSchema`'s list-overlay member, the
 *     shape a standalone list view takes through `PUT /api/v1/meta/view` —
 *     the only door a Studio tenant or an MCP/AI author has. The runtime
 *     publish gate builds its per-write snapshot as `views: [item]`, so
 *     without this rung the dispatch widening (#9313's other half) would be
 *     a silent no-op that reads as coverage. See the self rung note at the
 *     walk below for how the shape is recognised.
 *   - `views[].config.sort` on a standalone ViewItem RECORD (commit f1b5ad39a) — the
 *     wire union's OTHER standalone member (`ViewItemWireSchema`,
 *     `{ name, object, viewKind: 'list', config }`), through the same door:
 *     objectui's `updateView` round-trips the whole record on every
 *     pin/reorder toggle, `config` included. Judged against
 *     `listViewObject(config) ?? entry.object`; the record rung note at the
 *     walk below carries the recogniser.
 *
 * NOT walked, each verified against the schema rather than assumed:
 *
 *   - **A report's `query.orderBy`.** Verified: no such authoring surface
 *     exists. The one place a raw report query ever lived was a runtime record
 *     (the saved-report stack's `query_json` column), never a key in stack
 *     metadata — and that stack was retired whole in #20102. The stack's own
 *     `reports[]` is `ReportSchema`, whose ADR-0021 single-form cutover REMOVED
 *     the inline query; what it declares instead is `order[].by`, naming a
 *     dataset dimension or measure, and `checkReportOrder` already refines that
 *     against what the report selects. So there is no authored `query.orderBy`
 *     for a stack rule to reach.
 *   - **Flow node sort config.** Verified: none exists.
 *     `automation/builtin-node-config.zod.ts`'s record-reading node declares
 *     `limit` and no ordering key at all, and no schema under
 *     `packages/spec/src/automation/` declares `sort` or `orderBy`.
 *   - **Dashboard widget sort config.** Verified present but out of this
 *     predicate's domain: `DashboardWidgetOptionsSchema.sortBy`
 *     (`ui/dashboard.zod.ts`) names "a dimension or measure this widget
 *     actually selects" and is lowered into a `DatasetSelection.order`, i.e. an
 *     ADR-0021 semantic-layer name resolved against a DATASET — not an object
 *     field, so a field-type predicate cannot judge it. The same is true of
 *     `ReportSchema.order[].by`. Judging those needs the dataset's measure
 *     index, which is `validateChartBindings`' family, not this one.
 *
 * PAGE sorts (`ui/page.zod.ts`, `ui/component.zod.ts`) are walked since
 * #30023: a component's `dataSource.sort`, a related list's
 * `parentDataSource.sort`, the `properties.sort` of each block in
 * `PAGE_BLOCK_SORT_OBJECT_PROP`, a list page's `interfaceConfig.sort` and an
 * app page's `record.sort`. Each reaches the same list door a list view's sort
 * does. Since #30093 every one of them is asked existence and provenance here
 * too, under the page family's ids (`page-field-unknown` at `error`,
 * `page-field-unprovisioned` at `warning`), and `validate-page-field-bindings`
 * no longer reads a page sort: one reader per slot, at the door's grade, in the
 * member that reaches the page publish door. A `kind: 'react'` page's JSX
 * props are still `validate-react-page-props`' territory and are not walked
 * here.
 * The flattened standalone list overlay used to be listed here too — the
 * #4463 P2 gap this module's first landing recorded — and is walked since
 * #9313 (the self rung above). Its sibling shape, a standalone ViewItem
 * RECORD (`{ name, object, viewKind, config }` — `config.sort` one level
 * down), was #9313's recorded follow-up scope and is walked since commit f1b5ad39a
 * (the record rung above).
 *
 * ── Skips, matching the search axis one for one (ADR-0072 D1) ────────────
 *
 *   1. An object this stack does not define — it may come from another package,
 *      and a field map we cannot see cannot be judged.
 *   2. An object that declares no field map at all — a datasource-introspected
 *      schema whose columns resolve at runtime.
 *
 *      ⚠️ This skip is NOT an `external` test, and the sentence that used to
 *      say so was measured wrong (#10474). `declaredFieldTarget`
 *      (`validate-searchable-fields.ts`) returns `null` on exactly one
 *      condition — `fields` missing, unreadable, or naming nothing — and
 *      nothing in it looks at `external`. An ADR-0015 `external` object that
 *      DOES declare a mapped field map is the shipped shape (`examples/
 *      app-showcase`'s `showcase_ext_customer`), and it is indexed like any
 *      other object and reaches skip 3 below. Measured on that object:
 *      `indexObjectSearchTargets(...).get('showcase_ext_customer')` is
 *      non-null with `names = [email, lifetime_value, name, region]`.
 *   3. Registry-injected system columns (`SYSTEM_FIELDS`, derived from the
 *      spec's own declarations). `sort: [{ field: 'created_at' }]` is the
 *      single most common list-view ordering in the platform's own objects and
 *      names a real column that never appears in authored `fields`. They are
 *      skipped for VIRTUALITY too: their runtime metadata is registry-owned and
 *      invisible here, and none of them is a formula.
 *
 *      Skip 3 answers EXISTENCE, and since #10474 it no longer ends the
 *      matter — see the provenance section below.
 *
 * ── PROVENANCE: the second question about a name skip 3 kept (#10474) ────
 *
 * Skip 3 decided not to FLAG the name. On an ADR-0015 `external` object the
 * platform registers its injected anchors and provisions no storage behind
 * them (#7865 / #8116), so `created_at` there is addressable and backed by
 * nothing. Existence rightly stays silent; PROVENANCE is a second question,
 * asked only of the names skip 3 already kept and answered by the per-object
 * index ({@link indexUnprovisionedAnchors}) rather than the object-independent
 * union. This is the SORT twin of the SEARCH wiring commit b849e6911 added on the
 * identical index, and it is the same shape the four filter/binding rules
 * carry since #8340.
 *
 * WHY THIS AXIS NEEDS ITS OWN AUTHORING ANSWER — neither runtime door refuses
 * it. Both key on `formula` ALONE (`UNMATERIALIZED_SORT_TYPES`): the ingress
 * gate's third verdict (`assertSortFieldsExist`, #6994) and the engine's
 * (`assertOrderByIsMaterializable`, #7095). An injected anchor is a `datetime`
 * or `lookup`, it IS in `gate.known` (the registry injected it into the served
 * schema), and it is undotted — so it passes all three verdicts and reaches
 * the driver. Measured (#10474) with a real `SqlDriver` over better-sqlite3,
 * the object declared exactly as `examples/app-showcase` declares it, against
 * a remote `customers` table carrying `[id, name, email, region,
 * lifetime_value]` and none of the seven injected anchors:
 *
 * ```
 * orderBy name       asc -> [c1,c2,c3]   desc -> [c3,c2,c1]   (a real column: reverses)
 * orderBy created_at asc -> [c1,c2,c3]   desc -> [c1,c2,c3]   asc === desc, 3 rows, no error
 * orderBy owner_id   asc -> [c1,c2,c3]   desc -> [c1,c2,c3]   asc === desc, 3 rows, no error
 * ```
 *
 * `asc` and `desc` coming back byte-identical while the baseline reverses is
 * what makes it a DROPPED sort rather than a coincidence — the same signature
 * this rule's virtuality docblock records for `formula`, reached by a second
 * route. The difference is that a formula sort is REFUSED at both doors and
 * this one is not: a list view ordered by an anchor with no storage answers
 * `200` with the rows in the driver's arbitrary order, on the view's first
 * fetch and every fetch after it, and `limit`/`offset` then slice an arbitrary
 * page out of it.
 *
 * WARNING, never `error`, and never gating — #4330's cost asymmetry, the same
 * call every sibling makes. The remote schema is not visible to this pass, so
 * the remote table may genuinely carry a `created_at` of its own; the finding
 * describes a degradation the author must check against their remote schema,
 * not a refusal this pass can prove. (An author-DECLARED column of the same
 * name is the author's — #7859's security direction — and
 * `unprovisionedInjectedColumnsFor` already excludes it, so vouching for the
 * remote column by declaring it silences this finding, which is exactly the
 * first remedy the shared hint prescribes.)
 *
 * NOT asked for a DOTTED name, which is the one place this axis departs from
 * the SEARCH twin, and deliberately: `validate-searchable-fields` asks about
 * dotted entries because `resolveSearchFields` matches by exact string and
 * drops them like a typo, whereas a dotted SORT name is REFUSED by the ingress
 * gate as its own second verdict (`400 INVALID_SORT`, loudly, on every fetch).
 * The silent-degradation this finding reports therefore cannot happen on that
 * path, and answering there would give the SORT axis its own dotted verdict —
 * precisely what the paragraph below records this rule as declining to do.
 * `validate-page-field-bindings` takes the same posture, skipping a dotted ref
 * before either question (#8340).
 *
 * A DOTTED name (`account.name`) is refused by the ingress gate as its own
 * second verdict, and this rule deliberately does not add a third finding for
 * it — it judges the head for existence and stops there, so a dotted path with
 * a known head passes here and is refused at request time. That gap is
 * recorded rather than closed because the dotted verdict is a posture shared
 * with the FILTER and PROJECTION axes (#4256 / #7532 / #7589) and giving one
 * axis its own authoring answer is how those doors drifted apart before.
 */

import {
  FIELD_UNSORTABLE_AUTHOR_DECLARED,
  resolveObjectSortability,
  type FieldSortability,
} from '@objectstack/spec/api';

import { objectsAsServed, objectsWithoutTiedFields, recordsOf, suggestName } from './object-graph.js';
import { walkPageComponents } from './page-walk.js';
import { PAGE_FIELD_UNKNOWN, PAGE_FIELD_UNPROVISIONED } from './validate-page-field-bindings.js';
import {
  SYSTEM_FIELDS,
  indexUnprovisionedAnchors,
  unprovisionedAnchorFix,
  unprovisionedAnchorVerdict,
} from './system-fields.js';
import {
  indexObjectSearchTargets,
  virtualFieldClause,
  type ObjectSearchTarget,
} from './validate-searchable-fields.js';

export const SORT_FIELD_UNKNOWN = 'sort-field-unknown';
export const SORT_FIELD_UNSORTABLE = 'sort-field-unsortable';
/** [#10474] The provenance verdict — a WARNING, unlike the two above. */
export const SORT_FIELD_UNPROVISIONED = 'sort-field-unprovisioned';

export type SortableFieldSeverity = 'error' | 'warning';

export interface SortableFieldFinding {
  /**
   * `error` for the two verdicts the runtime REFUSES (`400 INVALID_SORT` at
   * request time); `warning` for the #10474 provenance verdict, which no
   * runtime door refuses and which this pass cannot prove against a remote
   * schema it cannot see.
   */
  severity: SortableFieldSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `object "crm_opportunity" › listViews.pipeline`. */
  where: string;
  /** Config path, e.g. `objects[0].listViews.pipeline.sort[1]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** One parsed sort key: the field name, and the path segment it was written at. */
interface SortKey {
  field: string;
  /** Index suffix for `path` — `[0]` for an array entry, `''` for the string form. */
  at: string;
}

/**
 * Read an authored `sort` declaration into the field names it orders by.
 *
 * Mirrors the SHAPES `normalizeSortNodes` (`@objectstack/metadata-protocol`)
 * folds at the wire, narrowed to the two the authoring schema declares:
 *
 *   - the legacy string — `'amount desc'`, `'-amount'`, and the comma-separated
 *     multi-key form `'stage asc, amount desc'` the normalizer splits on;
 *   - the structured `Array<{ field, order }>`.
 *
 * A string ENTRY inside the array is accepted too: the wire normalizer takes it
 * and a pre-parse stack can still be carrying one. Anything else — a number, a
 * record with no string `field` — is a SHAPE error the schema owns, not a
 * dangling reference, and is skipped here for the same reason
 * `checkSearchableFieldList` skips a non-string entry.
 */
function readSortKeys(declared: unknown): SortKey[] {
  const fromShorthand = (raw: string, at: string): SortKey | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const bare = trimmed.startsWith('-') ? trimmed.slice(1).trim() : trimmed.split(/\s+/)[0];
    return bare ? { field: bare, at } : undefined;
  };

  if (typeof declared === 'string') {
    return declared
      .split(',')
      .map((part, i) => fromShorthand(part, declared.includes(',') ? `[${i}]` : ''))
      .filter((k): k is SortKey => !!k);
  }

  if (Array.isArray(declared)) {
    const keys: SortKey[] = [];
    for (let i = 0; i < declared.length; i++) {
      const el = declared[i];
      if (typeof el === 'string') {
        const k = fromShorthand(el, `[${i}]`);
        if (k) keys.push(k);
        continue;
      }
      if (!isRec(el)) continue;
      const field = strName(el.field);
      if (field) keys.push({ field: field.trim(), at: `[${i}]` });
    }
    return keys;
  }

  return [];
}

/**
 * Check ONE authored `sort` declaration against the object it is bound to —
 * the shared core behind every list-view surface that declares an ordering.
 *
 * `fieldsByObject` is {@link indexObjectSearchTargets}' index, reused rather
 * than rebuilt: the SEARCH and SORT doors must agree about which fields an
 * object has and what type each one is, and two hand-written readers of the
 * same field map is the drift `system-fields.ts` and `view-walk.ts` were both
 * created to end. `subject` names the declaration for the message; the parsed
 * key's position is appended to `path` so the author can go straight to it.
 */
export function checkSortDeclaration(
  declared: unknown,
  objectName: string | undefined,
  fieldsByObject: ReadonlyMap<string, ObjectSearchTarget | null>,
  where: string,
  path: string,
  subject: string,
  // [#10474] `objectName -> its unprovisioned injected anchors`
  // ({@link indexUnprovisionedAnchors}). OPTIONAL, and its absence means
  // exactly one thing: this caller did not build the index, so the provenance
  // question goes unasked and only existence/virtuality are answered — the
  // pre-#10474 behaviour, preserved for out-of-repo callers of this exported
  // core (this function is part of the package's public surface). The same
  // posture, for the same reason, as `checkSearchableFieldList`'s own
  // trailing parameter. Every in-repo caller passes it.
  unprovisionedAnchors?: ReadonlyMap<string, ReadonlySet<string>>,
  // [#30023] `objectName -> its sortability projection`
  // ({@link indexObjectSortability}). OPTIONAL, with the same posture as the
  // anchor index above: absent, the projection is derived from the
  // `fieldsByObject` slice, which carries each field's `type` and nothing
  // else, so only the virtual-type verdict is answered — the pre-#30023
  // behaviour for out-of-repo callers. Every in-repo caller passes it, and
  // then the author-declared verdict (`sortable: false`) is answered too.
  sortability?: ReadonlyMap<string, SortabilityFields>,
): SortableFieldFinding[] {
  const findings: SortableFieldFinding[] = [];
  if (declared === undefined || declared === null) return findings;
  if (!objectName) return findings; // nothing to resolve against
  if (!fieldsByObject.has(objectName)) return findings; // ① object from another package
  const target = fieldsByObject.get(objectName);
  if (!target) return findings; // ② external / introspected — no authored field map

  const known = target.names;
  const anchors = unprovisionedAnchors?.get(objectName);
  const projection =
    sortability?.get(objectName) ?? resolveObjectSortability({ fields: target.fields }).fields;

  for (const key of readSortKeys(declared)) {
    const name = key.field;
    // The ingress gate resolves existence on the HEAD segment
    // (`!gate.known.has(f.split('.')[0])`); matching it keeps the two doors
    // from disagreeing about which names are unknown.
    const head = name.split('.')[0];
    // ③ Registry-injected system column — real at runtime, absent from
    // authored `fields`. `created_at` is the platform's own most common list
    // ordering, and flagging it would be the false finding ADR-0072 D1 warns
    // about.
    if (SYSTEM_FIELDS.has(head)) {
      // [#10474] Existence answered "yes"; the membership test above keeps
      // owning that first question. PROVENANCE is the second one — on a
      // federated object this anchor is addressable and has no storage, and
      // neither runtime door refuses an ORDER BY over it (both key on
      // `formula` alone), so the view's first fetch answers 200 with the rows
      // in the driver's arbitrary order. Emitted here, before the `continue`
      // the skip has always ended with: an injected anchor has no entry in
      // `target.fields`, so the virtuality check below is a no-op for it and
      // there is nothing to fall through to.
      //
      // Undotted only — see the module note. A dotted SORT name is refused by
      // the ingress gate as its own verdict, so the silent degradation this
      // finding reports cannot happen on that path.
      if (!name.includes('.') && anchors?.has(head)) {
        findings.push({
          severity: 'warning',
          rule: SORT_FIELD_UNPROVISIONED,
          where,
          path: `${path}${key.at}`,
          // [#22161] One verdict sentence: the shared short anchor clause and
          // this axis' consequence. The measured byte-identical reading and why
          // no door refuses it are the id's `os explain` entry.
          message:
            `${subject}: ${unprovisionedAnchorVerdict(objectName, name)}, so its ORDER BY is ` +
            `dropped and every fetch returns rows in an arbitrary order`,
          hint: unprovisionedAnchorFix(objectName, name),
        });
      }
      continue;
    }

    if (!known.has(head)) {
      const dotted = name.includes('.');
      findings.push({
        severity: 'error',
        rule: SORT_FIELD_UNKNOWN,
        where,
        path: `${path}${key.at}`,
        message:
          `${subject} orders by "${name}", which is not a field on object ` +
          `"${objectName}", so every load of this view answers 400 INVALID_SORT.` +
          (dotted ? '' : suggestName(head, known)),
        // [#22161] One remedy line; the field roster is not echoed, since the
        // verdict's "Did you mean" names the near miss.
        hint: dotted
          ? `'sort' reaches only "${objectName}"'s own columns, never a related record's: denormalise ` +
            `the value onto a stored field here and sort by that`
          : `Fix the name, or add "${name}" to ${objectName}.fields`,
      });
      continue;
    }

    // Unsortability — the verdicts an author cannot see, because the name IS
    // a real field. Judged by the served sortability projection
    // (`resolveObjectSortability`), the one the list door
    // (`assertSortFieldsExist`) refuses by, so linter and door cannot
    // disagree: `virtual-type` (no column to ORDER BY) and, since #30023,
    // `author-declared` (`sortable: false`).
    const unsortable = unsortableFinding(
      projection[name], name, objectName, target.fields[name]?.type, where, `${path}${key.at}`, subject,
    );
    if (unsortable) findings.push(unsortable);
  }

  return findings;
}

/** One object's sortability projection: field name → its served verdict. */
export type SortabilityFields = Readonly<Record<string, FieldSortability>>;

/**
 * [#30023] object name → its sortability projection, derived by
 * `resolveObjectSortability` (`@objectstack/spec/api`) from the object as
 * authored — the resolver the `GET /meta/object/:name` envelope serves and the
 * Data API list door (`assertSortFieldsExist`) refuses by. Reused rather than
 * re-derived from field `type` and `sortable`: a second reading of the same
 * two facts is how a linter and a door come to disagree.
 */
export function indexObjectSortability(stack: AnyRec): Map<string, SortabilityFields> {
  const out = new Map<string, SortabilityFields>();
  if (!isRec(stack)) return out;
  for (const obj of recordsOf(stack.objects)) {
    const name = strName(obj.name);
    if (name) out.set(name, resolveObjectSortability(obj).fields);
  }
  return out;
}

/**
 * [#30471] The two field indexes over the objects as SERVED (`objectsAsServed`,
 * the package's one fold), as the list door reads them:
 *
 *   - existence ({@link indexObjectSearchTargets}' shape): a field an
 *     `objectExtensions` entry adds is a known name, a field two packages tie
 *     on included, since existence never asks which definition wins;
 *   - sortability ({@link indexObjectSortability}): a question about the
 *     field's definition, so a tied field is left out
 *     (`objectsWithoutTiedFields`) and goes unjudged.
 *
 * An object that declares no field map keeps its declared answer on both
 * (skip 2, `null` and its own projection): an extension adding to an
 * introspected schema does not make that schema knowable, extended or not.
 */
function indexServedSortFields(stack: AnyRec): {
  fieldsByObject: Map<string, ObjectSearchTarget | null>;
  sortability: Map<string, SortabilityFields>;
} {
  const served = objectsAsServed(stack);
  const fieldsByObject = indexObjectSearchTargets({ objects: served.objects });
  const sortability = indexObjectSortability({ objects: objectsWithoutTiedFields(served) });
  const declaredSortability = indexObjectSortability(stack);
  for (const [name, target] of indexObjectSearchTargets(stack)) {
    if (target !== null) continue;
    fieldsByObject.set(name, null);
    const own = declaredSortability.get(name);
    if (own) sortability.set(name, own);
  }
  return { fieldsByObject, sortability };
}

/**
 * The finding for one sort key whose projection entry says `sortable: false`,
 * or `undefined` when it does not (no entry — unknown, dotted, a registry
 * anchor — or `sortable: true`). Both reasons are `error`: the list door
 * answers each with `400 INVALID_SORT`, on the declaration's first fetch and
 * every fetch after it, so the #9257 grading applies to the second reason
 * unchanged.
 */
function unsortableFinding(
  verdict: FieldSortability | undefined,
  name: string,
  objectName: string,
  vtype: string | undefined,
  where: string,
  path: string,
  subject: string,
): SortableFieldFinding | undefined {
  if (verdict?.sortable !== false) return undefined;
  if (verdict.reason === FIELD_UNSORTABLE_AUTHOR_DECLARED) {
    return {
      severity: 'error',
      rule: SORT_FIELD_UNSORTABLE,
      where,
      path,
      // The door's own clause (`a field on '<object>' that declares
      // \`sortable: false\``), so an author refused here and one refused at
      // request time read the same field and the same reason.
      message:
        `${subject} orders by "${name}", a field on object "${objectName}" that declares ` +
        '`sortable: false`, so every load answers 400 INVALID_SORT',
      hint: `Sort by another field, or remove \`sortable: false\` from "${name}" to make it sortable`,
    };
  }
  return {
    severity: 'error',
    rule: SORT_FIELD_UNSORTABLE,
    where,
    path,
    message:
      `${subject} orders by "${name}" on object "${objectName}", ` +
      `${virtualFieldClause(vtype)}, so there is no column to ORDER BY`,
    // [#22161] One remedy line; that both runtime doors refuse it with
    // 400 INVALID_SORT is the id's `os explain` entry.
    hint:
      `Denormalise the value onto "${objectName}" (a stored field, written when the source ` +
      `changes) and sort by that, or drop "${name}" from this sort`,
  };
}

/**
 * [#30023] Page blocks that declare their own `properties.sort`, and the
 * position inside `properties` that names the object it orders (dotted for a
 * nested one) — the `ComponentPropsMap` rows with a live `sort` key (pinned
 * against the spec in the test). Each block resolves its query as
 * `dataSource.<key> ?? properties.<key>`, so the node-level binding's `object`
 * wins over this position. A page `list-view` node's bag is a list view, so its
 * binding is the list view's own `data.object`.
 */
export const PAGE_BLOCK_SORT_OBJECT_PROP: Readonly<Record<string, string>> = {
  'list-view': 'data.object',
  'record:related_list': 'objectName',
  'record:line_items': 'childObject',
  'object-grid': 'objectName',
  'object-calendar': 'objectName',
  'object-gantt': 'objectName',
  'object-map': 'objectName',
  'object-timeline': 'objectName',
};

/**
 * [#30023] Judge one STORED PAGE sort. A page sort reaches the same list door a
 * list view's does, so each key is asked the door's questions in the door's
 * order, at the door's severity:
 *
 *   1. EXISTENCE (`page-field-unknown`, `error`, #30093) — a name the object
 *      does not have. The list door (`assertSortFieldsExist`) answers it
 *      `400 INVALID_SORT` on the first fetch and every fetch after it, so the
 *      grade is the list view's `sort-field-unknown` grade, under the page
 *      family's id: an author reading a page finding reads the page rule.
 *      Before #30093 two slots (a related list's `sort`, `interfaceConfig.sort`)
 *      were read here by `validate-page-field-bindings` at `warning`, and the
 *      element `dataSource.sort`, `parentDataSource.sort`, `record.sort` and
 *      the other blocks' own `sort` were read by nothing, so the page published
 *      green and broke on its first read. This member is the one that reaches
 *      the page publish door (`runtimeTypes` carries `page`), so asking it here
 *      refuses the page at save instead.
 *   2. PROVENANCE (`page-field-unprovisioned`, `warning`) — a registry-injected
 *      anchor on an ADR-0015 `external` object. Its ORDER BY reaches the driver
 *      and is dropped; no door refuses it, so it stays advisory (#10474's
 *      reasoning, the list-view twin's grade).
 *   3. SORTABILITY (`sort-field-unsortable`, `error`) — the projection's
 *      `sortable: false`, a `formula` or an author-declared one.
 *
 * Two skips, the `page-field-unknown` family's own: a DOTTED name, which the
 * door refuses as its own verdict and this family does not judge, and an
 * object this stack does not define or that declares no field map.
 */
function checkPageSortDeclaration(
  declared: unknown,
  objectName: string | undefined,
  fieldsByObject: ReadonlyMap<string, ObjectSearchTarget | null>,
  sortability: ReadonlyMap<string, SortabilityFields>,
  unprovisionedAnchors: ReadonlyMap<string, ReadonlySet<string>>,
  where: string,
  path: string,
  subject: string,
): SortableFieldFinding[] {
  if (declared === undefined || declared === null || !objectName) return [];
  const projection = sortability.get(objectName);
  if (!projection) return []; // ① object from another package
  const target = fieldsByObject.get(objectName); // null ⇒ ② no authored field map
  const anchors = unprovisionedAnchors.get(objectName);
  const findings: SortableFieldFinding[] = [];
  for (const key of readSortKeys(declared)) {
    const name = key.field;
    const at = `${path}${key.at}`;
    if (name.includes('.')) continue;
    if (SYSTEM_FIELDS.has(name)) {
      if (anchors?.has(name)) {
        findings.push({
          severity: 'warning',
          rule: PAGE_FIELD_UNPROVISIONED,
          where,
          path: at,
          message:
            `${subject}: ${unprovisionedAnchorVerdict(objectName, name)}, so its ORDER BY is ` +
            'dropped and every fetch returns rows in an arbitrary order',
          hint: unprovisionedAnchorFix(objectName, name),
        });
      }
      // An author-DECLARED field of a system name is the author's own column,
      // so it falls through to the projection; a bare anchor has no entry there.
      if (!target?.names.has(name)) continue;
    }
    if (target && !target.names.has(name)) {
      findings.push({
        severity: 'error',
        rule: PAGE_FIELD_UNKNOWN,
        where,
        path: at,
        message:
          `field "${name}" is not a field on object "${objectName}" — the ${subject} orders by it, ` +
          'so every load answers 400 INVALID_SORT.',
        // The `page-field-unknown` family's one remedy line: the nearest
        // declared field, never the field list.
        hint: `Fix the field name, or add "${name}" to ${objectName}.${suggestName(name, target.names)}`,
      });
      continue;
    }
    const unsortable = unsortableFinding(
      projection[name],
      name,
      objectName,
      target?.fields[name]?.type,
      where,
      at,
      subject,
    );
    if (unsortable) findings.push(unsortable);
  }
  return findings;
}

/**
 * [#30023] Every stored sort a PAGE carries that reaches the Data API list
 * door, judged by {@link checkPageSortDeclaration} (existence, provenance and
 * sortability since #30093), each bound to the object its renderer reads:
 *
 *   - every component's node-level `dataSource.sort` (`ElementDataSourceSchema`),
 *     bound to `dataSource.object`;
 *   - a `record:related_list`'s `properties.parentDataSource.sort` (the same
 *     schema, bound to its own `object`);
 *   - the `properties.sort` of each block in {@link PAGE_BLOCK_SORT_OBJECT_PROP};
 *   - a list page's own `interfaceConfig.sort`, bound to
 *     `interfaceConfig.source`, else the page's `object`;
 *   - an app page's `record.sort`, bound to `record.object`.
 */
function validatePageSorts(
  stack: AnyRec,
  fieldsByObject: ReadonlyMap<string, ObjectSearchTarget | null>,
  sortability: ReadonlyMap<string, SortabilityFields>,
  unprovisionedAnchors: ReadonlyMap<string, ReadonlySet<string>>,
): SortableFieldFinding[] {
  const findings: SortableFieldFinding[] = [];
  const check = (declared: unknown, objectName: string | undefined, where: string, path: string, subject: string) => {
    findings.push(
      ...checkPageSortDeclaration(
        declared, objectName, fieldsByObject, sortability, unprovisionedAnchors, where, path, subject,
      ),
    );
  };

  const pages = recordsOf(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const pageName = strName(page.name) ?? `#${pi}`;

    for (const { component, path } of walkPageComponents(page, `pages[${pi}]`)) {
      const type = strName(component.type) ?? 'component';
      const where = `page "${pageName}" · ${type}`;
      const props = isRec(component.properties) ? component.properties : undefined;
      const dataSource = isRec(component.dataSource) ? component.dataSource : undefined;

      if (dataSource) {
        check(dataSource.sort, strName(dataSource.object), where, `${path}.dataSource.sort`, `${type} dataSource sort`);
      }
      if (!props) continue;
      const objectProp = PAGE_BLOCK_SORT_OBJECT_PROP[type];
      if (objectProp) {
        check(
          props.sort,
          strName(dataSource?.object) ?? strName(valueAt(props, objectProp)),
          where,
          `${path}.properties.sort`,
          `${type} sort`,
        );
      }
      // The PARENT binding is declared on `record:related_list` alone.
      const parent =
        type === 'record:related_list' && isRec(props.parentDataSource) ? props.parentDataSource : undefined;
      if (parent) {
        check(
          parent.sort,
          strName(parent.object),
          where,
          `${path}.properties.parentDataSource.sort`,
          `${type} parentDataSource sort`,
        );
      }
    }

    const cfg = isRec(page.interfaceConfig) ? page.interfaceConfig : undefined;
    if (cfg) {
      check(
        cfg.sort,
        strName(cfg.source) ?? strName(page.object),
        `page "${pageName}" · interfaceConfig`,
        `pages[${pi}].interfaceConfig.sort`,
        'list-page sort',
      );
    }

    const record = isRec(page.record) ? page.record : undefined;
    if (record) {
      check(
        record.sort,
        strName(record.object),
        `page "${pageName}" · record`,
        `pages[${pi}].record.sort`,
        'page record sort',
      );
    }
  }
  return findings;
}

/**
 * Validate every list-view `sort` declaration in the stack — the object's
 * built-in named list views and the `defineView` aggregates that declare one.
 * Returns findings (empty = clean).
 *
 * The surfaces walked here are exactly `validateSearchableFields`', for the
 * same reason: these are the declarations that lower into an engine `orderBy`
 * over the bound object's own columns. See the module note for the four
 * sort-carrying surfaces that were checked and deliberately left out.
 */
export function validateSortableFields(stack: AnyRec): SortableFieldFinding[] {
  const findings: SortableFieldFinding[] = [];
  if (!isRec(stack)) return findings;

  const objects = Array.isArray(stack.objects)
    ? (stack.objects as unknown[])
    : isRec(stack.objects)
      ? Object.entries(stack.objects).map(([name, def]) => ({ name, ...(def as AnyRec) }))
      : [];
  // [#30471] The existence index and the sortability projection read the
  // objects as served ({@link indexServedSortFields}); the walk above stays on
  // the declared objects, so every finding keeps its declared path.
  const { fieldsByObject, sortability } = indexServedSortFields(stack);
  // [#10474] The provenance index alongside the existence one — same keying,
  // asked on the path where the existence check stays silent. Object-level
  // (`external`, the injected anchors), so it stays on the declared objects.
  const unprovisionedAnchors = indexUnprovisionedAnchors(stack);

  const check = (
    declared: unknown,
    objectName: string | undefined,
    where: string,
    path: string,
    subject: string,
  ) => {
    findings.push(
      ...checkSortDeclaration(
        declared,
        objectName,
        fieldsByObject,
        where,
        path,
        subject,
        unprovisionedAnchors,
        sortability,
      ),
    );
  };

  // ── The object's built-in named list views ──
  for (let oi = 0; oi < objects.length; oi++) {
    const obj = objects[oi];
    if (!isRec(obj)) continue;
    const objName = strName(obj.name);
    const label = objName ? `object "${objName}"` : `objects[${oi}]`;

    if (isRec(obj.listViews)) {
      for (const [key, lv] of Object.entries(obj.listViews)) {
        if (!isRec(lv)) continue;
        check(
          lv.sort,
          // A built-in list view belongs to its object; an inline `data.object`
          // may still retarget it (ADR-0047 allows the explicit binding).
          listViewObject(lv) ?? objName,
          `${label} › listViews.${key}`,
          `objects[${oi}].listViews.${key}.sort`,
          'list-view sort',
        );
      }
    }
  }

  // ── `defineView` aggregates: the default `list` + named `listViews` ──
  const views = Array.isArray(stack.views) ? (stack.views as unknown[]) : [];
  for (let vi = 0; vi < views.length; vi++) {
    const view = views[vi];
    if (!isRec(view)) continue;
    const viewLabel = strName(view.name) ?? strName(view.objectName) ?? `#${vi}`;
    // The aggregate's own binding is the fallback for a list view that declares
    // none — the same resolution order `validateSearchableFields` reads.
    const viewObject = strName(view.objectName) ?? strName(view.object);

    // ── [#9313] The SELF rung: a flattened standalone list overlay ──
    //
    // A `views[]` entry that IS a single list view — `ViewMetadataSchema`'s
    // list-overlay member (`ListViewSchema.extend(flattenedViewOverlayFields())`),
    // the shape a standalone list view takes through `PUT /api/v1/meta/view`
    // and the shape the runtime publish gate snapshots as `views: [item]`.
    // Recognised by the wire schema's own structural discrimination:
    // `viewKind: 'list'` (REQUIRED on the overlay arm since #7741, and a key
    // the strict container schema refuses by name, so a container can never
    // match) with no nested `config` (a body carrying one is a ViewItem
    // RECORD, judged by its own record rung below since commit f1b5ad39a).
    // `view-walk.ts` established the same
    // `self` rung for the section-carrying shapes; this is its list twin.
    //
    // The binding order matches every other list-view rung: the overlay's own
    // `data.object` (ADR-0047 explicit retarget) ahead of its required
    // top-level `object`. A console personalization PUT arrives with
    // `sort: [{ id, field, order }]` rows carrying objectui's row `id`
    // (#5074) — `readSortKeys` reads `field` and ignores the decoration.
    if (view.viewKind === 'list' && !isRec(view.config)) {
      check(
        view.sort,
        listViewObject(view) ?? viewObject,
        `view "${viewLabel}" (flattened list overlay)`,
        `views[${vi}].sort`,
        'list-view sort',
      );
    }

    // ── [commit f1b5ad39a] The RECORD rung: a standalone ViewItem record ──
    //
    // The self rung's structural complement — `ViewMetadataSchema`'s member 1
    // (`ViewItemWireSchema`): `{ name, object, viewKind: 'list', config }`,
    // the shape a Studio-saved view takes through `PUT /api/v1/meta/view`,
    // with its `sort` one level down inside `config`. A hot wire shape, not a
    // corner: objectui's `updateView` GETs the stored record and PUTs
    // `{ ...current, ...partial }` (`view.zod.ts`'s #5074 trace), so every
    // pin/reorder toggle round-trips the whole record, `config` included —
    // and before this rung a record whose `config.sort` named nothing
    // published through the runtime gate in silence, then answered
    // `400 INVALID_SORT` on the view's first fetch (#6994/#7095), every load.
    //
    // Recognised by the wire schema's own member discrimination, exactly as
    // the self rung recognises its member: `viewKind: 'list'` AND a
    // record-shaped `config` (the union's own record/overlay split; a strict
    // container can carry neither key, and a `form` record's
    // `FormViewSchema` config declares no sort surface). The binding order
    // matches every other list-view rung: the CONFIG's own `data.object`
    // (ADR-0047 explicit retarget — a record's data binding lives on its
    // config) ahead of the record's required top-level `object`.
    // `config.sort[].id` row decorations (#5074) ride through `readSortKeys`
    // unchanged. The record's top LEVEL is deliberately still not read: any
    // stray `sort` riding beside `config` in the stored body (`saveMetaItem`
    // persists the original) is a key the wire schema strips and no runtime
    // read path serves — judging it would be a false-positive channel.
    if (view.viewKind === 'list' && isRec(view.config)) {
      check(
        view.config.sort,
        listViewObject(view.config) ?? viewObject,
        `view "${viewLabel}" (ViewItem record)`,
        `views[${vi}].config.sort`,
        'list-view sort',
      );
    }

    if (isRec(view.list)) {
      check(
        view.list.sort,
        listViewObject(view.list) ?? viewObject,
        `view "${viewLabel}" › list`,
        `views[${vi}].list.sort`,
        'list-view sort',
      );
    }

    if (isRec(view.listViews)) {
      for (const [key, lv] of Object.entries(view.listViews)) {
        if (!isRec(lv)) continue;
        check(
          lv.sort,
          listViewObject(lv) ?? viewObject,
          `view "${viewLabel}" › listViews.${key}`,
          `views[${vi}].listViews.${key}.sort`,
          'list-view sort',
        );
      }
    }
  }

  // ── [#30023] Stored page sorts: existence (#30093), provenance, sortability ──
  findings.push(...validatePageSorts(stack, fieldsByObject, sortability, unprovisionedAnchors));

  return findings;
}

/** The value at a dotted position inside a record, or `undefined`. */
function valueAt(rec: AnyRec, dotted: string): unknown {
  let cur: unknown = rec;
  for (const seg of dotted.split('.')) {
    if (!isRec(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** A list view's own object binding: `data: { provider: 'object', object }`. */
function listViewObject(listView: AnyRec): string | undefined {
  const data = listView.data;
  return isRec(data) ? strName(data.object) : undefined;
}
