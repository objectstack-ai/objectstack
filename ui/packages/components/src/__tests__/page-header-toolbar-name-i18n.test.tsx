/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The page header's action toolbar speaks the session locale —
 * objectstack#5430.
 *
 * `page:header` wraps its action buttons in a `role="toolbar"` whose accessible
 * name was the English literal "Page header actions". A toolbar has no visible
 * label, so that literal IS the group as far as a screen reader is concerned:
 * under a zh/ja session it announced the only English left in the header row.
 * (#5407 fixed the `⋯` trigger eight lines below it and missed this one.)
 *
 * It now reads `detail.pageHeaderActions`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `page:header` at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const schema = {
  type: 'page:header',
  title: 'Acme Corp',
  actions: [
    { name: 'convert', locations: ['record_header'], label: 'Convert', type: 'flow' },
    { name: 'clone', locations: ['record_header'], label: 'Clone', type: 'flow' },
  ],
};

function renderHeaderIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ActionProvider>
        <PageHeader schema={schema} />
      </ActionProvider>
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('page:header action toolbar — accessible name (objectstack#5430)', () => {
  it('still reads English under an en session', () => {
    renderHeaderIn('en');

    expect(screen.getByRole('toolbar', { name: 'Page header actions' })).toBeTruthy();
  });

  it('reads the zh bundle value under a zh session', () => {
    renderHeaderIn('zh');

    expect(screen.getByRole('toolbar', { name: '页面标题栏操作' })).toBeTruthy();
    // The literal this replaced. Asserted negatively so a re-inlined English
    // string cannot pass by rendering a second, untranslated toolbar.
    expect(screen.queryByRole('toolbar', { name: 'Page header actions' })).toBeNull();
  });

  it('reads the ja bundle value under a ja session', () => {
    renderHeaderIn('ja');

    expect(screen.getByRole('toolbar', { name: 'ページヘッダーの操作' })).toBeTruthy();
    expect(screen.queryByRole('toolbar', { name: 'Page header actions' })).toBeNull();
  });
});
