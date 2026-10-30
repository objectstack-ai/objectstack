// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plugin: what it publishes, and where the credential comes from — the
 * datasource's `external.credentialsRef`, dereferenced through the host's
 * secret store at the first request, or the connector instance its
 * `external.connector` borrows from (ADR-0015 D7) — failing closed every way.
 */

import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { needsExternalDriverFloor } from '@objectstack/objectql';
import {
  CONNECTOR_CREDENTIAL_SOURCE_SERVICE,
  connectorCredentialRefusal,
  type BorrowedConnectorCredential,
  type IConnectorCredentialSource,
} from '@objectstack/types';
import { createODataDriverPlugin, type DatasourceDefinitionSource, type ODataDriverPluginOptions } from './plugin.js';
import { METADATA_EXCHANGE, SERVICE_ROOT, page, recordedService, type Exchange } from './__fixtures__/recorded-service.js';

type Def = ReturnType<DatasourceDefinitionSource['listDatasourceDefs']>[number];

async function boot(
  options: Omit<ODataDriverPluginOptions, 'serviceRoot' | 'fetch'>,
  defs: Def[],
  extra: { exchanges?: Exchange[]; services?: Record<string, unknown> } = {},
) {
  const service = recordedService(extra.exchanges ?? [METADATA_EXCHANGE, { url: 'People', body: page([]) }]);
  const plugin = createODataDriverPlugin({ serviceRoot: SERVICE_ROOT, fetch: service.fetch, ...options });
  const services = new Map<string, unknown>([
    ['objectql', { listDatasourceDefs: () => defs } satisfies DatasourceDefinitionSource],
    ...Object.entries(extra.services ?? {}),
  ]);
  const ctx = {
    registerService: (name: string, value: unknown) => { services.set(name, value); },
    getService: (name: string) => services.get(name),
  } as unknown as PluginContext;
  await plugin.init!(ctx);
  plugin.driver.registerExternalObject({ name: 'trip_person', external: { remoteName: 'People' } });
  return { plugin, services, requests: service.requests };
}

const SECRETS = {
  async resolve(ref: string) {
    return ref === 'sys_secret:sec_trippin' ? 'token-from-the-store' : undefined;
  },
};

describe('createODataDriverPlugin', () => {
  it('publishes the driver as driver.<name> — `odata` by default, a plugin driver id the engine floors', async () => {
    const { services, plugin } = await boot({}, []);
    expect(services.get('driver.odata')).toBe(plugin.driver);
    expect(plugin.driver.name).toBe('odata');
    expect(needsExternalDriverFloor({ driver: 'odata', schemaMode: 'external' })).toBe(true);
  });

  it('refuses a config that carries a credential or names no http(s) service', () => {
    expect(() => createODataDriverPlugin({ serviceRoot: 'https://user:pw@erp.example/odata/' }))
      .toThrow(/serviceRoot must not carry credentials/);
    expect(() => createODataDriverPlugin({ serviceRoot: 'ftp://erp.example/odata/' })).toThrow(/http\(s\) URL/);
    expect(() => createODataDriverPlugin({ serviceRoot: SERVICE_ROOT, token: 'x' } as never)).toThrow(/invalid config/);
  });

  it('sends the secret behind the datasource\'s credentialsRef, resolved through the host\'s secret store', async () => {
    const { plugin, requests } = await boot(
      { name: 'trippin', auth: { scheme: 'bearer' }, secrets: SECRETS },
      [{ name: 'trippin', external: { credentialsRef: 'sys_secret:sec_trippin' } }],
    );
    await plugin.driver.find('trip_person', {});
    expect(requests.map((r) => r.headers.Authorization)).toEqual(['Bearer token-from-the-store', 'Bearer token-from-the-store']);
  });

  it('spells basic auth from the configured user name and the resolved secret', async () => {
    const { plugin, requests } = await boot(
      { name: 'trippin', auth: { scheme: 'basic', username: 'svc_reader' }, secrets: SECRETS },
      [{ name: 'trippin', external: { credentialsRef: 'sys_secret:sec_trippin' } }],
    );
    await plugin.driver.find('trip_person', {});
    expect(requests[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('svc_reader:token-from-the-store').toString('base64')}`);
  });

  const refusals: Array<[string, Omit<ODataDriverPluginOptions, 'serviceRoot' | 'fetch'>, Def[], RegExp]> = [
    ['no credentialsRef for a scheme that needs one', { name: 'trippin', auth: { scheme: 'bearer' }, secrets: SECRETS }, [{ name: 'trippin' }], /declares no external\.credentialsRef/],
    ['no secret store', { name: 'trippin', auth: { scheme: 'bearer' } }, [{ name: 'trippin', external: { credentialsRef: 'sys_secret:sec_trippin' } }], /no secret store was passed/],
    ['a handle that does not resolve', { name: 'trippin', auth: { scheme: 'bearer' }, secrets: SECRETS }, [{ name: 'trippin', external: { credentialsRef: 'sys_secret:gone' } }], /could not be resolved or decrypted/],
    ['an undeclared datasource', { name: 'trippin', auth: { scheme: 'bearer' }, secrets: SECRETS }, [], /is not declared/],
    ['a credentialsRef the scheme would ignore', { name: 'trippin', secrets: SECRETS }, [{ name: 'trippin', external: { credentialsRef: 'sys_secret:sec_trippin' } }], /auth scheme is 'none'/],
  ];

  it.each(refusals)('fails closed, sending nothing, on %s', async (_label, options, defs, message) => {
    const { plugin, requests } = await boot(options, defs);
    await expect(plugin.driver.find('trip_person', {})).rejects.toThrow(message);
    expect(requests).toHaveLength(0);
  });
});

/**
 * A lender double standing in for `@objectstack/service-automation`'s source:
 * `get` answers the current credential, `refresh` moves to the next one, the
 * shape a grant-bearing (OAuth2) instance answers through.
 */
function lender(answers: BorrowedConnectorCredential[], refuse?: Error) {
  const calls = { borrow: [] as string[], get: 0, refresh: 0 };
  let current = 0;
  const source: IConnectorCredentialSource = {
    async borrow(connector) {
      calls.borrow.push(connector);
      if (refuse) throw refuse;
      return {
        connector,
        async get() { calls.get += 1; return answers[current]!; },
        async refresh() { calls.refresh += 1; current = Math.min(current + 1, answers.length - 1); return answers[current]!; },
      };
    },
  };
  return { source, calls, services: { [CONNECTOR_CREDENTIAL_SOURCE_SERVICE]: source } };
}

const BORROWING: Def[] = [{ name: 'trippin', external: { connector: 'trippin_api' } }];
const bearer = (token: string, expiresAt?: number): BorrowedConnectorCredential =>
  ({ auth: { type: 'bearer', token }, ...(expiresAt !== undefined ? { expiresAt } : {}) });

describe('createODataDriverPlugin — a credential borrowed from external.connector (ADR-0015 D7)', () => {
  it('sends the connector instance\'s credential, borrowed once, and never asks the secret store', async () => {
    const { calls, services } = lender([bearer('tok-1')]);
    const secrets = { resolve: async () => { throw new Error('the secret store was asked'); } };
    const { plugin, requests } = await boot({ name: 'trippin', secrets }, BORROWING, { services });
    await plugin.driver.find('trip_person', {});
    expect(requests.map((r) => r.headers.Authorization)).toEqual(['Bearer tok-1', 'Bearer tok-1']);
    expect(calls.borrow).toEqual(['trippin_api']);
    expect(calls.refresh).toBe(0);
  });

  it('presents the instance\'s auth as it declares it: basic, an API key header, an API key query parameter', async () => {
    const basic = lender([{ auth: { type: 'basic', username: 'svc', password: 'pw' } }]);
    const one = await boot({ name: 'trippin' }, BORROWING, { services: basic.services });
    await one.plugin.driver.find('trip_person', {});
    expect(one.requests[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('svc:pw').toString('base64')}`);

    const header = lender([{ auth: { type: 'api-key', key: 'k-1', headerName: 'APIKey' } }]);
    const two = await boot({ name: 'trippin' }, BORROWING, { services: header.services });
    await two.plugin.driver.find('trip_person', {});
    expect(two.requests[0]!.headers.APIKey).toBe('k-1');
    expect(two.requests[0]!.headers.Authorization).toBeUndefined();

    const query = lender([{ auth: { type: 'api-key', key: 'k-2', headerName: 'X-API-Key', paramName: 'apikey' } }]);
    const three = await boot({ name: 'trippin' }, BORROWING, {
      services: query.services,
      exchanges: [{ ...METADATA_EXCHANGE, url: '$metadata?apikey=k-2' }, { url: 'People?apikey=k-2', body: page([]) }],
    });
    await three.plugin.driver.find('trip_person', {});
    expect(three.requests.map((r) => r.url)).toEqual(['$metadata?apikey=k-2', 'People?apikey=k-2']);
    expect(three.requests[0]!.headers['X-API-Key']).toBeUndefined();
  });

  it('refreshes once on a 401 and retries with the credential obtained afresh', async () => {
    const { calls, services } = lender([bearer('tok-1'), bearer('tok-2')]);
    const { plugin, requests } = await boot({ name: 'trippin' }, BORROWING, {
      services,
      exchanges: [{ url: '$metadata', status: 401, body: { error: { message: 'expired' } }, once: true }, METADATA_EXCHANGE, { url: 'People', body: page([]) }],
    });
    await plugin.driver.find('trip_person', {});
    expect(requests.map((r) => r.headers.Authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2', 'Bearer tok-2']);
    expect(calls.refresh).toBe(1);
  });

  it('refreshes a credential at its expiry before sending it', async () => {
    const { calls, services } = lender([bearer('tok-stale', Date.now() - 1), bearer('tok-fresh')]);
    const { plugin, requests } = await boot({ name: 'trippin' }, BORROWING, { services });
    await plugin.driver.find('trip_person', {});
    expect(requests[0]!.headers.Authorization).toBe('Bearer tok-fresh');
    expect(calls.refresh).toBe(1);
  });

  it('ends a second 401 as a 503 naming the instance, never the upstream\'s text', async () => {
    const { services } = lender([bearer('tok-1'), bearer('tok-2')]);
    const { plugin, requests } = await boot({ name: 'trippin' }, BORROWING, {
      services,
      exchanges: [{ url: '$metadata', status: 401, body: { error: { message: 'token tok-2 rejected' } } }],
    });
    const failure = (await plugin.driver.find('trip_person', {}).then(() => undefined, (err: unknown) => err)) as Error & { status?: number; code?: string };
    expect(failure).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(failure.message).toContain("connector instance 'trippin_api'");
    expect(failure.message).not.toContain('tok-2');
    expect(requests).toHaveLength(2);
  });

  const refusals: Array<[string, Omit<ODataDriverPluginOptions, 'serviceRoot' | 'fetch'>, Def[], Record<string, unknown>, RegExp]> = [
    ['no connector credential source registered', { name: 'trippin' }, BORROWING, {}, /no connector credential source is registered/],
    ['both credential channels', { name: 'trippin', secrets: SECRETS }, [{ name: 'trippin', external: { connector: 'trippin_api', credentialsRef: 'sys_secret:sec_trippin' } }], lender([bearer('tok-1')]).services, /names both external\.connector and external\.credentialsRef/],
    ['an auth scheme beside the connector', { name: 'trippin', auth: { scheme: 'bearer' } }, BORROWING, lender([bearer('tok-1')]).services, /set auth\.scheme to 'none'/],
    ['an instance the source refuses to lend', { name: 'trippin' }, BORROWING, lender([], connectorCredentialRefusal("connector instance 'trippin_api' is disabled", 'VALIDATION_ERROR', 422)).services, /'trippin_api' is disabled/],
    ['a credential the handle cannot answer', { name: 'trippin' }, BORROWING, { [CONNECTOR_CREDENTIAL_SOURCE_SERVICE]: { borrow: async (connector: string) => ({ connector, get: async () => { throw connectorCredentialRefusal("connector instance 'trippin_api': credential not set", 'SERVICE_UNAVAILABLE', 503); }, refresh: async () => { throw new Error('unreached'); } }) } }, /credential not set/],
  ];

  it.each(refusals)('fails closed, sending nothing, on %s', async (_label, options, defs, services, message) => {
    const { plugin, requests } = await boot(options, defs, { services });
    await expect(plugin.driver.find('trip_person', {})).rejects.toThrow(message);
    expect(requests).toHaveLength(0);
  });

  it('answers a lend refusal without its 422, so the engine reads it as the connection\'s condition, and asks again next request', async () => {
    const refused = lender([], connectorCredentialRefusal("connector instance 'trippin_api' is disabled", 'VALIDATION_ERROR', 422));
    const { plugin } = await boot({ name: 'trippin' }, BORROWING, { services: refused.services });
    const failure = (await plugin.driver.find('trip_person', {}).then(() => undefined, (err: unknown) => err)) as Error & { status?: number };
    expect(failure).toBeInstanceOf(Error);
    expect(failure.status).toBeUndefined();
    await plugin.driver.find('trip_person', {}).catch(() => {});
    expect(refused.calls.borrow).toEqual(['trippin_api', 'trippin_api']);
  });
});
