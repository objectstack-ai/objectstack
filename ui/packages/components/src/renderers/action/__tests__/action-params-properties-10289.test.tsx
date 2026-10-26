/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10289 (ruling A, maintainer 「批 #224 同意」 2026-09-25): an action's
 * `params` is ONLY the `ActionParam[]` input list, and a node's static
 * execution values ride `properties.params`.
 *
 * Pinned on both action renderers that read a node's `params`
 * (`action:button`, `action:icon`), on both mount paths:
 *
 *   - direct registry mount (the `action:bar` member path: no `SchemaRenderer`,
 *     so no `properties` hoist), and
 *   - through `SchemaRenderer`, which hoists `properties.params` onto the node
 *     as `schema.params` (the renderer must not mistake that copy for a
 *     node-level object).
 *
 * The value asserted is the `ActionDef` the registered handler receives: that
 * `params` is what `navigate_create` / `navigate_edit` read in app-shell.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Module-scope side-effect imports: the renderers register themselves on
// import, and the light `dom` project does not load the components graph.
// Module scope, not a `beforeAll`, per AGENTS.md 测试纪律.
import '../action-button';
import '../action-icon';
import { resetStaticParamsWarnings } from '../static-params';

let handler: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  handler = vi.fn(async () => ({ success: true }));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  resetStaticParamsWarnings();
});

afterEach(() => {
  warn.mockRestore();
});

const INPUTS = [{ name: 'reason', type: 'text', label: 'Reason' }];

/** The warnings this module emits, as strings. */
const nodeLevelWarnings = () =>
  warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes('node-level `params`'));

function Direct({ type, schema }: { type: string; schema: Record<string, unknown> }) {
  const C = ComponentRegistry.get(type);
  if (!C) throw new Error(`${type} is not registered`);
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered renderer (stable reference), not a component created during render
  return <C schema={{ ...schema, type }} />;
}

type Mount = 'direct' | 'SchemaRenderer';

/** Mount one action node, click it, return the def the handler received. */
async function dispatched(mount: Mount, type: string, schema: Record<string, unknown>): Promise<ActionDef> {
  const node = { name: 'probe', label: 'Probe', actionType: 'probe', icon: 'pencil', ...schema };
  const { container } = render(
    <ActionProvider handlers={{ probe: handler }}>
      {mount === 'direct' ? (
        <Direct type={type} schema={node} />
      ) : (
        <SchemaRenderer schema={{ ...node, type } as any} />
      )}
    </ActionProvider>,
  );
  const button = container.querySelector('button');
  expect(button, `${type} rendered no button`).not.toBeNull();
  fireEvent.click(button!);
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  return handler.mock.calls[0][0];
}

describe.each([
  ['action:button', 'direct'],
  ['action:button', 'SchemaRenderer'],
  ['action:icon', 'direct'],
  ['action:icon', 'SchemaRenderer'],
] as const)('%s (%s mount): `params` is inputs, `properties.params` is values', (type, mount) => {
  it('reads static values from `properties.params`', async () => {
    const def = await dispatched(mount, type, {
      properties: { params: { objectName: 'account', recordId: 'rec_7' } },
    });
    expect(def.params).toEqual({ objectName: 'account', recordId: 'rec_7' });
    expect(def.actionParams).toBeUndefined();
    expect(nodeLevelWarnings()).toEqual([]);
  });

  it('does NOT read a node-level `params` object as values, and says so once', async () => {
    const def = await dispatched(mount, type, {
      params: { objectName: 'account', recordId: 'rec_7' },
    });
    expect(def.params).toBeUndefined();
    expect(def.actionParams).toBeUndefined();
    const warnings = nodeLevelWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`[${type}]`);
    expect(warnings[0]).toContain('properties.params');
  });

  it('`properties.params` wins over a node-level object, which is still not read', async () => {
    // Direct mount: the node-level object stays beside the bag and is ignored.
    // SchemaRenderer mount: the hoist replaces `schema.params` with the bag.
    // Either way only the `properties.params` values arrive.
    const def = await dispatched(mount, type, {
      params: { recordId: 'node-level' },
      properties: { params: { recordId: 'from-properties' } },
    });
    expect(def.params).toEqual({ recordId: 'from-properties' });
  });

  it('keeps the `ActionParam[]` input list working, as `actionParams`', async () => {
    const def = await dispatched(mount, type, { params: INPUTS });
    expect(def.actionParams).toEqual(INPUTS);
    // The input list never doubles as the values map.
    expect(def.params).toBeUndefined();
    expect(nodeLevelWarnings()).toEqual([]);
  });
});

describe.each(['action:button', 'action:icon'] as const)('%s (direct mount): both channels at once', (type) => {
  it('forwards the input list AND the static values', async () => {
    // Only reachable without the hoist (an `action:bar` member): under
    // `SchemaRenderer`, `properties.params` is copied over the node's `params`.
    const def = await dispatched('direct', type, {
      params: INPUTS,
      properties: { params: { source: 'toolbar' } },
    });
    expect(def.actionParams).toEqual(INPUTS);
    expect(def.params).toEqual({ source: 'toolbar' });
  });
});

describe('the development warning', () => {
  it('fires once per action, not once per click', async () => {
    const { container } = render(
      <ActionProvider handlers={{ probe: handler }}>
        <Direct type="action:button" schema={{ name: 'twice', label: 'Twice', actionType: 'probe', params: { a: 1 } }} />
      </ActionProvider>,
    );
    const button = container.querySelector('button')!;
    fireEvent.click(button);
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    expect(nodeLevelWarnings()).toHaveLength(1);
  });

  it('is silent in a production build, and the object is still not read', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const def = await dispatched('direct', 'action:button', { params: { a: 1 } });
      expect(def.params).toBeUndefined();
      expect(nodeLevelWarnings()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
