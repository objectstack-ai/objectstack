// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31898] The storage family's three API-key doors hand where the request
 * came from to the key's use stamp: the family's ADR-0069 gate reader (its
 * key arm calls the key-admission seam itself), the parent-governed download
 * authorizer and the upload attacher (both through the request composition).
 * Each hands the transport's peer address and the headers to the auth
 * service's trust rule, and the address it establishes is what the
 * `credential_use` row records, with the user agent. No door reads a forwarded
 * header itself.
 *
 * The three are package-internal closures `composeStorageRoutes` binds into
 * `registerStorageFamily`, so the composition is driven for real and the
 * closures are taken from that call; `storage-routes.request-context-door.pin.test.ts`
 * holds what they answer on the mounted routes.
 */

import { describe, expect, it, vi } from 'vitest';
import { currentCredentialUseClient, hashApiKey } from '@objectstack/core';
import type { IHttpRequest, IStorageService } from '@objectstack/spec/contracts';

const captured = vi.hoisted(() => ({ args: undefined as unknown[] | undefined }));

vi.mock('./storage-routes.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./storage-routes.js')>();
  return {
    ...real,
    registerStorageFamily: (...args: unknown[]) => {
      captured.args = args;
    },
  };
});

const { composeStorageRoutes } = await import('./storage-service-plugin.js');

const KEY = 'osk_storage_credential_use_client';
const OWNER = 'u_key';
const ORG = 'org_alpha';
const ESTABLISHED = '203.0.113.7';
const PEER = '10.0.0.5';
const UA = 'ci-agent/3.1';

function compose(opts: { gateActive: boolean }) {
  const stamps: unknown[] = [];
  const handed: Array<{ headers?: Record<string, unknown>; remoteAddress?: string }> = [];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    sys_api_key: [{ id: 'k_live', key: hashApiKey(KEY), revoked: false, user_id: OWNER, active_organization_id: ORG, expires_at: '2999-01-01T00:00:00Z' }],
    sys_member: [{ user_id: OWNER, organization_id: ORG, role: 'member' }],
    sys_user: [{ id: OWNER }],
  };
  const engine = {
    async find(object: string, q: { where?: Record<string, unknown>; limit?: number } = {}) {
      const rows = (tables[object] ?? []).filter((row) =>
        Object.entries(q.where ?? {}).every(([k, v]) => {
          if (v !== null && typeof v === 'object') return ((v as { $in?: unknown[] }).$in ?? []).includes(row[k]);
          return (v ?? null) === (row[k] ?? null);
        }),
      );
      return typeof q.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    async findOne(object: string, q: { where?: Record<string, unknown> } = {}) {
      return (await this.find(object, q))[0] ?? null;
    },
    // The key's use stamp: what plugin-audit's hook reads, read here.
    async update() {
      stamps.push(currentCredentialUseClient() ?? null);
      return {};
    },
  };
  const services: Record<string, unknown> = {
    objectql: engine,
    auth: {
      api: { getSession: async () => undefined },
      isAuthGateActive: () => opts.gateActive,
      resolveUserAuthGates: async () => [],
      resolveClientAddress: (transport: { headers?: Record<string, unknown>; remoteAddress?: string }) => {
        handed.push(transport);
        return ESTABLISHED;
      },
    },
    'file-attachments': { attachUploadAs: async () => ({ attachmentId: 'att_1' }) },
  };
  const registry = {
    getService: <T>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    getServiceAsync: async <T>(name: string): Promise<T> => services[name] as T,
  };
  captured.args = undefined;
  composeStorageRoutes({} as never, registry, { storage: {} as IStorageService, engine: engine as never });
  if (!captured.args) throw new Error('fixture: the storage family was not registered');
  const [, , , options, readGatedSessionUser, attachUpload] = captured.args as [
    unknown, unknown, unknown,
    { authorizeFileRead?: (file: unknown, req: IHttpRequest) => Promise<unknown> },
    ((req: IHttpRequest) => Promise<unknown>) | undefined,
    ((req: IHttpRequest, upload: unknown) => Promise<unknown>) | undefined,
  ];
  return { stamps, handed, authorizeFileRead: options.authorizeFileRead, readGatedSessionUser, attachUpload };
}

const keyRequest = () =>
  ({
    headers: { 'x-api-key': KEY, 'user-agent': UA, 'x-forwarded-for': '198.51.100.9' },
    remoteAddress: PEER,
    method: 'GET',
    path: '/api/v1/storage/files/f/url',
  }) as unknown as IHttpRequest;

const EXPECTED = { ipAddress: ESTABLISHED, userAgent: UA };

function expectHandedRaw(handed: Array<{ headers?: Record<string, unknown>; remoteAddress?: string }>, n: number) {
  expect(handed).toHaveLength(n);
  for (const t of handed) {
    expect(t.remoteAddress).toBe(PEER);
    expect(t.headers?.['x-forwarded-for'], 'handed over raw: the auth service decides whether it counts').toBe('198.51.100.9');
  }
}

describe('[#31898] the storage doors hand their client facts to the key\'s use stamp', () => {
  it('the family gate reader\'s key arm: the stamp runs with the established address and the user agent', async () => {
    const door = compose({ gateActive: true });
    await door.readGatedSessionUser!(keyRequest());
    expectHandedRaw(door.handed, 1);
    expect(door.stamps).toEqual([EXPECTED]);
  });

  it('the parent-governed download authorizer: the stamp runs with the established address and the user agent', async () => {
    const door = compose({ gateActive: false });
    await door.authorizeFileRead!(
      { id: 'f', status: 'committed', scope: 'record', acl: 'private', owner_id: 'u_other', ref_object: 'contract', ref_id: 'r', ref_field: 'attachment' },
      keyRequest(),
    );
    expectHandedRaw(door.handed, 1);
    expect(door.stamps).toEqual([EXPECTED]);
  });

  it('the upload attacher: the stamp runs with the established address and the user agent', async () => {
    const door = compose({ gateActive: false });
    await door.attachUpload!(keyRequest(), { fileId: 'f', parentObject: 'contract', parentId: 'r' });
    expectHandedRaw(door.handed, 1);
    expect(door.stamps).toEqual([EXPECTED]);
  });
});
