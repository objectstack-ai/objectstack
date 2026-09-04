# @objectstack/docs

## 4.2.3

### Patch Changes

- 876ccf1: fix(docs): the Backward Compatibility page said MINOR may break "during 0.x" — restate it as the launch-window rule it actually is (#13779)
  
  `content/docs/protocol/backward-compatibility.mdx` closed with a `Pre-1.0
  Disclaimer` reading:
  
  > During the **0.x** development phase, MINOR versions may contain breaking
  > changes. The full backward compatibility policy takes effect starting with
  > version **1.0.0**.
  
  The published stack is at **17.2.0**, so a reader dismisses that paragraph as
  obviously stale and is left with the page's opening SemVer table, which says a
  MINOR keeps existing code working. **That is the wrong way round.** The
  disclaimer's *substance* is the part that survived; only its `0.x` / `1.0.0`
  framing died.
  
  Deleting the paragraph would therefore have silently **strengthened** a
  customer-facing compatibility promise into one the repo contradicts on every
  release. Four independent sources say breaking changes ship as MINOR today:
  
  - **`.changeset/config.json`** — all **69** published packages sit in one
    Changesets `fixed` group (`check:changeset-fixed`: *"fixed group is in sync
    with 69 public workspace packages"*), so no published surface is exempt and a
    single `major` would promote the whole stack.
  - **`scripts/check-changeset-no-major.mjs`** — a wired, currently-enforcing CI
    guard (`.changeset/pre.json` is absent, so the RC exemption is not in play)
    whose header states the convention outright: *"During the launch window we ship
    breaking changes as `minor`."* `--list` reports **559 pending changesets, 0
    declaring a major**.
  - **`packages/spec/CHANGELOG.md`** — the `17.2.0` **Minor Changes** section
    carries an entry marked `**BREAKING**` (the `http_request_errors_total`
    retirement under ADR-0049).
  - **`content/docs/releases/`** — v13, v14, v15 and v17 already tell customers
    this. v15.1.0: *"Strict-semver breaking, shipped in a minor under the
    launch-window policy."* v17: *"17.1.0 and 17.2.0 are minors by version number,
    not by blast radius."*
  
  The section is retitled `Launch Window: MINOR Releases Can Contain Breaking
  Changes` and now states the rule definitely rather than hedging it: which
  surfaces it covers (all 69), that it is gate-enforced, what an upgrader should do
  instead of trusting the version number, that MAJORs still happen when breaking
  density demands one, and that it overrides the tables above wherever they
  disagree.
  
  Nothing links to the old `#pre-10-disclaimer` anchor (grepped repo-wide), so the
  retitle breaks no inbound reference.
  
  <!-- adr-0087: not-required (unpublished) The only bumped package is @objectstack/docs, which is `private: true` and absent from the Changesets `fixed` group, so nothing here reaches a published surface. This changeset removes, renames and narrows nothing; the BREAKING wording in the body quotes changelog entries that already shipped, and is not a breaking change declared by this diff. -->
- 18b6d89: build(docs): stop emitting the 348 MB of server source maps the OOM-killed build was paying for (#12711)
  
  Every `objectstack.ai` production deploy on 2026-08-27 died with `exit 137` and
  Vercel's `errorCode: "out_of_memory"` on a 4-core/8192 MB build machine. The
  build now declares `experimental.turbopackSourceMaps: false`, which suppresses
  260 map files totalling 348 MB that no production serverless function reads.
  
  The knob matters because of **where** the kill lands. Every failing log places it
  between `Creating an optimized production build ...` and `Compiled successfully`,
  with no output in between — inside the Turbopack compile phase, which the two
  knobs already present cannot reach:
  
  - `experimental.cpus: 2` bounds static-generation workers that have not spawned
    yet when the process dies.
  - `NODE_OPTIONS=--max-old-space-size` bounds V8's old space, while Turbopack
    allocates from Rust outside it.
  
  Measured on a local cold build of all 403 pages, as peak single-process RSS:
  
  | config | peak | compile |
  |---|---|---|
  | before | 5191 MB | 22.6s |
  | **`turbopackSourceMaps: false`** | **4757 MB** | **19.5s** |
  | `turbopackScopeHoisting: false` | 4806 MB | 19.1s |
  | `--max-old-space-size=2048` | 4734 MB | 18.0s |
  | `turbopackFileSystemCacheForBuild: true` | 4779 MB | 22.2s |
  
  Only the first row moves anything; the rest are noise, which is the measurement
  that retires them as candidates rather than leaving them to be re-tried.
  
  Set explicitly on purpose. Next documents this flag's build-time default as
  following `productionBrowserSourceMaps` (false), but the server-side maps are
  emitted regardless — naming it is what suppresses them.
  
  Deliberately not paired with `turbopackMinify: false`, which takes a further
  972 MB off the peak (3785 MB) and 3s off the compile: it inflates client JS from
  5.8 MB to 16 MB (+176%), a cost every reader pays on every visit to save memory
  in a machine they never touch. Confining minification to the server side — where
  the memory actually goes, 589 MB of server chunks against 5.8 MB of client — is
  not available: `experimental.serverMinification` is read only by
  `dist/build/webpack-config.js`, never on the Turbopack path.
  
  No output change beyond the absent maps: same routes, same 1221 prerendered
  paths, same rendered bytes.
  
  **This buys margin; it does not prove the ceiling is cleared.** The measurement
  above is macOS/arm64 and the build container is Linux/x86_64, where the same
  phase was measured at 7.6 GB (#12683) against local 4.7 GB — the ratio is the
  transferable part, and −8.4% onto 7592 MB leaves roughly 15% headroom, which is
  thin. #12683's option A (a larger build machine) is unaffected by this change and
  remains the answer if the next production build still dies.
- 168941c: build(docs): stop rebuilding the docs site on every push to `main` (#12743)
  
  Every push to `main` rebuilt the documentation site, and almost none of them
  changed what it renders. Measured over one week across the team:
  
  | project | production builds | build-minutes | avg |
  |---|---|---|---|
  | **objectstack (docs)** | **228** | **2835 (98.6%)** | **12.4 min** |
  | objectui | 123 | 36 | 0.3 min |
  | hotcrm | 42 | 5 | 0.1 min |
  
  The team runs `concurrentBuilds: 1`, so an 18-second `objectui` build queued
  behind a 12–46 minute docs build; the queue reached **92 deployments, the oldest
  34 hours old**. At 4 vCPU those docs builds cost roughly **$171/month** against a
  $20 included allowance, and 168 of the 228 were failures, so most of it bought
  nothing.
  
  `apps/docs/vercel.json` now declares an `ignoreCommand` (which overrides the
  dashboard's Ignored Build Step, moving the rule into version control where it is
  reviewable and revertible). `scripts/vercel-ignore-docs.sh` decides:
  
  1. non-production → skip (unchanged from the rule it replaces)
  2. `content/**` or `apps/docs/**` changed → build
  3. otherwise → ask turbo whether the docs dependency graph is affected
  4. anything indeterminate → **build**
  
  **Step 2 is not redundant with step 3, and dropping it would silently stop
  publishing documentation.** `turbo --filter=<pkg>...[range]` computes affected
  packages *by package directory*, and this repo's MDX lives at the repo root in
  `content/`, outside the `apps/docs` boundary. `turbo.json` does list
  `"$TURBO_ROOT$/content/**"` under `@objectstack/docs#build`'s `inputs`, but
  `inputs` only feeds the cache hash — it does not widen the affected-package
  calculation. Verified on `main`: commit `1265f12b` touches only
  `content/docs/api/client-sdk.mdx`, and a dependency-graph check alone answers
  SKIP for it.
  
  The asymmetry in step 4 is the point. A wrong "build" costs a few build-minutes;
  a wrong "skip" leaves the site quietly stale with no error anywhere. So a missing
  `VERCEL_GIT_PREVIOUS_SHA`, a shallow clone that cannot reach it, an unparseable
  turbo verdict, and a non-0/1 exit from turbo all build.
  
  Deliberately not `npx turbo-ignore`, which #12698 suggested: it is deprecated
  upstream ("Use `turbo query affected` instead") and derives its own comparison
  range, falling back to `[HEAD^]` when it cannot read Vercel's git environment —
  silently answering a different question than the one asked. The range is named
  explicitly here instead.
  
  `scripts/vercel-ignore-docs.selftest.sh` pins all six cases against real commits
  from this repo's history, including the `content/**` one.
- 002ddc5: fix(docs): give the three singular `section:` form-section examples in `layout-dsl.mdx` a `name` i18n anchor (#13759)
  
  `content/docs/protocol/objectui/layout-dsl.mdx` teaches form sections twice over: as a
  `sections:` **sequence**, and as a singular `section:` **mapping** — one section on its
  own. The sequence examples were given `name` anchors in the sweep that added the gate's
  YAML arm (#13761); the three singular ones were outside that sweep's population and stayed
  nameless. `FormSectionSchema.name` is the "Stable identifier for translation lookup", so a
  nameless section has no anchor and renders its authored label in every locale — on pages
  whose whole job is to teach the convention.
  
  Three sites, and they are **not** three copies of one edit:
  
  | fence | before | added |
  |:---|:---|:---|
  | `### Basic Grid Layout` | `label: Contact Information` | `name: contact_information` |
  | `### Custom Span Widths` | `label: Product Details` | `name: product_details` |
  | `### Responsive Breakpoints` | **no `label:`** — only `columns:` + `fields:` | `name: responsive_grid` |
  
  The first two take the snake_case of their own label, which is the convention #13761 used
  for the sequence examples on this same page (`contact_information`, `basic_info`,
  `billing_information`). The third has no label to snake_case: it is deliberately minimal so
  the breakpoint discussion is about `columns` collapsing, and none of the three fences' ASCII
  "Rendered Grid" diagrams draw a section header. So it gets a descriptive `name` and **no
  invented `label:`** — adding one would have desynchronised the diagram directly below it,
  and the i18n symptom the other two carry does not even arise for a section with no heading
  to mis-render.
  
  `FormSectionSchema.name` stays `z.string().optional()` — no schema moves here, per #10709
  and #10830.
  
  **These three sites are correct now and still unguarded**, deliberately.
  `check-docs-section-name` judges `sections:` sequences in both of its arms; a singular
  `section:` mapping is outside both, which is how these three drifted in the first place.
  Widening the gate means deciding which YAML keys introduce a form section at all — a
  population question fenced out of this PR by the #13759 triage ruling and filed separately.
- 787d757: fix(docs): stop listing `"index"` in `meta.json` `pages` — it detaches the folder index and shortens 164 breadcrumb trails (#12352)
  
  Fumadocs attaches a folder's `index.mdx` as that folder's tree `index` node
  **only when the folder's `meta.json` does not list it** in `pages`. Listing it
  makes the page an ordinary child instead, and the folder node reaches every tree
  consumer with a `name` and no `url` — `loader-*.js`, `buildFolder()`:
  
  ```js
  if (indexPath) {
    if (excludedPaths.has(indexPath)) delete node.index;   // "index" was listed
    else excludedPaths.add(indexPath);
  }
  ```
  
  Two surfaces read that one node, and both were degraded:
  
  - **Breadcrumb.** `getBreadcrumbItems()` links a folder crumb to `item.index?.url`,
    so an un-linkable ancestor is dropped rather than emitted name-only (Google
    requires `item` on every `BreadcrumbList` entry but the last). 172 of 404 doc
    pages advertised a two-level site structure they do not have.
  - **Sidebar.** `node.index ? SidebarFolderLink : SidebarFolderTrigger` — the
    section header was inert text, and the section's own overview page sat below it
    as a child, in six cases under a label identical to the header's.
  
  `"index"` is removed from 16 of the 17 `meta.json` files that listed it. It was
  the first `pages` entry in 15 of them and the first entry after the
  `---Start Here---` separator in `getting-started`, so no other entry's position
  depends on it: the measured tree delta is exactly 16 folder headers going
  `TRIGGER` → `LINK` and 16 index children leaving the child list, with every
  removed child's URL now the header's `href` and no other line moved.
  
  Short trails: **172 → 8**. The remaining 8 are `content/docs/releases/`, which
  this PR does not touch — that directory is fenced by AGENTS.md, and its
  `meta.json` still lists `"index"`.
  
  No consumer-side change: `app/[lang]/docs/[[...slug]]/page.tsx` reconstructs no
  URLs, deliberately, so a producer defect of this shape stays visible.
- 49e7abb: feat(docs): give a doc page a short sidebar label (`navTitle`) distinct from its `title` (#12311)
  
  A doc page's frontmatter `title` was the only string the site had, so it served
  six consumers with different length budgets at once — measured on `origin/main`,
  405 pages under `content/docs`, whose only frontmatter keys are `title` (405) and
  `description` (405):
  
  | consumer | site |
  |---|---|
  | SERP `title`, OG and twitter metadata | `app/[lang]/docs/[[...slug]]/page.tsx:211,216,227,233` |
  | on-page `h1` | `page.tsx:150` |
  | JSON-LD `TechArticle` headline/name | `page.tsx:123,124` |
  | JSON-LD `BreadcrumbList` | `page.tsx:95` — via the page tree |
  | `llms.txt`, `llms-full.txt`, the `.mdx` endpoints | `app/llms.txt/route.ts:10`, `lib/source.ts` `getLLMText` |
  | Open Graph card image | `app/og/docs/[...slug]/route.tsx:18` |
  | sidebar / page tree | `lib/source.ts` — `loader()` |
  
  A 50–60 character title carrying search intent is right for the first six and
  unreadable in the last, which is why #12237's title rewrite stopped after the
  four pages that have no sidebar entry.
  
  `navTitle` is the page tree's own string. It is declared on the docs page schema
  (`docsSchema = pageSchema.extend({ navTitle: z.string().optional() })` in
  `apps/docs/source.config.ts`) and resolved in exactly one place —
  `apps/docs/lib/nav-title.ts`, whose header is the mechanism's documentation —
  through `fumadocs-core`'s own `PageTreeTransformer` hook, the same extension
  point its built-in icon plugin uses. **`title` is the declared fallback**, stated
  there and at no read site, so all 405 pages keep their present sidebar entry with
  no frontmatter change.
  
  `fumadocs-core@16.14.4` ships no first-class equivalent: its `pageSchema` is
  `{ title, description, icon, full, _openapi }`, its `metaSchema` carries no
  per-page label field, and its page-tree builder reads `{ title, description,
  icon }` off a page. `scripts/check-docs-nav-label.mjs` re-reads both schemas on
  every run, so the day an upgrade does ship one, the gate says migrate.
  
  The separation is pinned rather than described. That gate holds `navTitle` to two
  code sites, executes the resolver over its fallback cases, and keeps the JSON-LD
  breadcrumb's leaf crumb on `page.data.title`: `getBreadcrumbItems` is now called
  with `includePage: false`, so the leaf comes from the page's own title instead of
  its page-tree node — behaviour-identical today (the node's name *is* the title),
  and the one place the short label would otherwise have reached structured data a
  crawler reads.
- aed92e9: fix(docs): four pages enumerating the flow refusal codes now name `FLOW_INPUT_SCHEMA_INVALID` (#13720)
  
  `FlowRefusalCode` gained a fourth member in `packages/runtime/src/flow-dispatch-status.ts`
  (`b6d3d76b5`), answered `422` and classified never-dispatched. Three pages were updated with
  it; four others enumerate the same union and were not, so each stated the enumeration as
  **complete** while it was one code short — a teaching surface telling a reader that a status
  they will really receive does not exist.
  
  | page | the row that was short |
  |:---|:---|
  | `content/docs/api/declarative-endpoints.mdx` | the `type: 'flow'` delegation row |
  | `content/docs/api/plugin-endpoints.mdx` | `POST /automation/:name/trigger` |
  | `content/docs/protocol/kernel/http-protocol.mdx` | the declared-endpoint `type: 'flow'` answer row |
  | `content/docs/ui/actions.mdx` | the `type: 'flow'` over-REST row |
  
  Prose only — no schema, no runtime behaviour and no generated artifact moves. The two
  generated reference pages (`references/api/contract.mdx`,
  `references/api/error-code-ledger.mdx`) already carried the code, which is why the
  generator needed nothing here.
  
  **Which group the new code joins was read off the source, not inferred from the status.**
  `classifyFlowRefusal` tests `FLOW_INPUT_SCHEMA_INVALID` inside the
  `── never dispatched: the producer says WHICH refusal ──` arm block, above the
  `result.status === 'failed'` arm that answers `400 FLOW_FAILED`. `ui/actions.mdx` is the
  one page that splits its enumeration into "a run that ran and was rejected" versus "a
  dispatch that never happened", so the code is placed in the second group there; putting it
  beside `FLOW_FAILED` would have said the run started.
  
  `422` is now carried by two codes (`FLOW_NO_START_NODE` and `FLOW_INPUT_SCHEMA_INVALID`).
  Each page spells the status together with its code, so every entry stays a self-contained
  pair rather than a claim about what `422` alone means — the discriminator is `error.code`,
  which is what `http-protocol.mdx` already tells readers to branch on. The full table with
  per-code guidance stays where it is, in `content/docs/automation/flows.mdx`.
- aee1fd9: docs(react-pages): delete the unreachable `Array.isArray(result)` limb from the live-data sample
  
  `ObjectStackAdapter.find()` cannot resolve to an array, so the `Array.isArray(result)`
  arm the live-data sample carried could never be taken. Re-derived against objectui at
  the sha this repo pins (`9602dc82`) and again at objectui `origin/main`, which agree
  line for line:
  
  - `find()` returns from five points — `{ data: [], total: 0 }` for a resource already
    memoized as missing, `{ data: [], total: 0 }` for a fresh 404 that is not an
    `enable`-block denial, two `normalizeQueryResult(...)` calls (the `$expand`/`$search`
    raw-GET path and the client-SDK path), and `return existing`, which hands back a
    promise produced by that same set.
  - Both branches of `normalizeQueryResult()` return an object literal with exactly
    `data`, `total`, `page`, `pageSize`, `hasMore`. The first branch is the one that
    makes the limb dead: it tests `Array.isArray(result)` on the *transport* response and
    **wraps** a bare array into that envelope. The array case is folded before any caller
    sees it.
  
  The sample now reads `result.data` directly, and a new paragraph under it states the
  envelope contract so the reason survives the next edit. The two `kind:'react'` pages in
  `examples/app-showcase` carrying the same dead limb — `crm-workbench` and
  `renewals-pipeline` — were repaired in the same edit, with the derivation recorded in the
  comment that already explains the neighbouring `.records` trap.
  
  Behaviour-preserving: `.data` was read first and always won. What goes is a shape the
  producer cannot emit, sitting in the page a customer — and a coding agent — copies from.
- d7e8f3e: docs(react-pages): scope the react-only half of the page to the `react` tier (#13737)
  
  `content/docs/ui/pages.mdx` routes **both** source-authoring tiers to
  `content/docs/ui/react-pages.mdx` — the links at `:66`, `:116` and `:295`, the
  last of which advertised the target as "The `html` and `react` source-authoring
  tiers in full". On that page only the first two sections were tier-neutral.
  Everything from `## What is in scope` down was react-only material carrying no
  tier marking, so an `html`-tier reader arriving from any of those links read it
  as their own.
  
  That is the mechanism behind the naming trap #13734 closed with one sentence.
  This closes the rest of the class the same way — **marking, not a split**: no
  new page, no repointed links, no section moved between files.
  
  Nine react-only sections were audited against source for the one question "is
  there a statement here an `html` author could act on and be wrong?". Seven were
  **actively misleading**, and all seven are consequences of the same fact the
  page already states twice up top — an `html` page's source is *parsed, never
  executed*:
  
  - `## What is in scope` — the closure-scope table (`React`, `useAdapter`,
    `Block`, `data`/`variables`/`page`) is the react runtime's injected scope. An
    `html` page has no closure scope at all.
  - `## Blocks take flat props` — `parse.ts` refuses every `on[A-Z]` attribute
    (`forbidden-attr`), so the `onRowClick` callback wiring has no html
    counterpart; and the `type` → `specType` rescue is the react runtime's
    (`specType` occurs nowhere else in this repo). On html the parser builds
    `{ type: tag, ...props }`, so a `type` attribute overwrites the discriminator
    — and `object-chart` declares no `type` input in `sdui.manifest.json` anyway.
  - `### Block — the escape hatch` — `compile()` whitelists
    `Object.keys(manifest.components)`; `block` is not one of the 57 keys, so
    `<Block>` is not a tag an html page may write.
  - `## Live data` — `useAdapter` and hooks exist only where the source runs, and
    the sample is refused by the html grammar before that matters.
  - `## Accepted source shapes` — **inverted**. The html grammar is
    `document := element`: `function Page() { … }` and `() => …` fail `no-root`,
    and the prescribed fix `export default Page;` is a second root
    (`multiple-roots`). An html author following the section verbatim writes
    source that cannot save.
  - `## When something throws` — describes a runtime that executes. An html
    page's errors are save-time diagnostics (`jsx-forbidden-tag`,
    `jsx-unknown-component`, `jsx-no-root`, …), not a React error panel.
  - `` ## `record:*` blocks are not in this tier `` — **inverted, and the
    sharpest**: `validateReactPageProps` skips every page whose `kind !== 'react'`,
    and `record:details` / `record:related_list` are registered tags in the html
    manifest. The heading told html authors to stop using the blocks their tier
    composes record pages with. Retitled to name the tier (anchor
    `#record-blocks-not-in-react` preserved; the only inbound link is on the same
    page).
  
  Two sections in the middle of that run are **both-tier** and are now marked as
  such rather than swept up: `## Styling`'s Tailwind rule (`page.zod.ts`: "Do not
  author Tailwind classes in page source in either tier") and `## How you check
  your work`'s three commands. This is why a single marker at the top of the run
  would have been wrong.
  
  Every marker is one bold lead-in that names the tier and then names the html
  counterpart — #13734's own convention, with `On this tier` spelled as
  ``On the `react` tier`` so it cannot be read as either tier. The three
  occurrences of the bare phrase already on the page were normalised to match, so
  the page now contains none.
  
  `pages.mdx:295` no longer claims the page covers both tiers "in full" — it
  never did, and the audit makes the gap explicit. It now says what the page is:
  choosing between the tiers, plus the `react` tier's guide in full.

## 4.2.2

### Patch Changes

- 72d75eb: docs site: drop `output: 'standalone'` so the production build stops failing
  
  The production build of the docs site died at the end of `next build` with
  `ENOENT: no such file or directory, open '.../apps/docs/.next/next-server.js.nft.json'`,
  so nothing merged to `main` reached the site.
  
  That file is opened by the standalone packer (`writeStandaloneDirectory` ->
  `copyTracedFiles`), which Next calls **only** when `output === 'standalone'`.
  Nothing in this repo consumes `.next/standalone` — no Dockerfile, workflow,
  script or config references it, and `docker/Dockerfile` does not build
  `apps/docs` at all — and Vercel does its own serverless packaging. The setting
  served no consumer and was the sole reason that read happened, so removing it
  removes the only code path that can raise this error.

## 4.2.1

### Patch Changes

- 04a29c7: docs: add `concepts/metadata-lifecycle.mdx` documenting the Repository →
  Change Log → Cache → Registry data path (ADR-0008), the overlay whitelist
  invariant (ADR-0005), and end-to-end HMR semantics. Cross-linked from
  `concepts/metadata-driven` and `guides/contracts/metadata-service`. Closes
  M0 PR-11.

## 4.2.0

## 4.1.1

## 4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release

## 4.0.4

## 4.0.3

## 4.0.2

## 4.0.0

## 3.3.1

## 3.3.0

## 3.2.9

## 3.2.8

## 3.2.7

## 3.2.6

## 3.2.5

## 3.2.4

## 3.2.3

## 3.2.2

## 3.2.1

## 3.2.0

## 3.1.1

## 3.1.0

## 3.0.11

## 3.0.10

## 3.0.9

## 3.0.8

## 3.0.7

## 3.0.6

## 3.0.5

## 3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.

## 3.0.2

## 3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

## 2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.0

## 1.0.12

## 1.0.11

## 1.0.10

## 1.0.9

## 1.0.8

## 1.0.7

## 1.0.6

## 1.0.5

## 1.0.4

## 1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.

## 1.0.1

## 1.0.0

## 0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.

## 0.8.2

## 0.8.1

## 1.0.0

## 0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2

## 0.1.1

### Patch Changes

- Patch release for maintenance and stability improvements
