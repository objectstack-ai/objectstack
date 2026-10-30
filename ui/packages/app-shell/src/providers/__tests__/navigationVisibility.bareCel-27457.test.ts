/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27457 — a navigation entry's `visible` written as a BARE string
 * is CEL, read on the same engine as its `{ dialect: 'cel', source }` envelope.
 *
 * `@objectstack/spec` declares the nav `visible` slot as
 * `EvaluatedExpressionInputSchema`, whose string arm is shorthand for the CEL
 * envelope, and its own example is ``'org_admin' in current_user.positions``.
 * The app metadata door serves the stored bare string as authored, and the
 * console used to read it on the legacy JS grammar, where `in` is not an
 * operator: the predicate faulted, and the navigation gate withholds on a fault
 * (objectui#12700), so the entry was hidden from everyone, its holder included.
 *
 * The evaluators are built through the shell's own builder, so the bag is the
 * one `ExpressionProvider` publishes.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { __resetVisibilityPredicateWarnings } from '@object-ui/react';
import {
  createExpressionEvaluator,
  evaluateNavigationVisibility,
  evaluateVisibility,
} from '../ExpressionProvider';

const OWNER = createExpressionEvaluator({ user: { id: 'u1', positions: ['org_owner'] } });
const MEMBER = createExpressionEvaluator({ user: { id: 'u2', positions: ['member'] } });

const SPEC_SHAPE = "'org_owner' in current_user.positions";

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  __resetVisibilityPredicateWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const appShellLines = () =>
  warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('app-shell:visible'));

describe('objectstack#27457 — a bare nav `visible` string is CEL', () => {
  it('shows the entry to the position holder and withholds it from the member, with no fault', () => {
    // The card's reproduction A. Before the fix BOTH answers were `false`:
    // `Unexpected token "i"` on the legacy grammar, withheld, and reported.
    expect(evaluateNavigationVisibility(SPEC_SHAPE, OWNER)).toBe(true);
    expect(evaluateNavigationVisibility(SPEC_SHAPE, MEMBER)).toBe(false);
    expect(appShellLines()).toHaveLength(0);
  });

  it('CONTROL: the envelope spelling reaches the same two verdicts', () => {
    const env = { dialect: 'cel', source: SPEC_SHAPE };
    expect(evaluateNavigationVisibility(env, OWNER)).toBe(true);
    expect(evaluateNavigationVisibility(env, MEMBER)).toBe(false);
  });

  it('the fail-open gate (`evaluateVisibility`) reads the bare string on CEL too', () => {
    // Fail-open answers `true` on a fault, so the MEMBER's `false` is the proof
    // that the predicate evaluated rather than faulted.
    expect(evaluateVisibility(SPEC_SHAPE, OWNER)).toBe(true);
    expect(evaluateVisibility(SPEC_SHAPE, MEMBER)).toBe(false);
    expect(appShellLines()).toHaveLength(0);
  });

  it('a legacy-only bare spelling has no JS reading any more: it faults and is withheld, loudly', () => {
    // `===` is not CEL, so the holder no longer sees an entry spelled that way;
    // the report names the predicate. Its CEL spelling is the paired control.
    expect(evaluateNavigationVisibility("current_user.id === 'u1'", OWNER)).toBe(false);
    const lines = appShellLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("current_user.id === 'u1'");
    expect(lines[0]).toMatch(/WITHHELD/);
    expect(evaluateNavigationVisibility("current_user.id == 'u1'", OWNER)).toBe(true);
  });
});
