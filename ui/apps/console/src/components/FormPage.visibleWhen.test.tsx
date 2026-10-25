// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5594 — this renderer evaluates `visibleWhen` (and, since
 * objectui#12654, `visibleWhen` only: spec 18 retired `visibleOn`).
 *
 * ## The class this pins shut
 *
 * `FormPage.tsx` is the SECOND form renderer in this repo. objectui#2212
 * recorded exactly this symptom — a FormView field carrying a CEL visibility
 * predicate renders unconditionally — and PR #2214 fixed it on the OTHER
 * chain: `ModalForm` -> `resolveFormViewLayout` -> `@object-ui/plugin-form`
 * `sectionFields.ts` -> `@object-ui/components` `renderers/form/form.tsx`.
 * This file's renderer is on that chain at no point, so #2212's fix never
 * reached it and #2212's regression pin — which lives with the chain it fixed
 * — could not see it. One contract, two implementations, each only ever
 * checked against itself.
 *
 * That is why this pin LIVES HERE, next to the renderer it describes, rather
 * than being folded into the #2212 suite: a pin that cannot see the second
 * copy is how the first gap survived.
 *
 * ## Reverse verification — MEASURED, not predicted
 *
 * `FormPage.tsx` reverted to its pre-#5594 state (`buildSections` not carrying
 * the predicate, the render filtered by `!f.hidden` alone) with this file left
 * in place, run from the repo root:
 *
 *     Tests  11 failed | 1 passed (12)
 *
 * Every red one fails in a way that names the defect — the conditional field
 * is ON SCREEN when the predicate says it must not be, or the predicate never
 * reached the row at all:
 *
 *   - "hides a field whose predicate is false"            -> field is present
 *   - "re-evaluates as the user types"                    -> present throughout
 *   - "honours the { dialect, source } wire shape"        -> field is present
 *   - "honours the deprecated visibleOn alias"            -> field is present
 *   - "canonical visibleWhen wins over visibleOn"         -> field is present
 *   - "the PUBLIC /f/:slug route honours it too"          -> field is present
 *   - "binds previous.* on an edit form"                  -> field is present
 *   - "a broken predicate fails OPEN, loudly"             -> no warning at all
 *   - "a hidden field's value is still submitted"         -> field is present
 *   - "buildSections carries the predicate onto the row"  -> `undefined`
 *   - "isFieldVisible answers … in one verdict"           -> no such export
 *
 * (A historical reading. The two `visibleOn` rows named above were replaced by
 * objectui#12654, which retires that spelling: their successor pins that the
 * retired key gates nothing.)
 *
 * The ONE that is green on both sides is the control that has to be:
 *
 *   - "a field with NO predicate at all still renders" — without it, every
 *     `not.toBeInTheDocument` above is equally satisfied by a renderer that
 *     draws nothing at all.
 *
 * The two cases named CONTROL are controls on their SECOND assertion and
 * change-detectors on their first, which is why they are red here rather than
 * green — worth stating, because "control" usually implies green both sides:
 *
 *   - "a broken predicate fails OPEN, loudly" — fail-OPEN is green either way
 *     (a renderer that never evaluates cannot hide anything), and it is still
 *     the direction that matters: an unevaluable predicate must never HIDE a
 *     field, because a hidden field is one the submitter can neither fill in
 *     nor see is missing. The `loudly` half is what turns red: pre-fix there is
 *     no evaluation, so there is nothing to warn about.
 *   - "a field hidden by its predicate still submits its value" — the payload
 *     assertion is the control (recorded rather than assumed: conditional
 *     visibility is a RENDERING rule in both renderers, and this card did not
 *     make it a submit-payload rule). It is red pre-fix only because it first
 *     has to establish that the field IS hidden.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { buildSections, FormPage, isFieldVisible } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The object the forms below target. `priority` carries a `defaultValue` so
 * the live record binds the key CLEANLY: an unbound identifier is a predicate
 * FAULT, which fails open, and a test that passed that way would prove the
 * fallback rather than the evaluation.
 */
const OBJECT_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    priority: { type: 'text', label: 'Priority', defaultValue: 'low' },
    notes: { type: 'text', label: 'Notes' },
    status: { type: 'text', label: 'Status' },
  },
};

/** Wrap a section's fields in the `/meta/view/:name` envelope this route reads. */
function viewEnvelope(fields: unknown[]) {
  return {
    name: 'showcase_task.edit',
    object: 'showcase_task',
    viewKind: 'form',
    label: 'Task',
    config: { type: 'simple', sections: [{ label: 'Task', fields }] },
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];

/** Answers per (method, url-substring); modelled on `FormPage.recordId.test.tsx`. */
function stubFetch(routes: Array<{ method?: string; match: string; body?: unknown }>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes.find(
      (r) => (r.method ?? 'GET').toUpperCase() === method && String(url).includes(r.match),
    );
    if (!route) throw new Error(`unstubbed fetch: ${method} ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => route.body,
      text: async () => (route.body === undefined ? '' : JSON.stringify(route.body)),
    } as unknown as Response;
  });
}

const recordPath = (objectName: string, recordId: string) =>
  `/apps/ai.objectstack.showcase/${objectName}/record/${recordId}`;

/** Render the INTERNAL route (`/forms/:name`) over a given field list. */
function renderInternal(fields: unknown[], query = '', extraRoutes: Parameters<typeof stubFetch>[0] = []) {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      { match: '/meta/view/', body: viewEnvelope(fields) },
      { match: '/meta/object/', body: OBJECT_SCHEMA },
      ...extraRoutes,
    ]),
  );
  return render(
    <MemoryRouter initialEntries={[`/forms/showcase_task.edit${query}`]}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" recordPath={recordPath} />} />
        <Route
          path="/apps/:appName/:objectName/record/:recordId"
          element={<div data-testid="record-page">record page</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Render the PUBLIC route (`/f/:slug`) over a given field list. */
function renderPublic(fields: unknown[]) {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      {
        match: '/forms/task-intake',
        body: {
          slug: 'task-intake',
          object: 'showcase_task',
          label: 'Task intake',
          form: { type: 'simple', sections: [{ label: 'Task', fields }] },
          objectSchema: OBJECT_SCHEMA,
        },
      },
    ]),
  );
  return render(
    <MemoryRouter initialEntries={['/f/task-intake']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Wait for the form to be on screen — every case needs the load to settle. */
async function awaitForm() {
  await waitFor(() => expect(screen.getByLabelText('Priority')).toBeInTheDocument());
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectui#5594 — FormPage evaluates conditional field visibility', () => {
  it('hides a field whose predicate is false, and shows one whose predicate is true', async () => {
    renderInternal([
      'title',
      'priority',
      { field: 'notes', visibleWhen: "record.priority == 'urgent'" },
      { field: 'status', visibleWhen: "record.priority == 'low'" },
    ]);
    await awaitForm();

    // `priority` starts at its schema default, 'low'.
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('re-evaluates against the LIVE values as the user types', async () => {
    const user = userEvent.setup();
    renderInternal([
      'title',
      'priority',
      { field: 'notes', visibleWhen: "record.priority == 'urgent'" },
    ]);
    await awaitForm();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();

    // The whole point of a conditional field: the predicate re-decides on the
    // CURRENT input values, not on whatever the form loaded with.
    const priority = screen.getByLabelText('Priority');
    await user.clear(priority);
    await user.type(priority, 'urgent');

    await waitFor(() => expect(screen.getByLabelText('Notes')).toBeInTheDocument());

    // …and back again, so this pins an evaluation and not a one-way reveal.
    await user.clear(screen.getByLabelText('Priority'));
    await user.type(screen.getByLabelText('Priority'), 'low');
    await waitFor(() => expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument());
  });

  it('honours the { dialect, source } wire shape as well as the bare string', async () => {
    renderInternal([
      'priority',
      { field: 'notes', visibleWhen: { dialect: 'cel', source: "record.priority == 'urgent'" } },
    ]);
    await awaitForm();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  });

  // objectui#12654: spec 18 retires the form field's `visibleOn` spelling
  // (objectstack#23543 F4); the spec's parse refuses it by name and a stored
  // row is rehydrated to `visibleWhen` before it is served. A raw view still
  // carrying it gates nothing here — the narrowing, pinned beside the same
  // predicate under the one key that is read.
  it('does not read the retired `visibleOn` — the same predicate under `visibleWhen` does hide the field', async () => {
    renderInternal(['priority', { field: 'notes', visibleOn: "record.priority == 'urgent'" }]);
    await awaitForm();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    cleanup();

    renderInternal(['priority', { field: 'notes', visibleWhen: "record.priority == 'urgent'" }]);
    await awaitForm();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  });

  it('honours the predicate on the PUBLIC /f/:slug route too', async () => {
    // The user-reachable half of the card: this route is served to anonymous
    // visitors, so a fail-open predicate here shows strangers a field the
    // author conditioned away.
    renderPublic([
      'priority',
      { field: 'notes', visibleWhen: "record.priority == 'urgent'" },
      { field: 'status', visibleWhen: "record.priority == 'low'" },
    ]);
    await awaitForm();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('binds `previous.*` to the stored record on an edit form', async () => {
    // `?recordId=` makes this an EDIT (objectui#4278), and the loaded record is
    // passed as the predicate's `previous` scope — the same pair the sibling
    // renderer binds. `record.priority` is the live 'urgent' the record
    // supplied; `previous.status` is the stored value.
    renderInternal(
      [
        'priority',
        { field: 'notes', visibleWhen: "previous.status == 'archived'" },
        { field: 'title', visibleWhen: "previous.status == 'open'" },
      ],
      '?recordId=task-42',
      [
        {
          match: '/data/showcase_task/task-42',
          body: {
            object: 'showcase_task',
            id: 'task-42',
            record: { id: 'task-42', priority: 'urgent', status: 'open' },
          },
        },
      ],
    );
    await awaitForm();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });

  // ── Controls ───────────────────────────────────────────────────────────

  it('CONTROL: a field with no predicate at all still renders', async () => {
    // Without this, every "not.toBeInTheDocument" above is equally satisfied
    // by a renderer that draws no fields.
    renderInternal(['priority', { field: 'notes' }, 'status']);
    await awaitForm();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('CONTROL: a broken predicate fails OPEN, loudly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderInternal(['priority', { field: 'notes', visibleWhen: 'record.priority ===' }]);
    await awaitForm();

    // Open: an unevaluable predicate must never hide a field.
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    // Loud: the shared engine warns once per predicate text, naming the field
    // — without it a broken predicate is indistinguishable from an absent one.
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain("visibleWhen of field 'notes'");
  });

  it('CONTROL: a field hidden by its predicate still submits its value', async () => {
    // Recorded, not assumed. Both renderers treat conditional visibility as a
    // RENDERING rule: the plugin-form fix for #2212 returns `null` at render
    // and clears stale ERRORS, never values. Turning it into a submit-payload
    // rule would be a new contract decided once for BOTH renderers — not
    // invented here, in the second one.
    const user = userEvent.setup();
    renderInternal(
      ['priority', { field: 'notes', visibleWhen: "record.priority == 'urgent'" }],
      '?prefill_notes=carried',
      [{ method: 'POST', match: '/data/showcase_task', body: { object: 'showcase_task', id: 'new-1' } }],
    );
    await awaitForm();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect((post.body as Record<string, unknown>).notes).toBe('carried');
  });
});

describe('objectui#5594 — the predicate reaches the row and the verdict', () => {
  it('buildSections carries the predicate onto the renderable row, from `visibleWhen` only', () => {
    const [section] = buildSections(
      {
        sections: [
          {
            fields: [
              { field: 'a', visibleWhen: "record.x == 1" },
              { field: 'b', visibleWhen: { dialect: 'cel', source: 'record.x == 2' } },
              // @ts-expect-error objectui#12696 — `FormFieldSpec` refuses the retired key; this raw field carries it on purpose
              { field: 'c', visibleOn: "record.x == 4" },
              { field: 'd' },
              'e',
            ],
          },
        ],
      },
      null,
    );

    // `c`: the retired spelling reaches no row (objectui#12654).
    expect(section.fields.map((f) => f.visibleWhen)).toEqual([
      "record.x == 1",
      { dialect: 'cel', source: 'record.x == 2' },
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('isFieldVisible answers the static flag and the predicate in one verdict', () => {
    const [section] = buildSections(
      {
        sections: [
          {
            fields: [
              { field: 'always' },
              { field: 'statically_hidden', hidden: true },
              { field: 'conditional', visibleWhen: "record.priority == 'urgent'" },
            ],
          },
        ],
      },
      null,
    );
    const [always, staticallyHidden, conditional] = section.fields;

    expect(isFieldVisible(always, { priority: 'low' })).toBe(true);
    // A static `hidden: true` is unconditional — it is not weakened by a
    // predicate that would evaluate true.
    expect(isFieldVisible(staticallyHidden, { priority: 'urgent' })).toBe(false);
    expect(isFieldVisible(conditional, { priority: 'low' })).toBe(false);
    expect(isFieldVisible(conditional, { priority: 'urgent' })).toBe(true);
  });
});
