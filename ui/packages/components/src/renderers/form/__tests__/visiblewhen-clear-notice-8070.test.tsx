/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8070 — the record form NAMES the clear-on-hide that objectui#6958
 * introduced.
 *
 * The clear itself stands and is pinned beside this file
 * (`visiblewhen-clear-on-hide-6958.test.tsx`): a populated field whose own
 * `visibleWhen` turns it invisible has its value cleared, or the server refuses
 * the row. Until this card the clear was silent — the user saw a field vanish
 * and was not told that a stored value went with it.
 *
 * The ruling (letter A, ratified by the maintainer): after a `visibleWhen`
 * transition empties a populated field, the user sees WHICH columns were
 * cleared and WHY (they do not apply under the current values). Placement is
 * the ruling's default — one form-level notice under the form's existing
 * outcome-toast id, naming every cleared column at once, so it retires like the
 * form's other outcome messages: a later submit outcome supersedes it, and the
 * dismissal at the next attempt takes it down.
 *
 * Only a field that HELD something is named: an already-empty value, an empty
 * list and an unchecked two-state control (whose empty state is `false`) are
 * not, and neither is the first render, which only records the baseline.
 *
 * What is asserted, and what deliberately is not: the named SUBJECTS (the
 * labels the form draws), the locale JOINER between them, the toast id, and
 * that the pack key is the one read. The sentence itself is copy and is not
 * pinned.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { toast } from '../../../ui/sonner';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';

/** The canonical wire shape `@objectstack/spec` normalizes to (ADR-0089 D2). */
const cel = (source: string) => ({ dialect: 'cel', source });

let warningSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let dismissSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warningSpy = vi.spyOn(toast, 'warning').mockImplementation(() => 'id');
  errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
  dismissSpy = vi.spyOn(toast, 'dismiss').mockImplementation(() => 'id');
  // The invalid-submit path scrolls the first offending field into view.
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Two party columns that both apply only to a `contact` attendee. */
const FIELDS = [
  { name: 'attendee_type', label: 'Attendee Type', type: 'input' },
  {
    name: 'crm_contact',
    label: 'Contact',
    type: 'input',
    visibleWhen: cel("record.attendee_type == 'contact'"),
  },
  {
    name: 'contact_role',
    label: 'Role',
    type: 'input',
    visibleWhen: cel("record.attendee_type == 'contact'"),
  },
];

function renderForm(schema: Record<string, unknown>, language?: string) {
  const Form = ComponentRegistry.get('form')!;
  const form = (
    <Form schema={{ type: 'form', showSubmit: true, submitLabel: 'Save', ...schema }} />
  );
  return render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        {form}
      </I18nProvider>
    ) : (
      form
    ),
  );
}

const retype = (next: string) =>
  fireEvent.change(screen.getByLabelText(/attendee type/i), { target: { value: next } });
const save = () => fireEvent.click(screen.getByRole('button', { name: /save/i }));

/** The text of every notice raised so far. */
const notices = () => warningSpy.mock.calls.map((c: unknown[]) => String(c[0]));

describe('#8070 — a visibleWhen clear is named to the user', () => {
  it('a populated field whose visibleWhen turns false renders one notice naming its label', async () => {
    renderForm({ fields: FIELDS.slice(0, 2), defaultValues: { attendee_type: 'contact', crm_contact: 'AEwPffbk' } });

    retype('lead');

    await waitFor(() => expect(warningSpy).toHaveBeenCalledTimes(1));
    // The label the form draws, never the API name.
    expect(notices()[0]).toContain('Contact');
    expect(notices()[0]).not.toContain('crm_contact');
    // Published under the form's outcome-toast id, so it retires like its siblings.
    expect(warningSpy.mock.calls[0][1]).toMatchObject({ id: expect.stringMatching(/^form-outcome:/) });
  });

  it('a CHECKED two-state control held a value — hiding it is named', async () => {
    renderForm({
      fields: [
        { name: 'plan', label: 'Plan', type: 'input' },
        { name: 'priority_support', label: 'Priority Support', type: 'checkbox', visibleWhen: cel("record.plan == 'pro'") },
      ],
      defaultValues: { plan: 'pro', priority_support: true },
    });

    fireEvent.change(screen.getByLabelText(/plan/i), { target: { value: 'basic' } });

    await waitFor(() => expect(warningSpy).toHaveBeenCalledTimes(1));
    expect(notices()[0]).toContain('Priority Support');
  });

  it('two fields cleared by one transition are named in ONE notice, joined by the locale joiner (en)', async () => {
    renderForm(
      { fields: FIELDS, defaultValues: { attendee_type: 'contact', crm_contact: 'AEwPffbk', contact_role: 'Speaker' } },
      'en',
    );

    retype('lead');

    await waitFor(() => expect(warningSpy).toHaveBeenCalled());
    expect(warningSpy).toHaveBeenCalledTimes(1);
    expect(notices()[0]).toContain('Contact, Role');
    // The pack key is read, not a raw key and not a literal.
    expect(notices()[0]).not.toContain('form.clearedOnHide');
  });

  it('under zh the same two labels are joined by the CJK enumeration comma, from the zh pack', async () => {
    renderForm(
      { fields: FIELDS, defaultValues: { attendee_type: 'contact', crm_contact: 'AEwPffbk', contact_role: 'Speaker' } },
      'zh',
    );

    retype('lead');

    await waitFor(() => expect(warningSpy).toHaveBeenCalledTimes(1));
    expect(notices()[0]).toContain('Contact、Role');
    expect(notices()[0]).not.toContain('Contact, Role');
  });

  it('a chained clear — a field hidden BECAUSE another was cleared — is named with it, not in place of it', async () => {
    // `crm_contact`'s clear is what hides `contact_role`: the second clear is a
    // consequence of the first, inside the same user action. A notice naming
    // only the last column cleared would hide the first one from the user.
    renderForm({
      fields: [
        FIELDS[0],
        FIELDS[1],
        { name: 'contact_role', label: 'Role', type: 'input', visibleWhen: cel("record.crm_contact != null && record.crm_contact != ''") },
      ],
      defaultValues: { attendee_type: 'contact', crm_contact: 'AEwPffbk', contact_role: 'Speaker' },
    });

    retype('lead');

    await waitFor(() => expect(notices().at(-1)).toContain('Role'));
    expect(notices().at(-1)).toContain('Contact, Role');
  });

  it('a SEPARATE later transition names only its own field — the earlier clear is not carried', async () => {
    renderForm({
      fields: [
        ...FIELDS.slice(0, 2),
        { name: 'sys_user', label: 'User', type: 'input', visibleWhen: cel("record.attendee_type == 'user'") },
      ],
      defaultValues: { attendee_type: 'contact', crm_contact: 'AEwPffbk' },
    });

    retype('user');
    await waitFor(() => expect(warningSpy).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/^user$/i), { target: { value: 'brZgpOK4' } });
    retype('lead');

    await waitFor(() => expect(warningSpy).toHaveBeenCalledTimes(2));
    expect(notices()[1]).toContain('User');
    expect(notices()[1]).not.toContain('Contact');
  });

  it('a later submit refusal supersedes the notice, and the next accepted attempt retires it — one id throughout', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [{ name: 'subject', label: 'Subject', type: 'input', required: true }, ...FIELDS.slice(0, 2)],
      defaultValues: { attendee_type: 'contact', crm_contact: 'AEwPffbk' },
      onSubmit,
    });

    retype('lead');
    await waitFor(() => expect(warningSpy).toHaveBeenCalledTimes(1));
    const noticeId = (warningSpy.mock.calls[0][1] as { id: string }).id;

    // Refused on the client: the refusal is published under the SAME id, which
    // sonner treats as an update of the notice rather than a second toast.
    save();
    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
    expect(errorSpy.mock.calls[0][1]).toMatchObject({ id: noticeId });

    // Accepted on the client: the attempt starts by dismissing that id.
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Kickoff' } });
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(dismissSpy).toHaveBeenCalledWith(noticeId);
  });
});

describe('#8070 — nothing cleared, nothing named', () => {
  it('a field hidden while already EMPTY raises no notice', async () => {
    renderForm({ fields: FIELDS.slice(0, 2), defaultValues: { attendee_type: 'contact' } });

    retype('lead');

    await waitFor(() => expect(screen.queryByLabelText(/^contact$/i)).toBeNull());
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it('a field hidden while holding an EMPTY list raises no notice (rewriting [] as [] clears nothing)', async () => {
    renderForm({ fields: FIELDS.slice(0, 2), defaultValues: { attendee_type: 'contact', crm_contact: [] } });

    retype('lead');

    await waitFor(() => expect(screen.queryByLabelText(/^contact$/i)).toBeNull());
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it('an UNCHECKED two-state control is empty — hiding the create form\'s seeded `false` raises no notice', async () => {
    renderForm({
      fields: [
        { name: 'plan', label: 'Plan', type: 'input' },
        { name: 'priority_support', label: 'Priority Support', type: 'checkbox', visibleWhen: cel("record.plan == 'pro'") },
      ],
      defaultValues: { plan: 'pro' },
    });

    fireEvent.change(screen.getByLabelText(/plan/i), { target: { value: 'basic' } });

    await waitFor(() => expect(screen.queryByLabelText(/priority support/i)).toBeNull());
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it('the first render of a record with a hidden populated field is the baseline — no notice and no clear', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: FIELDS.slice(0, 2),
      defaultValues: { attendee_type: 'lead', crm_contact: 'AEwPffbk' },
      onSubmit,
    });

    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].crm_contact).toBe('AEwPffbk');
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it('a transition that hides nothing raises no notice', async () => {
    renderForm({
      fields: [...FIELDS.slice(0, 2), { name: 'note', label: 'Note', type: 'input' }],
      defaultValues: { attendee_type: 'contact', crm_contact: 'AEwPffbk' },
    });

    // An unrelated edit, and a controlling edit that keeps the field visible.
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'hello' } });
    await waitFor(() => expect((screen.getByLabelText(/note/i) as HTMLInputElement).value).toBe('hello'));
    expect(screen.getByLabelText(/^contact$/i)).toBeInTheDocument();
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it('a field already hidden that STAYS hidden is not a transition — no notice', async () => {
    renderForm({ fields: FIELDS.slice(0, 2), defaultValues: { attendee_type: 'lead', crm_contact: 'AEwPffbk' } });

    retype('user');

    await waitFor(() =>
      expect((screen.getByLabelText(/attendee type/i) as HTMLInputElement).value).toBe('user'),
    );
    expect(warningSpy).not.toHaveBeenCalled();
  });
});
