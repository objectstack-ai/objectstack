/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The option widgets' empty/gate copy with NO `I18nProvider` mounted
 * (objectui#3231) — standalone/embedded usage, and every test in the repo that
 * renders a field widget bare.
 *
 * Routing the copy through `useFieldTranslation()` must not turn it into a raw
 * i18n key when nothing is configured: `createSafeTranslation` probes the
 * instance and falls back to its English defaults map. That is the behaviour
 * the removed literals used to provide unconditionally, so it gets its own pin.
 *
 * Why a separate FILE rather than another case in `OptionsEmptyState.test.tsx`:
 * mounting `I18nProvider` calls `initReactI18next`, which installs that
 * instance as react-i18next's GLOBAL default. Once any sibling test has done
 * so there is no "no provider" state left to observe in that module graph, and
 * the assertion would silently read the last locale mounted instead. Vitest's
 * per-file isolation (`isolate: true` on the `dom` project) is what makes this
 * file's observation honest.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SelectField } from './SelectField';
import { MultiSelectField } from './MultiSelectField';
import { RadioField } from './RadioField';
import { CheckboxesField } from './CheckboxesField';

const WIDGETS = [
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
] as const;

const gatedField = (type: string) =>
  ({
    name: 'province',
    type,
    dependsOn: 'country',
    options: [{ label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" }],
  }) as any;

const unconfiguredField = (type: string) => ({ name: 'province', type, options: [] }) as any;

function renderWidget(Widget: React.ComponentType<any>, field: any) {
  return render(
    <Widget
      value={undefined}
      onChange={vi.fn()}
      field={field}
      {...({ name: 'province', dependentValues: {} } as any)}
    />,
  );
}

describe('option widgets — English fallback survives with no i18n configured', () => {
  it.each(WIDGETS)('$label renders the gate sentence, not a raw key', ({ Widget, type, testId }) => {
    renderWidget(Widget, gatedField(type));
    const box = screen.getByTestId(testId);
    expect(box).toHaveTextContent('Select country first');
    expect(box.textContent).not.toContain('fields.options');
  });

  it.each(WIDGETS)('$label renders the empty sentence, not a raw key', ({ Widget, type, testId }) => {
    renderWidget(Widget, unconfiguredField(type));
    const box = screen.getByTestId(testId);
    expect(box).toHaveTextContent('No options available');
    expect(box.textContent).not.toContain('fields.options');
  });
});
