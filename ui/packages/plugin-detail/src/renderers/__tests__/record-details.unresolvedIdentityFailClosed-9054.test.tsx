/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9054 — `record:details`' field-security fold must fail CLOSED on an
 * entry whose identity it cannot resolve.
 *
 * ## The defect, in one sentence
 *
 * `filterList` filtered `fields` / `sections[].fields` against the allow-list
 * built from `enforceFieldSecurity` / `redactFields` with an else-branch that
 * KEPT any entry it could not name. Its identity reader is `columnIdentity`
 * alone, so every entry that is not a bare string, `{ field }`, `{ name }` or
 * `{ fieldName }` took that branch and escaped both controls — a field-security
 * control defaulting to *permit* on the one input it could not understand.
 *
 * ## ⭐ What this is NOT, measured rather than assumed
 *
 * The card left ONE question open and said so: the SHAPE was read at the
 * source, the EXPOSURE was not. On `record:related_list` (objectui#8793) the
 * kept column rendered its REAL VALUE, because `RelatedList` resolves a column
 * as `accessorKey || columnIdentity(c)` — a second read point that could name
 * what the fold could not. That second reader is what made #8793 a data leak.
 *
 * Driven here the way a record page drives it — a real `RecordContextProvider`,
 * a real record, the real `DetailView` / `DetailSection` — the answer is
 * **no value ever reaches the screen**. `DetailSection` renders from
 * `field.name` and nothing else; an entry the fold cannot name has no `name`
 * for it either, so `data?.[field.name]` is `data?.[undefined]`. The kept entry
 * painted a labelless `—` "No value" placeholder row. Every escape hatch that
 * could have supplied a second reader was probed and none did: five `render`
 * sub-schema spellings all rendered their own literal or nothing.
 *
 * ⇒ this card is a fail-open DEFAULT on a security boundary, not objectui#8793
 * in a second block. The case `THE EXPOSURE MEASUREMENT` below pins that, so
 * that if anyone ever teaches this path a second identity reader the grade
 * moves loudly instead of silently.
 *
 * ## The instrument, stated rather than smuggled
 *
 * `enforceFieldSecurity` / `redactFields` are the ONLY switch that makes the fold
 * run at all. When this file was written the block read them through
 * `(schema as any)` and the contract declared neither; `@objectstack/spec` 17.5.0
 * declares both on `record:details`, and objectui#8649 aligned the mirror and
 * removed the cast. Their authoring standing comes from that declaration — this
 * file uses them as the switch, and is not evidence either way.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { RecordDetailsRenderer } from '../record-details';

const employeeSchema = {
  name: 'employee',
  label: 'Employee',
  // Declared so the title dedupe has an unambiguous target that is NOT one of
  // the fields these cases read — `code` is never listed, so no assertion
  // below can be satisfied or defeated by the H1 dedupe ladder.
  nameField: 'code',
  fields: {
    code: { type: 'text', label: 'Code' },
    subject: { type: 'text', label: 'Subject' },
    status: { type: 'text', label: 'Status' },
    salary: { type: 'text', label: 'Salary' },
  },
};

const RECORD = { id: 'E1', code: 'EMP-1', subject: 'Fix the pump', status: 'open', salary: '90000' };

const roles: RoleDefinition[] = [{ name: 'restricted', label: 'Restricted' }];

/** `read` on `employee`, and `read` on every field EXCEPT the ones named. */
function permsDenying(...deniedFields: string[]): ObjectPermissionConfig[] {
  return [
    {
      object: 'employee',
      roles: {
        restricted: {
          actions: ['read'],
          fieldPermissions: deniedFields.map((field) => ({ field, read: false })),
        },
      },
    },
  ];
}

/** Mount the block over the REAL `DetailView` with the given schema. */
function renderBlock(schema: Record<string, unknown>, wrap?: (n: React.ReactNode) => React.ReactElement) {
  const node = (
    <RecordContextProvider objectName="employee" recordId="E1" data={RECORD} objectSchema={employeeSchema}>
      <RecordDetailsRenderer schema={schema as never} />
    </RecordContextProvider>
  );
  return render(wrap ? wrap(node) : node);
}

/**
 * The DOM handle for a rendered-but-unnameable row. `DetailSection` paints
 * `data?.[field.name] ?? field.value` and, finding neither, emits the shared
 * empty-value span — `aria-label="No value"`. Counting these is how "the entry
 * was KEPT" is read off the DOM, since a kept-but-unnameable entry has no
 * label and no value to match text on.
 *
 * Every fixture below gives its named fields a value on purpose, so a
 * placeholder in these renders can only have come from a kept entry.
 */
const ghostRows = () => screen.queryAllByLabelText('No value');

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain` for the ROW-level
  // verdict; happy-dom resolves that relative URL to a REAL socket, which the
  // repo's network-escape guard fails the file for (objectui#6640). Serve it
  // from a double — its answer is orthogonal to which entry the fold drops.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#9054 — an unresolvable field identity is EXCLUDED, not kept', () => {
  it('THE REDACT LEG — an entry the fold cannot name is dropped', () => {
    renderBlock({
      fields: [{ field: 'subject' }, { accessorKey: 'salary', header: 'Salary' }],
      redactFields: ['salary'],
    });

    // THE LIVE CONTROL, in the same render: an entry whose identity DOES
    // resolve and IS allowed still renders its value. Without it, "the
    // unnameable entry is gone" is equally satisfied by a fold that filtered
    // everything out, and a reviewer could not tell the repair from a rout.
    expect(screen.getByText('Fix the pump')).toBeInTheDocument();

    // The repair: the entry the fold could not check no longer survives it.
    expect(ghostRows()).toHaveLength(0);
  });

  it('THE FLS LEG — the same branch, driven through `enforceFieldSecurity`', () => {
    // Pinned separately from the redact leg because they are the same branch in
    // the block but arrive by different routes: one from the schema's own list,
    // one from the mounted permission provider.
    renderBlock(
      {
        fields: [{ field: 'subject' }, { accessorKey: 'salary', header: 'Salary' }],
        enforceFieldSecurity: true,
      },
      (n) => (
        <PermissionProvider roles={roles} permissions={permsDenying('salary')} userRoles={['restricted']}>
          {n}
        </PermissionProvider>
      ),
    );

    expect(screen.getByText('Fix the pump')).toBeInTheDocument(); // LIVE CONTROL
    expect(ghostRows()).toHaveLength(0);
  });

  it('THE SECTIONS LEG — the second consumer of the same fold behaves identically', () => {
    // `filterList` has exactly two consumers: the top-level `fields` list and
    // each `sections[].fields`. Both are pinned so a repair applied to one arm
    // only cannot pass.
    renderBlock({
      sections: [{ label: 'Compensation', fields: [{ field: 'subject' }, { accessorKey: 'salary' }] }],
      redactFields: ['salary'],
    });

    expect(screen.getByText('Fix the pump')).toBeInTheDocument(); // LIVE CONTROL
    expect(ghostRows()).toHaveLength(0);
  });

  it('NON-REGRESSION — every resolvable, allowed spelling still renders under an ACTIVE fold', () => {
    // The narrowing must cost nothing that the fold can name. All three
    // spellings `DetailSection` can also render are listed, with the fold
    // switched on and redacting something else entirely.
    renderBlock({
      fields: ['subject', { field: 'status' }, { name: 'salary' }],
      redactFields: ['code'],
    });

    expect(screen.getByText('Fix the pump')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('90000')).toBeInTheDocument();
    expect(ghostRows()).toHaveLength(0);
  });

  it('NON-REGRESSION — the legacy `{ fieldName }` spelling is resolvable and is NOT over-dropped', () => {
    // `columnIdentity` accepts `fieldName`, so the fold resolves it and the fix
    // must leave it in. It cannot be asserted by its VALUE: `normaliseField`
    // only promotes `field` to `name`, so `DetailSection` renders this entry as
    // a placeholder — a pre-existing gap between the two readers, untouched
    // here. Survival is therefore read through the gate that follows:
    // `schema.fields.length > 0` is what makes `DetailView` render a body at
    // all, so a fix that wrongly dropped this entry would empty the array and
    // this document would be blank.
    const { container } = renderBlock({
      fields: [{ fieldName: 'subject' }],
      redactFields: ['salary'],
    });

    expect(ghostRows()).toHaveLength(1);
    expect(container.textContent).not.toBe('');
  });

  it('COUNTER-PROBE — with neither key set the fold never runs and nothing moves', () => {
    // The bound on the blast radius, measured rather than argued. With no
    // `enforceFieldSecurity` and no `redactFields`, `filterList` returns the
    // list by reference before reaching the branch this card changed, so an
    // unnameable entry renders exactly as it did before — placeholder and all.
    renderBlock({
      fields: [{ field: 'subject' }, { accessorKey: 'salary', header: 'Salary' }],
    });

    expect(screen.getByText('Fix the pump')).toBeInTheDocument();
    expect(ghostRows()).toHaveLength(1);
  });

  it('THE EXPOSURE MEASUREMENT — no record VALUE ever reached the screen through this entry', () => {
    // ⭐ The card's own open question, pinned as the answer it turned out to
    // have. The fold is OFF here, so the entry is KEPT exactly as it was on the
    // unfixed tree — the worst case the defect could produce. `salary` is
    // `'90000'` on the record and the entry names it in the table library's own
    // key, yet nothing paints it: `DetailSection` reads `field.name` and this
    // path has no `accessorKey ||` second reader of the kind that made
    // objectui#8793 a data leak.
    //
    // This case is the severity, held checkable. Teaching this path a second
    // identity reader would red it, which is exactly when someone needs to know
    // that objectui#9054 just became objectui#8793.
    renderBlock({
      fields: [{ field: 'subject' }, { accessorKey: 'salary', header: 'Salary' }],
    });

    expect(screen.getByText('Fix the pump')).toBeInTheDocument(); // LIVE CONTROL
    expect(screen.queryByText('90000')).not.toBeInTheDocument();
  });

  describe('⭐ what happens when this filter removes EVERYTHING', () => {
    /**
     * Lane fact ㊸, written by this exact defect family: a hard stop catches
     * only what it names, and the inverse hazard is the one it misses. A
     * fail-CLOSED fold can empty the list, and on `record:related_list` an
     * emptied list is read as "nothing was authored" and falls through to
     * heuristic auto-derivation that the block's redaction never reaches
     * (objectui#9053) — which is why PR objectui#9058 is held in draft.
     *
     * On THIS surface it does not. Both consumers of `filteredFields` are plain
     * JSX conditionals in `DetailView` — `{schema.fields && schema.fields.length
     * > 0 && !schema.sections?.length && (…)}` — with no `else` and no
     * derivation. Pinned here rather than inherited from prose, on both routes
     * into emptiness.
     */
    it('ROUTE A (reachable before this change) — every entry resolvable and redacted', () => {
      const { container } = renderBlock({
        fields: [{ field: 'salary' }],
        redactFields: ['salary'],
      });

      expect(container.textContent).toBe('');
      expect(ghostRows()).toHaveLength(0);
    });

    it('ROUTE B (opened by this change) — the sole entry is one the fold cannot name', () => {
      const { container } = renderBlock({
        fields: [{ accessorKey: 'salary', header: 'Salary' }],
        redactFields: ['salary'],
      });

      expect(container.textContent).toBe('');
      expect(ghostRows()).toHaveLength(0);
    });

    it('LIT CONTROL for both routes — one survivor is enough to paint a body', () => {
      // Without this, `textContent === ''` above is equally satisfied by a
      // harness that renders nothing for any input.
      const { container } = renderBlock({
        fields: [{ field: 'subject' }, { accessorKey: 'salary' }],
        redactFields: ['salary'],
      });

      expect(container.textContent).not.toBe('');
      expect(screen.getByText('Fix the pump')).toBeInTheDocument();
    });

    it('SECTIONS — an emptied section is DROPPED, not replaced by a derived one', () => {
      renderBlock({
        sections: [
          { label: 'Compensation', fields: [{ field: 'salary' }] },
          { label: 'Main', fields: [{ field: 'subject' }] },
        ],
        redactFields: ['salary'],
      });

      expect(screen.queryByText('Compensation')).not.toBeInTheDocument();
      expect(screen.getByText('Main')).toBeInTheDocument(); // LIVE CONTROL
      expect(screen.getByText('Fix the pump')).toBeInTheDocument();
    });
  });
});
