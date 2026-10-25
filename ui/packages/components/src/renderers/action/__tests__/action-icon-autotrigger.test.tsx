/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10274 — `action:icon` never consumed `autoTrigger`, the #4162
 * signature on a third renderer.
 *
 * `action:bar` renders an inline member with the renderer its `component`
 * names, spreading the whole action onto that renderer's schema — so an action
 * authored `component: 'action:icon'` hands `action:icon` the host-composed
 * `autoTrigger` flag exactly as a default member hands it to `action:button`.
 * `action:button` and `action:menu` run it through the shared
 * `useAutoTriggerOnce` (`auto-trigger.ts`); `action:icon` did not read it at
 * all. A `?runAction=` deep link that `ObjectView` armed and CONSUMED for a
 * `list_toolbar` action rendered as an icon therefore did nothing: no run, no
 * notice, and no URL left to retry from.
 *
 * The contract the fix routes `action:icon` into is the one `auto-trigger.ts`
 * states: execute once on mount by whichever renderer receives the action,
 * through the renderer's own click path, and refuse (with a notice) when the
 * action's own declared `visible` hides it (objectui#4191).
 *
 * ## Why the first row carries a control
 *
 * The icon member's count is read beside an `action:button` member of the same
 * declaration in the same bar, flagged the same way. A harness that executes
 * nothing at all (an unregistered renderer, a member pushed into the overflow
 * menu, an assertion racing the async `execute`) reads zero on BOTH, so the
 * control separates "the icon ignored the flag" from "nothing ran" in the
 * failure message itself. Both ceilings are pinned high for the same reason as
 * `action-bar-member-type-resolution.test.tsx`: the split reads
 * `mobileMaxVisible` when the environment looks mobile, and an icon member that
 * spilled into the menu would be run by the menu, not by the icon.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports — `action:bar` resolves its members through
// the ComponentRegistry at render time, and the light `dom` project does not
// load the `@object-ui/components` graph. Module scope, not a `beforeAll`, per
// AGENTS.md §测试纪律.
import '../action-bar';
import '../action-button';
import '../action-icon';
import { toast } from '../../../ui/sonner';

type Handler = Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

/** An authored `action:bar` member, as the tests spell it. */
type Member = Record<string, unknown>;

/** The action the deep link asks for, authored to render as an icon. */
const ICON = {
  name: 'create_icon',
  label: 'Create icon',
  type: 'api',
  icon: 'plus',
  component: 'action:icon',
  locations: ['list_toolbar'],
};

/** The same declaration rendered by the default member renderer — the control. */
const BUTTON = {
  name: 'create_button',
  label: 'Create button',
  type: 'api',
  locations: ['list_toolbar'],
};

/** A declared, evaluable predicate that is false, so the gate really runs. */
const NEVER = '1 == 2';
const ALWAYS = '1 == 1';

let api: Handler;

beforeEach(() => {
  api = vi.fn(async () => ({ success: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The names the runner was actually asked to execute. */
const executed = (h: Handler = api) => h.mock.calls.map((c) => (c[0] as ActionDef).name);

/** The dev diagnostics the refusal branch wrote (objectui#4191), and nothing else console.warn saw. */
const refusalDiagnostics = (spy: { mock: { calls: unknown[][] } }): string[] =>
  spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('objectui#4191'));

function Bar({ actions }: { actions: Member[] }) {
  const C = ComponentRegistry.get('action:bar');
  if (!C) throw new Error('action:bar is not registered');
  return (
    // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered renderer (stable reference), not a component created during render
    <C
      schema={{ type: 'action:bar', location: 'list_toolbar', maxVisible: 10, mobileMaxVisible: 10, actions }}
    />
  );
}

function tree(actions: Member[], props: { handler?: Handler; onConfirm?: (message: string) => Promise<boolean> } = {}) {
  return (
    <ActionProvider handlers={{ api: props.handler ?? api }} onToast={vi.fn()} onConfirm={props.onConfirm}>
      <Bar actions={actions} />
    </ActionProvider>
  );
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('action:icon consumes autoTrigger for the action it receives (objectui#10274)', () => {
  it("the card's probe: an inline action:icon member carrying autoTrigger executes, exactly once, beside an action:button control", async () => {
    // Before the fix: `executed()` was `['create_button']` — the control ran,
    // the icon member rendered and ran nothing.
    renderBar([{ ...BUTTON, autoTrigger: true }, { ...ICON, autoTrigger: true }]);

    // It really is the icon renderer: an icon-only control named by its
    // `aria-label`, carrying no text label of its own.
    const icon = screen.getByRole('button', { name: 'Create icon' });
    expect(icon.textContent ?? '').not.toContain('Create icon');

    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    await flush();
    expect(executed().sort()).toEqual(['create_button', 'create_icon']);
  });

  it('an inline icon WITHOUT the flag runs nothing on mount', async () => {
    // The refusal half: "the icon executes what it is given on mount" would
    // pass the row above and fire this one.
    renderBar([BUTTON, ICON]);
    expect(screen.getByRole('button', { name: 'Create icon' })).toBeTruthy();
    await flush();
    expect(api).not.toHaveBeenCalled();
  });

  it('the auto-triggered run and a click hand the runner the same ActionDef', async () => {
    // The hook is handed the icon's own click handler, so a deep-linked run and
    // a click are indistinguishable downstream (confirm, param dialogs, toasts).
    const auto = render(tree([{ ...ICON, autoTrigger: true }]));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const fromTrigger = api.mock.calls[0][0];
    auto.unmount();

    const clicked: Handler = vi.fn(async () => ({ success: true }));
    render(tree([ICON], { handler: clicked }));
    await flush();
    expect(clicked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create icon' }));
    await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));

    expect(fromTrigger).toEqual(clicked.mock.calls[0][0]);
  });

  it("the auto-triggered run goes through the runner's confirm gate, like a click: declining runs nothing", async () => {
    const onConfirm = vi.fn(async (_message: string) => false);
    render(tree([{ ...ICON, confirmText: 'Really create?', autoTrigger: true }], { onConfirm }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toBe('Really create?');
    await flush();
    expect(api).not.toHaveBeenCalled();
  });

  it('re-renders with fresh action objects, the flag still set, do not re-fire it', async () => {
    const view = renderBar([{ ...ICON, autoTrigger: true }]);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));

    // Fresh objects each time, as a host that re-`.map()`s its actions every
    // render produces — and the run itself re-renders the icon (loading state).
    for (let i = 0; i < 3; i++) {
      view.rerender(tree([{ ...ICON, autoTrigger: true }]));
    }
    await flush();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('the flag flipping true LATER still triggers exactly once', async () => {
    const view = renderBar([ICON]);
    await flush();
    expect(api).not.toHaveBeenCalled();

    view.rerender(tree([{ ...ICON, autoTrigger: true }]));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));

    view.rerender(tree([{ ...ICON, autoTrigger: true }]));
    await flush();
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe("the icon's own declared visible gate outranks the flag (objectui#4191, now on action:icon)", () => {
  it('a hidden icon is NOT run, and the refusal is reported: one notice naming the action, one dev diagnostic', async () => {
    const notice = vi.spyOn(toast, 'warning').mockImplementation(() => 'id');
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderBar([BUTTON, { ...ICON, visible: NEVER, autoTrigger: true }]);

    // The bar rendered (its ungated member is there) and the icon really was
    // hidden — so "no run" is not "nothing mounted".
    expect(screen.getByRole('button', { name: 'Create button' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create icon' })).toBeNull();

    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    expect(String(notice.mock.calls[0][0])).toContain('Create icon');
    expect(refusalDiagnostics(diagnostic)).toHaveLength(1);
    expect(refusalDiagnostics(diagnostic)[0]).toContain('create_icon');
    await flush();
    expect(api).not.toHaveBeenCalled();
  });

  it('refusal does not spend the once-guard: an icon that becomes visible later runs, once', async () => {
    vi.spyOn(toast, 'warning').mockImplementation(() => 'id');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const view = renderBar([{ ...ICON, visible: NEVER, autoTrigger: true }]);
    await flush();
    expect(api).not.toHaveBeenCalled();

    for (let i = 0; i < 2; i++) {
      view.rerender(tree([{ ...ICON, visible: ALWAYS, autoTrigger: true }]));
    }
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await flush();
    expect(api).toHaveBeenCalledTimes(1);
  });
});

function renderBar(actions: Member[]) {
  return render(tree(actions));
}
