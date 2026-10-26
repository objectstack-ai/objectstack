// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package OWD overview picks with the shared `Select` (objectui#11865).
 *
 * Each row's sharing-model dial was a browser-native select, beside the
 * shared Radix `Select` the rest of Studio picks with. The card asks for one
 * control for one kind of choice, surface by surface; this suite covers this
 * panel's dial.
 *
 * What is pinned:
 *   - each dial IS the primitive (a Radix combobox trigger), shows the row's
 *     value, and no native select is left;
 *   - the native dials had no label and so no accessible name; the triggers
 *     have none either;
 *   - every option of the dial, picked and saved, sends the draft save the
 *     native control's pick sent, compared as JSON text; re-picking the
 *     current option leaves the row clean, so Save stays disabled;
 *   - read-only draws no dial at all, as before: the row shows the label;
 *   - a stored value no option carries is what the trigger shows;
 *   - the keyboard alone opens a dial and selects.
 *
 * DIRECTION, observed against the native control: every pin here is red
 * there except three, which hold on both: the two read-only cases, and the
 * name pin, because the native dials had no name either. Each other pin reads
 * the dials as the primitive's triggers. What makes the save pins guards of
 * "the conversion changed nothing the panel writes" is the literal each
 * compares against: a `change` event on the pre-conversion panel's native
 * dial, then Save, sent that same JSON, read once on that component. The names
 * were read there the same way.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';

const en = (key: string) => t(key, 'en-US');

type Body = Record<string, unknown>;

/** A fake metadata client: published objects, no drafts, and every save recorded. */
function makeServer(objects: Record<string, Body>) {
  const saved: unknown[] = [];
  const client = {
    list: async () => Object.entries(objects).map(([name, body]) => ({ name, label: body.label ?? name })),
    listDrafts: async () => [],
    layered: async (_type: string, name: string) => ({ effective: objects[name] ?? {}, code: null }),
    getDraft: async () => null,
    save: async (_type: string, name: string, body: Body, opts?: Body) => {
      saved.push({ name, body, opts });
      objects[name] = body;
      return body;
    },
  } as unknown as React.ComponentProps<typeof PackageOwdOverviewPanel>['client'];
  return { client, saved };
}

/** Two rows, each holding one of the dial's own options. */
const OBJECTS = (): Record<string, Body> => ({
  p_int: { name: 'p_int', label: 'Int', sharingModel: 'public_read' },
  p_ext: { name: 'p_ext', label: 'Ext', sharingModel: 'public_read_write' },
});

const DIALS = ['owd-internal-p_int', 'owd-internal-p_ext'] as const;

async function renderPanel(objects: Record<string, Body> = OBJECTS(), readOnly?: boolean) {
  const server = makeServer(objects);
  const utils = render(
    <PackageOwdOverviewPanel client={server.client} packageId="pkg.a" locale="en-US" readOnly={readOnly} />,
  );
  await screen.findByTestId('owd-row-p_int');
  return { ...utils, saved: server.saved };
}

/** Open a dial from the keyboard and return the options it lists, in order. */
async function openDial(testId: string): Promise<HTMLElement[]> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(testId: string, label: string): Promise<void> {
  const options = await openDial(testId);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`${testId} lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
}

const saveButton = () => screen.getByTestId('owd-save') as HTMLButtonElement;

beforeEach(() => {
  // jsdom has no layout — stub the scroll used by the deep-link highlight.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('the OWD overview dials are the shared Select (objectui#11865)', () => {
  it('renders each dial as the Radix combobox trigger, showing the row’s value', async () => {
    const { container } = await renderPanel();
    expect(container.querySelector('select')).toBeNull();

    const shown: Record<string, string> = {};
    for (const id of DIALS) {
      const trigger = screen.getByTestId(id);
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger).toHaveAttribute('role', 'combobox');
      shown[id] = trigger.textContent ?? '';
    }
    expect(shown).toEqual({
      'owd-internal-p_int': en('engine.studio.settings.sharingPublicRead'),
      'owd-internal-p_ext': en('engine.studio.settings.sharingPublicReadWrite'),
    });
  });

  it('the native dials had no name, and the triggers have none either', async () => {
    await renderPanel();
    const unnamed = screen.getAllByRole('combobox', { name: '' });
    expect(unnamed).toHaveLength(DIALS.length);
    for (const id of DIALS) expect(unnamed, id).toContain(screen.getByTestId(id));
  });
});

const SAVED = (name: string, body: Body) =>
  JSON.stringify([{ name, body, opts: { mode: 'draft', packageId: 'pkg.a', surface: 'studio' } }]);

/**
 * [dial, option label, the JSON text of the saves Save sent]. `null`: the
 * option is the row's current value, so the row stays clean and Save stays
 * disabled.
 */
const WRITES: ReadonlyArray<readonly [string, string, string | null]> = [
  ['owd-internal-p_int', en('engine.studio.settings.sharingUnset'), SAVED('p_int', { name: 'p_int', label: 'Int' })],
  ['owd-internal-p_int', en('engine.studio.settings.sharingPrivate'), SAVED('p_int', { name: 'p_int', label: 'Int', sharingModel: 'private' })],
  ['owd-internal-p_int', en('engine.studio.settings.sharingPublicRead'), null],
  ['owd-internal-p_int', en('engine.studio.settings.sharingPublicReadWrite'), SAVED('p_int', { name: 'p_int', label: 'Int', sharingModel: 'public_read_write' })],
  ['owd-internal-p_int', en('engine.studio.settings.sharingControlledByParent'), SAVED('p_int', { name: 'p_int', label: 'Int', sharingModel: 'controlled_by_parent' })],
];

describe('every option saves what the native dial saved', () => {
  it('the table covers every option of the dial, in the order it lists them', async () => {
    for (const id of ['owd-internal-p_int']) {
      await renderPanel();
      const listed = (await openDial(id)).map((o) => o.textContent);
      expect(listed, id).toEqual(WRITES.filter(([d]) => d === id).map(([, label]) => label));
      cleanup();
    }
  });

  it.each(WRITES.map((row) => [`${row[0]} → ${row[1]}`, ...row] as const))(
    '%s',
    async (_name, testId, label, json) => {
      const { saved } = await renderPanel();
      await pick(testId, label);
      if (json === null) {
        expect(saveButton()).toBeDisabled();
        expect(saved).toEqual([]);
        return;
      }
      expect(saveButton()).toBeEnabled();
      fireEvent.click(saveButton());
      await waitFor(() => expect(saved).toHaveLength(1));
      expect(JSON.stringify(saved)).toBe(json);
    },
  );
});

describe('read-only draws no dial, as before', () => {
  it('each row shows its values as text, and no picker is drawn', async () => {
    const { container } = await renderPanel(OBJECTS(), true);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
    expect(container.querySelector('select')).toBeNull();
    for (const id of DIALS) expect(screen.queryByTestId(id), id).toBeNull();
    expect(screen.getByTestId('owd-row-p_ext')).toHaveTextContent(en('engine.studio.settings.sharingPublicReadWrite'));
  });

  it('CONTROL — writable: the same rows draw both dials, enabled', async () => {
    await renderPanel();
    for (const id of DIALS) expect(screen.getByTestId(id)).toBeEnabled();
  });
});

describe('a stored value no option carries is what the trigger shows', () => {
  it('a sharing model the dial does not offer is shown and listed first, and re-picking it changes nothing', async () => {
    const { saved } = await renderPanel({
      p_int: { name: 'p_int', label: 'Int', sharingModel: 'full' },
    });
    // The native dial showed "not set" here, as if no model were set.
    expect(screen.getByTestId('owd-internal-p_int')).toHaveTextContent('full');
    const listed = (await openDial('owd-internal-p_int')).map((o) => o.textContent);
    expect(listed[0]).toBe('full');
    expect(listed.slice(1)).toEqual(WRITES.filter(([d]) => d === 'owd-internal-p_int').map(([, label]) => label));
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(saveButton()).toBeDisabled();
    expect(saved).toEqual([]);
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens a dial and Enter on an option selects it', async () => {
    const { saved } = await renderPanel();
    fireEvent.keyDown(screen.getByTestId('owd-internal-p_int'), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(
      within(listbox).getByRole('option', { name: en('engine.studio.settings.sharingPrivate') }),
      { key: 'Enter' },
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(JSON.stringify(saved)).toBe(SAVED('p_int', { name: 'p_int', label: 'Int', sharingModel: 'private' }));
  });
});
