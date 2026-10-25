/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `element:*` renderers put the spec's nested `aria` bag on the DOM as real
 * attributes (objectui#11051).
 *
 * `element:text`, `element:button`, `element:image` and `element:number`
 * declare the spec's `AriaPropsSchema` as their `aria` prop. A helper in
 * `elements.tsx` used to put `aria-` in front of each key as written, so
 * `aria: { ariaLabel: 'Plain name' }` rendered `aria-arialabel="Plain name"`
 * and no `aria-label`, and a locale map rendered `[object Object]`. Each read
 * site now spreads `resolveInlineAriaProps` from `@object-ui/react`.
 *
 * Every case mounts through the real `SchemaRenderer` and registry, inside an
 * `I18nProvider`. `createI18n` registers its instance as react-i18next's
 * module-global default and that survives `cleanup()`, so a render without a
 * provider here would resolve against whichever language an earlier case
 * mounted.
 *
 * The control is a node that carries the FLAT `ariaLabel`, which
 * `SchemaRenderer` resolves in the keyed vocabulary and hands to the renderer
 * as a prop. That channel does not change.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer } from '@object-ui/react';
// Registers every renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const LOCALE_MAP = { en: 'Order total', 'zh-CN': '订单合计' };

/**
 * One row per `aria` read site in `elements.tsx`: the four element types, and
 * `element:number`'s "no object named" notice as its second site. `tag` is the
 * element that must carry the attributes.
 */
const SITES: ReadonlyArray<{ name: string; tag: string; node: (aria: object) => Record<string, unknown> }> = [
  { name: 'element:text', tag: 'P', node: (aria) => ({ type: 'element:text', properties: { content: 'Total', aria } }) },
  {
    name: 'element:button',
    tag: 'BUTTON',
    node: (aria) => ({ type: 'element:button', properties: { label: 'Open', aria } }),
  },
  {
    name: 'element:image',
    tag: 'IMG',
    node: (aria) => ({ type: 'element:image', properties: { src: '/logo.png', alt: '', aria } }),
  },
  { name: 'element:number', tag: 'DIV', node: (aria) => ({ type: 'element:number', properties: { aria } }) },
  {
    name: 'element:number (no object named)',
    tag: 'DIV',
    node: (aria) => ({ type: 'element:number', properties: { aggregate: 'count', aria } }),
  },
];

function renderIn(language: string, schema: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <SchemaRenderer schema={schema as never} />
    </I18nProvider>,
  );
}

/** The one element carrying `attr`; fails when there is none or more than one. */
function carrierOf(container: HTMLElement, attr: string): Element {
  const hits = container.querySelectorAll(`[${attr}]`);
  expect(hits.length, `elements carrying ${attr}`).toBe(1);
  return hits[0];
}

describe('element:* aria bag renders real attributes (objectui#11051)', () => {
  for (const site of SITES) {
    describe(site.name, () => {
      for (const language of ['en', 'zh']) {
        it(`a plain-string ariaLabel renders aria-label under ${language}`, () => {
          const { container } = renderIn(language, site.node({ ariaLabel: 'Plain name' }));
          const el = carrierOf(container, 'aria-label');
          expect(el.tagName).toBe(site.tag);
          expect(el.getAttribute('aria-label')).toBe('Plain name');
          expect(container.querySelector('[aria-arialabel]')).toBeNull();
        });
      }

      it('a locale-map ariaLabel renders the en entry under en', () => {
        const { container } = renderIn('en', site.node({ ariaLabel: LOCALE_MAP }));
        const el = carrierOf(container, 'aria-label');
        expect(el.tagName).toBe(site.tag);
        expect(el.getAttribute('aria-label')).toBe('Order total');
      });

      it('a locale-map ariaLabel renders the zh entry under zh', () => {
        const { container } = renderIn('zh', site.node({ ariaLabel: LOCALE_MAP }));
        const el = carrierOf(container, 'aria-label');
        expect(el.tagName).toBe(site.tag);
        expect(el.getAttribute('aria-label')).toBe('订单合计');
        expect(container.innerHTML).not.toContain('[object Object]');
      });

      it('ariaDescribedBy renders aria-describedby, and role renders role', () => {
        const { container } = renderIn('en', site.node({ ariaDescribedBy: 'hint-1', role: 'status' }));
        const el = carrierOf(container, 'aria-describedby');
        expect(el.tagName).toBe(site.tag);
        expect(el.getAttribute('aria-describedby')).toBe('hint-1');
        expect(el.getAttribute('role')).toBe('status');
        expect(container.querySelector('[aria-ariadescribedby]')).toBeNull();
      });
    });
  }
});

describe('the flat keyed ariaLabel on a control node is unchanged (objectui#11051)', () => {
  it('a plain string still renders aria-label, with its role', () => {
    const { container } = renderIn('en', { type: 'container', ariaLabel: 'Flat', role: 'region' });
    const el = carrierOf(container, 'aria-label');
    expect(el.getAttribute('aria-label')).toBe('Flat');
    expect(el.getAttribute('role')).toBe('region');
  });

  it('a keyed reference still renders its defaultValue', () => {
    const { container } = renderIn('zh', {
      type: 'container',
      ariaLabel: { key: 'probe.flat', defaultValue: 'Flat keyed' },
    });
    expect(carrierOf(container, 'aria-label').getAttribute('aria-label')).toBe('Flat keyed');
  });
});
