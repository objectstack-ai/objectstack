// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27644 — a served error at a validation rule's own path holds the
 * Data pillar's autosave, as objectstack#27482 made one hold the Permission
 * matrix's.
 *
 * The object draft read carries the publish's verdict in `_diagnostics`, and
 * since objectstack#27643 a rule guard's finding is located at the rule's key
 * path (`validations.1.condition`). The pillar dropped that verdict, so a
 * guard the publish refuses read clean and autosaved until Publish refused
 * it. The verdict judges the stored draft and nothing else: it holds while the
 * guard still shows the text it judged, and lets the edit that changes that
 * text go out, since only that save brings the next verdict. ⛔ The fake door
 * below is the only place the refusal is decided; the editor restates no rule.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const REFUSED = 'record.amount > 100';
const ACCEPTED = 'record.amount != null && record.amount > 100';
const REFUSAL = "validation rule 'amount_cap' applies `>` to `record.amount`, which may be null";

const rule = (condition: string, message = 'Too much') => ({
  type: 'script',
  name: 'amount_cap',
  label: 'Amount cap',
  message,
  severity: 'error',
  active: true,
  condition,
});

const objectWith = (condition: string, message?: string) => ({
  name: 'showcase_task',
  label: 'Task',
  fields: [
    { name: 'status', label: 'Status', type: 'text' },
    { name: 'amount', label: 'Amount', type: 'number' },
  ],
  // A first rule, so the refused one sits at index 1, as the door spells it.
  validations: [
    { type: 'script', name: 'status_set', label: 'Status set', message: 'x', severity: 'error', active: true, condition: 'record.status != null' },
    rule(condition, message),
  ],
});

/** The door's publish verdict on a stored draft: it refuses the one guard. */
function verdictOf(body: Record<string, unknown>) {
  const rules = (body.validations ?? []) as Array<{ condition?: unknown }>;
  const errors = rules.flatMap((r, i) =>
    r?.condition === REFUSED ? [{ path: `validations.${i}.condition`, message: REFUSAL, code: 'expression-invalid' }] : [],
  );
  return errors.length ? { valid: false, errors } : { valid: true };
}

interface Server {
  draft: Record<string, unknown> | null;
  /** Every body a save sent. */
  sent: Array<Record<string, unknown>>;
}

let server: Server;
const PUBLISHED = objectWith(ACCEPTED);

const mockClient: Record<string, unknown> = {
  save: vi.fn(async (_type: string, _name: string, body: Record<string, unknown>) => {
    const copy = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    server.sent.push(copy);
    server.draft = copy;
    return {};
  }),
  get: vi.fn(async () => PUBLISHED),
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  // objectstack#29793 — the stored draft is the `draft` layer, the pillar's buffer.
  layered: vi.fn(async () => ({ effective: PUBLISHED, code: PUBLISHED, draft: server.draft })),
  getDraft: vi.fn(async () =>
    server.draft
      ? { type: 'object', name: 'showcase_task', item: { ...server.draft, _draft: true, _diagnostics: verdictOf(server.draft) } }
      : null,
  ),
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
// in DataPillar.panelHold-27629.test.tsx.
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
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerBuiltinInspectors();

// The engine parses every guard here: the client lint holds nothing, so any
// hold below is the served verdict's.
function stubEngine() {
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
      introspectScope: () => ({ fields: ['status', 'amount'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
}

beforeEach(stubEngine);
afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
  vi.mocked(mockClient.save as () => unknown).mockClear();
});

/** The shared autosave fires 1.5 s after the last edit. */
const AUTOSAVE = { timeout: 5000 };
/** Longer than the autosave's pause. */
const pause = (ms = 2500) => new Promise((r) => setTimeout(r, ms));

function mount(draft: Record<string, unknown> | null) {
  server = { draft, sent: [] };
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
}

/** The Validations tab, on the refused rule (the panel opens on the first). */
async function openRule() {
  fireEvent.click(await screen.findByTestId('data-tab-flat-rules'));
  fireEvent.click(await screen.findByText('Amount cap'));
}

const guardRaw = () =>
  screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;

/** The guard in raw CEL: the builder opens a guard it cannot round-trip there. */
async function rawGuard(): Promise<HTMLTextAreaElement> {
  const open = screen.queryAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA');
  if (open) return open as HTMLTextAreaElement;
  fireEvent.click(screen.getByText('Expression'));
  return waitFor(() => {
    expect(guardRaw()).toBeTruthy();
    return guardRaw();
  });
}

const editMessage = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText(t('engine.studio.rules.messagePlaceholder', 'en')), { target: { value } });

describe('a server error at a validation rule\'s path holds the Data pillar autosave (objectstack#27644)', () => {
  it('(a) a stored draft the publish refuses: another edit to the rule is held, no PUT, the message stays', async () => {
    mount(objectWith(REFUSED));
    await openRule();
    expect(await screen.findByText(REFUSAL)).toBeInTheDocument();

    editMessage('Amount is over the cap');

    await waitFor(() => expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Amount cap'), AUTOSAVE);
    await pause();
    expect(server.sent).toHaveLength(0);
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
  });

  it('(b) the card flow: the refused guard saves once, its re-read holds the next edit', async () => {
    mount(objectWith(ACCEPTED));
    await openRule();
    const box = await rawGuard();
    await screen.findByText('Valid CEL', {}, { timeout: 3000 });

    // No client copy of the rule: the lint passes it and the first save goes out.
    fireEvent.change(box, { target: { value: REFUSED } });
    await waitFor(() => expect(server.sent).toHaveLength(1), AUTOSAVE);
    expect(await screen.findByText(REFUSAL, {}, AUTOSAVE)).toBeInTheDocument();
    expect(screen.queryByText('Valid CEL')).toBeNull();

    editMessage('Amount is over the cap');
    await waitFor(() => expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Amount cap'), AUTOSAVE);
    await pause();
    expect(server.sent).toHaveLength(1);
  });

  it('(c) editing the guard away releases: the save goes out and its clean re-read clears the verdict', async () => {
    mount(objectWith(REFUSED));
    await openRule();
    await screen.findByText(REFUSAL);

    fireEvent.change(await rawGuard(), { target: { value: ACCEPTED } });

    await waitFor(() => expect(server.sent).toHaveLength(1), AUTOSAVE);
    const saved = server.sent[0]!.validations as Array<{ condition?: string }>;
    expect(saved[1]!.condition).toBe(ACCEPTED);
    await waitFor(() => expect(screen.queryByText(REFUSAL)).toBeNull(), AUTOSAVE);
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });

  it('(d) typed back to the judged text before the autosave fires: held again, no PUT', async () => {
    mount(objectWith(REFUSED));
    await openRule();
    await screen.findByText(REFUSAL);

    const box = await rawGuard();
    fireEvent.change(box, { target: { value: 'record.amount > 50' } });
    fireEvent.change(box, { target: { value: REFUSED } });

    await waitFor(() => expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Amount cap'), AUTOSAVE);
    await pause();
    expect(server.sent).toHaveLength(0);
  });

  it('(e) leaving the Validations tab keeps the hold with the draft (objectstack#27629)', async () => {
    mount(objectWith(REFUSED));
    await openRule();
    await screen.findByText(REFUSAL);
    editMessage('Amount is over the cap');

    fireEvent.click(screen.getByRole('button', { name: 'Form' }));
    await waitFor(() => expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Amount cap'), AUTOSAVE);
    await pause();
    expect(server.sent).toHaveLength(0);
  });

  it('control: the verdict is the rule\'s own: the rule beside it shows none of it', async () => {
    mount(objectWith(REFUSED));
    fireEvent.click(await screen.findByTestId('data-tab-flat-rules'));
    fireEvent.click(await screen.findByText('Status set'));
    await screen.findByDisplayValue('x');
    await pause(600);
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });
});

/**
 * objectstack#27482 — a rule the panel minted takes its name from its message
 * (`patchMessage`), so editing the message renames it. The panel keeps each
 * rule's verdict by name and the guard's editor reports only when its count
 * changes, so the verdict has to move with the name: left behind, it was
 * pruned with the old name and the refused guard autosaved on every edit.
 */
describe('a rename keeps the served verdict\'s hold on the rule (objectstack#27482)', () => {
  /** New → "Reject the save when…": a minted rule whose name follows its message. */
  async function newRejectWhenRule() {
    fireEvent.click(await screen.findByTestId('data-tab-flat-rules'));
    await screen.findByText('Amount cap');
    fireEvent.click(screen.getByText('New'));
    fireEvent.click(await screen.findByTestId('rule-preset-reject_when'));
  }

  it('(a) the minted rule: its first save goes out, and the message edit that renames it is held', async () => {
    mount(objectWith(ACCEPTED));
    await newRejectWhenRule();
    // The card's flow: the guard first, then the message, which settles the rule into the draft.
    fireEvent.change(await rawGuard(), { target: { value: REFUSED } });
    editMessage('Over the cap');

    // No client copy of the rule: the first save goes out and its re-read brings the verdict.
    await waitFor(() => expect(server.sent).toHaveLength(1), AUTOSAVE);
    const first = server.sent[0]!.validations as Array<{ name?: string; condition?: string }>;
    expect(first[2]).toMatchObject({ name: 'over_the_cap', condition: REFUSED });
    expect(await screen.findByText(REFUSAL, {}, AUTOSAVE)).toBeInTheDocument();

    // The next message edit renames the rule; the guard still shows the judged text.
    editMessage('Over the cap now');
    expect(screen.getByDisplayValue('over_the_cap_now')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('studio-held-message')).toHaveTextContent('over_the_cap_now'), AUTOSAVE);
    await pause();
    expect(server.sent).toHaveLength(1);
  });

  it('(b) a rename through the name input is held the same way', async () => {
    mount(objectWith(REFUSED));
    await openRule();
    await screen.findByText(REFUSAL);

    fireEvent.change(screen.getByDisplayValue('amount_cap'), { target: { value: 'amount_limit' } });

    await waitFor(() => expect(screen.getByTestId('studio-held-message')).toHaveTextContent('Amount cap'), AUTOSAVE);
    await pause();
    expect(server.sent).toHaveLength(0);
  });

  it('control: a rename does not hold a rule the verdict does not judge', async () => {
    mount(objectWith(REFUSED));
    fireEvent.click(await screen.findByTestId('data-tab-flat-rules'));
    fireEvent.click(await screen.findByText('Status set'));
    await screen.findByDisplayValue('x');

    fireEvent.change(screen.getByDisplayValue('status_set'), { target: { value: 'status_needed' } });

    // The refused rule beside it was never opened, so nothing holds this edit.
    await waitFor(() => expect(server.sent).toHaveLength(1), AUTOSAVE);
    const sent = server.sent[0]!.validations as Array<{ name?: string }>;
    expect(sent[0]!.name).toBe('status_needed');
  });
});
