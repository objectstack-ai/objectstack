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
 * It is a WHERE, not a post-read drop, built the way the read gate builds its
 * own and on the same four reads (`find`, `findOne`, `count`, `aggregate`). A
 * pre-scan of the rows the query would touch, under SYSTEM context and in the
 * caller's order, judges each one, and the ids it withholds are ANDed out of
 * the query (`{ id: { $nin: WITHHELD } }`). So a list's `total`, its pages, a
 * by-id read and a grouped count all agree with the rows served; a count that
 * kept the row would leak the same timing. A pre-scan that reaches its bound
 * fails CLOSED, as the read gate's does: the rows beyond the window cannot be
 * judged, so the read is answered from the judged rows alone
 * (`{ id: { $in: KEPT } }`), and a warn says so.
 *
 * ## Fail closed
 *
 * An unexpected failure strips every value-bearing column from the rows of the
 * read rather than serving them unredacted — the sibling read gate's rule. A
 * withheld-update pre-scan that fails denies the read, as the read gate does.
 * The
 * security service's own "no answer" (no service wired, or an unresolvable
 * read projection) passes rows through, exactly as the approval snapshot and
 * the data plane itself do; a reader the service cannot answer MASKING for is
 * served no field (the contract's obligation, see {@link resolveServedFields}).
 *
 * System-context reads (the audit writer, the gate's own pre-scan) and
 * context-less programmatic calls are not redacted, as for the read gate.
 */

import type { CommentAccessEngine } from './comment-access-hooks.js';
import { parseActivityParentObject, type ActivityMiddlewareEngine } from './activity-read-visibility.js';
import { PARENT_GATE_READ_OPS, PARENT_GATE_SCAN_LIMIT, andIntoWhere } from './parent-record-read-gate.js';
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
 * The `metadata` key under which the CRUD mirror declares which PARENT fields
 * each text column was composed from: `{ summary: string[], record_label:
 * string[] }`. Written by `audit-writers.ts`, read (and stripped) here — one
 * name, imported by both halves.
 */
export const ACTIVITY_TEXT_SOURCES_KEY = 'text_sources';

/** The declaration's shape. */
export interface ActivityTextSources {
  summary: string[];
  record_label: string[];
}

/** The text columns a declaration covers. */
const TEXT_COLUMNS = ['summary', 'record_label'] as const;
type TextColumn = (typeof TEXT_COLUMNS)[number];

/** The columns that can carry a parent field value. */
const VALUE_BEARING_COLUMNS = ['summary', 'record_label', 'metadata'] as const;

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

/** Drop every value-bearing column — the fail-closed answer for one row. */
function stripValueBearing(row: Record<string, unknown>): void {
  for (const col of VALUE_BEARING_COLUMNS) delete row[col];
}

/** Names this seam in its log lines and in the served-fields answer's. */
const REDACTION_SEAM = 'activity field redaction';

/** One read's served-unmasked answer, per parent object. */
type ServedFor = (object: string) => Promise<string[] | undefined>;

/** The engine slice the withheld-update rule's pre-scan needs. */
export type ActivityRedactionEngine = ActivityMiddlewareEngine & Pick<CommentAccessEngine, 'find'>;

/** The columns the withheld-update pre-scan reads: the row, its parent object
 * and its stored change. */
const WITHHELD_SCAN_COLUMNS = ['id', 'object_name', 'metadata'] as const;

/** No real row matches it: the withheld-update rule's fail-closed answer. */
const WITHHELD_DENY_ALL = { id: '__activity_withheld_update_denied__' } as const;

/**
 * [#21388] Whether an activity row's STORED change is an update every one of
 * whose keys a reader served `served` is withheld. False for a create or a
 * delete (one side is not a record), for a change empty on both sides (empty
 * for every reader), and for anything that is not a recorded change.
 * Exported for direct testing.
 */
export function isWithheldOnlyUpdate(metadata: Record<string, unknown> | null, served: ReadonlySet<string>): boolean {
  if (!metadata) return false;
  const before = metadata.old;
  const after = metadata.new;
  if (!isRecord(before) || !isRecord(after)) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  if (keys.size === 0) return false;
  for (const key of keys) if (served.has(key)) return false;
  return true;
}

/**
 * [#21388] The WHERE that withholds, from one read, every update row whose
 * stored change is withheld whole from the reader `servedFor` answers for:
 * `null` when the read withholds nothing, `{ id: { $nin: WITHHELD } }` when the
 * pre-scan saw every row the read can touch, and `{ id: { $in: KEPT } }` when
 * it reached its bound (fail closed: an unjudged row is never served).
 * Exported for direct testing.
 */
export async function computeWithheldUpdateFilter(
  engine: Pick<CommentAccessEngine, 'find'>,
  ast: Record<string, unknown>,
  servedFor: ServedFor,
  logger: ActivityRedactionLogger,
): Promise<unknown | null> {
  // The rows the read would touch, under SYSTEM context (the reader may not be
  // served their change; that is what is being decided). The caller's own
  // order rides along, so a bounded window is the one the caller pages through.
  const orderBy = ast.orderBy;
  const candidates = await engine.find(ACTIVITY_OBJECT, {
    where: (ast.where as Record<string, unknown> | undefined) ?? {},
    fields: [...WITHHELD_SCAN_COLUMNS],
    ...(Array.isArray(orderBy) && orderBy.length > 0 ? { orderBy } : {}),
    limit: PARENT_GATE_SCAN_LIMIT,
    context: { ...SYSTEM_CTX },
  });
  if (!candidates.length) return null;

  const servedSets = new Map<string, Set<string> | undefined>();
  const withheld: unknown[] = [];
  const kept: unknown[] = [];
  for (const row of candidates) {
    let isWithheld = false;
    const object = parseActivityParentObject(row);
    if (object) {
      if (!servedSets.has(object)) {
        const answer = await servedFor(object);
        servedSets.set(object, answer === undefined ? undefined : new Set(answer.map(String)));
      }
      const served = servedSets.get(object);
      isWithheld = served !== undefined && isWithheldOnlyUpdate(parseMetadata(row.metadata), served);
    }
    const id = row.id;
    const usable = (typeof id === 'string' || typeof id === 'number') && String(id) !== '';
    // A row is excluded by its stored id, so a withheld row without one
    // cannot be excluded at all: deny the read rather than serve it.
    if (!usable) {
      if (isWithheld) return WITHHELD_DENY_ALL;
      continue;
    }
    (isWithheld ? withheld : kept).push(id);
  }

  if (candidates.length >= PARENT_GATE_SCAN_LIMIT) {
    logger.warn(
      `[audit] ${REDACTION_SEAM}: the withheld-update pre-scan hit the ${PARENT_GATE_SCAN_LIMIT}-row cap; ` +
        'this broad read is answered from the rows it judged (fail-closed) and may omit visible rows — ' +
        'scope the query by object_name and record_id',
    );
    return kept.length ? { id: { $in: kept } } : WITHHELD_DENY_ALL;
  }
  return withheld.length ? { id: { $nin: withheld } } : null;
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
): Promise<void> {
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []) as unknown[];
  if (list.length === 0) return;
  // One answer per parent object per read, never one per row.
  const servedFor = served ?? servedFieldsPerRead(security, context, logger, REDACTION_SEAM);
  const restricted = new Map<string, Promise<boolean>>();
  /** Is this reader served fewer fields of `object` than the system is? */
  const restrictedOn = (object: string, servedSet: Set<string>) => {
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
        return all.some((f) => !servedSet.has(String(f)));
      })();
      restricted.set(object, p);
    }
    return p;
  };

  for (const item of list) {
    if (!isRecord(item)) continue;
    const row = item;
    if (!VALUE_BEARING_COLUMNS.some((col) => col in row)) continue;
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

    const metadata = 'metadata' in row ? parseMetadata(row.metadata) : null;
    const provenance = textProvenance(metadata);

    if (metadata) {
      let changed = false;
      for (const side of ['old', 'new'] as const) {
        const snapshot = metadata[side];
        if (isRecord(snapshot) && dropUnservedKeys(snapshot, servedSet)) changed = true;
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
      const servedWhole =
        sources === 'unknown'
          ? !(await restrictedOn(object, servedSet))
          : sources.every((f) => servedSet.has(f));
      if (!servedWhole) delete row[col];
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
 * [#21388] Before the read runs, the same middleware withholds every update row
 * whose stored change is withheld whole from this reader, as a WHERE on all
 * four reads (`computeWithheldUpdateFilter`). `AuditPlugin` registers it after
 * the read gate, so the gate's parent filter is already in the WHERE its
 * pre-scan reads.
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
      if (security && ctx.ast && PARENT_GATE_READ_OPS.has(ctx.operation)) {
        try {
          const filter = await computeWithheldUpdateFilter(engine, ctx.ast, servedFor, logger);
          if (filter) andIntoWhere(ctx, filter);
        } catch (err) {
          // A pre-scan failure must never fall open into the timing leak.
          logger.warn(
            `[audit] ${REDACTION_SEAM}: the withheld-update pre-scan failed, denying all ` +
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
        await redactActivityRows(list, security, ctx.context, logger, servedFor);
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
