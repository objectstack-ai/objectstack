// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D2.1 (2026-11-02 amendment) — an `oauth2` `authorization_code`
// connector instance declaring `clientSource: 'installer'` names no client in
// its definition: the administrator of each deployment registers a client
// with the vendor and enters it on the connection. Booted on the showcase with
// its own connector plugins, through the real HTTP connection door:
//
//  - SERVED: saved over `PUT /meta/connector/:name`, the instance is held "not
//    connected" until a connect, never degraded for a missing `clientId`.
//  - ⛔ REFUSED: a begin with no client, and a begin body carrying a key other
//    than `clientId` / `clientSecret`, answer `400 VALIDATION_ERROR` and store
//    nothing; no refusal repeats a value the caller sent.
//  - SERVED: the connection's read answers `redirectUri`, the URI to register
//    with the vendor before any client exists, derived from the deployment's
//    fixed origin; a connect then names exactly that URI.
//  - CONNECTED: a begin with the administrator's client sends the browser to
//    the vendor as that client; the callback exchanges the code as it (its
//    secret in HTTP Basic); the connection's read shows which client is set,
//    never its secret; the stored row keeps the id in plain text and the
//    secret only behind the masked column; a reconnect naming no client
//    reuses the kept one; revoke removes it.
//
// Every credential below is an obviously-fake placeholder, and every
// assertion on the secret is its absence from what a door served.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] };

const NAME = 'cioc_vendor';
const INSTALLER_ID = 'TEST_PLACEHOLDER_INSTALLER_CLIENT_ID';
const INSTALLER_SECRET = 'TEST_PLACEHOLDER_INSTALLER_CLIENT_SECRET';
const CODE = 'TEST_PLACEHOLDER_AUTHORIZATION_CODE';
const ACCESS_TOKEN = 'TEST_PLACEHOLDER_ACCESS_TOKEN';
const REFRESH_TOKEN = 'TEST_PLACEHOLDER_REFRESH_TOKEN';

const door = `/automation/connectors/${NAME}/connection`;
const basicOf = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const dataOf = (json: any): any => json?.data ?? json;
const errorOf = (json: any): { code?: string; message?: string } => {
  const e = json?.error;
  return typeof e === 'object' && e !== null ? e : { code: json?.code, message: typeof e === 'string' ? e : json?.message };
};

describe("connector connection door: an `oauth2` instance that takes the installer's OAuth client", () => {
  let stack: VerifyStack;
  let admin: string;
  let ql: any;
  let idp: Server;
  let idpUrl: string;
  let upstream: Server;
  let upstreamUrl: string;
  const tokenRequests: Array<{ form: URLSearchParams; authorization?: string }> = [];
  const savedOrigin = { auth: process.env.OS_AUTH_URL, base: process.env.OS_BASE_URL };

  const stored = async () =>
    rowsOf(await ql.find('sys_connector_connection', { where: { connector_name: NAME }, context: SYSTEM }));

  /** The listing's entry for the instance, polled until `until` holds. */
  const listed = async (until: (entry: any) => boolean): Promise<any> => {
    const deadline = Date.now() + 15_000;
    let last: any;
    while (Date.now() < deadline) {
      const res = await stack.apiAs(admin, 'GET', '/automation/connectors');
      const json = (await res.json()) as any;
      last = (json?.data?.connectors ?? []).find((c: any) => c?.name === NAME);
      if (last && until(last)) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`connector ${NAME} never reached the expected state: ${JSON.stringify(last ?? null)}`);
  };

  beforeAll(async () => {
    idp = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const authorization = req.headers.authorization;
        tokenRequests.push({ form: new URLSearchParams(body), ...(authorization ? { authorization } : {}) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, token_type: 'Bearer', expires_in: 3600 }));
      });
    });
    await new Promise<void>((r) => idp.listen(0, '127.0.0.1', () => r()));
    idpUrl = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
    upstream = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    stack = await bootShowcase({});
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    admin = await stack.signIn();
    // The redirect URI is the deployment's fixed origin, read when a connect
    // is begun — never at boot, and never from the request (ADR-0143 D5).
    if (!savedOrigin.auth && !savedOrigin.base) process.env.OS_BASE_URL = 'https://dogfood.example.com';

    const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${NAME}`, {
      name: NAME,
      label: 'CIOC vendor',
      type: 'api',
      description: "An `oauth2` instance whose OAuth client each deployment's administrator enters.",
      provider: 'rest',
      providerConfig: { baseUrl: upstreamUrl },
      auth: {
        type: 'oauth2',
        grant: 'authorization_code',
        authorizationUrl: `${idpUrl}/authorize`,
        tokenUrl: `${idpUrl}/token`,
        clientSource: 'installer',
        scopes: ['vendor.read'],
      },
    });
    expect(put.status, await put.clone().text()).toBe(200);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    await new Promise<void>((r) => (idp ? idp.close(() => r()) : r()));
    await new Promise<void>((r) => (upstream ? upstream.close(() => r()) : r()));
    if (savedOrigin.base === undefined) delete process.env.OS_BASE_URL;
    else process.env.OS_BASE_URL = savedOrigin.base;
  });

  it('SERVED: before a connect the instance is held "not connected", never for a missing `clientId`', async () => {
    const entry = await listed((e) => JSON.stringify(e).includes('is not connected'));
    expect(JSON.stringify(entry)).not.toContain('clientId');
    const read = await stack.apiAs(admin, 'GET', door);
    expect(read.status, await read.clone().text()).toBe(200);
    const state = dataOf(await read.json());
    expect(state).toMatchObject({ connector: NAME, status: 'not_connected' });
    // The URI an administrator registers with the vendor, answered before any
    // client exists: the deployment's origin plus the callback path.
    const origin = String(process.env.OS_AUTH_URL || process.env.OS_BASE_URL).trim().replace(/\/+$/, '');
    expect(state.redirectUri).toBe(`${origin}/api/v1/automation/connectors/oauth/callback`);
  });

  it('⛔ a begin with no client is refused 400 VALIDATION_ERROR, naming the vendor registration step; nothing is stored', async () => {
    const res = await stack.apiAs(admin, 'POST', door);
    const json = (await res.json()) as any;
    expect(res.status, JSON.stringify(json).slice(0, 400)).toBe(400);
    expect(errorOf(json).code).toBe('VALIDATION_ERROR');
    expect(errorOf(json).message).toContain(`Connector instance '${NAME}' takes its OAuth client from the installer`);
    expect(errorOf(json).message).toContain('Register an OAuth client for this deployment with the vendor');
    expect(tokenRequests).toHaveLength(0);
    expect(await stored()).toHaveLength(0);
  });

  it('⛔ a begin body carrying another key is refused 400 naming the key, never repeating a value', async () => {
    const res = await stack.apiAs(admin, 'POST', door, { clientId: INSTALLER_ID, clientSecret: INSTALLER_SECRET, client_secret: INSTALLER_SECRET });
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(400);
    expect(errorOf(JSON.parse(text)).code).toBe('VALIDATION_ERROR');
    expect(text).toContain('`client_secret`');
    expect(text).not.toContain(INSTALLER_SECRET);
    expect(tokenRequests).toHaveLength(0);
    expect(await stored()).toHaveLength(0);
  });

  it("CONNECTED: authorizes and exchanges as the administrator's client; the read names it, never its secret; revoke removes it", async () => {
    const begun = await stack.apiAs(admin, 'POST', door, { clientId: INSTALLER_ID, clientSecret: INSTALLER_SECRET });
    const beginText = await begun.text();
    expect(begun.status, beginText.slice(0, 400)).toBe(200);
    expect(beginText).not.toContain(INSTALLER_SECRET);
    const authorizationUrl = new URL(dataOf(JSON.parse(beginText)).authorizationUrl);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(`${idpUrl}/authorize`);
    expect(authorizationUrl.searchParams.get('client_id')).toBe(INSTALLER_ID);
    // The connect names the very redirect URI the read showed.
    const shown = dataOf(await (await stack.apiAs(admin, 'GET', door)).json()).redirectUri;
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(shown);
    const state = authorizationUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await stack.apiAs(
      admin, 'GET', `/automation/connectors/oauth/callback?state=${encodeURIComponent(state!)}&code=${CODE}`,
    );
    const callbackText = await callback.text();
    expect(callback.status, callbackText.slice(0, 400)).toBe(200);
    expect(callbackText).not.toContain(INSTALLER_SECRET);
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0].authorization).toBe(basicOf(INSTALLER_ID, INSTALLER_SECRET));
    expect(tokenRequests[0].form.get('grant_type')).toBe('authorization_code');
    expect(tokenRequests[0].form.get('code')).toBe(CODE);

    const read = await stack.apiAs(admin, 'GET', door);
    const readText = await read.text();
    expect(read.status, readText.slice(0, 400)).toBe(200);
    expect(dataOf(JSON.parse(readText))).toMatchObject({
      connector: NAME,
      status: 'connected',
      client: { source: 'installer', clientId: INSTALLER_ID, hasSecret: true },
    });
    expect(readText).not.toContain(INSTALLER_SECRET);
    expect(readText).not.toContain(REFRESH_TOKEN);

    const [row] = await stored();
    expect(row).toMatchObject({ connector_name: NAME, client_id: INSTALLER_ID });
    expect(JSON.stringify(row)).not.toContain(INSTALLER_SECRET);

    // A reconnect naming no client reuses the kept one: the Console never
    // reads the secret back, so it could never resend it.
    const reconnect = await stack.apiAs(admin, 'POST', door);
    const reconnectText = await reconnect.text();
    expect(reconnect.status, reconnectText.slice(0, 400)).toBe(200);
    expect(reconnectText).not.toContain(INSTALLER_SECRET);
    expect(new URL(dataOf(JSON.parse(reconnectText)).authorizationUrl).searchParams.get('client_id')).toBe(INSTALLER_ID);

    const revoked = await stack.apiAs(admin, 'DELETE', door);
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    expect(dataOf(await revoked.json())).toMatchObject({ connector: NAME, status: 'not_connected' });
    expect(await stored()).toHaveLength(0);
  });
});
