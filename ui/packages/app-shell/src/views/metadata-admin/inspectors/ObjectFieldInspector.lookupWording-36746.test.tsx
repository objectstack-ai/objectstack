// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36746 (r08) — a Lookup's 「关联对象」 row speaks the author's
 * language.
 *
 *  - The object picker's placeholder is a sentence (「选择对象…」), not the
 *    machine spelling `object_name`, it is not drawn in monospace, and a
 *    chevron says the input opens a list.
 *  - The "every record is selectable" hint and the related-list help name the
 *    target by its catalog label, never its API name nor a hard-coded English
 *    fallback.
 *  - Before a target is set neither hint is drawn: the filter area says to set
 *    the target first, and the related-list help is absent.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

const h = vi.hoisted(() => {
  const CATALOG: Array<Record<string, unknown>> = [{ name: 'crm_lead', label: '线索' }];
  const get = async (_type: string, name: string) =>
    name === 'crm_lead' ? { name, label: '线索', fields: { name: { type: 'text', label: '名称' } } } : null;
  const client = {
    get,
    withPreviewDrafts: (_on: boolean) => ({ list: async (_type: string) => CATALOG, get }),
    list: async (_type: string) => CATALOG,
    listDrafts: async () => [] as unknown[],
  };
  return { client };
});
vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));

// The inspector's dynamic imports, paid at collection, not in a clocked case.
import '@objectstack/formula';
import '@objectstack/lint';
import { ObjectFieldInspector } from './ObjectFieldInspector';
import { t, tFormat } from '../i18n';

// Resident before any case, so the zh render reads synchronously.
await loadStudioCatalogue('zh');

type Row = Record<string, unknown>;

afterEach(cleanup);

function renderLookup(fk: Row, locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  const draft: Row = {
    name: 'visit',
    label: '回访记录',
    sharingModel: 'public_read_write',
    fields: { subject: { type: 'text', label: '主题' }, lead: fk },
  };
  render(
    <ObjectFieldInspector
      type="object"
      name="visit"
      draft={draft}
      selection={{ kind: 'field', id: 'lead' }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={locale}
    />,
  );
}

const relatedObjectInput = (locale: 'zh-CN' | 'en-US') =>
  screen.getByLabelText(t('designer.field.relatedObject', locale)) as HTMLInputElement;

describe('a Lookup\'s related-object row speaks the author\'s language (objectstack#36746)', () => {
  it.each([
    ['zh-CN', '选择对象…'],
    ['en-US', 'Select object…'],
  ] as const)('%s: the picker\'s placeholder is a sentence, in prose type, with a chevron', (locale, placeholder) => {
    renderLookup({ type: 'lookup', label: '线索' }, locale);
    const input = relatedObjectInput(locale);
    expect(input.placeholder).toBe(placeholder);
    expect(input.placeholder).not.toMatch(/object_name/);
    expect(input.className).not.toMatch(/font-mono/);
    expect(input.parentElement?.querySelector('[data-testid="object-picker-chevron"]')).not.toBeNull();
  });

  it('with no target, neither hint is drawn: the filter area asks for the target first', () => {
    renderLookup({ type: 'lookup', label: '线索' });
    const text = document.body.textContent ?? '';
    expect(text).toContain(t('designer.field.lookup.setTargetFirst', 'zh-CN'));
    expect(text).not.toMatch(/所有 .* 记录均可选/);
    expect(text).not.toMatch(/related/);
    expect(screen.queryByTestId('field-related-list-help')).toBeNull();
    expect(text).not.toContain('父对象');
  });

  it('with a target, both hints name it by its catalog label, never its API name', async () => {
    renderLookup({ type: 'lookup', label: '线索', reference: 'crm_lead' });
    const noFilter = tFormat('designer.field.lookup.noFilter', 'zh-CN', { ref: '线索' });
    expect(await screen.findByText(noFilter)).toBeTruthy();
    const help = screen.getByTestId('field-related-list-help');
    expect(help.textContent).toBe(tFormat('designer.field.relatedList.help.shown', 'zh-CN', { ref: '线索' }));
    expect(document.body.textContent).not.toContain('所有 crm_lead 记录');
    expect(help.textContent).not.toContain('crm_lead');
  });
});
