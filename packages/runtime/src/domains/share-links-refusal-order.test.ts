// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23328] The share-link resolve refusal order: ONE table, BOTH mounts.
 *
 * `/share-links/:token/resolve` has two mounts: plugin-sharing's
 * `registerShareLinkRoutes` (the standalone server's) and this package's
 * dispatcher twin `handleShareLinksRequest` (cloud's per-environment kernels,
 * `registerShareLinkRoutes: false`). When `resolveToken` refuses, each mount
 * probes the row to name the refusal, and each carries its own copy of that
 * probe's arm order — `@objectstack/plugin-sharing` is a DEV dependency of
 * this package, so the twin cannot import the plugin's code. This table is
 * what holds the two copies in step.
 *
 * ## The rule it pins
 *
 * For a live link whose audience is `signed_in`, an anonymous caller is
 * answered `401 SIGN_IN_REQUIRED` WHATEVER password it sent. Before sign-in
 * the probe judges the audience, never the password: `resolveToken` refuses
 * that caller on the audience before it verifies any password, so a probe
 * that answered a password arm first could only report whether a password
 * was SENT — and it answered `WRONG_PASSWORD` for the correct one.
 *
 * The oracle property is pinned on its own: an anonymous caller reads the
 * SAME answer, byte for byte, for no password, a wrong one and the correct
 * one. Any difference there, before sign-in, would tell an anonymous holder
 * of the token whether a guessed password is right.
 *
 * A signed-in caller keeps the password arms: `NEEDS_PASSWORD`,
 * `WRONG_PASSWORD`, and the record for the correct password. The controls
 * are unchanged by the rule: a `public` link with a password still answers
 * the password arms to an anonymous caller, an unprotected `public` link
 * still serves, and a revoked link still answers the 410 whoever asks.
 *
 * ## What is real here
 *
 * Both mounts' production entries over ONE `ObjectQL` on
 * `@objectstack/driver-sql` + better-sqlite3 with the shipped
 * `sys_share_link` definition (whose `password_hash` is `internal`, so both
 * probes recover it the fail-closed way), ONE `ShareLinkService` with the
 * production password hasher, and the password sent the way the console's
 * landing page sends it: the `X-Share-Password` header. Refusals are read as
 * the ADR-0112 envelope's `status` + `error.code`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ShareLinkService, SysShareLink, registerShareLinkRoutes } from '@objectstack/plugin-sharing';
import { apiErrorResponse } from '../error-envelope.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { handleShareLinksRequest } from './share-links.js';

const OBJECT = 'refusal_doc';
const RECORD = 'doc_1';
const VIEWER = 'usr_viewer';
const PASSWORD = 'correct horse 23328';
const WRONG = 'not the password 23328';

const TARGET = {
  name: OBJECT,
  label: 'Refusal Doc',
  publicSharing: { enabled: true, allowedAudiences: ['public', 'signed_in'], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' },
  },
};

type Mount = 'plugin route' | 'dispatcher twin';
type Caller = 'anonymous' | 'signed in';
type Presented = 'no password' | 'a wrong password' | 'the correct password';
type LinkKey = 'signed_in + password' | 'public + password' | 'public' | 'revoked signed_in + password';
type Answer = { status: number; body: any; headers: Record<string, string> };

const MOUNTS: readonly Mount[] = ['plugin route', 'dispatcher twin'];
const PRESENTED: Record<Presented, string | undefined> = {
  'no password': undefined,
  'a wrong password': WRONG,
  'the correct password': PASSWORD,
};

/** The dispatcher's REAL thrown-error mapper, as the sibling suites borrow it. */
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

const CALLERS: Record<Caller, ExecutionContext> = {
  anonymous: {},
  'signed in': { userId: VIEWER },
};

let engine: ObjectQL;
const tokens = {} as Record<LinkKey, string>;
let open: (mount: Mount, link: LinkKey, caller: Caller, presented: Presented) => Promise<Answer>;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  for (const o of [SysShareLink, TARGET]) engine.registry.registerObject(o as any, '@objectstack/runtime-test');
  await engine.syncSchemas();
  await engine.insert(OBJECT, { id: RECORD, title: 'Shared doc' }, { context: { isSystem: true } } as any);

  const svc = new ShareLinkService({ engine: engine as any });
  const creator = { isSystem: true, userId: 'usr_creator' } as any;
  const mint = async (audience: 'public' | 'signed_in', password?: string) =>
    svc.createLink({ object: OBJECT, recordId: RECORD, audience, ...(password ? { password } : {}) }, creator);
  tokens['signed_in + password'] = (await mint('signed_in', PASSWORD)).token;
  tokens['public + password'] = (await mint('public', PASSWORD)).token;
  tokens.public = (await mint('public')).token;
  const revoked = await mint('signed_in', PASSWORD);
  await svc.revokeLink(revoked.id, creator);
  tokens['revoked signed_in + password'] = revoked.token;

  // The plugin mount, once per caller: the family door resolves the caller
  // through `contextFromRequest`, exactly as production wires it.
  const pluginRoutes = {} as Record<Caller, RouteHandler>;
  for (const caller of Object.keys(CALLERS) as Caller[]) {
    const http = new RouteRecorder();
    registerShareLinkRoutes(http, svc, engine as any, { contextFromRequest: () => CALLERS[caller] });
    const handler = http.routes.get('GET /api/v1/share-links/:token/resolve');
    if (!handler) throw new Error('registerShareLinkRoutes mounted no resolve route');
    pluginRoutes[caller] = handler;
  }
  const deps = makeDeps(engine, svc);

  open = async (mount, link, caller, presented) => {
    const token = tokens[link];
    const password = PRESENTED[presented];
    const headers: Record<string, string> = password === undefined ? {} : { 'x-share-password': password };
    if (mount === 'dispatcher twin') {
      const res = await handleShareLinksRequest(deps, `/${token}/resolve`, 'GET', undefined, {}, {
        executionContext: CALLERS[caller],
        request: { headers },
      } as unknown as HttpProtocolContext);
      if (!res.handled || !res.response) throw new Error('the dispatcher twin did not handle resolve');
      const r = res.response as { status: number; body: any; headers?: Record<string, string> };
      return { status: r.status, body: r.body, headers: { ...(r.headers ?? {}) } };
    }
    const captured: Answer = { status: 200, body: undefined, headers: {} };
    const res: IHttpResponse = {
      json: (data: any) => { captured.body = data; },
      send: () => { /* the share-link routes answer JSON only */ },
      status: (code: number) => { captured.status = code; return res; },
      header: (name: string, value: string) => { captured.headers[name] = value; return res; },
    };
    const req: IHttpRequest = {
      params: { token },
      query: {},
      body: undefined,
      headers,
      method: 'GET',
      path: `/api/v1/share-links/${token}/resolve`,
    };
    await pluginRoutes[caller](req, res);
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

interface Row {
  link: LinkKey;
  caller: Caller;
  presented: Presented;
  status: number;
  /** The refusal's `error.code`; absent on a row that serves the record. */
  code?: string;
}

/** The card's table, then the controls. */
const TABLE: readonly Row[] = [
  // A password AND audience `signed_in`: before sign-in, the audience alone.
  { link: 'signed_in + password', caller: 'anonymous', presented: 'no password', status: 401, code: 'SIGN_IN_REQUIRED' },
  { link: 'signed_in + password', caller: 'anonymous', presented: 'a wrong password', status: 401, code: 'SIGN_IN_REQUIRED' },
  { link: 'signed_in + password', caller: 'anonymous', presented: 'the correct password', status: 401, code: 'SIGN_IN_REQUIRED' },
  // Signed in, the password arms.
  { link: 'signed_in + password', caller: 'signed in', presented: 'no password', status: 401, code: 'NEEDS_PASSWORD' },
  { link: 'signed_in + password', caller: 'signed in', presented: 'a wrong password', status: 401, code: 'WRONG_PASSWORD' },
  { link: 'signed_in + password', caller: 'signed in', presented: 'the correct password', status: 200 },
  // Control: a `public` link with a password keeps the password arms for an anonymous caller.
  { link: 'public + password', caller: 'anonymous', presented: 'no password', status: 401, code: 'NEEDS_PASSWORD' },
  { link: 'public + password', caller: 'anonymous', presented: 'a wrong password', status: 401, code: 'WRONG_PASSWORD' },
  { link: 'public + password', caller: 'anonymous', presented: 'the correct password', status: 200 },
  // Control: an unprotected `public` link serves an anonymous caller.
  { link: 'public', caller: 'anonymous', presented: 'no password', status: 200 },
  // Control: the 410 arm is not reordered — a revoked link answers it whoever asks.
  { link: 'revoked signed_in + password', caller: 'anonymous', presented: 'the correct password', status: 410, code: 'EXPIRED_OR_REVOKED' },
  { link: 'revoked signed_in + password', caller: 'signed in', presented: 'the correct password', status: 410, code: 'EXPIRED_OR_REVOKED' },
];

describe.each(MOUNTS)('[#23328] share-link resolve refusal order — the %s', (mount) => {
  it.each(TABLE)('$link, $caller, $presented → $status $code', async (row) => {
    const answer = await open(mount, row.link, row.caller, row.presented);
    const label = `${mount}: ${JSON.stringify(answer.body)}`;
    expect(answer.status, label).toBe(row.status);
    if (row.code) {
      expect(answer.body?.success, label).toBe(false);
      expect(answer.body?.error?.code, label).toBe(row.code);
    } else {
      expect(answer.body?.success, label).toBe(true);
      expect(answer.body?.data?.record?.id, label).toBe(RECORD);
    }
  });

  it('no anonymous password oracle: no, a wrong and the correct password read one identical answer', async () => {
    const none = await open(mount, 'signed_in + password', 'anonymous', 'no password');
    const wrong = await open(mount, 'signed_in + password', 'anonymous', 'a wrong password');
    const correct = await open(mount, 'signed_in + password', 'anonymous', 'the correct password');
    expect(correct, 'the correct password against a wrong one').toEqual(wrong);
    expect(correct, 'the correct password against none').toEqual(none);
  });
});
