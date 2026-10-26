/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11440 — the `app-schema-renderer` registration and its zod arm.
 *
 * `@object-ui/types/zod`'s `AppSchemaRendererNodeSchema` declares
 * `mobileNavMode` (the same two-value enum) and `basePath` (a string), each as
 * the registration types it.
 *
 * The third input, `schema`, moved out of this file ON PURPOSE (objectui#11494,
 * triage ruling A `5958227972`). This file measured that no node delivered it:
 * `SchemaRenderer` hands a registered component the NODE as its `schema` prop,
 * so navigation nested under `schema` drew nothing, and the same navigation on
 * the node drew. The registration now goes through an adapter that hands
 * `node.schema` to `AppSchemaRenderer`, and the arm declares `schema` as the
 * app document by reference, so that row inverted: the nested document draws
 * and the flat one does not. Its rows are
 * `app-schema-renderer-schema-input-11494.test.tsx`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { AppSchemaRendererNodeSchema } from '@object-ui/types/zod';
import { registerLayout } from '../index';

beforeAll(() => {
  registerLayout();
});

type Input = { name: string; type: string; enum?: unknown[] };

const inputs = (): Input[] =>
  ((ComponentRegistry.getConfig('app-schema-renderer', 'layout') as { inputs?: Input[] } | undefined)?.inputs ?? []);

describe('app-schema-renderer — registration inputs and the arm (objectui#11440)', () => {
  it('`mobileNavMode`: the arm\'s enum is the registration\'s enum', () => {
    const declared = inputs().find((input) => input.name === 'mobileNavMode');
    const arm = (AppSchemaRendererNodeSchema.shape.mobileNavMode as unknown as { unwrap: () => { options: string[] } }).unwrap();
    expect(declared?.type).toBe('enum');
    expect([...arm.options].sort()).toEqual([...(declared?.enum as string[])].sort());
  });

  it('`basePath` is a string input on both', () => {
    expect(inputs().find((input) => input.name === 'basePath')?.type).toBe('string');
    expect(AppSchemaRendererNodeSchema.shape.basePath.safeParse('/apps/crm').success).toBe(true);
    expect(AppSchemaRendererNodeSchema.shape.basePath.safeParse(7).success).toBe(false);
  });
});
