/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * [objectui#6286] The cap this hook paginates under IS
 * `@objectstack/spec/security`'s `EXPLAIN_BATCH_MAX_RECORD_IDS` — not a local
 * number that happens to equal it.
 *
 * ## Why this file exists, and why asserting the VALUE would not do
 *
 * Until this card the hook declared `const EXPLAIN_BATCH_MAX_RECORD_IDS = 200`
 * locally, and the spec exports `200`. So every assertion on the value passes
 * in BOTH worlds — with the hand copy and with the import. That includes the
 * cap assertion in `../__tests__/rowRecordCrudVerdict.test.tsx`, which reads
 * like a cap test and cannot fail for a drifted cap. A ghost assertion.
 *
 * What the fix actually changes is REFERENCE IDENTITY: the client can no
 * longer drift from the server contract. The only honest way to pin that is to
 * MOVE the spec's export and watch the hook follow — so this file stands the
 * spec module in at a cap no hand copy could produce and asserts the request
 * chunking tracks it. Against the pre-fix hook the stand-in is inert by
 * construction (that module is not in its import graph at all) and every case
 * below fails: it would send one request of seven ids where three are due.
 *
 * The stand-in is a bare package specifier, which
 * `scripts/check-vi-mock-specifiers.mjs` does not judge (it resolves RELATIVE
 * specifiers only), so "the mock silently did not install" is guarded here
 * instead — see the control case at the bottom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { STUB_CAP, probe } = vi.hoisted(() => ({
  /**
   * Deliberately nothing like the real cap, and small enough that the fixture
   * stays readable. A hook reading its own copy of the contract cannot produce
   * this chunking under any value the spec has ever shipped.
   */
  STUB_CAP: 3,
  /**
   * What the stand-in observed on its way past: whether the factory ran at all
   * (i.e. something in the hook's graph really imports this module), and what
   * the REAL contract says (so the stub cannot be accidentally equal to it).
   */
  probe: { factoryRan: false, realCap: undefined as unknown },
}));

vi.mock('@objectstack/spec/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@objectstack/spec/security')>();
  probe.factoryRan = true;
  probe.realCap = actual.EXPLAIN_BATCH_MAX_RECORD_IDS;
  return { ...actual, EXPLAIN_BATCH_MAX_RECORD_IDS: STUB_CAP };
});

import { useRecordCrudVerdicts, __clearRecordCrudVerdictCache } from './useRecordCrudVerdicts';

const OBJECT = 'showcase_project';

interface ExplainCall {
  object?: string;
  operation?: string;
  recordIds?: string[];
}

let calls: ExplainCall[] = [];

/** Records every explain request and answers it `visible: true`. */
function stubExplain() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as ExplainCall;
      calls.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          allowed: true,
          object: body.object,
          operation: body.operation,
          records: (body.recordIds ?? []).map((recordId) => ({ recordId, visible: true })),
        }),
      };
    }),
  );
}

const idsFor = (n: number) => Array.from({ length: n }, (_, i) => `r_${i}`);

describe('[#6286] the batch cap is the spec\'s export, not a local copy', () => {
  beforeEach(() => {
    // Module-level memo — without this, ids answered by an earlier case are
    // "not missing" in the next one and the chunk arithmetic silently changes.
    __clearRecordCrudVerdictCache();
    calls = [];
    stubExplain();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('splits a page at the SPEC\'s cap — chunk sizes follow the export when it moves', async () => {
    const ids = idsFor(STUB_CAP * 2 + 1);
    renderHook(() => useRecordCrudVerdicts({ objectName: OBJECT, recordIds: ids, update: true }));

    await waitFor(() => expect(calls.length).toBe(3));
    // The pre-fix hook produces exactly one call of seven ids here.
    expect(calls.map((c) => c.recordIds?.length)).toEqual([STUB_CAP, STUB_CAP, 1]);
    // Splitting must not drop or reorder a row: every id asked exactly once.
    expect(calls.flatMap((c) => c.recordIds ?? [])).toEqual(ids);
    expect(calls.every((c) => c.object === OBJECT && c.operation === 'update')).toBe(true);
  });

  it('splits only ABOVE the cap — exactly cap ids is one request, cap + 1 is two', async () => {
    // BOTH sides are asserted deliberately. "Exactly cap ids is one request" is
    // true of the pre-fix hook too (3 ids fit under a cap of 200), so on its own
    // it is another ghost — it is the `cap + 1` half that can only pass when the
    // boundary being applied is the spec's. The ablation leg for this file found
    // that out: written with the first half alone, this case survived the revert.
    const atCap = idsFor(STUB_CAP);
    const { unmount } = renderHook(() =>
      useRecordCrudVerdicts({ objectName: OBJECT, recordIds: atCap, update: true }),
    );
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].recordIds).toEqual(atCap);

    unmount();
    __clearRecordCrudVerdictCache();
    calls = [];

    const overCap = idsFor(STUB_CAP + 1);
    renderHook(() => useRecordCrudVerdicts({ objectName: OBJECT, recordIds: overCap, update: true }));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls.map((c) => c.recordIds?.length)).toEqual([STUB_CAP, 1]);
  });

  it('splits per operation, so two verbs over cap+1 ids cost four requests', async () => {
    const ids = idsFor(STUB_CAP + 1);
    renderHook(() =>
      useRecordCrudVerdicts({ objectName: OBJECT, recordIds: ids, update: true, delete: true }),
    );

    await waitFor(() => expect(calls.length).toBe(4));
    for (const operation of ['update', 'delete'] as const) {
      const forOp = calls.filter((c) => c.operation === operation);
      expect(forOp.map((c) => c.recordIds?.length)).toEqual([STUB_CAP, 1]);
    }
  });

  it('control: the stand-in really installed, and it differs from the real contract', () => {
    // If this is false the three cases above proved nothing about provenance —
    // they would be measuring the real cap under a different name. It is true
    // only because the hook's own import graph pulled this module in.
    expect(probe.factoryRan).toBe(true);
    // A stub that happened to equal the shipped cap would make every assertion
    // above pass for the pre-fix hook too — the ghost this file exists to avoid.
    expect(typeof probe.realCap).toBe('number');
    expect(probe.realCap).not.toBe(STUB_CAP);
  });
});
