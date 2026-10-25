/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12242 (maintainer ruling A) — `mobile_fullscreen` moved off the
 * field metadata types onto `LongTextCarrierHandoff`, where its producer and
 * its consumers meet. This file carries forward what
 * `packages/types/src/__tests__/field-metadata-mobile-fullscreen.test.ts` pinned
 * for objectui#3245, whose premise the ruling reverses: the flag still has ONE
 * carrier, the widget's `field`, but it is no longer declared on the authoring
 * face `BaseFieldMetadata`.
 *
 *  - The hand-off declares it as an optional boolean, not `any`.
 *  - The authoring face refuses it on a fresh literal: `@objectstack/spec`'s
 *    `FieldSchema` refuses it by name, so no published object carries it.
 *  - The carrier shape `ObjectForm` produces (the long-text metadata plus the
 *    stamped flag) compiles against the hand-off and is a valid `field`.
 *  - The widget still reads it: the expand affordance appears with the flag
 *    and not without it. Behaviour is unchanged.
 *
 * The compile-time rows run under this package's `type-check`
 * (`tsc -p tsconfig.test.json`).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { FieldMetadata, TextareaFieldMetadata } from '@object-ui/types';

import { TextAreaField } from '../TextAreaField';
import type { LongTextCarrierHandoff } from '../longTextCarrierHandoff';

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

export type assertionHandoffMember = [
  Expect<Equal<IsAny<LongTextCarrierHandoff['mobile_fullscreen']>, false>>,
  Expect<Equal<LongTextCarrierHandoff['mobile_fullscreen'], boolean | undefined>>,
];

/** The authoring face refuses the key on a fresh literal. */
export const _authored: TextareaFieldMetadata = {
  type: 'textarea',
  name: 'body',
  // @ts-expect-error — objectui#12242: `mobile_fullscreen` is host-written; it lives on `LongTextCarrierHandoff`
  mobile_fullscreen: true,
};

/** The exact carrier `ObjectForm` produces: the long-text metadata plus the stamped flag. */
const stamped: TextareaFieldMetadata & LongTextCarrierHandoff = {
  type: 'textarea',
  name: 'body',
  label: 'Body',
  mobile_fullscreen: true,
};

/** The control: the same metadata, not stamped. */
const plain: TextareaFieldMetadata & LongTextCarrierHandoff = { type: 'textarea', name: 'body', label: 'Body' };

describe('mobile_fullscreen rides the long-text carrier hand-off (objectui#12242)', () => {
  it('the stamped carrier is a valid widget `field`, and the widget draws the expand affordance', () => {
    const field: FieldMetadata = stamped;
    render(<TextAreaField value="hello" onChange={() => {}} field={field} />);
    expect(screen.getByTestId('textarea-fullscreen-toggle')).toBeInTheDocument();
  });

  it('CONTROL — without the flag there is no affordance', () => {
    render(<TextAreaField value="hello" onChange={() => {}} field={plain} />);
    expect(screen.queryByTestId('textarea-fullscreen-toggle')).not.toBeInTheDocument();
    expect('mobile_fullscreen' in plain).toBe(false);
  });
});
