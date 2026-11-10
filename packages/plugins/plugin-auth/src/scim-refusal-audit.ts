// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31829] A SCIM request the door refuses leaves one `scim_refused` row in
 * the compliance ledger, bounded per connection.
 *
 * ## The gap
 *
 * An identity provider (Okta, Entra ID) provisions through `/scim/v2/*`. An
 * accepted write already leaves its row, attributed to the connection
 * (`svc:scim:CONNECTION_ID`, `scim-connection-service.ts`). A refused one —
 * a bearer that verifies as no connection (401), a duplicate create (409), a
 * malformed PATCH (400), an unknown user (404) — wrote nothing anywhere, so
 * neither a SCIM console nor a SIEM feed could show a connection's errors.
 *
 * ## Where it is observed
 *
 * `handleRequest`'s SCIM arm (`auth-manager-request-routing.ts`), the one
 * place every `/scim/v2/*` request passes, after the vendor answered. A
 * response with status 400 or above is a refusal. The connection is read off
 * the request's SCIM scope, which the bearer verifier filled
 * (`recordScimRequestConnection`). A bearer that verified as nothing leaves the
 * scope empty, and the row names no connection.
 *
 * [#32116] One refusal reads the connection a second way. The vendor refuses
 * a body that fails its schema (a malformed PATCH, a create with no
 * `userName`) BEFORE its bearer verifier runs, so the scope is empty although
 * the bearer may be valid. Only when the scope names no connection AND the
 * presented credential carries the minted SCIM prefix, the bearer is resolved
 * ONCE — after the response, and only for a refusal the bound admitted —
 * through the verifier's own lookup ({@link ScimRefusalConnectionResolver},
 * `findLiveScimCredential` in `scim-connection-service.ts`): the keyed digest
 * is computed there, matched on `sys_scim_connection_credential` with the
 * verifier's liveness predicate, and never returned, stored, logged or put in
 * the event. The lookup is a READ: it writes nothing, the credential's
 * last-use stamp included, so a refused request is not counted as a use.
 * Only a live credential names a connection; a forged, revoked or expired
 * bearer, a lookup that fails and a credential of any other shape leave the
 * row naming none, exactly as before.
 *
 * ## Who writes the row
 *
 * plugin-audit, through the `audit` service slot's optional
 * `recordScimRefusal` member (`AuthEventAuditSurface`). plugin-auth hands it
 * an EVENT, never a row, and takes no dependency on that package. No slot, or
 * a slot without the member: no row, and the SCIM answer is unchanged. The
 * event is handed over after the response ({@link runAfterResponse}), so the
 * answer never waits on the ledger; the writer reports its own lost rows.
 *
 * ## What the row carries, and what it never does
 *
 * The connection (or nothing, plus which kind of credential was presented:
 * one carrying the minted SCIM prefix, another, or none), the resource type
 * and method, the status, the SCIM `scimType` or the machine `code` the
 * answer carried, and the client address. Each is reduced to a bounded token
 * before it leaves this module ({@link scimRefusalEventFor}).
 *
 * ⛔ Never the request body, the bearer, any part of it, its digest, the
 * resource id in the path or the error's `detail` text — the vendor fills
 * `detail` with the attribute value it refused (a duplicate `userName`).
 *
 * ## The bound
 *
 * A misconfigured identity provider retries in a loop, so the rows are
 * bounded ({@link ScimRefusalAuditBound}):
 *
 *  - per KEY — the connection, or for a bearer that verified as none the
 *    client address — at most {@link SCIM_REFUSAL_AUDIT_ROWS_PER_KEY} rows in a
 *    10-minute window from the key's first row of the window; a schema-refused
 *    request whose bearer resolves to a connection afterwards (#32116) stays
 *    counted on its address, because the bound admits BEFORE the lookup;
 *  - across all keys, at most {@link SCIM_REFUSAL_AUDIT_ROW_CAP} rows per
 *    10-minute window, and once that cap drops a row, one operator `warn` line
 *    for the window;
 *  - every refusal the bound drops is COUNTED on its key, and the next row
 *    written for that key carries the count as `suppressed`, so a flood is
 *    visible in the ledger as a number rather than lost;
 *  - the keys it tracks are bounded too, so rotating addresses cannot grow its
 *    memory without limit; a key forgotten that way loses its pending count.
 *
 * The bound is held in process memory, one per audit sink — the shape of the
 * IP allow-list refusal bound (`ip-allow-list-refusal-audit.ts`). It holds per
 * process: N replicas of the server write up to N times as many rows.
 */

import type { AuthEventAuditSurface, ScimRefusalAuditEventInput } from './auth-session-audit.js';
import { canonicalClientAddress } from './client-address-canonical.js';
import { runAfterResponse } from './run-after-response.js';
import { SCIM_BEARER_PREFIX } from './scim-connection-service.js';

/** The window a key's rows are counted in. */
export const SCIM_REFUSAL_AUDIT_WINDOW_MS = 10 * 60_000;

/** The rows one key (a connection, or an unverified client address) writes per window. */
export const SCIM_REFUSAL_AUDIT_ROWS_PER_KEY = 20;

/** The rows written per window across every key. */
export const SCIM_REFUSAL_AUDIT_ROW_CAP = 1000;

/** The keys tracked at once; past it the stalest is forgotten. */
const TRACKED_KEY_CAP = 10_000;

export interface ScimRefusalAuditBoundOptions {
  windowMs?: number;
  rowsPerKey?: number;
  rowCap?: number;
  trackedKeyCap?: number;
  now?: () => number;
}

/** What the bound answers for a refusal it admits. */
export interface ScimRefusalAdmission {
  /** Refusals of this key dropped since its last written row. */
  suppressed: number;
}

/** The module note's bound, on one clock. */
export class ScimRefusalAuditBound {
  private readonly windowMs: number;
  private readonly rowsPerKey: number;
  private readonly rowCap: number;
  private readonly trackedKeyCap: number;
  private readonly now: () => number;
  private readonly perKey = new Map<string, { start: number; written: number; suppressed: number }>();
  private windowStart: number | undefined;
  private rowsInWindow = 0;
  private warnedInWindow = false;

  constructor(options: ScimRefusalAuditBoundOptions = {}) {
    this.windowMs = options.windowMs ?? SCIM_REFUSAL_AUDIT_WINDOW_MS;
    this.rowsPerKey = options.rowsPerKey ?? SCIM_REFUSAL_AUDIT_ROWS_PER_KEY;
    this.rowCap = options.rowCap ?? SCIM_REFUSAL_AUDIT_ROW_CAP;
    this.trackedKeyCap = options.trackedKeyCap ?? TRACKED_KEY_CAP;
    // Read through `Date.now` at each call, so a clock the host (or a test) swaps is the one counted on.
    this.now = options.now ?? (() => Date.now());
  }

  /** How many keys are tracked now. */
  get trackedKeys(): number {
    return this.perKey.size;
  }

  /**
   * Count one refusal of `key`. Answers the admission when it writes a row —
   * carrying the count dropped since the key's last row — or `undefined` when
   * the bound drops it (then the drop is counted on the key, and `warn` is
   * called once per window when it was the cross-key cap that dropped it).
   */
  admit(key: string, warn?: (line: string) => void): ScimRefusalAdmission | undefined {
    const now = this.now();
    let entry = this.perKey.get(key);
    if (!entry) {
      this.makeRoom(now);
      entry = { start: now, written: 0, suppressed: 0 };
      this.perKey.set(key, entry);
    } else if (now - entry.start >= this.windowMs) {
      // A new window for the key; its pending count is carried, never reset.
      entry.start = now;
      entry.written = 0;
      this.perKey.delete(key);
      this.perKey.set(key, entry);
    }
    if (entry.written >= this.rowsPerKey) {
      entry.suppressed += 1;
      return undefined;
    }

    if (this.windowStart === undefined || now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.rowsInWindow = 0;
      this.warnedInWindow = false;
    }
    if (this.rowsInWindow >= this.rowCap) {
      entry.suppressed += 1;
      if (!this.warnedInWindow) {
        this.warnedInWindow = true;
        warn?.(
          `[auth] Refused SCIM requests: ${this.rowCap} scim_refused rows were written to sys_audit_log in this ` +
            `${Math.round(this.windowMs / 60_000)}-minute window, the most one window takes, so further refused ` +
            'SCIM requests are answered exactly as before but are only counted until ' +
            `${new Date(this.windowStart + this.windowMs).toISOString()}; the next row written for each ` +
            'connection carries the count it dropped (metadata.suppressed). A flood of this size is usually an ' +
            'identity provider retrying a refused request in a loop, or a scanner.',
        );
      }
      return undefined;
    }
    this.rowsInWindow += 1;
    entry.written += 1;
    const suppressed = entry.suppressed;
    entry.suppressed = 0;
    return { suppressed };
  }

  /** Keep the tracked keys under their cap: drop the expired with nothing pending, then the stalest. */
  private makeRoom(now: number): void {
    if (this.perKey.size < this.trackedKeyCap) return;
    for (const [key, entry] of this.perKey) {
      if (now - entry.start >= this.windowMs && entry.suppressed === 0) this.perKey.delete(key);
    }
    while (this.perKey.size >= this.trackedKeyCap) {
      const stalest = this.perKey.keys().next();
      if (stalest.done) break;
      this.perKey.delete(stalest.value);
    }
  }
}

/** One bound per audit sink, held weakly: per process, and never shared between test doubles. */
const bounds = new WeakMap<object, ScimRefusalAuditBound>();

/** The bound the `scim_refused` rows written to `sink` are counted by. */
export function scimRefusalAuditBoundFor(sink: AuthEventAuditSurface): ScimRefusalAuditBound {
  let bound = bounds.get(sink);
  if (!bound) {
    bound = new ScimRefusalAuditBound();
    bounds.set(sink, bound);
  }
  return bound;
}

/** The SCIM protocol prefix, under the better-auth base path. */
const SCIM_PATH_PREFIX = '/scim/v2/';

/** A resource-type segment the row records (`Users`, `Groups`, `ServiceProviderConfig`, …). */
const RESOURCE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

/** The methods a SCIM request is made with. */
const SCIM_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** A SCIM `scimType` (RFC 7644 §3.12): one camelCase keyword, bounded. */
const SCIM_TYPE = /^[A-Za-z]{1,32}$/;

/** A machine error code: SCREAMING_SNAKE, bounded — never free text. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The most of a refusal's body read to find its `scimType` / `code`. */
const ERROR_BODY_LIMIT = 16 * 1024;

/** The longest connection id recorded; a longer one is not an id this store mints. */
const CONNECTION_ID_LIMIT = 255;

/** The resource type a SCIM endpoint path addresses — never the resource id after it. */
export function scimResourceOf(endpointPath: string | undefined): string {
  if (!endpointPath || !endpointPath.startsWith(SCIM_PATH_PREFIX)) return '?';
  const segment = endpointPath.slice(SCIM_PATH_PREFIX.length).split('/')[0] ?? '';
  return RESOURCE.test(segment) ? segment : '?';
}

/**
 * Which kind of credential a request presented, read off its `Authorization`
 * header's SHAPE alone: the minted SCIM prefix, another bearer or scheme, or
 * none. Nothing of the credential is returned.
 */
export function presentedCredentialOf(authorization: string | null | undefined): 'scim_bearer' | 'other' | 'none' {
  if (typeof authorization !== 'string' || authorization.trim() === '') return 'none';
  return scimBearerOf(authorization) !== undefined ? 'scim_bearer' : 'other';
}

/** The presented bearer when it carries the minted SCIM prefix; `undefined` otherwise. Never leaves this module. */
function scimBearerOf(authorization: string | null | undefined): string | undefined {
  if (typeof authorization !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(authorization.trim());
  return match && match[1]!.startsWith(SCIM_BEARER_PREFIX) ? match[1] : undefined;
}

/**
 * [#32116] Resolves a presented SCIM bearer to the connection a LIVE credential
 * names, by the verifier's own read-only lookup — `null` when none does. It
 * reads and never writes (no last-use stamp), and answers nothing of the
 * bearer or its digest.
 */
export type ScimRefusalConnectionResolver = (
  token: string,
) => Promise<{ connectionId: string; organizationId?: string } | null>;

/**
 * The observation with the connection a schema-refused request's bearer
 * resolves to, when the scope named none and the bearer is a live SCIM
 * credential (the module note); otherwise the observation unchanged. Never
 * throws: a lookup that fails names no connection.
 */
async function withResolvedConnection(
  observation: ScimRefusalObservation,
  resolve: ScimRefusalConnectionResolver | undefined,
): Promise<ScimRefusalObservation> {
  if (observation.connectionId || !resolve) return observation;
  const bearer = scimBearerOf(observation.authorization);
  if (bearer === undefined) return observation;
  try {
    const resolved = await resolve(bearer);
    if (!resolved || typeof resolved.connectionId !== 'string' || resolved.connectionId === '') return observation;
    const { authorization: _presented, ...rest } = observation;
    return {
      ...rest,
      connectionId: resolved.connectionId,
      ...(resolved.organizationId ? { organizationId: resolved.organizationId } : {}),
    };
  } catch {
    return observation;
  }
}

/** What `handleRequest` observed of one refused SCIM request. */
export interface ScimRefusalObservation {
  endpointPath: string | undefined;
  method: string;
  status: number;
  /** The connection the request's SCIM scope names, when the bearer verified as one. */
  connectionId?: string;
  /** The organization the scope recorded beside the connection, when it recorded one. */
  organizationId?: string;
  /** The request's `Authorization` header, read for its shape only (unverified requests). */
  authorization?: string | null;
  /** The client address `handleRequest` established. */
  clientAddress?: string;
}

/**
 * The event of one refused SCIM request. `body` is the parsed refusal body
 * (or anything else): only its `scimType` and `code` are read, and only when
 * they are bounded tokens.
 */
export function scimRefusalEventFor(
  observation: ScimRefusalObservation,
  body: unknown,
  suppressed = 0,
): ScimRefusalAuditEventInput {
  const method = observation.method.toUpperCase();
  const connectionId =
    typeof observation.connectionId === 'string'
    && observation.connectionId.length > 0
    && observation.connectionId.length <= CONNECTION_ID_LIMIT
      ? observation.connectionId
      : undefined;
  // The organization rides only with a connection: a request whose bearer
  // verified as none names no organization, whatever the observation says.
  const organizationId =
    connectionId
    && typeof observation.organizationId === 'string'
    && observation.organizationId.length > 0
    && observation.organizationId.length <= CONNECTION_ID_LIMIT
      ? observation.organizationId
      : undefined;
  const fields = (body !== null && typeof body === 'object' ? body : {}) as { scimType?: unknown; code?: unknown };
  const scimType = typeof fields.scimType === 'string' && SCIM_TYPE.test(fields.scimType) ? fields.scimType : undefined;
  const errorCode = typeof fields.code === 'string' && ERROR_CODE.test(fields.code) ? fields.code : undefined;
  const ipAddress = canonicalClientAddress(observation.clientAddress);
  return {
    ...(connectionId
      ? { connectionId, ...(organizationId ? { organizationId } : {}) }
      : { presentedCredential: presentedCredentialOf(observation.authorization) }),
    resource: scimResourceOf(observation.endpointPath),
    method: SCIM_METHODS.has(method) ? method : '?',
    status: observation.status,
    ...(scimType ? { scimType } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(ipAddress ? { ipAddress } : {}),
    ...(suppressed > 0 ? { suppressed } : {}),
  };
}

/** The refusal's JSON body, read from a clone up to {@link ERROR_BODY_LIMIT}; `undefined` otherwise. Never throws. */
async function refusalBodyOf(response: Response): Promise<unknown> {
  try {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > ERROR_BODY_LIMIT) return undefined;
    const text = await response.text();
    if (text.length > ERROR_BODY_LIMIT) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The key a refusal is bounded by: its connection, else its client address. */
function boundKeyOf(observation: ScimRefusalObservation): string {
  if (observation.connectionId) return `connection:${observation.connectionId}`;
  return `address:${canonicalClientAddress(observation.clientAddress) ?? ''}`;
}

/**
 * Hand one refused SCIM request to the sink's `recordScimRefusal`, after the
 * bound admitted it, once the response has been answered. A response below
 * 400, a missing sink, a sink without the member and a dropped refusal are
 * all no-ops. Never throws, and never delays or changes `response`: the body
 * is read from a clone taken here, before the caller hands `response` on.
 *
 * `resolveConnection` names the connection of a request refused before its
 * bearer verified (the module note): called at most once, inside the
 * after-response task, and only for a refusal the bound admitted — so the
 * bound is keyed as before (the client address) and a flood the bound drops
 * costs no lookup.
 */
export function observeScimRefusal(
  sink: AuthEventAuditSurface | undefined,
  response: Response,
  observation: ScimRefusalObservation,
  warn?: (line: string) => void,
  resolveConnection?: ScimRefusalConnectionResolver,
): void {
  try {
    if (response.status < 400) return;
    if (!sink || typeof sink.recordScimRefusal !== 'function') return;
    const admission = scimRefusalAuditBoundFor(sink).admit(boundKeyOf(observation), warn);
    if (!admission) return;
    const copy = response.clone();
    runAfterResponse(
      async () => {
        const resolved = await withResolvedConnection(observation, resolveConnection);
        const body = await refusalBodyOf(copy);
        await sink.recordScimRefusal!(scimRefusalEventFor(resolved, body, admission.suppressed));
      },
      () => {
        /* the writer reports its own lost rows; the SCIM answer is already given */
      },
    );
  } catch {
    /* bookkeeping never changes a SCIM answer */
  }
}
