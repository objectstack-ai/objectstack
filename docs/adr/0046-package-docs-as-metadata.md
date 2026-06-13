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
