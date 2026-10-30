// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os serve` publishes its datasource secret binder's read half as the kernel
 * service `datasource-secret-resolver`, so a plugin driver the stack composes
 * (`@objectstack/driver-odata`) resolves a datasource's
 * `external.credentialsRef` through the host's own `sys_secret` store.
 *
 * ## The gap
 *
 * `serve.ts` built the binder inline and handed it only to
 * `DatasourceAdminServicePlugin`. No service exposed it, so under `os serve` a
 * stack's OData plugin had no way to dereference a `sys_secret:` handle the
 * datasource admin had stored, and the stack author had to write a `resolve`
 * of their own.
 *
 * ## What this file pins
 *
 * The plugin runs inside a REAL `ObjectKernel` over a REAL binder
 * (`createDatasourceSecretBinder` with `LocalCryptoProvider`):
 *
 *   1. a credential bound through the binder resolves through the service, to
 *      its cleartext;
 *   2. the service is the read half only — no `bind`, no `unbind`;
 *   3. a `sys_secret` row another producer sealed (a settings secret) does not
 *      open through it, and neither does a handle that is not the binder's;
 *   4. the wiring inside `run()`: the plugin is mounted only when a binder was
 *      built, with that binder, and the plugin is defined once.
 *
 * The driver's side (reading the service at its first request, an explicit
 * `options.secrets` winning, the fail-closed refusal with no service) is
 * pinned in `packages/drivers/driver-odata/src/plugin.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ObjectKernel } from '@objectstack/core';
import { createDatasourceSecretBinder } from '@objectstack/service-datasource';
import { LocalCryptoProvider } from '@objectstack/service-settings';
import { DATASOURCE_SECRET_RESOLVER_SERVICE, type IDatasourceSecretResolver } from '@objectstack/types';

// The repo's ONE code/prose separator: a comment naming the factory must not
// answer for code that does not call it.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

import { createDatasourceSecretResolverPlugin } from './serve.js';

/** …/packages/cli/src/commands — seeded from `import.meta.url`. */
const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `serve.ts`'s CODE, with every comment span blanked. */
const SERVE = maskComments(readFileSync(resolve(HERE, 'serve.ts'), 'utf8'));

const KEY = Buffer.from('404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f', 'hex');

/** The one service a kernel refuses to start without. Nothing here reads data. */
const DATA_STUB = {
  name: 'com.example.datasource-secret-resolver.data-stub',
  version: '1.0.0',
  init: async (ctx: { registerService(name: string, service: unknown): void }) => { ctx.registerService('data', {}); },
  start: async () => {},
};

/** An in-memory `sys_secret` table with the engine surface the binder calls. */
function secretStore() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    async insert(_object: string, data: Record<string, unknown>) { rows.set(String(data.id), data); return data; },
    async delete(_object: string, options: { where: Record<string, unknown> }) { rows.delete(String(options.where.id)); },
    async find(_object: string, query: Record<string, unknown>) {
      const row = rows.get(String((query.where as { id?: unknown })?.id));
      return row ? [row] : [];
    },
  };
}

/** Boot a real kernel with the resolver plugin over a real binder; hand back the service and the binder. */
async function boot() {
  const engine = secretStore();
  const cryptoProvider = new LocalCryptoProvider({ key: KEY });
  const binder = createDatasourceSecretBinder({ engine, cryptoProvider });
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(DATA_STUB);
  await kernel.use(createDatasourceSecretResolverPlugin(binder));
  await kernel.bootstrap();
  const resolver = kernel.getService<IDatasourceSecretResolver>(DATASOURCE_SECRET_RESOLVER_SERVICE);
  return { kernel, engine, cryptoProvider, binder, resolver };
}

describe('createDatasourceSecretResolverPlugin — the binder\'s read half as a kernel service', () => {
  it('a credential bound through the binder resolves through the service', async () => {
    const { kernel, binder, resolver } = await boot();
    try {
      const ref = await binder.bind({ value: 'token-from-sys-secret' }, { name: 'trippin' });
      expect(ref).toMatch(/^sys_secret:/);
      expect(await resolver.resolve(ref)).toBe('token-from-sys-secret');
    } finally {
      await kernel.shutdown();
    }
  });

  it('publishes resolve and nothing else of the binder', async () => {
    const { kernel, resolver } = await boot();
    try {
      expect(Object.keys(resolver)).toEqual(['resolve']);
    } finally {
      await kernel.shutdown();
    }
  });

  it('opens no row another producer sealed, and no handle that is not the binder\'s', async () => {
    const { kernel, engine, cryptoProvider, resolver } = await boot();
    try {
      // A settings secret in the same table, sealed under its own scope.
      const handle = await cryptoProvider.encrypt('settings-cleartext', { scope: 'settings', namespace: 'mail', key: 'smtp_password' });
      await engine.insert('sys_secret', {
        id: handle.id, namespace: 'mail', key: 'smtp_password',
        kms_key_id: handle.kmsKeyId, alg: handle.alg, version: handle.version, ciphertext: handle.ciphertext,
      });
      expect(await resolver.resolve(`sys_secret:${handle.id}`)).toBeUndefined();
      expect(await resolver.resolve('sys_secret:missing')).toBeUndefined();
      expect(await resolver.resolve('vault:somewhere-else')).toBeUndefined();
    } finally {
      await kernel.shutdown();
    }
  });

  it('declares the service it registers (ADR-0116), so a consumer that requires it can name the provider', () => {
    expect(createDatasourceSecretResolverPlugin({ resolve: async () => undefined }).providesServices)
      .toEqual([DATASOURCE_SECRET_RESOLVER_SERVICE]);
  });
});

describe('the wiring inside `run()`', () => {
  it('mounts the plugin only when a binder was built, handing it that binder', () => {
    expect(SERVE).toMatch(
      /if \(secrets\) \{\s*await kernel\.use\(createDatasourceSecretResolverPlugin\(secrets\)\);/,
    );
    expect(SERVE.match(/'com\.objectstack\.cli\.datasource-secret-resolver'/g) ?? [], 'a second inline copy of the plugin').toHaveLength(1);
  });
});
