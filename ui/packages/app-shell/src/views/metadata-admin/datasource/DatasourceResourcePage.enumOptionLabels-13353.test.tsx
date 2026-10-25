// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13353 — a driver-config `enum` select shows readable option text.
 *
 * The create/edit dialog builds its config form from the driver catalog's JSON
 * Schema (`GET /api/v1/datasources/drivers`). An `enum` property carries no
 * per-option label (no carrier exists in the driver-config schema today), and
 * each option rendered `String(opt)`, so the SQL drivers' `autoMigrate` select
 * offered the bare words `off` and `safe`. Each option now shows a label built
 * from its raw value with Studio's `humanizeKey` (the same helper `SchemaForm`'s
 * enum selects use), while the value the form saves stays the raw enum member.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@object-ui/i18n';

const state = vi.hoisted(() => ({
  fetch: (async () => undefined) as unknown as (url: string, init?: RequestInit) => Promise<unknown>,
  // STABLE identity, like the real memoized client.
  metadataClient: {},
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => (url: string, init?: RequestInit) => state.fetch(url, init),
}));
vi.mock('../useMetadata.js', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() },
}));

import { toast } from 'sonner';
import { DatasourceResourcePage } from './DatasourceResourcePage';

afterEach(() => {
  cleanup();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

/**
 * A sqlite-shaped catalog entry: `autoMigrate` is the producer the card names
 * (`off | safe`, a title but no option labels), and `syncMode` carries one
 * member in each machine spelling the label builder must read.
 */
const SQLITE = {
  id: 'sqlite',
  label: 'SQLite',
  configSchema: {
    properties: {
      filename: { type: 'string', title: 'Filename' },
      autoMigrate: { type: 'string', enum: ['off', 'safe'], title: 'Auto migrate' },
      syncMode: { type: 'string', enum: ['read_only', 'read-write', 'fullSync'], title: 'Sync mode' },
    },
    required: ['filename'],
  },
};

/** Serves the catalog and records every create the dialog sends. */
function serve() {
  const posts: Array<Record<string, unknown>> = [];
  const ok = (data: unknown) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, data }),
  });
  state.fetch = async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/v1/datasources/drivers')) return ok({ drivers: [SQLITE] });
    if (url.endsWith('/api/v1/datasources') && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return ok({ datasource: { name: 'local' } });
    }
    return ok({ datasources: [] });
  };
  return posts;
}

/** The select trigger beside a form label (the page's labels carry no `htmlFor`). */
function triggerUnder(label: string): HTMLElement {
  const lab = screen.getByText(label, { selector: 'label' });
  const trigger = lab.parentElement?.querySelector('[role="combobox"]');
  expect(trigger, `no select trigger beside the "${label}" label`).toBeTruthy();
  return trigger as HTMLElement;
}

async function openCreateDialog() {
  const posts = serve();
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <DatasourceResourcePage />
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /New datasource/ }));
  await screen.findByText('Auto migrate', { selector: 'label' });
  return posts;
}

/** Opens the select beside `label` and returns its option texts. */
async function optionTexts(label: string): Promise<string[]> {
  await userEvent.click(triggerUnder(label));
  const options = await screen.findAllByRole('option');
  return options.map((o) => o.textContent ?? '');
}

describe('objectui#13353 — an unlabeled driver-config enum shows readable option text', () => {
  it('the `autoMigrate` select offers "Off" and "Safe", not the bare values', async () => {
    await openCreateDialog();
    const texts = await optionTexts('Auto migrate');
    expect(texts).toEqual(['Off', 'Safe']);
    expect(texts, 'no option reads as a bare lowercase enum value').not.toContain('off');
    expect(texts).not.toContain('safe');
  });

  it('snake, kebab and camel case members each read as words', async () => {
    await openCreateDialog();
    expect(await optionTexts('Sync mode')).toEqual(['Read Only', 'Read Write', 'Full Sync']);
  });

  it('the value saved stays the raw enum member', async () => {
    const posts = await openCreateDialog();
    fireEvent.change(screen.getByText('Name *', { selector: 'label' }).parentElement!.querySelector('input')!, {
      target: { value: 'local' },
    });
    fireEvent.change(screen.getByText('Filename *', { selector: 'label' }).parentElement!.querySelector('input')!, {
      target: { value: 'local.db' },
    });
    await userEvent.click(triggerUnder('Auto migrate'));
    await userEvent.click(await screen.findByRole('option', { name: 'Safe' }));
    await userEvent.click(triggerUnder('Sync mode'));
    await userEvent.click(await screen.findByRole('option', { name: 'Full Sync' }));
    expect(triggerUnder('Auto migrate'), 'the closed select shows the chosen label').toHaveTextContent('Safe');

    fireEvent.click(screen.getByRole('button', { name: /Create datasource/ }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].config).toMatchObject({ filename: 'local.db', autoMigrate: 'safe', syncMode: 'fullSync' });
  });
});
