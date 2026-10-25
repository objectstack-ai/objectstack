/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9151 — "a failed script action renders no toast", characterized
 * END TO END through the console's real failure chain.
 *
 * ## Why this file exists
 *
 * The question "does a server refusal on `POST /api/v1/actions/...` reach the
 * user?" was re-derived from scratch by three separate readers, each by
 * reading code rather than running it, and each answer was a theory. It is a
 * measurable question, so it is measured here once and kept measured.
 *
 * The chain under test is the real one, with nothing stubbed between its ends:
 *
 *   ActionRunner.execute
 *     -> the registered `script` handler
 *        = createConsoleServerActionHandler   (this package)
 *        -> createServerActionHandler         (@object-ui/core)
 *           -> interpretActionResponse        (the /actions envelope rule)
 *     -> ActionRunner.handlePostExecution     (the toast sink)
 *
 * Only the transport (`fetch`) and the toast SINK are test doubles. The sink
 * double stands in for the console's `toastHandler`, which is one `switch` on
 * `options.type` in `useConsoleActionRuntime` and a byte-identical copy in
 * `RecordDetailView`; asserting on the payload handed to the sink pins the
 * contract without copying that mapping into a third place.
 *
 * ## What the readings establish
 *
 * 1. A 500 carrying a business sentence produces exactly ONE toast, typed
 *    `error`, carrying that sentence VERBATIM.
 * 2. The identical body under 400 produces the identical toast. The path is
 *    status-blind by construction (`!res.ok`), which is why moving a refusal
 *    from 500 to 4xx — objectstack#17265 / PR objectstack#17679 — changes
 *    nothing on this path, and why it must not be "fixed" by teaching the
 *    console to branch on status.
 * 3. An unreadable body still produces exactly one error toast, on the
 *    `(HTTP nnn)` fallback. So `result.error` is never empty after a non-ok
 *    response, and the zero-toast symptom cannot originate in this chain.
 *
 * ⇒ The preimage of "zero toast elements" is therefore CLOSED, and the last
 * two cases below are the whole of it:
 *
 *   A. the action declares `toast: { showOnError: false }` — an authorable
 *      per-action opt-out that the runner honours; or
 *   B. a handler returns `{ success: false }` with NO `error` — the deliberate
 *      "I already messaged the user" convention (`useObjectActions`'s bulk
 *      delete, `useConsoleActionRuntime`'s entitlement dialog).
 *
 * Anything else that renders no toast is dispatching outside this chain.
 */

import { describe, it, expect, vi } from 'vitest';

// `consoleServerAction` imports sonner at module load for its popup-blocked
// fallback. Nothing here asserts on it; the mock only keeps the import inert.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

import { ActionRunner, type ActionDef, type ActionResult } from '@object-ui/core';
import { createConsoleServerActionHandler } from '../consoleServerAction';

/** The hook's written, user-facing refusal — the sentence that must survive. */
const REFUSAL = 'Contract cannot be submitted without a version file.';

/** A `Response`-shaped double: only `ok` / `status` / `json()` are read. */
function respond(status: number, body: unknown | (() => never)) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'function' ? (body as () => never)() : body),
  };
}

/**
 * Mount the real chain. `script` is registered exactly as the console
 * registers it (`handlers={{ script: … }}` on `<ActionProvider>`).
 */
function mountConsoleChain(response: ReturnType<typeof respond>) {
  const toasts: Array<{ message: unknown; options?: { type?: string } }> = [];
  const fetchDouble = vi.fn(async () => response as never);
  const runner = new ActionRunner({});
  runner.setToastHandler(((message: unknown, options?: { type?: string }) => {
    toasts.push({ message, options });
  }) as never);
  runner.registerHandler('script', createConsoleServerActionHandler({
    fetch: fetchDouble as never,
    baseUrl: () => '',
    resolveObject: () => 'clm_contract',
    onRefresh: vi.fn(),
  }) as never);
  return { runner, toasts, fetchDouble };
}

/** The dispatch shape `DeclaredActionsBar` builds for a record-page action. */
function submitContract(extra?: Record<string, unknown>): ActionDef {
  return {
    name: 'submit_contract',
    type: 'script',
    objectName: 'clm_contract',
    params: { _rowRecord: { id: 'ctr_1' } },
    ...(extra ?? {}),
  } as ActionDef;
}

describe('objectui#9151 — a refused script action reaches the toast sink', () => {
  it('500 carrying the business sentence: exactly one error toast, sentence verbatim', async () => {
    const { runner, toasts, fetchDouble } = mountConsoleChain(
      respond(500, { success: false, error: { code: 'INTERNAL_ERROR', message: REFUSAL } }),
    );

    const result = await runner.execute(submitContract());

    // The POST really happened — this is the chain, not a short circuit.
    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: false, error: REFUSAL });
    expect(toasts).toEqual([{ message: REFUSAL, options: { type: 'error', duration: undefined } }]);
  });

  it('LIT CONTROL — 400 with the same body produces the same toast (the path never reads status)', async () => {
    const { runner, toasts } = mountConsoleChain(
      respond(400, { success: false, error: { code: 'VALIDATION_ERROR', message: REFUSAL } }),
    );

    await runner.execute(submitContract());

    expect(toasts).toEqual([{ message: REFUSAL, options: { type: 'error', duration: undefined } }]);
  });

  it('LIT CONTROL — a 200 success toasts green, so an empty error list is never the sink being dead', async () => {
    const { runner, toasts } = mountConsoleChain(respond(200, { success: true, data: { ok: 1 } }));

    await runner.execute(submitContract({ successMessage: 'Submitted.' }));

    expect(toasts).toEqual([
      { message: 'Submitted.', options: { type: 'success', duration: undefined, undo: undefined } },
    ]);
  });

  it('an unreadable 500 body still toasts — on the (HTTP nnn) fallback, never nothing', async () => {
    const { runner, toasts } = mountConsoleChain(respond(500, () => { throw new SyntaxError('not JSON'); }));

    const result = await runner.execute(submitContract());

    expect(result.success).toBe(false);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].options).toEqual({ type: 'error', duration: undefined });
    expect(String(toasts[0].message)).toBe('Action "submit_contract" failed (HTTP 500)');
  });
});

describe('objectui#9151 — the two shapes that legitimately render NO toast', () => {
  it('A: the action declares toast.showOnError false — the refusal is swallowed BY THE AUTHOR', async () => {
    const { runner, toasts } = mountConsoleChain(
      respond(500, { success: false, error: { code: 'INTERNAL_ERROR', message: REFUSAL } }),
    );

    const result = await runner.execute(submitContract({ toast: { showOnError: false } }));

    // The refusal reached the runner intact; only the SINK was opted out of.
    expect(result).toEqual({ success: false, error: REFUSAL });
    expect(toasts).toEqual([]);
  });

  it('B: a handler returning `{ success: false }` with no `error` is silent by convention', async () => {
    const toasts: Array<unknown> = [];
    const runner = new ActionRunner({});
    runner.setToastHandler(((message: unknown) => { toasts.push(message); }) as never);
    // The shape `useObjectActions`'s bulk delete and `useConsoleActionRuntime`'s
    // entitlement dialog return on purpose: they already told the user.
    runner.registerHandler('script', (async (): Promise<ActionResult> => ({ success: false })) as never);

    const result = await runner.execute(submitContract());

    expect(result).toEqual({ success: false });
    expect(toasts).toEqual([]);
  });
});
