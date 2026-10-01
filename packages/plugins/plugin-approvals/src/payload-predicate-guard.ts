// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21154] Query guard for the approval snapshot on the GENERIC data door: a
 * non-system reader may filter, sort, search, group or aggregate by
 * `payload_json` only when it is served every field of the objects the query
 * can reach: the ONE subject object the query names, or, when it names none,
 * every registered object. Any other such query is refused, in the engine's
 * own refusal shape.
 *
 * ## The defect this closes
 *
 * The generic-door redaction (`payload-redaction-middleware.ts`, #10749 /
 * #20964) rewrites `payload_json` on the rows a read hands back, after the
 * driver has answered. A predicate over the column is evaluated at rest,
 * before that: row presence answers whether the stored snapshot contains a
 * value the reader is served masked or not at all, one guess at a time, and a
 * group key over the column hands the stored snapshot back as the key. The
 * service door's free-text arm closed the same class for its own filter
 * (`freeTextMayMatchSnapshot`, #11040); this is the generic door's half.
 *
 * ## The rule — the audit plugin's, applied to the snapshot
 *
 * The same rule `plugin-audit` applies to the activity stream's value-bearing
 * columns and the compliance ledger's snapshots (`parent-field-query-guard.ts`,
 * triage ruling on #21154, option A):
 *
 *  - no security service wired → unchanged: the redaction serves every
 *    snapshot whole, so a predicate over it discloses nothing the rows do not;
 *  - otherwise the query must pin ONE subject object — an equality on
 *    `object_name` at the root of its `where`, directly or inside a root
 *    `$and` — and the reader must be served every field of it. "Served" is the
 *    redaction's own answer ({@link resolveReadableSnapshotFields}, asked as
 *    the reader); "every field" is the security service's read projection as
 *    the system. An `undefined` from the serve seam is its "narrow nothing",
 *    and passes.
 *
 * A query that pins no subject object is judged against the DECLARED set —
 * every object registered in the engine, read from metadata and never from
 * rows ({@link declaredSubjectObjects}) — because the subject is a property of
 * each row and the set judged must not depend on the query: the subjects of
 * the rows it MATCHES would make the refusal itself the oracle. The snapshot
 * writer can record a request on any object (the service's submit takes one),
 * and records the record as it was handed over, so every field of every
 * registered object counts. The query is admitted only for a reader withheld
 * no field of any of them; measured on a stock showcase boot, its seeded admin
 * is such a reader.
 *
 * ## Which clauses
 *
 * The engine predicate guard's clause set (plugin-security
 * `collectQueryFields`), restated because this package does not depend on
 * that one: `where` and `having` (a key, and a cross-field comparand —
 * `FieldReferenceSchema`), `orderBy`, `groupBy` and `aggregations` (the field
 * and its `filter`). The projection is not a predicate.
 *
 * ## The refusal
 *
 * `PERMISSION_DENIED` / 403 in the engine's words for the role — the aggregate
 * refusal for a grouped read that groups or aggregates by the column, the
 * predicate refusal otherwise — followed by one sentence naming the remedy.
 * It names the snapshot column and nothing about the subject's fields.
 *
 * System-context reads (the approval engine's own) and context-less
 * programmatic calls are not judged, as for the redaction.
 */

import { FieldReferenceSchema } from '@objectstack/spec/data';
import { resolveReadableSnapshotFields, type FieldVisibilitySource } from './payload-redaction.js';
import { APPROVAL_REQUEST_OBJECT, type MiddlewareEngine } from './payload-redaction-middleware.js';

const SNAPSHOT_COLUMN = 'payload_json';
const SYSTEM_CTX = { isSystem: true } as const;
const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);
const LOGICAL_KEYS = new Set(['$and', '$or', '$not']);

/** The snapshot column a query names, by the role it names it in. */
export interface NamedSnapshotColumn {
  aggregate: boolean;
  predicate: boolean;
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

/** Whether `ast` names the snapshot column in a row-shaping clause, by role. */
export function namedSnapshotColumn(ast: Record<string, unknown>): NamedSnapshotColumn {
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
  return { aggregate: aggregate.has(SNAPSHOT_COLUMN), predicate: predicate.has(SNAPSHOT_COLUMN) };
}

/**
 * The ONE subject object `where` pins — an equality on `object_name`, plain or
 * `{ $eq }`, at the root or inside a root `$and` — or `null` when it pins none
 * (or two different ones).
 */
export function pinnedSubjectObject(where: unknown): string | null {
  const pins = new Set<string>();
  const walk = (condition: unknown) => {
    if (!isRecord(condition)) return;
    for (const [key, value] of Object.entries(condition)) {
      if (key === '$and' && Array.isArray(value)) {
        for (const sub of value) walk(sub);
      } else if (key === 'object_name') {
        if (typeof value === 'string') pins.add(value.trim());
        else if (isRecord(value) && Object.keys(value).length === 1 && typeof value.$eq === 'string') pins.add(value.$eq.trim());
      }
    }
  };
  walk(where);
  if (pins.size !== 1) return null;
  const object = [...pins][0];
  return object ? object : null;
}

/**
 * Does the redaction serve `context` fewer fields of `object` than the
 * security service reads as the system? `undefined` from the serve seam is
 * "narrow nothing" and answers `false`; no full answer answers `true`.
 */
export async function readerWithholdsSubjectField(
  security: FieldVisibilitySource,
  object: string,
  context: unknown,
  logger?: { warn?: (msg: string, meta?: Record<string, any>) => void },
): Promise<boolean> {
  const served = await resolveReadableSnapshotFields(security, object, context, logger);
  if (served === undefined) return false;
  let all: string[] | undefined;
  try {
    all = await security.getReadableFields(object, SYSTEM_CTX);
  } catch {
    all = undefined;
  }
  if (!Array.isArray(all)) return true;
  const servedSet = new Set(served.map(String));
  return all.some((field) => !servedSet.has(String(field)));
}

/** The engine slice the declared set is read from: its object registry. */
export interface SubjectObjectRegistryEngine extends MiddlewareEngine {
  registry?: { getAllObjects?(): ReadonlyArray<{ name?: unknown }> };
}

/**
 * The DECLARED subject set: every object registered in the engine, read from
 * metadata — never from rows — or `null` when the engine cannot say, which the
 * caller treats as a refusal (fail closed).
 */
export function declaredSubjectObjects(engine: SubjectObjectRegistryEngine): string[] | null {
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
 * when the engine cannot say which objects are registered. The pinned query's
 * own per-object question ({@link readerWithholdsSubjectField}), asked in turn
 * and stopped at the first object that withholds.
 */
export async function readerWithholdsAnyDeclaredSubjectField(
  engine: SubjectObjectRegistryEngine,
  security: FieldVisibilitySource,
  context: unknown,
  logger?: { warn?: (msg: string, meta?: Record<string, any>) => void },
): Promise<boolean> {
  const declared = declaredSubjectObjects(engine);
  if (declared === null) return true;
  for (const object of declared) {
    if (await readerWithholdsSubjectField(security, object, context, logger)) return true;
  }
  return false;
}

/** The refusal's shape — the engine's `PermissionDeniedError` envelope. */
export type SnapshotQueryRefusal = Error & {
  code: 'PERMISSION_DENIED';
  status: 403;
  statusCode: 403;
  object: string;
  fields: string[];
  details: { object: string; fields: string[]; reason: string };
};

const REMEDY =
  ' The snapshot carries field values of the record under approval, so a query may filter, sort, search, ' +
  'group or aggregate by it only for a caller served every field of the objects it can reach: one subject ' +
  'object named by equality on object_name, or every object when it names none.';

/** The refusal, in the engine's words for the role the column is named in. */
export function snapshotQueryRefusal(operation: string, named: NamedSnapshotColumn): SnapshotQueryRefusal {
  const object = APPROVAL_REQUEST_OBJECT;
  const fields = [SNAPSHOT_COLUMN];
  const message = operation === 'aggregate' && named.aggregate
    ? `[Security] Field read denied: not permitted to aggregate [${SNAPSHOT_COLUMN}] on '${object}'.${REMEDY}`
    : `[Security] Access denied: query on '${object}' references field(s) not readable by the caller: ` +
      `${SNAPSHOT_COLUMN}. Filtering, sorting, grouping, or aggregating by a hidden field ` +
      `would leak its values (filter oracle) — remove these predicates or grant field read access.${REMEDY}`;
  const err = new Error(message) as SnapshotQueryRefusal;
  err.name = 'PermissionDeniedError';
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  err.statusCode = 403;
  err.object = object;
  err.fields = fields;
  err.details = { object, fields: [...fields], reason: 'field_predicate_denied' };
  return err;
}

/**
 * Register the snapshot query guard. `getSecurity` is resolved on every read,
 * as for the redaction: the security plugin may register after this one.
 */
export function bindSnapshotPredicateGuard(
  engine: SubjectObjectRegistryEngine,
  getSecurity: () => FieldVisibilitySource | undefined,
  logger?: { warn?: (msg: string, meta?: Record<string, any>) => void },
): void {
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    const ast = opCtx?.ast as Record<string, unknown> | undefined;
    const context = opCtx?.context as { isSystem?: boolean } | undefined;
    if (!READ_OPS.has(opCtx?.operation) || !ast || !context || context.isSystem) return next();
    const named = namedSnapshotColumn(ast);
    if (!named.aggregate && !named.predicate) return next();
    const security = getSecurity();
    if (!security || typeof security.getReadableFields !== 'function') return next();
    const subject = pinnedSubjectObject(ast.where);
    let refuse = true;
    try {
      if (subject !== null) {
        refuse = await readerWithholdsSubjectField(security, subject, context, logger);
      } else {
        refuse = await readerWithholdsAnyDeclaredSubjectField(engine, security, context, logger);
      }
    } catch (err: any) {
      logger?.warn?.('[approvals] snapshot query guard could not tell whether the caller is served every field — refusing the query (fail closed)', {
        object: subject ?? '(every registered object)', error: err?.message ?? String(err),
      });
      refuse = true;
    }
    if (refuse) throw snapshotQueryRefusal(opCtx.operation, named);
    return next();
  }, { object: APPROVAL_REQUEST_OBJECT });
}
