// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15254 — object-level field-name list reference integrity] Every field name
 * an OBJECT names in one of its own field-name LISTS — `highlightFields`
 * today — must name a field that object actually has.
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
 *  - **`indexes[].fields[]`** — a list of names, but the question there is a
 *    STORAGE one (does the driver create the index?), owned by the index
 *    registration path, and it is answered against the physical column set
 *    rather than the authored field map.
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
  resolveFieldPath,
  type ObjectGraph,
} from './object-graph.js';

/** An object-level field-name list entry that resolves to no field on the object. */
export const OBJECT_FIELD_REF_UNKNOWN = 'object-field-ref-unknown';

export type ObjectFieldRefSeverity = 'error' | 'warning';

export interface ObjectFieldRefFinding {
  /** Always `error` — see the severity note on this module. */
  severity: ObjectFieldRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `object "proj_task" › highlightFields`. */
  where: string;
  /** Config path, e.g. `objects[0].highlightFields[1]`. */
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
 * Validate every object's own field-name lists against the object graph.
 * Returns findings (empty = clean). Pure `(stack) => Finding[]`; no I/O, and
 * safe on both the schema-parsed stack and the raw config the `lint` path
 * carries.
 */
export function validateObjectFieldRefs(stack: AnyRec): ObjectFieldRefFinding[] {
  const findings: ObjectFieldRefFinding[] = [];
  if (!isRec(stack)) return findings;

  const graph: ObjectGraph = indexObjectGraph(stack);
  if (graph.size === 0) return findings;

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
    if (!graph.has(objName) || !graph.get(objName)) continue;

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
        const verdict = resolveFieldPath(graph, objName, entry);
        if (isUnjudgeable(verdict) || !verdict) return;
        const subject = `${written}[${i}]`;
        const account = describeFieldPathVerdict(verdict, entry, subject);
        if (!account) return; // the name resolves — nothing to say

        findings.push({
          severity: 'error',
          rule: OBJECT_FIELD_REF_UNKNOWN,
          where: `${label} › ${written}`,
          path: `${hostPath}.${written}[${i}]`,
          message: `${account.message} ${position.consequence}`,
          hint: `${position.prescription} ${account.detail}`,
        });
      });
    }
  }

  return findings;
}
