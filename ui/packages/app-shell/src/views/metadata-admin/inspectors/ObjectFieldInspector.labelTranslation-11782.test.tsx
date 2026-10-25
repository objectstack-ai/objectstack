// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider, createI18n } from '@object-ui/i18n';

// The inspector loads the object list and the picklist roster on mount; stub
// both, as the other inspector suites do.
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { tFormat, type SupportedLocale } from '../i18n';

afterEach(cleanup);

const HINT = 'field-label-translation-hint';

/**
 * The runtime bundle shape `transformSpecTranslations` produces from an app's
 * authored `objects.<obj>.fields.<field>.label` entries: field labels are
 * flattened to `<ns>.fields.<obj>.<field>`. This is what the console's
 * `loadLanguage` installs, and what the Data pillar's grid and form canvas
 * resolve a field's label from (`useSafeFieldLabel().fieldLabel`).
 */
function appBundle(fields: Record<string, string>) {
  return { showcase: { fields: { showcase_account: fields } } };
}

function renderInspector({
  language,
  locale = 'en-US',
  bundle,
  label = 'Tax ID (EIN)',
}: {
  language: string;
  locale?: SupportedLocale;
  bundle: Record<string, string>;
  label?: string;
}) {
  const onPatch = vi.fn();
  const instance = createI18n({
    defaultLanguage: language,
    detectBrowserLanguage: false,
    resources: { [language]: appBundle(bundle) },
  });
  const ui = (fieldLabel: string) => (
    <I18nProvider instance={instance}>
      <ObjectFieldInspector
        type="object"
        name="showcase_account"
        draft={{
          name: 'showcase_account',
          fields: {
            tax_id: { type: 'text', label: fieldLabel },
            website: { type: 'url', label: 'Website' },
          },
        }}
        selection={{ kind: 'field', id: 'tax_id' }}
        onPatch={onPatch}
        onClearSelection={vi.fn()}
        onSelectionChange={vi.fn()}
        readOnly={false}
        locale={locale}
      />
    </I18nProvider>
  );
  const utils = render(ui(label));
  return { onPatch, rerenderWithLabel: (next: string) => utils.rerender(ui(next)), ...utils };
}

const labelInput = () => screen.getByTestId('field-label-input') as HTMLInputElement;

describe('ObjectFieldInspector — the Label input says when a translation overrides it (objectui#11782)', () => {
  it('names the translated label and the language it is shown in', () => {
    renderInspector({ language: 'en', bundle: { tax_id: 'Tax ID' } });

    const hint = screen.getByTestId(HINT);
    expect(hint.textContent).toBe(
      tFormat('designer.field.labelTranslated', 'en-US', { label: 'Tax ID', language: 'en' }),
    );
    // The input still edits the SOURCE label; the hint only reports.
    expect(labelInput().value).toBe('Tax ID (EIN)');
  });

  it('names the language the resolver read, not the designer locale it collapsed to', () => {
    // A ja session reads the designer's en-US table (`useMetadataLocale`
    // collapses every non-zh language), but the canvas shows the ja bundle.
    renderInspector({ language: 'ja', locale: 'en-US', bundle: { tax_id: '納税者番号' } });

    expect(screen.getByTestId(HINT).textContent).toBe(
      tFormat('designer.field.labelTranslated', 'en-US', { label: '納税者番号', language: 'ja' }),
    );
  });

  it('reads the zh table in a zh session', () => {
    renderInspector({ language: 'zh-CN', locale: 'zh-CN', bundle: { tax_id: '税号' } });

    expect(screen.getByTestId(HINT).textContent).toBe(
      tFormat('designer.field.labelTranslated', 'zh-CN', { label: '税号', language: 'zh-CN' }),
    );
  });

  it('shows nothing for a field the bundle does not translate', () => {
    // Positive control in the same bundle: `website` IS translated, so the
    // namespace is discovered and the absence is about `tax_id` alone.
    renderInspector({ language: 'en', bundle: { website: 'Web site' } });

    expect(screen.queryByTestId(HINT)).toBeNull();
  });

  it('shows nothing when the translation equals the label being edited', () => {
    renderInspector({ language: 'en', bundle: { tax_id: 'Tax ID (EIN)' } });

    expect(screen.queryByTestId(HINT)).toBeNull();
  });

  it("compares against the input's current value, not the label the field loaded with", () => {
    const { rerenderWithLabel } = renderInspector({ language: 'en', bundle: { tax_id: 'Tax ID' } });
    expect(screen.getByTestId(HINT)).toBeTruthy();

    rerenderWithLabel('Tax ID');
    expect(screen.queryByTestId(HINT)).toBeNull();

    rerenderWithLabel('Taxpayer ID');
    expect(screen.getByTestId(HINT).textContent).toBe(
      tFormat('designer.field.labelTranslated', 'en-US', { label: 'Tax ID', language: 'en' }),
    );
  });

  it('commits a typed label to the source `label` exactly as before', () => {
    const { onPatch } = renderInspector({ language: 'en', bundle: { tax_id: 'Tax ID' } });

    fireEvent.change(labelInput(), { target: { value: 'Employer ID' } });

    expect(onPatch).toHaveBeenCalledTimes(1);
    const fields = onPatch.mock.calls[0][0].fields as Record<string, Record<string, unknown>>;
    expect(fields.tax_id).toEqual({ type: 'text', label: 'Employer ID' });
    // The translation is never written into the draft.
    expect(JSON.stringify(onPatch.mock.calls[0][0])).not.toContain('"Tax ID"');
  });
});
