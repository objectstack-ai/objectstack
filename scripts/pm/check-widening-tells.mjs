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
 * and `check-half-states` make: a checker that hung `needs:contract-review`
 * would be issuing the review verdict, which is 自查放行. ⛔ No new label and no
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
  'T3 — a new row in a published entry point': 8,
  'T4 — a new registration in a registry': 10,
  '#16448 acceptance: the four positive controls, each with its file:line': 8,
  '#16448 acceptance: the negative controls a widening gate must let through': 10,
  'the refusal sentence, and the two prohibitions it must keep': 8,
  'the exit register is distinct in every direction it must be': 6,
  'the declared registry rows still exist in this tree': 4,
  '#17112 — the count is split: examined is not examinable': 23,
  '#17217 — the CLI can be told which board it judges': 22,
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
 * The sentence #16448 fixes, quoted from the card and NOT paraphrased.
 *
 * It is a constant because the whole point of the refusal is that the author
 * knows the two ways out of it — re-declare, or explain — without reading this
 * file. A row renders it once; ⛔ never a second wording per tell.
 */
export const REFUSAL_SENTENCE =
  'a widening tell with `Clause-②: no` — re-declare `yes` or explain in the claim why this ' +
  'addition does not widen';

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
 * T1 — a property whose value is a SCHEMA.
 *
 * Calibrated against the real tree rather than guessed (measured 2026-09-07 over
 * `packages/spec/src/**`): 8,102 property lines take a `z.` value, and the
 * whole non-`z.` schema vocabulary beneath them is `retiredKey(` (235),
 * `I18nLabelSchema` and its `*Schema` siblings (≈300), `strictObject(` (46) and
 * `lazySchema(`. Requiring a schema-shaped VALUE is what keeps the tell off the
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
const SCHEMA_PROPERTY = /^[ \t]*(?:'[^']+'|"[^"]+"|\[[^\]]+\]|[A-Za-z_$][\w$]*)[ \t]*\??[ \t]*:[ \t]*(?:z\.|lazySchema\(|strictObject\(|retiredKey\(|[A-Za-z_$][\w$]*Schema\b)/;

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

/** The index of the closer matching the opener at `open`, or -1 if it does not close on this line. */
function matchingCloser(s, open) {
  const stack = [s[open]];
  for (let k = open + 1; k < s.length; k += 1) {
    const ch = s[k];
    const next = s[k + 1];
    if (ch === '/' && next === '*') {
      const end = s.indexOf('*/', k + 2);
      if (end === -1) return -1;
      k = end + 1;
      continue;
    }
    if (ch === '/' && next === '/') return -1;
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfStringLiteral(s, k);
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
 * The innermost delimiter still OPEN where one side-line sits, as far as THIS
 * HUNK shows it — `{ opener: '(' | '[' | '{', head: <the text left of it> }`,
 * or `null` for "the hunk does not say".
 *
 * ⭐ Positive evidence only, and `null` is the whole safety property. The scan
 * starts at the first line of the line's OWN hunk, so a construct opened before
 * the hunk is never guessed at: a closer arriving with an empty stack means the
 * hunk began inside something it was never shown, and a string literal that
 * does not close on its line means the state cannot be carried across it —
 * both answer `null`, and both callers read `null` as "keep the tell firing".
 *
 * ⛔ This is NOT the depth-aware `z.object({ … })` reader T1's own comment
 * refuses, and ⛔ it must never be grown into one. It answers exactly one
 * question — which bracket is innermost — and nothing about WHICH construct
 * opened it, so it has no truncating failure mode: an unreadable state is
 * `null`, never "no longer inside a shape".
 *
 * @param {{ text: string, hunk: number }[]} side — one SIDE of `patchLines`
 * @param {number} index — the line's index into that side
 */
export function enclosingDelimiter(side, index) {
  if (!Array.isArray(side) || typeof index !== 'number' || !side[index]) return null;
  const { hunk } = side[index];
  let start = index;
  while (start > 0 && side[start - 1]?.hunk === hunk) start -= 1;
  const stack = [];
  let inBlockComment = false;
  for (let j = start; j < index; j += 1) {
    const s = String(side[j]?.text ?? '');
    for (let k = 0; k < s.length; k += 1) {
      const ch = s[k];
      const next = s[k + 1];
      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; k += 1; }
        continue;
      }
      if (ch === '/' && next === '*') { inBlockComment = true; k += 1; continue; }
      if (ch === '/' && next === '/') break;
      if (ch === "'" || ch === '"' || ch === '`') {
        const end = endOfStringLiteral(s, k);
        if (end === -1) return null;
        k = end;
        continue;
      }
      if (BRACKET_CLOSERS[ch] !== undefined) { stack.push({ opener: ch, head: s.slice(0, k) }); continue; }
      if (ch === ')' || ch === ']' || ch === '}') {
        if (stack.length === 0) return null;
        stack.pop();
      }
    }
  }
  return stack.length > 0 ? stack[stack.length - 1] : null;
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
 * The key a T1 line names and the closed-set members its value declares INLINE,
 * or `null` when either half is not readable on this one line.
 *
 * ⭐ "Not readable" is the common answer and it is the safe one: a value whose
 * list opens on a later line (`strategy: z.enum([`) reads `null`, and a `null`
 * on either side of the comparison below leaves the tell firing.
 */
export function keyedClosedSetMembers(text) {
  const s = String(text ?? '');
  if (COMMENT_LINE.test(s) || !SCHEMA_PROPERTY.test(s)) return null;
  const name = KEYED_PROPERTY_NAME.exec(s);
  if (name === null) return null;
  const key = name[1] ?? name[2] ?? name[3] ?? name[4];
  const ctor = CLOSED_SET_CONSTRUCTOR.exec(s);
  if (ctor === null) return null;
  const openParen = ctor.index + ctor[0].length - 1;
  const closeParen = matchingCloser(s, openParen);
  if (ctor[1] === 'literal') {
    if (closeParen === -1) return null;
    const members = topLevelMembers(s, openParen, closeParen);
    return members.length > 0 ? { key, members } : null;
  }
  const openBracket = s.indexOf('[', openParen);
  if (openBracket === -1 || (closeParen !== -1 && openBracket > closeParen)) return null;
  const closeBracket = matchingCloser(s, openBracket);
  if (closeBracket === -1) return null;
  const members = topLevelMembers(s, openBracket, closeBracket);
  return members.length > 0 ? { key, members } : null;
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
export function memberTellKind(text, { onContractSource = false, onPublished = false, onRegistry = false } = {}) {
  const s = String(text ?? '');
  if (COMMENT_LINE.test(s)) return null;
  if (onRegistry && REGISTRATION_ROW.test(s)) return 'T4';
  if (onContractSource && SCHEMA_PROPERTY.test(s)) return 'T1';
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
 * @param {{ filename?: string, status?: string, patch?: string|null }} file
 * @param {{ repo?: string, licensed?: Set<string> }} [opts] — `licensed` is the
 *   whole diff's {@link ledgerRowLicences}; omitted, NOTHING is licensed and
 *   every row tells, because an unread licence is not a granted one.
 * @returns {{ tell: string, file: string, line: number, text: string, why: string }[]}
 */
export function tellsInFile(file, { repo = THIS_REPO, licensed = null } = {}) {
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
    const kind = memberTellKind(text, surfaces);
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
    const declaresClosedSet = CLOSED_SET_OPENER.test(text);
    const spendable = !declaresClosedSet || respellsExistingClosedSetKey(text, removedOfLine.get(i));
    if (kind !== null && spendable) {
      const budget = budgetOfLine.get(i);
      const paid = budget?.get(kind) ?? 0;
      if (paid > 0) {
        budget.set(kind, paid - 1);
        continue;
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
      rows.push({ tell: 'T1', ...at, why: 'a new key on a Zod object schema — the accept set gains a spelling an author may now write' });
      continue;
    }
    // #16822 — an opener that re-declares a set the same hunk removed adds no
    // member; the members are read below, one line each.
    const opener = CLOSED_SET_OPENER.test(text) && !rewritesExistingOpener(text, removedByHunk.get(hunk));
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
export function wideningTells(files, { repo = THIS_REPO } = {}) {
  const rows = [];
  const licensed = ledgerRowLicences(files, { repo });
  for (const file of files ?? []) rows.push(...tellsInFile(file, { repo, licensed }));
  return rows;
}

/**
 * The verdict: a declaration plus a diff.
 *
 * @param {{ declaration: 'yes'|'no'|null|undefined,
 *           files: object[]|null, repo?: string }} input
 * @returns {{ state: 'not-applicable'|'unreadable'|'incomplete'|'refused'|'clean',
 *   rows: object[], gaps: string[], text: string|null }}
 */
export function wideningRefusal({ declaration, files, repo = THIS_REPO } = {}) {
  // A `yes` is never blocked here, and an unreadable declaration is the
  // sibling's C2 row — issuing a verdict on it from this file would be a second
  // reader of the same limb, which is the drift this family punishes.
  if (declaration !== 'no') {
    return { state: 'not-applicable', rows: [], gaps: [], text: null };
  }
  if (!Array.isArray(files)) {
    return {
      state: 'unreadable',
      rows: [],
      gaps: [],
      text:
        'the changed-file listing could not be read, so this diff is UNJUDGED for widening tells. ' +
        '⛔ An unread diff is not a narrow diff.',
    };
  }
  const gaps = unreadFiles(files, { repo });
  const rows = wideningTells(files, { repo });
  if (rows.length > 0) {
    const where = rows.map((r) => `${r.file}:${r.line}`).join(', ');
    return {
      state: 'refused',
      rows,
      gaps,
      text: `${REFUSAL_SENTENCE} — ${rows.length} tell(s): ${where}`,
    };
  }
  if (gaps.length > 0) {
    return {
      state: 'incomplete',
      rows,
      gaps,
      text:
        `${gaps.length} file(s) on a tell surface arrived with no patch to read (${gaps.join(', ')}), ` +
        'so this diff is UNJUDGED for widening tells rather than clear of them.',
    };
  }
  return { state: 'clean', rows: [], gaps: [], text: null };
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
    out.push(
      '  ⚠️ A tell is not a proof and its absence is not one either — false negatives are the ' +
        'cost the #16349 ruling accepted.',
    );
    return { exit: EXIT_OK, out, err };
  }
  for (const line of refusalLines(verdict)) err.push(`✗ ${line}`);
  err.push(`check-widening-tells: ${verdict.text}`);
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
  t('`retiredKey(` reads — 235 lines in the tree take it', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  legacy: retiredKey('legacy'),") })[0]?.tell === 'T1');
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
  t('the sentence names both ways out', says(REFUSAL_SENTENCE, 're-declare `yes`') && says(REFUSAL_SENTENCE, 'explain in the claim'));
  t('…and quotes the declaration in the spelling the reader uses', says(REFUSAL_SENTENCE, '`Clause-②: no`'));
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
