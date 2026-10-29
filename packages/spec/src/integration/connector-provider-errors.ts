// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Upstream-availability classification for connector provider factories
 * (ADR-0097 follow-up, #3017).
 *
 * A {@link ConnectorProviderFactory} can fail for two very different reasons:
 *
 * 1. **Configuration faults** — invalid `providerConfig`, an unresolvable
 *    `credentialRef`, a name conflict. These are authoring mistakes; the
 *    materializer keeps them **fatal at boot** (ADR-0097 "fail loudly").
 * 2. **Operational faults** — the upstream the factory must contact to
 *    materialize (an MCP server's `tools/list`, a remote spec endpoint) is
 *    *temporarily unreachable*. Aborting the whole app boot for a transient
 *    network blip turns one degraded integration into a total outage.
 *
 * A factory signals case 2 by throwing an error whose `code` is
 * {@link CONNECTOR_UPSTREAM_UNAVAILABLE} — most conveniently a
 * {@link ConnectorUpstreamUnavailableError}. The materializer then **degrades**
 * that one instance instead of failing boot: it is registered in a `degraded`
 * state (visible via `GET /connectors`, dispatch fails with a clear error) and
 * re-materialization is retried with backoff and on every reconcile. Errors
 * without the marker keep the fail-loud contract unchanged.
 *
 * The check is **structural** ({@link isConnectorUpstreamUnavailable} reads
 * `code`, never `instanceof`), so classification survives package-manager
 * module duplication across the plugin/host boundary.
 */

/** Marker `code` for an operational (retryable) provider-factory failure. */
export const CONNECTOR_UPSTREAM_UNAVAILABLE = 'CONNECTOR_UPSTREAM_UNAVAILABLE' as const;

/**
 * Thrown by a connector provider factory when the upstream it must contact to
 * materialize an instance is temporarily unreachable (connect refused/timeout,
 * discovery call failed). Carries {@link CONNECTOR_UPSTREAM_UNAVAILABLE} as its
 * `code`; keep the underlying failure in `cause` for diagnostics.
 */
export class ConnectorUpstreamUnavailableError extends Error {
  readonly code = CONNECTOR_UPSTREAM_UNAVAILABLE;
  /** The underlying failure (connect error, timeout), kept for diagnostics. */
  readonly cause?: unknown;
  constructor(message: string, options?: { cause?: unknown }) {
    // `cause` is assigned manually — the ES2022 ErrorOptions constructor
    // overload is unavailable at this package's compile target.
    super(message);
    this.name = 'ConnectorUpstreamUnavailableError';
    if (options && 'cause' in options) this.cause = options.cause;
  }
}

/**
 * Structural check for the {@link CONNECTOR_UPSTREAM_UNAVAILABLE} marker — used
 * by the materializer to route a factory failure to the degrade path instead of
 * the fatal path. Matches any error-like object carrying the `code`, not just
 * `instanceof ConnectorUpstreamUnavailableError`.
 */
export function isConnectorUpstreamUnavailable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === CONNECTOR_UPSTREAM_UNAVAILABLE
  );
}

/**
 * Marker `code` for a credential the upstream refused (HTTP 401 / 403) — #27237,
 * ruling on #27237 (comment 6470087293).
 *
 * A third outcome beside the two above: neither an authoring fault (the
 * instance is well-formed and its `credentialRef` resolved) nor an operational
 * one (the upstream answered, and retrying the same value cannot change its
 * answer). The materializer **degrades** the instance naming the refusal, as it
 * does for an upstream outage. When the value is a stored one (the credential
 * store) or written in the declaration, it does not retry it on a timer: the
 * next attempt is the next change of the credential or the declaration, or a
 * restart, and a stored value's row is marked `rejected` with the upstream's
 * message — never the value. A value from an environment variable or the
 * host's resolver can change where the process cannot see it, so its instance
 * is retried on the backoff.
 */
export const CONNECTOR_CREDENTIAL_REJECTED = 'CONNECTOR_CREDENTIAL_REJECTED' as const;

/**
 * Thrown by a connector provider factory when the upstream it contacted to
 * materialize an instance refused the credential it sent (HTTP 401 / 403).
 * Carries {@link CONNECTOR_CREDENTIAL_REJECTED} as its `code` and the HTTP
 * status. ⛔ The message must not carry the credential.
 */
export class ConnectorCredentialRejectedError extends Error {
  readonly code = CONNECTOR_CREDENTIAL_REJECTED;
  /** The upstream's HTTP status: 401 or 403. */
  readonly status: number;
  /** The underlying failure, kept for diagnostics. */
  readonly cause?: unknown;
  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ConnectorCredentialRejectedError';
    this.status = status;
    if (options && 'cause' in options) this.cause = options.cause;
  }
}

/**
 * Structural check for the {@link CONNECTOR_CREDENTIAL_REJECTED} marker — reads
 * `code`, never `instanceof`, for the reason {@link isConnectorUpstreamUnavailable}
 * gives.
 */
export function isConnectorCredentialRejected(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === CONNECTOR_CREDENTIAL_REJECTED
  );
}
