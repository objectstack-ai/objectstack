// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28240 — the picker offers only what the edited package's
 * closure admits: its own objects, its declared dependencies' and the
 * platform's. The card's repro is the pin: a new writable package with no
 * dependencies, a record trigger's object picker, and a showcase object the
 * publish gate would refuse after the save.
 *
 * The closure is computed by the real `@objectstack/lint` functions the gate
 * runs (`resolvePackageClosure`, `narrowObjectsToPackageClosure`); only the
 * two reads are doubled — the object list and `GET /api/v1/packages`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const OWN = 'com.default.acme-custom';
const SHOWCASE = 'com.example.showcase';

const h = vi.hoisted(() => {
  const CATALOG: Array<Record<string, unknown>> = [
    { name: 'acme_invoice', label: 'Invoice', _packageId: 'com.default.acme-custom' },
    { name: 'showcase_task', label: 'Task', isSystem: false, _packageId: 'com.example.showcase' },
    { name: 'showcase_expense_report', label: 'Expense Report', isSystem: false, _packageId: 'com.example.showcase' },
    { name: 'sys_user', label: 'User', isSystem: true, _packageId: 'com.objectstack.plugin-auth' },
    // A tenant overlay row names no package: nothing bounds it, the gate keeps it.
    { name: 'overlay_note', label: 'Note' },
  ];
  const previewList = vi.fn(async (_type: string) => CATALOG);
  const client = { withPreviewDrafts: vi.fn((_on: boolean) => ({ list: previewList })) };
  return { CATALOG, previewList, client };
});

vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));

import { ObjectPicker } from './ObjectPicker';
import { t, tFormat } from '../i18n';
// The picker imports the lint module lazily; warmed here so its first load is
// paid at import, not inside a test's bounded wait.
import '@objectstack/lint';

/** What `GET /api/v1/packages` answers: the acme package's manifest declares `deps`. */
let deps: Record<string, string> = {};
let packagesOk = true;
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (!url.includes('/api/v1/packages')) throw new Error(`unexpected fetch ${url}`);
  if (!packagesOk) return new Response(JSON.stringify({ success: false, error: { code: 'X', message: 'down' } }), { status: 503 });
  const body = {
    success: true,
    data: [
      { manifest: { id: OWN, name: 'Acme Custom', version: '0.1.0', dependencies: deps }, writable: true },
      { manifest: { id: SHOWCASE, name: 'Showcase', version: '1.0.0' }, writable: false },
    ],
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

beforeEach(() => {
  deps = {};
  packagesOk = true;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPicker() {
  const onCommit = vi.fn();
  render(
    <MemoryRouter initialEntries={[`/studio/${OWN}/automations`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<ObjectPicker label="Object" value="" onCommit={onCommit} />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onCommit, input: screen.getByRole('combobox', { name: 'Object' }) };
}

function option(name: string): HTMLElement | null {
  return document.querySelector(`[data-object-name="${name}"]`);
}

/** The pickable object names: listed and not disabled. */
function pickable(): string[] {
  return screen
    .queryAllByRole('option')
    .filter((o) => o.getAttribute('aria-disabled') !== 'true')
    .map((o) => o.getAttribute('data-object-name'))
    .filter((n): n is string => !!n);
}

async function openAndSettle(input: HTMLElement) {
  await userEvent.click(input);
  await waitFor(() => expect(option('acme_invoice')).not.toBeNull());
}

describe('ObjectPicker — only the package closure is pickable (objectstack#28240)', () => {
  it('the card repro: a package with no dependencies is not offered a showcase object', async () => {
    const { input, onCommit } = renderPicker();
    await openAndSettle(input);
    await waitFor(() => expect(document.querySelector('[data-outside-toggle]')).not.toBeNull());
    expect(pickable()).toEqual(['acme_invoice', 'overlay_note']);
    expect(option('showcase_task')).toBeNull();
    expect(document.querySelector('[data-outside-toggle]')).toHaveTextContent(
      tFormat('engine.inspector.objectPicker.showOutside', 'en-US', { count: 2 }),
    );

    // Searching finds it, disabled, under the reason and the door to declare.
    await userEvent.type(input, 'task');
    const task = option('showcase_task') as HTMLElement;
    expect(task).toHaveAttribute('aria-disabled', 'true');
    expect(task.querySelector('[data-outside-from]')).toHaveTextContent(SHOWCASE);
    expect(document.querySelector('[data-outside-reason]')).toHaveTextContent('Acme Custom can use only its own objects');
    await userEvent.click(task);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('CONTROL: a declared dependency\'s objects are offered and commit', async () => {
    deps = { [SHOWCASE]: '^1.0.0' };
    const { input, onCommit } = renderPicker();
    await openAndSettle(input);
    await waitFor(() => expect(option('showcase_task')).not.toBeNull());
    expect(option('showcase_task')).not.toHaveAttribute('aria-disabled');
    expect(document.querySelector('[data-outside-toggle]')).toBeNull();
    await userEvent.click(option('showcase_task') as HTMLElement);
    expect(onCommit).toHaveBeenCalledWith('showcase_task');
  });

  it('a dependency declared after mount makes the object pickable once the package list changes', async () => {
    const { input } = renderPicker();
    await openAndSettle(input);
    await waitFor(() => expect(document.querySelector('[data-outside-toggle]')).not.toBeNull());
    deps = { [SHOWCASE]: '^1.0.0' };
    act(() => {
      window.dispatchEvent(new CustomEvent('objectui:packages-changed'));
    });
    await waitFor(() => expect(option('showcase_task')).not.toBeNull());
    expect(option('showcase_task')).not.toHaveAttribute('aria-disabled');
  });

  it('platform objects stay pickable without any declared dependency', async () => {
    const { input, onCommit } = renderPicker();
    await openAndSettle(input);
    await waitFor(() => expect(document.querySelector('[data-outside-toggle]')).not.toBeNull());
    await userEvent.type(input, 'user');
    expect(option('sys_user')).not.toHaveAttribute('aria-disabled');
    await userEvent.click(option('sys_user') as HTMLElement);
    expect(onCommit).toHaveBeenCalledWith('sys_user');
  });

  it('the declare row opens the package edit dialog when the package is writable', async () => {
    const { input } = renderPicker();
    await openAndSettle(input);
    await waitFor(() => expect(document.querySelector('[data-outside-toggle]')).not.toBeNull());
    await userEvent.click(document.querySelector('[data-outside-toggle]') as HTMLElement);
    const declare = document.querySelector('[data-outside-declare]') as HTMLElement;
    expect(declare).toHaveTextContent(t('engine.inspector.objectPicker.declareDependency', 'en-US'));
    await userEvent.click(declare);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('an unreadable package list narrows nothing: every object is offered and the server judges', async () => {
    packagesOk = false;
    const { input } = renderPicker();
    await openAndSettle(input);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(option('showcase_task')).not.toBeNull());
    expect(option('showcase_task')).not.toHaveAttribute('aria-disabled');
    expect(document.querySelector('[data-outside-toggle]')).toBeNull();
  });
});
