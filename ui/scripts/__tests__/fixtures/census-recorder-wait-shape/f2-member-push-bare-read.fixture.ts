/**
 * f2 — pushed as a member, waited and read under bare aliases.
 *
 * Pre-repair: flagged by `--recorder-match=ident` only; invisible to `path`,
 * which knows the recorders as `host.calls` / `host.inits` and never matches
 * the bare spellings.
 * Repaired: flagged. The alias and the member path are the same array.
 */
import { it, expect, waitFor } from './harness';

it('records the init alongside the call', async () => {
  const host = { calls: [] as string[], inits: [] as number[] };
  const record = (n: number) => {
    host.calls.push('c');
    host.inits.push(n);
  };

  record(1);
  const { calls, inits } = host;
  await waitFor(() => expect(calls.length).toBe(1));
  expect(inits[0]).toBe(1);
});
