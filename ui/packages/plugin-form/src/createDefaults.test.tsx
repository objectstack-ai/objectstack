/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A CREATE form seeds the object schema's declared `defaultValue`s (#4047).
 *
 * `ObjectForm` has always done this; the four sectioned/overlay containers
 * (Modal / Drawer / Tabbed / Split) and the wizard did not — their create
 * branch set the form data to `initialData || initialValues || {}` and never
 * looked at the object schema. The console's create dialog IS the global
 * `<ModalForm>`, so a field declared `required: true, defaultValue: 'draft'`
 * opened with an empty select and a required marker: the user had to pick a
 * value the system already knew, and every neighbouring option (some with side
 * effects) was one click away.
 *
 * Four directions are pinned here, because "seed the defaults" is wrong in
 * three of them:
 *
 *   1. create + declared default        → preselected AND submittable
 *   2. create + no default              → still empty (no invention)
 *   3. edit                             → the STORED record wins; a default is
 *      never folded in over a persisted row (an edit form must not silently
 *      rewrite a column the user never touched)
 *   4. create + a RUNTIME default       → left empty for the server. `NOW()` /
 *      `current_user` (`DEFAULT_VALUE_TOKENS`) and CEL Expression envelopes are
 *      instructions, not values: seeding them literally would put the text
 *      `NOW()` into a datetime input and submit it as the field's value, which
 *      is strictly worse than today's empty control. The engine resolves them
 *      at insert time for exactly the omitted-field case.
 *
 * Caller-supplied `initialData` / `initialValues` outrank a schema default in
 * every case — they are the more specific instruction (a lookup prefill, a
 * "duplicate this record" seed).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DEFAULT_VALUE_TOKENS } from '@objectstack/spec/data';
import { registerAllFields } from '@object-ui/fields';
import { isRuntimeDefault, isRequiredInForm, isSeedableDefault } from './schemaDefaults';
import { ObjectForm } from './ObjectForm';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';
import { TabbedForm } from './TabbedForm';
import { SplitForm } from './SplitForm';

registerAllFields();

const STATUS_OPTIONS = [
  { label: 'Draft', value: 'draft', default: true },
  { label: 'Pending Approval', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

/** The reported object: a required select carrying a field-level default. */
const OBJECT_SCHEMA = {
  name: 'rating',
  fields: {
    title: { type: 'text', label: 'Title' },
    // The reported field — both spellings present, as in the issue.
    status: { type: 'select', label: 'Status', required: true, defaultValue: 'draft', options: STATUS_OPTIONS },
    // No default at all: must stay untouched.
    stage: { type: 'select', label: 'Stage', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
  },
};

const makeDS = (objectSchema: any = OBJECT_SCHEMA, record?: any) =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    create: vi.fn().mockResolvedValue({ id: 'r1' }),
    update: vi.fn().mockResolvedValue({ id: 'r1' }),
    findOne: vi.fn().mockResolvedValue(record ?? { id: 'r1' }),
  }) as any;

const SECTIONS = [{ name: 'basics', label: 'Basics', fields: ['title', 'status', 'stage'] }];

/** The label a select trigger currently displays (placeholder when unset). */
const triggerText = (field: string) =>
  document.body.querySelector(`[data-testid="select-trigger-${field}"]`)?.textContent ?? '';

const submit = () => {
  const form = document.body.querySelector('form') as HTMLFormElement;
  fireEvent.submit(form);
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

/**
 * The four sectioned containers share one create branch, so they are pinned as
 * one table. `ObjectForm` (the flat container) is covered separately below —
 * it already seeded, and the point there is that it still does.
 */
const CONTAINERS: Array<[string, React.ComponentType<any>, string]> = [
  ['ModalForm', ModalForm as any, 'modal'],
  ['DrawerForm', DrawerForm as any, 'drawer'],
  ['TabbedForm', TabbedForm as any, 'tabbed'],
  ['SplitForm', SplitForm as any, 'split'],
];

describe.each(CONTAINERS)('%s — create-mode default seeding (#4047)', (_name, Container, formType) => {
  const renderCreate = (ds: any, extra: Record<string, unknown> = {}) =>
    render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'rating',
          mode: 'create',
          open: true,
          sections: SECTIONS,
          ...extra,
        } as any}
        dataSource={ds}
      />,
    );

  it('preselects a declared `defaultValue` and submits it without a manual choice', async () => {
    const ds = makeDS();
    renderCreate(ds);

    await waitFor(() => expect(triggerText('status')).toContain('Draft'));

    submit();
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ status: 'draft' });
  });

  it('leaves a field with no declared default empty', async () => {
    const ds = makeDS();
    renderCreate(ds);

    await waitFor(() => expect(triggerText('status')).toContain('Draft'));
    expect(triggerText('stage')).not.toContain('A');
    expect(triggerText('stage')).not.toContain('B');
  });

  it('lets caller-supplied initial values outrank the schema default', async () => {
    const ds = makeDS();
    renderCreate(ds, { initialData: { status: 'pending' } });

    await waitFor(() => expect(triggerText('status')).toContain('Pending Approval'));
  });

  it('does not seed a runtime default token — the server resolves it at insert', async () => {
    const ds = makeDS({
      name: 'rating',
      fields: {
        title: { type: 'text', label: 'Title' },
        remind_at: { type: 'datetime', label: 'Remind at', defaultValue: 'NOW()' },
        assignee: { type: 'text', label: 'Assignee', defaultValue: 'current_user' },
        note: { type: 'text', label: 'Note', defaultValue: { dialect: 'cel', source: 'today()' } },
      },
    });
    render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'rating',
          mode: 'create',
          open: true,
          sections: [{ name: 'basics', label: 'Basics', fields: ['title', 'remind_at', 'assignee', 'note'] }],
        } as any}
        dataSource={ds}
      />,
    );

    const assigneeInput = await waitFor(() => {
      const el = document.body.querySelector<HTMLInputElement>('[data-field="assignee"] input');
      if (!el) throw new Error('assignee input not rendered');
      return el;
    });
    expect(assigneeInput.value).toBe('');
    expect(
      document.body.querySelector<HTMLInputElement>('[data-field="note"] input')?.value ?? '',
    ).toBe('');
    expect(document.body.textContent).not.toContain('NOW()');
  });

  it('does not fold a schema default into an EDIT form over the stored record', async () => {
    // The stored row does not carry `status` AT ALL — the sharp case. A row
    // carrying `status: null` would hide a seeding bug behind the spread (the
    // explicit null overwrites the default either way), so it proves nothing;
    // an ABSENT key is what a leaking default actually shows up on. An edit
    // form must show the row as the server holds it — seeding `draft` here
    // would arm a silent write of a value the user never chose, the moment
    // they save some unrelated field.
    const ds = makeDS(OBJECT_SCHEMA, { id: 'r1', title: 'Acme' });
    render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'rating',
          mode: 'edit',
          recordId: 'r1',
          open: true,
          sections: SECTIONS,
        } as any}
        dataSource={ds}
      />,
    );

    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    await waitFor(() => {
      const el = document.body.querySelector<HTMLInputElement>('[data-field="title"] input');
      if (el?.value !== 'Acme') throw new Error('record not loaded yet');
    });
    expect(triggerText('status')).not.toContain('Draft');
  });
});

describe('ObjectForm — create-mode default seeding stays put (#4047)', () => {
  it('preselects a declared `defaultValue` on create', async () => {
    const ds = makeDS();
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'rating', mode: 'create' } as any}
        dataSource={ds}
      />,
    );

    await waitFor(() => expect(triggerText('status')).toContain('Draft'));
    submit();
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ status: 'draft' });
  });

  it('does not seed a runtime default token on create', async () => {
    const ds = makeDS({
      name: 'rating',
      fields: {
        title: { type: 'text', label: 'Title' },
        assignee: { type: 'text', label: 'Assignee', defaultValue: 'current_user' },
      },
    });
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'rating', mode: 'create' } as any}
        dataSource={ds}
      />,
    );

    const assigneeInput = await waitFor(() => {
      const el = document.body.querySelector<HTMLInputElement>('[data-field="assignee"] input');
      if (!el) throw new Error('assignee input not rendered');
      return el;
    });
    expect(assigneeInput.value).toBe('');
  });

  it('does not fold a schema default into an EDIT form over the stored record', async () => {
    // Absent key, not `status: null` — see the sectioned suite above for why
    // the null variant cannot fail. This is the assertion that goes red if the
    // create-only gate on the seeding pass is removed.
    const ds = makeDS(OBJECT_SCHEMA, { id: 'r1', title: 'Acme' });
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'rating', mode: 'edit', recordId: 'r1' } as any}
        dataSource={ds}
      />,
    );

    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    await waitFor(() => {
      const el = document.body.querySelector<HTMLInputElement>('[data-field="title"] input');
      if (el?.value !== 'Acme') throw new Error('record not loaded yet');
    });
    expect(triggerText('status')).not.toContain('Draft');
  });
});

/**
 * A REQUIRED field whose `defaultValue` is a RUNTIME instruction is
 * submittable from a create form (#4069).
 *
 * The half above leaves such a field empty on purpose — the token is an
 * instruction the server resolves per insert, and `applyFieldDefaults` only
 * fills fields that arrive absent or null, so seeding the literal text `NOW()`
 * would suppress the very resolution the declaration asked for. Correct for an
 * optional field. Combined with `required: true` it deadlocked the form:
 *
 * ```ts
 * remind_at: Field.datetime({ required: true, defaultValue: 'NOW()' }),
 * ```
 *
 * the control opened empty, the client-side required rule refused the submit,
 * and there was nothing sensible for the user to type — the declaration had
 * already said what the value is. Measured on `origin/main` before this change:
 * `dataSource.create` was never called, on both the flat and the sectioned
 * path.
 *
 * Ruled by the maintainer on 2026-08-10 (issue #4069, option A): in CREATE mode
 * a runtime `defaultValue` SUPPRESSES the client-side required rule, and the
 * field is omitted from the payload for the producer to resolve. Rejected in
 * the same ruling: resolving these client-side (two implementations of one
 * contract), serving resolved defaults from the server, and refusing the
 * `required` + runtime-default combination at publish time — it is coherent
 * authoring, storage-level required with a producer-guaranteed value.
 *
 * Four directions are pinned, because the suppression is wrong in three of them:
 *
 *   1. create + runtime default, left empty → submit SUCCEEDS and the field is
 *      ABSENT from the payload (present-but-empty would defeat the point:
 *      `applyFieldDefaults` skips a field that arrives with a value)
 *   2. create + the user TYPES a value       → that value is submitted. The
 *      suppression removes the "must not be empty" rule, not the field
 *   3. create + a STATIC literal default     → still enforced. That control was
 *      seeded (above), so clearing it removes a value that was really there
 *   4. EDIT mode                             → unchanged in every case. The
 *      token was resolved at insert; blanking the column now is a real removal
 *
 * The runtime shapes are taken from `@objectstack/spec`'s own
 * `DEFAULT_VALUE_TOKENS` rather than spelled out here, so a token added to the
 * family tomorrow is pinned by this suite without an edit — and so the fixture
 * cannot drift from the classifier the way a hand-copied list would.
 */

/** A CEL Expression envelope — the non-token half of "the server resolves it". */
const CEL_DEFAULT = { dialect: 'cel', source: 'today()' };

/**
 * One required field per runtime-default SHAPE the spec defines. Every shape is
 * rendered in the same form, so one submit covers the whole family.
 */
const RUNTIME_FIELDS: Array<{ name: string; what: string; defaultValue: unknown }> = [
  ...DEFAULT_VALUE_TOKENS.map((token, i) => ({
    name: `rt_token_${i}`,
    what: `token ${String(token)}`,
    defaultValue: token as unknown,
  })),
  { name: 'rt_cel', what: 'CEL Expression envelope', defaultValue: CEL_DEFAULT },
];

/**
 * `title` is required with NO default — the control the user genuinely must
 * fill, and the contrast that proves the suppression is targeted rather than a
 * blanket "create forms do not validate".
 */
const RUNTIME_OBJECT_SCHEMA = {
  name: 'reminder',
  fields: {
    title: { type: 'text', label: 'Title', required: true },
    ...Object.fromEntries(
      RUNTIME_FIELDS.map((f) => [
        f.name,
        { type: 'text', label: f.what, required: true, defaultValue: f.defaultValue },
      ]),
    ),
  },
};

const RUNTIME_SECTIONS = [
  { name: 'basics', label: 'Basics', fields: ['title', ...RUNTIME_FIELDS.map((f) => f.name)] },
];

/** A required field carrying a STATIC literal default — the control seeding case. */
const STATIC_OBJECT_SCHEMA = {
  name: 'reminder',
  fields: {
    title: { type: 'text', label: 'Title', required: true, defaultValue: 'Untitled' },
  },
};
const STATIC_SECTIONS = [{ name: 'basics', label: 'Basics', fields: ['title'] }];

const fieldInput = (field: string) =>
  document.body.querySelector<HTMLInputElement>(`[data-field="${field}"] input`);

/** Does this field show the required marker / announce `aria-required`? */
const marksRequired = (field: string) =>
  document.body.querySelectorAll(`[data-field="${field}"] [data-required-marker]`).length > 0 ||
  fieldInput(field)?.getAttribute('aria-required') === 'true';

const awaitField = (field: string) =>
  waitFor(() => {
    const el = fieldInput(field);
    if (!el) throw new Error(`${field} input not rendered`);
    return el;
  });

describe.each(CONTAINERS)('%s — required + runtime `defaultValue` on create (#4069)', (_name, Container, formType) => {
  const renderRuntimeCreate = (ds: any) =>
    render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'reminder',
          mode: 'create',
          open: true,
          sections: RUNTIME_SECTIONS,
        } as any}
        dataSource={ds}
      />,
    );

  it('submits with the runtime-default fields left empty, and OMITS them from the payload', async () => {
    const ds = makeDS(RUNTIME_OBJECT_SCHEMA);
    renderRuntimeCreate(ds);

    const title = await awaitField('title');
    fireEvent.change(title, { target: { value: 'Ping me' } });
    submit();

    // Before this change the submit was refused here and `create` was never
    // called — with no value the user could supply to unblock it.
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    const payload = ds.create.mock.calls[0][1];
    expect(payload).toMatchObject({ title: 'Ping me' });
    // ABSENT, not empty: `applyFieldDefaults` resolves the token only for a
    // field that arrives absent or null, so an empty string in the payload
    // would store "" and silently defeat the declaration.
    for (const f of RUNTIME_FIELDS) expect(payload).not.toHaveProperty(f.name);
  });

  it('still enforces required on a field that declares NO default', async () => {
    const ds = makeDS(RUNTIME_OBJECT_SCHEMA);
    renderRuntimeCreate(ds);

    await awaitField('title'); // left empty on purpose
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ds.create).not.toHaveBeenCalled();
    expect(marksRequired('title')).toBe(true);
    // The suppression is targeted: only the server-owned fields lose the rule.
    for (const f of RUNTIME_FIELDS) expect(marksRequired(f.name)).toBe(false);
  });

  it('submits a value the user DOES type into a runtime-default field', async () => {
    const ds = makeDS(RUNTIME_OBJECT_SCHEMA);
    renderRuntimeCreate(ds);

    const title = await awaitField('title');
    fireEvent.change(title, { target: { value: 'Ping me' } });
    const typed = await awaitField(RUNTIME_FIELDS[0].name);
    fireEvent.change(typed, { target: { value: 'typed by hand' } });
    submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    // What is suppressed is the "must not be empty" rule, never the field: a
    // typed value outranks the declared default, exactly as it does today for
    // a static one.
    expect(ds.create.mock.calls[0][1]).toMatchObject({
      title: 'Ping me',
      [RUNTIME_FIELDS[0].name]: 'typed by hand',
    });
  });

  it('does NOT suppress required for a STATIC literal default the user clears', async () => {
    const ds = makeDS(STATIC_OBJECT_SCHEMA);
    render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'reminder',
          mode: 'create',
          open: true,
          sections: STATIC_SECTIONS,
        } as any}
        dataSource={ds}
      />,
    );

    // The control WAS seeded (#4047), so an empty one means the user emptied
    // it — a removed value, not a value the producer will supply.
    const title = await waitFor(() => {
      const el = fieldInput('title');
      if (el?.value !== 'Untitled') throw new Error('static default not seeded yet');
      return el;
    });
    expect(marksRequired('title')).toBe(true);

    fireEvent.change(title, { target: { value: '' } });
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('leaves EDIT mode alone — blanking a runtime-default required field is still refused', async () => {
    const stored = { id: 'r1', title: 'Acme' };
    for (const f of RUNTIME_FIELDS) (stored as any)[f.name] = 'resolved at insert';
    const ds = makeDS(RUNTIME_OBJECT_SCHEMA, stored);
    render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'reminder',
          mode: 'edit',
          recordId: 'r1',
          open: true,
          sections: RUNTIME_SECTIONS,
        } as any}
        dataSource={ds}
      />,
    );

    const target = RUNTIME_FIELDS[0].name;
    const el = await waitFor(() => {
      const input = fieldInput(target);
      if (input?.value !== 'resolved at insert') throw new Error('record not loaded yet');
      return input;
    });
    // On a persisted row the token was resolved at insert; emptying the column
    // now is a real removal, and the marker stays to say so.
    expect(marksRequired(target)).toBe(true);

    fireEvent.change(el, { target: { value: '' } });
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ds.update).not.toHaveBeenCalled();
  });
});

describe('ObjectForm — required + runtime `defaultValue` on create (#4069)', () => {
  // The flat container builds its fields on its own path (no sections), so the
  // rule is pinned here too rather than assumed from the sectioned table.
  it('submits with the runtime-default fields left empty, and OMITS them', async () => {
    const ds = makeDS(RUNTIME_OBJECT_SCHEMA);
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'reminder', mode: 'create' } as any}
        dataSource={ds}
      />,
    );

    const title = await awaitField('title');
    fireEvent.change(title, { target: { value: 'Ping me' } });
    submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    const payload = ds.create.mock.calls[0][1];
    expect(payload).toMatchObject({ title: 'Ping me' });
    for (const f of RUNTIME_FIELDS) expect(payload).not.toHaveProperty(f.name);
  });

  it('still refuses a required field that declares no default', async () => {
    const ds = makeDS(RUNTIME_OBJECT_SCHEMA);
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'reminder', mode: 'create' } as any}
        dataSource={ds}
      />,
    );

    await awaitField('title');
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ds.create).not.toHaveBeenCalled();
    expect(marksRequired('title')).toBe(true);
  });

  it('leaves EDIT mode alone', async () => {
    const stored: Record<string, unknown> = { id: 'r1', title: 'Acme' };
    for (const f of RUNTIME_FIELDS) stored[f.name] = 'resolved at insert';
    const ds = makeDS(RUNTIME_OBJECT_SCHEMA, stored);
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'reminder', mode: 'edit', recordId: 'r1' } as any}
        dataSource={ds}
      />,
    );

    const target = RUNTIME_FIELDS[0].name;
    const el = await waitFor(() => {
      const input = fieldInput(target);
      if (input?.value !== 'resolved at insert') throw new Error('record not loaded yet');
      return input;
    });
    expect(marksRequired(target)).toBe(true);

    fireEvent.change(el, { target: { value: '' } });
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ds.update).not.toHaveBeenCalled();
  });
});

describe('one classifier, two consumers (#4069)', () => {
  // Seeding (#4047/#4068) and the create-mode required rule (#4069) are the
  // same fact seen twice — a field whose value the producer supplies is
  // neither seedable nor missing. They read ONE predicate; a second copy would
  // be free to disagree about, say, a CEL envelope, and then a form would seed
  // a field it also refuses to submit.
  it.each([...DEFAULT_VALUE_TOKENS.map((t) => [String(t), t as unknown] as const), ['CEL envelope', CEL_DEFAULT as unknown] as const])(
    '%s is a runtime default: not seedable, and not required on create',
    (_what, value) => {
      expect(isRuntimeDefault(value)).toBe(true);
      expect(isSeedableDefault(value)).toBe(false);
      expect(isRequiredInForm({ required: true, defaultValue: value }, true)).toBe(false);
      // EDIT mode is untouched.
      expect(isRequiredInForm({ required: true, defaultValue: value }, false)).toBe(true);
    },
  );

  it.each([['a static literal', 'draft'], ['a number', 0], ['a boolean', false], ['no default', undefined]])(
    '%s does not suppress required in either mode',
    (_what, value) => {
      expect(isRuntimeDefault(value)).toBe(false);
      expect(isRequiredInForm({ required: true, defaultValue: value }, true)).toBe(true);
      expect(isRequiredInForm({ required: true, defaultValue: value }, false)).toBe(true);
    },
  );

  it('an optional field is never required, whatever it declares', () => {
    expect(isRequiredInForm({ defaultValue: 'NOW()' }, true)).toBe(false);
    expect(isRequiredInForm({ required: false, defaultValue: 'draft' }, false)).toBe(false);
    expect(isRequiredInForm(undefined, true)).toBe(false);
  });
});

/**
 * The CONDITIONAL half: `requiredWhen` + a runtime `defaultValue` (#4085).
 *
 * #4069 ruled the STATIC spelling — a create form does not enforce `required`
 * on a field whose value the producer resolves at insert. `requiredWhen` is
 * resolved one layer downstream, in the form renderer, against the LIVE record
 * (`resolveFieldRuleState`), so it survived that fix untouched: a predicate
 * resolving TRUE on a create form re-required a control the renderer
 * deliberately leaves empty, and the submit was refused with nothing sensible
 * for the user to type. Ruled 2026-08-11 (#4085): in CREATE mode the two
 * spellings behave identically on a producer-owned field, because `NOW()` /
 * `current_user` resolve at insert regardless of the state the predicate names.
 *
 * This is the issue's own "Reproduce" recipe: the #4069 fixture with one
 * field's `required: true` swapped for a `requiredWhen` that resolves TRUE.
 *
 * Four directions, the same three boundaries #4069 pinned plus the one this
 * card adds:
 *
 *   1. create + predicate TRUE + runtime default  → submit SUCCEEDS, key ABSENT
 *   2. create + predicate TRUE + NO default       → still refused (the contrast
 *      that proves the suppression is targeted, not "create forms don't
 *      validate")
 *   3. EDIT + predicate TRUE + runtime default    → still enforced. The token
 *      was resolved at insert; blanking the column now is a real removal
 *   4. the required MARKER tracks the same verdict — display and validation
 *      read ONE `resolveFieldRuleState` result (#4201), so a suppressed field
 *      may never show an asterisk it will not enforce
 */

/** Resolves TRUE on the fixture below, in both create and edit mode. */
const WHEN_SCHEDULED = "record.status == 'scheduled'";

/** The #4069 runtime shapes again, conditionally required instead of statically. */
const CONDITIONAL_RUNTIME_FIELDS = RUNTIME_FIELDS.map((f) => ({ ...f, name: `cw_${f.name}` }));

/**
 * `status` carries a STATIC literal default so a create form opens with the
 * predicate already TRUE — the deadlock state, reached without the user
 * touching anything.
 *
 * `plan` is conditionally required with NO default: the control the user
 * genuinely must fill, and the contrast that proves the suppression reads the
 * declared default rather than the mode alone.
 */
const CONDITIONAL_OBJECT_SCHEMA = {
  name: 'reminder',
  fields: {
    status: { type: 'text', label: 'Status', defaultValue: 'scheduled' },
    plan: { type: 'text', label: 'Plan', requiredWhen: WHEN_SCHEDULED },
    ...Object.fromEntries(
      CONDITIONAL_RUNTIME_FIELDS.map((f) => [
        f.name,
        { type: 'text', label: f.what, requiredWhen: WHEN_SCHEDULED, defaultValue: f.defaultValue },
      ]),
    ),
  },
};

const CONDITIONAL_SECTIONS = [
  {
    name: 'basics',
    label: 'Basics',
    fields: ['status', 'plan', ...CONDITIONAL_RUNTIME_FIELDS.map((f) => f.name)],
  },
];

describe.each(CONTAINERS)('%s — `requiredWhen` + runtime `defaultValue` on create (#4085)', (_name, Container, formType) => {
  const renderConditional = (ds: any, extra: Record<string, unknown> = {}) =>
    render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'reminder',
          mode: 'create',
          open: true,
          sections: CONDITIONAL_SECTIONS,
          ...extra,
        } as any}
        dataSource={ds}
      />,
    );

  it('submits with the conditionally-required runtime-default fields left empty, and OMITS them', async () => {
    const ds = makeDS(CONDITIONAL_OBJECT_SCHEMA);
    renderConditional(ds);

    const plan = await awaitField('plan');
    fireEvent.change(plan, { target: { value: 'ring the bell' } });
    // The predicate is TRUE the whole time — `status` opened seeded.
    expect(fieldInput('status')?.value).toBe('scheduled');
    submit();

    // Before this change the submit was refused here: `resolveFieldRuleState`
    // re-required every `cw_*` control from the live record, over the top of
    // the static suppression #4084 had already applied.
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    const payload = ds.create.mock.calls[0][1];
    expect(payload).toMatchObject({ plan: 'ring the bell' });
    for (const f of CONDITIONAL_RUNTIME_FIELDS) expect(payload).not.toHaveProperty(f.name);
  });

  it('drops the required marker on them, so the star and the submit agree', async () => {
    const ds = makeDS(CONDITIONAL_OBJECT_SCHEMA);
    renderConditional(ds);

    await awaitField('plan');
    // The predicate holds for every field alike; only the producer-owned ones
    // lose the rule — and they lose the marker with it, because both read one
    // verdict (#4201).
    await waitFor(() => expect(marksRequired('plan')).toBe(true));
    for (const f of CONDITIONAL_RUNTIME_FIELDS) expect(marksRequired(f.name)).toBe(false);
  });

  it('still refuses a conditionally-required field that declares NO default', async () => {
    const ds = makeDS(CONDITIONAL_OBJECT_SCHEMA);
    renderConditional(ds);

    await awaitField('plan'); // left empty on purpose
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('submits a value the user DOES type into a conditionally-required runtime-default field', async () => {
    const ds = makeDS(CONDITIONAL_OBJECT_SCHEMA);
    renderConditional(ds);

    const plan = await awaitField('plan');
    fireEvent.change(plan, { target: { value: 'ring the bell' } });
    const target = CONDITIONAL_RUNTIME_FIELDS[0].name;
    const typed = await awaitField(target);
    fireEvent.change(typed, { target: { value: 'typed by hand' } });
    submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    // What is suppressed is the "must not be empty" rule, never the field.
    expect(ds.create.mock.calls[0][1]).toMatchObject({
      plan: 'ring the bell',
      [target]: 'typed by hand',
    });
  });

  it('leaves EDIT mode alone — `requiredWhen` still enforces on a persisted row', async () => {
    const stored: Record<string, unknown> = { id: 'r1', status: 'scheduled', plan: 'ring the bell' };
    for (const f of CONDITIONAL_RUNTIME_FIELDS) stored[f.name] = 'resolved at insert';
    const ds = makeDS(CONDITIONAL_OBJECT_SCHEMA, stored);
    render(
      <Container
        schema={{
          type: 'object-form',
          formType,
          objectName: 'reminder',
          mode: 'edit',
          recordId: 'r1',
          open: true,
          sections: CONDITIONAL_SECTIONS,
        } as any}
        dataSource={ds}
      />,
    );

    const target = CONDITIONAL_RUNTIME_FIELDS[0].name;
    const el = await waitFor(() => {
      const input = fieldInput(target);
      if (input?.value !== 'resolved at insert') throw new Error('record not loaded yet');
      return input;
    });
    // Defaults do not re-apply to an existing record, so the predicate means
    // exactly what it says here: the marker stays and the blank is refused.
    expect(marksRequired(target)).toBe(true);

    fireEvent.change(el, { target: { value: '' } });
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ds.update).not.toHaveBeenCalled();
  });
});

describe('ObjectForm — `requiredWhen` + runtime `defaultValue` on create (#4085)', () => {
  // The flat container builds its fields on its own path (no sections), so the
  // conditional rule is pinned here too rather than assumed from the table.
  it('submits with the conditionally-required runtime-default fields left empty, and OMITS them', async () => {
    const ds = makeDS(CONDITIONAL_OBJECT_SCHEMA);
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'reminder', mode: 'create' } as any}
        dataSource={ds}
      />,
    );

    const plan = await awaitField('plan');
    fireEvent.change(plan, { target: { value: 'ring the bell' } });
    submit();

    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    const payload = ds.create.mock.calls[0][1];
    expect(payload).toMatchObject({ plan: 'ring the bell' });
    for (const f of CONDITIONAL_RUNTIME_FIELDS) expect(payload).not.toHaveProperty(f.name);
  });

  it('leaves EDIT mode alone', async () => {
    const stored: Record<string, unknown> = { id: 'r1', status: 'scheduled', plan: 'ring the bell' };
    for (const f of CONDITIONAL_RUNTIME_FIELDS) stored[f.name] = 'resolved at insert';
    const ds = makeDS(CONDITIONAL_OBJECT_SCHEMA, stored);
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'reminder', mode: 'edit', recordId: 'r1' } as any}
        dataSource={ds}
      />,
    );

    const target = CONDITIONAL_RUNTIME_FIELDS[0].name;
    const el = await waitFor(() => {
      const input = fieldInput(target);
      if (input?.value !== 'resolved at insert') throw new Error('record not loaded yet');
      return input;
    });
    expect(marksRequired(target)).toBe(true);

    fireEvent.change(el, { target: { value: '' } });
    submit();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ds.update).not.toHaveBeenCalled();
  });
});
