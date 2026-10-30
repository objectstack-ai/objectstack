/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27999 — a page-mode save whose answer carries
 * advisory warnings (a `severity: 'warning'` validation rule) shows ONE toast:
 * the record-named save message (objectstack-ai/objectstack#26461), carrying
 * the warning lines. The write-warning channel's "Saved — with warnings" toast
 * is not raised for that write; its stripped-fields notice still is, and a
 * write the page did not make keeps the channel toast.
 *
 * The form is a stand-in whose button does what the real chain does, in its
 * order: the adapter emits the write-warning event INSIDE the write (here the
 * channel's `emitWriteWarning`, called with the adapter as `AdapterProvider`
 * calls it, and not awaited), then `ObjectForm` hands the write's result to
 * `schema.onSuccess`. The channel's sink and the page's toast are the same
 * sonner `toast`, so every toast the user would see is counted.
 *
 * Direction, written before the run: with the channel ignoring the page's
 * claim, every "one toast" cell RED (a second "Saved — with warnings" toast, and
 * a success toast carrying no warning line); the CONTROL cells GREEN on both
 * sides.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import type { WriteWarningEvent } from '@object-ui/data-objectstack';
import { emitWriteWarning } from '../providers/writeWarningToast';
import { RecordFormPage } from './RecordFormPage';

const h = React.createElement;

const { toastSuccess, toastWarning, saveState, ADAPTER } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  saveState: { event: undefined as unknown, saved: undefined as Record<string, unknown> | undefined },
  ADAPTER: { getObjectSchema: async () => ({ fields: {} as Record<string, { label?: string }> }) },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: toastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    warning: toastWarning,
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
}));

/** The channel's translator: the English default, interpolated. */
const t = (_key: string, opts?: Record<string, unknown>) =>
  String(opts?.defaultValue ?? '').replace('{{fields}}', String(opts?.fields ?? ''));
const identityLabel = (_o: string, _f: string, fallback: string) => fallback;

/** Every channel run the stand-in started, so a test can let them settle. */
const pending: Promise<void>[] = [];

// The write, then `onSuccess` with its result — the channel run is NOT awaited
// in between, as the adapter's listener does not await it either.
vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  const { toast } = await import('sonner');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    ObjectForm: ({ schema }: { schema: { onSuccess?: (saved?: unknown) => void } }) =>
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'fire-success',
          onClick: () => {
            if (saveState.event) {
              pending.push(emitWriteWarning(saveState.event as WriteWarningEvent, t, ADAPTER, identityLabel, toast));
            }
            schema.onSuccess?.(saveState.saved);
          },
        },
        'ok',
      ),
  };
});

const TASK = {
  name: 'showcase_task',
  label: 'Task',
  nameField: 'subject',
  fields: { subject: { type: 'text', label: 'Subject' }, done: { type: 'boolean', label: 'Done' } },
};
const METADATA = { objects: [TASK], loading: false };
vi.mock('../providers/MetadataProvider', () => ({
  useMetadata: () => METADATA,
}));
vi.mock('../providers/AdapterProvider', () => ({
  useAdapter: () => ADAPTER,
}));

const ADVISORY = {
  field: 'subject',
  code: 'validation_rule',
  message: 'Reviews are usually scheduled a week ahead',
  rule: 'review_lead_time',
  severity: 'warning' as const,
};
const SECOND = { ...ADVISORY, field: 'done', rule: 'done_owner', message: 'Done tasks usually name an owner' };
const NAMED = { id: 't1', subject: 'Quarterly review' };

beforeEach(() => {
  toastSuccess.mockClear();
  toastWarning.mockClear();
  pending.length = 0;
  saveState.event = undefined;
  saveState.saved = undefined;
});
afterEach(cleanup);

/** Mount the page in `mode`, save through the form with `event` emitted by the write, and settle. */
async function saveOn(mode: 'create' | 'edit', event: WriteWarningEvent, saved: Record<string, unknown>) {
  saveState.event = event;
  saveState.saved = saved;
  const path =
    mode === 'create' ? '/apps/crm/showcase_task/new' : '/apps/crm/showcase_task/record/t1/edit';
  const route =
    mode === 'create'
      ? '/apps/:appName/:objectName/new'
      : '/apps/:appName/:objectName/record/:recordId/edit';
  render(
    h(I18nProvider, {
      config: { defaultLanguage: 'en', detectBrowserLanguage: false },
      children: h(
        MemoryRouter,
        { initialEntries: [path] },
        h(Routes, null, h(Route, { path: route, element: h(RecordFormPage, { mode }) })),
      ),
    }),
  );
  fireEvent.click(screen.getByTestId('fire-success'));
  await waitFor(() => expect(toastSuccess.mock.calls.length + toastWarning.mock.calls.length).toBeGreaterThan(0));
  await Promise.all(pending);
}

const update = (over: Partial<WriteWarningEvent> = {}): WriteWarningEvent => ({
  operation: 'update',
  resource: 'showcase_task',
  id: 't1',
  droppedFields: [],
  warnings: [ADVISORY],
  ...over,
});

describe('RecordFormPage — a save with warnings shows one record-named toast (objectstack-ai/objectstack#27999)', () => {
  it('update: one toast, the record-named message carrying the warning line', async () => {
    await saveOn('edit', update(), NAMED);

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning.mock.calls).toEqual([
      ['Task "Quarterly review" updated', { description: ADVISORY.message }],
    ]);
  });

  it('create: one toast, each distinct warning on its own line', async () => {
    await saveOn(
      'create',
      { operation: 'create', resource: 'showcase_task', id: 't1', droppedFields: [], warnings: [ADVISORY, SECOND, ADVISORY] },
      NAMED,
    );

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning.mock.calls).toEqual([
      ['Task "Quarterly review" created', { description: `${ADVISORY.message}\n${SECOND.message}` }],
    ]);
  });

  it('the stripped-fields notice keeps its own toast beside the save toast', async () => {
    await saveOn(
      'edit',
      update({ droppedFields: [{ object: 'showcase_task', fields: ['done'], reason: 'readonly' }] }),
      NAMED,
    );

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning.mock.calls.map(([title]) => title)).toEqual([
      'Task "Quarterly review" updated',
      'Saved — but some fields did not take effect',
    ]);
    expect(toastWarning.mock.calls[0][1]).toEqual({ description: ADVISORY.message });
  });

  it('CONTROL: a write the page did not make keeps the channel toast, and the save toast stays a success', async () => {
    await saveOn('edit', update({ resource: 'showcase_project', id: 'p1' }), NAMED);

    expect(toastSuccess.mock.calls).toEqual([['Task "Quarterly review" updated']]);
    expect(toastWarning.mock.calls).toEqual([['Saved — with warnings', { description: ADVISORY.message }]]);
  });

  it('CONTROL: a save without warnings is the success toast it always was', async () => {
    await saveOn('edit', update({ warnings: undefined, droppedFields: [] }), NAMED);

    expect(toastSuccess.mock.calls).toEqual([['Task "Quarterly review" updated']]);
    expect(toastWarning).not.toHaveBeenCalled();
  });
});
