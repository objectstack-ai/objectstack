// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9651 — `InspectorSelectField` stops reading a FAILED roster as a
 * roster that answered "no".
 *
 * objectui#8488 gave the primitive the rule "a stored value the roster does not
 * offer is drawn, and flagged", deciding "does not offer" by membership in an
 * `options` array. objectui#8862 added the in-flight term, so the flag is
 * withheld while the roster is still out. A fetch that FAILS leaves exactly the
 * same residue as a successful fetch that found nothing — `[]`, with nothing in
 * flight — so the flag still fired, and unlike the pending arm it never cleared:
 * a valid stored key wore `(not in object)` permanently, with nothing anywhere
 * on screen saying the request had failed.
 *
 * ## ⭐ All three states are pinned here, not just the repaired one
 *
 * The two arms that already work are the reason this suite can tell a repair
 * from a deletion:
 *
 *   • IN FLIGHT  — no flag. Deleting it would re-open objectui#8862.
 *   • ANSWERED, value genuinely absent — flag. Without this leg, "never flag"
 *     passes everything below.
 *   • FAILED     — no flag, AND a notice naming the failure.
 *
 * ## ⚠️ Suppression is only half of the repair
 *
 * A silent suppression trades a wrong message for NO message: the author is
 * then looking at an empty picker for an unstated reason. The failure cases
 * therefore assert BOTH facts, and they are pinned as separate expectations so
 * an implementation that does one of them cannot pass by doing the other. That
 * shape follows what this tree already decided a picker owes its host on a
 * failed catalog — the shared `PickerLoadFailure` block (objectui#5170) states
 * that the list could not be loaded, shows the cause, claims nothing about
 * whether options exist, and leaves the control editable.
 *
 * ## Why it reads the TRIGGER
 *
 * Same reason as `_shared.rosterPending.test.tsx`: Radix keeps the roster in a
 * portal until the select is opened, so text can only reach the trigger through
 * a mounted `SelectItem` the controlled value MATCHED. Reading it there is also
 * the evidence that the value stayed re-pickable rather than becoming a painted
 * string — a failed catalog must not block authoring.
 *
 * ## Reverse verification
 *
 * Four ablations, run separately, each on the committed fix; runs recorded on
 * the PR. Collapsing the `error` arm into `answered` (the pre-fix reading) turns
 * the failure rows red and leaves the other arms green; deleting the notice
 * turns only the notice rows red; collapsing `answered` into `silent` turns the
 * true-negative row red; collapsing `loading` into `answered` turns the
 * in-flight row red.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InspectorSelectField, rosterFrom } from './_shared';

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

/** The failure notice, or `null` when the primitive is not showing one. */
const notice = () => screen.queryByTestId('inspector-select-roster-failure');

describe('InspectorSelectField — a roster whose fetch FAILED (objectui#9651)', () => {
  it('does not flag a stored value when the roster failed to load', () => {
    // The residue of a failed fetch is the residue of an empty success. Only
    // the state says which happened.
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={[]}
        roster={{ status: 'error', message: '503 Service Unavailable' }}
        onCommit={vi.fn()}
      />,
    );
    expect(
      trigger().textContent,
      'the stored value stays legible and carries no absence claim',
    ).toBe('profile');
    expect(
      screen.queryByText('profile (not found)'),
      'a roster that never answered cannot testify that the value is absent',
    ).toBeNull();
  });

  it('SAYS the roster failed, and names the cause', () => {
    // Withholding the flag without saying anything replaces a wrong message
    // with no message. Asserted separately from the case above so an
    // implementation cannot pass by doing only one of the two.
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={[]}
        roster={{ status: 'error', message: '503 Service Unavailable' }}
        onCommit={vi.fn()}
      />,
    );
    const el = notice();
    expect(el, 'the failure arm renders a notice').not.toBeNull();
    expect(el?.textContent).toContain('Options could not be loaded');
    expect(
      el?.textContent,
      'the cause is what tells a broken fetch from a retired field',
    ).toContain('503 Service Unavailable');
  });

  it("lets the call site word the notice, the way it already words the flag", () => {
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={[]}
        roster={{ status: 'error', message: 'boom' }}
        rosterFailureLabel="Roster unavailable (host wording)"
        onCommit={vi.fn()}
      />,
    );
    expect(notice()?.textContent).toContain('Roster unavailable (host wording)');
    expect(
      notice()?.textContent,
      'the default English wording is replaced, not appended to',
    ).not.toContain('Options could not be loaded');
  });

  it('keeps the failed picker EDITABLE — a broken catalog must not also block authoring', () => {
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={OPTIONS}
        roster={{ status: 'error', message: 'boom' }}
        onCommit={vi.fn()}
      />,
    );
    expect(
      trigger().getAttribute('data-disabled'),
      'nothing about a failed roster disables the control',
    ).toBeNull();
    expect((trigger() as HTMLButtonElement).disabled).toBe(false);
  });

  it('CONTROL — the roster in flight is still silent (objectui#8862 must not re-open)', () => {
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={[]}
        roster={{ status: 'loading' }}
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent).toBe('profile');
    expect(screen.queryByText('profile (not found)')).toBeNull();
    expect(
      notice(),
      'in flight is not a failure — no notice belongs on this frame',
    ).toBeNull();
  });

  it('CONTROL — an ANSWERED roster that does not carry the value still flags it', () => {
    // The true negative. Without it every case above is satisfied by deleting
    // the flag outright.
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={[{ value: 'meta', label: 'Metadata' }]}
        roster={{ status: 'loaded', data: undefined }}
        onCommit={vi.fn()}
      />,
    );
    expect(
      trigger().textContent,
      'an answered roster without the value is exactly what the flag is for',
    ).toBe('profile (not found)');
    expect(notice()).toBeNull();
  });

  it('CONTROL — no `roster` prop at all is a synchronous roster, and it still flags', () => {
    // Most call sites pass a literal `options` array and no state — the ones a
    // `roster=` search does not return. Omission has to keep meaning "already
    // answered", or this change breaks every one of them.
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={[{ value: 'meta', label: 'Metadata' }]}
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent).toBe('profile (not found)');
    expect(notice()).toBeNull();
  });

  it('CONTROL — `idle` is silent too: a question never asked answers nothing', () => {
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={[]}
        roster={{ status: 'idle' }}
        onCommit={vi.fn()}
      />,
    );
    expect(trigger().textContent).toBe('profile');
    expect(notice()).toBeNull();
  });
});

describe('rosterFrom — the precedence written once (objectui#9651)', () => {
  it('reports the FAULT even while a retry is in flight', () => {
    // The order is the whole point: a hook that sets `loading` back to true for
    // a retry, with the previous failure still published, must not read as
    // "in flight, nothing wrong". `error` is checked first, once, here.
    expect(rosterFrom({ loading: true, error: 'boom' })).toEqual({
      status: 'error',
      message: 'boom',
    });
  });

  it('maps the pair onto the remaining arms', () => {
    expect(rosterFrom({ loading: true, error: null })).toEqual({ status: 'loading' });
    expect(rosterFrom({ loading: false, error: null })).toEqual({
      status: 'loaded',
      data: undefined,
    });
  });

  it('reports a fault that arrived WITHOUT a message — truthiness would swallow it', () => {
    // `error: ''` is reachable: the loaders write `err?.message ?? String(err)`,
    // and `??` does not replace an empty string. A falsy-check here would read
    // that as a clean load — the same substitution, one level up.
    expect(rosterFrom({ loading: false, error: '' })).toEqual({
      status: 'error',
      message: '',
    });
  });

  it('a fault with no cause still shows the notice, without a cause line', () => {
    render(
      <InspectorSelectField
        label="Group"
        value="profile"
        options={[]}
        roster={rosterFrom({ loading: false, error: '' })}
        onCommit={vi.fn()}
      />,
    );
    expect(notice()?.textContent).toBe('Options could not be loaded');
    expect(trigger().textContent).toBe('profile');
  });
});
