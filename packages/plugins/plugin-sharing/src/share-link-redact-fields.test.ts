// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29130] A share link's `redactFields` entries must name columns of the
 * object, or nothing is minted.
 *
 * The mint stored the list as sent. At resolve the per-link list is unioned
 * with the object policy's and applied as names, so an entry matching no
 * column stripped nothing, while the merged list — the unknown entry included
 * — was handed to the landing page, which prints it as the set of hidden
 * fields. One misspelling served the field the minter meant to keep back under
 * a notice saying it was withheld.
 *
 * The column set an entry is judged against is the one a read SERVES
 * (`declaredColumnSet` from `@objectstack/objectql/core`: the registry's field
 * map plus the platform-provisioned columns), so the fake schemas below are
 * shaped like the registry's — `id` is NOT in the field map, as it is not in a
 * registered object's.
 *
 * ⛔ No bare `toThrow()`: a refusal is pinned on its `status` + `code` and on
 * the row never being written.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { buildShareLinkResolveAnswer } from '@objectstack/types';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { ShareLinkService } from './share-link-service.js';
import { registerShareLinkRoutes } from './share-link-routes.js';

interface FakeRow { [k: string]: any }

const SCHEMAS: Record<string, any> = {
  sys_share_link: { name: 'sys_share_link', fields: { token: {} } },
  doc: {
    name: 'doc',
    publicSharing: { enabled: true, redactFields: ['notes'] },
    fields: { title: {}, body: {}, notes: {}, created_at: {}, owner_id: {} },
  },
  // An object that opts out of the injected audit columns: the timestamps are
  // still provisioned (and served), they are just not in the field map.
  bare: {
    name: 'bare',
    publicSharing: { enabled: true },
    fields: { title: {}, body: {} },
  },
  // No checkable field map: the mint gives no verdict on the names.
  unmapped: { name: 'unmapped', publicSharing: { enabled: true } },
};

function makeEngine() {
  const tables: Record<string, FakeRow[]> = {
    doc: [{ id: 'd1', title: 'Plan', body: 'the withheld text', notes: 'n', created_at: '2026-01-01' }],
    bare: [{ id: 'r1', title: 'T', body: 's', created_at: '2026-01-01', updated_at: '2026-01-02' }],
    unmapped: [{ id: 'u1', title: 'T' }],
    sys_share_link: [],
  };
  return {
    tables,
    getSchema: (name: string) => SCHEMAS[name],
    async find(object: string, options?: any) {
      const where = options?.where ?? {};
      const rows = (tables[object] ?? []).filter((r) => Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
        return r[k] === v;
      }));
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    async insert(object: string, data: any) { (tables[object] ??= []).push({ ...data }); return data; },
    async update(object: string, data: any, options?: any) {
      const verdict = assertEngineUpdateDispatch(data, options);
      const targets = verdict.kind === 'by-id' ? (tables[object] ?? []).filter((r) => r.id === verdict.id) : [];
      for (const r of targets) Object.assign(r, data);
      return verdict.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(_object: string, options?: any) {
      assertEngineDeleteDispatch(options);
      return { ok: true };
    },
  };
}

async function refusal(promise: Promise<unknown>): Promise<{ status?: number; code?: string; message: string }> {
  try {
    await promise;
  } catch (err: any) {
    return { status: err.status, code: err.code, message: String(err.message) };
  }
  throw new Error('expected the mint to be refused, it was accepted');
}

describe('[#29130] share-link mint — redactFields must name columns of the object', () => {
  let engine: ReturnType<typeof makeEngine>;
  let service: ShareLinkService;

  beforeEach(() => {
    engine = makeEngine();
    service = new ShareLinkService({ engine: engine as any });
  });

  it('refuses an entry naming no column: 400 VALIDATION_FAILED naming it, and nothing is minted', async () => {
    const err = await refusal(
      service.createLink({ object: 'doc', recordId: 'd1', redactFields: ['bdoy'] }, { userId: 'u1' } as any),
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toContain('bdoy');
    expect(engine.tables.sys_share_link).toHaveLength(0);
  });

  it('names every unknown entry, and only those, when valid and unknown names are mixed', async () => {
    const err = await refusal(
      service.createLink(
        { object: 'doc', recordId: 'd1', redactFields: ['body', 'bdoy', 'titel', 'bdoy'] },
        { userId: 'u1' } as any,
      ),
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toContain('bdoy, titel');
    expect(err.message).not.toMatch(/\bbody\b/);
    expect(engine.tables.sys_share_link).toHaveLength(0);
  });

  it('refuses a redactFields that is not an array of names, and nothing is minted', async () => {
    for (const redactFields of ['body', [42], { body: true }]) {
      const err = await refusal(
        service.createLink({ object: 'doc', recordId: 'd1', redactFields: redactFields as any }, { userId: 'u1' } as any),
      );
      expect(err.status).toBe(400);
      expect(err.code).toBe('VALIDATION_FAILED');
    }
    expect(engine.tables.sys_share_link).toHaveLength(0);
  });

  it('mints a valid name, and resolve withholds that field from the record it serves', async () => {
    const link = await service.createLink(
      { object: 'doc', recordId: 'd1', redactFields: ['body'] },
      { userId: 'u1' } as any,
    );
    expect(engine.tables.sys_share_link).toHaveLength(1);
    expect(engine.tables.sys_share_link[0].redact_fields).toEqual(['body']);

    const resolved = await service.resolveToken(link.token, {});
    expect(resolved).not.toBeNull();
    expect(resolved!.redactFields.sort()).toEqual(['body', 'notes']);
    const answer = buildShareLinkResolveAnswer(engine.tables.doc[0], resolved!, SCHEMAS.doc) as any;
    expect(answer.record).not.toHaveProperty('body');
    expect(answer.record.title).toBe('Plan');
  });

  it('accepts the platform-provisioned columns a read serves, though the field map omits them', async () => {
    await service.createLink({ object: 'doc', recordId: 'd1', redactFields: ['id', 'created_at', 'owner_id'] }, { userId: 'u1' } as any);
    await service.createLink({ object: 'bare', recordId: 'r1', redactFields: ['created_at', 'updated_at'] }, { userId: 'u1' } as any);
    expect(engine.tables.sys_share_link.map((r) => r.redact_fields)).toEqual([
      ['id', 'created_at', 'owner_id'],
      ['created_at', 'updated_at'],
    ]);
  });

  it('keeps an omitted or empty list as no per-link redaction', async () => {
    await service.createLink({ object: 'doc', recordId: 'd1' }, { userId: 'u1' } as any);
    await service.createLink({ object: 'doc', recordId: 'd1', redactFields: [] }, { userId: 'u1' } as any);
    expect(engine.tables.sys_share_link.map((r) => r.redact_fields)).toEqual([null, null]);
  });

  it('gives no verdict when the object has no checkable field map, and keeps the entries as sent', async () => {
    await service.createLink({ object: 'unmapped', recordId: 'u1', redactFields: ['anything'] }, { userId: 'u1' } as any);
    expect(engine.tables.sys_share_link[0].redact_fields).toEqual(['anything']);
  });

  it('refuses a malformed list with the request-shape checks, before any record is read', async () => {
    const reads: string[] = [];
    const find = engine.find.bind(engine);
    engine.find = async (object: string, options?: any) => { reads.push(object); return find(object, options); };
    const err = await refusal(
      service.createLink({ object: 'doc', recordId: 'missing', redactFields: 'body' as any }, { userId: 'u1' } as any),
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(reads).toEqual([]);
  });

  it('answers a caller with no authority over the record 403 before judging the names', async () => {
    const err = await refusal(
      service.createLink({ object: 'doc', recordId: 'missing', redactFields: ['bdoy'] }, { userId: 'u1' } as any),
    );
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).not.toContain('bdoy');
  });
});

describe('[#29130] share-link REST door — the mint refusal reaches the caller as its envelope', () => {
  function mountCreate(service: ShareLinkService, engine: ReturnType<typeof makeEngine>): RouteHandler {
    const routes = new Map<string, RouteHandler>();
    const http = {
      get: (p: string, h: RouteHandler) => { routes.set(`GET ${p}`, h); },
      post: (p: string, h: RouteHandler) => { routes.set(`POST ${p}`, h); },
      put: () => {},
      delete: () => {},
      patch: () => {},
      use: () => {},
      listen: async () => {},
      close: async () => {},
    };
    registerShareLinkRoutes(http as any, service, engine as any, { contextFromRequest: () => ({ userId: 'u1' }) as any });
    const handler = routes.get('POST /api/v1/share-links');
    if (!handler) throw new Error('fixture: no create handler');
    return handler;
  }

  async function post(handler: RouteHandler, body: unknown) {
    const captured = { status: 200, body: undefined as any };
    const res: any = {
      json(data: any) { captured.body = data; },
      send() {},
      status(code: number) { captured.status = code; return res; },
      header() { return res; },
    };
    const url = '/api/v1/share-links';
    await handler({ params: {}, query: {}, body, headers: {}, method: 'POST', path: url, url } as unknown as IHttpRequest, res as IHttpResponse);
    return captured;
  }

  it('POST with an unknown redactFields entry answers 400 VALIDATION_FAILED and stores no row', async () => {
    const engine = makeEngine();
    const handler = mountCreate(new ShareLinkService({ engine: engine as any }), engine);
    const res = await post(handler, { object: 'doc', recordId: 'd1', redactFields: ['bdoy'] });
    expect(res.status).toBe(400);
    expect(res.body?.success).toBe(false);
    expect(res.body?.error?.code).toBe('VALIDATION_FAILED');
    expect(engine.tables.sys_share_link).toHaveLength(0);
  });

  it('POST with a valid entry still answers 201 and stores it', async () => {
    const engine = makeEngine();
    const handler = mountCreate(new ShareLinkService({ engine: engine as any }), engine);
    const res = await post(handler, { object: 'doc', recordId: 'd1', redactFields: ['body'] });
    expect(res.status).toBe(201);
    expect(engine.tables.sys_share_link[0].redact_fields).toEqual(['body']);
  });
});
