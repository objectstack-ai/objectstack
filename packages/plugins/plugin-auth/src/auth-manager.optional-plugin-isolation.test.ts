// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Regression tests for optional-plugin isolation in AuthManager.buildPluginList.
//
// The 15.1.0 incident: `@better-auth/oauth-provider` (resolved to 1.6.23 by
// downstream installs while the workspace tested 1.7.0-rc.1) threw
// `Cannot set properties of undefined (setting 'modelName')` during plugin
// construction. Because the better-auth instance is built lazily per request,
// that single optional plugin took down EVERY auth endpoint with a 500.
//
// Unlike auth-manager.test.ts (which mocks `better-auth` itself), this file
// runs the REAL better-auth against its in-memory adapter and only wraps two
// plugin factories in controllable failure switches — so "sign-up returns
// 200" is asserted against the genuine request pipeline.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager } from './auth-manager';

const failures = vi.hoisted(() => ({ oauthProvider: false, bearer: false }));

vi.mock('@better-auth/oauth-provider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    oauthProvider: (...args: any[]) => {
      if (failures.oauthProvider) {
        // Byte-for-byte the 15.1.0 incident error (1.6/1.7 family mix).
        throw new TypeError("Cannot set properties of undefined (setting 'modelName')");
      }
      return actual.oauthProvider(...args);
    },
  };
});

vi.mock('better-auth/plugins/bearer', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    bearer: (...args: any[]) => {
      if (failures.bearer) throw new TypeError('bearer exploded (simulated)');
      return actual.bearer(...args);
    },
  };
});

/**
 * Minimal in-memory IDataEngine covering exactly the surface the ObjectQL
 * adapter drives (insert / findOne / find / count / update / delete with the
 * eq/$ne/$in/$gt/$gte/$lt/$lte/$regex filter shapes convertWhere produces),
 * so the REAL sign-up pipeline can persist users/sessions/accounts.
 */
const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as any).getTime() === new Date(b as any).getTime()
      : a === b;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
        if ('$gt' in v) return actual > v.$gt;
        if ('$gte' in v) return actual >= v.$gte;
        if ('$lt' in v) return actual < v.$lt;
        if ('$lte' in v) return actual <= v.$lte;
        if ('$regex' in v) return new RegExp(String(v.$regex)).test(String(actual ?? ''));
      }
      return eq(actual, v);
    });
  let seq = 0;
  return {
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      return rows(name).find((r) => matches(r, q.where)) ?? null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      const order = q.orderBy?.[0];
      if (order) {
        out = [...out].sort(
          (a, b) => (a[order.field] > b[order.field] ? 1 : -1) * (order.order === 'desc' ? -1 : 1),
        );
      }
      if (q.offset) out = out.slice(q.offset);
      if (q.limit) out = out.slice(0, q.limit);
      return out.map((r) => ({ ...r }));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any) {
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};

describe('AuthManager – optional better-auth plugin isolation', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const makeManager = () =>
    new AuthManager({
      secret: 'test-secret-at-least-32-chars-long!!',
      baseUrl: 'http://localhost:3000',
      dataEngine: createMemoryEngine() as any,
      plugins: { oidcProvider: true },
    });

  const signUp = (manager: AuthManager, email: string) =>
    manager.handleRequest(
      new Request('http://localhost:3000/api/v1/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'S3cure!Passw0rd-isolation',
          name: 'Isolation Test',
        }),
      }),
    );

  beforeEach(() => {
    failures.oauthProvider = false;
    failures.bearer = false;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('healthy control: oidcProvider constructs for real and sign-up returns 200', async () => {
    const manager = makeManager();
    const response = await signUp(manager, 'healthy@example.com');

    expect(response.status).toBe(200);
    expect(manager.getDegradedAuthFeatures()).toEqual([]);
  });

  it('15.1.0 regression: a throwing oauthProvider is skipped and sign-up still returns 200', async () => {
    failures.oauthProvider = true;
    const manager = makeManager();

    const response = await signUp(manager, 'degraded@example.com');
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body?.user?.email).toBe('degraded@example.com');

    // The failure is recorded (jwt + oauthProvider land atomically, so the
    // whole oidcProvider unit is what degrades)…
    expect(manager.getDegradedAuthFeatures()).toEqual([
      expect.objectContaining({
        feature: 'oidcProvider',
        error: expect.stringContaining('modelName'),
      }),
    ]);
    // …and loudly: one actionable console.error naming the feature.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Optional auth feature "oidcProvider" failed to initialize'),
      expect.any(TypeError),
    );
  });

  it('get-session also survives a degraded optional plugin', async () => {
    failures.oauthProvider = true;
    const manager = makeManager();

    const response = await manager.handleRequest(
      new Request('http://localhost:3000/api/v1/auth/get-session'),
    );
    expect(response.status).toBe(200);
  });

  it('core plugin (bearer) still fails hard — no fail-open for security-bearing plugins', async () => {
    failures.bearer = true;
    const manager = makeManager();

    await expect(signUp(manager, 'core@example.com')).rejects.toThrow(
      'bearer exploded (simulated)',
    );
    // Core failures are NOT recorded as degraded features — the instance
    // never came up at all.
    expect(manager.getDegradedAuthFeatures()).toEqual([]);
  });

  it('degraded state resets when the instance is rebuilt with the fault gone', async () => {
    failures.oauthProvider = true;
    const manager = makeManager();
    await signUp(manager, 'rebuild-a@example.com');
    expect(manager.getDegradedAuthFeatures()).toHaveLength(1);

    // Simulate the operator fixing the underlying issue + a config-driven
    // rebuild (applyConfigPatch resets the lazy instance).
    failures.oauthProvider = false;
    manager.applyConfigPatch({});
    const response = await signUp(manager, 'rebuild-b@example.com');

    expect(response.status).toBe(200);
    expect(manager.getDegradedAuthFeatures()).toEqual([]);
  });
});
