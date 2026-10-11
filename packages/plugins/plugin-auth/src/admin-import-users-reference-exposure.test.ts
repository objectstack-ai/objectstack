// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22800] The identity import's lookup cells are judged like every other
 * `runImport` caller's: the run protocol carries the declaration reader the
 * import already holds, so `servesReferenceTarget` (`@objectstack/core`,
 * #22739) asks each lookup TARGET its declared exposure for `list` before a
 * cell is matched against it.
 *
 * A target whose declaration refuses `list` answers as a target the caller
 * cannot read: `reference_not_found` for a cell naming a record, a cell naming
 * none and a pasted id alike, and nothing of the target is read. A serving
 * target is unchanged. The reads run under the system identity, which is no
 * exemption: the decision takes no caller.
 *
 * Fixture objects only. The decision's own matrix (every refusing and serving
 * declaration, fail-closed) is pinned once, in
 * `packages/core/src/utils/import-runner-reference-exposure.test.ts`; this file
 * pins that THIS door asks it.
 */

import { describe, it, expect, vi } from 'vitest';
import { runAdminImportUsers, type IdentityImportDeps } from './admin-import-users.js';
import type { AdminActor } from './admin-user-endpoints.js';

const ACTOR: AdminActor = { id: 'admin-1', email: 'admin@example.com' };

/** The fixture lookup target, and the one record it holds. */
const TARGET = 'fx_unit';
const RECORD = { id: 'fx_1', name: 'Existing' };
const LOOKUP = 'fx_unit_id';

/** The `sys_user` declaration this double serves: two plain columns and one lookup into the fixture target. */
const SYS_USER = {
  name: 'sys_user',
  fields: {
    email: { type: 'text', label: 'Email' },
    name: { type: 'text', label: 'Name' },
    [LOOKUP]: { type: 'lookup', label: 'Unit', reference: TARGET },
  },
};

/** Three rows: a cell naming the record, a cell naming none, and the record's id. */
const ROWS = [
  { email: 'a@fx.test', [LOOKUP]: 'Existing' },
  { email: 'b@fx.test', [LOOKUP]: 'Missing' },
  { email: 'c@fx.test', [LOOKUP]: 'fx_1' },
];

function importRequest(rows: Array<Record<string, unknown>>): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passwordPolicy: 'none', format: 'json', rows }),
  });
}

/**
 * The identity import's deps over a fixture target whose declaration is
 * `enable` (absent = no `enable` block). `reader: false` composes the import
 * without a declaration reader at all.
 */
function harness(enable: unknown, opts: { reader?: boolean } = {}) {
  let nextId = 1;
  const createUser = vi.fn(async ({ body }: { body: { email: string; name: string } }) => ({
    user: { id: `u-${nextId++}`, email: body.email, name: body.name },
  }));
  const find = vi.fn(async (object: string, q: { where?: Record<string, unknown> }) => {
    if (object !== TARGET) return [];
    const [[field, value]] = Object.entries(q.where ?? {});
    return (RECORD as Record<string, unknown>)[field] === value ? [RECORD] : [];
  });
  const getMetaItem = vi.fn(async ({ name }: { type: string; name: string }) => {
    if (name === 'sys_user') return { type: 'object', name, item: SYS_USER };
    if (name === TARGET) return { type: 'object', name, item: { name, ...(enable === undefined ? {} : { enable }) } };
    return { type: 'object', name, item: undefined };
  });
  const deps: IdentityImportDeps = {
    getAuthApi: async () => ({ createUser, requestPasswordReset: vi.fn() }),
    getDataEngine: () => ({ find, update: vi.fn(async () => ({})), insert: vi.fn(async () => ({})) }),
    ...(opts.reader === false ? {} : { getMetaItem }),
    phoneNumberEnabled: () => false,
    emailServiceAvailable: () => true,
    smsInviteAvailable: () => false,
    sendInviteSms: vi.fn(async () => {}),
    noteMustChangePasswordIssued: vi.fn(),
  };
  return { deps, createUser, find, getMetaItem };
}

type RowVerdict = { ok: boolean; code?: string; field?: string };
const verdict = (r: RowVerdict) => ({ ok: r.ok, code: r.code, field: r.field });
const NOT_FOUND = { ok: false, code: 'reference_not_found', field: LOOKUP };
const OK = { ok: true, code: undefined, field: undefined };

const targetReads = (find: ReturnType<typeof harness>['find']) => find.mock.calls.filter(([object]) => object === TARGET);

async function runImport(h: ReturnType<typeof harness>) {
  const res = await runAdminImportUsers(h.deps, importRequest(ROWS), ACTOR);
  expect(res.status).toBe(200);
  return (res.body.data as { rows: RowVerdict[] }).rows.map(verdict);
}

describe('[#22800] the identity import asks each lookup target its declared exposure, for list', () => {
  for (const [label, enable] of [
    ['apiEnabled: false', { apiEnabled: false }],
    ['a whitelist granting get but not list', { apiMethods: ['get'] }],
  ] as const) {
    it(`${label}: a match, a miss and an id all answer reference_not_found, and the target is never read`, async () => {
      const h = harness(enable);
      expect(await runImport(h)).toEqual([NOT_FOUND, NOT_FOUND, NOT_FOUND]);
      expect(targetReads(h.find)).toEqual([]);
      expect(h.createUser).not.toHaveBeenCalled();
    });
  }

  for (const [label, enable] of [
    ['no enable block', undefined],
    ['a whitelist granting list', { apiMethods: ['list'] }],
  ] as const) {
    it(`CONTROL ${label}: a match and an id resolve, a miss is reported, as before`, async () => {
      const h = harness(enable);
      expect(await runImport(h)).toEqual([OK, NOT_FOUND, OK]);
      expect(targetReads(h.find).length).toBeGreaterThan(0);
      expect(h.createUser).toHaveBeenCalledTimes(2);
    });
  }

  it('the target is asked through the reader the import holds, once per import, by its own name', async () => {
    const h = harness({ apiEnabled: false });
    await runImport(h);
    expect(h.getMetaItem.mock.calls.map(([ref]) => ref)).toEqual([
      { type: 'object', name: 'sys_user' },
      { type: 'object', name: TARGET },
    ]);
  });

  it('CONTROL without a declaration reader no cell is a reference: the target is neither asked nor read', async () => {
    const h = harness({ apiEnabled: false }, { reader: false });
    expect(await runImport(h)).toEqual([OK, OK, OK]);
    expect(h.getMetaItem).not.toHaveBeenCalled();
    expect(targetReads(h.find)).toEqual([]);
  });
});
