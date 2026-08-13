// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5276 — `capabilities.write` means BOTH directions, and registration enforces it.
 *
 * `MetadataLoader` declared `save?` and no `delete`, so `capabilities.write`
 * meant two different things at the two ends of an item's life: to
 * `register()` it meant "persist into me", and to `unregister()` it guaranteed
 * nothing at all. `unregister()` duck-typed `delete` at the call site and, when
 * the loader had none, **silently skipped it** — then dropped the registry
 * entry, invalidated the list cache and announced a `deleted` event anyway. The
 * caller was told the delete succeeded; the row stayed in the loader and was
 * read straight back out by the next `list()`/`get()`, across restarts, with
 * nothing to retry it. Standard declared ≠ enforced (Prime Directive #10).
 *
 * The fix enforces the declaration where the author is standing:
 *   1. `MetadataLoader` now declares `delete?(type, name): Promise<void>` — the
 *      contract states the capability instead of leaving each caller to guess;
 *   2. `registerLoader()` REJECTS a `datasource:` loader that declares
 *      `capabilities.write` without a `delete()` method, loudly, naming the
 *      consequence and both ways out. `registerLoader()` is the sole writer of
 *      the loader map (the constructor's `config.loaders` funnel through it),
 *      so the rejected combination cannot reach the runtime at all;
 *   3. `unregister()`'s `typeof … === 'function'` guard stays as defensive code
 *      whose unreachability is now guaranteed by construction.
 *
 * What these tests pin:
 *   1. the rejection, on both entry points (constructor config and the direct
 *      `registerLoader()` call), including that nothing is half-registered;
 *   2. the message is actionable — it names the loader and BOTH repairs;
 *   3. the positive case is untouched: a writable datasource loader WITH
 *      `delete` registers and `unregister()` really calls it;
 *   4. the gate's scope is exactly the combination `unregister()` acts on —
 *      a read-only `datasource:` loader and every non-`datasource:` protocol
 *      register without a `delete`, because the manager never writes to them;
 *   5. `DatabaseLoader`, the repo's only real `datasource:` loader, passes the
 *      gate unchanged.
 *
 * [#5654] The gate this file pins has since been widened — it is
 * `assertWritableLoaderContract` now, and `capabilities.write` requires `save()`
 * as well, because `register()` had the identical silent skip one direction
 * over. Everything below still holds verbatim: these loaders all implement
 * `save`, so `delete` is the only thing missing and the message is unchanged.
 * The `save` half is pinned next door in
 * `metadata-manager-loader-save-contract.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
    MetadataLoadResult,
    MetadataLoaderContract,
    MetadataSaveResult,
    MetadataStats,
} from '@objectstack/spec/system';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { MetadataManager } from './metadata-manager.js';
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
 * A loader whose contract is dictated per test and whose `delete` is present or
 * absent on demand — the two axes the gate reads, and nothing else.
 */
function makeLoader(opts: {
    name: string;
    protocol: Protocol;
    write: boolean;
    withDelete: boolean;
}): MetadataLoader & { deleteCalls: Array<[string, string]>; saveCalls: Array<[string, string]> } {
    const deleteCalls: Array<[string, string]> = [];
    const saveCalls: Array<[string, string]> = [];
    const store = new Map<string, unknown>();
    const key = (type: string, name: string) => `${type}/${name}`;

    const loader: MetadataLoader & {
        deleteCalls: Array<[string, string]>;
        saveCalls: Array<[string, string]>;
    } = {
        contract: {
            name: opts.name,
            protocol: opts.protocol,
            capabilities: { read: true, write: opts.write, watch: false, list: true },
        },
        deleteCalls,
        saveCalls,
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
        async save(type: string, name: string, data: unknown): Promise<MetadataSaveResult> {
            saveCalls.push([type, name]);
            store.set(key(type, name), data);
            return { success: true };
        },
    };

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

beforeEach(() => {
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.error.mockClear();
    logger.debug.mockClear();
});

describe("a `datasource:` loader that declares `capabilities.write` MUST implement `delete()`", () => {
    it('registerLoader() throws rather than accepting a loader it can never delete from', () => {
        const mgr = new MetadataManager({ formats: ['json'], loaders: [] });
        const undeletable = makeLoader({
            name: 'half_writable_store',
            protocol: 'datasource:',
            write: true,
            withDelete: false,
        });

        expect(() => mgr.registerLoader(undeletable)).toThrow(/half_writable_store/);
    });

    it('…and nothing is half-registered — the rejected loader is not in the map', () => {
        const mgr = new MetadataManager({ formats: ['json'], loaders: [] });
        const undeletable = makeLoader({
            name: 'half_writable_store',
            protocol: 'datasource:',
            write: true,
            withDelete: false,
        });

        expect(() => mgr.registerLoader(undeletable)).toThrow();
        expect(registeredLoaderNames(mgr)).not.toContain('half_writable_store');
    });

    it('the constructor rejects it too — `config.loaders` is not a back door', () => {
        const undeletable = makeLoader({
            name: 'half_writable_store',
            protocol: 'datasource:',
            write: true,
            withDelete: false,
        });

        expect(
            () => new MetadataManager({ formats: ['json'], loaders: [undeletable] }),
        ).toThrow(/half_writable_store/);
    });

    it('the message names the loader, the consequence, and BOTH repairs', () => {
        const mgr = new MetadataManager({ formats: ['json'], loaders: [] });
        const undeletable = makeLoader({
            name: 'half_writable_store',
            protocol: 'datasource:',
            write: true,
            withDelete: false,
        });

        let message = '';
        try {
            mgr.registerLoader(undeletable);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }

        // Which loader, and what it declared.
        expect(message).toContain('half_writable_store');
        expect(message).toContain("protocol: 'datasource:'");
        expect(message).toContain('capabilities.write: true');
        // The consequence: the delete is announced but never lands.
        expect(message).toContain('`unregister()`');
        expect(message).toContain('`deleted`');
        // Repair A — implement it. Repair B — stop declaring the capability.
        expect(message).toContain('delete(type: string, name: string)');
        expect(message).toContain('capabilities.write: false');
    });

    it('the same loader WITH `delete` registers, and `unregister()` really calls it', async () => {
        const deletable = makeLoader({
            name: 'writable_store',
            protocol: 'datasource:',
            write: true,
            withDelete: true,
        });
        const mgr = new MetadataManager({ formats: ['json'], loaders: [deletable] });

        expect(registeredLoaderNames(mgr)).toContain('writable_store');

        await mgr.register('object', 'account', { name: 'account' });
        expect(deletable.saveCalls).toEqual([['object', 'account']]);

        await mgr.unregister('object', 'account');
        expect(deletable.deleteCalls).toEqual([['object', 'account']]);
        // The announced deletion is now the truth in every store.
        expect(await mgr.get('object', 'account')).toBeUndefined();
        expect(await deletable.exists('object', 'account')).toBe(false);
    });
});

describe('the gate covers exactly the combination `unregister()` acts on', () => {
    it('a read-only `datasource:` loader needs no `delete` — nothing ever writes to it', async () => {
        const readOnly = makeLoader({
            name: 'reporting_replica',
            protocol: 'datasource:',
            write: false,
            withDelete: false,
        });

        const mgr = new MetadataManager({ formats: ['json'], loaders: [readOnly] });
        expect(registeredLoaderNames(mgr)).toContain('reporting_replica');

        await mgr.register('object', 'account', { name: 'account' });
        expect(readOnly.saveCalls).toEqual([]);
        await expect(mgr.unregister('object', 'account')).resolves.toBeUndefined();
    });

    it.each<Protocol>(['file:', 'memory:', 'http:', 's3:'])(
        'a `%s` loader may declare write without a `delete` — the manager never persists there',
        (protocol) => {
            const loader = makeLoader({
                name: `loader_${protocol.replace(':', '')}`,
                protocol,
                write: true,
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
     * implemented `delete()` all along; the gate must be a no-op for it. The
     * driver is a stub because registration touches no storage — construction
     * and the contract are the whole surface under test here.
     */
    it('DatabaseLoader registers under the gate', () => {
        const loader = new DatabaseLoader({ driver: {} as IDataDriver });

        expect(loader.contract.protocol).toBe('datasource:');
        expect(loader.contract.capabilities.write).toBe(true);
        expect(typeof loader.delete).toBe('function');

        const mgr = new MetadataManager({ formats: ['json'], loaders: [] });
        expect(() => mgr.registerLoader(loader)).not.toThrow();
        expect(registeredLoaderNames(mgr)).toContain('database');
    });
});
