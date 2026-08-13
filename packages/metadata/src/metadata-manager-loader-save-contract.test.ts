// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5654 — the `save` half of the same gate #5276 built for `delete`.
 *
 * `register()` persists into every writable `datasource:` loader, and it read
 * `loader.save &&` FIRST: a loader declaring `protocol: 'datasource:'` with
 * `capabilities.write: true` but implementing no `save()` was **silently
 * skipped** — no warn, no error, nothing. `register()` then wrote the in-memory
 * registry, invalidated the list cache, announced `created`/`updated` and
 * notified watchers, so the caller was told the write succeeded. The item read
 * back correctly for the life of the process and was gone at the next restart,
 * with nothing to retry it. Durability degradation of the exact shape AGENTS.md
 * → "Degradation log levels" says must not even be a `warn`.
 *
 * #5276 (PR #5652) closed the mirror-image hole on `delete` and deliberately
 * stopped there, which left ONE declaration binding at one end of an item's
 * life and decorative at the other:
 *
 *   - delete side: declared = enforced (registration throws);
 *   - save side:   declared ≠ enforced (registration passes, the write is lost).
 *
 * The fix is the same cure one direction over — `registerLoader()`'s gate,
 * renamed `assertWritableLoaderContract`, now requires BOTH methods and says so
 * in one message. `register()`'s `save` short-circuit survives as defensive
 * code whose unreachability is guaranteed by construction, exactly like
 * `unregister()`'s.
 *
 * What these tests pin:
 *   1. the rejection of a `save`-less writable datasource loader, on both entry
 *      points (constructor config and the direct `registerLoader()` call),
 *      including that nothing is half-registered;
 *   2. the message is actionable — it names the loader, the consequence, and
 *      both repairs — and is the ONE text `buildWritableLoaderMissingMethodsMessage`
 *      builds, quoted rather than paraphrased;
 *   3. a loader missing BOTH methods is rejected once, naming both;
 *   4. the positive case is untouched and really durable: a loader with both
 *      methods registers, `register()` reaches its store, and the row is still
 *      there for a fresh manager over the same store — the "restart" the silent
 *      skip used to lose;
 *   5. the gate's scope is exactly the combination `register()` acts on — a
 *      read-only `datasource:` loader and every non-`datasource:` protocol
 *      register without a `save`, because the manager never persists to them;
 *   6. `DatabaseLoader`, the repo's only real `datasource:` loader, passes the
 *      widened gate unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
    MetadataLoadResult,
    MetadataLoaderContract,
    MetadataSaveResult,
    MetadataStats,
} from '@objectstack/spec/system';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { MetadataManager, buildWritableLoaderMissingMethodsMessage } from './metadata-manager.js';
import { DatabaseLoader } from './loaders/database-loader.js';
import type { MetadataLoader } from './loaders/loader-interface.js';

const logger = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
    createLogger: () => logger,
}));

type Protocol = MetadataLoaderContract['protocol'];

/**
 * A loader whose contract is dictated per test and whose `save`/`delete` are
 * present or absent on demand — the axes the gate reads, and nothing else. The
 * backing store is shared by reference so a second manager can be pointed at it
 * to play "restart".
 */
function makeLoader(opts: {
    name: string;
    protocol: Protocol;
    write: boolean;
    withSave: boolean;
    withDelete: boolean;
    store?: Map<string, unknown>;
}): MetadataLoader & {
    store: Map<string, unknown>;
    saveCalls: Array<[string, string]>;
    deleteCalls: Array<[string, string]>;
} {
    const saveCalls: Array<[string, string]> = [];
    const deleteCalls: Array<[string, string]> = [];
    const store = opts.store ?? new Map<string, unknown>();
    const key = (type: string, name: string) => `${type}/${name}`;

    const loader: MetadataLoader & {
        store: Map<string, unknown>;
        saveCalls: Array<[string, string]>;
        deleteCalls: Array<[string, string]>;
    } = {
        contract: {
            name: opts.name,
            protocol: opts.protocol,
            capabilities: { read: true, write: opts.write, watch: false, list: true },
        },
        store,
        saveCalls,
        deleteCalls,
        async load(type: string, name: string): Promise<MetadataLoadResult> {
            const data = store.get(key(type, name));
            return data === undefined ? { data: null } : { data };
        },
        async loadMany<T = unknown>(): Promise<T[]> {
            return Array.from(store.values()) as T[];
        },
        async exists(type: string, name: string): Promise<boolean> {
            return store.has(key(type, name));
        },
        async stat(): Promise<MetadataStats | null> {
            return null;
        },
        async list(): Promise<string[]> {
            return [];
        },
    };

    if (opts.withSave) {
        loader.save = async (type: string, name: string, data: unknown): Promise<MetadataSaveResult> => {
            saveCalls.push([type, name]);
            store.set(key(type, name), data);
            return { success: true };
        };
    }

    if (opts.withDelete) {
        loader.delete = async (type: string, name: string): Promise<void> => {
            deleteCalls.push([type, name]);
            store.delete(key(type, name));
        };
    }

    return loader;
}

/** Read the manager's private loader map — the thing registration writes. */
const registeredLoaderNames = (mgr: MetadataManager): string[] =>
    Array.from((mgr as unknown as { loaders: Map<string, unknown> }).loaders.keys());

const messageOf = (run: () => unknown): string => {
    try {
        run();
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error('expected the call to throw, but it returned normally');
};

beforeEach(() => {
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
    logger.debug.mockClear();
});

describe('a `datasource:` loader that declares `capabilities.write` MUST implement `save()`', () => {
    const unsavable = () =>
        makeLoader({
            name: 'half_writable_store',
            protocol: 'datasource:',
            write: true,
            withSave: false,
            withDelete: true,
        });

    it('registerLoader() throws rather than accepting a loader it can never persist into', () => {
        const mgr = new MetadataManager({ formats: ['json'], loaders: [] });

        expect(() => mgr.registerLoader(unsavable())).toThrow(/half_writable_store/);
    });

    it('…and nothing is half-registered — the rejected loader is not in the map', () => {
        const mgr = new MetadataManager({ formats: ['json'], loaders: [] });

        expect(() => mgr.registerLoader(unsavable())).toThrow();
        expect(registeredLoaderNames(mgr)).not.toContain('half_writable_store');
    });

    it('the constructor rejects it too — `config.loaders` is not a back door', () => {
        expect(
            () => new MetadataManager({ formats: ['json'], loaders: [unsavable()] }),
        ).toThrow(/half_writable_store/);
    });

    it('the message names the loader, the consequence, and BOTH repairs', () => {
        const mgr = new MetadataManager({ formats: ['json'], loaders: [] });
        const message = messageOf(() => mgr.registerLoader(unsavable()));

        // Which loader, and what it declared.
        expect(message).toContain('half_writable_store');
        expect(message).toContain("protocol: 'datasource:'");
        expect(message).toContain('capabilities.write: true');
        expect(message).toContain('implements no `save()` method');
        // The consequence: the write is announced, never lands, and vanishes at
        // restart while everything keeps looking healthy.
        expect(message).toContain('`register()`');
        expect(message).toContain('`created`/`updated`');
        expect(message).toContain('gone at the next restart');
        // Repair A — implement it. Repair B — stop declaring the capability.
        expect(message).toContain('save(type: string, name: string, data: any');
        expect(message).toContain('capabilities.write: false');
        // …and it is the one text the builder owns, not a paraphrase of it.
        expect(message).toBe(buildWritableLoaderMissingMethodsMessage('half_writable_store', ['save']));
    });

    it('a loader missing BOTH methods is rejected once, naming both', () => {
        const mgr = new MetadataManager({ formats: ['json'], loaders: [] });
        const neither = makeLoader({
            name: 'inert_store',
            protocol: 'datasource:',
            write: true,
            withSave: false,
            withDelete: false,
        });

        const message = messageOf(() => mgr.registerLoader(neither));

        expect(message).toContain('implements neither a `save()` nor a `delete()` method');
        expect(message).toContain('save(type: string, name: string, data: any');
        expect(message).toContain('delete(type: string, name: string)');
        expect(message).toBe(
            buildWritableLoaderMissingMethodsMessage('inert_store', ['save', 'delete']),
        );
    });

    it('the `delete`-only rejection #5276 shipped still reads exactly as it did', () => {
        const mgr = new MetadataManager({ formats: ['json'], loaders: [] });
        const undeletable = makeLoader({
            name: 'append_only_store',
            protocol: 'datasource:',
            write: true,
            withSave: true,
            withDelete: false,
        });

        const message = messageOf(() => mgr.registerLoader(undeletable));

        expect(message).toContain('implements no `delete()` method');
        expect(message).toContain('`unregister()`');
        expect(message).toContain('`deleted`');
        expect(message).not.toContain('`save()`');
    });
});

describe('the positive case is untouched — and the write is really durable', () => {
    it('a loader with both methods registers, is written to, and survives a restart', async () => {
        const store = new Map<string, unknown>();
        const writable = makeLoader({
            name: 'writable_store',
            protocol: 'datasource:',
            write: true,
            withSave: true,
            withDelete: true,
            store,
        });

        const mgr = new MetadataManager({ formats: ['json'], loaders: [writable] });
        expect(registeredLoaderNames(mgr)).toContain('writable_store');

        await mgr.register('object', 'account', { name: 'account' });
        expect(writable.saveCalls).toEqual([['object', 'account']]);

        // The restart the silent skip used to lose: a fresh manager holding an
        // empty registry, reading the same store.
        const afterRestart = new MetadataManager({
            formats: ['json'],
            loaders: [
                makeLoader({
                    name: 'writable_store',
                    protocol: 'datasource:',
                    write: true,
                    withSave: true,
                    withDelete: true,
                    store,
                }),
            ],
        });
        expect(await afterRestart.get('object', 'account')).toEqual({ name: 'account' });

        // …and the other half of the contract still works through the same gate.
        await mgr.unregister('object', 'account');
        expect(writable.deleteCalls).toEqual([['object', 'account']]);
        expect(store.has('object/account')).toBe(false);
    });
});

describe('the gate covers exactly the combination `register()` acts on', () => {
    it('a read-only `datasource:` loader needs no `save` — nothing ever writes to it', async () => {
        const readOnly = makeLoader({
            name: 'reporting_replica',
            protocol: 'datasource:',
            write: false,
            withSave: false,
            withDelete: false,
        });

        const mgr = new MetadataManager({ formats: ['json'], loaders: [readOnly] });
        expect(registeredLoaderNames(mgr)).toContain('reporting_replica');

        await expect(mgr.register('object', 'account', { name: 'account' })).resolves.toBeUndefined();
        expect(readOnly.saveCalls).toEqual([]);
    });

    it.each<Protocol>(['file:', 'memory:', 'http:', 's3:'])(
        'a `%s` loader may declare write without a `save` — the manager never persists there',
        (protocol) => {
            const loader = makeLoader({
                name: `loader_${protocol.replace(':', '')}`,
                protocol,
                write: true,
                withSave: false,
                withDelete: false,
            });

            const mgr = new MetadataManager({ formats: ['json'], loaders: [] });
            expect(() => mgr.registerLoader(loader)).not.toThrow();
            expect(registeredLoaderNames(mgr)).toContain(loader.contract.name);
        },
    );
});

describe('regression — the real `datasource:` loader is unaffected', () => {
    /**
     * `DatabaseLoader` declares `datasource:` + `capabilities.write` and has
     * implemented both `save()` and `delete()` all along; the widened gate must
     * be a no-op for it. The driver is a stub because registration touches no
     * storage — construction and the contract are the whole surface here.
     */
    it('DatabaseLoader registers under the widened gate', () => {
        const loader = new DatabaseLoader({ driver: {} as IDataDriver });

        expect(loader.contract.protocol).toBe('datasource:');
        expect(loader.contract.capabilities.write).toBe(true);
        expect(typeof loader.save).toBe('function');
        expect(typeof loader.delete).toBe('function');

        const mgr = new MetadataManager({ formats: ['json'], loaders: [] });
        expect(() => mgr.registerLoader(loader)).not.toThrow();
        expect(registeredLoaderNames(mgr)).toContain('database');
    });
});
