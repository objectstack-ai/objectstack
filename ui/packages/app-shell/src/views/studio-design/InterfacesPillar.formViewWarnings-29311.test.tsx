// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29311 — a form view opened in Studio's Interfaces pillar hands
 * its canvas the view's served warnings, and never saves them.
 *
 * Since objectstack#29196 the view read serves a section that names a field
 * its object lacks as a `_diagnostics.warnings` entry (`{ path, message }`,
 * path `config.sections.N.fields.M`). The pillar's leaf load took the body
 * through `extractDraftBody`, which strips `_diagnostics` (a read decoration),
 * and handed the canvas no verdict, so the form view canvas had nothing to
 * show. The load now keeps the verdict before the strip, beside the body it
 * judged, and passes it as the preview contract's `diagnostics`.
 *
 * The cases (harness: objectstack#28561's off-nav deep link):
 *   - a pending draft's warning reaches the canvas, at its path, with the
 *     server's message;
 *   - with no pending draft, the published layer's verdict is the one handed;
 *   - an empty `warnings`, or none, hands nothing;
 *   - once the author edits the value the warning judged, it is dropped (the
 *     pillar does not read the leaf again after an autosave), and the save
 *     that sends the edit carries no `_diagnostics`.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.crm';

/** The lint's wording, as the server serves it (objectstack#29196). */
const MESSAGE =
  'crm_lead.intake: field "no_such_field" is not a field on object "crm_lead" — it is silently skipped and never renders on the form';
const WARNING = { path: 'config.sections.0.fields.1', message: MESSAGE };

const formView = {
  name: 'crm_lead.intake',
  label: 'Lead intake',
  object: 'crm_lead',
  viewKind: 'form',
  config: { type: 'simple', sections: [{ name: 'overview', label: 'Overview', fields: ['name', 'no_such_field'] }] },
};

/** What the mocked server holds: the published row, its layer's verdict, and a pending draft. */
const server = vi.hoisted(() => ({
  published: new Map<string, Array<Record<string, unknown>>>(),
  layerDiagnostics: undefined as Record<string, unknown> | undefined,
  draft: null as Record<string, unknown> | null,
}));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => server.published.get(type) ?? []),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    const eff = (server.published.get(type) ?? []).find((row) => row.name === name) ?? null;
    return {
      code: null,
      overlay: eff,
      overlayScope: eff ? 'env' : null,
      effective: eff,
      editable: true,
      deletable: true,
      resettable: false,
      lock: 'none',
      ...(server.layerDiagnostics ? { _diagnostics: server.layerDiagnostics } : {}),
    };
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    if (server.draft) return { type, name, item: server.draft };
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

// The `view` resource's list filter is registered here, as the console registers it.
import '../../services/builtinComponents';
import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview, type MetadataPreviewProps } from '../metadata-admin/preview-registry';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

/** A canvas that lists the diagnostics it was handed, and renames the field the warning judged. */
function StubPreview({ name, draft, diagnostics, onPatch }: MetadataPreviewProps) {
  const config = (draft as { config?: { sections?: Array<{ fields: string[] }> } }).config;
  return (
    <div data-testid="stub-canvas">
      {name}
      <ul>
        {(diagnostics ?? []).map((d, i) => (
          <li key={i} data-testid="canvas-diagnostic" data-path={d.path} data-severity={d.severity}>
            {d.message}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() =>
          onPatch?.({
            config: { ...config, sections: [{ ...config!.sections![0], fields: ['name', 'status'] }] },
          })
        }
      >
        fix field
      </button>
    </div>
  );
}
registerMetadataPreview('view', StubPreview);

beforeEach(() => {
  server.published.clear();
  server.published.set('view', [formView]);
  server.layerDiagnostics = undefined;
  server.draft = null;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
});

afterEach(cleanup);

function renderPillar() {
  render(
    <MemoryRouter
      initialEntries={[`/studio/${PKG}/interfaces?surface=${encodeURIComponent('view:' + formView.name)}`]}
    >
      <InterfacesPillar packageId={PKG} packageLabel="Acme CRM" />
    </MemoryRouter>,
  );
}

const canvas = () => screen.findByTestId('stub-canvas', undefined, { timeout: 8000 });
const handed = () => screen.queryAllByTestId('canvas-diagnostic');

describe('objectstack#29311 — the Interfaces pillar hands a form view its served warnings', () => {
  it('a pending draft\'s warning reaches the canvas at its path, with the server\'s message', async () => {
    server.draft = { ...formView, _diagnostics: { valid: true, warnings: [WARNING] } };
    renderPillar();
    await canvas();
    await waitFor(() => expect(handed()).toHaveLength(1));
    expect(handed()[0]).toHaveAttribute('data-path', WARNING.path);
    expect(handed()[0]).toHaveAttribute('data-severity', 'warning');
    expect(handed()[0]).toHaveTextContent(MESSAGE);
  });

  it('with no pending draft, the published layer\'s verdict is the one handed', async () => {
    server.layerDiagnostics = { valid: true, warnings: [WARNING] };
    renderPillar();
    await canvas();
    await waitFor(() => expect(handed()).toHaveLength(1));
    expect(handed()[0]).toHaveTextContent(MESSAGE);
  });

  it('an empty warnings list, or no _diagnostics at all, hands nothing', async () => {
    server.draft = { ...formView, _diagnostics: { valid: true, warnings: [] } };
    renderPillar();
    await canvas();
    await waitFor(() => expect(mockClient.getDraft).toHaveBeenCalled());
    expect(handed()).toHaveLength(0);
    cleanup();

    server.draft = { ...formView };
    renderPillar();
    await canvas();
    expect(handed()).toHaveLength(0);
  });

  it('an edit to the judged value drops the warning, and its save carries no _diagnostics', async () => {
    server.draft = { ...formView, _diagnostics: { valid: true, warnings: [WARNING] } };
    renderPillar();
    await canvas();
    await waitFor(() => expect(handed()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'fix field' }));
    await waitFor(() => expect(handed()).toHaveLength(0));

    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 8000 });
    const [type, name, item] = mockClient.save.mock.calls.at(-1)! as unknown as [string, string, Record<string, unknown>];
    expect([type, name]).toEqual(['view', formView.name]);
    expect(item).not.toHaveProperty('_diagnostics');
    expect(JSON.stringify(item)).not.toContain('_diagnostics');
    expect((item.config as { sections: Array<{ fields: string[] }> }).sections[0].fields).toEqual(['name', 'status']);
  });
});
