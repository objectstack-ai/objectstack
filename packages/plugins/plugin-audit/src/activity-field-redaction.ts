// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21081] sys_activity FIELD redaction: an activity row serves a parent field's
 * value only to a reader the security service answers may be served that field
 * unmasked.
 *
 * ## The defect this closes
 *
 * The CRUD mirror (`audit-writers.ts`) composes each activity row ONCE, at
 * write time, as the system. Three of its columns carry parent field values:
 *
 *  - `summary` — a tracked-change diff ("Label: from → to"), a fired
 *    milestone's `{token}`s, or the record label inside the verb template;
 *  - `record_label` — the value of the record's label field;
 *  - `metadata` — `{ old, new }`: the created/deleted snapshot or the diff.
 *
 * The read gate (`activity-read-visibility.ts`) keeps a row for every reader
 * who can read the parent RECORD, so a reader who may not read one of its
 * FIELDS — served it masked, gated off by `requiredPermissions`, or not granted
 * it by any set they hold — was served that field's stored value through the
 * row's text. The data plane answers the same reader masked or without the key.
 *
 * ## Why at READ time, through the security service
 *
 * The writer cannot know the reader, and two of the three classes are not even
 * visible to it: a permission set withholding a field is runtime state. So the
 * full row stays at rest (the activity stream is still a record of what
 * changed) and the redaction is keyed on the reading caller — the shape the
 * approval payload snapshot took for the same class
 * (`plugin-approvals/src/payload-redaction.ts`, #10749 / #20964).
 *
 * The fields a reader is served unmasked are NOT derived here: they are the
 * security contract's read projection intersected with its query-side answer
 * ({@link resolveServedFields}), whose difference the contract defines as
 * exactly the fields this caller is served masked. ⛔ No second derivation of
 * the masking rule lives in this package.
 *
 * ## What is redacted, and how
 *
 *  - `metadata.old` / `metadata.new`: every key the reader is not served is
 *    DROPPED, key by key — the approval snapshot's shape.
 *  - [#36290] `metadata.summary_message` of a field-change summary: every
 *    change of a field the reader is not served is DROPPED, change by change,
 *    by the same answer, and a reference field's change by the reference rule
 *    below; the summary is then re-composed from the changes kept instead of
 *    being dropped whole, so a reader reads the lines of the fields they may
 *    read and never a value of one they may not.
 *  - `summary` / `record_label`: a text cannot be split back into fields, so
 *    each one is served whole or DROPPED whole. The writer declares, in the
 *    row's own `metadata`, which parent fields each was composed from
 *    ({@link ACTIVITY_TEXT_SOURCES_KEY}); a text composed from a field the
 *    reader is not served is dropped, and one composed only from served fields
 *    is kept. Dropped, not masked, for the precedent's reasons: the contract
 *    publishes WHICH fields are masked, not the masked value, and dropping
 *    discloses strictly less.
 *  - `metadata.kind` ({@link ACTIVITY_KIND_KEY}, ADR-0052 §5): on a row the
 *    mirror wrote, the kind is DERIVED from parent fields, so it is judged like
 *    a text. The mirror stamps `'milestone'` when a declared `activityMilestones`
 *    entry fired, which is the fact that a watched field entered its declared
 *    value; the declaration names the watched fields, and a reader not served
 *    one of them is served the row without the kind. A reader served them keeps
 *    it: it is a classification, and every key of it is one the reader may
 *    read anyway. A kind on a row someone else wrote is the author's, served as
 *    written, like its text. [#22786] On a read through the middleware such a
 *    milestone row does not reach that reader at all (see below); dropping the
 *    kind is the column half of the same answer.
 *  - The declaration itself is bookkeeping and is never served to a reader: it
 *    names fields, and which field names a reader may see is the metadata
 *    plane's question, not this one's.
 *
 * ## A text composed from a reference carries the referenced record's title
 *
 * The mirror names a referenced record by its TITLE: the record label of an
 * object titled by a reference field, a tracked reference's change, a fired
 * milestone's reference token. That title is a field of ANOTHER object, so the
 * parent's served fields do not answer for it. A text whose declared sources
 * name a reference field is served only to a reader served the title field of
 * the object it points at and admitted to that object, the two answers
 * `$expand` judges a target's title by at that level
 * ({@link referenceTitlesPerRead}):
 *
 *  - the reader is served the target's title field unmasked — its ADR-0079
 *    `resolveDisplayField` answer, the field the mirror reads a title from —
 *    by the same {@link resolveServedFields} answer, which also withholds a
 *    formula title computed from a field the reader may not read;
 *  - and the security service admits the reader to the target object
 *    (`canReadObject`), unless the reference field declares
 *    `referenceNameVisible`: that key lifts the object-level refusal and never
 *    the field-level rule, as on `$expand`.
 *
 * Otherwise the text is dropped whole, like any text this reader is not served,
 * and the row's `record_id` is the bare id it is named by. A text whose
 * provenance is unknown keeps the rule of rows without a declaration, below. No
 * row is read: the answers are asked once per target object per read.
 *
 * The target's declared API exposure (ADR-0049) is decided where the title is
 * READ: the mirror reads a title only from a target whose exposure serves
 * `get` (`servesSummaryTitleTarget`, `audit-writers.ts`) and names every other
 * referenced record by its stored id, per id, so one text can title one
 * reference and name another by its id. A row is a snapshot of that write, and
 * this redaction judges its reader against every reference a text names by
 * the two answers above, whatever the target's exposure.
 *
 * ## Rows without a declaration
 *
 *  - A row in the mirror's EARLIER shape — `metadata` exactly `{ old, new }`,
 *    written before the declaration existed — has text of unknown provenance.
 *    Its text is served only to a reader who is served every field of the
 *    parent (as the security service enumerates them for the system); any
 *    narrower reader gets the row without it. Those rows age out with the
 *    object's retention.
 *  - Any other row was written by someone other than the mirror — an app's own
 *    server action. Its text is the author's, and is served as written; its
 *    `metadata.old` / `metadata.new`, if it has them, are narrowed like the
 *    mirror's, because that shape IS record field values.
 *
 * ## An update whose every recorded change is withheld is withheld as a row (#21388)
 *
 * Narrowing key by key leaves one thing behind. An UPDATE row whose recorded
 * change had keys, every one of which this reader is not served, still reached
 * the reader as a row with an empty change, and its summary, actor and
 * timestamp said that the record changed, and when. That is how an org peer
 * read each sign-in time of a colleague: a sign-in stamps identity fields the
 * peer is withheld. So such a row is withheld from that reader as a ROW:
 *
 *  - An update row is one whose stored change has both sides (`old` and `new`
 *    are records). A create (`old` null) and a delete (`new` null) keep their
 *    rows: their existence is the record's own, which the read gate decides.
 *  - "Had keys" reads the STORED change, never the redacted one. A row whose
 *    stored change is empty on both sides (an update that touched only
 *    `internal` fields, which the writer omits) is empty for every reader, and
 *    is unaffected.
 *  - "Withheld" is the answer this redaction narrows by: a key this reader is
 *    not served. One answer for both, so a row is withheld exactly when the
 *    redaction would leave its change empty. A reader the service gives no
 *    answer for is narrowed by neither. ⛔ No object or field is named here.
 *
 * ## A fired milestone is withheld as a row from a reader not served its watched fields (#22786)
 *
 * A fired milestone's row speaks about its watched fields in columns the
 * key-by-key narrowing does not reach: its `type` is the declaration's, and
 * its summary is the declaration's sentence. Both say that a watched field
 * entered its declared value. So such a row is withheld as a ROW from a reader
 * not served every field the object's milestones watch, and the redaction
 * drops its kind from any row that reader is still served.
 *
 * ## Both rules are one predicate over writer-stamped columns (ADR-0139 D4, E6)
 *
 * Each row carries, stamped at write time by one derivation
 * (`activity-changed-fields.ts`: the CRUD mirror, a before-insert hook for any
 * other writer, and the stored-row backfill `os migrate
 * activity-changed-fields`), the key set of its recorded change
 * (`changed_fields`) and, for a fired milestone, one sorted key of the fields
 * its declaration watched (`milestone_key`). The rule is a WHERE over them,
 * one branch per parent object ({@link keptRowsOfParent}), ANDed into the same
 * four reads (`find`, `findOne`, `count`, `aggregate`), so a list's `total`,
 * its pages, a by-id read and a grouped count all agree with the rows served:
 *
 *  - an update row whose `changed_fields` is non-empty and holds no field this
 *    reader is served is withheld; a create, a delete, a note, and an update
 *    empty for everyone (it touched only `internal` fields, which the writer
 *    omits) are stamped `[]` and kept;
 *  - a milestone row is served only when its key equals the key of the parent's
 *    CURRENT `activityMilestones` declaration and this reader is served every
 *    field that declaration watches (ruled letter B). A row written under an
 *    earlier declaration, or naming a since-removed field, is withheld from
 *    every non-exempt reader until retention ages it out;
 *  - an UNSTAMPED row — at rest from before the columns existed and not yet
 *    backfilled, or one the planner could not judge — is withheld from every
 *    non-system reader the service answers for (ADR-0139 D4: an unjudged row
 *    fails closed).
 *
 * No row is read to build it — no SYSTEM pre-scan and no window — and no
 * `ReadableIds` leaf is composed by it. Both columns are value-bearing:
 * `changed_fields` is served narrowed to the fields this reader is served,
 * `milestone_key` is never served, and the query guard
 * (`parent-field-query-guard.ts`) refuses a predicate on either to a reader
 * withheld a parent field, as it does for `metadata`.
 *
 * ## Fail closed
 *
 * An unexpected failure strips every value-bearing column from the rows of the
 * read rather than serving them unredacted — the sibling read gate's rule. A
 * withheld-row rule that cannot be built denies the read, as the read gate does.
 * The
 * security service's own "no answer" (no service wired, or an unresolvable
 * read projection) passes rows through, exactly as the approval snapshot and
 * the data plane itself do; a reader the service cannot answer MASKING for is
 * served no field (the contract's obligation, see {@link resolveServedFields}).
 *
 * System-context reads (the audit writer, the backfill, a gate's bounded probe) and
 * context-less programmatic calls are not redacted, as for the read gate.
 */

import type { ISecurityService, SecurityContext } from '@objectstack/spec/contracts';
import { referenceTargetOf, resolveDisplayField } from '@objectstack/spec/data';
import {
  ACTIVITY_CHANGED_FIELDS_COLUMN,
  ACTIVITY_KIND_KEY,
  ACTIVITY_MILESTONE_KEY_COLUMN,
  ACTIVITY_MILESTONE_KIND,
  ACTIVITY_TEXT_SOURCES_KEY,
  declaredMilestoneWatchedFields,
  milestoneKeyOf,
} from './activity-changed-fields.js';
import { ACTIVITY_GATE, parseActivityParentObject, type ActivityMiddlewareEngine } from './activity-read-visibility.js';
import { pinnedParentObject } from './parent-field-query-guard.js';
import {
  PARENT_GATE_READ_OPS,
  andIntoWhere,
  enumerateParentObjects,
  namedParentObjects,
  type ParentRecordGateEngine,
} from './parent-record-read-gate.js';
import {
  dropUnservedKeys,
  ensureJudgedColumnsProjected,
  isRecord,
  servedFieldsPerRead,
  type FieldRedactionLogger,
  type FieldVisibilitySource,
} from './served-fields.js';

/**
 * The served-unmasked composition lives in `served-fields.ts`, shared with the
 * compliance ledger's redaction (#21155); re-exported here so this seam's
 * public names are unchanged.
 */
export { resolveServedFields } from './served-fields.js';
import { omitSideCopyFromCopy, sideCopyColumnsOf } from './side-copy-columns.js';
import {
  ACTIVITY_SUMMARY_MESSAGE_KEY,
  composeActivitySummary,
  readActivitySummaryMessage,
  type ActivitySummaryFieldChange,
  type ActivitySummaryLocale,
  type ActivitySummaryMessage,
} from './activity-summary-message.js';

const ACTIVITY_OBJECT = 'sys_activity';
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * The `metadata` keys the CRUD mirror declares a row's text provenance and its
 * domain kind under, and the milestone kind — defined beside the stamp planner
 * (`activity-changed-fields.ts`), re-exported here so this seam's public names
 * are unchanged.
 */
export { ACTIVITY_KIND_KEY, ACTIVITY_MILESTONE_KIND, ACTIVITY_TEXT_SOURCES_KEY };

/** The declaration's shape. */
export interface ActivityTextSources {
  summary: string[];
  record_label: string[];
  /**
   * [#22771] The parent fields `metadata.kind` was derived from, present only
   * beside a kind the mirror stamped. For a milestone it is every field a
   * declared milestone watches, not only the one that fired: the kind says
   * that SOME milestone fired, which is a fact about all of them.
   */
  kind?: string[];
}

/** The text columns a declaration covers. */
const TEXT_COLUMNS = ['summary', 'record_label'] as const;
type TextColumn = (typeof TEXT_COLUMNS)[number];

/**
 * The columns that can carry a parent field value — [ADR-0139 E6] the two
 * writer-stamped columns included: `changed_fields` names which fields of the
 * parent changed, and `milestone_key` which fields its declaration watched.
 */
const VALUE_BEARING_COLUMNS = [
  'summary',
  'record_label',
  'metadata',
  ACTIVITY_CHANGED_FIELDS_COLUMN,
  ACTIVITY_MILESTONE_KEY_COLUMN,
] as const;

/**
 * The slice of the security contract this seam asks — the REAL interface: the
 * two field answers, and the optional object-level read admission a text
 * composed from a reference is judged by ({@link referenceTitlesPerRead}).
 */
export type ActivityFieldVisibilitySource = FieldVisibilitySource & Partial<Pick<ISecurityService, 'canReadObject'>>;

export type ActivityRedactionLogger = FieldRedactionLogger;

/** Parse a stored `metadata` string; anything but a JSON object is not ours. */
function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Where a row's text came from:
 *  - a field list per text column (the mirror's declaration);
 *  - `'unknown'` — the mirror's earlier shape, or a declaration that does not
 *    parse: treated as composed from every field of the parent;
 *  - `null` — not the mirror's row: served as written.
 */
function textProvenance(metadata: Record<string, unknown> | null): Record<TextColumn, string[] | 'unknown'> | null {
  if (!metadata) return null;
  if (ACTIVITY_TEXT_SOURCES_KEY in metadata) {
    const declared = metadata[ACTIVITY_TEXT_SOURCES_KEY];
    const out = {} as Record<TextColumn, string[] | 'unknown'>;
    for (const col of TEXT_COLUMNS) {
      const list = isRecord(declared) ? declared[col] : undefined;
      out[col] = Array.isArray(list) && list.every((f) => typeof f === 'string') ? (list as string[]) : 'unknown';
    }
    return out;
  }
  const keys = Object.keys(metadata).sort();
  const earlierMirrorShape =
    keys.length === 2 && keys[0] === 'new' && keys[1] === 'old' &&
    (metadata.old === null || isRecord(metadata.old)) &&
    (metadata.new === null || isRecord(metadata.new));
  return earlierMirrorShape ? { summary: 'unknown', record_label: 'unknown' } : null;
}

/**
 * [#22771] Where a row's `metadata.kind` came from, read the way
 * {@link textProvenance} reads its text:
 *  - a field list — the mirror's declaration;
 *  - `'unknown'` — a mirror row whose declaration names no list for it;
 *  - `null` — no kind, or a row the mirror did not write: served as written.
 */
function kindProvenance(metadata: Record<string, unknown> | null): string[] | 'unknown' | null {
  if (!metadata || !(ACTIVITY_KIND_KEY in metadata) || !(ACTIVITY_TEXT_SOURCES_KEY in metadata)) return null;
  const declared = metadata[ACTIVITY_TEXT_SOURCES_KEY];
  const list = isRecord(declared) ? declared[ACTIVITY_KIND_KEY] : undefined;
  return Array.isArray(list) && list.every((f) => typeof f === 'string') ? (list as string[]) : 'unknown';
}

/** Drop every value-bearing column — the fail-closed answer for one row. */
function stripValueBearing(row: Record<string, unknown>): void {
  for (const col of VALUE_BEARING_COLUMNS) delete row[col];
}

/** Names this seam in its log lines and in the served-fields answer's. */
const REDACTION_SEAM = 'activity field redaction';

/** One read's served-unmasked answer, per parent object. */
type ServedFor = (object: string) => Promise<string[] | undefined>;

/**
 * One read's answer to "is this reader served fewer fields of `object` than the
 * system is?", per parent object: how a value of UNKNOWN provenance is judged.
 * No full answer to compare against reads as restricted (closed).
 */
type RestrictedFor = (object: string, served: ReadonlySet<string>) => Promise<boolean>;

/** {@link RestrictedFor} for ONE read: one system read per parent object, never one per row. */
function restrictedPerRead(security: ActivityFieldVisibilitySource | undefined): RestrictedFor {
  const restricted = new Map<string, Promise<boolean>>();
  return (object, served) => {
    let p = restricted.get(object);
    if (!p) {
      p = (async () => {
        let all: string[] | undefined;
        try {
          all = await security!.getReadableFields(object, SYSTEM_CTX as never);
        } catch {
          all = undefined;
        }
        // No full answer to compare against: unknown provenance stays closed.
        if (!Array.isArray(all)) return true;
        return all.some((f) => !served.has(String(f)));
      })();
      restricted.set(object, p);
    }
    return p;
  };
}

/**
 * Whether a value composed from `sources` is served to a reader served
 * `served`: every source served, or, for `'unknown'` provenance, a reader not
 * restricted on the parent. The ONE answer both the row rule and the column
 * redaction judge a declared value by.
 */
async function sourcesServed(
  sources: string[] | 'unknown',
  served: ReadonlySet<string>,
  restricted: () => Promise<boolean>,
): Promise<boolean> {
  return sources === 'unknown' ? !(await restricted()) : sources.every((f) => served.has(f));
}

/**
 * One read's answer to "may this reader read every referenced title a text
 * composed from the declared `sources` of `parent` names?" — `true` when no
 * source is a reference field.
 */
export type ReferenceTitlesServedFor = (parent: string, sources: readonly string[]) => Promise<boolean>;

/**
 * {@link ReferenceTitlesServedFor} for ONE read, asked of the reader `context`
 * (see "A text composed from a reference carries the referenced record's
 * title" in this module's header). A source of `parent` that is a reference
 * field (`referenceTargetOf`, the spec's one arbiter of a reference's target)
 * names its target's title, and that title is served when:
 *
 *  - the target declares no title field, or names the primary key: the mirror
 *    names such a record by its id, which is no title;
 *  - otherwise the reader is served the target's title field
 *    (`resolveDisplayField`) by `servedFor` — a target the service gives no
 *    answer for is not narrowed, as for the parent — AND the security service
 *    admits the reader to the target object (`canReadObject`, `=== true`; a
 *    throw refuses). A reference field declaring `referenceNameVisible` lifts
 *    only that admission, as it does on `$expand`. A service that answers no
 *    `canReadObject` leaves the title to the field-level answer, as the
 *    parent-record gate leaves its own objects to the caller-scoped read.
 *
 * A reference whose target is not registered, or a field declaration that
 * cannot be read, refuses (fail closed). One answer per reference field and one
 * admission per target object, per read; no row is read.
 */
export function referenceTitlesPerRead(
  schemaOf: ((object: string) => unknown) | undefined,
  security: ActivityFieldVisibilitySource | undefined,
  context: unknown,
  servedFor: ServedFor,
  logger?: ActivityRedactionLogger,
): ReferenceTitlesServedFor {
  const schema = (object: string): Record<string, unknown> | undefined => {
    try {
      const s = schemaOf?.(object);
      return isRecord(s) ? s : undefined;
    } catch {
      return undefined;
    }
  };
  const fieldsOf = (object: string): Record<string, unknown> => {
    const fields = schema(object)?.fields;
    return isRecord(fields) ? fields : {};
  };

  const admitted = new Map<string, Promise<boolean>>();
  const admits = (target: string): Promise<boolean> => {
    let p = admitted.get(target);
    if (!p) {
      p = (async () => {
        const canReadObject = security?.canReadObject;
        if (typeof canReadObject !== 'function') return true;
        try {
          return (await canReadObject.call(security, target, { ...(context as object) } as SecurityContext)) === true;
        } catch (err) {
          logger?.warn(
            `[audit] ${REDACTION_SEAM}: the object-level read admission for '${target}' failed — a text naming ` +
              `its records by title is not served on this read (fail closed) (${(err as Error)?.message ?? err})`,
          );
          return false;
        }
      })();
      admitted.set(target, p);
    }
    return p;
  };

  const perField = new Map<string, Promise<boolean>>();
  const titleServed = (parent: string, field: string): Promise<boolean> => {
    const key = JSON.stringify([parent, field]);
    let p = perField.get(key);
    if (!p) {
      p = (async () => {
        const def = fieldsOf(parent)[field];
        let target: string | undefined;
        try {
          target = referenceTargetOf(def);
        } catch {
          return false;
        }
        if (!target) return true;
        const targetSchema = schema(target);
        if (!targetSchema) return false;
        const titleField = resolveDisplayField(targetSchema as Parameters<typeof resolveDisplayField>[0]);
        if (!titleField || titleField === 'id') return true;
        const served = await servedFor(target);
        if (served !== undefined && !served.some((f) => String(f) === titleField)) return false;
        if (isRecord(def) && def.referenceNameVisible === true) return true;
        return admits(target);
      })();
      perField.set(key, p);
    }
    return p;
  };

  return async (parent, sources) => {
    for (const field of sources) if (!(await titleServed(parent, field))) return false;
    return true;
  };
}

/**
 * The engine slice the withheld-row rule needs: the registry its parent objects
 * are enumerated from, and each object's registered definition (its CURRENT
 * `activityMilestones` declaration). No row is read.
 */
export type ActivityRedactionEngine = ActivityMiddlewareEngine &
  Pick<ParentRecordGateEngine, 'registry'> & {
    getSchema?(object: string): unknown;
  };

/** No real row matches it: the withheld-row rule's fail-closed answer. */
const WITHHELD_DENY_ALL = { id: '__activity_withheld_row_denied__' } as const;

/** The withheld-row rule's states an engine has already reported, per engine. */
const withheldRuleReported = new WeakMap<object, Set<string>>();

function reportOnce(engine: object, logger: ActivityRedactionLogger, key: string, message: string): void {
  let reported = withheldRuleReported.get(engine);
  if (!reported) withheldRuleReported.set(engine, (reported = new Set()));
  if (reported.has(key)) return;
  reported.add(key);
  logger.warn(message);
}

/**
 * The CURRENT `activityMilestones` declaration of `object`: its watched fields,
 * or `[]`. A definition that cannot be read throws, and the middleware denies
 * the read (fail closed) rather than judge its milestone rows unread.
 */
function currentMilestoneWatched(engine: ActivityRedactionEngine, object: string): string[] {
  return declaredMilestoneWatchedFields(typeof engine.getSchema === 'function' ? engine.getSchema(object) : undefined);
}

/**
 * [#21388, ADR-0139 D4] The update half of the withheld-row rule — whether a
 * stamped row is a withheld-only update — as a predicate over `changed_fields`
 * for a reader served `served`. An update row with a non-empty `changed_fields`
 * none of whose members this reader is served is withheld; so the predicate is
 * written as the rows it KEEPS: `changed_fields` is empty (a create, a delete, a
 * note, an update empty for everyone), or it holds a served field — one
 * `$contains` per served field. On a multi-value column `$contains` is
 * MEMBERSHIP (`filter.zod.ts`, the JSON-stored column paragraph), so a served
 * field whose name is a prefix of a withheld one never keeps the row.
 *
 * Written positively, never as a `$not` of the withheld rows: `$not` is
 * NULL-safe per leaf, so it would re-admit an unstamped row; the stamped
 * conjunct beside it in {@link keptRowsOfParent} decides those.
 * Exported for direct testing.
 */
export function isWithheldOnlyUpdate(served: readonly string[]): Record<string, unknown> {
  const members = [...new Set(served)].sort();
  return {
    $or: [
      { [ACTIVITY_CHANGED_FIELDS_COLUMN]: { $empty: true } },
      ...members.map((f) => ({ [ACTIVITY_CHANGED_FIELDS_COLUMN]: { $contains: f } })),
    ],
  };
}

/**
 * [ADR-0139 D4, E6] The rows of ONE parent object `P` a reader served
 * `served` keeps, as a predicate over the two writer-stamped columns
 * (`activity-changed-fields.ts`):
 *
 *  - **stamped** — `changed_fields` is not null. An unstamped row (written
 *    before the column existed and not yet backfilled, or one the planner
 *    could not judge) is withheld: ADR-0139 D4's answer for an unjudged row.
 *  - **the update half** (#21388, {@link isWithheldOnlyUpdate}) —
 *    `changed_fields` is empty, or it contains a field this reader is served:
 *    one `$contains` per served field. So an update whose every recorded key is
 *    withheld is withheld, and a create, a delete, a note, and an update that
 *    touched only `internal` fields (empty for everyone) are kept.
 *  - **the milestone half** (#22786, ruled letter B) — `milestone_key` is null
 *    (no milestone fired), or it EQUALS the key of P's current
 *    `activityMilestones` declaration AND this reader is served every field
 *    that declaration watches. A milestone row written under an earlier
 *    declaration, or naming a since-removed field, is withheld from every
 *    non-exempt reader until retention ages it out.
 *
 * Exported for direct testing.
 */
export function keptRowsOfParent(
  parent: string,
  served: readonly string[],
  watched: readonly string[],
): Record<string, unknown> {
  const servedSet = new Set(served);
  const key = milestoneKeyOf(watched);
  const milestoneServed = key !== null && watched.every((f) => servedSet.has(f));
  return {
    $and: [
      { object_name: parent },
      { [ACTIVITY_CHANGED_FIELDS_COLUMN]: { $null: false } },
      isWithheldOnlyUpdate(served),
      milestoneServed
        ? { $or: [{ [ACTIVITY_MILESTONE_KEY_COLUMN]: { $null: true } }, { [ACTIVITY_MILESTONE_KEY_COLUMN]: key }] }
        : { [ACTIVITY_MILESTONE_KEY_COLUMN]: { $null: true } },
    ],
  };
}

/**
 * [ADR-0139 D4, E6] The WHERE that withholds, from one read, every row the
 * withheld-row rule withholds from the reader `servedFor` answers for: one
 * {@link keptRowsOfParent} branch per parent object, ORed — or `null` when the
 * service gives no answer for any of them (nothing is narrowed).
 *
 * The parents are the read gate's own enumeration (`enumerateParentObjects`,
 * every registered object the CRUD mirror can write about), narrowed to the
 * ONE parent the read pins by equality on `object_name` when it pins one
 * (`pinnedParentObject`, the query guard's reading): no row of any other parent
 * can match such a read. Otherwise it is narrowed as the gate narrows its own,
 * to the parents the read's `where` names (`namedParentObjects`), and it judges
 * every row that read can match exactly as the full enumeration would: whether
 * the rule narrows the read at all is still asked of every enumerated parent,
 * so when it does, the rows of a named object no enumeration holds are
 * withheld as before. A parent the service gives no answer for is kept whole
 * (`{ object_name: P }`), as the redaction serves it.
 *
 * It reads no row, as no context: no SYSTEM pre-scan, no window, and no leaf
 * composed for anyone (the security service's own field answers are its only
 * input). An engine with no registry view cannot say which parents exist, so
 * nothing can be judged: the read is denied, and that is said once.
 * Exported for direct testing.
 */
export async function computeWithheldUpdateFilter(
  engine: ActivityRedactionEngine,
  ast: Record<string, unknown>,
  servedFor: ServedFor,
  logger: ActivityRedactionLogger,
): Promise<unknown | null> {
  const pinned = pinnedParentObject(ast.where, ACTIVITY_OBJECT);
  // It reads the registry view alone (the read gate's own enumeration),
  // narrowed to the parents the read names, as the gate narrows its own.
  const registry = engine as ParentRecordGateEngine;
  const parents = pinned !== null ? [pinned] : enumerateParentObjects(registry, ACTIVITY_GATE, ast.where);
  if (parents === null) {
    reportOnce(
      engine,
      logger,
      'no-registry',
      `[audit] ${REDACTION_SEAM}: the engine exposes no registry view, so the parent objects of the activity ` +
        'stream cannot be enumerated and no row can be judged: every non-system read that names no one parent ' +
        'object is denied (fail-closed). Reported once for this engine.',
    );
    return WITHHELD_DENY_ALL;
  }
  const branches: Array<Record<string, unknown>> = [];
  let narrowed = false;
  for (const parent of parents) {
    const served = await servedFor(parent);
    if (served === undefined) {
      branches.push({ object_name: parent });
      continue;
    }
    narrowed = true;
    branches.push(keptRowsOfParent(parent, served.map(String), currentMilestoneWatched(engine, parent)));
  }
  if (!narrowed && pinned === null && namedParentObjects(ast.where) !== null) {
    // Narrowed to the named parents, none of which is narrowed: the full
    // enumeration's answer is still "narrow" when any other parent is, and its
    // WHERE then keeps, of this read's rows, the named parents' rows alone.
    for (const parent of enumerateParentObjects(registry, ACTIVITY_GATE) ?? []) {
      if (!parents.includes(parent) && (await servedFor(parent)) !== undefined) {
        narrowed = true;
        break;
      }
    }
  }
  if (!narrowed) return null;
  if (branches.length === 0) return WITHHELD_DENY_ALL;
  return branches.length === 1 ? branches[0] : { $or: branches };
}

/**
 * Redact the value-bearing columns of the activity rows one read is about to
 * hand back, as `context`. Mutates the rows in place (they are the read's own
 * result objects). Exported for direct testing.
 */
export async function redactActivityRows(
  rows: unknown,
  security: ActivityFieldVisibilitySource | undefined,
  context: unknown,
  logger?: ActivityRedactionLogger,
  /** The read's own answer, when the caller already holds one: the middleware
   * shares it with the withheld-update rule, so both judge by ONE answer. */
  served?: ServedFor,
  /** [#22786] Likewise the read's answer for unknown provenance. */
  restricted?: RestrictedFor,
  /** The read's answer for a text composed from a reference
   * ({@link referenceTitlesPerRead}). It needs the registry's definitions, so
   * the middleware always hands it in; without it no source is judged as a
   * reference. */
  referenceTitles?: ReferenceTitlesServedFor,
  /** [#36290] The registered definition of a parent object, for the field
   * labels a narrowed field-change summary is re-composed with; without it
   * the summary names each field by its machine key. */
  getObjectDef?: (object: string) => unknown,
): Promise<void> {
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []) as unknown[];
  if (list.length === 0) return;
  // One answer per parent object per read, never one per row.
  const servedFor = served ?? servedFieldsPerRead(security, context, logger, REDACTION_SEAM);
  /** Is this reader served fewer fields of `object` than the system is? */
  const restrictedOn = restricted ?? restrictedPerRead(security);

  for (const item of list) {
    if (!isRecord(item)) continue;
    const row = item;
    if (!VALUE_BEARING_COLUMNS.some((col) => col in row)) continue;
    // [ADR-0139 E6] The milestone key is bookkeeping for the read rule: never served.
    delete row[ACTIVITY_MILESTONE_KEY_COLUMN];
    const object = parseActivityParentObject(row);
    // The read gate serves no row without a parent; a row that reaches here
    // without one has nothing to be judged against.
    if (!object) {
      stripValueBearing(row);
      continue;
    }
    // [#32442] Ahead of the served-fields answer, for every reader.
    if (sideCopyColumnsOf(object).length > 0 && 'metadata' in row) {
      // Stored as a JSON string; an already-parsed object is narrowed in place.
      const inPlace = isRecord(row.metadata);
      const copied = inPlace ? (row.metadata as Record<string, unknown>) : parseMetadata(row.metadata);
      let dropped = false;
      for (const side of ['old', 'new'] as const) {
        const snapshot = copied?.[side];
        if (isRecord(snapshot) && omitSideCopyFromCopy(object, snapshot)) dropped = true;
      }
      if (dropped && !inPlace) row.metadata = JSON.stringify(copied);
    }
    const answer = await servedFor(object);
    if (answer === undefined) continue;
    const servedSet = new Set(answer.map(String));

    // [ADR-0139 E6] The recorded change's key set, narrowed to the served
    // members, as `metadata.old` / `metadata.new` are narrowed key by key.
    const changedFields = row[ACTIVITY_CHANGED_FIELDS_COLUMN];
    if (Array.isArray(changedFields)) {
      row[ACTIVITY_CHANGED_FIELDS_COLUMN] = changedFields.filter((f) => servedSet.has(String(f)));
    } else if (changedFields !== undefined && changedFields !== null) {
      // Not the stored shape: nothing here can narrow it, so it is not served.
      delete row[ACTIVITY_CHANGED_FIELDS_COLUMN];
    }

    const metadata = 'metadata' in row ? parseMetadata(row.metadata) : null;
    const provenance = textProvenance(metadata);
    const kindSources = kindProvenance(metadata);
    /** Whether a value composed from `sources` is served to this reader. */
    const servedWhole = (sources: string[] | 'unknown') =>
      sourcesServed(sources, servedSet, () => restrictedOn(object, servedSet));

    /** [#36290] The field-change code, narrowed to this reader; `null` when the row has none to serve. */
    let narrowedChanges: Extract<ActivitySummaryMessage, { key: 'fieldChanges' }> | null = null;
    if (metadata) {
      let changed = false;
      for (const side of ['old', 'new'] as const) {
        const snapshot = metadata[side];
        if (isRecord(snapshot) && dropUnservedKeys(snapshot, servedSet)) changed = true;
      }
      // [#36290, ruling 7076513167] The field-change code is served to a
      // reader narrowed change by change, by the answer `old` / `new` are
      // narrowed by: a change of a field this reader is not served is dropped,
      // and a reference field's change is kept only for a reader served the
      // referenced record's title ({@link referenceTitlesPerRead}), the rule
      // the summary text is judged by. A code this version cannot read is
      // dropped (fail closed). Every other code is left to the summary
      // middleware, which strips it for every non-system reader.
      if (ACTIVITY_SUMMARY_MESSAGE_KEY in metadata) {
        const stored = metadata[ACTIVITY_SUMMARY_MESSAGE_KEY];
        const code = readActivitySummaryMessage(stored);
        if (isRecord(stored) && stored.key === 'fieldChanges' && code?.key !== 'fieldChanges') {
          delete metadata[ACTIVITY_SUMMARY_MESSAGE_KEY];
          changed = true;
        } else if (code?.key === 'fieldChanges') {
          const kept: ActivitySummaryFieldChange[] = [];
          for (const change of code.changes) {
            if (!servedSet.has(change.field)) continue;
            if (referenceTitles && !(await referenceTitles(object, [change.field]))) continue;
            kept.push(change);
          }
          if (kept.length === 0) {
            delete metadata[ACTIVITY_SUMMARY_MESSAGE_KEY];
            changed = true;
          } else {
            narrowedChanges = { ...code, changes: kept };
            if (kept.length !== code.changes.length) {
              metadata[ACTIVITY_SUMMARY_MESSAGE_KEY] = narrowedChanges;
              changed = true;
            }
          }
        }
      }
      if (kindSources !== null && !(await servedWhole(kindSources))) {
        delete metadata[ACTIVITY_KIND_KEY];
        changed = true;
      }
      if (ACTIVITY_TEXT_SOURCES_KEY in metadata) {
        delete metadata[ACTIVITY_TEXT_SOURCES_KEY];
        changed = true;
      }
      if (changed) row.metadata = JSON.stringify(metadata);
    }

    if (!provenance) continue;
    for (const col of TEXT_COLUMNS) {
      if (!(col in row)) continue;
      const sources = provenance[col];
      const served = (await servedWhole(sources))
        && (!referenceTitles || sources === 'unknown' || (await referenceTitles(object, sources)));
      if (served) continue;
      // [#36290] A field-change summary is not dropped whole when some of its
      // changes are this reader's: it is re-composed from the narrowed code,
      // so the reader reads the lines of the fields they may read. The text is
      // composed from the served changes alone; the summary middleware then
      // re-composes it in the reader's language from the same code.
      if (col === 'summary' && narrowedChanges) {
        row.summary = composeActivitySummary(narrowedChanges, authoredLabelsLocale(getObjectDef)) ?? '';
        continue;
      }
      delete row[col];
    }
  }
}

/**
 * [#36290] The locale a narrowed field-change summary is composed in on this
 * seam: no bundle (every key misses), so each field is named by its authored
 * label, else its machine key, and each value by the text the writer stored.
 */
function authoredLabelsLocale(getObjectDef?: (object: string) => unknown): ActivitySummaryLocale {
  return {
    translate: () => undefined,
    locale: undefined,
    getObjectDef: (object) => {
      try {
        return getObjectDef?.(object) ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * The text columns' provenance lives in `metadata`, and the parent in
 * `object_name`; a projection that names a value-bearing column without them
 * gets them added for the read and removed from what is served.
 */
const JUDGED_BY = ['object_name', 'metadata'] as const;

/**
 * Install the `sys_activity` field-redaction middleware. `getSecurity` is
 * resolved on every read: the security plugin may register after this one.
 * Inert on an engine without the middleware seam; `AuditPlugin` says so.
 *
 * [#21388, #22786] Before the read runs, the same middleware ANDs the
 * withheld-row predicate into the WHERE of all four reads
 * (`computeWithheldUpdateFilter`, ADR-0139 E6). `AuditPlugin` registers it after
 * the read gate; the two are independent conjuncts.
 */
export function installActivityFieldRedaction(
  engine: ActivityRedactionEngine,
  getSecurity: () => ActivityFieldVisibilitySource | undefined,
  logger: ActivityRedactionLogger,
): void {
  if (typeof engine.registerMiddleware !== 'function') return;
  engine.registerMiddleware(
    async (ctx, next) => {
      if (!ctx.context || ctx.context.isSystem) return next();
      const security = getSecurity();
      // One answer per read, shared by the row rule and the redaction below.
      const servedFor = servedFieldsPerRead(security, ctx.context, logger, REDACTION_SEAM);
      const restrictedFor = restrictedPerRead(security);
      if (security && ctx.ast && PARENT_GATE_READ_OPS.has(ctx.operation)) {
        try {
          const filter = await computeWithheldUpdateFilter(engine, ctx.ast, servedFor, logger);
          if (filter) andIntoWhere(ctx, filter);
        } catch (err) {
          // A failure to build the rule must never fall open into the timing leak.
          logger.warn(
            `[audit] ${REDACTION_SEAM}: the withheld-row rule could not be built, denying all ` +
              `(${(err as Error)?.message ?? err})`,
          );
          andIntoWhere(ctx, WITHHELD_DENY_ALL);
        }
      }
      if (ctx.operation !== 'find' && ctx.operation !== 'findOne') return next();
      const added = ensureJudgedColumnsProjected(ctx.ast, VALUE_BEARING_COLUMNS, JUDGED_BY);
      await next();
      const list = (Array.isArray(ctx.result) ? ctx.result : ctx.result ? [ctx.result] : []) as unknown[];
      try {
        const referenceTitles = referenceTitlesPerRead(
          (object) => (typeof engine.getSchema === 'function' ? engine.getSchema(object) : undefined),
          security,
          ctx.context,
          servedFor,
          logger,
        );
        await redactActivityRows(list, security, ctx.context, logger, servedFor, restrictedFor, referenceTitles, (object) =>
          typeof engine.getSchema === 'function' ? engine.getSchema(object) : undefined,
        );
      } catch (err) {
        // A redaction failure must never fall open into a leak.
        logger.warn(
          `[audit] activity field redaction failed — serving the rows without their value-bearing columns ` +
            `(${(err as Error)?.message ?? err})`,
        );
        for (const row of list) if (isRecord(row)) stripValueBearing(row);
      }
      if (added.length) for (const row of list) if (isRecord(row)) for (const col of added) delete row[col];
    },
    { object: ACTIVITY_OBJECT },
  );
}
