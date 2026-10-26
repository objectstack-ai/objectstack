/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-view` no longer publishes `showRefresh` (objectui#5567).
 *
 * The key was a declared, documented, defaulted designer input that NOTHING
 * read: `ObjectView` never consulted it, and it is not among
 * `OBJECT_VIEW_DECLARED_FORWARDED_KEYS`, so an author's `showRefresh: false`
 * was always a no-op. The 2026-08-22 maintainer ruling (Option A, per the
 * 2026-07 audit's recorded disposition) removed the designer input and its
 * default rather than wiring it up — and ruled that the affordance is NOT
 * resurrected here. The real refresh channel is `userActions.refresh`,
 * rendered by the list toolbar in `@object-ui/plugin-list`.
 *
 * This file is that ruling's pin. If `showRefresh` reappears on the
 * `object-view` registration (input or default), re-open objectui#5567
 * before landing the change — implementing the toggle was Option B, which
 * was considered and rejected.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';

// Module scope, not a hook: this import IS the registration.
import '../index';

const configOf = (type: string) =>
  ComponentRegistry.getConfig(type) as
    | { inputs?: Array<{ name: string }>; defaultProps?: Record<string, unknown> }
    | undefined;

describe('object-view: the retired `showRefresh` toggle stays retired (objectui#5567)', () => {
  it('publishes no `showRefresh` designer input', () => {
    const inputNames = (configOf('object-view')?.inputs ?? []).map((i) => i.name);
    expect(
      inputNames,
      '`object-view` publishes `showRefresh` again. Nothing in this package reads the key — the\n'
        + 'maintainer ruling on objectui#5567 removed it and keeps the refresh affordance on\n'
        + '`userActions.refresh` (plugin-list). Re-open objectui#5567 before landing this.',
    ).not.toContain('showRefresh');
    // The control: without it, "does not contain" would pass just as happily
    // against a registration that publishes nothing at all.
    expect(inputNames).toEqual(
      expect.arrayContaining(['showSearch', 'showFilters', 'showCreate', 'showViewSwitcher']),
    );
  });

  it('asserts no `showRefresh` default', () => {
    const defaults = configOf('object-view')?.defaultProps ?? {};
    expect(
      defaults,
      'The `object-view` registration defaults `showRefresh` again — a default asserts a value\n'
        + 'for a key nothing reads (objectui#5567). Re-open the card before landing this.',
    ).not.toHaveProperty('showRefresh');
    // Control: the surviving toolbar defaults are still asserted, so this test
    // is reading the real registration rather than an empty object.
    expect(defaults).toMatchObject({ showCreate: true, showViewSwitcher: true });
  });
});
