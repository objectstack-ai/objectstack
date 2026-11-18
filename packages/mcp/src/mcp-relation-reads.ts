// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35145] The two related-object reads of the open MCP door, judged before
 * anything is read:
 *
 * - `query_records`' `expand`: forward reference fields of the queried object,
 *   each answered with the record it names, through the engine's one expansion
 *   path (one batched `id IN (...)` read per field, under the TARGET's own
 *   permissions, row and field security);
 * - `get_record`'s `related`: child objects that point at the record, each one
 *   capped list read as `query_records` reads it, filtered by the parent link.
 *
 * ⭐ THE RULE: every object a new read shape reaches is judged by the MCP read
 * guard exactly as the object the call names is. A target the guard refuses
 * refuses the WHOLE call, with a coded `PERMISSION_DENIED`, before any record
 * is read — never a silently smaller answer.
 *
 * Both reads are bounded by constants here, and both judge relations against
 * the object definition AS THE CALLER IS SERVED IT
 * (`McpDataBridge.servedObjectDefinitionOf`): a field the caller may not read
 * is not in it, so it can be neither expanded nor used as a parent link. A
 * bridge that cannot serve that definition refuses both reads (fail closed).
 *
 * What a reference field points at is the spec's one arbiter
 * (`referenceTargetOf`, over `REFERENCE_VALUE_TYPES`): the judgement the
 * engine's expansion and the record page's related lists ask too.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { REFERENCE_VALUE_TYPES, isMultiValueField, referenceTargetOf } from '@objectstack/spec/data';
import type { McpDataBridge } from './mcp-http-tools.js';

/** The most reference fields one `query_records` call may expand (one level each). */
export const QUERY_EXPAND_MAX_FIELDS = 3;

/** The most related lists one `get_record` call may read. */
export const GET_RECORD_MAX_RELATED_LISTS = 3;

/**
 * The most rows one related list serves (and its default), held at or below
 * the door's own `maxQueryLimit`. A list with more children answers
 * `truncated: true`, as a capped `query_records` page does.
 */
export const RELATED_LIST_MAX_ROWS = 20;

/** The MCP door's read guard: `undefined` admits the object, a sentence refuses it. */
export type McpReadGuard = (objectName: string) => Promise<string | undefined>;

/** One `related` entry as the caller sends it. */
export interface RelatedListRequest {
  object: string;
  field?: string;
  fields?: string[];
  orderBy?: Array<{ field: string; order: 'asc' | 'desc' }>;
  limit?: number;
}

/** One related list, judged: the child object, its link field and how the parent id is matched. */
export interface RelatedListPlan {
  object: string;
  field: string;
  /** The link field holds an array of ids (`multiple: true`): matched with `$contains`. */
  multiValue: boolean;
  fields?: string[];
  orderBy?: Array<{ field: string; order: 'asc' | 'desc' }>;
  limit: number;
}

type Refusal = Error & { code: string; status: number; object?: string; field?: string; param?: string };

function refusal(
  code: string,
  status: number,
  message: string,
  extra: { object?: string; field?: string; param?: string } = {},
): Refusal {
  const err = new Error(message) as Refusal;
  err.code = code;
  err.status = status;
  Object.assign(err, extra);
  return err;
}

/**
 * The fields of `objectName` as this caller is served them, or a refusal: no
 * definition member on the bridge (`NOT_IMPLEMENTED`), no such object served
 * (`OBJECT_NOT_FOUND`). Unlike the annotation reads, this read DECIDES the
 * request, so it never degrades to "no fields".
 */
async function servedFieldMap(
  bridge: McpDataBridge,
  objectName: string,
  param: string,
): Promise<Record<string, Record<string, unknown>>> {
  if (typeof bridge.servedObjectDefinitionOf !== 'function') {
    throw refusal(
      StandardErrorCode.enum.NOT_IMPLEMENTED,
      501,
      `'${param}' needs the object definitions this host's data bridge does not serve, so nothing was read. `
        + 'Read the related records with their own query_records call.',
      { object: objectName, param },
    );
  }
  const def = await bridge.servedObjectDefinitionOf(objectName);
  if (!def) {
    throw refusal(
      StandardErrorCode.enum.OBJECT_NOT_FOUND,
      404,
      `Object '${objectName}' named in '${param}' is not served to you, so nothing was read.`,
      { object: objectName, param },
    );
  }
  const raw = def.fields;
  const out: Record<string, Record<string, unknown>> = {};
  if (Array.isArray(raw)) {
    for (const f of raw) {
      if (f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string') {
        out[(f as { name: string }).name] = f as Record<string, unknown>;
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [name, f] of Object.entries(raw as Record<string, unknown>)) {
      if (f && typeof f === 'object') out[name] = f as Record<string, unknown>;
    }
  }
  return out;
}

/** The object a reference field points at, or `undefined` for any other field. */
function targetOf(def: Record<string, unknown> | undefined): string | undefined {
  if (!def || typeof def.type !== 'string' || !REFERENCE_VALUE_TYPES.has(def.type)) return undefined;
  try {
    return referenceTargetOf(def);
  } catch {
    // A carrier no reader can read is no relationship.
    return undefined;
  }
}

/** The guard's verdict on a target, as the whole call's coded refusal. */
async function judgeTarget(
  readGuard: McpReadGuard,
  target: string,
  reachedBy: string,
): Promise<void> {
  const bad = await readGuard(target);
  if (bad === undefined) return;
  throw refusal(
    StandardErrorCode.enum.PERMISSION_DENIED,
    403,
    `${reachedBy} reaches object '${target}', which this door does not serve you: ${bad}. `
      + 'Nothing was read. Remove it from the request.',
    { object: target },
  );
}

/**
 * Judge `query_records`' `expand` on `objectName`: each name is a reference
 * field of the object as the caller is served it (one level, no dotted path),
 * and the object it points at passes the read guard. Answers the names to
 * expand, de-duplicated; throws the coded refusal otherwise.
 */
export async function judgeQueryExpand(
  bridge: McpDataBridge,
  readGuard: McpReadGuard,
  objectName: string,
  names: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(names)];
  const fields = await servedFieldMap(bridge, objectName, 'expand');
  const targets: Array<[string, string]> = [];
  for (const name of unique) {
    const def = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined;
    const target = targetOf(def);
    if (!target) {
      throw refusal(
        StandardErrorCode.enum.INVALID_FIELD,
        400,
        def === undefined
          ? `Unknown field '${name}' in 'expand' on object '${objectName}'. 'expand' takes the object's own `
            + 'lookup, master-detail, user or tree fields, one level deep. Nothing was read.'
          : `Field '${name}' in 'expand' on object '${objectName}' is not a relationship: only lookup, `
            + 'master-detail, user or tree fields can be expanded. Nothing was read.',
        { object: objectName, field: name, param: 'expand' },
      );
    }
    targets.push([name, target]);
  }
  for (const [name, target] of targets) await judgeTarget(readGuard, target, `'expand' field '${name}'`);
  return unique;
}

/**
 * Judge `get_record`'s `related` on the parent `objectName`: each child object
 * passes the read guard FIRST (nothing about a refused object is read, its
 * definition included), then its link field is a reference field of the child,
 * as the caller is served it, that points at the parent. A request that names
 * no `field` takes the child's one such field; none, or several, is refused
 * with the candidates named.
 */
export async function judgeRelatedLists(
  bridge: McpDataBridge,
  readGuard: McpReadGuard,
  objectName: string,
  entries: readonly RelatedListRequest[],
  maxRows: number,
): Promise<RelatedListPlan[]> {
  for (const entry of entries) await judgeTarget(readGuard, entry.object, `'related' list '${entry.object}'`);
  const plans: RelatedListPlan[] = [];
  for (const entry of entries) {
    const fields = await servedFieldMap(bridge, entry.object, 'related');
    let field = entry.field;
    if (field === undefined) {
      const links = Object.keys(fields).filter((name) => targetOf(fields[name]) === objectName);
      if (links.length !== 1) {
        throw refusal(
          StandardErrorCode.enum.INVALID_FIELD,
          400,
          links.length === 0
            ? `Object '${entry.object}' has no field you can read that points at '${objectName}', so it has no `
              + `related list there. Nothing was read.`
            : `Object '${entry.object}' points at '${objectName}' through several fields (${links.join(', ')}): `
              + `name the one to follow with 'field'. Nothing was read.`,
          { object: entry.object, param: 'related' },
        );
      }
      field = links[0];
    } else {
      const def = Object.prototype.hasOwnProperty.call(fields, field) ? fields[field] : undefined;
      if (targetOf(def) !== objectName) {
        throw refusal(
          StandardErrorCode.enum.INVALID_FIELD,
          400,
          `'${field}' on '${entry.object}' is not a lookup, master-detail, user or tree field that points at `
            + `'${objectName}'. Nothing was read.`,
          { object: entry.object, field, param: 'related' },
        );
      }
    }
    const def = fields[field];
    plans.push({
      object: entry.object,
      field,
      multiValue: isMultiValueField(def as { type: string; multiple?: boolean }),
      ...(entry.fields !== undefined ? { fields: entry.fields } : {}),
      ...(entry.orderBy !== undefined ? { orderBy: entry.orderBy } : {}),
      limit: Math.min(entry.limit ?? maxRows, maxRows),
    });
  }
  return plans;
}

/** The one filter a related list is read with: its link field holds the parent's id. */
export function relatedListWhere(plan: RelatedListPlan, parentId: string): Record<string, unknown> {
  return { [plan.field]: plan.multiValue ? { $contains: parentId } : parentId };
}
