// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35628 — a refused save's issues reach a type's registered
 * DEFAULT inspector, and each is said once (objectstack#27865):
 *
 *   1. the page hands the default inspector the issues its fallback form gets,
 *      and the inspector's inline register;
 *   2. the register carries PATH PREFIXES, so a form over a slice of the draft
 *      (the view variant's spec form over `config`) never claims a sibling
 *      key's issue for the banner to drop;
 *   3. a SchemaForm-backed inspector (action) draws a nested cause under its row;
 *   4. the view variant draws `label.*` under Label and `config.columns.*` under
 *      Columns; the object designer draws its basic rows' issues the same way.
 *
 * The real page and the real registered inspectors over a mock client whose
 * `save` rejects with a REAL parsed `MetadataError`. Only the canvases are
 * stubbed, so that a preview exists and no selection is emitted: the default
 * inspector is what fills the rail. The live pass is stubbed to "a validator
 * exists, the draft is clean", so every issue on screen is the server's.
 */

import '@testing-library/jest-dom/vitest';
// The source loads these lazily; pay that load at collection, not inside a
// case's clocked window.
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

const ITEMS: Record<string, Record<string, unknown>> = {
  view: {
    name: 'task_list',
    label: 'Tasks',
    object: 'task',
    viewKind: 'list',
    config: { type: 'grid', columns: [{ field: 'title' }], description: 'Open work' },
  },
  action: { name: 'approve', label: 'Approve', type: 'script', refresh: { mode: 'record' } },
  object: { name: 'task', label: 'Task', pluralLabel: 'Tasks' },
};

/** The action type's served schema: `refresh` is a key the action inspector does not curate. */
const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    type: { type: 'string' },
    refresh: { type: 'object', title: 'Refresh', properties: { mode: { type: 'string', title: 'Mode' } } },
  },
};

const current = { type: 'view' };

async function refusal(issues: Array<{ path: string; message: string }>): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(
        JSON.stringify({
          error: `[invalid_metadata] ${current.type} failed spec validation: ${issues.length} issue(s)`,
          code: 'INVALID_METADATA',
          issues: issues.map((i) => ({ ...i, code: 'custom' })),
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  });
  try {
    await client.save(current.type, 'x', {});
  } catch (e) {
    return e as MetadataError;
  }
  throw new Error('the stub transport accepted the save: there is no refusal to hand the page');
}

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: ITEMS[current.type], code: ITEMS[current.type], editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  withPreviewDrafts() {
    return this;
  },
  saveDraft: vi.fn(async () => ({})),
  save: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [
        { type: 'view', name: 'view', label: 'View', allowEnvironmentOverlay: true },
        { type: 'action', name: 'action', label: 'Action', allowEnvironmentOverlay: true, schema: ACTION_SCHEMA },
        { type: 'object', name: 'object', label: 'Object', allowEnvironmentOverlay: true },
      ],
    }),
  };
});

vi.mock('./clientValidation', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./clientValidation')>();
  return {
    ...mod,
    hasClientValidator: () => true,
    validateMetadataDraft: async () => ({ ok: true, issues: [] }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerBuiltinInspectors } from './inspectors';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';
import {
  getMetadataDefaultInspector,
  registerMetadataDefaultInspector,
  type MetadataDefaultInspectorProps,
} from './default-inspector-registry';

registerBuiltinInspectors();

function StubCanvas() {
  return <div data-testid="stub-canvas" />;
}
const TYPES = ['view', 'action', 'object'] as const;
const realPreviews = Object.fromEntries(TYPES.map((t) => [t, getMetadataPreview(t)]));
const realViewInspector = getMetadataDefaultInspector('view')!;

beforeEach(() => {
  vi.clearAllMocks();
  for (const t of TYPES) registerMetadataPreview(t, StubCanvas as never);
});
afterEach(() => {
  cleanup();
  for (const t of TYPES) if (realPreviews[t]) registerMetadataPreview(t, realPreviews[t]!);
  registerMetadataDefaultInspector('view', realViewInspector);
});

const saveButton = () => screen.getByTestId('resource-save');
const saveSays = () => {
  const btn = saveButton();
  const id = btn.getAttribute('aria-describedby');
  return (id ? document.getElementById(id)?.textContent : null) ?? btn.getAttribute('title') ?? '';
};
const rowLines = () => screen.queryAllByTestId('inspector-row-issue').map((el) => el.textContent);
const formLines = () => screen.queryAllByTestId('schema-form-issue').map((el) => el.textContent);

/** Open `type`'s editor, dirty it through `edit`, and Save into `issues`' refusal. */
async function refuseSave(
  type: (typeof TYPES)[number],
  edit: () => void,
  issues: Array<{ path: string; message: string }>,
) {
  current.type = type;
  mockClient.save.mockRejectedValue(await refusal(issues));
  render(
    <MemoryRouter initialEntries={[`/metadata/${type}/x`]}>
      <MetadataResourceEditPage type={type} name={String(ITEMS[type].name)} />
    </MemoryRouter>,
  );
  await screen.findByTestId('stub-canvas', {}, { timeout: 8000 });
  await waitFor(() => edit(), { timeout: 8000 });
  // Past the live pass's 200 ms debounce, so it cannot land after the refusal.
  await new Promise((r) => setTimeout(r, 400));
  await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 4000 });
  fireEvent.click(saveButton());
  await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 6000 });
  await waitFor(() => expect(saveSays()).toContain('The server refused this draft'), { timeout: 6000 });
}

const editLabel = (value: string) => () =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value } });

describe('step 1 — the page hands its default inspector the issues and the register', () => {
  it('passes the issues its fallback form gets, and drops from the banner only what the inspector reports drawing', async () => {
    const seen: MetadataDefaultInspectorProps[] = [];
    function Probe(props: MetadataDefaultInspectorProps) {
      seen.push(props);
      const { onInlineIssueFieldsChange } = props;
      React.useEffect(() => onInlineIssueFieldsChange?.(new Set(['label'])), [onInlineIssueFieldsChange]);
      return <input aria-label="Label" onChange={(e) => props.onPatch({ label: e.target.value })} />;
    }
    registerMetadataDefaultInspector('view', Probe);
    await refuseSave('view', editLabel('Open tasks'), [
      { path: 'label.not_a_locale', message: 'Unrecognized locale key' },
      { path: 'config.zz_unknown', message: 'Not a view key' },
    ]);
    await waitFor(() =>
      expect(seen.at(-1)?.issues?.map((i) => i.path)).toEqual(['label.not_a_locale', 'config.zz_unknown']),
    );
    // The host's own flag, as its fallback form gets it: an edit form never defers.
    expect(seen.at(-1)?.revealIssues).toBe(false);
    expect(typeof seen.at(-1)?.onInlineIssueFieldsChange).toBe('function');
    const banner = await screen.findByTestId('metadata-validation-banner');
    expect(banner).toHaveTextContent('Not a view key');
    expect(banner).not.toHaveTextContent('Unrecognized locale key');
  }, 20000);
});

describe('steps 2 and 4 — the view designer draws each cause under its row, once (objectstack#27865)', () => {
  it('draws label.* under Label, config.columns.* under Columns, a spec-form key under its row; no banner, no refusal line', async () => {
    await refuseSave('view', editLabel('Open tasks'), [
      { path: 'label.not_a_locale', message: 'Unrecognized locale key' },
      { path: 'label.not_a_locale', message: 'Invalid locale format' },
      { path: 'config.columns.0', message: 'Unknown column key' },
      { path: 'config.description', message: 'Bad description' },
    ]);
    await waitFor(() =>
      expect(rowLines()).toEqual([
        'Label → not_a_locale: Unrecognized locale key',
        'Label → not_a_locale: Invalid locale format',
        'Columns → #1: Unknown column key',
      ]),
    );
    expect(formLines()).toEqual(['Bad description']);
    for (const message of ['Unrecognized locale key', 'Invalid locale format', 'Unknown column key', 'Bad description']) {
      expect(screen.getAllByText(message, { exact: false })).toHaveLength(1);
    }
    expect(screen.queryByTestId('metadata-validation-banner')).toBeNull();
    expect(screen.queryByTestId('resource-edit-error')).toBeNull();
  }, 20000);

  it('keeps a variant key no row renders in the banner: the spec form over `config` never claims it', async () => {
    await refuseSave('view', editLabel('Open tasks'), [
      { path: 'config.columns.0', message: 'Unknown column key' },
      { path: 'config.zz_unknown', message: 'Not a view key' },
    ]);
    const banner = await screen.findByTestId('metadata-validation-banner', {}, { timeout: 6000 });
    expect(banner).toHaveTextContent('Not a view key');
    expect(banner).not.toHaveTextContent('Unknown column key');
    expect(rowLines()).toEqual(['Columns → #1: Unknown column key']);
  }, 20000);
});

describe('step 3 — a SchemaForm-backed inspector (action) draws a nested cause under its row (objectstack#27865)', () => {
  it('draws refresh.mode under Mode once, and repeats it in neither the banner nor the refusal line', async () => {
    await refuseSave('action', editLabel('Approve all'), [{ path: 'refresh.mode', message: 'Unknown refresh mode' }]);
    await waitFor(() => expect(formLines()).toEqual(['Unknown refresh mode']));
    expect(screen.getAllByText('Unknown refresh mode', { exact: false })).toHaveLength(1);
    expect(screen.queryByTestId('metadata-validation-banner')).toBeNull();
    expect(screen.queryByTestId('resource-edit-error')).toBeNull();
  }, 20000);
});

describe('step 4 — the object designer draws a basic row’s cause under it (objectstack#27865)', () => {
  it('draws label.* under Label once; a key no row edits stays in the banner', async () => {
    await refuseSave('object', editLabel('Work item'), [
      { path: 'label.not_a_locale', message: 'Unrecognized locale key' },
      { path: 'fields.title.type', message: 'Unknown field type' },
    ]);
    await waitFor(() => expect(rowLines()).toEqual(['Label → not_a_locale: Unrecognized locale key']));
    expect(screen.getAllByText('Unrecognized locale key', { exact: false })).toHaveLength(1);
    const banner = await screen.findByTestId('metadata-validation-banner');
    expect(banner).toHaveTextContent('Unknown field type');
    expect(banner).not.toHaveTextContent('Unrecognized locale key');
  }, 20000);
});
