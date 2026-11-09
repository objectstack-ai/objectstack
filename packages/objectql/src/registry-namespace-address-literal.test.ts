// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, child G1] A namespace never spells a literal segment of the
 * REST address grammar — refused at the package door
 * (`SchemaRegistry.installPackage`, beside K's namespace/object-name refusal),
 * by the spec's one judge (`validateNamespaceNotAddressLiteral` over
 * `NAMESPACE_REFUSED_LITERALS`). The router reads a literal before any
 * namespace, so a package namespaced `trigger` could never be reached at
 * `/automation/trigger/<name>` as itself.
 *
 * Driven through the `manifest` service, the way a boot registers packages.
 * Every refusal is asserted by its ADR-0112 envelope, the literal and its door
 * in the sentence, and the refused package left uninstalled. The CONTROLs pin
 * what stays accepted: a namespace that only starts with a literal, and the
 * `_`-led literals no namespace can spell anyway.
 *
 * Only a NEW install is refused: a package the deployment already holds under
 * such a namespace — registered by the cold boot, before the holders are
 * sealed, or registered again under its own id after — keeps booting, warned
 * once, and is read with `?package=`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin } from '@objectstack/core';
import { NAMESPACE_REFUSED_LITERALS } from '@objectstack/spec/kernel';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type Refusal = Error & { code?: string; status?: number; httpStatus?: number; namespace?: string; incomingPackageId?: string };

const ALPHA = 'com.acme.alpha';

const body = (id: string, ns: string): Record<string, unknown> => ({
  id,
  name: id.split('.').pop(),
  version: '1.0.0',
  type: 'app',
  namespace: ns,
});

const kernels: ObjectKernel[] = [];
afterEach(async () => {
  for (const k of kernels.splice(0)) await k.shutdown().catch(() => {});
});

async function boot() {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  const svc = kernel.getService('manifest') as { register(m: unknown): void | Promise<void> };
  const register = async (manifest: unknown): Promise<Refusal | undefined> => {
    try {
      await svc.register({ packages: [{ manifest }] });
      return undefined;
    } catch (e) {
      return e as Refusal;
    }
  };
  return { ql, register };
}

describe('install door — a namespace never spells an address-grammar literal', () => {
  it('the refused set is the grammar\'s letter-led literals', () => {
    expect([...NAMESPACE_REFUSED_LITERALS]).toEqual(['actions', 'connectors', 'global', 'hooks', 'oauth', 'trigger']);
  });

  it.each(NAMESPACE_REFUSED_LITERALS.map((literal) => [literal]))(
    'namespace %s is refused 422 NAMESPACE_CONFLICT, naming the literal and its door',
    async (literal) => {
      const { ql, register } = await boot();
      const err = await register(body(ALPHA, literal));
      expect([err?.code, err?.status, err?.httpStatus], err?.message).toEqual(['NAMESPACE_CONFLICT', 422, 422]);
      expect(err?.name).toBe('NamespaceAddressLiteralError');
      expect([err?.namespace, err?.incomingPackageId]).toEqual([literal, ALPHA]);
      expect(err?.message).toContain(`Package '${ALPHA}'`);
      expect(err?.message).toContain(`Namespace '${literal}' spells a literal segment of the address grammar`);
      expect(err?.message).toMatch(new RegExp(`/${literal}\\b`));
      expect(ql.registry.getPackage(ALPHA)).toBeUndefined();
      expect(ql.registry.getNamespaceOwner(literal)).toBeUndefined();
    },
  );

  it('the sentence names every door that serves the literal (`trigger` is an automation literal)', async () => {
    const { register } = await boot();
    const err = await register(body(ALPHA, 'trigger'));
    expect(err?.message).toContain('/automation/trigger');
  });
});

describe('install door — what stays accepted', () => {
  it('CONTROL — a namespace that only starts with a literal installs', async () => {
    const { ql, register } = await boot();
    expect((await register(body(ALPHA, 'triggers')))?.message).toBeUndefined();
    expect(ql.registry.getPackage(ALPHA)).toBeDefined();
    expect(ql.registry.getNamespaceOwner('triggers')).toBe(ALPHA);
  });

  it('CONTROL — a namespace that contains a literal installs', async () => {
    const { ql, register } = await boot();
    expect((await register(body(ALPHA, 'crm_hooks')))?.message).toBeUndefined();
    expect(ql.registry.getPackage(ALPHA)).toBeDefined();
  });
});

describe('a package already installed under such a namespace keeps booting', () => {
  /** Boot a kernel whose own boot registers `manifest`, as an installed package's AppPlugin does at `init()`. */
  async function bootHolding(manifest: Record<string, unknown>) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    const installed: Plugin = {
      name: 'installed-package',
      version: '1.0.0',
      init: async (ctx) => {
        await ctx.getService<{ register(m: unknown): void | Promise<void> }>('manifest').register({ packages: [{ manifest }] });
      },
    };
    await kernel.use(installed);
    await kernel.bootstrap();
    return kernel;
  }

  it('the boot registers it: it installs, owns its namespace and is warned once, naming `?package=`', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const kernel = await bootHolding(body(ALPHA, 'hooks'));
      const ql = kernel.getService<ObjectQL>('objectql');
      expect(ql.registry.bareNameHoldersAreSealed).toBe(true);
      expect(ql.registry.getPackage(ALPHA)).toBeDefined();
      expect(ql.registry.getNamespaceOwner('hooks')).toBe(ALPHA);
      const warned = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(`Package '${ALPHA}' is installed under a namespace`));
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain(`?package=${ALPHA}`);
      expect(warned[0]).toContain("Namespace 'hooks' spells a literal segment");

      // A reload after the seal — the same id registered again — is no new
      // install: it installs, and the warning is not repeated.
      const svc = kernel.getService('manifest') as { register(m: unknown): void | Promise<void> };
      await expect(Promise.resolve(svc.register({ packages: [{ manifest: { ...body(ALPHA, 'hooks'), version: '1.0.1' } }] }))).resolves.not.toThrow();
      expect(ql.registry.getPackage(ALPHA)?.manifest?.version).toBe('1.0.1');
      expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(`Package '${ALPHA}' is installed under a namespace`))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('CONTROL — after that boot, ANOTHER package installing under a literal namespace is still refused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const kernel = await bootHolding(body(ALPHA, 'hooks'));
      const svc = kernel.getService('manifest') as { register(m: unknown): void | Promise<void> };
      let err: Refusal | undefined;
      try {
        await svc.register({ packages: [{ manifest: body('com.acme.beta', 'trigger') }] });
      } catch (e) {
        err = e as Refusal;
      }
      expect([err?.code, err?.status], err?.message).toEqual(['NAMESPACE_CONFLICT', 422]);
      expect(kernel.getService<ObjectQL>('objectql').registry.getPackage('com.acme.beta')).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});
