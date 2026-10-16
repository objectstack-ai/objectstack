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

/** The slice of the security contract this seam asks — the REAL interface. */
export type ActivityFieldVisibilitySource = FieldVisibilitySource;

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
 * [ADR-0139 D4, E6] The rows of ONE parent object `P` a reader served
 * `served` keeps, as a predicate over the two writer-stamped columns
 * (`activity-changed-fields.ts`):
 *
 *  - **stamped** — `changed_fields` is not null. An unstamped row (written
 *    before the column existed and not yet backfilled, or one the planner
 *    could not judge) is withheld: ADR-0139 D4's answer for an unjudged row.
 *  - **the update half** (#21388) — `changed_fields` is empty, or it contains
 *    a field this reader is served: one `$contains` per served field. So an
 *    update whose every recorded key is withheld is withheld, and a create, a
 *    delete, a note, and an update that touched only `internal` fields (empty
 *    for everyone) are kept.
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
  const members = [...servedSet].sort();
  const key = milestoneKeyOf(watched);
  const milestoneServed = key !== null && watched.every((f) => servedSet.has(f));
  return {
    $and: [
      { object_name: parent },
      { [ACTIVITY_CHANGED_FIELDS_COLUMN]: { $null: false } },
      {
        $or: [
          { [ACTIVITY_CHANGED_FIELDS_COLUMN]: { $empty: true } },
          ...members.map((f) => ({ [ACTIVITY_CHANGED_FIELDS_COLUMN]: { $contains: f } })),
        ],
      },
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
 * can match such a read. A parent the service gives no answer for is kept
 * whole (`{ object_name: P }`), as the redaction serves it.
 *
 * It reads no row, as no context: no SYSTEM pre-scan, no window, and no leaf
 * composed for anyone (the security service's own field answers are its only
 * input). An engine with no registry view cannot say which parents exist, so
 * nothing can be judged: the read is denied, and that is said once.
 * Exported for direct testing.
 */
export async function computeWithheldRowFilter(
  engine: ActivityRedactionEngine,
  ast: Record<string, unknown>,
  servedFor: ServedFor,
  logger: ActivityRedactionLogger,
): Promise<unknown | null> {
  const pinned = pinnedParentObject(ast.where, ACTIVITY_OBJECT);
  const parents = pinned !== null ? [pinned] : enumerateParentObjects(
    // It reads the registry view alone (the read gate's own enumeration).
    engine as ParentRecordGateEngine,
    ACTIVITY_GATE,
  );
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
  if (!narrowed) return null;
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

    if (metadata) {
      let changed = false;
      for (const side of ['old', 'new'] as const) {
        const snapshot = metadata[side];
        if (isRecord(snapshot) && dropUnservedKeys(snapshot, servedSet)) changed = true;
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
      if (!(await servedWhole(provenance[col]))) delete row[col];
    }
  }
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
 * (`computeWithheldRowFilter`, ADR-0139 E6). `AuditPlugin` registers it after
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
          const filter = await computeWithheldRowFilter(engine, ctx.ast, servedFor, logger);
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
        await redactActivityRows(list, security, ctx.context, logger, servedFor, restrictedFor);
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
