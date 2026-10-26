// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12514 — the Validations, Actions and Hooks tabs of an object that
 * holds none show one centered block: the tab's icon, one sentence, and a
 * primary button that runs the list header's own "New".
 *
 *  - Validations and Actions: the button opens the very menu the header's
 *    "New" opens (its presets, its Advanced fold), and a pick from it writes
 *    what the header's pick writes.
 *  - Hooks: the button saves the same new hook the header's "New" saves.
 *  - Read-only: the sentence stands alone, with no button.
 *  - CONTROL: an object that holds one shows the list and its editor, and no
 *    block.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const state = vi.hoisted(() => ({ hooks: [] as Array<Record<string, unknown>> }));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => (type === 'hook' ? state.hooks : [])),
  listDrafts: vi.fn(async () => []),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  withPreviewDrafts() {
    return this;
  },
  save: vi.fn(async (_type: string, _name: string, body: Record<string, unknown>) => {
    state.hooks = [...state.hooks, body];
    return {};
  }),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { ObjectValidationsPanel } from './ObjectValidationsPanel';
import { ObjectActionsPanel } from './ObjectActionsPanel';
import { ObjectHooksPanel } from './ObjectHooksPanel';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t } from '../metadata-admin/i18n';

registerBuiltinInspectors();

afterEach(() => {
  cleanup();
  state.hooks = [];
  vi.clearAllMocks();
});

const emptyDraft: Record<string, unknown> = {
  name: 'invoice',
  label: 'Invoice',
  fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
};

/** Feeds every `onPatch` back into `draft`, as the Data pillar does. */
function Harness({ onPatch }: { onPatch: (p: Record<string, unknown>) => void }) {
  const [draft, setDraft] = React.useState(emptyDraft);
  return (
    <ObjectValidationsPanel
      draft={draft}
      onPatch={(p) => {
        onPatch(p);
        setDraft((d) => ({ ...d, ...p }));
      }}
    />
  );
}

/** The menu's entries by test id, as the open popover lists them. */
function menuIds(prefix: string): string[] {
  return screen.getAllByTestId(new RegExp(`^${prefix}`)).map((el) => el.getAttribute('data-testid') ?? '');
}

describe('objectui#12514 — Validations: the empty block opens the header’s New menu', () => {
  it('shows one block — icon, sentence, button — and no list or editor', () => {
    render(<ObjectValidationsPanel draft={emptyDraft} onPatch={vi.fn()} />);
    const block = screen.getByTestId('rules-empty');
    expect(block).toHaveTextContent(t('engine.studio.rules.none', 'en'));
    expect(block.querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('rules-empty-new')).toHaveTextContent('New validation rule');
    expect(screen.queryByText(t('engine.studio.rules.title', 'en'))).toBeNull();
  });

  it('the button opens the same menu the header’s New opens', () => {
    render(<ObjectValidationsPanel draft={emptyDraft} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByTestId('rules-empty-new'));
    const fromEmpty = menuIds('rule-preset-');
    expect(fromEmpty.length).toBeGreaterThan(0);
    cleanup();

    const one = { ...emptyDraft, validations: [{ type: 'script', name: 'r1', message: 'm', condition: 'record.amount < 0' }] };
    render(<ObjectValidationsPanel draft={one} onPatch={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^New/ }));
    expect(menuIds('rule-preset-')).toEqual(fromEmpty);
  });

  it('a pick from it writes the rule the header’s pick writes', () => {
    const fromEmpty = vi.fn();
    render(<Harness onPatch={fromEmpty} />);
    fireEvent.click(screen.getByTestId('rules-empty-new'));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    fireEvent.click(screen.getByRole('button', { name: t('engine.studio.rules.typeFormat', 'en') }));
    expect(fromEmpty).toHaveBeenCalledTimes(1);
    // The rule is listed and open: the block gave way to the list.
    expect(screen.queryByTestId('rules-empty')).toBeNull();
  });

  it('once the first rule lists, the menu hands focus to the header’s New', async () => {
    render(<Harness onPatch={vi.fn()} />);
    fireEvent.click(screen.getByTestId('rules-empty-new'));
    fireEvent.click(screen.getByTestId('rule-preset-not_negative'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^New$/ })));
  });

  it('read-only: the sentence alone, no button', () => {
    render(<ObjectValidationsPanel draft={emptyDraft} onPatch={vi.fn()} disabled />);
    expect(screen.getByTestId('rules-empty')).toHaveTextContent(t('engine.studio.rules.none', 'en'));
    expect(screen.queryByTestId('rules-empty-new')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('CONTROL: an object with a rule shows the list and the open rule, no block', () => {
    const one = { ...emptyDraft, validations: [{ type: 'script', name: 'r1', message: 'm', condition: 'record.amount < 0' }] };
    render(<ObjectValidationsPanel draft={one} onPatch={vi.fn()} />);
    expect(screen.queryByTestId('rules-empty')).toBeNull();
    expect(screen.getByText(t('engine.studio.rules.title', 'en'))).toBeInTheDocument();
  });
});

describe('objectui#12514 — Actions: the empty block opens the header’s New menu', () => {
  it('shows one block, and its button opens the same menu the header’s New opens', () => {
    render(<ObjectActionsPanel draft={emptyDraft} onPatch={vi.fn()} />);
    const block = screen.getByTestId('actions-empty');
    expect(block).toHaveTextContent(t('engine.studio.actions.none', 'en'));
    fireEvent.click(screen.getByTestId('actions-empty-new'));
    const fromEmpty = menuIds('action-preset-');
    expect(fromEmpty.length).toBeGreaterThan(0);
    cleanup();

    const one = { ...emptyDraft, actions: [{ name: 'a1', label: 'A1', type: 'script', objectName: 'invoice', locations: ['record_more'] }] };
    render(<ObjectActionsPanel draft={one} onPatch={vi.fn()} />);
    expect(screen.queryByTestId('actions-empty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^New/ }));
    expect(menuIds('action-preset-')).toEqual(fromEmpty);
  });

  it('the blank action under Advanced writes one action, as from the header', () => {
    const onPatch = vi.fn();
    render(<ObjectActionsPanel draft={emptyDraft} onPatch={onPatch} />);
    fireEvent.click(screen.getByTestId('actions-empty-new'));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    // The menu's blank action — the block's own button reads "New action" too.
    const menu = screen.getByRole('dialog');
    fireEvent.click(within(menu).getByRole('button', { name: t('engine.studio.actions.newLabel', 'en') }));
    expect(onPatch).toHaveBeenCalledTimes(1);
    const actions = onPatch.mock.calls[0][0].actions as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ objectName: 'invoice' });
  });

  it('read-only: the sentence alone, no button', () => {
    render(<ObjectActionsPanel draft={emptyDraft} onPatch={vi.fn()} disabled />);
    expect(screen.getByTestId('actions-empty')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('objectui#12514 — Hooks: the empty block runs the header’s New', () => {
  it('shows one block once the read answers, and its button saves the new hook', async () => {
    render(<ObjectHooksPanel objectName="invoice" packageId="com.example.invoicing" />);
    const block = await screen.findByTestId('hooks-empty');
    expect(block).toHaveTextContent(t('engine.studio.hooks.none', 'en'));
    fireEvent.click(screen.getByTestId('hooks-empty-new'));
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1));
    const [type, , body, opts] = mockClient.save.mock.calls[0] as unknown as [string, string, Record<string, unknown>, Record<string, unknown>];
    expect(type).toBe('hook');
    expect(body).toMatchObject({ object: 'invoice', events: ['beforeInsert'] });
    expect(opts).toMatchObject({ mode: 'draft', packageId: 'com.example.invoicing', ifNoneMatch: '*' });
    // The saved hook is listed and open: the block gave way.
    await waitFor(() => expect(screen.queryByTestId('hooks-empty')).toBeNull());
  });

  it('read-only: the sentence alone, no button', async () => {
    render(<ObjectHooksPanel objectName="invoice" packageId="com.example.invoicing" disabled />);
    expect(await screen.findByTestId('hooks-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('hooks-empty-new')).toBeNull();
  });

  it('CONTROL: an object a hook targets keeps the list and the pick prompt', async () => {
    state.hooks = [{ name: 'h1', label: 'H1', object: 'invoice', events: ['beforeInsert'], body: { language: 'js', source: 'return;' } }];
    render(<ObjectHooksPanel objectName="invoice" packageId="com.example.invoicing" />);
    expect(await screen.findByText('H1')).toBeInTheDocument();
    expect(screen.queryByTestId('hooks-empty')).toBeNull();
    // A hook is there to pick, so the prompt to pick it stays.
    expect(screen.getByText(t('engine.studio.hooks.pick', 'en'))).toBeInTheDocument();
  });
});
