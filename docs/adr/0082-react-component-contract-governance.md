# ADR-0082: Governing the react-tier component contract — spec is the protocol source of truth, the registry is a designer subset, and divergence is held by a build-time conformance ratchet + an authoring prop gate

**Status**: Accepted (2026-06-30)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0080](./0080-ai-authored-ui-jsx-source.md) (AI authors UI; the component registry `inputs` are the contract; **capability ≠ contract** — curate a small public surface, not the full capability set), [ADR-0081](./0081-trusted-react-page-tier.md) (the `kind:'react'` tier executes real React; its safety boundary is **trust + review**, and its prop ceiling is the **injected scope**), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (AI writes metadata via draft-gated review), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (ratchet a snapshot; flag regressions, not the accepted baseline), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently-inert metadata — a prop the author writes must be honored or rejected, never silently dropped).
**Consumers**: `@objectstack/spec` (`packages/spec/src/ui/react-blocks.ts` — the block→schema index + React overlay; `scripts/build-react-blocks-contract.ts` — the generator; `scripts/check-react-blocks-declaration-parity.ts` + `react-declaration-parity.baseline.json` — the ratchet), `@objectstack/lint` (`validate-react-page-props.ts` — the authoring prop gate), `@objectstack/cli` (`os validate` wires the gate), `scripts/gen-sdui-manifest.sh` (`pnpm sdui:manifest` — dumps the manifest and runs the ratchet; **this is the producer**, corrected here in #5960: the ratchet moved out of `scripts/build-console.sh` in #4472 and this row still named the old file), `../objectui` (the component registry `inputs` are the projected surface the ratchet checks against).

**Premise**: ADR-0081 gave authors (and AI) a `kind:'react'` page tier whose blocks are the curated public data components (`<ObjectForm>`, `<ListView>`, charts, record:* panels). For AI to author those blocks *correctly* it must know each block's props — and for that knowledge to be trustworthy, the props must come from an authoritative, machine-readable, **non-drifting** source. The problem: **there is no single such source.** Three prop surfaces exist for the same components, and nothing keeps them in lockstep:

| surface | what it is | role |
|---|---|---|
| **spec zod schemas** (`view.zod`, `component.zod`, `chart.zod`) | the protocol — `FormViewSchema`, `ListViewSchema`, `RecordDetailsProps`, … | declarative config, authoritative + richly described |
| **registry `inputs`** (objectui) | the visual **designer palette** | a *curated subset* the property panel exposes |
| **React prop types** | the implementation | what the component actually accepts at runtime |

They drift silently: a component can accept a prop the spec never declared (an undocumented extension), or the spec can declare a prop the designer can't configure (a panel gap). Left ungoverned, the AI-facing contract becomes fiction, and `kind:'react'` authoring degrades to guessing.

> **Trigger**: building the react-tier contract, the author asked in turn — "does the AI know the prop list? does it know each prop's params? do we need a protocol?" then "the spec UI protocol must already define the standard components — reference it, don't hand-author" then "we can't guarantee the frontend actually conforms to the backend protocol — confirm that too" then "is running this conformance check on every CI worth it?". This ADR records the model those questions converged on, now that it is implemented and merged across framework #2478/#2480/#2482/#2484/#2485/#2488/#2489 and objectui #2113/#2115.

---

## TL;DR

1. **[source of truth] The spec zod schema is the protocol.** The AI-facing component contract is **generated** from the spec schemas (`z.toJSONSchema`) plus a thin React-interaction overlay — never hand-authored. Generated ⇒ it cannot drift into fiction.
2. **[registry is a subset] Registry `inputs` are the designer palette, not the protocol.** A prop the spec declares but the registry doesn't expose is a *soft* signal (panel gap), not a violation. A prop the component exposes that the spec doesn't declare is the *actionable* signal (undocumented extension).
3. **[overlay] React-interaction props live in a thin overlay, not the spec.** Callbacks (`onSuccess`, `onRowClick`), controlled props (`recordId`, `mode`, `filters`), and binding escape-hatches (`objectName`, a chart's static `data`, a list's `fields`/`options`) are real React surface the *view metadata* schema neither models nor should. They are declared in `react-blocks.ts`'s overlay so the contract documents them.
4. **[declaration parity = ratchet, not per-PR gate] Spec↔registry parity is checked where the manifest is free.** The registry-inputs manifest only exists once a real browser has enumerated the built console registry. So it runs **inside `scripts/gen-sdui-manifest.sh`** (`pnpm sdui:manifest`) as a **baseline ratchet** (ADR-0054 shape): it flags only NEW registry-only inputs or vanished blocks against a committed baseline — not the accepted divergence, and not every PR. Its **trigger is the objectui pin bump** — see addendum 2. *(Amended by #4472: this said "conformance", ran warn-only, and was read as confirming the components implement the spec props. It compares two declarations and now runs `--strict`. Amended by #5960: it said `build-console.sh`, which is where it shipped and no longer where it lives — #4472 moved it into `gen-sdui-manifest.sh`. See both addenda.)*
5. **[authoring = a hard gate] `os validate` enforces correct prop *usage*.** A separate `validate-react-page-props` gate parses each `kind:'react'` page's real JSX and checks block usage against the contract: a missing **required binding** is an error; a near-miss **prop typo** is a warning; arbitrary unknown props are *not* flagged (the contract's data props are a curated subset, so false positives stay near zero).
6. **[the chain] Five links, each with one job.** protocol source (spec) → generated contract (`react-blocks.md`) → declaration-parity ratchet (gen-sdui-manifest.sh) → authoring prop gate (os validate) → a dogfood golden page proving the loop closes. **No link in this chain observes a render** — see addendum 1 for what that costs and where the missing evidence now comes from.

---

## Decision

### 1. The spec schema is the source of truth; the contract is generated from it

`packages/spec/src/ui/react-blocks.ts` is a **block→schema index**: each curated public block (`<ObjectForm>` → `FormViewSchema`, `<ListView>` → `ListViewSchema`, `<RecordDetails>` → `RecordDetailsProps`, `<ObjectChart>` → `ChartConfigSchema`, …) names its spec schema, plus a per-block `dataProps` allowlist that curates *which* schema props to surface (ADR-0080: capability ≠ contract — `ListView` has 45 schema props; the contract surfaces ~10 high-signal ones).

`scripts/build-react-blocks-contract.ts` generates the AI-facing contract (`skills/objectstack-ui/contracts/react-blocks.contract.json` + `references/react-blocks.md`) by reading the spec schemas (`z.toJSONSchema`, with `OS_EAGER_SCHEMAS=1` to resolve lazy schemas), taking each prop's spec-authored `.describe()`, and merging the React overlay. **Hand-authoring is rejected** — a hand-written contract drifts into fiction; a generated one is zero-drift by construction.

### 2. Registry `inputs` are a projection, not the protocol

Per ADR-0080, the objectui registry `inputs` are the *contract for the visual designer's property panel*. They are deliberately a **subset**: the component reads the full schema at render time, but the panel only exposes the props worth configuring by hand. Therefore:

- **spec-only** (spec declares it, registry doesn't expose it) ⇒ a **soft** signal. The component still honors the prop; the designer just can't set it. Not a conformance failure.
- **frontend-only** (registry exposes it, spec doesn't declare it) ⇒ the **actionable** signal. Either the component grew an undocumented extension (record it), or the spec is behind (catch it up).

### 3. React-interaction props belong in the overlay, not the spec

The spec UI schemas are *view metadata* — declarative, serializable configuration. React interaction surface is not view metadata and must not be forced into it:

- **callbacks** (`onSuccess`, `onError`, `onCancel`, `onRowClick`, `onNavigate`, `submitHandler`) — functions; meaningless in serialized metadata.
- **controlled props** (`recordId`, `mode`, `filters`) — driven by React state at render.
- **binding escape-hatches** (`objectName`; `<ObjectChart>`'s static `data`; `<ListView>`'s simplified `fields` and per-viewType `options`) — legitimate props the component accepts that the schema doesn't model.

These are declared in the `react-blocks.ts` overlay with a `kind` of `binding`/`controlled`/`callback`. Declaring a genuine binding in the overlay is how a "frontend-only" prop is *closed* — the divergence was "the component accepts a prop the contract doesn't document," and the fix is to document it, not to leave it as accepted noise (framework #2488 took every block to **0 frontend-only** this way).

### 4. Declaration parity is a build-time baseline ratchet, not a per-PR gate

> **Corrected by #4472 — see addendum 1.** This decision was written and implemented as "conformance": the check was named `check:react-conformance`, and its script header claimed it confirmed the components "ACTUALLY implement" the spec props. It does not and never did — it compares **two declarations**, and it was **warn-only** besides. The mechanism below is real and kept; the words for it are now `check:react-declaration-parity`, and the gate now runs `--strict`.
>
> **Corrected by #5960 — see addendum 2.** This section shipped saying the ratchet runs *inside `build-console.sh`*. That was true when it was written and stopped being true at #4472, which moved it into `scripts/gen-sdui-manifest.sh`; the file names below are corrected in place, because a reader who followed this ADR opened the wrong file. #5960 also answers the question this decision left open — "not every PR" never said *when*, and the answer is **at the objectui pin bump**.

`scripts/check-react-blocks-declaration-parity.ts` compares the spec props (per block, via `z.toJSONSchema`) against the registry-inputs manifest (`sdui.manifest.json`). The manifest **only exists once a real browser has enumerated the built console registry** — the registry is a browser app pulling browser-only deps, so a framework PR has no manifest to check against. Running it on every PR is therefore not worth it.

Instead, it runs **inside `scripts/gen-sdui-manifest.sh`** (`pnpm sdui:manifest`), immediately after that script dumps the manifest (near-zero marginal cost *there*, because the browser is already open), as a **baseline ratchet** modeled on ADR-0054:

- `react-declaration-parity.baseline.json` stores each block's accepted registry-only input *set* + whether it is missing.
- `--baseline` reports **only regressions**: a block declaring a NEW registry-only input, or a previously-present block that vanished. The soft spec-only signal is not gated.
- It runs `--strict` there, so a regression **fails** the run. `--update` re-accepts the current state after a deliberate registry change.

Because the baseline was driven to **0 registry-only** (decision 3), the ratchet is noise-free: any future registry-only input is a real, actionable signal rather than one sitting in an accepted baseline.

### 5. Authoring correctness is a hard gate at `os validate`

`packages/lint/src/validate-react-page-props.ts` parses each `kind:'react'` page's real JSX (TypeScript compiler) and checks block usage against `REACT_BLOCKS`:

- **missing a required binding** (e.g. `<ObjectForm>` with no `objectName`) → **error** (fails `os build`). A spread `{...props}` escapes the check (the prop may come from it).
- **a near-miss of a known prop** (edit distance ≤ 2, e.g. `onSucces` → `onSuccess`) → **warning**.
- **arbitrary unknown props** are deliberately **not** flagged — the contract's data props are a curated subset, so flagging unknowns would false-positive constantly. Only likely typos of *known* props are surfaced.

This is the ADR-0078 boundary applied to react pages: a prop the author writes is either honored, or loudly rejected — never silently dropped.

### 6. The chain, and proof it closes

```
spec zod schema  ──gen──►  react-blocks.md      (AI reads it — decisions 1–3)
   (protocol)              (generated contract)
                                │
        registry inputs ──────► declaration-parity ratchet  (gen-sdui-manifest.sh — decision 4)
        (designer subset)       (strict baseline; two declarations, no renderer;
                                 on demand, at the objectui pin bump)
                                │
                                ▼
                           prop gate                  (os validate — decision 5)
                           (hard: missing-required / typo)
```

`examples/app-showcase/src/pages/renewals-pipeline.page.ts` is the **golden page**: authored straight from the contract (five server-connected blocks), it passes `os validate`; injecting a missing required `objectName` and an `onSucces` typo makes the gate fail with an error + a warning (captured in `docs/audits/2026-06-react-tier-authoring-dogfood.md`). The chain demonstrably closes.

---

## Consequences

- **Future contributors don't re-litigate the model.** Adding a public block = add it to the `react-blocks.ts` index + regenerate; the contract, the conformance baseline, and the prop gate all follow from that one edit.
- **The contract can't lie.** It is generated from the spec schemas, so it always reflects the real protocol — there is no hand-maintained list to fall behind.
- **New frontend divergence is caught when the frontend the repo ships actually moves**, without taxing every PR or false-failing on the accepted (subset) baseline. *(#5960: this said "at the release point, for free". Neither half survived #4472 moving the ratchet out of the console build — the trigger is the objectui pin bump, and it costs whoever bumps the pin one `pnpm sdui:manifest` run. See addendum 2.)*
- **AI authoring is enforced, not hoped for.** A wrong prop is caught at `os validate` before it ever renders.
- **Cost**: the contract regen + baseline are committed artifacts that must be regenerated on a deliberate change (an extra step, guarded by `gen:api-surface` for public exports and the ratchet for frontend changes). This is the price of zero-drift and is intentional.

## Alternatives considered

- **Copy component props into the framework spec zod (one schema to rule them all).** Rejected by ADR-0080: the registry `inputs` are already the contract, and the spec's role is the tree envelope + object-binding (only it knows objects). Duplicating component props into spec would create the same `z.record` escape-debt this whole line avoids.
- **Run conformance on every PR as a hard gate.** Rejected: the manifest doesn't exist on a framework PR (browser-only registry), and the divergence has a legitimate accepted baseline (registry = designer subset), so a hard per-PR gate would be both expensive and false-positive-prone.
- **Hand-author the contract.** Rejected: it drifts into fiction (an earlier Phase-1 hand-authored contract did exactly this). Spec-as-source is zero-drift.
- **Treat the registry `inputs` as the source of truth.** Rejected: `inputs` are a curated *subset* (the panel), not the full protocol; sourcing the contract from them would under-document what components actually accept.
- **Sandbox/typecheck the React source against generated `.d.ts` for full prop typing.** Out of scope here (and partially covered by ADR-0080's codegen path for the `html` tier); the prop gate's required-binding + typo checks are the pragmatic 80% for `react` authoring without a full type-check harness over executed source.

---

## Addendum 1 (2026-08-01, #4472) — the ratchet compares two declarations; it was named and described as if it compared a declaration to an implementation

**What was wrong.** Decision 4 shipped as `check:react-conformance`, and the script's header opened by saying it "confirms the objectui components **ACTUALLY implement** the props the spec protocol declares. The spec is the protocol; the frontend must conform." Both halves of its comparison are declarations:

| left | right |
|---|---|
| the props a block's **spec zod schema** declares (`z.toJSONSchema`) | the inputs the objectui **registry config** declares (`sdui.manifest.json`) |

The right-hand side comes from objectui's `manifestFromConfigs`, which copies `config.inputs` verbatim. Nothing in the chain looks at a renderer. So a prop **both sides declare and no renderer reads** is, to this gate, perfect agreement — neither declaration is individually false, and the falsehood lives one layer below, in a layer the gate cannot see.

**What it cost.** #4413: `record:details` / `record:highlights` / `record:related_list` / `record:path` each published `objectName` + `recordId` that no renderer consumed (they take the record from the record page's shared context), so on a `kind:'react'` page all four rendered a "bind a record to preview" placeholder. The committed baseline recorded `{ frontendOnly: [], missing: false }` for all four, and the ratchet stayed green for the defect's entire lifetime. It was found by a human reading the objectui renderers.

This is Prime Directive #10 (declared ≠ enforced) landing on a gate — the same shape as #1475's "spec declares 9 validation rules, the executor honors 3", except the thing overstating its coverage was the thing whose job is to catch that. **A gate that reports green on a promise it cannot keep is worse than no gate**: without one, someone checks by hand.

**Corrections.**

1. **Renamed to what it does** — `check:react-declaration-parity`, `check-react-blocks-declaration-parity.ts`, `react-declaration-parity.baseline.json`, and `frontendOnly` → `registryOnly` in the baseline (the old name implied the frontend *implemented* the prop; it means the registry *declared* it). The name was load-bearing in the misreading, so it had to change with the header.
2. **The scope caveat rides in the output, on every run** — including a clean one. Whoever forms a belief about this gate is reading a CI log, not a source header.
3. **It actually gates.** `gen-sdui-manifest.sh` ran it without `--strict` and swallowed the exit code behind a `⚠`, so even the divergence it *could* see was only ever recorded, never stopped. It now runs `--strict`; the ratchet fires only on divergence new since the accepted baseline, so a failure is always a deliberate registry change needing a spec/overlay edit or an explicit `--update`.
4. **The claim is pinned by a test.** `check-react-blocks-declaration-parity.test.ts` asserts both directions of what the gate *can* see, that the caveat is emitted, and that the implementation claim does not come back — the executable half of Prime Directive #10.

**What is still true.** Decision 2's signal taxonomy is unchanged and worth keeping: `spec-only` (palette gap, soft), `registry-only` (undocumented extension, ratcheted), `missing` (not registered / not public). Exactly one class is invisible: both sides declare it, nothing reads it.

**Where the missing evidence now comes from.** Evidence about the render path has to be taken from the render path, which lives in objectui. `apps/console/src/__tests__/public-block-binding-reach.test.tsx` (objectui) mounts every public block that declares an `objectName` input through `SchemaRenderer` with nothing but that binding, under a provider whose `dataSource` records every call, and asserts some call carried the object name. Deliberately narrow — "is this binding wired", not "is every declared input consumed", which is not decidable from outside without heuristics — and every non-reaching block carries a written reason in a ledger asserted to equal the observed set in both directions. Its first run separated five bound blocks from three unbound ones and surfaced two real defects of the #4413 shape (objectui#3144), which is the confirmation that this evidence was never obtainable from here.

---

## Addendum 2 (2026-08-07, #5960) — the ratchet's producer, and the trigger decision 4 never named

**What was wrong, and it was two things.**

1. **The file name.** Decision 4, its TL;DR line, the chain diagram and the **Consumers** row all said the ratchet runs inside `scripts/build-console.sh`. It did when this ADR was written; #4472 moved it into `scripts/gen-sdui-manifest.sh` (`pnpm sdui:manifest`) and nothing came back to correct the ADR. `build-console.sh` now *deliberately* produces no manifest — dumping one needs a real browser, and the console build must not drag a browser dependency in — so a reader following this ADR opened a file whose closing comment says the opposite of what the ADR sent them there for. `docs/audits/2026-06-react-blocks-conformance.md` carried the same stale pointer and is corrected with it.
2. **The trigger was never stated.** "Not every PR" is a statement about where the check does *not* run. Decision 4 never said where it *does*, and the measured answer (#4690, #5960) was: nowhere automatic. No workflow runs `pnpm sdui:manifest`; no workflow installs Playwright for it; `packages/console/dist/` is gitignored; the published `@objectstack/console` tarball ships no `sdui.manifest.json`. The ratchet ran exactly when a human chose to run it, and no procedure told anyone to.

**Decision (maintainer, 2026-08-07).** The ratchet is an **on-demand gate**, and its trigger is the **objectui pin bump**:

> `sdui.manifest.json` only changes when the objectui pin moves, so the correct trigger has always been the pin-update flow, not every PR. The procedure gains one line: run `pnpm sdui:manifest` when bumping the objectui pin, and the ratchet runs there. #4690 already guarantees this cannot go falsely green — a missing manifest fails loudly — so honest on-demand coverage beats expensive full coverage.

**Why not produce the manifest in CI.** Rejected explicitly. The only producer drives Playwright chromium over objectui's built console and reads `window.__MANIFEST`, so CI-side production means a full objectui workspace build plus a browser download on every matching PR — a cost this repo declined while paying down merge-queue health (#6082). Having objectui publish the manifest as a release artefact (leaving the browser cost on the side that already runs one) is the structurally right end state and is **deferred, not rejected**: there is no pull for it today, and it waits for the next time objectui's release pipeline is opened.

**Why on-demand is honest rather than a hole.** Since #4690 the gate has no green path it has not earned: a missing `MANIFEST`, an unreadable path, malformed JSON, or a dump declaring zero components each **exit 1** with a prescription naming the producer. So the failure mode this leaves is "unrun", never "falsely passed" — and "unrun" is what the procedure line closes.

**Where the line lives** (all three, because the operator meets them in this order):

- `scripts/bump-objectui.sh` prints it as a NEXT STEP on every successful bump, including `--no-commit`. A **reminder, not a hard gate** — a machine without Playwright must still be able to move the pin, and hard-failing there would be CI-side cost wearing a local disguise.
- `scripts/build-console.sh` closes with it too, because `pnpm objectui:refresh` runs bump-then-build and that output is the last thing an operator sees.
- `docs/releases-maintenance.md` carries it as prose, in the pin-bump procedure — the pin-freshness "fix when it fires" step that used to carry it too went with the `Console Pin Freshness` gate itself (#10134).

**What is unchanged.** Decision 4's mechanism and its "not every PR" verdict both stand, and this addendum records no reversal — it names the producer correctly and supplies the trigger the decision left blank.
