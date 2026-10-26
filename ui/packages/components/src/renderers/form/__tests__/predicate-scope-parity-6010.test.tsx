/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6010 — ONE authored `visibleWhen` text, every binding surface, one
 * verdict.
 *
 * The three surfaces ADR-0068 D1 names are page/app-nav, per-option, and form
 * section/field; the table below runs five rows, because "form section/field"
 * is two declarations sharing one call site and because the deprecated
 * `visibleOn` alias is the same key by ADR-0089 D2 and must not become a sixth
 * spelling with a scope of its own.
 *
 * ADR-0068 D1 states the contract this file pins: *"a predicate authored
 * against any one form evaluates identically"* — `current_user` (plus the
 * `user` / `ctx.user` / `os.user` aliases) is the canonical identity root on
 * every runtime record surface, and ADR-0089 D1 repeats it from the naming
 * side (*"runtime record surfaces bind `record` + `current_user`"*).
 *
 * It was true on two surfaces and false on the third. `ExpressionProvider`
 * builds the scope; `SchemaRenderer` consumed it for a page/app-nav node, and
 * `form.tsx` forwarded it to `resolveCascadingOptions` for per-option
 * `visibleWhen` — but every `resolveFieldRuleState` call passed `undefined`,
 * so a form SECTION or FIELD predicate saw `record` and `previous` and nothing
 * else. `'sales_manager' in current_user.positions` therefore named an UNBOUND
 * root there, and `resolveFieldRuleState` passes `true` as the visibility
 * fallback — so the gate did not hide the field from the people it named, it
 * showed the field to EVERYONE. Fail-open in the dangerous direction, silent
 * except for one deduped console line.
 *
 * ## Why a parity file and not three per-surface assertions
 *
 * The defect exists precisely because two of three surfaces got the scope and
 * one did not. No pin that looks at a single surface can express "they agree";
 * only a table that runs the SAME predicate text through all of them can. That
 * is the deliverable here — the argument change in `form.tsx` is not.
 *
 * ## The three cases, and why the second one is the important one
 *
 * Each surface is asked the same three questions:
 *
 *   1. **DENIED** — the predicate evaluates and resolves FALSE ⇒ hidden.
 *   2. **ALLOWED** — the same predicate text, a user it admits ⇒ still SHOWN.
 *      This is the counter-probe, and it is the half that matters: "the
 *      predicate is now evaluated" is otherwise satisfiable by hiding
 *      everything, which is a worse bug than fail-open and is completely
 *      invisible to case 1 on its own.
 *   3. **FAULTED** — a predicate naming a genuinely unbound root ⇒ still
 *      SHOWN. Fail-open is EXISTING behaviour that #6010 does not change, and
 *      pinning it is what keeps case 1 meaningful: without it, "hidden" and
 *      "the root is not bound" are the same observation. With it, the file
 *      distinguishes *evaluated-and-false* from *faulted*.
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 * Revert the `scope` argument on ONE of the three `resolveFieldRuleState` call
 * sites and the DENIED row for that surface — and only that surface — goes
 * red, in the SHOWN direction (the element starts rendering again), because
 * the fallback is fail-open. The ALLOWED and FAULTED rows stay green
 * everywhere, on every surface, which is exactly why case 1 alone would not
 * have caught the regression's shape.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, PredicateScopeProvider } from '@object-ui/react';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';

/**
 * The canonical wire shape. `@objectstack/spec` normalizes an authored
 * `visibleWhen` into a `{ dialect: 'cel' }` envelope at parse (ADR-0089 D2), so
 * this is what every surface actually receives in production.
 *
 * ⚠️ It is also the only shape in which this comparison is about the SCOPE.
 * Measured while writing this file: a BARE STRING carrying the CEL membership
 * operator is not portable across the surfaces, and for a reason that has
 * nothing to do with `current_user`. The form renderer treats a bare string as
 * CEL (`fieldRules.ts`'s `toExpression` defaults `dialect` to `'cel'`), while
 * `SchemaRenderer` routes it to the LEGACY expression engine, which has no `in`
 * operator and rejects it — *"Unexpected token \"i\" at position 16"* — then
 * fails open. Pinning the bare string here would therefore have compared two
 * dialects and read the difference as a scope difference. Dual-dialect routing
 * is existing, documented behaviour on the node gate; it is not #6010 and is
 * deliberately not touched.
 */
const cel = (source: string) => ({ dialect: 'cel', source });

/** THE authored predicate. One text, asked of every surface below. */
const GATE = cel("'sales_manager' in current_user.positions");

/**
 * A predicate whose root NOTHING binds — not the form, not the host scope.
 * Deliberately not a typo of `current_user`: the point is a root that is
 * genuinely absent on every surface, so "faulted" is unambiguous.
 */
const UNBOUND_ROOT = cel("'sales_manager' in no_such_root.positions");

/**
 * The scope `buildExpressionScope` (`packages/app-shell/src/providers/
 * ExpressionProvider.tsx`) really mounts, transcribed rather than imported:
 * `@object-ui/app-shell` depends on `@object-ui/components`, so importing it
 * from here would invert the dependency. Anchored by SYMBOL rather than by the
 * `:59,70` line pair it used to name, which had already drifted.
 *
 * ⛔ No `data` (objectui#8166) and no `app` (objectui#8155). A transcription
 * cannot disagree with its producer, so it absorbs the producer's drift
 * silently — a root left here that the real bag no longer binds would keep
 * every assertion below green while describing a scope that does not exist.
 * The aliases are not decoration — `SchemaRenderer` re-derives
 * `current_user` from `scope.user`, so a scope carrying only `current_user`
 * would gate correctly on the two form surfaces and NOT on the page one, which
 * is the very asymmetry this file exists to refuse.
 */
function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, features: {} };
}

const DENIED = hostScope(['sales']);
const ALLOWED = hostScope(['sales_manager']);

// --- surface 1: page component / app-nav node ------------------------------

const PROBE_NAME = 'probe-6010';
const PROBE_TYPE = 'element:probe-6010';
ComponentRegistry.register(
  PROBE_NAME,
  (() => <div data-testid="probe-6010" />) as never,
  { namespace: 'element', skipFallback: true } as never,
);

function pageSurface(predicate: unknown, scope: Record<string, unknown>): boolean {
  render(
    <PredicateScopeProvider scope={scope}>
      <SchemaRenderer schema={{ type: PROBE_TYPE, visibleWhen: predicate } as never} />
    </PredicateScopeProvider>,
  );
  return screen.queryByTestId('probe-6010') !== null;
}

// --- surfaces 2-4: the form renderer ---------------------------------------

function renderForm(schema: Record<string, unknown>, scope: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <PredicateScopeProvider scope={scope}>
      <Form schema={{ type: 'form', showSubmit: false, showCancel: false, ...schema }} />
    </PredicateScopeProvider>,
  );
}

/**
 * Per-option `visibleWhen`, read through the form's OWN cascade clear (#2284 /
 * #4247): an option the resolved set no longer offers has its stored value
 * dropped before submit. Asserting the payload rather than opening the picker
 * keeps this observable without driving a Radix listbox through synthetic DOM
 * events, and it reads the same `resolveCascadingOptions(…, predicateScope)`
 * call the render path uses.
 */
async function optionSurface(predicate: unknown, scope: Record<string, unknown>): Promise<boolean> {
  const onSubmit = vi.fn();
  renderForm(
    {
      showSubmit: true,
      submitLabel: 'Save',
      fields: [
        {
          name: 'tier',
          label: 'Tier',
          type: 'select',
          options: [
            { label: 'Standard', value: 'std' },
            { label: 'Manager only', value: 'mgr', visibleWhen: predicate },
          ],
        },
      ],
      defaultValues: { tier: 'mgr' },
      onSubmit,
    },
    scope,
  );
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return (onSubmit.mock.calls[0][0] as Record<string, unknown>).tier === 'mgr';
}

/** Form FIELD `visibleWhen` — the `renderFormField` call site. */
function fieldSurface(predicate: unknown, scope: Record<string, unknown>): boolean {
  renderForm(
    {
      fields: [
        { name: 'title', label: 'Title', type: 'input' },
        { name: 'salary', label: 'Salary', type: 'input', visibleWhen: predicate },
      ],
    },
    scope,
  );
  // Paired control: the un-gated sibling proves the form rendered at all, so a
  // missing `salary` is a verdict and not an inability.
  expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  return screen.queryByLabelText(/salary/i) !== null;
}

/**
 * Form SECTION `visibleWhen` — the same call site, `type: 'section-divider'`.
 *
 * Since objectui#6236 the divider carries a membership claim (`fields`) and
 * its predicate gates the WHOLE group, so this row asserts the two halves
 * cannot disagree — heading and claimed member move together — and returns
 * their shared verdict. (Until #6236 it asserted only the heading; the group
 * semantics themselves are pinned in section-grouping-6236.test.tsx.)
 */
function sectionSurface(predicate: unknown, scope: Record<string, unknown>): boolean {
  renderForm(
    {
      fields: [
        { name: 'title', label: 'Title', type: 'input' },
        {
          name: 'pay',
          label: 'Compensation',
          type: 'section-divider',
          visibleWhen: predicate,
          fields: ['salary'],
        },
        { name: 'salary', label: 'Salary', type: 'input' },
      ],
    },
    scope,
  );
  expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  const headingShown = screen.queryByText('Compensation') !== null;
  const memberShown = screen.queryByLabelText(/salary/i) !== null;
  expect(memberShown).toBe(headingShown);
  return headingShown;
}

/**
 * The deprecated `visibleOn` spelling of the very same key. ADR-0089 D2 folds
 * it into `visibleWhen` at parse, so a renderer that binds one scope for the
 * canonical spelling and another for the alias reaches two verdicts for one
 * authored rule — the #6010 defect at a smaller scale.
 */
function fieldVisibleOnSurface(predicate: unknown, scope: Record<string, unknown>): boolean {
  renderForm(
    {
      fields: [
        { name: 'title', label: 'Title', type: 'input' },
        { name: 'salary', label: 'Salary', type: 'input', visibleOn: predicate },
      ],
    },
    scope,
  );
  expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  return screen.queryByLabelText(/salary/i) !== null;
}

type Surface = {
  label: string;
  show: (predicate: unknown, scope: Record<string, unknown>) => boolean | Promise<boolean>;
  /**
   * What a FAULTING predicate answers on this surface. The page node gate
   * fails CLOSED since objectui#13299; the form rules keep their fail-open.
   */
  shownOnFault: boolean;
};

const SURFACES: Surface[] = [
  { label: 'page component / app-nav node `visibleWhen`', show: pageSurface, shownOnFault: false },
  { label: 'per-option `visibleWhen` (select options)', show: optionSurface, shownOnFault: true },
  { label: 'form SECTION `visibleWhen`', show: sectionSurface, shownOnFault: true },
  { label: 'form FIELD `visibleWhen`', show: fieldSurface, shownOnFault: true },
  { label: 'form FIELD `visibleOn` (ADR-0089 D2 alias)', show: fieldVisibleOnSurface, shownOnFault: true },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('#6010 — `current_user` binds identically on every `visibleWhen` surface', () => {
  describe('DENIED — the predicate evaluates and resolves FALSE, so the element hides', () => {
    for (const surface of SURFACES) {
      it(surface.label, async () => {
        expect(await surface.show(GATE, DENIED)).toBe(false);
      });
    }
  });

  describe('ALLOWED — the SAME predicate text, a user it admits, still renders', () => {
    // The counter-probe. Without it, "hides for a denied user" is satisfied by
    // a renderer that hides unconditionally.
    for (const surface of SURFACES) {
      it(surface.label, async () => {
        expect(await surface.show(GATE, ALLOWED)).toBe(true);
      });
    }
  });

  describe('FAULTED — a genuinely unbound root: the form rules fail OPEN, the page node fails CLOSED (objectui#13299)', () => {
    // Existing behaviour, pinned so the DENIED rows above mean "evaluated and
    // false" rather than "could not be evaluated". Asserted against the DENIED
    // user on purpose: the only difference from the DENIED block is the ROOT
    // the predicate names, so a fail-CLOSED regression on a form rule cannot
    // hide behind the membership. The page node is the exception, by ruling:
    // it fails CLOSED since objectui#13299.
    for (const surface of SURFACES) {
      it(surface.label, async () => {
        // Fail-open is loud (#5149 / #5454 leg 3) — the warning is another
        // surface's contract, and silencing it here keeps this file about the
        // verdict.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await surface.show(UNBOUND_ROOT, DENIED)).toBe(surface.shownOnFault);
      });
    }
  });
});
