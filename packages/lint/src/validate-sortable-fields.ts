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
 * The verdict is `error`, not the advisory level the field-existence rules for
 * pages and forms use, for the reason `validate-searchable-fields` gives at
 * `error`: those describe a consumer that SKIPS an unknown name and renders the
 * rest; this one describes a declaration the runtime REFUSES outright.
 *
 * ── The predicate, and the type list this rule must NOT use ──────────────
 *
 * Virtuality is judged by {@link isVirtualSearchField} / `SEARCH_VIRTUAL_TYPES`
 * (`@objectstack/spec/data`), pinned to `formula` alone — the same spec fact
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
 *   - `views[].listViews.<key>.sort` — its named list views.
 *
 * NOT walked, each verified against the schema rather than assumed:
 *
 *   - **A saved report's `query.orderBy`.** Verified: it is not an authoring
 *     surface at all. `sys_saved_report` is a platform OBJECT and the envelope
 *     lives in its `query_json` COLUMN (`packages/platform-objects/src/audit/
 *     sys-saved-report.object.ts`, `contracts/report-service.ts`) — a runtime
 *     record written through the reports API, never a key in stack metadata.
 *     The stack's own `reports[]` is `ReportSchema`, whose ADR-0021 single-form
 *     cutover REMOVED the inline query; what it declares instead is
 *     `order[].by`, naming a dataset dimension or measure, and `checkReportOrder`
 *     already refines that against what the report selects. So there is no
 *     authored `query.orderBy` for a stack rule to reach; the engine door
 *     (#7095) is the only door that surface has, which is precisely why #7095
 *     added it.
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
 * Two more list-shaped surfaces carry a `sort` and are deliberately left to
 * their owners, exactly as the search axis leaves the react page surface to
 * `validate-react-page-props`: page/component `sort`
 * (`ui/page.zod.ts`, `ui/component.zod.ts` — `walkPageComponents`' territory)
 * and the flattened standalone list overlay the metadata door accepts
 * (`ViewMetadataSchema`'s list-overlay member, top-level `sort`). The overlay
 * reaches the runtime publish gate rather than a stack walk, and the
 * reference-integrity suite's runtime dispatch is `runtimeTypes: ['flow']`
 * today — widening it is #4463 P2's decision, not this rule's, and the SEARCH
 * axis has the identical gap.
 *
 * ── Skips, matching the search axis one for one (ADR-0072 D1) ────────────
 *
 *   1. An object this stack does not define — it may come from another package,
 *      and a field map we cannot see cannot be judged.
 *   2. An object that declares no field map at all — external objects and
 *      datasource-introspected schemas whose columns resolve at runtime.
 *   3. Registry-injected system columns (`SYSTEM_FIELDS`, derived from the
 *      spec's own declarations). `sort: [{ field: 'created_at' }]` is the
 *      single most common list-view ordering in the platform's own objects and
 *      names a real column that never appears in authored `fields`. They are
 *      skipped for VIRTUALITY too: their runtime metadata is registry-owned and
 *      invisible here, and none of them is a formula.
 *
 * A DOTTED name (`account.name`) is refused by the ingress gate as its own
 * second verdict, and this rule deliberately does not add a third finding for
 * it — it judges the head for existence and stops there, so a dotted path with
 * a known head passes here and is refused at request time. That gap is
 * recorded rather than closed because the dotted verdict is a posture shared
 * with the FILTER and PROJECTION axes (#4256 / #7532 / #7589) and giving one
 * axis its own authoring answer is how those doors drifted apart before.
 */

import { isVirtualSearchField } from '@objectstack/spec/data';
import { SYSTEM_FIELDS } from './system-fields.js';
import {
  indexObjectSearchTargets,
  type ObjectSearchTarget,
} from './validate-searchable-fields.js';

export const SORT_FIELD_UNKNOWN = 'sort-field-unknown';
export const SORT_FIELD_UNSORTABLE = 'sort-field-unsortable';

export type SortableFieldSeverity = 'error' | 'warning';

export interface SortableFieldFinding {
  /** Always `error` — both verdicts are a `400 INVALID_SORT` at request time. */
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

/** Levenshtein-bounded "did you mean?" over the object's own field names. */
function suggest(target: string, known: Iterable<string>): string {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of known) {
    const d = distance(target, candidate);
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  const limit = Math.max(2, Math.floor(target.length / 3));
  return best && bestScore <= limit ? ` Did you mean "${best}"?` : '';
}

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
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
): SortableFieldFinding[] {
  const findings: SortableFieldFinding[] = [];
  if (declared === undefined || declared === null) return findings;
  if (!objectName) return findings; // nothing to resolve against
  if (!fieldsByObject.has(objectName)) return findings; // ① object from another package
  const target = fieldsByObject.get(objectName);
  if (!target) return findings; // ② external / introspected — no authored field map

  const known = target.names;

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
    if (SYSTEM_FIELDS.has(head)) continue;

    if (!known.has(head)) {
      const dotted = name.includes('.');
      findings.push({
        severity: 'error',
        rule: SORT_FIELD_UNKNOWN,
        where,
        path: `${path}${key.at}`,
        message:
          `${subject} orders by "${name}", which is not a field on object ` +
          `"${objectName}". The runtime refuses the sort rather than dropping it: ` +
          `every load of this view answers 400 INVALID_SORT (#6994), because a sort ` +
          `is the view's FIRST fetch and not an optional interaction.` +
          (dotted ? '' : suggest(head, known)),
        hint:
          (dotted
            ? `'sort' reaches only whole columns of "${objectName}" itself, never a ` +
              `related record's column — denormalise the value onto "${objectName}" ` +
              `(a stored field, written when the source changes) and sort by that. `
            : `Fix the name, or add "${name}" to ${objectName}.fields. `) +
          (known.size > 0 ? `Object fields: ${[...known].sort().join(', ')}.` : ''),
      });
      continue;
    }

    // Virtuality — the verdict the runtime added last and the one an author
    // cannot see, because the name IS a real field. Judged by the spec's own
    // storage predicate so linter, ingress gate and engine cannot disagree
    // about which types have a column.
    const meta = target.fields[name];
    if (isVirtualSearchField(meta)) {
      const vtype = meta?.type;
      findings.push({
        severity: 'error',
        rule: SORT_FIELD_UNSORTABLE,
        where,
        path: `${path}${key.at}`,
        message:
          `${subject} orders by "${name}" on object "${objectName}", a virtual ` +
          `'${vtype}' field: its value is computed on read and never stored, so no ` +
          `driver materialises a column to ORDER BY. Measured, an unrefused sort on ` +
          `one returns 'asc' and 'desc' in byte-identical order — the rows carry the ` +
          `values they were asked to be ordered by, unordered, under a success.`,
        hint:
          `Denormalise the value onto "${objectName}" (a stored field, written when ` +
          `the source changes) and sort by that, or drop "${name}" from this sort. ` +
          `At runtime both doors now refuse it with 400 INVALID_SORT — the REST ` +
          `ingress (#6994) and the engine itself (#7095) — so the declaration ` +
          `breaks the view's first fetch, and every fetch after it.`,
      });
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
  const fieldsByObject = indexObjectSearchTargets(stack);

  const check = (
    declared: unknown,
    objectName: string | undefined,
    where: string,
    path: string,
    subject: string,
  ) => {
    findings.push(
      ...checkSortDeclaration(declared, objectName, fieldsByObject, where, path, subject),
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

  return findings;
}

/** A list view's own object binding: `data: { provider: 'object', object }`. */
function listViewObject(listView: AnyRec): string | undefined {
  const data = listView.data;
  return isRec(data) ? strName(data.object) : undefined;
}
