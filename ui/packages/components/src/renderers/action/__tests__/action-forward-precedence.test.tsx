/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4281 — the hoist that restored the compiler's excess-property check
 * must not have changed what reaches the runner.
 *
 * `action:button` and `action:icon` used to compose their payload as ONE literal
 * with the spreads inline:
 *
 *   execute({ type, name, …, ...paramsPayload, …, resultDialog, ...localContext })
 *
 * A literal that spreads an `any` is not excess-property checked (`localContext`
 * is `any` — `PropsWithoutRef` collapses these index-signature props interfaces),
 * so an invented key was absorbed in silence while `action:group` / `action:menu`
 * rejected it. The fix hoists the explicit keys into an `ActionDef`-annotated
 * binding and composes the spreads around it.
 *
 * That is a REFACTOR of an object literal, and object literals have two
 * observable properties a refactor can silently change — which key wins a
 * collision, and what order the keys end up in. Both are pinned here.
 *
 * ## What the collision semantics actually are (measured, not assumed)
 *
 *   `...localContext` is spread LAST, so a host-supplied context key OVERRIDES
 *   the authored action's own value for that key. That is pre-existing
 *   behaviour and is deliberately preserved: `context` is documented as an
 *   "Override context for this specific action".
 *
 *   `...paramsPayload` (`action:button`, and `action:icon` since
 *   objectui#10289) can carry only `params` or `actionParams`, and NEITHER is
 *   an explicit key of the surrounding literal —
 *   the two key sets are disjoint, so its position cannot decide a collision.
 *   It is nonetheless kept in its original position, so the resulting key ORDER
 *   is unchanged too, and that is asserted rather than argued.
 *
 * ## Why key ORDER is worth pinning and not over-pinning
 *
 * Nothing in the runner reads `Object.keys(def)` today, so order is not a
 * contract — but it is the sharpest available evidence that the composition is
 * byte-for-byte what it was. Moving `...paramsPayload` to the end (the obvious
 * way to write this fix) changes the order and nothing else; without this
 * assertion that refactor would be indistinguishable from the correct one.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports — the light `dom` project does not load the
// `@object-ui/components` graph, and these renderers register themselves on
// import. Module scope, not a `beforeAll`, per AGENTS.md §测试纪律.
import '../action-button';
import '../action-icon';

/**
 * A declaration touching every key whose FORWARD ORDER the hoist could have
 * disturbed. The static values ride `properties.params` (objectui#10289, ruling
 * A: `params` itself is only the `ActionParam[]` input list), so both surfaces
 * take the `{ params }` branch of `paramsPayload` — the branch that sits
 * mid-literal.
 */
const ACTION = {
  name: 'create_environment',
  // The renamed declared input (objectui#7415). The node's `type` is the
  // COMPONENT id, stamped by `Renderer` below — the collision this rename
  // removed is exactly that these two used to want the same slot.
  actionType: 'api',
  label: 'Create Environment',
  description: 'Provision a new environment for this project',
  target: 'authoredTarget',
  openIn: 'new-tab',
  endpoint: '/api/v1/environments',
  method: 'POST',
  properties: { params: { region: 'eu-west-1' } },
  bodyExtra: { source: 'console' },
  bodyShape: { wrap: 'data' },
  locations: ['list_toolbar'],
};

/** The host's override bag: one COLLIDING key, one the action never declared. */
const CONTEXT = { target: 'contextWins', extraFromHost: 'present' };

/**
 * The exact key order `action:button` composes, top to bottom of its literal.
 * `params` sits where `...paramsPayload` sits — ninth, not last.
 *
 * `onSuccess` (objectui#5493, the declared post-success hop) and then
 * `objectName` (objectui#4202, the object the action declares it acts on) were
 * each APPENDED at the tail. A whitelist key appended moves nothing, which is
 * exactly the reading these two lists exist to give: the diff shows one added
 * name and no re-ordering of the keys the #4281 hoist was about.
 *
 * `operation` (objectui#7551) was the first key added in the MIDDLE rather
 * than at the tail — it sits with `bodyExtra` / `bodyShape` because it shapes
 * the same request. The reading is unchanged and is why the position was
 * acceptable: the list is compared whole, so the failure diff still shows
 * exactly the added names against a sequence of pre-existing keys whose
 * relative order did not move. An insertion that DID reorder the neighbours
 * would show up here as several moved names, not one added one. Its partner
 * `patch` left both lists with objectui#13022: the route writes the `patch` of
 * the declaration the action's `name` names, never a node's own, so no
 * renderer forwards one. A removal reads the same way: one name gone, no
 * neighbour moved.
 *
 * `outcomeMessages` (objectui#11344) is the next middle insertion, beside
 * `successMessage`, the copy it outranks in the success toast. Same reading:
 * one added name, no neighbour moved.
 */
const BUTTON_ORDER = [
  'type', 'name', 'label', 'description', 'target', 'openIn', 'endpoint', 'method',
  'params',
  'bodyExtra', 'bodyShape', 'operation', 'confirmText', 'successMessage', 'outcomeMessages', 'errorMessage',
  'refreshAfter', 'undoable', 'recordIdField', 'locations', 'toast', 'resultDialog', 'onSuccess', 'objectName',
];

/**
 * `action:icon` routes `params` through the same `...paramsPayload` as
 * `action:button` (objectui#10289); the spread sits where its explicit
 * `params` key used to, so the order is unchanged.
 */
const ICON_ORDER = [
  'type', 'name', 'label', 'description', 'target', 'openIn', 'endpoint', 'method',
  'params',
  'bodyExtra', 'bodyShape', 'operation', 'confirmText', 'successMessage', 'outcomeMessages', 'errorMessage',
  'refreshAfter', 'locations', 'toast', 'resultDialog', 'onSuccess', 'objectName',
];

// See action-bodyExtra-forward.test.tsx for why this is not
// `ReturnType<typeof vi.fn>` (objectui#4040).
let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

beforeEach(() => {
  api = vi.fn(async () => ({ success: true }));
});

function Renderer({ type, context }: { type: string; context?: Record<string, any> }) {
  const C = ComponentRegistry.get(type);
  if (!C) throw new Error(`${type} is not registered`);
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered renderer (stable reference), not a component created during render
  return <C schema={{ ...ACTION, type }} context={context} />;
}

/** Renders the surface, fires the click, and returns the def the runner got. */
async function forwarded(type: string, context?: Record<string, any>): Promise<Record<string, any>> {
  const { container } = render(
    <ActionProvider handlers={{ api }}>
      <Renderer type={type} context={context} />
    </ActionProvider>,
  );
  const button = container.querySelector('button');
  expect(button, `${type} rendered no button`).not.toBeNull();
  fireEvent.click(button!);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  // The runner hands the handler the very object the renderer composed
  // (`handler(action, this.context)`, ActionRunner.ts:1014) — no copy, so key
  // order survives the hop and this assertion is about the literal itself.
  return api.mock.calls[0][0] as Record<string, any>;
}

describe.each([
  ['action:button', BUTTON_ORDER],
  ['action:icon', ICON_ORDER],
])('%s composes its forward payload unchanged by the #4281 hoist', (surface, order) => {
  it('forwards exactly the declared key set, in the declared order', async () => {
    const def = await forwarded(surface);
    expect(Object.keys(def)).toEqual(order);
  });

  it('carries the authored values through', async () => {
    const def = await forwarded(surface);
    expect({
      name: def.name,
      label: def.label,
      description: def.description,
      target: def.target,
      endpoint: def.endpoint,
      method: def.method,
      params: def.params,
      bodyExtra: def.bodyExtra,
      bodyShape: def.bodyShape,
    }).toEqual({
      name: 'create_environment',
      label: 'Create Environment',
      description: 'Provision a new environment for this project',
      target: 'authoredTarget',
      endpoint: '/api/v1/environments',
      method: 'POST',
      params: { region: 'eu-west-1' },
      bodyExtra: { source: 'console' },
      bodyShape: { wrap: 'data' },
    });
  });

  it('lets the host context OVERRIDE a declared key — `...localContext` is still merged last', async () => {
    // The one live collision this composition admits. Pinned in both directions:
    // the colliding key takes the context's value, and a key only the context
    // carries still arrives. If the hoist had merged `localContext` before the
    // explicit keys, the first assertion would read `authoredTarget`.
    const def = await forwarded(surface, CONTEXT);
    expect(def.target).toBe('contextWins');
    expect(def.extraFromHost).toBe('present');
  });

  it('appends context-only keys after the declared ones, without moving the collided key', async () => {
    // JS spread semantics, pinned because they are what makes the assertion
    // above safe: an overriding key keeps its ORIGINAL position (only its value
    // changes) and a novel key is appended.
    const def = await forwarded(surface, CONTEXT);
    expect(Object.keys(def)).toEqual([...order, 'extraFromHost']);
    expect(Object.keys(def).indexOf('target')).toBe(order.indexOf('target'));
  });
});
