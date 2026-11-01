// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25522 cut 4] The realtime publish bodies of `ObjectQL` —
 * `publishDataEvent` (the per-record `DataEvent`, #4626) and
 * `publishBulkDataEvent` (the predicate-write `BulkDataEvent`, #4639) — and
 * the event helpers only those two call, moved out of `engine.ts` whole.
 *
 * A MOVE, not a redesign. Each exported function below is the body of the
 * `ObjectQL` method of the same name as it stood, re-indented one level and
 * otherwise unedited: the same two gates (no record identity ⇒ no event; a
 * non-count or zero bulk result ⇒ no event), the same `parse` before publish,
 * the same envelope and the same never-throw `catch`. The helpers above them
 * (`generateEventUuid` through `eventMatchedCount`) are the module-level
 * functions of those names as they stood in `engine.ts`, byte for byte,
 * docblocks included; no other code in `engine.ts` called them.
 *
 * What stays in `engine.ts`: `setRealtimeService` (a two-line field setter),
 * the `realtimeService` field itself and the three write-path call sites.
 * `accessibleOrganizationsOf`, which sat between the helpers but is read by the
 * tenant wall, not by an event, now lives in `engine-driver-options.ts`.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), applied per method as
 * `engine-lifecycle-health.ts` applies it. The class keeps both methods — the
 * published `.d.ts` lists each one's name and position — and each body is one
 * literal of exactly the {@link RealtimePublishHost} members that method
 * reads, plus a `.call`. The three fields the bodies read (`realtimeService`,
 * `logger`, `_registry`) go as GETTERS, so each read happens when the body
 * makes it: `setRealtimeService` replaces the service at any time, and a body
 * sees whatever is installed at the moment it reads, as it did. The callers
 * still call the methods on the engine, so a double or spy set on the instance
 * is still the one a write reaches.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it, so the published surface does not
 * move.
 */

import type { RealtimeEventPayload } from '@objectstack/spec/contracts';
import {
  BulkDataEventSchema,
  DataEventSchema,
  type BulkDataEvent,
  type DataEvent,
} from '@objectstack/spec/api';
import type { ExecutionContext } from '@objectstack/spec/kernel';
// [#21120] The family-wide stored-metadata-body seam. A `data.record.*` event
// carries the written row in `after` (and the input patch in `changes`), so a
// subscriber to `sys_metadata` / `sys_metadata_history` events would receive
// the stored metadata body — a datasource body's credential material included —
// outside every redacting read exit. The event body is projected through the
// one shared redactor so the realtime exit withholds it exactly as `/meta` and
// the data door do. ⛔ No second redaction dialect.
import { isStoredMetadataBodyObject, redactStoredMetadataBody, STORED_METADATA_BODY_COLUMN, STORED_METADATA_TYPE_COLUMN } from '@objectstack/spec/kernel';
import {
  // The one write-response non-exposure helper (credential mask + `internal`
  // omission); a record-change event body is an external exit of the same
  // write, so it is projected through the same rule — see
  // {@link projectEventRecordBody}.
  omitInternalFieldsFromWriteResponse,
} from '@objectstack/core';
import { TenantLayer0VerdictSchema } from '@objectstack/spec/security';
// [#27884] The one row of capability-gated stored metadata types — the row the
// `/meta` type gate and the engine's stored-row read gate read.
import { isCapabilityGatedStoredMetadataType } from '@objectstack/metadata-core';
import { resolveTenantFieldName, carriesOrganization } from './tenancy/system-write-organization.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the two publish bodies read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's type on the class is a change here too, and naming a member
 * the class does not have is a compile error. All three are getters (see the
 * module header).
 */
export interface RealtimePublishHost {
  readonly realtimeService: ObjectQL['realtimeService'];
  readonly logger: ObjectQL['logger'];
  readonly _registry: ObjectQL['_registry'];
}

/**
 * RFC-4122 v4 uuid for the realtime `DataEvent.id` (#4626).
 *
 * The twin of the generator `MetadataManager` uses for `MetadataEvent.id`
 * (#4602/#4628) — same shape, same fallback, kept local rather than shared so
 * the engine's `core` import closure gains nothing (ADR-0076 D2 ratchet).
 * Prefers `crypto.randomUUID`; the fallback keeps browser-compatible (Pure)
 * environments without WebCrypto working while still satisfying
 * `DataEventSchema`'s `z.string().uuid()`.
 */
function generateEventUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Coerce a driver-returned primary key into `DataEvent.recordId` (a required
 * `string`). Returns `undefined` when the write has no single record identity
 * — a bulk `updateMany`/`deleteMany` returns only a count — so the caller can
 * decline to publish rather than fabricate one (#4626).
 */
function eventRecordId(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return undefined;
}

/** `DataEvent.changes`/`before`/`after` are `z.record(...)` — only a plain object qualifies. */
function eventRecordBody(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * [#21120] Project the stored metadata body carried on a `data.record.*` event
 * through the one shared redactor, when the event's object is a
 * stored-metadata-body table. The event is a credential READ EXIT: a subscriber
 * receives `after` (the written row) and `changes` (the input patch), so a
 * `sys_metadata` datasource row's stored credential would otherwise reach it
 * outside every redacting door.
 *
 * `fullRow` is the whole written record (`input.after`), read for the `type`
 * column that selects the redactor — a `changes` patch need not carry it. A
 * body of a capability-gated type (`isCapabilityGatedStoredMetadataType`,
 * #27884) is DROPPED for every subscriber. A body the redactor cannot judge is
 * DROPPED from the event (fail-closed): the
 * key is omitted rather than published raw. A non-record body, and every object
 * outside the set, pass through unchanged. Pure: the event body is a fresh
 * object, never the stored row.
 */
function redactEventMetadataBody(
  object: string,
  body: Record<string, unknown> | undefined,
  fullRow: unknown,
): Record<string, unknown> | undefined {
  if (body === undefined || !isStoredMetadataBodyObject(object)) return body;
  if (!(STORED_METADATA_BODY_COLUMN in body)) return body;
  const type =
    typeof body[STORED_METADATA_TYPE_COLUMN] === 'string'
      ? body[STORED_METADATA_TYPE_COLUMN]
      : (fullRow && typeof fullRow === 'object' && !Array.isArray(fullRow)
          ? (fullRow as Record<string, unknown>)[STORED_METADATA_TYPE_COLUMN]
          : undefined);
  // [#27884] A document of a capability-gated type (a datasource's connection
  // configuration and secret handle) is served only to holders of the type's
  // read capability, and the event's subscribers are not known here — so its
  // body is withheld from every subscriber, the fail-closed arm below.
  const outcome = isCapabilityGatedStoredMetadataType(type)
    ? ({ ok: false } as const)
    : redactStoredMetadataBody(type, body[STORED_METADATA_BODY_COLUMN]);
  if (outcome.ok) {
    if (outcome.body === body[STORED_METADATA_BODY_COLUMN]) return body;
    return { ...body, [STORED_METADATA_BODY_COLUMN]: outcome.body };
  }
  const { [STORED_METADATA_BODY_COLUMN]: _withheld, ...rest } = body;
  return rest;
}

/**
 * Project a `data.record.*` event body (`after` / `changes`) through the
 * generic-data-path non-exposure rules — credential-class fields MASKED,
 * `internal: true` fields OMITTED — by the ONE helper every external write
 * response already goes through (`omitInternalFieldsFromWriteResponse`,
 * `@objectstack/core`). ⛔ Never a second copy of that rule here.
 *
 * The event is an external exit of the write: its subscribers (outbound
 * deliveries, search indexes, flows that snapshot the record) store or forward
 * what they receive to readers below the write boundary, so the body carries
 * what a read of the same row would answer — never the stored value the
 * engine's own write result keeps whole for the privileged in-process caller.
 *
 * Pure with respect to the write result: the helper deletes and assigns in
 * place, so it runs on a fresh shallow copy and the caller's record (the
 * engine's return value) is never touched.
 */
function projectEventRecordBody(
  schema: unknown,
  body: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (body === undefined) return body;
  const copy = { ...body };
  omitInternalFieldsFromWriteResponse(schema, copy);
  return copy;
}

/** `DataEvent.userId` — the acting user, when the execution context names one. */
function eventUserId(execCtx?: ExecutionContext): string | undefined {
  const userId = execCtx?.userId;
  if (userId == null) return undefined;
  const asString = String(userId);
  return asString === '' ? undefined : asString;
}

/**
 * `DataEvent.organizationId` — the organization the RECORD belongs to, read
 * off that row's own tenant column (#14970).
 *
 * The spec declares this member as an obligation on the PRODUCER, and states
 * it in terms this function exists to honour literally: *"Present = exactly
 * that organization, never a guess. It names the organization the RECORD
 * belongs to — not the caller's active organization standing in for the
 * row's, which would mislabel an administrator's write into another
 * organization."* Two consequences, neither negotiable:
 *
 *  - ⛔ **Never `execCtx.tenantId`.** That is the CALLER's active org — the
 *    hook-context sense {@link ObjectQL.buildHookUser} publishes, where
 *    `organizationId` is deliberately "the blessed developer-facing name for
 *    the caller's". The two coincide on an ordinary tenant write and DIVERGE
 *    on a system/unscoped one, which is exactly the write this key most needs
 *    to label correctly. The row is the only truthful source, so this reads
 *    the row and nothing else. Substituting the caller's org onto a
 *    permission-boundary column is the defect PR #14726's blocking contract
 *    review found on a different column.
 *  - ⛔ **Never a per-event read.** Every call site already holds the row —
 *    the written record, the post-state, or the delete's pre-image — so this
 *    is a threading job, not a resolution job. A lookup here would put a query
 *    on the fan-out path the event exists to keep O(1); triage ruled that out
 *    for the consumer side on 2026-08-31 and it is equally out here.
 *
 * The column is resolved through {@link resolveTenantFieldName} — the write
 * path's own precedence (`tenancy.enabled: false` opt-out, then a declared
 * `tenancy.tenantField`, then the kernel-injected `organization_id`) — so an
 * object the engine does not tenant-scope resolves NOTHING rather than being
 * mined for a coincidentally-named column, and a disagreement between what the
 * engine scopes by and what the event names cannot arise. ⚠️ The two spellings
 * differ on purpose and are easy to conflate: the COLUMN is snake_case
 * (`organization_id`, machine name), the published KEY is camelCase
 * (`organizationId`, the blessed developer-facing name).
 *
 * Returns `undefined` for every "no organization" case — object not
 * tenant-scoped, row absent, column absent, `null`, `''`, or a value no id
 * can be read off — and the caller then OMITS the key. Omission is the
 * schema's ONE spelling for absence (`z.string().min(1).optional()`): `''` is
 * refused outright, which would make `parse` throw and drop the event
 * entirely, and a key set to an explicit `undefined` survives `parse` as a
 * PRESENT key. Hence the conditional spread at the publish site, not an
 * assignment.
 */
function eventOrganizationId(objectSchema: unknown, row: unknown): string | undefined {
  const tenantField = resolveTenantFieldName(objectSchema);
  if (!tenantField) return undefined;
  const body = eventRecordBody(row);
  if (!body) return undefined;
  return eventOrganizationValue(body[tenantField]);
}

/**
 * The ONE coercion an organization value goes through before it becomes an
 * event's `organizationId` — shared by the per-record producer
 * ({@link eventOrganizationId}, which reads the row's column) and the bulk
 * producer ({@link bulkEventOrganizationId}, which reads the wall's RECORDED
 * verdict off the operation context, #15813), so the two cannot disagree
 * about what counts as an organization (#15225: one ladder, two readers —
 * never two ladders).
 *
 * First the write path's own "actually supplied" predicate
 * ({@link carriesOrganization}), so producer and consumer cannot disagree
 * about what counts as an organization. Then the same coercion ladder
 * `eventRecordId` uses for the other id on these events. Deliberately NOT a
 * bare `String(value)`: `String(false)` is a perfectly valid `min(1)` string,
 * and inventing an organization out of a malformed value is the "never
 * fabricated" clause's exact failure mode. `undefined` means "omit the key".
 */
function eventOrganizationValue(value: unknown): string | undefined {
  if (!carriesOrganization(value)) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return undefined;
}

/**
 * `BulkDataEvent.organizationId` — the ONE organization the tenant wall named
 * for a predicate write, or `undefined` when the producer cannot assert one
 * (#15225, the bulk half of the cross-tenant fan-out leak whose single-record
 * half is {@link eventOrganizationId}).
 *
 * ⚠️ NOT the per-record helper's question. That one reads a ROW's column;
 * a predicate write has no row in hand — `updateMany`/`deleteMany` resolve a
 * count — so "which organization" is answered from the WALL the write was
 * composed under, and `absent` means something different on this event:
 * "the producer did not assert one organization for the batch" (a statement
 * about producer knowledge), never "belongs to no organization" (a statement
 * about a row). `packages/spec/src/api/events.zod.ts` records the divergence
 * on the member itself.
 *
 * **What is read: the wall's RECORDED verdict, and nothing else** (#15813,
 * the seam ruled on #15706 — option (i), ADR-0131 D8 「一道谓词，算一次」).
 * The security layer AND-composes its Layer 0 tenant wall (ADR-0095 D1,
 * `tenant-layer.ts`) onto the caller's predicate before the driver, and at
 * that moment records what it decided on the operation context
 * ({@link OperationContext.tenantLayer0Verdict}). Under `isolated` the wall
 * is `organization_id = <one organization>`, under `group` it is
 * `organization_id IN <membership set>` (ADR-0105 D2), and Layer 1 cannot
 * widen it — so when the recorded verdict names exactly one organization,
 * every affected row belongs to it, and this producer says so.
 *
 * **What is deliberately NOT read.** The first edition of this producer
 * re-derived the wall here — from the enforced posture, the execution
 * context's `tenantId` / `accessible_org_ids` / `posture` rung, and the
 * object schema's tenancy clauses. It could not see the third clause
 * plugin-security then folded into `tenancyDisabled` — the deployment-declared
 * `platformGlobalObjects` carve-out (#12699), which no schema carried — and
 * stamped the caller's organization onto a batch Layer 0 had never
 * constrained: a WRONG key, the #13566 leak shape. (ADR-0131 D7 has since
 * made that declaration total: a declared object is registered with no
 * organization column and declaring `systemFields.tenant: false`, so the fold
 * is retired — but the rule below does not lean on that; the ruling's
 * acceptance criterion is about the seam, not one clause.) The ruling's acceptance
 * criterion, verbatim: the verdict recorded must be what the wall decided,
 * not a re-statement of its inputs; if the recorded value can be derived by
 * the reader from anything else on the context, the mirror has not been
 * deleted — it has been moved. So this function reads the verdict ALONE:
 *
 *  - `organization` ⇒ that organization;
 *  - `organizations` naming exactly one (the set is deduplicated at the
 *    source and the schema refuses duplicates) ⇒ that organization; two or
 *    more ⇒ absent (⛔ never `tenantId` standing in for a multi-membership
 *    sweep — the option-C mislabel PR #14635's open question 1 rejected);
 *  - `none` (the wall ran and contributed nothing: `single` posture, a
 *    non-tenant or deployment-exempted object, an exempt `PLATFORM_ADMIN`)
 *    and `deny` (the fail-closed sentinel) ⇒ absent;
 *  - NO recorded verdict (a system context exits the middleware first; no
 *    enforcement layer is mounted; the plugin recorded nothing) ⇒ absent —
 *    nothing composed a wall, so there is nothing to vouch for;
 *  - a value that does not parse as a verdict ⇒ absent. Junk never reads as
 *    an organization: an absent key under-delivers (a tenant-scoped consumer
 *    declines to fan out), a wrong key delivers a cross-organization batch
 *    inside the wrong wall.
 *
 * The organization value then goes through the ONE coercion ladder the
 * per-record producer uses ({@link eventOrganizationValue}) — one ladder, two
 * readers, never two ladders — and the caller OMITS the key on `undefined`:
 * omission is the schema's one spelling for absence (`''` is refused, an
 * explicit `undefined` survives `parse` as a present key).
 */
function bulkEventOrganizationId(recordedVerdict: unknown): string | undefined {
  const parsed = TenantLayer0VerdictSchema.safeParse(recordedVerdict);
  if (!parsed.success) return undefined;
  const verdict = parsed.data;
  if (verdict.kind === 'organization') return eventOrganizationValue(verdict.organizationId);
  if (verdict.kind === 'organizations' && verdict.organizationIds.length === 1) {
    return eventOrganizationValue(verdict.organizationIds[0]);
  }
  return undefined;
}

/**
 * Coerce a multi-row driver result into `BulkDataEvent.matched` (#4639).
 *
 * `IDataDriver.updateMany`/`deleteMany` are contracted to resolve the affected
 * row count (`Promise<number>`). A driver that resolves something else has not
 * met that contract, and the count is the ONLY substantive thing a bulk event
 * says — so this returns `undefined` and the caller declines to publish rather
 * than inventing a `matched: 0` that reads as "nothing was affected" when rows
 * very likely were.
 */
function eventMatchedCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

/** The body of `ObjectQL#publishDataEvent`; the method's docblock there is its contract. */
export async function publishDataEvent(
  this: Pick<RealtimePublishHost, 'realtimeService' | 'logger' | '_registry'>,
  action: 'created' | 'updated' | 'deleted',
  object: string,
  input: {
    recordId: unknown;
    changes?: unknown;
    after?: unknown;
    /**
     * The row whose tenant column names this event's `organizationId`
     * (#14970) — the written record on `created`, the post-state on
     * `updated`, the PRE-IMAGE on `deleted` (a delete has no post-state, and
     * `previous` is what every other delete-side consumer already falls back
     * to). Passed explicitly rather than inferred from `after` so the delete
     * path, the one with no `after`, cannot silently publish the key absent.
     */
    organizationRow?: unknown;
    context?: ExecutionContext;
  },
): Promise<void> {
  if (!this.realtimeService) return;

  const recordId = eventRecordId(input.recordId);
  if (!recordId) {
    this.logger.warn(
      `No data.record.${action} event published for '${object}': the write names no single record, ` +
        `and DataEvent.recordId is required — refusing to publish an off-contract event rather than ` +
        `fabricate one with an empty recordId. A predicate (multi: true) write publishes its own ` +
        `data.records.${action} event, carrying the affected-row count, instead — so reaching this ` +
        `means a single-id write whose driver returned no usable primary key, which is a driver defect`,
      { object },
    );
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    const schema = this._registry.getObject(object);
    // Credential mask + `internal` omission on both bodies, the same rule
    // the write response gets ({@link projectEventRecordBody}).
    const changes = projectEventRecordBody(
      schema,
      redactEventMetadataBody(object, eventRecordBody(input.changes), input.after),
    );
    const after = projectEventRecordBody(
      schema,
      redactEventMetadataBody(object, eventRecordBody(input.after), input.after),
    );
    const userId = eventUserId(input.context);
    // [#14970] The RECORD's organization, off the row itself — ⛔ never
    // `input.context.tenantId`, which is the CALLER's. See
    // {@link eventOrganizationId}; omitted, never `''`/`undefined`, because
    // absence has exactly one spelling in the schema.
    const organizationId = eventOrganizationId(schema, input.organizationRow);
    const event: DataEvent = DataEventSchema.parse({
      id: generateEventUuid(),
      type: `data.record.${action}`,
      object,
      recordId,
      ...(changes !== undefined ? { changes } : {}),
      ...(after !== undefined ? { after } : {}),
      ...(userId !== undefined ? { userId } : {}),
      ...(organizationId !== undefined ? { organizationId } : {}),
      timestamp,
    });

    const envelope: RealtimeEventPayload = {
      type: event.type,
      object,
      payload: { ...event },
      timestamp,
    };

    await this.realtimeService.publish(envelope);
    this.logger.debug(`Published data.record.${action} event`, { object, recordId });
  } catch (error) {
    this.logger.warn('Failed to publish data event', { object, recordId, error });
  }
}

/** The body of `ObjectQL#publishBulkDataEvent`; the method's docblock there is its contract. */
export async function publishBulkDataEvent(
  this: Pick<RealtimePublishHost, 'realtimeService' | 'logger'>,
  action: 'updated' | 'deleted',
  object: string,
  input: { matched: unknown; context?: ExecutionContext; tenantLayer0Verdict?: unknown },
): Promise<void> {
  if (!this.realtimeService) return;

  const matched = eventMatchedCount(input.matched);
  if (matched === undefined) {
    this.logger.warn(
      `No data.records.${action} event published for '${object}': the driver's multi-row result is ` +
        `not an affected-row count (IDataDriver.updateMany/deleteMany are contracted to resolve ` +
        `a number). The count is the only thing a bulk event states — it carries no records and no ` +
        `predicate — so publishing one here would assert something unverified`,
      { object },
    );
    return;
  }

  // A predicate that matched nothing changed no data, so it is not a data
  // event — the per-record path is silent for the same reason (no rows
  // written, no events). This is what keeps an idle hourly LifecycleService
  // sweep from becoming a webhook delivery per object per hour saying
  // "0 records". Debug, not warn: matching nothing is normal, not a fault.
  if (matched === 0) {
    this.logger.debug(`No data.records.${action} event for '${object}': predicate matched no rows`, { object });
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    const userId = eventUserId(input.context);
    // [#15225 / #15813] The organization the WALL named for the whole batch
    // — read off the verdict the wall RECORDED on the operation, never off
    // a row (there is none), never the context, never the posture (the
    // mirror #15706 deleted). Omitted, never `''`/`undefined`, because
    // absence has exactly one spelling in the schema.
    const organizationId = bulkEventOrganizationId(input.tenantLayer0Verdict);
    const event: BulkDataEvent = BulkDataEventSchema.parse({
      id: generateEventUuid(),
      type: `data.records.${action}`,
      object,
      ...(organizationId !== undefined ? { organizationId } : {}),
      matched,
      ...(userId !== undefined ? { userId } : {}),
      timestamp,
    });

    const envelope: RealtimeEventPayload = {
      type: event.type,
      object,
      payload: { ...event },
      timestamp,
    };

    await this.realtimeService.publish(envelope);
    this.logger.debug(`Published data.records.${action} event`, { object, matched });
  } catch (error) {
    this.logger.warn('Failed to publish bulk data event', { object, matched, error });
  }
}
