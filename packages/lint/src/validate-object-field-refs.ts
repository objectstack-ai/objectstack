// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15254 — object-level field-name list reference integrity] Every field name
 * an OBJECT names in one of its own field-name LISTS — `highlightFields`,
 * `publicSharing.redactFields`, `indexes[].fields` — and every field name one
 * of its FIELDS names in a field-level list (`relatedListColumns`,
 * `lookupColumns`, `lookupFilters[].field`, `dependsOn`, #20432) must name a
 * field the object that list addresses actually has.
 *
 * ## The state this rule ends, measured on `origin/main` (f01adfa5c)
 *
 * The sibling `validate-list-view-field-refs.ts` answers the same question for
 * a LIST VIEW, and between them the two siblings that predate it
 * (`validate-searchable-fields`, `validate-sortable-fields`) cover a list
 * view's remaining field axes. Nothing answered it for the object's OWN
 * pointers, at the tier that refuses:
 *
 * ```
 * highlightFields[i]            warning/semantic-role-field-unknown   (advisory, cli-only)
 * publicSharing.redactFields[i] nothing
 * ```
 *
 * The gap is not that the miss went unreported — for `highlightFields` it was
 * reported, as an ADVISORY on the CLI alone. It is that no surface REFUSED it,
 * and one surface never saw it at all. Both halves were measured:
 *
 *  - `os validate` / `os build` / `os lint` reported
 *    `semantic-role-field-unknown` at `warning`, so the command exits 0 and
 *    the stack is declared valid. An author who reads the verdict rather than
 *    the warning list ships the dangling pointer.
 *  - The RUNTIME publish door reported nothing whatsoever.
 *    `runtimeAuthoringRulesFor('object')` dispatched seven rules and the
 *    reference-integrity suite was not among them (its entry declares
 *    `runtimeTypes: ['flow', 'view']`), while `validateSemanticRoles` is held
 *    off that door entirely by the #4716 advisory-volume fence. So the only
 *    door a Studio tenant, a REST `/meta` author or an MCP/AI author has ran
 *    NO reference-integrity rule at all on an object write.
 *
 * ## Why the click path produces this, in the natural order
 *
 * Studio's app builder mints no `view` items, so every rule in the list-view
 * half of this family has nothing to inspect on the artifacts Studio actually
 * authors. What it DOES author is the object, and the object's
 * `highlightFields`. The reproduction is not contrived: place a field (it is
 * minted as `field_10`), add it to `highlightFields`, then give it a label —
 * the API name auto-derives to `health_score` and `highlightFields` keeps
 * `field_10`. Naming a field after placing it is the natural order, so any
 * author who does it produces a dangling reference, and the publish accepted
 * it (`outcome: 'published'`, `failedCount: 0`).
 *
 * ## Severity: `error`, and why this family's two-tier rule lands here
 *
 * The list-view sibling grades per position, on whether the miss is REFUSED
 * downstream or merely renders wrong. Neither test is the one that decides
 * this rule, because an object-level list is consumed by renderers that all
 * degrade quietly — nothing 400s, and that is precisely the complaint. The
 * deciding property is the one ADR-0078 names: the reference is PARSED,
 * UNMARKED and SILENTLY INERT, on the authoring surface AI authors and humans
 * share, and the platform's own asymmetry (a code author is warned, a click
 * author is not told at all) is what makes it a defect rather than a hint.
 * Warning is the tier that produced the measured state above; it is not
 * enough for this judgement, so both surfaces gate.
 *
 * The positions #20432 added take the same tier on the same argument. Some of
 * their misses can reach a refusal downstream — the data route judges a filter
 * key against the object's field map — but only when a USER opens the view or
 * the picker, which is a refusal the author never sees; a misspelt `dependsOn`
 * gates its field for good, and the index miss is the silent kind outright. The bar they fall short of is the one the #19332
 * ruling states for this family: a misspelling is refused loudly at authoring.
 *
 * ## What this rule owns, and what it deliberately does NOT
 *
 * It owns the object-level keys whose value is a LIST of names of fields on
 * THAT object, and that no other rule already resolves:
 *
 *  - **`highlightFields[]`** (ADR-0085, `packages/spec/src/data/object.zod.ts`
 *    line 2092) — drives default list columns, cards, previews and the detail
 *    highlight strip. A dangling entry is dropped by every consumer.
 *  - **`publicSharing.redactFields[]`** (`object.zod.ts` line 2258) — the
 *    field names stripped from records served through a share link. This one
 *    fails OPEN, which the schema's own `history` note says in as many words:
 *    a redaction the author wrote and mis-spelled does not redact, and the
 *    field is served to whoever holds the link. Same shape, worse consequence.
 *  - **`indexes[].fields[]`** (`IndexSchema`, `object.zod.ts`) — the columns
 *    of a declared index. A misspelt column makes
 *    `SqlDriver.syncDeclaredIndexes` skip the WHOLE index at `warn`, and
 *    `expectedIndexes` drops it from drift, so `os migrate plan` never shows
 *    it; for a `unique` index the declared constraint is silently unenforced
 *    while the system looks normal — the AGENTS.md durability-degradation
 *    shape (#20432).
 *
 * …and, since #20432, the FIELD-level lists — the keys on one field whose
 * value names other fields. Each is a bare `z.string()` in `FieldSchema`
 * (`packages/spec/src/data/field.zod.ts`), so the parse cannot judge one, and
 * no other authoring door read them for existence: a misspelling surfaced only
 * when a user opened the view or the picker, or never.
 *
 *  - **`relatedListColumns[]`** — the columns of the related list the parent's
 *    detail page derives from this relationship.
 *  - **`lookupColumns[]`** (both arms: a name, or `{ field }`) — the columns
 *    of this field's record picker.
 *  - **`lookupFilters[].field`** — the picker's base filter.
 *  - **`dependsOn[]`** (both arms: a name, or `{ field, param }`) — the fields
 *    whose values gate this field and, on a picker, scope its candidates.
 *
 * ## Which object a field-level name addresses — measured on each reader
 *
 * Not always the object that owns the field, and a rule that assumed so would
 * refuse correct metadata and pass broken metadata in equal measure. Read at
 * the objectui pin (`.objectui-sha` `dd3f7e1b`):
 *
 * ```
 * relatedListColumns[i]      OWNER      deriveRelatedLists.ts — the related list
 *                                       lists the CHILD's rows, and the child is
 *                                       the object that owns the FK field
 * lookupColumns[i] / .field  REFERENCE  LookupField.tsx — picker columns over
 *                                       the referenced object's records
 * lookupFilters[i].field     REFERENCE  LookupField.tsx `lookupFiltersToRecord`
 *                                       → the query on `referenceTo`
 *                                       (`validate-preset-comparands.ts` binds
 *                                       the same key the same way, #19791)
 * dependsOn[i] / .field      OWNER      LookupField.tsx — the gate reads the
 *                                       host's record by this key
 * dependsOn[i] / .param      REFERENCE  LookupField.tsx `dependentFilter` — the
 *                                       candidate filter key; a bare name is
 *                                       BOTH (`param` defaults to `field`)
 * ```
 *
 * REFERENCE is the field's target as `referenceTargetOf` answers it (the
 * graph's `GraphField.reference`), judged only on the three types that render
 * that picker — `lookup` and `master_detail` (`FieldEditWidget.tsx`) and
 * `user`, whose `UserField` delegates to it with `sys_user` fixed. On any
 * other type the REFERENCE positions have no reader and stay unjudged.
 *
 * `lookupColumns`, `dependsOn` and `indexes[].fields` are read VERBATIM by
 * their readers — a picker column key, a record key, a physical column — so
 * a dotted name there addresses nothing and is judged as one name, never
 * walked as a relationship path. `relatedListColumns` and
 * `lookupFilters[].field` keep the family's path resolution.
 *
 * On `dependsOn`, a bare name that misses on the owner is reported once,
 * there; the same name is not reported a second time against the referenced
 * object, since one fix answers both.
 *
 * NOT owned, each with the reason its schema gives:
 *
 *  - **`searchableFields[]`** — `validate-searchable-fields.ts` owns it, at
 *    `error`, with a runtime-admissibility verdict on top of existence.
 *    Re-measured on this base: a dangling entry already reports
 *    `searchable-field-unknown`.
 *  - **`listViews.*`** — the three list-view members of this suite own every
 *    field-naming position inside a built-in list view. Re-measured: a
 *    dangling `listViews.all.columns` entry already reports
 *    `list-view-field-unknown`.
 *  - **`stageField` / `nameField` / `displayNameField`** — SCALAR pointers,
 *    not lists, and the first is `validateSemanticRoles`' at `warning` while
 *    the title pair is `validateRecordTitle`'s axis. Promoting a scalar role
 *    pointer to `error` is the same judgement one key over, but it is a
 *    separate decision with its own blast radius and it is left to one.
 *  - **Whether an index column is MATERIALIZED** — a name that resolves to a
 *    virtual field (a `formula`) is judged here as existing, and the driver
 *    still skips the index at sync. `indexes[].fields[]` used to sit in this
 *    list whole, as a storage question for the registration path answered
 *    against the physical column set. That left a MISSPELLING with no door at
 *    all: the sync's skip is a `warn` and drift drops the index, so nothing
 *    anywhere refused a name that is not a field. Existence is therefore
 *    judged here, against the authored field map plus the injected columns —
 *    exactly the physical set a correct name can land in — and only the
 *    materialization question stays with the sync (#20432 step 2, the
 *    driver's half).
 *  - **`tenancy.tenantField` / `tenancy.organizationField` /
 *    `lifecycle.ttl.field` / `activityMilestones[].field`** — scalars, and
 *    the first three habitually name REGISTRY-INJECTED columns
 *    (`organization_id`, `created_at`), which is the #5378 false-finding trap;
 *    they are judgeable, but each needs its own injected-column measurement.
 *  - **`external.columnMap` / `external.ignoreColumns` / `systemFields`** —
 *    by their schema these are REMOTE column names and system-column registry
 *    names, not names in this object's own field map. Out by definition, not
 *    by deferral.
 *  - **`titleFormat`** — a template expression, owned by the expression rules.
 *
 * ## The retired `compactLayout` alias
 *
 * `compactLayout` was renamed to `highlightFields` in `@objectstack/spec`
 * 11.7.0 (ADR-0085) and the `object-compactLayout-to-highlightFields`
 * conversion normalizes it before a parsed stack reaches any rule, so on the
 * parsed tier this alias cannot appear. It is read here anyway, at the same
 * position, for one reason and not as a tolerance: the clause this rule takes
 * over from `validateSemanticRoles` read it, and the `lint` path carries raw
 * config that has not been through the conversion. Dropping the read would be
 * a silent coverage regression on that path, which is the failure mode this
 * whole family exists to end. It is NOT an accepted spelling — the parse
 * refuses it — and nothing else in this file widens to an alias.
 *
 * ## Skips — the same three every field-existence rule in this package takes
 *
 * Resolution is {@link resolveFieldPath}'s and its `unknowable` verdicts are
 * never reported (ADR-0072 D1): an object this stack does not define, an
 * object that declares no readable field map (ADR-0015 `external`,
 * datasource-introspected schemas), and a registry-injected system column —
 * the last resolved per object, so `highlightFields: ['owner_id']` is a live
 * pointer on an owned object and a real miss under `ownership: 'none'`
 * (#5378).
 */

import {
  describeFieldPathVerdict,
  indexObjectGraph,
  isUnjudgeable,
  recordsOf,
  resolveFieldPath,
  type FieldPathVerdict,
  type ObjectGraph,
} from './object-graph.js';

/**
 * A field-name list entry — object-level, or on one of the object's fields —
 * that resolves to no field on the object the list addresses.
 */
export const OBJECT_FIELD_REF_UNKNOWN = 'object-field-ref-unknown';

export type ObjectFieldRefSeverity = 'error' | 'warning';

export interface ObjectFieldRefFinding {
  /** Always `error` — see the severity note on this module. */
  severity: ObjectFieldRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /**
   * Human-readable location, e.g. `object "proj_task" › highlightFields` or
   * `object "invoice" › fields.account.lookupColumns`.
   */
  where: string;
  /**
   * Config path, e.g. `objects[0].highlightFields[1]`,
   * `objects[0].indexes[0].fields[1]` or
   * `objects[0].fields.account.lookupColumns[1].field`.
   */
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

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/**
 * The object-level field-name LIST positions, as
 * `[block, key]` where `''` is the object's own top level.
 *
 * Declarative for the same reason the list-view sibling's table is: the
 * failure this family exists to end is a position nobody remembered to walk,
 * and a table can be read against `ObjectSchema` key by key. `consequence` is
 * the sentence the author reads after the miss — what actually happens when
 * the reference resolves to nothing — and it differs per position, which is
 * why it is data here rather than one shared string.
 */
interface ListPosition {
  /** `''` = the object's own top level, else the nested block that holds `key`. */
  block: string;
  /** The key whose value is the array of field names. */
  key: string;
  /**
   * Also read this retired spelling at the same position. See the
   * `compactLayout` note on this module — coverage preservation on the raw
   * `lint` path, never an accepted spelling.
   */
  retiredAlias?: string;
  /** What the platform does with an entry that resolves to nothing. */
  consequence: string;
  /** The prescription half of the hint. */
  prescription: string;
}

const LIST_POSITIONS: readonly ListPosition[] = [
  {
    block: '',
    key: 'highlightFields',
    retiredAlias: 'compactLayout',
    consequence:
      'Every consumer silently skips the entry: it drives the object\'s default list columns, '
      + 'record cards, previews and the detail highlight strip, and each of them renders one '
      + 'field short with no error anywhere.',
    prescription:
      'Fix the field name, or drop the entry. `highlightFields` is ordered — the first entry '
      + 'wins where only one field fits (ADR-0085).',
  },
  {
    block: 'publicSharing',
    key: 'redactFields',
    consequence:
      'The redaction never applies, and it fails OPEN: records served through a share link '
      + 'still carry the field to whoever holds the link. A mis-spelled entry is silently '
      + 'indistinguishable from an entry that was never written.',
    prescription:
      'Fix the field name so the redaction binds, or drop the entry if the field is meant to '
      + 'be served through share links.',
  },
];

/**
 * `indexes[i].fields[j]` — a position of its own rather than a
 * {@link ListPosition} row: the list sits one collection deeper (each entry of
 * `indexes` carries one), and its reader takes every name VERBATIM as a
 * physical column. See the module note for what is judged here and what the
 * sync keeps.
 */
const INDEX_POSITION = {
  consequence:
    'The SQL driver skips the WHOLE index at sync with only a warning, and drift drops it too, '
    + 'so `os migrate plan` never reports it: a `unique` index is then silently unenforced '
    + 'while everything looks normal.',
  prescription:
    'Fix the column name. An index column is a field of this object, or a column the platform '
    + 'injects on it (`created_at`, `organization_id`, …), spelled exactly — never a dotted path.',
} as const;

/**
 * Which object's field map judges a field-level name: the object that OWNS
 * the field, or the object the field REFERENCES. Decided per key on the key's
 * runtime reader — the module note's table is the measurement.
 */
type NameAddress = 'owner' | 'reference';

/**
 * The field types whose editor is the record picker that reads the
 * REFERENCE-addressed keys (`lookupColumns`, `lookupFilters`, the filter half
 * of `dependsOn`): `lookup` and `master_detail` render `LookupField`, and
 * `user` renders `UserField`, which delegates to it with `sys_user` fixed. On
 * any other type those keys have no reader, so they are not judged.
 */
const PICKER_FIELD_TYPES: ReadonlySet<string> = new Set(['lookup', 'master_detail', 'user']);

/** One name read out of one list entry, and where it sits inside the entry. */
interface SlotRead {
  name: string;
  /** Path suffix after `key[i]` — `''` for a bare-name entry, `.field` / `.param` for a member. */
  suffix: string;
}

/**
 * One field-level NAME SLOT: a key on a field, the object its names address,
 * and how a name is read out of each entry. Declarative for the reason
 * {@link LIST_POSITIONS} is — the table can be read against `FieldSchema` key
 * by key, and against each key's reader row by row.
 */
interface FieldNameSlot {
  /** The field key whose value is the list. */
  key: string;
  /** Which object's field map judges the name. */
  address: NameAddress;
  /**
   * `true` when the reader takes the name VERBATIM — a picker column key, a
   * record key — so a dotted name is one name that names no field, never a
   * relationship path. `false` keeps the family's path resolution.
   */
  verbatim: boolean;
  /** Read this slot's name out of one entry, or `undefined` when it holds none. */
  read: (entry: unknown) => SlotRead | undefined;
  /** What the platform does with a name that resolves to nothing. */
  consequence: string;
  /** The prescription half of the hint. */
  prescription: string;
}

function nameOf(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** A bare-name entry (`'status'`). */
function readString(entry: unknown): SlotRead | undefined {
  const name = nameOf(entry);
  return name ? { name, suffix: '' } : undefined;
}

/** A named member of an object entry (`{ field: 'status' }`). */
function readMember(entry: unknown, member: string): SlotRead | undefined {
  const name = isRec(entry) ? nameOf(entry[member]) : undefined;
  return name ? { name, suffix: `.${member}` } : undefined;
}

const FIELD_NAME_SLOTS: readonly FieldNameSlot[] = [
  {
    key: 'relatedListColumns',
    address: 'owner',
    verbatim: false,
    read: readString,
    consequence:
      'The related list the parent\'s detail page derives from this relationship asks the child '
      + 'object for a column it does not have, and the miss surfaces only when that page opens.',
    prescription:
      'Fix the column name — a related-list column is a field of the object that declares this '
      + 'relationship (the child whose rows the list shows) — or drop the entry and let the '
      + 'columns derive.',
  },
  {
    key: 'lookupColumns',
    address: 'reference',
    verbatim: true,
    read: (entry) => readString(entry) ?? readMember(entry, 'field'),
    consequence:
      'The record picker renders that column empty for every candidate: a picker column is read '
      + 'off each record of the referenced object, and nothing reports the miss.',
    prescription:
      'Fix the column name — a picker column is a field of the referenced object, not of the '
      + 'object that owns this field — or drop the entry and let the columns derive.',
  },
  {
    key: 'lookupFilters',
    address: 'reference',
    verbatim: false,
    read: (entry) => readMember(entry, 'field'),
    consequence:
      'The picker applies this filter to its query on the referenced object, which names a field '
      + 'that object does not have; the miss surfaces only when a user opens the picker.',
    prescription:
      'Fix `field` — a picker filter runs on the referenced object, so it names a field of that '
      + 'object, not of the object that owns this field.',
  },
  {
    key: 'dependsOn',
    address: 'owner',
    verbatim: true,
    read: (entry) => readString(entry) ?? readMember(entry, 'field'),
    consequence:
      'The form gates this field until that field has a value, and a field the record does not '
      + 'have never gets one: this field stays gated for good.',
    prescription:
      'Fix the name — `dependsOn` names fields on the same record, i.e. of the object that owns '
      + 'this field — or drop the entry.',
  },
  {
    // The filter half of the same entry. A bare name is the key on BOTH sides;
    // `{ field, param }` names the referenced object's key in `param`, and
    // without one `param` defaults to `field` (LookupField's own mapping).
    key: 'dependsOn',
    address: 'reference',
    verbatim: true,
    read: (entry) => readString(entry) ?? readMember(entry, 'param') ?? readMember(entry, 'field'),
    consequence:
      'The picker scopes its candidates by this key on the referenced object — a bare name is '
      + 'the key on both sides — and that object has no such field; the miss surfaces only when '
      + 'a user opens the picker.',
    prescription:
      'When the two sides are spelled differently, write the entry as '
      + '`{ field: \'this_record_field\', param: \'referenced_object_field\' }`; otherwise fix '
      + 'the name.',
  },
];

/**
 * {@link resolveFieldPath}, or — at a position whose reader takes the name
 * verbatim — the one-name verdict: a dotted name there is not a path to walk,
 * it is a name no field carries.
 */
function resolveName(
  graph: ObjectGraph,
  objectName: string,
  name: string,
  verbatim: boolean,
): FieldPathVerdict | undefined {
  if (!verbatim || !name.includes('.')) return resolveFieldPath(graph, objectName, name);
  if (!graph.has(objectName)) return { kind: 'unknowable', reason: 'object-not-in-stack', object: objectName };
  const obj = graph.get(objectName);
  if (!obj) return { kind: 'unknowable', reason: 'no-field-map', object: objectName };
  return { kind: 'field-unknown', object: objectName, field: name, candidates: obj.names };
}

/**
 * Validate every object's own field-name lists, and its fields' field-level
 * lists, against the object graph. Returns findings (empty = clean). Pure
 * `(stack) => Finding[]`; no I/O, and safe on both the schema-parsed stack and
 * the raw config the `lint` path carries.
 */
export function validateObjectFieldRefs(stack: AnyRec): ObjectFieldRefFinding[] {
  const findings: ObjectFieldRefFinding[] = [];
  if (!isRec(stack)) return findings;

  const graph: ObjectGraph = indexObjectGraph(stack);
  if (graph.size === 0) return findings;

  /**
   * Resolve one name and push the finding when it misses. `true` = reported.
   * Every position funnels through here, so the message shape — the verdict's
   * account, then the position's consequence; the prescription, then the
   * addressed object's field list — is one shape across the family.
   */
  const judge = (at: {
    against: string;
    name: string;
    verbatim: boolean;
    subject: string;
    where: string;
    path: string;
    consequence: string;
    prescription: string;
  }): boolean => {
    const verdict = resolveName(graph, at.against, at.name, at.verbatim);
    if (isUnjudgeable(verdict) || !verdict) return false;
    const account = describeFieldPathVerdict(verdict, at.name, at.subject);
    if (!account) return false; // the name resolves — nothing to say
    findings.push({
      severity: 'error',
      rule: OBJECT_FIELD_REF_UNKNOWN,
      where: at.where,
      path: at.path,
      message: `${account.message} ${at.consequence}`,
      hint: `${at.prescription} ${account.detail}`,
    });
    return true;
  };

  const objects = asArray(stack.objects);
  for (let oi = 0; oi < objects.length; oi++) {
    const obj = objects[oi];
    if (!isRec(obj)) continue;
    const objName = typeof obj.name === 'string' && obj.name.length > 0 ? obj.name : undefined;
    if (!objName) continue;

    // ── Skips 1 & 2, once for the whole object ──
    // An object with no entry, or a null entry (no readable field map), is
    // `resolveFieldPath`'s `unknowable` — asking per entry would report the
    // same non-answer once per list member.
    const owner = graph.get(objName);
    if (!owner) continue;

    const label = `object "${objName}"`;
    const objPath = `objects[${oi}]`;

    for (const position of LIST_POSITIONS) {
      const host = position.block === '' ? obj : obj[position.block];
      if (!isRec(host)) continue;
      const hostPath = position.block === '' ? objPath : `${objPath}.${position.block}`;

      // The canonical key, else the retired alias at the same position.
      const written = Array.isArray(host[position.key])
        ? position.key
        : (position.retiredAlias && Array.isArray(host[position.retiredAlias]))
          ? position.retiredAlias
          : undefined;
      if (!written) continue;
      const list = host[written] as unknown[];

      list.forEach((entry, i) => {
        if (typeof entry !== 'string' || entry.length === 0) return;
        judge({
          against: objName,
          name: entry,
          verbatim: false,
          subject: `${written}[${i}]`,
          where: `${label} › ${written}`,
          path: `${hostPath}.${written}[${i}]`,
          consequence: position.consequence,
          prescription: position.prescription,
        });
      });
    }

    // ── indexes[i].fields[j] — verbatim physical column names ──
    const indexes = Array.isArray(obj.indexes) ? obj.indexes : [];
    indexes.forEach((index, xi) => {
      if (!isRec(index) || !Array.isArray(index.fields)) return;
      index.fields.forEach((entry, j) => {
        const name = nameOf(entry);
        if (!name) return;
        judge({
          against: objName,
          name,
          verbatim: true,
          subject: `indexes[${xi}].fields[${j}]`,
          where: `${label} › indexes[${xi}].fields`,
          path: `${objPath}.indexes[${xi}].fields[${j}]`,
          consequence: INDEX_POSITION.consequence,
          prescription: INDEX_POSITION.prescription,
        });
      });
    });

    // ── fields.<f>.<key>[i] — the field-level lists ──
    for (const field of recordsOf(obj.fields)) {
      const fieldName = nameOf(field.name);
      if (!fieldName) continue;
      const meta = owner.fields.get(fieldName);
      const target = meta?.type && PICKER_FIELD_TYPES.has(meta.type) ? meta.reference : undefined;

      // A name already reported at an entry is not reported a second time
      // against the other object (the `dependsOn` pair): one fix answers both.
      const reported = new Set<string>();

      for (const slot of FIELD_NAME_SLOTS) {
        const list = field[slot.key];
        if (!Array.isArray(list)) continue;
        const against = slot.address === 'owner' ? objName : target;
        if (!against) continue;

        list.forEach((entry, i) => {
          const read = slot.read(entry);
          if (!read) return;
          const at = `${slot.key}[${i}]`;
          if (reported.has(`${at}=${read.name}`)) return;
          const hit = judge({
            against,
            name: read.name,
            verbatim: slot.verbatim,
            subject: `fields.${fieldName}.${at}${read.suffix}`,
            where: `${label} › fields.${fieldName}.${slot.key}`,
            path: `${objPath}.fields.${fieldName}.${at}${read.suffix}`,
            consequence: slot.consequence,
            prescription: slot.prescription,
          });
          if (hit) reported.add(`${at}=${read.name}`);
        });
      }
    }
  }

  return findings;
}
