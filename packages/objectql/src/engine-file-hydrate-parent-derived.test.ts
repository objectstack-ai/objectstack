// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A reader refused `sys_file` read still gets the metadata of a file the
 * record being read OWNS — by the download door's own field-owned verdict
 * (#22637, maintainer ruling B on #22624).
 *
 * `resolveFileReferences` reads `sys_file` as the caller. A reader who may
 * read the record but not `sys_file` is refused that sub-read, and since
 * #22620 each id then reads `{ id, metadataRefused: true }`. That refusal is
 * about `sys_file` as an object; ADR-0104 D3 judges a field-owned file by its
 * owning record, and the download door already serves the bytes on that
 * verdict. The ruling: "a file field's metadata follows the parent-derived
 * verdict the download door already applies".
 *
 * The verdict is NOT the engine's — it is the storage package's field-owned
 * arm, handed over through `registerFieldOwnedFileReadAuthorizer`. This file
 * holds the engine's half with a stand-in verdict (a recorded fake), a fake
 * DRIVER (not a fake engine) and an engine middleware standing in for the
 * security layer's refusal, exactly as `engine-file-hydrate-refused.test.ts`
 * does. The storage package's `field-owned-file-hydration-door-agreement.test.ts`
 * pins the two surfaces against each other with the real verdict wired by the
 * real plugin.
 *
 * What the engine owns, and so what is pinned here:
 *
 *   - which ids are put to the verdict: only those whose `ref_object` /
 *     `ref_id` name a record in this result, per element and per record;
 *   - that the verdict is asked once, with the caller's envelope minus its
 *     operation-private keys;
 *   - that everything the verdict does not allow keeps the refused marker,
 *     and every failure leaves the marker with one `warn`;
 *   - that an unwired engine is exactly #22620's engine.
 */

import { describe, it, expect } from 'vitest';
import { FileValueSchema, valueSchemaFor } from '@objectstack/spec/data';
import { ObjectQL } from './engine';

/** Owned by `d1.attachment`. */
const OWNED = 'f_owned_1aa';
/** Owned by `d2.gallery`. */
const OWNED_MULTI = 'f_owned_2bb';
/** Owned by a record of this object that is NOT in the result (`d9`) — copied into `d2.gallery`. */
const FOREIGN = 'f_foreign_3cc';
/** No field owner at all: an attachments-scope file, held only by a `sys_attachment` row. */
const ATTACHMENT_ONLY = 'f_attach_4dd';
/** Owned by `d4.attachment` — a tombstone the holder check answers for. */
const TOMBSTONE_OWNED = 'f_tomb_5ee';
/** Owned by `d5.attachment`, never completed. */
const PENDING_OWNED = 'f_pending_6ff';
/** Owned by a record of ANOTHER object with the same id as `d1`. */
const OTHER_OBJECT = 'f_otherobj_7gg';

const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  size: 2048,
  mime_type: 'application/pdf',
  status: 'committed',
  ref_object: null,
  ref_id: null,
  ...extra,
});

const SYS_FILE_ROWS = [
  row(OWNED, 'owned.pdf', { ref_object: 'doc', ref_id: 'd1' }),
  row(OWNED_MULTI, 'gallery.pdf', { ref_object: 'doc', ref_id: 'd2' }),
  row(FOREIGN, 'foreign.pdf', { ref_object: 'doc', ref_id: 'd9' }),
  row(ATTACHMENT_ONLY, 'attached.pdf'),
  row(TOMBSTONE_OWNED, 'tomb.pdf', { status: 'deleted', ref_object: 'doc', ref_id: 'd4' }),
  row(PENDING_OWNED, 'pending.pdf', { status: 'pending', ref_object: 'doc', ref_id: 'd5' }),
  row(OTHER_OBJECT, 'other.pdf', { ref_object: 'other_doc', ref_id: 'd1' }),
];

const hydrated = (id: string, name: string) => ({
  id,
  name,
  size: 2048,
  mimeType: 'application/pdf',
  url: `/api/v1/storage/files/${id}`,
});
const refused = (id: string) => ({ id, metadataRefused: true });

/** The refusal the security layer throws — `PermissionDeniedError`'s declared envelope. */
const refusal = () =>
  Object.assign(
    new Error('You do not have permission to perform this action. Contact your administrator if you need access.'),
    { name: 'PermissionDeniedError', code: 'PERMISSION_DENIED', status: 403, statusCode: 403 },
  );

const SYSTEM_CTX = { isSystem: true, userId: 'usr_system' };
const READER_CTX = { userId: 'usr_reader', tenantId: 'org_1' };

/**
 * The fixture's one where-matcher: equality and `$in` — the two shapes the
 * engine's reads here issue — refusing every other shape loudly, so an
 * operator it does not implement can never read as a row that happened not to
 * match.
 */
function matchesWhere(r: Record<string, unknown>, where: unknown): boolean {
  for (const [field, cond] of Object.entries((where ?? {}) as Record<string, unknown>)) {
    if (field.startsWith('$')) throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    if (cond !== null && typeof cond === 'object') {
      const inList = (cond as { $in?: unknown }).$in;
      if (Object.keys(cond as object).length !== 1 || !Array.isArray(inList)) {
        throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
      }
      if (!inList.map(String).includes(String(r[field]))) return false;
      continue;
    }
    if (r[field] !== cond) return false;
  }
  return true;
}

/**
 * A driver over an in-memory store that honours `where` and a `fields`
 * projection — a projection that leaves `id` out really leaves it out, as
 * `SqlDriver` does. Every `sys_file` read it serves is recorded.
 */
function makeDriver(opts: { sysFileRead?: () => Promise<any[]> } = {}) {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (object: string) => {
    if (!stores.has(object)) stores.set(object, new Map());
    return stores.get(object)!;
  };
  const sysFileQueries: any[] = [];
  const project = (r: any, fields?: string[]) =>
    Array.isArray(fields) && fields.length > 0 ? Object.fromEntries(fields.filter((f) => f in r).map((f) => [f, r[f]])) : { ...r };
  const read = async (object: string, query: any) => {
    if (object === 'sys_file') {
      sysFileQueries.push(query);
      if (opts.sysFileRead) return opts.sysFileRead();
    }
    return [...storeFor(object).values()].filter((r) => matchesWhere(r, query?.where)).map((r) => project(r, query?.fields));
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
    find: read,
    async findOne(object: string, query: any) {
      return (await read(object, query))[0] ?? null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const id = (data.id as string) ?? `r_${storeFor(object).size + 1}`;
      const r = { ...data, id };
      storeFor(object).set(id, r);
      return r;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const r = { ...storeFor(object).get(id), ...data, id };
      storeFor(object).set(id, r);
      return r;
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
  return { driver, storeFor, sysFileQueries };
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

type Verdict = (ownerObject: string, ownerIds: string[], context: any) => Promise<Set<string>>;

/**
 * Boots an engine with a `doc` object (one single and one multi-value file
 * field), a registered `sys_file` carrying the ownership pair, a middleware
 * that refuses every non-system `sys_file` read the way the security layer's
 * CRUD gate does, and — unless `verdict` is `null` — a recorded stand-in for
 * the storage plugin's field-owned verdict, allowing `allow` (default: every
 * owner it is asked about).
 */
async function boot(opts: {
  verdict?: Verdict | null;
  allow?: string[];
  sysFileRead?: () => Promise<any[]>;
  held?: string[];
} = {}) {
  const logger = makeCapturingLogger();
  const engine = new ObjectQL({ logger } as any);
  const { driver, storeFor, sysFileQueries } = makeDriver({ sysFileRead: opts.sysFileRead });
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
      ref_object: { type: 'text' },
      ref_id: { type: 'text' },
    },
  } as any);
  engine.registerMiddleware(
    async (ctx: any, next: () => Promise<void>) => {
      if (!ctx.context?.isSystem) throw refusal();
      return next();
    },
    { object: 'sys_file' },
  );

  const calls: Array<{ ownerObject: string; ownerIds: string[]; context: any }> = [];
  if (opts.verdict !== null) {
    const verdict: Verdict = opts.verdict ?? (async (_o, ownerIds) =>
      new Set(ownerIds.filter((id) => (opts.allow ?? ownerIds).includes(id))));
    engine.registerFieldOwnedFileReadAuthorizer(async (ownerObject, ownerIds, context) => {
      calls.push({ ownerObject, ownerIds: [...ownerIds], context });
      return verdict(ownerObject, ownerIds, context);
    });
  }
  if (opts.held) {
    const held = new Set(opts.held);
    engine.registerHeldFileResolver(async (rows) => new Set(rows.map((r) => String(r.id)).filter((id) => held.has(id))));
  }

  for (const r of SYS_FILE_ROWS) storeFor('sys_file').set(r.id, { ...r });
  storeFor('doc').set('d1', { id: 'd1', title: 'Owner', attachment: OWNED, gallery: null });
  storeFor('doc').set('d2', {
    id: 'd2',
    title: 'Mixed',
    attachment: null,
    gallery: [OWNED_MULTI, FOREIGN, ATTACHMENT_ONLY, 'https://cdn.example.com/legacy.png'],
  });
  // The id d1 owns, copied into a second record.
  storeFor('doc').set('d3', { id: 'd3', title: 'Copy', attachment: OWNED, gallery: null });
  storeFor('doc').set('d4', { id: 'd4', title: 'Tombstone', attachment: TOMBSTONE_OWNED, gallery: null });
  storeFor('doc').set('d5', { id: 'd5', title: 'Pending', attachment: PENDING_OWNED, gallery: null });
  storeFor('doc').set('d6', { id: 'd6', title: 'Other object', attachment: OTHER_OBJECT, gallery: null });
  storeFor('doc').set('d7', { id: 'd7', title: 'Empty', attachment: null, gallery: null });
  return { engine, logger, calls, sysFileQueries };
}

const byId = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe('a refused sys_file read still hydrates a file the record being read owns, by the download door\'s verdict', () => {
  it('a field-owned file on the record being read hydrates in full for a reader refused sys_file read', async () => {
    const { engine } = await boot();

    const rows = byId(await engine.find('doc', { context: READER_CTX }));
    expect(rows.d1.attachment).toEqual(hydrated(OWNED, 'owned.pdf'));

    const one = await engine.findOne('doc', { where: { id: 'd1' }, context: READER_CTX });
    expect(one?.attachment).toEqual(hydrated(OWNED, 'owned.pdf'));
  });

  it('the served value is the declared expanded file form, carrying exactly what a sys_file reader gets', async () => {
    const { engine } = await boot();

    const asReader = byId(await engine.find('doc', { context: READER_CTX })).d1.attachment;
    const asFileReader = byId(await engine.find('doc', { context: SYSTEM_CTX })).d1.attachment;

    expect(FileValueSchema.safeParse(asReader).success).toBe(true);
    expect(valueSchemaFor({ type: 'file' }, 'expanded').safeParse(asReader).success).toBe(true);
    expect(asReader).toEqual(asFileReader);
  });

  it('the same id copied into another record keeps the refused marker there — the verdict covers the owning record only', async () => {
    const { engine } = await boot();

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d1.attachment).toEqual(hydrated(OWNED, 'owned.pdf'));
    expect(rows.d3.attachment).toEqual(refused(OWNED));
  });

  it('multi-value: each element is judged on its own — owned hydrates, a copied id and an attachment-only file stay refused', async () => {
    const { engine } = await boot();

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d2.gallery).toEqual([
      hydrated(OWNED_MULTI, 'gallery.pdf'),
      refused(FOREIGN),
      refused(ATTACHMENT_ONLY),
      'https://cdn.example.com/legacy.png',
    ]);
  });

  it('a file owned by a record of ANOTHER object with the same id is not this record\'s file', async () => {
    const { engine } = await boot();

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d6.attachment).toEqual(refused(OTHER_OBJECT));
  });

  it('a verdict that refuses the owner record keeps the marker', async () => {
    const { engine } = await boot({ allow: ['d2'] });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d1.attachment).toEqual(refused(OWNED));
    expect(rows.d2.gallery[0]).toEqual(hydrated(OWNED_MULTI, 'gallery.pdf'));
  });

  it('the verdict is asked ONCE per read, for the owner records only, with the caller\'s envelope minus its operation-private keys', async () => {
    const { engine, calls, sysFileQueries } = await boot();

    await engine.find('doc', {
      context: { ...READER_CTX, __readScope: 'org', __expandRead: true } as any,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].ownerObject).toBe('doc');
    // Only records that own one of the held ids: d1, d2, d4, d5 — never d3
    // (holds a copy), d6 (another object owns its file) or d7 (no file).
    expect([...calls[0].ownerIds].sort()).toEqual(['d1', 'd2', 'd4', 'd5']);
    expect(calls[0].context).toMatchObject({ userId: 'usr_reader', tenantId: 'org_1' });
    expect(Object.keys(calls[0].context).filter((k) => k.startsWith('__'))).toEqual([]);
    expect(calls[0].context.isSystem).toBeUndefined();

    // ONE sys_file read reached the driver — the system read; the caller's own
    // was refused before it. Its `where` asks for the ownership pair itself.
    expect(sysFileQueries).toHaveLength(1);
    expect(sysFileQueries[0].where).toMatchObject({ ref_object: 'doc' });
    expect(sysFileQueries[0].where.ref_id.$in.map(String).sort()).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']);
  });

  it('an owned, allowed tombstone hydrates when something still holds it, and a pending upload reads as its bare id — as for a sys_file reader', async () => {
    const { engine } = await boot({ held: [TOMBSTONE_OWNED] });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));
    const asFileReader = byId(await engine.find('doc', { context: SYSTEM_CTX }));

    expect(rows.d4.attachment).toEqual(hydrated(TOMBSTONE_OWNED, 'tomb.pdf'));
    expect(rows.d5.attachment).toBe(PENDING_OWNED);
    expect(rows.d4.attachment).toEqual(asFileReader.d4.attachment);
    expect(rows.d5.attachment).toEqual(asFileReader.d5.attachment);
  });

  it('a read whose projection leaves out id cannot name its owner record, so every id keeps the marker', async () => {
    const { engine, calls } = await boot();

    const rows = await engine.find('doc', { fields: ['attachment'], context: READER_CTX } as any);

    expect(rows.find((r: any) => r.attachment?.id === OWNED && !r.attachment.metadataRefused)).toBeUndefined();
    expect(rows.filter((r: any) => r.attachment != null)).toContainEqual({ attachment: refused(OWNED) });
    expect(calls).toEqual([]);
  });

  it('the happy path costs no warn; the one debug line counts what the verdict allowed', async () => {
    const { engine, logger } = await boot();

    await engine.find('doc', { context: READER_CTX });

    expect(logger.lines.warn).toEqual([]);
    expect(logger.lines.error).toEqual([]);
    const refusedLines = logger.lines.debug.filter((l: any) => /sys_file read refused/.test(l.msg));
    expect(refusedLines).toHaveLength(1);
    // The four owned ids the verdict allowed (d1's, d2's, d4's, d5's), servable or not.
    expect(refusedLines[0].meta).toMatchObject({ object: 'doc', refusedIds: 7, parentDerivedIds: 4 });
  });
});

describe('everything the parent-derived verdict cannot reach keeps #22620\'s refused marker', () => {
  it('UNWIRED: with no verdict registered every id stays refused — the engine before the seam', async () => {
    const { engine, sysFileQueries } = await boot({ verdict: null });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d1.attachment).toEqual(refused(OWNED));
    expect(rows.d2.gallery.slice(0, 3)).toEqual([refused(OWNED_MULTI), refused(FOREIGN), refused(ATTACHMENT_ONLY)]);
    // …and it costs nothing: no system read was issued.
    expect(sysFileQueries).toEqual([]);
  });

  it('a failing system read leaves every id refused, the record read succeeds, and one warn names the check', async () => {
    const { engine, logger, calls } = await boot({
      sysFileRead: async () => {
        throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
      },
    });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d1.attachment).toEqual(refused(OWNED));
    expect(rows.d1.title).toBe('Owner');
    expect(calls).toEqual([]);
    const warns = logger.lines.warn.filter((l: any) => l.msg.startsWith('sys_file parent-derived check failed'));
    expect(warns).toHaveLength(1);
    expect(warns[0].meta).toMatchObject({ object: 'doc', error: 'connection reset' });
  });

  it('a verdict that throws leaves every id refused, with the same one warn', async () => {
    const { engine, logger } = await boot({
      verdict: async () => {
        throw new Error('delegate registry unavailable');
      },
    });

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d1.attachment).toEqual(refused(OWNED));
    expect(rows.d2.gallery[0]).toEqual(refused(OWNED_MULTI));
    expect(logger.lines.warn.filter((l: any) => l.msg.startsWith('sys_file parent-derived check failed'))).toHaveLength(1);
  });

  it('CONTROL a reader allowed to read sys_file is served by its own read — the verdict is never asked', async () => {
    const { engine, calls } = await boot();

    const rows = byId(await engine.find('doc', { context: SYSTEM_CTX }));

    expect(rows.d1.attachment).toEqual(hydrated(OWNED, 'owned.pdf'));
    expect(rows.d3.attachment).toEqual(hydrated(OWNED, 'owned.pdf'));
    expect(calls).toEqual([]);
  });

  it('CONTROL a direct sys_file query by the refused reader is still refused', async () => {
    const { engine } = await boot();

    const direct = await engine.find('sys_file', { context: READER_CTX }).then(() => null, (e: any) => e);

    expect({ code: direct?.code, status: direct?.statusCode ?? direct?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('CONTROL a record with no file still reads empty', async () => {
    const { engine } = await boot();

    const rows = byId(await engine.find('doc', { context: READER_CTX }));

    expect(rows.d7.attachment).toBeNull();
    expect(rows.d7.gallery).toBeNull();
  });
});
