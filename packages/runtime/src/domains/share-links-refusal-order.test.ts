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
 * ## The email audience (#23372)
 *
 * For a live link whose audience is `email`, every caller the link does not
 * resolve for is answered `404 INVALID_OR_EXPIRED` — whatever email and
 * whatever password it sent, signed in or not. The email is the caller's own
 * claim (`?email=`), never a verified identity, so the probe may not answer
 * by it: an allowlisted email with a wrong password that read differently
 * from an off-list email would let anyone holding the token test addresses
 * against the allowlist. Nor may it answer from the password: `resolveToken`
 * refuses the audience before it verifies any password, so the password arm
 * could only report whether one was SENT — `WRONG_PASSWORD` for the correct
 * one. The refusal is the one a password-less `email` link already answered
 * and an unknown token answers, so it tells the holder neither whether the
 * email is on the list, nor whether the password is right, nor whether the
 * link has one. Only the record itself — an allowlisted email AND the right
 * password — differs.
 *
 * ## What is real here
 *
 * Both mounts' production entries over ONE `ObjectQL` on
 * `@objectstack/driver-sql` + better-sqlite3 with the shipped
 * `sys_share_link` definition (whose `password_hash` is `internal`, so both
 * probes recover it the fail-closed way), ONE `ShareLinkService` with the
 * production password hasher, and the password sent the way the console's
 * landing page sends it: the `X-Share-Password` header. Refusals are read as
 * the ADR-0112 envelope's `status` + `error.code`. Every password verdict is
 * the production verifier's own; a pair it already judged is answered from
 * a memo of that verdict (see `beforeAll`).
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
import { installDefaultOrganization } from '../default-organization.testkit.js';

const OBJECT = 'refusal_doc';
const RECORD = 'doc_1';
const VIEWER = 'usr_viewer';
const PASSWORD = 'correct horse 23328';
const WRONG = 'not the password 23328';
const RECIPIENT = 'recipient-23372@example.test';
const STRANGER = 'stranger-23372@example.test';

const TARGET = {
  name: OBJECT,
  label: 'Refusal Doc',
  publicSharing: { enabled: true, allowedAudiences: ['public', 'signed_in', 'email'], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' },
  },
};

type Mount = 'plugin route' | 'dispatcher twin';
type Caller = 'anonymous' | 'signed in';
type Presented = 'no password' | 'a wrong password' | 'the correct password';
type Email = 'no email' | 'an off-list email' | 'an allowlisted email';
type LinkKey =
  | 'signed_in + password'
  | 'public + password'
  | 'public'
  | 'revoked signed_in + password'
  | 'email + password'
  | 'email'
  | 'unknown token';
type Answer = { status: number; body: any; headers: Record<string, string> };

const MOUNTS: readonly Mount[] = ['plugin route', 'dispatcher twin'];
const PRESENTED: Record<Presented, string | undefined> = {
  'no password': undefined,
  'a wrong password': WRONG,
  'the correct password': PASSWORD,
};
/** The `?email=` query parameter, as an API or SDK caller sends it. */
const EMAILS: Record<Email, string | undefined> = {
  'no email': undefined,
  'an off-list email': STRANGER,
  'an allowlisted email': RECIPIENT,
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
let open: (mount: Mount, link: LinkKey, caller: Caller, presented: Presented, email?: Email) => Promise<Answer>;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  for (const o of [SysShareLink, TARGET]) engine.registry.registerObject(o as any, '@objectstack/runtime-test');
  await engine.syncSchemas();
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);
  await engine.insert(OBJECT, { id: RECORD, title: 'Shared doc' }, { context: { isSystem: true } } as any);

  const svc = new ShareLinkService({ engine: engine as any });
  // [#24633] One scrypt verification per distinct (password, hash) pair, not
  // one per request. The production verifier derives a key at the account
  // parameters (scrypt N=16384, r=16) on every call, and `resolveToken` calls
  // it for each password presented to a live protected link, once a
  // `signed_in` link's caller is signed in, and on an `email` link whatever
  // email was sent. Counted at `eadea5720`: 70 calls, plus
  // the 4 mints below, and they were the file's wall time. It read 34.84 s in
  // CI (run 39298888283, Test Core 6/6, attempt 2), and the loop case with
  // 10 calls timed out at vitest's 5000 ms default on attempt 1. The calls
  // hold only 6 distinct pairs (3 protected live links x a wrong and the
  // correct password), and a verdict is a pure function of its pair, so each
  // pair is judged once by the real verifier and its verdict replayed.
  // Every request is still made, so every answer is still a real request's,
  // and the service is still built with both password members at their
  // defaults, as production builds it (so its legacy-hash upgrade stays on;
  // no row here is legacy). The memo wraps the instance's own verifier,
  // which is not exported. If that member moves, this throws rather than
  // leave the file paying for every call again.
  type Verify = (plain: string, hash: string) => Promise<boolean>;
  const productionVerify: unknown = (svc as any).verifyPassword;
  if (typeof productionVerify !== 'function') {
    throw new Error('ShareLinkService no longer keeps its password verifier as `verifyPassword`; re-point the memo below');
  }
  const verdicts = new Map<string, Map<string, Promise<boolean>>>();
  const memoVerify: Verify = (plain, hash) => {
    let byPlain = verdicts.get(hash);
    if (!byPlain) verdicts.set(hash, (byPlain = new Map()));
    let verdict = byPlain.get(plain);
    if (!verdict) byPlain.set(plain, (verdict = (productionVerify as Verify)(plain, hash)));
    return verdict;
  };
  (svc as any).verifyPassword = memoVerify;
  const creator = { isSystem: true, userId: 'usr_creator' } as any;
  const mint = async (audience: 'public' | 'signed_in' | 'email', password?: string) =>
    svc.createLink(
      {
        object: OBJECT,
        recordId: RECORD,
        audience,
        ...(password ? { password } : {}),
        ...(audience === 'email' ? { emailAllowlist: [RECIPIENT] } : {}),
      },
      creator,
    );
  tokens['signed_in + password'] = (await mint('signed_in', PASSWORD)).token;
  tokens['public + password'] = (await mint('public', PASSWORD)).token;
  tokens.public = (await mint('public')).token;
  const revoked = await mint('signed_in', PASSWORD);
  await svc.revokeLink(revoked.id, creator);
  tokens['revoked signed_in + password'] = revoked.token;
  tokens['email + password'] = (await mint('email', PASSWORD)).token;
  tokens.email = (await mint('email')).token;
  // Long enough to reach the row lookup; no row carries it.
  tokens['unknown token'] = 'never-minted-token-23372';

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

  open = async (mount, link, caller, presented, email = 'no email') => {
    const token = tokens[link];
    const password = PRESENTED[presented];
    const headers: Record<string, string> = password === undefined ? {} : { 'x-share-password': password };
    const address = EMAILS[email];
    const query: Record<string, string> = address === undefined ? {} : { email: address };
    if (mount === 'dispatcher twin') {
      const res = await handleShareLinksRequest(deps, `/${token}/resolve`, 'GET', undefined, query, {
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
      query,
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
  /** The `?email=` sent; `no email` when the row leaves it out. */
  email?: Email;
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
  // [#23372] A password AND audience `email`: until the link resolves, one
  // refusal, whatever email and whatever password were sent.
  { link: 'email + password', caller: 'anonymous', email: 'no email', presented: 'no password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email + password', caller: 'anonymous', email: 'no email', presented: 'a wrong password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email + password', caller: 'anonymous', email: 'no email', presented: 'the correct password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email + password', caller: 'anonymous', email: 'an off-list email', presented: 'no password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email + password', caller: 'anonymous', email: 'an off-list email', presented: 'a wrong password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email + password', caller: 'anonymous', email: 'an off-list email', presented: 'the correct password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email + password', caller: 'anonymous', email: 'an allowlisted email', presented: 'no password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email + password', caller: 'anonymous', email: 'an allowlisted email', presented: 'a wrong password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email + password', caller: 'anonymous', email: 'an allowlisted email', presented: 'the correct password', status: 200 },
  // Sign-in neither satisfies an `email` audience nor changes its refusal.
  { link: 'email + password', caller: 'signed in', email: 'an off-list email', presented: 'the correct password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email + password', caller: 'signed in', email: 'an allowlisted email', presented: 'a wrong password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email + password', caller: 'signed in', email: 'an allowlisted email', presented: 'the correct password', status: 200 },
  // Control: a password-less `email` link refuses an off-list email the same
  // way, and serves an allowlisted one.
  { link: 'email', caller: 'anonymous', email: 'an off-list email', presented: 'no password', status: 404, code: 'INVALID_OR_EXPIRED' },
  { link: 'email', caller: 'anonymous', email: 'an allowlisted email', presented: 'no password', status: 200 },
];

/** Every row names the email it sent, so each title reads the whole request. */
const ROWS: readonly (Row & { email: Email })[] = TABLE.map((row) => ({ email: 'no email' as const, ...row }));

const CALLER_KEYS = Object.keys(CALLERS) as Caller[];
const EMAIL_KEYS = Object.keys(EMAILS) as Email[];
const PRESENTED_KEYS = Object.keys(PRESENTED) as Presented[];

describe.each(MOUNTS)('[#23328] share-link resolve refusal order — the %s', (mount) => {
  it.each(ROWS)('$link, $caller, $email, $presented → $status $code', async (row) => {
    const answer = await open(mount, row.link, row.caller, row.presented, row.email);
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

  // [#23372] The email audience. Each pin compares whole answers — status,
  // envelope and headers — against one reference, so any difference a caller
  // could read is a difference here.
  it('[#23372] email audience, no password oracle: no email or an off-list email reads one answer whatever password was sent', async () => {
    const reference = await open(mount, 'email + password', 'anonymous', 'no password', 'no email');
    for (const caller of CALLER_KEYS) {
      for (const email of ['no email', 'an off-list email'] as const) {
        for (const presented of PRESENTED_KEYS) {
          const answer = await open(mount, 'email + password', caller, presented, email);
          expect(answer, `${caller}, ${email}, ${presented}`).toEqual(reference);
        }
      }
    }
  });

  it('[#23372] email audience, no allowlist-membership oracle: an allowlisted email without the right password reads what an off-list email reads', async () => {
    for (const caller of CALLER_KEYS) {
      for (const presented of ['no password', 'a wrong password'] as const) {
        const offList = await open(mount, 'email + password', caller, presented, 'an off-list email');
        const allowlisted = await open(mount, 'email + password', caller, presented, 'an allowlisted email');
        expect(allowlisted, `${caller}, ${presented}`).toEqual(offList);
      }
    }
  });

  it('[#23372] email audience: the refusal is the one an unknown token and a password-less email link answer', async () => {
    const unknown = await open(mount, 'unknown token', 'anonymous', 'no password');
    const passwordless = await open(mount, 'email', 'anonymous', 'no password', 'an off-list email');
    expect(passwordless, 'a password-less email link against an unknown token').toEqual(unknown);
    for (const caller of CALLER_KEYS) {
      for (const email of EMAIL_KEYS) {
        for (const presented of PRESENTED_KEYS) {
          if (email === 'an allowlisted email' && presented === 'the correct password') continue; // served
          const answer = await open(mount, 'email + password', caller, presented, email);
          expect(answer, `${caller}, ${email}, ${presented}`).toEqual(unknown);
        }
      }
    }
  });
});
