/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12156 — the flat `ObjectForm`'s file-size hint reads the spec's
 * `maxSize`, the one spelling.
 *
 * The form builds a `file` / `image` field's description from the object
 * schema and appends "Max size: …" when the field declares a limit. It read the
 * snake_case `max_size` until this card: a spelling the spec's `FieldSchema`
 * refuses by name, so metadata the server serves never carried it and the hint
 * never showed, while a field declaring the spec's `maxSize` got none. The
 * object schema is untyped at that read, so a misspelt key compiles; this file
 * is what catches it.
 *
 * Pinned through the public `ObjectForm` entry with the real registered field
 * widgets:
 *
 *   1. a `file` and an `image` field declaring `maxSize` show the hint, and an
 *      authored description keeps its place before it;
 *   2. the retired `max_size` is not read: a field carrying only that spelling
 *      shows no hint (no dual read, AGENTS.md #0.1);
 *   3. CONTROL: a field declaring no limit shows no hint;
 *   4. the hint's words are the session locale's `form.maxFileSize` pack value,
 *      with `formatFileSize`'s number and unit interpolated: under a `zh`
 *      provider the `zh` sentence, under `en` the `en` one. Without a provider
 *      (cases 1 to 3) the form's fallback renders the English default;
 *   5. a language switch while the form is open re-renders the hint. The form
 *      builds its fields in an effect, and only the sentence string in that
 *      effect's dependency list makes it run again for a new language.
 *
 * The expected sentences are read from the packs, not restated here, so a
 * reworded translation does not turn this file red; a hint that stops reading
 * the pack does.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const MB = 1024 * 1024;

const OBJECT_SCHEMA = {
  name: 'claim',
  fields: {
    contract: { type: 'file', label: 'Contract', maxSize: 10 * MB },
    photo: { type: 'image', label: 'Photo', description: 'Front view.', maxSize: 5 * MB },
    // The retired spelling: refused by the spec, read by nothing.
    legacy: { type: 'file', label: 'Legacy', max_size: 10 * MB },
    // CONTROL: no limit declared.
    open: { type: 'file', label: 'Open' },
  },
};

const makeDS = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    create: vi.fn().mockResolvedValue({ id: 'c1' }),
    update: vi.fn().mockResolvedValue({ id: 'c1' }),
    findOne: vi.fn().mockResolvedValue({ id: 'c1' }),
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  }) as any;

const fieldRow = (name: string) => document.body.querySelector<HTMLElement>(`[data-field="${name}"]`);

const renderForm = async (language?: 'en' | 'zh') => {
  const form = (
    <ObjectForm schema={{ type: 'object-form', objectName: 'claim', mode: 'create' } as any} dataSource={makeDS()} />
  );
  render(
    language
      ? <I18nProvider instance={createI18n({ defaultLanguage: language, detectBrowserLanguage: false })}>{form}</I18nProvider>
      : form,
  );
  await waitFor(() => {
    for (const name of Object.keys(OBJECT_SCHEMA.fields)) {
      if (!fieldRow(name)) throw new Error(`${name} not rendered`);
    }
  });
};

afterEach(() => cleanup());

/** A pack's `form.maxFileSize` sentence with the size filled in. */
const sentence = (pack: { form: { maxFileSize: string } }, size: string) =>
  pack.form.maxFileSize.replace('{{size}}', size);

describe('ObjectForm (flat) — the file-size hint reads `maxSize` (objectui#12156)', () => {
  it('shows the hint on a file field declaring `maxSize`', async () => {
    await renderForm();
    expect(fieldRow('contract')!.textContent).toContain(sentence(en, '10.0 MB'));
  });

  it('appends the hint after an authored description on an image field', async () => {
    await renderForm();
    expect(fieldRow('photo')!.textContent).toContain(`Front view. (${sentence(en, '5.0 MB')})`);
  });

  it('does not read the retired `max_size`: no hint', async () => {
    await renderForm();
    expect(fieldRow('legacy')!.textContent).not.toContain(sentence(en, ''));
  });

  it('CONTROL: no limit declared, no hint', async () => {
    await renderForm();
    expect(fieldRow('open')!.textContent).not.toContain(sentence(en, ''));
  });
});

describe('ObjectForm (flat) — the file-size hint is in the session locale (objectui#12156)', () => {
  it('the two packs say different things, so the zh case below measures a translation', () => {
    expect(zh.form.maxFileSize).not.toBe(en.form.maxFileSize);
    expect(zh.form.maxFileSize).toContain('{{size}}');
  });

  it('under a zh provider the hint reads the zh pack sentence', async () => {
    await renderForm('zh');
    await waitFor(() => expect(fieldRow('contract')!.textContent).toContain(sentence(zh, '10.0 MB')));
    expect(fieldRow('photo')!.textContent).toContain(`Front view. (${sentence(zh, '5.0 MB')})`);
    expect(fieldRow('contract')!.textContent).not.toContain(sentence(en, '10.0 MB'));
  });

  it('under an en provider the hint reads the en pack sentence', async () => {
    await renderForm('en');
    await waitFor(() => expect(fieldRow('contract')!.textContent).toContain(sentence(en, '10.0 MB')));
  });

  it('follows a language switch while the form is open', async () => {
    const instance = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    render(
      <I18nProvider instance={instance}>
        <ObjectForm schema={{ type: 'object-form', objectName: 'claim', mode: 'create' } as any} dataSource={makeDS()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(fieldRow('contract')?.textContent).toContain(sentence(en, '10.0 MB')));
    await act(async () => {
      await instance.changeLanguage('zh');
    });
    await waitFor(() => expect(fieldRow('contract')!.textContent).toContain(sentence(zh, '10.0 MB')));
  });
});
