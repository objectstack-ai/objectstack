// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService, seedLoadPartialWrites } from './seed-loader.js';
import type {
  FieldFileDescription,
  FieldFileSlot,
  IDataEngine,
  IFieldFileService,
  IMetadataService,
  StoreFieldFileInput,
} from '@objectstack/spec/contracts';
import { RAW_FILE_VALUES_CONTEXT_KEY, seedFile } from '@objectstack/spec/data';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * [#25779] A seed record writes `seedFile(path)` into a file field; `os build`
 * bundled the bytes into the dataset's `files` map. The loader stores them
 * through the `field-files` service, writes the file's id into the field, makes
 * the written row the file's owner, and keeps the file on a replay that finds
 * the same bytes. It refuses — by row, before anything of the row is written —
 * a reference whose bytes the dataset does not carry or that do not match what
 * was recorded, a load with no file service, and (shape 3) an id-shaped value
 * that names no stored file.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** An engine whose `find` honours `where` and records the read context, like a real one. */
function createEngine(): { engine: IDataEngine; store: Record<string, any[]>; findContexts: unknown[] } {
  const store: Record<string, any[]> = {};
  const findContexts: unknown[] = [];
  let next = 0;
  /** Equality on plain keys; a combinator or operator this fake does not implement is refused, never misread. */
  const matches = (row: Record<string, any>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row[k] === v;
    });
  const engine = {
    find: vi.fn(async (object: string, query?: any) => {
      findContexts.push(query?.context);
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
  return { engine, store, findContexts };
}

/** An in-memory `field-files` service that records what it was asked to do. */
function createFieldFiles(organizationOf: (id: string) => string | null = () => null) {
  const files = new Map<string, FieldFileDescription & { organizationId: string | null; data: Buffer }>();
  let next = 0;
  const stored: StoreFieldFileInput[] = [];
  const claims: Array<{ slot: FieldFileSlot; fileIds: string[]; organizationId: string | null }> = [];
  const service: IFieldFileService & { failClaims?: boolean } = {
    storeFile: vi.fn(async (input: StoreFieldFileInput) => {
      stored.push(input);
      const fileId = `file-${++next}`;
      files.set(fileId, {
        fileId,
        name: input.filename,
        mimeType: input.mimeType,
        status: 'pending',
        owner: null,
        metadata: { ...(input.metadata ?? {}) },
        organizationId: input.organizationId,
        data: input.data,
      });
      return { fileId, size: input.data.byteLength };
    }),
    describeFiles: vi.fn(async (ids: readonly string[], organizationId: string | null) => {
      const found = new Map<string, FieldFileDescription>();
      for (const id of ids) {
        const file = files.get(id);
        if (!file) continue;
        if (organizationId !== null && (file.organizationId ?? organizationOf(id)) !== organizationId) continue;
        const { organizationId: _o, data: _d, ...description } = file;
        found.set(id, structuredClone(description));
      }
      return found;
    }),
    claimFiles: vi.fn(async (slot: FieldFileSlot, fileIds: readonly string[], organizationId: string | null) => {
      if (service.failClaims) throw new Error('the storage service is down');
      claims.push({ slot, fileIds: [...fileIds], organizationId });
      for (const file of files.values()) {
        const owner = file.owner;
        if (owner && owner.object === slot.object && owner.recordId === slot.recordId && owner.field === slot.field
          && !fileIds.includes(file.fileId)) file.owner = null;
      }
      for (const id of fileIds) {
        const file = files.get(id)!;
        file.owner = { ...slot };
        file.status = 'committed';
      }
    }),
  };
  return { service, files, stored, claims };
}

function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    clm_version: {
      name: 'clm_version',
      fields: {
        code: { type: 'text' },
        file: { type: 'file', required: true },
        scans: { type: 'image', multiple: true },
        logo: { type: 'image' },
        parent: { type: 'lookup', reference: 'clm_version' },
      },
    },
  };
  return {
    getObject: vi.fn(async (name: string) => objects[name]),
    listObjects: vi.fn(async () => Object.values(objects)),
    register: vi.fn(async () => {}),
    get: vi.fn(async (_t: string, name: string) => objects[name]),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

const CONFIG = { dryRun: false, haltOnError: false, multiPass: true, defaultMode: 'upsert', batchSize: 1000, transaction: false } as any;

/** The bundled entry `os build` writes for `bytes`. */
function bundled(bytes: string, contentType = 'application/pdf') {
  const buffer = Buffer.from(bytes);
  return {
    contentType,
    size: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    data: buffer.toString('base64'),
  };
}

function dataset(records: any[], files: Record<string, unknown> = { 'fixtures/v1.pdf': bundled('%PDF v1') }, extra: any = {}) {
  return { object: 'clm_version', externalId: 'code', mode: 'upsert', env: ['prod', 'dev', 'test'], records, files, ...extra };
}

function loader(engine: IDataEngine, service: IFieldFileService | undefined, logger = createLogger()) {
  return new SeedLoaderService(engine, createMetadata(), logger, { getFieldFiles: () => service });
}

describe('seed files: stored, owned by the written row, kept across replays (#25779)', () => {
  it('stores the bundled bytes, writes the file id into the field, and makes the row its owner', async () => {
    const { engine, store } = createEngine();
    const { service, files, stored, claims } = createFieldFiles();
    const result = await loader(engine, service).load({
      seeds: [dataset([{ code: 'V1', file: seedFile('fixtures/v1.pdf') }])],
      config: CONFIG,
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalInserted).toBe(1);
    const row = store.clm_version[0];
    expect(row.file).toBe('file-1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      organizationId: null,
      filename: 'v1.pdf',
      mimeType: 'application/pdf',
      metadata: { seedFile: 'fixtures/v1.pdf', sha256: bundled('%PDF v1').sha256 },
    });
    expect(stored[0].data.toString()).toBe('%PDF v1');
    expect(claims).toEqual([{ slot: { object: 'clm_version', recordId: row.id, field: 'file' }, fileIds: ['file-1'], organizationId: null }]);
    expect(files.get('file-1')).toMatchObject({ status: 'committed', owner: { object: 'clm_version', recordId: row.id, field: 'file' } });
  });

  it('takes the reference\'s name and type over the bundled defaults, and the organization of the row', async () => {
    const { engine } = createEngine();
    const { service, stored, claims } = createFieldFiles();
    await loader(engine, service).load({
      seeds: [dataset([{ code: 'V1', file: seedFile('fixtures/v1.pdf', { name: 'NDA.pdf', contentType: 'application/x-pdf' }) }])],
      config: { ...CONFIG, organizationId: 'org_a' },
    });
    expect(stored[0]).toMatchObject({ organizationId: 'org_a', filename: 'NDA.pdf', mimeType: 'application/x-pdf' });
    expect(claims[0].organizationId).toBe('org_a');
  });

  it('keeps the file on a replay of unchanged bytes: no new file, no write, no claim', async () => {
    const { engine, store, findContexts } = createEngine();
    const { service, stored, claims } = createFieldFiles();
    const seeds = [dataset([{ code: 'V1', file: seedFile('fixtures/v1.pdf') }])];
    await loader(engine, service).load({ seeds, config: CONFIG });
    (engine.update as any).mockClear();

    const replay = await loader(engine, service).load({ seeds, config: CONFIG });
    expect(replay.success).toBe(true);
    expect(replay.summary.totalSkipped).toBe(1);
    expect(stored).toHaveLength(1);
    expect(claims).toHaveLength(1);
    expect(engine.update).not.toHaveBeenCalled();
    expect(store.clm_version[0].file).toBe('file-1');
    // The matched row is read with its STORED file values.
    expect(findContexts.some((c: any) => c?.[RAW_FILE_VALUES_CONTEXT_KEY] === true)).toBe(true);
  });

  it('stores a new file when the bytes changed, writes it, and the slot owns it alone', async () => {
    const { engine, store } = createEngine();
    const { service, files, stored } = createFieldFiles();
    await loader(engine, service).load({ seeds: [dataset([{ code: 'V1', file: seedFile('fixtures/v1.pdf') }])], config: CONFIG });

    const changed = await loader(engine, service).load({
      seeds: [dataset([{ code: 'V1', file: seedFile('fixtures/v1.pdf') }], { 'fixtures/v1.pdf': bundled('%PDF v1, revised') })],
      config: CONFIG,
    });
    expect(changed.summary.totalUpdated).toBe(1);
    expect(stored).toHaveLength(2);
    expect(store.clm_version[0].file).toBe('file-2');
    expect(files.get('file-2')?.owner?.recordId).toBe(store.clm_version[0].id);
    expect(files.get('file-1')?.owner).toBeNull();
  });

  it('stores one file per reference in a multiple field, in order', async () => {
    const { engine, store } = createEngine();
    const { service, claims } = createFieldFiles();
    const result = await loader(engine, service).load({
      seeds: [dataset(
        [{ code: 'V1', file: seedFile('fixtures/v1.pdf'), scans: [seedFile('scans/p1.png'), seedFile('scans/p2.png')] }],
        {
          'fixtures/v1.pdf': bundled('%PDF v1'),
          'scans/p1.png': bundled('png one', 'image/png'),
          'scans/p2.png': bundled('png two', 'image/png'),
        },
      )],
      config: CONFIG,
    });
    expect(result.success).toBe(true);
    expect(store.clm_version[0].scans).toEqual(['file-2', 'file-3']);
    expect(claims.find((c) => c.slot.field === 'scans')?.fileIds).toEqual(['file-2', 'file-3']);
  });

  it('gives every row its own file, even when rows name the same path', async () => {
    const { engine, store } = createEngine();
    const { service, stored } = createFieldFiles();
    await loader(engine, service).load({
      seeds: [dataset([
        { code: 'V1', file: seedFile('fixtures/v1.pdf') },
        { code: 'V2', file: seedFile('fixtures/v1.pdf') },
      ])],
      config: CONFIG,
    });
    expect(stored).toHaveLength(2);
    expect(store.clm_version.map((r) => r.file)).toEqual(['file-1', 'file-2']);
  });

  it('settles the files of a self-referencing dataset, written row by row', async () => {
    const { engine, store } = createEngine();
    const { service, claims } = createFieldFiles();
    const result = await loader(engine, service).load({
      seeds: [dataset([
        { code: 'V1', file: seedFile('fixtures/v1.pdf') },
        { code: 'V2', file: seedFile('fixtures/v1.pdf'), parent: 'V1' },
      ])],
      config: CONFIG,
    });
    expect(result.success).toBe(true);
    expect(claims.map((c) => c.slot.recordId)).toEqual(store.clm_version.map((r) => r.id));
  });
});

describe('seed files: refusals, by row, before the row is written (#25779)', () => {
  it('refuses a reference whose bytes the dataset does not carry, naming the path', async () => {
    const { engine, store } = createEngine();
    const { service, stored } = createFieldFiles();
    const logger = createLogger();
    const result = await loader(engine, service, logger).load({
      seeds: [dataset([{ code: 'V1', file: seedFile('fixtures/missing.pdf') }, { code: 'V2', file: seedFile('fixtures/v1.pdf') }])],
      config: CONFIG,
    });
    expect(result.success).toBe(false);
    expect(result.summary.totalErrored).toBe(1);
    expect(result.errors[0]).toMatchObject({ field: 'file', recordIndex: 0, targetObject: 'sys_file' });
    expect(result.errors[0].message).toContain("seedFile('fixtures/missing.pdf') names a file this clm_version dataset does not carry");
    expect(store.clm_version.map((r) => r.code)).toEqual(['V2']);
    expect(stored).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('record #0 was NOT seeded'), undefined, expect.anything());
  });

  it('refuses bytes that do not match their recorded digest', async () => {
    const { engine, store } = createEngine();
    const { service } = createFieldFiles();
    const tampered = { ...bundled('%PDF v1'), data: Buffer.from('%PDF evil').toString('base64') };
    const result = await loader(engine, service).load({
      seeds: [dataset([{ code: 'V1', file: seedFile('fixtures/v1.pdf') }], { 'fixtures/v1.pdf': tampered })],
      config: CONFIG,
    });
    expect(result.errors[0].message).toContain('do not match what was recorded');
    expect(store.clm_version ?? []).toEqual([]);
  });

  it('refuses a seed file when the load has no file service', async () => {
    const { engine, store } = createEngine();
    const result = await loader(engine, undefined).load({
      seeds: [dataset([{ code: 'V1', file: seedFile('fixtures/v1.pdf') }])],
      config: CONFIG,
    });
    expect(result.errors[0].message).toContain('this load has no file service to store it with');
    expect(store.clm_version ?? []).toEqual([]);
  });

  it('refuses a field mixing seed files with other values, and several seed files in a one-file field', async () => {
    const { engine } = createEngine();
    const { service, stored } = createFieldFiles();
    const result = await loader(engine, service).load({
      seeds: [dataset(
        [
          { code: 'V1', file: seedFile('fixtures/v1.pdf'), scans: [seedFile('fixtures/v1.pdf'), 'https://example.com/a.png'] },
          { code: 'V2', file: [seedFile('fixtures/v1.pdf'), seedFile('fixtures/v1.pdf')] },
        ],
      )],
      config: CONFIG,
    });
    expect(result.errors.map((e) => e.message)).toEqual([
      expect.stringContaining('mixes seedFile(...) values with other values'),
      expect.stringContaining('holds one file, and the record gives it 2 seedFile(...) values'),
    ]);
    expect(stored).toEqual([]);
  });

  it('refuses an id-shaped value that names no stored file (shape 3), and keeps one that does', async () => {
    const { engine, store } = createEngine();
    const { service } = createFieldFiles();
    await loader(engine, service).load({ seeds: [dataset([{ code: 'V1', file: seedFile('fixtures/v1.pdf') }])], config: CONFIG });

    const result = await loader(engine, service).load({
      seeds: [dataset([
        { code: 'V2', file: 'file-1' },
        { code: 'V3', file: 'sf_contract_template' },
        { code: 'V4', file: 'file-1', logo: 'https://cdn.example.com/logo.png' },
      ], {})],
      config: CONFIG,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ recordIndex: 1, field: 'file', attemptedValue: 'sf_contract_template' });
    expect(result.errors[0].message).toContain("holds 'sf_contract_template', which names no stored file");
    expect(store.clm_version.map((r) => r.code)).toEqual(['V1', 'V2', 'V4']);
    // An external URL is not an id: written as given.
    expect(store.clm_version.find((r) => r.code === 'V4')?.logo).toBe('https://cdn.example.com/logo.png');
  });

  it('answers shape 3 in the row\'s organization: a file of another organization does not resolve', async () => {
    const { engine } = createEngine();
    const { service } = createFieldFiles();
    await service.storeFile({ organizationId: 'org_b', filename: 'x.pdf', mimeType: 'application/pdf', data: Buffer.from('x') });
    const result = await loader(engine, service).load({
      seeds: [dataset([{ code: 'V1', file: 'file-1', organization_id: 'org_a' }], {})],
      config: CONFIG,
    });
    expect(result.errors[0]?.message).toContain('which names no stored file in organization org_a');
  });

  it('a dry run checks the references against the bundled bytes and stores nothing', async () => {
    const { engine } = createEngine();
    const { service, stored } = createFieldFiles();
    const result = await loader(engine, service).load({
      seeds: [dataset([{ code: 'V1', file: seedFile('fixtures/v1.pdf') }, { code: 'V2', file: seedFile('nope.pdf') }])],
      config: { ...CONFIG, dryRun: true },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("seedFile('nope.pdf')");
    expect(stored).toEqual([]);
    expect(service.describeFiles).not.toHaveBeenCalled();
  });

  it('reports a row whose files could not be made its own, loudly, without unwriting the row', async () => {
    const { engine, store } = createEngine();
    const { service } = createFieldFiles();
    service.failClaims = true;
    const logger = createLogger();
    const result = await loader(engine, service, logger).load({
      seeds: [dataset([{ code: 'V1', file: seedFile('fixtures/v1.pdf') }])],
      config: CONFIG,
    });
    expect(result.success).toBe(false);
    expect(result.summary.totalInserted).toBe(1);
    expect(store.clm_version).toHaveLength(1);
    expect(result.errors[0].message).toContain('could not be made the record\'s own: the storage service is down');
    expect(logger.error).toHaveBeenCalled();
  });

  it('leaves an object without file fields untouched: the service is never asked', async () => {
    const { engine } = createEngine();
    const { service } = createFieldFiles();
    const metadata = createMetadata();
    (metadata.getObject as any).mockImplementation(async (name: string) =>
      name === 'plain' ? { name: 'plain', fields: { code: { type: 'text' } } } : undefined);
    const result = await new SeedLoaderService(engine, metadata, createLogger(), { getFieldFiles: () => service }).load({
      seeds: [{ object: 'plain', externalId: 'code', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ code: 'a' }] }] as any,
      config: CONFIG,
    });
    expect(result.success).toBe(true);
    expect(service.describeFiles).not.toHaveBeenCalled();
  });
});

/**
 * [#26670] A seed that stores many files must leave the event loop to the
 * requests that arrive while it runs.
 *
 * On a synchronous driver (better-sqlite3) every `await` of the seed's
 * per-row file work resolves as a microtask, and the fakes here resolve the
 * same way, which is the property that matters: without a macrotask turn the
 * whole load runs as one unbroken microtask chain, and a request that
 * arrives meanwhile (a sign-in, read on the I/O phase) is not even read until
 * the seed is done. Measured on `os serve --dev` over sqlite before the fix:
 * the event loop stalled 3–5 s per 200-row insert batch while the connection
 * pool never held a connection longer than 44 ms.
 */
describe('a seed of many files yields to waiting requests (#26670)', () => {
  const ROWS = 60;
  // No self-reference, unlike `clm_version`: the loader buffers this object's
  // inserts and flushes them in batches, then settles each landed row's claim
  // back to back — the path the stall was measured on.
  const manyFiles = () => {
    const files: Record<string, unknown> = {};
    const records = [];
    for (let i = 0; i < ROWS; i++) {
      files[`fixtures/f${i}.pdf`] = bundled(`%PDF ${i}`);
      records.push({ code: `D${i}`, file: seedFile(`fixtures/f${i}.pdf`) });
    }
    return dataset(records, files, { object: 'clm_doc' });
  };
  const batchedLoader = (engine: IDataEngine, service: IFieldFileService) => {
    const metadata = createMetadata();
    (metadata.getObject as any).mockImplementation(async (name: string) =>
      name === 'clm_doc' ? { name: 'clm_doc', fields: { code: { type: 'text' }, file: { type: 'file' } } } : undefined);
    return new SeedLoaderService(engine, metadata, createLogger(), { getFieldFiles: () => service });
  };

  it('stores at most one row\'s files and settles at most one row\'s claim between two macrotask turns', async () => {
    const { engine } = createEngine();
    const { service, stored, claims } = createFieldFiles();
    const turns: Array<{ stored: number; claims: number }> = [];
    let done = false;
    const sample = () => {
      turns.push({ stored: stored.length, claims: claims.length });
      if (!done) setImmediate(sample);
    };
    setImmediate(sample);
    const result = await batchedLoader(engine, service).load({ seeds: [manyFiles()], config: CONFIG });
    done = true;

    expect(result.success).toBe(true);
    expect(stored).toHaveLength(ROWS);
    expect(claims).toHaveLength(ROWS);
    let maxStored = 0;
    let maxClaims = 0;
    for (let t = 1; t < turns.length; t++) {
      maxStored = Math.max(maxStored, turns[t].stored - turns[t - 1].stored);
      maxClaims = Math.max(maxClaims, turns[t].claims - turns[t - 1].claims);
    }
    // A turn ran while the load did, and the first one landed before the last
    // file was stored: the load did not run through in one chain.
    expect(turns.length, 'no macrotask turn ran while the seed ran').toBeGreaterThan(1);
    expect(turns[0].stored,'the first macrotask turn came only after the seed stored every file').toBeLessThan(ROWS);
    expect({ maxStored, maxClaims }).toEqual({ maxStored: 1, maxClaims: 1 });
  });

  it('serves an unrelated read issued during the seed within one row\'s file work', async () => {
    const { engine } = createEngine();
    const { service, stored, claims } = createFieldFiles();
    let readAt: { stored: number; claims: number } | undefined;
    // A request read on the I/O phase, as a sign-in's user lookup is.
    setImmediate(() => {
      const issuedAt = { stored: stored.length, claims: claims.length };
      void engine.find('sys_user', { where: { email: 'admin@example.com' } }).then(() => {
        readAt = { stored: stored.length - issuedAt.stored, claims: claims.length - issuedAt.claims };
      });
    });
    await batchedLoader(engine, service).load({ seeds: [manyFiles()], config: CONFIG });
    expect(readAt, 'the read never completed').toBeDefined();
    expect(readAt!.stored + readAt!.claims, 'files stored or claimed while the read waited').toBeLessThanOrEqual(1);
  });

  it('writes a dataset that carries seed files in insert batches of at most 20 rows', async () => {
    const { engine } = createEngine();
    const { service } = createFieldFiles();
    await batchedLoader(engine, service).load({ seeds: [manyFiles()], config: CONFIG });
    const sizes = (engine.insert as any).mock.calls
      .filter(([object]: [string]) => object === 'clm_doc')
      .map(([, data]: [string, unknown]) => (Array.isArray(data) ? data.length : 1));
    expect(sizes.reduce((a: number, b: number) => a + b, 0)).toBe(ROWS);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(20);
  });
});

/**
 * `seedLoadPartialWrites` — what a load that THREW had already written.
 *
 * A load writes dataset by dataset and rolls nothing back when a later one
 * throws, so the publish batch's `seedApplied` receipt reads the rows that
 * landed off the error: the finished datasets' and those of the dataset that
 * threw part-way. The publish-door pins live in `@objectstack/objectql`'s
 * `publish-package-drafts-seed-receipt-counts.test.ts`; these pin what that
 * door cannot stage — a throw INSIDE a dataset after one of its rows was
 * written (the file service failing while that row's seed file is settled) —
 * and a throw before any dataset ran. Counts are checked against the store.
 */
describe('seedLoadPartialWrites: the rows a thrown load had written', () => {
  /** `pw_tag` loads first (`pw_doc` looks it up); neither looks itself up. */
  function partialMetadata(fail?: Error): IMetadataService {
    const objects: Record<string, any> = {
      pw_tag: { name: 'pw_tag', fields: { name: { type: 'text' } } },
      pw_doc: { name: 'pw_doc', fields: { code: { type: 'text' }, file: { type: 'file' }, tag: { type: 'lookup', reference: 'pw_tag' } } },
    };
    return {
      getObject: vi.fn(async (name: string) => { if (fail) throw fail; return objects[name]; }),
    } as unknown as IMetadataService;
  }
  const partialSeeds = () => [
    dataset([{ code: 'D1', tag: 'T1', file: seedFile('fixtures/v1.pdf') }], undefined, { object: 'pw_doc' }),
    { object: 'pw_tag', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'T1' }, { name: 'T2' }] },
  ] as any;

  it('counts the finished datasets AND the rows the throwing dataset wrote, naming its object', async () => {
    const { engine, store } = createEngine();
    const { service } = createFieldFiles();
    service.describeFiles = vi.fn(async () => { throw new Error('the storage service is down'); });
    const seedLoader = new SeedLoaderService(engine, partialMetadata(), createLogger(), { getFieldFiles: () => service });

    const err = await seedLoader.load({ seeds: partialSeeds(), config: CONFIG }).then(() => undefined, (e: unknown) => e);

    expect((err as Error).message).toBe('the storage service is down');
    expect((store.pw_tag ?? []).map((r) => r.name).sort()).toEqual(['T1', 'T2']);
    expect((store.pw_doc ?? []).map((r) => r.code)).toEqual(['D1']);
    expect(seedLoadPartialWrites(err)).toEqual({ inserted: 3, updated: 0, failedObject: 'pw_doc' });
  });

  it('a load that throws before any dataset wrote: zero, and no object named', async () => {
    const { engine, store } = createEngine();
    const seedLoader = new SeedLoaderService(engine, partialMetadata(new Error('metadata store unavailable')), createLogger());

    const err = await seedLoader.load({ seeds: partialSeeds(), config: CONFIG }).then(() => undefined, (e: unknown) => e);

    expect((err as Error).message).toBe('metadata store unavailable');
    expect(store).toEqual({});
    expect(seedLoadPartialWrites(err)).toEqual({ inserted: 0, updated: 0 });
  });

  it('an error that did not come out of a load carries no reading', () => {
    expect(seedLoadPartialWrites(new Error('elsewhere'))).toBeUndefined();
    expect(seedLoadPartialWrites('a string')).toBeUndefined();
  });
});
