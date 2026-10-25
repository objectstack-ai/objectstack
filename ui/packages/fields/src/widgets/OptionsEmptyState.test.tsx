/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The empty / dependency-gated state of the fixed-option widgets (objectui#3231).
 *
 * Two invariants, pinned for ALL FOUR widgets — they are what regressed:
 *
 *  1. **declared ⇒ delivered.** `emptyHint` is declared on
 *     `FieldWidgetComponentProps` and computed by the form renderer. Every one
 *     of the four widgets used to destructure it into `_emptyHint` and drop it
 *     on the floor, so the host's hint could never reach a user once the field
 *     went through the `field:` registry (i.e. always, in the real console).
 *  2. **the fallback is translated.** With no host hint the widget renders its
 *     own copy — which used to be a hardcoded English literal
 *     (`'No options available'`, `` `Select ${…} first` ``) even though
 *     `useFieldTranslation()` was already imported in one of the same files.
 *
 * All four are covered deliberately: they were four independent copies of the
 * same block, which is exactly why they drifted together and why one widget's
 * test would have proven nothing about the other three. They now share
 * `OptionsEmptyState`; these tests keep that true from the outside, so the
 * guarantee survives someone re-inlining the block.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { SelectField } from './SelectField';
import { MultiSelectField } from './MultiSelectField';
import { RadioField } from './RadioField';
import { CheckboxesField } from './CheckboxesField';

interface WidgetCase {
  label: string;
  Widget: React.ComponentType<any>;
  type: string;
  testId: string;
}

const WIDGETS: WidgetCase[] = [
  { label: 'SelectField', Widget: SelectField, type: 'select', testId: 'select-empty-province' },
  {
    label: 'MultiSelectField',
    Widget: MultiSelectField,
    type: 'multiselect',
    testId: 'multiselect-empty-province',
  },
  { label: 'RadioField', Widget: RadioField, type: 'radio', testId: 'radio-empty-province' },
  {
    label: 'CheckboxesField',
    Widget: CheckboxesField,
    type: 'checkboxes',
    testId: 'checkboxes-empty-province',
  },
];

/** Gated: `country` is empty, so no option is offered yet (#2284). */
const gatedField = (type: string) =>
  ({
    name: 'province',
    type,
    dependsOn: 'country',
    options: [
      { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
      { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
    ],
  }) as any;

/** Not gated, simply nothing to offer — the other way a list ends up empty. */
const unconfiguredField = (type: string) => ({ name: 'province', type, options: [] }) as any;

function renderWidget(
  { Widget }: WidgetCase,
  field: any,
  extra: Record<string, unknown> = {},
  language?: string,
) {
  const element = (
    <Widget
      value={undefined}
      onChange={vi.fn()}
      field={field}
      {...({ name: 'province', dependentValues: {}, ...extra } as any)}
    />
  );
  return render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        {element}
      </I18nProvider>
    ) : (
      element
    ),
  );
}

describe('option widgets — the host-supplied `emptyHint` reaches the user (objectui#3231)', () => {
  it.each(WIDGETS)(
    '$label renders the host hint instead of its own gate copy',
    (widget) => {
      // What the form renderer actually computes: a sentence built from the
      // controlling field's human LABEL, which the widget cannot know (its
      // metadata only carries the name `country`).
      renderWidget(widget, gatedField(widget.type), {
        emptyHint: 'Choose the Country field first',
      });

      const box = screen.getByTestId(widget.testId);
      expect(box).toHaveTextContent('Choose the Country field first');
      // …and NOT the widget's own copy, which is what used to render.
      expect(box.textContent).not.toMatch(/select country first/i);
    },
  );

  it.each(WIDGETS)(
    '$label renders the host hint for an unconfigured (ungated) list too',
    (widget) => {
      // `emptyHint` is a declared prop of the widget contract, not a private
      // channel of one form-renderer branch: supplied ⇒ used, always.
      renderWidget(widget, unconfiguredField(widget.type), {
        emptyHint: 'Options come from the price book',
      });

      expect(screen.getByTestId(widget.testId)).toHaveTextContent(
        'Options come from the price book',
      );
    },
  );

  it.each(WIDGETS)('$label prefers a host hint over its translated fallback', (widget) => {
    // Even under a non-English locale the HOST wins — it is the single source.
    renderWidget(widget, gatedField(widget.type), { emptyHint: 'Pick a Country first' }, 'zh');

    const box = screen.getByTestId(widget.testId);
    expect(box).toHaveTextContent('Pick a Country first');
    expect(box.textContent).not.toContain('请先选择');
  });
});

describe('option widgets — the fallback copy is translated, never a hardcoded literal', () => {
  it.each(WIDGETS)('$label translates the gate copy when no host hint is given', (widget) => {
    renderWidget(widget, gatedField(widget.type), {}, 'zh');

    const box = screen.getByTestId(widget.testId);
    expect(box).toHaveTextContent('请先选择country');
    expect(box.textContent).not.toMatch(/select .* first/i);
  });

  it.each(WIDGETS)('$label translates the empty copy when no host hint is given', (widget) => {
    renderWidget(widget, unconfiguredField(widget.type), {}, 'zh');

    const box = screen.getByTestId(widget.testId);
    expect(box).toHaveTextContent('暂无可选项');
    expect(box.textContent).not.toMatch(/no options available/i);
  });
});

// The no-provider fallback lives in `OptionsEmptyState.no-provider.test.tsx`:
// mounting `I18nProvider` here installs its instance as react-i18next's global
// default (`initReactI18next`), so after any test above there is no longer a
// "no provider" state to observe within this module graph.

