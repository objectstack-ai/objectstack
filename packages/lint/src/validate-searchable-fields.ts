// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0061 — searchable set] `searchableFields` entries must name a field the
 * object actually has.
 *
 * `searchableFields` is `z.array(z.string())` in both `object.zod.ts` and the
 * list-view schema, so nothing checks that an entry resolves to anything. Rename
 * a field and the old name stays behind: Zod-valid, shipped, and pointing at a
 * column that no longer exists.
 *
 * ── Why a stale entry is not merely inert ────────────────────────────────
 *
 * The engine tolerates it. `resolveSearchFields` (`@objectstack/objectql`)
 * filters the declaration down to fields that exist —
 * `searchableFields?.filter((f) => all[f])` — so a stale name is dropped
 * without a word. That tolerance is what makes the drift invisible, and it
 * fails in the direction nobody expects:
 *
 *   - Some entries stale → `$search` quietly scans a NARROWER set than the
 *     object declares. Records that should match do not, and the response is
 *     indistinguishable from "no such record".
 *   - EVERY entry stale → the filtered set is empty, so resolution falls
 *     through to the AUTO-DEFAULT (name/title + short-text fields). A
 *     declaration whose entire purpose is to CHOOSE the searchable set ends up
 *     selecting a set the author never wrote — the same "asked narrower,
 *     answered wider" inversion #4226 closed on the projection axis.
 *
 * And it does not stay quiet downstream. objectui's list search echoes
 * `schema.searchableFields` verbatim as the `$searchFields` override, so once
 * the REST read path validates that override against the object (#4254), a
 * stale declaration the engine had been silently skipping becomes a `400
 * INVALID_FIELD` on every list search for that object — a request-time break
 * whose cause is an authoring typo made long before.
 *
 * Hence `error`, not the advisory level the other field-existence rules use
 * (`page-field-unknown`, `form-field-unknown`, `semantic-role-field-unknown`
 * are all warnings). Those describe a consumer that SKIPS an unknown name and
 * renders the rest; this one describes a declaration that either selects the
 * wrong set or refuses the request outright. It is the same call
 * `validate-flow-template-paths` makes for a filter-position token: gating when
 * the miss widens the query rather than shrinking the page.
 *
 * ── What is checked, and what is deliberately not ────────────────────────
 *
 * Existence only. A field that exists but is an odd search target (a `json`
 * column, say) is NOT flagged: an explicit `searchableFields` is authoritative
 * — the engine scans exactly what it names — so declaring one is a choice, not
 * a mistake. Only a name resolving to no field at all is drift.
 *
 * Three skips keep false positives near zero (ADR-0072 D1 — one dead finding
 * and authors stop trusting the linter):
 *
 *   1. An object this stack does not define. It may come from another package,
 *      and a field map we cannot see cannot be judged (the same skip the
 *      page/flow/widget rules take).
 *   2. An object that declares no field map at all — external objects and
 *      datasource-introspected schemas whose columns are resolved at runtime.
 *   3. Registry-injected system columns, which are searchable at runtime but
 *      never appear in authored `fields`. Derived from the spec's own
 *      declarations rather than hand-copied: this package already carries five
 *      slightly-different copies of that list (#3786's lesson, unlearned).
 *
 * Dotted paths are NOT skipped here, unlike every sibling rule. Elsewhere
 * `owner_id.name` is left alone because the query engine resolves the traversal;
 * search does not — `resolveSearchFields` matches the field map by exact string,
 * so a dotted entry is dropped exactly like a typo. Skipping it would exempt the
 * one wrong spelling most likely to be borrowed from `select`/`sort`.
 */

import { FIELD_GROUP_SYSTEM_FIELDS } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';

export const SEARCHABLE_FIELD_UNKNOWN = 'searchable-field-unknown';

export type SearchableFieldSeverity = 'error' | 'warning';

export interface SearchableFieldFinding {
  /** Always `error` — a stale entry narrows, widens or refuses the search (see module note). */
  severity: SearchableFieldSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `object "crm_lead"`. */
  where: string;
  /** Config path, e.g. `objects[0].searchableFields[2]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/**
 * Registry-injected columns that are addressable at runtime without being
 * authored in `fields`. DERIVED from the spec's two declarations —
 * `FIELD_GROUP_SYSTEM_FIELDS` (audit provenance + tenant + soft-delete) and
 * `SystemFieldName` (the protocol-level ids) — so it cannot drift from them the
 * way five hand-copied variants in this package already have.
 */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set<string>([
  ...FIELD_GROUP_SYSTEM_FIELDS,
  ...Object.values(SystemFieldName),
]);

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The declared field NAMES of an object, or `null` when the object declares no
 * readable field map (external / introspected — nothing to judge against).
 * Reads both shapes: the name-keyed map and the legacy array of `{ name }`.
 */
function declaredFieldNames(obj: AnyRec): Set<string> | null {
  const fields = obj.fields;
  if (!fields || typeof fields !== 'object') return null;
  const names = new Set<string>();
  for (const f of asArray(fields)) {
    const n = strName(f.name);
    if (n) names.add(n);
  }
  return names.size > 0 ? names : null;
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
 * object name → declared field names. `null` marks an object with no readable
 * field map, so "declared nothing" stays distinguishable from "not in stack".
 * Exported alongside `checkSearchableFieldList` so every surface that authors
 * a searchable set resolves against the identical index (#4329).
 */
export function indexObjectSearchTargets(
  stack: Record<string, unknown>,
): Map<string, Set<string> | null> {
  const fieldsByObject = new Map<string, Set<string> | null>();
  if (!isRec(stack)) return fieldsByObject;
  for (const obj of asArray(stack.objects)) {
    const name = strName(obj.name);
    if (name) fieldsByObject.set(name, declaredFieldNames(obj));
  }
  return fieldsByObject;
}

/**
 * Check one `searchableFields` array against the field map `fieldsByObject`
 * holds for `objectName` — the shared core behind every surface that authors a
 * searchable set: the object/list-view metadata walked by
 * `validateSearchableFields` below, and the react page surface
 * (`<ListView searchableFields={…}>`, `validate-react-page-props`), which
 * reuses it so the two surfaces agree on what counts as a field — same three
 * skips, same dotted-path strictness (#4329).
 *
 * `subject` names the declaration for the message, since an object's own set
 * and a view's narrowing of it are fixed differently; the entry index is
 * appended to `path` so the author can go straight to the stale name.
 */
export function checkSearchableFieldList(
  declared: unknown,
  objectName: string | undefined,
  fieldsByObject: ReadonlyMap<string, Set<string> | null>,
  where: string,
  path: string,
  subject: string,
): SearchableFieldFinding[] {
  const findings: SearchableFieldFinding[] = [];
  if (!Array.isArray(declared) || declared.length === 0) return findings;
  if (!objectName) return findings; // nothing to resolve against
  if (!fieldsByObject.has(objectName)) return findings; // ① object from another package
  const known = fieldsByObject.get(objectName);
  if (!known) return findings; // ② external / introspected — no authored field map

  for (let i = 0; i < declared.length; i++) {
    const entry = declared[i];
    // Pre-parse input may carry junk here; a non-string is a SHAPE error the
    // schema owns, not a dangling reference.
    const name = strName(entry);
    if (!name) continue;
    if (known.has(name) || SYSTEM_FIELDS.has(name)) continue; // ③ system column

    const dotted = name.includes('.');
    findings.push({
      severity: 'error',
      rule: SEARCHABLE_FIELD_UNKNOWN,
      where,
      path: `${path}[${i}]`,
      message:
        `${subject} entry "${name}" is not a field on object "${objectName}". ` +
        `The declaration is stale: searching it can never match, and the engine ` +
        `silently drops it — leaving a narrower search than declared, or the ` +
        `auto-default set once every entry is dropped.` +
        (dotted ? '' : suggest(name, known)),
      hint:
        (dotted
          ? `'search' scans this object's own columns, so a related record's ` +
            `column cannot be a search target — expand the relation and search ` +
            `the related object, or copy the value onto a formula field here. `
          : `Fix the name, or add "${name}" to ${objectName}.fields. `) +
        `Clients echo this declaration verbatim as the '$searchFields' ` +
        `override, so a stale entry becomes a 400 INVALID_FIELD on list ` +
        `search (#4254), not just a quietly narrowed one.` +
        (known.size > 0 ? ` Object fields: ${[...known].sort().join(', ')}.` : ''),
    });
  }
  return findings;
}

/**
 * Validate every `searchableFields` declaration in the stack — the object's own
 * (the canonical set, ADR-0061) and the list views that narrow it. Returns
 * findings (empty = clean).
 *
 * The react page surface (`<ListView searchableFields={…}>`) is deliberately
 * NOT walked here: its declaration lives inside JSX source, and
 * `validate-react-page-props` — the gate that already parses that source —
 * runs the same `checkSearchableFieldList` core on it (#4329).
 */
export function validateSearchableFields(stack: AnyRec): SearchableFieldFinding[] {
  const findings: SearchableFieldFinding[] = [];
  if (!isRec(stack)) return findings;

  const objects = asArray(stack.objects);
  const fieldsByObject = indexObjectSearchTargets(stack);

  const check = (
    declared: unknown,
    objectName: string | undefined,
    where: string,
    path: string,
    subject: string,
  ) => {
    findings.push(
      ...checkSearchableFieldList(declared, objectName, fieldsByObject, where, path, subject),
    );
  };

  // ── The object's own canonical set, and its built-in named list views ──
  for (let oi = 0; oi < objects.length; oi++) {
    const obj = objects[oi];
    if (!isRec(obj)) continue;
    const objName = strName(obj.name);
    const label = objName ? `object "${objName}"` : `objects[${oi}]`;

    check(
      obj.searchableFields,
      objName,
      label,
      `objects[${oi}].searchableFields`,
      'searchableFields',
    );

    if (isRec(obj.listViews)) {
      for (const [key, lv] of Object.entries(obj.listViews)) {
        if (!isRec(lv)) continue;
        check(
          lv.searchableFields,
          // A built-in list view belongs to its object; an inline `data.object`
          // may still retarget it (ADR-0047 allows the explicit binding).
          listViewObject(lv) ?? objName,
          `${label} › listViews.${key}`,
          `objects[${oi}].listViews.${key}.searchableFields`,
          'list-view searchableFields',
        );
      }
    }
  }

  // ── `defineView` aggregates: the default `list` + named `listViews` ──
  const views = asArray(stack.views);
  for (let vi = 0; vi < views.length; vi++) {
    const view = views[vi];
    if (!isRec(view)) continue;
    const viewLabel = strName(view.name) ?? strName(view.objectName) ?? `#${vi}`;
    // The aggregate's own binding is the fallback for a list view that declares
    // none — the same resolution order `validate-list-view-mode` reads.
    const viewObject = strName(view.objectName) ?? strName(view.object);

    if (isRec(view.list)) {
      check(
        view.list.searchableFields,
        listViewObject(view.list) ?? viewObject,
        `view "${viewLabel}" › list`,
        `views[${vi}].list.searchableFields`,
        'list-view searchableFields',
      );
    }

    if (isRec(view.listViews)) {
      for (const [key, lv] of Object.entries(view.listViews)) {
        if (!isRec(lv)) continue;
        check(
          lv.searchableFields,
          listViewObject(lv) ?? viewObject,
          `view "${viewLabel}" › listViews.${key}`,
          `views[${vi}].listViews.${key}.searchableFields`,
          'list-view searchableFields',
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
