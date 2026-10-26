/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11440 — the `embeddable-form` registration and its zod arm publish
 * ONE set of props.
 *
 * `@object-ui/types/zod`'s `EmbeddableFormBlockSchema` builds its `properties`
 * bag from exactly this registration's `inputs` (the spec has no
 * `ComponentPropsMap` row for the block). The arm requires `formId` always,
 * and `objectName` unless the node's `dataSource.object` names the object
 * (the registration is gate-wrapped). The registration requires `formId` only
 * (objectui#11605): its `required` is what the page compile reads, and the
 * compile has no "this key or that binding" form.
 * This file holds the two lists equal in both directions. The one input that
 * is not a bag member is `dataSource`, the binding the gate-wrapped
 * registration publishes (objectui#6678), which the arm declares on the NODE.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { EmbeddableFormBlockSchema } from '@object-ui/types/zod';
// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import '../index';

type Input = { name: string; required?: boolean };

const inputs = (): Input[] =>
  ((ComponentRegistry.getConfig('embeddable-form', 'plugin-form') as { inputs?: Input[] } | undefined)?.inputs ?? []);

const bag = (): Record<string, { isOptional: () => boolean }> =>
  (EmbeddableFormBlockSchema.shape.properties as unknown as { shape: Record<string, { isOptional: () => boolean }> }).shape;

describe('embeddable-form — registration inputs and the arm\'s bag agree (objectui#11440)', () => {
  it('the registration resolves, with inputs (non-vacuity)', () => {
    expect(inputs().map((input) => input.name)).toContain('formId');
  });

  it('the bag members are exactly the input names but `dataSource`, which the arm declares on the node', () => {
    const names = inputs().map((input) => input.name);
    expect(Object.keys(bag()).sort()).toEqual(names.filter((name) => name !== 'dataSource').sort());
    expect(names).toContain('dataSource');
    expect(Object.keys(EmbeddableFormBlockSchema.shape)).toContain('dataSource');
  });

  it('`formId` is required on both; `objectName` is required on neither, because the binding can supply it', () => {
    const required = inputs().filter((input) => input.required).map((input) => input.name).sort();
    // `objectName` left this list with objectui#11605: the page compile reads
    // it, and `required: true` refused a node whose `dataSource.object` names
    // the object.
    expect(required).toEqual(['formId']);
    expect(bag().formId.isOptional()).toBe(false);
    // The arm keeps `objectName` omissible as a member and enforces it with
    // `requireRecordSource` unless `dataSource.object` is present.
    expect(bag().objectName.isOptional()).toBe(true);
  });
});
