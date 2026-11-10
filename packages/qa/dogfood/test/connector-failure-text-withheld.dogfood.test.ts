// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Rule, booted on the showcase with its own openapi provider: a credential
// part the connector metadata read withholds never comes back in any other
// text the platform serves or logs. An openapi instance whose stored spec URL
// carries a userinfo and a credential query pair (a row stored before the
// save door refused such a URL, seeded through the system context, the only
// way one is written) fails to materialize; the failure text the doors serve
// for it — `GET /automation/connectors` for a member and an administrator, and
// the credential-reference listing — and the log records of the degrade carry
// the URL as the metadata read serves it. Controls: the stored row keeps its
// URL whole, and an instance whose spec URL carries no credential part is
// served its URL as stored.
//
// Every credential below is an obviously-fake placeholder, and every assertion
// on one is its absence from what a door served or a log record wrote, or its
// presence at rest.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] };

const PLACEHOLDERS = {
  urlPassword: 'TEST_PLACEHOLDER_SPEC_URL_PASSWORD',
  urlQuery: 'TEST_PLACEHOLDER_SPEC_URL_QUERY',
} as const;
const ALL_PLACEHOLDERS = Object.values(PLACEHOLDERS);
const holdsAPlaceholder = (v: unknown): boolean => {
  const text = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return ALL_PLACEHOLDERS.some((p) => text.includes(p));
};

/** Nothing listens on port 9 (discard): a spec fetch there fails, with or without a credential part. */
const CREDENTIAL_SPEC = `http://svc:${PLACEHOLDERS.urlPassword}@127.0.0.1:9/openapi.json?token=${PLACEHOLDERS.urlQuery}&v=3`;
const SERVED_SPEC = 'http://127.0.0.1:9/openapi.json?v=3';
const PLAIN_SPEC = 'http://127.0.0.1:9/plain-openapi.json?v=3';

const REF = 'CFT_SPEC_CREDENTIAL_REF';
const SEEDED = 'cft_spec_credential';
const PLAIN = 'cft_spec_plain';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const bodyOf = (row: any): Record<string, any> =>
  typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata ?? {});
const itemOf = (json: any): Record<string, any> => (json?.item ?? json?.data?.item ?? json?.data ?? json) as Record<string, any>;

describe("a connector's failure text carries no credential part the connector metadata read withholds", () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;
  let ql: any;
  let previousRef: string | undefined;
  /** Every line the process wrote to stdout and stderr while the seeded instance materialized. */
  const written: string[] = [];

  const stored = async (name: string) =>
    rowsOf(await ql.find('sys_metadata', { where: { type: 'connector', name }, context: SYSTEM }));

  const instance = (name: string, spec: string, over: Record<string, unknown> = {}) => ({
    name,
    label: `CFT ${name}`,
    type: 'api',
    description: 'A provider-bound openapi instance whose spec URL cannot be reached.',
    provider: 'openapi',
    providerConfig: { spec },
    auth: { type: 'bearer', credentialRef: REF },
    ...over,
  });

  const descriptorOf = async (token: string, name: string): Promise<{ status: number; text: string; found: any }> => {
    const res = await stack.apiAs(token, 'GET', '/automation/connectors');
    const text = await res.text();
    const json = JSON.parse(text) as any;
    return { status: res.status, text, found: (json?.data?.connectors ?? []).find((c: any) => c?.name === name) };
  };

  const waitDegraded = async (name: string): Promise<void> => {
    const deadline = Date.now() + 15_000;
    let last = '';
    while (Date.now() < deadline) {
      const { found } = await descriptorOf(admin, name);
      last = JSON.stringify(found ?? null);
      if (found?.state === 'degraded') return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`connector ${name} never reached degraded: ${last}`);
  };

  beforeAll(async () => {
    previousRef = process.env[REF];
    process.env[REF] = 'cft-resolved-reference-value';
    stack = await bootShowcase({});
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    admin = await stack.signIn();
    member = await stack.signUp('cft-member@connector-failure-text.test');

    // A row stored before the save door refused a credential part in a URL:
    // saved disabled and clean, then the system context writes the seeded
    // form over it, and a save of the served form (the stored URL carried
    // forward) enables it, so the instance materializes from the stored URL.
    const put = await stack.apiAs(admin, 'PUT', `/meta/connector/${SEEDED}`, instance(SEEDED, PLAIN_SPEC, { enabled: false }));
    expect(put.status, await put.clone().text()).toBe(200);
    const [row] = await stored(SEEDED);
    await ql.update('sys_metadata', { id: row.id, metadata: JSON.stringify(instance(SEEDED, CREDENTIAL_SPEC)) }, { context: SYSTEM });
    const served = itemOf(await (await stack.apiAs(admin, 'GET', `/meta/connector/${SEEDED}`)).json());
    expect(served.providerConfig).toEqual({ spec: SERVED_SPEC });
    const body = Object.fromEntries(Object.entries(served).filter(([k]) => !k.startsWith('_')));

    const capture = (stream: NodeJS.WriteStream) => {
      const original = stream.write.bind(stream);
      return vi.spyOn(stream, 'write').mockImplementation(((chunk: string | Uint8Array, ...rest: unknown[]) => {
        written.push(String(chunk));
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as never);
    };
    const spies = [capture(process.stdout), capture(process.stderr)];
    try {
      const resave = await stack.apiAs(admin, 'PUT', `/meta/connector/${SEEDED}`, body);
      expect(resave.status, await resave.clone().text()).toBe(200);
      await waitDegraded(SEEDED);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const plain = await stack.apiAs(admin, 'PUT', `/meta/connector/${PLAIN}`, instance(PLAIN, PLAIN_SPEC));
    expect(plain.status, await plain.clone().text()).toBe(200);
    await waitDegraded(PLAIN);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (previousRef === undefined) delete process.env[REF];
    else process.env[REF] = previousRef;
  });

  it('guard the guard: the stored row keeps its spec URL whole', async () => {
    expect(bodyOf((await stored(SEEDED))[0]).providerConfig.spec).toBe(CREDENTIAL_SPEC);
  });

  it('GET /automation/connectors serves the degraded reason with the URL as the metadata read serves it, to a member and to an administrator', async () => {
    for (const token of [member, admin]) {
      const { status, text, found } = await descriptorOf(token, SEEDED);
      expect(status, text.slice(0, 200)).toBe(200);
      expect(found?.state).toBe('degraded');
      expect(found?.degradedReason).toContain(`'${SERVED_SPEC}'`);
      expect(holdsAPlaceholder(text)).toBe(false);
    }
  });

  it('the credential-reference listing serves the same degraded reason', async () => {
    const res = await stack.apiAs(admin, 'GET', '/automation/connectors/credential-refs');
    const text = await res.text();
    expect(res.status, text.slice(0, 200)).toBe(200);
    expect(text).toContain(SEEDED);
    expect(text).toContain(SERVED_SPEC);
    expect(holdsAPlaceholder(text)).toBe(false);
  });

  it('the log records of the degrade name the instance and hold no credential part', () => {
    const text = written.join('');
    expect(text, 'the degrade was logged while it was captured').toContain(SEEDED);
    expect(holdsAPlaceholder(text)).toBe(false);
  });

  it('a spec URL with no credential part is served in the degraded reason as stored', async () => {
    const { found } = await descriptorOf(member, PLAIN);
    expect(found?.state).toBe('degraded');
    expect(found?.degradedReason).toContain(`'${PLAIN_SPEC}'`);
  });
});
