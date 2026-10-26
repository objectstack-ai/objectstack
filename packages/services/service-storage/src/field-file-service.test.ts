// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25779] The server-side field-file verb — `FIELD_FILE_SERVICE`, registered
 * by `StorageServicePlugin` — through the plugin's own wiring: a real
 * `ObjectQL` over sqlite `:memory:`, the plugin's local adapter in a temp
 * directory, and a settings namespace carrying `max_upload_mb`.
 *
 *  - `storeFile` writes one `pending` `sys_file` in the organization it names,
 *    under the `tenant` scope, with its provenance, and the bytes behind it —
 *    and serves before `kernel:ready`, where a plugin's `start()` seeds;
 *  - over the size limit it is refused with the upload doors' envelope and
 *    leaves nothing;
 *  - `describeFiles` answers the files that exist in the organization, only;
 *  - `claimFiles` commits the files and makes the slot their owner, releases
 *    the slot's previous file, never takes a file another slot owns, and is
 *    idempotent — and agrees with the reference hooks when they claimed first.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { FIELD_FILE_SERVICE } from '@objectstack/spec/contracts';
import type { IFieldFileService, IStorageService, StoreFieldFileInput } from '@objectstack/spec/contracts';
import { SystemFile } from './objects/system-file.object.js';
import { StorageServicePlugin } from './storage-service-plugin.js';
import { FieldFileService } from './field-file-service.js';

const SYS = { context: { isSystem: true } } as const;
/** `max_upload_mb` as saved: 0.001 MB ⇒ floor(0.001 × 1 MiB) = 1048 bytes. */
const MAX_UPLOAD_MB = 0.001;

function quietLogger() {
  const logger: any = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
  logger.child = () => logger;
  return logger;
}

function makeCtx() {
  const services = new Map<string, unknown>();
  const phases = new Map<string, Array<() => unknown>>();
  const ctx: any = {
    logger: quietLogger(),
    registerService: (name: string, svc: unknown) => {
      services.set(name, svc);
    },
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`service '${name}' not registered`);
      return services.get(name);
    },
    hook: (event: string, fn: () => unknown) => {
      phases.set(event, [...(phases.get(event) ?? []), fn]);
    },
  };
  const run = async (event: string) => {
    for (const fn of phases.get(event) ?? []) await fn();
  };
  return { ctx, run };
}

function storageSettings() {
  return {
    createClient: () => ({}),
    getNamespace: async () => ({ values: { max_upload_mb: { value: MAX_UPLOAD_MB, source: 'global' } } }),
    subscribe: () => undefined,
    registerAction: () => undefined,
  };
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  for (const ql of engines.splice(0)) {
    try {
      await ql.destroy();
    } catch {
      /* already torn down */
    }
  }
});

/**
 * A real engine with `sys_file` and `ff_doc`, whose `file` field holds one
 * file and `scans` several, under `posture`. Which organization's files a read
 * reaches is the driver's tenant term — the wall the posture puts up, never a
 * comparison the verb writes — so a block that pins the organization boundary
 * boots `isolated`; under `single` there is one tenant and no wall.
 */
async function engine(posture: 'single' | 'isolated'): Promise<ObjectQL> {
  const ql = new ObjectQL({ logger: quietLogger() } as any);
  ql.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
    true,
  );
  await ql.init();
  ql.setTenancyPostureProvider(() => posture);
  engines.push(ql);
  ql.registry.registerObject(SystemFile as any, 'test-25779');
  ql.registry.registerObject(
    {
      name: 'ff_doc',
      fields: { name: { type: 'text' }, file: { type: 'file' }, scans: { type: 'file', multiple: true } },
    } as any,
    'test-25779',
  );
  await ql.syncSchemas();
  return ql;
}

/** Boot the plugin over a fresh engine; `ready: false` stops after `start()`, as a seed in `start()` sees it. */
async function boot(opts: { ready?: boolean; posture?: 'single' | 'isolated' } = {}) {
  const ql = await engine(opts.posture ?? 'single');
  const rootDir = await fs.mkdtemp(join(tmpdir(), 'oss-25779-'));
  const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir }, registerRoutes: false });
  const { ctx, run } = makeCtx();
  ctx.registerService('objectql', ql);
  ctx.registerService('settings', storageSettings());
  await plugin.init(ctx);
  await plugin.start(ctx);
  if (opts.ready !== false) {
    await run('kernel:ready');
    await run('kernel:bootstrapped');
  }
  const files = ctx.getService(FIELD_FILE_SERVICE) as IFieldFileService;
  const storage = ctx.getService('storage') as IStorageService;
  return { ql, files, storage };
}

const input = (over: Partial<StoreFieldFileInput> = {}): StoreFieldFileInput => ({
  organizationId: 'org_a',
  filename: 'nda-v1.pdf',
  mimeType: 'application/pdf',
  data: Buffer.from('%PDF-1.7 a seeded contract'),
  metadata: { seedFile: 'fixtures/nda-v1.pdf', sha256: 'f'.repeat(64) },
  ...over,
});

const fileRows = (ql: ObjectQL) => ql.find('sys_file', { ...SYS }) as Promise<Array<Record<string, any>>>;
const slot = (recordId: string, field = 'file') => ({ object: 'ff_doc', recordId, field });

async function refusalOf(call: Promise<unknown>): Promise<{ code?: string; status?: number; message?: string }> {
  try {
    await call;
  } catch (err) {
    return err as { code?: string; status?: number };
  }
  throw new Error('expected the call to be refused');
}

describe('FIELD_FILE_SERVICE: the server-side field-file verb (#25779)', () => {
  it('is registered under its contract slot and declared in providesServices', async () => {
    expect(new StorageServicePlugin().providesServices).toContain(FIELD_FILE_SERVICE);
    const { files } = await boot();
    expect(files).toBeInstanceOf(FieldFileService);
  });

  it('stores a pending, unowned file in the named organization, with its provenance and bytes — before kernel:ready too', async () => {
    const { ql, files, storage } = await boot({ ready: false });
    const data = Buffer.from('%PDF-1.7 seeded');
    const out = await files.storeFile(input({ data }));
    expect(out.size).toBe(data.byteLength);

    const rows = await fileRows(ql);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: out.fileId,
      key: `tenant/${out.fileId}.pdf`,
      name: 'nda-v1.pdf',
      mime_type: 'application/pdf',
      size: data.byteLength,
      scope: 'tenant',
      acl: 'private',
      status: 'pending',
      organization_id: 'org_a',
    });
    expect(rows[0].ref_id ?? null).toBeNull();
    expect(JSON.parse(rows[0].metadata)).toEqual({ seedFile: 'fixtures/nda-v1.pdf', sha256: 'f'.repeat(64) });
    expect((await storage.download(rows[0].key)).equals(data)).toBe(true);
  });

  it('refuses bytes over the upload size limit with the upload doors\' envelope, leaving nothing', async () => {
    const { ql, files } = await boot();
    const refusal = await refusalOf(files.storeFile(input({ data: Buffer.alloc(2000) })));
    expect(refusal).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    expect(await fileRows(ql)).toEqual([]);
    // The same call under the limit is stored.
    await files.storeFile(input({ data: Buffer.alloc(1000) }));
    expect(await fileRows(ql)).toHaveLength(1);
  });

  it('refuses a malformed input before anything is written', async () => {
    const { ql, files } = await boot();
    expect(await refusalOf(files.storeFile(input({ filename: '' })))).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(await refusalOf(files.storeFile({ ...input(), organizationId: undefined as any }))).toMatchObject({ status: 400 });
    expect(await refusalOf(files.storeFile(input({ data: 'bytes' as any })))).toMatchObject({ status: 400 });
    expect(await fileRows(ql)).toEqual([]);
  });

  it('describes the files that exist in the organization, and no other', async () => {
    const { files } = await boot({ posture: 'isolated' });
    const a = await files.storeFile(input({ organizationId: 'org_a' }));
    const b = await files.storeFile(input({ organizationId: 'org_b' }));
    const inA = await files.describeFiles([a.fileId, b.fileId, 'missing'], 'org_a');
    expect([...inA.keys()]).toEqual([a.fileId]);
    expect(inA.get(a.fileId)).toEqual({
      fileId: a.fileId,
      name: 'nda-v1.pdf',
      mimeType: 'application/pdf',
      status: 'pending',
      owner: null,
      metadata: { seedFile: 'fixtures/nda-v1.pdf', sha256: 'f'.repeat(64) },
    });
  });

  it('claims: commits the files, makes the slot their owner, and releases the slot\'s previous file', async () => {
    const { ql, files } = await boot({ ready: false });
    await ql.insert('ff_doc', { id: 'doc_1', name: 'one', organization_id: 'org_a' }, SYS);
    const first = await files.storeFile(input());
    await files.claimFiles(slot('doc_1'), [first.fileId], 'org_a');
    let described = await files.describeFiles([first.fileId], 'org_a');
    expect(described.get(first.fileId)).toMatchObject({ status: 'committed', owner: slot('doc_1') });

    // Idempotent: claiming again changes nothing.
    await files.claimFiles(slot('doc_1'), [first.fileId], 'org_a');
    described = await files.describeFiles([first.fileId], 'org_a');
    expect(described.get(first.fileId)).toMatchObject({ status: 'committed', owner: slot('doc_1') });

    // A new file for the same slot releases the first.
    const second = await files.storeFile(input({ filename: 'nda-v2.pdf' }));
    await files.claimFiles(slot('doc_1'), [second.fileId], 'org_a');
    described = await files.describeFiles([first.fileId, second.fileId], 'org_a');
    expect(described.get(first.fileId)?.owner).toBeNull();
    expect(described.get(second.fileId)).toMatchObject({ status: 'committed', owner: slot('doc_1') });
  });

  it('never takes a file another slot owns, and refuses a file that does not exist', async () => {
    const { files } = await boot({ posture: 'isolated' });
    const owned = await files.storeFile(input());
    await files.claimFiles(slot('doc_1'), [owned.fileId], 'org_a');
    expect(await refusalOf(files.claimFiles(slot('doc_2'), [owned.fileId], 'org_a'))).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      status: 409,
    });
    expect((await files.describeFiles([owned.fileId], 'org_a')).get(owned.fileId)?.owner).toEqual(slot('doc_1'));
    expect(await refusalOf(files.claimFiles(slot('doc_2'), ['no-such-file'], 'org_a'))).toMatchObject({
      code: 'RECORD_NOT_FOUND',
      status: 404,
    });
    // A file of another organization is not one this organization can claim.
    const elsewhere = await files.storeFile(input({ organizationId: 'org_b' }));
    expect(await refusalOf(files.claimFiles(slot('doc_2'), [elsewhere.fileId], 'org_a'))).toMatchObject({ status: 404 });
  });

  it('agrees with the reference hooks: a record write claims the stored file, and claimFiles then only commits it', async () => {
    const { ql, files } = await boot();
    const stored = await files.storeFile(input());
    const row = (await ql.insert(
      'ff_doc',
      { name: 'hooked', file: stored.fileId, organization_id: 'org_a' },
      { context: { isSystem: true, tenantId: 'org_a' } },
    )) as { id: string };
    let described = await files.describeFiles([stored.fileId], 'org_a');
    expect(described.get(stored.fileId)).toMatchObject({ status: 'pending', owner: slot(row.id) });

    await files.claimFiles(slot(row.id), [stored.fileId], 'org_a');
    described = await files.describeFiles([stored.fileId], 'org_a');
    expect(described.get(stored.fileId)).toMatchObject({ status: 'committed', owner: slot(row.id) });
  });

  it('settles a multiple field to exactly the files it is given', async () => {
    const { files } = await boot({ ready: false });
    const [p1, p2, p3] = [
      await files.storeFile(input({ filename: 'p1.png', mimeType: 'image/png' })),
      await files.storeFile(input({ filename: 'p2.png', mimeType: 'image/png' })),
      await files.storeFile(input({ filename: 'p3.png', mimeType: 'image/png' })),
    ];
    await files.claimFiles(slot('doc_1', 'scans'), [p1.fileId, p2.fileId], 'org_a');
    await files.claimFiles(slot('doc_1', 'scans'), [p2.fileId, p3.fileId], 'org_a');
    const described = await files.describeFiles([p1.fileId, p2.fileId, p3.fileId], 'org_a');
    expect(described.get(p1.fileId)?.owner).toBeNull();
    expect(described.get(p2.fileId)?.owner).toEqual(slot('doc_1', 'scans'));
    expect(described.get(p3.fileId)?.owner).toEqual(slot('doc_1', 'scans'));
  });
});
