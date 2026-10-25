/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The tags widget's input placeholder (objectui#3342).
 *
 * It used to be a hardcoded Chinese literal in code — a double violation:
 * Commandment #-1 (English-only codebase) AND a bypass of the i18n channel the
 * sibling widgets already use. The pinned resolution chain is:
 *
 *   1. `field.placeholder` — the field author's declaration always wins;
 *   2. `t('fields.tags.placeholder')` — the widget's own copy, from the
 *      locale packs via `useFieldTranslation()`;
 *   3. the English default in FIELD_DEFAULTS when no I18nProvider is mounted
 *      (that leg lives in `TagsField.placeholder.no-provider.test.tsx` — see
 *      its header for why it must be a separate file).
 *
 * Chinese now lives in the zh locale pack only, which is what the zh-locale
 * case below observes end-to-end.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { TagsField } from './TagsField';

function renderTags(
  field: Record<string, unknown>,
  { value = [] as string[], language }: { value?: string[]; language?: string } = {},
) {
  const element = (
    <TagsField
      value={value}
      onChange={vi.fn()}
      field={field as any}
      {...({ name: 'labels' } as any)}
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

const input = () => screen.getByRole('textbox');

describe('TagsField placeholder — author declaration beats the widget copy (objectui#3342)', () => {
  it('renders the author-declared field.placeholder', () => {
    renderTags({ name: 'labels', type: 'tags', placeholder: 'Add product labels' }, { language: 'en' });
    expect(input()).toHaveAttribute('placeholder', 'Add product labels');
  });

  it('the author declaration wins even under a non-English locale', () => {
    // The author's copy is theirs verbatim — a locale switch must not
    // overwrite an explicit declaration with the widget's own translation.
    renderTags({ name: 'labels', type: 'tags', placeholder: 'Add product labels' }, { language: 'zh' });
    expect(input()).toHaveAttribute('placeholder', 'Add product labels');
    expect(input().getAttribute('placeholder')).not.toContain('输入后回车添加');
  });
});

describe('TagsField placeholder — undeclared falls back to the translated key', () => {
  it('renders the en pack copy under the en locale', () => {
    renderTags({ name: 'labels', type: 'tags' }, { language: 'en' });
    expect(input()).toHaveAttribute('placeholder', 'Type and press Enter to add…');
  });

  it('renders the zh pack copy under the zh locale — Chinese comes from the pack, not code', () => {
    renderTags({ name: 'labels', type: 'tags' }, { language: 'zh' });
    expect(input()).toHaveAttribute('placeholder', '输入后回车添加…');
    // …and never the raw key.
    expect(input().getAttribute('placeholder')).not.toContain('fields.tags');
  });
});

describe('TagsField placeholder — shown only while the tag list is empty', () => {
  it('is empty once a tag exists (the input is a continuation strip)', () => {
    renderTags({ name: 'labels', type: 'tags', placeholder: 'Add product labels' }, {
      value: ['alpha'],
      language: 'en',
    });
    expect(input()).toHaveAttribute('placeholder', '');
  });
});
