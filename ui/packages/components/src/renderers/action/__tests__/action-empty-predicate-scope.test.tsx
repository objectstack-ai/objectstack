/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3850 — how wide "empty predicate" is on the action face, now that
 * `hasDeclaredVisibilityGate` is a re-export of core's one definition
 * (`hasDeclaredPredicate`, `evaluator/declaredPredicate.ts`) instead of a
 * second, narrower answer to the same question.
 *
 * The residue objectui#3842 left behind: `hasDeclaredVisibilityGate` asked
 * `!= null && !== ''`, so every OBJECT counted as a declared gate — including
 * `{ dialect: 'cel', source: '' }`, the shape `@objectstack/spec`'s
 * `ExpressionInputSchema` produces when an author leaves a predicate empty, and
 * therefore the empty shape most likely to reach a renderer from real metadata.
 * The verdict path normalized the same value to `undefined`, and
 * `evaluateCondition(undefined)` answers `true` = "no condition → visible /
 * enabled". On `visible` that `true` means SHOW, so the two mistakes cancelled;
 * on `disabled` it means GREY, so they compounded — a button disabled forever
 * that no author asked to disable.
 *
 * ## What each case detects
 *
 *   • the `disabled` leg's two envelope cases (`{ dialect, source: '' }` and
 *     `{ source: '' }`) → clickable. THE defect, one case per row of the #3850
 *     table's "残留" lines. Restore `!= null && !== ''` in the definition and
 *     exactly these go red.
 *   • the junk cases (`0`, `{}`, an `ast`-only envelope, an array) → since
 *     objectui#11358 a DECLARED gate that cannot be evaluated, not "no gate":
 *     `disabled` greys out and `visible` hides (each key's fault direction),
 *     the legacy `enabled` leg stays enabled (its fault direction), and each is
 *     reported. They were clickable / rendered from objectui#3850 until then.
 *   • `disabled: true` / a truthy expression / a truthy CEL envelope → still
 *     greyed. Anti-mutation guards: "never disable anything" satisfies most of
 *     this file on its own, and these refuse it.
 *   • `disabled: false` and no `disabled` at all → still clickable, so widening
 *     "empty" did not swallow a declared-and-false verdict (objectui#3812).
 *   • the `visible` leg's empty cases → still rendered, which is the EQUIVALENCE
 *     the objectui#3850 ruling asked for on that family. Two of the three rows
 *     are equivalence in the strict sense (`''` and the envelope reached "shown"
 *     before this change too, by cancellation); the whitespace row is NOT — see
 *     the next block, which pins the change rather than hiding it.
 *
 * ## The whitespace row moves, and this suite says so out loud
 *
 * Measured on this tree, `action:button` before → after:
 *
 *   | value                          | `visible`      | `disabled`  | `enabled`  |
 *   |--------------------------------|----------------|-------------|------------|
 *   | `''`                           | shown → shown  | on → on     | on → on    |
 *   | `{ dialect:'cel', source:'' }` | shown → shown  | GREY → on   | on → on    |
 *   | `{ source: '' }`               | shown → shown  | GREY → on   | on → on    |
 *   | `'   '` (whitespace only)      | HIDDEN → shown | on → on     | GREY → on  |
 *   | `0` / `{}`                     | shown → shown  | GREY → on   | on → on    |
 *
 * `'   '` used to be a declared gate whose verdict came from `'${   }'` (the
 * normalizer wraps a whitespace string rather than folding it), which evaluates
 * falsy — so a predicate that says nothing HID the action from everyone, and
 * greyed it out through the negated `enabled` leg. Moving it to "no gate" is the
 * direction this gate's own doc has always claimed ("an empty predicate must not
 * hide the action from everyone either"); it is a behaviour CHANGE on `visible`
 * and `enabled` all the same, so it is pinned as one.
 *
 * ## Why one leaf plus an identity assertion covers five call sites
 *
 * `action:button`, `action:icon`, `action:group`'s inline button and dropdown
 * item, and `action:menu`'s item all import the same symbol from
 * `../visibility-gate` — unchanged by this move, which is the point of keeping
 * the name. The identity case below asserts that symbol IS core's
 * `hasDeclaredPredicate`, so the scope pinned here is the scope all five read; a
 * leaf that re-spelled the question locally would break that claim, not hide
 * behind it. The `''` rows for the member leaves stay where objectui#3842 /
 * objectui#3849 put them (`action-member-disabled-declared-gate.test.tsx`).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry, ExpressionEvaluator, hasDeclaredPredicate, toPredicateInput } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
// Module-scope side-effect import so the renderer is in the registry when
// `ComponentRegistry.get` runs (the light `dom` project does not load the
// `@object-ui/components` graph), per AGENTS.md §测试纪律.
import '../action-button';
import { hasDeclaredVisibilityGate } from '../visibility-gate';

/** Mount the leaf the way `action:bar` mounts it: whole action spread onto `schema`. */
function renderLeaf(action: Record<string, unknown>, scope: Record<string, unknown> = {}) {
  const Renderer = ComponentRegistry.get('action:button');
  if (!Renderer) throw new Error('action:button is not registered');
  return render(
    <PredicateScopeProvider scope={scope}>
      <Renderer schema={{ ...action, type: 'action:button', actionType: 'script' }} />
    </PredicateScopeProvider>,
  );
}

const ACT = { name: 'act', label: 'Act', type: 'script' };
const act = () => screen.getByRole('button', { name: 'Act' });

/** The shapes with nothing to evaluate, by the spelling that produces them. */
const EMPTY_SHAPES: Array<{ label: string; value: unknown }> = [
  { label: "'' (empty string)", value: '' },
  { label: "'   ' (whitespace only)", value: '   ' },
  { label: "{ dialect: 'cel', source: '' } (what `objectstack build` emits)", value: { dialect: 'cel', source: '' } },
  { label: "{ source: '' } (envelope without a dialect)", value: { source: '' } },
  { label: 'null', value: null },
];

/**
 * Values the evaluator cannot read at all — DECLARED and faulting since
 * objectui#11358 (the four shapes triage's ruling names).
 */
const JUNK_SHAPES: Array<{ label: string; value: unknown }> = [
  { label: "{ dialect: 'cel', ast } (an `ast`-only envelope)", value: { dialect: 'cel', ast: { kind: 'call', fn: '==' } } },
  { label: '0', value: 0 },
  { label: '{} (an object with no source)', value: {} },
  { label: '[] (an array)', value: ['record.id'] },
];

/** Run `fn` with `console.warn` captured; return the lines it printed. */
function captureWarnings(fn: () => void): string[] {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    fn();
    return warn.mock.calls.map(c => c.map(String).join(' '));
  } finally {
    warn.mockRestore();
  }
}

describe('the one definition — `hasDeclaredVisibilityGate` is core\'s `hasDeclaredPredicate` (objectui#3850)', () => {
  it('is the same function object, not a same-shaped copy', () => {
    // A re-spelled twin here is how this question grew three scopes in the first
    // place (objectui#3142 is what copies of one answer cost). Identity, so the
    // five member-action call sites and this suite cannot drift apart.
    expect(hasDeclaredVisibilityGate).toBe(hasDeclaredPredicate);
  });

  it('answers the empty spellings with "no gate", and the junk and a declared boolean with "gate"', () => {
    for (const { label, value } of EMPTY_SHAPES) {
      expect(hasDeclaredVisibilityGate(value), `${label} must not count as a declared gate`).toBe(false);
    }
    // objectui#11358: declared, and faulting — never "no gate".
    for (const { label, value } of JUNK_SHAPES) {
      expect(hasDeclaredVisibilityGate(value), `${label} is a declared gate that cannot be evaluated`).toBe(true);
    }
    expect(hasDeclaredVisibilityGate(false)).toBe(true);
    expect(hasDeclaredVisibilityGate(true)).toBe(true);
  });
});

describe('action:button `disabled` — an empty predicate is not a gate (objectui#3850)', () => {
  it.each(EMPTY_SHAPES)('disabled: $label → the button stays clickable', ({ value }) => {
    renderLeaf({ ...ACT, disabled: value });
    expect(act()).not.toBeDisabled();
  });

  it.each(JUNK_SHAPES)('disabled: $label (declared, not evaluable — objectui#11358) → greyed out, reported', ({ value }) => {
    // `disabled`'s fault direction is CLOSED (objectui#11242): the evaluator's
    // fail-soft `true` for a fault means "greyed out" on this key.
    const onFault = vi.fn();
    const lines = captureWarnings(() => {
      renderLeaf({ ...ACT, disabled: value });
    });
    expect(act()).toBeDisabled();
    // The report is `evalFieldPredicate`'s one-time `[unevaluable]` line, under
    // one locator for the whole class — so at most one per render, and the
    // reason is pinned through the evaluator directly.
    expect(lines.filter(l => l.includes('[unevaluable]')).length).toBeLessThanOrEqual(1);
    new ExpressionEvaluator({}).evaluateCondition(toPredicateInput(value) as never, { onFault });
    expect(onFault).toHaveBeenCalledOnce();
    expect(String(onFault.mock.calls[0][0])).toContain('[unevaluable]');
  });

  it('disabled: true → still greyed out', () => {
    renderLeaf({ ...ACT, disabled: true });
    expect(act()).toBeDisabled();
  });

  it('disabled: false → still clickable (a verdict, not a missing gate)', () => {
    renderLeaf({ ...ACT, disabled: false });
    expect(act()).not.toBeDisabled();
  });

  it('no `disabled` at all → still clickable', () => {
    renderLeaf({ ...ACT });
    expect(act()).not.toBeDisabled();
  });

  it("disabled: { dialect: 'cel', source: 'true' } → still greyed out (a NON-empty envelope is a gate)", () => {
    renderLeaf({ ...ACT, disabled: { dialect: 'cel', source: 'true' } });
    expect(act()).toBeDisabled();
  });

  it('an expression-valued `disabled` keeps its verdict, both ways', () => {
    const gated = { ...ACT, disabled: 'features.locked == true' };
    const { unmount } = renderLeaf(gated, { features: { locked: true } });
    expect(act()).toBeDisabled();
    unmount();
    renderLeaf(gated, { features: { locked: false } });
    expect(act()).not.toBeDisabled();
  });
});

describe('action:button `visible` — the equivalence the ruling asked for, and the one row that moves', () => {
  it.each(EMPTY_SHAPES)('visible: $label → the action is still rendered', ({ value }) => {
    renderLeaf({ ...ACT, visible: value });
    expect(act()).toBeInTheDocument();
  });

  it.each(JUNK_SHAPES)('visible: $label (declared, not evaluable — objectui#11358) → hidden, reported once', ({ value }) => {
    // The toolbar half of the ruling: `visible` fails CLOSED on a fault
    // (`throwOnError`, objectui#11212), and the leg's own catch is the one
    // report, naming the action. A label per row, so that report's dedupe
    // (label + predicate) cannot carry one row into the next.
    const label = `Act ${JUNK_SHAPES.findIndex(r => r.value === value)}`;
    const lines = captureWarnings(() => {
      const { container } = renderLeaf({ ...ACT, label, name: label, visible: value });
      expect(container.querySelector('button')).toBeNull();
    });
    expect(lines.filter(l => l.includes('[unevaluable]'))).toHaveLength(1);
  });

  it('visible: false → still hidden, and visible: true / a true predicate still shown', () => {
    const { container, unmount } = renderLeaf({ ...ACT, visible: false });
    expect(container.querySelector('button')).toBeNull();
    unmount();
    renderLeaf({ ...ACT, visible: true });
    expect(act()).toBeInTheDocument();
  });

  it('a false expression still hides it (the gate narrowed; evaluation did not change)', () => {
    const { container } = renderLeaf({ ...ACT, visible: 'features.beta == true' }, { features: { beta: false } });
    expect(container.querySelector('button')).toBeNull();
  });

  it("CHANGED: visible: '   ' was HIDDEN before this ruling and is now shown", () => {
    // Not equivalence — the honest row. `'   '` normalized to `'${   }'`, which
    // evaluates falsy, so a predicate that says nothing hid the action from
    // everyone. See this file's header table.
    renderLeaf({ ...ACT, visible: '   ' });
    expect(act()).toBeInTheDocument();
  });
});

describe('action:button legacy `enabled` leg — same definition, same scope', () => {
  it.each(EMPTY_SHAPES)('enabled: $label → not greyed out', ({ value }) => {
    renderLeaf({ ...ACT, enabled: value });
    expect(act()).not.toBeDisabled();
  });

  it('CHANGED: enabled: \'   \' greyed the button out before this ruling', () => {
    // The negated leg (`disabled = !isEnabled`) turned the whitespace string's
    // falsy verdict into "disabled". Covered by the row above; stated separately
    // because it is a behaviour change, not a preserved one.
    renderLeaf({ ...ACT, enabled: '   ' });
    expect(act()).not.toBeDisabled();
  });

  it('enabled: false → still greyed out (unchanged)', () => {
    renderLeaf({ ...ACT, enabled: false });
    expect(act()).toBeDisabled();
  });

  it('enabled: true → not greyed out (unchanged)', () => {
    renderLeaf({ ...ACT, enabled: true });
    expect(act()).not.toBeDisabled();
  });

  it.each(JUNK_SHAPES)('enabled: $label (declared, not evaluable — objectui#11358) → not greyed out: the key\'s fault direction', ({ value }) => {
    // The legacy `enabled` leg is fail-soft on a fault (`true` = enabled), and
    // objectui#11358 does not move a key's fault direction — it stops reading
    // this value as "no gate". Same verdict as before the ruling, now reached
    // as a fault (and reported) instead of in silence.
    captureWarnings(() => {
      renderLeaf({ ...ACT, enabled: value });
    });
    expect(act()).not.toBeDisabled();
  });

  it('`disabled` still wins over `enabled` when it is declared', () => {
    renderLeaf({ ...ACT, disabled: true, enabled: true });
    expect(act()).toBeDisabled();
  });

  it("an EMPTY `disabled` no longer short-circuits the chain — `enabled: false` is reached", () => {
    // The precedence case: with `disabled: ''` no longer a gate, the chain falls
    // through to the legacy leg instead of stopping at an empty predicate.
    renderLeaf({ ...ACT, disabled: '', enabled: false });
    expect(act()).toBeDisabled();
  });

  it('an empty ENVELOPE `disabled` falls through the same way (objectui#3850 row)', () => {
    const { unmount } = renderLeaf({ ...ACT, disabled: { dialect: 'cel', source: '' }, enabled: false });
    expect(act()).toBeDisabled();
    unmount();
    // The other direction is the mutation detector of the pair: under the old
    // scope the envelope was a declared gate whose verdict was `true`, so the
    // button was greyed out no matter what `enabled` said.
    renderLeaf({ ...ACT, disabled: { dialect: 'cel', source: '' }, enabled: true });
    expect(act()).not.toBeDisabled();
  });
});
