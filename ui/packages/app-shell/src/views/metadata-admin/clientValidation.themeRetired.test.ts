// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `theme` — the retired `clientValidation.ts` LOADERS entry, and the pin that
 * keeps it retired (objectui#5715).
 *
 * The entry read `ThemeSchema` off `@objectstack/spec/ui`. The spec retired
 * that whole module upstream (objectstack#10485 / PR objectstack#10695), and
 * `theme` was never a registered metadata type, so nothing ever asked for it.
 *
 * Why this needs a pin rather than just a comment: objectui's own
 * `@objectstack/spec` pin STILL publishes `ThemeSchema` as a working Zod
 * schema, so re-adding the entry would type-check, resolve, and go green —
 * exactly the "finish the job by wiring it back up" regression this file
 * exists to stop. It is also the wrong-schema class `clientValidation.ts` has
 * already paid for twice (`email_template`, then the objectui#3561 three).
 *
 * NOTE: this deliberately does NOT pin "the spec no longer exports
 * ThemeSchema" — that assertion would be red today and would flip for reasons
 * unrelated to this module. What is pinned is this module's own behaviour.
 */

import { describe, it, expect } from 'vitest';
import { validateMetadataDraft, hasClientValidator } from './clientValidation';

describe('`theme` is not a client-validated metadata type — objectui#5715', () => {
  it('reports NO client validator on either door', async () => {
    // CONTROL: a live table-mate on the same subpath must still gate, so a
    // `false` on `theme` is a measurement and not a broken import.
    expect(hasClientValidator('page', 'create')).toBe(true);
    expect(hasClientValidator('page', 'edit')).toBe(true);

    expect(hasClientValidator('theme', 'create')).toBe(false);
    expect(hasClientValidator('theme', 'edit')).toBe(false);
  });

  it('falls through to server-side validation instead of judging the draft', async () => {
    // Load-bearing, per the `hasClientValidator` docblock: a type that answers
    // `true` makes `ResourceEditPage` treat live client issues as the error
    // source and suppress the server's `_diagnostics`. While the entry existed,
    // `theme` answered `true` — so had it ever been reached, a stored item
    // would have rendered as clean with the server's errors suppressed.
    const res = await validateMetadataDraft('theme', { nonsense: true });
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);

    // CONTROL: the same shape IS judged for a wired type, proving the
    // pass-through above is `theme`-specific and not a dead test.
    const control = await validateMetadataDraft('page', { nonsense: true });
    expect(control.ok).toBe(false);
    expect(control.issues.length).toBeGreaterThan(0);
  });
});
