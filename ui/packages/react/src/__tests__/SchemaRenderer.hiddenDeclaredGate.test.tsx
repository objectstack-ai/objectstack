/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3955 — the REVERSE-POLARITY twin of objectui#3862, in the same
 * `useMemo` of the same file.
 *
 * `SchemaRenderer`'s visibility chain has six legs. The four `visible*` ones are
 * written `!evaluator.evaluateCondition(...)`; the `hidden` / `hiddenOn` pair is
 * not negated. `evaluateCondition` documents exactly ONE default for "there is
 * nothing here to evaluate": it returns `true`, meaning *visible/enabled*. Negated
 * that default lands on "shown", which is what "no gate" means anyway — benign.
 * Un-negated it means HIDE, so an empty predicate made the node disappear:
 *
 *   value                        | visible* legs | hidden / hiddenOn (before)
 *   ''                           | rendered      | HIDDEN
 *   '   ' (whitespace)           | rendered      | HIDDEN
 *   { dialect: 'cel', source: '' }| rendered     | HIDDEN
 *   null                         | rendered      | HIDDEN
 *   false                        | HIDDEN        | rendered
 *   true                         | rendered      | HIDDEN
 *
 * The `false` / `true` rows were already right — a declared verdict is honoured —
 * and the four "empty" rows were the defect, with the widest possible spelling in
 * front of them (`!== undefined`, so `hidden: null` counted too).
 *
 * Two things make this the generic-path defect rather than one renderer's, and
 * make it HARDER to diagnose than its `disabled` twin:
 *
 *   • the block runs in the `evaluatedSchema` useMemo with no type branch, so it
 *     covers EVERY node that renders through `SchemaRenderer`;
 *   • a greyed-out control is still on screen. A node that never rendered is
 *     indistinguishable from metadata that meant to hide it — the author sees
 *     "I wrote an empty `hidden` and the whole block vanished", with nothing on
 *     screen to attribute it to.
 *
 * `{ dialect, source: '' }` is not an exotic spelling: `@objectstack/spec`'s
 * `ExpressionInputSchema` normalizes every authored predicate into an envelope, so
 * "author left the predicate empty" compiles to exactly this.
 *
 * The fix reads core's ONE definition (`hasDeclaredPredicate`, objectui#3850's
 * ruling) rather than adding an Nth local `&& !== ''`, and it also brings the
 * fourth empty spelling — a blank-but-not-empty envelope `source`, objectui#3960 —
 * with it, since that widening happened in the same definition.
 *
 * ## What each case detects
 *
 *   • the empty shapes on `hidden` and on `hiddenOn` → the node RENDERS. THE
 *     defect. Each shape reaches "nothing to evaluate" by its own route (string
 *     identity, `trim()`, envelope `source` empty, envelope `source` blank), so
 *     each is an independent mutation detector.
 *   • non-predicate junk (`0`, `{}`, `[]`, an `ast`-only envelope) → HIDDEN
 *     since objectui#11358, and reported once. It rendered from objectui#3955
 *     until then, read as "no gate"; that ruling made it a declared gate that
 *     cannot be evaluated, and this leg answers a fault with the evaluator's
 *     fail-soft `true` — which on `hidden` means hidden, exactly as it does for
 *     a `hidden` predicate that faults with text in it.
 *   • `hidden: true` / a holding expression / a holding CEL envelope → STILL
 *     hidden. Anti-mutation guards: "never hide anything" satisfies most of this
 *     file on its own, and these refuse it.
 *   • `hidden: false` → still rendered, and the key is not forwarded as a DOM
 *     prop (it is stripped in the destructure below `evaluatedSchema`), so "not
 *     hidden" cannot be confused with "hidden={false} reached the component".
 *   • precedence, both directions: an UNDECLARED `hidden` no longer
 *     short-circuits, so a declared `hiddenOn` is finally consulted — and a
 *     DECLARED `hidden` still wins over `hiddenOn`, which is the case that would
 *     stay green if someone "fixed" the defect by deleting the `hidden` leg.
 *   • the `visible*` legs still come FIRST and still keep `!== undefined`: their
 *     alias precedence is load-bearing and their `true` is benign (objectui#3850's
 *     ruling fenced them off deliberately).
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Restoring `newSchema.hidden !== undefined` / `hiddenOn !== undefined` must turn
 * RED exactly: every empty-shape case on both keys, and the
 * "undeclared `hidden` falls through to `hiddenOn`" precedence case (whose
 * `hiddenOn: false` becomes unreachable). Every `true` / `false` / expression /
 * envelope / `visible*` case stays GREEN — the change can only stop hiding a
 * node, never start.
 *
 * Reverting the objectui#3960 half alone (envelope blankness) turns RED only the
 * two blank-`source` rows on each key. Deleting either leg outright turns RED the
 * "a DECLARED `hidden` wins" case, which no other case here would catch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { BaseSchema, DataSource } from '@object-ui/types';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';
import { __resetVisibilityPredicateWarnings } from '../utils/visibilityDiagnostic';

/**
 * This file's registered probe, declared to `@object-ui/types` the way an
 * application declares a type it registers (objectui#11466): a node slot and
 * the `schema` prop take the declared node types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'probe-3955': BaseSchema;
  }
}

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
 * Records the `hidden` prop exactly as it arrives, so "the node rendered" and
 * "the schema key leaked into the DOM props" are separate observations.
 */
const Probe = (props: { hidden?: unknown }) => (
  <div
    data-testid="probe"
    data-hidden-prop={props.hidden === undefined ? 'absent' : String(props.hidden)}
  />
);

const DATA = { status: 'draft', archived: true, published: false };

function renderNode(schema: Record<string, unknown>) {
  return render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA as unknown as DataSource }}>
      <SchemaRenderer schema={{ type: 'probe-3955', ...schema } as never} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
  );
}

/**
 * The DECLARED path -- no cast at all.
 *
 * `renderNode` above spreads a `Record<string, unknown>` through `as never`
 * because most of this file exercises shapes `BaseSchema` does not declare and
 * should not: `null`, `0`, `[]`, `{}`, and the EMPTY envelopes. Those keep the
 * cast.
 *
 * The STRING form is different since objectui#7455 (ruled 2026-09-03):
 * `hidden` is declared `boolean | string`, so an expression-valued `hidden` is
 * authorable and the compiler is the right checker for it. Narrowing `hidden`
 * back to `boolean` makes the call sites below TS2322 -- and `tsc -p
 * tsconfig.test.json` (chained from this package's `type-check` script) is the
 * only thing that can see that; vitest cannot, because the annotation is erased
 * before a single case runs.
 *
 * The CEL ENVELOPE is declared too since objectui#7530 (ruled 2026-09-04,
 * option A, on all three keys at once): `hidden` is `boolean | ExpressionWire`,
 * where `ExpressionWire` is the string-or-envelope union `visibleWhen` already
 * carried, so the non-empty envelope pin below runs through this helper as
 * well. That its verdict is IDENTICAL to the string form's, on all three keys
 * and in both polarities, is `SchemaRenderer.predicateEnvelopeDeclared.test.tsx`.
 */
function renderDeclaredNode(schema: BaseSchema & { type: 'probe-3955' }) {
  return render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA as unknown as DataSource }}>
      <SchemaRenderer schema={schema} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
  );
}

/** Did the node render at all? */
function rendered(): boolean {
  return screen.queryByTestId('probe') !== null;
}

const EMPTY_SHAPES: Array<{ label: string; value: unknown }> = [
  { label: "'' (empty predicate)", value: '' },
  { label: 'null', value: null },
  { label: "'   ' (whitespace only)", value: '   ' },
  { label: "{ dialect: 'cel', source: '' } (what `objectstack build` emits)", value: { dialect: 'cel', source: '' } },
  { label: "{ source: '' } (envelope without a dialect)", value: { source: '' } },
  // objectui#3960's fourth spelling, arriving through the same shared definition.
  { label: "{ dialect: 'cel', source: '   ' } (blank source — objectui#3960)", value: { dialect: 'cel', source: '   ' } },
  { label: "{ source: '   ' } (blank source, no dialect)", value: { source: '   ' } },
];

const JUNK_SHAPES: Array<{ label: string; value: unknown }> = [
  { label: '0', value: 0 },
  { label: '{} (no source)', value: {} },
  { label: '[] (array)', value: [] },
  { label: "{ dialect: 'cel', ast } (an `ast`-only envelope)", value: { dialect: 'cel', ast: { kind: 'call', fn: '==' } } },
];

describe('SchemaRenderer `hidden` — an empty predicate is not a declared gate (objectui#3955)', () => {
  beforeEach(() => {
    ComponentRegistry.register('probe-3955', Probe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('probe-3955');
  });

  it.each(EMPTY_SHAPES)('hidden: $label → the node renders', ({ value }) => {
    renderNode({ hidden: value });
    expect(rendered()).toBe(true);
  });

  it.each(EMPTY_SHAPES)('hiddenOn: $label → the node renders too (the alias reads the same definition)', ({ value }) => {
    renderNode({ hiddenOn: value });
    expect(rendered()).toBe(true);
  });

  it.each(JUNK_SHAPES)('hidden: $label (declared, not evaluable — objectui#11358) → hidden, reported once', ({ value }) => {
    // A fresh node id per row: the unresolvable-predicate report dedupes per
    // node and key, so a shared id would carry one row's report into the next.
    const id = `probe-11358-${JUNK_SHAPES.findIndex((r) => r.value === value)}`;
    // The report dedupes on (type, key, predicate text), and an object with no
    // `source` prints as one text — so each row starts from a clean dedupe.
    __resetVisibilityPredicateWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderNode({ id, hidden: value });
      expect(rendered()).toBe(false);
      const lines = warn.mock.calls.map((c) => c.map(String).join(' '));
      expect(lines.filter((l) => l.includes('[unevaluable]'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('hidden: true → still hidden; hidden: false → still rendered, with no `hidden` prop forwarded', () => {
    const { unmount } = renderNode({ hidden: true });
    expect(rendered()).toBe(false);
    unmount();
    renderNode({ hidden: false });
    expect(rendered()).toBe(true);
    // The schema key is metadata, not a DOM prop — it is stripped in the
    // destructure, so a rendered node must not also carry `hidden={false}`.
    expect(screen.getByTestId('probe')).toHaveAttribute('data-hidden-prop', 'absent');
  });

  it('hiddenOn: true → still hidden; hiddenOn: false → still rendered', () => {
    const { unmount } = renderNode({ hiddenOn: true });
    expect(rendered()).toBe(false);
    unmount();
    renderNode({ hiddenOn: false });
    expect(rendered()).toBe(true);
  });

  it('an expression-valued `hidden` keeps its verdict, both ways -- through the DECLARED path, no cast (objectui#7455)', () => {
    const { unmount } = renderDeclaredNode({ type: 'probe-3955', hidden: '${data.status === "draft"}' });
    expect(rendered()).toBe(false);
    unmount();
    renderDeclaredNode({ type: 'probe-3955', hidden: '${data.published}' });
    expect(rendered()).toBe(true);
  });

  it('a non-empty CEL envelope keeps its verdict, both ways -- through the DECLARED path, no cast (objectui#7530)', () => {
    const { unmount } = renderDeclaredNode({ type: 'probe-3955', hidden: { dialect: 'cel', source: 'true' } });
    expect(rendered()).toBe(false);
    unmount();
    renderDeclaredNode({ type: 'probe-3955', hidden: { dialect: 'cel', source: 'false' } });
    expect(rendered()).toBe(true);
  });

  it('an expression-valued `hiddenOn` keeps its verdict', () => {
    renderNode({ hiddenOn: '${data.archived}' });
    expect(rendered()).toBe(false);
  });

  it('a blank source is "no gate", but one significant character is a predicate', () => {
    // Blankness is `trim()`, not "short": the same envelope with real text in it
    // still hides, so the empty rows above are not passing because envelopes
    // stopped being read.
    renderNode({ hidden: { dialect: 'cel', source: '  true  ' } });
    expect(rendered()).toBe(false);
  });
});

describe('SchemaRenderer `hidden` chain precedence (objectui#3955)', () => {
  beforeEach(() => {
    ComponentRegistry.register('probe-3955', Probe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('probe-3955');
  });

  it('an UNDECLARED `hidden` no longer short-circuits — a declared `hiddenOn` is consulted', () => {
    // Before: `'' !== undefined` won the chain, `evaluateCondition('')` was
    // `true`, and the node vanished for a reason no key stated — `hiddenOn: false`
    // was unreachable. This is a behaviour change (alias precedence), pinned as
    // such rather than claimed as an equivalence.
    renderNode({ hidden: '', hiddenOn: false });
    expect(rendered()).toBe(true);
  });

  it('… and in the other direction: an undeclared `hidden` lets a HOLDING `hiddenOn` hide', () => {
    renderNode({ hidden: { dialect: 'cel', source: '' }, hiddenOn: '${data.archived}' });
    expect(rendered()).toBe(false);
  });

  it('a DECLARED `hidden` still wins over `hiddenOn`', () => {
    // The case that stays green if someone "fixes" the defect by deleting the
    // `hidden` leg: with the leg gone, `hiddenOn: false` would render the node.
    renderNode({ hidden: true, hiddenOn: false });
    expect(rendered()).toBe(false);
  });

  it('the `visible*` legs still come first and still keep `!== undefined`', () => {
    // objectui#3850's ruling fenced them off: their `true` is negated, so an empty
    // predicate already means "shown", and narrowing them would only change alias
    // precedence. `visible: false` therefore beats an empty `hidden`…
    const { unmount } = renderNode({ visible: false, hidden: '' });
    expect(rendered()).toBe(false);
    unmount();
    // …and an EMPTY `visible` still wins the chain outright, so a declared
    // `hidden: true` behind it is never consulted.
    renderNode({ visible: '', hidden: true });
    expect(rendered()).toBe(true);
  });
});
