/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12145 — `@object-ui/fields`' accessible names are read from the
 * pack through `useFieldTranslation`, so under `zh` a screen reader hears the
 * zh pack's words. The percent widget's slider stands in for the package: it
 * was `aria-label="Percentage"`, and is now `fields.percent.slider`. The crop
 * dialog's canvas (`fields.image.cropPreview`) and the record picker's grid
 * (`console.commandPalette.records`) read the same hook.
 *
 * The name is read against the PACK, never against a literal.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import type { FieldMetadata } from '@object-ui/types';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { PercentField } from '../widgets/PercentField';

afterEach(cleanup);

const field = { name: 'rate', label: 'rate', type: 'percent' } as unknown as FieldMetadata;
const percent = () => <PercentField value={0.42} onChange={() => {}} field={field} />;

describe('the percent slider is named from the pack (objectui#12145)', () => {
  it('with no provider, it carries the en pack value', () => {
    render(percent());
    expect(screen.getByRole('slider', { name: en.fields.percent.slider })).toBeInTheDocument();
  });

  it('under zh, it is named by the zh pack, not by the English word', async () => {
    expect(zh.fields.percent.slider).not.toBe(en.fields.percent.slider);
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        {percent()}
      </I18nProvider>,
    );
    expect(await screen.findByRole('slider', { name: zh.fields.percent.slider })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: en.fields.percent.slider })).toBeNull();
  });
});
