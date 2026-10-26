/**
 * f3 — pushed bare, waited and read through the host that holds the SAME array.
 *
 * Pre-repair: ZERO flags in BOTH modes — the shared blind spot objectui#8703
 * corrected the header about. The lookbehind blocks the dotted read whichever
 * way the push site was spelled.
 * Repaired: flagged. `host.inits` and `inits` resolve to one binding.
 */
import { it, expect, waitFor } from './harness';

it('records the init alongside the call', async () => {
  const calls: string[] = [];
  const inits: number[] = [];
  const host = { calls, inits };
  const record = (n: number) => {
    calls.push('c');
    inits.push(n);
  };

  record(1);
  await waitFor(() => expect(host.calls.length).toBe(1));
  expect(host.inits[0]).toBe(1);
});
