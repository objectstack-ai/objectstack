// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30918] When an authorized AI assistant was last used: a coarse stamp the
 * server writes on a verified MCP call, and nothing else ever writes.
 *
 * ## Where it lives
 *
 * `sys_oauth_consent.last_used_at`, an ObjectStack column on the
 * better-auth-managed consent table. The consent is the right row for three
 * reasons. It is the grant the person can see and withdraw, so the stamp is
 * read beside it (`authorized-clients-read.ts`). It is held per organization
 * (`reference_id`), so a client used in one organization never moves the
 * stamp of its grant in another. And a withdrawn or revoked consent is a
 * deleted row, so no usage record outlives the grant it describes. MCP access
 * tokens are JWTs and are not stored, so there is no token row to stamp, and
 * the refresh token moves only on a refresh.
 *
 * ## Who writes it, and when
 *
 * Only {@link McpClientLastUseStamper.record}, and only with the principal
 * `AuthManager.verifyMcpAccessToken` has just verified: the token's subject,
 * its `azp` client and its `organization_id` claim, every one read from a
 * signature this server checked. The time is the server's clock. No request
 * field, header or body reaches the stamp, and the consent doors better-auth
 * serves (`/oauth2/consent`, `/oauth2/update-consent`) do not carry the
 * column. A token with no `azp` names no client, so it stamps nothing.
 *
 * ## How coarse, and why an hour
 *
 * The stored value is the START of the clock hour in which a verified call
 * arrived, and a row is written only when its stored hour is older than the
 * current one. So:
 *
 *  - **at most one write per consent per hour**, however many MCP calls the
 *    client makes in it. An assistant can make hundreds of tool calls a
 *    minute; a per-request write would turn every one into a write on an
 *    identity table. An hour is the granularity a person needs to answer
 *    "is this laptop's assistant still acting as me?" and the granularity
 *    an administrator can be shown without exposing a minute-by-minute
 *    activity trail;
 *  - **the answer says what it means**: "used during the hour starting at
 *    X", never a precision the server did not keep.
 *
 * Each process also remembers, per (client, user, organization), the hour it
 * last settled, so within an hour a busy client costs no I/O at all. The first
 * verified call of an hour costs one read (and one write when no other
 * process has stamped that hour yet); with several processes, each reads at
 * most once an hour per consent and the row is written once, or a few times
 * with the same value when first calls race. The memory is bounded
 * ({@link MCP_CLIENT_LAST_USE_MEMO_CAP} entries, oldest dropped first).
 *
 * ## Off the request path
 *
 * The MCP request does not wait for the stamp: the manager schedules it after
 * the response (`run-after-response.ts`). A failed read or write loses that
 * hour's stamp and nothing else. It is reported once per process at `error`,
 * because the reads keep answering an older stamp as if it were current, and
 * the hour is retried in the next hour, not on the next call, so a store
 * outage never becomes a write per request.
 */

/** The stamp's granularity: one clock hour. */
export const MCP_CLIENT_LAST_USE_GRANULARITY_MS = 60 * 60 * 1000;

/** How many (client, user, organization) keys one process remembers. */
export const MCP_CLIENT_LAST_USE_MEMO_CAP = 10_000;

/** The verified principal, exactly as `verifyMcpAccessToken` returns it. */
export interface VerifiedMcpPrincipal {
  userId: string;
  clientId?: string;
  organizationId?: string;
}

/** One consent row, as the store reads it for the stamp. */
export interface StampableConsent {
  id: string;
  /** The consent's organization, `null`/empty when it binds none. */
  referenceId: string | null;
  /** The stored stamp, `null` when none has been written. */
  lastUsedAt: Date | null;
}

/** The two store operations the stamp needs. {@link mcpClientLastUseStoreFor} wires the real ones. */
export interface McpClientLastUseStore {
  /** Every consent `userId` holds for `clientId`, across organizations. */
  consentsFor(clientId: string, userId: string): Promise<StampableConsent[]>;
  /** Write `at` as the consent's stamp. */
  stamp(consentId: string, at: Date): Promise<void>;
}

/**
 * The consent a verified token was minted under, by the provider's own rule
 * (`findConsent` in `@better-auth/oauth-provider`): the consent bound to the
 * token's organization when it carries one, otherwise the consent bound to
 * none.
 */
export function consentForToken(
  consents: readonly StampableConsent[],
  organizationId: string | undefined,
): StampableConsent | undefined {
  return organizationId
    ? consents.find((row) => row.referenceId === organizationId)
    : consents.find((row) => !row.referenceId);
}

/** The start of the clock hour `nowMs` falls in. */
export function lastUseHourOf(nowMs: number): number {
  return Math.floor(nowMs / MCP_CLIENT_LAST_USE_GRANULARITY_MS) * MCP_CLIENT_LAST_USE_GRANULARITY_MS;
}

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The engine slice the real store reads and writes through. */
interface StampEngine {
  find(object: string, query: Record<string, unknown>, options?: unknown): Promise<unknown>;
  update(object: string, doc: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

const toDate = (value: unknown): Date | null => {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The real store: the data engine under a system context. A consent is a
 * better-auth-managed row, and a system write passes the identity write guard
 * by construction (ADR-0092 D2), so this is the platform's own server-side
 * write, as the session tombstone is.
 */
export function mcpClientLastUseStoreFor(getEngine: () => unknown): McpClientLastUseStore {
  const engine = (): StampEngine => {
    const found = getEngine() as StampEngine | undefined;
    if (!found) throw new Error('The data engine is not available.');
    return found;
  };
  return {
    async consentsFor(clientId, userId) {
      const rows = await engine().find(
        'sys_oauth_consent',
        {
          where: { client_id: clientId, user_id: userId },
          fields: ['id', 'reference_id', 'last_used_at'],
          // One consent per organization the person granted this client in.
          limit: 1000,
        },
        { context: SYSTEM_CTX },
      );
      return (Array.isArray(rows) ? rows : []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        referenceId: typeof row.reference_id === 'string' && row.reference_id ? row.reference_id : null,
        lastUsedAt: toDate(row.last_used_at),
      }));
    },
    async stamp(consentId, at) {
      await engine().update('sys_oauth_consent', { id: consentId, last_used_at: at }, { context: SYSTEM_CTX });
    },
  };
}

/**
 * Records verified MCP calls as coarse per-consent stamps. One instance per
 * `AuthManager`, so the per-process memory is shared by every token it
 * verifies.
 */
export class McpClientLastUseStamper {
  /** (client, user, organization) → the hour start this process last settled. */
  private readonly settled = new Map<string, number>();
  private failureReported = false;

  constructor(
    private readonly store: McpClientLastUseStore,
    private readonly opts: {
      now?: () => number;
      /** Told about the FIRST failure in this process only. */
      onFirstFailure?: (error: unknown) => void;
    } = {},
  ) {}

  /**
   * Stamp the consent `principal`'s token was minted under, unless this hour
   * is already stamped. Resolves once the stamp is settled; never rejects.
   */
  async record(principal: VerifiedMcpPrincipal): Promise<void> {
    const { userId, clientId, organizationId } = principal;
    if (!userId || !clientId) return;
    const hour = lastUseHourOf((this.opts.now ?? Date.now)());
    const key = JSON.stringify([clientId, userId, organizationId ?? null]);
    if (this.settled.get(key) === hour) return;
    // Claimed BEFORE the I/O, so concurrent calls of the same hour skip it,
    // and kept on failure, so an outage is retried next hour, not next call.
    this.settled.delete(key);
    this.settled.set(key, hour);
    if (this.settled.size > MCP_CLIENT_LAST_USE_MEMO_CAP) {
      const oldest = this.settled.keys().next().value;
      if (oldest !== undefined) this.settled.delete(oldest);
    }
    try {
      const consent = consentForToken(await this.store.consentsFor(clientId, userId), organizationId);
      if (!consent) return;
      if (consent.lastUsedAt && consent.lastUsedAt.getTime() >= hour) return;
      await this.store.stamp(consent.id, new Date(hour));
    } catch (error) {
      if (this.failureReported) return;
      this.failureReported = true;
      try {
        this.opts.onFirstFailure?.(error);
      } catch {
        // A report is best-effort; the stamp never becomes the caller's failure.
      }
    }
  }
}
