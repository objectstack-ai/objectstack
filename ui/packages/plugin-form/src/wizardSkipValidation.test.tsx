/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `allowSkip` is navigation freedom, not an exemption from the object's rules.
 *
 * A wizard mounts ONE step at a time, and react-hook-form only validates the
 * fields currently mounted — so a required field on a step the user jumped past
 * was never registered, never validated, and simply absent from the payload.
 * Measured against the unfixed component, the reported flow (3 steps, required
 * `assignee` on step 2, `allowSkip: true`, click step 3's indicator, fill it, hit
 * Create) produced:
 *
 *     createCalls: 1
 *     payload:     { subject: 'S1', notes: 'S3' }   // `assignee` missing entirely
 *     UI mentions "required": false                 // nothing said so
 *
 * (The measurement named that field `owner`. It is `assignee` here because
 * `owner` is on the server-owned roster in `sanitize.ts`, which every layout's
 * save strips — the wizard's too, since objectui#10563 — so a fixture field
 * spelled that way would read as a skipped value that never arrived.)
 *
 * i.e. an invalid create left the client with no indication of what was wrong —
 * the same defect #2959 fixed for tabs, wearing a wizard's clothes. The final
 * submit now checks every step's required fields and sends the user to the first
 * step that is short one.
 *
 * The sequential path was never affected (a forward jump is refused without
 * `allowSkip`, so Next validates each step on the way) and is pinned below so the
 * new gate can't start blocking legitimate submits.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { WizardForm } from './WizardForm';

registerAllFields();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const makeDataSource = (): any => ({
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'case',
    fields: {
      subject: { type: 'text', label: 'Subject' },
      // Required, parked on the MIDDLE step — the one the user skips past.
      assignee: { type: 'text', label: 'Assignee', required: true },
      notes: { type: 'text', label: 'Notes' },
    },
  }),
  create: vi.fn().mockResolvedValue({ id: 'case-1' }),
  update: vi.fn(),
  findOne: vi.fn(),
});

const SECTIONS = [
  { name: 's1', label: 'Step 1', fields: ['subject'] },
  { name: 's2', label: 'Step 2', fields: ['assignee'] },
  { name: 's3', label: 'Step 3', fields: ['notes'] },
];

const fill = (name: string, value: string) => {
  const input = document.body.querySelector<HTMLInputElement>(`[data-field="${name}"] input`);
  if (!input) throw new Error(`field not rendered: ${name}`);
  fireEvent.change(input, { target: { value } });
};

/**
 * The step indicator, located by position in the progress nav rather than by the
 * `data-testid` this change also adds — so these assertions run unchanged against
 * the unfixed component and fail on the DEFECT, not on a missing locator.
 */
const stepIndicator = (index: number) =>
  document.body.querySelectorAll<HTMLButtonElement>('nav[aria-label="Progress"] button')[index];

const renderWizard = (overrides: Record<string, unknown> = {}, dataSource = makeDataSource()) => {
  render(
    <WizardForm
      schema={{
        type: 'object-form',
        formType: 'wizard',
        objectName: 'case',
        mode: 'create',
        sections: SECTIONS,
        ...overrides,
      }}
      dataSource={dataSource}
    />,
  );
  return dataSource;
};

describe('WizardForm allowSkip — required fields on a skipped step (#2959)', () => {
  it('refuses the submit and returns to the step holding the missing field', async () => {
    const dataSource = renderWizard({ allowSkip: true });

    await waitFor(() => expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy());
    fill('subject', 'S1');

    // Jump straight to the last step, skipping step 2 entirely.
    fireEvent.click(stepIndicator(2));
    await waitFor(() => expect(document.body.querySelector('[data-field="notes"]')).toBeTruthy());
    fill('notes', 'S3');
    // `assignee` was never mounted, so RHF has no rule registered for it.
    expect(document.body.querySelector('[data-field="assignee"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    // Nothing is sent, and the wizard lands on the step that is short a field.
    await waitFor(() => expect(document.body.querySelector('[data-field="assignee"]')).toBeTruthy());
    expect(dataSource.create).not.toHaveBeenCalled();
    expect(stepIndicator(1)).toHaveAttribute('data-error', 'true');
    expect(stepIndicator(0)).not.toHaveAttribute('data-error');
  });

  it('submits once the skipped step is filled in, and clears its marker', async () => {
    const dataSource = renderWizard({ allowSkip: true });

    await waitFor(() => expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy());
    fill('subject', 'S1');
    fireEvent.click(stepIndicator(2));
    await waitFor(() => expect(document.body.querySelector('[data-field="notes"]')).toBeTruthy());
    fill('notes', 'S3');
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    // Bounced to step 2 — fill it, then walk back to the end and submit.
    await waitFor(() => expect(document.body.querySelector('[data-field="assignee"]')).toBeTruthy());
    fill('assignee', 'Ada');
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => expect(document.body.querySelector('[data-field="notes"]')).toBeTruthy());
    expect(stepIndicator(1)).not.toHaveAttribute('data-error');

    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
    // Every step's values reach the server, the skipped one included.
    expect(dataSource.create.mock.calls[0][1]).toMatchObject({
      subject: 'S1',
      assignee: 'Ada',
      notes: 'S3',
    });
  });

  it('leaves a conditionally-required field alone while its predicate is false', async () => {
    const dataSource: any = {
      ...makeDataSource(),
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'case',
        fields: {
          subject: { type: 'text', label: 'Subject' },
          // Required only for escalated cases — the same canonical predicate the
          // renderer and the server evaluate, so the gate must agree with them
          // rather than demanding the field unconditionally.
          assignee: { type: 'text', label: 'Assignee', requiredWhen: "record.subject == 'urgent'" },
          notes: { type: 'text', label: 'Notes' },
        },
      }),
    };
    renderWizard({ allowSkip: true }, dataSource);

    await waitFor(() => expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy());
    fill('subject', 'routine');
    fireEvent.click(stepIndicator(2));
    await waitFor(() => expect(document.body.querySelector('[data-field="notes"]')).toBeTruthy());
    fill('notes', 'S3');
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
    expect(stepIndicator(1)).not.toHaveAttribute('data-error');
  });

  it('does not demand a required field the view itself hides (view-level visibleWhen false)', async () => {
    // The section field def carries the SPEC vocabulary: `field` + a view-level
    // `visibleWhen` (ADR-0089 canonical spelling). `normalizeSectionField`
    // routes that predicate into the view-level slot (`visibleOn`, #3090) and
    // the renderer hides the field — so the submit gate must fold the same
    // slot into its verdict, or it demands a field the user cannot see.
    const dataSource = renderWizard({
      allowSkip: true,
      sections: [
        { name: 's1', label: 'Step 1', fields: ['subject'] },
        {
          name: 's2',
          label: 'Step 2',
          fields: [{ field: 'assignee', visibleWhen: "record.subject == 'urgent'" }],
        },
        { name: 's3', label: 'Step 3', fields: ['notes'] },
      ],
    });

    await waitFor(() => expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy());
    fill('subject', 'routine'); // predicate false → assignee is view-hidden
    fireEvent.click(stepIndicator(2));
    await waitFor(() => expect(document.body.querySelector('[data-field="notes"]')).toBeTruthy());
    fill('notes', 'S3');
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
    expect(stepIndicator(1)).not.toHaveAttribute('data-error');
  });

  it('still lets the sequential wizard submit (the gate is not a new blocker)', async () => {
    const dataSource = renderWizard();

    await waitFor(() => expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy());
    fill('subject', 'S1');
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => expect(document.body.querySelector('[data-field="assignee"]')).toBeTruthy());
    fill('assignee', 'Ada');
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => expect(document.body.querySelector('[data-field="notes"]')).toBeTruthy());
    fill('notes', 'S3');
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
    expect(dataSource.create.mock.calls[0][1]).toMatchObject({
      subject: 'S1',
      assignee: 'Ada',
      notes: 'S3',
    });
  });
});

describe('WizardForm — the form view’s own `columns`', () => {
  it('honours the view’s columns for every step', async () => {
    renderWizard({ columns: 3 });

    await waitFor(() => expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy());
    const grid = document.body.querySelector('[class*="@2xl:grid-cols-3"]');
    expect(grid).not.toBeNull();

    // The grid is sized with CONTAINER queries, so it needs a container ancestor
    // to resolve against. Asserting only the class caught nothing: the browser
    // showed a declared 2-column step still rendering single-column because the
    // wizard's root carried no `@container`, leaving every `@md:`/`@2xl:` variant
    // inert.
    expect(grid!.closest('.\\@container')).not.toBeNull();
  });

  it('falls back to the step’s own columns when the view declares none', async () => {
    render(
      <WizardForm
        schema={{
          type: 'object-form',
          formType: 'wizard',
          objectName: 'case',
          mode: 'create',
          sections: [
            { name: 's1', label: 'Step 1', columns: 2, fields: ['subject', 'assignee'] },
            { name: 's2', label: 'Step 2', fields: ['notes'] },
          ],
        }}
        dataSource={makeDataSource()}
      />,
    );

    await waitFor(() => expect(document.body.querySelector('[data-field="subject"]')).toBeTruthy());
    expect(document.body.querySelector('[class*="@md:grid-cols-2"]')).not.toBeNull();
    expect(document.body.querySelector('[class*="@2xl:grid-cols-3"]')).toBeNull();
  });
});
