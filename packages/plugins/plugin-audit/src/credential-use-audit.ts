// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31796] The `credential_use` row in the compliance ledger: one row per
 * credential per use window, written when an API key or an OAuth access token
 * admits a request.
 *
 * ## The gap this closes
 *
 * An API key or an OAuth access token admitting a request left no ledger row
 * naming the credential: the only trace was the credential's own coarse
 * last-use stamp, mirrored by the CRUD writer as an `update` about the
 * credential row, written as the system and naming no principal. An
 * enterprise audit export or SIEM stream asking "which credential acted as
 * whom, and when" had nothing to read.
 *
 * ## When a row is written: the stamp IS the window
 *
 * Each credential kind already has exactly one throttled use stamp, written at
 * the shared admission point of that kind, and nothing else writes it:
 *
 *  - an API key: `sys_api_key.last_used_at`, written by the shared
 *    key-admission seam (`resolveApiKeyAdmission` in `@objectstack/core`,
 *    `stampAdmittedKey`) at most once per key per
 *    `API_KEY_LAST_USED_STAMP_INTERVAL_MS`. Every door that admits a key
 *    reaches that seam (REST, the runtime dispatcher and its `/mcp` face, the
 *    stdio MCP transport, the storage doors), so every door counts;
 *  - an OAuth access token: `sys_oauth_consent.last_used_at`, written by
 *    plugin-auth once the `/mcp` door has admitted a call made with a token
 *    minted under that consent (`mcp-client-last-use.ts`), at most once per
 *    consent per clock hour. The `/mcp` HTTP door is the only door that
 *    accepts one.
 *
 * A server-only `skip_consent` OAuth client has no consent row, so it has no
 * stamp to recognise. For it, the same plugin-auth stamp point hands the use
 * to this package through the `audit` slot (`recordCredentialUse`), under the
 * same throttle: its per-process memory keyed by (client, user, organization)
 * and the same clock hour. That row names the client's application row
 * (`sys_oauth_application`) as the credential.
 *
 * So this writer adds no timer and no throttle of its own: it recognises the
 * stamp write itself, in the same `afterUpdate` the CRUD writer mirrors it in,
 * and writes one `credential_use` row for it. A second admission inside the
 * window writes no stamp, so it writes no row; the first one after the window
 * writes both. The stamp is recognised by its CHANGED FIELDS, as the sign-in
 * stamp is (`sign-in-stamp.ts`): an update of the credential row whose
 * changed fields include `last_used_at` and are all the stamp's own. Both
 * columns are `readonly` with that stamp as their one writer, so no other
 * write matches.
 *
 * ## The row
 *
 *  - `action: 'credential_use'`;
 *  - `user_id` and `actor`: the credential's owner, read off the stored
 *    credential row (`sys_api_key.user_id`, `sys_oauth_consent.user_id`). The
 *    owner is the principal the credential admitted the request as;
 *  - `object_name` / `record_id`: the credential row, so the ledger's record
 *    read gate judges the row as it judges any row about that credential, and
 *    a reader can go from the row to the credential and back;
 *  - `tenant_id`: the organization the credential is bound to
 *    (`sys_api_key.active_organization_id`, `sys_oauth_consent.reference_id`),
 *    or none, which makes a deployment-level row;
 *  - `metadata`: `credential_kind` (`api_key` / `oauth_access_token`),
 *    `credential_id` (the row id again, for a consumer that reads only
 *    `metadata`), `used_at` (the stamp's own value: the start of the window the
 *    use fell in) and, for an OAuth token, the `client_id` of the application
 *    that presented it.
 *
 * ⛔ Never the secret: no raw key, no token, no `sys_api_key.key` hash and no
 * key prefix. The row is built from the named columns above and nothing else,
 * so a column a credential row gains later never reaches it.
 *
 * ⚠️ Not on the row yet: the source address and the user agent
 * (`ip_address` / `user_agent` stay null). Neither stamp point holds them: the
 * key seam reads only the request headers, without the transport's peer
 * address or the `server.trustProxy` rule that decides which address to
 * believe, and the OAuth stamp is handed the verified principal alone. A
 * forwarded-address header read without that rule is caller input, so it is
 * not recorded.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/types';
import { auditFailureCauseKey, auditFailureCauseSummary, createFieldPresenceProbe } from './audit-writers.js';
import type { AuthEventAuditLogger } from './auth-event-audit.js';

/** The `sys_audit_log.action` value this writer emits. */
export const CREDENTIAL_USE_AUDIT_ACTION = 'credential_use' as const;

/** The credential kinds a `credential_use` row names (`metadata.credential_kind`). */
export type CredentialUseKind = 'api_key' | 'oauth_access_token';

/**
 * One credential kind's use stamp: the object it lives on, the fields the
 * stamp may write, and the columns the row reads off the stored credential.
 */
interface CredentialUseStamp {
  kind: CredentialUseKind;
  /** The fields the stamp writes. Every changed field must be one of these. */
  stampFields: ReadonlySet<string>;
  /** The column the owner is read from. */
  ownerField: string;
  /** The column the bound organization is read from. */
  organizationField: string;
  /** The column naming the presenting application, when the kind has one. */
  clientField?: string;
}

/** The field every stamp writes, and the field that makes a write a use. */
const LAST_USED_AT = 'last_used_at';

/**
 * The two use stamps, by the object they live on. The API-key stamp may also
 * write `expires_at` (the legacy grace end, stamped on a key's first admitted
 * use), which is part of the same write.
 */
const CREDENTIAL_USE_STAMPS: ReadonlyMap<string, CredentialUseStamp> = new Map<string, CredentialUseStamp>([
  [
    'sys_api_key',
    {
      kind: 'api_key',
      stampFields: new Set([LAST_USED_AT, 'expires_at']),
      ownerField: 'user_id',
      organizationField: 'active_organization_id',
    },
  ],
  [
    'sys_oauth_consent',
    {
      kind: 'oauth_access_token',
      stampFields: new Set([LAST_USED_AT]),
      ownerField: 'user_id',
      organizationField: 'reference_id',
      clientField: 'client_id',
    },
  ],
]);

/** The objects whose use stamp this writer recognises. */
export const CREDENTIAL_USE_STAMP_OBJECTS: readonly string[] = Object.freeze([...CREDENTIAL_USE_STAMPS.keys()]);

/**
 * Every object a `credential_use` row may name as its credential, with the
 * kind it implies: the two stamped objects, and the application row of a
 * `skip_consent` OAuth client, which has no consent to stamp.
 */
const CREDENTIAL_OBJECT_KINDS: ReadonlyMap<string, CredentialUseKind> = new Map<string, CredentialUseKind>([
  ['sys_api_key', 'api_key'],
  ['sys_oauth_consent', 'oauth_access_token'],
  ['sys_oauth_application', 'oauth_access_token'],
]);

/** Fields that change on every write and say nothing about it. */
const NOISE_FIELDS: ReadonlySet<string> = new Set(['updated_at', 'updated_by', 'created_at', 'created_by']);

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function comparable(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** The fields whose value differs between the two sides, noise left out. */
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (NOISE_FIELDS.has(key)) continue;
    if (comparable(before[key]) !== comparable(after[key])) changed.push(key);
  }
  return changed;
}

/** One recognised use, in the vocabulary of what HAPPENED. */
export interface CredentialUseEvent {
  kind: CredentialUseKind;
  /** The credential row's object. */
  objectName: string;
  /** The credential row's id. */
  credentialId: string;
  /** The credential's owner: the principal it admitted the request as. */
  userId: string;
  /** The organization the credential is bound to, when it is bound to one. */
  organizationId?: string;
  /** The application that presented an OAuth token. */
  clientId?: string;
  /** The stamp's value: the start of the use window. */
  usedAt?: string;
}

function instantString(v: unknown): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  return nonEmpty(v);
}

/**
 * The use an `afterUpdate` of `objectName` records, or `undefined` when the
 * write is not a use stamp: the object has no stamp, `last_used_at` did not
 * change, or another field changed beside the stamp's own. `before` / `after`
 * are the stored row before and after the write.
 */
export function credentialUseOf(
  objectName: string,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): CredentialUseEvent | undefined {
  const stamp = CREDENTIAL_USE_STAMPS.get(objectName);
  if (!stamp || !after || typeof after !== 'object') return undefined;
  const changed = changedFields(before && typeof before === 'object' ? before : {}, after);
  if (!changed.includes(LAST_USED_AT)) return undefined;
  if (!changed.every((field) => stamp.stampFields.has(field))) return undefined;
  const credentialId = nonEmpty(after.id) ?? nonEmpty(before?.id);
  const userId = nonEmpty(after[stamp.ownerField]) ?? nonEmpty(before?.[stamp.ownerField]);
  if (!credentialId || !userId) return undefined;
  const organizationId = nonEmpty(after[stamp.organizationField]) ?? nonEmpty(before?.[stamp.organizationField]);
  const clientId = stamp.clientField
    ? nonEmpty(after[stamp.clientField]) ?? nonEmpty(before?.[stamp.clientField])
    : undefined;
  const usedAt = instantString(after[LAST_USED_AT]);
  return {
    kind: stamp.kind,
    objectName,
    credentialId,
    userId,
    ...(organizationId ? { organizationId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(usedAt ? { usedAt } : {}),
  };
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
 * The row for one use — exported so the shape is pinned without an engine.
 * `objectHasField` answers whether the deployed ledger has the
 * conditionally-present `actor` column (`createFieldPresenceProbe`).
 */
export function buildCredentialUseAuditRow(
  event: CredentialUseEvent,
  objectHasField: (objectName: string, field: string) => boolean = () => true,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    credential_kind: event.kind,
    credential_id: event.credentialId,
    used_at: event.usedAt ?? null,
    ...(event.kind === 'oauth_access_token' ? { client_id: event.clientId ?? null } : {}),
  };
  const row: Record<string, unknown> = {
    action: CREDENTIAL_USE_AUDIT_ACTION,
    user_id: event.userId,
    object_name: event.objectName,
    record_id: event.credentialId,
    old_value: null,
    new_value: null,
    // Not established at either stamp point (module note).
    ip_address: null,
    user_agent: null,
    tenant_id: event.organizationId ?? null,
    metadata: safeStringify(metadata),
  };
  // ADR-0014 D2's principal label: the owner the credential admitted the
  // request as. Conditionally present, as on every writer of this ledger.
  if (objectHasField('sys_audit_log', 'actor')) row.actor = event.userId;
  return row;
}


/** What {@link createCredentialUseAuditWriter} adds to the `audit` slot. */
export interface CredentialUseAuditWriter {
  /**
   * Record one credential use in `sys_audit_log`. An event that names no
   * credential object this writer knows, a kind that does not match it, or
   * no credential or owner writes nothing. Never throws — an audit write must
   * never change the answer the admitted request gets — and reports a lost
   * row loudly, once per cause.
   */
  recordCredentialUse(event: CredentialUseEvent): Promise<void>;
}

export interface CredentialUseAuditWriterOptions {
  /** Resolve the data engine at CALL time — see `AuthEventAuditSinkOptions.getEngine`. */
  getEngine(): IDataEngine | undefined;
  logger?: AuthEventAuditLogger;
}

/** Create the credential-use writer for the `audit` service slot. */
export function createCredentialUseAuditWriter(opts: CredentialUseAuditWriterOptions): CredentialUseAuditWriter {
  const { getEngine, logger } = opts;
  let probe: ((objectName: string, field: string) => boolean) | undefined;
  let probedEngine: IDataEngine | undefined;

  /**
   * Report a lost row — once per CAUSE (`auditFailureCauseKey`), the rule and
   * the reasons `auth-event-audit.ts` records for its own sink. A durability
   * degradation, so `error`, falling back to `warn`, never to silence.
   */
  const reportedCauses = new Set<string>();
  const reportWriteFailure = (event: CredentialUseEvent, err: unknown): void => {
    const detail = String((err as any)?.message ?? err);
    try {
      const cause = auditFailureCauseKey(event.objectName, err);
      if (reportedCauses.has(cause)) {
        logger?.debug?.('Credential-use audit write failed (already reported)', {
          kind: event.kind,
          credentialId: event.credentialId,
          err: detail,
          cause,
        });
        return;
      }
      reportedCauses.add(cause);
      const message =
        `Credential-use audit write FAILED (${auditFailureCauseSummary(err, detail)}) — the compliance trail is ` +
        `now INCOMPLETE. The request the ${event.kind} admitted was served exactly as it would have been without ` +
        'the ledger, so nothing downstream looks broken; only the `sys_audit_log` row recording WHICH credential ' +
        'acted as WHOM in this window never landed, and nothing retries it (the next row for this credential is ' +
        'written when its next window opens). Every later credential use failing THIS WAY loses its row the same ' +
        'way (this CAUSE is reported ONCE — raise the log level to `debug` to see the rest; a DIFFERENT cause gets ' +
        'its own `error` line). ' +
        (isMissingTableError(err, 'sys_audit_log')
          ? 'Fix: confirm `sys_audit_log` is reachable from the connection this write ran on — its ADR-0057 ' +
            '§3.6 lifecycle class routes it to the dedicated `telemetry` datasource whenever one is registered, ' +
            'so a "no such table" here usually means the write ran against a DIFFERENT datasource than the ' +
            'one the table was created in. Set `OS_TELEMETRY_DB=0` to keep every lifecycle-classed object on ' +
            'the primary datasource.'
          : 'Fix: resolve the driver fault quoted at the head of this line on the connection this write ran ' +
            'on — every credential use that hits it loses its row until it is resolved.');
      if (logger?.error) {
        logger.error(message, err instanceof Error ? err : new Error(detail), {
          kind: event.kind,
          credentialId: event.credentialId,
        });
      } else {
        logger?.warn?.(message, { kind: event.kind, credentialId: event.credentialId, err: detail });
      }
    } catch {
      /* logging must never break the admitted request */
    }
  };

  /**
   * Write the ledger row. A NAMED callee so `pnpm check:durability-log-level`
   * anchors on it (`DURABILITY_CRITICAL_CALLEES`): a later edit cannot walk
   * the failure report above back down to `warn`.
   */
  const persistCredentialUseAuditRow = async (
    engine: IDataEngine,
    row: Record<string, unknown>,
  ): Promise<void> => {
    await engine.insert('sys_audit_log', row, { context: { isSystem: true } });
  };

  return {
    async recordCredentialUse(event: CredentialUseEvent): Promise<void> {
      if (!event || typeof event !== 'object') return;
      if (CREDENTIAL_OBJECT_KINDS.get(event.objectName) !== event.kind) return;
      if (!nonEmpty(event.credentialId) || !nonEmpty(event.userId)) return;
      const engine = getEngine();
      if (!engine) return;
      try {
        if (probe === undefined || probedEngine !== engine) {
          probe = createFieldPresenceProbe(engine);
          probedEngine = engine;
        }
        await persistCredentialUseAuditRow(engine, buildCredentialUseAuditRow(event, probe));
      } catch (err) {
        // #5226's class on the credential seam: a DURABILITY degradation — the
        // request was served and the stamp is on disk, the system looks
        // normal, and the row that names the credential and its principal is
        // absent.
        reportWriteFailure(event, err);
      }
    },
  };
}

/** The engine slice {@link installCredentialUseAudit} needs. */
export interface CredentialUseHookEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => Promise<void> | void,
    options?: { object?: string | string[]; packageId?: string },
  ): void;
}

/**
 * Install the stamp recogniser on `engine`: an `afterUpdate` hook on the two
 * stamped credential objects that hands each recognised use to `writer`.
 * Never throws into the write it observes: the stamp, and the request the
 * credential admitted, must not change because of the ledger.
 */
export function installCredentialUseAudit(
  engine: CredentialUseHookEngine,
  writer: CredentialUseAuditWriter,
  opts: { packageId?: string } = {},
): void {
  // An engine with no hook seam stamps nothing this can see (the same
  // early return `installAuditWriters` takes).
  if (!engine || typeof engine.registerHook !== 'function') return;
  const onStamp = async (ctx: any): Promise<void> => {
    let event: CredentialUseEvent | undefined;
    try {
      event = credentialUseOf(ctx?.object, ctx?.previous ?? null, ctx?.result ?? null);
    } catch {
      return;
    }
    if (event) await writer.recordCredentialUse(event);
  };
  engine.registerHook('afterUpdate', onStamp, {
    object: [...CREDENTIAL_USE_STAMP_OBJECTS],
    ...(opts.packageId ? { packageId: opts.packageId } : {}),
  });
}
