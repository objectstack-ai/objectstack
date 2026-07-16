# ADR-0051: Inline metadata views in docs — the ` ```metadata ` fenced block

**Status**: Proposed (2026-06-16) — P1 authoring surface implemented (2026-07-16 audit): `ElementMetadataViewerPropsSchema` + `element:metadata_viewer` component entry + publish lint with reference-liveness checks (`cli/utils/collect-docs.ts lintMetadataEmbeds`); the console SDUI fence-lift and the state_machine/flow/permission renderers are NOT implemented — no runtime rendering of the embed yet.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0046](./0046-package-docs-as-metadata.md) (`doc`/`book` as metadata — §3.4 syntax boundary, §3.5 *derived content is rendered, never written*, §6.7 anonymous live-embed guardrail), [ADR-0020](./0020-state-machine-converge-and-enforce.md) (a record state machine is a `state_machine` validation rule on an object, not a standalone type), [ADR-0047](./0047-object-ui-run-modes.md) (ObjectUI is the server-driven UI runtime), [ADR-0048](./0048-cross-package-metadata-collision.md) (package-scoped single-item resolution), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove posture for governed properties), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (AI as primary author)
**Consumers**: `@objectstack/spec` (`DocSchema` unchanged; new `element:metadata_viewer` entry in `ComponentPropsMap`; the fenced-block body schema), `@objectstack/cli` (publish lint: parse + validate body + reference-liveness), `@objectstack/console` (the SDUI doc renderer lifts ` ```metadata ` fences into the component), `apps/docs` portal (anonymous degradation per ADR-0046 §6.7), `@objectstack/core` (kernel **unchanged** — `doc` stays inert)
**Pilot**: `os-tianshun-mtc`

---

## TL;DR

ADR-0046 §3.5 already ruled that anything reconstructible from the manifest —
field dictionaries, option lists, validation conditions, **permission
matrices** — is a *metadata view the platform renders live*, never authored
prose, and §6.7 named the same thing "inline metadata views / live metadata
embed" when it wrote the anonymous guardrail. Neither specified how an author
**places** such a view inside a doc. This ADR specifies exactly that, and
nothing more:

- **One syntax: a ` ```metadata ` fenced code block.** Its body is a small,
  declarative reference — *which* metadata to render and *how* — not code:

  ````md
  ```metadata
  type: state_machine
  object: order
  name: order_lifecycle
  mode: diagram
  detail: business
  ```
  ````

- **It compiles to one SDUI component, `element:metadata_viewer`** — a new,
  read-only, `embeddableInDoc` entry in `ComponentPropsMap`. The doc renderer
  is an ObjectUI surface; a metadata embed is an ObjectUI node like any other.
  **One runtime, one schema, one permission path** — never a parallel renderer.
- **The block is data, not code** — a reference the *platform's own* trusted
  component resolves. That is what keeps it on the safe side of the ADR-0025
  trust boundary that §3.4 drew to ban MDX; this ADR does **not** reopen that
  ban.
- **Live transclusion**: the view is rendered from *current* metadata at read
  time. Change the flow, the doc's diagram changes. A copy can go stale; a
  reference cannot — that is the entire reason to build this rather than tell
  authors to paste a screenshot.
- **Scope is metadata-only, and phased**: `state_machine` first, `flow` second,
  `permission` last (it gates on render-time projection). `object` is deferred
  (§5). A general "embed any ObjectUI component" fence (` ```objectui `) is an
  explicit non-goal here, kept as a future escape hatch (§4).

The kernel is untouched: `doc.content` stays an inert Markdown string (ADR-0046
§3.1). Resolution is a **render-time** concern, invisible to the load path.

## 1. Context

- **The reader is the deciding variable, not the metadata.** A `flow` is "open
  the Studio designer" for a developer and "read the doc" for a business user,
  auditor, or PM who has no Studio and never will. Documentation earns its place
  only for the reader who cannot get the answer by *using the running system*:
  before they have access, before a feature ships, to see the *why*, or to see a
  cross-cutting whole that **no single live screen presents** (the full legal
  transition space of a record, every role's access to an object). Live,
  interactive artifacts a reader *can* reach — a `dashboard`, a `report`, a list
  `view` — are best experienced in the system; docs should **deep-link** to
  those, never embed a frozen copy. That deep-link case is out of scope here.
- **What is left needs a synthesized, read-only view that the live UI never
  shows as one picture**: a state machine's whole transition graph, a flow's
  process shape and approval policy, an object's permission matrix. ADR-0046
  §3.5 already classified these as *rendered, never written*, and §6.7 reserved
  "inline metadata views" in its security guardrail. The concept is blessed; the
  **syntax and resolution mechanism are unspecified**. This ADR supplies them.
- **The frontend is server-driven UI (ADR-0047).** ObjectUI renders a
  component tree (`ComponentPropsMap`, `record:*` / `element:* `/ `ai:*`) from
  metadata. A metadata embed must therefore be an **ObjectUI component**, not a
  Markdown-only side-channel — otherwise we build a second rendering path that
  ObjectUI's evolution can never extend. Conversely, the doc must stay portable
  inert Markdown (ADR-0046's whole thesis): the seam between portable prose and
  a live view is the one thing this ADR designs.
- **AI writes most docs (ADR-0033).** The authored surface must be flat, fixed,
  and lintable so an LLM author cannot subtly corrupt it, and so a typo on a
  metadata name is caught the same way field-ref typos already are.

## 2. Goals & Non-goals

### Goals

- A single authored syntax — the ` ```metadata ` fence — with a typed,
  lintable body schema.
- A new read-only SDUI component, `element:metadata_viewer`, that the fence
  compiles to; the doc renderer reuses the ObjectUI runtime to render it.
- Render-time semantics: live transclusion, package-scoped resolution
  (ADR-0048), two distinct projections (authoring *detail* vs automatic
  *permission*), and graceful degradation (anonymous, missing-ref).
- Publish lint: parse fences, validate bodies, and check that every referenced
  metadata item is live (the enforce-or-remove posture of ADR-0049).

### Non-goals

- **A general component-embed fence (` ```objectui `).** Embedding *arbitrary*
  ObjectUI nodes (charts, AI panels, interactive forms) is deferred to a later
  escape hatch (§4). v1 embeds *metadata views only*.
- **Deep-linking to live surfaces** (`dashboard` / `report` / `view`). Those
  are reached in the system; a plain Markdown link suffices. Out of scope.
- **The inline `object://` semantic link** (ADR-0046 §3.3) stays the *inline*
  form ("mention"); the ` ```metadata ` fence is the *block* form ("embed").
  Both are the same intent at different altitudes; the inline form remains
  deferred and only required to parse.
- **Any kernel change.** `doc` stays inert (ADR-0046 §3.1); `content` is never
  parsed on the load path.

### Explicitly deferred

`object` embeds (wrong altitude for their reader — a hand-authored conceptual
model beats an auto-rendered schema that dumps every system field; §5); the
` ```objectui ` general fence; cross-package metadata embeds beyond the
dependency set ADR-0046 §3.3 already resolves; an `object://` inline preview.

## 3. Design

### 3.1 The syntax — a fenced code block, body is a declarative reference

A ` ```metadata ` fenced block names *what* to render and *how*. The body is
parsed as YAML and validated against the schema below (illustrative; exact field
names settle in the spec PR):

```ts
// The fence body. Compiles 1:1 to element:metadata_viewer props (§3.2).
const MetadataEmbedSchema = z.object({
  type:   z.enum(['state_machine', 'flow', 'permission']), // 'object' deferred (§5)
  name:   z.string(),                  // target item; resolved package-scoped (ADR-0048)
  object: z.string().optional(),       // REQUIRED for object-scoped kinds
                                       //   (state_machine is a validation rule ON an object — ADR-0020;
                                       //    permission renders a matrix FOR an object)
  mode:   z.enum(['diagram', 'matrix', 'summary']).optional(), // default per type
  detail: z.enum(['business', 'technical']).optional().default('business'), // authoring projection (§3.5)
});
```

Choosing a **fenced code block** over directives/MDX/shortcodes is deliberate:

- It is **already valid CommonMark + GFM** — the exact grammar ADR-0046 §3.4
  permits. We adopt a primitive that was always legal; we do **not** relax the
  "no MDX / no directives / no shortcodes" boundary.
- It **degrades to meaningful text**: a renderer that does not know `metadata`
  shows a code block reading `type: state_machine / name: order_lifecycle` — a
  human still learns "a state-machine view named order_lifecycle belongs here,"
  unlike a broken `<Component/>` or a stray `:::`.
- It is **block-level by nature** (these are block diagrams) and **trivially
  lintable** (scan fences whose info string is `metadata`, validate one object).
- It is the industry-blessed convention for embedded views (Mermaid, PlantUML,
  math) — not a bespoke dialect.

The info string is the bare token `metadata`. The doc renderer owns its
interpretation, so the genericity of the word carries no cross-tool collision
risk inside ObjectStack; should cross-tool rendering ever matter, namespacing to
`os:metadata` is a non-breaking later move.

### 3.2 It compiles to one SDUI component — one runtime, never a parallel path

The fence is **sugar over a single ObjectUI node**. The doc renderer lifts each
` ```metadata ` block into:

```ts
// packages/spec/src/ui/component.zod.ts — new ComponentPropsMap entry
'element:metadata_viewer': MetadataEmbedSchema,  // read-only; embeddableInDoc: true
```

`element:metadata_viewer` resolves `type` + `name` (+ `object`) against the live
metadata registry and dispatches to the registered viewer for that type — the
existing `MetadataViewerContribution` mechanism (preview mode) in
`packages/spec/src/studio/plugin.zod.ts`. `flow` reuses the read-only render
descriptors already specified in `packages/spec/src/studio/flow-builder.zod.ts`;
`state_machine` renders the transition graph of the rule in
`packages/spec/src/automation/state-machine.zod.ts`; `permission` renders an
object's matrix from `packages/spec/src/security/permission.zod.ts`.

This is the load-bearing decision: **rendering a doc is rendering an ObjectUI
page** that is mostly `element:markdown` prose with metadata-viewer islands.
There is one component model, one props schema, one render-time permission path
— the same one pages use. The earlier rejected `osembed`-with-bespoke-YAML
design (§4) failed precisely by introducing a second schema and renderer; this
does not, because the body *is* a component's props.

> **Why a narrow `metadata` fence and not the general `objectui` fence —
> trust boundary.** ADR-0046 §3.4 banned MDX because "MDX is code, and rendering
> publisher-supplied code crosses the ADR-0025 trust boundary; Markdown is
> data." A ` ```metadata ` body is **pure declarative data**: a reference plus
> two enums, no expressions, no actions, sanitizable. The view it produces is
> drawn by the *platform's own trusted component*, from the *package's own
> already-governed metadata* — the publisher supplies a reference, the platform
> supplies the renderer. A general ` ```objectui ` body, by contrast, could
> carry CEL expressions and action bindings (`element:form.onSubmit`,
> `element:button`) — i.e. code — and would reopen the boundary §3.4 closed.
> The metadata-only scope is therefore not just smaller; it is the form that
> stays on the *data* side of the line.

### 3.3 Live transclusion — a reference, never a copy

The view is rendered from **current** metadata every time the doc is read. This
is the whole justification for the feature: a pasted screenshot or hand-drawn
diagram rots the moment the flow changes; a reference is always correct. Three
properties follow and are mandatory — drop any one and the embed degrades into a
stale, wrong-altitude copy of the Studio designer (the failure ADR-0046 §3.5
forbids):

1. **Live-derived** — resolved at render time, never materialized into
   `content`.
2. **Projected** — to the authored *detail* and the reader's *permissions*
   (§3.5).
3. **Narrative-owned** — the human writes the *why*; the system fills the
   *what*. The author places a reference, not a rendering.

Resolution is **package-scoped** (ADR-0048): `name` resolves within the doc's
own package, then its dependencies (the same set ADR-0046 §3.3 resolves
cross-package doc links against). A reference to a metadata item the reader's
grant does not cover, or that does not exist, **degrades to a placeholder** — it
never blocks render (mirroring §3.3's broken-link posture).

### 3.4 Two projections — keep them separate

| projection | when | who controls | what it does |
|:--|:--|:--|:--|
| **detail** | authoring | the author (`detail:` field) | altitude: `business` collapses technical flow nodes (HTTP, script, error boundaries) to the business-meaningful steps + approvals; `technical` shows the full graph |
| **permission** | render time | **the platform, automatically, per reader** | strips what the reader may not see (a fraud-check branch, a permission row for a role they cannot view) before drawing |

These are orthogonal and must not be conflated. `detail` is an authored
intent; **permission projection is an automatic security behavior**, never
author-controlled. Note the name: this is *not* `book.audience` (ADR-0046 §6.7),
which is an *access tier* on the publication unit. To avoid that collision the
authoring knob is `detail`, not `audience`.

### 3.5 Security — inherits the §6.7 guardrail, adds nothing the kernel must parse

- **Anonymous degradation is inherited verbatim.** ADR-0046 §6.7 already
  mandates that any live-metadata embed "must not resolve for an anonymous
  request; it degrades to a hidden / 'sign in to view' placeholder." A
  ` ```metadata ` block is exactly such an embed. In the authenticated console
  (ObjectUI runtime present) it resolves, live and permission-projected; in the
  anonymous `apps/docs` portal it degrades. No new rule — the same rule, now
  with a concrete syntax to govern.
- **Permission projection is enforced at the resolver, not the UI.** Like
  §6.7's gating, the metadata-viewer resolver applies the reader's permissions
  server-side; a client that strips chrome must not be able to surface a hidden
  branch or row.
- **The kernel stays inert (ADR-0046 §3.1).** `content` is never parsed on the
  load path; the fence is a render-time concern only. `doc` remains
  `supportsOverlay: false`.

### 3.6 Publish lint — parse, validate, check liveness

`os build` / publish lint (the same pass that already enforces §3.4's bans and
§3.3's link resolution) gains one check on `doc.content`:

1. Extract every fence whose info string is `metadata`; parse the body.
2. Validate it against `MetadataEmbedSchema`; a malformed body **fails publish**
   (it is authored structure, not prose). A `type` typo yields a did-you-mean
   against the enum — the same affordance flow-condition field typos already get.
3. Resolve `type` + `name` (+ `object`) against the package and its
   dependencies; an embed pointing at a **dead or renamed** metadata item is
   reported. This rides the existing reference-validation / liveness machinery
   and follows ADR-0049's enforce-or-remove posture: a doc that references a
   non-live item is a broken reference, surfaced at publish, degraded (not
   crashed) at render.

## 4. Alternatives considered

| Alternative | Verdict |
|:--|:--|
| **` ```objectui ` general component fence now** (body = any `{type, props}` node) | Rejected *for v1*, kept as a future escape hatch. A general body can carry expressions and action bindings — code — reopening the §3.4 trust boundary. The `metadata` fence stays on the data side. When arbitrary embeds are genuinely needed, add ` ```objectui ` as a power-user form that **shares this runtime** (`metadata` is sugar over `element:metadata_viewer`; `objectui` is the full node) — narrow-sugar + general-form, one renderer, not two systems. |
| **` ```osembed ` with a bespoke YAML schema** (an earlier turn) | Rejected. A body unrelated to the component model spawns a second schema, a second validation path, a second renderer dispatch — the parallel-system smell. Binding the body to `ComponentPropsMap` (§3.2) avoids it entirely. |
| **MDX / JSX components** | Banned by ADR-0046 §3.4 (code across the ADR-0025 trust boundary); couples docs to React; destroys "content is inert data." |
| **remark-directive (` :::metadata{...} `)** | Semantically the cleanest ("typed block with attributes"), but it *is* a directive — the thing §3.4 bans — and needs a new parser. The fenced block buys the same capability with zero boundary change and cleaner degradation. Correct elsewhere; wrong in this repo. |
| **Obsidian transclusion (`![[name]]`)** | Not CommonMark; no room for `type` / `mode` / `detail`; overloads image syntax. |
| **HTML-comment sentinels (`<!-- embed:... -->`)** | Valid CommonMark but no first-class fields, easy to mistype, semantics invisible — a hack. |
| **A pasted screenshot / hand-drawn diagram** | Rots on the next metadata change (ADR-0046 §3.5). Live transclusion exists precisely to kill this. |

## 5. Phasing

Ordered by value ÷ (risk + staleness). Each phase is independently shippable.

| Phase | Scope | Depends on |
|:--|:--|:--|
| **P1 — `state_machine`** | the ` ```metadata ` fence grammar; `MetadataEmbedSchema`; `element:metadata_viewer` (state-machine renderer over ADR-0020 rules); publish lint (parse + validate + liveness); console lift + render | this ADR |
| **P2 — `flow`** | `flow` kind via the read-only flow-builder descriptors; the `detail: business` altitude projection (collapse technical nodes) — the projection is *mandatory* here, or the embed is a worse Studio | P1 |
| **P3 — `permission`** | `permission` matrix kind; **render-time permission projection** per reader; verified against the §6.7 anonymous guardrail | P2, and a permission-projecting resolver |
| **Deferred** | `object` (wrong altitude — prefer a hand-authored conceptual model); ` ```objectui ` general fence; `object://` inline preview | — |

`state_machine` leads because its graph is small, naturally at business altitude
(states *are* business states), and low-sensitivity — the cleanest proof that
"edit the metadata, the doc's diagram follows." `permission` trails because it is
the highest-value-to-auditors **and** highest-risk kind: it ships only once the
render-time projection and the §6.7 gate are both in place.
