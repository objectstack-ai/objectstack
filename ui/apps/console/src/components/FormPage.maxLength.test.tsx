// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5595 — a field-level `maxLength` override reaches the input.
 *
 * ## Why this is pinned at the DOM and not only at `buildSections`
 *
 * `FormPage.test.ts` pins the merge itself, which is where the defect was:
 * `buildSections` built every other key as `override.X ?? def.X` and built
 * this one as `def.maxLength`, so a tighter per-form ceiling was dropped while
 * the function's docstring promised overrides win.
 *
 * That merge test is necessary and not sufficient. The row is only worth
 * anything if it reaches the element the user types into, and in THIS repo
 * that step has independently failed for THIS key twice already — objectui#5201
 * and #5253, both closed, both "a declared `max_length` ceiling never reaches
 * the DOM", in the built-in form branches rather than here. Different renderer
 * and a different mechanism each time (spelling/lookup, not a missing merge
 * branch), which is exactly why a merge-level pin cannot see them. So the
 * end-to-end leg is pinned separately, against the rendered attribute.
 *
 * ## Both DOM sites, deliberately
 *
 * `FormPage.tsx` spreads `maxLength={field.maxLength}` at two independent
 * sites: the `textarea` arm (`textarea` / `paragraph` / `long_text`) and the
 * default `input type="text"` arm. They are separate JSX elements in separate
 * switch branches, so a fix that reached one proves nothing about the other.
 *
 * ## The controls
 *
 * Two cases here are controls scoped to the same attribute, and both can fail:
 *
 *  - "falls back to the object ceiling" — without it, "the form's 40 wins" is
 *    equally satisfied by a renderer that lost the object side entirely, or by
 *    one that hard-codes 40.
 *  - "no ceiling on either side leaves the attribute off" — without it, every
 *    assertion above is equally satisfied by a renderer that caps every input
 *    at some number of its own choosing.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The object behind the forms below. `title` and `notes` carry deliberately
 * GENEROUS ceilings — the whole point is a form that wants a tighter one than
 * the column allows; `freeform` carries none, for the both-absent control.
 */
const OBJECT_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title', maxLength: 200 },
    // `textarea` — the declared spelling. This row was `long_text` while this
    // page's hand-rolled switch carried an arm for that undeclared name; since
    // objectui#10179 the shared resolver decides, and it knows `textarea`.
    notes: { type: 'textarea', label: 'Notes', maxLength: 5000 },
    freeform: { type: 'text', label: 'Freeform' },
  },
};

/** Wrap a section's fields in the `/meta/view/:name` envelope this route reads. */
function viewEnvelope(fields: unknown[]) {
  return {
    name: 'showcase_task.intake',
    object: 'showcase_task',
    viewKind: 'form',
    label: 'Task intake',
    config: { type: 'simple', sections: [{ label: 'Task', fields }] },
  };
}

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

const recordPath = (objectName: string, recordId: string) =>
  `/apps/ai.objectstack.showcase/${objectName}/record/${recordId}`;

/** Render the internal route (`/forms/:name`) over a given field list. */
function renderForm(fields: unknown[]) {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      { match: '/meta/view/', body: viewEnvelope(fields) },
      { match: '/meta/object/', body: OBJECT_SCHEMA },
    ]),
  );
  return render(
    <MemoryRouter initialEntries={['/forms/showcase_task.intake']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" recordPath={recordPath} />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Wait for the load to settle — every case needs the field on screen first. */
async function awaitField(label: string) {
  await waitFor(() => expect(screen.getByLabelText(label)).toBeInTheDocument());
  return screen.getByLabelText(label);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectui#5595 — the form field maxLength override reaches the input', () => {
  it('caps the text input at the FORM ceiling, not the object one', async () => {
    renderForm([{ field: 'title', maxLength: 40 }]);
    const input = await awaitField('Title');
    // The column allows 200; this form asked for 40. Pre-fix the author got
    // 200 here, silently — the symptom the card describes is a value the
    // author believed was refused at the input being accepted.
    expect(input).toHaveAttribute('maxlength', '40');
  });

  it('caps the TEXTAREA arm too — a second, independent JSX site', async () => {
    renderForm([{ field: 'notes', maxLength: 120 }]);
    const textarea = await awaitField('Notes');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('maxlength', '120');
  });

  it('CONTROL — falls back to the object ceiling when the form asks for none', async () => {
    renderForm(['title']);
    const input = await awaitField('Title');
    // Scoped to the same attribute and able to fail: dropping `?? def.maxLength`
    // turns this red while leaving both cases above green.
    expect(input).toHaveAttribute('maxlength', '200');
  });

  it('CONTROL — no ceiling on either side leaves the attribute off entirely', async () => {
    renderForm(['freeform']);
    const input = await awaitField('Freeform');
    // Without this, every assertion above is equally satisfied by a renderer
    // that caps every input at a number of its own choosing.
    expect(input).not.toHaveAttribute('maxlength');
  });
});
