/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form.sections[].description` on the DRAWER arm (objectui#9834).
 *
 * ⭐ WHY A SEPARATE FILE. The member pin for `object-form.sections`
 * (`objectFormSectionMembers-8071`) states its own scope in words: it is the
 * DEFAULT layout only — the one a section-carrying form gets when it declares
 * no `formType`. The drawer is a different site, and it lost this key ONE LAYER
 * LATER than the default arm did: `ObjectForm`'s drawer map copies
 * `description` onto `DrawerFormSectionConfig` (it has always been declared
 * there), and `DrawerForm`'s OWN `section-divider` push then rebuilt the row
 * key by key without it. So the author wrote it, the first layer passed it, and
 * the last layer did not take it — ⛔ not a shared code path with objectui#9779,
 * and ⛔ not a duplicate of it.
 *
 * ⭐ Before this card the drawer arm's behaviour here was pinned by NOTHING.
 * That is what this file is for: the key reaches the divider on BOTH routes a
 * host can take into `DrawerForm`, and it must go red if either stops.
 *
 * WHAT EACH ROW READS, and why it is read where it is read:
 *
 * Rows 1-2 are the two routes, ⛔ neither of them a hand-built stub of the
 * divider: route A mounts the real `ObjectForm` with `formType: 'drawer'` (so
 * the drawer MAP is under test as well as the push), route B mounts
 * `DrawerForm` directly with the same section (the shape a programmatic host
 * builds, where no map runs at all). Both read the blurb off the divider ROW —
 * the `<p>` inside the same `.border-b` block that carries the heading — ⛔ not
 * off `document.body.textContent`, which any stray render of the same string
 * would satisfy. Each carries the sibling member `label` on the SAME section in
 * the SAME call as the live control, so an empty blurb list can never be an
 * instrument that sees nothing.
 *
 * Row 3 is the SECOND push in the same file: the derived-fieldGroups fallback,
 * which the drawer takes when the host passes no explicit `sections` and the
 * object's own metadata declares `fieldGroups`. It is a separate rebuild and it
 * dropped the key separately; `deriveFieldGroupSections` has always carried a
 * group's `description` through to the section, so the loss was in the push
 * alone. Its heading is the live control in the same way.
 *
 * Row 4 is the absence control for rows 1-3: the same section with NO
 * `description` draws its heading and no blurb at all, so the instrument that
 * reports the blurbs is one that CAN report none.
 *
 * ⭐ Row 5 is RULED now (objectui#9849 step two — director ruling letter E,
 * maintainer 「同意」). It used to record a reading: this push drew a row for
 * every section, heading or not, so a headingless section rendered its blurb
 * alone here while the default arm drew nothing. The ruling replaced every
 * per-arm gate with one rule — 「The divider row exists iff
 * `title || description`; with `description` only it is the blurb-only row
 * … on every arm」 — and attached the group's semantics to the group
 * whether or not it yields a heading. ⇒ row 5 pins BOTH halves on this arm:
 * the blurb-only row renders the blurb with no heading, and it carries the
 * group's ADR-0089 predicate and objectui#6236 membership claim, so a
 * denying scope hides the blurb AND the member while an admitting one shows
 * both.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { PredicateScopeProvider } from '@object-ui/react';
import { ObjectForm } from '../ObjectForm';
import { DrawerForm } from '../DrawerForm';

registerAllFields();

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    amount: { type: 'text', label: 'Amount' },
  },
};

/** The same object, grouped by its OWN metadata — the derived-sections route. */
const GROUPED_OBJECT_SCHEMA = {
  name: 'invoice',
  fieldGroups: [{ key: 'money', label: 'Money', description: 'Totals as invoiced' }],
  fields: {
    customer: { type: 'text', label: 'Customer' },
    amount: { type: 'text', label: 'Amount', group: 'money' },
  },
};

const makeDataSource = (objectSchema: unknown = OBJECT_SCHEMA) =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as any;

/**
 * The drawer portals its body out of the render container (Radix `Sheet`), so
 * every read below is scoped to the `<form>` the drawer actually mounted in the
 * document — not to the RTL container, which holds none of it.
 */
async function drawerForm(node: React.ReactElement): Promise<HTMLElement> {
  render(node);
  let form: HTMLFormElement | null = null;
  await waitFor(() => {
    form = document.body.querySelector('form');
    if (!form) throw new Error('drawer form not ready');
  });
  return form as unknown as HTMLElement;
}

/** Route A — the real `ObjectForm`, routed to the drawer by `formType`. */
const viaObjectForm = (schema: Record<string, unknown>): Promise<HTMLElement> =>
  drawerForm(
    <ObjectForm
      schema={
        {
          type: 'object-form',
          objectName: 'invoice',
          mode: 'create',
          formType: 'drawer',
          open: true,
          ...schema,
        } as any
      }
      dataSource={makeDataSource()}
    />,
  );

/** Route B — `DrawerForm` mounted directly, the shape a programmatic host builds. */
const viaDrawerForm = (
  schema: Record<string, unknown>,
  objectSchema: unknown = OBJECT_SCHEMA,
): Promise<HTMLElement> =>
  drawerForm(
    <DrawerForm
      schema={
        {
          type: 'object-form',
          formType: 'drawer',
          objectName: 'invoice',
          mode: 'create',
          open: true,
          ...schema,
        } as any
      }
      dataSource={makeDataSource(objectSchema)}
    />,
  );

/** The section headings actually drawn, in DOM order. */
const headings = (f: HTMLElement): string[] =>
  [...f.querySelectorAll('.border-b span')].map((el) => el.textContent ?? '');

/** The section BLURBS actually drawn, read off the divider row itself. */
const blurbs = (f: HTMLElement): string[] =>
  [...f.querySelectorAll('.border-b p')].map((el) => el.textContent ?? '');

/** The field controls actually drawn, in DOM order. */
const drawnFields = (f: HTMLElement): string[] =>
  [...f.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field') as string);

describe('`object-form` drawer arm — a section’s `description` reaches the divider', () => {
  it('1. route A: through the real `ObjectForm` with `formType: "drawer"`', async () => {
    const f = await viaObjectForm({
      sections: [{ label: 'Money', description: 'Totals as invoiced', fields: ['amount'] }],
    });
    expect(
      headings(f),
      'the live control: the sibling member on the SAME section reaches the divider',
    ).toEqual(['Money']);
    expect(
      blurbs(f),
      'the drawer map copies `description` onto the section; `DrawerForm`’s own divider push ' +
        'has to hand it on, and `SectionDivider` renders it as the `<p>` beside the heading',
    ).toEqual(['Totals as invoiced']);
    expect(drawnFields(f), 'and the section still draws its member').toEqual(['amount']);
  });

  it('2. route B: `DrawerForm` mounted directly, no map in between', async () => {
    const f = await viaDrawerForm({
      sections: [{ label: 'Money', description: 'Totals as invoiced', fields: ['amount'] }],
    });
    expect(headings(f), 'the live control, same section, same call').toEqual(['Money']);
    expect(
      blurbs(f),
      'no map runs on this route, so the push is the ONLY layer that can drop the key',
    ).toEqual(['Totals as invoiced']);
    expect(drawnFields(f)).toEqual(['amount']);
  });

  it('3. the SECOND push: the derived-fieldGroups fallback carries it too', async () => {
    const f = await viaDrawerForm({}, GROUPED_OBJECT_SCHEMA);
    expect(
      headings(f),
      'the live control: the group’s own label reaches the derived divider',
    ).toEqual(['Money']);
    expect(
      blurbs(f),
      '`deriveFieldGroupSections` carries a declared group’s `description` onto the section, so ' +
        'the derived push is the only layer left that can drop it',
    ).toEqual(['Totals as invoiced']);
    expect(drawnFields(f)).toEqual(['amount', 'customer']);
  });

  it('4. absence control: the same section with NO `description` draws its heading and no blurb', async () => {
    const f = await viaDrawerForm({ sections: [{ label: 'Money', fields: ['amount'] }] });
    expect(headings(f)).toEqual(['Money']);
    expect(
      blurbs(f),
      'the instrument rows 1-3 use can report NONE, so their hits are readings',
    ).toEqual([]);
  });

  it('5. ruled (objectui#9849, letter E): a headingless section draws the blurb-only row, and that row gates its group', async () => {
    const GATE = { dialect: 'cel', source: "'sales_manager' in current_user.positions" };
    const scope = (positions: string[]) => {
      const user = { id: 'u1', name: 'Kim', positions };
      return { current_user: user, user, ctx: { user }, os: { user }, data: {}, features: {} };
    };
    const section = { description: 'Totals as invoiced', fields: ['amount'], visibleWhen: GATE };

    const allowed = await drawerForm(
      <PredicateScopeProvider scope={scope(['sales_manager']) as any}>
        <DrawerForm
          schema={{ type: 'object-form', formType: 'drawer', objectName: 'invoice', mode: 'create', open: true, sections: [section] } as any}
          dataSource={makeDataSource()}
        />
      </PredicateScopeProvider>,
    );
    expect(headings(allowed), 'no heading is authored, so none is drawn').toEqual([]);
    expect(blurbs(allowed), 'the blurb-only row: the one rule draws it for `description` alone').toEqual([
      'Totals as invoiced',
    ]);
    expect(drawnFields(allowed), 'the admitting scope shows the member').toEqual(['amount']);

    cleanup();
    const denied = await drawerForm(
      <PredicateScopeProvider scope={scope(['sales']) as any}>
        <DrawerForm
          schema={{ type: 'object-form', formType: 'drawer', objectName: 'invoice', mode: 'create', open: true, sections: [section] } as any}
          dataSource={makeDataSource()}
        />
      </PredicateScopeProvider>,
    );
    expect(blurbs(denied), 'the denying scope hides the row').toEqual([]);
    expect(
      drawnFields(denied),
      '⭐ …and the group it names: a headingless group is never un-gated (ruling E item 1)',
    ).toEqual([]);
  });
});
