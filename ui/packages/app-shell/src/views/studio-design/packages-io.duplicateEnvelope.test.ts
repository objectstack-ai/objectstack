// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `duplicatePackage` must read the OPERATION's verdict, not the ENVELOPE's.
 *
 * `POST /packages/:id/duplicate` is served only by the runtime dispatcher, and
 * that door always wraps: `deps.success(result)` answers
 * `{ status: 200, body: { success: true, data } }`. So the top-level `success`
 * is `true` by construction on every 200, and reading it classifies every 200
 * as a complete success. The operation's own verdict lives one level down in
 * `data`, computed server-side as `failed.length === 0 && copied.length > 0`.
 *
 * That leaves TWO reachable outcomes which answer HTTP 200 while the duplicate
 * did not succeed, and this file pins BOTH — a suite that only covered
 * `res.ok === false` would re-create the defect, because the transport arm was
 * never the broken one:
 *
 *  1. PARTIAL — `failed.length > 0`. The per-item `error` strings in `failed[]`
 *     are the only place the reason is ever stated, so a generic `HTTP nnn`
 *     message is explicitly NOT sufficient here; that is asserted, not implied.
 *  2. EMPTY — `copied.length === 0` with nothing named as failed, e.g. an
 *     all-env-wide source package under a session that resolves no active
 *     organization. Measured upstream as `{ success: false, copiedCount: 0,
 *     failedCount: 0 }`.
 *
 * The pattern being converged on is the sibling commit-revert helper in
 * `preview/commitHistory.ts` (`revertCommit`), which already unwraps `data`
 * before reading the flag. This is one consumer catching up to it, not a new
 * convention.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { duplicatePackage } from './packages-io';

/** The dispatcher's success envelope: the operation result under `data`. */
function envelope(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ success: true, data }) } as unknown as Response;
}

/** The dispatcher's error envelope — top-level, with no `data` to unwrap. */
function errorEnvelope(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ success: false, error: { message, code: 'PERMISSION_DENIED', status } }),
  } as unknown as Response;
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('duplicatePackage — the operation verdict lives under `data`', () => {
  it('rejects a PARTIAL duplicate and names the counts and every per-item error', async () => {
    stubFetch(
      envelope({
        success: false,
        copiedCount: 7,
        failedCount: 2,
        targetPackageId: 'com.example.leave-copy',
        copied: [],
        failed: [
          { type: 'object', name: 'leave_request', error: 'copy failed: duplicate key' },
          { type: 'view', name: 'leave_list', error: 'the source item does not convert' },
        ],
      }),
    );

    const err = await duplicatePackage('com.example.leave', 'com.example.leave-copy').then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err).toBeInstanceOf(Error);
    // The counts…
    expect(err?.message).toContain('7');
    expect(err?.message).toContain('2');
    // …and the per-item reasons, which exist nowhere else in the response.
    expect(err?.message).toContain('object/leave_request');
    expect(err?.message).toContain('copy failed: duplicate key');
    expect(err?.message).toContain('view/leave_list');
    expect(err?.message).toContain('the source item does not convert');
    // A generic transport message is NOT sufficient for this arm — it is the
    // half the fix exists to deliver.
    expect(err?.message).not.toMatch(/HTTP \d/);
  });

  it('summarizes the tail rather than pasting an unbounded failure list', async () => {
    stubFetch(
      envelope({
        success: false,
        copiedCount: 0,
        failedCount: 7,
        failed: Array.from({ length: 7 }, (_, i) => ({
          type: 'object',
          name: `obj_${i}`,
          error: `copy failed ${i}`,
        })),
      }),
    );

    const err = await duplicatePackage('a.b.c', 'a.b.d').catch((e: unknown) => e as Error);

    expect(err?.message).toContain('object/obj_0');
    expect(err?.message).toContain('object/obj_4');
    expect(err?.message).not.toContain('object/obj_5');
    expect(err?.message).toContain('+2 more');
  });

  it('rejects an EMPTY duplicate — 200, nothing copied, nothing named as failed', async () => {
    stubFetch(
      envelope({
        success: false,
        copiedCount: 0,
        failedCount: 0,
        targetPackageId: 'com.example.leave-copy',
        copied: [],
        failed: [],
      }),
    );

    const err = await duplicatePackage('com.example.leave', 'com.example.leave-copy').then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toMatch(/nothing was copied/i);
    // The empty arm has no `failed[]` to quote, so the message must still say
    // something the author can act on instead of falling through to a status.
    expect(err?.message).not.toMatch(/HTTP \d/);
  });

  it('does NOT let the envelope alone stand in for the operation verdict', async () => {
    // The exact shape the defect read as success: `success: true` at the top
    // level, `success: false` one level down.
    const fetchMock = stubFetch(
      envelope({ success: false, copiedCount: 0, failedCount: 1, failed: [{ type: 'object', name: 'x', error: 'nope' }] }),
    );

    await expect(duplicatePackage('a.b.c', 'a.b.d')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves when the operation itself succeeded', async () => {
    stubFetch(
      envelope({
        success: true,
        copiedCount: 9,
        failedCount: 0,
        targetPackageId: 'com.example.leave-copy',
        copied: [{ type: 'object', name: 'leave_request' }],
        failed: [],
      }),
    );

    await expect(duplicatePackage('com.example.leave', 'com.example.leave-copy')).resolves.toBeUndefined();
  });

  it('still surfaces the error envelope message on a non-2xx', async () => {
    stubFetch(errorEnvelope(403, 'Permission denied: manage_metadata is required'));

    await expect(duplicatePackage('a.b.c', 'a.b.d')).rejects.toThrow(
      'Permission denied: manage_metadata is required',
    );
  });

  it('falls back to the status when a non-2xx carries no readable body', async () => {
    stubFetch({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    } as unknown as Response);

    await expect(duplicatePackage('a.b.c', 'a.b.d')).rejects.toThrow('HTTP 502');
  });

  it('posts the target id and name to the duplicate route', async () => {
    const fetchMock = stubFetch(envelope({ success: true, copiedCount: 1, failedCount: 0, copied: [{}], failed: [] }));

    await duplicatePackage('com.example.leave', 'com.example.leave-copy', 'Leave (copy)');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/packages/com.example.leave/duplicate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ targetPackageId: 'com.example.leave-copy', targetName: 'Leave (copy)' }),
      }),
    );
  });
});
