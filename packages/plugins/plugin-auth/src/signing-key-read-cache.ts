// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The signing-key read, held across requests under BOTH halves of the
 * cross-request caching rule (#24061).
 *
 * ## What is read, and how often
 *
 * better-auth's `jwt` plugin reads the `sys_jwks` keyring every time it signs:
 * the `set-auth-jwt` header of an HTTP `/get-session`, `/token`, and the OIDC /
 * MCP provider's tokens. Each read is two serial round trips on a real engine —
 * the key rows, then the `private_key` readback (`internal-field-readback.ts`)
 * — for a table that changes when a key is minted or rotated, which is almost
 * never. In-process session reads stopped signing altogether
 * (`protectGetSessionJwtHook`), so this is the read that is left.
 *
 * ## The rule this cache is held to
 *
 * The accepted cross-request caching design for the authenticated request path
 * (#11633, ruled) admits no cached answer on this path unless (a) every write
 * that can change it passes a seam this process observes, and (b) a TTL bounds
 * the case where (a) fails. Both. So:
 *
 *  - **(a) The write seam.** The engine's middleware chain is the one road a
 *    write to `sys_jwks` takes in this process: better-auth mints and rotates
 *    keys through its storage adapter, which writes with `engine.insert` /
 *    `update` / `delete` (`objectql-adapter.ts`), and the data API writes
 *    through the same engine. A middleware registered on `sys_jwks` counts
 *    every write that ENTERS it and, in a `finally` around `next()`, every
 *    write whose driver step has SETTLED. An entry is served only while both
 *    counters read what they read when the entry's read OPENED and no write is
 *    in flight — so a write retires the entry the moment it starts, and a read
 *    that overlapped a write is never stored.
 *  - **(b) The bound.** {@link SIGNING_KEY_CACHE_TTL_MS}: a write this process
 *    cannot see — another node minting its own key, a key row edited at the
 *    driver, a restore — is read at most that long after it lands. A fixed
 *    constant, deliberately not a configuration key.
 *
 * An engine without `registerMiddleware` (a test double), or one whose
 * registration threw, has no observable write seam, so half (a) cannot hold
 * and NOTHING is cached: every read goes to the table, as before.
 *
 * ## The MCP access-token verifier reads through it too (#24186)
 *
 * `AuthManager.verifyMcpAccessToken` verifies against better-auth's `getJwks`
 * endpoint — whose keyring read IS this reader — on every call, and holds no
 * key set of its own. One held keyring, one write seam and one bound therefore
 * serve the signer, `/jwks` and the verifier alike, and a write this process
 * observes reaches all three in the same operation. The verifier receives the
 * endpoint's public projection, never a keyring row. A token signed by a key
 * the held keyring does not carry earns ONE forced re-read
 * ({@link retireHeldKeyrings}), shared while it is in flight and never sooner
 * than {@link UNKNOWN_SIGNING_KEY_REREAD_FLOOR_MS} after the previous one.
 *
 * ## What it is not
 *
 * ⛔ Not a session, grant or other authorization cache. It holds the keyring
 * rows the signer reads — the rows `/jwks` publishes and the encrypted private
 * key better-auth decrypts per signature — and nothing derived from a caller.
 * It is one entry per reader (one reader per better-auth instance), so a
 * rebuilt instance starts empty.
 */

import type { StoredJwk } from './jwt-key-algorithm.js';

/**
 * How long a keyring read is served without a write this process observed —
 * the (b) half above. Thirty seconds, the repo's established bound for a
 * cross-request read on this path (`rest-server.ts`'s hostname cache, the
 * localization failure memo).
 */
export const SIGNING_KEY_CACHE_TTL_MS = 30_000;

/**
 * How soon after one forced keyring re-read the MCP access-token verifier may
 * force the next (#24186). It bounds what a stream of tokens naming keys the
 * keyring does not carry can cost: at most one keyring read per interval,
 * however many such tokens arrive and however they are spread.
 *
 * Equal to {@link SIGNING_KEY_CACHE_TTL_MS} on purpose. Such a stream then at
 * most doubles the keyring read rate the TTL already allows, and while one is
 * running, a key minted where this process cannot see it is verified no later
 * than the TTL alone would have allowed. Thirty seconds is also `jose`'s
 * default `cooldownDuration` for the same mechanism in its remote key set: a
 * re-fetch on an unmatched key, at most once per cooldown. A fixed constant,
 * deliberately not a configuration key.
 */
export const UNKNOWN_SIGNING_KEY_REREAD_FLOOR_MS = SIGNING_KEY_CACHE_TTL_MS;

/** The keyring object, as the jwt plugin's schema maps it (`buildJwtPluginSchema`). */
const KEYRING_OBJECT = 'sys_jwks';

/** Engine operations that read; every other operation on the keyring is counted as a write. */
const READ_OPERATIONS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

interface KeyringWriteObserver {
  started: number;
  completed: number;
}

/**
 * One observer per engine. `null` records an engine whose registration threw:
 * it is never cached behind.
 */
const keyringWriteObservers = new WeakMap<object, KeyringWriteObserver | null>();

type Middleware = (ctx: { operation?: unknown }, next: () => Promise<void>) => Promise<void>;

/** The observer for `engine`, registered on first sight; `undefined` when the engine offers no seam. */
function observeKeyringWrites(engine: unknown): KeyringWriteObserver | undefined {
  if (!engine || typeof engine !== 'object') return undefined;
  const existing = keyringWriteObservers.get(engine);
  if (existing !== undefined) return existing ?? undefined;
  const register = (engine as { registerMiddleware?: unknown }).registerMiddleware;
  if (typeof register !== 'function') return undefined;
  const observer: KeyringWriteObserver = { started: 0, completed: 0 };
  const middleware: Middleware = async (ctx, next) => {
    const operation = ctx?.operation;
    if (typeof operation === 'string' && READ_OPERATIONS.has(operation)) return next();
    observer.started += 1;
    try {
      await next();
    } finally {
      observer.completed += 1;
    }
  };
  try {
    (register as (fn: Middleware, options: { object: string }) => void).call(engine, middleware, {
      object: KEYRING_OBJECT,
    });
  } catch {
    keyringWriteObservers.set(engine, null);
    return undefined;
  }
  keyringWriteObservers.set(engine, observer);
  return observer;
}

/**
 * Retire every keyring held for `engine`, so the next read of it goes to the
 * table: the forced re-read (#24186) that a token signed by a key the held
 * keyring does not carry earns.
 *
 * It is recorded as a keyring write that entered and settled, so the (a) rule
 * needs no second case: every held entry stops matching the counters, and a
 * read already in flight is answered but not held, exactly as when a real
 * write overlaps it. An engine with no observer holds nothing, so there is
 * nothing to retire.
 */
export function retireHeldKeyrings(engine: unknown): void {
  if (!engine || typeof engine !== 'object') return;
  const observer = keyringWriteObservers.get(engine);
  if (!observer) return;
  observer.started += 1;
  observer.completed += 1;
}

/** better-auth's stock keyring read — the read its jwks adapter makes with no `getJwks` override. */
async function readKeyring(ctx: any): Promise<StoredJwk[]> {
  return (await ctx?.context?.adapter?.findMany({ model: 'jwks' })) ?? [];
}

export interface SigningKeyReaderOptions {
  /** The engine better-auth's storage adapter writes through — the (a) seam. */
  readonly engine: unknown;
  /**
   * The read a miss performs. Omitted: better-auth's stock keyring read. A host
   * without Ed25519 passes `createHostUsableJwksReader()`, so the rows it hides
   * are hidden from the cached answer too.
   */
  readonly read?: (ctx: any) => Promise<StoredJwk[]>;
  /** Clock, for tests. */
  readonly now?: () => number;
}

interface CachedKeyring {
  readonly rows: StoredJwk[];
  readonly readAtMs: number;
  readonly startedAtOpen: number;
  readonly completedAtOpen: number;
}

/**
 * The `jwt({ adapter: { getJwks } })` reader: better-auth routes all four of
 * its keyring reads through it (`getAllKeys`, `getLatestKey`,
 * `getLatestKeyByAlg`, `getKeyById`), so every signer and `/jwks` share it.
 *
 * The observer is registered HERE, when the reader is built — before the
 * first request — so a key write that precedes the first read is counted.
 */
export function createSigningKeyReader(
  options: SigningKeyReaderOptions,
): (ctx: any) => Promise<StoredJwk[]> {
  const observer = observeKeyringWrites(options.engine);
  const read = options.read ?? readKeyring;
  const now = options.now ?? (() => Date.now());
  let entry: CachedKeyring | undefined;

  return async (ctx: any): Promise<StoredJwk[]> => {
    if (
      observer
      && entry
      && entry.startedAtOpen === observer.started
      && entry.completedAtOpen === observer.completed
      && observer.started === observer.completed
      && now() - entry.readAtMs < SIGNING_KEY_CACHE_TTL_MS
    ) {
      return structuredClone(entry.rows);
    }

    entry = undefined;
    const startedAtOpen = observer?.started ?? 0;
    const completedAtOpen = observer?.completed ?? 0;
    const readAtMs = now();
    const rows = await read(ctx);
    if (
      observer
      && observer.started === startedAtOpen
      && observer.completed === completedAtOpen
      && observer.started === observer.completed
    ) {
      entry = { rows: structuredClone(rows), readAtMs, startedAtOpen, completedAtOpen };
    }
    return rows;
  };
}
