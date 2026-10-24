/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12920 — the two status panels' DEFAULT titles read the bundle:
 * `ElementDataSourceErrorPanel` reads `element.component.sourceUnresolved` and
 * `NoDataSourcePanel` reads `element.component.noDataSource`. Both were English
 * literals in the parameter list.
 *
 * Only an ABSENT `title` takes the default, as the parameter default did: a
 * passed title wins under every language, the empty string included.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { ElementDataSourceErrorPanel, NoDataSourcePanel } from '../ElementDataSourceGate';

afterEach(cleanup);

const inLanguage = (language: string, children: React.ReactNode) => (
  <I18nProvider persistLanguage={false} config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
    {children}
  </I18nProvider>
);

const heading = (container: HTMLElement) => container.querySelector('p.font-medium')?.textContent;

describe('ElementDataSourceErrorPanel — the default title reads the bundle (objectui#12920)', () => {
  it('with no title, under zh-CN, draws the zh default', () => {
    const { container } = render(inLanguage('zh-CN', <ElementDataSourceErrorPanel testId="probe" message="m" />));
    expect(heading(container)).toBe('无法解析此组件的数据源');
  });

  it('a passed title wins under zh-CN', () => {
    const { container } = render(
      inLanguage('zh-CN', <ElementDataSourceErrorPanel testId="probe" title="Authored title" message="m" />),
    );
    expect(heading(container)).toBe('Authored title');
  });

  it('a passed empty title wins too: it is not replaced by the default', () => {
    const { container } = render(inLanguage('zh-CN', <ElementDataSourceErrorPanel testId="probe" title="" />));
    expect(heading(container)).toBe('');
  });

  it('CONTROL: with no provider mounted, the inline default is the en pack value', () => {
    const { container } = render(<ElementDataSourceErrorPanel testId="probe" />);
    expect(heading(container)).toBe('This component’s data source could not be resolved');
  });
});

describe('NoDataSourcePanel — the default title reads the bundle (objectui#12920)', () => {
  it('with no title, under zh-CN, draws the zh default', () => {
    const { container } = render(inLanguage('zh-CN', <NoDataSourcePanel testId="probe" message="m" />));
    expect(heading(container)).toBe('未解析到数据源');
  });

  it('a passed title wins under zh-CN', () => {
    const { container } = render(inLanguage('zh-CN', <NoDataSourcePanel testId="probe" title="Authored title" />));
    expect(heading(container)).toBe('Authored title');
  });

  it('CONTROL: with no provider mounted, the inline default is the en pack value', () => {
    const { container } = render(<NoDataSourcePanel testId="probe" />);
    expect(heading(container)).toBe('No data source resolved');
  });
});
