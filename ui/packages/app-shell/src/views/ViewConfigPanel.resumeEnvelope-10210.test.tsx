// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * objectui#10210 — reopening the view config panel on a view with a pending
 * draft resumes that draft into the editor, and the next Save must still be
 * addressed to the view.
 *
 * The view-config save now stores a ViewItem envelope `{ name, object,
 * viewKind, label, config }`. The resume used to read every stored draft as the
 * flat runtime view, so an envelope lost its identity on the way in: the panel
 * then handed its host a draft with no `id`, and the host's save persisted
 * nothing (it logs "Cannot persist view config" and returns). A draft saved
 * before the fix is still flat on the server; that one must keep resuming.
 *
 * objectstack#35054 moved the resume: the panel reads the stored draft itself,
 * from the layered read's `draft` layer, instead of taking the draft bar's
 * served (translated) draft. The pending draft still enters the buffer with
 * its identity, through the same `storedViewToRuntimeView` reading.
 */

// Only its props matter here: the panel no longer hands it a resume.
const draftBarProps = vi.fn();
vi.mock('./RuntimeDraftBar', () => ({
  RuntimeDraftBar: (props: Record<string, unknown>) => {
    draftBarProps(props);
    return null;
  },
}));

// A light stand-in for the spec-driven inspector: one control that edits the
// label the way the real inspector's label field does, one that adds a column,
// and the label it was handed.
vi.mock('./metadata-admin/inspectors/ViewVariantInspector', () => ({
  ViewVariantInspector: ({ draft, onPatch }: any) => (
    <div>
      <span data-testid="mock-inspector-shown-label">{String(draft?.label)}</span>
      <button
        type="button"
        data-testid="mock-inspector-label"
        onClick={() => onPatch({ label: 'Renamed', config: { ...(draft?.config ?? {}), label: 'Renamed' } })}
      >
        edit
      </button>
      <button
        type="button"
        data-testid="mock-inspector-columns"
        onClick={() =>
          onPatch({ config: { ...(draft?.config ?? {}), columns: [...(draft?.config?.columns ?? []), { field: 'owner' }] } })
        }
      >
        add column
      </button>
    </div>
  ),
}));

// The panel's source reaches dynamic imports of `@objectstack/lint` and
// `@objectstack/formula` (through the inspector, mocked here): pay their load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import '@objectstack/formula';
import { ViewConfigPanel } from './ViewConfigPanel';
import { buildViewConfigSaveBody } from './objectViewTabs';

const VIEW_ID = 'crm_lead.all';

/** The view as its author stored it (en source), a ViewItem envelope. */
const SOURCE = {
  name: VIEW_ID,
  object: 'crm_lead',
  viewKind: 'list',
  label: 'Everything',
  config: { type: 'grid', columns: [{ field: 'name' }], data: { provider: 'object', object: 'crm_lead' } },
};

/** The same view as the zh-CN read serves it: translated, with a read decoration. */
function served<T extends { label: string }>(doc: T): T & { _packageId: string } {
  return { ...doc, label: '全部线索', _packageId: 'com.acme.crm' };
}

/**
 * A metadata client whose served draft read (`getDraft`, objectstack#36137)
 * answers the translated envelope, and whose layered read serves the stored
 * view: `draft` the pending draft as stored (`undefined`: no `draft` key at all).
 */
function makeClient(opts: { draft: Record<string, unknown> | null | undefined; servedDraft?: boolean }) {
  const layers: Record<string, unknown> = { code: null, overlay: SOURCE, overlayScope: 'env', effective: SOURCE };
  if (opts.draft !== undefined) layers.draft = opts.draft;
  const pending = opts.servedDraft ?? !!opts.draft;
  return {
    layered: vi.fn(async () => layers),
    getDraft: vi.fn(async () =>
      pending ? { type: 'view', name: VIEW_ID, item: served((opts.draft ?? SOURCE) as typeof SOURCE) } : null,
    ),
  };
}

function renderPanel(client: unknown, onSave: (draft: Record<string, any>) => void) {
  render(
    <ViewConfigPanel
      open
      onClose={vi.fn()}
      mode="edit"
      // The host's view, from the served (translated) list.
      activeView={{ id: VIEW_ID, label: '全部线索', type: 'grid', columns: [{ field: 'name' }] as any }}
      objectDef={{ name: 'crm_lead', fields: { name: { label: 'Name', type: 'text' } } }}
      onSave={onSave}
      metadataClient={client}
    />,
  );
}

async function editAndSave(control: 'mock-inspector-label' | 'mock-inspector-columns') {
  fireEvent.click(await screen.findByTestId(control));
  fireEvent.click(screen.getByTestId('view-config-save'));
}

describe('ViewConfigPanel — resuming a pending draft (objectui#10210)', () => {
  beforeEach(() => {
    draftBarProps.mockClear();
  });

  it('a stored ViewItem envelope resumes with its identity, so Save is addressed to the view', async () => {
    const storedDraft = {
      name: VIEW_ID,
      object: 'crm_lead',
      viewKind: 'list',
      label: 'Everything EDITED',
      isDefault: true,
      config: { type: 'grid', columns: [{ field: 'name' }, { field: 'stage' }], data: { provider: 'object', object: 'crm_lead' } },
    };
    const onSave = vi.fn();
    renderPanel(makeClient({ draft: storedDraft }), onSave);
    await editAndSave('mock-inspector-label');

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.id).toBe(VIEW_ID);
    expect(saved.label).toBe('Renamed');
    expect(saved.columns).toEqual([{ field: 'name' }, { field: 'stage' }]);
    expect(saved.isDefault).toBe(true);
    expect('config' in saved).toBe(false);
  });

  it('a flat draft saved before the fix still resumes', async () => {
    const storedDraft = { id: VIEW_ID, name: VIEW_ID, label: 'Everything EDITED', type: 'grid', columns: [{ field: 'stage' }] };
    const onSave = vi.fn();
    renderPanel(makeClient({ draft: storedDraft }), onSave);
    await editAndSave('mock-inspector-label');

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.id).toBe(VIEW_ID);
    expect(saved.columns).toEqual([{ field: 'stage' }]);
  });
});

describe('ViewConfigPanel edits the view as its author stored it (objectstack#35054)', () => {
  beforeEach(() => {
    draftBarProps.mockClear();
  });

  it('a zh-CN edit then save stores the source label, and the edited field changes', async () => {
    const client = makeClient({ draft: null });
    const onSave = vi.fn();
    renderPanel(client, onSave);
    await editAndSave('mock-inspector-columns');

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(client.layered).toHaveBeenCalledWith('view', VIEW_ID);
    // The body the host stages (`handleViewConfigSave` builds it with this).
    const body = buildViewConfigSaveBody('crm_lead', onSave.mock.calls[0][0]);
    expect(body.name).toBe(VIEW_ID);
    expect(body.label).toBe('Everything');
    // Control: the edit itself is what the save carries.
    expect((body.config as any).columns).toEqual([{ field: 'name' }, { field: 'owner' }]);
    expect(body).not.toHaveProperty('_packageId');
  });

  it('a pending draft is edited as stored, and the draft bar is handed no resume', async () => {
    const pending = { ...SOURCE, config: { ...SOURCE.config, columns: [{ field: 'stage' }] } };
    const onSave = vi.fn();
    renderPanel(makeClient({ draft: pending }), onSave);
    await editAndSave('mock-inspector-columns');

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const body = buildViewConfigSaveBody('crm_lead', onSave.mock.calls[0][0]);
    expect(body.label).toBe('Everything');
    expect((body.config as any).columns).toEqual([{ field: 'stage' }, { field: 'owner' }]);
    expect(draftBarProps.mock.calls.every(([props]) => props.onResume === undefined)).toBe(true);
  });

  it('a pending draft whose stored copy the layers do not serve opens no editor, and Save stays off', async () => {
    const onSave = vi.fn();
    renderPanel(makeClient({ draft: undefined, servedDraft: true }), onSave);

    expect(await screen.findByTestId('view-config-authored-refused')).toBeTruthy();
    expect(screen.queryByTestId('mock-inspector-columns')).toBeNull();
    expect((screen.getByTestId('view-config-save') as HTMLButtonElement).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a refused layered read opens no editor', async () => {
    const client = {
      ...makeClient({ draft: null }),
      layered: vi.fn(async () => {
        throw Object.assign(new Error('Layered read refused'), { status: 403 });
      }),
    };
    renderPanel(client, vi.fn());

    expect((await screen.findByTestId('view-config-authored-refused')).textContent).toContain('Layered read refused');
    expect(screen.queryByTestId('mock-inspector-columns')).toBeNull();
  });
});
