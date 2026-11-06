// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23306] The server-side attach verb — `FILE_ATTACHMENT_SERVICE`, registered
 * by `StorageServicePlugin` — stores bytes and attaches them to a record as one
 * `sys_file` and one `sys_attachment`, and no refusal leaves a committed
 * `sys_file` (the #22547 class).
 *
 * What these pin, through the plugin's OWN wiring (a real `ObjectQL` over
 * sqlite `:memory:`, the package's ruled test backend; the plugin's own
 * `kernel:ready` gates; `plugin-audit`'s REAL `enable.files` gate on the
 * `sys_attachment` insert; the plugin's local adapter in a temp directory; and
 * a settings namespace carrying `max_upload_mb`), reached by its registry name:
 *
 *  - an admitted call writes exactly one committed `sys_file` (attachments
 *    scope, the bytes behind its key) and one `sys_attachment` linking it to
 *    the parent, both in the parent's organization;
 *  - the three refusals the card names — over the size limit, `enable.files`
 *    off on the parent object, a parent outside the caller's organization —
 *    each answer their ADR-0112 envelope and leave NO `sys_file` row at all,
 *    committed or pending, no `sys_attachment` row and no stored bytes; each is
 *    paired with the same call minus the refused condition, which succeeds;
 *  - a failure after the attachment insert (the commit refused) rolls the
 *    attachment back with it, and on an engine with no transaction the call
 *    removes the row it inserted itself;
 *  - the verb serves only once the kernel has bootstrapped, and refuses a
 *    malformed input before anything is read or written.
 *
 * The ablations that turn each pin red are one-off proofs, recorded in the PR.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectQL } from '@objectstack/objectql';
import { resolveThrownHttpError } from '@objectstack/types';
import { SqlDriver } from '@objectstack/driver-sql';
import { installAuditWriters } from '@objectstack/plugin-audit';
import { SysAttachment } from '@objectstack/platform-objects/audit';
import { FILE_ATTACHMENT_SERVICE } from '@objectstack/spec/contracts';
import type { AttachFileInput, IFileAttachmentService, IStorageService } from '@objectstack/spec/contracts';
import { SystemFile } from './objects/system-file.object.js';
import { StorageMetadataStoreError } from './metadata-store.js';
import { StorageServicePlugin } from './storage-service-plugin.js';
import type { SwappableStorageService } from './swappable-storage-service.js';
import {
  FileAttachmentService,
  type FileAttachmentEngine,
  type ICallerFileAttachmentService,
} from './file-attachment-service.js';

const SYS = { context: { isSystem: true } } as const;
/** `max_upload_mb` as saved: 0.001 MB ⇒ floor(0.001 × 1 MiB) = 1048 bytes. */
const MAX_UPLOAD_MB = 0.001;
const MAX_UPLOAD_BYTES = 1048;

function quietLogger() {
  const logger: any = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
  logger.child = () => logger;
  return logger;
}

/** A plugin context with a service map, and the two boot phases the plugin hooks, run on demand. */
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

/** The `storage` settings namespace, carrying only the saved upload size limit. */
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
 * A real engine, the platform's objects, and two parent objects: `att_case`
 * opts into attachments (`enable.files: true`), `att_memo` does not. Parents
 * in `org_a`, in `org_b`, and one global (no organization).
 */
async function engineWithParents(): Promise<ObjectQL> {
  const ql = new ObjectQL({ logger: quietLogger() } as any);
  ql.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
    true,
  );
  await ql.init();
  engines.push(ql);
  ql.registry.registerObject(SystemFile as any, 'test-23306');
  ql.registry.registerObject(SysAttachment as any, 'test-23306');
  ql.registry.registerObject(
    { name: 'att_case', enable: { files: true }, fields: { name: { type: 'text' } } } as any,
    'test-23306',
  );
  ql.registry.registerObject({ name: 'att_memo', fields: { name: { type: 'text' } } } as any, 'test-23306');
  await ql.syncSchemas();
  // `case_global` belongs to no organization, a row only a store built before
  // 18.x can hold (ADR-0131 D1 makes a fresh tenant column NOT NULL): `att_case`
  // is that store's table, relaxed through the driver's own drift apply door.
  const relaxed = await (ql.getDriverForObject('att_case') as any).applyMigrationEntries([
    {
      kind: 'nullability_mismatch', remoteName: 'att_case', table: 'att_case', column: 'organization_id', category: 'needs_confirm',
      op: { type: 'relax_not_null', table: 'att_case', column: 'organization_id' },
    },
  ]);
  expect(relaxed.applied).toHaveLength(1);
  // plugin-audit's REAL `enable.files` gate (and the rest of its writers), as
  // AuditPlugin installs them on the composed engine.
  installAuditWriters(ql as any);
  await ql.insert('att_case', { id: 'case_a', name: 'in org_a', organization_id: 'org_a' }, SYS);
  await ql.insert('att_case', { id: 'case_b', name: 'in org_b', organization_id: 'org_b' }, SYS);
  await ql.insert('att_case', { id: 'case_global', name: 'in no organization' }, SYS);
  await ql.insert('att_memo', { id: 'memo_a', name: 'files off', organization_id: 'org_a' }, SYS);
  return ql;
}

/** Boot the plugin over `ql` through its real phases; `bootstrapped: false` stops before the verb is armed. */
async function boot(opts: { bootstrapped?: boolean; engine?: boolean; sharing?: unknown; security?: unknown } = {}) {
  const ql = await engineWithParents();
  const rootDir = await fs.mkdtemp(join(tmpdir(), 'oss-23306-'));
  const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir }, registerRoutes: false });
  const { ctx, run } = makeCtx();
  if (opts.engine !== false) ctx.registerService('objectql', ql);
  ctx.registerService('settings', storageSettings());
  if (opts.sharing) ctx.registerService('sharing', opts.sharing);
  if (opts.security) ctx.registerService('security', opts.security);
  await plugin.init(ctx);
  await plugin.start(ctx);
  await run('kernel:ready');
  if (opts.bootstrapped !== false) await run('kernel:bootstrapped');
  const attachments = ctx.getService(FILE_ATTACHMENT_SERVICE) as IFileAttachmentService;
  const storage = ctx.getService('storage') as SwappableStorageService;
  return { ql, run, attachments, storage, rootDir };
}

const input = (over: Partial<AttachFileInput> = {}): AttachFileInput => ({
  parentObject: 'att_case',
  parentId: 'case_a',
  organizationId: 'org_a',
  filename: 'forwarded.eml',
  mimeType: 'message/rfc822',
  data: Buffer.from('From: someone@example.com\r\n\r\nhello'),
  ...over,
});

const rows = (ql: ObjectQL, object: string) => ql.find(object, { ...SYS }) as Promise<Array<Record<string, any>>>;

/** Every key under the attachments prefix — the bytes this verb could have left behind. */
async function storedKeys(storage: IStorageService): Promise<string[]> {
  const page = await storage.list!('attachments/');
  return page.items.map((i) => i.key);
}

async function refusalOf(call: Promise<unknown>): Promise<{ code?: string; status?: number }> {
  try {
    await call;
  } catch (err) {
    return err as { code?: string; status?: number };
  }
  throw new Error('expected the call to be refused');
}

/** The #22547 assertion: nothing of the refused call is left — no sys_file (committed or pending), no link, no bytes. */
async function expectNothingLeft(ql: ObjectQL, storage: IStorageService) {
  expect(await rows(ql, 'sys_file')).toEqual([]);
  expect(await rows(ql, 'sys_attachment')).toEqual([]);
  expect(await storedKeys(storage)).toEqual([]);
}

describe('FILE_ATTACHMENT_SERVICE: the server-side attach verb (#23306)', () => {
  it('is registered under its contract slot by StorageServicePlugin, and declared in providesServices', async () => {
    expect(FILE_ATTACHMENT_SERVICE).toBe('file-attachments');
    expect(new StorageServicePlugin().providesServices).toContain(FILE_ATTACHMENT_SERVICE);
    const { attachments } = await boot();
    expect(attachments).toBeInstanceOf(FileAttachmentService);
  });

  it('stores the bytes and writes one committed sys_file and one sys_attachment, in the parent organization', async () => {
    const { ql, attachments, storage } = await boot();
    const data = Buffer.from('a forwarded message');
    const out = await attachments.attachFile(input({ data }));

    const files = await rows(ql, 'sys_file');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      id: out.fileId,
      status: 'committed',
      scope: 'attachments',
      acl: 'private',
      name: 'forwarded.eml',
      mime_type: 'message/rfc822',
      size: data.byteLength,
      organization_id: 'org_a',
    });
    expect(files[0].key).toBe(`attachments/${out.fileId}.eml`);
    expect((await storage.download(files[0].key)).equals(data)).toBe(true);

    const links = await rows(ql, 'sys_attachment');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      id: out.attachmentId,
      parent_object: 'att_case',
      parent_id: 'case_a',
      file_id: out.fileId,
      file_name: 'forwarded.eml',
      mime_type: 'message/rfc822',
      size: data.byteLength,
      organization_id: 'org_a',
    });
    expect(out.size).toBe(data.byteLength);
  });

  describe('refusal: over the upload size limit (max_upload_mb)', () => {
    it('refuses 413 PAYLOAD_TOO_LARGE before anything is stored or written', async () => {
      const { ql, attachments, storage } = await boot();
      const err = await refusalOf(attachments.attachFile(input({ data: Buffer.alloc(MAX_UPLOAD_BYTES + 1) })));
      expect(err.code).toBe('PAYLOAD_TOO_LARGE');
      expect(err.status).toBe(413);
      await expectNothingLeft(ql, storage);
    });

    it('control: a file exactly at the limit is attached', async () => {
      const { ql, attachments } = await boot();
      const out = await attachments.attachFile(input({ data: Buffer.alloc(MAX_UPLOAD_BYTES) }));
      expect(out.size).toBe(MAX_UPLOAD_BYTES);
      expect((await rows(ql, 'sys_file')).map((f) => f.status)).toEqual(['committed']);
    });
  });

  describe('refusal: files disabled on the parent object', () => {
    it('refuses 403 FILES_DISABLED (the enable.files gate on the insert) and leaves no sys_file, link or bytes', async () => {
      const { ql, attachments, storage } = await boot();
      const err = await refusalOf(attachments.attachFile(input({ parentObject: 'att_memo', parentId: 'memo_a' })));
      expect(err.code).toBe('FILES_DISABLED');
      expect(err.status).toBe(403);
      await expectNothingLeft(ql, storage);
    });

    it('control: the same call on an object that opts into files is attached', async () => {
      const { ql, attachments } = await boot();
      await attachments.attachFile(input());
      expect(await rows(ql, 'sys_attachment')).toHaveLength(1);
    });
  });

  describe('refusal: a parent outside the organization', () => {
    it('refuses 404 RECORD_NOT_FOUND for a parent walled into another organization, before anything is written', async () => {
      const { ql, attachments, storage } = await boot();
      const err = await refusalOf(attachments.attachFile(input({ parentId: 'case_b', organizationId: 'org_a' })));
      expect(err.code).toBe('RECORD_NOT_FOUND');
      expect(err.status).toBe(404);
      await expectNothingLeft(ql, storage);
    });

    it('control: the same parent, acted on from its own organization, is attached there', async () => {
      const { ql, attachments } = await boot();
      await attachments.attachFile(input({ parentId: 'case_b', organizationId: 'org_b' }));
      expect((await rows(ql, 'sys_file')).map((f) => f.organization_id)).toEqual(['org_b']);
      expect((await rows(ql, 'sys_attachment')).map((a) => a.organization_id)).toEqual(['org_b']);
    });

    it('answers a parent that does not exist the same way', async () => {
      const { ql, attachments, storage } = await boot();
      const err = await refusalOf(attachments.attachFile(input({ parentId: 'case_missing' })));
      expect(err.code).toBe('RECORD_NOT_FOUND');
      expect(err.status).toBe(404);
      await expectNothingLeft(ql, storage);
    });
  });

  describe('the organization both rows are written in', () => {
    it('is the parent organization when the caller acts in none', async () => {
      const { ql, attachments } = await boot();
      await attachments.attachFile(input({ parentId: 'case_b', organizationId: null }));
      expect((await rows(ql, 'sys_file')).map((f) => f.organization_id)).toEqual(['org_b']);
      expect((await rows(ql, 'sys_attachment')).map((a) => a.organization_id)).toEqual(['org_b']);
    });

    it("is the caller's for a global parent", async () => {
      const { ql, attachments } = await boot();
      await attachments.attachFile(input({ parentId: 'case_global', organizationId: 'org_a' }));
      expect((await rows(ql, 'sys_file')).map((f) => f.organization_id)).toEqual(['org_a']);
      expect((await rows(ql, 'sys_attachment')).map((a) => a.organization_id)).toEqual(['org_a']);
    });
  });

  describe('a failure after the attachment insert', () => {
    /** Refuse the verb's commit (`status: 'committed'`) on sys_file, after the attachment was inserted. */
    const refuseCommit = (ql: ObjectQL) =>
      ql.registerHook(
        'beforeUpdate',
        async (hook: any) => {
          if (hook?.input?.data?.status === 'committed') {
            const err: any = new Error('commit refused by a test gate');
            err.code = 'VALIDATION_ERROR';
            err.status = 400;
            throw err;
          }
        },
        { object: 'sys_file', packageId: 'test-23306' },
      );

    /**
     * The commit is a `sys_file` write, so it fails the way every write of the
     * store does: as the store's own error, carrying the engine's refusal.
     */
    const expectCommitRefusal = (err: unknown) => {
      expect(err).toBeInstanceOf(StorageMetadataStoreError);
      expect((err as StorageMetadataStoreError).operation).toBe('update');
      expect(((err as StorageMetadataStoreError).cause as { code?: string }).code).toBe('VALIDATION_ERROR');
    };

    it('rolls the attachment back with the refused commit, and leaves nothing', async () => {
      const { ql, attachments, storage } = await boot();
      refuseCommit(ql);
      expectCommitRefusal(await refusalOf(attachments.attachFile(input())));
      await expectNothingLeft(ql, storage);
    });

    it('on an engine with no transaction, removes the attachment row it inserted', async () => {
      const { ql, storage } = await boot();
      refuseCommit(ql);
      const noTransaction: FileAttachmentEngine = {
        find: ql.find.bind(ql),
        findOne: ql.findOne.bind(ql),
        insert: ql.insert.bind(ql),
        update: ql.update.bind(ql),
        delete: ql.delete.bind(ql),
        count: ql.count.bind(ql),
        aggregate: ql.aggregate.bind(ql),
        getSchema: ql.getSchema.bind(ql),
      } as FileAttachmentEngine;
      const verb = new FileAttachmentService({
        getEngine: () => noTransaction,
        getStorage: () => storage,
        getLimitsSnapshot: () => storage.getLimitsSnapshot(),
        logger: quietLogger(),
      });
      expectCommitRefusal(await refusalOf(verb.attachFile(input())));
      await expectNothingLeft(ql, storage);
    });
  });

  describe('a failure storing the bytes', () => {
    it('propagates the backend error unchanged and removes the pending sys_file row', async () => {
      const { ql, storage } = await boot();
      const backendDown = new Error('the storage backend refused the write');
      const failingUpload: IStorageService = {
        upload: async () => {
          throw backendDown;
        },
        download: (key) => storage.download(key),
        delete: (key) => storage.delete(key),
        exists: (key) => storage.exists(key),
        getInfo: (key) => storage.getInfo(key),
      };
      const verb = new FileAttachmentService({
        getEngine: () => ql as unknown as FileAttachmentEngine,
        getStorage: () => failingUpload,
        getLimitsSnapshot: () => storage.getLimitsSnapshot(),
        logger: quietLogger(),
      });
      expect(await refusalOf(verb.attachFile(input()))).toBe(backendDown);
      await expectNothingLeft(ql, storage);
    });
  });

  describe('before it can serve', () => {
    it('refuses 503 SERVICE_UNAVAILABLE until kernel:bootstrapped, then serves', async () => {
      const { ql, run, attachments, storage } = await boot({ bootstrapped: false });
      const err = await refusalOf(attachments.attachFile(input()));
      expect(err.code).toBe('SERVICE_UNAVAILABLE');
      expect(err.status).toBe(503);
      await expectNothingLeft(ql, storage);
      await run('kernel:bootstrapped');
      await attachments.attachFile(input());
      expect(await rows(ql, 'sys_attachment')).toHaveLength(1);
    });

    it('refuses 503 SERVICE_UNAVAILABLE on a kernel with no data engine', async () => {
      const { attachments } = await boot({ engine: false });
      const err = await refusalOf(attachments.attachFile(input()));
      expect(err.code).toBe('SERVICE_UNAVAILABLE');
      expect(err.status).toBe(503);
    });

    it('refuses a malformed input 400 VALIDATION_ERROR before anything is read or written', async () => {
      const { ql, attachments, storage } = await boot();
      const malformed: Array<Partial<Record<keyof AttachFileInput, unknown>>> = [
        { parentObject: '' },
        { parentId: 42 },
        { organizationId: undefined },
        { organizationId: '' },
        { filename: '' },
        { mimeType: undefined },
        { data: 'not a buffer' },
      ];
      for (const over of malformed) {
        const err = await refusalOf(attachments.attachFile({ ...input(), ...over } as AttachFileInput));
        expect({ over, code: err.code, status: err.status }).toEqual({ over, code: 'VALIDATION_ERROR', status: 400 });
      }
      await expectNothingLeft(ql, storage);
    });
  });
});

describe('the file-attachments writer AS THE REQUESTING USER: assertMayAttach and attachFileAs', () => {
  const ALICE = { userId: 'usr_alice', tenantId: 'org_a', positions: ['org_member'] };
  const asCaller = (a: IFileAttachmentService) => a as IFileAttachmentService & ICallerFileAttachmentService;

  it('refuses the system context and a context with no user: PERMISSION_DENIED / 403, nothing written', async () => {
    const { ql, attachments, storage } = await boot();
    for (const context of [{ isSystem: true }, { tenantId: 'org_a' }]) {
      const r = await refusalOf(asCaller(attachments).attachFileAs(input(), context as never));
      expect([r.code, r.status]).toEqual(['PERMISSION_DENIED', 403]);
      const m = await refusalOf(asCaller(attachments).assertMayAttach('att_case', 'case_a', context as never));
      expect([m.code, m.status]).toEqual(['PERMISSION_DENIED', 403]);
    }
    await expectNothingLeft(ql, storage);
  });

  it('attaches as the caller: the sys_file is owned by them and the sys_attachment is stamped uploaded_by them', async () => {
    const { ql, attachments } = await boot();
    const out = await asCaller(attachments).attachFileAs(input(), ALICE as never);
    const [file] = await rows(ql, 'sys_file');
    expect(file).toMatchObject({ id: out.fileId, status: 'committed', owner_id: 'usr_alice', organization_id: 'org_a' });
    const [link] = await rows(ql, 'sys_attachment');
    expect(link).toMatchObject({ id: out.attachmentId, parent_id: 'case_a', uploaded_by: 'usr_alice' });
  });

  it('the attach rule refuses the caller (no edit access): ATTACHMENT_PARENT_ACCESS / 403 from the insert gate, nothing left; assertMayAttach answers the same', async () => {
    const sharing = { checkEdit: vi.fn(async () => 'deny') };
    const { ql, attachments, storage } = await boot({ sharing });
    const pre = await refusalOf(asCaller(attachments).assertMayAttach('att_case', 'case_a', ALICE as never));
    expect([pre.code, pre.status]).toEqual(['ATTACHMENT_PARENT_ACCESS', 403]);
    const r = await refusalOf(asCaller(attachments).attachFileAs(input(), ALICE as never));
    expect([r.code, r.status]).toEqual(['ATTACHMENT_PARENT_ACCESS', 403]);
    expect(sharing.checkEdit).toHaveBeenCalledWith('att_case', 'case_a', expect.objectContaining({ userId: 'usr_alice' }));
    await expectNothingLeft(ql, storage);
  });

  it('a caller who may not create attachments at all: PERMISSION_DENIED / 403, asked of the security service before the attach rule', async () => {
    const sharing = { checkEdit: vi.fn(async () => 'allow') };
    const security = { explain: vi.fn(async () => ({ allowed: false })) };
    const { attachments } = await boot({ sharing, security });
    const pre = await refusalOf(asCaller(attachments).assertMayAttach('att_case', 'case_a', ALICE as never));
    expect([pre.code, pre.status]).toEqual(['PERMISSION_DENIED', 403]);
    expect(security.explain).toHaveBeenCalledWith(
      { object: 'sys_attachment', operation: 'create' },
      expect.objectContaining({ userId: 'usr_alice' }),
    );
    expect(sharing.checkEdit).not.toHaveBeenCalled();
  });

  it('assertMayAttach admits what the insert gate admits', async () => {
    const sharing = { checkEdit: vi.fn(async () => 'allow') };
    const { attachments } = await boot({ sharing });
    await expect(asCaller(attachments).assertMayAttach('att_case', 'case_a', ALICE as never)).resolves.toBeUndefined();
  });

  it('an organizationId other than the caller’s own is refused PERMISSION_DENIED / 403 before anything is written', async () => {
    const { ql, attachments, storage } = await boot();
    for (const over of [
      { parentId: 'case_global', organizationId: 'org_b' },
      { parentId: 'case_a', organizationId: 'org_b' },
      { parentId: 'case_global', organizationId: null },
    ]) {
      const r = await refusalOf(asCaller(attachments).attachFileAs(input(over), ALICE as never));
      expect([r.code, r.status]).toEqual(['PERMISSION_DENIED', 403]);
    }
    await expectNothingLeft(ql, storage);
  });

  it('a parent walled into another organization than the caller’s is refused as not found', async () => {
    const { ql, attachments, storage } = await boot();
    const r = await refusalOf(
      asCaller(attachments).attachFileAs(input({ parentId: 'case_b', organizationId: 'org_a' }), ALICE as never),
    );
    expect([r.code, r.status]).toEqual(['RECORD_NOT_FOUND', 404]);
    await expectNothingLeft(ql, storage);
  });

  it('an object without the files opt-in is refused FILES_DISABLED / 403 by the insert gate, as the caller too', async () => {
    const { ql, attachments, storage } = await boot();
    const r = await refusalOf(
      asCaller(attachments).attachFileAs(input({ parentObject: 'att_memo', parentId: 'memo_a' }), ALICE as never),
    );
    expect([r.code, r.status]).toEqual(['FILES_DISABLED', 403]);
    await expectNothingLeft(ql, storage);
  });
});

describe('attachFileAs for a member who cannot read sys_file: the verb vouches for the one file it created', () => {
  // A member as a real deployment holds one: the create grant on
  // `sys_attachment` and none on `sys_file`. The middleware below stands in for
  // the object-permission layer: a non-system read of `sys_file` is refused
  // outright, as an ungranted object read is (`PERMISSION_DENIED` / 403), and
  // so is Bob's read of the parent object. The write-time reference check asks
  // the caller's read door for every `lookup` value, `sys_attachment.file_id`
  // included.
  const ALICE = { userId: 'usr_alice', tenantId: 'org_a', positions: ['org_member'] };
  const BOB = { userId: 'usr_bob', tenantId: 'org_a', positions: ['org_member'] };
  const asCaller = (a: IFileAttachmentService) => a as IFileAttachmentService & ICallerFileAttachmentService;
  const READS = new Set(['find', 'findOne', 'count', 'aggregate']);
  const readRefusal = (object: string) =>
    Object.assign(new Error(`[Security] Access denied: read on ${object}`), {
      name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403, statusCode: 403,
    });

  async function bootMember(opts: { sharing?: unknown } = {}) {
    const booted = await boot(opts);
    booted.ql.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      if (READS.has(ctx.operation) && ctx.context?.isSystem !== true) {
        if (ctx.object === 'sys_file') throw readRefusal('sys_file');
        if (ctx.object === 'att_case' && ctx.context?.userId === BOB.userId) throw readRefusal('att_case');
      }
      await next();
    });
    return booted;
  }

  /** A committed file the member owns, written by the system as the upload doors write one. */
  const seedOwnFile = (ql: ObjectQL) =>
    ql.insert('sys_file', {
      id: 'file_alice', key: 'attachments/file_alice/n.txt', name: 'n.txt', mime_type: 'text/plain', size: 1,
      scope: 'attachments', acl: 'private', status: 'committed', owner_id: 'usr_alice', organization_id: 'org_a',
    }, SYS);

  it('precondition: the member cannot read sys_file, not even the file they own', async () => {
    const { ql } = await bootMember();
    await seedOwnFile(ql);
    const err = await refusalOf(ql.findOne('sys_file', { where: { id: 'file_alice' }, context: ALICE }));
    expect([err.code, err.status]).toEqual(['PERMISSION_DENIED', 403]);
  });

  it('attaches as the member: one committed sys_file owned by them, one sys_attachment stamped uploaded_by them', async () => {
    const { ql, attachments, storage } = await bootMember();
    const out = await asCaller(attachments).attachFileAs(input(), ALICE as never);
    const files = await rows(ql, 'sys_file');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ id: out.fileId, status: 'committed', owner_id: 'usr_alice', organization_id: 'org_a' });
    const links = await rows(ql, 'sys_attachment');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      id: out.attachmentId, parent_object: 'att_case', parent_id: 'case_a', file_id: out.fileId,
      uploaded_by: 'usr_alice', organization_id: 'org_a',
    });
    expect(await storedKeys(storage)).toEqual([files[0].key]);
  });

  it('a producer’s sequence (assertMayAttach, then attachFileAs — the print archive’s) attaches as the member', async () => {
    const sharing = { checkEdit: vi.fn(async () => 'allow') };
    const { ql, attachments } = await bootMember({ sharing });
    await asCaller(attachments).assertMayAttach('att_case', 'case_a', ALICE as never);
    const out = await asCaller(attachments).attachFileAs(input({ filename: 'printed.pdf', mimeType: 'application/pdf' }), ALICE as never);
    const [link] = await rows(ql, 'sys_attachment');
    expect(link).toMatchObject({ id: out.attachmentId, file_id: out.fileId, uploaded_by: 'usr_alice' });
  });

  it('control: a member the attach rule refuses is still refused, by assertMayAttach and by attachFileAs, and nothing is left', async () => {
    const sharing = { checkEdit: vi.fn(async () => 'deny') };
    const { ql, attachments, storage } = await bootMember({ sharing });
    const pre = await refusalOf(asCaller(attachments).assertMayAttach('att_case', 'case_a', ALICE as never));
    expect([pre.code, pre.status]).toEqual(['ATTACHMENT_PARENT_ACCESS', 403]);
    const r = await refusalOf(asCaller(attachments).attachFileAs(input(), ALICE as never));
    expect([r.code, r.status]).toEqual(['ATTACHMENT_PARENT_ACCESS', 403]);
    await expectNothingLeft(ql, storage);
  });

  it('control: a parent the member cannot read is refused RECORD_NOT_FOUND / 404, and nothing is left', async () => {
    const { ql, attachments, storage } = await bootMember();
    const r = await refusalOf(asCaller(attachments).attachFileAs(input(), BOB as never));
    expect([r.code, r.status]).toEqual(['RECORD_NOT_FOUND', 404]);
    await expectNothingLeft(ql, storage);
  });

  /** What the member's own `sys_attachment` insert through the data engine answers. */
  async function directInsertRefusal(ql: ObjectQL, fileId: string) {
    const err = await refusalOf(
      ql.insert(
        'sys_attachment',
        { parent_object: 'att_case', parent_id: 'case_a', file_id: fileId, file_name: 'direct.eml' },
        { context: ALICE },
      ),
    );
    const envelope = resolveThrownHttpError(err);
    return {
      code: envelope.code,
      status: envelope.status,
      fields: ((err as any).fields ?? []).map((f: any) => [f.field, f.code]),
    };
  }
  const REFERENCE_NOT_FOUND = { code: 'VALIDATION_FAILED', status: 400, fields: [['file_id', 'reference_not_found']] };

  it('control: the member’s own insert of sys_attachment through the data engine, naming a file they cannot read, is refused reference_not_found', async () => {
    const { ql } = await bootMember();
    await seedOwnFile(ql);
    expect(await directInsertRefusal(ql, 'file_alice')).toEqual(REFERENCE_NOT_FOUND);
    expect(await rows(ql, 'sys_attachment')).toEqual([]);
  });

  it('the vouch is the verb’s call alone: after attachFileAs, the member’s own insert naming the same file is refused reference_not_found', async () => {
    const { ql, attachments } = await bootMember();
    const out = await asCaller(attachments).attachFileAs(input(), ALICE as never);
    expect(await directInsertRefusal(ql, out.fileId)).toEqual(REFERENCE_NOT_FOUND);
    expect(await rows(ql, 'sys_attachment')).toHaveLength(1);
  });
});
