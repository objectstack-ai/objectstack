// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata editor's Save must refuse a DEFAULT-inspector fault too —
 * objectui#4527 phase 2.
 *
 * PR #4547 gated this host on the SCOPED inspector's verdict
 * ({@link file://./ResourceEditPage.celGate.test.tsx}). With no selection the
 * editor renders the registered DEFAULT inspector instead, and that branch
 * passed no `onBlockingIssuesChange` — `MetadataDefaultInspectorProps` had no
 * such member to pass. A view's conditional-formatting rules live on exactly
 * that branch, so a rule whose CEL does not parse saved and published.
 *
 * ## Why `view`, measured rather than assumed
 *
 * This host only reaches a default inspector when the type ALSO has a canvas
 * preview: the panel that renders it sits inside the `PreviewComponent` branch,
 * and a type without one falls through to a plain `SchemaForm`. Of the types
 * that have both, `view` is the one whose default inspector mounts CEL
 * (`ViewDefaultInspector` -> `ViewVariantInspector` -> the formatting editor),
 * so it is the type this gate is actually reachable through. The `hook` and
 * `action` default inspectors are NOT reachable from this host at all — they
 * are edited through the Studio panels and gated in their own suites.
 *
 * Only the canvas is stubbed, and only so that a preview exists and no
 * selection is emitted; everything under test — the registered default
 * inspector, the real formatting editor, this host's real hold and its real
 * Save button — is the shipping code.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const viewDef = {
  name: 'invoices',
  label: 'Invoices',
  list: {
    type: 'grid',
    object: 'invoice',
    columns: ['status', 'amount'],
    conditionalFormatting: [{ condition: '', style: {} }],
  },
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: viewDef, code: viewDef, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  withPreviewDrafts() { return this; },
  saveDraft: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: 'view', name: 'view', label: 'View', allowEnvironmentOverlay: true }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerBuiltinInspectors } from './inspectors';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';
import { __setCelFormulaLoader } from './celAuthoring';

registerBuiltinInspectors();

const DANGLING = /[*+\-/&|=<>]\s*$/;

function stubEngine() {
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: (_role: string, input: unknown) => {
        const src = typeof input === 'string' ? input : String((input as { source?: string })?.source ?? '');
        return DANGLING.test(src)
          ? { ok: false, errors: [{ message: 'Parse error: expression ends after an operator' }], warnings: [] }
          : { ok: true, errors: [], warnings: [] };
      },
      introspectScope: () => ({ fields: ['status', 'amount'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

/**
 * Canvas stand-in: exists so the host takes its split-editor branch, and emits
 * no selection, so the DEFAULT inspector is what fills the rail.
 */
function StubViewCanvas() {
  return <div data-testid="stub-view-canvas" />;
}

const realViewPreview = getMetadataPreview('view');

beforeEach(() => {
  stubEngine();
  registerMetadataPreview('view', StubViewCanvas as never);
});

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
  if (realViewPreview) registerMetadataPreview('view', realViewPreview);
});

/** The Save icon button, identified by its title in either state. */
// Title flipped to the neutral inspector copy by ruling 5831744213 (objectui#6900).
const saveButton = () =>
  screen.getByRole('button', { name: /Save \(⌘S\)|Fix the issues shown in the inspector before saving\./ });

const ruleBox = () =>
  screen.getByTestId('cf-rule-0').querySelector('[role="combobox"]') as HTMLTextAreaElement;

/** Open the view editor and hand back its first formatting rule's CEL box. */
async function openRule() {
  render(
    <MemoryRouter initialEntries={['/metadata/view/invoices']}>
      <MetadataResourceEditPage type="view" name="invoices" />
    </MemoryRouter>,
  );
  await screen.findByTestId('cf-rule-0');
  return ruleBox();
}

describe('MetadataResourceEditPage — Save is gated on the DEFAULT inspector’s CEL verdict (#4527)', () => {
  it('refuses a formatting rule whose condition does not parse', async () => {
    const box = await openRule();

    // A valid condition first: dirties the draft (so Save is live at all) and
    // pins the must-not-change half — a good condition never blocks.
    fireEvent.change(box, { target: { value: "record.status == 'overdue'" } });
    await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 4000 });

    fireEvent.change(box, { target: { value: 'record.amount >' } });
    await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 4000 });
    expect(saveButton()).toHaveAttribute('title', 'Fix the issues shown in the inspector before saving.');
  });

  it('re-enables Save once the condition parses again', async () => {
    const box = await openRule();

    fireEvent.change(box, { target: { value: 'record.amount >' } });
    await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 4000 });

    fireEvent.change(box, { target: { value: "record.status == 'overdue'" } });
    await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 4000 });
  });
});
