/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9813 — this package's `explainDouble` must answer a SINGLE
 * `recordId` request, and the row verdict it answers with has to reach the
 * consumer that reads it.
 *
 * ## Why a double needs its own pin
 *
 * Before this card the helper spread `records` only when the request carried
 * `recordIds`. A single-`recordId` request — the shape `useRecordEditable`
 * sends — came back with `allowed`, `object`, `operation`, `principal` and
 * `layers`, and no `record` member at all. That hook reads
 * `decision.record.visible` and returns early when it is not a boolean, so
 * through this helper it took the same path it takes on `ECONNREFUSED`: the
 * escape the helper was written to close, reproduced inside the helper.
 *
 * A double that is wrong is the sharp kind of wrong: it makes a suite green
 * about a permission decision that would not hold in production, and the green
 * says nothing about which. So the assertion below is not about the helper's
 * SHAPE — it drives the real consumer, unmocked, and asserts the decision it
 * reaches.
 *
 * ## Which leg is the pin, and which is only a control
 *
 * ⭐ The DENY leg is the pin, and it is red without the repair: with no
 * `record` member the hook fails open to `true`.
 *
 * ⚠️ The PERMIT leg is a direction CONTROL, not a pin — it was green before
 * the repair too, because `useRecordEditable` initialises its verdict to
 * `true` and its fail-open path leaves it there, so a permitted answer and an
 * absent one are the same value at the read site. It stays because it fails
 * the other way: a future edit that made this helper answer a DENY by default
 * would silently narrow every consuming suite, and that lands here.
 *
 * ## Measured when this landed, and stated rather than assumed
 *
 * No consuming suite of either copy issues a single-`recordId` request today:
 * instrumenting both helpers across every file that imports them recorded 75
 * explain calls, all batched. ⇒ the defect was LATENT, a trap for the next
 * reader of the two files most likely to be copied, rather than a currently
 * false green. This file is the first caller to take the singular path
 * through this helper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installExplainDouble } from './explainDouble';
// READ-ONLY reference to the real reader of the single-record verdict, by the
// same route `rowRecordCrudVerdict.test.tsx` already takes: the pin is worth
// nothing against a local re-statement of the hook's logic, and this package
// declares no dependency on `@object-ui/plugin-detail` — its test tsconfig
// drops the source-tree `paths`, so a bare specifier would resolve through a
// `node_modules` entry that does not exist here. The relative source path is
// the route that already works across this boundary in `plugin-grid`.
import {
  useRecordEditable,
  __clearRecordEditableCache,
} from '../../../plugin-detail/src/useRecordEditable';

const OBJECT = 'contacts';
const RECORD = 'r_single';

describe('explainDouble answers a single-`recordId` request (objectui#9813)', () => {
  beforeEach(() => {
    __clearRecordEditableCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('carries a DENYING row verdict through to `useRecordEditable`', async () => {
    const calls = installExplainDouble({ visible: false });

    const { result } = renderHook(() => useRecordEditable(OBJECT, RECORD, 'update'));

    await waitFor(() => expect(result.current).toBe(false));
    // The request really was the singular shape, not a batch of one: a helper
    // that answered only `records` would satisfy the verdict above by accident
    // if the hook had switched to the batched key.
    expect(calls.map((call) => call.body)).toEqual([
      { object: OBJECT, operation: 'update', recordId: RECORD },
    ]);
  });

  it('carries a PERMITTING row verdict through by default', async () => {
    installExplainDouble();

    const { result } = renderHook(() => useRecordEditable(OBJECT, RECORD, 'update'));

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('still answers the BATCHED shape, and moves that verdict too', async () => {
    installExplainDouble({ visible: false });

    const res = await (globalThis.fetch as unknown as typeof fetch)(
      '/api/v1/security/explain',
      {
        method: 'POST',
        body: JSON.stringify({ object: OBJECT, operation: 'update', recordIds: [RECORD] }),
      },
    );
    const decision = (await res.json()) as {
      records?: { recordId: string; visible: boolean }[];
      record?: unknown;
      allowed?: boolean;
    };

    expect(decision.records).toEqual([{ recordId: RECORD, visible: false }]);
    // A batched request asks about no single record, so the singular member
    // stays absent — the helper answers what it was asked, nothing more.
    expect(decision.record).toBeUndefined();
    // `allowed` is the OBJECT-level verdict and does not move with the row one.
    expect(decision.allowed).toBe(true);
  });
});
