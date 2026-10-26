// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8488 — what `InspectorSelectField`'s trigger renders for a stored
 * value the option roster does NOT offer.
 *
 * Radix renders a controlled value matching no `SelectItem` as nothing at all,
 * so such a value used to paint a BLANK trigger — pixel-identical to "this
 * field is unset". The author sees an empty control, picks a value to fill it
 * in, and silently overwrites a key they were never shown.
 *
 * Eight call sites had hand-rolled it. THREE flagged the synthesised row, in
 * three wordings: `ActionTargetField` ("(not found)"), `ViewColumnInspector`'s
 * field picker ("(not in object)") and `FlowNodeConfigField`'s select branch
 * ("(deprecated)", framework#4278 / ADR-0090 D3). The other FIVE —
 * `ReportDefaultInspector`'s type, dataset and both chart axes, and
 * `ViewVariantInspector`'s type — appended the raw value with NO marker, which
 * is the refused direction: it makes "stored" and "offered" the same picture.
 * The rule is the primitive's now; only the wording stayed with the call site,
 * through `unknownValueLabel`.
 *
 * ## What these cases assert, and why it is the trigger text
 *
 * The pin reads the RENDERED TRIGGER, never `options.length` or the synthesised
 * entry's presence in some array. An implementation that appends the row but
 * fails to surface it — the exact shape of the original bug, since Radix's
 * blank trigger coexisted with a perfectly good `value` prop — passes an
 * options-array assertion and fails these.
 *
 * ## ⛔ The placeholder is not the repair (the "empty ≠ unknown" pin)
 *
 * `unknown value renders differently from an empty one` is the case that fails
 * on the tempting wrong fix: papering the unknown value over with `placeholder`
 * would assert "nothing is stored" about a field that IS storing something —
 * confidently wrong rather than merely blank. objectui#8450 owns the empty
 * half (empty draws the placeholder) and it must keep owning it, so the two
 * states are read side by side here rather than one at a time.
 *
 * ## Boundary, measured here and CLOSED by objectui#8862
 *
 * This suite was written while the primitive could not tell "roster is empty"
 * from "roster has not loaded yet", so a valid value briefly wore the flag
 * while an async picker was still fetching. objectui#8862 gave it the missing
 * term (`loading`); the tri-state that replaced the blind spot is pinned in
 * `_shared.rosterPending.test.tsx`, and every case below is the ANSWERED arm of
 * it — no case here passes `loading`, which is what keeps them reading the
 * settled roster they were written about.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InspectorSelectField } from './_shared';

afterEach(cleanup);

const OPTIONS = [
  { value: 'profile', label: 'Profile' },
  { value: 'meta', label: 'Metadata' },
];

/** The trigger Radix renders — `button[role=combobox]`, named by the `<Label>`. */
function trigger(name = 'Group'): HTMLElement {
  const el = screen.queryByRole('combobox', { name });
  expect(el, `a combobox named "${name}" is rendered at all`).not.toBeNull();
  return el as HTMLElement;
}

describe('InspectorSelectField — a stored value the roster does not offer (objectui#8488)', () => {
  it('renders the value itself, flagged, instead of a blank trigger', () => {
    render(
      <InspectorSelectField label="Group" value="retired_group" options={OPTIONS} onCommit={vi.fn()} />,
    );
    expect(
      trigger().textContent,
      'the stale value is legible on the trigger and marked as not offered',
    ).toBe('retired_group (not found)');
  });

  it('renders an unknown value DIFFERENTLY from an empty one — neither impersonates the other', () => {
    // The two states side by side. A repair that draws the placeholder for an
    // unknown value collapses them, and asserts "nothing is stored" about a
    // field that is storing `retired_group`.
    const { rerender } = render(
      <InspectorSelectField
        label="Group"
        value=""
        options={OPTIONS}
        onCommit={vi.fn()}
        placeholder="Pick one"
      />,
    );
    const whenEmpty = trigger().textContent;
    expect(whenEmpty, 'objectui#8450 still owns the empty half').toBe('Pick one');

    rerender(
      <InspectorSelectField
        label="Group"
        value="retired_group"
        options={OPTIONS}
        onCommit={vi.fn()}
        placeholder="Pick one"
      />,
    );
    const whenUnknown = trigger().textContent;
    expect(whenUnknown, 'the unknown value never wears the placeholder').not.toBe(whenEmpty);
    expect(whenUnknown).toBe('retired_group (not found)');
    expect(
      screen.queryByText('Pick one'),
      'and the placeholder is not in the DOM at all while a value is stored',
    ).toBeNull();
  });

  it('leaves a KNOWN value alone — no flag, no synthesised row', () => {
    // The non-regression half: an implementation that flags unconditionally
    // passes every case above and fails this one.
    render(
      <InspectorSelectField label="Group" value="profile" options={OPTIONS} onCommit={vi.fn()} />,
    );
    expect(trigger().textContent, 'a value the roster offers shows its own label').toBe('Profile');
    expect(screen.queryByText(/not found/), 'nothing is flagged').toBeNull();
  });

  it('honours the CALL SITE\'s wording — the rule unifies, the sentence does not', () => {
    // `FlowNodeConfigField` says "(deprecated)" on sourced grounds
    // (framework#4278 / ADR-0090 D3): the value is known, it is simply no
    // longer offered. Flattening that to "(not found)" would lose the claim.
    render(
      <InspectorSelectField
        label="Group"
        value="sms"
        options={OPTIONS}
        onCommit={vi.fn()}
        unknownValueLabel={(v) => `${v} (deprecated)`}
      />,
    );
    expect(trigger().textContent).toBe('sms (deprecated)');
  });

  it('keeps the flagged row a REAL option — re-picking your own stored value is not a dead end', () => {
    render(
      <InspectorSelectField label="Group" value="retired_group" options={OPTIONS} onCommit={vi.fn()} />,
    );
    // Radix keeps the roster in a portal until opened, so the flagged text can
    // only reach the trigger by way of a mounted `SelectItem` the controlled
    // value MATCHED. That round trip is the evidence of selectability: a
    // decorative string painted on the trigger would read the same to a human
    // and would not be re-pickable — and it is exactly what direction 2 (raw
    // value on the trigger, not an option) would have produced.
    const el = trigger();
    expect(el.textContent, 'the flag arrives through a real, matched option').toBe(
      'retired_group (not found)',
    );
    expect(el.getAttribute('data-placeholder'), 'a stored value is not a placeholder state').toBeNull();
    expect(el).not.toBeDisabled();
  });

  it('is a no-op when the call site already synthesised the row itself', () => {
    // Backward compatibility for any caller still passing its own row: the
    // value IS in the roster it handed us, so the primitive adds nothing and
    // the caller's label wins — no doubled entry, no doubled suffix.
    render(
      <InspectorSelectField
        label="Group"
        value="retired_group"
        options={[{ value: 'retired_group', label: 'retired_group (not in object)' }, ...OPTIONS]}
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent).toBe('retired_group (not in object)');
    expect(screen.queryByText(/not found/), 'the default wording never doubles up').toBeNull();
  });
});
