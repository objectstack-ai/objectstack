// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plugin: what it publishes, and where the credential comes from — the
 * datasource's `external.credentialsRef`, dereferenced through the host's
 * secret store at the first request (`options.secrets`, else the host's
 * `datasource-secret-resolver` service), failing closed every way.
 */

import { describe, expect, it } from 'vitest';
import { ObjectKernel, type PluginContext } from '@objectstack/core';
import { DATASOURCE_SECRET_RESOLVER_SERVICE } from '@objectstack/types';
import { needsExternalDriverFloor } from '@objectstack/objectql';
import { createODataDriverPlugin, type DatasourceDefinitionSource, type ODataDriverPluginOptions } from './plugin.js';
import { METADATA_EXCHANGE, SERVICE_ROOT, page, recordedService } from './__fixtures__/recorded-service.js';

type Def = ReturnType<DatasourceDefinitionSource['listDatasourceDefs']>[number];

async function boot(
  options: Omit<ODataDriverPluginOptions, 'serviceRoot' | 'fetch'>,
  defs: Def[],
  host: Record<string, unknown> = {},
) {
  const service = recordedService([METADATA_EXCHANGE, { url: 'People', body: page([]) }]);
  const plugin = createODataDriverPlugin({ serviceRoot: SERVICE_ROOT, fetch: service.fetch, ...options });
  const services = new Map<string, unknown>([
    ['objectql', { listDatasourceDefs: () => defs } satisfies DatasourceDefinitionSource],
    ...Object.entries(host),
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

  describe('the host\'s published secret resolver', () => {
    const DEFS: Def[] = [{ name: 'trippin', external: { credentialsRef: 'sys_secret:sec_trippin' } }];
    const HOST_RESOLVER = {
      asked: [] as string[],
      async resolve(ref: string) {
        this.asked.push(ref);
        return ref === 'sys_secret:sec_trippin' ? 'token-from-the-host' : undefined;
      },
    };

    it('resolves the handle through the host\'s service when the plugin was passed no secret store', async () => {
      HOST_RESOLVER.asked = [];
      const { plugin, requests } = await boot(
        { name: 'trippin', auth: { scheme: 'bearer' } },
        DEFS,
        { [DATASOURCE_SECRET_RESOLVER_SERVICE]: HOST_RESOLVER },
      );
      await plugin.driver.find('trip_person', {});
      expect(requests.map((r) => r.headers.Authorization)).toEqual(['Bearer token-from-the-host', 'Bearer token-from-the-host']);
      expect(HOST_RESOLVER.asked).toEqual(['sys_secret:sec_trippin']);
    });

    it('an explicit options.secrets wins: the host\'s service is never asked', async () => {
      HOST_RESOLVER.asked = [];
      const { plugin, requests } = await boot(
        { name: 'trippin', auth: { scheme: 'bearer' }, secrets: SECRETS },
        DEFS,
        { [DATASOURCE_SECRET_RESOLVER_SERVICE]: HOST_RESOLVER },
      );
      await plugin.driver.find('trip_person', {});
      expect(requests[0]!.headers.Authorization).toBe('Bearer token-from-the-store');
      expect(HOST_RESOLVER.asked).toEqual([]);
    });

    it('fails closed, sending nothing, when the host\'s service does not resolve the handle', async () => {
      const { plugin, requests } = await boot(
        { name: 'trippin', auth: { scheme: 'bearer' } },
        [{ name: 'trippin', external: { credentialsRef: 'sys_secret:gone' } }],
        { [DATASOURCE_SECRET_RESOLVER_SERVICE]: HOST_RESOLVER },
      );
      await expect(plugin.driver.find('trip_person', {})).rejects.toThrow(/could not be resolved or decrypted/);
      expect(requests).toHaveLength(0);
    });

    it('reads the service at the first request, so a resolver registered after the plugin\'s init is seen', async () => {
      const { plugin, services, requests } = await boot({ name: 'trippin', auth: { scheme: 'bearer' } }, DEFS);
      services.set(DATASOURCE_SECRET_RESOLVER_SERVICE, HOST_RESOLVER);
      await plugin.driver.find('trip_person', {});
      expect(requests[0]!.headers.Authorization).toBe('Bearer token-from-the-host');
    });

    // A real kernel's getService THROWS on a name nothing registered; the miss must still be the plugin's own
    // fail-closed refusal naming the service, never the kernel's "not found" text, and nothing may be sent.
    it('on a real kernel with neither a store nor the service, refuses with its own message and sends nothing', async () => {
      const service = recordedService([METADATA_EXCHANGE, { url: 'People', body: page([]) }]);
      const plugin = createODataDriverPlugin({ serviceRoot: SERVICE_ROOT, fetch: service.fetch, name: 'trippin', auth: { scheme: 'bearer' } });
      const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
      await kernel.use({
        name: 'com.example.odata-test.engine-stub',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
          ctx.registerService('data', {});
          ctx.registerService('objectql', { listDatasourceDefs: () => DEFS } satisfies DatasourceDefinitionSource);
        },
      });
      await kernel.use(plugin);
      await kernel.bootstrap();
      try {
        plugin.driver.registerExternalObject({ name: 'trip_person', external: { remoteName: 'People' } });
        const refusal = await plugin.driver.find('trip_person', {}).then(() => undefined, (err: unknown) => err as Error);
        expect(refusal?.message).toMatch(/no secret store was passed to the plugin \(options\.secrets\) and none is registered as the 'datasource-secret-resolver' service/);
        expect(refusal?.message).not.toMatch(/\[Kernel\]/);
        expect(service.requests).toHaveLength(0);
      } finally {
        await kernel.shutdown();
      }
    });
  });
});
