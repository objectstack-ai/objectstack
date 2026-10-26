// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dataset query refused by the analytics READ admission comes back as a typed
 * `AnalyticsForbiddenError`, not the generic `Dataset query failed: 403 …`
 * string (objectui#10899 item 3).
 *
 * Measured on the 2026-09-28 local E2E: an invited member opening an app
 * dashboard saw the tile read `Dataset query failed: 403 Forbidden —
 * [Analytics] Access denied: reading "y8bc_customer" is not permitted for this
 * user.` while the list view over the same object showed its localized
 * no-access panel. The server's answer is fully declared —
 * `@objectstack/service-analytics`' `readAdmissionDeniedError` sets `code:
 * 'PERMISSION_DENIED'` and `status: 403` — and the adapter's own doctrine is to
 * branch on that code; it had no branch for it, so it reached the residual.
 *
 * The body below is the producer's, verbatim in shape: the flat ADR-0112
 * `{ code, message }` family `registerAnalyticsEndpoints` writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackAdapter, AnalyticsForbiddenError, clearSharedDiscoveryCache } from './index';

const DENIED_MESSAGE = '[Analytics] Access denied: reading "y8bc_customer" is not permitted for this user.';

function adapterAnswering(status: number, body: unknown) {
  const fetchImpl = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/api/v1/discovery')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) } as any;
    }
    if (u.includes('/api/v1/analytics/dataset/query')) {
      return { ok: false, status, statusText: status === 403 ? 'Forbidden' : 'Error', json: async () => body } as any;
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) } as any;
  });
  return new ObjectStackAdapter({ baseUrl: 'http://localhost:3000', autoReconnect: false, fetch: fetchImpl as any });
}

const selection = { dimensions: ['status'], measures: ['count'] };

describe('queryDataset — a read-admission refusal is typed (objectui#10899)', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('403 PERMISSION_DENIED throws AnalyticsForbiddenError carrying status + code, not the generic string', async () => {
    const adapter = adapterAnswering(403, { code: 'PERMISSION_DENIED', message: DENIED_MESSAGE });

    const err = await adapter.queryDataset('y8bc_customer_by_status', selection).catch((e) => e);

    expect(err).toBeInstanceOf(AnalyticsForbiddenError);
    // The two fields the shared `classifyLoadError` reads — no message matching.
    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.serverCode).toBe('PERMISSION_DENIED');
    expect(err.serverMessage).toBe(DENIED_MESSAGE);
    expect(err.datasetName).toBe('y8bc_customer_by_status');
    expect(String(err.message)).not.toContain('Dataset query failed');
  });

  it('CONTROL — a named non-permission failure keeps the generic, detailed error', async () => {
    const adapter = adapterAnswering(400, { code: 'DATASET_INVALID', message: 'relationship not declared in include' });

    const err = await adapter.queryDataset('y8bc_customer_by_status', selection).catch((e) => e);

    expect(err).not.toBeInstanceOf(AnalyticsForbiddenError);
    expect(String(err.message)).toContain('Dataset query failed: 400');
    expect(String(err.message)).toContain('relationship not declared in include');
  });

  it('CONTROL — a code-less 403 (no ObjectStack route wrote it) is not read as a permission verdict', async () => {
    const adapter = adapterAnswering(403, '<html>Forbidden by proxy</html>');

    const err = await adapter.queryDataset('y8bc_customer_by_status', selection).catch((e) => e);

    expect(err).not.toBeInstanceOf(AnalyticsForbiddenError);
    expect(String(err.message)).toContain('Dataset query failed: 403');
  });
});
