/**
 * objectui#10117 — `page:header` crashed with React #31 ("Objects are not
 * valid as a React child") when the record's declared name field was empty.
 *
 * ## The defect, in one sentence
 *
 * `PageHeaderRenderer`'s record-chrome branch asks the unified ADR-0079
 * resolver (`getRecordDisplayName`) with `deriveFromRecordKeys: false`, and
 * then RE-SPELLS that resolver's skipped record-key rung itself as a raw
 * `data?.name || data?.full_name || data?.title || data?.subject || …` chain.
 * Raw `||` reads the field's stored value, so for a `lookup` the truthy value
 * is the EXPANDED REFERENCE OBJECT — which went straight into JSX.
 *
 * ⭐ The control that proves the resolution already exists in this tree: the
 * breadcrumb resolves the SAME record through `getRecordDisplayName` WITHOUT
 * `deriveFromRecordKeys: false`, so its record-key rung runs through
 * `recordDisplayValueAt` -> `displayNameOfEmbeddedObject` and shows the
 * lookup's display name. The header did not crash for want of a resolver; it
 * crashed for having a second, raw copy of the walk.
 *
 * `recordDisplayValueAt`'s own header (objectui#8350) already ruled this
 * class: "Do not re-spell this test at a call site". This header was the
 * remaining re-spelling.
 *
 * ## What each pin holds — and what ABLATION showed about that
 *
 * Measured, not assumed: restoring the raw walk while KEEPING the defensive
 * stringify left pins 1 and 2 GREEN. The backstop resolves an expanded
 * reference through the very same `displayNameOfEmbeddedObject`, so for a
 * lookup it produces a byte-identical heading. ⇒ "did not crash" and "the
 * display name is on screen" are held by clause 1 OR clause 3, and neither
 * pin can tell the two apart. Pins 3 and 5 are the ones that separate them,
 * and they exist because that ablation came back green.
 *
 *  1. THE CRASH — empty `name` + a lookup candidate must not throw.
 *  2. THE DISPLAY NAME — the resolved name must be ON SCREEN. A pin that only
 *     checked for absence of a throw would pass on a header rendering
 *     `[object Object]`, so absence-of-throw is deliberately not the assertion.
 *  3. CLAUSE 2, isolated — the borrowable value is a non-empty STRING, so no
 *     defensive stringify can save it; only refusing the hop keeps it off the
 *     H1. 3b covers the whitespace-only half of the same rule.
 *  5. CLAUSE 1, isolated — the value lives behind the resolver's own `*_name`
 *     affix rung, which the deleted raw chain never looked at and which no
 *     amount of stringifying can reach.
 *  4. THE CONTROL — a non-empty `name` still renders its own name, unchanged.
 *
 * ## The clause-3 backstop is NOT pinned here, and that is a measurement
 *
 * Deleting the defensive stringify in `PageHeaderRenderer` leaves every pin
 * below GREEN. That is reported rather than fixed with a contrived pin: with
 * clauses 1 and 2 in place no rung of the title chain can produce a
 * non-string, because `pickLocalized` — which every author-supplied `title`
 * passes through — is typed to a string and collapses an object with no
 * string value to `''`. The backstop guards a future rung, not a reachable
 * one, so there is no honest fixture for it through the registered
 * component's public surface.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';

/**
 * The card's repro object: `kpi_entry_sheet` declares `nameField: 'name'`
 * over a readonly text field, and carries a required `subject` lookup to
 * `sys_business_unit`. An admin-created record never gets its hook-computed
 * `name`, so the declared field is empty while `subject` is expanded.
 */
const KPI_ENTRY_SHEET = {
  name: 'kpi_entry_sheet',
  label: 'KPI Entry Sheet',
  nameField: 'name',
  fields: {
    name: { type: 'text', label: 'Name', readonly: true },
    subject: { type: 'lookup', label: 'Subject', reference: 'sys_business_unit', required: true },
    subject_type: { type: 'text', label: 'Subject Type' },
  },
};

const BUSINESS_UNIT_DISPLAY_NAME = '华东分公司';

/** The expanded lookup payload from the card's `args[]`, keys and all. */
const EXPANDED_BUSINESS_UNIT = {
  id: 'bu_east',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  created_by: 'u_1',
  updated_by: 'u_1',
  name: BUSINESS_UNIT_DISPLAY_NAME,
  code: 'BU-EAST',
  kind: 'department',
  parent_business_unit_id: null,
  organization_id: 'org_1',
  manager_user_id: 'u_9',
  active: true,
  effective_from: '2026-01-01',
  effective_to: null,
  external_ref: null,
};

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

function renderHeader(opts: { record: any; objectSchema: any; schema?: any }) {
  return render(
    <ActionProvider>
      <RecordContextProvider
        objectName={opts.objectSchema?.name ?? 'kpi_entry_sheet'}
        recordId={opts.record?.id ?? null}
        data={opts.record}
        objectSchema={opts.objectSchema}
      >
        <PageHeader schema={opts.schema ?? { type: 'page:header' }} />
      </RecordContextProvider>
    </ActionProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('page:header — an empty declared name field must not reach for a lookup (objectui#10117)', () => {
  it('1. does not crash when the declared name field is empty and a lookup candidate is expanded', () => {
    // Held by clause 1 OR clause 3 — either alone stops the throw, which is
    // exactly why the card called clause 3 a backstop. The pins that separate
    // them are 3 and 5.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      renderHeader({
        objectSchema: KPI_ENTRY_SHEET,
        record: {
          id: 'kes_0001',
          name: null,
          plan: 'FY26-Q3',
          subject: EXPANDED_BUSINESS_UNIT,
          subject_type: 'department',
        },
      }),
    ).not.toThrow();
  });

  it('2. renders the lookup DISPLAY NAME, not the object and not `[object Object]`', () => {
    renderHeader({
      objectSchema: {
        ...KPI_ENTRY_SHEET,
        // No declared name field, and the only field is a lookup — which
        // `deriveTitleField` refuses — so the record-key rung is the live
        // path here, the same rung the breadcrumb resolves correctly.
        nameField: undefined,
        fields: { subject: KPI_ENTRY_SHEET.fields.subject },
      },
      record: { id: 'kes_0002', subject: EXPANDED_BUSINESS_UNIT },
    });

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain(BUSINESS_UNIT_DISPLAY_NAME);
    // The two shapes the defect produced, both asserted absent by name.
    expect(heading.textContent).not.toContain('[object Object]');
    expect(heading.textContent).not.toContain('parent_business_unit_id');
  });

  it('3. CLAUSE 2 — an empty declared name field degrades to the placeholder, it does NOT borrow another field', () => {
    // THE pin that isolates the fallback-chain rule from the rendering rule.
    // The borrowable value is a non-empty STRING, so no amount of defensive
    // stringifying can save it: only refusing the hop keeps it off the H1.
    renderHeader({
      objectSchema: KPI_ENTRY_SHEET,
      record: {
        id: 'kes_0003',
        name: null,
        title: 'Borrowed From Another Field',
        subject: EXPANDED_BUSINESS_UNIT,
        subject_type: 'department',
      },
    });

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).not.toContain('Borrowed From Another Field');
    expect(heading.textContent).not.toContain(BUSINESS_UNIT_DISPLAY_NAME);
    // The header's own last resort: `${objectLabel} ${id-prefix}`.
    expect(heading.textContent).toContain('kes_0003');
  });

  it('3b. a whitespace-only declared name value is empty, not a title', () => {
    renderHeader({
      objectSchema: KPI_ENTRY_SHEET,
      record: { id: 'kes_0031', name: '   ', subject: EXPANDED_BUSINESS_UNIT },
    });

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent?.trim()).not.toBe('');
    expect(heading.textContent).toContain('kes_0031');
  });

  it('4. CONTROL — a record with a non-empty name still renders its own name', () => {
    renderHeader({
      objectSchema: KPI_ENTRY_SHEET,
      record: {
        id: 'kes_0004',
        name: 'FY26-Q3 East',
        subject: EXPANDED_BUSINESS_UNIT,
        subject_type: 'department',
      },
    });

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('FY26-Q3 East');
    expect(heading.textContent).not.toContain(BUSINESS_UNIT_DISPLAY_NAME);
  });

  it('5. CLAUSE 1 — the safety net is the RESOLVER, not a hand-rolled walk: its affix rung resolves', () => {
    // THE pin that isolates "reuse the existing resolution" from "stringify
    // defensively". `business_unit_name` is reached only by the resolver's
    // own `*_name` affix scan; no defensive stringify can reach it, and the
    // deleted raw chain never looked at it. An object naming no title field
    // is the case that rung exists for.
    renderHeader({
      objectSchema: {
        name: 'kpi_entry_sheet',
        label: 'KPI Entry Sheet',
        // No `fields`, so nothing is declared and nothing derives — exactly
        // the loosely-typed metadata the record-key rung is the net for.
      },
      record: { id: 'kes_0005', business_unit_name: 'East China Branch' },
    });

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('East China Branch');
  });
});
