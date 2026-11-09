// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13389 — a display name that derives no identifier says so beside
 * the identifier instead of leaving it silently blank.
 *
 * Measured on the card (zh-CN console): Studio → New object, `反馈` as the
 * object name left 标识 empty with Create greyed out and nothing saying why;
 * `Feedback` filled `feedback`. `CreateItemDialog` is the one create form
 * every Studio create dialog uses, so it is driven directly.
 *
 * objectstack#29690 — a Chinese name now derives through its pinyin (the last
 * block), so the "derives nothing" cases use a Japanese name, the script that
 * still has no derivation.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CreateItemDialog } from './CreateItemDialog';
import { t, type SupportedLocale } from '../metadata-admin/i18n';
import { loadHanRomanizer } from '../metadata-admin/romanizeHan';
import { prefixObjectName } from './packages-io';

// The designer rows this suite reads in zh live in `@object-ui/i18n`'s `studio`
// namespace, whose `zh` catalogue is fetched on demand (objectstack#25922).
// Resident before any case, so the zh rows below read synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');
// The pinyin dictionary a Chinese name derives through, resident before any
// case, as it is once a Console door has fetched it (objectstack#29690).
await loadHanRomanizer();

afterEach(cleanup);

function renderDialog(locale: SupportedLocale = 'en-US', storedName?: (identifier: string) => string) {
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
      storedName={storedName}
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
  it('a Japanese name leaves the identifier empty, keeps Create off, and says why next to it', () => {
    const d = renderDialog();
    fireEvent.change(d.label(), { target: { value: 'フィードバック' } });
    expect(d.id().value).toBe('');
    expect(d.submit()).toBeDisabled();
    expect(d.hint()).toHaveTextContent(t('engine.studio.createItem.notDerived', 'en-US'));
    expect(d.id()).toHaveAttribute('aria-describedby', d.hint()!.id);
  });

  it('the zh-CN line asks for an English identifier', () => {
    const d = renderDialog('zh-CN');
    fireEvent.change(d.label(), { target: { value: 'フィードバック' } });
    expect(d.hint()).toHaveTextContent('请手动填写英文标识');
  });

  it('typing an identifier clears the line and enables Create with it', () => {
    const d = renderDialog();
    fireEvent.change(d.label(), { target: { value: 'フィードバック' } });
    fireEvent.change(d.id(), { target: { value: 'feedback' } });
    expect(d.hint()).toBeNull();
    expect(d.submit()).toBeEnabled();
    fireEvent.click(d.submit());
    expect(d.onSubmit).toHaveBeenCalledWith({ label: 'フィードバック', name: 'feedback' });
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

describe('CreateItemDialog — a Chinese name derives its identifier by pinyin (objectstack#29690)', () => {
  it('fills an editable identifier, says nothing, and Create submits it', () => {
    const d = renderDialog('zh-CN');
    fireEvent.change(d.label(), { target: { value: '维修中心' } });
    expect(d.id().value).toBe('weixiu_zhongxin');
    expect(d.hint()).toBeNull();
    expect(d.submit()).toBeEnabled();
    fireEvent.click(d.submit());
    expect(d.onSubmit).toHaveBeenCalledWith({ label: '维修中心', name: 'weixiu_zhongxin' });
  });

  it('the derived identifier stays editable: a typed one wins and the name no longer moves it', () => {
    const d = renderDialog('zh-CN');
    fireEvent.change(d.label(), { target: { value: '客户等级' } });
    expect(d.id().value).toBe('kehu_dengji');
    fireEvent.change(d.id(), { target: { value: 'customer_tier' } });
    fireEvent.change(d.label(), { target: { value: '客户等级二' } });
    expect(d.id().value).toBe('customer_tier');
    fireEvent.click(d.submit());
    expect(d.onSubmit).toHaveBeenCalledWith({ label: '客户等级二', name: 'customer_tier' });
  });

  it('the namespace prefix still applies to a derived identifier: the saved name previews as <ns>_weixiu_zhongxin', () => {
    const d = renderDialog('zh-CN', (id) => prefixObjectName(id, 'repairs'));
    fireEvent.change(d.label(), { target: { value: '维修中心' } });
    expect(screen.getByTestId('create-item-stored-name')).toHaveTextContent('repairs_weixiu_zhongxin');
  });
});
