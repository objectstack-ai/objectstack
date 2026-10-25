/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10290, as narrowed by objectui#11638.
 *
 * objectui#10290 made every action CONTAINER (`action:bar`, `action:group`,
 * `action:menu`) evaluate a member's `properties.params` where `properties`
 * are (objectui#7867, ruling A), because a container member never passes
 * through the `SchemaRenderer` evaluation memo. objectui#11638 retired the
 * MEMBER half of that: the spec refuses a `properties` bag on an
 * `action:group` / `action:menu` member ("A member carries no `properties`
 * bag: its static parameter values (`properties.params`) are not part of the
 * inline action vocabulary"), and an action that needs static values is its
 * own `action:button` node. So the paths split by WHICH reader the member
 * reaches:
 *
 *   - NODE path: `action:bar` mounts an inline member on `action:button` /
 *     `action:icon`, whose own node reader (`readStaticParamValues`) reads
 *     `properties.params`. The bar still evaluates it first (objectui#10290);
 *     those pins are unchanged.
 *   - MEMBER path: `action:group` / `action:menu` run the member themselves,
 *     and so does an `action:bar` member that lands in the overflow menu. A
 *     member's `properties.params` reaches the runner on none of them
 *     (objectui#11638). These are the objectui#10290 pins INVERTED: each used
 *     to assert the resolved values arrive.
 *
 * Driven end to end through the real pieces: the real `SchemaRenderer` renders
 * the real container, the click or menu selection goes through the real
 * `ActionRunner`, and the value asserted is the `ActionDef` the registered
 * handler receives. The row is bound the way a record page binds it, through
 * `RecordContextProvider`.
 *
 * The CONTROL is a top-level `action:button` with the same `properties.params`.
 * It goes through the `SchemaRenderer` memo, so it resolves on every path: a
 * member row that differs from a green control means the container, never an
 * unbound `record` root.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ActionContext, ActionDef, ActionResult, ParamCollectionHandler } from '@object-ui/core';
// These nodes are written the way the runtime reads them, flat on the node,
// which the closed `action:*` node types refuse: measured on objectui#11466,
// typing the fixtures as `DeclaredNode` refuses them line by line. So each
// crosses through the one test helper for undeclared input.
import { undeclaredNode } from '@object-ui/test-support';
import { ActionProvider, RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Module-scope side-effect imports: `action:bar` resolves its members and its
// overflow menu through the ComponentRegistry at render time, and the light
// `dom` project does not load the components graph. Module scope, not a
// `beforeAll`, per AGENTS.md 测试纪律.
import '../action-bar';
import '../action-button';
import '../action-icon';
import '../action-menu';
import '../action-group';
import { resetStaticParamsWarnings } from '../static-params';

const ROW = { id: 'rec_1', name: 'Acme' };

/** The authored values: one template leaf, one literal leaf. */
const AUTHORED = { objectName: 'account', recordId: '${record.id}' };

/** What the handler must receive once the template is evaluated. */
const RESOLVED = { objectName: 'account', recordId: 'rec_1' };

/** An `api` member's object `params`: its request payload (objectstack#5777 window). */
const PAYLOAD = { objectName: 'account', recordId: 'rec_7' };

/** An `ActionParam[]` input list, and what the user answers it with. */
const INPUTS = [{ name: 'reason', type: 'text', label: 'Reason' }];
const COLLECTED = { reason: 'because' };

/** The overflow trigger's accessible name, with no i18n bundle loaded. */
const MORE = 'More actions';

type Handler = Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

let navigateEdit: Handler;
let api: Handler;
let onParamCollection: Mock<ParamCollectionHandler>;
let warn: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  navigateEdit = vi.fn(async () => ({ success: true }));
  api = vi.fn(async () => ({ success: true }));
  // The user fills the one input in; the handler then receives what was
  // collected, merged over whatever static `params` the container forwarded.
  onParamCollection = vi.fn(async () => COLLECTED);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  resetStaticParamsWarnings();
});

afterEach(() => {
  warn.mockRestore();
  consoleError.mockRestore();
});

/** One member action, as an author writes it inside a container's `actions`. */
function member(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'edit', label: 'Edit', type: 'navigate_edit', ...extra };
}

/** Render `schema` on a record page bound to {@link ROW}. */
function renderOnRecordPage(schema: Record<string, unknown>) {
  return render(
    <ActionProvider handlers={{ navigate_edit: navigateEdit, api }} onParamCollection={onParamCollection}>
      <RecordContextProvider objectName="account" recordId={ROW.id} data={ROW}>
        <SchemaRenderer schema={undeclaredNode(schema)} />
      </RecordContextProvider>
    </ActionProvider>,
  );
}

/** Radix opens a dropdown on `pointerdown` and mounts its content in a portal. */
async function selectFromMenu(trigger: HTMLElement, label: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const menu = await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name: label }));
}

/** How the member is reached once its container is on screen. */
type Reach = (label: string) => Promise<void>;

const clickButton: Reach = async (label) => {
  fireEvent.click(screen.getByRole('button', { name: label }));
};

const viaTrigger = (triggerName: string): Reach => async (label) => {
  await selectFromMenu(screen.getByRole('button', { name: triggerName }), label);
};

type Container = {
  path: string;
  schema: (m: Record<string, unknown>) => Record<string, unknown>;
  reach: Reach;
};

/**
 * NODE path: `action:bar` mounts the member on `action:button` /
 * `action:icon`, whose node reader reads `properties.params`.
 */
const NODE_PATH: ReadonlyArray<Container> = [
  {
    path: 'action:bar, inline member',
    schema: (m) => ({ type: 'action:bar', actions: [m] }),
    reach: clickButton,
  },
  {
    path: 'action:bar, member drawn as an icon (`component: action:icon`)',
    schema: (m) => ({ type: 'action:bar', actions: [{ ...m, component: 'action:icon' }] }),
    reach: clickButton,
  },
  {
    path: 'action:bar, member placed in a button group (`component: action:group`)',
    schema: (m) => ({ type: 'action:bar', actions: [{ ...m, component: 'action:group' }] }),
    reach: clickButton,
  },
];

/**
 * MEMBER path: the container runs the member itself (`action:group`,
 * `action:menu`, and the `action:menu` an `action:bar` overflows into).
 */
const MEMBER_PATH: ReadonlyArray<Container> = [
  {
    path: 'action:bar, member placed in the overflow menu (`component: action:menu`)',
    schema: (m) => ({ type: 'action:bar', actions: [{ ...m, component: 'action:menu' }] }),
    reach: viaTrigger(MORE),
  },
  {
    path: 'action:bar, member spilled past `maxVisible` into the overflow menu',
    schema: (m) => ({
      type: 'action:bar',
      maxVisible: 1,
      mobileMaxVisible: 1,
      actions: [{ name: 'first', label: 'First', type: 'navigate_edit' }, m],
    }),
    reach: viaTrigger(MORE),
  },
  {
    path: 'action:group, inline display',
    schema: (m) => ({ type: 'action:group', actions: [m] }),
    reach: clickButton,
  },
  {
    path: 'action:group, dropdown display',
    schema: (m) => ({ type: 'action:group', display: 'dropdown', label: 'Group', actions: [m] }),
    reach: viaTrigger('Group'),
  },
  {
    path: 'action:menu',
    schema: (m) => ({ type: 'action:menu', actions: [m] }),
    reach: viaTrigger(MORE),
  },
];

/** Every path a container member reaches the runner by. */
const CONTAINERS: ReadonlyArray<Container> = [...NODE_PATH, ...MEMBER_PATH];

/** Mount, reach the member, return the `ActionDef` `handler` received. */
async function defReceived(
  schema: Record<string, unknown>,
  reach: Reach,
  handler: Handler = navigateEdit,
): Promise<ActionDef> {
  renderOnRecordPage(schema);
  await reach('Edit');
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  return handler.mock.calls[0][0] as ActionDef;
}

/** Mount, reach the member, return the `params` the handler received. */
async function paramsReceived(schema: Record<string, unknown>, reach: Reach): Promise<unknown> {
  return (await defReceived(schema, reach)).params;
}

describe('objectui#10290 - an `action:bar` member\'s `properties.params` is evaluated where `properties` are', () => {
  it('CONTROL: a top-level `action:button` resolves `${record.id}` through the SchemaRenderer memo', async () => {
    const params = await paramsReceived(
      {
        type: 'action:button',
        name: 'edit',
        label: 'Edit',
        actionType: 'navigate_edit',
        properties: { params: AUTHORED },
      },
      clickButton,
    );
    expect(params).toEqual(RESOLVED);
  });

  describe.each(NODE_PATH)('$path', ({ schema, reach }) => {
    it('the handler receives `properties.params` with `${record.id}` resolved', async () => {
      const params = await paramsReceived(schema(member({ properties: { params: AUTHORED } })), reach);
      expect(params).toEqual(RESOLVED);
    });
  });

  // On every path, node and member alike.
  describe.each(CONTAINERS)('$path', ({ schema, reach }) => {
    it('a node-level `params` OBJECT is still not a values channel, and says so once (objectui#10289)', async () => {
      const params = await paramsReceived(schema(member({ params: AUTHORED })), reach);
      expect(params).toBeUndefined();
      const lines = warn.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((m: string) => m.includes('action "edit"') && m.includes('`params`'));
      expect(lines).toHaveLength(1);
    });
  });
});

describe('objectui#11638 - a container member\'s `properties.params` does not reach the runner', () => {
  describe.each(MEMBER_PATH)('$path', ({ schema, reach }) => {
    // INVERTED from objectui#10290's "the handler receives `properties.params`
    // with `${record.id}` resolved" on this path.
    it('a member\'s `properties.params` is not forwarded as static values', async () => {
      const params = await paramsReceived(schema(member({ properties: { params: AUTHORED } })), reach);
      expect(params).toBeUndefined();
    });

    it('an array `params` reaches the runner as `actionParams` alone, beside a `properties.params`', async () => {
      const def = await defReceived(
        schema(member({ params: INPUTS, properties: { params: AUTHORED } })),
        reach,
      );
      expect(onParamCollection).toHaveBeenCalledTimes(1);
      expect(onParamCollection.mock.calls[0][0]).toEqual(INPUTS);
      expect(def.actionParams).toEqual(INPUTS);
      // Only what the user answered: no static values were forwarded to merge
      // the answer over.
      expect(def.params).toEqual(COLLECTED);
    });

    it('an `api` member\'s object `params` is its payload, and a `properties.params` beside it no longer replaces it', async () => {
      const def = await defReceived(
        schema(member({ type: 'api', target: '/api/v1/ping', params: PAYLOAD, properties: { params: AUTHORED } })),
        reach,
        api,
      );
      expect(def.params).toEqual(PAYLOAD);
    });
  });
});
