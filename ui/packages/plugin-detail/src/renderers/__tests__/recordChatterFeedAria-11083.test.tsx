/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `feed.aria` bag of `record:chatter` / `record:discussion` is rendered
 * (objectui#11083, batch 2).
 *
 * `@objectstack/spec` declares `RecordChatterProps.feed` as
 * `RecordActivityProps`, `aria` included, for both block names. Measured
 * through the real `SchemaRenderer` and registry before this change, under en
 * and zh, with a plain string and with a locale map: `properties: { feed: {
 * aria: { ariaLabel } } }` rendered no such `aria-label` anywhere.
 *
 * `RecordChatterPanel` now reads `feed.aria` the way `record:activity` reads its
 * own bag: through `useRecordAriaProps` (built on the shared
 * `resolveInlineAriaProps`), onto a `div` around the embedded timeline. So an
 * authored name is carried by a `region` around the timeline, whose own section
 * keeps its heading's name. Each case reads the accessibility tree, not the
 * attribute: an attribute on a role-less `div` would be green here and inert
 * for a screen-reader user (`recordComponentAria.ts` explains why).
 *
 * Every case mounts through the real `SchemaRenderer` and registry, inside an
 * `I18nProvider` for the language under test, for both block names and both
 * panel layouts (`bottom`, the renderer's default, and the `right` sidebar).
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, cleanup, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers the package's renderers at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../index';

/**
 * One fetch double at module scope, never torn down: a block can issue a read
 * after the test body returns, and no case here asserts on its answer.
 */
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ allowed: true, value: [], data: [], records: [] }),
  text: async () => '{"allowed":true}',
})) as never);

afterEach(cleanup);

const LOCALE_MAP = { en: 'Order conversation', 'zh-CN': '订单讨论' };
const EXPECTED: Record<string, string> = { en: 'Order conversation', zh: '订单讨论' };
/** The timeline section's own name: its heading, in the language under test. */
const TIMELINE_NAME: Record<string, string> = { en: 'Discussion', zh: '讨论' };

const BLOCKS = ['record:chatter', 'record:discussion'] as const;
const POSITIONS = ['bottom', 'right'] as const;

function chatter(
  type: (typeof BLOCKS)[number],
  position: (typeof POSITIONS)[number],
  feedAria?: object,
  ownAria?: object,
) {
  return {
    type,
    properties: {
      position,
      ...(ownAria ? { aria: ownAria } : {}),
      ...(feedAria ? { feed: { aria: feedAria } } : {}),
    },
  };
}

function mountIn(language: string, schema: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_account" recordId="rec-1" data={{ id: 'rec-1' }}>
        <SchemaRenderer schema={schema as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/** The timeline's own section, found by its heading's name. */
function timelineIn(language: string): HTMLElement {
  return screen.getByRole('region', { name: TIMELINE_NAME[language] });
}

describe('record:chatter / record:discussion feed.aria (objectui#11083)', () => {
  for (const type of BLOCKS) {
    for (const position of POSITIONS) {
      describe(`${type}, position ${position}`, () => {
        for (const language of ['en', 'zh']) {
          it(`a plain-string feed ariaLabel names a region around the timeline under ${language}`, () => {
            mountIn(language, chatter(type, position, { ariaLabel: 'Order conversation' }));
            const region = screen.getByRole('region', { name: 'Order conversation' });
            expect(within(region).getByRole('region', { name: TIMELINE_NAME[language] })).toBe(timelineIn(language));
          });

          it(`a locale-map feed ariaLabel names that region with the ${language} entry under ${language}`, () => {
            const { container } = mountIn(language, chatter(type, position, { ariaLabel: LOCALE_MAP }));
            const other = language === 'zh' ? EXPECTED.en : EXPECTED.zh;
            const region = screen.getByRole('region', { name: EXPECTED[language] });
            expect(region).toContainElement(timelineIn(language));
            expect(screen.queryByRole('region', { name: other })).toBeNull();
            expect(container.innerHTML).not.toContain('[object Object]');
          });
        }

        it('feed ariaDescribedBy and role reach the element around the timeline', () => {
          mountIn('en', chatter(type, position, { ariaDescribedBy: 'hint-1', role: 'feed' }));
          const wrapper = timelineIn('en').parentElement!;
          expect(wrapper.getAttribute('role')).toBe('feed');
          expect(wrapper.getAttribute('aria-describedby')).toBe('hint-1');
        });

        it('with no feed aria, the element around the timeline carries no attribute and no role', () => {
          mountIn('en', chatter(type, position));
          const wrapper = timelineIn('en').parentElement!;
          expect(wrapper.tagName).toBe('DIV');
          expect(wrapper.attributes).toHaveLength(0);
          // The timeline keeps its own heading's name.
          expect(timelineIn('en')).toHaveAttribute('aria-label', 'Discussion');
        });
      });
    }

    it(`${type}: the block's own aria and the feed's aria name two different regions`, () => {
      const { container } = mountIn('en', chatter(type, 'bottom', { ariaLabel: 'Feed name' }, { ariaLabel: 'Block name' }));
      const block = screen.getByRole('region', { name: 'Block name' });
      const feed = screen.getByRole('region', { name: 'Feed name' });
      expect(block).toBe(container.firstElementChild);
      expect(block).not.toBe(feed);
      expect(block).toContainElement(feed);
      expect(feed).toContainElement(timelineIn('en'));
    });
  }
});
