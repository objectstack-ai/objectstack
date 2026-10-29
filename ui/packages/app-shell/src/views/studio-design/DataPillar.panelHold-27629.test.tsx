// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27629 — the Data pillar's PANEL family keeps a CEL hold with the
 * draft, the same rule the field inspector follows since objectstack#27485.
 *
 * The maintainer's ruling on #27485 (comment 6500685972, 2026-10-29T15:17Z,
 * letter A) makes a CEL parse-fault hold belong to the draft, not to the open
 * editor: it lasts while the draft still carries the text the editor judged;
 * editing that text, removing the item or reloading ends it; while it holds, the
 * held line names the item with a "Show me" that reopens it. Item 3 of that
 * ruling asks for the sibling surfaces, which this suite pins for the two panels
 * that mount a CEL editor: Validations (a rule's guard) and Actions (an action's
 * predicates). Before this card the panel count was stamped with the panel TAB,
 * so leaving the tab released the hold and the autosave sent the broken text
 * ({@link file://./DataPillar.panelGate.test.tsx} pinned that, and is flipped).
 *
 * The Settings panel is not here: `ObjectDefaultInspector` mounts no CEL editor,
 * so it has no verdict to keep (`ObjectSettingsPanel`'s own header).
 *
 * The engine is stubbed so the verdict is deterministic, as in the #4306 suites.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const ARCHIVE = {
  name: 'showcase_task_archive',
  label: 'Archive',
  objectName: 'showcase_task',
  locations: ['record_more'],
  type: 'script',
  body: { language: 'expression', source: 'true' },
};

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'status', label: 'Status', type: 'text' }],
  validations: [
    {
      type: 'script',
      name: 'rule_a',
      label: 'Rule A',
      message: 'nope',
      severity: 'error',
      active: true,
    },
  ],
  actions: [ARCHIVE],
};

const mockClient: Record<string, unknown> & { save: ReturnType<typeof vi.fn> } = {
  save: vi.fn(async () => ({})),
  // The action inspector's field pickers read the object through the preview-draft door.
  get: vi.fn(async () => objectDef),
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
};
mockClient.withPreviewDrafts = () => mockClient;

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// The advanced tabs live in a Radix DropdownMenu; rendered as passthroughs, as
// in DataPillar.panelGate.test.tsx.
type PassthroughProps = { children?: React.ReactNode; onSelect?: () => void };
vi.mock('@object-ui/components', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/components')>();
  return {
    ...mod,
    DropdownMenu: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuTrigger: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuContent: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuItem: (p: PassthroughProps) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
    DropdownMenuRadioGroup: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuRadioItem: (p: PassthroughProps) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { __setCelFormulaLoader } from '../metadata-admin/celAuthoring';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

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
      introspectScope: () => ({ fields: ['status'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

beforeEach(stubEngine);
afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
  mockClient.save.mockClear();
});

/** Past the autosave's 1.5 s debounce. */
const outlastDebounce = () => new Promise((r) => setTimeout(r, 2300));

const rawEditorIn = (root: HTMLElement) =>
  within(root).getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;

function mount() {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
}

/** The selected rule's guard, in raw CEL. The panel selects the first rule. */
async function openRuleGuard(): Promise<HTMLTextAreaElement> {
  fireEvent.click(await screen.findByTestId('data-tab-flat-rules'));
  fireEvent.click(await screen.findByText('Expression'));
  return rawEditorIn(document.body);
}

/** The selected action's "Visible when" predicate, in raw CEL. */
async function openActionVisible(): Promise<HTMLTextAreaElement> {
  fireEvent.click(await screen.findByTestId('data-tab-flat-actions'));
  const root = (await screen.findByText('Visible when')).parentElement!.parentElement as HTMLElement;
  fireEvent.click(within(root).getByText('Expression'));
  return rawEditorIn(root);
}

const leaveToForm = () => fireEvent.click(screen.getByRole('button', { name: 'Form' }));

describe('DataPillar — a rule guard that does not parse holds with the draft (objectstack#27629)', () => {
  it('leaving the Validations tab keeps the hold, and the held line names the rule', async () => {
    mount();
    const box = await openRuleGuard();
    fireEvent.change(box, { target: { value: 'record.status ==' } });
    await outlastDebounce();
    expect(mockClient.save).not.toHaveBeenCalled();

    leaveToForm();
    await outlastDebounce();
    expect(mockClient.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Rule A');
  });

  it('"Show me" reopens the rule with its text, and fixing it there releases the hold', async () => {
    mount();
    fireEvent.change(await openRuleGuard(), { target: { value: 'record.status ==' } });
    await outlastDebounce();
    leaveToForm();
    await waitFor(() => expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Rule A'), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    // The guard does not parse, so its builder reopens straight in raw CEL.
    const box = await waitFor(() => {
      const el = screen.queryAllByRole('combobox').find((e) => e.tagName === 'TEXTAREA') as HTMLTextAreaElement | undefined;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(box.value).toBe('record.status ==');
    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });

  it('removing the rule ends the hold: nothing judged is left in the draft', async () => {
    mount();
    fireEvent.change(await openRuleGuard(), { target: { value: 'record.status ==' } });
    await outlastDebounce();
    leaveToForm();
    await waitFor(() => expect(screen.getByTestId('studio-held')).toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByTestId('data-tab-flat-rules'));
    const detail = (await screen.findAllByRole('button', { name: 'Delete' })).at(-1)!;
    fireEvent.click(detail);
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
    const body = (mockClient.save.mock.calls.at(-1) as unknown[] | undefined)?.[2] as { validations?: unknown[] };
    expect(body.validations ?? []).toEqual([]);
  });
});

describe('DataPillar — an action predicate that does not parse holds with the draft (objectstack#27629)', () => {
  it('leaving the Actions tab keeps the hold, and the held line names the action', async () => {
    mount();
    const box = await openActionVisible();
    fireEvent.change(box, { target: { value: 'record.status ==' } });
    await outlastDebounce();
    expect(mockClient.save).not.toHaveBeenCalled();

    leaveToForm();
    await outlastDebounce();
    expect(mockClient.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Archive');
  });

  it('"Show me" reopens the action with its text, and fixing it there releases the hold', async () => {
    mount();
    fireEvent.change(await openActionVisible(), { target: { value: 'record.status ==' } });
    await outlastDebounce();
    leaveToForm();
    await waitFor(() => expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Archive'), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    const root = (await screen.findByText('Visible when')).parentElement!.parentElement as HTMLElement;
    const box = await waitFor(() => {
      const el = within(root).getAllByRole('combobox').find((e) => e.tagName === 'TEXTAREA') as HTMLTextAreaElement | undefined;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(box.value).toBe('record.status ==');
    fireEvent.change(box, { target: { value: "record.status == 'open'" } });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 4000 });
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });
});
