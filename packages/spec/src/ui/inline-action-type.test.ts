// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19920] The published type `InlineAction` names an inline action body; it is not `unknown`.
 *
 * `InlineActionSchema` is a `z.preprocess`, whose input type is the preprocess function's
 * parameter (`unknown`), so the type declared as `z.input<typeof InlineActionSchema>` WAS
 * `unknown`: any value type-checked against a name that promises an inline action. It is now the
 * input type of the pipe's `out` member, the `.pick()`ed action object.
 *
 * Two halves, judged by two programs (the `view-metadata-type.test.ts` shape):
 *
 * - The TYPE half is judged by `tsc -p tsconfig.test.json` (the package's `typecheck` script, via
 *   `check:test-typecheck`), not by vitest. Each `@ts-expect-error` below asserts that its line
 *   does NOT compile. While `InlineAction` was `unknown` every one of them compiled, so each
 *   directive was unused: TS2578 in a file with no `test-typecheck-debt.json` entry, which reds the
 *   gate. Every key of the input shape is optional (`type` has a default, `name` and `label` are
 *   `.partial()`), so there is no missing-required-key case to pin here.
 * - The RUNTIME half ties the typed bodies to the door: each one parses. It also pins the one
 *   direction the TSDoc states in words — the door still ACCEPTS the legacy `navigation` / `to`
 *   spellings this type refuses, folding them onto `url` / `target`.
 */

import { describe, it, expect } from 'vitest';
import { InlineActionSchema, type InlineAction } from './action.zod';

// ── Real bodies, each typed through the published name ───────────────────────────────────────

const urlAction: InlineAction = { type: 'url', target: '/pricing', openIn: 'new-tab' };
const apiAction: InlineAction = {
  type: 'api',
  target: '/api/v1/billing/refresh',
  method: 'POST',
  bodyExtra: { plan: 'pro' },
  confirmText: 'Refresh billing?',
  successMessage: 'Refreshed',
  refreshAfter: true,
};
const namedModal: InlineAction = { name: 'open_upgrade', label: 'Upgrade', type: 'modal', target: 'upgrade_dialog' };

// ── What `InlineAction` refuses at compile time ──────────────────────────────────────────────

const someValue: unknown = JSON.parse('{"nope":1}');
// @ts-expect-error -- `unknown` is not an inline action; it was assignable while InlineAction was `unknown`.
const fromUnknown: InlineAction = someValue;
// @ts-expect-error -- `navigation` is a legacy spelling the preprocess folds; the type names canonical `type` values only.
const legacyType: InlineAction = { type: 'navigation', target: '/pricing' };
// @ts-expect-error -- `to` is a legacy spelling of `target`, declared by no field (TS2353).
const legacyTo: InlineAction = { type: 'url', to: '/pricing' };
// @ts-expect-error -- an inline action is an object.
const scalar: InlineAction = 42;
void [fromUnknown, scalar];

describe('InlineAction is an inline action body, not unknown', () => {
  it.each([
    ['a url action', urlAction],
    ['an api action with a static payload', apiAction],
    ['a named modal action', namedModal],
  ])('%s typed as InlineAction parses', (_label, body) => {
    expect(InlineActionSchema.safeParse(body).success).toBe(true);
  });

  it('the door still accepts the legacy spellings the type refuses, folding them onto url / target', () => {
    const typeFold = InlineActionSchema.safeParse(legacyType);
    expect(typeFold.success).toBe(true);
    expect(typeFold.data).toMatchObject({ type: 'url', target: '/pricing' });

    const targetFold = InlineActionSchema.safeParse(legacyTo);
    expect(targetFold.success).toBe(true);
    expect(targetFold.data).toMatchObject({ type: 'url', target: '/pricing' });
    expect(targetFold.data).not.toHaveProperty('to');
  });
});
