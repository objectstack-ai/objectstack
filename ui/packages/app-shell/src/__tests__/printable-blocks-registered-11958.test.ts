/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11958 — every block of the spec's printable subset has a renderer
 * in the console.
 *
 * A page that declares `print` may hold only the blocks in
 * `PRINTABLE_PAGE_COMPONENT_TYPES` (`@objectstack/spec/ui`), refused at the
 * authoring doors otherwise. The set is read HERE from the spec's export, and
 * no second list of it is kept anywhere in this repository: the spec's own
 * doc on the constant names this card's print rendering as its second reader.
 * When the spec widens the set, a block the console cannot draw fails here by
 * name instead of printing as an unknown-component placeholder.
 *
 * The packages imported below are the ones that register those blocks; the
 * console mounts all of them.
 */
import { describe, it, expect } from 'vitest';
import { PRINTABLE_PAGE_COMPONENT_TYPES } from '@objectstack/spec/ui';
import { ComponentRegistry } from '@object-ui/core';
import '@object-ui/components';
import '@object-ui/layout';
import '@object-ui/plugin-detail';
import '@object-ui/plugin-form';
import '@object-ui/plugin-dashboard';

describe('the printable block subset is renderable (objectui#11958)', () => {
  it('reads a non-empty set from the spec', () => {
    expect(PRINTABLE_PAGE_COMPONENT_TYPES.size).toBeGreaterThan(0);
  });

  it.each([...PRINTABLE_PAGE_COMPONENT_TYPES])('`%s` has a registered renderer', (type) => {
    expect(ComponentRegistry.getKnownTypes()).toContain(type);
  });

  it('CONTROL — a type no package registers is absent, so the check can fail', () => {
    expect(ComponentRegistry.getKnownTypes()).not.toContain('page:print-probe-11958');
  });
});
