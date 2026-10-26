/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3862 — `SchemaRenderer`'s inline `disabled` gate asked
 * `newSchema.disabled !== undefined`, the WIDEST of the three spellings this
 * repo had for "is a gate declared?", on the one key where width is not free.
 *
 * `evaluateCondition` answers an empty predicate with `true` — "no condition, so
 * visible/enabled". On `visible` that `true` is negated and means SHOW, which is
 * what "no gate" means anyway, so the `visible` chain above is benign. On
 * `disabled` it means GREY. So `disabled: ''` set `_disabled = true`, and one
 * notch wider than the `!= null` family, so did `disabled: null`.
 *
 * Two things make this the generic-path defect rather than one renderer's:
 *
 *   • the block runs in the `evaluatedSchema` useMemo with no type branch, so it
 *     covers EVERY node that renders through `SchemaRenderer`.
 *   • `_disabled` is not an internal marker. It is stripped from
 *     `componentProps` and re-injected as `disabled: __disabled || undefined`,
 *     so any component taking a `disabled` prop — inputs, buttons, form fields —
 *     is really disabled. That forwarding is pinned below, because "the flag is
 *     not set" and "the prop does not arrive" are different claims and only the
 *     second is what a user sees.
 *
 * The fix reads core's one definition (`hasDeclaredPredicate`, objectui#3850's
 * ruling) instead of adding a fourth local spelling — the `&& !== ''` this card
 * explicitly ruled out.
 *
 * ## What each case detects
 *
 *   • `disabled: ''` / `null` / `'   '` / `{ dialect, source: '' }` /
 *     `{ source: '' }` → NOT disabled, and no `disabled` prop forwarded. THE
 *     defect. `''` and `null` are the two rows the card measured; the envelope is
 *     objectui#3850's shape reaching this path too.
 *   • `disabled: true` / a truthy expression / a truthy CEL envelope → still
 *     disabled. Anti-mutation guards: "never disable" satisfies most of this file
 *     alone, and these refuse it.
 *   • `disabled: false` → still not disabled. `disabled: 0` (and `{}`, an
 *     array, an `ast`-only envelope) → DISABLED since objectui#11358, reported:
 *     a declared gate that cannot be evaluated faults, and a faulting
 *     `disabled` greys the control out (it failed open, as "no gate", before).
 *   • `disabledOn` in each of those directions → the alias reads the same
 *     definition, not a copy of it.
 *   • precedence: an EMPTY `disabled` no longer short-circuits the chain, so a
 *     declared `disabledOn` is finally consulted. This case is the one that would
 *     stay green if someone "fixed" the defect by deleting the `disabled` leg.
 *   • the `visible` chain, unchanged: it keeps `!== undefined` (its alias
 *     precedence is load-bearing and its `true` is benign), so `visible: ''`
 *     still renders and `visible: false` still hides.
 *   • the `hidden` / `hiddenOn` legs of that same chain, which are NOT negated
 *     and therefore HAD this defect with the polarity that makes the node
 *     VANISH. Measured while writing the equivalence cases, out of this ruling's
 *     scope, filed as objectui#3955 and pinned here as a documented divergence
 *     rather than left for the next reader to rediscover; that divergence case is
 *     now a convergence case, and the full table for both legs lives in
 *     `SchemaRenderer.hiddenDeclaredGate.test.tsx`.
 *   • the empty shapes include the blank-`source` envelope since objectui#3960
 *     widened the shared definition — the same rows, one spelling longer.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Restoring `newSchema.disabled !== undefined` / `disabledOn !== undefined` must
 * turn RED exactly the seven empty-shape cases on each key (`disabled`,
 * `disabledOn`), their forwarding cases, the `0` junk case and the precedence
 * case — and leave every `true` / `false` / expression / `visible` case GREEN.
 * Nothing here can go red in the other direction: the change only ever removes a
 * `disabled` prop, never adds one.
 *
 * Reverting the objectui#3960 half alone (envelope blankness, in core's shared
 * definition) turns RED only the two blank-`source` rows on each key.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import type { DataSource } from '@object-ui/types';
import { PredicateScopeProvider } from '../hooks/useExpression';
import { __resetVisibilityPredicateWarnings } from '../utils/visibilityDiagnostic';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are the `data` ROOT of the expression scope — the renderer binds
 * `SchemaRendererContext.dataSource` as `data` for every predicate, which is
 * the second meaning this one key carries.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

/**
 * Records the `disabled` prop EXACTLY as it arrives — `absent` when the renderer
 * forwarded nothing, so the pin can tell "no prop" from "disabled={false}".
 */
const Probe = (props: { disabled?: unknown }) => (
  <div
    data-testid="probe"
    data-disabled-prop={props.disabled === undefined ? 'absent' : String(props.disabled)}
  />
);

const DATA = { status: 'locked', readOnly: true, unlocked: false };

function renderNode(schema: Record<string, unknown>) {
  return render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA as unknown as DataSource }}>
      <SchemaRenderer schema={{ type: 'probe-3862', ...schema } as never} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
  );
}

/** The forwarded prop, or `null` when the node did not render at all. */
function disabledProp(): string | null {
  const el = screen.queryByTestId('probe');
  return el ? el.getAttribute('data-disabled-prop') : null;
}

const EMPTY_SHAPES: Array<{ label: string; value: unknown }> = [
  { label: "'' (empty string)", value: '' },
  { label: 'null', value: null },
  { label: "'   ' (whitespace only)", value: '   ' },
  { label: "{ dialect: 'cel', source: '' } (what `objectstack build` emits)", value: { dialect: 'cel', source: '' } },
  { label: "{ source: '' } (envelope without a dialect)", value: { source: '' } },
  // objectui#3960 — the fourth empty spelling, arriving through the same shared
  // definition. It was still a declared gate after this card's fix (the
  // normalizer folds a `source` of `''` and does not trim), so the generic path
  // greyed the control out for a predicate that says nothing; blankness is now
  // decided for the envelope spelling too.
  { label: "{ dialect: 'cel', source: '   ' } (blank source — objectui#3960)", value: { dialect: 'cel', source: '   ' } },
  { label: "{ source: '   ' } (blank source, no dialect)", value: { source: '   ' } },
];

describe('SchemaRenderer `disabled` — an empty predicate is not a declared gate (objectui#3862)', () => {
  beforeEach(() => {
    ComponentRegistry.register('probe-3862', Probe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('probe-3862');
  });

  it.each(EMPTY_SHAPES)('disabled: $label → not disabled, and no `disabled` prop forwarded', ({ value }) => {
    renderNode({ disabled: value });
    // Both halves of the claim: the node renders, and the prop channel
    // (`disabled: __disabled || undefined`) carries nothing.
    expect(disabledProp()).toBe('absent');
  });

  it.each(EMPTY_SHAPES)('disabledOn: $label → not disabled either (the alias reads the same definition)', ({ value }) => {
    renderNode({ disabledOn: value });
    expect(disabledProp()).toBe('absent');
  });

  // objectui#11358: junk is a DECLARED gate that cannot be evaluated, not "no
  // gate". It reaches `evaluateEnablementPredicate`, which reports the fault
  // and returns the evaluator's fail-soft `true` — on this key, DISABLED, as
  // for a `disabled` predicate that faults with text in it (objectui#11242).
  // A node id per row: the report dedupes per node and key.
  it.each([
    ['0', 0, 'probe-11358-zero'],
    ['{} (no source)', {}, 'probe-11358-object'],
    ['[] (array)', ['record.id'], 'probe-11358-array'],
    ["{ dialect: 'cel', ast } (an `ast`-only envelope)", { dialect: 'cel', ast: { kind: 'call', fn: '==' } }, 'probe-11358-ast'],
  ] as const)('disabled: %s (declared, not evaluable — objectui#11358) → disabled, reported once', (_label, value, id) => {
    // The report dedupes on (type, key, predicate text), and an object with no
    // `source` prints as one text — so each row starts from a clean dedupe.
    __resetVisibilityPredicateWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderNode({ id, disabled: value });
      expect(disabledProp()).toBe('true');
      const lines = warn.mock.calls.map((c) => c.map(String).join(' '));
      expect(lines.filter((l) => l.includes('[unevaluable]'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('disabled: true → still disabled, and the prop is forwarded', () => {
    renderNode({ disabled: true });
    expect(disabledProp()).toBe('true');
  });

  it('disabled: false → still not disabled', () => {
    renderNode({ disabled: false });
    expect(disabledProp()).toBe('absent');
  });

  it('no `disabled` at all → not disabled', () => {
    renderNode({});
    expect(disabledProp()).toBe('absent');
  });

  it('an expression-valued `disabled` keeps its verdict, both ways', () => {
    const { unmount } = renderNode({ disabled: '${data.status === "locked"}' });
    expect(disabledProp()).toBe('true');
    unmount();
    renderNode({ disabled: '${data.unlocked}' });
    expect(disabledProp()).toBe('absent');
  });

  it("a non-empty CEL envelope keeps its verdict, both ways", () => {
    const { unmount } = renderNode({ disabled: { dialect: 'cel', source: 'true' } });
    expect(disabledProp()).toBe('true');
    unmount();
    renderNode({ disabled: { dialect: 'cel', source: 'false' } });
    expect(disabledProp()).toBe('absent');
  });

  it('an expression-valued `disabledOn` keeps its verdict', () => {
    renderNode({ disabledOn: '${data.readOnly}' });
    expect(disabledProp()).toBe('true');
  });
});

describe('SchemaRenderer `disabled` chain precedence (objectui#3862)', () => {
  beforeEach(() => {
    ComponentRegistry.register('probe-3862', Probe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('probe-3862');
  });

  it('an EMPTY `disabled` no longer short-circuits — a declared `disabledOn` is consulted', () => {
    // Before: `'' !== undefined` won the chain, `evaluateCondition('')` was
    // `true`, and the node was disabled for a reason no key stated. Now the
    // empty leg is not a gate, so the declared alias decides.
    renderNode({ disabled: '', disabledOn: '${data.readOnly}' });
    expect(disabledProp()).toBe('true');
  });

  it('… and the alias verdict is honoured in the other direction too', () => {
    renderNode({ disabled: { dialect: 'cel', source: '' }, disabledOn: '${data.unlocked}' });
    expect(disabledProp()).toBe('absent');
  });

  it('a DECLARED `disabled` still wins over `disabledOn`', () => {
    renderNode({ disabled: false, disabledOn: true });
    expect(disabledProp()).toBe('absent');
  });
});

describe('SchemaRenderer `visible` chain is untouched by this change (objectui#3862)', () => {
  beforeEach(() => {
    ComponentRegistry.register('probe-3862', Probe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('probe-3862');
  });

  it.each(EMPTY_SHAPES)('visible: $label → still rendered', ({ value }) => {
    renderNode({ visible: value });
    expect(screen.getByTestId('probe')).toBeInTheDocument();
  });

  it('visible: false → still hidden; visible: true → still rendered', () => {
    const { unmount } = renderNode({ visible: false });
    expect(disabledProp()).toBeNull();
    unmount();
    renderNode({ visible: true });
    expect(screen.getByTestId('probe')).toBeInTheDocument();
  });

  it('CONVERGED (objectui#3955): the `hidden` leg reads the same definition, so an empty predicate no longer hides', () => {
    // This case used to be a DOCUMENTED DIVERGENCE. The other polarity exit of the
    // same asymmetry, in the same `useMemo`: `hidden` / `hiddenOn` return
    // `evaluateCondition(...)` UN-negated, so "nothing to evaluate → true" meant
    // HIDE and the node vanished for `hidden: ''` / `null` / `'   '` /
    // `{ dialect, source: '' }`. It was measured here while writing the
    // equivalence cases and left out of objectui#3850's ruling on purpose (its
    // placement clause named the `disabled` / `disabledOn` legs), then fixed as
    // objectui#3955 — the assertions below flipped from "the node is gone" to
    // "the node renders".
    //
    // The full table for both legs, including precedence and the anti-mutation
    // guards, is in `SchemaRenderer.hiddenDeclaredGate.test.tsx`; these three
    // lines stay here because this file is where the divergence was recorded.
    const { unmount } = renderNode({ hidden: '' });
    expect(screen.getByTestId('probe')).toBeInTheDocument();
    unmount();
    renderNode({ hidden: { dialect: 'cel', source: '' } });
    expect(screen.getByTestId('probe')).toBeInTheDocument();
  });

  it('… while the `visible` legs are unchanged, which is why the same empty value was benign there', () => {
    renderNode({ visible: '' });
    expect(screen.getByTestId('probe')).toBeInTheDocument();
  });
});
