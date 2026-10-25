/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The page header's overflow trigger speaks the session locale —
 * objectstack#5407.
 *
 * `page:header` collapses everything past `maxVisible` into a `⋯` button whose
 * accessible name was the English literal "More actions". The button is
 * icon-only, so that literal IS the button to a screen reader (and to a hover
 * tooltip): under a zh/ja/es session it was the only English left in the
 * header row.
 *
 * It now reads `detail.moreActions` — deliberately the SAME key `action:menu`'s
 * own overflow trigger already used, not a new one. A record page can show both
 * `⋯` buttons at once, and two keys would let them drift apart per locale.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `page:header` at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. Importing it here also keeps this
// file out of the `heavyDomTests` list: it brings its own registration instead
// of depending on the full DOM setup to have run one
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010/#3021).
import '../renderers';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

/** Four header actions against the default `maxVisible` of 3 → one overflows. */
const schema = {
  type: 'page:header',
  title: 'Acme Corp',
  actions: [
    { name: 'convert', locations: ['record_header'], label: 'Convert', type: 'flow' },
    { name: 'clone', locations: ['record_header'], label: 'Clone', type: 'flow' },
    { name: 'share', locations: ['record_header'], label: 'Share', type: 'flow' },
    { name: 'archive', locations: ['record_header'], label: 'Archive', type: 'flow' },
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

describe('page:header overflow trigger — accessible name (objectstack#5407)', () => {
  it('reads the zh bundle value under a zh session', () => {
    renderHeaderIn('zh');

    expect(screen.getByRole('button', { name: '更多操作' })).toBeTruthy();
    // The literal this replaced. Asserted negatively too: a re-inlined English
    // string would still let the positive assertion pass if the header ever
    // rendered two overflow triggers.
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('reads the ja bundle value under a ja session', () => {
    renderHeaderIn('ja');

    expect(screen.getByRole('button', { name: 'その他の操作' })).toBeTruthy();
  });

  it('still reads English under an en session', () => {
    renderHeaderIn('en');

    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
  });
});
