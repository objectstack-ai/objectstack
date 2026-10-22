// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23371] The share-link `/messages` door opens for a caller exactly when
 * `/resolve` opens the same link for that caller: ONE table, BOTH mounts,
 * BOTH routes.
 *
 * `/share-links/:token/messages` has two mounts: plugin-sharing's
 * `registerShareLinkRoutes` (the standalone server's) and this package's
 * dispatcher twin `handleShareLinksRequest` (cloud's per-environment kernels,
 * `registerShareLinkRoutes: false`). On each, `/messages` re-validates the
 * token through `resolveToken` before it reads the conversation's messages,
 * and `/resolve` validates it through the same call. The audience gate inside
 * `resolveToken` judges the inputs each route hands it, so a route that hands
 * it fewer inputs refuses callers its sibling serves.
 *
 * ## The rule it pins
 *
 * `/messages` hands `resolveToken` every audience input `/resolve` hands it,
 * from the same sources, on both mounts:
 *
 *  - the signed-in user (the `signed_in` audience), from the caller context
 *    the mount already resolved — the family door's `contextFromRequest` on
 *    the plugin mount, the dispatcher's execution context on the twin;
 *  - the recipient email (the `email` audience), from `?email=`.
 *
 * So, per request: `/messages` serves the messages exactly when `/resolve`
 * serves the record, on the same mount; the two mounts' `/messages` answer the
 * same; and `/messages` serves no caller `/resolve` refuses. Every row below
 * is checked all three ways.
 *
 * ## What it does NOT pin
 *
 * Which refusal `/resolve` names is the refusal-order table's
 * (`share-links-refusal-order.test.ts` beside this file). The rows here carry
 * `/resolve`'s refusal only so that each row reads as a whole request.
 * `/messages` has one refusal, `404 NOT_FOUND`, whatever the cause.
 *
 * ## What is real here
 *
 * Both mounts' production entries over ONE `ObjectQL` on
 * `@objectstack/driver-sql` + better-sqlite3 with the shipped
 * `sys_share_link` definition, ONE `ShareLinkService` with the production
 * password hasher, the caller resolved the way each mount resolves it, the
 * password in the `X-Share-Password` header the console sends, and the email
 * as the `?email=` an API or SDK caller sends. Refusals are read as the
 * ADR-0112 envelope's `status` + `error.code`. The control for "the link
 * resolved" is a link on an object that is not a conversation: `/messages`
 * answers it `400 UNSUPPORTED`, which it can only reach past `resolveToken`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler, ShareLinkAudience } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ShareLinkService, SysShareLink, registerShareLinkRoutes } from '@objectstack/plugin-sharing';
import { apiErrorResponse } from '../error-envelope.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { handleShareLinksRequest } from './share-links.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const CONVERSATION = 'conv_23371';
const DOC = 'doc_23371';
const VIEWER = 'usr_viewer_23371';
const PASSWORD = 'correct horse 23371';
const WRONG = 'not the password 23371';
const RECIPIENT = 'recipient-23371@example.test';
const STRANGER = 'stranger-23371@example.test';
const MESSAGE_IDS = ['msg_23371_a', 'msg_23371_b'];

const AUDIENCES = ['public', 'link_only', 'signed_in', 'email'] as const satisfies readonly ShareLinkAudience[];
/**
 * Every audience the contract declares is listed above: an audience added to
 * `ShareLinkAudience` turns this file's typecheck red until it has rows below.
 */
type UnlistedAudience = Exclude<ShareLinkAudience, (typeof AUDIENCES)[number]>;
const EVERY_AUDIENCE_LISTED: [UnlistedAudience] extends [never] ? true : never = true;

const CONVERSATIONS = {
  name: 'ai_conversations',
  label: 'Conversation',
  publicSharing: { enabled: true, allowedAudiences: [...AUDIENCES], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' },
  },
};

const MESSAGES = {
  name: 'ai_messages',
  label: 'Message',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    conversation_id: { name: 'conversation_id', label: 'Conversation', type: 'text' },
    content: { name: 'content', label: 'Content', type: 'text' },
    created_at: { name: 'created_at', label: 'Created', type: 'text' },
  },
};

/** An object that is not a conversation: the "it resolved" control. */
const DOCS = {
  name: 'audience_doc',
  label: 'Audience Doc',
  publicSharing: { enabled: true, allowedAudiences: [...AUDIENCES], allowedPermissions: ['view'] },
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' },
  },
};

type Mount = 'plugin route' | 'dispatcher twin';
type Route = 'messages' | 'resolve';
type Caller = 'anonymous' | 'signed in';
type Email = 'no email' | 'an off-list email' | 'an allowlisted email';
type Presented = 'no password' | 'a wrong password' | 'the correct password';
type LinkKey =
  | 'public'
  | 'link_only'
  | 'signed_in'
  | 'email'
  | 'signed_in + password'
  | 'email + password'
  | 'public, not a conversation'
  | 'signed_in, not a conversation'
  | 'email, not a conversation';
type Answer = { status: number; body: any };

const MOUNTS: readonly Mount[] = ['plugin route', 'dispatcher twin'];
const CALLERS: Record<Caller, ExecutionContext> = {
  anonymous: {},
  'signed in': { userId: VIEWER },
};
/** The `?email=` query parameter, as an API or SDK caller sends it. */
const EMAILS: Record<Email, string | undefined> = {
  'no email': undefined,
  'an off-list email': STRANGER,
  'an allowlisted email': RECIPIENT,
};
/** The `X-Share-Password` header, as the console's shared-record page sends it. */
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

let engine: ObjectQL;
const tokens = {} as Record<LinkKey, string>;
let call: (mount: Mount, route: Route, link: LinkKey, caller: Caller, email: Email, presented: Presented) => Promise<Answer>;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  for (const o of [SysShareLink, CONVERSATIONS, MESSAGES, DOCS]) {
    engine.registry.registerObject(o as any, '@objectstack/runtime-test');
  }
  await engine.syncSchemas();
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);
  const sys = { context: { isSystem: true } } as any;
  await engine.insert('ai_conversations', { id: CONVERSATION, title: 'Shared chat' }, sys);
  await engine.insert(
    'ai_messages',
    { id: MESSAGE_IDS[0], conversation_id: CONVERSATION, content: 'hello', created_at: '2026-01-01T00:00:00Z' },
    sys,
  );
  await engine.insert(
    'ai_messages',
    { id: MESSAGE_IDS[1], conversation_id: CONVERSATION, content: 'hi there', created_at: '2026-01-01T00:01:00Z' },
    sys,
  );
  await engine.insert('audience_doc', { id: DOC, title: 'Shared doc' }, sys);

  const svc = new ShareLinkService({ engine: engine as any });
  const creator = { isSystem: true, userId: 'usr_creator_23371' } as any;
  const mint = async (
    object: 'ai_conversations' | 'audience_doc',
    audience: (typeof AUDIENCES)[number],
    password?: string,
  ) =>
    (
      await svc.createLink(
        {
          object,
          recordId: object === 'ai_conversations' ? CONVERSATION : DOC,
          audience,
          ...(password ? { password } : {}),
          ...(audience === 'email' ? { emailAllowlist: [RECIPIENT] } : {}),
        },
        creator,
      )
    ).token;
  tokens.public = await mint('ai_conversations', 'public');
  tokens.link_only = await mint('ai_conversations', 'link_only');
  tokens.signed_in = await mint('ai_conversations', 'signed_in');
  tokens.email = await mint('ai_conversations', 'email');
  tokens['signed_in + password'] = await mint('ai_conversations', 'signed_in', PASSWORD);
  tokens['email + password'] = await mint('ai_conversations', 'email', PASSWORD);
  tokens['public, not a conversation'] = await mint('audience_doc', 'public');
  tokens['signed_in, not a conversation'] = await mint('audience_doc', 'signed_in');
  tokens['email, not a conversation'] = await mint('audience_doc', 'email');

  // The plugin mount, once per caller: the family door resolves the caller
  // through `contextFromRequest`, exactly as production wires it.
  const pluginRoutes = {} as Record<Caller, Record<Route, RouteHandler>>;
  for (const caller of Object.keys(CALLERS) as Caller[]) {
    const http = new RouteRecorder();
    registerShareLinkRoutes(http, svc, engine as any, { contextFromRequest: () => CALLERS[caller] });
    const resolve = http.routes.get('GET /api/v1/share-links/:token/resolve');
    const messages = http.routes.get('GET /api/v1/share-links/:token/messages');
    if (!resolve || !messages) throw new Error('registerShareLinkRoutes did not mount both token routes');
    pluginRoutes[caller] = { resolve, messages };
  }
  const deps = makeDeps(engine, svc);

  call = async (mount, route, link, caller, email, presented) => {
    const token = tokens[link];
    const password = PRESENTED[presented];
    const headers: Record<string, string> = password === undefined ? {} : { 'x-share-password': password };
    const address = EMAILS[email];
    const query: Record<string, string> = address === undefined ? {} : { email: address };
    if (mount === 'dispatcher twin') {
      const res = await handleShareLinksRequest(deps, `/${token}/${route}`, 'GET', undefined, query, {
        executionContext: CALLERS[caller],
        request: { headers },
      } as unknown as HttpProtocolContext);
      if (!res.handled || !res.response) throw new Error(`the dispatcher twin did not handle /${route}`);
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
      query,
      body: undefined,
      headers,
      method: 'GET',
      path: `/api/v1/share-links/${token}/${route}`,
    };
    await pluginRoutes[caller][route](req, res);
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
  email: Email;
  presented: Presented;
  /** Whether `/resolve` serves the record, and so `/messages` the messages. */
  opens: boolean;
  /** `/resolve`'s refusal on a row that does not open; the refusal-order table pins it. */
  resolveRefusal?: { status: number; code: string };
}

const SIGN_IN_REQUIRED = { status: 401, code: 'SIGN_IN_REQUIRED' };
const INVALID_OR_EXPIRED = { status: 404, code: 'INVALID_OR_EXPIRED' };
const NEEDS_PASSWORD = { status: 401, code: 'NEEDS_PASSWORD' };
const WRONG_PASSWORD = { status: 401, code: 'WRONG_PASSWORD' };

/** The enumeration's two rows, every caller and every email, then the controls. */
const TABLE: readonly Row[] = [
  // `signed_in`: the signed-in user opens it, whatever email was sent.
  { link: 'signed_in', caller: 'signed in', email: 'no email', presented: 'no password', opens: true },
  { link: 'signed_in', caller: 'signed in', email: 'an off-list email', presented: 'no password', opens: true },
  { link: 'signed_in', caller: 'signed in', email: 'an allowlisted email', presented: 'no password', opens: true },
  { link: 'signed_in', caller: 'anonymous', email: 'no email', presented: 'no password', opens: false, resolveRefusal: SIGN_IN_REQUIRED },
  { link: 'signed_in', caller: 'anonymous', email: 'an off-list email', presented: 'no password', opens: false, resolveRefusal: SIGN_IN_REQUIRED },
  { link: 'signed_in', caller: 'anonymous', email: 'an allowlisted email', presented: 'no password', opens: false, resolveRefusal: SIGN_IN_REQUIRED },
  // `email`: an allowlisted email opens it, signed in or not; nothing else does.
  { link: 'email', caller: 'anonymous', email: 'an allowlisted email', presented: 'no password', opens: true },
  { link: 'email', caller: 'signed in', email: 'an allowlisted email', presented: 'no password', opens: true },
  { link: 'email', caller: 'anonymous', email: 'no email', presented: 'no password', opens: false, resolveRefusal: INVALID_OR_EXPIRED },
  { link: 'email', caller: 'anonymous', email: 'an off-list email', presented: 'no password', opens: false, resolveRefusal: INVALID_OR_EXPIRED },
  { link: 'email', caller: 'signed in', email: 'no email', presented: 'no password', opens: false, resolveRefusal: INVALID_OR_EXPIRED },
  { link: 'email', caller: 'signed in', email: 'an off-list email', presented: 'no password', opens: false, resolveRefusal: INVALID_OR_EXPIRED },
  // The audience inputs compose with the password `/messages` already forwarded.
  { link: 'signed_in + password', caller: 'signed in', email: 'no email', presented: 'the correct password', opens: true },
  { link: 'signed_in + password', caller: 'signed in', email: 'no email', presented: 'a wrong password', opens: false, resolveRefusal: WRONG_PASSWORD },
  { link: 'signed_in + password', caller: 'signed in', email: 'no email', presented: 'no password', opens: false, resolveRefusal: NEEDS_PASSWORD },
  { link: 'signed_in + password', caller: 'anonymous', email: 'no email', presented: 'the correct password', opens: false, resolveRefusal: SIGN_IN_REQUIRED },
  { link: 'email + password', caller: 'anonymous', email: 'an allowlisted email', presented: 'the correct password', opens: true },
  { link: 'email + password', caller: 'anonymous', email: 'an allowlisted email', presented: 'a wrong password', opens: false, resolveRefusal: INVALID_OR_EXPIRED },
  { link: 'email + password', caller: 'anonymous', email: 'an off-list email', presented: 'the correct password', opens: false, resolveRefusal: INVALID_OR_EXPIRED },
  // Controls: the audiences that read no input open for everyone.
  { link: 'public', caller: 'anonymous', email: 'no email', presented: 'no password', opens: true },
  { link: 'public', caller: 'signed in', email: 'an off-list email', presented: 'no password', opens: true },
  { link: 'link_only', caller: 'anonymous', email: 'no email', presented: 'no password', opens: true },
  { link: 'link_only', caller: 'signed in', email: 'an off-list email', presented: 'no password', opens: true },
  // Controls: "it resolved", on an object that is not a conversation.
  { link: 'public, not a conversation', caller: 'anonymous', email: 'no email', presented: 'no password', opens: true },
  { link: 'signed_in, not a conversation', caller: 'signed in', email: 'no email', presented: 'no password', opens: true },
  { link: 'signed_in, not a conversation', caller: 'anonymous', email: 'no email', presented: 'no password', opens: false, resolveRefusal: SIGN_IN_REQUIRED },
  { link: 'email, not a conversation', caller: 'anonymous', email: 'an allowlisted email', presented: 'no password', opens: true },
  { link: 'email, not a conversation', caller: 'anonymous', email: 'an off-list email', presented: 'no password', opens: false, resolveRefusal: INVALID_OR_EXPIRED },
];

const isConversation = (link: LinkKey) => !link.endsWith('not a conversation');

/** What a caller can read off an answer: status, flag, refusal code, payload. */
function reading(answer: Answer) {
  return {
    status: answer.status,
    success: answer.body?.success,
    code: answer.body?.error?.code,
    data: answer.body?.data,
  };
}

describe.each(MOUNTS)('[#23371] share-link /messages opens exactly when /resolve does — the %s', (mount) => {
  it.each(TABLE)('$link, $caller, $email, $presented → opens: $opens', async (row) => {
    const messages = await call(mount, 'messages', row.link, row.caller, row.email, row.presented);
    const resolve = await call(mount, 'resolve', row.link, row.caller, row.email, row.presented);
    const label = (route: Route, answer: Answer) => `${mount} /${route}: ${JSON.stringify(answer.body)}`;

    // `/messages`: the conversation's messages in order, the "it resolved"
    // control on any other object, or its one refusal.
    if (row.opens && isConversation(row.link)) {
      expect(messages.status, label('messages', messages)).toBe(200);
      expect(messages.body?.success, label('messages', messages)).toBe(true);
      expect(messages.body?.data?.map((m: { id: string }) => m.id), label('messages', messages)).toEqual(MESSAGE_IDS);
    } else if (row.opens) {
      expect(messages.status, label('messages', messages)).toBe(400);
      expect(messages.body?.success, label('messages', messages)).toBe(false);
      expect(messages.body?.error?.code, label('messages', messages)).toBe('UNSUPPORTED');
    } else {
      expect(messages.status, label('messages', messages)).toBe(404);
      expect(messages.body?.success, label('messages', messages)).toBe(false);
      expect(messages.body?.error?.code, label('messages', messages)).toBe('NOT_FOUND');
    }

    // `/resolve`, on the same mount for the same request: the same verdict.
    if (row.opens) {
      expect(resolve.status, label('resolve', resolve)).toBe(200);
      expect(resolve.body?.success, label('resolve', resolve)).toBe(true);
      expect(resolve.body?.data?.record?.id, label('resolve', resolve)).toBe(isConversation(row.link) ? CONVERSATION : DOC);
    } else {
      expect(row.resolveRefusal, 'a row that does not open names the refusal /resolve answers').toBeDefined();
      expect(resolve.status, label('resolve', resolve)).toBe(row.resolveRefusal?.status);
      expect(resolve.body?.success, label('resolve', resolve)).toBe(false);
      expect(resolve.body?.error?.code, label('resolve', resolve)).toBe(row.resolveRefusal?.code);
    }
  });
});

describe('[#23371] the two mounts of /messages answer one request the same', () => {
  it.each(TABLE)('$link, $caller, $email, $presented', async (row) => {
    const plugin = await call('plugin route', 'messages', row.link, row.caller, row.email, row.presented);
    const twin = await call('dispatcher twin', 'messages', row.link, row.caller, row.email, row.presented);
    expect(reading(plugin), `plugin route: ${JSON.stringify(plugin.body)}`).toEqual(reading(twin));
  });
});

describe('[#23371] the table covers every audience the contract declares', () => {
  it('each audience has a row that opens and, where it reads an input, one that does not', () => {
    expect(EVERY_AUDIENCE_LISTED).toBe(true);
    for (const audience of AUDIENCES) {
      const rows = TABLE.filter((row) => row.link === audience);
      expect(rows.some((row) => row.opens), `${audience} opens for someone`).toBe(true);
      if (audience === 'signed_in' || audience === 'email') {
        expect(rows.some((row) => !row.opens), `${audience} refuses someone`).toBe(true);
      }
    }
  });
});
