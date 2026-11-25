/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `action:group` reads its labels through the shared `renderableLabel` guard
 * (`../renderable-label.ts`), the one `action:button` reads through.
 *
 * The contract's `label` is `z.string()`, localized through the translation
 * bundle entry for the component id. A locale map reaches the renderer only
 * from metadata that skipped `validateComponentProps`. Unguarded, a member's
 * map threw "Objects are not valid as a React child" and the group's own map
 * did the same on the dropdown trigger. Guarded, each renders no label text,
 * prints no `[object Object]`, and does not translate the map.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { undeclaredNode } from '@object-ui/test-support';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Module scope, so the registry holds the renderer when `SchemaRenderer` resolves it.
import '../action-group';

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

const assertNothingLeaked = () => {
  expect(document.body.innerHTML).not.toContain('[object Object]');
  expect(document.body.textContent).not.toContain('批准');
  expect(document.body.textContent).not.toContain('Approve');
};

describe('action:group — a non-string label renders no text and never throws (#37266)', () => {
  it('inline: a locale-map member label renders a button with no text, which still runs with no label', async () => {
    mount({
      type: 'action:group',
      id: 'group_label_inline',
      actions: [{ name: 'approve', label: LOCALE_MAP, type: 'run' }],
    });
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('');
    assertNothingLeaked();

    fireEvent.click(button);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((run.mock.calls[0][0] as ActionDef).label).toBeUndefined();

    const warned = labelWarnings().map((args) => String(args[0]));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('action:group "approve"');
  });

  it('dropdown: a locale-map label on the group and on a member falls back to the defaults', async () => {
    mount({
      type: 'action:group',
      id: 'group_label_dropdown',
      display: 'dropdown',
      label: LOCALE_MAP,
      actions: [{ name: 'approve', label: LOCALE_MAP, type: 'run' }],
    });
    // The trigger's unlabelled default, and the member's `name`.
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveTextContent('Actions');
    await openMenu(trigger);
    expect(screen.getByRole('menuitem')).toHaveTextContent('approve');
    assertNothingLeaked();

    const warned = labelWarnings().map((args) => String(args[0]));
    expect(warned.some((m) => m.includes('action:group "group_label_dropdown"'))).toBe(true);
  });

  it('CONTROL: string labels render as written in both display modes', async () => {
    mount({
      type: 'action:group',
      id: 'group_label_string',
      actions: [{ name: 'approve', label: 'Approve', type: 'run' }],
    });
    expect(screen.getByRole('button')).toHaveTextContent('Approve');
    cleanup();

    mount({
      type: 'action:group',
      id: 'group_label_string_dd',
      display: 'dropdown',
      label: 'Row',
      actions: [{ name: 'approve', label: 'Approve', type: 'run' }],
    });
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveTextContent('Row');
    await openMenu(trigger);
    expect(screen.getByRole('menuitem')).toHaveTextContent('Approve');
    expect(labelWarnings()).toHaveLength(0);
  });
});
