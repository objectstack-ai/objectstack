/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4191 (ruling A) — the deep-link PREPARATION step honours the
 * action's own declared `visible` gate.
 *
 * `ObjectView` arms the declared nav deep link through `useOfferedNavRunAction`
 * and composes `autoTrigger: true` onto the action it names. Before this card
 * the arming step checked placement only, so a deep link naming an action its
 * author had hidden on this surface was armed and CONSUMED (the param stripped,
 * unrecoverable) and the renderer then ran it anyway. The renderers now refuse
 * such an action (`action-overflow-autotrigger.test.tsx`), but refusing there
 * alone would still spend the one-shot intent on nothing — so this step asks
 * the same question first.
 *
 * The probe below composes exactly what `ObjectView` composes and hands it to
 * the REAL `action:bar`, so the parity block measures the preparation verdict
 * against the verdict the renderer reaches on the same action, in the same
 * predicate scope — the pin that keeps the two from drifting.
 *
 * The registry import is at module scope (not in a `beforeAll`) per AGENTS.md
 * §测试纪律.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
// Side-effect import: registers `action:bar` / `action:button` / `action:menu`.
import '@object-ui/components';
import { toast } from 'sonner';
import { ActionProvider, PredicateScopeProvider, SchemaRenderer } from '@object-ui/react';
import { actionRendersAt } from '@object-ui/types';
import type { ActionBarSchema } from '@object-ui/types';
import { NAV_RUN_ACTION_PARAM } from '@object-ui/layout';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { useOfferedNavRunAction } from '../useNavRunAction';

const ROUTE = '/apps/crm/account';

const CREATE = {
  name: 'create_account',
  label: 'Create Account',
  type: 'api',
  locations: ['list_toolbar'],
};

function land(name: string | null): void {
  window.history.replaceState({}, '', name === null ? ROUTE : `${ROUTE}?${NAV_RUN_ACTION_PARAM}=${name}`);
}

/** The param as the URL currently holds it — null once consumed. */
const paramNow = () => new URL(window.location.href).searchParams.get(NAV_RUN_ACTION_PARAM);

/** What `ObjectView` does with the hook's answer, verbatim in shape. */
function Toolbar({ actions, enabled = true }: { actions: any[]; enabled?: boolean }) {
  const armed = useOfferedNavRunAction(actions, (a: any) => actionRendersAt(a, 'list_toolbar'), enabled);
  const composed = armed === null ? actions : actions.map((a) => (a?.name === armed ? { ...a, autoTrigger: true } : a));
  // Typed as the `action:bar` node it is (objectui#11355), as `ObjectView` types its own.
  const bar: ActionBarSchema = { type: 'action:bar', location: 'list_toolbar', actions: composed };
  return <SchemaRenderer schema={bar} />;
}

function mount(actions: any[], opts: { scope?: Record<string, unknown>; enabled?: boolean } = {}) {
  const run = vi.fn<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>(async () => ({ success: true }));
  const view = render(
    <PredicateScopeProvider scope={opts.scope ?? {}}>
      <ActionProvider handlers={{ api: run }}>
        <Toolbar actions={actions} enabled={opts.enabled} />
      </ActionProvider>
    </PredicateScopeProvider>,
  );
  return { run, ...view };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let notice: ReturnType<typeof vi.spyOn>;
let diagnostic: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  land(null);
  notice = vi.spyOn(toast, 'warning').mockImplementation(() => 'id' as any);
  diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  land(null);
});

/** The preparation step's own diagnostics (its `[nav]` prefix), nothing else. */
const prepDiagnostics = (): string[] =>
  diagnostic.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith('[nav]'));

describe('the deep-link preparation step honours the declared visible gate (objectui#4191)', () => {
  it('a HIDDEN candidate is not armed, not consumed, not run — and the refusal is reported', async () => {
    land(CREATE.name);
    const { run } = mount([{ ...CREATE, visible: '1 == 2' }]);

    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    // Names the action the user asked for.
    expect(String(notice.mock.calls[0][0])).toContain('Create Account');
    expect(prepDiagnostics()).toHaveLength(1);
    expect(prepDiagnostics()[0]).toContain(CREATE.name);
    await flush();
    expect(run).not.toHaveBeenCalled();
    // The one-shot intent is left in the URL: a later mount can still honour it.
    expect(paramNow()).toBe(CREATE.name);
  });

  it('a visible candidate is armed, consumed and run once — no notice', async () => {
    land(CREATE.name);
    const { run } = mount([{ ...CREATE, visible: '1 == 1' }]);

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((run.mock.calls[0][0] as any).name).toBe(CREATE.name);
    await waitFor(() => expect(paramNow()).toBeNull());
    expect(notice).not.toHaveBeenCalled();
  });

  it('the refusal is reported once, however often the surface re-renders', async () => {
    land(CREATE.name);
    const view = mount([{ ...CREATE, visible: false }]);
    await waitFor(() => expect(notice).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 3; i++) {
      view.rerender(
        <PredicateScopeProvider scope={{}}>
          <ActionProvider handlers={{ api: view.run }}>
            <Toolbar actions={[{ ...CREATE, visible: false }]} />
          </ActionProvider>
        </PredicateScopeProvider>,
      );
    }
    await flush();
    expect(notice).toHaveBeenCalledTimes(1);
    expect(view.run).not.toHaveBeenCalled();
  });

  it('a name this surface does not render is the old quiet case — no notice, URL untouched', async () => {
    land(CREATE.name);
    const { run } = mount([{ ...CREATE, locations: ['record_header'], visible: false }]);
    await flush();
    expect(notice).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(paramNow()).toBe(CREATE.name);
  });

  it('disabled (another consumer owns the param here) — nothing is judged or reported', async () => {
    land(CREATE.name);
    const { run } = mount([{ ...CREATE, visible: false }], { enabled: false });
    await flush();
    expect(notice).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(paramNow()).toBe(CREATE.name);
  });
});

describe('parity: the preparation verdict IS the renderer verdict (objectui#4191)', () => {
  // Each row is one `visible` shape. The renderer half mounts the same action
  // WITHOUT a deep link and reads whether `action:bar` renders its button; the
  // preparation half lands the deep link and reads whether it armed. A second
  // evaluator that drifted on any row (scope, fail-closed, declared-ness) turns
  // that row red.
  const ROWS: Array<[string, unknown, Record<string, unknown>?]> = [
    ['undeclared', undefined],
    ['empty predicate (not a gate)', ''],
    ['literal false', false],
    ['literal true', true],
    ['false predicate', '1 == 2'],
    ['true predicate', '1 == 1'],
    ['a predicate that throws (fails CLOSED)', 'nosuchroot.flag == true'],
    ['an ambient-scope predicate, scope says yes', 'features.beta == true', { features: { beta: true } }],
    ['an ambient-scope predicate, scope says no', 'features.beta == true', { features: { beta: false } }],
  ];

  it.each(ROWS)('%s', async (_label, visible, scope) => {
    const action = visible === undefined ? { ...CREATE } : { ...CREATE, visible };

    // Renderer half: no deep link.
    land(null);
    const plain = mount([action], { scope });
    const rendered = screen.queryByRole('button', { name: 'Create Account' }) !== null;
    plain.unmount();

    // Preparation half: the deep link lands.
    land(CREATE.name);
    const { run } = mount([action], { scope });
    await flush();
    await flush();
    const armed = paramNow() === null;

    expect(armed).toBe(rendered);
    expect(run.mock.calls.length).toBe(rendered ? 1 : 0);
    expect(notice.mock.calls.length).toBe(rendered ? 0 : 1);
  });
});
