/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Console ↔ public contract coverage (ADR-0080, objectui#2953).
 *
 * `PUBLIC_BLOCKS` is the curated contract and AI-authoring vocabulary. What an
 * author (or a model) can actually write is the intersection of that list with
 * what THIS APP registers — and nothing was checking the two against each
 * other. objectui#2953 is what that costs: `getPublicConfigs()` resolved each
 * curated tag through `getConfig()`, which reads loaded registrations only, so
 * every block the console registers via `registerLazy()` fell out of the
 * contract — and out of every `kind:'react'` page's scope — while type-check,
 * lint, build and the whole test suite stayed green.
 *
 * This reads the REAL registration list (`src/register-plugins.ts`, the same
 * module `main.tsx` boots from). A hand-copied list here would reproduce the
 * original failure: it would agree with itself and tell us nothing.
 *
 * The assertions are exact lists rather than "contains", because the failure
 * mode is a SHRINKING contract. `toContain` would sail past a block that
 * silently disappeared; an exact list makes both directions a deliberate edit.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry, PUBLIC_BLOCKS, type PublicComponentConfig } from '@object-ui/core';
import { LayoutSchema } from '@object-ui/types/zod';
import { ComponentPropsMap } from '@objectstack/spec/ui';
// The two graphs whose registrations this file reads. At module scope, NOT
// awaited inside a `beforeAll` — there their cold transform is billed to the
// hook, against `hookTimeout`, which is why this needed a 60s budget. The import
// phase has no test/hook timeout, so the raised timeout goes away rather than
// getting raised again (objectui#3010). See AGENTS.md §9 (test discipline).
//
// Loading them here rather than in a hook does not change WHAT is loaded, so the
// eager/lazy split the assertions below pin is untouched: static imports are
// evaluated in order before the module body, and the shared setup still runs
// before this module is imported at all.
//
// The layout/content primitives (Tier B) …
import '@object-ui/components';
// … and the console's own plugin layer, from the module main.tsx boots from.
import '../register-plugins';

/**
 * Every curated tag the console makes available, in `PUBLIC_BLOCKS` order.
 * Update this only alongside a deliberate change to what the console ships.
 */
const EXPECTED_COVERED = [
  'object-grid',
  'list-view',
  'object-form',
  'embeddable-form',
  'object-master-detail-form',
  'object-kanban',
  'object-calendar',
  'object-gantt',
  'object-timeline',
  'object-map',
  // Curated by objectui#10064 (the roster entry states the reasoning). Listed
  // here because this file's assertions are EXACT lists, so an admission the
  // console ships has to be a deliberate edit on both faces — which is the
  // property that makes a SHRINKING contract visible.
  'object-tree',
  'object-metric',
  'object-chart',
  'dashboard',
  'object-pivot',
  'record:details',
  'record:highlights',
  'record:related_list',
  'record:path',
  'record:line_items',
  'record:activity',
  'record:discussion',
  'record:history',
  'record:quick_actions',
  'record:reference_rail',
  'record:alert',
  'page:tabs',
  'page:card',
  'page:accordion',
  'page:section',
  'page:footer',
  'page:sidebar',
  'element:text',
  'element:number',
  'element:button',
  'element:definition-list',
  'element:repeater',
  'action:button',
  'action:group',
  'action:menu',
  'action:icon',
  'flex',
  'grid',
  'stack',
  'card',
  'tabs',
  'accordion',
  'container',
  'box',
  'page:header',
  'text',
  'image',
  'icon',
  'markdown',
  'element:divider',
  'badge',
  'alert',
  'button',
  'html',
];

/**
 * Curated tags with no renderer behind them yet — currently none.
 *
 * `PUBLIC_BLOCKS` is documented as aspirational-safe (an unregistered tag is
 * skipped), so a gap is allowed, but it has to be a listed, reviewable gap
 * rather than a silent one: "advertised in the contract, absent at runtime" is
 * exactly what an AI-authored page trips over.
 *
 * The one entry that used to sit here, `line_items`, was not aspirational at
 * all — it was a misspelling of `record:line_items`, whose renderer has shipped
 * in @object-ui/plugin-form all along. Keeping the list empty is what surfaces
 * the next one of those.
 */
const EXPECTED_UNIMPLEMENTED: string[] = [];

/**
 * The curated tags that reach the contract through a PENDING lazy stub in this
 * environment — i.e. the exact code path objectui#2953 broke. Nothing here is
 * eagerly imported by `register-plugins.ts` or by `vitest.setup.dom.tsx`.
 *
 * `dashboard` / `object-metric` / `object-pivot` are lazy in the real console
 * too, but the shared DOM setup imports `@object-ui/plugin-dashboard` eagerly,
 * so they arrive loaded here. That skew is precisely why the coverage
 * assertion above pins AVAILABILITY and not tier: whether a given block is
 * eager or lazy is a bundling decision that varies by host, while "the author
 * can write this tag" must not. If the shared setup ever imports one of the
 * plugins below, move that tag out of this list — it is still covered.
 */
const EXPECTED_LAZY = [
  'object-kanban',
  'object-calendar',
  'object-gantt',
  'object-timeline',
  'object-map',
  'object-tree',
  'object-chart',
  'markdown',
];

// Safe at module scope: the two side-effect imports at the top of this file are
// evaluated before the module body, so every registration is already in place.
const contract: Map<string, PublicComponentConfig> = new Map(
  ComponentRegistry.getPublicConfigs().map((c) => [c.type, c]),
);

describe('console ↔ PUBLIC_BLOCKS coverage', () => {
  it('exposes every curated block the console ships, eager or lazy', () => {
    expect(PUBLIC_BLOCKS.filter((tag) => contract.has(tag))).toEqual(EXPECTED_COVERED);
  });

  it('leaves exactly the known-unimplemented curated tags uncovered', () => {
    expect(PUBLIC_BLOCKS.filter((tag) => !contract.has(tag))).toEqual(EXPECTED_UNIMPLEMENTED);
  });

  it('reaches the lazily-registered blocks before their chunks load (objectui#2953)', () => {
    // If `getPublicConfigs()` ever goes back to resolving through `getConfig()`,
    // these seven vanish from the contract — silently, since the plugin chunk
    // that would prove them present is exactly the thing that hasn't loaded.
    const lazy = EXPECTED_COVERED.filter((tag) => contract.get(tag)!.lazy);
    expect(lazy).toEqual(EXPECTED_LAZY);
    // A pending stub carries metadata but no renderer — consumers must go
    // through SchemaRenderer, which triggers the loader.
    for (const tag of EXPECTED_LAZY) {
      expect(contract.get(tag)!.component).toBeUndefined();
    }
  });

  it('keeps the contract keyed by the bare tag authors write', () => {
    for (const tag of EXPECTED_COVERED) {
      expect(contract.get(tag)!.type).toBe(tag);
    }
  });
});

/**
 * The namespaces that hold semantic page blocks — the families the Studio page
 * designer offers and @objectstack/spec's page schema enumerates. These are
 * the ones the reverse-coverage guard sweeps: `ui:`/`field:`/plugin internals
 * are rendering capability, not vocabulary candidates.
 *
 * objectui#3023 guarded `record:` alone after fixing it, and 22 doubled keys
 * kept sitting in the other three — checking only the namespace you just fixed
 * is exactly the leak mechanism. Sweep all four.
 */
const SEMANTIC_NAMESPACES = ['record', 'page', 'element', 'action'] as const;

/**
 * Blocks in a semantic namespace that ship but are deliberately NOT in the AI
 * vocabulary, each with the reason it stays out.
 *
 * This list exists to force a decision, not to park problems: registering a
 * new block in any {@link SEMANTIC_NAMESPACES} namespace fails the test below
 * until it is either curated or added here with a reason. That is the property
 * objectui#3006 needed and did not have — `record:line_items` shipped fully
 * configurable and simply never reached the contract, because nothing looked
 * in this direction.
 *
 * Unlike the seven zero-input entries this list once held, several of these
 * DO declare inputs — they are excluded on the merits, not for want of a
 * configuration surface. The reasons for the four `element:` entries mirror
 * the Studio palette's own exclusions (`PALETTE_EXCLUSIONS` in
 * app-shell/metadata-admin), so the two vocabularies stay excluded for the
 * same reasons, not coincidentally.
 */
const DELIBERATELY_UNCURATED: Record<string, string> = {
  'record:chatter':
    'same renderer as record:discussion under a Salesforce-familiar name, kept for ' +
    'schemas already in the wild — the vocabulary carries the spec name, since two ' +
    'spellings of one block is ambiguity an authoring model cannot resolve',
  'action:bar':
    'record:quick_actions covers the record-page action strip, and the spec ui/page ' +
    'vocabulary blesses action button/group/icon/menu but not bar',
  'element:image':
    'duplicates the curated `image` primitive (src/alt/fit) — one spelling per concept',
  'element:metadata_viewer': 'internal metadata debugging surface, not an authoring block',
  'element:record_picker': 'record picking is a field widget, not a page block',
  'element:text_input': 'bare inputs belong to a form, not a page block',
};

/**
 * Curated semantic blocks that declare NO inputs because their renderers
 * genuinely read nothing beyond `children`/`className` — pure containers and
 * separators. Listing them here (rather than exempting them ad hoc) keeps
 * "zero inputs" a reviewed decision: a block that grows a configurable surface
 * while sitting in this list fails the assertion below in the other direction.
 *
 * `page:section` / `page:footer` / `page:sidebar` left this list in
 * objectui#4027, and the entry they left is the reason: "reads nothing beyond
 * `children`" was doing double duty as "therefore declares nothing", and the
 * child list is exactly what a designer has to be able to authorize. All three
 * now publish that one slot, matching the shared `PageContainerProps`
 * objectstack#5775 (PR objectstack#6281) gave them upstream. `element:divider`
 * stays: it renders no children at all.
 */
const PROP_LESS_CURATED = ['element:divider'];

describe('PUBLIC_BLOCKS ↔ console coverage (reverse direction)', () => {
  const shippedBlocks = (ns: string): string[] =>
    ComponentRegistry.getKnownTypes()
      .filter((k) => ComponentRegistry.getMeta(k)?.namespace === ns)
      .sort();

  it('curates every shipped semantic block, or records why not', () => {
    const curated = new Set<string>(PUBLIC_BLOCKS);
    const uncurated = SEMANTIC_NAMESPACES.flatMap((ns) =>
      shippedBlocks(ns).filter((tag) => !curated.has(tag)),
    ).sort();

    expect(uncurated).toEqual(Object.keys(DELIBERATELY_UNCURATED).sort());
  });

  it('registers each semantic block under one key, prefixed once', () => {
    for (const ns of SEMANTIC_NAMESPACES) {
      expect(shippedBlocks(ns).every((k) => k.startsWith(`${ns}:`))).toBe(true);
    }
  });

  it('leaves the bare names to whoever owns them', () => {
    // The corollary of registering bare + `namespace`: without
    // `skipFallback: true` these also claim `details`, `tabs`, `text`,
    // `button` … as top-level tags. Every one of those belongs to `ui:` (or
    // `field:`), and a missing skipFallback would silently take it over.
    for (const ns of SEMANTIC_NAMESPACES) {
      for (const tag of shippedBlocks(ns)) {
        const bare = tag.slice(ns.length + 1);
        expect(ComponentRegistry.getMeta(bare)?.namespace ?? null).not.toBe(ns);
      }
    }
  });

  it('prefixes every namespaced key exactly once, in every namespace', () => {
    // `register('page:header', …, { namespace: 'page' })` hands an
    // already-prefixed name to a registry that prefixes it again: the block
    // lands at `page:page:header` and stays reachable only through the
    // un-namespaced fallback, which happens to spell `page:header`. Nothing
    // fails — `getPublicConfigs()` rewrites `type` to the curated tag — so the
    // registry quietly carries a phantom key per block.
    //
    // objectui#3023 fixed the eleven in `record:` and guarded that namespace
    // alone. Twenty-two more were sitting in `action:`, `element:` and `page:`,
    // two of them (`page:header`, `element:divider`) curated public blocks.
    // Checking one namespace is what let them keep sitting there, so this asks
    // the whole registry.
    const doubled = ComponentRegistry.getKnownTypes().filter((k) => {
      const ns = ComponentRegistry.getMeta(k)?.namespace;
      return !!ns && k.startsWith(`${ns}:${ns}:`);
    });

    expect(doubled).toEqual([]);
  });

  it('keeps the chatter alias identical to the block it aliases', () => {
    // `record:chatter` is excluded because it duplicates `record:discussion`,
    // not because it is lesser. The moment the two configuration surfaces
    // diverge, that reasoning stops holding: `chatter` would be its own block
    // kept out of the vocabulary, which is the state this whole file exists to
    // catch. Comparing inputs is what makes the exclusion falsifiable.
    //
    // Both are eager registrations, asserted first — a pending lazy stub
    // reports `inputs: undefined` meaning "not known yet", which would make the
    // comparison below pass vacuously on two blanks.
    for (const tag of ['record:chatter', 'record:discussion']) {
      expect(ComponentRegistry.getConfig(tag)).toBeDefined();
    }
    const chatter = ComponentRegistry.getMeta('record:chatter')?.inputs;
    expect(chatter?.length).toBeGreaterThan(0);
    expect(chatter).toEqual(ComponentRegistry.getMeta('record:discussion')?.inputs);
  });

  it('declares inputs for every curated semantic block, minus the prop-less list', () => {
    // What objectui#3006 cost was a configurable block sitting outside the
    // contract. The inverse is just as bad for an authoring model: a curated
    // tag with no declared inputs can only be emitted bare, so it reads as
    // "this block takes no configuration" when the renderer in fact reads
    // props. Curation and a configuration surface travel together — except for
    // the genuinely prop-less containers, which are pinned as such below.
    const curatedSemantic = PUBLIC_BLOCKS.filter((tag) =>
      SEMANTIC_NAMESPACES.some((ns) => tag.startsWith(`${ns}:`)),
    );
    expect(curatedSemantic.length).toBeGreaterThan(0);
    for (const tag of curatedSemantic.filter((t) => !PROP_LESS_CURATED.includes(t))) {
      expect(contract.get(tag)?.inputs ?? []).not.toEqual([]);
    }
    for (const tag of PROP_LESS_CURATED) {
      // Eager registrations, asserted first: a pending lazy stub reports
      // `inputs: undefined` meaning "not known yet", which would make the
      // zero-input pin below vacuous.
      expect(ComponentRegistry.getConfig(tag)).toBeDefined();
      expect(contract.get(tag)?.inputs ?? []).toEqual([]);
    }
  });

  it('catches a curated tag that misses a registered block by its namespace', () => {
    // The objectui#3006 shape: PUBLIC_BLOCKS said `line_items`, the registry
    // said `record:line_items`, and the forward check could only report "not
    // covered" — which reads as "not built yet" and got filed as a known gap.
    // A near-miss is never intentional: one of the two spellings is a typo.
    const known = new Set(ComponentRegistry.getKnownTypes());
    const nearMisses = PUBLIC_BLOCKS.filter((tag) => !known.has(tag)).map((tag) => {
      const bare = tag.slice(tag.indexOf(':') + 1);
      return { tag, alsoTry: [...known].filter((k) => k === bare || k.endsWith(`:${bare}`)) };
    });

    expect(nearMisses.filter((m) => m.alsoTry.length > 0)).toEqual([]);
  });
});

/**
 * ── The DERIVED half: the declared layout containers (objectui#6879) ─────────
 *
 * Everything above this line asserts an EXACT LIST, and that is right for what
 * it guards — a SHRINKING contract, which `toContain` sails past. But an exact
 * list cannot answer the question objectui#6879 was filed about, and the
 * distinction is the whole content of that card:
 *
 *   an exact list goes red when a CURATED type disappears;
 *   nothing went red when a newly minted type never arrived.
 *
 * `box` was minted by the 2026-08-29 ruling as the JSON surface's neutral block
 * container and landed on every declaration face there is — the `BoxSchema`
 * interface, its zod mirror, `SchemaRegistry`, the registration in
 * `@object-ui/components`, a docs page, and 27 catalog fixtures. `PUBLIC_BLOCKS`
 * was the one face it missed, and `EXPECTED_COVERED` above agreed with the
 * roster about the omission, because both are hand-carried. Two hand-carried
 * lists that agree prove only that the same hand wrote both.
 *
 * ⭐ So this half DERIVES its population instead of listing it, and a pin over a
 * derived population fails by ABSENCE. The naive alternative — asserting
 * `PUBLIC_BLOCKS` contains `box` — passes on a roster that carries `box` AND
 * has already missed the type minted after it, which is this same defect one
 * iteration later.
 *
 * THE POPULATION, and why these two readings:
 *
 *   1. `LayoutSchema.options` — the runtime-enumerable zod authoring union in
 *      `@object-ui/types/zod`. It is the JSON layout vocabulary as DECLARED:
 *      a type that has been minted is an arm of it, and a type that has not is
 *      not. Read from the union's own arms, so minting the next one moves this
 *      set with no list here to maintain.
 *   2. `isContainer === true` — the registry's own declared containment
 *      (objectui#3900 / #6740 / #6764). It is what makes the population the one
 *      Tier B's layout primitives live in: `box`'s five curated siblings
 *      (`flex` / `grid` / `stack` / `card` / `container`) are exactly the
 *      objectui#6764 control set, which is what makes this a reading rather
 *      than a broken scan — and it is asserted below rather than assumed.
 *
 * Scope, stated plainly: this covers the CONTAINER half of the layout
 * vocabulary. The non-container arms (`span`, `separator`, `scroll-area`,
 * `resizable`, `page`, the deprecated `div`, and — since objectui#8499 armed
 * them — the 38 flow/inline HTML tags of `HtmlElementSchema`, not one of which
 * declares containment) are outside it because curating any of them is an
 * unruled question of its own, and a ledger is a forcing function, not a place
 * to park four of those at once.
 *
 * ── THE MEASUREMENT THIS CARD WAS DISPATCHED TO MAKE, RECORDED ──────────────
 *
 * Before `box` was added to the roster, triage required an answer to: what does
 * `registry-inputs-spec-parity` (next door) do with a PUBLIC block that has no
 * `@objectstack/spec` entry? Adding it first is how a gate discovers a new
 * population at merge time.
 *
 * The answer is a third one, neither "it demands a spec entry" nor "it tolerates
 * the absence": IT CANNOT SEE THE BLOCK AT ALL. That file's coverage set is
 * SPEC-shaped — `Object.keys(ComponentPropsMap)` filtered to what this repo
 * registers with inputs — and it never reads `PUBLIC_BLOCKS`.
 *
 * ⭐ Membership in this roster is therefore neither NECESSARY nor SUFFICIENT for
 * being judged, and both halves have live specimens, so the measurement is not a
 * story about one block:
 *
 *   - not necessary — `element:record_picker` is absent from `PUBLIC_BLOCKS` and
 *     judged anyway, because the spec describes it (the parity file says so
 *     itself, in its own words about why its coverage is not limited to the
 *     public tier);
 *   - not sufficient — `flex` / `grid` / `stack` / `card` / `container` are all
 *     curated and all unjudged, because `@objectstack/spec@17` carries no entry
 *     for any Tier B layout primitive.
 *
 * So `box` did not arrive as a new spec-less population; it joined one five
 * types deep that the gate has never judged. Both halves are pinned below.
 *
 * ⚠️ ONE THING THIS GAP WAS NOT. "Absent from `PUBLIC_BLOCKS`" never meant "not
 * on an authoring surface", and saying so would overstate the card. `box`'s
 * `inputs` have been live all along through the OTHER consumer of the same
 * metadata: `components/src/renderers/layout/page.tsx` builds the JSX-page
 * compiler's manifest from `getKnownTypes()` — registry-wide, no roster in it —
 * and `validateTree` judges authored pages against that. What this roster gates
 * is `getPublicConfigs()`: the curated AI-authoring vocabulary, and through
 * `sdui-parser/scripts/gen-manifest.ts` the published `sdui.manifest.json` and
 * `sdui-intrinsics.d.ts`. That is the surface `box` was missing from — narrower,
 * and true.
 */

/**
 * The JSON layout vocabulary, read from the zod union's own arms.
 *
 * A discriminated union member declares its `type` to Zod, so the arm list IS
 * the vocabulary — but an arm declares it in one of TWO shapes, and reading only
 * the first is what objectui#8499 broke here. A `z.literal` arm carries one
 * spelling on `.value`; a `z.enum` arm carries a whole registered family on
 * `.options` — `SemanticElementSchema`'s seven sectioning tags, and
 * `HtmlElementSchema`'s 38 flow/inline tags. A `.value`-only read resolved
 * neither, and the anti-vacuity case below reported it as 19 arms yielding 17
 * literals, which is precisely the job that case exists to do.
 *
 * The switch is on zod's own `def.type` discriminator, NOT on which accessor
 * happens to be present. A fallback chain (`.value`, else `.options`, else …)
 * would paper over exactly the accessor drift the first case is meant to
 * report: an arm whose declaration is neither shape resolves NOTHING here, and
 * the count comparison below turns that silence into a failure.
 */
const LAYOUT_UNION_ARMS = (LayoutSchema as unknown as { options: unknown[] }).options;

type TypeDeclaration = { def?: { type?: string }; value?: unknown; options?: unknown[] };

/** Every `type` spelling ONE arm can take: a literal's single value, or an enum's whole set. */
const armLiterals = (arm: unknown): string[] => {
  const declared = (arm as { shape?: { type?: TypeDeclaration } }).shape?.type;
  const isSpelling = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0;
  if (declared?.def?.type === 'literal') {
    return isSpelling(declared.value) ? [declared.value] : [];
  }
  if (declared?.def?.type === 'enum') return (declared.options ?? []).filter(isSpelling);
  return [];
};

const LAYOUT_ARM_LITERALS: string[][] = LAYOUT_UNION_ARMS.map(armLiterals);
const LAYOUT_VOCABULARY: string[] = LAYOUT_ARM_LITERALS.flat();

/** …of those, the ones the registry DECLARES it renders a child list for. */
const DECLARED_LAYOUT_CONTAINERS = LAYOUT_VOCABULARY.filter(
  (type) => ComponentRegistry.getMeta(type)?.isContainer === true,
).sort();

/**
 * objectui#6764's control set — the five that declared containment before that
 * card, and the five Tier B curates. Asserted, not assumed: if the derivation
 * ever stops reaching the real registrations, these vanish from the population
 * and the ledger pin below would pass over a set that means nothing.
 */
const CONTAINER_CONTROL_SET = ['card', 'container', 'flex', 'grid', 'stack'];

/** Does `@objectstack/spec` describe this block's props? The parity gate's own reach. */
const specCarried = (type: string): boolean =>
  Object.prototype.hasOwnProperty.call(ComponentPropsMap, type);

/**
 * Declared layout containers deliberately OUTSIDE the curated vocabulary, each
 * with its reason and a tracking issue.
 *
 * ⚠️ This is a forcing function, not an allowlist. A newly minted layout
 * container is in neither this ledger nor `PUBLIC_BLOCKS`, so it fails the pin
 * below by ABSENCE — which is the property `box` needed and did not have. An
 * entry here is the deliberate, reviewable alternative to curating, never a
 * silent one, and it must name an issue that resolves it.
 *
 * ⭐ The seven sectioning tags arrived here BY ABSENCE — the mechanism working,
 * not failing. They have declared `isContainer: true` since objectui#6764;
 * objectui#8499 armed them as `SemanticElementSchema`, and becoming arms of the
 * layout union is what first pulled already-declared containers into the
 * intersection this file derives. ⛔ The alternative on offer — housing that arm
 * outside `LayoutSchema` — was refused deliberately: it would have removed seven
 * genuine layout containers from this population without changing anything about
 * what they are, which is a gate that stops looking rather than a gate that
 * passes. Ledgering them was the reviewable option, and objectui#8775 has since
 * ruled on them (ruling 5857078807, letter B): they stay out, for the reason
 * their entry records.
 *
 * ⚠️ What an entry here COSTS, stated once so no entry has to re-argue it, and
 * corrected because objectui#8499 first shipped it wrong. Curating a ledgered
 * container widens the curated AI-authoring vocabulary (and, for a container
 * the html tier does not already declare through `HTML_TIER_INTRINSICS`,
 * `sdui.manifest.json` and the generated intrinsics too — the seven sectioning
 * tags are already there as html-tier entries since objectui#10735), and turns
 * the census pin in
 * `renderers/__tests__/container-declaration-census.test.tsx` red BY DESIGN — a
 * deliberate re-opening, which is the whole point of pinning it. It does ⛔ NOT
 * remove the tag from any `kind:'react'` page. `renderers/layout/react-page.tsx`
 * builds that scope with `if (!tag || cfg.isContainer || cfg.tier === 'html') continue;`,
 * so it skips EVERY container config; a ledgered container already carries the flag, so
 * promotion changes which list the config comes from and nothing about whether
 * the loop keeps it. Measured on `main`: 46 injected identifiers today, 46 with
 * `main` promoted, `Main` absent from both. The deletion reading is real but
 * runs the OTHER way — objectui#6764's direction, where declaring containment on
 * an already-public block removes an identifier that existed — and reading that
 * docblock forwards is how it got here.
 */

/**
 * The seven are ONE registration — a single loop factory in
 * `renderers/layout/semantic.tsx` over one `tags` array — so they share one
 * reason rather than seven paraphrases of it.
 */
const SECTIONING_TAG_REFUSED =
  'RULED: refused on stated merits (objectui#8775, ruling 5857078807, letter B). One of the seven ' +
  'HTML sectioning tags the single loop factory in `renderers/layout/semantic.tsx` registers with ' +
  '`category: layout` and `isContainer: true`. No real application authors any of the seven as a ' +
  "JSON block: the objectstack showcase and examples, hotcrm, and this repository's examples outside " +
  "the schema catalogue carry none, while the same grep shape finds each corpus's ordinary layout " +
  "blocks; the catalogue's own semantic fixtures are the renderer documenting itself, as " +
  "`aspect-ratio`'s are. " +
  'They are HTML elements, and HTML elements live on the html tier: all seven are in ' +
  "`HTML_TIER_INTRINSICS` and reach `sdui.manifest.json` stamped `tier: 'html'` (objectui#10735), " +
  'which the census pin "none of the eight is in the curated public contract" holds, and a ' +
  "`kind:'html'` page renders them. The curated tier already carries the landmarks an app page " +
  'needs, one spelling each: `page:section`, `page:header`, `page:footer` and `page:sidebar`, all ' +
  'four in `EXPECTED_COVERED` above, render a `section`, `header`, `footer` and `aside` element. ' +
  'Curating any of the seven would add a near-synonym pair an AI author cannot tell apart: each is a ' +
  'neutral wrapper that passes `className` through verbatim exactly as the curated `box` does, ' +
  'differing only in the element it emits, and four of them also emit the same element as a curated ' +
  '`page:*` block (`section` and `page:section` both render a `section`). Two spellings of one block ' +
  'is the ambiguity `record:chatter` is ledgered for. The seven still ship, render and validate on the ' +
  'JSON surface, as `aspect-ratio` does; they are simply not taught, and the published page-builder ' +
  'guide stopped teaching `section` in the same change. The pull, render and validate readings were ' +
  'taken once for objectui#8775 and live on its pull request; nothing in this file re-derives them. ' +
  'Curating one stays available on a named need, not on a census, at the cost the docblock above ' +
  'states once for every entry.';

const UNCURATED_LAYOUT_CONTAINERS: Record<string, string> = {
  'aspect-ratio':
    'RULED: refused on stated merits (objectui#8628, ruling 5634038424, letter B, ratified 5810240972). ' +
    'A ratio box is `box` plus an aspect utility, and the curated vocabulary carries one spelling per ' +
    'concept — the reasoning `element:image` carries against the curated `image` primitive. `box` is ' +
    'curated and passes its authored `className` through verbatim (the contract ' +
    '`box-neutral-container.test.tsx` pins), so the concept already has its one spelling. The block ' +
    'still ships and still renders (four inputs, ratio/image/alt/className, plus a container slot); it ' +
    'is simply not taught. Curating it stays available on a named need, not on a census. It is recorded ' +
    'HERE rather than in `DELIBERATELY_UNCURATED`, which the ruling names: that ledger is pinned exactly ' +
    'by "curates every shipped semantic block, or records why not", whose population is the four ' +
    'semantic namespaces, and `aspect-ratio` registers under `ui` — an entry there turns that pin red, ' +
    'and dropping this one turns "curates every declared layout container, or records why not" red.',
  article: SECTIONING_TAG_REFUSED,
  aside: SECTIONING_TAG_REFUSED,
  footer: SECTIONING_TAG_REFUSED,
  header: SECTIONING_TAG_REFUSED,
  main: SECTIONING_TAG_REFUSED,
  nav: SECTIONING_TAG_REFUSED,
  section: SECTIONING_TAG_REFUSED,
};

describe('PUBLIC_BLOCKS ↔ the declared layout containers (derived, objectui#6879)', () => {
  it('reads the vocabulary off the union rather than restating it', () => {
    // The anti-vacuity case, and it comes first. EVERY arm must resolve at least
    // one real `type` spelling: an arm that resolved none would make the ledger
    // pin below pass while asserting nothing at all about that arm.
    //
    // ⚠️ Counting literals against arms — what this line did before
    // objectui#8499 — is NOT the same assertion and cannot be restored: a single
    // enum arm contributes 38 spellings, so the two numbers are no longer meant
    // to match. What still holds one-for-one is that no arm contributes ZERO.
    expect(LAYOUT_UNION_ARMS.length).toBeGreaterThan(0);
    expect(LAYOUT_ARM_LITERALS.filter((literals) => literals.length > 0)).toHaveLength(
      LAYOUT_UNION_ARMS.length,
    );
    // And it must be the vocabulary we think it is: the type this card was built
    // around, two of its long-standing siblings, and one spelling out of EACH
    // enum arm — so a reader that silently stopped resolving enums, which is the
    // regression this file caught, cannot pass this case either.
    expect(LAYOUT_VOCABULARY).toEqual(
      expect.arrayContaining(['box', 'flex', 'container', 'main', 'h1']),
    );
    // ⭐ The SECOND ACCESSOR PATH, and the reason the sample above is not the
    // only guard. `propValues` is zod's OWN discriminator index, built when the
    // union was constructed; `armLiterals` is this file's switch over `def`.
    // Two readers, one schema — so they must agree as sets, and the day someone
    // "simplifies" `armLiterals` back to a `.value`-only read (exactly the
    // objectui#8499 regression) the two stop agreeing here rather than five
    // sampled spellings later.
    //
    // ⚠️ Scope, stated so nobody over-reads it: this pins the READER, not the
    // schema. Both paths read the same union, so a spelling genuinely deleted
    // from an enum arm (`q`, say) leaves both sides equal and this case green;
    // that direction is pinned against the REGISTRATION SOURCE elsewhere, which
    // is where it belongs.
    const zodPropValues = (
      LayoutSchema as unknown as { _zod?: { propValues?: { type?: Set<unknown> } } }
    )._zod?.propValues?.type;
    expect(zodPropValues, "zod exposes no `propValues.type` index for this union").toBeDefined();
    expect([...(zodPropValues ?? [])].filter((v) => typeof v === 'string').sort()).toEqual(
      [...LAYOUT_VOCABULARY].sort(),
    );
  });

  it('derives a non-empty container population holding the objectui#6764 control set', () => {
    // The second anti-vacuity case: a roster/census pin iterating an EMPTY set
    // passes. Both halves of the derivation are checked — the union read above,
    // and the registry read here. If `isContainer` stopped resolving, this set
    // empties and every case below would go quietly green.
    expect(DECLARED_LAYOUT_CONTAINERS.length).toBeGreaterThan(0);
    expect(DECLARED_LAYOUT_CONTAINERS).toEqual(expect.arrayContaining(CONTAINER_CONTROL_SET));
    // `box` must be IN the population, or the pin below would be satisfied by a
    // roster that had silently dropped it again.
    expect(DECLARED_LAYOUT_CONTAINERS).toContain('box');
  });

  it('curates every declared layout container, or records why not', () => {
    // ⭐ The load-bearing case. Derived on both sides: the population from the
    // union and the registry, the expectation from the ledger's own keys. A
    // newly minted layout container is in neither, so it lands here BY ABSENCE
    // — which is exactly what did not happen when `box` was minted.
    const curated = new Set<string>(PUBLIC_BLOCKS);
    const uncurated = DECLARED_LAYOUT_CONTAINERS.filter((type) => !curated.has(type));

    expect(uncurated).toEqual(Object.keys(UNCURATED_LAYOUT_CONTAINERS).sort());
  });

  it('keeps every ledger entry live — a real member, a reason, a tracking issue', () => {
    for (const [type, reason] of Object.entries(UNCURATED_LAYOUT_CONTAINERS)) {
      // A dangling entry would be a standing licence for a type that is not even
      // in the population any more.
      expect(DECLARED_LAYOUT_CONTAINERS, `${type} is not a declared layout container`).toContain(
        type,
      );
      expect(reason, `${type} states no tracking issue`).toMatch(/#\d+/);
      expect(reason.length, `${type} states no reason`).toBeGreaterThan(40);
    }
  });

  it('carries no stale ledger entry — a curated type must lose its entry', () => {
    // The other direction, and the reason the list cannot rot into a permanent
    // allowlist: once a ledgered type IS curated, the entry must be deleted
    // rather than left standing next to the thing it claims is excluded.
    const curated = new Set<string>(PUBLIC_BLOCKS);
    expect(Object.keys(UNCURATED_LAYOUT_CONTAINERS).filter((type) => curated.has(type))).toEqual(
      [],
    );
  });

  it('adds no block that registry-inputs-spec-parity can judge (the objectui#6879 measurement)', () => {
    // The measurement, kept as an assertion so nobody has to re-run it: this
    // whole population is outside `ComponentPropsMap`, so the spec-parity gate
    // next door — whose coverage set is derived from that map's keys, and which
    // never reads `PUBLIC_BLOCKS` — cannot see any of it. Curating `box` moved
    // that gate by nothing, and needed no spec entry and no loosening.
    expect(DECLARED_LAYOUT_CONTAINERS.filter(specCarried)).toEqual([]);

    // ⭐ The LIT CONTROL, on the same command shape and over the right
    // population: the curated roster at large DOES carry spec-described blocks,
    // so the empty result above is a reading and not a broken lookup.
    expect(Object.keys(ComponentPropsMap).length).toBeGreaterThan(0);
    expect(PUBLIC_BLOCKS.filter(specCarried).length).toBeGreaterThan(0);
  });

  it('measures that gate as SPEC-shaped — this roster is neither necessary nor sufficient', () => {
    // The half that stops the measurement above from reading as "curated blocks
    // are the unjudged ones". Both directions have live specimens, and a pin
    // that held only one of them would license exactly the wrong conclusion.
    //
    // NOT SUFFICIENT — curated, and still outside that gate's reach:
    expect(CONTAINER_CONTROL_SET.every((type) => PUBLIC_BLOCKS.includes(type))).toBe(true);
    expect(CONTAINER_CONTROL_SET.filter(specCarried)).toEqual([]);

    // NOT NECESSARY — outside this roster, judged by that gate anyway, because
    // the spec describes it. `element:record_picker` is the standing specimen;
    // the parity file records the same block for the same reason.
    expect(PUBLIC_BLOCKS).not.toContain('element:record_picker');
    expect(specCarried('element:record_picker')).toBe(true);
  });

  it('keeps `box` on the authoring surface it was already on, and adds the one it was not', () => {
    // ⚠️ The overstatement this case exists to refuse: "absent from
    // `PUBLIC_BLOCKS`" is not "unvalidated". `page.tsx` builds the JSX-page
    // compiler's manifest from `getKnownTypes()` + these same `inputs`, so
    // `box`'s declaration has been live there all along — with no roster in the
    // path. Asserted with its declared input, because a registration present but
    // declaring nothing would publish no authoring surface at all.
    expect(ComponentRegistry.getKnownTypes()).toContain('box');
    expect((ComponentRegistry.getMeta('box')?.inputs ?? []).map((i) => i.name)).toContain(
      'className',
    );

    // What this card actually moved: `getPublicConfigs()` — the curated
    // vocabulary, and the source `gen-manifest.ts` serialises into the published
    // `sdui.manifest.json` and `sdui-intrinsics.d.ts`.
    expect(contract.has('box')).toBe(true);
    expect(contract.get('box')!.type).toBe('box');
  });
});
