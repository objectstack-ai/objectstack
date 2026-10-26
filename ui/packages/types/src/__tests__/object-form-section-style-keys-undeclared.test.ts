/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7200 — `ObjectFormSection` declares neither `className` nor
 * `gridClassName`. This is the declared-but-inert remainder of
 * objectstack#13626.
 *
 * ## The ruling this file inherits
 *
 * objectstack#13626 (maintainer ruling 2026-09-01, director decision batch C,
 * verbatim 「同意」) retired every read of the two keys off an authored
 * form-view section: "retire the reads … Declaring the keys was weighed and
 * not adopted: it would formally invite free Tailwind strings into authored
 * metadata, the exact class the boundary exists to keep out." PR #7198 removed
 * the seven `as any` reads and pinned the non-consumption behaviourally
 * (plugin-form's `sectionStyleKeysRetired-13626.test.tsx`). What it left was
 * the mirror image of the original defect: `ObjectFormSection` — the type an
 * author's `ObjectFormSchema.sections` entry is checked against — still
 * declared both keys, with doc comments promising a wrapper class nothing
 * delivered. An author could write either key, have it type-check, and get
 * nothing. objectui#7200 removes the two members so the authored-metadata type
 * agrees with the spec's strict `FormSectionSchema`, which declares neither.
 *
 * ## Why a DELETION and not a `?: never` tombstone
 *
 * The house pattern for a retired key on a zod-mirrored, NON-strict surface is
 * a tombstone — declared, unwritable, and refused at parse with a migration
 * note (`component-input-retired-constraint-keys.test.ts`, `chart-inline-data-
 * retired.test.ts`). Neither half of that reasoning holds here:
 *
 *   - There is no parse door. `ObjectFormSection` has no zod mirror at all —
 *     `ObjectFormSchema` in `zod/objectql.zod.ts` does not declare `sections`
 *     — so there is nothing to attach a refusal to and nothing that would
 *     silently strip a deleted key.
 *   - The ruling's rationale is specifically "do not declare". A `?: never`
 *     member is still a declaration: it shows up in completion and in the
 *     generated `.d.ts`, and it is exactly the formal invitation the ruling
 *     declined to extend.
 *
 * ## Which types are NOT touched, deliberately
 *
 * The five per-layout config types in @object-ui/plugin-form —
 * `ModalFormSectionConfig`, `SplitFormSectionConfig`, TabbedForm's
 * `FormSectionConfig`, `WizardStepConfig`, `DrawerFormSectionConfig` — keep
 * their own `className` / `gridClassName`. Their renderers read them uncast for
 * programmatic React mounts, which the authorable boundary does not govern.
 * `ObjectForm` rebuilds `sections` key by key on its way to those layouts and
 * copies neither key, so the authored path stays sealed.
 *
 * ## What the `@ts-expect-error` directives prove
 *
 * `ObjectFormSection` carries no index signature and extends nothing, so an
 * annotated object literal is subject to excess-property checking: an authored
 * `className` is a compile error AT THE AUTHORING SITE. This package
 * type-checks its tests through `tsconfig.test.json`, so re-declaring either
 * member fails the build on the unused directive (`TS2578`). The direction was
 * proven by ablation before this file was trusted: restoring the two members
 * turned exactly the two directive lines below red and nothing else — see the
 * objectui#7200 PR for the run.
 *
 * ## The contrast rows (liveness control)
 *
 * A refusal row alone is satisfied by a type that refuses EVERYTHING. So one
 * row authors every key the type does declare, without a directive, and a
 * `keyof` census names the full declared vocabulary — an addition or a removal
 * anywhere on `ObjectFormSection` is then a deliberate edit to this file, not a
 * drift the type system waves through.
 */

import { describe, it, expect } from 'vitest';
import type { ObjectFormSection } from '../objectql';

/** Every key `ObjectFormSection` declares today, spelled once. */
const DECLARED_KEYS = [
  'name',
  'label',
  'description',
  'collapsible',
  'collapsed',
  'columns',
  'pane',
  'fields',
  'group',
  'visibleWhen',
  'visibleWhenFault',
] as const;

describe('objectui#7200 — `ObjectFormSection` does not declare the retired section style keys', () => {
  it('refuses an authored `className` at the authoring site', () => {
    const section: ObjectFormSection = {
      label: 'Basic Info',
      fields: ['name', 'email'],
      // @ts-expect-error `className` is not an authorable form-section key (objectstack#13626 / objectui#7200)
      className: 'os7200-authored-section-class',
    };
    expect(section.fields).toEqual(['name', 'email']);
  });

  it('refuses an authored `gridClassName` at the authoring site', () => {
    const section: ObjectFormSection = {
      label: 'Basic Info',
      fields: ['name', 'email'],
      // @ts-expect-error `gridClassName` is not an authorable form-section key (objectstack#13626 / objectui#7200)
      gridClassName: 'os7200-authored-grid-class',
    };
    expect(section.fields).toEqual(['name', 'email']);
  });

  it('keeps every live sibling key writable without a directive — the contrast', () => {
    // No `@ts-expect-error` anywhere in this literal. If any line here ever
    // needs one, the removal over-reached and took a consumed key with it.
    const section: ObjectFormSection = {
      name: 'basic',
      label: 'Basic Info',
      description: 'Name and contact',
      collapsible: true,
      collapsed: false,
      columns: 2,
      pane: 'primary',
      visibleWhen: '${record.kind === "person"}',
      fields: ['name', { name: 'email', type: 'email', label: 'Email' }],
    };
    expect(section.columns).toBe(2);
    expect(section.pane).toBe('primary');
  });

  it('declared-key census: the full authored section vocabulary, so a re-addition is a deliberate edit here', () => {
    // `Record<keyof ObjectFormSection, true>` pins the census in BOTH
    // directions at compile time: a key added to the type is a missing
    // property here; a key removed from the type is an excess property here.
    // Re-declaring `className` on the type therefore fails this literal, on
    // top of the unused directive above.
    const census: Record<keyof ObjectFormSection, true> = {
      name: true,
      label: true,
      description: true,
      collapsible: true,
      collapsed: true,
      columns: true,
      pane: true,
      fields: true,
      // objectui#7051 — the group-reference form (`@objectstack/spec` 17.3.0,
      // objectstack#13855). Added to the census, not to the retired list: the
      // spec DECLARES it on `FormSectionSchema`, and `ObjectForm` resolves it.
      group: true,
      visibleWhen: true,
      // objectui#13055 — the fault direction the field-group derivation stamps
      // beside a group's `visibleWhen`; a runtime hand-off the spec's strict
      // `FormSectionSchema` refuses in authored metadata (see its docblock).
      visibleWhenFault: true,
    };
    expect(Object.keys(census).sort()).toEqual([...DECLARED_KEYS].sort());
    expect(DECLARED_KEYS).not.toContain('className');
    expect(DECLARED_KEYS).not.toContain('gridClassName');
  });
});
