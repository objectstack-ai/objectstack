// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13389 — a display name with no Latin letters derives no identifier,
 * and the dialog says so beside the identifier instead of leaving it silently
 * blank.
 *
 * Measured on the card (zh-CN console): Studio → New object, `反馈` as the
 * object name left 标识 empty with Create greyed out and nothing saying why;
 * `Feedback` filled `feedback`. `CreateItemDialog` is the one create form
 * every Studio create dialog uses, so it is driven directly.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CreateItemDialog } from './CreateItemDialog';
import { t, type SupportedLocale } from '../metadata-admin/i18n';

afterEach(cleanup);

function renderDialog(locale: SupportedLocale = 'en-US') {
  const onSubmit = vi.fn();
  render(
    <CreateItemDialog
      open
      onOpenChange={vi.fn()}
      title="New object"
      labelFieldLabel="Object name"
      idFieldLabel="Identifier"
      submitLabel="Create"
      locale={locale}
      onSubmit={onSubmit}
    />,
  );
  return {
    onSubmit,
    label: () => screen.getByLabelText('Object name') as HTMLInputElement,
    id: () => screen.getByLabelText('Identifier') as HTMLInputElement,
    submit: () => screen.getByRole('button', { name: 'Create' }),
    hint: () => screen.queryByTestId('create-item-id-not-derived'),
  };
}

describe('CreateItemDialog — a name that derives no identifier says so (objectui#13389)', () => {
  it('a Chinese name leaves the identifier empty, keeps Create off, and says why next to it', () => {
    const d = renderDialog();
    fireEvent.change(d.label(), { target: { value: '反馈' } });
    expect(d.id().value).toBe('');
    expect(d.submit()).toBeDisabled();
    expect(d.hint()).toHaveTextContent(t('engine.studio.createItem.notDerived', 'en-US'));
    expect(d.id()).toHaveAttribute('aria-describedby', d.hint()!.id);
  });

  it('the zh-CN line asks for an English identifier', () => {
    const d = renderDialog('zh-CN');
    fireEvent.change(d.label(), { target: { value: '反馈' } });
    expect(d.hint()).toHaveTextContent('请手动填写英文标识');
  });

  it('typing an identifier clears the line and enables Create with it', () => {
    const d = renderDialog();
    fireEvent.change(d.label(), { target: { value: '反馈' } });
    fireEvent.change(d.id(), { target: { value: 'feedback' } });
    expect(d.hint()).toBeNull();
    expect(d.submit()).toBeEnabled();
    fireEvent.click(d.submit());
    expect(d.onSubmit).toHaveBeenCalledWith({ label: '反馈', name: 'feedback' });
  });

  it('CONTROL — a Latin name fills the identifier and says nothing; an empty dialog says nothing', () => {
    const d = renderDialog();
    expect(d.hint()).toBeNull();
    fireEvent.change(d.label(), { target: { value: 'Feedback' } });
    expect(d.id().value).toBe('feedback');
    expect(d.hint()).toBeNull();
    expect(d.submit()).toBeEnabled();
  });
});
