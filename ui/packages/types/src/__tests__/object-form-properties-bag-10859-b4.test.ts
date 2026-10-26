/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form` takes its props in the spec's `properties` bag, and the flat
 * spelling retires from both authoring faces (objectui#10859, batch 4).
 *
 * ## The defect this pins
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-form']` row is the published
 * declaration of an authored `object-form` node's props, and the spec's strict
 * `PageComponentSchema` refuses a prop written on the node itself as
 * mis-layered (ADR-0089 D3a). objectui's arm was the flat mirror of the
 * TypeScript twin instead, so the two validators disagreed in both directions:
 *
 *   - the objectstack showcase's wizard page (`NewProjectWizardPage` in
 *     objectstack's `examples/app-showcase`, the one live spec-shaped producer)
 *     was refused by `safeValidateSchema` — `objectName` `invalid_type`, `mode`
 *     `invalid_value` — and by the strict face, which added `properties` as an
 *     unrecognized key;
 *   - the flat node `os validate` refuses parsed green on both faces.
 *
 * The seat's answer at PR objectui#11248's ACCEPT (A, inherited from
 * objectui#10872's triage answer A) is the one this arm executes: the
 * `properties` bag is the contract, by reference to the row, and the flat
 * spelling is refused by name with a prescription that names the bag member.
 *
 * ## What did NOT move
 *
 * The TypeScript `ObjectFormSchema` (`../objectql.ts`) and its zod mirror
 * (`ObjectFormSchema` in `../zod/objectql.zod.ts`) stay published: they are the
 * node as `ObjectForm` reads it AFTER `SchemaRenderer` hoists `properties`, and
 * as code composes it. The mirror is no longer an arm of `AnyComponentSchema`;
 * `ObjectFormBlockSchema` is. The last describe block holds that split.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` block below is TYPE-level: `tsc -p tsconfig.test.json`
 * (the third leg of this package's `type-check` script) reads it, and vitest —
 * which strips types — does not. The `describe` blocks are RUNTIME. A green run
 * of either one alone says nothing about the other.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ElementDataSourceSchema as SpecElementDataSourceSchema,
  ObjectFormPropsSchema as SpecObjectFormPropsSchema,
  PageComponentSchema as SpecPageComponentSchema,
  type ObjectFormProps as SpecObjectFormProps,
} from '@objectstack/spec/ui';

import type { ObjectFormSchema as TsObjectFormSchema, ObjectQLComponentSchema as TsObjectQLComponentSchema } from '../objectql';
import {
  ObjectFormBlockSchema,
  ObjectFormSchema,
  ObjectQLComponentSchema,
  ObjectQLPublicBlockComponentSchema,
  ObjectViewSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';

/* ── Type-level parity: the `tsc` channel ────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The arm's own shape. */
type ShapeOf<M> = M extends { shape: infer S } ? S : never;
/** What a shape entry ACCEPTS (input side, so `.optional()` shows). */
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;
type Arm = ShapeOf<typeof ObjectFormBlockSchema>;

/**
 * The bag accepts exactly the spec's published props type (absent allowed),
 * the node's binding accepts exactly the spec's element binding, a row key
 * written flat accepts nothing, and neither content channel accepts anything.
 */
export type assertionObjectFormArmIsTheRow = [
  Expect<Equal<InputOf<Arm['properties']>, SpecObjectFormProps | undefined>>,
  Expect<Equal<InputOf<Arm['dataSource']>, z.input<typeof SpecElementDataSourceSchema> | undefined>>,
  Expect<Equal<InputOf<Arm['objectName']>, undefined>>,
  Expect<Equal<InputOf<Arm['mode']>, undefined>>,
  Expect<Equal<InputOf<Arm['sections']>, undefined>>,
  Expect<Equal<InputOf<Arm['children']>, undefined>>,
  Expect<Equal<InputOf<Arm['body']>, undefined>>,
];

/**
 * Every member of the spec row is refused flat on the arm: the refusal set is
 * the row's key set, read by reference, so it cannot fall behind the row.
 */
export type assertionEveryRowKeyIsRefusedFlat = Expect<
  Equal<Exclude<keyof SpecObjectFormProps, keyof Arm>, never>
>;

/**
 * The TypeScript twin is RE-DECLARED, not retired: still published, still the
 * post-hoist reading with its identity keys required, still a member of the
 * TypeScript ObjectQL union. A narrowing or a removal here reddens `tsc`.
 */
export type assertionTwinStaysPublished = [
  Expect<Equal<TsObjectFormSchema['type'], 'object-form'>>,
  Expect<Equal<TsObjectFormSchema['objectName'], string>>,
  Expect<Equal<TsObjectFormSchema['mode'], 'create' | 'edit' | 'view'>>,
  Expect<Equal<Extract<TsObjectQLComponentSchema, { type: 'object-form' }>, TsObjectFormSchema>>,
];

/** Non-vacuity: a bag narrower than the spec's props type is not Equal to it. */
export type assertionInstrumentFires = [
  Expect<Equal<Equal<{ objectName?: string } | undefined, SpecObjectFormProps | undefined>, false>>,
];

/* ── Runtime fixtures ────────────────────────────────────────────────────── */

/**
 * The objectstack showcase's wizard node (`NewProjectWizardPage`, objectstack
 * `examples/app-showcase/src/ui/pages/new-project-wizard.page.ts`), its props
 * copied as it writes them with the comments dropped. Its lit control is the
 * spec's own page component, below.
 */
const SHOWCASE_WIZARD = {
  type: 'object-form',
  properties: {
    objectName: 'showcase_project',
    mode: 'create',
    formType: 'wizard',
    showStepIndicator: true,
    title: 'Create a Project',
    description: 'A three-step wizard — basics, health, then budget & schedule.',
    sections: [
      { label: 'Basics', description: 'Name the project and bind its account.', fields: ['name', 'account', 'owner'] },
      { label: 'Health', description: 'New projects start as Planned — how healthy is it today?', fields: ['health'] },
      { label: 'Budget & Schedule', description: 'Money and dates.', fields: ['budget', 'spent', 'start_date', 'end_date'] },
    ],
    submitBehavior: {
      kind: 'thank-you',
      title: 'Project created',
      message: 'Your new project is ready — find it in Projects, or reopen this wizard to start another.',
    },
  },
} as const;

/** The same block bound through the node's `dataSource`, the spec's per-element binding. */
const BOUND = {
  type: 'object-form',
  dataSource: { object: 'account' },
  properties: { mode: 'edit', recordId: 'a1', fields: ['name', 'rating'] },
} as const;

/** The flat spelling this batch retires. */
const FLAT = { type: 'object-form', objectName: 'account', mode: 'create' } as const;

type Issues = z.core.$ZodIssue[];

function issuesOf(result: { success: boolean; error?: { issues: Issues } }): Issues {
  if (result.success) throw new Error('expected a refusal, the document parsed');
  return result.error!.issues;
}

describe('object-form validates in the spec\'s `properties` bag (objectui#10859 batch 4)', () => {
  it.each([
    ['the objectstack showcase wizard node', SHOWCASE_WIZARD],
    ['the bare node', { type: 'object-form' }],
    ['a node bound through `dataSource`', BOUND],
  ] as const)('%s is accepted by safeValidateSchema and by the strict authoring face', (_label, doc) => {
    const tolerant = safeValidateSchema(doc);
    expect(tolerant.success, JSON.stringify(tolerant.success ? null : tolerant.error.issues)).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.success ? null : strict.error.issues)).toBe(true);
  });

  it('the fixtures are spec-valid by the spec\'s own page component and row (lit control)', () => {
    for (const doc of [SHOWCASE_WIZARD, BOUND]) {
      const r = SpecPageComponentSchema.safeParse(doc);
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
      expect(SpecObjectFormPropsSchema.safeParse(doc.properties).success).toBe(true);
    }
  });

  it('reaches the arm at a child slot too — a page holding the block', () => {
    expect(safeValidateSchema({ type: 'page', children: [SHOWCASE_WIZARD, BOUND] }).success).toBe(true);
  });
});

describe('the flat spelling is refused by name, with the bag member as the remedy (objectui#10859 batch 4)', () => {
  it('the spec\'s own page component refuses the flat node (lit control: the inherited reason holds)', () => {
    const issues = issuesOf(SpecPageComponentSchema.safeParse(FLAT));
    expect(issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect((issues[0] as { keys?: string[] }).keys).toEqual(['objectName', 'mode']);
  });

  it.each([
    ['safeValidateSchema', (doc: unknown) => safeValidateSchema(doc)],
    ['the strict authoring face', (doc: unknown) => StrictAnyComponentSchema.safeParse(doc)],
  ] as const)('%s refuses the flat node at each flat key, naming `properties.KEY`', (_face, parse) => {
    const issues = issuesOf(parse(FLAT));
    const byPath = new Map(issues.map((i) => [i.path.join('.'), i.message]));
    expect([...byPath.keys()].sort()).toEqual(['mode', 'objectName']);
    expect(byPath.get('objectName')).toContain('`objectName` → `properties.objectName`');
    expect(byPath.get('mode')).toContain('`mode` → `properties.mode`');
    // The prescription is the whole document shape, not only the path.
    expect(byPath.get('objectName')).toContain('"properties": {');
  });

  // Every member of the spec's row, read off the installed spec on each run —
  // not a transcribed list that could drift from it.
  const ROW_KEYS = Object.keys((SpecObjectFormPropsSchema as unknown as { shape: Record<string, unknown> }).shape);

  it('the row is non-trivial, so the per-key rows below are not vacuous', () => {
    expect(ROW_KEYS.length).toBeGreaterThan(30);
    expect(ROW_KEYS).toContain('objectName');
    // `description` is also a `BaseSchema` key; on this node the arm's refusal
    // wins, because the form's description is the row's member.
    expect(ROW_KEYS).toContain('description');
  });

  it.each(ROW_KEYS.map((key) => [key] as const))('a flat `%s` is refused on the tolerant face, by name', (key) => {
    const issues = issuesOf(safeValidateSchema({ type: 'object-form', [key]: true }));
    const issue = issues.find((i) => i.path.join('.') === key);
    expect(issue, JSON.stringify(issues)).toBeDefined();
    expect(issue!.message).toContain(`\`${key}\` → \`properties.${key}\``);
  });

  it('a flat key the row does not declare stays unjudged on the tolerant face and is refused on the strict face', () => {
    // The strictness control: this arm is `BaseSchema`, whose `.passthrough()`
    // every arm keeps, so an INVENTED key is not refused by the tolerant face.
    const doc = { type: 'object-form', inventedKey10859b4: true };
    expect(safeValidateSchema(doc).success).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success).toBe(false);
    if (strict.success) return;
    const issue = strict.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(['inventedKey10859b4']);
  });
});

describe('the bag is judged by the spec row (objectui#10859 batch 4)', () => {
  it('an undeclared key inside the bag is refused on the TOLERANT face, by name', () => {
    const issue = issuesOf(safeValidateSchema({ type: 'object-form', properties: { objectName: 'a', inventedKey10859b4: 1 } }))[0];
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['properties']);
    expect((issue as { keys?: string[] }).keys).toEqual(['inventedKey10859b4']);
  });

  it.each([
    // The spec retired both values in 17.5.0; the flat mirror still lists them.
    ['layout', { layout: 'grid' }, ['properties', 'layout'], 'invalid_value'],
    ['mode', { mode: 'delete' }, ['properties', 'mode'], 'invalid_value'],
    ['formType', { formType: 'stepper' }, ['properties', 'formType'], 'invalid_value'],
    ['columns', { columns: '2' }, ['properties', 'columns'], 'invalid_type'],
  ] as const)('a spec-invalid `%s` is refused at that member', (_key, bag, path, code) => {
    const issue = issuesOf(safeValidateSchema({ type: 'object-form', properties: bag }))[0];
    expect(issue.code).toBe(code);
    expect(issue.path).toEqual(path);
  });

  it('the bag is the spec row by reference, through the import boundary', () => {
    const bag = ObjectFormBlockSchema.shape.properties.unwrap();
    const keysOf = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();
    // The same members, read off the installed spec on every run.
    expect(keysOf(bag)).toEqual(keysOf(SpecObjectFormPropsSchema));
    // Since `@objectstack/spec` 17.7.0 the row reaches a spec default — its
    // `sections[].fields[]` take the page-block section shape, which carries
    // one — so the import boundary hands back its stripped derivation, not the
    // spec's own export (objectui#8317; re-measured at the bump, objectui#11717).
    // Through 17.6.0 the row carried none, and this line asserted the spec's
    // export came back untouched. The bag IS that derivation, memoised to one
    // crossing, and it answers every probe exactly as the spec does.
    const crossed = stripImportedDefaults(SpecObjectFormPropsSchema);
    expect(crossed).not.toBe(SpecObjectFormPropsSchema);
    expect(stripImportedDefaults(SpecObjectFormPropsSchema)).toBe(crossed);
    expect(bag).toBe(crossed);
    for (const probe of [
      {},
      { objectName: 'order', mode: 'create' },
      { inventedKey10859b4: 1 },
      { objectName: 7 },
      { recordId: 42 },
      { layout: 'inline' },
      { buttons: { submit: { show: false } } },
      { sections: [{ label: 'a', fields: ['x'] }], formType: 'wizard' },
    ]) {
      expect(bag.safeParse(probe).success, JSON.stringify(probe)).toBe(SpecObjectFormPropsSchema.safeParse(probe).success);
    }
  });

  it('`dataSource` is judged as the spec binding on both faces', () => {
    const adapterShaped = { type: 'object-form', dataSource: 'objectstack' };
    expect(safeValidateSchema(adapterShaped).success).toBe(false);
    expect(StrictAnyComponentSchema.safeParse(adapterShaped).success).toBe(false);
    expect(SpecElementDataSourceSchema.safeParse(BOUND.dataSource).success).toBe(true);
  });

  it.each(['onSuccess', 'onCancel', 'onError', 'onOpenChange', 'onStepChange'] as const)(
    'the runtime slot `%s` the renderer reads off the node stays refused by name (objectui#6124)',
    (key) => {
      const issue = issuesOf(safeValidateSchema({ type: 'object-form', [key]: { action: 'toast' } }))[0];
      expect(issue.path).toEqual([key]);
      expect(issue.message).toContain('RUNTIME SLOT');
    },
  );

  it.each(['body', 'children'] as const)('refuses the `%s` content channel by name (objectui#9256)', (key) => {
    const issue = issuesOf(safeValidateSchema({ type: 'object-form', [key]: [{ type: 'text', content: 'x' }] }))[0];
    expect(issue.path).toEqual([key]);
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('`object-form`');
  });
});

describe('the arm moved; the post-hoist mirror stayed (objectui#10859 batch 4)', () => {
  const literalsOf = (union: { options: readonly unknown[] }) =>
    union.options.map((arm) => (arm as { shape: { type: z.ZodLiteral<string> } }).shape.type.value);

  it('`object-form` is armed by the bag arm, not by the flat mirror', () => {
    expect(literalsOf(ObjectQLPublicBlockComponentSchema)).toContain('object-form');
    expect(literalsOf(ObjectQLComponentSchema)).not.toContain('object-form');
    expect(ObjectQLPublicBlockComponentSchema.options).toContain(ObjectFormBlockSchema);
  });

  it('the flat mirror is still published and still judges the post-hoist node', () => {
    // It is what `ObjectForm` reads after the hoist, and what the object-view
    // `form` slot is built from — neither is an authored `object-form` node.
    expect(ObjectFormSchema.safeParse(FLAT).success).toBe(true);
    expect(ObjectFormSchema.safeParse({ ...FLAT, recordId: 42 }).success).toBe(false);
    const slot = ObjectViewSchema.shape.form.unwrap();
    expect(slot.safeParse({ formType: 'tabbed', sections: [{ name: 's', fields: ['a'] }] }).success).toBe(true);
  });
});
