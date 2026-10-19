// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A file field whose `sys_file` read was REFUSED to the reader does not read as
 * "no file".
 *
 * `resolveFileReferences` expands a stored `sys_file` id by reading `sys_file`
 * AS THE CALLER. A reader who may read the record but not `sys_file` is refused
 * that sub-read — measured on a real `ObjectQL` + `SecurityPlugin` stack, the
 * refusal arrives as a THROW (`PERMISSION_DENIED`, 403) from the object-level
 * CRUD gate, never as a short result. The seam's fail-open `catch` used to hand
 * the bare id back, which is byte-identical to an id with no committed row:
 * the refusal read as an absent file, and the one `warn` it left told the
 * operator to check storage availability.
 *
 * Now the refusal is served in the value: each id becomes
 * `{ id, metadataRefused: true }` (`FileRefusedValueSchema`). Every other
 * branch of the seam is unchanged, and the controls below pin that:
 *
 *   - an empty field still reads empty;
 *   - a reader allowed to read `sys_file` still gets the hydrated file;
 *   - a missing `sys_file` table still reads the bare id, silently;
 *   - a database-level ACL fault (`42501`) is an outage, not this caller's
 *     refusal — bare id and the seam's `warn`, exactly as before.
 *
 * The same pins against the real security layer live in plugin-security's
 * `file-field-hydration-refused.test.ts`; this file holds the seam's own
 * branches with a fake DRIVER (not a fake engine) and an engine middleware
 * standing in for the security layer's refusal.
 *
 * [#24335] ASKED BEFORE READ: with a security service in the engine's slot,
 * the engine asks its `canReadObject('sys_file')` first and a refused caller
 * is served the refused arm without the `sys_file` read — so the security
 * layer, which logs every refusal at WARN, sees no access attempt. The last
 * block pins that against the same fixture, and that the served body is the
 * one the refused read produced.
 */

import { describe, it, expect } from 'vitest';
import { FileRefusedValueSchema, valueSchemaFor } from '@objectstack/spec/data';
import { ObjectQL, SECURITY_SERVICE_SOURCE_SLOT } from './engine';

const FILE_ID = 'f_7cQx2Lm90a';
const SECOND_ID = 'f_zz11yy22xx';
const COMMITTED_ROWS = [
  { id: FILE_ID, name: 'contract.pdf', size: 1024, mime_type: 'application/pdf', status: 'committed' },
  { id: SECOND_ID, name: 'annex.pdf', size: 2048, mime_type: 'application/pdf', status: 'committed' },
];

/** The refusal the security layer throws — `PermissionDeniedError`'s declared envelope. */
const refusal = () =>
  Object.assign(
    new Error('You do not have permission to perform this action. Contact your administrator if you need access.'),
    { name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403, statusCode: 403 },
  );

const SYSTEM_CTX = { isSystem: true, userId: 'usr_system' };
const READER_CTX = { userId: 'usr_reader' };

/**
 * A driver whose `sys_file` read behaves as `sysFileRead` says, while every
 * other object reads normally out of an in-memory store.
 */
function makeDriver(sysFileRead: () => Promise<any[]>) {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (object: string) => {
    if (!stores.has(object)) stores.set(object, new Map());
    return stores.get(object)!;
  };
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async find(object: string) {
      if (object === 'sys_file') return sysFileRead();
      return [...storeFor(object).values()];
    },
    async findOne(object: string, query: any) {
      if (object === 'sys_file') return (await sysFileRead())[0] ?? null;
      const id = query?.where?.id;
      return (id != null ? storeFor(object).get(id) : [...storeFor(object).values()][0]) ?? null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const id = (data.id as string) ?? `r_${storeFor(object).size + 1}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const row = { ...storeFor(object).get(id), ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async delete(object: string, id: string) {
      return storeFor(object).delete(id);
    },
    async count() {
      return 0;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() {
      return [];
    },
    async bulkDelete() {},
    async beginTransaction() {
      return { __trx: true, commit: async () => {}, rollback: async () => {} };
    },
    async commit() {},
    async rollback() {},
  };
  return { driver, storeFor };
}

/** Records every line the engine writes, per level, as `(msg, meta)`. */
function makeCapturingLogger() {
  const lines: Record<string, Array<{ msg: string; meta: any }>> = {
    debug: [], info: [], warn: [], error: [], trace: [], fatal: [],
  };
  const push = (level: string) => (msg: unknown, meta?: unknown) => {
    lines[level].push({ msg: String(msg), meta });
  };
  const logger: any = {
    lines,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    trace: push('trace'),
    fatal: push('fatal'),
    child() {
      return logger;
    },
  };
  return logger;
}

/**
 * Boots an engine with a `doc` object (one single and one multi-value file
 * field), a registered `sys_file`, and three rows: one holding a file, one
 * holding two files plus a legacy URL, one holding none. When `refuseReader`
 * is set, a middleware refuses every non-system `sys_file` read the way the
 * security layer's CRUD gate does, and records each read it refuses in
 * `attempts` (the reads plugin-security would log a denial for). `security`,
 * when given, is what the engine's security-service slot resolves.
 */
async function boot(opts: { sysFileRead?: () => Promise<any[]>; refuseReader?: boolean; security?: unknown } = {}) {
  const logger = makeCapturingLogger();
  const engine = new ObjectQL({ logger } as any);
  const { driver, storeFor } = makeDriver(opts.sysFileRead ?? (async () => COMMITTED_ROWS));
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'doc',
    fields: {
      title: { type: 'text' },
      attachment: { type: 'file' },
      gallery: { type: 'image', multiple: true },
    },
  } as any);
  engine.registry.registerObject({
    name: 'sys_file',
    fields: {
      name: { type: 'text' },
      size: { type: 'number' },
      mime_type: { type: 'text' },
      status: { type: 'text' },
    },
  } as any);
  const attempts: any[] = [];
  if (opts.security !== undefined) {
    (engine as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT] = () => opts.security;
  }
  if (opts.refuseReader) {
    engine.registerMiddleware(
      async (ctx: any, next: () => Promise<void>) => {
        if (!ctx.context?.isSystem) {
          attempts.push(ctx.context);
          throw refusal();
        }
        return next();
      },
      { object: 'sys_file' },
    );
  }
  storeFor('doc').set('d1', { id: 'd1', title: 'Contract', attachment: FILE_ID, gallery: null });
  storeFor('doc').set('d2', {
    id: 'd2',
    title: 'Bundle',
    attachment: null,
    gallery: [FILE_ID, SECOND_ID, 'https://cdn.example.com/legacy.png'],
  });
  storeFor('doc').set('d3', { id: 'd3', title: 'Empty', attachment: null, gallery: null });
  return { engine, logger, attempts };
}

const byId = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe('a refused sys_file read marks the file field refused — not absent', () => {
  it('a reader refused sys_file reads each held file as { id, metadataRefused: true }', async () => {
    const { engine } = await boot({ refuseReader: true });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d1.attachment).toEqual({ id: FILE_ID, metadataRefused: true });
    // Multi-value: every id is marked; a legacy URL string is not an id and
    // passes through untouched, exactly as the hydration path leaves it.
    expect(rows.d2.gallery).toEqual([
      { id: FILE_ID, metadataRefused: true },
      { id: SECOND_ID, metadataRefused: true },
      'https://cdn.example.com/legacy.png',
    ]);
    // The record read itself still succeeds — fail-open is unchanged.
    expect(rows.d1.title).toBe('Contract');
  });

  it('findOne serves the same refused marker', async () => {
    const { engine } = await boot({ refuseReader: true });

    const row = await engine.findOne('doc', { where: { id: 'd1' }, context: READER_CTX });

    expect(row?.attachment).toEqual({ id: FILE_ID, metadataRefused: true });
  });

  it('the served value is the declared refused form of the expanded file contract', async () => {
    const { engine } = await boot({ refuseReader: true });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(FileRefusedValueSchema.safeParse(rows.d1.attachment).success).toBe(true);
    expect(valueSchemaFor({ type: 'file' }, 'expanded').safeParse(rows.d1.attachment).success).toBe(true);
    // The two marked ids of the multi-value field (its third entry is the
    // fixture's legacy URL, which no contract form admits and nothing rewrites).
    expect(valueSchemaFor({ type: 'image', multiple: true }, 'expanded').safeParse(rows.d2.gallery.slice(0, 2)).success)
      .toBe(true);
    // …and it carries nothing that was not read.
    expect(Object.keys(rows.d1.attachment).sort()).toEqual(['id', 'metadataRefused']);
  });

  it('the refusal is handed to the caller, so it costs no warn — one debug line names it', async () => {
    const { engine, logger } = await boot({ refuseReader: true });

    await engine.find('doc', { context: READER_CTX });

    expect(logger.lines.warn).toEqual([]);
    expect(logger.lines.error).toEqual([]);
    const refused = logger.lines.debug.filter((l: any) => /sys_file read refused/.test(l.msg));
    expect(refused).toHaveLength(1);
    expect(refused[0].meta).toMatchObject({ object: 'doc', fields: ['attachment', 'gallery'], refusedIds: 2 });
  });

  it('CONTROL a record with no file still reads empty for the refused reader', async () => {
    const { engine } = await boot({ refuseReader: true });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d3.attachment).toBeNull();
    expect(rows.d3.gallery).toBeNull();
    expect(rows.d2.attachment).toBeNull();
  });

  it('CONTROL a reader allowed to read sys_file gets the hydrated file', async () => {
    const { engine, logger } = await boot({ refuseReader: true });

    const rows = byId(await engine.find('doc', { context: SYSTEM_CTX }));

    expect(rows.d1.attachment).toEqual({
      id: FILE_ID,
      name: 'contract.pdf',
      size: 1024,
      mimeType: 'application/pdf',
      url: `/api/v1/storage/files/${FILE_ID}`,
    });
    expect(logger.lines.warn).toEqual([]);
  });

  it('CONTROL a missing sys_file table still reads the bare id, silently', async () => {
    const { engine, logger } = await boot({
      sysFileRead: async () => {
        throw Object.assign(new Error('relation "sys_file" does not exist'), { code: '42P01' });
      },
    });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d1.attachment).toBe(FILE_ID);
    expect(logger.lines.warn).toEqual([]);
    expect(logger.lines.debug.filter((l: any) => /sys_file read refused/.test(l.msg))).toEqual([]);
  });

  it('CONTROL a database-level ACL fault is an outage, not this caller\'s refusal — bare id and the seam warn', async () => {
    const { engine, logger } = await boot({
      sysFileRead: async () => {
        throw Object.assign(new Error('permission denied for table sys_file'), { code: '42501' });
      },
    });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d1.attachment).toBe(FILE_ID);
    const seam = logger.lines.warn.filter((l: any) => l.msg.startsWith('sys_file lookup failed'));
    expect(seam).toHaveLength(1);
    expect(logger.lines.debug.filter((l: any) => /sys_file read refused/.test(l.msg))).toEqual([]);
  });
});

/**
 * A security service the engine's slot resolves, answering `canReadObject` as
 * `admits` says (the fixture's middleware refuses every non-system reader, so
 * `false` is the true answer for READER_CTX), and recording every ask.
 */
function makeSecurity(admits: (object: string, context: any) => boolean | Promise<boolean>) {
  const asks: Array<{ object: string; context: any }> = [];
  const svc: Record<string, unknown> = {
    getReadFilter: async () => undefined,
    canReadObject: async (object: string, context: any) => {
      asks.push({ object, context });
      return admits(object, context);
    },
  };
  return { svc, asks };
}

describe('[#24335] the engine asks before it reads sys_file — a refused reader makes no access attempt', () => {
  it('a reader the admission refuses is served the refused arm and never reaches the sys_file read', async () => {
    const { svc, asks } = makeSecurity((_o, ctx) => ctx?.isSystem === true);
    const { engine, attempts } = await boot({ refuseReader: true, security: svc });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    // No read of sys_file reached the security layer: nothing for it to log.
    expect(attempts).toEqual([]);
    expect(rows.d1.attachment).toEqual({ id: FILE_ID, metadataRefused: true });
    // One ask per read, about sys_file, with the caller's own envelope.
    expect(asks).toHaveLength(1);
    expect(asks[0].object).toBe('sys_file');
    expect(asks[0].context).toMatchObject(READER_CTX);
    expect(Object.keys(asks[0].context).filter((k) => k.startsWith('__'))).toEqual([]);
  });

  it('the body is byte-identical to the one the refused read served, by list and by id', async () => {
    const asked = await boot({ refuseReader: true, security: makeSecurity(() => false).svc });
    const unasked = await boot({ refuseReader: true });

    const listAsked = await asked.engine.find('doc', { context: READER_CTX });
    const listUnasked = await unasked.engine.find('doc', { context: READER_CTX });
    const oneAsked = await asked.engine.findOne('doc', { where: { id: 'd2' }, context: READER_CTX });
    const oneUnasked = await unasked.engine.findOne('doc', { where: { id: 'd2' }, context: READER_CTX });

    // The comparison is armed: the unasked engine did attempt, and was refused.
    expect(unasked.attempts.length).toBeGreaterThan(0);
    expect(asked.attempts).toEqual([]);
    expect(oneAsked?.gallery?.[0]).toEqual({ id: FILE_ID, metadataRefused: true });
    expect(JSON.stringify(listAsked)).toBe(JSON.stringify(listUnasked));
    expect(JSON.stringify(oneAsked)).toBe(JSON.stringify(oneUnasked));
  });

  it('the reader\'s own sys_file read is still refused, and still reaches the security layer', async () => {
    const { engine, attempts } = await boot({ refuseReader: true, security: makeSecurity(() => false).svc });

    const err = await engine.find('sys_file', { context: READER_CTX }).catch((e: unknown) => e);

    expect((err as any)?.code).toBe('PERMISSION_DENIED');
    expect((err as any)?.statusCode).toBe(403);
    expect(attempts).toHaveLength(1);
  });

  it('CONTROL a reader the admission admits still reads sys_file as itself, and is hydrated', async () => {
    const { svc, asks } = makeSecurity(() => true);
    const { engine } = await boot({ security: svc });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(asks).toHaveLength(1);
    expect(rows.d1.attachment).toEqual({
      id: FILE_ID,
      name: 'contract.pdf',
      size: 1024,
      mimeType: 'application/pdf',
      url: `/api/v1/storage/files/${FILE_ID}`,
    });
  });

  it('CONTROL an admitted read the security layer still refuses takes the same refused arm', async () => {
    const { engine, attempts } = await boot({ refuseReader: true, security: makeSecurity(() => true).svc });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(attempts).toHaveLength(1);
    expect(rows.d1.attachment).toEqual({ id: FILE_ID, metadataRefused: true });
  });

  it('CONTROL unasked — no canReadObject, or an ask that throws — the read goes to the security layer as before', async () => {
    const noMethod = await boot({ refuseReader: true, security: { getReadFilter: async () => undefined } });
    const throwing = await boot({
      refuseReader: true,
      security: makeSecurity(() => {
        throw new Error('admission unavailable');
      }).svc,
    });

    for (const { engine, attempts } of [noMethod, throwing]) {
      const rows = byId(await engine.find('doc', { context: READER_CTX }));
      expect(attempts).toHaveLength(1);
      expect(rows.d1.attachment).toEqual({ id: FILE_ID, metadataRefused: true });
    }
  });

  it('CONTROL a record holding no file id asks nothing', async () => {
    const { svc, asks } = makeSecurity(() => false);
    const { engine } = await boot({ refuseReader: true, security: svc });

    const row = await engine.findOne('doc', { where: { id: 'd3' }, context: READER_CTX });

    expect(row?.id).toBe('d3');
    expect(asks).toEqual([]);
  });
});
