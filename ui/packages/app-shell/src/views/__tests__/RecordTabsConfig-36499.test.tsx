// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record page's tabs in the design mode (objectstack#36499,
 * objectstack#36737): the editor is drawn only while the mode is on, and only
 * where Studio's design gate opens the object's package; it takes the tab
 * row's place, with no bar of its own (the mode's bar is the one bar); a hide
 * goes to the 「Hidden」 area and comes back from it; a drag reorders; the
 * draft is staged with the mode's other changes, so the mode's 「Cancel」
 * drops it and writes nothing and the mode's 「Save」 writes it once; leaving
 * the app with it held asks first; a tab's name opens only in the source
 * language where the shown name is the stored one.
 *
 * Real subjects: `useRecordTabsConfig`, `RecordTabsEditor`, `saveRecordTabs`,
 * `useDesignModeController`, `DesignModeBar`, the unsaved-edits seam. Fakes:
 * the design gate's answer, the metadata client (it records what is
 * written), the package list and the deployment's languages.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { DesignModeProvider, useDesignModeChange, useDesignModeController } from '../../layout/designMode';
import { DesignModeBar } from '../../layout/DesignModeBar';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits';
import { toast } from 'sonner';

const lookup = { type: 'lookup', reference: 'account' };
const OBJECTS = [
  { name: 'account', label: 'Account', _packageId: 'app.crm', relatedLists: [{ list: 'contact', label: 'People' }, 'task'] },
  { name: 'contact', label: 'Contact', _packageId: 'app.crm', fields: { account: lookup } },
  { name: 'task', label: 'Task', _packageId: 'app.crm', fields: { account: lookup } },
  { name: 'case', label: 'Case', _packageId: 'app.crm', fields: { account: lookup } },
];

/** The shell's hold on the design mode, its bar while it is on, and the page under it. */
function Shell({ children }: { children?: React.ReactNode }) {
  const mode = useDesignModeController({ appName: 'crm', appBasePath: '/apps/crm', enabled: true });
  return (
    <DesignModeProvider value={mode}>
      {mode.active ? <DesignModeBar mode={mode} /> : <button type="button" onClick={mode.enter}>design</button>}
      {children}
    </DesignModeProvider>
  );
}

function Page({
  objectDef = OBJECTS[0] as Record<string, unknown>,
  objects = OBJECTS,
}: {
  objectDef?: Record<string, unknown>;
  objects?: Record<string, unknown>[];
}) {
  const config = useRecordTabsConfig({
    objectDef,
    objects,
    enabled: true,
    titleOf: (list) => list.title || `${list.childLabel}s`,
  });
  return (
    <>
      <span data-testid="active">{String(config.active)}</span>
      {config.editor}
      <span data-testid="preview">{JSON.stringify(config.previewObject?.relatedLists ?? null)}</span>
    </>
  );
}

function Harness({ objects, page = true, extra }: { objects?: Record<string, unknown>[]; page?: boolean; extra?: React.ReactNode }) {
  return (
    <MemoryRouter>
      <Shell>
        {page && <Page objects={objects} />}
        {extra}
      </Shell>
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
    vi.fn(async () => ({ headers: new Headers(), ok: true, json: async () => ({ data: { locales: [{ code: session.defaultLocale, isDefault: true }] } }) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** What a save writes through has loaded: the editor's controls are on. */
const ready = () => waitFor(() => expect(screen.getByRole('button', { name: 'Hide Tasks' })).toBeEnabled());

async function open(objects?: Record<string, unknown>[], extra?: React.ReactNode) {
  render(<Harness objects={objects} extra={extra} />);
  fireEvent.click(screen.getByText('design'));
  // The client, the stored list and the default language load with the editor.
  await ready();
  await flush();
}

const save = () => screen.getByTestId('design-mode-save');

describe('「Configure tabs」 (objectstack#36499)', () => {
  it("is drawn only in the design mode, and only where the design gate opens the object's package", async () => {
    render(<Harness />);
    expect(screen.getByTestId('active')).toHaveTextContent('false');
    expect(screen.queryByTestId('record-tabs-editor')).toBeNull();
    fireEvent.click(screen.getByText('design'));
    expect(screen.getByTestId('active')).toHaveTextContent('true');
    expect(screen.getByTestId('record-tabs-editor')).toBeInTheDocument();
    await flush();
    cleanup();
    session.gate = false;
    render(<Harness />);
    fireEvent.click(screen.getByText('design'));
    expect(screen.getByTestId('active')).toHaveTextContent('false');
    expect(screen.queryByTestId('record-tabs-editor')).toBeNull();
  });

  it('the editor: the shown tabs in order, the unnamed list hidden', async () => {
    await open();
    const editor = screen.getByRole('region', { name: 'Configure tabs' });
    const shown = Array.from(editor.querySelectorAll('[data-record-tabs-tab]')).map((el) => el.getAttribute('data-record-tabs-tab'));
    expect(shown).toEqual(['contact.account', 'task.account', 'sys_approval_request', 'sys_activity']);
    expect(screen.getByTestId('record-tabs-hidden').querySelector('[data-record-tabs-hidden-tab="case.account"]')).not.toBeNull();
    expect(screen.getByTestId('record-tabs-field-groups')).toHaveAttribute('href', expect.stringContaining('/studio/app.crm/data'));
  });

  it("another package's list is drawn fixed after the object's own tabs: no move, hide or rename", async () => {
    await open([...OBJECTS, { name: 'ext_ticket', label: 'Ticket', _packageId: 'other.pkg', fields: { account: lookup } }]);
    const editor = screen.getByTestId('record-tabs-editor');
    const shown = Array.from(editor.querySelectorAll('[data-record-tabs-tab]')).map((el) => el.getAttribute('data-record-tabs-tab'));
    expect(shown).toEqual(['contact.account', 'task.account', 'ext_ticket.account', 'sys_approval_request', 'sys_activity']);
    const ticket = editor.querySelector('[data-record-tabs-tab="ext_ticket.account"]') as HTMLElement;
    expect(within(ticket).queryAllByRole('button')).toEqual([]);
    expect(ticket.querySelector('[data-record-tabs-fixed]')).not.toBeNull();
  });

  it('hide → the Hidden area → restore: back where it opened, nothing is staged', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Tasks' }));
    expect(screen.getByTestId('record-tabs-hidden').querySelector('[data-record-tabs-hidden-tab="task.account"]')).not.toBeNull();
    expect(save()).toBeEnabled();
    expect(screen.getByTestId('preview')).toHaveTextContent(JSON.stringify([{ list: 'contact', label: 'People' }]));
    fireEvent.click(screen.getByRole('button', { name: 'Show Tasks' }));
    expect(save()).toBeDisabled();
  });

  it('with a change held, leaving the app asks first', async () => {
    const confirm = vi.fn((_message?: string): boolean => false);
    vi.stubGlobal('confirm', confirm);
    await open();
    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(confirm).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Tasks' }));
    confirmUnsavedLeave(go);
    expect(confirm).toHaveBeenCalledWith('Leave Design layout? Your unsaved changes will be lost.');
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
    expect(save()).toBeEnabled();
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

/** Another surface of the mode (the app menu, say) that stages one change when pressed. */
function OtherChange({ commit }: { commit: () => Promise<void> }) {
  const change = useDesignModeChange<string>('app-menu');
  return (
    <button type="button" onClick={() => change.stage('menu', commit)}>
      stage menu
    </button>
  );
}

describe('the tabs are part of the design mode (objectstack#36737)', () => {
  it('the tab row is the editor under the one bar: no bar of its own, and 「Save」 is off until a change', async () => {
    await open();
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Design layout', 'Configure tabs']);
    expect(screen.queryByTestId('record-tabs-config-bar')).toBeNull();
    expect(save()).toBeDisabled();
  });

  it("the mode's 「Save」 writes the draft with its other changes, once, in the order staged, and leaves the mode", async () => {
    const menu = vi.fn(async () => {
      written.push(['menu']);
    });
    await open(undefined, <OtherChange commit={menu} />);
    fireEvent.click(screen.getByText('stage menu'));
    act(() => dragEnd.current?.({ active: { id: 'task.account' }, over: { id: 'contact.account' } }));
    expect(screen.getByTestId('preview')).toHaveTextContent(JSON.stringify(['task', { list: 'contact', label: 'People' }]));
    fireEvent.click(save());
    await flush();
    await flush();
    expect(written.map(([c]) => c)).toEqual(['menu', 'save', 'publish']);
    expect(written[1].slice(1, 3)).toEqual(['object', 'account']);
    expect((written[1][3] as { relatedLists: unknown }).relatedLists).toEqual(['task', { list: 'contact', label: 'People' }]);
    expect(written[1][4]).toEqual({ mode: 'draft', packageId: 'app.crm', ifNoneMatch: '*' });
    expect(screen.queryByTestId('design-mode-bar')).toBeNull();
    expect(screen.queryByTestId('record-tabs-editor')).toBeNull();
  });

  it("the mode's 「Cancel」 drops the draft, a tab hidden by default shown again included, and writes nothing", async () => {
    await open();
    const hiddenArea = () => screen.getByTestId('record-tabs-hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Hide Tasks' }));
    // Cases is hidden by default (the object names no entry for it): show it.
    fireEvent.click(screen.getByRole('button', { name: 'Show Cases' }));
    expect(hiddenArea().querySelector('[data-record-tabs-hidden-tab="case.account"]')).toBeNull();
    expect(screen.getByTestId('record-tabs-editor').querySelector('[data-record-tabs-tab="case.account"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId('design-mode-cancel'));
    await flush();
    expect(screen.queryByTestId('record-tabs-editor')).toBeNull();
    expect(written).toEqual([]);
    // Back in the mode, the tabs open as the object has them.
    fireEvent.click(screen.getByText('design'));
    await ready();
    expect(hiddenArea().querySelector('[data-record-tabs-hidden-tab="task.account"]')).toBeNull();
    expect(hiddenArea().querySelector('[data-record-tabs-hidden-tab="case.account"]')).not.toBeNull();
    expect(save()).toBeDisabled();
  });

  it("a save that fails keeps the editor on the draft and the mode on, and says why through the mode", async () => {
    const publish = client.publish;
    client.publish = async () => {
      throw new Error('publish refused');
    };
    try {
      await open();
      fireEvent.click(screen.getByRole('button', { name: 'Hide Tasks' }));
      fireEvent.click(save());
      await flush();
      await flush();
      expect(toast.error).toHaveBeenCalledWith('Some changes were not saved: publish refused');
      expect(screen.getByTestId('design-mode-bar')).toBeInTheDocument();
      expect(screen.getByTestId('record-tabs-hidden').querySelector('[data-record-tabs-hidden-tab="task.account"]')).not.toBeNull();
      expect(screen.getByTestId('preview')).toHaveTextContent(JSON.stringify([{ list: 'contact', label: 'People' }]));
      expect(save()).toBeEnabled();
    } finally {
      client.publish = publish;
    }
  });

  it('the draft stays staged while the page is left for another page of the app, and is drawn again on return', async () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByText('design'));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Tasks' }));
    rerender(<Harness page={false} />);
    expect(screen.queryByTestId('record-tabs-editor')).toBeNull();
    expect(save()).toBeEnabled();
    rerender(<Harness />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show Tasks' })).toBeEnabled());
    expect(screen.getByTestId('record-tabs-hidden').querySelector('[data-record-tabs-hidden-tab="task.account"]')).not.toBeNull();
    expect(screen.getByTestId('preview')).toHaveTextContent(JSON.stringify([{ list: 'contact', label: 'People' }]));
  });
});
