/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12548 — the col-span classes the form renderer emits for a
 * twelfths `colSpan` on a 12-track field container.
 *
 * `plugin-form` draws a sectioned form whose sections' `columns` counts do not
 * all fit one 1–4 grid on `grid gap-4 grid-cols-1 @md:grid-cols-12`, with
 * each field's `colSpan` in twelfths of the row (12 / 6 / 4 / 3 for a
 * 1 / 2 / 3 / 4-column section). This file pins the emission itself; the
 * cross-layer leg, per host, is
 * `plugin-form/src/__tests__/mixedSectionColumns-12548.test.tsx`. The
 * container class is written out as a literal for the reason the 9244 sibling
 * gives: components must not depend on plugin-form.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import '../../../renderers';

afterEach(() => cleanup());

const TWELVE = 'grid gap-4 grid-cols-1 @md:grid-cols-12';

function spanClasses(colSpan: number | undefined, fieldContainerClass: string): string[] {
  cleanup();
  const Form = ComponentRegistry.get('form')!;
  render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: false,
        showCancel: false,
        fieldContainerClass,
        fields: [{ name: 'f', label: 'F', type: 'input', ...(colSpan ? { colSpan } : {}) }],
      }}
    />,
  );
  const cell = document.body.querySelector('[data-field="f"]');
  if (!cell) throw new Error('field not rendered: f');
  return (cell.getAttribute('class') || '').split(/\s+/).filter((t) => /(^|:)col-span-/.test(t));
}

describe('objectui#12548 — twelfths on a 12-track container keep each count’s step ladder', () => {
  it('a whole row (1 per row) is 12 from @md', () => {
    expect(spanClasses(12, TWELVE)).toEqual(['@md:col-span-12']);
  });

  it('2 per row is 6 from @md', () => {
    expect(spanClasses(6, TWELVE)).toEqual(['@md:col-span-6']);
  });

  it('3 per row reads 2 at @md and 3 from @2xl', () => {
    expect(spanClasses(4, TWELVE)).toEqual(['@md:col-span-6', '@2xl:col-span-4']);
  });

  it('4 per row reads 2 at @md, 3 at @2xl and 4 from @4xl', () => {
    expect(spanClasses(3, TWELVE)).toEqual(['@md:col-span-6', '@2xl:col-span-4', '@4xl:col-span-3']);
  });

  it('2 of 3 and 3 of 4 take the row until their count fits', () => {
    expect(spanClasses(8, TWELVE)).toEqual(['@md:col-span-12', '@2xl:col-span-8']);
    expect(spanClasses(9, TWELVE)).toEqual(['@md:col-span-12', '@4xl:col-span-9']);
  });

  it('clamps an oversized colSpan to the row, and leaves an unset one at one track', () => {
    expect(spanClasses(20, TWELVE)).toEqual(['@md:col-span-12']);
    expect(spanClasses(undefined, TWELVE)).toEqual([]);
  });

  it('CONTROL: the 1–4 containers emit what they always did', () => {
    const three = 'grid gap-4 grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3';
    expect(spanClasses(3, three)).toEqual(['@md:col-span-2', '@2xl:col-span-3']);
    expect(spanClasses(6, three)).toEqual(['@md:col-span-2', '@2xl:col-span-3']);
    expect(spanClasses(2, three)).toEqual(['@md:col-span-2']);
  });
});
