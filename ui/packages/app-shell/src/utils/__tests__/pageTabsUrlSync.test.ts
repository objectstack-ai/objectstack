/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { withPageTabsUrlSync } from '../pageTabsUrlSync';

const onTabChange = () => {};

describe('withPageTabsUrlSync (objectui#2257)', () => {
  const page = {
    type: 'page',
    regions: [
      {
        name: 'main',
        components: [
          { type: 'page:header' },
          { type: 'page:tabs', items: [{ label: 'Details', value: 'details', children: [] }] },
        ],
      },
      {
        name: 'aside',
        components: [{ type: 'record:reference_rail' }],
      },
    ],
  };

  it('injects defaultTab + onTabChange into every page:tabs node', () => {
    const out: any = withPageTabsUrlSync(page, { defaultTab: 'related', onTabChange });
    const tabs = out.regions[0].components[1];
    expect(tabs.defaultTab).toBe('related');
    expect(tabs.onTabChange).toBe(onTabChange);
  });

  it('never mutates the input tree (authored pages may be shared/memoized)', () => {
    const before = JSON.stringify(page);
    withPageTabsUrlSync(page, { defaultTab: 'related', onTabChange });
    expect(JSON.stringify(page)).toBe(before);
  });

  it('clones only the path to the tabs node; untouched branches keep identity', () => {
    const out: any = withPageTabsUrlSync(page, { defaultTab: 'x', onTabChange });
    expect(out).not.toBe(page);
    expect(out.regions[0].components[0]).toBe(page.regions[0].components[0]); // sibling node
    expect(out.regions[1]).toBe(page.regions[1]); // untouched region
  });

  it('reaches page:tabs nested under children containers', () => {
    const nested = {
      type: 'page',
      children: [{ type: 'page:card', children: [{ type: 'page:tabs', items: [] }] }],
    };
    const out: any = withPageTabsUrlSync(nested, { defaultTab: 't', onTabChange });
    expect(out.children[0].children[0].defaultTab).toBe('t');
  });

  it('returns the input unchanged when there is no page:tabs node', () => {
    const noTabs = { type: 'page', regions: [{ components: [{ type: 'page:header' }] }] };
    expect(withPageTabsUrlSync(noTabs, { defaultTab: 'x', onTabChange })).toBe(noTabs);
  });

  it('omitting defaultTab still wires onTabChange (first tab stays default)', () => {
    const out: any = withPageTabsUrlSync(page, { onTabChange });
    const tabs = out.regions[0].components[1];
    expect(tabs.defaultTab).toBeUndefined();
    expect(tabs.onTabChange).toBe(onTabChange);
  });
});
