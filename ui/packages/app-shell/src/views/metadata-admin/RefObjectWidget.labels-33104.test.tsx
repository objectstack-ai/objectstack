// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The All-metadata form's object-reference picker (`ref:object`, e.g. Page →
 * Object) offers each object by its label, with the machine name as secondary
 * monospace text — the face the Studio `ObjectPicker` (flow trigger Object,
 * Lookup Related object) already draws. An object that declares no label is
 * offered by its name, once. The value written is always the name.
 *
 * Two levels, because the defect had two halves:
 *
 *   • the PAGE — `MetadataResourceEditPage` reads the object list once and must
 *     carry each entry's label to the picker from that same response (no second
 *     list read);
 *   • the FORM — `SchemaForm` with the page type's real `createSchema`, driven
 *     through the opened Radix select: the option text, and the value a click
 *     writes.
 */

import '@testing-library/jest-dom/vitest';
// The source loads these lazily; pay that load at collection, not inside a
// case's clocked window.
import '@objectstack/lint';
import '@object-ui/plugin-detail';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SchemaForm } from './SchemaForm';
import { loaded } from './loadState';
import { registerBuiltinAnchors } from './anchors';
import { resolveResourceConfig } from './registry';

registerBuiltinAnchors();

const LABELLED = { name: 'r5lbl_item', label: 'R5 Label Item' };
/** CONTROL: an object that declares no label. */
const UNLABELLED = 'showcase_note';

/** Open a Radix Select trigger the way the other suites in this directory do. */
async function openSelect(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
}

/**
 * The option offering object `name`, found by the name it shows — in any face,
 * so the same lookup finds it on a build that draws the bare name.
 */
function optionFor(name: string): HTMLElement {
  const el = screen.getAllByRole('option').find((o) => (o.textContent ?? '').includes(name));
  expect(el, `no option writes ${name}`).toBeTruthy();
  return el as HTMLElement;
}

/** Assert one option's face: label primary, name secondary in monospace — or the bare name, once. */
function expectFace(option: HTMLElement, name: string, label?: string) {
  const nameLine = option.querySelector('[data-object-name-line]');
  if (label) {
    expect(option).toHaveTextContent(label);
    expect(nameLine).not.toBeNull();
    expect(nameLine).toHaveTextContent(name);
    expect(nameLine).toHaveClass('font-mono', 'text-muted-foreground');
    // Label first: the primary text is the label, not the name.
    expect((option.textContent ?? '').trim().startsWith(label)).toBe(true);
  } else {
    expect(nameLine).toBeNull();
    expect((option.textContent ?? '').trim()).toBe(name);
  }
}

afterEach(cleanup);

describe('ref:object in SchemaForm (Page → Object) offers labels over machine names', () => {
  const page = resolveResourceConfig('page');

  function renderPageCreateForm(onChange: (v: Record<string, unknown>) => void) {
    return render(
      <SchemaForm
        schema={page.createSchema}
        value={{}}
        createMode
        onChange={onChange}
        widgetContext={{
          conditionScope: 'flattened',
          objectNames: loaded([LABELLED.name, UNLABELLED]),
          objectLabels: new Map([[LABELLED.name, LABELLED.label]]),
        }}
      />,
    );
  }

  it('a labelled object: label primary, name secondary; choosing it writes the NAME', async () => {
    const onChange = vi.fn();
    renderPageCreateForm(onChange);
    const trigger = document.getElementById('mdf-object');
    expect(trigger?.getAttribute('role')).toBe('combobox');
    await openSelect(trigger as HTMLElement);

    const option = optionFor(LABELLED.name);
    expectFace(option, LABELLED.name, LABELLED.label);

    fireEvent.click(option);
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(last?.object).toBe(LABELLED.name);
  });

  it('CONTROL: an object with no label is offered by its name, once', async () => {
    renderPageCreateForm(vi.fn());
    await openSelect(document.getElementById('mdf-object') as HTMLElement);
    expectFace(optionFor(UNLABELLED), UNLABELLED);
  });
});

/* -------------------------------------------------------------------------- */
/* The page: the label travels from the one object-list read                  */
/* -------------------------------------------------------------------------- */

const SOURCE_OBJECT = 'showcase_account';
const EFFECTIVE = { name: SOURCE_OBJECT, label: 'Account', object: SOURCE_OBJECT };
const LAYERED = {
  code: { ...EFFECTIVE, _packageId: 'com.example.showcase', _provenance: 'package' },
  overlay: null,
  effective: { ...EFFECTIVE },
  provenance: 'package',
  packageId: 'com.example.showcase',
  editable: true,
  deletable: true,
  resettable: true,
};

const mockClient = {
  list: vi.fn(async (type: string) =>
    type === 'object' ? [{ name: LABELLED.name, label: LABELLED.label }, { name: UNLABELLED }] : [],
  ),
  get: vi.fn(async () => ({ fields: {}, actions: [] })),
  listDrafts: vi.fn(async () => []),
  getDraft: vi.fn(async () => null),
  layered: vi.fn(async () => LAYERED),
  reset: vi.fn(async () => ({ success: true })),
  references: vi.fn(async () => []),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        {
          type: 'page',
          name: 'page',
          label: 'Page',
          allowEnvironmentOverlay: true,
          allowRuntimeCreate: true,
          schema: { type: 'object', properties: { object: { type: 'string' } } },
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';

describe('MetadataResourceEditPage (Page → Create new) carries each object label from its one list read', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the picker shows the label the list answered, and the list is read once', async () => {
    render(
      <MemoryRouter initialEntries={['/metadata/page/new']}>
        <Routes>
          <Route path="/metadata/page/new" element={<MetadataResourceEditPage type="page" name="" createMode />} />
        </Routes>
      </MemoryRouter>,
    );
    // The loaded arm renders the Radix trigger (a button) under the row's id.
    const trigger = await waitFor(
      () => {
        const el = document.getElementById('mdf-object');
        expect(el?.getAttribute('role')).toBe('combobox');
        return el as HTMLElement;
      },
      { timeout: 5000 },
    );
    await openSelect(trigger);

    expectFace(optionFor(LABELLED.name), LABELLED.name, LABELLED.label);
    expectFace(optionFor(UNLABELLED), UNLABELLED);
    // No second object-list fetch: the labels came from the read the names did.
    expect(mockClient.list.mock.calls.filter(([type]) => type === 'object')).toHaveLength(1);
  });
});
