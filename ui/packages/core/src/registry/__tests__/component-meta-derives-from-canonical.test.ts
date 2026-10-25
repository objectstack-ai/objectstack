/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Convergence pin — `@object-ui/core`'s registration type is DERIVED from the
 * one `ComponentMeta` declaration in `@object-ui/types`, not a structural copy
 * of it (objectui#6067).
 *
 * ⚠️ Since objectui#6349 (batch 4) that registration type is named
 * `RegistryComponentMeta`. It used to be published as `ComponentMeta` too — a
 * derived declaration is still a second authority for the name — and
 * `@object-ui/core`'s `ComponentMeta` is now a plain re-export of the canonical
 * one. Every assertion below that reads the REGISTRATION surface reads
 * `RegistryComponentMeta`; the history recorded in this header still says
 * `ComponentMeta`, because that is what the type was called when it was
 * measured. The last describe block pins the re-export.
 *
 * ## What was wrong
 *
 * `Registry.ts` declared its own thirteen-key `ComponentMeta`: the nine members
 * restated from `@object-ui/types`' `base.ts`, four registry-only keys added
 * here (`tier` / `namespace` / `skipFallback` / `labelling`), and `tags` /
 * `description` absent — though both are declared on the canonical type AND on
 * the `ComponentMetaSchema` zod mirror. Two of the three authorities agreed and
 * the registration surface did not, so the two keys were unwritable at exactly
 * the declaration most component registrations import. That is the identical
 * two-key delta objectui#5893 had just closed inside `@object-ui/types`, and
 * objectui#5671 had already executed the identical convergence for the sibling
 * type `ComponentInput` in this very file.
 *
 * ## Why the load-bearing assertion compares `keyof` sets, not assignability
 *
 * EVERY member of both shapes is optional. A type with fewer optional members
 * is assignable to one with more and vice versa, so `extends` is mutually TRUE
 * across a diverged pair — excess-property checking only ever fires on object
 * literals, never on the type relation. Measured on the EMITTED `.d.ts` of both
 * packages on the tree immediately BEFORE this convergence:
 *
 *     coreExtendsCanonical = true          <- green on the DIVERGED tree
 *     canonicalExtendsCore = true          <- green on the DIVERGED tree
 *     onlyInCanonical      = "tags" | "description"
 *     onlyInCore           = "tier" | "namespace" | "skipFallback" | "labelling"
 *
 * and on the tree after it:
 *
 *     coreExtendsCanonical = true          <- UNCHANGED
 *     canonicalExtendsCore = true          <- UNCHANGED
 *     onlyInCanonical      = never         <- the only reading that moved
 *     onlyInCore           = "tier" | "namespace" | "skipFallback" | "labelling"
 *
 * An assignability assertion is therefore a GHOST here: it could not have gone
 * red on the defect and it cannot go red on its return. `Exclude<keyof …>` is
 * the instrument that moved, so it is the pin; the assignability pair is kept
 * below, labelled, as the control that demonstrates the contrast rather than
 * asserting it. Same shape of reasoning, and the same conclusion about
 * member-set checks being insufficient on their own, as
 * `packages/types/src/__tests__/component-meta-single-declaration.test.ts`.
 *
 * ⚠️ THE TWO READINGS ABOVE ARE RECORDED MEASUREMENTS, taken on the tree
 * immediately before and after objectui#6067. They are history and are NOT
 * updated as the key set grows — `onlyInCore` has since gained a fifth key,
 * `deprecated` (objectui#6674), which the live assertions below carry. Editing
 * a recorded reading to match today's tree would destroy the only evidence that
 * the assignability pair was green on the diverged one.
 *
 * ## Which declaration these type-level assertions actually read
 *
 * The EMITTED one. `packages/core/tsconfig.test.json` sets `"paths": {}`,
 * dropping the root config's source-tree mapping so `@object-ui/types` resolves
 * through the workspace dependency's built `dist/index.d.ts`; that project is
 * chained from this package's `type-check` script, which is what CI's `Type
 * Check` job runs, and turbo's `type-check` task `dependsOn: ["^build"]`, so the
 * dependency IS built there. Under vitest the same file resolves to `src/`
 * instead, and every annotation below is erased — `expect(x).toBe(true)` on a
 * literal `true` proves nothing on its own. `tsc` is the enforcement; the
 * runtime assertions exist so a failure has a named test to report against, the
 * arrangement objectui#3181 recorded for this package.
 *
 * Deliberately NOT asserted here: anything read out of `packages/core/dist`.
 * The CI `test` job runs `pnpm test` (root `vitest run`) with no build ahead of
 * it at all, so a dist-reading assertion would be absent-or-red depending on
 * whether someone happened to run a build — "an assertion whose colour depends
 * on whether someone ran a build is not a pin"
 * (`src/actions/__tests__/actionKeys.types.test.ts`). The emitted-declaration
 * half is covered by the `type-check` route described above.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { ComponentMeta as CanonicalComponentMeta } from '@object-ui/types';
import type {
  ComponentMeta as CoreComponentMeta,
  RegistryComponentMeta,
  RegistryComponentMetaExtras,
} from '../Registry.js';

/** Keys the canonical declaration has that the registration surface does not. */
type OnlyOnCanonical = Exclude<keyof CanonicalComponentMeta, keyof RegistryComponentMeta>;

/** Keys the registration surface adds on top of the canonical declaration. */
type OnlyOnRegistry = Exclude<keyof RegistryComponentMeta, keyof CanonicalComponentMeta>;

/**
 * Mutual-subset equality, wrapped in tuples so neither side distributes over a
 * union and `never` compares as the empty set rather than vanishing.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe('RegistryComponentMeta (core registry) — the key-set pin (the assertion a structural copy fails)', () => {
  it('leaves no canonical key unreachable at the registration surface', () => {
    // THIS is the pin. It read `"tags" | "description"` before objectui#6067
    // and `never` after — the one reading that moved. It goes red the moment a
    // key is added to `@object-ui/types`' `ComponentMeta` and not reflected
    // here, which is precisely how the copy this replaces acquired its delta.
    const noCanonicalKeyIsMissing: Exact<OnlyOnCanonical, never> = true;

    expect(noCanonicalKeyIsMissing).toBe(true);
  });

  it('adds exactly the five registry-only keys, named', () => {
    // The other half of the symmetric difference, pinned to a literal union
    // rather than to `keyof RegistryComponentMetaExtras` — comparing the extras
    // type against itself would be true by construction. Spelling them out
    // is what catches a sixth key drifting onto the registration surface, and
    // what catches one of these being quietly moved onto the general type
    // in `@object-ui/types` (the direction objectui#6067 weighed and rejected:
    // `skipFallback` and `namespace` are registry mechanics and do not belong
    // on a type published to every metadata author).
    //
    // `deprecated` is the fifth, added by objectui#6674. It is registry-only
    // for the same reason the other four are: it states something about the
    // REGISTRATION (which surfaces may still author this type), and the
    // authoring-surface vocabulary it is scoped by is this engine's, not a
    // general property of component metadata. This union is the pin the
    // dispatch for #6674 flagged in advance — a new key that does not update it
    // turns this case red on a change that has nothing to do with it.
    const registryOnlyKeys: Exact<
      OnlyOnRegistry,
      'tier' | 'namespace' | 'skipFallback' | 'labelling' | 'deprecated'
    > = true;

    // And the extras type is the thing that supplies them, so the named type
    // the ruling asked for is load-bearing rather than decorative.
    const extrasSupplyThem: Exact<
      OnlyOnRegistry,
      keyof RegistryComponentMetaExtras
    > = true;

    expect([registryOnlyKeys, extrasSupplyThem]).toEqual([true, true]);
  });
});

describe('RegistryComponentMeta (core registry) — the assignability control (green on the diverged tree, kept to show the contrast)', () => {
  it('is mutually assignable with the canonical declaration — and WAS before the convergence too', () => {
    // Both readings were `true` while `tags` and `description` were missing.
    // Recorded here as the control, not as the guarantee: if this pair were the
    // only assertion in the file, reverting objectui#6067 would leave it green.
    const bothWays: [
      RegistryComponentMeta extends CanonicalComponentMeta ? true : false,
      CanonicalComponentMeta extends RegistryComponentMeta ? true : false,
    ] = [true, true];

    expect(bothWays).toEqual([true, true]);
  });
});

describe('RegistryComponentMeta (core registry) — the two keys the convergence delivers', () => {
  it('lets a registration write `tags` and `description` alongside the registry keys', () => {
    // The counter-probe the convergence has to survive. "The copy is gone" is
    // otherwise satisfiable by narrowing the type for everyone, and narrowing
    // is exactly what was NOT permitted here: `@object-ui/core` is published,
    // `ComponentMeta` is exported from it, and all four registry-only keys have
    // live consumers. Nothing was removed; two keys were added.
    //
    // Before objectui#6067 the two annotated keys were a plain TS error on this
    // spelling and legal on `@object-ui/types`' — the divergence, at a call site.
    const registration: RegistryComponentMeta = {
      label: 'Kanban Board',
      icon: 'layout-board',
      category: 'data',
      tier: 'public',
      namespace: 'view',
      skipFallback: true,
      labelling: 'group',
      deprecated: { surfaces: ['json'], replacement: 'use "object-grid"' },
      inputs: [{ name: 'columns', type: 'array' }],
      isContainer: false,
      resizable: true,
      tags: ['board', 'kanban'],
      description: 'Drag-and-drop board view over a grouped dataset.',
    };

    expect(registration.tags).toEqual(['board', 'kanban']);
    expect(registration.description).toBe(
      'Drag-and-drop board view over a grouped dataset.',
    );
    // The registry keys are still writable on the same object — the
    // convergence widened the surface, it did not swap one half for the other.
    expect([
      registration.tier,
      registration.namespace,
      registration.skipFallback,
      registration.labelling,
    ]).toEqual(['public', 'view', true, 'group']);
    // …and the fifth, objectui#6674's. Writing it HERE is what proves the key
    // reached the declaration every component registration imports — the exact
    // failure mode objectui#6067 was filed about, where a key was legal on the
    // canonical type and a TS error at the registration surface.
    expect(registration.deprecated).toEqual({
      surfaces: ['json'],
      replacement: 'use "object-grid"',
    });
  });
});

const REGISTRY_SRC = readFileSync(
  fileURLToPath(new URL('../Registry.ts', import.meta.url)),
  'utf8',
);

/** The import that makes this file share `@object-ui/types`' declaration. */
const CANONICAL_IMPORT =
  "import type { ComponentMeta as CanonicalComponentMeta } from '@object-ui/types';";

/** The derived declaration, exactly as `Registry.ts` spells it. */
const DERIVED_DECLARATION =
  'export type RegistryComponentMeta = CanonicalComponentMeta & RegistryComponentMetaExtras;';

/** The general name, re-exported rather than declared (objectui#6349, batch 4). */
const GENERAL_REEXPORT = "export type { ComponentMeta } from '@object-ui/types';";

/** A property declaration for `name`, at any nesting depth. */
const memberDeclaration = (name: string) => new RegExp(`^\\s*${name}\\??:`, 'm');

/** The eleven members that belong to the canonical declaration and only there. */
const CANONICAL_MEMBERS = [
  'label',
  'icon',
  'category',
  'inputs',
  'defaultProps',
  'examples',
  'isContainer',
  'resizable',
  'resizeConstraints',
  'tags',
  'description',
];

/** The five this file legitimately declares. */
const REGISTRY_MEMBERS = [
  'tier',
  'namespace',
  'skipFallback',
  'labelling',
  'deprecated',
];

describe('RegistryComponentMeta (core registry) — the source-identity pin', () => {
  it('imports the canonical declaration instead of restating it', () => {
    expect(REGISTRY_SRC).toContain(CANONICAL_IMPORT);
    expect(REGISTRY_SRC).toContain(DERIVED_DECLARATION);
  });

  it('declares none of the canonical members locally', () => {
    // The type-level pin above catches a MISSING key. This catches the other
    // failure mode, which no `keyof` comparison can see: a member-identical
    // restatement. That is the state objectui#4580 ruled about — mutually
    // assignable, key sets equal, every assertion in this file green, and
    // drifting again the moment either side moves. It is also how the copy this
    // replaces began.
    const restated = CANONICAL_MEMBERS.filter((m) =>
      memberDeclaration(m).test(REGISTRY_SRC),
    );

    expect(restated).toEqual([]);
  });

  it('still declares the five registry-only members here, so the pattern is live', () => {
    // Control for the regex itself. A pattern that matched nothing anywhere
    // would pass the assertion above on any tree, including a re-diverged one.
    const declared = REGISTRY_MEMBERS.filter((m) =>
      memberDeclaration(m).test(REGISTRY_SRC),
    );

    expect(declared).toEqual(REGISTRY_MEMBERS);
  });
});

describe('ComponentMeta from @object-ui/core — the re-export of the canonical declaration (objectui#6349, batch 4)', () => {
  it('is the canonical type: same key set, no registry key on it', () => {
    // `Exact` over the KEY SETS, not over the types: every member is optional,
    // so assignability is mutual for any two of these shapes (the control
    // above). The key sets are what a re-pointed or re-declared name would move.
    const sameKeys: Exact<keyof CoreComponentMeta, keyof CanonicalComponentMeta> = true;
    // A registry key on the general name is the defect the rename removed.
    const noRegistryKey: Exact<
      Extract<keyof CoreComponentMeta, keyof RegistryComponentMetaExtras>,
      never
    > = true;

    expect([sameKeys, noRegistryKey]).toEqual([true, true]);
  });

  it('is re-exported in Registry.ts, not declared there', () => {
    expect(REGISTRY_SRC).toContain(GENERAL_REEXPORT);
    // LIT CONTROL for the matcher below: it finds the registration type's
    // declaration, so its silence on the general name is a reading.
    expect(/^export type RegistryComponentMeta\b/m.test(REGISTRY_SRC)).toBe(true);
    expect(/^export (?:type|interface) ComponentMeta\b/m.test(REGISTRY_SRC)).toBe(false);
  });
});
