// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35650 — the action's full-page editor draws a script action's
 * refusal catalogue (`refusals`) and declared texts (`texts`) with their
 * served rows: the key-only record control and the row's help text, not the
 * raw JSON editor the bare schema gives a record.
 *
 * The REAL page with the production registrations: `action` registers a
 * preview and a default inspector, so the page takes its designer branch and
 * the no-selection panel is `ActionDefaultInspector`. The type row is built
 * from the spec the way the server builds it: `actionForm` as the form, and
 * `ActionSchema` converted with `z.toJSONSchema(…, { io: 'input' })` as the
 * schema. The only stand-ins are the metadata client and the network.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { ActionSchema, actionForm } from '@objectstack/spec/ui';

// Module-scope imports of the engines the page reaches through dynamic
// `import()` (the CEL authoring and the save-time lint): a cold first load
// stays out of every `waitFor` (`check:test-source-alias`).
import '@objectstack/formula';
import '@objectstack/lint';

/** The `action` row's `schema`, converted from the spec the way the server does. */
const ACTION_JSON_SCHEMA = z.toJSONSchema(ActionSchema as unknown as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

/** The served row of `key`, read off the form the server serves. */
function servedHelpText(key: string): string {
  for (const section of actionForm.sections ?? []) {
    for (const row of section.fields ?? []) {
      if (typeof row !== 'string' && row.field === key) return String(row.helpText);
    }
  }
  throw new Error(`actionForm declares no ${key} row`);
}

const STORED = {
  name: 'sign_contract',
  label: 'Sign contract',
  objectName: 'contract',
  type: 'script',
  locations: ['record_header'],
  body: { language: 'js', source: "throw { code: 'SIGN_IN_REQUIRED' };" },
  refusals: { SIGN_IN_REQUIRED: { message: 'Sign in first.', status: 401 } },
  texts: { email_subject: { message: 'Contract signed' } },
};

let stored: Record<string, unknown> = STORED;

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: stored, code: null, editable: true, deletable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => stored),
  save: vi.fn(async (_type: string, _name: string, item: unknown) => {
    stored = item as Record<string, unknown>;
    return {};
  }),
  saveDraft: vi.fn(async () => ({})),
  publish: vi.fn(async () => ({ success: true })),
  references: vi.fn(async () => []),
  history: vi.fn(async () => []),
  // The object-scoped field pickers read the bound object through the draft-preview client.
  withPreviewDrafts: vi.fn(),
};
mockClient.withPreviewDrafts.mockImplementation(() => mockClient);

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMetadata')>()),
  useMetadataClient: () => mockClient,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [
      {
        type: 'action',
        name: 'action',
        label: 'Action',
        domain: 'ui',
        allowEnvironmentOverlay: true,
        allowRuntimeCreate: true,
        schema: ACTION_JSON_SCHEMA,
        form: actionForm,
      },
    ],
  }),
}));
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});
vi.mock('@object-ui/plugin-editor', () => ({ configureBundledMonaco: () => Promise.resolve() }));
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

import { MetadataResourceEditPage } from './ResourceEditPage';
// The load-time registrations, exactly as the package entry runs them, so the
// branch this file takes is the branch production takes.
import './register-builtins';
import { registerBuiltinDesigners } from './register-builtin-designers';
registerBuiltinDesigners();

beforeEach(() => {
  stored = STORED;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.withPreviewDrafts.mockImplementation(() => mockClient);
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
});

async function openAction(): Promise<HTMLElement> {
  render(
    <MemoryRouter initialEntries={['/metadata/action/sign_contract']}>
      <MetadataResourceEditPage type="action" name="sign_contract" />
    </MemoryRouter>,
  );
  // The designer branch opens editable: its panel is the inspector itself.
  return screen.findByTestId('action-served-rows', {}, { timeout: 8000 });
}

describe('the action full-page editor draws refusals and texts from their served rows (objectstack#35650)', () => {
  it('draws each as the key-only record control with the served help text, and no raw JSON', async () => {
    const rows = await openAction();
    expect(within(rows).getByText(servedHelpText('refusals'))).toBeInTheDocument();
    expect(within(rows).getByText(servedHelpText('texts'))).toBeInTheDocument();
    // The key-only control draws each entry under its key.
    expect(within(rows).getByText('SIGN_IN_REQUIRED', { selector: 'span' })).toBeInTheDocument();
    expect(within(rows).getByText('email_subject', { selector: 'span' })).toBeInTheDocument();
    // No editor anywhere on the page holds either record as JSON text.
    const jsonHolders = Array.from(document.querySelectorAll('textarea')).filter(
      (el) => el.value.includes('"SIGN_IN_REQUIRED"') || el.value.includes('"email_subject"'),
    );
    expect(jsonHolders).toEqual([]);
  });

  it('an entry edited through the served row saves as a spec-valid action', async () => {
    const rows = await openAction();
    fireEvent.click(within(rows).getByText('email_subject', { selector: 'span' }));
    const entry = within(rows).getByText('email_subject', { selector: 'span' }).closest('.rounded-md') as HTMLElement;
    fireEvent.change(within(entry).getByDisplayValue('Contract signed'), { target: { value: 'Your contract is signed' } });
    await waitFor(() => expect(screen.getByTestId('resource-save')).toBeEnabled(), { timeout: 4000 });
    fireEvent.click(screen.getByTestId('resource-save'));
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 6000 });
    const body = JSON.parse(JSON.stringify(mockClient.save.mock.calls[0]![2])) as Record<string, unknown>;
    expect(body.texts).toEqual({ email_subject: { message: 'Your contract is signed' } });
    expect(body.refusals).toEqual(STORED.refusals);
    const parsed = ActionSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
