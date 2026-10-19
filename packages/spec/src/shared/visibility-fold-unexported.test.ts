// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/spec/shared` no longer exports the ADR-0089 alias fold.
 *
 * `normalizeVisibleWhen` folded the retired `visibleOn` / `visibility` keys onto
 * the canonical `visibleWhen`, and `VISIBILITY_ALIAS_KEYS` listed those two keys.
 * Once both keys became `retiredKey()` tombstones at 18, no schema called the
 * fold and no consumer in either repository did. A published helper that
 * re-accepts what every parsing door refuses is an invitation to consumer-side
 * tolerance, so both left the surface (ADR-0087 D3 entry
 * `visibility-alias-fold-unexported`). The replacement is to read `visibleWhen`
 * directly.
 *
 * Read from the barrel the `./shared` subpath export compiles, through the
 * runtime namespace, with a surviving export as the lit control that the
 * namespace is really populated.
 */

import { describe, it, expect } from 'vitest';
import * as shared from './index';

describe('`./index` (the `@objectstack/spec/shared` surface)', () => {
  it('still exports its surviving members (the control)', () => {
    expect(typeof shared.lazySchema).toBe('function');
    expect('lazySchema' in (shared as Record<string, unknown>)).toBe(true);
  });

  it.each(['normalizeVisibleWhen', 'VISIBILITY_ALIAS_KEYS'])(
    'no longer exports `%s`',
    (name) => {
      expect(name in (shared as Record<string, unknown>)).toBe(false);
    },
  );
});
