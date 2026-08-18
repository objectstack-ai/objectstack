// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9362] The card's reproduction, on the REAL stack — a real `ObjectQL` over a
 * real `SqlDriver` on better-sqlite3, driven through the real
 * `ObjectStackProtocolImplementation`'s data-plane delete (the method
 * `DELETE /api/v1/data/:object/:id` serves).
 *
 * ```
 * POST   /api/v1/data/showcase_account  {"name":"anything","status":"active"} -> 201
 * DELETE /api/v1/data/showcase_account/<id>                                   -> 400 INVALID_FILTER
 * ```
 *
 * Nothing below builds that refusal: `f_lookups` is declared exactly as the
 * showcase declares it — `Field.lookup('showcase_account', { multiple: true })`
 * — the real driver really does store it in a JSON TEXT column, and the real
 * `#7398` gate really does refuse the bare-equality probe
 * `cascadeDeleteRelations` used to build for it. The sibling unit suite
 * (`packages/objectql/src/engine-cascade-delete-multivalue-probe.test.ts`) pins
 * the probe's SPELLING against a double; this file is what proves the spelling
 * the fix chose is one this driver actually answers, and that the row is really
 * gone from the database afterwards.
 *
 * The dependent table is EMPTY in the first case, deliberately: the fault is
 * schema-driven, so a fixture with rows in it would prove less, not more.
 *
 * Both directions, as always on a referential guard: a fix that made the probe
 * find nothing would turn the 400 into a 200 and silently delete referenced
 * records. The `restrict` case asserts the full ADR-0112 envelope (`code` AND
 * `status`) and re-reads the row.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';

const ACCOUNT = { name: 'zz_account', fields: { name: { type: 'text' } } };

/** The showcase's own shape: a multi-value lookup at the object being deleted. */
const FIELD_ZOO = {
    name: 'zz_field_zoo',
    fields: {
        name: { type: 'text' },
        f_lookups: { type: 'lookup', reference: 'zz_account', multiple: true },
    },
};

/** The same relationship declared `restrict` — the guard direction. */
const GUARD = {
    name: 'zz_guard',
    fields: {
        name: { type: 'text' },
        accounts: {
            type: 'lookup', reference: 'zz_account',
            multiple: true, deleteBehavior: 'restrict',
        },
    },
};

const OWNER_PACKAGE = 'com.objectstack.test.9362';

describe('[#9362] REST DELETE on an object targeted by a multiple:true lookup — real driver', () => {
    let dir: string | null = null;
    let engine: ObjectQL | null = null;

    afterEach(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
        engine = null;
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    });

    async function rig(objects: unknown[]) {
        dir = mkdtempSync(join(tmpdir(), 'os-9362-real-'));
        const real = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: join(dir, 'data.sqlite') },
            useNullAsDefault: true,
        });
        await real.initObjects(objects as any);
        engine = new ObjectQL();
        engine.registerDriver(real as any, true);
        await engine.init();
        for (const o of objects) engine.registry.registerObject(o as any, OWNER_PACKAGE);
        const protocol: any = new ObjectStackProtocolImplementation(engine as any);
        return { protocol, real };
    }

    it('deletes the record and really removes the row (the card\'s 3/3 reproduction)', async () => {
        const { protocol, real } = await rig([ACCOUNT, FIELD_ZOO]);
        const created: any = await engine!.insert('zz_account', { name: 'anything' });
        expect(typeof created.id).toBe('string');
        // Schema-driven: the referring table has no rows at all.
        expect(await real.count('zz_field_zoo', {} as any)).toBe(0);

        const res = await protocol.deleteData({ object: 'zz_account', id: created.id });
        expect(res).toMatchObject({ object: 'zz_account', id: created.id, success: true });

        // Read the row count out of the DRIVER, not through the engine.
        expect(await real.count('zz_account', {} as any)).toBe(0);
    });

    it('still refuses the delete when a row really does reference it through the array', async () => {
        const { protocol, real } = await rig([ACCOUNT, GUARD]);
        const a: any = await engine!.insert('zz_account', { name: 'referenced' });
        await engine!.insert('zz_guard', { name: 'g', accounts: [a.id] });

        const err: any = await protocol
            .deleteData({ object: 'zz_account', id: a.id })
            .catch((e: any) => e);
        expect(err.code).toBe('DELETE_RESTRICTED');
        expect(err.status).toBe(409);
        expect(err.dependentObject).toBe('zz_guard');
        expect(err.dependentCount).toBe(1);
        expect(await real.count('zz_account', {} as any)).toBe(1);
    });

    it('a referenced id does not lend its dependents to an id it is a prefix of', async () => {
        const { protocol, real } = await rig([ACCOUNT, GUARD]);
        await engine!.insert('zz_account', { id: 'acc_1', name: 'one' });
        await engine!.insert('zz_account', { id: 'acc_10', name: 'ten' });
        // `LIKE '%acc_1%'` matches this row's serialization too.
        await engine!.insert('zz_guard', { name: 'g', accounts: ['acc_10'] });

        const res = await protocol.deleteData({ object: 'zz_account', id: 'acc_1' });
        expect(res).toMatchObject({ id: 'acc_1', success: true });
        expect(await real.count('zz_account', { where: { id: 'acc_10' } } as any)).toBe(1);

        const err: any = await protocol
            .deleteData({ object: 'zz_account', id: 'acc_10' })
            .catch((e: any) => e);
        expect(err.code).toBe('DELETE_RESTRICTED');
        expect(err.status).toBe(409);
    });
});
