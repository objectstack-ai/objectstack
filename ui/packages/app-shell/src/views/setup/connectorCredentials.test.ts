// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connector credential door as the console reads it (ruling A on
 * objectstack#27230) — the rules both the Setup page and the install step
 * stand on:
 *
 *   1. **read** — a listing is `listed` only from the success envelope's
 *      `data.credentialRefs`; `404` / `405` is "not served", `403` / `501` /
 *      `503` a configuration conclusion in the server's own words, anything
 *      else a failure. A malformed row is dropped, never guessed at.
 *   2. **write** — `PUT` carries exactly `{ value }`; an EMPTY value is not
 *      sent at all (it means "unchanged"); `DELETE` carries no body. A write's
 *      answer is the reference's entry, or the refusal's own message.
 *   3. **the install step's filter** — the references a package's connectors
 *      name that an administrator can still act on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorCredentialRef } from '@objectstack/spec/contracts';
import {
  CONNECTOR_CREDENTIALS_REF,
  clearConnectorCredential,
  connectorCredentialsPagePath,
  fetchCredentialListing,
  putConnectorCredential,
  readCredentialListing,
  readCredentialWrite,
  refsAwaitingPackage,
} from './connectorCredentials';

const DOOR = '/api/v1/automation/connectors/credential-refs';

function entry(over: Partial<ConnectorCredentialRef> & { ref: string }): ConnectorCredentialRef {
  return {
    status: 'missing',
    source: null,
    writable: true,
    declared: true,
    connectors: [{ name: 'billing_api', packageId: 'com.acme.billing', state: 'degraded' }],
    ...over,
  };
}

const errorEnvelope = (code: string, message: string) => ({ success: false, error: { code, message } });

let calls: Array<{ url: string; method: string; body: unknown }>;
let next: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  next = { status: 200, body: { success: true, data: { credentialRefs: [], total: 0 } } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase(), body: init?.body });
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading the listing', () => {
  it('lists the refs of the success envelope, dropping a malformed row', () => {
    const good = entry({ ref: 'BILLING_API_TOKEN' });
    const out = readCredentialListing(200, {
      success: true,
      data: { credentialRefs: [good, { ref: '', status: 'set', connectors: [] }, { ref: 'X', status: 'weird', connectors: [] }], total: 3 },
    });
    expect(out).toEqual({ kind: 'listed', refs: [good] });
  });

  it.each([404, 405])('%s is "not served", not a failure', (status) => {
    expect(readCredentialListing(status, errorEnvelope('NOT_FOUND', 'no route'))).toEqual({ kind: 'not-served' });
  });

  it.each([
    [403, "Connector credentials are environment-level, and this environment runs the 'group' tenancy posture, where several organizations share it, so this door does not store or list them here."],
    [501, 'The automation service does not implement listConnectorCredentialRefs.'],
    [503, 'No crypto provider is registered.'],
  ])('%s is a configuration conclusion carrying the server sentence verbatim', (status, message) => {
    expect(readCredentialListing(status, errorEnvelope('X', message))).toEqual({ kind: 'unavailable', status, message });
  });

  it('a 500 is a failure, with the server message', () => {
    expect(readCredentialListing(500, errorEnvelope('INTERNAL', 'boom'))).toEqual({ kind: 'failed', message: 'boom' });
  });

  it('a 200 with no data.credentialRefs is a failure, never an empty list', () => {
    expect(readCredentialListing(200, { credentialRefs: [] }).kind).toBe('failed');
    expect(readCredentialListing(200, { success: true, data: {} }).kind).toBe('failed');
  });

  it('fetches the door with the session cookie and no cache', async () => {
    next = { status: 200, body: { success: true, data: { credentialRefs: [entry({ ref: 'A' })], total: 1 } } };
    const out = await fetchCredentialListing();
    expect(out.kind).toBe('listed');
    expect(calls).toEqual([{ url: DOOR, method: 'GET', body: undefined }]);
    const init = (fetch as unknown as { mock: { calls: Array<[unknown, RequestInit]> } }).mock.calls[0][1];
    expect(init.credentials).toBe('include');
    expect(init.cache).toBe('no-store');
  });

  it('a network failure is a failure, not an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await fetchCredentialListing()).toEqual({ kind: 'failed', message: 'Failed to fetch' });
  });
});

describe('writing', () => {
  it('PUT sends exactly { value } to the encoded reference, and answers the entry', async () => {
    const answered = entry({ ref: 'MY TOKEN', status: 'set', source: 'object' });
    next = { status: 200, body: { success: true, data: answered } };
    const out = await putConnectorCredential('MY TOKEN', 'dummy-value');
    expect(out).toEqual({ ok: true, entry: answered });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DOOR}/MY%20TOKEN`);
    expect(calls[0].method).toBe('PUT');
    expect(JSON.parse(String(calls[0].body))).toEqual({ value: 'dummy-value' });
  });

  it('an empty value is not sent: it means "leave it unchanged"', async () => {
    expect(await putConnectorCredential('BILLING_API_TOKEN', '')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('a refusal answers the server message and status', async () => {
    const message = "Credential 'BILLING_API_TOKEN' is supplied by an environment variable of the same name, which always wins.";
    next = { status: 409, body: errorEnvelope('CONFLICT', message) };
    expect(await putConnectorCredential('BILLING_API_TOKEN', 'dummy-value')).toEqual({ ok: false, status: 409, message });
  });

  it('DELETE carries no body, and answers the entry', async () => {
    const answered = entry({ ref: 'BILLING_API_TOKEN', status: 'missing', source: null });
    next = { status: 200, body: { success: true, data: answered } };
    expect(await clearConnectorCredential('BILLING_API_TOKEN')).toEqual({ ok: true, entry: answered });
    expect(calls).toEqual([{ url: `${DOOR}/BILLING_API_TOKEN`, method: 'DELETE', body: undefined }]);
  });

  it('a 2xx without the entry is not read as a success', () => {
    expect(readCredentialWrite(200, { success: true, data: { ok: true } }).ok).toBe(false);
  });
});

describe('the references an install step offers', () => {
  const PKG = 'com.acme.billing';

  it('keeps the package\'s references that are not set, declared and writable', () => {
    const missing = entry({ ref: 'A' });
    const rejected = entry({ ref: 'B', status: 'rejected', source: 'object', statusReason: '401 Unauthorized' });
    const set = entry({ ref: 'C', status: 'set', source: 'object' });
    const env = entry({ ref: 'D', status: 'rejected', source: 'env', writable: false });
    const otherPackage = entry({ ref: 'E', connectors: [{ name: 'crm_api', packageId: 'com.acme.crm' }] });
    const undeclared = entry({ ref: 'F', declared: false, connectors: [] });
    expect(refsAwaitingPackage([missing, rejected, set, env, otherPackage, undeclared], PKG)).toEqual([missing, rejected]);
  });

  it('matches any connector of the reference, not only the first', () => {
    const shared = entry({
      ref: 'SHARED',
      connectors: [{ name: 'crm_api', packageId: 'com.acme.crm' }, { name: 'billing_api', packageId: PKG }],
    });
    expect(refsAwaitingPackage([shared], PKG)).toEqual([shared]);
  });
});

describe('the page path', () => {
  it('is the Setup component route the entry\'s ref builds', () => {
    expect(CONNECTOR_CREDENTIALS_REF).toBe('automation:connector-credentials');
    expect(connectorCredentialsPagePath()).toBe('/apps/setup/component/automation/connector-credentials');
  });
});
