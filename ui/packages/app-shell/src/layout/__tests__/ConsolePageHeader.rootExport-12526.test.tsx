// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12526 — the package root exports the console page header as
 * `ConsolePageHeader`, with its props type `ConsolePageHeaderProps`, so a
 * console page outside this package (the Approvals Inbox in
 * `@object-ui/console`) draws the header an object list and a dashboard draw.
 *
 * What this file pins:
 *   - `ConsolePageHeader` from the package root IS this package's
 *     `PageHeader`, not a copy or a wrapper;
 *   - the root does not export it as `PageHeader`: `@object-ui/layout` exports
 *     a different component by that name, which `@object-ui/console` also
 *     depends on;
 *   - at compile time, the root's `ConsolePageHeaderProps` takes `subtitle`
 *     and refuses `description` (objectui#4761), compiled by
 *     `tsconfig.test.json`.
 *
 * The root is imported in full, as a consumer's bundler would read it.
 */

import { describe, it, expect } from 'vitest';
import * as root from '../../index';
import type { ConsolePageHeaderProps } from '../../index';
import { PageHeader } from '../PageHeader';

describe('the package root exports the console page header (objectui#12526)', () => {
  it('`ConsolePageHeader` is this package\'s `PageHeader`', () => {
    expect(root.ConsolePageHeader).toBe(PageHeader);
  });

  it('the root does not publish it as `PageHeader`', () => {
    expect(Object.keys(root)).not.toContain('PageHeader');
  });

  it('its props type takes `subtitle` and refuses `description`', () => {
    const props: ConsolePageHeaderProps = { title: 'Approvals Inbox', subtitle: 'Review and act' };
    // @ts-expect-error — `description` is not a prop of the console page header.
    const refused: ConsolePageHeaderProps = { title: 'Approvals Inbox', description: 'Review and act' };
    expect(props.subtitle).toBe('Review and act');
    expect(refused.title).toBe('Approvals Inbox');
  });
});
