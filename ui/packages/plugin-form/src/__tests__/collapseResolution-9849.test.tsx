/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ONE `collapsed` / `collapsible` resolution on every route that draws a
 * collapse pair (objectui#9849 step one — director ruling letter E, item 4:
 * 「the three `collapsed` / `collapsible` resolutions converge to the
 * declaration-based one objectui#9780 established」).
 *
 * THE RESOLUTION, as objectui#9780 ruled it (letter A) and as
 * `resolveSectionCollapse` in `fieldGroups.ts` now spells it for every arm:
 *
 *   - `collapsed: true` IMPLIES `collapsible` — the control is installed,
 *     read off the DECLARATION and never off the live state (so opening the
 *     section does not delete the control that closes it again);
 *   - `collapsible: true` alone is open, with the control;
 *   - `collapsible: false` WITH `collapsed: true` is the same contradiction and
 *     resolves the same way — collapsed wins, the control is present;
 *   - a section declaring neither member is untouched — open, no control;
 *   - ⭐ and fields are never taken out of the DOM unless the row that carries
 *     the control is actually on the page.
 *
 * WHAT THIS FILE HOLDS THAT THE OTHERS DO NOT. `collapsedImpliesCollapsible-9780`
 * pins the default arm's explicit route only. Before this card the drawer
 * resolved the same two keys two other ways: its explicit push read
 * `collapsible` alone for the control while reading `collapsed`
 * unconditionally for the state — the objectui#9780 trap, a section that
 * starts closed with nothing on the page able to reopen it — and its derived
 * push gated the state on `collapsible`. This file mounts EVERY route that
 * emits a collapse pair through a real renderer and asks each the same
 * questions, so a route that drifts from the one resolution goes red by name.
 *
 * ⭐ THE ABLATION THIS FILE IS SHAPED FOR. Putting the drawer's explicit push
 * back on its old resolution reddens the drawer's explicit rows (direct and
 * through `ObjectForm`'s drawer map) and the drawer trap rows, while every
 * `ObjectForm` row stays green. The run is recorded on the pull request.
 *
 * ⭐ THE MODAL ARM, FLIPPED ON PURPOSE (objectui#9849 step two — director
 * ruling letter E, item 1: group semantics attach 「on every arm」). Step one
 * pinned the modal as a reading: it honoured NEITHER member on either route.
 * `ModalFormSectionConfig` now declares both, `ObjectForm`'s modal map copies
 * them, and the modal's derived route stops dropping the pair
 * `deriveFieldGroupSections` hands it — so the modal routes run the same rows
 * as every other route below.
 *
 * ⭐ THE HEADINGLESS ROWS (letter E, items 2-3). The control lives on the
 * divider row, and the row exists iff `title || description`. A member with a
 * blurb therefore hosts the control on its blurb-only row on every route; a
 * member with neither has nowhere to put it, renders OPEN, and is reported
 * through `headinglessCollapseWarning` — ⛔ never fields out of the DOM with
 * no control.
 *
 * HOW EACH ZERO IS LIT. Every row that asserts fields ABSENT also asserts the
 * section's heading drawn in the same call (the section itself was rendered),
 * and then reads the SAME `drawnFields` instrument non-empty after a click.
 * Every row that asserts NO control is paired, on the same route, with a row
 * where the same `toggles` reader finds one — so a zero is a reading, not an
 * instrument that sees nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';
import { ModalForm } from '../ModalForm';
import { resetHeadinglessCollapseWarnings } from '../fieldGroups';
import { DrawerForm } from '../DrawerForm';

registerAllFields();

// Each row observes its own first report of the headingless-collapse diagnostic.
beforeEach(() => resetHeadinglessCollapseWarnings());

const BLURB = 'Totals as invoiced';

/** Two plain fields; the explicit-sections routes curate one of them by name. */
const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    customer: { type: 'text', label: 'Customer' },
    amount: { type: 'text', label: 'Amount' },
  },
};

/**
 * The same object grouped by its OWN metadata — the derived-sections route.
 * `customer` stays ungrouped so the trailing untitled bucket is present too:
 * it declares no collapse, so it must never be hidden or given a control.
 */
const groupedSchema = (group: Record<string, unknown>) => ({
  name: 'invoice',
  fieldGroups: [{ key: 'money', label: 'Money', ...group }],
  fields: {
    customer: { type: 'text', label: 'Customer' },
    amount: { type: 'text', label: 'Amount', group: 'money' },
  },
});

const makeDataSource = (objectSchema: unknown = OBJECT_SCHEMA) =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as any;

/**
 * The `<form>` the route actually mounted. Modal and drawer portal their bodies
 * out of the RTL container (Radix), so every read is scoped to the document's
 * form rather than to the container, which holds none of it.
 */
async function mounted(node: React.ReactElement): Promise<HTMLElement> {
  render(node);
  let form: HTMLFormElement | null = null;
  await waitFor(() => {
    form = document.body.querySelector('form');
    if (!form) throw new Error('form not ready');
  });
  return form as unknown as HTMLElement;
}

/** The section headings actually drawn, in DOM order. */
const headings = (f: HTMLElement): string[] =>
  [...f.querySelectorAll('.border-b span')].map((el) => el.textContent ?? '');

/** The section blurbs actually drawn, read off the divider row itself. */
const blurbs = (f: HTMLElement): string[] =>
  [...f.querySelectorAll('.border-b p')].map((el) => el.textContent ?? '');

/** The field controls actually drawn, in DOM order. */
const drawnFields = (f: HTMLElement): string[] =>
  [...f.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field') as string);

/**
 * The disclosure controls on the page. `SectionDivider` renders `role="button"`
 * and `aria-expanded` only when it was handed `collapsible`, so this reader
 * finds a control exactly when one exists.
 */
const toggles = (f: HTMLElement): HTMLElement[] => [
  ...f.querySelectorAll<HTMLElement>('[role="button"][aria-expanded]'),
];

const base = { type: 'object-form', objectName: 'invoice', mode: 'create' } as const;

type Route = {
  label: string;
  /** Mount the route with one authored member (explicit) or one declared group (derived). */
  mount: (member: Record<string, unknown>) => Promise<HTMLElement>;
  /** The fields the route draws when the `money` section is OPEN. */
  open: string[];
  /** The fields the route draws when the `money` section is CLOSED. */
  closed: string[];
};

/** Every route that emits a collapse pair from an authored `sections` member. */
const EXPLICIT: Route[] = [
  {
    label: 'ObjectForm — default layout, explicit `sections`',
    mount: (section) =>
      mounted(
        <ObjectForm
          schema={{ ...base, sections: [{ label: 'Money', fields: ['amount'], ...section }] } as any}
          dataSource={makeDataSource()}
        />,
      ),
    open: ['amount'],
    closed: [],
  },
  {
    // The route the objectui#9780 dev measured the drawer trap on: the drawer
    // map in `ObjectForm` copies both members straight through.
    label: 'ObjectForm — `formType: "drawer"`, explicit `sections` through the drawer map',
    mount: (section) =>
      mounted(
        <ObjectForm
          schema={
            {
              ...base,
              formType: 'drawer',
              open: true,
              sections: [{ label: 'Money', fields: ['amount'], ...section }],
            } as any
          }
          dataSource={makeDataSource()}
        />,
      ),
    open: ['amount'],
    closed: [],
  },
  {
    label: 'DrawerForm — explicit `sections`, mounted directly',
    mount: (section) =>
      mounted(
        <DrawerForm
          schema={
            {
              ...base,
              formType: 'drawer',
              open: true,
              sections: [{ label: 'Money', fields: ['amount'], ...section }],
            } as any
          }
          dataSource={makeDataSource()}
        />,
      ),
    open: ['amount'],
    closed: [],
  },
  {
    label: 'ModalForm — explicit `sections`, mounted directly',
    mount: (section) =>
      mounted(
        <ModalForm
          schema={
            { ...base, formType: 'modal', open: true, sections: [{ label: 'Money', fields: ['amount'], ...section }] } as any
          }
          dataSource={makeDataSource()}
        />,
      ),
    open: ['amount'],
    closed: [],
  },
  {
    label: 'ObjectForm — `formType: "modal"`, explicit `sections` through the modal map',
    mount: (section) =>
      mounted(
        <ObjectForm
          schema={
            { ...base, formType: 'modal', open: true, sections: [{ label: 'Money', fields: ['amount'], ...section }] } as any
          }
          dataSource={makeDataSource()}
        />,
      ),
    open: ['amount'],
    closed: [],
  },
];

/** Every route that emits a collapse pair from the object's own `fieldGroups`. */
const DERIVED: Route[] = [
  {
    label: 'ObjectForm — default layout, DERIVED `fieldGroups`',
    mount: (group) =>
      mounted(<ObjectForm schema={{ ...base } as any} dataSource={makeDataSource(groupedSchema(group))} />),
    open: ['amount', 'customer'],
    closed: ['customer'],
  },
  {
    label: 'DrawerForm — DERIVED `fieldGroups`',
    mount: (group) =>
      mounted(
        <DrawerForm
          schema={{ ...base, formType: 'drawer', open: true } as any}
          dataSource={makeDataSource(groupedSchema(group))}
        />,
      ),
    open: ['amount', 'customer'],
    closed: ['customer'],
  },
  {
    label: 'ModalForm — DERIVED `fieldGroups`',
    mount: (group) =>
      mounted(
        <ModalForm
          schema={{ ...base, formType: 'modal', open: true } as any}
          dataSource={makeDataSource(groupedSchema(group))}
        />,
      ),
    open: ['amount', 'customer'],
    closed: ['customer'],
  },
];

/**
 * Starts closed; ONE control is on the page; clicking it hands the fields back;
 * the control survives the opening (it is read off the declaration) and closes
 * the section again.
 */
async function expectClosedWithControl(route: Route, f: HTMLElement, why: string) {
  expect(headings(f), 'the live control: the section itself is rendered').toContain('Money');
  expect(drawnFields(f), `${why} — the section starts closed`).toEqual(route.closed);
  expect(
    toggles(f),
    `⭐ ${why} — a control is on the page. Before the convergence this was EMPTY on the drawer's ` +
      'explicit push: a permanently closed section with nothing able to reopen it (objectui#9780)',
  ).toHaveLength(1);
  expect(toggles(f)[0].getAttribute('aria-expanded')).toBe('false');

  fireEvent.click(toggles(f)[0]);
  await waitFor(() => {
    expect(drawnFields(f), 'the same reader that reported the closed set now reports the fields').toEqual(
      route.open,
    );
  });
  expect(
    toggles(f),
    '⚠️ read off the DECLARATION, not the live state: opening must not delete the control',
  ).toHaveLength(1);
  expect(toggles(f)[0].getAttribute('aria-expanded')).toBe('true');

  fireEvent.click(toggles(f)[0]);
  await waitFor(() => {
    expect(drawnFields(f), 'so it closes again').toEqual(route.closed);
  });
}

async function expectOpenWithControl(route: Route, f: HTMLElement) {
  expect(headings(f)).toContain('Money');
  expect(drawnFields(f), 'no `collapsed` is declared, so the section starts open').toEqual(route.open);
  expect(toggles(f), 'and it carries the control').toHaveLength(1);
  expect(toggles(f)[0].getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(toggles(f)[0]);
  await waitFor(() => {
    expect(drawnFields(f), 'which closes it').toEqual(route.closed);
  });
}

function expectPlain(route: Route, f: HTMLElement) {
  expect(headings(f)).toContain('Money');
  expect(drawnFields(f), 'an ordinary section, open as it always was').toEqual(route.open);
  expect(
    toggles(f),
    'the absence control: the reader the other rows use CAN report none, so the implication ' +
      'did not turn every section into a collapsible one',
  ).toEqual([]);
}

describe('one `collapsed` / `collapsible` resolution — explicit `sections` routes (objectui#9849, objectui#9780)', () => {
  for (const route of EXPLICIT) {
    describe(route.label, () => {
      it('`collapsed: true` ALONE — starts closed, and a control on the page opens and closes it', async () => {
        const f = await route.mount({ collapsed: true });
        await expectClosedWithControl(route, f, '`collapsed` implies `collapsible`');
      });

      it('`collapsible: true` ALONE — open, with the control', async () => {
        const f = await route.mount({ collapsible: true });
        await expectOpenWithControl(route, f);
      });

      it('`collapsible: false` WITH `collapsed: true` — collapsed wins, the control is present', async () => {
        const f = await route.mount({ collapsible: false, collapsed: true });
        await expectClosedWithControl(route, f, 'the contradiction resolves in favour of `collapsed`');
      });

      it('absence control — a section declaring NEITHER member draws no control', async () => {
        const f = await route.mount({});
        expectPlain(route, f);
      });
    });
  }
});

describe('one `collapsed` / `collapsible` resolution — DERIVED `fieldGroups` routes', () => {
  for (const route of DERIVED) {
    describe(route.label, () => {
      it("`collapse: 'collapsed'` — starts closed, and a control on the page opens and closes it", async () => {
        const f = await route.mount({ collapse: 'collapsed' });
        await expectClosedWithControl(route, f, "the group's declared collapse state");
      });

      it('the deprecated `collapsed: true` ALONE on a group — the objectui#9780 shape — resolves the same way', async () => {
        const f = await route.mount({ collapsed: true });
        await expectClosedWithControl(route, f, '`collapsed` implies `collapsible` on the derived route too');
      });

      it("`collapse: 'expanded'` — open, with the control", async () => {
        const f = await route.mount({ collapse: 'expanded' });
        await expectOpenWithControl(route, f);
      });

      it("absence control — `collapse: 'none'` draws no control, and the untitled bucket is never collapsible", async () => {
        const f = await route.mount({ collapse: 'none' });
        expectPlain(route, f);
      });
    });
  }
});

describe('the drawer trap rows — a headingless section declaring `collapsed` is never unreachable', () => {
  /**
   * A member with neither `label` nor `description`: `SectionDivider` draws
   * nothing for it (`!label && !description` returns null), so no row on the
   * page can host a control. Before the convergence the drawer's explicit push
   * still hid its fields — 0 controls, 0 fields, nothing to click. The default
   * arm has always rendered such a member OPEN ("an untitled bucket is never
   * collapsible"), and that is the answer every route now gives.
   */
  const HEADINGLESS_ROUTES: Array<{ label: string; mount: (s: Record<string, unknown>) => Promise<HTMLElement> }> = [
    {
      label: 'ObjectForm — default layout (the objectui#9780 reference answer)',
      mount: (s) =>
        mounted(
          <ObjectForm schema={{ ...base, sections: [{ fields: ['amount'], ...s }] } as any} dataSource={makeDataSource()} />,
        ),
    },
    {
      label: 'ObjectForm — `formType: "drawer"` through the drawer map',
      mount: (s) =>
        mounted(
          <ObjectForm
            schema={{ ...base, formType: 'drawer', open: true, sections: [{ fields: ['amount'], ...s }] } as any}
            dataSource={makeDataSource()}
          />,
        ),
    },
    {
      label: 'DrawerForm — explicit `sections`, mounted directly',
      mount: (s) =>
        mounted(
          <DrawerForm
            schema={{ ...base, formType: 'drawer', open: true, sections: [{ fields: ['amount'], ...s }] } as any}
            dataSource={makeDataSource()}
          />,
        ),
    },
    {
      label: 'ModalForm — explicit `sections`, mounted directly',
      mount: (s) =>
        mounted(
          <ModalForm
            schema={{ ...base, formType: 'modal', open: true, sections: [{ fields: ['amount'], ...s }] } as any}
            dataSource={makeDataSource()}
          />,
        ),
    },
    {
      label: 'ObjectForm — `formType: "modal"` through the modal map',
      mount: (s) =>
        mounted(
          <ObjectForm
            schema={{ ...base, formType: 'modal', open: true, sections: [{ fields: ['amount'], ...s }] } as any}
            dataSource={makeDataSource()}
          />,
        ),
    },
  ];

  const HEADINGLESS_DECLARATIONS: Array<{ spelled: string; declared: Record<string, unknown> }> = [
    { spelled: '`collapsed: true` alone', declared: { collapsed: true } },
    { spelled: '`collapsible: true` with `collapsed: true`', declared: { collapsible: true, collapsed: true } },
  ];

  for (const route of HEADINGLESS_ROUTES) {
    for (const { spelled, declared } of HEADINGLESS_DECLARATIONS) {
      it(`${route.label}: ${spelled} on a member with no heading and no blurb renders its fields OPEN, and says so`, async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const f = await route.mount(declared);
        const reports = warn.mock.calls
          .map((c) => String(c[0]))
          .filter((m) => m.includes('collapsible section has no heading or description to carry its control'));
        warn.mockRestore();
        expect(
          reports.length,
          '⭐ the loud diagnostic ruling E item 3 orders — the declaration cannot be honoured, so it is reported',
        ).toBeGreaterThan(0);
        expect(headings(f), 'no heading is drawn — there is no row to host a control').toEqual([]);
        expect(toggles(f), 'and so no control exists').toEqual([]);
        expect(
          drawnFields(f),
          '⭐ THE TRAP: with no control on the page, hiding these fields would make them unreachable. ' +
            'They render open, exactly as the default arm renders them',
        ).toEqual(['amount']);
      });
    }
  }

  for (const route of HEADINGLESS_ROUTES) {
    it(`${route.label}: a headingless member WITH a blurb and \`collapsed: true\` alone hosts the control on its blurb-only row`, async () => {
      // Ruling E items 2-3: the row exists iff `title || description`, and
      // the control lives on the row — so a blurb is enough to host it, on
      // every route. Before ruling E the default arm's blurb-only row carried
      // no collapse pair and the modal honoured none; only the drawer did this.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const f = await route.mount({ description: BLURB, collapsed: true });
      const reports = warn.mock.calls.filter((c) =>
        String(c[0]).includes('collapsible section has no heading or description'),
      );
      warn.mockRestore();
      expect(blurbs(f), 'the live control: the row itself is drawn').toEqual([BLURB]);
      expect(drawnFields(f), 'the section starts closed').toEqual([]);
      expect(toggles(f), 'the blurb-only row is the control').toHaveLength(1);
      expect(reports, 'a row exists, so there is nothing to report').toEqual([]);
      fireEvent.click(toggles(f)[0]);
      await waitFor(() => {
        expect(drawnFields(f), 'the control hands the fields back').toEqual(['amount']);
      });
    });
  }
});
