// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31829] The `scim_refused` row in the compliance ledger: one row per SCIM
 * protocol request the door refused, naming the connection.
 *
 * ## The gap this closes
 *
 * An identity provider provisions through plugin-auth's `/scim/v2/*` door. An
 * accepted write already leaves its row, attributed to the connection
 * (`scim-connection-attribution.ts`). A refused request — a bearer that
 * verifies as no connection (401), a duplicate create (409), a malformed PATCH
 * (400), an unknown user (404) — left no row anywhere, so a SCIM console and a
 * SIEM feed could not show a connection's errors.
 *
 * ## Who calls it
 *
 * plugin-auth's `handleRequest`, from the one arm every `/scim/v2/*` request
 * passes (`scim-refusal-audit.ts` there), after the answer was given and after
 * its bound admitted the refusal. It resolves this writer through the `audit`
 * service slot (beside `recordAuthEvent`) through a locally declared surface
 * and hands over an EVENT, never a row: the row shape is this package's, for
 * the reason `auth-event-audit.ts` gives. Neither package depends on the
 * other.
 *
 * ## The row
 *
 *  - `action: 'scim_refused'`;
 *  - `actor`: the connection's service principal `svc:scim:CONNECTION_ID`
 *    when the bearer verified as one — the label an accepted SCIM write's row
 *    carries — else null; `user_id` null: no human acted;
 *  - no `object_name` / `record_id`: the request was refused, so it is about
 *    no record, and the ledger's record read gate serves it under the
 *    ledger's own grant;
 *  - `tenant_id`: the organization the verified connection's credential
 *    belongs to, so an organization's administrators read their own
 *    connection's refusals; NULL when the bearer verified as none (a 401 or a
 *    request refused before the bearer was read) or the credential names no
 *    organization — a deployment-level row, served to the platform
 *    administrator;
 *  - `ip_address`: the client address plugin-auth established;
 *  - no `old_value` / `new_value`: a refusal is not a field diff;
 *  - `metadata`: `scim_connection_id` (the connection id, or `unknown` when
 *    the bearer verified as none, the key an accepted write's row carries),
 *    `presented_credential` on an unknown connection (`scim_bearer`, `other`
 *    or `none`), `resource` and `method`, `status`, `scim_type` or
 *    `error_code` (whichever the answer carried), and `suppressed` when the
 *    bound dropped refusals of the same connection since its last row.
 *
 * ⛔ Never the request body, the bearer or any part of it, its digest, an
 * attribute value, the resource id or the error's `detail` text. The event
 * has no field for any of them, and every field it has is re-checked against
 * a bounded token shape here before it reaches the row.
 *
 * ## [#33918] `scim_manager_unresolved`: a served write whose manager names no User
 *
 * The second row this writer emits, on the same slot and through the same
 * write. plugin-auth projects the SCIM Enterprise User `manager` attribute
 * onto `sys_user.manager_id` (`scim-manager-projection.ts` there); a
 * reference that names no User the connection provisioned does not refuse
 * the write (maintainer ruling record 6909383114): the write is served,
 * `manager_id` stays as it was, and the event is recorded with one operator
 * warn and one row. plugin-auth hands the event over only for a request it
 * answered below 400, after the response, and only when the warn's own bound
 * (one per connection per window) admitted it, so the rows follow the warn's
 * rate and carry its dropped count as `suppressed`.
 *
 *  - `action: 'scim_manager_unresolved'`; `actor` `svc:scim:CONNECTION_ID`;
 *    `user_id` null (an identity provider acted, no human);
 *  - `object_name: 'sys_user'`, `record_id`: the user the write was about, so
 *    the row sits on that user's ledger history and is served under that
 *    record's read gate;
 *  - `tenant_id`: the connection's organization, as for `scim_refused`;
 *  - `metadata`: `scim_connection_id`, `reference_kind` (`id`, the value
 *    looked up, or `unreadable`, a `$ref` with no readable `/Users/{id}`
 *    segment), `manager_reference` (the reference as the directory sent it,
 *    at most {@link SCIM_MANAGER_REFERENCE_LIMIT} characters, with
 *    `manager_reference_truncated` when it was longer) and `suppressed`.
 *
 * ⛔ Nothing else of the request or of the user: no body, no name, no email,
 * no other attribute. The reference is the one value recorded, and it is
 * bounded here as well as at the door.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import {
  auditFailureCauseKey,
  auditFailureCauseSummary,
  createFieldPresenceProbe,
} from './audit-writers.js';
import type { AuthEventAuditLogger } from './auth-event-audit.js';
import { SCIM_CONNECTION_ID_KEY, SCIM_SERVICE_PRINCIPAL_PREFIX } from './scim-connection-attribution.js';

/** The `sys_audit_log.action` value this writer emits. */
export const SCIM_REFUSED_AUDIT_ACTION = 'scim_refused' as const;

/** [#33918] The `sys_audit_log.action` value of a served write whose manager reference named no User. */
export const SCIM_MANAGER_UNRESOLVED_AUDIT_ACTION = 'scim_manager_unresolved' as const;

/** [#33918] The most characters of a manager reference a row records. */
export const SCIM_MANAGER_REFERENCE_LIMIT = 256;

/** `metadata.scim_connection_id` of a refusal whose bearer verified as no connection. */
export const UNKNOWN_SCIM_CONNECTION = 'unknown';

/** Which kind of credential an unverified request presented. */
export type ScimPresentedCredential = 'scim_bearer' | 'other' | 'none';

/** One refused SCIM request, in the vocabulary of what HAPPENED. */
export interface ScimRefusalAuditEvent {
  /** The connection the bearer verified as; absent when it verified as none. */
  connectionId?: string;
  /** The organization the connection's credential belongs to; the row's `tenant_id`. Ignored without `connectionId`. */
  organizationId?: string;
  /** On an unverified request: which kind of credential it presented. */
  presentedCredential?: ScimPresentedCredential;
  /** The SCIM resource type addressed (`Users`, `Groups`, …), or `?`. */
  resource: string;
  /** The HTTP method, or `?`. */
  method: string;
  /** The status the door answered (400 or above). */
  status: number;
  /** The SCIM error's `scimType`, when the answer carried one. */
  scimType?: string;
  /** The refusal's machine code, when the answer carried one. */
  errorCode?: string;
  /** The client address. */
  ipAddress?: string;
  /** Refusals of the same connection dropped since its last row. */
  suppressed?: number;
}

/**
 * [#33918] One served SCIM user write whose Enterprise `manager` reference
 * named no User the connection provisioned.
 */
export interface ScimManagerUnresolvedAuditEvent {
  /** The connection that sent the write. */
  connectionId: string;
  /** The connection's organization; the row's `tenant_id`. */
  organizationId?: string;
  /** The `sys_user` id the write was about. */
  userId: string;
  /** `id`: a value that named no User; `unreadable`: a `$ref` with no readable `/Users/{id}` segment. */
  referenceKind: 'id' | 'unreadable';
  /** The reference as the directory sent it; recorded up to {@link SCIM_MANAGER_REFERENCE_LIMIT} characters. */
  reference: string;
  /** Unresolvable references of the same connection the bound dropped since its last row. */
  suppressed?: number;
}

/** What {@link createScimRefusalAuditWriter} adds to the `audit` slot. */
export interface ScimRefusalAuditWriter {
  /**
   * Record one refused SCIM request in `sys_audit_log`. Never throws — the
   * SCIM answer is already given — and reports a lost row loudly, once per
   * cause.
   */
  recordScimRefusal(event: ScimRefusalAuditEvent): Promise<void>;
  /**
   * [#33918] Record one served SCIM write whose manager reference named no
   * User. Never throws, and reports a lost row loudly, once per cause.
   */
  recordScimManagerUnresolved(event: ScimManagerUnresolvedAuditEvent): Promise<void>;
}

export interface ScimRefusalAuditWriterOptions {
  /** Resolve the data engine at CALL time — see `AuthEventAuditSinkOptions.getEngine`. */
  getEngine(): IDataEngine | undefined;
  logger?: AuthEventAuditLogger;
}

/** A connection id the row records: the shape the credential store keys by, bounded. */
const CONNECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;

/** A resource-type token. */
const RESOURCE = /^(?:[A-Za-z][A-Za-z0-9]{0,63}|\?)$/;

/** The methods recorded; anything else is `?`. */
const METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** A SCIM `scimType` keyword. */
const SCIM_TYPE = /^[A-Za-z]{1,32}$/;

/** A machine error code. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The presented-credential kinds. */
const PRESENTED: ReadonlySet<string> = new Set<ScimPresentedCredential>(['scim_bearer', 'other', 'none']);

/** A client address: the characters of an IPv4/IPv6 text form (with a zone), bounded. */
const ADDRESS = /^[0-9A-Fa-f:.%]{1,64}$/;

function token(v: unknown, shape: RegExp): string | undefined {
  return typeof v === 'string' && shape.test(v) ? v : undefined;
}

/** JSON that cannot throw on a cyclic/odd value — same rule as the CRUD writer. */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * The ledger row of one refused SCIM request, or `null` for an event that is
 * not one (no status of 400 or above). Exported for the writer's tests.
 */
export function buildScimRefusalAuditRow(
  event: ScimRefusalAuditEvent,
  objectHasField: (objectName: string, field: string) => boolean,
): Record<string, unknown> | null {
  const status = event?.status;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 599) return null;
  const connectionId = token(event.connectionId, CONNECTION_ID);
  // The organization rides only with a verified connection.
  const organizationId = connectionId ? token(event.organizationId, CONNECTION_ID) : undefined;
  const metadata: Record<string, unknown> = {
    [SCIM_CONNECTION_ID_KEY]: connectionId ?? UNKNOWN_SCIM_CONNECTION,
  };
  if (!connectionId) {
    const presented = typeof event.presentedCredential === 'string' && PRESENTED.has(event.presentedCredential)
      ? event.presentedCredential
      : 'none';
    metadata.presented_credential = presented;
  }
  metadata.resource = token(event.resource, RESOURCE) ?? '?';
  const method = typeof event.method === 'string' ? event.method.toUpperCase() : '';
  metadata.method = METHODS.has(method) ? method : '?';
  metadata.status = status;
  const scimType = token(event.scimType, SCIM_TYPE);
  if (scimType) metadata.scim_type = scimType;
  const errorCode = token(event.errorCode, ERROR_CODE);
  if (errorCode) metadata.error_code = errorCode;
  const suppressed = event.suppressed;
  if (typeof suppressed === 'number' && Number.isInteger(suppressed) && suppressed > 0) {
    metadata.suppressed = suppressed;
  }

  const row: Record<string, unknown> = {
    action: SCIM_REFUSED_AUDIT_ACTION,
    // No human acted: an identity provider did, or nobody it could name.
    user_id: null,
    // Refused, so about no record: the read gate serves it under the ledger's own grant.
    object_name: null,
    record_id: null,
    old_value: null,
    new_value: null,
    ip_address: token(event.ipAddress, ADDRESS) ?? null,
    user_agent: null,
    // [ADR-0131 D7] The connection's organization; NULL (a deployment-level
    // row) when no connection verified or its credential names none.
    tenant_id: organizationId ?? null,
    metadata: safeStringify(metadata),
  };
  if (objectHasField('sys_audit_log', 'actor')) {
    // The label an accepted SCIM write's row carries, so a console reads a
    // connection's accepted and refused requests off one column.
    row.actor = connectionId ? `${SCIM_SERVICE_PRINCIPAL_PREFIX}${connectionId}` : null;
  }
  return row;
}

/** A `sys_user` id the row records as its `record_id`. */
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;

/** The reference kinds. */
const REFERENCE_KINDS: ReadonlySet<string> = new Set(['id', 'unreadable']);

/**
 * [#33918] The ledger row of one served SCIM write whose manager reference
 * named no User, or `null` for an event that cannot name its connection, its
 * user or its reference. Exported for the writer's tests.
 */
export function buildScimManagerUnresolvedAuditRow(
  event: ScimManagerUnresolvedAuditEvent,
  objectHasField: (objectName: string, field: string) => boolean,
): Record<string, unknown> | null {
  const connectionId = token(event?.connectionId, CONNECTION_ID);
  const userId = token(event?.userId, USER_ID);
  const kind = event?.referenceKind;
  if (!connectionId || !userId || typeof kind !== 'string' || !REFERENCE_KINDS.has(kind)) return null;
  if (typeof event.reference !== 'string' || event.reference === '') return null;
  const organizationId = token(event.organizationId, CONNECTION_ID);
  const truncated = event.reference.length > SCIM_MANAGER_REFERENCE_LIMIT;
  const metadata: Record<string, unknown> = {
    [SCIM_CONNECTION_ID_KEY]: connectionId,
    reference_kind: kind,
    manager_reference: truncated ? event.reference.slice(0, SCIM_MANAGER_REFERENCE_LIMIT) : event.reference,
  };
  if (truncated) metadata.manager_reference_truncated = true;
  const suppressed = event.suppressed;
  if (typeof suppressed === 'number' && Number.isInteger(suppressed) && suppressed > 0) {
    metadata.suppressed = suppressed;
  }
  const row: Record<string, unknown> = {
    action: SCIM_MANAGER_UNRESOLVED_AUDIT_ACTION,
    // An identity provider acted, no human.
    user_id: null,
    // The user the write was about: the row sits on that record's history.
    object_name: 'sys_user',
    record_id: userId,
    old_value: null,
    new_value: null,
    ip_address: null,
    user_agent: null,
    tenant_id: organizationId ?? null,
    metadata: safeStringify(metadata),
  };
  if (objectHasField('sys_audit_log', 'actor')) row.actor = `${SCIM_SERVICE_PRINCIPAL_PREFIX}${connectionId}`;
  return row;
}

/** Create the SCIM refusal writer for the `audit` service slot. */
export function createScimRefusalAuditWriter(opts: ScimRefusalAuditWriterOptions): ScimRefusalAuditWriter {
  const { getEngine, logger } = opts;
  let probe: ((objectName: string, field: string) => boolean) | undefined;
  let probedEngine: IDataEngine | undefined;

  /**
   * Report a lost row — once per CAUSE (`auditFailureCauseKey`), the rule the
   * auth-event sink and the data-export writer follow. A durability
   * degradation, so `error`, falling back to `warn`, never to silence. Names
   * the status and the cause; never the event's connection or address.
   */
  const reportedCauses = new Set<string>();
  const reportWriteFailure = (status: unknown, err: unknown, row: 'refusal' | 'manager' = 'refusal'): void => {
    const detail = String((err as any)?.message ?? err);
    try {
      const cause = `${row}:${auditFailureCauseKey('sys_audit_log', err)}`;
      if (reportedCauses.has(cause)) {
        logger?.debug?.(
          row === 'refusal'
            ? 'SCIM refusal audit write failed (already reported)'
            : 'SCIM manager reference audit write failed (already reported)',
          { status, err: detail, cause },
        );
        return;
      }
      reportedCauses.add(cause);
      const message =
        (row === 'refusal'
          ? `SCIM refusal audit write FAILED (${auditFailureCauseSummary(err, detail)}) — the compliance trail is ` +
            'now INCOMPLETE. The identity provider was answered its refusal exactly as it would have been without ' +
            'the ledger, so nothing downstream looks broken; only the `sys_audit_log` row recording WHICH ' +
            'connection was refused, and why, never landed, and nothing retries it. A SCIM console or SIEM feed ' +
            'reading `scim_refused` rows keeps showing a connection with no errors. Every later refusal failing '
          : `SCIM manager reference audit write FAILED (${auditFailureCauseSummary(err, detail)}) — the ` +
            'compliance trail is now INCOMPLETE. The user write was served and its operator warn was logged, so ' +
            'nothing downstream looks broken; only the `sys_audit_log` row recording that the connection sent a ' +
            'manager reference naming no User never landed, and nothing retries it. A console reading ' +
            '`scim_manager_unresolved` rows shows no such reference. Every later row failing ') +
        'THIS WAY loses its row the same way (this CAUSE is reported ONCE — raise the log level to `debug` to ' +
        'see the rest; a DIFFERENT cause gets its own `error` line). ' +
        (isMissingTableError(err, 'sys_audit_log')
          ? 'Fix: confirm `sys_audit_log` is reachable from the connection this write ran on — its ADR-0057 ' +
            '§3.6 lifecycle class routes it to the dedicated `telemetry` datasource whenever one is registered, ' +
            'so a "no such table" here usually means the write ran against a DIFFERENT datasource than the ' +
            'one the table was created in. Set `OS_TELEMETRY_DB=0` to keep every lifecycle-classed object on ' +
            'the primary datasource.'
          : 'Fix: resolve the driver fault quoted at the head of this line on the connection this write ran ' +
            (row === 'refusal'
              ? 'on — every refused SCIM request that hits it loses its row until it is resolved.'
              : 'on — every unresolvable SCIM manager reference that hits it loses its row until it is resolved.'));
      if (logger?.error) {
        logger.error(message, err instanceof Error ? err : new Error(detail), { status });
      } else {
        logger?.warn?.(message, { status, err: detail });
      }
    } catch {
      /* logging must never reach the SCIM answer */
    }
  };

  /**
   * Write the ledger row. A NAMED callee so `pnpm check:durability-log-level`
   * anchors on it (`DURABILITY_CRITICAL_CALLEES`): a later edit cannot walk
   * the failure report above back down to `warn`.
   */
  const persistScimRefusalAuditRow = async (engine: IDataEngine, row: Record<string, unknown>): Promise<void> => {
    await engine.insert('sys_audit_log', row, { context: { isSystem: true } });
  };

  return {
    async recordScimRefusal(event: ScimRefusalAuditEvent): Promise<void> {
      if (!event) return;
      const engine = getEngine();
      if (!engine) return;
      if (probe === undefined || probedEngine !== engine) {
        probe = createFieldPresenceProbe(engine);
        probedEngine = engine;
      }
      let row: Record<string, unknown> | null;
      try {
        row = buildScimRefusalAuditRow(event, probe);
      } catch (err) {
        // A row that cannot be built is a row that does not land: reported as one.
        reportWriteFailure(event.status, err);
        return;
      }
      if (!row) return;
      try {
        await persistScimRefusalAuditRow(engine, row);
      } catch (err) {
        // #5226's class on the SCIM door: a DURABILITY degradation — the
        // refusal was answered, the system looks normal, and the row that
        // says which connection was refused is simply absent.
        reportWriteFailure(event.status, err);
      }
    },

    async recordScimManagerUnresolved(event: ScimManagerUnresolvedAuditEvent): Promise<void> {
      if (!event) return;
      const engine = getEngine();
      if (!engine) return;
      if (probe === undefined || probedEngine !== engine) {
        probe = createFieldPresenceProbe(engine);
        probedEngine = engine;
      }
      let row: Record<string, unknown> | null;
      try {
        row = buildScimManagerUnresolvedAuditRow(event, probe);
      } catch (err) {
        reportWriteFailure(undefined, err, 'manager');
        return;
      }
      if (!row) return;
      try {
        await persistScimRefusalAuditRow(engine, row);
      } catch (err) {
        // The same durability degradation as a lost refusal row: the write
        // was served, the system looks normal, and the row is absent.
        reportWriteFailure(undefined, err, 'manager');
      }
    },
  };
}
