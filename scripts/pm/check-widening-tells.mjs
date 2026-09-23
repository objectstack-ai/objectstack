#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-widening-tells — the MECHANICAL half of the directional clause-②
 * ruling (#16349, decision batch #62): a diff that ADDS a key, an arm, an
 * export or a registration while its card's claim reads `Clause-②: no` is
 * refused at enqueue, with the file:line of the tell (#16448).
 *
 *   node scripts/pm/check-widening-tells.mjs --self-test
 *   node scripts/pm/check-widening-tells.mjs --declaration no --diff /tmp/pr.diff
 *   node scripts/pm/check-widening-tells.mjs --declaration no --files /tmp/files.json
 *   git diff origin/main...HEAD | node scripts/pm/check-widening-tells.mjs --declaration no --diff -
 *
 * To judge a diff from the sibling repo, name the board in the environment —
 * ⛔ there is no `--repo` flag, deliberately (see "What the verdict SAYS it
 * looked at" below):
 *
 *   PM_SWEEP_REPO=objectstack-ai/objectui \
 *     node scripts/pm/check-widening-tells.mjs --declaration no --diff /tmp/objectui-pr.diff
 *
 * ## Why this file exists at all
 *
 * Clause ② used to be judged as a two-sided question ("does this card touch
 * the contract?"), and #16349 made it DIRECTIONAL: widening the accept set or
 * the public surface triggers the contract-review tier; pulling code back to
 * the declared contract does not. The maintainer's condition on that
 * relaxation was explicit — **the direction claim becomes checkable instead of
 * trusted**. A direction nobody can check is a self-declaration, and a
 * self-declaration that only ever loosens the tier is the one shape the whole
 * clause-② chain is written against.
 *
 * `dispatch-gates.mjs`'s `SUSPECT_TIER_GLOBS` already says where the check
 * belongs, in its own words: "whichever tier is dispatched, the PR's ACTUAL
 * diff passes the clause-② enqueue gate before the card may enqueue — the diff
 * is a fact; the card's semantics were a prediction. The gate itself lives in
 * the PM skill (入队与落地); this output only points at it." Until this file,
 * that gate was a human reading. This is it, mechanized.
 *
 * ## The four tells, and what each one is a tell OF
 *
 * A TELL, never a proof (#16448 states this as a prohibition, so it is stated
 * here as one too). Each tell is a syntactic shape that a WIDENING diff
 * normally has and a narrowing diff normally does not:
 *
 *   T1  a new key on a Zod object schema on the contract source surface — the
 *       accept set gains a spelling an author may now write.
 *   T2  a new member of a closed set: `z.enum([…])`, `z.union([…])`,
 *       `z.discriminatedUnion(…)`, or a `CORE_PLUGIN_TYPES`-shaped `as const`
 *       array — the accept set gains a VALUE.
 *   T3  a new row in a published entry point's export listing
 *       (`packages/spec/api-surface/*.json` and its signatures sibling) — the
 *       PUBLIC SURFACE grows, which ADR-0059's backward-compatibility gate
 *       already treats as the breadth half of a contract change.
 *   T4  a new registration in a registry / catalog — the error-code ledger,
 *       the dispatcher vocabulary, the metadata form registry. A registration
 *       widens what the runtime will ACCEPT without any schema file moving.
 *
 * ## What it deliberately does NOT do
 *
 * **It does not judge narrowings.** A removal-only diff with `Clause-②: no`
 * passes, and so does a tightened `.refine(…)`: a tell is an ADDITION shape and
 * this file reads added lines only. That is the ruling's own direction, not a
 * gap — a narrowing claim that is wrong is a different card's problem.
 *
 * **It never blocks a `yes`.** `Clause-②: yes` already routes to contract
 * review, so a tell on top of it adds nothing to decide. Refusing a `yes` would
 * make the honest declaration the expensive one, which is how a gate teaches
 * people to declare `no`.
 *
 * **False positives are the accepted cost; false negatives are the ruling's.**
 * #16448 fixes both directions: "False positives are acceptable (the author
 * re-declares or explains); false negatives are the cost the ruling accepted."
 * So a fixture whose added line merely LOOKS like a schema key is refused.
 *
 * ⛔ But never again describe that refusal as costing "one word in the claim
 * comment". This file said exactly that until #16822, and the sentence was
 * wrong twice over. It UNDERSTATED the price: C5's exit-0 condition is "no
 * tell, OR the declaration is not `no`", so the only word that clears a false
 * tell is flipping `Clause-②: no` to `yes` — writing a widening that does not
 * exist into a ledger consulted later as evidence of direction, where it is
 * afterwards indistinguishable from a real one. The refusal sentence's other
 * door, "explain in the claim", is a reading a human can act on; it moves no
 * exit code. ⛔ Recording that is not proposing a bypass, and this file offers
 * none: the #16448 row stands and a non-zero `--pair` exit stays a hard block.
 * It means a DEMONSTRATED false positive is repaired HERE, in the matcher —
 * the author is not asked to pay for a regex collision with a false
 * declaration, because the declaration is a governance record, not a log.
 *
 * ⛔ And the sentence's second half — "never a weakened rule here" — was
 * defending something real, so it is restated rather than dropped: a tell may
 * be narrowed only on evidence the hunk actually CARRIES, and never in a way
 * that trades a loud failure for a quiet one. A matcher that stops reporting a
 * real widening is worse than one that over-reports, because an over-report
 * argues back and a silence does not. Every narrowing below therefore declines
 * ONLY on positive evidence; absence of evidence leaves the tell firing.
 *
 * ## The two accidental variables #16822 removed — what a hunk DOES carry
 *
 * Both refinements read bytes the hunk already contains: the added line's
 * NEIGHBOURS on the new-file side, and the lines the same hunk REMOVED. ⛔
 * Neither recovers block state. This file still cannot tell an array element
 * from a call argument, still does not know whether a property sits inside
 * `z.object({`, and ⛔ still has no notion of DIRECTION — a tell, never a
 * proof, exactly as before. (#17618 later added the ONE bracket fact a hunk
 * does carry — which delimiter is innermost, over that hunk's own lines — and
 * nothing more: still no shape, still no direction. Its section is below.)
 *
 * **A fragment of a multi-line string concatenation is not a set member.**
 * #16822's filing left the instrument that proves the variable was accidental:
 * a prose message of EIGHT fragments produced exactly ONE tell, because
 * fragments 2-8 begin `+ '…'` and `^[ \t]*'` cannot match a leading `+`.
 * Moving the first fragment up onto the calling line makes the IDENTICAL
 * string stop being a tell. So the continuation operator is now read on both
 * sides — the `+` that opens the next line, and the `+` left at the end of the
 * previous one, since both spellings are in the tree. Measured 2026-09-08 over
 * `packages/spec/src/**`: of 6,035 lines matching the bare-element shape,
 * 1,707 are followed by a `+ '…'` continuation and 479 follow a line ending in
 * `+` — 2,186 prose fragments on the surface T2 polices, none of them a member
 * of anything.
 *
 * ⚠️ The quiet direction that buys, stated plainly rather than buried: a
 * closed-set MEMBER spelled as a multi-line concatenation — `'be'` on one line,
 * `+ 'ta',` on the next — is now declined, and adding one would go unreported.
 * Measured over `packages/spec/src/**` and `packages/runtime/src/**`: of 4,957
 * member lines inside 401 array / closed-set blocks, the 116 that are
 * multi-line concatenations are all property VALUES (the `reason:` prose of
 * the ledger's waiver rows), and no MEMBER is spelled that way. ⛔ That is not
 * zero risk; it is the only quiet direction #16822 added, and it is here so the
 * next reader can weigh it rather than discover it.
 *
 * **An opener that re-declares the SAME binding adds no value.**
 * `CLOSED_SET_OPENER` fires on the constructor keyword, identically whether the
 * rewrite widens the set or narrows it. #16822's second instance was three
 * `z.union([` → `z.discriminatedUnion('type', [` conversions, which cannot
 * widen — the discriminated form tries exactly ONE arm where the flat form
 * tried all of them, so its accept set is a subset — and the gate called them
 * widening tells. ⛔ The fix does not teach the matcher direction: direction is
 * no more recoverable from a hunk than block state is. It drops a line that
 * never carried the information. An opener whose list opens on a LATER line
 * declares no member at all, and when the SAME hunk removes an opener with the
 * identical binding prefix, the set was already there; its members are still
 * read one line each by the two member tells, so an arm the rewrite ADDS still
 * fires.
 *
 * ⚠️ The evidence must be in the hunk: no paired removal, no suppression — a
 * brand-new `z.union([` still tells. A prefix that differs is not the same
 * binding and keeps the tell, which is the right answer when the difference is
 * `const X =` → `export const X =`: that rewrite really does widen, on the
 * published surface rather than the accept set. And an opener carrying its
 * members INLINE (`z.enum(['a', 'b'])`) is not an opener-only line, so it is
 * never suppressed.
 *
 * **An unread diff is not a narrow diff.** A file on a tell surface whose
 * content this gate could not read is reported as a GAP (exit 2), never folded
 * into the clean verdict — and the counting that decides it distinguishes a
 * count that was TAKEN from a count that is MISSING (`addedNothing`). The
 * failure this rule is written against is not hypothetical: the local diff
 * splitter briefly stamped `additions: 0` on binary rows, which made a binary
 * edit to a published-surface file read as clean through the very gate whose
 * contract this is.
 *
 * **It writes nothing and hangs no label.** Same call `check-clause2-carriers`
 * and `check-half-states` make: a checker that hung a review-gate label would
 * be issuing the review verdict, which is 自查放行. ⛔ No new label and no
 * new claim-line syntax exist because of this file — #16448 forbids both, and
 * the reader it uses is the sibling's existing `Clause-②:` reader.
 *
 * ## The third accidental variable #16943 removed — a REPLACED line
 *
 * Both refinements above read a hunk's bytes and still judged one added line at
 * a time, so neither could see the commonest thing a diff does: put a line back
 * where an equivalent one stood. Two live pairs reproduced that independently,
 * on different tells and different file kinds — PR #16941, a form's
 * `description:` prose rewritten (T2, on a file containing no `z.enum`, no
 * union and no `as const` at all, members 4 -> 4 and 7 -> 7), and PR #16968, a
 * Zod key whose `.describe()` text grew (T1, keys 32 -> 32, the declared type
 * unchanged). Neither diff moved an accept set, and neither row could be
 * CLEARED: `c5WideningTell(pair, repo)` reads only the pair and the repo, so
 * "explain in the claim" moves no exit code and the single input that flips the
 * number is a `Clause-②: yes` that is false. ⚠️ A gate whose green is reachable
 * only by lying is worse than one that is merely wrong — and #16822's own note
 * above already says where a demonstrated false positive is repaired: HERE, in
 * the matcher.
 *
 * ⛔ The fix is NOT a wider tolerance for string literals. That was the card's
 * own prohibition and it is the right one: a tell that stopped firing on real
 * closed-set additions would be the more expensive failure, and tightening T2's
 * pattern could not have stopped T1 anyway — two tells, one root. The reading
 * added instead is a NET DELTA, per change block, per tell kind: every removed
 * line that carried a member or a key of kind K buys ONE added line of kind K
 * the right not to be reported, spent in patch order, so a block that adds more
 * than it removed still reports the SURPLUS with its own file:line. A genuine
 * addition has no removal to pay for it; that is the whole sensitivity
 * guarantee, and it is a property of the arithmetic rather than of a pattern.
 *
 * The unit is the change BLOCK — a maximal run of consecutive non-context lines
 * inside one hunk, which is git's own spelling of "these lines replaced those".
 * ⛔ Never the hunk: a hunk carries three context lines each side and routinely
 * holds an unrelated removal at one end and a real addition at the other. The
 * `FILE_SCHEMA_KEY` fixture in `--self-test` is exactly that shape and must
 * keep firing — pairing across it would buy silence with the wrong coin.
 *
 * Two things deliberately do not pay: a closed-set OPENER (it declares no
 * member — #16822 established that, and `rewritesExistingOpener` is the reading
 * that judges an opener), and a removed line #16822 already declines on the OLD
 * side, since deleted prose is not a member either.
 *
 * ⚠️ The quiet direction this buys, stated rather than left to be discovered: a
 * one-for-one member RENAME inside an existing set now declines. Nothing in a
 * hunk distinguishes a renamed member from a reworded string, and the ruling
 * this implements is replacement-vs-net-addition, not spelling. Measured over
 * the 82 commits touching these surfaces in this tree's history: of 715 change
 * blocks that add a member or key line, 674 pay nothing and are untouched, 7
 * are partly paid and still report their surplus, and 34 now decline — 22 of
 * those keep the identifier of the key they rewrote and all 12 of the rest are
 * prose / `.describe()` rewrites. Not one is a member rename. What still
 * catches a rename that slips past: `check:api-surface` on any exported name it
 * moves, `check:authorable-surface` on any authorable key, and the ADR-0087
 * registries — instruments a rename must move and a rewording cannot.
 *
 * ## The fourth accidental variable #17300 removed — a ledger of REMOVALS
 *
 * T2 is "the accept set gains a VALUE", and the ADR-0087 retirement ledger
 * (`packages/spec/src/migrations/registry.ts`) is a list of values written
 * BECAUSE an accept set shrank: `RETIRED_KEYS_BY_MAJOR` and
 * `RETIRED_DEFS_BY_MAJOR` are tombstones, and a step's `conversionIds` names the
 * D2 conversions that STRIP the retired shape on load. Every retirement adds
 * rows to them — that is the kit working as designed — so the mechanical
 * clause-② axis read ADVERSE on the one change class whose direction is most
 * unambiguously narrowing. Measured on PR #17298 (the maintainer's 「撤」
 * retirement of the list-view `type: 'page'` mount): three T2 rows, exit 4,
 * against a declaration that is correct.
 *
 * ⛔ The fix is NOT excluding the file, and ⛔ not excluding the generated
 * regions either. Both are holes rather than repairs — anything a generator
 * emits there would stop being judged — and neither could have worked anyway:
 * of the three rows, ONE (`'view-page-mount-removed'`, the conversion id) sits
 * in the HAND-MAINTAINED `conversionIds` array, outside every `<os-generated …>`
 * marker. A predicate keyed on position covers two rows of three and leaves
 * `--pair` at exit 4 on every retirement that registers a conversion, which a
 * D2 retirement does by definition.
 *
 * ⛔ And it is not a lookup in the local tree. That reading was measured and it
 * is not merely expensive, it is WRONG for the whole population: a retirement
 * registers its conversion in the SAME PR, so `view-page-mount-removed` is
 * absent from `src/conversions/registry.ts` in any checkout of `main` (measured
 * on this tree: 0 occurrences, against a positive control
 * `turso-config-timeout-to-timeout-ms` reading 1). A seat's worktree is not the
 * diff's head, and resolving an id against it answers about the wrong commit —
 * in the direction that keeps the false positive.
 *
 * What the DIFF carries instead is the generator's own INPUT. #7297 split those
 * three tables into `src/migrations/entries/`, one file per entry, precisely so
 * a retirement writes a FILE instead of appending to a shared tail line; the
 * file's payload is `export const entry = '<the row>';`, the exact string the
 * generated row carries. So a row DECLINES only when this same diff ADDS the
 * declaration that mints it:
 *
 *   - `export const entry = 'ui/ListView:pageName';` under
 *     `packages/spec/src/migrations/entries/**` licenses that one row, and
 *   - `id: 'view-page-mount-removed',` added to
 *     `packages/spec/src/conversions/registry.ts` licenses that one id.
 *
 * ⚠️ This is the first reading in this file whose evidence spans FILES rather
 * than a hunk, and the departure is deliberate rather than overlooked: the
 * generator's input and its output are two files BY CONSTRUCTION (#7297), so a
 * hunk-local reader cannot see the input however carefully it is written. The
 * evidence is still positive, still carried by the document being judged, and
 * still absent by default — a licence is minted by an added line or not at all.
 *
 * The sensitivity guarantee is exact string identity, not a shape: an entry
 * file for `'a/B:c'` buys nothing for `'a/B:d'`; a licence buys nothing for the
 * same string added to any OTHER file; a row typed by hand between the markers
 * with no entry file still fires, which is also what `check:migration-registry`
 * reports; and a genuinely new member of a genuinely closed set in the ledger
 * file still fires with its own file:line. ⚠️ The quiet direction, stated
 * rather than left to be found: a regeneration that lands SEPARATELY from the
 * entry file it emits — the entry added in one PR, `gen:migration-registry` run
 * in the next — carries no licence in its own diff and still tells. That is the
 * loud direction and it is the right one; the second PR re-declares or explains.
 *
 * ## The fifth accidental variable #17618 removed — a line's SURROUNDINGS
 *
 * T1's sentence is "the accept set gains a spelling an author may now write",
 * and two live pairs raised it against diffs that spell nothing new. Both were
 * measured on the PRs' own pushed bytes before the reading below was written:
 *
 *   - PR #17616 — `+  ctx: z.RefinementCtx,`, the SECOND PARAMETER of an
 *     exported object-level refinement. `z.RefinementCtx` is a TYPE, nothing
 *     constructs a shape there, and the diff the row appeared on REFUSES
 *     metadata that parses today. ⭐ The signature is this repo's own
 *     prescribed one (the `#16489` convention — `checkListViewPageMount`,
 *     `checkPageSourceCompleteness`, `checkGlobalFilterDateDefaultValue`), so
 *     EVERY diff that adds a cross-field refusal raised a widening tell for the
 *     refusal itself: the instrument read the tightening direction as the
 *     widening one, which is the inverse of what clause ② exists to catch.
 *     ⚠️ …and the decline written here did NOT reach a real diff of that shape
 *     until #18721 below: it was abandoned on the hunk's LEADING CONTEXT, and
 *     the synthetic hunk that pins it carries none.
 *   - PR #17638 — `+  strategy: z.enum(['eager', 'lazy'], {`, an in-shape key
 *     the same change block removed as `-  strategy: z.enum(['eager', 'lazy',
 *     'scheduled']).default('lazy')`. The same key, one member FEWER. This one
 *     was not a cost on the reading: it exited 4 against a correct
 *     `Clause-②: no` and held a reviewed, green retirement PR out of the queue,
 *     where the only sanctioned clear is the false `yes` this file already
 *     refuses to ask an author for.
 *
 * ⛔ The second is NOT #16943's budget being too thin. The budget was EARNED —
 * the removed `strategy:` line is itself T1-shaped and bought one T1 unit — and
 * then refused at the SPEND, by "a line that DECLARES a closed set is never
 * spent against the budget". That refusal was written about an OPENER, and an
 * opener never reaches it: `memberTellKind` already answers `null` for an
 * opener-only line. So the only lines it ever caught were KEYS whose value
 * happens to open `z.enum(` / `z.union(` / `z.discriminatedUnion(` /
 * `z.literal(` — the population it was not written about. Measured on this
 * tree: `field: z.string()` -> `field: z.string().optional()` declines, while
 * `kind: z.enum(['a'])` -> `kind: z.enum(['a']).optional()` fires. The
 * asymmetry was accidental.
 *
 * What replaces the blanket refusal is the thing it was protecting: an INLINE
 * set has no per-member line for T2 to read, so a set widened in place is
 * visible on the T1 row and nowhere else. A closed-set-valued key may therefore
 * spend the budget only on three facts the BLOCK carries — a removed line
 * naming the SAME key, both member lists readable on their own line, and the
 * added list a SUBSET of the removed one. `z.enum(['a', 'b'])` ->
 * `z.enum(['a', 'b', 'c'])` still fires; a list that opens on a later line is
 * unreadable and still fires; another key's removal pays nothing.
 *
 * The parameter half reads the added line's SURROUNDINGS, and its claim is
 * deliberately smaller than the depth-aware `z.object({ … })` reader T1's own
 * comment refuses — the one whose cheap version fails GREEN by truncating. A
 * Zod shape body is `{`-delimited BY CONSTRUCTION, so the question is never
 * "which shape is this line in" but "which bracket is innermost", read over the
 * line's OWN hunk and answering `null` — keep the tell firing — for every state
 * it cannot carry honestly: a closer arriving on an empty stack (the hunk began
 * inside something it was never shown), a string literal that does not close on
 * its line, a declaration head it does not recognise. Nothing it returns ever
 * means "no longer inside a shape", which is why it has no truncating failure.
 *
 * The price, measured over the 233 commits touching these surfaces in this
 * tree's history (`e9efc403`): of the 20,193 tell rows the previous reading
 * raises, 23 now decline and 20,170 stand. All 23 are T1 — no T2, T3 or T4 row
 * moves. Fifteen are parameters (twelve `ctx: z.RefinementCtx` or
 * `z.core.$RefinementCtx`, three `input: z.input<typeof …Schema>`) and eight
 * are existing keys re-spelled to carry `.meta({ title })` or a rewritten
 * `.describe()` around an IDENTICAL enum. Not one is a key or a member its diff
 * added. On the tree itself, 16 of the 8,974 T1-shaped lines under
 * `packages/spec/src/**` sit inside a parameter list, 10 of them annotated
 * `z.RefinementCtx`.
 *
 * ⚠️ The two quiet directions this buys, stated rather than left to be
 * discovered:
 *
 *   1. A PARAMETER ADDED to an ALREADY-exported function is a signature
 *      widening, and it now goes unreported here. Nothing else in this file
 *      catches it: T3's listing records that an export EXISTS, and its
 *      signatures sibling `api-surface-signatures.json` carries 27 `define*`
 *      helpers (measured on this tree), none of them one of these checks. What
 *      is NOT lost is the function itself — a newly exported check adds its own
 *      row to the listing, which is the T3 row PR #17616 still reports.
 *   2. A widening carried by the CHAINED methods rather than by the member list
 *      — `.optional()` first among them — now declines on a closed-set-valued
 *      key. ⛔ Not a new class: #16943 already declines it for every key whose
 *      value is not a closed set, and this removes the accidental exception
 *      rather than adding one. In the measured population all eight
 *      re-spellings are `.meta` / `.describe` rewrites and none adds
 *      `.optional()`.
 *
 * ## The sixth accidental variable #17955 removed — a key DECLARED UNWRITABLE
 *
 * T1's sentence is "the accept set gains a spelling an author may now write",
 * and the gate raised it on the line that DECLARES A TOMBSTONE. Measured on PR
 * #17954 — the first of the #15939 ruling-A duration-key renames — where
 * `+    schemaCacheTTL: retiredKey(` was the ONLY tell in the whole diff and
 * `check-clause2-carriers --pair 17954` returned exit 4 / C5.
 *
 * `retiredKey()` (`packages/spec/src/shared/retired-key.ts`) returns
 * `z.never(…).optional()` and its entire contract is to REFUSE. The line it is
 * written on makes the accept set strictly NARROWER: the key's `z.input`
 * becomes `never` so `tsc` rejects it at the authoring site, and a value that
 * reaches the parse is refused carrying the migration prescription. There is no
 * spelling an author "may now write" — there is one they may no longer write.
 * The instrument read the change class whose direction is least ambiguous as
 * the widening one, which is the inverse of what clause ② exists to catch, and
 * is the same failure #17300 and #17618 each record one surface over.
 *
 * ⚠️ The population is not one card. A tombstone is the AGENTS.md-mandated kit
 * for removing an authorable spec key ("Removing an authorable spec key also
 * requires a tombstone so the rejection itself carries the prescription"), so
 * it is EVERY ADR-0087 key retirement and every rename that tombstones its old
 * spelling. Measured on this tree: 254 tombstone key lines across 66 files on
 * the judged surface.
 *
 * ⛔ The fix is NOT a weakening of T1, not a threshold, and not an exclusion of
 * `packages/spec/src/**` — #17300 ruled that shape out by name. ⛔ Nor is it a
 * lookup in the local tree, which #17300 measured WRONG for this whole
 * population, because a retirement registers in the SAME PR. What the hunk
 * carries instead is positive, hunk-local and absent by default: the added
 * line's own VALUE opens the helper. ⭐ `retiredKey(` stays in
 * `SCHEMA_PROPERTY`'s measured vocabulary, so the row is still RECOGNISED as a
 * key line — `memberTellKind` still answers T1 for it and both sides of the
 * budget keep reading one question. It is the TELL that declines, on evidence
 * the line itself carries, never the vocabulary that shrinks.
 *
 * ⭐ It is read BEFORE the #16943 budget, and that ordering is the repair
 * rather than a detail of it. An ADR-0087 rename puts THREE key lines in one
 * change block — the old spelling removed, the new one added, the tombstone
 * added — so the REPLACEMENT budget the removal earns is owed to the RENAME.
 * Let the tombstone spend it and the budget is exhausted by the one line that
 * never needed it, leaving the rename to report as the surplus; which of the
 * two fires then depends on nothing but the order the author wrote them in.
 * ⛔ This is the OPPOSITE ordering from #17300's licence, and the difference is
 * the evidence rather than a preference: a licence is minted ELSEWHERE in the
 * diff, so reading it before the budget would let it pay for a genuine member.
 * A tombstone carries its evidence on its own line and takes nothing out of the
 * block, so a genuine key beside it still has the whole budget to pay with —
 * and still fires, with its own file:line, when it cannot.
 *
 * The REMOVED side declines symmetrically, the way #17618's parameter does.
 * Un-retiring a key — dropping `legacy: retiredKey(…)` and putting a live
 * schema back on that spelling — is a real WIDENING, and a removed tombstone
 * that bought the replacement would trade this file's loud failure for a silent
 * one on the only diff shape that RE-OPENS an accept set the tree had already
 * closed. That leg gains diagnostics rather than losing them: it fires where
 * the previous reading was silent.
 *
 * The price, measured over the 1,674 commits touching these surfaces in this
 * tree's available history: of the 24,725 tell rows the previous reading
 * raises, 125 now decline and 24,600 stand. All 125 are T1, and all 125 are
 * `retiredKey()` tombstones by the very predicate that declines them — checked
 * row by row, 0 exceptions — spread over 23 commits and 45 files. No T2, T3 or
 * T4 row moves. ⭐ And NO row anywhere in that history begins firing: the
 * un-retiring leg has zero historical population, so it is a sensitivity
 * guarantee this tree has never yet had occasion to exercise, not a new
 * refusal aimed at work already done.
 *
 * ⚠️ The quiet direction this buys, stated rather than left to be discovered —
 * and stated as MEASURED, because the first wording of this paragraph bounded
 * it with an argument that does not hold. The bound is NOT "the helper's
 * contract accepts nothing, so no such line can add a spelling": a value may
 * OPEN `retiredKey(` and then CHAIN a live arm onto its result —
 * `legacy: retiredKey('gone').or(z.string()),` and the same line with
 * `.catch(undefined)` — and each of those leaves a key an author may still
 * write. Both fired on the reading this file shipped before them, both went
 * silent on the first version of `declaresUnwritableKey`, and both fire
 * again now: the predicate requires the value to BE the call and nothing after
 * it, and the battery carries them as controls.
 *
 * ⚠️ What stays quiet is exactly ONE LINE-SHAPE — one, among the lines this
 * reader can READ, which is the qualification #18488 made this sentence carry
 * and the whole subject of the paragraph after it. Named here so the next
 * reader meets it instead of rediscovering it: a MULTI-LINE tombstone whose
 * CLOSING line chains that arm — `legacy: retiredKey(` on the key line, with
 * `).or(z.string()),` two lines down. The key line is a tombstone by every byte
 * it shows, and the closing line declares no key, so no line-shaped reading
 * reports it. Measured population on this tree: 0.
 * ⭐ Control: the same scanner locates all 255
 * tombstone key lines across 66 files, of which 178 are multi-line, and the
 * SINGLE-line chained form it is the twin of reads T1. (That control was
 * re-measured at 1fb36ca44d; every other census figure in this file is the
 * 1cb6a06195 reading, which found 254 with one fewer closing on the key line.)
 * The gate owner ruled it open rather than reading forward to the balancing
 * paren — a forward read crosses lines to decide a population of zero, while
 * the single-line escape closes on the key line at no cost, and the identical
 * question was answered the same way on #18095 the same day.
 * ⭐ The OVERTURN CONDITION is written
 * down so it needs no second discussion: the FIRST real multi-line chained
 * carrier — landed, never a synthetic sample — closes it by reading forward.
 * This paragraph and the self-test case pinned beside the #17955 battery's
 * vocabulary assertion are that carrier's discovery device.
 *
 * ⭐ #18488 — the qualification that sentence now carries, and why closing it
 * is not a second quiet direction. The decline reads "the call is still open at
 * the end of the line" off a line-shaped scan that answered `-1` for THAT and
 * for "this reader cannot read the rest of the line" with the same number.
 * `legacy: retiredKey(/\(/.source).or(z.string()),` is valid TypeScript that
 * CLOSES the call and chains a live arm onto it, so it leaves a key an author
 * may still write; the unpaired paren inside the regex literal is pushed onto
 * the stack by a reader that does not lex regex literals, the line reads as
 * open, and the decline swallows the key. ⭐ And it does NOT arrive through one
 * of the four "cannot parse" returns — a `/` is neither `/*` nor `//`, so the
 * scan falls off the end of the line with a non-empty stack, the ONE ending
 * that means genuinely open. Flagging those four would have left this line
 * exactly as silent as it was, which is why {@link readToCloser} reports
 * CERTAINTY separately from the index and the decline requires both; that
 * docblock is the authority on which endings are certain and why.
 *
 * ⛔ The opposite reading is the expensive error, and it is the easy one to
 * reach for: treating EVERY `-1` as "keep firing" re-fires all 178 multi-line
 * tombstone key lines in this tree, which is the false positive #17955 exists
 * to remove. So the two are separated rather than merged, and the measured cost
 * of the separation is 0 — all 255 in-tree tombstone key lines and all 299
 * tombstone-shaped rows in this tree's available history keep their verdicts,
 * line for line, the 49 that carry a quote and the 4 that carry a backtick
 * inside a quoted prescription included (1fb36ca44d). ⚠️ This corner is a
 * PARSER limit and the shape above it is a LINE-SHAPE choice: closing this one
 * closes nothing of that one, and leaves its overturn condition where it is.
 *
 * ⚠️ One boundary this deliberately does NOT touch, recorded rather than left
 * to be found: the PRESCRIPTION a tombstone carries is bare-string lines, so a
 * prescription written on ONE line still reads as a T2 member. The spelling
 * census, corrected — an earlier wording of it claimed every one of the 254
 * judged tombstones spells its prescription as the multi-line concatenation
 * #16822's continuation rule already declines, and that is false. Measured by
 * the branch the predicate itself takes: 178 do not close the call on the key
 * line (148 ending at `retiredKey(`, 30 continuing into a prescription helper's
 * own arguments) and 76 DO close on it — 61 naming a constant, 15 calling a
 * helper, 0 carrying a string literal. The operative conclusion survives the
 * correction and is reached by DIRECT SIMULATION rather than by that claim:
 * feed all 254 blocks back through this reader as added hunks and 0 rows of any
 * kind are raised, where the pre-#17955 reading raises 254 T1 — so the residual
 * T2 population is 0. ⭐ Control: the live-key twin of each of those 254 lines
 * fires, 254 of 254. The 4 key-shaped single-line STRING prescriptions in this
 * tree are all in `packages/spec/src/system/metadata-form-zod-reconciliation.test.ts`,
 * which `surfaceFlags` puts off the contract source surface. It is a different
 * reading's card on the day that population is not zero.
 *
 * ## The seventh accidental variable #18234 removed — a REMOVED value that
 * accepted EVERYTHING
 *
 * T1's sentence is "the accept set gains a spelling an author may now write",
 * and objectui#9540 raised it on a diff that takes a spelling AWAY. One key was
 * narrowed out of `z.unknown()` — zod's universal acceptor — into a
 * `z.union([…])`: `'stage=won'` and `42` were admitted before and are refused
 * after, so the accept set SHRANK and the tell's own sentence is inverted on
 * it. `check-clause2-carriers --pair 9540` returned exit 4 against a correct
 * `Clause-②: no`, and the only sanctioned clear is the false `yes` this file
 * already refuses to ask an author for.
 *
 * ⭐ The finding is the CONTROL SET, not that reasoning. The same removal with
 * the replacement spelled `+ filter: z.array(z.any()).optional()…` DECLINED,
 * while spelling the identical narrowing `+ filter: z.union([` FIRED. One
 * semantic change, two opposite verdicts, decided by nothing but whether the
 * added value's FIRST LINE opens a closed-set constructor — which is not a
 * scale that is set too strict, it is a predicate measuring something other
 * than what it claims to measure.
 *
 * ⛔ It is NOT #16943's budget being too thin, and ⛔ not #17618's three-fact
 * spend being wrong. The budget was EARNED — the removed `filter:` line is
 * T1-shaped and buys one T1 unit — and then refused at the SPEND, because
 * #17618 lets a closed-set-valued key spend only on "a removed line naming the
 * SAME key, both member lists readable on their own line, and the added list a
 * SUBSET of the removed one". Fact 1 holds. Fact 2 CANNOT: a universal acceptor
 * has no member list at all — and that is precisely the case where no list
 * comparison is needed, because the removed set is the UNIVERSE and every
 * replacement is a subset of it by construction. The three-fact test is the
 * right instrument for `z.enum` → `z.enum` and has no way to express "the
 * previous value accepted everything".
 *
 * What is added is therefore a SECOND way to supply #17618's own requirement —
 * positive evidence that the set gained nothing — carried by the removed
 * value's semantics instead of by a list comparison: the block removed the SAME
 * key, and the value it removed was a universal acceptor. ⛔ Nothing about the
 * added value's spelling is read, which is the accidental variable itself.
 *
 * The class is MEASURED rather than assumed, because "both accept everything"
 * is a claim about zod and not about a regex. On zod 4.4.3 in this tree,
 * `safeParse` over `42`, `'stage=won'`, `null`, `undefined`, `{}`, `[]`, `true`
 * and a function: `z.unknown()`, `z.any()` and both with `.optional()` accept
 * all eight; `z.unknown().refine(v => typeof v === 'string')` refuses seven of
 * the eight, which is why a narrowing chain step disqualifies the line.
 * `z.unknown()` and `z.any()` differ only in what `tsc` then permits at the USE
 * site, and that is not the question clause ② asks. ⚠️ `z.custom()` accepts
 * everything too and is deliberately NOT declared: 0 code occurrences in this
 * tree (3 text hits, all prose), and the spelling that would arrive,
 * `z.custom(fn)`, narrows — a row for a shape no tree carries is the dead data
 * the surface table's existence guard exists against.
 *
 * The sensitivity guarantee is the KEY plus the arithmetic, unchanged: a
 * removed acceptor on a DIFFERENT key buys nothing, a removed value that was
 * never universal buys nothing, a `.refine()`d one buys nothing, and the
 * #16943 budget is still SPENT rather than bypassed — so a genuine new key in
 * the same block still fires with its own file:line. An inline enum widened in
 * place has no removed acceptor to name and still fires on the T1 row, which is
 * the one row that can report it.
 *
 * ⚠️ The residual direction, stated rather than left to be discovered, and it
 * is the LOUD one: the reading is line-local, so a removed acceptor whose chain
 * WRAPS onto a second line (`exportOptions: z.unknown().optional()` with its
 * `.describe(…)` below it) is not certified and its replacement still fires.
 * Measured on this tree: 99 of the 132 universal-acceptor key lines terminate
 * on their own line, 33 do not. ⭐ The OVERTURN CONDITION is written down so it
 * needs no second discussion: the FIRST landed pair whose removed acceptor
 * wraps closes it by reading the block's removed run forward instead of one
 * line.
 *
 * ⚠️ And the direction this reading deliberately did NOT touch — now CLOSED
 * by #18629 rather than left standing: a key re-typed INTO a universal acceptor
 * (`z.union([…])` → `z.unknown()`) is a real widening and went unreported.
 * ⛔ That silence was #16943's replacement budget and it PREDATED this reading
 * — measured identical at 21b7c12b4 with the new-key and widened-enum controls
 * firing on the same harness — so it was filed as its own finding rather than
 * repaired here. Its section is below; the repair is a second piece of positive
 * evidence a BLOCK can carry, not a change to the budget for every key.
 *
 * ## The eighth accidental variable #18560 removed — a DECLARING FORM the
 * vocabulary never learned
 *
 * T1 reads a property's VALUE to decide the line declares a schema member, and
 * until this round the vocabulary it read them with was five alternatives
 * inside one 130-character regex literal that nobody could enumerate. A form
 * missing from it is NOT a line judged leniently — it is a line that is not a
 * key line at all: `memberTellKind` answers `null`, so the row neither fires,
 * nor spends the #16943 budget, nor earns it on the removed side, and nothing
 * in the output says a thing. The silence is indistinguishable from a correct
 * `no`, which is the one failure shape this whole chain is written against.
 *
 * ⭐ The counterfactual, RE-DERIVED here rather than inherited from the card
 * that filed it (objectui#9647 comment 5707064702, a reviewer's reading): this
 * CLI with `PM_SWEEP_REPO=objectstack-ai/objectui`, over PR objectui#9647's own
 * diff with the declaration flipped to `no`, at 6dfa3ea77 — exit 0, nine files,
 * one judged against a declared surface, ZERO tells. The added line is
 * `onNodeClick: handlerKeyRefusal('onNodeClick', 'runtime-slot', …)` on
 * `packages/types/src/zod/data-display.zod.ts`.
 *
 * ⚠️ And the re-derivation CORRECTS the card on WHICH form carries a widening,
 * which changes the repair rather than decorating it. The two helpers the card
 * names are objectui's REFUSAL family (`packages/types/src/zod/tombstone.zod.ts`):
 * `retirementTombstone()` is `z.never({ error }).optional().describe()` — the
 * same primitive as this repo's `retiredKey()`, read off the source — and
 * `handlerKeyRefusal()` is `z.custom<never>(() => false).optional()`, whose own
 * docblock records that "The predicate refuses EVERYTHING, a live function
 * included". A key declared through either is a key an author may no LONGER
 * write. Making those two fire would re-mint on 290 objectui key lines the
 * exact false positive #17955 removed on 255 objectstack ones — and a false
 * tell does not cost a word in a comment, it costs the false `yes` the header
 * above refuses to ask an author for.
 *
 * ⭐ The form that DOES carry a widening, and that no seat had named:
 * `stripImportedDefaults()` (`packages/types/src/zod/imported-defaults.ts`),
 * whose contract is stated in its own docblock as "the same TypeScript type,
 * the same keys, the same checks, the same registry metadata and the same
 * accept set". It returns a LIVE schema, it is spelled at 45 key positions on
 * the judged objectui surface (measured at objectui 15f01223d), and a key added
 * through it passed a `Clause-②: no` in silence exactly the way the card
 * describes — that is the red this round turns.
 *
 * ⇒ the repair is the VOCABULARY, as {@link SCHEMA_PROPERTY_FORMS}: a named,
 * enumerable list the regex is BUILT from, carrying two registers that answer
 * two different questions and must never be collapsed into one — `pattern`
 * (what makes the line a KEY LINE) and `writable` (whether the key it declares
 * is one an author may write). The `writable: false` arm is #17955's decline,
 * generalised from one helper name to the family, on the SAME positive,
 * line-local evidence: the value must BE the call and nothing after it, so
 * `onNodeClick: handlerKeyRefusal(…).or(z.function())` fires and the plain form
 * does not.
 *
 * ⛔ The `no` criterion is not loosened anywhere, and the direction is provable
 * rather than argued: an unrecognised line reports NOTHING, so no row that
 * fires today can stop firing when the list grows. Measured against the literal
 * this replaced, over the legacy forms and the four added ones: every legacy
 * verdict is byte-identical, and the only cells that move are the four added
 * forms moving from "not a key line" to "a key line" — one direction, zero
 * losses. The 342 cases standing before this round still stand.
 *
 * ⭐ What the list buys that a longer regex would not: the counterfactual pin.
 * A frozen fixture roster is asserted EQUAL to the form set, so a form added to
 * the list without a fixture reds, and a form silently dropped from the list
 * reds — which is the failure mode that produced this card. Each fixture is
 * then driven through `tellsInFile` and asserted against its own register: a
 * `writable` form must FIRE, an unwritable one must be RECOGNISED and DECLINE,
 * and every unwritable form carries the chained-arm control that fires.
 *
 * ⚠️ The CENSUS the card asked for — has the silence already been relied on?
 * Report-only, and the horizon is stated because a partial is not a zero.
 * Window: objectui's full history (not shallow, 10,282 commits) up to
 * `15f01223d` (2026-09-16), of which the judgeable part starts 2026-09-10, when
 * #17278 first let this CLI be told which board it judges. 46 commits add a key
 * through one of the four added forms on `packages/types/src/zod/**`; 18 of
 * them land inside that window. Read: 11 of the 18 carry a declaration in the
 * PR body — 10 `Clause-②: yes`, 1 (objectui#9443) a "Clause-② carriers" section
 * attaching `needs:contract-review` with no `yes`/`no` token. NOT ATTEMPTED: 7
 * carry no declaration in the PR body, whose remaining carrier is the card's
 * claim comment. ⇒ `Clause-②: no` landings through these forms found: ZERO over
 * the 11 rows read, with 7 rows unread and named. ⛔ No re-grade follows from
 * it; the census is a reading about the instrument's exposure, not about a
 * card.
 *
 * ⚠️ The quiet direction this does NOT close, measured on both boards so the
 * next reader meets it here instead of rediscovering it: a FILE-LOCAL declaring
 * factory. Both trees mint them — `strictIdent(` (12 key lines),
 * `emptyProps(` (9), `strictIdentOrNull(` (8) at objectstack 30bac2880;
 * `chatbotRequestBodyArm(` (2), `retiredDeclarativeKanbanKey(` (1) at objectui
 * 15f01223d — and a list of shared, exported helpers cannot name a factory
 * private to one file. (⚠️ This paragraph named `placeholderFree(` at 6dfa3ea77
 * and was wrong about it: see #18702's section for the measurement that made it
 * a ROW rather than a resolver case.) ⭐ The OVERTURN CONDITION, written down so it needs no
 * second discussion: a name-shaped heuristic (`*Refusal(` / `*Arm(` / `*Key(`)
 * is ⛔ refused, because it would recognise lines on evidence they do not carry;
 * what closes the class is a reading that resolves the factory's own value, and
 * the FIRST landed widening through a file-local factory is its card.
 *
 * ## The ninth accidental variable #18640 removed — WHERE THE NEWLINES ARE
 *
 * T2's sentence is "the accept set gains a VALUE", and #18640 raised it on a
 * line that appends a zod options object to a union whose member list is
 * unchanged. Measured on PR #18638's own pushed bytes, at a7e9a6600b:
 * `check-clause2-carriers --pair 18638` exit 4, row C5, against a declaration
 * two at-tier contract reviews had already read as correct.
 *
 * ⭐ The finding is the CONTROL SET, not the reasoning about that one diff. The
 * same edit spelled one member per line DECLINES today, and has since #16943:
 * the added opener re-declares the removed binding (#16822's
 * `rewritesExistingOpener`) and each removed arm line buys the added line that
 * replaced it. Spelled INLINE it FIRES. Measured, four probes on one synthetic
 * file, this tree:
 *
 *   `const C = z.union([z.boolean(), E]);` -> the same line with `, { error }`
 *   appended                                                   exit 4, one T2
 *   the identical edit with each arm on its own line           exit 0
 *   the identical edit at a KEYED property                     exit 0 (#16943)
 *   the same append plus a THIRD arm, inline                   exit 4, one T2
 *
 * One semantic change, three spellings, two opposite verdicts — decided by
 * nothing but where the author put the newlines and whether the set is bound to
 * a name or to a key. That is not a scale set too strict; it is the accidental
 * variable this family removes, the seventh time.
 *
 * ⛔ The gap is NOT in either reading that already exists, and neither could
 * have closed it. #16822's `rewritesExistingOpener` reads an opener-ONLY line
 * by construction — its regex refuses a line that already carries members, on
 * purpose, because such a line is not merely a declaration — so an inline
 * opener was never in its population. #16943's budget cannot reach the line
 * either: `memberTellKind` answers `null` for `const C = z.union([…])`, which
 * names no key and is no bare element, so the row neither earns on the removed
 * side nor spends on the added one. The line falls through every reading in
 * this file to the raw `CLOSED_SET_OPENER` test, which is the whole of the
 * tell for it.
 *
 * What is added is the same positive, block-local evidence the other two
 * spellings already accept, at the one position that had none: the block
 * removed a line declaring the SAME BINDING, both member lists are readable
 * inline, and the added list adds no NET member. The arithmetic is #16943's
 * own — "the ruling this implements is replacement-vs-net-addition, not
 * spelling" — applied to the members the inline line carries, so this reading
 * is bounded EXACTLY by what the multi-line spelling of the same block does and
 * by nothing wider.
 *
 * ⛔ #17618's KEYED subset test is deliberately NOT changed, and the refusal is
 * the whole direction of this round rather than a scoping detail. A keyed value
 * whose list opens on a later line is unreadable and FIRES — measured, same
 * harness — so the keyed population has no control bounding a relaxation, and
 * carrying this arithmetic across to it would be a loosening with nothing to
 * measure it against. `closedSetBindingMembers` refuses a keyed line by its
 * first condition so the two populations can never merge by accident.
 *
 * ⚠️ Consequence, recorded because the filing card's own pair still shows it:
 * PR #18638's SECOND row — `visible: z.union([z.boolean(),
 * EvaluatedExpressionInputSchema], {` on `component.zod.ts` — is a KEYED line
 * whose union member was RENAMED, so it fails #17618's fact 3 and still fires.
 * That row is a separate question this round refuses to answer by itself:
 * whether a renamed member defeats a subset test is a ruling about fact 3, not
 * a repair of an accidental variable, and buying #18638's green with it is the
 * one motive this round had to refuse.
 *
 * The price, measured over the 749 commits touching these surfaces in the
 * history provably present in this tree (`git-history ensure --days=30`: floor
 * 2026-08-11, tip 2026-09-17 — the clone is shallow and the window is stated
 * because a partial is not a zero): of the 20,452 tell rows the previous
 * reading raises, 20,452 stand and **0** move. 55 of the 3,902 T2 rows in that
 * window sit on a line this reading can READ, and it declined none of them,
 * because none had a same-binding removal in its own change block — absent by
 * default, exactly like every decline in this file. ⭐ And NO row anywhere in
 * that window begins firing. On the tree itself (6dfa3ea77 + this branch), the
 * population the reading can read is 50 lines in 31 files of the 998 judged
 * source files, against 666 keyed inline sets (#17618's, untouched) and 311
 * opener-only lines (#16822's, untouched).
 *
 * ⚠️ The quiet direction this buys, stated rather than left to be discovered: a
 * one-for-one member SWAP at an existing binding — `z.union([A, B])` ->
 * `z.union([A, C])` — now declines, and `C` may accept more than `B` did.
 * ⛔ It is NOT a new class: #16943 bought exactly that silence for every set
 * spelled one member per line and measured it over 82 commits (34 declines, not
 * one of them a member rename); this removes the accidental exception, not the
 * rule. ⭐ The OVERTURN CONDITION, so it needs no second discussion: the FIRST
 * landed widening carried by a same-binding inline member swap — landed, never
 * a synthetic sample — closes it by reading the members' own declarations.
 *
 * ## The tenth accidental variable #18702 removed — a declaring factory
 * PRIVATE to one file
 *
 * #18560 repaired the vocabulary as a NAMED list of shared, exported helpers,
 * and wrote down in the same edit what a list of names can never reach: a
 * factory declared inside the one file that uses it. `SCHEMA_PROPERTY_FORMS`
 * cannot name it — there is nothing to import and nothing to share — so
 * `memberTellKind` answers `null`, the row neither fires nor spends the #16943
 * budget nor earns it on the removed side, and nothing in the output says a
 * thing. That is the SAME failure shape #18560 turned, on the one population
 * its instrument was built not to reach.
 *
 * ⭐ The repair is STRUCTURAL, and the name-shaped heuristic #18560's header
 * refused stays refused. This reading resolves the factory's OWN DEFINITION and
 * classifies it by what its body RETURNS. The measurement that settles which of
 * the two readings is right is the census below: of the eight factories the
 * filing card names, FOUR mint PROSE or an error map rather than a schema
 * (`objectBlockHistory(`, `belongsInConfig(`, `INLINE_CREDENTIAL_REFUSED(`,
 * `ruleArrayFilterError(`), so a `*Refusal(`/`*Arm(`-shaped reading would have
 * fired on 38 key lines that declare no author-writable key at all.
 *
 * ## How the definition is read — the BLOB, never "the file of that name"
 *
 * The judged file's full text is read as a BLOB, by its object id. #17300
 * measured the other reading wrong for this whole family — a seat's worktree is
 * not the diff's head, so resolving anything against it answers about the wrong
 * commit — and a blob id is CONTENT, so it cannot answer about the wrong one.
 * The id comes from the diff itself: `index <old>..<new>` on the local path,
 * the `sha` field on a `/pulls/N/files` row. It is read out of this repo's
 * object store (`git cat-file blob`); only when that fails is the working tree
 * consulted at all, and then only after `git hash-object` proves the file on
 * disk IS that blob, byte for byte. Every other outcome is `null`.
 *
 * ⛔ BOUNDARY ONE — an IMPORTED factory stays unrecognised, and imports are ⛔
 * not chased. Only the file the diff CARRIES is pinned to the judged head by
 * the diff itself; the file an import points at is not in the diff, nothing
 * pins it, and reading it out of the local tree is exactly #17300's mistake
 * wearing a longer path.
 *
 * ⛔ BOUNDARY TWO — a body this reader cannot classify stays unrecognised: a
 * return it cannot find at the body's own top level, or one that is a template
 * string, an arrow, a number. None of them is read as a schema, and ⛔ none is
 * guessed at.
 *
 * ⭐ Both boundaries are a STATED silence rather than the invisible one the
 * card measured: every unresolved key line is reported with its file:line, the
 * factory's name and the reason it could not be read. An unread line is now a
 * line this reader NAMES.
 *
 * ⛔ The `no` criterion does not loosen, and the direction is provable rather
 * than argued. The resolver only ever ADDS a recognition — the shared-helper
 * list is consulted FIRST and unchanged — and it is consulted ONLY on the ADDED
 * side, so a removed key line declared through a local factory buys nothing and
 * no line that fires today can stop firing because a removal newly pays for it.
 * ⚠️ The price of that asymmetry, stated: a block that REPLACES one
 * local-factory key with another fires on the added one. That is a false
 * positive, which is the cost #16448 accepted, and it is the loud direction.
 * ⭐ The OVERTURN CONDITION, written down so it needs no second discussion:
 * the first LANDED diff whose only tell is such a replacement moves the reading
 * to the removed side under #16943's arithmetic — a ruling about that
 * arithmetic, never a repair of an accidental variable.
 *
 * ⚠️ CENSUS — report-only, the eight factories the card names, at objectstack
 * 30bac2880 (a count plus the tree it was taken against; key POSITIONS on
 * `packages/spec/src/**`):
 *
 *   `placeholderFree(`            23 key lines,  0 file-local — WRITABLE
 *                                 (`return schema.superRefine(…)`: it returns
 *                                 the schema it was handed) ⇒ a
 *                                 `SCHEMA_PROPERTY_FORMS` ROW, not a resolver
 *                                 case: it is imported at every one of the 23
 *   `strictIdent(`                12 key lines, 12 file-local — WRITABLE
 *                                 (`z.string().regex(SNAKE_CASE)…`)
 *   `ruleArrayFilterError(`       11 key lines,  0 file-local — NOT A SCHEMA
 *                                 (`return (issue) => {…}`, a `$ZodErrorMap`)
 *   `INLINE_CREDENTIAL_REFUSED(`  10 key lines,  0 file-local — NOT A SCHEMA
 *                                 (a template string)
 *   `objectBlockHistory(`          9 key lines,  9 file-local — NOT A SCHEMA
 *                                 (a template string)
 *   `emptyProps(`                  9 key lines,  9 file-local — WRITABLE
 *                                 (`strictObject(…)`, itself a declared form)
 *   `strictIdentOrNull(`           8 key lines,  8 file-local — WRITABLE
 *                                 (`z.string().regex(SNAKE_CASE).nullable()…`)
 *   `belongsInConfig(`             8 key lines,  8 file-local — NOT A SCHEMA
 *                                 (a template string)
 *
 * ⚠️ …and the sibling board, where the SAME census answers the heuristic
 * question outright. At objectui 15f01223d, file-local to
 * `packages/types/src/zod/complex.zod.ts`: `chatbotRequestBodyArm(` (2 key
 * lines) returns `z.record(…)` ⇒ WRITABLE, `chatbotEnableMarkdownArm(` (2) and
 * `chatbotEnableFileUploadArm(` (2) return `z.boolean()` ⇒ WRITABLE, while
 * `chatbotOnClearArm(` (2) returns `handlerKeyRefusal(…)` ⇒ REFUSING and
 * `retiredDeclarativeKanbanKey(` (1) returns `retirementTombstone(…)` ⇒
 * REFUSING. ⭐ FOUR `*Arm(` factories in ONE file, in OPPOSITE registers, and
 * nothing in the name says which — that is the measurement that retires the
 * name-shaped heuristic rather than merely declining it on principle.
 *
 * ⚠️ AND THE CARD'S OWN PROBE WAS NEVER FILE-LOCAL — measured on the tip, not
 * argued from the filing. `placeholderFree` is declared in
 * `packages/spec/src/data/driver/common.zod.ts` and IMPORTED at all 23 of its
 * key positions, `memory.zod.ts:9` included, so no reading of ONE file could
 * ever have reached the card's probe line and the resolver below is not what
 * carries it. ⇒ TWO instruments, because the population is two populations:
 * the class the card's TITLE names is closed by the resolver over the 29
 * file-local key lines that carry a schema, and the card's probe LINE is closed
 * by a `SCHEMA_PROPERTY_FORMS` ROW — #18560's instrument, used for what it is
 * for, with its own counterfactual fixture carrying the filing probe verbatim.
 *
 * ⛔ And the row stops there. The other three factories the card names that are
 * likewise IMPORTED — `ruleArrayFilterError(`, `INLINE_CREDENTIAL_REFUSED(` —
 * and the two file-local ones that are not schemas — `objectBlockHistory(`,
 * `belongsInConfig(` — return PROSE or a `$ZodErrorMap`, so rows for them would
 * mint 38 false T1 positives. ⭐ Which instrument a factory belongs to is a
 * fact about where it is DECLARED; whether it belongs to EITHER is a fact about
 * what it RETURNS. Two questions, measured separately, ⛔ never one heuristic.
 *
 * ## The eleventh accidental variable #18721 removed — a hunk's LEADING
 * CONTEXT
 *
 * #17618 taught T1 that a typed PARAMETER is not a key on a shape, and this
 * file's header names PR #17616's `+  ctx: z.RefinementCtx,` — the SECOND
 * PARAMETER of an exported object-level refinement, this repo's own prescribed
 * `#16489` signature — as the measured case that decline was written for. The
 * decline was real and it was pinned. It still never fired on a real diff.
 *
 * ⭐ The variable is WHERE THE HUNK STARTS. `enclosingDelimiter` walks from the
 * first line of the line's own hunk, and it abandoned the walk — answering
 * `null`, which every caller reads as "keep the tell firing" — the first time a
 * closer arrived with an empty stack. A real hunk opens on CONTEXT lines, and
 * on this repo's spec files that context is the tail of the previous
 * declaration: `  });`. Two closers, no opener above them, and the reading was
 * over before the hunk reached the `export function …(` head it went on to show
 * 108 lines later. The three-line synthetic the pin drives
 * (`+export const refine = (\n+  ctx: z.RefinementCtx,\n+) => ctx;`) has no
 * context line at all, so the pin stayed green through every diff it was
 * written to protect.
 *
 * ⭐ RE-DERIVED here rather than inherited from the card: `git diff
 * 72dd95fa5a..09e16a5745 -- packages/spec/src/ui/dashboard.zod.ts` (PR #18720's
 * own hunk, 202 lines, ONE hunk) with `--declaration no` exited 4 on a T1 row
 * against the `ctx` parameter of
 * `packages/spec/src/ui/dashboard.zod.ts#checkDashboardWidgetMetricMeasureArity`
 * — new-file line 628 — and the same file's true-positive control,
 * `+  brandNewAuthorableKey: z.string().optional(),` added to
 * `#DashboardWidgetSchema` as a real `git diff`, fired on line 701 of the same
 * run of the same matcher. ⇒ a FALSE POSITIVE, ⛔ not a dead instrument. The
 * proving line is the hunk's own first line, `  });`, a CONTEXT line.
 *
 * ⛔ The repair is at that branch and nowhere else — ⛔ NOT a `z.RefinementCtx`
 * type-name exception, which one differently-named parameter type walks past.
 * An underflow DROPS the closer and the walk continues. The argument is a stack
 * one: everything the hunk opens is strictly INSIDE everything it did not show,
 * so the shown stack is a SUFFIX of the real one and its top — whenever it has
 * one — IS the innermost open delimiter, whatever sits below. An empty shown
 * stack still answers `null`, so the reading remains positive evidence only.
 *
 * ⭐ The direction is provable both ways, and BOTH are pinned. On the added
 * side the decline reaches diffs it never reached, which is the false positive
 * this round removes. On the REMOVED side — where #17618 reads the same decline
 * so a deleted parameter cannot buy an added key the right to go unreported —
 * it makes a phantom #16943 budget disappear: a block that removes a parameter
 * behind leading context and adds a genuine key now FIRES on that key, where it
 * was silent before. One repair, one false positive closed and one false
 * negative with it.
 *
 * ## The twelfth accidental variable #18629 removed — the budget's DIRECTION
 * BLINDNESS, on the one value whose direction a line can carry
 *
 * #16943's budget is stated in its own section as "replacement-vs-net-addition,
 * not spelling", and that arithmetic is deliberately DIRECTIONLESS: it confirms
 * that the same key was rewritten and ⛔ never asks whether the rewrite accepts
 * MORE or LESS. For nearly every key that is the right instrument — a line
 * cannot say what `FilterSchema` admits — and #18234's section is the reading
 * that supplied the one exception on the REMOVED side: a removed value that
 * accepted EVERYTHING proves the replacement is a subset by construction.
 *
 * ⭐ #18629 is that same fact read on the ADDED side, and the two are one
 * predicate seen from either end. `- filter: z.union([A, B]),` replaced by
 * `+ filter: z.unknown().optional(),` is a REAL widening — the accept set goes
 * from two shapes to the universe — and the budget paid for it silently: the
 * removed `filter:` line is T1-shaped, buys one T1 unit, and the added line is
 * no closed-set opener, so nothing even asked for evidence. Measured on this
 * tree before the repair, with both of the filing card's controls lit on the
 * same harness (a brand-new key and an enum widened in place both FIRE): the
 * inverse patch read exit 0.
 *
 * ⛔ This is NOT a change to the budget for every key, which is what the
 * filing card and #18234's section both said it would take. It is a third way
 * for a BLOCK to carry positive evidence about direction, in the same place the
 * other two are read and subject to the same default: absence of evidence
 * leaves the budget paying, exactly as absence of evidence leaves a tell firing
 * everywhere else in this file. Two facts, both on lines the block shows:
 *
 *   ① the ADDED line declares the key as a universal acceptor —
 *     {@link declaresUniversalAcceptorKey}, the SAME reading #18234 certifies a
 *     removed value with, so the two ends of the budget cannot disagree about
 *     what "accepts everything" means; and
 *   ② the same block removed the SAME key, on a line that carries NO universal
 *     acceptor call at all.
 *
 * Fact ② is the precision, and it is written as a mention rather than as
 * "⛔ not certified by ①" on purpose. A removed acceptor whose chain WRAPS onto
 * a second line is not certifiable — 33 of this tree's 132 acceptor key lines
 * do not terminate on their own line — so a negated ① would fire on a pure
 * REFORMAT of an already-universal key, a false positive on a diff that changes
 * no accept set at all. Reading the mention declines there instead.
 *
 * ⭐ And the widening still SPENDS its unit before it is reported, which is the
 * half that is easy to get wrong. Refusing to spend would hand the unit to the
 * next added line in the block, so a genuinely new key riding along with the
 * widening would go silent — this file's surplus rule inverted, buying one
 * report at the price of another. The spend is unchanged and the row is
 * reported on top of it: `- filter: z.union([A, B]),` `+ filter: z.unknown(),`
 * `+ other: z.string(),` reports BOTH lines, each with its own file:line.
 *
 * ⚠️ The quiet directions this buys, stated rather than left to be discovered,
 * and all three are the SAME default — no evidence, no report:
 *
 *   • a removed value that merely MENTIONS an acceptor is not read as narrower,
 *     so `z.array(z.unknown())` → `z.unknown()` and `z.unknown().refine(f)` →
 *     `z.unknown()` both decline. Both are real widenings; both would need a
 *     reading of what the removed value did with the acceptor it names, which is
 *     a shape reading this file does not have.
 *   • an added acceptor whose own chain wraps onto a second line is not
 *     certified by ① and declines, the mirror of #18234's residual and closed by
 *     the same overturn condition.
 *   • a key re-typed into an acceptor with NO removed line naming it is not this
 *     row at all, and what becomes of it is #16943's business, unchanged. A
 *     block that removed some OTHER key still PAYS for it — the one-for-one
 *     rename silence that section already states — and a block that removed
 *     nothing reports it as the ordinary new key it is. ⚠️ The first of those
 *     two is a real remaining silence on this very transition; it is #16943's
 *     direction blindness on a DIFFERENT key, which no line in the block can
 *     speak to, and ⛔ not something fact ② could be widened to reach without
 *     giving up the key match that makes it evidence at all. Both measured,
 *     both pinned below.
 *
 * ⭐ The OVERTURN CONDITION, written down so it needs no second discussion: the
 * first landed pair whose removed value mentions an acceptor inside a narrower
 * one closes the first bullet by reading the removed value's shape rather than
 * its text.
 *
 * ## #19099 — NOT a variable removed: a walk that says when it stopped reading
 *
 * ⛔ This section removes no accidental variable and moves no row, and that is
 * the claim — ⛔ not an improvement measured somewhere and asserted here. What
 * changed is that {@link enclosingDelimiters} now reports the one thing it
 * could not say before: whether the stack it hands back is a READING or a
 * GUESS.
 *
 * ⚠️ THE HORIZON COMES FIRST, because a shallow clone answers at exit 0 with no
 * warning and every corpus reading below is worthless without it. Git renders a
 * GRAFT BOUNDARY commit against the EMPTY TREE, so a shallow clone shows one
 * ordinary commit as the whole repository arriving at once — here 1,092 files
 * and 309,028 insertions under `packages/spec/src` for a commit the API reports
 * as 2 files, +41/-7. Every added line of that phantom is then judged as if it
 * were a diff. ⛔ So state the horizon and what was dropped, or do not report a
 * rate: read `.git/shallow` (or `historyHorizon()` in
 * `scripts/pm/git-history.mjs`, which AGENTS.md routes windowed history through
 * for exactly this reason) and EXCLUDE every boundary.
 *
 * ⚠️ AND THE READ PATH IS PART OF THE HORIZON, which cost this paragraph a
 * round of its own. A census must call {@link wideningTells} with
 * {@link headBlobSource} live — the path the gate itself takes. Reading each
 * file through {@link tellsInFile} alone drops {@link ledgerRowLicences}, so
 * every #17300 ledger row tells and T2 inflates; handing it a `readSource` that
 * answers `null` drops #18702's file-local factory resolution, so T1 deflates.
 * ⛔ Worse, BOTH failures are silent. `ROOT` here is derived from
 * `import.meta.url`, so a copy of this module imported from outside a git
 * worktree makes every `git cat-file` fail and every blob read answer `null`
 * with nothing raised. ⇒ a census asserts its own resolution before it counts —
 * probe one known blob, and refuse to report if it comes back empty.
 *
 * CORPUS, on that discipline — this clone IS shallow, with ONE boundary
 * (`ae8edd2c4f`, 2026-08-31), excluded: 436 non-merge commits touching
 * `packages/spec/src` are reachable, 435 after the exclusion, giving **1,149
 * file diffs** of non-test `.ts`, of which **1,133 head blobs resolved** and 22
 * definitions were reported unresolved by name. The version of this file at the
 * branch's merge base and the version in it were run row for row over all of
 * them through `wideningTells`: **484 rows against 484 rows, 0 differing
 * commits** (T2 125, T1 270, T4 89). ⇒ this change moves no tell anywhere on
 * the corpus. The two firing-only readers agree as well — `enclosingDelimiter`
 * and `inParameterList` over **84,924 side-lines**, **0 disagreements** each.
 * ⛔ Answer-identical, ⛔ not byte-identical: both bodies changed.
 *
 * The reading lexes no regex literal and pops type-blind. Both limits are free
 * while every caller only makes a tell FIRE — a guessed stack buys a false tell
 * (loud) and never a swallowed one. They stop being free for any caller that
 * DECLINES on the answer: `.regex(/^\{\{/)` pushes two openers the scan never
 * closes, the enclosing shape's own closers are eaten, and a genuinely new key
 * at the OUTER level reads as a member nested inside it — a widening, gone
 * quiet. #18488 had already named that blindness for `readToCloser`, which
 * carries a type check AND an `unreadable` flag; this walker had neither.
 *
 * ⛔ THE FLAG HAS NO SUPPRESSING READER TODAY, and that is stated rather than
 * left to be discovered. The reader that would have had one — a decline for a
 * member bounded inside a re-declared universal-acceptor bag — was dropped by
 * ruling D′ (below). What lands is the READING; the obligation on the next
 * author who declines anything on these frames is written at the definition.
 *
 * ⭐ Two cheap SOUND discriminations are taken, and both are the difference
 * between a flag that is informative and one that is noise:
 *
 *   • A `*\/` outside a block comment, on a walk that has opened none of its
 *     own, closed no leading one, and raised no flag, is not a guess: outside a
 *     string and outside a comment `*\/` is not valid TypeScript, so it says
 *     the hunk BEGAN INSIDE a comment whose opener sits above the hunk. The
 *     frames the comment text pushed are discarded and the walk restarts after
 *     it. Each of those three guards is pinned by its own case, because without
 *     them the reset throws away frames the hunk really showed — the quiet
 *     direction.
 *   • A LONE `/` is arithmetic. A regex literal cannot span lines, so a `/`
 *     with no second `/` left on its line cannot open one; it pushes and pops
 *     nothing and the stack is as correct as it was.
 *
 * ⚠️ THE RESIDUAL. This paragraph has been wrong four times, every time by
 * asserting a RATE, so it is written to be checkable rather than persuasive:
 * the population is the **270 T1 rows this gate REPORTS** on the corpus above
 * — one boundary commit excluded and the gate's own read path used, without
 * which the count moves in both directions at once and every trigger below
 * reads as common.
 *
 * ⭐ ONE trigger OCCURS, and it is the apostrophe. The walk is unreadable at
 * **2 of those 270 rows (0.7%)**, and both are an APOSTROPHE IN JSDOC PROSE in
 * a hunk that begins inside the comment — `automation/approval.zod.ts`
 * (`Entra's`) and `ai/solution-blueprint.zod.ts` (`object's`). Read as code an
 * apostrophe opens a string literal that never closes on its line, so the walk
 * is unreadable at that byte BEFORE the terminator line the reset above would
 * have used is ever reached. ⛔ Widening the reset does not close it — the flag
 * is already up — and closing it needs a lexer that knows prose from code,
 * which is the guess this reader does not make.
 *
 * ⛔ THE OTHER THREE TRIGGERS OCCUR ZERO TIMES in this window, and they are
 * still triggers: a reader that meets one must refuse, and a reader written
 * against this paragraph must know they exist. They are triggers BY
 * CONSTRUCTION, ⛔ not by observation — each is pinned by its own `--self-test`
 * case rather than by a corpus row:
 *
 *   • a `/` with another `/` left on its line, which MAY open a regex literal —
 *     **0 rows**. ⚠️ ⛔ Do not read that zero as "regex literals are rare here":
 *     they are common, and the flag is deliberately conservative about them.
 *     It says only that none sat on a line this walk CROSSED before a reported
 *     T1 row in this window — and the lines it crosses are every kind the hunk
 *     shows before that row, ⛔ not the leading context alone.
 *   • a closer whose type does not match the opener it popped — **0 rows**.
 *   • a `*\/` this walk cannot explain — **0 rows**.
 *
 * ⇒ Nothing is silenced by any of them today: no reader suppresses on the flag.
 * The number a future suppressing reader needs is the 0.7%, and it should be
 * re-measured on that day rather than quoted from here — on the gate's own read
 * path, with its blob resolution asserted first.
 *
 * ## The shape this gate keeps firing on, and what to do about it — ruling D′
 *
 * PR #19095 bounded two members, `pageSize` and `pageSizeOptions`, inside a
 * door that had carried `pagination: z.unknown().optional()` — every value,
 * under every key. `--declaration no` exited 4 on both, against a declaration
 * an at-tier reviewer had MEASURED correct: 0 newly accepted inputs of 53, and
 * no new export. Read as text the tell is right and the semantics are inverted.
 *
 * ⛔ The gate is NOT repaired for it, and the reason is a ruling rather than a
 * shrug. Three rounds each tried a wider proxy for 「the two lines name the same
 * place」 and each proxy was not identity; the one that survived is sound only
 * INSIDE a hunk, and the class that leaks lives ACROSS hunks — an earlier hunk
 * of the same file moving the parent boundary, which silences every member of
 * the bag at once. A gate that refuses too much is noisy; one that refuses too
 * little is dangerous, and this gate is the compensating control for a
 * self-declared `Clause-②: no`. Diff-wide decidability is UNMEASURED, and a
 * text matcher does not grow cross-hunk assembly: the class belongs to a parsed
 * schema comparison, the way `oasdiff` judges breaking changes on the parsed
 * document rather than on text.
 *
 * ⇒ THE DISPOSITION, and it is carried in {@link REFUSAL_SENTENCE} so a refused
 * author reads it without opening this file: for a member bounded inside a bag
 * that was a universal acceptor, **declare `Clause-②: yes` and route it to
 * at-tier review**. The gate cannot verify a narrowing per line without
 * subtyping (#18640), and collapsing the bag refuses authored keys that parsed
 * before — which is exactly what at-tier review exists to see. ⛔ This moves no
 * criterion line: the `no (narrowing)` declarations on `main` stay valid for
 * every shape the gate CAN read, and only this one is named.
 *
 * ## The remedy with no reader — #17848, and a pin the shape never had
 *
 * #17848 filed two halves against this family. Re-measuring both on the tree
 * that answers today is the whole of what this round changed.
 *
 * ⭐ HALF ONE DID NOT REPRODUCE. The card measured three parked PRs and read
 * nine T1 tells on keys that had existed for releases — a key re-declared
 * because the diff hung a zod `{ error: … }` param on it (#17846, seven doors),
 * or rewrote its `.describe()` (#17796), or moved beside a retirement (#17638).
 * Re-run against all three PR diffs, this matcher reports NO tell on any of
 * them — and neither does it AS IT STOOD AT THE CARD'S OWN FILING COMMIT
 * (`758ac409`, seventeen minutes before the card was written). The repair had
 * landed three days EARLIER, in #16943's replacement budget above: a key
 * re-declared in place removes a T1 line and adds one, and the removal pays.
 *
 * ⛔ So no matcher change was made for half one, and the reason is not that the
 * change would have been small. The shapes the card floated — pairing across a
 * HUNK, or diffing the file's key SET instead of the block's lines — are the
 * silence `changeBlocks`'s own docblock refuses, and buying them would have
 * traded a loud failure for a quiet one to repair a defect that was not there.
 *
 * What half one did leave is a gap in the INSTRUMENT rather than in the reader:
 * the `{ error: … }` shape had no case of its own, and it is arithmetically
 * distinct from the `.describe()` pair #16943 pinned — one removed line against
 * THREE added, of which exactly one is a key. A budget counting LINES instead
 * of KINDS comes up short precisely there. Its battery is below, carrying the
 * dark control that shows the silence is bought by the removal and never by the
 * shape, and the surplus control that shows a real new key riding along still
 * fires.
 *
 * ⭐ HALF TWO REPRODUCED EXACTLY, and it is what this round repairs. The
 * refusal sentence offered two doors and only one was real: "explain in the
 * claim why this addition does not widen" has NO READER — `c5WideningTell()`
 * compares the declaration against the diff's tells and stops there. The
 * sections above had recorded that twice, at #16822 and again at #16943,
 * without ever changing the string a refused author actually reads; so this
 * file knew, and the author could not. ⇒ the only door that moved the exit code
 * was `Clause-②: no` → `yes`, which on a FALSE tell is the one thing the
 * standing rule forbids outright: 「⛔ 永不把 `no` 翻成 `yes` 去过门」.
 *
 * A declared-but-unenforced remedy is a shape this repo removes rather than
 * documents, so the sentence now names the two doors that work — re-declare
 * when the diff really widens, and repair the MATCHER when the tell is false —
 * and states the explanation's uselessness outright, so nobody spends a round
 * rediscovering it. ⛔ Giving the explanation a READER was refused rather than
 * overlooked: an author-written sentence that clears the author's own gate is
 * 自查放行, and it would need exactly the new claim-line syntax #16448 forbids.
 *
 * ⛔ No exit code moves for either half. The register below is unchanged, every
 * tell fires where it fired, and `--self-test` GREW cases in both directions
 * rather than losing any.
 *
 * ## Where the surfaces come from — imported, never hand-copied
 *
 * The contract SOURCE surface is `SUSPECT_TIER_GLOBS`, imported from
 * `dispatch-gates.mjs`. It is declared once there and a second spelling here
 * would be the hand-copied register `check:pm-governed-prose` exists to stop
 * one family over — and the two would then disagree about the same path on the
 * day one of them moved.
 *
 * The PUBLISHED surface is derived from `REGEN_ARTIFACTS` in
 * `scripts/regen-artifacts.mjs` — the rows whose `check` is
 * `check:api-surface`. Same reason: that table already owns the answer to
 * "which committed files ARE the published export listing", it is guarded by
 * its own gate, and a shard added there (#5837 sharded this surface once
 * already) reaches this gate without an edit.
 *
 * `REGISTRATION_SURFACES` below is the ONE table this file declares itself,
 * because no register in the tree carries it: "which files are closed-vocabulary
 * registries" is not a question `regen-artifacts` or the tier globs answer. It
 * is kept from rotting the same way `MANDATORY_TIER_GLOBS` is — every row must
 * name a path that EXISTS in this tree, asserted in `--self-test`, which CI
 * runs. A renamed registry leaves dead data that guards nothing while reading
 * as protection, and that is the incident class itself.
 *
 * ⚠️ Measured 2026-09-07, and recorded because the card names it: the
 * "renderer registry" of #16448's tell list has NO implementation in this repo
 * — `RendererRegistry` appears only in ADR-0012's notification-platform table.
 * The nearest live shape is `METADATA_FORM_REGISTRY`
 * (`packages/spec/src/system/metadata-form-registry.ts`), whose own docblock
 * calls it the "canonical registry of FormView layouts" consumed by "the
 * generic SchemaForm renderer", so that is the row declared. ⛔ A row for a
 * path that does not exist was NOT written: a declared-but-absent glob is the
 * dead data the existence guard exists against.
 *
 * ## The objectui mirror, and why its row is repo-keyed
 *
 * #16448 scopes T1/T2 to `packages/spec/src/**` "(or the objectui mirror
 * equivalents when run there)". objectui's mirror is `packages/types/src/zod/**`
 * (measured 2026-09-07: `app.zod.ts`, `blocks.zod.ts`, `form.zod.ts`,
 * `navigation.zod.ts`, `theme.zod.ts` all live there). This script ships only
 * in THIS repo's `scripts/pm/`, so that glob would be dead data here — hence
 * the `repo` key: a surface row applies to the repo it names, the existence
 * guard only runs over rows applicable to the local tree, and porting the gate
 * is a data edit rather than a rewrite. ⛔ The mirror row is not a claim that
 * anything runs this gate in objectui today; nothing does.
 *
 * ⚠️ That disclaimer was read, until #17217, as covering a second thing it does
 * not cover: a seat in THIS repo running THIS CLI against an objectui diff,
 * which is the only way an objectui seat can run it at all. That run judged the
 * diff as objectstack's and said so nowhere. The row is still inert for a run
 * whose board is this repo — nothing about the scoping moved — but the board is
 * now a resolved input the verdict states, so an objectui diff is judgeable and
 * a run that could not judge one says which repo could.
 *
 * ## What the verdict SAYS it looked at — #17112 and #17217, one output line
 *
 * The two cards above are one defect wearing two faces, and both faces live on
 * the sentence this file prints when it finds nothing. It used to read:
 *
 *     ✓ check-widening-tells: N changed file(s) READ, no widening tell on any
 *       declared surface. ⚠️ A tell is not a proof …
 *
 * Every clause of that was TRUE and the sentence as a whole was not, because a
 * COUNT beside a QUALIFIED negative reads as coverage in a way the qualifier
 * does not undo. The declared surfaces are seven rows, six of them inside
 * `packages/spec/**`; a published symbol in `packages/services/**`,
 * `packages/plugins/**`, `packages/drivers/**` or the rest of
 * `packages/runtime/**` is invisible here BY CONSTRUCTION, and that silence is
 * byte-identical to a clean look. #17112's filing seat had already been misled
 * by it once, in a live citation on another card, which is why the card exists.
 *
 * ⛔ Not repaired by widening any surface, and ⛔ not by deleting the count. The
 * scoping is #16448's and the false negatives it buys are #16349's accepted
 * cost — both stand, untouched, and the ⚠️ caveat is still printed. What
 * changes is that the count is SPLIT: `judged` is the only number exit 0 is
 * evidence about, and every other changed file is NAMED under the reason it
 * could not be examined. This file's own exit register already said as much in
 * words — "an unread diff is NOT a clean diff", with a dedicated exit for it —
 * so this is the register's own principle applied to the one population that
 * escaped it.
 *
 * #17217 is the second face and it is why the two could not land apart. The
 * objectui mirror row is repo-keyed, every judging function threads `repo`, and
 * `main()` passed none — so through the documented CLI the row was permanently
 * inert and an objectui diff could only ever come back clean, INCLUDING one
 * that really adds a key to `packages/types/src/zod/**`. Fixing only the count
 * would have printed such a file under "no declared surface covers it", which
 * is FALSE: a row covers it and the run merely could not say so. The census
 * therefore keeps "no row covers this" and "a row covers this, for a repo this
 * run is not" apart, and names the repo that could judge it.
 *
 * The board itself is resolved by `resolveSweepRepo`, IMPORTED from
 * `check-half-states.mjs` — `PM_SWEEP_REPO`, else `GITHUB_REPOSITORY`, else
 * this repo. ⛔ Not a `--repo` flag: `check-clause2-carriers` deliberately
 * refuses a positional board and points at the same variable, and two entry
 * points in one directory disagreeing about how a run is told its repo would be
 * its own trap. `--repo` is REFUSED with the variable named, so a seat that
 * reaches for it is answered instead of ignored. The default is unchanged
 * (`THIS_REPO`), so no existing caller changes meaning, and every exported
 * function still defaults the same way — `check-clause2-carriers` passes its
 * own `repo` and is untouched.
 *
 * ⛔ No verdict and no exit code moves for either card. Whether a diff nothing
 * examinable covers should REFUSE rather than pass is a new refusal class on
 * the enqueue path — #16349's chain to rule on, and both filings put it outside
 * themselves. This makes the instrument's self-description honest; it does not
 * make the instrument stricter.
 *
 * ## Exit codes — one register, shared with the sibling
 *
 *   0  no tell, or the declaration is not `no` (a `yes` is never blocked here,
 *      and an UNREADABLE declaration is `check-clause2-carriers`'s C2 row, not
 *      this file's verdict to issue).
 *   1  bad usage — the input could not be formed, so nothing was judged.
 *   2  INCOMPLETE — a file on a tell surface arrived with no patch to read
 *      (binary, truncated by the API, or a document that omitted it). An
 *      unread diff is NOT a clean diff (#4690), and this is the one exit that
 *      must never be mistaken for 0.
 *   4  REFUSED — a widening tell with `Clause-②: no`.
 *
 * The values are pinned equal to `check-clause2-carriers`'s in THAT file's
 * self-test (it imports this one, so the pin is written on the importing side
 * and no cycle is created): a seat reading `$?` reads one table, not two.
 *
 * ## The caller
 *
 * `check-clause2-carriers.mjs --pair N` — the enqueue-path predicate a seat
 * runs before it may hand a pair to the queue (`references/contract-review.md`,
 * landing pre-check ②). That call pays ONE extra request, and only for a pair
 * whose declaration reads `no`; the report-only board SWEEP deliberately does
 * not pay it (a 29-PR sweep already costs about GitHub's whole documented
 * anonymous hourly budget, and a board fact is not a fact about whichever PR
 * runs CI next).
 *
 * The `check:pm-widening-tells` step in `lint.yml` runs the SELF-TEST only, for
 * the reason its two neighbours record: this gate's verdict is about ONE pair's
 * diff, and failing an unrelated PR's CI over it would punish the wrong actor.
 */

// ⛔ NO `dispatch-gates: no-path-population` MARKER HERE — deliberately, and the
// reasoning is worth the paragraph because the marker LOOKS right.
//
// This gate's CI command is its own `--self-test`, which is the second of the
// three causes that marker's docblock lists ("the derivation NEED NOT place it").
// On that reading the declaration is true: no card's file surface should
// schedule this command, because running it says nothing about that card's diff.
//
// But the marker is refused by `dispatch-gates`'s live guard the moment a family
// NAMES paths, and this one names 59 of them (measured on this tree): 9 from its
// own module body — the registry table, the objectui mirror glob, the two repo
// slugs and four fixture filenames — and 50 inherited from the two registers it
// imports ON PURPOSE, `SUSPECT_TIER_GLOBS` and `REGEN_ARTIFACTS`. That guard's
// own text gives the fork: "If the literals are the real population, delete the
// marker and let the matched column do its job; if they are artifacts rather
// than a population, the marker stands and the literals do not belong in a
// scanned position."
//
// Both halves of getting them out of scanned positions cost more than they buy:
// the 9 would have to become segment predicates instead of paths, and the 50
// would have to become a HAND COPY of two registers this file imports precisely
// so it can never disagree with them — which is the drift
// `check:pm-governed-prose` exists to stop one family over, and the single
// strongest property this gate has. So the marker goes and the derivation
// stands.
//
// What the derivation now says, and why it is not wrong: a card touching any of
// those 59 paths gets `pnpm check:pm-widening-tells` in its MATCHED column. For
// `packages/spec/src/**`, `packages/spec/api-surface/**` and the three
// registries that is exactly right — they are the surfaces this gate polices,
// and a dev editing one is the dev whose claim it will judge. For the tail
// inherited from `REGEN_ARTIFACTS` (`*/test-typecheck-debt.json`,
// `content/docs/references/**`, and the rest) it is noise, and the cost of that
// noise is bounded and small: the command is an offline self-test that runs in
// about a second and whose green means "the tells still work". An
// over-matched gate pastes one cheap command into a prompt; the alternative was
// a marker sitting above a live population, which is the rot direction
// `dispatch-gates` measured and refused. ⛔ Do not re-add the marker without
// first removing the imports — a green local run is not evidence, because the
// case that catches this sits at ~1534 of the self-test's assertions and needs
// well over 540s to reach (#16448 patch round 2).

import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import { SUSPECT_TIER_GLOBS, hintCovers } from './dispatch-gates.mjs';
import { REGEN_ARTIFACTS } from '../regen-artifacts.mjs';
import { DEFAULT_SWEEP_REPO, SWEEP_REPO_SHAPE, resolveSweepRepo } from './check-half-states.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// -- The self-test's own battery roster and floor ---------------------------
//
// Same instrument the sibling carries, for the same reason: `failed.length === 0`
// alone cannot tell "every case held" from "the cases never ran". Every section
// opens with `battery('<name>')`, every assertion is attributed to the battery
// most recently opened, and the floor requires the OPENED set to equal the
// DECLARED set with each battery at or above its own count.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running.
const SELF_TEST_BATTERIES = Object.freeze({
  'the patch reader: added lines, and the line numbers they carry': 17,
  'the unified-diff splitter, for the local `git diff` path': 15,
  'the local path composed: an unread diff is not a narrow diff': 7,
  'the surfaces, imported rather than restated': 11,
  'T1 — a new key on a Zod object schema': 14,
  'T2 — a new member of a closed set': 13,
  '#16822 — the two accidental variables, and the evidence each one needs': 15,
  '#16943 — the net member/key delta: a replaced line is not a net addition': 23,
  '#17618 — a PARAMETER is not a key, and a closed set RE-SPELLED around fewer values is not a new one': 24,
  '#17300 — the retirement ledger is a record of REMOVALS, not a set that gained a value': 27,
  '#17955 — a `retiredKey()` tombstone declares a key UNWRITABLE, and never adds a spelling': 37,
  '#17848 — a key RE-DECLARED with a zod `error` param is not a key ADDED': 8,
  '#18234 — a key narrowed OUT of a universal acceptor is not a set that gained a value': 33,
  '#18629 — a key re-typed INTO a universal acceptor is a real widening the budget must not pay for': 27,
  'T3 — a new row in a published entry point': 8,
  'T4 — a new registration in a registry': 10,
  '#16448 acceptance: the four positive controls, each with its file:line': 8,
  '#16448 acceptance: the negative controls a widening gate must let through': 10,
  'the refusal sentence, and the two prohibitions it must keep': 13,
  'the exit register is distinct in every direction it must be': 6,
  'the declared registry rows still exist in this tree': 4,
  '#17112 — the count is split: examined is not examinable': 23,
  '#17217 — the CLI can be told which board it judges': 22,
  '#18560 — the declaring vocabulary is a NAMED list, every form pinned by a counterfactual fixture': 32,
  '#18640 — an inline closed set RE-SPELLED at the same binding is not a set that gained a value': 20,
  '#18702 — a declaring factory PRIVATE to one file, resolved through its own DEFINITION': 54,
  "#18721 — a hunk's LEADING CONTEXT is not a reason to abandon the parameter reading": 14,
  '#19099 — the enclosing-delimiter walk says when it STOPPED READING and started guessing': 15,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 16;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_INCOMPLETE = 2;
/** A widening tell was found on a diff whose card declares `Clause-②: no`. */
export const EXIT_REFUSED = 4;

/**
 * The sentence a refused author reads — the two doors that MOVE THE EXIT CODE,
 * and the one that never did (#17848).
 *
 * ⚠️ It is no longer #16448's wording, and the change is measured rather than
 * editorial. That wording read "re-declare `yes` or explain in the claim why
 * this addition does not widen", and the header above has twice recorded that
 * its second branch has NO READER: `c5WideningTell()` compares the declaration
 * against the diff's tells and nothing else, so an author who followed the
 * instruction got the identical exit 4 with no way to learn that the remedy was
 * never implemented. What that left standing was the branch the standing rule
 * forbids outright — 「⛔ 永不把 `no` 翻成 `yes` 去过门」 — a widening written
 * into a governance ledger that did not happen and afterwards indistinguishable
 * from one that did. ⛔ A gate whose only working door is a lie teaches the lie.
 *
 * ⛔ The repair is NOT to give the explanation a reader. An author-written
 * sentence that clears the author's own gate is 自查放行, and it would need the
 * new claim-line syntax #16448 forbids. The repair is to name the door this
 * file has said was the right one since #16822: a DEMONSTRATED false positive
 * is repaired HERE, in the matcher, with a `--self-test` case pinning the
 * shape — and to say plainly that the claim is not where it gets repaired.
 *
 * ⭐ #19099 — and it now names ONE SHAPE that is a true refusal although the
 * diff only narrows, because the card this closes was filed against a gate that
 * refused the criterion-honest declaration WITHOUT SAYING WHY. Ruling D′ leaves
 * the gate firing on it and puts the disposition here, where a refused author
 * reads it: the matcher cannot verify a narrowing per line without subtyping
 * (#18640), so the remedy is the tier, not a repair. ⛔ It is the only shape
 * named, and naming it moves no criterion line — every other narrowing the gate
 * can read is still a narrowing.
 *
 * It stays a constant for #16448's reason: the author knows the ways out
 * without opening this file. A row renders it once; ⛔ never a second wording
 * per tell.
 */
export const REFUSAL_SENTENCE =
  'a widening tell with `Clause-②: no` — re-declare `yes` if the diff really widens; if the tell ' +
  'is FALSE, repair it here in the matcher (`scripts/pm/check-widening-tells.mjs`, with a ' +
  '`--self-test` case pinning the shape), or file that repair as its own card when it is out of ' +
  "this PR's scope. ⛔ ONE shape is a true refusal although it only narrows, and is ruled NOT " +
  'repairable here: a member bounded inside a bag that was a universal acceptor (`z.unknown()` / ' +
  '`z.any()`) — this matcher cannot verify a narrowing per line without subtyping, and collapsing ' +
  'the bag refuses authored keys that parsed before, which is what at-tier review exists to see, ' +
  'so declare `Clause-②: yes` and route it to at-tier review. ⛔ An explanation in the claim ' +
  'moves no exit code — nothing reads one';

// ---------------------------------------------------------------------------
// The surfaces
// ---------------------------------------------------------------------------

/**
 * This repo, as a surface row names it. Rows with no `repo` mean this one.
 *
 * Imported rather than retyped, for the reason the surfaces above are: the
 * board a run reads is resolved by `resolveSweepRepo`, whose own fallback is
 * this constant, and a second spelling here would let the default surface row
 * and the default board disagree about the same repo on the day one moved.
 * The value is byte-identical to the literal it replaced; `--self-test` pins
 * the equality so the import cannot quietly become a redirection.
 */
export const THIS_REPO = DEFAULT_SWEEP_REPO;

/**
 * The contract SOURCE surface — T1 and T2 live here.
 *
 * Built from `SUSPECT_TIER_GLOBS`, imported. That table's own docblock calls
 * `packages/spec/src/**` "the contract surface (error-code ledger, *.zod.ts
 * contract schemas) — the normal landing zone of a clause-② card", which is
 * exactly the population these two tells want, and it is declared THERE.
 *
 * The objectui mirror is repo-keyed; see the header for why it is declared but
 * inert in this tree.
 */
export const CONTRACT_SOURCE_SURFACES = Object.freeze([
  ...SUSPECT_TIER_GLOBS.map((g) => Object.freeze({ glob: g.glob, repo: THIS_REPO, why: g.why, imported: 'SUSPECT_TIER_GLOBS' })),
  Object.freeze({
    glob: 'packages/types/src/zod/**',
    repo: 'objectstack-ai/objectui',
    why: "objectui's mirror of the contract schemas (#16448: \"or the objectui mirror equivalents when run there\")",
    imported: null,
  }),
]);

/**
 * The PUBLISHED export surface — T3.
 *
 * Derived from the generated-artifact register, so a new shard reaches this
 * gate without an edit here. `check:api-surface` is the discriminator because
 * it is what the register itself uses to name this artifact family.
 */
export const PUBLISHED_SURFACES = Object.freeze(
  REGEN_ARTIFACTS.filter((row) => row.check === 'check:api-surface').map((row) =>
    Object.freeze({ glob: row.path, repo: THIS_REPO, why: `the ${row.check} artifact family`, imported: 'REGEN_ARTIFACTS' }),
  ),
);

/**
 * The REGISTRY surface — T4. The one table this file declares itself.
 *
 * Every row must name a path that EXISTS in this tree (asserted in
 * `--self-test`); see the header for why a row for #16448's "renderer registry"
 * was not written, and what was written in its place.
 */
export const REGISTRATION_SURFACES = Object.freeze([
  Object.freeze({
    glob: 'packages/spec/src/api/error-code-ledger.zod.ts',
    repo: THIS_REPO,
    why: 'ERROR_CODE_LEDGER — a registered code is one `ApiErrorSchema.code` accepts, so a row here widens the wire vocabulary (ADR-0112 D3)',
    imported: null,
  }),
  Object.freeze({
    glob: 'packages/runtime/src/dispatcher-error-vocabulary.ts',
    repo: THIS_REPO,
    why: "the dispatcher vocabulary's declaration half — the classification ledger check:dispatcher-error-vocabulary reconciles against the scan",
    imported: null,
  }),
  Object.freeze({
    glob: 'packages/spec/src/system/metadata-form-registry.ts',
    repo: THIS_REPO,
    why: 'METADATA_FORM_REGISTRY — the canonical FormView registry the generic SchemaForm renderer reads; the live shape nearest #16448\'s "renderer registry"',
    imported: null,
  }),
]);

/**
 * The ADR-0087 retirement ledger, and the two surfaces that MINT a licence for
 * one of its rows (#17300).
 *
 * ⛔ Not a surface any tell fires ON, and ⛔ not an exclusion: `table` is the
 * one file whose bare-string rows a licence can clear, and the other two rows
 * are where a licence has to come FROM. Declared here rather than inlined for
 * the reason `REGISTRATION_SURFACES` is — a renamed path must red in
 * `--self-test`, not go quiet — and every row is asserted to exist in this tree
 * by the same battery.
 */
export const LEDGER_INPUT_SURFACES = Object.freeze([
  Object.freeze({
    glob: 'packages/spec/src/migrations/registry.ts',
    role: 'table',
    repo: THIS_REPO,
    why: 'the ADR-0087 D3 chain: RETIRED_KEYS_BY_MAJOR / RETIRED_DEFS_BY_MAJOR and each step\'s conversionIds — rows written BECAUSE an accept set shrank',
  }),
  Object.freeze({
    glob: 'packages/spec/src/migrations/entries/**',
    role: 'entry',
    repo: THIS_REPO,
    why: "the generator's input (#7297), one file per entry — `export const entry = '<row>'` is the exact string gen:migration-registry emits into the table",
  }),
  Object.freeze({
    glob: 'packages/spec/src/conversions/registry.ts',
    role: 'conversion',
    repo: THIS_REPO,
    why: "the ADR-0087 D2 conversion table — `id: '<id>'` is the registration a step's hand-maintained conversionIds row REFERS to",
  }),
]);

/** The one row of {@link LEDGER_INPUT_SURFACES} playing `role`, for a run's repo. */
export function ledgerSurface(role, repo = THIS_REPO) {
  return LEDGER_INPUT_SURFACES.find((s) => s.role === role && s.repo === repo) ?? null;
}

/** Every declared surface, in one list, so a caller can render the whole set. */
export const ALL_SURFACES = Object.freeze([
  ...CONTRACT_SOURCE_SURFACES,
  ...PUBLISHED_SURFACES,
  ...REGISTRATION_SURFACES,
]);

/**
 * Do any of these surface rows cover `filename`, for a run against `repo`?
 *
 * A row whose `repo` is not the run's repo is INERT — not a miss to be
 * explained, simply not this repo's surface. `hintCovers` is the sibling
 * family's one path matcher (imported), so a glob gets segment-boundary
 * semantics rather than string-prefix ones for free.
 */
export function surfaceCovers(surfaces, filename, repo = THIS_REPO) {
  if (typeof filename !== 'string' || filename === '') return false;
  return surfaces.some((s) => (s.repo == null || s.repo === repo) && hintCovers(s.glob, filename));
}

/** A source file the tells read — ⛔ never a test, which declares no contract. */
export function isContractSourceFile(filename) {
  return /\.(?:ts|mts|cts)$/.test(filename) && !/\.(?:test|spec|pin\.test)\.[cm]?ts$/.test(filename);
}

/**
 * The three surface flags one file carries, for a run against `repo`.
 *
 * ⭐ ONE reader, because three callers need the same answer and a census that
 * disagrees with the matcher about which files were judged is the very defect
 * #17112 filed, one layer up. `tellsInFile` decides what to read with these
 * flags, `unreadFiles` decides what owes a patch with them, and
 * `fileCoverage` REPORTS them; before #17112 the expression was written out
 * three times and could have drifted between any two of them.
 */
export function surfaceFlags(filename, repo = THIS_REPO) {
  return {
    onContractSource: surfaceCovers(CONTRACT_SOURCE_SURFACES, filename, repo) && isContractSourceFile(filename),
    onPublished: surfaceCovers(PUBLISHED_SURFACES, filename, repo),
    onRegistry: surfaceCovers(REGISTRATION_SURFACES, filename, repo),
  };
}

/**
 * Every OTHER repo whose declared rows cover `filename` — the reading that
 * tells "no surface covers this" apart from "a surface covers this, and this
 * run is not the repo it names" (#17217).
 *
 * ⛔ This is not a widening of any tell: it moves no verdict and no exit code.
 * It exists so a run that structurally could not look at a path says which
 * repo could, instead of filing it under a sentence that is false about it.
 */
export function surfaceReposElsewhere(filename, repo = THIS_REPO) {
  const out = new Set();
  for (const s of ALL_SURFACES) {
    if (s.repo == null || s.repo === repo) continue;
    if (hintCovers(s.glob, filename)) out.add(s.repo);
  }
  return [...out].sort();
}

/**
 * Why one changed file was, or was not, examined for tells.
 *
 * The five states are exhaustive over a changed-file row and each names a
 * DIFFERENT fact, because the whole finding is that one sentence used to cover
 * all of them:
 *
 *   `judged`             read for tells — the only state exit 0 is evidence about.
 *   `deleted`            the file was removed; a deletion adds nothing, so this
 *                        is a measurement, not a gap.
 *   `not-contract-source` a declared glob covers it but the file kind declares
 *                        no contract (a test, a `.md`) — `isContractSourceFile`.
 *   `other-repo`         a declared row covers it, for a repo this run is not.
 *   `unmatched`          no declared row covers it at all — #17112's population.
 *
 * ⚠️ `not-contract-source` and `unmatched` are kept apart on purpose. Reporting
 * a `packages/spec/src/x.test.ts` as "no declared surface covers it" would be
 * false in exactly the way #17217 says the parent's remedy would be false about
 * the objectui mirror — a surface DOES cover it; the run declined it for its
 * kind.
 */
export function fileCoverage(file, { repo = THIS_REPO } = {}) {
  const filename = String(file?.filename ?? '');
  if (filename === '') return { filename, state: 'unmatched', repos: [] };
  if (file?.status === 'removed') return { filename, state: 'deleted', repos: [] };
  const flags = surfaceFlags(filename, repo);
  if (flags.onContractSource || flags.onPublished || flags.onRegistry) {
    return { filename, state: 'judged', repos: [] };
  }
  if (surfaceCovers(CONTRACT_SOURCE_SURFACES, filename, repo)) {
    return { filename, state: 'not-contract-source', repos: [] };
  }
  const elsewhere = surfaceReposElsewhere(filename, repo);
  if (elsewhere.length > 0) return { filename, state: 'other-repo', repos: elsewhere };
  return { filename, state: 'unmatched', repos: [] };
}

/** Every changed file's coverage, bucketed by state, in file order. */
export function coverageCensus(files, { repo = THIS_REPO } = {}) {
  const census = {
    total: 0,
    judged: [],
    deleted: [],
    'not-contract-source': [],
    'other-repo': [],
    unmatched: [],
  };
  for (const file of files ?? []) {
    const row = fileCoverage(file, { repo });
    census.total += 1;
    census[row.state].push(row);
  }
  return census;
}

/** The files this run could not examine — every state but `judged`/`deleted`. */
export function notMeasured(census) {
  return [...census['not-contract-source'], ...census['other-repo'], ...census.unmatched];
}

// ---------------------------------------------------------------------------
// Reading a patch
// ---------------------------------------------------------------------------

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Every line of one patch, tagged with the side it is on and the hunk it came
 * from — `addedLines` below is one projection of this reading.
 *
 * The three kinds are kept apart because two of #16822's readings need what an
 * added line's NEIGHBOURS say: `context` lines are the new file's other lines,
 * `removed` lines are what the same hunk replaced. ⛔ A removed line carries
 * `line: null` — it has no position in the new file, and the one thing this
 * reader must never do is invent one. `hunk` is carried so no caller can read
 * adjacency ACROSS a hunk boundary, where the file's real lines are missing.
 *
 * The line number is the whole reason this is not a `split('\n').filter()`: the
 * card requires a file:line on every refusal, and a refusal an author cannot
 * navigate to is a refusal they will argue with rather than fix.
 *
 * ⛔ Removed lines advance nothing and context lines advance by one — getting
 * that backwards produces plausible numbers that point at the wrong line, which
 * is worse than no number at all. Both directions are pinned in `--self-test`.
 *
 * @param {string|null|undefined} patch — a unified diff body, hunk headers
 *   included. GitHub's `/pulls/N/files` `patch` field is exactly this shape.
 * @returns {{ line: number, text: string }[]}
 */
export function patchLines(patch) {
  const out = [];
  if (typeof patch !== 'string' || patch === '') return out;
  let lineNo = 0;
  let hunk = -1;
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      lineNo = Number(header[1]);
      inHunk = true;
      hunk += 1;
      continue;
    }
    // The file headers of a full `git diff` — `+++` must be tested BEFORE the
    // `+` branch below, or every patch reports a phantom addition at line 1.
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('diff --git')) continue;
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    if (!inHunk) continue;
    if (raw.startsWith('+')) {
      out.push({ line: lineNo, text: raw.slice(1), kind: 'added', hunk });
      lineNo += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      // Removed: consumes no new-file line, so it carries NO number. ⛔ Not 0
      // and not the next line's — a removal has no position in the file the
      // author will open, and inventing one is the off-by-one this reader's
      // whole battery exists against.
      out.push({ line: null, text: raw.slice(1), kind: 'removed', hunk });
      continue;
    }
    out.push({ line: lineNo, text: raw.startsWith(' ') ? raw.slice(1) : raw, kind: 'context', hunk });
    lineNo += 1; // context (a leading space, and the empty trailing line)
  }
  return out;
}

/**
 * The ADDED lines of one patch — the projection of `patchLines` this file's
 * four tells are written against, and the shape every caller already reads.
 */
export function addedLines(patch) {
  return patchLines(patch)
    .filter((r) => r.kind === 'added')
    .map((r) => ({ line: r.line, text: r.text }));
}

const DIFF_GIT = /^diff --git a\/(.+?) b\/(.+)$/;

/**
 * How `git diff` says "there is no text hunk because the content is BINARY".
 *
 * Both spellings, because both reach this reader: the default one-line
 * `Binary files a/x and b/x differ`, and the `GIT binary patch` block a
 * `--binary` diff emits instead. A file with neither marker AND no hunk is a
 * mode-only change or a pure rename — those really do add nothing, and telling
 * them apart from a binary is the whole point of reading the marker rather than
 * inferring from the missing hunk.
 */
const BINARY_MARKER = /^(?:Binary files .* differ|GIT binary patch)$/m;

/**
 * Split a whole `git diff` into the per-file rows this gate judges.
 *
 * This is the LOCAL read path — `git diff <merge-base>...HEAD` — and it exists
 * so a seat with no API budget can run the same predicate on the same bytes.
 * The row shape is GitHub's (`filename`, `status`, `patch`) so nothing
 * downstream can tell the two paths apart, which is what stops them drifting.
 *
 * A file with a `diff --git` header and no hunk yields `patch: null`. Whether
 * that is UNREAD or genuinely EMPTY is read off the diff itself, never guessed:
 * a `Binary files … differ` / `GIT binary patch` marker means git could not show
 * the content, so `additions` is `null` (UNKNOWN) and the caller reports a gap
 * on a tell surface; no marker and no hunk means a mode-only change or a pure
 * rename, which really did add nothing, so `additions` is `0` and the row is
 * clean. ⛔ This function never turns an unread file into a clean reading — and
 * the way it used to was by stamping `addedLines(null).length` on every row,
 * which wrote `0` for a binary change and let a binary edit to
 * `api-surface/*.json` pass as narrow.
 *
 * ## Why the two input paths differ here, and why that is not drift
 *
 * On the API path GitHub sends `additions: 0` for a binary row, and this file
 * KEEPS it: that zero is GitHub's own reading of its own object store, taken by
 * something that can see the blob. The local path has strictly less
 * information — `git diff` refused to show the content, and nothing downstream
 * can recover it — so it answers `null`. Same field, two producers, two
 * genuinely different states of knowledge; the asymmetry is *information
 * available*, not two readers drifting apart. `addedNothing` is where both are
 * interpreted, once.
 */
export function splitUnifiedDiff(text) {
  const rows = [];
  if (typeof text !== 'string' || text.trim() === '') return rows;
  let current = null;
  const flush = () => {
    if (!current) return;
    const body = current.body.join('\n');
    const hasHunk = HUNK_HEADER.test(body) || /\n@@ /.test(`\n${body}`);
    const patch = hasHunk ? body : null;
    // `additions` is carried so the local path answers "did this file add
    // anything" in the SAME field the API path answers it in — the gap
    // accounting below reads one field, not one per input path.
    //
    // ⛔ And it is a COUNT THAT WAS TAKEN, never a default. `addedLines(null)`
    // returns an empty array, so writing `addedLines(patch).length` for every
    // row would stamp `0` on a BINARY file — a number nobody counted — and the
    // gap accounting, which skips a row that added nothing, would then read a
    // binary change to a tell surface as CLEAN. That is the exact
    // declared-but-not-enforced shape this gate exists against, inside the gate
    // itself. So the three cases are told apart by what the diff SAYS:
    //
    //   a hunk           -> the count, taken from the hunk
    //   a binary marker  -> `null`, i.e. UNKNOWN — git did not show the content,
    //                       so this reader cannot say whether anything was added
    //   neither          -> `0`, a real reading: a mode-only change or a pure
    //                       rename adds no line, and git says so by emitting
    //                       no hunk AND no binary marker
    const additions = hasHunk ? addedLines(patch).length : BINARY_MARKER.test(body) ? null : 0;
    rows.push({ filename: current.filename, status: current.status, patch, additions });
    current = null;
  };
  for (const raw of text.split('\n')) {
    const head = DIFF_GIT.exec(raw);
    if (head) {
      flush();
      current = { filename: head[2], status: 'modified', body: [] };
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('new file mode')) current.status = 'added';
    else if (raw.startsWith('deleted file mode')) current.status = 'removed';
    else if (raw.startsWith('rename to ')) {
      current.status = 'renamed';
      current.filename = raw.slice('rename to '.length).trim();
    }
    current.body.push(raw);
  }
  flush();
  return rows;
}

// ---------------------------------------------------------------------------
// The four tells
// ---------------------------------------------------------------------------

/** A line that is prose inside the code — a tell never fires on a comment. */
const COMMENT_LINE = /^[ \t]*(?:\/\/|\/\*|\*|#)/;

/**
 * The KEY half of a property line, as regex SOURCE — the one spelling of "a
 * property name at the head of a line" that every vocabulary below is built
 * from, so two vocabularies can never disagree about a quoted or
 * optional-marked name.
 */
const KEY_HEAD_SOURCE =
  "^[ \\t]*(?:'[^']+'|\"[^\"]+\"|\\[[^\\]]+\\]|[A-Za-z_$][\\w$]*)[ \\t]*\\??[ \\t]*:[ \\t]*";

/**
 * The DECLARING FORMS — the vocabulary `SCHEMA_PROPERTY` is BUILT from, named
 * and enumerable rather than five alternatives inside one regex literal
 * (#18560).
 *
 * A form missing from here is not a line judged leniently, it is a line that is
 * not a KEY LINE at all: `memberTellKind` answers `null`, so the row neither
 * fires, nor spends the #16943 budget, nor earns it on the removed side — and
 * nothing anywhere says so.
 *
 * Two fields carry the two questions, and they are deliberately not one:
 *
 *   `pattern` — what the property's VALUE must open with for the line to be
 *   RECOGNISED as a key line. This is the whole of `SCHEMA_PROPERTY`.
 *
 *   `writable` — whether the key that form declares is one an author MAY write.
 *   A `false` here puts the form in `UNWRITABLE_FORMS` below, where the tell
 *   DECLINES on the positive, line-local evidence #17955 established. ⛔ It is
 *   not an exclusion from the vocabulary: the row stays recognised, both sides
 *   of the budget keep reading one question, and a live arm CHAINED onto the
 *   helper still fires.
 *
 * ⛔ Adding a form here is ADDITIVE by construction — an unrecognised line
 * reports nothing, so no row that fires today can stop firing when the list
 * grows. That is why "teach it the form" is the repair and "relax the tell" is
 * not; the `no` criterion is untouched by every row below.
 *
 * ⚠️ `measured` is a count PLUS the tree it was taken against, per this repo's
 * own rule, and it is a key-POSITION count: `lazySchema(` reads 0 here while
 * being live at DECLARATION positions (`export const X = lazySchema(…)`), which
 * is a reason to keep the row and not a reason to drop it — dropping a form is
 * the failure this list exists to make loud.
 *
 * ⚠️ The quiet direction the list does NOT close, measured on both boards so
 * the next reader meets it here: a FILE-LOCAL declaring factory. Both trees
 * mint them — `strictIdent(` (12 key lines), `emptyProps(` (9),
 * `strictIdentOrNull(` (8) at objectstack 30bac2880; `chatbotRequestBodyArm(`
 * (2), `retiredDeclarativeKanbanKey(` (1) at objectui 15f01223d — and a list of
 * shared, exported helpers cannot name a factory private to one file. #18702's
 * structural resolver is what reaches those, through the factory's own
 * definition; ⛔ this list is still not where they belong.
 *
 * ⚠️ `placeholderFree(` used to be named in that paragraph and is a ROW now,
 * because the classification was wrong rather than the population: it is
 * EXPORTED from `common.zod.ts` and imported at all 23 of its key positions, so
 * it was never file-local at any of them and no resolver reading one file could
 * have reached it. ⇒ Which register a factory belongs in is a fact about where
 * it is DECLARED, measured per key position — ⛔ never inferred from the file a
 * probe happened to be written on.
 */
export const SCHEMA_PROPERTY_FORMS = Object.freeze([
  Object.freeze({
    form: 'z.',
    pattern: 'z\\.',
    writable: true,
    where: "zod's own namespace, both boards",
    measured: '7,784 key lines at objectstack 6dfa3ea77 · 1,482 at objectui 15f01223d',
  }),
  Object.freeze({
    form: 'lazySchema(',
    pattern: 'lazySchema\\(',
    writable: true,
    where: '`packages/spec/src/shared/lazy-schema.ts` — a Proxy over a deferred `z.object`',
    measured: '0 key lines at objectstack 6dfa3ea77 (live at DECLARATION positions)',
  }),
  Object.freeze({
    form: 'strictObject(',
    pattern: 'strictObject\\(',
    writable: true,
    where: '`packages/spec/src/shared/strict-object.ts`',
    measured: '47 key lines at objectstack 6dfa3ea77',
  }),
  Object.freeze({
    form: 'placeholderFree(',
    pattern: 'placeholderFree\\(',
    writable: true,
    where: '`packages/spec/src/data/driver/common.zod.ts` — `return schema.superRefine(…)`, i.e. it hands back the schema it was GIVEN, so the key it declares is exactly as writable as that argument',
    measured: '23 key lines at objectstack 30bac2880, across six driver files — every one of them an IMPORT, which is why #18702\'s file-local resolver cannot reach them and this row is what does',
  }),
  // ⛔ …and NO row for the four factories #18702 measured beside it:
  // `ruleArrayFilterError(` (11 key lines), `INLINE_CREDENTIAL_REFUSED(` (10),
  // `objectBlockHistory(` (9) and `belongsInConfig(` (8) return PROSE or a
  // `$ZodErrorMap`, never a schema, so a row for any of them would mint 38
  // false T1 positives on key lines that declare no author-writable key at all.
  Object.freeze({
    form: '*Schema',
    pattern: '[A-Za-z_$][\\w$]*Schema\\b',
    writable: true,
    where: 'a schema binding referenced by name, both boards',
    measured: '995 key lines at objectstack 6dfa3ea77 · 56 at objectui 15f01223d',
  }),
  Object.freeze({
    form: 'stripImportedDefaults(',
    pattern: 'stripImportedDefaults\\(',
    writable: true,
    where: '`packages/types/src/zod/imported-defaults.ts` (objectui) — its docblock: "the same TypeScript type, the same keys, the same checks, the same registry metadata and the same accept set"',
    measured: '45 key lines at objectui 15f01223d',
  }),
  Object.freeze({
    form: 'retiredKey(',
    pattern: 'retiredKey\\(',
    writable: false,
    where: '`packages/spec/src/shared/retired-key.ts` — `z.never(…).optional()`',
    measured: '255 key lines at objectstack 6dfa3ea77',
  }),
  Object.freeze({
    form: 'retirementTombstone(',
    pattern: 'retirementTombstone\\(',
    writable: false,
    where: '`packages/types/src/zod/tombstone.zod.ts` (objectui) — `z.never({ error }).optional().describe()`, the same primitive as `retiredKey`',
    measured: '187 key lines at objectui 15f01223d',
  }),
  Object.freeze({
    form: 'handlerKeyRefusal(',
    pattern: 'handlerKeyRefusal\\(',
    writable: false,
    where: '`packages/types/src/zod/tombstone.zod.ts` (objectui) — `z.custom<never>(() => false)`, whose docblock reads "The predicate refuses EVERYTHING, a live function included"',
    measured: '90 key lines at objectui 15f01223d',
  }),
  Object.freeze({
    form: 'aliasKeyRefusal(',
    pattern: 'aliasKeyRefusal\\(',
    writable: false,
    where: '`packages/types/src/zod/tombstone.zod.ts` (objectui) — `z.never({ error })` naming the canonical spelling',
    measured: '13 key lines at objectui 15f01223d',
  }),
]);

/**
 * The forms whose value declares a key UNWRITABLE — recognised, then declined.
 *
 * ⛔ Every pattern here must END at the helper's open paren, because
 * {@link declaresUnwritableKey} reads the match's own length to find that paren
 * and hand it to `matchingCloser`. A form that ended anywhere else would make
 * the "is the value the call and NOTHING after it" reading answer about the
 * wrong character — silently, and in the direction that declines a live arm. So
 * it is refused at module load rather than pinned only in the self-test: a
 * malformed vocabulary must not be a gate that runs.
 */
function closingAtItsOwnParen(f) {
  if (f.pattern.endsWith('\\(')) return f;
  throw new Error(
    `check-widening-tells: unwritable declaring form "${f.form}" has a pattern that does not end at its open paren ` +
      `(${f.pattern}) — \`declaresUnwritableKey\` locates the call's paren by the match length, so this form would ` +
      `decline or fire on the wrong character. Give it a \`helper\\(\`-shaped pattern, or make it \`writable\`.`,
  );
}
const UNWRITABLE_FORMS = Object.freeze(
  SCHEMA_PROPERTY_FORMS.filter((f) => !f.writable).map(closingAtItsOwnParen),
);

/**
 * T1 — a property whose value is a SCHEMA.
 *
 * Calibrated against the real tree rather than guessed — the calibration now
 * lives per row in {@link SCHEMA_PROPERTY_FORMS}, which this regex is BUILT
 * from. Requiring a schema-shaped VALUE is what keeps the tell off the
 * 1,655 `x: true` / 1,170 `x: string` lines that are object literals and type
 * annotations, not accept-set members.
 *
 * ⛔ It does NOT verify the property sits inside a `z.object({` block. A hunk
 * is a fragment — block state cannot be recovered from one honestly — and a
 * reader that guessed would fail SILENTLY in the direction that matters. The
 * card's own boundary applies: a tell, not a proof.
 *
 * What DOES bound it is one bracket fact read in `tellsInFile` (#17618): a
 * shape body is `{`-delimited by construction, so a match whose innermost open
 * delimiter — over its own hunk — is a function's `(` is a typed PARAMETER and
 * declines. Absence of that evidence leaves the match firing, so the regex
 * above is still the whole tell wherever the hunk says nothing.
 */
const SCHEMA_PROPERTY = new RegExp(
  `${KEY_HEAD_SOURCE}(?:${SCHEMA_PROPERTY_FORMS.map((f) => f.pattern).join('|')})`,
);

/** T2 — a closed set DECLARED or re-written on one line. */
const CLOSED_SET_OPENER = /z\.(?:enum|union|discriminatedUnion|literal)\(/;

/** T2 — a bare string element of a multi-line `z.enum([…])` or `as const` array. */
const BARE_STRING_ELEMENT = /^[ \t]*(?:'[^']*'|"[^"]*")[ \t]*,?[ \t]*(?:\/\/.*)?$/;

/** T2 — a bare schema arm of a multi-line `z.union([…])`. */
const BARE_SCHEMA_ARM = /^[ \t]*[A-Za-z_$][\w$]*Schema[ \t]*,[ \t]*(?:\/\/.*)?$/;

/**
 * The two spellings of a string CONCATENATION continuing across lines (#16822).
 *
 * `CONTINUATION_HEAD` is the operator opening the NEXT line (`+ 'more prose'`),
 * `CONTINUATION_TAIL` the one left at the END of the previous line (`'prose ' +`).
 * Both are in the tree, so both are read; a bare-string line with either
 * neighbour is a FRAGMENT of one expression, never an element of a list.
 *
 * ⛔ `++` is excluded in both directions — an increment is not a concatenation,
 * and reading one as the other would decline a real member for no reason.
 */
const CONTINUATION_HEAD = /^[ \t]*\+(?!\+)[ \t]*(?:['"`]|[A-Za-z_$(])/;
const CONTINUATION_TAIL = /(?<!\+)\+[ \t]*$/;

/**
 * An opener whose list opens on a LATER line, with its BINDING PREFIX captured.
 *
 * `[^[\]]*` between the constructor and the bracket admits a discriminator
 * argument (`z.discriminatedUnion('type', [`) while refusing any line that
 * already carries members, and the anchored end refuses one that closes on the
 * same line (`z.enum(['a', 'b'])`). Group 1 is everything left of the
 * constructor — `export const AnyComponentSchema = ` — which is what makes two
 * openers the same DECLARATION rather than merely the same shape.
 */
const CLOSED_SET_OPENER_HEAD = /^(.*?)z\.(?:enum|union|discriminatedUnion|literal)\([^[\]]*\[[ \t]*(?:\/\/.*)?$/;

/** The binding an opener-only line declares, or `null` if it is not one. */
export function closedSetOpenerBinding(text) {
  const m = CLOSED_SET_OPENER_HEAD.exec(String(text ?? ''));
  return m ? m[1].trim() : null;
}

/**
 * Is this added line a FRAGMENT of a multi-line string concatenation?
 *
 * ⭐ Positive evidence only: a neighbour this hunk actually shows. `null` for a
 * neighbour means the hunk does not reach that line — a different hunk, or the
 * edge of this one — and an unseen neighbour is never read as evidence. The
 * tell keeps firing, which is the loud direction.
 */
export function isConcatenationFragment(prev, next) {
  if (typeof next === 'string' && CONTINUATION_HEAD.test(next)) return true;
  return typeof prev === 'string' && CONTINUATION_TAIL.test(prev);
}

/**
 * Does this added opener merely RE-DECLARE a closed set the same hunk removed?
 *
 * ⛔ Not a direction claim — see the header. An opener-only line declares no
 * member, so when the same hunk removes an opener binding the same name, the
 * set already existed and this line adds no value to it. The members decide,
 * and they are read separately, one line each.
 */
export function rewritesExistingOpener(text, removedTexts) {
  const binding = closedSetOpenerBinding(text);
  if (binding === null || !Array.isArray(removedTexts)) return false;
  return removedTexts.some((r) => closedSetOpenerBinding(r) === binding);
}

/**
 * The three bracket pairs a line-shaped reader has to keep apart, and the one
 * fact the two readings below are built on: a Zod object SHAPE body is
 * `{`-delimited by construction (`z.object({ … })`, `strictObject(…, { … })`),
 * so a `name: <schema>` line whose innermost open delimiter is a PAREN is not a
 * member of one — in TypeScript the only `name: T` form valid directly inside
 * parentheses is a typed parameter.
 */
const BRACKET_CLOSERS = { '(': ')', '[': ']', '{': '}' };

/** The index where the string literal opening at `start` closes, or -1 on this line. */
function endOfStringLiteral(s, start) {
  const quote = s[start];
  for (let k = start + 1; k < s.length; k += 1) {
    if (s[k] === '\\') { k += 1; continue; }
    if (s[k] === quote) return k;
  }
  return -1;
}

/**
 * How far a line-shaped read of the call got — and, the half an index cannot
 * carry, whether this reader was CERTAIN of what it passed on the way.
 *
 * ⭐ #18488 — `-1` is two different facts wearing one number, and a caller that
 * cannot tell them apart is wrong in one direction or the other. "The call is
 * genuinely still open at the end of the line" is what a multi-line
 * declaration looks like, and 178 of this tree's tombstone key lines are
 * exactly that. "This reader could not read the rest of the line" is not a
 * claim about the source at all. The decline in `declaresUnwritableKey` rests
 * on the FIRST reading — every remaining byte is inside the argument list — so
 * it needs the second one separated out rather than folded in.
 *
 * The question this answers is therefore not "which `return` did the scan
 * take" but **is it CERTAIN the call does not close on this line**:
 *
 * - CERTAIN, `unreadable: false` — the scan fell off the end with a non-empty
 *   stack; a `//` took the rest of the line; a delimited comment or a TEMPLATE
 *   literal opened and ran past the end of the line. The last two legitimately
 *   span lines, so everything left is inside a comment or inside one argument
 *   either way.
 * - NOT certain, `unreadable: true` — a `'`/`"` string opened and never closed
 *   (neither spans lines in TypeScript, so the source is malformed or this
 *   reader mis-lexed the opener); a closer matched nothing on the stack (the
 *   stack is already wrong); or a `/` opened neither comment form, which in
 *   TypeScript is a division operator or a REGEX LITERAL this reader does not
 *   lex — from there on the stack it built is a guess.
 *
 * ⭐ The regex-literal case does NOT abort the scan, and that asymmetry is the
 * design rather than an oversight: aborting would move the INDEX this function
 * answers, and the index has four callers with nothing to do with tombstones.
 * The `/` only records that the stack is no longer trustworthy, so `close` is
 * byte-for-byte what it was before this reading existed.
 *
 * ⭐ It is string-aware for free, because the flag is raised INSIDE the scan
 * that already skips string literals and comments. A prescription quoting a
 * path or a spelling carries slashes and backticks between quotes and raises
 * nothing — measured: 49 tombstone-shaped rows in this tree's history carry a
 * quote and 4 carry a backtick inside a quoted prescription, and a line-level
 * `includes` of either character would have fired on every one of them.
 *
 * @param {string} s @param {number} open
 * @returns {{ close: number, unreadable: boolean }}
 */
function readToCloser(s, open) {
  const stack = [s[open]];
  let unreadable = false;
  for (let k = open + 1; k < s.length; k += 1) {
    const ch = s[k];
    const next = s[k + 1];
    if (ch === '/' && next === '*') {
      const end = s.indexOf('*/', k + 2);
      if (end === -1) return { close: -1, unreadable };
      k = end + 1;
      continue;
    }
    if (ch === '/' && next === '/') return { close: -1, unreadable };
    if (ch === '/') { unreadable = true; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfStringLiteral(s, k);
      if (end === -1) return { close: -1, unreadable: ch !== '`' };
      k = end;
      continue;
    }
    if (BRACKET_CLOSERS[ch] !== undefined) { stack.push(ch); continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (BRACKET_CLOSERS[stack[stack.length - 1]] !== ch) return { close: -1, unreadable: true };
      stack.pop();
      if (stack.length === 0) return { close: k, unreadable };
    }
  }
  return { close: -1, unreadable };
}

/** The index of the closer matching the opener at `open`, or -1 if it does not close on this line. */
function matchingCloser(s, open) {
  return readToCloser(s, open).close;
}

/** The top-level, comma-separated members between `open` and its closer at `close`. */
function topLevelMembers(s, open, close) {
  const out = [];
  let depth = 0;
  let from = open + 1;
  for (let k = open + 1; k < close; k += 1) {
    const ch = s[k];
    const next = s[k + 1];
    if (ch === '/' && next === '*') {
      const end = s.indexOf('*/', k + 2);
      if (end === -1 || end > close) break;
      k = end + 1;
      continue;
    }
    if (ch === '/' && next === '/') break;
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfStringLiteral(s, k);
      if (end === -1 || end > close) break;
      k = end;
      continue;
    }
    if (BRACKET_CLOSERS[ch] !== undefined) { depth += 1; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth -= 1; continue; }
    if (ch === ',' && depth === 0) {
      out.push(s.slice(from, k).trim());
      from = k + 1;
    }
  }
  out.push(s.slice(from, close).trim());
  return out.filter((m) => m !== '');
}

/**
 * Every delimiter still OPEN where one side-line sits, as far as THIS HUNK
 * shows it — `{ frames, unreadable }`, the frames outermost first, each
 * `{ opener: '(' | '[' | '{', head: <the text left of it> }`. An EMPTY
 * `frames` is "the hunk does not say": no opener it showed is still open where
 * the line sits.
 *
 * ⭐ #19099 — `unreadable`, and it is the half an index cannot carry, exactly
 * as {@link readToCloser} separates the two facts a `-1` wore. This scan lexes
 * NO regex literal and pops TYPE-BLIND, and neither limit costs anything while
 * a reader only ever makes a tell FIRE: a guessed stack then buys a false tell
 * (loud) and never a swallowed one. They stop being harmless the moment a
 * reader SUPPRESSES on the answer — `.regex(/^\{\{/)` pushes two openers this
 * scan never closes, so the enclosing shape's own closers are eaten and a key
 * at the OUTER level reads as a member nested INSIDE it. ⇒ the flag is raised
 * where the stack stops being a reading and becomes a guess, and THESE ARE ITS
 * TRIGGERS, all of them, in the order a reader meets them:
 *
 *   • a `/` with another `/` left on its line — the only shape a single-line
 *     regex literal can have, and this scan does not lex one. ⛔ A LONE `/` is
 *     NOT a trigger: a regex literal cannot span lines, so one is arithmetic,
 *     and division pushes and pops nothing.
 *   • a closer whose type does not match the opener it popped.
 *   • a string literal that never closes on its line.
 *   • a `*\/` this walk cannot explain — a second one, or one after the flag is
 *     already up. ⛔ The FIRST `*\/` on a clean walk is not a trigger at all: it
 *     says the hunk began inside a comment (see the reset below).
 *
 * ⛔ NO READER SUPPRESSES ON THIS FLAG TODAY, and saying so is the point. The
 * one that did — #19099's bag-internal decline — was dropped by ruling D′, so
 * what lands here is the READING and not a consumer of it: the obligation is
 * stated at the definition rather than left for the next author to infer.
 * ⇒ any future reader that DECLINES a tell on these frames refuses when the
 * flag is set, and states every trigger above wherever it describes itself. A
 * disclosure naming only the division operator — which raises nothing — while
 * leaving ` *\/` unnamed is how the first cut of this flag regressed a landed
 * #18234 decline, and it did so in the commonest hunk shape there is: a hunk
 * that BEGINS inside a comment is **35 of the 270 T1 rows** this gate reports
 * on the corpus in the header (13.0%), against **2** rows for the one residual
 * that still raises the flag. ⇒ the undisclosed trigger outnumbered the
 * disclosed one by more than an order of magnitude, which is the whole lesson.
 *
 * ⭐ Like `readToCloser`, raising the flag does NOT move the frames: a caller
 * that only ever makes a tell FIRE (⇒ {@link inParameterList}) reads the same
 * ANSWER it read before this flag existed. ⛔ Not the same BYTES — this
 * function's body and `enclosingDelimiter`'s both changed — and the claim is
 * only worth what it is measured over: `enclosingDelimiter` and
 * `inParameterList` agree on **84,924 side-lines** over the 1,149 file diffs
 * the header's corpus names, one graft boundary excluded, **0 disagreements**
 * each. That is 2,298 sides counted as two per file diff — 1,939 of them
 * non-empty, the other 359 being the absent side of an added or deleted file.
 * ⛔ Fixing the stack instead — lexing regex literals
 * in full — was deliberately not attempted: telling a regex literal from a
 * division at every position needs the preceding TOKEN, which is one more guess
 * in a reader whose whole safety property is that it makes none. The two cheap,
 * SOUND discriminations above are taken; the rest is left loud, and the residual
 * is named in the header.
 *
 * ⭐ Positive evidence only, and an empty `frames` is the whole safety property.
 * The scan starts at the first line of the line's OWN hunk, so a construct
 * opened before the hunk is never guessed at, and a string literal that does not
 * close on its line means the state cannot be carried across it — that answers
 * no frames, and every caller reads that as "keep the tell firing". The answer
 * is ALWAYS an opener this hunk showed, never one inferred from a closer.
 *
 * ⭐ #18721 — a closer arriving with an EMPTY stack closes an opener the hunk
 * never showed, and that is NOT a reason to abandon the reading. The openers
 * the hunk DOES show are strictly INSIDE the ones it did not, so the shown
 * stack is a SUFFIX of the real one: whenever it is non-empty its top IS the
 * innermost open delimiter, whatever sits below it. So an underflow drops the
 * closer and the walk continues, and the answer is still EMPTY for exactly the
 * state that has no positive evidence — a shown stack that is empty where the
 * line sits. ⛔ The reading this replaces abandoned the walk at the FIRST
 * underflow, which a real hunk reaches on its LEADING CONTEXT LINES: a hunk
 * whose context opens on the tail of the previous declaration (`  });`) said
 * `null` for every line after it, however plainly the hunk went on to show the
 * `(` the line sits in.
 *
 * ⛔ This is NOT the depth-aware `z.object({ … })` reader T1's own comment
 * refuses, and ⛔ it must never be grown into one. It answers exactly one
 * question — which brackets are open — and nothing about WHICH construct
 * opened one, so it has no truncating failure mode: a state it cannot read is
 * reported as one, never as "no longer inside a shape".
 *
 * @param {{ text: string, hunk: number }[]} side — one SIDE of `patchLines`
 * @param {number} index — the line's index into that side
 * @returns {{ frames: { opener: string, head: string }[], unreadable: boolean }}
 */
export function enclosingDelimiters(side, index) {
  if (!Array.isArray(side) || typeof index !== 'number' || !side[index]) return { frames: [], unreadable: true };
  const { hunk } = side[index];
  let start = index;
  while (start > 0 && side[start - 1]?.hunk === hunk) start -= 1;
  const frames = [];
  let unreadable = false;
  let inBlockComment = false;
  let openedBlockComment = false;
  let leadingCommentClosed = false;
  for (let j = start; j < index; j += 1) {
    const s = String(side[j]?.text ?? '');
    for (let k = 0; k < s.length; k += 1) {
      const ch = s[k];
      const next = s[k + 1];
      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; k += 1; }
        continue;
      }
      if (ch === '/' && next === '*') { inBlockComment = true; openedBlockComment = true; k += 1; continue; }
      if (ch === '/' && next === '/') break;
      // #19099 — `*/` OUTSIDE a block comment: the hunk BEGAN INSIDE one. A
      // hunk's scan starts at the hunk's own first line, so a doc comment that
      // opened above it is invisible and its body was being read as code —
      // which is what raised the flag on ` */` before this reset existed, in
      // the commonest hunk shape there is — 35 of the 270 T1 rows this gate
      // reports on the header's corpus begin inside one. ⭐ It needs no regex
      // lexer and it is not a heuristic: outside a string and outside a comment,
      // `*/` is not valid TypeScript, so the only reading it has is a
      // terminator. Everything scanned so far was comment text, so the frames it
      // pushed are DISCARDED and the walk restarts after it.
      //
      // ⛔ Guarded on three sides, and each guard is pinned by its own case.
      // Once this walk has opened a block comment of its own, a later `*/` is
      // unexplained; once one leading comment has already been closed, a second
      // is not the same fact; and once anything has made the walk unreadable, a
      // `*/` may be bytes inside a string this scan mis-read, so the reset could
      // throw away real frames — the QUIET direction. Either way the flag is
      // raised instead.
      if (ch === '*' && next === '/') {
        if (!openedBlockComment && !leadingCommentClosed && !unreadable) {
          leadingCommentClosed = true;
          frames.length = 0;
          k += 1;
          continue;
        }
        unreadable = true;
        k += 1;
        continue;
      }
      // #19099 — a `/` that opens neither comment form is a division operator or
      // a REGEX LITERAL this scan does not lex, and the two are TELLABLE APART
      // without lexing either, because a regex literal cannot span lines: one
      // with no second `/` left on this line does not exist. So a lone `/` is a
      // DIVISION, which pushes and pops nothing and leaves the stack exactly as
      // correct as it was — no flag. A `/` with another `/` after it on the same
      // line may be a regex whose body carries brackets, and from there the
      // stack is a guess. ⛔ The conservative half is deliberate: a division
      // followed by a slash inside a string later on the line raises the flag it
      // does not need to.
      if (ch === '/') {
        if (s.indexOf('/', k + 1) !== -1) unreadable = true;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        const end = endOfStringLiteral(s, k);
        if (end === -1) return { frames: [], unreadable: true };
        k = end;
        continue;
      }
      if (BRACKET_CLOSERS[ch] !== undefined) { frames.push({ opener: ch, head: s.slice(0, k) }); continue; }
      if (ch === ')' || ch === ']' || ch === '}') {
        // #18721 — UNDERFLOW: this closes an opener the hunk never showed. Drop
        // it and keep walking. The shown stack is a suffix of the real one, so
        // nothing below it can ever be the innermost open delimiter; an empty
        // shown stack still answers "no frames" at the end, which is the same
        // "no positive evidence" this reader has always reported. ⛔ Underflow
        // raises NO flag: it is the one mismatch this reader can explain.
        if (frames.length === 0) continue;
        // #19099 — a TYPE-BLIND pop, flagged rather than fixed. In source this
        // reader lexed correctly a closer always matches the frame it pops, so a
        // mismatch says the stack is already wrong — which is what the flag is.
        if (BRACKET_CLOSERS[frames[frames.length - 1].opener] !== ch) unreadable = true;
        frames.pop();
      }
    }
  }
  return { frames, unreadable };
}

/**
 * The INNERMOST delimiter a hunk shows open where one side-line sits — the top
 * of {@link enclosingDelimiters}, and this reading's original shape.
 *
 * ⛔ `null` still covers both "unreadable" and "the hunk showed none still
 * open", because its two callers ({@link inParameterList} and #17618's decline)
 * read the two the same way: no positive evidence, so the tell keeps firing.
 * ⭐ #19099 — and that is why this reading ignores `unreadable`: both of them
 * only ever make a tell FIRE, so a guessed stack costs a false tell (loud) and
 * never a swallowed one, and folding the flag in here would instead have made a
 * REMOVED parameter earn budget it does not earn today.
 */
export function enclosingDelimiter(side, index) {
  const { frames } = enclosingDelimiters(side, index);
  return frames.length > 0 ? frames[frames.length - 1] : null;
}

/**
 * The prefixes that open a PARAMETER list rather than an argument list — the
 * `function` keyword (named, anonymous, generic, generator) and the three
 * positions an arrow's parameters open in: after `=`, after `=>`, and as a
 * callback handed straight to a call or an array.
 *
 * ⛔ Deliberately NOT "any identifier before a `(`": a method shorthand goes
 * unrecognised and its parameters keep telling. That is the loud direction and
 * it is the one this family takes everywhere — a prefix this list does not know
 * leaves the tell where it was.
 */
const PARAMETER_LIST_HEAD =
  /(?:\bfunction\b\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*(?:<[^<>]*>)?\s*|\bconstructor\s*|(?:=|=>|\(|\[|,)\s*(?:async\s+)?(?:<[^<>]*>)?\s*)$/;

/**
 * Does this side-line sit inside a function's PARAMETER LIST? (instance 1)
 *
 * Two positive conditions, both carried by the hunk: the innermost delimiter
 * still open is a `(`, and the text left of that paren reads as a callable
 * declaration head. A Zod shape member can satisfy neither — its body is
 * brace-delimited — so what this declines is exactly the annotated parameter,
 * `ctx: z.RefinementCtx` first among them.
 */
export function inParameterList(side, index) {
  const open = enclosingDelimiter(side, index);
  return open !== null && open.opener === '(' && PARAMETER_LIST_HEAD.test(open.head);
}

/** A property NAME at the head of a line, in the four spellings `SCHEMA_PROPERTY` admits. */
const KEYED_PROPERTY_NAME = /^[ \t]*(?:'([^']+)'|"([^"]+)"|(\[[^\]]+\])|([A-Za-z_$][\w$]*))[ \t]*\??[ \t]*:/;

/** The closed-set constructor a property's value opens with, if it opens with one. */
const CLOSED_SET_CONSTRUCTOR = /z\.(enum|union|discriminatedUnion|literal)\(/;

/**
 * The KEY a T1-shaped line names, or `null` when the line names none.
 *
 * ⛔ One reading, shared by every predicate below that asks "which key is
 * this line about" — the two spend readings (#17618's closed-set re-spelling
 * and #18234's universal acceptor) and nothing else may grow a second one: two
 * spellings of "the same key" would disagree about a quoted or optional-marked
 * name on the day one of them moved, and the budget would then pay on one side
 * of the comparison and refuse on the other.
 */
export function keyedPropertyName(text) {
  const s = String(text ?? '');
  if (COMMENT_LINE.test(s) || !SCHEMA_PROPERTY.test(s)) return null;
  const name = KEYED_PROPERTY_NAME.exec(s);
  if (name === null) return null;
  return name[1] ?? name[2] ?? name[3] ?? name[4];
}

/**
 * The closed-set members one line declares INLINE, or `null` when the list is
 * not readable on this one line.
 *
 * ⭐ "Not readable" is the common answer and it is the safe one: a value whose
 * list opens on a later line (`strategy: z.enum([`) reads `null`, and a `null`
 * on either side of either comparison below leaves the tell firing.
 *
 * ⛔ ONE reading, for the reason {@link keyedPropertyName} is one: the keyed
 * spend (#17618) and the binding spend (#18640) both ask "which members does
 * this line carry", and two spellings of that question would disagree about a
 * nested bracket or a comma inside a string on the day one of them moved.
 */
function inlineClosedSetMembers(s) {
  const ctor = CLOSED_SET_CONSTRUCTOR.exec(s);
  if (ctor === null) return null;
  const openParen = ctor.index + ctor[0].length - 1;
  const closeParen = matchingCloser(s, openParen);
  if (ctor[1] === 'literal') {
    if (closeParen === -1) return null;
    const members = topLevelMembers(s, openParen, closeParen);
    return members.length > 0 ? members : null;
  }
  const openBracket = s.indexOf('[', openParen);
  if (openBracket === -1 || (closeParen !== -1 && openBracket > closeParen)) return null;
  const closeBracket = matchingCloser(s, openBracket);
  if (closeBracket === -1) return null;
  const members = topLevelMembers(s, openBracket, closeBracket);
  return members.length > 0 ? members : null;
}

/**
 * The key a T1 line names and the closed-set members its value declares INLINE,
 * or `null` when either half is not readable on this one line.
 */
export function keyedClosedSetMembers(text) {
  const s = String(text ?? '');
  const key = keyedPropertyName(s);
  if (key === null) return null;
  const members = inlineClosedSetMembers(s);
  return members === null ? null : { key, members };
}

/**
 * Does this added line RE-SPELL a closed-set key the same change block removed,
 * without the set gaining a value? (instance 2)
 *
 * The evidence is three facts the block carries, all required: a removed line
 * naming the SAME key, both member lists readable inline, and the added list a
 * subset of the removed one. Equal lists count — a key re-spelled to carry an
 * `error` map or a `.default()` gained nothing either.
 *
 * ⛔ A member the removed list did not carry fails the subset test, so a key
 * whose enum is widened in place — `z.enum(['a','b'])` -> `z.enum(['a','b','c'])`
 * — keeps its tell. That case is why the blanket refusal this replaces existed,
 * and it is the one T2's member tells cannot catch: an INLINE set has no
 * per-member line to read.
 */
export function respellsExistingClosedSetKey(text, removedTexts) {
  const added = keyedClosedSetMembers(text);
  if (added === null || !Array.isArray(removedTexts)) return false;
  return removedTexts.some((r) => {
    const before = keyedClosedSetMembers(r);
    if (before === null || before.key !== added.key) return false;
    return added.members.every((m) => before.members.includes(m));
  });
}

/**
 * The BINDING a closed-set declaration line names — everything left of the
 * constructor, the way {@link closedSetOpenerBinding} reads it — together with
 * the members the SAME line carries inline. `null` when the line is not one
 * (#18640).
 *
 * Three things must all hold, and each one is the loud direction when it does
 * not:
 *
 *   ① the line is NOT a keyed property. That population is #17618's three-fact
 *     spend and this reading must never reach it — see
 *     {@link respellsExistingClosedSetBinding} for why the two answer different
 *     questions and why collapsing them would be a real loosening.
 *   ② the binding is NON-EMPTY. Identity is what makes "the same set was
 *     re-spelled" a fact rather than a resemblance, and an anonymous inline set
 *     (`z.union([A, B]),` as one arm of an outer union) declares none — two of
 *     them in one block are not evidence they are the same set.
 *   ③ the member list closes ON THIS LINE. A list that opens here and closes
 *     later is unreadable, exactly as it is for a keyed value.
 */
const CLOSED_SET_BINDING_HEAD = /^(.*?)z\.(?:enum|union|discriminatedUnion|literal)\(/;

export function closedSetBindingMembers(text) {
  const s = String(text ?? '');
  if (COMMENT_LINE.test(s)) return null;
  if (keyedPropertyName(s) !== null) return null; // ① a keyed line is #17618's, never this reading's
  const head = CLOSED_SET_BINDING_HEAD.exec(s);
  if (head === null) return null;
  const binding = head[1].trim();
  if (binding === '') return null; // ② no declaration identity, no evidence
  const members = inlineClosedSetMembers(s); // ③ readable on this line, or `null`
  return members === null ? null : { binding, members };
}

/**
 * Every member of `added` that `before` did not already carry, counted as a
 * MULTISET difference — the surplus, and what the removed list freed to pay for
 * it.
 *
 * ⛔ Multiset, not set: a list that repeats a member twice where the removed one
 * carried it once has gained a member, and a set difference would call that
 * zero.
 */
function netMemberDelta(added, before) {
  const pool = [...before];
  let surplus = 0;
  for (const m of added) {
    const at = pool.indexOf(m);
    if (at === -1) surplus += 1;
    else pool.splice(at, 1);
  }
  return { surplus, freed: pool.length };
}

/**
 * Does this added line RE-SPELL a closed set the same change block declared at
 * the SAME BINDING, without the set gaining a value? (instance 3, #18640)
 *
 * ⭐ The evidence is the CONTROL SET, not an argument about direction. The
 * identical edit spelled one member per line already declines, through
 * #16822's `rewritesExistingOpener` (the opener re-declares the same binding)
 * and #16943's budget (each removed arm line buys the added one that replaced
 * it); spelled INLINE it fires, because an inline opener is not an opener-only
 * line and a `const` declaration is not a key, so no reading in this file
 * reaches it. One semantic change, two opposite verdicts, decided by nothing
 * but where the author put the newlines — which is not a scale set too strict,
 * it is the accidental variable this family removes.
 *
 * ⇒ this reading supplies the same positive evidence the other two spellings
 * already accept, at the one position that had none, and is bounded EXACTLY by
 * what the multi-line spelling of the same block does: the per-line budget is
 * replacement-vs-net-addition arithmetic (#16943 — "the ruling this implements
 * is replacement-vs-net-addition, not spelling"), so this is the same
 * arithmetic over the members the inline line carries.
 *
 * ⛔ It is NOT #17618's subset test, and the difference is deliberate rather
 * than overlooked. #17618 governs a KEYED value, where the multi-line spelling
 * FIRES too (a keyed value whose list opens on a later line is unreadable and
 * still tells) — so there is no control bounding a relaxation there, and
 * carrying this arithmetic across to it would be a loosening with nothing to
 * measure it against. The two populations are kept apart by ① in
 * {@link closedSetBindingMembers}.
 *
 * The sensitivity guarantee is the surplus, exactly as #16943's is: a list that
 * grows reports, with its own file:line. `z.enum(['a', 'b'])` ->
 * `z.enum(['a', 'b', 'c'])` at one binding still fires; a different binding
 * pays nothing; a brand-new declaration has no removal to pay for it; and a
 * genuine new key beside the re-spelling still fires, because this reading
 * takes nothing out of the #16943 budget.
 *
 * ⚠️ The quiet direction this buys, stated rather than left to be discovered: a
 * one-for-one member SWAP at an existing binding — `z.union([A, B])` ->
 * `z.union([A, C])` — now declines, and `C` may accept more than `B` did.
 * ⛔ That is not a new class: #16943 bought exactly this silence for every set
 * spelled one member per line, and measured it over 82 commits (34 declines,
 * not one a member rename). What this removes is the accidental exception, not
 * the rule. What still catches a swap that slips past is what caught it for the
 * spelled-out form: `check:api-surface` on any exported name it moves,
 * `check:authorable-surface` on any authorable key it changes, and the ADR-0087
 * registries.
 */
export function respellsExistingClosedSetBinding(text, removedTexts) {
  const added = closedSetBindingMembers(text);
  if (added === null || !Array.isArray(removedTexts)) return false;
  return removedTexts.some((r) => {
    const before = closedSetBindingMembers(r);
    if (before === null || before.binding !== added.binding) return false;
    const { surplus, freed } = netMemberDelta(added.members, before.members);
    return surplus <= freed;
  });
}

/**
 * Zod's UNIVERSAL ACCEPTORS — the values a key may carry that admit EVERY
 * value — measured on this tree's zod rather than assumed (#18234).
 *
 * Measured with `safeParse` on zod 4.4.3, over `42`, `'stage=won'`, `null`,
 * `undefined`, `{}`, `[]`, `true` and a function: `z.unknown()` and `z.any()`
 * accept all eight, and so do `z.unknown().optional()` and `z.any().optional()`.
 * The two differ only in what `tsc` then permits at the USE site (`unknown` vs
 * `any`), which is not the question clause ② asks — the accept set is what an
 * author may write, and for both of these it is everything. ⛔ So `z.any()` is
 * in the class on a reading, not on a resemblance.
 *
 * ⚠️ `z.custom()` with no validator accepts every value too, and is NOT
 * declared here: measured over `packages/spec/src/**` and
 * `packages/runtime/src/**` it has ZERO code occurrences (3 text hits, all of
 * them prose in a docblock or a test comment). A row for a shape no tree
 * carries is the dead data the surface table's existence guard exists against,
 * and `z.custom(fn)` — the spelling that would actually arrive — narrows. The
 * class grows by MEASUREMENT: a landed carrier, then a case beside it.
 */
const UNIVERSAL_ACCEPTOR_CALL = /^z\.(?:unknown|any)\(\)/;

/**
 * The chain steps a universal acceptor may carry without ceasing to be one.
 *
 * ⛔ Measured, and deliberately SHORT: over the 132 key lines on this tree
 * whose value opens `z.unknown()` (127) or `z.any()` (5), the whole vocabulary
 * is `.optional()` (89), `.describe()` (84) and `.meta()` (1) — nothing else
 * appears. Every step outside this list leaves the tell FIRING, which is the
 * loud direction: `.refine()` NARROWS (measured: `z.unknown().refine(v =>
 * typeof v === 'string')` refuses `42`), and so do `.pipe()` and `.and()`.
 * ⚠️ Growing this list makes the gate QUIETER, so a step is added only with
 * the measurement that it cannot narrow — never because it looks harmless.
 */
const INERT_CHAIN_STEP = /^\.(?:optional|describe|meta)\(/;

/** What may follow the value when it TERMINATES on this line: a comma, nothing else. */
const UNIVERSAL_ACCEPTOR_TAIL = /^[ \t]*,[ \t]*$/;

/**
 * A universal-acceptor CALL anywhere in a value — the negative half of #18629's
 * fact ②, and ⛔ never a certification. It answers "this removed value had
 * something to do with the universe", which is all that is needed to DECLINE;
 * certifying that a value IS the universe stays {@link declaresUniversalAcceptorKey}'s
 * one reading.
 */
const UNIVERSAL_ACCEPTOR_MENTION = /z\.(?:unknown|any)\(/;

/**
 * The key this line declares as a UNIVERSAL ACCEPTOR, or `null` (#18234).
 *
 * `z.unknown()` is zod's universal acceptor, so a key carrying it accepts
 * EVERY value an author may write. That is the one fact #17618's three-fact
 * spend cannot express: its second fact asks for both member lists to be
 * readable, and a universal acceptor HAS no member list — which is precisely
 * the case where no list comparison is needed, because the removed set is the
 * universe and every replacement is a subset of it by construction.
 *
 * The evidence is positive, line-local and absent by default, the way every
 * decline in this file is. Three things must all be readable ON THIS LINE:
 *
 *   ① the line names a key (`keyedPropertyName`, the one reading);
 *   ② its value IS `z.unknown()` or `z.any()` — the call and nothing before
 *     it, so `legacy: z.string().or(z.unknown())` is not one; and
 *   ③ what follows is inert chain steps and then the END of the value, proven
 *     by the terminating comma.
 *
 * ⛔ Fact ③ is why an unterminated line answers `null`. A value that has not
 * ended cannot be read: `exportOptions: z.unknown().optional()` with
 * `.describe(…)` wrapped onto the next line shows nothing about what the next
 * line does, and `.refine(…)` there would make the removed set NARROWER than
 * the universe. Measured on this tree, 99 of the 132 universal-acceptor key
 * lines terminate on their own line and 33 do not; the 33 keep telling.
 *
 * ⚠️ The residual QUIET direction is none — this predicate only ever declines
 * to certify, and the residual is a FALSE POSITIVE on the wrapped spelling,
 * which is the loud direction this file accepts by name. ⭐ The OVERTURN
 * CONDITION, so it needs no second discussion: the first landed pair whose
 * removed universal acceptor wraps onto a second line closes it by reading the
 * block's removed run forward instead of one line.
 *
 * @param {string} text — one patch line's text, with its `+` / `-` stripped
 * @returns {string|null} the key, or `null` when the line declares no
 *   universal acceptor
 */
export function declaresUniversalAcceptorKey(text) {
  const s = String(text ?? '');
  const key = keyedPropertyName(s);
  if (key === null) return null;
  const name = KEYED_PROPERTY_NAME.exec(s);
  if (name === null) return null;
  let rest = s.slice(name[0].length).trimStart();
  const head = UNIVERSAL_ACCEPTOR_CALL.exec(rest);
  if (head === null) return null;
  rest = rest.slice(head[0].length);
  for (;;) {
    const step = INERT_CHAIN_STEP.exec(rest);
    if (step === null) break;
    // `matchingCloser` is string-aware, so a paren inside a `.describe()` string
    // cannot close the step early and let a narrowing arm through.
    const close = matchingCloser(rest, step[0].length - 1);
    if (close === -1) return null; // the step's arguments continue on a later line
    rest = rest.slice(close + 1);
  }
  return UNIVERSAL_ACCEPTOR_TAIL.test(withoutComments(rest)) ? key : null;
}

/**
 * Does this added line put a narrower value on a key the same change block
 * removed as a UNIVERSAL ACCEPTOR? (#18234)
 *
 * Two facts, both carried by the block: the added line names a key, and a
 * removed line names the SAME key with a value that accepted everything. No
 * third fact is needed and none is asked for — ⛔ in particular NOT the added
 * value's own shape, which is the accidental variable this reading removes: the
 * live pair declined when the replacement was spelled `z.array(z.any())` and
 * fired when the identical narrowing was spelled `z.union([`, purely because
 * the second opens a closed-set constructor and the first does not.
 *
 * ⛔ The KEY must match. A removed `filter: z.unknown()` buys nothing for an
 * added `other: z.union([` — that block really does add a spelling.
 */
export function replacesUniversalAcceptorKey(text, removedTexts) {
  const key = keyedPropertyName(text);
  if (key === null || !Array.isArray(removedTexts)) return false;
  return removedTexts.some((r) => declaresUniversalAcceptorKey(r) === key);
}

/**
 * Does this added line re-type a key the same change block removed INTO a
 * universal acceptor — a real WIDENING the #16943 budget would otherwise pay
 * for in silence? (#18629)
 *
 * The mirror of {@link replacesUniversalAcceptorKey}, read on the ADDED side,
 * and the one direction fact a line can carry about a value this file cannot
 * otherwise shape-read. Two facts, both on lines the BLOCK shows:
 *
 *   ① the added line declares the key as a universal acceptor, by the SAME
 *     reading #18234 certifies a removed one with — so the two ends of the
 *     budget cannot drift apart about what "accepts everything" means; and
 *   ② a removed line names the SAME key and carries NO universal-acceptor call
 *     at all.
 *
 * ⛔ Fact ② is a MENTION, deliberately, and not "⛔ not certified by ①". A
 * removed acceptor whose chain wraps onto a second line cannot be certified —
 * 33 of this tree's 132 acceptor key lines do not terminate on their own line —
 * so negating ① would fire on a pure REFORMAT of an already-universal key,
 * which changes no accept set. Reading the mention declines there instead, and
 * pays for that with the quiet direction the header states: a removed value that
 * merely mentions an acceptor inside a narrower one (`z.array(z.unknown())`)
 * buys the silence too.
 *
 * ⛔ The KEY must match, for the reason it must in #18234: a removed
 * `other: z.string()` says nothing about what `filter` now accepts.
 *
 * @param {string} text — one ADDED patch line's text, with its `+` stripped
 * @param {string[]} removedTexts — the lines this change block REMOVED
 * @returns {boolean} true when the block carries positive evidence that this
 *   key's accept set became the universe
 */
export function widensKeyIntoUniversalAcceptor(text, removedTexts) {
  const key = declaresUniversalAcceptorKey(text);
  if (key === null || !Array.isArray(removedTexts)) return false;
  return removedTexts.some(
    (r) =>
      keyedPropertyName(r) === key &&
      !UNIVERSAL_ACCEPTOR_MENTION.test(withoutComments(String(r ?? ''))),
  );
}

/**
 * Does this line DECLARE a key unwritable? (#17955)
 *
 * `retiredKey()` (`packages/spec/src/shared/retired-key.ts`) returns
 * `z.never(…).optional()`, and its entire contract is to REFUSE: the key's
 * `z.input` becomes `never` so `tsc` rejects it at the authoring site, and a
 * value that reaches the parse is refused carrying the migration prescription.
 * A line whose value IS that call therefore makes the accept set strictly
 * narrower — the one direction T1's sentence ("the accept set gains a spelling
 * an author may now write") cannot be true of.
 *
 * The evidence is positive, hunk-local and absent by default, the way every
 * decline in this file is: it is the added line's OWN value, read on the one
 * line, and a line that does not open the helper is not a tombstone.
 *
 * ⛔ OPENING the call is not enough — the value must BE the call and nothing
 * after it. `legacy: z.string().or(retiredKey('x'))` merely MENTIONS the helper
 * inside a live schema, and `legacy: retiredKey('x').or(z.string())` CHAINS a
 * live arm onto its result; each leaves a key an author may still write, so
 * neither is a tombstone and both must fire. "Nothing after it" is read per the
 * branch the line takes, and the branches are the two spellings this tree
 * actually uses (measured over the 254 judged tombstones at 1cb6a06195):
 *
 * ① the call CLOSES on the key line (76) — only a comma, a comment or the end
 *   of the line may follow the balancing paren. `matchingCloser` finds that
 *   paren string-aware, so a paren inside the prescription cannot close the
 *   call early, and `legacy: retiredKey('x'), extra: z.string(),` is refused
 *   the decline its second key would otherwise inherit.
 * ② it does NOT close there (178 — 148 ending at `retiredKey(`, 30 continuing
 *   into a prescription helper's own arguments) — every byte left on the line
 *   is INSIDE the argument list, and an argument cannot chain onto a result
 *   that does not exist yet: `retiredKey(…)` is `z.never(…).optional()`
 *   whatever it is passed. The line is a tombstone, and a chain can only appear
 *   on the line that CLOSES the call — a line that declares no key, which is
 *   the residual quiet direction the header names with its overturn condition.
 *   ⛔ #18488 — "does NOT close there" is a claim about the SOURCE, so it is
 *   only available when {@link readToCloser} was CERTAIN of what it read. A
 *   regex literal is not lexed by that scan, so a closed call can end this line
 *   with a stack that only looks open; an uncertain ending keeps the tell
 *   firing instead of buying this branch's decline.
 *
 * ⚠️ ⛔ Do not "tighten" ② to "only whitespace or a comment may follow
 * `retiredKey(`". Measured: that re-fires 30 of the 254 landed tombstones, all
 * of them in `packages/spec/src/data/driver.zod.ts`, which is the exact false
 * positive this reading exists to remove — and it
 * closes nothing, because a key line that has not closed the call shows no
 * chain to catch.
 *
 * ⚠️ It is deliberately NOT a lookup of the helper's import, and not a check
 * that the key existed before. #17300 measured that class of reading wrong for
 * this whole population: a retirement lands in ONE PR, so a seat's worktree is
 * not the diff's head and resolving anything against it answers about the wrong
 * commit — in the direction that keeps the false positive.
 */
const UNWRITABLE_KEY_DECLARATION = new RegExp(
  `${KEY_HEAD_SOURCE}(?:${UNWRITABLE_FORMS.map((f) => f.pattern).join('|')})`,
);

/** What may follow the balancing paren when the call closes on the key line. */
const TOMBSTONE_TAIL = /^[ \t]*,?[ \t]*$/;

/**
 * `text` with its comments removed — a line comment takes the rest of the line,
 * and a delimited comment takes up to its closer, or to the end of the line
 * when it has none. Same conventions as `matchingCloser` above, so "what may
 * follow the call" and "where the call closes" cannot drift apart.
 */
function withoutComments(text) {
  let out = '';
  for (let k = 0; k < text.length; k += 1) {
    const ch = text[k];
    const next = text[k + 1];
    if (ch === '/' && next === '/') return out;
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', k + 2);
      if (end === -1) return out;
      k = end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * #18560 — the reading is the FAMILY's, not one helper's. The helper name is
 * now read from {@link UNWRITABLE_FORMS} rather than spelled here, so the
 * vocabulary and the decline can never name different sets: a form declared
 * `writable: false` is recognised by `SCHEMA_PROPERTY` and declined by this
 * predicate in the same edit, and a form added to one register and not the
 * other fails the counterfactual battery. objectui's three refusal helpers
 * (`retirementTombstone`, `handlerKeyRefusal`, `aliasKeyRefusal`) join
 * `retiredKey` here on the measured ground that each one's value refuses every
 * input — ⛔ not on their names, and ⛔ not on the file they live in.
 *
 * #18702 — a FILE-LOCAL factory whose own definition returns a refusal joins
 * the same reading through `localRefusal`, a regex built the same way from the
 * same {@link KEY_HEAD_SOURCE} and ending at the same open paren. ⛔ It is a
 * second SOURCE of forms, never a second reading: the evidence a line must
 * carry is unchanged, so a live arm chained onto a local refusal fires exactly
 * as one chained onto `retiredKey(` does.
 *
 * @param {string} text — one patch line's text, with its `+` / `-` already stripped
 * @param {RegExp|null} [localRefusal] — the file's own refusing forms (#18702)
 * @returns {boolean} true when the line declares a key UNWRITABLE
 */
export function declaresUnwritableKey(text, localRefusal = null) {
  const s = String(text ?? '');
  if (COMMENT_LINE.test(s)) return false;
  const opening = UNWRITABLE_KEY_DECLARATION.exec(s)
    ?? (localRefusal instanceof RegExp ? localRefusal.exec(s) : null);
  if (opening === null) return false;
  const open = opening[0].length - 1;
  const { close, unreadable } = readToCloser(s, open);
  // ② The call is still OPEN at the end of the line, so every byte after
  // `retiredKey(` is one of its arguments — and an argument chains onto nothing.
  //
  // ⛔ #18488 — unless the reader could not READ the rest of the line, in which
  // case it has no idea whether the call is open and the sentence above is
  // about a stack it guessed at. `legacy: retiredKey(/\(/.source).or(z.string()),`
  // is valid TypeScript that CLOSES the call and chains a live arm onto it; the
  // unpaired paren inside the regex literal is what makes the stack look open.
  // An unreadable tail keeps the tell firing — positive evidence only, the same
  // direction `enclosingDelimiter` takes when a hunk does not show it a
  // neighbour. ⭐ It is the CERTAINTY that is read, not the return path: this
  // line falls off the end of the line with a non-empty stack, which is the one
  // `-1` that means genuinely open, so flagging only the "cannot parse" returns
  // would leave it exactly as silent as it was.
  if (close === -1) return !unreadable;
  // ① It closed here, so the value ends here too, give or take a comma.
  return TOMBSTONE_TAIL.test(withoutComments(s.slice(close + 1)));
}


// ---------------------------------------------------------------------------
// #18702 — a declaring factory PRIVATE to one file
// ---------------------------------------------------------------------------

/**
 * The identifier a key line's VALUE opens with AS A CALL, or `null`.
 *
 * ⛔ The shared list is the FAST PATH and is consulted first: a line
 * `SCHEMA_PROPERTY` already recognises answers `null` here, so the resolver
 * never re-judges a form the vocabulary has a row for and the two registers
 * cannot disagree about one line.
 */
const KEY_VALUE_CALL = new RegExp(`${KEY_HEAD_SOURCE}([A-Za-z_$][\\w$]*)\\(`);

/** @param {string} text @returns {string|null} */
export function keyValueFactoryName(text) {
  const s = String(text ?? '');
  if (COMMENT_LINE.test(s)) return null;
  if (SCHEMA_PROPERTY.test(s)) return null;
  const m = KEY_VALUE_CALL.exec(s);
  return m ? m[1] : null;
}

/**
 * The HEAD blob id this diff names for one file, or `null`.
 *
 * ⭐ Both input paths carry it, and neither is a ref: the API row's `sha` IS
 * the blob at the pull request's head, and `git diff` writes the same fact into
 * its `index <old>..<new>` line. A blob id is content-addressed, so a reading
 * taken through it can be missing but can never be about the wrong commit —
 * which is the whole reason this resolver is allowed to exist at all after
 * #17300.
 */
const DIFF_INDEX_BLOBS = /^index [0-9a-f]{7,40}\.\.([0-9a-f]{7,40})/m;
const ALL_ZEROES = /^0+$/;

/** @param {{ filename?: string, sha?: string, patch?: string|null }} file */
export function headBlobId(file) {
  const sha = String(file?.sha ?? '');
  if (/^[0-9a-f]{40}$/.test(sha) && !ALL_ZEROES.test(sha)) return sha;
  const m = DIFF_INDEX_BLOBS.exec(String(file?.patch ?? ''));
  return m && !ALL_ZEROES.test(m[1]) ? m[1] : null;
}

/** A repo-relative path that cannot climb out of the tree. */
const CONTAINED_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]+$/;

function gitAt(args) {
  return execFileSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * That blob's bytes, or `null`.
 *
 * ⛔ The working tree is read ONLY after git proves the file on disk hashes to
 * the very blob the diff named — that is not "the working tree of a different
 * commit", it is the same content-addressed fact arriving by a second route.
 * Anything else answers `null`, and `null` is a stated silence.
 */
function readHeadBlob(id, filename) {
  try {
    return gitAt(['cat-file', 'blob', id]);
  } catch {
    // Not in this object store — an unstaged edit, or another repo's pull.
  }
  try {
    const hashed = gitAt(['hash-object', '--', filename]).trim();
    if (/^[0-9a-f]{40}$/.test(hashed) && hashed.startsWith(id)) {
      return readFileSync(join(ROOT, filename), 'utf8');
    }
  } catch {
    // Not a file here, or not a git tree at all.
  }
  return null;
}

/** Content-addressed, so a hit can never be stale. */
const headBlobCache = new Map();

/** @param {{ filename?: string, sha?: string, patch?: string|null }} file */
export function headBlobSource(file) {
  const filename = String(file?.filename ?? '');
  const id = headBlobId(file);
  if (id === null || filename === '' || !CONTAINED_PATH.test(filename)) return null;
  if (headBlobCache.has(id)) return headBlobCache.get(id);
  const text = readHeadBlob(id, filename);
  headBlobCache.set(id, text);
  return text;
}

// -- reading ONE definition out of that text --------------------------------
//
// ⛔ Not a parser, and it must never grow into one. It answers exactly one
// question — what does this function's body RETURN, as the leading text of that
// expression — and every shape it cannot walk answers `null`, which the caller
// reads as "unresolved" and reports by name. There is no truncating failure
// mode: an unreadable definition is never "a definition that returns nothing".

/** The index past whitespace and comments at `k`. */
function skipTrivia(s, k) {
  let i = k;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue; }
    if (ch === '/' && s[i + 1] === '/') {
      const nl = s.indexOf('\n', i);
      if (nl === -1) return s.length;
      i = nl + 1;
      continue;
    }
    if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end === -1) return s.length;
      i = end + 2;
      continue;
    }
    return i;
  }
  return i;
}

/** Where the string opening at `start` closes, across lines for a template. */
function endOfStringAcross(s, start) {
  const quote = s[start];
  for (let k = start + 1; k < s.length; k += 1) {
    if (s[k] === '\\') { k += 1; continue; }
    if (quote !== '`' && s[k] === '\n') return -1;
    if (s[k] === quote) return k;
  }
  return -1;
}

/** `matchingCloser`'s reading, carried ACROSS lines. */
function closerAcross(s, open) {
  const stack = [s[open]];
  for (let k = open + 1; k < s.length; k += 1) {
    const ch = s[k];
    const next = s[k + 1];
    if (ch === '/' && next === '/') {
      const nl = s.indexOf('\n', k);
      if (nl === -1) return -1;
      k = nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = s.indexOf('*/', k + 2);
      if (end === -1) return -1;
      k = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfStringAcross(s, k);
      if (end === -1) return -1;
      k = end;
      continue;
    }
    if (BRACKET_CLOSERS[ch] !== undefined) { stack.push(ch); continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (BRACKET_CLOSERS[stack[stack.length - 1]] !== ch) return -1;
      stack.pop();
      if (stack.length === 0) return k;
    }
  }
  return -1;
}

/** Where a generic parameter list opening at `k` closes, or -1. */
function closeAngle(s, k) {
  let depth = 0;
  for (let i = k; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '<') depth += 1;
    else if (ch === '>') { depth -= 1; if (depth === 0) return i; }
    else if (ch === '\n' || ch === ';') return -1;
  }
  return -1;
}

/** The parameter NAMES between `open` and `close`. */
function parameterNames(s, open, close) {
  const names = [];
  const push = (seg) => {
    const m = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(seg);
    if (m) names.push(m[1]);
  };
  let depth = 0;
  let from = open + 1;
  for (let k = open + 1; k < close; k += 1) {
    const ch = s[k];
    const next = s[k + 1];
    if (ch === '/' && next === '/') {
      const nl = s.indexOf('\n', k);
      if (nl === -1 || nl > close) break;
      k = nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = s.indexOf('*/', k + 2);
      if (end === -1 || end > close) break;
      k = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfStringAcross(s, k);
      if (end === -1 || end > close) break;
      k = end;
      continue;
    }
    if (BRACKET_CLOSERS[ch] !== undefined) { depth += 1; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth -= 1; continue; }
    if (ch === ',' && depth === 0) { push(s.slice(from, k)); from = k + 1; }
  }
  push(s.slice(from, close));
  return names;
}

/**
 * Where the body opening at `bodyOpen` RETURNS, at its own top level.
 *
 * ⛔ Brace depth, never the first textual `return`. A `return` inside a nested
 * callback belongs to that callback, and reading it as the factory's own answer
 * is how a live factory would be classified by a refusal it merely contains —
 * the quiet direction.
 */
function topLevelReturn(s, bodyOpen) {
  let depth = 1;
  for (let k = bodyOpen + 1; k < s.length; k += 1) {
    const ch = s[k];
    const next = s[k + 1];
    if (ch === '/' && next === '/') {
      const nl = s.indexOf('\n', k);
      if (nl === -1) return -1;
      k = nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = s.indexOf('*/', k + 2);
      if (end === -1) return -1;
      k = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfStringAcross(s, k);
      if (end === -1) return -1;
      k = end;
      continue;
    }
    if (ch === '{') { depth += 1; continue; }
    if (ch === '}') { depth -= 1; if (depth === 0) return -1; continue; }
    if (depth !== 1) continue;
    if (
      ch === 'r'
      && s.startsWith('return', k)
      && !/[\w$.]/.test(s[k - 1] ?? ' ')
      && !/[\w$]/.test(s[k + 6] ?? ' ')
    ) {
      return skipTrivia(s, k + 6);
    }
  }
  return -1;
}

/** The leading text of the expression at `at`, whitespace collapsed. */
function leadingExpression(s, at) {
  return s.slice(at, at + 200).replace(/\s+/g, ' ').trim();
}

/** The `=>` of an arrow whose parameter list has already been walked, or -1. */
function arrowAfter(s, from) {
  let depth = 0;
  for (let k = from; k < s.length - 1; k += 1) {
    const ch = s[k];
    const next = s[k + 1];
    if (ch === '/' && next === '/') {
      const nl = s.indexOf('\n', k);
      if (nl === -1) return -1;
      k = nl;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = s.indexOf('*/', k + 2);
      if (end === -1) return -1;
      k = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfStringAcross(s, k);
      if (end === -1) return -1;
      k = end;
      continue;
    }
    if (BRACKET_CLOSERS[ch] !== undefined) { depth += 1; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth -= 1; continue; }
    if (depth !== 0) continue;
    if (ch === ';') return -1;
    if (ch === '=' && next === '>') return k;
  }
  return -1;
}

/**
 * Every place `name` is DEFINED in `source`, as a top-of-line declaration.
 *
 * ⛔ A doc-comment line (` * const x = …`) and a commented-out one (`// const
 * x = …`) cannot match, because the declaration keyword must follow the line's
 * indentation and nothing else. Two sites answer AMBIGUOUS, never "the first
 * one".
 */
function definitionSites(source, name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return [];
  const re = new RegExp(
    `(?:^|\\n)[ \\t]*(?:export[ \\t]+)?(?:default[ \\t]+)?(?:async[ \\t]+)?`
      + `(?:(function)[ \\t]+${name}\\b|(?:const|let|var)[ \\t]+${name}\\b)`,
    'g',
  );
  const sites = [];
  let m = re.exec(source);
  while (m !== null) {
    sites.push({ index: m.index + m[0].length, isFunction: m[1] !== undefined });
    m = re.exec(source);
  }
  return sites;
}

/** The body of a `function` form starting at the name's end. */
function functionReturn(s, from) {
  let k = skipTrivia(s, from);
  if (s[k] === '<') {
    const g = closeAngle(s, k);
    if (g === -1) return null;
    k = skipTrivia(s, g + 1);
  }
  if (s[k] !== '(') return null;
  const close = closerAcross(s, k);
  if (close === -1) return null;
  const params = parameterNames(s, k, close);
  const bodyOpen = s.indexOf('{', close + 1);
  if (bodyOpen === -1) return null;
  const at = topLevelReturn(s, bodyOpen);
  if (at === -1) return null;
  return { expr: leadingExpression(s, at), params };
}

/** What `name`'s definition RETURNS, or `null` when this reader cannot say. */
export function factoryReturnExpression(source, name) {
  const s = String(source ?? '');
  const sites = definitionSites(s, String(name ?? ''));
  if (sites.length !== 1) return null;
  const site = sites[0];
  if (site.isFunction) return functionReturn(s, site.index);

  // A binding: skip an optional type annotation, then read the initialiser.
  let i = skipTrivia(s, site.index);
  if (s[i] === ':') {
    let depth = 0;
    for (; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === '\n' && depth === 0 && s[skipTrivia(s, i)] === '=') { i = skipTrivia(s, i); break; }
      if (BRACKET_CLOSERS[ch] !== undefined) { depth += 1; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth -= 1; continue; }
      if (ch === ';') return null;
      if (ch === '=' && depth === 0 && s[i + 1] !== '=' && s[i + 1] !== '>' && !'=!<>'.includes(s[i - 1] ?? '')) break;
    }
  }
  if (s[i] !== '=') return null;
  i = skipTrivia(s, i + 1);
  if (s.startsWith('async', i) && !/[\w$]/.test(s[i + 5] ?? ' ')) i = skipTrivia(s, i + 5);
  if (s.startsWith('function', i) && !/[\w$]/.test(s[i + 8] ?? ' ')) return functionReturn(s, i + 8);
  if (s[i] === '<') {
    const g = closeAngle(s, i);
    if (g === -1) return null;
    i = skipTrivia(s, g + 1);
  }
  let params = [];
  if (s[i] === '(') {
    const close = closerAcross(s, i);
    if (close === -1) return null;
    params = parameterNames(s, i, close);
    i = close + 1;
  } else {
    const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 120));
    if (m === null) return null;
    params = [m[0]];
    i += m[0].length;
  }
  const arrow = arrowAfter(s, i);
  if (arrow === -1) return null;
  const body = skipTrivia(s, arrow + 2);
  if (s[body] === '{') {
    const at = topLevelReturn(s, body);
    if (at === -1) return null;
    return { expr: leadingExpression(s, at), params };
  }
  return { expr: leadingExpression(s, body), params };
}

/**
 * The register a returned expression puts the key in — `'writable'`,
 * `'refusing'`, or `null` for "this reader does not classify that".
 *
 * ⛔ Positive evidence only, in both directions. A refusal is `z.never(` or a
 * `z.custom` whose predicate refuses everything — the SAME primitives
 * `UNWRITABLE_FORMS` names, read off the definition instead of off a name. A
 * writable key is a `z.` schema, a `*Schema` binding, a form the shared
 * vocabulary already declares writable, or the factory's OWN ARGUMENT handed
 * back (`placeholderFree(schema, …)` returns `schema`). Everything else —
 * prose, an error map, a number — is `null`, and `null` is reported, never
 * rounded to either arm.
 */
const REFUSING_RETURN = /^z\.never[ \t]*\(|^z\.custom[ \t]*<[ \t]*never[ \t]*>[ \t]*\(|^z\.custom[ \t]*\([ \t]*\([ \t]*\)[ \t]*=>[ \t]*false\b/;
const WRITABLE_ZOD_RETURN = /^z\.[A-Za-z_$]/;
const WRITABLE_SCHEMA_BINDING = /^[A-Za-z_$][\w$]*Schema\b/;

/** @returns {'writable'|'refusing'|null} */
export function classifyFactoryReturn(expr, params = []) {
  const e = String(expr ?? '').trim();
  if (e === '') return null;
  if (REFUSING_RETURN.test(e)) return 'refusing';
  const call = /^([A-Za-z_$][\w$]*)[ \t]*\(/.exec(e);
  if (call !== null) {
    const form = SCHEMA_PROPERTY_FORMS.find((f) => f.pattern === `${call[1]}\\(`);
    if (form !== undefined) return form.writable ? 'writable' : 'refusing';
  }
  if (WRITABLE_ZOD_RETURN.test(e)) return 'writable';
  if (WRITABLE_SCHEMA_BINDING.test(e)) return 'writable';
  const head = /^([A-Za-z_$][\w$]*)/.exec(e);
  if (head !== null && Array.isArray(params) && params.includes(head[1])) return 'writable';
  return null;
}

/**
 * The verdict on ONE factory name against ONE file's text, with the reason.
 *
 * @returns {{ verdict: 'writable'|'refusing'|null, reason: string }}
 */
export function resolveDeclaringFactory(source, name) {
  const s = String(source ?? '');
  if (s === '') {
    return { verdict: null, reason: 'the head blob for this file is not readable here' };
  }
  const sites = definitionSites(s, String(name ?? ''));
  if (sites.length === 0) {
    return { verdict: null, reason: 'no definition in this file — an IMPORTED factory is outside this reading' };
  }
  if (sites.length > 1) {
    return { verdict: null, reason: `${sites.length} definitions of that name in this file — ambiguous, never guessed` };
  }
  const read = factoryReturnExpression(s, name);
  if (read === null) {
    return { verdict: null, reason: "no `return` this reader can read at the body's own top level" };
  }
  const verdict = classifyFactoryReturn(read.expr, read.params);
  if (verdict === null) {
    return { verdict: null, reason: `its body returns \`${read.expr.slice(0, 48)}\`, which this reader does not classify as a schema` };
  }
  return { verdict, reason: `its body returns \`${read.expr.slice(0, 48)}\`` };
}

/** One file's own declaring forms, built from `KEY_HEAD_SOURCE` like the list. */
function localFormPattern(names) {
  if (names.length === 0) return null;
  return new RegExp(`${KEY_HEAD_SOURCE}(?:${names.map((n) => `${n}\\(`).join('|')})`);
}

/**
 * The FILE-LOCAL declaring forms this file's ADDED lines name, resolved.
 *
 * ⛔ The ADDED side only, and the asymmetry is the loud direction (the header's
 * section says why): a removed local-factory key line buys nothing, so nothing
 * that fires today stops firing. Nothing is read at all unless an added key
 * line names a form the shared vocabulary has no row for — the overwhelming
 * majority of diffs never reach the blob.
 *
 * @returns {{ recognises: RegExp, refusal: RegExp|null }|null}
 */
function localDeclaringForms(file, lines, onContractSource, readSource, unresolved) {
  if (!onContractSource) return null;
  const wanted = new Map();
  for (const r of lines) {
    if (r.kind !== 'added') continue;
    const name = keyValueFactoryName(r.text);
    if (name === null) continue;
    if (!wanted.has(name)) wanted.set(name, []);
    wanted.get(name).push(r.line);
  }
  if (wanted.size === 0) return null;
  const source = typeof readSource === 'function' ? readSource(file) : null;
  const writable = [];
  const refusing = [];
  for (const [name, at] of wanted) {
    const read = resolveDeclaringFactory(source ?? '', name);
    if (read.verdict === 'writable') writable.push(name);
    else if (read.verdict === 'refusing') refusing.push(name);
    else if (Array.isArray(unresolved)) {
      for (const line of at) {
        unresolved.push({ file: String(file?.filename ?? ''), line, name, reason: read.reason });
      }
    }
  }
  const recognises = localFormPattern([...writable, ...refusing]);
  if (recognises === null) return null;
  return { recognises, refusal: localFormPattern(refusing) };
}

/**
 * The string a bare list element carries, or `null` if the line is not one.
 *
 * ⛔ The SAME `BARE_STRING_ELEMENT` shape T2 reads, so "the row that fired" and
 * "the row a licence is checked against" can never be two different questions —
 * the drift `memberTellKind` exists to prevent one reading over.
 */
export function bareElementValue(text) {
  const s = String(text ?? '');
  if (!BARE_STRING_ELEMENT.test(s)) return null;
  const m = /^[ \t]*(?:'([^']*)'|"([^"]*)")/.exec(s);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/** `export const entry = '<row>';` — the generator's input for ONE ledger row (#7297). */
const LEDGER_ENTRY_DECLARATION = /^[ \t]*export[ \t]+const[ \t]+entry(?:[ \t]*:[^=]*)?[ \t]*=[ \t]*(?:'([^']+)'|"([^"]+)")[ \t]*;?[ \t]*$/;

/** `id: '<id>',` — one row's registration in the ADR-0087 D2 conversion table. */
const CONVERSION_ID_DECLARATION = /^[ \t]*id[ \t]*:[ \t]*(?:'([^']+)'|"([^"]+)")[ \t]*,?[ \t]*$/;

/**
 * The retirement-ledger rows THIS DIFF licenses (#17300).
 *
 * A licence is minted by an ADDED line on one of the two input surfaces and by
 * nothing else: the generator's own per-entry input, or the D2 conversion
 * registration a `conversionIds` row refers to. Absence of a licence is the
 * default and leaves every tell firing, which is the loud direction this file
 * takes everywhere.
 *
 * ⛔ Never a position, a region marker or a filename shape — the licence is the
 * EXACT string the row carries, so an entry for one row buys nothing for its
 * neighbour. See the header for why the evidence spans files here and why a
 * lookup in the local tree answers about the wrong commit.
 *
 * @param {{ filename?: string, status?: string, patch?: string|null }[]} files
 * @returns {Set<string>} every row string this diff mints a licence for
 */
export function ledgerRowLicences(files, { repo = THIS_REPO } = {}) {
  const licensed = new Set();
  const entrySurface = ledgerSurface('entry', repo);
  const conversionSurface = ledgerSurface('conversion', repo);
  if (entrySurface === null && conversionSurface === null) return licensed;
  for (const file of files ?? []) {
    const filename = String(file?.filename ?? '');
    if (filename === '' || file?.status === 'removed') continue;
    const isEntry = entrySurface !== null && hintCovers(entrySurface.glob, filename);
    const isConversion = conversionSurface !== null && hintCovers(conversionSurface.glob, filename);
    if (!isEntry && !isConversion) continue;
    for (const row of patchLines(file?.patch)) {
      if (row.kind !== 'added') continue;
      const m = isEntry
        ? LEDGER_ENTRY_DECLARATION.exec(row.text)
        : CONVERSION_ID_DECLARATION.exec(row.text);
      const value = m ? (m[1] ?? m[2]) : null;
      if (typeof value === 'string' && value !== '') licensed.add(value);
    }
  }
  return licensed;
}

/** T3 — a row of a published export listing: every entry is a JSON string. */
const JSON_STRING_ROW = /^[ \t]*"/;

/**
 * T4 — a registration.
 *
 * Two shapes, because the three declared registries write entries two ways
 * (measured 2026-09-07): a BARE element of a list — `'WORKFLOW_STEP_FAILED',`
 * in `ERROR_CODE_LEDGER` — and a keyed member — `'@objectstack/rest': [`
 * opening an owner's list, `code: 'X',` inside a dispatcher-vocabulary row,
 * `workflow: workflowForm,` in the form registry. A structural line (`]`,
 * `},`, `});`) matches neither, and comments are already excluded upstream.
 */
const REGISTRATION_ROW =
  /^[ \t]*(?:'[^']*'|"[^"]*")[ \t]*,[ \t]*(?:\/\/.*)?$|^[ \t]*(?:'[^']+'|"[^"]+"|[A-Za-z_$][\w$]*)[ \t]*:[ \t]*\S/;

/**
 * The MEMBER or KEY shape one line carries on these surfaces, or `null`.
 *
 * The same shapes `tellsInFile` reads, in the same precedence order, extracted
 * so ONE classifier answers for an added line and for a removed one. #16943's
 * net-delta reading is a comparison between the two sides, and a comparison
 * whose sides are classified by two different code paths is a comparison of two
 * different questions — the drift this family punishes one register over.
 *
 * ⛔ A closed-set OPENER is deliberately NOT a member here. An opener-only line
 * declares no member (#16822 established that and dropped the tell it used to
 * carry), so counting it would let a `z.union([` -> `z.enum([` rewrite pay for a
 * member the same block really did add.
 */
export function memberTellKind(text, { onContractSource = false, onPublished = false, onRegistry = false, localForms = null } = {}) {
  const s = String(text ?? '');
  if (COMMENT_LINE.test(s)) return null;
  if (onRegistry && REGISTRATION_ROW.test(s)) return 'T4';
  if (onContractSource && SCHEMA_PROPERTY.test(s)) return 'T1';
  // #18702 — the file's OWN declaring factories, resolved through their own
  // definitions. Read AFTER the shared vocabulary, never instead of it: the
  // list is the fast path, and a form with a row never reaches this line.
  if (onContractSource && localForms !== null && localForms.recognises.test(s)) return 'T1';
  if (onContractSource && (BARE_STRING_ELEMENT.test(s) || BARE_SCHEMA_ARM.test(s))) return 'T2';
  if (onPublished && JSON_STRING_ROW.test(s)) return 'T3';
  return null;
}

/**
 * The CHANGE BLOCKS of one `patchLines` reading — maximal runs of consecutive
 * non-context lines inside one hunk.
 *
 * ⭐ This is git's own spelling of "these lines replaced those": a unified diff
 * emits a contiguous edit as one removed run followed by its added run, and a
 * context line between two edits means the file keeps a line between them, so
 * they are two edits and not one replacement.
 *
 * ⛔ The block, never the HUNK, is the unit — and the difference is not
 * cosmetic. A hunk carries three lines of context on each side, so it routinely
 * holds an unrelated removal at one end and a real addition at the other; the
 * `FILE_SCHEMA_KEY` fixture in `--self-test` is exactly that shape (a key ADDED
 * at :44 and a DIFFERENT key removed two lines later, with context between) and
 * it must keep firing. Pairing across a hunk would pay for the new key with a
 * removal that has nothing to do with it — a silence bought with the wrong
 * coin, which is the failure direction this file refuses.
 *
 * Blocks never span hunks: `patchLines` carries a hunk index precisely so no
 * adjacency reading can cross a boundary where the real file's lines are
 * missing.
 *
 * @param {{ kind: string, hunk: number }[]} lines — a `patchLines` reading
 * @returns {number[][]} each block's indices INTO `lines`, in patch order
 */
export function changeBlocks(lines) {
  const blocks = [];
  let current = null;
  for (let i = 0; i < (lines?.length ?? 0); i += 1) {
    const r = lines[i];
    if (r.kind === 'context') {
      current = null;
      continue;
    }
    if (current === null || current.hunk !== r.hunk) {
      current = { hunk: r.hunk, indices: [] };
      blocks.push(current);
    }
    current.indices.push(i);
  }
  return blocks.map((b) => b.indices);
}

/**
 * Every tell one file's added lines carry.
 *
 * @param {{ filename?: string, status?: string, patch?: string|null, sha?: string }} file
 * @param {{ repo?: string, licensed?: Set<string>, readSource?: Function,
 *   unresolved?: object[] }} [opts] — `licensed` is the whole diff's
 *   {@link ledgerRowLicences}; omitted, NOTHING is licensed and every row tells,
 *   because an unread licence is not a granted one. `readSource` is #18702's
 *   head-blob reader (defaulted, injectable so the self-test stays offline) and
 *   `unresolved` collects the key lines whose declaring factory could not be
 *   read — a STATED silence this file reports rather than swallows.
 * @returns {{ tell: string, file: string, line: number, text: string, why: string }[]}
 */
export function tellsInFile(
  file,
  { repo = THIS_REPO, licensed = null, readSource = headBlobSource, unresolved = null } = {},
) {
  const filename = String(file?.filename ?? '');
  if (filename === '') return [];
  if (file?.status === 'removed') return []; // a deleted file adds nothing.
  const rows = [];
  const lines = patchLines(file?.patch);
  // The two SIDES of the patch, each in file order. The new file's lines are
  // added + context — "the line before / after this one" as the author who
  // opens the file means it — and the old file's are removed + context, the
  // same reading taken against the file the diff replaced. Both sides are built
  // because #16822's fragment rule must judge a removed line by its OWN
  // neighbours: a prose fragment on the old side is not a member either, and
  // counting it would let deleted prose pay for an added member.
  const newFile = [];
  const oldFile = [];
  const newAt = new Map();
  const oldAt = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const r = lines[i];
    if (r.kind !== 'removed') {
      if (r.kind === 'added') newAt.set(i, newFile.length);
      newFile.push(r);
    }
    if (r.kind !== 'added') {
      if (r.kind === 'removed') oldAt.set(i, oldFile.length);
      oldFile.push(r);
    }
  }
  // What each hunk REPLACED, keyed by hunk so no reading crosses a boundary.
  const removedByHunk = new Map();
  for (const r of lines) {
    if (r.kind !== 'removed') continue;
    if (!removedByHunk.has(r.hunk)) removedByHunk.set(r.hunk, []);
    removedByHunk.get(r.hunk).push(r.text);
  }
  const neighbourOn = (side, idx, step) => {
    const n = side[idx + step];
    return n && n.hunk === side[idx].hunk ? n.text : null;
  };
  const fragmentOn = (side, idx) =>
    typeof idx === 'number' && isConcatenationFragment(neighbourOn(side, idx, -1), neighbourOn(side, idx, 1));
  const surfaces = surfaceFlags(filename, repo);
  const { onContractSource } = surfaces;
  // #18702 — THE ONE CALL that consults the file-local factory resolver. The
  // ablation reverts exactly this line to `null`, which restores the pre-#18702
  // reading byte for byte: `addedSurfaces` is then `surfaces` itself.
  const localForms = localDeclaringForms(file, lines, onContractSource, readSource, unresolved);
  const addedSurfaces = localForms === null ? surfaces : { ...surfaces, localForms };
  const localRefusal = localForms === null ? null : localForms.refusal;
  // #17300 — is THIS file the ADR-0087 ledger? A licence clears a row in the
  // ledger table and nowhere else: the same string added to any other file on
  // any other surface still tells, with its own file:line.
  const ledgerTable = ledgerSurface('table', repo);
  const onLedgerTable = ledgerTable !== null && hintCovers(ledgerTable.glob, filename);
  // #16943 — the REPLACEMENT budget, one per change block, per tell kind.
  //
  // Every removed line in the block that carried a member or a key of kind K
  // buys ONE added line of kind K the right not to be reported: that added line
  // did not grow the accept set, it took the place of something that was
  // already in it. The budget is spent in patch order, so when a block adds
  // MORE than it removed the SURPLUS lines — the ones no removal paid for —
  // still fire, with their own file:line. That surplus is the whole sensitivity
  // guarantee: a genuine addition has no removal to pay for it.
  const budgetOfLine = new Map();
  // #17618 — what the BLOCK removed, in its own text. The block is already the
  // budget's unit, so the re-spelling evidence below is read against the same
  // run of lines rather than the hunk: a removal three context lines away is a
  // different edit and buys nothing here either.
  const removedOfLine = new Map();
  for (const block of changeBlocks(lines)) {
    const budget = new Map();
    const removed = [];
    for (const i of block) {
      const r = lines[i];
      if (r.kind !== 'removed') continue;
      removed.push(r.text);
      if (BARE_STRING_ELEMENT.test(r.text) && fragmentOn(oldFile, oldAt.get(i))) continue;
      const kind = memberTellKind(r.text, surfaces);
      // #17618 — read on the OLD side too, the way #16822's fragment rule is: a
      // deleted PARAMETER was never a key, so it must not buy an added one the
      // right to go unreported.
      if (kind === 'T1' && inParameterList(oldFile, oldAt.get(i))) continue;
      // #17955 — a REMOVED tombstone buys nothing either, the same way a removed
      // parameter does not. Un-retiring a key — dropping `legacy: retiredKey(…)`
      // and putting a live schema back on that spelling — is a real WIDENING,
      // and letting the tombstone pay for it would trade this file's loud
      // failure for a silent one on the only diff shape that re-opens an accept
      // set the tree had already closed.
      if (kind === 'T1' && declaresUnwritableKey(r.text)) continue;
      if (kind !== null) budget.set(kind, (budget.get(kind) ?? 0) + 1);
    }
    for (const i of block) {
      budgetOfLine.set(i, budget);
      removedOfLine.set(i, removed);
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].kind !== 'added') continue;
    const { line, text, hunk } = lines[i];
    if (COMMENT_LINE.test(text)) continue;
    // #16822 — a line that is one FRAGMENT of a multi-line string
    // concatenation is not a bare element of anything: not a member of a
    // closed set (T2) and not a registration (T4). The 8-fragment instrument
    // on the card is the proof that the tell keyed on the accidental absence
    // of a continuation operator; the header states the one quiet direction
    // this buys. ⛔ Only the bare-STRING shape is declined — a keyed line
    // (`reason: 'prose ' +`) is a different reading and keeps its own tells.
    if (BARE_STRING_ELEMENT.test(text) && fragmentOn(newFile, newAt.get(i))) continue;
    const at = { file: filename, line, text: text.trim().slice(0, 160) };
    const kind = memberTellKind(text, addedSurfaces);
    // #17955 — a `retiredKey()` tombstone DECLARES a key unwritable. It is read
    // BEFORE the budget, and that ordering is the whole repair rather than a
    // detail: a tombstone must neither FIRE nor SPEND.
    //
    // An ADR-0087 rename puts three key lines in one change block — the old
    // spelling removed, the new one added, the tombstone added — so the
    // REPLACEMENT budget the removal earns is owed to the RENAME. Let the
    // tombstone spend it and the budget is exhausted by the one line that never
    // needed it, leaving the rename to fire as the surplus; which of the two
    // reports then depends on nothing but their order in the patch. Declining
    // here takes the tombstone out of the arithmetic on both sides, so the
    // rename is paid for whichever way round the author wrote them.
    //
    // ⛔ This is NOT the licence's ordering (#17300), and the difference is the
    // evidence, not a preference: a licence is minted ELSEWHERE in the diff, so
    // reading it before the budget would let a tombstone's licence pay for a
    // genuine member. A tombstone carries its own evidence on its own line and
    // takes nothing from the block, so a genuine key beside it still has the
    // full budget to pay with — and fires when it cannot.
    if (kind === 'T1' && declaresUnwritableKey(text, localRefusal)) continue;
    // #16943 — a member or key this block REPLACED is not a net addition.
    //
    // ⛔ A line that DECLARES a closed set is never spent against the budget,
    // however it also reads: an opener carries a declaration, not a member, and
    // #16822's `rewritesExistingOpener` is the reading that judges it.
    // #17618 — a line that DECLARES a closed set may spend the budget only on
    // positive evidence that the set gained nothing: the same block removed the
    // SAME key and the inline member list did not grow. Without that evidence
    // the refusal stands, because an inline `z.enum([…])` widened in place has
    // no per-member line for T2 to read and this row is the only one that fires.
    // #18234 — … or on the OTHER positive evidence a block can carry that the
    // set gained nothing: the same block removed the SAME key carrying a value
    // that accepted EVERYTHING. `z.unknown()` is zod's universal acceptor, so
    // every value the replacement admits was already admitted and the added
    // list is a subset BY CONSTRUCTION — there is no member list to compare
    // because the removed set was the universe. ⛔ This is the same positive
    // evidence #17618 asks for, supplied by the removed value's own semantics
    // instead of by a list comparison; it is NOT a relaxation of the refusal:
    // an inline set widened in place still has no removed universal acceptor to
    // name, and still fires on this row.
    const declaresClosedSet = CLOSED_SET_OPENER.test(text);
    const removedHere = removedOfLine.get(i);
    const spendable =
      !declaresClosedSet ||
      respellsExistingClosedSetKey(text, removedHere) ||
      replacesUniversalAcceptorKey(text, removedHere);
    // #18629 — … and the SAME fact read on the added side, which is the one
    // direction the budget was blind to. A key re-typed INTO a universal
    // acceptor is a real widening: the block removed that key carrying no
    // acceptor at all and put the universe on it.
    //
    // ⭐ It still SPENDS. Refusing the spend would hand the unit to the next
    // added line in the block, so a genuinely new key riding along with the
    // widening would go silent — the surplus rule inverted, one report bought
    // at the price of another. The unit is consumed exactly as before and the
    // row is reported on top of it.
    const widensIntoAcceptor = widensKeyIntoUniversalAcceptor(text, removedHere);
    if (kind !== null && spendable) {
      const budget = budgetOfLine.get(i);
      const paid = budget?.get(kind) ?? 0;
      if (paid > 0) {
        budget.set(kind, paid - 1);
        if (!widensIntoAcceptor) continue;
      }
    }
    // #17300 — a retirement-ledger row this DIFF mints the licence for is a
    // record that an accept set SHRANK, not a value it gained.
    //
    // ⛔ Read AFTER the #16943 budget, deliberately, because the ordering
    // decides a case: when a block removes a real member and adds BOTH a
    // licensed tombstone and a genuine member, the tombstone spends the removal
    // and the genuine member — which now has nothing left to pay with — fires
    // with its own file:line. Checking the licence first would leave the budget
    // for the genuine member to spend instead, and buy exactly the silence this
    // file refuses. The licence is the LAST reading, never the first.
    if (kind === 'T2' && onLedgerTable && licensed !== null) {
      const value = bareElementValue(text);
      if (value !== null && licensed.has(value)) continue;
    }
    // A DECLARED registry is read as a registry first. Its files also sit on
    // the contract source surface (two of the three live under
    // `packages/spec/src/**`), and a ledger code read as "a member of a closed
    // set" would be true but less useful than the reading that names the
    // register it was added to. One line is one row, never one per surface.
    if (kind === 'T4') {
      rows.push({ tell: 'T4', ...at, why: 'a new registration in a registry / catalog — what the runtime accepts grows with no schema file moving' });
      continue;
    }
    if (kind === 'T1') {
      // #17618 — a PARAMETER is not a key on a shape. `(value, ctx:
      // z.RefinementCtx)` is this repo's prescribed signature for an exported
      // object-level refinement, so without this reading every diff that adds a
      // cross-field REFUSAL raised a widening tell for the refusal itself.
      if (inParameterList(newFile, newAt.get(i))) continue;
      rows.push({
        tell: 'T1',
        ...at,
        why: widensIntoAcceptor
          ? 'a key re-typed INTO a universal acceptor (`z.unknown()` / `z.any()`) — the accept set for a key the same block removed becomes every value an author may write'
          : 'a new key on a Zod object schema — the accept set gains a spelling an author may now write',
      });
      continue;
    }
    // #16822 — an opener that re-declares a set the same hunk removed adds no
    // member; the members are read below, one line each.
    //
    // #18640 — … and an opener that carries its members INLINE re-declares one
    // too, when the same BLOCK removed a line declaring that same binding and
    // the list did not grow. #16822's reading cannot see this line: an opener
    // carrying members is not an opener-only line, by its own construction, so
    // the population it left behind is every closed set DECLARED and re-spelled
    // on one line — where the #16943 budget cannot reach either, because a
    // `const` declaration names no key and `memberTellKind` answers `null` for
    // it. The control set is the same edit spelled one member per line, which
    // declines today; see `respellsExistingClosedSetBinding` for what bounds it
    // and for why #17618's keyed subset test is deliberately NOT changed.
    const opener =
      CLOSED_SET_OPENER.test(text) &&
      !rewritesExistingOpener(text, removedByHunk.get(hunk)) &&
      !respellsExistingClosedSetBinding(text, removedHere);
    if (onContractSource && (opener || kind === 'T2')) {
      rows.push({ tell: 'T2', ...at, why: 'a new member of a closed set (z.enum / union / an `as const` array) — the accept set gains a value' });
      continue;
    }
    if (kind === 'T3') {
      rows.push({ tell: 'T3', ...at, why: 'a new row in a published entry point\'s export listing — the public surface grows (ADR-0059)' });
      continue;
    }
  }
  return rows;
}

/**
 * Did this row add NOTHING — as a fact this reader can point at?
 *
 * ⭐ The asymmetry is the safety property, and it is the same one the sibling's
 * `--pair-json` reader has: a MISSING count is not a zero. `additions: 0` is a
 * reading somebody took — GitHub's own on the API path, this file's hunk count
 * on the local one — and a row that added nothing owes no patch, so skipping it
 * keeps every rename and mode-only change out of the gap list. `null` or an
 * absent field is the ABSENCE of that reading, and an absent reading can never
 * be turned into "nothing was added" here.
 *
 * The one inference this function does make is narrow and named: a row whose
 * status is `renamed`, which carries NO count at all and NO patch, is a pure
 * rename. That shape only reaches this file from a hand-assembled document —
 * both real input paths carry a count — and a pure rename genuinely adds
 * nothing.
 */
export function addedNothing(file) {
  if (typeof file?.additions === 'number') return file.additions === 0;
  if (file?.additions != null) return false; // a non-number count is no count.
  return file?.status === 'renamed' && (file?.patch == null || file.patch === '');
}

/**
 * A file this gate had to read and could not.
 *
 * Only a file ON a tell surface owes a patch: an unread `README.md` decides
 * nothing here, and reporting it would bury the readings that matter. A file
 * that IS on a surface, added something (or might have), and arrived with no
 * patch is a gap — because "no added line matched" and "no line was read" are
 * the two states this whole family keeps apart.
 */
export function unreadFiles(files, { repo = THIS_REPO } = {}) {
  const gaps = [];
  for (const file of files ?? []) {
    const filename = String(file?.filename ?? '');
    if (filename === '' || file?.status === 'removed') continue;
    if (addedNothing(file)) continue;
    if (typeof file?.patch === 'string' && file.patch !== '') continue;
    const flags = surfaceFlags(filename, repo);
    if (!flags.onContractSource && !flags.onPublished && !flags.onRegistry) continue;
    gaps.push(filename);
  }
  return gaps;
}

/**
 * Every tell in a whole changed-file listing, in file order.
 *
 * The retirement-ledger licences (#17300) are read ONCE, from the whole
 * listing, and threaded down: the generator's input and its output are two
 * files by construction, so the reading that clears a tombstone row is the only
 * one in this file whose evidence a single file cannot hold.
 */
export function wideningTells(files, { repo = THIS_REPO, readSource = headBlobSource, unresolved = null } = {}) {
  const rows = [];
  const licensed = ledgerRowLicences(files, { repo });
  for (const file of files ?? []) rows.push(...tellsInFile(file, { repo, licensed, readSource, unresolved }));
  return rows;
}

/**
 * The verdict: a declaration plus a diff.
 *
 * ⚠️ `unresolved` rides beside `rows` and is NEVER one: a key line whose
 * declaring factory could not be read (#18702) fired nothing and cleared
 * nothing, so it moves no exit code and is reported under its own heading.
 *
 * @param {{ declaration: 'yes'|'no'|null|undefined,
 *           files: object[]|null, repo?: string, readSource?: Function }} input
 * @returns {{ state: 'not-applicable'|'unreadable'|'incomplete'|'refused'|'clean',
 *   rows: object[], gaps: string[], unresolved: object[], text: string|null }}
 */
export function wideningRefusal({ declaration, files, repo = THIS_REPO, readSource = headBlobSource } = {}) {
  // A `yes` is never blocked here, and an unreadable declaration is the
  // sibling's C2 row — issuing a verdict on it from this file would be a second
  // reader of the same limb, which is the drift this family punishes.
  if (declaration !== 'no') {
    return { state: 'not-applicable', rows: [], gaps: [], unresolved: [], text: null };
  }
  if (!Array.isArray(files)) {
    return {
      state: 'unreadable',
      rows: [],
      gaps: [],
      unresolved: [],
      text:
        'the changed-file listing could not be read, so this diff is UNJUDGED for widening tells. ' +
        '⛔ An unread diff is not a narrow diff.',
    };
  }
  const gaps = unreadFiles(files, { repo });
  const unresolved = [];
  const rows = wideningTells(files, { repo, readSource, unresolved });
  if (rows.length > 0) {
    const where = rows.map((r) => `${r.file}:${r.line}`).join(', ');
    return {
      state: 'refused',
      rows,
      gaps,
      unresolved,
      text: `${REFUSAL_SENTENCE} — ${rows.length} tell(s): ${where}`,
    };
  }
  if (gaps.length > 0) {
    return {
      state: 'incomplete',
      rows,
      gaps,
      unresolved,
      text:
        `${gaps.length} file(s) on a tell surface arrived with no patch to read (${gaps.join(', ')}), ` +
        'so this diff is UNJUDGED for widening tells rather than clear of them.',
    };
  }
  return { state: 'clean', rows: [], gaps: [], unresolved, text: null };
}

/** The exit code one verdict maps to — one place, so no caller re-derives it. */
export function exitForRefusal(verdict) {
  if (verdict?.state === 'refused') return EXIT_REFUSED;
  if (verdict?.state === 'incomplete' || verdict?.state === 'unreadable') return EXIT_INCOMPLETE;
  return EXIT_OK;
}

/** The rows a caller prints, one line each, file:line first. */
export function refusalLines(verdict) {
  return (verdict?.rows ?? []).map((r) => `${r.tell} ${r.file}:${r.line} — ${r.why}\n    + ${r.text}`);
}

// ---------------------------------------------------------------------------
// What this run judged, and on what board — the honest half of the verdict
// ---------------------------------------------------------------------------

/**
 * WHICH repo this run judges, and ON WHAT BASIS (#17217).
 *
 * The sibling's `boardProvenanceLine` is the precedent and the wording follows
 * it deliberately, including the action that changes the answer. It is
 * re-rendered rather than imported for one reason only: `check-clause2-carriers`
 * imports THIS file, so importing it back would be a cycle. The RESOLUTION —
 * the part that could drift into a second convention — is imported
 * (`resolveSweepRepo`); only the sentence is local.
 *
 * ⚠️ It goes to stdout beside the verdict, where the sibling puts its own on
 * stderr. That divergence is deliberate and this file's case is the opposite of
 * the sibling's: the sibling has a `--json` mode whose stdout is contractually
 * the machine-readable ANSWER, so a provenance line there would travel into a
 * round report as though it were a finding. This file has no such mode — its
 * stdout IS the prose verdict — and #17217's whole finding is that the verdict
 * line does not say whose diff it thought it was reading. Splitting the two
 * across streams would let a seat keep the sentence and lose the board, which
 * is the state the card measured.
 */
export function boardProvenanceLine({ repo, source }) {
  const detail = source === 'default'
    ? 'source: default — set PM_SWEEP_REPO to judge another repo'
    : `source: ${source}`;
  return `  board: this run judges ${repo} (${detail}).`;
}

/** The listing one NOT-MEASURED bucket contributes, capped so it cannot swamp. */
function bucketLines(heading, rows, cap) {
  if (rows.length === 0) return [];
  const shown = rows.slice(0, cap);
  const lines = [`    ${heading} (${rows.length}):`];
  for (const r of shown) lines.push(`      ${r.filename}`);
  if (rows.length > shown.length) lines.push(`      … and ${rows.length - shown.length} more`);
  return lines;
}

/**
 * The success sentence, split so a count can never again read as coverage.
 *
 * ⭐ This is #17112's whole fix, and the shape of it is the point. The line the
 * card measured said `N changed file(s) READ, no widening tell on any declared
 * surface` — a COUNT of files beside a QUALIFIED negative. The qualifier was
 * true and the count was true, and together they said something neither says
 * alone, because a count reads as coverage in a way a qualifier does not undo.
 * A file no declared surface covers was never read for tells: no tell could
 * have fired on it whatever it contained, so its inclusion in that count made
 * exit 0 evidence about surfaces this instrument cannot see.
 *
 * So the count is SPLIT, never deleted — a reader still needs to know what WAS
 * judged, and an instrument that reports nothing about its own reach is not an
 * improvement on one that over-reports it. `judged` is the only number exit 0
 * is evidence about; every other file is named under the reason it could not be
 * examined.
 *
 * ⛔ No verdict and no exit code moves here. Whether an unexaminable population
 * should REFUSE rather than pass is #16349's chain to answer, not this
 * function's: it would be a new refusal class on a gate whose enqueue path
 * #17217 measured as sound, and both cards' filings put that question outside
 * themselves. This prints what was true all along.
 */
export function coverageLines(census, { cap = 10 } = {}) {
  const gaps = notMeasured(census);
  const lines = [];
  if (gaps.length === 0) return lines;
  lines.push(
    '  ⛔ NOT MEASURED is not a clean reading — no tell could have fired on these files whatever they contain:',
  );
  lines.push(...bucketLines('no declared surface covers it', census.unmatched, cap));
  for (const repo of [...new Set(census['other-repo'].flatMap((r) => r.repos))].sort()) {
    const rows = census['other-repo'].filter((r) => r.repos.includes(repo));
    lines.push(
      ...bucketLines(
        `a declared surface covers it, but for ${repo} — re-run with PM_SWEEP_REPO=${repo}`,
        rows,
        cap,
      ),
    );
  }
  lines.push(
    ...bucketLines(
      'on a declared surface, but not a contract source file — a test declares no contract',
      census['not-contract-source'],
      cap,
    ),
  );
  return lines;
}

/**
 * The key lines whose DECLARING FACTORY this reader could not resolve (#18702).
 *
 * ⭐ The whole point of printing them. Before this round a key line declared
 * through a factory the vocabulary had no row for produced nothing at all — no
 * tell, no gap, no sentence — and that silence is indistinguishable from a
 * correct `no`, which is the one failure shape this chain is written against.
 * These lines still move no exit code: nothing fired on them and nothing
 * cleared them. What changed is that the reader now NAMES them.
 *
 * ⛔ Not a gap and not a tell. A gap (`unreadFiles`) is a file that arrived
 * with no patch; a tell is a refusal. This is a third state — read, recognised
 * as a key line SHAPE, and unjudged — and collapsing it into either would make
 * a count say something nobody measured.
 */
export function unresolvedLines(rows, { cap = 10 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const lines = [
    `  ⚠️ ${rows.length} key line(s) name a declaring factory this reader could not resolve — a STATED `
      + 'silence: no tell fired on them and nothing cleared them, so this verdict is evidence about '
      + 'neither.',
  ];
  for (const r of rows.slice(0, cap)) lines.push(`      ${r.file}:${r.line} — \`${r.name}(\` — ${r.reason}`);
  if (rows.length > cap) lines.push(`      … and ${rows.length - cap} more`);
  return lines;
}

/** The success sentence itself, counts split. */
export function cleanVerdictLine(census) {
  const judged = census.judged.length;
  const gaps = notMeasured(census).length;
  const parts = [
    `${judged} judged against a declared surface (no widening tell)`,
    `${gaps} NOT MEASURED`,
  ];
  if (census.deleted.length > 0) parts.push(`${census.deleted.length} deleted (a deletion adds nothing)`);
  const nothing = judged === 0 && census.total > 0
    ? ' ⛔ NOTHING on this diff was examined for widening tells, so this exit 0 is evidence about no surface at all.'
    : '';
  return `✓ check-widening-tells: ${census.total} changed file(s) — ${parts.join(', ')}.${nothing}`;
}

/**
 * The whole CLI decision, as data — exit code plus the lines each stream gets.
 *
 * Pure on purpose: `--self-test` drives THIS, so the printed sentence and the
 * board threading are assertions rather than something a reader has to run the
 * binary to see. `main` is then argv parsing, one file read, and printing.
 */
export function verdictLines({ declaration, files, board }) {
  const out = [];
  const err = [];
  if (declaration !== 'no') {
    out.push(
      `✓ check-widening-tells: the claim declares \`Clause-②: ${declaration}\`, which this gate never ` +
        'blocks — a `yes` already routes to contract review, so a tell on top of it decides nothing.',
    );
    return { exit: EXIT_OK, out, err };
  }
  const verdict = wideningRefusal({ declaration, files, repo: board.repo });
  if (verdict.state === 'clean') {
    const census = coverageCensus(files, { repo: board.repo });
    out.push(cleanVerdictLine(census));
    out.push(boardProvenanceLine(board));
    out.push(...coverageLines(census));
    out.push(...unresolvedLines(verdict.unresolved));
    out.push(
      '  ⚠️ A tell is not a proof and its absence is not one either — false negatives are the ' +
        'cost the #16349 ruling accepted.',
    );
    return { exit: EXIT_OK, out, err };
  }
  for (const line of refusalLines(verdict)) err.push(`✗ ${line}`);
  err.push(`check-widening-tells: ${verdict.text}`);
  err.push(...unresolvedLines(verdict.unresolved));
  err.push(boardProvenanceLine(board));
  return { exit: exitForRefusal(verdict), out, err };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readInput(source) {
  if (source === '-') return readFileSync(0, 'utf8');
  return readFileSync(source, 'utf8');
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const v = argv[i + 1];
  return typeof v === 'string' && !v.startsWith('--') ? v : '';
}

function main(argv, env = process.env) {
  if (argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-widening-tells self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test\n' +
          'that never finished as a self-test that passed.\n',
      );
      return 1;
    }
    return code;
  }

  // ⭐ The board, and the argument that is NOT how you name it — both answered
  // before any input is read, so a refusal is about what the caller typed
  // rather than about a board nobody asked for (the sibling's argv order).
  //
  // ⛔ `--repo` is refused rather than honoured, and that is the whole reason it
  // now appears in this file. `check-clause2-carriers` deliberately reads no
  // positional board and points at `PM_SWEEP_REPO`; two entry points in the
  // same directory disagreeing about how a run is told its repo would be its
  // own trap, and #17217 names that trap in its own filing. One convention.
  if (argv.includes('--repo')) {
    console.error(
      'check-widening-tells: the board is not an argument. Set PM_SWEEP_REPO — e.g. ' +
        "PM_SWEEP_REPO=objectstack-ai/objectui node scripts/pm/check-widening-tells.mjs --declaration no --diff - " +
        '— which is the same convention `check-clause2-carriers.mjs` reads, and ⛔ never a second one.',
    );
    return EXIT_USAGE;
  }
  const board = resolveSweepRepo(env);
  if (!board.valid) {
    console.error(
      `check-widening-tells: ${board.source}=${JSON.stringify(board.repo)} is not an \`owner/repo\` ` +
        `(${SWEEP_REPO_SHAPE.source}). ⛔ Refused rather than silently replaced by the default — judging ` +
        'a diff against a board the caller did not name is how a clean reading about the wrong repo gets written.',
    );
    return EXIT_USAGE;
  }

  const declaration = argValue(argv, '--declaration');
  if (declaration === null || declaration === '') {
    console.error(
      'check-widening-tells: --declaration <yes|no> is required — this gate is a predicate about a ' +
        'DIFF AND a claim, and reading only one of them decides nothing. ⛔ Silence is not a clearance.',
    );
    return EXIT_USAGE;
  }
  if (declaration !== 'yes' && declaration !== 'no') {
    console.error(
      `check-widening-tells: --declaration ${JSON.stringify(declaration)} is neither \`yes\` nor \`no\`. ` +
        'Those two spellings are the whole set the clause-② reader recognises.',
    );
    return EXIT_USAGE;
  }

  const diffArg = argValue(argv, '--diff');
  const filesArg = argValue(argv, '--files');
  if ((diffArg === null) === (filesArg === null)) {
    console.error(
      'check-widening-tells: name exactly one input — `--diff <file|->` (a `git diff` body) or ' +
        '`--files <file|->` (the /pulls/N/files rows). Two inputs would be half one diff and half another.',
    );
    return EXIT_USAGE;
  }

  let files;
  try {
    if (diffArg !== null) {
      if (diffArg === '') throw new Error('--diff needs a file path, or `-` for stdin');
      files = splitUnifiedDiff(readInput(diffArg));
    } else {
      if (filesArg === '') throw new Error('--files needs a file path, or `-` for stdin');
      const doc = JSON.parse(readInput(filesArg));
      files = Array.isArray(doc) ? doc : Array.isArray(doc?.files) ? doc.files : null;
      if (!files) throw new Error('--files needs a JSON array of /pulls/N/files rows, or an object carrying one as `files`');
    }
  } catch (err) {
    console.error(`check-widening-tells: ${err.message}. ⛔ Not a reading of a narrow diff.`);
    return EXIT_USAGE;
  }

  const rendered = verdictLines({ declaration, files, board });
  for (const line of rendered.out) console.log(line);
  for (const line of rendered.err) console.error(line);
  return rendered.exit;
}

// ---------------------------------------------------------------------------
// Self-test — offline, and the fixtures are the shapes measured in the tree
// ---------------------------------------------------------------------------

/** A patch body from added lines starting at `start`, the shape the API sends. */
const patchOf = (start, ...lines) => [`@@ -${start},0 +${start},${lines.length} @@`, ...lines].join('\n');

const FILE_SCHEMA_KEY = {
  filename: 'packages/spec/src/kernel/manifest.zod.ts',
  status: 'modified',
  patch: patchOf(44, '+    telemetry: z.array(z.string()).optional()', ' ', '-    stale: z.string(),'),
};
const FILE_ENUM_MEMBER = {
  filename: 'packages/spec/src/kernel/plugin.zod.ts',
  status: 'modified',
  patch: patchOf(95, "+  'workflow',       // Business: long-running orchestration"),
};
const FILE_API_SURFACE = {
  filename: 'packages/spec/api-surface/kernel.json',
  status: 'modified',
  patch: patchOf(14, '+    "WorkflowPluginSchema (const)",'),
};
const FILE_REGISTRY = {
  filename: 'packages/spec/src/api/error-code-ledger.zod.ts',
  status: 'modified',
  patch: patchOf(140, "+    'WORKFLOW_STEP_FAILED',"),
};

// The two live instances of #17618, in the bytes the PRs actually pushed.
//
// ⭐ `FILE_REFINEMENT_SIGNATURE` is the `#16489` convention itself — the
// `(value, ctx: z.RefinementCtx)` signature this repo prescribes for an
// exported object-level refinement — so the fixture is the CLASS and not one
// example of it: every PR that adds a cross-field refusal pushes this shape.
const FILE_REFINEMENT_SIGNATURE = {
  filename: 'packages/spec/src/ui/dashboard.zod.ts',
  status: 'modified',
  patch: [
    '@@ -350,2 +353,8 @@',
    ' ',
    '+export function checkDashboardWidgetStageOrder(',
    '+  widget: { type?: unknown; options?: { stageOrder?: unknown } | null },',
    '+  ctx: z.RefinementCtx,',
    '+): void {',
    '+  const stageOrder = widget.options?.stageOrder;',
    '+  if (stageOrder === undefined) return;',
    ' ',
  ].join('\n'),
};
const FILE_CLOSED_SET_RESPELLING = {
  filename: 'packages/spec/src/system/cache.zod.ts',
  status: 'modified',
  patch: [
    '@@ -176,3 +194,6 @@',
    "   enabled: z.boolean().default(false).describe('Enable cache warmup'),",
    "-  strategy: z.enum(['eager', 'lazy', 'scheduled']).default('lazy')",
    "-    .describe('Warmup strategy: eager (at startup), lazy (on first access), scheduled (cron)'),",
    "+  strategy: z.enum(['eager', 'lazy'], {",
    "+    error: (issue) => (issue.input === 'scheduled' ? WARMUP_STRATEGY_SCHEDULED_RETIRED : undefined),",
    "+  }).default('lazy')",
    "+    .describe('Warmup strategy: eager (at startup), lazy (on first access)'),",
  ].join('\n'),
};

// The live instance of #17955, in the bytes PR #17954 actually pushed — the
// ADR-0087 retirement of `performance.schemaCacheTTL` on
// `SchemaLevelIsolationStrategy`, one rename with its tombstone in ONE change
// block.
//
// ⭐ The fixture is the CLASS and not one example of it: a tombstone is the
// AGENTS.md-mandated kit for removing an authorable spec key ("Removing an
// authorable spec key also requires a tombstone so the rejection itself carries
// the prescription"), so EVERY ADR-0087 key retirement and every rename that
// tombstones its old spelling pushes this shape.
const FILE_RETIREMENT_TOMBSTONE = {
  filename: 'packages/spec/src/system/tenant.zod.ts',
  status: 'modified',
  patch: [
    '@@ -442,7 +442,22 @@ export const SchemaLevelIsolationStrategySchema = lazySchema(() => z.object({',
    '     /**',
    '-     * Schema cache TTL in seconds',
    '-     */',
    "-    schemaCacheTTL: z.number().int().positive().default(3600).describe('Schema cache TTL'),",
    '+     * Schema cache TTL in seconds.',
    '+     *',
    '+     * Renamed from `schemaCacheTTL` (#15939 ruling A): the unit lived in this',
    '+     * JSDoc only, and `.describe()` — the text the reference pages publish —',
    '+     * carried none. Tombstoned rather than deleted because this nested object',
    '+     * is not `.strict()`.',
    '+     */',
    "+    schemaCacheTtlSeconds: z.number().int().positive().default(3600).describe('Schema cache TTL in seconds'),",
    '+    schemaCacheTTL: retiredKey(',
    "+      '`performance.schemaCacheTTL` was renamed to `schemaCacheTtlSeconds` on ' +",
    "+      '`SchemaLevelIsolationStrategy` in @objectstack/spec 17 — the unit of a duration-shaped ' +",
    "+      'number lives in the key name, not only in the describe prose.',",
    '+    ),',
    "   }).optional().describe('Performance settings'),",
    ' }));',
  ].join('\n'),
};

let selfTestReachedVerdict = false;

export function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    cases.push({ name, ok: Boolean(ok), detail });
  };
  const says = (s, frag) => typeof s === 'string' && s.includes(frag);
  const tells = (file) => tellsInFile(file);
  const at = (file) => tells(file).map((r) => `${r.file}:${r.line}`);

  // -- the patch reader ------------------------------------------------------
  battery('the patch reader: added lines, and the line numbers they carry');
  t('an empty patch reads as no added lines, never as an added line', addedLines('').length === 0 && addedLines(null).length === 0 && addedLines(undefined).length === 0);
  t('one added line carries the hunk header\'s start', addedLines('@@ -1,0 +7,1 @@\n+alpha')[0]?.line === 7);
  t('…and its text, with the `+` stripped', addedLines('@@ -1,0 +7,1 @@\n+alpha')[0]?.text === 'alpha');
  t('a context line advances the number by one', addedLines('@@ -1,2 +7,2 @@\n ctx\n+beta')[0]?.line === 8);
  t('⛔ a REMOVED line advances nothing — the classic off-by-one that points at the wrong line', addedLines('@@ -1,2 +7,1 @@\n-gone\n+beta')[0]?.line === 7);
  t('two additions after a removal keep counting from the same base', JSON.stringify(addedLines('@@ -1,3 +7,2 @@\n-gone\n+b1\n+b2').map((r) => r.line)) === '[7,8]');
  t('a second hunk RESETS to its own header rather than continuing', addedLines('@@ -1,1 +7,1 @@\n+a\n@@ -40,1 +60,1 @@\n+b')[1]?.line === 60);
  t('⛔ the `+++` file header is not an added line', addedLines('--- a/x\n+++ b/x\n@@ -1,0 +3,1 @@\n+real').length === 1);
  t('…and the one line it would have fabricated is the real one, at the right number', addedLines('--- a/x\n+++ b/x\n@@ -1,0 +3,1 @@\n+real')[0]?.line === 3);
  t('"\\ No newline at end of file" is not an added line', addedLines('@@ -1,1 +1,1 @@\n+x\n\\ No newline at end of file').length === 1);
  t('a line before any hunk header is ignored — there is no number to give it', addedLines('+orphan').length === 0);
  t('an added EMPTY line is still an added line', addedLines('@@ -1,0 +5,1 @@\n+')[0]?.text === '');
  t('a hunk header with no comma on the new side still reads', addedLines('@@ -1 +9 @@\n+solo')[0]?.line === 9);
  t('a removal-only patch yields nothing to judge', addedLines('@@ -1,2 +1,0 @@\n-a\n-b').length === 0);
  t('the trailing empty split element does not fabricate a line', addedLines('@@ -1,1 +1,1 @@\n+a\n').length === 1);
  t('a `diff --git` header line inside the body is skipped', addedLines('diff --git a/x b/x\n@@ -1,0 +2,1 @@\n+z').length === 1);
  t('mixed context/add/remove keeps every number right', JSON.stringify(addedLines('@@ -1,4 +10,4 @@\n ctx\n-old\n+new\n ctx2\n+tail').map((r) => r.line)) === '[11,13]');
  t('`patchLines` tags all three sides — the reading `addedLines` is a projection of', JSON.stringify(patchLines('@@ -1,3 +10,2 @@\n ctx\n-old\n+new').map((r) => r.kind)) === '["context","removed","added"]');
  t('⛔ a REMOVED line carries NO new-file number — it has no line the author can open', patchLines('@@ -1,3 +10,2 @@\n ctx\n-old\n+new')[1]?.line === null);
  t('…and every added line agrees with `addedLines`, so the two readers cannot drift', JSON.stringify(patchLines('@@ -1,4 +10,4 @@\n ctx\n-old\n+new\n ctx2\n+tail').filter((r) => r.kind === 'added').map((r) => r.line)) === '[11,13]');
  t('a second hunk gets its own index, so adjacency can never cross a boundary', patchLines('@@ -1,1 +7,1 @@\n+a\n@@ -40,1 +60,1 @@\n+b').map((r) => r.hunk).join(',') === '0,1');

  // -- the unified-diff splitter --------------------------------------------
  battery('the unified-diff splitter, for the local `git diff` path');
  const twoFiles = [
    'diff --git a/packages/spec/src/a.zod.ts b/packages/spec/src/a.zod.ts',
    'index 111..222 100644',
    '--- a/packages/spec/src/a.zod.ts',
    '+++ b/packages/spec/src/a.zod.ts',
    '@@ -1,0 +5,1 @@',
    '+  extra: z.string(),',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1,0 +1,1 @@',
    '+prose',
  ].join('\n');
  t('two files split into two rows', splitUnifiedDiff(twoFiles).length === 2);
  t('…named by their b-side path', splitUnifiedDiff(twoFiles)[0]?.filename === 'packages/spec/src/a.zod.ts');
  t('…each carrying its own hunk', addedLines(splitUnifiedDiff(twoFiles)[1]?.patch)[0]?.text === 'prose');
  t('an empty diff is no rows, never one row with nothing in it', splitUnifiedDiff('').length === 0 && splitUnifiedDiff('   ').length === 0);
  t('a new file is marked `added`', splitUnifiedDiff('diff --git a/x b/x\nnew file mode 100644\n@@ -0,0 +1,1 @@\n+a')[0]?.status === 'added');
  t('a deleted file is marked `removed`', splitUnifiedDiff('diff --git a/x b/x\ndeleted file mode 100644\n@@ -1,1 +0,0 @@\n-a')[0]?.status === 'removed');
  t('a rename takes the NEW name, which is the path a tell must be reported at', splitUnifiedDiff('diff --git a/x b/y\nsimilarity index 98%\nrename from x\nrename to y\n')[0]?.filename === 'y');
  t('a binary change yields `patch: null` — UNREAD, not empty', splitUnifiedDiff('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ')[0]?.patch === null);
  t('…and null is what `unreadFiles` counts as a gap when it is on a surface', unreadFiles([{ filename: 'packages/spec/api-surface/kernel.json', patch: null }]).length === 1);
  t('⛔ a file OFF every surface with no patch is not a gap — it decides nothing here', unreadFiles([{ filename: 'README.md', patch: null }]).length === 0);
  t('the local path and the API path produce the same verdict on the same bytes', JSON.stringify(wideningTells(splitUnifiedDiff(twoFiles)).map((r) => r.tell)) === '["T1"]');
  // `additions` is a COUNT THAT WAS TAKEN. The three states below are told
  // apart by what the diff SAYS, and conflating them is what let a binary
  // change to a tell surface read as clean.
  t('⛔ a binary row carries additions `null` — UNKNOWN, never a fabricated 0', splitUnifiedDiff('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ')[0]?.additions === null);
  t('…and the `GIT binary patch` spelling reads as UNKNOWN too', splitUnifiedDiff('diff --git a/i.png b/i.png\nGIT binary patch\nliteral 0\nHcmV?d00001')[0]?.additions === null);
  t('a MODE-ONLY change carries a real 0 — no hunk AND no binary marker is git saying nothing was added', splitUnifiedDiff('diff --git a/x b/x\nold mode 100644\nnew mode 100755')[0]?.additions === 0);
  t('a pure rename carries a real 0 for the same reason', splitUnifiedDiff('diff --git a/x b/y\nsimilarity index 100%\nrename from x\nrename to y')[0]?.additions === 0);

  // -- the local path composed, end to end ----------------------------------
  //
  // The two halves below were each pinned separately before, and the defect
  // lived exactly between them: `patch: null` was asserted on one fixture and
  // "null is a gap" on a DIFFERENT, hand-built row that carried no `additions`
  // at all — so nothing drove a real binary row through `unreadFiles`. These
  // cases compose the actual functions, in the order a caller calls them.
  battery('the local path composed: an unread diff is not a narrow diff');
  const composed = (diff) => wideningRefusal({ declaration: 'no', files: splitUnifiedDiff(diff) });
  const BINARY_ON_SURFACE = 'diff --git a/packages/spec/api-surface/kernel.json b/packages/spec/api-surface/kernel.json\nindex 111..222 100644\nBinary files a/packages/spec/api-surface/kernel.json and b/packages/spec/api-surface/kernel.json differ';
  t('⭐ a BINARY change to a tell surface reads INCOMPLETE, never clean', composed(BINARY_ON_SURFACE).state === 'incomplete');
  t('…and maps to exit 2, the one exit that must never be mistaken for 0', exitForRefusal(composed(BINARY_ON_SURFACE)) === EXIT_INCOMPLETE);
  t('…naming the file whose content could not be read', composed(BINARY_ON_SURFACE).gaps[0] === 'packages/spec/api-surface/kernel.json');
  t('⛔ but a binary change OFF every surface is clean — it decides nothing here', composed('diff --git a/docs/logo.png b/docs/logo.png\nBinary files a/docs/logo.png and b/docs/logo.png differ').state === 'clean');
  t('a MODE-ONLY change to a tell surface is clean — it really did add nothing', composed('diff --git a/packages/spec/api-surface/kernel.json b/packages/spec/api-surface/kernel.json\nold mode 100644\nnew mode 100755').state === 'clean');
  t('addedNothing: a MISSING count is never a zero', addedNothing({ filename: 'x', additions: null }) === false && addedNothing({ filename: 'x' }) === false);
  t('…while a count that WAS taken is one', addedNothing({ filename: 'x', additions: 0 }) === true && addedNothing({ filename: 'x', additions: 3 }) === false);

  // -- the surfaces ---------------------------------------------------------
  battery('the surfaces, imported rather than restated');
  t('the contract source surface is IMPORTED from SUSPECT_TIER_GLOBS, not spelled here', CONTRACT_SOURCE_SURFACES.some((s) => s.imported === 'SUSPECT_TIER_GLOBS'));
  t('…and it covers exactly what that table declares', SUSPECT_TIER_GLOBS.every((g) => CONTRACT_SOURCE_SURFACES.some((s) => s.glob === g.glob)));
  t('the published surface is DERIVED from REGEN_ARTIFACTS', PUBLISHED_SURFACES.length > 0 && PUBLISHED_SURFACES.every((s) => s.imported === 'REGEN_ARTIFACTS'));
  t('…so both api-surface artifacts reach it without a literal here', surfaceCovers(PUBLISHED_SURFACES, 'packages/spec/api-surface/kernel.json') && surfaceCovers(PUBLISHED_SURFACES, 'packages/spec/api-surface-signatures.json'));
  t('a spec source file is on the contract surface', surfaceCovers(CONTRACT_SOURCE_SURFACES, 'packages/spec/src/kernel/plugin.zod.ts'));
  t('⛔ a sibling directory that merely shares a prefix is not', !surfaceCovers(CONTRACT_SOURCE_SURFACES, 'packages/spec/src-legacy/plugin.zod.ts'));
  t('an api-surface file is NOT on the contract source surface — the two tells stay apart', !surfaceCovers(CONTRACT_SOURCE_SURFACES, 'packages/spec/api-surface/kernel.json'));
  t("the objectui mirror row is INERT in this repo's run", !surfaceCovers(CONTRACT_SOURCE_SURFACES, 'packages/types/src/zod/app.zod.ts', THIS_REPO));
  t('…and live when the run names objectui', surfaceCovers(CONTRACT_SOURCE_SURFACES, 'packages/types/src/zod/app.zod.ts', 'objectstack-ai/objectui'));
  t('a test file on the contract surface is not a contract source file', !isContractSourceFile('packages/spec/src/kernel/plugin.zod.test.ts') && !isContractSourceFile('packages/spec/src/x.spec.ts'));
  t('…and a plain source file is', isContractSourceFile('packages/spec/src/kernel/plugin.zod.ts'));

  // -- T1 --------------------------------------------------------------------
  battery('T1 — a new key on a Zod object schema');
  t('a new `key: z.…` line is a tell', tells(FILE_SCHEMA_KEY)[0]?.tell === 'T1');
  t('…reported at its file:line', at(FILE_SCHEMA_KEY)[0] === 'packages/spec/src/kernel/manifest.zod.ts:44');
  t('an optional-marked key reads too', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  slug?: z.string(),') }).length === 1);
  t('a quoted key reads too — a dotted hook name is a real spelling in this tree', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'record.beforeInsert': z.array(z.string()),") }).length === 1);
  t('a `*Schema` value reads — the measured non-`z.` vocabulary', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  label: I18nLabelSchema.optional(),') })[0]?.tell === 'T1');
  t('`retiredKey(` is in the VOCABULARY — 254 key lines in the tree take it — but a tombstone declares a key unwritable, so the row itself declines (#17955)', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  legacy: retiredKey('legacy'),") }).length === 0 && memberTellKind("  legacy: retiredKey('legacy'),", { onContractSource: true }) === 'T1');
  t('`strictObject(` reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  nested: strictObject({ a: z.string() }),') })[0]?.tell === 'T1');
  t('`lazySchema(` reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  deep: lazySchema(() => z.string()),') })[0]?.tell === 'T1');
  t('⛔ an object-literal boolean is NOT a schema key — 1,655 such lines exist and none is an accept-set member', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  enabled: true,') }).length === 0);
  t('⛔ nor a TypeScript type annotation', tells({ filename: 'packages/spec/src/a.ts', patch: patchOf(3, '+  name: string;') }).length === 0);
  t('⛔ nor a key added in a COMMENT', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  // future: z.string() — not yet') }).length === 0);
  t('⛔ nor the same line in a TEST file', tells({ filename: 'packages/spec/src/a.zod.test.ts', patch: patchOf(3, '+  extra: z.string(),') }).length === 0);
  t('⛔ nor the same line OUTSIDE the contract surface', tells({ filename: 'packages/runtime/src/a.ts', patch: patchOf(3, '+  extra: z.string(),') }).length === 0);
  t('a file whose only change is a REMOVED key yields no tell', tells({ filename: 'packages/spec/src/a.zod.ts', patch: '@@ -3,1 +3,0 @@\n-  gone: z.string(),' }).length === 0);

  // -- T2 --------------------------------------------------------------------
  battery('T2 — a new member of a closed set');
  t('a bare string element is a tell', tells(FILE_ENUM_MEMBER)[0]?.tell === 'T2');
  t('…reported at its file:line', at(FILE_ENUM_MEMBER)[0] === 'packages/spec/src/kernel/plugin.zod.ts:95');
  t('…with the trailing comment stripped off the quoted text', says(tells(FILE_ENUM_MEMBER)[0]?.text, "'workflow'"));
  t('a double-quoted element reads too', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  "workflow",') })[0]?.tell === 'T2');
  t('a re-written one-line `z.enum([…])` reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+export const K = z.enum(['a', 'b', 'c']);") })[0]?.tell === 'T2');
  t('a `z.union([` opener reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+const U = z.union([') })[0]?.tell === 'T2');
  t('a `z.discriminatedUnion(` opener reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+const D = z.discriminatedUnion('kind', [") })[0]?.tell === 'T2');
  t('a bare union ARM reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  WorkflowSchema,') })[0]?.tell === 'T2');
  t('⛔ a bare string in a COMMENT does not', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  // 'workflow',") }).length === 0);
  t('⛔ nor a bare string outside the contract surface', tells({ filename: 'apps/docs/x.ts', patch: patchOf(3, "+  'workflow',") }).length === 0);
  t('⛔ a REMOVED member is not a tell — the ruling is directional', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -3,1 +3,0 @@\n-  'legacy'," }).length === 0);
  t('T1 wins over T2 on a line that could read as both, so one line is never two rows', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  kind: z.enum(['a']),") }).length === 1);
  t('…and the row it produces is the key reading', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  kind: z.enum(['a']),") })[0]?.tell === 'T1');

  // -- #16822: the accidental variables ------------------------------------
  //
  // Both halves of the card, each with the evidence it declines on and the
  // evidence it refuses to invent. ⭐ The instrument first: the SAME string,
  // spelled two ways, used to read differently.
  battery('#16822 — the two accidental variables, and the evidence each one needs');
  const FRAGMENTS = [
    "'RETIRED (ADR-0049 enforce-or-remove) — `action` had two published faces whose '",
    "+ 'accept sets were DISJOINT and one of them EMPTY: this mirror admitted a node '",
    "+ 'or a list of nodes, while the twin declared an object with both members '",
    "+ 'required, which no JSON document can satisfy. The renderer read neither '",
    "+ 'face. There is NO replacement spelling and the capability was never '",
    "+ 'fulfilled. Raise the toast from the node itself and label its trigger '",
    "+ 'with `buttonLabel` / `buttonVariant`. See ADR-0049 and the retirement '",
    "+ 'playbook for the conversion.',",
  ];
  const proseArgument = (fragments) => ({
    filename: 'packages/spec/src/kernel/manifest.zod.ts',
    status: 'modified',
    patch: patchOf(83, '+  action: retirementTombstone(', ...fragments.map((f) => `+    ${f}`), '+  ),'),
  });
  const asWritten = proseArgument(FRAGMENTS);
  const respelled = {
    filename: 'packages/spec/src/kernel/manifest.zod.ts',
    status: 'modified',
    patch: patchOf(83, `+  action: retirementTombstone(${FRAGMENTS[0]}`, ...FRAGMENTS.slice(1).map((f) => `+    ${f}`), '+  ),'),
  };
  t('⭐ an 8-fragment prose ARGUMENT is not a closed-set member — its first fragment used to be the only tell', FRAGMENTS.length === 8 && tells(asWritten).length === 0);
  t('⭐ …and the IDENTICAL string with that fragment moved up onto the calling line reads the same — the accidental variable is gone', tells(respelled).length === tells(asWritten).length);
  t('a bare string whose NEXT line opens with `+ \'…\'` is a fragment, not an element', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'half a sentence '", "+  + 'and the rest',") }).length === 0);
  t('…and the other spelling, the operator left at the END of the line before', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'half a sentence ' +", "+  'and the rest',") }).length === 0);
  t('⛔ a bare string with NO continuation neighbour is STILL a tell — absence of evidence is not evidence', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'workflow',") })[0]?.tell === 'T2');
  t('⛔ a neighbour in a DIFFERENT hunk is not a neighbour — the hunk does not show the lines between', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -3,0 +3,1 @@\n+  'workflow'\n@@ -90,0 +90,1 @@\n+  + 'more prose'," })[0]?.line === 3);
  t('⛔ `++` is an increment, never a concatenation — it must not decline a real member', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'workflow',", '+  ++seen;') })[0]?.tell === 'T2');
  t('⛔ only the BARE-string shape is declined: a keyed prose head keeps its own reading', tells({ filename: 'packages/spec/src/api/error-code-ledger.zod.ts', patch: patchOf(140, "+    reason: 'Pre-gate synonym on the wire ' +", "+      'kept per #8211.',") })[0]?.tell === 'T4');
  const rewrite = (removed, added) => splitUnifiedDiff(['diff --git a/packages/spec/src/a.zod.ts b/packages/spec/src/a.zod.ts', '@@ -207,4 +207,4 @@', ` ${'/** doc */'}`, `-${removed}`, `+${added}`, '   ArmSchema,', ' ]);'].join('\n'))[0];
  t('⭐ an opener that RE-DECLARES the set the same hunk removed is not a tell — the constructor changed, no member did', tells(rewrite('export const X = z.union([', "export const X = z.discriminatedUnion('type', [")).length === 0);
  t('…and that is the card\'s own second instance, arm for arm', tells(rewrite('export const CRUDComponentSchema = z.union([', "export const CRUDComponentSchema = z.discriminatedUnion('type', [")).length === 0);
  t('⛔ but an ARM the rewrite ADDS still fires — the members were never the suppressed part', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -207,3 +207,4 @@\n-export const X = z.union([\n+export const X = z.discriminatedUnion('type', [\n+  NewlyAdmittedSchema,\n   ArmSchema," })[0]?.tell === 'T2');
  t('⛔ an opener with NO paired removal still fires — a brand-new closed set is exactly what T2 is for', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+export const X = z.discriminatedUnion('type', [") })[0]?.tell === 'T2');
  t('⛔ a DIFFERENT binding prefix is not the same declaration — and `export` added is itself a widening', tells(rewrite('const X = z.union([', 'export const X = z.union([')).length === 1);
  t('⛔ an opener carrying its members INLINE is not an opener-only line, so it is never suppressed', tells(rewrite('export const X = z.enum([', "export const X = z.enum(['a', 'b']);"))[0]?.tell === 'T2');
  t('⛔ a removed opener in ANOTHER hunk does not pair — the evidence must be where the reader can see it', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -3,1 +3,0 @@\n-export const X = z.union([\n@@ -90,0 +90,1 @@\n+export const X = z.discriminatedUnion('type', [" })[0]?.tell === 'T2');

  // -- #16943: the net member/key delta -------------------------------------
  //
  // Both live instances the card measured, each reduced to the shape that made
  // it fire and nothing else, plus the surplus case that is the whole
  // sensitivity guarantee. ⭐ The two fixtures below are the two RECORDED
  // pairs' own bytes (prose abridged, structure verbatim): PR #16941 on a form
  // `description:` value, PR #16968 on a Zod key whose `.describe()` moved.
  battery('#16943 — the net member/key delta: a replaced line is not a net addition');
  const LIVE_T2_PAIR = {
    filename: 'packages/spec/src/security/permission.form.ts',
    status: 'modified',
    patch: [
      '@@ -21,7 +27,7 @@ export const permissionForm = defineForm({',
      '     {',
      "       label: 'Identity',",
      '       description:',
      "-        'Permission Sets stack on top of a Profile to grant additional access. …',",
      "+        'Permission sets are the only capability container: a user gets the union of every set they hold. …',",
      '       columns: 2,',
      '       fields: [',
    ].join('\n'),
  };
  const LIVE_T1_PAIR = {
    filename: 'packages/spec/src/ui/dashboard.zod.ts',
    status: 'modified',
    patch: [
      '@@ -800,8 +800,29 @@ export const GlobalFilterSchema = lazySchema(() => strictObject({',
      ' ',
      '-  /** Field name to filter on */',
      "-  field: z.string().describe('Field name to filter on'),",
      '+  /**',
      '+   * Field name to filter on — at the authoring layer it resolves against',
      "+   * the object behind each bound widget's dataset (`dataset.object`).",
      '+   */',
      "+  field: z.string().describe('Field name to filter on — at the authoring layer it resolves …'),",
      ' ',
    ].join('\n'),
  };
  t('⭐ the live T2 pair — a `description:` VALUE replaced in place is not a new member of a closed set', tells(LIVE_T2_PAIR).length === 0);
  t('⭐ the live T1 pair — a key whose `.describe()` was rewritten is not a new key on the schema', tells(LIVE_T1_PAIR).length === 0);
  t('…and the two together read CLEAN end to end, which is the exit code the card could not reach', wideningRefusal({ declaration: 'no', files: [LIVE_T2_PAIR, LIVE_T1_PAIR] }).state === 'clean');
  const surplus = {
    filename: 'packages/spec/src/kernel/plugin.zod.ts',
    status: 'modified',
    patch: "@@ -95,3 +95,4 @@\n   'core',\n-  'legacy',\n+  'legacy_renamed',\n+  'workflow',\n   'ui',",
  };
  t('⭐ a block that removes ONE member and adds TWO reports exactly one — the surplus is the net addition', tells(surplus).length === 1);
  t('…and the row it reports is the line no removal paid for', at(surplus)[0] === 'packages/spec/src/kernel/plugin.zod.ts:97');
  t('⛔ a member added with NO removal in its block still fires — a genuine addition has nothing to pay with', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'workflow',") })[0]?.tell === 'T2');
  t('⛔ a removal in a DIFFERENT change block does not pay — a context line between two edits means two edits', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -95,4 +95,4 @@\n-  'legacy',\n   'core',\n   'ui',\n+  'workflow'," }).length === 1);
  t('⛔ nor a removal in another HUNK — the file\'s lines between them are not shown', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -95,1 +95,0 @@\n-  'legacy',\n@@ -300,0 +299,1 @@\n+  'workflow'," }).length === 1);
  t('⛔ the budget is per KIND — a removed closed-set member does not pay for an added schema KEY', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -95,2 +95,2 @@\n-  'legacy',\n+  extra: z.string()," })[0]?.tell === 'T1');
  t('⛔ a removed COMMENT pays for nothing — it was never a member', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -95,2 +95,2 @@\n-  // 'legacy',\n+  'workflow'," }).length === 1);
  t('⛔ #16822 is read on the OLD side too: a removed prose FRAGMENT pays for nothing', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -95,3 +95,2 @@\n-  'half a sentence '\n-  + 'and the rest',\n+  'workflow'," }).length === 1);
  t('⛔ an OPENER is not a member: a `z.union([` → `z.enum([` rewrite cannot pay for the arm it adds', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -207,3 +207,4 @@\n-export const X = z.union([\n+export const X = z.enum([\n+  'workflow',\n   ArmSchema," }).length === 1);
  t('⭐ FILE_SCHEMA_KEY still fires — its removal sits across a context line, so it is a different edit', at(FILE_SCHEMA_KEY)[0] === 'packages/spec/src/kernel/manifest.zod.ts:44');
  t('a replaced REGISTRY row is not a new registration — the T4 half of the same root cause', tells({ filename: 'packages/spec/src/api/error-code-ledger.zod.ts', patch: "@@ -140,2 +140,2 @@\n-    reason: 'the wording this row carried before',\n+    reason: 'the wording it carries now'," }).length === 0);
  t('…and a replaced row in a published listing is not a new export — the T3 half', tells({ filename: 'packages/spec/api-surface/kernel.json', patch: '@@ -14,2 +14,2 @@\n-    "PluginSchema (const)",\n+    "PluginSchema (type)",' }).length === 0);
  t('⛔ but a published listing that removes one row and adds two still reports the surplus', tells({ filename: 'packages/spec/api-surface/kernel.json', patch: '@@ -14,3 +14,4 @@\n-    "Gone (const)",\n+    "Renamed (const)",\n+    "WorkflowPluginSchema (const)",\n     "Kept (const)",' }).length === 1);
  // ⚠️ The quiet direction, asserted rather than described so the next reader
  // meets it here instead of discovering it. A one-for-one member RENAME inside
  // an existing set now declines: the block's member count did not move, and
  // nothing in the hunk distinguishes a renamed member from a reworded string.
  // What still catches it: `check:api-surface` on any exported type it moves,
  // `check:authorable-surface` on any authorable key, and the ADR-0087
  // registries — all three of which a rename must move and a rewording cannot.
  t('⚠️ QUIET DIRECTION — a one-for-one member rename declines; this case exists so the cost is read, not discovered', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -95,2 +95,2 @@\n-  'legacy',\n+  'legacy_renamed'," }).length === 0);
  t('`changeBlocks` splits on a context line — two edits, never one replacement', changeBlocks(patchLines("@@ -95,4 +95,4 @@\n-  'a',\n   ctx\n+  'b',")).length === 2);
  t('…and never spans a hunk boundary', changeBlocks(patchLines("@@ -95,1 +95,0 @@\n-  'a',\n@@ -300,0 +299,1 @@\n+  'b',")).length === 2);
  t('…while one removed run and its added run are ONE block', changeBlocks(patchLines("@@ -95,3 +95,3 @@\n-  'a',\n-  'b',\n+  'c',")).length === 1);
  t('`memberTellKind` reads a schema key as T1 and a bare element as T2 on the contract surface', memberTellKind('  extra: z.string(),', { onContractSource: true }) === 'T1' && memberTellKind("  'workflow',", { onContractSource: true }) === 'T2');
  t('⛔ …and an OPENER as neither — an opener-only line declares no member', memberTellKind('export const X = z.union([', { onContractSource: true }) === null);
  t('⛔ …and nothing at all off every surface', memberTellKind('  extra: z.string(),', {}) === null);

  // -- #17618: a parameter is not a key -------------------------------------
  //
  // Two live pairs, both measured before the reading was written: PR #16949's
  // sibling #17616 (the parameter case, report-only at exit 0) and PR #17638
  // (the re-spelling case, exit 4 — a hard block on a correct, reviewed,
  // narrowing PR whose only sanctioned clear was to declare a widening that did
  // not happen). Both declines are bracketed by the firing controls below,
  // because a reading that can only suppress is untestable in the direction
  // that matters.
  battery('#17618 — a PARAMETER is not a key, and a closed set RE-SPELLED around fewer values is not a new one');
  t('⭐ the live parameter pair — `ctx: z.RefinementCtx` in the `#16489` refinement signature reads no tell', tells(FILE_REFINEMENT_SIGNATURE).length === 0);
  t('⭐ the live re-spelling pair — an in-shape key whose inline enum LOST a member reads no tell', tells(FILE_CLOSED_SET_RESPELLING).length === 0);
  t('…and the two together read CLEAN end to end, which is the exit code neither pair could reach', wideningRefusal({ declaration: 'no', files: [FILE_REFINEMENT_SIGNATURE, FILE_CLOSED_SET_RESPELLING] }).state === 'clean');
  t('⛔ CONTROL — a genuinely new key on a shape still tells, with its own file:line', at(FILE_SCHEMA_KEY)[0] === 'packages/spec/src/kernel/manifest.zod.ts:44');
  t('⛔ CONTROL — an inline enum WIDENED in place still tells: no per-member line exists for T2 to read', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -95,2 +95,2 @@\n-  kind: z.enum(['a', 'b']),\n+  kind: z.enum(['a', 'b', 'c'])," }).length === 1);
  t('⛔ CONTROL — a DIFFERENT key carrying a subset set pays nothing: the removed key is not this one', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -95,2 +95,2 @@\n-  gone: z.enum(['a', 'b']),\n+  added: z.enum(['a'])," }).length === 1);
  t('⛔ CONTROL — a set whose list opens on a LATER line is unreadable, so its key keeps telling', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -95,3 +95,4 @@\n-  strategy: z.enum(['a', 'b']),\n+  strategy: z.enum([\n+    'a',\n+  ])," }).some((r) => r.tell === 'T1'));
  t('⛔ CONTROL — a real key added AFTER the parameter list closes still tells: the reading does not leak past the `)`', tells({ filename: 'packages/spec/src/a.zod.ts', patch: ['@@ -10,1 +10,7 @@', '+export function check(', '+  value: unknown,', '+  ctx: z.RefinementCtx,', '+): void {}', '+export const S = z.object({', '+  extra: z.string(),', '+});'].join('\n') }).length === 1);
  t('…and the row it reports is the shape member, never the parameter', tells({ filename: 'packages/spec/src/a.zod.ts', patch: ['@@ -10,1 +10,7 @@', '+export function check(', '+  value: unknown,', '+  ctx: z.RefinementCtx,', '+): void {}', '+export const S = z.object({', '+  extra: z.string(),', '+});'].join('\n') })[0]?.text === 'extra: z.string(),');
  const PARAM_SIDE = [
    { text: 'export function checkThing(', hunk: 0 },
    { text: '  value: unknown,', hunk: 0 },
    { text: '  ctx: z.RefinementCtx,', hunk: 0 },
  ];
  const SHAPE_SIDE = [
    { text: 'export const S = lazySchema(() => z.object({', hunk: 0 },
    { text: "  extra: z.string().describe('prose with an unbalanced ( in it'),", hunk: 0 },
    { text: '  more: z.string(),', hunk: 0 },
  ];
  t('`enclosingDelimiter` names the innermost OPEN bracket a hunk shows', enclosingDelimiter(PARAM_SIDE, 2)?.opener === '(' && enclosingDelimiter(SHAPE_SIDE, 2)?.opener === '{');
  t('⛔ …and a `(` inside a STRING is not a delimiter — a shape member stays a shape member', inParameterList(SHAPE_SIDE, 2) === false);
  t('a parameter list is read from its declaration head', inParameterList(PARAM_SIDE, 2) === true);
  t('…including an arrow handed straight to a call', inParameterList([{ text: 'const S = z.object({}).superRefine((', hunk: 0 }, { text: '  ctx: z.RefinementCtx,', hunk: 0 }], 1) === true);
  t('…and one assigned to a binding', inParameterList([{ text: 'const check = (', hunk: 0 }, { text: '  ctx: z.RefinementCtx,', hunk: 0 }], 1) === true);
  t('⛔ but NOT a method shorthand — an unrecognised head leaves the tell firing, which is the loud direction', inParameterList([{ text: '  async runThing(', hunk: 0 }, { text: '  ctx: z.RefinementCtx,', hunk: 0 }], 1) === false);
  t('⛔ a closer with an empty stack is UNDERFLOW — the hunk began inside something it never showed', enclosingDelimiter([{ text: '  }),', hunk: 0 }, { text: '  extra: z.string(),', hunk: 0 }], 1) === null);
  t('⛔ an unterminated string literal answers `null`, never a carried-over guess', enclosingDelimiter([{ text: "const s = 'opens here", hunk: 0 }, { text: '  extra: z.string(),', hunk: 0 }], 1) === null);
  t('⛔ and no reading crosses a HUNK boundary', inParameterList([{ text: 'export function checkThing(', hunk: 0 }, { text: '  ctx: z.RefinementCtx,', hunk: 1 }], 1) === false);
  t('`keyedClosedSetMembers` reads the key and the inline members', JSON.stringify(keyedClosedSetMembers("  strategy: z.enum(['eager', 'lazy'], {")) === JSON.stringify({ key: 'strategy', members: ["'eager'", "'lazy'"] }));
  t('⛔ …and answers `null` when the list does not close on the line', keyedClosedSetMembers('  strategy: z.enum([') === null);
  t('⛔ …and `null` for a value that declares no closed set at all', keyedClosedSetMembers('  strategy: z.string(),') === null);
  t('`respellsExistingClosedSetKey` needs the SAME key and a set that did not grow', respellsExistingClosedSetKey("  strategy: z.enum(['eager', 'lazy'], {", ["  strategy: z.enum(['eager', 'lazy', 'scheduled']).default('lazy')"]) === true);
  t('⛔ …and declines a gained member', respellsExistingClosedSetKey("  kind: z.enum(['a', 'b', 'c']),", ["  kind: z.enum(['a', 'b']),"]) === false);
  t('⛔ …and declines another key\'s removal', respellsExistingClosedSetKey("  added: z.enum(['a']),", ["  gone: z.enum(['a', 'b']),"]) === false);

  // -- #17300: the retirement ledger ----------------------------------------
  //
  // The card's population is five PRs measured in one lane in one day, every
  // firing a false positive. Four of them (#17342, #17439, #17463, #17473) are
  // T1 and #16943's net delta already clears them; the three cases below pin
  // that so it cannot silently regress. The fifth, PR #17298, is the one that
  // still refused at exit 4 — three T2 rows on a retirement, two generated into
  // `<os-generated retired-key:18>` and ONE hand-typed into `step18.conversionIds`
  // — and every fixture here is taken from that diff rather than invented.
  //
  // ⭐ Read the FIRING half first. A reading that can only suppress is
  // untestable in the direction that matters, so the decline is bracketed on
  // every side: the same row with no licence, a licence for a neighbouring row,
  // a licence spent on the wrong file, a genuine member added beside a licensed
  // one, and the ordering against #16943's budget.
  battery('#17300 — the retirement ledger is a record of REMOVALS, not a set that gained a value');
  const LEDGER = 'packages/spec/src/migrations/registry.ts';
  const LEDGER_KEY_ENTRY = 'packages/spec/src/migrations/entries/retired-keys/18.ui__ListView__pageName.ts';
  const LEDGER_DEF_ENTRY = 'packages/spec/src/migrations/entries/retired-defs/18.api__HandlerStatus.ts';
  const CONVERSION_TABLE = 'packages/spec/src/conversions/registry.ts';
  // PR #17298's own rows, at their own lines on that head.
  const RETIRED_KEY_ROW = { filename: LEDGER, status: 'modified', patch: patchOf(12837, "+    'ui/ListView:pageName',") };
  const RETIRED_DEF_ROW = { filename: LEDGER, status: 'modified', patch: patchOf(13540, "+    'api/HandlerStatus',") };
  const CONVERSION_ID_ROW = { filename: LEDGER, status: 'modified', patch: patchOf(5443, "+    'view-page-mount-removed',") };
  const KEY_ENTRY_FILE = { filename: LEDGER_KEY_ENTRY, status: 'added', patch: patchOf(13, "+export const entry = 'ui/ListView:pageName';") };
  const DEF_ENTRY_FILE = { filename: LEDGER_DEF_ENTRY, status: 'added', patch: patchOf(9, "+export const entry = 'api/HandlerStatus';") };
  const CONVERSION_REGISTRATION = { filename: CONVERSION_TABLE, status: 'modified', patch: patchOf(4820, "+  id: 'view-page-mount-removed',") };
  const rowsFor = (...files) => wideningTells(files);

  // -- the firing half: what a licence must NOT buy --------------------------
  t('⛔ a ledger row whose entry file is NOT in this diff still fires — a licence is minted or it is absent', rowsFor(RETIRED_KEY_ROW)[0]?.tell === 'T2');
  t('…at its own file:line, so the seat is told which row it is', rowsFor(RETIRED_KEY_ROW)[0] && `${rowsFor(RETIRED_KEY_ROW)[0].file}:${rowsFor(RETIRED_KEY_ROW)[0].line}` === `${LEDGER}:12837`);
  t('⛔ nor does an entry file for a NEIGHBOURING row license this one — the licence is exact string identity', rowsFor(RETIRED_KEY_ROW, { filename: 'packages/spec/src/migrations/entries/retired-keys/18.ui__ListView__virtualScroll.ts', status: 'added', patch: patchOf(13, "+export const entry = 'ui/ListView:virtualScroll';") }).length === 1);
  t('⛔ nor a conversion registration for a DIFFERENT id', rowsFor(CONVERSION_ID_ROW, { filename: CONVERSION_TABLE, status: 'modified', patch: patchOf(4820, "+  id: 'some-other-conversion',") }).length === 1);
  t('⛔ a licence clears a row in the LEDGER table and nowhere else — the same string on another contract file still fires', rowsFor({ filename: 'packages/spec/src/ui/view.zod.ts', status: 'modified', patch: patchOf(300, "+    'ui/ListView:pageName',") }, KEY_ENTRY_FILE).length === 1);
  t('⛔ a genuinely new member added BESIDE a licensed row still fires, and it is the row reported', rowsFor({ filename: LEDGER, status: 'modified', patch: "@@ -12837,0 +12837,2 @@\n+    'ui/ListView:pageName',\n+    'workflow'," }, KEY_ENTRY_FILE).length === 1);
  t('…named by its own line, never the licensed one', rowsFor({ filename: LEDGER, status: 'modified', patch: "@@ -12837,0 +12837,2 @@\n+    'ui/ListView:pageName',\n+    'workflow'," }, KEY_ENTRY_FILE)[0]?.line === 12838);
  t('⭐ the licence is read AFTER #16943\'s budget: a removal pays for the tombstone, so the genuine member has nothing left to pay with', rowsFor({ filename: LEDGER, status: 'modified', patch: "@@ -12837,1 +12837,2 @@\n-    'legacy-thing',\n+    'ui/ListView:pageName',\n+    'workflow'," }, KEY_ENTRY_FILE).length === 1);
  t('⛔ an `export const entry` OUTSIDE the entries directory mints nothing', rowsFor(RETIRED_KEY_ROW, { filename: 'packages/spec/src/ui/view.zod.ts', status: 'modified', patch: patchOf(13, "+export const entry = 'ui/ListView:pageName';") }).length === 1);
  t('⛔ a REMOVED entry declaration mints nothing — only an added line is evidence', rowsFor(RETIRED_KEY_ROW, { filename: LEDGER_KEY_ENTRY, status: 'modified', patch: "@@ -13,1 +13,0 @@\n-export const entry = 'ui/ListView:pageName';" }).length === 1);
  t('⛔ `tellsInFile` alone licenses nothing — an unread licence is never a granted one', tellsInFile(RETIRED_KEY_ROW).length === 1);
  t('⛔ and a licence never reaches a T1 key: the same string as a schema property still tells', rowsFor({ filename: LEDGER, status: 'modified', patch: patchOf(400, '+  pageName: z.string(),') }, { filename: LEDGER_KEY_ENTRY, status: 'added', patch: patchOf(13, "+export const entry = 'pageName';") })[0]?.tell === 'T1');

  // -- the declining half: PR #17298's three rows ----------------------------
  t('⭐ a generated retired-KEY row whose entry file this diff adds is not a new member', rowsFor(RETIRED_KEY_ROW, KEY_ENTRY_FILE).length === 0);
  t('⭐ …the retired-DEF table reads the same way, from the same declaration', rowsFor(RETIRED_DEF_ROW, DEF_ENTRY_FILE).length === 0);
  t('⭐ …and the HAND-MAINTAINED `conversionIds` row, which no region marker could ever have covered', rowsFor(CONVERSION_ID_ROW, CONVERSION_REGISTRATION).length === 0);
  t('⭐ PR #17298\'s three rows together read CLEAN — the exit code a correct `Clause-②: no` could not reach', wideningRefusal({ declaration: 'no', files: [RETIRED_KEY_ROW, CONVERSION_ID_ROW, KEY_ENTRY_FILE, CONVERSION_REGISTRATION] }).state === 'clean');
  t('`ledgerRowLicences` reads BOTH input surfaces into one set', (() => { const s = ledgerRowLicences([KEY_ENTRY_FILE, CONVERSION_REGISTRATION]); return s.has('ui/ListView:pageName') && s.has('view-page-mount-removed') && s.size === 2; })());
  t('…and mints nothing from a listing that carries neither', ledgerRowLicences([RETIRED_KEY_ROW]).size === 0);
  t('`bareElementValue` reads the row T2 fired on, not a second spelling of it', bareElementValue("    'ui/ListView:pageName',") === 'ui/ListView:pageName' && bareElementValue('  pageName: z.string(),') === null);

  // -- the four T1 instances #16943 already cleared, pinned so they stay clear
  t('⭐ #17463 — a key whose regex is BYTE-IDENTICAL across the pair is not a new key', tells({ filename: 'packages/spec/src/kernel/plugin.zod.ts', status: 'modified', patch: "@@ -212,1 +212,1 @@\n-  version: z.string().regex(SEMVER).optional().describe('Semantic Version'),\n+  version: z.string().regex(SEMVER).optional().describe('Version: major.minor.patch, …')," }).length === 0);
  t('⭐ #17473 — a `z.unknown()` whose `.describe()` merely wrapped onto its own line is not a new key', tells({ filename: 'packages/spec/src/ui/component.zod.ts', status: 'modified', patch: "@@ -2583,1 +2583,2 @@\n-  exportOptions: z.unknown().optional().describe('Export config ({ formats, streaming })'),\n+  exportOptions: z.unknown().optional()\n+    .describe('Export config ({ formats, streaming })')," }).length === 0);
  t('⭐ #17439 — a re-declaration that NARROWS (`z.unknown()` → `z.array(…)`) is not a new key either', tells({ filename: 'packages/spec/src/ui/component.zod.ts', status: 'modified', patch: "@@ -2525,1 +2525,1 @@\n-  sort: z.unknown().optional().describe('Initial sort (array of { field, order })'),\n+  sort: z.array(SortItemSchema).optional()," }).length === 0);
  t('⛔ …while the SAME key removed in one hunk and added in another still fires — no reading crosses that boundary', tells({ filename: 'packages/spec/src/ui/component.zod.ts', status: 'modified', patch: "@@ -2525,1 +2525,0 @@\n-  sort: z.unknown().optional(),\n@@ -2894,0 +2893,1 @@\n+  sort: z.array(SortItemSchema).optional()," }).length === 1);

  // -- the declared rows still exist -----------------------------------------
  t('every ledger-input row names a path in THIS tree — a renamed input must red here, not go quiet', LEDGER_INPUT_SURFACES.filter((s) => s.repo === THIS_REPO).every((s) => existsSync(new URL(s.glob.replace(/\/\*+$/, ''), `file://${ROOT}`))), LEDGER_INPUT_SURFACES.filter((s) => !existsSync(new URL(s.glob.replace(/\/\*+$/, ''), `file://${ROOT}`))).map((s) => s.glob).join(', '));
  t('all three roles are declared, and each exactly once — a missing role would silently license nothing', ['table', 'entry', 'conversion'].every((r) => LEDGER_INPUT_SURFACES.filter((s) => s.role === r).length === 1));
  t('every ledger-input row carries a `why` and the repo it applies to', LEDGER_INPUT_SURFACES.every((s) => typeof s.why === 'string' && s.why.length > 10 && typeof s.repo === 'string' && s.repo.includes('/')));
  t('`ledgerSurface` answers for this repo and is inert for another board', ledgerSurface('table')?.glob === LEDGER && ledgerSurface('table', 'objectstack-ai/objectui') === null);

  // -- #17955: a tombstone DECLARES a key unwritable -------------------------
  //
  // `retiredKey()` returns `z.never(…).optional()`, so the line it is written on
  // makes the accept set strictly NARROWER: the key's `z.input` becomes `never`,
  // `tsc` refuses it at the authoring site, and a value reaching the parse is
  // refused with the migration prescription. There is no spelling an author
  // "may now write" — there is one they may no longer write.
  //
  // ⭐ Read the FIRING half first, the way #17300's battery is ordered: a
  // reading that can only suppress is untestable in the direction that matters,
  // so the decline is bracketed on every side — a genuine key added beside a
  // tombstone, a value that merely MENTIONS the helper, the same shape on a
  // registry surface and off the contract surface entirely, and the un-retiring
  // direction the removed side must not pay for.
  battery('#17955 — a `retiredKey()` tombstone declares a key UNWRITABLE, and never adds a spelling');
  const TOMBSTONE_FILE = 'packages/spec/src/a.zod.ts';
  const tombstoneTells = (...lines) => tells({ filename: TOMBSTONE_FILE, status: 'modified', patch: patchOf(30, ...lines) });

  // -- the firing half: what a tombstone must NOT buy ------------------------
  t('⛔ a genuinely new key added BESIDE a tombstone still fires — the tombstone buys nothing for its neighbour', tombstoneTells("+  legacy: retiredKey('gone'),", '+  extra: z.string(),').length === 1);
  t('…and the row it reports is the genuine key, never the tombstone', tombstoneTells("+  legacy: retiredKey('gone'),", '+  extra: z.string(),')[0]?.text === 'extra: z.string(),');
  t('⛔ a value that merely MENTIONS the helper is not a tombstone — it must OPEN it', tombstoneTells("+  legacy: z.string().or(retiredKey('gone')),").length === 1);
  t('⛔ nor is a key whose value opens a DIFFERENT helper that ends in the same word', tombstoneTells("+  legacy: buildRetiredKey('gone'),").length === 0 && memberTellKind("  legacy: buildRetiredKey('gone'),", { onContractSource: true }) === null);
  // ⭐ OPENING the call is not enough — the value must BE the call. A chained
  // arm puts a writable spelling back on the key (`retiredKey(…)` is
  // `z.never(…).optional()`, but `.or(z.string())` is not), which is T1's
  // sentence exactly, so these three fire with the tombstone's own file:line.
  t('⛔ a live arm CHAINED onto the helper is not a tombstone — `.or()` leaves the key writable, so it fires', tombstoneTells("+  legacy: retiredKey('gone').or(z.string()),")[0]?.tell === 'T1');
  t('⛔ …and `.catch()` reads the same way — a default is a spelling an author may now write', tombstoneTells("+  legacy: retiredKey('gone').catch(undefined),")[0]?.tell === 'T1');
  t('⛔ …nor does a tombstone cover a SECOND key spelled after it on the same line', tombstoneTells("+  legacy: retiredKey('gone'), extra: z.string(),")[0]?.tell === 'T1');
  t('⛔ a tombstone-shaped line on a declared REGISTRY is read as a registration first, and still fires', tells({ filename: 'packages/spec/src/api/error-code-ledger.zod.ts', status: 'modified', patch: patchOf(140, "+    legacy: retiredKey('gone'),") })[0]?.tell === 'T4');
  t('⭐ CONTROL — un-retiring FIRES: a removed tombstone buys nothing, so the key becoming writable again is reported', tells({ filename: TOMBSTONE_FILE, status: 'modified', patch: "@@ -30,1 +30,1 @@\n-  legacy: retiredKey('gone'),\n+  legacy: z.string()," }).length === 1);
  t('⛔ CONTROL — a genuinely new key still fires with its own file:line', at(FILE_SCHEMA_KEY)[0] === 'packages/spec/src/kernel/manifest.zod.ts:44');

  // -- the declining half: PR #17954's one row -------------------------------
  t('⭐ the live pair — the rename and its tombstone in one change block reads no tell', tells(FILE_RETIREMENT_TOMBSTONE).length === 0);
  t('⭐ …and reads CLEAN end to end, which is the exit code a correct `Clause-②: no` could not reach', wideningRefusal({ declaration: 'no', files: [FILE_RETIREMENT_TOMBSTONE] }).state === 'clean');
  t('⭐ a LONE tombstone with no paired removal declines too — a key declared unwritable needs no budget', tombstoneTells("+  legacy: retiredKey(").length === 0);
  t('⭐ the tombstone never SPENDS the budget, so the order of the two added lines cannot decide the verdict', tells({ filename: TOMBSTONE_FILE, status: 'modified', patch: "@@ -30,1 +30,2 @@\n-  schemaCacheTTL: z.number(),\n+  schemaCacheTTL: retiredKey('x'),\n+  schemaCacheTtlSeconds: z.number()," }).length === 0);
  t('…and the mirror order reads the same — the rename first, the tombstone second', tells({ filename: TOMBSTONE_FILE, status: 'modified', patch: "@@ -30,1 +30,2 @@\n-  schemaCacheTTL: z.number(),\n+  schemaCacheTtlSeconds: z.number(),\n+  schemaCacheTTL: retiredKey('x')," }).length === 0);
  t('⛔ …but a THIRD genuine key in that block still has nothing to pay with, and fires', tells({ filename: TOMBSTONE_FILE, status: 'modified', patch: "@@ -30,1 +30,3 @@\n-  schemaCacheTTL: z.number(),\n+  schemaCacheTtlSeconds: z.number(),\n+  schemaCacheTTL: retiredKey('x'),\n+  brandNew: z.string()," })[0]?.text === 'brandNew: z.string(),');

  // -- the reader itself -----------------------------------------------------
  t('`declaresUnwritableKey` reads a key whose value opens the helper', declaresUnwritableKey("  legacy: retiredKey('gone'),") === true);
  t('…in every key spelling `SCHEMA_PROPERTY` admits — quoted, and optional-marked', declaresUnwritableKey("  'a.b': retiredKey(") === true && declaresUnwritableKey('  legacy?: retiredKey(') === true);
  t('⛔ …and declines a value that is not the helper', declaresUnwritableKey('  legacy: z.string(),') === false);
  t('⛔ …a bare call that names no key — a tombstone is a PROPERTY, not an expression', declaresUnwritableKey("  retiredKey('gone'),") === false);
  t('⛔ …and the same text in a COMMENT', declaresUnwritableKey("  // legacy: retiredKey('gone'),") === false);
  t('⛔ …and a value that OPENS the call but chains onto its result — the value must BE the call and nothing after it', declaresUnwritableKey("  legacy: retiredKey('gone').or(z.string()),") === false && declaresUnwritableKey("  legacy: retiredKey('gone').catch(undefined),") === false);
  t('⭐ …while BOTH spellings this tree actually uses still read as tombstones — 76 close the call on the key line, 178 do not', declaresUnwritableKey("  legacy: retiredKey('gone'),") === true && declaresUnwritableKey('  legacy: retiredKey(') === true);
  t('…a trailing comment is not a chained arm, on either spelling', declaresUnwritableKey("  legacy: retiredKey('gone'), // ADR-0087") === true && declaresUnwritableKey('  legacy: retiredKey( // the prescription is below') === true);
  t('…and a prescription that closes its OWN parens on the key line is still the call and nothing after it', declaresUnwritableKey("  legacy: retiredKey(useInstead('x')),") === true && declaresUnwritableKey('  legacy: retiredKey(LEGACY_PRESCRIPTION),') === true);
  t('⛔ …but a paren inside the prescription STRING cannot close the call early and let a chain through', declaresUnwritableKey("  legacy: retiredKey('call foo(bar) instead'),") === true && declaresUnwritableKey("  legacy: retiredKey('call foo(bar) instead').or(z.string()),") === false);
  // ⭐ The landed shape a literal reading of "nothing may follow `retiredKey(`"
  // re-breaks: the prescription helper's own ARGUMENTS continue on the next
  // line, so the key line ends INSIDE the argument list rather than at the open
  // paren. 30 of this tree's 254 judged tombstones are spelled this way, all in
  // `packages/spec/src/data/driver.zod.ts`, and each one fires T1 again — the
  // very false positive this reading exists to remove — if this case weakens.
  t('⭐ a prescription helper whose ARGUMENTS continue on the next line is still a tombstone — 30 landed lines take this shape', declaresUnwritableKey("  create: retiredKey(capRemoved('create',") === true);
  t('⭐ the vocabulary is INTACT — `memberTellKind` still classifies a tombstone as a key of kind T1, so both sides of the budget read one question', memberTellKind("  legacy: retiredKey('gone'),", { onContractSource: true }) === 'T1');

  // -- #18488: the tail this reader cannot READ is not a tail it read as OPEN --
  //
  // ⭐ The card's line, constructed by the review that passed PR #18427 against
  // the code it was passing. It is valid TypeScript, it CLOSES the call, and it
  // chains a live arm onto the result — so it leaves a key an author may still
  // write, which is T1's sentence exactly. It went silent because a `/` opens
  // neither comment form: the reader does not lex regex literals, pushes the
  // unpaired `(` inside the pattern onto its stack, and reaches the end of the
  // line with the stack non-empty.
  //
  // ⛔ That is the ONE ending that means GENUINELY open — not one of the four
  // "cannot parse" returns — so a repair that flagged only those four would
  // leave this case exactly as silent as it was. The case is written with the
  // card's own line for that reason: it is where the boundary runs.
  const REGEX_TAILED_CHAIN = '  legacy: retiredKey(/\\(/.source).or(z.string()),';
  t('⛔ #18488 — a CLOSED call whose tail this reader cannot lex FIRES: a regex literal hides a live `.or()` arm behind a stack that only looks open', tombstoneTells(`+${REGEX_TAILED_CHAIN}`)[0]?.tell === 'T1');
  t('…and it is the DECLINE that moved, never the vocabulary — the row is still read as a key of kind T1', declaresUnwritableKey(REGEX_TAILED_CHAIN) === false && memberTellKind(REGEX_TAILED_CHAIN, { onContractSource: true }) === 'T1');
  // ⭐ THE BOUNDARY, pinned in one case because the other direction is this
  // repair's whole risk: reading every `-1` as "keep firing" re-fires all 178
  // multi-line tombstone key lines in this tree, which is the false positive
  // #17955 exists to remove. "Cannot read" fires; "genuinely still open at the
  // end of the line" is still a tombstone, on both landed spellings.
  t('⭐ BOUNDARY — an unreadable tail fires while a call GENUINELY still open at end of line stays a tombstone, on both spellings this tree lands (148 + 30)', declaresUnwritableKey(REGEX_TAILED_CHAIN) === false && declaresUnwritableKey('  legacy: retiredKey(') === true && declaresUnwritableKey("  create: retiredKey(capRemoved('create',") === true);
  t('…and the endings that legitimately SPAN lines are certain, not unreadable: a line comment, an open delimited comment, an open template literal', declaresUnwritableKey('  legacy: retiredKey( // the prescription is below') === true && declaresUnwritableKey('  legacy: retiredKey( /* the prescription runs on') === true && declaresUnwritableKey('  legacy: retiredKey(`the prescription runs on') === true);
  t('⛔ …while the endings that are not certain fire: a `/` outside a string or comment, a closer matching nothing, and an unterminated quoted string', declaresUnwritableKey('  legacy: retiredKey(/\\(/.source,') === false && declaresUnwritableKey('  legacy: retiredKey(gone]),') === false && declaresUnwritableKey("  legacy: retiredKey('opens and never closes") === false);
  // ⭐ STRING-AWARE, and measured rather than asserted: 49 tombstone-shaped rows
  // in this tree's available history carry a quote and 4 carry a BACKTICK
  // inside a quoted prescription, so a line-level `includes` of either
  // character fires on every one of them. The flag is raised inside the scan
  // that already skips string literals, so a prescription quoting a path or a
  // spelling raises nothing — on either branch.
  t('⭐ …and a slash or a backtick INSIDE the quoted prescription raises nothing — the reading is the string-aware scan, never the line', declaresUnwritableKey("  legacy: retiredKey('see /docs/x'),") === true && declaresUnwritableKey("  legacy: retiredKey(useInstead('see /docs/x',") === true && declaresUnwritableKey("  legacy: retiredKey(useInstead('use `newKey` instead',") === true);
  // ⭐ DARK CONTROL, the reading the repair is priced by: the same scanner over
  // this tree locates 255 tombstone key lines across 66 files — 178 not closing
  // on the key line, 77 closing — and not one verdict moves. The two shapes
  // below are the branch-① twins of the two above, and they bracket the
  // decline from the closing side: a balanced regex literal that really is the
  // whole value is still a tombstone, and the same value with an arm chained
  // onto it still fires, both decided by the tail rather than by the slash.
  t('⭐ DARK — a BALANCED regex literal that closes the call on the key line is still a tombstone; the slash alone decides nothing on the closing branch', declaresUnwritableKey('  legacy: retiredKey(/x/.source),') === true && declaresUnwritableKey('  legacy: retiredKey(a / b),') === true);
  t('⛔ …and the same value with a live arm chained onto it still fires, the way it did before this reading existed', declaresUnwritableKey('  legacy: retiredKey(/x/.source).or(z.string()),') === false);

  // ⚠️ The residual QUIET direction, asserted rather than described so the next
  // reader meets it HERE instead of rediscovering it: a MULTI-LINE tombstone
  // whose CLOSING line chains a live arm. The key line is a tombstone by every
  // byte it shows, and the line carrying `.or(…)` declares no key, so nothing a
  // line-shaped reader sees on either line reports it. Measured population on
  // this tree: 0 — control, the same scanner locates all 254 tombstone key lines
  // across 66 files, 178 of them multi-line, and the SINGLE-line chained form
  // three cases up fires. The gate owner ruled it open rather than reading
  // forward to the balancing paren: a forward read crosses lines to decide a
  // population of zero, while the single-line escape closes on the key line at
  // no cost. ⭐ The OVERTURN CONDITION, written down so it needs no second
  // discussion: the FIRST real multi-line chained carrier — landed, never a
  // synthetic sample — closes it by reading forward, and this case is the one
  // that reds when it does.
  t('⚠️ QUIET — a multi-line tombstone whose CLOSING line chains a live arm is not reported; population 0, and the header carries the overturn condition', tells({ filename: TOMBSTONE_FILE, status: 'modified', patch: '@@ -30,0 +30,3 @@\n+  legacy: retiredKey(\n+    LEGACY_PRESCRIPTION,\n+  ).or(z.string()),' }).length === 0);

  // -- #17848 -----------------------------------------------------------------
  //
  // The card behind this battery read nine T1 tells across three PRs on keys
  // that had existed for releases. Re-measured, none of the three fires — and
  // none fired at the card's own filing commit either, because #16943's
  // replacement budget above had already landed. ⭐ These cases therefore pin a
  // repair that was ALREADY HERE rather than one this round made, which is
  // exactly why they earn their lines: the shape had no case of its own, so
  // nothing would have reported the day it stopped being paid for.
  //
  // ⚠️ It is arithmetically distinct from the `.describe()` pair #16943 pinned.
  // The block removes ONE line and adds THREE, of which exactly one is a key —
  // a budget counting LINES instead of KINDS comes up short right here. The
  // specimen is #17846's, written seven times in one diff.
  battery("#17848 — a key RE-DECLARED with a zod `error` param is not a key ADDED");
  const REDECLARED_WITH_ERROR_PARAM = {
    filename: 'packages/spec/src/ui/component.zod.ts',
    status: 'modified',
    patch: [
      '@@ -2491,7 +2502,12 @@ export const ObjectGridPropsSchema = lazySchema(() => strictObject({',
      '   dataSource: ElementDataSourceSchema.optional(),',
      ' ',
      '-  filter: z.array(ViewFilterRuleSchema).optional()',
      '+  filter: z.array(ViewFilterRuleSchema, {',
      "+    error: ruleArrayFilterError({ surface: 'object_grid', migration: 'rule-array' }),",
      '+  }).optional()',
      "     .describe('Filter rules'),",
    ].join('\n'),
  };
  // The SAME added lines with nothing removed to pay for them. ⛔ Without this
  // control the case above proves only that something declined, never that the
  // REPLACEMENT is what declined it.
  const ERROR_PARAM_UNPAID = {
    ...REDECLARED_WITH_ERROR_PARAM,
    patch: REDECLARED_WITH_ERROR_PARAM.patch
      .split('\n')
      .filter((l) => !l.startsWith('-'))
      .join('\n'),
  };
  // One genuine new key riding along with the re-declaration: the removal pays
  // for the key it replaced and has nothing left for this one.
  const ERROR_PARAM_PLUS_NEW_KEY = {
    ...REDECLARED_WITH_ERROR_PARAM,
    patch: [
      '@@ -2491,7 +2502,13 @@ export const ObjectGridPropsSchema = lazySchema(() => strictObject({',
      '   dataSource: ElementDataSourceSchema.optional(),',
      ' ',
      '-  filter: z.array(ViewFilterRuleSchema).optional()',
      '+  filter: z.array(ViewFilterRuleSchema, {',
      "+    error: ruleArrayFilterError({ surface: 'object_grid', migration: 'rule-array' }),",
      '+  }).optional()',
      "+    .describe('Filter rules'),",
      '+  filterLogic: z.string().optional(),',
      ' ',
    ].join('\n'),
  };
  t('⭐ the card’s specimen — key, optionality and element schema byte-identical, an `error` param added — is not a new key', tells(REDECLARED_WITH_ERROR_PARAM).length === 0);
  t('…and the pair reads CLEAN end to end, which is the exit code the card reported as unreachable', wideningRefusal({ declaration: 'no', files: [REDECLARED_WITH_ERROR_PARAM] }).state === 'clean');
  t('⛔ DARK CONTROL — the same three added lines with NO removal still fire: the silence is bought by the replacement, never by the shape', tells(ERROR_PARAM_UNPAID).length === 1 && tells(ERROR_PARAM_UNPAID)[0]?.tell === 'T1');
  t('…at the line that declares the key, not at the param that chooses a refusal message', at(ERROR_PARAM_UNPAID)[0] === 'packages/spec/src/ui/component.zod.ts:2504');
  t('⛔ an `error:` param is not a key on a shape — its value is not schema-shaped, so it neither fires nor SPENDS the budget', memberTellKind("    error: ruleArrayFilterError({ surface: 'object_grid' }),", { onContractSource: true }) === null);
  t('⭐ SURPLUS CONTROL — a genuinely new key added in the SAME block still fires: one removal pays for one key', tells(ERROR_PARAM_PLUS_NEW_KEY).length === 1 && tells(ERROR_PARAM_PLUS_NEW_KEY)[0]?.tell === 'T1');
  t('…and the row it reports is the new key, never the re-declared one', at(ERROR_PARAM_PLUS_NEW_KEY)[0] === 'packages/spec/src/ui/component.zod.ts:2508');
  t('⛔ and the re-declaration does not license the block: a THIRD key with no removal behind it is reported too', tells({ ...REDECLARED_WITH_ERROR_PARAM, patch: `${REDECLARED_WITH_ERROR_PARAM.patch}\n+  extra: z.string(),` }).length === 1);

  // -- #18234: a REMOVED value that accepted EVERYTHING ----------------------
  //
  // The live pair is objectui#9540: one key narrowed out of `z.unknown()` —
  // zod's universal acceptor — into a `z.union([…])` whose list opens on the
  // next line. `'stage=won'` and `42` were admitted before and are refused
  // after, so the accept set SHRANK, and T1's own sentence ("the accept set
  // gains a spelling an author may now write") is inverted on it.
  //
  // ⭐ The finding is the CONTROL rather than that reasoning: the SAME removal
  // with the replacement spelled `z.array(z.any())` DECLINED, while spelling it
  // `z.union([` FIRED — one semantic change, two verdicts, decided by nothing
  // but the first line of the added value. The case below asserts the two
  // spellings agree, which is the defect in one assertion.
  //
  // ⭐ Read the FIRING half first, the way #17300's and #17955's batteries are
  // ordered: a reading that can only suppress is untestable in the direction
  // that matters, so the decline is bracketed on every side — a different key,
  // a removed value that was never universal, a narrowing chain step on it, a
  // genuine key riding along, and the dark control with nothing removed.
  battery('#18234 — a key narrowed OUT of a universal acceptor is not a set that gained a value');
  const UA_BOARD = 'objectstack-ai/objectui';
  const UA_MIRROR = 'packages/types/src/zod/objectql.zod.ts';
  const uaTells = (file) => tellsInFile(file, { repo: UA_BOARD });
  const uaAt = (file) => uaTells(file).map((r) => `${r.file}:${r.line}`);
  const uaPatch = (...lines) => [
    '@@ -1811,2 +1811,5 @@ export const ObjectGallerySchema = BaseSchema.extend({',
    ...lines,
    ' ',
  ].join('\n');
  const UA_REMOVED = "-  filter: z.unknown().optional().describe('Query filter, forwarded verbatim as $filter'),";
  const UA_ADDED_UNION = [
    '+  filter: z.union([',
    '+    z.array(z.any()),',
    '+    z.record(z.string(), z.any()),',
    "+  ]).optional().describe('Query filter, forwarded verbatim as $filter'),",
  ];
  // The live pair, in the bytes objectui#9540 pushed.
  const UNIVERSAL_ACCEPTOR_NARROWED = {
    filename: UA_MIRROR,
    status: 'modified',
    patch: uaPatch(UA_REMOVED, ...UA_ADDED_UNION),
  };
  // ⭐ CONTROL A — the identical removal, the replacement spelled so that its
  // first line opens no closed-set constructor. This one declined BEFORE this
  // reading landed, and it is why the pair is a defect rather than a strictness
  // preference.
  const UNIVERSAL_ACCEPTOR_NARROWED_INLINE = {
    filename: UA_MIRROR,
    status: 'modified',
    patch: uaPatch(UA_REMOVED, "+  filter: z.array(z.any()).optional().describe('Query filter, forwarded verbatim as $filter'),"),
  };
  // The same shape on THIS repo's own contract surface — the reading is about
  // the removed VALUE, never about which board is being judged.
  const uaHere = (patch) => ({ filename: 'packages/spec/src/a.zod.ts', status: 'modified', patch });

  // -- the firing half: what a removed universal acceptor must NOT buy -------
  t('⛔ DARK CONTROL — the same added union with NOTHING removed still fires: the silence is bought by the removal, never by the shape', uaTells({ ...UNIVERSAL_ACCEPTOR_NARROWED, patch: uaPatch(...UA_ADDED_UNION) }).length === 1);
  t('…at the line that declares the key, which is the row the live pair was refused on', uaAt({ ...UNIVERSAL_ACCEPTOR_NARROWED, patch: uaPatch(...UA_ADDED_UNION) })[0] === `${UA_MIRROR}:1811`);
  t('⛔ a removed universal acceptor on a DIFFERENT key pays nothing — that block really does add a spelling', uaTells({ ...UNIVERSAL_ACCEPTOR_NARROWED, patch: uaPatch('-  legacyFilter: z.unknown().optional(),', '+  filter: z.union([', '+    z.string(),', '+  ]),') }).length === 1);
  t('⛔ a removed value that was never universal pays nothing either — `z.string()` is not the universe', uaTells({ ...UNIVERSAL_ACCEPTOR_NARROWED, patch: uaPatch('-  filter: z.string().optional(),', '+  filter: z.union([', '+    z.string(),', '+  ]),') }).length === 1);
  t('⛔ nor does one carrying a NARROWING chain step — a `.refine()`d `z.unknown()` refuses values, so the replacement may widen', uaTells({ ...UNIVERSAL_ACCEPTOR_NARROWED, patch: uaPatch('-  filter: z.unknown().refine(isFilterish).optional(),', '+  filter: z.union([', '+    z.string(),', '+  ]),') }).length === 1);
  const UA_SURPLUS = { ...UNIVERSAL_ACCEPTOR_NARROWED, patch: uaPatch(UA_REMOVED, ...UA_ADDED_UNION, '+  filterLogic: z.union([AndSchema, OrSchema]),') };
  t('⛔ SURPLUS CONTROL — a genuinely new key added in the SAME block still fires: one removal pays for one key', uaTells(UA_SURPLUS).length === 1);
  t('…and the row it reports is the new key, never the narrowed one', uaTells(UA_SURPLUS)[0]?.text === 'filterLogic: z.union([AndSchema, OrSchema]),');
  t('⛔ CONTROL — an inline enum WIDENED in place still tells: no universal acceptor was removed, and no per-member line exists for T2 to read', tells(uaHere("@@ -95,2 +95,2 @@\n-  kind: z.enum(['a', 'b']),\n+  kind: z.enum(['a', 'b', 'c']),")).length === 1);
  t('⛔ CONTROL — a genuinely new key on a shape still tells, with its own file:line', at(FILE_SCHEMA_KEY)[0] === 'packages/spec/src/kernel/manifest.zod.ts:44');
  t('⛔ CONTROL — a set whose list opens on a LATER line with no universal acceptor removed keeps telling', tells(uaHere("@@ -95,3 +95,4 @@\n-  strategy: z.enum(['a', 'b']),\n+  strategy: z.enum([\n+    'a',\n+  ]),")).some((r) => r.tell === 'T1'));

  // -- the declining half: objectui#9540's one row --------------------------
  t('⭐ THE LIVE PAIR — a key narrowed out of `z.unknown()` into a multi-line `z.union([` reads no tell', uaTells(UNIVERSAL_ACCEPTOR_NARROWED).length === 0);
  t('⭐ THE FINDING, in one assertion: the two spellings of the SAME narrowing now agree', uaTells(UNIVERSAL_ACCEPTOR_NARROWED).length === uaTells(UNIVERSAL_ACCEPTOR_NARROWED_INLINE).length);
  t('…and control A still declines, so the agreement was not bought by making it fire', uaTells(UNIVERSAL_ACCEPTOR_NARROWED_INLINE).length === 0);
  t('⭐ …and the live pair reads CLEAN end to end, which is the exit code a correct `Clause-②: no` could not reach', wideningRefusal({ declaration: 'no', files: [UNIVERSAL_ACCEPTOR_NARROWED], repo: UA_BOARD }).state === 'clean');
  t('⭐ `z.any()` is in the class on a MEASUREMENT — both accept every value; they differ only in what `tsc` permits at the use site', tells(uaHere("@@ -30,2 +30,4 @@\n-  filter: z.any().optional(),\n+  filter: z.union([\n+    z.string(),\n+  ]),")).length === 0);
  t('⭐ …and the reading is about the removed VALUE, not the board: the same shape on this repo\'s own surface declines too', tells(uaHere("@@ -30,2 +30,4 @@\n-  filter: z.unknown().optional().describe('Initial filter'),\n+  filter: z.union([\n+    z.array(SortItemSchema),\n+  ]),")).length === 0);
  t('⭐ …and a `z.discriminatedUnion` / `z.literal` replacement reads the same — the added value\'s spelling decides nothing', tells(uaHere("@@ -30,2 +30,3 @@\n-  mode: z.unknown(),\n+  mode: z.discriminatedUnion('type', [\n+    A,\n+  ]),")).length === 0 && tells(uaHere("@@ -30,1 +30,1 @@\n-  mode: z.unknown(),\n+  mode: z.literal('grid'),")).length === 0);

  // -- the reader itself -----------------------------------------------------
  t('`declaresUniversalAcceptorKey` reads the key a universal acceptor is written on', declaresUniversalAcceptorKey("  filter: z.unknown().optional().describe('prose'),") === 'filter' && declaresUniversalAcceptorKey('  filter: z.any(),') === 'filter');
  t('…in every key spelling `SCHEMA_PROPERTY` admits — quoted, and optional-marked', declaresUniversalAcceptorKey("  'a.b': z.unknown(),") === 'a.b' && declaresUniversalAcceptorKey('  filter?: z.unknown(),') === 'filter');
  t('…and the whole measured chain vocabulary of this tree: `.optional()`, `.describe()`, `.meta()`', ['  f: z.unknown().optional(),', "  f: z.unknown().describe('x'),", '  f: z.unknown().optional().meta({ title: 1 }),'].every((l) => declaresUniversalAcceptorKey(l) === 'f'));
  t('⛔ …and declines a NARROWING step, which is the direction that must never be certified', declaresUniversalAcceptorKey('  f: z.unknown().refine(isThing),') === null && declaresUniversalAcceptorKey('  f: z.unknown().pipe(z.string()),') === null);
  t('⛔ …and a value that merely MENTIONS the acceptor inside a live schema', declaresUniversalAcceptorKey('  f: z.string().or(z.unknown()),') === null && declaresUniversalAcceptorKey('  f: z.array(z.unknown()),') === null);
  t('⛔ …and an UNTERMINATED value, which shows nothing about what the next line chains onto it — 33 of this tree\'s 132 acceptor key lines', declaresUniversalAcceptorKey('  f: z.unknown().optional()') === null && declaresUniversalAcceptorKey("  f: z.unknown().describe(") === null);
  t('…a trailing comment is not a chain step', declaresUniversalAcceptorKey('  f: z.unknown(), // forwarded verbatim') === 'f');
  t('⛔ …but a paren inside a `.describe()` STRING cannot close the step early and let a narrowing arm through', declaresUniversalAcceptorKey("  f: z.unknown().describe('call foo(bar)'),") === 'f' && declaresUniversalAcceptorKey("  f: z.unknown().describe('call foo(bar)').refine(x),") === null);
  t('⛔ …and `z.custom()` is NOT declared: measured 0 code occurrences in this tree, and `z.custom(fn)` narrows', declaresUniversalAcceptorKey('  f: z.custom(),') === null);
  t('⛔ …nor a bare acceptor that names no key — this is a PROPERTY reading, not an expression one', declaresUniversalAcceptorKey('  z.unknown(),') === null && declaresUniversalAcceptorKey('  // f: z.unknown(),') === null);
  t('`replacesUniversalAcceptorKey` needs the SAME key', replacesUniversalAcceptorKey('  filter: z.union([', ['  filter: z.unknown().optional(),']) === true && replacesUniversalAcceptorKey('  filter: z.union([', ['  other: z.unknown().optional(),']) === false);
  t('…and an added line that names no key spends nothing', replacesUniversalAcceptorKey("    z.array(z.any()),", ['  filter: z.unknown(),']) === false);
  t('`keyedPropertyName` is ONE reading, shared with #17618\'s re-spelling: the two cannot disagree about a key', keyedPropertyName("  strategy: z.enum(['a']),") === 'strategy' && keyedClosedSetMembers("  strategy: z.enum(['a']),")?.key === keyedPropertyName("  strategy: z.enum(['a']),"));
  t('⭐ the vocabulary is INTACT — `memberTellKind` still classifies a universal-acceptor key line as T1, so both sides of the budget read one question', memberTellKind('  filter: z.unknown().optional(),', { onContractSource: true }) === 'T1');
  t('⭐ …and the narrowed key SPENDS the budget rather than being exempt from it: two removed acceptors pay for two narrowed keys, and a third key fires', tells(uaHere('@@ -30,2 +30,3 @@\n-  a: z.unknown(),\n-  b: z.unknown(),\n+  a: z.union([X]),\n+  b: z.union([Y]),\n+  c: z.union([Z]),')).length === 1);

  // ⭐ The direction this reading deliberately did NOT touch was asserted here
  // as a QUIET one, on the stated ground that "this case is what reds the day
  // that lands". #18629 is that day, and its own battery is below. What stays
  // here is the half that must NOT have moved: repairing the inverse must not
  // be bought by breaking this reading's own direction, so the live pair is
  // re-asserted in the same case that asserts the inverse now fires.
  t('⭐ #18629 closed the inverse direction (a key re-typed INTO `z.unknown()` now FIRES) — and this reading\'s own direction is UNCHANGED by it', tells(uaHere('@@ -30,1 +30,1 @@\n-  filter: z.union([A, B]),\n+  filter: z.unknown().optional(),')).length === 1 && uaTells(UNIVERSAL_ACCEPTOR_NARROWED).length === 0);

  // -- #18629: the same fact read on the ADDED side --------------------------
  //
  // #16943's budget confirms that a key was REWRITTEN and never asks whether the
  // rewrite accepts more or less. #18234 supplied the one direction fact a line
  // can carry, on the REMOVED side; this battery is that fact on the ADDED side,
  // and the two are one predicate seen from either end.
  //
  // ⭐ Read the FIRING half first, as every battery above it is ordered: a
  // reading that can only suppress is untestable in the direction that matters,
  // and this one can only REPORT, so the decline is bracketed on every side —
  // an acceptor re-spelled as an acceptor, a wrapped acceptor pulled onto one
  // line, an acceptor mentioned inside a narrower value, an added acceptor whose
  // own chain wraps, and a rename onto a key no removed line names.
  battery('#18629 — a key re-typed INTO a universal acceptor is a real widening the budget must not pay for');
  const inv = (...lines) => uaHere(['@@ -30,4 +30,4 @@ export const S = z.object({', ...lines, ' '].join('\n'));
  const invTells = (...lines) => tells(inv(...lines));
  const invAt = (...lines) => at(inv(...lines));
  const INV_REMOVED = '-  filter: z.union([A, B]),';
  const INV_ADDED = '+  filter: z.unknown().optional(),';
  const INV_WHY = 'a key re-typed INTO a universal acceptor';

  // -- the firing half: what the budget must no longer pay for ---------------
  t('⭐ THE FINDING — the filing card\'s own patch: a key re-typed from `z.union([A, B])` into `z.unknown()` FIRES, where the replacement budget paid for it in silence', invTells(INV_REMOVED, INV_ADDED).length === 1);
  t('…at the line that declares the key, which is the row an author has to answer for', invAt(INV_REMOVED, INV_ADDED)[0] === 'packages/spec/src/a.zod.ts:30');
  t('⭐ …and the row NAMES the direction rather than reporting a key that was never added', invTells(INV_REMOVED, INV_ADDED)[0]?.why.startsWith(INV_WHY));
  t('⭐ `z.any()` is in the class on the SAME measurement #18234 read it by — both accept every value', invTells(INV_REMOVED, '+  filter: z.any(),').length === 1);
  t('⛔ a removed value that was never a closed set is evidence too — `z.string()` is not the universe either', invTells('-  filter: z.string(),', '+  filter: z.unknown(),').length === 1);
  t('⛔ …and so is a removed multi-line OPENER on the same key, whose own list never closes on its line', invTells('-  filter: z.union([', '-    A,', '-  ]),', '+  filter: z.unknown(),').length === 1);
  const INV_SURPLUS = ['-  filter: z.union([A, B]),', '+  filter: z.unknown(),', '+  other: z.string(),'];
  t('⭐ SPEND CONTROL — the widening SPENDS its unit and is reported ON TOP of it, so a genuine new key riding along still fires', invTells(...INV_SURPLUS).length === 2);
  t('…and the two rows are the widened key and the new key, each with its own file:line — refusing the spend would have silenced the second', invAt(...INV_SURPLUS).join(' ') === 'packages/spec/src/a.zod.ts:30 packages/spec/src/a.zod.ts:31');
  t('…and only the first carries the direction wording; the new key is reported as the new key it is', invTells(...INV_SURPLUS)[0]?.why.startsWith(INV_WHY) && !invTells(...INV_SURPLUS)[1]?.why.startsWith(INV_WHY));
  t('⛔ a removal in a DIFFERENT change block is a different edit — the acceptor fires there as the ordinary new key it is', invTells(INV_REMOVED, '   ctx', '+  filter: z.unknown(),').length === 1);
  t('⛔ DARK CONTROL — the same added acceptor with NOTHING removed still fires: the row is bought by the removal, never by the added shape', invTells('+  filter: z.unknown(),').length === 1);
  t('…and THAT row is the plain new-key reading, which is the whole difference this reading makes', invTells('+  filter: z.unknown(),')[0]?.why.startsWith(INV_WHY) === false);
  t('⛔ a trailing COMMENT mentioning the acceptor is not the value — comments are stripped before the mention is read', invTells('-  filter: z.string(), // was z.unknown()', '+  filter: z.unknown(),').length === 1);
  t('⭐ the reading is about the BLOCK, never the board — the same shape on the objectui mirror reads the same', uaTells({ filename: UA_MIRROR, status: 'modified', patch: uaPatch(INV_REMOVED, INV_ADDED) }).length === 1);
  t('⛔ …and nothing at all fires off the contract source surface', tellsInFile({ filename: 'packages/core/src/a.ts', status: 'modified', patch: uaPatch(INV_REMOVED, INV_ADDED) }, {}).length === 0);

  // -- the declining half: what is NOT a widening ----------------------------
  t('⛔ NEUTRAL CONTROL — an acceptor re-spelled as an acceptor gained nothing and still declines', invTells('-  filter: z.unknown().optional(),', '+  filter: z.unknown(),').length === 0);
  t('⛔ REFORMAT CONTROL — a removed acceptor whose chain WRAPS is read as a MENTION, so pulling it onto one line is not read as a widening', invTells('-  filter: z.unknown()', "-    .describe('x'),", "+  filter: z.unknown().describe('x'),").length === 0);
  t('⚠️ QUIET — a removed value that merely MENTIONS an acceptor inside a narrower one declines; the header states it with its overturn condition', invTells('-  filter: z.array(z.unknown()),', '+  filter: z.unknown(),').length === 0);
  t('⚠️ QUIET — an added acceptor whose own chain wraps onto a second line is not certified, the mirror of #18234\'s residual and closed by the same condition', invTells(INV_REMOVED, '+  filter: z.unknown().optional()', "+    .describe('x'),").length === 0);
  t('⚠️ QUIET — a rename ONTO a key no removed line names is not this row: #16943\'s budget pays for it exactly as before', invTells('-  other: z.string(),', '+  filter: z.unknown(),').length === 0);
  t('⭐ SIBLING INTACT — #18234\'s live pair, a key narrowed OUT of an acceptor, still declines under this reading', uaTells(UNIVERSAL_ACCEPTOR_NARROWED).length === 0);

  // -- the reader itself -----------------------------------------------------
  t('`widensKeyIntoUniversalAcceptor` needs the SAME key — a removed `other` says nothing about what `filter` now accepts', widensKeyIntoUniversalAcceptor('  filter: z.unknown(),', ['  filter: z.union([A, B]),']) === true && widensKeyIntoUniversalAcceptor('  filter: z.unknown(),', ['  other: z.union([A, B]),']) === false);
  t('⛔ …and declines when the removed line carries an acceptor CALL anywhere on it, certified or not', widensKeyIntoUniversalAcceptor('  filter: z.unknown(),', ['  filter: z.unknown().optional(),']) === false && widensKeyIntoUniversalAcceptor('  filter: z.unknown(),', ['  filter: z.array(z.unknown()),']) === false);
  t('⛔ …and when the ADDED line is not a CERTIFIED acceptor — unterminated, or carrying a narrowing step', widensKeyIntoUniversalAcceptor('  filter: z.unknown().optional()', [INV_REMOVED.slice(1)]) === false && widensKeyIntoUniversalAcceptor('  filter: z.unknown().refine(f),', [INV_REMOVED.slice(1)]) === false);
  t('…and reads the key in every spelling `declaresUniversalAcceptorKey` admits — quoted, and optional-marked', widensKeyIntoUniversalAcceptor("  'a.b': z.unknown(),", ["  'a.b': z.union([A]),"]) === true && widensKeyIntoUniversalAcceptor('  filter?: z.unknown(),', ['  filter?: z.union([A]),']) === true);
  t('⛔ …and a `removedTexts` that is not an array is not evidence', widensKeyIntoUniversalAcceptor('  filter: z.unknown(),', null) === false);
  t('⭐ …and it is the MIRROR of `replacesUniversalAcceptorKey`: one pair of lines, read from either end, and the neutral pair is a replacement to one and a widening to neither', widensKeyIntoUniversalAcceptor('  filter: z.unknown(),', ['  filter: z.union([A, B]),']) === true && replacesUniversalAcceptorKey('  filter: z.union([A, B]),', ['  filter: z.unknown(),']) === true && widensKeyIntoUniversalAcceptor('  filter: z.unknown(),', ['  filter: z.unknown(),']) === false);

  // -- #19099: the walk says when it stopped reading -------------------------
  battery('#19099 — the enclosing-delimiter walk says when it STOPPED READING and started guessing');
  const CTX = (text) => ({ text, hunk: 0 });
  // -- the stack, and the flag beside it -------------------------------------
  const NESTED_SIDE = [CTX('  pagination: z.looseObject({'), CTX('    pageSize: z.number(),')];
  t('`enclosingDelimiters` answers the whole SHOWN stack, outermost first, where this reading used to answer only its top — which `enclosingDelimiter` still does', enclosingDelimiters(NESTED_SIDE, 1).frames.length === 2 && enclosingDelimiters(NESTED_SIDE, 1).frames[1]?.opener === '{' && enclosingDelimiter(NESTED_SIDE, 1)?.opener === '{');
  t('⛔ …and an unterminated string is UNREADABLE, while an underflow is a readable "the hunk showed none still open"', enclosingDelimiters([CTX("const s = 'opens here"), CTX('  extra: z.string(),')], 1).unreadable === true && enclosingDelimiters([CTX('  });'), CTX('  extra: z.string(),')], 1).unreadable === false && enclosingDelimiters([CTX('  });'), CTX('  extra: z.string(),')], 1).frames.length === 0);
  t('⭐ a `/` that may open a REGEX raises the flag, and leaves the frames it had exactly where they were', enclosingDelimiters([CTX('  label: z.string().regex(/^x/),'), CTX('  next: z.string(),')], 1).unreadable === true && enclosingDelimiters([CTX('  label: z.string(),'), CTX('  next: z.string(),')], 1).unreadable === false);
  t('⭐ …while a LONE `/` is a DIVISION and raises nothing: a regex literal cannot span lines, so the stack it did not touch is still a reading', enclosingDelimiters([CTX('  half: z.number().default(TOTAL / 2),'), CTX('  next: z.string(),')], 1).unreadable === false);
  t('⛔ …and a `/` inside a STRING or a line comment raises nothing either — the flag is for bytes this scan could not lex, never for every slash', enclosingDelimiters([CTX("  label: z.string().describe('a/b'),"), CTX('  next: z.string(),')], 1).unreadable === false && enclosingDelimiters([CTX('  // a/b'), CTX('  next: z.string(),')], 1).unreadable === false);
  t('⛔ …and a TYPE-BLIND pop is flagged too, while #18721’s UNDERFLOW is not: one says the stack was already wrong, the other says the hunk began inside something it never showed', enclosingDelimiters([CTX('  f(x[0 }'), CTX('  next: z.string(),')], 1).unreadable === true && enclosingDelimiters([CTX('  });'), CTX('  next: z.string(),')], 1).unreadable === false);
  // -- a hunk that BEGINS inside a comment, and the three guards on the reset -
  const JSDOC_START = [CTX(' * see makeThing({ a, b'), CTX(' */'), CTX('  next: z.string(),')];
  t('⭐ a `*/` outside a block comment reads as "the hunk BEGAN inside one", and the frames the comment text pushed are DISCARDED', enclosingDelimiters(JSDOC_START, 2).unreadable === false && enclosingDelimiters(JSDOC_START, 2).frames.length === 0);
  t('⛔ GUARD 1 — a SECOND leading terminator is not the same fact: the reset applies once, and the next one raises the flag', enclosingDelimiters([CTX(' */'), CTX(' */'), CTX('  next: z.string(),')], 2).unreadable === true);
  t('⭐ GUARD 2 — a `*/` arriving after this walk opened AND closed a comment of its OWN is unexplained, so it raises the flag and KEEPS the frames rather than discarding real ones', enclosingDelimiters([CTX('  /* note */ wrap: z.object({'), CTX(' */'), CTX('  next: z.string(),')], 2).unreadable === true && enclosingDelimiters([CTX('  /* note */ wrap: z.object({'), CTX(' */'), CTX('  next: z.string(),')], 2).frames.length === 2);
  t('⛔ …and the same walk WITHOUT the stray terminator keeps those frames and raises nothing, so the case above measures the guard and not the comment', enclosingDelimiters([CTX('  /* note */ wrap: z.object({'), CTX('  next: z.string(),')], 1).unreadable === false && enclosingDelimiters([CTX('  /* note */ wrap: z.object({'), CTX('  next: z.string(),')], 1).frames.length === 2);
  t('⭐ GUARD 3 — once the walk is UNREADABLE the reset is REFUSED, which is what that guard protects: `enclosingDelimiter` ignores the flag, and would otherwise lose a frame the hunk really showed', enclosingDelimiter([CTX('  wrap: z.object({'), CTX('  slug: z.string().regex(/^x/),'), CTX(' */'), CTX('  next: z.string(),')], 3)?.opener === '{' && enclosingDelimiters([CTX('  wrap: z.object({'), CTX('  slug: z.string().regex(/^x/),'), CTX(' */'), CTX('  next: z.string(),')], 3).frames.length === 2);
  // -- the residual the header names, pinned as the residual it is ------------
  //
  // ⛔ An APOSTROPHE in doc prose is the trigger that actually occurs on this
  // tree — 7 of 95 T1 lines — and it fires BEFORE the terminator line is ever
  // reached, so the reset above cannot help it. Pinned in the direction it
  // fails: unreadable, no frames, and every reader that suppresses must refuse.
  t('⚠️ THE RESIDUAL — an apostrophe in the prose of a hunk that begins inside a JSDoc opens a string that never closes, so the walk is UNREADABLE before the terminator is read', enclosingDelimiters([CTX(" * the value's shape is { id"), CTX(' */'), CTX('  next: z.string(),')], 2).unreadable === true && enclosingDelimiters([CTX(" * the value's shape is { id"), CTX(' */'), CTX('  next: z.string(),')], 2).frames.length === 0);
  t('⛔ CONTROL — the identical prose with the apostrophe spelled away resets cleanly, so the case above measures the apostrophe and nothing else', enclosingDelimiters([CTX(' * the value shape is { id'), CTX(' */'), CTX('  next: z.string(),')], 2).unreadable === false);
  // -- the reset reaches a CALLER, which is the half a unit case cannot show --
  const JSDOC_ARROW = [CTX(' * const check = ('), CTX(' */'), CTX('  extra: z.string(),')];
  t('⭐ THE RESET REACHES `inParameterList` — an arrow in an `@example` block would otherwise read as a real parameter list and SWALLOW the key line behind it; discarded frames make it fire', inParameterList(JSDOC_ARROW, 2) === false);
  t('⛔ CONTROL — the identical head on a line the walk really reads as code still declines, so the case above measures the comment and not the head', inParameterList([CTX('const check = ('), CTX('  extra: z.string(),')], 1) === true);

  // -- T3 --------------------------------------------------------------------
  battery('T3 — a new row in a published entry point');
  t('a new export row is a tell', tells(FILE_API_SURFACE)[0]?.tell === 'T3');
  t('…reported at its file:line', at(FILE_API_SURFACE)[0] === 'packages/spec/api-surface/kernel.json:14');
  t('the signatures sibling is on the surface too', tells({ filename: 'packages/spec/api-surface-signatures.json', patch: patchOf(4, '+  "defineWorkflow": "sha256:0000000000000000",') })[0]?.tell === 'T3');
  t('⛔ a removed row is not a tell', tells({ filename: 'packages/spec/api-surface/kernel.json', patch: '@@ -14,1 +14,0 @@\n-    "Gone (const)",' }).length === 0);
  t('⛔ a JSON file elsewhere is not on this surface', tells({ filename: 'packages/spec/package.json', patch: patchOf(4, '+    "./workflow": "./dist/workflow.js",') }).length === 0);
  t('⛔ nor a non-string structural line inside the listing', tells({ filename: 'packages/spec/api-surface/kernel.json', patch: patchOf(4, '+  ]') }).length === 0);
  t('an unread api-surface file is a GAP, not a clean reading', unreadFiles([{ filename: 'packages/spec/api-surface/kernel.json', patch: undefined }])[0] === 'packages/spec/api-surface/kernel.json');
  t('a DELETED api-surface file adds nothing and owes no patch', unreadFiles([{ filename: 'packages/spec/api-surface/kernel.json', status: 'removed', patch: null }]).length === 0);

  // -- T4 --------------------------------------------------------------------
  battery('T4 — a new registration in a registry');
  t('a new ledger code is a tell', tells(FILE_REGISTRY)[0]?.tell === 'T4');
  t('…reported at its file:line', at(FILE_REGISTRY)[0] === 'packages/spec/src/api/error-code-ledger.zod.ts:140');
  t('a new OWNER key opening a list is a tell', tells({ filename: 'packages/spec/src/api/error-code-ledger.zod.ts', patch: patchOf(140, "+  '@objectstack/workflow': [") })[0]?.tell === 'T4');
  t('the dispatcher vocabulary is on the registry surface, outside packages/spec', tells({ filename: 'packages/runtime/src/dispatcher-error-vocabulary.ts', patch: patchOf(300, "+        code: 'WORKFLOW_STEP_FAILED',") })[0]?.tell === 'T4');
  t('the metadata form registry is on it too', tells({ filename: 'packages/spec/src/system/metadata-form-registry.ts', patch: patchOf(70, '+  workflow: workflowForm,') }).length === 1);
  t('⛔ a comment in a registry is not a registration', tells({ filename: 'packages/runtime/src/dispatcher-error-vocabulary.ts', patch: patchOf(300, "+    // 'WORKFLOW_STEP_FAILED' is pending") }).length === 0);
  t('⛔ a removed registration is not a tell', tells({ filename: 'packages/spec/src/api/error-code-ledger.zod.ts', patch: "@@ -140,1 +140,0 @@\n-    'GONE'," }).length === 0);
  t('⛔ a runtime file that is NOT a declared registry is off the surface', tells({ filename: 'packages/runtime/src/other.ts', patch: patchOf(300, "+        code: 'WORKFLOW_STEP_FAILED',") }).length === 0);
  t('a registry file inside packages/spec reports ONE row, not one per overlapping surface', tells(FILE_REGISTRY).length === 1);
  t('…because the ledger line is read by the registry tell, which the contract-source tells do not claim', tells(FILE_REGISTRY)[0]?.tell === 'T4');

  // -- acceptance: the positive controls ------------------------------------
  battery('#16448 acceptance: the four positive controls, each with its file:line');
  const positives = [FILE_SCHEMA_KEY, FILE_ENUM_MEMBER, FILE_API_SURFACE, FILE_REGISTRY];
  const refusedAll = wideningRefusal({ declaration: 'no', files: positives });
  t('all four tells fire on one diff', refusedAll.rows.length === 4);
  t('…one of each kind, none collapsed into another', JSON.stringify(refusedAll.rows.map((r) => r.tell).sort()) === '["T1","T2","T3","T4"]');
  t('the verdict is REFUSED', refusedAll.state === 'refused');
  t('…which maps to the adverse exit', exitForRefusal(refusedAll) === EXIT_REFUSED);
  t('the refusal carries the card\'s sentence verbatim', says(refusedAll.text, REFUSAL_SENTENCE));
  t('…and every tell\'s file:line', ['packages/spec/src/kernel/manifest.zod.ts:44', 'packages/spec/src/kernel/plugin.zod.ts:95', 'packages/spec/api-surface/kernel.json:14', 'packages/spec/src/api/error-code-ledger.zod.ts:140'].every((p) => says(refusedAll.text, p)));
  t('each printed row leads with its file:line', refusalLines(refusedAll).every((l) => /^T[1-4] [^ ]+:\d+ — /.test(l)));
  t('…and quotes the added line so the reader need not open the file', refusalLines(refusedAll).every((l) => l.includes('\n    + ')));

  // -- acceptance: the negative controls ------------------------------------
  battery('#16448 acceptance: the negative controls a widening gate must let through');
  const yesVerdict = wideningRefusal({ declaration: 'yes', files: positives });
  t('the SAME four diffs with `yes` are not blocked', yesVerdict.state === 'not-applicable');
  t('…and exit 0', exitForRefusal(yesVerdict) === EXIT_OK);
  t('…with no rows computed at all — a `yes` is never even judged here', yesVerdict.rows.length === 0);
  const removalOnly = [
    { filename: 'packages/spec/src/kernel/plugin.zod.ts', status: 'modified', patch: "@@ -95,2 +95,0 @@\n-  'legacy',\n-  'deprecated'," },
    { filename: 'packages/spec/api-surface/kernel.json', status: 'modified', patch: '@@ -14,1 +14,0 @@\n-    "LegacySchema (const)",' },
    { filename: 'packages/spec/src/api/error-code-ledger.zod.ts', status: 'modified', patch: "@@ -140,1 +140,0 @@\n-    'GONE'," },
  ];
  const removalVerdict = wideningRefusal({ declaration: 'no', files: removalOnly });
  t('a removal-only diff with `no` PASSES — the ruling is directional', removalVerdict.state === 'clean');
  t('…and exits 0', exitForRefusal(removalVerdict) === EXIT_OK);
  t('a tightened refine with `no` passes', wideningRefusal({ declaration: 'no', files: [{ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(9, '+  .refine((v) => v.length < 10, { message: "too long" })') }] }).state === 'clean');
  t('a pure rename with `no` passes', wideningRefusal({ declaration: 'no', files: splitUnifiedDiff('diff --git a/packages/spec/src/a.zod.ts b/packages/spec/src/b.zod.ts\nrename from packages/spec/src/a.zod.ts\nrename to packages/spec/src/b.zod.ts\n') }).state === 'clean');
  t('a docs-only diff with `no` passes', wideningRefusal({ declaration: 'no', files: [{ filename: 'content/docs/x.mdx', patch: patchOf(1, '+  newKey: z.string(),') }] }).state === 'clean');
  t('an absent declaration is NOT this gate\'s verdict to issue — that is the sibling\'s C2 row', wideningRefusal({ declaration: null, files: positives }).state === 'not-applicable');
  t('…and neither is a malformed one', wideningRefusal({ declaration: 'YES', files: positives }).state === 'not-applicable');

  // -- the sentence and the prohibitions ------------------------------------
  battery('the refusal sentence, and the two prohibitions it must keep');
  t('the sentence names both ways out', says(REFUSAL_SENTENCE, 're-declare `yes`') && says(REFUSAL_SENTENCE, 'repair it here in the matcher'));
  t('⛔ #17848 — and BOTH are doors this file can open: the one with no reader is gone', !says(REFUSAL_SENTENCE, 'explain in the claim'));
  t('…and its uselessness is stated outright, so no author spends a round rediscovering it', says(REFUSAL_SENTENCE, 'moves no exit code'));
  t('…while the matcher door names the file to open and the case that must come with it', says(REFUSAL_SENTENCE, 'scripts/pm/check-widening-tells.mjs') && says(REFUSAL_SENTENCE, '`--self-test` case pinning the shape'));
  t('…and quotes the declaration in the spelling the reader uses', says(REFUSAL_SENTENCE, '`Clause-②: no`'));
  t('⭐ #19099 — the ONE shape the gate keeps refusing although it only narrows is NAMED, with both acceptor spellings, so the refusal says why it fires', says(REFUSAL_SENTENCE, 'bounded inside a bag that was a universal acceptor') && says(REFUSAL_SENTENCE, '`z.unknown()`') && says(REFUSAL_SENTENCE, '`z.any()`'));
  t('…and its disposition is the TIER, ⛔ never a matcher repair — the card this closes was filed against a refusal that said neither', says(REFUSAL_SENTENCE, 'declare `Clause-②: yes` and route it to at-tier review') && says(REFUSAL_SENTENCE, 'cannot verify a narrowing per line without subtyping'));
  t('⛔ no label name appears anywhere in this file\'s outputs — a checker that hung one would be issuing the verdict', !says(REFUSAL_SENTENCE, 'needs:') && refusalLines(refusedAll).every((l) => !l.includes('needs:')));
  t('⛔ no new claim-line syntax is invented: the two values are the sibling\'s two', wideningRefusal({ declaration: 'maybe', files: positives }).state === 'not-applicable');
  t('a tell is reported as a tell — its `why` says what it is evidence OF', refusedAll.rows.every((r) => typeof r.why === 'string' && r.why.length > 20));
  t('the quoted line is CAPPED, so one row cannot swamp the report', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, `+  k: z.string() // ${'x'.repeat(400)}`) })[0]?.text.length <= 160);
  t('a clean verdict carries no text to mistake for a finding', removalVerdict.text === null);
  t('a not-applicable verdict likewise', yesVerdict.text === null);

  // -- the exit register ----------------------------------------------------
  battery('the exit register is distinct in every direction it must be');
  t('the four codes are four distinct values', new Set([EXIT_OK, EXIT_USAGE, EXIT_INCOMPLETE, EXIT_REFUSED]).size === 4);
  t('REFUSED is never 0 — silence is what this file exists against', EXIT_REFUSED !== EXIT_OK);
  t('INCOMPLETE is never REFUSED — an unread diff is not a widening one', EXIT_INCOMPLETE !== EXIT_REFUSED);
  const unread = wideningRefusal({ declaration: 'no', files: null });
  t('an unreadable listing is INCOMPLETE, never clean', unread.state === 'unreadable' && exitForRefusal(unread) === EXIT_INCOMPLETE);
  const gapped = wideningRefusal({ declaration: 'no', files: [{ filename: 'packages/spec/api-surface/kernel.json', patch: null }] });
  t('a surface file with no patch is INCOMPLETE, never clean', gapped.state === 'incomplete' && exitForRefusal(gapped) === EXIT_INCOMPLETE);
  t('⛔ but a REFUSAL outranks a gap — a tell that was read is a fact, whatever else was not', wideningRefusal({ declaration: 'no', files: [...positives, { filename: 'packages/spec/api-surface/ui.json', patch: null }] }).state === 'refused');

  // -- the declared rows still exist ----------------------------------------
  battery('the declared registry rows still exist in this tree');
  const localRows = REGISTRATION_SURFACES.filter((s) => s.repo === THIS_REPO);
  t('every declared registry row names a path in THIS tree — a renamed registry must red here, not go quiet', localRows.every((s) => existsSync(new URL(s.glob, `file://${ROOT}`))), localRows.filter((s) => !existsSync(new URL(s.glob, `file://${ROOT}`))).map((s) => s.glob).join(', '));
  t('the table is not empty — an empty register guards nothing while reading as protection', localRows.length >= 3);
  t('every surface row carries a `why`, so a reader can tell what it is protecting', ALL_SURFACES.every((s) => typeof s.why === 'string' && s.why.length > 10));
  t('every surface row names the repo it applies to', ALL_SURFACES.every((s) => typeof s.repo === 'string' && s.repo.includes('/')));

  // -- #17112: the count is split -------------------------------------------
  //
  // The line these cases pin used to read `N changed file(s) READ, no widening
  // tell on any declared surface`, with N counting files no declared surface
  // covers — files on which no tell could have fired whatever they contained.
  // Every case below fails if that conflation comes back, and the two controls
  // (a judged file, and the same diff still exiting 0) are here so a green
  // reading cannot come from a census that stopped classifying anything.
  battery('#17112 — the count is split: examined is not examinable');
  const OFF_SURFACE = 'packages/services/service-analytics/src/index.ts';
  const ON_SURFACE = 'packages/spec/src/api/error-code-ledger.zod.ts';
  const censusOf = (files, repo) => coverageCensus(files, repo ? { repo } : {});
  const offRow = { filename: OFF_SURFACE, status: 'modified', patch: patchOf(11, '+export type { AnalyticsDimensionLabel } from \'./labels.js\';') };
  const onRow = { filename: ON_SURFACE, status: 'modified', patch: patchOf(140, "+    'ALREADY_THERE': 1,") };
  t('a file no declared surface covers is NOT judged', censusOf([offRow]).judged.length === 0);
  t('…and the census names WHY it was not', fileCoverage(offRow).state === 'unmatched');
  t('a covered file IS judged — the control, so the census is not simply blind', censusOf([onRow]).judged.length === 1);
  const mixedCensus = censusOf([offRow, onRow]);
  t('⛔ the word that carried the defect is gone — a count of files is no longer "read"', !says(cleanVerdictLine(mixedCensus), 'changed file(s) read'));
  t('the total is still stated — ⛔ the fix is not deleting the count', says(cleanVerdictLine(mixedCensus), '2 changed file(s)'));
  t('…and what WAS judged is stated, which is what a reader needs', says(cleanVerdictLine(mixedCensus), '1 judged against a declared surface'));
  t('…beside what was not', says(cleanVerdictLine(mixedCensus), '1 NOT MEASURED'));
  const blindCensus = censusOf([offRow]);
  t('⭐ a diff with nothing examinable says so in the sentence itself', says(cleanVerdictLine(blindCensus), 'NOTHING on this diff was examined'));
  t('…and says the exit is evidence about no surface at all', says(cleanVerdictLine(blindCensus), 'evidence about no surface at all'));
  t('⛔ a diff that DID judge something does not say that', !says(cleanVerdictLine(mixedCensus), 'NOTHING on this diff was examined'));
  t('the unexaminable file is NAMED, so the reader can act on it', says(coverageLines(blindCensus).join('\n'), OFF_SURFACE));
  t('…under a heading that states the non-measurement', says(coverageLines(blindCensus).join('\n'), 'no declared surface covers it'));
  const many = Array.from({ length: 14 }, (_, i) => ({ filename: `packages/plugins/p${i}/src/index.ts`, status: 'modified', patch: patchOf(1, '+  a: 1,') }));
  t('the listing is CAPPED — a 300-file diff must not drown the verdict', coverageLines(censusOf(many)).filter((l) => l.includes('packages/plugins/')).length === 10);
  t('…and says how many it did not list, so the cap is not a second silence', says(coverageLines(censusOf(many)).join('\n'), '… and 4 more'));
  t('⛔ a DELETED file is not filed as NOT MEASURED — a deletion adds nothing, which is a measurement', censusOf([{ filename: OFF_SURFACE, status: 'removed' }])['deleted'].length === 1 && notMeasured(censusOf([{ filename: OFF_SURFACE, status: 'removed' }])).length === 0);
  t('⛔ a TEST on the contract surface is not reported as "no declared surface covers it" — a surface does', fileCoverage({ filename: 'packages/spec/src/a.test.ts', status: 'modified' }).state === 'not-contract-source');
  t('…and it is listed under the reason that is true of it', says(coverageLines(censusOf([{ filename: 'packages/spec/src/a.test.ts', status: 'modified' }])).join('\n'), 'not a contract source file'));
  t('⛔ NO verdict moved: an unexaminable diff still exits 0', verdictLines({ declaration: 'no', files: [offRow], board: { repo: THIS_REPO, source: 'default' } }).exit === EXIT_OK);
  t('⛔ and a real tell still REFUSES — the census is not a softening of the gate', verdictLines({ declaration: 'no', files: [FILE_REGISTRY], board: { repo: THIS_REPO, source: 'default' } }).exit === EXIT_REFUSED);
  t('a refusal prints no clean sentence on stdout to be mistaken for one', verdictLines({ declaration: 'no', files: [FILE_REGISTRY], board: { repo: THIS_REPO, source: 'default' } }).out.length === 0);
  t('⭐ ONE reader answers "was this judged" for the matcher and for the census', (() => {
    const f = surfaceFlags(ON_SURFACE, THIS_REPO);
    return (f.onContractSource || f.onPublished || f.onRegistry) === (fileCoverage(onRow).state === 'judged');
  })());
  t('…and it agrees with the matcher on a file the matcher declines for its KIND', (() => {
    const f = surfaceFlags('packages/spec/src/a.test.ts', THIS_REPO);
    return !f.onContractSource && !f.onPublished && !f.onRegistry && tellsInFile({ filename: 'packages/spec/src/a.test.ts', patch: patchOf(3, '+  k: z.string(),') }).length === 0;
  })());
  t('the honesty caveat #16349 ruled is still printed, verbatim in substance', says(verdictLines({ declaration: 'no', files: [offRow], board: { repo: THIS_REPO, source: 'default' } }).out.join('\n'), 'false negatives are the cost the #16349 ruling accepted'));

  // -- #17217: the CLI can be told which board it judges ---------------------
  //
  // ⭐ These cases must be driven through `main` and not through
  // `wideningRefusal`, because the defect was never in the judge: every judging
  // function already threaded `repo`, and the self-test already pinned the
  // objectui row live when a run names objectui. What no invocation could reach
  // was the CLI. A case that calls the judge directly would have passed on the
  // broken tree — that is the failure mode this battery exists against.
  battery('#17217 — the CLI can be told which board it judges');
  const OBJECTUI = 'objectstack-ai/objectui';
  const MIRROR = 'packages/types/src/zod/objectql.zod.ts';
  const mirrorAdds = [
    `diff --git a/${MIRROR} b/${MIRROR}`,
    `--- a/${MIRROR}`,
    `+++ b/${MIRROR}`,
    '@@ -20,3 +20,4 @@',
    '   limit: z.number().optional(),',
    '   offset: z.number().optional(),',
    '   sort: z.string().optional(),',
    '+  cursor: z.string().optional(),',
  ].join('\n');
  const mirrorRemovesOnly = [
    `diff --git a/${MIRROR} b/${MIRROR}`,
    `--- a/${MIRROR}`,
    `+++ b/${MIRROR}`,
    '@@ -20,4 +20,3 @@',
    '   limit: z.number().optional(),',
    '   offset: z.number().optional(),',
    '   sort: z.string().optional(),',
    '-  legacyCursor: z.string().optional(),',
  ].join('\n');
  const scratch = mkdtempSync(join(tmpdir(), 'widening-tells-selftest-'));
  const runMain = (argv, env) => {
    const realLog = console.log;
    const realError = console.error;
    const out = [];
    const err = [];
    console.log = (...a) => out.push(a.join(' '));
    console.error = (...a) => err.push(a.join(' '));
    try {
      const exit = main(argv, env);
      return { exit, out: out.join('\n'), err: err.join('\n') };
    } finally {
      console.log = realLog;
      console.error = realError;
    }
  };
  try {
    const addsPath = join(scratch, 'mirror-adds.diff');
    const removesPath = join(scratch, 'mirror-removes.diff');
    writeFileSync(addsPath, `${mirrorAdds}\n`);
    writeFileSync(removesPath, `${mirrorRemovesOnly}\n`);
    const cliArgs = (p) => ['--declaration', 'no', '--diff', p];
    const onObjectui = runMain(cliArgs(addsPath), { PM_SWEEP_REPO: OBJECTUI });
    const onDefault = runMain(cliArgs(addsPath), {});
    const realOnObjectui = runMain(cliArgs(removesPath), { PM_SWEEP_REPO: OBJECTUI });
    const onRunner = runMain(cliArgs(addsPath), { GITHUB_REPOSITORY: OBJECTUI });
    t('⭐ THE FINDING: a key added to the objectui mirror is REFUSED through the CLI', onObjectui.exit === EXIT_REFUSED);
    t('…at the mirror file, so the refusal is navigable', says(onObjectui.err, `${MIRROR}:23`));
    t('…and it is the CLI that was told, not a caller reaching past it', says(onObjectui.out + onObjectui.err, OBJECTUI));
    t('⭐ the SAME diff on the default board does not refuse — the defect, in one assertion', onDefault.exit === EXIT_OK);
    t('…and no longer reads as clean: it names the repo that COULD judge it', says(onDefault.out, `re-run with PM_SWEEP_REPO=${OBJECTUI}`));
    t('⛔ …and does NOT say "no declared surface covers it", which would be false about the mirror', !says(onDefault.out, 'no declared surface covers it'));
    t('the objectui board is not merely refusing everything: a removal-only mirror diff is clean', realOnObjectui.exit === EXIT_OK);
    t('…and that clean reading says the file WAS judged', says(realOnObjectui.out, '1 judged against a declared surface'));
    t('GITHUB_REPOSITORY is honoured too — a runner needs no second wiring', onRunner.exit === EXIT_REFUSED);
    t('⛔ the default is unchanged, so no existing caller changes meaning', runMain(cliArgs(addsPath), {}).exit === EXIT_OK && resolveSweepRepo({}).repo === THIS_REPO);
    const repoFlag = runMain(['--repo', OBJECTUI, ...cliArgs(addsPath)], {});
    t('⛔ `--repo` is REFUSED, not silently ignored — one convention, the sibling\'s', repoFlag.exit === EXIT_USAGE);
    t('…and the refusal names the variable that does work', says(repoFlag.err, 'PM_SWEEP_REPO'));
    const badBoard = runMain(cliArgs(addsPath), { PM_SWEEP_REPO: 'not-a-repo' });
    t('a malformed board is refused, ⛔ never replaced by the default', badBoard.exit === EXIT_USAGE && says(badBoard.err, 'owner/repo'));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  t('THIS_REPO is the resolver\'s own default — the import is a pin, ⛔ not a redirection', THIS_REPO === DEFAULT_SWEEP_REPO && THIS_REPO === 'objectstack-ai/objectstack');
  t('the board line names the repo', says(boardProvenanceLine({ repo: OBJECTUI, source: 'PM_SWEEP_REPO' }), OBJECTUI));
  t('…and the source it came from', says(boardProvenanceLine({ repo: OBJECTUI, source: 'PM_SWEEP_REPO' }), 'source: PM_SWEEP_REPO'));
  t('…and the fallback is named AS a fallback, with the action that changes it', says(boardProvenanceLine({ repo: THIS_REPO, source: 'default' }), 'set PM_SWEEP_REPO'));
  t('⭐ a deliberate target and the fallback are DIFFERENT lines', boardProvenanceLine({ repo: THIS_REPO, source: 'default' }) !== boardProvenanceLine({ repo: THIS_REPO, source: 'PM_SWEEP_REPO' }));
  t('the line is fed by the imported resolver, so the two cannot disagree', says(boardProvenanceLine(resolveSweepRepo({ PM_SWEEP_REPO: OBJECTUI })), OBJECTUI));
  t('⛔ the objectui row is STILL inert for a THIS_REPO run — the scoping is unchanged', !surfaceCovers(CONTRACT_SOURCE_SURFACES, MIRROR, THIS_REPO) && surfaceCovers(CONTRACT_SOURCE_SURFACES, MIRROR, OBJECTUI));
  t('…and the census reports that as "covered, for another repo", never as uncovered', fileCoverage({ filename: MIRROR, status: 'modified' }).state === 'other-repo');
  t('…naming which repo, so the reader knows what to re-run', fileCoverage({ filename: MIRROR, status: 'modified' }).repos.join(',') === OBJECTUI);

  // -- #18560 ----------------------------------------------------------------
  //
  // The counterfactual pin. Its unit is the FORM, not the assertion: a frozen
  // fixture roster is asserted EQUAL to the form set, so a form added to the
  // list without a fixture reds and a form silently dropped from the list reds.
  // ⛔ The fixtures are NOT generated from the list — a generated fixture would
  // make every future form pass by construction, which is the shape this card
  // exists because of.
  battery('#18560 — the declaring vocabulary is a NAMED list, every form pinned by a counterfactual fixture');
  const OS_SURFACE = 'packages/spec/src/kernel/manifest.zod.ts';
  const UI_SURFACE = 'packages/types/src/zod/data-display.zod.ts';
  const UI_BOARD = 'objectstack-ai/objectui';
  const FORM_FIXTURES = Object.freeze({
    'z.': { line: '+  cursor: z.string().optional(),', file: OS_SURFACE, repo: THIS_REPO },
    'lazySchema(': { line: '+  retry: lazySchema(() => RetryPolicySchema),', file: OS_SURFACE, repo: THIS_REPO },
    'strictObject(': { line: '+  window: strictObject({ from: z.string() }),', file: OS_SURFACE, repo: THIS_REPO },
    // ⭐ #18702's filing probe, verbatim — the line that exited 0 in silence at
    // 6dfa3ea77 and again at 30bac2880, on the file it was written against.
    'placeholderFree(': {
      line: "+    snapshotPath: placeholderFree(z.string(), 'persistence.snapshotPath').optional(),",
      file: 'packages/spec/src/data/driver/memory.zod.ts',
      repo: THIS_REPO,
    },
    '*Schema': { line: '+  retry: RetryPolicySchema.optional(),', file: OS_SURFACE, repo: THIS_REPO },
    'stripImportedDefaults(': {
      line: "+  id: stripImportedDefaults(SpecNavigationAreaSchema).shape.id.describe('Unique identifier'),",
      file: UI_SURFACE,
      repo: UI_BOARD,
    },
    'retiredKey(': { line: "+  legacy: retiredKey('gone'),", file: OS_SURFACE, repo: THIS_REPO },
    'retirementTombstone(': {
      line: "+  body: retirementTombstone('body is RETIRED (ADR-0049) — author content instead.'),",
      file: UI_SURFACE,
      repo: UI_BOARD,
    },
    'handlerKeyRefusal(': {
      line: "+  onNodeClick: handlerKeyRefusal('onNodeClick', 'runtime-slot', 'Node click handler'),",
      file: UI_SURFACE,
      repo: UI_BOARD,
    },
    'aliasKeyRefusal(': {
      line: "+  chartType: aliasKeyRefusal('chartType', 'type', 'this chart series', 'Write type.'),",
      file: UI_SURFACE,
      repo: UI_BOARD,
    },
  });
  const fixtureRows = (fx) => tellsInFile({ filename: fx.file, status: 'modified', patch: patchOf(30, fx.line) }, { repo: fx.repo });
  const formNames = SCHEMA_PROPERTY_FORMS.map((f) => f.form);
  const fixtureNames = Object.keys(FORM_FIXTURES);
  const missingFixture = formNames.filter((n) => !fixtureNames.includes(n));
  const orphanFixture = fixtureNames.filter((n) => !formNames.includes(n));
  t(
    `⭐ every form in the list has a counterfactual fixture — a new form with no fixture reds HERE${missingFixture.length ? ` (missing: ${missingFixture.join(', ')})` : ''}`,
    missingFixture.length === 0,
  );
  t(
    `⭐ …and every fixture names a form still IN the list — a form silently dropped reds HERE${orphanFixture.length ? ` (orphaned: ${orphanFixture.join(', ')})` : ''}`,
    orphanFixture.length === 0,
  );
  t('…the list is not empty, and carries BOTH registers — a one-register list is a vocabulary that forgot the decline', SCHEMA_PROPERTY_FORMS.some((f) => f.writable) && SCHEMA_PROPERTY_FORMS.some((f) => !f.writable));
  t('⛔ every unwritable form ENDS at its open paren, the character `declaresUnwritableKey` hands to `matchingCloser`', SCHEMA_PROPERTY_FORMS.filter((f) => !f.writable).every((f) => f.pattern.endsWith('\\(')));
  t('…and every row carries its own measurement WITH the tree it was taken against — a count with no tree is not a reading', SCHEMA_PROPERTY_FORMS.every((f) => typeof f.measured === 'string' && /\b(?:objectstack|objectui) [0-9a-f]{7,}/.test(f.measured)));

  // RECOGNITION is the first half and it is asserted for EVERY form, writable
  // or not: an unrecognised line is invisible to both sides of the #16943
  // budget, which is the defect itself rather than a consequence of it.
  for (const [form, fx] of Object.entries(FORM_FIXTURES)) {
    t(`\`${form}\` is RECOGNISED as a key line — \`memberTellKind\` answers T1`, memberTellKind(fx.line.slice(1), { onContractSource: true }) === 'T1');
  }
  // The VERDICT is the second half, and each form is asserted against its own
  // register rather than against one expectation for all nine.
  for (const f of SCHEMA_PROPERTY_FORMS) {
    const fx = FORM_FIXTURES[f.form];
    const rows = fx ? fixtureRows(fx) : [];
    if (f.writable) {
      t(`⭐ \`${f.form}\` declares a WRITABLE key, so a \`Clause-②: no\` diff carrying it FIRES — with its own file:line`, rows.length === 1 && rows[0]?.tell === 'T1' && rows[0]?.line === 30);
    } else {
      t(`⭐ \`${f.form}\` declares a key UNWRITABLE, so it is recognised and DECLINES — a stated silence, never an unseen line`, rows.length === 0 && declaresUnwritableKey(fx.line.slice(1)) === true);
    }
  }
  // ⛔ The decline is bound to the evidence the line carries, never to the
  // helper's name: chain a live arm onto the refusal and the key is writable
  // again, so the same fixture FIRES. #17955 established this for `retiredKey`
  // and it is asserted here for every member of the family.
  for (const f of SCHEMA_PROPERTY_FORMS.filter((x) => !x.writable)) {
    const fx = FORM_FIXTURES[f.form];
    const chained = { ...fx, line: `${fx.line.replace(/,$/, '')}.or(z.string()),` };
    t(`⛔ …and a live arm CHAINED onto \`${f.form}\` leaves the key writable, so it FIRES`, fixtureRows(chained)[0]?.tell === 'T1');
  }

  // -- the objectui#9647 shape, and the red this round turns ------------------
  const NINE647_LINE = "+  onNodeClick: handlerKeyRefusal('onNodeClick', 'runtime-slot', 'Node click handler'),";
  const nine647 = { filename: UI_SURFACE, status: 'modified', patch: patchOf(551, NINE647_LINE) };
  t('⭐ the objectui#9647 line is now SEEN — before this round `memberTellKind` answered `null` on it', memberTellKind(NINE647_LINE.slice(1), { onContractSource: true }) === 'T1');
  t('…and it DECLINES, because a refusal arm takes a spelling away rather than adding one', tellsInFile(nine647, { repo: UI_BOARD }).length === 0 && declaresUnwritableKey(NINE647_LINE.slice(1)) === true);
  t('…so a correct `Clause-②: no` on that PR still reads CLEAN end to end', wideningRefusal({ declaration: 'no', files: [nine647], repo: UI_BOARD }).state === 'clean');
  // ⭐ THE COUNTERFACTUAL: the same objectui arm, widened through the LIVE
  // declaring helper the card had not named. This is the row that was silent at
  // 6dfa3ea77 and is refused now.
  const widened = {
    filename: UI_SURFACE,
    status: 'modified',
    patch: patchOf(551, "+  density: stripImportedDefaults(SpecTreeViewSchema).shape.density.describe('Row density'),"),
  };
  t('⭐ THE FINDING: a key added to the objectui mirror through `stripImportedDefaults(` is a widening, and it FIRES', tellsInFile(widened, { repo: UI_BOARD })[0]?.tell === 'T1');
  t('…at the line the author can open', tellsInFile(widened, { repo: UI_BOARD })[0]?.line === 551);
  t('…and the whole verdict is a REFUSAL, not a clean reading', wideningRefusal({ declaration: 'no', files: [widened], repo: UI_BOARD }).state === 'refused');
  t('⛔ CONTROL — the identical diff with `Clause-②: yes` is not refused: this file never blocks the honest declaration', wideningRefusal({ declaration: 'yes', files: [widened], repo: UI_BOARD }).state !== 'refused');
  t('⛔ CONTROL — the same widening on the DEFAULT board is not judged, so the board resolution is still what decides it', wideningRefusal({ declaration: 'no', files: [widened] }).state !== 'refused');

  // -- the vocabulary only ever GREW ------------------------------------------
  //
  // ⭐ The literal this round replaced, kept HERE as the reference rather than
  // described in prose: every legacy verdict must be byte-identical, and the
  // only cells allowed to move are the four added forms moving from "not a key
  // line" to "a key line". One direction, zero losses — which is what makes
  // this a strengthening and not a change to the `no` criterion.
  const LEGACY_SCHEMA_PROPERTY =
    /^[ \t]*(?:'[^']+'|"[^"]+"|\[[^\]]+\]|[A-Za-z_$][\w$]*)[ \t]*\??[ \t]*:[ \t]*(?:z\.|lazySchema\(|strictObject\(|retiredKey\(|[A-Za-z_$][\w$]*Schema\b)/;
  const ADDED_FORMS = ['stripImportedDefaults(', 'retirementTombstone(', 'handlerKeyRefusal(', 'aliasKeyRefusal(', 'placeholderFree('];
  const legacyProbes = [
    ...Object.entries(FORM_FIXTURES).map(([form, fx]) => ({ text: fx.line.slice(1), added: ADDED_FORMS.includes(form) })),
    { text: '  enabled: true,', added: false },
    { text: '  name: string;', added: false },
    { text: '  // cursor: z.string(),', added: false },
    { text: '  ctx: z.RefinementCtx,', added: false },
  ];
  const grew = legacyProbes.filter((p) => !LEGACY_SCHEMA_PROPERTY.test(p.text) && SCHEMA_PROPERTY.test(p.text));
  const lost = legacyProbes.filter((p) => LEGACY_SCHEMA_PROPERTY.test(p.text) && !SCHEMA_PROPERTY.test(p.text));
  t('⭐ ⛔ NOTHING the legacy literal recognised is unrecognised now — a vocabulary that SHRANK is the failure this list is against', lost.length === 0);
  t('…and every cell that moved is one of the forms these rounds ADDED, never a line that merely looks new', grew.length === ADDED_FORMS.length && grew.every((p) => p.added));
  t('⛔ …a comment is still not a key line, whichever vocabulary reads it', memberTellKind('  // cursor: z.string(),', { onContractSource: true }) === null);
  t('⛔ …and #17618’s parameter decline is untouched by the wider vocabulary', tellsInFile({ filename: OS_SURFACE, status: 'modified', patch: '@@ -30,0 +30,3 @@\n+export const refine = (\n+  ctx: z.RefinementCtx,\n+) => ctx;' }).length === 0);

  // -- #18640: an inline closed set RE-SPELLED at the same binding -----------
  //
  // The live pair is PR #18638 (card #15811): `const ActionConditionInputSchema
  // = z.union([z.boolean(), ExpressionInputSchema]);` gains a zod options object
  // — `, { error: … }` — and the union carries the SAME members before and
  // after. `--pair 18638` exited 4 on row C5 against a declaration two at-tier
  // contract reviews had read as correct.
  //
  // ⭐ Read the CONTROL SET first, because the control set IS the finding: the
  // identical edit spelled one member per line declines today, and so does the
  // identical edit at a KEYED property. Three spellings of one semantic change,
  // two opposite verdicts — the accidental variable, in one pair of assertions.
  //
  // ⭐ And read the FIRING half before the decline, the way #17300's, #17955's
  // and #18234's batteries are ordered: a reading that can only suppress is
  // untestable in the direction that matters, so the decline is bracketed on
  // every side — a member ADDED beside the options object, a DIFFERENT binding,
  // a brand-new declaration with nothing removed, an enum widened in place, and
  // a genuine new key riding along that must still report.
  battery('#18640 — an inline closed set RE-SPELLED at the same binding is not a set that gained a value');
  const INLINE_SURFACE = 'packages/spec/src/ui/action.zod.ts';
  const inlineDiff = (start, ...lines) => ({
    filename: INLINE_SURFACE,
    status: 'modified',
    patch: [`@@ -${start},3 +${start},${lines.length + 1} @@ context`, ' const before = 1;', ...lines, ' const after = 2;'].join('\n'),
  });
  // The card's own specimen: the members are byte-identical, only the options
  // object is new. ⛔ No rename in this fixture — the rename is a SEPARATE
  // question and the case below pins that it is still refused.
  const OPTIONS_APPENDED = inlineDiff(
    830,
    '-const ActionConditionInputSchema = z.union([z.boolean(), ExpressionInputSchema]);',
    '+const ActionConditionInputSchema = z.union([z.boolean(), ExpressionInputSchema], {',
    '+  error: (issue) => evaluatedExpressionUnionRefusal(issue.input),',
    '+});',
  );
  // The same edit, one member per line — what the gate has done since #16943.
  const OPTIONS_APPENDED_MULTILINE = inlineDiff(
    830,
    '-const ActionConditionInputSchema = z.union([',
    '-  z.boolean(),',
    '-  ExpressionInputSchema,',
    '-]);',
    '+const ActionConditionInputSchema = z.union([',
    '+  z.boolean(),',
    '+  ExpressionInputSchema,',
    '+], {',
    '+  error: (issue) => evaluatedExpressionUnionRefusal(issue.input),',
    '+});',
  );
  // ⭐ THE COUNTERFACTUAL the repair owes: a real arm added ALONGSIDE the
  // options object. The list grew, so the surplus reports — this is the whole
  // sensitivity guarantee, and a fix that cannot demonstrate it is not a fix.
  const ARM_ADDED_BESIDE_OPTIONS = inlineDiff(
    830,
    '-const ActionConditionInputSchema = z.union([z.boolean(), ExpressionInputSchema]);',
    '+const ActionConditionInputSchema = z.union([z.boolean(), ExpressionInputSchema, LegacyStringSchema], {',
    '+  error: (issue) => evaluatedExpressionUnionRefusal(issue.input),',
    '+});',
  );
  const DIFFERENT_BINDING = inlineDiff(
    830,
    '-const ActionConditionInputSchema = z.union([z.boolean(), ExpressionInputSchema]);',
    '+const OtherConditionInputSchema = z.union([z.boolean(), ExpressionInputSchema], {',
    '+  error: (issue) => evaluatedExpressionUnionRefusal(issue.input),',
    '+});',
  );
  const BRAND_NEW_DECLARATION = inlineDiff(830, '+const ActionConditionInputSchema = z.union([z.boolean(), ExpressionInputSchema]);');
  const ENUM_WIDENED_INLINE = inlineDiff(
    830,
    "-const ActionModeSchema = z.enum(['eager', 'lazy']);",
    "+const ActionModeSchema = z.enum(['eager', 'lazy', 'scheduled']);",
  );
  const ENUM_NARROWED_INLINE = inlineDiff(
    830,
    "-const ActionModeSchema = z.enum(['eager', 'lazy', 'scheduled']);",
    "+const ActionModeSchema = z.enum(['eager', 'lazy']);",
  );
  const RESPELL_PLUS_NEW_KEY = inlineDiff(
    830,
    '-const ActionConditionInputSchema = z.union([z.boolean(), ExpressionInputSchema]);',
    '+const ActionConditionInputSchema = z.union([z.boolean(), ExpressionInputSchema], {',
    '+  error: (issue) => evaluatedExpressionUnionRefusal(issue.input),',
    '+});',
    '+  brandNewKey: z.string(),',
  );
  t('⛔ THE CONTROL SET — the same edit spelled one member per line declines, and has since #16943', tells(OPTIONS_APPENDED_MULTILINE).length === 0);
  t("⛔ …and the same edit at a KEYED property declines too (#17848's battery pins that half)", tells({ filename: INLINE_SURFACE, status: 'modified', patch: ['@@ -1591,3 +1591,5 @@ export const RecordAlertProps = strictObject({', '   title: I18nLabelSchema.optional(),', "-  visible: z.union([z.boolean(), ExpressionInputSchema]).optional().describe('x'),", '+  visible: z.union([z.boolean(), ExpressionInputSchema], {', '+    error: (issue) => evaluatedExpressionUnionRefusal(issue.input),', "+  }).optional().describe('x'),", '   icon: z.string(),'].join('\n') }).length === 0);
  t("⭐ THE FINDING: the card's specimen — the SAME members, a zod options object appended — is not a set that gained a value", tells(OPTIONS_APPENDED).length === 0);
  t('…and the pair reads CLEAN end to end, which is the exit code the card reported as unreachable', wideningRefusal({ declaration: 'no', files: [OPTIONS_APPENDED] }).state === 'clean');
  t('⭐ THE COUNTERFACTUAL — a real ARM added beside the options object still FIRES: the list grew and the surplus reports', tells(ARM_ADDED_BESIDE_OPTIONS).length === 1 && tells(ARM_ADDED_BESIDE_OPTIONS)[0]?.tell === 'T2');
  t('…at the line that declares the set, the line the author can open', at(ARM_ADDED_BESIDE_OPTIONS)[0] === `${INLINE_SURFACE}:831`);
  t('⭐ …and a genuine new KEY riding along still fires — this reading takes nothing out of the #16943 budget', tells(RESPELL_PLUS_NEW_KEY).length === 1 && tells(RESPELL_PLUS_NEW_KEY)[0]?.tell === 'T1');
  t('⛔ DARK CONTROL — a BRAND-NEW declaration has no removal to pay for it and fires', tells(BRAND_NEW_DECLARATION).length === 1 && tells(BRAND_NEW_DECLARATION)[0]?.tell === 'T2');
  t('⛔ CONTROL — a DIFFERENT binding is not the same set: the removal pays nothing and the row fires', tells(DIFFERENT_BINDING).length === 1 && tells(DIFFERENT_BINDING)[0]?.tell === 'T2');
  t('⛔ CONTROL — an inline `z.enum` WIDENED in place still fires: this is the row that can report it and nothing else can', tells(ENUM_WIDENED_INLINE).length === 1 && tells(ENUM_WIDENED_INLINE)[0]?.tell === 'T2');
  t('⭐ …and the same enum NARROWED in place declines, which is the direction clause ② exists to let through', tells(ENUM_NARROWED_INLINE).length === 0);
  t('⛔ the KEYED subset test is UNTOUCHED — a keyed union whose member was RENAMED still fires, because that ruling is not this round\'s', tells({ filename: INLINE_SURFACE, status: 'modified', patch: ['@@ -1591,3 +1591,3 @@ export const RecordAlertProps = strictObject({', '   title: I18nLabelSchema.optional(),', "-  visible: z.union([z.boolean(), ExpressionInputSchema]).optional().describe('x'),", "+  visible: z.union([z.boolean(), EvaluatedExpressionInputSchema]).optional().describe('x'),", '   icon: z.string(),'].join('\n') }).length === 1);
  t('⛔ …and a KEYED line is refused by the binding reading itself, so the two populations cannot merge by accident', closedSetBindingMembers("  visible: z.union([z.boolean(), ExpressionInputSchema], {") === null);
  t('⛔ an ANONYMOUS inline set declares no binding, so two of them in one block are not evidence they are the same set', closedSetBindingMembers('  z.union([z.boolean(), ExpressionInputSchema]),') === null);
  t('⛔ a list that does not CLOSE on the line is unreadable, and an unreadable list keeps the tell', closedSetBindingMembers('const ActionConditionInputSchema = z.union([z.boolean(),') === null);
  t('⭐ a readable one carries the binding AND the members, both off the one line', JSON.stringify(closedSetBindingMembers('const C = z.union([z.boolean(), ExpressionInputSchema], {')) === JSON.stringify({ binding: 'const C =', members: ['z.boolean()', 'ExpressionInputSchema'] }));
  t('⛔ a comment is not a declaration, whichever bracket it carries', closedSetBindingMembers("// const C = z.union([z.boolean(), ExpressionInputSchema]);") === null);
  t('⛔ the arithmetic is a MULTISET: a member repeated where the removed list carried it once is a member GAINED', respellsExistingClosedSetBinding("const C = z.enum(['a', 'a']);", ["const C = z.enum(['a']);"]) === false);
  t('⭐ …and a one-for-one swap at the same binding is a replacement, not a net addition — #16943’s own ruling, applied inline', respellsExistingClosedSetBinding("const C = z.enum(['a', 'b']);", ["const C = z.enum(['a', 'c']);"]) === true);
  t('⛔ …while a list that GREW is not, however much of it is unchanged', respellsExistingClosedSetBinding("const C = z.enum(['a', 'b', 'c']);", ["const C = z.enum(['a', 'b']);"]) === false);
  t('⛔ a removal in a DIFFERENT change block buys nothing — the block is the unit, as it is for #16943 and #17618', respellsExistingClosedSetBinding("const C = z.enum(['a']);", []) === false);
  t('⛔ CONTROL — the identical specimen with `Clause-②: yes` is not refused either way: this file never blocks the honest declaration', wideningRefusal({ declaration: 'yes', files: [ARM_ADDED_BESIDE_OPTIONS] }).state !== 'refused');


  // -- #18702 ----------------------------------------------------------------
  //
  // The counterfactual pin, in #18560's shape and for the same reason: the unit
  // is the FACTORY, and a frozen fixture roster is asserted EQUAL to the set of
  // factories the filing card names, so a factory dropped from the roster reds
  // here rather than going quiet.
  //
  // ⭐ Each fixture carries that factory's REAL definition from the tip —
  // signature verbatim, return expression verbatim at its opener, prose
  // truncated — and its `returns` field is asserted to be text the definition
  // actually contains, so a fixture cannot drift into describing a definition
  // it does not carry. ⛔ The fixtures are NOT read off the tree: a generated
  // fixture makes every future factory pass by construction, which is the shape
  // this card exists because of.
  battery('#18702 — a declaring factory PRIVATE to one file, resolved through its own DEFINITION');
  const DRIVER_COMMON = 'packages/spec/src/data/driver/common.zod.ts';
  const BLUEPRINT = 'packages/spec/src/ai/solution-blueprint.zod.ts';
  const COMPONENT = 'packages/spec/src/ui/component.zod.ts';
  const DATASOURCE = 'packages/spec/src/data/datasource.zod.ts';
  const FILTER_RULE_ARRAY = 'packages/spec/src/ui/filter-rule-array.ts';
  const MEMORY_DRIVER = 'packages/spec/src/data/driver/memory.zod.ts';
  // The eight the card names, and nothing else — the roster this battery is
  // held equal to.
  const CARD_FACTORIES = Object.freeze([
    'placeholderFree', 'strictIdent', 'strictIdentOrNull', 'emptyProps',
    'objectBlockHistory', 'belongsInConfig', 'INLINE_CREDENTIAL_REFUSED', 'ruleArrayFilterError',
  ]);
  const FACTORY_FIXTURES = Object.freeze({
    placeholderFree: {
      where: DRIVER_COMMON,
      measured: '23 key lines at objectstack 30bac2880, 0 of them file-local',
      arm: 'writable',
      returns: 'return schema.superRefine((value, ctx) => {',
      definition:
        'export function placeholderFree<S extends z.ZodString>(schema: S, key: string) {\n'
        + '  return schema.superRefine((value, ctx) => {\n'
        + "    if (typeof value !== 'string') return;\n"
        + '  });\n}\n',
      line: "+    snapshotPath: placeholderFree(z.string(), 'persistence.snapshotPath').optional(),",
    },
    strictIdent: {
      where: BLUEPRINT,
      measured: '12 key lines at objectstack 30bac2880, all 12 file-local',
      arm: 'writable',
      returns: 'z.string().regex(SNAKE_CASE).describe(description)',
      definition: 'const strictIdent = (description: string) => z.string().regex(SNAKE_CASE).describe(description);\n',
      line: "+  snapshotObject: strictIdent('Object whose snapshot is taken (snake_case)'),",
    },
    strictIdentOrNull: {
      where: BLUEPRINT,
      measured: '8 key lines at objectstack 30bac2880, all 8 file-local',
      arm: 'writable',
      returns: 'z.string().regex(SNAKE_CASE).nullable().describe(description)',
      definition:
        'const strictIdentOrNull = (description: string) =>\n'
        + '  z.string().regex(SNAKE_CASE).nullable().describe(description);\n',
      line: "+  snapshotField: strictIdentOrNull('Numeric field to snapshot, or null'),",
    },
    emptyProps: {
      where: COMPONENT,
      measured: '9 key lines at objectstack 30bac2880, all 9 file-local',
      arm: 'writable',
      returns: 'strictObject(',
      definition:
        'const emptyProps = (type: string) =>\n'
        + '  strictObject(\n'
        + '    {\n'
        + '      guidanceSets: COMPONENT_LEVEL_GUIDANCE,\n'
        + '    },\n'
        + '    {},\n'
        + '  );\n',
      line: "+  'nav:launcher': emptyProps('nav:launcher'),",
    },
    objectBlockHistory: {
      where: COMPONENT,
      measured: '9 key lines at objectstack 30bac2880, all 9 file-local',
      arm: null,
      returns: '`Until this type was added to ComponentPropsMap',
      definition:
        'const objectBlockHistory = (type: string) =>\n'
        + '  `Until this type was added to ComponentPropsMap, it had no entry there at all, so `\n'
        + "  + 'the authoring gate skipped it.';\n",
      line: "+  history: objectBlockHistory('object-grid'),",
    },
    belongsInConfig: {
      where: DATASOURCE,
      measured: '8 key lines at objectstack 30bac2880, all 8 file-local',
      arm: null,
      returns: '`is a driver connection detail',
      definition:
        'const belongsInConfig = (key: string, canonical: string = key) =>\n'
        + '  `is a driver connection detail — it belongs inside config, not at the top level.`;\n',
      line: "+      host: belongsInConfig('host'),",
    },
    INLINE_CREDENTIAL_REFUSED: {
      where: DRIVER_COMMON,
      measured: '10 key lines at objectstack 30bac2880, 0 of them file-local',
      arm: null,
      returns: '`is a credential and is not accepted inline',
      definition:
        'export const INLINE_CREDENTIAL_REFUSED = (key: string): string =>\n'
        + '  `is a credential and is not accepted inline in driver config: the `\n'
        + "  + 'datasource is persisted whole into sys_metadata.';\n",
      line: "+      passwd: INLINE_CREDENTIAL_REFUSED('passwd'),",
    },
    ruleArrayFilterError: {
      where: FILTER_RULE_ARRAY,
      measured: '11 key lines at objectstack 30bac2880, 0 of them file-local',
      arm: null,
      returns: 'return (issue) => {',
      definition:
        'export function ruleArrayFilterError(options: RuleArrayFilterErrorOptions): z.core.$ZodErrorMap {\n'
        + '  const { surface, migration } = options;\n\n'
        + '  return (issue) => {\n'
        + "    if (issue.code !== 'invalid_type') return undefined;\n"
        + '  };\n}\n',
      line: '+    error: ruleArrayFilterError({',
    },
  });
  const rosterMissing = CARD_FACTORIES.filter((n) => FACTORY_FIXTURES[n] === undefined);
  const rosterOrphan = Object.keys(FACTORY_FIXTURES).filter((n) => !CARD_FACTORIES.includes(n));
  t(
    `⭐ every factory the card names has a fixture — a new one with no fixture reds HERE${rosterMissing.length ? ` (missing: ${rosterMissing.join(', ')})` : ''}`,
    rosterMissing.length === 0,
  );
  t(
    `⭐ …and every fixture names a factory still on that roster — one silently dropped reds HERE${rosterOrphan.length ? ` (orphaned: ${rosterOrphan.join(', ')})` : ''}`,
    rosterOrphan.length === 0,
  );
  t(
    '⛔ …and every fixture QUOTES a return its own definition really carries — a fixture describing a definition it does not hold pins nothing',
    Object.values(FACTORY_FIXTURES).every((fx) => fx.definition.includes(fx.returns.replace(/^return /, ''))),
  );
  t('…each carrying its measurement WITH the tree it was taken against — a count with no tree is not a reading', Object.values(FACTORY_FIXTURES).every((fx) => /\bobjectstack [0-9a-f]{7,}/.test(fx.measured)));

  const localRun = (where, line, source, opts = {}) => {
    const unresolved = [];
    const file = { filename: where, status: 'modified', patch: patchOf(30, line) };
    const rows = tellsInFile(file, {
      repo: opts.repo ?? THIS_REPO,
      readSource: opts.blind === true ? () => null : () => source,
      unresolved,
    });
    return { rows, unresolved, file };
  };

  // RESOLUTION is the first half, asserted for every fixture against its own
  // arm — a writable factory, and one whose body mints prose or an error map
  // rather than a schema. ⛔ `null` is a THIRD state and never rounded to
  // either: it is what a name-shaped heuristic would have guessed at.
  for (const name of CARD_FACTORIES) {
    const fx = FACTORY_FIXTURES[name];
    const read = resolveDeclaringFactory(fx.definition, name);
    t(
      fx.arm === 'writable'
        ? `⭐ \`${name}(\` returns \`${fx.returns}\` ⇒ a WRITABLE key`
        : `⭐ \`${name}(\` returns \`${fx.returns}\` ⇒ NOT a schema this reader classifies — a named silence, never a guess`,
      read.verdict === fx.arm,
      `verdict ${JSON.stringify(read.verdict)} — ${read.reason}`,
    );
  }
  // The VERDICT is the second half, each fixture against its own arm.
  for (const name of CARD_FACTORIES) {
    const fx = FACTORY_FIXTURES[name];
    const { rows, unresolved } = localRun(fx.where, fx.line, fx.definition);
    if (fx.arm === 'writable') {
      t(
        `⭐ \`${name}(\` declares a WRITABLE key, so a \`Clause-②: no\` diff carrying it FIRES — with its own file:line`,
        rows.length === 1 && rows[0]?.tell === 'T1' && rows[0]?.line === 30 && unresolved.length === 0,
      );
    } else {
      t(
        `⭐ \`${name}(\` is unclassifiable, so nothing fires — and the line is REPORTED by name rather than swallowed`,
        rows.length === 0 && unresolved.length === 1 && unresolved[0]?.name === name && unresolved[0]?.line === 30,
      );
    }
  }

  // -- the REFUSING arm, read off a definition rather than off a name --------
  const REFUSAL_DEFINITION =
    'export function refusedInlineCredentialKey(key: string, formTitle: string) {\n'
    + '  return z.never({ error: () => INLINE_CREDENTIAL_REFUSED(key) }).optional()\n'
    + "    .describe('Set through the connection form secret field');\n}\n";
  const REFUSAL_LINE = "+  password: refusedInlineCredentialKey('password', 'Password'),";
  t('⭐ a file-local factory whose body returns `z.never(…)` declares the key UNWRITABLE — the same primitive `retiredKey(` carries, read off the DEFINITION', resolveDeclaringFactory(REFUSAL_DEFINITION, 'refusedInlineCredentialKey').verdict === 'refusing');
  t('…so it is RECOGNISED and DECLINES — a stated silence, and NOT an unresolved line either', localRun(DRIVER_COMMON, REFUSAL_LINE, REFUSAL_DEFINITION).rows.length === 0 && localRun(DRIVER_COMMON, REFUSAL_LINE, REFUSAL_DEFINITION).unresolved.length === 0);
  t('⛔ …and a live arm CHAINED onto it leaves the key writable, so it FIRES — the decline is bound to the line\'s own evidence, never to the factory', localRun(DRIVER_COMMON, `${REFUSAL_LINE.replace(/,$/, '')}.or(z.string()),`, REFUSAL_DEFINITION).rows[0]?.tell === 'T1');

  // -- THE COUNTERFACTUAL ----------------------------------------------------
  //
  // ⭐ A key added through a factory the shared list has NO row for, declared
  // in the file that uses it. It is silent before and fires after, and the
  // "before" is taken by disabling the RESOLVER — ⛔ never by editing the
  // fixture, which would prove nothing about the reading.
  //
  // ⚠️ It is `strictIdent(` and not the card's own probe line, and the reason is
  // the finding rather than a fixture preference: `placeholderFree` is EXPORTED
  // and imported at all 23 of its key positions, so it is a
  // `SCHEMA_PROPERTY_FORMS` row (above, with its own counterfactual fixture) and
  // no reading of ONE file could ever have reached it. A counterfactual anchored
  // on it would pass through the fast path and pin nothing about this resolver.
  const PROBE = FACTORY_FIXTURES.strictIdent;
  t('⭐ THE FINDING: a new key added through a file-local declaring factory FIRES — the row that was silent at 30bac2880', localRun(PROBE.where, PROBE.line, PROBE.definition).rows[0]?.tell === 'T1');
  t('…at the line the author can open', localRun(PROBE.where, PROBE.line, PROBE.definition).rows[0]?.line === 30);
  t('⭐ CONTROL — the SAME fixture with the resolver blind is silent, which is the state this card measured', localRun(PROBE.where, PROBE.line, PROBE.definition, { blind: true }).rows.length === 0);
  t('…and the whole verdict is a REFUSAL, not a clean reading', wideningRefusal({ declaration: 'no', files: [localRun(PROBE.where, PROBE.line, PROBE.definition).file], readSource: () => PROBE.definition }).state === 'refused');
  t('⛔ CONTROL — the identical diff with `Clause-②: yes` is not refused: this file never blocks the honest declaration', wideningRefusal({ declaration: 'yes', files: [localRun(PROBE.where, PROBE.line, PROBE.definition).file], readSource: () => PROBE.definition }).state !== 'refused');
  t('⛔ CONTROL — the same widening judged on the objectui board is not judged at all, so the board resolution still decides it', wideningRefusal({ declaration: 'no', files: [localRun(PROBE.where, PROBE.line, PROBE.definition).file], repo: UI_BOARD, readSource: () => PROBE.definition }).state !== 'refused');

  // -- BOUNDARY ONE: an IMPORTED factory ------------------------------------
  //
  // ⭐ `refusedInlineCredentialKey(` is a real one: declared in `common.zod.ts`,
  // imported at all four of its key positions on the driver files.
  const MONGO_DRIVER = 'packages/spec/src/data/driver/mongo.zod.ts';
  const importedRun = localRun(MONGO_DRIVER, REFUSAL_LINE, "import { refusedInlineCredentialKey } from './common.zod';\n");
  t('⛔ BOUNDARY ONE — a factory defined in ANOTHER file stays unrecognised: imports are not chased', importedRun.rows.length === 0);
  t('⭐ …but the silence is STATED — the line is reported with its file:line, the factory and the reason', importedRun.unresolved.length === 1 && importedRun.unresolved[0]?.name === 'refusedInlineCredentialKey' && importedRun.unresolved[0]?.reason.includes('IMPORTED'));
  t('…and the reader PRINTS it, so exit 0 is no longer evidence about that line', unresolvedLines(importedRun.unresolved).some((l) => l.includes(`${MONGO_DRIVER}:30`)));
  // ⭐ …and the card's OWN probe line is no longer one of these at all. It is a
  // `SCHEMA_PROPERTY_FORMS` row now, so it fires through the FAST PATH — with
  // the resolver blind, which is what proves the row and not the resolver
  // carries it.
  t('⭐ the filing probe — `placeholderFree(` on `memory.zod.ts` — FIRES through the shared list, resolver blind: an EXPORTED helper was never the file-local class', localRun(MEMORY_DRIVER, FACTORY_FIXTURES.placeholderFree.line, '', { blind: true }).rows[0]?.tell === 'T1');
  t('⛔ …while an empty list prints NOTHING — a heading with no rows would read as a finding', unresolvedLines([]).length === 0 && unresolvedLines(null).length === 0);

  // -- BOUNDARY TWO: a body this reader cannot read -------------------------
  t('⛔ BOUNDARY TWO — two definitions of one name in a file are AMBIGUOUS, never "the first one"', resolveDeclaringFactory('const dup = (a: string) => z.string();\nconst dup = (a: string) => z.never();\n', 'dup').verdict === null);
  t('⛔ …a body with no `return` this reader can find stays unresolved', resolveDeclaringFactory('function opaque(a) {\n  doSomething(a);\n}\n', 'opaque').verdict === null);
  t('⭐ …and a `return` belonging to a NESTED callback is not read as the factory\'s own — the quiet direction, refused by brace depth', resolveDeclaringFactory('function live(schema) {\n  const g = () => {\n    return z.never();\n  };\n  return schema;\n}\n', 'live').verdict === 'writable');
  t('⛔ …a factory named in a COMMENT is no definition — the declaration must follow the line\'s indentation and nothing else', resolveDeclaringFactory('// const ghost = (a: string) => z.string();\n * const ghost = (a: string) => z.string();\n', 'ghost').verdict === null);

  // -- the head BLOB, which is what makes this reading legal after #17300 ----
  t('the API row carries the head blob as `sha`', headBlobId({ filename: 'x.ts', sha: 'a'.repeat(40) }) === 'a'.repeat(40));
  t('…and the local path carries the same fact in its `index <old>..<new>` line', headBlobId({ filename: 'x.ts', patch: 'index eb82214af9..34232a3ac5 100644\n@@ -1,0 +1,1 @@\n+x' }) === '34232a3ac5');
  t('⛔ …an all-zero id is no blob — a deleted side names nothing to read', headBlobId({ filename: 'x.ts', patch: 'index eb82214af9..0000000 100644\n@@ -1,1 +1,0 @@\n-x' }) === null);
  t('⭐ ⛔ …and a patch that names NEITHER answers null, which is why every other fixture in this file never touches an object store', headBlobId({ filename: 'x.ts', patch: patchOf(30, '+  a: z.string(),') }) === null);
  t('⛔ …a path that climbs out of the tree is never read, whatever id it carries', headBlobSource({ filename: '../elsewhere/x.ts', sha: 'a'.repeat(40) }) === null);

  // -- the direction: the resolver only ever ADDS ----------------------------
  t('⭐ the shared vocabulary is the FAST PATH — a line `SCHEMA_PROPERTY` already reads is never re-judged here', keyValueFactoryName('  window: strictObject({ from: z.string() }),') === null && keyValueFactoryName("  legacy: retiredKey('gone'),") === null);
  t('…and a line it does not read hands over its identifier', keyValueFactoryName("  snapshotObject: strictIdent('x'),") === 'strictIdent');
  t('⛔ a line that fires WITHOUT the resolver still fires with it — the `no` criterion is untouched', localRun(BLUEPRINT, '+  cursor: z.string().optional(),', FACTORY_FIXTURES.strictIdent.definition).rows[0]?.tell === 'T1');
  t('⭐ ⛔ the resolver is read on the ADDED side ONLY: a REMOVED local-factory key buys nothing, so a `z.` key added beside it STILL fires', tellsInFile({ filename: BLUEPRINT, status: 'modified', patch: "@@ -30,1 +30,1 @@\n-  gone: strictIdent('x'),\n+  cursor: z.string().optional()," }, { readSource: () => FACTORY_FIXTURES.strictIdent.definition }).length === 1);
  t('⚠️ …and the PRICE of that asymmetry, pinned rather than discovered: a block REPLACING one local-factory key with another fires on the added one', tellsInFile({ filename: BLUEPRINT, status: 'modified', patch: "@@ -30,1 +30,1 @@\n-  gone: strictIdent('x'),\n+  fresh: strictIdent('y')," }, { readSource: () => FACTORY_FIXTURES.strictIdent.definition }).length === 1);


  // -- ⭐ the measurement that RETIRES the name-shaped heuristic outright ----
  //
  // #18560's header refused `*Refusal(` / `*Arm(` on principle. This is the
  // measurement, on the sibling board: TWO factories with the same `*Arm(`
  // shape, file-local to ONE objectui file, land in OPPOSITE registers. A
  // name-shaped reading is wrong about one of them whichever way it guesses —
  // and which one is decided by nothing a name carries.
  const UI_ARMS =
    'const chatbotRequestBodyArm = () =>\n'
    + "  z.record(z.string(), z.unknown()).optional().describe('Additional body parameters');\n"
    + 'const chatbotOnClearArm = () =>\n'
    + "  handlerKeyRefusal('onClear', 'runtime-slot', 'Called after the conversation is cleared');\n";
  t('⭐ `chatbotRequestBodyArm(` returns `z.record(…)` ⇒ a WRITABLE key (objectui 15f01223d, 2 key lines, file-local)', resolveDeclaringFactory(UI_ARMS, 'chatbotRequestBodyArm').verdict === 'writable');
  t('⭐ …while `chatbotOnClearArm(` returns `handlerKeyRefusal(…)` ⇒ REFUSING — two `*Arm(` factories in ONE file, opposite registers', resolveDeclaringFactory(UI_ARMS, 'chatbotOnClearArm').verdict === 'refusing');
  t('…so a factory returning ANOTHER declared form inherits THAT form\'s register, never the one its own name suggests', resolveDeclaringFactory("const retiredDeclarativeKanbanKey = (key: string) =>\n  retirementTombstone('this key is RETIRED');\n", 'retiredDeclarativeKanbanKey').verdict === 'refusing');

  // -- the readings this round must NOT disturb ------------------------------
  t('⛔ #17618 — a typed PARAMETER is still not a key, and the resolver never sees one: its value opens no CALL', keyValueFactoryName('  ctx: z.RefinementCtx,') === null && tellsInFile({ filename: BLUEPRINT, status: 'modified', patch: '@@ -30,0 +30,3 @@\n+export const refine = (\n+  ctx: z.RefinementCtx,\n+) => ctx;' }).length === 0);
  t('⛔ …a COMMENT carrying a local-factory key line is still not a key line', localRun(BLUEPRINT, "+  // snapshotObject: strictIdent('x'),", FACTORY_FIXTURES.strictIdent.definition).rows.length === 0);
  t('⛔ …and a file OFF the contract source surface reads no blob at all, whatever its lines say', localRun('README.md', FACTORY_FIXTURES.strictIdent.line, FACTORY_FIXTURES.strictIdent.definition).unresolved.length === 0);

  // -- #18721: a hunk's LEADING CONTEXT is not a reason to abandon the walk ---
  //
  // The live pair is PR #18720 (card #17779): `git diff 72dd95fa5a..09e16a5745
  // -- packages/spec/src/ui/dashboard.zod.ts` — 202 lines, ONE hunk — exited 4
  // on `+  ctx: z.RefinementCtx,` at `dashboard.zod.ts:628`, the SECOND
  // PARAMETER of an exported object-level refinement and the very line #17618's
  // decline was written for. The decline did not fire because
  // `enclosingDelimiter` abandoned its walk at the hunk's FIRST LINE: a real
  // hunk opens on CONTEXT, and this one's context is the tail of the previous
  // declaration — `  });` — whose closers underflow a stack that has seen no
  // opener. The three-line synthetic the #18560 battery drives shows no context
  // at all, so the pin held while every real diff of this shape told.
  //
  // ⭐ Read the FIRING half beside the decline, the way every battery above is
  // ordered: the card's own TRUE-POSITIVE control on the SAME file, and the two
  // shapes that prove the drop cannot silence a real key — a genuine new key
  // behind the same underflowing context, and one added after the parameter
  // list closes. ⚠️ The filing card's first control read 0 and was its own
  // mis-build (a synthetic path off the declared surface is judged by nothing);
  // both fixtures here sit on the real path the probe was taken from.
  battery("#18721 — a hunk's LEADING CONTEXT is not a reason to abandon the parameter reading");
  const DASHBOARD = 'packages/spec/src/ui/dashboard.zod.ts';
  // PR #18720's own hunk, reduced to exactly what the failing branch needs: the
  // leading CONTEXT that closes the previous declaration, the function head,
  // the object-literal-typed FIRST parameter, and the `ctx` line — at the line
  // the card reported. ⛔ Not the three-line synthetic: the context is the case.
  const PROBE_18720 = {
    filename: DASHBOARD,
    status: 'modified',
    patch: [
      '@@ -623,3 +623,7 @@ export function checkDashboardWidgetStageOrder(',
      '   });',
      ' }',
      ' ',
      '+export function checkDashboardWidgetMetricMeasureArity(',
      '+  widget: { id?: unknown; type?: unknown; values?: unknown },',
      '+  ctx: z.RefinementCtx,',
      '+): void {',
    ].join('\n'),
  };
  t('⭐ THE FINDING — PR #18720\'s real hunk: `ctx: z.RefinementCtx,` behind three leading context lines reads NO tell', tells(PROBE_18720).length === 0);
  t('…at the line the card reported, which is the line that told — the fixture is the probe, not a shape like it', patchLines(PROBE_18720.patch).find((r) => r.kind === 'added' && r.text.includes('z.RefinementCtx'))?.line === 628);
  t('…and the whole verdict is CLEAN, which is the exit code the live pair could not reach', wideningRefusal({ declaration: 'no', files: [PROBE_18720] }).state === 'clean');
  t('⛔ …and an object-literal TYPE on the first parameter is not what confused it: the `{` closes on its own line', enclosingDelimiter([{ text: 'export function check(', hunk: 0 }, { text: '  widget: { id?: unknown },', hunk: 0 }, { text: '  ctx: z.RefinementCtx,', hunk: 0 }], 2)?.opener === '(');
  // ⭐ THE TRUE-POSITIVE CONTROL, on the SAME file the probe was taken from —
  // the card's own, re-derived here as a real `git diff` in a worktree.
  const NEW_KEY_ON_DASHBOARD = {
    filename: DASHBOARD,
    status: 'modified',
    patch: [
      '@@ -698,3 +698,4 @@ export const DashboardWidgetSchema = lazySchema(() => strictObject({',
      ' ',
      '   /** Widget Description (displayed below the title) */',
      "   description: I18nLabelSchema.optional().describe('Widget description text below the header').meta({ title: 'Description' }),",
      '+  brandNewAuthorableKey: z.string().optional(),',
    ].join('\n'),
  };
  t('⛔ CONTROL — a genuinely new key on the SAME file still FIRES: the matcher was never dead, the reading was false', tells(NEW_KEY_ON_DASHBOARD)[0]?.tell === 'T1');
  t('…with its own file:line, the one an author can open', at(NEW_KEY_ON_DASHBOARD)[0] === 'packages/spec/src/ui/dashboard.zod.ts:701');
  t('⛔ CONTROL — a new key behind the SAME underflowing context still tells: the hunk shows no opener, so there is no positive evidence to read', tells({ filename: DASHBOARD, status: 'modified', patch: ['@@ -30,1 +30,2 @@', '   });', '+  brandNewAuthorableKey: z.string().optional(),'].join('\n') }).length === 1);
  t('⛔ CONTROL — a real key added AFTER the parameter list closes still tells, underflowing context and all', tells({ filename: DASHBOARD, status: 'modified', patch: ['@@ -30,1 +30,7 @@', '   });', '+export function check(', '+  ctx: z.RefinementCtx,', '+): void {}', '+export const S = z.object({', '+  extra: z.string(),', '+});'].join('\n') }).map((r) => r.text).join('|') === 'extra: z.string(),');
  // ⭐ The reading itself, at the branch: an underflow DROPS the closer and the
  // walk goes on, because the openers a hunk shows are strictly inside the ones
  // it did not — so a non-empty shown stack is the innermost open delimiter
  // whatever sits below it, and an empty one is still `null`.
  const AFTER_UNDERFLOW = [
    { text: '  });', hunk: 0 },
    { text: 'export function checkThing(', hunk: 0 },
    { text: '  ctx: z.RefinementCtx,', hunk: 0 },
  ];
  t('⭐ an opener the hunk shows AFTER an underflow is the answer — the shown stack is a suffix of the real one', enclosingDelimiter(AFTER_UNDERFLOW, 2)?.opener === '(' && inParameterList(AFTER_UNDERFLOW, 2) === true);
  t('⛔ …while an underflow with NO opener after it still answers `null` — positive evidence only, never a guess', enclosingDelimiter([{ text: '  });', hunk: 0 }, { text: '  extra: z.string(),', hunk: 0 }], 1) === null);
  t('⛔ …and the drop does not leak past the parameter list\'s own close: the body\'s `{` is innermost there', inParameterList([{ text: '  });', hunk: 0 }, { text: 'export function check(', hunk: 0 }, { text: '  ctx: z.RefinementCtx,', hunk: 0 }, { text: '): void {', hunk: 0 }, { text: '  extra: z.string(),', hunk: 0 }], 4) === false);
  t('⛔ …and no reading crosses a HUNK boundary, underflow or not', inParameterList([{ text: '  });', hunk: 0 }, { text: 'export function checkThing(', hunk: 0 }, { text: '  ctx: z.RefinementCtx,', hunk: 1 }], 2) === false);
  // ⭐ The OLD side moves with it, and that direction is LOUD: #17618 reads the
  // decline on the removed side too, so a removed parameter behind leading
  // context now buys no #16943 budget — and the key added in the same block,
  // which that phantom budget used to pay for, fires.
  const REMOVED_PARAM_PAYS_NOTHING = {
    filename: DASHBOARD,
    status: 'modified',
    patch: [
      '@@ -40,7 +40,7 @@',
      '   });',
      ' }',
      ' export function check(',
      '-  ctx: z.RefinementCtx,',
      '-): void {}',
      '-const S = z.object({',
      '+): void {}',
      '+const S = z.object({',
      '+  extra: z.string(),',
      ' });',
    ].join('\n'),
  };
  t('⭐ the OLD side moves too — a REMOVED parameter behind leading context is still not a key, so it buys no budget', inParameterList(AFTER_UNDERFLOW, 2) === true && tells(REMOVED_PARAM_PAYS_NOTHING).length === 1);
  t('…and the row that fires is the genuine new key the phantom budget used to pay for', tells(REMOVED_PARAM_PAYS_NOTHING)[0]?.text === 'extra: z.string(),');

  // -- the floor -------------------------------------------------------------
  const floorFailures = [];
  const floorFailure = (text) => {
    floorFailures.push(text);
    console.error(`  ✗ ${text}`);
  };
  const declared = new Set(Object.keys(SELF_TEST_BATTERIES));
  const opened = new Set(batterySeen.keys());
  if (declared.size < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(
      `the battery roster declares ${declared.size} batteries, below its pinned floor of ` +
        `${SELF_TEST_BATTERY_FLOOR} — deleting an entry silences its floor exactly as effectively as zeroing it.`,
    );
  }
  for (const name of opened) {
    if (!declared.has(name)) floorFailure(`self-test battery "${name}" ran but is NOT declared in the roster.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
            'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
            `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorFailures.length > 0) {
    console.error(
      '✗ check-widening-tells self-test: the battery floor is breached — cases STOPPED RUNNING. ' +
        'Find what stopped registering (an early return, a deleted block, a guard that now skips).',
    );
    return 1;
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-widening-tells self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-widening-tells self-test: ${cases.length} cases pass (the patch reader with its ` +
      'line-number directions, the unified-diff splitter, the three imported/declared surfaces, the ' +
      'four tells, the two accidental variables #16822 removed and the evidence each declines on, '
      + 'the #16943 net member/key delta with its surplus rule and the quiet direction it buys, ' +
      '#17618\'s two declines — a parameter list and a closed set re-spelled around fewer values — ' +
      'each bracketed by the control that still fires, ' +
      '#17300\'s retirement-ledger licence with the firing controls that bracket it on every side, ' +
      '#17955\'s tombstone decline — read before the budget so a rename is still paid for, and requiring the value to BE the call — with the un-retiring control, the two chained-arm controls that fire, and the multi-line chained close pinned as the residual quiet direction, ' +
      "#17848's re-declared key with a zod `error` param — declined by #16943's budget, bracketed by the dark control that fires when nothing paid and the surplus control that fires on a real new key beside it, " +
      "#18234's key narrowed out of a universal acceptor — certified by the REMOVED value's own semantics rather than by the added value's spelling, with the dark, different-key, never-universal, narrowing-step and surplus controls that still fire, " +
      "#18629's key re-typed INTO one — the same fact read on the ADDED side, closing the direction #18234 asserted as quiet, spending its unit and reporting on top of it so a genuine new key beside it still fires, bracketed by the neutral, reformat, mention, wrapped-chain and rename declines, " +
      "#18640's inline closed set re-spelled at the same binding — bounded by the control set that IS the finding, the same edit spelled one member per line and at a keyed property, with the added-arm, different-binding, brand-new, widened-enum and new-key controls that still fire, " +
      "#18702's FILE-LOCAL declaring factory, resolved through its own definition at the head BLOB and classified by what its body returns — every factory the filing card names pinned against its own arm, the refusal arm read off a `z.never` definition rather than a name with its chained-arm control, the counterfactual bracketed by the same fixture with the resolver blind, and both boundaries (an imported factory, an unclassifiable body) pinned as a STATED silence the reader prints, " +
      "#18721's hunk LEADING CONTEXT — an underflowing closer drops and the walk goes on, so #17618's parameter decline reaches a real diff: PR #18720's own hunk silent at its reported line, bracketed by the same file's true-positive control that fires, by a new key behind the same underflowing context, by a key added after the parameter list closes, and by the removed side where a phantom budget disappearing makes a genuine key fire, " +
      "#19099's walk saying when it STOPPED READING — the whole shown stack beside a flag raised on a possible regex literal, a type-blind pop and an unterminated string, with a lone slash read as the division it is, a hunk that BEGINS inside a JSDoc read rather than guessed at, each of the reset's three guards pinned against the frames it protects, the apostrophe residual pinned in the direction it fails, and the reset reaching `inParameterList` so an `@example` arrow cannot swallow the key line behind it, " +
      "#16448's four positive controls each with its file:line, its negative controls — " +
      'the same diffs with `yes`, and a removal-only diff with `no` — the local path composed end ' +
      'to end so a binary change to a tell surface cannot read as clean, #17112\'s split count with ' +
      'its unexaminable populations named rather than counted as read, #17217\'s board driven ' +
      'through the CLI itself so an objectui diff is judgeable and the same diff on the default ' +
      'board says which repo could judge it — and the exit register).',
  );

  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
