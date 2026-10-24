/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The tags widget's placeholder with NO `I18nProvider` mounted
 * (objectui#3342) — standalone/embedded usage, and every test in the repo
 * that renders a field widget bare.
 *
 * Routing the copy through `useFieldTranslation()` must not turn it into a
 * raw i18n key when nothing is configured: `createSafeTranslation` probes the
 * instance and falls back to its English defaults map. This is also where the
 * Commandment #-1 pin lives: the copy shipped FROM CODE (the no-provider
 * default) carries no CJK — Chinese exists only in the zh locale pack and can
 * only arrive through a provider.
 *
 * Why a separate FILE rather than another case in
 * `TagsField.placeholder.test.tsx`: mounting `I18nProvider` calls
 * `initReactI18next`, which installs that instance as react-i18next's GLOBAL
 * default. Once any sibling test has done so there is no "no provider" state
 * left to observe in that module graph. Vitest's per-file isolation is what
 * makes this file's observation honest (same split as
 * `OptionsEmptyState.no-provider.test.tsx`).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TagsField } from './TagsField';

function renderTags(field: Record<string, unknown>) {
  return render(
    <TagsField
      value={[]}
      onChange={vi.fn()}
      field={field as any}
      {...({ name: 'labels' } as any)}
    />,
  );
}

const input = () => screen.getByRole('textbox');

describe('TagsField placeholder — English fallback survives with no i18n configured', () => {
  it('renders the English default, not a raw key', () => {
    renderTags({ name: 'labels', type: 'tags' });
    expect(input()).toHaveAttribute('placeholder', 'Type and press Enter to add…');
    expect(input().getAttribute('placeholder')).not.toContain('fields.tags');
  });

  it('the code-shipped default carries no CJK (Commandment #-1)', () => {
    renderTags({ name: 'labels', type: 'tags' });
    // With no provider mounted, whatever renders here came from CODE
    // (FIELD_DEFAULTS) — the commandment pin: no Chinese in the codebase.
    // Escaped ranges on purpose: a literal CJK class would itself violate
    // the commandment this test enforces (same shape as objectui#3321's pin).
    expect(input().getAttribute('placeholder')).not.toMatch(/[\u3000-\u30ff\u4e00-\u9fff]/);
  });

  it('the author-declared field.placeholder still wins without a provider', () => {
    renderTags({ name: 'labels', type: 'tags', placeholder: 'Add product labels' });
    expect(input()).toHaveAttribute('placeholder', 'Add product labels');
  });
});
