// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Save must refuse a page block whose `visibleWhen` does not parse — the host
 * half of objectui#4527, end to end in the metadata editor that owns the
 * button.
 *
 * #4536 wired this host to `MetadataInspectorProps.onBlockingIssuesChange` and
 * proved the mechanism in the OTHER host (`DataPillar`, Studio's Data pillar).
 * Nothing proved it here: no test in this repo renders
 * `MetadataResourceEditPage` at all. So this suite pins the path this card
 * actually creates — block inspector -> ConditionBuilder verdict -> the
 * contract -> this host's Save button — for a non-`object` type.
 *
 * ## What is stubbed, and why that keeps the assertion honest
 *
 * Only the page CANVAS is stubbed, and only to emit the selection: turning a
 * click on a rendered block into a `MetadataSelection` is `PageBlockCanvas`'s
 * own concern and is tested there. Everything this card touches is real — the
 * registered `PageBlockInspector`, the real `ConditionBuilder`, the real
 * contract prop, and this host's real gating — so a regression anywhere along
 * that path fails here.
 *
 * The CEL engine is stubbed deterministically, as in the #4306 suites.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PAGE = {
  name: 'home',
  label: 'Home',
  type: 'home',
  template: 'default',
  regions: [{ name: 'main', components: [{ type: 'text', id: 'b1', visibleWhen: 'record.amount > 10' }] }],
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: PAGE, code: PAGE, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  saveDraft: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    // `allowEnvironmentOverlay` is what makes the item writable, and therefore what
    // makes a Save button exist at all.
    useMetadataTypes: () => ({
      entries: [{ type: 'page', name: 'page', label: 'Page', allowEnvironmentOverlay: true }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerBuiltinInspectors } from './inspectors';
import { registerMetadataPreview, getMetadataPreview, type MetadataSelection } from './preview-registry';
import { __setCelFormulaLoader } from './celAuthoring';

registerBuiltinInspectors();

const BLOCK_PATH = 'regions[0].components[0]';
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
      introspectScope: () => ({ fields: ['amount'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

/** Canvas stand-in: emits the block selection the real canvas emits on click. */
function StubPageCanvas({
  onSelectionChange,
}: {
  onSelectionChange?: (next: MetadataSelection | null) => void;
}) {
  return (
    <button type="button" onClick={() => onSelectionChange?.({ kind: 'block', id: BLOCK_PATH })}>
      select the block
    </button>
  );
}

const realPagePreview = getMetadataPreview('page');

beforeEach(() => {
  stubEngine();
  registerMetadataPreview('page', StubPageCanvas as never);
});

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
  if (realPagePreview) registerMetadataPreview('page', realPagePreview);
});

/** The Save button is an icon button identified by its title. */
// Title flipped to the neutral inspector copy by ruling 5831744213 (objectui#6900).
const saveButton = () =>
  screen.getByRole('button', { name: /Save \(⌘S\)|Fix the issues shown in the inspector before saving\./ });

/** Open the editor, select the block, and switch its visibility control to raw CEL. */
async function openBlockCel() {
  render(
    <MemoryRouter initialEntries={['/metadata/page/home']}>
      <MetadataResourceEditPage type="page" name="home" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'select the block' }));
  fireEvent.click(await screen.findByText('Expression'));
  return screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

describe('MetadataResourceEditPage — Save is gated on the block inspector’s CEL verdict (#4527)', () => {
  it("refuses the card's repro: a dangling operator disables Save", async () => {
    const box = await openBlockCel();

    // A valid predicate first — this dirties the draft (so Save is live at all)
    // and pins the must-not-change half: a good predicate never blocks.
    fireEvent.change(box, { target: { value: 'record.amount > 20' } });
    await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 4000 });

    fireEvent.change(box, { target: { value: 'record.amount >' } });
    await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 4000 });
    expect(saveButton()).toHaveAttribute('title', 'Fix the issues shown in the inspector before saving.');
  });

  it('re-enables Save once the predicate parses again', async () => {
    const box = await openBlockCel();

    fireEvent.change(box, { target: { value: 'record.amount >' } });
    await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 4000 });

    fireEvent.change(box, { target: { value: 'record.amount > 20' } });
    await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 4000 });
  });
});
