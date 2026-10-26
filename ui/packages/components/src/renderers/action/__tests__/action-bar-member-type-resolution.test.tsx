/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6306 — an `action:icon` hosted by an `action:bar` forwarded the
 * COMPONENT id as the action type, so the click resolved no handler and
 * nothing happened: no error, no toast, the objectstack#2169 "Mark Done does
 * nothing" shape.
 *
 * ## The composition, and where the two leaves disagreed
 *
 * `action:bar` does not route members through `SchemaRenderer`. It pulls each
 * member's renderer off the registry and RENAMES the declared type as it
 * spreads (`action-bar.tsx`):
 *
 *     type: componentType,        // 'action:button' | 'action:icon' | …
 *     actionType: action.type,    // the real action type ('api', 'script', …)
 *
 * So on this host path the member's own `schema.type` is the component id and
 * `schema.actionType` is the declaration. `action:button` resolves the pair
 * when it forwards (`schema.actionType || schema.type`); `action:icon` read
 * `schema.type` alone and dropped `actionType` entirely, handing the runner
 * `type: 'action:icon'`. `ActionRunner.execute` resolves the handler from
 * `action.type || action.actionType || action.name`, and `'action:icon'` binds
 * nothing: no registered handler, no builtin, and — for a declaration carrying
 * `target` rather than `endpoint` — no legacy `navigate`/`api` fallback either.
 * It falls through to `executeActionSchema` and the authored action never runs.
 *
 * ## Why these rows are readings and not a dead probe
 *
 * Every row that reads the icon member's ZERO renders a sibling `action:button`
 * member of the SAME declaration in the SAME bar and reads its ONE first. A
 * harness that executes nothing at all — an unmounted renderer, a member pushed
 * into the overflow menu, an assertion racing the async `execute` — reports
 * zero on both members, so the control tells the two apart from the failure
 * message alone. The two members differ in exactly one authored key,
 * `component`; `name`/`label` differ only because they are the addressing
 * handles, and the runner never consults them here (`type` is always truthy on
 * this path, so the `|| action.name` leg is unreachable).
 *
 * The `component id never reaches the runner` row makes the defect two-sided
 * rather than merely absent: it registers a TRAP handler keyed on the component
 * id itself, so the unfixed renderer produces a positive artefact (the trap
 * fires) instead of only a missing call. Nothing about the production path
 * changes — the trap only gives the wrong value somewhere to land.
 *
 * ## The two standalone rows are guards, not duplicates
 *
 * This file's original standalone row asserted that `action:icon` rendered on
 * its own resolved a declared `type`, because its registry `inputs` used to
 * declare the action type under that name. objectui#7415 renamed that input to
 * `actionType` (objectstack#14490 ruling A) precisely because `type` is the SDUI
 * envelope's component discriminator, so the row now authors the renamed input.
 *
 * The second row is the mirror the rename earns, and it is the one that refuses
 * a re-added `|| schema.type` fallback: a standalone node that declares NO
 * `actionType` must not hand the component id to the runner. It reads as a
 * positive artefact rather than an absence — a handler keyed on the action's
 * NAME fires, which is `ActionRunner.execute`'s own
 * `action.type || action.actionType || action.name` tail taking over, while a
 * trap keyed on the component id stays silent.
 *
 * Scope note: `type: schema` appears in exactly TWO files under
 * `renderers/action/` — `action-button.tsx` and `action-icon.tsx`. `action:group`
 * and `action:menu` compose their members differently and are not part of this
 * defect; that census is a control here rather than an assumption.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports so the three renderers are in the registry
// when `ComponentRegistry.get` runs — the light `dom` project does not load the
// `@object-ui/components` graph, and `action:bar` resolves its members through
// the registry at render time. Module scope, not a `beforeAll`, per
// AGENTS.md §测试纪律.
import '../action-button';
import '../action-icon';
import '../action-bar';

/**
 * The authored declaration. `target` and NOT `endpoint` — deliberately: an
 * `endpoint` would let the runner's legacy `action.api || action.endpoint`
 * fallback reach `executeAPI` even with an unresolved type, which would mask
 * exactly the defect under test.
 */
const DECLARATION = {
  type: 'api',
  target: '/api/v1/tasks/mark_done',
} as const;

/** One declaration, mounted twice; `component` is the only variable. */
const iconMember = { ...DECLARATION, name: 'mark_done_icon', label: 'Mark done icon', component: 'action:icon' };
const buttonMember = { ...DECLARATION, name: 'mark_done_button', label: 'Mark done button', component: 'action:button' };

let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
/** Keyed on the COMPONENT id — fires only if the unresolved type reaches the runner. */
let trap: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

beforeEach(() => {
  api = vi.fn(async () => ({ success: true }));
  trap = vi.fn(async () => ({ success: true }));
});

/**
 * The real `action:bar` host. BOTH ceilings are pinned high: the inline/overflow
 * split reads `mobileMaxVisible ?? 1` when `useIsMobile()` is true, so pinning
 * only `maxVisible` would leave the split at the mercy of the environment's
 * viewport and could push a member into the overflow menu — a zero that is not
 * about type resolution at all.
 */
function renderBar(handlers: Record<string, Mock<(a: ActionDef, c: ActionContext) => Promise<ActionResult>>>) {
  const Bar = ComponentRegistry.get('action:bar');
  if (!Bar) throw new Error('action:bar is not registered');
  return render(
    <ActionProvider handlers={handlers} onToast={vi.fn()}>
      <Bar
        schema={{
          type: 'action:bar',
          maxVisible: 10,
          mobileMaxVisible: 10,
          actions: [buttonMember, iconMember],
        } as never}
      />
    </ActionProvider>,
  );
}

const clickMember = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));

/** The def the handler was handed — i.e. what actually reached the runner. */
const defOf = (m: Mock<(a: ActionDef, c: ActionContext) => Promise<ActionResult>>, i = 0) =>
  m.mock.calls[i][0];

describe('action:bar member type resolution — action:icon (objectui#6306)', () => {
  it('positive control — the action:button member reaches the api handler', async () => {
    renderBar({ api });

    clickMember('Mark done button');

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(defOf(api).type).toBe('api');
  });

  it('the action:icon member of the same bar reaches the same handler', async () => {
    renderBar({ api });

    // The control first, in the same render: its ONE is what makes the icon
    // member's count a reading rather than "the harness never executed".
    clickMember('Mark done button');
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));

    clickMember('Mark done icon');
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(defOf(api, 1).type).toBe('api');
  });

  it('the runner is handed the declared type, not the component id', async () => {
    renderBar({ api, 'action:icon': trap });

    clickMember('Mark done icon');

    // Settle on EITHER path before reading, so the row is about WHICH handler
    // resolved and never about async timing. Asserting the trap FIRST is what
    // makes the unfixed world produce a naming artefact ("expected trap not to
    // be called, but it was") instead of a generic missing call.
    await waitFor(() => expect(api.mock.calls.length + trap.mock.calls.length).toBe(1));
    expect(trap).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(1);
    expect(defOf(api).type).toBe('api');
  });

  it('both members of one declaration resolve to the same action type', async () => {
    renderBar({ api });

    clickMember('Mark done button');
    clickMember('Mark done icon');

    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(api.mock.calls.map(([def]) => def.type)).toEqual(['api', 'api']);
  });

  it('regression guard — a standalone action:icon resolves its renamed actionType input', async () => {
    // No host, so nothing renames anything: this is the node an author writes,
    // where `type` is the COMPONENT and `actionType` is the declared execution
    // type (objectui#7415). `DECLARATION` keeps the spec `ActionSchema` spelling
    // because that is what it is on the bar path above — a member of an
    // `actions` array, not a node.
    const Icon = ComponentRegistry.get('action:icon');
    if (!Icon) throw new Error('action:icon is not registered');
    render(
      <ActionProvider handlers={{ api }} onToast={vi.fn()}>
        <Icon
          schema={{
            target: DECLARATION.target,
            type: 'action:icon',
            actionType: DECLARATION.type,
            name: 'standalone',
            label: 'Standalone icon',
          } as never}
        />
      </ActionProvider>,
    );

    clickMember('Standalone icon');

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(defOf(api).type).toBe('api');
  });

  it('a standalone node without actionType never hands the component id to the runner', async () => {
    // The mirror guard the objectstack#14490 rename earns: with the `|| schema.type`
    // fallback gone there is no path left on which the discriminator can be read
    // as an action type. Re-adding that leg fails HERE — the trap fires and the
    // named handler does not — rather than shipping the objectui#6306 shape
    // (a click that resolves no handler, with no error and no toast) back to the
    // one surface that still authors `type` as a component id, which is all of
    // them.
    const byName = vi.fn(async () => ({ success: true }));
    const Icon = ComponentRegistry.get('action:icon');
    if (!Icon) throw new Error('action:icon is not registered');
    render(
      <ActionProvider handlers={{ 'action:icon': trap, untyped_action: byName }} onToast={vi.fn()}>
        <Icon
          schema={{
            target: DECLARATION.target,
            type: 'action:icon',
            name: 'untyped_action',
            label: 'Untyped icon',
          } as never}
        />
      </ActionProvider>,
    );

    clickMember('Untyped icon');

    // Settle on EITHER path first, so this is about WHICH handler resolved and
    // never about async timing — the same shape the trap row above uses.
    await waitFor(() => expect(byName.mock.calls.length + trap.mock.calls.length).toBe(1));
    expect(trap).not.toHaveBeenCalled();
    expect(byName).toHaveBeenCalledTimes(1);
  });
});
