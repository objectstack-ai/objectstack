// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Attachment-removal route-ledger conformance — the package-local guard every
 * `*-route-ledger.ts` pairs with. `registerAttachmentRemovalRoutes` is a
 * standalone, synchronous function that calls `http.delete` and touches neither
 * argument before a request arrives, so a capturing mock `IHttpServer`
 * enumerates its real surface (the seam the comment-reaction, personal-view,
 * print, storage and settings ledgers use), and the two directions fail here by
 * name on every `pnpm test` of this package.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerAttachmentRemovalRoutes } from './attachment-removal-routes.js';
import { ATTACHMENT_REMOVAL_ROUTE_LEDGER } from './attachment-removal-route-ledger.js';

function createMockServer() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function enumerateRoutes(): Set<string> {
  const server = createMockServer();
  registerAttachmentRemovalRoutes(server as any, {} as any);
  const keys = new Set<string>();
  for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    for (const call of server[verb].mock.calls) keys.add(`${verb.toUpperCase()} ${call[0]}`);
  }
  return keys;
}

const ledgerKeys = (): Set<string> => new Set(ATTACHMENT_REMOVAL_ROUTE_LEDGER.map((e) => e.route));

describe('attachment-removal route ledger ↔ registerAttachmentRemovalRoutes enumeration', () => {
  it('every mounted route has a ledger entry', () => {
    const ledger = ledgerKeys();
    const missing = [...enumerateRoutes()].filter((k) => !ledger.has(k));
    expect(missing, `attachment-removal routes with no ledger entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('every ledger entry is really mounted by the registrar', () => {
    const live = enumerateRoutes();
    const stale = [...ledgerKeys()].filter((k) => !live.has(k));
    expect(stale, `attachment-removal ledger entries the registrar no longer mounts: ${stale.join(', ')}`).toEqual([]);
  });

  it('the ledger is compared against a real enumeration, not an empty one', () => {
    const live = enumerateRoutes();
    expect(live.size).toBeGreaterThan(0);
    expect(live.size).toBe(ledgerKeys().size);
    expect(ATTACHMENT_REMOVAL_ROUTE_LEDGER.every((e) => e.disposition === 'sdk' || (e.note ?? '').length > 0)).toBe(true);
  });
});
