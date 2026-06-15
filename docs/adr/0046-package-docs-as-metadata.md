# ADR-0046: Package documentation as metadata — flat `src/docs/*.md` compiled into the manifest

**Status**: Proposed (2026-06-12, revised — simplified from the original directory/docSet design)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (package + versioned releases), [ADR-0016](./0016-studio-package-authoring-and-publish.md) (publish pipeline, `manifest_json` snapshot), [ADR-0025](./0025-plugin-package-distribution.md) (artifact distribution, trust boundary), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (AI as primary author)
**Consumers**: `@objectstack/spec` (`DocSchema`, stack `docs` element), `@objectstack/cli` (collection, publish lint), `@objectstack/console` (doc rendering route), cloud control plane (registry rendering, grants), `@objectstack/core` (kernel registers `doc` as inert metadata)
**Pilot**: `os-tianshun-mtc`

---

## TL;DR

A package today carries every behavioral fact about itself — objects,
fields, validations, flows, permissions — but not one sentence of *intent*:
what it is, how its users operate it, how its admins run it. That prose
lives in ad-hoc repo trees and static sites that rot the moment metadata
changes, and reaches customers through channels that duplicate the
registry's versioning and access control.

This ADR makes documentation a **metadata element**, with the smallest
possible shape:

- **One flat directory.** Every `.md` file in `src/docs/` (no
  subdirectories) compiles into one `doc` metadata item, exactly like a
  view or a dashboard. There are no docSets, no `meta.json`, no ordering
  files, no directory taxonomy.
- **Filename = metadata name = link anchor = URL.** A doc's identity is
  its filename stem, namespace-prefixed like every other metadata name.
  Docs reference each other with plain relative Markdown links
  (`[guide](./crm_lead_guide.md)`); because the tree is flat, link
  resolution is a basename lookup with zero path arithmetic, and a
  reference never breaks by "moving a file to another folder" — there is
  no other folder.
- **Frontend is one route.** The console renders a doc at
  `/docs/<name>`, rewriting `*.md` links to that route. No help-center
  tree, no sidebar taxonomy, no navigation model in v1.

```
src/docs/                      compiled into stack `docs: DocSchema[]`
├── crm_index.md               what this package is
├── crm_lead_guide.md          how to work leads        ─┐ reference each
└── crm_admin_setup.md         how to configure it      ─┘ other by filename
```

## 1. Context

- The manifest schema has a `description` string and nothing else
  documentation-shaped. ADR-0025 defines how code and dependencies
  travel; nothing defines how *intent* travels.
- Pure-element packages publish as a single self-contained JSON
  (`dist/objectstack.json` → `sys_package_version.manifest_json`,
  ADR-0016). Anything added to the stack therefore reaches the registry
  **with zero registry schema changes**, and `sys_package_grant`
  authorization applies automatically — granting a package grants its
  docs.
- The first revision of this ADR designed a directory taxonomy (closed
  docSet enum, per-directory `meta.json` ordering files, four lifecycle
  trees). Review verdict: that is a *site* design, not a *metadata*
  design. Every other metadata element is a flat, namespace-keyed
  collection; docs gain nothing from being the one tree-shaped element,
  and the tree actively hurts the property docs need most —
  **stable cross-references**. A reference into a tree encodes a path;
  paths change when content is reorganized. A reference into a flat
  namespace encodes a name; names are forever.
- Going forward AI writes most documentation (ADR-0033). Flat,
  name-addressed items are also the shape AI authors best: create/update
  one item, link by name — identical to how it already authors objects
  and views (draft-gated via `saveMetaItem`, same review pipeline).

## 2. Goals & Non-goals

### Goals

- A spec'd `doc` metadata element: schema, naming, collection rule,
  cross-reference rule, syntax boundary.
- CLI collection (`os build`) and publish lint (broken links, banned
  syntax).
- One console rendering route, plus AI-assistant grounding (agents answer
  "how do I…" from the package's own docs — same JSON the kernel loads).

### Non-goals (unchanged from the original revision)

- **Delivery documents** (contract-bound, milestone-frozen) — convention
  `delivery/`, outside the package.
- **Standalone product doc sites** (docs.objectstack.ai) — those are
  websites; `content/docs/` remains their convention.
- **Internal engineering notes** — `internal/`, never ships.
- Rich media: v1 is text-only (§3.4).

### Explicitly deferred (was in the original revision, cut from v1)

Directory taxonomy / docSets, `meta.json` ordering, help-center
navigation tree, `CHANGELOG.md` collection, per-package-type minimal-set
enforcement, `binds` contextual help, i18n sibling files, quality-gate
tooling (`os docs lint|verify` beyond publish lint), asset service.
Each is additive on top of flat name-addressed items; none is expensive
to retrofit, so none is mandatory now.

## 3. Design

### 3.1 Schema

```ts
// packages/spec/src/system/doc.zod.ts
export const DocSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/)
    .describe('Unique doc name; MUST carry the package namespace prefix (enforced by build/publish lint)'),
  label: z.string().optional()
    .describe('Display title; defaults to the first `#` heading, then the name'),
  description: z.string().optional()
    .describe('One-line summary for listings (frontmatter `description:`); travels in the list response'),
  content: z.string().describe('Raw Markdown (CommonMark + GFM)'),
});
```

`StackDefinition` gains `docs: z.array(DocSchema).optional()`, beside
`views` / `dashboards`. The kernel registers metadata type `doc` as
**inert data** — no runtime behavior, no load-order participation.
Two hard requirements keep manuals out of hot paths: the kernel load
path must not parse or validate `content` beyond schema type-checking,
and the metadata list endpoint must support returning `name` + `label`
without `content` — docs are the one element whose payload grows
unbounded, and manifest-size pressure lands here first.

### 3.2 Collection (one rule)

`os build` compiles every `src/docs/*.md` into one `DocSchema` item:

- `name` = filename stem. The stem MUST match `^[a-z][a-z0-9_]*$` and
  carry the package namespace prefix (`crm_lead_guide.md` →
  `crm_lead_guide`). A package that ships docs MUST declare
  `manifest.namespace` — the natural extension of "defining objects
  requires a namespace".

  The prefix requirement *looks like* the object rule but sits at a
  different layer, and the enforcement posture follows from that.
  Object names are prefix-validated in the kernel because they are
  physical: object name = table name in a shared database; a collision
  is a data-layer disaster. Doc names have no physical footprint; their
  uniqueness need is logical — the metadata registry key is
  `org/type/name` with **no package coordinate**, so two packages
  shipping the same bare name silently overwrite each other
  (last-write-wins), and the console route `/docs/<name>` plus all
  cross-references key on the name. Hence: enforced as **build/publish
  lint**, not kernel-level rejection. `doc` is a new type with zero
  legacy, so day-one lint costs nothing — the same reasoning as the
  image ban.
- `label` = frontmatter `title:` if present, else first `#` heading.
- `description` = frontmatter `description:` if present (optional one-line
  summary; the docs portal renders it under the title).
- `content` = the file body (frontmatter stripped).
- **Subdirectories under `src/docs/` are a build error**, not silently
  flattened — flatness is the contract that keeps references stable.

TS-first stacks may also pass `docs: [...]` inline in `defineStack()`;
the md-file convention is sugar over the same array.

### 3.3 Cross-references

Docs link to each other with plain relative Markdown links:

```md
See the [lead guide](./crm_lead_guide.md#qualification) for details.
```

- Resolution rule: strip `./` and `.md` → doc name. Because names are
  globally unique, this resolves the same way everywhere — inside the
  authoring repo (editors/GitHub preview work natively), in the console,
  in the registry, even **across packages** (a doc may link to a
  dependency's doc by its name).
- Publish lint resolves every relative `.md` link against the package's
  docs plus its dependencies' docs; unresolvable links block publish.
  This check is trivial *because* the namespace is flat.
- Cross-package links are checked at publish against the dependency
  versions present at publish time; a dependency may later remove a
  doc. Renderers degrade an unresolvable link to a "doc not found"
  notice — link integrity must NOT couple into install-time dependency
  resolution (that would be over-design for prose).
- Semantic links to metadata (`object://crm_lead`) remain reserved
  syntax renderers may resolve later; v1 lint only requires they parse.

### 3.4 Syntax boundary (the two day-one prohibitions, unchanged)

1. **Pure Markdown** (CommonMark + GFM). **MDX is forbidden**: MDX is
   code, and rendering publisher-supplied code inside the platform
   origin crosses the ADR-0025 trust boundary. Markdown is data; a
   sanitizing pipeline renders third-party packages safely.
2. **No image references in v1** (publish lint rejects `![](…)`).
   Binaries bloat artifacts; external URLs break version immutability
   and leak customer data to unmanaged hosts. v2 introduces a
   content-addressed platform asset service; enforcing the ban from day
   one means zero legacy cleanup.

### 3.5 Derived content is rendered, never written (unchanged)

Anything reconstructible from the manifest — field dictionaries, option
lists, validation conditions, permission matrices — is a **metadata
view**: the platform renders it live. It must not exist as authored
prose or generated markdown committed to the repo (a cache in git, with
a cache's lifecycle). The one exception is a **frozen export** (e.g. a
confirmation PDF) bound to a released version: produced once, never
maintained, so it cannot rot.

### 3.6 Distribution & rendering

- **v1 needs no registry change**: docs ride `manifest_json`; package
  visibility and `sys_package_grant` apply automatically.
- Two address spaces, two coordinate systems: *inside an instance*,
  namespace uniqueness is guaranteed, so routes are single-coordinate
  (`/docs/<name>`); *in the registry/cloud*, namespace uniqueness does
  not hold across publishers and versions coexist, so registry surfaces
  address docs with full coordinates (package id + version + name).
  Neither weakens the other.
- The standard metadata read API serves a doc by name
  (`type='doc', name='crm_lead_guide'`) like any other metadata item.
- **Console**: one route, `/docs/<name>` — fetch, sanitize, render
  Markdown, rewrite `*.md` links to `/docs/<target>` (anchors
  preserved). Any surface that wants to point at documentation (registry
  package page, app navigation, an agent's answer) does so with that
  URL. Navigation/sidebar/search are later, additive concerns.
- **AI assistant grounding**: in-app agents load the package's docs as
  context to answer "how do I…" — likely the highest-frequency consumer
  and a direct payoff of docs-in-manifest.

## 4. Alternatives considered

| Alternative | Verdict |
|:--|:--|
| Directory taxonomy: closed docSet enum + per-directory `meta.json` (the original revision of this ADR) | A site design, not a metadata design. Trees make cross-references path-shaped and fragile; ordering files are structure-beside-content that AI must keep in sync. Flat name-addressed items match every other metadata element and make link lint trivial. Navigation, when needed, becomes *derived* structure (or an explicit later element) — not authored directory shape. |
| Package-scoped doc names + `/docs/<package>/<name>` URLs | Two coordinates per reference; cross-package links and "one URL per doc" both get harder. Namespace-prefixed names reuse the platform's existing uniqueness rule for free. |
| Static doc sites per project (Pages/R2 + auth) | Duplicates registry versioning, identity, and grants. Acceptable only as a transition channel. |
| Generated reference markdown in-repo | A cache in git; rots by construction (§3.5). Validated empirically on the pilot. |
| MDX / React components in docs | Code crosses the trust boundary; interactivity comes from renderer-side directives and metadata views. |
| `content/docs/` as the package-docs home | `content/` is the standalone-website convention; package docs are package source → `src/docs/`. |

## 5. Phasing

| Phase | Scope | Depends on |
|:--|:--|:--|
| **P0** (no platform change) | Repo convention (`src/docs/*.md` flat, naming rule, link style) on pilot projects | this ADR |
| **P1** (framework) | `DocSchema` in spec; `os build` collection; publish lint (naming, flatness, link resolution, MDX/image ban); kernel `doc` type | P0 |
| **P2** (console/cloud) | `/docs/<name>` rendering route; registry package page renders the package's `*_index` doc; AI-assistant grounding | P1 |
| **P3** (enrichment, all additive) | navigation/search, `binds` contextual help, i18n, quality gates, asset service + images | P2 |

P0 conventions are isomorphic to the P1 schema by construction: when the
compiler lands, pilot content migrates with zero edits.

### P3 design note — tags / categorization (deferred, not bolted on early)

Tags, categories, and ordering are **navigation-model** concerns and stay
in P3 by design — adding them before there is enough doc volume to need
filtering buys an i18n-bearing protocol field with no payoff. When they
land, design the discovery surface (tags + category + search + cross-package
aggregation) as one thing, not field-by-field. The agreed shape for tags:

- **A tag is a stable key, never a display string.** Display always resolves
  through the platform's existing label-key → i18n mechanism, exactly like
  every other label. Free-form display strings fail twice: cross-package
  fragmentation (`setup` vs `getting-started` vs `quickstart`) and no i18n
  owner. Keying fixes both.
- **Layered vocabulary, not closed-vs-open.** The protocol blesses a *small
  core* of cross-cutting "purpose" tags (`getting-started`, `guide`,
  `reference`, `tutorial`, `api`, `migration`, `troubleshooting`) — central
  i18n, eligible for dedicated UI. Packages extend with **namespace-prefixed**
  tags (`crm_*`, same rule as doc names) for domain topics, shipping their
  translations in the package i18n bundle (same path as object/field labels).
- Pure closed enum is too rigid (packages can't express domain topics); pure
  open free-form is too fragmented and has no i18n home. The layered
  key-based model is the resolution.

The current addition — `description` — deliberately stops short of this: it is
a per-doc summary, not a taxonomy, so it carries no i18n-keying or
cross-package-coherence burden.

---

## 6. P3 increment — navigation via the `book` element

**Status**: Accepted (2026-06-15) — concretizes the P3 "navigation" row.
This is the navigation model §4 deferred; it is recorded here rather than as a
new ADR because it is purely additive on top of the flat `doc` element and
changes none of P0–P2.

### 6.1 The reversal that isn't

§1 and §4 reject "directory taxonomy: closed docSet enum + per-directory
`meta.json`" as *a site design, not a metadata design*. The `book` element
must be read against that verdict, because it reintroduces ordering and
grouping — the two things that rejection touched. It is **not** the rejected
design, and the distinction is the whole point:

- What §4 rejected was **references encoding paths**. A tree of folders makes
  a cross-reference path-shaped (`../guides/x.md`); reorganizing content breaks
  links. That is the failure mode docs most need to avoid.
- `book` keeps **content flat and name-addressed**. Docs still live in one flat
  `src/docs/`, still reference each other by bare name (§3.3), and those
  references stay valid forever regardless of how any book is arranged. The
  ordering/grouping structure lives in a **separate explicit artifact** that
  references docs *by name* — never by path.

> **Flat content namespace + one explicit nav artifact = hierarchy without
> path coupling.** This is exactly the property §4 wanted and the rejected
> tree-of-folders design could not deliver. Ordering is no longer a per-folder
> file *beside content that must track file moves*; it is a first-class
> element (`book`) that names stable things.

So the rejected design coupled navigation *into* the content layout; `book`
separates navigation *from* it. Same goal, opposite mechanism.

### 6.2 The element: `book` — a spine, not a container

A `book` is **the spine of a table of contents**: an ordered set of *groups*
(sections) plus identity and access. It deliberately does **not** store its
members. Membership — which doc sits in which group — is **derived** from a rule
on each group (plus an optional per-doc ordering), never held in a central
array. This is the load-bearing decision of the whole design, and §6.2.1
explains why it is the property that keeps AI authoring safe.

A package ships **zero or more** books (CRM may ship *User Guide*, *Admin
Guide*, *API Reference*). A book never owns content: a `doc` may surface in two
books or none.

```ts
// packages/spec/src/system/book.zod.ts — the SPINE only
export const BookGroupSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),  // stable group key (overrides / deep links)
  label: z.string(),                           // section title — first-class, i18n-homed
  translations: z.record(z.string(), z.object({ label: z.string() })).optional(),
  order: z.number().optional(),                // order of THIS group within the book
  // membership is DERIVED, not stored:
  include: z.union([
    z.string(),                                // glob over doc names, e.g. "crm_guide_*"
    z.object({ tag: z.string() }),             // or by doc tag (§5 vocabulary)
  ]).optional(),
  package: z.string().optional(),              // scope the rule to a package (default: this one; cross-package via ADR-0048)
  pages: z.array(BookNodeSchema).optional(),   // OPTIONAL explicit override — hand-pin a curated order; wins over `include`
});

export const BookSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/), // namespace-prefixed, like every metadata name
  label: z.string().optional(),
  description: z.string().optional(),
  translations: z.record(z.string(), z.object({
    label: z.string().optional(), description: z.string().optional(),
  })).optional(),
  slug: z.string().optional(),                 // portal URL segment; defaults to name sans prefix
  icon: z.string().optional(),
  order: z.number().optional(),                // orders books within the portal
  audience: z.union([                          // §6.7 — a reference into the permission model, not a bespoke enum
    z.literal('org'),                          // default — inherits the package grant (§3.6)
    z.literal('public'),                       // ≡ the data-layer `guest` profile (anonymous)
    z.object({ profile: z.string() }),         // role-gated, e.g. { profile: 'admin' }
  ]).default('org'),
  groups: z.array(BookGroupSchema),            // the spine: ordered sections. Two levels total.
});

// BookNodeSchema is used ONLY inside an explicit `pages` override:
export const BookNodeSchema = z.union([
  z.string(),                                  // a doc name
  z.literal('---'),                            // separator
  z.literal('...'),                            // rest: docs matched by no explicit entry
  z.object({ doc: z.string().optional(), href: z.string().optional(),
             label: z.string().optional(), badge: z.string().optional(), icon: z.string().optional() }),
]);

// The ONLY per-doc additions — both optional, both scalar (field-merge-friendly, §6.2.1):
//   DocSchema += { order?: number, group?: string }
// `order` sorts a doc within its group; `group` is an explicit placement used
// only when no rule expresses it. Naming-by-convention (`crm_guide_*`) usually
// makes both unnecessary.
```

#### 6.2.1 Why a spine, not a container — the AI-authoring safety property

The earlier draft of this section stored the whole tree in one
`groups[].pages[]` array. That array conflated three concerns with very
different change profiles:

| concern | cardinality | changes | who edits |
|:--|:--|:--|:--|
| group definitions (label / order / i18n) | low | almost never | a human, curating |
| **membership** (which doc → which group) | **high** | **every new doc** | **the AI** |
| in-group order | high | often | AI / human |

Only the first deserves central storage. Putting the high-cardinality,
AI-churned **membership** in a central array breaks the two properties that
matter most here:

- **AI safety — the decisive reason.** ADR-0033 makes AI the primary author,
  and §1 already chose flat docs because AI authors best by *creating one item
  and linking by name*, not by read-modify-writing a shared structure. A
  central `pages` array forces exactly that read-modify-write on every doc the
  AI adds: a stale or concurrent edit silently drops or reorders siblings — the
  failure mode is invisible and lands in navigation, where it is least noticed.
  A **derived** spine removes the write entirely: the AI creates a doc named to
  match a rule (`crm_guide_lead` → caught by `include: "crm_guide_*"`) and it
  files itself. Create-and-forget — the identical shape the AI already uses for
  objects and views, and the whole reason §1 made docs flat.
- **Overlay safety.** Overlay is RFC 7396 JSON Merge Patch, which treats
  **arrays atomically** (whole-array replace, never element merge). A runtime
  nav overlay on `pages` would therefore *shadow* docs a later package version
  adds — the customer's array wins under the `keep-custom` strategy and the new
  docs silently vanish from their navigation. With membership derived and only
  a small, rarely-touched spine stored, the volatile part never enters an
  array; per-doc `order` is a scalar that merges cleanly three-way.

This is **not** the "scatter the category onto every doc" model an earlier turn
rejected. Categories keep a single home — the spine defines their label / order
/ i18n and is the one diffable artifact; only *membership* is distributed, and
usually it is not even stored, it is *matched*. That is the empirically
dominant pattern for content at scale (Docusaurus `_category_.json` + per-doc
`sidebar_position`; WordPress central categories + per-post assignment). The
central-nav-file pattern (Mintlify `docs.json`) only holds for small,
hand-curated sites — not AI-scale authoring.

Locked design choices:

- **Two levels** (groups → docs). Going deeper reintroduces the path-coupling
  §4 fought; when two are not enough, ship **another book** (an effective third
  tier via tabs, no recursion).
- **Membership derived by rule** (`include` glob/tag), with an optional per-doc
  `order` for sorting and an optional explicit `pages` override per group for
  hand-pinned curation. Default rule-based (AI scale); explicit only where a
  human curates a fixed reading path.
- **`...` rest** inside an override sweeps unmatched docs so nothing is dropped.
- **`pages` nodes may be `string | object`** (badge / icon / external `href` /
  `---`) without a v2 break; the bare string is the common case. A nav `label`
  is an optional override — the doc's own `label` stays the title authority.

### 6.3 `book` groups are not P3 tags — two orthogonal axes

§5's P3 note commits to a layered **tag** vocabulary. Tags and book-groups
coexist and must not be conflated:

| | `book` group | tag (§5 P3 note) |
|:--|:--|:--|
| Purpose | **explicit ordered navigation** (the sidebar) | **faceted filtering / search** across docs |
| Shape | positional, hierarchical-by-book | flat, cross-cutting, keyed |
| Scope | within one book | global, cross-package |
| Authority | the book artifact | the `doc`'s own tag list |

A doc can sit under the *Getting Started* group of `crm_user_guide` **and**
carry the cross-package `getting-started` tag. The tag powers a global
"getting started across all your packages" view; the group powers *this book's*
sidebar. Neither subsumes the other — even when a group *selects by* a tag
(`include: { tag: 'getting-started' }`), the tag remains the **doc's** property
(a facet) while the group remains the **book's** section (navigation). The rule
borrows the facet; it does not turn the section into the tag.

### 6.4 Lifecycle — optional, seedable, runtime-editable

- **The package is its own implicit book.** There is always exactly one book
  per package by default — a *synthetic* book keyed by the `packageId` (label
  and `audience` inherited from the package), whose single group lists all the
  package's docs via `...` (alphabetical). `_packageId` is already stamped on
  every doc, so this costs nothing. Authoring a `book` **refines** that default;
  authoring several **suppresses** the synthetic one, and any doc left unplaced
  rolls up under a synthetic *Uncategorized* group shown after them — no doc is
  ever unreachable. `app-todo`'s two docs therefore need **zero** config and
  still render as one clean package-book. The model has no "flat vs book" fork:
  the portal always renders books; "flat" is just the synthetic book.
- **One authoring form: `*.book.ts`.** A `book` is structured navigation
  metadata, so it is authored like every other element — `defineBook({...})`,
  type-checked, collected by `os build`. There is deliberately **no
  `meta.json`** (nor any JSON sidecar): markdown files carry prose content,
  `.book.ts` carries structure, and that is the whole split. A JSON form would
  be a third authoring dialect that serves no one — developers get types from
  TS, and non-developers rearrange in Studio (next bullet), never by
  hand-writing JSON. The original TL;DR's "no `meta.json`" therefore still
  holds: navigation arrives as a typed element, not an ordering file.
- **The file-defined book is a seed, not the source of truth.** The
  `*.book.ts` item enters as a package-provenance row; **runtime edits in
  Studio override it as a user-provenance overlay row** (same posture as
  ADR-0033 draft/overlay). Because the spine is small and rarely touched (§6.2.1)
  the overlay is correspondingly small, and a redeploy's 3-way field merge
  brings in new package sections without clobbering a diverged runtime overlay.
- **`book` opens overlay; `doc` does not.** ADR-0046 keeps `doc`
  `supportsOverlay: false` (§3.1, content is inert). `book` is the deliberate
  exception: navigation is the one docs surface a non-developer is expected to
  rearrange in the UI, so for a low-code platform runtime-editable nav is a
  core capability, not a nicety. `book` is a render-time type like `view` /
  `dashboard`, so it joins their override whitelist: the registry entry sets
  **`allowOrgOverride: true`** (the real flag, per `overlay-precedence`),
  `allowRuntimeCreate: true`, `supportsVersioning: false`, `loadOrder: 99`,
  `domain: 'system'`; a package may still ship a book with `_lock: 'no-overlay'`
  to pin a curated manual.
- **Membership stays current under overlay.** Because membership is *derived*
  (§6.2.1), the rendered tree always reflects the docs that exist *now* — a doc
  a package adds appears immediately via its group rule, even when a runtime
  spine overlay exists. A doc matched by no rule and pinned by no override falls
  to a synthetic *Uncategorized* group (never dropped); publish lint reports it.
  A `pages` override naming a missing doc degrades to a "not found" notice —
  link integrity never blocks build (as §3.3).
- **Guardrail — a `book` is a ToC, never a micro-site.** No theme, no CSS, no
  landing-page/hero fields, no per-book hosting. Those would re-import exactly
  the "site, not metadata" weight §4 rejected. A true end-user documentation
  micro-site, if ever wanted, is a separate, heavier, later element — not an
  accretion onto `book`.

### 6.5 Three tiers, one direction of reference

```
doc        a page          (§3, exists)            inert content, flat, name-addressed
  ⊂ book   a spine (this section)                  ordered groups; membership DERIVED, not stored
  ⊂ library  the /docs portal  (rendering surface) cross-package aggregation — NOT a per-package type
```

- A **package** has many `doc` and many `book`.
- The **portal** ("library") orders books by `book.order` and by the package
  relationship; the **top-level grouping of packages** (Core / Solutions /
  Apps) is a portal-level taxonomy, **deferred and out of scope here** — it is
  not solved by a single package weight and must not be smuggled into `book`.
- Why **`book`** and not `site`/`docSet`/`manual`/`guide`: `site` over-claims
  (theme/domain/landing) and would invite the scope creep §6.4 forbids;
  `manual`/`guide` are too narrow (an API reference is neither) and `guide`
  collides with single-doc connotation; `book` is neutral, short, reads well as
  "a package has multiple books", and sits cleanly beside `view`/`page`/
  `dashboard`. `library` is reserved for the portal if it ever needs a name.

### 6.6 Phasing delta

| Phase | Scope | Depends on |
|:--|:--|:--|
| **P3a** (spec + build) | `BookSchema` (spine); additive `doc.order` / `doc.group`; `defineBook()`; the `include` rule + `...` resolver; orphan lint | P2 |
| **P3b** (kernel + REST) | register `book` (`allowOrgOverride: true`); `GET /meta/book` (sorted by `order`); **read-layer `audience` gating on `/meta/doc`** (§6.7); package-scoped resolution (ADR-0048) | P3a |
| **P3c** (console + Studio) | portal resolves the derived tree (implicit package-book fallback); Studio drag-edit writes back `doc.order` / group rules (overlay); anonymous library via `apps/docs` ISR (§6.7) | P3b |
| **P3d** (deferred) | portal-level package taxonomy; book-level search; tags (§5) | P3c |

The §5 tag note is unchanged and still deferred; `book` lands the *navigation*
half of P3 first because it is the half packages need to ship a readable manual,
and it is independent of the cross-package tag vocabulary.

### 6.7 Access & URL surface — docs are anonymous-capable, apps are not

The largest category difference between `app` and docs: an `app` is an
**authenticated runtime over data**; documentation is **read-only content that
is often meant to be public**. That difference must land in two places — an
access property on the publication unit, and a distinct frontend surface.

**Access is a `book.audience`, expressed in the existing permission model —
not a bespoke enum.** §3.6 today couples docs entirely to the package grant
("granting a package grants its docs"). That is right for the common case and
*wrong* to assume universally: most package docs describe a tenant's configured
app — field names, flows, intent — and **anonymous exposure of those is a
configuration leak**. The platform already has a mature audience vocabulary on
the *data* side (OWD `public_read`, sharing rules with a **`guest`** recipient,
profiles, permission sets); metadata has none. Rather than invent a parallel
two-value flag, `book.audience` is the **first metadata access concept and is
shaped as a reference into that existing model**:

- `audience` defaults to **`org`** — inherits the package grant exactly as §3.6.
- `'public'` ≡ the data-layer **`guest`** profile: anonymous, indexable.
- `{ profile: 'admin' }` gates a book to a profile / permission set — so
  *Admin Guide* visible only to admins is a day-one capability (Phase D
  governance), not a v2 retrofit. The enum never grows; richer gating is just a
  richer profile reference.
- **A `doc`'s effective audience is the union over the books that reference
  it.** Audience lives on the publication unit, never per-doc — per-doc gating
  would leave readers with half-broken navigation. A doc reachable only from
  `org` books stays gated; a doc reachable from one `public` book is public.

This *relaxes* §3.6 (grant-inheritance becomes the default, not the only mode);
it does **not** reopen the §2 non-goal that excluded standalone product doc
sites — a `public` book is still registry metadata (`doc`/`book`), sanitized
and rendered by the platform, not a separately-hosted static website.

**Gating is enforced at the read layer, not just the UI.** Ground truth:
`/meta/doc` is already anonymous-reachable (the gate is the optional global
`requireAuth` or the SPA's `ProtectedRoute`, not the handler). So a public
portal that mixes `public` and gated books **must** apply `audience` inside the
`/meta/doc` and `/meta/book` read path — gating only the UI would let a gated
doc leak straight from REST.

**Two frontend surfaces, addressed differently.** The URL must distinguish the
authenticated app from the docs portal — and not only for the auth gate:

| | app surface | docs portal ("library") |
|:--|:--|:--|
| Auth default | required | **anonymous-first**, login demanded per `org` book |
| Shell | app chrome (nav, user menu, org context) | standalone read-only shell |
| Indexing | noindex, behind auth | **crawlable**: canonical / OG / sitemap |
| Tenant resolution | from session | **from host** (`resolveByHostname`) |

The deciding reasons are the bottom two rows, not the auth gate:

- **SEO**: public docs must be crawlable with clean canonical URLs; app routes
  are post-auth and `noindex`. They cannot share one prefix cleanly.
- **Tenant from host, not path**: the tenant is carried by the **hostname**
  (`<tenant>.docs.<host>`), resolved by the existing `resolveByHostname`
  registry the rest-server already uses for virtual-host tenancy — so the path
  needs **no** tenant coordinate. A doc's canonical URL is `/<lang>/<doc>` (the
  locale segment serves SEO/hreflang, mirroring `apps/docs`). The `book`
  supplies breadcrumb/sidebar **context**, never the canonical path, so a doc
  reachable from two books still has exactly **one** canonical URL. Version is
  also implied by the host (the tenant's installed package version), so an
  anonymous reader needs no version coordinate either.

**One portal, per-book auth — not two URL trees.** The recommended shape is a
single docs portal ("library") that is anonymous-first and escalates to login
only when a requested book's `audience` demands it (`org` or a profile). A doc
therefore has **one
canonical, shareable URL**; public and gated books coexist on the same portal
(the Stripe/GitBook pattern). Splitting into separate public-vs-private URL
trees would give the same content two URLs and is rejected. The `app` stays the
separate authenticated runtime surface; the split that matters is **app vs
library portal**, not public-vs-private *within* docs.

**The portal reuses `apps/docs` (Fumadocs + ISR), it is not greenfield SSR.**
Ground truth: the console SPA cannot do SEO, and `apps/docs` is build-time
static from `content/docs/` — neither renders runtime, host-resolved tenant
metadata. Rather than build a new SSR surface, the recommended path is to point
the existing **Fumadocs + Next.js** pipeline at the runtime `book`/`doc` API
via **per-host ISR** (incremental static regeneration): the spine maps directly
onto Fumadocs' tree, and canonical / OG / sitemap / hreflang come for free from
Next. This is materially less work than greenfield SSR and is the honest cost
of anonymous docs — significant, but reuse, not new infrastructure.

**Security guardrail — anonymous renders inert prose only.** An anonymously
served doc renders Markdown content and nothing live. Any "live metadata"
embed — semantic links (`object://crm_lead`, §3.3), inline metadata views /
field dictionaries / derived content (§3.5) — **must not resolve for an
anonymous request**; it degrades to a hidden/"sign in to view" placeholder.
Docs carry no data, so prose itself is safe to expose; the only leak vector is
live-metadata resolution, and closing it for anonymous requests is the one hard
rule. Phasing: `audience` + the library portal's anonymous path land in
**P3b/P3c**; until then all docs remain gated as
§3.6 specifies — anonymous access is purely additive.
