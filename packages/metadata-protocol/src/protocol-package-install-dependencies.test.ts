// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0141 D2 at the protocol install primitive: `installPackage` refuses a
 * package whose declared `dependencies` the environment does not satisfy,
 * before it registers or persists anything.
 *
 * Before this check the primitive installed such a package and the gap
 * surfaced later, at the dependent's first cross-app save. The refusal is the
 * ADR-0112 envelope — `code` + `status` — with one `dependency_missing` issue
 * per unmet entry, every entry in one answer.
 */

import { describe, it, expect, vi } from 'vitest';
import { DependencyMissingError } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './index.js';

function makeImpl(installed: Record<string, { version?: unknown }> = {}) {
  const registryCalls: Array<{ manifest: any }> = [];
  const engine = {
    registry: {
      getPackage: (id: string) => (id in installed ? { manifest: { id, ...installed[id] } } : undefined),
      installPackage: (manifest: any) => {
        registryCalls.push({ manifest });
        return { manifest, status: 'installed', enabled: true };
      },
    },
    find: async () => [],
  };
  const publish = vi.fn(async () => ({ success: true }));
  const services = new Map<string, any>([['package', { publish }]]);
  const impl = new ObjectStackProtocolImplementation(engine as any, () => services);
  return { impl, registryCalls, publish };
}

const PSA = {
  id: 'com.acme.psa', name: 'PSA', type: 'app', version: '1.0.0',
  dependencies: { 'com.hotcrm.sales': '^6.0.0', 'com.acme.billing': '>=2.1.0' },
};

async function refusal(impl: ObjectStackProtocolImplementation, manifest: unknown): Promise<DependencyMissingError> {
  try {
    await (impl as any).installPackage({ manifest });
  } catch (e) {
    return e as DependencyMissingError;
  }
  throw new Error('expected installPackage to refuse');
}

describe('installPackage — ADR-0141 D2 pre-install dependency check', () => {
  it('refuses a package whose dependencies are absent or out of range: 422 DEPENDENCY_MISSING, every entry, nothing written', async () => {
    const { impl, registryCalls, publish } = makeImpl({ 'com.hotcrm.sales': { version: '5.4.0' } });
    const err = await refusal(impl, PSA);
    expect(err).toBeInstanceOf(DependencyMissingError);
    expect(err.code).toBe('DEPENDENCY_MISSING');
    expect(err.status).toBe(422);
    expect(err.unmet).toEqual([
      { packageId: 'com.acme.psa', dependency: 'com.hotcrm.sales', range: '^6.0.0', found: 'out-of-range', installedVersion: '5.4.0' },
      { packageId: 'com.acme.psa', dependency: 'com.acme.billing', range: '>=2.1.0', found: 'absent' },
    ]);
    expect(err.issues.map((i) => i.category)).toEqual(['dependency_missing', 'dependency_missing']);
    // Refused BEFORE any registry write or durable persist.
    expect(registryCalls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('installs once every declared dependency is installed inside its range', async () => {
    const { impl, registryCalls, publish } = makeImpl({
      'com.hotcrm.sales': { version: '6.2.0' },
      'com.acme.billing': { version: '2.1.0' },
    });
    const res: any = await (impl as any).installPackage({ manifest: PSA });
    expect(res.package.status).toBe('installed');
    expect(registryCalls).toHaveLength(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a range outside the stated grammar', async () => {
    const { impl, registryCalls } = makeImpl({ 'com.hotcrm.sales': { version: '6.2.0' } });
    const err = await refusal(impl, { ...PSA, dependencies: { 'com.hotcrm.sales': 'latest' } });
    expect(err.code).toBe('DEPENDENCY_MISSING');
    expect(err.unmet).toEqual([
      { packageId: 'com.acme.psa', dependency: 'com.hotcrm.sales', range: 'latest', found: 'unreadable-range', installedVersion: '6.2.0' },
    ]);
    expect(registryCalls).toHaveLength(0);
  });

  it('leaves a package that declares nothing exactly as it installed before', async () => {
    const { impl, registryCalls } = makeImpl();
    const res: any = await (impl as any).installPackage({
      manifest: { id: 'com.acme.solo', name: 'Solo', type: 'app', version: '1.0.0' },
    });
    expect(res.package.status).toBe('installed');
    expect(registryCalls).toHaveLength(1);
  });
});
