// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SeedSettlementSnapshot } from '@objectstack/spec/contracts';
import type { SeedSourceSummary } from './format.js';
import type { SeedSettledMessage } from '../commands/serve.js';

/**
 * Build the `objectstack:seed-settled` message ({@link SeedSettledMessage})
 * from the two things the kernel already knows: the settlement tally and the
 * per-source seed summary the banner's `Seeds:` row renders.
 *
 * Kept apart from `serve.ts`, which re-exports it, so a test of the verdict
 * does not load the whole boot composition `serve.ts` imports.
 */
export function composeSeedSettledMessage(
  snapshot: SeedSettlementSnapshot | undefined,
  sources: SeedSourceSummary[] | undefined,
): SeedSettledMessage {
  const list = sources ?? [];
  return {
    type: 'objectstack:seed-settled',
    ok: list.every((s) => s.rejected === 0 && (s.droppedRefs ?? 0) === 0 && !s.emptyInstall),
    suppressed: snapshot ? [...snapshot.suppressed] : [],
    sources: list,
  };
}
