/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A stand-in for the record-level explain probe, for this package's suites
 * that render a real `ObjectGrid` (via `ObjectView`) without wiring a host
 * `apiFetch` themselves.
 *
 * [objectui#4688] `ObjectGrid` batches a record-grained write verdict for the
 * rows on screen (`POST /api/v1/security/explain` with `recordIds`), rooted
 * in [#4296]. With no host `apiFetch` in the tree the hook falls back to the
 * GLOBAL fetch — by design, for standalone embeds — which under happy-dom is
 * a REAL request to the default origin. The verdict fails open on a failed
 * request, so a suite that ignores it stays green while stderr fills with
 * `connect ECONNREFUSED 127.0.0.1:3000`: the same class of escape as
 * objectui#3339 (detail side, closed by PR #4105) and the shape that PR
 * settled — answer it from a double, never from the network, and never from
 * a global error sink.
 *
 * This is a per-package copy of `packages/plugin-grid/src/__tests__/
 * explainDouble.ts`, following the #4105 convention (no repo convention for
 * importing another package's test-only files across a workspace boundary).
 *
 * Deliberately NOT a swallow-everything stub: it RECORDS every URL it is
 * handed and answers only the explain endpoint, so an escape to some other
 * endpoint stays observable instead of vanishing into a rejection the hook
 * discards.
 *
 * The answer is `visible` for every id asked about, in BOTH shapes the explain
 * hooks read: `{ records: [{ recordId, visible }] }` for a batched
 * `recordIds`, and `{ record: { visible } }` for a single `recordId`
 * (objectui#9813). Spreading only the batched shape left the SINGULAR reader —
 * `useRecordEditable`, which reads `decision.record.visible` — with no verdict
 * at all, so it took its fail-open path: through this helper a standalone
 * probe was indistinguishable from the `ECONNREFUSED` this helper exists to
 * close, and the sentence above was false for an id asked about singly.
 *
 * `allowed` stays `true` whatever `visible` says. It is the OBJECT-level
 * verdict — the key the object-level reader (`AccessExplainPanel`) reads — and
 * an object-level permit beside a row-level deny is exactly the sharing-rule
 * case `useRecordEditable` was written for. The option moves the ROW verdict
 * only.
 *
 * The `true` default reproduces the pre-#4296 rendering exactly — a permitted
 * record narrows nothing, so no assertion in a consuming suite changes
 * meaning. A suite that wants a DENYING verdict says so explicitly with
 * `installExplainDouble({ visible: false })`.
 */
import { vi } from 'vitest';

export interface ExplainDoubleCall {
  url: string;
  body: Record<string, unknown> | undefined;
}

export interface ExplainDoubleOptions {
  /**
   * The ROW-level `visible` verdict to answer with, in whichever shape the
   * request asked for. Defaults to `true` — the permissive answer every
   * existing caller relies on, so omitting this changes nothing.
   *
   * A suite that needs a DENYING row verdict passes `false` rather than
   * hand-rolling a second double.
   */
  visible?: boolean;
}

/**
 * Install the double on the global `fetch`. Pair with `vi.unstubAllGlobals()`
 * in `afterEach`.
 *
 * @param options — `visible` picks the ROW verdict; omit it for the
 *   permissive default.
 * @returns the live call log, in request order.
 */
export function installExplainDouble(
  options: ExplainDoubleOptions = {},
): ExplainDoubleCall[] {
  const visible = options.visible ?? true;
  const calls: ExplainDoubleCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ url: String(url), body });
      const recordIds = Array.isArray(body?.recordIds) ? (body!.recordIds as string[]) : undefined;
      const recordId = typeof body?.recordId === 'string' ? (body.recordId as string) : undefined;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          allowed: true,
          object: body?.object,
          operation: body?.operation,
          principal: { userId: 'u_test' },
          layers: [],
          ...(recordIds ? { records: recordIds.map((id) => ({ recordId: id, visible })) } : {}),
          ...(recordId ? { record: { visible } } : {}),
        }),
      };
    }),
  );
  return calls;
}
