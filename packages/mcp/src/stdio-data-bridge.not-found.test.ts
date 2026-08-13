// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8422 — the stdio bridge's by-id write seams must throw the repo's ONE
 * not-found envelope (`recordNotFoundError`, `@objectstack/core`), not a
 * locally minted `Error`.
 *
 * The HTTP bridge routes its data verbs through `callData`, which throws
 * `recordNotFoundError` — `code: 'RECORD_NOT_FOUND'`, `status: 404`
 * (`packages/core/src/utils/record-not-found.ts`, #4435/#5138/#7867). The
 * stdio bridge minted its own bare `Error` for the identical miss, so a
 * stdio caller got a message with no machine-readable code and nothing that
 * maps to 404 — the same operation, two different envelopes depending on
 * which transport served it.
 *
 * Both by-id write seams are covered — `update()` and `remove()` — asserting
 * on `code` AND `status`, not merely that something threw: an assertion that
 * only checks for a thrown error would have passed against the bare `Error`
 * this card exists to remove.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createStdioDataBridge } from './stdio-data-bridge.js';

/** An engine that resolves NO row for any id — every by-id write is a miss. */
function makeEmptyEngine() {
  return {
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => [{ n: 0 }]),
  };
}

/** An object definition with no exposure restriction, so the miss is what refuses. */
function makeMetadata() {
  return {
    listObjects: vi.fn(async () => [{ name: 'task', label: 'Task', fields: {} }]),
    getObject: vi.fn(async () => ({ name: 'task', label: 'Task', enable: { apiEnabled: true } })),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => true),
    getRegisteredTypes: vi.fn(async () => ['object']),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;

function makeBridge() {
  const engine = makeEmptyEngine();
  const metadataService = makeMetadata();
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    resolvePrincipal: async () => PRINCIPAL,
  });
  return { bridge, engine, metadataService };
}

/**
 * Assert a not-found refusal by its ENVELOPE, not by the fact that something
 * threw — a bare `Error` also satisfies `.toThrow()`, which is exactly the
 * defect this card removes.
 */
async function expectRecordNotFound(run: () => Promise<unknown>): Promise<void> {
  const err = (await run().then(
    () => null,
    (e: unknown) => e,
  )) as (Error & { code?: string; status?: number }) | null;
  expect(err, 'the call resolved — no not-found refusal was raised').toBeTruthy();
  expect(err!.code).toBe('RECORD_NOT_FOUND');
  expect(err!.status).toBe(404);
}

describe('#8422 stdio bridge by-id writes throw the shared not-found envelope', () => {
  it('update() on a missing id throws RECORD_NOT_FOUND / 404', async () => {
    const { bridge, engine } = makeBridge();

    await expectRecordNotFound(() => bridge.update('task', 'ghost', { title: 'x' }));
    // Refused before the write dispatched — the same existence-before-mutation
    // property the HTTP path (`callData`) holds.
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('remove() on a missing id throws RECORD_NOT_FOUND / 404', async () => {
    const { bridge, engine } = makeBridge();

    await expectRecordNotFound(() => bridge.remove('task', 'ghost'));
    expect(engine.delete).not.toHaveBeenCalled();
  });

  it('both seams throw the SAME envelope shape — one declaration, not two', async () => {
    const { bridge } = makeBridge();

    const updateErr = await bridge.update('task', 'ghost', { title: 'x' }).catch((e) => e);
    const removeErr = await bridge.remove('task', 'ghost').catch((e) => e);

    expect(updateErr.code).toBe(removeErr.code);
    expect(updateErr.status).toBe(removeErr.status);
    expect(updateErr.code).toBe('RECORD_NOT_FOUND');
  });
});
