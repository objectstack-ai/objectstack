// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The boot report of stored SSO providers whose `domain` list holds an entry
 * that names no domain — `sso-stored-domain-entries.ts` states it. Pinned on
 * the module (the stored rows, the warnings, the reads it makes) and through
 * `AuthPlugin.start()`'s `kernel:ready` hook (the wiring).
 */

import { describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin.js';
import { ssoDomainEntryNotBare } from './sso-account-at-proven-domain.js';
import { SSO_PROVIDER_OBJECT } from './sso-client-secret.js';
import {
  findSsoProvidersWithNonBareDomainEntries,
  reportSsoProvidersWithNonBareDomainEntries,
} from './sso-stored-domain-entries.js';

const REPORT_PREFIX = '[sso] SSO provider ';

/** A stored-rows engine double: reads answer copies of `rows` for `sys_sso_provider`, every write is recorded. */
function storedProviders(rows: Record<string, unknown>[], options: { registered?: boolean; findThrows?: boolean } = {}) {
  const stored = structuredClone(rows);
  const finds: Array<{ object: string; query: Record<string, unknown> | undefined }> = [];
  const writes: string[] = [];
  const recordWrite = (verb: string) => vi.fn(async (object: string, data?: unknown) => {
    writes.push(`${verb} ${object}`);
    return data && typeof data === 'object' ? { id: `${verb}-${writes.length}`, ...data } : {};
  });
  const engine = {
    getSchema: (name: string) => (options.registered === false ? undefined : name === SSO_PROVIDER_OBJECT ? { name } : undefined),
    find: vi.fn(async (object: string, query?: Record<string, unknown>) => {
      finds.push({ object, query });
      if (options.findThrows) throw new Error('store unavailable');
      return object === SSO_PROVIDER_OBJECT ? structuredClone(stored) : [];
    }),
    findOne: vi.fn(async () => null),
    count: vi.fn(async () => 0),
    insert: recordWrite('insert'),
    update: recordWrite('update'),
    delete: recordWrite('delete'),
  };
  return { engine, stored, finds, writes };
}

const logger = () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() });

describe('reportSsoProvidersWithNonBareDomainEntries — one warning per stored provider naming an entry that names no domain', () => {
  it("a provider stored with 'https://acme.com' produces exactly one warning naming the provider id and the entry", async () => {
    const rows = [{ id: 'p1', provider_id: 'acme-okta', domain: 'https://acme.com', domain_verified: true }];
    const { engine } = storedProviders(rows);
    const log = logger();

    const findings = await reportSsoProvidersWithNonBareDomainEntries(engine as never, log);

    expect(findings).toEqual([{ providerId: 'acme-okta', entries: ['https://acme.com'] }]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = log.warn.mock.calls[0]!;
    expect(message).toContain("'acme-okta'");
    expect(message).toContain("'https://acme.com'");
    expect(message).toContain('POST /api/v1/auth/sso/update-provider');
    expect(meta).toEqual({ providerId: 'acme-okta', entries: ['https://acme.com'] });
  });

  it('a provider with only bare entries produces none (CONTROL)', async () => {
    const rows = [{ id: 'p2', provider_id: 'bare-okta', domain: 'acme.com, sub.acme.com, bücher.de', domain_verified: true }];
    const { engine, finds } = storedProviders(rows);
    const log = logger();

    expect(await reportSsoProvidersWithNonBareDomainEntries(engine as never, log)).toEqual([]);
    expect(log.warn).not.toHaveBeenCalled();
    // The control read the rows: the silence is a verdict on them, not a skipped read.
    expect(finds.map((f) => f.object)).toEqual([SSO_PROVIDER_OBJECT]);
  });

  it('names only the providers holding such an entry, every such entry once per provider, and the bare entries of a list are not named', async () => {
    const rows = [
      { id: 'p1', provider_id: 'mixed', domain: 'acme.com, https://acme.org, acme.net:443', domain_verified: false },
      { id: 'p2', provider_id: 'bare', domain: 'example.com' },
      { id: 'p3', provider_id: 'pathy', domain: 'example.org/login' },
    ];
    const { engine } = storedProviders(rows);
    const log = logger();

    await reportSsoProvidersWithNonBareDomainEntries(engine as never, log);

    expect(log.warn.mock.calls.map(([, meta]) => meta)).toEqual([
      { providerId: 'mixed', entries: ['https://acme.org', 'acme.net:443'] },
      { providerId: 'pathy', entries: ['example.org/login'] },
    ]);
    expect(log.warn.mock.calls[0]![0]).not.toContain("'acme.com'");
  });

  it('names exactly the entries the register / edit refusal refuses (one predicate)', async () => {
    for (const domain of ['https://acme.com', 'acme.com:8443', 'user@acme.com', 'acme.com.', ' acme.com ', 'ａｃｍｅ.com', 'acme..com']) {
      const { engine } = storedProviders([{ id: 'p', provider_id: 'p', domain }]);
      const log = logger();
      await reportSsoProvidersWithNonBareDomainEntries(engine as never, log);
      expect(log.warn.mock.calls.length, domain).toBe(ssoDomainEntryNotBare(domain) === undefined ? 0 : 1);
    }
  });

  it('no stored row changes: the report reads as the system and writes nothing', async () => {
    const rows = [
      { id: 'p1', provider_id: 'acme-okta', domain: 'https://acme.com', domain_verified: true },
      { id: 'p2', provider_id: 'bare', domain: 'example.com', domain_verified: false },
    ];
    const { engine, stored, finds, writes } = storedProviders(rows);

    await reportSsoProvidersWithNonBareDomainEntries(engine as never, logger());

    expect(writes).toEqual([]);
    expect(engine.insert).not.toHaveBeenCalled();
    expect(engine.update).not.toHaveBeenCalled();
    expect(engine.delete).not.toHaveBeenCalled();
    expect(stored).toEqual(rows);
    expect(finds).toHaveLength(1);
    expect(finds[0]!.query?.context).toMatchObject({ isSystem: true });
  });

  it('no engine, an engine that cannot read, an unregistered object or a failed read: no throw and no warning', async () => {
    const log = logger();
    await expect(reportSsoProvidersWithNonBareDomainEntries(undefined, log)).resolves.toEqual([]);
    await expect(reportSsoProvidersWithNonBareDomainEntries({} as never, log)).resolves.toEqual([]);

    const unregistered = storedProviders([{ provider_id: 'x', domain: 'https://x.com' }], { registered: false });
    await expect(reportSsoProvidersWithNonBareDomainEntries(unregistered.engine as never, log)).resolves.toEqual([]);
    expect(unregistered.finds).toEqual([]);

    const failing = storedProviders([], { findThrows: true });
    await expect(reportSsoProvidersWithNonBareDomainEntries(failing.engine as never, log)).resolves.toEqual([]);
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('findSsoProvidersWithNonBareDomainEntries skips a row whose domain is not a string', async () => {
    const { engine } = storedProviders([{ provider_id: 'n', domain: null }, { provider_id: 'm' }]);
    expect(await findSsoProvidersWithNonBareDomainEntries(engine as never)).toEqual([]);
  });
});

describe('AuthPlugin.start() — the report runs on kernel:ready', () => {
  const bootWith = async (services: Record<string, unknown>) => {
    const handlers = new Map<string, Array<() => Promise<void>>>();
    const log = logger();
    const ctx = {
      registerService: vi.fn(),
      // The `AuthPlugin` harness's own shape (`auth-plugin.test.ts`): an
      // absent service answers `undefined`.
      getService: vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        return services[name];
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn((name: string, handler: () => Promise<void>) => {
        if (!handlers.has(name)) handlers.set(name, []);
        handlers.get(name)!.push(handler);
      }),
      trigger: vi.fn(),
      logger: log,
      getKernel: vi.fn(),
    } as unknown as PluginContext;
    const plugin = new AuthPlugin({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: 'http://localhost:3000',
      registerRoutes: false,
    });
    await plugin.init(ctx);
    await plugin.start(ctx);
    // Each handler on its own: a sibling hook that cannot run against this
    // double must not hide whether the report ran.
    for (const handler of handlers.get('kernel:ready') ?? []) {
      try { await handler(); } catch { /* a sibling's failure, not the report's */ }
    }
    return log.warn.mock.calls.filter(([message]) => String(message).startsWith(REPORT_PREFIX));
  };

  it("names the stored provider holding 'https://acme.com', once", async () => {
    const { engine, writes } = storedProviders([{ id: 'p1', provider_id: 'acme-okta', domain: 'https://acme.com' }]);
    const reports = await bootWith({ objectql: engine });
    expect(reports).toHaveLength(1);
    expect(reports[0]![1]).toEqual({ providerId: 'acme-okta', entries: ['https://acme.com'] });
    expect(writes.filter((w) => w.endsWith(SSO_PROVIDER_OBJECT))).toEqual([]);
  });

  it('says nothing for bare entries (CONTROL), and boots with no engine', async () => {
    const { engine } = storedProviders([{ id: 'p1', provider_id: 'acme-okta', domain: 'acme.com' }]);
    expect(await bootWith({ objectql: engine })).toEqual([]);
    expect(await bootWith({})).toEqual([]);
  });
});
