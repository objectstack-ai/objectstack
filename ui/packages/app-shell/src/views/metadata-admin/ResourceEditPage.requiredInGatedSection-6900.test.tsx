// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Save refuses a form view that puts an OBJECT-required field inside a
 * predicate-gated section — on BOTH hosts of the view inspector
 * (objectui#6900, landed by ruling 5749269225, letter c).
 *
 * ## The hazard
 *
 * The server validates a record against the object's field definitions and
 * never reads a form view (ruled objectstack#13252, option C rejected). So a
 * form whose section is shown only when `'sales_manager' in
 * current_user.positions` and which holds the object-required `salary` saves
 * fine as metadata, and then cannot be completed by anyone the predicate hides
 * the section from: the record save is refused naming a field they cannot see.
 *
 * ## Why the refusal rides the inspector's blocking channel
 *
 * The ruling puts it in the channel ALREADY licensed to gate Save — the
 * inspector's blocking issues — and keeps the live Zod pass
 * (`validateMetadataDraft`) advisory. `ResourceEditPage.schemaAdvisory.test.tsx`
 * (objectui#6980) pins that asymmetry and is untouched by this card.
 *
 * ## Both hosts
 *
 * `ResourceEditPage` mounts the view inspector two ways: the DEFAULT inspector
 * when nothing is selected (`ViewDefaultInspector`) and the SCOPED one when the
 * canvas emits a variant selection (`ViewInspector`). Each is pinned here, so
 * the refusal cannot be wired on one of the two paths an author reaches the
 * same editor by.
 *
 * Only the canvas is stubbed (so a preview exists, and so the scoped leg can
 * emit its selection). The object catalog arrives through the real
 * `useObjectFields` read of `client.get('object', …)`, and the predicate's
 * roots are read by the real `@objectstack/formula` parser.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
// Module scope as well as where a test awaits it below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@objectstack/formula';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** Canonical wire shape — the same spelling as the objectui#6237 fixtures. */
const cel = (source: string) => ({ dialect: 'cel', source });
const IDENTITY_GATE = cel("'sales_manager' in current_user.positions");
const RECORD_GATE = cel("record.status == 'sent'");

const state = vi.hoisted(() => ({
  salaryRequired: true,
  gate: null as unknown,
}));

function employeeObject(): Record<string, unknown> {
  return {
    name: 'employee',
    label: 'Employee',
    fields: {
      subject: { type: 'text', label: 'Subject' },
      salary: { type: 'number', label: 'Salary', ...(state.salaryRequired ? { required: true } : {}) },
    },
  };
}

function formView(): Record<string, unknown> {
  return {
    name: 'employee_form',
    label: 'Employee form',
    object: 'employee',
    viewKind: 'form',
    config: {
      type: 'simple',
      sections: [
        { name: 'basics', label: 'Basics', fields: ['subject'] },
        { name: 'pay', label: 'Compensation', visibleWhen: state.gate, fields: ['salary'] },
      ],
    },
  };
}

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => {
    const view = formView();
    return { effective: view, code: view, editable: true };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async (type: string, name: string) =>
    type === 'object' && name === 'employee' ? employeeObject() : null,
  ),
  saveDraft: vi.fn(async () => ({})),
  withPreviewDrafts() { return this; },
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: 'view', name: 'view', label: 'View', allowEnvironmentOverlay: true }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerBuiltinInspectors } from './inspectors';
import { registerMetadataPreview, getMetadataPreview, type MetadataSelection } from './preview-registry';

registerBuiltinInspectors();

/**
 * Canvas stand-in. It exists so the host takes its split-editor branch; its one
 * button emits the variant selection the real tab strip emits, which is what
 * swaps the DEFAULT inspector for the SCOPED one.
 */
function StubViewCanvas({
  onSelectionChange,
}: {
  onSelectionChange?: (next: MetadataSelection | null) => void;
}) {
  return (
    <button type="button" onClick={() => onSelectionChange?.({ kind: 'view', id: 'config' })}>
      select the form variant
    </button>
  );
}

const realViewPreview = getMetadataPreview('view');

beforeEach(() => {
  state.salaryRequired = true;
  state.gate = IDENTITY_GATE;
  registerMetadataPreview('view', StubViewCanvas as never);
});

afterEach(() => {
  cleanup();
  if (realViewPreview) registerMetadataPreview('view', realViewPreview);
});

/** The Save icon button, identified by its title in either state. */
// Title flipped to the neutral inspector copy by ruling 5831744213 (objectui#6900).
const saveButton = () =>
  screen.getByRole('button', { name: /Save \(⌘S\)|Fix the issues shown in the inspector before saving\./ });

/**
 * Let the lazily imported CEL parser and the object-catalog read settle, so a
 * negative leg's green is observed AFTER the verdict it would have flipped.
 */
async function settle() {
  await act(async () => {
    await import('@objectstack/formula');
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function openEditor(host: 'default' | 'scoped') {
  render(
    <MemoryRouter initialEntries={['/metadata/view/employee_form']}>
      <MetadataResourceEditPage type="view" name="employee_form" />
    </MemoryRouter>,
  );
  const select = await screen.findByRole('button', { name: 'select the form variant' });
  if (host === 'scoped') fireEvent.click(select);
  // Wait for the inspector (either host) to mount its curated Label field —
  // found by its placeholder, since the variant's spec form below it carries
  // "Label" inputs of its own (one per section).
  return screen.findByPlaceholderText('e.g. All Leads');
}

/** Dirty the draft, so Save is live at all and only the gate can hold it. */
function dirty(label: HTMLElement) {
  fireEvent.change(label, { target: { value: 'Employee form (edited)' } });
}

describe.each([['default'], ['scoped']] as const)(
  'MetadataResourceEditPage — the %s view inspector refuses a required field in a gated section (objectui#6900)',
  (host) => {
    it('Save stays disabled on an identity-gated section holding an object-required field', async () => {
      const label = await openEditor(host);
      // Dirty FIRST: an unedited draft keeps Save disabled on its own, so only
      // an edited one can show that the refusal is what holds it shut.
      dirty(label);
      await settle();
      await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 4000 });
      // And the refusal the author reads is on screen beside it.
      expect(await screen.findByTestId('view-gated-required-issues')).toHaveTextContent('Salary');
    });

    it('the Save title held by this refusal is the neutral inspector copy, not the CEL one (ruling 5831744213)', async () => {
      const label = await openEditor(host);
      dirty(label);
      await settle();
      await waitFor(() => expect(saveButton()).toBeDisabled(), { timeout: 4000 });
      expect(saveButton()).toHaveAttribute('title', 'Fix the issues shown in the inspector before saving.');
    });

    it('control: the same form with the field NOT required on the object saves', async () => {
      state.salaryRequired = false;
      const label = await openEditor(host);
      dirty(label);
      await settle();
      await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 4000 });
      expect(screen.queryByTestId('view-gated-required-issues')).toBeNull();
    });

    it('control: the same section gated on a RECORD predicate saves', async () => {
      state.gate = RECORD_GATE;
      const label = await openEditor(host);
      dirty(label);
      await settle();
      await waitFor(() => expect(saveButton()).toBeEnabled(), { timeout: 4000 });
      expect(screen.queryByTestId('view-gated-required-issues')).toBeNull();
    });
  },
);
