// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — `os test`'s closing tally once SKIPPED exists (the `qa-runner`
 * family's `requires` key, ruled B). A skipped scenario never ran, so it is
 * its own count: never passed, never failed. The wiring — the line reaching
 * stdout and the exit status beside it — is pinned end to end in
 * `qa-requires-skip-run.test.ts`; this holds the three shapes of the line,
 * including the one CI transcripts already match on, unchanged when nothing
 * was skipped.
 */

import { describe, it, expect } from 'vitest';
import { summaryLine } from '../src/commands/test';

describe('os test — summaryLine counts skipped scenarios apart', () => {
  it('reads exactly as before when nothing was skipped — CONTROL', () => {
    expect(summaryLine(3, 0, 0)).toBe('SUCCESS: All 3 scenarios passed.');
    expect(summaryLine(3, 1, 0)).toBe('FAILED: 1 scenarios failed. 3 passed.');
  });

  it('never folds a skip into "All passed"', () => {
    const line = summaryLine(3, 0, 2);
    expect(line).toBe('SUCCESS: 3 scenarios passed. 2 skipped (not run, not counted as passed).');
    expect(line).not.toContain('All');
  });

  it('carries the skip count on a failed run too', () => {
    expect(summaryLine(1, 2, 3)).toBe('FAILED: 2 scenarios failed. 1 passed. 3 skipped (not run, not counted as passed).');
  });
});
