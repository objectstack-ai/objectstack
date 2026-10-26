/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:header` draws no breadcrumb slot, and an authored `breadcrumb` is
 * ignored (objectui#11166, triage ruling RETIRE).
 *
 * Until this change the renderer read `breadcrumb` (spec default `true`) and
 * drew an empty `data-page-breadcrumb-slot` div above the title in both
 * layouts. Nothing ever filled it, and the console's app header already draws
 * the trail, so the ruling retires the key rather than adding a second trail.
 * The spec half is objectstack#20758. Until that retirement reaches the
 * installed pin the contract still ACCEPTS the key, so an authored value has to
 * keep rendering without error: it is ignored, which is the old behaviour
 * minus the empty div.
 *
 * Pinned in both layouts, through the real `SchemaRenderer` and registry:
 *
 *  - `breadcrumb: true`, in `properties` and on the node, renders no slot;
 *  - the key ABSENT renders no slot either, and is the control: every authored
 *    spelling, `false` included, must render the SAME header as the absent
 *    key. Before this change `true` and the absent key drew the slot and
 *    `false` did not, so each row here was red;
 *  - the header is really there: its `<h1>` and the empty `actions` slot
 *    (`data-page-actions-slot`, which the `page-header-actions` suites own)
 *    render, so "no breadcrumb slot" cannot pass on a header that drew
 *    nothing.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ActionProvider, RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers every renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RECORD_OBJECT = {
  name: 'crm_account',
  label: 'Account',
  nameField: 'name',
  fields: { name: { type: 'text', label: 'Name' } },
};

type Layout = 'bare' | 'record';

function renderHeader(layout: Layout, schema: Record<string, unknown>) {
  const body = <SchemaRenderer schema={schema as never} />;
  const utils = render(
    <ActionProvider>
      {layout === 'record' ? (
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
    </ActionProvider>,
  );
  const header = utils.container.querySelector('header');
  expect(header, `${layout}: the page:header root`).not.toBeNull();
  return { ...utils, header: header as HTMLElement };
}

/**
 * The header's markup with React's generated ids blanked. Two separate mounts
 * number `useId` differently, and those ids are the only bytes allowed to
 * differ between an authored `breadcrumb` and an absent one.
 */
const ID_ATTRS = ['id', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'for'];
function markupOf(header: HTMLElement): string {
  const copy = header.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...Array.from(copy.querySelectorAll('*'))]) {
    for (const name of ID_ATTRS) if (el.hasAttribute(name)) el.setAttribute(name, 'ID');
  }
  return copy.outerHTML;
}

const TITLE: Record<Layout, string> = { bare: 'Orders', record: 'Acme' };

/** The authored spellings, each rendered against the absent-key control. */
const AUTHORED: ReadonlyArray<{ name: string; node: (layout: Layout) => Record<string, unknown> }> = [
  {
    name: '`properties.breadcrumb: true`',
    node: (layout) => ({
      type: 'page:header',
      properties: layout === 'bare' ? { title: TITLE.bare, breadcrumb: true } : { breadcrumb: true },
    }),
  },
  {
    name: '`breadcrumb: true` on the node',
    node: (layout) => ({
      type: 'page:header',
      breadcrumb: true,
      ...(layout === 'bare' ? { properties: { title: TITLE.bare } } : {}),
    }),
  },
  {
    name: '`properties.breadcrumb: false`',
    node: (layout) => ({
      type: 'page:header',
      properties: layout === 'bare' ? { title: TITLE.bare, breadcrumb: false } : { breadcrumb: false },
    }),
  },
];

const ABSENT = (layout: Layout) => ({
  type: 'page:header',
  ...(layout === 'bare' ? { properties: { title: TITLE.bare } } : {}),
});

describe('page:header draws no breadcrumb slot; an authored `breadcrumb` is ignored (objectui#11166)', () => {
  for (const layout of ['bare', 'record'] as const) {
    describe(`${layout} layout`, () => {
      it('CONTROL — the key absent: the header renders, with no breadcrumb slot', () => {
        const { header } = renderHeader(layout, ABSENT(layout));
        expect(header.querySelector('h1')?.textContent).toBe(TITLE[layout]);
        expect(header.querySelectorAll('[data-page-actions-slot]')).toHaveLength(1);
        expect(header.querySelector('[data-page-breadcrumb-slot]')).toBeNull();
      });

      for (const row of AUTHORED) {
        it(`${row.name} renders no slot and the same header as the absent key, without an error`, () => {
          const errors = vi.spyOn(console, 'error');
          const { header } = renderHeader(layout, row.node(layout));
          expect(header.querySelector('h1')?.textContent).toBe(TITLE[layout]);
          expect(header.querySelector('[data-page-breadcrumb-slot]')).toBeNull();
          // No slot, and no stray attribute either: the key reaches no element.
          expect(header.outerHTML).not.toMatch(/breadcrumb/i);
          expect(errors).not.toHaveBeenCalled();
          const authored = markupOf(header);
          cleanup();

          const { header: control } = renderHeader(layout, ABSENT(layout));
          expect(authored).toBe(markupOf(control));
        });
      }
    });
  }
});
