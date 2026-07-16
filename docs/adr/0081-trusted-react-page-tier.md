# ADR-0081: A trusted `kind:'react'` page tier — real React executed in the main tree, gated by a host capability; and renaming `kind:'jsx'` → `kind:'html'`

**Status**: Accepted (2026-06-30) — framework scope implemented (`html`/`react` page kinds + `jsx` alias, lint split `validate-jsx-pages`/`validate-react-pages`, `OS_PAGE_REACT=off` server toggle); the `@object-ui/react-runtime` executor + `CAP_REACT_PAGES` gate live in objectui.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0080](./0080-ai-authored-ui-jsx-source.md) (AI authors a *constrained* JSX text, parsed-never-executed, into the SDUI tree; the component registry is the contract; capability ≠ contract), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (AI writes metadata via draft-gated `saveMetaItem` — the human-review boundary), [ADR-0077](./0077-authoring-surface-boundary-hook-flow-validation.md) (route by intent; verifiability tier = friction tier; **code is the flagged escape hatch**), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently-inert metadata).
**Consumers**: `@objectstack/spec` (`packages/spec/src/ui/page.zod.ts` — `kind` gains `'html'` and `'react'`; `'jsx'` kept as a deprecated alias), `@objectstack/lint` (`validate-jsx-pages` — lints `html`/`jsx`, **skips** `react`), `../objectui` `@object-ui/react-runtime` (**new** — the trusted runtime-React executor) + `@object-ui/core` (the host capability gate) + `@object-ui/components` (PageRenderer routing + the full HTML tag set).

**Premise**: ADR-0080 shipped `kind:'jsx'` — a *constrained* JSX dialect parsed (never executed) into the SDUI tree. In practice that name oversold it: authors expected "JSX" to mean *any* HTML and *any* JavaScript (`useState`, `.map`, `onClick`), and the constrained, no-execution model categorically cannot do that. Two distinct things were conflated under one name. This ADR splits them: it makes the safe constrained tier **live up to a narrower, honest name (`html`)**, and adds a separate, explicitly-trusted **`react`** tier for the full-power case — available only where the operator accepts running author code.

> **Trigger**: testing the merged `kind:'jsx'` feature, the author found it "名不副实" (misnamed) — basic HTML tags didn't render and scripts were impossible — and recognized that the real-React capability belongs behind a switch. The platform trusts its (reviewed, draft-gated) page authors, so that switch defaults ON; a deployment that does not trust its authors turns it off server-side. "Running author code in the main React app" is an accepted, default trust decision, reversible per deployment — not an enterprise-only feature.

---

> **Amendment (2026-06-30 — ADR-0065 styling correction).** The "HTML + **Tailwind**" framing for page `source` is **superseded on styling**. A page's `source` is *runtime metadata*, so the console's build-time Tailwind never scans it — authored utility `className`s silently produce no CSS (the exact failure ADR-0065 was written to prevent; the Task Desk modal's `bg-black/50` backdrop rendered transparent). The tiers themselves stand; only the styling **primitive** changes: `kind:'html'` styles via the registered components' structured props + a JSON `style` object; `kind:'react'` styles via inline `style={{}}` with `hsl(var(--token))` theme colors and renders drawer/modal overlays through `<ObjectForm formType="drawer"|"modal">` (never a hand-rolled `fixed inset-0`). **Do not author Tailwind classes in page source.** See [ADR-0065](./0065-sdui-styling-model.md).

## TL;DR

1. **[rename] `kind:'jsx'` → `kind:'html'`.** The constrained, parse-never-execute tier (ADR-0080) is renamed to match what it is: author-written **HTML + Tailwind** (expressed as constrained JSX) compiled to the SDUI tree. `'jsx'` stays as a **deprecated alias** (already-saved pages keep loading); all authored examples/docs move to `'html'`.
2. **[capability] The `html` tier now resolves the full safe native HTML tag set.** Previously only `div/span/table/code/label` + semantic sectioning tags were registered, so `<h1>/<p>/<a>/<ul>/<li>/<img>/<blockquote>…` failed as `unknown-component`. They are now registered as passthrough renderers — the tier is finally honest about "HTML".
3. **[new tier] `kind:'react'` executes real React.** Its `source` is real JS/JSX (hooks, `.map`, event handlers, expressions), transpiled (Sucrase) and evaluated **in the main React tree — no sandbox** — by the new `@object-ui/react-runtime`. This is `parse = execute`: the categorical opposite of the `html` tier.
4. **[security = trust, not sandbox] `react` is gated by a host capability that defaults ON.** `CAP_REACT_PAGES` is controlled only by the *host*, never by authored metadata. It defaults ON because ObjectStack pages are authored by trusted authors and pass human review (draft-gating, ADR-0033). A deployment that does NOT trust its authors disables it **server-side** — the ObjectStack runtime injects the disable global when `OS_PAGE_REACT=off` (one env toggle, no rebuild). A sandbox (iframe/worker) is the tool for *untrusted* execution; we deliberately choose **trust + review** instead, which keeps the author's code a first-class citizen of the app (shared React tree, real components, real data). This is NOT an enterprise-only feature.
5. **[runtime] Vendored, not depended.** `@object-ui/react-runtime` inlines the ~150-LOC react-runner core (MIT) so we fully own the injected **scope/imports surface** (the actual capability ceiling) and can **lazy-load** it — the transpiler ships in a separate chunk fetched only when a `react` page renders *with the capability on*.
6. **[scope] Inject data blocks + React; leave layout to HTML.** The runtime scope exposes `React`, the curated **public data blocks** (`<ObjectTable>`, `<ObjectForm>`, charts, metrics — each a prop-driven wrapper over `SchemaRenderer`), a `<Block type=…/>` escape hatch, and the page `data`. Layout/structure is plain HTML + Tailwind (React's strength) — we do **not** bridge React children into schema-children renderers.
7. **[lint] `react` is not linted by the constrained parser.** `validate-jsx-pages` (ADR-0080's build gate) validates `html`/`jsx` only; running the constrained JSX parser over real React source would false-error on hooks and expressions. The `react` tier's safety boundary is the **capability + human review**, not a static gate.

---

## The three tiers

| | `kind:'html'` (was `jsx`) | `kind:'react'` (new) |
|---|---|---|
| Source | constrained JSX = HTML + Tailwind + registered components | real React/JSX: hooks, `.map`, `onClick`, expressions |
| Processing | **parsed**, never executed → SDUI tree | transpiled + **executed** in the main React tree |
| JavaScript | none (static literals) | full |
| Safety model | safe by construction (no execution) | **trust** (capability + review); no sandbox |
| Where it runs | OSS default ON | default ON; disable server-side via `OS_PAGE_REACT=off` |
| Author-time gate | `os build` constrained-parse lint | none (real JS); error boundary at render |
| Contract | registry `inputs` (ADR-0080) | injected scope = the ceiling |

The dividing line is exactly ADR-0080 §2's "parse ≠ execute". `html` keeps the property that *a stored string that is parsed is still data*; `react` deliberately crosses it, and pays for the crossing with an explicit operator opt-in.

---

## Decision

### 1. Rename, with a back-compat alias
`PageSchema.kind` becomes `enum(['full','slotted','html','react','jsx'])`. `'html'` is the canonical constrained tier; `'jsx'` is accepted as a silent **deprecated alias** so metadata saved during ADR-0080's window keeps rendering. The PageRenderer treats `html` and `jsx` identically; lint and the completeness gate (ADR-0078) treat both as source-required.

### 2. Make `html` honest
Register the safe native HTML flow/inline set (`h1–h6, p, a, ul/ol/li, dl/dt/dd, blockquote, pre, strong/em/b/i/u/small/mark/sub/sup, figure/figcaption, img, hr, br, time, address, …`) as passthrough renderers that forward standard attributes and recurse children. Excluded: anything already registered, and anything that can execute or escape (`script/style/iframe/object/embed/link/meta/form/input`, plus `button` which is the component). Defense-in-depth even though this tier never executes JS: strip `on*` handlers and `dangerouslySetInnerHTML`, neutralize `javascript:`/`data:` URLs on `<a href>`. Unknown attributes are warnings (the page still renders), per the ADR-0080 validator.

### 3. Add `react` behind a host capability that defaults ON
- **Gate**: `@object-ui/core` gains `enableCapability`/`disableCapability`/`isCapabilityEnabled` + `CAP_REACT_PAGES`. `react-pages` defaults ON. Host-only — it reads `globalThis.__OBJECTUI_CAPABILITIES_DISABLED__` (force off) and `__OBJECTUI_CAPABILITIES__` (force on); it is structurally impossible to flip from authored metadata.
- **Server opt-out**: the ObjectStack console serving (framework `cli/utils/console.ts`) injects the disable global into the served HTML when `OS_PAGE_REACT=off` — one env toggle, read per request, no rebuild. This is the single server-side switch a deployment uses to turn the tier off.
- **Renderer**: PageRenderer routes `kind:'react'` to a renderer that — when the capability is on — lazy-imports `@object-ui/react-runtime`, builds the scope, and renders via its error-boundaried `ReactRunner`. Capability off → a clear "React pages are disabled on this deployment" notice, not a crash.

### 4. Vendor the runtime; own the scope
`@object-ui/react-runtime` inlines react-runner: `transform` (Sucrase `jsx`+`typescript`+`imports`, production), `generateElement` (eval with injected scope; `createRequire` resolves `require()` only against an explicit `imports` map — a control point), and `ReactRunner` (a component with `getDerivedStateFromError`). The capability ceiling is precisely the injected scope/imports — owning that file is why we vendor rather than depend.

---

## Consequences

- **Honest names.** `html` does HTML; `react` does React. The conflation that made the first cut feel "鸡肋" is gone.
- **Two safety stories, each clean.** `html` is safe by construction and stays the OSS/multi-tenant default. `react` is safe by *trust*, opt-in, and obviously so (you typed `enableCapability`).
- **No build/deploy for either.** `html` compiles at save; `react` transpiles at render (lazy chunk). Neither needs a bundler in the author loop.
- **AI fit.** AI writes both fluently. For `react`, correctness is bounded by the injected scope + human review (ADR-0033), not by hoping the model never writes a bad effect.
- **Cost.** `react` runs author code in the main tree: a thrown render is caught by the error boundary, but an author can still write a slow/incorrect page. That is the accepted price of the trusted tier; a deployment that does not trust its authors sets `OS_PAGE_REACT=off`. Revisit if a future need arises for *untrusted* rich pages — that would be a *different* ADR (sandboxed execution), not this one.
