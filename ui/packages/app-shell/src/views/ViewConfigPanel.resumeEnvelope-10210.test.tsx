// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

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
 */

// The stored draft body the draft/publish chrome resumes into the panel.
let storedDraft: Record<string, unknown> | null = null;

vi.mock('./RuntimeDraftBar', () => ({
  RuntimeDraftBar: ({ onResume }: { onResume?: (body: Record<string, unknown>) => void }) => {
    useEffect(() => {
      if (storedDraft) onResume?.(storedDraft);
    }, [onResume]);
    return null;
  },
}));

// A light stand-in for the spec-driven inspector: one control that edits the
// label the way the real inspector's label field does.
vi.mock('./metadata-admin/inspectors/ViewVariantInspector', () => ({
  ViewVariantInspector: ({ draft, onPatch }: any) => (
    <button
      type="button"
      data-testid="mock-inspector-label"
      onClick={() => onPatch({ label: 'Renamed', config: { ...(draft?.config ?? {}), label: 'Renamed' } })}
    >
      edit
    </button>
  ),
}));

import { ViewConfigPanel } from './ViewConfigPanel';

const VIEW_ID = 'crm_lead.all';

function renderPanel(onSave: (draft: Record<string, any>) => void) {
  render(
    <ViewConfigPanel
      open
      onClose={vi.fn()}
      mode="edit"
      activeView={{ id: VIEW_ID, label: 'Everything', type: 'grid', columns: [{ field: 'name' }] as any }}
      objectDef={{ name: 'crm_lead', fields: { name: { label: 'Name', type: 'text' } } }}
      onSave={onSave}
      metadataClient={{}}
    />,
  );
  fireEvent.click(screen.getByTestId('mock-inspector-label'));
  fireEvent.click(screen.getByTestId('view-config-save'));
}

describe('ViewConfigPanel — resuming a pending draft (objectui#10210)', () => {
  beforeEach(() => {
    storedDraft = null;
  });

  it('a stored ViewItem envelope resumes with its identity, so Save is addressed to the view', () => {
    storedDraft = {
      name: VIEW_ID,
      object: 'crm_lead',
      viewKind: 'list',
      label: 'Everything EDITED',
      isDefault: true,
      config: { type: 'grid', columns: [{ field: 'name' }, { field: 'stage' }], data: { provider: 'object', object: 'crm_lead' } },
    };
    const onSave = vi.fn();
    renderPanel(onSave);

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved.id).toBe(VIEW_ID);
    expect(saved.label).toBe('Renamed');
    expect(saved.columns).toEqual([{ field: 'name' }, { field: 'stage' }]);
    expect(saved.isDefault).toBe(true);
    expect('config' in saved).toBe(false);
  });

  it('a flat draft saved before the fix still resumes', () => {
    storedDraft = { id: VIEW_ID, name: VIEW_ID, label: 'Everything EDITED', type: 'grid', columns: [{ field: 'stage' }] };
    const onSave = vi.fn();
    renderPanel(onSave);

    const saved = onSave.mock.calls[0][0];
    expect(saved.id).toBe(VIEW_ID);
    expect(saved.columns).toEqual([{ field: 'stage' }]);
  });
});
