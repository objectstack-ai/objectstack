/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Seven blocks render the spec's nested `aria` bag (objectui#11083, batch 2).
 *
 * `@objectstack/spec` declares an `aria` member (`AriaPropsSchema`) on
 * `element:text_input`, `element:record_picker`, `element:metadata_viewer`,
 * `page:header`, `page:tabs`, `page:card` and `page:accordion`. Measured
 * through the real `SchemaRenderer` and registry before this change, under en
 * and zh, with a plain string and with a locale map: `properties: { aria: {
 * ariaLabel } }` rendered no `aria-label` anywhere on any of the seven. Each
 * renderer now spreads `resolveInlineAriaProps` from `@object-ui/react`, the
 * one reader of that bag, onto the element that carries the block:
 *
 *   element:text_input       the `input`
 *   element:record_picker    the `combobox` trigger
 *   element:metadata_viewer  the block's root `div`
 *   page:header              the `header` (both layouts)
 *   page:tabs                the `Tabs` root, not the tab list
 *   page:card                the `Card` root
 *   page:accordion           the `Accordion` root (both variants)
 *
 * Every case mounts through the real `SchemaRenderer` and registry, inside an
 * `I18nProvider` for the language under test. `createI18n` registers its
 * instance as react-i18next's module-global default and that survives
 * `cleanup()`, so a render without a provider would resolve against whichever
 * language an earlier case mounted.
 *
 * The lit control is `element:text`, whose bag objectui#11051 already renders:
 * it shows this harness can see a nested `aria-label` at all.
 *
 * The `feed` of `record:chatter` / `record:discussion`, the other two rows of
 * the batch, is pinned in `@object-ui/plugin-detail`
 * (`recordChatterFeedAria-11083.test.tsx`).
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ActionProvider, RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers every renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

/**
 * One fetch double at module scope, never torn down: a block can issue a read
 * after the test body returns, and no case here asserts on its answer.
 */
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ value: [], data: [], records: [] }),
  text: async () => '{}',
})) as never);

afterEach(cleanup);

const LOCALE_MAP = { en: 'Order desk', 'zh-CN': '订单台' };
const EXPECTED: Record<string, string> = { en: 'Order desk', zh: '订单台' };

const RECORD_OBJECT = {
  name: 'crm_account',
  label: 'Account',
  nameField: 'name',
  fields: { name: { type: 'text', label: 'Name' } },
};

type Mount = { record?: boolean };

/**
 * One row per read site. `node` builds the authored document around a bag,
 * and `carrier` finds the element that must carry the attributes, WITHOUT
 * reading any ARIA attribute, so a bag landing on the wrong element fails.
 */
const SITES: ReadonlyArray<{
  name: string;
  node: (aria?: object) => Record<string, unknown>;
  carrier: (container: HTMLElement) => Element | null;
  mount?: Mount;
}> = [
  {
    name: 'element:text_input',
    node: (aria) => ({ type: 'element:text_input', id: 'acct_name', properties: { label: 'Name', aria } }),
    carrier: (c) => c.querySelector('input'),
  },
  {
    name: 'element:record_picker',
    node: (aria) => ({ type: 'element:record_picker', id: 'acct', properties: { object: 'crm_account', label: 'Account', aria } }),
    carrier: (c) => c.querySelector('[data-testid="record-picker-trigger"]'),
  },
  {
    name: 'element:metadata_viewer',
    node: (aria) => ({ type: 'element:metadata_viewer', properties: { type: 'flow', name: 'approve_order', aria } }),
    carrier: (c) => c.firstElementChild,
  },
  {
    name: 'page:header',
    node: (aria) => ({ type: 'page:header', properties: { title: 'Orders', aria } }),
    carrier: (c) => c.querySelector('header'),
  },
  {
    name: 'page:header (record layout)',
    node: (aria) => ({ type: 'page:header', properties: { aria } }),
    carrier: (c) => c.querySelector('header'),
    mount: { record: true },
  },
  {
    name: 'page:tabs',
    node: (aria) => ({
      type: 'page:tabs',
      properties: { items: [{ label: 'One', children: [] }, { label: 'Two', children: [] }], aria },
    }),
    carrier: (c) => c.firstElementChild,
  },
  {
    name: 'page:card',
    node: (aria) => ({ type: 'page:card', properties: { title: 'Summary', aria } }),
    carrier: (c) => c.firstElementChild,
  },
  {
    name: 'page:accordion',
    node: (aria) => ({ type: 'page:accordion', properties: { items: [{ label: 'One', children: [] }], aria } }),
    carrier: (c) => c.firstElementChild,
  },
  {
    name: 'page:accordion (allowMultiple)',
    node: (aria) => ({
      type: 'page:accordion',
      properties: { allowMultiple: true, items: [{ label: 'One', children: [] }], aria },
    }),
    carrier: (c) => c.firstElementChild,
  },
];

function renderIn(language: string, schema: Record<string, unknown>, mount: Mount = {}) {
  const body = <SchemaRenderer schema={schema as never} />;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ActionProvider>
        {mount.record ? (
          <RecordContextProvider
            objectName="crm_account"
            recordId="rec-1"
            data={{ id: 'rec-1', name: 'Acme' }}
            objectSchema={RECORD_OBJECT}
          >
            {body}
          </RecordContextProvider>
        ) : (
          body
        )}
      </ActionProvider>
    </I18nProvider>,
  );
}

/** The site's carrier, required to exist. */
function carrierIn(site: (typeof SITES)[number], container: HTMLElement): Element {
  const el = site.carrier(container);
  expect(el, `${site.name}: carrier element`).not.toBeNull();
  return el as Element;
}

/** Every element whose `aria-label` is exactly `name`. */
function namedWith(container: HTMLElement, name: string): Element[] {
  return Array.from(container.querySelectorAll('[aria-label]')).filter((e) => e.getAttribute('aria-label') === name);
}

describe('the block-level nested aria bags render through the shared reader (objectui#11083)', () => {
  for (const site of SITES) {
    describe(site.name, () => {
      for (const language of ['en', 'zh']) {
        it(`a plain-string ariaLabel names the carrier under ${language}`, () => {
          const { container } = renderIn(language, site.node({ ariaLabel: 'Plain name' }), site.mount);
          expect(namedWith(container, 'Plain name')).toEqual([carrierIn(site, container)]);
        });

        it(`a locale-map ariaLabel names the carrier with the ${language} entry under ${language}`, () => {
          const { container } = renderIn(language, site.node({ ariaLabel: LOCALE_MAP }), site.mount);
          const expected = EXPECTED[language];
          const other = language === 'zh' ? EXPECTED.en : EXPECTED.zh;
          expect(namedWith(container, expected)).toEqual([carrierIn(site, container)]);
          expect(namedWith(container, other)).toEqual([]);
          expect(container.innerHTML).not.toContain('[object Object]');
        });
      }

      it('ariaDescribedBy and role reach the carrier', () => {
        const { container } = renderIn('en', site.node({ ariaDescribedBy: 'hint-1', role: 'group' }), site.mount);
        const carrier = carrierIn(site, container);
        expect(carrier.getAttribute('aria-describedby')).toBe('hint-1');
        expect(carrier.getAttribute('role')).toBe('group');
      });
    });
  }

  it('control: element:text renders its nested aria-label through the same harness', () => {
    const { container } = renderIn('zh', { type: 'element:text', properties: { content: 'Total', aria: { ariaLabel: LOCALE_MAP } } });
    expect(namedWith(container, '订单台').map((e) => e.tagName)).toEqual(['P']);
  });
});

describe("each site's default when nothing is authored (objectui#11083)", () => {
  it('the page blocks and the metadata viewer add no ARIA attribute and no role to their carrier', () => {
    for (const name of [
      'element:metadata_viewer',
      'page:header',
      'page:header (record layout)',
      'page:card',
      'page:accordion',
      'page:accordion (allowMultiple)',
    ]) {
      const site = SITES.find((s) => s.name === name)!;
      const carrier = carrierIn(site, renderIn('en', site.node(), site.mount).container);
      expect(carrier.hasAttribute('aria-label'), `${name}: aria-label`).toBe(false);
      expect(carrier.hasAttribute('aria-describedby'), `${name}: aria-describedby`).toBe(false);
      expect(carrier.hasAttribute('role'), `${name}: role`).toBe(false);
      cleanup();
    }
  });

  it("page:tabs keeps its Tabs root role-less and its tab list's own role", () => {
    const site = SITES.find((s) => s.name === 'page:tabs')!;
    const { container } = renderIn('en', site.node({ ariaLabel: 'Sections' }));
    const carrier = carrierIn(site, container);
    expect(carrier.getAttribute('aria-label')).toBe('Sections');
    expect(carrier.hasAttribute('role')).toBe(false);
    const list = carrier.querySelector('[role="tablist"]');
    expect(list, 'tab list inside the named root').not.toBeNull();
    expect(list!.hasAttribute('aria-label')).toBe(false);
  });

  it('element:record_picker keeps the trigger\'s combobox role, with or without a bag', () => {
    const site = SITES.find((s) => s.name === 'element:record_picker')!;
    for (const aria of [undefined, { ariaLabel: 'Account picker' }]) {
      const carrier = carrierIn(site, renderIn('en', site.node(aria)).container);
      expect(carrier.getAttribute('role')).toBe('combobox');
      cleanup();
    }
  });

  it('element:text_input keeps its description paragraph as the description, and adds an authored one to it', () => {
    const node = (aria?: object) => ({
      type: 'element:text_input',
      id: 'acct_name',
      properties: { label: 'Name', description: 'As on the contract', aria },
    });
    const plain = renderIn('en', node()).container;
    const input = plain.querySelector('input')!;
    const paragraphId = input.getAttribute('aria-describedby');
    expect(paragraphId).toBeTruthy();
    expect(plain.querySelector(`[id="${paragraphId}"]`)?.textContent).toBe('As on the contract');
    expect(input.hasAttribute('aria-label')).toBe(false);
    expect(input.hasAttribute('role')).toBe(false);
    cleanup();

    const authored = renderIn('en', node({ ariaDescribedBy: 'hint-1' })).container;
    const ids = authored.querySelector('input')!.getAttribute('aria-describedby')!.split(' ');
    expect(ids).toHaveLength(2);
    expect(authored.querySelector(`[id="${ids[0]}"]`)?.textContent).toBe('As on the contract');
    expect(ids[1]).toBe('hint-1');
  });
});
