// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26046 — a file its owning record lets go keeps that record's read rule.
 *
 * ADR-0104 D3: one file, one owning record, one access rule. Until a writer
 * who may read it claims it again, or the platform collects it, a file its
 * record let go is still the one that record held, so it is read by that
 * record's rule.
 *
 * ## What is pinned
 *
 * One real `ObjectQL` engine over sqlite `:memory:`, with `StorageServicePlugin`
 * booted and wired exactly as it ships, asked through both doors that judge a
 * file by the download door's verdict: the download door
 * (`GET /files/:fileId/url`) and a record write naming the file (the claim
 * path, #25692). Two members of one organization: one who may read the record
 * that held the file and one who may not. For every way a file leaves its
 * slot, under both collection settings:
 *
 *   - the member refused the record is refused the file, on both doors (a
 *     write naming it is refused at the field, #26043);
 *   - the member who reads the record still reads it, and may take it back;
 *   - once the record is deleted, only the uploader reads the file.
 *
 * And the rules this sits beside, unchanged: a file no record ever held is
 * read within its organization (#25693), and a write's claim makes the
 * claiming record the file's one owner.
 *
 * ## The stand-ins, and only these
 *
 *   - The security layer's refusals: an engine middleware that throws
 *     `PERMISSION_DENIED` for every non-system read of `sys_file`, and for
 *     the refused member's reads of `vault`.
 *   - The permission store the door's context resolution reads: reads of an
 *     object this fixture never registered answer empty.
 *   - The deployment's file-as-reference migration flag, which decides
 *     whether a released file is tombstoned.
 *   - Authentication: one `x-test-user` header per session.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IStorageService, RouteHandler } from '@objectstack/spec/contracts';
import { RAW_FILE_VALUES_CONTEXT_KEY, type EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { StorageServicePlugin } from './storage-service-plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const URL_ROUTE = '/api/v1/storage/files/:fileId/url';
const SYS = { isSystem: true };
const SYS_RAW = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true };
/** A member of the organization the `vault` records are refused to. */
const OUTSIDER = 'u_outsider';
/** A member of the organization who reads the `vault` records. */
const READER = 'u_reader';
/** Who uploaded every fixture file. */
const UPLOADER = 'u_uploader';

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

/** The refusal the security layer throws — `PermissionDeniedError`'s declared envelope. */
const refusal = () =>
  Object.assign(new Error('You do not have permission to perform this action.'), {
    name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403, statusCode: 403,
  });

const fileRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  key: `files/${id}.pdf`,
  name: `${id}.pdf`,
  size: 2048,
  mime_type: 'application/pdf',
  scope: 'user',
  acl: 'private',
  status: 'committed',
  owner_id: UPLOADER,
  ...extra,
});
const owned = (object: string, recordId: string, field: string) => ({
  ref_object: object, ref_id: recordId, ref_field: field,
});

/** Each way a file leaves its field slot, as the reader's write. */
type Release = {
  name: string;
  /** The file the record lets go. */
  file: string;
  /** Does the record survive the release? */
  recordSurvives: boolean;
  release: (engine: ObjectQL) => Promise<unknown>;
};
const RELEASES: Release[] = [
  {
    name: 'release 1 of 4',
    file: 'f_replaced',
    recordSurvives: true,
    release: (engine) =>
      engine.update('vault', { id: 'v_replaced', doc: 'f_replacement' } as any, { context: { userId: READER } }),
  },
  {
    name: 'release 2 of 4',
    file: 'f_cleared',
    recordSurvives: true,
    release: (engine) =>
      engine.update('vault', { id: 'v_cleared', doc: null } as any, { context: { userId: READER } }),
  },
  {
    name: 'release 3 of 4',
    file: 'f_dropped',
    recordSurvives: true,
    release: (engine) =>
      engine.update('vault', { id: 'v_multi', annexes: ['f_kept'] } as any, { context: { userId: READER } }),
  },
  {
    name: 'release 4 of 4',
    file: 'f_deleted',
    recordSurvives: false,
    release: (engine) =>
      engine.delete('vault', { where: { id: 'v_deleted' }, context: { userId: READER } } as any),
  },
];

const FILES = [
  fileRow('f_replaced', owned('vault', 'v_replaced', 'doc')),
  fileRow('f_replacement', { owner_id: READER }),
  fileRow('f_cleared', owned('vault', 'v_cleared', 'doc')),
  fileRow('f_dropped', owned('vault', 'v_multi', 'annexes')),
  fileRow('f_kept', owned('vault', 'v_multi', 'annexes')),
  fileRow('f_deleted', owned('vault', 'v_deleted', 'doc')),
  /** No record ever held it: an upload of the organization. */
  fileRow('f_free'),
];

async function boot(tombstones: boolean) {
  const rootDir = join(tmpdir(), `os-26046-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });

  const engine = new ObjectQL({ logger: silentLogger() } as any);
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }) as any, true);
  await engine.init();

  // The data door the plugin is handed: the real engine, except that a read of
  // an object this fixture never registered answers empty, and the migration
  // flag is this deployment's.
  const dataEngine = new Proxy(engine, {
    get(target, prop) {
      if (prop === 'find') {
        return (object: string, query?: EngineQueryOptions) =>
          target.getSchema(object) ? target.find(object, query) : Promise.resolve([]);
      }
      if (prop === 'isFileReferencesMigrationVerified') return async () => tombstones;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const services = new Map<string, unknown>();
  const ready: Array<() => Promise<void> | void> = [];
  const routes = new Map<string, RouteHandler>();
  const put = (m: string) => (path: string, handler: RouteHandler) => { routes.set(`${m}:${path}`, handler); };
  const ctx = {
    logger: silentLogger(),
    registerService: (name: string, svc: unknown) => { services.set(name, svc); },
    getService: <T>(name: string): T => {
      if (!services.has(name)) throw new Error(`service '${name}' not registered`);
      return services.get(name) as T;
    },
    hook: (event: string, fn: () => Promise<void> | void) => { if (event === 'kernel:ready') ready.push(fn); },
  };
  ctx.registerService('objectql', dataEngine);
  ctx.registerService('http-server', {
    get: put('GET'), post: put('POST'), put: put('PUT'),
    delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  });
  ctx.registerService('manifest', { register: (manifest: any) => engine.registerApp(manifest) });
  ctx.registerService('auth', {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get('x-test-user');
        return userId ? { user: { id: userId }, session: {} } : undefined;
      },
    },
  });

  const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false });
  await plugin.init(ctx as any);

  engine.registerApp({
    id: 'com.objectstack.test.file-reference-release-read-rule',
    name: 'File reference release read rule',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      { name: 'contract', label: 'Contract', fields: { doc: { name: 'doc', type: 'file' } } },
      {
        name: 'vault',
        label: 'Vault',
        fields: {
          doc: { name: 'doc', type: 'file' },
          annexes: { name: 'annexes', type: 'file', multiple: true },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);

  // Seeded BEFORE kernel:ready, so the field-reference hooks do not rewrite
  // the fixture.
  for (const f of FILES) await engine.insert('sys_file', f as any, { context: SYS });
  await engine.insert('vault', { id: 'v_replaced', doc: 'f_replaced' } as any, { context: SYS });
  await engine.insert('vault', { id: 'v_cleared', doc: 'f_cleared' } as any, { context: SYS });
  await engine.insert('vault', { id: 'v_multi', annexes: ['f_dropped', 'f_kept'] } as any, { context: SYS });
  await engine.insert('vault', { id: 'v_deleted', doc: 'f_deleted' } as any, { context: SYS });

  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    if (!op.context?.isSystem) throw refusal();
    return next();
  }, { object: 'sys_file' });
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    if (!op.context?.isSystem && op.context?.userId === OUTSIDER) throw refusal();
    return next();
  }, { object: 'vault' });

  await plugin.start(ctx as any);
  for (const h of ready) await h();

  const storage = ctx.getService<IStorageService>('storage');
  for (const f of FILES) await storage.upload(f.key, Buffer.from(`bytes of ${f.id}`));

  /** What the download door tells `user` about one file. */
  const door = async (fileId: string, user: string) => {
    const res: any = {
      _status: 200, _json: null,
      json(data: any) { res._json = data; return res; },
      send() { return res; },
      status(code: number) { res._status = code; return res; },
      header() { return res; },
    };
    await routes.get(`GET:${URL_ROUTE}`)!(
      { params: { fileId }, query: {}, headers: { 'x-test-user': user }, method: 'GET', path: URL_ROUTE } as any,
      res,
    );
    return { status: res._status as number, code: res._json?.error?.code as string | undefined };
  };

  const fileById = async (id: string) =>
    ((await engine.find('sys_file', { where: { id }, context: SYS })) as Array<Record<string, any>>)[0];

  /**
   * Write `fileId` into a new contract's `doc` as `user`, and report what the
   * write did with it: `claimed` (the record owns the file it named) or
   * [#26043] `refused` (the write was refused at `doc`, and no record was
   * written).
   */
  let seq = 0;
  const writeAs = async (fileId: string, user: string) => {
    const recordId = `c_${++seq}`;
    const err = await engine
      .insert('contract', { id: recordId, doc: fileId } as any, { context: { userId: user } })
      .then(() => null, (e: any) => e);
    const held = ((await engine.find('contract', { where: { id: recordId }, context: SYS_RAW })) as any[])[0]?.doc;
    if (err) {
      const answered = resolveThrownHttpError(err);
      const fields = (answered.details?.fields as any[] | undefined)?.map((f) => [f.field, f.code]);
      return answered.status === 400 && answered.code === 'VALIDATION_FAILED' && held === undefined
        && JSON.stringify(fields) === JSON.stringify([['doc', 'invalid_value']])
        ? 'refused'
        : `unexpected (${answered.status} ${answered.code})`;
    }
    const row = await fileById(fileId);
    const owns = row?.ref_object === 'contract' && row?.ref_id === recordId && row?.ref_field === 'doc';
    return held === fileId && owns ? 'claimed' : `unexpected (held ${String(held)}, owns ${owns})`;
  };

  return {
    engine, door, fileById, writeAs,
    teardown: async () => {
      try { await engine.destroy(); } catch { /* already torn down */ }
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

const ALLOWED = { status: 200, code: undefined };
const DENIED = { status: 403, code: 'FILE_DOWNLOAD_DENIED' };

describe('#26046 — a file its owning record lets go keeps that record\'s read rule (collection closed)', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    h = await boot(false);
    for (const r of RELEASES) {
      expect(await h.door(r.file, OUTSIDER)).toEqual(DENIED);
      await r.release(h.engine);
      expect((await h.fileById(r.file))?.ref_id ?? null).toBeNull();
    }
  });
  afterAll(async () => { await h?.teardown(); });

  describe.each(RELEASES)('$name', (r) => {
    it('a member refused the record is refused the file, at the download door and at a write', async () => {
      expect(await h.door(r.file, OUTSIDER)).toEqual(DENIED);
      expect(await h.writeAs(r.file, OUTSIDER)).toBe('refused');
      expect((await h.fileById(r.file))?.ref_id ?? null).toBeNull();
    });

    it('the uploader still reads it', async () => {
      expect(await h.door(r.file, UPLOADER)).toEqual(ALLOWED);
    });

    it(
      r.recordSurvives
        ? 'CONTROL — a reader of the record still reads it, and may take it back'
        : 'with the record gone, its reader is refused too',
      async () => {
        if (!r.recordSurvives) {
          expect(await h.door(r.file, READER)).toEqual(DENIED);
          expect(await h.writeAs(r.file, READER)).toBe('refused');
          return;
        }
        expect(await h.door(r.file, READER)).toEqual(ALLOWED);
        expect(await h.writeAs(r.file, READER)).toBe('claimed');
        // Claimed, the file is the claiming record's, and read by its rule:
        // every member reads a `contract` here.
        expect(await h.door(r.file, OUTSIDER)).toEqual(ALLOWED);
      },
    );
  });

  it('CONTROL — a file no record ever held is read within its organization, and claimed (#25693)', async () => {
    expect(await h.door('f_free', OUTSIDER)).toEqual(ALLOWED);
    expect(await h.writeAs('f_free', OUTSIDER)).toBe('claimed');
  });
});

describe('#26046 — a file its owning record lets go keeps that record\'s read rule (collection open)', () => {
  let h: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    h = await boot(true);
    for (const r of RELEASES) {
      await r.release(h.engine);
      expect(await h.fileById(r.file)).toMatchObject({ status: 'deleted', ref_id: null });
    }
  });
  afterAll(async () => { await h?.teardown(); });

  describe.each(RELEASES)('$name', (r) => {
    it('a write by a member refused the record neither takes nor revives the file', async () => {
      expect(await h.writeAs(r.file, OUTSIDER)).toBe('refused');
      expect(await h.fileById(r.file)).toMatchObject({ status: 'deleted', ref_id: null });
    });

    it(
      r.recordSurvives
        ? 'CONTROL — a reader of the record may take it back, which revives it'
        : 'with the record gone, its reader may not take it back either',
      async () => {
        if (!r.recordSurvives) {
          expect(await h.writeAs(r.file, READER)).toBe('refused');
          expect(await h.fileById(r.file)).toMatchObject({ status: 'deleted', ref_id: null });
          return;
        }
        expect(await h.writeAs(r.file, READER)).toBe('claimed');
        expect(await h.fileById(r.file)).toMatchObject({ status: 'committed' });
      },
    );
  });
});
