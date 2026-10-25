/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11344 — `ActionSchema.outcomeMessages` must SURVIVE the hop on all
 * four declared action surfaces, and on the `action:bar` path a registered
 * action actually takes to them.
 *
 * Each action renderer hands the runner an explicit key whitelist, so a key the
 * runner reads stays dropped until every whitelist carries it — the
 * objectstack#6837 shape. `check:action-forward-parity` asks that statically,
 * once the runner reads the key off the forwarded def; these rows measure the
 * same thing at run time, at the artefact the user sees: the success toast.
 *
 * ## Why the toast, and why the answer carries a `message`
 *
 * Every row's handler answers `{ outcome: 'archived', name: 'prod', message }`.
 * With the map dropped, the toast would read `successMessage` (the second
 * rung); with the retired server-message rung back, it would read `message`.
 * Only the forwarded map, picked by `outcome` and interpolated, produces
 * `Environment prod archived` — so neither regression can pass a row.
 *
 * Each row first asserts the handler ran exactly once (the positive control), so
 * a wrong toast is never "the harness executed nothing".
 *
 * ## The `action:bar` row is the producer path
 *
 * An object's registered actions reach a record header as `action:bar` members,
 * and the bar spreads each member WHOLE onto an `action:button` node
 * (`renderMember` in `action-bar.tsx`). So the map on a registered action
 * arrives at `action:button` without anyone authoring it there; dropped by that
 * whitelist, it never reached the runner. `element:button` is absent for the
 * reason `action-onSuccess-forward.test.tsx` gives: the spec's
 * `InlineActionSchema` pick list does not carry the key.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult, ToastHandler } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports — these renderers register themselves with
// the ComponentRegistry, and the light `dom` project does not load the
// `@object-ui/components` graph. Module scope, not a `beforeAll`, per
// AGENTS.md §测试纪律.
import '../action-button';
import '../action-icon';
import '../action-group';
import '../action-menu';
import '../action-bar';

/** The handler's own return value — what `outcome` and `${result.*}` read. */
const PAYLOAD = { outcome: 'archived', name: 'prod', message: 'Environment prod archived (server English).' };

const OUTCOME_MESSAGES = {
  archived: 'Environment ${result.name} archived',
  already_archived: 'Environment ${result.name} was already archived',
};

/** The registered action, as an object's `actions` array declares it. */
const declaration = (extra: Record<string, unknown> = {}) => ({
  name: 'delete_environment',
  label: 'Delete environment',
  type: 'script',
  locations: ['record_header'],
  outcomeMessages: OUTCOME_MESSAGES,
  successMessage: 'Environment ${result.name} updated',
  ...extra,
});

/** As a NODE handed straight to a leaf, the execution type is `actionType` (objectui#7415). */
const asNode = (component: string, decl: Record<string, unknown>) => {
  const { type, ...rest } = decl;
  return { ...rest, type: component, actionType: type };
};

let script: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let toast: Mock<ToastHandler>;

beforeEach(() => {
  script = vi.fn(async () => ({ success: true, data: PAYLOAD }));
  toast = vi.fn();
});

function surface(type: string, schema: Record<string, unknown>) {
  const C = ComponentRegistry.get(type);
  if (!C) throw new Error(`${type} is not registered`);
  return <C schema={schema as never} />;
}

const renderSurface = (node: React.ReactNode) =>
  render(
    <ActionProvider handlers={{ script }} onToast={toast}>
      {node}
    </ActionProvider>,
  );

/** The positive control, the forward, and the toast the user reads. */
async function expectOutcomeToast() {
  await waitFor(() => expect(script).toHaveBeenCalledTimes(1));
  expect(script.mock.calls[0][0].outcomeMessages).toEqual(OUTCOME_MESSAGES);
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  expect(toast.mock.calls[0][0]).toBe('Environment prod archived');
  expect(toast.mock.calls[0][1]).toEqual(expect.objectContaining({ type: 'success' }));
}

describe('ActionSchema.outcomeMessages reaches the success toast from every declared surface (objectui#11344)', () => {
  it('action:bar → action:button — a registered action spread onto the button keeps its outcome copy', async () => {
    const Bar = ComponentRegistry.get('action:bar');
    if (!Bar) throw new Error('action:bar is not registered');
    // Both ceilings high, so the member stays inline on any viewport (see
    // `action-bar-member-type-resolution.test.tsx`).
    renderSurface(
      <Bar
        schema={{ type: 'action:bar', maxVisible: 10, mobileMaxVisible: 10, actions: [declaration()] } as never}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete environment' }));

    await expectOutcomeToast();
  });

  it('action:button — a node carrying the map', async () => {
    renderSurface(surface('action:button', asNode('action:button', declaration())));

    fireEvent.click(screen.getByRole('button', { name: 'Delete environment' }));

    await expectOutcomeToast();
  });

  it('action:icon — the icon-only surface', async () => {
    renderSurface(surface('action:icon', asNode('action:icon', declaration())));

    fireEvent.click(screen.getByRole('button', { name: 'Delete environment' }));

    await expectOutcomeToast();
  });

  it('action:group — an inline group member', async () => {
    renderSurface(surface('action:group', { type: 'action:group', actions: [declaration()] }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete environment' }));

    await expectOutcomeToast();
  });

  it('action:menu — an overflow item', async () => {
    // `autoTrigger` runs `handleExecute`, the function a click on the menu item
    // calls, without opening the Radix dropdown (see
    // `action-onSuccess-forward.test.tsx`).
    renderSurface(surface('action:menu', { type: 'action:menu', actions: [declaration({ autoTrigger: true })] }));

    await expectOutcomeToast();
  });
});
