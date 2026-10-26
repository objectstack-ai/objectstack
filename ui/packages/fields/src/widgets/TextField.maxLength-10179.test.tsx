// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10179: the shared `TextField` honours the spec-declared
 * `FieldSchema.maxLength` on the element it renders.
 *
 * `toDomProps` forwards no `maxLength`, so a host has no prop through which a
 * ceiling could reach the input; the widget's own read of its field metadata is
 * the only channel. Both render branches are pinned (the single-line input, and
 * the multi-line textarea when `rows > 1`), each with a CONTROL that declares no
 * ceiling and must render no attribute, so "renders a maxlength" cannot pass
 * on a widget that caps every input at a number of its own choosing.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TextField } from './TextField';

afterEach(cleanup);

const noop = () => {};

describe('TextField renders the declared maxLength (objectui#10179)', () => {
  it('puts `maxlength` on the single-line input', () => {
    const { container } = render(
      <TextField value="" onChange={noop} field={{ name: 'title', type: 'text', maxLength: 40 } as never} />,
    );
    expect(container.querySelector('input')).toHaveAttribute('maxlength', '40');
  });

  it('CONTROL: no declared maxLength, no attribute on the input', () => {
    const { container } = render(
      <TextField value="" onChange={noop} field={{ name: 'title', type: 'text' } as never} />,
    );
    expect(container.querySelector('input')).not.toHaveAttribute('maxlength');
  });

  it('puts `maxlength` on the multi-line branch too (`rows > 1`)', () => {
    const { container } = render(
      <TextField value="" onChange={noop} field={{ name: 'notes', type: 'text', rows: 3, maxLength: 120 } as never} />,
    );
    expect(container.querySelector('textarea')).toHaveAttribute('maxlength', '120');
  });

  it('CONTROL: the multi-line branch with no declared maxLength has no attribute', () => {
    const { container } = render(
      <TextField value="" onChange={noop} field={{ name: 'notes', type: 'text', rows: 3 } as never} />,
    );
    expect(container.querySelector('textarea')).not.toHaveAttribute('maxlength');
  });
});
