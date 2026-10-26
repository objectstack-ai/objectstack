/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `field:capability-multiselect` (objectui#3308, ADR-0049
 * enforce-or-remove).
 *
 * The key was registered on ONE path only: `registerFields()`, whose sole caller
 * was the docs site. The live path (`registerAllFields()`, run at module import)
 * never had it, because `fieldWidgetMap` never listed it — so a field authored
 * with `widget: 'capability-multiselect'` resolved to nothing in every real app
 * while a code comment advertised it as usable from a record form. Nothing
 * stamped the hint either, and ADR-0056 P2 put the capability editor in Studio.
 *
 * `registerFields()` itself is gone as of objectui#3910 (ruling B of
 * objectui#3798): the docs catalog's field examples are form-hosted now, so the
 * demo adapter that path existed for has no reason to exist. That REMOVES this
 * file's second and third assertions rather than re-spelling them — a test may
 * not call a function that no longer exists, and asserting over a deleted path
 * would pass for the empty reason (nothing is registered because nothing runs).
 * What each one becomes:
 *
 *   1. absent on the live path — UNCHANGED, and it is now the whole fact. While
 *      a second path existed this assertion pinned nothing (it passed on
 *      `origin/main` too, as PR #3793 recorded); with that path deleted, the
 *      live registry is the only registry, so re-adding the name to
 *      `fieldWidgetMap` is exactly what turns this red.
 *   2. "absent after `registerFields()` too" — DELETED with the path.
 *   3. "registers every other docs-path key" — RE-POINTED at the live path,
 *      which is a superset of the 38 keys the docs path used to register. It
 *      still pins "the retirement subtracts exactly one name", now against the
 *      surviving seam instead of a deleted one.
 *
 * `CapabilityMultiSelectField` the component is deliberately NOT asserted gone:
 * Studio's `PermissionMatrixEditor` imports and renders it directly, which is
 * ADR-0056 P2's design. Only the widget NAME is retired.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';

// Importing the entry runs `registerAllFields()` at module load — the live path.
import { registerAllFields, FORM_FIELD_TYPES } from '../index';

const RETIRED = 'capability-multiselect';

/**
 * Every key the retired docs-demo path (`registerFields()`) registered, minus the
 * retired one. Spelled out rather than derived so a future edit that silently
 * drops one of these registrations fails here instead of passing vacuously.
 * The live path registers these AND more (`multiselect`, `radio`, `checkboxes`,
 * `tags`, `richtext`, and the widget-hint-only pickers) — this list is the floor
 * the retirement promised to leave intact, not the full live surface.
 */
const RETAINED_FIELD_KEYS = [
  'text', 'textarea', 'number', 'boolean', 'select', 'date', 'datetime', 'time',
  'email', 'phone', 'url',
  'currency', 'percent', 'password', 'markdown', 'html', 'lookup', 'master_detail',
  'file', 'image', 'location',
  'formula', 'summary', 'auto_number',
  // `owner` sat beside `user` here until objectui#4814 retired that spelling
  // too. It is NOT simply dropped from the floor: `owner-retired.test.tsx`
  // asserts `field:owner` now resolves to the tombstone widget, so the key's
  // disposition is still pinned — by the card that owns it.
  'user',
  'object', 'vector', 'grid',
  'color', 'slider', 'rating', 'code', 'avatar', 'address', 'geolocation',
  'signature', 'qrcode',
] as const;

describe('capability-multiselect widget retirement (objectui#3308)', () => {
  it('is absent on the live registerAllFields() path', () => {
    registerAllFields();
    expect(ComponentRegistry.get(`field:${RETIRED}`)).toBeUndefined();
    expect(ComponentRegistry.get(RETIRED)).toBeUndefined();
  });

  it('is not in fieldWidgetMap, so no bare field type can reach it either', () => {
    expect(FORM_FIELD_TYPES).not.toContain(RETIRED);
  });

  it('registers every retained field key (retirement subtracts exactly one)', () => {
    registerAllFields();
    for (const key of RETAINED_FIELD_KEYS) {
      expect(
        ComponentRegistry.get(`field:${key}`),
        `field:${key} must survive the retirement`,
      ).toBeTruthy();
    }
    expect(RETAINED_FIELD_KEYS).toHaveLength(37);
  });

  it('has no second registration path left to shadow the live one (objectui#3910)', async () => {
    // The defect ruling B closed was structural, not cosmetic: `registerFields()`
    // re-registered the SAME `field:<type>` keys with demo-only wrappers, so
    // whichever ran last won the registry for every consumer sharing it. Pinning
    // the export gone is what stops it growing back under a new name.
    const entry = (await import('../index')) as Record<string, unknown>;
    expect(entry.registerFields).toBeUndefined();
    expect(entry.createFieldRenderer).toBeUndefined();
    // The surviving seam is still exported — this test must fail loudly if the
    // removal ever takes the live path with it.
    expect(typeof entry.registerAllFields).toBe('function');
    expect(typeof entry.registerField).toBe('function');
  });
});
