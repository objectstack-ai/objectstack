// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two GENERIC-EXIT declarations, asked at the analytics door: an object's
 * `enable` block (ADR-0049 — `apiEnabled: false`, and an `apiMethods`
 * whitelist) and a field's `internal: true` flag (ADR-0100's third credential
 * channel).
 *
 * ## Why the door owed them
 *
 * Every other generic exit already judges both. The REST data routes, the
 * runtime dispatcher and the MCP data tools ask the spec's one exposure
 * decision, {@link apiExposureDenialReason}, and the cross-object search reads
 * the same off switch; the data door omits an `internal` column from every row
 * it returns, the write responses strip it, and the engine's `aggregate()`
 * refuses it as a group key or an aggregate input. The analytics door read
 * neither declaration: an ad-hoc query over an `apiEnabled: false` object
 * answered its rows, and an `internal` column was served as a group key on the
 * native-SQL path, to a member holding read and to an administrator alike.
 *
 * ## One decision, not a second rule
 *
 * The object facet holds no rule of its own. It asks
 * {@link apiExposureDenialReason} for the `aggregate` operation — the canonical
 * operation an analytics read is (`DATA_ACTION_TO_API_OPERATION.aggregate`,
 * derived from `list`), the one the dispatcher gates its own aggregate action
 * under — and turns the answer into this door's envelope, the way every other
 * door does: `404 OBJECT_API_DISABLED` for the off switch and
 * `405 OBJECT_API_METHOD_NOT_ALLOWED` for a whitelist that does not grant the
 * verb, the codes the data door answers for the same declaration. Both answers
 * of the decision are honoured; reading only the off switch would be a second
 * rule (an analytics-only reading of the whitelist as unrestricted).
 *
 * The field facet holds no rule either: which fields are `internal` is
 * `@objectstack/core`'s `collectInternalWriteResponseFields`, the collector
 * every write mouth and the knowledge index already ask (strict `=== true`,
 * the engine's own spelling).
 *
 * ## Refused, not withheld — the precedent, measured
 *
 * On the data door an `internal` column is OMITTED from a row (a `select`
 * naming it included), because a row is a projection and a projection can
 * leave a column out. The data door's aggregate face refuses the same column
 * as a group key — the engine's `rejectCredentialAggregation` — because a group
 * key cannot be withheld without changing what the groups count. Every member
 * an analytics query names is EVALUATED, never projected: a dimension is a
 * group key, a measure aggregates its field, a filter or sort key evaluates
 * the value row by row (an oracle that confirms a guessed value with no value
 * ever returned). So there is nothing to omit, and every position is refused,
 * the refusal-based posture this door already takes for a member it will not
 * evaluate (`stored-metadata-body-refusal.ts`, in the same envelope:
 * `400 INVALID_FIELD`, naming the object and the field).
 *
 * ## Every caller, every strategy, before anything reads
 *
 * Both declarations are about the EXIT, not the caller: they take no user and
 * no context, so an administrator is refused exactly as a member is, and there
 * is no system carve-out. Both are asked at the service door ahead of strategy
 * selection, over the same object set the read admission and the row scope are
 * asked over (base object, declared joins, relationship hops), so the native-SQL
 * strategy — which reads the database with no engine in front of it — and the
 * ObjectQL strategy give one answer by construction.
 *
 * ## Fail direction
 *
 * The provider is access-NARROWING, so it fails CLOSED: a lookup that throws
 * refuses the query (`403 PERMISSION_DENIED`, logged at `error`), and the
 * plugin's bridge throws when no data engine can answer. An object the
 * provider answers no declaration for (`undefined`) declares nothing, and the
 * spec decision answers "served" for it — the same default every door reads.
 * A host that constructs `AnalyticsService` with no provider gets no gate and
 * is told so once; `AnalyticsServicePlugin` always wires one.
 *
 * ## The registration face — the same decision, asked earlier
 *
 * A configured cube, or a dataset `registerDataset` compiled, enters the SHARED
 * registry that `getMeta` publishes. When its base object or a declared join
 * is one the decision denies, every query of it is refused by the query face
 * above, so listing it advertises a cube that can never answer.
 * {@link assertDefinitionExposed} asks the SAME decision, for the same
 * operation and over the same object set the query face's first ask reads (the
 * cube's base object and declared joins), at the moment the definition is
 * registered, and refuses it with the same codes, naming the definition, the
 * object and the declaration. A relationship hop one MEMBER walks is not asked
 * here: it refuses that member's queries, not the cube's.
 *
 * Its tiering is the registration doors' own, the one the compile-time probes
 * in `dataset-compiler.ts` already take: cannot answer, do not block. An object
 * the provider answers no declaration for is not refused (registration can run
 * before every object is registered: a configured cube is registered when the
 * plugin's `init()` constructs the service), and a provider that THROWS is not
 * an answer either. Neither leaves anything open: the query face still asks
 * at every query, fail-closed.
 */

import {
  apiExposureDenialReason,
  effectiveOperationsArray,
  resolveEffectiveApiMethods,
  type ApiExposureDenialReason,
  type EnableLike,
} from '@objectstack/spec/data';
import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';
import { collectInternalWriteResponseFields } from '@objectstack/core';
import type { NamedField, NamedRead } from './field-read-admission.js';

/**
 * The slice of an object's registered definition the door reads: its `enable`
 * block and its field map. The registry's `getObject()` shape, unparsed.
 */
export interface ObjectDeclaration {
  enable?: unknown;
  fields?: unknown;
}

/**
 * The host's answer to "what does `objectName` declare?" — `getObject()` on the
 * data engine in the shipped composition.
 *
 * `undefined` / `null` means the object declares nothing (it is not
 * registered); a throw refuses the query (fail-closed).
 */
export type ObjectDeclarationProvider = (objectName: string) => ObjectDeclaration | null | undefined;

/** The canonical operation an analytics read is judged as. */
const ANALYTICS_OPERATION = 'aggregate';

/**
 * The data door's two exposure codes, the same pair the REST data routes and
 * the MCP data tools answer. Typed against the ledger so a misspelling fails
 * `tsc`.
 */
const OBJECT_API_DISABLED_CODE: RegisteredErrorCode = 'OBJECT_API_DISABLED';
const OBJECT_API_METHOD_NOT_ALLOWED_CODE: RegisteredErrorCode = 'OBJECT_API_METHOD_NOT_ALLOWED';

/** The member refusal every sibling refusal at this door answers. */
const INVALID_FIELD: StandardErrorCode = 'INVALID_FIELD';

/** The fail-closed refusal, the read admission's code. */
const PERMISSION_DENIED: StandardErrorCode = 'PERMISSION_DENIED';

type DoorRefusal = Error & {
  code?: string;
  status?: number;
  object?: string;
  field?: string;
  allowed?: string[];
};

/** Log sink — the subset of `Logger` this module uses (see `read-admission.ts`). */
interface ExposureLogger {
  error?(message: string, error?: Error): void;
  warn(message: string): void;
}

/** `404 OBJECT_API_DISABLED` — the data door's words for the off switch. */
function objectApiDisabledError(object: string): Error {
  const err = new Error(`Object '${object}' is not exposed via the API`) as DoorRefusal;
  err.code = OBJECT_API_DISABLED_CODE;
  err.status = 404;
  err.object = object;
  return err;
}

/** `405 OBJECT_API_METHOD_NOT_ALLOWED`, with the effective operation set. */
function objectApiMethodNotAllowedError(object: string, allowed: string[]): Error {
  const err = new Error(
    `API operation '${ANALYTICS_OPERATION}' is not allowed on object '${object}'`,
  ) as DoorRefusal;
  err.code = OBJECT_API_METHOD_NOT_ALLOWED_CODE;
  err.status = 405;
  err.object = object;
  err.allowed = allowed;
  return err;
}

/** What a registration refusal names as the refused definition. */
export type RegisteredDefinitionKind = 'cube' | 'dataset';

/**
 * The registration face's refusal: the code and status the query face answers
 * for the same declaration, with a message that locates it — the definition
 * that was not registered, the object it reads, and the declaration that
 * denies the operation.
 */
function unexposedDefinitionError(
  kind: RegisteredDefinitionKind,
  name: string,
  object: string,
  reason: ApiExposureDenialReason,
  enable: EnableLike,
): Error {
  const allowed =
    reason === 'method-not-allowed' ? effectiveOperationsArray(resolveEffectiveApiMethods(enable)) : undefined;
  const declaration =
    allowed === undefined
      ? '`enable.apiEnabled: false`'
      : `\`enable.apiMethods\`, which grants ${allowed.length > 0 ? allowed.map((op) => `'${op}'`).join(', ') : 'no operation'}`;
  const code = allowed === undefined ? OBJECT_API_DISABLED_CODE : OBJECT_API_METHOD_NOT_ALLOWED_CODE;
  const status = allowed === undefined ? 404 : 405;
  const err = new Error(
    `[Analytics] The ${kind} "${name}" was not registered: it reads the object "${object}", whose ${declaration} ` +
      `denies the '${ANALYTICS_OPERATION}' operation an analytics query is judged as (${reason}), so every query ` +
      `of it would be refused ${status} ${code}. Point the ${kind} at an object the API serves, or remove it.`,
  ) as DoorRefusal;
  err.code = code;
  err.status = status;
  err.object = object;
  if (allowed !== undefined) err.allowed = allowed;
  return err;
}

/** `403 PERMISSION_DENIED` — the declaration could not be read, so nothing runs. */
function exposureUnresolvedError(object: string): Error {
  const err = new Error(
    `[Analytics] Access denied: the API exposure declaration for "${object}" could not be resolved, ` +
      'so the query was not run.',
  ) as DoorRefusal;
  err.code = PERMISSION_DENIED;
  err.status = 403;
  err.object = object;
  return err;
}

/**
 * `400 INVALID_FIELD` for a member that reads an `internal: true` field. Names
 * the object and the field — the field the member resolved to — and no value.
 */
function internalFieldError(object: string, field: string): Error {
  const err = new Error(
    `Cannot query '${object}' by '${field}': the query was not run. The ${field} field is declared ` +
      '`internal: true`, so its value is never returned on a generic data exit; an analytics member is ' +
      'evaluated rather than projected, so grouping by it would serve the value as a group key, ' +
      'aggregating it would summarise the value, and filtering or sorting by it would confirm a guessed ' +
      'value. Group, aggregate, filter or sort by another field instead.',
  ) as DoorRefusal;
  err.code = INVALID_FIELD;
  err.status = 400;
  err.object = object;
  err.field = field;
  return err;
}

/** Read one declaration, refusing (fail-closed) when the provider throws. */
function declarationOf(
  object: string,
  provider: ObjectDeclarationProvider,
  logger: ExposureLogger | undefined,
): ObjectDeclaration | undefined {
  try {
    return provider(object) ?? undefined;
  } catch (e) {
    const cause = e instanceof Error ? e : new Error(String(e));
    const report =
      `[Analytics] the API exposure declaration of "${object}" could not be resolved — ` +
      'denying the query (fail-closed)';
    if (logger?.error) logger.error(report, cause);
    else logger?.warn(`${report}: ${cause.message}`);
    throw exposureUnresolvedError(object);
  }
}

/**
 * Refuse the query unless every object it reads is exposed for the aggregate
 * operation, by the spec's one decision. The first refused object, in the
 * set's order, is the one named.
 */
export function assertObjectsExposed(
  objects: Iterable<string>,
  provider: ObjectDeclarationProvider,
  logger?: ExposureLogger,
): void {
  for (const object of objects) {
    const enable = declarationOf(object, provider, logger)?.enable as EnableLike | null | undefined;
    const reason = apiExposureDenialReason(enable, ANALYTICS_OPERATION);
    if (reason === null) continue;
    if (reason === 'api-disabled') throw objectApiDisabledError(object);
    throw objectApiMethodNotAllowedError(object, effectiveOperationsArray(resolveEffectiveApiMethods(enable!)));
  }
}

/**
 * The registration face (see the module doc): refuse to register the `kind`
 * named `name` when an object in `objects` — its base object and declared
 * joins — is one the spec's decision denies the aggregate operation. The first
 * denied object, in the set's order, is the one named.
 *
 * Cannot answer, do not block: an object the provider answers no declaration
 * for is not refused, and neither is one whose lookup throws. Registration
 * records nothing in either case beyond what it recorded before this face
 * existed, and the query face still judges the object at every query.
 */
export function assertDefinitionExposed(
  kind: RegisteredDefinitionKind,
  name: string,
  objects: Iterable<string>,
  provider: ObjectDeclarationProvider,
): void {
  for (const object of objects) {
    let enable: EnableLike | null | undefined;
    try {
      enable = (provider(object) ?? undefined)?.enable as EnableLike | null | undefined;
    } catch {
      // No answer at registration time. The query face refuses fail-closed when
      // the same lookup throws for a query, so nothing is served on this branch.
      continue;
    }
    const reason = apiExposureDenialReason(enable, ANALYTICS_OPERATION);
    if (reason === null) continue;
    throw unexposedDefinitionError(kind, name, object, reason, enable!);
  }
}

/**
 * [#22661] The LABEL face: may the dimension-label passes read `target` — the
 * object a reference-class dimension (`lookup` / `master_detail` / `user` /
 * `tree`) points at — to turn a grouped id into the target record's display
 * name?
 *
 * Both label passes (the display pass, `resolveDimensionLabels`, and the
 * sort-key pass, `createOrderLabelResolver`) read a SECOND object the query
 * faces above never ask about: the dataset's base object and its hops are
 * judged, the label target was not, so a dataset over an exposed object
 * rendered the display names of an object every data route refuses. Asked the
 * same decision, for the same `aggregate` operation: a label is the read a
 * relationship-hop dimension over the target's display field performs
 * (`<lookup>.<name>`), which this door already judges as `aggregate` over
 * `queryObjects`; judging the label as anything else would serve through one
 * spelling what the other is refused. It takes no caller.
 *
 * Withheld, not refused, and that is the precedent measured on this door: a
 * label the target's row scope hides, or whose scope cannot be resolved, is
 * not fetched and the stored id renders. An unexposed target answers the same
 * way, and a provider that THROWS answers it too — no label is read on a
 * declaration nobody could read (fail-closed, reported at `warn`: a display
 * degradation, not a refused query).
 */
export function servesLabelTarget(
  target: string,
  provider: ObjectDeclarationProvider,
  logger?: ExposureLogger,
): boolean {
  let enable: EnableLike | null | undefined;
  try {
    enable = (provider(target) ?? undefined)?.enable as EnableLike | null | undefined;
  } catch (e) {
    logger?.warn(
      `[Analytics] the API exposure declaration of "${target}" could not be resolved — its display ` +
        `labels are not read and the stored ids render (fail-closed): ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
  return apiExposureDenialReason(enable, ANALYTICS_OPERATION) === null;
}

/**
 * Refuse the query when any member it names reads a field its object declares
 * `internal: true` — in every position, every role. `named` is what the door's
 * member resolver attributes to each object (relationship hops included); a
 * member that names no field is the field gate's to refuse, not this one's.
 */
export function assertNoInternalFieldNamed(
  named: readonly NamedRead[],
  provider: ObjectDeclarationProvider,
  logger?: ExposureLogger,
): void {
  const internalByObject = new Map<string, ReadonlySet<string>>();
  for (const read of named) {
    if ('expression' in read) continue;
    const { object, field } = read as NamedField;
    let internal = internalByObject.get(object);
    if (!internal) {
      internal = new Set(collectInternalWriteResponseFields(declarationOf(object, provider, logger)));
      internalByObject.set(object, internal);
    }
    if (internal.has(field)) {
      logger?.warn(
        `[Analytics] refused a query naming the internal field "${field}" of "${object}" — ` +
          'internal fields are never evaluated by an analytics member',
      );
      throw internalFieldError(object, field);
    }
  }
}
