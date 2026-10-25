/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13022 — a page action row's own `patch` is not what an update
 * writes, so no action renderer forwards it, and the Undo snapshot covers the
 * `patch` of the DECLARATION the row's `name` names.
 *
 * A row's `operation: 'update'` runs the declared action its `name` names: the
 * platform action route resolves that declaration by name and writes ITS
 * `patch` under the params it is sent. The row's own `patch` reached no
 * request (objectui#12941), and `@objectstack/spec` 18 retires it on
 * `action:button`, `action:icon` and the `action:group` / `action:menu`
 * member. It was read for one thing only, the Undo snapshot, which therefore
 * covered the wrong fields: a row with no `patch` of its own (every row, once
 * the key is retired) snapshotted the collected params and not the fields the
 * route wrote.
 *
 * Driven end to end through the real pieces: the real `SchemaRenderer`
 * renders the real block, the click goes through the real `ActionRunner`, and
 * the `script` dispatch is the real `createServerActionHandler` the console
 * builds its route dispatch on, over a stubbed `fetch`. The host publishes the
 * object's declarations beside the object (`objectActions`), as the console's
 * two hosts do.
 *
 * The nodes that carry a `patch` are written through `undeclaredNode`: the
 * key is the subject here, and the typed node face refuses it once the spec
 * retires it.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { createServerActionHandler, globalUndoManager } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import { undeclaredNode } from '@object-ui/test-support';
import { ActionProvider, RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Module-scope side-effect imports, so the renderers are registered before the
// first render: the light `dom` project does not load the components graph.
// Module scope, not a `beforeAll`, per AGENTS.md 测试纪律.
import '../action-button';
import '../action-icon';
import '../action-group';
import '../action-menu';

/** The record the action runs on, as the record page carries it. */
const RECORD = { id: 't1', status: 'open', priority: 'low', note: 'was' };

/** The object's declared actions, as the host publishes them. */
const DECLARATIONS = [
  { name: 'close_task', label: 'Close', operation: 'update', patch: { status: 'done' }, undoable: true },
  {
    name: 'close_with_note',
    label: 'Close with note',
    operation: 'update',
    patch: { status: 'done' },
    params: [{ name: 'note', type: 'text', label: 'Note' }],
    undoable: true,
  },
];

let toast: Mock<(message: string, options?: { type?: string; undo?: { label?: string } }) => void>;
let fetchSpy: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
/** Every def the `script` dispatch was handed, before it POSTs. */
let dispatched: ActionDef[];
let script: (action: ActionDef, ctx?: ActionContext) => Promise<ActionResult>;

beforeEach(() => {
  toast = vi.fn();
  fetchSpy = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  dispatched = [];
  const route = createServerActionHandler({ fetch: fetchSpy as never, resolveObject: () => 'task' });
  script = async (action, ctx) => {
    dispatched.push(action);
    return route(action, ctx);
  };
  globalUndoManager.clear();
});

afterEach(() => {
  cleanup();
  globalUndoManager.clear();
});

/**
 * Mount `node` on a record page, inside a host runner. `declarations` is what
 * the host publishes as `objectActions`; `null` publishes none.
 */
function onRecordPage(
  node: Record<string, unknown>,
  declarations: readonly unknown[] | null = DECLARATIONS,
) {
  return render(
    <ActionProvider
      handlers={{ script }}
      context={{ objectName: 'task', ...(declarations ? { objectActions: declarations } : {}) } as never}
      onToast={toast as never}
      onParamCollection={(async () => ({ note: 'typed by the user' })) as never}
    >
      <RecordContextProvider objectName="task" recordId={String(RECORD.id)} data={RECORD}>
        <SchemaRenderer schema={undeclaredNode(node)} />
      </RecordContextProvider>
    </ActionProvider>,
  );
}

/** Wait for the runner to report back through the toast. */
const settled = () => waitFor(() => expect(toast).toHaveBeenCalled());

/** The success toast's options; `undo` is set exactly when the toast offers Undo. */
const successToast = () => toast.mock.calls.find(([, options]) => options?.type === 'success')?.[1];

/** The request the route was sent. */
const sentBody = () => JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body));

/** A row that names `close_task` and carries a `patch` of its own. */
const ROW = {
  name: 'close_task',
  label: 'Close',
  operation: 'update',
  patch: { priority: 'high' },
  undoable: true,
};

/** Radix opens a dropdown on `pointerdown` and mounts its content in a portal. */
async function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}

/** Each surface, mounted with {@link ROW} and clicked the way a user clicks it. */
const SURFACES: Array<[string, () => Promise<void>]> = [
  [
    'action:button',
    async () => {
      onRecordPage({ type: 'action:button', properties: ROW });
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    },
  ],
  [
    'action:icon',
    async () => {
      onRecordPage({ type: 'action:icon', properties: { ...ROW, icon: 'check' } });
      fireEvent.click(screen.getByRole('button'));
    },
  ],
  [
    'action:group',
    async () => {
      onRecordPage({ type: 'action:group', actions: [ROW] });
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    },
  ],
  [
    'action:menu',
    async () => {
      onRecordPage({ type: 'action:menu', actions: [ROW] });
      const menu = await openMenu(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Close' }));
    },
  ],
];

describe('no action renderer forwards a `patch` (objectui#13022)', () => {
  it.each(SURFACES)('%s hands the runner `operation` and no `patch`', async (_surface, click) => {
    await click();
    await waitFor(() => expect(dispatched).toHaveLength(1));
    const def = dispatched[0] as unknown as Record<string, unknown>;
    // The renderer composed the def: it forwarded the row's `name` and
    // `operation`, so the update path ran. It forwarded no `patch`.
    expect(def).toMatchObject({ name: 'close_task', operation: 'update' });
    expect(Object.prototype.hasOwnProperty.call(def, 'patch')).toBe(false);
  });

  it('the request a row sends carries no field value, with or without a `patch` on the row', async () => {
    // The request has carried the collected params alone since objectui#12941,
    // so not forwarding the row's `patch` moves no request byte.
    onRecordPage({ type: 'action:button', properties: ROW });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settled();
    expect(sentBody()).toEqual({ recordId: 't1', params: {} });
    cleanup();
    toast.mockClear();
    const { patch: _rowPatch, ...withoutPatch } = ROW;
    onRecordPage({ type: 'action:button', properties: withoutPatch });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settled();
    expect(sentBody()).toEqual({ recordId: 't1', params: {} });
  });
});

describe('Undo on a row covers the `patch` of the declaration its `name` names (objectui#13022)', () => {
  it('a row with no `patch` of its own: Undo restores the field the declaration writes', async () => {
    const { patch: _rowPatch, ...row } = ROW;
    onRecordPage({ type: 'action:button', properties: row });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settled();
    expect(successToast()?.undo).toBeDefined();
    expect(globalUndoManager.peekUndo()).toMatchObject({
      type: 'update',
      objectName: 'task',
      recordId: 't1',
      undoData: { status: 'open' },
      redoData: { status: 'done' },
    });
  });

  it('the `patch` of the declaration plus the collected params, which win over it', async () => {
    onRecordPage({
      type: 'action:button',
      properties: {
        name: 'close_with_note',
        label: 'Close with note',
        operation: 'update',
        undoable: true,
        params: [{ name: 'note', type: 'text', label: 'Note' }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close with note' }));
    await settled();
    expect(globalUndoManager.peekUndo()).toMatchObject({
      undoData: { status: 'open', note: 'was' },
      redoData: { status: 'done', note: 'typed by the user' },
    });
    // The request carries the collected value alone; `status` is the route's.
    expect(sentBody()).toEqual({ recordId: 't1', params: { note: 'typed by the user' } });
  });

  it('the `patch` a row carries itself is never covered, the one its declaration carries is', async () => {
    // The row says `priority`; the declaration it names writes `status`. The
    // route writes `status`, so Undo restores `status` and leaves `priority`.
    onRecordPage({ type: 'action:button', properties: ROW });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settled();
    const undo = globalUndoManager.peekUndo();
    expect(undo?.undoData).toEqual({ status: 'open' });
    expect(undo?.redoData).toEqual({ status: 'done' });
  });

  it('control: a host that publishes no declarations gives a patch-only row no Undo', async () => {
    // Nothing names what the route wrote, so there is nothing to snapshot; the
    // lit rows above are lit by the published declaration, not by the harness.
    const { patch: _rowPatch, ...row } = ROW;
    onRecordPage({ type: 'action:button', properties: row }, null);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settled();
    expect(successToast()).toBeDefined();
    expect(successToast()?.undo).toBeUndefined();
    expect(globalUndoManager.undoCount).toBe(0);
  });
});
