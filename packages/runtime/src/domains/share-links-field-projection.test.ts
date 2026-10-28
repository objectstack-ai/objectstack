// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26991] A share link's resolve answer carries the display projection of
 * exactly the fields it returns — ONE table, BOTH mounts.
 *
 * `GET /share-links/:token/resolve` has two mounts: plugin-sharing's
 * `registerShareLinkRoutes` (the standalone server's) and this package's
 * dispatcher twin `handleShareLinksRequest` (cloud's per-environment kernels).
 * Its visitor is anonymous by design, and `GET /meta/object/NAME` refuses an
 * anonymous caller, so the answer itself is the only place the shared-record
 * page can read a field's authored label, type, picklist option labels and
 * the currency and lookup display bits from. Both mounts build the answer
 * through the one `buildShareLinkResolveAnswer` (`@objectstack/types`).
 *
 * ## What it pins
 *
 * - `fields` lists exactly the served record's keys that are fields of the
 *   shared object — no other field of that object, and nothing the record
 *   does not carry.
 * - A redacted field is absent from BOTH `record` and `fields`; with no
 *   redaction, the same field is present in both (the control).
 * - A field the record read never returns (`internal: true`) is absent from
 *   both.
 * - A lookup's value is the stored id (the record read expands nothing), and
 *   its projection names the target object and the authored display field.
 * - Both mounts answer the same `data`, byte for byte.
 *
 * ## What is real here
 *
 * Both mounts' production entries over ONE `ObjectQL` on
 * `@objectstack/driver-sql` + better-sqlite3 and ONE `ShareLinkService`, the
 * harness `share-links-refusal-order.test.ts` uses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { ShareLinkService, SysShareLink, registerShareLinkRoutes } from '@objectstack/plugin-sharing';
import { apiErrorResponse } from '../error-envelope.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { handleShareLinksRequest } from './share-links.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const OBJECT = 'projection_deal';
const TARGET_OBJECT = 'projection_account';
const RECORD = 'deal_1';
const ACCOUNT = 'acct_1';

const DEAL = {
  name: OBJECT,
  label: 'Projection Deal',
  publicSharing: { enabled: true, allowedAudiences: ['public'], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Deal Name', type: 'text' },
    stage: {
      name: 'stage',
      label: 'Pipeline Stage',
      type: 'select',
      options: [
        { value: 'open', label: 'Open Deal', color: '#2563eb' },
        { value: 'won', label: 'Closed Won' },
      ],
    },
    amount: { name: 'amount', label: 'Deal Value', type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } },
    account: { name: 'account', label: 'Customer', type: 'lookup', reference: TARGET_OBJECT, displayField: 'company' },
    margin_note: { name: 'margin_note', label: 'Margin Note', type: 'text' },
    // The record read never returns an `internal` column.
    internal_ref: { name: 'internal_ref', label: 'Internal Ref', type: 'text', internal: true },
  },
};

const ACCOUNTS = {
  name: TARGET_OBJECT,
  label: 'Projection Account',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    company: { name: 'company', label: 'Company', type: 'text' },
  },
};

type Mount = 'plugin route' | 'dispatcher twin';
type LinkKey = 'redacted' | 'unredacted';
type Answer = { status: number; body: any };

const MOUNTS: readonly Mount[] = ['plugin route', 'dispatcher twin'];

const realErrorFromThrown = (() => {
  const dispatcher: any = new HttpDispatcher({ context: { getService: () => null } } as any);
  return (e: any, fallbackStatus?: number) => dispatcher.errorFromThrown(e, fallbackStatus);
})();

function makeDeps(engine: any, svc: any): DomainHandlerDeps {
  const deps: any = {
    resolveService: async (_c: any, name: string) =>
      name === SHARE_LINK_SERVICE ? svc : name === 'objectql' ? engine : undefined,
    getRequestKernelService: async (_c: any, name: string) => (name === 'objectql' ? engine : undefined),
    success: (data: any, meta?: any) => ({ status: 200, body: { success: true, data, ...(meta ? { meta } : {}) } }),
    error: (message: string, httpStatus = 500, details?: any) => apiErrorResponse({ message, httpStatus, details }),
    routeNotFound: (route: string) => apiErrorResponse({ message: `Route not found: ${route}`, httpStatus: 404 }),
    errorFromThrown: realErrorFromThrown,
  };
  return deps as DomainHandlerDeps;
}

/** The smallest `IHttpServer` that keeps the handlers a registrar mounts. */
class RouteRecorder implements IHttpServer {
  readonly routes = new Map<string, RouteHandler>();
  get(path: string, handler: RouteHandler) { this.routes.set(`GET ${path}`, handler); }
  post(path: string, handler: RouteHandler) { this.routes.set(`POST ${path}`, handler); }
  put(path: string, handler: RouteHandler) { this.routes.set(`PUT ${path}`, handler); }
  delete(path: string, handler: RouteHandler) { this.routes.set(`DELETE ${path}`, handler); }
  patch(path: string, handler: RouteHandler) { this.routes.set(`PATCH ${path}`, handler); }
  use() { /* no middleware is mounted by the registrar under test */ }
  async listen() { /* never listens: handlers are driven in-process */ }
}

let engine: ObjectQL;
const tokens = {} as Record<LinkKey, string>;
let open: (mount: Mount, link: LinkKey) => Promise<Answer>;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  for (const o of [SysShareLink, DEAL, ACCOUNTS]) engine.registry.registerObject(o as any, '@objectstack/runtime-test');
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  const system = { context: { isSystem: true } } as any;
  await engine.insert(TARGET_OBJECT, { id: ACCOUNT, company: 'Acme' }, system);
  await engine.insert(
    OBJECT,
    { id: RECORD, title: 'Big deal', stage: 'open', amount: 1250.5, account: ACCOUNT, margin_note: 'thin', internal_ref: 'X-1' },
    system,
  );

  const svc = new ShareLinkService({ engine: engine as any });
  const creator = { isSystem: true, userId: 'usr_creator' } as any;
  tokens.redacted = (await svc.createLink({ object: OBJECT, recordId: RECORD, redactFields: ['margin_note'] }, creator)).token;
  tokens.unredacted = (await svc.createLink({ object: OBJECT, recordId: RECORD }, creator)).token;

  const http = new RouteRecorder();
  registerShareLinkRoutes(http, svc, engine as any, { contextFromRequest: () => ({}) });
  const pluginResolve = http.routes.get('GET /api/v1/share-links/:token/resolve');
  if (!pluginResolve) throw new Error('registerShareLinkRoutes mounted no resolve route');
  const deps = makeDeps(engine, svc);

  open = async (mount, link) => {
    const token = tokens[link];
    if (mount === 'dispatcher twin') {
      const res = await handleShareLinksRequest(deps, `/${token}/resolve`, 'GET', undefined, {}, {
        executionContext: {},
        request: { headers: {} },
      } as unknown as HttpProtocolContext);
      if (!res.handled || !res.response) throw new Error('the dispatcher twin did not handle resolve');
      const r = res.response as { status: number; body: any };
      return { status: r.status, body: r.body };
    }
    const captured: Answer = { status: 200, body: undefined };
    const res: IHttpResponse = {
      json: (data: any) => { captured.body = data; },
      send: () => { /* the share-link routes answer JSON only */ },
      status: (code: number) => { captured.status = code; return res; },
      header: () => res,
    };
    const req: IHttpRequest = {
      params: { token },
      query: {},
      body: undefined,
      headers: {},
      method: 'GET',
      path: `/api/v1/share-links/${token}/resolve`,
    };
    await pluginResolve(req, res);
    return captured;
  };
}, 60_000);

afterAll(async () => {
  try {
    await engine?.destroy();
  } catch {
    /* noop */
  }
});

async function served(mount: Mount, link: LinkKey) {
  const answer = await open(mount, link);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  expect(answer.body?.success).toBe(true);
  return answer.body.data as { record: Record<string, unknown>; fields: Record<string, any>; redactFields: string[] };
}

describe.each(MOUNTS)('[#26991] share-link resolve field projection — the %s', (mount) => {
  it('projects exactly the served record keys that are fields of the shared object', async () => {
    const data = await served(mount, 'redacted');
    expect(data.fields, 'the answer carries a field projection').toBeTypeOf('object');
    const declared = new Set(Object.keys(engine.getSchema(OBJECT)?.fields ?? {}));
    const expected = Object.keys(data.record).filter((k) => declared.has(k)).sort();
    expect(Object.keys(data.fields).sort()).toEqual(expected);
    for (const name of ['id', 'title', 'stage', 'amount', 'account']) expect(expected).toContain(name);
  });

  it('a redacted field is absent from both the record and the projection', async () => {
    const data = await served(mount, 'redacted');
    expect(data.redactFields).toEqual(['margin_note']);
    expect(data.record).not.toHaveProperty('margin_note');
    expect(data.fields).not.toHaveProperty('margin_note');
  });

  it('control: with no redaction the same field is present in both', async () => {
    const data = await served(mount, 'unredacted');
    expect(data.redactFields).toEqual([]);
    expect(data.record.margin_note).toBe('thin');
    expect(data.fields.margin_note).toEqual({ label: 'Margin Note', type: 'text' });
  });

  it('a field the record read never returns (internal) is absent from both', async () => {
    const data = await served(mount, 'unredacted');
    expect(data.record).not.toHaveProperty('internal_ref');
    expect(data.fields).not.toHaveProperty('internal_ref');
  });

  it('serves the authored label, type, option labels, currency and lookup display bits', async () => {
    const data = await served(mount, 'redacted');
    expect(data.fields.title).toEqual({ label: 'Deal Name', type: 'text' });
    expect(data.fields.stage).toEqual({
      label: 'Pipeline Stage',
      type: 'select',
      options: [
        { value: 'open', label: 'Open Deal', color: '#2563eb' },
        { value: 'won', label: 'Closed Won' },
      ],
    });
    expect(data.fields.amount).toEqual({
      label: 'Deal Value',
      type: 'currency',
      currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' },
    });
    // The record read expands nothing: a lookup's value is the stored id, and
    // the projection names where a display name would come from.
    expect(data.record.account).toBe(ACCOUNT);
    expect(data.fields.account).toEqual({
      label: 'Customer',
      type: 'lookup',
      reference: TARGET_OBJECT,
      displayField: 'company',
    });
  });
});

describe('[#26991] both mounts answer one resolve shape', () => {
  it.each(['redacted', 'unredacted'] as const)('%s link: the plugin route and the dispatcher twin serve equal data', async (link) => {
    const plugin = await served('plugin route', link);
    const twin = await served('dispatcher twin', link);
    expect(twin).toEqual(plugin);
  });
});
