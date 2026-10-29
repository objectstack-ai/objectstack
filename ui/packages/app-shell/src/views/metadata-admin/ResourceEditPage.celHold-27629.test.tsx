// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27629 — the metadata editor keeps a scoped inspector's CEL hold
 * with the DRAFT, not with the selection.
 *
 * The maintainer's ruling on #27485 (comment 6500685972, 2026-10-29T15:17Z,
 * letter A) makes a CEL parse-fault hold belong to the draft: it lasts while
 * the draft still carries the text the editor judged; editing that text,
 * removing the item or reloading ends it; while it holds, a held line names the
 * item with a "Show me" that reopens it. Item 3 asks for the sibling surfaces;
 * this suite pins `MetadataResourceEditPage`. Before this card the inspector's
 * count was stamped with the selection, so clearing or changing the selection
 * released Save and the autosave while the broken predicate stayed in the draft.
 *
 * Set up as {@link file://./ResourceEditPage.celGate.test.tsx}: only the page
 * canvas is stubbed (to emit selections); the block inspector, its
 * ConditionBuilder and this host's gating are real, the CEL engine is stubbed.
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
  regions: [
    {
      name: 'main',
      components: [
        { type: 'text', id: 'b1', visibleWhen: 'record.amount > 10' },
        { type: 'text', id: 'b2' },
      ],
    },
  ],
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: PAGE, code: PAGE, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  saveDraft: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
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

/** Canvas stand-in: emits the selections the real canvas emits on click and on an empty click. */
function StubPageCanvas({
  onSelectionChange,
}: {
  onSelectionChange?: (next: MetadataSelection | null) => void;
}) {
  return (
    <>
      <button type="button" onClick={() => onSelectionChange?.({ kind: 'block', id: 'regions[0].components[0]', label: 'Intro text' })}>
        select the first block
      </button>
      <button type="button" onClick={() => onSelectionChange?.({ kind: 'block', id: 'regions[0].components[1]', label: 'Footer text' })}>
        select the second block
      </button>
      <button type="button" onClick={() => onSelectionChange?.(null)}>
        clear the selection
      </button>
    </>
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
  mockClient.save.mockClear();
  mockClient.saveDraft.mockClear();
  if (realPagePreview) registerMetadataPreview('page', realPagePreview);
});

const saveButton = () =>
  screen.getByRole('button', { name: /Save \(⌘S\)|Fix the issues shown in the inspector before saving\./ });

/** Past the autosave's 1.5 s debounce. */
const outlastDebounce = () => new Promise((r) => setTimeout(r, 2300));

async function openFirstBlockCel(): Promise<HTMLTextAreaElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'select the first block' }));
  fireEvent.click(await screen.findByText('Expression'));
  return screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

async function breakFirstBlock(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/metadata/page/home']}>
      <MetadataResourceEditPage type="page" name="home" />
    </MemoryRouter>,
  );
  const box = await openFirstBlockCel();
  fireEvent.change(box, { target: { value: 'record.amount >' } });
  await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 4000 });
}

const LEAVERS: Array<[string, () => void]> = [
  ['clearing the selection', () => fireEvent.click(screen.getByRole('button', { name: 'clear the selection' }))],
  ['selecting another block', () => fireEvent.click(screen.getByRole('button', { name: 'select the second block' }))],
];

describe('MetadataResourceEditPage — the CEL hold belongs to the draft, not to the selection (objectstack#27629)', () => {
  it.each(LEAVERS)('%s keeps Save and the autosave held, and the held line names the block', async (_how, leave) => {
    await breakFirstBlock();
    leave();
    await outlastDebounce();
    expect(mockClient.save).not.toHaveBeenCalled();
    expect(mockClient.saveDraft).not.toHaveBeenCalled();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByTestId('inspector-held-message')).toHaveTextContent('Intro text');
  });

  it('"Show me" reopens the block with its text, and fixing it there releases the hold', async () => {
    await breakFirstBlock();
    fireEvent.click(screen.getByRole('button', { name: 'clear the selection' }));
    await waitFor(() => expect(screen.getByTestId('inspector-held')).toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    const box = await waitFor(() => {
      const el = screen.queryAllByRole('combobox').find((e) => e.tagName === 'TEXTAREA') as HTMLTextAreaElement | undefined;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(box.value).toBe('record.amount >');
    fireEvent.change(box, { target: { value: 'record.amount > 20' } });
    await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 4000 });
    expect(screen.queryByTestId('inspector-held')).toBeNull();
  });
});
