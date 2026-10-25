/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11440 — the `object-pivot` registration and its zod arm publish ONE
 * set of props.
 *
 * `@object-ui/types/zod`'s `ObjectPivotBlockSchema` builds its `properties` bag
 * from this registration's `inputs` (the spec has no `ComponentPropsMap` row
 * for the block). This file holds the two lists equal in both directions, so an
 * input added here without the arm, or a bag member added there without an
 * input, goes red. The one bag member that is not an input is the retired
 * `dataProvider` (objectui#7353), declared there only to refuse it by name;
 * the one input that is not a bag member is `dataSource`, the binding the
 * gate-wrapped registration publishes (objectui#6678), which the arm declares
 * on the NODE, as the spec's page component does.
 *
 * `drillDown` became an input in the same change: `ObjectPivotTable` reads it,
 * and the `pivot` node's refusal of `drillDown` names this block as where a
 * pivot drill is authored (objectui#10932).
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { ObjectPivotBlockSchema } from '@object-ui/types/zod';
// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import '../index';

const inputNames = (): string[] =>
  ((ComponentRegistry.getConfig('object-pivot', 'plugin-dashboard') as { inputs?: { name: string }[] } | undefined)
    ?.inputs ?? []).map((input) => input.name);

const bagKeys = (): string[] =>
  Object.keys((ObjectPivotBlockSchema.shape.properties as unknown as { shape: Record<string, unknown> }).shape);

describe('object-pivot — registration inputs and the arm\'s bag agree (objectui#11440)', () => {
  it('the registration resolves, with inputs (non-vacuity)', () => {
    expect(inputNames()).toContain('rowField');
    expect(inputNames().length).toBeGreaterThan(5);
  });

  it('every input but `dataSource` is a bag member, and every bag member but the retired `dataProvider` is an input', () => {
    expect(bagKeys().filter((key) => key !== 'dataProvider').sort())
      .toEqual(inputNames().filter((name) => name !== 'dataSource').sort());
  });

  it('`dataSource` is an input, and the arm declares it on the node beside the bag', () => {
    expect(inputNames()).toContain('dataSource');
    expect(Object.keys(ObjectPivotBlockSchema.shape)).toContain('dataSource');
    expect(bagKeys()).not.toContain('dataSource');
  });

  it('`drillDown` is published as an object input, and its description says `mode` does not apply', () => {
    const drill = (ComponentRegistry.getConfig('object-pivot', 'plugin-dashboard') as {
      inputs?: { name: string; type: string; description?: string }[];
    }).inputs?.find((input) => input.name === 'drillDown');
    expect(drill?.type).toBe('object');
    expect(drill?.description).toContain('`drillDown.mode` does not apply');
  });
});
