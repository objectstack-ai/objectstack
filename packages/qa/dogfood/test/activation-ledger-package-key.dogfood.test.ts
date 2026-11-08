// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D4, D8 row R4] The activation ledger (`sys_metadata_activation`) is
// unique on `(metadata_type, package_id, name)`, and a row that names no
// package is bound to the one package that holds its item at boot.
//
// ## What only a boot can measure
//
// The unit suites pin the declaration (`platform-objects`), the backfill's
// row rules (`core`) and the resolver's answer (`objectql`). What they cannot
// pin is what a DRIVER does with the declared index — whether the key the
// object declares is the key the table enforces — and whether the boot really
// runs the backfill after the holder seal, on the real showcase registry. So:
//
//  - the key, on both drivers the harness boots (`sqlite-wasm`, the SQL
//    driver, and `memory`): two packages may each hold a row of one name, one
//    package may not hold two;
//  - the backfill, on the SQL driver across restarts of one database file: a
//    row written with no package for a showcase flow names the showcase
//    package after the next boot, a position row stays as it is (positions are
//    environment-wide, ADR-0150 D7), and a third boot writes nothing.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const LEDGER = 'sys_metadata_activation';
/** Infrastructure rows, not tenant data: written and read the way the store does. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));

/** The showcase package, which ships the flow below. */
const SHOWCASE = 'com.example.showcase';
/** A packaged showcase flow no other flow calls, so switching it off disturbs nothing. */
const FLOW = 'showcase_scheduled_digest';
/** A position the showcase declares and nobody needs switched on during this file. */
const POSITION = 'showcase_auditor';

interface Engine {
    find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
    insert(object: string, data: unknown, options?: unknown): Promise<Record<string, unknown>>;
}

const engineOf = async (stack: VerifyStack) => (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;

/** The refusal an insert answered, as code and status — or a note that it answered none. */
async function refusalOf(write: Promise<unknown>): Promise<{ code?: unknown; status?: unknown } | 'accepted'> {
    try {
        await write;
        return 'accepted';
    } catch (e) {
        const err = e as { code?: unknown; status?: unknown; statusCode?: unknown };
        return { code: err.code, status: err.status ?? err.statusCode };
    }
}

for (const databaseDriver of ['sqlite-wasm', 'memory'] as const) {
    describe(`the ledger's unique key is (metadata_type, package_id, name) — ${databaseDriver} driver`, () => {
        let stack: VerifyStack;
        let ql: Engine;
        const NAME = `probe_key_${databaseDriver.replace(/-/g, '_')}`;
        const row = (packageId: string) => ({ metadata_type: 'flow', name: NAME, package_id: packageId, active: false });

        beforeAll(async () => {
            stack = await bootShowcase({ databaseDriver });
            ql = await engineOf(stack);
        }, 180_000);

        afterAll(async () => {
            await stack?.stop();
        });

        it('two packages may each hold a row for an item of the same name', async () => {
            expect(await refusalOf(ql.insert(LEDGER, row('com.acme.alpha'), { context: SYSTEM_CTX }))).toBe('accepted');
            expect(await refusalOf(ql.insert(LEDGER, row('com.acme.beta'), { context: SYSTEM_CTX }))).toBe('accepted');

            const rows = await ql.find(LEDGER, { where: { metadata_type: 'flow', name: NAME }, context: SYSTEM_CTX });
            expect(rows.map((r) => r.package_id).sort()).toEqual(['com.acme.alpha', 'com.acme.beta']);
        });

        it('one package may not hold two rows for one name: the second insert is refused as a duplicate', async () => {
            const refusal = await refusalOf(ql.insert(LEDGER, row('com.acme.alpha'), { context: SYSTEM_CTX }));
            expect(refusal).toEqual({ code: 'DUPLICATE_RECORD', status: 409 });

            const rows = await ql.find(LEDGER, {
                where: { metadata_type: 'flow', name: NAME, package_id: 'com.acme.alpha' },
                context: SYSTEM_CTX,
            });
            expect(rows).toHaveLength(1);
        });
    });
}

describe('a row with no package takes its one holder at the next boot (SQL driver, one database file)', () => {
    let stack: VerifyStack | undefined;
    let prevCwd: string;
    let dir: string;
    let dbFile: string;

    const rowsOf = async (type: string, name: string) => {
        const ql = await engineOf(stack!);
        return ql.find(LEDGER, { where: { metadata_type: type, name }, context: SYSTEM_CTX });
    };
    const restart = async () => {
        await stack?.stop();
        stack = await bootShowcase({ databaseFile: dbFile });
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-31682-'));
        dbFile = join(dir, 'showcase.db');
        stack = await bootShowcase({ databaseFile: dbFile });
        // Rows as a release before the package key could leave them: no package.
        const ql = await engineOf(stack);
        await ql.insert(LEDGER, { metadata_type: 'flow', name: FLOW, active: false }, { context: SYSTEM_CTX });
        await ql.insert(LEDGER, { metadata_type: 'position', name: POSITION, active: false }, { context: SYSTEM_CTX });
        await restart();
    }, 360_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('the flow row names the showcase package, and keeps the administrator\'s switch', async () => {
        const rows = await rowsOf('flow', FLOW);
        expect(rows).toHaveLength(1);
        expect(rows[0].package_id).toBe(SHOWCASE);
        expect(rows[0].active === false || rows[0].active === 0).toBe(true);
    });

    it('the position row stays as it is: positions are one environment-wide slot', async () => {
        const rows = await rowsOf('position', POSITION);
        expect(rows).toHaveLength(1);
        expect(rows[0].package_id ?? null).toBeNull();
    });

    it('a further boot writes nothing: the bound row is not touched again', async () => {
        const before = (await rowsOf('flow', FLOW))[0];
        await restart();
        const after = (await rowsOf('flow', FLOW))[0];
        expect(after.package_id).toBe(SHOWCASE);
        expect(after.updated_at).toEqual(before.updated_at);
    }, 180_000);
});
