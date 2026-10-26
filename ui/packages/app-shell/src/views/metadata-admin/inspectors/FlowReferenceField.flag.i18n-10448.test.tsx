// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10448 — the flag the org-membership-tier select puts on a STORED
 * tier outside its vocabulary reads in the designer's locale.
 *
 * The strict select keeps a legacy out-of-enum tier on screen, flagged, so an
 * old row is never silently blanked. That flag was a hard-coded English
 * template literal, so a zh-CN author read `VALUE (invalid)` on an otherwise
 * Chinese inspector. It now goes through `flagUnknownValue` with the
 * catalogue's `engine.form.invalid`, the device objectui#9652 landed for the
 * designer's other unknown-value flags.
 *
 * `ReferenceCombobox` (the control `FlowReferenceField` wraps) has no `locale`
 * prop, so it reads `useMetadataLocale()`: each case mounts an `I18nProvider`
 * in the language under test and reads the RENDERED trigger text.
 *
 * - zh: the value followed directly by the catalogue's zh flag, no space. The
 *   flag is read from the catalogue rather than retyped, and the guard below
 *   proves it is a real zh row, so the case cannot pass on a missing key.
 * - en: the pre-fix wording, byte for byte, as a literal.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

const state = vi.hoisted(() => {
  const metaList = vi.fn(async () => [] as unknown[]);
  return {
    // STABLE identity, like the real memoized client — a fresh `{ list }` per
    // render would setState → re-render → setState forever and hang the run.
    metadataClient: { list: metaList },
  };
});

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
  // @object-ui/components wires this at module scope (related-count-store).
  subscribeDataChanges: () => () => {},
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  LookupField: () => <div data-testid="record-lookup" />,
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [] }),
}));

import { t } from '../i18n';
import { FlowReferenceField } from './FlowReferenceField';

afterEach(cleanup);

describe('engine.form.invalid is a real row in both locales (non-vacuity guard)', () => {
  it('is translated, not echoed and not English', () => {
    const zh = t('engine.form.invalid', 'zh-CN');
    expect(zh, 'a missing zh row echoes the key back').not.toBe('engine.form.invalid');
    expect(zh, 'the zh row must not be the English one').not.toBe(t('engine.form.invalid', 'en-US'));
    expect(zh.startsWith('（'), 'the zh flag opens with a full-width bracket').toBe(true);
  });
});

describe('FlowReferenceField — a stored membership tier outside the enum', () => {
  function mount(language: 'en' | 'zh') {
    render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        <FlowReferenceField
          field={{ label: 'Tier', ref: { kind: 'org-membership-level' } }}
          value="sales_manager"
          onCommit={vi.fn()}
        />
      </I18nProvider>,
    );
    return screen.getByRole('combobox');
  }

  it('zh: the flag is the catalogue\'s "invalid", after the value, unspaced', () => {
    expect(mount('zh').textContent).toBe(`sales_manager${t('engine.form.invalid', 'zh-CN')}`);
  });

  it('en: the wording is unchanged', () => {
    expect(mount('en').textContent).toBe('sales_manager (invalid)');
  });
});
