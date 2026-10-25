/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:tabs.items` — the MEMBER SHAPE of one tab definition (objectui#8071).
 *
 * The member pin for this key. `PageTabsRenderer`
 * (`renderers/layout/containers.tsx`) reads SIX members off each element of
 * `items` — `label`, `value`, `icon`, `count`, `visibleWhen`, `children` — and
 * the registration publishes that set verbatim (`[{ label, value?, icon?,
 * count?, visibleWhen?, children }]`). Each becomes a DIFFERENT part of the
 * rendered strip, and this file pins the mapping as a set: label to the trigger
 * name, icon to the trigger's leading glyph, count to the trailing badge, value
 * to the tab's IDENTITY, children to the panel, `visibleWhen` to the tab's
 * existence.
 *
 * ## Why a new file rather than promoting one of the five that already exist
 *
 * All five were read end to end before this pin was written. Each is a good pin
 * on ONE member and asserts nothing about the mapping as a whole:
 *
 *   - `page-tabs-visibility.test.tsx` — `visibleWhen`, and thoroughly: whole-tab
 *     removal, live re-evaluation against page variables, the
 *     `{ dialect, source }` envelope, the active-tab fallback, and the
 *     deprecated `visibility` alias staying unread. It does exercise `label`
 *     and `children` as real members, which is why the two are not re-litigated
 *     in depth here.
 *   - `page-tabs-count-badge-i18n.test.tsx` — the badge's ACCESSIBLE NAME and
 *     its plural key selection, not which member feeds it.
 *   - `pageTabsUrlSync.test.ts` — `value` as the `?tab=` URL token, one layer up
 *     in `app-shell`, off this renderer entirely.
 *   - `page-tabs-always-show-strip.test.tsx` — the strip-visibility rule, a
 *     BLOCK-level key (`alwaysShowStrip`), not an item member.
 *   - `page-tabs-builtin-label-i18n-4645.test.tsx` — `label` localization of
 *     well-known English tokens.
 *
 * So no single existing file would fail if `count` and `value` swapped roles,
 * which is the shape a member pin has to catch.
 *
 * ## The two readings with real semantics to get wrong
 *
 * `count` is NOT rendered whenever it is present. The renderer gates on
 * `!== undefined && !== null && !== '' && Number(count) > 0`, so an authored
 * `count: 0` paints NO badge — a zero-count tab reads as a plain tab, not as a
 * tab wearing a `0`. And `value` is `typeof value === 'string' && value !== ''`
 * or else `tab-INDEX`: an authored value is the stable identity, an absent one
 * silently becomes positional. Both arms are pinned, because both are the kind
 * of thing a tidy-up edit rewrites without noticing.
 *
 * `value` is asserted BEHAVIOURALLY, through `defaultTab` — the host key
 * app-shell restores `?tab=` with, which is honoured "only when it names an
 * actual tab". Selecting a tab by its authored value proves the member IS the
 * identity, without reaching into Radix's generated element ids.
 *
 * Labels here are deliberately NOT well-known English tokens (`Details`,
 * `Related`, …): those route through `translateLabel`'s pack lookup, which is
 * `page-tabs-builtin-label-i18n-4645.test.tsx`'s subject. Plain names keep this
 * file's rows about member ROUTING rather than about i18n.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

vi.mock('../lib/lazy-icon', () => ({
  LazyIcon: ({ name, className }: { name?: string; className?: string }) => (
    <svg data-testid="tab-item-icon" data-name={name} className={className} />
  ),
}));

afterEach(() => cleanup());

const textChild = (content: string) => [{ type: 'element:text', properties: { content } }];

const renderTabs = (items: any[], rest: Record<string, unknown> = {}) =>
  render(<SchemaRenderer schema={{ type: 'page:tabs', id: 'tabs', items, ...rest } as never} />);

describe('page:tabs items — member shape (objectui#8071)', () => {
  it('`label` becomes the tab trigger and `children` becomes that tab PANEL', () => {
    // The two structural members against each other. Radix renders only the
    // ACTIVE panel, so the second tab's body being absent is part of the claim:
    // `children` is panel content, not strip content.
    const { getByRole, getByText, queryByText } = renderTabs([
      { label: 'Alpha', value: 'alpha', children: textChild('ALPHA BODY') },
      { label: 'Beta', value: 'beta', children: textChild('BETA BODY') },
    ]);

    expect(getByRole('tab', { name: /Alpha/i })).toBeTruthy();
    expect(getByRole('tab', { name: /Beta/i })).toBeTruthy();
    expect(getByText('ALPHA BODY')).toBeTruthy();
    expect(queryByText('BETA BODY')).toBeNull();
  });

  it('`value` is the tab IDENTITY — `defaultTab` selects a tab by the value its item authored', () => {
    // Behavioural pin on the member: the host restores a tab by NAME, so an
    // authored `value` has to be what names it.
    const { getByText, queryByText } = renderTabs(
      [
        { label: 'Alpha', value: 'alpha', children: textChild('ALPHA BODY') },
        { label: 'Beta', value: 'beta', children: textChild('BETA BODY') },
      ],
      { defaultTab: 'beta' },
    );

    // The SECOND tab is active because its item said `value: 'beta'` — not
    // because of its position.
    expect(getByText('BETA BODY')).toBeTruthy();
    expect(queryByText('ALPHA BODY')).toBeNull();
  });

  it('an item with NO `value` falls back to its positional `tab-INDEX` identity', () => {
    // The other arm of the same read. Same shape as the row above, with the
    // `value` members deleted — so a `defaultTab` naming the positional token
    // is what selects the second tab.
    const { getByText, queryByText } = renderTabs(
      [
        { label: 'Alpha', children: textChild('ALPHA BODY') },
        { label: 'Beta', children: textChild('BETA BODY') },
      ],
      { defaultTab: 'tab-1' },
    );

    expect(getByText('BETA BODY')).toBeTruthy();
    expect(queryByText('ALPHA BODY')).toBeNull();
  });

  it('an EMPTY-STRING `value` is not an identity — it falls back positionally too', () => {
    // `typeof value === 'string' && value !== ''`. Without this row a read of
    // just `typeof value === 'string'` would pass every assertion above.
    const { getByText, queryByText } = renderTabs(
      [
        { label: 'Alpha', value: '', children: textChild('ALPHA BODY') },
        { label: 'Beta', value: '', children: textChild('BETA BODY') },
      ],
      { defaultTab: 'tab-1' },
    );

    expect(getByText('BETA BODY')).toBeTruthy();
    expect(queryByText('ALPHA BODY')).toBeNull();
  });

  it('`count` becomes the trailing badge, and `icon` the leading glyph, on their OWN item', () => {
    // Per-item routing for the two decorative members, with a neighbour that
    // declares neither — so neither can be strip-wide.
    const { getAllByTestId, getByRole } = renderTabs([
      { label: 'Alpha', value: 'alpha', icon: 'user', count: 7, children: textChild('ALPHA BODY') },
      { label: 'Beta', value: 'beta', children: textChild('BETA BODY') },
    ]);

    const icons = getAllByTestId('tab-item-icon');
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute('data-name')).toBe('user');

    // The badge digits live inside the trigger that owns the count…
    expect(getByRole('tab', { name: /Alpha/i }).textContent).toContain('7');
    // …and not inside its neighbour.
    expect(getByRole('tab', { name: /Beta/i }).textContent).not.toContain('7');
  });

  it('`count: 0` paints NO badge — presence is not the gate, a positive value is', () => {
    // `Number(item.count) > 0`. A zero-count tab is a plain tab; the badge is an
    // affordance for "there is something in here", not a readout of the member.
    const { getByRole } = renderTabs([
      { label: 'Alpha', value: 'alpha', count: 0, children: textChild('ALPHA BODY') },
      { label: 'Beta', value: 'beta', count: 4, children: textChild('BETA BODY') },
    ]);

    expect(getByRole('tab', { name: /Alpha/i }).textContent).not.toContain('0');
    // The positive control on the same strip, same run: the gate really does
    // let a real count through, so the row above is a reading and not a
    // renderer that never badges anything.
    expect(getByRole('tab', { name: /Beta/i }).textContent).toContain('4');
  });

  it('`visibleWhen` removes the whole tab — trigger AND panel', () => {
    // Narrow on purpose: `page-tabs-visibility.test.tsx` is the pin for this
    // member's depth (live re-evaluation, the Expression envelope, the
    // active-tab fallback, the unread `visibility` alias). This row is here so
    // the member SET this file states is complete — six members, six routings.
    const { queryByRole, queryByText, getByRole } = renderTabs([
      { label: 'Alpha', value: 'alpha', children: textChild('ALPHA BODY') },
      { label: 'Beta', value: 'beta', children: textChild('BETA BODY') },
      { label: 'Gamma', value: 'gamma', visibleWhen: '1 == 2', children: textChild('GAMMA BODY') },
    ]);

    expect(getByRole('tab', { name: /Alpha/i })).toBeTruthy();
    expect(queryByRole('tab', { name: /Gamma/i })).toBeNull();
    expect(queryByText('GAMMA BODY')).toBeNull();
  });
});
