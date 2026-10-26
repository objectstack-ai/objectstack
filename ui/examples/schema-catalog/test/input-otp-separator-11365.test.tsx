/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11365 — `input-otp` draws the separator its docs page and two
 * catalog entries author.
 *
 * The docs page's "With Separator" section shows
 * `components-form-input-otp/with-visual-separator`, and
 * `components-form-input-otp/verification-form` authors the same key on an
 * `input-otp` nested in a `flex` node's `properties` bag. Before this card no
 * type declared `separator` on `InputOTPSchema` and the renderer read nothing
 * for it, so both entries rendered ZERO `role="separator"` elements through the
 * real `SchemaRenderer`. Triage ruled the enforce arm (ADR-0049): declare the
 * key on both faces and draw the primitive's `InputOTPSeparator`.
 *
 * ## What each block pins
 *
 *  - The render block counts the `role="separator"` elements the renderer
 *    actually emitted, on the two authoring entries and on the entry that does
 *    NOT author the key (the control: without `separator` nothing changes).
 *  - The parse block asks both faces. `safeValidateSchema` is `.passthrough()`,
 *    so a green there says nothing about an UNDECLARED key; the strict authoring
 *    face closes unknown keys, so a green there is the declaration's evidence.
 *    The value probe (a non-boolean `separator`) is what proves the declared
 *    member judges its value rather than merely being tolerated.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
// Module scope, not a hook: registering the renderers is an unbounded module
// load (AGENTS.md, test discipline — flaky tests: find the race).
import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { safeValidateSchema, StrictAnyComponentSchema } from '@object-ui/types/zod';
import { getExample } from '../src/index.js';

const AUTHORING = [
  'components-form-input-otp/with-visual-separator',
  'components-form-input-otp/verification-form',
] as const;

/** Every issue as `code path: message`, so a red run says what broke. */
function issuesOf(result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } }): string[] {
  return result.success || !result.error
    ? []
    : result.error.issues.map((i) => `${i.code} ${i.path.map(String).join('.')}: ${i.message}`);
}

function renderNode(schema: unknown): HTMLElement {
  const { container } = render(<SchemaRenderer schema={toRenderableSchema(schema as never) as never} />);
  return container;
}

/**
 * The slot count of each `InputOTPGroup`, in document order. The container's
 * other children are the separator and the library's own wrapper around the
 * hidden `<input>`, which is not a group.
 */
function groupSizes(container: HTMLElement): number[] {
  const host = container.querySelector('[data-input-otp-container]');
  expect(host, 'no input-otp container rendered: nothing below would be a reading').not.toBeNull();
  return Array.from((host as Element).children)
    .filter((el) => el.getAttribute('role') !== 'separator' && !el.querySelector('input'))
    .map((group) => group.children.length);
}

describe('objectui#11365 — the authored `separator` draws one InputOTPSeparator', () => {
  it.each(AUTHORING)('%s renders exactly one role="separator"', (id) => {
    const container = renderNode(getExample(id).schema);
    expect(container.querySelector('[data-input-otp-container]'), 'no input-otp rendered').not.toBeNull();
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it('the separator splits the six slots at the midpoint, between two groups', () => {
    const container = renderNode(getExample('components-form-input-otp/with-visual-separator').schema);
    expect(groupSizes(container)).toEqual([3, 3]);
  });

  it('an odd `length` puts the extra slot in the first group; one slot draws no separator', () => {
    const five = renderNode({ type: 'input-otp', length: 5, separator: true });
    expect(groupSizes(five)).toEqual([3, 2]);
    expect(five.querySelectorAll('[role="separator"]')).toHaveLength(1);

    const one = renderNode({ type: 'input-otp', length: 1, separator: true });
    expect(groupSizes(one)).toEqual([1]);
    expect(one.querySelectorAll('[role="separator"]')).toHaveLength(0);
  });

  it('the control: the entry without `separator` draws none, in one group', () => {
    const container = renderNode(getExample('components-form-input-otp/6-digit-otp').schema);
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(0);
    expect(groupSizes(container)).toEqual([6]);
  });

  it('the registration publishes `separator` as a boolean input', () => {
    // `inputs` is the html/jsx page tier's prop whitelist: without this row,
    // `separator` on an `input-otp` tag draws an `unknown-prop` warning on a
    // key the renderer honours (measured once on objectui#11365's PR).
    const inputs = ComponentRegistry.getMeta('input-otp')?.inputs ?? [];
    expect(inputs.filter((i) => i.name === 'separator')).toEqual([
      expect.objectContaining({ name: 'separator', type: 'boolean' }),
    ]);
  });

  it('`separator: false` renders the same markup as no `separator` at all', () => {
    const absent = renderNode({ type: 'input-otp', length: 6 }).innerHTML;
    const off = renderNode({ type: 'input-otp', length: 6, separator: false }).innerHTML;
    expect(off).toBe(absent);
  });
});

describe('objectui#11365 — both authoring entries validate, on both faces', () => {
  it.each(AUTHORING)('%s validates under safeValidateSchema', (id) => {
    expect(issuesOf(safeValidateSchema(getExample(id).schema))).toEqual([]);
  });

  it.each(AUTHORING)('%s validates under the strict authoring face (no unrecognized `separator`)', (id) => {
    expect(issuesOf(StrictAnyComponentSchema.safeParse(getExample(id).schema))).toEqual([]);
  });

  it('a non-boolean `separator` is refused by value, at its path, in a bag child too', () => {
    // Counter-probe: a passthrough hole would accept this; a declared boolean
    // member refuses it with `invalid_type` at the key.
    const flat = safeValidateSchema({ type: 'input-otp', separator: 'yes' });
    expect(issuesOf(flat).map((s) => s.split(':')[0])).toEqual(['invalid_type separator']);

    const nested = safeValidateSchema({
      type: 'flex',
      properties: { children: [{ type: 'input-otp', separator: 'yes' }] },
    });
    expect(nested.success).toBe(false);
    expect(issuesOf(nested).map((s) => s.split(':')[0])).toEqual(['invalid_type properties.children.0.separator']);
  });
});
