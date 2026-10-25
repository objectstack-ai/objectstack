#!/usr/bin/env node
/**
 * Every fenced example in `skills/` that carries the opt-in marker must still be
 * REAL: a `ts` / `tsx` / `typescript` block must compile against the packages'
 * BUILT `dist/*.d.ts`, and a `json` / `jsonc` block must parse.
 *
 * Run:  node scripts/check-skill-examples.mjs        (also `pnpm check:skill-examples`)
 *       node scripts/check-skill-examples.mjs --list          # every candidate fence + verdict
 *       node scripts/check-skill-examples.mjs --measure       # judge EVERY candidate, marked or not
 *       node scripts/check-skill-examples.mjs --build-filter  # filter args for turbo/pnpm
 *       node scripts/check-skill-examples.mjs --self-test     # fixtures, both directions
 * Exit: 0 = every MARKED fence holds up, the marked population is non-empty, and
 *           no category of it sits below its declared floor.
 *       1 = THE GATE RAN AND FOUND ERRORS. A marked fence failed to parse, failed
 *           to type-check, a marker is not adjacent to a fence it can opt in, a
 *           marked fence re-declares a PUBLISHED type without a declared row, or
 *           the marked population SHRANK below `MARKED_FLOOR` (see below).
 *           Everything printed above the summary is a verdict about a guide.
 *       2 = THE GATE COULD NOT RUN, so nothing printed above is a verdict about
 *           any guide: the packages the marked fences import are not built (or
 *           are typed from source), a harness control failed, or the marked
 *           population is empty. Fix the tree and re-run. Never read this as a
 *           guide defect, and never as a pass.
 *
 * ## The gap this closes (objectui#7359)
 *
 * The guides under `skills/objectui/` are the first thing an AI reads when it
 * writes ObjectUI code, and at the branch point they carried 112 `ts` / `tsx` /
 * `typescript` fences and 56 `json` fences. NOT ONE of them was read by any gate
 * in this repository, and every gate that could have reached them excludes the
 * surface by construction rather than by accident:
 *
 *   | gate                          | why it does not reach a fence in `skills/`   |
 *   |-------------------------------|----------------------------------------------|
 *   | `check-skills-paths.mjs`      | deliberately reads inline code spans in PROSE only — "a fence is a worked example", and a tutorial fence may name a file the reader is about to create |
 *   | `check-doc-links.mjs`         | its `SCAN_ROOTS` has no `skills` row          |
 *   | `check-doc-component-types.mjs` | `DOCS_ROOT = 'content/docs'`, and its header says "not `skills/**`" verbatim |
 *   | `check-doc-snippet-types.mjs` | `content/docs` + the package READMEs + `README.md` |
 *   | `check-doc-fence-languages.mjs` | same surface, and it judges the fence LANGUAGE TAG, never the contents |
 *
 * So this repository enforced path existence in skill prose and nothing else. A
 * fence could import a symbol that does not exist, spell a key the renderer never
 * reads, or restate a shape the spec had changed, and stay green forever. Two
 * rounds of exactly that were already cleaned BY HAND (objectui#3658 / #7094's
 * truth sweep, and #7251's correctness items — which included an eval asserting a
 * mobile hook API with zero occurrences repo-wide), which is precisely the
 * economics `check-skills-paths.mjs` was created to end for paths.
 *
 * ## Opt-in, and why that is the only shape that can start
 *
 * `check-doc-snippet-types.mjs` is opt-OUT: every `ts` fence in a covered
 * document is compiled unless a marker declares it a fragment. That rule is right
 * there and wrong here, and the difference is measurable rather than a matter of
 * taste. The docs corpus was curated into that shape over several cards; the
 * skills corpus never has been. Most of its fences are FRAGMENTS by construction
 * — a `columns: [...]` subtree, a `plugins: [...]` literal, a hook body that
 * continues the block above it, a `vitest` test that imports a dev-only package
 * no consumer of `@object-ui/*` can resolve. Turning all 112 on at once would
 * produce a wall of red on prose that is not wrong, and the reliable outcome of a
 * gate that reds on correct code is that someone deletes it.
 *
 * Hence the convention this file PORTS from objectstack's
 * `packages/spec/scripts/check-skill-examples.ts`: a self-contained,
 * should-hold-up block is opted in by an HTML comment on the line DIRECTLY ABOVE
 * its fence. The marker's exact spelling is in `MARKER` below (a JavaScript block
 * comment cannot quote an HTML comment's closer without confusing a reader
 * grepping for it, so it lives in code, the way
 * `check-doc-snippet-types.mjs` puts its own marker in
 * `FRAGMENT_MARKER_EXAMPLES`).
 *
 * Two properties make the marker safe on this surface, and both are the reason
 * objectstack chose this spelling over a fence-meta tag like ` ```ts check `:
 *
 *   1. It is an HTML comment, so it renders to nothing. A skill guide is read by
 *      an agent as raw markdown and by a human as rendered markdown; neither sees
 *      it.
 *   2. It leaves the fence info string a BARE ` ```typescript `. Three gates in
 *      this repository key on the info string — `check-doc-fence-languages.mjs`
 *      most directly — and a fence-meta tag would have punched a hole in every
 *      one of them.
 *
 * Opt-in also makes the starting population an honest, stated number rather than
 * a wall of exemptions: see "The starting population" below.
 *
 * ## Marker ADJACENCY is strict, and an orphan is a failure
 *
 * The marker must be the line IMMEDIATELY above the fence-open line — not the
 * nearest non-blank line above it. A marker anywhere else is an ORPHAN and fails
 * the run.
 *
 * This is the one rule where being strict costs nothing and being lenient costs
 * everything. A marker separated from its fence by a blank line, or left behind
 * when its fence was deleted or rewritten, is a claim that nothing checks: under
 * a lenient rule it silently opts in NOTHING, and the author who wrote it
 * believes their example is gated. That is the "looks like enforcement, isn't"
 * class this repository has now measured five separate times (objectui#3009,
 * #3181, #3494, #4846, #7115). A stale marker is reported, loudly, with its line
 * number.
 *
 * ## Fence-awareness: a marker shown as EXAMPLE TEXT claims nothing
 *
 * This gate's own convention has to be documentable in the very guides it
 * governs, and in this file's own tests. So a marker line that sits INSIDE some
 * other fenced block — a ```markdown illustration showing what the marker looks
 * like — is at once not an opt-in and not an orphan: it is not at top level, so
 * it claims nothing. `fenceSpans()` answers "which top-level fence owns this
 * line?" for BOTH questions, so the two readings cannot drift apart. The same
 * walk also supplies each fence's CLOSING line, so the body's end is decided by
 * exactly the predicate that decided the fence opened — never by a second,
 * looser closer re-derived at the extraction site (objectstack measured that
 * pair disagreeing on an indented closer and on a CRLF file, in opposite
 * directions).
 *
 * ## How imports resolve: the BUILT dist, exactly like the docs gate
 *
 * A marked `ts` fence is compiled `--strict` against each package's built
 * `dist/*.d.ts`, resolved through the same `paths` map
 * `check-doc-snippet-types.mjs` derives from every package's own `exports` /
 * `types` field, plus that gate's declared-dependency rule for third-party
 * specifiers (a snippet importing `@object-ui/layout` may import `lucide-react`
 * because that package declares it — and may not import a package nothing
 * declares).
 *
 * ⛔ The alternative was mapping `@object-ui/*` to `src/` through the root
 * `tsconfig.json`, and it is rejected for the reason that gate's header
 * states in as many words: the root config maps the workspace to SOURCE, so a
 * harness that inherited it would judge the guides against code no reader
 * resolves — green while the published surface is broken. The reader of a skill
 * guide is a consumer who installs `@object-ui/react` from npm. That is the
 * surface, so that is what is compiled against.
 *
 * ⚠️ That edge USED to be wider, and the `Unmapped specifiers` line printed on
 * every run is what is left of it. A bare specifier that neither the workspace
 * map nor the declared-dependency map covers still resolved if the REPOSITORY
 * ROOT declared it, because pnpm symlinks the root's own dependency set into
 * `/node_modules`: `vitest` and `@playwright/test` are root devDependencies
 * here, so a marked fence importing them was verified against THIS workspace's
 * copy — not against anything a reader of the guide is told to install. The
 * inherited UNDECLARED control never closed that: it bounds resolution against
 * TRANSITIVE packages (which pnpm leaves only under `.pnpm/`), a different leak.
 *
 * objectui#7463 item 2 closed it in the SHARED harness, unconditionally for both
 * gates (maintainer ruling 2026-09-03, objectstack#14909 item 1, option A):
 * `compileSnippets` refuses such a specifier and keeps the fence importing it
 * OUT of the semantic program. The `Unmapped specifiers` line stays, now as the
 * report of what the bound refuses, and the harness's new ROOT-DECLARED control
 * is what proves on every run that it is still being applied.
 *
 * ⚠️ A report OF the refusals has to be read the same way the refusals are, and
 * when the bound landed it was not: the line came from a private regex over the
 * block text while the bound walked the AST, so the two could name different
 * sets over the same fences (objectui#7555). Both now read through the
 * harness's `moduleSpecifiersOfBlock`, so the line cannot name a specifier no
 * fence imports, and the suite pins that the two sets agree over this corpus.
 *
 * ⚠️ A refused fence is NOT type-checked. The four pre-existing ones were
 * carried in the shrink-only `KNOWN_ROOT_DEVDEP_EXAMPLES` below so the bound
 * landed with zero new red, and the `Root bound` and `Semantic phase` lines both
 * say how many fences that costs — a declared row is uncovered debt, never a
 * green. Those four were retired in objectui#7557 by unmarking their fences, so
 * that list is now EMPTY and the bound refuses nothing; see its docblock for the
 * measurement that chose unmarking over declaring, and for when a NEW row is
 * still the right answer.
 *
 * The cost of that decision is the PRECONDITION, and it is a declared exit code
 * rather than a silent green: if a package a marked fence imports has no `dist`,
 * this gate prints `PRECONDITION NOT MET` and exits 2 (`couldNotRun`), never 0
 * and never 1. Zero with nothing run reads as coverage, which is the exact
 * failure shape this whole gate family exists to prevent (objectui#4846). The 1
 * vs 2 split is this repository's convention, not a new one — see
 * `check-eager-closure-budget.mjs` (1 = over budget, 2 = the gauge produced
 * nothing) and `check-doc-snippet-types.mjs`, whose header records three separate
 * agents in one evening each having to notice a printed message before their exit
 * code meant anything.
 *
 * ## What is REUSED, and what is deliberately local
 *
 * The type-check HARNESS is imported from `check-doc-snippet-types.mjs`:
 * `derivePackageTypePaths`, `deriveDeclaredDependencyPaths` and
 * `compileSnippets`. That is not convenience — that harness carries the
 * syntax/semantics split (a `tsc` program with ONE parse error reports no
 * semantic diagnostics at all, program-wide, so an unparseable block must never
 * blind the rest) and the three self-controls (RESOLUTION lands on a built
 * artifact, a planted SENTINEL import must produce TS2305, a POSITIVE control
 * must be clean, and an UNDECLARED specifier must still fail to resolve). A
 * second hand-rolled harness would be a second answer to the same question, and
 * that gate's own header records what hand-rolling it three times cost.
 *
 * What is local is the READING of those controls (`evaluateControls` below) and
 * everything about the marker convention. `scripts/__tests__/check-skill-examples.test.ts`
 * pins that this file imports the shared harness rather than growing its own.
 *
 * ## The starting population (objectui#7359 step 2)
 *
 * `--measure` judges EVERY candidate fence, marked or not, and prints the
 * pass/fail split per language. That is how the marker was landed on exactly the
 * fences that already held up at the branch point, and it stays in the file so
 * the number is re-derivable rather than a claim in a merged PR body.
 *
 * ## The marked population is SHRINK-ONLY (objectui#7550)
 *
 * objectui#7359 landed this gate with no ratchet and no count pin, and said so:
 * whether the marked population becomes shrink-only — the way
 * `check-doc-fence-languages.mjs` treats its declared-file population — was
 * left as a separate decision. That decision is taken: it does, PER CATEGORY,
 * and as a FLOOR rather than an exact pin. `MARKED_FLOOR` below carries one
 * number per marked-fence category, seeded at the population measured at this
 * card's branch point, and a run whose count for a category is BELOW its number
 * exits 1 naming the category, the count, the floor and the two legal moves.
 *
 * A floor and not an equality, because the two directions are not symmetric.
 * Marking one more fence is the direction this whole gate exists to travel, and
 * an exact pin reds on it — a ratchet that goes red on the good move is one
 * people learn to route around, and routing around this one means unmarking.
 * The DOWNWARD move is the one that needs a witness: a marker deleted in the
 * same edit that broke the example it claimed is a red turning green with
 * nothing said, which is the "looks like enforcement, isn't" class this header
 * already records five separate measurements of.
 *
 * ⛔ Deliberately NOT a `file:line` register of which fences carry the marker.
 * That register already exists as `--list`'s output, re-derivable on demand;
 * committing it would red on every guide edit that moves a fence down a line,
 * which teaches precisely the reflex a ratchet must not teach — that going red
 * is normal and the fix is to edit the ratchet.
 *
 * An EMPTY population stays a PRECONDITION rather than becoming a floor breach:
 * a run in which nothing at all is marked exits 2, because a gate that checks
 * nothing must not report success, and that is a statement about the harness or
 * about SCAN_ROOTS rather than a verdict about the corpus. The floor is read
 * only after every precondition has passed, so exit 2 can never be re-labelled
 * as exit 1 by this ratchet.
 *
 * ## The third assertion: no bare `any` in a marked block (objectui#7463)
 *
 * A marker is the author's claim "this block compiles", and the orphan-marker
 * and empty-population guards above exist because a gate that checks nothing
 * must not report success. A bare `any` inside a marked block is that same
 * failure wearing a green badge: every property access on an `any` is
 * unchecked, so `tsc` proves exactly nothing about the lines a reader copies.
 * objectstack's `packages/spec/scripts/check-skill-examples.ts` carries this as
 * its third assertion and records the measured specimen — two marked hook
 * examples annotated `ctx: any` that read a key the hook context does not have,
 * green through the whole of that gate's life.
 *
 * SCOPE, ported from that file rather than re-derived: the annotation must BE
 * `any`, in a position where it erases checking wholesale — a parameter, a
 * variable/property/return annotation, a type alias, or an `as any` /
 * `satisfies any` / angle-bracket assertion. `any` NESTED inside a larger type
 * (`Record<string, any>`, `any[]`, `Promise<any>`) is deliberately NOT flagged.
 * That boundary is the zero-false-positive line, and holding it is what keeps a
 * red meaning broken.
 *
 * ⭐ "NESTED" IS THE DIRECT PARENT AND NOTHING ELSE — read the predicate, never
 * the ancestry (objectui#7653, ported from objectstack#14910). The operative
 * test is `parent.type === node`: all three names above have it FALSE (the
 * `any`'s parent is the TypeReference or ArrayType that contains it), while a
 * function type's return `any` standing inside a type argument has it TRUE and
 * IS a finding, labelled `return type` — in `Array<() => any>` the `any`'s
 * parent is the FunctionTypeNode whose return slot it fills, not the
 * TypeReference above it. So "nested" describes an `any` that is a COMPONENT of
 * a composite type, never an `any` that merely has a type argument among its
 * ancestors. Narrowing the function-like arm to an ancestry reading would hand
 * an author going red the one-token evasion this rule already refuses for
 * parameters: wrap the offending function type in a type argument and the gate
 * goes green over an unchanged defect. The self-test's `red-positions` fixture
 * and the suite's boundary pin both assert that LABEL, so the narrowing reds
 * rather than passing quietly.
 *
 * Casts and locals are in scope and not for symmetry: a
 * parameter-only rule is defeated by exactly the edit an author reaches for
 * when it goes red — move the `any` one line down (`const c: any = ctx`) or
 * into the access (`(ctx as any).x`) — leaving the gate green over an unchanged
 * defect.
 *
 * ⚠️ ONE DELIBERATE DIVERGENCE from objectstack, and it is about which tree is
 * walked. objectstack picks `ScriptKind` off the fence label; the harness THIS
 * gate compiles through parses EVERY block as TSX regardless of label (see
 * `compileSnippets`, and its own header for why). So this walk uses TSX too. A
 * guard that walked a different tree from the one `tsc` judged would be exactly
 * the dormant checker this file's own docblocks warn about. The visible
 * consequence: an angle-bracket `<any>value` assertion is JSX under TSX and is
 * therefore a PARSE failure — already red through the syntax leg, one exit code
 * earlier, never reaching this walk. Its arm is kept in the position table
 * anyway, so the rule stays whole if the harness's ScriptKind ever changes.
 *
 * Parsing, never a regex: the corpus is prose, and `any` occurs in string
 * literal unions, in JSDoc and in ordinary English. `createSourceFile` never
 * throws on malformed input, so a block too broken to parse yields no findings
 * here and is caught by the `tsc` pass — the right division of labour.
 *
 * ⛔ The baseline (`KNOWN_BARE_ANY_EXAMPLES`) is SHRINK-ONLY and is NOT an
 * allowlist: a row whose red is gone fails as STALE. It exists because the
 * assertion landed over a corpus that already had four sites, and unmarking or
 * re-pointing those fences mechanically would have been the gate weakening the
 * guides to suit itself. Each row is a declared debt with a named site, so the
 * per-row skills judgement it needs is a visible piece of work rather than a
 * silent exemption. See the list's own docblock for what each row is.
 *
 * ## The fourth assertion: a marked fence must not SHADOW a published type
 *
 * objectui#7646, and it is the assertion the other three imply. A fence is
 * compiled as a SELF-CONTAINED program, so `tsc` answers "is this snippet
 * internally consistent" and never "does it agree with the type it claims to
 * document". A fence that declares its OWN `type ComponentInput` therefore
 * carries a private copy that can drift arbitrarily far from the published one
 * while this gate stays green — and did: objectui#7636 documented five ADR-0049
 * retirement tombstones as ordinary writable optionals and was green on that
 * fence for the whole time it was wrong.
 *
 * ⭐ The falsification, reproduced on this card's branch point with the mutation
 * confirmed on disk by anchored counts and the restore proven by a blob hash
 * equal to the HEAD blob plus an empty `git diff HEAD`. A fence rewritten as an
 * internally CONSISTENT lie — `name: number` where the published required
 * member is `string`, all five tombstones restored as writable, plus an
 * invented `frobnicate` that exists on no type at all — exits 0, printing
 * `Semantic phase: 13 of 13 ts fence(s) judged, 0 failed`. The fence is INSIDE
 * the judged count. The gate read it and passed it.
 *
 * ⚠️ ONE RECORDED MISS, kept because it is the trap in re-measuring this. An
 * earlier arm left `inputType?: never` in place AND added `inputType?: string`,
 * and went RED with `TS2300` twice and `TS2717`. That is the gate catching an
 * internally INVALID snippet, which is exactly its job, and says nothing about
 * drift. ⛔ A re-measurement that plants an inconsistent lie will conclude the
 * gate works.
 *
 * SCOPE, and it is deliberately the smallest one that closes the class here:
 * the MARKED population only — 3 of the 13 marked fences today, 23% of
 * everything this gate judges. The census behind objectui#7646 found 28
 * shadowing fences over 602 candidates in `skills/`, `.claude/skills/` and
 * `content/docs/`; the 18 under `content/docs/` are `check:doc-snippets`'
 * corpus, where the same blind spot is live because that gate is opt-OUT and
 * compiles them all. ⛔ Widening this assertion into that gate is NOT done here
 * — it is a much larger population and a separate gate-design decision.
 * objectui#7646's triage also ruled out the other direction (converting the
 * fences to imports wholesale): a guide's fence is often a deliberately
 * SIMPLIFIED view of a large published type, so a sweep would make several
 * guides less readable, and that needs per-fence judgement.
 *
 * Which leaves the shape this gate can carry: an offending marked fence must
 * either IMPORT the name (or derive its short shape from it under an alias) or
 * DECLARE, in `KNOWN_SHADOWED_PUBLISHED_TYPES` below, that its copy is a
 * deliberately simplified teaching copy. ⛔ SHRINK-ONLY, and a row is uncovered
 * debt rather than a pass — the summary and the closing line both say so.
 *
 * ⚠️ The rows and NOT the fences, because `skills/**` and `.claude/skills/**`
 * are GOVERNED surfaces (agent drafts, human merges). Editing a fence here
 * would have parked this gate behind a human merge; the repairs are
 * objectui#8335.
 *
 * The oracle is the BUILT surface, not the packages' sources —
 * `derivePublishedTypeNames` states why, and why an inventory that loses its
 * re-export aliases is a CONTROL FAILURE rather than a quiet green.
 *
 * ## Deliberately NOT answered here
 *
 *   1. **Whether a marked JSON fence is VALID METADATA.** It is parsed, not
 *      validated against `@object-ui/types`' schemas. Parsing catches the
 *      trailing comma, the smart quote and the truncated object; deciding which
 *      fences are complete documents rather than prose fragments is the same
 *      boundary `check-doc-snippet-types.mjs` left unruled for the same reason,
 *      and guessing it is what produces a gate people learn to ignore.
 *   2. **Whether a REFUSED fence's example is correct.** The root bound says
 *      only that this gate cannot reach the package the fence imports, never
 *      that the fence is wrong — the four rows it once declared were good
 *      documentation about test runners the reader installs, which is why
 *      objectui#7557 retired them by unmarking the fences rather than by editing
 *      the examples. Retiring a row means giving the example an import the
 *      reader provably has, or the guide's owner deciding the fence should not
 *      be gated; both are skills judgements over a GOVERNED surface, made in a
 *      skills PR.
 *   3. **Whether an eval's `must_contain` token is taught by the guides.** A
 *      different oracle over a different corpus, discussed at length on
 *      objectui#7359 and explicitly not this check.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
  compileSnippets,
  deriveDeclaredDependencyPaths,
  derivePackageTypePaths,
  moduleSpecifiersOfBlock,
  peerMappedCount,
} from './check-doc-snippet-types.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * The prose roots this gate walks: the PUBLISHED skill bundle, and the
 * CONTRIBUTOR-ONLY bundle under `.claude/skills`.
 *
 * Stated here as a decision rather than left to be read off the walker, which is
 * objectui#5174's finding restated — a reader had to open the collector to learn
 * that "covered by default" meant "covered if the filename ends in `.mdx`".
 *
 * `.claude/skills` was added by objectui#7463 item 3, the same widening
 * `check-skills-paths.mjs` took in objectui#7358 and for the same reason: when
 * objectui#7251 moved the two contributor-only guides out of `skills/`, that
 * gate simply stopped looking at them and nothing turned red. A gate whose scan
 * root is narrower than the surface it claims silently un-covers whatever moves
 * out of it.
 *
 * ⚠️ WIDENING A ROOT IS NOT ARMING IT. Opt-in is the whole design here, so this
 * edit adds candidates, not coverage: nothing under `.claude/skills/**` carries
 * the marker, and adding one is the surface owner's step, not this widening's.
 * Measured at objectui#7463's head, which is the number that makes "zero new
 * red on day one" checkable rather than asserted:
 *
 *   |                          | before | after |
 *   |--------------------------|--------|-------|
 *   | guides scanned           | 18     | 20    |
 *   | ts/tsx/typescript fences | 112    | 121   |
 *   | json/jsonc fences        | 56     | 56    |
 *   | MARKED fences            | 56     | 56    |
 *
 * All 9 new candidates are `typescript` fences in
 * `.claude/skills/objectui-contributor/` (5 in `guides/console-development.md`,
 * 4 in `rules/no-touch-zones.md`); the two `SKILL.md` files carry none. The
 * MARKED row is the one that decides whether this widening is safe, and it does
 * not move.
 *
 * Re-derive it with `--measure`; `--list` names every new candidate.
 */
export const SCAN_ROOTS = ['skills', '.claude/skills'];

/** Fence languages compiled as TypeScript. */
export const TS_FENCE_LANGUAGES = new Set(['ts', 'tsx', 'typescript']);

/** Fence languages parsed as JSON. `jsonc` additionally tolerates comments. */
export const JSON_FENCE_LANGUAGES = new Set(['json', 'jsonc']);

/**
 * The opt-in marker, spelled out. It lives in code rather than in the header for
 * the reason `check-doc-snippet-types.mjs` gives for its own: a JavaScript block
 * comment cannot carry these delimiters without a reader having to reconstruct
 * them. Byte-for-byte identical to objectstack's, so the convention is one
 * convention across the two repositories rather than two that look alike.
 */
export const MARKER = '<!-- os:check -->';

/**
 * This gate's exit codes, named so callers and tests can talk about them.
 * `couldNotRun` is deliberately distinct from `examplesFailed`; see the header.
 * The numbers are `check-doc-snippet-types.mjs`'s and
 * `check-eager-closure-budget.mjs`'s — this repository's convention — and each
 * gate names them for itself so that no gate's exit contract is a side effect of
 * importing another one.
 */
export const EXIT_CODES = {
  /** Every marked fence held up, the controls held, something was marked. */
  verified: 0,
  /**
   * The gate RAN. A marked fence, a marker, or the shrink-only floor on the
   * marked population is at fault — a verdict was read.
   */
  examplesFailed: 1,
  /** The gate COULD NOT RUN. Nothing it printed is a verdict about a guide. */
  couldNotRun: 2,
};

// ── The shrink-only floor on the MARKED population (objectui#7550) ──────────

/**
 * ⛔ SHRINK-ONLY. `category -> the MARKED population that category carried when
 * this floor landed` — the shape `check-doc-fence-languages.mjs` landed for
 * `KNOWN_UNHIGHLIGHTED_TS_FENCES`, and a count per category for that map's
 * reason: a single total silently accepts a category collapsing to nothing
 * while the other one grows past it, and the two halves of this gate — `tsc`
 * over `ts` fences, `JSON.parse` over `json` ones — are separate machinery that
 * can die separately.
 *
 * Seeded from a measurement, never from a claim in a merged pull request body.
 * At this card's branch point (`3e01cb5`) `pnpm check:skill-examples` printed:
 *
 *     Marked: 17 ts fence(s) and 39 json fence(s).
 *
 * which is exactly the population objectui#7359 reported at the gate's own
 * landing, so nothing had moved in between. ⚠️ That is the MARKED population,
 * not the passing one: the same tree under `--measure` prints `ts: 20/121 pass`
 * — three more `ts` fences hold up today than are opted in, and a floor seeded
 * off that line would have been red on the day it landed.
 *
 * Re-derive it with `pnpm check:skill-examples`, which prints each count beside
 * its floor on every run.
 *
 * ## The two legal moves, and why only one of them has to be declared
 *
 *   • MORE marks than the floor is GREEN. Opting a fence in is the direction
 *     this gate exists to travel; raise the number here in the pull request
 *     that adds the markers, and this file stops under-stating its own
 *     coverage. Nothing reds if you forget.
 *   • FEWER is RED, and the remedy is to lower the number here IN THE SAME PULL
 *     REQUEST that removes the marker, ⛔ with the reason written beside the
 *     row — which example stopped being one, and why unmarking it was the
 *     honest call rather than the cheap way out of a red.
 *
 * The first lowering is `ts` 17 -> 13 (objectui#7557), and its reason is on the
 * row itself below. Read it as the worked example of what this section asks
 * for: the four fences it names were marked over imports the harness cannot
 * reach, so their marks were claims no run could honour — the honest move was
 * to withdraw the claim in the guide, not to carry it as debt forever.
 *
 * ## What this floor counts, and what the OTHER ratchet counts
 *
 * MARKS, not verifications. A fence the shared harness's ROOT BOUND refuses
 * (see `KNOWN_ROOT_DEVDEP_EXAMPLES` below) keeps its marker and stays inside
 * this floor while being type-checked by nothing at all, so this number cannot
 * be read as coverage — the `Root bound` and `Semantic phase` lines in the same
 * summary are what say how many marked fences were actually reached.
 *
 * ⛔ The two ratchets are deliberately not one. Deleting a marker to silence a
 * root-bound refusal would lower THIS floor, which is exactly the move both of
 * them exist to make visible: the debt list refuses to let the refusal go
 * unnamed, and the floor refuses to let the population shrink quietly.
 *
 * @type {ReadonlyMap<string, number>}
 */
export const MARKED_FLOOR = new Map([
  // 17 -> 13 (objectui#7557): the four marked fences in
  // `skills/objectui/guides/testing.md` that imported `vitest` (`:60`, `:94`,
  // `:218`) or `@playwright/test` (`:258`) were unmarked, with the reason
  // written beside each fence. Those two are TEST RUNNERS the reader installs
  // in their own project and no package this repository publishes declares
  // either, so the root bound refused all four and NOTHING type-checked them —
  // their markers claimed a check that could not run, and the four rows in
  // `KNOWN_ROOT_DEVDEP_EXAMPLES` below (now empty) were that claim's standing
  // cost. Unmarking is the honest call here and not the cheap way out of a red:
  // the marks were not hiding a broken example, they were over-stating this
  // gate's reach, and the guide already carried five UNMARKED `vitest` fences
  // beside them. ⛔ Not a precedent for unmarking a fence that reds.
  ['ts', 13],
  // 39 -> 70 (objectui#7474): the 8 multi-document listings under
  // `skills/objectui/` were split into one fence per document and the two
  // `...` elisions were replaced by real values, so every one of the 70
  // json/jsonc fences in the corpus now parses under its own tag and carries
  // the marker. Raising the number is the ADD direction this list documents:
  // the population measured 39 marked / 46 parsing before, 70 / 70 after.
  ['json', 70],
]);

/**
 * The MARKED population, per category.
 *
 * Every category the floor names is present with a count, so one that has lost
 * its last marker reads as `0` rather than as absent. That difference is the
 * whole point: "shrank to nothing" and "was never a category here" are the two
 * readings a bare `Map` of observed counts cannot tell apart, and the first is
 * the failure this floor exists to catch.
 */
export function markedPopulation(marked, floors = MARKED_FLOOR) {
  const population = new Map([...floors.keys()].map((category) => [category, 0]));
  for (const block of marked) population.set(block.kind, (population.get(block.kind) ?? 0) + 1);
  return population;
}

/** Every category whose marked population sits BELOW its floor. */
export function reconcileFloors(population, floors = MARKED_FLOOR) {
  const breaches = [];
  for (const [category, floor] of floors) {
    const count = population.get(category) ?? 0;
    if (count < floor) breaches.push({ category, count, floor });
  }
  return breaches;
}

/** The population printed BESIDE its floor — the phrasing both report modes share. */
export function floorReport(population, floors = MARKED_FLOOR) {
  return [...floors]
    .map(([category, floor]) => `${population.get(category) ?? 0} ${category} fence(s) (floor ${floor})`)
    .join(', ');
}

const REMEDY_FLOOR =
  `\n    Opt-in is the design, so this count moves only because someone edited a` +
  `\n    marker line. MARKED_FLOOR in scripts/check-skill-examples.mjs is` +
  `\n    ⛔ SHRINK-ONLY, and there are exactly two legal moves — both of them in` +
  `\n    the same pull request that moves the markers:` +
  `\n` +
  `\n      • you ADDED marks    -> raise that category's number to the new count;` +
  `\n      • you REMOVED a mark -> lower it to the new count, and write the REASON` +
  `\n                              beside the row: which example stopped being one,` +
  `\n                              and why unmarking it was the honest call.` +
  `\n` +
  `\n    ⛔ Deleting a marker is not a way to make a red example pass. That is the` +
  `\n    move this floor exists to make visible; fix the example, or unmark it and` +
  `\n    say so here where the next reader will see it.`;

// ── The bare-`any` debt list ─────────────────────────────────────────────────

/**
 * ⛔ SHRINK-ONLY. Rows spelled exactly as `bareAnyRowKey()` builds them:
 *
 *     GUIDE:FENCELINE POSITION
 *
 * where POSITION is `describeAnyPosition()`'s own wording, so a row names one
 * `any` at one site and a per-row fix removes exactly one line. Two `any`s of
 * different kinds in one fence are two rows; the fence line disambiguates two
 * of the SAME kind in different fences.
 *
 * ⚠️ Not an allowlist. A row whose red is GONE fails as STALE, so the list can
 * only shrink — the same direction, and the same reasoning, as
 * `KNOWN_UNTAUGHT_EVAL_TOKENS` in `check-skill-eval-tokens.mjs`. It is keyed on
 * the fence LINE, which means moving a guide's prose above the fence forces a
 * re-declaration. That cost is deliberate: a row that floated free of its line
 * would keep covering a site nobody has looked at since.
 *
 * The corpus at objectui#7463's branch point was FOUR rows, measured under
 * `--measure` before the assertion was armed. All four are retired, and none of
 * them by a mechanical unmark.
 *
 * The three `testing.md` rows were retired by objectui#7494, which answered the
 * skills judgement each of them was waiting on and taught the honest idiom in
 * their place — the schema fence hands the validator its invalid value with no
 * assertion at all (the parameter takes it as-is), and the adapter fence doubles
 * through the public `getClient()` seam instead of reaching the private `client`
 * field through a cast. Both fences stay MARKED; the rows went in the same
 * commit as the guide edit, because a row whose red is gone fails as STALE.
 *
 * The fourth — `plugin-development.md:92` `defaultValue` — was retired the same
 * way by the fence repair. Its reason had gone out of date under it: the row
 * said the guide was FAITHFUL prose because `ComponentInput.defaultValue`
 * "really is `any`", and it is not — the platform type has carried it as an
 * ADR-0049 retirement tombstone (`defaultValue?: never`) for some time, so the
 * guide's `any` was rot after all, and the honest fix WAS to the guide. That
 * fence now imports `ComponentInput` instead of re-declaring it, which removes
 * the `any` along with the copy. The list is empty; an empty shrink-only list is
 * the terminal state it is shaped for, not a disabled one.
 *
 * @type {ReadonlySet<string>}
 */
export const KNOWN_BARE_ANY_EXAMPLES = new Set([]);

/** The baseline key for one bare-`any` finding at one site. */
export function bareAnyRowKey(block, finding) {
  return `${block.doc}:${block.fenceLine} ${finding.where}`;
}

// ── The root-devDependency debt list (objectui#7463 item 2) ──────────────────

/**
 * ⛔ SHRINK-ONLY. Rows spelled exactly as `rootDevDepRowKey()` builds them:
 *
 *     GUIDE:FENCELINE SPECIFIER
 *
 * so a row names ONE fence importing ONE specifier the shared harness's root
 * bound refuses (see `resolvesOnlyThroughRootManifest` in
 * `check-doc-snippet-types.mjs`). A fence importing two such specifiers is two
 * rows, and a per-row fix removes exactly one import.
 *
 * ⚠️ Not an allowlist, and it does NOT re-open resolution: a declared row's
 * fence is still refused by the harness and is NOT type-checked — the run's
 * `Semantic phase` count says so out loud. What the row buys is that a
 * PRE-EXISTING one is not a new red on the day the bound landed; what it costs
 * is the fence's coverage, which is the honest price of an example resting on a
 * package the gate cannot show the reader has.
 *
 * A row whose refusal is GONE fails as STALE, so the list can only shrink — the
 * same direction, and the same reasoning, as `KNOWN_BARE_ANY_EXAMPLES` above.
 *
 * The corpus at the bound's branch point was FOUR rows, all in one guide, all
 * measured before the bound was armed:
 *
 *   - `testing.md:60`, `:94`, `:218` imported `vitest`, and `:258` imported
 *     `@playwright/test`. Both are TEST RUNNERS the reader installs in their own
 *     project — the guide's first sentence names both — and no package this
 *     repository publishes declares either, so nothing in the map covered them.
 *     They compiled until the bound only because THIS repository carries both as
 *     root devDependencies, which is the leak the bound closed.
 *
 * ## The list is EMPTY, and that is the terminal state (objectui#7557)
 *
 * All four rows are retired. The bound's own card left the choice to the guide's
 * owner and it was made by MEASUREMENT rather than by taste: this gate reads
 * exactly ONE declaration on a fence — `MARKER` above, an exact-string match on
 * the whole line, with no reason field, no install field and no capture group —
 * and `check-doc-snippet-types.mjs`'s `FRAGMENT_MARKER` is not read here at all.
 * The bound itself (`resolvesOnlyThroughRootManifest`) is a pure function of the
 * specifier and two repository-wide maps, with no per-block parameter to declare
 * into. So there was no form in which a fence could keep its mark and name its
 * install, and the four fences were unmarked in `testing.md` with the reason
 * written beside each. `MARKED_FLOOR` above records the matching `ts` 17 -> 13.
 *
 * ⚠️ This is NOT the precedent it can be misread as. Unmarking to silence a red
 * is the "gate weakens the guide to suit itself" move these shrink-only lists
 * exist to prevent, and it stays refused. What was withdrawn here was different:
 * a mark over a fence the harness REFUSES is a claim no run can honour — those
 * four were type-checked by nothing at all for the whole of their life as rows,
 * and the summary said so on every run. The two ratchets still count different
 * things on purpose, and neither substitutes for the other.
 *
 * A NEW row may still be declared if the bound ever refuses a marked fence
 * again — the machinery below is live, and `judge()` reds an undeclared refusal.
 * But a row is uncovered debt, never a green, so the first question stays: can
 * this example import what the reader provably has? Declare a row only when the
 * answer is no AND the fence must keep its mark for some reason this comment
 * does not anticipate; otherwise unmark it here, the way these four were.
 *
 * @type {ReadonlySet<string>}
 */
export const KNOWN_ROOT_DEVDEP_EXAMPLES = new Set([]);

/** The debt-list key for one refused specifier in one fence. */
export function rootDevDepRowKey(block, specifier) {
  return `${block.doc}:${block.fenceLine} ${specifier}`;
}

/**
 * Split the harness's root-bound refusals into DECLARED debt and new red, and
 * name the declared rows that are no longer refused.
 *
 * Kept a pure function of the run so the self-test can drive both directions
 * over fixture blocks rather than over the real guides.
 */
export function classifyRootDevDep(boundFailures, declared = KNOWN_ROOT_DEVDEP_EXAMPLES) {
  const rows = [];
  for (const { block, specifiers } of boundFailures) {
    for (const specifier of specifiers) {
      const key = rootDevDepRowKey(block, specifier);
      rows.push({ block, specifier, key, declared: declared.has(key) });
    }
  }
  const live = new Set(rows.map((r) => r.key));
  const stale = [...declared].filter((key) => !live.has(key)).sort();
  return { rows, stale, undeclared: rows.filter((r) => !r.declared) };
}

// ── The published-type SHADOWING assertion (objectui#7646) ───────────────────

/**
 * Every type and interface name the BUILT `@object-ui/*` surface publishes,
 * keyed to the entry specifiers that publish it.
 *
 * ## Why the published surface and not each package's own `src` tree
 *
 * objectui#7646's census matched fences against the type names exported by the
 * packages' SOURCES, and that is the right instrument for a census: it needs no
 * build and it cannot miss anything. It is the wrong oracle for a GATE here,
 * for the reason this file's header already gives for compiling against `dist`
 * — the reader of a skill guide is a consumer who installs `@object-ui/react`
 * from npm, so that is the surface, and an assertion that judged the guides
 * against code no reader resolves would be the exact thing the header rejects.
 *
 * It is also the difference between a remedy that exists and one that does not.
 * The finding's remedy is "import it", and a name a package declares internally
 * but never re-exports cannot be imported by anyone. Measured at this card's
 * branch point: of the 26 distinct shadowed names the census found, 25 are on
 * the published surface and one — `NavigationContextType`, internal to
 * `packages/app-shell/src/context/NavigationContext.tsx` — is not. Against a
 * source-derived oracle that row would be red with no legal fix.
 *
 * ## Not a second harness
 *
 * This builds its own tiny program, and that is not the "second answer to the
 * same question" this file's header warns about, because it is a different
 * question. `compileSnippets` asks "does this snippet type-check"; this asks
 * "what does the published surface NAME". It reads only `.d.ts` entry points,
 * emits nothing, judges no snippet, and resolves through each package's own
 * `exports`/`types` — the same artifacts the shared harness resolves to.
 *
 * ⚠️ An `export type { X } from './y.js'` re-export is an ALIAS symbol, whose
 * own flags carry neither `Interface` nor `TypeAlias`. A first cut of this
 * function filtered on those flags without following the alias and silently
 * lost 1167 of 1458 names — every barrel re-export in the workspace, including
 * `AuthUser`, which is one of the three offenders this assertion exists to
 * catch. That is why `viaAlias` is counted and why a run in which it is ZERO is
 * a CONTROL FAILURE rather than a green: it is the one way this inventory can
 * collapse while still looking like it worked.
 *
 * ## The coverage this cannot have, stated rather than hidden
 *
 * A package whose `dist` is not on disk contributes nothing, and this gate
 * deliberately builds only the closure its fences import (`--build-filter`,
 * objectui#7811) rather than the whole workspace. So the returned `absent` list
 * is printed on every run: a name only an UNBUILT package publishes is
 * invisible to this assertion. Making it a precondition instead would force
 * every run to build every package and undo that scoping; naming it is this
 * repository's convention for a bound a gate cannot close.
 *
 * Memoised on the entry set, because `judge()` is called more than once in the
 * self-test and this program costs seconds, not milliseconds.
 */
const publishedTypeNameCache = new Map();

export function derivePublishedTypeNames(root, paths) {
  const entries = Object.entries(paths)
    .filter(([specifier]) => !specifier.includes('*'))
    .map(([specifier, files]) => [specifier, files[0]])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const present = entries.filter(([, file]) => existsSync(file));
  const absent = entries.filter(([, file]) => !existsSync(file)).map(([specifier]) => specifier);

  const cacheKey = [root, ...present.map(([specifier, file]) => `${specifier}=${file}`)].join('\n');
  const cached = publishedTypeNameCache.get(cacheKey);
  if (cached) return cached;

  const options = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const program = ts.createProgram(
    present.map(([, file]) => file),
    options,
    host,
  );
  const checker = program.getTypeChecker();

  const names = new Map();
  let viaAlias = 0;
  for (const [specifier, file] of present) {
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      let symbol = exported;
      let alias = false;
      if (exported.flags & ts.SymbolFlags.Alias) {
        try {
          symbol = checker.getAliasedSymbol(exported);
          alias = true;
        } catch {
          continue;
        }
      }
      if (!(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias))) continue;
      if (alias) viaAlias++;
      if (!names.has(exported.name)) names.set(exported.name, new Set());
      names.get(exported.name).add(specifier);
    }
  }

  // The same control the shared harness reads for its own program: a package's
  // `src/` entering this graph means the inventory describes SOURCE, not what a
  // reader installs.
  const srcLeaks = program
    .getSourceFiles()
    .map((f) => f.fileName)
    .filter((f) => /\/packages\/[^/]+\/src\//.test(f));

  const answer = {
    names,
    entryPoints: present.length,
    totalEntryPoints: entries.length,
    absent,
    viaAlias,
    srcLeaks,
  };
  publishedTypeNameCache.set(cacheKey, answer);
  return answer;
}

/**
 * Every type/interface a block DECLARES locally, and every name its own imports
 * bind.
 *
 * ⚠️ Parsed as TSX for `findBareAny`'s reason: the harness compiles every block
 * as TSX regardless of the fence label, and a guard that walked a different
 * tree from the one `tsc` judged would be reporting about a program that was
 * never checked.
 *
 * The `imported` set carries BOTH halves of a named import — the local binding
 * and, when the import is aliased, the original name. That is what makes the
 * good pattern legal: a fence may write
 * `import type { QueryResult as PublishedQueryResult } from '@object-ui/types'`
 * and then define its own short `QueryResult` FROM it, which is anchored to the
 * published type and is exactly what this assertion wants to encourage. Keying
 * only on the local binding would red on it.
 *
 * Deliberately scope-agnostic: a name bound by ANY import is excluded, not only
 * one from an `@object-ui/*` specifier. On any fence that compiles the two
 * rules coincide — a name both imported and re-declared in one module is a
 * `tsc` error the semantic phase already reds — and a rule with no hard-coded
 * package scope in it cannot rot when the scope changes.
 */
export function findLocalTypeDeclarations(code) {
  const sf = ts.createSourceFile(
    'block.tsx',
    code,
    ts.ScriptTarget.ES2020,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const declarations = [];
  const imported = new Set();
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) imported.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings) {
        if (ts.isNamespaceImport(bindings)) imported.add(bindings.name.text);
        else
          for (const element of bindings.elements) {
            imported.add(element.name.text);
            if (element.propertyName) imported.add(element.propertyName.text);
          }
      }
    }
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.name.getStart(sf));
      declarations.push({
        name: node.name.text,
        line: line + 1,
        kind: ts.isInterfaceDeclaration(node) ? 'interface' : 'type',
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return { declarations, imported };
}

/**
 * The local type declarations of `blocks` that are NOT bound by one of the same
 * fence's imports — the candidates the published inventory is then asked about.
 * Purely syntactic, so it runs on an unbuilt tree and a fixture alike.
 */
export function shadowCandidates(blocks) {
  const out = [];
  for (const block of blocks) {
    const { declarations, imported } = findLocalTypeDeclarations(block.body);
    for (const declaration of declarations) {
      if (imported.has(declaration.name)) continue;
      out.push({ block, ...declaration });
    }
  }
  return out;
}

/**
 * ⛔ SHRINK-ONLY. Rows spelled exactly as `shadowedTypeRowKey()` builds them:
 *
 *     GUIDE:FENCELINE NAME
 *
 * mapped to the REASON this fence keeps its private copy, and the card that
 * owns the repair. One row names ONE shadowed name in ONE fence, so a fence
 * shadowing two published types is two rows and a per-row fix removes exactly
 * one declaration.
 *
 * ## What a row declares, and what it does NOT buy
 *
 * A row is the explicit half of objectui#7646's graded remedy: a marked fence
 * that re-declares a published name must either IMPORT that name or SAY, here,
 * that its copy is a deliberately simplified teaching copy. What the row buys
 * is that a pre-existing offender is not new red on the day this assertion
 * landed. What it costs is exactly what the finding measured — the fence is
 * still compiled as a self-contained program, so `tsc` still judges only
 * whether it is internally consistent and never whether it agrees with the type
 * it is titled after. ⛔ A row is uncovered debt, never a green, and the run's
 * summary says so out loud.
 *
 * ## Why every row is one, and why none of them is a fence edit
 *
 * `skills/**` and `.claude/skills/**` are GOVERNED surfaces — agent drafts,
 * human merges (`scripts/check-governed-queue-guard.mjs`'s `GOVERNED_SURFACES`).
 * The pull request that landed this assertion touches `scripts/` only; a fence
 * edit in it would have parked the gate behind a human merge. The repairs are
 * objectui#8335, which parks for a maintainer by design.
 *
 * ## It reds in four directions, and the fourth is the one keys are shaped for
 *
 *   1. an offender with NO row — the assertion itself;
 *   2. a row whose fence now IMPORTS the name — STALE, because the debt is paid
 *      and a row that outlives its defect is an exemption nobody re-reads;
 *   3. a row whose fence is GONE (deleted, unmarked, or moved down the file) —
 *      STALE for the same reason, and the fence LINE in the key is what makes a
 *      moved fence force a re-declaration, exactly as `KNOWN_BARE_ANY_EXAMPLES`
 *      does;
 *   4. a row whose SHADOWED NAME changed — which needs no extra machinery,
 *      because the name is IN the key: the old row goes stale and the new name
 *      arrives undeclared, so one edit reds twice and says both halves.
 *
 * Four rows were seeded here, measured under `--measure` on this gate's branch
 * point (`fedfa3e4a`), where the census found 3 of the 13 marked fences
 * shadowing a published name — 23% of everything this gate judges. ALL FOUR ARE
 * RETIRED: objectui#8335 gave each of those three fences one of the per-fence
 * judgements objectui#7646's triage laid down, and all three came out as
 * IMPORT, in the same commit as this list shrank to nothing. What the rows
 * bought was measurable at the moment they went: each of the three copies had
 * drifted, and two of them held claims that were flatly false against the
 * published surface — `AuthUser` still taught a `roles` member ADR-0090 D3 had
 * renamed away, and `ComponentInput` declared `label`, `defaultValue` and
 * `advanced` as writable where all three are `never` tombstones.
 *
 * An EMPTY list is the terminal state this shape is for, not a disabled one:
 * the assertion is unchanged and a new offender still reds on sight. The next
 * marked fence that re-declares a published name has no row to hide behind.
 *
 * @type {ReadonlyMap<string, string>}
 */
export const KNOWN_SHADOWED_PUBLISHED_TYPES = new Map([]);

/** The ledger key for one shadowed published name in one fence. */
export function shadowedTypeRowKey(block, name) {
  return `${block.doc}:${block.fenceLine} ${name}`;
}

/**
 * Split the shadowing hits into DECLARED debt and new red, and name the
 * declared rows that no longer describe anything.
 *
 * `markedHits` is always the MARKED population, whatever mode the run is in:
 * a row is a claim about a GATED fence, so a row must not appear to be covered
 * by a fence that is merely being measured. Same rule, same reason, as
 * `analyze()`'s bare-`any` stale half.
 *
 * Kept a pure function of its inputs so the test suite can drive all four red
 * directions over fixtures rather than over the real guides.
 */
export function classifyShadowedTypes(hits, markedHits, declared = KNOWN_SHADOWED_PUBLISHED_TYPES) {
  const rows = hits.map((hit) => {
    const key = shadowedTypeRowKey(hit.block, hit.name);
    return { ...hit, key, declared: declared.has(key), reason: declared.get(key) ?? null };
  });
  const live = new Set(markedHits.map((hit) => shadowedTypeRowKey(hit.block, hit.name)));
  const stale = [...declared.keys()].filter((key) => !live.has(key)).sort();
  return { rows, stale, undeclared: rows.filter((row) => !row.declared) };
}

// ── Bare-`any` guard (objectui#7463, ported from objectstack #5943) ──────────

/**
 * Every position in which a bare `any` erases checking wholesale, keyed by the
 * PARENT node kind. The test is `parent.type === node` (or the assertion's own
 * type slot), so an `any` nested in a larger type — `Record<string, any>`,
 * `any[]`, `Promise<any>` — has a TypeReference/ArrayType parent and is not a
 * finding. That boundary is this guard's zero-false-positive line; widening it
 * is a different question with a different, much larger baseline.
 *
 * The boundary is the DIRECT parent and nothing else — see the SCOPE paragraph
 * at the top of this file for why `Array<() => any>` IS a finding, labelled
 * `return type`, and why reading "nested" as ancestry would open an evasion.
 *
 * ORDER MATTERS in one place. `ts.isFunctionLike` is true for every
 * SignatureDeclaration kind, IndexSignatureDeclaration included, so a bare
 * `[k: string]: any` would fall into the `return type` arm and be reported at a
 * position it does not occupy (objectui#7653). Flagging it is right — an `any`
 * index signature erases checking on every keyed access — so the fix is a
 * label, not an exclusion, and the arm has to come BEFORE the function-like
 * fallback. The label is half of a finding's row key, so a wrong one is a
 * finding that cannot be declared or baselined the day such a site is marked.
 *
 * Returns the human-readable position (which is also half the baseline key), or
 * `null` when this `any` is not in a checking-erasing position.
 */
export function describeAnyPosition(node) {
  const parent = node.parent;
  if (!parent) return null;

  const named = (name) => (name && ts.isIdentifier(name) ? ` \`${name.text}\`` : '');

  if (ts.isParameter(parent) && parent.type === node) return `parameter${named(parent.name)}`;
  if (ts.isVariableDeclaration(parent) && parent.type === node) return `variable${named(parent.name)}`;
  if ((ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) && parent.type === node)
    return `property${named(parent.name)}`;
  if (ts.isTypeAliasDeclaration(parent) && parent.type === node)
    return `type alias \`${parent.name.text}\``;
  if (ts.isAsExpression(parent) && parent.type === node) return '`as any` assertion';
  if (ts.isSatisfiesExpression(parent) && parent.type === node) return '`satisfies any` assertion';
  // Unreachable under TSX (the harness's ScriptKind) — an angle-bracket
  // assertion is JSX there and fails the syntax leg first. Kept so the rule
  // stays whole if that ever changes; see the header's divergence note.
  if (ts.isTypeAssertionExpression(parent) && parent.type === node)
    return 'angle-bracket `any` assertion';
  // BEFORE the function-like fallback: an IndexSignatureDeclaration IS a
  // SignatureDeclaration, so `isFunctionLike` claims it and its `any` would be
  // reported as a `return type` it does not have.
  if (ts.isIndexSignatureDeclaration(parent) && parent.type === node) return 'index signature';
  // Return annotations: functions, methods, arrows, getters, signatures —
  // including a FunctionTypeNode standing inside a type argument.
  if (ts.isFunctionLike(parent) && parent.type === node) return 'return type';
  return null;
}

/**
 * Every bare `any` annotation in one block body, in source order.
 *
 * ⚠️ Parsed as TSX, matching `compileSnippets`, which parses EVERY block as TSX
 * regardless of the fence label. A guard that walked a different tree from the
 * one `tsc` judged would be reporting about a program that was never checked.
 * `createSourceFile` never throws: a block too broken to parse yields no
 * findings here and is caught by the syntax leg instead.
 */
export function findBareAny(code) {
  const sf = ts.createSourceFile(
    'block.tsx',
    code,
    ts.ScriptTarget.ES2020,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const findings = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const where = describeAnyPosition(node);
      if (where) {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        findings.push({ line: line + 1, col: character + 1, where });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return findings;
}

// ── Fence scanning ───────────────────────────────────────────────────────────

/**
 * ANY CommonMark-shaped opening code fence — every language, not just the ones
 * this gate compiles or parses: up to three spaces of indent, a run of three or
 * more backticks, and an info string that cannot itself contain a backtick.
 */
const ANY_FENCE_OPEN_RE = /^ {0,3}(`{3,})([^`]*)$/;

/** A closing fence: indent, at least as long a backtick run, nothing else. */
const FENCE_CLOSE_RE = /^ {0,3}(`{3,})[ \t]*$/;

/**
 * Which TOP-LEVEL fenced block owns each line — of ANY language, spanning both
 * the opening and closing fence lines. `owners[i]` is the index of the line that
 * OPENED the block, or `-1` for a line at true top level; a line that opens a
 * top-level fence owns itself, which is what makes this one array answer both of
 * this file's questions:
 *
 *   - "is this marker at top level?"    `owners[m] === -1`
 *   - "does this line open a fence?"    `owners[i] === i`
 *
 * `closeOf` carries each opener's closing line, so the body's end is read from
 * the same walk that decided the fence opened — never from a second, looser
 * closer re-derived at the extraction site. An unclosed fence runs to END OF
 * FILE per CommonMark, and `closeOf` records `lines.length` for it: one past the
 * last line, so the body slice reaches the end instead of dropping it. The two
 * cases have to be distinguishable, because "closed on the last line" and "never
 * closed" differ by exactly that line.
 */
export function fenceSpans(lines) {
  const owners = new Array(lines.length).fill(-1);
  const closeOf = new Map();
  let i = 0;
  while (i < lines.length) {
    const open = ANY_FENCE_OPEN_RE.exec(lines[i]);
    if (!open) {
      i += 1;
      continue;
    }
    const ticks = open[1];
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const c = FENCE_CLOSE_RE.exec(lines[j]);
      if (c && c[1].length >= ticks.length) {
        close = j;
        break;
      }
    }
    const end = close === -1 ? lines.length : close;
    for (let k = i; k <= end && k < lines.length; k++) owners[k] = i;
    closeOf.set(i, end);
    i = end + 1;
  }
  return { owners, closeOf };
}

/**
 * Every candidate fence in one document, plus every orphan marker.
 *
 * A candidate is a TOP-LEVEL fence whose language this gate can judge. `marked`
 * is true when the line immediately above the fence-open line is exactly the
 * marker (ignoring surrounding whitespace) and is itself at top level.
 *
 * An orphan is a top-level marker line that did not opt a candidate in — a
 * marker above a blank line, above prose, above a ```bash fence, or left behind
 * by a deleted example. A marker inside another fence is example text and is
 * neither: see the header.
 *
 * CRLF is normalised on the way in, so no regex here has to decide whether `\s`
 * should match a carriage return.
 */
export function scanSkillFences(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const { owners, closeOf } = fenceSpans(lines);

  const fences = [];
  const claimed = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (owners[i] !== i) continue; // not a top-level fence opener
    const open = ANY_FENCE_OPEN_RE.exec(lines[i]);
    if (!open) continue;
    const language = (open[2].trim().split(/\s+/)[0] || '').toLowerCase();
    const kind = TS_FENCE_LANGUAGES.has(language)
      ? 'ts'
      : JSON_FENCE_LANGUAGES.has(language)
        ? 'json'
        : null;
    if (kind === null) continue;

    const markerLine = i - 1;
    const marked =
      markerLine >= 0 && owners[markerLine] === -1 && lines[markerLine].trim() === MARKER;
    if (marked) claimed.add(markerLine);

    const close = closeOf.get(i) ?? lines.length;
    fences.push({
      kind,
      language,
      /** 1-based line of the fence-open line itself. */
      fenceLine: i + 1,
      body: lines.slice(i + 1, close).join('\n'),
      marked,
    });
  }

  const orphans = [];
  for (let i = 0; i < lines.length; i++) {
    if (owners[i] !== -1) continue; // example text inside another fence
    if (lines[i].trim() !== MARKER) continue;
    if (!claimed.has(i)) orphans.push(i + 1); // 1-based
  }

  return { fences, orphans };
}

/** Every guide in the scan set, repo-relative, in a stable order. */
export function listGuides(root = repoRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.md')) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  for (const rootName of SCAN_ROOTS) {
    const dir = join(root, rootName);
    if (existsSync(dir)) walk(dir);
  }
  return out;
}

// ── JSON fences ──────────────────────────────────────────────────────────────

/**
 * `source` with `//` and block comments blanked, outside string literals.
 *
 * Only used for `jsonc`. Written as a scanner rather than a regex because a
 * regex cannot tell a `//` inside `"https://..."` from a comment — and a URL in
 * a `json` example is not hypothetical.
 */
export function stripJsonComments(source) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < source.length) {
    const c = source[i];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < source.length) {
        out += source[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n'; // keep line numbers honest
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** `source` with trailing commas before `}` / `]` removed. `jsonc` only. */
function stripTrailingCommas(source) {
  return source.replace(/,(?=\s*[}\]])/g, '');
}

/**
 * Parse one marked JSON fence. Returns `null` when it parses, or the parser's
 * own message when it does not.
 *
 * `json` is parsed STRICTLY — `JSON.parse` and nothing else — because a `json`
 * fence in a guide is a claim about what a real `.json` file may contain, and a
 * tolerant parser here would bless a file no `JSON.parse` in the product would
 * accept. `jsonc` gets comments and trailing commas removed first, and nothing
 * else: that is the whole of what the `jsonc` dialect adds over `json` for the
 * shapes a guide writes. The `jsonc` branch is exercised by fences already in
 * the corpus, not merely reserved for a hypothetical one; re-derive the
 * population with `--measure`.
 */
export function parseJsonFence(body, language) {
  const text = language === 'jsonc' ? stripTrailingCommas(stripJsonComments(body)) : body;
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ── Collection ───────────────────────────────────────────────────────────────

// The specifiers a block imports are read by `moduleSpecifiersOfBlock`, from the
// shared harness. This gate carried its own regex copy of that reader until
// objectui#7555; the harness's docblock records why a regex over a corpus that
// is mostly prose cannot answer the question, and ONE reader is what keeps the
// `Unmapped specifiers` line below and the harness's root bound — AST-derived
// since it landed — from being two answers free to disagree.

/**
 * Everything this run knows before any compiler is started.
 *
 * `measure: true` treats EVERY candidate fence as opted in. That is the
 * measurement mode behind step 2 of objectui#7359, and it is the only difference
 * between the two modes — one predicate, so a fence cannot be measured under one
 * set of rules and gated under another.
 *
 * `baseline` is the bare-`any` debt list, taken as a parameter only so the
 * self-test can drive it in both directions over fixtures. The STALE half is
 * always computed against the MARKED population, never against the
 * measure-selected one: the list describes what is gated, so its rows must not
 * appear to be covered by a fence that is merely being measured.
 */
export function analyze({ root = repoRoot, measure = false, baseline = KNOWN_BARE_ANY_EXAMPLES } = {}) {
  const guides = listGuides(root);
  const scans = new Map();
  for (const guide of guides) {
    scans.set(guide, scanSkillFences(readFileSync(join(root, guide), 'utf8')));
  }

  const findings = [];
  const candidates = [];
  for (const guide of guides) {
    const { fences, orphans } = scans.get(guide);
    for (const line of orphans) {
      findings.push({
        reason: 'orphan-marker',
        site: `${guide}:${line}`,
        detail:
          `\`${MARKER}\` must be the line IMMEDIATELY above a ts/tsx/typescript/json/jsonc fence. ` +
          'Here it opts nothing in, so the example below it is unchecked while reading as gated.',
      });
    }
    for (const fence of fences) {
      candidates.push({ doc: guide, ...fence, selected: measure || fence.marked });
    }
  }

  const selected = candidates.filter((c) => c.selected);
  const tsBlocks = selected.filter((c) => c.kind === 'ts');
  const jsonBlocks = selected.filter((c) => c.kind === 'json');

  // ── the packages those blocks import must be BUILT ────────────────────────
  const { paths, packageDirOf, sourceTyped } = derivePackageTypePaths(root);
  const neededPackages = new Set();
  for (const block of tsBlocks) {
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
        detail: `${name} declares its types at ${sourceTyped[name]} — source, not a built artifact. A marked example may not be judged against it.`,
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

  const {
    paths: dependencyPaths,
    declaredIn: dependencyDeclaredIn,
    untyped: untypedDependencies,
    declared: declaredSpecifiers,
  } = deriveDeclaredDependencyPaths(root, neededPackages, packageDirOf);
  // Workspace entries win every collision, exactly as in the docs gate.
  const mergedPaths = { ...dependencyPaths, ...paths };

  // Bare specifiers the selected fences import that NOTHING in the map covers.
  // See `unmappedSpecifiers` in the header: these are the ones that resolve, if
  // at all, out of the repository root's own `node_modules`, so naming them in
  // every run is what keeps a green honest about what backed it.
  const mapped = new Set(Object.keys(mergedPaths));
  const unmappedSpecifiers = new Set();
  for (const block of tsBlocks) {
    for (const specifier of moduleSpecifiersOfBlock(block.body)) {
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
      const root2 = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (mapped.has(root2) || mapped.has(specifier)) continue;
      unmappedSpecifiers.add(root2);
    }
  }

  // ── the bare-`any` assertion, over the SELECTED ts blocks ─────────────────
  // Purely syntactic, so it runs whether or not the tree is built and whether or
  // not a block later fails to parse — an `any` that a reader would copy is a
  // finding about that guide either way.
  const bareAny = [];
  for (const block of tsBlocks) {
    for (const finding of findBareAny(block.body)) {
      const key = bareAnyRowKey(block, finding);
      bareAny.push({ block, finding, key, baselined: baseline.has(key) });
    }
  }

  // STALE rows are read off the MARKED population regardless of mode (see the
  // docblock): a baseline row is a claim about a gated fence.
  const markedRedKeys = new Set();
  for (const block of candidates) {
    if (block.kind !== 'ts' || !block.marked) continue;
    for (const finding of findBareAny(block.body)) markedRedKeys.add(bareAnyRowKey(block, finding));
  }
  const bareAnyStale = [...baseline].filter((key) => !markedRedKeys.has(key)).sort();

  // ── the shadowed-published-type assertion, SYNTACTIC half (objectui#7646) ─
  // Split the same way the bare-`any` assertion is: what a fence DECLARES is a
  // fact about the prose and needs no build, while whether that name is
  // PUBLISHED needs the built `.d.ts` and therefore belongs to `judge()`. The
  // suite can then drive this half on an unbuilt tree, which is the tree
  // `ci.yml`'s test shards actually have.
  const localTypes = shadowCandidates(tsBlocks);
  // Always the MARKED population, whatever the mode: a ledger row is a claim
  // about a GATED fence (see `classifyShadowedTypes`).
  const markedLocalTypes = shadowCandidates(
    candidates.filter((c) => c.kind === 'ts' && c.marked),
  );

  return {
    unmappedSpecifiers,
    bareAny,
    bareAnyStale,
    localTypes,
    markedLocalTypes,
    guides,
    scans,
    candidates,
    tsBlocks,
    jsonBlocks,
    findings,
    paths: mergedPaths,
    // The WORKSPACE half of the map, kept apart from `paths` because the
    // shadowing assertion must ask only about what THIS repository publishes.
    // `mergedPaths` also carries the imported packages' declared third-party
    // dependencies, and a fence declaring its own `Options` or `ButtonProps` is
    // not shadowing anything when some npm package happens to export that name
    // — "import it from lucide-react" is not a remedy for this defect class.
    workspacePaths: paths,
    dependencyPaths,
    dependencyDeclaredIn,
    untypedDependencies,
    declaredSpecifiers,
    neededPackages,
    // Carried out so the precondition paths can say how much of the workspace
    // their build filter leaves alone (objectui#7811). It is the map this
    // function already walked to resolve `neededPackages`, not a second reading
    // of the tree — the whole point of `scopedBuildNotice` is that its numbers
    // are DERIVED, so the number it is handed has to come from here.
    packageDirOf,
  };
}

/**
 * The findings that stop the program from being built at all, so no verdict
 * about any guide can be read from the run. Kept apart from the findings that
 * ARE verdicts (an orphan marker) because the two leave through different exit
 * codes.
 */
export function blockingPreconditions(findings) {
  return findings.filter((f) => f.reason === 'unbuilt-package' || f.reason === 'source-typed-package');
}

/**
 * The filter arguments naming the packages the selected fences import, each
 * carrying pnpm/turbo's DEPENDENCY-CLOSURE suffix `...`. Identical in shape and
 * in reasoning to `check-doc-snippet-types.mjs`'s `buildFilterArgs`: the set this
 * gate computes is the packages the GUIDES import, which is not a buildable unit
 * on its own, and emitting bare names left that gap to be closed by accident by
 * whichever tool the reader reached for.
 */
export function buildFilterArgs(packages) {
  return [...packages]
    .sort()
    .map((n) => `--filter=${n}...`)
    .join(' ');
}

/**
 * What that printed build command does NOT do, printed under it — objectui#7811,
 * porting the shape objectui#7795 landed as `check-doc-snippet-types.mjs`'s
 * `scopedBuildNotice`.
 *
 * Both precondition paths tell the reader to build, and both print a command
 * that builds a CLOSURE rather than the tree, having said so nowhere. Measured
 * on `origin/main` `65ce8c576`: `--build-filter` names 10 of the workspace's 40
 * packages, and expanding each one's dependency closure puts 30 in scope — so
 * running the printed command exactly as given leaves 10 packages with no
 * `dist/`, and nothing distinguishes that from a build that half-failed. The
 * trimming is deliberate (the workflow that runs this gate -- `repo-gates.yml`
 * since objectui#12214 -- forbids the unfiltered build in its header, under the
 * 2026-08-16 ruling on objectui#4846), so what
 * was missing is the sentence, never a wider filter.
 *
 * Both counts are ARGUMENTS and the text names no package on purpose. A list of
 * "what gets built" written out here would be a second copy of a set this file
 * already computes, and it would rot the first time the marked population moved;
 * the reader who wants the exact set is sent to the same filter, expanded by the
 * same tool that is about to run it — `--dry=text` makes turbo print a
 * `Packages in scope` line (and, below it, a table of the same set) instead of
 * building. `packages/` is the directory `derivePackageTypePaths` walks, which
 * is where `total` is counted from; it is a location, not a package list.
 *
 * `check-skill-examples.test.ts` pins the half that rots unwatched — the numbers
 * stay derived, no package name grows here — plus the half that would make it
 * worthless: both precondition paths have to actually print it.
 *
 * @param {number} named packages `--build-filter` names (the marked examples' imports)
 * @param {number} total packages under `packages/` this gate resolves against
 * @returns {string} one paragraph for a precondition path's stderr
 */
export function scopedBuildNotice(named, total) {
  return (
    `That build is SCOPED, and it is not a whole-tree build: --build-filter names the ${named} package(s) the ` +
    `marked examples import (packages/ holds ${total}) plus each one's dependency closure, and every package ` +
    'outside that closure is left exactly as it was. An unbuilt package still sitting there when the build ' +
    "finishes is this gate's designed end state, not a build that half-failed — a whole-workspace build for a " +
    'guide check is what this gate\'s workflow refuses outright. For the exact set, ask that same filter rather ' +
    'than a list written down somewhere else: append --dry=text to the command above and read its "Packages in ' +
    'scope" line.'
  );
}

// ── Reporting ────────────────────────────────────────────────────────────────

function formatDiagnostic(diagnostic, block) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  if (diagnostic.file && typeof diagnostic.start === 'number') {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    // The block body starts on the line after its fence.
    return `${block.doc}:${block.fenceLine + 1 + line}:${character + 1}  TS${diagnostic.code}: ${message}`;
  }
  return `${block.doc}:${block.fenceLine}  TS${diagnostic.code}: ${message}`;
}

/**
 * Read the shared harness's controls. The harness is
 * `check-doc-snippet-types.mjs`'s; the READING is local, so this gate's exit
 * contract is its own rather than a side effect of importing another gate.
 *
 * Returns the lines to print (a control that is not printed cannot be audited)
 * and the failures. Any failure means the harness is broken, which is a verdict
 * about the harness and never about a guide — so it leaves through
 * `couldNotRun`.
 */
export function evaluateControls(run, publishedSurface = null) {
  const lines = [];
  const failures = [];

  lines.push(`  resolution   resolved to '${run.resolvedFileName ?? '(unresolved)'}'`);
  if (!run.resolvedFileName || !/[\\/]dist[\\/].*\.d\.ts$/.test(run.resolvedFileName)) {
    failures.push(
      `resolution did not land on a built artifact (${run.resolvedFileName ?? 'unresolved'}) — the examples would be judged against source, or against nothing`,
    );
  }
  if (run.srcLeaks.length > 0) {
    failures.push(
      `${run.srcLeaks.length} source file(s) under a package's src/ entered the program, e.g. ${run.srcLeaks[0]}`,
    );
  }

  const sentinelCodes = run.sentinelDiagnostics.map((d) => d.code);
  lines.push(
    `  sentinel     a planted missing export produced ${run.sentinelDiagnostics.length} diagnostic(s)${sentinelCodes.length ? ` (TS${sentinelCodes.join(', TS')})` : ''}`,
  );
  if (!sentinelCodes.includes(2305)) {
    failures.push(
      "the planted sentinel produced no TS2305 — the program is resolving everything to 'any' and would report green forever",
    );
  }

  lines.push(`  positive     a real export produced ${run.positiveDiagnostics.length} diagnostic(s)`);
  if (run.positiveDiagnostics.length > 0) {
    failures.push(
      `the positive control failed (${ts.flattenDiagnosticMessageText(run.positiveDiagnostics[0].messageText, ' ')}) — the harness is broken, not the guides`,
    );
  }

  const undeclaredCodes = run.undeclaredDiagnostics.map((d) => d.code);
  lines.push(
    `  undeclared   a specifier no imported package declares (installed at ${run.undeclaredInstalledAt ?? '(NOT INSTALLED)'}) produced ${run.undeclaredDiagnostics.length} diagnostic(s)${undeclaredCodes.length ? ` (TS${undeclaredCodes.join(', TS')})` : ''}`,
  );
  if (run.undeclaredDeclared) {
    failures.push(
      'the undeclared control specifier is now a DECLARED dependency of an imported package, so it can no longer show that resolution stayed narrow — pick another',
    );
  } else if (!run.undeclaredInstalledAt) {
    failures.push(
      'the undeclared control specifier is not installed, so its failure to resolve proves nothing about how far resolution reaches — pick another',
    );
  } else if (!undeclaredCodes.includes(2307)) {
    failures.push(
      'a specifier NO imported package declares now resolves — third-party resolution has widened past the imported packages\' own dependencies, and every guide would stay green while it does',
    );
  }

  const rootDeclaredCodes = run.rootDeclaredDiagnostics.map((d) => d.code);
  lines.push(
    `  root-declared a specifier only the repository ROOT declares (installed at ${run.rootDeclaredInstalledAt ?? '(NOT INSTALLED)'}) produced ${run.rootDeclaredDiagnostics.length} diagnostic(s)${rootDeclaredCodes.length ? ` (TS${rootDeclaredCodes.join(', TS')})` : ''}`,
  );
  if (run.rootDeclaredMapped) {
    failures.push(
      'the root-declared control specifier is now covered by the paths map, so it resolves through the map and can no longer show that the ROOT\'s own set is bounded — pick another',
    );
  } else if (!run.rootDeclaredByRoot) {
    failures.push(
      'the root-declared control specifier is no longer declared by the repository ROOT, so its failure to resolve says nothing about the root\'s set — pick another',
    );
  } else if (!run.rootDeclaredInstalledAt) {
    failures.push(
      'the root-declared control specifier is not installed, so its failure to resolve proves nothing about how far resolution reaches — pick another',
    );
  } else if (!rootDeclaredCodes.includes(2307)) {
    failures.push(
      'a specifier only the repository ROOT declares now resolves — the root bound is not being applied, so a marked example may rest on what THIS workspace installs to test itself rather than on anything the guide tells its reader to install, and every guide would stay green while it does',
    );
  }

  // ── the published-type inventory's own controls (objectui#7646) ──────────
  // Read here rather than beside the assertion so that EVERY control this run
  // rests on is printed in one block: a control that is not printed cannot be
  // audited, and an inventory that collapsed silently would turn the shadowing
  // assertion green over every offender at once.
  if (publishedSurface) {
    lines.push(
      `  published    ${publishedSurface.names.size} type/interface name(s) from ${publishedSurface.entryPoints} of ${publishedSurface.totalEntryPoints} package entry point(s), ${publishedSurface.viaAlias} reached through a re-export` +
        (publishedSurface.absent.length === 0
          ? ''
          : ` — NOT BUILT, so nothing they alone publish is visible: ${publishedSurface.absent.join(', ')}`),
    );
    if (publishedSurface.names.size === 0) {
      failures.push(
        'the published-type inventory is EMPTY, so the shadowing assertion would find nothing however wrong the guides are — the packages are not built, or their entry points moved',
      );
    } else if (publishedSurface.viaAlias === 0) {
      failures.push(
        'not one published name was reached through a RE-EXPORT, and every package in this workspace publishes through a barrel — the inventory is losing alias symbols and would be blind to most of the surface (this is the exact way a first cut of it lost 1167 of 1458 names)',
      );
    }
    if (publishedSurface.srcLeaks.length > 0) {
      failures.push(
        `${publishedSurface.srcLeaks.length} source file(s) under a package's src/ entered the published-type inventory, e.g. ${publishedSurface.srcLeaks[0]} — it would describe SOURCE, not what a reader installs`,
      );
    }
  }

  return { lines, failures };
}

/**
 * Judge the selected fences. Returns everything the caller needs to print a
 * verdict, with the type-check and JSON halves kept apart.
 */
export function judge(
  state,
  declaredRootDevDep = KNOWN_ROOT_DEVDEP_EXAMPLES,
  declaredShadowed = KNOWN_SHADOWED_PUBLISHED_TYPES,
) {
  const run = compileSnippets({
    root: repoRoot,
    compiled: state.tsBlocks,
    paths: state.paths,
    declaredSpecifiers: state.declaredSpecifiers,
  });

  const rootDevDep = classifyRootDevDep(run.boundFailures, declaredRootDevDep);

  // ── the shadowed-published-type assertion, BUILT half (objectui#7646) ─────
  const publishedSurface = derivePublishedTypeNames(repoRoot, state.workspacePaths);
  const published = (candidate) => publishedSurface.names.has(candidate.name);
  const withSpecifiers = (candidate) => ({
    ...candidate,
    specifiers: [...publishedSurface.names.get(candidate.name)].sort(),
  });
  const shadowed = classifyShadowedTypes(
    state.localTypes.filter(published).map(withSpecifiers),
    state.markedLocalTypes.filter(published),
    declaredShadowed,
  );

  const failedTs = new Set();
  for (const { block } of run.parseFailures) failedTs.add(block);
  for (const { block } of run.semanticFailures) failedTs.add(block);
  // A refused fence is NOT judged either way. It counts as failed only when its
  // row is undeclared; a declared row is debt, and the coverage line — not this
  // set — is what stops it reading as verified.
  for (const { block } of rootDevDep.undeclared) failedTs.add(block);

  const jsonFailures = [];
  for (const block of state.jsonBlocks) {
    const message = parseJsonFence(block.body, block.language);
    if (message !== null) jsonFailures.push({ block, message });
  }

  return { run, failedTs, jsonFailures, rootDevDep, publishedSurface, shadowed };
}

// ── The run ──────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const measure = argv.includes('--measure');
  const state = analyze({ root: repoRoot, measure });

  if (argv.includes('--build-filter')) {
    // ⛔ This query answers from an UNBUILT tree by design and must keep exiting
    // 0 there: it is what the workflow runs to learn what to build, one step
    // BEFORE the build. Sharing the precondition exit would deadlock the gate
    // against its own build step (the reasoning, and the wording, are
    // `check-doc-snippet-types.mjs`'s).
    process.stdout.write(`${buildFilterArgs(state.neededPackages)}\n`);
    return EXIT_CODES.verified;
  }

  const marked = state.candidates.filter((c) => c.marked);
  // Read off `marked`, never off `state.tsBlocks` / `state.jsonBlocks`: under
  // `--measure` those hold EVERY candidate, so a floor read from them would be
  // measuring one population and gating another.
  const population = markedPopulation(marked);

  // ── the anti-idle floor, checked before anything expensive ────────────────
  // A gate that checks nothing must not report success. Under `--measure` the
  // selected population is every candidate, so the floor is about that instead.
  if (!measure && marked.length === 0) {
    console.error(
      `No fence under ${SCAN_ROOTS.join(', ')} carries \`${MARKER}\`, so this run judged nothing.`,
    );
    console.error(
      `\nPRECONDITION NOT MET (exit ${EXIT_CODES.couldNotRun}) — the marked population is EMPTY. ` +
        'This is "I could not run", NOT "I ran and everything held up": a gate that checks nothing ' +
        'must not report success (objectui#4846). Either the markers were removed, or this gate is ' +
        'reading the wrong root — see SCAN_ROOTS in this script.',
    );
    return EXIT_CODES.couldNotRun;
  }

  const blocking = blockingPreconditions(state.findings);
  if (blocking.length > 0) {
    for (const f of state.findings) console.error(`  ${f.site}  [${f.reason}]  ${f.detail}`);
    console.error(
      `\nPRECONDITION NOT MET (exit ${EXIT_CODES.couldNotRun}) — the example program was NOT run: ` +
        'the packages it resolves against are not built, or are typed from source.',
    );
    console.error(
      `This is "I could not run", NOT "I ran and found errors" (exit ${EXIT_CODES.examplesFailed}). ` +
        'No line above is a verdict about any guide. Build what the gate needs, then re-run:',
    );
    console.error(
      '  pnpm exec turbo run build $(node scripts/check-skill-examples.mjs --build-filter) --concurrency=2\n' +
        '  pnpm check:skill-examples',
    );
    console.error(
      `\n${scopedBuildNotice(state.neededPackages.size, Object.keys(state.packageDirOf).length)}`,
    );
    return EXIT_CODES.couldNotRun;
  }

  const { run, failedTs, jsonFailures, rootDevDep, publishedSurface, shadowed } = judge(state);

  const { lines: controlLines, failures: controlFailures } = evaluateControls(run, publishedSurface);
  console.log(
    `Third-party resolution: ${Object.keys(state.dependencyPaths).length} specifier(s) mapped from the declared dependencies of ${state.neededPackages.size} imported package(s), ${peerMappedCount(state)} of them from a REQUIRED peerDependency this workspace resolves; ${state.untypedDependencies.length} declared specifier(s) ship no types here and stay unresolvable.`,
  );
  console.log(
    state.unmappedSpecifiers.size === 0
      ? 'Unmapped specifiers: none — every bare import of a selected fence is covered by the map above.'
      : `Unmapped specifiers (covered by neither map, so the shared harness's ROOT BOUND refuses them — they would otherwise resolve from the repository ROOT's own node_modules, this workspace's devDependency set, NOT what a reader of the guide installs): ${[...state.unmappedSpecifiers].sort().join(', ')}`,
  );
  console.log('Controls:');
  for (const line of controlLines) console.log(line);
  console.log('');

  if (argv.includes('--list') || measure) {
    for (const block of state.candidates) {
      let verdict;
      const anyHits = state.bareAny.filter((h) => h.block === block);
      const anyNote = anyHits.length
        ? ` + ${anyHits.length} bare \`any\`${anyHits.every((h) => h.baselined) ? ' (all baselined)' : ''}`
        : '';
      const boundRows = rootDevDep.rows.filter((r) => r.block === block);
      const boundNote = boundRows.length
        ? ` + root-bound refused (${boundRows.map((r) => r.specifier).join(', ')})${boundRows.every((r) => r.declared) ? ', declared' : ''}`
        : '';
      const shadowRows = shadowed.rows.filter((r) => r.block === block);
      const shadowNote = shadowRows.length
        ? ` + shadows ${shadowRows.map((r) => r.name).join(', ')}${shadowRows.every((r) => r.declared) ? ' (all declared)' : ''}`
        : '';
      if (!block.selected) verdict = 'unmarked — ignored';
      else if (block.kind === 'json')
        verdict = jsonFailures.some((f) => f.block === block) ? 'FAIL' : 'pass';
      else if (failedTs.has(block)) verdict = `FAIL${anyNote}${boundNote}${shadowNote}`;
      // A refused fence is never "pass": it was not type-checked at all.
      else if (boundRows.length) verdict = `NOT CHECKED${anyNote}${boundNote}${shadowNote}`;
      else
        verdict =
          anyHits.some((h) => !h.baselined) || shadowRows.some((r) => !r.declared)
            ? `FAIL${anyNote}${shadowNote}`
            : `pass${anyNote}${shadowNote}`;
      console.log(
        `  ${block.doc}:${block.fenceLine}  [${block.language}]  ${block.marked ? 'marked' : '      '}  ${verdict}`,
      );
    }
    console.log('');
  }

  for (const f of state.findings) console.error(`  ${f.site}  [${f.reason}]  ${f.detail}`);
  for (const { block, diagnostics } of run.parseFailures) {
    for (const d of diagnostics) console.error(`  [syntax]    ${formatDiagnostic(d, block)}`);
  }
  for (const { block, diagnostics } of run.semanticFailures) {
    for (const d of diagnostics) console.error(`  [semantic]  ${formatDiagnostic(d, block)}`);
  }
  for (const { block, message } of jsonFailures) {
    console.error(`  [json]      ${block.doc}:${block.fenceLine}  ${message}`);
  }
  for (const hit of state.bareAny) {
    if (hit.baselined) continue;
    console.error(
      `  [bare-any]  ${hit.block.doc}:${hit.block.fenceLine + hit.finding.line}:${hit.finding.col}  ` +
        `${hit.finding.where} is annotated \`any\`, which erases checking wholesale — this fence's ` +
        'marker claims it compiles, and every property access on that `any` is unchecked. Give it the ' +
        'honest type, or declare the row VERBATIM in KNOWN_BARE_ANY_EXAMPLES (⛔ SHRINK-ONLY):\n' +
        `                ${hit.key}`,
    );
  }
  for (const key of state.bareAnyStale) {
    console.error(
      `  ${key}  [stale-baseline]  this row is no longer red — delete its line, KNOWN_BARE_ANY_EXAMPLES only shrinks`,
    );
  }
  for (const row of rootDevDep.rows) {
    if (row.declared) continue;
    console.error(
      `  [bound]     ${row.block.doc}:${row.block.fenceLine}  imports '${row.specifier}', which resolves ` +
        "only through this repository's ROOT package.json — this workspace's own devDependency set, not " +
        'anything this guide tells its reader to install. This fence is therefore NOT type-checked. ' +
        'Import what a documented package DECLARES, drop the marker if the fence was never meant to ' +
        'compile on its own, or declare the row VERBATIM in KNOWN_ROOT_DEVDEP_EXAMPLES ' +
        `(⛔ SHRINK-ONLY):\n                ${row.key}`,
    );
  }
  for (const key of rootDevDep.stale) {
    console.error(
      `  ${key}  [stale-baseline]  this row is no longer refused — delete its line, KNOWN_ROOT_DEVDEP_EXAMPLES only shrinks`,
    );
  }
  for (const row of shadowed.rows) {
    if (row.declared) continue;
    console.error(
      `  [shadowed]  ${row.block.doc}:${row.block.fenceLine + row.line}  this fence declares its own \`${row.name}\`, ` +
        `a name the BUILT surface already publishes (${row.specifiers.join(', ')}). The fence is compiled as a ` +
        'self-contained program, so this gate judges whether it is internally CONSISTENT and never whether it ' +
        'agrees with the type it is named after — a copy that is wrong about every member it names passes green ' +
        '(objectui#7646, arm B). Import the published name, or derive the guide\'s short shape from it under an ' +
        'alias, or declare the row VERBATIM in KNOWN_SHADOWED_PUBLISHED_TYPES with the reason it is a deliberately ' +
        `simplified teaching copy (⛔ SHRINK-ONLY):\n                ${row.key}`,
    );
  }
  for (const key of shadowed.stale) {
    console.error(
      `  ${key}  [stale-baseline]  this row no longer describes a marked fence that shadows that name — the fence imports it now, moved, lost its marker, or is gone. Delete its line, KNOWN_SHADOWED_PUBLISHED_TYPES only shrinks`,
    );
  }

  // ── the summary always states COVERAGE, never just a verdict ──────────────
  const tsCandidates = state.candidates.filter((c) => c.kind === 'ts');
  const jsonCandidates = state.candidates.filter((c) => c.kind === 'json');
  const parseFailedBlocks = run.parseFailures.length;
  console.log(
    `Scanned ${state.guides.length} guide(s) under ${SCAN_ROOTS.join(', ')}: ` +
      `${tsCandidates.length} ts/tsx/typescript fence(s), ${jsonCandidates.length} json/jsonc fence(s).`,
  );
  console.log(
    measure
      ? `MEASURE MODE: every candidate judged, marked or not — ${marked.length} of them carry the marker today: ${floorReport(population)}.`
      : `Marked: ${floorReport(population)} — the floor is ⛔ SHRINK-ONLY. Unmarked fences are ignored by design (opt-in).`,
  );
  console.log(
    parseFailedBlocks === 0
      ? 'Syntax phase:   every selected ts fence parsed, so every one of them reached the semantic phase.'
      : `Syntax phase:   ${parseFailedBlocks} ts fence(s) failed to parse and were NOT semantically checked.`,
  );
  const declaredRootDevDep = rootDevDep.rows.filter((r) => r.declared);
  console.log(
    run.boundFailures.length === 0
      ? "Root bound:     no selected fence imports a specifier that resolves only through the repository's ROOT manifest."
      : `Root bound:     ${run.boundFailures.length} fence(s) refused (${run.boundedSpecifiers.join(', ')}) and therefore NOT type-checked; ` +
          `${declaredRootDevDep.length} row(s) declared in KNOWN_ROOT_DEVDEP_EXAMPLES (⛔ SHRINK-ONLY, ${KNOWN_ROOT_DEVDEP_EXAMPLES.size} row(s)), ` +
          `${rootDevDep.undeclared.length} NOT declared, ${rootDevDep.stale.length} declared row(s) no longer refused.`,
  );
  console.log(
    `Semantic phase: ${run.semanticallyJudged} of ${state.tsBlocks.length} ts fence(s) judged, ${run.semanticFailures.length} failed.`,
  );
  console.log(
    `JSON phase:     ${state.jsonBlocks.length} fence(s) parsed, ${jsonFailures.length} failed.`,
  );
  const bareAnyNew = state.bareAny.filter((h) => !h.baselined);
  console.log(
    `Bare \`any\`:     ${state.bareAny.length} finding(s) across ${new Set(state.bareAny.map((h) => h.block)).size} selected fence(s); ` +
      `${state.bareAny.length - bareAnyNew.length} declared in KNOWN_BARE_ANY_EXAMPLES (⛔ SHRINK-ONLY, ${KNOWN_BARE_ANY_EXAMPLES.size} row(s)), ` +
      `${bareAnyNew.length} NOT declared, ${state.bareAnyStale.length} declared row(s) no longer red.`,
  );
  console.log(
    `Shadowed types: ${shadowed.rows.length} local re-declaration(s) of a PUBLISHED name across ` +
      `${new Set(shadowed.rows.map((r) => r.block)).size} selected fence(s); ` +
      `${shadowed.rows.length - shadowed.undeclared.length} declared in KNOWN_SHADOWED_PUBLISHED_TYPES ` +
      `(⛔ SHRINK-ONLY, ${KNOWN_SHADOWED_PUBLISHED_TYPES.size} row(s)), ${shadowed.undeclared.length} NOT declared, ` +
      `${shadowed.stale.length} declared row(s) no longer describe a marked shadowing fence. ` +
      'A declared row is uncovered debt, never a green: that fence is still judged against its own private copy.',
  );
  if (parseFailedBlocks > 0 || run.boundFailures.length > 0) {
    console.log(
      `NOTE: this run's semantic result covers ${run.semanticallyJudged} fence(s) only. A syntax failure, and a fence the root bound refused, are neither of them a semantic pass — a DECLARED root-bound row is uncovered debt, not a green.`,
    );
  }

  if (measure) {
    // A fence the root bound refused is NOT a pass, whether or not its row is
    // declared: nothing type-checked it. Declared rows are absent from
    // `failedTs` on purpose (they are debt, not red), so they are subtracted
    // here explicitly rather than being counted as having held up.
    const notChecked = new Set([...failedTs, ...rootDevDep.rows.map((r) => r.block)]);
    const tsPass = tsCandidates.length - [...notChecked].filter((b) => b.kind === 'ts').length;
    const jsonPass = jsonCandidates.length - jsonFailures.length;
    console.log(
      `\nStarting population — ts: ${tsPass}/${tsCandidates.length} pass; json: ${jsonPass}/${jsonCandidates.length} pass.`,
    );
    const markedAny = state.bareAny.filter((h) => h.block.marked);
    console.log(
      `Bare \`any\` would-be population — ${state.bareAny.length} finding(s) over every candidate, ` +
        `of which ${markedAny.length} sit in a MARKED fence (the population this assertion actually gates).`,
    );
    for (const hit of state.bareAny) {
      console.log(
        `  ${hit.block.marked ? 'marked  ' : 'unmarked'}  ${hit.block.doc}:${hit.block.fenceLine + hit.finding.line}  ${hit.finding.where}${hit.baselined ? '  [declared]' : ''}`,
      );
    }
    const markedShadow = shadowed.rows.filter((r) => r.block.marked);
    console.log(
      `Shadowed-type would-be population — ${shadowed.rows.length} re-declaration(s) over every candidate, ` +
        `of which ${markedShadow.length} sit in a MARKED fence (the population this assertion actually gates).`,
    );
    for (const row of shadowed.rows) {
      console.log(
        `  ${row.block.marked ? 'marked  ' : 'unmarked'}  ${row.key}  published by ${row.specifiers.join(', ')}${row.declared ? '  [declared]' : ''}`,
      );
    }
    const markedBound = rootDevDep.rows.filter((r) => r.block.marked);
    console.log(
      `Root-bound would-be population — ${rootDevDep.rows.length} refusal(s) over every candidate, ` +
        `of which ${markedBound.length} sit in a MARKED fence (the population this bound actually gates).`,
    );
    for (const row of rootDevDep.rows) {
      console.log(
        `  ${row.block.marked ? 'marked  ' : 'unmarked'}  ${row.key}${row.declared ? '  [declared]' : ''}`,
      );
    }
  }

  if (controlFailures.length > 0) {
    console.error('\nHARNESS CONTROL FAILED — no verdict about the guides can be read from this run:');
    for (const c of controlFailures) console.error(`  - ${c}`);
    console.error(
      `\nThe gate COULD NOT RUN (exit ${EXIT_CODES.couldNotRun}). A broken harness is a verdict about ` +
        'the harness, never about the guides.',
    );
    return EXIT_CODES.couldNotRun;
  }

  // `--measure` reports; it does not gate. It exists to produce the number the
  // marker was landed on, and every candidate fence is selected in it, so its
  // failures are the UNMARKED population by construction — a verdict about what
  // is not yet opted in, which is not a defect.
  if (measure) return EXIT_CODES.verified;

  // ── the shrink-only floor on the marked population (objectui#7550) ────────
  // Read AFTER every precondition has returned, so a tree that could not be
  // judged exits 2 and is never re-labelled as a floor breach; and after the
  // summary, so the count and its floor are printed whichever way this goes.
  // Every per-example error line above has already been printed, so returning
  // here hides nothing — only the closing sentence differs, and this one is the
  // accurate sentence for a population that shrank.
  const breaches = reconcileFloors(population);
  if (breaches.length > 0) {
    console.error(
      `\n❌  check:skill-examples — the MARKED population fell below its floor ` +
        `in ${breaches.length} categor${breaches.length === 1 ? 'y' : 'ies'}:\n`,
    );
    for (const b of breaches) {
      console.error(
        `  ${b.category}: ${b.count} marked fence(s), floor ${b.floor} — ${b.floor - b.count} short`,
      );
    }
    console.error(REMEDY_FLOOR);
    return EXIT_CODES.examplesFailed;
  }

  const failed =
    state.findings.length > 0 ||
    parseFailedBlocks > 0 ||
    run.semanticFailures.length > 0 ||
    jsonFailures.length > 0 ||
    bareAnyNew.length > 0 ||
    state.bareAnyStale.length > 0 ||
    rootDevDep.undeclared.length > 0 ||
    rootDevDep.stale.length > 0 ||
    shadowed.undeclared.length > 0 ||
    shadowed.stale.length > 0;

  if (failed) {
    console.error(
      `\nA marked example in ${SCAN_ROOTS.join(', ')} no longer holds up. Fix the example, or — if it ` +
        'was never meant to compile on its own — remove its marker rather than weakening this gate.',
    );
    return EXIT_CODES.examplesFailed;
  }
  const declaredShadowRows = shadowed.rows.filter((r) => r.declared);
  console.log(
    declaredRootDevDep.length === 0
      ? '\nEvery marked skill example holds up against the built types.'
      : `\nEvery marked skill example the root bound could reach holds up against the built types — ${declaredRootDevDep.length} declared row(s) in KNOWN_ROOT_DEVDEP_EXAMPLES were NOT reached, and this line does not speak for them.`,
  );
  if (declaredShadowRows.length > 0) {
    console.log(
      `⚠️  ${declaredShadowRows.length} of them hold up against their OWN private copy of a published type ` +
        `(${declaredShadowRows.map((r) => r.key).join('; ')}) — declared in KNOWN_SHADOWED_PUBLISHED_TYPES, so ` +
        'the line above does not say they agree with the type they are named after. objectui#8335 owns the repair.',
    );
  }
  return EXIT_CODES.verified;
}

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * The marker convention, pinned in BOTH directions on fixtures rather than on
 * the real guides. A committed fixture guide would have to contain a
 * deliberately broken example, and something else in this repository would
 * eventually scan it — the reasoning `check-skills-paths.test.ts` states for its
 * own throwaway trees.
 *
 * The four cases objectui#7359 asks for are all here, and each one is a
 * direction this gate could fail in silently:
 *
 *   - a marked fence that HOLDS UP must pass (a harness broken the other way
 *     reds every guide at once and reads as "the guides are full of defects");
 *   - a marked fence that is BROKEN must fail (without it the gate is a rubber
 *     stamp);
 *   - a marker NOT adjacent to a fence must be reported (the stale-marker case:
 *     lenient adjacency opts in nothing while the author believes otherwise);
 *   - an UNMARKED broken fence must be ignored (opt-in is the whole design; if
 *     this leaks the gate reds on day one on prose that is not wrong).
 *
 * Plus the two the design turns on and nobody would think to write down: a
 * marker shown as EXAMPLE TEXT inside another fence claims nothing and is not an
 * orphan either, and a marker above a ```bash fence IS an orphan.
 *
 * The bare-`any` guard (objectui#7463) is pinned on BOTH edges here, and the
 * negative edge is the load-bearing one: ten in-scope positions must be found
 * and six nested `any`s must NOT be, because that boundary is the whole reason
 * a red from this assertion means something. Its shrink-only baseline is pinned
 * in both directions too — a declared row suppresses, and a row whose red is
 * gone is STALE.
 */
export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  // ── scanner: what a marker opts in ────────────────────────────────────────
  const guide = [
    '# Guide',
    '',
    MARKER,
    '```typescript',
    "export const one: number = 1;",
    '```',
    '',
    '```typescript',
    'const broken: number = "not a number";',
    '```',
    '',
    MARKER,
    '',
    '```typescript',
    'export const two = 2;',
    '```',
    '',
    MARKER,
    '```bash',
    'pnpm install',
    '```',
    '',
    MARKER,
    '```json',
    '{ "ok": true }',
    '```',
    '',
    '````markdown',
    MARKER,
    '```typescript',
    'this is an illustration, not an example',
    '```',
    '````',
    '',
  ].join('\n');

  const scan = scanSkillFences(guide);
  const marked = scan.fences.filter((f) => f.marked);
  t('a marker directly above a fence opts exactly that fence in', marked.length === 2, JSON.stringify(marked.map((f) => f.fenceLine)));
  t('the opted-in ts fence is the FIRST one, not the unmarked broken one', marked.some((f) => f.kind === 'ts' && f.body.includes('export const one')));
  t('the opted-in json fence is recognised as json', marked.some((f) => f.kind === 'json' && f.language === 'json'));
  t('an unmarked broken fence is a candidate but NOT selected', scan.fences.some((f) => !f.marked && f.body.includes('not a number')));
  t(
    'a marker separated from its fence by a blank line is an ORPHAN',
    scan.orphans.includes(12),
    `orphans=${JSON.stringify(scan.orphans)}`,
  );
  t('a marker above a ```bash fence is an ORPHAN', scan.orphans.includes(18), `orphans=${JSON.stringify(scan.orphans)}`);
  t(
    'a marker shown as example text inside another fence is neither opt-in nor orphan',
    scan.orphans.length === 2 && !scan.fences.some((f) => f.body.includes('illustration')),
    `orphans=${JSON.stringify(scan.orphans)} fences=${scan.fences.length}`,
  );

  // ── an unclosed fence must not swallow the rest of the file ───────────────
  const unclosed = scanSkillFences(['```typescript', 'const a = 1;', '', '# still inside, per CommonMark'].join('\n'));
  t('an unclosed fence runs to end of file rather than throwing', unclosed.fences.length === 1, JSON.stringify(unclosed.fences.map((f) => f.fenceLine)));

  // ── JSON fences ──────────────────────────────────────────────────────────
  t('valid json parses', parseJsonFence('{"a": 1}', 'json') === null);
  t('a trailing comma fails under `json`', parseJsonFence('{"a": 1,}', 'json') !== null);
  t('a comment fails under `json`', parseJsonFence('{\n  // nope\n  "a": 1\n}', 'json') !== null);
  t('a trailing comma passes under `jsonc`', parseJsonFence('{"a": 1,}', 'jsonc') === null);
  t('a comment passes under `jsonc`', parseJsonFence('{\n  // fine\n  "a": 1\n}', 'jsonc') === null);
  t(
    'a `//` inside a string is not a comment',
    parseJsonFence('{"url": "https://example.com/x"}', 'jsonc') === null,
  );
  t('a truncated object fails', parseJsonFence('{"a": 1', 'json') !== null);

  // ── the bare-`any` assertion, BOTH directions ────────────────────────────
  // Every in-scope position must be found, and every nested `any` must not be.
  // The negative half is the half that matters: it is the zero-false-positive
  // line, and a widening of it would red on prose that is not wrong.
  const anyPositive = [
    ['parameter', 'export function f(ctx: any) { return ctx; }', 'parameter `ctx`'],
    ['variable', 'export const x: any = 1;', 'variable `x`'],
    ['property (interface)', 'export interface I { p: any }', 'property `p`'],
    ['property (class)', 'export class C { p: any = 1; }', 'property `p`'],
    ['type alias', 'export type A = any;', 'type alias `A`'],
    ['return type', 'export function g(): any { return 1; }', 'return type'],
    ['arrow return type', 'export const h = (): any => 1;', 'return type'],
    ['method signature return', 'export interface J { m(): any }', 'return type'],
    ['`as any`', 'export const y = ({} as any);', '`as any` assertion'],
    ['`satisfies any`', 'export const z = ({} satisfies any);', '`satisfies any` assertion'],
  ];
  for (const [label, code, want] of anyPositive) {
    const hits = findBareAny(code);
    t(
      `bare \`any\` in a ${label} position is FOUND`,
      hits.length === 1 && hits[0].where === want,
      `got ${JSON.stringify(hits.map((f) => f.where))}, want ["${want}"]`,
    );
  }

  // ── POSITIONS (objectui#7653): the two shapes whose LABEL was the defect. ──
  //    BOTH were already flagged before this fix, so a leg asserting only "it is
  //    a finding" passes on the broken code and pins nothing. Each leg therefore
  //    asserts the LABEL STRING, because the label is half a finding's row key.
  //
  //    1. An `any` index signature was reported as `return type`:
  //       `ts.isFunctionLike` is true for every SignatureDeclaration kind, and an
  //       IndexSignatureDeclaration is one. Flagging stays; the label is now
  //       `index signature`.
  //    2. A function type's return `any` standing inside a type argument is a
  //       `return type` finding and STAYS one — the boundary is the DIRECT
  //       parent, so `Array<() => any>` is the function type's return slot, not
  //       a "nested" `any`. This leg is the header's rule made executable: the
  //       day someone reads "nested `any` is deliberately not flagged" as
  //       ancestry and narrows the arm, it goes red here rather than silently
  //       handing authors a one-token evasion.
  //
  //    Driven as ONE snippet so the ORDER of the two arms is pinned too: the
  //    index-signature arm must sit BEFORE the function-like fallback.
  const positionsCode = [
    'interface Bag {', // 1
    '  [key: string]: any;', // 2  ← index signature, NOT a return type
    '}', // 3
    'const fns: Array<() => any> = [];', // 4  ← return type, inside a type argument
    'void fns;', // 5
    '',
  ].join('\n');
  {
    const got = findBareAny(positionsCode)
      .map((h) => `${h.line}:${h.where}`)
      .sort();
    const want = ['2:index signature', '4:return type'].sort();
    t(
      'an `any` index signature is labelled `index signature`, and a return `any` on a function type inside a type argument stays `return type`',
      JSON.stringify(got) === JSON.stringify(want),
      `got ${JSON.stringify(got)}, want ${JSON.stringify(want)} — an \`any\` index signature must be labelled ` +
        `"index signature" (\`isFunctionLike\` matches an IndexSignatureDeclaration, so it used to read ` +
        `"return type"), and a function type's return \`any\` inside a type argument must STAY a "return type" ` +
        `finding (the boundary is the DIRECT parent, not ancestry)`,
    );
  }

  const anyNegative = [
    ['Record<string, any>', 'export const a: Record<string, any> = {};'],
    ['any[]', 'export const b: any[] = [];'],
    ['Array<any>', 'export const c: Array<any> = [];'],
    ['Promise<any>', 'export async function d(): Promise<any> { return 1; }'],
    ['a union arm', 'export const e: string | any[] = [];'],
    ['the WORD any in prose', 'export const f2 = "any"; // any old comment about any of it'],
  ];
  for (const [label, code] of anyNegative) {
    const hits = findBareAny(code);
    t(`a nested \`any\` (${label}) is NOT a finding`, hits.length === 0, JSON.stringify(hits));
  }

  t(
    'JSX parses rather than mis-reading as a type assertion (the harness ScriptKind)',
    findBareAny('export const El = () => <div className="x">hi</div>;').length === 0,
  );

  // ── the baseline, both directions, over fixture blocks ───────────────────
  const anyBlock = { doc: 'fixture/any.md', fenceLine: 10, kind: 'ts', marked: true, body: 'export function f(ctx: any) { return ctx; }\n' };
  const anyKey = bareAnyRowKey(anyBlock, findBareAny(anyBlock.body)[0]);
  t(
    'the baseline row key names the guide, the fence line and the position',
    anyKey === 'fixture/any.md:10 parameter `ctx`',
    anyKey,
  );
  t('an UNDECLARED bare `any` is red', !new Set([]).has(anyKey));
  t('a DECLARED bare `any` is suppressed', new Set([anyKey]).has(anyKey));

  const realState = analyze({ root: repoRoot, measure: false });
  t(
    'the real run has NO undeclared bare `any` — every row is in KNOWN_BARE_ANY_EXAMPLES',
    realState.bareAny.every((h) => h.baselined),
    JSON.stringify(realState.bareAny.filter((h) => !h.baselined).map((h) => h.key)),
  );
  t(
    'and NO declared row has gone stale — the list only shrinks',
    realState.bareAnyStale.length === 0,
    JSON.stringify(realState.bareAnyStale),
  );
  t(
    'a baseline row whose red is GONE is reported as STALE',
    analyze({ root: repoRoot, measure: false, baseline: new Set([...KNOWN_BARE_ANY_EXAMPLES, 'skills/objectui/guides/testing.md:1 parameter `ghost`']) }).bareAnyStale
      .length === 1,
  );

  // ── the type-check half, through the REAL harness ─────────────────────────
  // Two fixture blocks that need no package types at all, so this leg measures
  // the harness rather than the workspace. The CONTROLS still need the built
  // tree; when it is not built they fail, and that is reported as PRECONDITION
  // NOT MET rather than as a passing or failing self-test — the same rule the
  // real run follows.
  const holds = { doc: 'fixture/holds.md', fenceLine: 1, kind: 'ts', body: 'export const one: number = 1;\n' };
  const broken = { doc: 'fixture/broken.md', fenceLine: 1, kind: 'ts', body: 'export const two: number = "no";\n' };
  const unparseable = { doc: 'fixture/unparseable.md', fenceLine: 1, kind: 'ts', body: 'export const three: = ;\n' };
  const state = analyze({ root: repoRoot, measure: false });
  const blocking = blockingPreconditions(state.findings);
  const run = compileSnippets({
    root: repoRoot,
    compiled: [holds, broken, unparseable],
    paths: state.paths,
    declaredSpecifiers: state.declaredSpecifiers,
  });
  const { failures: controlFailures } = evaluateControls(run);

  if (blocking.length > 0 || controlFailures.length > 0) {
    for (const f of blocking) console.error(`  ${f.site}  [${f.reason}]  ${f.detail}`);
    for (const c of controlFailures) console.error(`  - ${c}`);
    console.error(
      `\nPRECONDITION NOT MET (exit ${EXIT_CODES.couldNotRun}) — the self-test's type-check leg needs ` +
        'the workspace built, and this tree is not. The scanner cases above did run; the compiler ' +
        'cases did NOT, and a self-test that quietly skipped them would be the exact silent-green ' +
        'this gate exists to prevent. Build, then re-run:',
    );
    console.error(
      '  pnpm exec turbo run build $(node scripts/check-skill-examples.mjs --build-filter) --concurrency=2\n' +
        '  node scripts/check-skill-examples.mjs --self-test',
    );
    console.error(
      `\n${scopedBuildNotice(state.neededPackages.size, Object.keys(state.packageDirOf).length)}`,
    );
    for (const c of cases.filter((c2) => !c2.ok)) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    return EXIT_CODES.couldNotRun;
  }

  // ── the ROOT BOUND, both directions, through the REAL harness ────────────
  // The positive leg imports a specifier only the repository ROOT declares
  // (`vitest`); the negative leg imports one a DOCUMENTED package declares, and
  // it must still resolve — without that half, a bound that refused everything
  // would look identical here.
  const rootOnly = {
    doc: 'fixture/root-only.md',
    fenceLine: 3,
    kind: 'ts',
    marked: true,
    body: "import { describe } from 'vitest';\nexport const d = describe;\n",
  };
  const declaredDep = {
    doc: 'fixture/declared-dep.md',
    fenceLine: 5,
    kind: 'ts',
    marked: true,
    body: "import type { BaseSchema } from '@object-ui/types';\nexport type S = BaseSchema;\n",
  };
  const boundRun = compileSnippets({
    root: repoRoot,
    compiled: [rootOnly, declaredDep],
    paths: state.paths,
    declaredSpecifiers: state.declaredSpecifiers,
  });
  const refusedBlocks = new Set(boundRun.boundFailures.map((f) => f.block));
  t(
    'a fence importing a ROOT-only specifier is REFUSED and the specifier is named',
    refusedBlocks.has(rootOnly) &&
      boundRun.boundFailures.find((f) => f.block === rootOnly).specifiers.join() === 'vitest',
    JSON.stringify(boundRun.boundFailures.map((f) => [f.block.doc, f.specifiers])),
  );
  t(
    'a fence importing a MAPPED specifier still resolves — the bound refuses the root set, not everything',
    !refusedBlocks.has(declaredDep) &&
      !boundRun.semanticFailures.some((f) => f.block === declaredDep),
    JSON.stringify(boundRun.semanticFailures.map((f) => f.block.doc)),
  );
  t(
    'a refused fence is kept OUT of the semantic program rather than counted as judged',
    boundRun.semanticallyJudged === 1,
    `semanticallyJudged=${boundRun.semanticallyJudged}`,
  );
  const undeclaredBound = classifyRootDevDep(boundRun.boundFailures, new Set());
  t('an UNDECLARED refusal is red', undeclaredBound.undeclared.length === 1, JSON.stringify(undeclaredBound.undeclared.map((r) => r.key)));
  const declaredBound = classifyRootDevDep(boundRun.boundFailures, new Set(['fixture/root-only.md:3 vitest']));
  t('a DECLARED refusal is not red', declaredBound.undeclared.length === 0 && declaredBound.stale.length === 0);
  t(
    'the debt row key names the guide, the fence line and the specifier',
    rootDevDepRowKey(rootOnly, 'vitest') === 'fixture/root-only.md:3 vitest',
    rootDevDepRowKey(rootOnly, 'vitest'),
  );
  t(
    'a declared row that is no longer refused is reported as STALE',
    classifyRootDevDep(boundRun.boundFailures, new Set(['fixture/ghost.md:1 vitest'])).stale.length === 1,
  );
  t(
    "the root-declared CONTROL is red in the same run — the bound is applied, not just described",
    boundRun.rootDeclaredDiagnostics.some((d) => d.code === 2307),
    JSON.stringify(boundRun.rootDeclaredDiagnostics.map((d) => d.code)),
  );
  t(
    'the real run has NO undeclared refusal — every row is in KNOWN_ROOT_DEVDEP_EXAMPLES',
    judge(state).rootDevDep.undeclared.length === 0,
    JSON.stringify(judge(state).rootDevDep.undeclared.map((r) => r.key)),
  );
  t(
    'and NO declared root-bound row has gone stale — that list only shrinks too',
    judge(state).rootDevDep.stale.length === 0,
    JSON.stringify(judge(state).rootDevDep.stale),
  );

  // ── the published-type inventory, and the shadowing assertion over the real
  //    corpus (objectui#7646). Here rather than in the vitest suite because it
  //    needs the BUILT `.d.ts`, which the test shards do not have.
  const shadowRun = judge(state);
  const surface = shadowRun.publishedSurface;
  t(
    'the published-type inventory is not empty',
    surface.names.size > 0,
    `names=${surface.names.size} entryPoints=${surface.entryPoints}/${surface.totalEntryPoints}`,
  );
  t(
    'and it reaches names through RE-EXPORTS, which is how this workspace publishes',
    surface.viaAlias > 0,
    `viaAlias=${surface.viaAlias}`,
  );
  t(
    'no package src/ leaked into it — it describes what a reader installs',
    surface.srcLeaks.length === 0,
    JSON.stringify(surface.srcLeaks.slice(0, 1)),
  );
  // POSITIVE, derived rather than hard-coded: every ledger row names a type the
  // published surface really carries, so a collapsed inventory shows up here
  // before it shows up as a false green.
  const ledgerNames = [...KNOWN_SHADOWED_PUBLISHED_TYPES.keys()].map((key) => key.split(' ')[1]);
  t(
    'every declared ledger row names a type the published surface really carries',
    ledgerNames.every((name) => surface.names.has(name)),
    JSON.stringify(ledgerNames.filter((name) => !surface.names.has(name))),
  );
  // NEGATIVE: a name nothing publishes must be absent, or membership is
  // answering yes to everything and the assertion would red on every fence.
  t(
    'a name nothing publishes is absent from the inventory',
    !surface.names.has('ObjectUiNameThatIsNotPublishedByAnything'),
  );
  t(
    'the real run has NO undeclared shadowing — every offender is in KNOWN_SHADOWED_PUBLISHED_TYPES',
    shadowRun.shadowed.undeclared.length === 0,
    JSON.stringify(shadowRun.shadowed.undeclared.map((r) => r.key)),
  );
  t(
    'and NO declared shadowing row has gone stale — that ledger only shrinks too',
    shadowRun.shadowed.stale.length === 0,
    JSON.stringify(shadowRun.shadowed.stale),
  );

  const semanticallyFailed = new Set(run.semanticFailures.map((f) => f.block));
  const parseFailed = new Set(run.parseFailures.map((f) => f.block));
  t('a marked fence that holds up is CLEAN', !semanticallyFailed.has(holds) && !parseFailed.has(holds));
  t('a marked fence with a type error is RED', semanticallyFailed.has(broken));
  t('a marked fence that does not parse is a SYNTAX failure, never a skip', parseFailed.has(unparseable));
  t(
    'one unparseable fence does not blind the semantic phase for the rest',
    run.semanticallyJudged === 2,
    `semanticallyJudged=${run.semanticallyJudged}`,
  );

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-skill-examples self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return EXIT_CODES.examplesFailed;
  }
  console.log(
    `✓ check-skill-examples self-test: ${cases.length} cases pass (marker adjacency both directions, orphans, nested illustration, json/jsonc, the bare-\`any\` guard in both directions with its shrink-only baseline, the ROOT BOUND in both directions with its own shrink-only baseline and control, the PUBLISHED-TYPE inventory with its positive and negative controls plus the shadowing ledger in both directions, and the compiler legs through the real harness).`,
  );
  return EXIT_CODES.verified;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : main());
}

export { main };
