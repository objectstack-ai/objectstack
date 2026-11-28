// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#38149 — the console's create-app route saves the wizard's new
 * app into a package the author picks first (`ConsoleCreateAppPage.tsx`):
 * a draft in that package under the first-write pin, then that item's
 * publish. Cancel writes nothing and answers the wizard "not saved".
 *
 * The wizard is a stub that hands its finished app to `saveApp` (the
 * wizard's own steps are plugin-designer's subject); the writes go through a
 * REAL `MetadataClient` over an in-memory server recording each one.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The source under test reaches `celAuthoring`'s dynamic `@objectstack/lint`
// import; its first load is paid here, at collection (`check:test-source-alias`).
import '@objectstack/lint';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';

type Write = { method: string; path: string; mode: string | null; packageId: string | null; ifNoneMatch: string | null };
const server = { writes: [] as Write[] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  if (method === 'PUT' || method === 'POST') {
    server.writes.push({
      method,
      path: url.pathname,
      mode: url.searchParams.get('mode'),
      packageId: url.searchParams.get('package'),
      ifNoneMatch: new Headers(init?.headers).get('If-None-Match'),
    });
    return json(200, { success: true, version: 'hmac-sha256:v1', seq: 1, state: method === 'PUT' ? 'draft' : 'active' });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const client = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../views/metadata-admin/useMetadata.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client.current,
}));

vi.mock('../../views/studio-design/packages-io.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPackages: async () => [{ id: 'app.alpha', name: 'Alpha', writable: true, namespace: 'alpha' }],
}));

/** The wizard, cut to its last step: Finish hands the app to `saveApp`. */
vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CreateAppPage: ({ saveApp }: { saveApp?: (name: string, app: Record<string, unknown>) => Promise<boolean> }) => {
    const [answer, setAnswer] = React.useState<string>('');
    return (
      <div>
        <button type="button" onClick={() => void saveApp?.('crm_lite', { name: 'crm_lite', label: 'CRM Lite' }).then((ok) => setAnswer(String(ok)))}>
          finish
        </button>
        <output data-testid="wizard-answer">{answer}</output>
      </div>
    );
  },
}));

import { ConsoleCreateAppPage } from '../ConsoleCreateAppPage';

beforeEach(() => {
  server.writes = [];
  client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });
});
afterEach(() => cleanup());

describe('the console create-app route asks for the package (objectstack#38149)', () => {
  it('the chosen package takes the draft under the first-write pin, then its publish', async () => {
    render(<ConsoleCreateAppPage />);
    fireEvent.click(screen.getByText('finish'));
    const dialog = await screen.findByTestId('package-create-ask');
    expect(server.writes).toEqual([]);
    fireEvent.click(await within(dialog).findByTestId('package-create-ask-option-app.alpha'));
    fireEvent.click(within(dialog).getByTestId('package-create-ask-continue'));
    await waitFor(() => expect(screen.getByTestId('wizard-answer')).toHaveTextContent('true'));
    expect(server.writes).toEqual([
      { method: 'PUT', path: '/api/v1/meta/app/crm_lite', mode: 'draft', packageId: 'app.alpha', ifNoneMatch: '*' },
      { method: 'POST', path: '/api/v1/meta/app/crm_lite/publish', mode: null, packageId: 'app.alpha', ifNoneMatch: null },
    ]);
  });

  it('Cancel writes nothing, and the wizard is told the app was not saved', async () => {
    render(<ConsoleCreateAppPage />);
    fireEvent.click(screen.getByText('finish'));
    fireEvent.click(within(await screen.findByTestId('package-create-ask')).getByTestId('package-create-ask-cancel'));
    await waitFor(() => expect(screen.getByTestId('wizard-answer')).toHaveTextContent('false'));
    expect(server.writes).toEqual([]);
  });
});
