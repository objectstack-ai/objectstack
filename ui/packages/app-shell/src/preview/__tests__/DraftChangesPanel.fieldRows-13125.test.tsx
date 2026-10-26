/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13125 — the drill-in's field rows lead with the field's label, and a
 * column the platform injected AND hides is not listed as an author change.
 *
 * Measured in a console walkthrough: Studio → a new object with a field
 * "Visit Date" → Publish read "+ __search, + created_at, + created_by, + name,
 * … + visit_date". Two defects in one list:
 *
 * - every field row printed the bare machine name, while the item row above it
 *   already leads with the item's label (objectui#11862);
 * - the `/meta` reads serve an object with the platform's columns already
 *   stamped on, and a NEW object has no published body, so the search
 *   companion `__search` read as a field the author added.
 *
 * The rule for "the platform injected it and hides it" is the Data pillar's
 * (`isStudioHiddenSystemField`, objectui#11780): `system: true` AND
 * `hidden: true` on the definition. The injected definitions below copy the
 * platform's literals as the objectui#11780 pin does: `provisionSearchCompanion`
 * for `__search`, `OWNING_BUSINESS_UNIT_FIELD_DEF`, and the `created_at` row of
 * `AUDIT_FIELD_DEFS`. The controls are that pin's too, because each is a way to
 * get the rule wrong while the headline assertion stays green:
 *
 * - `internal_note` — an author field with `hidden: true` and no `system`:
 *   listed.
 * - `owner_id` — `system: true` without `hidden`: listed.
 * - `created_at` — an audit column, `system` without `hidden`: listed. The
 *   rule does not hide it, and this card does not widen the rule.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
    language: 'en',
  }),
}));

import { DraftChangesPanel, computeChangeDetail } from '../DraftChangesPanel';

/** `provisionSearchCompanion`'s literal (description shortened; not read). */
const SEARCH_COMPANION_DEF = {
  type: 'text',
  label: 'Search Index',
  required: false,
  hidden: true,
  readonly: true,
  system: true,
  searchable: false,
  description: 'Search-normalized forms of the display/name field.',
};

/** `OWNING_BUSINESS_UNIT_FIELD_DEF`. */
const OWNING_BUSINESS_UNIT_DEF = {
  type: 'lookup',
  reference: 'sys_business_unit',
  label: 'Owning Business Unit',
  required: false,
  hidden: true,
  readonly: true,
  system: true,
  description: 'Record-level business-unit ownership (ADR-0117 D1).',
};

/** The `created_at` row of `AUDIT_FIELD_DEFS`. */
const CREATED_AT_DEF = {
  type: 'datetime',
  label: 'Created At',
  required: false,
  readonly: true,
  system: true,
  description: 'Timestamp when the record was created (auto-populated by the driver).',
};

/** A NEW object's draft as the `/meta` read serves it: the author's fields plus the stamped ones. */
const VISIT_DRAFT = {
  name: 'crm_visit',
  label: 'Visit',
  fields: {
    visit_date: { type: 'date', label: 'Visit Date' },
    // Control: no label — the name alone is the row's text.
    bare: { type: 'text' },
    // Control: a label that IS the name — printed once.
    code: { type: 'text', label: 'code' },
    // Control: author-hidden, not system — listed.
    internal_note: { type: 'text', label: 'Internal Note', hidden: true },
    // Control: system, not hidden — listed.
    owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner', required: false, readonly: false, system: true },
    // Control: audit column — listed; the rule does not hide it.
    created_at: CREATED_AT_DEF,
    owning_business_unit_id: OWNING_BUSINESS_UNIT_DEF,
    __search: SEARCH_COMPANION_DEF,
  },
};

const HIDDEN_SYSTEM = ['__search', 'owning_business_unit_id'] as const;
const VISIT_LISTED = ['bare', 'code', 'created_at', 'internal_note', 'owner_id', 'visit_date'];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('computeChangeDetail — a column the platform injected and hides is not a field row (objectui#13125)', () => {
  it("a NEW object's added fields leave out the injected-and-hidden columns, and keep every control", () => {
    const d = computeChangeDetail(null, VISIT_DRAFT);
    expect(d.fields?.added).toEqual(VISIT_LISTED);
  });

  it('an UPDATE lists no changed or removed row for one either, and lists the author rows beside it', () => {
    const published = {
      name: 'crm_ticket',
      fields: {
        subject: { type: 'text', label: 'Title' },
        legacy_code: { type: 'text', label: 'Legacy Code' },
        // The companion's definition differs between the bodies: still not an author change.
        __search: { ...SEARCH_COMPANION_DEF, description: 'an older wording' },
        owning_business_unit_id: OWNING_BUSINESS_UNIT_DEF,
      },
    };
    const draft = {
      name: 'crm_ticket',
      fields: {
        subject: { type: 'text', label: 'Subject' },
        __search: SEARCH_COMPANION_DEF,
      },
    };
    const d = computeChangeDetail(published, draft);
    expect(d.fields?.added).toEqual([]);
    expect(d.fields?.changed).toEqual([{ name: 'subject', keys: ['label'] }]);
    expect(d.fields?.removed).toEqual(['legacy_code']);
  });

  it('an UPDATE whose bodies differ only in such a column lists nothing', () => {
    const published = { name: 'crm_ticket', fields: { subject: { type: 'text' } } };
    const draft = { name: 'crm_ticket', fields: { subject: { type: 'text' }, __search: SEARCH_COMPANION_DEF } };
    const d = computeChangeDetail(published, draft);
    expect(d.fields).toMatchObject({ added: [], changed: [], removed: [] });
    expect(d.keys).toEqual({ added: [], changed: [], removed: [] });
  });

  it('a field whose marks one body lacks is listed: every definition of it must carry both', () => {
    const published = { fields: { flag: { type: 'boolean', label: 'Flag', system: true } } };
    const draft = { fields: { flag: { type: 'boolean', label: 'Flag', system: true, hidden: true } } };
    expect(computeChangeDetail(published, draft).fields?.changed).toEqual([{ name: 'flag', keys: ['hidden'] }]);
  });
});

describe("computeChangeDetail — each field row's label (objectui#13125)", () => {
  it("reads the draft's label for an added or changed field and the published one's for a removed field", () => {
    const published = {
      fields: { subject: { type: 'text', label: 'Title' }, legacy_code: { type: 'text', label: 'Legacy Code' } },
    };
    const draft = {
      fields: { subject: { type: 'text', label: 'Subject' }, visit_date: { type: 'date', label: 'Visit Date' } },
    };
    const labels = computeChangeDetail(published, draft).fields?.labels;
    expect(labels?.get('visit_date')).toBe('Visit Date');
    expect(labels?.get('subject')).toBe('Subject');
    expect(labels?.get('legacy_code')).toBe('Legacy Code');
  });

  it('has no label for a field that declares none, a blank one, or one that is not a string', () => {
    const draft = {
      fields: {
        bare: { type: 'text' },
        blank: { type: 'text', label: '   ' },
        mapped: { type: 'text', label: { en: 'Mapped' } },
      },
    };
    const d = computeChangeDetail(null, draft);
    expect(d.fields?.added).toEqual(['bare', 'blank', 'mapped']);
    expect([...(d.fields?.labels.keys() ?? [])]).toEqual([]);
  });
});

/* ─────────────── the panel ─────────────── */

const TICKET_PUBLISHED = {
  name: 'crm_ticket',
  label: 'Ticket',
  fields: {
    subject: { type: 'text', label: 'Title' },
    legacy_code: { type: 'text', label: 'Legacy Code' },
    __search: SEARCH_COMPANION_DEF,
  },
};
const TICKET_DRAFT = {
  name: 'crm_ticket',
  label: 'Ticket',
  fields: { subject: { type: 'text', label: 'Subject' }, __search: SEARCH_COMPANION_DEF },
};

function stubServer() {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/_drafts')) {
      return ok({
        drafts: [
          { type: 'object', name: 'crm_visit', packageId: 'com.x', label: 'Visit' },
          { type: 'object', name: 'crm_ticket', packageId: 'com.x', label: 'Ticket' },
        ],
      });
    }
    if (/\/meta\/object(\?|$)/.test(url)) return ok([{ name: 'crm_ticket' }]);
    const draft = url.includes('state=draft');
    if (/\/meta\/object\/crm_visit\b/.test(url) && draft) return ok({ item: VISIT_DRAFT });
    if (/\/meta\/object\/crm_ticket\b/.test(url)) return ok(draft ? { item: TICKET_DRAFT } : TICKET_PUBLISHED);
    return { ok: false, status: 404, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
}

/** Open the sheet and expand the row whose label is `label`; resolves to its drill-in. */
async function expandRow(label: string): Promise<HTMLElement> {
  stubServer();
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" />);
  const toggle = (await screen.findByText(label)).closest('[data-testid="draft-entry-toggle"]') as HTMLElement;
  fireEvent.click(toggle);
  return screen.findByTestId('draft-entry-detail');
}

/** The field row whose own text is `text`. */
function fieldRow(detail: HTMLElement, text: string): HTMLElement {
  const row = within(detail).getByText(text);
  expect(row).toHaveAttribute('data-testid', 'draft-field-row');
  return row;
}

describe('the drill-in of a NEW object (objectui#13125)', () => {
  it('leads an added field row with its label, the machine name beside it in monospace', async () => {
    const detail = await expandRow('Visit');
    const row = fieldRow(detail, '+ Visit Date');
    expect(within(row).getByText('visit_date')).toHaveClass('font-mono');
    expect(row).not.toHaveClass('font-mono');
  });

  it('lists no injected-and-hidden column, by name or by label, and lists every control', async () => {
    const detail = await expandRow('Visit');
    await waitFor(() => expect(within(detail).getAllByTestId('draft-field-row')).toHaveLength(VISIT_LISTED.length));
    const text = detail.textContent ?? '';
    for (const name of HIDDEN_SYSTEM) expect(text).not.toContain(name);
    expect(text).not.toContain(SEARCH_COMPANION_DEF.label);
    expect(text).not.toContain(OWNING_BUSINESS_UNIT_DEF.label);
    for (const label of ['Internal Note', 'Owner', 'Created At']) fieldRow(detail, `+ ${label}`);
  });

  it('CONTROL: a field with no label reads as its name alone, once, in monospace', async () => {
    const detail = await expandRow('Visit');
    const row = fieldRow(detail, '+ bare');
    expect(row).toHaveClass('font-mono');
    expect(within(detail).getAllByText(/\bbare\b/)).toHaveLength(1);
  });

  it('CONTROL: a field whose label is its name reads it once', async () => {
    const detail = await expandRow('Visit');
    expect(fieldRow(detail, '+ code')).toHaveClass('font-mono');
    expect(within(detail).getAllByText(/\bcode\b/)).toHaveLength(1);
  });
});

describe('the drill-in of an UPDATE (objectui#13125)', () => {
  it('leads a changed and a removed field row with the label too, and lists no hidden column', async () => {
    const detail = await expandRow('Ticket');
    const changed = fieldRow(detail, '~ Subject');
    expect(within(changed).getByText('subject')).toHaveClass('font-mono');
    expect(changed).toHaveTextContent('· label');
    const removed = fieldRow(detail, '− Legacy Code');
    expect(within(removed).getByText('legacy_code')).toHaveClass('font-mono');
    expect(detail.textContent ?? '').not.toContain('__search');
  });
});
