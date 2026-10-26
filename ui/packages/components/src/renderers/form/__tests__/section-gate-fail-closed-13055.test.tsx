/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13055 — a field group's `visibleWhen` is fail-CLOSED on the form.
 *
 * `@objectstack/spec` declares `ObjectFieldGroupSchema.visibleWhen` "else
 * hidden (fail-closed)", while an authored form-view section's own
 * `visibleWhen` faults OPEN and a field's own `visibleWhen` keeps the
 * ADR-0137 D3 fail-open. All three reach this renderer in a `visibleWhen`
 * slot, so the direction rides the row: `visibleWhenFault: 'hidden'`, which
 * only the field-group derivation stamps (`FormField.visibleWhenFault`,
 * `FormFieldTab.visibleWhenFault`).
 *
 * Rows below:
 *
 *  (a) a stamped divider (and a stamped tab) whose predicate faults — a parse
 *      error, an unknown field — hides the group, heading and members, and the
 *      one-time diagnostic names `false` and "hidden";
 *  (b) CONTROLS — a well-formed stamped predicate gates as before (shows on
 *      TRUE, hides on FALSE); an UNSTAMPED divider / tab (a form-view section)
 *      whose predicate faults still shows; a faulting FIELD-level
 *      `visibleWhen` still shows its field, even with the key on it (ignored
 *      off a divider);
 *  (Q2) members hidden by a fault behave exactly as members hidden by a FALSE
 *      predicate: values still submit, a required member does not block.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';

/** The spec's normalized wire shape (ADR-0089 D2). */
const cel = (source: string) => ({ dialect: 'cel', source });

function renderForm(schema: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(<Form schema={{ type: 'form', showSubmit: false, showCancel: false, ...schema }} />);
}

/**
 * A `kind` select-ish input, and a group claiming two members. Each test that
 * reads the diagnostic uses its OWN predicate text: the warning is deduped per
 * text for the life of the module.
 */
const grouped = (
  gate: unknown,
  fault: 'hidden' | 'shown' | undefined,
  seatsExtra: Record<string, unknown> = {},
) => [
  { name: 'kind', label: 'Kind', type: 'input' },
  {
    name: '__section_pro_details',
    label: 'Pro details',
    type: 'section-divider',
    visibleWhen: gate,
    ...(fault ? { visibleWhenFault: fault } : {}),
    fields: ['pro_seats', 'pro_notes'],
  },
  { name: 'pro_seats', label: 'Pro seats', type: 'input', ...seatsExtra },
  { name: 'pro_notes', label: 'Pro notes', type: 'input' },
];

const heading = () => screen.queryByText('Pro details');
const member = (re: RegExp) => screen.queryByLabelText(re);

/** The one-time predicate-failure warning(s) printed for one predicate text. */
function warningsFor(spy: ReturnType<typeof vi.spyOn>, source: string): string[] {
  return spy.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((m: string) => m.includes('failed to evaluate') && m.includes(JSON.stringify(source)));
}

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#13055 (a) — a faulting field-group predicate hides the whole group', () => {
  it('a parse fault hides heading and members, and the diagnostic names false / hidden', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = 'record.kind ==';
    renderForm({ fields: grouped(cel(source), 'hidden'), defaultValues: { kind: 'pro' } });
    expect(screen.getByLabelText(/^kind/i)).toBeInTheDocument();
    expect(heading()).toBeNull();
    expect(member(/pro seats/i)).toBeNull();
    expect(member(/pro notes/i)).toBeNull();
    const lines = warningsFor(warn, source);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('safe default (false)');
    expect(lines[0]).toContain('the group is hidden');
  });

  it('an unknown-field fault hides heading and members', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = "record.no_such_field == 'x'";
    renderForm({ fields: grouped(cel(source), 'hidden'), defaultValues: { kind: 'pro' } });
    expect(heading()).toBeNull();
    expect(member(/pro seats/i)).toBeNull();
    expect(member(/pro notes/i)).toBeNull();
    const lines = warningsFor(warn, source);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('safe default (false)');
  });

  it('a stamped TAB whose predicate faults is hidden — trigger, panel and members', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderForm({
      fields: [
        { name: 'subject', label: 'Subject', type: 'input' },
        { name: 'pro_seats', label: 'Pro seats', type: 'input' },
      ],
      fieldTabs: [
        { key: 'basics', label: 'Basics', fields: ['subject'] },
        {
          key: 'pro',
          label: 'Pro details',
          fields: ['pro_seats'],
          visibleWhen: cel('record.kind == (tab'),
          visibleWhenFault: 'hidden',
        },
      ],
    });
    expect(screen.getByRole('tab', { name: /basics/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /pro details/i })).toBeNull();
    expect(screen.queryByTestId('form-tab-panel:pro')).toBeNull();
    expect(member(/pro seats/i)).toBeNull();
  });
});

describe('objectui#13055 (b) — controls', () => {
  it('a well-formed stamped predicate SHOWS the group when TRUE', () => {
    renderForm({ fields: grouped(cel("record.kind == 'pro'"), 'hidden'), defaultValues: { kind: 'pro' } });
    expect(heading()).not.toBeNull();
    expect(member(/pro seats/i)).not.toBeNull();
  });

  it('a well-formed stamped predicate HIDES the group when FALSE', () => {
    renderForm({ fields: grouped(cel("record.kind == 'pro'"), 'hidden'), defaultValues: { kind: 'basic' } });
    expect(heading()).toBeNull();
    expect(member(/pro seats/i)).toBeNull();
  });

  it("an UNSTAMPED divider (a form-view section's own predicate) that faults still SHOWS", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = 'record.kind == (section';
    renderForm({ fields: grouped(cel(source), undefined), defaultValues: { kind: 'pro' } });
    expect(heading()).not.toBeNull();
    expect(member(/pro seats/i)).not.toBeNull();
    expect(warningsFor(warn, source)[0]).toContain('safe default (true)');
  });

  it("a divider stamped 'shown' that faults still SHOWS", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderForm({ fields: grouped(cel('record.kind == (shown'), 'shown'), defaultValues: { kind: 'pro' } });
    expect(heading()).not.toBeNull();
    expect(member(/pro seats/i)).not.toBeNull();
  });

  it('an UNSTAMPED tab that faults still SHOWS', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderForm({
      fields: [
        { name: 'subject', label: 'Subject', type: 'input' },
        { name: 'pro_seats', label: 'Pro seats', type: 'input' },
      ],
      fieldTabs: [
        { key: 'basics', label: 'Basics', fields: ['subject'] },
        { key: 'pro', label: 'Pro details', fields: ['pro_seats'], visibleWhen: cel('record.kind == (open') },
      ],
    });
    expect(screen.getByRole('tab', { name: /pro details/i })).toBeInTheDocument();
  });

  it('a faulting FIELD-level visibleWhen still SHOWS its field — the key is ignored off a divider', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderForm({
      fields: [
        { name: 'kind', label: 'Kind', type: 'input' },
        {
          name: 'pro_seats',
          label: 'Pro seats',
          type: 'input',
          visibleWhen: cel('record.kind == (field'),
          visibleWhenFault: 'hidden',
        },
      ],
    });
    expect(member(/pro seats/i)).not.toBeNull();
  });
});

describe('objectui#13055 (Q2) — fault-hidden members behave exactly like FALSE-hidden members', () => {
  const cases: Array<[string, unknown, Record<string, unknown>]> = [
    ['hidden by a FALSE predicate', cel("record.kind == 'pro'"), { kind: 'basic' }],
    ['hidden by a FAULT', cel('record.kind == (submit'), { kind: 'basic' }],
  ];

  for (const [why, gate, values] of cases) {
    it(`${why}: the member's value still submits`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onSubmit = vi.fn();
      renderForm({
        fields: grouped(gate, 'hidden'),
        defaultValues: { ...values, pro_seats: '12' },
        showSubmit: true,
        submitLabel: 'Save',
        onSubmit,
      });
      expect(member(/pro seats/i)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect((onSubmit.mock.calls[0][0] as Record<string, unknown>).pro_seats).toBe('12');
    });

    it(`${why}: a REQUIRED member does not block the submit`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onSubmit = vi.fn();
      renderForm({
        fields: grouped(gate, 'hidden', { required: true }),
        defaultValues: values,
        showSubmit: true,
        submitLabel: 'Save',
        onSubmit,
      });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(document.body.textContent).not.toMatch(/required/i);
    });
  }
});
