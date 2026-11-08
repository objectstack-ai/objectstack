// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  NoopMetricsRegistry,
  SEMCONV,
  type MetricsRegistry,
} from '@objectstack/observability';
import type { ICacheService, CacheStats } from '@objectstack/spec/contracts';

/**
 * The slice of an ioredis client this adapter issues commands on. Declared
 * structurally so `@objectstack/service-cache` takes no dependency on a Redis
 * client library: the client arrives from whoever owns the connection — the
 * redis cluster driver (`@objectstack/service-cluster-redis`, through
 * `readClusterDriverConnection`) or a host that passes its own.
 */
export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  scan(cursor: string | number, ...args: Array<string | number>): Promise<[string, string[]]>;
  quit(): Promise<unknown>;
  /** ioredis' "same settings, new connection". Optional: a client without it is borrowed as-is. */
  duplicate?(): RedisCacheClient;
}

/**
 * Configuration for the Redis cache adapter.
 */
export interface RedisCacheAdapterOptions {
  /**
   * The client to issue commands on. Required at run time — the constructor
   * refuses without it. It is optional in this type only so the retired
   * `url`-only form still type-checks and is refused with a prescription
   * rather than a compile error that says nothing.
   */
  client?: RedisCacheClient;
  /**
   * @deprecated Never read. The adapter constructs no client of its own: the
   * Redis a deployment shares is the cluster driver's (`OS_CLUSTER_DRIVER=redis`
   * + `OS_REDIS_URL`), and `CacheServicePlugin` hands its connection over.
   * Pass `client` instead.
   */
  url?: string;
  /**
   * The deployment's key namespace (default `'os:'` — the redis cluster
   * driver's). Entries are stored at `<keyPrefix>cache:<key>`, so the cache
   * never collides with the driver's own `kv:` / `ctr:` / lock keys, and
   * `clear()` touches nothing outside `<keyPrefix>cache:`.
   */
  keyPrefix?: string;
  /** Default TTL in seconds (0 = no expiry). Same meaning as the memory adapter's. */
  defaultTtl?: number;
  /** Optional MetricsRegistry for instrumentation. Defaults to NoopMetricsRegistry. */
  metrics?: MetricsRegistry;
  /**
   * Whether `close()` quits `client` (default `false`: a client handed in
   * belongs to whoever made it). `CacheServicePlugin` sets it for the
   * connection it derives from the cluster driver's, which nobody else holds.
   */
  ownsClient?: boolean;
}

/** SCAN page size for `clear()` / `stats()`. A hint to Redis, not a limit. */
const SCAN_COUNT = 500;

/**
 * A `SCAN MATCH` pattern that selects AT LEAST every key under `namespace`:
 * each glob metacharacter in it becomes `?` (any one character, the literal
 * included). The caller keeps only the keys that really start with
 * `namespace`, so the pattern never has to be escaped — backslash escapes in
 * `MATCH` are honoured by Redis but not by every Redis-speaking server or
 * double, and a pattern one of them misreads would silently skip keys.
 */
function widenedMatch(namespace: string): string {
  return `${namespace.replace(/[*?[\]\\]/g, '?')}*`;
}

/**
 * Redis-backed `ICacheService` — the cache every node of a multi-node
 * deployment reaches, so a counter kept in it (better-auth's sign-in rate
 * limits through `rateLimit.customStorage`, the inbound API budget, the OTP
 * send budget) is ONE counter across nodes rather than one per node
 * (ADR-0069 D2).
 *
 * Semantics match `MemoryCacheAdapter` where the contract speaks:
 *
 * - `get` answers `undefined` on a miss; `set`'s `ttl` is in SECONDS (fractions
 *   allowed), falling back to `defaultTtl`, and `0` means no expiry. Redis
 *   expires the key itself (`SET … PX`), so an expired entry is gone for every
 *   node at once.
 * - `delete` answers whether the key existed.
 *
 * Where a shared store must differ, it says so:
 *
 * - **Values cross a process boundary, so they are JSON.** A value is stored as
 *   `JSON.stringify(value)` and read back with `JSON.parse`: plain objects,
 *   arrays, strings, numbers, booleans and `null` round-trip; a `Date` comes
 *   back as its ISO string, and a value JSON cannot represent (`undefined`, a
 *   function, a `bigint`) is refused with a `TypeError` rather than stored as
 *   something else. Every in-repo consumer stores JSON strings.
 * - **`stats()` mixes two scopes.** `hits` / `misses` count THIS process's
 *   lookups (they are instrumentation, not shared state); `keyCount` counts the
 *   shared namespace on the server.
 * - **A Redis failure is thrown, never answered as a miss.** A cache that turned
 *   an outage into "not found" would silently reset every counter kept in it.
 *   What a failure means is each consumer's decision: the inbound limiter lets
 *   the request through, better-auth's limiter fails the request.
 *
 * Counters stay read-modify-write: `ICacheService` has no atomic increment, so
 * two nodes counting one key in the same instant can both be admitted at a
 * limit's boundary. That is the bounded imprecision ADR-0069 D2 accepts in
 * exchange for one shared count instead of `declared × nodes`.
 */
export class RedisCacheAdapter implements ICacheService {
  private readonly client: RedisCacheClient;
  private readonly namespace: string;
  private readonly matchAll: string;
  private readonly defaultTtl: number;
  private readonly metrics: MetricsRegistry;
  private readonly ownsClient: boolean;
  private hits = 0;
  private misses = 0;
  private closed = false;
  private static readonly LABELS = { adapter: 'redis' } as const;

  constructor(options: RedisCacheAdapterOptions) {
    if (!options.client) {
      throw new TypeError(
        'RedisCacheAdapter needs a Redis client (`client`). It constructs none of its own' +
          (options.url ? ' — `url` is not read' : '') +
          ': hand it the cluster driver\'s connection (CacheServicePlugin does this when the redis cluster ' +
          'driver is running) or pass an ioredis client you own.',
      );
    }
    this.client = options.client;
    this.namespace = `${options.keyPrefix ?? 'os:'}cache:`;
    this.matchAll = widenedMatch(this.namespace);
    this.defaultTtl = options.defaultTtl ?? 0;
    this.metrics = options.metrics ?? new NoopMetricsRegistry();
    this.ownsClient = options.ownsClient === true;
  }

  /** The prefix every entry is stored under (`<keyPrefix>cache:`). */
  get keyNamespace(): string {
    return this.namespace;
  }

  private recordLookup(result: 'hit' | 'miss'): void {
    if (result === 'hit') this.hits++;
    else this.misses++;
    try {
      this.metrics.counter(SEMCONV.cacheLookupsTotal, { ...RedisCacheAdapter.LABELS, result });
    } catch { /* never throw from instrumentation */ }
  }

  private recordWrite(op: 'set' | 'delete' | 'clear'): void {
    try {
      this.metrics.counter(SEMCONV.cacheWritesTotal, { ...RedisCacheAdapter.LABELS, op });
    } catch { /* never throw from instrumentation */ }
  }

  private physical(key: string): string {
    return this.namespace + key;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('RedisCacheAdapter is closed');
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    this.assertOpen();
    const raw = await this.client.get(this.physical(key));
    if (raw === null || raw === undefined) {
      this.recordLookup('miss');
      return undefined;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      // Not written by this adapter (it only ever stores JSON). A cache may
      // always answer "miss"; it may never answer bytes it cannot vouch for.
      this.recordLookup('miss');
      return undefined;
    }
    this.recordLookup('hit');
    return value as T;
  }

  async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
    this.assertOpen();
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') {
      throw new TypeError(
        `RedisCacheAdapter.set("${key}"): the value has no JSON representation (${typeof value}) — ` +
          'a shared cache stores JSON so every node reads back what was written.',
      );
    }
    const effectiveTtl = ttl ?? this.defaultTtl;
    if (effectiveTtl > 0) {
      await this.client.set(this.physical(key), encoded, 'PX', Math.max(1, Math.ceil(effectiveTtl * 1000)));
    } else {
      await this.client.set(this.physical(key), encoded);
    }
    this.recordWrite('set');
  }

  async delete(key: string): Promise<boolean> {
    this.assertOpen();
    const removed = await this.client.del(this.physical(key));
    this.recordWrite('delete');
    return removed > 0;
  }

  async has(key: string): Promise<boolean> {
    this.assertOpen();
    const present = (await this.client.exists(this.physical(key))) > 0;
    this.recordLookup(present ? 'hit' : 'miss');
    return present;
  }

  /** Remove every entry under this adapter's namespace — and nothing outside it. */
  async clear(): Promise<void> {
    this.assertOpen();
    await this.scanNamespace(async (keys) => {
      if (keys.length > 0) await this.client.del(...keys);
    });
    this.recordWrite('clear');
  }

  async stats(): Promise<CacheStats> {
    this.assertOpen();
    // SCAN may hand one key back on more than one page; count each once.
    const seen = new Set<string>();
    await this.scanNamespace(async (keys) => {
      for (const k of keys) seen.add(k);
    });
    return { hits: this.hits, misses: this.misses, keyCount: seen.size };
  }

  /**
   * Stop using the client; quit it when this adapter owns it. Idempotent, and
   * never throws — it runs on the shutdown path.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.ownsClient) return;
    try {
      await this.client.quit();
    } catch { /* the connection is going away either way */ }
  }

  private async scanNamespace(visit: (keys: string[]) => Promise<void>): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', this.matchAll, 'COUNT', SCAN_COUNT);
      await visit(keys.filter((k) => k.startsWith(this.namespace)));
      cursor = String(next);
    } while (cursor !== '0');
  }
}
