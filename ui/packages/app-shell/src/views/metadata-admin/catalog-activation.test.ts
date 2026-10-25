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
  isCatalogItemActive,
  readCatalogActivation,
  writeCatalogActivation,
} from './catalog-activation';

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
