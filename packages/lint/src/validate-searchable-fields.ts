// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0061 — searchable set] `searchableFields` entries must name a field the
 * object actually has — and, on a list view, one the runtime will agree to scan.
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
 * ── What is checked ──────────────────────────────────────────────────────
 *
 * 1. EXISTENCE, on every surface (`searchable-field-unknown`): an entry that
 *    resolves to no field at all is drift, whatever declared it.
 *
 * 2. RUNTIME ADMISSIBILITY, on view-level narrowings only
 *    (`searchable-field-unsearchable`, #4830): a list view's
 *    `searchableFields` is echoed verbatim by clients as the `$searchFields`
 *    override, and the #4254 ingress gate
 *    (`assertSearchFieldsAreSearchable`, `@objectstack/metadata-protocol`)
 *    refuses any entry outside the object's server-resolved allowed set — so
 *    ONE lookup-typed entry 400s EVERY toolbar search on that list, for every
 *    role, and until #4830 `compile`/`validate` passed it in silence. The
 *    allowed set here is computed by the very function the runtime gate and
 *    the engine consult — {@link resolveSearchFieldResolution}
 *    (`@objectstack/spec/data`) — never by a second copy of its type list, so
 *    linter, gate and engine cannot drift apart (the same one-source move
 *    #4254 made between gate and engine).
 *
 * 3. VIRTUALITY, on EVERY surface — the object's own set included
 *    (`searchable-field-unsearchable`, #6674): a `formula` entry names a real
 *    field, so check 1 passes it, and the runtime's declared branch admitted
 *    it verbatim — but the value is computed on read with no stored column, so
 *    the scan looks at nothing. Measured 0 rows on driver-memory and 0 rows
 *    WITH NO ERROR on driver-sql. Since #6674 the spec resolution drops such
 *    an entry and both enforcement faces refuse it by name.
 *
 * The OBJECT's own `searchableFields` stays existence-only OTHERWISE, and the
 * dividing line is STORAGE, not search quality: the runtime's declared branch
 * filters by existence and scannability, never by type taste, so a json or
 * lookup column declared THERE is a choice the engine executes (a `$contains`
 * over the stored JSON text / the stored foreign key) — narrow, rarely useful,
 * but a scan that CAN match, so it is neither a 400 nor a finding. Flagging
 * those would reject metadata the runtime accepts — the false finding that
 * makes authors stop trusting the linter (ADR-0072 D1). A virtual entry is the
 * opposite case: no column exists on any driver, so admitting it is the
 * fail-open #4254 closed one axis over, surviving on the known-but-virtual
 * axis.
 *
 * Three skips keep false positives near zero (ADR-0072 D1):
 *
 *   1. An object this stack does not define. It may come from another package,
 *      and a field map we cannot see cannot be judged (the same skip the
 *      page/flow/widget rules take).
 *   2. An object that declares no field map at all — external objects and
 *      datasource-introspected schemas whose columns are resolved at runtime.
 *   3. Registry-injected system columns, which exist at runtime but never
 *      appear in authored `fields` — the package-shared `SYSTEM_FIELDS`
 *      (`system-fields.ts`), derived from the spec's own declarations rather
 *      than hand-copied (#4330). The admissibility check also skips them:
 *      their runtime field metadata (type, hidden) is registry-owned and not
 *      visible here, and judging a column we cannot see risks the false
 *      positive this list exists to avoid. (Cost asymmetry: a system column
 *      the runtime would refuse — `created_by` in a view's narrowing — is a
 *      missed finding, not a wrong one.)
 *
 * Skip 3 answers EXISTENCE, and since #8404 it no longer ends the matter. On an
 * ADR-0015 `external` object the platform registers its injected anchors and
 * provisions no storage behind them (#7865 / #8116), so `owner_id` there is
 * addressable and empty on every record. Existence rightly stays silent —
 * PROVENANCE is a second question, asked only of the names skip 3 already
 * decided not to flag, and answered by the per-object index
 * ({@link indexUnprovisionedAnchors}) rather than the object-independent union.
 * A declared anchor survives into the resolved allow-list and the view's
 * `$searchFields` narrowing, so it reads as search coverage and scans a column
 * that can never match — #4830's own failure mode reached by a different route.
 * WARNING, never gating, for #4330's cost asymmetry: the remote schema is not
 * visible to this pass, so the finding describes a degradation, not a refusal
 * (the same call `warnUnprovisionedAnchors` makes in `validate-expressions.ts`
 * and the four filter/binding rules #8340 wired).
 *
 * Dotted paths are NOT skipped here, unlike every sibling rule. Elsewhere
 * `owner_id.name` is left alone because the query engine resolves the traversal;
 * search does not — `resolveSearchFields` matches the field map by exact string,
 * so a dotted entry is dropped exactly like a typo. Skipping it would exempt the
 * one wrong spelling most likely to be borrowed from `select`/`sort`.
 */

import {
  resolveSearchFieldResolution,
  isVirtualSearchField,
  SEARCHABLE_TEXTUAL_TYPES,
  SEARCHABLE_ENUM_TYPES,
  SEARCH_AUTO_EXCLUDED_FIELDS,
  type SearchFieldMeta,
} from '@objectstack/spec/data';
import {
  SYSTEM_FIELDS,
  indexUnprovisionedAnchors,
  unprovisionedAnchorCause,
  unprovisionedAnchorHint,
} from './system-fields.js';

export const SEARCHABLE_FIELD_UNKNOWN = 'searchable-field-unknown';
export const SEARCHABLE_FIELD_UNSEARCHABLE = 'searchable-field-unsearchable';
export const SEARCHABLE_FIELD_UNPROVISIONED = 'searchable-field-unprovisioned';

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

/**
 * Which runtime judgment applies to the declaration being checked:
 *
 * - `'canonical'` — the object's own `searchableFields`. The runtime honors
 *   any entry that exists and has a stored column to scan (existence- and
 *   scannability-filtered, never type-filtered), so existence and virtuality
 *   are checked and nothing else (#6674).
 * - `'narrowing'` — a list view's `searchableFields` (metadata or react
 *   surface). Clients echo it as the `$searchFields` override, which the
 *   #4254 ingress gate intersects with the object's allowed set — entries the
 *   runtime would refuse are flagged (#4830).
 */
export type SearchableFieldRole = 'canonical' | 'narrowing';

type AnyRec = Record<string, unknown>;

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
 * The slice of an object the search checks resolve against: the authored
 * field map (existence + the `type`/`hidden` meta search resolution reads),
 * plus the object's own declarations the runtime's resolution consumes.
 * `null` when the object declares no readable field map (external /
 * introspected — nothing to judge against).
 */
export interface ObjectSearchTarget {
  /** Authored field names, for the existence check. */
  names: Set<string>;
  /** name → the metadata slice `resolveSearchFieldResolution` reads. */
  fields: Record<string, SearchFieldMeta>;
  /** The object's own `searchableFields`, when declared as an array. */
  searchableFields?: string[];
  /** `nameField` / `displayNameField` — ordering only, passed for parity. */
  displayField?: string;
}

/**
 * Read both field-map shapes (name-keyed map, legacy array of `{ name }`) into
 * the target slice, or `null` when the object declares no readable field map.
 */
function declaredFieldTarget(obj: AnyRec): ObjectSearchTarget | null {
  const fields = obj.fields;
  if (!fields || typeof fields !== 'object') return null;
  const names = new Set<string>();
  const metas: Record<string, SearchFieldMeta> = {};
  for (const f of asArray(fields)) {
    const n = strName(f.name);
    if (!n) continue;
    names.add(n);
    metas[n] = {
      type: typeof f.type === 'string' ? f.type : undefined,
      hidden: f.hidden === true,
    };
  }
  if (names.size === 0) return null;
  const searchableFields = Array.isArray(obj.searchableFields)
    ? obj.searchableFields.filter((e): e is string => typeof e === 'string')
    : undefined;
  return {
    names,
    fields: metas,
    searchableFields,
    displayField: strName(obj.nameField) ?? strName(obj.displayNameField),
  };
}

/**
 * The object's ALLOWED search-field set, judged by the SAME function the
 * runtime ingress gate and the engine consult (`resolveSearchFieldResolution`,
 * `@objectstack/spec/data`) — the one-source-of-truth requirement of #4830.
 *
 * One seam papered over deliberately: the runtime resolves the declared branch
 * against the REGISTRY field map (authored + injected system columns), while
 * this rule only sees authored `fields`. A declared entry naming a system
 * column (`searchableFields: ['name', 'created_at']`) must therefore survive
 * the resolution's existence filter exactly as it does at runtime, so such
 * entries get a stub meta ({}). The stub cannot leak into the auto-default:
 * `autoDefaultFields` requires a readable searchable `type`, which a stub
 * never has.
 */
function resolveAllowedSet(target: ObjectSearchTarget): {
  allowed: Set<string>;
  source: 'declared' | 'auto';
  declaredList: string[];
} {
  let fields = target.fields;
  const systemDeclared = (target.searchableFields ?? []).filter(
    (f) => !target.names.has(f) && SYSTEM_FIELDS.has(f),
  );
  if (systemDeclared.length > 0) {
    fields = { ...fields };
    for (const f of systemDeclared) fields[f] = {};
  }
  const { allowed, source } = resolveSearchFieldResolution({
    fields,
    searchableFields: target.searchableFields,
    displayField: target.displayField,
  });
  return { allowed: new Set(allowed), source, declaredList: allowed };
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
 * object name → the search-target slice. `null` marks an object with no
 * readable field map, so "declared nothing" stays distinguishable from "not in
 * stack". Exported alongside `checkSearchableFieldList` so every surface that
 * authors a searchable set resolves against the identical index (#4329).
 */
export function indexObjectSearchTargets(
  stack: Record<string, unknown>,
): Map<string, ObjectSearchTarget | null> {
  const fieldsByObject = new Map<string, ObjectSearchTarget | null>();
  if (!isRec(stack)) return fieldsByObject;
  for (const obj of asArray(stack.objects)) {
    const name = strName(obj.name);
    if (name) fieldsByObject.set(name, declaredFieldTarget(obj));
  }
  return fieldsByObject;
}

/**
 * Check one `searchableFields` array against the target `fieldsByObject`
 * holds for `objectName` — the shared core behind every surface that authors a
 * searchable set: the object/list-view metadata walked by
 * `validateSearchableFields` below, and the react page surface
 * (`<ListView searchableFields={…}>`, `validate-react-page-props`), which
 * reuses it so the two surfaces agree on what counts as a field — same three
 * skips, same dotted-path strictness (#4329), same runtime-admissibility
 * judgment for a view-level narrowing (#4830).
 *
 * `subject` names the declaration for the message, since an object's own set
 * and a view's narrowing of it are fixed differently; the entry index is
 * appended to `path` so the author can go straight to the stale name. `role`
 * picks the runtime judgment to mirror — see {@link SearchableFieldRole};
 * every list-view surface is a `'narrowing'`, which is the default.
 */
export function checkSearchableFieldList(
  declared: unknown,
  objectName: string | undefined,
  fieldsByObject: ReadonlyMap<string, ObjectSearchTarget | null>,
  where: string,
  path: string,
  subject: string,
  role: SearchableFieldRole = 'narrowing',
  // [#8404] `objectName -> its unprovisioned injected anchors`
  // ({@link indexUnprovisionedAnchors}). OPTIONAL, and its absence means
  // exactly one thing: this caller did not build the index, so the provenance
  // question goes unasked and only existence/admissibility are answered — the
  // pre-#8404 behaviour, preserved for out-of-repo callers of this exported
  // core (cloud graph-lint, the AI authoring path). Every in-repo caller passes
  // it: `validateSearchableFields` below and `validate-react-page-props`.
  unprovisionedAnchors?: ReadonlyMap<string, ReadonlySet<string>>,
): SearchableFieldFinding[] {
  const findings: SearchableFieldFinding[] = [];
  if (!Array.isArray(declared) || declared.length === 0) return findings;
  if (!objectName) return findings; // nothing to resolve against
  if (!fieldsByObject.has(objectName)) return findings; // ① object from another package
  const target = fieldsByObject.get(objectName);
  if (!target) return findings; // ② external / introspected — no authored field map

  const known = target.names;
  const anchors = unprovisionedAnchors?.get(objectName);
  const resolution = role === 'narrowing' ? resolveAllowedSet(target) : undefined;

  for (let i = 0; i < declared.length; i++) {
    const entry = declared[i];
    // Pre-parse input may carry junk here; a non-string is a SHAPE error the
    // schema owns, not a dangling reference.
    const name = strName(entry);
    if (!name) continue;

    if (!known.has(name) && !SYSTEM_FIELDS.has(name)) {
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
              `the related object, or copy the value onto a stored text field here. `
            : `Fix the name, or add "${name}" to ${objectName}.fields. `) +
          `Clients echo this declaration verbatim as the '$searchFields' ` +
          `override, so a stale entry becomes a 400 INVALID_FIELD on list ` +
          `search (#4254), not just a quietly narrowed one.` +
          (known.size > 0 ? ` Object fields: ${[...known].sort().join(', ')}.` : ''),
      });
      continue;
    }

    // ── [#8404] Provenance — the second question about a name skip 3 kept ──
    //
    // Existence answered "yes" (authored, or a registry-injected system
    // column). On a federated object the injected anchor is addressable and
    // has no storage, so the entry survives `resolveAllowedSet`'s stub into the
    // resolved allow-list and scans a column empty on every record. Emitted
    // HERE, per declared entry, rather than at the stub: `resolveAllowedSet`
    // reads the OBJECT's declaration and runs once per narrowing, so warning
    // there would repeat one object-level fact for every view and attribute it
    // to the view's path. Deliberately NOT `continue` — the later checks are
    // no-ops for a name absent from authored `fields` (no meta to be virtual,
    // and the admissibility pass skips it at ③), so falling through keeps this
    // warning additive instead of masking a finding about an authored column.
    if (anchors?.has(name)) {
      findings.push({
        severity: 'warning',
        rule: SEARCHABLE_FIELD_UNPROVISIONED,
        where,
        path: `${path}[${i}]`,
        message:
          `${subject} entry "${name}" resolves on object "${objectName}", but ` +
          `${unprovisionedAnchorCause(objectName, name)}` +
          (role === 'narrowing'
            ? ` — clients echo this declaration verbatim as the '$searchFields' override, so ` +
              `every toolbar search on this list scans a column that is empty on every ` +
              `record: it reads as search coverage and matches nothing.`
            : ` — 'search' scans it on every record and it can never match, so the object's ` +
              `searchable set is narrower than it declares. Should it be the ONLY entry that ` +
              `resolves, the set scans nothing at all.`),
        hint: unprovisionedAnchorHint(objectName, name),
      });
    }

    // ── [#6674] Virtual entries — EVERY surface, canonical included ──
    //
    // The one check that is not view-level, because the runtime's declared
    // branch no longer executes it: a `formula` value is computed on read and
    // has no stored column, so the entry can never match wherever it is
    // declared. Judged by the spec's own predicate, so linter and runtime
    // cannot disagree about which types have a column.
    if (isVirtualSearchField(target.fields[name])) {
      const vtype = target.fields[name]?.type;
      findings.push({
        severity: 'error',
        rule: SEARCHABLE_FIELD_UNSEARCHABLE,
        where,
        path: `${path}[${i}]`,
        message:
          `${subject} entry "${name}" on object "${objectName}" is a virtual ` +
          `'${vtype}' field: its value is computed on read and never stored, so no ` +
          `driver materializes a column for 'search' to scan and the entry can never ` +
          `match. It reads as search coverage and delivers none — the runtime used to ` +
          `admit it verbatim because the declaration named it (#6674).`,
        hint:
          `Mirror the computed value onto a stored text field on "${objectName}" and ` +
          `declare that instead, or drop "${name}". At runtime the ingress gate now ` +
          `refuses this entry with 400 INVALID_FIELD, the same answer a stale entry ` +
          `gets (#4254).`,
      });
      continue;
    }

    // ── Runtime admissibility (#4830) — view-level narrowings only ──
    if (!resolution || resolution.allowed.has(name)) continue;
    // ③ System column outside the allowed set: its runtime metadata is
    // registry-owned and invisible here — skip rather than risk the false
    // positive (module note).
    if (!known.has(name)) continue;
    const meta = target.fields[name];

    if (resolution.source === 'declared') {
      findings.push({
        severity: 'error',
        rule: SEARCHABLE_FIELD_UNSEARCHABLE,
        where,
        path: `${path}[${i}]`,
        message:
          `${subject} entry "${name}" is outside object "${objectName}"'s declared ` +
          `searchableFields (${resolution.declaredList.join(', ')}) — the set 'search' ` +
          `scans. Clients echo this declaration verbatim as the '$searchFields' ` +
          `override, and the runtime refuses an entry outside the allowed set: every ` +
          `toolbar search on this list returns 400 INVALID_FIELD (#4254).`,
        hint:
          `Add "${name}" to ${objectName}.searchableFields, or drop it from this ` +
          `view — a view narrows the object's searchable set, never widens it ` +
          `(ADR-0061).`,
      });
      continue;
    }

    // Auto-default source. Mirror the gate's own "why" — excluded name, then
    // hidden, then type; an unreadable type is unresolvable, not wrong.
    const isReference = meta?.type === 'lookup' || meta?.type === 'master_detail';
    let why: string;
    if (SEARCH_AUTO_EXCLUDED_FIELDS.has(name)) {
      why = 'a system/audit column, which the auto-default set never includes';
    } else if (meta?.hidden) {
      why = 'hidden';
    } else if (typeof meta?.type === 'string') {
      why = `of type '${meta.type}', which 'search' cannot scan`;
    } else {
      continue; // no readable type — unresolvable, not wrong (ADR-0072 D1)
    }
    findings.push({
      severity: 'error',
      rule: SEARCHABLE_FIELD_UNSEARCHABLE,
      where,
      path: `${path}[${i}]`,
      message:
        `${subject} entry "${name}" on object "${objectName}" is ${why}. With no ` +
        `'searchableFields' declared on the object, 'search' scans its text-like ` +
        `columns (${[...SEARCHABLE_TEXTUAL_TYPES, ...SEARCHABLE_ENUM_TYPES].join(' / ')}). ` +
        `Clients echo this declaration verbatim as the '$searchFields' override, and ` +
        `the runtime refuses it: every toolbar search on this list returns ` +
        `400 INVALID_FIELD (#4254).`,
      hint:
        (isReference
          ? `A ${meta?.type} column stores only the referenced record's id, so it ` +
            `cannot be a keyword target — drop "${name}" from this view and, to ` +
            `search by the related record's title, mirror it onto a stored text ` +
            `field here and declare that instead. `
          : `Drop "${name}" from this view, or target a text-like field instead. `) +
        `Declaring 'searchableFields' on object "${objectName}" chooses the ` +
        `searchable set explicitly.`,
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
  const unprovisionedAnchors = indexUnprovisionedAnchors(stack);

  const check = (
    declared: unknown,
    objectName: string | undefined,
    where: string,
    path: string,
    subject: string,
    role: SearchableFieldRole,
  ) => {
    findings.push(
      ...checkSearchableFieldList(
        declared,
        objectName,
        fieldsByObject,
        where,
        path,
        subject,
        role,
        unprovisionedAnchors,
      ),
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
      'canonical',
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
          'narrowing',
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
        'narrowing',
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
          'narrowing',
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
