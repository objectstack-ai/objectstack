# @objectstack/lint

## 11.7.0

### Minor Changes

- 5178906: ADR-0085: object presentation intent is declared as cross-surface semantic
  roles, never as per-surface hint blocks.

  **@objectstack/spec**

  - New top-level `stageField: string | false` — names the object's linear
    lifecycle field (`false` declares the status-like field non-linear and
    suppresses every consumer's stage heuristics). Legitimizes the key the UI
    runtime already read but the schema rejected.
  - `compactLayout` → **`highlightFields`** (the value is an ordered field
    list, not a layout; "highlight" is already the renderer-side term of art).
    `compactLayout` stays accepted as a parse-time alias and is preserved on
    output — the ADR-0079 `displayNameField → nameField` pattern.
  - `fieldGroups[].collapse: 'none' | 'expanded' | 'collapsed'` replaces
    `defaultExpanded` AND the UI-dialect `collapsible`/`collapsed` boolean pair
    (which had drifted two ways: spec declared a key no renderer read, renderers
    read keys the spec rejected). Old keys map onto the enum at parse and remain
    accepted for one minor.
  - `fieldGroups[].visibleOn` removed (no consumer anywhere — ADR-0049
    enforce-or-remove; re-add together with its enforcement when a surface
    evaluates it).
  - The `detail: { … }.passthrough()` UI-hints block is **removed**. Every key
    in it was either unauthorable, a proven no-op for spec authors
    (`hideReferenceRail` — the rail is default-off and its enabling key was
    never typed), or a per-page toggle that belongs to an assigned Page. Zero
    authors existed across framework and objectui (evidence in ADR-0085); the
    removal ships as a minor under the documented dead-surface exception
    (PR #2272 precedent).
  - New `deriveFieldGroupLayout(def)` in `@objectstack/spec/data` — the single
    source of the fieldGroups rendering semantics (declared order, empty groups
    dropped, ungrouped trailing bucket minus audit/system fields, collapse
    passthrough incl. deprecated aliases). UI renderers consume this instead of
    their two pre-existing near-identical local copies.

  **@objectstack/lint / @objectstack/cli**

  - New `validateSemanticRoles` (wired into `os lint`): warns on
    `Field.group` → undeclared group, declared-but-unreferenced groups, and
    `stageField`/`highlightFields` entries naming non-existent fields — the
    dangling-pointer shapes that are Zod-valid but silently inert at render
    time (ADR-0078 completeness gate).

  **@objectstack/platform-objects**

  - All 35 system objects renamed `compactLayout:` → `highlightFields:`
    (behaviour unchanged via the alias).

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/sdui-parser@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/formula@11.6.0
- @objectstack/sdui-parser@11.6.0

## 11.5.0

### Minor Changes

- 5a5bf61: ADR-0081 Phase 2: a build-time prop check for `kind:'react'` pages. After the
  syntax gate, `validateReactPageProps` parses the real JSX (TypeScript compiler)
  and checks each usage of an injected block (`<ObjectForm>`, `<ListView>`, …)
  against the react-tier contract (`REACT_BLOCKS` from `@objectstack/spec/ui`):
  missing a required binding (e.g. `<ObjectForm>` with no `objectName`) is an
  error; a near-miss prop (`onSucces` → `onSuccess`) is a warning. Wired into
  `os validate`. Curated data props are not flagged (low false-positive); a spread
  `{...props}` escapes the required check. (`typescript` moves to `@objectstack/lint`
  dependencies so it externalizes instead of bundling into the CLI.)
- ec7175d: Add the source-page styling guardrail (ADR-0065): `os validate`/`os build` now flags Tailwind `className` in `kind:'html'`/`kind:'react'` page source, which silently produces no CSS because the build never scans authored metadata. New `validatePageSourceStyling` rule with an actionable inline-style/`hsl(var(--token))` fix; also corrects the react-blocks contract, the objectstack-ui skill, the layout-dsl docs, and ADR-0080/0081 away from the "HTML + Tailwind" framing.

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/sdui-parser@11.5.0

## 11.4.0

### Minor Changes

- 5821c51: ADR-0081: split the AI page-authoring surface into honest tiers.

  - `PageSchema.kind` gains `'html'` and `'react'`. `'html'` is the constrained
    parse-never-execute tier (the renamed `'jsx'`, kept as a deprecated alias);
    `'react'` is the real-React tier (executed at render by
    `@object-ui/react-runtime`). It runs author JS, so it is gated by a host
    capability that **defaults ON** (the platform trusts reviewed, draft-gated
    authors) and is disabled **server-side** via the `OS_PAGE_REACT=off`
    env toggle. The completeness gate now requires `source` for all three kinds.
  - `@objectstack/cli` console serving injects the disable global into the served
    HTML when `OS_PAGE_REACT=off` (read per request, no rebuild).
  - `validate-jsx-pages` lints `html`/`jsx` (constrained parse). A new
    `validate-react-pages` transpiles `react` source with Sucrase (transpile-only,
    never executed) so syntax errors fail at `os build` instead of at render.

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/sdui-parser@11.4.0

## 11.3.0

### Minor Changes

- 58e8e31: feat(lint): ADR-0079 record-title gate — deprecate titleFormat + record-title validator

  A record's human title is a structural invariant (ADR-0079): every object
  resolves a primary title from a real STORED field via `nameField` (the
  canonical pointer; `displayNameField` is the deprecated alias) or a
  deterministic derivation. This adds build-time diagnostics so `os build` /
  `os lint`, the MCP authoring surface, and hand-authoring all get the coverage
  cloud graph-lint already has (the ADR-0078 "not cloud-only" principle):

  - `title-format-retired` — flags an object that declares a `titleFormat`. That
    key is a render-only template the server can neither return nor query;
    ADR-0079 retires it in favour of `nameField`. The schema still parses it
    (existing metadata keeps loading), so this is advisory, not an error.
  - `title-unresolvable` — flags an object whose title cannot be resolved from any
    stored field (`objectTitleCompleteness` reports `status: 'none'`).

  `@objectstack/spec` carries the `titleFormat` `.describe()` deprecation note;
  the `@objectstack/cli` `lint` command wires the new validator into its run.

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/sdui-parser@11.3.0

## 11.2.0

### Minor Changes

- 8ea1f4f: ADR-0080 M3b②: `os validate` / `os build` now parse `kind:'jsx'` page `source` via `@objectstack/sdui-parser` (new `validateJsxPages` lint rule) — malformed JSX fails loudly at author time (ADR-0078) instead of being stored and breaking only at render. Parse-level for now (syntax, tag matching, forbidden constructs like event handlers / dangerouslySetInnerHTML); full component/prop whitelist validation arrives once the registry manifest is threaded through `compile()`.
- 21c37d8: ADR-0080 M3b① (consumption seam): the `os build` / `os validate` JSX gate now does **full component/prop validation** (unknown component, missing/wrong prop, bad enum, bindings) when a `sdui.manifest.json` is present at the project root — falling back to parse-level otherwise. `validateJsxPages` accepts an optional manifest; the validate command loads the file when present. Generating + shipping that manifest from the registry's public tier remains a build/CI step.

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
- Updated dependencies [012c046]
  - @objectstack/spec@11.2.0
  - @objectstack/sdui-parser@11.2.0
  - @objectstack/formula@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0
  - @objectstack/formula@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/formula@11.0.0

## 10.3.0

### Minor Changes

- f75943a: feat(lint): SDUI styling validator (ADR-0065)

  `validateResponsiveStyles` — a pure `(stack) => Finding[]` rule wired into
  `os validate` and `os compile`, so hand-authored and AI-generated pages are
  held to the same bar (ADR-0019). Catches the deterministic ways a
  `responsiveStyles` block silently fails: a styled node with no `id` (CSS can't
  be scoped → dropped) is an **error**; warnings cover Tailwind-in-`className`
  (silently dead in metadata), a smaller breakpoint with no `large` base, unknown
  CSS properties, and unknown/typo'd design tokens. Quality/visual judgement
  (is it ugly) is out of scope — that needs render + a VLM gate.

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/formula@10.3.0

## 10.2.0

### Minor Changes

- 63f3219: feat(lint): extract static metadata validators into @objectstack/lint (ADR-0019 P3)

  New public package `@objectstack/lint` holds the pure, build-time metadata
  validators as `(stack) => Finding[]` functions, so the same rules run wherever a
  stack can be assembled — the CLI's `os validate`/`compile` and any other
  consumer (notably AI-driven authoring), instead of being trapped in CLI
  internals where only the CLI could reach them.

  First release moves the two validators the AI build needs:

  - `validateWidgetBindings` — dashboard widget → dataset → measure/dimension
    reference integrity + measure-aggregation coherence (ADR-0021).
  - `validateStackExpressions` — CEL/predicate validity for field conditionals,
    sharing rules, action visible/disabled, lifecycle hooks (ADR-0032).

  `@objectstack/cli` now imports both from `@objectstack/lint` (was `./utils/*`);
  pure move, no behavior change. Dependency direction is one-way `lint → spec`;
  the package never depends on a runtime and is never bundled into a frontend
  (that is why the validators do NOT live in the frontend-facing `@objectstack/spec`).

  Filesystem-coupled checks (`lint-liveness-properties`) and CLI-command-coupled
  ones (`score` → `lintConfig`) deliberately stay in the CLI for now; they can
  move in a later increment.

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/formula@10.2.0
