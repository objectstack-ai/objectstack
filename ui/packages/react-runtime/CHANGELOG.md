# @object-ui/react-runtime

## 18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

## 17.7.0

### Patch Changes

- 0b1326d: Documentation no longer teaches the "JSX/HTML + Tailwind" framing for a page's
  `source`, which ADR-0080's own 2026-06-30 header amendment (under ADR-0065,
  Accepted) retracted. objectui#5461 corrected three sites; a multiline census
  found eight more, in three spellings a line-oriented grep could not see.
  
  A page's `source` is *runtime metadata*. The console's Tailwind is compiled at
  build time by scanning the console's own `src`, and there is no safelist, so it
  never sees your page: an authored utility class produces CSS only by coincidence
  (when objectui already ships that exact class) and otherwise produces nothing,
  with no error anywhere. That is the ADR-0065 "works only by coincidence" failure
  mode, and it is how a modal's `bg-black/50` backdrop reached production fully
  transparent. `os validate` reports it as `page-source-className-tailwind`, a
  warning on kinds `html`, `react` and `jsx`, shipped in `@objectstack/lint@11.5.0`.
  
  The tiers themselves are unchanged and every load-bearing claim survives —
  parse-never-execute, the untrusted-author safety argument for `html`, and the
  deprecated `'jsx'` alias. Only the styling primitive is corrected, to the wording
  `content/docs/guide/react-pages.md` §Styling already uses:
  
  | `kind` | Style with |
  |---|---|
  | `"html"` | The blocks' own structured props (`` `<flex direction gap>` ``, `` `<grid columns>` ``) plus a JSON `style` object. |
  | `"react"` | Inline `style` objects. |
  
  Colors on both tiers come from the theme as `hsl(var(--token))`.
  
  Why each package has an entry — each was measured against its built artefact, not
  assumed:
  
  - **`@object-ui/react-runtime`**: `README.md` is published to npm (npm includes
    `README.md` in the tarball regardless of `files`). Its "no sandbox" callout is
    the paragraph that routes untrusted-author work to the `html` tier, and it
    carried the retracted framing line-wrapped across `:17-18`. It also gains the
    §Styling section it was missing — the absence is why the framing survived here.
  - **`@object-ui/sdui-parser`**: the corrected header of `src/types.ts` projects
    verbatim into the published `dist/types.d.ts`.
  - **`@object-ui/components`**: the corrected header of
    `src/renderers/basic/html-elements.tsx` projects verbatim into the published
    `dist/renderers/basic/html-elements.d.ts`. The `kind === 'html'` dispatch-arm
    comment in `src/renderers/layout/page.tsx` does **not** project (it is inside a
    function body) and is included here only because the same package already owes
    an entry.
  
  No behaviour change: this is prose only. `CHANGELOG.md` occurrences are
  deliberately untouched — immutable release history.

## 17.6.0

## 17.5.0

## 17.4.0

### Patch Changes

- d11996e: Give `@object-ui/react-runtime`'s React peer range an upper bound: `peerDependencies.react` narrows from `>=18` to `^18.0.0 || ^19.0.0`, the spelling the other 30 react peers in the fixed version group already declare (objectui#3741).

  An unbounded range is a promise that grows on its own. `>=18` satisfies React 20 the day React 20 is published — a major this package has never been built against, let alone tested — and it makes that claim from an already-published manifest, with no commit and no review to point at. This package is the least appropriate place in the workspace for such a promise: it vendors react-runner and evaluates author-supplied JSX against the _host's_ React, so a host on an untested major does not fail at this package's boundary, it fails somewhere inside the page it rendered.

  Nothing in the package wanted the wider range. Its entire React surface is `Component`, `createElement`, `isValidElement`, `ReactElement` and `ReactNode`, all unchanged in React 19 and none of them touching anything React 19 removed. The range was never a stated constraint either: `>=18` was written when the package was created on 2026-06-30 (`d23d6ebfa`, PR #2105) and no commit since revisited the line. The workspace pins React to `19.2.8` through the root `pnpm.overrides`, so 19 is the only major this package's tests have ever exercised — the unbounded upper end was untested by construction.

  The README sentence restating the range moves with it, and the doc gate that compares the two (`doc-version-claims.test.ts`, objectui#3717) keeps them in step from here.

  A new pin, `scripts/__tests__/react-peer-range-norm-3741.test.ts`, now asserts the norm across every workspace manifest, because this was the third package born off-norm and the first two were each corrected in isolation: `plugin-dashboard` was born narrow and fixed on 2026-05-08 (`d2b6ecec6`), `plugin-report` was born narrow and fixed in objectui#3690 (PR #3727) after a React 19 consumer hit `ERESOLVE` on install, and this one was born unbounded. The existing doc gate could not have caught any of them — it checks a README against its own manifest, and react-runtime's two sides agreed with each other while both said `>=18`.

## 17.3.0

## 17.2.0

## 17.1.0

### Minor Changes

- 2374a49: fix(sdui): a react page no longer loses its state to a memo that never held, and a source that exports nothing fails loudly

  Writing the regression guard for objectui#2954's "latent hazard" found it was
  already real.

  **`evaluatedSchema` was memoised on values rebuilt every render.**
  `SchemaRenderer` fell back to a fresh `{}` when no `SchemaRendererProvider` sat
  above it, and `usePageVariables()` returned a brand-new object literal outside a
  `PageVariablesProvider`. Both feed the `evaluatedSchema` memo's dependency list,
  so for any tree without those providers the memo never hit: the schema was
  re-cloned and the ExpressionEvaluator re-run on every render, and children got a
  new schema identity every time. A `kind:'react'` page memoises its compiled
  source on that identity, so the page was recompiled — a new page function, a new
  element type — and React remounted it, silently discarding the user's `useState`.
  Any registry notification (every lazy plugin's first load) triggered it. Both
  fallbacks are now module constants.

  **A source that exports nothing now throws instead of rendering blank.**
  `generateElement` inserts the implicit `export default` only when the source
  _starts with_ JSX, a `function` declaration, `()` or `class` — so the very
  common `const Page = () => …` exported nothing, and the page rendered blank with
  no error reported anywhere. It now throws with a message naming the fix, which
  `ReactRunner`'s error panel surfaces. `export default null` still means "render
  nothing"; a default export that is not a component throws too.

  **`PageSchema['kind']` matches `@objectstack/spec`.** It declared
  `'full' | 'slotted'` while the renderer had shipped `'react'` and
  `'html'`/`'jsx'` since ADR-0080 and read the field through a cast. The union now
  spells all five and the cast is gone.

  Docs: new `content/docs/guide/react-pages.md` (choosing between the executed and
  parsed tiers, the capability gate, the injected scope, flat props, `Block`,
  `useAdapter`, source shapes, error handling) and a `@object-ui/react-runtime`
  README — the package had neither, while being the tier AI-authored pages target.

### Patch Changes

- aa1240a: fix(sdui): lazily-registered public blocks reach a `kind:'react'` page's scope, and ReactRunner keeps the errors it catches

  Two defects in the trusted `kind:'react'` page tier.

  **objectui#2953 — the contract skipped lazy blocks.** `getPublicConfigs()`
  resolved every curated `PUBLIC_BLOCKS` tag through `getConfig()`, which reads
  loaded registrations only, so a block registered with `registerLazy()` was
  absent from the contract until its plugin chunk happened to be imported. In
  `apps/console` that silently dropped `object-kanban`, `object-calendar`,
  `object-gantt`, `object-timeline`, `object-map` and `markdown` from every react
  page's scope — writing `<ObjectKanban/>` threw `ReferenceError` even though the
  tag is a first-class contract member, and whether it threw depended on load
  order. `getPublicConfigs()` now resolves pending lazy stubs too, returning them
  with `lazy: true` and no `component` (new `PublicComponentConfig` type); the
  injected wrapper renders through `SchemaRenderer`, which triggers the loader and
  shows its placeholder. `getConfig()` stays loaded-only by design.

  **objectui#2954 — ReactRunner discarded its own error state.**
  `getDerivedStateFromProps` re-transpiled and re-evaluated the page source on
  every render and unconditionally set `error: null`. React runs it before the
  re-render that follows `getDerivedStateFromError`, so the boundary threw away
  the error it had just caught, rebuilt an identical throwing element, and the
  throw escaped past its own `fallback` to the renderer's generic panel; `onError`
  was gated on state that had already been cleared and never fired for a
  compile-time error at all; and each compile minted a fresh page function — a new
  element type — that remounted the subtree and wiped the page's `useState`. The
  transpile+eval is now memoised on `(code, scope)`, errors persist until the
  inputs actually change, and `onError` reports each error exactly once.

## 17.0.0

## 16.1.0

## 16.0.0

## 15.0.0

## 14.1.0

## 14.0.0

## 13.2.0

## 13.1.0

## 13.0.0

## 12.1.0

## 12.0.0

## 11.5.0

## 11.4.0

## 11.3.0

### Minor Changes

- d23d6eb: Three-tier AI page authoring: `kind:'html'` and a trusted `kind:'react'` tier.

  - **`@object-ui/react-runtime`** (new) — the trusted runtime-React tier for
    `kind:'react'` pages (vendored react-runner: Sucrase transpile + scope-eval,
    no sandbox). Renders real JSX/TSX (any HTML + JS + hooks/useState/map/onClick)
    in the main React tree with an injected scope (React, the public data blocks,
    page data) and a built-in error boundary.
  - **`@object-ui/core`** — new runtime capability gate (`enableCapability` /
    `disableCapability` / `isCapabilityEnabled`, `CAP_REACT_PAGES`). `react-pages`
    defaults **ON** (the platform trusts reviewed, draft-gated authors); a
    deployment turns it OFF server-side (the runtime injects the disable global
    when `OS_DISABLE_REACT_PAGES` is set). Never controlled from authored metadata.
  - **`@object-ui/components`** — PageRenderer now routes `kind:'react'`
    (capability-gated, lazy-loads the runtime) and renders `kind:'html'` (the
    former `kind:'jsx'`, still accepted as a deprecated alias). The `html` tier
    now resolves the full safe native HTML tag set (h1–h6, p, a, ul/ol/li, img,
    blockquote, pre, strong/em, …) so authored HTML lives up to its name.
