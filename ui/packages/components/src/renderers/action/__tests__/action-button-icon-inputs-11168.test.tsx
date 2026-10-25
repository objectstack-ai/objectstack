/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11168 slice 1 — the spec keys `action:button` and `action:icon`
 * PUBLISH, each honoured through the block path.
 *
 * `@objectstack/spec` 17.5.0 gave both blocks a `ComponentPropsMap` row, and
 * the repo-wide parity guard (`apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`)
 * booked every spec key the registrations did not publish to this card
 * (objectui#11111 decision 3 = B). The ruling's terms: each key is declared by
 * its own measurement, and a key counts as honoured only when the NODE's value
 * reaches whatever acts on it. Most of these keys are action-definition keys:
 * the renderer does not read them for its markup, it forwards them to the
 * `ActionRunner`, and the runner (or the handler it dispatches to) acts. So
 * every row below drives the whole path — the node through the REAL
 * `SchemaRenderer` and registry, the renderer's forward, the REAL runner — and
 * asserts on the effect the key's description promises, with a control row in
 * which the key is absent (or holds the other value) and the effect is too.
 *
 * Where the runner hands a key to a HOST handler rather than acting on it
 * itself, the handler used is the real one the console builds on where it lives
 * in `@object-ui/core` (`createServerActionHandler`, for `objectName`,
 * `locations` and `recordIdField`), and a recording double otherwise; the
 * console's own reads of `method`, `bodyExtra`, `bodyShape`, `description`
 * and `objectName` are the ones `scripts/check-action-forward-parity.mjs`
 * extracts from its runtime.
 *
 * Held back by slice 1, each with its measurement on the card: `endpoint` on
 * both blocks (the runner's built-in `api` executor reads it, the console's own
 * `api` handler reads `target` and never `endpoint`; 17.6.0 then refused the
 * key in favour of `target`) and `undoable` on `action:button` (the runner's
 * update path offered Undo only with a host row stash this block did not
 * write). Ruling B on objectui#11754 made the block hand the runner the record
 * in scope, and `undoable` is published on `action:button` since: its
 * behaviour is pinned in `action-button-undoable-11168.test.tsx`, and its row
 * in `DECLARED` below.
 *
 * Slice 2 added the `size` rows at the end: `action:button` publishes the five
 * sizes its spec row declares. The renderer hands `default`, `sm`, `lg` and
 * `icon` to the Button primitive as-is and maps `md` to `default`; `default`
 * and `icon` were unpublished before, so the page validator refused them.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React, { useEffect } from 'react';
import { ComponentRegistry, createServerActionHandler } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
// These nodes are written the way the runtime reads them, flat on the node,
// which the closed `action:*` node types refuse: measured on objectui#11466,
// typing the fixtures as `DeclaredNode` refuses them line by line. So each
// crosses through the one test helper for undeclared input.
import { undeclaredNode } from '@object-ui/test-support';
import {
  ActionProvider,
  PredicateScopeProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  useAction,
} from '@object-ui/react';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { SchemaElement } from '@object-ui/sdui-parser';
import { buttonVariants } from '../../../ui/button';
// Module-scope side-effect imports: the registry must hold both renderers when
// `SchemaRenderer` resolves the type, and the light `dom` project does not load
// the components graph. Module scope, not a `beforeAll`, per AGENTS.md 测试纪律.
import '../action-button';
import '../action-icon';

const BLOCKS = ['action:button', 'action:icon'] as const;
type Block = (typeof BLOCKS)[number];

/**
 * The spec keys slice 1 published on both blocks. `patch` left the list when the
 * spec retired a row's own `patch` (objectstack#24394) and the registry stopped
 * publishing it (objectui#12971).
 */
const LEAF_KEYS = [
  'visible', 'disabled', 'params', 'description', 'openIn', 'method', 'bodyExtra', 'bodyShape',
  'operation', 'confirmText', 'successMessage', 'errorMessage', 'refreshAfter',
  'locations', 'toast', 'resultDialog', 'onSuccess', 'objectName',
];

/** The keys each block now publishes, beyond the ones it published before. */
const DECLARED: Record<Block, string[]> = {
  'action:button': [...LEAF_KEYS, 'recordIdField', 'undoable'],
  'action:icon': LEAF_KEYS,
};

/** The row every predicate below is evaluated against. */
const DATA = { status: 'draft' };
const HOLDS = { dialect: 'cel', source: 'has(data.status) && data.status == "draft"' };
const FAILS = { dialect: 'cel', source: 'has(data.status) && data.status == "published"' };

type Handler = Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;

let run: Handler;
let toast: Mock<(message: string, options?: { type?: string; duration?: number }) => void>;
let nav: Mock<(url: string, options?: { external?: boolean; newTab?: boolean }) => void>;
let confirm: Mock<(message: string) => Promise<boolean>>;
let collect: Mock<(defs: unknown[], action?: ActionDef) => Promise<Record<string, unknown> | null>>;
let dialog: Mock<(spec: unknown, data: unknown, action?: ActionDef) => Promise<void>>;
let fetchSpy: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
/** The provider's last result, read the way a host reads it (`useAction()`). */
let lastResult: ActionResult | null;

beforeEach(() => {
  run = vi.fn(async () => ({ success: true, data: { id: '42' } }));
  toast = vi.fn();
  nav = vi.fn();
  confirm = vi.fn(async () => true);
  collect = vi.fn(async () => ({ title: 'Collected' }));
  dialog = vi.fn(async () => {});
  fetchSpy = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  lastResult = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** Reports the provider's `result` each time it changes — the host's view of an execution. */
function ResultProbe({ onResult }: { onResult: (result: ActionResult | null) => void }) {
  const { result } = useAction();
  useEffect(() => onResult(result), [result, onResult]);
  return null;
}

const recordResult = (result: ActionResult | null) => {
  lastResult = result;
};

/** Read through a call, so the compiler does not narrow the reset below to `null`. */
const currentResult = (): ActionResult | null => lastResult;

interface MountOptions {
  handlers?: Record<string, (action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
  context?: Record<string, unknown>;
}

/** Mount one node the way a page does: the real `SchemaRenderer` inside the real runner. */
function mount(schema: Record<string, unknown>, options: MountOptions = {}) {
  return render(
    <ActionProvider
      handlers={options.handlers ?? { run }}
      context={options.context as never}
      onToast={toast}
      onNavigate={nav}
      onConfirm={confirm}
      onParamCollection={collect as never}
      onResultDialog={dialog as never}
    >
      <SchemaRendererProvider dataSource={DATA as unknown as DataSource}>
        <PredicateScopeProvider scope={{ data: DATA }}>
          <SchemaRenderer schema={undeclaredNode(schema)} />
          <ResultProbe onResult={recordResult} />
        </PredicateScopeProvider>
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** One node of `type`, running the recording `run` handler unless told otherwise. */
const node = (type: Block, extra: Record<string, unknown> = {}) => ({
  type,
  name: 'probe_action',
  label: 'Probe',
  icon: 'check',
  actionType: 'run',
  ...extra,
});

const press = () => fireEvent.click(screen.getByRole('button'));

/** The request body the runner's built-in `api` executor sent. */
const sentBody = () => JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));

/** The server-action handler the console's `script` dispatch is built on (`@object-ui/core`). */
const serverAction = () =>
  createServerActionHandler({ fetch: fetchSpy as never, resolveObject: () => 'page_object' });

describe.each(BLOCKS)('%s — publishes the spec keys objectui#11168 slice 1 measured honoured', (type) => {
  it('every declared key is a published input AND a key the installed spec row accepts', () => {
    const published = new Set((ComponentRegistry.getConfig(type)?.inputs ?? []).map((input) => input.name));
    const specKeys = Object.keys(
      (ComponentPropsMap as unknown as Record<string, { shape?: Record<string, unknown> }>)[type]?.shape ?? {},
    );
    for (const key of DECLARED[type]) {
      expect(published.has(key), `${type} does not publish ${key}`).toBe(true);
      // `shape` resolving at all is the non-vacuity half of this assertion.
      expect(specKeys.length).toBeGreaterThan(0);
      expect(specKeys, `${type} spec row does not declare ${key}`).toContain(key);
    }
  });
});

describe.each(BLOCKS)('%s — keys the renderer consumes itself', (type) => {
  it.each([
    ['a boolean', true, false],
    ['a bare CEL expression', 'data.status == "draft"', 'data.status == "published"'],
    ['the `{ dialect, source }` envelope', HOLDS, FAILS],
  ])('`visible` as %s: the control renders when it holds and is absent when it fails', (_arm, holds, fails) => {
    mount(node(type, { visible: holds }));
    expect(screen.getByRole('button')).toBeInTheDocument();
    cleanup();
    mount(node(type, { visible: fails }));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['a boolean', true, false],
    ['a bare CEL expression', 'data.status == "draft"', 'data.status == "published"'],
    ['the `{ dialect, source }` envelope', HOLDS, FAILS],
  ])('`disabled` as %s: the control is on screen either way, and pressable only when it fails', (_arm, holds, fails) => {
    mount(node(type, { disabled: holds }));
    expect(screen.getByRole('button')).toBeDisabled();
    cleanup();
    mount(node(type, { disabled: fails }));
    expect(screen.getByRole('button')).toBeEnabled();
  });
});

describe.each(BLOCKS)('%s — keys the runner acts on, forwarded by the block', (type) => {
  it('`params`: the members are the collection definition, and each value reaches the executor under its `name`', async () => {
    const params = [
      { name: 'title', type: 'text', label: 'Title', required: true },
      { name: 'note', type: 'textarea', label: 'Note' },
    ];
    mount(node(type, { params }));
    press();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    // The whole member list, in order and unchanged, is what the dialog is handed.
    expect(collect).toHaveBeenCalledTimes(1);
    expect(collect.mock.calls[0][0]).toEqual(params);
    // The value collected for member `title` reaches the executor as `title`.
    expect((run.mock.calls[0][0].params as Record<string, unknown>).title).toBe('Collected');
    cleanup();
    // Control: no `params` — nothing to collect, the action runs straight away.
    collect.mockClear();
    run.mockClear();
    mount(node(type));
    press();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(collect).not.toHaveBeenCalled();
  });

  it('`description` is what the parameter dialog is handed under the action', async () => {
    const params = [{ name: 'title', type: 'text', label: 'Title' }];
    mount(node(type, { params, description: 'Explains the action' }));
    press();
    await waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
    expect(collect.mock.calls[0][1]?.description).toBe('Explains the action');
    cleanup();
    collect.mockClear();
    mount(node(type, { params }));
    press();
    await waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
    expect(collect.mock.calls[0][1]?.description).toBeUndefined();
  });

  it('`openIn` decides the tab of a `url` action', async () => {
    mount(node(type, { actionType: 'url', target: '/app/report', openIn: 'new-tab' }));
    press();
    await waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
    expect(nav.mock.calls[0]).toEqual(['/app/report', expect.objectContaining({ newTab: true })]);
    cleanup();
    nav.mockClear();
    // Control: a relative url with no `openIn` navigates in place.
    mount(node(type, { actionType: 'url', target: '/app/report' }));
    press();
    await waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
    expect(nav.mock.calls[0]).toEqual(['/app/report', expect.objectContaining({ newTab: false })]);
  });

  it('`method` is the verb of the `api` request', async () => {
    mount(node(type, { actionType: 'api', target: '/api/probe', method: 'PUT' }), { handlers: {} });
    press();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('PUT');
    cleanup();
    fetchSpy.mockClear();
    mount(node(type, { actionType: 'api', target: '/api/probe' }), { handlers: {} });
    press();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST');
  });

  it('`bodyExtra` members are merged into the `api` body LAST, over a static value of the same name', async () => {
    mount(
      node(type, {
        actionType: 'api',
        target: '/api/probe',
        properties: { params: { status: 'from-params', keep: 'kept' } },
        bodyExtra: { status: 'from-bodyExtra', resend: true },
      }),
      { handlers: {} },
    );
    press();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ status: 'from-bodyExtra', keep: 'kept', resend: true });
    cleanup();
    fetchSpy.mockClear();
    mount(
      node(type, { actionType: 'api', target: '/api/probe', properties: { params: { status: 'from-params' } } }),
      { handlers: {} },
    );
    press();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ status: 'from-params' });
  });

  it('`bodyShape`: `{ wrap }` nests the values under that member, `flat` and absence do not', async () => {
    const base = {
      actionType: 'api',
      target: '/api/probe',
      properties: { params: { name: 'Acme' } },
      bodyExtra: { source: 'web' },
    };
    const bodyFor = async (extra: Record<string, unknown>) => {
      fetchSpy.mockClear();
      mount(node(type, { ...base, ...extra }), { handlers: {} });
      press();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      const body = sentBody();
      cleanup();
      return body;
    };
    // `bodyExtra` rides flat BESIDE the wrap — the member names only the nest.
    expect(await bodyFor({ bodyShape: { wrap: 'data' } })).toEqual({ data: { name: 'Acme' }, source: 'web' });
    expect(await bodyFor({ bodyShape: 'flat' })).toEqual({ name: 'Acme', source: 'web' });
    expect(await bodyFor({})).toEqual({ name: 'Acme', source: 'web' });
  });

  it('`operation: update` reaches the write route; a `patch` on the node is not forwarded and never rides in the supplied values', async () => {
    const script = vi.fn(async () => ({ success: true }));
    mount(
      node(type, {
        actionType: undefined,
        operation: 'update',
        patch: { status: 'closed', stage: 'done' },
        properties: { params: { recordId: 'R1', status: 'user-chosen' } },
      }),
      { handlers: { script } },
    );
    press();
    await waitFor(() => expect(script).toHaveBeenCalledTimes(1));
    // The block forwarded `operation`, so the update path ran. The route writes
    // the `patch` of the declaration the node's `name` names, never the node's
    // own, so the block forwards no `patch` at all (objectui#13022), and the
    // values the dispatch posts are the supplied ones alone (objectui#12941).
    const dispatched = (script.mock.calls[0] as unknown as [ActionDef])[0];
    expect(dispatched).toMatchObject({ operation: 'update' });
    expect(Object.prototype.hasOwnProperty.call(dispatched, 'patch')).toBe(false);
    expect(dispatched.params).toEqual({ recordId: 'R1', status: 'user-chosen' });
    cleanup();
    script.mockClear();
    // Control: the same `patch` without `operation` is not a write — nothing merges it.
    mount(
      node(type, { actionType: 'script', patch: { stage: 'done' }, properties: { params: { recordId: 'R1' } } }),
      { handlers: { script } },
    );
    press();
    await waitFor(() => expect(script).toHaveBeenCalledTimes(1));
    expect((script.mock.calls[0] as unknown as [ActionDef])[0].params).toEqual({ recordId: 'R1' });
  });

  it('`confirmText` is asked first, and a refusal stops the action', async () => {
    confirm.mockResolvedValueOnce(false);
    mount(node(type, { confirmText: 'Really archive?' }));
    press();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toBe('Really archive?');
    expect(run).not.toHaveBeenCalled();
    cleanup();
    // Accepted, it runs; with no `confirmText` nothing is asked.
    mount(node(type, { confirmText: 'Really archive?' }));
    press();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    cleanup();
    confirm.mockClear();
    mount(node(type));
    press();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('`successMessage` is the success toast; without it the runner says its own default', async () => {
    mount(node(type, { successMessage: 'Archived.' }));
    press();
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0]).toEqual(['Archived.', expect.objectContaining({ type: 'success' })]);
    cleanup();
    toast.mockClear();
    mount(node(type));
    press();
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][0]).not.toBe('Archived.');
  });

  it('`errorMessage` replaces the raw error in the failure toast', async () => {
    run.mockResolvedValue({ success: false, error: 'raw backend error' });
    mount(node(type, { errorMessage: 'Could not archive.' }));
    press();
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0]).toEqual(['Could not archive.', expect.objectContaining({ type: 'error' })]);
    cleanup();
    toast.mockClear();
    mount(node(type));
    press();
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][0]).toBe('raw backend error');
  });

  it('`toast` members: `showOnSuccess: false` silences success, `showOnError: false` silences failure, `duration` is handed on', async () => {
    mount(node(type, { toast: { showOnSuccess: false } }));
    press();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(toast).not.toHaveBeenCalled();
    cleanup();
    mount(node(type, { toast: { duration: 1234 } }));
    press();
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][1]).toEqual(expect.objectContaining({ type: 'success', duration: 1234 }));
    cleanup();
    toast.mockClear();
    run.mockResolvedValue({ success: false, error: 'boom' });
    mount(node(type, { toast: { showOnError: false } }));
    press();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    expect(toast).not.toHaveBeenCalled();
    cleanup();
    // Control: no `toast` — the failure is toasted.
    mount(node(type));
    press();
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  });

  it('`refreshAfter` marks the result for a reload', async () => {
    mount(node(type, { refreshAfter: true }));
    press();
    await waitFor(() => expect(currentResult()?.success).toBe(true));
    expect(currentResult()?.reload).toBe(true);
    cleanup();
    lastResult = null;
    mount(node(type));
    press();
    await waitFor(() => expect(currentResult()?.success).toBe(true));
    expect(currentResult()?.reload).toBeFalsy();
  });

  it('`resultDialog` hands the response to the reveal dialog, whole, in place of the success toast', async () => {
    const spec = { title: 'Your code', fields: [{ path: 'id', label: 'Id', format: 'secret' }] };
    mount(node(type, { resultDialog: spec }));
    press();
    await waitFor(() => expect(dialog).toHaveBeenCalledTimes(1));
    expect(dialog.mock.calls[0][0]).toEqual(spec);
    expect(dialog.mock.calls[0][1]).toEqual({ id: '42' });
    expect(toast).not.toHaveBeenCalled();
    cleanup();
    mount(node(type));
    press();
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(dialog).toHaveBeenCalledTimes(1);
  });

  it('`onSuccess` members: `navigate` is interpolated from the result, `openIn: newTab` opens a tab', async () => {
    mount(node(type, { onSuccess: { navigate: '/app/records/${result.id}', openIn: 'newTab' } }));
    press();
    await waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
    expect(nav.mock.calls[0]).toEqual(['/app/records/42', expect.objectContaining({ newTab: true })]);
    cleanup();
    nav.mockClear();
    mount(node(type, { onSuccess: { navigate: '/app/records/${result.id}' } }));
    press();
    await waitFor(() => expect(nav).toHaveBeenCalledTimes(1));
    expect(nav.mock.calls[0][0]).toBe('/app/records/42');
    expect(nav.mock.calls[0][1]?.newTab).not.toBe(true);
    cleanup();
    nav.mockClear();
    // Control: no `onSuccess` — the action succeeds and nothing navigates.
    mount(node(type));
    press();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    expect(nav).not.toHaveBeenCalled();
  });

  it('`objectName` retargets the server action route; without it the page object is used', async () => {
    mount(node(type, { actionType: 'script', objectName: 'contact' }), { handlers: { script: serverAction() } });
    press();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v1/actions/contact/probe_action');
    cleanup();
    fetchSpy.mockClear();
    mount(node(type, { actionType: 'script' }), { handlers: { script: serverAction() } });
    press();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v1/actions/page_object/probe_action');
  });

  it('`locations` members: a record-scoped placement refuses to run with no record in scope', async () => {
    mount(node(type, { actionType: 'script', locations: ['list_toolbar', 'record_header'] }), {
      handlers: { script: serverAction() },
    });
    press();
    // Refused before any request: an error toast, and no call to the route.
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][1]).toEqual(expect.objectContaining({ type: 'error' }));
    expect(fetchSpy).not.toHaveBeenCalled();
    cleanup();
    // Control: object-level placements only — the same action runs without a record.
    mount(node(type, { actionType: 'script', locations: ['list_toolbar'] }), {
      handlers: { script: serverAction() },
    });
    press();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });
});

describe('action:button — `recordIdField`', () => {
  it('names the row field a single-selection `script` action sends as its record id', async () => {
    const context = { selectedRecords: [{ id: 'ID-1', code: 'CODE-1' }] };
    mount(node('action:button', { actionType: 'script', recordIdField: 'code' }), {
      handlers: { script: serverAction() },
      context,
    });
    press();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).recordId).toBe('CODE-1');
    cleanup();
    fetchSpy.mockClear();
    // Control: without the key the row's `id` is sent.
    mount(node('action:button', { actionType: 'script' }), { handlers: { script: serverAction() }, context });
    press();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).recordId).toBe('ID-1');
  });
});

// ── objectui#11168 slice 2 ──────────────────────────────────────────────────

/** The diagnostics the page validator raises for one node, over the manifest the registry publishes. */
const diagnoseCodes = (schema: Record<string, unknown>) =>
  validateTree(
    schema as unknown as SchemaElement,
    manifestFromConfigs(
      ComponentRegistry.getAllConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
    ),
  ).diagnostics.map((diagnostic) => diagnostic.code);

/** The class list the Button primitive gives one size. */
const primitiveSizeClasses = (size: 'default' | 'sm' | 'lg' | 'icon') =>
  buttonVariants({ variant: 'default', size }).split(' ');

describe('action:button — `size` publishes the five sizes the spec row declares (objectui#11168 slice 2)', () => {
  const SIZES = ['default', 'sm', 'md', 'lg', 'icon'];

  it('publishes exactly the sizes the installed spec row accepts, and the spec refuses one outside them', () => {
    const size = ComponentRegistry.getConfig('action:button')?.inputs?.find((input) => input.name === 'size');
    expect(size?.enum).toEqual(SIZES);
    const row = (ComponentPropsMap as unknown as Record<string, { safeParse: (v: unknown) => { success: boolean } }>)[
      'action:button'
    ];
    for (const value of SIZES) expect(row.safeParse({ size: value }).success, `spec refuses size ${value}`).toBe(true);
    expect(row.safeParse({ size: 'xl' }).success).toBe(false);
  });

  it.each([
    ['default', 'default'],
    ['sm', 'sm'],
    ['lg', 'lg'],
    ['icon', 'icon'],
    // `md` is the one size the renderer MAPS rather than hands on: it draws
    // the primitive's `default`.
    ['md', 'default'],
  ] as const)('`size: %s` draws the Button primitive\'s `%s` size', (authored, drawn) => {
    mount(node('action:button', { size: authored }));
    const classes = screen.getByRole('button').className.split(' ');
    for (const cls of primitiveSizeClasses(drawn)) expect(classes, `${authored} lacks ${cls}`).toContain(cls);
  });

  it('CONTROL: the sizes are distinguishable, so the rows above cannot pass on one shared class list', () => {
    const drawn = (['default', 'sm', 'lg', 'icon'] as const).map((size) => primitiveSizeClasses(size).join(' '));
    expect(new Set(drawn).size).toBe(4);
  });

  it('the page validator accepts every published size and reports a size outside them', () => {
    for (const size of SIZES) {
      expect(diagnoseCodes({ type: 'action:button', size }), `validator refuses size ${size}`).not.toContain('invalid-enum');
    }
    expect(diagnoseCodes({ type: 'action:button', size: 'xl' })).toContain('invalid-enum');
  });
});
