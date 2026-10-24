/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10288: an authored data object that carries a `source` field must
 * reach the runner WHOLE, whichever channel it is written on.
 *
 * `SchemaRenderer`'s per-value `properties` loop handed every value to
 * `ExpressionEvaluator.evaluate`, whose first step unwraps ANY object with a
 * string `source` to that bare string. So `properties.bodyExtra: { source:
 * 'web', campaign: 'spring' }` reached the handler as `bodyExtra: "web"`. The
 * same object written at node level is visited by no loop and always arrived
 * intact: that is the CONTROL below, and it is what makes a red CASE mean the
 * `properties` leg rather than an unforwarded key.
 *
 * Driven end to end through the REAL pieces, for the reason
 * `action-params-templates-7867.test.tsx` gives: the real `SchemaRenderer`
 * renders the real `action:button`, the click goes through the real
 * `ActionRunner`, and the value asserted is read off the `ActionDef` the
 * registered handler was handed.
 *
 * The predicate-key rows are the objectui#9100 / #9107 envelope protection on
 * the SAME mount path. The fix narrows what the loop hands to `evaluate` on
 * NON-predicate keys only, so these rows must stay green with the fix and with
 * it ablated. Their predicate carries a CEL stdlib call (`has`), which the
 * legacy engine lacks, so a flattened envelope cannot pass them by accident.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
import {
  ActionProvider,
  PredicateScopeProvider,
  SchemaRenderer,
  SchemaRendererProvider,
} from '@object-ui/react';
// Module-scope side-effect import so `action:button` is registered before the
// first render (the light `dom` project does not load the components graph).
// Module scope, not a `beforeAll`, per AGENTS.md 测试纪律.
import '../action-button';

/** An authored data object whose `source` is a FIELD, not an expression. */
const BODY = { source: 'web', campaign: 'spring' };

const DATA = { status: 'draft' };

/** CEL stdlib call + a comparison. `has` does not exist on the legacy engine. */
const HOLDS = { dialect: 'cel', source: 'has(data.status) && data.status == "draft"' };
const FAILS = { dialect: 'cel', source: 'has(data.status) && data.status == "published"' };

let probe: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

beforeEach(() => {
  probe = vi.fn(async () => ({ success: true }));
});

afterEach(cleanup);

/**
 * Render one `action:button`. `DATA` is bound as the `data` root the way the
 * sibling envelope pins bind it (see `action-enablement-cel-envelope.test.tsx`
 * for why a plain object crosses the `DataSource` type here).
 */
function mount(node: Record<string, unknown>) {
  return render(
    <ActionProvider handlers={{ probe_10288: probe }}>
      <SchemaRendererProvider dataSource={DATA as unknown as DataSource}>
        <PredicateScopeProvider scope={{ data: DATA }}>
          <SchemaRenderer
            schema={{ type: 'action:button', label: 'Send', actionType: 'probe_10288', ...node } as never}
          />
        </PredicateScopeProvider>
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Click the one button and return the `ActionDef` the handler received. */
async function defReceived(): Promise<ActionDef> {
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
  return probe.mock.calls[0][0] as ActionDef;
}

describe('objectui#10288: a data object carrying `source` reaches the runner whole', () => {
  it('CONTROL: node-level `bodyExtra` arrives intact (no loop visits it)', async () => {
    mount({ bodyExtra: BODY });
    expect((await defReceived()).bodyExtra).toEqual(BODY);
  });

  it('CASE: `properties.bodyExtra` arrives intact, not collapsed to its `source` string', async () => {
    mount({ properties: { bodyExtra: BODY } });
    const def = await defReceived();
    expect(def.bodyExtra).toEqual(BODY);
    // The collapsed spelling, named so a red run reads as the defect itself.
    expect(def.bodyExtra).not.toBe('web');
  });
});

describe('objectui#9100 / #9107 CONTROL: a CEL envelope on a predicate key still gates this button', () => {
  it('properties.visible: the holding row renders, the failing row does not', () => {
    mount({ properties: { visible: HOLDS } });
    const holds = screen.queryByRole('button', { name: 'Send' }) !== null;
    cleanup();
    mount({ properties: { visible: FAILS } });
    const fails = screen.queryByRole('button', { name: 'Send' }) !== null;
    expect({ holds, fails }).toEqual({ holds: true, fails: false });
  });

  it('properties.disabled: the holding row is disabled, the failing row is usable', () => {
    mount({ properties: { disabled: HOLDS } });
    const holds = (screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled;
    cleanup();
    mount({ properties: { disabled: FAILS } });
    const fails = (screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled;
    expect({ holds, fails }).toEqual({ holds: true, fails: false });
  });
});
