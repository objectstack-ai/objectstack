/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record-detail highlights chip draws a boolean with the locale's word
 * (objectui#11689).
 *
 * The card's sighting was a zh-CN user record whose highlights strip read
 * "Email Verified Yes" with the label translated and the value not: the
 * `sys_user` object lists `email_verified` among its `highlightFields`, and
 * this strip's boolean chip spelled `Yes` / `No` as JSX text. The chip now
 * reads the word from `@object-ui/fields`' `useBooleanValueLabel`, the one
 * every read-only boolean word reads, so the strip and the record's form say
 * the same word in every locale.
 *
 * Rendered through a REAL `I18nProvider` over the real packs; the
 * provider-less case pins that an embed with no provider keeps the English
 * words.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { HeaderHighlight } from '../HeaderHighlight';

afterEach(cleanup);

const objectSchema = {
  fields: {
    email: { type: 'email', label: 'Email' },
    email_verified: { type: 'boolean', label: 'Email Verified' },
    two_factor_enabled: { type: 'boolean', label: 'Two-Factor Enabled' },
  },
};

const strip = (
  <HeaderHighlight
    fields={
      [
        { name: 'email', label: 'Email' },
        { name: 'email_verified', label: 'Email Verified' },
        { name: 'two_factor_enabled', label: 'Two-Factor Enabled' },
      ] as any
    }
    data={{ email: 'dev@example.com', email_verified: true, two_factor_enabled: false }}
    objectSchema={objectSchema}
  />
);

const inLocale = (language: string | null, ui: React.ReactElement) =>
  language === null
    ? render(ui)
    : render(
        <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
          {ui}
        </I18nProvider>,
      );

/** The chip's column, anchored on the field LABEL (never on the word under test). */
const chipText = (label: string) => (screen.getByText(label).parentElement as HTMLElement).textContent?.replace(label, '');

describe('the highlights strip draws a boolean in the session language (objectui#11689)', () => {
  it('zh renders 是 / 否 in the boolean chips', () => {
    inLocale('zh', strip);
    // CONTROL: the strip rendered a real non-boolean value, so a missing word
    // below cannot be explained by a strip that drew nothing.
    expect(within(screen.getByText('Email').parentElement as HTMLElement).queryByText('dev@example.com')).not.toBeNull();
    expect(chipText('Email Verified')).toBe('是');
    expect(chipText('Two-Factor Enabled')).toBe('否');
    expect(screen.queryByText('Yes')).toBeNull();
    expect(screen.queryByText('No')).toBeNull();
  });

  it('en is unchanged: Yes / No', () => {
    inLocale('en', strip);
    expect(chipText('Email Verified')).toBe('Yes');
    expect(chipText('Two-Factor Enabled')).toBe('No');
  });

  it('with no I18nProvider it still says Yes / No', () => {
    inLocale(null, strip);
    expect(chipText('Email Verified')).toBe('Yes');
    expect(chipText('Two-Factor Enabled')).toBe('No');
  });
});
