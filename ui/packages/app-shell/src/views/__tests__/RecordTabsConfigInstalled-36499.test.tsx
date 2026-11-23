// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * 「Configure tabs」 on an installed object (objectstack#36499, card items 4
 * and 7): offered where Studio opens the base read-only and the customization
 * door does not wall this caller off; every tab moves (another package's list
 * and the built-in tabs too), a related tab hides, a built-in one does not;
 * each related tab names where it comes from; 「Save」 writes the paired
 * `.custom` extension's `relatedLists` through the ensure door's answer.
 *
 * Real subjects: `useRecordTabsConfig`, `RecordTabsEditor`, `saveRecordTabs`,
 * `saveObjectExtensionArrangement`. Fakes: the gates' answers, the walled
 * verdict, the package list and the ensure door, the metadata client (it
 * records what is written) and the deployment's languages.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const session = vi.hoisted(() => ({ view: true as boolean, walled: false as boolean }));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      String(o?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) => String(o?.[name] ?? '')),
    language: 'en',
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
  useStudioDesignGate: () => null,
  useStudioEntryGate: (path: string | null) => (session.view && path ? { path, posture: 'view' } : null),
}));

vi.mock('../studio-design/StudioCustomizeControls', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCustomizeDoorWalled: () => session.walled,
}));

const BASE = 'app.hotcrm';
const PAIR = 'app.hotcrm.custom';

const written = vi.hoisted(() => [] as Array<[string, ...unknown[]]>);
const client = vi.hoisted(() => ({
  layered: async () => {
    const code = { name: 'lead', relatedLists: [{ list: 'contact', label: 'Contacts' }] };
    return { code, effective: code };
  },
  get: async () => null,
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
  fetchListedPackageManifests: async () =>
    new Map([
      ['app.hotcrm', { id: 'app.hotcrm', name: 'HotCRM', writable: false, manifest: {} }],
      ['com.marketing', { id: 'com.marketing', name: 'Marketing', writable: false, manifest: {} }],
    ]),
  ensureCustomizationPackage: async (base: string) => {
    written.push(['ensure', base]);
    return { basePackageId: base, packageId: 'app.hotcrm.custom', namespace: 'crm_custom', created: true, writable: true };
  },
}));

import { useRecordTabsConfig } from '../RecordTabsConfig';
import { __resetDefaultLocale } from '../../layout/designModeMenuSave';

const toLead = { type: 'lookup', reference: 'lead' };
const OBJECTS: Record<string, unknown>[] = [
  { name: 'lead', label: 'Lead', _packageId: BASE, relatedLists: [{ list: 'contact', label: 'Contacts' }] },
  { name: 'contact', label: 'Contact', _packageId: BASE, fields: { lead: toLead } },
  { name: 'campaign_member', label: 'Campaign member', _packageId: 'com.marketing', fields: { lead: toLead } },
  { name: 'survey', label: 'Survey', _packageId: PAIR, fields: { lead: toLead } },
];

function Harness() {
  const config = useRecordTabsConfig({
    objectDef: OBJECTS[0],
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
    </MemoryRouter>
  );
}

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  written.length = 0;
  session.view = true;
  session.walled = false;
  __resetDefaultLocale();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: { locales: [{ code: 'en', isDefault: true }] } }) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  render(<Harness />);
  fireEvent.click(screen.getByText('enter'));
  await waitFor(() => expect(screen.getByTestId('record-tabs-config-bar')).toHaveAttribute('data-ready', 'true'));
  await flush();
}

const shownTabs = () =>
  Array.from(screen.getByTestId('record-tabs-editor').querySelectorAll('[data-record-tabs-tab]')).map((el) =>
    el.getAttribute('data-record-tabs-tab'),
  );

describe('「Configure tabs」 on an installed object (objectstack#36499)', () => {
  it('is offered where Studio opens the base read-only, and not where the customization door walls this caller off', () => {
    render(<Harness />);
    expect(screen.getByTestId('offered')).toHaveTextContent('true');
    cleanup();
    session.walled = true;
    render(<Harness />);
    expect(screen.getByTestId('offered')).toHaveTextContent('false');
    cleanup();
    session.walled = false;
    session.view = false;
    render(<Harness />);
    expect(screen.getByTestId('offered')).toHaveTextContent('false');
  });

  it("every tab moves, another package's and the built-in ones too; a related tab hides, a built-in one does not; each related tab names its source", async () => {
    await open();
    expect(shownTabs()).toEqual(['contact.lead', 'campaign_member.lead', 'survey.lead', 'sys_approval_request', 'sys_activity']);
    const editor = screen.getByTestId('record-tabs-editor');
    for (const id of ['contact.lead', 'campaign_member.lead', 'sys_activity']) {
      expect(editor.querySelector(`[data-record-tabs-tab="${id}"] [data-record-tabs-handle]`)).not.toBeNull();
    }
    const tab = (id: string) => editor.querySelector(`[data-record-tabs-tab="${id}"]`) as HTMLElement;
    expect(within(tab('campaign_member.lead')).getByRole('button', { name: 'Hide Campaign members' })).toBeEnabled();
    expect(tab('sys_activity').querySelector('[data-record-tabs-hide]')).toBeNull();
    expect(tab('contact.lead').querySelector('[data-record-tabs-source="base"]')).toHaveTextContent('Original package');
    expect(tab('campaign_member.lead').querySelector('[data-record-tabs-source="package"]')).toHaveTextContent('From Marketing');
    expect(tab('survey.lead').querySelector('[data-record-tabs-source="environment"]')).toHaveTextContent('This environment');
  });

  it("Save writes the pair's extension of the object, through the ensure door's answer, and publishes it", async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Campaign members' }));
    act(() => dragEnd.current?.({ active: { id: 'sys_activity' }, over: { id: 'contact.lead' } }));
    expect(shownTabs()).toEqual(['sys_activity', 'contact.lead', 'survey.lead', 'sys_approval_request']);
    fireEvent.click(screen.getByTestId('record-tabs-config-save'));
    await flush();
    await flush();
    expect(written).toEqual([
      ['ensure', BASE],
      [
        'save',
        'object_extension',
        'lead',
        {
          extend: 'lead',
          relatedLists: [
            'sys_activity',
            { list: 'contact', label: 'Contacts' },
            'survey',
            'sys_approval_request',
            { list: 'campaign_member', hidden: true },
          ],
        },
        { mode: 'draft', packageId: PAIR, ifNoneMatch: '*' },
      ],
      ['publish', 'object_extension', 'lead', { packageId: PAIR }],
    ]);
    expect(screen.queryByTestId('record-tabs-config-bar')).toBeNull();
  });
});
