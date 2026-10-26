/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useRecordAriaProps` maps the `record:*` bag through the shared reader, in
 * the viewer's language (objectui#11083).
 *
 * The hook now builds on `resolveInlineAriaProps` from `@object-ui/react`,
 * resolved against `useDisplayLocale()`, and keeps only the block family's own
 * defaults and the refused-`label` report. `recordComponentAria-9556.test.tsx`
 * pins the name, role and description under `en`, and
 * `recordAriaLabelRetired-9945.test.tsx` pins the defaults and the report. This
 * file adds the `zh` half: a plain string and a locale map, each read off the
 * accessibility tree rather than the attribute, for the reason the 9556 file
 * gives.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
import { RecordHighlightsRenderer } from '../record-highlights';
import { RecordPathRenderer } from '../record-path';

/**
 * One fetch double at module scope, never torn down: a block can issue a read
 * after the test body returns, and no case here asserts on its answer (the
 * same reasoning `recordComponentAria-9556.test.tsx` records).
 */
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ allowed: true, value: [], data: [], records: [] }),
  text: async () => '{"allowed":true}',
})) as never);

afterEach(() => cleanup());

const LOCALE_MAP = { en: 'Account overview', 'zh-CN': '客户概览' };

function mountIn(language: string, node: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_account" recordId="rec-1" data={{ id: 'rec-1', stage: 'won' }}>
        {node}
      </RecordContextProvider>
    </I18nProvider>,
  );
}

const highlights = (aria?: unknown) => (
  <RecordHighlightsRenderer schema={{ fields: ['name'], ...(aria ? { aria } : {}) } as never} />
);

describe('record:* aria bag under zh (objectui#11083)', () => {
  it('a plain-string ariaLabel names the container under zh', () => {
    mountIn('zh', highlights({ ariaLabel: 'Account overview' }));
    expect(screen.getByRole('region', { name: 'Account overview' })).toBeInTheDocument();
  });

  it('a locale-map ariaLabel names the container with the zh entry under zh', () => {
    const { container } = mountIn('zh', highlights({ ariaLabel: LOCALE_MAP }));
    expect(screen.getByRole('region', { name: '客户概览' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Account overview' })).toBeNull();
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('a locale-map ariaLabel names the container with the en entry under en', () => {
    mountIn('en', highlights({ ariaLabel: LOCALE_MAP }));
    expect(screen.getByRole('region', { name: 'Account overview' })).toBeInTheDocument();
  });

  it("the caller's default role carries the authored locale-map name under zh", () => {
    // `record:path` passes `defaultRole: 'list'`; the authored name replaces its
    // built-in one and the default role stays.
    mountIn(
      'zh',
      <RecordPathRenderer
        schema={{
          statusField: 'stage',
          stages: [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }],
          aria: { ariaLabel: { en: 'Deal stages', 'zh-CN': '交易阶段' } },
        } as never}
      />,
    );
    expect(screen.getAllByRole('list', { name: '交易阶段' }).length).toBeGreaterThan(0);
  });
});
