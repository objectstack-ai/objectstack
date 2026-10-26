// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two contracts of `InspectorSelectField`'s trigger, pinned together because
 * they are the same question asked twice: what does the trigger render when the
 * caller's value is EMPTY?
 *
 * 1. Regression: the field must accept an option whose value is the empty
 *    string (a "— None —" choice). Radix `<Select.Item value="">` throws on
 *    render; the field bridges "" through an internal sentinel. This is exactly
 *    what the object field "Group" selector relies on once field groups exist,
 *    so a regression here crashes the whole inspector.
 *
 * 2. objectui#8450: when the caller offers NO such option, the empty state must
 *    draw the `placeholder`. It used not to. The sentinel that makes (1) work
 *    is also what broke (2): Radix renders `SelectValue`'s placeholder only for
 *    a value of `''` or `undefined` (`shouldShowPlaceholder`), the bridge
 *    guarantees the value is neither, and a controlled value matching no
 *    `SelectItem` renders as nothing at all. Measured across the tree: 45
 *    non-test call sites, 0 of which passed an explicit `placeholder` — so what
 *    never rendered was the declared `'—'` default, at every empty select in
 *    the designer.
 *
 * ⚠️ The two pull against each other, which is why they live in one file. A
 * repair that shows the placeholder whenever the value is empty breaks (1): the
 * "— No group —" row IS a selection and its label must win. A repair that keeps
 * quiet whenever the value is empty is the bug in (2). The predicate that
 * satisfies both is narrow — no value AND no option standing for "none".
 *
 * ## The non-regression half (objectui#8350's lesson)
 *
 * Every positive case below is also satisfied by a field that renders the
 * placeholder ALWAYS — an implementation strictly worse than the bug, since it
 * would hide the selected value too. The two "does not render" cases are what
 * fail on it, and they assert the trigger's exact text rather than the
 * placeholder's absence, so an implementation that renders both also fails.
 *
 * ## Reverse verification
 *
 * Ablating the READ SITE — restoring `<SelectValue placeholder={placeholder} />`
 * inside an unconditional trigger, i.e. the pre-fix source — turns the three
 * `renders …` rows red and leaves the two `does not render …` rows green. That
 * asymmetry is the point: the pin fails for the bug's own reason and for no
 * other. Run recorded on the PR.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InspectorSelectField } from './_shared';

afterEach(cleanup);

const OPTIONS = [
  { value: '', label: '— No group —' },
  { value: 'profile', label: 'Profile' },
  { value: 'meta', label: 'Metadata' },
];

/** The same roster minus the "none" row — the shape 35 of the 45 call sites use. */
const NO_NONE_OPTIONS = OPTIONS.filter((o) => o.value !== '');

/** The trigger Radix renders — `button[role=combobox]`, named by the `<Label>`. */
function trigger(name = 'Group'): HTMLElement {
  const el = screen.queryByRole('combobox', { name });
  expect(el, `a combobox named "${name}" is rendered at all`).not.toBeNull();
  return el as HTMLElement;
}

describe('InspectorSelectField — empty-value option', () => {
  it('renders with an empty-string option without throwing', () => {
    expect(() =>
      render(
        <InspectorSelectField label="Group" value="" options={OPTIONS} onCommit={vi.fn()} />,
      ),
    ).not.toThrow();
    expect(screen.queryByText('Group'), 'the field label is rendered').not.toBeNull();
  });

  it('shows the selected non-empty option label on the trigger', () => {
    render(
      <InspectorSelectField label="Group" value="profile" options={OPTIONS} onCommit={vi.fn()} />,
    );
    expect(screen.queryByText('Profile'), 'the selected option label reaches the DOM').not.toBeNull();
  });

  it('displays the empty-valued option label when value is "" (round-trips through the sentinel)', () => {
    render(
      <InspectorSelectField
        label="Group"
        value=""
        options={OPTIONS}
        onCommit={vi.fn()}
        placeholder="Pick one"
      />,
    );
    // ⚠️ The reason this case originally gave for the placeholder's absence was
    // NOT the operative one. It read "value '' matches the — No group — option,
    // so the trigger surfaces that label rather than the placeholder" — true of
    // the first assertion, but the second one held for a different reason
    // entirely: before objectui#8450 the placeholder was unreachable in EVERY
    // state, matching option or not, so this case could not have told a working
    // field from a broken one. It can now: with the roster below stripped of
    // its "" row the very same props render "Pick one" (next describe), so this
    // absence is the "" option winning, which is what it always claimed to be.
    expect(
      screen.queryByText('— No group —'),
      'the "" option is a real selection and its label wins',
    ).not.toBeNull();
    expect(
      screen.queryByText('Pick one'),
      'a selection is showing, so the placeholder stays out of the DOM',
    ).toBeNull();
    expect(
      trigger().textContent,
      'the trigger shows the option label ALONE — not the label plus the placeholder',
    ).toBe('— No group —');
  });
});

describe('InspectorSelectField — placeholder (objectui#8450)', () => {
  it('renders the declared "—" default when the value is undefined', () => {
    render(
      <InspectorSelectField label="Group" value={undefined} options={NO_NONE_OPTIONS} onCommit={vi.fn()} />,
    );
    expect(
      trigger().textContent,
      'an unset select draws its placeholder, not a blank trigger',
    ).toBe('—');
  });

  it('renders the declared "—" default for an empty-string value', () => {
    render(
      <InspectorSelectField label="Group" value="" options={NO_NONE_OPTIONS} onCommit={vi.fn()} />,
    );
    expect(
      trigger().textContent,
      '"" with no "" option means the same thing as undefined: nothing is selected',
    ).toBe('—');
  });

  it("renders the CALLER's placeholder — the prop that reached no output before", () => {
    render(
      <InspectorSelectField
        label="Group"
        value=""
        options={NO_NONE_OPTIONS}
        onCommit={vi.fn()}
        placeholder="Pick one"
      />,
    );
    expect(
      screen.queryByText('Pick one'),
      "the caller's placeholder reaches the DOM",
    ).not.toBeNull();
    expect(trigger().textContent, 'and it is the whole of what the trigger shows').toBe('Pick one');
  });

  it('does NOT render the placeholder when a value is selected', () => {
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={NO_NONE_OPTIONS}
        onCommit={vi.fn()}
        placeholder="Pick one"
      />,
    );
    // The half that fails on a field which renders the placeholder ALWAYS —
    // an implementation strictly worse than the bug it replaces.
    expect(screen.queryByText('Pick one'), 'the placeholder is not in the DOM').toBeNull();
    expect(
      trigger().textContent,
      'the trigger shows the selected label and nothing else',
    ).toBe('Profile');
  });

  it('does NOT render the placeholder when "" is itself an offered option', () => {
    render(
      <InspectorSelectField
        label="Group"
        value=""
        options={OPTIONS}
        onCommit={vi.fn()}
        placeholder="Pick one"
      />,
    );
    expect(screen.queryByText('Pick one'), 'the "none" row is the selection').toBeNull();
    expect(trigger().textContent, 'so its label is what shows').toBe('— No group —');
  });

  it('flips both ways as the value comes and goes', () => {
    const { rerender } = render(
      <InspectorSelectField label="Group" value={undefined} options={NO_NONE_OPTIONS} onCommit={vi.fn()} />,
    );
    expect(trigger().textContent, 'empty at first').toBe('—');

    rerender(
      <InspectorSelectField label="Group" value="meta" options={NO_NONE_OPTIONS} onCommit={vi.fn()} />,
    );
    expect(
      trigger().textContent,
      'a value arriving replaces the placeholder with the option label — the Radix ' +
        'item text still portals into SelectValue across the swap',
    ).toBe('Metadata');

    rerender(
      <InspectorSelectField label="Group" value="" options={NO_NONE_OPTIONS} onCommit={vi.fn()} />,
    );
    expect(trigger().textContent, 'and clearing it brings the placeholder back').toBe('—');
  });

  it('carries Radix\'s own data-placeholder flag in the empty state only', () => {
    // Not decoration: `data-[placeholder]:text-muted-foreground` on the Shadcn
    // trigger is how the empty state is greyed, and Radix cannot derive the
    // attribute itself while the sentinel keeps its value non-empty.
    const { rerender } = render(
      <InspectorSelectField label="Group" value="" options={NO_NONE_OPTIONS} onCommit={vi.fn()} />,
    );
    expect(
      trigger().getAttribute('data-placeholder'),
      'the empty trigger is flagged as showing a placeholder',
    ).toBe('');

    rerender(
      <InspectorSelectField label="Group" value="profile" options={NO_NONE_OPTIONS} onCommit={vi.fn()} />,
    );
    expect(
      trigger().getAttribute('data-placeholder'),
      'a selected trigger is not',
    ).toBeNull();
  });
});
