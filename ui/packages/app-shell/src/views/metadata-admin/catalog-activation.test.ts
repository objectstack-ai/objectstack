// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7611 — the Setup catalog's active switch (`catalog-activation.ts`)
 * reads and writes the activation ledger, never a catalog row. Pinned: which
 * types have a switch, the ledger read (the resolver's reading of the rows,
 * and no catalog row read), the door write and its refusals in the server's
 * own words, and the names the door refuses to switch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AUDIENCE_ANCHOR_POSITIONS } from '@objectstack/spec/identity';
import {
  audienceAnchorsOf,
  hasCatalogActivation,
  isCatalogHolderActive,
  isCatalogItemActive,
  readCatalogActivation,
  readCatalogLedger,
  writeCatalogActivation,
} from './catalog-activation';
import { PermissionSetHolderConflict } from './permission-set-holder';

interface Call {
  url: string;
  method: string;
  body?: string;
}

/** Stub `fetch` with one canned answer; returns the calls it saw. */
function stubFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body as string | undefined });
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('catalog-activation (objectui#7611)', () => {
  it('offers a switch for permission sets and positions, never for capabilities', () => {
    expect(hasCatalogActivation('permission')).toBe(true);
    expect(hasCatalogActivation('position')).toBe(true);
    // The door refuses `capability` with 400 (ADR-0126 §3: code-only).
    expect(hasCatalogActivation('capability')).toBe(false);
  });

  it("reads the type's ledger rows by name, as the resolver reads them, and no catalog row", async () => {
    const calls = stubFetch(200, {
      object: 'sys_metadata_activation',
      records: [
        { metadata_type: 'permission', name: 'off_set', active: false },
        // A driver that round-trips booleans as 0/1.
        { metadata_type: 'permission', name: 'off_by_zero', active: 0 },
        { metadata_type: 'permission', name: 'on_set', active: true },
        // Another type's row with a colliding name is not this type's switch.
        { metadata_type: 'position', name: 'on_set', active: false },
        { metadata_type: 'flow', name: 'some_flow', active: false },
      ],
      total: 5,
      hasMore: false,
    });
    const states = await readCatalogActivation('permission');
    expect([...states.entries()]).toEqual([
      ['off_set', false],
      ['off_by_zero', false],
      ['on_set', true],
    ]);
    // No row means ACTIVE.
    expect(isCatalogItemActive(states, 'never_switched')).toBe(true);
    expect(calls).toEqual([{ url: '/api/v1/data/sys_metadata_activation?top=1000', method: 'GET', body: undefined }]);
    expect(calls.some((c) => /sys_permission_set|sys_position/.test(c.url))).toBe(false);
  });

  it('reads nothing for a type without a switch', async () => {
    const calls = stubFetch(200, { records: [] });
    expect((await readCatalogActivation('capability')).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('rejects a refused read with the server message, and a truncated one, rather than answering "active"', async () => {
    stubFetch(403, { error: 'You do not have permission to perform this action.', code: 'PERMISSION_DENIED' });
    await expect(readCatalogActivation('permission')).rejects.toThrow('You do not have permission to perform this action.');
    stubFetch(200, { records: [], hasMore: true });
    await expect(readCatalogActivation('position')).rejects.toThrow(/more than 1000 rows/);
  });

  it('switches through the door with exactly { enabled }, and answers the state the server reports', async () => {
    const calls = stubFetch(200, { success: true, data: { type: 'position', name: 'auditor', enabled: false } });
    await expect(writeCatalogActivation('position', 'auditor', false)).resolves.toBe(false);
    expect(calls).toEqual([
      { url: '/api/v1/security/_activation/position/auditor', method: 'POST', body: '{"enabled":false}' },
    ]);
  });

  it("rejects a door refusal with the server's own sentence, and a type without a switch before any request", async () => {
    const lastAdmin =
      "Switching permission set 'admin_full_access' off would leave no administrator who can sign in.";
    stubFetch(403, { success: false, error: { code: 'PERMISSION_DENIED', message: lastAdmin, httpStatus: 403 } });
    await expect(writeCatalogActivation('permission', 'admin_full_access', false)).rejects.toThrow(lastAdmin);

    const calls = stubFetch(200, {});
    await expect(writeCatalogActivation('capability', 'manage_metadata', false)).rejects.toThrow(/capability/);
    expect(calls).toEqual([]);
  });

  it("names the spec's audience anchors for positions, and none for permission sets", async () => {
    expect([...(await audienceAnchorsOf('position'))].sort()).toEqual([...AUDIENCE_ANCHOR_POSITIONS].sort());
    expect((await audienceAnchorsOf('position')).has('everyone')).toBe(true);
    expect((await audienceAnchorsOf('permission')).size).toBe(0);
  });
});

describe('catalog-activation: a permission set more than one package holds (objectstack#32537)', () => {
  const TWO = ['com.acme.crm', 'com.acme.sales'];

  it('CONTROL: a write that names no package is the name alone, as before', async () => {
    const calls = stubFetch(200, { success: true, data: { enabled: false } });
    await writeCatalogActivation('permission', 'sales_rep', false);
    await writeCatalogActivation('permission', 'sales_rep', false, undefined);
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v1/security/_activation/permission/sales_rep',
      '/api/v1/security/_activation/permission/sales_rep',
    ]);
  });

  it("names the holder's package as ?package=, with the body unchanged, for permission sets only", async () => {
    const calls = stubFetch(200, { success: true, data: { enabled: false } });
    await writeCatalogActivation('permission', 'sales_rep', false, 'com.acme.sales');
    // The door refuses any query for another type (400), so none is sent.
    await writeCatalogActivation('position', 'auditor', false, 'com.acme.sales');
    expect(calls).toEqual([
      {
        url: '/api/v1/security/_activation/permission/sales_rep?package=com.acme.sales',
        method: 'POST',
        body: '{"enabled":false}',
      },
      { url: '/api/v1/security/_activation/position/auditor', method: 'POST', body: '{"enabled":false}' },
    ]);
  });

  it("rejects a 409 naming the holders with the server's sentence and every candidate, choosing none", async () => {
    const message = 'Permission set "sales_rep" is held by more than one package; name one with ?package=.';
    const candidates = [
      { kind: 'package', packageId: 'com.acme.crm' },
      { kind: 'package', packageId: 'com.acme.sales' },
    ];
    const calls = stubFetch(409, { success: false, error: { code: 'RESOURCE_CONFLICT', message, details: { candidates } } });
    const refusal = await writeCatalogActivation('permission', 'sales_rep', false).catch((err: unknown) => err);
    expect(refusal).toBeInstanceOf(PermissionSetHolderConflict);
    expect((refusal as PermissionSetHolderConflict).message).toBe(message);
    expect((refusal as PermissionSetHolderConflict).candidates).toEqual(candidates);
    // One request: nothing is retried with a holder picked here.
    expect(calls).toHaveLength(1);

    // A 409 that names nobody is the server's sentence alone.
    stubFetch(409, { success: false, error: { code: 'RESOURCE_CONFLICT', message: 'Another row keeps it off.' } });
    const plain = await writeCatalogActivation('permission', 'sales_rep', true).catch((err: unknown) => err);
    expect(plain).not.toBeInstanceOf(PermissionSetHolderConflict);
    expect((plain as Error).message).toBe('Another row keeps it off.');
  });

  it("keeps each permission row with its package beside the by-name states, from the one ledger read", async () => {
    const calls = stubFetch(200, {
      records: [
        { metadata_type: 'permission', name: 'sales_rep', package_id: 'com.acme.crm', active: false },
        { metadata_type: 'permission', name: 'sales_rep', package_id: 'sys_metadata', active: 0 },
        { metadata_type: 'permission', name: 'auditor', package_id: '', active: true },
        { metadata_type: 'position', name: 'sales_rep', package_id: 'com.acme.crm', active: false },
      ],
    });
    const read = await readCatalogLedger('permission');
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/data/sys_metadata_activation?top=1000']);
    expect(read.permissionRows).toEqual([
      { name: 'sales_rep', packageId: 'com.acme.crm', active: false },
      { name: 'sales_rep', packageId: null, active: false },
      { name: 'auditor', packageId: null, active: true },
    ]);
    expect(read.states).toEqual(await readCatalogActivation('permission'));
    expect((await readCatalogLedger('position')).permissionRows).toEqual([]);
  });

  it("reads one holder's state by core's ledger rule; one holder is read by the name", () => {
    const ledger = (rows: Array<{ name: string; packageId: string | null; active: boolean }>, states = new Map<string, boolean>()) => ({
      states,
      permissionRows: rows,
    });
    const crmOff = ledger([{ name: 'sales_rep', packageId: 'com.acme.crm', active: false }], new Map([['sales_rep', false]]));
    expect(isCatalogHolderActive(crmOff, 'sales_rep', { packageId: 'com.acme.crm', holders: TWO })).toBe(false);
    // The other package's set of the name is not switched off by that row.
    expect(isCatalogHolderActive(crmOff, 'sales_rep', { packageId: 'com.acme.sales', holders: TWO })).toBe(true);
    // CONTROL: no holding, or one holder, is the by-name reading.
    expect(isCatalogHolderActive(crmOff, 'sales_rep', undefined)).toBe(isCatalogItemActive(crmOff.states, 'sales_rep'));
    expect(isCatalogHolderActive(crmOff, 'sales_rep', { packageId: 'com.acme.sales', holders: ['com.acme.sales'] })).toBe(false);

    // A row naming no package under two package holders keeps both off.
    const legacy = ledger([{ name: 'sales_rep', packageId: null, active: false }]);
    expect(isCatalogHolderActive(legacy, 'sales_rep', { packageId: 'com.acme.crm', holders: TWO })).toBe(false);
    expect(isCatalogHolderActive(legacy, 'sales_rep', { packageId: 'com.acme.sales', holders: TWO })).toBe(false);
    // …and is the environment's own switch where the environment holds the name.
    const envAndCrm = [null, 'com.acme.crm'];
    expect(isCatalogHolderActive(legacy, 'sales_rep', { packageId: null, holders: envAndCrm })).toBe(false);
    expect(isCatalogHolderActive(legacy, 'sales_rep', { packageId: 'com.acme.crm', holders: envAndCrm })).toBe(true);
    // A row switched back on switches nothing off.
    const on = ledger([{ name: 'sales_rep', packageId: 'com.acme.crm', active: true }]);
    expect(isCatalogHolderActive(on, 'sales_rep', { packageId: 'com.acme.crm', holders: TWO })).toBe(true);
  });
});
