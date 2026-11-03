/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28868 — the owner appears once on the default record page, under
 * one word.
 *
 * - When the highlight strip carries the owner field (`owner_id`, the strip
 *   being the object's declared highlights), the meta line leaves the owner
 *   out; otherwise the meta line keeps it.
 * - The meta line's word (`detail.owner`) and the strip's word (the platform
 *   label of the injected `owner_id`, `@objectstack/spec`'s system-field
 *   fallback) are one word in every language both declare: 「负责人」 in zh,
 *   "Owner" in en.
 *
 * The page rules (no guessed strip, the stage once) are pinned in
 * `synth/__tests__/highlights-declaredOnly-28868.test.ts`.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { translateObject } from '@objectstack/spec/system';
import { builtInLocales } from '@object-ui/i18n/locales';
import { RecordMetaFooter } from '../RecordMetaFooter';
import { DefaultRecordPageContext } from '../defaultRecordPage';

afterEach(cleanup);

const onDefaultPage = (node: React.ReactNode) => (
  <DefaultRecordPageContext.Provider value>{node}</DefaultRecordPageContext.Provider>
);

const data = { id: 'C-1', created_at: '2026-10-16T00:00:00Z', owner_id: 'Ada Admin' };

const contact = (highlightFields?: string[]) => ({
  name: 'contact',
  ...(highlightFields ? { highlightFields } : {}),
  fields: {
    name: { type: 'text', label: 'Name' },
    email: { type: 'email', label: 'Email' },
    owner_id: { type: 'lookup', label: 'Owner' },
  },
});

const ownerEntry = (container: HTMLElement) => container.querySelector('[data-record-meta-owner]');

describe('the owner once: the meta line leaves the owner out when the strip carries it (objectstack#28868)', () => {
  it('a declared strip naming owner_id: the meta line has no owner', () => {
    const { container } = render(onDefaultPage(
      <RecordMetaFooter data={data} objectSchema={contact(['email', 'owner_id'])} />,
    ));
    expect(ownerEntry(container)).toBeNull();
    // The rest of the line is still drawn.
    expect(container.querySelector('[data-record-meta-id]')!.textContent).toBe('C-1');
  });

  it('control: a declared strip without owner_id keeps the owner on the meta line', () => {
    const { container } = render(onDefaultPage(
      <RecordMetaFooter data={data} objectSchema={contact(['email'])} />,
    ));
    expect(ownerEntry(container)).toBeTruthy();
  });

  it('control: no declared strip (so no strip at all) keeps the owner on the meta line', () => {
    const { container } = render(onDefaultPage(
      <RecordMetaFooter data={data} objectSchema={contact()} />,
    ));
    expect(ownerEntry(container)).toBeTruthy();
  });
});

describe('one word for the owner: detail.owner equals the platform label of owner_id (objectstack#28868)', () => {
  // The ui pack beside the spec's locale code for each language the spec's
  // system-field fallback declares.
  const pairs: Array<[specLocale: string, uiPack: keyof typeof builtInLocales]> = [
    ['en', 'en'],
    ['zh-CN', 'zh'],
    ['ja-JP', 'ja'],
    ['es-ES', 'es'],
  ];

  const platformOwnerLabel = (locale: string): unknown => {
    const doc = { name: 'contact', fields: { owner_id: { name: 'owner_id', type: 'lookup', label: 'Owner' } } };
    return (translateObject(doc, undefined, { locale }).fields as any).owner_id.label;
  };

  it.each(pairs)('%s: the strip and the meta line say the same word', (specLocale, uiPack) => {
    expect(platformOwnerLabel(specLocale)).toBe((builtInLocales[uiPack] as any).detail.owner);
  });

  it('the words the seat chose: 负责人 in zh, Owner in en', () => {
    expect((builtInLocales.zh as any).detail.owner).toBe('负责人');
    expect(platformOwnerLabel('zh-CN')).toBe('负责人');
    expect((builtInLocales.en as any).detail.owner).toBe('Owner');
    expect(platformOwnerLabel('en')).toBe('Owner');
  });
});
