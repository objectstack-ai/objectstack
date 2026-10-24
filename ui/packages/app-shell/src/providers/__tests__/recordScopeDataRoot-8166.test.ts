/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8166 — a `data.*` predicate at RECORD scope must fail LOUDLY.
 *
 * ## What was wrong, and why a green suite proved nothing
 *
 * `@objectstack/formula`'s `SCOPE_ROOTS` contains `data`, so at
 * `scope: 'record'` the authoring lint ACCEPTS `data.status == 'x'`. But
 * objectui#5741 (Phase 2 of the objectui#5330 canon) retired `data.*` on
 * runtime record surfaces — the row is `record.*` and nothing else, and
 * `@object-ui/core`'s `evaluator/rowPredicateCanon.ts` records the server's
 * verdict for the retired spelling as `❌ Unknown variable: data`.
 *
 * `buildExpressionScope` bound an ambient `data` anyway, which is what let a
 * predicate the linter had waved through also RESOLVE at runtime — against
 * that bag rather than against the row. Measured on `origin/main` before this
 * change, ONE authored `visibleWhen: "data.status == 'x'"` meant three things:
 *
 * | mount | ambient `data` | engine verdict |
 * | :-- | :-- | :-- |
 * | `RecordFormPage` / every `ExpressionProvider` mount | `{}` | `[runtime] No such key: status` → fail-open |
 * | `AppContent` field-list evaluator, EDIT mode | `editingRecord` | RESOLVED, silently, off the host's record |
 * | `AppContent` field-list evaluator, CREATE mode | `{}` | `[runtime] No such key: status` → fail-open |
 *
 * The middle row is the one the card is about: no error, no warning, and an
 * answer that came from the wrong object. The tests below pin all of it —
 * including the row that was ALREADY loud, so a future reader can tell the two
 * failure shapes apart rather than reading "it warns" as the whole story.
 *
 * ## The chain these assertions stand on
 *
 * `evalFieldPredicate(pred, ruleRecord, fallback, previousRecord, scope, …)` is
 * the call `packages/components/src/renderers/form/form.tsx` makes for every
 * `visibleWhen` / `readonlyWhen` / `requiredWhen` on a record form, with
 * `scope` coming from `usePredicateScope()` — the bag `ExpressionProvider`
 * publishes through `PredicateScopeProvider`, i.e. `buildExpressionScope`'s
 * return value. So passing that bag to that function IS the record-surface
 * path, not a model of it.
 *
 * ## The positive control, in the same run
 *
 * `app` (objectui#8155) is the root this tier already unbound, and it is what
 * "loud" looks like here. Every `data` assertion below has an `app` twin, so a
 * change that silences this channel cannot pass by silencing only the new half.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evalFieldPredicate } from '@object-ui/core';
import { buildExpressionScope } from '../ExpressionProvider';

/** The signed-in user, the one root this tier is actually about. */
const USER = { id: 'u1', name: 'Ada', positions: ['sales_manager'] };

/** The row a record form is editing — `status` is deliberately a REAL key. */
const ROW = { id: 'r1', status: 'x', amount: 100 };

/**
 * One `evalFieldPredicate` call shaped exactly like `form.tsx`'s, with both
 * diagnostic channels captured.
 *
 * `warn: false` is NOT passed: the built-in `console.warn` is half of what
 * "loud" means on this surface, and a test that only watched `onFault` would
 * stay green if the warning were removed.
 */
function evalOnRecordSurface(
  predicate: string,
  fallback: boolean,
  scope: Record<string, unknown>,
): { verdict: boolean; faults: string[]; warnings: string[]; threw: unknown } {
  const faults: string[] = [];
  const warnings: string[] = [];
  const spy = vi
    .spyOn(console, 'warn')
    .mockImplementation((...args: unknown[]) => void warnings.push(args.join(' ')));
  let verdict = fallback;
  let threw: unknown;
  try {
    verdict = evalFieldPredicate(predicate, ROW, fallback, undefined, scope, {
      context: `visibleWhen of field 'demo'`,
      onFault: (reason) => faults.push(reason),
    });
  } catch (err) {
    threw = err;
  } finally {
    spy.mockRestore();
  }
  return { verdict, faults, warnings, threw };
}

beforeEach(() => {
  // `evalFieldPredicate` dedupes its built-in warning per predicate TEXT in a
  // module-level Set, so every predicate string below is unique. Resetting
  // modules per test would be the alternative and would cost a re-import of
  // the CEL engine for each one.
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('objectui#8166 — the record-scope predicate bag binds no `data` root', () => {
  it('has no `data` key at all, on any input shape', () => {
    expect(buildExpressionScope({ user: USER })).not.toHaveProperty('data');
    expect(buildExpressionScope()).not.toHaveProperty('data');
    // A caller that still tries to hand one in cannot put it back: the builder
    // destructures the roots it binds and ignores everything else. This is the
    // half that makes the removal a FENCE rather than a tidy-up — `AppContent`
    // passed `data: editingRecord` here until this card.
    expect(
      buildExpressionScope({ user: USER, data: ROW } as Parameters<typeof buildExpressionScope>[0]),
    ).not.toHaveProperty('data');
  });

  it('still binds the identity aliases and `features` — nothing else moved', () => {
    const scope = buildExpressionScope({ user: USER });
    expect(scope.current_user).toBe(USER);
    expect(scope.user).toBe(USER);
    expect(scope.ctx.user).toBe(USER);
    expect(scope.os.user).toBe(USER);
    expect(scope.features).toEqual({});
  });
});

describe('objectui#8166 — a `data.*` predicate at record scope is now LOUD', () => {
  it('reports the engine\'s own `Unknown variable: data`, on BOTH channels', () => {
    const scope = buildExpressionScope({ user: USER });
    const r = evalOnRecordSurface("data.status == 'x'", true, scope);

    // ⭐ The ZONE-2 hard precondition, pinned as an assertion rather than a
    // memory: making this fault must not make a record form CRASH. A form that
    // throws mid-render is worse than one that hides a field.
    expect(r.threw).toBeUndefined();

    expect(r.faults).toHaveLength(1);
    expect(r.faults[0]).toContain('Unknown variable: data');
    // `[type]` is the engine's own classification for an unbound root — the
    // same tag the `app` control below carries. Pinned because the PREVIOUS
    // behaviour also produced a reason (`[runtime] No such key: status`), so
    // "there is a reason" does not distinguish before from after; the KIND
    // does.
    expect(r.faults[0]).toContain('[type]');

    // The built-in channel, which is what an author actually sees in a console.
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('Unknown variable: data');
    expect(r.warnings[0]).toContain("data.status == 'x'");
    // The advice line names the root that DOES reach the row.
    expect(r.warnings[0]).toContain("record.");
  });

  it('is loud in every fallback direction — readonlyWhen/requiredWhen too', () => {
    const scope = buildExpressionScope({ user: USER });
    // `visibleWhen` faults fail OPEN (`true`), `readonlyWhen`/`requiredWhen`
    // fail permissive (`false`). Both directions must REPORT; the verdict is
    // the shipped fault policy (`@object-ui/core`'s `fieldRules.ts`) and this
    // card does not move it — objectui#8069 owns that question.
    const open = evalOnRecordSurface("data.status == 'ro'", true, scope);
    const closed = evalOnRecordSurface("data.status == 'rq'", false, scope);

    expect(open.verdict).toBe(true);
    expect(closed.verdict).toBe(false);
    expect(open.faults[0]).toContain('Unknown variable: data');
    expect(closed.faults[0]).toContain('Unknown variable: data');
  });

  it('POSITIVE CONTROL — `app` (objectui#8155) faults in exactly the same shape', () => {
    const scope = buildExpressionScope({ user: USER });
    const app = evalOnRecordSurface("app.name == 'crm'", true, scope);
    const data = evalOnRecordSurface("data.name == 'crm'", true, scope);

    expect(app.threw).toBeUndefined();
    expect(app.faults[0]).toContain('[type]');
    expect(app.faults[0]).toContain('Unknown variable: app');
    expect(app.warnings).toHaveLength(1);

    // The point of the control: `data` is now the same CLASS of failure as the
    // root this tier already refused. The reason's FIRST LINE is the engine's
    // classification — comparing those two, rather than two independent
    // `toContain`s, is what makes this a parity measurement. (The lines after
    // it are the source excerpt and a caret, which differ by construction
    // because the two predicates are different strings.)
    expect(data.faults[0].split('\n')[0]).toBe('[type] Unknown variable: data');
    expect(app.faults[0].split('\n')[0]).toBe('[type] Unknown variable: app');
  });

  it('the silent leg is gone: the host record can no longer answer for the row', () => {
    // The bag `AppContent` built until this card, reconstructed byte-for-byte:
    // the shipped scope plus the record under edit bound as `data`. It is
    // reproduced here — rather than imported — precisely because the code that
    // built it is what this card deleted.
    const preFixBag = { ...buildExpressionScope({ user: USER }), data: ROW };
    const before = evalOnRecordSurface('data.amount > 50', true, preFixBag);
    // Silence, and a verdict computed off the HOST's object rather than the
    // row the author meant: no fault, no warning, a confident answer. That is
    // the defect — and note it is a TRUE here, so an author testing on this
    // one mount would have seen the predicate "work".
    expect(before.faults).toHaveLength(0);
    expect(before.warnings).toHaveLength(0);
    expect(before.verdict).toBe(true);
    // Both polarities, so this witnesses a resolving predicate rather than a
    // fallback that happens to agree.
    const beforeFalse = evalOnRecordSurface('data.amount > 500', true, preFixBag);
    expect(beforeFalse.faults).toHaveLength(0);
    expect(beforeFalse.verdict).toBe(false);

    // The shipped bag cannot reach that state, because there is no `data` in it.
    const after = evalOnRecordSurface("data.status == 'x2'", true, buildExpressionScope({ user: USER }));
    expect(after.faults).toHaveLength(1);
    expect(after.faults[0]).toContain('Unknown variable: data');
  });
});

describe('objectui#8166 — REGRESSION FLOOR: a correct record predicate still gates', () => {
  it('shows the field when the canonical `record.*` predicate holds', () => {
    const r = evalOnRecordSurface("record.status == 'x'", true, buildExpressionScope({ user: USER }));
    expect(r.verdict).toBe(true);
    expect(r.faults).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('HIDES the field when it does not — both polarities, or the gate never gated', () => {
    const r = evalOnRecordSurface("record.status == 'archived'", true, buildExpressionScope({ user: USER }));
    expect(r.verdict).toBe(false);
    expect(r.faults).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('an identity predicate still resolves through the shared bag', () => {
    const scope = buildExpressionScope({ user: USER });
    expect(evalOnRecordSurface("'sales_manager' in current_user.positions", false, scope).verdict).toBe(true);
    expect(evalOnRecordSurface("'sales_clerk' in os.user.positions", false, scope).verdict).toBe(false);
  });

  it('a numeric record predicate still discriminates — not just the string one', () => {
    const scope = buildExpressionScope({ user: USER });
    expect(evalOnRecordSurface('record.amount > 50', false, scope).verdict).toBe(true);
    expect(evalOnRecordSurface('record.amount > 500', true, scope).verdict).toBe(false);
  });
});
