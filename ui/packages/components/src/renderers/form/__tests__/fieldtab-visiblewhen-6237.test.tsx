/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6237 — the tabbed arm of the grouping contract (same maintainer
 * ruling as objectui#6236, 2026-08-27).
 *
 * `FormFieldTab.visibleWhen` is the tab's predicate slot: a section rendered
 * as a tab panel can carry the same authored `FormSection.visibleWhen` a
 * stacked section carries on its `section-divider`. The renderer evaluates it
 * with the live record and the host predicate scope (#6010) and, when FALSE,
 * draws neither the tab's trigger nor its panel — which unmounts the claimed
 * fields through the exact mechanism a field's own false predicate uses. The
 * ruled semantics follow, pinned case by case below:
 *
 *   1. Visibility decides what is DRAWN and nothing else — a hidden tab's
 *      values still submit.
 *   2. A hidden tab's fields SKIP client-side validation — a user must never
 *      be blocked by an error pointing at a control they cannot see. The
 *      server-side contract remains the loud floor (#2959's trap, answered by
 *      the ruling: the 400 for a genuinely-required field on a hidden tab is
 *      the server's to raise, loudly, not the client's to raise invisibly).
 *   3. The ARM decision stays structural: whether the tabbed layout engages is
 *      judged on the DECLARED tabs, so a predicate hiding one of two tabs
 *      filters the strip instead of collapsing the layout mid-interaction.
 *   4. A predicate hiding the ACTIVE tab re-selects deterministically (pick →
 *      declared default → first visible) — never an empty panel — and the
 *      user's pick is restored when its tab is re-admitted.
 *
 * ## Why the DENIED rows assert trigger AND panel AND member
 *
 * `visibleWhen` fails OPEN, so a tab that renders is the outcome of three
 * worlds (TRUE / never arrived / faulted) and a SHOWN assertion distinguishes
 * none of them. The DENIED rows are the deliverable; ALLOWED and FAULTED are
 * the controls that keep "hidden" meaning "evaluated and false".
 *
 * ## Reverse verification (run 2026-08-27, direction predicted BEFORE running)
 *
 * Neutralising the verdict collection in `hiddenFieldTabKeys` (form.tsx) went
 * 8 red / 4 green, exactly the predicted rows: the DENIED rows red in the
 * SHOWN direction (trigger, panel and members come back), the validation rows
 * red in the BLOCKED direction (the hidden required field refuses the submit
 * again), the re-selection / collapse / all-hidden rows red with the gated tab
 * still drawn — and the values-still-submit row red through its drawn
 * precondition (`member(/salary/i)` is null only while the gate works; the
 * submitted VALUE itself comes from react-hook-form keeping unmounted values,
 * which the revert does not touch). Every ALLOWED/FAULTED/compat control
 * stayed green, which is what lets the DENIED rows mean "evaluated and false".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider } from '@object-ui/react';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';

/**
 * The canonical wire shape — `@objectstack/spec` normalizes an authored
 * predicate into a `{ dialect: 'cel' }` envelope at parse (ADR-0089 D2). Same
 * spelling as section-grouping-6236 / predicate-scope-parity-6010, on purpose:
 * one authored text, one verdict, every surface.
 */
const cel = (source: string) => ({ dialect: 'cel', source });

/** THE authored tab predicate. */
const GATE = cel("'sales_manager' in current_user.positions");

/** A root NOTHING binds — "faulted" must be unambiguous. */
const UNBOUND_ROOT = cel("'sales_manager' in no_such_root.positions");

/**
 * The host scope `ExpressionProvider` mounts, transcribed (see #6010's pin).
 *
 * ⛔ No `data` since objectui#8166, and no `app` since objectui#8155 — this
 * literal claims to be that bag, so a root it carries that the producer does
 * not bind is a false claim that no assertion here would redden.
 */
function hostScope(positions: string[]) {
  const user = { id: 'u1', name: 'Kim', positions };
  return { current_user: user, user, ctx: { user }, os: { user }, features: {} };
}

const DENIED = hostScope(['sales']);
const ALLOWED = hostScope(['sales_manager']);

function renderForm(schema: Record<string, unknown>, scope: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <PredicateScopeProvider scope={scope}>
      <Form schema={{ type: 'form', showSubmit: false, showCancel: false, ...schema }} />
    </PredicateScopeProvider>,
  );
}

/**
 * One unclaimed field (`title` — proves the form rendered at all and pins that
 * a hidden tab's claims do NOT leak into the leading unclaimed block), one
 * plain tab, one gated tab claiming two members. `'ghost'` in the claim pins
 * FormFieldTab's existing contract: unknown claimed names are ignored.
 */
const FIELDS = (salaryExtra: Record<string, unknown> = {}) => [
  { name: 'title', label: 'Title', type: 'input' },
  { name: 'subject', label: 'Subject', type: 'input' },
  { name: 'salary', label: 'Salary', type: 'input', ...salaryExtra },
  { name: 'bonus', label: 'Bonus', type: 'input' },
];

const TABS = (gate: unknown) => [
  { key: 'basics', label: 'Basics', fields: ['subject'] },
  { key: 'pay', label: 'Compensation', fields: ['salary', 'bonus', 'ghost'], visibleWhen: gate },
];

const trigger = () => screen.queryByRole('tab', { name: /compensation/i });
const panel = () => screen.queryByTestId('form-tab-panel:pay');
const member = (re: RegExp) => screen.queryByLabelText(re);
const submitBtn = () => screen.getByRole('button', { name: /save/i });

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('#6237 — a tab predicate gates the whole tab', () => {
  it('DENIED: trigger, panel and every claimed field are hidden (control tab stays)', () => {
    renderForm({ fields: FIELDS(), fieldTabs: TABS(GATE) }, DENIED);
    // The form rendered: unclaimed control field and the un-gated tab.
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /basics/i })).toBeInTheDocument();
    // The gated tab is gone in all three shapes.
    expect(trigger()).toBeNull();
    expect(panel()).toBeNull();
    expect(member(/salary/i)).toBeNull();
    expect(member(/bonus/i)).toBeNull();
  });

  it('DENIED: the hidden tab\'s claims do not leak into the unclaimed leading block', () => {
    renderForm({ fields: FIELDS(), fieldTabs: TABS(GATE) }, DENIED);
    // `title` is the only unclaimed field; if the hidden tab's claims were
    // treated as unclaimed, salary/bonus would render beside it.
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(member(/salary/i)).toBeNull();
  });

  it('ALLOWED: the SAME predicate text, a user it admits — trigger, panel and fields render', () => {
    renderForm({ fields: FIELDS(), fieldTabs: TABS(GATE) }, ALLOWED);
    expect(trigger()).not.toBeNull();
    expect(panel()).not.toBeNull();
    expect(member(/salary/i)).not.toBeNull();
    expect(member(/bonus/i)).not.toBeNull();
  });

  it('FAULTED: a genuinely unbound root fails OPEN — the tab renders', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderForm({ fields: FIELDS(), fieldTabs: TABS(UNBOUND_ROOT) }, DENIED);
    expect(trigger()).not.toBeNull();
    expect(panel()).not.toBeNull();
    expect(member(/salary/i)).not.toBeNull();
  });

  it('a hidden tab\'s values STILL SUBMIT — visibility decides what is drawn and nothing else', async () => {
    const onSubmit = vi.fn();
    renderForm(
      {
        fields: FIELDS(),
        fieldTabs: TABS(GATE),
        defaultValues: { salary: '120000' },
        showSubmit: true,
        submitLabel: 'Save',
        onSubmit,
      },
      DENIED,
    );
    // The claimed field is genuinely not drawn — the value below cannot have
    // come from a rendered control.
    expect(member(/salary/i)).toBeNull();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect((onSubmit.mock.calls[0][0] as Record<string, unknown>).salary).toBe('120000');
  });

  it('a REQUIRED field on a hidden tab does not block the submit (client validation skipped)', async () => {
    const onSubmit = vi.fn();
    renderForm(
      {
        fields: FIELDS({ required: true }),
        fieldTabs: TABS(GATE),
        showSubmit: true,
        submitLabel: 'Save',
        onSubmit,
      },
      DENIED,
    );
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(document.body.textContent).not.toMatch(/required/i);
  });

  it('control: the SAME required field on a VISIBLE (even inactive) tab still blocks the submit', async () => {
    const onSubmit = vi.fn();
    renderForm(
      {
        fields: FIELDS({ required: true }),
        fieldTabs: TABS(GATE),
        showSubmit: true,
        submitLabel: 'Save',
        onSubmit,
      },
      ALLOWED,
    );
    // `pay` is visible but NOT active — #2959's force-mount is what makes its
    // rule count; this is the boundary the hidden-tab row above crosses.
    fireEvent.click(submitBtn());
    await waitFor(() => expect(document.body.textContent).toMatch(/required/i));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a tab hiding mid-session clears its members\' stale errors and unblocks the submit', async () => {
    const onSubmit = vi.fn();
    renderForm(
      {
        fields: [
          { name: 'plan', label: 'Plan', type: 'input' },
          { name: 'salary', label: 'Salary', type: 'input', required: true },
        ],
        fieldTabs: [
          { key: 'basics', label: 'Basics', fields: ['plan'] },
          {
            key: 'pay',
            label: 'Compensation',
            fields: ['salary'],
            visibleWhen: cel("record.plan == 'standard'"),
          },
        ],
        defaultValues: { plan: 'standard' },
        showSubmit: true,
        submitLabel: 'Save',
        onSubmit,
      },
      ALLOWED,
    );
    // Tab visible, required member empty → the submit is refused. This also
    // registers the member's validator, so the second half proves an
    // already-registered rule is skipped once the tab hides — the stronger
    // direction (a never-mounted member skips trivially).
    expect(member(/salary/i)).not.toBeNull();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(document.body.textContent).toMatch(/required/i));
    expect(onSubmit).not.toHaveBeenCalled();
    // Flip the gating value → the tab (and its member) leave the screen, the
    // stale required-error clears, and the submit goes through.
    fireEvent.change(screen.getByLabelText(/plan/i), { target: { value: 'exec' } });
    await waitFor(() => expect(panel()).toBeNull());
    await waitFor(() => expect(document.body.textContent).not.toMatch(/required/i));
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('re-selection: hiding the ACTIVE tab activates the first visible tab — never an empty panel — and the pick is restored on re-admission', async () => {
    renderForm(
      {
        fields: [
          { name: 'plan', label: 'Plan', type: 'input' },
          { name: 'salary', label: 'Salary', type: 'input' },
        ],
        fieldTabs: [
          { key: 'basics', label: 'Basics', fields: ['plan'] },
          {
            key: 'pay',
            label: 'Compensation',
            fields: ['salary'],
            visibleWhen: cel("record.plan == 'standard'"),
          },
        ],
        defaultValues: { plan: 'standard' },
      },
      ALLOWED,
    );
    // The user picks the gated tab and types into it. (Radix activates a
    // trigger on mousedown, so a bare `click` would not switch tabs here.)
    fireEvent.mouseDown(screen.getByRole('tab', { name: /compensation/i }));
    await waitFor(() =>
      expect(screen.getByTestId('form-tab-panel:pay')).toHaveAttribute('data-state', 'active'),
    );
    fireEvent.change(screen.getByLabelText(/salary/i), { target: { value: '120000' } });
    // A keystroke on the OTHER tab's field flips the predicate: the active tab
    // hides and selection falls to the first visible tab.
    fireEvent.change(screen.getByLabelText(/plan/i), { target: { value: 'exec' } });
    await waitFor(() => expect(panel()).toBeNull());
    expect(screen.getByTestId('form-tab-panel:basics')).toHaveAttribute('data-state', 'active');
    // Flip back: the tab returns, the USER'S PICK wins again, and the value
    // survived the unmount round-trip (visibility never touched the data).
    fireEvent.change(screen.getByLabelText(/plan/i), { target: { value: 'standard' } });
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(screen.getByTestId('form-tab-panel:pay')).toHaveAttribute('data-state', 'active');
    expect((screen.getByLabelText(/salary/i) as HTMLInputElement).value).toBe('120000');
  });

  it('the arm does NOT collapse: one of two tabs hidden keeps the strip (structural decision, declared tabs)', () => {
    renderForm({ fields: FIELDS(), fieldTabs: TABS(GATE) }, DENIED);
    // Still the tabbed layout: a tablist with the surviving trigger — not the
    // flat untabbed rendering (which would draw salary/bonus).
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByTestId('form-tab-panel:basics')).toBeInTheDocument();
    expect(member(/salary/i)).toBeNull();
  });

  it('every tab hidden: no strip at all, unclaimed fields still render', () => {
    renderForm(
      {
        fields: FIELDS(),
        fieldTabs: [
          { key: 'basics', label: 'Basics', fields: ['subject'], visibleWhen: GATE },
          { key: 'pay', label: 'Compensation', fields: ['salary', 'bonus'], visibleWhen: GATE },
        ],
      },
      DENIED,
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(member(/subject/i)).toBeNull();
    expect(member(/salary/i)).toBeNull();
  });

  it('compat: a tab WITHOUT the predicate slot keeps the pre-#6237 contract (always drawn)', () => {
    renderForm(
      {
        fields: FIELDS(),
        fieldTabs: [
          { key: 'basics', label: 'Basics', fields: ['subject'] },
          { key: 'pay', label: 'Compensation', fields: ['salary', 'bonus'] },
        ],
      },
      DENIED,
    );
    expect(trigger()).not.toBeNull();
    expect(panel()).not.toBeNull();
    expect(member(/salary/i)).not.toBeNull();
  });
});
