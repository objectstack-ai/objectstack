/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6958 — a field its OWN `visibleWhen` has just hidden must not carry
 * its old value to the server.
 *
 * ## The measured dead end (card body, driven in Chromium on 17.1.0)
 *
 * `crm_event_attendee` has four mutually-exclusive party columns and an
 * `attendee_type` naming which one applies. `visibleWhen` on each column does
 * hide the three the type does not name — and the hidden column's value stayed
 * in form state and was submitted anyway:
 *
 *   POST … {"attendee_type":"lead","crm_contact":"AEwPffbkMvx-OlC4", …}
 *   400 VALIDATION_FAILED
 *   "An attendee names exactly one party — clear every party column its
 *    Attendee Type does not name"
 *
 * The refusal is CORRECT and names a column that is no longer on screen to
 * clear. On the EDIT path the stored `crm_contact` was re-sent on every
 * attempt, so such a record could never be retyped through the Console at all
 * (twelve seeded rows were in that state). Central triage graded the card p1
 * and fixed the consumer-side requirement at exactly one sentence:
 * *`visibleWhen` on a populated field must stop producing an unsubmittable
 * form* (objectui#6958 comment 5547207212).
 *
 * ## Why the value is cleared to `null` and not merely withheld
 *
 * The card offered two shapes: clear the value, or stop submitting invisible
 * fields. **Withholding cannot fix the edit path**, and this repo has already
 * measured why (objectui#6848, `GeolocationClearEmission.test.tsx`):
 *
 *   > `driver-memory`'s `update()` merges `{ ...stored, ...data }` and
 *   > `driver-sql`'s issues `SET` for the keys present — so an absent key keeps
 *   > the stored value and an explicit `null` overwrites it. The platform
 *   > states the same contract in prose: *"To clear the stored X, write null;
 *   > to leave it unchanged, omit the field."*
 *
 * An omitted `crm_contact` therefore leaves the stored contact in place: the
 * merged row still names two parties and the same refusal comes back — or, if a
 * validator ever read the delta alone, the row would silently persist a party
 * column its type does not name, which is worse than the loud refusal. So the
 * key must be PRESENT and `null`. That is what the edit-path rows below assert,
 * `JSON.stringify` included — `undefined` would satisfy a `== null` assertion
 * and then stop existing on the wire, which is the exact trap #6848 documents.
 *
 * ## The boundary — what this does NOT clear
 *
 * Only the field's OWN authored conditional-visibility predicate clears:
 * `visibleWhen` (canonical, ADR-0089) and its deprecated view-level sibling
 * `visibleOn` (#2212) — the same pair the stale-error effect in `form.tsx`
 * already treats as one verdict. Deliberately untouched, each pinned below:
 *
 *   - a field claimed by a hidden SECTION (#6236) and a field on a hidden TAB
 *     (#6237) keep the ruled semantics of the 2026-08-27 maintainer ruling —
 *     visibility decides what is DRAWN and nothing else, their values still
 *     submit;
 *   - a statically `hidden: true` field is not conditionally hidden at all and
 *     keeps its value (that is how a fixed value is carried into a payload);
 *   - a BROKEN predicate fails OPEN, so the field is visible and nothing is
 *     cleared — a typo must never silently null a stored column;
 *   - a field that is already empty is never written to, so a create form
 *     cannot turn an absent key into an explicit `null` and suppress a
 *     server-side default (#4069).
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 * Remove the `clearedOnHide` effect in `form.tsx` and the three CLEAR rows go
 * red in the STALE direction (the payload carries the old value again), while
 * every boundary row above stays green — they pin semantics the effect must not
 * disturb, not the effect itself. Measured in that direction; see the PR.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';

/** The canonical wire shape `@objectstack/spec` normalizes to (ADR-0089 D2). */
const cel = (source: string) => ({ dialect: 'cel', source });

function renderForm(schema: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form schema={{ type: 'form', showSubmit: true, submitLabel: 'Save', ...schema }} />,
  );
}

/** The card's object, reduced to the two party columns the report drives. */
const PARTY_FIELDS = [
  { name: 'attendee_type', label: 'Attendee Type', type: 'input' },
  {
    name: 'crm_contact',
    label: 'Contact',
    type: 'input',
    visibleWhen: cel("record.attendee_type == 'contact'"),
  },
  {
    name: 'sys_user',
    label: 'User',
    type: 'input',
    visibleWhen: cel("record.attendee_type == 'user'"),
  },
];

const save = () => fireEvent.click(screen.getByRole('button', { name: /save/i }));
const retype = (next: string) =>
  fireEvent.change(screen.getByLabelText(/attendee type/i), { target: { value: next } });

async function payloadOf(onSubmit: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return onSubmit.mock.calls[0][0] as Record<string, unknown>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('#6958 — a field its own `visibleWhen` hides is cleared, not carried', () => {
  it('CREATE: the value typed while the field was visible does not reach the payload', async () => {
    const onSubmit = vi.fn();
    renderForm({ fields: PARTY_FIELDS, defaultValues: { attendee_type: 'contact' }, onSubmit });

    fireEvent.change(screen.getByLabelText(/^contact$/i), {
      target: { value: 'AEwPffbkMvx-OlC4' },
    });
    retype('lead');
    // The control the refusal names is genuinely off screen now.
    expect(screen.queryByLabelText(/^contact$/i)).toBeNull();

    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.crm_contact).toBeNull();
    expect(payload.attendee_type).toBe('lead');
  });

  it('EDIT: the STORED value is overwritten with an explicit null that survives serialization', async () => {
    const onSubmit = vi.fn();
    const stored = { attendee_type: 'contact', crm_contact: 'dzjN7iIOQeQCPQjo' };
    renderForm({
      fields: PARTY_FIELDS,
      defaultValues: stored,
      previousValues: stored,
      onSubmit,
    });

    retype('user');
    fireEvent.change(screen.getByLabelText(/^user$/i), { target: { value: 'brZgpOK4zIBLFPza' } });

    save();
    const payload = await payloadOf(onSubmit);
    expect(payload.crm_contact).toBeNull();
    expect(payload.sys_user).toBe('brZgpOK4zIBLFPza');
    // The half #6848 says an `== null` assertion alone would miss: an absent
    // key means "leave it unchanged" on a PATCH, so the stored contact would
    // survive and the row would stay un-retypeable.
    expect(Object.keys(JSON.parse(JSON.stringify(payload)))).toContain('crm_contact');
  });

  it('the deprecated view-level `visibleOn` clears the same way — one verdict, one behaviour', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'attendee_type', label: 'Attendee Type', type: 'input' },
        {
          name: 'crm_contact',
          label: 'Contact',
          type: 'input',
          visibleOn: cel("record.attendee_type == 'contact'"),
        },
      ],
      defaultValues: { attendee_type: 'contact', crm_contact: 'AEwPffbkMvx-OlC4' },
      onSubmit,
    });

    retype('lead');
    save();
    expect((await payloadOf(onSubmit)).crm_contact).toBeNull();
  });

  it('a field that comes back into view stays empty — the clear is a clear, not a stash', async () => {
    const onSubmit = vi.fn();
    renderForm({ fields: PARTY_FIELDS, defaultValues: { attendee_type: 'contact' }, onSubmit });

    fireEvent.change(screen.getByLabelText(/^contact$/i), { target: { value: 'AEwPffbk' } });
    retype('lead');
    retype('contact');

    await waitFor(() => expect(screen.getByLabelText(/^contact$/i)).toBeInTheDocument());
    expect((screen.getByLabelText(/^contact$/i) as HTMLInputElement).value).toBe('');
  });

  it('BOUNDARY — a hidden SECTION\'s claimed field still submits its value (#6236 ruling intact)', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'plan', label: 'Plan', type: 'input' },
        {
          name: 'pay',
          label: 'Compensation',
          type: 'section-divider',
          visibleWhen: cel("record.plan == 'standard'"),
          fields: ['salary'],
        },
        { name: 'salary', label: 'Salary', type: 'input' },
      ],
      defaultValues: { plan: 'standard', salary: '120000' },
      onSubmit,
    });

    fireEvent.change(screen.getByLabelText(/plan/i), { target: { value: 'basic' } });
    await waitFor(() => expect(screen.queryByLabelText(/salary/i)).toBeNull());

    save();
    expect((await payloadOf(onSubmit)).salary).toBe('120000');
  });

  it('BOUNDARY — a hidden TAB\'s field still submits its value (#6237 ruling intact)', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'plan', label: 'Plan', type: 'input' },
        { name: 'salary', label: 'Salary', type: 'input' },
      ],
      fieldTabs: [
        { key: 'main', label: 'Main', fields: ['plan'] },
        {
          key: 'pay',
          label: 'Compensation',
          fields: ['salary'],
          visibleWhen: cel("record.plan == 'standard'"),
        },
      ],
      defaultValues: { plan: 'standard', salary: '120000' },
      onSubmit,
    });

    fireEvent.change(screen.getByLabelText(/plan/i), { target: { value: 'basic' } });
    await waitFor(() => expect(screen.queryByRole('tab', { name: /compensation/i })).toBeNull());

    save();
    expect((await payloadOf(onSubmit)).salary).toBe('120000');
  });

  it('BOUNDARY — a statically `hidden` field keeps its value', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'plan', label: 'Plan', type: 'input' },
        { name: 'source', label: 'Source', type: 'input', hidden: true },
      ],
      defaultValues: { plan: 'standard', source: 'import' },
      onSubmit,
    });

    save();
    expect((await payloadOf(onSubmit)).source).toBe('import');
  });

  it('BOUNDARY — a BROKEN predicate fails open, so nothing is cleared — and nothing is written either', async () => {
    // The constraint ADR-0137 carries verbatim from this card: a broken
    // predicate must NEVER silently null a stored column. It holds in two
    // halves since objectui#8069 (D3 + D2): at RENDER the rule fails open, so
    // the clear-on-hide never fires and the value stays in the form; at SUBMIT
    // the unevaluable `visibleWhen` refuses the write, so neither a null nor
    // the unchecked value reaches the host. Before #8069 the second half was
    // "the value is written as it stood", which this pin used to assert.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'plan', label: 'Plan', type: 'input' },
        {
          name: 'crm_contact',
          label: 'Contact',
          type: 'input',
          visibleWhen: cel("'x' in no_such_root.positions"),
        },
      ],
      defaultValues: { plan: 'standard', crm_contact: 'AEwPffbk' },
      onSubmit,
    });

    fireEvent.change(screen.getByLabelText(/plan/i), { target: { value: 'basic' } });
    // Not cleared: the field is still drawn and still holds its value.
    expect((screen.getByLabelText(/contact/i) as HTMLInputElement).value).toBe('AEwPffbk');
    save();
    await waitFor(() =>
      expect(screen.getByText(/visibleWhen rule of Contact could not be evaluated/)).toBeTruthy(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/contact/i) as HTMLInputElement).value).toBe('AEwPffbk');
  });

  it('BOUNDARY — an already-empty hidden field is never written to (no invented null)', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'attendee_type', label: 'Attendee Type', type: 'input' },
        {
          name: 'crm_contact',
          label: 'Contact',
          type: 'input',
          visibleWhen: cel("record.attendee_type == 'contact'"),
        },
      ],
      // `crm_contact` is absent from the defaults and never typed into: a
      // create form must keep omitting the key so the server resolves the
      // declared runtime default (#4069).
      defaultValues: { attendee_type: 'lead' },
      onSubmit,
    });

    save();
    expect(await payloadOf(onSubmit)).not.toHaveProperty('crm_contact');
  });
});
