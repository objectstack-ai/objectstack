/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6493 — the app-shell predicate scope is built ONCE, and the two
 * imperative evaluators bind it too.
 *
 * `evaluateVisibility` was reached with three different evaluators. Only
 * `ExpressionProvider`'s carried the full bag; `RecordFormPage` and
 * `AppContent` each built a private `new ExpressionEvaluator({ user, app,
 * data })` for the SAME kind of gate — an object field's `visible` — and those
 * bags named neither `current_user` (nor its `ctx.user` / `os.user` spellings)
 * nor `features`.
 *
 * ## Why the old shape could not be caught by rendering alone
 *
 * A CEL predicate over an unbound root does not throw here: `evaluateCelCondition`
 * fails SOFT to `true` when the caller has not asked for `throwOnError`, and
 * `evaluateVisibility` is such a caller. So the field rendered — exactly as it
 * would for a predicate that legitimately said yes, and exactly as it would for
 * a predicate with a typo. The three worlds are indistinguishable on screen,
 * which is why the fail-open direction is asserted below as its own case rather
 * than assumed: `OLD_BAG` reproduces the pre-fix bag literally, and every
 * assertion against it is the RED this change turns green.
 *
 * ADR-0068 D1 is the rule being conformed to — one user object under four
 * spellings, so "a predicate `'org_admin' in current_user.roles` evaluates
 * identically in a formula, an RLS policy, and a client `visible` gate".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ExpressionEvaluator } from '@object-ui/core';
import {
  buildExpressionScope,
  createExpressionEvaluator,
  evaluateVisibility,
} from './ExpressionProvider';

/**
 * The served shape. `ExpressionInputSchema` normalises every authored `visible`
 * string into a `{ dialect, source }` envelope, so this — not a bare string —
 * is what actually reaches the evaluator once the server has served the schema.
 */
const POSITION_GATE = { dialect: 'cel', source: "'sales_manager' in current_user.positions" };
const CTX_ALIAS_GATE = { dialect: 'cel', source: "'sales_manager' in ctx.user.positions" };
const OS_ALIAS_GATE = { dialect: 'cel', source: "'sales_manager' in os.user.positions" };
const FEATURE_GATE = { dialect: 'cel', source: 'features.multiOrgEnabled == true' };

const MANAGER = { name: 'Ada', email: 'ada@example.com', role: 'user', positions: ['sales_manager'] };
const CLERK = { name: 'Bo', email: 'bo@example.com', role: 'user', positions: ['sales_clerk'] };

/** The bag both ad-hoc sites hand-wrote before this change, reproduced verbatim. */
const oldBag = (user: Record<string, unknown>) =>
  new ExpressionEvaluator({ user, app: { name: 'crm' }, data: {} });

describe('objectui#6493 — buildExpressionScope binds one user object under all four spellings', () => {
  it('current_user / user / ctx.user / os.user are the SAME object, not four copies', () => {
    const user = { name: 'Ada', positions: ['sales_manager'] };
    const scope = buildExpressionScope({ user });

    expect(scope.current_user).toBe(user);
    expect(scope.user).toBe(user);
    expect(scope.ctx.user).toBe(user);
    expect(scope.os.user).toBe(user);
  });

  it('binds features — and NOT `app`, NOT `data` — defaulting every root to an empty object', () => {
    const scope = buildExpressionScope();
    // ⛔ No `app` (objectui#8155, ruled 2026-09-07). Neither ADR-0068 nor
    // `@objectstack/formula`'s SCOPE_ROOTS declares such a root, so binding it
    // made this tier the only place it existed: advertised by the
    // conditional-formatting editor and refused by the linter judging the very
    // same field, with no spelling that did both.
    //
    // ⛔ No `data` (objectui#8166, ruled 2026-09-10) — the mirror case. The
    // engine ACCEPTS `data` at `scope: 'record'`, which is precisely why an
    // ambient binding here was worse than `app`'s: the lint stayed green and
    // the predicate resolved, against this bag instead of against the row that
    // objectui#5741 made `record.*`. Unbound, it faults with the engine's own
    // `Unknown variable: data`.
    //
    // `toStrictEqual` is what makes this a fence rather than a sample — a root
    // added BACK reddens here just as loudly as one removed, and `app` or
    // `data` returning to this bag is the drift the rulings guard against.
    expect(scope).toStrictEqual({
      current_user: {}, user: {}, ctx: { user: {} }, os: { user: {} }, features: {},
    });
    // The identity above holds for the defaults too — the hand-written fallback
    // in `useExpressionContext` used to mint three separate empty objects.
    expect(scope.current_user).toBe(scope.user);
    expect(scope.ctx.user).toBe(scope.user);
    expect(scope.os.user).toBe(scope.user);
  });
});

describe('objectui#6493 — a current_user gate BITES through the shared scope', () => {
  it('hides the field from a user the rule excludes', () => {
    expect(evaluateVisibility(POSITION_GATE, createExpressionEvaluator({ user: CLERK }))).toBe(false);
  });

  it('shows the field to a user the rule admits', () => {
    expect(evaluateVisibility(POSITION_GATE, createExpressionEvaluator({ user: MANAGER }))).toBe(true);
  });

  it('reaches the same verdict through the ctx.user and os.user spellings', () => {
    const clerk = createExpressionEvaluator({ user: CLERK });
    const manager = createExpressionEvaluator({ user: MANAGER });

    expect(evaluateVisibility(CTX_ALIAS_GATE, clerk)).toBe(false);
    expect(evaluateVisibility(OS_ALIAS_GATE, clerk)).toBe(false);
    expect(evaluateVisibility(CTX_ALIAS_GATE, manager)).toBe(true);
    expect(evaluateVisibility(OS_ALIAS_GATE, manager)).toBe(true);
  });

  it('binds features, so a deployment flag can hide a field', () => {
    expect(evaluateVisibility(FEATURE_GATE, createExpressionEvaluator({ features: { multiOrgEnabled: false } }))).toBe(false);
    expect(evaluateVisibility(FEATURE_GATE, createExpressionEvaluator({ features: { multiOrgEnabled: true } }))).toBe(true);
  });
});

describe('objectui#6493 — the bag this change replaced failed OPEN on every one of those roots', () => {
  it('showed the excluded user the field: an unbound current_user faults, and a fault reads as YES', () => {
    // The whole defect in one line. Same predicate, same user, same
    // `evaluateVisibility` — and the opposite answer from the one above.
    expect(evaluateVisibility(POSITION_GATE, oldBag(CLERK))).toBe(true);
  });

  it('did the same for the ctx.user / os.user spellings', () => {
    expect(evaluateVisibility(CTX_ALIAS_GATE, oldBag(CLERK))).toBe(true);
    expect(evaluateVisibility(OS_ALIAS_GATE, oldBag(CLERK))).toBe(true);
  });

  it('did the same for a features flag that was off', () => {
    expect(evaluateVisibility(FEATURE_GATE, oldBag(CLERK))).toBe(true);
  });

  it('bound `user` all along — which is what made the divergence invisible', () => {
    // A gate authored against the back-compat spelling worked before AND after.
    // An author who tested with `user.positions` had no way to discover that the
    // canonical spelling was inert on this surface.
    const USER_ALIAS_GATE = { dialect: 'cel', source: "'sales_manager' in user.positions" };
    expect(evaluateVisibility(USER_ALIAS_GATE, oldBag(CLERK))).toBe(false);
    expect(evaluateVisibility(USER_ALIAS_GATE, createExpressionEvaluator({ user: CLERK }))).toBe(false);
  });
});

describe('objectui#6493 — neither call site hand-writes a predicate bag any more', () => {
  // A source guard, because the defect was a COPY of the bag rather than a
  // wrong value in it: nothing about a second `new ExpressionEvaluator({...})`
  // is visible in a render, and the copy that drifted read as reasonable code
  // for as long as it existed. The fence is the producer-side repair.
  const sources = {
    'views/RecordFormPage.tsx': new URL('../views/RecordFormPage.tsx', import.meta.url),
    'console/AppContent.tsx': new URL('../console/AppContent.tsx', import.meta.url),
  };

  for (const [label, url] of Object.entries(sources)) {
    it(`${label} builds its evaluator through createExpressionEvaluator`, () => {
      const src = readFileSync(url, 'utf8');
      expect(src).not.toMatch(/new\s+ExpressionEvaluator\s*\(/);
      expect(src).toMatch(/createExpressionEvaluator\s*\(/);
    });
  }
});
