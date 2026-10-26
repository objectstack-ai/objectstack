/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4192 — the same declared action, rendered inline or in the overflow
 * menu, must reach the runner carrying the same authored keys.
 *
 * Which renderer an action gets is decided by `action:bar`'s `maxVisible` split
 * (3 desktop, 1 mobile) and by `systemActions`, which are ALWAYS in the menu. So
 * a whitelist that has drifted between the two renderers makes the same
 * declaration behave differently by VIEWPORT WIDTH — the class of divergence
 * #4162 and objectui#4075 each hit on a different key set.
 *
 * `label` and `description` are the measured instance. The console's param
 * collection handler titles its dialog from exactly those two —
 * `title: action?.label` and `description: actionDescription(…,
 * action?.description)`, in the `setParamState` call of
 * `useConsoleActionRuntime`'s `paramCollectionHandler` (and of the second copy
 * that `RecordDetailView` carries) — so an overflow action opened an untitled
 * dialog while the SAME declaration, rendered inline, named itself.
 *
 * The title line used to read `action?.label || action?.title`. That fallback
 * named a key declared on no action surface and forwarded by no renderer, and
 * was removed by objectui#4282 and objectui#5610; `label` is now the only key
 * that titles the dialog, which is what makes this file's `label` assertion the
 * whole of the title contract rather than half of it.
 *
 * ## Why this file exists alongside `scripts/check-action-forward-parity.mjs`
 *
 * The gate (objectui#4050) reads the whitelists statically: it proves the key
 * appears in the `execute({…})` literal. It cannot prove the value SURVIVES the
 * hop — that the runner receives it and that the handler which titles the dialog
 * sees it. These pins drive the real renderers through the real runner and
 * assert on what the handler is actually handed, so the two halves fail for
 * different reasons: delete a key from the whitelist and both go red; break the
 * runner's param-collection dispatch and only this file does.
 *
 * ## Reachability, deliberately NOT pinned here
 *
 * `undoable` and `recordIdField` are absent from these payloads on purpose.
 * Both are read only under a `rowRecord` guard, and `rowRecord` is
 * `params._rowRecord` — written by the spread-based hosts
 * (`DeclaredActionsBar`, `RelatedRecordActionsBridge`, `ObjectGrid`,
 * `page:header`) and, since objectui#11168, by `action:button` itself for an
 * `undoable` `operation: 'update'` of the record in scope (pinned in
 * `action-button-undoable-11168.test.tsx`). The menu, the group and the icon
 * write it nowhere, so on them both keys stay unreachable and omitting them
 * costs nothing. That verdict is carried, with its evidence, in the gate's
 * JUSTIFIED table.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type {
  ActionContext,
  ActionDef,
  ActionResult,
  ParamCollectionHandler,
} from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports — `action:bar` resolves its members and the
// overflow menu through the ComponentRegistry at render time, and the light
// `dom` project does not load the `@object-ui/components` graph. Module scope,
// not a `beforeAll`, per AGENTS.md §测试纪律.
import '../action-bar';
import '../action-button';
import '../action-menu';

/** Three ordinary actions — enough to fill the desktop `maxVisible: 3`. */
const FILLERS = [
  { name: 'a1', label: 'a1', type: 'api', locations: ['list_toolbar'] },
  { name: 'a2', label: 'a2', type: 'api', locations: ['list_toolbar'] },
  { name: 'a3', label: 'a3', type: 'api', locations: ['list_toolbar'] },
];

/**
 * The card's action. `params` is an ARRAY — a parameter DEFINITION list — so the
 * runner opens param collection before executing, which is the path whose dialog
 * was going untitled. `autoTrigger` runs `handleExecute`, the identical function
 * a click on the menu item calls, without opening the Radix dropdown (whose
 * pointerdown-driven portal is flaky to synthesize in happy-dom — see
 * `action-group-dropdown-visible.test.tsx`).
 */
const CREATE = {
  name: 'create_environment',
  label: 'Create Environment',
  description: 'Provision a new environment for this project',
  type: 'api',
  locations: ['list_toolbar'],
  params: [{ name: 'title', type: 'text', label: 'Title' }],
  autoTrigger: true,
};

// Typed with the signatures the provider's props declare, not
// `ReturnType<typeof vi.fn>` — see action-bodyExtra-forward.test.tsx
// (objectui#4040).
let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let onParamCollection: Mock<ParamCollectionHandler>;

beforeEach(() => {
  api = vi.fn(async () => ({ success: true }));
  // Cancel collection: this pin is about what the handler is HANDED, and
  // cancelling keeps the assertion off everything downstream of the dialog.
  onParamCollection = vi.fn(async () => null);
});

function Bar({ actions }: { actions: any[] }) {
  const C = ComponentRegistry.get('action:bar');
  if (!C) throw new Error('action:bar is not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered renderer (stable reference), not a component created during render
  return <C schema={{ type: 'action:bar', location: 'list_toolbar', actions }} />;
}

const renderBar = (actions: any[]) =>
  render(
    <ActionProvider handlers={{ api }} onParamCollection={onParamCollection}>
      <Bar actions={actions} />
    </ActionProvider>,
  );

/** The action object the param-collection handler was handed. */
const collectedAction = () => onParamCollection.mock.calls[0]?.[1] as any;

describe('action:menu forwards the keys that title a param dialog (#4192)', () => {
  it('the overflow path hands the dialog the action`s own label and description', async () => {
    // Four actions, `maxVisible: 3` → the create action is 4th, so `action:bar`
    // routes it to `action:menu`. Before the fix the handler received
    // `label: undefined, description: undefined` here and the console titled
    // the dialog "Action parameters".
    renderBar([...FILLERS, CREATE]);

    await waitFor(() => expect(onParamCollection).toHaveBeenCalledTimes(1));
    expect(collectedAction().label).toBe('Create Environment');
    expect(collectedAction().description).toBe('Provision a new environment for this project');
  });

  it('is indistinguishable from the inline path — the split must not decide the title', async () => {
    // The SAME declaration with nothing to overflow past: `action:bar` keeps it
    // inline and it renders through `action:button`. Both renderers must hand
    // the handler the same two keys, or the dialog's title becomes a function of
    // viewport width.
    renderBar([CREATE]);

    await waitFor(() => expect(onParamCollection).toHaveBeenCalledTimes(1));
    const inline = collectedAction();
    expect(inline.label).toBe('Create Environment');
    expect(inline.description).toBe('Provision a new environment for this project');
  });

  it('still routes an array `params` as the collection definition, not as a payload', async () => {
    // The menu passes `params: action.params` where the button routes an array
    // to `actionParams`; the runner accepts either (ActionRunner.ts:816), which
    // is why #4192 was a wrong TITLE and not a missing dialog. Pinned so the
    // divergence stays latent rather than becoming the next defect.
    renderBar([...FILLERS, CREATE]);

    await waitFor(() => expect(onParamCollection).toHaveBeenCalledTimes(1));
    const paramDefs = onParamCollection.mock.calls[0][0] as any[];
    expect(paramDefs).toHaveLength(1);
    expect(paramDefs[0].name).toBe('title');
  });

  it('carries the label through to the runner itself, not only to the dialog', async () => {
    // No `params`, so nothing to collect and the action runs: the `api` handler
    // receives the ActionDef the menu composed. Asserting here as well as at the
    // dialog keeps the pin honest if param collection is ever restructured.
    const { name, type, locations, label, description } = CREATE;
    renderBar([...FILLERS, { name, type, locations, label, description, autoTrigger: true }]);

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const def = api.mock.calls[0][0] as any;
    expect(def.name).toBe('create_environment');
    expect(def.label).toBe('Create Environment');
    expect(def.description).toBe('Provision a new environment for this project');
  });
});
