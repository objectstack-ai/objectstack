// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Redis } from 'ioredis';
import type { IKV, KVEntry, KVSetOptions } from '@objectstack/spec/contracts';

/**
 * Stored payload shape: `{v: <value>, ver: <bigint as string>}`.
 * Versions are stored as strings because Redis values are bytes and
 * bigints can exceed JSON-safe-integer range.
 */
interface StoredKV {
    v: unknown;
    ver: string;
}

export class VersionMismatchError extends Error {
    constructor(
        public readonly key: string,
        public readonly expected: bigint,
        public readonly actual: bigint,
    ) {
        super(
            `KV version mismatch on "${key}": expected v${expected}, found v${actual}`,
        );
        this.name = 'VersionMismatchError';
    }
}

export interface RedisKVOptions {
    client: Redis;
    keyPrefix?: string;
}

/**
 * Redis-backed coordination KV with optimistic concurrency via WATCH/MULTI.
 *
 * Each `set()` performs:
 *   1. WATCH key
 *   2. GET key            → read current version
 *   3. compare to ifVersion (if provided)
 *   4. MULTI / SET / [PEXPIRE] / EXEC
 *
 * If a competing writer modifies the key between WATCH and EXEC the
 * transaction aborts and we throw `VersionMismatchError`, matching
 * memory driver semantics.
 *
 * **Not** a cache — uses small JSON envelopes and per-key versioning.
 * Use service-cache for high-throughput caching.
 */
export class RedisKV implements IKV {
    private readonly client: Redis;
    private readonly keyPrefix: string;
    private closed = false;

    constructor(opts: RedisKVOptions) {
        this.client = opts.client;
        this.keyPrefix = opts.keyPrefix ?? 'os:';
    }

    async get<T = unknown>(key: string): Promise<KVEntry<T> | undefined> {
        const raw = await this.client.get(this.kvKey(key));
        if (raw === null) return undefined;
        const parsed = this.parse(raw);
        if (!parsed) return undefined;
        const pttl = await this.client.pttl(this.kvKey(key));
        const expiresAt = pttl > 0 ? Date.now() + pttl : undefined;
        return {
            key,
            value: parsed.v as T,
            version: BigInt(parsed.ver),
            expiresAt,
        };
    }

    async set<T = unknown>(
        key: string,
        value: T,
        opts: KVSetOptions = {},
    ): Promise<KVEntry<T>> {
        if (this.closed) throw new Error('RedisKV is closed');
        const physical = this.kvKey(key);
        const ttlMs = opts.ttl && opts.ttl > 0 ? opts.ttl * 1000 : undefined;

        // Optimistic-concurrency loop — Redis WATCH aborts the MULTI on
        // any intervening write.
        while (true) {
            await this.client.watch(physical);
            const raw = await this.client.get(physical);
            const existing = raw ? this.parse(raw) : undefined;
            const existingVersion = existing ? BigInt(existing.ver) : 0n;

            if (opts.ifVersion !== undefined && opts.ifVersion !== existingVersion) {
                await this.client.unwatch();
                throw new VersionMismatchError(key, opts.ifVersion, existingVersion);
            }

            const newVersion = existingVersion + 1n;
            const payload: StoredKV = { v: value, ver: newVersion.toString() };
            const encoded = JSON.stringify(payload);

            const multi = this.client.multi();
            if (ttlMs) {
                multi.set(physical, encoded, 'PX', ttlMs);
            } else {
                multi.set(physical, encoded);
            }
            const result = await multi.exec();
            // exec() returns null when WATCH detected a concurrent change.
            if (result === null) continue;

            return {
                key,
                value,
                version: newVersion,
                expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
            };
        }
    }

    async delete(key: string, opts: { ifVersion?: bigint } = {}): Promise<boolean> {
        if (this.closed) throw new Error('RedisKV is closed');
        const physical = this.kvKey(key);

        if (opts.ifVersion === undefined) {
            const removed = await this.client.del(physical);
            return removed > 0;
        }

        while (true) {
            await this.client.watch(physical);
            const raw = await this.client.get(physical);
            if (!raw) {
                await this.client.unwatch();
                return false;
            }
            const parsed = this.parse(raw);
            if (!parsed) {
                await this.client.unwatch();
                return false;
            }
            const currentVersion = BigInt(parsed.ver);
            if (opts.ifVersion !== currentVersion) {
                await this.client.unwatch();
                throw new VersionMismatchError(key, opts.ifVersion, currentVersion);
            }
            const multi = this.client.multi();
            multi.del(physical);
            const result = await multi.exec();
            if (result === null) continue;
            return (result[0]?.[1] as number) > 0;
        }
    }

    async cas<T = unknown>(
        key: string,
        expectedVersion: bigint,
        next: T,
        opts: Omit<KVSetOptions, 'ifVersion'> = {},
    ): Promise<KVEntry<T> | undefined> {
        try {
            return await this.set(key, next, { ...opts, ifVersion: expectedVersion });
        } catch (err) {
            if (err instanceof VersionMismatchError) return undefined;
            throw err;
        }
    }

    async close(): Promise<void> {
        this.closed = true;
    }

    private kvKey(key: string): string {
        return `${this.keyPrefix}kv:${key}`;
    }

    private parse(raw: string): StoredKV | undefined {
        try {
            const obj = JSON.parse(raw) as StoredKV;
            if (typeof obj.ver !== 'string') return undefined;
            return obj;
        } catch {
            return undefined;
        }
    }
}
