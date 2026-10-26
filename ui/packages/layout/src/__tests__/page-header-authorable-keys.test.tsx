/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `page-header` node key is RETIRED (objectui#10859 batch 8, phase 2c), and
 * the `PageHeader` component it served stays an export.
 *
 * Until that phase this file pinned the `page-header` alias registration's
 * declared surface: that it declared only keys `@objectstack/spec`'s
 * `PageHeaderProps` accepts (objectui#3226), judged with
 * `@object-ui/test-support`'s tombstone probe (objectui#3809 / objectui#3829,
 * which kept the renderer-read `icon` input on a named carve-out); that it
 * declared the `children` slot it renders (objectui#3900 / objectui#9910); and
 * that it declared `actions` / `icon` with the types the renderer reads
 * (objectui#3972). With the registration gone there is no declared surface left
 * to judge, so those describes went with it. `page:header`, the key authors
 * write, is judged by the repo-wide parity gate in `apps/console`.
 *
 * What stays pinned here:
 *   - the retirement itself — `registerLayout()` publishes neither spelling, and
 *     the lit control is a layout key it still publishes under both
 *     (`app-schema-renderer`; it was `responsive-grid` until objectui#11441
 *     retired that key), the far end the docs site's registrar relies on
 *     (`scripts/__tests__/site-playground-layout-registration-3904.test.ts`);
 *   - the rendered half of objectui#3789, on the exported component: a lone
 *     `description` draws nothing, and `subtitle` wins when both are passed.
 *     That is a fact about `PageHeader`, which hosts still compose in JSX.
 *
 * The absence keys are literals on purpose: `scripts/__tests__/
 * unit-registry-absence-collision.test.ts` resolves a registry-absence key
 * statically and pins the sites it cannot.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';

import { registerLayout, PageHeader } from '../index';

beforeAll(() => {
  registerLayout();
});

describe('the `page-header` registration is retired (objectui#10859 batch 8)', () => {
  it('publishes neither the bare key nor its `layout` namespace', () => {
    // Lit control first: a key `registerLayout()` still publishes, both spellings.
    expect(ComponentRegistry.getConfig('app-schema-renderer')).toBeTruthy();
    expect(ComponentRegistry.getConfig('app-schema-renderer', 'layout')).toBeTruthy();
    expect(ComponentRegistry.getConfig('page-header')).toBeUndefined();
    expect(ComponentRegistry.getConfig('page-header', 'layout')).toBeUndefined();
    expect(ComponentRegistry.has('layout:page-header')).toBe(false);
  });

  it('keeps `PageHeader` as an export a host composes directly', () => {
    render(<PageHeader title="Accounts" subtitle="All active accounts" />);
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.getByText('All active accounts')).toBeTruthy();
  });
});

describe('the retired `description` alias is not read at runtime (objectui#3789)', () => {
  // The other half of the retirement, asserted on the RENDERED output rather
  // than the declaration surface: `description` is now an ordinary unknown
  // prop. `PageHeaderComponentProps` extends `HTMLAttributes<HTMLDivElement>`,
  // so passing it does not fail `tsc` — it is spread onto the wrapper div —
  // which is exactly why the assertion has to be "the text does not render"
  // rather than "the type rejects it".
  it('renders no secondary line for a lone `description`', () => {
    render(
      // @ts-expect-error — the retired alias is not a prop of this component.
      <PageHeader title="Customer Details" description="View and edit customer information" />,
    );
    expect(screen.getByText('Customer Details')).toBeTruthy();
    expect(screen.queryByText('View and edit customer information')).toBeNull();
  });

  it('renders `subtitle` and only `subtitle` when both are present', () => {
    render(
      // @ts-expect-error — the retired alias is not a prop of this component.
      <PageHeader title="Customer Details" subtitle="From the spec" description="From the alias" />,
    );
    expect(screen.getByText('From the spec')).toBeTruthy();
    expect(screen.queryByText('From the alias')).toBeNull();
  });
});
