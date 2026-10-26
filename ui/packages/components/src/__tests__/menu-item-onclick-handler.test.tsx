/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * All three menu renderers fire the DECLARED `MenuItem.onClick` (objectui#6346,
 * maintainer ruling 2026-08-27, "同意" on recommendation A): `dropdown-menu`
 * and `context-menu` used to read an undeclared `item.onSelect` instead — an
 * authored `onClick` validated, published, and never fired — and `menubar`
 * wired no item handler at all, neither spelling.
 *
 * The measured-zero migration cost the ruling records (0 authored `onSelect`
 * in-repo, positive controls firing) is what made this a renderer fix rather
 * than a rename of the published type; it is not re-verified here, since that
 * corpus measurement lives on the issue itself and would go stale silently
 * if restated as a test assertion against a fixture population.
 *
 * `renderMenuItems`/`renderContextMenuItems` also TIGHTEN from `items: any[]`
 * to `items: MenuItem[]` as part of this fix — the hole that let the
 * undeclared `onSelect` (and `inset`) type-check in the first place. That is
 * a compile-time property, pinned by the renderer files themselves compiling
 * under `tsc` (`pnpm --filter @object-ui/components type-check`) — an
 * `any`-typed regression would not show up as a runtime test failure here.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentRegistry } from '@object-ui/core';
import '../renderers';

afterEach(() => cleanup());

describe('ui:dropdown-menu — fires the declared `onClick` (objectui#6346)', () => {
  it('clicking a labelled item fires its authored `onClick`', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const C = ComponentRegistry.get('dropdown-menu') as React.ComponentType<any>;
    render(
      <C schema={{ type: 'dropdown-menu', defaultOpen: true, items: [{ label: 'Save', onClick }] }} />,
    );
    await user.click(screen.getByText('Save'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('an authored `onSelect` (the undeclared spelling) is never invoked', async () => {
    // `onSelect` is not part of `MenuItem` at all — this authors it anyway to
    // prove the renderer no longer reads it, mirroring how the pre-fix
    // renderer ignored the DECLARED `onClick`.
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const C = ComponentRegistry.get('dropdown-menu') as React.ComponentType<any>;
    render(
      <C schema={{ type: 'dropdown-menu', defaultOpen: true, items: [{ label: 'Save', onSelect }] }} />,
    );
    await user.click(screen.getByText('Save'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('ui:context-menu — fires the declared `onClick` (objectui#6346)', () => {
  function open(items: unknown[]) {
    const C = ComponentRegistry.get('context-menu') as React.ComponentType<any>;
    const { container } = render(
      <C schema={{ type: 'context-menu', trigger: { type: 'text', content: 'AREA' }, items }} />,
    );
    fireEvent.contextMenu(container.firstElementChild as HTMLElement);
  }

  it('clicking a labelled item fires its authored `onClick`', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    open([{ label: 'Copy', onClick }]);
    await user.click(screen.getByText('Copy'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('an authored `onSelect` (the undeclared spelling) is never invoked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    open([{ label: 'Copy', onSelect }]);
    await user.click(screen.getByText('Copy'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('ui:menubar — gains the wiring (objectui#6346 rider: menubar wired neither spelling before)', () => {
  async function openFileMenu(items: unknown[]) {
    const user = userEvent.setup();
    const C = ComponentRegistry.get('menubar') as React.ComponentType<any>;
    render(<C schema={{ type: 'menubar', menus: [{ label: 'File', items }] }} />);
    await user.click(screen.getByText('File'));
    return user;
  }

  it('clicking a labelled item fires its authored `onClick`', async () => {
    const onClick = vi.fn();
    const user = await openFileMenu([{ label: 'New Tab', onClick }]);
    await user.click(screen.getByText('New Tab'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a submenu child item also fires its authored `onClick`', async () => {
    const onClick = vi.fn();
    const user = await openFileMenu([
      { label: 'Recent', children: [{ label: 'report.csv', onClick }] },
    ]);
    await user.click(screen.getByText('Recent'));
    // `fireEvent.click`, not `userEvent.click`, on the nested item — Radix's
    // synthetic pointer sequence for `userEvent` interacts with the Sub's
    // hover-intent tracking across the trigger/content boundary in jsdom and
    // never dispatches the `select`; a plain `click` event is what Radix's
    // menu item listens for and is what a real click ultimately fires too.
    fireEvent.click(await screen.findByText('report.csv'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
