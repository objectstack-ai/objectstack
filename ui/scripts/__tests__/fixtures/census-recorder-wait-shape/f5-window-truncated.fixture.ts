/**
 * f5 — a genuine cross-recorder hazard sitting one `await` further on.
 *
 * Pre-repair: ZERO flags in BOTH modes. The forward window ends at the next
 * textual `await`, so `await Promise.resolve()` truncates it before the read.
 * That is the MIRROR of f4: the same rule that over-reports also goes blind.
 * Repaired: flagged. A bare `await` settles nothing, so it does not close the
 * window; only another awaited settling anchor does.
 */
import { it, expect, waitFor } from './harness';

it('reads the payload the wait never mentioned', async () => {
  const arrivals: string[] = [];
  const payloads: number[] = [];
  const receive = (tag: string, n: number) => {
    arrivals.push(tag);
    setTimeout(() => payloads.push(n), 0);
  };

  receive('a', 2);
  await waitFor(() => expect(arrivals.length).toBe(1));
  await Promise.resolve();
  expect(payloads[0]).toBe(2);
});
