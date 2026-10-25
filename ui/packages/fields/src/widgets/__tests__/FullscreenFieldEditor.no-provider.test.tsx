/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The shared fullscreen long-text dialog with NO `I18nProvider` mounted
 * (objectui#3404) — standalone/embedded hosts, and most of this package's own
 * bare-render tests.
 *
 * ## Why this leg decided the implementation
 *
 * Routing the copy through i18n must not turn it into raw keys where nothing
 * is configured. MEASURED on the pre-change tree with a probe rendering bare
 * `useObjectTranslation()` and no provider:
 *
 *     {"cancel":"common.cancel","done":"form.fullscreen.done",
 *      "title":"form.fullscreen.title","toggle":"form.fullscreen.toggle"}
 *
 * Raw keys on every one, and the `{{label}}` interpolation gone entirely —
 * strictly WORSE than the English literals being replaced. So
 * `FullscreenFieldEditor` consumes `useFieldTranslation()`
 * (`createSafeTranslation` + English defaults, the same shape the built-in
 * branch has used since objectui#3272) rather than the bare hook, and the
 * defaults are byte-identical to the old literals so this rendering is
 * unchanged.
 *
 * ## Why a separate FILE and not another `describe`
 *
 * Mounting `I18nProvider` calls `initReactI18next`, which installs that
 * instance as react-i18next's GLOBAL default. Once any sibling case has done
 * so there is no "no provider" state left in the module graph, and these
 * assertions would pass by reading that leaked instance instead of the
 * fallback — green for the wrong reason. That is not a hypothetical: these
 * cases were FIRST written inside `FullscreenFieldEditor.i18n.test.tsx`, and
 * the reverse check (swap `useFieldTranslation` back to bare
 * `useObjectTranslation`, expect red) left them GREEN there while it correctly
 * turned `RichTextField.mobileFullscreen.test.tsx` red. Split out, the same
 * swap turns them red — which is what makes them a pin.
 *
 * Same split, same reason as `TagsField.placeholder.no-provider.test.tsx` and
 * `OptionsEmptyState.no-provider.test.tsx`; vitest's per-file isolation is
 * what makes the observation honest.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { TextAreaField } from '../TextAreaField';
import type { FieldMetadata } from '@object-ui/types';

const textareaField = (extra: Record<string, unknown> = {}) =>
  ({ name: 'notes', type: 'textarea', mobile_fullscreen: true, ...extra }) as unknown as FieldMetadata;

function openFullscreen() {
  const toggle = screen.getByTestId('textarea-fullscreen-toggle');
  fireEvent.click(toggle);
  return toggle;
}

describe('fullscreen dialog copy — English fallback survives with no i18n configured (objectui#3404)', () => {
  it('renders the English defaults, not raw keys', () => {
    render(<TextAreaField value="hello" onChange={vi.fn()} field={textareaField()} />);
    const toggle = openFullscreen();

    // Byte-identical to the literals this change replaced.
    expect(toggle).toHaveAttribute('aria-label', 'Edit text fullscreen');
    expect(screen.getByText('Edit text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();

    // The measured failure mode, stated directly — a raw key reaching a user.
    expect(document.body.textContent).not.toMatch(/form\.fullscreen\./);
    expect(document.body.textContent).not.toMatch(/common\.cancel/);
  });

  it('still interpolates the field label into the trigger name', () => {
    // `createSafeTranslation`'s fallback does its own `{{k}}` replacement.
    // Bare `useObjectTranslation` returns `form.fullscreen.toggle` verbatim
    // here, label dropped.
    render(
      <TextAreaField value="hello" onChange={vi.fn()} field={textareaField({ label: 'Notes' })} />,
    );

    expect(openFullscreen()).toHaveAttribute('aria-label', 'Edit Notes fullscreen');
  });

  it('the code-shipped defaults carry no CJK (Commandment #-1)', () => {
    // With no provider mounted, whatever renders here came from CODE
    // (FIELD_DEFAULTS). Escaped ranges on purpose: a literal CJK class would
    // itself violate the commandment this asserts (same shape as
    // `TagsField.placeholder.no-provider.test.tsx`).
    render(<TextAreaField value="hello" onChange={vi.fn()} field={textareaField()} />);
    openFullscreen();

    expect(screen.getByTestId('textarea-fullscreen-dialog').textContent).not.toMatch(
      /[\u3000-\u30ff\u4e00-\u9fff]/,
    );
  });

  it('still gives the dialog an accessible description', () => {
    render(<TextAreaField value="hello" onChange={vi.fn()} field={textareaField()} />);
    openFullscreen();

    const describedBy = screen
      .getByTestId('textarea-fullscreen-dialog')
      .getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      'Edit the full text value, then save or cancel your changes.',
    );
  });
});
