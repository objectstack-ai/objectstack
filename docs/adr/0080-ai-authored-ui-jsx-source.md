# ADR-0080: AI-authored UI pages — JSX source compiled to the SDUI tree (parse ≠ execute); the component registry is the contract; capability ≠ contract

**Status**: Proposed (2026-06-29) — partially implemented (2026-07-16 audit): `sdui-parser` package (parse≠execute) + codegen + `tier:'public'` flag + page-kind schema + parse-level lint shipped; the save-time authoritative compile→store(`compiledTree`) pipeline and registry-manifest prop/binding validation are NOT wired (the parser is consumed only by `@objectstack/lint`).
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (AI writes metadata via draft-gated `saveMetaItem`), [ADR-0038](./0038-build-verification-loop.md) (agent builds → verifies → self-corrects), [ADR-0046](./0046-package-docs-as-metadata.md) (generated, not hand-maintained, surfaces), [ADR-0048](./0048-cross-package-metadata-collision.md) (package id is the addressing unit; `requires`), [ADR-0058](./0058-expression-and-predicate-surface.md) (one expression language, two backends), [ADR-0063](./0063-two-kernel-agents-skills-are-the-extension-primitive.md) (build agent owns metadata authoring), [ADR-0064](./0064-tool-scoping-to-agent.md) (tool scope by surface), [ADR-0065](./0065-sdui-styling-model.md) (scoped styles — the conflict-free styling channel), [ADR-0067](./0067-commit-history-and-rollback-for-ai-authoring.md) (versioned AI-authored metadata), [ADR-0077](./0077-authoring-surface-boundary-hook-flow-validation.md) (route by intent; verifiability tier = friction tier; loud-not-silent; code is the flagged escape hatch), [ADR-0078](./0078-no-silently-inert-metadata.md) (the completeness gate — valid-but-inert fails loudly)
**Consumers**: `@objectstack/spec` (`packages/spec/src/ui/page.zod.ts` — gains a JSX-source page kind + the tree *envelope*; **does not** gain per-component prop schemas), `@objectstack/cli` (`os build` / `os validate` — the save-time parse + validate gate), a **new shared `@objectstack/sdui-parser`** (isomorphic JSX-text → SchemaNode-tree compiler, run server-side authoritative and client-side for preview), `../objectui` `@object-ui/core` (the `ComponentRegistry` `inputs` become the authoritative contract; `getAllConfigs()` is serialized to a manifest) and `@object-ui/react` (`SchemaRenderer` renders the compiled tree, unchanged), the `objectstack-ui` skill (the routing + the curated public block list the build agent composes from)

**Premise**: the current SDUI page metadata is a fixed-shape, slotted schema. To let AI customize pages with real layout freedom we need a richer authoring surface — but the three obvious richer surfaces each fail a hard constraint, and the failure modes are exactly the ones ADR-0077/0078 warn about (ambiguous surface + silent wrongness). This ADR pins the surface, the contract, and where compilation runs, **before** the AI authors a large body of pages against an ambiguous one. It adds almost no runtime to the renderer: it adds a *source format* and a *compiler in front of the existing pipeline*.

> **Trigger**: a design review of "the page metadata can't express AI-flexible layouts; HTML can't reach our component library; React needs a build/deploy and is unsafe to execute." The investigation found that the renderer is **already** a recursive tree interpreter over a registered component set (`@object-ui/react` `SchemaRenderer` → `ComponentRegistry.get(type)` → `React.createElement`, children recurse), and that the registry **already declares component props** at registration (`ComponentInput` in `packages/core/src/registry/Registry.ts:13`). So the missing piece is not the runtime — it is the *authoring format* (AI is fluent in JSX/Tailwind, not in hand-written JSON trees) and the *contract projection* that makes AI output checkable. The wrong fix — store the JSON tree as the thing AI edits, or lift every component's props into the framework Zod spec — was considered and rejected (see Decision §3, §5).

---

> **Amendment (2026-06-30 — ADR-0065 styling correction).** The "HTML + **Tailwind**" framing for page `source` is **superseded on styling**. A page's `source` is *runtime metadata*, so the console's build-time Tailwind never scans it — authored utility `className`s silently produce no CSS (the exact failure ADR-0065 was written to prevent; the Task Desk modal's `bg-black/50` backdrop rendered transparent). The tiers themselves stand; only the styling **primitive** changes: `kind:'html'` styles via the registered components' structured props + a JSON `style` object; `kind:'react'` styles via inline `style={{}}` with `hsl(var(--token))` theme colors and renders drawer/modal overlays through `<ObjectForm formType="drawer"|"modal">` (never a hand-rolled `fixed inset-0`). **Do not author Tailwind classes in page source.** See [ADR-0065](./0065-sdui-styling-model.md).

## TL;DR

1. **[model] AI authors a constrained *JSX text*, not a JSON tree.** The JSON `SchemaNode` tree is a fine *compile target* and a terrible *edit surface* — verbose, out-of-distribution for the model, noisy to diff, and it loses manual tweaks on every regeneration. AI reads/edits JSX+Tailwind (its strength); the tree is **derived**, never hand-edited. (This is how v0/Markdoc/MDX keep source = code, output = compiled.)
2. **[ruled] parse ≠ execute (the Markdoc model).** The JSX text is **parsed** to an AST and **interpreted** by mapping tags to registered components — no JS is ever run. This is categorically different from real React (`import`/bundle/eval): it keeps multi-tenant-as-data, needs no build/deploy, and never executes untrusted code. A stored string that is *parsed* is still data; a stored module that is *executed* is not. Looks like React, is not React.
3. **[ruled] The component registry is the authoritative contract — do not duplicate it into the framework Zod spec.** `ComponentInput` already carries `name / type / required / enum / description / defaultValue / isContainer / slot`. That is enough to (a) codegen the JSX type surface (`.d.ts` → `JSX.IntrinsicElements`) and (b) validate AI output at the level that catches the real errors (unknown component, unknown/missing prop, wrong coarse type, illegal enum value). The framework spec owns only the **tree envelope** (page/region/children recursion) and **consumes** a serialized manifest of the registry — it must **not** re-declare per-component props. (`page.zod.ts:85` is today `properties: z.record(z.unknown())` — ungated, the same `z.record` escape as the flow-node-config debt; the fix is the registry manifest, not a parallel hand-authored Zod copy.)
4. **[model] capability ≠ contract.** All ~244 registered types remain a rendering *capability*. Only a **curated public tier (~35 blocks)** — shaped like Salesforce's App Builder standard components, object-centric, generated from a `tier:'public'` flag — is what gets type-checking, the api-surface ratchet, customer docs, and the AI vocabulary. Do not freeze 244 internal/admin/studio components into a versioned contract.
5. **[ruled] Authoritative parse + sanitize + validate + compile runs *server-side at save*; the client renders the *compiled tree*, not the JSX.** Sanitization cannot be client-trusted; binding-correctness needs server-only object schemas; the completeness gate (ADR-0078) and draft-gating (ADR-0033) are already server-side. Store `{ source, compiledTree, requires }` — **source is truth, tree is derived cache.** The client ships **no parser on the render path** (web/mobile render the same pre-validated tree); a client-side copy of the shared parser exists **only** for the live edit/preview loop and is re-validated server-side at save — it is never the trust boundary.
6. **[staging] Two coupled deliverables, neither blocking the other.** (a) *Complete the registry `inputs`* for the ~35 public blocks (closes existing designer-contract gaps too); (b) *add a JSX-source page kind* (additive — the existing tree page stays; designer round-trip to JSX is deferred). They meet through a codegen'd `.d.ts` (author-time type-check) and a serialized manifest (save-time validate). v1 ships with shallow inputs-validation; depth (nested shapes, binding-against-object-schema) is added incrementally on the public tier only.

---

## Context

### What the renderer already is (and already has)

The SDUI runtime is **not** the thing that needs to change:

| Capability | Where it already lives |
|---|---|
| Recursive tree interpreter (`type` → component, children recurse) | `@object-ui/react` `SchemaRenderer` → `ComponentRegistry.get()` → `React.createElement` |
| Recursive node schema (`{ type, props, children }`, `className`/`style`, `visibleOn`) | `@object-ui/types` `BaseSchema` / discriminated `LayoutSchema` (`packages/types/src/layout.ts:639`, literal `type` discriminants) |
| Per-component prop declaration | `ComponentInput[]` on `register()` (`packages/core/src/registry/Registry.ts:13`) |
| Conflict-free styling channels | typed primitive props → safelisted class map (`ResponsiveGrid.tsx`), and **scoped per-node CSS** (ADR-0065, `packages/core/src/styling/scoped-styles.ts`) |
| Enumerable catalog across ~40 plugins | `ComponentRegistry.getAllConfigs()` / `getAllTypes()` |
| An HTML escape hatch (today unsafe) | `renderers/basic/html.tsx` — raw `dangerouslySetInnerHTML`, no sanitize |

The gap is the **authoring format** and the **contract projection**, not the renderer.

### The three richer surfaces, and why each fails alone

| Surface | Fails because |
|---|---|
| **Extend the slotted page schema** | more fixed slots; AI's freedom is bounded by the schema shape — never enough |
| **Raw HTML + Tailwind** | loses the design system, data binding, a11y, theming, i18n; XSS surface; **cannot compose registered controls**; and arbitrary runtime Tailwind classes are purged at build time → silent no-style (ADR-0065 territory) |
| **Real React/JSX (import + bundle/eval)** | needs a per-page build+deploy (per-tenant builds), or runtime `eval` of untrusted JS in the host context (XSS-equivalent, host-global access, version skew). Sandboxing it = iframe = the Tier-C escape hatch, not the default |

The synthesis: **AI authors the format it is strongest in (JSX+Tailwind), but it is *parsed*, not *executed*, and lands in the existing tree** — keeping every property the React-source path would forfeit.

### Why the JSON tree is the wrong *edit* surface (even though it is the right *render* target)

Handing the model a verbose `{type,props,children}` tree to iteratively edit forces read-whole-tree / locate-node / rewrite-whole-tree: it burns tokens, regenerates (losing manual tweaks), and reasons spatially in an unnatural form. v0/Lovable keep **code** as the source-of-truth for exactly this reason. Source = JSX text; tree = compiled.

### Why under AI authoring the contract must be *loud and projectable* (ADR-0077/0078 lineage)

AI rarely emits non-compiling output; it emits output that is **subtly wrong** — a prop that does not exist, an `objectName` that is not a real object, a node that is structurally valid but **inert** (ADR-0078). The defenses are the same three ADR-0077 names: shrink the expressible-but-wrong space (curated tier, §4), make every real constraint loud at author time (codegen'd type-check + the completeness gate, §6), and prefer machine-checkable intent (registry-typed props, §3). A pile of AI-written raw HTML is unanalyzable; a tree of contract-typed nodes is queryable, diffable, gateable.

---

## Decision

### 1. AI authors JSX text; the tree is derived

The page's source-of-truth is a constrained JSX/HTML+Tailwind **text** field. The `SchemaNode` tree is the compiler output, not persisted as the editable artifact. `<flex gap={4}><object-table object="account"/></flex>` ⇒ `{type:'flex',gap:4,children:[{type:'object-table',object:'account'}]}` — tag → `type`, attrs → props, nesting → `children`.

### 2. parse ≠ execute — the safety model

| Same input syntax | React source | This ADR (JSX-source page) |
|---|---|---|
| How it is consumed | `import` / bundle / `eval` → **runs JS** | `parse` → AST → walk → map tags to registry → **runs no JS** |
| Trust | untrusted code in host context | sanitized data; whitelist = registry `type` set |
| Build/deploy | required | none |
| Multi-tenant | per-tenant build artifact | per-tenant **data** row |

The parser whitelists tags to the registry type set; strips `<script>`, `dangerouslySetInnerHTML`, event handlers (except bound named actions), and arbitrary JS expressions (expressions stay in the constrained language — ADR-0058 CEL — typed but not executed). This **replaces** today's unsafe `html.tsx` escape hatch with a sanitizing, component-aware interpreter.

### 3. The registry is the contract — the spec owns only the envelope

- **`ComponentInput` is the authoritative per-component contract.** Serialize `getAllConfigs()` (the public tier) to a static **manifest** at build. From it: codegen `.d.ts`/`JSX.IntrinsicElements` (author-time type-check) and feed the save-time validator.
- **Do not lift per-component props into `@objectstack/spec`.** A parallel hand-authored Zod copy is a second source of truth that will drift (the same class of debt as the `${}`-vs-CEL split and the `z.record` flow-node-config escape). `page.zod.ts` changes from `properties: z.record(z.unknown())` to: own the **tree envelope** (recursion, region rules, the JSX-source field) and **reference** the manifest for prop validation.
- **The object-binding check lives framework-side regardless** — only the framework knows whether `object="account"`/`field="revenue"` resolve. This is the highest-value check and is inherently server-side.

For **core** components with literal-discriminant schemas (`LayoutSchema`, `layout.ts:639`), the `JSX.IntrinsicElements` table can be **derived by a TS mapped type** with zero codegen (`{ [S in Concrete as S['type']]: Omit<S,'type'> }`); **exclude `BaseSchema`** (its `type: string` would emit an index signature that makes every tag valid). Plugin components codegen into the **same** intrinsic surface from the manifest. Tag name === `type` discriminant === registry key.

### 4. capability ≠ contract — the curated public tier

Only the curated set is contract-bearing (type-checked, ratcheted, documented, AI vocabulary). Shape = Salesforce App Builder standard components (small, object-centric). The list is **generated from a `tier:'public'` flag** on registration — not frozen in this ADR (ADR-0046).

| Tier | ~count | Examples (registry `type`) |
|---|---|---|
| **A — object-aware blocks** (the contract core; deep validation + binding-check + ratchet focus here) | ~16 | `object-grid`/`list-view`, `object-form`, `record:details`/`highlights`/`related_list`/`path`/`line_items`, `object-kanban`/`calendar`/`gantt`/`timeline`/`map`, `object-metric`, `object-chart`, `dashboard`/`object-pivot` |
| **B — layout/content primitives** | ~16 | `flex`,`grid`,`stack`,`card`,`tabs`,`accordion`,`section`,`page:header` + `text`,`heading`,`image`,`icon`,`markdown`,`divider`,`badge`,`alert`,`button` |
| **C — escape hatch** (flagged, second-class — the ADR-0077 "code is the escape hatch" idiom) | ~3 | sanitized rich-text, custom component, embedded flow |

Curation rules: **collapse variant families** (one `Chart` block + `chartType` enum, not 14 sibling chart blocks); **drop unused/inert catalog types** from the public tier (`tree`, `modal` form, `gauge`/`bullet`, `kpi`); the platform's **differentiators over Salesforce** (native Kanban/Gantt/Calendar/Map/Metric/Pivot) sit in Tier A as first-class.

### 5. Where compilation runs

| Operation | Location | Why |
|---|---|---|
| Authoritative parse + sanitize + prop-validate + completeness + binding-check + compile | **server, at save** (`os build`/save gate) | sanitization can't be client-trusted; binding needs server-only object schemas; gate + draft are already server-side; parse once not per-load |
| Author-time type-check (`.d.ts`/tsc over generated decls) | **server / build-agent loop** (ADR-0063/0064) | browser can't run tsc over the manifest efficiently; the loop is server-side |
| Render | **client**, of the **compiled tree** | no parser on the render path; web/mobile render the same pre-validated tree |
| Live edit preview | **client**, shared `@objectstack/sdui-parser` | UX convenience; **re-validated server-side at save** — not the trust boundary |

Stored shape: `{ source: "<jsx>", compiledTree: {…}, requires: ["plugin-grid", …] }`. **Source wins; tree is a derived cache** (recompile on mismatch; may invalidate by source hash). `requires` is inferred at parse and validated at save **and** load (plugin presence — ADR-0048 package provenance).

### 6. The two coupled deliverables

1. **Complete the registry `inputs`** for the ~35 public blocks: ① fill coverage (closes existing designer-contract gaps); ② for Tier A, enrich `object`/`array` inputs with item/field shape; ③ mark binding inputs (`objectName`/`field`) so the server binding-check knows what to resolve. One contract feeds three consumers: designer property panel, AI `.d.ts`/vocabulary, save-time validation.
2. **Add a JSX-source page kind** (additive to the tree page): source field + the `@objectstack/sdui-parser` pipeline (parse → whitelist → prop-validate → completeness → `requires`) → existing `SchemaNode` tree → existing `SchemaRenderer`.

Coupling: completed `inputs` → codegen `.d.ts` (author-time) **and** serialized manifest (save-time). Neither blocks the other; v1 = JSX page kind on **shallow** inputs-validation, depth added incrementally on the public tier.

---

## Non-goals

- **Do not store the JSON tree as the AI-edited artifact** (§1) — source is JSX text.
- **Do not allow real `import` / module resolution / bundling / `eval`** (§2). If import ergonomics are wanted later, only a **virtual, sealed** specifier resolved against the registry — never the filesystem/npm.
- **Do not re-declare component props in `@objectstack/spec`** (§3) — the registry manifest is the single source.
- **Do not promote all ~244 types into the contract / AI vocabulary** (§4).
- **Do not parse-and-sanitize only on the client** (§5) — the client parser is preview-only.
- **Do not block the JSX page kind on 100% `inputs` completion or on designer↔JSX round-trip** (§6) — both are deferred/incremental.

## Staging

- **Now (v1):** the shared parser (parse → whitelist → tree → render) proven end-to-end on 3 blocks (`object-grid`/`flex`/`object-form`); codegen `.d.ts` from `getAllConfigs()`; JSX-source page kind with shallow save-validation; `tier:'public'` flag + generated block list.
- **Next:** complete Tier A `inputs` + enrich depth; server binding-against-object-schema check; completeness-gate (ADR-0078) extension to UI nodes; api-surface ratchet on the public tier.
- **Deferred, gated on proven need (ADR-0077 idiom):** designer↔JSX round-trip; virtual sealed imports; the Tier-C custom-component sandbox (iframe + bridge).

## Consequences & risks

- **Two parsers, one grammar.** Server (authoritative) and client (preview) must agree → one isomorphic package; the client never decides trust.
- **`inputs` were built for the designer**, so some are incomplete (the known renderer-registry gaps). Relying on them for validation forces an audit — but that audit is independently valuable (better designer) and lands on one shared contract.
- **JSX children typing is weak** in TS (it special-cases `children`). Container/child legality (e.g. "only columns nest in a table") is enforced **structurally by the parser + manifest**, not by TS children types.
- **The `.d.ts`/`JSX.IntrinsicElements` augmentation is a type-checking fiction** — no real React intrinsic named `flex` runs; the interpreter fulfills it via the registry. The temptation it invites ("it type-checks like JSX, so just let React render it") is exactly what §2 forbids.
- **Per-deployment variability**: the valid block set is per-installed-plugins; the manifest and `requires` validation are deployment-scoped (a page referencing an absent plugin's block fails the gate, not the render — loud-not-silent).

## Open questions

1. Collapse the object collection-views into one `object-view` + `viewType` enum, or keep `object-kanban`/`object-calendar`/… as distinct named blocks (better AI recall vs. smaller vocabulary)?
2. Converge objectui's `${}` evaluator onto the framework CEL (ADR-0058) for the JSX-source expression layer — required for typed expressions, or deferred?
3. `compiledTree` persisted at save, or compiled lazily on read with a source-hash cache?
