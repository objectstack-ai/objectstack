// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21594] The read half of the stored-metadata family's boundary for
 * app-authored bodies: a sandboxed body may not read a family table. For an
 * app-authored body the family is reached through the metadata API only.
 *
 * Pinned against a counting scoped-API double (it records which verb reached
 * it, and stores nothing), then through the real QuickJS sandbox on all three
 * body faces. What each case asserts:
 *
 *   - every read verb the reader-context seam serves (`find`, `findOne`,
 *     `count`, `aggregate`) on each family table is refused with the
 *     boundary's envelope (`PERMISSION_DENIED` / 403) and a prescription naming
 *     the metadata API's READ route, BEFORE the verb runs;
 *   - a read is refused the same way whatever its query names — a filter,
 *     sort or grouping on the stored body or a hash column, a search, a
 *     projection, or nothing — so a refused read serves nothing and is no
 *     oracle;
 *   - every other object reads as before, and every derived context is
 *     refused the same way;
 *   - as a body holds it (the write layer over the read layer), a read gets
 *     the read refusal and a write keeps #21520's write refusal unchanged;
 *   - a host code handler's `ctx.api` — the read seam alone — still reads the
 *     family, served the way the data door serves it: the boundary refuses
 *     bodies only.
 */

import { describe, it, expect } from 'vitest';
import { STORED_METADATA_BODY_OBJECTS } from '@objectstack/spec/kernel';
import {
  refuseStoredMetadataBodyReads,
  refuseStoredMetadataBodyWrites,
  serveStoredMetadataReadsThrough,
} from './stored-metadata-reader-seam.js';
import { STORED_METADATA_BODY_BOUNDARY_CODE, STORED_METADATA_BODY_BOUNDARY_STATUS } from './stored-metadata-body-boundary.js';
import { actionBodyRunnerFactory, hookBodyRunnerFactory, jobBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';

const FAMILY = [...STORED_METADATA_BODY_OBJECTS];
const ORDINARY = 'boundary_note';
const READ_VERBS = ['find', 'findOne', 'count', 'aggregate'];
const SENTINEL = 'body-read-unit-sentinel-5e02';

/** A stored family row: the body carries a credential, the row a content hash. */
function storedRow(): Record<string, unknown> {
    return {
        id: 'row_1',
        type: 'datasource',
        name: 'unit_ds',
        metadata: JSON.stringify({ name: 'unit_ds', driver: 'turso', config: { url: 'libsql://unit.example.invalid', encryptionKey: SENTINEL } }),
        checksum: `sha256:${'b2'.repeat(32)}`,
    };
}

/**
 * A scoped-API double that counts `<object>.<verb>` calls and answers the
 * stored form, so a read that reached it would carry the sentinel. Read verbs
 * and one write verb only: no `update` / `delete` member, so it carries no
 * write dispatch to hold to the engine's.
 */
function countingApi(calls: string[] = []): any {
    const repo = (name: string) => {
        const record = (verb: string) => calls.push(`${name}.${verb}`);
        const family = name.startsWith('sys_metadata');
        return {
            async find() { record('find'); return family ? [storedRow()] : [{ id: 'n1' }]; },
            async findOne() { record('findOne'); return family ? storedRow() : { id: 'n1' }; },
            async count() { record('count'); return 1; },
            async aggregate() { record('aggregate'); return family ? [{ metadata: storedRow().metadata, count: 1 }] : []; },
            async insert() { record('insert'); return { id: 'n1' }; },
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

/** The API a sandboxed body holds: the write layer over the read layer (`buildSandboxApi`). */
const bodyApi = (calls: string[]) => refuseStoredMetadataBodyWrites(refuseStoredMetadataBodyReads(countingApi(calls)));

function expectReadRefused(promise: Promise<unknown>, object: string, verb: string) {
    return expect(promise).rejects.toMatchObject({
        code: STORED_METADATA_BODY_BOUNDARY_CODE,
        status: STORED_METADATA_BODY_BOUNDARY_STATUS,
        object,
        operation: verb,
        message: expect.stringContaining('GET /api/v1/meta/:type/:name'),
    });
}

describe('[#21594] refuseStoredMetadataBodyReads — every family read is refused before it runs', () => {
    it('the envelope is the boundary\'s own: PERMISSION_DENIED / 403, no new code', () => {
        expect(STORED_METADATA_BODY_BOUNDARY_CODE).toBe('PERMISSION_DENIED');
        expect(STORED_METADATA_BODY_BOUNDARY_STATUS).toBe(403);
    });

    for (const object of FAMILY) {
        it(`each read verb on '${object}' answers PERMISSION_DENIED / 403 naming the metadata API, and never reaches the store`, async () => {
            const calls: string[] = [];
            const api = refuseStoredMetadataBodyReads(countingApi(calls));
            for (const verb of READ_VERBS) await expectReadRefused(api.object(object)[verb]({}), object, verb);
            expect(calls).toEqual([]);
        });
    }

    it('a read is refused identically whatever its query names, and reaches nothing', async () => {
        const calls: string[] = [];
        const api = refuseStoredMetadataBodyReads(countingApi(calls));
        const queries: unknown[] = [
            undefined,
            {},
            { where: { type: 'datasource', name: 'unit_ds' } },
            { where: { metadata: { $contains: 'z' } } },
            { where: { checksum: 'z' } },
            { orderBy: [{ field: 'metadata', order: 'asc' }] },
            { groupBy: ['metadata'] },
            { search: 'unit_ds' },
            { search: 'z', searchFields: ['metadata'] },
            { fields: ['name', 'metadata'] },
        ];
        for (const verb of READ_VERBS) {
            const answers = new Set<string>();
            for (const query of queries) {
                const err: any = await api.object(FAMILY[0])[verb](query).catch((e: unknown) => e);
                answers.add(`${err?.code}:${err?.status}:${err?.operation}:${err?.message}`);
            }
            // Ten queries, one answer per verb.
            expect(answers.size, verb).toBe(1);
        }
        expect(calls).toEqual([]);
    });

    it('an ordinary table reads as before (control)', async () => {
        const calls: string[] = [];
        const api = refuseStoredMetadataBodyReads(countingApi(calls));
        for (const verb of READ_VERBS) await api.object(ORDINARY)[verb]({});
        expect(calls).toEqual(READ_VERBS.map((verb) => `${ORDINARY}.${verb}`));
    });

    it('every derived context refuses the same way: sudo, withRunAs, transaction(fn), beginTransaction', async () => {
        const calls: string[] = [];
        const api = refuseStoredMetadataBodyReads(countingApi(calls));
        await expectReadRefused(api.sudo().object(FAMILY[0]).find({}), FAMILY[0], 'find');
        await expectReadRefused(api.withRunAs('system', {}).object(FAMILY[1]).findOne({}), FAMILY[1], 'findOne');
        await api.transaction(async (trx: any) => {
            await expectReadRefused(trx.object(FAMILY[0]).count({}), FAMILY[0], 'count');
        });
        const begun = await api.beginTransaction();
        expect(begun.handle).toBe('trx_1');
        await expectReadRefused(begun.ctx.object(FAMILY[1]).aggregate({}), FAMILY[1], 'aggregate');
        expect(calls).toEqual([]);
    });

    it('is idempotent', () => {
        const once = refuseStoredMetadataBodyReads(countingApi());
        expect(refuseStoredMetadataBodyReads(once)).toBe(once);
    });
});

describe('[#21594] the API a body holds — the write layer over the read layer', () => {
    it('a read gets the read refusal, a write keeps the write refusal unchanged, and nothing reaches the store', async () => {
        const calls: string[] = [];
        const api = bodyApi(calls);
        for (const object of FAMILY) {
            for (const verb of READ_VERBS) await expectReadRefused(api.object(object)[verb]({}), object, verb);
            await expect(api.object(object).insert({ label: 'x' })).rejects.toMatchObject({
                code: 'PERMISSION_DENIED',
                status: 403,
                object,
                operation: 'insert',
                message: expect.stringContaining('the write was not run'),
            });
        }
        expect(calls).toEqual([]);
    });

    it('an ordinary table reads and writes as before (control)', async () => {
        const calls: string[] = [];
        const api = bodyApi(calls);
        for (const verb of READ_VERBS) await api.object(ORDINARY)[verb]({});
        await api.object(ORDINARY).insert({ label: 'x' });
        expect(calls).toEqual([...READ_VERBS, 'insert'].map((verb) => `${ORDINARY}.${verb}`));
    });

    it('a host code handler\'s ctx.api — the read seam alone — still reads the family, served like the data door', async () => {
        const calls: string[] = [];
        const api = serveStoredMetadataReadsThrough(countingApi(calls), { getKeyedDigest: () => async (plain: string) => `keyed:${plain.length}` });
        const rows: any[] = await api.object(FAMILY[0]).find({});
        expect(calls).toEqual([`${FAMILY[0]}.find`]);
        expect(rows).toHaveLength(1);
        expect(String(rows[0].metadata)).not.toContain(SENTINEL);
        expect(String(rows[0].metadata)).toContain('unit.example.invalid');
        expect(rows[0].checksum).toMatch(/^keyed:/);
    });
});

describe('[#21594] through the real sandbox — every body face holds the refusing API', () => {
    const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000 });
    const readEach = (object: string) => READ_VERBS
        .map((verb) => `try { await ctx.api.object('${object}').${verb}({}); out.push('${verb}:served'); } `
            + `catch (e) { out.push('${verb}:' + e.code + ':' + e.status); }`)
        .join('\n');

    it('an action body: every read verb on both tables is refused with the envelope, and served nothing', async () => {
        const calls: string[] = [];
        const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'boundary' });
        const handler = factory({
            name: 'reads_family',
            type: 'script',
            body: {
                language: 'js',
                capabilities: ['api.read'],
                source: `const out = [];\n${FAMILY.map(readEach).join('\n')}\nreturn { out };`,
            },
        });
        const result: any = await handler!({ api: countingApi(calls), params: {} });
        expect(result.out).toEqual(
            FAMILY.flatMap(() => READ_VERBS.map((verb) => `${verb}:PERMISSION_DENIED:403`)),
        );
        expect(JSON.stringify(result)).not.toContain(SENTINEL);
        expect(calls).toEqual([]);
    });

    it('an action body\'s uncaught read refusal rejects with the envelope and names the metadata API', async () => {
        const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'boundary' });
        const handler = factory({
            name: 'reads_family_uncaught',
            type: 'script',
            body: {
                language: 'js',
                capabilities: ['api.read'],
                source: `return { rows: await ctx.api.object('${FAMILY[0]}').find({ where: { type: 'datasource' } }) };`,
            },
        });
        await expect(handler!({ api: countingApi(), params: {} })).rejects.toMatchObject({
            code: 'PERMISSION_DENIED',
            status: 403,
            message: expect.stringContaining('GET /api/v1/meta/:type/:name'),
        });
    });

    it('an action body reading inside ctx.api.transaction is refused the same way; its ordinary read runs', async () => {
        const calls: string[] = [];
        const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'boundary' });
        const handler = factory({
            name: 'reads_family_in_transaction',
            type: 'script',
            body: {
                language: 'js',
                capabilities: ['api.read', 'api.transaction'],
                source: `let code;\nawait ctx.api.transaction(async () => {\n`
                    + `  await ctx.api.object('${ORDINARY}').find({});\n`
                    + `  try { await ctx.api.object('${FAMILY[1]}').find({}); } catch (e) { code = e.code + ':' + e.status; }\n`
                    + `});\nreturn { code };`,
            },
        });
        const result: any = await handler!({ api: countingApi(calls), params: {} });
        expect(result.code).toBe('PERMISSION_DENIED:403');
        expect(calls).toEqual([`${ORDINARY}.find`]);
    });

    it('a hook body on an ordinary table, reading a family table, is refused the same way', async () => {
        const calls: string[] = [];
        const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'boundary' });
        const handler = factory({
            name: 'ordinary_hook_reads_family',
            object: ORDINARY,
            events: ['beforeInsert'],
            body: {
                language: 'js',
                capabilities: ['api.read'],
                source: `const rows = await ctx.api.object('${FAMILY[0]}').find({});\nctx.input.observed = JSON.stringify(rows);`,
            },
        } as any);
        await expect(handler!({ object: ORDINARY, event: 'beforeInsert', input: {}, api: countingApi(calls) }))
            .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(calls).toEqual([]);
    });

    it('a job body is refused the same way, through the engine-built API a job gets', async () => {
        const calls: string[] = [];
        const ql = { createContext: () => countingApi(calls) };
        const bind = jobBodyRunnerFactory(runner, { ql, appId: 'boundary' });
        const run = bind({
            name: 'job_reads_family',
            body: { language: 'js', capabilities: ['api.read'], source: `await ctx.api.object('${FAMILY[1]}').count({});` },
        })!;
        await expect(run({ jobId: 'job_reads_family' } as any)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(calls).toEqual([]);
    });
});
