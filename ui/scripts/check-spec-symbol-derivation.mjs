#!/usr/bin/env node
/**
 * A spec-named symbol must be DERIVED from `@objectstack/spec`, not hand-written.
 *
 * The failure class (objectstack#4115): objectui declares a local type or const
 * under the SAME NAME as a `@objectstack/spec` export, with a doc comment
 * claiming spec canonicity — and the declaration has drifted, or is one spec
 * release away from drifting. Every audited instance had:
 *
 *   ActionType            "canonical definition from @objectstack/spec"  → hand union, missing `form`   (#2231/#2901)
 *   ChartType             (sibling schema re-exported under spec's name) → 7 of 19 members             (objectui#2944)
 *   ActionLocation + 2    "single source of truth… re-export here"       → re-DECLARED union + z.enum   (#4074)
 *   ActionParamFieldType  "aligned with the field types available in spec" → 16 of 49 members           (#4074)
 *
 * What makes this class expensive is specific to agent-driven development: an
 * agent reads the comment, takes it as ground truth, and builds on it. #2901 was
 * filed with a backwards premise because the fork was re-exported under the
 * spec's own symbol name. A wrong canonical-claim is not stale documentation —
 * it is a planted premise for the next session.
 *
 * This guard lands the rule AS THE CHECK, not as an AGENTS.md paragraph. A
 * prose-only rule is precisely the "declared ≠ enforced" landmine the whole
 * thread is about (#4074, objectui#3009 — where a guard file's own header
 * falsely claimed its checks were "the real enforcement" for the entire interval
 * during which nothing compiled them).
 *
 * ── What counts as derived ───────────────────────────────────────────────────
 * Both of the repo's sanctioned forms pass, because both bind the local name to
 * the spec at compile time:
 *
 *   export type { ActionLocation } from '@objectstack/spec/ui';   // re-export
 *   export type ActionType = z.infer<typeof SpecActionType>;      // derivation
 *
 * A declaration is derived only when the spec reference sits in a STRUCTURAL
 * position — a type alias's own type node, an interface's `extends`, a const's
 * initializer. A spec name merely *mentioned* inside a members block does not
 * count, because that is what a hand-written fork looks like:
 *
 *   export interface ActionSchema { locations?: ActionLocation[] }   // NOT derived
 *
 * Consts are stricter still: object and array literals are not descended into.
 * `export const ACTION_LOCATIONS = [...SpecLocations]` is a COPY, and a faithful
 * copy passes every value comparison — reference identity is the only check that
 * distinguishes a re-export from a fork (objectui#3003, and the insight already
 * written down in `spec-subschema-parity.test.ts`).
 *
 * ── Rule 2: a spec-alignment CLAIM must have something behind it ─────────────
 * Everything above matches BY NAME, and that is the hole objectui#4592 records:
 * a hand copy that was RENAMED away from the spec's symbol has nothing for rule
 * 1 to match, so it passes every run. `ViewNavigationConfig`
 * (packages/types/src/objectql.ts, objectui#4588) was exactly that — the spec's
 * six navigation keys, hand-written, drifted on `mode` (required here, published
 * input-optional by the spec's `.default('page')`), carrying the comment
 * "Aligned with @objectstack/spec ListView.navigation". It was found by a manual
 * census, not by a check.
 *
 * The measured decision (objectui#4592, census in the PR): the STRUCTURAL
 * alternative — "does this local type mirror a spec object's key set, whatever
 * it is called" — was built as a one-off and run over the tree. It reports 38
 * sites at >= 0.80 key overlap, nearly all of them legitimately distinct layers
 * (`ApprovalActionLite`, `SimEdge`, `BulkResult`). An ALLOW map with 38 entries
 * is not a guard, it is a second copy of the codebase, so that instrument was
 * NOT built. Worse for it: the census cannot see the biggest sub-class at all —
 * eight declarations here claim alignment with spec symbols that the installed
 * spec does not export (`ReactionSchema`, `DateFormatSchema`, …), and a key-set
 * comparison has nothing to compare against.
 *
 * What both known instances DID carry is the prose claim. So rule 2 is a
 * heuristic on that claim, and it is deliberately cheap:
 *
 *   FLAG an exported declaration when its own doc comment claims alignment with
 *   `@objectstack/spec` AND the declaration references no spec-bound identifier
 *   anywhere in its body.
 *
 * Claim = one of these phrases, case-insensitive, within CLAIM_WINDOW characters
 * of an `@objectstack/spec` mention in the SAME comment block:
 *
 *   aligned with / aligns with / spec-aligned   mirrors / mirrored / mirroring
 *   matches / matching                          same shape|keys|union|vocabulary as
 *   identical to                                in sync with
 *   canonical                                   source of truth
 *   copy of / copied from                       conforms to
 *
 * EVERY occurrence of each phrase is tested, not just the first (objectui#8819).
 * One `exec` per pattern meant an innocent early "mirror"/"match" — ordinary
 * English in technical prose — consumed the single examination, and a real claim
 * sitting beside a mention LATER in the same block went unexamined. That failed
 * PERMISSIVE: the gate returned green on precisely the planted premise its own
 * failure text is written against. Measured on the tree that landed the repair:
 * the verdict set over every scanned package source is unchanged, 0 newly
 * flagged — the masking condition was demonstrable, an escaped claim was not.
 *
 * Three precision rules, each of which removed real false positives from the
 * measured run — they are load-bearing, not decoration:
 *
 *   - Only the comment block ATTACHED to the declaration is read, never the
 *     file's licence banner. Reading all leading comments let a banner's prose
 *     supply the claim phrase for whichever declaration happened to sit first.
 *   - The claim phrase must sit within CLAIM_WINDOW of the spec mention.
 *     `ChartDataSeries` (packages/types/src/data-display.ts) reads "positionally
 *     aligned with the chart's `categories`" and separately explains what
 *     `@objectstack/spec/ui` owns — a model citizen that a bare co-occurrence
 *     test flags and a proximity test does not.
 *   - Renderers are not shapes. A function, class, or const initialised with an
 *     arrow/function/call expression is skipped, on the same judgement that was
 *     once written by hand as the ALLOW entries for `AuthProvider` / `ListView`
 *     / `UserFilters` and is now made structurally by rule 1's `rendersJsx` (all
 *     three entries are gone; their tombstones are in ALLOW): a component that
 *     RENDERS the spec's shape is not a second declaration of it, so "Aligned
 *     with @objectstack/spec ReactionSchema" on a `<ReactionPicker>` is a
 *     statement about what it draws.
 *
 * ── The tie is judged against the symbols the claim CITES (objectui#4607) ────
 * The tie test above asks "does this declaration reference ANY spec-bound
 * identifier". That question is symbol-AGNOSTIC, so a claim about symbol X
 * passed on an incidental reference to an unrelated symbol Y.
 *
 * The measured specimen: `FeedItem` (packages/types/src/views.ts) carried
 * "Aligned with @objectstack/spec FeedItemSchema" while `FeedItemSchema` had
 * been removed from `@objectstack/spec/data` in the 16.0.0 major — and it never
 * appeared in a single gate run, purely because one member is typed
 * `FeedItemType`, the one feed symbol that survived the removal. It sat four
 * lines from a section banner making the same claim, in the same file as four
 * declarations that WERE flagged, and it was found by reading the file rather
 * than by any run of this script.
 *
 * Note the asymmetry, which is what made it expensive: the more spec-integrated
 * a declaration is, the weaker the check on its prose became. A fully
 * hand-written fork got its claim scrutinised; one importing a single live spec
 * type for one member did not.
 *
 * Hence the fourth precision rule, deliberately narrow:
 *
 *   When the claim NAMES symbols and EVERY one of them is absent from the
 *   installed spec's export set, the declaration is flagged whatever else it
 *   references. A tie to a DIFFERENT symbol is not something behind THIS claim.
 *
 * Two limits on it, both deliberate:
 *
 *   - A claim naming at least one LIVE symbol stays governed by the tie test
 *     above, unchanged. A claim citing live `A` while tied to live `B` is a
 *     claim-vs-tie MISMATCH, and judging those is a KNOWN NON-GOAL of this rule
 *     (objectui#4607). It would need a name-relatedness allowance for the
 *     legitimate `type: FeedItemType` shape — where the citation and the tie are
 *     genuinely different-but-related symbols — and that allowance is a
 *     different instrument, not a tightening of this one.
 *   - Given no spec export set to check against, nothing can be known to dangle
 *     and this rule stays out of the way entirely. A verdict fabricated from
 *     ignorance of the spec would flag every citation in the repo at once.
 *
 * ── Rule 4 at MEMBER granularity (objectui#7513) ────────────────────────────
 * Rule 4 above judges the SYMBOL a claim cites. It cannot see a citation that
 * names a live symbol and a key that symbol does not have, and that is the shape
 * three measured comments took:
 *
 *   `SelectOptionSchema.description`  the option schema is `.strict()` and spells
 *                                     five keys, none of them `description`
 *   `FieldSchema.rows`                `rows` is not a field key at all
 *   `DashboardSchema.title`           the dashboard display name is `label`
 *
 * Every one of them named a symbol the spec really exports, so rule 4 passed
 * them, and every one of them was inviting a `422 INVALID_METADATA` — the option
 * two routed a `description` into a `.strict()` option schema, which refuses the
 * WHOLE field. So the citation is checked at the granularity it was written at:
 *
 *   A comment citing `SpecSymbol.key`, where the spec's own shape for that
 *   symbol has no `key`, is a dangling reference and is flagged.
 *
 * This is rule 4 tightened, not a second instrument: same question (is there
 * anything behind what this comment points at), same answer when the answer is
 * "no", no allowlist and no ledger of its own. Fresh citations fail on the PR
 * that writes them; there is nothing here to accrue.
 *
 * Where it looks, and why that is WIDER than rule 2's jurisdiction without being
 * rule 2's deferred widening (objectui#7513 defers that as B): every comment in
 * the scanned files, not only the block attached to a top-level declaration.
 * Two of the three specimens sat on interface MEMBERS and one sat inside a
 * function body, so a declaration-scoped scan sees none of them. It is not the
 * same widening because it asks a different question: rule 2 asks whether a
 * DECLARATION has a compile-time tie behind its claim, which needs a declaration
 * and a tie test; this asks only whether a NAME the prose spells exists in the
 * spec, which needs neither. It also needs no claim phrase — one specimen read
 * "Per @objectstack/spec, DashboardSchema.title is …", which no phrase table
 * matches and which is wrong all the same.
 *
 * Four precision rules, each measured against the tree rather than imagined:
 *
 *   - The comment must mention `@objectstack/spec`, and the citation must sit
 *     within CLAIM_WINDOW of that mention IN THE SAME SENTENCE — rule 2's
 *     proximity discipline, reused rather than reinvented. Without it,
 *     `ListView.resolveTimelineDateBinding` (a method on this repo's own
 *     component, 755 characters from an unrelated spec mention) and
 *     `NavigationItem.label` read as spec citations. Measured: 136 raw citations
 *     tree-wide collapse to 73 real ones.
 *   - A `/` on either side makes it a PATH, not a citation. `@objectstack/spec`
 *     `ui/TimelineConfig.json` is a file the comment is pointing at, and
 *     `json`/`tsx` are not members of anything.
 *   - The member set is the union over the spec's symbol FAMILY — `N`,
 *     `NSchema`, `NInput`, `NParsed` — taken on the AUTHORING side (a schema's
 *     `.shape`, hopping through a `ZodPipe`'s `.in`) rather than the parsed
 *     output. A citation names a concept, and the spec publishes a concept as a
 *     family. ⭐ This is load-bearing, not tidiness: `FormField.visibleOn` is a
 *     real authorable key that the spec's OUTPUT type deliberately drops
 *     (`type FormField = Omit< z.infer< … >, 'visibleOn' > & …`), so reading the
 *     output type alone reports a correct comment as dangling.
 *   - Zod's own API is excluded BY RULE, two predicates, never by allowlist
 *     entries — see `isZodApiCitation`.
 *
 * MEASURED on `1bae75bb` against `@objectstack/spec@17.2.0`:
 *
 *   raw `Symbol.member` citations in spec-mentioning comments   136
 *   within CLAIM_WINDOW and the same sentence                    73
 *     resolve against the family's authored shape                64
 *     excluded as Zod API (5 call-form, 4 vocabulary)             9
 *     member set unknowable, rule stays out                       0
 *     DANGLING                                                    0
 *
 * Zero, because all three specimens were repaired before this landed (PR #7510,
 * PR #7520) — which is why the pin in `scripts/__tests__/` asserts the rule goes
 * RED on their verbatim PRE-repair text. A ratchet that only proves green on
 * today's tree proves nothing about the tightening. These figures are a
 * SNAPSHOT, under the same discipline the sections above record: when they move,
 * re-take them and re-name the commit and the spec version.
 *
 * ── Rule 4's second transport: published prose (objectui#7995) ─────────────
 * Rule 4 at member granularity reads every COMMENT in the scanned sources. The
 * receipt that this was not enough is objectui#7537: PR #7510 corrected three
 * JSDoc claims that the installed spec declared a key it refused by name, and a
 * FOURTH copy of one of them was sitting in `content/docs/fields/lookup.mdx` in
 * prose. It survived that PR untouched, shipped, and was corrected only because
 * a human noticed it by eye. Prose is attached to no declaration, so rules 1 and
 * 2 have nothing to ask their question OF — but this rule asks only whether a
 * NAME the prose spells exists in the spec, and nothing about that question
 * needs a declaration, a tie, or a claim phrase.
 *
 * So the scan surface widens to `content/docs/**` and the RULE does not move:
 * `memberCitationsIn` is the single grammar both transports call, and the
 * TypeScript side was refactored ONTO it rather than having a second copy
 * written beside it. Two dialects of one rule is the failure this file's own
 * commandment #0.1 names; a gate is not exempt from it.
 *
 * What is transport-specific, and decides nothing: a comment BLOCK is the scope
 * on the TS side, a PARAGRAPH is the scope in markdown. That analogue is
 * load-bearing rather than tidy — a markdown heading carries no sentence
 * terminator, so without blank lines as hard boundaries the same-sentence test
 * would measure across a heading into an unrelated section.
 *
 * MEASURED on `411a132c0` against `@objectstack/spec@17.3.0`, over
 * `content/docs/**` — a census taken BEFORE the widening was enforced, because a
 * gate written against an unknown population is how a scan-surface widening
 * lands as a wall of reds:
 *
 *   documentation pages                                         184
 *     mentioning `@objectstack/spec` at all                       32
 *   raw `Symbol.member` citations in those pages                 183
 *     naming a spec export whose member set is knowable            5
 *     within CLAIM_WINDOW and the same sentence                    3
 *       resolve against the family's authored shape                3
 *       excluded as Zod API                                        0
 *       DANGLING                                                   0
 *
 * The three that survive are `FormViewSchema.type`, `DashboardWidgetSchema.
 * filterBindings` and `PageHeaderProps.icon`, and all three are correct — so
 * this widening lands with zero corrections, zero waivers and no ledger of its
 * own. ⭐ Zero is a MEASUREMENT, not a design goal: 183 raw citations collapsing
 * to 3 judged ones is what the precision rules inherited from the TS side buy,
 * and it is the number to re-take when they change.
 *
 * Fenced code blocks are scanned like the rest of the page. Measured both ways:
 * skipping fences drops the raw count 183 → 128 and leaves the judged 5 / 3 / 0
 * untouched, so a fence rule would be a precision claim with nothing behind it.
 *
 * ⚠️ The known property this widening INHERITS, stated so nobody rediscovers it
 * as a surprise: the rule reads a spelling, not an assertion. A page explaining
 * that the spec REFUSES `SelectOptionSchema.icon` reads identically to one
 * claiming it declares it — the same shape as the closing-keyword parser that
 * ignores negation. It is not new here (the TS side has always had it), and the
 * measured population is zero, and the escape is the wording the repaired
 * comments already use: name the symbol and the key without joining them with a
 * dot. If that ever costs a real page, it is a card about the grammar, not a
 * reason to narrow the surface back.
 *
 * These figures are a SNAPSHOT, under the same discipline as every other
 * measured section here: when they move, re-take them and re-name the commit and
 * the spec version — never edit the numbers in place under the old ones.
 *
 * ── The boundary the rules USED to share: exported only (objectui#5899) ─────
 * ⛔ HISTORY, NOT BEHAVIOUR. Neither scanner has an export filter today. Both
 * halves went in objectui#6291, and the two `// No export filter (objectui#6291)`
 * comments in `scanFileForClaims` and `scanFile` are where that is stated at the
 * code. Read this section for WHY the filter was dropped and what dropping it
 * measured — never as a description of what the scanners currently do.
 *
 * The tense matters more here than it looks. This paragraph used to describe the
 * filter in the present, beside a `hasExportModifier` helper that had already
 * lost its last call site, and a card was filed on the strength of it: it
 * explained a gate's blindness as "both rules skip any declaration without an
 * `export` modifier (`hasExportModifier`, applied once per scanner)", which had
 * not been true since objectui#6291. The author did not invent that — they read
 * it HERE. A guard whose own header teaches a retired rule is the same planted
 * premise this file exists to catch, wearing the maintainer's clothes, so the
 * helper is gone too (objectui#7513) and there is nothing left to grep into a
 * false conclusion.
 *
 * What the filter WAS, in the past tense it belongs in: each scanner skipped any
 * statement without an `export` modifier, once per scanner. The class was
 * therefore NOT fully covered by rule 1 plus rule 2 — a module-local declaration
 * sat outside the jurisdiction of both, whatever it was named and whatever its
 * doc comment claimed. Read on for what each half cost.
 *
 * The filter was defensible on this script's own terms: an unexported type
 * cannot be imported by another package under the spec's name, so it cannot
 * become a planted premise through the package's public surface. objectui#5652
 * measured the other half. Three hand-written mirrors of the `FormViewSchema`
 * contract in `packages/react/src/spec-bridge/bridges/form-view.ts` had drifted
 * on three keys and had INVERTED one arm — it admitted only the value the
 * contract rejects — and two of the three were declared under the spec's own
 * export names (`FormField`, `FormSection`), which is precisely rule 1's
 * trigger. The gate was green throughout, because all three were module-local
 * `interface`s; they were found by a human reading the file. An unexported
 * mirror is not imported, but it is still READ by the next agent editing that
 * file, and it still drifts.
 *
 * What the filter cost, MEASURED (objectui#5899) on `a76b18cf2` against
 * `@objectstack/spec@17.2.0` — same instrumented-copy method objectui#4592
 * used. ⚠️ The instrument was an INSTRUMENTED COPY that re-imposed the filter on
 * both scanners, not a switch either scanner still carries; the numbers are the
 * measured price of the filter, taken while it still existed:
 *
 *   rule 1   18 findings → 47   (+29 module-local declarations)
 *   rule 2   20 findings → 22   (+2  module-local declarations)
 *   distinct additional declarations: 30 (one is flagged by both rules)
 *
 * Classified by READING every site; the per-entry census is in objectui#5899's
 * PR body:
 *
 *   22 of 30 are REAL MIRRORS of the spec symbol they are named after, and 12
 *   of those carry a divergence measurable TODAY rather than merely possible.
 *   `FlowNode` (metadata-admin/inspectors/FlowNodeInspector.tsx) declares a
 *   `description` key the spec's `.strict()` `FlowNodeSchema` REJECTS, and
 *   makes `label` optional where the spec requires it. `AppLike`, `ObjectLike`,
 *   `RemoteTable` and `FlowRuntimeState` each relax a spec-REQUIRED key to
 *   optional. `CURATED_CAPABILITY_LABELS` says it mirrors `PLATFORM_CAPABILITIES`
 *   and is missing the member the spec has since added (`manage_sharing`), so
 *   that capability silently loses its localized label.
 *   `EXPLAIN_BATCH_MAX_RECORD_IDS` states in its own comment that it exists
 *   only until the spec pin exports it — and the pin now does. `ActionParam`
 *   and `FlowEdge` each exist TWICE inside one package, and each pair already
 *   disagrees with itself.
 *
 *   8 of 30 are legitimate module-local shapes, in two kinds. Four are
 *   different concepts sharing a name — `SearchResult` (the spec's is the
 *   search RESPONSE `{hits,totalHits,…}`; this is one result ROW), `Dimension`,
 *   `ModelConfig`, and two local React `Field` components. Four are ALREADY
 *   derived, one hop outside where this scan looks: `type FlowNode =
 *   FlowDesignerNode` and its edge twin alias the canvas's own types, and
 *   `DashboardWidget` aliases an `@object-ui/types` schema that is itself
 *   spec-derived.
 *
 * That census forced the split ruled in objectui#6291: rule 2's filter is a
 * clean one-liner, rule 1's is a scoped change, and doing both at once would
 * land 29 reds and four avoidable waivers against this header's own standard
 * that an ALLOW map with dozens of entries is not a guard.
 *
 * ── Rule 2's half of the split: SHIPPED (objectui#6291) ─────────────────────
 * `scanFileForClaims` no longer filters on `export`. Re-measured on the
 * implementing commit against `@objectstack/spec@17.2.0` — the a76b18cf2
 * figures above had already moved, which is exactly why they are re-taken
 * rather than transcribed:
 *
 *   rule 2   18 unbacked claims → 19   (+1 module-local declaration)
 *
 * ONE, not the two measured at a76b18cf2. `CURATED_CAPABILITY_LABELS`
 * (packages/fields) was the other, and objectui#6285 fixed it in the interval:
 * its comment no longer claims alignment in prose, because
 * `CapabilityMultiSelectField.specParity-6285.test.tsx` now CHECKS the equality
 * against `PLATFORM_CAPABILITIES` in both directions. That is the burn-down
 * this rule exists to provoke, and it took the site out of the population
 * before this change could reach it.
 *
 * The one that remains, `CONTEXT_TOKEN_SUGGESTIONS` (@object-ui/core), is a
 * real mirror and goes to CLAIM_DEBT — see the note there for why a
 * shrink-only block is allowed to grow on a jurisdiction widening. (Burned
 * down at objectui#7265; the figures in this paragraph are the #6291
 * measurement and stay as measured.) Zero
 * legitimate-local fallout, zero CLAIM_ALLOW entries, and the named pin in
 * `scripts/__tests__/check-spec-symbol-derivation.test.ts` was REWRITTEN
 * rather than deleted: it now asserts that a module-local claim IS flagged,
 * beside a second case proving the precision rules — not the `export` keyword
 * — are what keep module-local shapes green.
 *
 * ── Rule 1's half of the split: SHIPPED (objectui#6291) ────────────────────
 * `scanFile` no longer filters on `export` either, and the population it
 * surfaces was scoped first by the two structural narrowings the ruling
 * required. Re-measured on the implementing commit against
 * `@objectstack/spec@17.2.0`:
 *
 *   rule 1, filter dropped, NO narrowings   0 untriaged → 25   (+25)
 *   rule 1, filter dropped, narrowings on   0 untriaged → 19   (+19)
 *
 * 25, not the 29 measured at a76b18cf2. Four sites left the population in the
 * interval, and reading why is the whole argument for re-taking rather than
 * transcribing: `ActionParam` twice (b84dc18 consolidated the two copies that
 * already disagreed with each other), `SelectOption`, and
 * `EXPLAIN_BATCH_MAX_RECORD_IDS` (objectui#6286 — the one whose own comment
 * said it existed only until the spec pin exported the constant).
 *
 * The two narrowings, and what each measurably retires:
 *
 *   `rendersJsx`   — 2 module-local React `Field` components (metadata-admin
 *                    inspectors). ⚠️ NOT `isRendererLike`, which rule 2 uses;
 *                    see that function's own comment for the two REAL MIRRORS a
 *                    blanket "functions are renderers" would have silenced.
 *   `isPureAlias`  — 4 aliases: the `FlowNode`/`FlowEdge` pair in FlowPreview,
 *                    and the pair in FlowNodeInspector, which became aliases in
 *                    the interval too (the census had them as real mirrors, one
 *                    of them declaring a `description` key the spec's `.strict()`
 *                    schema rejects; that is fixed at the site now).
 *
 * The remaining 19 split 4 / 15:
 *
 *   4 are different-concept name collisions and got reasoned ALLOW entries —
 *   `SearchResult` (a result ROW, where the spec's is the search RESPONSE),
 *   `Dimension` (the spec's cube dimension REQUIRES `sql` and REJECTS this
 *   shape's own `field`/`dateGranularity` — probed, not guessed), `ModelConfig`
 *   (a model SELECTION against a model REGISTRY RECORD), and `DashboardWidget`
 *   (already derived one hop out, deliberately widened).
 *
 *   15 findings under 14 names are real mirrors and were seeded into DEBT
 *   mechanically by `--ledger`, anchored on objectui#7265.
 *
 * Two ALLOW entries were DELETED by the same commit, and this is the part that
 * exceeded what the ruling predicted: `@object-ui/auth:AuthProvider` and
 * `@object-ui/plugin-list:UserFilters` stopped matching anything, because
 * `rendersJsx` now makes structurally the judgement those entries made by hand.
 * Ratchet 3 requires deleting an entry that excuses nothing — a stale entry
 * reserves the name for a future fork under it — so the narrowing SHRANK the
 * hand-written part of the map while the collisions grew it. Both deletions are
 * documented in place, with what each entry carried beyond the waiver. Net:
 * 16 declared dialects → 18.
 *
 * These figures are a SNAPSHOT. When they move, re-take them and re-name the
 * commit and the spec version — never edit the numbers in place under the old
 * ones. That is the same discipline `scripts/invoked-as.mjs` records for its
 * own measured section (objectui#6260/#6274), and for the same reason: a
 * refreshed count under a stale commit is a measurement nobody can reproduce.
 *
 * `SpecAuthoredInput` (@object-ui/react) counts as derivation evidence by name:
 * its entire purpose is to bind a local type to a spec schema's authoring input.
 *
 * Run:  node scripts/check-spec-symbol-derivation.mjs
 *       node scripts/check-spec-symbol-derivation.mjs --ledger        (rule 1 DEBT)
 *       node scripts/check-spec-symbol-derivation.mjs --claim-ledger  (rule 2 ledger)
 * Exit: 0 = OK, 1 = a spec-named symbol is hand-written, a spec-alignment claim
 *       has nothing behind it, or either allowlist/ledger is stale
 */

import ts from "typescript";
import { createRequire } from "module";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import { isEntrypoint } from "./invoked-as.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── Allowlist ────────────────────────────────────────────────────────────────
// Same governance as `check-type-check-coverage.mjs`'s DEBT map: declared,
// reasoned, shrink-only. An entry that no longer matches a real violation is
// stale and fails this guard, so the list cannot outlive the code it excuses.
//
// A same-name symbol that is narrower or wider ON PURPOSE belongs here with that
// purpose written down — at which point the comment is load-bearing instead of
// decorative. A symbol that is *supposed* to be the spec's should be imported
// instead; that is the whole point of the check.
//
// Key format: "<package>:<symbol>".
const ALLOW = {
  "@object-ui/components:EmptyState": {
    reason:
      "Two LAYERS under one name, measured when `@objectstack/spec` 17.6.0 began exporting " +
      "`EmptyState` from `@objectstack/spec/ui` (objectui#11438). The spec's type is a list " +
      "view's AUTHORED empty-state config (`z.input` of `EmptyStateSchema`: title, message, icon); " +
      "this one is a React COMPONENT, the published alias `DataEmptyState as EmptyState` in " +
      "`view-states.tsx`, which draws an empty state from host props (title, description, icon, " +
      "illustration, action). A component is not a config shape, so neither import nor derivation fits. " +
      "It is a PUBLISHED export of the package, so retiring or renaming the alias changes a public " +
      "name and belongs to its own card, not to the dependency bump that surfaced the collision " +
      "(the same disposition objectui#11073 gave the four `Object*Props` collisions below).",
    issue: 11438,
  },
  "@object-ui/plugin-gantt:ObjectGanttProps": {
    reason:
      "Two LAYERS under one name, measured when `@objectstack/spec` 17.5.0 began exporting " +
      "`ObjectGanttProps` from `@objectstack/spec/ui` (objectui#11073). The spec's type is the " +
      "component's AUTHORED props bag (label, objectName, data, staticData, filter, sort, gantt, navigation, skipWeekends, holidays, persistLayout, viewName, markers, criticalPath, showBaselines, readOnly, mobileReadOnly); this one is the React " +
      "component's props envelope (schema, dataSource, className, onTaskClick, onRowClick, onEdit, onDelete, onBeforeTaskUpdate), which carries the node as `schema` and adds " +
      "host wiring. Neither is assignable to the other, so neither import nor derivation fits. " +
      "It is a PUBLISHED export of the package, so the rename the sibling components use " +
      "(`ObjectGridComponentProps`, `ObjectKanbanComponentProps`, `ObjectCalendarComponentProps`) " +
      "changes a public name and belongs to its own card, not to the dependency bump that " +
      "surfaced the collision.",
    issue: 11073,
  },
  "@object-ui/plugin-map:ObjectMapProps": {
    reason:
      "Two LAYERS under one name, measured when `@objectstack/spec` 17.5.0 began exporting " +
      "`ObjectMapProps` from `@objectstack/spec/ui` (objectui#11073). The spec's type is the " +
      "component's AUTHORED props bag (objectName, data, staticData, filter, sort, navigation, map, mapStyle, enableClustering); this one is the React " +
      "component's props envelope (schema, dataSource, className, data, onMarkerClick, onRowClick, onEdit, onDelete, enableClustering, clusterRadius), which carries the node as `schema` and adds " +
      "host wiring. Neither is assignable to the other, so neither import nor derivation fits. " +
      "It is a PUBLISHED export of the package, so the rename the sibling components use " +
      "(`ObjectGridComponentProps`, `ObjectKanbanComponentProps`, `ObjectCalendarComponentProps`) " +
      "changes a public name and belongs to its own card, not to the dependency bump that " +
      "surfaced the collision.",
    issue: 11073,
  },
  "@object-ui/plugin-timeline:ObjectTimelineProps": {
    reason:
      "Two LAYERS under one name, measured when `@objectstack/spec` 17.5.0 began exporting " +
      "`ObjectTimelineProps` from `@objectstack/spec/ui` (objectui#11073). The spec's type is the " +
      "component's AUTHORED props bag (variant, objectName, data, filter, sort, navigation, items, descriptionField, timeline, limit, dateFormat, rowLabel, minDate, maxDate, mapping); this one is the React " +
      "component's props envelope (schema, dataSource, className, onRowClick, onItemClick), which carries the node as `schema` and adds " +
      "host wiring. Neither is assignable to the other, so neither import nor derivation fits. " +
      "It is a PUBLISHED export of the package, so the rename the sibling components use " +
      "(`ObjectGridComponentProps`, `ObjectKanbanComponentProps`, `ObjectCalendarComponentProps`) " +
      "changes a public name and belongs to its own card, not to the dependency bump that " +
      "surfaced the collision.",
    issue: 11073,
  },
  "@object-ui/plugin-tree:ObjectTreeProps": {
    reason:
      "Two LAYERS under one name, measured when `@objectstack/spec` 17.5.0 began exporting " +
      "`ObjectTreeProps` from `@objectstack/spec/ui` (objectui#11073). The spec's type is the " +
      "component's AUTHORED props bag (objectName, data, staticData, filter, navigation, tree); this one is the React " +
      "component's props envelope (schema, dataSource, className, onRowClick, data, loading), which carries the node as `schema` and adds " +
      "host wiring. Neither is assignable to the other, so neither import nor derivation fits. " +
      "It is a PUBLISHED export of the package, so the rename the sibling components use " +
      "(`ObjectGridComponentProps`, `ObjectKanbanComponentProps`, `ObjectCalendarComponentProps`) " +
      "changes a public name and belongs to its own card, not to the dependency bump that " +
      "surfaced the collision.",
    issue: 11073,
  },
  "@object-ui/types:ActionSchema": {
    reason:
      "`crud.ts`'s explicitly @deprecated legacy action shape, kept for backward " +
      "compatibility and slated for removal in a future major. ⚠️ This entry covered TWO " +
      "objectui-side shapes until objectui#6349: `ui-action.ts` declared a same-named " +
      "renderer VIEW over the spec's action (renderer-only fields the spec does not model, " +
      "importing the spec-owned parts it shares — `ActionLocation`, `ActionType`). That one " +
      "is now declared as `UIActionSchema`, the name the package always published it under, " +
      "so it no longer shadows a spec export and no longer needs excusing here. This entry " +
      "stays because `crud.ts` still carries the name.",
    issue: 4115,
  },
  "@object-ui/types:FormField": {
    reason:
      "Two-LAYER vocabulary, not two dialects of one concept (objectui#3090): the spec's " +
      "FormField is the authored form-VIEW shape (`field` = object-field reference, presentation " +
      "deltas only) while this is the runtime widget config (`name` = form data path, " +
      "self-contained). Not derivable. ⚠️ It is NOT the `any` erasure that blocks this any more: " +
      "objectstack#4171 landed and the spec's FormField is typed — `spec-derived-unions.test.ts` " +
      "pins `_specFormFieldIsNoLongerAny`. The blocker is the two-LAYER split above, which " +
      "precision does not touch (guard header case 2c). The layers meet only in " +
      "`normalizeSectionField` (@object-ui/plugin-form), gated by " +
      "sectionFields.spec-parity.test.ts (per-key behavioral coverage of the spec key set, both " +
      "directions). Misimport of the spec names is banned by the no-restricted-imports entry in " +
      "eslint.config.js.",
    issue: 4115,
  },
  "@object-ui/types:FormFieldSchema": {
    reason:
      "Zod twin of the two-layer FormField split (objectui#3090): validates the RUNTIME " +
      "vocabulary (`name` + widget `type`) that `objectui validate` enforces; the spec's " +
      "FormFieldSchema validates the authored form-view layer. Key set pinned by " +
      "packages/types/src/__tests__/form-field-zod-coverage.test.ts; the spec-shape rejection " +
      "(`{ field: … }` stays invalid here) is pinned there too, and the CLI names the boundary " +
      "in its error output instead of suggesting a lossy rename.",
    issue: 4115,
  },
  "@object-ui/types:SelectOptionSchema": {
    reason:
      "Spec-derived dialect (objectui#3090): spec keys flow in by reference via " +
      "`SpecSelectOptionSchema.shape`, with two pinned divergences (`value` widened to " +
      "string|number|boolean for standalone UI forms; `visibleWhen` kept on the #2212 wire " +
      "contract instead of the spec's envelope-canonicalizing ExpressionInput pipe) and two " +
      "UI-only extensions (`disabled`, `icon`). Drift guard: " +
      "packages/types/src/__tests__/select-option-spec-parity.test.ts — it fails if the spec " +
      "adds a key, retires one, claims an extension name, or widens `value` itself.",
    issue: 4115,
  },
  "@object-ui/types:ListViewSchema": {
    reason:
      "TS twin of the spec-derived `ListViewSchema` zod node (objectql.zod.ts), which DOES " +
      "import the spec's fields by reference at its declaration. This alias cannot carry that " +
      "reference structurally: the spec's `ListViewSchema` is a zod VALUE, so there is no spec " +
      "TYPE to alias or extend, and the objectui node additionally intersects " +
      "`ListViewRuntimeProps` — callbacks and an imperative refresh trigger that are not " +
      "serialisable view metadata and therefore cannot exist in any schema. Divergence from " +
      "the spec is bounded by the zod derivation, not by this declaration; the drift guard is " +
      "packages/types/src/__tests__/list-view-spec-parity.test.ts, which fails when the spec " +
      "grows an untriaged field, retires one objectui aliases (`type`→`viewType`, relaxed " +
      "`columns`, `filter` alongside legacy `filters`), or someone adds a local key outside " +
      "the sanctioned set.",
    issue: 4115,
  },
  "@object-ui/types:UserFiltersSchema": {
    reason:
      "Declared dialect of the spec's user-filter surface, not a copy of it (objectui#7265, the " +
      "@object-ui/types slice). Three divergences, each measured against the RESOLVED pin " +
      "@objectstack/spec@17.4.0 rather than the version the seeding card asserted against, and " +
      "each load-bearing: (1) `element` is REQUIRED and admits only `dropdown | tabs`, where the " +
      "spec defaults it to `dropdown` and keeps `toggle` in ITS enum so shipped configs keep " +
      "rendering (ADR-0047 3.4a) - ADR-0053 makes `toggle` unauthorable on this side, and the " +
      "refusal is what `phase2-schemas.test.ts` pins; (2) `tabs` is this package's legacy preset " +
      "dialect, where the spec's slot is a strict ViewTabSchema that requires `name` and therefore " +
      "REJECTS the `{ id, filters, default }` documents this schema accepts and " +
      "`normalizeTabPresets` (@object-ui/plugin-list) normalises at runtime - binding it would 422 " +
      "metadata that renders today; (3) the shape STRIPS unknown keys where the spec's is strict, " +
      "and closing it is a protocol decision about this surface, not a side effect of a burn-down. " +
      "The sibling name in the same block, `UserFilterFieldSchema`, went the OTHER way in the same " +
      "slice - it IS the spec's concept and is now derived from it, with its own two divergences " +
      "confined to the members that carry them. Both are pinned by " +
      "packages/types/src/__tests__/spec-symbol-parity.test.ts, in both directions, so this waiver " +
      "goes red rather than quiet on the day the gap closes.",
    issue: 7265,
  },
  "@object-ui/types:BulkActionParam": {
    reason:
      "Renderer-side dialect of the spec's authored param (objectui#3334). The spec's " +
      "BulkActionParamSchema closes `type` over the FieldWidget enum — right for authored " +
      "view metadata that `objectstack build` validates. This interface types what the " +
      "BulkActionDialog RENDERS, which also includes defs promoted at runtime from object " +
      "actions (`resolveBulkActions`, objectui#3002) whose param types are whatever the " +
      "action declared — so `type` stays an open string and a catch-all index signature " +
      "forwards widget-specific config (min/max/step/…) the way the field renderers expect. " +
      "Divergence pinned by packages/types/src/__tests__/bulk-action-spec-parity.test.ts.",
    issue: 3334,
  },
  "@object-ui/types:BulkActionDef": {
    reason:
      "Renderer-side dialect (objectui#3334): carries `actionDef` — the source object " +
      "ActionDef attached at runtime when a `bulkActions: ['<name>']` entry is promoted " +
      "(objectui#3002/#3139) — which the spec's STRICT BulkActionDefSchema rejects by design " +
      "(it validates authored view metadata, and `actionDef` is a resolution artifact that " +
      "must never be authored). `visible` also stays on the pre-normalization " +
      "`string | { dialect?, source }` wire shape the action bridge forwards. Divergences " +
      "pinned by packages/types/src/__tests__/bulk-action-spec-parity.test.ts; " +
      "`BulkActionOperation` and the param/def spec keys are shared, and the operation union " +
      "is imported from the spec at its declaration in objectql.ts.",
    issue: 3334,
  },
  // `@object-ui/auth:AuthProvider` sat here until objectui#6291. It is gone
  // because the guard now makes its judgement STRUCTURALLY, not because the
  // judgement changed: `rendersJsx` skips a declaration that literally contains
  // JSX, so `export function AuthProvider(…) { return <Ctx.Provider …/> }` is no
  // longer a finding to excuse. The entry's own reason said as much — "a REACT
  // CONTEXT PROVIDER COMPONENT, not a type … nothing about a JSX element could
  // be mistaken for [a `z.ZodEnum` of provider identifiers]". Ratchet 3 requires
  // deleting an entry that excuses nothing; leaving it would reserve the name
  // for a future non-component fork under it.
  //
  // ⚠️ What the entry carried beyond the waiver is NOT lost, and must not be:
  // packages/auth/src/__tests__/auth-spec-parity.test.ts still fails if the
  // spec's `AuthProvider` stops being an enum of provider ids, and
  // `AuthProviderConfig` is still RENAMED to `AuthProviderOptions` rather than
  // excused, because that one names the spec's OAuth registration shape and IS
  // readable as canonical by the next session. A structural skip covers the
  // component; it does not cover the config, and nothing here should be read as
  // saying components are exempt in general.
  "@object-ui/types:NavigationItem": {
    reason:
      "Precise upstream, still not bindable — guard header case 2c. objectstack#4171 landed and " +
      "the spec's NavigationItem is neither `any` nor `unknown` any more, so `no longer any` is " +
      "settled and is NOT a licence to bind. The spec models navigation as a nine-variant " +
      "discriminated union; objectui keeps a flat entry shape carrying `visible: boolean` (the spec " +
      "takes a CEL string / Expression envelope, and `menuItemToNavigationItem` MANUFACTURES a " +
      "boolean when it inverts legacy `MenuItem.hidden`), plus `pinned` (`useNavPins` + " +
      "`FavoritesProvider`) and `defaultOpen`, neither of which the spec declares at either tier. " +
      "Its separator arm agrees with the spec's since objectui#10867, which removed the " +
      "separator `label`. Each remaining blocker is pinned one-per-line in " +
      "packages/types/src/__tests__/spec-derived-unions.test.ts, written to stop compiling the day " +
      "that specific blocker lifts. What IS derivable is already derived (`NavigationItemType` and " +
      "the per-branch keys come off the spec).",
    issue: 4115,
  },
  "@object-ui/types:NavigationItemSchema": {
    reason:
      "Zod twin of the NavigationItem dialect, and the case where a precise upstream is most " +
      "dangerous. The spec now ships `NavigationItemSchema: z.ZodType<NavigationItem, " +
      "NavigationItemInput>` — pinned by `_specNavSchemaIsNoLongerAny` — so the ledger's stated " +
      "reason (`the spec's is z.ZodType<any> and would validate nothing`) is spent. The live " +
      "blocker is RUNTIME shape, invisible to every type-level probe: this schema has a published " +
      "consumer in `objectui validate`, and referencing the spec's would make it REJECT metadata " +
      "objectui accepts today — `pinned` and `defaultOpen` fail " +
      "`unrecognized_keys` against the spec's `.strict()` branches, `visible: boolean` fails " +
      "`invalid_union`, and a one-character `id` fails `too_small`. All four are pinned, behind two " +
      "positive controls, in packages/types/src/__tests__/navigation-spec-parity.test.ts; a separator " +
      "`label` was a fifth until objectui#10867 made this mirror refuse it too. " +
      "Converging on the union is a breaking change tracked separately.",
    issue: 4115,
  },
  "@object-ui/types:SelectOption": {
    reason:
      "TS twin of the SelectOptionSchema dialect (objectui#3090): carries every spec key " +
      "(label/value/color/default/visibleWhen) plus the documented UI-only extensions " +
      "(`disabled`, `icon`). Kept an interface because the spec type is sound but the " +
      "objectui `value`/`visibleWhen` divergences are deliberate; the zod twin's parity " +
      "test pins the key set.",
    issue: 4115,
  },
  // Two names the spec started exporting in 17.0.0-rc.1. Both were triaged when
  // the bump landed (objectui#3178) and neither is a dialect of the spec's
  // concept — they are unrelated things that happen to share a name.
  "@object-ui/types:FieldNode": {
    reason:
      "Same name, unrelated concepts. The spec's `FieldNode` is a bare `string` — a field " +
      "NAME — after objectstack#4196 narrowed `QueryAST.fields` to names (the old union's " +
      "nested-select member was produced by nothing and consumed by nothing). This is a NODE " +
      "in objectui's own query AST (`{ type: 'field', table?, name, alias? }`), a sibling of " +
      "`LiteralNode` / `OperatorNode` / `JoinNode`. Deriving would replace a structured node " +
      "with a string; there is nothing to import.",
    issue: 4115,
  },
  "@object-ui/app-shell:InboxNotification": {
    reason:
      "Two LAYERS, like the FormField entry above. The spec's is the notification SERVICE " +
      "contract (`INotificationService.listInbox`): camelCase, `body` and `read` required, " +
      "`actionUrl`/`createdAt`. This is the materialized inbox ROW the popover groups — " +
      "snake_case mirroring `sys_notification` (`action_url`), carrying the read-receipt keys " +
      "the contract has no place for (`notification_id`, `receipt_id`, ADR-0030) and nullable " +
      "where a stored row can be null. A row is not a response.",
    issue: 4115,
  },
  // `@object-ui/plugin-list:ListView` and `@object-ui/plugin-list:UserFilters`
  // both sat here — two RENDERERS judged by the AuthProvider rule above and NOT
  // by "components are exempt" (the sibling `ViewTab` in the same package was a
  // hand copy under a spec name and was derived, objectui#3160). Both entries
  // are gone now, and neither judgement changed: `rendersJsx` skips a
  // declaration that literally contains JSX, so neither
  // `export function UserFilters(…)` nor the component at ListView.tsx makes a
  // finding for an entry to excuse. Ratchet 3 requires deleting an entry that
  // excuses nothing.
  //
  // The two left on DIFFERENT dates, and the gap is the whole point of
  // objectui#7275. `UserFilters` went with objectui#6291's narrowing.
  // `ListView` outlived it by matching a SECOND finding the narrowing did not
  // touch — not the component, but the bare `export { ListView, … }` in
  // packages/plugin-list/src/index.tsx, recorded at the BARREL because the
  // re-export arm's skip read a module specifier that spelling does not write.
  // objectui#7275 resolved a bare re-export against the file's own imports, the
  // barrel line stopped being a finding, and ratchet 3 then failed this entry
  // exactly as it had failed the other two. ⇒ Three entries written on one
  // judgement, all three now made structurally, none of them reachable by
  // editing a barrel.
  //
  // ⚠️ What the entries carried beyond the waiver is NOT lost:
  // packages/plugin-list/src/__tests__/spec-symbol-batch6.test.tsx still fails
  // if the spec's `ListView` stops being authored metadata or if the export
  // stops being a component that consumes it (`ListViewProps['schema']` is
  // `ListViewSchema`), and still asserts `UserFiltersProps['config']` accepts
  // the spec's authored `UserFilters`. The repo also disambiguates from the
  // other side — `@object-ui/types` re-exports the spec's type as
  // `SpecListView`. ⛔ Do not re-add either entry to make a count match: after
  // objectui#7275 neither name produces a finding at all, so an entry under it
  // would be stale on the run that added it.
  // ── Different-concept name collisions, module-local (objectui#6291) ───────
  // The four the export-filter drop surfaced that are NOT mirrors. Each was
  // read at its site and, where the spec's symbol is a schema, probed with
  // `safeParse` on this commit rather than judged by name.
  "@object-ui/app-shell:SearchResult": {
    reason:
      "A ROW is not a RESPONSE — the `InboxNotification` judgement above, one layer over. " +
      "`@objectstack/spec/contracts`' `SearchResult` is what `ISearchService.search()` " +
      "RESOLVES TO: `{ hits: SearchHit[], totalHits, processingTimeMs?, facets? }`. This is one " +
      "rendered result row in the search page's flat list — `{ id, label, href, type: " +
      "'object'|'dashboard'|'page'|'report', description? }` — built from the navigation tree, " +
      "not from a search service at all. The two share no key. Deriving one from the other " +
      "would be a type error, not a tightening.",
    issue: 4115,
  },
  "@object-ui/app-shell:Dimension": {
    reason:
      "Different vocabularies, measured. `@objectstack/spec/data`'s `DimensionSchema` is the " +
      "semantic-layer CUBE dimension — keys `{name, label, description, type, sql, " +
      "granularities}` — and it REQUIRES `sql`. The dataset inspector's local shape is the " +
      "authored dataset field `{name?, label?, field?, type?, dateGranularity?}`. Probed on " +
      "this commit: the local instance fails the spec schema with `invalid_type` on `sql` and " +
      "`unrecognized_keys: [\"field\", \"dateGranularity\"]` — the two keys that carry this " +
      "shape's whole meaning are the two the spec rejects. The spec exports no `DatasetSchema` " +
      "for the inspector to bind against, so there is nothing to derive from either.",
    issue: 4115,
  },
  "@object-ui/app-shell:ModelConfig": {
    reason:
      "A model SELECTION is not a model REGISTRY RECORD. `@objectstack/spec/ai`'s " +
      "`ModelConfigSchema` describes a model the platform offers — `{id, name, version, " +
      "provider, capabilities, limits, pricing, endpoint, apiKey, secretRef, region, …}`, with " +
      "`id`/`name`/`version`/`capabilities`/`limits` all REQUIRED. `AgentPreview`'s local " +
      "shape is an agent's CHOICE among them, `{provider?, model?, temperature?, maxTokens?}`, " +
      "read off a draft for a preview panel. Probed on this commit: the local instance fails " +
      "the spec schema on all five required keys, and `model`/`temperature`/`maxTokens` are " +
      "not registry keys at all.",
    issue: 4115,
  },
  "@object-ui/app-shell:DashboardWidget": {
    reason:
      "ALREADY derived, one hop outside where rule 1 looks, and deliberately wider. " +
      "`type DashboardWidget = DashboardWidgetSchema & { id: string }` where " +
      "`DashboardWidgetSchema` is `@object-ui/types`' interface, itself declared " +
      "`extends Omit<Partial<SpecDashboardWidget>, …>` — so every spec key flows in through " +
      "that `extends` and tracks the protocol. The intersection restores `id` to REQUIRED, " +
      "which the `Partial<>` had relaxed for stored legacy widgets that omit it; the inspector " +
      "only ever handles widgets it has already keyed. Deliberately NOT covered by the " +
      "`isPureAlias` narrowing — that one is the narrowest possible reading (a bare type " +
      "reference, nothing else), and an intersection that WIDENS a spec shape is exactly the " +
      "case this map exists to make someone write a reason for.",
    issue: 4115,
  },
  // ── Re-homed layout vocabulary, objectui#7580 — ENTRIES RETIRED, spec 17.3.0 ──
  // `@object-ui/types:BreakpointName` and `@object-ui/layout:BreakpointColumnMap`
  // lived here for exactly the interval their own text described: a maintainer
  // ruling localized the `ui/responsive` vocabulary while objectstack#11027's
  // upstream retirement was MERGED but not yet RELEASED, so the local
  // declarations and live spec exports shared a name. 17.3.0 published the
  // retirement, the collisions ended, ratchet 3 failed both entries as excusing
  // nothing, and the pin bump deleted them — the disposition the entries
  // themselves prescribed. The vacancy is pinned where it can execute:
  // page-nav-misc-spec-parity.test.ts asserts both names ABSENT from the spec
  // export set, so an upstream re-publish is a loud collision rather than an
  // exemption a future fork inherits under the same name.
  // The three theme document types (`Theme`, `ThemeMode`, `ColorPalette`,
  // objectui#5716 ruling, option A — localize) carried ALLOW entries here from
  // the localization until the `@objectstack/spec` 17.2.0 refresh
  // (objectui#5668). 17.2.0 shipped the theme-module retirement
  // (objectstack#10485 / PR objectstack#10695), the names stopped colliding,
  // the entries went stale exactly as their own comment predicted, and the
  // refresh PR deleted them. The vacancy is pinned where it can execute:
  // page-nav-misc-spec-parity.test.ts asserts all three names ABSENT from the
  // spec export set, so an upstream re-publish is a loud collision, not an
  // inherited exemption.
};

// ── Untriaged collisions (the ledger) ────────────────────────────────────────
// Same governance as `check-type-check-coverage.mjs`'s DEBT map: declared,
// shrink-only. These are the same-name symbols that predate this guard and have
// not been triaged one-by-one yet. This check exists to stop the BLEEDING — a
// new fork fails on the PR that writes it — not to retro-fix every symbol at once.
//
// Named symbols rather than a per-package COUNT, deliberately: a count is a
// budget. It lets the next fork land as long as an unrelated one was fixed in
// the same PR, and it makes the failure message point at whichever collisions
// happen to sort first instead of at the one just written. The list is longer;
// it is also the thing that names the new symbol at the moment it appears.
//
// To burn one down: import/derive it from the spec, rename it to a declared
// local dialect (`ObjectUiLocal…`, with a tripwire test asserting the spec does
// not own the name), or move it to ALLOW with the reason it deliberately
// differs. Then delete it from this list — leaving it here fails the ratchet.
//
// ── Triage first, and do not trust `extends` alone ───────────────────────────
// The obvious way to decide whether a collision is a safe re-export is to ask
// the compiler whether the two types are mutually assignable:
//
//     type A = [Local] extends [Spec] ? true : false
//     type B = [Spec] extends [Local] ? true : false   // A && B → "identical"
//
// That question lies in three ways, and all three occur in this repo. Check for
// them BEFORE acting on an "identical" verdict:
//
//   1. The local declaration resolves to `any` — a recursive zod schema
//      annotated `z.ZodType<any>` (`FilterConditionSchema`,
//      `NavigationItemSchema`). `any` answers every assignability question
//      affirmatively.  Detect: `0 extends (1 & Local) ? true : false`.
//   2. The SPEC export resolves to `any`. Re-exporting such a symbol REPLACES a
//      precise local interface with `any` — a type-safety regression wearing a
//      burn-down's clothes. Detect: the same `0 extends (1 & Spec)` probe — but
//      see 2b and 2c, which that probe does NOT catch.
//
//      History worth keeping, because it is the reason this whole list exists:
//      `NavigationItem`, `JoinNode` and `FormField` were the instances, filed
//      upstream as objectstack#4171. All three are resolved as premises now —
//      `JoinNode` was retired with `query.joins` (framework#4286) and the other
//      two were typed properly in spec 17.0.0-rc.1 — and NEITHER became
//      derivable as a result (objectui#3177). Do not read "no longer `any`" as
//      "safe to bind"; see 2c.
//   2c. The SPEC export is typed but NOT PRECISE, which the `any` and `unknown`
//      probes both report as clean. Two live instances, each pinned with a probe
//      that asks its real blocker (objectui#3177):
//        - `ConditionalValidation.then` / `.otherwise` are
//          `BaseValidationRuleShape` — `type: string` plus `[key: string]:
//          unknown`, i.e. case 3 on the SPEC side. Deriving swaps a
//          discriminated union for a bag. Blocked on objectstack#4075.
//          Detect: `string extends Spec['type']`, and the case-3 probe.
//        - `NavigationItem` / `FormField` are precise but describe a DIFFERENT
//          shape (a nine-variant union vs objectui's flat one) or a different
//          LAYER (spec `field` = an object-field reference; objectui `name` =
//          the form data path, with disjoint required keys). Precision is not
//          equivalence. Detect: per-key, per-tier probes — a structural
//          `extends` permits excess properties and so cannot see a key the spec
//          does not declare.
//      Both sets live in `spec-derived-unions.test.ts` /
//      `validation-rule-spec-parity.test.ts`, written to fail the day the
//      blocker they name lifts.
//   2b. The SPEC export resolves to `unknown` (`JoinedReportBlock` through the
//      published 17.4.0, whose `JoinedReportBlockSchema` those releases declare
//      as `z.ZodTypeAny`; objectstack#20369 typed it, 17.5.0 ships that, and
//      objectui#10940 derived the published type once 17.5.0 was installed — its
//      ALLOW entry retired there). Just as
//      empty as case 2 and just as unburnable, but the `any` probe reports
//      `false` for it, so a triage that only screens for `any` waves it through
//      as "safely derivable". Detect: `[unknown] extends [Spec]`. Pinned in
//      packages/types/src/__tests__/report-chart-query-spec-parity.test.ts
//      (objectui#3155); also filed under objectstack#4171.
//   3. The local declaration carries `[key: string]: any` (`FormField`,
//      `AppSchema`, `PageSchema`, `ThemeSchema`, …) — the objectstack#4075
//      mechanism. An index signature absorbs any extra member, so the two types
//      compare equal while accepting wildly different objects.
//      Detect: `string extends keyof Local ? true : false`.
//
// A zod schema needs one more question than a type does: `_output` equality is
// not enough, because two schemas can agree on output and still accept different
// AUTHORING input. `FormFieldSchema` is exactly that — identical `_output`,
// divergent `_input` — so re-exporting it would silently change what parses.
// Compare `_input` too before touching a schema const.
// Re-anchored at objectui#6291. It was `4115` (objectstack#4115) while the block
// was EMPTY — burned down in objectui#3162, and objectstack#4115 itself closed by
// objectstack#6883. A ledger whose anchor is CLOSED makes the stale-entry message
// below — the one that tells you the anchor can be ended once the ledger is empty
// — a dead instruction, and #6291 could not serve either, being the card its own
// PR closes. objectui#7265 is the open burn-down card for the population seeded
// here. (That message used to spell its own instruction with a GitHub closing
// keyword in front of the number; the reason it no longer does is written at the
// ratchet that emits it, not restated here.)
// ⚠️ `CLAIM_DEBT_ISSUE` a few screens down has the same defect — objectui#4592 is
// closed while its block is still live — and is deliberately NOT changed here,
// because rule 2's ledger is not what objectui#6291 widened. (Still deliberate at
// objectui#7265: its slices have burned names out of BOTH blocks, by BIND, by
// RENAME and by ALLOW as each site allowed, and each one moved a count while
// leaving the dead anchor exactly where it was. How large either block is today
// is deliberately NOT written here — `--ledger` and `--claim-ledger` regenerate
// them from the working tree and the run banner prints both counts, so a figure
// spelled out in this sentence could only be a second, staler answer to a
// question the script already answers, and the sentence it used to end with is
// the one this note now refuses to write again.)
const DEBT_ISSUE = 7265;
// Re-seeded at objectui#6291, mechanically (`--ledger`), when rule 1 stopped
// skipping module-local declarations. ⚠️ The block is SHRINK-ONLY and this is the
// one sanctioned way it grows: the rule's JURISDICTION widened, so these are
// pre-existing mirrors it could not previously SEE, not forks anybody wrote. A
// name may not be added here for any other reason.
//
// Every name still listed is a real mirror, classified by reading its site —
// the different-concept collisions the same widening surfaced went to ALLOW with
// reasons instead, and the two carrying standalone defects beyond the mirroring
// already have cards (objectui#6286, objectui#6287). Re-adding a name here still
// means "collides, not yet triaged"; a name whose triage concluded "deliberate
// divergence" belongs in ALLOW instead. ⚠️ How many are left is deliberately NOT
// written here: `--ledger` regenerates the block and the run banner prints the
// count, so a figure copied into this comment could only be a second, staler
// answer to a question the script already answers (AGENTS.md #9).
//
// Burned down so far, in slices, each by the route its own site allowed:
// `TreeConfig` (@object-ui/plugin-tree), then the @object-ui/core pair
// `CONTEXT_TOKEN_SUGGESTIONS` / `isContextToken` at objectui#7265 — both
// imported from `@objectstack/spec/data` after the identity the seeding card
// asserted against 17.2.0 was RE-MEASURED against the resolved 17.4.0 pin,
// because "byte-identical" is a statement about a version, not a property.
//
// Then the whole `@object-ui/app-shell` group at objectui#7265 — six names, seven
// sites, and deliberately NOT one route for all of them, which is the part worth
// carrying forward. Four were the spec's own concept and were BOUND to it
// (`RemoteTable` imported outright, the sibling client in that same package
// having already made that call; `AdminScope` and `FlowRuntimeState` derived as
// `Partial<>` of the spec type, the widening confined to requiredness and
// documented at each site; `ObjectLike` in `useTrackRouteAsRecent` PICKed down to
// the two members it reads). Three were a DIFFERENT concept wearing the spec's
// name and were renamed instead: `AppLike` → `AppRouteLike` (the ADR-0048 route
// key `_packageId`, which the spec's translator shape does not declare),
// `ObjectLike` in `deriveRelatedLists` → `MergedObjectLike` (carries `list`, a key
// `MetadataProvider` merges on and the spec's closed shape cannot hold), and the
// `FlowEdge` copy in `FlowEdgeInspector`, which was a third hand copy of this
// package's OWN declared dialect `FlowDesignerEdge` and now uses it. Both ratchets
// for the renames live in packages/app-shell/src/__tests__/spec-symbol-parity.test.ts.
//
// Then the `@object-ui/types` pair at objectui#7265, which is the slice where the
// THIRD route finally got used: one name BOUND, one name moved to ALLOW, and the
// two decided by reading their sites rather than by one policy for the group.
// `UserFilterFieldSchema` is the spec's own concept under the spec's own name --
// re-measured against the RESOLVED pin 17.4.0, the two shapes already agreed on
// `field`, `type`, `showCount` and `defaultValues`, the five-member control-type
// enum included -- so it now derives from `@objectstack/spec/ui` through this
// package's import boundary, with TWO divergences confined to the members that
// carry them (`label` stays a plain string because @object-ui/plugin-list renders
// it as a React child, and `options[]` keeps the local element for the same reason
// on its own label) and the object's strip posture restored so no accept set moved.
// `UserFiltersSchema` went to ALLOW instead: `element` is required and refuses the
// spec's `toggle` (ADR-0053), `tabs` is this package's legacy `{ id, filters,
// default }` preset dialect that the spec's strict ViewTabSchema rejects, and
// binding it would 422 metadata that renders today. Both are pinned, in both
// directions, by packages/types/src/__tests__/spec-symbol-parity.test.ts.
//
// Then the `@object-ui/components` slice at objectui#7265, where the route was
// decided by what the extra member MEANS rather than by how many members there
// were. The DataTable renderer declared `SortDirection` as `'asc' | 'desc' |
// null`, and that third state made the RENAME question genuinely live: the
// spec's `SortDirection` -- re-measured at the RESOLVED pin 17.4.0, on the
// `@objectstack/spec/shared` subpath, because byte-identical is a statement
// about a version and so is two-member -- is the direction and nothing else.
// Reading the site settled it the other way. `null` is not a third DIRECTION,
// it is the ABSENCE of one: it is written at exactly one place (the end of the
// client-side header cycle in `handleSort`) and read only by guards that guard
// `sortColumn` in the same breath -- and `sortColumn`, the other half of the
// same state pair, already spelled its own empty case as `useState<string |
// null>` at the slot instead of folding it into a type name. So the concept IS
// the spec's, and the strongest BIND form was available: the type is now
// IMPORTED outright, the local declaration is gone rather than derived, and the
// third state is confined to the one state slot that carries it with the reason
// written there. `applySort`, one screen down, was a second hand copy of the
// same two members inline in its signature and now takes the bound type too.
// The spec-side properties the binding rests on are pinned in this package's
// existing spec-symbol file, packages/components/src/__tests__/
// share-filter-sort-spec-parity.test.ts (appended to, not duplicated); the site
// and the block are pinned in
// scripts/__tests__/spec-symbol-ledger-components-7265.test.ts.
//
// Then the `@object-ui/data-objectstack` slice at objectui#7265, the first where
// the mirror was a FUNCTION rather than a type -- which narrows the routes before
// anybody reads the site. Rule 1 records a function declaration with
// `derived: false` unconditionally (see `rendersJsx`, whose narrowing exists so
// that it keeps doing so), meaning there is no derive-in-place form for a
// function at all: the only exits are to delete the declaration and import the
// spec's, to rename, or to waive.
//
// BIND was refused on a measurement rather than a preference. The spec's
// `normalizeFilterOperator` (`@objectstack/spec/ui`, re-measured against the
// RESOLVED 17.4.0 pin, because "same behaviour" is a statement about a version
// exactly as "byte-identical" is) folds an authored spelling to the canonical
// VIEW vocabulary so `ViewFilterRuleSchema`'s enum can judge it. This package's
// folded the same input to the server's filter-AST SYMBOLS -- a different
// codomain, not a different spelling of one: the spec answers `equals` and
// `before` where this one answers `=` and `<`. Swapping it in would have changed
// what goes on the wire for most of the operators a stored view can carry.
//
// Two things came out of that measurement which the seeding note had predicted
// the other way round, and they are the part worth carrying forward. The `?? op`
// tail is NOT where the two differ: both hand an unrecognised STRING back
// unchanged, so the lenient tail is COMMON ground, and the guess that the spec's
// version "refuses instead" does not survive being run. The tail does diverge,
// but in the opposite direction and on the other arm -- the spec's returns a
// NON-string verbatim (its body ends `return op as string`), where this one
// returns `null`, and `objectFilterEntryToAST` reads that `null` one line later
// into a `MalformedFilterError`. So binding the spec here would have WIDENED what
// this adapter accepts onto the wire, not tightened it: a number in the operator
// slot of a tuple it is about to send, instead of a 400-shaped refusal.
//
// Renamed, therefore -- to `toAstFilterOperator`, which names the codomain that
// makes it a different function from the one the rest of this monorepo imports
// from the spec under the old name. Nothing about the behaviour moved with it.
// Both directions are pinned: the NAME in this package's own spec-symbol file,
// packages/data-objectstack/src/spec-symbol-batch6.test.ts (appended to its
// RENAMES table, not duplicated), and the site, the block and the measured
// behaviour in
// scripts/__tests__/spec-symbol-ledger-data-objectstack-7265.test.ts.
//
// Then the `@object-ui/plugin-detail` slice at objectui#7265, the LAST group, and
// the one where the route was settled by the tree rather than by the shape. The
// site was a non-exported `interface RecordAlertProps` used at exactly one place,
// the `React.FC<…>` type argument of `RecordAlertRenderer`. Being a TYPE, it had
// the derive-in-place route a function does not -- and reading it took that route
// off the table rather than onto it. At the RESOLVED pin the spec's
// `RecordAlertProps` is the AUTHORED property bag of the `record:alert` block,
// while the local one is the React props the renderer is called with: a `schema`
// node, a `className`, an open tail, with the spec's bag NESTED inside it under
// `schema.properties` and mirrored FLAT beside it for legacy nodes. Not the same
// concept, so BIND was refused; and an `interface` derives only through
// `extends`, which a wrapper around a type cannot use on the type it wraps.
//
// What decided it is that the collision was a SPELLING SLIP against a convention
// this repo already keeps. `@objectstack/spec/ui` owns a `Record<Block>Props`
// for every block that directory renders, and every sibling renderer beside this
// one already spells its own props type `Record<Block>RendererProps` -- which is
// exactly why none of them was ever in this ledger and this one was. RENAMED to
// `RecordAlertRendererProps`, therefore: not a dialect minted for the occasion
// but the name the file should have carried, and no published face moves with it
// (the declaration was never exported, and `index.tsx` imports the COMPONENT).
// Pinned in both directions -- the spec still owns the plain name, the spec does
// not own the new one, and the sibling convention is re-derived from the
// directory rather than restated -- in this package's own spec-symbol file,
// packages/plugin-detail/src/__tests__/spec-symbol-batch7.test.ts (appended to,
// not duplicated), with the site, the block and the empty-ledger path in
// scripts/__tests__/spec-symbol-ledger-plugin-detail-7265.test.ts.
const DEBT = {

};

// Files under these paths are not objectui's own authored surface.
//   - `ui/` is the Shadcn no-touch zone (AGENTS.md #7): upstream 3rd-party files
//     overwritten by sync scripts, so a collision there is not ours to fix.
//   - `plugin-chatbot/src/elements/` is the same class one package over: Vercel
//     AI Elements (https://elements.ai-sdk.dev, MIT) plus two Shadcn primitives
//     `@object-ui/components` does not ship yet, vendored by the identical
//     copy-into-source model and re-synced from upstream. Every file there
//     carries the banner saying so. Two of its exports collide —
//     `Tool` (a `<Collapsible>` shell for a tool call; the spec's is an agent
//     TOOL DEFINITION) and `MessageContent` (a styled `<div>`; the spec's is an
//     AI message payload) — and neither is renameable: the names ARE the
//     upstream component API, so a rename is reverted by the next re-sync and
//     breaks `<Tool><ToolHeader/></Tool>` for anyone following upstream docs.
//     Skipping the directory rather than ALLOW-ing the two names is deliberate:
//     a future re-sync must not fail an unrelated PR over a third vendored name
//     nobody here is allowed to rename either. The hole that opens — an
//     objectui-AUTHORED file hiding under the skip — is closed by
//     packages/plugin-chatbot/src/__tests__/spec-symbol-batch6.test.ts, which
//     fails if any file there stops carrying the vendored banner.
//     (objectui#3160, objectstack#4115 ledger batch 6.)
const SKIP_PATH_SEGMENTS = ["components/src/ui/", "plugin-chatbot/src/elements/"];

const isSpecModule = (m) => m === "@objectstack/spec" || m.startsWith("@objectstack/spec/");

// A module THIS scan already covers on its own turn: a relative path inside the
// package, or an `@object-ui/*` sibling package. Used by the re-export arm in
// `scanFile` for both spellings of a barrel line — `export { X } from './x'`,
// where the module is written on the statement, and a bare `export { X }`, where
// it is written on the `import` that binds `X` one screen up.
const isScannedElsewhere = (m) => m.startsWith(".") || m.startsWith("@object-ui/");

// ── Rule 2: spec-alignment claims (objectui#4592) ────────────────────────────
// See the header for what a claim is and why the three precision rules exist.

/** Max characters between a claim phrase and the `@objectstack/spec` mention it claims alignment with. */
export const CLAIM_WINDOW = 60;

/** A local helper whose only job is binding a local type to a spec schema's authoring input. */
const DERIVATION_HELPERS = new Set(["SpecAuthoredInput"]);

export const CLAIM_PATTERNS = [
  /\baligned?\s+with\b/i,
  /\baligns\s+with\b/i,
  /\bspec-aligned\b/i,
  /\bmirror(?:s|ed|ing)?\b/i,
  /\bmatch(?:es|ing)?\b/i,
  /\bsame\s+(?:shape|keys|union|vocabulary)\s+as\b/i,
  /\bidentical\s+to\b/i,
  /\bin\s+sync\s+with\b/i,
  /\bcanonical\b/i,
  /\bsource\s+of\s+truth\b/i,
  /\bcop(?:y|ied)\s+(?:of|from)\b/i,
  /\bconforms?\s+to\b/i,
];

/**
 * The same patterns, `/g`, for `findClaim`'s all-occurrences scan (objectui#8819).
 *
 * ⛔ The `/g` deliberately does NOT go on the exported literals above. `/g` makes
 * `exec` and `test` STATEFUL through `lastIndex`, and `CLAIM_PATTERNS` is a
 * shared module-level array an importer may call either on: the second call
 * would resume mid-string and the gate's verdict would depend on how many
 * docblocks preceded it. A non-deterministic gate is worse than the
 * first-occurrence-only bug it would be fixing.
 *
 * `matchAll` is what makes a SHARED `/g` regex safe here: it clones the pattern
 * through the species constructor and never mutates the source's `lastIndex`.
 * The same idiom is already load-bearing in this file for `MEMBER_CITATION`.
 * These copies are module-private precisely so nothing can `exec` them — that,
 * not the cloning, is what keeps their `lastIndex` at 0 for every scan.
 */
const CLAIM_PATTERNS_ALL = CLAIM_PATTERNS.map(
  (p) => new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g")
);

// Deliberate, reasoned duplications — the rule-1 ALLOW map's governance exactly:
// declared, reasoned, shrink-only, and stale entries fail the guard. An entry
// belongs here only when the declaration's OWN comment already states why the
// copy exists; anything merely untriaged belongs in CLAIM_DEBT below, which is
// where "we have not decided yet" is supposed to live.
// Key format: "<package>:<symbol>".
export const CLAIM_ALLOW = {
  "@object-ui/app-shell:MarketplacePackageTranslation": {
    reason:
      "Deliberate copy with the reason written at the declaration: the app-shell bundle must not " +
      "pull in `@objectstack/spec` for five translatable marketplace strings. A bundle-size " +
      "duplication is a decision, not a drifted premise — and the comment says so rather than " +
      "claiming the copy IS the spec's type.",
    issue: 4592,
  },
  "@object-ui/core:ElementDataSourceConfig": {
    reason:
      "Deliberate divergence, documented at the declaration: `filter` is typed `unknown` rather " +
      "than the spec's `FilterCondition` because three legitimately different filter shapes reach " +
      "a renderer. The comment names the diverging key and its reason, which is exactly the " +
      "difference between a documented dialect and a planted premise.",
    issue: 4592,
  },
};

// ── The claim ledger ─────────────────────────────────────────────────────────
// Same governance as rule 1's DEBT: named symbols, shrink-only, regenerated by
// `--claim-ledger` so it is never hand-maintained. These are the spec-alignment
// claims that predate this rule. The rule exists to stop the BLEEDING — a new
// unbacked claim fails on the PR that writes it — not to retro-fix 28 comments
// across nine packages in one card (objectui#4592 owns `scripts/**` only, and
// most of these surfaces belong to other seats).
//
// To burn one down, pick whichever is true of the declaration:
//   - derive it (`z.infer< typeof SpecX >`, `SpecAuthoredInput< … >`, or an
//     import of the spec type) — the claim becomes structural and the entry goes;
//   - keep the copy and move it to CLAIM_ALLOW with the reason it exists;
//   - or delete the claim from the comment, because it is not true here.
//
// The block GREW once, at objectui#6291, and that is not a ratchet failure: rule
// 2 stopped skipping module-local declarations in the same commit, so
// `CONTEXT_TOKEN_SUGGESTIONS` (@object-ui/core) is a pre-existing claim the rule
// could not previously SEE, not a new one somebody wrote. It is a real mirror —
// byte-identical to `@objectstack/spec/data`'s nine-entry map — and 25 lines
// above it the same file explains that its neighbour `CONTEXT_TOKENS` became a
// re-export precisely because "the copy was byte-identical, so every value
// comparison and every behavioural test passed while it sat here". Burning it
// down is the same edit that fixed the neighbour; it is listed rather than
// excused because nothing about it is deliberate. ⇒ DONE at objectui#7265: the
// site imports the spec's map, the claim went with the declaration that carried
// it, and the entry left this block by `--claim-ledger`. Widening a rule's
// jurisdiction is the ONLY sanctioned way this block grows, and it must be
// mechanically regenerated (`--claim-ledger`) in that same commit.
//
// Eight entries left by that last route in objectui#4597 — the i18n formatters'
// four and views.ts's four, which cited `DateFormatSchema`, `NumberFormatSchema`,
// `PluralRuleSchema`, `LocaleConfigSchema`, `FieldChangeEntrySchema`,
// `MentionSchema`, `ReactionSchema` and `RecordSubscriptionSchema`. Measuring
// them answered the question #4597 left open, and the answer was NOT "these
// names never existed": all eight were real exports the protocol RETIRED, and
// each local key set was faithful to the schema it named. The feed four went
// from `@objectstack/spec/data` in the 16.0.0 major (feed surface replaced by
// the data API over `sys_comment` / `sys_activity`); the i18n four went from
// `@objectstack/spec/ui` in 17.0.0-rc.6 itself — present through rc.5 — under
// ADR-0049 enforce-or-remove (objectstack#5055). Their comments now record that
// provenance instead of vouching for a symbol the pinned spec has dropped.
//
// Worth keeping for whoever measures the next batch: "the installed spec does
// not export it" does not distinguish a name that never existed from one the
// protocol retired on purpose, and the fix differs. Read the spec's CHANGELOG
// and its own retirement notes before concluding a citation was always wrong.
const CLAIM_DEBT_ISSUE = 4592;
const CLAIM_DEBT = {
  "@object-ui/types": [
    "ListViewExportOptions",
    "ManagedByBucket",
    "PageRegionWidth",
    "RecordActivityComponentProps",
    "RecordChatterComponentProps",
    "SubmitBehavior",
  ],
  "@object-ui/core": [
    "ResultDialogFieldSpec",
    "ViewDataConfig",
  ],
  "@object-ui/app-shell": [
    "RecordLookupBinding",
  ],
  "@object-ui/plugin-view": [
    "ROW_HEIGHT_OPTIONS",
  ],
  "@object-ui/react": [
    "DensityModeValue",
  ],
};

// ── Ledger anchors: is the card each ledger names still open? ────────────────
// objectui#9537, ruled 2026-09-16 (letter 3, with letter 1 as its companion).
//
// Both ledgers above end their stale-entry message by naming an anchor card —
// "objectui#<n> can be ended once the ledger is empty". That instruction is
// only followable while the card is OPEN. When the anchor has been ended and
// the block is non-empty, the ratchet hands a contributor an instruction nobody
// can follow, and it does so SILENTLY. That has already happened twice:
// objectstack#4115 was ended by objectstack#6883 while rule 1's block was live
// (which is why objectui#6291 re-anchored), and rule 2's anchor went the same
// way while its block stayed live, which is the exclusion recorded below.
//
// The note beside `DEBT_ISSUE` DECLARES that state to be a defect and nothing
// enforced the declaration — the ADR-0049 shape. This table is the enforcement
// point, and `ledgerAnchorDiagnostic` below is the rule.
//
// ⚠️ WHAT THIS DOES NOT DO, written down rather than left to be assumed (root
// AGENTS.md #9). `state` is DECLARED here, never fetched. This gate is an
// offline static scan with no token, and a gate that reached GitHub for issue
// state would go red on a rate limit or an outage — failing on the network
// instead of on the tree. So the two halves are not symmetric:
//   - CAUGHT mechanically: a block re-seeded under an anchor already known to
//     be ended. A jurisdiction widening is the one sanctioned way either block
//     grows, it is a deliberate edit to THIS file, and it is the same edit that
//     must re-anchor (objectui#6291's precedent) — so a red lands on exactly
//     the pull request that owes the re-anchoring.
//   - NOT CAUGHT: an anchor card ending OUT OF BAND while its block is live and
//     its `state` here still reads "open". Nothing in this repository
//     re-derives that; only something holding a token can. Whoever ends an
//     anchor card is the one who must flip its `state` here.
// ⛔ Do not "improve" this by teaching the gate to fetch issue state.
//
// Adding a third ledger means adding its anchor here. The coverage pin in
// scripts/__tests__/spec-symbol-ledger-anchor-liveness-9537.test.ts reds if an
// anchor constant declared in this file has no entry below, so "any ledger
// anchor it reads" stays true by mechanism rather than by memory.
export const LEDGER_ANCHORS = [
  {
    ledger: "DEBT",
    constant: "DEBT_ISSUE",
    issue: DEBT_ISSUE,
    entries: DEBT,
    regenerator: "--ledger",
    // objectui#7265 was ended 2026-09-14 by its own final slice — the burn-down
    // card recreating, on finishing, the condition it was opened to remove.
    // Left pointing there deliberately: objectui#9537's ruling keeps the anchor
    // and buys the detection instead, because inventing a card purely to hold
    // an anchor is the shape this repository already rejected.
    state: "closed",
    excludedByName: null,
  },
  {
    ledger: "CLAIM_DEBT",
    constant: "CLAIM_DEBT_ISSUE",
    issue: CLAIM_DEBT_ISSUE,
    entries: CLAIM_DEBT,
    regenerator: "--claim-ledger",
    state: "closed",
    excludedByName: "`CLAIM_DEBT_ISSUE` (objectui#4592) — excluded BY NAME because it is the deliberate, standing exclusion recorded beside `DEBT_ISSUE` and re-affirmed by objectui#9537's ruling: rule 2's ledger is not what objectui#6291 widened, so re-anchoring it is a separate decision and ⛔ not this detector's to force.",
  },
];

/**
 * The ruled condition, as a pure function of ONE anchor so that both acceptance
 * legs are measurable without a repository scan: an anchor that has been ended
 * while its block still holds entries is a dead instruction; every other
 * combination is silence.
 *
 * Returns `null`, or `{ kind, message }` with `kind` one of:
 *   "dead-anchor"      — the ruled condition.
 *   "bad-declaration"  — `state` is neither "open" nor "closed". Judged FIRST
 *                        and judged loudly: a typo there would turn the
 *                        detection off while leaving it looking wired, which is
 *                        the exact failure this check exists to end.
 *
 * `ignoreExclusion` answers "would this have fired if it were not excluded?" —
 * used only to keep the standing exclusion visible in the run banner, so it
 * cannot go quiet, and to retire itself the day it stops applying.
 */
export function ledgerAnchorDiagnostic(anchor, { ignoreExclusion = false } = {}) {
  if (anchor.state !== "open" && anchor.state !== "closed") {
    return {
      kind: "bad-declaration",
      message:
        `${anchor.constant}'s declared \`state\` is ${JSON.stringify(anchor.state)} — neither "open" nor "closed".\n` +
        `      An anchor whose state does not parse is one this check cannot judge, and a typo here would\n` +
        `      silently turn the dead-anchor detection off while leaving it looking wired.`,
    };
  }
  if (!ignoreExclusion && anchor.excludedByName) return null;
  // No anchor at all is not a DEAD anchor: the ratchet's tail is written behind
  // a truthiness guard, so it renders no instruction to be followed.
  if (!anchor.issue) return null;
  if (anchor.state === "open") return null;
  const entryCount = Object.values(anchor.entries).reduce((sum, names) => sum + names.length, 0);
  if (entryCount === 0) return null;
  return {
    kind: "dead-anchor",
    message:
      `${anchor.ledger}'s anchor \`${anchor.constant}\` names objectui#${anchor.issue}, a card that has already been\n` +
      `      ended, and the block under it holds ${entryCount} entr${entryCount === 1 ? "y" : "ies"}. So the ratchet that reads this ledger\n` +
      `      ends its message by telling you objectui#${anchor.issue} can be ended once the ledger is empty — an\n` +
      `      instruction nobody can follow, because that card is ended already.\n` +
      `      Re-anchor \`${anchor.constant}\` to the OPEN burn-down card for this seeding and set that entry's\n` +
      `      \`state\` in LEDGER_ANCHORS to "open". objectui#6291 is the precedent: the pull request that\n` +
      `      re-seeds a block is the one that re-anchors it (\`${anchor.regenerator}\` regenerates the block).`,
  };
}

// ── 1. Enumerate every `@objectstack/spec` export name, per subpath ──────────
// Types AND values: the drifted symbols in the table above are mostly types, and
// a runtime `import()` only sees values. The compiler's own view of each
// subpath's `.d.ts` is the only source that covers both.
//
// Exported for the pins in `scripts/__tests__/`, for the same reason `scanFile`
// is: a ledger test that builds its own name map is asserting against a COPY of
// the spec's export set, which is the exact failure this whole guard exists to
// catch, one level up. A pin that reads THIS function reads what the gate reads.
export function specExportNames() {
  const require = createRequire(import.meta.url);
  let pkgPath;
  try {
    pkgPath = require.resolve("@objectstack/spec/package.json");
  } catch {
    console.error(
      "❌  cannot resolve @objectstack/spec — run `pnpm install` first.\n" +
        "    This guard reads the spec's own type declarations; it cannot fall back to a\n" +
        "    hardcoded name list without becoming the stale copy it exists to prevent."
    );
    process.exit(1);
  }
  const pkgDir = dirname(pkgPath);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  const entries = [];
  for (const [sub, cond] of Object.entries(pkg.exports ?? {})) {
    if (typeof cond !== "object" || cond === null) continue;
    const dts = cond?.import?.types ?? cond?.require?.types;
    if (!dts) continue;
    entries.push({ sub: sub === "." ? "@objectstack/spec" : `@objectstack/spec${sub.slice(1)}`, file: resolve(pkgDir, dts) });
  }

  const program = ts.createProgram(
    entries.map((e) => e.file),
    {
      noEmit: true,
      skipLibCheck: true,
      strict: false,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    }
  );
  const checker = program.getTypeChecker();

  const names = new Map(); // name -> Set<subpath>
  const symbols = new Map(); // name -> ts.Symbol (first wins; subpaths re-export one declaration)
  for (const entry of entries) {
    const sf = program.getSourceFile(entry.file);
    if (!sf) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const name = exported.getName();
      if (!names.has(name)) names.set(name, new Set());
      names.get(name).add(entry.sub);
      if (!symbols.has(name)) symbols.set(name, exported);
    }
  }
  return { names, membersOf: memberResolver(checker, symbols) };
}

/**
 * The AUTHORING key set of one spec export, for the member-granularity half of
 * rule 4. Two shapes reach this, and only the first is a Zod schema:
 *
 *   a schema value  — the keys live on `.shape`. A `.transform()`/`.refine()`
 *                     wrapper puts the object one hop in, on the pipe's `.in`,
 *                     which is the INPUT side and therefore the authoring side.
 *   a type export   — its declared properties ARE the member set.
 *
 * Both are unioned, because a name can be both. `surface` is everything the
 * VALUE carries (Zod's own methods included) and is kept separate on purpose —
 * see `isZodApiCitation` for why it is never allowed to answer first.
 */
function memberSetOfSymbol(checker, sym) {
  const decl = sym.declarations?.[0];
  if (!decl) return null;
  let valueType;
  try {
    valueType = checker.getTypeOfSymbolAtLocation(sym, decl);
  } catch {
    return null;
  }
  const surface = new Set(checker.getPropertiesOfType(valueType).map((prop) => prop.getName()));
  const authored = new Set();

  // Walk `.in` until a `.shape` turns up. Bounded: a pipe of pipes is finite,
  // and an unbounded walk on a recursive type is a hang, not a finding.
  let cursor = valueType;
  for (let hop = 0; cursor && hop < 6; hop++) {
    const shape = checker.getPropertyOfType(cursor, "shape");
    if (shape) {
      const shapeDecl = shape.declarations?.[0] ?? decl;
      let shapeType = null;
      try {
        shapeType = checker.getTypeOfSymbolAtLocation(shape, shapeDecl);
      } catch {
        shapeType = null;
      }
      if (shapeType) for (const prop of checker.getPropertiesOfType(shapeType)) authored.add(prop.getName());
      break;
    }
    const input = checker.getPropertyOfType(cursor, "in");
    if (!input) break;
    try {
      cursor = checker.getTypeOfSymbolAtLocation(input, input.declarations?.[0] ?? decl);
    } catch {
      break;
    }
  }

  let declaredType = null;
  try {
    declaredType = checker.getDeclaredTypeOfSymbol(sym);
  } catch {
    declaredType = null;
  }
  if (declaredType) for (const prop of checker.getPropertiesOfType(declaredType)) authored.add(prop.getName());

  return { authored, surface };
}

/**
 * `name -> { authored, surface } | null`, memoised and LAZY: resolving all ~5k
 * spec exports up front costs seconds for the handful a comment actually cites.
 *
 * A citation names a CONCEPT, and the spec publishes a concept as a family, so
 * the answer is the union over `N` / `NSchema` / `NInput` / `NParsed` — see the
 * header's third precision rule for the `FormField.visibleOn` specimen that
 * makes the union load-bearing rather than tidy.
 *
 * `null` means the member set is unknowable (an opaque `z.ZodType< … >` alias, a
 * string union, a function). The rule then stays out of the way entirely, which
 * is the same judgement rule 4 makes when it has no spec export set at all: a
 * verdict fabricated from ignorance of the spec is worse than no verdict.
 */
export function memberResolver(checker, symbols) {
  const FAMILY_SUFFIXES = ["", "Schema", "Input", "Parsed"];
  const cache = new Map();
  return (name) => {
    if (cache.has(name)) return cache.get(name);
    const stem = name.replace(/(?:Schema|Input|Parsed)$/, "");
    const authored = new Set();
    const surface = new Set();
    for (const suffix of FAMILY_SUFFIXES) {
      const sym = symbols.get(stem + suffix);
      if (!sym) continue;
      const set = memberSetOfSymbol(checker, sym);
      if (!set) continue;
      for (const key of set.authored) authored.add(key);
      for (const key of set.surface) surface.add(key);
    }
    const resolved = authored.size > 0 ? { authored, surface } : null;
    cache.set(name, resolved);
    return resolved;
  };
}

// ── 2. Scan objectui's authored source for exported declarations ─────────────
function sourceFiles() {
  const out = [];
  const pkgsDir = resolve(root, "packages");
  for (const pkg of readdirSync(pkgsDir)) {
    const srcDir = join(pkgsDir, pkg, "src");
    try {
      if (!statSync(srcDir).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(srcDir, out);
  }
  return out;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Tests do not publish a surface, so a local type there cannot be mistaken
      // for the spec's by an importer. Keeps the signal on the public API.
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      walk(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name) || /\.stories\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
}

const packageNameCache = new Map();
function packageNameFor(file) {
  const rel = relative(root, file);
  const pkgDir = rel.split("/").slice(0, 2).join("/");
  if (!packageNameCache.has(pkgDir)) {
    let name = pkgDir;
    try {
      name = JSON.parse(readFileSync(resolve(root, pkgDir, "package.json"), "utf8")).name ?? pkgDir;
    } catch {
      /* keep the directory name */
    }
    packageNameCache.set(pkgDir, name);
  }
  return packageNameCache.get(pkgDir);
}

/**
 * Does this subtree reference a name bound to a spec import?
 *
 * `skipLiterals` stops the walk at object/array literals and type-literal member
 * blocks: a spec name mentioned inside a members block is a hand-written shape
 * that merely USES a spec type, which is exactly what a fork looks like.
 *
 * `exclude` drops the declaration's OWN name node from the walk. Without it a
 * declaration whose name is itself bound to a spec import reads as derived from
 * itself — `import type { X } from spec` next to `export type X = 'a' | 'b'`
 * would be waved through, since the alias's own `X` identifier is in `bindings`.
 * TypeScript rejects that particular pair as a duplicate identifier, so it is
 * not reachable in compiling code, but a guard that depends on the compiler
 * having run first is a guard with a hole in it.
 */
function referencesSpec(node, bindings, skipLiterals, exclude) {
  let found = false;
  const visit = (n) => {
    if (found || !n || n === exclude) return;
    if (skipLiterals) {
      if (ts.isTypeLiteralNode(n) || ts.isObjectLiteralExpression(n) || ts.isArrayLiteralExpression(n)) return;
    }
    if (ts.isIdentifier(n) && bindings.has(n.text)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/**
 * Strip comment syntax and collapse whitespace, so a claim split across `*`-
 * prefixed lines reads as one sentence. Without this, "Aligned with\n *
 * @objectstack/spec X" measures a window across the line noise.
 */
export function normalizeDoc(text) {
  return text
    .replace(/^[ \t]*(?:\/\*\*?|\*\/|\*|\/\/)[ \t]?/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The comment block ATTACHED to a declaration — never the file's licence banner.
 *
 * Two conditions, and both were needed against the real tree. Only the LAST
 * leading block counts (a banner plus a real doc comment are two blocks, and
 * reading them joined let the banner's prose supply the claim phrase for
 * whichever declaration sat first). And a block separated from the declaration
 * by a BLANK LINE is not attached at all — otherwise a file whose banner is its
 * only comment donates that banner to its first declaration, which is the same
 * bug wearing the other half's clothes.
 */
function attachedDoc(node, fullText) {
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? [];
  if (ranges.length === 0) return "";
  const last = ranges[ranges.length - 1];
  const gap = fullText.slice(last.end, node.getStart());
  if (/\n[ \t]*\n/.test(gap)) return "";
  return fullText.slice(last.pos, last.end);
}

const SPEC_MENTION = "@objectstack/spec";

/**
 * Does this doc comment CLAIM alignment with `@objectstack/spec`?
 * Returns `{ phrase, distance, symbols }` or null. `symbols` are the capitalised
 * identifiers named right after a spec mention — the symbols the claim points
 * at.
 *
 * `symbols` is load-bearing, not decoration: since objectui#4607 it decides
 * whether the tie test applies at all (a claim every one of whose cited symbols
 * is absent from the spec is flagged regardless of an incidental tie), as well
 * as sharpening the failure message it always did.
 */
export function findClaim(docText) {
  const text = normalizeDoc(docText);
  const mentions = [];
  for (let i = text.indexOf(SPEC_MENTION); i !== -1; i = text.indexOf(SPEC_MENTION, i + 1)) mentions.push(i);
  if (mentions.length === 0) return null;

  for (const pattern of CLAIM_PATTERNS_ALL) {
    // EVERY occurrence, not the first (objectui#8819). `exec` once per pattern
    // tested only the first occurrence of each phrase in the block, so an
    // innocent early "mirror"/"match" masked a real claim sitting beside a
    // mention later in the SAME block — and it failed PERMISSIVE: the gate went
    // green on the planted premise its own failure text is written against.
    for (const hit of text.matchAll(pattern)) {
      const start = hit.index;
      const end = hit.index + hit[0].length;
      for (const at of mentions) {
        const distance = at >= end ? at - end : start - (at + SPEC_MENTION.length);
        if (distance < 0 || distance > CLAIM_WINDOW) continue;
        // Proximity alone is not enough: the claim and the mention must be in the
        // SAME sentence. `ChartDataSeries` reads "positionally aligned with the
        // chart's `categories`. Renamed off `ChartSeries`: `@objectstack/spec/ui`
        // owns that name…" — two sentences, two subjects, 53 characters apart, and
        // the alignment claim is about the categories array rather than the spec.
        // A window without this test flags it, which the measured run confirmed.
        const between = at >= end ? text.slice(end, at) : text.slice(at + SPEC_MENTION.length, start);
        if (/[.;!?](?:\s|$)/.test(between)) continue;
        const symbols = [];
        for (const m of mentions) {
          // `@objectstack/spec/ui ReactionSchema` — take the identifiers the claim
          // names just after the mention (its subpath included, then skipped).
          let tail = text.slice(m + SPEC_MENTION.length, m + SPEC_MENTION.length + 48);
          // Stop at the end of the SENTENCE, the same discipline the claim/mention
          // pairing above applies. Without it the window scrapes the capitalised
          // opening words of the NEXT sentence and reports them as cited symbols:
          // `ActionDef` (packages/core/src/actions/ActionRunner.ts) reads
          // "…mirroring `@objectstack/spec`'s `ActionSchema`. Open key set on a
          // data bag is correct", and `Open` is prose, not a citation. Harmless
          // while `symbols` only decorated a message; since objectui#4607 it
          // decides whether the tie test applies, and a claim whose only "cited
          // symbols" are prose words would read as citing nothing but dangling.
          const sentenceEnd = tail.search(/[.;!?](?:\s|$)/);
          if (sentenceEnd !== -1) tail = tail.slice(0, sentenceEnd);
          for (const s of tail.matchAll(/[`'"\s(]([A-Z][A-Za-z0-9_]{2,})\b/g)) symbols.push(s[1]);
        }
        return { phrase: hit[0], distance, symbols: [...new Set(symbols)], text };
      }
    }
  }
  return null;
}

/** A renderer is not a shape — see the header's third precision rule. */
function isRendererLike(stmt) {
  if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) return true;
  if (ts.isVariableStatement(stmt)) {
    const init = stmt.declarationList.declarations[0]?.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isCallExpression(init))) return true;
  }
  return false;
}

/**
 * Rule 1's narrower cousin: does this declaration actually RENDER? (objectui#6291)
 *
 * `isRendererLike` above is rule 2's, and rule 2 can afford it: that scanner
 * drops function and class declarations one line earlier (`if (!nameNode)
 * continue`), so the predicate only ever judges a `const` initialised with a
 * call or a function. Rule 1 has no such pre-filter — it RECORDS every exported
 * function with `derived: false` — so reusing `isRendererLike` verbatim would
 * skip every spec-named function in the tree.
 *
 * Measured, that is not the same set. On the objectui#6291 commit, dropping
 * rule 1's export filter surfaces four module-local functions: two React
 * components named `Field` (metadata-admin inspectors, wrapping a child in a
 * `<div>` with a hint line), and `isContextToken` / `normalizeFilterOperator` —
 * a type-guard predicate and an alias-table normalizer, both classified REAL
 * MIRRORS by the census and both carrying the drift this guard exists to catch
 * (`normalizeFilterOperator` is a SECOND normalizer over the spec's, and two
 * normalizers disagreeing about filter operators is the silent over-fetch class
 * of objectstack#3948). A blanket "functions are renderers" would have made
 * those two invisible rather than DEBT entries — silently, and for good.
 *
 * So the narrowing here tests the judgement the header actually states — "a
 * component that RENDERS the spec's shape is not a second declaration of it" —
 * literally: the declaration must contain JSX. A predicate returning `boolean`
 * does not; a component returning `<div>` does. Nested functions are not
 * excluded from the walk on purpose: a helper that builds JSX inside a
 * non-rendering function is vanishingly rarer than the false negative that
 * excluding it would buy, and the fallback for a genuine miss is an ALLOW entry
 * with a reason — which is the governance this file wants anyway.
 */
function rendersJsx(node) {
  let found = false;
  const visit = (n) => {
    if (found || !n) return;
    if (
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * A pure alias to a single identifier is derivation BY DELEGATION (objectui#6291).
 *
 * `type FlowNode = FlowDesignerNode` restates nothing. It names one thing, and
 * whatever that thing is gets judged at its own declaration site — which is the
 * judgement this scanner already makes one screen down for barrels: a re-export
 * through a relative path or an `@object-ui/*` sibling "is not a second
 * finding … reporting the barrel too would just make one fork look like four,
 * and would make the fix land in the barrel rather than at the declaration".
 * The same sentence is true of an alias, and it is the change the tree itself
 * made in objectui#3202 when it deleted two restated copies of the flow shapes
 * in favour of exactly this form.
 *
 * Deliberately the narrowest possible reading — a bare `TypeReferenceNode`,
 * one identifier, no type arguments, no qualified name. `A & { id: string }`
 * is NOT this (it is a deliberate widening, which belongs in ALLOW with its
 * reason written down), and neither is `A<B>` or a union.
 */
function isPureAlias(stmt) {
  if (!ts.isTypeAliasDeclaration(stmt)) return false;
  const t = stmt.type;
  return ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && !t.typeArguments;
}

/**
 * Rule 2's scan: exported declarations whose doc comment claims spec alignment
 * while the declaration itself references nothing spec-bound.
 */
export function scanFileForClaims(file, specNames = new Map()) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const specBindings = new Set(DERIVATION_HELPERS);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!isSpecModule(stmt.moduleSpecifier.text)) continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name) specBindings.add(clause.name.text);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) specBindings.add(named.name.text);
    if (named && ts.isNamedImports(named)) for (const el of named.elements) specBindings.add(el.name.text);
  }

  const findings = [];
  for (const stmt of sf.statements) {
    // No export filter: a module-local declaration carrying a spec-alignment
    // claim is the same planted premise as an exported one (objectui#6291).
    // The claim is read by the next agent editing the FILE, not by an importer,
    // so the package boundary was never what made it dangerous. Measured cost of
    // dropping it here: see the header's rule-2 line.

    let nameNode = null;
    if (
      (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isEnumDeclaration(stmt)) &&
      stmt.name
    ) {
      nameNode = stmt.name;
    } else if (ts.isVariableStatement(stmt)) {
      const decl = stmt.declarationList.declarations[0];
      if (decl && ts.isIdentifier(decl.name)) nameNode = decl.name;
    }
    if (!nameNode) continue; // functions/classes are renderers — see isRendererLike
    if (isRendererLike(stmt)) continue;

    const claim = findClaim(attachedDoc(stmt, text));
    if (!claim) continue;

    const dangling = claim.symbols.filter((s) => !specNames.has(s));
    // The tie is judged against the symbols the claim CITES (objectui#4607) —
    // see the header's fourth precision rule. When the claim names symbols and
    // the spec exports NONE of them, no reference elsewhere in the declaration
    // can be evidence for THIS claim, so the tie test below is not consulted.
    // Guarded on a non-empty `specNames`: with no export set to check against,
    // "dangling" is unknowable and the rule must not manufacture a verdict from
    // ignorance of the spec.
    const citesOnlyDanglingSymbols =
      specNames.size > 0 && claim.symbols.length > 0 && dangling.length === claim.symbols.length;

    // `skipLiterals: false` on purpose — rule 1 asks "is this THE spec's symbol",
    // where only a structural position counts. Rule 2 asks the weaker question
    // "does this declaration have ANY compile-time tie to what it claims", and a
    // spec type used on a member is a tie a spec change can still break.
    if (!citesOnlyDanglingSymbols && referencesSpec(stmt, specBindings, false, nameNode)) continue;

    const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart(sf));
    findings.push({
      name: nameNode.text,
      file,
      line: line + 1,
      phrase: claim.phrase,
      dangling,
    });
  }
  return findings;
}

/**
 * Zod's own API, cited in prose as something a READER does with the schema —
 * never a key an AUTHOR may write. Two predicates, both by rule, and the ruling
 * on objectui#7513 required exactly that: the 22 method-surface hits measured
 * there are excluded by a documented predicate, ⛔ not by 22 allowlist entries.
 * An entry per site would also be refused by ratchet 3 the moment the site's
 * wording changed, and an ALLOW map with a Zod method name in it is a second
 * copy of Zod.
 *
 *   1. CALL FORM — `NavigationModeSchema.default('page')`. A citation written
 *      with its parentheses is an invocation. This is the predicate that carries
 *      the names Zod SHARES with the authoring vocabulary, and it is why they do
 *      not need to be listed: `default`, `options`, `type`, `required`,
 *      `readonly` and `optional` are all real spec keys AND real Zod methods.
 *      ⚠️ A backtick or a space before the paren is prose — "`FieldSchema.rows`
 *      (a positive integer)" is a citation with a parenthetical after it, and
 *      one of the three specimens is written exactly that way.
 *   2. INTROSPECTION VOCABULARY — the bare spellings that actually occur:
 *      "`RecordDetailsProps.safeParse` on a section carrying it returns …".
 *
 * ⛔ Deliberately NOT "any property of the Zod type". Zod puts `.description`,
 * `.default`, `.optional`, `.readonly`, `.type` and `.shape` on every schema, and
 * a structural read would have silenced `SelectOptionSchema.description` — the
 * citation this whole rule was built for. The order in `scanFileForMemberCitations`
 * is the second half of that safety: the family's AUTHORED set answers first, so
 * a symbol that really declares `shape` as a key is green before this is asked.
 */
const ZOD_INTROSPECTION = new Set(["parse", "safeParse", "parseAsync", "safeParseAsync", "shape"]);

function isZodApiCitation(member, textAfterCitation) {
  if (ZOD_INTROSPECTION.has(member)) return true;
  return textAfterCitation.startsWith("(") || textAfterCitation.startsWith("`(");
}

/**
 * `Symbol.member` in prose. The negative lookarounds drop FILE PATHS — a `/` on
 * either side means the comment is pointing at `ui/TimelineConfig.json`, where
 * `json` is an extension rather than a member. The leading `.` exclusion stops a
 * chained `a.B.c` from reading its middle segment as a cited symbol.
 */
const MEMBER_CITATION = /(?<![A-Za-z0-9_$./])([A-Z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_]*\/)/g;

/**
 * THE citation grammar — one implementation, two transports (objectui#7995).
 *
 * `doc` is one already-normalised passage: a TS comment block for
 * `scanFileForMemberCitations`, a markdown paragraph for
 * `scanProseForMemberCitations`. Everything that DECIDES a verdict lives here,
 * so the two surfaces cannot drift into two dialects of one rule — the same
 * argument commandment #0.1 makes about producers and this renderer. What stays
 * outside is transport-specific and decides nothing: how a passage is cut out of
 * its file, and how its markers are stripped.
 *
 * Returns `{ symbol, member, cited }` per dangling citation, in source order.
 */
function memberCitationsIn(doc, membersOf) {
  const mentions = [];
  for (let i = doc.indexOf(SPEC_MENTION); i !== -1; i = doc.indexOf(SPEC_MENTION, i + 1)) mentions.push(i);
  if (mentions.length === 0) return [];

  const found = [];
  for (const hit of doc.matchAll(MEMBER_CITATION)) {
    const [cited, symbol, member] = hit;
    const set = membersOf(symbol);
    if (!set) continue; // not a spec export, or its member set is unknowable

    // Proximity AND same sentence, exactly as `findClaim` pairs a claim with
    // its mention: a passage that mentions the spec somewhere does not make
    // every capitalised dotted name in it a spec citation.
    let near = false;
    for (const at of mentions) {
      const after = hit.index >= at + SPEC_MENTION.length;
      const distance = after ? hit.index - (at + SPEC_MENTION.length) : at - (hit.index + cited.length);
      if (distance < 0 || distance > CLAIM_WINDOW) continue;
      const between = after ? doc.slice(at + SPEC_MENTION.length, hit.index) : doc.slice(hit.index + cited.length, at);
      if (/[.;!?](?:\s|$)/.test(between)) continue;
      near = true;
      break;
    }
    if (!near) continue;

    // ORDER IS THE SAFETY: the authored key set answers first, so neither Zod
    // predicate can ever override a key the spec really declares.
    if (set.authored.has(member)) continue;
    if (isZodApiCitation(member, doc.slice(hit.index + cited.length, hit.index + cited.length + 2))) continue;

    found.push({ symbol, member, cited });
  }
  return found;
}

/**
 * Rule 4 at member granularity (objectui#7513) — see the header for the three
 * measured specimens and the four precision rules.
 *
 * Exported for the pin in `scripts/__tests__/`, which supplies its own
 * `membersOf` so the red/green pair is judged against a faithful, fixed spec
 * rather than whatever version happens to be installed.
 *
 * Unlike `scanFileForClaims` this walks EVERY comment, not the block attached to
 * a top-level declaration: two of the three specimens sat on interface members
 * and one inside a function body. It needs no claim phrase either — one of them
 * read "Per @objectstack/spec, DashboardSchema.title is …".
 */
export function scanFileForMemberCitations(file, membersOf) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const findings = [];
  const seen = new Set();

  const readComment = (pos, end) => {
    const key = `${pos}:${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    const doc = normalizeDoc(text.slice(pos, end));
    const cited = memberCitationsIn(doc, membersOf);
    if (cited.length === 0) return;
    const { line } = sf.getLineAndCharacterOfPosition(pos);
    for (const finding of cited) findings.push({ file, line: line + 1, ...finding });
  };

  const visit = (node) => {
    for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) readComment(range.pos, range.end);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return findings;
}

/**
 * The published documentation is prose attached to nothing (objectui#7995).
 *
 * Same rule, second transport. A markdown page carries no declarations, so
 * rules 1 and 2 have nothing to ask their question OF — but rule 4 at member
 * granularity asks only whether a NAME the prose spells exists in the spec, and
 * that question is transport-free. The grammar is `memberCitationsIn` verbatim;
 * only the cutting and the normalising are new.
 *
 * A PARAGRAPH is the scope, blank lines are hard boundaries. That is the exact
 * analogue of the comment BLOCK on the TypeScript side, and it is load-bearing
 * for the same reason: without it the proximity-and-same-sentence pair would
 * measure across a heading into an unrelated section, since a markdown heading
 * carries no sentence terminator to stop it.
 *
 * Fenced code is scanned like the rest. Measured both ways on the tree
 * (see the header's census): the judged population is identical, so a fence
 * rule would be a precision claim with nothing behind it.
 */
export function scanProseForMemberCitations(file, membersOf) {
  const text = readFileSync(file, "utf8");
  const findings = [];
  const lines = text.split("\n");

  let block = null;
  const flush = () => {
    if (!block) return;
    const doc = block.text.replace(/\s+/g, " ").trim();
    for (const finding of memberCitationsIn(doc, membersOf)) findings.push({ file, line: block.line, ...finding });
    block = null;
  };
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      flush();
      continue;
    }
    if (!block) block = { line: i + 1, text: "" };
    block.text += lines[i] + " ";
  }
  flush();
  return findings;
}

/** Every published documentation page — the surface objectui#7995 widened to. */
function proseFiles() {
  const out = [];
  const walkDocs = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // the docs tree is optional; its absence is not a gate failure
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDocs(full);
        continue;
      }
      if (/\.mdx?$/.test(entry.name)) out.push(full);
    }
  };
  walkDocs(resolve(root, "content/docs"));
  return out;
}

/**
 * Rule 1's scan. Exported for the same reason `scanFileForClaims` is — the two
 * structural narrowings above (`rendersJsx`, `isPureAlias`) are judgement calls
 * about what this rule may NOT see, and a narrowing with no discrimination
 * proof is how a guard quietly stops guarding (objectui#6291).
 */
export function scanFile(file, specNames) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // Local names bound to an import in THIS file. `specBindings` is the
  // `@objectstack/spec` subset — the derivation evidence a re-export needs;
  // `importedFrom` keeps EVERY binding with the module it came from, which is
  // what lets the re-export arm below give a bare `export { X }` the module
  // specifier it does not write down. Same loop, because the two answers are
  // read off the same import declarations.
  const specBindings = new Set();
  const importedFrom = new Map(); // local name -> the module specifier that binds it
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const mod = stmt.moduleSpecifier.text;
    const clause = stmt.importClause;
    if (!clause) continue;
    const bind = (local) => {
      importedFrom.set(local, mod);
      if (isSpecModule(mod)) specBindings.add(local);
    };
    if (clause.name) bind(clause.name.text);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) bind(named.name.text);
    if (named && ts.isNamedImports(named)) for (const el of named.elements) bind(el.name.text);
  }

  const findings = [];
  const record = (name, kind, derived, node) => {
    if (!specNames.has(name) || derived) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ name, kind, file, line: line + 1, subpaths: [...specNames.get(name)] });
  };

  for (const stmt of sf.statements) {
    // `export { X } from '…'` / `export { X }` / `export type { X } from '…'`
    if (ts.isExportDeclaration(stmt)) {
      const fromModule = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : null;
      // `export * from '…'` exports names this AST pass cannot attribute. When it
      // re-exports the spec it is derivation by definition; when it re-exports a
      // sibling, that sibling's own declaration is scanned on its own turn.
      if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue;
      // A barrel re-exporting a module this scan already covers — a relative path
      // or a `@object-ui/*` sibling — is not a second finding. Whatever it points
      // at gets judged at its own declaration site; reporting the barrel too would
      // just make one fork look like four, and would make the fix land in the
      // barrel rather than at the declaration.
      if (fromModule && isScannedElsewhere(fromModule)) continue;
      for (const el of stmt.exportClause.elements) {
        const exportedName = el.name.text;
        const localName = (el.propertyName ?? el.name).text;
        // The same barrel line, written WITHOUT a module specifier. `export { X }`
        // over an `import { X } from './x'` re-exports exactly what
        // `export { X } from './x'` does, so it must be skipped for exactly the
        // same reason — and until objectui#7275 it was not, because the guard
        // above reads a specifier this spelling does not have. The module is
        // still written down, one screen up on the import that binds the LOCAL
        // name (`propertyName ?? name`, so `export { X as Y }` resolves by `X`).
        //
        // ⛔ Not every bare `export { X }` may be skipped, and the two that may
        // not are why this resolves the binding instead of matching the syntax:
        //   - `import { X } from '@objectstack/spec'; export { X }` is genuine
        //     derivation, and is what the `specBindings` arm below answers;
        //   - `const X = …; export { X }` binds no import at all, so it stays a
        //     visible local declaration — the fork this rule exists to catch.
        // An import from anywhere else (a third-party module) is not skipped
        // either, for the reason the specifier form is not: this scan does not
        // cover that module, so nothing else will judge the name.
        const boundFrom = fromModule ? null : importedFrom.get(localName);
        if (boundFrom && isScannedElsewhere(boundFrom)) continue;
        const derived = fromModule
          ? isSpecModule(fromModule) // re-export straight from the spec
          : specBindings.has(localName); // `import { X } from spec; export { X }`
        record(exportedName, "re-export", derived, el);
      }
      continue;
    }

    // No export filter (objectui#6291). A module-local declaration under a spec
    // export's name is still READ by the next agent editing that file, and it
    // still drifts — objectui#5652's three mirrors were all module-local
    // `interface`s. Two structural narrowings above (`rendersJsx`, `isPureAlias`)
    // carry the judgement this widening needs; the header records the measured
    // population.

    // A component that RENDERS the spec's shape is not a second declaration of
    // it — the judgement rule 2 and three ALLOW entries already make, applied
    // here to declarations that literally contain JSX. See `rendersJsx`.
    if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isVariableStatement(stmt)) && rendersJsx(stmt))
      continue;

    if (ts.isTypeAliasDeclaration(stmt)) {
      record(stmt.name.text, "type", isPureAlias(stmt) || referencesSpec(stmt, specBindings, true, stmt.name), stmt);
    } else if (ts.isInterfaceDeclaration(stmt)) {
      // Only `extends` counts — see the header.
      const extendsSpec = (stmt.heritageClauses ?? []).some((h) => referencesSpec(h, specBindings, false));
      record(stmt.name.text, "interface", extendsSpec, stmt);
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      const extendsSpec = (stmt.heritageClauses ?? []).some((h) => referencesSpec(h, specBindings, false));
      record(stmt.name.text, "class", extendsSpec, stmt);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        record(
          decl.name.text,
          "const",
          decl.initializer ? referencesSpec(decl, specBindings, true, decl.name) : false,
          decl
        );
      }
    } else if (ts.isEnumDeclaration(stmt)) {
      // An enum cannot be derived from anything — a spec-named one is a fork.
      record(stmt.name.text, "enum", false, stmt);
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      record(stmt.name.text, "function", false, stmt);
    }
  }
  return findings;
}

// ── 3. Report ────────────────────────────────────────────────────────────────
function main() {
const { names: specNames, membersOf } = specExportNames();
const files = sourceFiles().filter((f) => !SKIP_PATH_SEGMENTS.some((seg) => f.includes(seg)));

const violations = [];
for (const file of files) violations.push(...scanFile(file, specNames));

const claims = [];
for (const file of files) claims.push(...scanFileForClaims(file, specNames));

// Rule 4 at member granularity runs over BOTH transports (objectui#7995): the
// comments of the scanned sources, and the prose of the published docs. One
// findings list, one error, one grammar — a doc page and a doc comment making
// the same false claim are the same defect and read the same way.
const proseSources = proseFiles();
const memberCitations = [];
for (const file of files) memberCitations.push(...scanFileForMemberCitations(file, membersOf));
for (const file of proseSources) memberCitations.push(...scanProseForMemberCitations(file, membersOf));

const matchedAllowKeys = new Set();
const unallowed = [];
for (const v of violations) {
  const pkg = packageNameFor(v.file);
  const key = `${pkg}:${v.name}`;
  if (ALLOW[key]) {
    matchedAllowKeys.add(key);
    continue;
  }
  unallowed.push({ ...v, pkg, key });
}

const byPackage = new Map();
for (const v of unallowed) {
  if (!byPackage.has(v.pkg)) byPackage.set(v.pkg, []);
  byPackage.get(v.pkg).push(v);
}

// `--ledger` regenerates the DEBT block from the working tree, so the list is
// never hand-maintained (and so burning symbols down is a mechanical edit).
if (process.argv.includes("--ledger")) {
  const lines = [...byPackage.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([pkg, found]) => {
      const names = [...new Set(found.map((v) => v.name))].sort();
      return `  ${JSON.stringify(pkg)}: [\n` + names.map((n) => `    ${JSON.stringify(n)},`).join("\n") + `\n  ],`;
    });
  console.log("const DEBT = {\n" + lines.join("\n") + "\n};");
  process.exit(0);
}

// Rule 2's own bookkeeping, in the same shape: CLAIM_ALLOW first, then whatever
// is left grouped by package for the ledger and the ratchets.
const matchedClaimAllowKeys = new Set();
const unallowedClaims = [];
for (const c of claims) {
  const pkg = packageNameFor(c.file);
  const key = `${pkg}:${c.name}`;
  if (CLAIM_ALLOW[key]) {
    matchedClaimAllowKeys.add(key);
    continue;
  }
  unallowedClaims.push({ ...c, pkg, key });
}

const claimsByPackage = new Map();
for (const c of unallowedClaims) {
  if (!claimsByPackage.has(c.pkg)) claimsByPackage.set(c.pkg, []);
  claimsByPackage.get(c.pkg).push(c);
}

if (process.argv.includes("--claim-ledger")) {
  const lines = [...claimsByPackage.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([pkg, found]) => {
      const names = [...new Set(found.map((c) => c.name))].sort();
      return `  ${JSON.stringify(pkg)}: [\n` + names.map((n) => `    ${JSON.stringify(n)},`).join("\n") + `\n  ],`;
    });
  console.log("const CLAIM_DEBT = {\n" + lines.join("\n") + "\n};");
  process.exit(0);
}

const errors = [];

// 1. A collision that is not in the ledger is NEW. This is the half that stops
//    the bleeding: a fresh fork fails on the PR that writes it, by name.
for (const [pkg, found] of byPackage) {
  const declared = new Set(DEBT[pkg] ?? []);
  const fresh = found.filter((v) => !declared.has(v.name));
  if (fresh.length === 0) continue;
  errors.push(
    `${pkg} declares ${fresh.length} spec-named symbol${fresh.length === 1 ? "" : "s"} the spec already owns:\n` +
      fresh
        .map(
          (v) =>
            `        ${v.kind} \`${v.name}\`  ${relative(root, v.file)}:${v.line}  ` +
            `(exported by \`${v.subpaths.join("`, `")}\`)`
        )
        .join("\n") +
      `\n      Import it (\`export type { X } from '@objectstack/spec/…'\`), derive it\n` +
      `      (\`export type X = z.infer<typeof SpecX>\`), or — if it deliberately differs — rename it\n` +
      `      to a declared dialect (\`ObjectUiLocalX\`, with a tripwire test asserting the spec does\n` +
      `      not own the name) or add an ALLOW entry with the reason.`
  );
}

// 2. Ratchet — a ledger entry whose symbol is fixed (or gone) must be deleted.
//    Left in, it reserves the name: the next fork under it would land silently.
//
// ⚠️ The tail's WORDING is constrained, and not by taste (objectui#7265). This
// message names the ledger's anchor card, and taking the INTERMEDIATE reading —
// the site burned down, the block not yet regenerated — is standing practice on
// that card, because it is the only proof the edit reached the symbol rather than
// the block being rewritten around it. So this text is pasted into pull-request
// bodies and commit messages BY DESIGN. GitHub's closing-keyword parser reads one
// of its keywords (the close / fix / resolve families, in every tense) sitting
// immediately before an issue reference, and it does not parse sentences: the
// tail this line replaced put such a keyword directly in front of the anchor's
// own number, so every slice that quoted its own reading carried a trigger that
// would have ended the card on merge — silently, from a body whose author was
// being careful. ⛔ Never write one of those keywords in front of the reference
// here, and keep the `objectui#` prefix rather than a bare `#`. Pinned by
// scripts/__tests__/spec-symbol-ledger-plugin-detail-7265.test.ts, which reads
// this module's emitted text rather than trusting the comment.
//
// ⛔ The `CLAIM_DEBT` twin further down is deliberately NOT given the same
// treatment. Its anchor is a CLOSED issue — the note beside `DEBT_ISSUE` above
// records that exclusion and why it stands — so the keyword there triggers
// nothing, and changing it would quietly make that note false.
for (const [pkg, names] of Object.entries(DEBT)) {
  const live = new Set((byPackage.get(pkg) ?? []).map((v) => v.name));
  const stale = names.filter((n) => !live.has(n));
  if (stale.length === 0) continue;
  errors.push(
    `${pkg} lists ${stale.length} symbol${stale.length === 1 ? "" : "s"} in DEBT that no longer collide` +
      ` — \`${stale.join("`, `")}\`.\n` +
      `      Delete them from scripts/check-spec-symbol-derivation.mjs (\`--ledger\` regenerates the\n` +
      `      block) so the names cannot be re-forked silently` +
      `${DEBT_ISSUE ? `, and objectui#${DEBT_ISSUE} can be ended once the ledger is empty` : ""}.`
  );
}

// 3. Ratchet — an ALLOW entry that excuses nothing is stale and must go, or it
//    silently keeps a name reserved for a future fork.
for (const key of Object.keys(ALLOW)) {
  if (!matchedAllowKeys.has(key)) {
    errors.push(
      `${key} is in ALLOW but no longer collides with a spec export name — the symbol was\n` +
        `      renamed, removed, or is now imported from the spec. Delete the entry so the\n` +
        `      exemption cannot be inherited by a future fork under the same name.`
    );
  }
}

// ── Rule 2's three checks, in the same order and with the same governance ────

const claimErrors = [];

// 4. A spec-alignment claim that is not in the ledger is NEW — the half that
//    stops rule 2's bleeding, by name, on the PR that writes the comment.
for (const [pkg, found] of claimsByPackage) {
  const declared = new Set(CLAIM_DEBT[pkg] ?? []);
  const fresh = found.filter((c) => !declared.has(c.name));
  if (fresh.length === 0) continue;
  claimErrors.push(
    `${pkg} claims spec alignment on ${fresh.length} declaration${fresh.length === 1 ? "" : "s"} that reference` +
      `${fresh.length === 1 ? "s" : ""} nothing from the spec:\n` +
      fresh
        .map(
          (c) =>
            `        \`${c.name}\`  ${relative(root, c.file)}:${c.line}  (claim: "${c.phrase}")` +
            (c.dangling.length
              ? `\n            …and names \`${c.dangling.join("`, `")}\`, which @objectstack/spec does not export.`
              : "")
        )
        .join("\n") +
      `\n      Back the claim or drop it: derive the declaration (\`z.infer< typeof SpecX >\`,\n` +
      `      \`SpecAuthoredInput< … >\`, or import the spec type), add a CLAIM_ALLOW entry saying why\n` +
      `      the copy is deliberate, or delete the sentence — a canonical-sounding comment with\n` +
      `      nothing behind it is a planted premise for the next session, not stale documentation.`
  );
}

// 5. Ratchet — a claim-ledger entry whose declaration is fixed (or gone) must be
//    deleted, or it reserves the symbol for a future unbacked claim.
for (const [pkg, names] of Object.entries(CLAIM_DEBT)) {
  const live = new Set((claimsByPackage.get(pkg) ?? []).map((c) => c.name));
  const stale = names.filter((n) => !live.has(n));
  if (stale.length === 0) continue;
  claimErrors.push(
    `${pkg} lists ${stale.length} symbol${stale.length === 1 ? "" : "s"} in CLAIM_DEBT whose spec-alignment` +
      ` claim is gone — \`${stale.join("`, `")}\`.\n` +
      `      Delete them from scripts/check-spec-symbol-derivation.mjs (\`--claim-ledger\` regenerates\n` +
      `      the block) so the symbol cannot re-acquire an unbacked claim silently` +
      `${CLAIM_DEBT_ISSUE ? ` (and close #${CLAIM_DEBT_ISSUE} once the ledger is empty)` : ""}.`
  );
}

// 6. Ratchet — a CLAIM_ALLOW entry that excuses nothing is stale and must go.
for (const key of Object.keys(CLAIM_ALLOW)) {
  if (!matchedClaimAllowKeys.has(key)) {
    claimErrors.push(
      `${key} is in CLAIM_ALLOW but no longer carries an unbacked spec-alignment claim — the\n` +
        `      declaration was derived, renamed, removed, or the claim was deleted. Delete the entry\n` +
        `      so the exemption cannot be inherited by a future claim under the same name.`
    );
  }
}

// 7. Rule 4 at MEMBER granularity (objectui#7513). No ledger and no allowlist:
//    the measured population was zero on the commit that landed it, so a hit is
//    always fresh and always fails on the PR that writes it.
if (memberCitations.length > 0) {
  claimErrors.push(
    `${memberCitations.length} passage${memberCitations.length === 1 ? " cites" : "s cite"} a spec member the` +
      ` spec does not declare:\n` +
      memberCitations
        .map((c) => `        \`${c.cited}\`  ${relative(root, c.file)}:${c.line}`)
        .join("\n") +
      `\n      The symbol is a real @objectstack/spec export; the KEY is not in its shape. Check the\n` +
      `      installed spec's own schema and correct the passage — cite the key that exists, or say\n` +
      `      plainly that this is a local/legacy spelling the spec refuses. A comment naming a key\n` +
      `      the spec rejects invites a 422 INVALID_METADATA from the save route: the option schema\n` +
      `      is \`.strict()\`, so one such key sinks the WHOLE field (objectui#7513).`
  );
}

// ── 8. The ledgers' own health: can each anchor still receive its instruction? ─
// objectui#9537. Rules 1-7 judge the tree; this one judges the ledgers' own
// anchors, because the two ratchets above end their messages by naming a card.
// The reasoning, the declared-state boundary and the standing exclusion are all
// at `LEDGER_ANCHORS`; this loop is only the wiring.
const anchorErrors = [];
const excludedAnchorNotes = [];
for (const anchor of LEDGER_ANCHORS) {
  const finding = ledgerAnchorDiagnostic(anchor);
  if (finding) anchorErrors.push(finding.message);
  // Keep a standing exclusion VISIBLE on green runs, and let it retire itself:
  // the note stops printing the day the excluded anchor would no longer fire.
  if (anchor.excludedByName && ledgerAnchorDiagnostic(anchor, { ignoreExclusion: true })) {
    excludedAnchorNotes.push(anchor.excludedByName);
  }
}

const outstanding = Object.values(DEBT).reduce((sum, names) => sum + names.length, 0);
const outstandingClaims = Object.values(CLAIM_DEBT).reduce((sum, names) => sum + names.length, 0);

if (errors.length === 0 && claimErrors.length === 0 && anchorErrors.length === 0) {
  console.log(
    `✅  spec symbol derivation: ${files.length} files scanned against ${specNames.size} spec export names; ` +
      `${Object.keys(ALLOW).length} declared dialect${Object.keys(ALLOW).length === 1 ? "" : "s"}, ` +
      `${outstanding} untriaged collision${outstanding === 1 ? "" : "s"} in ${Object.keys(DEBT).length} packages.\n` +
      `✅  spec alignment claims: ${Object.keys(CLAIM_ALLOW).length} declared deliberate ` +
      `${Object.keys(CLAIM_ALLOW).length === 1 ? "copy" : "copies"}, ` +
      `${outstandingClaims} unbacked claim${outstandingClaims === 1 ? "" : "s"} in ` +
      `${Object.keys(CLAIM_DEBT).length} packages.\n` +
      `✅  spec member citations: ${files.length} sources + ${proseSources.length} documentation pages; ` +
      `nothing cites a key its spec symbol does not declare.\n` +
      `✅  ledger anchors: ${LEDGER_ANCHORS.length} declared; none renders an instruction its anchor card can no longer receive.` +
      excludedAnchorNotes.map((note) => `\n    ⚠️  excluded by name: ${note}`).join("")
  );
  process.exit(0);
}

if (errors.length > 0) {
  console.error("❌  a spec-named symbol is hand-written, not derived:\n");
  for (const message of errors) console.error(`    • ${message}\n`);
  console.error(
    "A local declaration under a spec export's name is read by the next agent as the spec's own\n" +
      "definition — that is how #2901 was filed with a backwards premise. See\n" +
      "https://github.com/objectstack-ai/objectstack/issues/4115 for the four symbols that had\n" +
      "already drifted when this guard was written.\n"
  );
}

if (claimErrors.length > 0) {
  console.error("❌  a spec-alignment claim has nothing behind it:\n");
  for (const message of claimErrors) console.error(`    • ${message}\n`);
  console.error(
    "Rule 1 above matches BY NAME, so a hand copy that was RENAMED away from the spec's symbol is\n" +
      "invisible to it — `ViewNavigationConfig` (objectui#4588) carried the spec's six navigation\n" +
      "keys, drifted on `mode`, and passed every CI run under the comment \"Aligned with\n" +
      "@objectstack/spec ListView.navigation\". The claim is the part both known instances shared.\n" +
      "See https://github.com/objectstack-ai/objectui/issues/4592."
  );
}

if (anchorErrors.length > 0) {
  console.error("❌  a ledger anchor no longer points at a card anyone can act on:\n");
  for (const message of anchorErrors) console.error(`    • ${message}\n`);
  console.error(
    "Both ratchets above end their stale-entry message by naming the ledger's anchor card, so an\n" +
      "ended anchor turns that message into an instruction nobody can follow — and it went that way\n" +
      "silently twice before this check existed. What this check does and does not see is written at\n" +
      "`LEDGER_ANCHORS` in this file.\n" +
      "See https://github.com/objectstack-ai/objectui/issues/9537.\n"
  );
}

process.exit(1);
}

// Run only when invoked directly — the test suite imports `findClaim` /
// `scanFileForClaims` / `normalizeDoc` from here and must not trigger a repo
// scan (or a process.exit) on import. Same guard shape as
// scripts/check-control-bytes.mjs.
const invokedDirectly = isEntrypoint(import.meta.url);
if (invokedDirectly) main();
