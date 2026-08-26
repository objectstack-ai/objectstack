// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ── The boot-time authorization-cache posture statement (#11968, #11633 §3) ──
 *
 * ⭐ **Non-optional**, by the 2026-08-25 ruling on #11633 (Fork 2 → B): whenever
 * a grants cache is enabled and there is **no** cross-node invalidation bus, the
 * deployment is told so, **out loud**, at boot.
 *
 * ## Why a statement and not a refusal
 *
 * A per-process cache bounded only by its TTL is a legitimate configuration —
 * #11633 §3 rules the TTL, not the bus, as the correctness contract, so a
 * single-node deployment (or one that simply accepts the window) is correct
 * with no bus at all. What is NOT acceptable is arriving there **without
 * noticing**: that is the shape of #4785, where a control was silently disabled
 * by configuration and nothing said so. The metadata bridge logs its own
 * absence at `debug` and that is right for metadata — a missed
 * `metadata.changed` costs a stale schema until reload and loses no data. Here
 * the same silence would cost a permission honoured past its revocation.
 *
 * ⇒ Enabled cache + no bus is a `warn`, every boot, naming the window it just
 * accepted. Not a refusal — a statement.
 *
 * ## The three postures, and the reason `disabled` is silent
 *
 *   - `disabled`      — no cache is enabled. **Silent.** There is no window to
 *                       state, and a line every boot on the shipped default
 *                       (TTL `0`, Fork 4) would train operators to ignore it —
 *                       which is how the loud line stops being loud.
 *   - `ttl-only`      — cache enabled, no cross-node bus. **LOUD (`warn`).**
 *   - `bus-narrowed`  — cache enabled, bus bridged. `info`, so the bridge's
 *                       presence is on the record next to its absence.
 *
 * Both arms are pinned in `authz-cache-posture.test.ts`: a statement that
 * appears always is no more useful than one that never appears.
 */

/** Deployment variable that turns the grants cache on. `0` (default) = off. */
export const AUTHZ_GRANTS_CACHE_TTL_ENV = 'OS_AUTHZ_GRANTS_CACHE_TTL_MS';

/**
 * What the local node has, in cross-node terms, for delivering
 * `authz.invalidated`.
 *
 * ⚠️ `in-process` is a distinct state on purpose, and it is the one that would
 * otherwise go unnoticed: `Runtime` auto-registers a **memory** cluster service
 * by default, so "is a `cluster` service registered?" answers *yes* on the
 * shipped default while the bus fans out to exactly nobody
 * (`service-cluster/src/memory/pubsub.ts`: *"No cross-process delivery"*; the
 * split-brain guard calls the same set `IN_PROCESS_DRIVERS`). A posture check
 * that asked only whether a service exists would therefore stay silent in
 * precisely the multi-replica deployment it exists to warn.
 */
export type AuthzInvalidationBusState =
  /** A cross-node transport is attached and carrying the channel. */
  | 'bridged'
  /** A cluster service exists, but its driver does not cross a process boundary. */
  | 'in-process'
  /** No cluster service, or no engine seam to attach one to. */
  | 'absent';

/** The posture a boot resolves to. */
export type AuthzCachePosture = 'disabled' | 'ttl-only' | 'bus-narrowed';

export interface AuthzCachePostureInput {
  /** Configured grants-cache TTL in ms. `<= 0` means the cache is off. */
  ttlMs: number;
  /** What the node has for cross-node invalidation. */
  bus: AuthzInvalidationBusState;
  /** Cluster driver name, when one is registered. Surfaced in the message. */
  driver?: string;
}

export interface AuthzCachePostureStatement {
  posture: AuthzCachePosture;
  /** True when this must be said at `warn`. See the module doc. */
  loud: boolean;
  /** The statement itself. Empty only for the silent `disabled` posture. */
  message: string;
}

/**
 * Resolve the posture. Pure — it reads its inputs and nothing else, so both
 * arms of the acceptance criterion ("appears exactly when a cache flag is on
 * without a bus, and not otherwise") are testable without a boot.
 */
export function resolveAuthzCachePosture(
  input: AuthzCachePostureInput,
): AuthzCachePostureStatement {
  const { ttlMs, bus, driver } = input;

  if (!(ttlMs > 0)) {
    return { posture: 'disabled', loud: false, message: '' };
  }

  if (bus === 'bridged') {
    return {
      posture: 'bus-narrowed',
      loud: false,
      message:
        `[authz-cache] grants cache ENABLED (ttl=${ttlMs}ms) with the ` +
        `"authz.invalidated" bridge attached` +
        (driver ? ` (cluster driver "${driver}")` : '') +
        '. The bus narrows the TYPICAL convergence to one network hop; the TTL ' +
        'remains the correctness bound, because no shipped driver delivers ' +
        'better than at-most-once (cluster.mdx §4.2).',
    };
  }

  const why =
    bus === 'in-process'
      ? `the cluster driver "${driver ?? 'memory'}" is in-process and does not ` +
        'fan out across replicas'
      : 'no cluster service is registered on this node';

  return {
    posture: 'ttl-only',
    loud: true,
    message:
      `[authz-cache] grants cache ENABLED (ttl=${ttlMs}ms) with NO ` +
      `"authz.invalidated" invalidation bus — ${why}. A grant revoked on ` +
      `another replica is honoured by this one for up to ${ttlMs}ms. That is a ` +
      'supported configuration, not an error: the TTL is the correctness bound ' +
      'and it still holds. It is stated because a silently-absent invalidation ' +
      'bridge is how a security control gets disabled without anyone noticing ' +
      `(#4785). To narrow the typical window, configure a remote cluster driver; ` +
      `to remove it entirely, set ${AUTHZ_GRANTS_CACHE_TTL_ENV}=0.`,
  };
}

/** The reading of {@link AUTHZ_GRANTS_CACHE_TTL_ENV}, malformed input included. */
export interface AuthzGrantsCacheTtlReading {
  /** The effective TTL. `0` whenever the cache is off — including malformed. */
  ttlMs: number;
  /** The raw value read, when one was set. */
  raw?: string;
  /** True when a value was set but could not be read as a non-negative number. */
  malformed: boolean;
}

/**
 * Read the grants-cache TTL from deployment config.
 *
 * Deployment config, never a settings row (#11633 §5): the knob that bounds a
 * cache must not itself be served through a cached path, and operator-level
 * configuration comes from the environment.
 *
 * Default `0` — the grants cache is **off** unless a deployment turns it on and
 * accepts the staleness window explicitly (#11633 Fork 4, ruled 2026-08-25).
 *
 * ⚠️ A malformed value resolves to `0` but is reported as malformed rather than
 * folded into "off": `OS_AUTHZ_GRANTS_CACHE_TTL_MS=5OOO` (letter O) silently
 * meaning "disabled" is the same silent-disable class the posture statement
 * exists to prevent.
 */
export function readAuthzGrantsCacheTtlMs(
  env: Record<string, string | undefined> = typeof process !== 'undefined'
    ? process.env
    : {},
): AuthzGrantsCacheTtlReading {
  const raw = env[AUTHZ_GRANTS_CACHE_TTL_ENV];
  if (raw === undefined || raw.trim() === '') {
    return { ttlMs: 0, malformed: false };
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ttlMs: 0, raw, malformed: true };
  }
  return { ttlMs: Math.floor(parsed), raw, malformed: false };
}

/** Minimal sink shape — `warn` is the member every logger in this repo has. */
export interface AuthzPostureSink {
  warn(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
}

/**
 * State the posture at boot. `warn` for the loud arm, `info` for the bridged
 * one, and nothing at all when no cache is enabled (see the module doc for why
 * silence is the right default rather than a courtesy line).
 *
 * A malformed TTL value is warned about on its own, because "we read your
 * setting as off" is exactly what a deployment must not have to infer.
 */
export function reportAuthzCachePosture(
  input: AuthzCachePostureInput & { malformedTtl?: { raw?: string } },
  sink: AuthzPostureSink,
): AuthzCachePostureStatement {
  if (input.malformedTtl) {
    sink.warn(
      `[authz-cache] ${AUTHZ_GRANTS_CACHE_TTL_ENV}=` +
        `${JSON.stringify(input.malformedTtl.raw ?? '')} is not a non-negative ` +
        'number; the grants cache is treated as DISABLED. Set a millisecond ' +
        'count, or 0 to disable it deliberately.',
    );
  }

  const statement = resolveAuthzCachePosture(input);
  if (statement.posture === 'disabled') return statement;
  if (statement.loud) sink.warn(statement.message);
  else sink.info?.(statement.message);
  return statement;
}
