/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11494 — an `app-schema-renderer` node draws the app document it
 * carries under `schema` (triage ruling A, comment `5958227972`).
 *
 * `SchemaRenderer` strips a node's `schema` key out of the props it spreads and
 * hands every registered component the NODE as its `schema` prop. Registered
 * directly, `AppSchemaRenderer` therefore read the app document's keys off the
 * node itself, and the published `schema` input never arrived: objectui#11440
 * measured that a node with its navigation under `schema` drew none of it,
 * while the same navigation written on the node drew. That row is inverted
 * here, on purpose, under the ruling: the registration now goes through an
 * adapter that hands `node.schema` to `AppSchemaRenderer`, so the nested
 * document is the one spelling that draws, and the flat one draws nothing.
 * `@object-ui/types/zod`'s `AppSchemaRendererNodeSchema` declares `schema` as
 * the app document by reference, and the strict face refuses the flat
 * spelling; those verdicts are pinned in `@object-ui/types`
 * (`app-schema-renderer-schema-input-11494.test.ts`).
 *
 * Every row renders through the real `SchemaRenderer` and the real registry.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { AppSchemaRendererNodeSchema } from '@object-ui/types/zod';
import { registerLayout } from '../index';

beforeAll(() => {
  registerLayout();
});

const NAV = [{ id: 'accounts', type: 'object', objectName: 'account', label: 'Accounts11494' }];

const draw = (node: unknown) =>
  render(
    <MemoryRouter>
      <SchemaRenderer schema={node as never} />
    </MemoryRouter>,
  ).container;

/** `SchemaErrorBoundary`'s banner, which a throwing render leaves behind. */
const FAILED_TO_RENDER = 'failed to render';

describe('app-schema-renderer — the `schema` input carries the app document (objectui#11494)', () => {
  it('a node with its navigation under `schema` draws it', () => {
    const container = draw({ type: 'app-schema-renderer', schema: { type: 'app', name: 'crm', navigation: NAV } });
    expect(container.textContent).toContain('Accounts11494');
    expect(container.textContent).not.toContain(FAILED_TO_RENDER);
  });

  it('the same navigation written flat on the node draws nothing: one spelling', () => {
    const container = draw({ type: 'app-schema-renderer', name: 'crm', navigation: NAV });
    expect(container.textContent).not.toContain('Accounts11494');
    // The shell itself still draws, so the absence is the navigation's, not the node's.
    expect(container.querySelector('[data-sidebar="sidebar"]')).not.toBeNull();
    expect(container.textContent).not.toContain(FAILED_TO_RENDER);
  });

  it('the document draws its branding too: `title` under `schema` heads the sidebar', () => {
    const container = draw({ type: 'app-schema-renderer', schema: { type: 'app', name: 'crm', title: 'Title11494' } });
    expect(container.textContent).toContain('Title11494');
    // The flat spelling does not.
    expect(draw({ type: 'app-schema-renderer', title: 'Flat11494' }).textContent).not.toContain('Flat11494');
  });

  it('`basePath` and `mobileNavMode` are unchanged: still read off the node, beside the document', () => {
    const container = draw({
      type: 'app-schema-renderer',
      basePath: '/apps/crm',
      mobileNavMode: 'bottom_nav',
      schema: { type: 'app', name: 'crm', navigation: NAV },
    });
    const bar = container.querySelector('[role="navigation"][aria-label="Mobile navigation"]');
    expect(bar).not.toBeNull();
    expect(Array.from(bar!.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/apps/crm/account']);
    // Lit control: `drawer`, the default, draws no bar.
    const drawer = draw({ type: 'app-schema-renderer', schema: { type: 'app', name: 'crm', navigation: NAV } });
    expect(drawer.querySelector('[aria-label="Mobile navigation"]')).toBeNull();
  });

  it('a node without `schema` draws the empty shell, as an omitted optional input: no error banner', () => {
    // The node `skills/objectui/guides/mobile.md` teaches carries no document.
    const container = draw({ type: 'app-schema-renderer', mobileNavMode: 'bottom_nav' });
    expect(container.querySelector('[data-sidebar="sidebar"]')).not.toBeNull();
    expect(container.textContent).not.toContain(FAILED_TO_RENDER);
  });

  it('the registration publishes `schema` as an object input, and the arm declares it', () => {
    const inputs =
      (ComponentRegistry.getConfig('app-schema-renderer', 'layout') as { inputs?: Array<{ name: string; type: string }> } | undefined)
        ?.inputs ?? [];
    expect(inputs.find((input) => input.name === 'schema')?.type).toBe('object');
    expect(Object.keys(AppSchemaRendererNodeSchema.shape)).toContain('schema');
  });
});
