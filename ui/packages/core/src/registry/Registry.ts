/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ComponentMeta as CanonicalComponentMeta } from '@object-ui/types';
// Deliberately a SECOND import statement from the same module rather than a
// widening of the line above: `__tests__/component-meta-derives-from-canonical.test.ts`
// pins that line as an exact string (objectui#6067's source-identity assertion),
// so adding a specifier to it would red a pin that has nothing to do with this
// name. Two `import type` lines from one module is legal and costs nothing —
// type imports are erased.
import type { ComponentConfig } from '@object-ui/types';
// A THIRD `import type` from the same module, for the same reason as the
// second: the line above is the shape objectui#6298's pin reads, so the name
// the splice below is typed with (`9e37d9b39`) gets its own line.
import type { InjectedComponentInput } from '@object-ui/types';
import {
  ELEMENT_DATA_SOURCE_INPUT,
  isElementDataSourceBlock,
} from '../data-scope/element-data-source.js';
import { PUBLIC_BLOCKS } from './public-blocks.js';
import { HTML_TIER_INTRINSICS } from './html-tier-intrinsics.js';

/**
 * The renderer a registration carries — the IDENTITY alias, deliberately.
 *
 * ⚠️ Load-bearing for objectui#6298, which is why it is documented rather than
 * left as a bare line. `ComponentRenderer<T>` resolves to `T` and contributes
 * NO type information: that is the entire reason `@object-ui/types` can declare
 * the one `ComponentConfig` with `component: T` and mean exactly what this
 * package used to mean by `component: ComponentRenderer<T>`, WITHOUT
 * `@object-ui/types` needing to reach this declaration. It could not have
 * reached it: `@object-ui/types` is the bottom layer (`packages/types/package.json`
 * depends on `@objectstack/spec` and `zod` only) and this package depends on it,
 * so an edge in that direction would be a cycle.
 *
 * The alias survives as the NAME this package's own renderer-shaped positions
 * are spelled with ({@link withElementDataSourceInput}, {@link PublicComponentConfig}).
 * If it is ever given real content, `component: T` over in `@object-ui/types`
 * stops being the same slot — `__tests__/component-config-single-declaration.test.ts`
 * asserts the identity so that change cannot pass unnoticed.
 */
export type ComponentRenderer<T = any> = T;

/**
 * What a registration DECLARES about one authorable prop.
 *
 * This is the declaration the component registrations themselves import, so it
 * is the one an author's manifest is ultimately built from — and it is now
 * RE-EXPORTED from `@object-ui/types` rather than restated here
 * (objectui#4972), the disposition objectui#4580 ruled for the identical
 * shape: *a structural copy would reproduce the defect the moment either side
 * moved.* This package already depends on `@object-ui/types`, so the edge
 * exists and adds no cycle, and `src/types/index.ts` re-exports `SchemaNode`
 * from there the same way.
 *
 * The copy this replaces had ALREADY moved, which is why the card is not
 * hypothetical: it carried nine keys while `base.ts` carried thirteen, so
 * `min` / `max` / `step` / `placeholder` were missing from *the copy every
 * registration actually imports*. Those four keys were therefore unwritable at
 * any real registration — a plain TS error — while `ComponentInputSchema` (the
 * zod schema) and `ComponentMeta.inputs` both accepted them. The publication
 * face advertised four keys the authoring face rejected; the divergence was
 * dormant only because no registration had tried to write one yet.
 */
export type { ComponentInput } from '@object-ui/types';

/**
 * An AUTHORING SURFACE a component type can be reached from — the two this
 * engine has, named as its own code already names them.
 *
 * - `'json'` — the JSON/SDUI authoring surface. A node an author (or an AI)
 *   writes as `{ "type": "…" }` in metadata.
 * - `'html'` — a `kind:'html'` page, written as constrained JSX text that
 *   `@object-ui/sdui-parser` COMPILES (never executes) into SDUI nodes, tag
 *   name straight through. `isHtmlTierNode` marks what that parser emitted.
 *
 * The distinction is not decorative here: it is the whole reason
 * {@link ComponentDeprecation} carries a surface list rather than a boolean.
 */
export type AuthoringSurface = 'json' | 'html';

/**
 * That a component type is DEPRECATED for authoring — the machine-readable
 * statement of it (objectui#6674).
 *
 * ## Why this exists at all
 *
 * Before this type, a deprecation was stated in exactly two places, neither of
 * which any gate, test or type can consult: a `console.warn` STRING LITERAL
 * inside the renderer, and the word "(Deprecated)" inside a human-readable
 * `label`. So the question "is this type deprecated?" had no asker. The two
 * gates that touch component types — `examples/schema-catalog/test/
 * catalog-gallery-render.test.tsx` and `scripts/check-doc-component-types.mjs`
 * — both ask only whether a type RESOLVES, and a deprecated type resolves
 * perfectly well. The measurement objectui#6674 filed is what that costs: the
 * catalog suite passes 583/583 with 85 authored `div` nodes in the corpus. The
 * green was the finding.
 *
 * This is a layer BELOW the usual "declared but enforced nowhere" defect: there
 * was nothing declared to enforce.
 *
 * ## Why `surfaces` is required, and why a boolean would have been wrong
 *
 * `deprecated: true` would restate, as a contract, the exact falsehood the
 * maintainer ruled against on 2026-08-10 (objectui#4000): the `span` notice is
 * scoped BY PROVENANCE because that tag is deprecated on the JSON surface and
 * simultaneously vocabulary of the `kind:'html'` tier — an author there writes
 * the plain tag, our own parser maps it straight through, and no other
 * spelling exists for them to migrate to. "A notice that says the type is
 * deprecated FULL STOP is therefore false for one of its two readers"
 * (`span.tsx`), and the reader it was false for was the one who could do
 * nothing about it. (`div` carried the same scope until ruling A on
 * objectstack#20112 deprecated it on the html surface too, with `box` as its
 * replacement; it now declares both surfaces — objectui#10757. The list is
 * what let that be one edit.) A declaration that dropped the scope
 * would hand every future gate the same false premise, in a form that is harder
 * to see than a console string. So the scope travels WITH the declaration, and
 * {@link Registry.deprecationFor} makes callers name the surface they are
 * asking about instead of re-deriving the exemption locally.
 *
 * ## What it deliberately does not do
 *
 * Nothing here fails a build, and nothing here deprecates anything: this is the
 * vocabulary plus the reader. Which types get marked, and when, is
 * objectui#3965's to decide — the ordering matters, because marking a type
 * while the corpus still authors it 85 times produces a red with nowhere to go.
 */
export type ComponentDeprecation = {
  /**
   * The surfaces on which authoring this type is deprecated. A surface NOT
   * listed keeps the type as first-class vocabulary there — that is the whole
   * content of the objectui#4000 ruling, said once, in the declaration.
   *
   * Required and expected non-empty: an empty list declares a deprecation that
   * applies to no reader, which is indistinguishable from not declaring one.
   */
  surfaces: AuthoringSurface[];
  /**
   * One line of migration guidance for the surfaces above — what to author
   * instead. Optional, but it is what makes a gate's failure ACTIONABLE: a gate
   * that can only say "deprecated" sends its reader back to the console string
   * this declaration exists to replace.
   */
  replacement?: string;
};

/**
 * The keys the REGISTRY adds on top of the one `ComponentMeta` declaration:
 * registration mechanics (`tier` / `namespace` / `skipFallback`), the
 * host-labelling contract (`labelling`), and the authoring-time
 * `deprecated` declaration. None of the five has a counterpart on
 * the general type in `@object-ui/types`, and none is being moved there —
 * publishing registry mechanics on the general type was the alternative
 * objectui#6067 weighed and rejected.
 *
 * They live in their OWN named type so that `RegistryComponentMeta` below can be
 * DERIVED from the canonical declaration instead of restating it. Until
 * objectui#6067 this file carried a second, thirteen-key structural copy of
 * the name: the nine shared members restated from `@object-ui/types`' `base.ts`,
 * these four added here, and `tags` / `description` — declared on the canonical
 * type and on the `ComponentMetaSchema` zod mirror — simply absent. That is
 * objectui#4580's ruling coming true for the third type in a row: *a
 * structural copy would reproduce the defect the moment either side moved.*
 * objectui#5671 executed the same convergence for `ComponentInput` in this very
 * file, and objectui#5893 closed the identical two-key delta inside
 * `@object-ui/types`.
 */
export type RegistryComponentMetaExtras = {
  /**
   * Public contract tier (ADR-0080). `'public'` = part of the curated,
   * type-checked, AI-facing block set (gets a strengthened contract, the
   * JSX type surface, the api-surface ratchet, and customer docs). Undefined
   * or `'internal'` = rendering capability only, not part of the contract.
   */
  tier?: 'public' | 'internal';
  namespace?: string; // Component namespace (e.g., 'ui', 'plugin-grid', 'field')
  /**
   * When true, prevents the component from being registered with a non-namespaced fallback.
   * Use this when a component should only be accessible via its full namespaced key.
   * This avoids conflicts with other components that share the same base name.
   *
   * ⚠️ That promise covers BOTH registry tables since objectui#9839, and it did
   * not before. Declining the bare key used to leave `register` deleting a bare
   * lazy stub anyway, so a registration that opted out still took the bare key
   * off its owner — and then refused to replace it, leaving it claimed by
   * nobody. An opt-out now leaves the bare key exactly where it was.
   *
   * @example
   * // Register as 'view:form' only, don't overwrite 'form'
   * registry.register('form', FormView, { namespace: 'view', skipFallback: true });
   */
  skipFallback?: boolean;
  /**
   * How a HOST must associate its own visible label with what this component
   * renders (objectui#3961, extended by objectui#4857). Read by the form
   * renderer; absent ⇒ `'control'`. This closed three-value vocabulary is the
   * single repo-wide answer to "how does a host learn what a widget will
   * render" (maintainer ruling of 2026-08-17, joint with objectui#4871) — no
   * host may keep a local variant of it.
   *
   * - `'control'` — the component's outermost rendered element is a LABELABLE
   *   HTML element (`input` / `textarea` / `select` / `button` / …), so the host
   *   associates its label the plain way: `<label for>` → the id the host handed
   *   down. This is the default and covers every single-control widget.
   * - `'group'` — it is NOT labelable: either a real composite (several inputs
   *   under one container, e.g. `address`) or a single control that is not a
   *   labelable element (a `div[role="button"]` dropzone, e.g. `file`). A
   *   `<label for>` pointing at such an element is inert in HTML — it activates
   *   nothing and contributes no accessible name (`HTMLLabelElement.control` is
   *   `null`) — so the host must instead give its label an `id` and hand the
   *   component `aria-labelledby`, which associates by IDREF and works on any
   *   element. The COMPONENT consumes those keys on its own surface.
   * - `'display'` — the rendered surface is a pure display in EVERY state:
   *   there is no focusable control and the component itself spreads nothing
   *   (computed / system-generated values such as `formula` / `summary` /
   *   `auto_number` / `vector`). The host must not emit a `<label for>` at all
   *   — no labelable element will ever exist for it to reach, in the editable
   *   state as much as the readonly one — and instead wraps the component's
   *   output in the host's own container carrying the field id,
   *   `aria-labelledby`, `aria-describedby` and `role="group"` (the
   *   objectui#4788 channel, driven by this declaration rather than by
   *   `readonly` alone). Unlike `'group'`, the WIDGET is not expected to
   *   consume anything: the host's wrapper is the named surface.
   *
   * This is a DECLARATION, not a guess: the host cannot infer it from the DOM a
   * widget happens to render, and a widget that fails to declare it falls back
   * to the `'control'` path where the dangling/inert `for` is caught by the
   * label-association tests (objectui#3952) instead of silently producing an
   * unlabelled group.
   */
  labelling?: 'control' | 'group' | 'display';
  /**
   * That authoring this type is DEPRECATED, and on which surfaces
   * (objectui#6674). Absent ⇒ not deprecated anywhere; see
   * {@link ComponentDeprecation} for why the surfaces are part of the
   * declaration rather than a boolean, and {@link Registry.deprecationFor} for
   * the reader a gate asks.
   *
   * This is a DECLARATION about the TYPE, which is why it sits on the
   * registration rather than on a node: every node of a deprecated type is
   * deprecated, and the one place that fact can be stated once is where the
   * type is registered.
   */
  deprecated?: ComponentDeprecation;
};

/**
 * What a registration DECLARES about one component — the type every
 * `ComponentRegistry.register` / `registerLazy` call is checked against.
 *
 * ONE declaration of the shared members: this is `@object-ui/types`'
 * `ComponentMeta` (the declaration `ComponentMetaSchema` mirrors and the
 * plugin-facing surface publishes) intersected with the registry-only keys
 * above. The nine shared members are no longer restated here, so they cannot
 * drift again, and `tags` / `description` now reach the registration surface —
 * the two keys the divergence had made unwritable at the very declaration most
 * component registrations import.
 *
 * ## Its own NAME since objectui#6349 (batch 4)
 *
 * This type used to be published as `ComponentMeta` too — the same name as the
 * canonical declaration it extends, with a different meaning (registration
 * metadata: the canonical members PLUS the five registry-only keys). A derived
 * declaration is still a second authority for the name, so the card's rename
 * branch applies: the registration type is `RegistryComponentMeta` (the name
 * `PluginScopeImpl.ts` already gave it locally), and `ComponentMeta` from this
 * package is a plain re-export of `@object-ui/types`' one (just below). The
 * registry's own doors — `register`, `registerLazy`, `getMeta` — are typed
 * with this name, so a registration literal keeps accepting the registry keys.
 *
 * NOTE for anyone pinning this: every member of both halves is OPTIONAL, so
 * `extends` is mutually TRUE between the two shapes even when their key sets
 * differ. Measured on the EMITTED `.d.ts` of both packages immediately before
 * this convergence: `Core extends Canonical` and `Canonical extends Core` were
 * BOTH `true` while `tags` / `description` were missing and four keys were
 * extra. An assignability assertion is therefore a ghost here — it was green on
 * the diverged tree. `__tests__/component-meta-derives-from-canonical.test.ts`
 * compares `keyof` sets instead and keeps the assignability check beside it as
 * the labelled control that shows why.
 */
export type RegistryComponentMeta = CanonicalComponentMeta & RegistryComponentMetaExtras;

/**
 * The general component metadata — `@object-ui/types`' ONE declaration,
 * re-exported so an import of `ComponentMeta` from this package resolves to
 * the same type as one from `@object-ui/types` (objectui#6349, batch 4). It
 * carries none of the registry-only keys; a registration is typed with
 * {@link RegistryComponentMeta}.
 */
export type { ComponentMeta } from '@object-ui/types';

/**
 * ONE authority for `ComponentConfig` (objectui#6298) — this package RE-EXPORTS
 * `@object-ui/types`' declaration instead of declaring a second one, the same
 * disposition objectui#5671 gave `ComponentInput` a few lines above and
 * objectui#4580 ruled for the whole family: *a structural copy would reproduce
 * the defect the moment either side moved.*
 *
 * ## What was wrong
 *
 * Both spellings were PUBLISHED — `@object-ui/types`' `src/index.ts` exports its
 * one, and this file reaches `@object-ui/core`'s public entry through
 * `src/index.ts`'s `export * from './registry/Registry.js'`. An IDE auto-import
 * therefore picked between two different types by alphabetical order. After
 * objectui#6067 / PR #6297 single-sourced the `ComponentMeta` half, what still
 * differed was GENERICITY AND THE `component` SLOT: `@object-ui/types`' was
 * non-generic with `component: any`, this one was `<T = any>` with
 * `component: ComponentRenderer<T>`.
 *
 * ⚠️ Measured on the EMITTED `.d.ts` of both packages immediately before this
 * convergence, `Exact<TypesConfig, CoreConfig>` — mutual assignability — read
 * `true` on the DIVERGED pair, because `component: any` absorbs everything and
 * every other member is optional. An assignability assertion is a GHOST here,
 * exactly as `__tests__/component-meta-derives-from-canonical.test.ts` records
 * for the sibling type. The readings that actually moved were "is
 * `@object-ui/types`' declaration generic" (`TS2315: Type 'ComponentConfig' is
 * not generic` before, no error after) and the symmetric key-set difference.
 *
 * A re-export is not a second authority — `scripts/__tests__/one-authority-per-exported-name-6273.test.ts`
 * counts declarations and ALIASING re-exports, never `export type { X } from …`
 * — which is why this convergence takes `ComponentConfig` off that gate's
 * `KNOWN_COLLISIONS` baseline. Deriving a new declaration here instead would
 * NOT have: `ComponentMeta` was converged that way by PR #6297 and stayed a row
 * on that baseline until objectui#6349 gave the registry's declaration its own
 * name, `RegistryComponentMeta`.
 */
export type { ComponentConfig } from '@object-ui/types';

/**
 * What the registry actually STORES and hands back — `ComponentConfig` plus the
 * registry-only keys, as a NAMED extension (objectui#6298).
 *
 * This is type-identical to the `ComponentConfig` this file used to declare:
 * `CanonicalComponentMeta & RegistryComponentMetaExtras & { type; component }`,
 * reached from the other side. The two halves are named rather than restated —
 * one declaration for the shared members ({@link ComponentConfig}, in
 * `@object-ui/types`), a named extension for the rest
 * ({@link RegistryComponentMetaExtras}) — which is the shape PR #6297 gave
 * {@link RegistryComponentMeta}.
 *
 * It exists because the extras are NOT optional decoration on a registry entry:
 * {@link Registry.getNamespaceComponents} filters on `config.namespace`, and
 * `tier` / `labelling` / `deprecated` are read off registrations elsewhere. A
 * bare re-export as the entry type would have silently dropped them.
 *
 * ⚠️ `ComponentConfig` remains the AUTHORING vocabulary and the general name;
 * registrations are checked against {@link RegistryComponentMeta}, never against this.
 * Nothing writes a `RegistryComponentConfig` literal — the registry builds them.
 */
export type RegistryComponentConfig<T = any> = ComponentConfig<T> &
  RegistryComponentMetaExtras;

/**
 * A CONTRACT-surface entry (ADR-0080), as returned by
 * {@link Registry.getPublicConfigs}.
 *
 * Same shape as {@link RegistryComponentConfig} except `component` is absent while the
 * entry is still a pending `registerLazy` stub: the plugin module has not been
 * imported yet, so there is no renderer to hand out. Consumers render such an
 * entry through `SchemaRenderer`, which triggers the loader and shows a
 * placeholder in the meantime (objectui#2953).
 *
 * `tier` is widened by one PROJECTION-ONLY value, `'html'`: an entry the html
 * tier's intrinsic roster contributed (objectui#10735). No registration
 * declares it — `RegistryComponentMetaExtras.tier` stays `'public' | 'internal'`
 * — the read stamps it, and `manifestFromConfigs` carries it into the manifest
 * so a consumer that means the CURATED vocabulary can filter it out.
 */
export type PublicComponentConfig<T = any> = Omit<RegistryComponentMeta, 'tier'> & {
  type: string;
  /**
   * The registration's declared tier, or `'html'` for an entry that reaches the
   * contract through {@link HTML_TIER_INTRINSICS} rather than through the
   * curated roster or a `tier: 'public'` opt-in. Absent or `'public'` = the
   * curated JSON-surface vocabulary.
   */
  tier?: RegistryComponentMeta['tier'] | 'html';
  component?: ComponentRenderer<T>;
  /** True while this entry is a `registerLazy` stub whose loader has not run. */
  lazy?: boolean;
};

/**
 * Lazy loader function used by `Registry.registerLazy`. The loader is invoked
 * the first time a missing component type is requested through `getAsync`/the
 * SchemaRenderer fallback path, and is expected to perform a dynamic
 * `import()` of a plugin module whose top-level side-effects call
 * `register()` for that type.
 */
export type LazyComponentLoader = () => Promise<unknown>;

type LazyEntry = {
  loader: LazyComponentLoader;
  meta?: RegistryComponentMeta;
  /**
   * The full type this stub DECLARES — `namespace:type`, or the bare type with
   * no namespace. Written once, by `registerLazy`, on the line that computes the
   * key the entry is stored under, and read by every collision guard that asks
   * who a stub belongs to (objectui#11680).
   *
   * ⭐ Recorded rather than recomputed, because the entry is stored under TWO
   * keys, its full type and its bare one, and a lookup cannot tell which of
   * the two it hit. The helper this field replaces re-derived the claim as
   * "the entry's namespace, prefixed onto the key it was looked up under".
   * That is right for the bare key and doubles the namespace for the full key:
   * the protocol placeholder for `view:calendar` claims the bare key
   * `view:calendar`, finds the console's stub under its FULL key, and the race
   * warning named the stub's claim as `view:view:calendar`, a type nothing
   * declares. The ownership comparisons in `register`, `registerLazy` and
   * `unregister` read the same doubled spelling.
   */
  fullType: string;
  /** Pending import promise — reused when multiple consumers race. */
  pending?: Promise<unknown>;
};

/**
 * Emit the spec's `dataSource` input for a registration whose renderer wraps
 * `ElementDataSourceGate` (objectui#6678).
 *
 * ## The one place, and why it is this one
 *
 * The maintainer ruling of 2026-08-29 adopted option B **in the injection
 * form**: the declaration is emitted mechanically at the wrapping seam so every
 * gate-wrapping registration declares the key from the same place that reads it
 * — one mechanism rather than nine hand-kept copies across nine packages, which
 * drift and which a tenth block would simply forget. `register()` is where every
 * one of those registrations passes through, so it is where the emission lands;
 * the DECLARATION itself is `ELEMENT_DATA_SOURCE_INPUT`, which lives beside the
 * binding's own semantics in `data-scope/element-data-source.ts`.
 *
 * ## What it must NOT do, which is half the ruling
 *
 * Widening this to every registration is option A wearing a different hat: it
 * would silence `dataSource` on `flex` and `card`, which do not read it, and the
 * diagnostic would lie in the other direction instead of the one it lied in
 * before. So the condition is the marker and nothing else — no heuristic over
 * `objectName`, no "looks object-bound".
 *
 * ## Idempotent, and it never overwrites
 *
 * A registration that declares `dataSource` ITSELF keeps its own entry: the
 * emission fills a gap, it does not own the key. (Nothing declares it today —
 * that is the defect — but a block whose binding needs a narrower description
 * later must be able to say so without fighting this function.) Re-registering
 * the same component, which the registry allows and tests do constantly, is
 * likewise a no-op rather than a growing `inputs` array.
 *
 * ## Typed end to end — the cast is gone (`9e37d9b39`)
 *
 * The spliced element is an `InjectedComponentInput` (`@object-ui/types`): a
 * `ComponentInput` plus the framework-set `binding` marker, so it is a plain
 * subtype of the array's element type and the return value type-checks as a
 * `RegistryComponentMeta` with no assertion. This used to read `as ComponentMeta`,
 * because `ELEMENT_DATA_SOURCE_INPUT` carried a hand-written inline type and
 * `binding` had no declared home — and a cast at the one place the key is
 * written is exactly what would have hidden any later drift between the
 * constant and the type. The absence is held by `eslint.config.js`, which
 * scopes `@typescript-eslint/consistent-type-assertions` with
 * `assertionStyle: 'never'` to THIS FILE (objectui#8316) — an AST rule,
 * because `tsc --noEmit` stays at exit 0 with the cast re-added and the
 * source-text pin that used to stand here was green for `<ComponentMeta>{…}`,
 * the same assertion in the other spelling.
 * `packages/types/src/__tests__/injected-component-input-6950.test.ts` still
 * pins the positive half, that the local below is ANNOTATED. Keep it typed: if
 * the shape ever stops fitting, that line is where the compiler should say so.
 */
export function withElementDataSourceInput<T>(
  component: ComponentRenderer<T>,
  meta?: RegistryComponentMeta,
): RegistryComponentMeta | undefined {
  if (!isElementDataSourceBlock(component)) return meta;
  const inputs: NonNullable<RegistryComponentMeta['inputs']> = meta?.inputs ?? [];
  if (inputs.some((input) => input?.name === ELEMENT_DATA_SOURCE_INPUT.name)) return meta;
  const injected: InjectedComponentInput = { ...ELEMENT_DATA_SOURCE_INPUT };
  return { ...(meta ?? {}), inputs: [...inputs, injected] };
}

export class Registry<T = any> {
  private components = new Map<string, RegistryComponentConfig<T>>();
  private lazyEntries = new Map<string, LazyEntry>();
  /**
   * Notifies subscribers that the registry has changed (new components
   * registered). Used by SchemaRenderer to re-render after a lazy plugin
   * load completes.
   */
  private listeners = new Set<() => void>();
  /**
   * Bumped whenever the set of KNOWN types changes — a registration, an
   * unregistration, or a new lazy stub. A cheap cache key for consumers that
   * derive something from the whole registry (whitelists, manifests, palettes)
   * and need to rebuild when it grows. Counting types is not a substitute: a
   * registration paired with an unregistration leaves the count untouched.
   */
  private version = 0;

  /**
   * Register a component with optional namespace support.
   * If namespace is provided in meta, the component will be registered as "namespace:type".
   * 
   * @param type - Component type identifier
   * @param component - Component renderer
   * @param meta - Component metadata (including optional namespace)
   * 
   * @example
   * // Register with namespace
   * registry.register('button', ButtonComponent, { namespace: 'ui' });
   * // Accessible as 'ui:button' or 'button' (fallback)
   * 
   * @example
   * // Register without namespace (backward compatible)
   * registry.register('button', ButtonComponent);
   * // Accessible as 'button'
   */
  register(type: string, component: ComponentRenderer<T>, meta?: RegistryComponentMeta) {
    const fullType = meta?.namespace ? `${meta.namespace}:${type}` : type;
    // The `dataSource` declaration is EMITTED here, not written by the blocks
    // (objectui#6678). See `withElementDataSourceInput`.
    const resolvedMeta = withElementDataSourceInput(component, meta);
    
    // Warn if registering without namespace (deprecated pattern)
    if (!meta?.namespace) {
      console.warn(
        `Registering component "${type}" without a namespace is deprecated. ` +
        `Please provide a namespace in the meta parameter.\n\n` +
        `  Migration:\n` +
        `  // Before (deprecated):\n` +
        `  registry.register('${type}', MyComponent);\n\n` +
        `  // After:\n` +
        `  registry.register('${type}', MyComponent, { namespace: 'my-plugin' });\n\n` +
        `  See: https://www.objectui.org/docs/guide/plugin-development#namespaced-registration`
      );
    }
    
    if (this.components.has(fullType)) {
      // console.warn(`Component type "${fullType}" is already registered. Overwriting.`);
    }
    
    this.components.set(fullType, {
      type: fullType,
      component,
      ...resolvedMeta
    });
    
    // Also register without namespace for backward compatibility
    // This allows "button" to work even when registered as "ui:button"
    // Note: If multiple namespaced components share the same short name,
    // the last registration wins for non-namespaced lookups
    // Skip this if skipFallback is true to avoid overwriting other components
    if (meta?.namespace && !meta?.skipFallback) {
      // Collision guard: a bare-name fallback that overwrites a DIFFERENT
      // component is almost always an accident (e.g. plugin 'view:grid' silently
      // clobbering the layout 'grid'). Warn so it surfaces instead of 404-ing at
      // render time. Pass `skipFallback: true` when a namespaced-only alias is
      // intended.
      const existing = this.components.get(type);
      if (existing && existing.component !== component && existing.type !== fullType) {
        console.warn(
          `Component "${type}" bare-name fallback is being overwritten by "${fullType}". ` +
          `If this is intentional keep going; otherwise register "${fullType}" with ` +
          `{ skipFallback: true } so it doesn't claim the bare "${type}" key.`,
        );
      } else if (!existing) {
        // The CROSS-TABLE half of the same guard (objectui#9821), and the half
        // the contest objectui#9533 measured actually went through. The check
        // above reads `components` only, so a bare key held by a pending STUB
        // is invisible to it: the console declared bare `dashboard` for
        // `plugin-dashboard:dashboard` at boot, this door took the same bare key
        // for `view:dashboard` when the chunk landed, and because `components`
        // still held nothing under `dashboard` at that moment, NOTHING warned.
        // Measured, not reasoned: replaying that card's three real claimants
        // against a real registry emitted zero warnings in BOTH orders.
        //
        // ⚠️ The guard has to fire HERE and not only in `registerLazy`, because
        // a contest that is only reported in one registration order is reported
        // in the order this repository does not boot in. The `report-` and
        // `timeline-bare-key-ownership` pins replay both orders for exactly
        // that reason.
        //
        // ⭐ The remedy this warning names CHANGED with objectui#9839, and it
        // changed because the behaviour behind it did. It used to send the
        // author away from `skipFallback: true` — correctly at the time, since
        // this door cleared the bare stub outside the fallback branch, so the
        // opt-out left the bare key resolving to nothing at all. The delete is
        // now inside the branch, so declining the bare key leaves it with its
        // owner and the opt-out settles this contest exactly as it does on the
        // lazy door. Both doors therefore prescribe the same thing now, which
        // `each door prescribes the remedy that is true for it` pins.
        const stubType = this.lazyEntries.get(type)?.fullType;
        if (stubType && stubType !== fullType) {
          console.warn(
            `Component "${type}" bare-name fallback is being overwritten by "${fullType}", ` +
            `which a pending lazy stub already claims for "${stubType}". Which one an ` +
            `authored "${type}" node resolves to depends on whether that chunk has loaded. ` +
            `If this is intentional keep going; otherwise register "${fullType}" with ` +
            `{ skipFallback: true } so it doesn't claim the bare "${type}" key — that ` +
            `opt-out settles it, because the bare "${type}" key is then left with ` +
            `"${stubType}".`,
          );
        }
      }
      this.components.set(type, {
        type: fullType, // Keep reference to namespaced type
        component,
        ...resolvedMeta
      });
      // The bare key now resolves to THIS registration, so the bare stub is
      // ours to clear. It is cleared here — inside the branch, under the same
      // predicate that took the key — and deliberately not below (objectui#9839).
      this.lazyEntries.delete(type);
    }

    // A real component is now available — clear the stub for the key this
    // registration actually claimed, so we don't keep holding the loader
    // reference, and notify subscribers.
    //
    // ⭐ `fullType` only. With no namespace `fullType === type`, so a bare
    // registration still clears the bare stub — it claimed the bare key. What
    // this line must NOT do is clear a bare stub the registration DECLINED:
    // `skipFallback: true` skips the branch above, so `components` is never
    // written under the bare key, and deleting the stub here took the bare key
    // away from its owner and gave it to nobody — the stub was gone and this
    // registration had refused to replace it (objectui#9839). A registration
    // that opts out of the bare key opts out of clearing it too.
    this.lazyEntries.delete(fullType);
    this.notify();
  }

  /**
   * Remove a previously registered component. Mirrors {@link register} by
   * clearing both the namespaced key and the bare-name fallback (when the
   * fallback still points at this registration), plus any matching lazy stub —
   * where "matching" means the same thing on both tables: a stub that still
   * belongs to THIS registration (objectui#9839).
   * Notifies subscribers only when something was actually removed.
   *
   * ⭐ Why "matching" cannot mean "a stub under either key". This function
   * already answers that question for the bare `components` key and answers it
   * "ownership" — it will not drop bare `dashboard` when it resolves to
   * `plugin-dashboard:dashboard`. Reading the next line as an unconditional
   * delete makes the SAME call, on the SAME bare key, with the SAME owner,
   * take the opposite decision purely because the owner happens to be sitting
   * in the other table at that instant — and which table it is sitting in is
   * exactly the "has the chunk loaded yet" race that objectui#9533 and
   * objectui#9821 are about. A policy that flips on chunk-load timing is not a
   * policy, so the stub gets the ownership test too.
   *
   * ⚠️ The BARE form (`unregister(type)` with no namespace) is unchanged and
   * is still the unconditional one, on both tables: `fullType === type` there,
   * so the deletes below address the bare key directly. That is the "force"
   * form teardown sites pair with the namespaced call, and taking it away
   * would break them.
   *
   * Mainly used by tests that install a stub renderer and need to restore the
   * prior registry state on teardown, since the registry is a process-level
   * singleton shared across test files.
   */
  unregister(type: string, namespace?: string): boolean {
    const fullType = namespace ? `${namespace}:${type}` : type;
    const removed = this.components.delete(fullType);
    // Only drop the bare fallback if it still resolves to this registration.
    if (namespace) {
      const bare = this.components.get(type);
      if (bare && bare.type === fullType) this.components.delete(type);
    }
    this.lazyEntries.delete(fullType);
    // The same ownership test, on the other table.
    if (namespace) {
      const bareStub = this.lazyEntries.get(type);
      if (bareStub && bareStub.fullType === fullType) {
        this.lazyEntries.delete(type);
      }
    }
    if (removed) this.notify();
    return removed;
  }

  /**
   * Register a lazy-loaded component. The `loader` is a function returning a
   * dynamic `import()` whose target module performs `register()` calls for
   * the given `type` as a top-level side effect.
   *
   * The loader will be invoked the first time `loadLazy(type)` is called (or
   * the first time the SchemaRenderer encounters an unknown component that
   * matches a registered lazy type). Subsequent registrations are idempotent.
   *
   * @example
   * ComponentRegistry.registerLazy('object-map', () => import('@object-ui/plugin-map'), { namespace: 'plugin-map' });
   */
  registerLazy(type: string, loader: LazyComponentLoader, meta?: RegistryComponentMeta) {
    const fullType = meta?.namespace ? `${meta.namespace}:${type}` : type;
    const entry: LazyEntry = { loader, meta, fullType };
    this.lazyEntries.set(fullType, entry);
    if (meta?.namespace && !meta?.skipFallback) {
      // Collision guard (objectui#9821). This door took the same bare-name
      // fallback branch as `register` with no check at all, so a stub could
      // take the bare key off another declaration in total silence — and the
      // silence is why the class stayed invisible: two of the three claimants
      // in the contest objectui#9533 filed came in through here.
      //
      // ⭐ The predicate keys on the FULL TYPE and reads BOTH tables, and both
      // halves of that were decided by the census rather than chosen:
      //
      //   - BOTH tables, because the contention is cross-table. Copying the
      //     guard above verbatim would compare `lazyEntries` against itself,
      //     and the one contested bare key on this tree is a stub in this table
      //     against a loaded registration in the other one. A same-table check
      //     would not have caught the card that produced this one.
      //   - FULL TYPE and not loader identity, because the ordinary correct
      //     shape here is a stub re-declared with a DIFFERENT loader closure
      //     for the SAME full type: two console files drive the same plugin
      //     set, and nine of this tree's bare keys are registered twice that
      //     way. Keying on the loader would warn on all nine, every boot.
      //
      // Census taken on the declared population of this repository (the same
      // one `check-registry-bare-name-collisions.mjs` reads): of 31 bare keys
      // a stub claims, 30 name exactly one full type across both tables — the
      // stub-then-real lifecycle this must stay silent about — and one is a
      // genuine contest.
      const loaded = this.components.get(type);
      const priorStub = loaded ? undefined : this.lazyEntries.get(type);
      const claimedBy = loaded ? loaded.type : priorStub?.fullType;
      if (claimedBy && claimedBy !== fullType) {
        console.warn(
          `Lazy component "${type}" bare-name fallback is being overwritten by "${fullType}", ` +
          `which ${loaded ? 'a loaded registration' : 'another pending stub'} already claims ` +
          `for "${claimedBy}". If this is intentional keep going; otherwise register ` +
          `"${fullType}" with { skipFallback: true } so it doesn't claim the bare "${type}" ` +
          `key — that opt-out settles it, because the stub then claims only ` +
          `"${fullType}".`,
        );
      }
      this.lazyEntries.set(type, entry);
    }
    // Bump the version but do NOT notify: the set of KNOWN types grew, so
    // whitelists and manifests must rebuild, but nothing new can render yet —
    // waking every subscriber for each stub at boot would be pure churn.
    this.version++;
  }

  /**
   * Returns true if `type` (or its namespaced form) has a registered lazy
   * loader awaiting first use.
   */
  hasLazy(type: string, namespace?: string): boolean {
    if (namespace) return this.lazyEntries.has(`${namespace}:${type}`);
    return this.lazyEntries.has(type);
  }

  /**
   * Trigger the lazy loader for `type`, if any. Resolves once the loader
   * completes (whether or not the loaded module actually registered the
   * expected type — caller should re-check the registry afterwards).
   * Returns `undefined` if no lazy entry matches.
   */
  loadLazy(type: string, namespace?: string): Promise<unknown> | undefined {
    const key = namespace ? `${namespace}:${type}` : type;
    const entry = this.lazyEntries.get(key);
    if (!entry) return undefined;
    if (!entry.pending) {
      entry.pending = entry.loader().catch((err) => {
        // Allow retries on failure by clearing the cached promise.
        entry.pending = undefined;
        throw err;
      });
    }
    return entry.pending;
  }

  /**
   * Subscribe to registry changes (component registrations). Returns an
   * unsubscribe function. Used by React renderers to re-render when a
   * lazy-loaded plugin finishes registering its components.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.version++;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[Registry] listener error', err);
      }
    }
  }

  /**
   * Monotonic counter of changes to the set of known types. Rebuild anything
   * derived from the whole registry when this moves — see {@link getKnownTypes}.
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Get a component by type. Supports both namespaced and non-namespaced lookups.
   * 
   * @param type - Component type (e.g., 'button' or 'ui:button')
   * @param namespace - Optional namespace for lookup priority
   * @returns Component renderer or undefined
   * 
   * @example
   * // Direct lookup
   * registry.get('ui:button') // Gets ui:button
   * 
   * @example
   * // Fallback lookup
   * registry.get('button') // Gets first registered button
   * 
   * @example
   * // Namespaced lookup with priority
   * registry.get('button', 'ui') // Tries 'ui:button' first, then 'button'
   */
  get(type: string, namespace?: string): ComponentRenderer<T> | undefined {
    // If namespace is explicitly provided, ONLY look in that namespace (no fallback)
    if (namespace) {
      const namespacedType = `${namespace}:${type}`;
      return this.components.get(namespacedType)?.component;
    }
    
    // When no namespace provided, use backward compatibility lookup
    return this.components.get(type)?.component;
  }

  /**
   * Get component configuration by type with namespace support.
   *
   * LOADED registrations only — a type that exists solely as a `registerLazy`
   * stub returns `undefined` here, because callers read `.component` off the
   * result and a stub has no renderer until its loader runs. The *contract*
   * question ("is this tag part of the public surface?") must not depend on
   * load order, so {@link getPublicConfigs} resolves lazy stubs separately
   * (objectui#2953). Use {@link hasLazy} / {@link loadLazy} to reach a stub.
   *
   * @param type - Component type (e.g., 'button' or 'ui:button')
   * @param namespace - Optional namespace for lookup priority
   * @returns Component configuration or undefined
   */
  getConfig(type: string, namespace?: string): RegistryComponentConfig<T> | undefined {
    // If namespace is explicitly provided, ONLY look in that namespace (no fallback)
    if (namespace) {
      const namespacedType = `${namespace}:${type}`;
      return this.components.get(namespacedType);
    }
    
    // When no namespace provided, use backward compatibility lookup
    return this.components.get(type);
  }

  /**
   * Check if a component type is registered.
   * 
   * @param type - Component type (e.g., 'button' or 'ui:button')
   * @param namespace - Optional namespace for lookup
   * @returns True if component is registered
   */
  has(type: string, namespace?: string): boolean {
    // If namespace is explicitly provided, ONLY look in that namespace (no fallback)
    if (namespace) {
      const namespacedType = `${namespace}:${type}`;
      return this.components.has(namespacedType);
    }
    // When no namespace provided, use backward compatibility lookup
    return this.components.has(type);
  }
  
  /**
   * Get all LOADED component types — what can be rendered right now.
   *
   * Pending `registerLazy` stubs are not included; use {@link getKnownTypes}
   * for the question "is this a type this app knows about", which is what a
   * whitelist or manifest wants (objectui#2953).
   *
   * @returns Array of all component type identifiers
   */
  getAllTypes(): string[] {
    return Array.from(this.components.keys());
  }

  /**
   * Every type the registry can resolve — loaded registrations PLUS pending
   * lazy stubs, deduped. Both the bare and namespaced keys are included, as
   * they are in {@link getAllTypes}.
   *
   * This is the set to build a whitelist or a manifest from. Keying one off
   * `getAllTypes()` instead makes it depend on which plugin chunks happen to
   * have loaded: a lazily-registered block gets rejected as unknown, and
   * whether it does varies by session (objectui#2953).
   */
  getKnownTypes(): string[] {
    return Array.from(new Set([...this.components.keys(), ...this.lazyEntries.keys()]));
  }

  /**
   * Metadata for `type` — from the loaded registration when there is one,
   * otherwise from a pending `registerLazy` stub.
   *
   * Use this when you need to know what a type IS (namespace, container-ness,
   * declared inputs). {@link getConfig} answers a different question — "can I
   * render this right now" — and is deliberately loaded-only, since callers
   * read `.component` off it.
   *
   * A stub carries only what `registerLazy` was given, so `inputs` is usually
   * absent until the chunk loads. Consumers should treat that as "not yet
   * known", not as "declares no props".
   */
  getMeta(type: string, namespace?: string): RegistryComponentMeta | undefined {
    const key = namespace ? `${namespace}:${type}` : type;
    return this.components.get(key) ?? this.lazyEntries.get(key)?.meta;
  }

  /**
   * The deprecation `type` declares FOR `surface` — or `undefined` when it
   * declares none there (objectui#6674).
   *
   * ## The question this makes askable
   *
   * "Is this type deprecated?" — which, before the {@link ComponentDeprecation}
   * declaration existed, nothing could ask. The only two statements of a
   * deprecation were a `console.warn` string literal in a renderer and the word
   * "(Deprecated)" inside a human `label`; no gate, test or type can consult
   * either. Both gates that touch component types ask whether a type RESOLVES,
   * and a deprecated type resolves.
   *
   * ## Why the caller must name a surface
   *
   * Because the honest answer differs by surface, and a reader that dropped the
   * distinction would let every caller re-derive it — which is how the same
   * exemption ends up written N times and wrong in N-1 of them. `span` is
   * deprecated for JSON-authored pages and is vocabulary of the `kind:'html'`
   * tier (objectui#4000). Asking `deprecationFor('span', 'html')` therefore
   * correctly answers `undefined` even when the type declares a `'json'`
   * deprecation, while `deprecationFor('div', 'html')` answers the declaration,
   * because `div` names both surfaces (objectui#10757). A gate over html-tier
   * sources gets the right answer for either without knowing the rulings: the
   * console's html compile reads exactly this to decide what it refuses.
   *
   * Returning the DECLARATION rather than a boolean is deliberate: the caller
   * that has to report the finding also needs `replacement` to say what to
   * author instead, and a boolean would send it back to the console string.
   *
   * Resolution is {@link getMeta}'s, so both spellings of a namespaced
   * registration answer alike (`div` and `ui:div`), a `skipFallback` type
   * answers only under its namespaced key, and a pending `registerLazy` stub
   * answers from the meta it was registered with.
   */
  deprecationFor(
    type: string,
    surface: AuthoringSurface,
    namespace?: string,
  ): ComponentDeprecation | undefined {
    const declared = this.getMeta(type, namespace)?.deprecated;
    if (!declared) return undefined;
    return declared.surfaces.includes(surface) ? declared : undefined;
  }

  /**
   * Get all registered component configurations.
   * 
   * @returns Array of all component configurations
   */
  getAllConfigs(): RegistryComponentConfig<T>[] {
    return Array.from(this.components.values());
  }

  /**
   * Resolve `tag` for the CONTRACT surface: the loaded registration when the
   * component is already in the registry, otherwise the metadata of a pending
   * `registerLazy` stub.
   *
   * A block registered lazily is a first-class member of the contract — the
   * loader is recorded at boot and the plugin chunk is imported on first use —
   * so contract membership must not hinge on whether that import happened to
   * have run yet (objectui#2953).
   */
  private getContractConfig(tag: string): PublicComponentConfig<T> | undefined {
    const loaded = this.components.get(tag);
    if (loaded) return loaded;
    const entry = this.lazyEntries.get(tag);
    if (!entry) return undefined;
    // Mirror registerLazy's key derivation so the canonical `type` matches the
    // one `register()` will store once the loader runs — that keeps the dedupe
    // below stable across the load. `tag` may already carry the namespace
    // (lazyEntries holds both keys; curated tags like `record:details` are
    // themselves colon-shaped), so don't prefix it twice.
    const ns = entry.meta?.namespace;
    const canonical = ns && !tag.startsWith(`${ns}:`) ? `${ns}:${tag}` : tag;
    return { ...entry.meta, type: canonical, lazy: true };
  }

  /**
   * Get the CONTRACT-surface component configs (ADR-0080) — what the published
   * `sdui.manifest.json` serialises. A subset of the full rendering capability
   * returned by {@link getAllConfigs}, made of two tiers:
   *
   *   - the curated PUBLIC tier — `PUBLIC_BLOCKS` plus registrations that opted
   *     in with `tier: 'public'` — the JSON-surface AI-authoring vocabulary;
   *   - the html tier's registered intrinsic elements — `HTML_TIER_INTRINSICS`,
   *     each entry stamped `tier: 'html'` (objectui#10735). A `kind:'html'` page
   *     may author these tags and the gate that reads the manifest must accept
   *     them; they are NOT part of the curated vocabulary, so a consumer that
   *     means that vocabulary alone — the `kind:'react'` JSX scope, the block
   *     list, a census of curated blocks — filters on the stamp.
   *
   * Includes blocks that are only lazily registered so far; those come back
   * with `lazy: true` and no `component` (see {@link PublicComponentConfig}).
   */
  getPublicConfigs(): PublicComponentConfig<T>[] {
    // Dedupe by the config's canonical (namespaced) `type` — a component is
    // registered under both a bare and a namespaced key pointing at the same
    // canonical type, and we want one contract entry per component.
    const seenCanonical = new Set<string>();
    const out: PublicComponentConfig<T>[] = [];
    const add = (tag: string, cfg: PublicComponentConfig<T> | undefined): void => {
      if (!cfg || seenCanonical.has(cfg.type)) return;
      seenCanonical.add(cfg.type);
      // The contract surface is keyed by the bare/curated tag authors write,
      // not the namespaced canonical stored on the config.
      out.push({ ...cfg, type: tag });
    };
    // Curated contract list first (stable, reviewable order) …
    for (const tag of PUBLIC_BLOCKS) add(tag, this.getContractConfig(tag));
    // … plus any bare registration that opted in explicitly via `tier: 'public'`.
    for (const [key, cfg] of this.components.entries()) {
      if (cfg.tier === 'public' && !key.includes(':')) add(key, cfg);
    }
    // … and the same opt-in for stubs whose loader has not run yet.
    for (const [key, entry] of this.lazyEntries.entries()) {
      if (entry.meta?.tier === 'public' && !key.includes(':')) add(key, this.getContractConfig(key));
    }
    // … and the html tier's registered intrinsic elements, LAST and STAMPED:
    // the dedupe above means a tag on both rosters comes out curated and
    // unstamped, which is why the two rosters are pinned disjoint. The stamp is
    // a projection, never written back onto the registration (objectui#10735).
    for (const tag of HTML_TIER_INTRINSICS) {
      const cfg = this.getContractConfig(tag);
      if (cfg) add(tag, { ...cfg, tier: 'html' });
    }
    return out;
  }
  
  /**
   * Get all components in a specific namespace.
   * 
   * @param namespace - Namespace to filter by
   * @returns Array of component configurations in the namespace
   */
  getNamespaceComponents(namespace: string): RegistryComponentConfig<T>[] {
    return Array.from(this.components.values()).filter(
      config => config.namespace === namespace
    );
  }
}

export const ComponentRegistry = new Registry<any>();
