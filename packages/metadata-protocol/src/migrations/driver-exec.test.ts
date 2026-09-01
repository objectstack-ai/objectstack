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

import { driverCanRunSql, resolveDriverExec } from './driver-exec.js';

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
