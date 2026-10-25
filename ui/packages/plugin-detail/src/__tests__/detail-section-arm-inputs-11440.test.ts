/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11440 — the `detail-section` registration, the fold
 * `DetailSectionNode` performs, and the node's zod arm name ONE set of keys.
 *
 * `DETAIL_SECTION_NODE_INPUTS` is already pinned equal to the registration's
 * declared inputs (`detailSectionAuthoredNode-8626.test.tsx`). This file adds
 * the third face: `@object-ui/types/zod`'s `DetailSectionNodeSchema` declares
 * exactly those keys as the node's own members (beside `type`, the two
 * content-channel refusals and the `BaseSchema` envelope), so an input added
 * here without the arm goes red.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { BaseSchema, DetailSectionNodeSchema } from '@object-ui/types/zod';
import { DETAIL_SECTION_NODE_INPUTS } from '../DetailSectionNode';
// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import '../index';

const inputNames = (): string[] =>
  ((ComponentRegistry.getConfig('detail-section', 'plugin-detail') as { inputs?: { name: string }[] } | undefined)
    ?.inputs ?? []).map((input) => input.name);

/** The arm's own members: everything but `type`, the channel refusals, and base keys it does not redeclare. */
const armMembers = (): string[] => {
  const base = new Set(Object.keys(BaseSchema.shape));
  return Object.keys(DetailSectionNodeSchema.shape).filter(
    (key) => !['type', 'body', 'children'].includes(key)
      && (!base.has(key) || DetailSectionNodeSchema.shape[key as keyof typeof DetailSectionNodeSchema.shape] !== BaseSchema.shape[key as keyof typeof BaseSchema.shape]),
  );
};

describe('detail-section — registration, fold and arm agree (objectui#11440)', () => {
  it('the registration resolves, with inputs (non-vacuity)', () => {
    expect(inputNames()).toContain('fields');
  });

  it('the arm declares exactly the registration\'s inputs, which are exactly the folded names', () => {
    expect(armMembers().sort()).toEqual([...inputNames()].sort());
    expect([...DETAIL_SECTION_NODE_INPUTS].sort()).toEqual([...inputNames()].sort());
  });
});
