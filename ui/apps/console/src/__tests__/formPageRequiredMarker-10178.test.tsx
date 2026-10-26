// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10178 — `FormPage`'s required `*` stays out of the control's
 * accessible name, and the requirement is announced as a STATE instead.
 *
 * `/f/:slug` and `/forms/:name` render through `FormPage`, which draws the
 * required marker as a `*` span INSIDE the field's `label`. A label's content
 * is the control's accessible name, so a screen reader announced "Title *"
 * rather than "Title". The rule this file pins is not new: `ActionParamDialog`
 * states it beside its own marker — "Visual-only (objectui#3299):
 * `aria-required` on the widget is the announced channel; hiding the `*` keeps
 * it out of the control's accessible name." — and
 * `ActionParamDialog.ariaRequired.test.tsx` pins it there.
 *
 * ## What each case can see
 *
 * - The accessible name is read with Testing Library's computed-name matcher,
 *   because the name is the only place the defect shows: the `*` is still in
 *   the label's text content after the fix, by design.
 * - Hiding the marker is only half the rule. The other half is that the
 *   requirement still reaches the control as a state, so every required case
 *   also asserts that. The text arms carry it through the native `required`
 *   attribute they had then, the shared widgets (objectui#10179) through
 *   `aria-required`; the checkbox arm had neither channel, so it got
 *   `aria-required` first.
 * - The checkbox gets `aria-required` and NOT native `required`. On a checkbox,
 *   native `required` means "must be checked". The required rule here treats
 *   `false` as a real value (`isMissingForRequired` in `@object-ui/core`), so
 *   native `required` would block a submit the rule accepts.
 *
 * ## Controls, so the positives cannot pass vacuously
 *
 * An optional field of each kind renders no marker and reports no requirement.
 * Without these, "the name has no `*`" is also satisfied by a renderer that
 * dropped the marker altogether, and "the control reports required" by one
 * that marks every control required.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FormPage } from '../components/FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The object behind the form. Required-ness comes from the object definition,
 * which `buildSections` merges into each row (`override.required ?? def.required`).
 */
const OBJECT_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title', required: true },
    freeform: { type: 'text', label: 'Freeform' },
    agree: { type: 'boolean', label: 'Agree', required: true },
    optin: { type: 'boolean', label: 'Opt in' },
  },
};

const VIEW_ENVELOPE = {
  name: 'showcase_task.intake',
  object: 'showcase_task',
  viewKind: 'form',
  label: 'Task intake',
  config: {
    type: 'simple',
    sections: [{ label: 'Task', fields: ['title', 'freeform', 'agree', 'optin'] }],
  },
};

function stubFetch(routes: Array<{ match: string; body: unknown }>) {
  return vi.fn(async (url: string) => {
    const route = routes.find((r) => String(url).includes(r.match));
    if (!route) throw new Error(`unstubbed fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => route.body,
      text: async () => JSON.stringify(route.body),
    } as unknown as Response;
  });
}

/** Render the internal route (`/forms/:name`) and wait for the fields. */
async function renderForm() {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      { match: '/meta/view/', body: VIEW_ENVELOPE },
      { match: '/meta/object/', body: OBJECT_SCHEMA },
    ]),
  );
  render(
    <MemoryRouter initialEntries={['/forms/showcase_task.intake']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(document.getElementById('f_title')).not.toBeNull());
}

/** The visual marker inside the row label that points at `id`, or null. */
function markerFor(id: string): HTMLElement | null {
  const label = document.querySelector(`label[for="${id}"]`);
  expect(label).not.toBeNull();
  return label!.querySelector('span');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectui#10178 — FormPage keeps the required `*` out of the accessible name', () => {
  it('a required text control is named "Title", not "Title *", and reports required', async () => {
    await renderForm();
    const input = document.getElementById('f_title')!;
    expect(input).toHaveAccessibleName('Title');
    expect(screen.getByRole('textbox', { name: 'Title' })).toBe(input);
    expect(input).toBeRequired();

    // The marker is still drawn for sighted users, and hidden from the tree.
    const marker = markerFor('f_title');
    expect(marker).not.toBeNull();
    expect(marker).toHaveTextContent('*');
    expect(marker).toHaveAttribute('aria-hidden', 'true');
  });

  it('a required checkbox has no `*` in its name and announces required via aria-required', async () => {
    await renderForm();
    // Since objectui#10179 a `boolean` row renders the shared `BooleanField`
    // (a switch), and the row's `<label for>` is its ONLY name — the hand-rolled
    // arm's own wrapping label, which doubled the name to `Agree * Agree`, is
    // gone. So the name is now asserted EXACTLY, not merely `*`-free.
    const checkbox = await waitFor(() => screen.getByRole('switch', { name: 'Agree' }));
    expect(checkbox.id).toBe('f_agree');
    expect(checkbox).toHaveAccessibleName('Agree');
    expect(checkbox).toHaveAttribute('aria-required', 'true');
    // `false` is a real value for the required rule, so the checkbox must not
    // arm the browser's "must be checked" constraint.
    expect(checkbox).not.toHaveAttribute('required');

    const marker = markerFor('f_agree');
    expect(marker).not.toBeNull();
    expect(marker).toHaveAttribute('aria-hidden', 'true');
  });

  it('CONTROL — an optional text control has no marker and does not report required', async () => {
    await renderForm();
    const input = document.getElementById('f_freeform')!;
    expect(input).toHaveAccessibleName('Freeform');
    expect(markerFor('f_freeform')).toBeNull();
    expect(input).not.toBeRequired();
  });

  it('CONTROL — an optional checkbox has no marker and carries no aria-required', async () => {
    await renderForm();
    const checkbox = await waitFor(() => screen.getByRole('switch', { name: 'Opt in' }));
    expect(markerFor('f_optin')).toBeNull();
    expect(checkbox).not.toHaveAttribute('aria-required');
    expect(checkbox).not.toHaveAttribute('required');
  });
});
