// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Setup ships no packaged-automation page any more: neither the retired
// Packaged Automation entry (ADR-0146 D11) nor the retired Packaged Actions
// entry (objectstack#34724, the ADR-0146 D4 amendment of 2026-11-17).
//
// What retired, and where each switch went:
//  - Setup › Packaged automation's FLOWS half moved into Studio (D4 put the
//    flow switch on the flow's item, and its clone became Studio's New
//    similar), so `nav_packaged_automation`, its `automation:packaged` ref and
//    its page retired (D11).
//  - Its ACTIONS half stayed in Setup as `nav_packaged_actions`
//    (`automation:packaged-actions`) until the maintainer's 2026-11-17 call on
//    objectstack#34724 (「打包动作不是应该在 studio 对应的软件包中自定义吗」):
//    a packaged action's switch is now on the action, in its app in Studio,
//    and the platform's own actions carry no switch. The entry and the page
//    retired; the console sends a bookmark of the page to Studio.
//
// Why a pin: a re-added entry would render with nothing behind it (the
// console registers no component under either ref, and its router redirects
// both URLs to Studio), so nothing at runtime says it came back.
import { describe, it, expect } from 'vitest';

import { SETUP_NAV_CONTRIBUTIONS } from './setup-nav.contributions.js';

type NavItem = {
  id?: string;
  componentRef?: string;
  children?: NavItem[];
};

/** Every contributed Setup nav item, depth-first. */
const allItems = (): NavItem[] => {
  const out: NavItem[] = [];
  const walk = (items: NavItem[] = []) => {
    for (const item of items) {
      if (!item) continue;
      out.push(item);
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  for (const c of SETUP_NAV_CONTRIBUTIONS) walk((c.items ?? []) as NavItem[]);
  return out;
};

describe('Setup ships no packaged-automation page (ADR-0146 D4 as amended, D11)', () => {
  it('no entry names a retired id or a retired ref', () => {
    const items = allItems();
    // Control: the walk reads the real array.
    expect(items.some((i) => i.id === 'nav_users')).toBe(true);

    expect(items.filter((i) => i.id === 'nav_packaged_automation')).toEqual([]);
    expect(items.filter((i) => i.componentRef === 'automation:packaged')).toEqual([]);
    expect(items.filter((i) => i.id === 'nav_packaged_actions')).toEqual([]);
    expect(items.filter((i) => i.componentRef === 'automation:packaged-actions')).toEqual([]);
  });

  it('no contribution is an empty group_apps shell left behind', () => {
    expect(SETUP_NAV_CONTRIBUTIONS.filter((c) => c.group === 'group_apps')).toEqual([]);
  });
});
