// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12680 — in a designer's create mode, a Name the author typed
 * survives every later Label edit.
 *
 * Two derivations write `name` from `label` while a new item is authored: the
 * host's registry rule (`createDerive`, label → name, `untilUserEdits`) and the
 * curated default inspector's own Label handler. Each replaced a hand-typed
 * name in its own way:
 *
 *   - the host's "touched" set was fed by the generic SchemaForm alone, so a
 *     Name typed in the designer's home panel, or written in the Source tab,
 *     never marked it, and the next Label keystroke replaced it (object and
 *     report carry the rule; the object's label → pluralLabel rule did the same
 *     to a typed plural label);
 *   - the inspector kept "the author edited the name" in a component-local
 *     ref, which the Properties → Source → Properties round trip resets by
 *     remounting the panel, so its next Label keystroke replaced the name too
 *     (object, report and dataset).
 *
 * The REAL page with the production registrations (`register-builtins` and the
 * built-in designers), so the panel under test is the registered default
 * inspector, not one rendered alone. Keystrokes are real (user-event), as in
 * the card's reproduction. The controls: with no Name typed, the Label still
 * derives it; an existing item's name never moves.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

type DesignerType = 'object' | 'report' | 'dataset';

const SCHEMA = { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' } } };
const ENTRIES = (['object', 'report', 'dataset'] as const).map((type) => ({
  type,
  label: type,
  domain: 'data',
  allowEnvironmentOverlay: true,
  allowRuntimeCreate: true,
  schema: SCHEMA,
}));

/** The stored items the edit-mode control opens, by type. */
const STORED: Record<DesignerType, Record<string, unknown>> = {
  object: { name: 'acme_task', label: 'Task', fields: {} },
  report: { name: 'acme_pipeline', label: 'Pipeline', type: 'summary', dataset: 'sales' },
  dataset: { name: 'acme_sales', label: 'Sales', object: 'opportunity', dimensions: [], measures: [] },
};
const stored = (type: string, name: string) =>
  (STORED as Record<string, Record<string, unknown>>)[type]?.name === name
    ? (STORED as Record<string, Record<string, unknown>>)[type]
    : null;

const CLIENT = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async (type: string, name: string) => stored(type, name)),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    const item = stored(type, name);
    return item ? { effective: item, code: item, editable: true } : null;
  }),
  save: vi.fn(async (_type: string, _name: string, payload: Record<string, unknown>) => payload),
  history: vi.fn(async () => []),
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMetadata')>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
}));
// The Source tab's editor falls back to its plain textarea when Monaco's
// loader rejects — the shape an offline install gets, and one a test can type
// into.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});
// The page's own side reads (the AI agents roster and the like) go through the
// global `fetch`; one double answers "absent" for the whole file, so no read
// can reach a socket after a test body returns.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

import { MetadataResourceEditPage } from './ResourceEditPage';
// The load-time registrations, exactly as the package entry runs them: the
// `createDerive` rules under test are registered here.
import './register-builtins';
// The built-in designers, which the package entry registers from a lazily
// loaded chunk; called at module scope so they exist before the first render.
import { registerBuiltinDesigners } from './register-builtin-designers';
registerBuiltinDesigners();

beforeEach(() => {
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
});

function mountCreate(type: DesignerType): void {
  render(
    <MemoryRouter initialEntries={[`/metadata/${type}/new`]}>
      <MetadataResourceEditPage type={type} name="" createMode />
    </MemoryRouter>,
  );
}

function mountEdit(type: DesignerType): void {
  const name = STORED[type].name as string;
  render(
    <MemoryRouter initialEntries={[`/metadata/${type}/${name}`]}>
      <MetadataResourceEditPage type={type} name={name} />
    </MemoryRouter>,
  );
}

/** The designer's Name input (the object designer's carries a test id). */
function findName(type: DesignerType): Promise<HTMLInputElement> {
  return (
    type === 'object'
      ? screen.findByTestId('object-name-input', {}, { timeout: 8000 })
      : screen.findByLabelText('Name', { exact: true }, { timeout: 8000 })
  ) as Promise<HTMLInputElement>;
}
const labelInput = () => screen.getByLabelText('Label', { exact: true }) as HTMLInputElement;

/** The draft as the Source tab shows it (the document a save sends). */
async function sourceDraft(): Promise<Record<string, unknown>> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: /Source/ }));
  const box = (await screen.findByRole('textbox', { name: 'JSON source' }, { timeout: 8000 })) as HTMLTextAreaElement;
  return JSON.parse(box.value) as Record<string, unknown>;
}

// The card's reproduction: a namespaced name, prefix included. Every designer's
// Name keeps a typed underscore (objectui#12746: the report and dataset Name
// fields used to drop it on each keystroke).
const CASES: ReadonlyArray<{ type: DesignerType; typed: string }> = [
  { type: 'object', typed: 'qavrf_hand_typed' },
  { type: 'report', typed: 'qavrf_hand_typed' },
  { type: 'dataset', typed: 'qavrf_hand_typed' },
];

describe('designer create mode — a typed Name survives a later Label edit (objectui#12680)', () => {
  for (const { type, typed } of CASES) {
    it(`${type}: Name typed, then Label typed and tabbed out of — the Name keeps the typed value`, async () => {
      const user = userEvent.setup();
      mountCreate(type);
      const name = await findName(type);
      await user.click(name);
      await user.type(name, typed);
      expect(name).toHaveValue(typed);

      await user.click(labelInput());
      await user.type(labelInput(), 'Repair Asset');
      await user.tab();

      expect(await findName(type)).toHaveValue(typed);
      expect((await sourceDraft()).name).toBe(typed);
    });

    it(`${type}: the panel remounts on a Properties → Source → Properties round trip, and the typed Name still survives the Label`, async () => {
      const user = userEvent.setup();
      mountCreate(type);
      const before = await findName(type);
      await user.type(before, typed);

      await user.click(screen.getByRole('tab', { name: /Source/ }));
      await user.click(screen.getByRole('tab', { name: /Properties/ }));
      const after = await findName(type);
      // The remount this case is about: the Name input is a new node.
      expect(after).not.toBe(before);
      expect(after).toHaveValue(typed);

      await user.type(labelInput(), 'Repair Asset');
      await user.tab();

      expect(await findName(type)).toHaveValue(typed);
    });

    it(`${type}: a name written in the Source tab beside a label is kept as written`, async () => {
      const user = userEvent.setup();
      mountCreate(type);
      await findName(type);
      await user.click(screen.getByRole('tab', { name: /Source/ }));
      const box = (await screen.findByRole('textbox', { name: 'JSON source' }, { timeout: 8000 })) as HTMLTextAreaElement;
      const seeded = JSON.parse(box.value) as Record<string, unknown>;
      fireEvent.change(box, {
        target: { value: JSON.stringify({ ...seeded, name: 'repairs_qa_invalid_probe', label: 'QA Invalid Probe' }) },
      });
      // Let the page's derivation effect run on the new draft.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      const shown = screen.getByRole('textbox', { name: 'JSON source' }) as HTMLTextAreaElement;
      expect((JSON.parse(shown.value) as Record<string, unknown>).name).toBe('repairs_qa_invalid_probe');
      await user.click(screen.getByRole('tab', { name: /Properties/ }));
      expect(await findName(type)).toHaveValue('repairs_qa_invalid_probe');
    });

    it(`${type}: control — with no Name typed, the Label still derives it`, async () => {
      const user = userEvent.setup();
      mountCreate(type);
      const name = await findName(type);
      await user.type(labelInput(), 'Repair Asset');
      await user.tab();
      expect(name).toHaveValue('repair_asset');
    });

    it(`${type}: control — an existing item's name never follows its Label`, async () => {
      const user = userEvent.setup();
      mountEdit(type);
      const label = (await screen.findByLabelText('Label', { exact: true }, { timeout: 8000 })) as HTMLInputElement;
      // The control is only a control if the Label edit really happens.
      expect(label).toBeEnabled();
      await user.clear(label);
      await user.type(label, 'Repair Asset');
      await user.tab();
      expect(screen.getByLabelText('Label', { exact: true })).toHaveValue('Repair Asset');
      expect((await sourceDraft()).name).toBe(STORED[type].name);
    });
  }

  it('object: a Plural label typed before the Label keeps its value; untouched, it follows the Label', async () => {
    const user = userEvent.setup();
    mountCreate('object');
    await findName('object');
    const plural = screen.getByLabelText('Plural label', { exact: true }) as HTMLInputElement;
    await user.type(plural, 'Fleet');
    await user.type(labelInput(), 'Repair Asset');
    await user.tab();
    expect(plural).toHaveValue('Fleet');

    cleanup();
    mountCreate('object');
    await findName('object');
    await user.type(labelInput(), 'Repair Asset');
    await user.tab();
    expect(screen.getByLabelText('Plural label', { exact: true })).toHaveValue('Repair Assets');
  });
});
