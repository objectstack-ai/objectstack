/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The page root reads its nested `aria` bag (objectui#11083).
 *
 * The spec's `PageSchema` declares `aria` as `AriaPropsSchema`, and
 * `PageNodeSchema` mirrors it. `PageRenderer` hands its wrapper `toDomProps`,
 * which keeps DOM attributes only, so the `aria` OBJECT was dropped there and
 * `{ type: 'page', aria: { ariaLabel: 'Page name' } }` rendered no
 * `aria-label` anywhere. The wrapper now spreads `resolveInlineAriaProps`
 * from `@object-ui/react`, the one reader of that bag.
 *
 * Every case mounts through the real `SchemaRenderer` and registry, inside an
 * `I18nProvider` for the language under test. `createI18n` registers its
 * instance as react-i18next's module-global default and that survives
 * `cleanup()`, so a render without a provider would resolve against whichever
 * language an earlier case mounted.
 *
 * The control is the FLAT `ariaLabel` on the same page, which `SchemaRenderer`
 * resolves in the keyed vocabulary and `toDomProps` forwards. It shows the
 * harness can see an `aria-label` on the wrapper at all; that channel does not
 * change.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Registers every renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

afterEach(cleanup);

const LOCALE_MAP = { en: 'Order desk', 'zh-CN': '订单台' };

/** A page with one body node, so the wrapper is not the only element. */
function pageNode(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'page',
    pageType: 'app',
    label: 'Orders',
    children: [{ type: 'element:text', properties: { content: 'body' } }],
    ...extra,
  };
}

function renderIn(language: string, schema: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ActionProvider>
        <SchemaRenderer schema={schema as never} />
      </ActionProvider>
    </I18nProvider>,
  );
}

/** The page's own wrapper, the element `data-page-type` marks. */
function wrapperOf(container: HTMLElement): Element {
  const hits = container.querySelectorAll('[data-page-type]');
  expect(hits.length, 'page wrappers').toBe(1);
  return hits[0];
}

/** The one element carrying `attr`; fails when there is none or more than one. */
function carrierOf(container: HTMLElement, attr: string): Element {
  const hits = container.querySelectorAll(`[${attr}]`);
  expect(hits.length, `elements carrying ${attr}`).toBe(1);
  return hits[0];
}

describe('the page root renders its nested aria bag (objectui#11083)', () => {
  for (const language of ['en', 'zh']) {
    it(`a plain-string ariaLabel renders aria-label on the page root under ${language}`, () => {
      const { container } = renderIn(language, pageNode({ aria: { ariaLabel: 'Page name' } }));
      expect(carrierOf(container, 'aria-label')).toBe(wrapperOf(container));
      expect(wrapperOf(container).getAttribute('aria-label')).toBe('Page name');
    });
  }

  it('a locale-map ariaLabel renders the en entry under en', () => {
    const { container } = renderIn('en', pageNode({ aria: { ariaLabel: LOCALE_MAP } }));
    expect(carrierOf(container, 'aria-label')).toBe(wrapperOf(container));
    expect(wrapperOf(container).getAttribute('aria-label')).toBe('Order desk');
  });

  it('a locale-map ariaLabel renders the zh entry under zh', () => {
    const { container } = renderIn('zh', pageNode({ aria: { ariaLabel: LOCALE_MAP } }));
    expect(carrierOf(container, 'aria-label')).toBe(wrapperOf(container));
    expect(wrapperOf(container).getAttribute('aria-label')).toBe('订单台');
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('ariaDescribedBy renders aria-describedby, and role renders role, on the page root', () => {
    const { container } = renderIn('en', pageNode({ aria: { ariaDescribedBy: 'hint-1', role: 'main' } }));
    const wrapper = wrapperOf(container);
    expect(carrierOf(container, 'aria-describedby')).toBe(wrapper);
    expect(wrapper.getAttribute('aria-describedby')).toBe('hint-1');
    expect(wrapper.getAttribute('role')).toBe('main');
  });

  it('a page that authors no aria bag adds no ARIA attribute and no default role', () => {
    const wrapper = wrapperOf(renderIn('en', pageNode({})).container);
    expect(wrapper.hasAttribute('aria-label')).toBe(false);
    expect(wrapper.hasAttribute('aria-describedby')).toBe(false);
    expect(wrapper.hasAttribute('role')).toBe(false);
  });

  it('control: the flat keyed ariaLabel still reaches the page root', () => {
    const { container } = renderIn('en', pageNode({ ariaLabel: 'Flat name' }));
    expect(carrierOf(container, 'aria-label')).toBe(wrapperOf(container));
    expect(wrapperOf(container).getAttribute('aria-label')).toBe('Flat name');
  });
});
