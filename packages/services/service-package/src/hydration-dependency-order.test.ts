// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0141 D5 — the `sys_packages` hydrate registers its batch in
 * `manifest.dependencies` order, through the REAL registry gate.
 *
 * Two modules that share their parent's namespace and come back from
 * `sys_packages` before the parent used to meet the namespace gate with the
 * parent absent: the second module was refused `NAMESPACE_CONFLICT`, logged as
 * "NOT hydrated", and missing for the process lifetime. Sorted, the parent
 * registers first and both modules are its co-owners.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { PackageServicePlugin } from './index.js';

const parent = { id: 'com.acme.crm', name: 'CRM', version: '6.0.0', type: 'app', namespace: 'crm' };
const moduleOf = (id: string, dependencies: Record<string, string>) =>
  ({ id, name: id, version: '1.0.0', type: 'module', namespace: 'crm', dependencies });

function row(manifest: Record<string, unknown>) {
  return {
    id: manifest.id, version: manifest.version, manifest: JSON.stringify(manifest),
    metadata: '{}', hash: 'h', created_at: 't', updated_at: 't',
  };
}

async function hydrate(manifests: Array<Record<string, unknown>>) {
  const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
  (registry as unknown as { logLevel: string }).logLevel = 'silent';
  const execute = vi.fn(async ({ sql }: { sql: string }) =>
    (/SELECT \* FROM sys_packages/i.test(sql) ? { rows: manifests.map(row) } : { rows: [] }));
  const services = new Map<string, unknown>([['objectql', { execute, registry }]]);
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = {
    logger,
    getService: (n: string) => services.get(n),
    registerService: (n: string, s: unknown) => services.set(n, s),
  } as never;
  await new PackageServicePlugin().start(ctx);
  return { registry, errors: logger.error.mock.calls.map((c: unknown[]) => String(c[0])) };
}

describe('sys_packages hydrate — ADR-0141 D5 dependency order', () => {
  it('hydrates two modules listed before their parent: all three registered, none refused', async () => {
    const onCrm = { 'com.acme.crm': '^6.0.0' };
    const { registry, errors } = await hydrate([
      moduleOf('com.acme.crm.revenue', onCrm),
      moduleOf('com.acme.crm.marketing', onCrm),
      parent,
    ]);
    expect(errors).toEqual([]);
    expect(registry.getNamespaceOwners('crm').sort())
      .toEqual(['com.acme.crm', 'com.acme.crm.marketing', 'com.acme.crm.revenue']);
  });

  it('a dependency cycle degrades to source order, is logged naming its members, and the batch still hydrates', async () => {
    const a = { id: 'com.acme.a', name: 'A', version: '1.0.0', type: 'app', namespace: 'aa', dependencies: { 'com.acme.b': '1.x' } };
    const b = { id: 'com.acme.b', name: 'B', version: '1.0.0', type: 'app', namespace: 'bb', dependencies: { 'com.acme.a': '1.x' } };
    const { registry, errors } = await hydrate([a, b, parent]);
    expect(registry.getPackage('com.acme.a')).toBeDefined();
    expect(registry.getPackage('com.acme.b')).toBeDefined();
    expect(registry.getPackage('com.acme.crm')).toBeDefined();
    const cycle = errors.find((e) => e.includes('cycle'));
    expect(cycle).toContain('com.acme.a');
    expect(cycle).toContain('com.acme.b');
  });
});
