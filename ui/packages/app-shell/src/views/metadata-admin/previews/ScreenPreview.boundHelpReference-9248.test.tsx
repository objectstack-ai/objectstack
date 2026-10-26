// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9248 — the Studio screen preview draws a screen field's `min` /
 * `max`, `inlineHelpText` and `reference` (objectstack#17306) the way the
 * runtime dialog does.
 *
 * The preview renders through the shared `ScreenView`, but it first builds its
 * `ScreenSpec` from the authored node config (`buildScreenSpec`), and that
 * projection chooses which keys reach the renderer. Rendering the keys in
 * `ScreenView` alone therefore leaves the preview drawing a field without
 * them — so the projection is pinned here, on the rendered preview.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
// Module scope, per AGENTS.md 测试纪律: the lookup arm reaches `LookupField`
// through a `React.lazy` factory inside `@object-ui/fields`.
import '@object-ui/fields';

vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => null,
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ objects: [] }),
}));

import { ScreenPreview } from './ScreenPreview';
import { buildScreenSpec } from './screen-spec';

afterEach(cleanup);

const FIELDS = [
  { name: 'qty', label: 'Quantity', type: 'number', min: 1, max: 10, inlineHelpText: 'Between one and ten' },
  { name: 'acct', label: 'Account', type: 'lookup', reference: 'account' },
];

describe('objectui#9248 — the screen preview renders the three keys', () => {
  it('the numeric input carries the bounds and the help text describes it', () => {
    render(<ScreenPreview node={{ id: 's1', config: { title: 'Order', fields: FIELDS } }} />);
    const qty = screen.getByRole('spinbutton', { name: 'Quantity' });
    expect(qty).toHaveAttribute('min', '1');
    expect(qty).toHaveAttribute('max', '10');
    expect(qty).toHaveAccessibleDescription('Between one and ten');
  });

  it('a lookup with a `reference` renders the picker, not a text box', async () => {
    render(<ScreenPreview node={{ id: 's1', config: { title: 'Order', fields: FIELDS } }} />);
    expect(await screen.findByTestId('lookup-trigger-acct')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Account' })).toBeNull();
  });

  it('buildScreenSpec carries each key only when it holds the declared type', () => {
    const spec = buildScreenSpec({
      id: 'n1',
      config: {
        fields: [
          ...FIELDS,
          // A half-typed row: none of these is the type the spec declares.
          { name: 'half', min: '1', max: null, inlineHelpText: 3, reference: {} },
        ],
      },
    });
    expect(spec.fields).toEqual([
      { name: 'qty', label: 'Quantity', type: 'number', required: false, min: 1, max: 10, inlineHelpText: 'Between one and ten' },
      { name: 'acct', label: 'Account', type: 'lookup', required: false, reference: 'account' },
      { name: 'half', label: undefined, type: undefined, required: false },
    ]);
  });
});
