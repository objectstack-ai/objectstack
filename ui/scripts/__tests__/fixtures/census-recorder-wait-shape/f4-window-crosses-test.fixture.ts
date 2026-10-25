/**
 * f4 — the forward window is not scoped to the enclosing test (D1), and any
 * textual occurrence counts as a read (D2).
 *
 * Cases `a` / `b` are objectui#8704's own reproduction, verbatim: the wait is
 * the last `await` of test `a`, so its window runs on into test `b`, whose
 * opening line DECLARES a recorder. Both defects fire at once there.
 *
 * `c` and `d` / `e` were added here to separate them, because the fixed
 * versions mask each other on `a` / `b` alone:
 *   c      — D2 with the window rule already correct: a reset and a push, in
 *            the SAME test, after the wait. Nothing crosses a test boundary.
 *   d / e  — D1 with the occurrence rule already correct: the next test's
 *            recorder is DECLARED before both tests, so the first occurrence
 *            inside the runaway window is a genuine READ.
 *
 * Pre-repair: flagged in both modes.
 * Repaired: ZERO flags.
 */
import { describe, it, expect, waitFor } from './harness';

it('a — its wait is the last await of this test', async () => {
  const first: number[] = [];
  first.push(1);
  await waitFor(() => expect(first.length).toBe(1));
  expect(first[0]).toBe(1);
});

it('b — a different test, with its own recorder', async () => {
  const second: number[] = [];
  second.push(2);
  await waitFor(() => expect(second.length).toBe(1));
});

it('c — a reset and a push after the wait, inside the SAME test', async () => {
  const third: number[] = [];
  const scratch: number[] = [];
  third.push(3);
  await waitFor(() => expect(third.length).toBe(1));
  scratch.length = 0;
  scratch.push(4);
});

describe('d/e — the runaway window reaches a real read in the next test', () => {
  const shared: number[] = [];

  it('d — its wait is the last await of this test', async () => {
    const anchor: number[] = [];
    anchor.push(1);
    await waitFor(() => expect(anchor.length).toBe(1));
  });

  it('e — a different test reads the recorder declared above both', () => {
    shared.push(4);
    expect(shared[0]).toBe(4);
  });
});
