/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6152 round 1 — the `ObjectFormSchema` members the TypeScript face
 * declared and the zod mirror had never heard of.
 *
 * ## The defect
 *
 * `UnmirroredDeclared['objectql.zod.ts#ObjectFormSchema']` in
 * `zod-mirror-parity.test.ts` recorded keys `../objectql.ts` invites an author
 * to write and `../zod/objectql.zod.ts` did not declare. Two faces paid for it:
 *
 *   - the TOLERANT face (`BaseSchema` is `.passthrough()`) kept any value at
 *     those keys unexamined, so `{ formType: 'carousel' }` parsed green and
 *     `ObjectForm` fell through to its simple layout;
 *   - the STRICT authoring face (`StrictAnyComponentSchema`, objectui#8345,
 *     derived from the mirrors) refused the keys outright, although `tsc`
 *     accepted them — objectui#5250's M3 class (iii), the refusals
 *     `objectui validate` would print wrongly once it judges strict.
 *
 * Each key was measured before it was mirrored: authored (a document, the
 * object-view `form` slot, or a form view relayed into the node), and READ by a
 * shipped renderer (`ObjectForm` in `@object-ui/plugin-form`). The readings are
 * in objectui#6152's round-1 report; this file pins the result, not the census.
 *
 * ## What each row asserts
 *
 *   - a VALID authored value parses on BOTH faces — the strict leg is the one
 *     that moved (refused → accepted), the tolerant leg shows the shape is not a
 *     broken schema;
 *   - a WRONG-TYPED value is refused AT THE KEY on the tolerant face — the leg
 *     that moved the other way (kept unexamined → refused).
 *
 * `open` and `submitHandler` stay out of the mirror on purpose (their routes are
 * open on objectui#6152; objectui#6182 rules out a string handler), and a row
 * holds them out so a later card cannot mirror them without that ruling.
 *
 * ## Since objectui#10859 batch 4: the faces take these members in the bag
 *
 * An AUTHORED `object-form` takes its props in the spec's `properties` bag,
 * judged by `ComponentPropsMap['object-form']` by reference
 * (`ObjectFormBlockSchema`); the flat spelling is refused by name. So the
 * face rows below write each member in the bag. The mirror rows still read the
 * flat mirror, which stays the node as `ObjectForm` reads it after the hoist.
 *
 * Three members — `buttons`, `defaults` and `subforms` — are the spec's
 * FORM-VIEW members (`FormViewSchema`), not members of the `object-form` row,
 * so the row refuses them in the bag. They still reach the renderer the way
 * round 1 measured: relayed from an object's form view into the node by
 * `ObjectView` / `RecordFormPage`, and through the object-view `form` slot,
 * which is built from this mirror.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ObjectFormSchema as ObjectFormMirror } from '../zod/objectql.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/** A minimal AUTHORED document both faces accept; every face row below is a delta on its bag. */
const BASE = { type: 'object-form', properties: { objectName: 'order', mode: 'create' } } as const;
/** The same node as the renderer reads it after the hoist — what the mirror rows parse. */
const FLAT_BASE = { type: 'object-form', objectName: 'order', mode: 'create' } as const;
const withProp = (key: string, value: unknown) => ({ ...BASE, properties: { ...BASE.properties, [key]: value } });

/** The spec's form-VIEW members: not members of `ComponentPropsMap['object-form']` (objectui#10859 batch 4). */
const FORM_VIEW_ONLY = new Set(['buttons', 'defaults', 'subforms']);

/** Each mirrored key: one authored value, and one value its declaration refuses. */
const ROWS: ReadonlyArray<{ key: string; valid: unknown; wrong: unknown }> = [
  { key: 'formType', valid: 'wizard', wrong: 'carousel' },
  {
    key: 'sections',
    // `visibleWhen` rides the STANDALONE section: since `@objectstack/spec` 17.7.0
    // a group-referencing section takes its presentation from the object's
    // `fieldGroups` entry and refuses `visibleWhen` beside `group`
    // (objectui#11717 re-judged this fixture; it wrote the pair together).
    valid: [
      {
        name: 'basics',
        label: 'Basics',
        columns: 2,
        fields: ['name', { name: 'email', type: 'email' }],
        visibleWhen: { dialect: 'cel', source: 'record.kind == "b2b"' },
      },
      { group: 'contact_info', pane: 'secondary' },
    ],
    wrong: 'basics',
  },
  { key: 'defaultTab', valid: 'basics', wrong: 3 },
  { key: 'tabPosition', valid: 'left', wrong: 'middle' },
  { key: 'allowSkip', valid: true, wrong: 'yes' },
  { key: 'showStepIndicator', valid: false, wrong: 'no' },
  { key: 'nextText', valid: { en: 'Next', fr: 'Suivant' }, wrong: 42 },
  { key: 'prevText', valid: 'Back', wrong: 42 },
  { key: 'splitDirection', valid: 'vertical', wrong: 'diagonal' },
  { key: 'splitSize', valid: 40, wrong: '40%' },
  { key: 'splitResizable', valid: false, wrong: 'false' },
  { key: 'drawerSide', valid: 'left', wrong: 'center' },
  { key: 'drawerWidth', valid: '40%', wrong: 40 },
  { key: 'modalSize', valid: 'lg', wrong: 'huge' },
  { key: 'modalCloseButton', valid: false, wrong: 'no' },
  { key: 'mobile', valid: { stickyActions: true, stepper: 'auto', stepperMinFields: 6 }, wrong: { stepper: 'sometimes' } },
  { key: 'buttons', valid: { submit: { show: true, label: 'Save' }, reset: { show: false } }, wrong: { submit: { show: 'yes' } } },
  { key: 'defaults', valid: { status: 'open', priority: 2 }, wrong: ['status'] },
  { key: 'subforms', valid: [{ childObject: 'order_line', minRows: 1 }], wrong: [{ relationshipField: 'order' }] },
];

describe('objectui#6152 round 1 — `object-form` members the mirror now declares', () => {
  it('CONTROL: the minimal document parses on both faces', () => {
    expect(AnyComponentSchema.safeParse(BASE).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(BASE).success).toBe(true);
  });

  it.each(ROWS)('`$key` is a member of the mirror', ({ key }) => {
    expect(key in (ObjectFormMirror.shape as Record<string, unknown>)).toBe(true);
  });

  it.each(ROWS.filter(({ key }) => !FORM_VIEW_ONLY.has(key)))('an authored `$key` parses on the strict face and the tolerant face, in the bag', ({ key, valid }) => {
    const doc = withProp(key, valid);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
    const tolerant = AnyComponentSchema.safeParse(doc);
    expect(tolerant.success, JSON.stringify(tolerant.error?.issues)).toBe(true);
  });

  it.each(ROWS.filter(({ key }) => FORM_VIEW_ONLY.has(key)))('`$key` is a form-VIEW member: the row refuses it in the bag, and the object-view `form` slot takes it', ({ key, valid }) => {
    for (const face of [StrictAnyComponentSchema, AnyComponentSchema]) {
      const parsed = face.safeParse(withProp(key, valid));
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain(`"${key}"`);
    }
    const view = { type: 'object-view', objectName: 'order', form: { [key]: valid } };
    const strict = StrictAnyComponentSchema.safeParse(view);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
  });

  it.each(ROWS)('a wrong-typed `$key` is refused at the key on the tolerant face', ({ key, wrong }) => {
    const parsed = ObjectFormMirror.safeParse({ ...FLAT_BASE, [key]: wrong });
    expect(parsed.success).toBe(false);
    for (const issue of parsed.error?.issues ?? []) expect(issue.path[0]).toBe(key);
  });

  it('the object-view `form` slot takes the same members (it is this mirror minus the identity keys)', () => {
    const doc = { type: 'object-view', objectName: 'order', form: { formType: 'drawer', drawerSide: 'left', sections: [{ fields: ['name'] }] } };
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
    expect(AnyComponentSchema.safeParse({ ...doc, form: { formType: 'carousel' } }).success).toBe(false);
  });

  it('a section is a closed shape on the strict face: an undeclared section key is named there', () => {
    // `className` is deliberately undeclared on `ObjectFormSection` (objectui#7200).
    // Read through the object-view `form` slot, which is built from this mirror.
    // (On an authored `object-form` node the bag is the spec row, whose
    // `sections` entries the spec types `unknown`, so the row does not judge a
    // section's keys there — objectui#10859 batch 4.)
    const view = { type: 'object-view', objectName: 'order', form: { sections: [{ name: 'a', className: 'p-4', fields: ['a'] }] } };
    const strict = StrictAnyComponentSchema.safeParse(view);
    expect(strict.success).toBe(false);
    expect(JSON.stringify(strict.error?.issues)).toContain('"className"');
  });

  it('the catalog document objectui#5250 M3 charged with three of these keys now parses on the strict face', () => {
    const doc = JSON.parse(readFileSync(join(REPO_ROOT, 'examples/schema-catalog/src/schemas/plugin-form/object-form-tabbed-sections.json'), 'utf8'));
    // Non-vacuity: the document really carries the keys this row is about, in
    // its `properties` bag since objectui#10859 batch 4.
    expect(Object.keys(doc.properties)).toEqual(expect.arrayContaining(['formType', 'defaultTab', 'sections']));
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.error?.issues)).toBe(true);
  });

  it('`open` and `submitHandler` stay out of the mirror until their routes are ruled', () => {
    const shape = ObjectFormMirror.shape as Record<string, unknown>;
    expect('open' in shape).toBe(false);
    expect('submitHandler' in shape).toBe(false);
  });
});
