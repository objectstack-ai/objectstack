// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The order pin for this package's raw-SQL seam resolution.
 *
 * Three sites used to resolve a raw-SQL entry point off a driver in TWO
 * different orders (`partial-index-probe.ts` and `protocol.ts`'s
 * `ensureOverlayIndex` tried `raw` first, `seed-tenancy-backfill.ts` tried
 * `execute` first). They now share `./driver-exec.ts`, which tries the surface
 * `IDataDriver` DECLARES — `execute`, non-optional — and keeps `raw` as the
 * fallback for a host or third-party driver that defines it.
 *
 * What this file pins is the SELECTION, across all four driver shapes that can
 * reach the resolver:
 *
 * | shape        | selected  |
 * |:-------------|:----------|
 * | execute only | `execute` |
 * | raw only     | `raw`     |
 * | BOTH         | `execute` |
 * | neither      | undefined |
 *
 * The `both` row is the one with teeth. On every driver this repo ships the
 * `raw` limb is unreachable — no data driver defines `raw` — so a test using a
 * realistic double would pass under EITHER order and pin nothing. Only a double
 * offering both surfaces can tell the two orders apart, which is why the row
 * exists and why it is asserted on the call arguments rather than on a return
 * value.
 *
 * ⚠️ This pin is about the ORDER only. `typeof driver.execute === 'function'`
 * cannot tell "declares the surface" from "can actually run SQL" — two shipped
 * drivers satisfy the declaration and execute nothing — and nothing here should
 * be read as endorsing that probe. See `./driver-exec.ts`'s header.
 */

import { describe, it, expect, vi } from 'vitest';

import { driverCanRunSql, resolveDriverClientName, resolveDriverExec } from './driver-exec.js';
import { catalogFamilyOf } from './read-probe.js';

describe('resolveDriverExec — surface selection', () => {
    it('selects execute() on a driver that offers only execute', async () => {
        const execute = vi.fn(async () => 'ran');
        const exec = resolveDriverExec({ execute } as any);

        expect(exec).toBeTypeOf('function');
        await exec!('SELECT 1');
        expect(execute).toHaveBeenCalledWith('SELECT 1', []);
    });

    it('selects raw() on a driver that offers only raw', async () => {
        const raw = vi.fn(async () => 'ran');
        const exec = resolveDriverExec({ raw } as any);

        expect(exec).toBeTypeOf('function');
        await exec!('SELECT 1');
        expect(raw).toHaveBeenCalledWith('SELECT 1', []);
    });

    it('selects execute() — NOT raw() — on a driver that offers BOTH', async () => {
        // The row that separates the two orders. Under the pre-alignment
        // raw-first order this expectation is exactly inverted, so a regression
        // to `raw` first fails here and nowhere else.
        const raw = vi.fn(async () => 'raw');
        const execute = vi.fn(async () => 'execute');

        await resolveDriverExec({ raw, execute } as any)!('SELECT 1');

        expect(execute).toHaveBeenCalledWith('SELECT 1', []);
        expect(raw).not.toHaveBeenCalled();
    });

    it('returns undefined on a driver that offers neither', () => {
        expect(resolveDriverExec({} as any)).toBeUndefined();
        expect(resolveDriverExec(null)).toBeUndefined();
        expect(resolveDriverExec(undefined)).toBeUndefined();
        // A non-callable member of the right NAME must not satisfy the probe.
        expect(resolveDriverExec({ execute: 'yes', raw: 42 } as any)).toBeUndefined();
    });

    it('passes bindings positionally to whichever surface is selected', async () => {
        // `IDataDriver.execute(command, parameters?)` takes bindings as the
        // second POSITIONAL argument. The `raw` limb is held to the same call
        // shape: before the alignment this package's `raw` fallback in
        // `seed-tenancy-backfill.ts` dropped its `params` argument on the floor,
        // which was invisible only because that limb is unreachable today.
        const execute = vi.fn(async () => undefined);
        await resolveDriverExec({ execute } as any)!('SELECT ?', ['a']);
        expect(execute).toHaveBeenCalledWith('SELECT ?', ['a']);

        const raw = vi.fn(async () => undefined);
        await resolveDriverExec({ raw } as any)!('SELECT ?', ['b']);
        expect(raw).toHaveBeenCalledWith('SELECT ?', ['b']);
    });
});

describe('driverCanRunSql', () => {
    it('agrees with resolveDriverExec on all four shapes', () => {
        const shapes: Array<[string, unknown]> = [
            ['execute only', { execute: async () => undefined }],
            ['raw only', { raw: async () => undefined }],
            ['both', { execute: async () => undefined, raw: async () => undefined }],
            ['neither', {}],
            ['null', null],
        ];

        // The predicate is DEFINED as the resolution succeeding; this pins that
        // the two cannot drift into disagreeing about which drivers count.
        for (const [label, driver] of shapes) {
            expect(
                driverCanRunSql(driver),
                `${label}: predicate must match resolution`,
            ).toBe(resolveDriverExec(driver as any) !== undefined);
        }

        expect(driverCanRunSql({ execute: async () => undefined })).toBe(true);
        expect(driverCanRunSql({})).toBe(false);
    });
});

/**
 * [#32154] A driver configured with a knex Client CLASS, not a name, still
 * answers the dialect it speaks.
 *
 * `@objectstack/driver-sqlite-wasm` hands knex its own dialect class
 * (`Client_WasmSqlite`, `dialect: 'sqlite3'`), so `config.client` and
 * `knex.client.config.client` both hold a function. The resolver read three
 * places for a string and found none, the table-presence probe got no catalog
 * arm, and its raising fallback printed `DATABASE_ERROR … no such table:
 * _objectstack_sequences` on every boot of a project that had never numbered a
 * record. The doubles below are shaped the way knex builds that driver: the
 * dialect sits on the Client's prototype, the class on both configs.
 */
describe('resolveDriverClientName — the dialect of a driver built from a Client class', () => {
    class ClientWasmSqliteDouble {}
    Object.assign(ClientWasmSqliteDouble.prototype, { dialect: 'sqlite3', driverName: 'wasm-sqlite' });

    const classConfiguredDriver = () => {
        const client = new ClientWasmSqliteDouble() as any;
        client.config = { client: ClientWasmSqliteDouble };
        return { config: { client: ClientWasmSqliteDouble }, knex: { client } };
    };

    it("answers the Client's own dialect when no name was configured", () => {
        expect(resolveDriverClientName(classConfiguredDriver())).toBe('sqlite3');
        // …which is the catalog family the table-presence probe needs.
        expect(catalogFamilyOf(resolveDriverClientName(classConfiguredDriver()))).toBe('sqlite');
    });

    it('a configured NAME still wins over the dialect', () => {
        const driver = classConfiguredDriver() as any;
        driver.config = { client: 'better-sqlite3' };
        expect(resolveDriverClientName(driver)).toBe('better-sqlite3');
    });

    it('still answers undefined when neither a name nor a dialect is there', () => {
        expect(resolveDriverClientName({ config: { client: ClientWasmSqliteDouble }, knex: { client: {} } })).toBeUndefined();
        expect(resolveDriverClientName({})).toBeUndefined();
    });
});
