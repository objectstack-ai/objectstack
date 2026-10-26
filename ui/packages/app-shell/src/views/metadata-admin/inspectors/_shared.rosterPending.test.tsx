// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8862 — `InspectorSelectField` stops asserting "not offered" about a
 * roster that has not answered yet.
 *
 * objectui#8488 gave the primitive the rule "a stored value the roster does not
 * offer is drawn, and flagged". It decided "does not offer" by membership in an
 * `options` array — and that array cannot say WHY it is empty. An async picker
 * mid-round-trip hands over `[]`, byte-identical to a catalog that genuinely
 * does not carry the value, so a perfectly valid stored value wore the flag
 * until the response landed. On the metadata-authoring surface the flag is an
 * assertion about the author's own data, and the plausible response to it is to
 * "fix" a binding that was already right.
 *
 * ## ⭐ What makes this suite a pin and not a decoration
 *
 * The defect exists ONLY while the request is in flight. A case that renders a
 * populated roster and finds no marker proves nothing — it is green on the
 * defect and on the fix alike, because a populated roster never flagged
 * anything. So every case here holds the roster in the state the bug needs
 * (`options={[]}`, or short of the stored value) and reads the trigger in that
 * frame. `settles from pending to flagged` walks the two frames in one mount,
 * which is the shape the author actually sees.
 *
 * ## The true-negative leg is not optional
 *
 * An implementation that simply deleted the flag passes every "no marker" case
 * ever written. `keeps flagging …` and the second half of `settles …` are what
 * fail on it: with the roster ANSWERED and the value genuinely absent, the flag
 * must still be there. Both legs, or the suite is asserting "never flag".
 *
 * ## Why it reads the TRIGGER
 *
 * Same reason as `_shared.unknownValue.test.tsx`: the value the primitive is
 * handed is correct in every one of these frames, and the defect was entirely
 * in what reached pixels. Radix keeps the roster in a portal until the select
 * is opened, so text can only arrive on the trigger by way of a mounted
 * `SelectItem` that the controlled value MATCHED — which is also the evidence
 * that the pending row stays re-pickable rather than becoming a painted string.
 *
 * ## Reverse verification
 *
 * Ablating the read — restoring `label: unknownValueLabel(current)`
 * unconditionally, i.e. the pre-fix source — turns the pending-arm rows red and
 * leaves the answered-arm rows green. Run recorded on the PR.
 *
 * ## ⚠️ Spelling migrated by objectui#9651
 *
 * These cases used to hand the primitive a bare `loading` boolean. objectui#9651
 * replaced that prop with one `roster` state, because a second boolean for the
 * FAILURE arm would have put four facts into three flags. The frames asserted
 * below are unchanged — `roster={{ status: 'loading' }}` is the same fact this
 * suite always pinned, said in the spelling that can also say "it failed".
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

describe('InspectorSelectField — a roster that has not answered yet (objectui#8862)', () => {
  it('does not flag a stored value while the roster is still loading', () => {
    // The reported frame: an async picker mid-fetch, so the roster is `[]` for
    // a reason that has nothing to do with the stored value.
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={[]}
        roster={{ status: 'loading' }}
        onCommit={vi.fn()}
      />,
    );
    expect(
      trigger().textContent,
      'an unanswered roster cannot testify that the value is absent from it',
    ).toBe('profile');
    expect(screen.queryByText(/not found/), 'nothing is flagged').toBeNull();
  });

  it('keeps the value LEGIBLE while loading — withholding the flag is not blanking the trigger', () => {
    // The tempting cheap fix — drop the synthesised row while loading — puts
    // back the blank trigger objectui#8488 removed, and blanks it exactly when
    // the author has least other evidence of what is stored. It also makes the
    // stored value unre-pickable. The row must survive; only the claim goes.
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={[]}
        roster={{ status: 'loading' }}
        placeholder="Pick one"
        onCommit={vi.fn()}
      />,
    );
    const el = trigger();
    expect(el.textContent, 'the value reaches the trigger through a real matched option').toBe(
      'profile',
    );
    expect(
      el.getAttribute('data-placeholder'),
      'a stored value is not a placeholder state, loading or not',
    ).toBeNull();
    expect(
      screen.queryByText('Pick one'),
      'and the placeholder never impersonates a value that IS stored',
    ).toBeNull();
    expect(el).not.toBeDisabled();
  });

  it('keeps flagging a value the ANSWERED roster does not offer — the true negative', () => {
    // Identical to the first case but for `loading`. An implementation that
    // deleted the flag outright passes every "no marker" row in this file and
    // fails this one.
    render(
      <InspectorSelectField
        label="Group"
        value="retired_group"
        options={OPTIONS}
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent, 'a roster that HAS answered still testifies').toBe(
      'retired_group (not found)',
    );
  });

  it('settles from pending to flagged — the two frames the author actually sees', () => {
    // The transition in one mount. Frame 1 is the round trip; frame 2 is the
    // response landing on a roster that genuinely does not carry the value.
    // Neither frame alone distinguishes the fix from "never flag" / "always
    // flag"; the pair does.
    const { rerender } = render(
      <InspectorSelectField
        label="Group"
        value="retired_group"
        options={[]}
        roster={{ status: 'loading' }}
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent, 'in flight: no claim either way').toBe('retired_group');

    rerender(
      <InspectorSelectField
        label="Group"
        value="retired_group"
        options={OPTIONS}
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent, 'answered, and the value really is not offered').toBe(
      'retired_group (not found)',
    );
  });

  it('settles from pending to a plain label when the value WAS offered all along', () => {
    // The other landing, and the one the defect made ugly: `ViewColumnInspector`
    // showed `name (not in object)` and then flipped to the field's own label.
    // After the fix the first frame already makes no false claim.
    const { rerender } = render(
      <InspectorSelectField label="Group" value="profile" options={[]} roster={{ status: 'loading' }} onCommit={vi.fn()} />,
    );
    expect(trigger().textContent).toBe('profile');

    rerender(
      <InspectorSelectField label="Group" value="profile" options={OPTIONS} onCommit={vi.fn()} />,
    );
    expect(trigger().textContent, 'the roster answered and it owns the wording now').toBe('Profile');
  });

  it('honours a partially-arrived roster: `loading` suppresses the FLAG, never the labels', () => {
    // A roster can be non-empty and still growing (paged / hydrated lists). The
    // term is about the claim, not about muting the control: a value the
    // partial roster already carries shows that option's own label.
    render(
      <InspectorSelectField
        label="Group"
        value="meta"
        options={OPTIONS}
        roster={{ status: 'loading' }}
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent).toBe('Metadata');
  });

  it('leaves the EMPTY state to objectui#8450 — loading is not a value', () => {
    // No value stored and the roster still out. There is no claim to withhold
    // here, and the placeholder half must not move: `showPlaceholder` is a
    // different predicate and objectui#8450 owns it.
    render(
      <InspectorSelectField
        label="Group"
        value=""
        options={[]}
        roster={{ status: 'loading' }}
        placeholder="Pick one"
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent, 'the empty state is untouched by the new term').toBe('Pick one');
    expect(trigger().getAttribute('data-placeholder')).toBe('');
  });

  it("does not let `loading` rewrite the call site's own wording once the roster answers", () => {
    // `unknownValueLabel` and `loading` are orthogonal: the first decides WHAT
    // the flag says, the second WHETHER there is one to say.
    const { rerender } = render(
      <InspectorSelectField
        label="Group"
        value="sms"
        options={[]}
        roster={{ status: 'loading' }}
        unknownValueLabel={(v) => `${v} (deprecated)`}
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent).toBe('sms');

    rerender(
      <InspectorSelectField
        label="Group"
        value="sms"
        options={OPTIONS}
        unknownValueLabel={(v) => `${v} (deprecated)`}
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent).toBe('sms (deprecated)');
  });
});
