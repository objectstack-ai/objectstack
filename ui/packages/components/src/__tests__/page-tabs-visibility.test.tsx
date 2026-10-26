/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Conditional tabs (framework#2606): a `page:tabs` item's `visibleWhen` CEL
 * predicate removes the WHOLE tab (header + panel) when FALSE — unlike a
 * child component's own `visibleWhen`, which hides only the panel content and
 * leaves an empty tab header behind. Proves:
 *   1. A statically-false predicate omits the tab header entirely.
 *   2. Predicates re-evaluate LIVE against page variables (`page.<var>`),
 *      both as bare CEL strings and as the `{ dialect, source }` Expression
 *      envelope the spec emits at parse.
 *   3. When the ACTIVE tab is hidden, the strip falls back to the first
 *      visible tab — no blank panel.
 *   4. Items without `visibleWhen` are untouched (back-compat), and only the
 *      canonical ADR-0089 key is read — the deprecated `visibility` alias is
 *      NOT honored on this new surface.
 */

import { describe, it, expect } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, PageVariablesProvider, usePageVariables } from '@object-ui/react';
import type { PublicBlockNodeOf } from '@object-ui/types';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

/** Writer that flips a page variable on click — stands in for an interactive element. */
function Writer({ name, value }: { name: string; value: any }) {
  const { setVariable } = usePageVariables();
  return (
    <button type="button" onClick={() => setVariable(name, value)}>
      write
    </button>
  );
}

const tabsSchema = (items: any[]): PublicBlockNodeOf<'page:tabs'> => ({ type: 'page:tabs', id: 'tabs', properties: { items } });

const textChild = (content: string) => [
  { type: 'element:text', properties: { content } },
];

describe('page:tabs item visibleWhen (framework#2606)', () => {
  it('omits the whole tab (header) when the predicate is statically false', () => {
    const { queryByText, getByText } = render(
      <SchemaRenderer
        schema={tabsSchema([
          { label: 'Details', value: 'details', children: textChild('DETAILS BODY') },
          { label: 'Related', value: 'related', children: [] },
          { label: 'Contracts', value: 'contracts', visibleWhen: '1 == 2', children: [] },
        ])}
      />,
    );
    expect(getByText('Details')).toBeTruthy();
    expect(getByText('Related')).toBeTruthy();
    expect(queryByText('Contracts')).toBeNull(); // header gone, not just the panel
    expect(getByText('DETAILS BODY')).toBeTruthy(); // first tab still active
  });

  it('keeps items without visibleWhen untouched (back-compat)', () => {
    const { getByText } = render(
      <SchemaRenderer
        schema={tabsSchema([
          { label: 'Details', value: 'details', children: [] },
          { label: 'Related', value: 'related', children: [] },
        ])}
      />,
    );
    expect(getByText('Details')).toBeTruthy();
    expect(getByText('Related')).toBeTruthy();
  });

  it('re-evaluates LIVE against page variables — a hidden tab appears when its predicate flips true', () => {
    const { queryByText, getByText } = render(
      <PageVariablesProvider definitions={[{ name: 'mode', type: 'string', source: 'w' }]}>
        <Writer name="mode" value="customer" />
        <SchemaRenderer
          schema={tabsSchema([
            { label: 'Details', value: 'details', children: [] },
            { label: 'Related', value: 'related', children: [] },
            {
              label: 'Contracts',
              value: 'contracts',
              visibleWhen: "page.mode == 'customer'",
              children: [],
            },
          ])}
        />
      </PageVariablesProvider>,
    );
    expect(queryByText('Contracts')).toBeNull();
    act(() => {
      fireEvent.click(getByText('write'));
    });
    expect(getByText('Contracts')).toBeTruthy();
  });

  it('accepts the { dialect, source } Expression envelope the spec emits at parse', () => {
    const { queryByText, getByText } = render(
      <PageVariablesProvider definitions={[{ name: 'mode', type: 'string' }]}>
        <SchemaRenderer
          schema={tabsSchema([
            { label: 'Details', value: 'details', children: [] },
            { label: 'Related', value: 'related', children: [] },
            {
              label: 'Contracts',
              value: 'contracts',
              visibleWhen: { dialect: 'cel', source: "page.mode == 'customer'" },
              children: [],
            },
          ])}
        />
      </PageVariablesProvider>,
    );
    expect(getByText('Details')).toBeTruthy();
    expect(queryByText('Contracts')).toBeNull();
  });

  it('falls back to the first visible tab when the ACTIVE tab is hidden — no blank panel', () => {
    const { getByText, queryByText } = render(
      <PageVariablesProvider definitions={[{ name: 'stage', type: 'string', source: 'w' }]}>
        <Writer name="stage" value="closed" />
        <SchemaRenderer
          schema={tabsSchema([
            { label: 'Details', value: 'details', children: textChild('DETAILS BODY') },
            {
              label: 'Contracts',
              value: 'contracts',
              visibleWhen: "page.stage != 'closed'",
              children: textChild('CONTRACTS BODY'),
            },
            { label: 'Related', value: 'related', children: [] },
          ])}
        />
      </PageVariablesProvider>,
    );

    // Activate the conditional tab while it is visible (Radix triggers
    // activate on mousedown, not click).
    act(() => {
      fireEvent.mouseDown(getByText('Contracts'), { button: 0 });
    });
    expect(getByText('CONTRACTS BODY')).toBeTruthy();

    // Flip its predicate false — the whole tab vanishes and the strip falls
    // back to the first visible tab instead of leaving a blank panel.
    act(() => {
      fireEvent.click(getByText('write'));
    });
    expect(queryByText('Contracts')).toBeNull();
    expect(queryByText('CONTRACTS BODY')).toBeNull();
    expect(getByText('DETAILS BODY')).toBeTruthy();
  });

  it('does NOT honor the deprecated `visibility` alias on tab items (canonical key only, ADR-0089)', () => {
    const { getByText } = render(
      <SchemaRenderer
        schema={tabsSchema([
          { label: 'Details', value: 'details', children: [] },
          // Alias is ignored → the tab stays visible (the spec strips the key
          // at parse anyway; the renderer must not resurrect it).
          { label: 'Contracts', value: 'contracts', visibility: '1 == 2', children: [] },
        ])}
      />,
    );
    expect(getByText('Contracts')).toBeTruthy();
  });
});
