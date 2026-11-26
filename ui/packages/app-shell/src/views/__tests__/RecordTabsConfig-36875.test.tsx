// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record-tabs rename gate reads the app's source language, not the
 * deployment's default locale (objectstack#36875): `GET /i18n/locales` serves
 * `sourceLocale`, and a reader in the default locale where that differs from
 * the source cannot rename a tab (a rename there would be written as the
 * source label), while a reader in the source language can. A server that
 * serves no `sourceLocale` keeps the default locale as the source.
 *
 * Real subjects: `useRecordTabsConfig`, `RecordTabsEditor`,
 * `recordTabsConfigIo.tsx`, `fetchDeploymentLocales`, `labelLanguageOf`,
 * `saveRecordTabs`, the design mode and its bar. Fakes: the design gate's
 * answer, the metadata client (it records what is written), the package
 * list and the deployment's languages.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const session = vi.hoisted(() => ({ language: 'en', defaultLocale: 'en', sourceLocale: null as string | null, gate: true as boolean }));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      String(o?.defaultValue ?? k).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) => String(o?.[name] ?? '')),
    language: session.language,
  }),
}));

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
import { DesignModeProvider, useDesignModeController } from '../../layout/designMode';
import { DesignModeBar } from '../../layout/DesignModeBar';

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
  session.sourceLocale = null;
  session.gate = true;
  __resetDefaultLocale();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      headers: new Headers(),
      ok: true,
      json: async () => ({
        data: {
          locales: [
            { code: 'en', isDefault: session.defaultLocale === 'en' },
            { code: 'zh-CN', isDefault: session.defaultLocale === 'zh-CN' },
          ],
          ...(session.sourceLocale ? { sourceLocale: session.sourceLocale } : {}),
        },
      }),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  render(<Harness />);
  fireEvent.click(screen.getByText('design'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide Tasks' })).toBeEnabled());
  await flush();
}

const save = () => screen.getByTestId('design-mode-save');

describe('the record-tabs rename gate reads the served source language (objectstack#36875)', () => {
  it('default locale zh-CN, source en: a reader in zh-CN cannot rename, so nothing is written as the source label', async () => {
    session.defaultLocale = 'zh-CN';
    session.sourceLocale = 'en';
    session.language = 'zh-CN';
    await open();
    const rename = screen.getByRole('button', { name: 'Rename People' });
    expect(rename).toBeDisabled();
    expect(rename).toHaveAttribute('title', "Tab names are changed in the app's source language");
    expect(save()).toBeDisabled();
    expect(written).toEqual([]);
  });

  it('default locale zh-CN, source en: a reader in en renames, and the save writes the source label', async () => {
    session.defaultLocale = 'zh-CN';
    session.sourceLocale = 'en';
    session.language = 'en';
    await open();
    const rename = screen.getByRole('button', { name: 'Rename People' });
    expect(rename).toBeEnabled();
    fireEvent.click(rename);
    const input = screen.getByLabelText('Tab name');
    fireEvent.change(input, { target: { value: 'Contacts we know' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    await flush();
    await flush();
    expect(written.map(([door]) => door)).toEqual(['save', 'publish']);
    expect(written[0].slice(1, 3)).toEqual(['object', 'account']);
    expect((written[0][3] as { relatedLists: unknown }).relatedLists).toEqual([{ list: 'contact', label: 'Contacts we know' }, 'task']);
  });

  it('no sourceLocale served: the default locale is the source, as before', async () => {
    session.defaultLocale = 'zh-CN';
    session.language = 'zh-CN';
    await open();
    expect(screen.getByRole('button', { name: 'Rename People' })).toBeEnabled();
    cleanup();
    __resetDefaultLocale();
    session.language = 'en';
    await open();
    expect(screen.getByRole('button', { name: 'Rename People' })).toBeDisabled();
  });
});
