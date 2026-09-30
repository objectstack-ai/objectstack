// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The FIELD-LEVEL read admission this service asks BEFORE it selects a
 * strategy — the sibling of the object-level gate in `read-admission.ts`, and
 * the layer below it.
 *
 * ## Why the door, and not a strategy
 *
 * `engine.find` and `engine.aggregate` refuse a query that groups, aggregates,
 * filters or sorts by a field the caller's field-level permissions hide: a
 * hidden field is never a predicate or a group key, because row presence and
 * group keys disclose its values even when the column itself is masked out of
 * the result. `ObjectQLStrategy` inherits that refusal from the engine.
 * `NativeSQLStrategy` compiles its own statement and runs it through the
 * driver's raw `execute()`, which no middleware sits in front of, so it holds
 * no field permissions at all and answered those queries.
 *
 * Teaching one strategy to refuse would leave the next strategy to learn it
 * again. The question is therefore asked HERE, once, over every member the
 * query names, ahead of the strategy chain: every strategy — and the SQL echo,
 * which shares the admission step — inherits the verdict by construction.
 *
 * ## One permission rule, the security service's
 *
 * This module holds no permission rule. Which fields a caller may read is the
 * host's answer ({@link ReadableFieldsProvider}); the plugin bridges it to the
 * `security` service's `getReadableFields`, the reader computed from the same
 * permission-set resolution, field map and `requiredPermissions` fold the
 * engine middleware enforces with. What this module adds is only what the
 * analytics layer alone knows: which (object, field) each member of a cube
 * query reads.
 *
 * ## The engine's words
 *
 * A refused member answers what the engine answers for the same field, word
 * for word, so a caller sees one refusal whichever strategy would have served
 * the cube: the aggregate refusal for a member the query groups or aggregates,
 * the predicate refusal for a member it filters or sorts by. When a query
 * names hidden fields in both roles on one object, the aggregate refusal
 * speaks first — the engine's own order on an aggregate.
 *
 * ## Fail direction
 *
 * - The provider THROWS → the query is refused (fail-closed) and the failure is
 *   logged at `error`.
 * - The provider answers `undefined` for an object → the reader has no field
 *   answer for it (its contract's "no answer"), and no field of that object is
 *   judged: an object the security service cannot resolve is one the engine
 *   serves nothing from either. The object-level gate and the row scope still
 *   apply.
 * - No provider wired → no field-level gate. That is a deployment with no
 *   security service, where `/data` has no field-level security either.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { StandardErrorCode } from '@objectstack/spec/api';

/**
 * `PERMISSION_DENIED`, pinned against the STANDARD catalog — the code and the
 * 403 the engine answers for the same field.
 */
const PERMISSION_DENIED: StandardErrorCode = 'PERMISSION_DENIED';

/**
 * The fields `context` may READ on `objectName` — the host's answer, the
 * `security` service's `getReadableFields` in the shipped composition.
 *
 * MAY be async. `undefined` is "no answer for this object" (see the module
 * header); an array is the answer, `[]` included. A throw refuses the query.
 */
export type ReadableFieldsProvider = (
  objectName: string,
  context?: ExecutionContext,
) => readonly string[] | undefined | Promise<readonly string[] | undefined>;

/**
 * How a query uses a field, which decides the engine's words for it.
 *
 * - `aggregate` — grouped by or aggregated over (a dimension, a bucketed time
 *   dimension, a measure's field).
 * - `predicate` — filtered or sorted by (a `where` member, a time dimension's
 *   window, a dataset's or a measure's own filter, an order key).
 */
export type FieldReadRole = 'aggregate' | 'predicate';

/** One field a query reads, on the object that declares it. */
export interface NamedField {
  readonly object: string;
  readonly field: string;
  readonly role: FieldReadRole;
}

/** Log sink — the subset of `Logger` this module uses (see `read-admission.ts`). */
interface AdmissionLogger {
  error?(message: string, error?: Error): void;
  warn(message: string): void;
}

type FieldRefusal = Error & { code?: string; status?: number; object?: string; fields?: string[] };

/**
 * The refusal, in the ADR-0112 envelope — `PERMISSION_DENIED` / 403 — and in
 * the words the engine uses for the same field in the same role.
 *
 * `object` is the object that declares the fields and `fields` the fields
 * refused, each the field the member resolved to: the names the engine's
 * refusal carries for the same query.
 */
export function fieldReadDeniedError(object: string, fields: readonly string[], role: FieldReadRole): Error {
  const message = role === 'aggregate'
    ? `[Security] Field read denied: not permitted to aggregate [${fields.join(', ')}] on '${object}'`
    : `[Security] Access denied: query on '${object}' references field(s) not readable by the caller: `
      + `${fields.join(', ')}. Filtering, sorting, grouping, or aggregating by a hidden field `
      + `would leak its values (filter oracle) — remove these predicates or grant field read access.`;
  const err = new Error(message) as FieldRefusal;
  err.code = PERMISSION_DENIED;
  err.status = 403;
  err.object = object;
  err.fields = [...fields];
  return err;
}

/**
 * The fail-closed refusal: the reader could not answer for `object`. Names the
 * object and nothing else — the cause is the operator's, logged at the site.
 */
function fieldReadUnresolvedError(object: string): Error {
  const err = new Error(
    `[Analytics] Access denied: the field-level read permissions for "${object}" could not be resolved, ` +
      'so the query was not run.',
  ) as FieldRefusal;
  err.code = PERMISSION_DENIED;
  err.status = 403;
  err.object = object;
  return err;
}

/**
 * Refuse the query unless the caller may read every field it names.
 *
 * @param named - Every field the query reads, in the order the query names
 *   them. The objects are judged in their first-named order, so the base
 *   object — named first by the caller's collector — speaks before a joined
 *   one, as it does on the engine path.
 * @param knownFields - The object's declared fields, or `undefined` when no
 *   list is available. A name the list does not carry is not a field of the
 *   object (a relationship path segment that names none, a system column the
 *   registry adds), and the reader's list, which is built from fields, could
 *   never contain it — so only listed names are judged. With no list, every
 *   name is judged against the reader's answer.
 */
export async function assertNamedFieldsReadable(
  named: readonly NamedField[],
  provider: ReadableFieldsProvider,
  context: ExecutionContext | undefined,
  knownFields: (object: string) => readonly string[] | undefined,
  logger?: AdmissionLogger,
): Promise<void> {
  const byObject = new Map<string, NamedField[]>();
  for (const f of named) {
    const list = byObject.get(f.object);
    if (list) list.push(f);
    else byObject.set(f.object, [f]);
  }

  for (const [object, fields] of byObject) {
    let readable: readonly string[] | undefined;
    try {
      readable = await provider(object, context);
    } catch (e) {
      // Fail CLOSED: a reader that could not answer must not be read as
      // "every field readable".
      const cause = e instanceof Error ? e : new Error(String(e));
      const report =
        `[Analytics] field-level read admission could not be resolved for object "${object}" — ` +
        `denying query (fail-closed): ${cause.message}`;
      if (logger?.error) logger.error(report, cause);
      else logger?.warn(report);
      throw fieldReadUnresolvedError(object);
    }
    if (readable === undefined) continue;

    const known = knownFields(object);
    const knownSet = known ? new Set(known) : undefined;
    const readableSet = new Set(readable);
    const hidden = (f: NamedField) =>
      (!knownSet || knownSet.has(f.field)) && !readableSet.has(f.field);

    for (const role of ['aggregate', 'predicate'] as const) {
      const refused = [...new Set(fields.filter((f) => f.role === role && hidden(f)).map((f) => f.field))];
      if (refused.length === 0) continue;
      logger?.warn(
        `[Analytics] field-level read admission denied ${refused.join(', ')} on "${object}" ` +
          `(user ${String((context as { userId?: unknown } | undefined)?.userId ?? 'unknown')}) — ` +
          `the verdict the engine reaches for the same fields`,
      );
      throw fieldReadDeniedError(object, refused, role);
    }
  }
}
