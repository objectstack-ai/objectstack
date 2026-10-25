/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13461 — the field widgets' icon-only buttons carry a name, read
 * from the pack: the password reveal toggle (`fields.password.*`), the QR-code
 * widget's copy and show / hide buttons (`fields.qrCode.*`) and the
 * master-detail rows' open / remove buttons (`fields.masterDetail.*`, named
 * after the row). The icon-only-button census (objectui#12143) proves a name
 * attribute is present; this file proves which name a screen reader hears.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { PasswordField } from '../widgets/PasswordField';
import { QRCodeField } from '../widgets/QRCodeField';
import { MasterDetailField } from '../widgets/MasterDetailField';

afterEach(cleanup);

const inLocale = (language: 'en' | 'zh', node: React.ReactNode) => (
  <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
    {node}
  </I18nProvider>
);

const noop = () => {};
// The field metadata the three widgets read; the rest of the contract is irrelevant here.
const field = { name: 'f', type: 'text' } as never;

describe('field widget icon-only buttons are named from the pack (objectui#13461)', () => {
  it('PasswordField: the reveal toggle says what it will do', () => {
    render(inLocale('en', <PasswordField value="s3cret" onChange={noop} field={field} />));
    const toggle = screen.getByRole('button', { name: en.fields.password.show });
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName(en.fields.password.hide);
  });

  it('QRCodeField: copy, and show / hide the code', () => {
    render(inLocale('en', <QRCodeField value="https://example.com" onChange={noop} field={field} />));
    expect(screen.getByRole('button', { name: en.fields.qrCode.copy })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: en.fields.qrCode.show });
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName(en.fields.qrCode.hide);
  });

  it('MasterDetailField: each row names its open and remove buttons after the row', () => {
    render(inLocale('en', <MasterDetailField value={[{ id: 'r1', label: 'Invoice 7' }]} onChange={noop} field={field} />));
    const name = (pattern: string) => pattern.replace('{{name}}', 'Invoice 7');
    expect(screen.getByRole('button', { name: name(en.fields.masterDetail.view) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: name(en.fields.masterDetail.remove) })).toBeInTheDocument();
  });

  it('reads the zh pack under zh', () => {
    expect(zh.fields.password.show).not.toBe(en.fields.password.show);
    render(inLocale('zh', <PasswordField value="s3cret" onChange={noop} field={field} />));
    expect(screen.getByRole('button', { name: zh.fields.password.show })).toBeInTheDocument();
  });
});
