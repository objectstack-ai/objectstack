// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5883 — a CLEARED server-owned control must not put its key in the
 * create payload.
 *
 * ## The mechanism these tests pin
 *
 * Since objectui#5727 this renderer opens a runtime-default control EMPTY and
 * leaves the key out of `values` (`readPrefill` skips `isRuntimeDefault`
 * defaults). But `handleSubmit` submitted `values` WHOLESALE, and a control the
 * user touches writes back through `onChange` — so a user who types into such a
 * control and then clears it puts the key back, holding `''`.
 *
 * `ObjectQL.applyFieldDefaults` resolves a declared default only for a field
 * that arrives ABSENT or NULL. A blank string is neither, so submitting one
 * stores `''` and silently defeats the declaration — the same suppression
 * #5727 closed, reached by the other door. The sibling chain already names the
 * pairing: `@object-ui/plugin-form`'s `omitServerResolvedDefaults` says
 * "excusing a server-owned field from `required` is only half an answer if the
 * form then submits the key anyway."
 *
 * ## What a control actually writes when cleared
 *
 * Measured rather than assumed, because the filter's notion of "empty" is the
 * whole fix. Since objectui#10179 every row renders the SHARED widget the
 * resolver names, and those differ the same way the hand-rolled controls did:
 *
 *   - text / email / url / date / time / textarea →  `''`
 *   - number / currency → `null` (`NumberField` spells
 *     `val === '' ? null : Number(val)`, so no `NaN` is reachable)
 *   - boolean / radio / select → nothing "cleared" exists; `false` and a
 *     picked option are real values, and `isMissingForRequired` deliberately
 *     does not treat `false` as absent. (The shared `select` is a Radix
 *     combobox with no empty option — the hand-rolled one had a placeholder
 *     `option value=""`, which is why this file once had a select case.)
 *
 * Both reachable spellings — `''` and `null` — are inside
 * `isMissingForRequired`, which is exactly why the fix reads THAT predicate
 * rather than testing for `''`. (A submitted `null` is one the engine would
 * still have resolved; a submitted `''` is not. Dropping both keeps this
 * renderer's notion of empty identical to the sibling's instead of inventing a
 * narrower second one.)
 *
 * ## The counter-probes are the load-bearing half
 *
 * "The key is omitted" is satisfiable by omitting everything, so the positive
 * assertions are worth nothing without these:
 *
 *   - a field with NO runtime default that the user clears still submits `''`
 *     — clearing it is intent, and a filter that ate it would be a new defect;
 *   - a field the user typed a real value into submits that value;
 *   - an EDIT form submits the cleared key, because there the token was
 *     resolved at insert and a blank is a deliberate removal.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * One object carrying every shape the fix has to tell apart:
 *
 *   - `title`  — no default at all (counter-probe: typed value, and a cleared
 *                blank, both survive)
 *   - `status` — a STATIC literal default (counter-probe: seeded, and a clear
 *                is a real removal)
 *   - `owner`  — a runtime TOKEN default on the text control
 *   - `remind_at` — a runtime TOKEN default on the date control
 *   - `priority`  — a CEL envelope default on the number control (writes `null`)
 *   - `stage`     — a CEL envelope default on a select, left untouched (the
 *                   shared select has no cleared state — see above)
 */
const OBJECT_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: { type: 'text', label: 'Status', defaultValue: 'draft' },
    // `text`, not `user`: this row is the TEXT control's case. It was spelled
    // `user` while this page rendered every `user` field as a text box — the
    // silent degradation objectui#10179 removed; a `user` field now renders
    // the shared person picker, which has no keystroke-clear to probe.
    owner: { type: 'text', label: 'Owner', defaultValue: 'current_user' },
    remind_at: { type: 'date', label: 'Remind At', defaultValue: 'NOW()' },
    priority: {
      type: 'number',
      label: 'Priority',
      defaultValue: { dialect: 'cel', source: 'defaultPriority()' },
    },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'new', label: 'New' },
        { value: 'done', label: 'Done' },
      ],
      defaultValue: { dialect: 'cel', source: 'initialStage()' },
    },
  },
};

const FIELD_NAMES = ['title', 'status', 'owner', 'remind_at', 'priority', 'stage'];

function viewEnvelope() {
  return {
    name: 'showcase_task.edit',
    object: 'showcase_task',
    viewKind: 'form',
    label: 'Task',
    config: { type: 'simple', sections: [{ label: 'Task', fields: FIELD_NAMES }] },
  };
}

const CREATE_RESPONSE = {
  object: 'showcase_task',
  id: 'task-42',
  record: { id: 'task-42' },
};

/** The stored row an EDIT form opens on. */
const STORED_RECORD = {
  object: 'showcase_task',
  id: 'task-7',
  record: {
    id: 'task-7',
    title: 'Stored title',
    status: 'active',
    owner: 'user-1',
    remind_at: '2026-01-02',
    priority: 3,
    stage: 'new',
  },
};

/** Every write this page makes, with its parsed body — the PAYLOAD, not state. */
let writes: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];

function stubFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' || method === 'PATCH') {
      writes.push({
        url: String(url),
        method,
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
    }
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) throw new Error(`unstubbed fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => routes[key],
      text: async () => JSON.stringify(routes[key]),
    } as unknown as Response;
  });
}

function renderInternal(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/forms/showcase_task.edit${query}`]}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderPublic() {
  return render(
    <MemoryRouter initialEntries={['/f/contact-us']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const CREATE_ROUTES = {
  '/meta/view/': viewEnvelope(),
  '/meta/object/': OBJECT_SCHEMA,
  '/data/showcase_task': CREATE_RESPONSE,
};

/** The single write this page made, as the server would receive it. */
async function submittedPayload(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(writes).toHaveLength(1));
  return writes[0].body;
}

beforeEach(() => {
  // The submit button reads the i18n catalogue (objectui#11071) through the
  // provider `main.tsx` mounts above this route. The app's own factory
  // registers its instance as react-i18next's global, which is how this
  // unwrapped route reaches the `en` pack; the harness restores the global
  // after every test (`installI18nGlobalReset`).
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  writes = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('create submit — a touched-then-cleared server-owned field', () => {
  it('omits the key entirely on the text arm, so the declared token still resolves', async () => {
    vi.stubGlobal('fetch', stubFetch(CREATE_ROUTES));
    renderInternal();

    const owner = await screen.findByLabelText(/Owner/);
    // #5727 already guarantees the control opens EMPTY — the token is not
    // seeded. The user is what puts the key back.
    expect(owner).toHaveValue('');
    await userEvent.type(owner, 'someone');
    await userEvent.clear(owner);

    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    const body = await submittedPayload();
    expect(Object.prototype.hasOwnProperty.call(body, 'owner')).toBe(false);
  });

  it('omits it on the date arm too', async () => {
    vi.stubGlobal('fetch', stubFetch(CREATE_ROUTES));
    renderInternal();

    const remind = await screen.findByLabelText(/Remind At/);
    // `fireEvent.change` rather than `userEvent.type` on the date/number/select
    // arms: what is under test is the `onChange` write itself, and a date input
    // is exactly where synthetic keystroke emulation is least faithful.
    fireEvent.change(remind, { target: { value: '2026-03-04' } });
    fireEvent.change(remind, { target: { value: '' } });

    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    const body = await submittedPayload();
    expect(Object.prototype.hasOwnProperty.call(body, 'remind_at')).toBe(false);
  });

  it('omits it on the number arm, whose cleared write is `null` rather than a blank string', async () => {
    vi.stubGlobal('fetch', stubFetch(CREATE_ROUTES));
    renderInternal();

    const priority = await screen.findByLabelText(/Priority/);
    fireEvent.change(priority, { target: { value: '7' } });
    fireEvent.change(priority, { target: { value: '' } });

    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    const body = await submittedPayload();
    expect(Object.prototype.hasOwnProperty.call(body, 'priority')).toBe(false);
  });

  it('does the same on the anonymous public route', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/forms/contact-us/submit': { ok: true },
        '/forms/contact-us': {
          slug: 'contact-us',
          object: 'showcase_task',
          label: 'Contact us',
          form: { type: 'simple', sections: [{ fields: FIELD_NAMES }] },
          objectSchema: OBJECT_SCHEMA,
        },
      }),
    );
    renderPublic();

    const owner = await screen.findByLabelText(/Owner/);
    await userEvent.type(owner, 'someone');
    await userEvent.clear(owner);

    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    const body = await submittedPayload();
    expect(Object.prototype.hasOwnProperty.call(body, 'owner')).toBe(false);
  });
});

describe('counter-probes — what the filter must NOT eat', () => {
  it('still submits a blank the user cleared from a field with no runtime default', async () => {
    vi.stubGlobal('fetch', stubFetch(CREATE_ROUTES));
    renderInternal();

    const title = await screen.findByLabelText(/Title/);
    await userEvent.type(title, 'draft idea');
    await userEvent.clear(title);

    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    const body = await submittedPayload();
    expect(Object.prototype.hasOwnProperty.call(body, 'title')).toBe(true);
    expect(body.title).toBe('');
  });

  it('still submits a blank the user cleared from a STATIC default, which is a real removal', async () => {
    vi.stubGlobal('fetch', stubFetch(CREATE_ROUTES));
    renderInternal();

    const status = await screen.findByLabelText(/Status/);
    // The static default IS seeded (#4068), so clearing it removes a value the
    // user could see.
    expect(status).toHaveValue('draft');
    await userEvent.clear(status);

    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    const body = await submittedPayload();
    expect(Object.prototype.hasOwnProperty.call(body, 'status')).toBe(true);
    expect(body.status).toBe('');
  });

  it('submits the real value a user typed into a server-owned field', async () => {
    vi.stubGlobal('fetch', stubFetch(CREATE_ROUTES));
    renderInternal();

    const owner = await screen.findByLabelText(/Owner/);
    await userEvent.type(owner, 'user-99');

    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    const body = await submittedPayload();
    expect(body.owner).toBe('user-99');
    // And the rest of the payload is still there — "omit the key" must not
    // become "drop the payload".
    expect(body.status).toBe('draft');
  });

  it('leaves an EDIT submit alone: a cleared server-owned column is a deliberate removal', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/meta/view/': viewEnvelope(),
        '/meta/object/': OBJECT_SCHEMA,
        '/data/showcase_task/task-7': STORED_RECORD,
      }),
    );
    renderInternal('?recordId=task-7&recordObject=showcase_task');

    const owner = await screen.findByLabelText(/Owner/);
    expect(owner).toHaveValue('user-1');
    await userEvent.clear(owner);

    await userEvent.click(screen.getByRole('button', { name: /Submit/ }));

    const body = await submittedPayload();
    expect(writes[0].method).toBe('PATCH');
    expect(Object.prototype.hasOwnProperty.call(body, 'owner')).toBe(true);
    expect(body.owner).toBe('');
  });
});
