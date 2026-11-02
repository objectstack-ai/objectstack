// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D2.1 / D2.2 — the two grant-bearing kinds of declarative connector
// instance auth, `oauth2` and `app-credential`, as an author meets them at the
// publish door (`DeclarativeConnectorEntrySchema`, which both authoring doors
// parse). Every refusal is pinned by its issue `code` and `path`, the located
// error the ADR's Acceptance asks for; every member has a CONTROL accept, so a
// refusal that fired on everything could not pass.

import { describe, it, expect } from 'vitest';
import { DeclarativeConnectorEntrySchema, ConnectorInstanceAuthSchema } from './connector.zod';

const entry = (auth: unknown, over: Record<string, unknown> = {}) => ({
  name: 'vendor',
  label: 'Vendor',
  type: 'api',
  provider: 'openapi',
  providerConfig: { spec: 'https://vendor.example.com/openapi.json' },
  auth,
  ...over,
});

const mcpHttp = { provider: 'mcp', providerConfig: { transport: { kind: 'http', url: 'https://mcp.example.com/mcp' } } };

const authorizationCode = {
  type: 'oauth2',
  grant: 'authorization_code',
  authorizationUrl: 'https://vendor.example.com/oauth/authorize',
  tokenUrl: 'https://vendor.example.com/oauth/token',
  scopes: ['crm.read'],
  clientId: 'client-123',
  credentialRef: 'VENDOR_CLIENT_SECRET',
};

const clientCredentials = {
  type: 'oauth2',
  grant: 'client_credentials',
  tokenUrl: 'https://vendor.example.com/oauth/token',
  resource: 'https://api.vendor.example.com',
  clientId: 'client-123',
  credentialRef: 'VENDOR_CLIENT_SECRET',
};

const appCredential = { type: 'app-credential', vendor: 'feishu', appId: 'cli_a1b2', credentialRef: 'FEISHU_APP_SECRET' };

/** The issues of a refused parse, as `code @ path` — what each refusal pins. */
function located(input: unknown): string[] {
  const result = DeclarativeConnectorEntrySchema.safeParse(input);
  expect(result.success, 'the entry must be refused').toBe(false);
  return result.error!.issues.map((i) => `${i.code} @ ${i.path.join('.')}`);
}

describe('ADR-0143 D2.1 — `oauth2` instance auth', () => {
  it('CONTROL: accepts authorization_code with endpoints, client id and the secret as a reference', () => {
    const parsed = DeclarativeConnectorEntrySchema.parse(entry(authorizationCode));
    expect(parsed.auth).toEqual(authorizationCode);
  });

  it('CONTROL: accepts a public authorization_code client (no client secret)', () => {
    const { credentialRef: _omitted, ...publicClient } = authorizationCode;
    expect(DeclarativeConnectorEntrySchema.safeParse(entry(publicClient)).success).toBe(true);
  });

  it('CONTROL: accepts client_credentials with a token endpoint, client id and secret reference', () => {
    expect(DeclarativeConnectorEntrySchema.parse(entry(clientCredentials)).auth).toEqual(clientCredentials);
  });

  it("CONTROL: accepts `provider: 'mcp'` over http with the endpoints and the client id omitted", () => {
    const parsed = DeclarativeConnectorEntrySchema.parse(entry({ type: 'oauth2', grant: 'authorization_code' }, mcpHttp));
    expect(parsed.auth).toEqual({ type: 'oauth2', grant: 'authorization_code' });
  });

  it("CONTROL: accepts `provider: 'mcp'` over http with a pre-registered client id and secret", () => {
    const { authorizationUrl: _a, tokenUrl: _t, ...preRegistered } = authorizationCode;
    expect(DeclarativeConnectorEntrySchema.safeParse(entry(preRegistered, mcpHttp)).success).toBe(true);
  });

  it('refuses each missing endpoint and the missing client id, located under `auth`', () => {
    expect(located(entry({ type: 'oauth2', grant: 'authorization_code' }))).toEqual([
      'custom @ auth.tokenUrl',
      'custom @ auth.clientId',
      'custom @ auth.authorizationUrl',
    ]);
    const { tokenUrl: _t, ...noToken } = clientCredentials;
    expect(located(entry(noToken))).toEqual(['custom @ auth.tokenUrl']);
  });

  it("refuses the omission on an mcp instance over stdio: only http runs the MCP authorization flow", () => {
    const stdio = { provider: 'mcp', providerConfig: { transport: { kind: 'stdio', command: 'vendor-mcp' } } };
    expect(located(entry({ type: 'oauth2', grant: 'authorization_code' }, stdio))).toEqual([
      'custom @ auth.tokenUrl',
      'custom @ auth.clientId',
      'custom @ auth.authorizationUrl',
    ]);
  });

  it('refuses an unknown grant at `auth.grant`', () => {
    expect(located(entry({ ...authorizationCode, grant: 'password' }))).toEqual(['invalid_union @ auth.grant']);
  });

  it('refuses an inline client secret by name, pointing at credentialRef', () => {
    const result = DeclarativeConnectorEntrySchema.safeParse(entry({ ...authorizationCode, clientSecret: 'shh' }));
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0]!;
    expect([issue.code, issue.path.join('.')]).toEqual(['unrecognized_keys', 'auth']);
    expect((issue as { keys?: string[] }).keys).toEqual(['clientSecret']);
    expect(issue.message).toContain('credentialRef');
  });

  it('refuses an inline client secret on client_credentials too', () => {
    const result = DeclarativeConnectorEntrySchema.safeParse(entry({ ...clientCredentials, clientSecret: 'shh' }));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => [i.code, i.path.join('.'), (i as { keys?: string[] }).keys])).toEqual([
      ['unrecognized_keys', 'auth', ['clientSecret']],
    ]);
  });

  it('refuses a refresh token: tokens are runtime state, never metadata', () => {
    const result = DeclarativeConnectorEntrySchema.safeParse(entry({ ...authorizationCode, refreshToken: 'r1' }));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => [i.code, i.path.join('.'), (i as { keys?: string[] }).keys])).toEqual([
      ['unrecognized_keys', 'auth', ['refreshToken']],
    ]);
  });

  it('refuses `authorizationUrl` on client_credentials, which has no authorization step', () => {
    const result = DeclarativeConnectorEntrySchema.safeParse(
      entry({ ...clientCredentials, authorizationUrl: 'https://vendor.example.com/oauth/authorize' }),
    );
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => [i.code, i.path.join('.'), (i as { keys?: string[] }).keys])).toEqual([
      ['unrecognized_keys', 'auth', ['authorizationUrl']],
    ]);
  });

  it('refuses a client secret without its client id', () => {
    const { clientId: _c, ...secretOnly } = authorizationCode;
    expect(located(entry(secretOnly, mcpHttp))).toEqual(['custom @ auth.credentialRef']);
  });

  it('refuses client_credentials without its secret: the grant is for a confidential client', () => {
    const { credentialRef: _r, ...noSecret } = clientCredentials;
    expect(located(entry(noSecret))).toEqual(['custom @ auth.credentialRef']);
  });

  it('has no PKCE switch: S256 is always on', () => {
    const result = DeclarativeConnectorEntrySchema.safeParse(entry({ ...authorizationCode, pkce: false }));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => [i.code, i.path.join('.'), (i as { keys?: string[] }).keys])).toEqual([
      ['unrecognized_keys', 'auth', ['pkce']],
    ]);
  });
});

// ADR-0143 D2.1, amended 2026-11-02 (#28702 letter B): the administrator of
// each deployment registers their own OAuth client with the vendor, against
// that deployment's callback, and enters it on the instance's connection. The
// definition says so with `clientSource: 'installer'` and names no client.
describe("ADR-0143 D2.1 — an `authorization_code` client supplied by the installer (`clientSource: 'installer'`)", () => {
  const { clientId: _c, credentialRef: _r, ...endpointsOnly } = authorizationCode;
  const installer = { ...endpointsOnly, clientSource: 'installer' };

  it('CONTROL: accepts the installer form with the endpoints and no client, on a non-MCP provider', () => {
    const parsed = DeclarativeConnectorEntrySchema.parse(entry(installer));
    expect(parsed.auth).toEqual(installer);
  });

  it("CONTROL: accepts the installer form on `provider: 'mcp'` over http, with the endpoints left to discovery", () => {
    const auth = { type: 'oauth2', grant: 'authorization_code', clientSource: 'installer' };
    expect(DeclarativeConnectorEntrySchema.parse(entry(auth, mcpHttp)).auth).toEqual(auth);
  });

  it('keeps a packaged `clientId` accepted without `clientSource` (the declared form, for a private app)', () => {
    // The existing accept set does not move: the same input parses before and
    // after the amendment. Refusing it would be a narrowing beside this widening.
    expect(DeclarativeConnectorEntrySchema.safeParse(entry(authorizationCode)).success).toBe(true);
  });

  it('refuses a packaged `clientId` beside `clientSource`, located at `auth.clientId`', () => {
    expect(located(entry({ ...installer, clientId: 'client-123' }))).toEqual(['custom @ auth.clientId']);
    expect(located(entry({ ...installer, clientId: 'client-123', credentialRef: 'VENDOR_CLIENT_SECRET' }))).toEqual([
      'custom @ auth.clientId',
    ]);
    expect(located(entry({ ...installer, clientId: 'client-123' }, mcpHttp))).toEqual(['custom @ auth.clientId']);
  });

  it('refuses a client-secret reference with the installer form: the secret is entered on the connection with its client', () => {
    expect(located(entry({ ...installer, credentialRef: 'VENDOR_CLIENT_SECRET' }))).toEqual(['custom @ auth.credentialRef']);
  });

  it('still requires the endpoints off MCP-over-http: the installer owns the client, not the authorization server', () => {
    expect(located(entry({ type: 'oauth2', grant: 'authorization_code', clientSource: 'installer' }))).toEqual([
      'custom @ auth.tokenUrl',
      'custom @ auth.authorizationUrl',
    ]);
  });

  it('refuses an unknown `clientSource` value at `auth.clientSource`', () => {
    expect(located(entry({ ...installer, clientSource: 'publisher' }))).toEqual(['invalid_value @ auth.clientSource']);
  });

  it('refuses `clientSource` on `client_credentials`, which keeps no connection to hold the client', () => {
    const result = DeclarativeConnectorEntrySchema.safeParse(entry({ ...clientCredentials, clientSource: 'installer' }));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => [i.code, i.path.join('.'), (i as { keys?: string[] }).keys])).toEqual([
      ['unrecognized_keys', 'auth', ['clientSource']],
    ]);
  });

  it('the definition carries no client and no secret: the declared keys are the endpoints, the scopes and the source', () => {
    const parsed = DeclarativeConnectorEntrySchema.parse(entry(installer));
    expect(Object.keys(parsed.auth as object).sort()).toEqual(
      ['authorizationUrl', 'clientSource', 'grant', 'scopes', 'tokenUrl', 'type'],
    );
  });
});

describe('ADR-0143 D2.2 — `app-credential` instance auth', () => {
  it('CONTROL: accepts each vendor with an app id and the app secret as a reference', () => {
    for (const vendor of ['feishu', 'dingtalk', 'wecom']) {
      const auth = { ...appCredential, vendor };
      expect(DeclarativeConnectorEntrySchema.parse(entry(auth, { provider: 'rest', providerConfig: {} })).auth).toEqual(auth);
    }
  });

  it('refuses an unknown vendor at `auth.vendor`', () => {
    expect(located(entry({ ...appCredential, vendor: 'lark' }))).toEqual(['invalid_value @ auth.vendor']);
  });

  it('refuses an inline app secret by name, pointing at credentialRef', () => {
    const result = DeclarativeConnectorEntrySchema.safeParse(entry({ ...appCredential, appSecret: 'shh' }));
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0]!;
    expect([issue.code, issue.path.join('.'), (issue as { keys?: string[] }).keys]).toEqual([
      'unrecognized_keys', 'auth', ['appSecret'],
    ]);
    expect(issue.message).toContain('credentialRef');
  });

  it('requires the app secret reference', () => {
    const { credentialRef: _r, ...noSecret } = appCredential;
    expect(located(entry(noSecret))).toEqual(['invalid_type @ auth.credentialRef']);
  });
});

describe('ConnectorInstanceAuthSchema — closed', () => {
  it('refuses an unknown kind (`signed` is pinned in connector-auth-signed.test.ts)', () => {
    for (const type of ['oauth1', 'hmac']) {
      const result = ConnectorInstanceAuthSchema.safeParse({ type, credentialRef: 'X' });
      expect(result.success).toBe(false);
      expect(result.error!.issues.map((i) => `${i.code} @ ${i.path.join('.')}`)).toEqual(['invalid_union @ type']);
    }
  });
});
