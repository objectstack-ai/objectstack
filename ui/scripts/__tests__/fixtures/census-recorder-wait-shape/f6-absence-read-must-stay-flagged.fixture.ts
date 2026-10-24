/**
 * f6 — the shape objectui#8690 audited and PR #8702 repaired
 * (`MetadataObjectsPage.lookupKeying`): wait on the write log, then assert the
 * delete log is EMPTY. An absence dated to the first write cannot see a delete
 * issued after it.
 *
 * Pre-repair: flagged (it was one of the nine).
 * Repaired: STILL flagged.
 *
 * ⭐ This fixture is the anti-caricature control. A matcher that "fixes"
 * over-reporting by reporting nothing passes f4 and fails here.
 */
import { it, expect, waitFor } from './harness';

it('issues no delete for a rename', async () => {
  const puts: string[] = [];
  const deletes: string[] = [];
  const client = {
    put: (name: string) => {
      puts.push(name);
    },
    reset: (name: string) => {
      deletes.push(name);
    },
  };

  client.put('contact');
  await waitFor(() => expect(puts.length).toBe(1));
  expect(deletes).toEqual([]);
});
