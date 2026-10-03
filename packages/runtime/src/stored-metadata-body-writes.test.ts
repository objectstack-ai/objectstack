// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21520] The write half of the stored-metadata family's boundary for
 * app-authored bodies: a sandboxed body may not write a family table.
 *
 * Pinned against a counting scoped-API double (it records which verb reached
 * it, and stores nothing), then through the real QuickJS sandbox on both body
 * faces. What each case asserts:
 *
 *   - every write verb on each family table is refused with the boundary's
 *     envelope (`PERMISSION_DENIED` / 403) BEFORE the verb runs;
 *   - a predicate write is refused the same way whatever its predicate names,
 *     so a refused write answers identically and runs nothing;
 *   - reads still pass to the read seam, and every other object writes as
 *     before;
 *   - every derived context is refused the same way;
 *   - the read seam ALONE — a host code handler's `ctx.api` — keeps its writes:
 *     the boundary refuses bodies only.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch, assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { STORED_METADATA_BODY_OBJECTS } from '@objectstack/spec/kernel';
import { refuseStoredMetadataBodyWrites, serveStoredMetadataReadsThrough } from './stored-metadata-reader-seam.js';
import { actionBodyRunnerFactory, hookBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';

const FAMILY = [...STORED_METADATA_BODY_OBJECTS];
const ORDINARY = 'boundary_note';
const WRITE_VERBS = ['insert', 'create', 'update', 'updateById', 'upsert', 'delete', 'deleteById', 'updateMany', 'deleteMany'];
const READ_VERBS = ['find', 'findOne', 'count', 'aggregate'];

/** A scoped-API double that counts `<object>.<verb>` calls and answers neutral values. */
function countingApi(calls: string[] = []): any {
    const repo = (name: string) => {
        const record = (verb: string) => calls.push(`${name}.${verb}`);
        return {
            async find() { record('find'); return []; },
            async findOne() { record('findOne'); return null; },
            async count() { record('count'); return 0; },
            async aggregate() { record('aggregate'); return []; },
            async insert() { record('insert'); return { id: 'n1' }; },
            async create() { record('create'); return { id: 'n1' }; },
            async update(data?: any, opts?: any) { assertEngineUpdateDispatch(data, opts); record('update'); return 1; },
            async updateById() { record('updateById'); return { id: 'n1' }; },
            async upsert() { record('upsert'); return { id: 'n1' }; },
            async delete(opts?: any) { assertEngineDeleteDispatch(opts); record('delete'); return 1; },
            async deleteById() { record('deleteById'); return true; },
            async updateMany() { record('updateMany'); return 0; },
            async deleteMany() { record('deleteMany'); return 0; },
        };
    };
    return {
        object: repo,
        sudo: () => countingApi(calls),
        withRunAs: () => countingApi(calls),
        async transaction(callback: (trx: any) => Promise<unknown>) { return callback(countingApi(calls)); },
        async beginTransaction() { return { ctx: countingApi(calls), handle: 'trx_1', owned: true }; },
    };
}

/** The arguments a verb is called with here: a payload, then a by-id or predicate option. */
const argsOf = (verb: string): unknown[] =>
    verb === 'update' ? [{ label: 'x' }, { where: { id: 'r1' } }]
        : verb === 'delete' ? [{ where: { id: 'r1' } }]
            : verb.endsWith('ById') ? ['r1', { label: 'x' }]
                : [{ label: 'x' }];

function expectRefused(promise: Promise<unknown>, object: string, verb: string) {
    return expect(promise).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        status: 403,
        object,
        operation: verb,
        message: expect.stringContaining('/api/v1/meta/'),
    });
}

describe('[#21520] refuseStoredMetadataBodyWrites — every family write is refused before it runs', () => {
    for (const object of FAMILY) {
        it(`each write verb on '${object}' answers PERMISSION_DENIED / 403 and never reaches the store`, async () => {
            const calls: string[] = [];
            const api = refuseStoredMetadataBodyWrites(countingApi(calls));
            for (const verb of WRITE_VERBS) {
                await expectRefused(api.object(object)[verb](...argsOf(verb)), object, verb);
            }
            expect(calls).toEqual([]);
        });
    }

    it('a predicate write is refused identically whatever its predicate names, and runs nothing', async () => {
        const calls: string[] = [];
        const api = refuseStoredMetadataBodyWrites(countingApi(calls));
        const answers: unknown[] = [];
        for (const where of [{ type: 'view' }, { metadata: 'x' }, { checksum: 'x' }]) {
            for (const verb of ['updateMany', 'deleteMany', 'update', 'delete']) {
                const args = verb === 'update' ? [{ label: 'x' }, { where, multi: true }] : [{ where, multi: true }];
                const err: any = await api.object(FAMILY[0])[verb](...args).catch((e: unknown) => e);
                answers.push(`${verb}:${err?.code}:${err?.status}:${err?.message}`);
            }
        }
        // Three predicates, four verbs: the answer depends on the verb only.
        expect(new Set(answers).size).toBe(4);
        expect(calls).toEqual([]);
    });

    it('reads on a family table pass through to the read seam beneath it', async () => {
        const calls: string[] = [];
        const api = refuseStoredMetadataBodyWrites(countingApi(calls));
        for (const verb of READ_VERBS) await api.object(FAMILY[0])[verb]({});
        expect(calls).toEqual(READ_VERBS.map((verb) => `${FAMILY[0]}.${verb}`));
    });

    it('an ordinary table writes as before (control)', async () => {
        const calls: string[] = [];
        const api = refuseStoredMetadataBodyWrites(countingApi(calls));
        for (const verb of WRITE_VERBS) await api.object(ORDINARY)[verb](...argsOf(verb));
        expect(calls).toEqual(WRITE_VERBS.map((verb) => `${ORDINARY}.${verb}`));
    });

    it('every derived context refuses the same way: sudo, withRunAs, transaction(fn), beginTransaction', async () => {
        const calls: string[] = [];
        const api = refuseStoredMetadataBodyWrites(countingApi(calls));
        await expectRefused(api.sudo().object(FAMILY[0]).insert({ label: 'x' }), FAMILY[0], 'insert');
        await expectRefused(api.withRunAs('system', {}).object(FAMILY[1]).insert({ label: 'x' }), FAMILY[1], 'insert');
        await api.transaction(async (trx: any) => {
            await expectRefused(trx.object(FAMILY[0]).updateMany({ where: { type: 'view' } }), FAMILY[0], 'updateMany');
        });
        const begun = await api.beginTransaction();
        expect(begun.handle).toBe('trx_1');
        await expectRefused(begun.ctx.object(FAMILY[0]).delete({ where: { id: 'r1' } }), FAMILY[0], 'delete');
        expect(calls).toEqual([]);
    });

    it('layers over the read seam once: idempotent, and the read seam still sees its own mark', () => {
        const served = serveStoredMetadataReadsThrough(countingApi(), {});
        const layered = refuseStoredMetadataBodyWrites(served);
        expect(refuseStoredMetadataBodyWrites(layered)).toBe(layered);
        expect(serveStoredMetadataReadsThrough(layered, {})).toBe(layered);
    });

    it('the read seam ALONE — a host code handler\'s ctx.api — keeps its family writes (bodies only)', async () => {
        const calls: string[] = [];
        const api = serveStoredMetadataReadsThrough(countingApi(calls), {});
        await api.object(FAMILY[0]).insert({ label: 'x' });
        expect(calls).toEqual([`${FAMILY[0]}.insert`]);
    });
});

describe('[#21520] through the real sandbox — both body faces hold the refusing API', () => {
    const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000 });

    it('an action body\'s family write is refused with the envelope; its ordinary write lands', async () => {
        const calls: string[] = [];
        const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'boundary' });
        const handler = factory({
            name: 'writes_family',
            type: 'script',
            body: {
                language: 'js',
                capabilities: ['api.write'],
                source: `await ctx.api.object('${ORDINARY}').insert({ label: 'x' });
                         await ctx.api.object('${FAMILY[0]}').insert({ label: 'x' });
                         return { unreachable: true };`,
            },
        });
        await expect(handler!({ api: countingApi(calls), params: {} }))
            .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(calls).toEqual([`${ORDINARY}.insert`]);
    });

    it('a hook body on an ordinary table, writing a family table, is refused the same way', async () => {
        const calls: string[] = [];
        const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'boundary' });
        const handler = factory({
            name: 'ordinary_hook_writes_family',
            object: ORDINARY,
            events: ['afterInsert'],
            body: {
                language: 'js',
                capabilities: ['api.write'],
                source: `await ctx.api.object('${FAMILY[1]}').insert({ label: 'x' });`,
            },
        } as any);
        await expect(handler!({ object: ORDINARY, event: 'afterInsert', input: {}, api: countingApi(calls) }))
            .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(calls).toEqual([]);
    });
});
