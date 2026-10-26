/**
 * f1 — pushed and read as the SAME member path.
 *
 * Pre-repair: flagged by `--recorder-match=path` only; invisible to `ident`,
 * whose name regex has a lookbehind that forbids a preceding `.`.
 * Repaired: flagged. It is a genuine cross-recorder read.
 */
import { it, expect, waitFor } from './harness';

it('merges the slice on save', async () => {
  const server = { saved: [] as string[], savedOpts: [] as Record<string, unknown>[] };
  const save = (name: string, opts: Record<string, unknown>) => {
    server.saved.push(name);
    server.savedOpts.push(opts);
  };

  save('app.a', { mode: 'draft' });
  await waitFor(() => expect(server.saved.length).toBe(1));
  expect(server.savedOpts[0]).toMatchObject({ mode: 'draft' });
});
