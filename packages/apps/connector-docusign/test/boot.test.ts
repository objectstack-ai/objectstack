// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Boot test: the app, booted the way `objectstack serve` composes it
 * (`bootStack` from `@objectstack/verify`), against a FAKE DocuSign — no call
 * reaches DocuSign.
 *
 * Two substitutions, both at the HTTP edge. The app's own
 * `ConnectorOpenApiPlugin` is replaced (by plugin name,
 * `BootOptions.extraPlugins`) with one whose `fetchImpl` answers DocuSign's
 * eSignature API from fixtures and records every request; and the global
 * `fetch` answers DocuSign's sandbox token endpoint — the one call the
 * platform's OAuth grant makes — and passes every other request through.
 * Everything else is the shipped app: the connector entry, the trimmed
 * document it reads from this package's root, the object, the flows, and the
 * administrator's path to a working instance — boot (the instance is "not
 * connected"), read the redirect URI to register, connect with their own
 * DocuSign integration key through the connection door, come back through the
 * OAuth callback, run the flows.
 *
 * Every credential below is an obviously-fake placeholder.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
// Paid at module load, before vitest's clocked windows: both reach the whole
// runtime.
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import stack from '../objectstack.config.js';
import { DOCUSIGN_ENVELOPE_OPERATIONS, DOCUSIGN_SANDBOX } from '../src/connectors/docusign.connector.js';

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const NAME = 'docusign';
const door = `/automation/connectors/${NAME}/connection`;
const ORIGIN = 'https://deployment.example.com';
const CALLBACK = `${ORIGIN}/api/v1/automation/connectors/oauth/callback`;

const INTEGRATION_KEY = 'TEST_PLACEHOLDER_INTEGRATION_KEY';
const SECRET_KEY = 'TEST_PLACEHOLDER_SECRET_KEY';
const CODE = 'TEST_PLACEHOLDER_AUTHORIZATION_CODE';
const ACCESS_TOKEN = 'TEST_PLACEHOLDER_ACCESS_TOKEN';
const REFRESH_TOKEN = 'TEST_PLACEHOLDER_REFRESH_TOKEN';
const ACCOUNT = 'fixture-account';
const API = `${DOCUSIGN_SANDBOX.baseUrl}/v2.1/accounts/${ACCOUNT}`;

interface Recorded {
  method: string;
  url: string;
  authorization: string | null;
  body?: unknown;
}

interface Descriptor {
  name: string;
  state?: string;
  degradedReason?: string;
  actions?: Array<{ key: string }>;
}

const dataOf = (json: any): any => json?.data ?? json;
const basicOf = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

/** What the fake DocuSign API answers, by method and path. */
function fixture(method: string, url: URL, body: any): { status: number; body: unknown } {
  const base = `/restapi/v2.1/accounts/${ACCOUNT}/envelopes`;
  if (method === 'POST' && url.pathname === base) {
    if (body?.emailSubject === 'refuse me') {
      return { status: 400, body: { errorCode: 'INVALID_REQUEST_BODY', message: 'fixture refusal' } };
    }
    return {
      status: 201,
      body: { envelopeId: 'env-fixture-1', status: 'sent', statusDateTime: '2026-11-03T05:00:00.0000000Z', uri: '/envelopes/env-fixture-1' },
    };
  }
  if (method === 'GET' && url.pathname === `${base}/env-fixture-1`) {
    return {
      status: 200,
      body: { envelopeId: 'env-fixture-1', status: 'delivered', statusChangedDateTime: '2026-11-03T05:10:00.0000000Z' },
    };
  }
  if (method === 'GET' && url.pathname === base) {
    return {
      status: 200,
      body: {
        resultSetSize: '2',
        envelopes: [
          { envelopeId: 'env-fixture-1', status: 'completed', statusChangedDateTime: '2026-11-03T05:20:00.0000000Z' },
          { envelopeId: 'env-not-sent-here', status: 'voided', statusChangedDateTime: '2026-11-03T05:21:00.0000000Z' },
        ],
      },
    };
  }
  return { status: 404, body: { errorCode: 'NOT_FOUND', message: `fixture has no answer for ${method} ${url.pathname}` } };
}

describe('connector-docusign app — boot, connect with the installer client, and run against a fake DocuSign', () => {
  const requests: Recorded[] = [];
  const tokenRequests: Array<{ form: URLSearchParams; authorization: string | null }> = [];
  let booted: VerifyStack;
  let admin: string;
  const realFetch = globalThis.fetch;
  const savedOrigin = { auth: process.env.OS_AUTH_URL, base: process.env.OS_BASE_URL };

  const descriptor = async (): Promise<Descriptor | undefined> => {
    const res = await booted.apiAs(admin, 'GET', '/automation/connectors');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { connectors?: Descriptor[] } };
    return body.data?.connectors?.find((c) => c.name === NAME);
  };

  const envelopes = async (): Promise<Array<Record<string, unknown>>> => {
    const res = await booted.apiAs(admin, 'GET', '/data/docusign_envelope');
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(200);
    const json = JSON.parse(text) as any;
    const rows = json?.data?.records ?? json?.records ?? json?.data ?? json?.value ?? [];
    return Array.isArray(rows) ? rows : [];
  };

  beforeAll(async () => {
    // The redirect URI is the deployment's fixed origin (ADR-0143 D5).
    delete process.env.OS_AUTH_URL;
    process.env.OS_BASE_URL = ORIGIN;
    // DocuSign's sandbox token endpoint, answered here; nothing else is touched.
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href === DOCUSIGN_SANDBOX.tokenUrl) {
        tokenRequests.push({
          form: new URLSearchParams(String(init?.body ?? '')),
          authorization: new Headers(init?.headers).get('authorization'),
        });
        return new Response(
          JSON.stringify({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, token_type: 'Bearer', expires_in: 28800 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ method, url: url.href, authorization: headers.get('authorization'), ...(body === undefined ? {} : { body }) });
      const answer = fixture(method, url, body);
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
    };
    booted = await bootStack(stack, {
      hostRoot: APP_ROOT,
      extraPlugins: [new ConnectorOpenApiPlugin({ fetchImpl })],
    });
    admin = await booted.signIn();
  }, 120_000);

  afterAll(async () => {
    await booted?.stop();
    globalThis.fetch = realFetch;
    if (savedOrigin.base === undefined) delete process.env.OS_BASE_URL;
    else process.env.OS_BASE_URL = savedOrigin.base;
    if (savedOrigin.auth !== undefined) process.env.OS_AUTH_URL = savedOrigin.auth;
  });

  it('before a connect the instance is degraded "not connected", and the read answers the redirect URI to register', async () => {
    const docusign = await descriptor();
    expect(docusign, 'docusign is not in the connector registry').toBeDefined();
    expect(docusign!.state).toBe('degraded');
    expect(docusign!.degradedReason).toContain('not connected');
    const read = await booted.apiAs(admin, 'GET', door);
    const text = await read.text();
    expect(read.status, text.slice(0, 400)).toBe(200);
    expect(dataOf(JSON.parse(text))).toMatchObject({ connector: NAME, status: 'not_connected', redirectUri: CALLBACK });
    expect(requests).toEqual([]);
    expect(tokenRequests).toEqual([]);
  });

  it('a flow run before the connect fails and sends nothing to DocuSign', async () => {
    const res = await booted.apiAs(admin, 'POST', '/automation/docusign_get_envelope/trigger', {
      params: { account_id: ACCOUNT, envelope_id: 'env-fixture-1' },
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(400);
    const error = (JSON.parse(text) as { error?: { code?: string; message?: string } }).error;
    expect(error?.code).toBe('FLOW_FAILED');
    // The README's promise: the failure names the connector and why.
    expect(error?.message).toContain(`'${NAME}'`);
    expect(error?.message).toContain('not connected');
    expect(requests).toEqual([]);
  });

  it('a connect that names no client is refused 400, naming the vendor registration step', async () => {
    const res = await booted.apiAs(admin, 'POST', door);
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(400);
    const error = (JSON.parse(text) as { error?: { code?: string; message?: string } }).error;
    expect(error?.code).toBe('VALIDATION_ERROR');
    expect(error?.message).toContain('Register an OAuth client for this deployment with the vendor');
    expect(error?.message).toContain(CALLBACK);
    expect(tokenRequests).toEqual([]);
  });

  it("connects as the administrator's integration key: DocuSign's sandbox sign-in, then the code exchange in HTTP Basic", async () => {
    const begun = await booted.apiAs(admin, 'POST', door, { clientId: INTEGRATION_KEY, clientSecret: SECRET_KEY });
    const beginText = await begun.text();
    expect(begun.status, beginText.slice(0, 400)).toBe(200);
    expect(beginText).not.toContain(SECRET_KEY);
    const authorizationUrl = new URL(dataOf(JSON.parse(beginText)).authorizationUrl);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(DOCUSIGN_SANDBOX.authorizationUrl);
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizationUrl.searchParams.get('client_id')).toBe(INTEGRATION_KEY);
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(CALLBACK);
    expect(authorizationUrl.searchParams.get('scope')).toBe('signature');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    const state = authorizationUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await booted.apiAs(
      admin, 'GET', `/automation/connectors/oauth/callback?state=${encodeURIComponent(state!)}&code=${CODE}`,
    );
    const callbackText = await callback.text();
    expect(callback.status, callbackText.slice(0, 400)).toBe(200);
    expect(callbackText).not.toContain(SECRET_KEY);
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0].authorization).toBe(basicOf(INTEGRATION_KEY, SECRET_KEY));
    expect(tokenRequests[0].form.get('grant_type')).toBe('authorization_code');
    expect(tokenRequests[0].form.get('code')).toBe(CODE);
    expect(tokenRequests[0].form.get('redirect_uri')).toBe(CALLBACK);

    const read = await booted.apiAs(admin, 'GET', door);
    const readText = await read.text();
    expect(read.status, readText.slice(0, 400)).toBe(200);
    expect(readText).not.toContain(SECRET_KEY);
    expect(dataOf(JSON.parse(readText))).toMatchObject({
      connector: NAME,
      status: 'connected',
      client: { source: 'installer', clientId: INTEGRATION_KEY, hasSecret: true },
    });
    // Connecting calls DocuSign's account server only, never its API.
    expect(requests).toEqual([]);
  });

  it('once connected, it materializes with exactly the three envelope operations', async () => {
    let docusign = await descriptor();
    for (let i = 0; i < 100 && docusign?.state !== 'ready'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      docusign = await descriptor();
    }
    expect(docusign?.state, docusign?.degradedReason).toBe('ready');
    expect(docusign!.actions?.map((a) => a.key).sort()).toEqual([...DOCUSIGN_ENVELOPE_OPERATIONS].sort());
  });

  it('docusign_send_envelope posts the envelope to the sandbox as the bearer of the token, and records it', async () => {
    const res = await booted.apiAs(admin, 'POST', '/automation/docusign_send_envelope/trigger', {
      params: {
        account_id: ACCOUNT,
        email_subject: 'Please sign the contract',
        document_name: 'contract.pdf',
        document_base64: 'JVBERi0xLjQK',
        signer_name: 'Ada Lovelace',
        signer_email: 'ada@example.com',
      },
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 600)).toBe(200);
    expect(requests.at(-1)).toEqual({
      method: 'POST',
      url: `${API}/envelopes`,
      authorization: `Bearer ${ACCESS_TOKEN}`,
      body: {
        emailSubject: 'Please sign the contract',
        status: 'sent',
        documents: [{ documentId: '1', name: 'contract.pdf', documentBase64: 'JVBERi0xLjQK' }],
        recipients: { signers: [{ recipientId: '1', routingOrder: '1', name: 'Ada Lovelace', email: 'ada@example.com' }] },
      },
    });
    expect(text).toContain('env-fixture-1');
    const rows = await envelopes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      envelope_id: 'env-fixture-1',
      signature_status: 'sent',
      email_subject: 'Please sign the contract',
      status_changed_at: '2026-11-03T05:00:00.0000000Z',
    });
  });

  it('a refused envelope lands in the step output and writes no record', async () => {
    const res = await booted.apiAs(admin, 'POST', '/automation/docusign_send_envelope/trigger', {
      params: {
        account_id: ACCOUNT,
        email_subject: 'refuse me',
        document_name: 'contract.pdf',
        document_base64: 'JVBERi0xLjQK',
        signer_name: 'Ada Lovelace',
        signer_email: 'ada@example.com',
      },
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 600)).toBe(200);
    expect(text).toContain('INVALID_REQUEST_BODY');
    expect(await envelopes()).toHaveLength(1);
  });

  it("docusign_get_envelope reads one envelope and refreshes its record's signature status", async () => {
    const res = await booted.apiAs(admin, 'POST', '/automation/docusign_get_envelope/trigger', {
      params: { account_id: ACCOUNT, envelope_id: 'env-fixture-1' },
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 600)).toBe(200);
    expect(requests.at(-1)).toEqual({
      method: 'GET',
      url: `${API}/envelopes/env-fixture-1`,
      authorization: `Bearer ${ACCESS_TOKEN}`,
    });
    const rows = await envelopes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ signature_status: 'delivered', status_changed_at: '2026-11-03T05:10:00.0000000Z' });
  });

  it('docusign_poll_status_changes lists changes since from_date and copies each status onto its record', async () => {
    const res = await booted.apiAs(admin, 'POST', '/automation/docusign_poll_status_changes/trigger', {
      params: { account_id: ACCOUNT, from_date: '2026-11-03T00:00:00Z' },
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 600)).toBe(200);
    const sent = requests.at(-1)!;
    expect(sent.method).toBe('GET');
    expect(sent.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    const url = new URL(sent.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${API}/envelopes`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ from_date: '2026-11-03T00:00:00Z', count: '100' });
    // The envelope this app sent takes DocuSign's status; the one it did not
    // send matches no record and writes none.
    const rows = await envelopes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      envelope_id: 'env-fixture-1',
      signature_status: 'completed',
      status_changed_at: '2026-11-03T05:20:00.0000000Z',
    });
  });

  it("every API request went to DocuSign's sandbox host, as the bearer of the connection's token", () => {
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(new URL(r.url).origin).toBe('https://demo.docusign.net');
      expect(r.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    }
    // One code exchange; the token outlived the run, so no refresh followed.
    expect(tokenRequests).toHaveLength(1);
  });
});
