/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29215 — dropdown-menu rows and tabs are 44 px touch targets at
 * phone width.
 *
 * Every overflow menu, row-action menu and tab strip the Console shows a phone
 * user is one of these shared primitives, so the floor lives in them. The test
 * environment has no layout engine, so the target is pinned as drawn: the
 * phone class below `sm`, and from `sm` up the class list the desktop had
 * before, token for token. `src/ui/dropdown-menu.tsx` and `src/ui/tabs.tsx` are
 * regenerated from the registry; the classes are declared patches in
 * `scripts/shadcn-local-patches.mjs`, whose own test proves the anchors.
 *
 * ⚠️ `open` on `DropdownMenu` is load-bearing: Radix mounts the content lazily,
 * so without it there is no row to read.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuLabel,
} from '../ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';

afterEach(() => cleanup());

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

/** Upstream's class lists, unchanged from `sm` up. */
const DESKTOP = {
  item:
    'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  choice:
    'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  subTrigger:
    'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  tabsList: 'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
  tabsTrigger:
    'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
};

/** The element carries exactly `phone` below `sm`, and `desktop` everywhere else. */
function expectPhoneOnly(el: Element, phone: string[], desktop: string) {
  const cls = tokens(el);
  expect(cls.filter((c) => c.startsWith('max-sm:'))).toEqual(phone);
  expect(cls.filter((c) => !c.startsWith('max-sm:'))).toEqual(desktop.split(' '));
}

describe('#29215 — dropdown-menu rows on a phone', () => {
  function renderMenu() {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>More</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Record</DropdownMenuLabel>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Follow</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">Compact</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Share</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Copy link</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
  }

  it('DropdownMenuItem: at least 44 px below sm, upstream classes from sm up', () => {
    renderMenu();
    expectPhoneOnly(screen.getByRole('menuitem', { name: 'Edit' }), ['max-sm:min-h-11'], DESKTOP.item);
  });

  it('DropdownMenuCheckboxItem: at least 44 px below sm, upstream classes from sm up', () => {
    renderMenu();
    expectPhoneOnly(screen.getByRole('menuitemcheckbox', { name: 'Follow' }), ['max-sm:min-h-11'], DESKTOP.choice);
  });

  it('DropdownMenuRadioItem: at least 44 px below sm, upstream classes from sm up', () => {
    renderMenu();
    expectPhoneOnly(screen.getByRole('menuitemradio', { name: 'Compact' }), ['max-sm:min-h-11'], DESKTOP.choice);
  });

  it('DropdownMenuSubTrigger: at least 44 px below sm, upstream classes from sm up', () => {
    renderMenu();
    expectPhoneOnly(screen.getByRole('menuitem', { name: 'Share' }), ['max-sm:min-h-11'], DESKTOP.subTrigger);
  });

  it('a label is not a control and keeps its height', () => {
    renderMenu();
    expect(tokens(screen.getByText('Record')).some((c) => c.startsWith('max-sm:'))).toBe(false);
  });

  it("a caller's own padding still merges, and the phone floor survives it", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Apps</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem className="py-2">Home</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const cls = tokens(screen.getByRole('menuitem', { name: 'Home' }));
    expect(cls).toContain('py-2');
    expect(cls).not.toContain('py-1.5');
    expect(cls).toContain('max-sm:min-h-11');
  });
});

describe('#29215 — tabs on a phone', () => {
  function renderTabs(listClass?: string, triggerClass?: string) {
    render(
      <Tabs defaultValue="details">
        <TabsList className={listClass}>
          <TabsTrigger value="details" className={triggerClass}>Details</TabsTrigger>
          <TabsTrigger value="related" className={triggerClass}>Related</TabsTrigger>
        </TabsList>
        <TabsContent value="details">Fields</TabsContent>
      </Tabs>,
    );
  }

  it('TabsTrigger: at least 44 px below sm, upstream classes from sm up', () => {
    renderTabs();
    for (const name of ['Details', 'Related']) {
      expectPhoneOnly(screen.getByRole('tab', { name }), ['max-sm:min-h-11'], DESKTOP.tabsTrigger);
    }
  });

  it('TabsList: grows with its triggers below sm, upstream h-10 from sm up', () => {
    renderTabs();
    expectPhoneOnly(screen.getByRole('tablist'), ['max-sm:h-auto'], DESKTOP.tabsList);
  });

  it("a caller's fixed height still wins on desktop, and the phone classes survive it", () => {
    // The AI chat header's compact switcher passes `h-7` / `h-6`.
    renderTabs('h-7 gap-0.5 p-0.5', 'h-6 px-2.5 text-xs');
    const list = tokens(screen.getByRole('tablist'));
    expect(list).toContain('h-7');
    expect(list).not.toContain('h-10');
    expect(list).toContain('max-sm:h-auto');
    const trigger = tokens(screen.getByRole('tab', { name: 'Details' }));
    expect(trigger).toContain('h-6');
    expect(trigger).toContain('max-sm:min-h-11');
  });

  it('TabsContent is not a control and gets no phone class', () => {
    renderTabs();
    expect(tokens(screen.getByRole('tabpanel')).some((c) => c.startsWith('max-sm:'))).toBe(false);
  });
});
