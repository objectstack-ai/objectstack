/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11168 — `action:button.undoable` is delivered where a record is in
 * scope, and published (ruling B on objectui#11754, record 6030342264).
 *
 * The runner's `operation: 'update'` path offers Undo only when the invoking
 * surface hands it the record the update writes, under `params._rowRecord`
 * (`ActionRunner.executeUpdateOperation`, which reads the prior value of every
 * written field off it through `captureUpdateUndoData`). Before this change the
 * block forwarded `undoable` and handed the runner no record, so a declared
 * `undoable` offered no Undo anywhere the block ran. The block now attaches the
 * record in scope: the row its host binds through `data`, else the record
 * page's `RecordContext` record.
 *
 * Driven end to end through the real pieces: the real `SchemaRenderer` renders
 * the real `action:button` (and, once, the real `action:bar`), the click goes
 * through the real `ActionRunner`, and the `script` dispatch is the real
 * `createServerActionHandler` the console builds its route dispatch on, over a
 * stubbed `fetch`. What is asserted is what a user gets: whether the success
 * toast offers Undo, and what the global undo stack would write back.
 *
 * Every "no Undo" row has a lit companion: the same node with the condition
 * reversed offers Undo, so a red cannot come from a harness that never offers
 * one.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry, createServerActionHandler, globalUndoManager } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import type { PublicBlockNodeOf } from '@object-ui/types';
import { undeclaredNode } from '@object-ui/test-support';
import { ActionProvider, RecordContextProvider, SchemaRenderer } from '@object-ui/react';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { SchemaElement } from '@object-ui/sdui-parser';
// Module-scope side-effect imports, so the renderers are registered before the
// first render: the light `dom` project does not load the components graph.
// Module scope, not a `beforeAll`, per AGENTS.md 测试纪律.
import '../action-button';
import '../action-bar';

/** The record the action runs on, as the page or the row carries it. */
const RECORD = { id: 't1', status: 'open', title: 'Write the report' };

/**
 * The object's declared actions, which the host publishes beside its object
 * (`objectActions`, objectui#13022). The route writes the `patch` of the one a
 * node's `name` names, so that is what the Undo snapshot covers; a node
 * carries no `patch` of its own (`@objectstack/spec` 18 retires the row key).
 */
const DECLARATIONS = [
  { name: 'close_task', label: 'Close', operation: 'update', patch: { status: 'done' }, undoable: true },
  // A declaration with no `patch`: it writes the collected params alone.
  { name: 'set_status', label: 'Set status', operation: 'update', undoable: true },
];

type Props = NonNullable<PublicBlockNodeOf<'action:button'>['properties']>;

/** One `action:button` node, its props in the `properties` bag as the spec places them. */
const button = (extra: Partial<Props> = {}): PublicBlockNodeOf<'action:button'> => ({
  type: 'action:button',
  properties: {
    name: 'close_task',
    label: 'Close',
    operation: 'update',
    undoable: true,
    ...extra,
  },
});

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
 * The host's runner, publishing its object the way every console host does
 * (`context.objectName`), and that object's declarations beside it
 * (`context.objectActions`).
 */
function Runner({ children }: { children: React.ReactNode }) {
  return (
    <ActionProvider
      handlers={{ script }}
      context={{ objectName: 'task', objectActions: DECLARATIONS } as never}
      onToast={toast as never}
      onParamCollection={(async () => ({ status: 'blocked' })) as never}
    >
      {children}
    </ActionProvider>
  );
}

/** A node `SchemaRenderer` takes. */
type SchemaNodeInput = React.ComponentProps<typeof SchemaRenderer>['schema'];

/** On a record page: the record comes from `RecordContext`, and the node gets no `data`. */
const onRecordPage = (node: SchemaNodeInput, record: Record<string, unknown> = RECORD) =>
  render(
    <Runner>
      <RecordContextProvider objectName="task" recordId={String(record.id)} data={record}>
        <SchemaRenderer schema={node} />
      </RecordContextProvider>
    </Runner>,
  );

/** On a row: the host binds the row through `data`, as a table cell or `DetailView`'s header does. */
const onRow = (node: SchemaNodeInput, row: Record<string, unknown> = RECORD) =>
  render(
    <Runner>
      <SchemaRenderer schema={node} data={row} />
    </Runner>,
  );

/** With no record anywhere. */
const standalone = (node: SchemaNodeInput) =>
  render(
    <Runner>
      <SchemaRenderer schema={node} />
    </Runner>,
  );

/** Click `label` and wait for the runner to report back through the toast. */
async function press(label = 'Close') {
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(toast).toHaveBeenCalled());
}

/** The success toast's options; `undo` is set exactly when the toast offers Undo. */
const successToast = () => toast.mock.calls.find(([, options]) => options?.type === 'success')?.[1];

/** The last def the dispatch was handed carried the record stash. */
const carriedStash = () =>
  Object.prototype.hasOwnProperty.call((dispatched.at(-1)?.params ?? {}) as object, '_rowRecord');

/** The request the route was sent. */
const sentBody = () => JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body));

describe('action:button `undoable` — an update of the record in scope offers Undo with its prior values', () => {
  it('on a record page, from the page record', async () => {
    onRecordPage(button());
    await press();
    expect(successToast()?.undo).toBeDefined();
    expect(globalUndoManager.peekUndo()).toMatchObject({
      type: 'update',
      objectName: 'task',
      recordId: 't1',
      undoData: { status: 'open' },
      redoData: { status: 'done' },
    });
    // The write addressed that record, and the stash stayed on the client. The
    // `patch` is the route's, applied from the declaration `close_task` names,
    // so the request carries no field value at all (objectui#12941) while Undo
    // covers `status`, the field the route wrote (objectui#13022).
    expect(sentBody()).toEqual({ recordId: 't1', params: {} });
  });

  it('on a row the host binds, from the row', async () => {
    onRow(button(), { id: 'r9', status: 'waiting' });
    await press();
    expect(successToast()?.undo).toBeDefined();
    expect(globalUndoManager.peekUndo()).toMatchObject({ recordId: 'r9', undoData: { status: 'waiting' } });
  });

  it('the row the host binds outranks the page record around it', async () => {
    render(
      <Runner>
        <RecordContextProvider objectName="task" recordId="p1" data={{ id: 'p1', status: 'page' }}>
          <SchemaRenderer schema={button()} data={{ id: 'r1', status: 'row' }} />
        </RecordContextProvider>
      </Runner>,
    );
    await press();
    expect(globalUndoManager.peekUndo()).toMatchObject({ recordId: 'r1', undoData: { status: 'row' } });
  });

  it('an `action:bar` member on a record page, which the bar draws through this block', async () => {
    onRecordPage(
      undeclaredNode({
        type: 'action:bar',
        actions: [
          { name: 'close_task', label: 'Close', operation: 'update', patch: { status: 'done' }, undoable: true },
        ],
      }),
    );
    await press();
    expect(globalUndoManager.peekUndo()).toMatchObject({ recordId: 't1', undoData: { status: 'open' } });
  });

  it('a value the user supplies is restored too, from the same record', async () => {
    // The input list collects `status`; the collected value is written, so its
    // prior value is what Undo restores. `set_status` declares no `patch`, so
    // the collected value is the whole write.
    onRecordPage(button({ name: 'set_status', params: [{ name: 'status', type: 'text', label: 'Status' }] }));
    await press();
    expect(globalUndoManager.peekUndo()).toMatchObject({
      undoData: { status: 'open' },
      redoData: { status: 'blocked' },
    });
  });
});

describe('action:button `undoable` — the one limit: no record in scope, no Undo', () => {
  it('a standalone button runs the update and offers no Undo, with no error', async () => {
    standalone(button());
    await press();
    expect(successToast()).toBeDefined();
    expect(successToast()?.undo).toBeUndefined();
    expect(toast.mock.calls.some(([, options]) => options?.type === 'error')).toBe(false);
    expect(globalUndoManager.undoCount).toBe(0);
  });

  it('a button that writes ANOTHER record gets no Undo from the record in scope', async () => {
    onRecordPage(button({ params: { recordId: 'elsewhere' } }));
    await press();
    expect(sentBody().recordId).toBe('elsewhere');
    expect(successToast()?.undo).toBeUndefined();
    expect(carriedStash()).toBe(false);
    cleanup();
    toast.mockClear();
    // Lit: the same write addressed to the record in scope, as authors write it.
    onRecordPage(button({ params: { recordId: '${record.id}' } }));
    await press();
    expect(sentBody().recordId).toBe('t1');
    expect(successToast()?.undo).toBeDefined();
  });

  it('a record that does not carry a written field offers no Undo (the runner\'s rule, unchanged)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      onRecordPage(button(), { id: 't1', title: 'no status here' });
      await press();
      expect(successToast()?.undo).toBeUndefined();
      expect(carriedStash()).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('action:button `undoable` — only an `undoable` update is handed the record', () => {
  it('an update that is not `undoable` offers no Undo and carries no record', async () => {
    onRecordPage(button({ undoable: false }));
    await press();
    expect(successToast()?.undo).toBeUndefined();
    expect(carriedStash()).toBe(false);
    cleanup();
    toast.mockClear();
    // Lit: the same node, `undoable`.
    onRecordPage(button());
    await press();
    expect(carriedStash()).toBe(true);
  });

  it('an `undoable` action that is not an update carries no record', async () => {
    onRecordPage(button({ operation: undefined, actionType: 'script' }));
    await press();
    expect(dispatched).toHaveLength(1);
    expect(carriedStash()).toBe(false);
  });
});

describe('action:button `undoable` — published', () => {
  it('is a published boolean input that the installed spec row declares', () => {
    const input = (ComponentRegistry.getConfig('action:button')?.inputs ?? []).find((i) => i.name === 'undoable');
    expect(input?.type).toBe('boolean');
    const row = (ComponentPropsMap as unknown as Record<string, { shape?: Record<string, unknown> }>)['action:button'];
    expect(Object.keys(row?.shape ?? {})).toContain('undoable');
  });

  it('the page validator no longer reports `undoable` as an unknown prop', () => {
    const diagnostics = validateTree(
      { type: 'action:button', undoable: true } as unknown as SchemaElement,
      manifestFromConfigs(
        ComponentRegistry.getAllConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
      ),
    ).diagnostics;
    expect(diagnostics.filter((d) => d.code === 'unknown-prop').map((d) => d.message)).toEqual([]);
    // Lit: a key the block does not publish is still reported.
    const control = validateTree(
      { type: 'action:button', notAKey: true } as unknown as SchemaElement,
      manifestFromConfigs(
        ComponentRegistry.getAllConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
      ),
    ).diagnostics;
    expect(control.some((d) => d.code === 'unknown-prop')).toBe(true);
  });
});
