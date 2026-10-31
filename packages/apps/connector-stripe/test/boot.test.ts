// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Boot test: the app, booted the way `objectstack serve` composes it
 * (`bootStack` from `@objectstack/verify`), materializes its declarative
 * `stripe` instance from the PACKAGED document against a FAKE Stripe — no
 * call reaches Stripe.
 *
 * The one substitution is the HTTP transport: the app's own
 * `ConnectorOpenApiPlugin` is replaced (by plugin name,
 * `BootOptions.extraPlugins`) with one whose `fetchImpl` answers from a
 * fixture and records every request it was handed. Everything else is the
 * shipped app: the connector entry, the trimmed document it reads from this
 * package's root, the flows, and the administrator's path to a working
 * instance — boot with no credential (the instance is degraded, naming the
 * reference), set the value through the credential door, run a flow.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
// Paid at module load, before vitest's clocked windows: both reach the whole
// runtime.
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import stack from '../objectstack.config.js';
import { STRIPE_READ_OPERATIONS } from '../src/connectors/stripe.connector.js';

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REF = 'STRIPE_RESTRICTED_KEY';
const FIXTURE_KEY = 'fixture-restricted-key-not-real';

interface Recorded {
  method: string;
  url: string;
  authorization: string | null;
}

interface Descriptor {
  name: string;
  state?: string;
  degradedReason?: string;
  actions?: Array<{ key: string }>;
}

/** What the fake Stripe answers, by path: a Stripe-shaped object per resource. */
function fixtureBody(url: URL): Record<string, unknown> {
  if (url.pathname === '/v1/customers/cus_fixture') {
    return { id: 'cus_fixture', object: 'customer', email: 'ada@example.com' };
  }
  if (url.pathname === '/v1/invoices') {
    return {
      object: 'list',
      url: '/v1/invoices',
      has_more: false,
      data: [{ id: 'in_fixture', object: 'invoice', customer: url.searchParams.get('customer'), status: 'open' }],
    };
  }
  return { error: { type: 'invalid_request_error', message: `fixture has no answer for ${url.pathname}` } };
}

describe('connector-stripe app — boot against a fake Stripe', () => {
  const requests: Recorded[] = [];
  let booted: VerifyStack;
  let token: string;
  const saved = process.env[REF];

  beforeAll(async () => {
    delete process.env[REF];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const headers = new Headers(init?.headers);
      requests.push({ method: init?.method ?? 'GET', url: url.href, authorization: headers.get('authorization') });
      const body = fixtureBody(url);
      return new Response(JSON.stringify(body), {
        status: 'error' in body ? 404 : 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    booted = await bootStack(stack, {
      hostRoot: APP_ROOT,
      extraPlugins: [new ConnectorOpenApiPlugin({ fetchImpl })],
    });
    token = await booted.signIn();
  }, 120_000);

  afterAll(async () => {
    await booted?.stop();
    if (saved === undefined) delete process.env[REF];
    else process.env[REF] = saved;
  });

  const descriptor = async (): Promise<Descriptor | undefined> => {
    const res = await booted.apiAs(token, 'GET', '/automation/connectors');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { connectors?: Descriptor[] } };
    return body.data?.connectors?.find((c) => c.name === 'stripe');
  };

  it('with no credential set, the instance is degraded naming its credentialRef and nothing was sent', async () => {
    const stripe = await descriptor();
    expect(stripe, 'stripe is not in the connector registry').toBeDefined();
    expect(stripe!.state).toBe('degraded');
    expect(stripe!.degradedReason).toContain(REF);
    expect(requests).toEqual([]);
  });

  it('a flow run while the credential is unset fails, naming the credential, and sends nothing', async () => {
    const res = await booted.apiAs(token, 'POST', '/automation/stripe_get_customer/trigger', {
      params: { customer_id: 'cus_fixture' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('FLOW_FAILED');
    expect(body.error?.message).toContain(REF);
    expect(requests).toEqual([]);
  });

  it('once the administrator sets the credential, it materializes with exactly the eight read operations', async () => {
    const put = await booted.apiAs(token, 'PUT', `/automation/connectors/credential-refs/${REF}`, { value: FIXTURE_KEY });
    expect(put.status, await put.clone().text()).toBeLessThan(300);

    let stripe = await descriptor();
    for (let i = 0; i < 40 && stripe?.state !== 'ready'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      stripe = await descriptor();
    }
    expect(stripe?.state, stripe?.degradedReason).toBe('ready');
    expect(stripe!.actions?.map((a) => a.key).sort()).toEqual([...STRIPE_READ_OPERATIONS].sort());
    // Materializing reads the packaged document from disk; it calls nothing.
    expect(requests).toEqual([]);
  });

  it('stripe_get_customer sends GET /v1/customers/:id with the key as a bearer token and returns the body', async () => {
    const res = await booted.apiAs(token, 'POST', '/automation/stripe_get_customer/trigger', {
      params: { customer_id: 'cus_fixture' },
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(requests.at(-1)).toEqual({
      method: 'GET',
      url: 'https://api.stripe.com/v1/customers/cus_fixture',
      authorization: `Bearer ${FIXTURE_KEY}`,
    });
    expect(text).toContain('ada@example.com');
  });

  it("stripe_list_open_invoices sends GET /v1/invoices with the customer, status open and limit 10", async () => {
    const res = await booted.apiAs(token, 'POST', '/automation/stripe_list_open_invoices/trigger', {
      params: { customer_id: 'cus_fixture' },
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const sent = requests.at(-1)!;
    expect(sent.method).toBe('GET');
    expect(sent.authorization).toBe(`Bearer ${FIXTURE_KEY}`);
    const url = new URL(sent.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://api.stripe.com/v1/invoices');
    expect(Object.fromEntries(url.searchParams)).toEqual({ customer: 'cus_fixture', status: 'open', limit: '10' });
    expect(text).toContain('in_fixture');
  });

  it("a Stripe error answer lands in the step's output (status, ok false, Stripe's error); the step does not fail", async () => {
    const res = await booted.apiAs(token, 'POST', '/automation/stripe_get_customer/trigger', {
      params: { customer_id: 'cus_missing' },
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(requests.at(-1)?.url).toBe('https://api.stripe.com/v1/customers/cus_missing');
    expect(text).toContain('invalid_request_error');
  });

  it('every request the app sent was a GET', () => {
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });
});
