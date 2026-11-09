// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30924] A sign-in the ADR-0069 D5 IP allow-list refuses leaves one
 * `login_failed` row in the compliance ledger, bounded per client address.
 *
 * ## Which refusals, which row
 *
 * Two doors refuse a sign-in by its client address, and both record it here:
 *
 *  - **The deployment's list**, judged by the auth-route middleware
 *    `AuthPlugin.registerAuthRoutes` mounts in front of better-auth. It refuses
 *    before better-auth resolves an account, so the row names the account only
 *    where the request's `email` resolves to one
 *    (`AuthManager.resolveRefusedSignInAccountId`, the password sign-in's own
 *    account question), and is written with no subject otherwise. Only a
 *    `/sign-in/*` endpoint is recorded: the same gate refuses a session read or
 *    a sign-out from the same address, and neither is a sign-in.
 *  - **An organization's own list**, judged when better-auth creates the
 *    session (`SESSION_SCOPING_REFUSAL`, `auth-manager-database-hooks.ts`).
 *    The credential check has passed there, so the row names the account and
 *    the organization. A refused switch of the active organization is not a
 *    sign-in and writes no row.
 *
 * The row follows the incumbent shape of a refused sign-in
 * (`signInFailureEventFor`, `auth-session-audit.ts`): `action: 'login_failed'`
 * with `context.endpoint` and `context.reason`, the refusal's machine code
 * (`IP_NOT_ALLOWED`). It adds `context.rule` — the policy that refused it,
 * `ip_allow_list`, as an MFA-held `login` row names `mfa_required` — and
 * `context.attempts`, below. The client address and user agent are read by the
 * rule every `login` row's are (`signInClientFingerprint`).
 *
 * ⛔ No row carries anything the caller typed: the submitted identifier is
 * used only to find the account and is never recorded, and the password is
 * never read.
 *
 * ## The bound
 *
 * A scanner hammering the gate must not be able to flood the table, so the
 * rows are bounded ({@link IpRefusalAuditBound}):
 *
 *  - per client address, a 10-minute window from that address's first
 *    refusal: a row at its 1st, 10th and 100th refusal, each carrying
 *    `context.attempts` (1, 10, 100) — so a steady flood from one address is
 *    three rows per window, and the third says it reached a hundred;
 *  - across all addresses, at most 1000 rows per 10-minute window, and once
 *    that cap drops a row, one operator `warn` line for the window;
 *  - the addresses it tracks are bounded too, so rotating addresses cannot
 *    grow its memory without limit.
 *
 * The bound is held in process memory, one per audit sink (in a running
 * process that is the one `audit` service). It holds per process: N replicas
 * of the server write up to N times as many rows. No shared store is used.
 */

import {
  emitAuthSessionAuditEvent,
  type AuthEventAuditSurface,
  type AuthSessionAuditEventInput,
  type SignInClientFingerprint,
} from './auth-session-audit.js';
import { canonicalClientAddress } from './client-address-canonical.js';

/** The policy a refused sign-in names in `context.rule`. */
export const IP_ALLOW_LIST_RULE = 'ip_allow_list';

/** The machine code both doors answer, recorded as `context.reason`. */
export const IP_NOT_ALLOWED_REASON = 'IP_NOT_ALLOWED';

/** The window a client address's refusals are counted in. */
export const IP_REFUSAL_AUDIT_WINDOW_MS = 10 * 60_000;

/** The refusals of one address, within its window, that write a row. */
export const IP_REFUSAL_AUDIT_MARKS: readonly number[] = Object.freeze([1, 10, 100]);

/** The rows written per window across every address. */
export const IP_REFUSAL_AUDIT_ROW_CAP = 1000;

/** The client addresses tracked at once; past it the stalest is forgotten. */
const TRACKED_ADDRESS_CAP = 10_000;

/** The key of a refusal whose client address could not be established. */
const UNDETERMINED = '';

export interface IpRefusalAuditBoundOptions {
  windowMs?: number;
  marks?: readonly number[];
  rowCap?: number;
  trackedAddressCap?: number;
  now?: () => number;
}

/** The module note's bound, on one clock. */
export class IpRefusalAuditBound {
  private readonly windowMs: number;
  private readonly marks: ReadonlySet<number>;
  private readonly rowCap: number;
  private readonly trackedAddressCap: number;
  private readonly now: () => number;
  private readonly perAddress = new Map<string, { start: number; count: number }>();
  private windowStart: number | undefined;
  private rowsInWindow = 0;
  private warnedInWindow = false;

  constructor(options: IpRefusalAuditBoundOptions = {}) {
    this.windowMs = options.windowMs ?? IP_REFUSAL_AUDIT_WINDOW_MS;
    this.marks = new Set(options.marks ?? IP_REFUSAL_AUDIT_MARKS);
    this.rowCap = options.rowCap ?? IP_REFUSAL_AUDIT_ROW_CAP;
    this.trackedAddressCap = options.trackedAddressCap ?? TRACKED_ADDRESS_CAP;
    this.now = options.now ?? Date.now;
  }

  /** How many client addresses are tracked now. */
  get trackedAddresses(): number {
    return this.perAddress.size;
  }

  /**
   * Count one refusal from `address`. Answers the `attempts` number its row
   * carries when this refusal writes one, or `undefined` when it does not:
   * not one of the marks, or the window's cap is spent (then `warn` is called
   * once for the window).
   */
  admit(address: string | undefined, warn?: (line: string) => void): number | undefined {
    const now = this.now();
    const key = address ? canonicalClientAddress(address) : UNDETERMINED;
    let entry = this.perAddress.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      if (entry) this.perAddress.delete(key);
      else this.makeRoom(now);
      entry = { start: now, count: 0 };
      this.perAddress.set(key, entry);
    }
    entry.count += 1;
    if (!this.marks.has(entry.count)) return undefined;

    if (this.windowStart === undefined || now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.rowsInWindow = 0;
      this.warnedInWindow = false;
    }
    if (this.rowsInWindow >= this.rowCap) {
      if (!this.warnedInWindow) {
        this.warnedInWindow = true;
        warn?.(
          `[auth] IP allow-list refusals (ADR-0069 D5): ${this.rowCap} login_failed rows were written to ` +
            `sys_audit_log in this ${Math.round(this.windowMs / 60_000)}-minute window, the most one window ` +
            'takes, so further refused sign-ins are answered exactly as before but no longer recorded until ' +
            `${new Date(this.windowStart + this.windowMs).toISOString()}. A refusal flood of this size is ` +
            'usually a scanner; the rows already written name the addresses it came from.',
        );
      }
      return undefined;
    }
    this.rowsInWindow += 1;
    return entry.count;
  }

  /** Keep the tracked addresses under their cap: drop the expired, then the stalest. */
  private makeRoom(now: number): void {
    if (this.perAddress.size < this.trackedAddressCap) return;
    for (const [key, entry] of this.perAddress) {
      if (now - entry.start >= this.windowMs) this.perAddress.delete(key);
    }
    while (this.perAddress.size >= this.trackedAddressCap) {
      const stalest = this.perAddress.keys().next();
      if (stalest.done) break;
      this.perAddress.delete(stalest.value);
    }
  }
}

/** One bound per audit sink, held weakly: per process, and never shared between test doubles. */
const bounds = new WeakMap<object, IpRefusalAuditBound>();

/** The bound the rows written to `sink` are counted by. */
export function ipRefusalAuditBoundFor(sink: AuthEventAuditSurface): IpRefusalAuditBound {
  let bound = bounds.get(sink);
  if (!bound) {
    bound = new IpRefusalAuditBound();
    bounds.set(sink, bound);
  }
  return bound;
}

/** A non-empty string, or undefined. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The `login_failed` event for a sign-in the IP allow-list refused. `userId`
 * and `organizationId` are recorded where the refusing door knows them, and
 * the row is written without them otherwise (module note).
 */
export function ipAllowListRefusalEventFor(input: {
  path: string;
  attempts: number;
  userId?: string;
  organizationId?: string;
  impersonatedBy?: string;
  fingerprint?: SignInClientFingerprint;
}): AuthSessionAuditEventInput {
  const userId = str(input.userId);
  const organizationId = str(input.organizationId);
  const impersonatedBy = str(input.impersonatedBy);
  return {
    action: 'login_failed',
    ...(userId ? { userId } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(input.fingerprint ?? {}),
    context: {
      endpoint: input.path,
      reason: IP_NOT_ALLOWED_REASON,
      rule: IP_ALLOW_LIST_RULE,
      attempts: input.attempts,
      ...(impersonatedBy ? { impersonated_by: impersonatedBy } : {}),
    },
  };
}

/** Whether a better-auth endpoint path is a sign-in (module note: only those are recorded). */
export function isSignInEndpoint(path: string): boolean {
  return path.startsWith('/sign-in/');
}

/** The most of a refused sign-in's body read to find its `email`. */
const IDENTIFIER_BODY_LIMIT = 16 * 1024;

/** The longest `email` looked up (RFC 5321 caps a path at 256 octets). */
const IDENTIFIER_LIMIT = 320;

/**
 * The `email` a refused sign-in's JSON body carries, read only to find the
 * account its row names, or `undefined`: no body, one past
 * {@link IDENTIFIER_BODY_LIMIT}, one that does not parse, or no `email` text.
 * Never throws.
 */
export async function refusedSignInEmailOf(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IDENTIFIER_BODY_LIMIT) return undefined;
  const stream = request.body;
  if (!stream) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IDENTIFIER_BODY_LIMIT) {
        await reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    const email = (JSON.parse(new TextDecoder().decode(bytes)) as { email?: unknown } | null)?.email;
    return typeof email === 'string' && email.length > 0 && email.length <= IDENTIFIER_LIMIT ? email : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write the row of one sign-in the DEPLOYMENT's list refused (module note),
 * after the bound admitted it. Called detached from the refusal: the answer
 * never waits on the body read or the account lookup, so it is the same
 * answer, in the same time, whether the identifier names an account or not.
 * Never throws; an account lookup that fails writes the row with no subject.
 */
export async function recordDeploymentListRefusal(
  sink: AuthEventAuditSurface,
  refusal: {
    request: Request;
    endpoint: string;
    attempts: number;
    fingerprint: SignInClientFingerprint;
    resolveAccount: (email: string) => Promise<string | undefined>;
    /** Told when the account lookup failed and the row is written with no subject. */
    debug?: (line: string, meta?: Record<string, unknown>) => void;
  },
): Promise<void> {
  try {
    const email = await refusedSignInEmailOf(refusal.request);
    let userId: string | undefined;
    if (email) {
      try {
        userId = await refusal.resolveAccount(email);
      } catch (err) {
        userId = undefined;
        refusal.debug?.('[auth] an IP allow-list refusal row is written with no subject: the account lookup failed', {
          err: String((err as { message?: unknown } | null)?.message ?? err),
        });
      }
    }
    await emitAuthSessionAuditEvent(
      sink,
      ipAllowListRefusalEventFor({
        path: refusal.endpoint,
        attempts: refusal.attempts,
        userId,
        fingerprint: refusal.fingerprint,
      }),
    );
  } catch {
    /* the refusal is already answered; the sink reports its own lost rows */
  }
}
