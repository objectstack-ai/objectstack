// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * *Explain access* picks its object and its operation with the shared `Select`
 * (objectui#11865).
 *
 * The request form picked the object (a package's objects, plus "select an
 * object") and the operation with browser-native selects, beside the shared
 * Radix `Select` the rest of Studio picks with. The card asks for one control
 * for one kind of choice, surface by surface; this suite covers this panel's
 * two pickers.
 *
 * What is pinned:
 *   - each picker IS the primitive (a Radix combobox trigger), keeps the name
 *     its `<label htmlFor>` gave the native control, and no native select is
 *     left;
 *   - every option of both pickers sets what the native control set, read
 *     back as the explain request the panel then sends: the JSON body, or a
 *     disabled Explain button for "select an object" (the object is `''`);
 *   - re-picking the current option sets nothing;
 *   - an object the package does not list is what the object trigger shows;
 *   - the keyboard alone opens a picker and selects.
 *
 * Not pinned, because the panel has none: a disabled or read-only state. The
 * panel asks a question and writes no metadata, so a read-only package
 * renders the same form (objectui#11781 has no reach here).
 *
 * DIRECTION, observed against the native controls: every pin here is red
 * there, because each one opens the primitive's listbox or reads its trigger.
 * What makes the request pins guards of "the conversion changed nothing the
 * form sends" is the literal each compares against: a `change` event on the
 * pre-conversion panel's native control, followed by Explain, sent that same
 * body, read once on that component.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const fetchSpy = vi.fn();
// The package's objects, as the metadata client lists them; unsorted, as a
// server may send them. A `mock` prefix so the hoisted factory may close over it.
const mockObjectList = [
  { item: { name: 'showcase_task' } },
  { item: { name: 'showcase_account', label: 'Account' } },
  { item: { name: 'showcase_project', label: 'showcase_project' } },
];
// One client for every render, so the panel's list effect runs once per open.
const mockClient = { list: async () => mockObjectList };

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => fetchSpy,
}));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ({ find: vi.fn(async () => []) }),
}));
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => mockClient,
}));
// The record and user pickers have their own coverage.
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: () => null,
}));

import { AccessExplainPanel } from './AccessExplainPanel';

afterEach(() => {
  cleanup();
  fetchSpy.mockReset();
});

const DECISION = {
  allowed: true,
  object: 'showcase_task',
  operation: 'read',
  principal: { userId: 'u_1', positions: [], permissionSets: [] },
  layers: [{ layer: 'object_crud', verdict: 'grants', detail: 'granted', contributors: [] }],
};

/**
 * Mount the panel scoped to a package, starting on `defaultObject` (`null`: on
 * no object), and wait for the object picker to replace the free-text input.
 */
async function mount(defaultObject: string | null = 'showcase_task'): Promise<void> {
  render(
    <AccessExplainPanel
      open
      onOpenChange={() => {}}
      packageId="com.example.showcase"
      defaultObject={defaultObject ?? undefined}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText('Object')).toHaveAttribute('role', 'combobox'));
}

const trigger = (name: 'Object' | 'Operation') => screen.getByRole('combobox', { name });

/** Open a picker from the keyboard and return the options it lists, in order. */
async function openPicker(name: 'Object' | 'Operation'): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger(name), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(name: 'Object' | 'Operation', label: string): Promise<void> {
  const options = await openPicker(name);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`${name} lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

/** What Explain sends now: the request body, or `DISABLED` when the button cannot be pressed. */
async function explainBody(): Promise<string> {
  const button = screen.getByRole('button', { name: /explain$/i });
  if ((button as HTMLButtonElement).disabled) return 'DISABLED';
  fetchSpy.mockResolvedValue({ ok: true, status: 200, statusText: '', json: async () => DECISION });
  fireEvent.click(button);
  await screen.findByTestId('explain-verdict');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  return String(fetchSpy.mock.calls[0][1].body);
}

describe('Explain access pickers are the shared Select (objectui#11865)', () => {
  it('renders each picker as the Radix combobox trigger, named by its label, with no native select left', async () => {
    await mount();
    expect(document.querySelector('select')).toBeNull();

    for (const [name, id, shown] of [
      ['Object', 'explain-object', 'showcase_task'],
      ['Operation', 'explain-operation', 'Read'],
    ] as const) {
      const el = trigger(name);
      expect(el.tagName).toBe('BUTTON');
      expect(el).toHaveAttribute('id', id);
      expect(el).toHaveTextContent(shown);
    }
  });

  it('opens on "select an object" when nothing is chosen, and Explain waits for an object', async () => {
    await mount(null);
    expect(trigger('Object')).toHaveTextContent('Select an object…');
    expect(await explainBody()).toBe('DISABLED');
  });
});

/**
 * [picker, option label, what Explain sends after the pick]. The panel starts
 * on `showcase_task` / `Read`, so the `showcase_task` and `Read` rows re-pick
 * the current option, and set nothing.
 */
const PICKS: ReadonlyArray<readonly ['Object' | 'Operation', string, string]> = [
  ['Object', 'Select an object…', 'DISABLED'],
  ['Object', 'Account (showcase_account)', '{"object":"showcase_account","operation":"read"}'],
  ['Object', 'showcase_project', '{"object":"showcase_project","operation":"read"}'],
  ['Object', 'showcase_task', '{"object":"showcase_task","operation":"read"}'],
  ['Operation', 'Read', '{"object":"showcase_task","operation":"read"}'],
  ['Operation', 'Create', '{"object":"showcase_task","operation":"create"}'],
  ['Operation', 'Update', '{"object":"showcase_task","operation":"update"}'],
  ['Operation', 'Delete', '{"object":"showcase_task","operation":"delete"}'],
  ['Operation', 'Transfer', '{"object":"showcase_task","operation":"transfer"}'],
  ['Operation', 'Restore', '{"object":"showcase_task","operation":"restore"}'],
  ['Operation', 'Purge', '{"object":"showcase_task","operation":"purge"}'],
];

describe('every option sets what the native control set', () => {
  it('the table covers every option of both pickers, in the order each lists them', async () => {
    for (const name of ['Object', 'Operation'] as const) {
      await mount();
      const listed = (await openPicker(name)).map((o) => o.textContent);
      expect(listed, name).toEqual(PICKS.filter(([p]) => p === name).map(([, label]) => label));
      cleanup();
    }
  });

  it.each(PICKS.map((row) => [`${row[0]} → ${row[1]}`, ...row] as const))('%s', async (_name, name, label, sent) => {
    await mount();
    await pick(name, label);
    expect(trigger(name)).toHaveTextContent(label);
    expect(await explainBody()).toBe(sent);
  });
});

describe('an object the package does not list is what the trigger shows', () => {
  it('shown, listed first, and re-picking it sets nothing', async () => {
    await mount('crm_lead');
    // The native control showed "Select an object…" here, while Explain asked about crm_lead.
    expect(trigger('Object')).toHaveTextContent('crm_lead');
    const listed = (await openPicker('Object')).map((o) => o.textContent);
    expect(listed).toEqual(['crm_lead', 'Select an object…', 'Account (showcase_account)', 'showcase_project', 'showcase_task']);
    fireEvent.click(screen.getAllByRole('option')[0]);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(await explainBody()).toBe('{"object":"crm_lead","operation":"read"}');
  });
});

describe('the keyboard alone picks', () => {
  it.each([
    ['Object', 'showcase_project', '{"object":"showcase_project","operation":"read"}'],
    ['Operation', 'Delete', '{"object":"showcase_task","operation":"delete"}'],
  ] as const)('%s: Enter opens it and Enter on an option selects it', async (name, label, sent) => {
    await mount();
    fireEvent.keyDown(trigger(name), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: label }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger(name)).toHaveTextContent(label);
    expect(await explainBody()).toBe(sent);
  });
});
