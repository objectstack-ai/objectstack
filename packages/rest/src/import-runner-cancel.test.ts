// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * runImport() cooperative cancellation (framework#2824).
 *
 * With a synchronous storage driver every `await` in the row loop resolves as
 * a microtask, so the loop used to monopolize the event loop for the whole
 * import — the HTTP cancel handler could never run, so the flag `shouldCancel`
 * polls was never set. The runner now yields one macrotask at every progress
 * boundary; these tests pin that behaviour by scheduling the cancel signal on
 * the macrotask queue (exactly where an HTTP handler lives) and asserting the
 * loop actually stops.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './export-format.js';

const metaMap = new Map<string, ExportFieldMeta>([
  ['name', { name: 'name', type: 'text' }],
]);

const baseOpts = {
  objectName: 'task',
  metaMap,
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: false,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

function rowsOf(n: number): Array<Record<string, any>> {
  return Array.from({ length: n }, (_, i) => ({ name: `r${i}` }));
}

/** Protocol whose writes resolve synchronously (microtask-only), like better-sqlite3. */
function syncProtocol(): ImportProtocolLike {
  return {
    findData: vi.fn(async () => []),
    createData: vi.fn(async (args: { data: { name: string } }) => ({ id: `id_${args.data.name}` })),
    updateData: vi.fn(async () => ({})),
    createManyData: vi.fn(async (args: { records: any[] }) => ({
      records: args.records.map((r) => ({ id: `id_${r.name}`, ...r })),
    })),
  };
}

describe('runImport — cooperative cancellation (framework#2824)', () => {
  it('yields the event loop at progress boundaries so a macrotask can set the cancel flag', async () => {
    let cancelRequested = false;
    // Simulates the cancel route: it can only run when the loop yields a
    // macrotask. Before the fix this callback fired after the import finished.
    setImmediate(() => { cancelRequested = true; });

    const summary = await runImport({
      ...baseOpts, p: syncProtocol(), rows: rowsOf(1000), progressEvery: 200,
      shouldCancel: () => cancelRequested,
    });

    expect(summary.cancelled).toBe(true);
    expect(summary.processed).toBe(200); // stopped at the first checkpoint
    expect(summary.created).toBe(200);   // rows written so far are reported truthfully
  });

  it('runs to completion when nobody cancels', async () => {
    const summary = await runImport({
      ...baseOpts, p: syncProtocol(), rows: rowsOf(450), progressEvery: 200,
      shouldCancel: () => false,
    });
    expect(summary.cancelled).toBe(false);
    expect(summary.processed).toBe(450);
    expect(summary.created).toBe(450);
  });

  it('yields at progress boundaries even without a shouldCancel callback', async () => {
    // The synchronous import route passes no shouldCancel; the yield must still
    // happen so concurrent HTTP requests are serviced during a large import.
    let macrotaskRan = false;
    setImmediate(() => { macrotaskRan = true; });
    let observedMidLoop = false;

    await runImport({
      ...baseOpts, p: syncProtocol(), rows: rowsOf(400), progressEvery: 200,
      onProgress: (pr) => { if (pr.processed === 400) observedMidLoop = macrotaskRan; },
    });

    // By the final progress report the pre-scheduled macrotask has run,
    // proving the loop reached the event loop's timer/check phases mid-import.
    expect(observedMidLoop).toBe(true);
  });
});
