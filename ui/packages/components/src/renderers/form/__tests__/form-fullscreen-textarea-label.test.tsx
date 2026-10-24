/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The fullscreen long-text editor knows WHICH field it is editing — objectui#3393.
 *
 * `renderFormField` destructures `label` off the field config before the
 * `...fieldProps` rest, and the single `renderFieldComponent` call site rebuilt
 * its props object without putting it back (it explicitly re-adds `field`,
 * `inputType`, `options`, `placeholder`, `emptyHint`, `dependsOnLabels` … but
 * not `label`). So the built-in `textarea` branch's `label` was `undefined` on
 * every render and both of `FullscreenTextarea`'s label-dependent expressions
 * were dead:
 *
 *   1. the dialog title `label ?? t('form.fullscreen.title')` always resolved
 *      to the generic "Edit text" — a field named "Notes" opened a dialog that
 *      would not say so;
 *   2. the expand button's accessible name always interpolated the generic
 *      noun, so a form with three long-text fields gave all three buttons the
 *      SAME name. A screen-reader user could not tell which field a button
 *      expanded — an accessibility defect, not a cosmetic one.
 *
 * What this suite pins, in the two directions the fix can regress:
 *
 *   - the label REACHES the dialog (title + a distinct name per field), and
 *   - it reaches nothing else. `label` is renderer-only: `<FormLabel>` already
 *     renders it above the control, so every other built-in branch spreads its
 *     leftover props straight onto a DOM node where `label="Notes"` would be a
 *     stray attribute, and registered widgets read the label off `field`, their
 *     single metadata carrier since v17 (objectui#3233). Both strips therefore
 *     discard it. Dropping either strip entry turns the DOM/widget cases below
 *     red; dropping the call-site key turns the dialog cases red.
 *
 * The label-less fallback (generic copy, in ten languages) is the subject of
 * `form-fullscreen-textarea-i18n.test.tsx`; one case is repeated here so the
 * `??` fallback arm cannot be deleted while this file alone stays green.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

function renderForm(fields: any[], language = 'en') {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />
    </I18nProvider>,
  );
}

const longText = (name: string, label?: string) => ({
  name,
  ...(label === undefined ? {} : { label }),
  type: 'textarea',
  mobile_fullscreen: true,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('form renderer — the fullscreen dialog names its field (objectui#3393)', () => {
  it('titles the dialog with the field label instead of the generic word', () => {
    renderForm([longText('notes', 'Notes')]);

    fireEvent.click(screen.getByTestId('form-textarea-fullscreen-toggle'));

    const dialog = screen.getByTestId('form-textarea-fullscreen-dialog');
    expect(dialog).toHaveTextContent('Notes');
    // The nail: before the fix this WAS the title, for every field on every
    // form. Asserting the label is present is not enough — the generic word
    // has to be gone, or a title rendering both would still pass.
    expect(screen.queryByText('Edit text')).not.toBeInTheDocument();
  });

  it('interpolates the label into the expand button accessible name', () => {
    renderForm([longText('notes', 'Notes')]);

    expect(screen.getByTestId('form-textarea-fullscreen-toggle')).toHaveAttribute(
      'aria-label',
      'Edit Notes fullscreen',
    );
  });

  it('interpolates into the translated sentence with no locale-pack change', () => {
    // objectui#3272 shaped `form.fullscreen.toggle` as ONE interpolated
    // sentence (zh puts `{{label}}` last, ja first) precisely so that feeding
    // the real label through would make all ten packs correct without touching
    // them. This is that promise, cashed.
    renderForm([longText('notes', '备注')], 'zh');

    expect(screen.getByTestId('form-textarea-fullscreen-toggle')).toHaveAttribute(
      'aria-label',
      '全屏编辑备注',
    );

    fireEvent.click(screen.getByTestId('form-textarea-fullscreen-toggle'));
    expect(screen.getByTestId('form-textarea-fullscreen-dialog')).toHaveTextContent('备注');
    expect(screen.queryByText('编辑文本')).not.toBeInTheDocument();
  });

  it('gives every long-text field on one form a DISTINCT expand button name', () => {
    // The accessibility defect itself. Three fields, three buttons, one name.
    renderForm([
      longText('notes', 'Notes'),
      longText('summary', 'Summary'),
      longText('resolution', 'Resolution'),
    ]);

    const names = screen
      .getAllByTestId('form-textarea-fullscreen-toggle')
      .map((el) => el.getAttribute('aria-label'));

    expect(names).toEqual([
      'Edit Notes fullscreen',
      'Edit Summary fullscreen',
      'Edit Resolution fullscreen',
    ]);
    expect(new Set(names).size).toBe(3);
  });

  it('opens the dialog for the SECOND field with that field own label', () => {
    // Distinct names are only useful if the button actually opens the field it
    // names — a per-field name plus a shared dialog would be worse than before.
    renderForm([longText('notes', 'Notes'), longText('summary', 'Summary')]);

    fireEvent.click(screen.getAllByTestId('form-textarea-fullscreen-toggle')[1]);

    const dialog = screen.getByTestId('form-textarea-fullscreen-dialog');
    expect(dialog).toHaveTextContent('Summary');
    expect(dialog).not.toHaveTextContent('Notes');
  });

  it('still falls back to the generic title when the field has no label', () => {
    renderForm([longText('notes')]);

    expect(screen.getByTestId('form-textarea-fullscreen-toggle')).toHaveAttribute(
      'aria-label',
      'Edit text fullscreen',
    );
    fireEvent.click(screen.getByTestId('form-textarea-fullscreen-toggle'));
    expect(screen.getByText('Edit text')).toBeInTheDocument();
  });
});

describe('form renderer — the forwarded label reaches no DOM attribute (objectui#3393)', () => {
  it('puts no `label` attribute on any control the built-in branches render', () => {
    // One field per built-in branch that spreads its leftover props onto a DOM
    // node. Before the strip entry existed, forwarding `label` from the call
    // site dropped `label="…"` on every one of them; the local
    // `const { label: _label, ...rest }` in the `textarea` branch guarded that
    // ONE branch only — and, since nothing was forwarded, guarded nothing.
    const { container } = renderForm([
      { name: 'title', label: 'Title', type: 'input' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
      longText('summary', 'Summary'),
      { name: 'agree', label: 'Agree', type: 'checkbox' },
      { name: 'active', label: 'Active', type: 'switch' },
      { name: 'mystery', label: 'Mystery', type: 'not-a-registered-type' },
    ]);

    expect(container.querySelectorAll('[label]')).toHaveLength(0);
    // Named, so a failure says which control leaked rather than just a count.
    expect(screen.getByLabelText('Title')).not.toHaveAttribute('label');
    expect(screen.getByLabelText('Notes')).not.toHaveAttribute('label');
    expect(screen.getByLabelText('Summary')).not.toHaveAttribute('label');
    expect(screen.getByLabelText('Mystery')).not.toHaveAttribute('label');
  });

  it('leaves the visible `<FormLabel>` and its control association intact', () => {
    // The strip must not be mistaken for "the label is gone": it is rendered by
    // `<FormLabel>` and associated with the control, which is what makes
    // `getByLabelText` work at all.
    renderForm([longText('notes', 'Notes')]);

    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
  });
});

/**
 * Props the probe was rendered with, captured per render.
 *
 * A holder object rather than a bare module variable: `react-hooks/globals`
 * forbids REASSIGNING an outer binding from a component body, and mutating a
 * property of a stable object is the repo's usual shape for a probe.
 */
const captured: { props: Record<string, any> | null } = { props: null };

/** Stands in for a registered field widget — `@object-ui/components` tests never load `@object-ui/fields`. */
function LabelProbe(props: any) {
  captured.props = props;
  return <input data-testid={`probe-${props.name}`} value={(props.value as string) ?? ''} readOnly />;
}

describe('form renderer — registered widgets get no new `label` prop (objectui#3393)', () => {
  beforeAll(() => {
    ComponentRegistry.register('labelprobe', LabelProbe, { namespace: 'field' });
  }, 30000);

  beforeEach(() => {
    captured.props = null;
  });

  it('strips `label` on the registered path, leaving `field` the one carrier', () => {
    // Deliberately NOT "widgets should receive `label`". The built-in branch is
    // the only reader this issue is scoped to; whether the published
    // `FieldWidgetPropsSchema` should grow a `label` prop is a contract
    // decision of its own (objectui#3233 just converged which registry entry
    // decides which contract). Until that decision is taken, a widget reads the
    // label where it has always read it — off `field`.
    renderForm([{ name: 'notes', label: 'Notes', type: 'labelprobe' }]);

    const props = captured.props!;
    expect(props).not.toBeNull();
    expect(props.label).toBeUndefined();
    expect(props.field.label).toBe('Notes');
  });
});
