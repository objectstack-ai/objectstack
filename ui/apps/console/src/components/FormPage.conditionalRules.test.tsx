// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5627 — this renderer honours the OTHER THREE conditional-rule
 * surfaces: section-level `visibleWhen`, and the object-level field
 * rules `visibleWhen`/`readonlyWhen`/`requiredWhen`.
 *
 * ## Why a second pin file next to `FormPage.visibleWhen.test.tsx`
 *
 * #5594 wired ONE of the four surfaces — the VIEW-level field predicate — and
 * its pin lives in that file, which is the right shape: a pin belongs next to
 * the renderer it describes, because a pin that cannot see the second copy is
 * how the first gap survived (`FormPage.tsx` is the second form renderer in
 * this repo, and objectui#2212's pin lives with the OTHER chain). These three
 * surfaces are different keys with different consequences, so they get their
 * own file rather than being folded into #5594's — the two read as one story
 * only until one of them fails, and then the failure has to name which
 * authoring surface stopped working.
 *
 * ## Everything here asserts RENDERED OUTPUT, deliberately
 *
 * Every failure mode in this card is invisible to `tsc` and to `eslint`: the
 * types admit the keys either way (the section keys have been *declarable*
 * since objectui#5596 without being evaluated), and the symptom is a section
 * that draws in full when it should be gone, or an input that stays editable
 * when a rule says lock it. So the assertions are on the DOM — presence,
 * `toBeDisabled`, `toBeRequired`, the required marker inside the `label`
 * element, and the POST body — never on an intermediate object, except in the
 * final block, which pins the row-building step the DOM cases depend on.
 *
 * ## Reverse verification — MEASURED, not predicted
 *
 * See the PR body for the recorded run: `FormPage.tsx` reverted to its
 * pre-#5627 state with this file left in place fails 19 of its 24 cases, and
 * every red one fails by NAMING the defect (the conditioned-away section is on
 * screen, the locked field is editable, the required marker is missing).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { buildSections, FormPage, isSectionVisible, resolveRowState } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The object these forms target. `priority` carries a `defaultValue` so every
 * predicate below binds its identifier CLEANLY: an unbound identifier is a
 * predicate FAULT, which fails open, and a case that passed that way would be
 * proving the fallback rather than the evaluation.
 *
 * Per-case rule keys are layered on top of this by {@link withRules}, because
 * the whole point of the object-level half is that these rules are authored on
 * the OBJECT's field — not on the form view.
 */
const BASE_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    priority: { type: 'text', label: 'Priority', defaultValue: 'low' },
    notes: { type: 'text', label: 'Notes' },
    status: { type: 'text', label: 'Status' },
    due_at: { type: 'text', label: 'Due at' },
  } as Record<string, Record<string, unknown>>,
};

/** `BASE_SCHEMA` with extra keys merged onto named object FIELDS. */
function withRules(rules: Record<string, Record<string, unknown>>) {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const [name, def] of Object.entries(BASE_SCHEMA.fields)) {
    fields[name] = { ...def, ...(rules[name] ?? {}) };
  }
  return { ...BASE_SCHEMA, fields };
}

/** Wrap sections in the `/meta/view/:name` envelope the internal route reads. */
function viewEnvelope(sections: unknown[]) {
  return {
    name: 'showcase_task.edit',
    object: 'showcase_task',
    viewKind: 'form',
    label: 'Task',
    config: { type: 'simple', sections },
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];

/** Answers per (method, url-substring); modelled on `FormPage.visibleWhen.test.tsx`. */
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

interface RenderOpts {
  objectSchema?: unknown;
  query?: string;
  extraRoutes?: Parameters<typeof stubFetch>[0];
}

/** Render the INTERNAL route (`/forms/:name`) over a given section list. */
function renderInternal(sections: unknown[], opts: RenderOpts = {}) {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      { match: '/meta/view/', body: viewEnvelope(sections) },
      { match: '/meta/object/', body: opts.objectSchema ?? BASE_SCHEMA },
      ...(opts.extraRoutes ?? []),
    ]),
  );
  return render(
    <MemoryRouter initialEntries={[`/forms/showcase_task.edit${opts.query ?? ''}`]}>
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

/** Render the PUBLIC route (`/f/:slug`) over a given section list. */
function renderPublic(sections: unknown[], opts: RenderOpts = {}) {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      {
        match: '/forms/task-intake',
        body: {
          slug: 'task-intake',
          object: 'showcase_task',
          label: 'Task intake',
          form: { type: 'simple', sections },
          objectSchema: opts.objectSchema ?? BASE_SCHEMA,
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

/**
 * The `label` element bound to a control, so the REQUIRED MARKER can be read
 * off the rendered output. `getByLabelText` cannot serve here: the marker is
 * inside the label, so a required field's accessible name is `Notes*` and an
 * exact-string query for `Notes` stops matching the moment the assertion
 * matters — the query would pass or fail for the wrong reason.
 */
function labelFor(container: HTMLElement, name: string): HTMLElement {
  const el = container.querySelector(`label[for="f_${name}"]`);
  if (!el) throw new Error(`no label rendered for field '${name}'`);
  return el as HTMLElement;
}

/** The control itself, by the id `FieldInput` gives it. */
function controlFor(container: HTMLElement, name: string): HTMLElement {
  const el = container.querySelector(`#f_${name}`);
  if (!el) throw new Error(`no control rendered for field '${name}'`);
  return el as HTMLElement;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── 1. Section-level visibility (ADR-0089) ──────────────────────────────

describe('objectui#5627 — FormPage evaluates SECTION-level visibility', () => {
  it('hides a section whose predicate is false, and keeps one whose predicate is true', async () => {
    renderInternal([
      { label: 'Basics', fields: ['priority'] },
      { label: 'Escalation', visibleWhen: "record.priority == 'urgent'", fields: ['notes'] },
      { label: 'Triage', visibleWhen: "record.priority == 'low'", fields: ['status'] },
    ]);
    await awaitForm();

    // `priority` starts at its schema default, 'low'. The section itself is
    // gone — heading and fields both, which is what distinguishes a section
    // rule from a field rule applied to each of its members.
    expect(screen.queryByText('Escalation')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
    expect(screen.getByText('Triage')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  // objectui#12654: spec 18 retires the section's `visibleOn` spelling
  // (objectstack#23543 F4). A raw view still carrying it is refused by the
  // spec's parse; this reader does not fold it back. The pair below is the
  // narrowing: the SAME predicate hides the section under `visibleWhen` and
  // gates nothing under the retired key.
  it('does not read the retired `visibleOn` on a section — the same predicate under `visibleWhen` does hide it', async () => {
    renderInternal([
      { label: 'Basics', fields: ['priority'] },
      { label: 'Escalation', visibleOn: "record.priority == 'urgent'", fields: ['notes'] },
    ]);
    await awaitForm();
    expect(screen.getByText('Escalation')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    cleanup();

    renderInternal([
      { label: 'Basics', fields: ['priority'] },
      { label: 'Escalation', visibleWhen: "record.priority == 'urgent'", fields: ['notes'] },
    ]);
    await awaitForm();
    expect(screen.queryByText('Escalation')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  });

  it('honours the { dialect, source } wire shape on a section', async () => {
    renderInternal([
      { label: 'Basics', fields: ['priority'] },
      {
        label: 'Escalation',
        visibleWhen: { dialect: 'cel', source: "record.priority == 'urgent'" },
        fields: ['notes'],
      },
    ]);
    await awaitForm();
    expect(screen.queryByText('Escalation')).not.toBeInTheDocument();
  });

  it('re-evaluates the section predicate against the LIVE values as the user types', async () => {
    const user = userEvent.setup();
    renderInternal([
      { label: 'Basics', fields: ['priority'] },
      { label: 'Escalation', visibleWhen: "record.priority == 'urgent'", fields: ['notes'] },
    ]);
    await awaitForm();
    expect(screen.queryByText('Escalation')).not.toBeInTheDocument();

    const priority = screen.getByLabelText('Priority');
    await user.clear(priority);
    await user.type(priority, 'urgent');
    await waitFor(() => expect(screen.getByText('Escalation')).toBeInTheDocument());
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();

    // …and back again, so this pins an evaluation and not a one-way reveal.
    await user.clear(screen.getByLabelText('Priority'));
    await user.type(screen.getByLabelText('Priority'), 'low');
    await waitFor(() => expect(screen.queryByText('Escalation')).not.toBeInTheDocument());
  });

  it('binds `previous.*` in a section predicate on an edit form', async () => {
    renderInternal(
      [
        { label: 'Basics', fields: ['priority'] },
        { label: 'Archive', visibleWhen: "previous.status == 'archived'", fields: ['notes'] },
        { label: 'Open work', visibleWhen: "previous.status == 'open'", fields: ['status'] },
      ],
      {
        query: '?recordId=task-42',
        extraRoutes: [
          {
            match: '/data/showcase_task/task-42',
            body: {
              object: 'showcase_task',
              id: 'task-42',
              record: { id: 'task-42', priority: 'urgent', status: 'open' },
            },
          },
        ],
      },
    );
    await awaitForm();
    expect(screen.queryByText('Archive')).not.toBeInTheDocument();
    expect(screen.getByText('Open work')).toBeInTheDocument();
  });

  it('honours a section predicate on the PUBLIC /f/:slug route too', async () => {
    // The user-reachable half of the card: this route is served to anonymous
    // visitors, so a section an author conditioned away was being shown in full
    // to strangers.
    renderPublic([
      { label: 'Basics', fields: ['priority'] },
      { label: 'Internal only', visibleWhen: "record.priority == 'urgent'", fields: ['notes'] },
    ]);
    await awaitForm();
    expect(screen.queryByText('Internal only')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
  });

  it('RULING PIN: a section hidden by its predicate still SUBMITS its fields', async () => {
    // Triage first-touch, 2026-08-22, quoted: "Section-level visibility is a
    // rendering rule — a hidden section's fields still submit, matching the
    // field-level answer #5594 deliberately kept and the plugin-form chain."
    // A positive assertion on the POST body, not an absence: the ruling is that
    // the value TRAVELS, so only reading it back off the payload can pin it.
    const user = userEvent.setup();
    renderInternal(
      [
        { label: 'Basics', fields: ['priority'] },
        { label: 'Escalation', visibleWhen: "record.priority == 'urgent'", fields: ['notes'] },
      ],
      {
        query: '?prefill_notes=carried',
        extraRoutes: [
          { method: 'POST', match: '/data/showcase_task', body: { object: 'showcase_task', id: 'new-1' } },
        ],
      },
    );
    await awaitForm();
    expect(screen.queryByText('Escalation')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect((post.body as Record<string, unknown>).notes).toBe('carried');
  });

  it('CONTROL: a section with no predicate at all still renders', async () => {
    // Without this, every "not.toBeInTheDocument" above is equally satisfied by
    // a renderer that draws no sections.
    renderInternal([
      { label: 'Basics', fields: ['priority'] },
      { label: 'Escalation', fields: ['notes'] },
    ]);
    await awaitForm();
    expect(screen.getByText('Escalation')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  });

  it('CONTROL: a broken section predicate fails OPEN, loudly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderInternal([
      { label: 'Basics', fields: ['priority'] },
      { label: 'Escalation', visibleWhen: 'record.priority ===', fields: ['notes'] },
    ]);
    await awaitForm();

    // Open: an unevaluable predicate must never hide a section — that is a
    // whole group of controls the submitter can neither fill in nor see missing.
    expect(screen.getByText('Escalation')).toBeInTheDocument();
    // Loud: the shared engine warns once per predicate text, and the locator
    // names the SECTION, which is what an author can find in their metadata.
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain("visibleWhen of section 'Escalation'");
  });
});

// ─── 2. Object-level field rules (ADR-0036) ──────────────────────────────

describe('objectui#5627 — FormPage evaluates OBJECT-level field rules', () => {
  it('hides a field whose OBJECT-level visibleWhen is false, shows one whose is true', async () => {
    renderInternal([{ label: 'Basics', fields: ['priority', 'notes', 'status'] }], {
      objectSchema: withRules({
        notes: { visibleWhen: "record.priority == 'urgent'" },
        status: { visibleWhen: "record.priority == 'low'" },
      }),
    });
    await awaitForm();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('LOCKS a field whose readonlyWhen is true, and leaves it editable when false', async () => {
    // The severity anchor of this card: an un-honoured `readonlyWhen` leaves a
    // control editable that the server will refuse to write, so "the user
    // edits, the save reports success, and the value never lands".
    const { container } = renderInternal([{ label: 'Basics', fields: ['priority', 'notes', 'status'] }], {
      objectSchema: withRules({
        notes: { readonlyWhen: "record.priority == 'low'" }, // true  -> locked
        status: { readonlyWhen: "record.priority == 'urgent'" }, // false -> editable
      }),
    });
    await awaitForm();
    expect(controlFor(container, 'notes')).toBeDisabled();
    expect(controlFor(container, 'status')).not.toBeDisabled();
  });

  it('re-evaluates readonlyWhen against the LIVE values as the user types', async () => {
    const user = userEvent.setup();
    const { container } = renderInternal([{ label: 'Basics', fields: ['priority', 'notes'] }], {
      objectSchema: withRules({ notes: { readonlyWhen: "record.priority == 'urgent'" } }),
    });
    await awaitForm();
    expect(controlFor(container, 'notes')).not.toBeDisabled();

    const priority = screen.getByLabelText('Priority');
    await user.clear(priority);
    await user.type(priority, 'urgent');
    await waitFor(() => expect(controlFor(container, 'notes')).toBeDisabled());
  });

  it('REQUIRES a field whose requiredWhen is true — marker and control agree', async () => {
    const { container } = renderInternal([{ label: 'Basics', fields: ['priority', 'notes', 'status'] }], {
      objectSchema: withRules({
        notes: { requiredWhen: "record.priority == 'low'" }, // true
        status: { requiredWhen: "record.priority == 'urgent'" }, // false
      }),
    });
    await awaitForm();
    // ONE verdict reaches both the control and the marker beside it — the
    // two-layer disagreement objectui#4201 removed on the sibling chain.
    expect(controlFor(container, 'notes')).toBeRequired();
    expect(labelFor(container, 'notes').textContent).toContain('*');
    expect(controlFor(container, 'status')).not.toBeRequired();
    expect(labelFor(container, 'status').textContent).not.toContain('*');
  });

  it('honours the OBJECT-level rules on the PUBLIC /f/:slug route too', async () => {
    const { container } = renderPublic([{ label: 'Basics', fields: ['priority', 'notes', 'status'] }], {
      objectSchema: withRules({
        notes: { readonlyWhen: "record.priority == 'low'" },
        status: { visibleWhen: "record.priority == 'urgent'" },
      }),
    });
    await awaitForm();
    expect(controlFor(container, 'notes')).toBeDisabled();
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
  });

  it('ANDs the two visibility LAYERS — a view predicate cannot re-show what the object rule hid', async () => {
    // The layering the sibling chain keeps on purpose (`sectionFields.ts`
    // routes the view predicate into `visibleOn` "so the object rule is never
    // clobbered"). Collapsing them with a `??` would make either of these two
    // rows appear.
    renderInternal(
      [
        {
          label: 'Basics',
          fields: [
            'priority',
            // view TRUE over object FALSE -> still hidden
            { field: 'notes', visibleWhen: "record.priority == 'low'" },
            // view FALSE over object TRUE -> still hidden
            { field: 'status', visibleWhen: "record.priority == 'urgent'" },
            // both true -> shown, so this is not a renderer that hides everything
            { field: 'title', visibleWhen: "record.priority == 'low'" },
          ],
        },
      ],
      {
        objectSchema: withRules({
          notes: { visibleWhen: "record.priority == 'urgent'" },
          status: { visibleWhen: "record.priority == 'low'" },
          title: { visibleWhen: "record.priority == 'low'" },
        }),
      },
    );
    await awaitForm();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });

  it('CONTROL: a static readonly is not weakened by a readonlyWhen that resolves false', async () => {
    // `resolveFieldRuleState`'s rule, inherited rather than re-derived: a rule
    // may only ADD a lock. A renderer that replaced the static flag with the
    // predicate's verdict would unlock this field.
    const { container } = renderInternal(
      [{ label: 'Basics', fields: ['priority', { field: 'notes', readonly: true }] }],
      { objectSchema: withRules({ notes: { readonlyWhen: "record.priority == 'urgent'" } }) },
    );
    await awaitForm();
    expect(controlFor(container, 'notes')).toBeDisabled();
  });

  it('CONTROL: a field with no object rules at all renders editable and optional', async () => {
    const { container } = renderInternal([{ label: 'Basics', fields: ['priority', 'notes'] }]);
    await awaitForm();
    expect(controlFor(container, 'notes')).not.toBeDisabled();
    expect(controlFor(container, 'notes')).not.toBeRequired();
    expect(labelFor(container, 'notes').textContent).not.toContain('*');
  });
});

// ─── 3. The `serverOwnedValue` carve-out (ruled: reuse, do not re-derive) ─

describe('objectui#5627 — requiredWhen takes the serverOwnedValue carve-out', () => {
  const SERVER_OWNED = withRules({
    due_at: { defaultValue: 'NOW()', requiredWhen: "record.priority == 'low'" },
  });

  it('does NOT require a server-owned field on a CREATE form, though requiredWhen is true', async () => {
    // #4069 / #4085, applied by `resolveFieldRuleState` itself: a create form
    // leaves a producer-owned control empty so the server resolves the declared
    // runtime default, and nothing the client evaluates may then declare it
    // required — there would be nothing the user could type to unblock.
    const { container } = renderInternal([{ label: 'Basics', fields: ['priority', 'due_at'] }], {
      objectSchema: SERVER_OWNED,
    });
    await awaitForm();
    expect(controlFor(container, 'due_at')).not.toBeRequired();
    expect(labelFor(container, 'due_at').textContent).not.toContain('*');
  });

  it('DOES require the same field on an EDIT form — the carve-out is create-only', async () => {
    // The control for the case above: without it, "not required" would be
    // equally satisfied by a renderer that never honours `requiredWhen` at all,
    // which is precisely the pre-#5627 behaviour.
    const { container } = renderInternal([{ label: 'Basics', fields: ['priority', 'due_at'] }], {
      objectSchema: SERVER_OWNED,
      query: '?recordId=task-42',
      extraRoutes: [
        {
          match: '/data/showcase_task/task-42',
          body: {
            object: 'showcase_task',
            id: 'task-42',
            record: { id: 'task-42', priority: 'low', due_at: '2026-01-01' },
          },
        },
      ],
    });
    await awaitForm();
    expect(controlFor(container, 'due_at')).toBeRequired();
    expect(labelFor(container, 'due_at').textContent).toContain('*');
  });
});

// ─── 4. The row-building step the DOM cases stand on ─────────────────────

describe('objectui#5627 — the keys reach the rows, in their own slots', () => {
  it('buildSections carries the SECTION predicate onto the row, from `visibleWhen` only', () => {
    const sections = buildSections(
      {
        sections: [
          { label: 'a', visibleWhen: 'record.x == 1', fields: ['f'] },
          { label: 'b', visibleWhen: { dialect: 'cel', source: 'record.x == 2' }, fields: ['f'] },
          // @ts-expect-error objectui#12696 — `FormSectionSpec` refuses the retired key; this raw section carries it on purpose
          { label: 'c', visibleOn: 'record.x == 4', fields: ['f'] },
          { label: 'd', fields: ['f'] },
        ],
      },
      null,
    );

    // `c`: the retired spelling reaches no row (objectui#12654).
    expect(sections.map((s) => s.visibleWhen)).toEqual([
      'record.x == 1',
      { dialect: 'cel', source: 'record.x == 2' },
      undefined,
      undefined,
    ]);
  });

  it('buildSections carries the OBJECT rules into `rules`, without collapsing the view slot', () => {
    const [section] = buildSections(
      {
        sections: [
          {
            fields: [
              'a',
              { field: 'b', visibleWhen: 'view.predicate' },
              { field: 'c' },
            ],
          },
        ],
      },
      {
        name: 'o',
        fields: {
          a: {
            type: 'text',
            visibleWhen: 'object.visible',
            readonlyWhen: 'object.readonly',
            requiredWhen: 'object.required',
          },
          b: { type: 'text', visibleWhen: 'object.visible' },
          c: { type: 'text' },
        },
      },
    );

    expect(section.fields[0].rules).toEqual({
      visibleWhen: 'object.visible',
      readonlyWhen: 'object.readonly',
      requiredWhen: 'object.required',
    });
    // Two slots, two layers: the view predicate stays where #5594 put it and
    // the object rule keeps its own. A `??` merge would leave one of these two
    // holding the other's predicate.
    expect(section.fields[1].visibleWhen).toBe('view.predicate');
    expect(section.fields[1].rules?.visibleWhen).toBe('object.visible');
    expect(section.fields[2].visibleWhen).toBeUndefined();
    expect(section.fields[2].rules).toEqual({
      visibleWhen: undefined,
      readonlyWhen: undefined,
      requiredWhen: undefined,
    });
  });

  it('isSectionVisible answers the predicate, and fails open on a broken one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sections = buildSections(
      {
        sections: [
          { label: 'plain', fields: ['f'] },
          { label: 'cond', visibleWhen: "record.k == 'y'", fields: ['f'] },
          { label: 'broken', visibleWhen: 'record.k ===', fields: ['f'] },
        ],
      },
      null,
    );
    const [plain, cond, broken] = sections;

    expect(isSectionVisible(plain, {})).toBe(true);
    expect(isSectionVisible(cond, { k: 'y' })).toBe(true);
    expect(isSectionVisible(cond, { k: 'n' })).toBe(false);
    expect(isSectionVisible(broken, { k: 'n' })).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('resolveRowState folds both visibility layers and both static flags into one verdict', () => {
    const [section] = buildSections(
      {
        sections: [
          {
            fields: [
              { field: 'plain' },
              { field: 'viewHidden', visibleWhen: "record.k == 'y'" },
              { field: 'objectHidden' },
              { field: 'locked' },
              { field: 'needed' },
              { field: 'owned' },
            ],
          },
        ],
      },
      {
        name: 'o',
        fields: {
          objectHidden: { type: 'text', visibleWhen: "record.k == 'y'" },
          locked: { type: 'text', readonlyWhen: "record.k == 'n'" },
          needed: { type: 'text', requiredWhen: "record.k == 'n'" },
          owned: { type: 'text', defaultValue: 'NOW()', requiredWhen: "record.k == 'n'" },
        },
      },
    );
    const byName = Object.fromEntries(section.fields.map((f) => [f.name, f]));
    const values = { k: 'n' };
    const isCreate = true;

    expect(resolveRowState(byName.plain, values, null, isCreate)).toEqual({
      visible: true,
      readonly: false,
      required: false,
      // No rule, no fault — the report the submit check reads (objectui#8069).
      faults: {},
    });
    expect(resolveRowState(byName.viewHidden, values, null, isCreate).visible).toBe(false);
    expect(resolveRowState(byName.objectHidden, values, null, isCreate).visible).toBe(false);
    expect(resolveRowState(byName.locked, values, null, isCreate).readonly).toBe(true);
    expect(resolveRowState(byName.needed, values, null, isCreate).required).toBe(true);
    // Create + runtime default -> the carve-out wins over the true predicate;
    // the SAME row on an edit form is required.
    expect(resolveRowState(byName.owned, values, null, true).required).toBe(false);
    expect(resolveRowState(byName.owned, values, {}, false).required).toBe(true);
  });
});
