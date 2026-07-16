# ADR-0065: SDUI styling model — scoped style-objects over arbitrary Tailwind classes

**Status**: Accepted (2026-06-22) — open-mechanism half implemented: `style`/`responsiveStyles` on the spec UI envelope (`page.zod.ts:97,106`), reference scoped-styles compiler + four-property test (objectui `core/src/styling/scoped-styles.ts(.test)`), token/Tailwind lint (`lint/validate-responsive-styles.ts`). Cloud tier-policy + VLM gate remain the cloud half.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0026](./0026-client-ui-plugin-distribution.md) (client UI distribution), [ADR-0016](./0016-studio-package-authoring-and-publish.md) (package authoring/publish), [ADR-0049](./0049-no-unenforced-security-properties.md) (spec must not promise what the runtime can't deliver)
**Consumers**: `@objectstack/spec` (UI component envelope), the objectui renderers (`@object-ui/components`), cloud SDUI page authoring, the AI metadata-authoring agents.
**Surfaced by**: a Cloud Pricing page (`com.objectstack.cloud` `page/pricing`) that rendered with blank plan headings, then — on investigation — turned out to "work" only by coincidence.

---

## TL;DR

The SDUI styling story to date is **arbitrary Tailwind class strings carried in
page metadata and passed through to the DOM** (`element:text`/`page:card` etc.
forward `schema.className`). Investigation shows this is **structurally unsound**
for a platform where pages are authored *separately from* — and *by parties who
cannot rebuild* — the renderer, and where the author is increasingly an **AI**.

Three independent failure axes, any one of which is disqualifying, all bite at once:

1. **Compilation.** Tailwind is JIT-compiled at *build* time, scanning *source*.
   The renderer (objectui Console) is a shipped, frozen artifact whose CSS scans
   only objectui's own `src` (`objectui: apps/console/src/index.css:12-19`),
   **never** the page metadata. There is **no safelist**. So a class in metadata
   produces CSS *only if it coincidentally also appears in objectui source*.
   (The Pricing page renders today purely because all 16 of its classes happen
   to be common ones objectui already uses — luck, not a contract. Any
   arbitrary-value class — `text-[27px]`, `bg-[#1a2b3c]`, `grid-cols-7` — is
   silently dead.)

2. **Two-build cascade + responsive inversion.** Because the customer's metadata
   project builds independently from the renderer, you inherently get **two
   Tailwind stylesheets**. Tailwind utilities have equal specificity, so priority
   falls to source order — which is undefined across two builds. CSS cascade
   `@layer` fixes the flat case but **outranks media-query/source-order**, so a
   higher layer's *unconditional* (mobile-base) utility silently defeats a lower
   layer's `md:` utility *at all breakpoints* — responsive intent inverts.
   Per-element this is structural: every rendered element carries the renderer's
   own classes **and** the author's className, straddling two layers.

3. **AI authorship.** The author is often a cheap model. Arbitrary Tailwind is a
   ~thousands-of-classes + infinite-arbitrary-value + variant + cascade surface —
   a maximal footgun. Correctness must be *designed in*, not hoped for. (In the
   session that surfaced this, a frontier model authoring the page made four
   distinct mistakes: overclaimed the capability, tripped a latent renderer bug,
   "verified" with a methodologically false-positive screenshot, and picked
   classes that worked only by luck.)

**Decision.** SDUI styling is expressed as a **scoped style-object with
model-owned responsive breakpoints**, whose *values* are constrained to design
tokens — **not** arbitrary Tailwind classes. Styles compile to **per-component,
id-scoped CSS at render time** (build-independent, collision-free). Arbitrary
`className` is demoted to a **gated escape hatch** that only a runtime
single-engine path may honour. This mirrors the proven model of **Builder.io**,
the most battle-tested "author content separately, render in arbitrary hosts"
platform.

---

## Context

### What we have

UI components carry a loose `className` passthrough. The objectui renderers apply
it directly — e.g. `objectui: packages/components/src/renderers/basic/elements.tsx:87`
(`cn(VARIANT_CLASS, ALIGN_CLASS, schema?.className)`). The spec does **not** even
formally model a styling field (`packages/spec/src/ui/component.zod.ts` defines
per-component `properties` + `children`, no `style`). So styling today is "write
Tailwind into metadata and hope the renderer's CSS bundle happens to contain it."

### Why "just compile at build time" doesn't rescue it

- **Folding the page files into the renderer's Tailwind `@source`** works *only*
  for pages that are static source *inside the renderer's own build*. The
  Console is a shipped dev tool; the customer's metadata project is a **separate
  build the platform never sees**. A single shared build is impossible.
- **A safelist / `@source inline(...)`** yields a *bounded* palette, not the
  arbitrary power that motivated raw className in the first place.
- **A shared Tailwind preset** (lock version + share `@theme`/breakpoints +
  emit into a reserved `@layer`) makes two independent builds *coexist*, but
  cannot remove the responsive-inversion tail (§Decision-2 above): build-time
  approaches structurally cannot.
- **Runtime single-engine JIT** (one engine over the composed DOM) *is* correct,
  but pays a permanent runtime cost (client engine / server compile+cache) and
  is the *only* build-time-free way to keep arbitrary classes correct.

The honest constraint: **"two independent builds + arbitrary Tailwind + correct
responsive + zero runtime cost" — pick three.**

### Precedent: Builder.io

Builder.io solves exactly this shape (visual content authored separately,
rendered into arbitrary host stacks) and **does not bet on Tailwind classes**:

- Styles are CSS **objects**, per breakpoint —
  `Builder.io SDK: packages/sdks/src/types/builder-block.ts:42`
  (`responsiveStyles?: { large?, medium?, small?, xsmall?: Partial<CSSStyleDeclaration> }`).
- Responsive is an **explicit breakpoint map in the data model** (desktop-first:
  `large` is base, smaller sizes override via `@media (max-width: …)` —
  `Builder.io SDK: packages/sdks/src/constants/device-sizes.ts:34`), **not**
  `md:` utility variants the author writes.
- At render, each block's styles compile to **id-scoped CSS** —
  `Builder.io SDK: packages/sdks/src/helpers/css.ts` (`createCssClass` emits
  `.${block.id} { … }`, wrapping smaller breakpoints in `@media`) injected via
  an inlined `<style>` (`…/components/block/components/block-styles.lite.tsx`).
- `className` exists only as an **optional passthrough** for hosts that already
  ship Tailwind — carrying the exact "only works if the host compiled it" caveat.

This dissolves all three failure axes: nothing to scan at build (styles are
data → CSS at render), nothing to collide (id-scoped, no shared utility layer),
and responsive is clean generated `@media` owned by the model.

---

## Decision

1. **Styling primitive = scoped style-object.** The UI component envelope gains
   an optional `style` (base) and `responsiveStyles` (`large`/`medium`/`small`/
   `xsmall` CSS-property maps). The renderer compiles these to **per-component,
   id-scoped CSS** at render time. No author-written class strings are required
   for styling.

2. **Responsive is model-owned.** Breakpoints are expressed as the
   `responsiveStyles` map (or higher-level responsive props on components like
   `columns`), generated into proper `@media` rules. Authors **never write
   breakpoint variant classes** (`md:` …). This deletes the entire
   layer-vs-media-query failure class.

3. **Values are token-constrained.** Style-object values resolve against a
   curated design-token palette (spacing/color/radius/typography as
   CSS variables). This is what Builder.io *lacks* (and is criticised for —
   inconsistent output); we add it for visual consistency **and** to make the
   surface enumerable/validatable for AI authors.

4. **Arbitrary `className` is a gated escape hatch, not the interface.** It may
   be honoured **only** on a runtime single-engine path, and (in cloud) gated to
   an advanced/paid tier behind a render+review check. It is never what the AI
   reaches for by default.

5. **Authoring is verified in-loop.** Because styles are now structured data, the
   authoring tool validates them against the spec schema (reject + self-correct),
   and the publish path may add a headless render + VLM "looks right?" gate.
   Correctness by construction + verification, not author virtue.

This ADR is the **mechanism** (open, in framework + objectui); per-tier policy
and the VLM gate are **cloud** concerns (open-core boundary, cf. ADR-0026).

---

## Consequences

- **Positive.** Styling becomes **build-independent** (data → CSS at render →
  arbitrary *values* always work), **collision-free** (id-scoped, no two-build
  cascade war, no `@layer` gymnastics, no safelist), **responsive-correct**
  (model breakpoints → generated `@media`), and **AI-safe** (structured,
  schema-validated, token-bounded data instead of a class-string DSL).
- **Negative / cost.** A render-time CSS-gen step (cheap: object→string, *not* a
  Tailwind engine). Per-component `<style>`/scoped rules instead of shared
  utility reuse (slightly larger, uncached-across-blocks CSS — acceptable, and
  cacheable by content hash). Token constraint must be designed (the palette is
  now a platform artifact). Existing className-styled pages (e.g. the Pricing
  page) migrate to the new primitive.
- **Follow-up.** (a) Add `style`/`responsiveStyles` to `@objectstack/spec` UI
  envelope. (b) A reference compiler (`style-object + breakpoints → id-scoped
  CSS`) as the open mechanism. (c) objectui renderer consumes it. (d) Define the
  token palette. (e) Migrate cloud's built-in `*.page.ts` off raw className.
  (f) cloud: tier policy + render/VLM gate for the className escape hatch.
- **Validation.** A showcase under `examples/app-showcase` exercises the
  primitive and a unit test asserts the four properties the decision rests on:
  **id-scoping**, **generated `@media` for breakpoints**, **arbitrary values
  pass through verbatim** (build-independence), and **token-var resolution**.

---

## Non-goals

- **Not** a general-purpose CSS-in-JS framework, animation system, or a Tailwind
  replacement for hand-written app code. This governs **metadata-authored SDUI**
  surfaces only.
- **Not** banning Tailwind inside objectui's own hand-built renderer components
  (those are scanned source — they compile fine).
- **Not** mandating the runtime single-engine path now. Runtime JIT is the
  *only* way to keep the arbitrary-className escape hatch correct, but adopting
  it is a separate, cost-gated decision (and unnecessary for the token primitive).
