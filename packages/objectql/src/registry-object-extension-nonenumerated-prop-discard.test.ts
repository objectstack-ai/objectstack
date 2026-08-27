// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12680] `mergeObjectDefinitions`'s docblock used to promise "other props:
 * later value wins" while the implementation only ever merged `fields` /
 * `validations` / `indexes` (additively) and the three guarded scalars
 * `label` / `pluralLabel` / `description` (last-writer-wins). Every other
 * top-level prop an `extend` contributor carries was — and still is —
 * silently discarded: `merged = { ...base }` and nothing else is copied.
 *
 * That mismatch is what let cloud#1653's investigation nearly conclude that a
 * host could override a framework object's `tenancy` declaration through the
 * extension seam — the docblock said so. The docblock was corrected (this
 * PR); THIS FILE pins the closed merge set as a fact of the implementation so
 * prose and behaviour cannot silently drift apart again.
 *
 * `icon` is the fixture: a real, spec-legal top-level `ServiceObject` prop
 * with no security weight (`tenancy` — the motivating example — is
 * deliberately NOT baked into a test, to keep this pin from reading as
 * license to write a `tenancy`-specific test elsewhere).
 *
 * `label` is the positive control: it IS in the guarded-scalar set, so it
 * must change under the very same extend-fold. Without it, a fold that did
 * nothing at all would pass the negative assertion for the wrong reason.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from './registry.js';

const OWNER_PKG = 'app.owner';
const EXTENDER_PKG = 'app.extender';
const OBJECT_NAME = 'merge_fold_nonenumerated_prop_probe';

function silentRegistry(): SchemaRegistry {
  const r = new SchemaRegistry({ multiTenant: false });
  r.logLevel = 'silent';
  return r;
}

describe('mergeObjectDefinitions — closed merge set (#12680)', () => {
  it('discards a non-enumerated top-level prop (`icon`) from an extend contributor silently', () => {
    const r = silentRegistry();
    r.registerObject(
      {
        name: OBJECT_NAME,
        label: 'Base Label',
        icon: 'base-icon',
        fields: { name: { name: 'name', type: 'text', label: 'Name' } },
      } as any,
      OWNER_PKG,
    );
    r.registerObject(
      {
        name: OBJECT_NAME,
        // Enumerated scalar — must win (positive control).
        label: 'Extender Label',
        // NON-enumerated top-level prop — not in the closed merge set, must
        // NOT survive the fold, and no error/warning marks the drop.
        icon: 'extender-icon',
      } as any,
      EXTENDER_PKG,
      undefined,
      'extend',
    );

    const resolved = r.getObject(OBJECT_NAME) as any;

    // Positive control: the guarded scalar DID fold — proves the extend
    // contributor was actually applied, not skipped for some unrelated reason.
    expect(resolved.label).toBe('Extender Label');

    // The pin: the non-enumerated prop was silently discarded. The base's
    // value survives untouched — the extension's value never lands.
    expect(resolved.icon).toBe('base-icon');
  });

  it('discards a non-enumerated prop the BASE never declared, rather than materializing it from the extension', () => {
    const r = silentRegistry();
    r.registerObject(
      {
        name: OBJECT_NAME,
        label: 'Base Label',
        fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        // no `icon` at all on the base
      } as any,
      OWNER_PKG,
    );
    r.registerObject(
      { name: OBJECT_NAME, icon: 'extender-icon' } as any,
      EXTENDER_PKG,
      undefined,
      'extend',
    );

    const resolved = r.getObject(OBJECT_NAME) as any;
    expect(resolved.icon).toBeUndefined();
  });
});
