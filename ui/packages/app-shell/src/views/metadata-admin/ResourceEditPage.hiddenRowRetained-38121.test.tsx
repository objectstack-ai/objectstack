// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#38121 — a form row hidden by its `visibleWhen` stays drawn while
 * its key holds a value.
 *
 * The hook form shows `refusals` only where `HookSchema` accepts it (a `js`
 * body, or a handler with no body). An author who filled a refusal on a `js`
 * body and then switched the body to `expression` used to see the row vanish
 * while its value stayed in the draft, so the save was refused at a key the
 * form no longer drew. The row now stays, says its value is not in effect, and
 * offers a one-click clear; nothing is dropped without that click
 * (objectui#6499, Option C — the stored-value re-show rule).
 *
 *   (a) fill a refusal, switch to `expression`: the row is still drawn with the
 *       notice; clear it and the save is accepted, with no `refusals` key;
 *   (b) CONTROL — the same, saved without clearing: the server's refusal is
 *       drawn on the `refusals` row, which the author can see;
 *   (c) CONTROL — a hidden row that never held a value stays hidden.
 *
 * The REAL page with the served `hookForm` and the served derivation of
 * `HookSchema`. The client's `save` is the server's verdict: `HookSchema`
 * itself, refusing with a real parsed `MetadataError` (the client's own error
 * parse over a stub transport). The live client pass is stubbed clean, so
 * every issue on screen is the server's.
 */

import '@testing-library/jest-dom/vitest';
// The form reaches these through dynamic `import()`; pay that load at
// collection, never inside a case's clocked window.
import '@objectstack/formula';
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { HookSchema } from '@objectstack/spec/data';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';
import { t } from './i18n';

const NOTICE = t('engine.form.inactiveRetained', 'en-US');
const CLEAR = t('engine.form.inactiveRetainedClear', 'en-US');

const HOOK_JSON_SCHEMA = z.toJSONSchema(HookSchema as unknown as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

const JS_HOOK = {
  name: 'credit_guard',
  object: 'order',
  events: ['beforeInsert'],
  body: { language: 'js', source: 'return;' },
};

/** The server's refusal of `body`, as the real client parses it. */
async function refusalOf(issues: z.core.$ZodIssue[]): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(
        JSON.stringify({
          error: `[invalid_metadata] hook/credit_guard failed spec validation: ${issues.length} issue(s)`,
          code: 'INVALID_METADATA',
          issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  });
  try {
    await client.save('hook', 'credit_guard', {});
  } catch (e) {
    return e as MetadataError;
  }
  throw new Error('the stub transport accepted the save: there is no refusal to hand the page');
}

const stored = vi.hoisted(() => ({ hook: {} as Record<string, unknown> }));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: stored.hook, code: stored.hook, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  saveDraft: vi.fn(async () => ({})),
  save: vi.fn(async (_type: string, _name: string, _body: Record<string, unknown>) => ({})),
}));

const served = vi.hoisted(() => ({ schema: undefined as unknown, form: undefined as unknown }));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        {
          type: 'hook',
          name: 'hook',
          label: 'Hook',
          allowEnvironmentOverlay: true,
          schema: served.schema,
          form: served.form,
        },
      ],
    }),
  };
});

// A validator exists and finds nothing: every issue on screen is the server's.
vi.mock('./clientValidation', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./clientValidation')>();
  return {
    ...mod,
    hasClientValidator: () => true,
    validateMetadataDraft: async () => ({ ok: true, issues: [] }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';

served.schema = HOOK_JSON_SCHEMA;
served.form = METADATA_FORM_REGISTRY.hook;

beforeEach(() => {
  vi.clearAllMocks();
  stored.hook = JS_HOOK;
  // The server: `HookSchema` accepts the body, or refuses it at its paths.
  mockClient.save.mockImplementation(async (_type, _name, body) => {
    const parsed = HookSchema.safeParse(body);
    if (parsed.success) return {};
    throw await refusalOf(parsed.error.issues);
  });
});
afterEach(() => cleanup());

const saveButton = () => screen.getByTestId('resource-save');
const savedBodies = () => mockClient.save.mock.calls.map((c) => c[2] as Record<string, unknown>);
const refusalsLabel = () => screen.queryByText('Refusals', { selector: 'label' });

/** Open a Radix Select trigger the way the other suites in this repo do. */
async function openSelect(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
}

async function openEditor() {
  render(
    <MemoryRouter initialEntries={['/metadata/hook/credit_guard']}>
      <MetadataResourceEditPage type="hook" name="credit_guard" />
    </MemoryRouter>,
  );
  // The header and the read-only body both offer Edit; either enters editing.
  fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }, { timeout: 8000 }))[0]!);
  await waitFor(() => expect(refusalsLabel()).toBeInTheDocument());
}

/** Declare one refusal through the catalogue's own key-only control. */
function fillRefusal() {
  // `refusals` comes before `texts` in the form, so its add box is the first.
  fireEvent.change(screen.getAllByPlaceholderText('Key')[0]!, { target: { value: 'CREDIT_LIMIT' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
  fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'This order exceeds the credit limit.' } });
}

async function switchToExpression() {
  await openSelect(screen.getByRole('combobox', { name: /Language/ }));
  fireEvent.click(screen.getByRole('option', { name: 'Expression (L1)' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: /Language/ })).toHaveTextContent('Expression (L1)'));
}

async function save() {
  // Past the live pass's 200 ms debounce, so it cannot land after the verdict.
  await new Promise((r) => setTimeout(r, 400));
  fireEvent.click(saveButton());
  await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 6000 });
}

describe('a row hidden by visibleWhen keeps showing a value it holds (objectstack#38121)', () => {
  it('(a) fill, switch to expression, clear, save: the save is accepted', async () => {
    await openEditor();
    fillRefusal();
    await switchToExpression();

    // The row is still drawn, and says its value is not in effect.
    expect(refusalsLabel()).toBeInTheDocument();
    const notice = screen.getByTestId('schema-form-inactive-retained');
    expect(notice).toHaveTextContent(NOTICE);

    fireEvent.click(screen.getByRole('button', { name: CLEAR }));
    // Cleared, the row is hidden like any row its predicate rejects.
    await waitFor(() => expect(refusalsLabel()).not.toBeInTheDocument());
    expect(screen.queryByTestId('schema-form-inactive-retained')).toBeNull();

    await save();
    const [body] = savedBodies();
    expect(body).not.toHaveProperty('refusals');
    expect(body!.body).toMatchObject({ language: 'expression' });
    expect(HookSchema.safeParse(body).success, 'the server accepts what the page sent').toBe(true);
    await expect(mockClient.save.mock.results[0]!.value).resolves.toEqual({});
    expect(screen.queryAllByTestId('schema-form-issue')).toEqual([]);
  }, 30000);

  it('(b) CONTROL — saved without clearing, the refusal is drawn on the visible refusals row', async () => {
    await openEditor();
    fillRefusal();
    await switchToExpression();
    await save();

    expect(savedBodies()[0]).toHaveProperty('refusals.CREDIT_LIMIT');
    await expect(mockClient.save.mock.results[0]!.value).rejects.toBeDefined();
    // The refused key is a row the author sees, with the server's line under it.
    expect(refusalsLabel()).toBeInTheDocument();
    const row = refusalsLabel()!.closest('.space-y-1\\.5') as HTMLElement;
    await waitFor(() => expect(row.querySelector('[data-testid="schema-form-issue"]')).not.toBeNull(), { timeout: 6000 });
    expect(row.querySelector('[data-testid="schema-form-inactive-retained"]')).not.toBeNull();
  }, 30000);

  it('(c) CONTROL — a row whose predicate is false and that holds no value stays hidden', async () => {
    await openEditor();
    await switchToExpression();
    expect(refusalsLabel()).not.toBeInTheDocument();
    expect(screen.queryByText('Texts', { selector: 'label' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('schema-form-inactive-retained')).toBeNull();
  }, 30000);
});
