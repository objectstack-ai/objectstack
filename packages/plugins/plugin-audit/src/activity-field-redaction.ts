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
 * ## Fail closed
 *
 * An unexpected failure strips every value-bearing column from the rows of the
 * read rather than serving them unredacted — the sibling read gate's rule. The
 * security service's own "no answer" (no service wired, or an unresolvable
 * read projection) passes rows through, exactly as the approval snapshot and
 * the data plane itself do; a reader the service cannot answer MASKING for is
 * served no field (the contract's obligation, see {@link resolveServedFields}).
 *
 * System-context reads (the audit writer, the gate's own pre-scan) and
 * context-less programmatic calls are not redacted, as for the read gate.
 */

import type { ISecurityService } from '@objectstack/spec/contracts';
import { parseActivityParentObject, type ActivityMiddlewareEngine } from './activity-read-visibility.js';

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
export type ActivityFieldVisibilitySource = Pick<ISecurityService, 'getReadableFields' | 'getQueryableFields'>;

export interface ActivityRedactionLogger {
  warn(msg: string, meta?: unknown): void;
}

/**
 * The fields of `object` this reader is served UNMASKED, or `undefined` when
 * this seam must not narrow.
 *
 * The same composition `plugin-approvals` serves its snapshot with
 * (`resolveReadableSnapshotFields`, #20964), asked as the reader:
 *
 *  - no service, no object, or a read projection that answers `undefined` or
 *    throws → `undefined`: the contract's "no answer", the data plane's own
 *    fallback, and so not a reason to blank the stream;
 *  - otherwise the read projection intersected with `getQueryableFields`.
 *    When THAT answer cannot be had (absent member, `undefined`, a throw) the
 *    contract obliges the consumer not to read its absence as "nothing is
 *    masked": the read projection reports every masked field readable. So the
 *    answer is `[]` — no field is served.
 */
export async function resolveServedFields(
  security: Partial<ActivityFieldVisibilitySource> | undefined,
  object: string | undefined,
  context: unknown,
  logger?: ActivityRedactionLogger,
): Promise<string[] | undefined> {
  if (!security || typeof security.getReadableFields !== 'function') return undefined;
  const name = String(object ?? '').trim();
  if (!name) return undefined;
  let readable: string[] | undefined;
  try {
    readable = await security.getReadableFields(name, context as never);
  } catch (err) {
    logger?.warn(
      `[audit] activity field redaction: readable fields of '${name}' could not be resolved — ` +
        `serving its activity rows unnarrowed (${(err as Error)?.message ?? err})`,
    );
    return undefined;
  }
  if (readable === undefined) return undefined;

  let unmasked: string[] | undefined;
  let reason = 'the security service has no masked-for-this-caller answer (getQueryableFields)';
  if (typeof security.getQueryableFields === 'function') {
    try {
      unmasked = await security.getQueryableFields(name, context as never);
      if (unmasked === undefined) reason = 'getQueryableFields answered undefined';
    } catch (err) {
      reason = `getQueryableFields threw: ${(err as Error)?.message ?? err}`;
    }
  }
  if (unmasked === undefined) {
    logger?.warn(
      `[audit] activity field redaction: cannot tell which fields of '${name}' are masked for this caller — ` +
        `serving no field value of it (fail closed): ${reason}`,
    );
    return [];
  }
  const keep = new Set(unmasked.map(String));
  return readable.filter((f) => keep.has(String(f)));
}

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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

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
): Promise<void> {
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []) as unknown[];
  if (list.length === 0) return;
  // One answer per parent object per read, never one per row.
  const served = new Map<string, Promise<string[] | undefined>>();
  const servedFor = (object: string) => {
    let p = served.get(object);
    if (!p) served.set(object, (p = resolveServedFields(security, object, context, logger)));
    return p;
  };
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
        if (!isRecord(snapshot)) continue;
        for (const key of Object.keys(snapshot)) {
          if (!servedSet.has(key)) {
            delete snapshot[key];
            changed = true;
          }
        }
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
 * gets them added for the read and removed from what is served. Returns the
 * columns it added.
 */
function ensureProjected(ast: Record<string, unknown> | undefined): string[] {
  const fields = ast?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return [];
  if (!fields.some((f) => (VALUE_BEARING_COLUMNS as readonly string[]).includes(String(f)))) return [];
  const added: string[] = [];
  for (const col of ['object_name', 'metadata']) {
    if (!fields.includes(col)) {
      fields.push(col);
      added.push(col);
    }
  }
  return added;
}

/**
 * Install the `sys_activity` field-redaction middleware. `getSecurity` is
 * resolved on every read: the security plugin may register after this one.
 * Inert on an engine without the middleware seam; `AuditPlugin` says so.
 */
export function installActivityFieldRedaction(
  engine: ActivityMiddlewareEngine,
  getSecurity: () => ActivityFieldVisibilitySource | undefined,
  logger: ActivityRedactionLogger,
): void {
  if (typeof engine.registerMiddleware !== 'function') return;
  engine.registerMiddleware(
    async (ctx, next) => {
      if ((ctx.operation !== 'find' && ctx.operation !== 'findOne') || !ctx.context || ctx.context.isSystem) {
        return next();
      }
      const added = ensureProjected(ctx.ast);
      await next();
      const list = (Array.isArray(ctx.result) ? ctx.result : ctx.result ? [ctx.result] : []) as unknown[];
      try {
        await redactActivityRows(list, getSecurity(), ctx.context, logger);
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
