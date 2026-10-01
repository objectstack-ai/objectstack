// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21154] QUERY guard for the two plugin-audit objects whose rows carry the
 * field values of ANOTHER record — the activity stream (`sys_activity`) and the
 * compliance ledger (`sys_audit_log`). A non-system reader may filter, sort,
 * search, group or aggregate by one of their value-bearing columns only when
 * it is served every field of the objects the query can reach: the ONE parent
 * object the query names, or, when it names none, every registered object.
 * Any other such query is refused, in the engine's own refusal shape.
 *
 * ## The defect this closes
 *
 * Each row names its parent record (`object_name`, `record_id`) and carries
 * values of that record's fields in a few columns, written once, as the system:
 *
 *  - `sys_activity` — `summary`, `record_label` and `metadata` (the field
 *    redaction's columns, `activity-field-redaction.ts`, #21081);
 *  - `sys_audit_log` — `old_value` and `new_value`, the before/after snapshots.
 *
 * A read-time redaction narrows those values on the rows a reader is SERVED,
 * after the driver has answered. It never sees the query's predicate: a filter
 * over the stored text is evaluated at rest, unredacted. Row presence is then
 * the oracle — a matching probe returns rows and a non-matching one returns
 * none — so a value the reader is not served can be probed one guess at a
 * time. A group key over the same column is worse: it hands the stored text
 * back as the key.
 *
 * The engine closes the same class for a parent field itself (the security
 * plugin's predicate guard and aggregate-input guard, whose published answer
 * is `getQueryableFields`). It cannot close it here: these are columns of the
 * audit objects, readable to every reader of the row, and what they carry is
 * the value of a field of ANOTHER object.
 *
 * ## The rule (triage ruling on #21154, option A)
 *
 * For a non-system reader whose security answer withholds any field of the
 * parent object, a query that names a value-bearing column is refused. A
 * reader whose answer withholds nothing on that parent keeps querying the
 * column as before — a query naming no parent included, for a reader withheld
 * nothing on any object those rows can concern.
 *
 * "Withholds any field" is read from the serve seam, never derived a second
 * way: the fields this reader is served unmasked are
 * {@link resolveServedFields} — the composition the activity redaction serves
 * rows with — and the reader withholds a field when that set lacks one the
 * security service reads as the system. When the serve seam answers "no
 * answer" (`undefined`: no security service, or one that cannot resolve the
 * object), the redaction serves the text whole, so a predicate over it
 * discloses nothing the rows do not, and the query passes.
 *
 * ## Which parent
 *
 * The parent is a property of each row, while the decision has to be made
 * before any row exists, and the set of parents it is judged against must not
 * depend on the query: the parents of the rows a query MATCHES are a function of
 * the probe, so judging those (the read gate's pre-scan, which runs the
 * caller's own filter) would refuse a matching probe and answer a non-matching
 * one with an empty list — the refusal itself would be the oracle. So:
 *
 *  - A query that names ONE parent object — an equality on `object_name` at the
 *    root of its `where`, directly or inside a root `$and` — reaches no other
 *    parent, and is judged against that object alone.
 *  - A query that names none is judged against the DECLARED set: every object
 *    registered in the engine ({@link declaredParentObjects}), read from
 *    metadata, never from rows, so it answers the same whatever the query and
 *    whatever rows arrive. It is the writers' reach and a superset of it: the
 *    CRUD mirror (`audit-writers.ts`) is registered on every object but its own
 *    exclusion list, and that list has grown over time, so rows about an
 *    object it now skips can still be at rest. The query is admitted only for
 *    a reader who is withheld no field of ANY of them.
 *
 * "Fields whose value the column can carry" is every field: a create or delete
 * snapshot records the whole stored record, and rows written before the mirror
 * began masking credential fields (#6656) are still at rest. So the
 * per-object question is the pinned query's own, asked of each object.
 *
 * Measured on a stock showcase boot with its seeded admin: that admin is served
 * every field of every registered object, so its unpinned search over these
 * objects — the Setup audit-log list's search — is admitted, at three security
 * calls per registered object per such query. A reader withheld any field
 * anywhere is refused an unpinned query, as before.
 *
 * ## Which clauses
 *
 * The clause set of the engine's predicate guard (plugin-security
 * `collectQueryFields`), restated here because this package does not depend
 * on that one: `where` and `having` (a condition key, and a cross-field
 * comparand — `FieldReferenceSchema`, the spec's own declaration of one),
 * `orderBy`, `groupBy` and `aggregations` (the field and its `filter`). A
 * free-text search reaches this guard as a `where`: the engine expands it into
 * a cross-field `$or` before any middleware runs, and these columns are in the
 * objects' searched set. The projection (`fields`) is not a predicate: what it
 * selects is the redaction's to narrow.
 *
 * ## The refusal
 *
 * `PERMISSION_DENIED` / 403 with the engine's words for the same role — the
 * aggregate refusal for a column a grouped read groups or aggregates by, the
 * predicate refusal otherwise — followed by one sentence naming this rule's
 * remedy. It names the columns the query named and nothing about the parent:
 * which parent fields a reader is not served is not this refusal's to say.
 *
 * On `sys_activity` the guard runs AHEAD of the read gate
 * (`activity-read-visibility.ts`), so a refused query never pays that gate's
 * pre-scan. System-context reads (the audit writer, the read gate's own
 * pre-scan) and context-less programmatic calls are not judged, as for the
 * read gate and the redaction.
 */

import { FieldReferenceSchema } from '@objectstack/spec/data';
import { resolveServedFields, type FieldRedactionLogger, type FieldVisibilitySource } from './served-fields.js';
import { parseActivityParentObject, type ActivityMiddlewareEngine } from './activity-read-visibility.js';

const SYSTEM_CTX = { isSystem: true } as const;
const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

/** Logical keys of the FilterCondition grammar — never field names. */
const LOGICAL_KEYS = new Set(['$and', '$or', '$not']);

/** One guarded object: its value-bearing columns and its refusal's remedy. */
export interface ParentFieldQueryGuard {
  /** The guarded object. */
  readonly object: string;
  /** Its columns that can carry a parent field value. */
  readonly columns: readonly string[];
  /** The sentence that follows the engine's words in a refusal. */
  readonly remedy: string;
}

const remedy = (what: string) =>
  ` ${what} carries field values of the record its row is about, so a query may filter, sort, search, group ` +
  'or aggregate by it only for a caller served every field of the objects it can reach: one parent object ' +
  'named by equality on object_name, or every object when it names none.';

/**
 * The activity stream: the columns the field redaction narrows (see its header
 * for what each one carries). `activity-predicate-guard.test.ts` pins this
 * list against the redaction's own fail-closed strip, so the two cannot name
 * different columns.
 */
export const ACTIVITY_QUERY_GUARD: ParentFieldQueryGuard = Object.freeze({
  object: 'sys_activity',
  columns: Object.freeze(['summary', 'record_label', 'metadata']),
  remedy: remedy('An activity column'),
});

/** The compliance ledger: the before/after snapshots the CRUD mirror writes. */
export const AUDIT_LOG_QUERY_GUARD: ParentFieldQueryGuard = Object.freeze({
  object: 'sys_audit_log',
  columns: Object.freeze(['old_value', 'new_value']),
  remedy: remedy('A ledger snapshot column'),
});

/** The value-bearing columns a query names, by the role it names them in. */
export interface NamedValueBearingColumns {
  /** Grouped by, or aggregated over (an aggregation's own field). */
  aggregate: string[];
  /** Filtered, searched or sorted by, or named by an aggregation's filter. */
  predicate: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const head = (path: string): string => path.split('.')[0];

function collectComparand(operand: unknown, out: Set<string>): void {
  if (!operand || typeof operand !== 'object') return;
  if (Array.isArray(operand)) {
    for (const member of operand) collectComparand(member, out);
    return;
  }
  const reference = FieldReferenceSchema.safeParse(operand);
  if (reference.success) out.add(head(reference.data.$field));
  for (const member of Object.values(operand as Record<string, unknown>)) collectComparand(member, out);
}

function collectCondition(condition: unknown, out: Set<string>): void {
  if (!isRecord(condition)) return;
  for (const [key, value] of Object.entries(condition)) {
    if (LOGICAL_KEYS.has(key)) {
      if (Array.isArray(value)) for (const sub of value) collectCondition(sub, out);
      else collectCondition(value, out);
      continue;
    }
    out.add(head(key));
    collectComparand(value, out);
  }
}

/** Every one of `columns` that `ast` names in a row-shaping clause, by role. */
export function namedValueBearingColumns(
  ast: Record<string, unknown>,
  columns: readonly string[],
): NamedValueBearingColumns {
  const aggregate = new Set<string>();
  const predicate = new Set<string>();
  collectCondition(ast.where, predicate);
  collectCondition(ast.having, predicate);
  if (Array.isArray(ast.orderBy)) {
    for (const sort of ast.orderBy) {
      const field = (sort as { field?: unknown } | null)?.field;
      if (typeof field === 'string') predicate.add(head(field));
    }
  }
  if (Array.isArray(ast.groupBy)) {
    for (const group of ast.groupBy) {
      const field = typeof group === 'string' ? group : (group as { field?: unknown } | null)?.field;
      if (typeof field === 'string') aggregate.add(head(field));
    }
  }
  if (Array.isArray(ast.aggregations)) {
    for (const agg of ast.aggregations) {
      const field = (agg as { field?: unknown } | null)?.field;
      if (typeof field === 'string' && field !== '*') aggregate.add(head(field));
      collectCondition((agg as { filter?: unknown } | null)?.filter, predicate);
    }
  }
  return {
    aggregate: columns.filter((c) => aggregate.has(c)),
    predicate: columns.filter((c) => predicate.has(c)),
  };
}

/**
 * The ONE parent object `where` pins on `guarded`, or `null` when it pins none.
 *
 * A pin is an equality on `object_name` — a plain value or `{ $eq }` — at the
 * root of the condition or inside a root `$and` (at any depth of `$and`), the
 * only positions where it constrains every row the query can match. Two pins
 * naming different objects pin none (the query can match no row, and nothing
 * here needs to say so); a constraint of any other shape on the column is not
 * a pin and does not cancel one. The object must be one the activity read gate
 * can authorize ({@link parseActivityParentObject}: a machine name, not the
 * activity stream) and not the guarded object itself.
 */
export function pinnedParentObject(where: unknown, guarded: string): string | null {
  const pins = new Set<unknown>();
  const walk = (condition: unknown) => {
    if (!isRecord(condition)) return;
    for (const [key, value] of Object.entries(condition)) {
      if (key === '$and' && Array.isArray(value)) {
        for (const sub of value) walk(sub);
      } else if (key === 'object_name') {
        if (typeof value === 'string') pins.add(value);
        else if (isRecord(value) && Object.keys(value).length === 1 && typeof value.$eq === 'string') pins.add(value.$eq);
      }
    }
  };
  walk(where);
  if (pins.size !== 1) return null;
  const parent = parseActivityParentObject({ object_name: [...pins][0] });
  return parent === guarded ? null : parent;
}

/**
 * Does the security answer for `context` withhold any field of `object`?
 *
 * The served set is the redaction's ({@link resolveServedFields}); `undefined`
 * from it is the serve seam's "narrow nothing", and answers `false`. The full
 * set is the security service's read projection as the system. When that
 * cannot be had, the answer is `true` — fail closed, as the redaction treats a
 * text of unknown provenance.
 */
export async function readerWithholdsParentField(
  security: FieldVisibilitySource,
  object: string,
  context: unknown,
  logger?: FieldRedactionLogger,
): Promise<boolean> {
  const served = await resolveServedFields(security, object, context, logger);
  if (served === undefined) return false;
  let all: string[] | undefined;
  try {
    all = await security.getReadableFields(object, SYSTEM_CTX as never);
  } catch {
    all = undefined;
  }
  if (!Array.isArray(all)) return true;
  const servedSet = new Set(served.map(String));
  return all.some((field) => !servedSet.has(String(field)));
}

/** The engine slice the declared set is read from: its object registry. */
export interface ParentObjectRegistryEngine extends ActivityMiddlewareEngine {
  registry?: { getAllObjects?(): ReadonlyArray<{ name?: unknown }> };
}

/**
 * The DECLARED parent set: every object registered in the engine, read from
 * metadata — never from rows — or `null` when the engine cannot say, which
 * the caller treats as a refusal (fail closed).
 */
export function declaredParentObjects(engine: ParentObjectRegistryEngine): string[] | null {
  let all: ReadonlyArray<{ name?: unknown }> | undefined;
  try {
    all = engine.registry?.getAllObjects?.();
  } catch {
    all = undefined;
  }
  if (!Array.isArray(all)) return null;
  const names = [...new Set(all.map((o) => String(o?.name ?? '').trim()).filter(Boolean))];
  return names.length > 0 ? names : null;
}

/**
 * Is `context` withheld a field of ANY object of the declared set? `true` too
 * when the engine cannot say which objects are registered. One per-object
 * question, the pinned query's own ({@link readerWithholdsParentField}), asked
 * in turn and stopped at the first object that withholds.
 */
export async function readerWithholdsAnyDeclaredParentField(
  engine: ParentObjectRegistryEngine,
  security: FieldVisibilitySource,
  context: unknown,
  logger?: FieldRedactionLogger,
): Promise<boolean> {
  const declared = declaredParentObjects(engine);
  if (declared === null) return true;
  for (const object of declared) {
    if (await readerWithholdsParentField(security, object, context, logger)) return true;
  }
  return false;
}

/** The refusal's shape — the engine's `PermissionDeniedError` envelope. */
export type ParentFieldQueryRefusal = Error & {
  code: 'PERMISSION_DENIED';
  status: 403;
  statusCode: 403;
  object: string;
  fields: string[];
  details: { object: string; fields: string[]; reason: string };
};

/**
 * The refusal for a query on `guard.object` naming `named`, in the engine's
 * words for the same role: a grouped read that groups or aggregates by a
 * value-bearing column meets the aggregate refusal first, as the engine orders
 * its two guards.
 */
export function parentFieldQueryRefusal(
  guard: ParentFieldQueryGuard,
  operation: string,
  named: NamedValueBearingColumns,
): ParentFieldQueryRefusal {
  const aggregateRole = operation === 'aggregate' && named.aggregate.length > 0;
  const fields = aggregateRole ? named.aggregate : [...new Set([...named.predicate, ...named.aggregate])];
  const message = aggregateRole
    ? `[Security] Field read denied: not permitted to aggregate [${fields.join(', ')}] on '${guard.object}'.${guard.remedy}`
    : `[Security] Access denied: query on '${guard.object}' references field(s) not readable by the caller: ` +
      `${fields.join(', ')}. Filtering, sorting, grouping, or aggregating by a hidden field ` +
      `would leak its values (filter oracle) — remove these predicates or grant field read access.${guard.remedy}`;
  const err = new Error(message) as ParentFieldQueryRefusal;
  err.name = 'PermissionDeniedError';
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  err.statusCode = 403;
  err.object = guard.object;
  err.fields = [...fields];
  err.details = { object: guard.object, fields: [...fields], reason: 'field_predicate_denied' };
  return err;
}

/** Register the query guard for one object. */
function installParentFieldQueryGuard(
  engine: ParentObjectRegistryEngine,
  guard: ParentFieldQueryGuard,
  getSecurity: () => FieldVisibilitySource | undefined,
  logger: FieldRedactionLogger,
): void {
  engine.registerMiddleware!(
    async (ctx, next) => {
      if (!READ_OPS.has(ctx.operation) || !ctx.ast || !ctx.context || ctx.context.isSystem) {
        return next();
      }
      const named = namedValueBearingColumns(ctx.ast, guard.columns);
      if (named.aggregate.length === 0 && named.predicate.length === 0) return next();
      // No security service: the redaction serves every value whole, so a
      // predicate over it discloses nothing the rows do not.
      const security = getSecurity();
      if (!security) return next();
      const parent = pinnedParentObject(ctx.ast.where, guard.object);
      let refuse = true;
      try {
        if (parent !== null) {
          refuse = await readerWithholdsParentField(security, parent, ctx.context, logger);
        } else {
          refuse = await readerWithholdsAnyDeclaredParentField(engine, security, ctx.context, logger);
        }
      } catch (err) {
        logger.warn(
          `[audit] ${guard.object} query guard: could not tell whether the caller is served every field of ` +
            `${parent !== null ? `'${parent}'` : 'every registered object'} — refusing the query (fail closed): ` +
            `${(err as Error)?.message ?? err}`,
        );
        refuse = true;
      }
      if (refuse) throw parentFieldQueryRefusal(guard, ctx.operation, named);
      return next();
    },
    { object: guard.object },
  );
}

/**
 * Install the query guard on the activity stream and on the compliance ledger.
 * `getSecurity` is resolved on every read, as for the redaction: the security
 * plugin may register after this one. Inert on an engine without the middleware
 * seam; `AuditPlugin` says so.
 */
export function installParentFieldQueryGuards(
  engine: ParentObjectRegistryEngine,
  getSecurity: () => FieldVisibilitySource | undefined,
  logger: FieldRedactionLogger,
): void {
  if (typeof engine.registerMiddleware !== 'function') return;
  for (const guard of [ACTIVITY_QUERY_GUARD, AUDIT_LOG_QUERY_GUARD]) {
    installParentFieldQueryGuard(engine, guard, getSecurity, logger);
  }
}
