/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12192 — `RecordDetailsComponentProps.sections[]` mirrors the
 * `count` member `@objectstack/spec` 18 declares on a `record:details` section
 * (`count: { field }`, read by `RecordDetailsRenderer` to fill the heading's
 * `{{ count }}` hole).
 *
 * The section entry is a closed type, so before this mirror a spec-valid,
 * renderer-honoured section carrying `count` was refused by `tsc` alone
 * (TS2353). The compile-time half below is read by `tsc -p tsconfig.test.json`
 * (the last leg of this package's `type-check`) and by nothing else: vitest
 * strips types. The runtime half reads the INSTALLED spec, with a control in
 * each direction, so the mirror follows the contract rather than a memory of it.
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { RecordDetailsProps, SECTION_HEADING_COUNT_HOLE } from '@objectstack/spec/ui';
import { arrayElementSchema, listedShapeKeys, resolvePropsShape } from '@object-ui/test-support';
import type { RecordDetailsComponentProps } from '../record-components';

type Section = NonNullable<RecordDetailsComponentProps['sections']>[number];

/** The same entry on the spec's AUTHORING surface (`z.input`, not `z.output`). */
type SpecSection = NonNullable<z.input<typeof RecordDetailsProps>['sections']>[number];

/** Invariant type equality: neither `never` nor `any` reads as `true`. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type Expect<T extends true> = T;

// @ts-expect-error objectui#12192 — `Expect` must refuse `false`; widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

/** RED before objectui#12192 (`Property 'count' does not exist`), green after: the spec's own authoring type. */
type _Count = Expect<Equal<Section['count'], SpecSection['count']>>;

/** What an author writes: the heading with its hole, and the field it counts. */
const countedSection: Section = {
  name: 'tagging',
  label: '{{ count }} tags',
  count: { field: 'tags' },
  fields: ['tags'],
};

/** `count` is an object; the bare field name is not its spelling. */
const bareFieldRefused: RecordDetailsComponentProps = {
  sections: [
    {
      label: '{{ count }} tags',
      fields: ['tags'],
      // @ts-expect-error objectui#12192 — `count` is `{ field }`, not a field name.
      count: 'tags',
    },
  ],
};

const specSectionKeys = (): string[] =>
  listedShapeKeys(arrayElementSchema(resolvePropsShape(RecordDetailsProps)?.sections));

describe('record:details `sections[].count` mirrors the installed spec (objectui#12192)', () => {
  it('the installed spec declares `count` on the section entry, and exports the hole the renderer fills', () => {
    expect(specSectionKeys()).toContain('count');
    expect(SECTION_HEADING_COUNT_HOLE).toBeInstanceOf(RegExp);
    expect(SECTION_HEADING_COUNT_HOLE.test(String(countedSection.label))).toBe(true);
  });

  it('control A — the counted section parses with no issues, and `count` survives the parse', () => {
    const parsed = RecordDetailsProps.safeParse({ sections: [countedSection] });
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.data?.sections?.[0]).toMatchObject({ count: { field: 'tags' } });
  });

  it('control B — the same section without a hole in its heading is refused at `sections.0.label`', () => {
    const parsed = RecordDetailsProps.safeParse({
      sections: [{ ...countedSection, label: 'Tags' }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => [i.code, i.path.join('.')])).toContainEqual([
      'custom',
      'sections.0.label',
    ]);
  });

  it('keeps the compile-time literals alive at runtime', () => {
    expect(countedSection.count).toEqual({ field: 'tags' });
    expect(bareFieldRefused.sections).toHaveLength(1);
  });
});
