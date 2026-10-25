/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12145 — the mobile view switcher's trigger is named from the pack.
 *
 * `TabBarSelect`'s trigger carried `aria-label="Switch view"`, so a screen
 * reader under `zh` heard it in English. It now reads `topbar.switchView`, the
 * key the app header's view switcher already reads for the same name. The name
 * is read against the PACK, never against a literal.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { TabBarSelect, type ViewTab } from '../TabBar';

afterEach(cleanup);

const tabs: ViewTab[] = [
  { name: 'open', label: 'Open', isDefault: true },
  { name: 'mine', label: 'Mine' },
];

describe("the view switcher's trigger is named from the pack (objectui#12145)", () => {
  it('with no provider, it carries the en pack value', () => {
    render(<TabBarSelect tabs={tabs} />);
    expect(screen.getByRole('button', { name: en.topbar.switchView })).toBeInTheDocument();
  });

  it('under zh, it is named by the zh pack, not by the English words', async () => {
    expect(zh.topbar.switchView).not.toBe(en.topbar.switchView);
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <TabBarSelect tabs={tabs} />
      </I18nProvider>,
    );
    expect(await screen.findByRole('button', { name: zh.topbar.switchView })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.topbar.switchView })).toBeNull();
  });
});
