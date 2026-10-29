// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `seedLoadPartialWrites` — what a load that THREW had already written.
 *
 * A load writes dataset by dataset and rolls nothing back when a later one
 * throws, so the caller reporting the failure (the publish batch's
 * `seedApplied` receipt) needs the rows that landed: the finished datasets'
 * and those of the dataset that threw part-way. The publish-door pins live in
 * `@objectstack/objectql`'s `publish-package-drafts-seed-receipt-counts.test.ts`;
 * this file pins the one case that door cannot stage — a throw INSIDE a
 * dataset after some of its rows were written (here: the file service failing
 * while a written row's seed file is settled) — and the throw that comes
 * before any dataset.
 *
 * Every count is checked against the fake engine's store.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { IDataEngine, IFieldFileService, IMetadataService } from '@objectstack/spec/contracts';
import { seedFile } from '@objectstack/spec/data';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SeedLoaderService, seedLoadPartialWrites } from './seed-loader.js';

function createLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createEngine(): { engine: IDataEngine; store: Record<string, any[]> } {
    const store: Record<string, any[]> = {};
    let next = 0;
    const matches = (row: Record<string, any>, where: Record<string, unknown>) =>
        Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return row[k] === v;
        });
    const engine = {
        find: vi.fn(async (object: string, query?: any) => {
            let rows = store[object] ?? [];
            if (query?.where) rows = rows.filter((r) => matches(r, query.where));
            return rows.map((r) => ({ ...r }));
        }),
        findOne: vi.fn(async (object: string, query?: any) => {
            assertEngineFindOnePredicate(object, query);
            const rows = (store[object] ?? []).filter((r) => matches(r, query?.where ?? {}));
            return rows[0] ? { ...rows[0] } : null;
        }),
        insert: vi.fn(async (object: string, data: any) => {
            store[object] ??= [];
            const one = (d: any) => {
                const row = { id: `row-${++next}`, ...d };
                store[object].push(row);
                return { ...row };
            };
            return Array.isArray(data) ? data.map(one) : one(data);
        }),
        update: vi.fn(async (object: string, data: any) => {
            assertEngineUpdateDispatch(data, undefined);
            const rows = store[object] ?? [];
            const i = rows.findIndex((r) => r.id === data.id);
            if (i >= 0) rows[i] = { ...rows[i], ...data };
            return data;
        }),
        delete: vi.fn(async (_object: string, options?: any) => {
            assertEngineDeleteDispatch(options);
            return { deleted: 1 };
        }),
        count: vi.fn(async (object: string) => (store[object] ?? []).length),
        aggregate: vi.fn(async () => []),
    } as unknown as IDataEngine;
    return { engine, store };
}

/** A `field-files` service that stores files and is DOWN for every read of them. */
function createFieldFilesDownOnRead(): IFieldFileService {
    let next = 0;
    return {
        storeFile: vi.fn(async (input: any) => ({ fileId: `file-${++next}`, size: input.data.byteLength })),
        describeFiles: vi.fn(async () => { throw new Error('the storage service is down'); }),
        claimFiles: vi.fn(async () => {}),
    } as unknown as IFieldFileService;
}

/** `pw_tag` (plain) is loaded first: `pw_doc` looks it up. */
function createMetadata(fail?: Error): IMetadataService {
    const objects: Record<string, any> = {
        pw_tag: { name: 'pw_tag', fields: { name: { type: 'text' } } },
        pw_doc: {
            name: 'pw_doc',
            fields: { code: { type: 'text' }, file: { type: 'file' }, tag: { type: 'lookup', reference: 'pw_tag' } },
        },
    };
    return {
        getObject: vi.fn(async (name: string) => { if (fail) throw fail; return objects[name]; }),
    } as unknown as IMetadataService;
}

const CONFIG = { dryRun: false, haltOnError: false, multiPass: true, defaultMode: 'upsert', batchSize: 1000, transaction: false } as any;

const pdf = Buffer.from('%PDF pw');
const FILES = {
    'fixtures/a.pdf': {
        contentType: 'application/pdf',
        size: pdf.byteLength,
        sha256: createHash('sha256').update(pdf).digest('hex'),
        data: pdf.toString('base64'),
    },
};

const seeds = () => [
    { object: 'pw_doc', externalId: 'code', mode: 'upsert', env: ['prod', 'dev', 'test'], files: FILES,
        records: [{ code: 'D1', tag: 'T1', file: seedFile('fixtures/a.pdf') }] },
    { object: 'pw_tag', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'T1' }, { name: 'T2' }] },
] as any;

describe('seedLoadPartialWrites', () => {
    it('counts the finished datasets AND the rows the throwing dataset wrote, naming its object', async () => {
        const { engine, store } = createEngine();
        const loader = new SeedLoaderService(engine, createMetadata(), createLogger() as any, {
            getFieldFiles: () => createFieldFilesDownOnRead(),
        });

        const err = await loader.load({ seeds: seeds(), config: CONFIG }).then(() => undefined, (e: unknown) => e);

        expect((err as Error).message).toBe('the storage service is down');
        // At the engine: both tags, and the doc row written before its file settle threw.
        expect((store.pw_tag ?? []).map((r) => r.name).sort()).toEqual(['T1', 'T2']);
        expect((store.pw_doc ?? []).map((r) => r.code)).toEqual(['D1']);
        expect(seedLoadPartialWrites(err)).toEqual({ inserted: 3, updated: 0, failedObject: 'pw_doc' });
    });

    it('a load that throws before any dataset wrote: zero, and no object named', async () => {
        const { engine, store } = createEngine();
        const loader = new SeedLoaderService(engine, createMetadata(new Error('metadata store unavailable')), createLogger() as any);

        const err = await loader.load({ seeds: seeds(), config: CONFIG }).then(() => undefined, (e: unknown) => e);

        expect((err as Error).message).toBe('metadata store unavailable');
        expect(store).toEqual({});
        expect(seedLoadPartialWrites(err)).toEqual({ inserted: 0, updated: 0 });
    });

    it('an error that did not come out of a load carries no reading', () => {
        expect(seedLoadPartialWrites(new Error('elsewhere'))).toBeUndefined();
        expect(seedLoadPartialWrites('a string')).toBeUndefined();
    });
});
