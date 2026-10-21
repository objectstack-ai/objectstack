// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25078] Export → admin user import round trip, through the CSV text-cell rule.
 *
 * `@objectstack/rest`'s CSV export writes a text cell its consumer would
 * interpret in a form that consumer reads as text, and its CSV import parse
 * (`parseCsvToRows`, reached through `prepareImportRequest`) reverses exactly
 * that. `POST /api/v1/auth/admin/import-users` parses a `csv` body through that
 * same `prepareImportRequest`, so a user list exported as CSV and imported back
 * here must hand better-auth's `createUser` every stored name exactly.
 *
 * The file is produced by the REAL export route of `@objectstack/rest`'s
 * `RestServer` over a protocol double that serves a two-field `sys_user` schema
 * and the rows below; the import is the real `runAdminImportUsers`. The rule
 * itself is pinned at its readers in `@objectstack/rest`
 * (`csv-text-cell.test.ts`), and the other CSV doors in its
 * `csv-text-cell-round-trip.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { RestServer } from '@objectstack/rest';
import { runAdminImportUsers, type IdentityImportDeps } from './admin-import-users.js';
import type { AdminActor } from './admin-user-endpoints.js';

const ACTOR: AdminActor = { id: 'admin-1', email: 'admin@example.com' };

/** Plain words after a trigger character: marked by the export. */
const MARKED = ['=Total', '+Name', '-Note', '@acme'];
/** Ordinary business values, and a user-authored name that begins with the mark itself. */
const UNMARKED = ['+86 138 0013 8000', '+1 555 010 0000', '-120.50', 'Acme Ltd', '120.50', "'Quoted"];
const NAMES = [...MARKED, ...UNMARKED];

const SYS_USER_SCHEMA = {
  name: 'sys_user',
  fields: {
    email: { name: 'email', type: 'email' },
    name: { name: 'name', type: 'text' },
  },
};

async function exportUsersCsv(rows: Array<Record<string, string>>): Promise<string> {
  const noop = () => {};
  const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
  const protocol = {
    getMetaItem: vi.fn(async () => ({ type: 'object', name: 'sys_user', item: SYS_USER_SCHEMA })),
    findData: vi.fn(async () => ({ object: 'sys_user', records: rows, total: rows.length })),
  };
  const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: ACTOR.id });
  rest.registerRoutes();
  const route: any = rest.getRoutes().find(
    (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
  );
  expect(route).toBeDefined();
  const chunks: string[] = [];
  const res: any = {
    write: (s: unknown) => { chunks.push(String(s)); return true; },
    end: () => {},
    header: () => res,
    status: () => res,
    json: () => res,
  };
  await route.handler({ params: { object: 'sys_user' }, query: { format: 'csv' } }, res);
  return chunks.join('');
}

function makeDeps() {
  let nextId = 1;
  const createUser = vi.fn(async ({ body }: any) => ({ user: { id: `u-${nextId++}`, email: body.email, name: body.name } }));
  const update = vi.fn(async (_obj: string, data: any, options?: any) => {
    assertEngineUpdateDispatch(data, options);
    return {};
  });
  const deps: IdentityImportDeps = {
    getAuthApi: async () => ({ createUser, requestPasswordReset: vi.fn(async () => ({ status: true })) }),
    getDataEngine: () => ({ find: vi.fn(async () => []), update, insert: vi.fn(async () => ({})) }),
    phoneNumberEnabled: () => false,
    emailServiceAvailable: () => false,
    smsInviteAvailable: () => false,
    sendInviteSms: vi.fn(async () => {}),
    noteMustChangePasswordIssued: vi.fn(),
    logger: { warn: vi.fn() },
  };
  return { deps, createUser };
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/admin/import-users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin user import — CSV export → import round trip (#25078)', () => {
  it('hands createUser every exported name exactly', async () => {
    const rows = NAMES.map((name, i) => ({ email: `user${i + 1}@example.com`, name }));
    const csv = await exportUsersCsv(rows);

    // The file carried the marks, so the round trip below is not a pass-through.
    expect(csv.split('\r\n')[0]).toBe('email,name');
    for (const [i, v] of MARKED.entries()) expect(csv).toContain(`user${i + 1}@example.com,'${v}\r\n`);
    expect(csv).toContain(',+86 138 0013 8000\r\n');
    expect(csv).toContain(",'Quoted\r\n");

    const m = makeDeps();
    const res = await runAdminImportUsers(m.deps, makeRequest({ passwordPolicy: 'temporary', csv }), ACTOR);
    expect(res.status).toBe(200);
    expect((res.body.data as any).summary.created).toBe(NAMES.length);
    const byEmail = new Map(m.createUser.mock.calls.map((c: any[]) => [c[0].body.email, c[0].body.name]));
    expect(rows.map((r) => byEmail.get(r.email))).toEqual(NAMES);
  });
});
