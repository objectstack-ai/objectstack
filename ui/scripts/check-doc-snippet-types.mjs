#!/usr/bin/env node
/**
 * Every fenced `ts` / `tsx` snippet in the documentation this gate covers must
 * COMPILE, `--strict`, against the packages' BUILT `dist/*.d.ts` — the surface a
 * reader who copies it actually imports.
 *
 * Run:  node scripts/check-doc-snippet-types.mjs   (also `pnpm check:doc-snippets`)
 *       node scripts/check-doc-snippet-types.mjs --build-filter   (filter args for
 *       turbo or pnpm; each carries the `...` dependency-closure suffix)
 * Exit: 0 = every covered snippet parses and type-checks, the harness proved
 *       itself on its own controls, and the coverage ledger is exact.
 *       1 = THE GATE RAN AND FOUND ERRORS. A snippet failed to parse or to
 *       type-check, or the coverage ledger is stale. Everything printed above
 *       the summary is a verdict about a document.
 *       2 = THE GATE COULD NOT RUN, so nothing printed above is a verdict about
 *       any document: the packages the covered snippets import are not built (or
 *       are typed from source), or one of the harness's own controls failed.
 *       Fix the tree and re-run. Never read this as a documentation defect, and
 *       never as a pass.
 *
 * ## Why "could not run" is its own exit code (objectui#5465)
 *
 * Both 1 and 2 are non-zero, so no caller's pass/fail changes: this gate is
 * invoked from exactly one workflow step (in `repo-gates.yml` since objectui#12214),
 * which fails on any non-zero, and whose job builds this gate's own
 * `--build-filter` closure BEFORE invoking it — an unbuilt tree is not a state CI can reach. The
 * distinction exists for the reader. "I could not run" and "I ran and found
 * errors" are different facts, and while they shared one exit code they were
 * indistinguishable at the exit-code level: three separate agents in one evening
 * (objectui#6171, #6186, #5259) each had to notice the printed message and
 * rebuild before their exit code meant anything, and #6171 wrote it down as
 * "an unbuilt-tree exit is indistinguishable from a real failure at the
 * exit-code level". `scripts/check-eager-closure-budget.mjs` had already drawn
 * this same line for this same reason — 1 for "over budget" (a verdict about the
 * bundle), 2 for "the gauge produced nothing" (a verdict about the gauge) — so
 * this is the repository's convention, not a new one.
 *
 * ⛔ What is NOT an option here: printing the reason and exiting 0. Zero with
 * nothing run reads as coverage, which is the exact failure shape this whole
 * gate family exists to prevent (objectui#4846: an unexaminable package must not
 * read as a clean one).
 *
 * ## What this gate answers, and the three things it does NOT (read this first)
 *
 * It answers exactly one question: **does this snippet still compile against the
 * published types.** That catches an import of a symbol the package does not
 * export, a prop or key the type does not have, a signature the call no longer
 * matches, and a key whose TYPE was repurposed underneath the prose.
 *
 * It does NOT answer:
 *
 *   1. **Schema-key validity.** Whether a metadata literal would survive
 *      `ReportSchema.safeParse` is a different question with a different
 *      answer: `@objectstack/spec`'s schemas are strict, so they reject keys a
 *      TypeScript annotation never sees (an object literal assigned through a
 *      widened type, or written with no annotation at all). That is objectui#5138
 *      shape 1. For a ts/tsx block it stays unanswered here. For a `json` /
 *      `jsonc` fence it is answered by the sibling gate
 *      `scripts/check-doc-json-fences.mjs` (objectui#5250), which judges each
 *      node document in `content/docs` through the strict authoring face and
 *      marks the deliberate fragments with a declaration it re-judges.
 *   2. **Whether a `type` literal names a registered component.** That is
 *      `scripts/check-doc-component-types.mjs`, the first dimension, and it stays
 *      its own gate: it needs no install and no build, and it must keep running
 *      unfiltered on every docs-only PR.
 *   3. **Whether a shell example runs** (objectui#5151). A ```bash block is not
 *      read here at all.
 *
 * That list is not modesty, it is the point. objectui#5138 measured what a gate
 * with an unstated blind spot does: `check-doc-component-types` verified the
 * `type` literals `summary` / `matrix` / `joined` — which were correct — while
 * four separate falsehoods sat beside them in the same snippets (`objectName` and
 * `groupingsDown`, keys the strict `ReportSchema` rejects; `columns:
 * [{ field, aggregate }]`, a key repurposed to `string[]`; `import type
 * { ReportInput }`, a type the spec does not export; and `registerDrillHandler`,
 * a fabricated export). Three gates were green on that prose for the whole
 * interval. The card's sentence for it:
 *
 *     The gate looked at the one key that was correct.
 *
 * A gate that checks the one thing that is right converts "unverified" into a
 * green, which is worse than no gate. So this file states its edges out loud, and
 * the ledger below states, by name, every document it does not read.
 *
 * ## Why this exists at all: it is consolidation, not new capability
 *
 * The harness had already been hand-rolled three times, each time privately, each
 * time finding defects its reviewer had not listed:
 *
 *   objectui#5053  README export-surface probe — proved the name set had to come
 *                  from the package's EXPORTS, not from a grep of `src/`
 *                  (`ReportScheduleConfig` appears twice in `src/` and is not
 *                  exported; a grep-based check calls it real).
 *   objectui#5060  README signature probe — extracted the blocks BY SCRIPT rather
 *                  than by hand, and carried a wiring self-check (deliberately
 *                  swap two arguments; the probe must go red) so a silently-`any`
 *                  program could not pass as green.
 *   objectui#5047  the two plugin-report documents — compiled against the built
 *                  `dist/index.d.ts` with a resolution self-check proving it, and
 *                  a planted `ThisNameIsDefinitelyNotExported` sentinel.
 *
 * All three practices are kept here (see "Controls"). One practice is
 * deliberately NOT kept: #5047's first run was a FALSE GREEN, and the mechanism
 * is the most important thing this file inherits — see "Syntax is not semantics".
 *
 * ## The rule for fragments: explicit marker, never a silent skip
 *
 * Documentation legitimately contains partial snippets. The rule this gate uses,
 * stated rather than inferred:
 *
 *     EVERY `ts` / `tsx` fenced block in a covered document is compiled, in
 *     ISOLATION, as its own module. A block that is not meant to compile must be
 *     DECLARED by a marker line immediately above its fence, carrying a written
 *     reason. There is no third case: a block that fails to parse is a FAILURE,
 *     never a skip.
 *
 * Two kinds of block need the declaration, and the reason says which: a genuine
 * FRAGMENT (a shape excerpt, a block continuing the one above it, a call into
 * the host's own router), and a block that is deliberately about code that no
 * longer exists — a migration guide's "before" example naming a retired package
 * is correct documentation and must not compile. The marker keyword stays
 * `fragment` for both rather than growing a second vocabulary; what
 * distinguishes them is the written reason, which is the part a reviewer reads.
 *
 * The two marker spellings are quoted verbatim in `FRAGMENT_MARKER_EXAMPLES`
 * below — an MDX expression comment for `.mdx`, an HTML comment for `.md`. They
 * live in code rather than in this header because a block comment cannot quote a
 * block comment's delimiters.
 *
 * Two halves of that rule are load-bearing:
 *
 * **Never skip on failure to parse.** The tempting rule — "if it does not parse
 * it must be a fragment, skip it" — turns every real defect into a skip, silently,
 * and it degrades exactly when the docs get worse. A block nobody has declared and
 * that does not parse is reported.
 *
 * **In isolation, as its own module.** Blocks on one page are NOT compiled into a
 * shared scope, and every block with no top-level `import`/`export` has an
 * `export {}` appended so it cannot see another block's globals. This models the
 * reader, who copies ONE block: objectui#5047 found three README examples calling
 * `defineReport` with no import of their own, and fixed the documents rather than
 * the harness. A shared scope hides that whole defect class — and it hides it
 * INVISIBLY, because the page still reads fine to a human going top to bottom.
 *
 * **A fragment's reason says why it cannot compile. It never claims the block was
 * checked** (objectui#7505). A DECLARED fragment is the one thing this gate does
 * not compile, so a reason asserting the block agrees with some shipped artifact
 * is an assertion the gate structurally cannot re-verify — and a reader has no
 * way to tell the two apart, because both arrive in the same marker. Measured:
 * `content/docs/utilities/data-objectstack.mdx` declared a signature excerpt
 * "checked against the shipped `dist/index.d.ts` … with the same type". The
 * claim was TRUE when written and went silently false when objectui#7503 widened
 * the factory's return from `DataSource<T>` to `ObjectStackAdapter<T>`. Three
 * independent readers looked for exactly that falsehood and did not find it —
 * card objectui#7323 never listed the page, the implementer reported "no
 * swappability note anywhere" after searching, and the seat that briefed the
 * search accepted that. The failure was not diligence: the page reads as
 * verified and nothing contradicts it. That makes the marked page WORSE than an
 * unmarked one, because it converts a reader's correct instinct — go check this
 * against the source — into a step they skip.
 *
 * The reusable rule, which is why this is worth a gate and not a convention:
 *
 *     A claim that something was verified is only as good as the check that
 *     re-verifies it on every commit. A one-time verification written into prose
 *     is a fact with an expiry date and no alarm.
 *
 * So `VERIFICATION_CLAIM` below refuses the COMBINATION, never the exemption:
 * exempting a fragment from compilation stays a legitimate declaration, and a
 * verification claim stays legitimate on a block this gate actually compiles.
 * Only the two together are refused, and the author has two ways out — say why
 * the block cannot compile without asserting it was checked, or move the block
 * into the compiled tier where the claim becomes one this gate re-verifies. ⛔
 * Not an option: adding an exemption list. An exemption here would be a second
 * unverifiable assertion about an unverifiable assertion.
 *
 * The verb set is deliberately small and it is a closed list, because a census
 * of this corpus showed it can be: of 158 declared fragments, exactly 2 carried
 * a claim, and both spelled it `verified` / `hand-checked`. `type-check` is
 * excluded on purpose — it names THIS gate's own action, so "type-checked on the
 * complete example at the end of the page" (content/docs/guide/component-registry.md)
 * is a claim about a check that does re-run on every commit, which is the shape
 * this rule wants, not the shape it refuses. ⚠️ Stated limit: the check reads the
 * marker's reason, not the page's prose, and it matches verbs rather than parsing
 * meaning — "type-checked by hand" would pass it. It closes the spelling that has
 * actually been written here, and it turns a silent gap into a red build on the
 * commit that reintroduces it.
 *
 * ## Syntax is not semantics — the false-green mechanism this gate is built around
 *
 * objectui#5047 measured it, and it nearly cost that review its result: `tsc`
 * reports syntactic diagnostics and, IF THERE ARE ANY, never reports semantic
 * ones — program-wide, not per-file. Two prose fragments with a bare
 * `filter: { ... }` line produced five parse errors and ZERO semantic
 * diagnostics, over a program whose whole purpose was the semantic half. The run
 * was red, so it read as "the check works" while proving nothing at all about
 * every other block in it.
 *
 * Three consequences, all of them structural here rather than advisory:
 *
 *   - The two phases are SEPARATE. Blocks are parsed one at a time first;
 *     anything with a parse error is reported as a `syntax` failure and is kept
 *     OUT of the semantic program, so one unparseable block cannot blind the
 *     rest.
 *   - Every failure line is tagged `[syntax]` or `[semantic]`, and the summary
 *     always prints the semantic COVERAGE — how many blocks the semantic phase
 *     actually judged, out of how many exist. A syntax-only red therefore cannot
 *     be read as a semantic pass, and a semantic green cannot be read as covering
 *     blocks that never reached the checker.
 *   - When any block fails to parse, the summary says so in the same breath as
 *     the semantic result, in words.
 *
 * ## Controls — a probe that cannot fail is not a probe
 *
 * Three run on every invocation, before any verdict about the documents:
 *
 *   RESOLUTION  `@object-ui/types` is resolved through the same host the program
 *               uses, and the resolved path is PRINTED. It must land in a
 *               `dist/` `.d.ts`. The repository's own root `tsconfig.json` maps
 *               `@object-ui/<name>` to each package's `src`, so a harness that inherited
 *               it would silently check the docs against SOURCE — green while the
 *               published surface is broken. Nothing here extends that config,
 *               and every source file the program loads is checked not to live
 *               under a package's `src/`.
 *   SENTINEL    a synthetic module importing `ThisNameIsDefinitelyNotExported`
 *               from a real package MUST produce TS2305. A probe that silently
 *               resolves everything to `any` reports green forever; this is the
 *               only thing that can tell the two apart.
 *   POSITIVE    a synthetic module importing a real symbol MUST be clean. Without
 *               it, a harness broken in the other direction (wrong `lib`, missing
 *               types, unbuilt tree) turns every document red at once and reads
 *               as "the docs are full of defects".
 *
 *   UNDECLARED  a synthetic module importing `@floating-ui/react-dom` MUST produce
 *               TS2307. That package IS installed in this workspace — Radix's
 *               popper pulls it in, under `@object-ui/components`'s declared
 *               `@radix-ui/react-popover` — and NO package a covered document
 *               imports declares it, so no reader of the documented packages can
 *               import it either. It is the control on the third-party rule
 *               below: the moment resolution widens past what the imported
 *               packages declare, this control goes green and the gate has become
 *               a rubber stamp no snippet can fail — invisibly, because every
 *               document stays green while it happens. It also fails loudly if
 *               the specifier ever BECOMES a declared dependency (pick another),
 *               or is not installed at all (a specifier that resolves nowhere
 *               proves nothing about how far resolution reaches).
 *
 *   ROOT-       a synthetic module importing `vitest` MUST produce TS2307.
 *   DECLARED    `vitest` is declared by this repository's ROOT `package.json`,
 *               which pnpm symlinks into `/node_modules`, so it USED to resolve
 *               here and now must not — it is the control on the bound stated
 *               in the next section. Its three failure modes are the UNDECLARED
 *               control's, for the same reasons: the specifier becoming mapped
 *               (pick another), the specifier no longer being declared by the
 *               root (it then proves nothing about the root's set), and the
 *               specifier not being installed (a specifier that resolves
 *               nowhere anyway proves nothing about how far resolution reaches).
 *
 * ## The bound: what the repository ROOT declares does not resolve either
 *
 * The rule in the next section maps what the IMPORTED PACKAGES declare. Nothing
 * in it says anything about the repository's own `package.json` — and under pnpm
 * the root's own dependency set IS symlinked into `/node_modules`, one directory
 * above where every block is compiled. So a bare specifier that neither map
 * covers still resolved, as long as this repository happened to declare it as a
 * devDependency: measured, `vitest` and `@playwright/test`. A snippet importing
 * one was green because of what THIS WORKSPACE installs to test itself, which is
 * not a claim about anything its reader installs. The UNDECLARED control does
 * not reach this: it bounds TRANSITIVE packages (which pnpm leaves only under
 * `.pnpm/`, unreachable from here), a different leak.
 *
 *     A bare specifier that resolves ONLY through the repository root's own
 *     manifest is REFUSED, in this harness, for every consumer of it.
 *
 * Ruled by the maintainer on 2026-09-03 (objectstack#14909 item 1, option A;
 * objectui#7463 item 2) after the objectui#7490 flight measured both halves. ⛔
 * What it is deliberately NOT: a parameter defaulting to off. Two resolution
 * regimes behind one function would answer "did resolution stay narrow?" with
 * "depends who is asking", which is the consumer-side tolerance this whole file
 * is built against. There is one regime, and the control above proves it is on.
 *
 * ONE predicate (`resolvesOnlyThroughRootManifest`), enforced at two points
 * because a bound needs to be both TOTAL and ATTRIBUTABLE:
 *
 *   - **In the resolver** (`host.resolveModuleNames`, for files inside the
 *     virtual probe directory only — the bound is about what a SNIPPET may
 *     import, never about how a `.d.ts` deep in `node_modules` resolves its own
 *     imports). This is the regime, and the ROOT-DECLARED control is exactly the
 *     probe that it is live.
 *   - **Per block** (from the parsed AST, never a regex — the corpus is prose,
 *     and a specifier-shaped string in a template literal is not an import). A
 *     block importing such a specifier is kept OUT of the semantic program and
 *     reported as its own failure class, the way an unparseable block is: its
 *     other diagnostics would be noise cascading off an import that resolves
 *     nowhere, and the summary's coverage count then tells the truth about what
 *     was judged instead of counting it as checked.
 *
 * The manifest, not the disk, decides — the same direction as "declared, never
 * merely installed" below. A specifier the root declares AND a mapped package
 * declares is mapped, and stays resolvable: it reaches the reader through the
 * package they install, so the root's copy is not what backs it.
 *
 * ONE exemption, and it is about authorship rather than about resolution: the
 * JSX factory module (`react/jsx-runtime`). It is the only module the compiler
 * imports on the author's behalf — see `JSX_RUNTIME_SPECIFIERS` for the measured
 * reason, which is that refusing it would red blocks over a line nobody wrote,
 * unevenly between the two corpora.
 *
 * ⛔ What this rule exists INSTEAD of, again: adding `@playwright/test` to some
 * package's `dependencies` so the map covers it. See the 2026-08-24 ruling
 * quoted at the end of the next section — a manifest is a claim about what a
 * package needs, and a doc gate's convenience is not that claim.
 *
 * ## Third-party specifiers resolve exactly as far as the imported packages declare
 *
 * A snippet that imports `@object-ui/layout` may also import `lucide-react`,
 * because `@object-ui/layout` DECLARES `lucide-react`: a reader who installs that
 * package gets it in their `node_modules`, and `SidebarNav`'s `NavItem.icon`
 * genuinely takes a lucide icon. This program compiles every block at the
 * repository ROOT, where under pnpm a workspace package's own dependency is not
 * hoisted and so does not resolve — five correct blocks across
 * `content/docs/layout` failed TS2307 on nothing but that (objectui#6120). The
 * snippets were right; the resolution environment was the gap.
 *
 * The rule, stated here because its EDGES are the whole of its value:
 *
 *     For every workspace package a COVERED document imports, each specifier that
 *     package declares in its own `dependencies` — or REQUIRES of its consumer in
 *     its own `peerDependencies` — is mapped to the types a consumer of that
 *     package would resolve, resolved from inside that package's own directory,
 *     exactly the way that package's own code resolves it.
 *
 * Four edges, each deliberate:
 *
 *   - **Declared, never merely installed.** The set comes from `dependencies` in
 *     the imported packages' manifests, never from a walk of `node_modules`. A
 *     blanket mapping would let a snippet import a transitive package no consumer
 *     can reach and still pass green, which is strictly worse than the gap it
 *     would close: the gate's whole value is that it fails where a reader fails.
 *   - **`dependencies`, plus the REQUIRED `peerDependencies` this workspace
 *     resolves** — never `devDependencies`, and never an OPTIONAL peer. This is
 *     the widening the previous edge reserved, so it carries its reason here
 *     rather than arriving silently (objectui#8919, ruled after objectui#8303).
 *
 *     THE CLASS IT NOW RESOLVES, stated exactly: a specifier an imported package
 *     names in its own `peerDependencies`, that its `peerDependenciesMeta` does
 *     NOT mark optional, and that resolves — from inside that package's own
 *     directory — to a declaration file outside any package's `src/`. All three
 *     conditions, or it is not mapped.
 *
 *     WHY THAT IS SOUND. The map's one question is whether a reader of the
 *     documented package can resolve the specifier, and a REQUIRED peer answers
 *     it yes. It is not an optional extra the reader may lack: the package
 *     declares it cannot function without it, npm 7+ and pnpm (`auto-install-peers`
 *     here) install it, and a reader who has not supplied it is holding an
 *     install the package itself calls broken. So it reaches every reader who
 *     can use the package AT ALL — the same reachability a `dependencies` entry
 *     has, arriving through the reader's own tree instead of the package's. On a
 *     React component library the case makes itself: a consumer with no `react`
 *     cannot render one node of any package documented here.
 *
 *     WHAT STAYS CLOSED, so the widening is a class and not a licence: an
 *     OPTIONAL peer is exactly what the old reason described — a requirement the
 *     consumer may legitimately not meet — and stays unmapped; a devDependency
 *     reaches no consumer at all and stays unmapped; a required peer this
 *     workspace cannot resolve to a declaration file stays unresolvable rather
 *     than approximated; and every specifier no imported package names in either
 *     field is still refused by the bound above. Nothing was declared at the
 *     repository root to make this pass — the 2026-08-24 ruling on objectui#6120
 *     rejects that route by name, and it stays rejected.
 *
 *     WHAT MADE IT NECESSARY, measured rather than argued. `dependencies`-only
 *     was not merely conservative here, it was reading a manifest DEFECT as
 *     coverage. `react` was in the map for the whole corpus only because two
 *     packages pinned it in `dependencies` while also asking for it as a peer —
 *     the contradiction objectui#8303 removed, because a library that installs
 *     its own React puts a second React in the consumer's tree. Correcting those
 *     two manifests took the map's only `react` entry with it and refused 34
 *     blocks across 21 files in 19 packages the correction never touched. The
 *     stand-in remedy below does not reach them: 27 of the 34 use the peer's
 *     bindings AS JSX components, and a `declare const` stand-in cannot type one
 *     — its return has to be assignable to React's real `ReactNode`, and React's
 *     real types are precisely what left the map (`@types/react` is in no
 *     package's `dependencies` either). objectui#8059 had already written the
 *     shape down — the refusal "reads as impossible on a peer" — and this is the
 *     run that measured "reads as" into "is", for 27 of 34.
 *
 *     ⇒ A document may still meet a refusal here — an optional peer, or one that
 *     resolves to no declaration file, reaches this same message. What it DOES
 *     about that, without surrendering the block: stand
 *     the peer's bindings in with `declare const` typed to what the block uses
 *     them as, and import only what the map covers.
 *     The block still compiles, so the documented package's own composition
 *     around it stays genuinely checked — where declaring the block a fragment
 *     would have stopped all of it, that composition included. Worked in
 *     `packages/layout/README.md` under "Usage with React Router"; the bound's
 *     refusal message names this remedy too, because a refusal offering only
 *     "import something else" and "give up the block" reads as IMPOSSIBLE on a
 *     package whose headline feature IS the peer integration (objectui#8059).
 *   - **Imported packages only.** A package no covered document imports
 *     contributes nothing, so this map grows only as coverage grows — the same
 *     property `--build-filter` has, for the same reason.
 *   - **The bare specifier only, no subpath wildcard.** `lucide-react` is mapped;
 *     `lucide-react/dynamic` is not, and fails closed. Mapping `<pkg>/*` would
 *     reach past the package's own `exports`, and `exports` is precisely the
 *     boundary a reader hits.
 *
 * ⛔ What this rule exists INSTEAD of: declaring `lucide-react` at the repository
 * root. That would put an entry in this repository's dependency graph that exists
 * only to make a checker pass — changing what the repo claims to need in order to
 * satisfy a tool. The 2026-08-24 ruling on objectui#6120 rejected that route by
 * name, alongside objectui#5329 (minting a `$schema` URL because prose named one)
 * and objectui#6107 (minting exports because docs imported them). A manifest is a
 * claim about what a package needs; a doc gate's convenience is not that claim.
 *
 * ## Coverage is declared, never assumed — and the scan surface is stated here
 *
 * A document is covered unless it is named in `UNGATED_DOCS` with a reason. The
 * default is therefore COVERED: a new page is compiled from the day it lands,
 * and opting one out is an edit a reviewer can see. Entries are re-derived every
 * run — an entry naming a file that does not exist, or that holds no `ts` / `tsx`
 * block at all, fails as a stale entry, so the list can only shrink.
 *
 * That rule is only true of documents the walk actually reaches, so the SCAN
 * SURFACE is stated in the same breath as the coverage rule rather than left to
 * be read off the collector:
 *
 *     every `.mdx` and `.md` page under `content/docs`, every page under an
 *     `apps/<app>/docs` tree, every `README.md` under `packages/` AT ANY DEPTH
 *     (objectui#7308), every `.md` / `.mdx` page at the TOP LEVEL of the
 *     repository-root `docs/` tree (objectui#7856 card 1), every page under
 *     `docs/adr/**` and under `docs/audits/**` (objectui#7856 card 2,
 *     recursively), and the root `README.md`.
 *
 * ⚠️ The package-README clause used to read `every packages/<name>/README.md`,
 * one level, literally — and that is what objectui#7308 reported: the sentence
 * above is where the surface is SPECIFIED, so a walk that stopped at the package
 * root was not drift from this paragraph, it was this paragraph drawn too small.
 * Four nested pages were therefore neither compiled nor ledgered, i.e. neither
 * covered NOR declared ungated, one directory down from where objectui#5174
 * found the same state one level up. The sibling gate `check-doc-links` had
 * already closed the identical hole on the identical four files (objectui#6026).
 *
 * ⚠️ Card 2 is the widening whose whole delivery is the LEDGER, and reading it
 * as coverage would be reading it backwards. Every page in those two subtrees
 * that carries a `ts` / `tsx` block is named in `UNGATED_DOCS` below with its
 * measured count: an ADR and a dated audit are RECORDS, so a block inside one is
 * not this gate's to repair (see those constants). What the widening delivers is
 * objectui#5174's distinction and only that — a named debt with a number instead
 * of a tree that no accounting could mention.
 *
 * Stating it here is objectui#5174's finding, and the finding was not the missing
 * extension — it was that a reader had to open `listDocuments` to learn that
 * "covered by default" meant "covered if the filename ends in `.mdx`". The
 * collector admitted 143 `.mdx` under `content/docs` and silently excluded 40
 * `.md` guides — the getting-started pages a reader copies from most. None of
 * them was in the ledger, so they were neither covered NOR declared ungated:
 * they were invisible to this gate's own accounting, and the summary line below
 * could not mention them. That is precisely the silent skip the fragment rule
 * exists to prevent, arriving one level up, at the document instead of the block.
 * Anything added to the scan surface later belongs in that list, on the same day.
 *
 * ⚠️ The honest limit, stated because a reader of a green run needs it: an
 * ungated document is NOT compiled and NOT counted. Its snippets are unverified,
 * exactly as they were before this gate existed. The ledger is a debt list with
 * names, not a coverage claim. It carries no per-file failure count on purpose:
 * a count would have to be produced by compiling every ungated document, which
 * means building every package in the workspace on every run — the per-PR
 * full-repo build the 2026-08-16 ruling on objectui#4846 rejected (see
 * `.github/workflows/published-dist-gate.yml`). The build here is scoped to the
 * packages the COVERED documents import, which is why `--build-filter` exists and
 * why the cost grows only as coverage grows.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isEntrypoint } from './invoked-as.mjs';
import { TOOLING_FILE } from './check-phantom-dependencies.mjs';
import { virtualStorePath } from './workspace-root.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Configuration ────────────────────────────────────────────────────────────

/** Documentation surfaces read by this gate. Kept identical in spirit to
 *  `check-doc-links.mjs`: the pages a reader lands on, plus every published
 *  package README (which ships to npm inside the package's `files`). */
const DOCS_ROOT = 'content/docs';
const PACKAGES_DIR = 'packages';

/**
 * Per-app documentation trees, `apps/<app>/docs/**` (objectui#6600).
 *
 * That card measured the hole: the three doc gates all rooted at `content/docs`,
 * so `apps/console/docs/**` — the console's operator and deployment guides — was
 * read by NO doc gate. The only check whose surface contained those files was
 * `check:control-bytes`, which enumerates `git ls-files` and therefore covers
 * every tracked text file, i.e. they were checked for control bytes and for
 * nothing else. What accumulated there is objectui#6599: a guide that had drifted
 * far enough that following it literally rebuilt the ungated telemetry init
 * objectui#5522 deliberately removed, plus a fabricated CSP section and two env
 * vars with zero read sites. Nothing mechanical could have noticed any of it.
 *
 * The walk is `apps/<app>/docs`, one level of app directory and no deeper before
 * the
 * `docs` segment. `apps/site/app/docs` is a Next.js ROUTE directory holding
 * `.tsx` route files, not a documentation tree; a `**`-shaped walk that picked it
 * up would be collecting routes.
 *
 * Exported so the equality is checked rather than hoped for: three gates carry
 * this constant and `check-doc-fence-languages.test.ts` pins all three copies.
 */
export const APP_DOCS = { dir: 'apps', subdir: 'docs' };

/** Every `apps/<app>/docs` directory that exists, in a stable order. */
export function appDocsDirs(root) {
  const appsDir = join(root, APP_DOCS.dir);
  if (!existsSync(appsDir)) return [];
  const out = [];
  for (const entry of readdirSync(appsDir).sort()) {
    const docs = join(appsDir, entry, APP_DOCS.subdir);
    if (existsSync(docs) && statSync(docs).isDirectory()) out.push(docs);
  }
  return out;
}

/**
 * Pages at the repository ROOT that join the scan set by name.
 *
 * objectui#7115. Between this gate's surface (`content/docs` + the package
 * READMEs) and `check-doc-component-types.mjs`'s (`content/docs` alone AT THE
 * TIME — it has since taken the package-README leg too, objectui#8115), the
 * root `README.md` fell through: the most-read authored file in the repository —
 * the GitHub landing page and the npm page for the workspace — was read by NO
 * doc gate at all. It taught the unregistered type `stat-card` four times in its
 * flagship example for as long as the example existed.
 *
 * Adding the name here is what makes the file VISIBLE to this gate's accounting.
 * Whether its snippets compile is a separate question answered, as for every
 * other document, by `UNGATED_DOCS` below: covered by default, and opted out
 * only with a written, re-derived reason. That distinction is objectui#5174's,
 * quoted in the header — a document outside the walk is "neither covered NOR
 * declared ungated", which is strictly worse than a named debt.
 *
 * A name here that does not resolve is a failed run, not a quiet skip: see the
 * check in `main`.
 *
 * Exported so the equality is checked rather than hoped for: three gates now
 * carry this array, and `check-doc-fence-languages.test.ts` pins all three
 * against each other.
 */
export const ROOT_PAGES = ['README.md'];

/** Page extensions collected under `DOCS_ROOT`. BOTH are collected, and that is
 *  the whole content of the scan surface: `content/docs` is authored in a mix of
 *  `.mdx` and `.md` — the same guide tree, the same renderer, the same reader —
 *  and an extension is not a coverage decision. Collecting only `.mdx` is how
 *  objectui#5174 happened: 40 `.md` guides sat outside the ledger, so they were
 *  neither covered nor declared ungated, which is precisely the silent skip the
 *  fragment rule below exists to prevent. Anything else under the tree (`.json`
 *  sidecars) holds no prose and is not a page. */
const DOC_EXTENSIONS = ['.mdx', '.md'];

/**
 * The repository-root `docs/` tree, at its TOP LEVEL only (objectui#7856, card 1).
 *
 * objectui#7856 measured the hole the same way objectui#7115 measured the root
 * `README.md`'s: `docs/` is an authored-documentation directory that NO doc gate
 * read — not this one, not `check-doc-fence-languages`, not
 * `check-doc-component-types`, and not `lint:root`, whose script literally passes
 * `--ignore-pattern 'docs/**'`. Three phantom-teaching sites (objectui#7838,
 * objectui#7854) were found in it by hand, which is the only instrument that was
 * ever pointed at it.
 *
 * `recursive: false` is the whole design of this leg, and it is a boundary rather
 * than an optimisation. The tree's SUBDIRECTORIES are a different review route:
 * `docs/adr/**` is a GOVERNED surface (`GOVERNED_SURFACES` id `adr` in
 * `check-governed-queue-guard.mjs`, so a pull request touching it stops in draft
 * for a human to merge) and `docs/audits/**` travels with it as objectui#7856's
 * card 2. A `**`-shaped walk here would pull 29 more diagnostics from those two
 * trees into a gate whose failures a non-governed pull request is expected to
 * fix (26 + 3, as objectui#7856 measured them on `8507a2283`) — which is how a
 * widening turns into a change nobody can land. The same
 * reasoning, in the same words, as `APP_DOCS`' "one level of app directory and no
 * deeper": a scan surface says where it stops.
 *
 * So the enumeration below is by DIRECTORY ENTRY and filtered to FILES, and that
 * is what made card 2 an edit a reviewer sees rather than a side effect of a page
 * being moved into a subdirectory: the two subtrees arrived as `ADR_DOCS` and
 * `AUDIT_DOCS` below, LEDGER-FIRST, and this leg is byte-for-byte the leg card 1
 * landed. Re-measured on the current tree, the diagnostics that paragraph
 * predicted are exactly the ones they brought — which is why they arrived on the
 * ledger instead of in front of a pull request expected to fix them.
 *
 * Exported — the constant and the enumerator both — so a sibling census can ask
 * this gate what its leg contains instead of re-spelling it. That is what
 * `check-doc-fence-languages.test.ts` does: `check-doc-fence-languages` does NOT
 * carry this leg (its walk is `check:doc-fences`' own surface, and moving it is
 * not objectui#7856 card 1), and that pin subtracts exactly this set rather than
 * a hand-written list of the two filenames.
 */
export const ROOT_DOCS = { dir: 'docs', recursive: false };

/**
 * Every page at the top level of `ROOT_DOCS.dir`, in a stable order.
 *
 * An absent directory yields `[]` here so a throwaway fixture tree stays
 * listable, exactly as `ROOT_PAGES` does; `main` refuses to publish a verdict
 * when the directory is missing from a REAL run, because a leg that silently
 * collects nothing is objectui#7115's defect one level up.
 */
export function rootDocsPages(root) {
  const dir = join(root, ROOT_DOCS.dir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .sort()
    .filter(
      (entry) =>
        DOC_EXTENSIONS.some((ext) => entry.endsWith(ext)) && statSync(join(dir, entry)).isFile(),
    )
    .map((entry) => `${ROOT_DOCS.dir}/${entry}`);
}

/**
 * The two subtrees BELOW that top level (objectui#7856, card 2).
 *
 * Card 1 stopped at `docs/`'s top level and said why: `docs/adr/**` is a GOVERNED
 * surface (`GOVERNED_SURFACES` id `adr` in `check-governed-queue-guard.mjs`, so a
 * pull request touching it stops in draft for a human to merge) and
 * `docs/audits/**` travels with it. A `**`-shaped walk from `docs/` would have
 * pulled both into a gate whose failures a non-governed pull request is expected
 * to fix — "which is how a widening turns into a change nobody can land".
 *
 * Card 2 is that landing, and it arrives LEDGER-FIRST rather than repair-first.
 * The 2026-09-07 triage ruling on objectui#7856 is the reason, and it is a
 * statement about the DOCUMENTS rather than about cost:
 *
 *     `docs/audits/**` are dated audit snapshots — records of what was true on
 *     their date. "Repairing" a code block inside one falsifies the record,
 *     exactly as it would inside an ADR.
 *
 * So an ADR's or an audit's block is not a block this gate may ask an author to
 * fix on its own authority. What the widening buys is the objectui#5174
 * distinction and nothing more: a document inside the walk and named on the
 * ledger is a KNOWN debt with a measured count, where a document outside the walk
 * is "neither covered NOR declared ungated" — invisible to this gate's own
 * accounting, which is strictly worse. Paying the debt down is a separate,
 * per-record decision for whoever owns the record.
 *
 * `recursive: true` here, against `ROOT_DOCS`' `false`, and the asymmetry is the
 * point rather than an inconsistency. Card 1's leg is non-recursive because its
 * subdirectories are a DIFFERENT review route; these two legs ARE that route, so
 * inside them there is nothing left to stop above. A page filed under
 * `docs/adr/superseded/` tomorrow travels into the walk by itself instead of
 * falling silently out of it — which is objectui#7115's defect, one level down.
 *
 * ⚠️ Where the walk still stops, stated rather than left to be read off the
 * collector: a THIRD subdirectory of `docs/` — one that is neither of these two —
 * is in no leg, exactly as `docs/adr` was before this card. `docs/screenshots/`
 * is today's example and holds no page (it is `.png`), so the gap is currently
 * empty; a new prose subtree under `docs/` is an edit to this file that a
 * reviewer sees, never a side effect of a directory being created.
 *
 * Exported — the constants and the enumerators both — so a sibling census can ask
 * this gate what its legs contain instead of re-spelling them, which is what
 * `check-doc-fence-languages.test.ts` does: that guard does NOT gain these legs
 * (its walk is `check:doc-fences`' own surface, and moving it is not this card),
 * and its walk-equality pin subtracts these enumerators BY IMPORT rather than a
 * hand-written list of today's fifteen filenames.
 */
export const ADR_DOCS = { dir: 'docs/adr', recursive: true };
export const AUDIT_DOCS = { dir: 'docs/audits', recursive: true };

/**
 * Every page under one subtree constant, in a stable order.
 *
 * `recursive` is READ here rather than being a comment on the constant: a flag a
 * reader can see and the walk ignores is the same false friend as a count nothing
 * re-derives. Directories are visited at their own alphabetical position, files
 * are filtered to `DOC_EXTENSIONS`, and an absent tree yields `[]` so a throwaway
 * fixture stays listable — `main` refuses to publish a verdict when one of these
 * directories is missing from a REAL run, for the reason `ROOT_DOCS`' guard
 * states.
 */
function subtreeDocPages(root, tree) {
  const base = join(root, tree.dir);
  if (!existsSync(base) || !statSync(base).isDirectory()) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (tree.recursive) walk(p);
        continue;
      }
      if (DOC_EXTENSIONS.some((ext) => entry.endsWith(ext)))
        out.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(base);
  return out;
}

/** Every page under `ADR_DOCS.dir`, in a stable order. */
export function adrDocsPages(root) {
  return subtreeDocPages(root, ADR_DOCS);
}

/** Every page under `AUDIT_DOCS.dir`, in a stable order. */
export function auditDocsPages(root) {
  return subtreeDocPages(root, AUDIT_DOCS);
}

/**
 * The package-README leg, at EVERY depth (objectui#7308).
 *
 * The leg above this one — `packages/<name>/README.md` — was stated in this
 * header's SCAN SURFACE paragraph as if the one level were the specification,
 * so this was never implementation drift: the specification itself was drawn
 * too small, and a page one directory deeper was "neither covered NOR declared
 * ungated" — objectui#5174's phrase for the state that is strictly worse than a
 * named debt, arriving here one directory down instead of one level up.
 *
 * Re-derived on `9ba7e9c3`, naming the population in words each time: of the 43
 * tracked files under `packages/` whose basename is `README.md`, 39 sit at a
 * package root and 4 sit deeper, so 4 pages were in no gate's accounting. They
 * are not private notes — `packages/types` lists the whole of `src/` in its
 * manifest `files`, so `packages/types/src/zod/README.md` is inside the npm
 * tarball a reader downloads.
 *
 * objectui#6026 closed exactly this hole, on exactly these four files, in the
 * sibling gate `check-doc-links` — same defect, same count, different gate. This
 * is that fix arriving here.
 *
 * ### Why this is its own leg rather than a `recursive` flag on the one above
 *
 * Two reasons, and the first is the same one `ADR_DOCS` / `AUDIT_DOCS` carry: a
 * divergence between this gate's walk and `check-doc-fence-languages`' has to be
 * something a pin can SUBTRACT by import rather than a hand-written list of
 * today's four filenames, so the guard's walk-equality test keeps failing on any
 * OTHER drift. The second is objectui#6026's own no-double-parse guarantee,
 * inherited structurally: this leg is rooted at the SUBdirectories of each
 * package, so a package's own top-level `README.md` is not inside any of them
 * and cannot be collected twice. Nothing here has a notion of "top level".
 *
 * ### ⚠️ Why the skip set is load-bearing, measured rather than assumed
 *
 * Every other recursive leg in this file walks an authored tree with nothing
 * generated inside it. `packages/` is not that tree. Under pnpm each package has
 * its own `node_modules/` holding SYMLINKS to its workspace siblings, and
 * `statSync` follows symlinks — so `packages/a/node_modules/@object-ui/b` leads
 * back into `packages/b`, whose own `node_modules` leads onward. Measured on
 * `9ba7e9c3` with the workspace installed: an unguarded recursive walk does not
 * merely overshoot, it does not TERMINATE; capped at depth 12 it had already
 * reached 17,354 files named `README.md`, against the 43 the repository tracks.
 * With `UNSCANNED_DIRS` applied the walk yields exactly 43 — the tracked
 * population, to the file.
 */
export const NESTED_PACKAGE_READMES = { dir: PACKAGES_DIR, name: 'README.md', recursive: true };

/**
 * Directory names this file's `packages/` walk never enters.
 *
 * The same set, for the same reason, that `check-doc-links.mjs` walks its own
 * disk surfaces with (`UNSCANNED_DIRS` there): none of these holds authored
 * prose — they hold installed dependencies and build output — and the first of
 * them is what makes the walk above terminate at all.
 */
const UNSCANNED_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', '.git']);

/**
 * Every `README.md` strictly BELOW a package's own root, in a stable order.
 *
 * An absent `packages/` yields `[]` so a throwaway fixture tree stays listable,
 * exactly as the legs above do.
 *
 * Exported so a sibling census can ask this gate what this leg contains instead
 * of re-spelling it — which is what `check-doc-fence-languages.test.ts` does: the
 * fence guard does NOT carry this leg (moving `check:doc-fences`' surface is not
 * this card), and its walk-equality pin subtracts this enumerator BY IMPORT.
 */
export function nestedPackageReadmePages(root) {
  const base = join(root, NESTED_PACKAGE_READMES.dir);
  if (!existsSync(base) || !statSync(base).isDirectory()) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (!UNSCANNED_DIRS.has(entry)) walk(p);
        continue;
      }
      if (entry === NESTED_PACKAGE_READMES.name) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  for (const entry of readdirSync(base).sort()) {
    const pkg = join(base, entry);
    if (!statSync(pkg).isDirectory()) continue;
    // Rooted at each package's SUBdirectories: the package's own README.md is
    // not inside any of them, so the leg above cannot double-collect it.
    for (const sub of readdirSync(pkg).sort()) {
      const p = join(pkg, sub);
      if (statSync(p).isDirectory() && !UNSCANNED_DIRS.has(sub)) walk(p);
    }
  }
  return out;
}

/** Fence languages treated as compilable TypeScript. `js` / `jsx` are NOT in the
 *  set: they are not type-annotated, so a strict program judges them on rules
 *  their authors never opted into. */
const TS_FENCE_LANGUAGES = new Set(['ts', 'tsx', 'typescript']);

/**
 * ── What the three doc gates own, and what nothing owns (objectui#6600) ──────
 *
 * Stated once, here, because this gate has the widest surface and holds the
 * coverage ledger below. The other two headers state their own roots and point
 * at this block.
 *
 *   root                        fences · snippets · types
 *   ─────────────────────────── ─────────────────────────
 *   content/docs/**                 ✓        ✓       ✓
 *   apps/<app>/docs/**              ✓        ✓       ✓     objectui#6600
 *   README.md                       ✓        ✓       ✓     objectui#7115
 *   packages/<name>/README.md       ✓        ✓       ✓     objectui#7896 / #8115
 *   nested packages README.md       ✗        ✓       ✗     objectui#7308
 *   docs/*.md (top level only)      ✗        ✓       ✗     objectui#7856 card 1
 *   docs/adr/**                     ✗        ✓       ✗     objectui#7856 card 2
 *   docs/audits/**                  ✗        ✓       ✗     objectui#7856 card 2
 *
 * The three `docs/` rows and the nested-README row are the legs THIS gate carries
 * alone, and the asymmetry is deliberate rather than an oversight to be tidied up
 * later: objectui#7856
 * card 1 moves this gate's population only, so `check-doc-fence-languages` and
 * `check-doc-component-types` keep the surface they had. `check-doc-fence-
 * languages.test.ts` therefore no longer compares the two walks for equality
 * flat — it subtracts exactly `rootDocsPages()` and compares the rest, so the
 * divergence is named and bounded instead of being a list that silently drifted.
 * Card 2 EXTENDS that subtraction with `adrDocsPages()` and `auditDocsPages()`
 * rather than rewriting it — which is why card 1 exported its enumerator in the
 * first place. ⛔ The two subtrees are their own rows, never this one: a leg says
 * where it stops, and `docs/adr/**` being GOVERNED is the reason the boundary
 * between the rows is worth a line of code rather than a comment.
 *
 * objectui#7308's nested-README row extends that same subtraction with
 * `nestedPackageReadmePages()` — a fourth enumerator, imported rather than
 * re-spelled — for the reason card 1 exported its own: moving `check:doc-fences`'
 * surface is not this card's to do, so the divergence is NAMED and every OTHER
 * drift between the two walks still fails that pin.
 *
 * ⚠️ This paragraph used to state the opposite of the row above, and the reason
 * it gave was measured FALSE rather than merely going stale: it said
 * `check-doc-component-types` does not read the package READMEs because "a
 * package README teaches its own package's API rather than the schema
 * vocabulary". Those READMEs teach `type` literals in the schema vocabulary by
 * the hundred, they ship to npm inside each package's `files`, and until
 * objectui#7896's fourth leg landed (objectui#8115) their `type` literals were
 * read twice by this gate and `check-doc-fence-languages` and judged by neither
 * — objectui#7115's geometry one directory over, which that gate's own
 * `PACKAGE_READMES` docblock records with the measurement that proved it.
 *
 * ⇒ The remaining asymmetries are the four rows carrying a `✗`, and they are
 * legs THIS gate holds alone rather than a question about vocabularies.
 *
 * ⚠️ EVERYTHING ELSE authored in markdown is read by no doc gate at all. That is
 * a statement of what the roots are today, ⛔ not a plan and not a promise. In
 * descending order of size, the unscanned population is: non-README `.md` under
 * `packages/**`, at any depth, which stays the largest of them — objectui#7308
 * brought the nested `README.md` files in and NOTHING else; the PUBLISHED
 * `skills/objectui/**`; the root pages that are not `README.md` (`AGENTS.md`,
 * `CONTRIBUTING.md`, `ROADMAP.md` and the rest); `examples/**`; the `apps/**`
 * pages that are not under an `apps/<app>/docs/` tree; `.claude/**`;
 * `.github/**`; and `patches/**`. The ephemeral `.changeset/` is excluded as
 * noise rather than counted as debt.
 *
 * ⛔ Deliberately NO count is written here, neither a total nor a per-tree one.
 * That is not laziness, it is objectui#7448's defect avoided at the source: a
 * hand-copied number in a header drifts from the tree and nothing fails when it
 * does, which is the same lesson `UNGATED_DOCS`'s own header records after both
 * halves of its `12 .mdx pages and 32 package READMEs` went stale ("a pointer to
 * the list now rather than a copy of its length"). The first draft of THIS block
 * proved the point inside a single pull request: it said 114, counting the three
 * `apps/<app>/docs/` guides that the very same change was bringing under the
 * gates.
 * The command below is the durable answer, and it answers both "how many" and
 * "which":
 *
 *     git ls-files '*.md' '*.mdx' \
 *       | grep -vE '^(content/docs/|apps/[^/]+/docs/|packages/.*README\.md$|README\.md$|docs/[^/]+\.mdx?$|docs/adr/|docs/audits/|\.changeset/)'
 *
 * ⚠️ A subdirectory of `docs/` that is NEITHER `adr/` NOR `audits/` is in no leg
 * and therefore still in that population — the exclusion above names the two
 * subtrees rather than `docs/`, so a third one shows up in the command's output
 * on the day it is created. Today there is none carrying prose
 * (`docs/screenshots/` is images), which is exactly why it is written down now
 * rather than discovered later.
 *
 * ⛔ `skills/objectui/**` is NOT claimed by any gate here, and this line is the
 * opposite of a claim on it: it is a governed, published surface with its own
 * review path, so pointing a doc gate at it is a decision for whoever owns that
 * surface — never a side effect of a root move. Writing an unscanned tree down
 * is what keeps it a KNOWN debt; a tree nobody names is objectui#5174's
 * "neither covered NOR declared ungated", which is strictly worse.
 *
 * Documents whose snippets are NOT compiled, each with the reason. The default
 * is covered; this list is the debt, by name, and it can only shrink.
 *
 * ⚠️ The ledger holds objectui#7856 card 2 and NOTHING ELSE, and the distinction
 * matters more than the length. It had reached zero — objectui#5174's finished
 * state, every document the collector reached sitting in the covered tier — and
 * card 2 did not re-open it by parking a page that failed. It re-opened it because
 * the two subtrees it brought into the walk are RECORDS: an ADR states what was
 * decided on a date, an audit states what was true on a date, and the 2026-09-07
 * triage ruling on objectui#7856 drew the consequence in one line —
 *
 *     "Repairing" a code block inside one falsifies the record, exactly as it
 *     would inside an ADR.
 *
 * ⇒ For those two subtrees the ledger is not a deferral of the work, it IS the
 * work: the honest terminal state for a block nobody may rewrite is a named debt
 * carrying a measured number, not a green. Every entry below therefore says what
 * was measured, when, and — unlike every entry that came before it — that paying
 * it down is a decision for whoever owns the record rather than a task waiting
 * for a spare afternoon.
 *
 * ⚠️ The counts in those entries are DATED MEASUREMENTS, not re-derived values,
 * and this ledger's own rule about numbers applies to them: nothing fails when
 * one goes stale. What IS re-derived every run is the part that matters — the
 * entry must name a document in the scan set that really holds a `ts` / `tsx`
 * block, so an entry cannot outlive its subject. Re-measure with the gate's own
 * analyzer (`analyze({ ungated: {} })` + `compileSnippets()`) against the built
 * closure; do not hand-count fences.
 *
 * ⛔ None of that licenses a NEW entry outside those two subtrees. For every
 * other document the default is still COVERED, a new entry is still new debt, and
 * it still owes a reason that says WHAT would have to change. There were 19 `.md`
 * entries under `content/docs` when that
 * card made them visible — the collector reads `.md`, and an entry with a measured
 * reason is what a page that cannot pass yet is owed — and the card then walked
 * every one of them, then the `.mdx` pages, then the package READMEs, and last the
 * root `README.md`, back OFF this list rather than re-wording their reasons. Each
 * page left by compiling, never by softening this gate.
 *
 * ⛔ This list is NOT an invitation to park the next page that fails. A new
 * entry is new debt and owes the same thing every entry above owed: a reason that
 * says WHAT would have to change, measured on the page rather than estimated. The
 * sentence this replaces carried the literal `12 .mdx pages and 32 package
 * READMEs` until objectui#5174's batch 7, by which point BOTH halves had drifted;
 * nothing fails on a stale number written here, which is why no count is written
 * here at all.
 *
 * Batch 1 took ten: `api/schema-reference`, `plugins/index`, and the `guide/` pages
 * `architecture-overview`, `deployment`, `expressions`, `notifications`,
 * `public-forms`, `schema-overview`, `troubleshooting` and `user-state-persistence`
 * — clearing 90 diagnostics. Batch 2 took four more — `guide/plugins`,
 * `guide/building-crud-app`, `rfcs/0001-clipboard-paste` and `guide/architecture`
 * — clearing 89. Batch 3 took three — `guide/plugin-development`,
 * `guide/schema-rendering` and `guide/theming` — clearing 81. Batch 4 took the
 * final pair, `guide/component-registry` (59) and `guide/layout` (45), clearing
 * 104. Each page reached zero the honest two ways — a block
 * that should compile was made self-contained against the built `dist/`, and a
 * block that genuinely cannot compile got a `FRAGMENT_MARKER` declaration with a
 * written reason. Nothing about this gate's strictness moved to get them there.
 *
 * Batch 4 in the same terms as the batches below: 32 blocks brought under the gate
 * — 23 declared fragments and 9 that compile, of which 5 already compiled untouched
 * and 4 were edited to. Its defect was in the page's ONE complete copy-paste
 * example: `guide/component-registry`'s `RatingComponent` calls `useState` while
 * importing only `forwardRef` from `react`, so the block a reader is invited to
 * take whole was broken at the first hook. The same block took `cn` from the
 * reader's own `@/lib/utils` alias when `@object-ui/components` exports `cn`
 * itself. Two things this gate CANNOT see on that page, stated because a green run
 * must not be read as more than it is: `ComponentRegistry` is a `Registry<any>`, so
 * `register()`'s component argument is `any` and no registered component's props
 * are checked against what `SchemaRenderer` passes; and `BaseSchema` carries
 * `[key: string]: any`, so a wrong key on a `BaseSchema`-shaped literal is
 * structurally invisible here. What IS sealed — and therefore really checked —
 * is `ComponentMeta`, `ComponentInput`, `NavItem`, `NavGroup`, `AppShellProps` and
 * `SidebarNavProps`; every literal of those six on the two pages was measured
 * clean, the `lucide-react` blocks by probing them with the icon import shimmed
 * rather than by inferring it from the TS2307 that hid them.
 *
 * Batch 2's two routes in proportion, because the ratio is the reviewable part: it
 * brought 42 blocks under the gate — 34 declared fragments and 8 that compile, of
 * which 4 already compiled untouched and 4 were edited to. Three of those four
 * edits were genuine documented-API defects the ledger had been hiding, and they
 * are why a page like `guide/architecture` was worth covering rather than
 * declaring wholesale: `building-crud-app`'s REST adapter
 * passed `QueryParams['$orderby']` — a four-shape union — straight into
 * `URLSearchParams.set`, which takes a string; its `TaskDetail` component used
 * `SchemaRenderer` with no import of its own; and `guide/architecture`'s section
 * titled "Type Safety", marked `// ✅ Type-checked`, set `ButtonSchema.onClick` to
 * the STRING `'handleClick'` where the declared type is `() => void | Promise<void>`.
 * The pages that are mostly fragments are mostly fragments for a stated reason:
 * Batch 3 in the same terms: 38 blocks brought under the gate — 26 declared
 * fragments and 12 that compile, of which 7 already compiled untouched and 5 were
 * edited to. Its defect was the largest single one this card has surfaced, and it
 * was hidden the way objectui#5138 describes: `guide/theming`'s three `Theme`
 * objects were annotated `Theme` but the annotation itself errored (`Theme` was
 * never imported in two of them), so TypeScript never excess-checked the literals
 * underneath. With the annotation resolving, the `brand` palette alone had TEN of
 * its fourteen `colors` keys off `ColorPalette` — `"primary-foreground"`,
 * `foreground`, `muted`, `ring`, `destructive` and the other `*-foreground` pairs
 * are Shadcn CSS VARIABLE names, not palette keys — plus `radius` and `fonts`,
 * neither of which is a `Theme` key, and no `label`, which is required. Every one
 * of those is dropped in silence at runtime: `generateColorVars` iterates
 * `COLOR_TO_CSS_MAP`, so it can only ever emit the keys `ColorPalette` declares.
 * The pages were teaching theme JSON most of which the engine ignores. The fix
 * routes them through the two doors that do work — the real palette keys, each
 * annotated with the variable it emits, and `customVars` for the rest, which the
 * engine emits verbatim as `--<key>: <value>`.
 *
 * `guide/plugin-development` also had the documented Vitest example asserting
 * `toBeInTheDocument()` with no `@testing-library/jest-dom` import, the matcher's
 * own package — a reader copying that test got neither the types nor the matcher.
 *
 * The pages that are mostly fragments are mostly fragments for a stated reason:
 * `guide/plugin-development` walks the reader through building a plugin package,
 * so its blocks import `./types` and `./BoardImpl` — files the reader has just
 * been told to write — and `guide/theming` quotes the published `Badge` source,
 * which imports `class-variance-authority`, a peer that resolves in the reader's
 * app but is not a root dependency here.
 * `guide/plugins` and the clipboard-paste RFC document packages the reader is being
 * taught to create, and an RFC's signature excerpts have no bodies by design.
 * `guide/layout` is the same shape as `guide/theming`, one layer out: four of its
 * nine blocks import `lucide-react` for the icon COMPONENTS `NavItem.icon` takes,
 * and that package — a dependency of ten workspace packages here, including
 * `@object-ui/layout` — is not a root dependency, so the specifier does not resolve
 * in this program. Hoisting a package to the repo root to buy a doc snippet
 * coverage is a real dependency edge, so those blocks are declared instead, with
 * what sits underneath them measured (via a shimmed icon import) rather than left
 * unknown. `guide/component-registry`'s six category lists were markdown BULLET
 * LISTS inside `tsx` fences — the fence language was the defect there rather
 * than anything in the blocks, so they were declared here and left to their own
 * change. objectui#5997 (PR #6056) then made that change: the six fences are
 * plain markdown bullet lists on the page now, which takes those blocks out of
 * the ts/tsx population this gate collects at all, so the six `FRAGMENT_MARKER`
 * declarations came out with them — a marker on a block the gate no longer
 * collects is debt nothing would ever fail to prompt the removal of. The entry
 * stays here because this ledger keeps the record of why each declaration
 * existed, not because the page still carries them.
 *
 * Batch 5 (objectui#9412) paid down objectui#7308's three NESTED package-README
 * rows, the whole of that card's debt half. Re-derived first on `8196b10631`
 * with this gate's own analyzer, the rows temporarily lifted — `analyze({ ungated
 * })` for the population, `compileSnippets()` for the phases, over the closure
 * `--build-filter` names (35/35 turbo tasks successful) — and every figure the
 * rows recorded on `9ba7e9c3` still held: 20 blocks, 13 failing (3 syntax-phase,
 * 10 semantic), 37 diagnostics, split across the pages exactly as written. In
 * the same runs the sentinel produced TS2305, the positive control 0, and both
 * bound controls TS2307, so the zeros below are readings from a program that
 * demonstrably reports non-zero.
 *
 * Its defect was the one objectui#7308 named first, and it is the kind this gate
 * exists for: `packages/core/src/adapters/README.md`'s custom-adapter template
 * declared `implements DataSource<T>` while omitting `getObjectSchema` (TS2420),
 * and wrote `// Your implementation` as the whole body of six methods annotated
 * non-`void` (TS2355 x6). A reader who copied it got a class that does not
 * satisfy the interface it claims. The template now implements all six REQUIRED
 * members — `find`, `findOne`, `create`, `update`, `delete`, `getObjectSchema` —
 * and each unimplemented body throws rather than falling off the end, so the
 * reader's class type-checks at every step of filling it in.
 *
 * Routes, in the two the batches above established: 19 blocks compile (the two
 * `{ ... }` elisions on the zod page written as real initialisers, six excerpts
 * given their own imports or a `declare const` stand-in, one before/after fence
 * split into the two programs it was really holding, and the shape sketch
 * re-fenced ```text, which takes it out of the ts/tsx population), and ONE block
 * is a declared fragment: `packages/components/src/__tests__/README.md`'s
 * "Adding New Tests" pattern. Both of its specifiers were measured refused in
 * this program before the marker was written — `vitest` is the ROOT-DECLARED
 * control specifier itself, so the row's own first remedy ("the block imports
 * `describe`/`it`/`expect` from `vitest`") produces a `[bound]` failure by
 * construction, and `./test-utils` is TS2307 because every block compiles at the
 * repository root while that helper is suite-local and unshipped
 * (`@object-ui/components` lists `dist` in `files`, and `dist/` holds no
 * `test-utils`). The row anticipated exactly that and named the marker as its
 * alternative. The block imports the two specifiers anyway, because they are the
 * ones a file in that directory really writes, and a stand-in would have taught a
 * spelling nobody should copy; the marker costs no coverage here, since the block
 * imports no documented package surface at all.
 *
 * ⚠️ One claim in the retired zod row was FALSE and is corrected rather than
 * carried forward: it said `packages/types` "lists the whole of `src/` in its
 * manifest `files`", so `src/zod/README.md` ships in the npm tarball. It does
 * not. That manifest's `files` is `['dist', 'README.md', 'CHANGELOG.md',
 * 'LICENSE']`, and `npm pack --dry-run --json` in that package reports 134
 * entries, none of them under `src/` and exactly one README — the package-root
 * one. The page was still worth clearing, on the reason every other row here
 * gives: it is a page a reader copies from. It is not worth clearing because it
 * ships, and a later card should not plan around that.
 *
 * objectui#5343 then read that list back and cleared it for the getting-started
 * pages: no entry for `content/docs/guide/**` or for
 * `content/docs/api/schema-reference.md` names a missing export any more. Every
 * symbol those pages documented now exists on the built `dist/index.d.ts`, so
 * their reasons record what each fabricated name BECAME instead. objectui#5360
 * then closed out the last one. `content/docs/utilities/index.md` named
 * `ObjectStackProvider` (@object-ui/data-objectstack) — a React context provider
 * on a package that is headless — and that page LEFT this ledger rather than
 * getting a re-measured reason: it holds exactly ONE ts/tsx block, so rewriting
 * that block against the real surface (`createObjectStackAdapter` injected
 * through `@object-ui/react`'s `SchemaRendererProvider`, the shape PR #4129 had
 * already established on the sibling `content/docs/utilities/data-objectstack.mdx`)
 * retired the two undefined-name diagnostics in the same stroke and took the page
 * to zero. No entry on this list names a missing export any more.
 *
 * The reasons are deliberately concrete about WHAT would have to change, because
 * "does not compile" is three different jobs: a page whose snippets reference
 * ambient names it never defines needs the blocks made self-contained (or
 * declared fragments); a page whose ```ts fences hold bare object literals needs
 * the fence language corrected to `json`; a page whose snippets are genuinely
 * wrong needs the documented API fixed. Only the third is a defect this gate
 * would report, and telling them apart is per-page work.
 *
 * @type {Record<string, string>}
 */
const UNGATED_DOCS = {
  // objectui#7308's three nested-package-README rows were PAID DOWN by
  // objectui#9412 and are gone from this object. Their record is in the header
  // above, under "Batch 5"; nothing was softened here to retire them.
  // objectui#7856 card 2. Measured on `fedfa3e4` with this gate's own analyzer
  // against the closure `--build-filter` names (35/35 turbo tasks successful):
  // `analyze({ ungated: {} })` for the population, `compileSnippets()` for the
  // phases. Four records, five `ts` blocks, 29 diagnostics — 21 syntax-phase and
  // 8 semantic — split 26 under `docs/adr/**` and 3 under `docs/audits/**`.
  //
  // ⚠️ Read the syntax-phase entries for what they do NOT say. A block that fails
  // to PARSE never enters the semantic program, so its semantic half is not "0",
  // it is UNMEASURED — the count in each entry is the whole of what is known, and
  // making such a block parse is the only way to learn what else is wrong with it.
  // That is a fact about the instrument, and it is also the reason a marker would
  // buy nothing here: an ungated document is not compiled at all, so a
  // `FRAGMENT_MARKER` inside one of these records would declare a block that this
  // gate already never reads — "a marker on a block the gate no longer collects is
  // debt nothing would ever fail to prompt the removal of", one level up. ⇒ Card 2
  // wrote no marker and edited no record.
  //
  // ⛔ TERMINAL STATE — these four rows are not a debt anybody may pay down.
  // Maintainer ruling A on objectui#8363 (director seat, decision batch #88,
  // 2026-09-08): a code block inside an ADR or a dated audit is a SPECIMEN of what
  // was decided or measured, never an example to copy. ⇒ ⛔ No record below is
  // edited to make it compile, and ⛔ no row is deleted to "clear" the ledger — a
  // row leaves only with the record it names. New ADRs and audits state the
  // convention instead (CONTRIBUTING.md): a specimen block is fenced `plaintext`,
  // which this gate does not compile, so this list does not grow.
  // ⚠️ Nothing else is relaxed: each of the four still owes its written reason and
  // is still re-derived every run against a document that really holds a block.
  'docs/adr/0001-master-detail-subform.md':
    '2 `ts` blocks (fences 142, 211), 15 diagnostics, ALL syntax-phase: TS1005 x5, TS1109 x8, TS1011 x1 — ' +
    'the semantic half is unmeasured, not clean. Both blocks are schema SKETCHES written in prose ' +
    'TypeScript — bare object literals at statement position, `?:` optionality markers written on values, ' +
    "`[...]` elisions, and `'create' | 'edit'` standing where a value goes. What would have to change: each " +
    'sketch rewritten as a real annotated declaration resolving against the shipped `dist/*.d.ts`, or its ' +
    'fence relabelled to a language this gate does not compile. Neither is this gate\'s to do: ADR-0001 is ' +
    'the dated record of an accepted decision (2026-06-05), and a sketch edited until it compiles is a ' +
    'record that no longer says what was decided (objectui#7856 triage, 2026-09-07).',
  'docs/adr/0036-field-conditional-rules.md':
    '1 `ts` block (fence 178), 3 diagnostics, ALL syntax-phase: TS1005 x2, TS1109 x1 — the semantic half is ' +
    'unmeasured, not clean. The block is a fragment of a field map: three `Field.*` property assignments ' +
    'with no surrounding object and no import, which TypeScript reads as labelled statements. What would ' +
    'have to change: the excerpt wrapped in the declaration it is excerpted FROM and `Field` imported, ' +
    'which edits what ADR-0036 shows it decided (accepted 2026-06-07) rather than repairing it — the record ' +
    'is the excerpt, so a bigger excerpt is a different record.',
  'docs/adr/0057-console-ai-chat-one-conversation-docked.md':
    '1 `ts` block (fence 192), 8 diagnostics, ALL semantic-phase: TS7006 x1, TS7031 x3, TS7053 x1, TS2304 x3 ' +
    '— the ONE block in either subtree that parses, so this is the only entry here whose number is complete. ' +
    'The block is the ADR\'s resolver sketch: unannotated parameters and a destructured options bag ' +
    '(implicit any), and three helpers it names but does not define (`isBuildAgent`, `resolveAgentParam`, ' +
    '`resolveDefaultAgentName`). What would have to change: parameter types written and the three helpers ' +
    'imported from wherever the console ships them. ⚠️ That is a repair this gate could describe and must ' +
    'not ask for: ADR-0057 is accepted and IMPLEMENTED IN FULL (2026-07-13), so its sketch is the record of ' +
    'the resolver that was agreed, and typing it against today\'s console would silently restate the record ' +
    'as whatever shipped.',
  'docs/audits/2026-07-objectview-detailview-schema.md':
    '1 `ts` block (fence 66), 3 diagnostics, ALL syntax-phase: TS1005 x3 — the semantic half is unmeasured, ' +
    'not clean. The block is a shape excerpt of the ADR-0047 container: a bare brace-delimited list of ' +
    '`key: Schema` pairs, which is a block statement rather than an object literal. What would have to ' +
    'change: the excerpt given a declaration to be the initialiser of, and the four schema names imported. ' +
    '⛔ Ungoverned is not the same as safe to repair: this is a DATED audit snapshot (2026-07) of what the ' +
    'two schemas were at `@objectstack/spec` 16.1.0, so editing the excerpt to compile against today\'s ' +
    'types would make the record assert something it never measured (objectui#7856 triage, 2026-09-07).',
};

// ── Fence scanning ───────────────────────────────────────────────────────────

/**
 * One level of blockquote marker: the `>` a Markdown blockquote puts in front of
 * every line it contains — the fences and the code between them alike. At most one
 * space after the marker is consumed, per CommonMark, so indentation that belongs
 * to the snippet survives the strip.
 */
const QUOTE_MARKER = /^[ \t]*>[ \t]?/;

/**
 * `line` with `depth` levels of blockquote marker removed. `depth === 0` returns
 * the line unchanged, byte for byte; that identity path is what keeps every
 * unquoted fence in the corpus collecting exactly as it did before. A line that
 * runs out of markers early is returned as far as it stripped, which bounds a
 * lazily-continued blockquote instead of letting its fence run to end of file.
 */
function stripQuotePrefix(line, depth) {
  let out = line;
  for (let d = 0; d < depth; d++) {
    const m = QUOTE_MARKER.exec(out);
    if (!m) break;
    out = out.slice(m[0].length);
  }
  return out;
}

/**
 * How many levels of blockquote `line` opens with, read with the same prefix
 * shape the fence opener matches — so a marker's depth and its fence's depth are
 * counted by one rule and cannot disagree.
 */
function quoteDepthOf(line) {
  // Every quantifier here is `*`, so the match cannot fail and there is no
  // no-match branch to write: an empty prefix IS depth 0.
  return (/^[ \t]*(?:>[ \t]*)*/.exec(line)[0].match(/>/g) ?? []).length;
}

/**
 * Whether `line` is blank AT `depth`: empty, or nothing left once the blockquote
 * markers carrying the quote down the callout are stripped. A bare `>` is the
 * spacer a callout puts between its prose and its fence, and `'>'.trim()` is
 * `'>'`, not the empty string — so without this the marker attachment walk stops
 * on that spacer and a quoted declaration can never reach the block it declares.
 * `depth === 0` is `line.trim() === ''`, the same test the walk used before.
 */
function isBlankAtDepth(line, depth) {
  return stripQuotePrefix(line, depth).trim() === '';
}

/**
 * The declaration a fragment carries; see FRAGMENT_MARKER_EXAMPLES. Matched
 * against the line with its blockquote markers stripped, so a marker written
 * inside the callout its block lives in registers exactly as an unquoted one
 * does; the depth it was written at is kept, and `scanFences` requires it to
 * equal the depth of the fence it declares.
 */
const FRAGMENT_MARKER =
  /^[ \t]*(?:\{\/\*|<!--)[ \t]*doc-snippet:[ \t]*fragment[ \t]*(?:—|--|-|:)[ \t]*(.+?)[ \t]*(?:\*\/\}|-->)[ \t]*$/;

const MIN_REASON_LENGTH = 12;

/**
 * A claim, inside a fragment's written reason, that the block HAS BEEN checked
 * against something. See the header section "A fragment's reason says why it
 * cannot compile" for why the combination is refused and why an exemption list
 * is not on offer.
 *
 * A closed list of verbs, not a phrase hunt. The authority the claim names
 * ("against the shipped `dist/index.d.ts`") is deliberately NOT part of the
 * match: `content/docs/plugins/plugin-calendar.mdx` says its block "cannot
 * compile against the SHIPPED prop type", which names the same authority to
 * state the OPPOSITE — that nothing agrees. Anchoring on the verb keeps that
 * reason legal and costs nothing, because a claim without a verb is not a claim.
 *
 * `checked` carries a `(?<!-)` guard so a hyphenated compound only matches when
 * this list names it: `hand-checked` is a claim, `type-checked` is this gate's
 * own verb (see the header).
 */
const VERIFICATION_CLAIM = new RegExp(
  [
    '(?:hand|spot|cross|double|eye|re)-checked',
    'manually[ \\t]+checked',
    '(?<!-)\\bchecked\\b',
    '\\bverified\\b',
    '\\bconfirmed\\b',
    '\\bvalidated\\b',
    '\\baudited\\b',
    '\\breconciled\\b',
  ].join('|'),
  'i',
);

/**
 * The marker, spelled out. Quoted as strings because a JavaScript block comment
 * cannot contain the `*` + `/` these examples end with — which is exactly why the
 * header points here instead of showing them itself. Both forms are inert in
 * their own renderer: the MDX form is an expression comment, the HTML form is an
 * HTML comment, and neither reaches the reader.
 */
export const FRAGMENT_MARKER_EXAMPLES = [
  '{/* doc-snippet: fragment \u2014 why this block cannot compile */}',
  '<!-- doc-snippet: fragment \u2014 why this block cannot compile -->',
];

/**
 * Every fenced block in one document, with the ts/tsx ones marked. Fences are
 * matched by their own run length so a ```` ```` ```` wrapper containing ``` does
 * not confuse the walk, and a block's opening info string is kept verbatim.
 *
 * A fence opened inside a blockquote is collected too. Its opener's quote depth
 * is carried to the search for its closing fence and stripped from every body
 * line, so the compiler sees the snippet the reader sees and not the `>` around
 * it. Depth 0 — every unquoted fence — takes the identity path and scans exactly
 * as it did before blockquotes were recognised.
 *
 * A fragment marker reaches those blocks at the same depth: it is read through
 * the quote prefix, the walk that attaches it treats a bare `>` as blank, and it
 * declares only a fence at its own depth. Both halves of the gate's contract —
 * compile, OR declare why you cannot — therefore apply inside a blockquote. Only
 * ONE of them reaching there would leave a quoted block that legitimately cannot
 * compile with no way to say so (objectui#7099), and widening the marker anchor
 * alone would not fix it: the walk would still stop on the `>` spacer that
 * separates a callout's prose from its fence, which is the shape real pages use.
 */
export function scanFences(source) {
  const lines = source.split('\n');
  const blocks = [];
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    const markerDepth = quoteDepthOf(lines[i]);
    const marker = FRAGMENT_MARKER.exec(stripQuotePrefix(lines[i], markerDepth));
    if (marker)
      markers.push({ line: i + 1, depth: markerDepth, reason: marker[1].trim(), consumed: false });
    const open = /^([ \t]*(?:>[ \t]*)*)(`{3,})(.*)$/.exec(lines[i]);
    if (!open) continue;
    const ticks = open[2];
    const depth = (open[1].match(/>/g) ?? []).length;
    let close = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const c = /^[ \t]*(`{3,})[ \t]*$/.exec(stripQuotePrefix(lines[j], depth));
      if (c && c[1].length >= ticks.length) {
        close = j;
        break;
      }
    }
    const info = open[3].trim();
    const language = (info.split(/\s+/)[0] || '').toLowerCase();
    if (TS_FENCE_LANGUAGES.has(language)) {
      // The marker must be the nearest non-blank line above the fence, and must
      // be written at the fence's own quote depth. Blankness is judged at that
      // depth, so the walk crosses a callout's bare `>` spacer; the depths must
      // match, because a depth-0 marker above a quoted fence sits outside the
      // callout the block lives in, and a quoted marker above an unquoted fence
      // sits inside one the block is not in. Neither declares that block.
      let k = i - 1;
      while (k >= 0 && isBlankAtDepth(lines[k], depth)) k--;
      const above = k >= 0 ? markers.find((m) => m.line === k + 1 && m.depth === depth) : undefined;
      if (above) above.consumed = true;
      blocks.push({
        fenceLine: i + 1,
        language,
        quoteDepth: depth,
        body: lines
          .slice(i + 1, close)
          .map((line) => stripQuotePrefix(line, depth))
          .join('\n'),
        fragmentReason: above ? above.reason : null,
      });
    }
    i = close;
  }
  return { blocks, markers };
}

/** Every document in the scan set, in a stable order. */
export function listDocuments(root = repoRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (DOC_EXTENSIONS.some((ext) => entry.endsWith(ext)))
        out.push(relative(root, p).split(sep).join('/'));
    }
  };
  const docsRoot = join(root, DOCS_ROOT);
  if (existsSync(docsRoot)) walk(docsRoot);
  // Per-app docs trees, in the same slot the fence guard appends them in — the
  // coupling pin compares the two lists element by element.
  for (const dir of appDocsDirs(root)) walk(dir);
  const pkgDir = join(root, PACKAGES_DIR);
  if (existsSync(pkgDir)) {
    for (const entry of readdirSync(pkgDir).sort()) {
      const readme = join(pkgDir, entry, 'README.md');
      if (existsSync(readme)) out.push(relative(root, readme).split(sep).join('/'));
    }
  }
  // Every README.md BELOW a package root (objectui#7308), its own leg so the
  // fence guard's walk-equality pin can subtract exactly this set by import.
  out.push(...nestedPackageReadmePages(root));
  // The root `docs/` tree, TOP LEVEL only (objectui#7856 card 1). Enumerated by
  // directory entry and filtered to files by `rootDocsPages`, so `docs/adr/**`
  // (governed) and `docs/audits/**` cannot arrive through THIS leg by accident —
  // they arrive through their own, immediately below, which is card 2.
  out.push(...rootDocsPages(root));
  // The two subtrees below it (objectui#7856 card 2), each its own leg for the
  // same reason the leg above is not recursive: a scan surface says where it
  // stops, and these two say it separately from the tree that contains them.
  out.push(...adrDocsPages(root));
  out.push(...auditDocsPages(root));
  // Root pages last, by name. An absent one is dropped here so a throwaway
  // fixture tree stays listable; `main` refuses to publish a verdict when one is
  // missing from a real run, which is the only place that can bite.
  for (const name of ROOT_PAGES) {
    if (existsSync(join(root, name))) out.push(name);
  }
  return out;
}

// ── Where the types come from: the BUILT artifacts, derived per run ──────────

/**
 * `paths` for the snippet program, derived from each workspace package's own
 * `exports` / `types` — the entry a consumer resolves. Every target must EXIST:
 * a missing one means the package is unbuilt, which is reported as its own
 * failure rather than as sixty broken snippets.
 */
export function derivePackageTypePaths(root = repoRoot) {
  const paths = {};
  const packageDirOf = {};
  /**
   * Packages whose declared types are SOURCE, not a built artifact —
   * `@object-ui/test-support` points `types` at `src/index.ts`. Such an entry is
   * deliberately kept OUT of `paths`: silently mapping it would judge a snippet
   * against code no consumer resolves, which is the exact substitution this gate
   * exists to make impossible. A covered snippet that imports one is reported.
   */
  const sourceTyped = {};
  const pkgDir = join(root, PACKAGES_DIR);
  for (const entry of readdirSync(pkgDir).sort()) {
    const manifestPath = join(pkgDir, entry, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest.name) continue;
    packageDirOf[manifest.name] = `${PACKAGES_DIR}/${entry}`;
    const record = (specifier, relPath) => {
      if (typeof relPath !== 'string') return;
      const abs = join(pkgDir, entry, relPath.replace(/^\.\//, ''));
      if (!/[\\/]dist[\\/].*\.d\.ts$/.test(abs)) {
        sourceTyped[specifier] = relative(root, abs).split(sep).join('/');
        return;
      }
      paths[specifier] = [abs];
    };
    const exportsField = manifest.exports;
    if (exportsField && typeof exportsField === 'object') {
      for (const [subpath, target] of Object.entries(exportsField)) {
        if (!target || typeof target !== 'object') continue;
        const specifier =
          subpath === '.' ? manifest.name : `${manifest.name}${subpath.replace(/^\./, '')}`;
        record(specifier, target.types);
      }
    } else {
      record(manifest.name, manifest.types || manifest.typings);
    }
  }
  return { paths, packageDirOf, sourceTyped };
}

/** A declaration file, in any of the three spellings a package may ship. */
const DECLARATION_FILE = /\.d\.(ts|mts|cts)$/;
/** Any path inside a workspace package's `src/` — never a surface a reader gets. */
const WORKSPACE_SRC = /[\\/]packages[\\/][^\\/]+[\\/]src[\\/]/;
/** Never written to disk: only a location to resolve FROM, inside a package. */
const DEPENDENCY_PROBE_FILE = '__doc-snippet-dependency-probe__.ts';

/**
 * The specifiers a package REQUIRES of its consumer: its `peerDependencies`,
 * minus any the manifest itself marks optional in `peerDependenciesMeta`.
 *
 * The subtraction is the whole point. An OPTIONAL peer is precisely the case
 * the map's old `dependencies`-only reason described — "a requirement ON the
 * consumer that may be unmet" — because a consumer is entitled to not have it
 * and the package still works. A REQUIRED peer is a different statement: the
 * package declares it cannot function without it, installers act on that, and a
 * consumer who has not supplied it has an install the package itself calls
 * broken. Only the second class is mapped.
 */
export function requiredPeerSpecifiers(manifest = {}) {
  const meta = manifest.peerDependenciesMeta || {};
  return Object.keys(manifest.peerDependencies || {})
    .filter((specifier) => (meta[specifier] || {}).optional !== true)
    .sort();
}

/**
 * `paths` for the THIRD-PARTY specifiers a covered snippet may legitimately
 * import: for each workspace package a covered document imports, every specifier
 * that package DECLARES in its own `dependencies` or REQUIRES of its consumer in
 * its own `peerDependencies`, resolved from inside that package's directory —
 * which is exactly what the package's own code resolves, and exactly what a
 * consumer who can use that package at all has in their own tree.
 *
 * The rule and its edges are stated in this file's header, including the reason
 * the peer half was added and the class it admits; the three things enforced
 * right here are that the set is read from MANIFESTS (never from a walk of
 * `node_modules`), that a mapping may only ever land on a declaration file
 * outside any package's `src/`, and that the peer half runs in a SECOND pass so
 * it can only add specifiers, never re-own or re-resolve one `dependencies`
 * already backs. A specifier that ships no types is left unresolvable and
 * reported as such, never mapped to something approximate: the snippet importing
 * it then fails, which is the honest answer.
 */
export function deriveDeclaredDependencyPaths(root = repoRoot, importedPackages = [], packageDirOf = {}) {
  const paths = {};
  const declaredBy = {};
  const declaredIn = {};
  const untyped = [];
  const seen = new Set();
  const options = {
    module: COMPILER_OPTIONS.module,
    moduleResolution: COMPILER_OPTIONS.moduleResolution,
  };
  const host = ts.createCompilerHost(options, false);
  // Sorted, so which package wins a specifier two of them declare is decided by
  // name rather than by walk order — a run must not depend on readdir.
  const owners = [];
  for (const owner of [...importedPackages].sort()) {
    const dir = packageDirOf[owner];
    if (!dir) continue;
    const manifestPath = join(root, dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    owners.push({ owner, dir, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) });
  }
  const consider = (owner, dir, specifier, field) => {
    // A workspace package is mapped from its OWN `exports` by
    // `derivePackageTypePaths`, and one deliberately left unmapped there
    // (source-typed) must STAY unmapped — routing it through a node_modules
    // symlink would judge a snippet against a package's `src/`, the exact
    // substitution this gate exists to make impossible.
    if (specifier in packageDirOf) return;
    if (seen.has(specifier)) return;
    seen.add(specifier);
    const resolved = ts.resolveModuleName(
      specifier,
      join(root, dir, DEPENDENCY_PROBE_FILE),
      options,
      host,
    );
    const file = resolved.resolvedModule ? resolved.resolvedModule.resolvedFileName : null;
    // A REQUIRED peer this workspace cannot resolve to a declaration file is
    // left unresolvable exactly as an untyped `dependencies` entry is, and for
    // the same reason: mapping it to something approximate would report green
    // over a snippet nobody type-checked. The field is recorded so the report
    // can say which half of the rule the entry came from.
    if (!file || !DECLARATION_FILE.test(file) || WORKSPACE_SRC.test(file)) {
      untyped.push({ specifier, owner, field, resolved: file });
      return;
    }
    paths[specifier] = [file];
    declaredBy[specifier] = owner;
    declaredIn[specifier] = field;
  };
  // TWO passes, not one per owner, and the order is the whole of their meaning:
  // every specifier ANY imported package installs in its own `dependencies` is
  // decided before the first peer is looked at, so the peer half can only ever
  // ADD a specifier no `dependencies` entry already backs. It can neither move
  // an existing mapping to another owner's directory nor change what an
  // existing one resolves to.
  for (const { owner, dir, manifest } of owners) {
    for (const specifier of Object.keys(manifest.dependencies || {}).sort()) {
      consider(owner, dir, specifier, 'dependencies');
    }
  }
  for (const { owner, dir, manifest } of owners) {
    for (const specifier of requiredPeerSpecifiers(manifest)) {
      consider(owner, dir, specifier, 'peerDependencies');
    }
  }
  // `seen` is exactly the set of non-workspace specifiers the imported packages
  // DECLARE — in either field this map reads — whether or not each one could be
  // mapped. The UNDECLARED control reads it to tell its two failure modes apart:
  // a control specifier that has become a declared dependency (pick another) is
  // a different fact from one that resolves without any manifest declaring it
  // (resolution has widened). It covers required peers too, so the control
  // cannot be quietly satisfied by a field the map now reads.
  return { paths, declaredBy, declaredIn, untyped, declared: [...seen].sort() };
}

/**
 * How many of the mapped specifiers arrived through the PEER half of the rule.
 *
 * Printed on every run beside the total, because a widening nobody can read off
 * the gate's own output is the silent drift the header's edge refuses. A reader
 * of a green run can see how much of this map rests on "the reader must already
 * have it" rather than on "the package ships it", and a jump in that number is
 * visible without opening a manifest.
 */
export function peerMappedCount(state = {}) {
  return Object.values(state.dependencyDeclaredIn || {}).filter((field) => field === 'peerDependencies')
    .length;
}

/**
 * Where a package is physically installed in this workspace, found WITHOUT
 * assuming it resolves from anywhere in particular: pnpm's virtual store holds
 * one directory per (package, version, peer-set), named with `/` replaced by `+`.
 * Used by both controls, which must never confuse "this specifier does not
 * resolve" with "this package is not installed" — the second proves nothing
 * about how far resolution reaches.
 *
 * The store is the WORKSPACE root's (`virtualStorePath`), not `root`'s: under
 * the objectstack monorepo `root` is `ui/`, whose `node_modules` holds only the
 * symlinks of its own manifest's dependencies, and the store every installed
 * copy lives in is one level up (objectstack#25733). Standalone the two are the
 * same directory. A tree no `pnpm-workspace.yaml` governs has nothing installed
 * in it, so the answer there is `null`, the same as a missing store.
 */
export function findInstalledCopy(root = repoRoot, specifier = '') {
  let storeDir;
  try {
    storeDir = virtualStorePath(root);
  } catch {
    return null;
  }
  if (!existsSync(storeDir)) return null;
  const prefix = `${specifier.replace(/\//g, '+')}@`;
  for (const entry of readdirSync(storeDir).sort()) {
    if (!entry.startsWith(prefix)) continue;
    const candidate = join(storeDir, entry, 'node_modules', ...specifier.split('/'));
    if (existsSync(join(candidate, 'package.json'))) {
      return relative(root, candidate).split(sep).join('/');
    }
  }
  return null;
}

/**
 * The bare-specifier ROOT: `lucide-react/dynamic` -> `lucide-react`, and a
 * scoped `@playwright/test/foo` -> `@playwright/test`. Package manifests and
 * `node_modules` are both keyed on this, so every question about "what does the
 * root declare" and "what does the map cover" is asked about it.
 */
export function specifierRoot(specifier) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

/**
 * Every specifier the repository ROOT's own manifest declares — `dependencies`
 * and `devDependencies` together.
 *
 * Both, deliberately, though this repository's root declares only the second
 * today: the bound is "what makes it into the root's `/node_modules`", and pnpm
 * links both fields there. Reading only the field that happens to be populated
 * would leave a rule that silently reopens the day someone adds the other one.
 */
export function rootDeclaredSpecifiers(root = repoRoot) {
  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) return new Set();
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return new Set([
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {}),
  ]);
}

/**
 * The JSX factory modules, which the bound never refuses.
 *
 * They are the ONE module the compiler imports on the author's behalf: every
 * block is compiled with `jsx: ReactJSX`, so a block containing a single JSX tag
 * needs `react/jsx-runtime` whether or not its author wrote an import at all.
 * Refusing it would red a block for a line nobody wrote and no reader could fix,
 * and it would do so unevenly — measured while `react` reached the map through
 * one package's `dependencies` and the skills corpus imported no such package,
 * so the same JSX tag was bounded in one gate and not in the other. That
 * asymmetry is gone now the map reads REQUIRED peers (every React package here
 * declares one), which removes the unevenness rather than the exemption: the
 * bound is a rule about what an AUTHOR may import, and whether the compiler can
 * find its own JSX factory is a different question that TS2875 already answers
 * loudly. `react/jsx-runtime` is a SUBPATH, and the map covers bare specifiers
 * only, so it would still be refused without this.
 *
 * Exempted at BOTH enforcement points, so the block-level check and the resolver
 * cannot disagree about one specifier.
 */
const JSX_RUNTIME_SPECIFIERS = new Set(['react/jsx-runtime', 'react/jsx-dev-runtime']);

/**
 * THE BOUND, as one predicate (see the header section that names it): a bare
 * specifier that nothing in the `paths` map covers and that the repository ROOT
 * declares reaches a snippet ONLY through this workspace's own installation, so
 * it is refused.
 *
 * Relative and absolute specifiers are never bounded, and neither is one the map
 * covers — a specifier both the root and a mapped package declare reaches the
 * reader through the package they install, so the root's copy is not what backs
 * it and mapping wins.
 */
export function resolvesOnlyThroughRootManifest(specifier, { paths = {}, rootDeclared = new Set() } = {}) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return false;
  if (JSX_RUNTIME_SPECIFIERS.has(specifier)) return false;
  if (specifier in paths) return false;
  const bare = specifierRoot(specifier);
  if (bare in paths) return false;
  return rootDeclared.has(bare);
}

/**
 * Every module specifier one parsed block imports, from the AST rather than from
 * a regex over the text.
 *
 * Parsing, never a regex, for the reason the corpus keeps proving: an
 * import-shaped line inside a template literal or a prose sample is not an
 * import, and a regex over 456 blocks finds those too (measured while this bound
 * was being derived: a `npm install project-name` line inside a README example's
 * template literal read as an import of `project-name`). A false refusal would
 * red a document that is correct, which is the failure this whole file is most
 * careful about.
 */
export function moduleSpecifiersOf(sourceFile) {
  const out = new Set();
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.add(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      out.add(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...out];
}

/**
 * Every module specifier ONE BLOCK BODY imports — the parse and the walk
 * together, so that BOTH gates read imports through this one function and
 * cannot answer the question differently.
 *
 * ⚠️ It replaces two copies of a regex reader, one per gate, and both were
 * wrong the same way: prose is part of the corpus, so an import-shaped line
 * inside a template literal or a string was read as an import. Measured on
 * this corpus (objectui#7555): `content/docs/plugins/plugin-markdown.mdx`
 * carries a README sample whose template literal holds `npm install
 * project-name`, and the regex reported `project-name` as a specifier that
 * block imports. Nothing in that block imports anything. Both consumers
 * survived it by luck rather than by construction — a false name matters to
 * `neededPackages` only if it happens to equal a workspace package, and it
 * reaches the skills gate's `Unmapped specifiers` line, which since
 * objectui#7463 item 2 is the REPORT of what the AST-derived root bound
 * refuses, so a regex-derived line and an AST-derived refusal could disagree.
 *
 * ⚠️ Parsed as TSX, matching `compileSnippets` — a reader walking a different
 * tree from the one `tsc` judges would answer about a program nobody compiled.
 * `createSourceFile` never throws, so a block too broken to parse yields no
 * specifiers here and is caught by the syntax leg instead.
 */
export function moduleSpecifiersOfBlock(body) {
  return moduleSpecifiersOf(
    ts.createSourceFile(
      'block.tsx',
      body,
      ts.ScriptTarget.ES2020,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    ),
  );
}

// ── The run ──────────────────────────────────────────────────────────────────

const SENTINEL_EXPORT = 'ThisNameIsDefinitelyNotExported';
const CONTROL_PACKAGE = '@object-ui/types';
// `BaseSchema` since objectui#4895: the control needs a name `@object-ui/types`
// really exports, and the previous choice, `ComponentSchema`, was retired with
// the whole block schema family. A control that names a deleted export fails the
// harness rather than the documents — which is exactly what it did, loudly, and
// is how this line was found.
const CONTROL_REAL_EXPORT = 'BaseSchema';

/**
 * The UNDECLARED control's specifier (see the header). Three properties make it
 * the right one, and all three are ASSERTED at run time rather than trusted:
 * it is installed in this workspace (a transitive of `@radix-ui/react-popover`,
 * which `@object-ui/components` declares), it is declared by no package in this
 * repository at all, and it ships real `.d.ts` files — so if resolution ever did
 * widen to reach it, the control module would compile CLEANLY rather than fail
 * for some unrelated reason. It is the difference between "the rule is narrow"
 * and "we hope the rule is narrow".
 */
const UNDECLARED_CONTROL_PACKAGE = '@floating-ui/react-dom';

/**
 * The ROOT-DECLARED control's specifier (see the header). The same three
 * properties are asserted at run time rather than trusted: this repository's
 * ROOT `package.json` declares it (so pnpm symlinks it into `/node_modules` and
 * it is exactly the reach the bound closes), no `paths` entry covers it (a
 * mapped specifier resolves through the map and would prove nothing about the
 * root), and it is installed and ships real `.d.ts` files — so if the bound ever
 * stopped being applied, the control module would compile CLEANLY rather than
 * fail for some unrelated reason.
 */
const ROOT_DECLARED_CONTROL_PACKAGE = 'vitest';

const COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true,
  forceConsistentCasingInFileNames: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  lib: ['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
};

const VIRTUAL_DIR = '.doc-snippet-probe';

export function analyze({ root = repoRoot, ungated = UNGATED_DOCS } = {}) {
  const findings = [];
  const documents = listDocuments(root);
  const documentSet = new Set(documents);

  // ── ledger: re-derived, never trusted ─────────────────────────────────────
  const scans = new Map();
  for (const doc of documents) {
    scans.set(doc, scanFences(readFileSync(join(root, doc), 'utf8')));
  }
  for (const [doc, reason] of Object.entries(ungated)) {
    if (!documentSet.has(doc)) {
      findings.push({ reason: 'stale-ungated-entry', site: doc, detail: 'no such document in the scan set' });
      continue;
    }
    if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
      findings.push({ reason: 'unexplained-ungated-entry', site: doc, detail: 'an entry with no written reason is not a declaration' });
    }
    if (scans.get(doc).blocks.length === 0) {
      findings.push({ reason: 'stale-ungated-entry', site: doc, detail: 'document holds no ts/tsx fenced block' });
    }
  }

  // ── fragment markers: local, and never dangling ───────────────────────────
  for (const doc of documents) {
    const { markers, blocks } = scans.get(doc);
    for (const marker of markers) {
      if (!marker.consumed) {
        findings.push({
          reason: 'stale-fragment-marker',
          site: `${doc}:${marker.line}`,
          detail: 'a fragment marker must sit immediately above a ts/tsx fence',
        });
      }
    }
    if (doc in ungated) continue;
    for (const block of blocks) {
      if (block.fragmentReason === null) continue;
      if (block.fragmentReason.length < MIN_REASON_LENGTH) {
        findings.push({
          reason: 'unexplained-fragment',
          site: `${doc}:${block.fenceLine}`,
          detail: 'a fragment declaration must say why the block cannot compile',
        });
      }
      const claim = VERIFICATION_CLAIM.exec(block.fragmentReason);
      if (claim) {
        findings.push({
          reason: 'verification-claim-on-fragment',
          site: `${doc}:${block.fenceLine}`,
          detail:
            `a DECLARED fragment is never compiled, so this gate cannot re-verify "${claim[0]}" on any ` +
            'later commit — the claim goes silently false the day the thing it names changes. Say why ' +
            'the block cannot compile without asserting it was checked, or move the block into the ' +
            'compiled tier, where the claim becomes one this gate re-verifies on every commit.',
        });
      }
    }
  }

  const covered = documents.filter((d) => !(d in ungated));
  const compiled = [];
  const declaredFragments = [];
  for (const doc of covered) {
    for (const block of scans.get(doc).blocks) {
      (block.fragmentReason === null ? compiled : declaredFragments).push({ doc, ...block });
    }
  }

  // ── the packages those snippets import must be BUILT ──────────────────────
  const { paths, packageDirOf, sourceTyped } = derivePackageTypePaths(root);
  const neededPackages = new Set();
  for (const block of compiled) {
    for (const specifier of moduleSpecifiersOfBlock(block.body)) {
      const owner = Object.keys(packageDirOf).find(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );
      if (owner) neededPackages.add(owner);
    }
  }
  for (const name of [...neededPackages].sort()) {
    if (sourceTyped[name]) {
      findings.push({
        reason: 'source-typed-package',
        site: packageDirOf[name],
        detail: `${name} declares its types at ${sourceTyped[name]} — source, not a built artifact. A covered snippet may not be judged against it.`,
      });
      continue;
    }
    const entry = paths[name];
    if (!entry || !existsSync(entry[0])) {
      findings.push({
        reason: 'unbuilt-package',
        site: packageDirOf[name],
        detail: `${name} declares types at ${entry ? relative(root, entry[0]) : '(none)'} and it is not on disk — run the build first`,
      });
    }
  }

  // ── and what THOSE packages declare resolves too, exactly that far ────────
  const {
    paths: dependencyPaths,
    declaredBy: dependencyDeclaredBy,
    declaredIn: dependencyDeclaredIn,
    untyped: untypedDependencies,
    declared: declaredSpecifiers,
  } = deriveDeclaredDependencyPaths(root, neededPackages, packageDirOf);
  // Workspace entries win every collision: a workspace package is mapped from
  // its own `exports`, and one deliberately left unmapped stays unmapped.
  const mergedPaths = { ...dependencyPaths, ...paths };

  return {
    documents,
    covered,
    compiled,
    declaredFragments,
    findings,
    paths: mergedPaths,
    workspacePaths: paths,
    packageDirOf,
    dependencyPaths,
    dependencyDeclaredBy,
    dependencyDeclaredIn,
    untypedDependencies,
    declaredSpecifiers,
    neededPackages,
    scans,
  };
}

/**
 * Phase 1 (syntax) and phase 2 (semantics), kept apart on purpose.
 *
 * `extraPathsByPackage` is the emitted-manifest half of the bound, and it is
 * keyed by EMITTING PACKAGE (`packages/<dir>`) rather than merged into one map
 * on purpose: a manifest one generator emits says nothing about what another
 * generator's reader installs, and a single merged map would let create-plugin's
 * `vite-plugin-dts` silence a TS2307 in a `packages/cli` template. Empty for the
 * documentation run, whose blocks live under `content/docs/**` and match no key,
 * so that verdict does not move by one byte. See the emitted-census header
 * section "The manifest the emitted file's reader installs".
 */
export function compileSnippets({
  root = repoRoot,
  compiled,
  paths,
  declaredSpecifiers = [],
  extraPathsByPackage = {},
}) {
  const parseFailures = [];
  // THE BOUND (see the header): blocks importing a specifier that reaches them
  // only through the repository root's own manifest. Kept out of the semantic
  // program the way an unparseable block is, so the coverage count stays honest.
  const boundFailures = [];
  const boundedSpecifiers = new Set();
  const rootDeclared = rootDeclaredSpecifiers(root);
  // The global map WINS every collision, the same direction `mergedPaths` above
  // resolves one: a workspace package deliberately left unmapped stays unmapped,
  // and an emitted manifest may only ever ADD a specifier no existing mapping
  // already backs.
  const pathsFor = (block) => {
    const extra = extraPathsByPackage[block.doc.split('/').slice(0, 2).join('/')];
    return extra ? { ...extra, ...paths } : paths;
  };
  const bounded = (specifier, blockPaths = paths) =>
    resolvesOnlyThroughRootManifest(specifier, { paths: blockPaths, rootDeclared });
  const virtual = new Map();
  const owners = new Map();
  /** virtual file -> the `paths` that file's own block is bounded and resolved by. */
  const blockPathsOf = new Map();
  compiled.forEach((block, index) => {
    // Every block is parsed as TSX regardless of the fence label. The corpus
    // labels JSX-bearing snippets `ts`, `tsx` and `typescript` interchangeably,
    // and a JSX element in a `ts` fence is a PARSE error under ScriptKind.TS —
    // which under the never-skip rule above would be reported as a syntax defect
    // in a snippet that is fine. The one construct TSX gives up is the
    // angle-bracket type assertion `<T>value`; `value as T` is the form this
    // repository's own sources and docs use.
    const probe = ts.createSourceFile('probe.tsx', block.body, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
    if (probe.parseDiagnostics && probe.parseDiagnostics.length > 0) {
      parseFailures.push({ block, diagnostics: probe.parseDiagnostics });
      return;
    }
    const blockPaths = pathsFor(block);
    const refused = moduleSpecifiersOf(probe)
      .filter((specifier) => bounded(specifier, blockPaths))
      .sort();
    if (refused.length > 0) {
      for (const specifier of refused) boundedSpecifiers.add(specifierRoot(specifier));
      boundFailures.push({ block, specifiers: refused });
      return;
    }
    const name = join(root, VIRTUAL_DIR, `s${String(index).padStart(4, '0')}.tsx`);
    blockPathsOf.set(name, blockPaths);
    // A block with no top-level import/export is a SCRIPT: its declarations would
    // be globals shared with every other block. Force a module so each block is
    // judged exactly as a reader who copies that one block would experience it.
    const body = ts.isExternalModule(probe) ? block.body : `${block.body}\nexport {};\n`;
    virtual.set(name, body);
    owners.set(name, block);
  });

  const sentinelFile = join(root, VIRTUAL_DIR, '__control_sentinel.ts');
  const positiveFile = join(root, VIRTUAL_DIR, '__control_positive.ts');
  virtual.set(
    sentinelFile,
    `import { ${SENTINEL_EXPORT} } from '${CONTROL_PACKAGE}';\nexport const sentinel = ${SENTINEL_EXPORT};\n`,
  );
  virtual.set(
    positiveFile,
    `import type { ${CONTROL_REAL_EXPORT} } from '${CONTROL_PACKAGE}';\nexport type Control = ${CONTROL_REAL_EXPORT};\n`,
  );
  // A namespace import, so that ANY successful resolution reports zero
  // diagnostics: the control must distinguish "did not resolve" from "resolved",
  // never "resolved but the name I picked happened to be missing".
  const undeclaredFile = join(root, VIRTUAL_DIR, '__control_undeclared.ts');
  virtual.set(
    undeclaredFile,
    `import * as undeclared from '${UNDECLARED_CONTROL_PACKAGE}';\nexport type Undeclared = typeof undeclared;\n`,
  );
  // The bound's own control, read the same way as UNDECLARED's: a namespace
  // import, so ANY successful resolution reports zero diagnostics.
  const rootDeclaredFile = join(root, VIRTUAL_DIR, '__control_root_declared.ts');
  virtual.set(
    rootDeclaredFile,
    `import * as rootDeclared from '${ROOT_DECLARED_CONTROL_PACKAGE}';\nexport type RootDeclared = typeof rootDeclared;\n`,
  );

  const options = { ...COMPILER_OPTIONS, baseUrl: root, paths, types: [] };
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (f) => (virtual.has(f) ? virtual.get(f) : readFile(f));
  host.fileExists = (f) => virtual.has(f) || fileExists(f);
  host.getSourceFile = (f, languageVersion, onError, shouldCreate) =>
    virtual.has(f)
      ? ts.createSourceFile(f, virtual.get(f), languageVersion, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      : getSourceFile(f, languageVersion, onError, shouldCreate);

  // THE BOUND, at the resolver. Scoped to the virtual probe directory: the rule
  // is about what a SNIPPET may import, and a `.d.ts` inside `node_modules`
  // resolving its own imports is not a snippet. Without that scoping the bound
  // would reach into unrelated type graphs and red documents for a reason that
  // has nothing to do with them.
  const probeDir = join(root, VIRTUAL_DIR);
  const resolutionCache = new Map();
  // One options object per DISTINCT block map rather than one per file, so
  // `ts.resolveModuleName`'s own per-options caching stays live. A block with no
  // emitted-manifest map — every documentation block, and every census block in
  // a package that emits none — gets the shared `options` object unchanged, so
  // its resolution is byte-for-byte the one this function performed before the
  // emitted-manifest half existed. The CONTROL files have no entry either, which
  // is what keeps the ROOT-DECLARED control live while a census block beside it
  // legitimately resolves the very same specifier.
  const perBlockOptions = new Map();
  const optionsFor = (containingFile) => {
    const blockPaths = blockPathsOf.get(containingFile);
    if (!blockPaths || blockPaths === paths) return null;
    if (!perBlockOptions.has(blockPaths)) {
      perBlockOptions.set(blockPaths, { ...options, paths: blockPaths });
    }
    return perBlockOptions.get(blockPaths);
  };
  host.resolveModuleNames = (moduleNames, containingFile, _reused, _redirected, compilerOptions) =>
    moduleNames.map((name) => {
      const key = `${containingFile}|${name}`;
      if (resolutionCache.has(key)) return resolutionCache.get(key);
      const scoped = optionsFor(containingFile);
      const resolved = ts.resolveModuleName(
        name,
        containingFile,
        scoped ?? compilerOptions ?? options,
        host,
      ).resolvedModule;
      const inProbeDir = dirname(containingFile) === probeDir;
      // ⚠️ Deliberately NOT added to `boundedSpecifiers`: that set reports what
      // the bound refused THE CORPUS, and the only file that reaches this arm is
      // the ROOT-DECLARED control, which has its own line. Counting the control
      // there would make every run read as though a document had imported it.
      const answer =
        resolved && inProbeDir && bounded(name, blockPathsOf.get(containingFile) ?? paths)
          ? undefined
          : resolved;
      resolutionCache.set(key, answer);
      return answer;
    });

  const program = ts.createProgram([...virtual.keys()], options, host);

  // CONTROL: resolution must land on a built artifact, never on a package's src.
  const resolved = ts.resolveModuleName(CONTROL_PACKAGE, join(root, VIRTUAL_DIR, 'x.ts'), options, host);
  const resolvedFileName = resolved.resolvedModule ? resolved.resolvedModule.resolvedFileName : null;
  const srcLeaks = program
    .getSourceFiles()
    .map((f) => f.fileName)
    .filter((f) => /\/packages\/[^/]+\/src\//.test(f));

  const semanticFailures = [];
  for (const [name, block] of owners) {
    const sf = program.getSourceFile(name);
    const diagnostics = [...program.getSemanticDiagnostics(sf)];
    if (diagnostics.length > 0) semanticFailures.push({ block, diagnostics });
  }

  const sentinelDiagnostics = [...program.getSemanticDiagnostics(program.getSourceFile(sentinelFile))];
  const positiveDiagnostics = [...program.getSemanticDiagnostics(program.getSourceFile(positiveFile))];
  const undeclaredDiagnostics = [...program.getSemanticDiagnostics(program.getSourceFile(undeclaredFile))];
  const rootDeclaredDiagnostics = [...program.getSemanticDiagnostics(program.getSourceFile(rootDeclaredFile))];

  return {
    parseFailures,
    boundFailures,
    boundedSpecifiers: [...boundedSpecifiers].sort(),
    semanticFailures,
    semanticallyJudged: owners.size,
    resolvedFileName,
    srcLeaks,
    sentinelDiagnostics,
    positiveDiagnostics,
    undeclaredDiagnostics,
    undeclaredDeclared: declaredSpecifiers.includes(UNDECLARED_CONTROL_PACKAGE),
    undeclaredInstalledAt: findInstalledCopy(root, UNDECLARED_CONTROL_PACKAGE),
    rootDeclaredDiagnostics,
    rootDeclaredControl: ROOT_DECLARED_CONTROL_PACKAGE,
    rootDeclaredByRoot: rootDeclared.has(ROOT_DECLARED_CONTROL_PACKAGE),
    rootDeclaredMapped: ROOT_DECLARED_CONTROL_PACKAGE in paths,
    rootDeclaredInstalledAt: findInstalledCopy(root, ROOT_DECLARED_CONTROL_PACKAGE),
  };
}

// ── Emitted-code census: what a generator WRITES into someone else's file ────

/**
 * A generator that emits `import` statements is a documentation surface, and
 * nothing compiles it (objectui#7864).
 *
 * Code a generator emits from a template literal under `packages/NAME/src/**` is
 * read by nothing: `tsc` sees a STRING, `tsup` copies it through, and every doc
 * gate's scan surface — this one's `listDocuments()` included — stops at
 * `content/docs`, the per-app docs trees and the package READMEs. The class has
 * two known members. `packages/vscode-extension/src/extension.ts`'s
 * `generateReactComponent()` emitted a phantom `registerDefaultRenderers`
 * import into every file the *Export to React* command ever wrote for a user
 * (fixed by PR objectui#7863, measured there as `tsc` exit 2 / TS2305 on the
 * emitted file); `packages/cli/src/utils/app-generator.ts` is objectui#7472,
 * still open and still unfixed.
 *
 * ⭐ REPORT-ONLY, and the CENSUS is the deliverable. The card's binding
 * constraint, and the same posture `check-doc-expression-carriage.mjs` landed
 * under: objectui#7472's site is a KNOWN UNFIXED member, so a blocking gate on
 * first landing would go red on somebody else's card and turn one card into
 * two. What the population is — how many code-emitting templates exist, how
 * many diagnostics they produce, and how they split by package — is what
 * decides clean-the-corpus versus build-a-ledger, and ⛔ this file does not
 * make that decision.
 *
 * Report-only means it declines to fail on its FINDINGS, never that it passes
 * without looking (objectstack#4928, objectui#4690). A failed harness control,
 * an unbuilt closure or a walk that collapsed is the gate's own
 * `EXIT_CODES.couldNotRun`, loudly — a check that runs, goes green and looked
 * at nothing is the counterfeit this whole file is built against.
 *
 * ## The recogniser: the static heuristic, with the marker kept as its escape
 *
 * Ruling: compile a template only when something says it is code. Three routes
 * were priced.
 *
 *   HEURISTIC  a template whose text contains an `import … from '…'` statement.
 *              Sees the whole class without anybody opting in; can MISFIRE, and
 *              on this corpus it does — `packages/create-plugin/src/templates.ts`
 *              emits a README whose ```tsx fence carries an import, and emits
 *              vite configs importing `vite` and `@vitejs/plugin-react`, which
 *              no documented package declares. Under report-only a misfire
 *              costs a reported line, never a red build.
 *   MARKER     an opt-in comment on the template. Cannot see an unmarked
 *              emitter — and that is disqualifying HERE, not merely weaker:
 *              this card may not touch `app-generator.ts` (objectui#7472 is on
 *              hold), so under a marker route the one site the ruling requires
 *              the census to show RED could not be marked at all, and the
 *              census would report one site and zero diagnostics. A census that
 *              cannot see the member it was filed for measures nothing.
 *   PATH LIST  a hand-kept list of emitting files. Rots silently in the
 *              direction that produces a green over a file nobody added.
 *
 * ⇒ The heuristic is the recogniser. The marker is kept and HONOURED as its
 * escape hatch — a template the heuristic cannot see (it emits a module that
 * imports nothing, or builds its import line out of holes) is opted in by one
 * comment, and the census reports how many templates arrive that way. Kept, and
 * honoured, rather than merely counted: a marker the gate reads and does not
 * act on is a declaration the runtime does not cash, which is the shape
 * AGENTS.md commandment #0.1 refuses. It carries ONE vocabulary with the
 * fragment marker above — `doc-snippet:` — because a second spelling of the
 * same idea is the thing readers stop being able to keep straight.
 *
 * The blind side is reported rather than assumed, every run, because a census
 * that cannot see what it excludes is not a census: the marker population (what
 * the opt-in route alone would have reached) and the count of unrecognised
 * templates that open a top-level `export` (what NEITHER route sees today) are
 * both printed beside the recognised count.
 *
 * ## `${…}` holes, and the one transformation this makes
 *
 * A template's holes are substituted by the placeholder identifier
 * `EMITTED_HOLE_PLACEHOLDER`, and a body that had any gets ONE appended line
 * declaring it. Both halves are load-bearing and both are stated because the
 * snippet compiled is then not byte-identical to what the generator writes:
 *
 *   - The placeholder is an IDENTIFIER because the corpus interpolates in
 *     identifier position as often as in expression position — this repository's
 *     generators write `${vars.pascalName}Plugin` and `const schema =
 *     ${schemaJson};` in the same breath. An expression-shaped placeholder
 *     (`null`, `0 as any`) is a syntax error in the first; an identifier is
 *     legal in both.
 *   - The declaration is APPENDED, never prepended, so every diagnostic's line
 *     number still points at the real source line. `var`, not `const`: a
 *     block-scoped declaration read above its own line is TS2448, which would
 *     be a diagnostic this instrument invented.
 *
 * What the substitution therefore cannot judge, said out loud: whether the
 * VALUE a hole interpolates type-checks where it lands. This census answers
 * only whether the code AROUND the holes does.
 *
 * ## Where it walks
 *
 * `packages/NAME/src/**` — `.ts` and `.tsx` — minus `TOOLING_FILE`, imported from
 * `check-phantom-dependencies.mjs` rather than copied, so tests, mocks,
 * benchmarks and stories drop out by the same rule that file already enforces.
 * The excluded population is COUNTED and printed: a member hiding in a test
 * fixture is a different fact from no member at all.
 *
 * Each recognised template is then compiled through `compileSnippets()` — the
 * same call, the same built `.d.ts` closure, the same root bound, the same
 * controls — so an emitted snippet is judged EXACTLY the way a documentation
 * block is. That is the whole argument for putting this here instead of in a
 * per-package test: the harness already exists, and route B would have bought
 * one template at the cost of real `devDependencies` in a package that builds
 * in 23 ms (objectui#7864's own table).
 *
 * ## The manifest the emitted file's reader installs (objectui#8397)
 *
 * The root bound's sentence is "this specifier reaches the snippet only through
 * this workspace's own installation, not through anything THE EMITTED FILE'S
 * READER INSTALLS". For a document that is total. ⭐ For a GENERATOR its premise
 * can be false, because the same generator also writes the manifest the reader
 * installs — and the census was not reading it. Measured on `324b1d0684`, all
 * three on one generator, `packages/create-plugin/src/templates.ts` — named by
 * the BUILDER rather than by a line, because the filing card's own coordinates
 * had already drifted by the time it was picked up:
 *
 *   buildVitestSetup   [bound]     @testing-library/jest-dom/vitest
 *   buildTestFile      [bound]     @testing-library/react, vitest
 *   buildViteConfig    [semantic]  TS2307 vite-plugin-dts
 *
 * Every one of those six specifiers is declared by `buildPackageJson`, twenty
 * lines above the templates being refused for them. ⚠️ And the third was the
 * WHOLE of the census's `code` class that run — the one diagnostic the summary
 * calls "the only ones that say anything about the emitted code" was an artefact
 * of reading the wrong manifest.
 *
 * ⛔ What this is NOT: an exemption, a ledger, or an allowance list. Nothing is
 * excused from compilation and nothing is skipped — the two refused templates
 * JOIN the semantic program and are judged there. The count that moves is
 * `judged`, upward; `walked`, `recognised` and the blind side are identical.
 * (objectui#8397's standing fence: a change that improves the number by
 * SHRINKING what is measured is the defect, not the fix.)
 *
 * Three properties hold it to that, and each is why the obvious cheaper version
 * was not taken:
 *
 *   1. **The manifest is read, not assumed.** `buildPackageJson` returns an
 *      object rather than a template literal, which the filing card left open as
 *      a possible blocker. It is not one: the census already parses these files
 *      with `ts.createSourceFile`, and `scanEmittedManifests` reads the object
 *      literal out of that same tree. Nothing is executed or imported.
 *   2. **Per EMITTING PACKAGE, never merged.** `create-plugin`'s manifest says
 *      nothing about what a `packages/cli` template's reader installs. One
 *      merged map would have silenced a TS2307 in another generator's template —
 *      the same shape as the failure being fixed, one level up.
 *   3. **Mapped only at an identical declared RANGE.** A specifier is mapped to
 *      the types this workspace resolves for a manifest declaring that same
 *      specifier at that same range string, root or workspace package. A range
 *      this repository does not itself declare stays unresolvable and is
 *      REPORTED. So the census can never judge a template against a version its
 *      reader will not install, and the day the generator's range and this
 *      repository's drift apart the mapping disappears rather than lying.
 *
 * What the census gains it also prints: the manifests found, the specifiers
 * mapped, and — line by line — every specifier an emitted manifest declares that
 * this workspace could not type, which stay bounded. An unreadable entry (a
 * computed range, a spread that leads out of the package) is counted too. This
 * reader's blind side is reported for the same reason the recogniser's is.
 */

/** The tree the census walks: every workspace package's `src/`. */
export const EMITTED_SOURCE_SUBDIR = 'src';

/** Source extensions the walk collects. */
const EMITTED_SOURCE_EXTENSION = /\.tsx?$/;

/**
 * THE RECOGNISER. A template literal whose text carries an `import` statement —
 * either `import … from '…'` (single- or multi-line specifier list) or a bare
 * side-effect `import '…'`.
 *
 * The `from` search is bounded to 300 characters and stops at a `;` on purpose:
 * unbounded, a lazy `[\s\S]*?` would happily reach a `from` hundreds of lines
 * further down a template that has no import at all, and every long template in
 * the corpus would recognise.
 */
export const EMITTED_IMPORT = new RegExp(
  [
    String.raw`(?:^|\n)[ \t]*import[ \t\n][^;]{0,300}?\bfrom[ \t\n]*['"][^'"\n]+['"]`,
    String.raw`(?:^|\n)[ \t]*import[ \t]+['"][^'"\n]+['"]`,
  ].join('|'),
);

/**
 * The opt-in escape, in the fragment marker's own `doc-snippet:` vocabulary.
 * Written on the nearest non-blank line above the template, in either comment
 * form a `.ts` file can carry. Honoured, not merely counted: a template it
 * marks joins the census whether or not the heuristic saw it.
 */
export const EMITTED_MARKER =
  /^[ \t]*(?:\/\/|\/\*)[ \t]*doc-snippet:[ \t]*emits[ \t]+(?:ts|tsx|typescript)\b/;

/** The marker, spelled out — quoted as a string for the reason
 *  `FRAGMENT_MARKER_EXAMPLES` gives: a block comment cannot quote one. */
export const EMITTED_MARKER_EXAMPLE = '/* doc-snippet: emits tsx */';

/**
 * What an unrecognised template has to show for the census to report it as a
 * thing NEITHER route sees: a top-level `export` on its own line. Deliberately
 * narrow — this is a gauge printed beside the recognised count, never a
 * recogniser, and a wide one would report the corpus's SQL, CSS and prose
 * templates as missed code.
 */
const EMITTED_MODULE_SHAPED = /(?:^|\n)[ \t]*export[ \t]+(?:default|const|let|var|function|class|type|interface|async)\b/;

/** The placeholder each `${…}` hole is substituted by. An identifier, because
 *  the corpus interpolates inside identifiers as well as in expression
 *  position. */
export const EMITTED_HOLE_PLACEHOLDER = '__hole__';

/** The one line appended to a body that had holes. `var`, and appended rather
 *  than prepended — see this section's header. */
export const EMITTED_HOLE_DECLARATION = `declare var ${EMITTED_HOLE_PLACEHOLDER}: any;`;

/**
 * Whether a substituted body already DECLARES the placeholder as a name of its
 * own — `export const ${vars.pascalName}` becomes `export const __hole__`, and
 * appending the declaration beside it is TS2395 ("individual declarations in a
 * merged declaration must be all exported or all local"): a diagnostic this
 * instrument would have invented, on a template that is fine.
 *
 * Read from the AST, and only when the body parses: a body that does not parse
 * never reaches the semantic phase, so it needs no declaration either.
 *
 * @param {string} body a hole-substituted template body
 */
export function declaresHolePlaceholder(body) {
  const sf = ts.createSourceFile('hole-probe.tsx', body, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  if (sf.parseDiagnostics && sf.parseDiagnostics.length > 0) return true;
  let found = false;
  const visit = (node) => {
    if (found) return;
    const name = /** @type {{ name?: ts.Node }} */ (node).name;
    if (name && ts.isIdentifier(name) && name.text === EMITTED_HOLE_PLACEHOLDER) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/**
 * Every `.ts`/`.tsx` file under a workspace package's `src/`, split by the rule
 * `check-phantom-dependencies.mjs` already owns.
 *
 * @param {string} root
 * @returns {{ files: string[], excludedAsTooling: string[] }}
 */
export function listEmittedSources(root = repoRoot) {
  const files = [];
  const excludedAsTooling = [];
  const pkgDir = join(root, PACKAGES_DIR);
  if (!existsSync(pkgDir)) return { files, excludedAsTooling };
  for (const entry of readdirSync(pkgDir).sort()) {
    const src = join(pkgDir, entry, EMITTED_SOURCE_SUBDIR);
    if (!existsSync(src) || !statSync(src).isDirectory()) continue;
    const walk = (dir) => {
      for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!EMITTED_SOURCE_EXTENSION.test(name)) continue;
        const rel = relative(root, p).split(sep).join('/');
        (TOOLING_FILE.test(rel) ? excludedAsTooling : files).push(rel);
      }
    };
    walk(src);
  }
  return { files, excludedAsTooling };
}

/**
 * Every template literal in one source file, with its `${…}` holes already
 * substituted — read from the AST, never from a regex over the text, for the
 * same reason `moduleSpecifiersOf` is (objectui#7555): a backtick inside a
 * string, a comment or another template is not a template.
 *
 * A hole's own EXPRESSION is descended into, so a code-emitting template nested
 * inside another template's hole is censused in its own right rather than
 * disappearing into its parent's placeholder.
 *
 * @param {string} source
 * @param {string} fileName
 * @returns {{ line: number, text: string, holes: number }[]}
 */
export function scanEmittedTemplates(source, fileName = 'source.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const templates = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node) => {
    if (ts.isNoSubstitutionTemplateLiteral(node)) {
      templates.push({ line: at(node), text: node.text, holes: 0 });
      return;
    }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        text += EMITTED_HOLE_PLACEHOLDER + span.literal.text;
      }
      templates.push({ line: at(node), text, holes: node.templateSpans.length });
      // The literal parts are already consumed; the holes' expressions are not.
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return templates;
}

/**
 * The census: walk, recognise, substitute, and hand the result to the same
 * `compileSnippets()` a documentation block goes through.
 *
 * Returns counts and blocks; it prints nothing and it decides nothing. The
 * caller reports.
 *
 * @param {{ root?: string }} options
 */
export function emittedCensus({ root = repoRoot } = {}) {
  const { files, excludedAsTooling } = listEmittedSources(root);
  const recognised = [];
  const markerOnly = [];
  const moduleShapedMisses = [];
  let templatesSeen = 0;
  let markerSeen = 0;

  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    const lines = source.split('\n');
    for (const template of scanEmittedTemplates(source, file)) {
      templatesSeen++;
      // The marker is the nearest non-blank line above the template's own line,
      // read the way `scanFences` reads a fragment declaration.
      let k = template.line - 2;
      while (k >= 0 && lines[k].trim() === '') k--;
      const marked = k >= 0 && EMITTED_MARKER.test(lines[k]);
      if (marked) markerSeen++;
      const byHeuristic = EMITTED_IMPORT.test(template.text);
      if (byHeuristic || marked) {
        const entry = { file, ...template, byHeuristic, marked };
        recognised.push(entry);
        if (marked && !byHeuristic) markerOnly.push(entry);
        continue;
      }
      if (EMITTED_MODULE_SHAPED.test(template.text)) {
        moduleShapedMisses.push(`${file}:${template.line}`);
      }
    }
  }

  const blocks = recognised.map((entry) => {
    const substituted = entry.text;
    const needsDeclaration = entry.holes > 0 && !declaresHolePlaceholder(substituted);
    return {
      doc: entry.file,
      // `formatDiagnostic` prints `fenceLine + 1 + line`, because a FENCED
      // block's body starts on the line after its fence. A template literal's
      // body starts ON its backtick's line, so the anchor sits one line earlier
      // and the printed number is the real source line.
      fenceLine: entry.line - 1,
      language: 'tsx',
      quoteDepth: 0,
      fragmentReason: null,
      body: needsDeclaration ? `${substituted}\n${EMITTED_HOLE_DECLARATION}\n` : substituted,
    };
  });

  return {
    files,
    excludedAsTooling,
    templatesSeen,
    markerSeen,
    markerOnly,
    moduleShapedMisses,
    recognised,
    blocks,
  };
}

/**
 * The manifest fields an EMITTED manifest is read for. `peerDependencies` is in
 * the set for the same reason `deriveDeclaredDependencyPaths` reads REQUIRED
 * peers and for no other: a manifest that declares one states its tree cannot
 * work without it, and installers act on that. Optional peers are subtracted by
 * {@link requiredPeerSpecifiers}, which this reader hands its literal to rather
 * than re-implementing.
 */
export const EMITTED_MANIFEST_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

/**
 * What an object literal has to show to be read as a manifest a reader installs:
 * `name` and `version` — the two fields no package.json is a package.json
 * without — plus at least one dependency field spelled as an object literal.
 *
 * Deliberately narrow, and narrow in the safe direction. A literal this misses
 * costs a specifier the bound keeps refusing, which is the status quo and is
 * reported as a refusal. A literal it wrongly ADMITS would widen the bound over
 * a template whose reader installs no such thing, which is the failure the bound
 * exists to prevent — so `name`+`version` is required even though every manifest
 * in this corpus would be found by the dependency fields alone.
 */
const EMITTED_MANIFEST_REQUIRED_FIELDS = ['name', 'version'];

/**
 * Files the emitted-manifest reader parses at all: those whose text mentions
 * `dependencies` in any spelling.
 *
 * A prefilter, never a recogniser. Its only failure mode is a constant the
 * reader cannot follow, which lands in the REPORTED unreadable list — it can
 * never turn into a mapping, so it cannot widen the bound. Without it this
 * reader would re-parse all ~1400 censused sources a second time for the two
 * files in this repository that carry a manifest.
 */
const EMITTED_MANIFEST_PREFILTER = /dependencies/i;

const propertyNameOf = (property) => {
  const name = property.name;
  if (!name) return null;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
};

/**
 * Every `NAME = <object literal | string literal>` an emitting package's sources
 * declare, keyed by name — and ONLY where that name is declared exactly once in
 * the package.
 *
 * Cross-FILE, because the corpus puts them there: `packages/cli` keeps its
 * emitted ranges in `utils/scaffold-dependencies.ts` and spreads them into the
 * manifest literal in `commands/init.ts`, which a same-file reader would see as
 * an unresolvable spread and drop the whole manifest for.
 *
 * Unique-name-gated, because a name two files define is two answers to one
 * question: picking either is a guess, and a guess here maps a specifier to a
 * range the reader may not install. An ambiguous name is REPORTED and followed
 * nowhere — the same direction as every other edge in this file.
 *
 * @param {{ file: string, sourceFile: ts.SourceFile }[]} sources
 */
export function emittedConstantTable(sources) {
  const seen = new Map();
  for (const { file, sourceFile } of sources) {
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const init = node.initializer;
        if (
          ts.isObjectLiteralExpression(init) ||
          ts.isStringLiteral(init) ||
          ts.isNoSubstitutionTemplateLiteral(init)
        ) {
          seen.set(node.name.text, [...(seen.get(node.name.text) ?? []), { file, node: init }]);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }
  const table = new Map();
  const ambiguous = [];
  for (const [name, declarations] of [...seen].sort()) {
    if (declarations.length === 1) table.set(name, declarations[0].node);
    else ambiguous.push(name);
  }
  return { table, ambiguous };
}

/** A string literal, or a name the package declares exactly one string literal for. */
function emittedStringValue(node, table, following = new Set()) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node) && !following.has(node.text)) {
    const target = table.get(node.text);
    if (target) return emittedStringValue(target, table, new Set([...following, node.text]));
  }
  return null;
}

/**
 * One `{ specifier: range }` field of an emitted manifest, as plain data.
 *
 * Anything it cannot read to a LITERAL range — a computed key, a call
 * expression, a spread of a name the package does not uniquely declare — is
 * pushed to `unreadable` and left out. It is never approximated: the range is
 * the whole of the next step's evidence, and a specifier carrying a guessed
 * range would be mapped to types the reader may never install.
 */
function emittedRecordValue(node, table, unreadable, where, following = new Set()) {
  const out = {};
  if (!node || !ts.isObjectLiteralExpression(node)) {
    unreadable.push({ ...where, detail: 'the field is not an object literal' });
    return out;
  }
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      const name = ts.isIdentifier(property.expression) ? property.expression.text : null;
      if (name && table.has(name) && !following.has(name)) {
        Object.assign(
          out,
          emittedRecordValue(table.get(name), table, unreadable, where, new Set([...following, name])),
        );
      } else {
        unreadable.push({ ...where, detail: `spread of \`${name ?? 'an expression'}\` cannot be followed` });
      }
      continue;
    }
    const specifier = propertyNameOf(property);
    if (!specifier || !ts.isPropertyAssignment(property)) {
      unreadable.push({ ...where, detail: 'an entry has no literal name' });
      continue;
    }
    const range = emittedStringValue(property.initializer, table);
    if (range === null) {
      unreadable.push({ ...where, specifier, detail: 'the range is not a literal' });
      continue;
    }
    out[specifier] = range;
  }
  return out;
}

/**
 * Every manifest one emitting source file writes into its reader's tree, read
 * from the AST as `{ specifier: range }`.
 *
 * ⭐ This is the answer to the feasibility question objectui#8397 filed open —
 * "the census substitutes holes before compiling, and `buildPackageJson` returns
 * an OBJECT, not a template literal". It does, and that is not an obstacle: the
 * census already parses every one of these files with `ts.createSourceFile` to
 * find their template literals, and an object literal in that same tree is read
 * by the same walk. Nothing has to be executed, transpiled or imported.
 *
 * @param {ts.SourceFile} sourceFile
 * @param {Map<string, ts.Node>} table
 * @param {string} file
 */
export function scanEmittedManifests(sourceFile, table, file = sourceFile.fileName) {
  const manifests = [];
  const unreadable = [];
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const has = (name) => node.properties.some((p) => propertyNameOf(p) === name);
      const fields = EMITTED_MANIFEST_FIELDS.filter((field) => {
        const property = node.properties.find((p) => propertyNameOf(p) === field);
        return property && ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer);
      });
      if (EMITTED_MANIFEST_REQUIRED_FIELDS.every(has) && fields.length > 0) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const manifest = {};
        for (const field of fields) {
          const property = node.properties.find((p) => propertyNameOf(p) === field);
          manifest[field] = emittedRecordValue(property.initializer, table, unreadable, {
            site: `${file}:${line}`,
            field,
          });
        }
        const meta = node.properties.find((p) => propertyNameOf(p) === 'peerDependenciesMeta');
        if (meta && ts.isPropertyAssignment(meta) && ts.isObjectLiteralExpression(meta.initializer)) {
          manifest.peerDependenciesMeta = Object.fromEntries(
            meta.initializer.properties
              .map(propertyNameOf)
              .filter(Boolean)
              .map((name) => [name, { optional: true }]),
          );
        }
        // The peer half runs through the SAME subtraction the declared-dependency
        // map uses, so "REQUIRED peer" means one thing in this file.
        const declared = { ...manifest.dependencies, ...manifest.devDependencies };
        for (const specifier of requiredPeerSpecifiers(manifest)) {
          if (!(specifier in declared)) declared[specifier] = manifest.peerDependencies[specifier];
        }
        manifests.push({ file, line, declared });
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { manifests, unreadable };
}

/**
 * The manifests every emitting PACKAGE writes, keyed by `packages/<dir>`.
 *
 * Per package rather than per file, because a generator is a package: this
 * repository's `create-plugin` builds the manifest in `templates.ts` and the
 * files beside it in `templates.ts` and `index.ts`, and `cli` splits the ranges
 * into a third module again. Per FILE would judge `index.ts`'s templates against
 * no manifest at all.
 */
export function emittedManifestDeclarations({ root = repoRoot } = {}) {
  const { files } = listEmittedSources(root);
  const byPackage = {};
  const sites = [];
  const unreadable = [];
  const ambiguous = [];
  const perPackageFiles = new Map();
  for (const file of files) {
    const dir = file.split('/').slice(0, 2).join('/');
    perPackageFiles.set(dir, [...(perPackageFiles.get(dir) ?? []), file]);
  }
  for (const [dir, packageFiles] of [...perPackageFiles].sort()) {
    const sources = [];
    for (const file of packageFiles) {
      const source = readFileSync(join(root, file), 'utf8');
      if (!EMITTED_MANIFEST_PREFILTER.test(source)) continue;
      sources.push({
        file,
        sourceFile: ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX),
      });
    }
    if (sources.length === 0) continue;
    const { table, ambiguous: ambiguousHere } = emittedConstantTable(sources);
    for (const name of ambiguousHere) ambiguous.push(`${dir}: ${name}`);
    const declared = {};
    for (const { file, sourceFile } of sources) {
      const scan = scanEmittedManifests(sourceFile, table, file);
      for (const manifest of scan.manifests) {
        sites.push(`${manifest.file}:${manifest.line}`);
        Object.assign(declared, manifest.declared);
      }
      unreadable.push(...scan.unreadable);
    }
    if (Object.keys(declared).length > 0) byPackage[dir] = declared;
  }
  return { byPackage, sites, unreadable, ambiguous };
}

/**
 * `paths` for the specifiers an EMITTED manifest declares — one map per emitting
 * package, mapped ONLY to the types this workspace resolves for a manifest that
 * declares the SAME specifier at the SAME range.
 *
 * The range equality is the whole of the rule's honesty, and it is why this is
 * not a hole in the bound. The bound refuses a specifier that reaches a snippet
 * only through this repository's installation, because that says nothing about
 * the reader. Here the READER'S OWN manifest — written by the same generator —
 * declares it, so the entitlement is the reader's; all this workspace supplies
 * is a copy of the types for a range it independently declares for itself. A
 * range this repository does not declare anywhere is left unresolvable and
 * REPORTED, never mapped to an approximate copy, exactly as an untyped declared
 * dependency is. So the day the two drift apart the mapping disappears and the
 * diagnostic comes back, instead of the census quietly judging a template
 * against a version its reader will never install.
 *
 * The root manifest is an eligible anchor, and that is not the bound reopening:
 * what the root supplies here is the `.d.ts`, never the entitlement, and the
 * ROOT-DECLARED control still proves the bound is live for every specifier no
 * emitted manifest declares.
 *
 * Anchors are tried root-first and then by package name, so which of 22
 * identical declarations backs a specifier is decided by name rather than by
 * readdir order — the same tie-break `deriveDeclaredDependencyPaths` makes.
 */
export function deriveEmittedManifestPaths(root = repoRoot, byPackage = {}, packageDirOf = {}) {
  const options = {
    module: COMPILER_OPTIONS.module,
    moduleResolution: COMPILER_OPTIONS.moduleResolution,
  };
  const host = ts.createCompilerHost(options, false);
  // Every DECLARATION this workspace makes of every specifier, from manifests
  // only — never from a walk of `node_modules`, the same prohibition the
  // declared-dependency map is built under.
  const workspaceDeclarations = new Map();
  const declare = (dir, specifier, range) => {
    workspaceDeclarations.set(specifier, [...(workspaceDeclarations.get(specifier) ?? []), { dir, range }]);
  };
  for (const dir of ['.', ...Object.keys(packageDirOf).sort().map((name) => packageDirOf[name])]) {
    const manifestPath = join(root, dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [specifier, range] of Object.entries(manifest[field] || {})) declare(dir, specifier, range);
    }
  }

  const pathsByPackage = {};
  const anchored = [];
  const unresolvable = [];
  for (const emitter of Object.keys(byPackage).sort()) {
    const map = {};
    for (const specifier of Object.keys(byPackage[emitter]).sort()) {
      // A workspace package is mapped from its OWN `exports` by
      // `derivePackageTypePaths`, and one deliberately left unmapped there stays
      // unmapped — the same carve-out `deriveDeclaredDependencyPaths` makes, for
      // the same reason.
      if (specifier in packageDirOf) continue;
      const range = byPackage[emitter][specifier];
      const anchors = (workspaceDeclarations.get(specifier) ?? []).filter((d) => d.range === range);
      let landed = null;
      for (const anchor of anchors) {
        const resolved = ts.resolveModuleName(
          specifier,
          join(root, anchor.dir, DEPENDENCY_PROBE_FILE),
          options,
          host,
        );
        const file = resolved.resolvedModule ? resolved.resolvedModule.resolvedFileName : null;
        if (!file || !DECLARATION_FILE.test(file) || WORKSPACE_SRC.test(file)) continue;
        landed = { ...anchor, file };
        break;
      }
      if (!landed) {
        unresolvable.push({
          emitter,
          specifier,
          range,
          detail: anchors.length === 0 ? 'no manifest here declares that range' : 'it ships no types here',
        });
        continue;
      }
      map[specifier] = [landed.file];
      anchored.push({ emitter, specifier, range, anchor: landed.dir });
    }
    pathsByPackage[emitter] = map;
  }
  return { pathsByPackage, anchored, unresolvable };
}

/**
 * `packages/<dir>/…` -> `packages/<dir> (<manifest name>)`.
 *
 * Both halves, because on this corpus neither is enough on its own: the
 * directory is what the walk collected and what a reader greps for, and the
 * manifest name is what the rest of this gate's output is keyed by — and they
 * disagree. `packages/vscode-extension` publishes under the name `object-ui`,
 * so a split keyed on the name alone prints a row nobody can find on disk.
 *
 * @param {string} file
 * @param {Record<string, string>} packageDirOf
 */
export function emittingPackageOf(file, packageDirOf = {}) {
  const dir = file.split('/').slice(0, 2).join('/');
  for (const [name, packageDir] of Object.entries(packageDirOf)) {
    if (packageDir === dir) return `${dir} (${name})`;
  }
  return dir;
}

/**
 * Which of three things a census diagnostic is. The split exists because a
 * census whose headline number is dominated by artefacts of its own METHOD
 * decides nothing, and deciding is the only reason this card exists.
 *
 *   `interpolated`  a module-not-found whose specifier still contains the hole
 *                   placeholder: the emitted import TARGET is itself
 *                   interpolated, so there is no specifier for any compiler to
 *                   resolve. An artefact of the substitution, by construction.
 *   `sibling`       a module-not-found on a RELATIVE specifier. The generators
 *                   in this corpus write whole projects — `./App`,
 *                   `./index.css`, `./theme-provider`, `./Layout` are files the
 *                   same generator emits beside the one being judged, and no
 *                   per-snippet compile can resolve a sibling that exists only
 *                   after the generator has run. An artefact of the METHOD
 *                   (isolation), which this gate inherits deliberately from the
 *                   documentation rule "in isolation, as its own module".
 *   `code`          everything else — the diagnostics that say something about
 *                   the emitted code itself.
 *
 * ⚠️ It reads the diagnostic's MESSAGE for the quoted specifier, the only place
 * a specifier survives into a `Diagnostic`. A TypeScript wording change moves
 * these counts; it moves no verdict, because this gate publishes none.
 *
 * @param {{ code: number, messageText: string | ts.DiagnosticMessageChain }} diagnostic
 * @returns {'interpolated' | 'sibling' | 'code'}
 */
export function classifyEmittedDiagnostic(diagnostic) {
  if (diagnostic.code !== 2307 && diagnostic.code !== 2882) return 'code';
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  const quoted = /'([^']+)'/.exec(message);
  if (!quoted) return 'code';
  if (quoted[1].includes(EMITTED_HOLE_PLACEHOLDER)) return 'interpolated';
  return quoted[1].startsWith('.') ? 'sibling' : 'code';
}

// ── Reporting ────────────────────────────────────────────────────────────────

function formatDiagnostic(diagnostic, block) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  let where = '';
  if (diagnostic.file && typeof diagnostic.start === 'number') {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    // The block body starts on the line after its fence.
    where = `${block.doc}:${block.fenceLine + 1 + line}:${character + 1}`;
  } else {
    where = `${block.doc}:${block.fenceLine}`;
  }
  return `${where}  TS${diagnostic.code}: ${message}`;
}

/**
 * The census summary, in this gate's own verdict style: what was walked, what
 * was recognised, what the recogniser CANNOT see, what was judged, and the
 * per-package split. Returned as lines rather than printed, so the shape is
 * pinnable without spawning the gate.
 *
 * Every line is a count this run took. ⛔ None of them is a threshold: this
 * census has no pass mark, and adding one is the decision objectui#7864's
 * binding constraint reserves for the follow-up card.
 *
 * Typed structurally rather than as `ReturnType<typeof emittedCensus>`: the
 * annotation then states exactly which fields the report READS, which is the
 * half a reader needs, and a caller holding a narrower view of the census (a
 * test) is not forced to restate fields nothing here touches.
 *
 * @param {{ files: string[], excludedAsTooling: string[], templatesSeen: number, markerSeen: number, markerOnly: unknown[], moduleShapedMisses: unknown[], recognised: { file: string, line: number, byHeuristic: boolean }[], blocks: unknown[] }} census
 * @param {{ semanticFailures: { block: { doc: string } }[], parseFailures: { block: { doc: string } }[], boundFailures: { block: { doc: string } }[], semanticallyJudged: number }} run
 * @param {Record<string, string>} packageDirOf
 * @param {{ sites: string[], anchored: unknown[], unresolvable: { emitter: string, specifier: string, range: string, detail: string }[], unreadable: unknown[], ambiguous: string[] }} [manifests]
 * @returns {string[]}
 */
export function emittedCensusSummary(census, run, packageDirOf = {}, manifests = null) {
  const diagnosticsBySite = new Map();
  const byClass = { interpolated: 0, sibling: 0, code: 0 };
  for (const { block, diagnostics } of run.semanticFailures) {
    diagnosticsBySite.set(`${block.doc}:${block.fenceLine + 1}`, diagnostics.length);
    for (const d of diagnostics) byClass[classifyEmittedDiagnostic(d)] += 1;
  }
  const perPackage = new Map();
  for (const entry of census.recognised) {
    const name = emittingPackageOf(entry.file, packageDirOf);
    const row = perPackage.get(name) ?? { sites: 0, diagnostics: 0, failed: 0 };
    row.sites += 1;
    const found = diagnosticsBySite.get(`${entry.file}:${entry.line}`) ?? 0;
    row.diagnostics += found;
    if (found > 0) row.failed += 1;
    perPackage.set(name, row);
  }
  const totalDiagnostics = [...diagnosticsBySite.values()].reduce((n, d) => n + d, 0);

  const lines = [
    'Emitted-code census (report-only, objectui#7864) — a generator that emits `import`',
    'statements is a documentation surface, and until now nothing compiled one.',
    `  Walked        ${census.files.length} source file(s) under ${PACKAGES_DIR}/NAME/${EMITTED_SOURCE_SUBDIR}; ` +
      `${census.excludedAsTooling.length} excluded as TOOLING_FILE (tests, mocks, benchmarks, stories).`,
    `  Recognised    ${census.recognised.length} of ${census.templatesSeen} template literal(s): ` +
      `${census.recognised.filter((e) => e.byHeuristic).length} by the import heuristic, ` +
      `${census.markerOnly.length} by the \`doc-snippet: emits\` marker alone.`,
    `  Blind side    ${census.markerSeen} template(s) carry the marker at all — the population an opt-in-only ` +
      `route would have reached. ${census.moduleShapedMisses.length} unrecognised template(s) open a top-level ` +
      '`export` and are seen by NEITHER route.',
  ];
  if (manifests) {
    lines.push(
      `  Reader's mfst ${manifests.sites.length} manifest(s) the generators themselves write (${
        manifests.sites.join(', ') || 'none'
      }): ${manifests.anchored.length} specifier(s) mapped to the types this workspace declares at the SAME ` +
        `range, ${manifests.unresolvable.length} left unresolvable, ${manifests.unreadable.length} entry(s) ` +
        `unreadable, ${manifests.ambiguous.length} constant name(s) ambiguous. An emitted manifest is what the ` +
        'reader installs; the root bound is about what only THIS workspace installs.',
    );
    for (const entry of manifests.unresolvable) {
      lines.push(
        `                ⚠ ${entry.emitter} emits \`${entry.specifier}\`@${entry.range} and ${entry.detail} — ` +
          'its templates are still judged against the root bound for it.',
      );
    }
  }
  lines.push(
    `  Judged        ${run.semanticallyJudged} of ${census.blocks.length} recognised template(s) reached the ` +
      `semantic phase; ${run.parseFailures.length} failed to parse, ${run.boundFailures.length} were refused by ` +
      'the root bound. Neither of those is a pass.',
    `  Diagnostics   ${totalDiagnostics} across ${diagnosticsBySite.size} site(s).`,
    `  Of which      ${byClass.sibling} module-not-found on a sibling the same generator writes (an artefact of ` +
      `judging one emitted file in isolation) and ${byClass.interpolated} on a specifier that is itself ` +
      `interpolated (an artefact of the hole substitution). ${byClass.code} remain, and those are the only ` +
      'ones that say anything about the emitted code.',
  );
  for (const [name, row] of [...perPackage].sort()) {
    lines.push(
      `  ${name.padEnd(42)} ${row.sites} site(s), ${row.failed} with diagnostic(s), ${row.diagnostics} diagnostic(s).`,
    );
  }
  return lines;
}

/**
 * The gate's exit codes, named so that callers and tests can talk about them.
 * `couldNotRun` is deliberately distinct from `documentsFailed`: see the "Why
 * 'could not run' is its own exit code" section in this file's header.
 */
export const EXIT_CODES = {
  /** Every covered snippet compiled, the controls held, the ledger is exact. */
  verified: 0,
  /** The gate RAN. A snippet or the ledger is at fault — a verdict was read. */
  documentsFailed: 1,
  /** The gate COULD NOT RUN. Nothing it printed is a verdict about a document. */
  couldNotRun: 2,
};

/**
 * The findings that stop the snippet program from being built at all, so no
 * verdict about any document can be read from the run. Kept separate from the
 * findings that ARE verdicts (a stale ledger entry, an unexplained fragment)
 * because the two leave through different exit codes.
 *
 * @param {{ reason: string }[]} findings
 */
export function blockingPreconditions(findings) {
  return findings.filter(
    (f) => f.reason === 'unbuilt-package' || f.reason === 'source-typed-package',
  );
}

/**
 * The filter arguments that name the packages the covered snippets import, each
 * carrying pnpm/turbo's DEPENDENCY-CLOSURE suffix `...` ("this package AND the
 * packages it depends on").
 *
 * The closure suffix is why this is a function and not an inline `map`. The set
 * this gate computes is the packages the DOCUMENTS import, which is not a
 * buildable unit: a package the docs import pulls in workspace packages no
 * snippet ever names, and those still have to be built before the imported one
 * can compile. Emitting the bare names left that gap to the caller's tool to
 * close by accident (objectui#5911):
 *
 *   - `turbo run build <args>` closed it silently, because this repository's
 *     `build` task declares `dependsOn: ["^build"]`. Measured on this tree, the
 *     bare list and the `...` list select the IDENTICAL 33 tasks, so the suffix
 *     changes nothing for the workflow that consumes this — it is a no-op where
 *     the closure was already right.
 *   - `pnpm <args> run build` did NOT, because pnpm's `--filter` selects exactly
 *     what it matches and runs each package's own script. Measured on this tree:
 *     21 packages selected instead of 33, and the build died at
 *     `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @object-ui/components` on
 *     `TS2307: Cannot find module '@object-ui/sdui-parser'` — a workspace
 *     package no snippet imports, so nothing put it in the list.
 *
 * Both spellings wear the same `--filter=` flag, so which one closes the gap was
 * invisible at the point of use. Carrying the closure in the emitted list makes
 * the answer independent of the tool the reader reaches for, which matters most
 * for the reader who is here because the gate just told them to build something.
 *
 * @param {Iterable<string>} packages package names the covered snippets import
 * @returns {string} space-separated `--filter=<pkg>...` words, sorted
 */
export function buildFilterArgs(packages) {
  return [...packages].sort().map((n) => `--filter=${n}...`).join(' ');
}

/**
 * What that printed build command does NOT do, printed under it (objectui#7795).
 *
 * The command builds a CLOSURE — the packages the covered documents import, plus
 * their dependencies — and it said so nowhere. Measured on `origin/main`
 * `abdcd189c`: running it left 34 of the workspace's 40 packages with a `dist/`,
 * and the reader who had just been told to "build what the gate needs" had no way
 * to tell that leftover apart from a build that half-failed. Scoping the build is
 * this gate's design, so the fix is the sentence, never a wider filter.
 *
 * Both counts are ARGUMENTS and the text names no package on purpose. A list of
 * "what gets built" written out here would be a second copy of a set this file
 * already computes, and it would rot the first time coverage moved; the reader who
 * wants the exact set is sent to the same filter, expanded by the same tool that
 * is about to run it. `check-doc-snippet-types.test.ts` pins that this text still
 * carries no package name of its own.
 *
 * @param {number} named packages `--build-filter` names (the documents' imports)
 * @param {number} total workspace packages under `packages/`
 * @returns {string} one paragraph for the precondition path's stderr
 */
export function scopedBuildNotice(named, total) {
  return (
    `That build is SCOPED, and it is not a whole-tree build: --build-filter names the ${named} package(s) the ` +
    `covered documents import (${PACKAGES_DIR}/ holds ${total}) plus each one's dependency closure, and every ` +
    'package outside that closure is left exactly as it was. An unbuilt package still sitting there when the ' +
    "build finishes is this gate's designed end state, not a build that half-failed — building the whole tree " +
    'for a documentation check would slow every local loop. For the exact set, ask that same filter rather than ' +
    'a list written down somewhere else: append --dry=text to the command above and read its "Packages in ' +
    'scope" line.'
  );
}

function main() {
  const argv = process.argv.slice(2);

  // Checked before anything else: a ROOT_PAGES name that does not resolve makes
  // the scan set quietly SMALLER, and every count this gate prints would still
  // look healthy. That silent shrink is the defect objectui#7115 was filed for.
  for (const name of ROOT_PAGES) {
    if (!existsSync(join(repoRoot, name))) {
      console.error(
        `ROOT_PAGES names \`${name}\`, which does not exist under ${repoRoot}. That name is part of ` +
          "this gate's stated scan surface (objectui#7115), so a dangling entry silently narrows the " +
          "surface back to what objectui#7115 found. Re-point it at the page's new path, or remove " +
          'it deliberately.',
      );
      return EXIT_CODES.couldNotRun;
    }
  }

  // The same check for the other root leg, for the same reason (objectui#7856
  // card 1): `rootDocsPages` returns [] for a directory that is not there, which
  // keeps a fixture tree listable but would let a rename shrink the real surface
  // back to what objectui#7856 found, with every count below still healthy.
  if (!existsSync(join(repoRoot, ROOT_DOCS.dir))) {
    console.error(
      `ROOT_DOCS names \`${ROOT_DOCS.dir}/\`, which does not exist under ${repoRoot}. That directory is ` +
        "part of this gate's stated scan surface (objectui#7856), so its absence silently narrows the " +
        'surface. Re-point it at the tree\'s new path, or remove the leg deliberately.',
    );
    return EXIT_CODES.couldNotRun;
  }

  // And for card 2's two subtree legs, for exactly the same reason. They are
  // checked as a PAIR because they arrived as one: a rename that took only one of
  // them out would leave the other's count looking healthy, which is the shape
  // this guard exists to refuse.
  for (const tree of [ADR_DOCS, AUDIT_DOCS]) {
    if (!existsSync(join(repoRoot, tree.dir))) {
      console.error(
        `This gate's scan surface names \`${tree.dir}/\`, which does not exist under ${repoRoot}. That ` +
          'subtree is part of the surface objectui#7856 card 2 widened onto, so its absence silently ' +
          'narrows the surface back and every count below would still look healthy. Re-point the leg at ' +
          "the tree's new path, or remove it deliberately.",
      );
      return EXIT_CODES.couldNotRun;
    }
  }

  const state = analyze({});

  if (argv.includes('--build-filter')) {
    // Filter arguments for exactly the packages the covered snippets import,
    // plus their dependency closure. Coverage grows -> the build grows, and
    // nothing else does. Why the closure travels in the list: see
    // `buildFilterArgs` above.
    // ⛔ This query answers from an UNBUILT tree by design and must keep exiting
    // 0 there: it is what the workflow runs to learn what to build, one step
    // BEFORE the build. Making it share the precondition exit would deadlock the
    // gate against its own build step.
    process.stdout.write(buildFilterArgs(state.neededPackages));
    process.stdout.write('\n');
    return 0;
  }

  const blocking = blockingPreconditions(state.findings);
  if (blocking.length > 0) {
    for (const f of state.findings) console.error(`  ${f.site}  [${f.reason}]  ${f.detail}`);
    console.error(
      '\nPRECONDITION NOT MET (exit ' +
        EXIT_CODES.couldNotRun +
        ') — The snippet program was NOT run: the packages it resolves against are not built, or are typed from source.',
    );
    console.error(
      `This is "I could not run", NOT "I ran and found errors" (exit ${EXIT_CODES.documentsFailed}). ` +
        'No line above is a verdict about any document, and this run says nothing about whether the ' +
        'documentation compiles. Build what the gate needs, then re-run:',
    );
    console.error(
      '  pnpm exec turbo run build $(node scripts/check-doc-snippet-types.mjs --build-filter) --concurrency=2\n' +
        '  pnpm check:doc-snippets',
    );
    console.error(
      `\n${scopedBuildNotice(state.neededPackages.size, Object.keys(state.packageDirOf).length)}`,
    );
    return EXIT_CODES.couldNotRun;
  }

  // ── the emitted-code census (objectui#7864) ───────────────────────────────
  // REPORT-ONLY, and behind a flag: an existing caller's verdict and exit code
  // do not move by one byte. It runs AFTER the precondition gate above on
  // purpose — it compiles against the same built closure, so an unbuilt tree is
  // "I could not run" here for exactly the reason it is there.
  if (argv.includes('--emit-census')) {
    const census = emittedCensus({ root: repoRoot });
    if (census.files.length === 0) {
      console.error(
        `The emitted-code walk collected 0 file(s) under ${PACKAGES_DIR}/NAME/${EMITTED_SOURCE_SUBDIR}, so ` +
          'every count below would be a zero that means nothing. A walk that collapsed is a verdict ' +
          'about this instrument, never about the corpus.',
      );
      return EXIT_CODES.couldNotRun;
    }

    // THE MANIFEST THE EMITTED FILE'S READER INSTALLS (objectui#8397). Read from
    // the generators' own sources, per emitting package, and handed ONLY to the
    // census run: the documentation verdict is computed from `state.paths`
    // exactly as before.
    const manifests = emittedManifestDeclarations({ root: repoRoot });
    const emittedPaths = deriveEmittedManifestPaths(repoRoot, manifests.byPackage, state.packageDirOf);

    const censusRun = compileSnippets({
      root: repoRoot,
      compiled: census.blocks,
      paths: state.paths,
      declaredSpecifiers: state.declaredSpecifiers,
      extraPathsByPackage: emittedPaths.pathsByPackage,
    });

    // The same controls the documentation verdict is gated on, for the same
    // reason: a program resolving everything to `any` reports a clean census
    // forever, and a clean census is precisely what this card must not
    // manufacture.
    const censusControls = [];
    if (!censusRun.resolvedFileName || !/[\\/]dist[\\/].*\.d\.ts$/.test(censusRun.resolvedFileName)) {
      censusControls.push(
        `resolution did not land on a built artifact (${censusRun.resolvedFileName ?? 'unresolved'})`,
      );
    }
    if (censusRun.srcLeaks.length > 0) {
      censusControls.push(
        `${censusRun.srcLeaks.length} source file(s) under a package's src/ entered the program, e.g. ${censusRun.srcLeaks[0]}`,
      );
    }
    if (!censusRun.sentinelDiagnostics.map((d) => d.code).includes(2305)) {
      censusControls.push("the planted sentinel produced no TS2305 — the program is resolving everything to 'any'");
    }
    if (censusRun.positiveDiagnostics.length > 0) {
      censusControls.push(
        `the positive control failed (${ts.flattenDiagnosticMessageText(censusRun.positiveDiagnostics[0].messageText, ' ')})`,
      );
    }
    // objectui#8397: the ROOT-DECLARED control, in the census's own program. The
    // emitted-manifest map above is the ONE thing that could widen the bound out
    // from under this census, so the census now proves the bound is still on —
    // and it proves it in the very program where a `create-plugin` block
    // legitimately resolves `vitest` through its reader's own manifest. The two
    // facts must hold together, or the map is an exemption wearing a rule's
    // clothes. Read the same three preconditions the documentation run reads
    // before the verdict arm, so a control that stopped meaning anything says so
    // instead of reading as a bound that held.
    if (censusRun.rootDeclaredMapped) {
      censusControls.push(
        `'${censusRun.rootDeclaredControl}' is now covered by the GLOBAL paths map, so it can no longer show the root bound is on`,
      );
    } else if (!censusRun.rootDeclaredByRoot) {
      censusControls.push(
        `'${censusRun.rootDeclaredControl}' is no longer declared by the repository ROOT's package.json`,
      );
    } else if (!censusRun.rootDeclaredInstalledAt) {
      censusControls.push(`'${censusRun.rootDeclaredControl}' is not installed in this workspace`);
    } else if (!censusRun.rootDeclaredDiagnostics.map((d) => d.code).includes(2307)) {
      censusControls.push(
        `a specifier only the repository ROOT declares still resolves in the census program — the emitted-manifest map has widened the bound for every block instead of for the emitting package that declares it`,
      );
    }
    if (censusControls.length > 0) {
      console.error('CENSUS HARNESS CONTROL FAILED — no count below is a fact about any emitter:');
      for (const c of censusControls) console.error(`  - ${c}`);
      console.error(
        `\nThe census COULD NOT RUN (exit ${EXIT_CODES.couldNotRun}). Report-only means it declines to ` +
          'fail on its FINDINGS, never that it passes without looking.',
      );
      return EXIT_CODES.couldNotRun;
    }

    for (const line of emittedCensusSummary(census, censusRun, state.packageDirOf, {
      sites: manifests.sites,
      unreadable: manifests.unreadable,
      ambiguous: manifests.ambiguous,
      anchored: emittedPaths.anchored,
      unresolvable: emittedPaths.unresolvable,
    })) {
      console.log(line);
    }
    // Printed, not merely asserted above: the emitted-manifest map's whole claim
    // is that it widened the bound for ONE package's blocks and for nothing else,
    // and this is the line a reader can check that against without opening the
    // script (objectui#8397).
    console.log(
      `  Bound live    the ROOT-DECLARED control ('${censusRun.rootDeclaredControl}', covered by no global paths ` +
        `entry) produced ${censusRun.rootDeclaredDiagnostics.length} diagnostic(s)${
          censusRun.rootDeclaredDiagnostics.length
            ? ` (TS${censusRun.rootDeclaredDiagnostics.map((d) => d.code).join(', TS')})`
            : ''
        } in this same program — the root bound is ON for every block no emitted manifest speaks for.`,
    );
    console.log('');

    // The findings themselves. Printed on stdout, deliberately: they are a
    // census, not a verdict, and nothing here fails the build.
    for (const { block, diagnostics } of censusRun.parseFailures) {
      for (const d of diagnostics) console.log(`  [syntax]    ${formatDiagnostic(d, block)}`);
    }
    for (const { block, diagnostics } of censusRun.semanticFailures) {
      for (const d of diagnostics) console.log(`  [semantic]  ${formatDiagnostic(d, block)}`);
    }
    for (const { block, specifiers } of censusRun.boundFailures) {
      console.log(
        `  [bound]     ${block.doc}:${block.fenceLine + 1}  emits an import of ${specifiers
          .map((s) => `'${s}'`)
          .join(', ')}, which resolve only through this repository's ROOT package.json — not through ` +
          'anything the emitted file\'s reader installs.',
      );
    }

    console.log(
      `\nREPORT-ONLY (exit ${EXIT_CODES.verified}) — objectui#7864 rules that the census IS the ` +
        'deliverable and that no finding here may fail a build on this landing: one known member ' +
        '(objectui#7472) is open and unfixed, so a blocking gate would go red on somebody else\'s ' +
        'card. Whether this corpus gets cleaned or gets a declared ledger is decided from the ' +
        'numbers above, on a follow-up card, and ⛔ not here.',
    );
    return EXIT_CODES.verified;
  }

  const run = compileSnippets({
    root: repoRoot,
    compiled: state.compiled,
    paths: state.paths,
    declaredSpecifiers: state.declaredSpecifiers,
  });

  // ── controls, before any verdict about the documents ──────────────────────
  const controlFailures = [];
  // Printed BEFORE the controls: it says how far this run's resolution reaches,
  // which is the thing the UNDECLARED control then bounds.
  console.log(
    `Third-party resolution: ${Object.keys(state.dependencyPaths).length} specifier(s) mapped from the declared dependencies of ${state.neededPackages.size} imported package(s), ${peerMappedCount(state)} of them from a REQUIRED peerDependency this workspace resolves; ${state.untypedDependencies.length} declared specifier(s) ship no types here and stay unresolvable.`,
  );
  console.log('Controls:');
  console.log(
    `  resolution   Module name '${CONTROL_PACKAGE}' was successfully resolved to '${run.resolvedFileName ?? '(unresolved)'}'`,
  );
  if (!run.resolvedFileName || !/[\\/]dist[\\/].*\.d\.ts$/.test(run.resolvedFileName)) {
    controlFailures.push(
      `resolution did not land on a built artifact (${run.resolvedFileName ?? 'unresolved'}) — the snippets would be judged against source, or against nothing`,
    );
  }
  if (run.srcLeaks.length > 0) {
    controlFailures.push(`${run.srcLeaks.length} source file(s) under a package's src/ entered the program, e.g. ${run.srcLeaks[0]}`);
  }
  const sentinelCodes = run.sentinelDiagnostics.map((d) => d.code);
  console.log(
    `  sentinel     importing '${SENTINEL_EXPORT}' produced ${run.sentinelDiagnostics.length} diagnostic(s)${sentinelCodes.length ? ` (TS${sentinelCodes.join(', TS')})` : ''}`,
  );
  if (!sentinelCodes.includes(2305)) {
    controlFailures.push(
      `the planted sentinel produced no TS2305 — the program is resolving everything to 'any' and would report green forever`,
    );
  }
  console.log(`  positive     importing '${CONTROL_REAL_EXPORT}' produced ${run.positiveDiagnostics.length} diagnostic(s)`);
  if (run.positiveDiagnostics.length > 0) {
    controlFailures.push(
      `the positive control failed (${ts.flattenDiagnosticMessageText(run.positiveDiagnostics[0].messageText, ' ')}) — the harness is broken, not the documents`,
    );
  }
  const undeclaredCodes = run.undeclaredDiagnostics.map((d) => d.code);
  console.log(
    `  undeclared   importing '${UNDECLARED_CONTROL_PACKAGE}' (installed at ${run.undeclaredInstalledAt ?? '(NOT INSTALLED)'}, declared by no imported package) produced ${run.undeclaredDiagnostics.length} diagnostic(s)${undeclaredCodes.length ? ` (TS${undeclaredCodes.join(', TS')})` : ''}`,
  );
  if (run.undeclaredDeclared) {
    controlFailures.push(
      `'${UNDECLARED_CONTROL_PACKAGE}' is now a DECLARED dependency of a package a covered document imports, so it can no longer show that resolution stayed narrow — pick a control specifier no imported package declares`,
    );
  } else if (!run.undeclaredInstalledAt) {
    controlFailures.push(
      `'${UNDECLARED_CONTROL_PACKAGE}' is not installed in this workspace, so its failure to resolve proves nothing about how far resolution reaches — pick an installed specifier no imported package declares`,
    );
  } else if (!undeclaredCodes.includes(2307)) {
    controlFailures.push(
      `a specifier NO imported package declares now resolves — third-party resolution has widened past the imported packages' own dependencies, so a snippet may import what no reader of these packages can get, and every document would stay green while it does`,
    );
  }
  const rootDeclaredCodes = run.rootDeclaredDiagnostics.map((d) => d.code);
  console.log(
    `  root-declared importing '${run.rootDeclaredControl}' (declared by this repository's ROOT package.json, installed at ${run.rootDeclaredInstalledAt ?? '(NOT INSTALLED)'}, covered by no paths entry) produced ${run.rootDeclaredDiagnostics.length} diagnostic(s)${rootDeclaredCodes.length ? ` (TS${rootDeclaredCodes.join(', TS')})` : ''}`,
  );
  if (run.rootDeclaredMapped) {
    controlFailures.push(
      `'${run.rootDeclaredControl}' is now covered by the paths map, so it resolves through the map and can no longer show that the ROOT's own manifest is bounded — pick a control specifier the root declares and the map does not cover`,
    );
  } else if (!run.rootDeclaredByRoot) {
    controlFailures.push(
      `'${run.rootDeclaredControl}' is no longer declared by the repository ROOT's package.json, so its failure to resolve says nothing about the root's set — pick a specifier the root declares`,
    );
  } else if (!run.rootDeclaredInstalledAt) {
    controlFailures.push(
      `'${run.rootDeclaredControl}' is not installed in this workspace, so its failure to resolve proves nothing about how far resolution reaches — pick an installed specifier the root declares`,
    );
  } else if (!rootDeclaredCodes.includes(2307)) {
    controlFailures.push(
      `a specifier only the repository ROOT declares still resolves — the bound is not being applied, so a snippet may import what this workspace installs to test itself and no reader of the documented packages is told to install, and every document would stay green while it does`,
    );
  }
  console.log('');

  const total = state.compiled.length + state.declaredFragments.length;
  for (const f of state.findings) console.error(`  ${f.site}  [${f.reason}]  ${f.detail}`);
  for (const { block, diagnostics } of run.parseFailures) {
    for (const d of diagnostics) console.error(`  [syntax]    ${formatDiagnostic(d, block)}`);
  }
  for (const { block, diagnostics } of run.semanticFailures) {
    for (const d of diagnostics) console.error(`  [semantic]  ${formatDiagnostic(d, block)}`);
  }
  for (const { block, specifiers } of run.boundFailures) {
    console.error(
      `  [bound]     ${block.doc}:${block.fenceLine}  imports ${specifiers.map((s) => `'${s}'`).join(', ')}, which ` +
        "resolve only through this repository's ROOT package.json — this workspace's own devDependency " +
        'set, not anything a reader of the documented packages installs. Import what an imported ' +
        'package declares in its `dependencies`, or REQUIRES of its consumer in its ' +
        '`peerDependencies`. That second field is read too, but only for a peer the manifest does NOT ' +
        'mark optional and that resolves here: an optional peer is a requirement ON the reader, which ' +
        'may be unmet.' +
        '\n                If the specifier IS such a peer and this block needs its bindings, stand ' +
        'them in with `declare const` typed to what the block uses them as, and import only what the ' +
        "package declares. The block still compiles, so the documented package's own surface around it " +
        'stays checked — worked example: `packages/layout/README.md`, under "Usage with React Router".' +
        '\n                Declaring the block a fragment is the LAST resort: it stops the WHOLE block ' +
        "compiling, that package's own surface included, so reach for it only when the block cannot " +
        'compile for reasons a stand-in cannot supply. Its reason must name what the reader installs:' +
        `\n                ${FRAGMENT_MARKER_EXAMPLES[0]}`,
    );
  }

  // A failing block inside a blockquote: name the depth its declaration must be
  // written at. The escape hatch reaches it, but only at its own depth, and a
  // marker written at depth 0 above it is silent about why it did not attach.
  const quotedFailures = new Map();
  for (const { block } of [...run.parseFailures, ...run.semanticFailures, ...run.boundFailures]) {
    if (block.quoteDepth > 0) quotedFailures.set(`${block.doc}:${block.fenceLine}`, block.quoteDepth);
  }
  for (const [site, depth] of quotedFailures) {
    console.error(
      `  [quoted]    ${site}  this block is fenced inside a blockquote (depth ${depth}). If it cannot ` +
        'compile, its fragment marker must be written at that SAME depth — one at depth 0 above the ' +
        `callout does not declare it:\n                ${'> '.repeat(depth)}${FRAGMENT_MARKER_EXAMPLES[0]}`,
    );
  }

  // ── the summary always states semantic COVERAGE, never just a verdict ─────
  const parseFailedBlocks = run.parseFailures.length;
  const coveredWithBlocks = new Set([
    ...state.compiled.map((b) => b.doc),
    ...state.declaredFragments.map((b) => b.doc),
  ]).size;
  console.log(
    `Scanned ${state.documents.length} document(s): ${state.covered.length} covered (${coveredWithBlocks} of them hold a ts/tsx block), ${Object.keys(UNGATED_DOCS).length} ungated — declared in this script, NOT verified by it.`,
  );
  console.log(
    `Covered blocks: ${total} — ${state.compiled.length} to compile, ${state.declaredFragments.length} declared fragment(s).`,
  );
  console.log(
    parseFailedBlocks === 0
      ? 'Syntax phase:   every block parsed, so every one of them reached the semantic phase.'
      : `Syntax phase:   ${parseFailedBlocks} block(s) failed to parse and were NOT semantically checked.`,
  );
  console.log(
    run.boundFailures.length === 0
      ? "Root bound:     no block imports a specifier that resolves only through this repository's ROOT manifest."
      : `Root bound:     ${run.boundFailures.length} block(s) import a specifier that resolves only through the ROOT manifest (${run.boundedSpecifiers.join(', ')}) and were NOT semantically checked.`,
  );
  console.log(
    `Semantic phase: ${run.semanticallyJudged} of ${state.compiled.length} block(s) judged, ${run.semanticFailures.length} failed.`,
  );
  if (parseFailedBlocks > 0 || run.boundFailures.length > 0) {
    console.log(
      `NOTE: this run's semantic result covers ${run.semanticallyJudged} block(s) only. A syntax failure, and a block the root bound refused, are neither of them a semantic pass.`,
    );
  }

  const failed =
    controlFailures.length > 0 ||
    state.findings.length > 0 ||
    parseFailedBlocks > 0 ||
    run.boundFailures.length > 0 ||
    run.semanticFailures.length > 0;

  if (controlFailures.length > 0) {
    console.error('\nHARNESS CONTROL FAILED — no verdict about the documents can be read from this run:');
    for (const c of controlFailures) console.error(`  - ${c}`);
    console.error(
      `\nThe gate COULD NOT RUN (exit ${EXIT_CODES.couldNotRun}). The sentence above is this run's own ` +
        'wording, and the exit code now agrees with it: a broken harness is a verdict about the ' +
        'harness, never about the documents.',
    );
    return EXIT_CODES.couldNotRun;
  }
  if (failed) {
    console.error('\nDocumentation snippets must compile against the built types. See the header of this script.');
    return EXIT_CODES.documentsFailed;
  }
  console.log('\nEvery covered documentation snippet compiles against the built types.');
  return EXIT_CODES.verified;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}

export {
  UNGATED_DOCS,
  TS_FENCE_LANGUAGES,
  FRAGMENT_MARKER,
  VERIFICATION_CLAIM,
  // The blockquote reading and the declaration floor, shared with the JSON-fence
  // sibling (`check-doc-json-fences.mjs`, objectui#5250) so a quoted fence and a
  // fragment reason are read by ONE rule in both gates.
  MIN_REASON_LENGTH,
  quoteDepthOf,
  stripQuotePrefix,
  isBlankAtDepth,
  UNDECLARED_CONTROL_PACKAGE,
  ROOT_DECLARED_CONTROL_PACKAGE,
  main,
};
