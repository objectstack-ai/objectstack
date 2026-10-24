/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10462: the spec ACTION-ENTRY surfaces follow ruling A on
 * objectui#10289 (`params` is only the `ActionParam[]` input list) for every
 * action type except `api`.
 *
 * The four surfaces are `element:button`'s inline `action`, `action:group`
 * items, `action:menu` items and `page:header`'s `dispatchHeaderAction`. They
 * hand the runner a spec action entry, not an SDUI node, so there is no
 * `properties.params` bag to read values from. Per surface:
 *
 *   - a non-`api` action with an OBJECT `params` does not reach the runner
 *     with those values, and a development build says so once;
 *   - an ARRAY `params` still reaches the runner as `actionParams`;
 *   - a `type: 'api'` action with an OBJECT `params` is unchanged. That is the
 *     objectstack#5777 window: the runner still reads it as the request payload
 *     until 18. It is the control leg of every surface below.
 *
 * The value asserted is the `ActionDef` a registered handler receives, which
 * is what the runner dispatched.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult, ParamCollectionHandler } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
// Module-scope side-effect imports: the renderers register themselves on
// import, and the light `dom` project does not load the components graph.
// Module scope, not a `beforeAll`, per AGENTS.md 测试纪律.
import '../action-group';
import '../action-menu';
import '../../basic/elements';
import '../../layout/containers';
import { resetStaticParamsWarnings } from '../static-params';

type Handler = Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

let navigateEdit: Handler;
let api: Handler;
let onParamCollection: Mock<ParamCollectionHandler>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  navigateEdit = vi.fn(async () => ({ success: true }));
  api = vi.fn(async () => ({ success: true }));
  // Cancel collection: the array leg is about what the runner is HANDED.
  onParamCollection = vi.fn(async () => null);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  resetStaticParamsWarnings();
});

afterEach(() => {
  warn.mockRestore();
});

const VALUES = { objectName: 'account', recordId: 'rec_7' };
const INPUTS = [{ name: 'reason', type: 'text', label: 'Reason' }];
const RECORD = { id: 'rec-1', status: 'open' };

/** This change's development warnings, as strings. */
const entryWarnings = () =>
  warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes('objectui#10462'));

function Registered({ type, schema }: { type: string; schema: Record<string, unknown> }) {
  const C = ComponentRegistry.get(type);
  if (!C) throw new Error(`${type} is not registered`);
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered renderer (stable reference), not a component created during render
  return <C schema={{ ...schema, type }} />;
}

type Surface = 'element:button' | 'action:group' | 'action:menu' | 'page:header' | 'page:header (no record)';

/** The node that carries one action entry on each surface. */
function nodeFor(surface: Surface, entry: Record<string, unknown>): { type: string; schema: Record<string, unknown> } {
  switch (surface) {
    case 'element:button':
      return {
        type: 'element:button',
        schema: { properties: { label: String(entry.label), action: entry } },
      };
    case 'action:group':
      return { type: 'action:group', schema: { display: 'inline', actions: [entry] } };
    case 'action:menu':
      // `autoTrigger` runs `handleExecute`, the function a menu-item click
      // calls, without opening the Radix dropdown (see action-forward-parity).
      return { type: 'action:menu', schema: { actions: [{ ...entry, autoTrigger: true }] } };
    default:
      return {
        type: 'page:header',
        schema: { title: 'Plan', actions: [{ ...entry, locations: ['record_header'] }] },
      };
  }
}

/** Mount one action entry on a surface and run it. */
function mount(surface: Surface, entry: Record<string, unknown>) {
  const { type, schema } = nodeFor(surface, entry);
  const node = <Registered type={type} schema={schema} />;
  render(
    <ActionProvider handlers={{ navigate_edit: navigateEdit, api }} onParamCollection={onParamCollection}>
      {surface === 'page:header' ? (
        <RecordContextProvider
          objectName="os_plan"
          recordId={RECORD.id}
          data={RECORD}
          objectSchema={{ name: 'os_plan', label: 'Plan' }}
        >
          {node}
        </RecordContextProvider>
      ) : (
        node
      )}
    </ActionProvider>,
  );
  if (surface !== 'action:menu') {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(String(entry.label)) }));
  }
}

async function dispatchedTo(handler: Handler): Promise<ActionDef> {
  await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
  return handler.mock.calls[0][0];
}

/** `element:button` names its executor `actionType`; the spec entries say `type`. */
const typed = (surface: Surface, type: string) =>
  surface === 'element:button' ? { actionType: type } : { type };

const SURFACES: Surface[] = ['element:button', 'action:group', 'action:menu', 'page:header', 'page:header (no record)'];

describe.each(SURFACES)('%s: an object `params` is values only on `type: "api"` (objectui#10462)', (surface) => {
  const where = surface.startsWith('page:header') ? 'page:header' : surface;

  it('does NOT forward an object `params` as values on a non-api action, and says so once', async () => {
    mount(surface, { name: 'edit_it', label: 'Edit It', ...typed(surface, 'navigate_edit'), params: VALUES });
    const def = await dispatchedTo(navigateEdit);
    const params = def.params as Record<string, unknown> | undefined;
    expect(params?.objectName).toBeUndefined();
    expect(params?.recordId).toBeUndefined();
    expect(def.actionParams).toBeUndefined();
    const warnings = entryWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`[${where}]`);
    expect(warnings[0]).toContain('"edit_it"');
  });

  it('keeps an `ActionParam[]` input list, as `actionParams`', async () => {
    mount(surface, { name: 'ask_it', label: 'Ask It', ...typed(surface, 'navigate_edit'), params: INPUTS });
    await waitFor(() => expect(onParamCollection).toHaveBeenCalledTimes(1));
    expect(onParamCollection.mock.calls[0][0]).toEqual(INPUTS);
    // Outside a record context `page:header` dispatches the entry as authored,
    // and the runner reads the array `params` itself; everywhere else the list
    // is forwarded under `actionParams`, as `action:button` does.
    if (surface !== 'page:header (no record)') {
      expect((onParamCollection.mock.calls[0][1] as ActionDef).actionParams).toEqual(INPUTS);
    }
    expect(entryWarnings()).toEqual([]);
  });

  it('control: a `type: "api"` object `params` still arrives as the payload (objectstack#5777 window)', async () => {
    mount(surface, { name: 'post_it', label: 'Post It', ...typed(surface, 'api'), target: '/api/v1/ping', params: VALUES });
    const def = await dispatchedTo(api);
    expect(def.params).toMatchObject(VALUES);
    expect(entryWarnings()).toEqual([]);
  });
});

describe('page:header keeps its record stash (objectui#10462)', () => {
  it('stashes `_rowRecord` on a non-api action whose object `params` it drops', async () => {
    mount('page:header', { name: 'edit_stash', label: 'Edit Stash', type: 'navigate_edit', params: VALUES });
    const def = await dispatchedTo(navigateEdit);
    expect(def.params).toEqual({ _rowRecord: RECORD });
  });

  it('control: merges the stash into an api action`s object `params`, as before', async () => {
    mount('page:header', { name: 'post_stash', label: 'Post Stash', type: 'api', target: '/api/v1/ping', params: VALUES });
    const def = await dispatchedTo(api);
    expect(def.params).toEqual({ ...VALUES, _rowRecord: RECORD });
  });
});

describe('the warning is development-only and once per action (objectui#10462)', () => {
  it('warns once across repeated clicks', async () => {
    mount('action:group', { name: 'edit_twice', label: 'Edit Twice', type: 'navigate_edit', params: VALUES });
    await dispatchedTo(navigateEdit);
    fireEvent.click(screen.getByRole('button', { name: /Edit Twice/ }));
    await waitFor(() => expect(navigateEdit).toHaveBeenCalledTimes(2));
    expect(entryWarnings()).toHaveLength(1);
  });

  it('is silent in production and still drops the values', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      mount('element:button', { name: 'edit_prod', label: 'Edit Prod', actionType: 'navigate_edit', params: VALUES });
      const def = await dispatchedTo(navigateEdit);
      expect(def.params).toBeUndefined();
      expect(entryWarnings()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
