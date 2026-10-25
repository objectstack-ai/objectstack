/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The fullscreen long-text flag has exactly ONE spelling — objectui#3303.
 *
 * The built-in (unregistered) `textarea` branch used to read the flag as
 * `mobile_fullscreen || fullscreen`, and `stripRendererOnlyProps` /
 * `stripRegisteredFieldProps` each carried a matching entry that discarded a
 * `fullscreen` key. That alias had **zero producers**: a repo-wide grep (plus
 * `objectstack`'s `packages/spec`) turned up only the unrelated
 * feedback/loading overlay property of the same name. `ObjectForm` — the one
 * and only producer — stamps `mobile_fullscreen` (#3245/#3300), so the second
 * term of the `||` was undefined from the day it was written.
 *
 * A no-producer alias is not "one more layer of safety", it is the lenient
 * consumer fallback AGENTS.md #0.1 forbids: the next author (very much
 * including an AI writing form metadata) reads `fullscreen` off the renderer,
 * spells it that way, and gets silence — no dialog, no error, nowhere to look.
 * That is the same mechanism as #3245 and #3301.
 *
 * What these tests pin, in the two places the alias lived:
 *
 *   1. the built-in branch honours `mobile_fullscreen` and ONLY that. The
 *      canonical case is asserted alongside the alias case on purpose — a
 *      lone "the alias renders no expand button" assertion would also pass if
 *      the fullscreen affordance stopped rendering altogether, i.e. it would
 *      be green for an empty reason.
 *   2. the prop strips own `mobile_fullscreen` and no longer name
 *      `fullscreen`, so a misspelled flag is now handled exactly like any
 *      other unrecognised authored key rather than being quietly swallowed by
 *      a dedicated discard entry.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('form renderer — built-in textarea reads one fullscreen spelling (objectui#3303)', () => {
  it('renders the expand affordance for the canonical `mobile_fullscreen`', () => {
    // The positive half. Without it the alias assertion below would be
    // satisfied by a branch that renders no expand button for ANY input.
    renderForm([{ name: 'notes', label: 'Notes', type: 'textarea', mobile_fullscreen: true }]);

    expect(screen.getByTestId('form-textarea-fullscreen-toggle')).toBeInTheDocument();
  });

  it('still opens and commits through the dialog on the canonical spelling', () => {
    // Narrowing the read must not disturb the surviving path: the draft model
    // (edit → Done → value lands in form state) is what the flag is FOR.
    renderForm([{ name: 'notes', label: 'Notes', type: 'textarea', mobile_fullscreen: true }]);

    fireEvent.click(screen.getByTestId('form-textarea-fullscreen-toggle'));
    fireEvent.change(screen.getByTestId('form-textarea-fullscreen-input'), {
      target: { value: 'committed from the dialog' },
    });
    fireEvent.click(screen.getByTestId('form-textarea-fullscreen-save'));

    expect(screen.queryByTestId('form-textarea-fullscreen-dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue('committed from the dialog');
  });

  it('does NOT honour the producer-less `fullscreen` alias', () => {
    // The nail. Before #3303 this field DID render the expand button and the
    // dialog, through the `|| fullscreen` limb — which is precisely the
    // problem: a spelling nothing in the repo produces nevertheless "worked"
    // here, and nowhere else (`TextAreaField` / `RichTextField` are both
    // single-read), so the same metadata behaved differently depending on
    // whether the field type happened to resolve to a registered widget.
    //
    // React logs its usual "Received `true` for a non-boolean attribute"
    // warning here now, because the key survives the strip and reaches the
    // `<textarea>` like any other unrecognised prop. That noise is the point:
    // the typo is visible instead of silent. It is not asserted on, since the
    // exact wording belongs to React, not to this contract.
    renderForm([{ name: 'notes', label: 'Notes', type: 'textarea', fullscreen: true }]);

    expect(screen.queryByTestId('form-textarea-fullscreen-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('form-textarea-fullscreen-dialog')).not.toBeInTheDocument();
    // A plain textarea, not "nothing rendered" — so the assertions above are
    // about the affordance being absent, not about the field being absent.
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
  });

  it('renders a plain textarea when neither spelling is present', () => {
    renderForm([{ name: 'notes', label: 'Notes', type: 'textarea' }]);

    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
    expect(screen.queryByTestId('form-textarea-fullscreen-toggle')).not.toBeInTheDocument();
  });
});

/**
 * Props the probe was rendered with, captured per render.
 *
 * A holder object rather than a bare module variable: `react-hooks/globals`
 * forbids REASSIGNING an outer binding from a component body, and mutating a
 * property of a stable object is the repo's usual shape for a probe
 * (see `form-field-carrier.test.tsx`).
 */
const captured: { props: Record<string, any> | null } = { props: null };

/** Stands in for a registered field widget — `@object-ui/components` tests never load `@object-ui/fields`. */
function StripProbe(props: any) {
  captured.props = props;
  return <input data-testid={`probe-${props.name}`} value={(props.value as string) ?? ''} readOnly />;
}

describe('form renderer — the prop strips own `mobile_fullscreen` only (objectui#3303)', () => {
  beforeAll(() => {
    ComponentRegistry.register('stripprobe', StripProbe, { namespace: 'field' });
  }, 30000);

  beforeEach(() => {
    captured.props = null;
  });

  it('strips the canonical flag but leaves the alias in the ordinary unknown-key class', () => {
    renderForm([
      {
        name: 'notes',
        label: 'Notes',
        type: 'stripprobe',
        mobile_fullscreen: true,
        fullscreen: true,
        // A control key with no meaning to anyone. Whatever the renderer does
        // with THIS is what an unrecognised key gets, and after #3303
        // `fullscreen` is one of those.
        not_a_real_flag: true,
      },
    ]);

    const props = captured.props!;
    expect(props).not.toBeNull();

    // `mobile_fullscreen` is renderer-owned: it is stripped from the top-level
    // props precisely so widgets cannot grow a second read of it. Its one legal
    // carrier is `field` (objectui#3232/#3233/#3245).
    expect(props.mobile_fullscreen).toBeUndefined();
    expect(props.field.mobile_fullscreen).toBe(true);

    // …and `fullscreen` is not renderer-owned at all any more. The assertion is
    // NOT "widgets should receive `fullscreen`" — it is that the renderer has no
    // dedicated entry for it, so it is indistinguishable from any other typo.
    // Re-adding `fullscreen: _fullscreen` to either strip turns this red.
    expect(props.fullscreen).toBe(props.not_a_real_flag);
    expect(props.fullscreen).toBe(true);
  });
});
