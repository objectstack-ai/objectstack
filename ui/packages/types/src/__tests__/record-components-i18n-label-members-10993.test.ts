// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10993 (batch 4) — the `I18nLabel` members of the `record:*` props
 * types in `record-components.ts`, held to the INSTALLED spec's own types.
 *
 * `@objectstack/spec` types four label positions on these blocks as
 * `I18nLabel` — a plain string or an inline per-locale map such as
 * `{ en: 'Overview', 'zh-CN': '概览' }`:
 *
 *   - `RecordDetailsProps.sections[].label`
 *   - `RecordRelatedListProps.title`
 *   - `RecordRelatedListProps.add.label`
 *   - `RecordPathProps.stages[].label`
 *
 * This package typed all four `string`: a NARROWING, so a spec-valid document
 * compiled nowhere a TypeScript author wrote it, while the contract parsed it
 * and the renderers resolved it (`@object-ui/plugin-detail`'s
 * `record-path.stageLabelI18nLabel-10993`, `record-related-list.titleI18nLabel-10993`
 * and `record-blocks.nestedLabelsI18nLabel-10993` pins render the map).
 *
 * ## What is pinned, and against what
 *
 * Each type assertion compares this face's member with the SAME position in
 * the spec's `z.input` type, read off the installed `@objectstack/spec/ui`
 * rather than restated (AGENTS.md #9), so a spec release that moves one of
 * these positions moves this file with it. They are checked by this package's
 * `tsconfig.test.json` and fail to compile if a member is narrowed back to
 * `string` or widened past the spec's type. The `@ts-expect-error` literals
 * keep the one arm the contract still refuses — a number — refused here.
 *
 * The runtime rows re-measure the premise on the live spec schemas: the map
 * parses at each position and a number is refused AT that position, so the
 * type assertions cannot go on agreeing with a contract that has changed.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { RecordDetailsProps, RecordPathProps, RecordRelatedListProps } from '@objectstack/spec/ui';
import type {
  RecordDetailsComponentProps,
  RecordPathComponentProps,
  RecordRelatedListComponentProps,
} from '../record-components';
import type { I18nLabel } from '../index';

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type SpecDetails = z.input<typeof RecordDetailsProps>;
type SpecRelatedList = z.input<typeof RecordRelatedListProps>;
type SpecPath = z.input<typeof RecordPathProps>;

type Section = NonNullable<RecordDetailsComponentProps['sections']>[number];
type SpecSection = NonNullable<SpecDetails['sections']>[number];
type Add = NonNullable<RecordRelatedListComponentProps['add']>;
type SpecAdd = NonNullable<SpecRelatedList['add']>;
type Stage = RecordPathComponentProps['stages'][number];
type SpecStage = NonNullable<SpecPath['stages']>[number];

export type assertionRecordLabelMembersAreTheSpecsType = [
  Expect<Equal<Section['label'], SpecSection['label']>>,
  Expect<Equal<RecordRelatedListComponentProps['title'], SpecRelatedList['title']>>,
  Expect<Equal<Add['label'], SpecAdd['label']>>,
  Expect<Equal<Stage['label'], SpecStage['label']>>,
];

/** And the spec's type at those positions is `I18nLabel` itself. */
export type assertionRecordLabelMembersAreI18nLabel = [
  Expect<Equal<Section['label'], I18nLabel | undefined>>,
  Expect<Equal<RecordRelatedListComponentProps['title'], I18nLabel | undefined>>,
  Expect<Equal<Add['label'], I18nLabel | undefined>>,
  Expect<Equal<Stage['label'], I18nLabel>>,
];

/** `en` first, as in the render pins. */
const MAP = { en: 'Overview', 'zh-CN': '概览' };

/** What a TypeScript author writes from the spec's own example compiles. */
export const mapsCompile: [RecordDetailsComponentProps, RecordRelatedListComponentProps, RecordPathComponentProps] = [
  { sections: [{ label: MAP, fields: ['name'] }] },
  { objectName: 'task', relationshipField: 'account_id', title: MAP, add: { picker: { object: 'task' }, label: MAP } },
  { statusField: 'stage', stages: [{ value: 'new', label: MAP }] },
];

/** The arm the contract refuses stays refused on this face. */
export const numbersRefused: [RecordDetailsComponentProps, RecordRelatedListComponentProps, RecordPathComponentProps] = [
  // @ts-expect-error objectui#10993 — `sections[].label` is `I18nLabel`, never a number.
  { sections: [{ label: 42, fields: ['name'] }] },
  // @ts-expect-error objectui#10993 — `title` is `I18nLabel`, never a number.
  { objectName: 'task', relationshipField: 'account_id', title: 42 },
  // @ts-expect-error objectui#10993 — `stages[].label` is `I18nLabel`, never a number.
  { statusField: 'stage', stages: [{ value: 'new', label: 42 }] },
];

/** One row per position: the spec schema, a document builder, and the member's path. */
const POSITIONS = [
  {
    name: 'record:details sections[].label',
    schema: RecordDetailsProps,
    doc: (label: unknown) => ({ sections: [{ label, fields: ['name'] }] }),
    path: 'sections.0.label',
  },
  {
    name: 'record:related_list title',
    schema: RecordRelatedListProps,
    doc: (title: unknown) => ({ objectName: 'task', relationshipField: 'account_id', title }),
    path: 'title',
  },
  {
    name: 'record:related_list add.label',
    schema: RecordRelatedListProps,
    doc: (label: unknown) => ({ objectName: 'task', relationshipField: 'account_id', add: { picker: { object: 'task' }, label } }),
    path: 'add.label',
  },
  {
    name: 'record:path stages[].label',
    schema: RecordPathProps,
    doc: (label: unknown) => ({ statusField: 'stage', stages: [{ value: 'new', label }] }),
    path: 'stages.0.label',
  },
] as const;

describe('record-components — the I18nLabel members, against the installed spec (objectui#10993)', () => {
  it.each(POSITIONS)('PREMISE: the spec parses a locale map at $name', ({ schema, doc }) => {
    const parsed = schema.safeParse(doc(MAP));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it.each(POSITIONS)('CONTROL: the spec parses a plain string at $name', ({ schema, doc }) => {
    expect(schema.safeParse(doc('Overview')).success).toBe(true);
  });

  it.each(POSITIONS)('CONTROL: the spec refuses a number AT $name', ({ schema, doc, path }) => {
    const parsed = schema.safeParse(doc(42));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toEqual([path]);
  });
});
