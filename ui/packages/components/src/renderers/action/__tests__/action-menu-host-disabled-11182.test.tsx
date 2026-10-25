/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11182 — `action:menu` and `action:group` take the host's forwarded
 * `disabled` by name, the objectui#9131 rule `action:button` and `action:icon`
 * already follow.
 *
 * ## The mechanism
 *
 * `SchemaRenderer` hands every component `disabled: __disabled || undefined`:
 * the key is always present, only its value is conditional. `action:menu` drew
 * its trigger with `disabled={loading}` and then spread `{...rest}` after it,
 * so the forwarded key wrote over the renderer's own in-flight verdict. On the
 * ordinary SDUI path the trigger of a menu whose action was still running read
 * `disabled=false`: the spinner showed, and a second execution could start.
 * A direct registry mount (the way `action:bar` mounts its overflow menu)
 * forwards no `disabled` at all, so that channel was right throughout — it is
 * the control here, not a casualty.
 *
 * `action:group` had the other half of the same shape. Inline mode spread the
 * forwarded key onto its wrapping `div`, where a `disabled` attribute does
 * nothing, and dropdown mode dropped it: a host-disabled group left every
 * member (inline) or its trigger (dropdown) pressable.
 *
 * ## What each block refuses
 *
 *   • the in-flight block reads the trigger on BOTH channels as one object, so a
 *     disagreement between them is the failure message itself (pre-fix it read
 *     `node: { spinning: true, disabled: false }` beside a disabled `direct`);
 *   • the settle rows refuse a fix that disables the trigger for good;
 *   • the host-disabled rows refuse the other way to make the channels agree —
 *     dropping the forwarded verdict instead of consuming it — including after
 *     an action settles, which is the row an in-flight gate written after the
 *     spread would fail;
 *   • the no-gate rows refuse an over-correction into "always disabled".
 */

import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider, PredicateScopeProvider, SchemaRenderer } from '@object-ui/react';
// Module-scope side-effect imports so both renderers are in the registry when
// `ComponentRegistry.get` and `SchemaRenderer` resolve them (the light `dom`
// project does not load the `@object-ui/components` graph), per AGENTS.md
// §测试纪律 — the cost lands in the import phase, not under a hook timeout.
import '../action-menu';
import '../action-group';

type Handler = Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

/** The predicate scope the predicate rows resolve against. */
const SCOPE = { features: { locked: true, unlocked: false } };

/** A handler whose run stays in flight until the test settles it. */
function pendingHandler() {
  let settle: () => void = () => {};
  const api: Handler = vi.fn(
    () =>
      new Promise<ActionResult>((resolve) => {
        settle = () => resolve({ success: true });
      }),
  );
  return { api, settle: () => settle() };
}

/**
 * The menu node. `label` names the trigger for `getByRole`; the one member runs
 * on mount through the menu's own execute path (`autoTrigger`), which is what
 * puts the menu in flight without opening the dropdown.
 */
function menuNode(member: Record<string, unknown> = {}, node: Record<string, unknown> = {}) {
  return {
    type: 'action:menu',
    label: 'More',
    actions: [{ name: 'run', label: 'Run', type: 'api', ...member }],
    ...node,
  };
}

const trigger = () => screen.getByRole('button', { name: 'More' }) as HTMLButtonElement;

/** What a user sees on the trigger: is it spinning, and can it be pressed? */
function readTrigger() {
  const el = trigger();
  return { spinning: el.querySelector('.animate-spin') !== null, disabled: el.disabled };
}

type Channel = 'direct' | 'node';

/** One menu on one channel, inside the handler and scope providers. */
function tree(channel: Channel, schema: Record<string, unknown>, api: Handler) {
  let menu: React.ReactElement;
  if (channel === 'direct') {
    const Renderer = ComponentRegistry.get('action:menu');
    if (!Renderer) throw new Error('action:menu is not registered');
    menu = <Renderer schema={schema} />;
  } else {
    menu = <SchemaRenderer schema={schema as never} />;
  }
  return (
    <ActionProvider handlers={{ api }}>
      <PredicateScopeProvider scope={SCOPE}>{menu}</PredicateScopeProvider>
    </ActionProvider>
  );
}

function mount(channel: Channel, schema: Record<string, unknown>, api: Handler) {
  return render(tree(channel, schema, api));
}

/** The in-flight reading, then the settled reading, on one channel. */
async function inFlightThenSettled(channel: Channel) {
  const { api, settle } = pendingHandler();
  mount(channel, menuNode({ autoTrigger: true }), api);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readTrigger().spinning).toBe(true));
  const inFlight = readTrigger();
  await act(async () => {
    settle();
  });
  await waitFor(() => expect(readTrigger().spinning).toBe(false));
  const settled = readTrigger();
  cleanup();
  return { inFlight, settled };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('action:menu — the trigger keeps its own verdict through SchemaRenderer (objectui#11182)', () => {
  it('an in-flight member keeps the trigger disabled on both channels, and it re-enables when the action settles', async () => {
    const direct = await inFlightThenSettled('direct');
    const node = await inFlightThenSettled('node');
    expect({ direct: direct.inFlight, node: node.inFlight }).toEqual({
      direct: { spinning: true, disabled: true },
      node: { spinning: true, disabled: true },
    });
    expect({ direct: direct.settled, node: node.settled }).toEqual({
      direct: { spinning: false, disabled: false },
      node: { spinning: false, disabled: false },
    });
  });

  it('a host-disabled menu stays disabled, through the node gate and through the properties bag', () => {
    const { api } = pendingHandler();
    for (const gate of [
      { disabled: true },
      { disabled: 'features.locked == true' },
      { properties: { disabled: true } },
    ]) {
      mount('node', menuNode({}, gate), api);
      expect(readTrigger()).toEqual({ spinning: false, disabled: true });
      cleanup();
    }
    expect(api).not.toHaveBeenCalled();
  });

  it('a menu the host disables while its action runs stays disabled after the action settles', async () => {
    // The action starts on an enabled menu, so this row does not lean on
    // whether `autoTrigger` runs on a menu that is disabled from the start.
    const { api, settle } = pendingHandler();
    const view = mount('node', menuNode({ autoTrigger: true }), api);
    await waitFor(() => expect(readTrigger().spinning).toBe(true));
    view.rerender(tree('node', menuNode({ autoTrigger: true }, { disabled: true }), api));
    expect(readTrigger()).toEqual({ spinning: true, disabled: true });
    await act(async () => {
      settle();
    });
    await waitFor(() => expect(readTrigger().spinning).toBe(false));
    expect(readTrigger()).toEqual({ spinning: false, disabled: true });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('an idle menu with no gate is pressable on both channels, and a false node gate does not disable it', () => {
    const { api } = pendingHandler();
    const read = (channel: Channel, node: Record<string, unknown>) => {
      mount(channel, menuNode({}, node), api);
      const verdict = readTrigger().disabled;
      cleanup();
      return verdict;
    };
    expect({
      direct: read('direct', {}),
      node: read('node', {}),
      nodeFalseGate: read('node', { disabled: 'features.unlocked == true' }),
    }).toEqual({ direct: false, node: false, nodeFalseGate: false });
  });
});

describe('action:group — a host-disabled group disables what the user can press (objectui#11182)', () => {
  const GROUP_ACTIONS = [
    { name: 'approve', label: 'Approve', type: 'api' },
    { name: 'reject', label: 'Reject', type: 'api' },
  ];

  function mountGroup(node: Record<string, unknown>) {
    const { api } = pendingHandler();
    return render(
      <ActionProvider handlers={{ api }}>
        <PredicateScopeProvider scope={SCOPE}>
          <SchemaRenderer schema={{ type: 'action:group', actions: GROUP_ACTIONS, ...node } as never} />
        </PredicateScopeProvider>
      </ActionProvider>,
    );
  }

  const inlineMembers = () => ['Approve', 'Reject'].map(
    (name) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled,
  );

  it('inline mode: every member button is disabled, and the wrapper carries no `disabled` attribute', () => {
    const { container } = mountGroup({ display: 'inline', disabled: true });
    expect(inlineMembers()).toEqual([true, true]);
    const wrapper = container.querySelector('[data-obj-type="action:group"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper).not.toHaveAttribute('disabled');
  });

  it('dropdown mode: the trigger is disabled', () => {
    mountGroup({ display: 'dropdown', label: 'Decide', disabled: true });
    expect((screen.getByRole('button', { name: 'Decide' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('no gate, or a false one, leaves both modes pressable', () => {
    for (const gate of [{}, { disabled: 'features.unlocked == true' }]) {
      mountGroup({ display: 'inline', ...gate });
      expect(inlineMembers()).toEqual([false, false]);
      cleanup();
      mountGroup({ display: 'dropdown', label: 'Decide', ...gate });
      expect((screen.getByRole('button', { name: 'Decide' }) as HTMLButtonElement).disabled).toBe(false);
      cleanup();
    }
  });
});
