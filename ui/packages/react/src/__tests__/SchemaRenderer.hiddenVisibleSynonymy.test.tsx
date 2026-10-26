/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7088 — `BaseSchema.hidden` and `BaseSchema.visible` are ONE hide
 * path, and this file is the assertion that keeps that true.
 *
 * `base.ts` used to declare `hidden` as "rendered but not visible
 * (visibility: hidden)" while shipping the opposite: both keys converge on the
 * single `_hidden` flag set in `SchemaRenderer`'s `shouldHide` block, whose one
 * consumer is `if (evaluatedSchema._hidden) return null`. Nothing in the repo
 * emits a `visibility` style for either key, and by the time `_hidden` is read
 * the key that set it is no longer distinguishable.
 *
 * That wrong JSDoc was not harmless — it is the authority a later docs fix is
 * measured against, and it nearly took the schema-reference table down with it:
 * the row "Inverse of `visible`", the half telling the truth, was almost
 * "corrected" toward the declaration. The 2026-09-01 ruling on objectui#7088
 * fixed the comment and DECLINED the other direction: keeping the node and
 * emitting `visibility: hidden` is a behaviour change on a published prop with
 * zero named consumers, and needs a feature card that brings one.
 *
 * ⇒ If that differentiation is ever implemented, it must not land silently.
 * These two cases are what it trips over.
 *
 * Deliberately NOT re-pinned here — already covered, and a second copy is only a
 * second place to drift:
 *   • precedence — `SchemaRenderer.expressions.test.tsx` ("visible takes
 *     precedence over hidden") and `SchemaRenderer.hiddenDeclaredGate.test.tsx`
 *     (an EMPTY `visible` still wins the chain outright). Synonymous in OUTCOME
 *     is not synonymous in PRECEDENCE.
 *   • `hidden` being stripped from the forwarded DOM props, and an empty
 *     `hidden` not counting as a declared gate — both in
 *     `SchemaRenderer.hiddenDeclaredGate.test.tsx` (objectui#3955).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import type { BaseSchema } from '@object-ui/types';

/**
 * This file's registered probe, declared to `@object-ui/types` the way an
 * application declares a type it registers (objectui#11466): a node slot and
 * the `schema` prop take the declared node types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'probe-7088': BaseSchema;
  }
}

const Probe = () => <div data-testid="probe-7088" />;

describe('SchemaRenderer — `hidden: true` and `visible: false` are one hide path (objectui#7088)', () => {
  beforeEach(() => {
    ComponentRegistry.register('probe-7088', Probe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('probe-7088');
  });

  it('both keys produce the SAME rendered output — nothing', () => {
    const fromHidden = render(<SchemaRenderer schema={{ type: 'probe-7088', hidden: true }} />);
    const hiddenHtml = fromHidden.container.innerHTML;
    expect(screen.queryByTestId('probe-7088')).toBeNull();
    fromHidden.unmount();

    const fromVisible = render(<SchemaRenderer schema={{ type: 'probe-7088', visible: false }} />);
    const visibleHtml = fromVisible.container.innerHTML;
    expect(screen.queryByTestId('probe-7088')).toBeNull();

    // The claim the JSDoc now makes is not "both hide" — the two halves are
    // pinned separately in `SchemaRenderer.expressions.test.tsx` — it is that
    // both hide THE SAME WAY. Asserting the outputs against each other is the
    // part a differentiation breaks: one of them would stop being empty.
    expect(hiddenHtml).toBe(visibleHtml);
    expect(hiddenHtml).toBe('');
  });

  it('`hidden: true` keeps NO node in the tree, so nothing is left to carry `visibility: hidden`', () => {
    const { container } = render(<SchemaRenderer schema={{ type: 'probe-7088', hidden: true }} />);
    // The retracted promise, stated as the renderer makes it unreachable: not a
    // single element survives the render, so there is no node to style. An
    // implementation that kept the node and hid it visually would leave one
    // here, whatever style it chose.
    expect(container.querySelector('*')).toBeNull();
  });
});
