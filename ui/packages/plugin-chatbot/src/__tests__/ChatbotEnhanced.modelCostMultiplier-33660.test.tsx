/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The composer's model picker shows what each model costs at the moment of
 * choice (objectstack#33660).
 *
 * `ChatbotModelOption.costMultiplier` is the factor by which one message on a
 * model draws on the AI allowance, against the environment's default model
 * (`AiModelsResponseSchema`'s `costMultiplier`). `allowanceUsedFraction` is the
 * used share of that allowance (`GET /ai/usage` `pool.fraction`).
 *
 * What is pinned, through the rendered picker (the Radix `Select`, opened from
 * the keyboard, options clicked):
 *   - each model with a multiplier draws `×N` beside its label; a model with
 *     none draws none (never a guessed `×1`);
 *   - a pick at ×20 or above asks once: Cancel keeps the model in force and
 *     writes nothing, Confirm writes the pick;
 *   - CONTROL: a ×1 or ×5 pick writes at once, with no dialog;
 *   - the allowance note shows the share left when usage is served, and is
 *     absent without it;
 *   - the drawn (rounded) multiplier is what the ×20 question compares, a small
 *     one never reads ×0, and a non-finite or zero value draws nothing;
 *   - Confirm writes the asked-about model as the CURRENT list has it, and a
 *     model that leaves the list, or whose drawn multiplier falls below ×20 or
 *     goes, while asked is dropped.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { ChatbotEnhanced, type ChatbotModelOption } from '../ChatbotEnhanced';

afterEach(() => cleanup());

const MODELS: ChatbotModelOption[] = [
  { id: 'haiku', label: 'Fast', costMultiplier: 1 },
  { id: 'sonnet', label: 'Advanced', costMultiplier: 5 },
  { id: 'opus', label: 'Expert', costMultiplier: 20 },
  { id: 'local', label: 'Local' },
];

function mount(extra: Record<string, unknown> = {}, models: ChatbotModelOption[] = MODELS) {
  const onModelChange = vi.fn();
  const element = (list: ChatbotModelOption[]) => (
    <ChatbotEnhanced
      models={list}
      selectedModelId="haiku"
      onModelChange={onModelChange}
      onSendMessage={vi.fn()}
      {...extra}
    />
  );
  const view = render(element(models));
  return {
    onModelChange,
    trigger: () => screen.getByRole('combobox', { name: 'Model' }),
    /** The host hands the picker a new model list. */
    relist: (list: ChatbotModelOption[]) => view.rerender(element(list)),
  };
}

async function openPicker(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return screen.findByRole('listbox');
}

async function pick(trigger: HTMLElement, label: string): Promise<void> {
  const listbox = await openPicker(trigger);
  const option = within(listbox)
    .getAllByRole('option')
    .find((o) => o.textContent?.startsWith(label));
  if (!option) throw new Error(`the picker lists no "${label}"`);
  fireEvent.click(option);
}

function multiplierOf(option: HTMLElement): string | null {
  return option.querySelector('[data-testid="model-cost-multiplier"]')?.textContent ?? null;
}

describe('ChatbotEnhanced — the model picker shows each model’s cost multiplier (objectstack#33660)', () => {
  it('draws ×N beside each model that has one, and nothing beside a model that has none', async () => {
    const { trigger } = mount();
    const listbox = await openPicker(trigger());
    const options = within(listbox).getAllByRole('option');
    expect(options.map(multiplierOf)).toEqual(['×1', '×5', '×20', null]);
  });

  // objectstack#35445 — the closed trigger names the model in force and draws no
  // multiplier (and no provider); the list, where the choice is made, keeps them.
  it('the trigger names the model in force alone, with no multiplier; its full name is its title', () => {
    const { trigger } = mount({ selectedModelId: 'sonnet' });
    expect(multiplierOf(trigger())).toBeNull();
    expect(trigger().textContent).toBe('Advanced');
    expect(trigger()).toHaveAttribute('title', 'Advanced');
  });

  it('a fractional multiplier is drawn as the number it is', async () => {
    const { trigger } = mount({ selectedModelId: 'a' }, [
      { id: 'a', label: 'A', costMultiplier: 1 },
      { id: 'b', label: 'B', costMultiplier: 0.5 },
    ]);
    const options = within(await openPicker(trigger())).getAllByRole('option');
    expect(options.map(multiplierOf)).toEqual(['×1', '×0.5']);
  });

  it('the drawn number decides the question: 19.996 reads ×20 and asks, 19.994 reads ×19.99 and applies at once', async () => {
    const edge: ChatbotModelOption[] = [
      { id: 'haiku', label: 'Fast', costMultiplier: 1 },
      { id: 'over', label: 'Over', costMultiplier: 19.996 },
      { id: 'under', label: 'Under', costMultiplier: 19.994 },
    ];
    const { onModelChange, trigger } = mount({}, edge);
    const options = within(await openPicker(trigger())).getAllByRole('option');
    expect(options.map(multiplierOf)).toEqual(['×1', '×20', '×19.99']);
    fireEvent.click(options[1]);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(onModelChange).not.toHaveBeenCalled();
    await pick(trigger(), 'Under');
    expect(onModelChange.mock.calls).toEqual([['under']]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a small multiplier never reads ×0, and a value that is no multiplier draws nothing', async () => {
    const { trigger } = mount({}, [
      { id: 'haiku', label: 'Fast', costMultiplier: 0.004 },
      { id: 'nan', label: 'NaN', costMultiplier: Number.NaN },
      { id: 'inf', label: 'Inf', costMultiplier: Number.POSITIVE_INFINITY },
      { id: 'zero', label: 'Zero', costMultiplier: 0 },
    ]);
    const options = within(await openPicker(trigger())).getAllByRole('option');
    expect(options.map(multiplierOf)).toEqual(['×0.004', null, null, null]);
  });

  it('Confirm writes the asked-about model from the current list, and a model that left the list while asked is dropped', async () => {
    const { onModelChange, trigger, relist } = mount();
    await pick(trigger(), 'Expert');
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    // The list reorders while the question is open: Confirm still writes Expert.
    relist([MODELS[2], MODELS[0], MODELS[1], MODELS[3]]);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Switch model' }));
    expect(onModelChange.mock.calls).toEqual([['opus']]);

    await pick(trigger(), 'Expert');
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    // Expert leaves the list: the question closes and nothing is written.
    relist([MODELS[0], MODELS[1], MODELS[3]]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // It comes back: the dropped pick does not ask again on its own.
    relist(MODELS);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onModelChange.mock.calls).toEqual([['opus']]);
  });

  it.each([
    ['falls below ×20', 5],
    ['is withdrawn', undefined],
  ])('a model whose multiplier %s while asked is dropped: the question closes and nothing is written', async (_case, next) => {
    const { onModelChange, trigger, relist } = mount();
    await pick(trigger(), 'Expert');
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    relist(MODELS.map((m) => (m.id === 'opus' ? { ...m, costMultiplier: next } : m)));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // It is ×20 again: the dropped pick does not ask on its own.
    relist(MODELS);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it('a ×20 pick asks first; Cancel keeps the model in force and writes nothing', async () => {
    const { onModelChange, trigger } = mount();
    await pick(trigger(), 'Expert');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Expert/)).toBeInTheDocument();
    expect(onModelChange).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(trigger().textContent).toContain('Fast');
  });

  it('a ×20 pick applies once confirmed', async () => {
    const { onModelChange, trigger } = mount();
    await pick(trigger(), 'Expert');
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch model' }));
    expect(onModelChange.mock.calls).toEqual([['opus']]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it.each([
    ['Fast', 'haiku', 'sonnet'],
    ['Advanced', 'sonnet', 'haiku'],
    ['Local', 'local', 'haiku'],
  ])('CONTROL: a pick of "%s" (below ×20 or none) applies at once, with no dialog', async (label, id, from) => {
    const { onModelChange, trigger } = mount({ selectedModelId: from });
    await pick(trigger(), label);
    expect(onModelChange.mock.calls).toEqual([[id]]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('with usage served the list notes the share of the allowance left, and the confirmation says it too', async () => {
    const { trigger } = mount({ allowanceUsedFraction: 0.25 });
    const listbox = await openPicker(trigger());
    const note = screen.getByTestId('model-allowance-note');
    expect(listbox.contains(note) || listbox.parentElement?.contains(note)).toBe(true);
    expect(note.textContent).toContain('75%');
    fireEvent.click(within(listbox).getAllByRole('option')[2]);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('75%');
    expect(dialog.textContent).toContain('20');
  });

  it('without usage served the multipliers show alone: no allowance note, and the confirmation names only the multiplier', async () => {
    const { trigger } = mount();
    const listbox = await openPicker(trigger());
    expect(screen.queryByTestId('model-allowance-note')).toBeNull();
    fireEvent.click(within(listbox).getAllByRole('option')[2]);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('20');
    expect(dialog.textContent).not.toContain('%');
  });

  it('CONTROL: with usage served but no model carrying a multiplier, there is no note', async () => {
    const { trigger } = mount({ allowanceUsedFraction: 0.25, selectedModelId: 'a' }, [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    await openPicker(trigger());
    expect(screen.queryByTestId('model-allowance-note')).toBeNull();
  });
});
