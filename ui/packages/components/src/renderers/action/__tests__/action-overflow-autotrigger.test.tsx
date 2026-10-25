/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4162 — `autoTrigger` is a property of the ACTION, so every renderer
 * that receives that action must honour it. It used to be consumed only by
 * `action:button`.
 *
 * `action:bar` splits its post-gate list at `maxVisible` (3 desktop, 1 mobile)
 * and hands the tail to `action:menu`. So an action carrying `autoTrigger: true`
 * that sorts past that threshold was rendered — present, reachable, clickable in
 * the "More" menu — while its auto-trigger was silently dropped. The caller that
 * set the flag has already spent the signal it stands for: the #844 deep link
 * (`?runAction=create_environment`) is consumed by stripping it from the URL, so
 * the card measured `urlParam=null execute=0` — intent gone, nothing run, and no
 * URL left to retry from. Which actions lose their auto-trigger was a function of
 * viewport width, since `maxVisible` drops to 1 on mobile.
 *
 * The ruling (on the card): the flag's contract is **execute once on mount by
 * whichever renderer receives the action**. `action:menu` therefore consumes it
 * by EXECUTING — not by rendering something and hoping the user clicks it, and
 * not by auto-opening the dropdown. The two rejected alternatives are on the
 * card: making `autoTrigger` an ordering key in `action:bar` moves VISUAL layout
 * as a side effect of a transport flag, and rejecting the flag loudly turns a
 * working deep link into an error for the crime of being fourth in a list.
 *
 * Sibling defect, same end signature one layer up (what ARMS the deep link):
 * #4123 / PR #4166, whose pins live in
 * `packages/app-shell/src/environment/__tests__/EnvironmentListToolbar.deepLinkArming.test.tsx`
 * and are consumers of this contract.
 *
 * ## What each block is defended against
 *
 * The inline block is not decoration: a "just execute every action the menu
 * receives" rewrite passes every overflow assertion here on its own, and the
 * non-autoTrigger block is what refuses it. Likewise the once-ness blocks —
 * a menu-level boolean guard and a per-action guard differ only when two
 * actions carry the flag, and only the last block tells them apart.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports — `action:bar` resolves its members (and the
// overflow menu) through the ComponentRegistry at render time, and the light
// `dom` project deliberately does not load the `@object-ui/components` graph.
// Module scope, not a `beforeAll`, per AGENTS.md §测试纪律.
import '../action-bar';
import '../action-button';
import '../action-menu';
import { toast } from '../../../ui/sonner';

/** Three ordinary toolbar actions — enough to fill the desktop `maxVisible: 3`. */
const FILLERS = [
  { name: 'a1', label: 'a1', type: 'api', locations: ['list_toolbar'] },
  { name: 'a2', label: 'a2', type: 'api', locations: ['list_toolbar'] },
  { name: 'a3', label: 'a3', type: 'api', locations: ['list_toolbar'] },
];

/**
 * The card's action: a create action that declares neither `order` nor
 * `variant: 'primary'`, so `needsOrdering` is false and the bar keeps
 * registration order — which puts it 4th, i.e. in the overflow menu.
 */
const CREATE = {
  name: 'create_environment',
  label: 'Create Environment',
  type: 'api',
  locations: ['list_toolbar'],
};

// See action-bodyExtra-forward.test.tsx for why this is not
// `ReturnType<typeof vi.fn>` (objectui#4040).
let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

beforeEach(() => {
  api = vi.fn(async () => ({ success: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The dev diagnostics the refusal branch wrote (objectui#4191), and nothing else console.warn saw. */
const refusalDiagnostics = (spy: { mock: { calls: unknown[][] } }): string[] =>
  spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('objectui#4191'));

/** The names the runner was actually asked to execute, in order. */
const executed = () => api.mock.calls.map((c) => (c[0] as any).name);

function Bar({ actions }: { actions: any[] }) {
  const C = ComponentRegistry.get('action:bar');
  if (!C) throw new Error('action:bar is not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered renderer (stable reference), not a component created during render
  return <C schema={{ type: 'action:bar', location: 'list_toolbar', actions }} />;
}

function renderBar(actions: any[]) {
  return render(
    <ActionProvider handlers={{ api }}>
      <Bar actions={actions} />
    </ActionProvider>,
  );
}

describe('action:menu consumes autoTrigger for the actions it receives (#4162)', () => {
  it("the card's probe: an autoTrigger action that spills past maxVisible still executes, exactly once", async () => {
    // Before the fix this measured `execute=0` with the same DOM:
    // `buttons=["a1","a2","a3",""]` — three inline buttons plus the overflow
    // trigger, the create action present in the menu and never run.
    renderBar([...FILLERS, { ...CREATE, autoTrigger: true }]);

    // It really did overflow: only the three fillers are inline, and the
    // create action has no button of its own.
    expect(screen.getByRole('button', { name: 'a1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'a3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create Environment' })).toBeNull();

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(executed()).toEqual(['create_environment']);
  });

  it('executes WITHOUT opening the menu — the dropdown stays closed', async () => {
    // Consumption is execution, not "render the item and hope". An auto-opened
    // dropdown would be a visible side effect of a transport flag, and it is
    // also how a naive fix (mount the items eagerly) would announce itself.
    renderBar([...FILLERS, { ...CREATE, autoTrigger: true }]);

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitem')).toBeNull();
    // The item's label is nowhere in the document — the menu content never mounted.
    expect(screen.queryByText('Create Environment')).toBeNull();
    const trigger = screen.getByRole('button', { name: /more actions/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('re-renders do not re-fire it', async () => {
    const view = renderBar([...FILLERS, { ...CREATE, autoTrigger: true }]);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));

    // Fresh action objects each time, exactly as a state-dependent toolbar
    // produces (`EnvironmentListToolbar` re-`.map()`s its actions every render).
    for (let i = 0; i < 3; i++) {
      view.rerender(
        <ActionProvider handlers={{ api }}>
          <Bar actions={[...FILLERS, { ...CREATE, autoTrigger: true }]} />
        </ActionProvider>,
      );
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('the flag flipping true LATER still triggers exactly once', async () => {
    // The `action:button` case this mirrors: `EnvironmentListToolbar` attaches
    // `autoTrigger` only once entitlements resolve, so the first commit carries
    // the action without the flag.
    const view = renderBar([...FILLERS, CREATE]);
    await new Promise((r) => setTimeout(r, 0));
    expect(api).not.toHaveBeenCalled();

    view.rerender(
      <ActionProvider handlers={{ api }}>
        <Bar actions={[...FILLERS, { ...CREATE, autoTrigger: true }]} />
      </ActionProvider>,
    );
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));

    view.rerender(
      <ActionProvider handlers={{ api }}>
        <Bar actions={[...FILLERS, { ...CREATE, autoTrigger: true }]} />
      </ActionProvider>,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('an overflow action WITHOUT the flag is untouched — nothing runs on mount', async () => {
    // The refusal half. "The menu executes what it is given" would pass every
    // assertion above and fire this one.
    renderBar([...FILLERS, CREATE, { name: 'a5', label: 'a5', type: 'api', locations: ['list_toolbar'] }]);

    await new Promise((r) => setTimeout(r, 0));
    expect(api).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /more actions/i })).toBeTruthy();
  });

  it('systemActions — always overflow, never inline — are honoured the same way', async () => {
    // `systemActions` bypass the `maxVisible` split entirely and are ALWAYS
    // rendered by the menu, so before this fix an `autoTrigger` there could
    // never fire, whatever the viewport.
    render(
      <ActionProvider handlers={{ api }}>
        {(() => {
          const C = ComponentRegistry.get('action:bar')!;
          return (
            <C
              schema={{
                type: 'action:bar',
                location: 'list_toolbar',
                actions: [FILLERS[0]],
                systemActions: [{ ...CREATE, autoTrigger: true }],
              }}
            />
          );
        })()}
      </ActionProvider>,
    );

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(executed()).toEqual(['create_environment']);
  });

  it('the once-guard is per ACTION, not per menu: two flagged overflow actions each run once', async () => {
    // A single boolean guard on the menu would swallow the second one and still
    // satisfy every block above.
    renderBar([
      ...FILLERS,
      { ...CREATE, autoTrigger: true },
      { name: 'sync_now', label: 'Sync now', type: 'api', locations: ['list_toolbar'], autoTrigger: true },
    ]);

    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(executed().sort()).toEqual(['create_environment', 'sync_now']);
  });
});

describe('the inline path is unchanged by #4162', () => {
  it('an autoTrigger action that fits inline is still run by action:button, once', async () => {
    // #844's original path — the one PR #4166 pins end-to-end. If the fix had
    // been placed in `action:bar` (dispatching the flag itself), this would
    // double-fire: bar AND button.
    renderBar([{ ...CREATE, autoTrigger: true }, ...FILLERS.slice(0, 2)]);

    expect(screen.getByRole('button', { name: 'Create Environment' })).toBeTruthy();
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(executed()).toEqual(['create_environment']);
  });

  it('an inline action without the flag still does nothing on mount', async () => {
    renderBar([CREATE, ...FILLERS.slice(0, 2)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(api).not.toHaveBeenCalled();
  });
});

describe('what suppresses an auto-trigger, and what does not (#4162)', () => {
  /** A predicate that is declared, evaluable and false — so the gate really runs. */
  const NEVER = '1 == 2';

  it('a CONTAINER that renders nothing mounts nothing: a hidden action:bar fires neither path', async () => {
    // The rule the menu's placement follows. `action:bar` returns null before
    // its children mount, so an inline `autoTrigger` button never fires — and
    // the overflow menu is not built either. Both halves in one bar so the
    // assertion cannot pass for only one of them.
    render(
      <ActionProvider handlers={{ api }}>
        {(() => {
          const C = ComponentRegistry.get('action:bar')!;
          return (
            <C
              schema={{
                type: 'action:bar',
                location: 'list_toolbar',
                visible: NEVER,
                actions: [
                  { ...CREATE, name: 'inline_flagged', label: 'inline', autoTrigger: true },
                  ...FILLERS,
                  { ...CREATE, autoTrigger: true },
                ],
              }}
            />
          );
        })()}
      </ActionProvider>,
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(api).not.toHaveBeenCalled();
  });

  it('…and a hidden action:menu is the same container rule', async () => {
    render(
      <ActionProvider handlers={{ api }}>
        {(() => {
          const C = ComponentRegistry.get('action:menu')!;
          return (
            <C schema={{ type: 'action:menu', label: 'More', visible: NEVER, actions: [{ ...CREATE, autoTrigger: true }] }} />
          );
        })()}
      </ActionProvider>,
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(api).not.toHaveBeenCalled();
  });

  it("the ACTION's own declared visible gate REFUSES it, and says so — inline agrees with overflow (objectui#4191)", async () => {
    // Inverted by objectui#4191 (ruling A). This block used to pin the
    // opposite, as a parity pin only: `action:button` declared its auto-trigger
    // effect before its `visible` early return, so a gated-invisible action
    // executed anyway (`rendered="" execute=1`), and #4162 made the menu agree.
    // The ruling settled WHAT the two agree on: the author's declared `visible`
    // outranks the transport flag — the action is not run, and the refusal is
    // reported (a user-facing notice plus a dev diagnostic) rather than
    // swallowed. The parity requirement is unchanged: `maxVisible` and the
    // viewport decide which renderer receives the action, so both must refuse.
    const notice = vi.spyOn(toast, 'warning').mockImplementation(() => 'id' as any);
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hidden = { ...CREATE, visible: NEVER, autoTrigger: true };

    const inline = render(
      <ActionProvider handlers={{ api }}>
        <Bar actions={[hidden, ...FILLERS.slice(0, 2)]} />
      </ActionProvider>,
    );
    // It really was hidden: no button of its own anywhere.
    expect(screen.queryByRole('button', { name: 'Create Environment' })).toBeNull();
    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    expect(api).not.toHaveBeenCalled();
    // The notice names the action the user asked for.
    expect(String(notice.mock.calls[0][0])).toContain('Create Environment');
    expect(refusalDiagnostics(diagnostic)).toHaveLength(1);
    expect(refusalDiagnostics(diagnostic)[0]).toContain('create_environment');
    inline.unmount();

    const overflowApi = vi.fn<
      (action: ActionDef, ctx: ActionContext) => Promise<ActionResult>
    >(async () => ({ success: true }));
    render(
      <ActionProvider handlers={{ api: overflowApi }}>
        <Bar actions={[...FILLERS, hidden]} />
      </ActionProvider>,
    );
    // It really overflowed: the three fillers are inline, and the trigger exists.
    expect(screen.getByRole('button', { name: 'a3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /more actions/i })).toBeTruthy();
    await waitFor(() => expect(notice).toHaveBeenCalledTimes(2));
    expect(String(notice.mock.calls[1][0])).toContain('Create Environment');
    expect(refusalDiagnostics(diagnostic)).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(overflowApi).not.toHaveBeenCalled();
  });

  it('refusal is reported once per mounted action, however often it re-renders', async () => {
    const notice = vi.spyOn(toast, 'warning').mockImplementation(() => 'id' as any);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hidden = () => ({ ...CREATE, visible: NEVER, autoTrigger: true });
    const view = renderBar([hidden(), ...FILLERS.slice(0, 2)]);
    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 3; i++) {
      view.rerender(
        <ActionProvider handlers={{ api }}>
          <Bar actions={[hidden(), ...FILLERS.slice(0, 2)]} />
        </ActionProvider>,
      );
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(notice).toHaveBeenCalledTimes(1);
    expect(api).not.toHaveBeenCalled();
  });

  it('refusal does not spend the once-guard: an action that becomes visible later runs, once — in both renderers', async () => {
    // The gate is re-judged per commit, so an ambient scope that resolves after
    // first paint is not turned into a permanent refusal.
    vi.spyOn(toast, 'warning').mockImplementation(() => 'id' as any);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ALWAYS = '1 == 1';
    for (const layout of [
      (a: any) => [a, ...FILLERS.slice(0, 2)],
      (a: any) => [...FILLERS, a],
    ]) {
      const run = vi.fn<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>(
        async () => ({ success: true }),
      );
      const view = render(
        <ActionProvider handlers={{ api: run }}>
          <Bar actions={layout({ ...CREATE, visible: NEVER, autoTrigger: true })} />
        </ActionProvider>,
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(run).not.toHaveBeenCalled();
      for (let i = 0; i < 2; i++) {
        view.rerender(
          <ActionProvider handlers={{ api: run }}>
            <Bar actions={layout({ ...CREATE, visible: ALWAYS, autoTrigger: true })} />
          </ActionProvider>,
        );
      }
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 0));
      expect(run).toHaveBeenCalledTimes(1);
      view.unmount();
    }
  });

  it('an EMPTY visible predicate is no gate — it neither hides nor refuses', async () => {
    // Same declared-gate definition as the early return (objectui#3850): an
    // empty predicate must not be the reason an action is refused.
    const notice = vi.spyOn(toast, 'warning').mockImplementation(() => 'id' as any);
    renderBar([{ ...CREATE, visible: '', autoTrigger: true }, ...FILLERS.slice(0, 2)]);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(notice).not.toHaveBeenCalled();
  });
});
