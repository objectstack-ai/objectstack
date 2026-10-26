/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { ExpressionEvaluator } from '@object-ui/core';
import { buildExpressionScope, evaluateVisibility } from './ExpressionProvider';

/**
 * Regression: nav/area `visible` predicates arrive from the server as
 * `{ dialect: 'cel', source }` envelopes (the spec's ExpressionInputSchema
 * normalizes every authored string into that shape). evaluateVisibility used
 * to fall through to a blanket `return true` for anything that wasn't a
 * `${…}` template string — so a constant-false CEL predicate still rendered
 * the menu item for everyone, and "hide this nav item by role" was
 * unimplementable from app metadata.
 */

/**
 * The provider's own bag, from the provider's own builder. It used to be a
 * hand-written transcription carrying an `app` key; `buildExpressionScope` has
 * not bound one since objectui#8155 (ruled 2026-09-07), and a copy is how a
 * fixture keeps asserting a root the shipped builder no longer has.
 */
function makeEvaluator(user: Record<string, unknown>) {
  return new ExpressionEvaluator(buildExpressionScope({ user }) as any);
}

describe('evaluateVisibility', () => {
  const worker = makeEvaluator({ id: 'u1', positions: ['worker'] });
  const orgAdmin = makeEvaluator({ id: 'u2', positions: ['org_admin'] });

  it('keeps literal handling: booleans and "true"/"false" strings', () => {
    expect(evaluateVisibility(undefined, worker)).toBe(true);
    expect(evaluateVisibility(true, worker)).toBe(true);
    expect(evaluateVisibility('true', worker)).toBe(true);
    expect(evaluateVisibility(false, worker)).toBe(false);
    expect(evaluateVisibility('false', worker)).toBe(false);
  });

  it('evaluates a CEL envelope against current_user (spec P`…` form)', () => {
    const visible = { dialect: 'cel', source: "'org_admin' in current_user.positions" };
    expect(evaluateVisibility(visible, orgAdmin)).toBe(true);
    expect(evaluateVisibility(visible, worker)).toBe(false);
  });

  it('still evaluates ${…} template expressions', () => {
    const evaluator = makeEvaluator({ role: 'admin' });
    expect(evaluateVisibility("${user.role === 'admin'}", evaluator)).toBe(true);
    expect(evaluateVisibility("${user.role === 'guest'}", evaluator)).toBe(false);
  });

  it('fails open (visible) on an unevaluable predicate', () => {
    expect(evaluateVisibility({ dialect: 'cel', source: 'not ] valid (' }, worker)).toBe(true);
  });
});
