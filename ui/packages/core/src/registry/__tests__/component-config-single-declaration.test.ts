/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Convergence pin — `ComponentConfig` has ONE declaration, and it is
 * `@object-ui/types`' (objectui#6298).
 *
 * ## What was wrong
 *
 * Two PUBLISHED declarations of one name. `@object-ui/types`' `src/index.ts`
 * exports the one in `base.ts`; `Registry.ts` reaches `@object-ui/core`'s
 * public entry through `src/index.ts`'s `export * from './registry/Registry.js'`,
 * with `package.json` mapping `"."` to `./dist/index.d.ts`. An IDE auto-import
 * picked between them by alphabetical order — the failure mode the 2026-08-25
 * family ruling (decision 甲/A1 on objectui#6172) is about, and the disposition
 * objectui#4580 ruled for this family: *a structural copy would reproduce the
 * defect the moment either side moved.*
 *
 * objectui#6067 / PR #6297 closed HALF the delta by single-sourcing
 * `ComponentMeta`. What survived it, and what this card closes, is GENERICITY
 * AND THE `component` SLOT: `@object-ui/types`' was non-generic with
 * `component: any`; core's was `<T = any>` with `component: ComponentRenderer<T>`.
 *
 * ## Why (b) — the re-export — and not (a), the derived declaration
 *
 * `scripts/__tests__/one-authority-per-exported-name-6273.test.ts` counts an
 * `export type X = …` / `export interface X` as an AUTHORITY and deliberately
 * does not count `export type { X } from './x'`. So a derived declaration in
 * this package would have left the collision measured and the baseline row
 * owed. That is not a prediction: `ComponentMeta` was converged the derived way
 * by PR #6297 and is STILL a `KNOWN_COLLISIONS` row on this tree, three files
 * away from the row this card removed.
 *
 * The stated proviso for (b) — *"needs `ComponentRenderer` to have a home
 * `@object-ui/types` can reach"* — turns out not to bind, and the reason is
 * pinned below: `ComponentRenderer<T>` is the IDENTITY, so `component: T` in
 * `@object-ui/types` is the same slot with nothing to import. It could not have
 * been imported: `@object-ui/types` depends on `@objectstack/spec` and `zod`
 * only, and this package depends on IT, so the edge would have been a cycle.
 *
 * ## Why the load-bearing assertions are not assignability
 *
 * Measured on the EMITTED `.d.ts` of both packages on the tree immediately
 * BEFORE this convergence — an out-of-package consumer importing the name from
 * each package:
 *
 *     Exact<TypesConfig, CoreConfig>                 = true    <- on the DIVERGED pair
 *     Exclude<keyof CoreConfig, keyof TypesConfig>   = the five registry-only keys
 *     Exclude<keyof TypesConfig, keyof CoreConfig>   = never
 *     TypesConfig['component'] / CoreConfig['component'] = any / any
 *     TypesConfig<HTMLElement>  = TS2315 "Type 'ComponentConfig' is not generic"
 *
 * Mutual assignability read `true` while the two types genuinely differed —
 * `component: any` absorbs everything and every other member is optional — so
 * an assignability assertion is a GHOST here, exactly as
 * `component-meta-derives-from-canonical.test.ts` records for the sibling type.
 * The readings that MOVED are the genericity of `@object-ui/types`' declaration
 * and the source identity of this file, so those are the pins; the assignability
 * pair is kept below, labelled, as the control that shows the contrast.
 *
 * ## Which declaration the type-level assertions read
 *
 * The EMITTED one, under `type-check`: `packages/core/tsconfig.test.json` sets
 * `"paths": {}`, so `@object-ui/types` resolves through the workspace
 * dependency's built `dist/index.d.ts`, and turbo's `type-check` task
 * `dependsOn: ["^build"]`. Under vitest the same specifier resolves to `src/`
 * and every annotation below is erased — `expect(x).toBe(true)` on a literal
 * `true` proves nothing on its own. `tsc` is the enforcement; the runtime
 * assertions exist so a failure has a named test to report against, the
 * arrangement objectui#3181 recorded for this package. Deliberately NOT
 * asserted here: anything read out of `packages/core/dist` — the CI `test` job
 * runs `pnpm test` with no build ahead of it, and "an assertion whose colour
 * depends on whether someone ran a build is not a pin".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { ComponentConfig as CanonicalComponentConfig } from '@object-ui/types';
import type {
  ComponentConfig,
  ComponentRenderer,
  RegistryComponentConfig,
  RegistryComponentMetaExtras,
} from '../Registry.js';
import { Registry } from '../Registry.js';

/**
 * Mutual-subset equality, wrapped in tuples so neither side distributes over a
 * union and `never` compares as the empty set rather than vanishing.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** True only for `any` — `0 extends 1 & X` can hold for nothing else. */
type IsAny<X> = 0 extends 1 & X ? true : false;

/** A renderer stand-in with no relation to anything else in this file. */
interface ProbeRenderer {
  readonly __probe: 'renderer';
}

describe('ComponentConfig — the identity that made the convergence possible', () => {
  it('keeps `ComponentRenderer` the identity alias, so `component: T` is the same slot', () => {
    // THE load-bearing premise of objectui#6298. `@object-ui/types` declares
    // `component: T` and cannot import `ComponentRenderer` (that edge would be
    // a cycle). The two spellings mean the same thing ONLY while this alias is
    // the identity. Give it real content and the convergence silently changes
    // meaning — this is the assertion that refuses to let that happen quietly.
    const rendererIsIdentity: Exact<ComponentRenderer<ProbeRenderer>, ProbeRenderer> = true;
    // …and its default arm, which is what the defaulted `ComponentConfig` rides on.
    const defaultArmIsAny: IsAny<ComponentRenderer> = true;

    expect([rendererIsIdentity, defaultArmIsAny]).toEqual([true, true]);
  });
});

describe('ComponentConfig — the name this package publishes IS the canonical one', () => {
  it('re-exports `@object-ui/types`’ declaration rather than a look-alike', () => {
    // A structural equality check would pass on a member-identical COPY (that
    // is objectui#4580's whole point, and the source-identity pin at the bottom
    // of this file is what catches it). This one is still worth stating: after
    // the re-export the two published names denote one type, parameter and all.
    const sameTypeParameterised: Exact<
      ComponentConfig<ProbeRenderer>,
      CanonicalComponentConfig<ProbeRenderer>
    > = true;
    const sameTypeDefaulted: Exact<ComponentConfig, CanonicalComponentConfig> = true;

    expect([sameTypeParameterised, sameTypeDefaulted]).toEqual([true, true]);
  });

  it('lets the type parameter reach the `component` slot from EITHER package', () => {
    // The reading that actually moved. Before this card,
    // `ComponentConfig<HTMLElement>` off `@object-ui/types` was
    // `TS2315: Type 'ComponentConfig' is not generic`.
    const throughTypes: Exact<
      CanonicalComponentConfig<ProbeRenderer>['component'],
      ProbeRenderer
    > = true;
    const throughCore: Exact<ComponentConfig<ProbeRenderer>['component'], ProbeRenderer> = true;

    expect([throughTypes, throughCore]).toEqual([true, true]);
  });

  it('leaves the bare spelling meaning exactly what it meant before (no consumer changes)', () => {
    // The counter-probe the convergence has to survive. "One authority" is
    // otherwise satisfiable by narrowing the slot for everyone, and narrowing
    // is what was NOT permitted here: both declarations are published and the
    // parameter was added DEFAULTED precisely so every existing spelling keeps
    // its meaning. `ComponentConfig` is `ComponentConfig<any>`, whose
    // `component` is `any` — the slot `@object-ui/types` always published.
    const bareSlotIsStillAny: IsAny<ComponentConfig['component']> = true;
    const canonicalBareSlotIsStillAny: IsAny<CanonicalComponentConfig['component']> = true;

    expect([bareSlotIsStillAny, canonicalBareSlotIsStillAny]).toEqual([true, true]);
  });
});

describe('ComponentConfig — the registry-only keys were rehomed, not dropped', () => {
  it('adds exactly the five registry-only keys on the entry type, named', () => {
    // The convergence had to move the extras somewhere: the bare canonical
    // declaration does not carry them, and `Registry.getNamespaceComponents`
    // filters on `config.namespace`. They live on the named extension, and
    // this is the symmetric difference that says so — spelled out as a literal
    // union rather than compared against the extras type, which would be true
    // by construction.
    const registryOnlyKeys: Exact<
      Exclude<keyof RegistryComponentConfig, keyof ComponentConfig>,
      'tier' | 'namespace' | 'skipFallback' | 'labelling' | 'deprecated'
    > = true;
    const extrasSupplyThem: Exact<
      Exclude<keyof RegistryComponentConfig, keyof ComponentConfig>,
      keyof RegistryComponentMetaExtras
    > = true;
    // Nothing on the canonical declaration went missing from the entry type.
    const nothingLost: Exact<Exclude<keyof ComponentConfig, keyof RegistryComponentConfig>, never> =
      true;

    expect([registryOnlyKeys, extrasSupplyThem, nothingLost]).toEqual([true, true, true]);
  });

  it('hands the registry-only keys back off a real registration, at runtime', () => {
    // The half no type-level assertion can reach on a vitest run: the entry the
    // registry actually stores still carries the extras. A local instance, not
    // the process-level `ComponentRegistry` singleton, so this file cannot
    // perturb another test file.
    const registry = new Registry<ProbeRenderer>();
    const renderer: ProbeRenderer = { __probe: 'renderer' };

    registry.register('probe', renderer, {
      namespace: 'issue-6298',
      tier: 'internal',
      labelling: 'group',
      skipFallback: true,
      label: 'Probe',
    });

    const config = registry.getConfig('probe', 'issue-6298');

    expect(config?.type).toBe('issue-6298:probe');
    expect(config?.component).toBe(renderer);
    expect([config?.namespace, config?.tier, config?.labelling, config?.skipFallback]).toEqual([
      'issue-6298',
      'internal',
      'group',
      true,
    ]);
    // …and the canonical half is readable off the same entry.
    expect(config?.label).toBe('Probe');
    // The `namespace` filter is the live consumer that made rehoming mandatory.
    expect(registry.getNamespaceComponents('issue-6298').map((c) => c.type)).toEqual([
      'issue-6298:probe',
    ]);
  });
});

describe('ComponentConfig — the assignability control (green on the diverged pair, kept to show the contrast)', () => {
  it('is mutually assignable with the canonical declaration — and WAS before the convergence too', () => {
    // Measured `true` on the emitted `.d.ts` of both packages while the two
    // types genuinely differed. Recorded here as the control, not as the
    // guarantee: if this pair were the only assertion in the file, reverting
    // objectui#6298 would leave it green.
    const bothWays: [
      ComponentConfig extends CanonicalComponentConfig ? true : false,
      CanonicalComponentConfig extends ComponentConfig ? true : false,
    ] = [true, true];

    expect(bothWays).toEqual([true, true]);
  });
});

const REGISTRY_SRC = readFileSync(
  fileURLToPath(new URL('../Registry.ts', import.meta.url)),
  'utf8',
);

/** The re-export that makes this package share `@object-ui/types`' declaration. */
const RE_EXPORT = "export type { ComponentConfig } from '@object-ui/types';";

/** The named extension that keeps the registry-only keys on the entry type. */
const NAMED_EXTENSION = 'export type RegistryComponentConfig<T = any> = ComponentConfig<T> &';

/** A local declaration of the contested name, in either spelling. */
const LOCAL_DECLARATION = /^\s*export\s+(?:declare\s+)?(?:interface|type)\s+ComponentConfig\b/m;

/** The same shape for a name this file legitimately DOES declare — the control. */
const LOCAL_EXTENSION_DECLARATION =
  /^\s*export\s+(?:declare\s+)?(?:interface|type)\s+RegistryComponentConfig\b/m;

describe('ComponentConfig — the source-identity pin', () => {
  it('re-exports the canonical declaration and names the extension', () => {
    expect(REGISTRY_SRC).toContain(RE_EXPORT);
    expect(REGISTRY_SRC).toContain(NAMED_EXTENSION);
  });

  it('declares no `ComponentConfig` of its own', () => {
    // This is THE pin. Every type-level assertion above stays green on a
    // member-identical structural COPY — that is objectui#4580's ruling and the
    // state this file exists to make unreachable. It is also what keeps the
    // `KNOWN_COLLISIONS` row deleted: that gate counts a declaration here as a
    // second authority and does not count the re-export.
    expect(LOCAL_DECLARATION.test(REGISTRY_SRC)).toBe(false);
  });

  it('still matches the declaration it is meant to match — the pattern control', () => {
    // A regex that matched nothing anywhere would pass the assertion above on
    // any tree, including a re-diverged one. `RegistryComponentConfig` is
    // declared here on purpose and has the identical shape, so the pattern is
    // demonstrably live. It also proves the anchoring: the assertion above did
    // not merely fail to see `RegistryComponentConfig`.
    expect(LOCAL_EXTENSION_DECLARATION.test(REGISTRY_SRC)).toBe(true);
  });
});
