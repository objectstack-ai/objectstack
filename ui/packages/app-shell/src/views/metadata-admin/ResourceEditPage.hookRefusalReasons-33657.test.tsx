// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio hook editor authors a refusal's `reasons` and `params`
 * (objectstack#33657), through the real edit page.
 *
 * A refusal entry is `{ message, status?, reasons?, params? }`
 * (`HookRefusalSchema`): `reasons` is keyed by the snake_case reason the body
 * throws beside the code, each `{ message }`, and `params` names the holes its
 * sentences may fill. The hook form offers both on the entry: `reasons` takes
 * the key-only record control one level down, `params` the name list.
 *
 * The REAL page with the production registrations: `hook` has no designer, so
 * the page takes its generic-form branch and renders the form the server
 * serves for the type. The type row here is that row built from the spec the
 * way the server builds it: `hookForm` as the form, and `HookSchema` converted
 * with `z.toJSONSchema(…, { io: 'input' })` as the schema. The only stand-ins
 * are the metadata client (the "server" a save writes to and a reload reads
 * back) and the code editor's loader.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { HookSchema, hookForm } from '@objectstack/spec/data';

// Module-scope imports of the engines the page reaches through dynamic
// `import()` (the condition row's CEL authoring and the save-time lint), per
// AGENTS.md's flaky-test rule: a cold first load stays out of every `waitFor`.
import '@objectstack/formula';
import '@objectstack/lint';

/** The `hook` row's `schema`, converted from the spec the way the server does. */
const HOOK_JSON_SCHEMA = z.toJSONSchema(HookSchema as unknown as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

const BASE = {
  name: 'sign_contract',
  label: 'Sign contract',
  object: 'contract',
  events: ['beforeUpdate'],
  body: { language: 'js', source: "throw { code: 'CONTRACT_LOCKED' };" },
};

/** A catalogue that uses both parts, as code would declare it. */
const WITH_REASONS = {
  ...BASE,
  refusals: {
    CONTRACT_LOCKED: {
      message: 'This contract is locked ({{ state }}).',
      status: 409,
      params: ['state'],
      reasons: { plan_locked: { message: 'The plan is locked while {{ state }}.' } },
    },
  },
};

/** The control: a refusal that declares only what the form offered before. */
const PLAIN = {
  ...BASE,
  refusals: { CONTRACT_LOCKED: { message: 'This contract is locked.', status: 409 } },
};

/** What the last accepted save stored — the "server" a reload reads back. */
let stored: Record<string, unknown> = PLAIN;

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
        form: hookForm,
      },
    ],
  }),
}));
// The body's code editor falls back to its plain textarea when Monaco's loader
// rejects — the shape an offline install gets.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});
vi.mock('@object-ui/plugin-editor', () => ({ configureBundledMonaco: () => Promise.resolve() }));
// The page's own side reads go through the global `fetch`; one double answers
// "absent" for the whole file, so no read reaches a socket.
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
  stored = PLAIN;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
});

/** Open the stored hook, enter edit mode, and open its one refusal entry. */
async function openRefusal(): Promise<HTMLElement> {
  render(
    <MemoryRouter initialEntries={['/metadata/hook/sign_contract']}>
      <MetadataResourceEditPage type="hook" name="sign_contract" />
    </MemoryRouter>,
  );
  // The page renders Edit twice (header and toolbar); either enters edit mode.
  fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }, { timeout: 8000 }))[0]!);
  fireEvent.click(await screen.findByText('CONTRACT_LOCKED', { selector: 'span' }));
  return screen.getByText('CONTRACT_LOCKED', { selector: 'span' }).closest('.rounded-md') as HTMLElement;
}

/** Save, and hand back the body the page sent. */
async function save(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByTestId('resource-save'));
  await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1));
  return JSON.parse(JSON.stringify(mockClient.save.mock.calls[0]![2])) as Record<string, unknown>;
}

/** The card of one reason inside a refusal entry's card. */
function reasonCard(entry: HTMLElement, reason: string): HTMLElement {
  return within(entry).getByText(reason, { selector: 'span' }).closest('.rounded-md') as HTMLElement;
}

describe('the Studio hook editor authors a refusal\'s reasons and params (objectstack#33657)', () => {
  it('offers Reasons and Params on a refusal entry, beside Message and Status', async () => {
    const card = await openRefusal();
    const labels = Array.from(card.querySelectorAll('label')).map((l) => l.textContent?.replace(/\*$/, ''));
    expect(labels).toEqual(['Key', 'Message', 'Status', 'Reasons', 'Params']);
  });

  it('authors a reason and a param, saves them, and the stored hook reads them back', async () => {
    const card = await openRefusal();
    // The entry's own reasons control: its add box sits inside the entry's card.
    fireEvent.change(within(card).getByPlaceholderText('Key'), { target: { value: 'plan_locked' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
    const messages = within(card).getAllByLabelText(/Message/);
    fireEvent.change(messages[1]!, { target: { value: 'The plan is locked while {{ state }}.' } });
    const params = within(card).getByLabelText(/Params/);
    fireEvent.change(params, { target: { value: 'state' } });
    fireEvent.keyDown(params, { key: 'Enter' });

    const body = await save();
    expect(body.refusals).toEqual({
      CONTRACT_LOCKED: {
        message: 'This contract is locked.',
        status: 409,
        reasons: { plan_locked: { message: 'The plan is locked while {{ state }}.' } },
        params: ['state'],
      },
    });
    const parsed = HookSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    // Read the stored hook back: a fresh page over what the save stored.
    cleanup();
    const reloaded = await openRefusal();
    fireEvent.click(within(reloaded).getByText('plan_locked', { selector: 'span' }));
    expect(within(reloaded).getByDisplayValue('The plan is locked while {{ state }}.')).toBeInTheDocument();
    expect(within(reloaded).getByText('state', { selector: 'span' })).toBeInTheDocument();
  });

  it('a catalogue that uses reasons and params round-trips a Studio edit of another field unchanged', async () => {
    stored = WITH_REASONS;
    await openRefusal();
    fireEvent.change(document.getElementById('mdf-label') as HTMLInputElement, { target: { value: 'Sign the contract' } });
    const body = await save();
    expect(body).toEqual({ ...WITH_REASONS, label: 'Sign the contract' });
  });

  // An empty `reasons` is not an absent one: under `reasons: {}` every reason
  // the body throws is refused (at save when literal, at run time otherwise),
  // while an absent `reasons` does not read a thrown reason at all. Both draw
  // the same empty list, so removing the last reason must leave it absent.
  it('removing the only reason leaves the entry with no reasons, not an empty one', async () => {
    const card = await openRefusal();
    fireEvent.change(within(card).getByPlaceholderText('Key'), { target: { value: 'plan_locked' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
    fireEvent.click(within(reasonCard(card, 'plan_locked')).getByRole('button', { name: 'Remove' }));
    // Add-then-remove alone returns the draft to what is stored, so the page
    // has nothing to save; an edit elsewhere makes the save happen.
    fireEvent.change(document.getElementById('mdf-label') as HTMLInputElement, { target: { value: 'Sign the contract' } });

    const body = await save();
    expect(body.refusals).toEqual({ CONTRACT_LOCKED: { message: 'This contract is locked.', status: 409 } });
    expect(Object.keys((body.refusals as Record<string, object>).CONTRACT_LOCKED)).toEqual(['message', 'status']);
  });

  it('removing the last stored reason leaves reasons absent too', async () => {
    stored = WITH_REASONS;
    const card = await openRefusal();
    fireEvent.click(within(reasonCard(card, 'plan_locked')).getByRole('button', { name: 'Remove' }));

    const body = await save();
    const { reasons: _dropped, ...rest } = WITH_REASONS.refusals.CONTRACT_LOCKED;
    expect(body.refusals).toEqual({ CONTRACT_LOCKED: rest });
  });

  it('CONTROL: removing one of two reasons stores the other, as before', async () => {
    stored = WITH_REASONS;
    const card = await openRefusal();
    fireEvent.change(within(card).getByPlaceholderText('Key'), { target: { value: 'plan_archived' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
    fireEvent.change(within(reasonCard(card, 'plan_archived')).getByLabelText(/Message/), {
      target: { value: 'The plan is archived.' },
    });
    fireEvent.click(within(reasonCard(card, 'plan_locked')).getByRole('button', { name: 'Remove' }));

    const body = await save();
    expect(body.refusals).toEqual({
      CONTRACT_LOCKED: {
        ...WITH_REASONS.refusals.CONTRACT_LOCKED,
        reasons: { plan_archived: { message: 'The plan is archived.' } },
      },
    });
  });

  // The same rule one level up: `refusals: {}` declares a catalogue with no
  // codes (every code the body throws is refused), an absent one leaves the
  // hook's throws answered as they always were.
  it('removing the only refusal code leaves the hook with no catalogue, not an empty one', async () => {
    const card = await openRefusal();
    fireEvent.click(within(card).getAllByRole('button', { name: 'Remove' })[0]!);

    const body = await save();
    expect(body).not.toHaveProperty('refusals');
  });

  it('CONTROL: a refusal with only message and status saves exactly as it was', async () => {
    await openRefusal();
    fireEvent.change(document.getElementById('mdf-label') as HTMLInputElement, { target: { value: 'Sign the contract' } });
    const body = await save();
    expect(body).toEqual({ ...PLAIN, label: 'Sign the contract' });
    expect(Object.keys((body.refusals as Record<string, object>).CONTRACT_LOCKED)).toEqual(['message', 'status']);
  });
});
