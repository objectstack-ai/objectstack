// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * 「Configure tabs」 in place (objectstack#36499): the entry is offered only
 * where Studio's design gate opens the object's package; the edit state draws
 * the bar and the editor; a hide goes to the 「Hidden」 area and comes back
 * from it; a drag reorders; 「Cancel」 writes nothing; 「Save」 writes once;
 * leaving with a change held asks first; a tab's name opens only in the
 * source language where the shown name is the stored one.
 *
 * Real subjects: `useRecordTabsConfig`, `RecordTabsConfigBar`,
 * `RecordTabsEditor`, `saveRecordTabs`, the unsaved-edits seam. Fakes: the
 * design gate's answer, the metadata client (it records what is written), the
 * package list and the deployment's languages.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const session = vi.hoisted(() => ({ language: 'en', defaultLocale: 'en', gate: true as boolean }));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      String(o?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) => String(o?.[name] ?? '')),
    language: session.language,
  }),
}));

const dragEnd = vi.hoisted(() => ({ current: null as null | ((event: unknown) => void) }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@dnd-kit/core')>();
  const { createElement } = await import('react');
  return {
    ...real,
    DndContext: (props: React.ComponentProps<typeof real.DndContext>) => {
      dragEnd.current = props.onDragEnd as never;
      return createElement(real.DndContext, props);
    },
  };
});

vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../hooks/useStudioDesignGate', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useStudioDesignGate: (path: string | null) => (session.gate ? path : null),
}));

const written = vi.hoisted(() => [] as Array<[string, ...unknown[]]>);
const stored = vi.hoisted(() => ({ relatedLists: undefined as unknown[] | undefined }));
const client = vi.hoisted(() => ({
  layered: async () => {
    const code = { name: 'account', label: 'Account', ...(stored.relatedLists ? { relatedLists: stored.relatedLists } : {}) };
    return { code, effective: code };
  },
  save: async (...args: unknown[]) => {
    written.push(['save', ...args]);
    return {};
  },
  publish: async (...args: unknown[]) => {
    written.push(['publish', ...args]);
    return {};
  },
  reset: async () => ({}),
}));
vi.mock('../metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));
vi.mock('../studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: async () => new Map([['app.crm', { id: 'app.crm', name: 'CRM', writable: true, manifest: {} }]]),
}));

import { useRecordTabsConfig } from '../RecordTabsConfig';
import { __resetDefaultLocale } from '../../layout/designModeMenuSave';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits';

const lookup = { type: 'lookup', reference: 'account' };
const OBJECTS = [
  { name: 'account', label: 'Account', _packageId: 'app.crm', relatedLists: [{ list: 'contact', label: 'People' }, 'task'] },
  { name: 'contact', label: 'Contact', _packageId: 'app.crm', fields: { account: lookup } },
  { name: 'task', label: 'Task', _packageId: 'app.crm', fields: { account: lookup } },
  { name: 'case', label: 'Case', _packageId: 'app.crm', fields: { account: lookup } },
];

function Harness({ objectDef = OBJECTS[0] as Record<string, unknown> }: { objectDef?: Record<string, unknown> }) {
  const config = useRecordTabsConfig({
    objectDef,
    objects: OBJECTS,
    enabled: true,
    titleOf: (list) => list.title || `${list.childLabel}s`,
  });
  return (
    <MemoryRouter>
      <span data-testid="offered">{String(config.offered)}</span>
      {config.offered && !config.active && (
        <button type="button" onClick={config.enter}>
          enter
        </button>
      )}
      {config.bar}
      {config.editor}
      <span data-testid="preview">{JSON.stringify(config.previewObject?.relatedLists ?? null)}</span>
    </MemoryRouter>
  );
}

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => {
  written.length = 0;
  stored.relatedLists = [{ list: 'contact', label: 'People' }, 'task'];
  session.language = 'en';
  session.defaultLocale = 'en';
  session.gate = true;
  __resetDefaultLocale();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: { locales: [{ code: session.defaultLocale, isDefault: true }] } }) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  render(<Harness />);
  fireEvent.click(screen.getByText('enter'));
  await flush();
}

describe('「Configure tabs」 (objectstack#36499)', () => {
  it('is offered only where the design gate opens the object\'s package', () => {
    session.gate = false;
    render(<Harness />);
    expect(screen.getByTestId('offered')).toHaveTextContent('false');
    cleanup();
    session.gate = true;
    render(<Harness />);
    expect(screen.getByTestId('offered')).toHaveTextContent('true');
  });

  it('the edit state: the bar, the shown tabs in order, the unnamed list hidden, Save off until a change', async () => {
    await open();
    const bar = screen.getByTestId('record-tabs-config-bar');
    expect(within(bar).getByText('Configure tabs')).toBeInTheDocument();
    expect(screen.getByTestId('record-tabs-config-save')).toBeDisabled();
    const editor = screen.getByTestId('record-tabs-editor');
    const shown = Array.from(editor.querySelectorAll('[data-record-tabs-tab]')).map((el) => el.getAttribute('data-record-tabs-tab'));
    expect(shown).toEqual(['contact.account', 'task.account', 'sys_approval_request', 'sys_activity']);
    expect(screen.getByTestId('record-tabs-hidden').querySelector('[data-record-tabs-hidden-tab="case.account"]')).not.toBeNull();
    expect(screen.getByTestId('record-tabs-field-groups')).toHaveAttribute('href', expect.stringContaining('/studio/app.crm/data'));
  });

  it('hide → the Hidden area → restore; Cancel writes nothing', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Tasks' }));
    expect(screen.getByTestId('record-tabs-hidden').querySelector('[data-record-tabs-hidden-tab="task.account"]')).not.toBeNull();
    expect(screen.getByTestId('record-tabs-config-save')).toBeEnabled();
    expect(screen.getByTestId('preview')).toHaveTextContent(JSON.stringify([{ list: 'contact', label: 'People' }]));
    fireEvent.click(screen.getByRole('button', { name: 'Show Tasks' }));
    expect(screen.getByTestId('record-tabs-config-save')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show Cases' }));
    fireEvent.click(screen.getByTestId('record-tabs-config-cancel'));
    await flush();
    expect(screen.queryByTestId('record-tabs-config-bar')).toBeNull();
    expect(written).toEqual([]);
  });

  it('a drag reorders, and Save writes the stored object once, then leaves the edit state', async () => {
    await open();
    act(() => dragEnd.current?.({ active: { id: 'task.account' }, over: { id: 'contact.account' } }));
    fireEvent.click(screen.getByTestId('record-tabs-config-save'));
    await flush();
    expect(written.map(([c]) => c)).toEqual(['save', 'publish']);
    expect((written[0][3] as { relatedLists: unknown }).relatedLists).toEqual(['task', { list: 'contact', label: 'People' }]);
    expect(screen.queryByTestId('record-tabs-config-bar')).toBeNull();
  });

  it('with a change held, leaving asks first', async () => {
    const confirm = vi.fn((_message?: string): boolean => false);
    vi.stubGlobal('confirm', confirm);
    await open();
    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(confirm).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Tasks' }));
    confirmUnsavedLeave(go);
    expect(confirm).toHaveBeenCalledWith('Leave without saving? Your tab changes will be lost.');
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('renames in the source language where the shown name is the stored one', async () => {
    await open();
    const rename = screen.getByRole('button', { name: 'Rename People' });
    expect(rename).toBeEnabled();
    fireEvent.click(rename);
    const input = screen.getByLabelText('Tab name');
    fireEvent.change(input, { target: { value: 'Contacts we know' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Contacts we know')).toBeInTheDocument();
    expect(screen.getByTestId('record-tabs-config-save')).toBeEnabled();
  });

  it('closes the name in another language, and where the stored name is not the one shown', async () => {
    session.language = 'zh-CN';
    await open();
    expect(screen.getByRole('button', { name: 'Rename People' })).toBeDisabled();
    cleanup();
    session.language = 'en';
    stored.relatedLists = [{ list: 'contact', label: 'Personen' }, 'task'];
    await open();
    expect(screen.getByRole('button', { name: 'Rename People' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rename Tasks' })).toBeEnabled();
  });
});
