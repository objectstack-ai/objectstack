/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#10859 batch 4 — an `object-form` node authored in the spec's
 * `properties` bag RENDERS, through the real registry.
 *
 * `@object-ui/types` now arms an authored `object-form` from the spec's
 * `ComponentPropsMap['object-form']` row (`ObjectFormBlockSchema`) and refuses
 * the flat spelling by name. That is only sound if nothing is lost at render
 * time: `SchemaRenderer` hoists every `properties` key onto the node before the
 * registered renderer runs, so `ObjectForm` reads the bag node as it reads the
 * flat one. This file draws the objectstack showcase's wizard node (the one live
 * spec-shaped producer) and holds the flat spelling beside it, because code
 * still composes flat nodes (`ObjectView`, `RecordFormPage`, `ScreenView`, …)
 * and those must keep rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module-scope side-effect imports: the registry must hold `object-form` and the
// field widgets it renders into before the first render (AGENTS.md §测试纪律).
import '@object-ui/components';
import '@object-ui/fields';
import '../index';

const PROJECT_SCHEMA = {
  name: 'showcase_project',
  label: 'Project',
  fields: {
    name: { name: 'name', type: 'text', label: 'Project Name' },
    health: { name: 'health', type: 'text', label: 'Health' },
    budget: { name: 'budget', type: 'number', label: 'Budget' },
  },
};

/** The showcase wizard's props (objectstack `NewProjectWizardPage`), trimmed to this object's fields. */
const WIZARD_PROPS = {
  objectName: 'showcase_project',
  mode: 'create',
  formType: 'wizard',
  showStepIndicator: true,
  title: 'Create a Project',
  sections: [
    { label: 'Basics', fields: ['name'] },
    { label: 'Health', fields: ['health'] },
    { label: 'Budget & Schedule', fields: ['budget'] },
  ],
  submitBehavior: { kind: 'thank-you', title: 'Project created' },
};

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(PROJECT_SCHEMA),
  };
}

type ProviderDataSource = React.ComponentProps<typeof SchemaRendererProvider>['dataSource'];
type RenderedSchema = React.ComponentProps<typeof SchemaRenderer>['schema'];

const draw = (schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) =>
  render(
    <SchemaRendererProvider dataSource={adapter as unknown as ProviderDataSource}>
      <SchemaRenderer schema={schema as unknown as RenderedSchema} />
    </SchemaRendererProvider>,
  );

/** What a wizard shows once its object resolved: the step labels and the first step's field. */
async function drawnWizard(schema: Record<string, unknown>) {
  const adapter = makeAdapter();
  const { container } = draw(schema, adapter);
  await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('showcase_project'));
  await waitFor(() => expect(container.querySelector('input[name="name"]')).not.toBeNull());
  const text = container.textContent ?? '';
  return {
    steps: ['Basics', 'Health', 'Budget & Schedule'].filter((label) => text.includes(label)),
    firstStepField: text.includes('Project Name'),
    laterStepFieldMounted: container.querySelector('input[name="budget"]') !== null,
  };
}

beforeEach(() => cleanup());

describe('object-form in the `properties` bag renders through the registry (objectui#10859 batch 4)', () => {
  it('the showcase wizard node draws its steps over the named object', async () => {
    const bag = await drawnWizard({ type: 'object-form', properties: WIZARD_PROPS });
    expect(bag).toEqual({ steps: ['Basics', 'Health', 'Budget & Schedule'], firstStepField: true, laterStepFieldMounted: false });
  });

  it('the flat spelling a code composer builds draws the same wizard (the hoist reads both)', async () => {
    const bag = await drawnWizard({ type: 'object-form', properties: WIZARD_PROPS });
    cleanup();
    const flat = await drawnWizard({ type: 'object-form', ...WIZARD_PROPS });
    expect(flat).toEqual(bag);
  });

  it('control: the object the bag names is the one fetched, so the rows above measure the bag', async () => {
    const adapter = makeAdapter();
    draw({ type: 'object-form', properties: { ...WIZARD_PROPS, objectName: 'other_object_10859' } }, adapter);
    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('other_object_10859'));
    expect(adapter.getObjectSchema).not.toHaveBeenCalledWith('showcase_project');
  });
});
