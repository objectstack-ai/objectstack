/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26665 — a `destructive` action block confirms through the
 * destructive button.
 *
 * The runner paints its confirm button destructive when the action it runs
 * declares `variant: 'danger'` (`confirmOptions`, objectstack#26580). The four
 * action blocks speak the spec's BLOCK dialect, where that value is spelled
 * `destructive`, and before this card none of them forwarded `variant` at all,
 * so a destructive block asked its question through a neutral button. Each
 * renderer now forwards its variant through `toRunnerVariant`.
 *
 * Every row reads the confirm handler's own call, the artefact the dialog is
 * drawn from, and first asserts it was called once (the positive control). The
 * `outline` row is the control for the mapping: a value the action dialect has
 * no word for forwards nothing, so that question stays neutral.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult, ConfirmationHandler } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// Module-scope side-effect imports — these renderers register themselves with
// the ComponentRegistry, and the light `dom` project does not load the
// `@object-ui/components` graph. Module scope, not a `beforeAll`, per
// AGENTS.md §测试纪律.
import '../action-button';
import '../action-icon';
import '../action-group';
import '../action-menu';
import { toRunnerVariant } from '../runner-variant';

const ACTION = {
  name: 'purge_history',
  label: 'Purge history',
  confirmText: 'This cannot be undone.',
};

let script: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let confirm: Mock<ConfirmationHandler>;

beforeEach(() => {
  script = vi.fn(async () => ({ success: true }));
  // A cancel: the question is what is measured, not the run.
  confirm = vi.fn(async () => false);
});

function surface(type: string, schema: Record<string, unknown>) {
  const C = ComponentRegistry.get(type);
  if (!C) throw new Error(`${type} is not registered`);
  return <C schema={schema as never} />;
}

/** Each surface, carrying one action declared with `variant`, and how to run it. */
const SURFACES: Array<[string, (variant: string) => Record<string, unknown>, boolean]> = [
  ['action:button', (variant) => ({ ...ACTION, type: 'action:button', actionType: 'script', variant }), true],
  ['action:icon', (variant) => ({ ...ACTION, type: 'action:icon', actionType: 'script', icon: 'trash', variant }), true],
  ['action:group', (variant) => ({ type: 'action:group', actions: [{ ...ACTION, type: 'script', variant }] }), true],
  // `autoTrigger` runs `handleExecute`, the function a click on the menu item
  // calls, without opening the Radix dropdown (see `action-onSuccess-forward.test.tsx`).
  ['action:menu', (variant) => ({ type: 'action:menu', actions: [{ ...ACTION, type: 'script', variant, autoTrigger: true }] }), false],
];

async function confirmOptionsFor(type: string, schema: Record<string, unknown>, click: boolean) {
  render(
    <ActionProvider handlers={{ script }} onConfirm={confirm}>
      {surface(type, schema)}
    </ActionProvider>,
  );
  if (click) fireEvent.click(screen.getByRole('button', { name: 'Purge history' }));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(script).not.toHaveBeenCalled();
  return confirm.mock.calls[0][1];
}

describe.each(SURFACES)('%s forwards its variant in the runner dialect (objectstack#26665)', (type, schemaFor, click) => {
  it('`destructive` confirms through the destructive button', async () => {
    expect(await confirmOptionsFor(type, schemaFor('destructive'), click)).toEqual({
      title: 'Purge history',
      confirmText: 'Purge history',
      destructive: true,
    });
  });

  it('CONTROL: `outline` has no action-dialect word, so the question stays neutral', async () => {
    expect(await confirmOptionsFor(type, schemaFor('outline'), click)).toEqual({
      title: 'Purge history',
      confirmText: 'Purge history',
    });
  });
});

describe('toRunnerVariant (objectstack#26665)', () => {
  it('maps the block dialect onto the action dialect', () => {
    expect(toRunnerVariant('destructive')).toBe('danger');
    expect(toRunnerVariant('primary')).toBe('primary');
    expect(toRunnerVariant('secondary')).toBe('secondary');
    expect(toRunnerVariant('ghost')).toBe('ghost');
    expect(toRunnerVariant('link')).toBe('link');
    expect(toRunnerVariant('default')).toBeUndefined();
    expect(toRunnerVariant('outline')).toBeUndefined();
    expect(toRunnerVariant(undefined)).toBeUndefined();
  });
});
