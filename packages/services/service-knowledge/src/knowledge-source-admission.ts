// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which `object` knowledge sources a caller's search may reach — the exposure
 * decision and the field-level read rules, asked at SOURCE granularity before
 * a source is searched.
 *
 * ## Why the knowledge service owes them
 *
 * A knowledge passage is built at index time, under a system context, from
 * every `contentFields` member of its source (plus the object's display field
 * as the title, and the source's `metadataFields`). The row re-check in `applyPermissionFilter` asks
 * only "may this caller read the row?". Every other door that serves object
 * rows outside the data routes also asks the spec's one exposure decision
 * (`canServeApiOperation`, ADR-0049) and the caller's field-level read rules —
 * the MCP record tools, the analytics door, the cross-object search — so a
 * caller who may read a row but not one of the fields its passage was built
 * from was served that field's text here, and an object the API does not serve
 * at all was served as passages. ADR-0090 D10 rule 1: "An over-privileged agent
 * prompted by an under-privileged user must not leak what the user could never
 * see."
 *
 * ## The gates, in order, per object
 *
 * 1. **Disabled package.** An object whose owning package is disabled is
 *    refused, by the registry's own predicate (`registryObjectPackageDisabled`,
 *    `@objectstack/core` — the one the data route and the analytics door ask).
 * 2. **API exposure.** `canServeApiOperation(enable, 'search')` — the decision
 *    and operation the cross-object search asks: a knowledge search is a search
 *    over the object's rows. `apiEnabled: false` and an `apiMethods` whitelist
 *    that does not grant `search` both refuse.
 * 3. **System objects.** A `sys_*` object is served only when it opts into AI
 *    reads by its one reading, `isAiReadExposed` (`enable.aiReadable: true`,
 *    the stored-metadata family never) — the posture the MCP record tools take.
 *
 * Then, per source, the **field gate**: every field the source serves (each
 * `contentFields` member — `'*'` meaning every field the object declares — each
 * `metadataFields` member, and the title field — `documentTitleField`), less
 * the credential-class and `internal` fields the index never carries, must be
 * QUERYABLE by the caller.
 * Queryable, not merely readable: a passage carries the value the index read
 * under a system context, unmasked, and the search matches on it — a field the
 * caller is served masked is readable and not queryable, exactly the fields
 * whose unmasked text a passage would disclose. When one served field is not
 * queryable, the whole source is not searched for that caller: a passage
 * cannot be partially withheld after the fact (its text and its embedding are
 * one unit), and searching it at all would make row presence an oracle on the
 * hidden value.
 *
 * ## Where the field answer comes from
 *
 * The `security` service's `getQueryableFields`; absent that method, or when it
 * answers `undefined`, its `getReadableFields` less every field declaring a
 * `maskingRule` (the contract's fallback, `ISecurityService.getQueryableFields`).
 * With no `security` service at all, the same fallback over the object's own
 * declaration: every field is readable, and every field declaring a
 * `maskingRule` is not queryable.
 *
 * ## Fail direction
 *
 * Access-narrowing, so it fails CLOSED: a schema read, package probe or field
 * answer that throws refuses the source (the service logs it at `error`); a
 * security service that answers neither field question refuses it too. No new
 * spec key: the gates read declarations the object already carries.
 *
 * The system context bypasses every gate (the service never calls this for
 * one), as it bypasses the row re-check.
 */

import {
  canServeApiOperation,
  isAiReadExposed,
  resolveDisplayField,
  type EnableLike,
  type TitleEligibleFieldDef,
} from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ObjectKnowledgeSource } from '@objectstack/spec/ai';
import {
  collectCredentialWriteResponseFields,
  collectInternalWriteResponseFields,
} from '@objectstack/core';

/** The canonical operation a knowledge search is judged as — the cross-object search's. */
export const KNOWLEDGE_SEARCH_OPERATION = 'search';

/**
 * The slice of the `security` service the field gate reads. Both members are
 * optional here only because the service is reached duck-typed; on a
 * conforming `ISecurityService` `getReadableFields` is required.
 */
export interface KnowledgeFieldSecurity {
  getQueryableFields?(object: string, context?: ExecutionContext): Promise<string[] | undefined>;
  getReadableFields?(object: string, context?: ExecutionContext): Promise<string[] | undefined>;
}

/** Why a source is not searched for a caller. */
export type KnowledgeSourceRefusal =
  | 'object-package-disabled'
  | 'object-api-not-served'
  | 'system-object-not-ai-readable'
  | 'field-not-queryable'
  | 'fields-not-enumerable'
  | 'field-answer-unavailable';

export type KnowledgeSourceAdmission =
  | { admitted: true }
  | { admitted: false; reason: KnowledgeSourceRefusal; object: string; field?: string };

/** What the gates read, handed over by the service. Any member may throw: the caller refuses on a throw. */
export interface KnowledgeAdmissionDeps {
  /** The object's registered definition; `undefined` when the engine declares nothing for it. */
  readSchema(object: string): unknown;
  /** `true` only for an object whose owning package is disabled. */
  isObjectPackageDisabled(object: string): boolean;
  /** The `security` service, or `undefined` when the host registers none. */
  resolveSecurity(): KnowledgeFieldSecurity | undefined;
}

/** The field answer for one object and one caller. */
type FieldAnswer =
  /** The queryable field set the security service answered (or its read projection less masked fields). */
  | { kind: 'listed'; queryable: ReadonlySet<string> }
  /** No security service: every field is queryable except the ones declaring a `maskingRule`. */
  | { kind: 'masked-only'; masked: ReadonlySet<string> }
  /** The security service answered neither question. */
  | { kind: 'unanswered' };

/** The per-object verdict, computed once per (caller, object) per search. */
export interface ObjectAdmission {
  readonly object: string;
  readonly schema: unknown;
  readonly refused?: Exclude<KnowledgeSourceRefusal, 'field-not-queryable' | 'fields-not-enumerable' | 'field-answer-unavailable'>;
  readonly fields?: FieldAnswer;
}

/** Field names an object declares (record or array form); `undefined` when the schema carries none. */
export function declaredFields(schema: unknown): Array<[string, unknown]> | undefined {
  const fields = (schema as { fields?: unknown } | null | undefined)?.fields;
  if (Array.isArray(fields)) {
    return fields
      .map((f) => [(f as { name?: unknown } | null)?.name, f] as [unknown, unknown])
      .filter((e): e is [string, unknown] => typeof e[0] === 'string' && e[0].length > 0);
  }
  if (fields && typeof fields === 'object') return Object.entries(fields as Record<string, unknown>);
  return undefined;
}

/**
 * The field a knowledge document's `title` is read from (ADR-0161 K5: the
 * title is the object's display field) — one answer for assembly
 * (`recordToDocument`) and for the field gate ({@link servedFieldsOf}), so a
 * caller is never served a title from a field the gate did not ask about.
 *
 * - **An object definition**: its display field, `resolveDisplayField`
 *   (ADR-0079: `nameField`, its deprecated alias `displayNameField`, else the
 *   derivation). A resolved field the definition does not declare, when it
 *   declares its fields, gives no title; so does a definition that resolves
 *   none.
 * - **No object definition**: a field named `title`, as assembly read it
 *   before it asked the definition.
 */
export function documentTitleField(schema: unknown): string | undefined {
  if (schema === undefined || schema === null || typeof schema !== 'object') return 'title';
  const meta = schema as { nameField?: unknown; displayNameField?: unknown };
  const declared = declaredFields(schema);
  const field = resolveDisplayField({
    nameField: typeof meta.nameField === 'string' && meta.nameField.length > 0 ? meta.nameField : undefined,
    displayNameField:
      typeof meta.displayNameField === 'string' && meta.displayNameField.length > 0 ? meta.displayNameField : undefined,
    fields: declared
      ? (Object.fromEntries(declared.map(([name, def]) => [name, (def ?? {}) as TitleEligibleFieldDef])) as Record<
          string,
          TitleEligibleFieldDef
        >)
      : undefined,
  });
  if (field === undefined) return undefined;
  if (declared && !declared.some(([name]) => name === field)) return undefined;
  return field;
}

/** Every field the object declares with a `maskingRule`. */
function maskingRuleFields(schema: unknown): Set<string> {
  const out = new Set<string>();
  for (const [name, def] of declaredFields(schema) ?? []) {
    const rule = (def as { maskingRule?: unknown } | null | undefined)?.maskingRule;
    if (rule !== undefined && rule !== null) out.add(name);
  }
  return out;
}

const isSystemObjectName = (object: string): boolean => /^sys_/i.test(object);

/**
 * The object-level gates and the caller's field answer for `object`. Throws
 * when a lookup throws or the security service is unusable; the caller refuses
 * every source over the object then.
 */
export async function admitObject(
  object: string,
  context: ExecutionContext,
  deps: KnowledgeAdmissionDeps,
): Promise<ObjectAdmission> {
  const schema = deps.readSchema(object);
  if (deps.isObjectPackageDisabled(object) === true) {
    return { object, schema, refused: 'object-package-disabled' };
  }
  const enable = (schema as { enable?: unknown } | null | undefined)?.enable as EnableLike | null | undefined;
  if (!canServeApiOperation(enable, KNOWLEDGE_SEARCH_OPERATION)) {
    return { object, schema, refused: 'object-api-not-served' };
  }
  const declaredName = (schema as { name?: unknown } | null | undefined)?.name;
  const isSystemObject = isSystemObjectName(object) || (typeof declaredName === 'string' && isSystemObjectName(declaredName));
  if (isSystemObject && !isAiReadExposed(schema)) {
    return { object, schema, refused: 'system-object-not-ai-readable' };
  }

  const security = deps.resolveSecurity();
  if (!security) {
    return { object, schema, fields: { kind: 'masked-only', masked: maskingRuleFields(schema) } };
  }
  if (typeof security.getQueryableFields === 'function') {
    const queryable = await security.getQueryableFields(object, context);
    if (queryable !== undefined) return { object, schema, fields: { kind: 'listed', queryable: new Set(queryable) } };
  }
  if (typeof security.getReadableFields !== 'function') {
    throw new Error(
      'the registered "security" service exposes neither getQueryableFields() nor getReadableFields(), so it ' +
        'cannot answer which fields the caller may read',
    );
  }
  const readable = await security.getReadableFields(object, context);
  if (readable === undefined) return { object, schema, fields: { kind: 'unanswered' } };
  const masked = maskingRuleFields(schema);
  return { object, schema, fields: { kind: 'listed', queryable: new Set(readable.filter((f) => !masked.has(f))) } };
}

/**
 * The fields a source serves in a passage, a hit's `title` or its `metadata`,
 * less the ones the index never carries (`recordToDocument`'s withheld set).
 * `undefined` when `'*'` is declared and the object's fields cannot be
 * enumerated.
 */
export function servedFieldsOf(objSource: ObjectKnowledgeSource, schema: unknown): Set<string> | undefined {
  const withheld = new Set<string>([
    ...collectCredentialWriteResponseFields(schema),
    ...collectInternalWriteResponseFields(schema),
  ]);
  const declared = declaredFields(schema);
  const served = new Set<string>();
  for (const field of objSource.contentFields) {
    if (field === '*') {
      if (!declared) return undefined;
      for (const [name] of declared) if (name !== 'id') served.add(name);
    } else {
      served.add(field);
    }
  }
  for (const field of objSource.metadataFields ?? []) served.add(field);
  // `recordToDocument` serves the title field's value whatever the source names.
  const titleField = documentTitleField(schema);
  if (titleField !== undefined) served.add(titleField);
  for (const field of withheld) served.delete(field);
  return served;
}

/** The field gate for one source over an object the object-level gates admitted. */
export function admitSourceFields(
  objSource: ObjectKnowledgeSource,
  admission: ObjectAdmission,
): KnowledgeSourceAdmission {
  const { object, fields } = admission;
  if (!fields || fields.kind === 'unanswered') {
    return { admitted: false, reason: 'field-answer-unavailable', object };
  }
  const served = servedFieldsOf(objSource, admission.schema);
  if (fields.kind === 'masked-only') {
    // No declaration known ⇒ nothing is masked, so an unenumerable `'*'` serves nothing masked either.
    for (const field of served ?? []) {
      if (fields.masked.has(field)) return { admitted: false, reason: 'field-not-queryable', object, field };
    }
    return { admitted: true };
  }
  if (!served) return { admitted: false, reason: 'fields-not-enumerable', object };
  for (const field of served) {
    if (!fields.queryable.has(field)) return { admitted: false, reason: 'field-not-queryable', object, field };
  }
  return { admitted: true };
}
