/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13055 — a field group whose `visibleWhen` faults is HIDDEN on every
 * form layout, end to end through `ObjectForm`.
 *
 * `@objectstack/spec` declares `ObjectFieldGroupSchema.visibleWhen` "else
 * hidden (fail-closed)". The direction is stamped by `deriveFieldGroupSections`
 * and carried by every layout's key-by-key rebuild (`sectionFaultCarry-13055`
 * pins the carry by enumeration); these legs prove the rendered result on each
 * `formType`, reaching the group both ways the form can: the no-sections
 * `fieldGroups` fallback and an authored `{ group }` reference.
 *
 *  (a) a parse fault and an unknown-field fault hide the group's heading and
 *      members, on every layout (the tabbed layout hides the group's tab);
 *  (b) CONTROLS — a well-formed predicate shows the group when TRUE and hides
 *      it when FALSE; an authored form-view section's OWN faulting
 *      `visibleWhen` still shows (that slot faults open).
 *
 * Every leg first finds the ungated anchor field, so a form that rendered
 * nothing cannot pass a "hidden" leg.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';
import { resetSectionGroupReports } from '../sectionGroups';

registerAllFields();

const PARSE_FAULT = 'record.kind ==';
const UNKNOWN_FIELD = "record.no_such_field == 'x'";
const WELL_FORMED = "record.kind == 'pro'";

const objectWith = (visibleWhen: string | undefined) => ({
  name: 'qa_group_gate',
  fieldGroups: [
    { key: 'general', label: 'General' },
    { key: 'pro_details', label: 'Pro details', ...(visibleWhen !== undefined ? { visibleWhen } : {}) },
  ],
  fields: {
    kind: { type: 'text', label: 'Kind', group: 'general' },
    pro_seats: { type: 'text', label: 'Pro seats', group: 'pro_details' },
    pro_notes: { type: 'text', label: 'Pro notes', group: 'pro_details' },
  },
});

const makeDS = (objectSchema: unknown) =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    create: vi.fn().mockResolvedValue({ id: 'r1' }),
    update: vi.fn().mockResolvedValue({ id: 'r1' }),
    findOne: vi.fn().mockResolvedValue({ id: 'r1' }),
  }) as any;

let warns: string[] = [];

beforeEach(() => {
  resetSectionGroupReports();
  warns = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Outcome = 'shown' | 'hidden';

/**
 * Render one form and read the pro group's verdict. The group goes whole or
 * stays whole: a heading without its members (or the reverse) throws.
 */
async function proGroup(
  formType: string,
  visibleWhen: string | undefined,
  sections: unknown[] | undefined,
  kind = 'pro',
): Promise<Outcome> {
  render(
    <ObjectForm
      schema={{
        type: 'object-form',
        formType,
        objectName: 'qa_group_gate',
        mode: 'create',
        open: true,
        initialValues: { kind },
        ...(sections ? { sections } : {}),
      } as any}
      dataSource={makeDS(objectWith(visibleWhen))}
    />,
  );
  await waitFor(
    () => expect(document.body.querySelectorAll('input[name="kind"]').length).toBe(1),
    { timeout: 4000 },
  );
  const body = document.body;
  const members =
    body.querySelectorAll('input[name="pro_seats"]').length +
    body.querySelectorAll('input[name="pro_notes"]').length;
  const heading = (body.textContent ?? '').includes('Pro details');
  cleanup();
  if (heading && members === 2) return 'shown';
  if (!heading && members === 0) return 'hidden';
  throw new Error(`PARTIAL GROUP on ${formType}: heading ${heading}, members ${members}`);
}

const BY_REFERENCE = [{ group: 'general' }, { group: 'pro_details' }];
const LAYOUTS = ['simple', 'tabbed', 'split', 'drawer', 'modal'] as const;

describe('objectui#13055 (a) — a faulting field-group predicate hides the group on every layout', () => {
  it('the no-sections fieldGroups fallback (simple form): parse fault and unknown field both hide', async () => {
    expect(await proGroup('simple', PARSE_FAULT, undefined)).toBe('hidden');
    expect(await proGroup('simple', UNKNOWN_FIELD, undefined)).toBe('hidden');
    expect(warns.some((w) => w.includes(JSON.stringify(PARSE_FAULT)) && w.includes('safe default (false)'))).toBe(true);
  });

  for (const layout of LAYOUTS) {
    it(`a { group } reference on the ${layout} layout: parse fault and unknown field both hide`, async () => {
      expect(await proGroup(layout, PARSE_FAULT, BY_REFERENCE)).toBe('hidden');
      expect(await proGroup(layout, UNKNOWN_FIELD, BY_REFERENCE)).toBe('hidden');
    });
  }
});

describe('objectui#13055 (b) — controls', () => {
  for (const layout of LAYOUTS) {
    it(`${layout}: a well-formed predicate shows on TRUE and hides on FALSE`, async () => {
      expect(await proGroup(layout, WELL_FORMED, BY_REFERENCE, 'pro')).toBe('shown');
      expect(await proGroup(layout, WELL_FORMED, BY_REFERENCE, 'basic')).toBe('hidden');
    });
  }

  it("an authored form-view section's OWN faulting visibleWhen still shows (that slot faults open)", async () => {
    for (const layout of LAYOUTS) {
      const sections = [
        { label: 'General', fields: ['kind'] },
        { label: 'Pro details', fields: ['pro_seats', 'pro_notes'], visibleWhen: 'record.kind == (authored' },
      ];
      expect(await proGroup(layout, undefined, sections)).toBe('shown');
    }
  });
});
