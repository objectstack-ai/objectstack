/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12442 — Studio's page-create seed and the running app's default
 * record page carry the same detail sections.
 *
 * The running app (`RecordDetailView`) passes `buildDefaultPageSchema` explicit
 * sections: the object's field groups, else the visible-field split. The seed
 * (`metadata-admin/anchors.ts`) passed none, so on an object with no
 * `fieldGroups` it persisted a bare `record:details`, which since objectui#12433
 * draws only the object's `highlightFields` (or nothing). Both now take the
 * sections from `recordDetailSections.ts`.
 *
 * - an object with no `fieldGroups`: the seed's `record:details` carries the
 *   runtime's sections, written in the persisted shape (field names), and that
 *   shape parses under the spec's `RecordDetailsProps`;
 * - CONTROL: an object with `fieldGroups` seeds exactly what the synthesizer
 *   alone writes, the `{ group }` references it has written since objectui#11630;
 * - the three call sites go through the one derivation, and no second copy of
 *   the split exists.
 *
 * The slotted preview's half is the `objectui#12442` block in
 * `metadata-admin/previews/PagePreview.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordDetailsProps } from '@objectstack/spec/ui';
// `createSeed` reaches the synthesizer and the section derivation through
// dynamic imports. Import both at module scope so the cold transform lands in
// the import phase, outside any test timeout (AGENTS.md, flaky test discipline).
import { buildDefaultPageSchema } from '@object-ui/plugin-detail';
import {
  deriveRecordDetailSections,
  deriveStudioDetailSections,
  toAuthoredDetailSections,
  MORE_DETAILS_DEFAULT_LABEL,
} from './recordDetailSections';
import { registerBuiltinAnchors } from './metadata-admin/anchors';
import { resolveResourceConfig } from './metadata-admin/registry';

registerBuiltinAnchors();

/** No `fieldGroups`: the split yields a primary section and "More details". */
const flatDef = {
  name: 'os_12442_ticket',
  label: 'Ticket',
  highlightFields: ['subject'],
  fields: {
    name: { label: 'Ticket Name', type: 'text' },
    subject: { label: 'Subject', type: 'text' },
    priority: { label: 'Priority', type: 'select', options: [{ value: 'high', label: 'High' }] },
    account: { label: 'Account', type: 'lookup', reference: 'os_12442_account' },
    notes: { label: 'Notes', type: 'textarea' },
    internal_code: { label: 'Internal Code', type: 'text', hidden: true },
  },
};

/** Declares `fieldGroups`, and leaves two fields ungrouped. */
const groupedDef = {
  name: 'os_12442_account',
  label: 'Account',
  highlightFields: ['website'],
  fieldGroups: [{ key: 'basic_info', label: 'Basic Information' }],
  fields: {
    name: { label: 'Account Name', type: 'text' },
    website: { label: 'Website', type: 'url' },
    industry: { label: 'Industry', type: 'text', group: 'basic_info' },
    owner_name: { label: 'Owner Name', type: 'text' },
    notes: { label: 'Notes', type: 'textarea' },
  },
};

const LABELS = { moreDetails: MORE_DETAILS_DEFAULT_LABEL };

/** Every `record:details` node in a page document, depth-first. */
function detailsNodes(node: unknown): Array<Record<string, any>> {
  const found: Array<Record<string, any>> = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const rec = n as Record<string, any>;
    if (rec.type === 'record:details') found.push(rec);
    Object.values(rec).forEach(walk);
  };
  walk(node);
  return found;
}

/** The one `record:details` node of a seeded or synthesized page. */
function theDetailsNode(doc: unknown): Record<string, any> {
  const nodes = detailsNodes(doc);
  expect(nodes, 'the page carries exactly one record:details node').toHaveLength(1);
  return nodes[0];
}

async function seedFor(def: unknown): Promise<Record<string, any>> {
  const cfg = resolveResourceConfig('page');
  const client = { get: async () => def };
  return (await cfg.createSeed!({ type: 'record', object: (def as any).name }, { client })) as Record<string, any>;
}

describe('objectui#12442 — the page-create seed carries the runtime detail sections', () => {
  it('an object with no fieldGroups: the seed carries the runtime sections, not a bare record:details', async () => {
    const runtimeSections = deriveRecordDetailSections(flatDef, LABELS);
    // Firing control: the fixture really exercises the split (two sections),
    // so an equality below cannot hold between two empty bodies.
    expect(runtimeSections).toHaveLength(2);

    const seeded = theDetailsNode(await seedFor(flatDef));
    expect(seeded.properties?.sections, 'the seed wrote a bare record:details').toBeDefined();
    expect(seeded.properties.sections).toEqual(toAuthoredDetailSections(runtimeSections));

    // The same members, in the same sections, in the same order as the runtime.
    expect(seeded.properties.sections.map((s: any) => s.fields)).toEqual([
      ['name', 'subject', 'priority', 'account'],
      ['notes'],
    ]);
    expect(seeded.properties.sections[1]).toMatchObject({ name: 'details', label: 'More details' });
  });

  it('the seeded sections are spec-legal: they parse under RecordDetailsProps', async () => {
    const seeded = theDetailsNode(await seedFor(flatDef));
    // Firing control: an absent `sections` parses too, and would say nothing.
    expect(seeded.properties?.sections).toHaveLength(2);
    const parsed = RecordDetailsProps.safeParse({ sections: seeded.properties.sections });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('the seed and the runtime build the same record:details node from those sections', async () => {
    const runtimePage = buildDefaultPageSchema(flatDef as any, {
      sections: toAuthoredDetailSections(deriveRecordDetailSections(flatDef, LABELS)) as any,
    });
    expect(theDetailsNode(await seedFor(flatDef))).toEqual(theDetailsNode(runtimePage));
  });

  it('CONTROL: an object with fieldGroups seeds exactly what the synthesizer alone writes', async () => {
    expect(deriveStudioDetailSections(groupedDef, LABELS)).toBeUndefined();
    const today = buildDefaultPageSchema(groupedDef as any) as Record<string, any>;
    const seeded = await seedFor(groupedDef);
    expect(seeded.regions).toEqual(today.regions);
    // Firing control: that body is the `{ group }` reference form, not bare.
    expect(theDetailsNode(seeded).properties.sections[0]).toEqual(
      expect.objectContaining({ group: 'basic_info' }),
    );
  });
});

describe('objectui#12442 — one derivation, three call sites', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (rel: string) => readFileSync(path.join(here, rel), 'utf8');

  it('the runtime takes its sections from deriveRecordDetailSections and keeps no copy of the split', () => {
    const src = read('RecordDetailView.tsx');
    expect(src).toMatch(/const sections = deriveRecordDetailSections\(objectDef,/);
    expect(src).not.toMatch(/splitPrimarySecondary/);
  });

  it('the page-create seed and the slotted preview take theirs from deriveStudioDetailSections', () => {
    for (const rel of ['metadata-admin/anchors.ts', 'metadata-admin/previews/PagePreview.tsx']) {
      const src = read(rel);
      expect(src, rel).toMatch(/deriveStudioDetailSections\(/);
      expect(src, rel).not.toMatch(/splitPrimarySecondary/);
    }
  });

  it('the Studio sections are the runtime sections whenever no fieldGroups apply', () => {
    expect(deriveStudioDetailSections(flatDef, LABELS)).toEqual(deriveRecordDetailSections(flatDef, LABELS));
    expect(deriveStudioDetailSections(null, LABELS)).toBeUndefined();
  });
});
