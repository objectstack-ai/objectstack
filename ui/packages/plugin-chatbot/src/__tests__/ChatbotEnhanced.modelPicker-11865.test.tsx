/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The composer's model picker picks with the shared `Select` (objectui#11865).
 *
 * The control was a browser-native select beside the shared Radix `Select`
 * the rest of the console picks with. The card asks for one control for one
 * kind of choice, surface by surface.
 *
 * What is pinned:
 *   - it IS the primitive (a Radix combobox trigger, with no visible native
 *     select beside it), keeps its accessible name, the `aria-label` the
 *     `model` label gives it, shows the model in force and lists the native
 *     control's options, with their text, in their order;
 *   - every option writes what the native control wrote: the model's `id`,
 *     handed to `onModelChange`, compared as JSON text over three selections
 *     (none, so the first model is in force; an offered model; a model none
 *     of the options carries). Re-picking the current model writes nothing;
 *   - a selected model none of the options carries is what the trigger shows;
 *   - the keyboard alone opens the picker and selects, inside the composer's
 *     form, without sending the draft;
 *   - the read-only transcript has no composer, so no picker, as before.
 *
 * DIRECTION, observed against the native control: every pin here reads the
 * control as the primitive's trigger, so each is red there except the name
 * row and the read-only row (green there by design: they keep a behaviour,
 * the `aria-label` name and the composer-less transcript). What makes the
 * write rows guards of "the conversion changed nothing the composer writes" is
 * the literal each compares against: a `change` event on the pre-conversion
 * native control wrote that same JSON, read once on this component with these
 * fixtures. That probe's `change` event fired for the current option too,
 * which a browser's native select does not do, so the re-pick rows pin the
 * primitive.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ChatbotEnhanced } from '../ChatbotEnhanced';

afterEach(() => cleanup());

const MODELS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai' },
  { id: 'claude-3-5-sonnet', label: 'Claude 3.5', provider: 'anthropic' },
  { id: 'local-llm' },
];

const SELECTIONS: Record<string, string | undefined> = {
  unset: undefined,
  claude: 'claude-3-5-sonnet',
  ghost: 'ghost-model',
};

function mount(selected: string | undefined, extra: Record<string, unknown> = {}) {
  const onModelChange = vi.fn();
  const onSendMessage = vi.fn();
  const view = render(
    <ChatbotEnhanced
      models={MODELS}
      selectedModelId={selected}
      onModelChange={onModelChange}
      onSendMessage={onSendMessage}
      {...extra}
    />,
  );
  return { onModelChange, onSendMessage, view, trigger: () => screen.getByRole('combobox', { name: 'Model' }) };
}

async function openPicker(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(trigger: HTMLElement, label: string): Promise<void> {
  const options = await openPicker(trigger);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`the picker lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
}

/**
 * [selection, option label, what the native control handed `onModelChange`].
 * `null` marks the model in force: re-picking it writes nothing.
 */
const WRITES: ReadonlyArray<readonly [string, string, string | null]> = [
  ['unset', 'GPT-4o mini · openai', null],
  ['unset', 'Claude 3.5 · anthropic', '[["claude-3-5-sonnet"]]'],
  ['unset', 'local-llm', '[["local-llm"]]'],
  ['claude', 'GPT-4o mini · openai', '[["gpt-4o-mini"]]'],
  ['claude', 'Claude 3.5 · anthropic', null],
  ['claude', 'local-llm', '[["local-llm"]]'],
  ['ghost', 'GPT-4o mini · openai', '[["gpt-4o-mini"]]'],
  ['ghost', 'Claude 3.5 · anthropic', '[["claude-3-5-sonnet"]]'],
  ['ghost', 'local-llm', '[["local-llm"]]'],
];

describe('ChatbotEnhanced — the model picker is the shared Select (objectui#11865)', () => {
  it('is the primitive, keeps its name, shows the model in force, and lists the native options in order', async () => {
    const { trigger, view } = mount(SELECTIONS.claude);
    expect(trigger().tagName).toBe('BUTTON');
    // Radix mirrors the value into a hidden native select inside a form; none is visible.
    expect(view.container.querySelectorAll('select:not([aria-hidden="true"])')).toHaveLength(0);
    expect(trigger().textContent).toBe('Claude 3.5 · anthropic');
    const options = await openPicker(trigger());
    expect(options.map((o) => o.textContent)).toEqual(['GPT-4o mini · openai', 'Claude 3.5 · anthropic', 'local-llm']);
  });

  it('with no selection the first model is in force', () => {
    expect(mount(SELECTIONS.unset).trigger().textContent).toBe('GPT-4o mini · openai');
  });

  it('takes its name from the `model` label', () => {
    mount(SELECTIONS.unset, { labels: { model: 'Modèle' } });
    expect(screen.getByRole('combobox', { name: 'Modèle' })).toHaveAttribute('aria-label', 'Modèle');
  });

  it.each(WRITES)('selection "%s", picking "%s" writes what the native control wrote', async (selection, label, json) => {
    const { onModelChange, trigger } = mount(SELECTIONS[selection]);
    await pick(trigger(), label);
    expect(JSON.stringify(onModelChange.mock.calls)).toBe(json ?? '[]');
  });

  it('a selected model none of the options carries is what the trigger shows, and re-picking it writes nothing', async () => {
    const { onModelChange, trigger } = mount(SELECTIONS.ghost);
    // The native control showed the first model here.
    expect(trigger().textContent).toBe('ghost-model');
    const options = await openPicker(trigger());
    expect(options.map((o) => o.textContent)).toEqual(['ghost-model', 'GPT-4o mini · openai', 'Claude 3.5 · anthropic', 'local-llm']);
    fireEvent.click(options[0]);
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it('Enter opens the picker and Enter on a model selects it, without sending the draft', async () => {
    const { onModelChange, onSendMessage, trigger } = mount(SELECTIONS.unset);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a draft' } });
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'local-llm' }), { key: 'Enter' });
    expect(onModelChange.mock.calls).toEqual([['local-llm']]);
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('the read-only transcript has no composer, so no picker', () => {
    mount(SELECTIONS.claude, { readOnly: true });
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
