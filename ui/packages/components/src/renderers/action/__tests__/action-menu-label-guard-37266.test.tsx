/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `action:menu` reads its labels through the shared `renderableLabel` guard
 * (`../renderable-label.ts`), the one `action:button` reads through.
 *
 * The contract's `label` is `z.string()`, localized through the translation
 * bundle entry for the component id. A locale map reaches the renderer only
 * from metadata that skipped `validateComponentProps`. Unguarded, the trigger
 * threw "Objects are not valid as a React child" and took the page down with
 * it. Guarded, it renders no label text, prints no `[object Object]`, and does
 * not translate the map.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { undeclaredNode } from '@object-ui/test-support';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Module scope, so the registry holds the renderer when `SchemaRenderer` resolves it.
import '../action-menu';

const LOCALE_MAP = { en: 'Approve', 'zh-CN': '批准' };

let run: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let warn: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  run = vi.fn(async () => ({ success: true }));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Radix warns about a missing dialog description in happy-dom; not the subject.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  consoleError.mockRestore();
  cleanup();
});

function mount(schema: Record<string, unknown>) {
  return render(
    <ActionProvider handlers={{ run }} onToast={vi.fn()}>
      <SchemaRenderer schema={undeclaredNode(schema)} />
    </ActionProvider>,
  );
}

/** Radix opens a dropdown on `pointerdown` and mounts its content in a portal. */
async function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}

const labelWarnings = () => warn.mock.calls.filter((args) => String(args[0]).includes('non-string label'));

describe('action:menu — a non-string label renders no text and never throws (#37266)', () => {
  it('a locale-map label on the menu and on a member: no throw, no `[object Object]`, nothing translated', async () => {
    mount({
      type: 'action:menu',
      id: 'menu_label_guard',
      label: LOCALE_MAP,
      actions: [{ name: 'approve', label: LOCALE_MAP, type: 'run' }],
    });

    // The trigger falls back to its default accessible name, with no label text.
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger.textContent).toBe('');

    // The member falls back to its `name`, as an unlabelled member always has.
    const menu = await openMenu(trigger);
    const item = screen.getByRole('menuitem');
    expect(item).toHaveTextContent('approve');
    expect(menu.textContent).not.toContain('[object Object]');
    expect(document.body.innerHTML).not.toContain('[object Object]');
    expect(document.body.textContent).not.toContain('批准');
    expect(document.body.textContent).not.toContain('Approve');

    // The member still runs, and the runner is handed no label.
    fireEvent.click(item);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((run.mock.calls[0][0] as ActionDef).label).toBeUndefined();

    // One development warning per component: the menu, and its member.
    const warned = labelWarnings().map((args) => String(args[0]));
    expect(warned).toHaveLength(2);
    expect(warned.some((m) => m.includes('action:menu "menu_label_guard"'))).toBe(true);
    expect(warned.some((m) => m.includes('action:menu "approve"'))).toBe(true);
  });

  it('CONTROL: string labels render as written, and the runner is handed the member label', async () => {
    mount({
      type: 'action:menu',
      id: 'menu_label_string',
      label: 'Row',
      actions: [{ name: 'approve', label: 'Approve', type: 'run' }],
    });
    const trigger = screen.getByRole('button', { name: 'Row' });
    expect(trigger).toHaveTextContent('Row');
    await openMenu(trigger);
    const item = screen.getByRole('menuitem');
    expect(item).toHaveTextContent('Approve');
    fireEvent.click(item);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((run.mock.calls[0][0] as ActionDef).label).toBe('Approve');
    expect(labelWarnings()).toHaveLength(0);
  });
});
