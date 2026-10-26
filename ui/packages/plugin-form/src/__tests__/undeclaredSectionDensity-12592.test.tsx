/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12592 — a section that declares no `columns` draws on every page
 * host as it does in the dialog: two per row from the container's `@md` tier,
 * one below it.
 *
 * `@objectstack/spec` dropped `FormSectionSchema.columns`' `default(1)`
 * (objectstack-ai/objectstack#23740), so an undeclared section reaches every
 * sectioned host. The fork on objectui#12521 (ruled 6204264665) made an
 * undeclared density the renderer's choice by available width; `ModalForm`
 * drew it two per row, while `ObjectForm` drew it by field count
 * (`inferColumns`) and `SplitForm`, `TabbedForm` and `WizardForm` one per row
 * or at the widest declared count. The rule now lives once, in
 * `sectionedGridLayout` (`autoLayout.ts`), and every host hands it the authored
 * counts. A declared `columns` — `1` included — is drawn as written.
 *
 * These pins read the class attributes the real renderer draws, per host, and
 * compare each page host with the dialog, because the claim is about what
 * renders.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import '@object-ui/components';
import { ModalForm } from '../ModalForm';
import { ObjectForm } from '../ObjectForm';
import { SplitForm } from '../SplitForm';
import { TabbedForm } from '../TabbedForm';
import { WizardForm } from '../WizardForm';

registerAllFields();

afterEach(() => cleanup());

const MORE = Array.from({ length: 12 }, (_, i) => `x${i}`);
const FIELD_NAMES = ['c1', 'c2', 'c3', 'c4', 'full', 'q1', 'q2', 'q3', ...MORE];

const makeDataSource = (): any => ({
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'lead',
    fields: Object.fromEntries(
      FIELD_NAMES.map((n) => [n, { type: 'text', label: `Field ${n}` }]),
    ),
  }),
  create: vi.fn().mockResolvedValue({ id: '1' }),
  update: vi.fn().mockResolvedValue({ id: '1' }),
  findOne: vi.fn().mockResolvedValue({}),
});

type Section = { name: string; label: string; columns?: number; fields: unknown[] };
type Host = 'modal' | 'object' | 'split' | 'tabbed' | 'wizard';

const PAGE_HOSTS: Exclude<Host, 'modal'>[] = ['object', 'split', 'tabbed', 'wizard'];

function mount(host: Host, sections: Section[], extra: Record<string, unknown> = {}) {
  const schema = {
    type: 'object-form',
    objectName: 'lead',
    mode: 'create',
    title: 'New Lead',
    sections,
    ...extra,
  } as any;
  const ds = makeDataSource();
  switch (host) {
    case 'modal':
      return render(<ModalForm schema={{ ...schema, formType: 'modal' }} dataSource={ds} />);
    case 'object':
      return render(<ObjectForm schema={schema} dataSource={ds} />);
    case 'split':
      return render(<SplitForm schema={{ ...schema, formType: 'split' }} dataSource={ds} />);
    case 'tabbed':
      return render(<TabbedForm schema={{ ...schema, formType: 'tabbed' }} dataSource={ds} />);
    case 'wizard':
      return render(<WizardForm schema={{ ...schema, formType: 'wizard' }} dataSource={ds} />);
  }
}

/** The grid classes of the container holding `name`, and that field's own span classes. */
function readField(name: string): { grid: string[]; span: string[] } {
  const cell = document.body.querySelector(`[data-field="${name}"]`);
  if (!cell) throw new Error(`field not rendered: ${name}`);
  const tokens = (el: Element | null) => (el?.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  return {
    grid: tokens(cell.parentElement).filter((t) => /(^|:)grid-cols-/.test(t)),
    span: tokens(cell).filter((t) => /(^|:)col-span-/.test(t)),
  };
}

async function settle(name: string) {
  await waitFor(() => expect(document.body.querySelector(`[data-field="${name}"]`)).not.toBeNull());
}

// A field's count per row at a container tier: (tracks in force) / (its span
// in force). Tailwind's prefixes are min-width, so the class in force at a
// tier is the widest-prefixed one at or below it; below `@md` the base class.
const TIERS = ['@md', '@2xl', '@4xl'] as const;
function perRowAt(read: { grid: string[]; span: string[] }, tier: (typeof TIERS)[number]): number {
  const upTo = TIERS.slice(0, TIERS.indexOf(tier) + 1);
  const inForce = (list: string[], stem: string) => {
    let v: number | undefined;
    for (const t of upTo) {
      const hit = list.find((c) => c.startsWith(`${t}:${stem}`));
      if (hit) v = Number(hit.split('-').pop());
    }
    return v;
  };
  const tracks = inForce(read.grid, 'grid-cols-') ?? 1;
  const span = inForce(read.span, 'col-span-') ?? 1;
  return tracks / span;
}
const ladder = (read: { grid: string[]; span: string[] }) => TIERS.map((t) => perRowAt(read, t));

/** What the dialog draws for `name` under `sections` — the reference every page host must match. */
async function dialogReading(sections: Section[], name: string) {
  mount('modal', sections);
  await settle(name);
  const read = readField(name);
  cleanup();
  return read;
}

/** Two undeclared sections. 16 fields, so `inferColumns` would have said four. */
const UNDECLARED: Section[] = [
  { name: 'contact', label: 'Contact', fields: ['c1', 'c2', { field: 'full', span: 'full' }, 'c3', 'c4'] },
  { name: 'more', label: 'More', fields: ['q1', ...MORE] },
];

/** Undeclared first (the wizard's first step), then a declared `columns: 3`. */
const MIXED: Section[] = [
  { name: 'contact', label: 'Contact', fields: ['c1', 'c2', { field: 'full', span: 'full' }, 'c3', 'c4'] },
  { name: 'classification', label: 'Classification', columns: 3, fields: ['q1', 'q2', 'q3'] },
];

describe('objectui#12592 — an undeclared section draws as the dialog does, on every page host', () => {
  for (const host of PAGE_HOSTS) {
    it(`${host}: every section undeclared → two per row from @md, one below`, async () => {
      const reference = await dialogReading(UNDECLARED, 'c1');
      mount(host, UNDECLARED);
      await settle('c1');
      const c1 = readField('c1');

      expect(c1.grid, 'one column below @md').toContain('grid-cols-1');
      expect(ladder(c1), '@md / @2xl / @4xl').toEqual([2, 2, 2]);
      expect(perRowAt(readField('full'), '@4xl'), "span: 'full' takes the row").toBe(1);
      // Byte for byte the dialog's classes, not merely the same count.
      expect(c1).toEqual(reference);
    });

    it(`${host}: an undeclared section beside a declared columns: 3 one still draws two`, async () => {
      const reference = await dialogReading(MIXED, 'c1');
      mount(host, MIXED);
      await settle('c1');
      const c1 = readField('c1');
      expect(ladder(c1)).toEqual([2, 2, 2]);
      expect(ladder(c1)).toEqual(ladder(reference));
      if (host === 'wizard') {
        // A wizard draws one step per grid, so the step never shares the
        // dialog's 12-track grid with its declared neighbour: same count per
        // row, on the plain two-column grid.
        expect(c1.grid).toEqual(['grid-cols-1', '@md:grid-cols-2']);
      } else {
        expect(c1).toEqual(reference);
        // The declared neighbour keeps its own count.
        expect(ladder(readField('q1'))).toEqual([2, 3, 3]);
      }
    });
  }
});

/**
 * CONTROL — a declared `columns` is drawn as written on every host, `1`
 * included: the undeclared rule never reaches a section that declares.
 */
describe('objectui#12592 CONTROL — declared sections keep their declared count', () => {
  const ONES: Section[] = [
    { name: 'contact', label: 'Contact', columns: 1, fields: ['c1', 'c2', 'c3', 'c4'] },
    { name: 'more', label: 'More', columns: 1, fields: ['q1', ...MORE] },
  ];
  const THREES: Section[] = [
    { name: 'contact', label: 'Contact', columns: 3, fields: ['c1', 'c2', 'c3', 'c4'] },
    { name: 'more', label: 'More', columns: 3, fields: ['q1', 'q2', 'q3'] },
  ];
  for (const host of PAGE_HOSTS) {
    it(`${host}: columns: 1 stays one per row`, async () => {
      mount(host, ONES);
      await settle('c1');
      expect(ladder(readField('c1'))).toEqual([1, 1, 1]);
    });

    it(`${host}: columns: 3 keeps its 2 → 3 ladder`, async () => {
      mount(host, THREES);
      await settle('c1');
      expect(ladder(readField('c1'))).toEqual([2, 3, 3]);
    });

    it(`${host}: a declared form columns fills an undeclared section, as it always did`, async () => {
      mount(host, UNDECLARED, { columns: 3 });
      await settle('c1');
      expect(ladder(readField('c1'))).toEqual([2, 3, 3]);
    });
  }
});
