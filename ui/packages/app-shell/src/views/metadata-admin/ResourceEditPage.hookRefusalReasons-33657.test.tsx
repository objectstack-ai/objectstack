// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MEASUREMENT (objectstack#33657) — the Studio hook form against a refusal
 * catalogue that declares `reasons` and `params`, through the real edit page.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { HookSchema, hookForm } from '@objectstack/spec/data';

import '@objectstack/formula';
import '@objectstack/lint';

const HOOK_JSON_SCHEMA = z.toJSONSchema(HookSchema as unknown as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

const STORED_HOOK = {
  name: 'sign_contract',
  label: 'Sign contract',
  object: 'contract',
  events: ['beforeUpdate'],
  body: { language: 'js', source: "throw { code: 'CONTRACT_LOCKED', reason: 'plan_locked', params: { state: 'x' } };" },
  refusals: {
    CONTRACT_LOCKED: {
      message: 'This contract is locked ({{ state }}).',
      status: 409,
      params: ['state'],
      reasons: { plan_locked: { message: 'The plan is locked while {{ state }}.' } },
    },
  },
};

let stored: Record<string, unknown> = STORED_HOOK;
const FORM: { current: unknown } = { current: hookForm };
function withReasons(): unknown {
  const clone = JSON.parse(JSON.stringify(hookForm));
  for (const s of clone.sections) for (const f of s.fields) if (f.field === 'refusals') {
    f.fields.push({ field: 'reasons', type: 'record', widget: 'key-only-record', fields: [{ field: 'message', type: 'textarea', required: true }] });
    f.fields.push({ field: 'params', type: 'tags' });
  }
  return clone;
}

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: stored, code: null, editable: true, deletable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => stored),
  save: vi.fn(async (_t: string, _n: string, item: unknown) => {
    stored = item as Record<string, unknown>;
    return {};
  }),
  saveDraft: vi.fn(async () => ({})),
  publish: vi.fn(async () => ({ success: true })),
  references: vi.fn(async () => []),
  history: vi.fn(async () => []),
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMetadata')>()),
  useMetadataClient: () => mockClient,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [
      {
        type: 'hook',
        name: 'hook',
        label: 'Hook',
        domain: 'data',
        allowEnvironmentOverlay: true,
        allowRuntimeCreate: true,
        schema: HOOK_JSON_SCHEMA,
        form: FORM.current,
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
import './register-builtins';
import { registerBuiltinDesigners } from './register-builtin-designers';
registerBuiltinDesigners();

beforeEach(() => {
  stored = STORED_HOOK;
  FORM.current = hookForm;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
});

describe('MEASURE', () => {
  it('what the refusal entry offers, and what a label edit saves', async () => {
    render(
      <MemoryRouter initialEntries={['/metadata/hook/sign_contract']}>
        <MetadataResourceEditPage type="hook" name="sign_contract" />
      </MemoryRouter>,
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }, { timeout: 8000 }))[0]);
    fireEvent.click(await screen.findByText('CONTRACT_LOCKED'));
    const group = screen.getByText('CONTRACT_LOCKED').closest('.rounded-md') as HTMLElement;
    const labels = Array.from(group.querySelectorAll('label')).map((l) => l.textContent);
    console.log('MEASURE entry labels:', JSON.stringify(labels));
    const label = document.getElementById('mdf-label') as HTMLInputElement;
    fireEvent.change(label, { target: { value: 'Sign the contract' } });
    fireEvent.click(screen.getByTestId('resource-save'));
    await waitFor(() => expect(mockClient.save.mock.calls.length + mockClient.saveDraft.mock.calls.length).toBeGreaterThan(0));
    console.log('MEASURE save calls:', JSON.stringify(mockClient.save.mock.calls.map((c) => c[2])));
    console.log('MEASURE saveDraft calls:', JSON.stringify(mockClient.saveDraft.mock.calls));
  });

  it('editing the entry message keeps reasons/params', async () => {
    render(
      <MemoryRouter initialEntries={['/metadata/hook/sign_contract']}>
        <MetadataResourceEditPage type="hook" name="sign_contract" />
      </MemoryRouter>,
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }, { timeout: 8000 }))[0]);
    fireEvent.click(await screen.findByText('CONTRACT_LOCKED'));
    fireEvent.change(screen.getByDisplayValue('This contract is locked ({{ state }}).'), { target: { value: 'Locked ({{ state }}).' } });
    fireEvent.click(screen.getByTestId('resource-save'));
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled());
    console.log('MEASURE2 refusals:', JSON.stringify((mockClient.save.mock.calls[0][2] as any).refusals));
  });
  it('renderer with a nested key-only record + tags row', async () => {
    FORM.current = withReasons();
    render(
      <MemoryRouter initialEntries={['/metadata/hook/sign_contract']}>
        <MetadataResourceEditPage type="hook" name="sign_contract" />
      </MemoryRouter>,
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }, { timeout: 8000 }))[0]);
    fireEvent.click(await screen.findByText('CONTRACT_LOCKED'));
    const group = screen.getByText('CONTRACT_LOCKED').closest('.rounded-md') as HTMLElement;
    console.log('MEASURE3 labels:', JSON.stringify(Array.from(group.querySelectorAll('label')).map((l) => l.textContent)));
    console.log('MEASURE3 has plan_locked:', !!screen.queryByText('plan_locked'));
    console.log('MEASURE3 placeholders:', JSON.stringify(Array.from(group.querySelectorAll('input')).map((i) => [i.placeholder, i.value, i.id])));
    const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
    console.log('MEASURE3 dup ids:', JSON.stringify(ids.filter((x, i) => ids.indexOf(x) !== i)));
  });
});
