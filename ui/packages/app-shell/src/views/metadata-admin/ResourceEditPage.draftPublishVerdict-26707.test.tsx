// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26707 — while a draft is pending, the editor shows the DRAFT's
 * server verdict, which carries what its publish would refuse.
 *
 * ## The defect this file keeps fixed
 *
 * The edit page read `_diagnostics` from the layered read alone. That verdict
 * judges the PUBLISHED body (`getMetaItemLayered` composes `effective` from the
 * active rows and never reads a draft), so a pending draft the publish refuses
 * — a flow edge whose CEL does not parse, a summary field with no operations —
 * reached the canvas Problems panel and the diagnostics banner as "valid", and
 * the refusal arrived only at Publish. Since objectstack#26707 the draft read's
 * `_diagnostics` is the publish's own verdict on the draft; this page now takes
 * it whenever it holds a draft.
 *
 * The server double below serves that verdict the way the real draft read
 * does — computed from the stored draft body, with the rule id as `code` — and
 * a layered verdict that says `valid: true`, as the published body is clean.
 * Red on base: the canvas never receives the draft's error.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type Row = Record<string, unknown>;

const REFUSAL = {
  path: 'regions.0',
  message: 'region "main" names a component this deployment does not have',
  code: 'page-component-unknown',
};

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  saves: 0,
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  /** The publish's verdict on a body: this double refuses a body labelled `broken`. */
  const verdictOf = (body: Record<string, unknown>) =>
    body.label === 'broken'
      ? {
          valid: false,
          errors: [{
            path: 'regions.0',
            message: 'region "main" names a component this deployment does not have',
            code: 'page-component-unknown',
          }],
        }
      : { valid: true };
  return {
    list: vi.fn(async () => []),
    listDrafts: vi.fn(async () => []),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return {
        code: null,
        overlay: eff,
        overlayScope: eff ? 'env' : null,
        effective: eff,
        // The PUBLISHED body's verdict — clean.
        ...(eff ? { _diagnostics: { valid: true } } : {}),
        editable: true,
        deletable: true,
        resettable: false,
        lock: 'none',
      };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      const row = server.drafts.get(k(type, name));
      if (!row) {
        throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
      }
      return { type, name, item: { ...row, _draft: true, _diagnostics: verdictOf(row) } };
    }),
    save: vi.fn(async (type: string, name: string, item: unknown, opts?: Record<string, unknown>) => {
      const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
      server.saves += 1;
      if (opts?.mode === 'draft') server.drafts.set(k(type, name), body);
      else server.active.set(k(type, name), body);
      return { type, name, item: body };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: 'page', name: 'page', label: 'Page', allowEnvironmentOverlay: true, schema: { required: [] } }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';

/** Canvas stand-in: prints the server diagnostics the page hands a preview, and dirties the draft on demand. */
function StubCanvas({
  diagnostics,
  onPatch,
}: {
  diagnostics?: Array<{ path?: string; message: string; severity?: string }>;
  onPatch?: (patch: Record<string, unknown>) => void;
}) {
  return (
    <>
      <pre data-testid="canvas-diagnostics">{JSON.stringify(diagnostics ?? [])}</pre>
      <button type="button" onClick={() => onPatch?.({ label: 'fixed' })}>fix the draft</button>
    </>
  );
}

const realPage = getMetadataPreview('page');

const PAGE: Row = {
  name: 'home',
  label: 'Home',
  type: 'home',
  template: 'default',
  regions: [{ name: 'main', components: [{ type: 'text', id: 'b1' }] }],
};

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.saves = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  registerMetadataPreview('page', StubCanvas as never);
});

afterEach(() => {
  cleanup();
  if (realPage) registerMetadataPreview('page', realPage);
  window.history.replaceState(null, '', '/');
});

function renderEditor() {
  window.history.replaceState(null, '', '/metadata/page/home');
  render(
    <MemoryRouter initialEntries={['/metadata/page/home']}>
      <MetadataResourceEditPage type="page" name="home" />
    </MemoryRouter>,
  );
}

const canvasDiagnostics = () =>
  JSON.parse(screen.getByTestId('canvas-diagnostics').textContent ?? '[]') as Array<{ message: string; severity?: string }>;

describe('MetadataResourceEditPage — a pending draft is judged by its own server verdict (objectstack#26707)', () => {
  it('the canvas receives the draft read\'s refusal although the published body is clean', async () => {
    server.active.set('page/home', PAGE);
    server.drafts.set('page/home', { ...PAGE, label: 'broken' });
    renderEditor();

    await waitFor(
      () => expect(canvasDiagnostics()).toContainEqual(expect.objectContaining({ message: REFUSAL.message, severity: 'error' })),
      { timeout: 8000 },
    );
  });

  it('the verdict follows the draft: the refresh after an autosave of a fixed draft clears it', async () => {
    server.active.set('page/home', PAGE);
    server.drafts.set('page/home', { ...PAGE, label: 'broken' });
    renderEditor();
    await waitFor(() => expect(canvasDiagnostics().map((d) => d.message)).toContain(REFUSAL.message), { timeout: 8000 });

    fireEvent.click(screen.getByRole('button', { name: 'fix the draft' }));

    await waitFor(() => expect(server.saves).toBe(1), { timeout: 8000 });
    await waitFor(() => expect(canvasDiagnostics().map((d) => d.message)).not.toContain(REFUSAL.message), { timeout: 8000 });
  });

  it('control: with no pending draft the published verdict stands', async () => {
    server.active.set('page/home', PAGE);
    renderEditor();

    await waitFor(() => expect(mockClient.layered).toHaveBeenCalled(), { timeout: 8000 });
    await screen.findByTestId('canvas-diagnostics', undefined, { timeout: 8000 });
    expect(canvasDiagnostics().map((d) => d.message)).not.toContain(REFUSAL.message);
  });
});
