/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The headingless-collapse diagnostic (objectui#9849 step two — director
 * ruling letter E, item 3, maintainer 「同意」):
 *
 * > The collapse control lives on the row. A group that declares `collapsible`
 * > (or `collapsed`) but yields neither title nor description has nowhere to
 * > host the control ⇒ a loud diagnostic at validation or render
 * > (「collapsible section has no heading or description to carry its
 * > control」), ⛔ never fields removed from the DOM with no control.
 *
 * WHAT THIS FILE HOLDS. `collapseResolution-9849` owns the resolution on every
 * route (including that such a member renders OPEN). This file owns the
 * DIAGNOSTIC: its wording, that every route which can meet such a member
 * reports it, and — the absence controls — that nothing else does. Only the
 * EXPLICIT-sections routes are mounted: a declared `fieldGroups` entry always
 * yields a heading from its key (`sectionDividerProjection-9849` block 4), so
 * the derived routes cannot reach this member.
 *
 * ⚠️ Assertions read the diagnostic's OWN first sentence out of
 * `headinglessCollapseWarning`, and that sentence is pinned once against the
 * ruling's text in row 1 — so the wording has exactly one reader here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';
import { ModalForm } from '../ModalForm';
import { DrawerForm } from '../DrawerForm';
import {
  headinglessCollapseWarning,
  resetHeadinglessCollapseWarnings,
  resolveSectionCollapse,
} from '../fieldGroups';

registerAllFields();

/** The ruling's own sentence, verbatim. */
const RULED = 'collapsible section has no heading or description to carry its control';

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: { amount: { type: 'text', label: 'Amount' } },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as any;

async function mounted(node: React.ReactElement): Promise<HTMLElement> {
  render(node);
  let form: HTMLFormElement | null = null;
  await waitFor(() => {
    form = document.body.querySelector('form');
    if (!form) throw new Error('form not ready');
  });
  return form as unknown as HTMLElement;
}

const drawnFields = (f: HTMLElement): string[] =>
  [...f.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field') as string);

const toggles = (f: HTMLElement) => f.querySelectorAll('[role="button"][aria-expanded]');

const base = { type: 'object-form', objectName: 'invoice', mode: 'create' } as const;

/** Every route an author can reach a headingless member on, and the arm it reports as. */
const ROUTES: Array<{ label: string; arm: string; mount: (s: Record<string, unknown>) => Promise<HTMLElement> }> = [
  {
    label: 'ObjectForm — default layout',
    arm: 'ObjectForm',
    mount: (s) =>
      mounted(<ObjectForm schema={{ ...base, sections: [{ fields: ['amount'], ...s }] } as any} dataSource={makeDataSource()} />),
  },
  {
    label: 'ObjectForm — `formType: "drawer"`',
    arm: 'DrawerForm',
    mount: (s) =>
      mounted(
        <ObjectForm
          schema={{ ...base, formType: 'drawer', open: true, sections: [{ fields: ['amount'], ...s }] } as any}
          dataSource={makeDataSource()}
        />,
      ),
  },
  {
    label: 'DrawerForm — mounted directly',
    arm: 'DrawerForm',
    mount: (s) =>
      mounted(
        <DrawerForm
          schema={{ ...base, formType: 'drawer', open: true, sections: [{ fields: ['amount'], ...s }] } as any}
          dataSource={makeDataSource()}
        />,
      ),
  },
  {
    label: 'ObjectForm — `formType: "modal"`',
    arm: 'ModalForm',
    mount: (s) =>
      mounted(
        <ObjectForm
          schema={{ ...base, formType: 'modal', open: true, sections: [{ fields: ['amount'], ...s }] } as any}
          dataSource={makeDataSource()}
        />,
      ),
  },
  {
    label: 'ModalForm — mounted directly',
    arm: 'ModalForm',
    mount: (s) =>
      mounted(
        <ModalForm
          schema={{ ...base, formType: 'modal', open: true, sections: [{ fields: ['amount'], ...s }] } as any}
          dataSource={makeDataSource()}
        />,
      ),
  },
];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetHeadinglessCollapseWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const reports = (): string[] =>
  warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes(RULED));

describe('objectui#9849 — the headingless-collapse diagnostic (ruling E item 3)', () => {
  it('1. its first sentence is the ruling’s wording, verbatim', () => {
    expect(headinglessCollapseWarning('X').startsWith(`${RULED}:`)).toBe(true);
  });

  describe('2. every route that can meet the member reports it, and keeps the fields reachable', () => {
    for (const route of ROUTES) {
      it(route.label, async () => {
        const f = await route.mount({ collapsible: true, collapsed: true });
        expect(reports(), 'reported once per section, whatever the re-render count').toHaveLength(1);
        expect(reports()[0], 'naming the arm and the object it met the member on').toContain(
          `${route.arm} section`,
        );
        expect(reports()[0]).toContain("object 'invoice'");
        expect(toggles(f).length, 'no row, so no control').toBe(0);
        expect(drawnFields(f), '⛔ never fields removed from the DOM with no control').toEqual(['amount']);
      });
    }
  });

  describe('3. absence controls — the diagnostic says nothing when the declaration CAN be honoured', () => {
    for (const route of ROUTES) {
      it(`${route.label}: a heading, a blurb, or no collapse pair at all`, async () => {
        const titled = await route.mount({ label: 'Money', collapsible: true });
        expect(toggles(titled).length, 'the lit control: the row carries the control').toBe(1);
        cleanup();
        await route.mount({ description: 'Totals', collapsible: true });
        cleanup();
        await route.mount({});
        expect(reports(), 'none of the three is reported').toEqual([]);
      });
    }
  });

  it('4. the report is deduplicated per section, so a re-render does not repeat it', () => {
    const host = {
      live: undefined,
      title: undefined,
      description: undefined,
      where: "ObjectForm section '0' of object 'dedupe'",
      setCollapsed: () => {},
    };
    const first = resolveSectionCollapse({ collapsed: true }, host);
    resolveSectionCollapse({ collapsed: true }, host);
    expect(reports()).toHaveLength(1);
    expect(first, 'and the section resolves OPEN, with no control').toEqual({
      collapsible: false,
      collapsed: false,
      onToggle: undefined,
    });
  });
});
