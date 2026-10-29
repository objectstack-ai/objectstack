// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27008] An empty projection — `fields: []` — is refused by the engine's
 * `find` and `findOne` with `VALIDATION_ERROR` / 400, before any driver is
 * asked. So is an empty projection on an `expand` entry, at any depth.
 *
 * ## One rule
 *
 * #26817, #26909 and #26954 settled it: an empty projection is refused, never
 * read as every column. The HTTP doors refuse `select: []`
 * (`projectionFieldsValue` in `@objectstack/metadata-protocol`, `400
 * VALIDATION_ERROR`), and every published declaration of a read's projection
 * refuses it too, `EngineQueryOptionsSchema.fields` included. The engine never
 * parses its options with that schema, and its projection guards ran only when
 * `ast.fields.length > 0`, so `fields: []` reached the driver. Every driver
 * serves an empty projection as none: a plugin, a hook through `ctx.api` or a
 * flow that built an empty list by mistake got owner, organization and audit
 * columns back, and was not told. Measured on `origin/main` `07d18e69` with
 * `engine.find(obj, { fields: [] })`, `findOne` and an
 * `expand: { rel: { fields: [] } }` entry: every column, under no error.
 *
 * ## Same refusal as the doors
 *
 * The words are the declaration's own, read off the published
 * `EngineQueryOptionsSchema.fields` rather than copied, and the error carries
 * the status and code the door's does, so `mapDataError` answers an
 * in-process caller and a REST caller with the same `400 VALIDATION_ERROR`.
 * The rule is about the shape, not the caller: a system-context read is
 * refused too. An absent (or `null`) `fields` still means every column.
 *
 * ## Why `expand` is judged at the entry
 *
 * An `expand` entry's projection is forwarded to the related object's own
 * `find`, so that sub-read would refuse it — but `expandRelatedRecords` keeps
 * the bare foreign key when a sub-read throws, so the refusal would reach the
 * caller as a silently unexpanded field. Judged here, before the parent read,
 * it reaches the caller as a refusal.
 *
 * ## A projection emptied by the unknown-column tolerance
 *
 * [#27165] `find` / `findOne` drop a requested plain column the object does not
 * have (the #7589 tolerance). When that leaves nothing, the projection is
 * empty, and it gets this same refusal, naming what was asked for. Before, the
 * engine fell back to every column there, so `fields: ['nope']` answered wider
 * than any named projection. A mix of known and unknown columns keeps the
 * tolerance. An `expand` entry needs no judgement of its own here: its
 * sub-read always names `id`, which is never dropped.
 */

import { EngineQueryOptionsSchema } from '@objectstack/spec/data';

let declaredRefusal: string | undefined;

/** The declaration's own words for a projection naming no field. */
function projectionNamesNoField(): string | undefined {
  declaredRefusal ??= EngineQueryOptionsSchema.shape.fields.safeParse([]).error?.issues[0]?.message;
  return declaredRefusal;
}

function refuseEmptyProjection(
  object: string,
  operation: 'find' | 'findOne',
  param: string,
  requested: readonly unknown[] = [],
): never {
  const dropped = requested.length > 0
    ? `, and none of them is a field of '${object}' (an unknown column is dropped from a projection)`
    : '';
  const err: any = new Error(
    `ObjectQL.${operation}('${object}') names no field in ${param}: got ${JSON.stringify(requested)}${dropped}. The query was not run: `
    + 'an empty projection was read as no projection, which answers every column. '
    + `${projectionNamesNoField()}, or leave the projection out to read every column.`,
  );
  // The status and code `projectionFieldsValue` throws at the HTTP doors, so
  // a host surfacing engine errors answers the same envelope on both.
  err.status = 400;
  err.code = 'VALIDATION_ERROR';
  err.param = param;
  err.object = object;
  throw err;
}

function assertExpandProjections(
  object: string,
  operation: 'find' | 'findOne',
  expand: unknown,
  prefix: string,
): void {
  if (expand == null || typeof expand !== 'object') return;
  for (const [relation, nested] of Object.entries(expand)) {
    if (nested == null || typeof nested !== 'object') continue;
    const at = `${prefix}expand['${relation}']`;
    const fields = (nested as { fields?: unknown }).fields;
    if (Array.isArray(fields) && fields.length === 0) refuseEmptyProjection(object, operation, `${at}.fields`);
    assertExpandProjections(object, operation, (nested as { expand?: unknown }).expand, `${at}.`);
  }
}

/**
 * Refuse a read whose projection, or any `expand` entry's projection, names
 * no field. Runs at the entry of `find` / `findOne`, after the option-key
 * gate, before any driver call.
 */
export function assertProjectionNamesAField(
  object: string,
  operation: 'find' | 'findOne',
  query: { fields?: unknown; expand?: unknown } | undefined,
): void {
  if (!query) return;
  if (Array.isArray(query.fields) && query.fields.length === 0) refuseEmptyProjection(object, operation, "'fields'");
  assertExpandProjections(object, operation, query.expand, '');
}

/**
 * [#27165] Refuse a projection the unknown-column tolerance emptied: every
 * entry of `requested` named a column `object` does not have. Same refusal as
 * `fields: []`, naming what was asked for.
 */
export function refuseProjectionOfUnknownColumns(
  object: string,
  operation: 'find' | 'findOne',
  requested: readonly unknown[],
): never {
  return refuseEmptyProjection(object, operation, "'fields'", requested);
}
