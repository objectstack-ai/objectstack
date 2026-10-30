// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plugin: what it publishes, and where the credential comes from — the
 * datasource's `external.credentialsRef`, dereferenced through the host's
 * secret store at the first request, failing closed every way.
 */

import { describe, expect, it } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { needsExternalDriverFloor } from '@objectstack/objectql';
import { createODataDriverPlugin, type DatasourceDefinitionSource, type ODataDriverPluginOptions } from './plugin.js';
import { METADATA_EXCHANGE, SERVICE_ROOT, page, recordedService } from './__fixtures__/recorded-service.js';

type Def = ReturnType<DatasourceDefinitionSource['listDatasourceDefs']>[number];

async function boot(options: Omit<ODataDriverPluginOptions, 'serviceRoot' | 'fetch'>, defs: Def[]) {
  const service = recordedService([METADATA_EXCHANGE, { url: 'People', body: page([]) }]);
  const plugin = createODataDriverPlugin({ serviceRoot: SERVICE_ROOT, fetch: service.fetch, ...options });
  const services = new Map<string, unknown>([['objectql', { listDatasourceDefs: () => defs } satisfies DatasourceDefinitionSource]]);
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
