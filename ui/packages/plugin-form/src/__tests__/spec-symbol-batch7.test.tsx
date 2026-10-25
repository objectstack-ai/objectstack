/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-form` ↔ `@objectstack/spec` symbol-collision guard
 * (objectui#3161, objectstack#4115 ledger batch 7).
 *
 * `FormSection` → `FormSectionContainer`, and this is the batch's one
 * deliberate DIVERGENCE from batch 6's `ListView` / `UserFilters` exemption, so
 * the reasoning is pinned rather than left in a commit message.
 *
 * The batch-5/6 criterion is not "components are exempt" (batch 5 renamed
 * `Field` → `FieldContainer`); it is: does this declaration state a shape the
 * next session would read as canonical for the spec's? `ListViewProps.schema`
 * takes the spec-derived metadata as ONE prop, so that renderer states nothing.
 * `FormSectionContainerProps` takes the same metadata FLATTENED into individual
 * props — a second vocabulary for `label` / `description` / `collapsible` /
 * `collapsed` / `columns`, minus `fields`, `name`, `pane` and `visibleWhen` —
 * which is precisely a rival shape. The assertions below state both halves: the
 * spec's `FormSection` is the authored document, and these props are not it.
 */

import { describe, it, expect } from 'vitest';
import type { FormSection as SpecFormSection, FormSectionSchema as SpecFormSectionSchema } from '@objectstack/spec/ui';

import { FormSectionContainer } from '../FormSection';
import type { FormSectionContainerProps } from '../FormSection';

describe('the renamed export is still the component it was', () => {
  it('exports a React component under the new name', () => {
    expect(typeof FormSectionContainer).toBe('function');
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins — compiled by tsconfig.test.json, chained off             */
/* "type-check" (objectui#4291 retired the narrow project that named this      */
/* file alone, once the package left TEST_DEBT in objectui#4040).              */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

/** What `FormSectionSchema.parse()` ACCEPTS — the authoring side. */
type SpecFormSectionInput = (typeof SpecFormSectionSchema)['_zod']['input'];

describe('the spec FormSection is the authored section, these props are the chrome', () => {
  it('is pinned at compile time', () => {
    type _SpecIsReal = Assert<Equal<IsAny<SpecFormSection>, false>>;

    // The authored document carries the fields; the container takes children.
    type _AuthoredCarriesFields = Assert<HasKey<SpecFormSection, 'fields'>>;
    type _ContainerTakesChildren = Assert<HasKey<FormSectionContainerProps, 'children'>>;
    type _ContainerHasNoFields = Assert<Equal<HasKey<FormSectionContainerProps, 'fields'>, false>>;
    type _NotTheSameShape = Assert<Equal<Extends<SpecFormSection, FormSectionContainerProps>, false>>;

    // Why `columns` is NOT bound to the spec's key even though the words match:
    // the authored side accepts the STRING forms and normalises them in the
    // schema's own pipe, while `gridCols` here is indexed by number. Binding it
    // would hand this component a `'2'` and silently render one column. If the
    // spec ever drops the string forms, this pin fails and the key becomes
    // bindable — which is the outcome we want to be told about.
    type _AuthoredAcceptsStringColumns = Assert<Extends<'2', NonNullable<SpecFormSectionInput['columns']>>>;
    type _ContainerDoesNot = Assert<Equal<Extends<'2', NonNullable<FormSectionContainerProps['columns']>>, false>>;

    expect(true).toBe(true);
  });
});
