/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `action:icon` reads its label through the shared `renderableLabel` guard
 * (`../renderable-label.ts`), the one `action:button` reads through, and so
 * does the node-level-params warning in `../static-params.ts`.
 *
 * The contract's `label` is `z.string()`, localized through the translation
 * bundle entry for the component id. A locale map reaches the renderer only
 * from metadata that skipped `validateComponentProps`. Unguarded, an icon with
 * no `icon` threw on `label.charAt` and one with an icon wrote `[object Object]`
 * into its `aria-label`. Guarded, it renders the unlabelled fallbacks, prints no
 * `[object Object]`, and does not translate the map.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { undeclaredNode } from '@object-ui/test-support';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Module scope, so the registry holds the renderer when `SchemaRenderer` resolves it.
import '../action-icon';
import { resetStaticParamsWarnings } from '../static-params';

const LOCALE_MAP = { en: 'Approve', 'zh-CN': '批准' };

let run: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  run = vi.fn(async () => ({ success: true }));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  resetStaticParamsWarnings();
});

afterEach(() => {
  warn.mockRestore();
  cleanup();
});

function mount(schema: Record<string, unknown>) {
  return render(
    <ActionProvider handlers={{ run }} onToast={vi.fn()}>
      <SchemaRenderer schema={undeclaredNode(schema)} />
    </ActionProvider>,
  );
}

const labelWarnings = () => warn.mock.calls.filter((args) => String(args[0]).includes('non-string label'));

const assertNothingLeaked = () => {
  expect(document.body.innerHTML).not.toContain('[object Object]');
  expect(document.body.textContent).not.toContain('批准');
  expect(document.body.textContent).not.toContain('Approve');
};

describe('action:icon — a non-string label renders no text and never throws (#37266)', () => {
  it('no `icon`: renders the unlabelled initial, named by `name`, and still runs with no label', async () => {
    mount({ type: 'action:icon', id: 'icon_label_guard', name: 'approve', actionType: 'run', label: LOCALE_MAP });
    const button = screen.getByRole('button', { name: 'approve' });
    expect(button.textContent).toBe('?');
    assertNothingLeaked();

    fireEvent.click(button);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((run.mock.calls[0][0] as ActionDef).label).toBeUndefined();

    const warned = labelWarnings().map((args) => String(args[0]));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('action:icon "icon_label_guard"');
  });

  it('with an `icon`: the accessible name is `name`, never `[object Object]`', () => {
    mount({ type: 'action:icon', id: 'icon_label_named', name: 'approve', icon: 'check', actionType: 'run', label: LOCALE_MAP });
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'approve');
    assertNothingLeaked();
  });

  it('a nameless action with node-level object `params`: the static-params warning prints no `[object Object]`', async () => {
    mount({ type: 'action:icon', actionType: 'run', label: LOCALE_MAP, params: { stage: 'won' } });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const paramsWarning = warn.mock.calls.map((args) => String(args[0])).find((m) => m.includes('node-level'));
    expect(paramsWarning).toBeDefined();
    expect(paramsWarning).toContain('action "(unnamed)"');
    expect(warn.mock.calls.some((args) => String(args[0]).includes('[object Object]'))).toBe(false);
  });

  it('CONTROL: a string label is the initial, the accessible name, and the runner label', async () => {
    mount({ type: 'action:icon', id: 'icon_label_string', name: 'approve', actionType: 'run', label: 'Approve' });
    const button = screen.getByRole('button', { name: 'Approve' });
    expect(button.textContent).toBe('A');
    fireEvent.click(button);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((run.mock.calls[0][0] as ActionDef).label).toBe('Approve');
    expect(labelWarnings()).toHaveLength(0);
  });
});
