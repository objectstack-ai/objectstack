#!/usr/bin/env node
/**
 * The console performance budget, weighed over the EAGER CLOSURE.
 *
 * ## What this replaces
 *
 * `.github/workflows/performance-budget.yml` is named "Bundle Analysis" and its
 * step is "Check console performance budget", but until objectui#5324 it gzipped
 * exactly one file:
 *
 *     ENTRY_FILE=$(find "$DIST_DIR" -name 'index-*.js' ... | head -1)
 *     GZIP_BYTES=$(gzip -c "$ENTRY_FILE" | wc -c)
 *
 * The entry chunk is not what a page load costs. It statically imports a closure
 * of other chunks, and the browser fetches and parses all of them before the app
 * renders. Measured on `77f846a8b`:
 *
 *   | index-*.js alone (what the budget weighed) |    25,910 bytes gzipped |
 *   | the eager closure — 58 of 507 chunks       | 3,881,609 bytes gzipped |
 *
 * So the gate passed on 0.67% of the payload it claimed to govern. That is not
 * theoretical: objectui#5266 put 89 KiB gzipped on every console page load, it
 * landed in `vendor-objectstack-*.js`, and this gate could not see it.
 * `advancedChunks` deliberately routes vendor and workspace code into named
 * chunks, so MOST regressions land outside `index-*.js`.
 *
 * That table is the MOTIVATING measurement and stays pinned to `77f846a8b`; it
 * is not the current reading. {@link BASELINE} carries today's, and the ceiling
 * section below does the arithmetic against it.
 *
 * ⛔ That rule is general, and since objectui#7528 it is a gate rather than an
 * intention: a chunk count written in this file's prose — or in
 * `scripts/__tests__/check-eager-closure-budget.test.ts`'s — stays pinned to the
 * commit it was measured on, as the table above is, or it is not written at all.
 * An UNANCHORED count is a standing claim about the LIVE closure, and the live
 * closure's count moves on most builds. Three sentences here made exactly that
 * claim ("one number over N chunks"), and by the time objectui#7528 read them
 * back the prose, {@link BASELINE}'s frozen `chunks` and the gate's own output
 * were three DIFFERENT numbers — with nothing red anywhere across that spread,
 * because nothing fails on a stale number in a comment. Refreshing the literal
 * would only restart that clock; naming the population has no clock to restart.
 * Two durable readings, neither of them a copy:
 *
 *   * HOW MANY — `pnpm check:eager-closure` prints it, in the gate's own verdict
 *     line: "Console eager closure is N KB gzipped across E of T chunks
 *     (budget: ... KB, headroom: ... KB)".
 *   * WHICH — `apps/console/dist/eager-closure.json`, written by
 *     `emitEagerClosureReport` in `apps/console/vite.config.ts` on every build.
 *
 * {@link BASELINE} is not an exception to it. That constant NAMES the commit it
 * was measured on, which is the anchored form the rule asks for: a frozen
 * measurement that says which build it came from cannot go stale, it can only
 * become old, and re-baselining is what that has instead of a rewrite.
 *
 * ## Where the number comes from
 *
 * `apps/console/vite.config.ts` (`emitEagerClosureReport`) writes
 * `apps/console/dist/eager-closure.json` from rolldown's own `chunk.imports` —
 * a BFS from the entry chunks over STATIC imports only, gzipping the bytes that
 * were actually written to disk. This file only applies a ceiling to it. The
 * split keeps graph knowledge where the graph is and policy where it can be unit
 * tested (`scripts/__tests__/check-eager-closure-budget.test.ts`), and it keeps a
 * size regression from failing every Vercel preview and local build — which is
 * how a budget gets switched off rather than fixed.
 *
 * ## The ceiling, and why it is this number
 *
 * `MAX_EAGER_CLOSURE_GZIP_BYTES` is today's measurement plus headroom of half
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}. Two constraints pin it from
 * both sides, and since objectui#5924 BOTH are checked against the report this
 * gate just read, not against a literal frozen next to them:
 *
 *   - It must PASS on today's `main`. A gate that lands red is a gate someone
 *     disables, and this one replaced a gate nobody could fail. ⛔ No figure is
 *     restated here: this bullet carried one and it went a whole re-baseline
 *     stale (objectui#7518). The headroom the CONSTANTS carry is stated once,
 *     on {@link MAX_EAGER_CLOSURE_GZIP_BYTES}; what the LIVE closure has left
 *     is what `pnpm check:eager-closure` prints, and it is the smaller of the
 *     two once the payload has drifted up from the baseline.
 *   - The headroom must stay SMALLER than the regression the gate exists to
 *     catch. objectui#5266 was 89 KiB = 91,136 bytes, and this ceiling is built
 *     to carry half of that, so it would have failed on that change. Widening
 *     the headroom past ~89 KiB would leave the gate green through a repeat of
 *     its own motivating incident.
 *
 * Half the regression size, rather than the ~2% this line used to carry, is a
 * deliberate choice that only became necessary once the second constraint
 * started being enforced live (next section). Headroom H buys H bytes of growth
 * before the gate reds for being over budget, and costs REGRESSION - H bytes of
 * SHRINK before it reds for going blind. H = REGRESSION / 2 is the only value
 * equidistant from the two, and it is the value that maximises the smaller of
 * the two distances: ~45 KB of room in each direction rather than 66 KB one way
 * and 25 KB the other.
 *
 * ## Why the headroom is checked LIVE (objectui#5924)
 *
 * The second constraint above used to be asserted only in the unit test, as
 *
 *     MAX_EAGER_CLOSURE_GZIP_BYTES - BASELINE.gzipBytes < REGRESSION_...
 *
 * Both operands are frozen literals from this module, so that assertion was
 * true regardless of what the console actually weighed, and it stayed true
 * while the closure got ~706 KB SMALLER than the pinned baseline. The invariant
 * was STATED about the live bundle and CHECKED about two constants; it would
 * have stayed green if the closure halved again.
 *
 * What that cost, demonstrated rather than inferred (objectui#5924): with the
 * ceiling at 4,086,000 over a live 3.3 MB payload, an eager
 * `@objectstack/spec/cloud` namespace import into `apps/console/src/main.tsx`
 * added 158,006 gzipped bytes to the closure — 1.7x the incident this gate was
 * built to catch — and the aggregate half printed a green tick with "headroom:
 * 613.4 KB" underneath it.
 *
 * {@link evaluateHeadroomSensitivity} now derives that headroom from the report,
 * for the aggregate ceiling AND for every per-chunk ceiling — four ceilings as
 * of objectui#5490 — and calls a ceiling that sits more than one regression
 * above its own measurement an ERROR (exit 2). That verdict is about the GAUGE,
 * not the bundle, which is why it is an error and not a size failure: a green
 * tick that cannot distinguish "no regression" from "the motivating incident,
 * twice over" carries no information. It is the same shape as a budget keyed on
 * a chunk that is not there, and the same rule applies — measuring nothing must
 * be LOUDER than measuring something over the line, never quieter.
 *
 * The consequence is deliberate: drift in the SHRINKING direction is no longer
 * free. A PR that takes more than ~45 KB out of the closure now has to re-pin
 * the ceiling it just made decorative, in the same commit, instead of leaving a
 * decision that silently comes due and is never taken. The constant-vs-constant
 * assertions stay in the unit test as a secondary guard: they still catch an
 * edit that raises a ceiling past the regression size without any build.
 *
 * ## Why this number has moved (objectui#5328 up, objectui#5924 down)
 *
 * It was 3,960,000 over a 3,881,609 baseline measured on `77f846a8b`. Pinning
 * `@objectstack/spec` and its three siblings to 17.1.0 put the closure 41,689
 * bytes over that ceiling: the release is ~930 KB larger uncompressed, and
 * essentially all of it lands in `vendor-objectstack-*.js`. That is REAL added
 * payload, not a measurement artefact, and it is larger than the #5266
 * regression this gate was sized to catch — the gate did its job.
 *
 * The re-baseline was therefore escalated rather than taken by the seat doing
 * the bump, because #5468 had ruled days earlier that the aggregate ceiling
 * "stays as shipped" and that gate-strength policy is the maintainer's. The
 * maintainer ruled option A on #5531: raise it, permanently, together with the
 * headroom assertion that guards it. Both constants move in ONE commit — raising
 * the ceiling alone leaves headroom at ~200 KB and fails the test below, which
 * is the guard working, not an obstacle to route around.
 *
 * objectui#5924 then lowered it to 3,345,000 over 3,299,898 bytes measured on
 * `48e53814e`: 706,013 bytes BELOW the `4c1623c0c` baseline the previous ceiling
 * was derived from. Nothing was cleaved to earn that — the closure shrank on its
 * own while the ceiling stayed put, which is exactly the drift that opened the
 * blind band above. Lowering a ceiling TOWARD reality is a tightening, not a
 * weakening: no build that passed before the change and measures under 3,345,000
 * fails after it, and the gate's sensitivity is once again larger than the
 * headroom it guards. This was taken as a card's stated decision (objectui#5924,
 * triage disposition 3) rather than silently, which is what the "Raising it"
 * note below asks of a re-baseline in either direction.
 *
 * objectui#6683 lowered it again, to 3,300,000 over 3,254,004 — and this one was
 * EARNED rather than drifted into. `@object-ui/app-shell` now publishes a
 * precise `sideEffects` array (guarded by
 * `scripts/check-side-effects-array.mjs`), which made 56,668 gzipped bytes of
 * the barrel's closure shakeable. That is LARGER than the 45,102 bytes of
 * headroom the 3,345,000 ceiling carried, so the ceiling had to move with it or
 * the aggregate gauge would sit at 1.00x its own sensitivity — the blind band
 * reopening the same day it was measured shut. The two numbers move in ONE
 * commit for the reason the paragraph above gives.
 *
 * objectui#6776 lowered it a third time, to 3,268,000 over 3,222,314, and this
 * one was earned the same way. `views/metadata-admin/index.ts` stopped being a
 * registering module — its five load-time registrations moved to a leaf the
 * PACKAGE ENTRY bare-imports — so the `sideEffects` array stopped naming it, the
 * package barrel's 25 runtime re-exports were re-pointed at leaf modules, and
 * the whole `metadata-admin` chunk (172,945 gzipped bytes, 144 modules) left the
 * eager closure: 3,254,230 -> 3,222,314, −31,916 bytes, measured on two full
 * console builds. The maintainer ruling of 2026-08-30 made the re-baseline part
 * of the change rather than a follow-up, in its own words:
 *
 *     ⛔ ceiling 处置写死(不作实施者临场判断):-31KB 把余量推到 ~0.89x 门禁
 *     89KB 回归阈值(近盲),同批重设 `MAX_EAGER_CLOSURE_GZIP_BYTES`;抬 ceiling
 *     是有申报程序的 ratchet,裁决原话引入 PR 正文。
 *
 * Measured, the drift was 0.85x rather than 0.89x — the gate printed
 * `headroom 75.9 KB = 0.85x the 89.0 KB regression` on the post-change build
 * before this constant moved. Either way it is the blind band reopening, and the
 * direction of this edit is DOWN: no build that passed before it and measures
 * under 3,268,000 fails after it.
 *
 * ⚠️ Read the direction correctly: the closure did NOT fall by the 242.6 KB the
 * objectui#6683 card projected. That figure was measured for
 * `"sideEffects": false`, which is closed by measurement because it also DROPS
 * three live SDUI widget registrations. The precise array keeps them, and
 * keeping them keeps their import closure eager; 56,668 bytes is what the
 * correct declaration actually buys. The gap is not a defect in the array — it
 * is the price of the correctness the ruling required, and the difference is
 * recorded here rather than smoothed over.
 *
 * ⛔ The floor is unchanged and applies to a LOWERING too: never put a ceiling
 * below a measured figure to express an aspiration. That is not a tighter
 * ratchet, it is a gate that lands red on `main`, which is how a budget gets
 * switched off rather than met.
 *
 * What did NOT move: {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}. That is the
 * gate's sensitivity, the ruling did not touch it, and re-baselining must never
 * become an excuse to widen it — a ceiling that rises while the sensitivity
 * relaxes is a gate quietly retiring itself.
 *
 * This is a truthful CURRENT-STATE ceiling, not a target. A multi-megabyte
 * gzipped payload before first render is a bad payload, and the honest
 * long-term line is far below it — but lowering the line to a TARGET is a
 * separate decision with its own work behind it (objectui#5324 names the
 * candidates), and re-baselining onto a fresh measurement is not that. Nothing
 * here should be read as a finding that the ceiling standing over the closure
 * today is acceptable.
 *
 * Which is which: {@link BASELINE} carries the measured payload and
 * {@link MAX_EAGER_CLOSURE_GZIP_BYTES} is the ceiling standing over it. Saying
 * which is which is the whole of this note — a paragraph that names two sizes
 * without naming their subjects reads as one number that changed its mind
 * (objectui#7528).
 *
 * ⛔ Neither paragraph renders either constant as a size, deliberately. This
 * note used to state both of them as MiB literals; a re-baseline moved both
 * constants, and four days and three later edits to this file went by with the
 * RETIRED pair still written here and nothing red anywhere across that
 * distance, because nothing fails on a number written in a comment
 * (objectui#8964). The subjects are named and the readings are left to the
 * instrument: the two constants below carry them in bytes, each pinned to the
 * commit it was measured on, and the gate's verdict line prints the live one on
 * every run. `scripts/__tests__/check-eager-closure-budget.test.ts` refuses a
 * rendered size written back into either paragraph.
 *
 * ## Per-chunk ceilings (objectui#5490)
 *
 * One total over the whole eager closure cannot say WHERE the payload moved, and
 * inside its headroom one chunk can grow by the whole allowance while the others
 * shrink.
 * {@link PER_CHUNK_GZIP_CEILINGS} adds a line per big chunk on top of the
 * aggregate — same truthful-current-state discipline, same checked constraints,
 * keyed on the chunk names the REPORT carries so a renamed or vanished chunk
 * fails loudly instead of passing by weighing nothing. See that constant's
 * comment for the reasoning and for how to move one.
 *
 * ## Is the ceiling still the one in force? (objectui#6245)
 *
 * The three halves above all read this file's constants and take them as given.
 * None of them can ask whether the constants THEMSELVES are current, and on a
 * `pull_request` run that question has a wrong answer that is invisible from
 * inside the checkout: GitHub does not re-run a PR's checks when the base
 * branch moves, so a green verdict can be computed against ceilings `main` has
 * since replaced, and nothing downstream can tell that green from a fresh one.
 * ⛔ How far that green GATES is deliberately not stated here. See
 * {@link evaluateCeilingFreshness}, which carries the two readings this tree
 * can re-derive about this check's blocking power — and the reason the sentence
 * that used to stand in this spot could not be re-derived by anyone
 * (objectui#9155). Measured, not inferred: run 32804357171 started 6m50s AFTER
 * `0409b766d` lowered the aggregate ceiling to 3,345,000 and published
 * `BUDGET_CLOSURE_BUDGET_KB: 3990.2` — the retired 4,086,000 — as a success.
 *
 * {@link evaluateCeilingFreshness} is the fourth half and closes that window
 * inside the tool: it compares {@link VERDICT_CEILING_CONSTANTS} across three
 * readings of this file — this checkout, the base commit the checkout was made
 * from, and the base branch tip — and calls a ceiling the base branch moved out
 * from under this run an ERROR (exit 2). Three readings rather than two because
 * a re-baseline PR differs from the base branch deliberately and must still
 * land; see that function for the rule and for the residual window it cannot
 * close.
 *
 * ## What a re-baseline ABSORBS — objectui#7848
 *
 * Every entry above re-pins {@link BASELINE} by an ABSOLUTE fresh reading of a
 * named tree, ⛔ never by applying a delta to the constant it replaces. That is
 * the right construction and the record depends on it: a delta chain compounds
 * whatever each link got wrong, and a fresh reading cannot. But it has a
 * consequence stated nowhere else here, and the consequence is the whole of
 * objectui#7848. A fresh reading is SILENT ABOUT ITS OWN COMPOSITION. Every byte
 * that arrived between one baseline and the next and was not removed in between
 * is inside the new constant with no name on it, while the record written above
 * that constant names only the cause that MOTIVATED the move. Those are two
 * different sets, nothing separates them, and ⛔ nothing goes red when they
 * differ — the same shape as the stale comment objectui#7528 and objectui#8964
 * each caught one column over.
 *
 * ⇒ read every "measured N on `<commit>`" entry above as exactly what it is: a
 * true total for that tree, and ⛔ NOT a claim that the change described beside
 * it is what put the bytes there.
 *
 * ### The one entry whose record can be audited, and what makes it auditable
 *
 * objectui#7479's is the only re-baseline here that publishes enough to close
 * its own accounting — and it closes. Read off the table under "Why
 * `i18n-locales` became `i18n-locale-en`": control `d8b4739d4`, after
 * `755d34a5f`, one container, one instrument.
 *
 *   | claimant                                  |    bytes |
 *   |-------------------------------------------|---------:|
 *   | aggregate fall                            | -410,553 |
 *   | the catalogue chunk alone                 | -415,781 |
 *   | ⚠️ `i18n-runtime`, a NEW eager member      |   +5,329 |
 *   | ⇒ the i18n family, net                    | -410,452 |
 *   | ⇒ residual — everything that is not i18n  |     -101 |
 *
 * ⚠️ The third row is what a reader loses by subtracting two figures instead of
 * reading the table, and losing it inverts the conclusion. 415,781 against
 * 410,553 leaves 5,228 bytes that look like non-locale content absorbed under
 * cover of a locale change. They are not: `i18n-runtime` — the provider, hooks
 * and formatters, which stay eager — is a chunk that does not exist in the
 * control column at all, it is i18n, and it accounts for 5,329 of those 5,228,
 * leaving 101 bytes that moved the OTHER way. The eager chunk counts say the
 * same thing without the byte figures: `d8b4739d4` weighed 50 of 518 chunks and
 * `755d34a5f` 51 of 528 chunks, so of the ten chunks that appeared exactly one
 * is eager, and `i18n-runtime` is it.
 *
 * ⇒ that re-baseline absorbed essentially nothing, and the ONLY reason anyone
 * can say so is that its record carries three unmoved control rows and both
 * chunk counts. ⛔ A record that publishes just the new constant cannot be
 * audited at all — not because its number is wrong, but because nothing in it
 * is falsifiable. That, and not a house style, is why the entries above are the
 * length they are.
 *
 * ### What was carried in anyway, and how much of it may honestly be claimed
 *
 * objectui#7848 measured the closure at 3,263,896 gzipped bytes on `52cac3886`
 * against the baseline then in force, 3,222,314 on `3d257c85a`, and named the
 * difference: 41,582 bytes that had arrived in six days with no card explaining
 * any of them. `52cac3886` is an ancestor of `755d34a5f` — GitHub compare
 * reports `ahead_by=627, behind_by=0` — and because the constant below is an
 * absolute reading of that descendant tree, every one of those bytes that was
 * not removed in between is inside it, unattributed and unnamed. THAT is the
 * absorption this section exists to record, and it is why the card stayed open
 * after its headline figure was overtaken.
 *
 * ⛔ What may NOT be written is a floor — "at least 41,582 of them" — and this
 * file's own record is the reason. The one large removal inside that span is
 * the catalogue change itself, and the catalogue was GROWING across the drift
 * window: `i18n-locales` measured 446,076 on `177afeba1` and 454,602 on
 * `bbe285ee7`, +8,526 bytes, a window that contains `52cac3886`. Drift that is
 * UNATTRIBUTED cannot also be asserted disjoint from the chunk that left, and
 * no reading of the catalogue exists on `3d257c85a` or on `52cac3886` to
 * separate the two. ⇒ a large part of the 41,582 is inside the constant below;
 * how large is NOT established, and a floor written here would be one more
 * unbound figure of exactly the class objectui#8964 exists to refuse.
 *
 * ### ⚠️ The tree that was measured is not the tree that landed
 *
 * The control/after pair above is a clean A/B — one commit apart, one container
 * — but it is an A/B of the FIRST commit of objectui#7479's branch, not of the
 * pull request that carried it. After `755d34a5f` that branch took 22 more
 * commits before it was squash-merged onto `main` as `77b2a18a16`, and one of
 * them (`bf268c3723`) merged 15 further commits of `main` in. Three of the 22
 * edit non-test source inside `framework`'s own group,
 * `packages/(core|react|types)` — `packages/core/src/utils/filter-tokens.ts`,
 * `packages/react/src/SchemaRenderer.tsx` and
 * `packages/react/src/hooks/usePageAssignment.ts`, 175 added lines against 47
 * removed.
 *
 * ⛔ None of that is weighed by the constant below, and what it costs gzipped is
 * UNMEASURED rather than small — nobody has built `77b2a18a16`. The docblock on
 * {@link BASELINE} already warns that CI weighs the pull request's MERGE ref
 * while this is the branch tree, "so the two differ by whatever has landed on
 * `main` since". The half it does not cover is that they also differ by
 * whatever landed on the BRANCH after the reading was taken. ⇒ take the reading
 * on the tree you are about to merge, or name here the commits that arrived
 * after it.
 *
 * ## Raising it
 *
 * Re-baselining is legitimate — it is how a ratchet advances — but it is a
 * DECISION, so make it visible: update the constant, update the measured figure
 * in the prose attached to it, and say in the PR what the added bytes buy.
 * Silently bumping the number to make CI green reproduces the gate this file
 * replaced.
 *
 * ⇒ and publish the ROWS, not only the total, for the reason the section above
 * gives: the unmoved chunks beside the moved one are what let the next reader
 * tell the bytes your change is accountable for from the drift riding in with
 * them. ⛔ "What the added bytes buy" answered with a cause and no control is
 * the form that has absorbed every byte this file cannot now attribute.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * Ceiling for the console eager closure, in gzipped bytes. See the header for
 * how this number was chosen; {@link BASELINE} names the measurement and the
 * commit it was taken on.
 *
 * Re-baselined DOWNWARD five times, each time toward a measurement the payload
 * had already fallen to:
 *
 *   - objectui#5924, from 4,086,000 (derived from the 4,005,911 reading on
 *     `4c1623c0c`) to 3,345,000 over 3,299,898 on `48e53814e`.
 *   - objectui#6683, to 3,300,000 over 3,254,004. `@object-ui/app-shell` now
 *     declares a precise `sideEffects` ARRAY, which took 56,668 gzipped bytes
 *     out of the closure — more than the 45,102 of headroom the previous
 *     ceiling had, so leaving it in place would have parked the aggregate gauge
 *     at 1.00x its own sensitivity and, on the next byte of shrink, tripped the
 *     exit-2 verdict about the gauge. Lowering it in the SAME change is the
 *     tightening the maintainer ruling of 2026-08-29 asked for.
 *   - objectui#6776, to 3,268,000 over 3,222,314. The metadata-admin engine's
 *     five load-time registrations moved out of the page barrel, so the barrel
 *     stopped being named by the `sideEffects` array and the 172,945-byte
 *     `metadata-admin` chunk left the eager closure (−31,916 bytes). The
 *     3,300,000 ceiling was measured carrying 75.9 KB of headroom afterwards —
 *     0.85x the regression this gate must catch, the blind band reopening — and
 *     the 2026-08-30 ruling made moving it part of the same change.
 *   - objectui#7479, from 3,597,000 to 3,210,000 over 3,164,817. Nine of the
 *     ten locale catalogues left the eager closure for `import()`ed chunks of
 *     their own: −410,553 gzipped bytes, 4.5x the regression this gate must
 *     catch, so the old ceiling would have stood 432,183 bytes (4.74x) above
 *     the payload and {@link evaluateHeadroomSensitivity} would have called the
 *     gauge blind — an exit 2 about the instrument, in the same run that earned
 *     the shrink. See "Why `i18n-locales` became `i18n-locale-en`" in the
 *     header for both builds and the three control rows that show the bytes
 *     LEFT rather than moved.
 *   - objectui#11939 (step 2), from 3,391,484 to 3,281,467 over 3,235,899 on
 *     `f05f015`, under ruling 6070754914 (letter D). The built-in metadata
 *     designers left the eager closure for a chunk the package entry imports
 *     dynamically: −155,517 gzipped bytes, 1.71x the regression this gate must
 *     catch. The header's objectui#11939 entry carries the builds, the ruling
 *     and the end of objectui#11942's allowance.
 *
 * Headroom above {@link BASELINE} is 45,568 bytes — 0.50x
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}, on the pair objectui#11939
 * re-pinned by the reading plus half a regression (its entry, the last below,
 * says what the margin is for); before it, the pair objectui#11942 left when
 * it added a fixed allowance of 5,120 bytes to the ceiling carried 16,140
 * bytes (0.18x), and the pair objectui#11854 re-pinned when the markdown
 * highlighter and the docs-only markdown plugins left the first load, lowering
 * the ceiling by exactly the bytes that left, carried 11,020 bytes (0.12x; the
 * header's objectui#11854 entry says why that band sits under the 0.50x design
 * point), the pair objectui#11798 re-pinned when the Studio
 * builder and the chart engine left the first load carried 26,363 bytes
 * (0.29x), the pair
 * objectui#11717 re-pinned under the ruling recorded in the header's fourth
 * raise carried 45,972 bytes (0.50x), and the pair objectui#11438 re-pinned
 * when the `@objectstack/*` 17.6.0 bump paid back the rest of the spec-root
 * part of objectui#11073's raise carried 24,091 bytes (0.26x). ⚠️ That
 * is arithmetic on two
 * constants in this file, so it stays true while they do — it is NOT what the
 * closure has left today, which is smaller by every byte the payload has
 * drifted up since the baseline below was taken. `pnpm check:eager-closure`
 * prints the figure in force, and that is the one governing your build.
 *
 * ## ⚠️ RAISED ONCE, ON EXPLICIT MAINTAINER AUTHORISATION (objectui#7122)
 *
 * Raising this ceiling is a gate weakening and sits on the manual floor, so it
 * is a human's act, not an agent's. The authorisation, verbatim:
 *
 *     维护者 sam@objectstack.ai 于本轮明确授权：「抬上限，把 7685 弄绿」
 *
 * recorded on objectui#7122 as decision batch 1 item 1 = "B + A" (a one-time,
 * cause-recorded adjustment of exactly the measured delta, with the upstream
 * card filed alongside).
 *
 * ⛔ WHAT THE BYTES BUY, stated plainly because this is NOT routine growth and
 * must not read as one. The residue is `@objectstack/spec` 17.3.0's own
 * browser-dist growth: +292.2 KB gzip on the spec package alone, whose measured
 * mechanism is that 17.3.0 LENGTHENED the Zod `.describe()` doc strings that
 * ship in the browser build ("Output schema" became "Output schema (JSON
 * Schema)", and so on across the schema surface). It is authoring documentation
 * prose, shipped to every page load.
 *
 * ⛔ It is NOT duplication — that was a separate, larger problem and it is
 * already fixed. Resolving the spec alone to 17.3.0 shipped TWO copies of it
 * (four sibling packages pin it exactly), which this branch collapsed by moving
 * the family together in the lockfile: −671 KB, and the probe for markers
 * unique to 17.2.0 fell from 92.3% to 1.0% of 104, with the single survivor
 * accounted for. No chunk entered or left the closure; the eager chunk count is
 * unchanged.
 *
 * ⇒ ⭐ THE UPSTREAM FIX WAS REFUSED, so these numbers are the STANDING
 * BASELINE and not an exception awaiting reversal. Stripping the `describe()`
 * prose out of the browser build would return ~292 KB to EVERY consumer of the
 * spec, not just this console; that was filed as objectstack#16063, and it was
 * ruled against. Maintainer verbatim 「16063 c」 — director-seat decision batch
 * #59, recorded on objectui#7122 on 2026-09-06: the growth is accepted
 * upstream, and neither a prose-stripped build nor a short-`describe`
 * convention will land.
 *
 * ⛔ The objectstack#16063 citation therefore STAYS, and its sense is the one
 * thing about it that changed — it is now the RECORDED CAUSE this ceiling
 * rests on, where it used to be a condition to wait out. ⛔ Nothing is coming
 * that would bring this ceiling and {@link BASELINE} back down together, so do
 * not reinstate anything on its account and do not write a fresh condition in
 * its place: a re-baseline that reads as temporary is one nobody ever
 * re-measures. The next bump is measured against THIS number, knowing why it
 * moved — the authorisation above (objectui#7122, decision batch 1 item 1 =
 * "B + A") and the figures it bought landed together in objectui#7685,
 * `639114c4d`.
 *
 * ⛔ No other exemption was added, no import was made lazy, and no other
 * ceiling was moved — the three per-chunk lines that still pass were left
 * exactly as they are.
 *
 * ## Why this number came DOWN (objectui#9251)
 *
 * It was 3,210,000 over a 3,164,817 baseline. objectui#9251 took lucide's
 * runtime `icons` record off the eager path — 1,781 icon module definitions
 * that one namespace index was dragging into `ui-components` — and the closure
 * went 3,180,591 -> 3,133,419 gzipped, 10,975,695 -> 10,606,541 raw, on two
 * console builds of the same tree in one container. That is 47,172 gzipped
 * bytes out, past the ~45 KB at which the header above makes re-pinning an
 * obligation rather than an option: left at 3,210,000 this ceiling would have
 * carried 0.84x of a regression in headroom, against the 0.50x it is designed
 * for.
 *
 * ⛔ A TIGHTENING, and it must not be read as one of the raises above. No build
 * that passed before this edit and measures under 3,179,000 fails after it.
 * Headroom 45,581 bytes = 0.50x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES},
 * which is exactly the value the header argues for — the first time this
 * constant has sat on it rather than above it.
 *
 * ## ⚠️ RAISED A SECOND TIME, ON EXPLICIT MAINTAINER AUTHORISATION (objectui#10996)
 *
 * From 3,179,000 over a 3,133,419 baseline to 3,225,000 over 3,179,055, the
 * latter measured on 2026-09-28 on `5d689c3f6` — `main` itself, with no diff
 * applied. The objectui#7122 heading above says ONCE; it was true when it was
 * written, and this is the second. Raising this ceiling is the act that
 * heading reserves for a human, and the authorisation, verbatim and
 * untranslated — the option the maintainer picked in the `domain:ui` seat 4
 * session chat on 2026-09-28, quoted on objectui#10996 and in its pull
 * request:
 *
 *     授权本席位重设基线 (推荐)
 *
 * The option read, in the seat's words: re-measure on the latest `main`,
 * re-pin {@link BASELINE}, set this ceiling to the reading plus half the
 * regression threshold in ONE commit, and quote the authorisation in the PR.
 * The triage grade on objectui#10996 (comment 5874625537) gave the same
 * direction, and ⛔ ruled out the ceiling moving alone.
 *
 * ⛔ WHY — a wall, not a claimant. `main` itself read OVER this line: the
 * `5d689c3f6` build weighed 3,179,055 against 3,179,000, 55 bytes over, and
 * `node scripts/check-eager-closure-budget.mjs` exited 1 on it
 * (`0.1 KB over the 3104.5 KB budget`). Every pull request that runs this gate
 * weighs `main`'s bytes plus its own, so none could pass whatever its own
 * delta. The per-chunk, membership and sensitivity halves all passed on that
 * build; only the aggregate was red.
 *
 * WHAT THE BYTES ARE — two control builds of `main`, one container, one
 * instrument (`pnpm --filter @object-ui/console exec vite build`, reading
 * `apps/console/dist/eager-closure.json`). The last step first: `4b742f41d`,
 * the newest `main` commit still under the line, 8 commits before the reading.
 * It built to 3,178,471 — the figure the seat recorded on objectui#10996, to
 * the byte, which is this instrument's calibration.
 *
 *   | chunk                | `4b742f41d` | `5d689c3f6` | delta |
 *   |----------------------|------------:|------------:|------:|
 *   | `plugin-form`        |      35,718 |      36,267 |  +549 |
 *   | `plugin-view`        |      18,860 |      18,892 |   +32 |
 *   | seven others         |             |             |    +3 |
 *   | `vendor-objectstack` |   1,237,912 |   1,237,912 |     0 |
 *   | `ui-components`      |     277,412 |     277,412 |     0 |
 *   | `framework`          |      72,233 |      72,233 |     0 |
 *   | `i18n-locale-en`     |      41,739 |      41,739 |     0 |
 *   | ⇒ aggregate          |   3,178,471 |   3,179,055 |  +584 |
 *
 * The four budgeted rows are the unmoved control. `plugin-form`'s +549 is
 * objectui#10986 (`8aa68b159`): `MasterDetailForm` resolving its `I18nLabel`
 * title, submit and cancel text, eager because `apps/console`'s
 * `register-plugins.ts` imports `@object-ui/plugin-form` statically. The only
 * commit in the window that touches `packages/plugin-view` is `e9ca14ca9`
 * (objectui#10975); the +32 is that chunk's, ⛔ not bisected to the commit.
 * The seven others moved by one to four bytes each, netting +3.
 *
 * ⚠️ The step is 584 bytes of a 45,636-byte drift, and ⛔ it is not the cause
 * of this re-pin — it is only the last straw. The whole window, read against
 * `67485872ed`, the squash that landed the retired baseline's branch on
 * `main` (841 commits before the reading, per the GitHub compare API):
 *
 *   | chunk                                   | `67485872ed` | `5d689c3f6` |   delta |
 *   |-----------------------------------------|-------------:|------------:|--------:|
 *   | `ui-components`                         |      266,156 |     277,412 | +11,256 |
 *   | `plugin-form`                           |       29,470 |      36,267 |  +6,797 |
 *   | `plugin-grid`                           |       98,817 |     105,502 |  +6,685 |
 *   | `vendor-icon-*`, all 277 of them        |       76,330 |      82,405 |  +6,075 |
 *   | `src`                                   |      161,575 |     167,515 |  +5,940 |
 *   | `index`                                 |      149,631 |     153,880 |  +4,249 |
 *   | `i18n-locale-en`                        |       40,531 |      41,739 |  +1,208 |
 *   | `data-adapter` + `i18n` + `framework`   |      184,643 |     182,786 |  -1,857 |
 *   | `vendor-objectstack`                    |    1,240,245 |   1,237,912 |  -2,333 |
 *   | everything else (43 names)              |      886,385 |     893,637 |  +7,252 |
 *   | ⇒ aggregate                             |    3,133,783 |   3,179,055 | +45,272 |
 *
 * The `data-adapter` + `i18n` + `framework` row is summed on purpose:
 * `data-adapter` fell 58,765 while `i18n` and `framework` rose 29,528 and
 * 27,380, so read singly they are three large claimants and read together they
 * are a small one.
 * ⛔ Nothing here says what moved between them. The `vendor-icon-*` family is
 * a lit control of its own: 76,330 is the figure {@link BASELINE}'s previous
 * entry recorded for the same 277 chunks on `bbf6b02d9`.
 *
 * ⇒ This is DIFFUSE growth — 841 commits across fifteen days, the largest row a
 * quarter of the total, and ⛔ no row attributed to a commit except the last
 * step's. That is what the re-baseline ABSORBS, in the sense the section of
 * that name in the header gives it, and the rows above are published so the
 * next reader can tell it from the next claimant.
 *
 * ⚠️ `67485872ed` is NOT the retired baseline's tree. It built to 3,133,783,
 * 364 bytes above the 3,133,419 read on `bbf6b02d9`, and the two readings were
 * taken in different containers — so 45,272 + 364 = 45,636 is the whole
 * distance between the retired and the new constant, and the 364 is the one
 * part of it this entry cannot place.
 *
 * ⛔ Shrinking is the follow-up, not this entry: the triage grade names the
 * eager `plugin-form` import above as the measured candidate, the objectui#9399
 * lucide change as the precedent, and routes it to a card of its own.
 *
 * Headroom 45,945 bytes = 0.50x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}:
 * 3,179,055 + 45,568 = 3,224,623, rounded to the nearest thousand, the rounding
 * every re-pin above used. ⛔ The ceiling did not move alone. Over the retired
 * 3,133,419 baseline, 3,225,000 would carry 91,581 bytes, 1.005x the
 * regression, and the unit test's constant-vs-constant guard reds on it — so
 * {@link BASELINE} moved in the same commit, and that guard is the reason.
 *
 * ⛔ Nothing else moved. Not {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES} — a
 * ceiling that rises while the sensitivity relaxes is a gate quietly retiring
 * itself. Not {@link PER_CHUNK_GZIP_CEILINGS} or {@link PER_CHUNK_BASELINE}:
 * all four rows passed on the `5d689c3f6` build, and the first table shows them
 * unmoved. No exemption was added and no import was made lazy.
 *
 * ## ⚠️ RAISED A THIRD TIME, ON EXPLICIT MAINTAINER RULING (objectui#11088; objectui#11073)
 *
 * From 3,225,000 over a 3,179,055 baseline to 3,694,000 over 3,648,737, the
 * latter measured on 2026-09-29 on `048e7f6` — the tip of objectui#11073's
 * branch, the tree that carries `@objectstack/*` 17.5.0 into this repository.
 * That branch landed on `main` as the squash `81f8498` (objectui#11086), the
 * handle a `main` checkout resolves; objectui#11101 back-filled it here once
 * {@link BASELINE} had moved on to its own reading, below.
 * The ruling, recorded by the director seat as comment 5890854293 on
 * objectui#11088 (batch #245 item 2), is the maintainer's 「11088 同意」 to the
 * director's recommendation, decision 1 = A:
 *
 *     The ceiling and the headroom assertion in
 *     `scripts/check-eager-closure-budget.mjs` are raised to the new baseline
 *     in the same commit of PR objectui#11086, the PR body states what the
 *     413.8 KB gzip buys (17.5.0's refusals and schemas, the twenty unblocked
 *     cards), and two payback cards are filed in the same stroke.
 *
 * Precedent objectui#5531 (17.1.0, the maintainer's A). Option B — slim the
 * console first — was ruled against on a reading of the spec source: the growth
 * sits at `@objectstack/spec`'s ROOT entry, mostly the migration and conversion
 * registries' retirement rationale and `os migrate meta` guidance strings, so a
 * console-side lazy load could not recover the bulk.
 *
 * ⛔ WHAT THE BYTES ARE — one container, one instrument (`CI=true pnpm --filter
 * @object-ui/console exec vite build`, reading
 * `apps/console/dist/eager-closure.json`, under `scripts/pm/os-verify-lock.sh`).
 * The control is `a5841be35`, the `main` commit this branch last merged, built
 * the same way in a worktree of its own; both builds weigh 330 of 2446 chunks.
 *
 *   | chunk                         |   `a5841be35` |   `048e7f6` |    delta |
 *   |-------------------------------|--------------:|------------:|---------:|
 *   | `vendor-objectstack`          |     1,237,912 |   1,703,690 | +465,778 |
 *   | `ui-components`               |       277,610 |     277,336 |     -274 |
 *   | `framework`                   |        72,294 |      72,093 |     -201 |
 *   | `src`                         |       168,981 |     169,160 |     +179 |
 *   | everything else (50 names)    |     1,426,438 |   1,426,458 |      +20 |
 *   | ⇒ aggregate                   |     3,183,235 |   3,648,737 | +465,502 |
 *
 * `vendor-objectstack` is the whole of it: the chunk the `@objectstack/*`
 * packages land in, grown by the 17.5.0 release, while every other row nets
 * -276 bytes across the bump's own edits. ⛔ Not attributed below the chunk:
 * the split between the spec's root-entry registries and its schema growth is
 * the director's source reading, recorded on objectui#11088 as a read of source
 * bytes rather than a build, and it is objectstack#20646's to measure.
 *
 * WHAT THEY BUY: the console's client-side validation answering as the 17.5.0
 * server does — its refusals (retired keys refused by name, the terminal
 * unknown-key refusal, the new object-level checks) and its schemas — so the
 * window in which an author, or an AI, writes in the console what the server
 * rejects closes; and the twenty cards the ruling counts as waiting on this
 * bump. ⛔ It is NOT a new console capability.
 *
 * ⭐ PAID BACK AT THE SOURCE, and the ruling filed both cards with it:
 * objectstack#20646 (the spec root entry stops carrying the migration and
 * conversion registries) and objectui#11101 (the metadata-admin-only spec
 * validation leaves the console's first screen). When each lands, this ceiling
 * and {@link BASELINE} come DOWN together by the recovered amount — a
 * re-baseline in the tightening direction, as objectui#9251's was.
 *
 * Headroom 45,263 bytes = 0.50x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}:
 * 3,648,737 + 45,568 = 3,694,305, rounded to the nearest thousand, the rounding
 * every re-pin above used. ⛔ The ceiling did not move alone: over the retired
 * 3,179,055 baseline, 3,694,000 would carry 514,945 bytes, 5.65x the
 * regression, and both the unit test's constant-vs-constant guard and
 * {@link evaluateHeadroomSensitivity} red on it — so {@link BASELINE} moved in
 * the same commit.
 *
 * ⛔ What moved with it, and what did not. `vendor-objectstack`'s per-chunk
 * ceiling fired on the same build (its row above) and moved in this commit,
 * with {@link PER_CHUNK_BASELINE}, under the same ruling. The other three
 * per-chunk rows passed and did not move. Not
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}. No exemption was added and no
 * import was made lazy.
 *
 * ## ⭐ LOWERED BY THE FIRST PAYBACK OF THAT LOAN (objectui#11101)
 *
 * From 3,694,000 to 3,660,380: down by 33,620 bytes, exactly what
 * objectui#11101 took out of the closure. The raise above was a loan, so a
 * payback lowers the line by the amount it recovers. ⛔ The ceiling is NOT
 * re-derived as the new reading plus half a regression, the way the re-pins
 * above were: that would also have absorbed `main`'s own drift since the
 * `048e7f6` reading, which is a raise under another name. ⛔ Not rounded to a
 * thousand either, for the same reason: rounding moves the line by an amount
 * other than the one recovered.
 *
 * WHAT LEFT — two console builds of one tree, one container, one instrument
 * (`CI=true pnpm exec vite build` in `apps/console`, reading
 * `apps/console/dist/eager-closure.json`, under `scripts/pm/os-verify-lock.sh`).
 * `5262f7d` is `main`; `4acbea07` is that tree plus the one line in
 * `apps/console/vite.config.ts` that moved the bytes.
 *
 *   | chunk                       |  `5262f7d` | `4acbea07` |   delta |
 *   |-----------------------------|-----------:|-----------:|--------:|
 *   | `vendor-objectstack`        |  1,704,699 |  1,670,964 | -33,735 |
 *   | the other 329 eager chunks  |  1,967,025 |  1,967,140 |    +115 |
 *   | ⇒ aggregate                 |  3,671,724 |  3,638,104 | -33,620 |
 *
 * Both builds weigh 330 eager chunks; the bundle grows from 2447 chunks to
 * 2450, and the three new ones are lazy. Four modules left
 * `vendor-objectstack`, and nothing joined it: `@objectstack/spec`'s `/ai` and
 * `/integration` entries, which the metadata designers' client validation
 * (`views/metadata-admin/clientValidation.ts`) reaches only through
 * `await import()`; `/contracts`, reached by lazy console pages and the
 * linter; and `@objectstack/sdui-parser`, reached by the linter alone. The
 * +115 is import bookkeeping, spread over 31 chunks, none by more than 20.
 *
 * The mechanism is one option on the `vendor-objectstack` group,
 * `tags: ['$initial']`, and the comment there says why it was the line that
 * mattered: the validator's `import()`s were already in the source, and the
 * group overrode them, the objectui#5266 mechanism one package over.
 *
 * ⛔ What it did NOT recover, measured on the same `5262f7d` build. Every
 * other spec entry `clientValidation.ts` loads is ALSO imported statically by
 * something on the first screen — the runtime shell, the data adapter,
 * `@objectstack/formula`, or the metadata-admin inspectors and previews that
 * the package entry's registration leaf
 * (`views/metadata-admin/register-builtins.ts`) makes eager — so no lazy
 * import in the validator can move them. The root entry's registries are
 * objectstack#20646's to pay back, at the source.
 *
 * Headroom 22,276 bytes = 0.24x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}
 * over {@link BASELINE}. That is the headroom `main` already had on
 * `5262f7d` before the payback (3,694,000 − 3,671,724), kept to the byte,
 * and it is under the 0.50x design point because `5262f7d` weighed 22,987
 * bytes more than the `048e7f6` reading the raise was sized on — a later tree,
 * in another container, ⛔ not attributed here. A narrower band is the
 * tightening direction: no build that passed before this edit and measures
 * under 3,660,380 fails after it.
 *
 * ⛔ What moved with it, and what did not. `vendor-objectstack`'s per-chunk
 * ceiling came down the same way, by the 33,735 bytes that chunk lost, with
 * {@link PER_CHUNK_BASELINE}. The other three per-chunk rows did not move,
 * and neither did {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}.
 * objectstack#20646 is the second payback, and it lowers both lines again by
 * what it recovers.
 *
 * ## ⭐ LOWERED BY THE SECOND PAYBACK (objectstack#20646, carried by objectui#11438)
 *
 * From 3,660,380 to 3,410,284: down by 250,096 bytes, exactly what the
 * `@objectstack/*` 17.6.0 bump took out of the closure. 17.6.0 carries the
 * spec's migrations-entry-split: the root entry no longer exports the
 * migration chain (`MIGRATIONS_BY_MAJOR` moved to `@objectstack/spec/migrations`,
 * which nothing on the first screen imports). Lowered by the amount recovered,
 * as objectui#11101's payback was: ⛔ not re-derived as the new reading plus
 * half a regression, and ⛔ not rounded.
 *
 * WHAT LEFT — two console builds, one container, one instrument, one hold of
 * `scripts/pm/os-verify-lock.sh`: `pnpm turbo run build --filter='./packages/*'`,
 * then `CI=true pnpm exec vite build` in `apps/console`, reading
 * `apps/console/dist/eager-closure.json`. `2d576e46` is `main` with
 * `@objectstack/*` 17.5.0 resolved; `2ba091c` is objectui#11438's branch, the
 * same tree with 17.6.0 resolved and the bump's own edits.
 *
 *   | chunk                       |  `2d576e46` |  `2ba091c` |    delta |
 *   |-----------------------------|------------:|-----------:|---------:|
 *   | `vendor-objectstack`        |   1,671,066 |  1,420,958 | -250,108 |
 *   | the other 329 eager chunks  |   1,965,223 |  1,965,235 |      +12 |
 *   | ⇒ aggregate                 |   3,636,289 |  3,386,193 | -250,096 |
 *
 * Both builds weigh 330 of 2450 chunks. The +12 is spread over the other
 * chunks, ⛔ not attributed here. Left at 3,660,380, the ceiling would have
 * stood 274,187 bytes (3.01x the regression) above this payload, and
 * {@link evaluateHeadroomSensitivity} calls that a blind gauge (exit 2).
 *
 * Headroom 24,091 bytes = 0.26x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}
 * over {@link BASELINE}: exactly the headroom `main` had on `2d576e46` before
 * the payback (3,660,380 − 3,636,289), because the ceiling came down by the
 * aggregate's own delta. No build that passed before this edit and measures
 * under 3,410,284 fails after it.
 *
 * ⛔ What moved with it, and what did not. `vendor-objectstack`'s per-chunk
 * ceiling came down the same way, by the 250,108 bytes that chunk lost, with
 * {@link PER_CHUNK_BASELINE}. The other three per-chunk rows did not move,
 * and neither did {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}.
 *
 * ## ⚠️ RAISED A FOURTH TIME, ON EXPLICIT MAINTAINER RULING (objectui#11717)
 *
 * From 3,410,284 over a 3,386,193 baseline to 3,637,000 over 3,591,028, the
 * latter measured on `c1e32e96`: objectui#11717's branch with `main` at
 * `9b673e54` merged in, the tree that carries `@objectstack/*` 17.7.0 into this
 * repository. The ruling is record 6027998226 on objectui#11717, the
 * maintainer's answer to decision request 6024630321, selected verbatim:
 *
 *     「A 抬预算+回收卡 (Recommended)」
 *
 * In the ruling's own words: the eager-closure ceiling, {@link BASELINE} and
 * the `vendor-objectstack` row of {@link PER_CHUNK_BASELINE} / its per-chunk
 * ceiling are raised in one commit of PR objectui#11742, in the objectui#11088
 * shape, with the headroom kept at half of
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}, and a payback card is filed in
 * the same stroke.
 *
 * ⛔ WHAT THE BYTES ARE — one container, one instrument, two holds of
 * `scripts/pm/os-verify-lock.sh`: `pnpm exec turbo run build
 * --filter=!@object-ui/site --concurrency=2` in each tree (which builds the
 * console), then `pnpm check:eager-closure`, reading
 * `apps/console/dist/eager-closure.json`. The control is `9b673e54`, the `main`
 * commit this branch last merged, built the same way in a worktree of its own
 * with `@objectstack/*` 17.6.0 resolved. Both builds weigh 331 of 2451 chunks.
 *
 *   | chunk                         |  `9b673e54` |  `c1e32e96` |    delta |
 *   |-------------------------------|------------:|------------:|---------:|
 *   | `vendor-objectstack`          |   1,421,565 |   1,604,474 | +182,909 |
 *   | `ui-components`               |     283,061 |     283,079 |      +18 |
 *   | `framework`                   |      74,774 |      74,785 |      +11 |
 *   | `src`                         |     176,172 |     176,181 |       +9 |
 *   | `i18n-locale-en`              |      44,592 |      44,620 |      +28 |
 *   | everything else (326 names)   |   1,407,856 |   1,407,889 |      +33 |
 *   | ⇒ aggregate                   |   3,408,020 |   3,591,028 | +183,008 |
 *
 * `vendor-objectstack` is the whole of it: the chunk the `@objectstack/*`
 * packages land in, grown by the 17.7.0 release, while every other row nets
 * +99 bytes across the bump's own edits. ⛔ Not attributed below the chunk by a
 * build: the build records no module-level sizes for this chunk. The reading
 * below the chunk, recorded on objectui#11717, is a byte diff of the two
 * installed releases by entry file, not of what this chunk keeps after
 * tree-shaking. Among the spec entries this repository's shipped code imports,
 * `shared` grew most (+152,445 gzipped bytes as a standalone file, behind an
 * unchanged list of exports), then the browser root, `browser/system`, `ui`
 * and `browser/kernel` entries.
 *
 * WHAT THEY BUY: the console's client-side validation answering as the 17.7.0
 * server does — its new refusals (the chart measure-arity check on a dashboard
 * widget, `requires` by page `kind`, a master-detail `sortField`, the retired
 * keys and values refused by name) and its schemas — so the window in which an
 * author, or an AI, writes in the console what the server rejects closes; and
 * the cards this bump unblocks (objectui#11717 lists them). ⛔ It is NOT a new
 * console capability.
 *
 * ⭐ PAYBACK: objectstack#22044, filed in the same stroke as the ruling. When it
 * lands, this ceiling and {@link BASELINE} come DOWN together by the amount it
 * recovers, the way objectui#11101 and objectui#11438 lowered the third raise:
 * ⛔ not re-derived as a new reading plus half a regression, and ⛔ not rounded.
 *
 * Headroom 45,972 bytes = 0.50x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}:
 * 3,591,028 + 45,568 = 3,636,596, rounded to the nearest thousand, the rounding
 * every raise above used (the two paybacks, by rule, did not round). ⛔ The
 * ceiling did not move alone: over the retired 3,386,193 baseline, 3,637,000
 * would carry 250,807 bytes, 2.75x the regression, and both the unit test's constant-vs-constant guard and
 * {@link evaluateHeadroomSensitivity} red on it — so {@link BASELINE} moved in
 * the same commit.
 *
 * ⛔ What moved with it, and what did not. `vendor-objectstack`'s per-chunk
 * ceiling fired on the same build (its row above) and moved in this commit,
 * with {@link PER_CHUNK_BASELINE}, under the same ruling. The other three
 * per-chunk rows passed and did not move. Not
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}. No exemption was added and no
 * import was made lazy.
 *
 * ## ⭐ LOWERED WHEN THE STUDIO BUILDER AND THE CHART ENGINE LEFT THE FIRST LOAD (objectui#11798)
 *
 * From 3,637,000 to 3,444,622: down by 192,378 bytes, exactly what
 * objectui#11798 took out of the closure. Lowered by the amount recovered, as
 * the two paybacks above were: ⛔ not re-derived as the new reading plus half a
 * regression, which would also have absorbed `main`'s drift since the
 * `c1e32e96` reading (a raise under another name), and ⛔ not rounded.
 *
 * WHAT LEFT — two console builds of one tree, one container, one instrument,
 * each under `scripts/pm/os-verify-lock.sh`: the console's own
 * `apps/console/vite.config.ts` run through Vite's `build()` with one read-only
 * module-graph dump appended, reading the `eager-closure.json` the build
 * writes. `455c6466` is `main`; `c1d378ec` is objectui#11798's branch with
 * `455c6466` merged in. The `main` tree was built in the branch's worktree with
 * the branch's bundler inputs (`apps/console/vite.config.ts`, `StudioRoute.tsx`,
 * `registerStudioComponents.tsx`) checked out from `455c6466`, its new
 * `studioBuilder.ts` removed, and each file's blob hash compared against
 * `455c6466` before the build. Gzipped bytes:
 *
 *   | chunk                                       | `455c6466` | `c1d378ec` |    delta |
 *   |---------------------------------------------|-----------:|-----------:|---------:|
 *   | `vendor-charts`                             |    158,827 |       lazy | -158,827 |
 *   | `index`                                     |    161,208 |     88,295 |  -72,913 |
 *   | `studioScope`, new                          |          — |     40,375 |  +40,375 |
 *   | `vendor-icon-*`                             |     83,412 |     81,994 |   -1,418 |
 *   | `useNavSelDeepLink`                         |      1,282 |       lazy |   -1,282 |
 *   | `nav-selection` + `useRecentItemLabel`, new |          — |      1,088 |   +1,088 |
 *   | `vendor-react`                              |     72,584 |     73,143 |     +559 |
 *   | everything else                             |  3,133,324 |  3,133,364 |      +40 |
 *   | ⇒ aggregate                                 |  3,610,637 |  3,418,259 | -192,378 |
 *
 * The builds weigh 336 of 2452 chunks and 333 of 2456. Two mechanisms, each
 * weighed by reverting only its own source on the `c1d378ec` tree, built the
 * same way:
 *
 *   - THE CHART ENGINE (-158,535 alone). Recharts and d3 were reached only
 *     through `import()`, but `vendor-charts` captured
 *     `use-sync-external-store/shim` through its default recursive capture,
 *     and `react-i18next` imports that shim on every page, so the eager
 *     `vendor-i18n` chunk imported the whole chart engine. `vendor-react` now
 *     claims the shim (the comment on that group in `apps/console/vite.config.ts`
 *     says why the flag that would also have stopped the capture was refused);
 *     the shim's bytes are the `vendor-react` row.
 *   - THE STUDIO BUILDER (-33,928 alone). `StudioDesignSurface` and
 *     `BuilderLanding` load through the console-local `import()` in
 *     `apps/console/src/components/studioBuilder.ts`. Most of what `index` lost
 *     is the builder; the `studioScope` row is NOT new payload but 49 modules
 *     `index` held on `455c6466` (the app header and the AI chat page among
 *     them), which the bundler split out because the lazy builder imports
 *     them too.
 *
 * ⛔ What it did NOT recover. The flow designer, its canvas among them, and
 * every other metadata-admin designer stay eager: `@object-ui/app-shell`'s
 * package entry imports `views/metadata-admin/register-builtins.ts` for its
 * side effects, which a console-side `import()` cannot move.
 *
 * Headroom 26,363 bytes = 0.29x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}
 * over {@link BASELINE}: exactly the headroom `main` had on `455c6466` before
 * this change (3,637,000 − 3,610,637), because the ceiling came down by the
 * aggregate's own delta. It sits under the 0.50x design point because
 * `455c6466` weighed 19,609 bytes more than the `c1e32e96` reading the fourth
 * raise was sized on — `main`'s drift since, ⛔ not attributed here. No build
 * that passed before this edit and measures under 3,444,622 fails after it,
 * and either mechanism above, reverted alone, lands over it.
 *
 * ⛔ What moved with it, and what did not. None of the four per-chunk rows:
 * the budgeted chunks moved by at most 2 bytes across the two builds, so
 * {@link PER_CHUNK_GZIP_CEILINGS} and {@link PER_CHUNK_BASELINE} stand. Not
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}. No exemption was added.
 *
 * ## ⭐ LOWERED WHEN THE MARKDOWN HIGHLIGHTER LEFT THE FIRST LOAD (objectui#11854)
 *
 * From 3,444,622 to 3,386,364: down by 58,258 bytes, exactly what
 * objectui#11854 took out of the closure. Lowered by the amount recovered, as
 * the objectui#11798 entry above was: ⛔ not re-derived as the new reading plus
 * half a regression, which would also have absorbed `main`'s drift since the
 * `c1d378ec` reading (a raise under another name), and ⛔ not rounded.
 *
 * WHAT LEFT — two console builds, one container, one instrument, each under
 * `scripts/pm/os-verify-lock.sh`: the console's own
 * `apps/console/vite.config.ts` run through Vite's `build()` with one read-only
 * module-graph dump appended, reading the `eager-closure.json` the build
 * writes. `9cb4e29` is `main`; `406f760` is that tree plus the chunk-group
 * change to `vendor-markdown` in `apps/console/vite.config.ts`, and nothing
 * else. Gzipped bytes:
 *
 *   | chunk                         |  `9cb4e29` |  `406f760` |   delta |
 *   |-------------------------------|-----------:|-----------:|--------:|
 *   | `vendor-markdown`             |    163,717 |    104,286 | -59,431 |
 *   | `vendor-react-markdown`, new  |          — |      1,144 |  +1,144 |
 *   | `ui-components`               |    284,424 |    284,433 |      +9 |
 *   | everything else               |  2,985,461 |  2,985,481 |     +20 |
 *   | ⇒ aggregate                   |  3,433,602 |  3,375,344 | -58,258 |
 *
 * The builds weigh 333 of 2456 chunks (`9cb4e29`) and 334 of 2457
 * (`406f760`); the one new chunk is `vendor-react-markdown`, and it is eager.
 * The +20 is import bookkeeping spread over 19 chunks, none by more than 5,
 * ⛔ not attributed further; every `vendor-icon-*` chunk is unmoved.
 *
 *   - THE CAPTURE. On `9cb4e29` `vendor-markdown` held 296 modules, and 53 of
 *     them no static import from the entry reaches: `highlight.js` (39 of the
 *     53, most of the bytes), `lowlight`, `rehype-highlight`, `rehype-slug`,
 *     `github-slugger`, `rehype-autolink-headings`,
 *     `remark-github-blockquote-alert`, the five hast and unist helpers they
 *     import, and `react-markdown`. The chunk was eager for the other 243,
 *     which the chat message renderer reaches, so the group's capture made all
 *     296 eager. With `tags: ['$initial']` the group holds the 243 alone (the
 *     comment on the group in `apps/console/vite.config.ts` says why), and 52
 *     of the 53 follow their importer into `plugin-markdown`'s lazy chunk,
 *     which went from 4,342 to 62,888 gzipped bytes across the two builds.
 *   - `react-markdown`, the 53rd, stays eager in the new chunk: `MarkdownContent`
 *     in `packages/fields` imports it statically, and that widget sits in the
 *     eager `ui-components` chunk although only `React.lazy` reaches it (the
 *     objectui#5325 co-tenancy, recorded in
 *     `scripts/vite-ineffective-dynamic-imports.ts`). A chunk of its own keeps
 *     its bytes off the budgeted `ui-components` line, which would otherwise
 *     take it by its own capture.
 *
 * ⛔ What it did NOT recover. The 243 modules left in `vendor-markdown` are the
 * pipeline the chat message renderer runs on every page: `streamdown` imports
 * `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-raw`,
 * `rehype-sanitize`, `rehype-harden`, `unified` and `hast-util-to-jsx-runtime`
 * statically, and `plugin-chatbot`, which imports `streamdown` statically, is
 * eager. Moving them would lazy-load a module the first load reaches, which is
 * objectui#11798's question under the objectui#6795 ruling, ⛔ not a chunk
 * group's.
 *
 * Headroom 11,020 bytes = 0.12x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}
 * over {@link BASELINE}: exactly the headroom `main` had on `9cb4e29` before
 * this change (3,444,622 − 3,433,602), because the ceiling came down by the
 * aggregate's own delta. It sits under the 0.29x the objectui#11798 entry left
 * because `9cb4e29` weighed 15,343 bytes more than the `c1d378ec` reading that
 * entry was sized on — `main`'s drift since, ⛔ not attributed here. No build
 * that passed before this edit and measures under 3,386,364 fails after it,
 * and the `9cb4e29` build, which is this change reverted, lands over it.
 *
 * ⛔ What moved with it, and what did not. None of the four per-chunk rows:
 * `ui-components` moved by 9 bytes across the two builds and the other three
 * budgeted chunks by none, so {@link PER_CHUNK_GZIP_CEILINGS} and
 * {@link PER_CHUNK_BASELINE} stand; `vendor-markdown` has no row and gets
 * none. Not {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}. No exemption was
 * added.
 *
 * ## ⚠️ RAISED A FIFTH TIME, BY A FIXED ALLOWANCE, ON EXPLICIT MAINTAINER RULING (objectui#11942)
 *
 * From 3,386,364 to 3,391,484: up by exactly 5,120 gzip bytes, an ALLOWANCE
 * and ⛔ not a re-baseline. {@link BASELINE} did not move, because nothing was
 * measured: the ruling sized the allowance, not a build. ⛔ Not re-derived as a
 * reading plus half a regression, and ⛔ not rounded — either would move the
 * line by an amount other than the one ruled. The ruling is record 6056819248
 * on objectui#11942 (director-seat batch #292 item 3, letters B then C), the
 * maintainer's 「同意」 to the seat's recommendation. Its step 2, verbatim:
 *
 *     B. Then one PR raises `MAX_EAGER_CLOSURE_GZIP_BYTES` by a fixed
 *     allowance of at most 5 KB, carrying this card's number; the constant's
 *     docblock states what the bytes buy (Studio fixes while the designers are
 *     eager by design) and the reclaim condition.
 *
 * Its step 1 put objectui#11937 first: `main` comes back under the previous
 * line by rollback or plugging, ⛔ never by this allowance.
 *
 * WHAT THE BYTES BUY: Studio fixes while the metadata-admin designers are
 * eager by design. Ruling A on objectui#11798 (record 6054102412) keeps the
 * designers on the first load until objectui#6795's order moves them, so a
 * Studio fix that edits a designer adds first-load bytes however small it is.
 * The fixes the ruling names — objectui#11921's pull request objectui#11941,
 * objectui#11923, objectui#11909, and any later Studio fix that adds bytes —
 * land against this line; a byte-neutral fix lands as it did before. ⛔ It is
 * NOT headroom for any other growth, and NOT a new console capability.
 *
 * ⚠️ An allowance is not a reading, so this entry carries no rows: no build
 * was taken. What it absorbs is whatever lands under it — a named Studio fix
 * and `main`'s own drift alike — and nothing in this file tells the two apart
 * (the header's "What a re-baseline ABSORBS" section). Each Studio fix's bytes
 * are read where they arrive: the `Bundle Analysis` comment on its own pull
 * request.
 *
 * ⭐ RECLAIM: objectui#11939, step 3 of the same ruling. The pull request that
 * moves the designers out of the first load lowers this ceiling by the bytes
 * that leave PLUS these 5,120, in the same change. ⛔ Not by the bytes that
 * leave alone: that keeps the allowance after its reason is gone, which is a
 * raise under another name.
 *
 * ⚠️ AMENDED before it ran: ruling 6070754914 replaced this reclaim with the
 * conventional re-pin, because the formula above would have landed under the
 * measured first load. The objectui#11939 entry below carries the ruling, the
 * end of this allowance and the drift it absorbed.
 *
 * Headroom 16,140 bytes = 0.18x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}
 * over {@link BASELINE} (3,391,484 − 3,375,344); the allowance alone is 0.06x.
 * The 89 KiB regression this gate exists to catch is still caught: added to
 * the baseline it lands at 3,466,480, 74,996 bytes over this line. ⚠️ That is
 * arithmetic on two constants, as above — the live headroom is what
 * `pnpm check:eager-closure` prints, and it is smaller by `main`'s drift since
 * the `406f760` reading.
 *
 * ⛔ What moved with it, and what did not. Not {@link BASELINE}, not
 * {@link PER_CHUNK_GZIP_CEILINGS} or {@link PER_CHUNK_BASELINE}, and not
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}. No exemption was added and no
 * import was made lazy.
 *
 * ## ⭐ RE-BASELINED WHEN THE BUILT-IN DESIGNERS LEFT THE FIRST LOAD, ON EXPLICIT MAINTAINER RULING (objectui#11939)
 *
 * From 3,391,484 to 3,281,467: the reading 3,235,899 on `f05f015` plus
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES} / 2 = 45,568 — the
 * conventional re-pin, ⛔ not "the bytes that left plus the allowance" the
 * objectui#11942 entry above had scheduled, and ⛔ not rounded. The ruling is
 * record 6070754914 on objectui#11939 (director-seat batch #294 item 3, letter
 * D), the maintainer's 「11939 上线适当多预留一些没问题,不要一直因为这个改代码」. Its
 * operative paragraph, verbatim:
 *
 *     **D — the conventional rebaseline.** The PR that moves the designers out
 *     of the first load (objectui#11982) pins `MAX_EAGER_CLOSURE_GZIP_BYTES`
 *     to the landing head's measured first load plus half a regression
 *     (45,568 B), the formula the gate already documents for a re-pin, and
 *     re-pins `BASELINE` in the same change. The docblock states what the
 *     margin is for: catching an 89 KB-class regression, with room for the
 *     copy-level and fix-level churn `main` takes every day, ⛔ not an
 *     allowance to be spent on a feature. The 5,120 B Studio allowance of
 *     objectui#11942 ends with this re-pin (its reason is gone), and the drift
 *     it absorbed is recorded in the docblock, not reclaimed by a lower
 *     ceiling. This amends item 3 of 6056819248 (objectui#11942), whose
 *     literal formula would land below the measured figure, against the gate's
 *     own rule.
 *
 * And the standing rule the same record draws from the maintainer's words: the
 * ceiling "moves only on a measured move-out (re-pinned by this formula) or on
 * a regression the gate catches; it is not re-pinned per pull request, and a
 * fix that adds first-load bytes within the margin lands without a ruling."
 *
 * WHAT THE MARGIN IS FOR, in the ruling's words: catching an 89 KB-class
 * regression, with room for the copy-level and fix-level churn `main` takes
 * every day, ⛔ not an allowance to be spent on a feature. Headroom 45,568
 * bytes = 0.50x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES} over
 * {@link BASELINE}, the design point the header argues for; the 89 KiB
 * regression added to the baseline lands at 3,327,035, 45,568 bytes over this
 * line.
 *
 * WHAT LEFT — two console builds, one container, one instrument, each under
 * `scripts/pm/os-verify-lock.sh`: the console's own
 * `apps/console/vite.config.ts` run through Vite's `build()` with one
 * read-only chunk-module dump appended, reading the `eager-closure.json` the
 * build writes; the console's ordinary `pnpm exec vite build` of `f05f015`
 * wrote the same figure to the byte, which is this instrument's calibration.
 * `28557855` is `main`; `f05f015` is that tree merged into the branch that
 * loads the built-in previews and inspectors from a chunk the package entry
 * imports dynamically (`register-builtin-designers.ts`), and nothing else.
 * Gzipped bytes:
 *
 *   | chunk                                   | `28557855` | `f05f015` |    delta |
 *   |-----------------------------------------|-----------:|----------:|---------:|
 *   | `src` (the app-shell entry's chunk)     |    192,138 |    41,442 | -150,696 |
 *   | `RecordDetailView`                      |     38,985 |    19,503 |  -19,482 |
 *   | `default-inspector-registry`, left      |     13,284 |         — |  -13,284 |
 *   | `ReportDefaultInspector`, left          |      8,156 |         — |   -8,156 |
 *   | `InterfaceListPage`, left               |      4,454 |         — |   -4,454 |
 *   | `pageKindNode`, left                    |         80 |         — |      -80 |
 *   | 56 `vendor-icon-*` chunks, left         |     16,781 |         — |  -16,781 |
 *   | `vendor-objectstack`                    |  1,605,751 | 1,599,283 |   -6,468 |
 *   | `createDerive`                          |      2,489 |       933 |   -1,556 |
 *   | `ActionResultDialog`                    |     14,026 |    12,782 |   -1,244 |
 *   | 13 chunks new to the closure's names    |          — |    66,548 |  +66,548 |
 *   | 27 others, none by more than 19         |            |           |     +136 |
 *   | ⇒ aggregate                             |  3,391,416 | 3,235,899 | -155,517 |
 *
 * The builds weigh 336 of 2458 chunks (`28557855`) and 289 of 2474
 * (`f05f015`). The 13 new names hold no new module: the module-level read of
 * the same two builds counts 165 modules leaving the eager closure and none
 * joining, so they are modules that sat in `src` re-chunked under the name of
 * a lazy neighbour (`ViewVariantInspector`, `PackagesPage`, …). The 165, by
 * rendered bytes: `metadata-admin/previews` 554,838 (56 modules),
 * `metadata-admin/inspectors` 396,857 (38), other `metadata-admin` 41,664 (12:
 * the three designer registries, the external-datasource panels, three schema
 * helpers and `metadata-form-i18n`), `lucide-react` icons 37,230 (56),
 * `@objectstack/spec`'s `identity` entry 27,098 (1), and `InterfaceListPage`
 * with `pageKindNode` 14,572 (2).
 *
 * ⭐ THE STUDIO ALLOWANCE ENDS HERE. The 5,120 bytes objectui#11942 added are
 * not carried into this line: the ceiling is derived from the new reading
 * alone. The drift the allowance absorbed is RECORDED, ⛔ not reclaimed by a
 * lower ceiling, as the ruling says. Measured: `main` read 3,385,979 on
 * `1c51e973`, the commit that landed the allowance (385 bytes under the
 * pre-allowance line, 3,386,364), and 3,391,416 on `28557855` — +5,437, of
 * which 5,052 sat above the pre-allowance line, leaving 68 bytes of the
 * allowance unspent. By chunk, `1c51e973` to `28557855`: `src` +2,595,
 * `i18n` (it holds `metadata-admin/i18n.ts`) +1,490, `SchemaForm` +903,
 * `ui-components` +715, `nav-selection` +466, `plugin-grid` +358,
 * `default-inspector-registry` +215, `index` +203, `plugin-form` +154,
 * `InterfaceListPage` +141, `ReportDefaultInspector` +102,
 * `useRecentItemLabel` −507, `studioScope` −1,604, and +206 over 30 rows of
 * under 100 each — ⛔ not attributed to commits. Those 5,052 bytes stay on the
 * first load after the designers leave: the objectui#11942 formula,
 * 3,391,484 − 155,517 − 5,120 = 3,230,847, lands 5,052 bytes UNDER the
 * `f05f015` reading, which is the gate's own "never lower a ceiling below the
 * measured figure" (report 6062475046 on objectui#11939 measured the same gap
 * as 4,057 bytes on `d7e9e9ab`, before `main` moved).
 *
 * ⛔ What moved with it, and what did not. {@link BASELINE}, in the same
 * commit, onto `f05f015`. None of the four per-chunk rows: across the two
 * builds `vendor-objectstack` moved by −6,468 (the `identity` entry above;
 * 1,599,283 against its 1,623,000 ceiling is 0.26x), `ui-components` by −19,
 * `framework` by +10 and `i18n-locale-en` by 0, so every per-chunk ceiling
 * stays in range and {@link PER_CHUNK_GZIP_CEILINGS},
 * {@link PER_CHUNK_BASELINE} and {@link PER_CHUNK_MEMBERSHIP} stand. Not
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}. No exemption was added.
 *
 * ## ⭐ LOWERED BY THE PAYBACK OF THE FOURTH RAISE (objectstack#22044, carried by objectui#12030)
 *
 * From 3,281,467 to 3,194,246: down by 87,221 bytes, exactly what the
 * `@objectstack/*` 18.0.0-next.0 bump took out of the closure. The fourth raise
 * above (objectui#11717, ruling 6027998226) filed objectstack#22044 as its
 * payback; that card landed as `93125aeeb8`, an ancestor of the commit the
 * 18.0.0-next.0 tags name, and objectui#12030 is the bump that resolves it.
 * objectui#11762 held the rule this entry executes: lowered by the amount
 * recovered, as the objectui#11101 and objectui#11438 paybacks were — ⛔ not
 * re-derived as the new reading plus half a regression, which would also have
 * absorbed `main`'s drift since the `f05f015` reading (a raise under another
 * name), and ⛔ not rounded.
 *
 * WHAT LEFT — two console builds, one container, one instrument, each under
 * `scripts/pm/os-verify-lock.sh`: `CI=true pnpm exec turbo run build
 * --filter=@object-ui/console... --concurrency=2` in each tree (exit 0),
 * reading `apps/console/dist/eager-closure.json`. `cea429b` is `main`, built in
 * a worktree of its own after a frozen install; `5488ae7` is objectui#12030's
 * branch, the same tree with the `next` prerelease resolved and the bump's own
 * edits. Gzipped bytes:
 *
 *   | chunk                         |  `cea429b` |  `5488ae7` |   delta |
 *   |-------------------------------|-----------:|-----------:|--------:|
 *   | `vendor-objectstack`          |  1,599,281 |  1,512,690 | -86,591 |
 *   | `ui-components`               |    285,771 |    284,925 |    -846 |
 *   | everything else (70 names)    |  1,324,632 |  1,324,848 |    +216 |
 *   | ⇒ aggregate                   |  3,209,684 |  3,122,463 | -87,221 |
 *
 * Both builds weigh 72 of 2255 chunks, under the same 72 names.
 * `vendor-objectstack` is nearly the whole of it: the chunk the
 * `@objectstack/*` packages land in. ⛔ Not attributed below the chunk. The
 * upstream seat's figure on objectstack#22044 (−226,301 on this chunk) was
 * taken on a spec dist built from objectstack `main` and injected, and the
 * release carries everything else its line took on as well, so what this
 * repository's first load gives back is the net −86,591 measured here, as
 * objectui#11762 asked. `ui-components` moved by −846 across the bump's own
 * edits, which reach it through `packages/components`; the +216 is spread over
 * the other names, none by more than 145. Neither is attributed further.
 *
 * Headroom 71,783 bytes = 0.79x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}
 * over {@link BASELINE}: exactly the headroom `main` had on `cea429b` before
 * the payback (3,281,467 − 3,209,684), because the ceiling came down by the
 * aggregate's own delta. Left at 3,281,467, the ceiling would have stood
 * 159,004 bytes (1.74x the regression) above this payload, and
 * {@link evaluateHeadroomSensitivity} calls that a blind gauge (exit 2), as it
 * did on the build of the bump commit alone. No build that passed before this
 * edit and measures under 3,194,246 fails after it.
 *
 * ⛔ What moved with it, and what did not. `vendor-objectstack`'s per-chunk
 * ceiling came down the same way, by the 86,591 bytes that chunk lost, with
 * {@link PER_CHUNK_BASELINE}, re-pinned onto the same build; the bump commit's
 * build had read it at 1.21x as well. The other three per-chunk rows did not
 * move: across the two builds `ui-components` moved by −846, `framework` by −13
 * and `i18n-locale-en` by −5. Not {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}.
 * No exemption was added and no import was made lazy.
 *
 * ## ⚠️ EVERY CEILING RAISED BY 20%, ON EXPLICIT MAINTAINER RULING (objectui#12653, 2026-10-16)
 *
 * The maintainer's words, verbatim, answering objectui#12648's
 * `vendor-objectstack` overrun: 「上限同统一调高 20% ，避免类似的问题。」 (raise
 * every ceiling by the same 20%, to avoid this class of problem). Every
 * `@objectstack/*` bump had been landing on ceilings with almost no headroom
 * and spending a measured raise round on it; the ruling buys room for a bump
 * of normal size instead.
 *
 * THE RULE APPLIED: each byte ceiling × 1.20, rounded UP to the nearest 1,000
 * bytes, from the value in force once objectui#12648 had merged (that pull
 * request raised `vendor-objectstack` from 1,536,409 to 1,555,705 and left
 * every other ceiling alone). Gzipped bytes:
 *
 *   | constant                                        |    before |      after |
 *   |-------------------------------------------------|----------:|-----------:|
 *   | `MAX_EAGER_CLOSURE_GZIP_BYTES`                  | 3,194,246 |  3,834,000 |
 *   | `PER_CHUNK_GZIP_CEILINGS['vendor-objectstack']` | 1,555,705 |  1,867,000 |
 *   | `PER_CHUNK_GZIP_CEILINGS['i18n-locale-en']`     |    50,000 |     60,000 |
 *   | `PER_CHUNK_GZIP_CEILINGS['framework']`          |   100,000 |    120,000 |
 *   | `PER_CHUNK_GZIP_CEILINGS['ui-components']`      |   289,000 |    347,000 |
 *   | `REGRESSION_THIS_GATE_MUST_CATCH_BYTES`         | 89 * 1024 | 695 * 1024 |
 *
 * WHY THE REGRESSION MOVED, AND TO WHAT. {@link evaluateHeadroomSensitivity}
 * calls a ceiling blind (exit 2) once its headroom over the payload reaches
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}, so a 20% raise with the
 * regression left at 89 KiB reds the gate on itself. On a fresh console build
 * (`CI=true pnpm --filter @object-ui/console exec vite build`, reading
 * `apps/console/dist/eager-closure.json`) the aggregate's headroom under the
 * new ceiling needs well over 600 KiB to stay non-blind. The constant-vs-constant
 * guard in `scripts/__tests__/check-eager-closure-budget.test.ts` ("would have
 * failed on the regression it exists to catch") weighs the same ceiling against
 * {@link BASELINE} instead, 711,537 bytes below it, and {@link BASELINE} is a
 * measurement this ruling does not move. 695 KiB is the smallest whole KiB
 * that clears both, so that is the value.
 *
 * ⛔ WHAT THE GATE NO LONGER CATCHES — the trade the ruling accepts. The
 * aggregate line now fails only a regression of about 695 KiB gzipped and
 * above; objectui#5266's 89 KiB, the incident this gate was built for, passes
 * it. Each per-chunk line still fails first on its own, at its own (smaller)
 * headroom, and the sensitivity half now calls a ceiling blind only at 695 KiB
 * of drift. The headroom each line has on YOUR build is what
 * `pnpm check:eager-closure` prints; ⛔ it is not restated here.
 *
 * ⛔ What did NOT move: {@link BASELINE} and {@link PER_CHUNK_BASELINE}, which
 * are measurements, not ceilings; the 350 KB entry-chunk budget in
 * `.github/workflows/performance-budget.yml`; and every other gate. No import
 * was made lazy and no exemption was added.
 *
 * ## ⭐ LOWERED WHEN THE CHAT UI LEFT THE FIRST LOAD (objectui#13410)
 *
 * From 3,834,000 to 3,579,945: down by 254,055 bytes, exactly what
 * objectui#13410 took out of the closure. Lowered by the amount recovered, as
 * the objectui#11854 entry above was: ⛔ not re-derived as the new reading plus
 * half a regression and ⛔ not rounded. Left where it was, the ceiling sat
 * 744.1 KB over the new reading, past {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES},
 * and {@link evaluateHeadroomSensitivity} called it blind (exit 2) on the
 * branch build: that is the re-pin the gate asked for.
 *
 * WHAT LEFT — two console builds, one container, one instrument:
 * `CI=true pnpm exec vite build` in `apps/console`, reading the
 * `eager-closure.json` the build writes. `7981384` is `main`, in a worktree of
 * its own; `b6f11d3` is that tree plus objectui#13410's source change and
 * nothing else. Gzipped bytes:
 *
 *   | chunk                          | `7981384` | `b6f11d3` |    delta |
 *   |--------------------------------|----------:|----------:|---------:|
 *   | `plugin-chatbot`               |   173,666 |         — | -173,666 |
 *   | `vendor-markdown`              |   102,901 |    13,351 |  -89,550 |
 *   | `vendor-react-markdown`        |     1,146 |    23,928 |  +22,782 |
 *   | `ui-components`                |   296,133 |   308,400 |  +12,267 |
 *   | `plugin-chatbot-core`, new     |         — |     5,735 |   +5,735 |
 *   | everything else                | 1,006,784 |   975,161 |  -31,623 |
 *   | ⇒ aggregate                    | 3,326,111 | 3,072,056 | -254,055 |
 *
 * The builds weigh 78 of 2262 chunks (`7981384`) and 85 of 2291 (`b6f11d3`).
 * `vendor-objectstack`, `framework` and `i18n-locale-en` read the same to the
 * byte in both.
 *
 *   - THE MECHANISM. `@object-ui/app-shell` imported `useAgents` and a few
 *     pure helpers from the `@object-ui/plugin-chatbot` package root in eager
 *     modules, `ConsoleLayout` imported the dock that mounts `ChatPane`
 *     statically, and `App.tsx` imported the `/ai` page and the `/s/:token`
 *     share page statically. Any one of those kept the whole `plugin-chatbot`
 *     group eager. The helpers now come from the side-effect-free
 *     `@object-ui/plugin-chatbot/core`, whose modules the `plugin-chatbot-core`
 *     group in `apps/console/vite.config.ts` keeps out of the chat chunk; the
 *     dock body and both pages load through `lazy()`.
 *   - `vendor-markdown` is the objectui#11854 entry's "what it did NOT
 *     recover": the 243 modules `streamdown` reaches, eager only because
 *     `plugin-chatbot` was. Most of them follow it out. What stays is reached
 *     by `MarkdownContent` in `packages/fields`, the objectui#5325 co-tenant of
 *     the eager `ui-components` chunk that only `React.lazy` reaches: those
 *     modules no longer carry the `$initial` reach `vendor-markdown`'s tag
 *     claims by, so `react-markdown`'s own group and `ui-components` capture
 *     them instead. That is the +22,782 and the +12,267 (60 modules in
 *     `ui-components`, the `remark-gfm` family and `mdast-util-to-markdown`).
 *     They were eager before this change and are eager after it, on other
 *     lines: ⛔ not new first-load bytes.
 *   - EVERYTHING ELSE, net -31,623, is spread over the shared application
 *     chunks rolldown regroups: the branch build has seven eager chunks the
 *     control does not (`useMetadata`'s bytes come back under the name `i18n`,
 *     ⛔ not new). By module, what left is the `/ai` page and what only it and
 *     the dock body reach: `AiChatPage`, `useChatConversation`,
 *     `ConversationsSidebar`, `BuildDebugDrawer`, `ExcelImportBar`,
 *     `PendingDraftsBar`, `LiveCanvas`, the Studio publish-error helpers
 *     `metadataError` and `flow-node-config` that page imports, and the
 *     console's `SharedRecordPage`. What joined is the console's
 *     `registerChatbotComponents.ts` and the small modules the change
 *     split out, 1,299 bytes gzipped as modules. Read from the visualizer
 *     report (`dist/stats.html`) of a build of each tree without `CI=true`,
 *     which wrote the same `eager-closure.json` figures to the byte.
 *
 * Headroom 507,889 bytes = 0.71x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}
 * over {@link BASELINE}: exactly the headroom `main` had on `7981384` before
 * this change (3,834,000 − 3,326,111), because the ceiling came down by the
 * aggregate's own delta. No build that passed before this edit and measures
 * under 3,579,945 fails after it.
 *
 * ⚠️ The `7981384` build, which is this change reverted, still PASSES under the
 * new line, with 253,834 bytes of headroom: 254,055 is well inside the
 * 695 KiB band the objectui#12653 ruling accepted, so this line is ⛔ not what
 * would catch the chat UI coming back into the first load. `plugin-chatbot`
 * has no per-chunk row and gets none (a new gate is not this change's to
 * add); a regression shows as `plugin-chatbot` in the largest-chunks list
 * `pnpm check:eager-closure` prints and the `Bundle Analysis` comment carries.
 *
 * ⛔ What moved with it, and what did not. None of the four per-chunk rows.
 * `ui-components` grew by the 12,267 bytes above and still sits under its
 * 347,000 ceiling; the other three budgeted chunks did not move, so
 * {@link PER_CHUNK_GZIP_CEILINGS} and {@link PER_CHUNK_BASELINE} stand. Not
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}. No exemption was added.
 */
export const MAX_EAGER_CLOSURE_GZIP_BYTES = 3_579_945;

/**
 * The measurement the ceiling above was derived from. Exported so the two
 * constraints in the header are CHECKED rather than merely argued
 * (`scripts/__tests__/check-eager-closure-budget.test.ts`): a future edit that
 * raises the ceiling past the regression size it is meant to catch fails a
 * test instead of quietly becoming decorative.
 */
export const BASELINE = Object.freeze({
  /**
   * `emitEagerClosureReport`'s `eagerGzipBytes` on this commit.
   *
   * `b6f11d3` is objectui#13410's branch commit: `main` at `7981384` plus the
   * change that takes the chat UI out of the first load, re-pinned with the
   * ceiling it was lowered with (the objectui#13410 entry on
   * {@link MAX_EAGER_CLOSURE_GZIP_BYTES} carries its table and its `7981384`
   * control, ⛔ not restated here). It is a branch commit for the reason the
   * paragraphs below give for `c1d378ec`: the pull request's own diff is what
   * moved the figure. Measured by `CI=true pnpm exec vite build` in
   * `apps/console` (exit 0), reading `apps/console/dist/eager-closure.json`,
   * in the same container as the `7981384` control build. The commit after
   * `b6f11d3` on the branch (this re-pin, the changeset) reaches no bundler
   * input, so it cannot move the figure it pins.
   *
   * ⚠️ The paragraph below describes the reading this one superseded, the
   * previous baseline `5488ae7` (3,122,463 across 72 of 2255 chunks), kept as
   * its provenance.
   *
   * `5488ae7` is objectui#12030's branch commit: `main` at `cea429b` with
   * `@objectstack/*` 18.0.0-next.0 resolved and the bump's own edits, re-pinned
   * with the ceiling it was lowered with (the objectstack#22044 payback entry on
   * {@link MAX_EAGER_CLOSURE_GZIP_BYTES} carries its table and its `cea429b`
   * control, ⛔ not restated here). It is a branch commit for the reason the
   * paragraphs below give for `c1d378ec`: the pull request's own diff is what
   * moved the figure. Measured by `CI=true pnpm exec turbo run build
   * --filter=@object-ui/console... --concurrency=2` (exit 0), reading
   * `apps/console/dist/eager-closure.json`, under `scripts/pm/os-verify-lock.sh`,
   * in the same container as the `cea429b` control build. Of the commits after
   * `5488ae7` on the branch, a unit-test edit in `packages/types`, this re-pin
   * and a changeset reach no bundler input. Two do, both folded in under the
   * maintainer's ruling 6148150305 after this reading: `179247d` drops the zh
   * `org` overlay-scope label in app-shell's `i18n.ts`, and `5db13ba` removes
   * the retired `defaultFilters` reads from `ObjectGrid` and `ObjectView`. The
   * console build of `5db13ba`, by the same instrument, read 3,122,375 across
   * 72 of 2255 chunks: −88 bytes, the largest moves `plugin-grid` (−40) and
   * `plugin-view` (−16). ⛔ Not re-pinned for it: a shrink that small sits
   * inside the band, and this constant stays the reading the ceiling was
   * derived from.
   *
   * ⚠️ The paragraph below describes the reading this one superseded, the
   * previous baseline `f05f015` (3,235,899 across 289 of 2474 chunks), kept as
   * its provenance.
   *
   * `f05f015` is objectui#11939's branch commit for step 2: `main` at
   * `28557855` merged into the branch that loads the built-in metadata
   * designers from a chunk the package entry imports dynamically, re-pinned
   * with the ceiling under ruling 6070754914 (the objectui#11939 entry on
   * {@link MAX_EAGER_CLOSURE_GZIP_BYTES} carries its table and its `28557855`
   * control, ⛔ not restated here). It is a branch commit for the reason the
   * paragraphs below give for `c1d378ec`: the pull request's own diff is what
   * moved the figure. Measured by the console's own
   * `apps/console/vite.config.ts` run through Vite's `build()` with one
   * read-only module-graph dump appended, reading the `eager-closure.json` the
   * build writes, under `scripts/pm/os-verify-lock.sh`, in the same container
   * and the same lock hold as the `28557855` control build. The console's
   * ordinary build of `f05f015` (`CI=true pnpm exec vite build`, exit 0) wrote
   * the same figure to the byte, which is this instrument's calibration. The
   * commit after `f05f015` on the branch (this re-pin and its unit test)
   * reaches no bundler input, so it cannot move the figure it pins.
   *
   * ⚠️ The paragraph below describes the reading this one superseded, the
   * previous baseline `406f760` (3,375,344 across 334 of 2457 chunks), kept as
   * its provenance.
   *
   * `406f760` is objectui#11854's branch commit that narrows `vendor-markdown`
   * to what the first load reaches: `main` at `9cb4e29` plus that one
   * chunk-group change in `apps/console/vite.config.ts`, re-pinned with the
   * ceiling it was lowered with (the objectui#11854 entry on
   * {@link MAX_EAGER_CLOSURE_GZIP_BYTES} carries its table and its `9cb4e29`
   * control, ⛔ not restated here). It is a branch commit for the reason the
   * paragraphs below give for `c1d378ec`: the pull request's own diff is what
   * moved the figure. Measured by the console's own
   * `apps/console/vite.config.ts` run through Vite's `build()` with one
   * read-only module-graph dump appended, reading the `eager-closure.json` the
   * build writes, under `scripts/pm/os-verify-lock.sh`, in the same container
   * as the `9cb4e29` control build. The console's ordinary build of `57a1066`
   * (`CI=true pnpm exec turbo run build --filter=@object-ui/console...
   * --concurrency=2`, exit 0) wrote the same figure to the byte, which is this
   * instrument's calibration. The commits after `406f760` on the branch (this
   * re-pin, its unit test and the changeset) reach no bundler input, so they
   * cannot move the figure it pins.
   *
   * ⚠️ The paragraph below describes the reading this one superseded, the
   * previous baseline `c1d378ec` (3,418,259 across 333 of 2456 chunks), kept as
   * its provenance.
   *
   * `c1d378ec` is objectui#11798's branch tip: `main` at `455c6466` merged into
   * the branch that takes the Studio builder and the chart engine out of the
   * first load, re-pinned with the ceiling it was lowered with (the
   * objectui#11798 entry on {@link MAX_EAGER_CLOSURE_GZIP_BYTES} carries its
   * table and its `455c6466` control, ⛔ not restated here). It is a branch tip
   * for the reason the paragraphs below give for `2ba091c` and `4acbea07`: the
   * pull request's own diff is what moved the figure. Measured by the console's
   * own `apps/console/vite.config.ts` run through Vite's `build()` with one
   * read-only module-graph dump appended, reading the `eager-closure.json` the
   * build writes, under `scripts/pm/os-verify-lock.sh`, in the same container
   * as the `455c6466` control build. The console's ordinary build of the same
   * tree (`pnpm exec turbo run build --filter=@object-ui/console...`, exit 0)
   * wrote the same figure to the byte, which is this instrument's calibration.
   * The commit that re-pins this file reaches no bundler input, so it cannot
   * move the figure it pins.
   *
   * ⚠️ The paragraph below describes the reading this one superseded, the
   * previous baseline `c1e32e96` (3,591,028 across 331 of 2451 chunks), kept as
   * its provenance.
   *
   * `c1e32e96` is objectui#11717's branch tip: `main` at `9b673e54` merged into
   * the branch that carries `@objectstack/*` 17.7.0 and the bump's own edits,
   * re-pinned under the ruling recorded in the fourth raise on
   * {@link MAX_EAGER_CLOSURE_GZIP_BYTES} (its table and its `9b673e54` control
   * are there, ⛔ not restated here). It is a branch tip for the reason the
   * paragraphs below give for `2ba091c` and `4acbea07`: the pull request's own
   * diff is what moved the figure. Measured by `pnpm exec turbo run build
   * --filter=!@object-ui/site --concurrency=2` (exit 0), reading
   * `apps/console/dist/eager-closure.json` through `pnpm check:eager-closure`,
   * under `scripts/pm/os-verify-lock.sh`, in the same container as the
   * `9b673e54` control build. The commit that re-pins this file reaches no
   * bundler input, so it cannot move the figure it pins.
   *
   * ⚠️ The paragraph below describes the reading this one superseded, `2ba091c`
   * (3,386,193 across 330 of 2450 chunks), kept as its provenance.
   *
   * `2ba091c` is objectui#11438's branch tip: `main` at `2d576e46` with
   * `@objectstack/*` 17.6.0 resolved and the bump's own edits, the second
   * payback recorded on {@link MAX_EAGER_CLOSURE_GZIP_BYTES} (its table and its
   * `2d576e46` control are there, ⛔ not restated here). It is a branch tip for
   * the reason the paragraph below gives for `4acbea07`: the pull request's own
   * diff is what moved the figure. Measured by `CI=true pnpm exec vite build`
   * in `apps/console` (exit 0) after `pnpm turbo run build --filter='./packages/*'`,
   * reading `apps/console/dist/eager-closure.json`, under
   * `scripts/pm/os-verify-lock.sh`, in the same container and the same lock
   * hold as the `2d576e46` control build. The commit that re-pins this file
   * reaches no bundler input, so it cannot move the figure it pins.
   *
   * ⚠️ The paragraphs below describe the reading this one superseded, `4acbea07`
   * (3,638,104 across 330 of 2450 chunks), kept as its provenance.
   *
   * `4acbea07` is the payback commit of objectui#11101's branch: `main` at
   * `5262f7d` plus the one line in `apps/console/vite.config.ts` that keeps an
   * `import()`ed `@objectstack/*` module out of `vendor-objectstack`, under the
   * ruling recorded on {@link MAX_EAGER_CLOSURE_GZIP_BYTES}. It is a branch tip
   * again rather than a `main` commit, as objectui#11073's was, because here
   * the pull request's OWN diff is what moved the figure: its bytes are the
   * subject. The `scripts/vite-*.ts`-versus-`scripts/check-*.mjs` argument holds
   * for the re-pin itself: the commit that edits this file and its unit test
   * reaches no bundler input, so it cannot move the figure it pins.
   *
   * ⚠️ `048e7f6`, the previous baseline, read 3,648,737 across 330 of 2446
   * chunks, on objectui#11073's branch; it landed on `main` as `81f8498`. ⛔ It
   * is NOT the control for this reading: the delta objectui#11101 earned is
   * measured against a build of `5262f7d`, the same tree without the one line,
   * and that table is recorded once, under objectui#11101's entry on
   * {@link MAX_EAGER_CLOSURE_GZIP_BYTES}, ⛔ not restated here.
   *
   * ⚠️ The reading is of `4acbea07`, ⛔ not of whatever `main` plus this branch
   * is when it lands. CI weighs the pull-request MERGE ref, so the two differ by
   * whatever lands on `main` between the reading and the merge.
   *
   * Measured by `CI=true pnpm exec vite build` in `apps/console` (exit 0)
   * reading `apps/console/dist/eager-closure.json`, under
   * `scripts/pm/os-verify-lock.sh`, in the same container and the same lock
   * hold as the `5262f7d` control build. ⛔ Not taken from CI's report and not
   * extrapolated.
   *
   * PROVENANCE: `4acbea07` resolves from a checkout that fetched the branch,
   * and not from `main` once it is squash-merged — the dead end objectui#9355
   * added `squashMerge` below to route around.
   */
  gzipBytes: 3_072_056,
  chunks: 85,
  totalChunks: 2291,
  commit: 'b6f11d3',

  /**
   * The squash merge that carried the reading above onto `main`, recorded when
   * the field above names a branch tip no `main` checkout resolves
   * (objectui#9355): a sha that DOES resolve, so a reader re-checking the
   * measurement gets a handle rather than a dead end.
   *
   * `null` since objectui#10996, and `null` again after objectui#11101,
   * objectui#11438, objectui#11717, objectui#11798, objectui#11854,
   * objectui#11939, objectui#12030 and objectui#13410, deliberately. This field can only ever be BACK-FILLED: a squash sha does
   * not exist until the pull request merges, so the change that re-pins the
   * field above ⛔ cannot write its own here. ⛔ Do not guess one: a wrong sha in
   * this position is worse than an absent one, because it RESOLVES, and a
   * reader who builds the wrong tree gets a plausible number instead of an
   * error. A follow-up should name the merge once it exists, because the field
   * above is a branch tip again and this is its only handle from `main`.
   * objectui#11073's reading was owed exactly that, and objectui#11101 paid it
   * in the prose that still cites that reading, on
   * {@link MAX_EAGER_CLOSURE_GZIP_BYTES}, since its own re-pin moved the field
   * above off it.
   *
   * The ledger case in `scripts/__tests__/check-eager-closure-budget.test.ts`
   * that records what this constant carries as data reds on a back-fill, as it
   * was written to, and is re-pinned to two strings when that happens.
   */
  squashMerge: null,
});

/**
 * 695 KiB gzipped since objectui#12653 (2026-10-16); 89 KiB before it — the
 * per-page-load cost objectui#5266 added, landing in `vendor-objectstack-*.js`
 * where the entry-chunk budget could not see it. The headroom above
 * {@link BASELINE} must stay under this, or the gate is green through a repeat
 * of the incident that motivated it.
 *
 * ⚠️ Raised with every ceiling by the maintainer's 20% ruling (the objectui#12653
 * entry on {@link MAX_EAGER_CLOSURE_GZIP_BYTES} carries the words, the table and
 * the arithmetic). ⇒ The gate now catches only regressions of about 695 KiB
 * and above on the aggregate; a repeat of objectui#5266's 89 KiB passes it.
 * That is the trade the ruling accepts, ⛔ not an oversight to be quietly undone.
 */
export const REGRESSION_THIS_GATE_MUST_CATCH_BYTES = 695 * 1024;

/**
 * Per-chunk ceilings, in gzipped bytes, keyed by the chunk NAME the report
 * carries (objectui#5490, the ruled follow-up of objectui#5468: option A now,
 * option C next, option B — a comparison against `main` — rejected).
 *
 * ## Why the aggregate ceiling is not enough
 *
 * The aggregate is one number over every chunk in the closure. Inside its
 * headroom, a single chunk can grow by the whole allowance while every other
 * chunk shrinks by the
 * same amount, and the gate reports a green tick either way. That is not a
 * hypothetical shape: objectui#5266 put 89 KiB on every page load and ALL of it
 * landed in `vendor-objectstack`, the chunk that is 29% of the closure today.
 * The aggregate says whether the payload grew; these say WHERE.
 *
 * ## Why the keys are names from the report and not names written here
 *
 * The names are decided by `advancedChunks.groups` in
 * `apps/console/vite.config.ts`, emitted by rolldown, and published in
 * `files[].name`. This file looks them up; it does not re-derive them by
 * stripping `-<hash>.js` off a file name, and it does not carry a list of
 * chunks it EXPECTS to exist independent of the measurement.
 *
 * The distinction is the whole design, because the failure mode is silent. A
 * budget keyed on a chunk name that no longer exists is VACUOUSLY GREEN: it
 * passes because there is nothing to weigh. So a budgeted name that is absent
 * from the report is an ERROR here (exit 2, "the gauge cannot be trusted"),
 * never a skip — the same asymmetry {@link validateReport} exists for. If a
 * group is renamed or removed in `vite.config.ts`, this gate stops the build
 * and says so, and the mapping is re-pinned deliberately.
 *
 * ## Why `framework` moved (objectui#6759)
 *
 * From 502,000 over a 492,399 reading on `2c8474c04` to 512,000 over 502,405
 * on `a64e96ca8`. What the added bytes buy is user-facing diagnostic text, in
 * ten locales, for two ordinary author mistakes that used to be unreported:
 *
 *   - a malformed or absent gantt date crashed the render outright
 *     (`RangeError: Invalid time value`), and
 *   - an inverted author-pinned range drew a bar at `width: -4.3%` under a
 *     header row with zero cells, and said nothing at all.
 *
 * A hard crash and a confidently-wrong render, both reachable from a typo in
 * authored metadata, replaced by a refusal that names the offending value.
 *
 * The CODE that fix added buys none of this chunk, which is why there was
 * nothing to trim instead: `plugin-timeline` is lazy and is not in the eager
 * closure at all, so the guard, the value speller and both refusal branches
 * cost this budget zero. Every byte of the growth is `packages/i18n` locale
 * data, which lands here. Measured on the built chunk by deleting the twenty
 * strings and re-gzipping: the ten locales' message text is 1,999 of the
 * ~2,283 bytes the chunk grew by, and PER MESSAGE it costs 1,000 bytes
 * against the 1,002 that objectui#6655's single refusal — the neighbour whose
 * shape this one copied — already costs in the same chunk. The only lever
 * left was to say less, in ten languages, about what the author got wrong.
 *
 * ⚠️ Most of the headroom this consumed was not spent by that card. The
 * previous ceiling carried 9,601 bytes and `main` had already drifted to
 * 488.4 KB of the 490.2 KB it allowed — 1.8 KB left, 0.02x the regression
 * this gate must catch — before objectui#6759 added a byte (`b98352a15`,
 * this PR's base, the gate's own printed line). Re-pinning the baseline onto
 * a fresh measurement is what puts the gauge back in range. The drift itself,
 * and that nobody could say which side moved it, is objectui#6631; this card
 * does not close it and deliberately leaves the other two entries alone.
 *
 * ## Why `framework` moved again — objectui#7173, +4,671 bytes
 *
 * `AiPendingActionsInbox` (the AI HITL approval inbox) was the fifth untranslated
 * copy of the relative-time helper in this repo AND had no translation wiring at
 * all, so it was swept whole: every string it shows now resolves from the locale
 * packs. Thirty-eight new keys, translated in all ten languages — an `aiApprovals`
 * namespace in `packages/i18n`. That is what the bytes buy: the AI approvals inbox
 * reads in the session's language instead of English, headings, tabs, status
 * badges, empty state, drawer labels, reject dialog and all.
 *
 * The COMPONENT costs this budget nothing: `plugin-chatbot` is lazy and is not in
 * the eager closure. Every byte is `packages/i18n` locale data, which lands in
 * this chunk — the same mechanism as objectui#6759's twenty strings above.
 *
 * ATTRIBUTED, not assumed. Three console builds, the two extremes byte-identical
 * in the two chunks that did not move:
 *
 *   | build                                              | `framework` gzip |
 *   | merge parent `c93b4d5f3`                           |          510,192 |
 *   | this branch with the ten `aiApprovals` blocks cut  |          510,192 |
 *   | this branch                                        |          514,863 |
 *
 * The ablated build reproduces the merge parent's figure exactly, so the whole
 * 4,671-byte delta is the pack blocks and nothing else — not the new
 * `useAiApprovalsTranslation.ts` module, not the converted component.
 * `vendor-objectstack` is 947,931 on both; `ui-components` moves one byte.
 *
 * Most of the overage was drift, again: the merge parent already stood at 510,192
 * of the 512,000 the previous ceiling allowed — 1,808 bytes left, 0.02x the
 * regression this gate must catch — so a 4.6 KB addition put it 2,863 bytes over.
 * The new pair re-pins the gauge onto a fresh measurement and KEEPS the line's own
 * headroom convention rather than widening it: 9,137 bytes (0.10x), against the
 * 9,595 (0.11x) the retired pair carried. objectui#6631 still owns the drift.
 *
 * ## Why `framework` moved DOWN, and where its bytes went — objectui#7399
 *
 * From 524,000 over 514,863 to 71,000 over 61,465, and a fourth line appears:
 * `i18n-locales`, 455,000 over 446,076. Neither number is a payload change. The
 * console downloads the same eager closure before and after; it is written to
 * two more files.
 *
 * What this ceiling was actually weighing, measured on `e307c9896` from the
 * emitted chunk's own module list — the `framework` chunk held 166 modules and
 * only 145 of them came from `core|react|types`, its own test:
 *
 *   | packages/i18n             |  16 mod | 78.7% of the chunk's bytes |
 *   | packages/core             |  67 mod |  9.6% |
 *   | packages/react            |  63 mod |  4.7% |
 *   | packages/data-objectstack |   5 mod |  4.6% |
 *   | packages/types            |  15 mod |  2.3% |
 *
 * Five workspace groups in `apps/console/vite.config.ts` sat at `priority: 80`
 * with `framework` written first, and on that tie the subgraph reached through
 * `@object-ui/react` was absorbed by the group listed first — a group whose
 * regex matches NEITHER intruder. So this line was, in operation, a budget on
 * the TEN LOCALE CATALOGUES: 523,959 measured against 524,000, forty-one bytes
 * of headroom for the whole repository, while `data-adapter` — declared since
 * objectui#5490 — emitted no chunk at all.
 *
 * ⛔ The expensive half is not the arithmetic. A gate whose message says "you
 * grew `core|react|types`" when the cause is a translation key teaches a FALSE
 * RULE, and it was followed: two changes were publicly blamed for bytes they do
 * not ship (objectui#7399's own retraction). Naming the chunk for what it holds
 * is what makes the constraint legible where it is authored.
 *
 * Lifting the two swallowed groups one tier above the tie (priority 84) gives
 * each ceiling a subject its name states. Measured across the change:
 *
 *   | chunk           | before  | after   |
 *   | `framework`     | 523,959 |  61,465 |  166 modules -> 140, all core/react/types
 *   | `i18n-locales`  |       — | 446,076 |  22 modules, 100% packages/i18n
 *   | `data-adapter`  |       — |  17,846 |  10 modules, 91.8% data-objectstack
 *   | aggregate       |3,255,233|3,256,012|  +779 B, +0.024%
 *
 * The +779 is the cost of two more chunk boundaries — `import` statements in
 * the chunks that now name two files where they named one — and it is stated
 * here because it is the ONE thing this change spends. ⛔ It is not headroom to
 * borrow against, and {@link MAX_EAGER_CLOSURE_GZIP_BYTES} was deliberately NOT
 * touched: the maintainer ruling of 2026-09-03 authorised a re-attribution and
 * the per-chunk re-baseline it forces, and nothing else. Its own words:
 *
 *     ⛔ The aggregate ceiling is not touched. A′ is a pure re-attribution —
 *     the browser downloads exactly the same bytes.
 *
 * ⚠️ Both new pairs are why the re-baseline is not optional. Left at 524,000
 * over a 61,465 payload, `framework` sits 5.08x above its own measurement and
 * {@link evaluateHeadroomSensitivity} returns exit 2 — the blind-gauge verdict,
 * correctly. The new pairs keep this line's own headroom convention rather than
 * widening it: 9,535 bytes (0.10x) for `framework`, 8,924 (0.10x) for
 * `i18n-locales`, against the 9,137 (0.10x) the retired `framework` pair
 * carried.
 *
 * `data-adapter` gets no ceiling. 17,846 bytes is smaller than a dozen
 * unbudgeted eager chunks, and this constant is a line per BIG chunk, not a
 * line per named group; inventing one for it would be a number with no
 * incident behind it.
 *
 * ⭐ RETIRED by objectui#8816's raise — see "Why `i18n-locales` moved UP" below.
 * The pair this paragraph sized (455,000 over 446,076, 8,924 bytes of headroom)
 * is gone, and so is the unit it offered: "about sixty translation keys at ~147
 * gzipped bytes a short key" is an average across a spread now measured at 2.4x,
 * two real claimants costing 9.2 and 22.3 bytes per key-times-locale. ⛔ Its
 * forecast was wrong in the direction that matters too — the headroom was gone
 * in seven days and the AGGREGATE never became the binding line; it is still
 * carrying 0.26x with both claimants on it. What survives is the last sentence,
 * which is why it is kept verbatim: that the aggregate is the correct place for
 * the constraint to live is the argument for taking the catalogues out of the
 * eager closure rather than for raising anything.
 *
 * ## Why `framework` moved UP — the maintainer ruling of 2026-09-08
 *
 * From 71,000 over a 61,465 payload to 100,000 over 72,245, the latter measured
 * on `3f775eeb8`. ⛔ The number is the MAINTAINER'S, taken after the trade-off
 * was put to them; it is not derived here, and nothing in this section should be
 * read as a derivation of it. What is recorded here is what the raise COSTS,
 * because that is the half a later reader cannot recover from the constant.
 *
 * ⛔ What the bytes buy — MEASURED, but AFTER this constant moved. When the raise
 * landed nobody could answer the question its own failure message asks — "say in
 * the PR what the bytes buy" — because the window had not been bisected, and this
 * section recorded that as the finding. objectui#8542 has since run it: one
 * `apps/console` build per point, each from the repo ROOT, `framework` read out
 * of the `apps/console/dist/eager-closure.json` the build itself writes.
 *
 *   | build       | landed by | `framework` gzip | moved by                 |
 *   | `40a7c538a` | #8503     | 70,999           | last GREEN, 1 byte under |
 *   | `512c84b16` | #8519     | 70,999           |                        0 |
 *   | `f76f43628` | #8512     | 71,261           |                     +262 |
 *   | `e76634cc8` | #8529     | 72,245           |                     +984 |
 *   | `e411c3e58` | #8562     | 72,248           |                       +3 |
 *
 * ⚠️ TWO commits own the overage and the LARGER one is OUTSIDE the window this
 * section bounded. `e76634cc8` landed after the red had already started and
 * carries 984 of the 1,246 bytes the pair added — 79% — against 262 for the
 * commit the red first appeared on. ⛔ A repair scoped to the window would have
 * left `main` red. `512c84b16` emitted a byte-identical chunk to `40a7c538a`
 * (the same `framework-nDOJv2Ij.js` content hash), so the three commits between
 * them moved this chunk by ZERO — and objectui#8541's named suspect
 * `270f2825b` is measurably innocent: it touches no file under
 * `packages/(core|react|types)` at all.
 *
 * ⇒ So the bytes are identifiable, and they are two silent-wrong-answer fixes on
 * ONE file's filter path, `packages/core`'s `ValueDataSource`. `f76f43628`
 * (#8512): an unrecognised `$` operator ended the switch on `default: break`,
 * adding no constraint, so it matched EVERY row. `e76634cc8` (#8529): an array
 * comparand and a `{ $field }` reference were compared by REFERENCE, selecting
 * every row under `$ne` and no rows under `$eq`, neither of them saying so. The
 * bytes ARE the refusals and the prescriptions that replaced that silence.
 *
 * ⛔ None of which retires the cost above: the line that was holding these bytes
 * in view now passes over them, and the attribution arrived after the constant
 * moved rather than before it. ⚠️ Nor is trimming the alternative it looks like
 * — deleting every refusal message string these two commits ship was measured at
 * 610 gzip bytes against the 1,245 the overage needed (recorded on
 * objectui#8542, ⛔ not re-measured here), so the whole diagnostic surface is
 * worth under half the payload it gets blamed for. ⭐ Why `main` was one byte from
 * this line in the first place is objectui#8554: it sat at 70,999 against 71,000
 * — headroom 0.00x — and printed a GREEN sensitivity row while it did, because
 * {@link evaluateHeadroomSensitivity} had no floor at the time. ⚠️ It briefly
 * had one and has no floor again: objectui#8554 added a lower bound and a
 * maintainer ruling on objectui#10148 retired it, so a row in that state draws
 * a green tick once more — see the RETIRED block below. ⛔ That is a statement
 * about THIS half only; the row's ceiling is unchanged and a build over it
 * still exits 1. objectui#8541 recorded the same red first and is closed as
 * this card's duplicate.
 *
 * ⚠️ This also makes `framework` the LOOSEST ceiling in this object, measured
 * rather than asserted. All four were read from the one `3f775eeb8` console
 * build, against {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}:
 *
 *   | ceiling              | headroom | multiple |
 *   | `framework`          |   27,755 |    0.30x |
 *   | `vendor-objectstack` |   18,848 |    0.21x |
 *   | `ui-components`      |    5,729 |    0.06x |
 *   | `i18n-locales`       |    2,900 |    0.03x |
 *
 * ⇒ it carries more slack than the next loosest and an order of magnitude more
 * than the tightest, and it abandons the 0.10x convention objectui#7399 re-pinned
 * this key and `i18n-locales` to. It is still inside one regression — 1.00x is
 * where {@link evaluateHeadroomSensitivity} calls a line blind — but "not blind"
 * is the floor this file refuses to fall through, not a standard it aims at.
 *
 * ⚠️ That table and that ranking are `3f775eeb8`'s and stay pinned to it — the
 * `i18n-locales` row in it was retired by objectui#8816's raise below. Re-read
 * on `ba20b0bc0`, `framework` is still the loosest of the four at 0.29x, but
 * against a tightest of 0.05x (`ui-components`) that is 6.1x, not an order of
 * magnitude.
 *
 * ⛔ {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES} did NOT move, and this is the
 * exact case the rule under {@link MAX_EAGER_CLOSURE_GZIP_BYTES} was written for:
 * a ceiling that rises while the sensitivity relaxes is a gate quietly retiring
 * itself. Nothing else moved either — not the other three ceilings, not the
 * aggregate, not {@link BASELINE}. One ceiling and its baseline, in one commit.
 *
 * ## Why `i18n-locales` moved UP — objectui#8816
 *
 * From 455,000 over a 446,076 payload to 465,000 over 456,196. The new baseline
 * is a reading of the tree this pair was DERIVED FOR: `main` with both claimants
 * merged into it.
 *
 * ⛔ Read what this is not, first, because the shape it resembles is the one the
 * paragraph under "Raising one" forbids. It is not "the gate fired, so the
 * number moved". objectui#8816 is a decision card opened 2026-09-09 that asks
 * exactly this question and carries three routes, and it stood unclaimed while
 * two finished pull requests queued behind it. WHICH route is the measurement
 * below, and it was taken on measurement. THAT one of the three could be taken
 * at all is a MAINTAINER RULING — director seat summon #21, decision batch #110
 * item 3, recorded on objectui#8816 at comment 5615808548 on 2026-09-10, on the
 * maintainer's reply to the recommendation of route A at comment 5615318265.
 * That reply, verbatim:
 *
 *     其他同意
 *
 * ⛔ The same ruling refuses to be read as a precedent, and the clause is
 * quoted rather than paraphrased because it governs the NEXT reader of this
 * constant rather than this one:
 *
 *     这是一次维护者裁决下的 ratchet 移动,⛔ 不是先例:下一次撞墙仍回决策箱。
 *
 * ⇒ the next change that meets this line goes back to the decision box, and
 * ⛔ this raise is not authorisation for the one after it.
 *
 * ⚠️ THE CONSTANT AND ITS RULING ARRIVED IN THAT ORDER — the wrong one — and
 * the sequence is recorded here rather than smoothed over, because a reader who
 * finds the ruling above and the number below will otherwise reconstruct a
 * history that did not happen. The pair landed in `fffa30d3f` at 06:05:37Z on
 * 2026-09-10 as a RIDER inside objectui#8901 (`fix(data-objectstack): a refused
 * view read is not an object with no saved views`), about two hours and forty
 * minutes BEFORE the ruling was recorded, and ⛔ not in the dedicated pull
 * request the ruling's execution clause asks for. What stood in for the ruling
 * at that moment was the maintainer's instruction of 2026-09-10 that red pull
 * requests are RESOLVED rather than parked — a PRIORITY instruction, read on
 * the day as authorising the route as well as the urgency. Whether it did was
 * named as an open fork while the fork was still open, and the maintainer then
 * settled it as A. ⇒ the number is the ruled number, so ⛔ moving a ruled
 * constant back in order to re-land it in the ruled shape is refused: that
 * lands `main` red on this line for form. What was wrong is the record, and a
 * record is repaired by writing it — objectui#8816, these paragraphs.
 *
 * ⛔ WHAT THE BYTES BUY — one console build per row, each from the repo ROOT,
 * `i18n-locales` read out of the `apps/console/dist/eager-closure.json` the
 * build itself writes. Four builds, one container, one instrument, so the
 * deltas are directly comparable:
 *
 *   | tree                                   | `i18n-locales` | moved by |
 *   | `bbe285ee7` — `main`                   |        454,602 |        — |
 *   | + objectui#8901, its merge `3949cf3a3` |        455,271 |     +669 |
 *   | + objectui#8888, its merge `ea5eab7b3` |        455,519 |     +917 |
 *   | both, their merge `ba20b0bc0`          |        456,196 |   +1,594 |
 *
 * The two deltas sum to 1,586 against a measured 1,594, so gzip's dictionary
 * hands back nothing across them: two independent claimants on this chunk are
 * ADDITIVE to within 8 bytes. That is the fact a SHARED budget needs and the one
 * a per-pull-request reading cannot produce — each is 271 and 519 bytes over
 * alone, together they are 1,196 over, and neither single reading licenses that
 * sum without the third build.
 *
 * The bytes are THIRTEEN localization keys in ten locales and nothing else.
 * objectui#8901 adds three `console.savedViews*` strings so that a REFUSED
 * saved-view read stops rendering as "this object has no saved views";
 * objectui#8888 adds ten `chatbot.build.*` strings so the AI build-progress
 * panel stops showing English literals inside a Chinese conversation. Neither
 * ships a dependency or a component into this closure: `plugin-chatbot` is lazy
 * and outside it, and objectui#8901's adapter growth landed in
 * `vendor-objectstack`, which measured 1,236,299 on ALL FOUR builds — the lit
 * control saying the movement is this chunk's and no other's.
 *
 * ⛔ WHY NOT TRIM INSTEAD, which is the half a raise has to answer. Measured,
 * per claimant:
 *
 *   - objectui#8888's ten keys include five generic console nouns (`Objects`,
 *     `Views`, `Dashboards`, `App`, `Sample data`), so reuse looks available.
 *     It is not: only `Objects` and `Dashboards` have any pre-existing
 *     equivalent in the `en` pack, and each of those already exists THREE times
 *     under three per-surface namespaces (`appDesigner.*`,
 *     `console.commandPalette.*`, `search.type*`). Per-surface keys are this
 *     pack's convention and cross-surface reuse is the deviation. Best measured
 *     saving 128 bytes against a 519-byte overage.
 *   - objectui#8901's three keys have NO reuse candidate, and that is
 *     structural rather than incidental: those strings exist precisely because
 *     saying what the neighbouring `console.importMappings*` strings say is the
 *     runtime lie the card was filed to remove.
 *   - Shortening the copy is the objectui#6759 lever ("say less, in ten
 *     languages") and it is ⛔ refused here. Widening a ceiling to get a green
 *     tick and narrowing a payload to get one are the same error facing in
 *     opposite directions; this file already forbids the first.
 *
 * ⇒ Trimming cannot reach 1,196 bytes inside these two changes. What CAN reach
 * it is outside them, and it is recorded here because it is the work that makes
 * the next raise unnecessary: `pnpm check:i18n-dead-keys` reports 364 candidates
 * across 47 namespaces, 127 of them CONFIRMED with no textual footprint anywhere
 * in this repository, in ten locales each. That gate is report-only by design
 * and `@object-ui/i18n` PUBLISHES these packs, so deleting a key is a
 * published-surface removal and a decision, not a byte-saving. It needs its own
 * card and its own reverse verification — objectui#8816's route C note says so
 * in as many words — and it is ⛔ deliberately not ridden in on a localization
 * change.
 *
 * ## Why the new headroom is 0.10x and NOT the 804 bytes the overage needed
 *
 * The minimal raise — 457,000, exactly enough to admit both claimants — is the
 * one option this card's own evidence rules OUT. objectui#8816 is not filed
 * about a full budget. It is filed about what a budget with ~0 headroom DOES:
 * the gate weighs the MERGE REF, so a sibling change that adds locale keys and
 * lands first turns an in-flight, not-itself-over pull request red in the merge
 * queue — an arithmetic collision that reads as a defect in that diff, and sends
 * its author to investigate something that is not there. objectui#8554 is the
 * same mechanism one step earlier: `framework` sat at 70,999 against 71,000 and
 * printed a GREEN sensitivity row while it did, because
 * {@link evaluateHeadroomSensitivity} had no floor at the time. Re-pinning to
 * 804 bytes would reproduce both inside a week. ⚠️ objectui#8554 briefly made
 * the tenth this paragraph reaches for into a PREDICATE; objectui#10148's
 * maintainer ruling retired that predicate, so the tenth is prose again — a
 * re-pin that ignores it disagrees with this comment and with every re-pin
 * recorded above it, and ⛔ nothing reds. See the RETIRED block below for what
 * putting the predicate back would take.
 *
 * So the size comes from this key's own convention rather than from the overage:
 * 8,804 bytes = 0.10x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES}, against the
 * 8,924 (0.10x) the retired pair carried — slightly TIGHTER as a ratio, and on
 * `ba20b0bc0` the second-tightest of the four ceilings (`ui-components` 0.05x,
 * `i18n-locales` 0.10x, `vendor-objectstack` 0.19x, `framework` 0.29x).
 *
 * ⚠️ What it buys, stated as the interval it is rather than as a key count. Per
 * key-times-locale this chunk cost 9.2 bytes for objectui#8888's ten short
 * progress phrases and 22.3 bytes for objectui#8901's three long sentences — a
 * 2.4x spread between two real claimants one shift apart, so ⛔ a quota written
 * in keys is not derivable from this measurement. 8,804 bytes is between ~395
 * and ~958 key-times-locale slots: roughly 40 to 96 keys across ten locales.
 *
 * ⚠️ And how long that is, measured rather than hoped. The retired pair landed
 * on `177afeba1`, 2026-09-03, at 446,076; `main` measured 454,602 on
 * `bbe285ee7`, 2026-09-10. That is 8,526 bytes in seven days, with the last 398
 * of them claimed by two independent changes inside ONE shift. At that arrival
 * rate this raise is about a week of runway, not a settlement — so ⛔ do not read
 * it as one, and do not read a second raise as routine because this one was
 * taken. The structural answer is the one this file already names: the aggregate
 * is the correct place for this constraint to live, and taking the catalogues
 * OUT of the eager closure is what retires this line instead of moving it.
 *
 * ⛔ Nothing else moved. Not {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES} —
 * this is the exact case the rule under {@link MAX_EAGER_CLOSURE_GZIP_BYTES} was
 * written for, and a ceiling that rises while the sensitivity relaxes is a gate
 * quietly retiring itself. Not the other three per-chunk ceilings, weighed on
 * the same four builds and unchanged. Not {@link MAX_EAGER_CLOSURE_GZIP_BYTES}:
 * the aggregate carried 23,507 bytes of headroom (0.26x) with BOTH claimants on
 * it, so it never objected and there is nothing to re-pin. One ceiling and its
 * baseline, in one commit.
 *
 * ## Why `i18n-locales` became `i18n-locale-en` — objectui#7479
 *
 * ⭐ The structural answer the section above named as the only thing that
 * retires that line — "taking the catalogues OUT of the eager closure is what
 * retires this line instead of moving it" — has landed. `@object-ui/i18n` no
 * longer re-exports ten catalogues from its entry; `en` stays statically
 * resident as `fallbackLng` and as the app-shell splash's synchronous
 * dictionary, and the other nine are `import()`ed per locale.
 * `apps/console/vite.config.ts` gives each catalogue its own `advancedChunks`
 * group, because ten catalogues in ONE group are one chunk and one eager member
 * would make all ten eager again.
 *
 * Two full console builds in one container, same instrument, the second
 * differing from the first only by that change:
 *
 *   | reading                         |   control |     after |     delta |
 *   |---------------------------------|----------:|----------:|----------:|
 *   | aggregate eager closure         | 3,575,370 | 3,164,817 |  -410,553 |
 *   | eager chunks / total            |    50/518 |    51/528 |           |
 *   | `i18n-locales` (retired key)    |   456,196 |         - |           |
 *   | `i18n-locale-en` (this key)     |         - |    40,415 |           |
 *   | `i18n-runtime` (provider/hooks) |         - |     5,329 |           |
 *   | `vendor-objectstack`            | 1,236,315 | 1,236,315 |         0 |
 *   | `ui-components`                 |   394,726 |   394,718 |        -8 |
 *   | `framework`                     |    80,414 |    80,430 |       +16 |
 *
 * The last three rows are the control that makes the first one readable: the
 * bytes did not MOVE to a roomier chunk — objectui#7399 named that route and
 * refused it — they left the eager closure. The nine deferred catalogues weigh
 * 405.5 KB gzipped, and the browser fetches exactly one of them, only when the
 * viewer's locale is not `en`.
 *
 * ⛔ Two things this is NOT. It is not a raise: every constant this card moved
 * moved DOWN or was replaced by a tighter one, and no build that passed before
 * it and measures under the new figures fails after it. And it is not a
 * re-chunking — `scripts/check-eager-locale-catalogues.mjs` is the half that
 * makes that checkable, weighing WHICH catalogues a page load pulls rather than
 * what they cost, because a byte ceiling cannot tell "left the closure" from
 * "moved to a chunk with more room".
 *
 * {@link MAX_EAGER_CLOSURE_GZIP_BYTES} moved in the same commit and had to:
 * with the aggregate ceiling left at 3,597,000 over a 3,164,817 payload the
 * headroom would have been 432,183 bytes — 4.74x the regression this gate must
 * catch — and {@link evaluateHeadroomSensitivity} calls anything above 1.00x an
 * ERROR about the gauge. That is the blind band this file opens on every large
 * shrink, and closing it in the same change is what "drift in the SHRINKING
 * direction is no longer free" asks for.
 *
 * ## Raising one
 *
 * Same discipline as {@link MAX_EAGER_CLOSURE_GZIP_BYTES}, and the same two
 * constraints, both CHECKED in `scripts/__tests__/check-eager-closure-budget.test.ts`:
 * every ceiling passes on the measurement in {@link PER_CHUNK_BASELINE}, and its
 * headroom stays under {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES} so a repeat
 * of the incident that motivated the gate cannot fit inside it. ⛔ Do not LOWER
 * one below the measured figure to express an aspiration: this is a ratchet, and
 * a ceiling under today's reality is a gate that lands red on `main`, which is
 * how a budget gets switched off rather than met. Shrinking the payload is real
 * work with its own cards (objectui#5324 names the candidates); when it lands,
 * re-measure and lower both numbers together.
 */
export const PER_CHUNK_GZIP_CEILINGS = Object.freeze({
  // Raised with the aggregate above, under the same ruling (objectui#11088
  // decision 1 = A; objectui#11073): `@objectstack/*` 17.5.0 lands in THIS
  // chunk, +465,778 gzipped bytes on the two builds tabled on
  // MAX_EAGER_CLOSURE_GZIP_BYTES, and the retired 1,254,000 fired on it.
  //
  // ⭐ LOWERED by objectui#11101, the first payback of that raise, from
  // 1,723,000 by exactly the 33,735 bytes this chunk lost when the group
  // stopped claiming `import()`ed modules (the table under objectui#11101's
  // entry on MAX_EAGER_CLOSURE_GZIP_BYTES). Headroom 18,301 bytes = 0.20x
  // REGRESSION_THIS_GATE_MUST_CATCH_BYTES over the baseline below — what this
  // key had on `main` at `5262f7d` before the payback, kept to the byte — and
  // it comes down again with the aggregate when objectstack#20646 pays back the
  // rest.
  //
  // ⭐ LOWERED again by that second payback, carried by objectui#11438's
  // `@objectstack/*` 17.6.0 bump, from 1,689,265 by exactly the 250,108 bytes
  // this chunk lost (the table under objectui#11438's entry on
  // MAX_EAGER_CLOSURE_GZIP_BYTES). Headroom 18,199 bytes = 0.20x
  // REGRESSION_THIS_GATE_MUST_CATCH_BYTES over the baseline below.
  //
  // ⚠️ RAISED by objectui#11717 under ruling 6027998226 (the fourth raise on
  // MAX_EAGER_CLOSURE_GZIP_BYTES): `@objectstack/*` 17.7.0 lands in THIS
  // chunk, +182,909 gzipped bytes on the two builds tabled there, and the
  // retired 1,439,157 fired on it. Headroom 18,526 bytes = 0.20x
  // REGRESSION_THIS_GATE_MUST_CATCH_BYTES over the baseline below — the band
  // the two paybacks kept — rounded to the nearest thousand. It comes down with
  // the aggregate when objectstack#22044 pays back what it recovers.
  //
  // ⭐ LOWERED by that payback, carried by objectui#12030's `@objectstack/*`
  // 18.0.0-next.0 bump (objectui#11762), from 1,623,000 by exactly the 86,591
  // bytes this chunk lost (the table under the objectstack#22044 payback entry
  // on MAX_EAGER_CLOSURE_GZIP_BYTES). Headroom 23,719 bytes = 0.26x
  // REGRESSION_THIS_GATE_MUST_CATCH_BYTES over the baseline below — what this
  // key had on `main` at `cea429b` before the payback, kept to the byte.
  //
  // ⚠️ RAISED by objectui#12626 (2026-10-16), the `@objectstack/*`
  // 18.0.0-next.2 bump, under the claim seat's ruling A on that card's PR
  // (objectui#12648), from 1,536,409 by exactly the measured +19,296 bytes.
  //
  // WHAT THE BYTES ARE — one container, one instrument: `CI=true pnpm --filter
  // @object-ui/console exec vite build` in each tree, reading
  // `apps/console/dist/eager-closure.json`. The control is `8a8bcf3d`, `main`
  // and the branch's merge-base, with `@objectstack/*` 18.0.0-next.1 and zod
  // 4.6.5 resolved, in a worktree of its own. The branch is `2043710f`
  // (next.2; the lockfile's dedupe moves zod to 4.6.7). A third build is the
  // branch tree with every `zod@4.6.7` link pointed at 4.6.5 for the build,
  // then restored, which splits zod's share out. Gzipped bytes:
  //
  //   | chunk                 | `8a8bcf3d` | branch, zod 4.6.5 | `2043710f` |  delta |
  //   |-----------------------|-----------:|------------------:|-----------:|-------:|
  //   | `vendor-objectstack`  |  1,536,365 |         1,555,533 |  1,555,661 | +19,296 |
  //   | `ui-components`       |    288,804 |           288,762 |    288,761 |    -43 |
  //   | `framework`           |     76,333 |            76,336 |     76,337 |     +4 |
  //   | `i18n-locale-en`      |     46,678 |            46,678 |     46,678 |      0 |
  //   | ⇒ aggregate           |  3,170,311 |         3,189,413 |  3,189,564 | +19,253 |
  //
  // +19,168 are `@objectstack/*` 18.0.0-next.2 and +128 are the zod
  // 4.6.5 -> 4.6.7 patch. zod already lived in this chunk on `main` (its version
  // marker is in both builds' `vendor-objectstack`) and grew in place: no
  // chunk lost bytes to it and no package joined the group. All 70 eager
  // chunks are the same names in both builds.
  //
  // WHAT THEY BUY: the console's client-side validation answering as the
  // 18.0.0-next.2 server does — its page region-placement and `isDefault`
  // placement checks, the `AdminScope` tombstones and its schemas — and the
  // spec's bounded task-flow derivation the record dialog now takes directly
  // (objectui#12592). ⛔ It is NOT a new console capability.
  //
  // Headroom stays at the 44 bytes `main` had over its own reading
  // (1,536,409 - 1,536,365), and this ceiling minus the baseline below stays at
  // 23,719, both moved by the same amount. ⛔ Not moved: the aggregate
  // MAX_EAGER_CLOSURE_GZIP_BYTES (it passed on the branch, 3114.8 / 3119.4 KB),
  // BASELINE and REGRESSION_THIS_GATE_MUST_CATCH_BYTES. No exemption was added
  // and no import was made lazy.
  //
  // ⚠️ RAISED ×1.20 by objectui#12653 (2026-10-16), the maintainer's 20%
  // ruling, from 1,555,705 (the entry on MAX_EAGER_CLOSURE_GZIP_BYTES).
  'vendor-objectstack': 1_867_000,
  // ⭐ LOWERED, and RE-KEYED, by objectui#7479 — this line used to read
  // `'i18n-locales': 465_000` and budget TEN catalogues. Nine of them are
  // `import()`ed on demand now, so the chunk that name pointed at no longer
  // exists and the eager catalogue is `en` alone: 456,196 -> 40,415 gzipped
  // bytes, measured on the two console builds recorded under "Why
  // `i18n-locales` became `i18n-locale-en`" above. ⛔ This is a TIGHTENING and
  // must not be read as the raise the retired key kept needing: no build that
  // passed before this edit and measures under 50,000 fails after it, and the
  // ~9.5 KB of runway left here is `en`'s alone rather than ten packs' shared.
  // Headroom 9,585 bytes = 0.11x REGRESSION_THIS_GATE_MUST_CATCH_BYTES over the
  // baseline below — just above the 0.10x this file's own convention asks of a
  // deliberate re-pin, and the first time this key has cleared it on the
  // measurement alone. ⚠️ That tenth is a CONVENTION for sizing a re-pin, ⛔ not
  // a line this gate enforces: objectui#10148 retired the leg that did. ⛔ This
  // row is also the one the ruling names, and its ceiling is NOT touched by it.
  //
  // ⚠️ RAISED ×1.20 by objectui#12653 (2026-10-16), the maintainer's 20%
  // ruling, from 50,000 (the entry on MAX_EAGER_CLOSURE_GZIP_BYTES).
  'i18n-locale-en': 60_000,
  // Raised by the maintainer ruling of 2026-09-08, ⛔ not by a measurement here:
  // `main` had been red on this line since `f76f43628`. The bytes that put it
  // there were UNATTRIBUTED when this moved and have since been measured to
  // `f76f43628` (+262) and `e76634cc8` (+984) — see the table under "Why
  // `framework` moved UP" above. Headroom 27,755 bytes = 0.30x
  // REGRESSION_THIS_GATE_MUST_CATCH_BYTES on `3f775eeb8` — the loosest of the
  // four. See "Why `framework` moved UP" above for what that costs.
  //
  // ⚠️ RAISED ×1.20 by objectui#12653 (2026-10-16), the maintainer's 20%
  // ruling, from 100,000 (the entry on MAX_EAGER_CLOSURE_GZIP_BYTES).
  framework: 120_000,
  // ⭐ LOWERED by objectui#9251, which took lucide's runtime `icons` record off
  // the eager path. Indexing that namespace object put 1,781 icon module
  // definitions in this chunk; membership now comes from a build-generated
  // static name list and the glyphs arrive through lucide's dynamic-import map,
  // so the chunk went 397,091 -> 265,937 gzipped, on the two console builds
  // recorded under "Why this number came DOWN" on
  // {@link MAX_EAGER_CLOSURE_GZIP_BYTES}.
  //
  // ⛔ The RAW pair those same builds recorded is NOT restated here, and the
  // omission is the repair rather than an oversight. It was restated, the head
  // leg was wrong by 32,857 bytes, and the KB claim beside it matched neither
  // that figure nor the right one — and nothing here could have caught either:
  // no constant in this file reads raw bytes, no test weighs them, and a figure
  // written into a comment is re-derived never. A ceiling-tier contract review
  // re-measuring the head leg by hand is what found it — comment 5654270820 on
  // objectui#9399, an ISSUE comment rather than a pull request review, which is
  // where a reader looks it up. ⛔ The old figures are not quoted back, for the
  // reason the objectui#7528 pin gives: a reader cannot tell a quotation from a
  // claim.
  // ⇒ Read raw off the instrument this gate already consumes: the `bytes`
  // field beside `gzipBytes` for this key in
  // `apps/console/dist/eager-closure.json`, on your own build. ⚠️ That answers
  // the HEAD leg only — the control leg is a build of `ac05d4f4d`, which no
  // checkout re-derives — which is why the drop above is stated in gzipped
  // bytes, the unit this ceiling is weighed in.
  //
  // ⛔ A TIGHTENING. No build that passed before this edit and measures under
  // 289,000 fails after it. Headroom 23,063 bytes = 0.25x
  // REGRESSION_THIS_GATE_MUST_CATCH_BYTES — well above the 0.10x convention,
  // and chosen larger than `i18n-locale-en`'s 0.11x because this row is the one
  // that had been living at 0.02x: the runway is the point of paying it down,
  // and a re-pin that left it at the convention would hand the next author the
  // same ratchet the day after it was cleared.
  //
  // ⚠️ That reasoning is why this key was taken out of the declared-allowance
  // table objectui#8554 kept, which objectui#10148 then retired outright — the
  // re-pin is what discharged the debt, and it reads the same either way.
  //
  // ⚠️ RAISED ×1.20 by objectui#12653 (2026-10-16), the maintainer's 20%
  // ruling, from 289,000 (the entry on MAX_EAGER_CLOSURE_GZIP_BYTES).
  'ui-components': 347_000,
});

/**
 * The measurement {@link PER_CHUNK_GZIP_CEILINGS} was derived from, read out of
 * the report a `vite build` of `apps/console` wrote. Provenance is per KEY, not
 * per file, and saying so is the point — a comment that names one commit for
 * three numbers taken on two is the drift objectui#6631 is open about:
 *
 *   - `vendor-objectstack` — `c1e32e96` (objectui#11717), the 17.7.0 bump's
 *     build the aggregate also read until objectui#11798, re-measured when this chunk's ceiling
 *     fired and went up with the aggregate's under ruling 6027998226. It
 *     supersedes `2ba091c` (objectui#11438), the 17.6.0 bump's build,
 *     re-measured when the spec's root entry shed its migration chain and this
 *     chunk's ceiling came down with the aggregate's, which superseded
 *     `4acbea07` (objectui#11101), the payback build
 *     re-measured when this chunk's group stopped claiming `import()`ed
 *     modules, which superseded `048e7f6` (objectui#11073, the `@objectstack/*`
 *     17.5.0 raise), which superseded `34a1578ef` (objectui#7122, the 17.3.0
 *     family bump) and `2c8474c04` (objectui#5490) before that. This bullet
 *     still named `34a1578ef` after objectui#11073 had re-pinned the key, and
 *     objectui#11101 repaired it while re-pinning the key again.
 *   - `ui-components` — `2c8474c04` (objectui#5490).
 *   - `framework` — `3f775eeb8`, the `main` tip this raise's branch was cut
 *     from, read out of the `apps/console/dist/eager-closure.json` written by
 *     `pnpm turbo run build --filter='./packages/*'` followed by
 *     `pnpm --filter @object-ui/console build`, run on that tree with NO diff of
 *     its own applied. See "Why `framework` moved UP" above for the ruling it
 *     was measured for and what that raise costs. It supersedes objectui#7399's
 *     `e307c9896` reading, objectui#7173's before that, and objectui#6759's
 *     `a64e96ca8` before that. ⚠️ Unlike the entry below it, this one IS a
 *     reading of an unmodified tree — the change it pins lives entirely in this
 *     file, and `scripts/check-*.mjs` is not a console build input — so the
 *     {@link BASELINE} argument DOES cover it, and it is ⛔ NOT comparable to
 *     the `i18n-locales` figure below, which is an older build on another commit.
 *   - `i18n-locale-en` — `755d34a5f` (objectui#7479), the commit that carries
 *     the lazy-catalogue change, read from its own console build. It REPLACES
 *     the retired `i18n-locales` key, whose last reading was `ba20b0bc0`
 *     (objectui#8816) and `e307c9896` (objectui#7399) before that. ⚠️ Unlike
 *     every other entry here it shares BASELINE's commit exactly, and that is
 *     the point rather than a coincidence: the aggregate and this key moved for
 *     the SAME reason, in the same commit, off the same pair of builds, so the
 *     -410,553 aggregate delta and the 456,196 -> 40,415 catalogue delta are
 *     subtractable against each other. The control build they are subtracted
 *     from is `origin/main` `d8b4739d4`, same container, same instrument.
 *
 *     ⚠️ It WAS a FORWARD reading — the only entry here that ever has been —
 *     and it is not one any more. It names the state `main` reaches once
 *     objectui#8901 and objectui#8888 have BOTH landed, and both have:
 *     `fffa30d3f` at 2026-09-10T06:05:37Z and `8ea3beee4` at
 *     2026-09-10T06:05:40Z, three seconds apart and both ancestors of `main`.
 *     ⇒ the gap this entry used to describe is CLOSED, and the sentence that
 *     described it is history: while only one claimant had landed the live
 *     payload sat below this constant (455,271 and 455,519, both measured) and
 *     `pnpm check:eager-closure` printed MORE headroom than arithmetic on these
 *     two constants gives. ⛔ Do not read a current headroom out of that — the
 *     figure in force is the one the gate prints on YOUR build. Recorded
 *     forward on purpose, and the reason outlives the gap: a shared budget with
 *     two admitted claimants has no single-commit baseline that is not stale
 *     the moment the second one lands, and erring toward the larger payload is
 *     the direction that cannot hide growth.
 *
 *     ⚠️ Unlike the entries above it, this is a reading of a tree carrying
 *     diffs of its own — the two claimants — which is the point rather than a
 *     contaminant: their bytes are the subject. The
 *     `scripts/vite-*.ts`-versus-`scripts/check-*.mjs` argument {@link BASELINE}
 *     makes DOES cover the ceiling edit itself, because this file is not a
 *     console build input; that was checked rather than assumed, and the check
 *     is recorded on objectui#8816.
 *
 * Exported so the ceilings are CHECKED against it instead of merely asserted
 * in this comment.
 *
 * ⚠️ These readings are on DIFFERENT commits from {@link BASELINE} above —
 * `vendor-objectstack` shared the aggregate's commit from objectui#11073 until
 * objectui#11798, `i18n-locale-en` from objectui#7479 until objectui#9251, and
 * `ui-components` from objectui#9251 until objectui#10996 re-pinned the
 * aggregate onto a `main` commit; since objectui#12030 `vendor-objectstack`
 * does again — and
 * WHICH ONE IS LATER flips every time either side is re-baselined, so read the
 * commit names, never a direction asserted here. From objectui#11717 until
 * objectui#11798, `vendor-objectstack` shared the aggregate's reading:
 * objectui#11717's `c1e32e96`, the build of that card's bump, re-pinned both, as
 * objectui#11438's `2ba091c`, objectui#11101's `4acbea07` and objectui#11073's
 * `048e7f6` had before it. objectui#11798 re-pinned the aggregate onto
 * `c1d378ec` and left this key at `c1e32e96`: that chunk moved by 0
 * bytes across objectui#11798's two builds, and its ceiling did not move.
 * objectui#11854 re-pinned the aggregate onto `406f760` and left
 * every key where it was: `vendor-objectstack`, `framework` and
 * `i18n-locale-en` moved by 0 bytes across objectui#11854's two builds and
 * `ui-components` by 9, and no ceiling moved. objectui#11939 re-pinned the
 * aggregate onto `f05f015` and left every key where it was too:
 * across its two builds `vendor-objectstack` moved by −6,468 (one
 * `@objectstack/spec` entry left the first load with the designers),
 * `ui-components` by −19, `framework` by +10 and `i18n-locale-en` by 0, every
 * ceiling stayed in range, and no ceiling moved. objectui#12030 re-pinned the
 * aggregate onto `5488ae7` and `vendor-objectstack` with it, from
 * the same build, when the objectstack#22044 payback lowered both lines; the
 * other three keys moved by at most 846 bytes across its two builds and stayed
 * where they were. objectui#13410 re-pinned the aggregate onto
 * BASELINE's `b6f11d3` and left every key where it was: across its two builds
 * `vendor-objectstack`, `framework` and `i18n-locale-en` moved by 0 bytes and
 * `ui-components` by +12,267 (the markdown modules its entry on
 * {@link MAX_EAGER_CLOSURE_GZIP_BYTES} attributes), every ceiling stayed in
 * range, and no ceiling moved. `vendor-objectstack` is therefore still the
 * `5488ae7` reading moved by objectui#12626's measured delta. The aggregate is the later reading for every other key:
 * `bbf6b02d9` (2026-09-13, objectui#9251) for `ui-components`, and `3f775eeb8`
 * for `framework`. ⚠️ `i18n-locale-en`'s commit was `755d34a5f` when it
 * was taken and the aggregate has moved on since, which is exactly why the two
 * are named per key rather than described by a direction.
 * This paragraph asserted the reverse,
 * in the present tense, from objectui#5490 until objectui#6778 — true when it
 * was written, then left standing while three aggregate re-baselines moved
 * {@link BASELINE} out from under it.
 *
 * ⚠️ Do not expect `git show` to answer for all of these. Squash-merge keeps the
 * landing commit and drops the PR branch, so of the three named above only
 * `2c8474c04` is an ancestor of `main`; `3d257c85a` still resolves as an object
 * but is not on `main` (it landed as `350509b53`), and `a64e96ca8` is not an
 * object in this repository at all. That is why every hash here is cited WITH
 * its issue: the issue outlives the hash.
 *
 * The aggregate ceiling and its baseline were deliberately NOT touched by
 * objectui#5490: objectui#5468 had ruled that the aggregate line "stays as
 * shipped", and moving it — in either direction — is the maintainer's call. That
 * is why the provenance splits in the first place.
 *
 * ⛔ The stale direction is the cheap half. The expensive half is the CONCLUSION
 * this paragraph used to draw from it: that the aggregate ceiling sat far above
 * the payload — 4,086,000 over the 3,298,620 reading, 787,380 bytes of headroom,
 * 8.64x {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES} — and that these per-chunk
 * ceilings were therefore the only lines holding the three biggest chunks in
 * place. That was accurate for objectui#5490 and is now false: objectui#5924,
 * objectui#6683 and objectui#6776 lowered the aggregate ceiling three times,
 * onto 3,268,000, and it is back in range and doing work.
 *
 * Checked rather than argued, which is the rule everywhere else in this file. A
 * full console build on `e33b44796` and `pnpm check:eager-closure` printed:
 *
 *     ✅ aggregate closure          3149.2 KB measured / 3191.4 KB ceiling (headroom 42.2 KB = 0.47x)
 *     ✅ chunk `vendor-objectstack`  925.7 KB measured /  944.3 KB ceiling (headroom 18.6 KB = 0.21x)
 *     ✅ chunk `framework`           492.9 KB measured /  500.0 KB ceiling (headroom  7.1 KB = 0.08x)
 *     ✅ chunk `ui-components`       386.2 KB measured /  389.6 KB ceiling (headroom  3.4 KB = 0.04x)
 *
 * All four sit inside one regression, which is the whole of what "in range"
 * means here — {@link evaluateHeadroomSensitivity} calls 1.00x an error. So the
 * relationship these ceilings have to the aggregate is no longer "we are the
 * half that still works". It is narrower, and still worth having: WHICH line is
 * tightest moves with every build and is not restated here — the ranking this
 * sentence used to assert had inverted by the time anyone re-read it
 * (objectui#7518) — and whichever it is, these say WHERE, which one total
 * never can.
 *
 * ⛔ Do not size a re-baseline off the figures above. They are ONE dated run,
 * taken before objectui#7399 re-attributed `framework`, so its `framework` row
 * weighs locale catalogues that line no longer holds. They are recorded so this
 * paragraph rests on a measurement instead of an argument; the answer in force
 * is the table the gate prints on YOUR build. That this prose
 * went three re-baselines stale while the numbers beside it could not
 * (objectui#6778) is the reason to distrust the prose first.
 *
 * Keys must match {@link PER_CHUNK_GZIP_CEILINGS} exactly (a test enforces it):
 * a ceiling with no measurement behind it is a number someone guessed, and a
 * measurement with no ceiling weighs nothing.
 */
export const PER_CHUNK_BASELINE = Object.freeze({
  // `5488ae7`, the build BASELINE above carries since objectui#12030, re-pinned
  // with its ceiling by the objectstack#22044 payback. It supersedes the
  // `c1e32e96` reading of 1,604,474, the build BASELINE carried from
  // objectui#11717 until objectui#11798 (which left this key alone), re-pinned
  // with its ceiling by the fourth raise, which superseded objectui#11438's
  // `2ba091c` reading of 1,420,958 (re-pinned with its ceiling by the second
  // payback), which superseded objectui#11101's `4acbea07` reading of 1,670,964, which superseded objectui#11073's
  // `048e7f6` reading of 1,703,690 (landed on `main` as `81f8498`), which
  // superseded objectui#7122's `34a1578ef` reading of 1,235,029.
  //
  // Moved with its ceiling by objectui#12626 (2026-10-16), from 1,512,690 by
  // the same measured +19,296 bytes (the table on that key of
  // PER_CHUNK_GZIP_CEILINGS). ⚠️ So this is no longer one build's reading: it
  // is the `5488ae7` reading plus the next.2 bump's measured delta, which
  // keeps the ceiling-minus-baseline gap this key carried.
  'vendor-objectstack': 1_531_986,
  // `755d34a5f` (objectui#7479) — the SAME console build as
  // BASELINE above, so the two are directly comparable, and the same instrument
  // and container as the control build it is subtracted from. It supersedes
  // objectui#8816's `ba20b0bc0` reading of the retired `i18n-locales` key.
  'i18n-locale-en': 40_415,
  // `3f775eeb8`, its OWN console build — ⛔ not the one above it and not
  // BASELINE's. Moved with the ceiling in the same commit, per the maintainer
  // ruling of 2026-09-08 and the rule stated under "Raising one".
  framework: 72_245,
  // `bbf6b02d9`, the console build BASELINE carried from objectui#9251 until
  // objectui#10996 re-pinned the aggregate onto `main` — comparable with that
  // retired reading, ⛔ not with the one above — and the same instrument and
  // container as the control build it is subtracted from (objectui#9251).
  'ui-components': 265_937,
});

/**
 * The membership artifact's file name, and its default path.
 *
 * ⚠️ The NAME is the load-bearing half. `main` resolves this artifact next to
 * whatever `--report` names, because the two files are written by the same
 * build into the same `dist` — deriving one from the other is what keeps a run
 * pointed at some other build's report from silently weighing THIS tree's
 * membership, which is a mismatch no assertion below could detect.
 */
const MEMBERSHIP_REPORT_FILE_NAME = 'chunk-membership.json';
const MEMBERSHIP_REPORT_PATH = `apps/console/dist/${MEMBERSHIP_REPORT_FILE_NAME}`;

/**
 * The membership artifact's own version, independent of
 * {@link SUPPORTED_REPORT_VERSION}.
 *
 * ⛔ Not a duplicate of that constant and ⛔ not to be merged into it:
 * `eager-closure.json`'s version is a contract with a SECOND reader,
 * `scripts/check-eager-locale-catalogues.mjs`, whose own tests pin that a later
 * version is REFUSED. Two artifacts, two versions, each bumped by the reader
 * that has to understand it.
 */
const SUPPORTED_MEMBERSHIP_REPORT_VERSION = 2;

/**
 * WHERE each budgeted group's declared packages must land — an EXACT claim,
 * ⛔ not a ratchet with headroom (objectui#9345).
 *
 * ## The hole this closes
 *
 * Every other verdict in this file weighs BYTES against a line drawn per chunk
 * NAME. That arrangement has an exit nobody was watching: move the bytes to a
 * chunk with no line, and every line goes green while the browser downloads
 * exactly what it downloaded before. It was not hypothetical. All 92 modules of
 * `packages/core` left the budgeted `framework` chunk for `data-adapter` —
 * which has no ceiling and no baseline and is in the eager closure — on one
 * commit that edited no chunking config at all (objectui#9185, measured on
 * objectui#9205). `framework` fell far enough below its own baseline to raise a
 * DIFFERENT question, and the answer to that question was three cards away.
 *
 * ⇒ this half asks the question a byte count structurally cannot: did the
 * budgeted groups' declared packages land where the config says they land?
 *
 * ## Why the keys are exactly the budgeted groups
 *
 * The subject of the claim is a BUDGET that can be bypassed, so its population
 * is the chunks that carry a budget — the keys of
 * {@link PER_CHUNK_GZIP_CEILINGS}, cross-checked below rather than trusted.
 * Two of those four keys name no workspace package and are absent here for
 * reasons, not by oversight:
 *
 *   - `vendor-objectstack` holds `node_modules` only, so no `packages/<name>`
 *     claim can be made about it.
 *   - `i18n-locale-en` is ONE FILE inside `packages/i18n`, whose other modules
 *     belong to `i18n-runtime` by design — package granularity cannot express
 *     that, and `scripts/check-eager-locale-catalogues.mjs` already pins the
 *     catalogues' membership by chunk name.
 *
 * ## Why the values are package names and not regexes
 *
 * A regex here would be a SECOND opinion about the group tests in
 * `apps/console/vite.config.ts` — one that goes on reading plausibly while it
 * matches something else. `scripts/__tests__/check-eager-closure-budget.test.ts`
 * instead requires each name below to be matched by that group's own declared
 * test, so the two cannot drift apart without a red test.
 */
export const PER_CHUNK_MEMBERSHIP = Object.freeze({
  framework: Object.freeze(['core', 'react', 'types']),
  'ui-components': Object.freeze(['components', 'fields']),
});

/**
 * The declared EXCEPTIONS to {@link PER_CHUNK_MEMBERSHIP}'s "wholly": a
 * package-relative subtree of a declared package that a narrower,
 * higher-priority group takes BY DESIGN — keyed by package, each entry naming
 * the subtree and the one chunk it must land in (objectui#10065).
 *
 * ## Why this exists, and why it is not a looser rule
 *
 * objectui#10082 split `packages/types` on purpose: the `src/zod/**`
 * validators go to `types-zod`, which only the lazy `plugin-map` chunk reads,
 * and the rest stays in `framework`. "`packages/types` lands wholly in
 * `framework`" became false by ruling, not by accident. The two repairs this
 * half refuses are the two that would make it pass by weighing less:
 *
 *   - ⛔ dropping `types` from `framework`'s list — the whole package would
 *     then be unwatched, including the split's own failure mode;
 *   - ⛔ allowing `types` "anywhere but a stray chunk" — which is a ratchet.
 *
 * So the split is DECLARED, and held to the module: every module under the
 * subtree must land in the carve-out's chunk, every other module of the package
 * in the package's declared chunk, nowhere else, and each side must hold at
 * least one module. ⭐ That is what catches the failure the split was measured
 * to produce on its first build: rolldown's default
 * `includeDependenciesRecursively` absorbed three shared `src/` neighbours into
 * `types-zod` along an import, the eager `plugin-grid` chunk then imported it
 * statically, and every byte stayed eager. A per-package count reads that as
 * the healthy split; the directory counts it is judged against here do not.
 *
 * ## Why a carve-out may name a chunk no ceiling governs — and when it may not
 *
 * This half's keys are limited to budgeted chunks because it guards a byte
 * budget's flank. A carve-out's destination is not a key: it is where declared
 * bytes LEAVE that budget. That is only honest when they also leave the thing
 * every budget here weighs — so a destination that carries no ceiling must be
 * ABSENT from the eager closure of the same build, read from
 * `eager-closure.json`. ⛔ A carve-out into an unbudgeted EAGER chunk is refused
 * as an error: it is objectui#9345's incident — `packages/core` in
 * `data-adapter`, bytes downloaded and weighed by nothing — written down as
 * though it were a ruling.
 *
 * `scripts/__tests__/check-eager-closure-budget.test.ts` cross-checks each
 * entry against `apps/console/vite.config.ts`: the carve-out group's own test
 * must match the subtree and must miss the rest of the package, the declared
 * chunk's test must match the subtree too (or this is not a carve FROM it), and
 * the carve-out group must outrank it.
 */
export const PER_CHUNK_MEMBERSHIP_CARVE_OUTS = Object.freeze({
  types: Object.freeze([Object.freeze({ subtree: 'src/zod', chunk: 'types-zod' })]),
  // objectui#12622, seat ruling 6212914664 (option A): the record-form date
  // picker, which only `FORM_FACE_LOADERS`' `import()` reaches. Without this row
  // `ui-components` claimed it with the rest of `packages/fields` and put it on
  // every page load. Its chunk carries no ceiling, so the rule above holds it
  // to being ABSENT from the eager closure.
  fields: Object.freeze([
    Object.freeze({ subtree: 'src/widgets/date-picker', chunk: 'fields-date-picker' }),
  ]),
});

/**
 * Read the membership artifact, or `null` when it is not there / not JSON.
 *
 * @param {string} [reportPath]
 * @returns {unknown}
 */
export function readMembershipReport(reportPath = MEMBERSHIP_REPORT_PATH) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The membership verdict.
 *
 * ⚠️ Read the ERROR branches before the fail branch. Every one of them exists
 * because this half's green state is "no declared package was found anywhere it
 * should not be" — a sentence that is also true of a report that attributed
 * nothing, of a package that vanished from the bundle, of a declaration that
 * names a chunk no ceiling governs, and of a carve-out whose subtree holds
 * nothing. A check whose pass condition is an ABSENCE has to prove it looked.
 *
 * A declared package WITHOUT a carve-out is judged on the per-package counts
 * and must land wholly in its declared chunk. A package WITH one
 * ({@link PER_CHUNK_MEMBERSHIP_CARVE_OUTS}) is judged on the per-directory
 * counts: each module lands in the carve-out's chunk when its directory is
 * under the carved subtree and in the declared chunk otherwise — exactly, one
 * stray module is a finding, named by its directory.
 *
 * @param {object} input
 * @param {unknown} input.membership  parsed `chunk-membership.json`, or null
 * @param {Record<string, readonly string[]>} [input.declaration]
 * @param {Record<string, readonly { subtree: string, chunk: string }[]>} [input.carveOuts]
 * @param {Record<string, number>} [input.budgetedChunks]
 * @param {Iterable<string> | null} [input.eagerChunkNames]  the `name` of every
 *        chunk in the SAME build's eager closure (`eager-closure.json`'s
 *        `files[].name`), or null when that report could not be read. Needed
 *        only to admit a carve-out whose chunk carries no ceiling.
 * @param {string} [input.reportPath]
 * @returns {{ status: 'pass' | 'fail' | 'error', message: string }}
 */
export function evaluatePerChunkMembership({
  membership,
  declaration = PER_CHUNK_MEMBERSHIP,
  carveOuts = PER_CHUNK_MEMBERSHIP_CARVE_OUTS,
  budgetedChunks = PER_CHUNK_GZIP_CEILINGS,
  eagerChunkNames = null,
  reportPath = MEMBERSHIP_REPORT_PATH,
} = {}) {
  if (membership === null || membership === undefined || typeof membership !== 'object') {
    return {
      status: 'error',
      message:
        `PREREQUISITE NOT MET: \`${reportPath}\` is missing or is not JSON, so no chunk ` +
        `membership was weighed. This half reads a BUILT bundle — run ` +
        `\`pnpm --filter @object-ui/console build\` first. ⛔ This is NOT a pass: a gate that ` +
        `could not run is not a gate that ran clean.`,
    };
  }

  const r = /** @type {Record<string, unknown>} */ (membership);
  if (r.membershipReportVersion !== SUPPORTED_MEMBERSHIP_REPORT_VERSION) {
    return {
      status: 'error',
      message:
        `\`${reportPath}\` declares membershipReportVersion ` +
        `${JSON.stringify(r.membershipReportVersion)}, expected ` +
        `${SUPPORTED_MEMBERSHIP_REPORT_VERSION} — the emitter in ` +
        `\`apps/console/vite.config.ts\` and this half have drifted apart, and a shape this ` +
        `half does not understand is refused rather than read for fields it may not carry.`,
    };
  }

  if (typeof r.totalChunkCount !== 'number' || !Number.isFinite(r.totalChunkCount) || r.totalChunkCount < 1) {
    return {
      status: 'error',
      message:
        `\`${reportPath}\` reports totalChunkCount ${JSON.stringify(r.totalChunkCount)} — a ` +
        `bundle with no chunk in it attributed nothing, and "nothing was attributed" reads to ` +
        `the check below exactly like "no module is out of place".`,
    };
  }

  const packages = r.packages;
  if (packages === null || typeof packages !== 'object' || Object.keys(packages).length === 0) {
    return {
      status: 'error',
      message:
        `\`${reportPath}\` attributes no workspace package at all, so every membership claim ` +
        `below would be vacuously true. The emitter refuses to publish such a report; one ` +
        `reaching this half means it was edited, truncated or hand-written.`,
    };
  }
  const attribution = /** @type {Record<string, Record<string, number>>} */ (packages);
  const directories = /** @type {Record<string, Record<string, Record<string, number>>>} */ (
    r.directories !== null && typeof r.directories === 'object' ? r.directories : {}
  );

  // The declaration is about BUDGETED chunks. A key here that carries no
  // ceiling would be pinning membership for a line nothing weighs — harmless
  // to assert and misleading to read, since this half's whole argument is that
  // it guards the byte budget's flank.
  const unbudgeted = Object.keys(declaration).filter((chunk) => !(chunk in budgetedChunks));
  if (unbudgeted.length > 0) {
    return {
      status: 'error',
      message:
        `PER_CHUNK_MEMBERSHIP declares ${unbudgeted.map((c) => `\`${c}\``).join(', ')}, which ` +
        `${unbudgeted.length === 1 ? 'is' : 'are'} not among the budgeted chunks in ` +
        `PER_CHUNK_GZIP_CEILINGS. This half exists to guard a byte budget's flank; a membership ` +
        `pin on a chunk with no budget guards nothing and reads as though it did.`,
    };
  }

  // The carve-outs are judged BEFORE any module is counted: an inadmissible
  // exception makes every verdict built on it meaningless, in either direction.
  /** @type {Map<string, string>} */
  const homeOf = new Map();
  for (const [chunk, pkgs] of Object.entries(declaration)) {
    for (const pkg of pkgs) homeOf.set(pkg, chunk);
  }
  const eager = eagerChunkNames === null ? null : new Set(eagerChunkNames);
  /** @type {string[]} */
  const inadmissible = [];
  for (const [pkg, carves] of Object.entries(carveOuts)) {
    const home = homeOf.get(pkg);
    if (home === undefined) {
      inadmissible.push(
        `\`packages/${pkg}\` has a carve-out but no budgeted chunk declares the package — an ` +
          `exception to a claim nobody makes`,
      );
      continue;
    }
    if (!Array.isArray(carves) || carves.length === 0) {
      inadmissible.push(`\`packages/${pkg}\` has an EMPTY carve-out list`);
      continue;
    }
    for (const carve of carves) {
      const subtree = carve?.subtree;
      const chunk = carve?.chunk;
      if (
        typeof subtree !== 'string' ||
        subtree.split('/').some((part) => part === '' || part === '.' || part === '..')
      ) {
        inadmissible.push(
          `\`packages/${pkg}\` carves ${JSON.stringify(subtree)}, which is not a ` +
            `package-relative directory written the way the emitter keys them (\`src/zod\`)`,
        );
        continue;
      }
      if (typeof chunk !== 'string' || chunk === '') {
        inadmissible.push(`\`packages/${pkg}/${subtree}\` is carved into no named chunk`);
        continue;
      }
      if (chunk === home) {
        inadmissible.push(
          `\`packages/${pkg}/${subtree}\` is carved into \`${chunk}\`, the package's own declared ` +
            `chunk — a carve-out that moves nothing`,
        );
        continue;
      }
      if (!(chunk in budgetedChunks)) {
        if (eager === null) {
          inadmissible.push(
            `\`packages/${pkg}/${subtree}\` is carved into \`${chunk}\`, which carries no ceiling, ` +
              `and this run could not read the eager closure to confirm that chunk is LAZY`,
          );
        } else if (eager.has(chunk)) {
          inadmissible.push(
            `\`packages/${pkg}/${subtree}\` is carved into \`${chunk}\`, which is in the EAGER ` +
              `closure and carries no ceiling — declared bytes downloaded on every page load and ` +
              `weighed by nothing, which is the bypass this half exists to catch (objectui#9345)`,
          );
        }
      }
    }
    const subtrees = carves.map((c) => c?.subtree).filter((t) => typeof t === 'string');
    for (const a of subtrees) {
      for (const b of subtrees) {
        if (a !== b && b.startsWith(`${a}/`)) {
          inadmissible.push(
            `\`packages/${pkg}\` carves both \`${a}\` and \`${b}\`, which nest — a module under ` +
              `both would have two declared chunks`,
          );
        }
      }
    }
  }
  if (inadmissible.length > 0) {
    return {
      status: 'error',
      message:
        `PER_CHUNK_MEMBERSHIP_CARVE_OUTS holds ${inadmissible.length} inadmissible ` +
        `entr${inadmissible.length === 1 ? 'y' : 'ies'}:\n` +
        inadmissible.map((line) => `  ❌ ${line}.`).join('\n') +
        `\nA carve-out is an EXCEPTION to a budgeted chunk's claim, so it is refused rather ` +
        `than read: an exception nobody can check turns an exact pin into a permissive one.`,
    };
  }

  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const unmeasured = [];
  /** @type {string[]} */
  const strays = [];
  /** @type {string[]} */
  const held = [];

  for (const [chunk, pkgs] of Object.entries(declaration)) {
    for (const pkg of pkgs) {
      const landed = attribution[pkg];
      if (landed === undefined || typeof landed !== 'object' || Object.keys(landed).length === 0) {
        missing.push(pkg);
        continue;
      }
      const total = Object.values(landed).reduce((n, count) => n + count, 0);
      const carves = carveOuts[pkg] ?? [];

      if (carves.length === 0) {
        const elsewhere = Object.entries(landed).filter(([name]) => name !== chunk);
        if (elsewhere.length > 0) {
          const where = elsewhere
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => `${count} in \`${name}\``)
            .join(', ');
          strays.push(
            `\`packages/${pkg}\` is declared in \`${chunk}\` but ${where} ` +
              `(${landed[chunk] ?? 0} of its ${total} modules landed in \`${chunk}\`)`,
          );
        } else {
          held.push(`\`packages/${pkg}\` ${total} modules in \`${chunk}\``);
        }
        continue;
      }

      // A carved package is judged per DIRECTORY, so it needs the directory
      // table — and that table must add up to the package's own counts, or the
      // two halves of one artifact describe two different bundles.
      const dirs = directories[pkg];
      if (dirs === undefined || dirs === null || typeof dirs !== 'object' || Object.keys(dirs).length === 0) {
        unmeasured.push(
          `\`packages/${pkg}\` is declared with a carve-out but the artifact carries no ` +
            `directory attribution for it, so the split cannot be held to the module`,
        );
        continue;
      }
      /** @type {Record<string, number>} */
      const summed = {};
      for (const byChunk of Object.values(dirs)) {
        for (const [name, count] of Object.entries(byChunk)) summed[name] = (summed[name] ?? 0) + count;
      }
      const chunkNames = new Set([...Object.keys(summed), ...Object.keys(landed)]);
      if ([...chunkNames].some((name) => (summed[name] ?? 0) !== (landed[name] ?? 0))) {
        unmeasured.push(
          `\`packages/${pkg}\`'s directory counts (${JSON.stringify(summed)}) do not add up to ` +
            `its package counts (${JSON.stringify(landed)})`,
        );
        continue;
      }

      const carveFor = (/** @type {string} */ dir) =>
        carves.find((c) => dir === c.subtree || dir.startsWith(`${c.subtree}/`));
      let restTotal = 0;
      /** @type {Map<object, number>} */
      const carvedTotal = new Map(carves.map((c) => [c, 0]));
      /** @type {string[]} */
      const misplaced = [];
      for (const [dir, byChunk] of Object.entries(dirs).sort(([a], [b]) => a.localeCompare(b))) {
        const carve = carveFor(dir);
        const expected = carve ? carve.chunk : chunk;
        for (const [name, count] of Object.entries(byChunk).sort((a, b) => b[1] - a[1])) {
          if (carve) carvedTotal.set(carve, /** @type {number} */ (carvedTotal.get(carve)) + count);
          else restTotal += count;
          if (name !== expected) {
            misplaced.push(
              `\`packages/${pkg}/${dir}\` ${count} in \`${name}\` (declared \`${expected}\`)`,
            );
          }
        }
      }

      // Both sides of the split must hold something. A carve-out whose subtree
      // contributed no module describes a bundle that does not exist, and a
      // package whose REMAINDER contributed none is no longer declared in its
      // chunk at all — each would otherwise pass by weighing nothing.
      const emptyCarves = carves.filter((c) => carvedTotal.get(c) === 0);
      if (emptyCarves.length > 0 || restTotal === 0) {
        unmeasured.push(
          [
            ...emptyCarves.map(
              (c) =>
                `the carve-out \`packages/${pkg}/${c.subtree}\` -> \`${c.chunk}\` matched no ` +
                `module in the bundle`,
            ),
            ...(restTotal === 0
              ? [`\`packages/${pkg}\` outside its carve-out(s) contributed no module to \`${chunk}\``]
              : []),
          ].join('; '),
        );
        continue;
      }

      const carvedText = carves
        .map((c) => `its \`${c.subtree}\` subtree -> \`${c.chunk}\``)
        .join(', ');
      if (misplaced.length > 0) {
        strays.push(
          `\`packages/${pkg}\` is declared in \`${chunk}\` with ${carvedText}, but ` +
            misplaced.join(', '),
        );
      } else {
        held.push(
          `\`packages/${pkg}\` ${restTotal} modules in \`${chunk}\` and ` +
            carves
              .map((c) => `its \`${c.subtree}\` subtree ${carvedTotal.get(c)} in \`${c.chunk}\``)
              .join(', ') +
            ', exactly',
        );
      }
    }
  }

  // Ahead of the stray verdict on purpose. A declared package that contributed
  // NO module to the bundle cannot be out of place, so the stray scan would
  // pass on it — by measuring nothing, which is the one direction every probe
  // in this file refuses.
  if (missing.length > 0) {
    return {
      status: 'error',
      message:
        `${missing.length} declared package(s) contributed no module to any chunk: ` +
        `${missing.map((p) => `\`packages/${p}\``).join(', ')}. ⛔ Not a pass: a package that ` +
        `is not in the bundle is not "in its declared chunk", and the membership scan would ` +
        `agree with everything about it. Either the package was renamed or removed — update ` +
        `PER_CHUNK_MEMBERSHIP deliberately — or the emitter has stopped recognising its module ` +
        `ids, in which case this gate is matching nothing.`,
    };
  }

  // Same reasoning, one level down: a carved package whose split cannot be
  // weighed is not a package whose split is right.
  if (unmeasured.length > 0) {
    return {
      status: 'error',
      message:
        `${unmeasured.length} carved package(s) could not be held to their declared split:\n` +
        unmeasured.map((line) => `  ❌ ${line}.`).join('\n') +
        `\n⛔ Not a pass: the carve-out table and the bundle no longer describe each other. ` +
        `Rebuild the console if the artifact is stale; otherwise update ` +
        `PER_CHUNK_MEMBERSHIP_CARVE_OUTS deliberately and say in the PR why.`,
    };
  }

  if (strays.length > 0) {
    return {
      status: 'fail',
      message:
        `${strays.length} budgeted package(s) did not land in the chunk the console config ` +
        `declares for them:\n` +
        strays.map((line) => `  ❌ ${line}`).join('\n') +
        `\nChunk membership is decided by the grouping rules in ` +
        `\`apps/console/vite.config.ts\`, ⛔ not by the side effect of an import edge: ` +
        `rolldown's \`includeDependenciesRecursively\` lets a higher-priority group take a ` +
        `lower-priority group's declared members along an import, and the group that receives ` +
        `them may carry no ceiling at all — in which case the bytes go on being downloaded ` +
        `while every per-chunk line above turns green (objectui#9345). ⛔ Do NOT move a ceiling ` +
        `or a baseline to absorb this. Repair the grouping rule, or change this declaration ` +
        `deliberately and say in the PR which chunk now owns the package and why.`,
    };
  }

  return {
    status: 'pass',
    message:
      `Chunk membership: ${held.length} budgeted package(s) each landed exactly where declared ` +
      `— ${held.join('; ')}. (Counted over every emitted chunk, lazy ones included, from ` +
      `\`${reportPath}\`.)`,
  };
}

/**
 * ## ⛔ RETIRED — the exhausted-headroom leg, and why it is not coming back
 *   quietly (objectui#10148)
 *
 * This is where `EXHAUSTED_HEADROOM_FLOOR_MULTIPLE`,
 * `EXHAUSTED_HEADROOM_ALLOWANCES` and
 * `EXHAUSTED_HEADROOM_ALLOWANCE_GRANULARITY_MULTIPLE` stood, and the paragraph
 * is here rather than deleted with them for one reason: the text they carried
 * forbade, in as many words, the edit that has now been made. ⛔ A removal that
 * takes the prohibition out with the leg leaves the next reader holding an
 * argument for a mechanism that no longer exists, and the obvious repair is to
 * put it back.
 *
 * ### What stood here
 *
 * A ceiling whose headroom had fallen under a tenth of one
 * {@link REGRESSION_THIS_GATE_MUST_CATCH_BYTES} made
 * {@link evaluateHeadroomSensitivity} return `error`, so the run exited 2 — on
 * a build where nothing had grown past any line. The argument was
 * objectui#8554's, and it is a real one, recorded here as history rather than
 * as a live claim: a ceiling with no headroom left passes today and reds
 * whatever lands next, whether or not that diff is what grew, and the merge
 * queue weighs the merge ref, so the change it reds is very often not the
 * change that spent the bytes. `EXHAUSTED_HEADROOM_ALLOWANCES` held, at the
 * byte, the rows that were already under that floor the day it landed;
 * `..._GRANULARITY_MULTIPLE` was the unit those pinned figures were compared
 * in. ⛔ Neither has any other reader, which is why both left with the floor.
 *
 * ### The prohibition that stood with it, and who is allowed to overrule it
 *
 * The retired text said, and the failure message printed:
 *
 *     ⛔ Never lower EXHAUSTED_HEADROOM_FLOOR_MULTIPLE, and ⛔ never add a row
 *     to EXHAUSTED_HEADROOM_ALLOWANCES to silence this
 *
 * ⭐ That was written about a SEAT reaching for the knob because a build had
 * gone red — which is exactly what it should forbid, and exactly what was
 * happening when objectui#10148 was filed. It was ⛔ never a bar on the
 * maintainer: this repository's priority order is 「维护者裁决 > `AGENTS.md` >
 * 红线 > 核心条款 > 细则 > 座位判断」, and a gate-strength change is precisely
 * the class that needs a ruling rather than a judgement call.
 *
 * ### The ruling — recorded VERBATIM and UNTRANSLATED (maintainer, 2026-09-20,
 *   on objectui#10148). Rewriting a ruling is rewriting the decision, which is
 *   why the two utterances below are carried in the language they were made in.
 *
 *     10148 i18n-locale-en 天花板余量 不需要这是天花板余量
 *
 *     10148 不需要设置天花板余量
 *
 * ⇒ it is the headroom REQUIREMENT that is not wanted. ⛔ Not the row the first
 * utterance names: `i18n-locale-en` keeps its ceiling in
 * {@link PER_CHUNK_GZIP_CEILINGS}, at the value it had, and a build that puts
 * that chunk OVER it still exits 1.
 *
 * ### What re-adding it would take
 *
 * ⛔ Not a repair, and ⛔ not a seat's judgement that the next collision proves
 * the leg was right — objectui#8554's two incidents were already the argument,
 * and they were ruled on with that argument in view. It takes a maintainer
 * decision, on a card, recorded the way this one is. ⚠️ Until then, this gate
 * answers "is this bundle over a line?" and deliberately does ⛔ not answer "is
 * this line still comfortably above this bundle?" at the lower end.
 *
 * ⭐ What did NOT go with it: the BLIND leg at the other end of the same range.
 * A ceiling more than one whole regression ABOVE its payload is still an
 * `error`, because such a ceiling cannot tell "no regression" from the
 * motivating incident — a gauge verdict, not a headroom requirement, and
 * outside what was ruled on. It is also why this half still publishes
 * `closure_headroom_status`, which `.github/workflows/performance-budget.yml`
 * reads as `BUDGET_CLOSURE_HEADROOM_STATUS`.
 *
 * ⚠️ The headroom FIGURES stay in the report: every row still prints its
 * headroom in KB and as a multiple of the regression. Printing a number is
 * reporting; failing a build on it is the requirement that was retired, and the
 * two are separable here because only the predicate read the floor.
 */

/**
 * The report shape this checker understands. v2 added `files[].name` — the
 * chunk name rolldown itself recorded — which is what the per-chunk ceilings
 * below are keyed on. Refusing a v1 report is the point: without those names
 * every budgeted chunk would be "absent", and the difference between "this
 * build predates per-chunk budgets" and "vendor-objectstack has vanished from
 * the closure" must not be a guess.
 */
export const SUPPORTED_REPORT_VERSION = 2;

const DEFAULT_REPORT_PATH = 'apps/console/dist/eager-closure.json';

/**
 * Validate a parsed report before any verdict is read from it.
 *
 * Every check here is a counter-probe, and they all guard the same asymmetry:
 * this gate's failure mode is SILENT. A missing field read as zero, a report
 * left over from an older build, a walk that returned the entry chunk alone —
 * each produces a SMALL number, and a budget check reads a small number as good
 * news. So a report that cannot be trusted must be an ERROR, never a pass.
 *
 * @param {unknown} report
 * @returns {string[]} problems; empty means the report may be read
 */
export function validateReport(report) {
  const problems = [];
  if (report === null || typeof report !== 'object') {
    return ['report is not an object'];
  }
  const r = /** @type {Record<string, unknown>} */ (report);

  if (r.reportVersion !== SUPPORTED_REPORT_VERSION) {
    problems.push(
      `reportVersion is ${JSON.stringify(r.reportVersion)}, expected ${SUPPORTED_REPORT_VERSION} — ` +
        `the emitter in apps/console/vite.config.ts and this checker have drifted apart`,
    );
    // Every field check below assumes v1's names, so they would report noise.
    return problems;
  }

  for (const key of ['eagerChunkCount', 'totalChunkCount', 'eagerGzipBytes', 'eagerRawBytes']) {
    if (typeof r[key] !== 'number' || !Number.isFinite(r[key]) || r[key] < 0) {
      problems.push(`${key} is ${JSON.stringify(r[key])}, expected a non-negative number`);
    }
  }
  if (!Array.isArray(r.files)) problems.push('files is not an array');
  if (!Array.isArray(r.entryChunks) || r.entryChunks.length === 0) {
    problems.push('entryChunks is empty — the walk had no roots, so it measured nothing');
  }
  if (problems.length > 0) return problems;

  const files = /** @type {{ fileName: string, gzipBytes: number }[]} */ (r.files);
  const eagerChunkCount = /** @type {number} */ (r.eagerChunkCount);
  const totalChunkCount = /** @type {number} */ (r.totalChunkCount);
  const eagerGzipBytes = /** @type {number} */ (r.eagerGzipBytes);

  // The entry chunk alone IS the gauge this replaces. One chunk is not a
  // closure, and a walk that collapsed to its roots must not be read as a
  // shrinking bundle.
  if (eagerChunkCount < 2) {
    problems.push(
      `eagerChunkCount is ${eagerChunkCount} — the closure collapsed to its entry chunk(s), ` +
        `which is exactly the blind gauge this check replaces (objectui#5324)`,
    );
  }
  // The other direction: if everything is eager there is no lazy boundary and
  // the number is "the whole bundle", which no page load pays.
  if (eagerChunkCount >= totalChunkCount) {
    problems.push(
      `eagerChunkCount (${eagerChunkCount}) is not less than totalChunkCount (${totalChunkCount}) — ` +
        `the walk is not separating static from dynamic imports`,
    );
  }
  if (files.length !== eagerChunkCount) {
    problems.push(`files has ${files.length} entries but eagerChunkCount is ${eagerChunkCount}`);
  }
  // v2: every member carries the chunk name rolldown recorded, and that name is
  // the key the per-chunk ceilings look up. A member without one is not a
  // cosmetic gap — its bytes would be weighed by the aggregate and by nothing
  // else, and a budgeted chunk hiding in it would read as ABSENT.
  const unnamed = files.filter((f) => typeof f?.name !== 'string' || f.name === '');
  if (unnamed.length > 0) {
    const shown = unnamed.slice(0, 5).map((f) => f?.fileName ?? '<no fileName>');
    problems.push(
      `${unnamed.length} of ${files.length} files carry no chunk \`name\` (${shown.join(', ')}` +
        `${unnamed.length > shown.length ? ', …' : ''}) — per-chunk ceilings key on that field, ` +
        `so a report without it cannot be weighed per chunk`,
    );
  }

  const summed = files.reduce((n, f) => n + (typeof f?.gzipBytes === 'number' ? f.gzipBytes : NaN), 0);
  if (!Number.isFinite(summed) || summed !== eagerGzipBytes) {
    problems.push(
      `eagerGzipBytes (${eagerGzipBytes}) does not equal the sum of files[].gzipBytes (${summed}) — ` +
        `the report is internally inconsistent, so neither number can be trusted`,
    );
  }
  return problems;
}

/**
 * @param {object} input
 * @param {unknown} input.report        parsed `eager-closure.json`, or null when absent
 * @param {number} [input.budgetBytes]  ceiling to compare against
 * @param {string} [input.reportPath]   path the report was read from, for messages
 * @returns {{ status: 'pass' | 'fail' | 'error', message: string, gzipBytes: number | null,
 *             budgetBytes: number, chunkCount: number | null, totalChunkCount: number | null }}
 */
export function evaluateClosureBudget({
  report,
  budgetBytes = MAX_EAGER_CLOSURE_GZIP_BYTES,
  reportPath = DEFAULT_REPORT_PATH,
} = {}) {
  const base = { budgetBytes, gzipBytes: null, chunkCount: null, totalChunkCount: null };

  if (report === null || report === undefined) {
    return {
      ...base,
      status: 'error',
      message:
        `No eager-closure report at ${reportPath}. It is written by ` +
        `\`emitEagerClosureReport\` in apps/console/vite.config.ts during \`vite build\`, so an ` +
        `absent report means the console was not built — or was built by a config that no ` +
        `longer emits it. This is a broken gauge, not a passing budget.`,
    };
  }

  const problems = validateReport(report);
  if (problems.length > 0) {
    return {
      ...base,
      status: 'error',
      message: `Eager-closure report at ${reportPath} cannot be trusted:\n  - ${problems.join('\n  - ')}`,
    };
  }

  const r = /** @type {{ eagerGzipBytes: number, eagerChunkCount: number, totalChunkCount: number }} */ (report);
  const gzipBytes = r.eagerGzipBytes;
  const shared = {
    budgetBytes,
    gzipBytes,
    chunkCount: r.eagerChunkCount,
    totalChunkCount: r.totalChunkCount,
  };

  if (gzipBytes > budgetBytes) {
    const over = gzipBytes - budgetBytes;
    return {
      ...shared,
      status: 'fail',
      message:
        `Console eager closure is ${kb(gzipBytes)} KB gzipped across ${r.eagerChunkCount} chunks — ` +
        `${kb(over)} KB over the ${kb(budgetBytes)} KB budget.\n` +
        `These are the bytes every console page load fetches and parses before the app renders; ` +
        `they are not deferred by any lazy import.\n` +
        `If the growth is intended, raise MAX_EAGER_CLOSURE_GZIP_BYTES in ` +
        `scripts/check-eager-closure-budget.mjs deliberately and say in the PR what the bytes ` +
        `buy — do not widen it just to get a green check.`,
    };
  }

  return {
    ...shared,
    status: 'pass',
    message:
      `Console eager closure is ${kb(gzipBytes)} KB gzipped across ${r.eagerChunkCount} of ` +
      `${r.totalChunkCount} chunks (budget: ${kb(budgetBytes)} KB, ` +
      `headroom: ${kb(budgetBytes - gzipBytes)} KB).`,
  };
}

const kb = (bytes) => (bytes / 1024).toFixed(1);

/**
 * Fold the report's eager members into `name -> { gzipBytes, fileNames }`.
 *
 * Chunks are SUMMED per name rather than matched one-to-one, so a group that
 * one day emits two chunks under the same name cannot let bytes out from under
 * its ceiling by splitting. Members with no name are skipped here and refused
 * upstream by {@link validateReport}, which is the only place that refusal
 * belongs — dropping them silently here would be the under-count this whole
 * file exists to prevent.
 *
 * @param {{ files?: { fileName: string, name?: string, gzipBytes: number }[] }} report
 * @returns {Map<string, { name: string, gzipBytes: number, fileNames: string[] }>}
 */
export function measureChunksByName(report) {
  const byName = new Map();
  for (const file of report?.files ?? []) {
    const name = file?.name;
    if (typeof name !== 'string' || name === '') continue;
    const entry = byName.get(name) ?? { name, gzipBytes: 0, fileNames: [] };
    entry.gzipBytes += file.gzipBytes;
    entry.fileNames.push(file.fileName);
    byName.set(name, entry);
  }
  return byName;
}

/**
 * Weigh each budgeted chunk against its own ceiling.
 *
 * Three verdicts, and the ORDER between them is the design:
 *
 *   - `error` — the report cannot be read, yielded no named chunks at all, or
 *     is missing a chunk this file budgets. All three are verdicts about the
 *     GAUGE. The missing-chunk case is the one worth stating out loud: a budget
 *     whose subject is absent passes trivially, so "absent" must be louder than
 *     "over", not quieter. A collapsed measurement is never under budget.
 *   - `fail` — a budgeted chunk is over its ceiling. Names the chunk and BOTH
 *     numbers, because "over budget" without the measurement is a tick in the
 *     other direction.
 *   - `pass` — every budgeted chunk with its measured size and remaining
 *     headroom, so a reader watching a chunk creep upward sees it coming
 *     instead of learning about it the day the gate turns red.
 *
 * @param {object} input
 * @param {unknown} input.report
 * @param {Record<string, number>} [input.ceilings]
 * @param {string} [input.reportPath]
 * @returns {{ status: 'pass' | 'fail' | 'error', message: string,
 *             chunks: { name: string, gzipBytes: number, ceilingBytes: number,
 *                       headroomBytes: number, fileNames: string[] }[],
 *             missing: string[], over: string[] }}
 */
export function evaluatePerChunkBudgets({
  report,
  ceilings = PER_CHUNK_GZIP_CEILINGS,
  reportPath = DEFAULT_REPORT_PATH,
} = {}) {
  const base = { chunks: [], missing: [], over: [] };
  const budgeted = Object.keys(ceilings);

  if (report === null || report === undefined) {
    return {
      ...base,
      status: 'error',
      message:
        `No eager-closure report at ${reportPath}, so no chunk was weighed. Per-chunk ` +
        `ceilings measure nothing without a build — this is a broken gauge, not ` +
        `${budgeted.length} budgets that all passed.`,
    };
  }

  const problems = validateReport(report);
  if (problems.length > 0) {
    return {
      ...base,
      status: 'error',
      message:
        `Per-chunk budgets cannot be read from ${reportPath}:\n  - ${problems.join('\n  - ')}`,
    };
  }

  // A ceiling map with no entries is the same vacuity as a ceiling whose chunk
  // is missing, one level up: nothing is weighed, so nothing can fail.
  if (budgeted.length === 0) {
    return {
      ...base,
      status: 'error',
      message:
        `No per-chunk ceilings are configured, so this half of the gate weighs nothing. ` +
        `An empty PER_CHUNK_GZIP_CEILINGS is a disabled check, not a passing one — ` +
        `objectui#5490 exists because a budget with no subject is green forever.`,
    };
  }

  const measured = measureChunksByName(report);
  // Defence in depth: {@link validateReport} above already refuses a report with
  // no files or with unnamed ones, so this branch should be unreachable through
  // this function. It stays because the direction it guards is the silent one —
  // if a future report shape ever slips an empty measurement past validation,
  // "zero chunks" must read as a broken gauge, never as an under-budget bundle.
  if (measured.size === 0) {
    return {
      ...base,
      status: 'error',
      message:
        `The eager-closure report at ${reportPath} yielded ZERO named chunks, so every ` +
        `per-chunk budget would pass by measuring nothing. A collapsed measurement is not an ` +
        `under-budget bundle.`,
    };
  }

  const present = [...measured.values()].sort((a, b) => b.gzipBytes - a.gzipBytes);
  const missing = budgeted.filter((name) => !measured.has(name));
  if (missing.length > 0) {
    return {
      ...base,
      missing,
      status: 'error',
      message:
        `Budgeted chunk${missing.length === 1 ? '' : 's'} ${missing.map((n) => `\`${n}\``).join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} ABSENT from the eager closure reported at ` +
        `${reportPath}. That is a FAILURE, not a pass: a ceiling whose chunk does not exist ` +
        `weighs nothing and would be green forever.\n` +
        `Either the chunk left the eager closure — good news that must be RE-PINNED here, not ` +
        `inferred — or an \`advancedChunks\` group in apps/console/vite.config.ts was renamed ` +
        `or removed and PER_CHUNK_GZIP_CEILINGS still names the old spelling.\n` +
        `The ${present.length} chunks the report DOES carry, largest first:\n` +
        present.map((c) => `  ${kb(c.gzipBytes).padStart(9)} KB  ${c.name}`).join('\n'),
    };
  }

  const chunks = budgeted
    .map((name) => {
      const entry = /** @type {{ name: string, gzipBytes: number, fileNames: string[] }} */ (
        measured.get(name)
      );
      const ceilingBytes = ceilings[name];
      return {
        name,
        gzipBytes: entry.gzipBytes,
        ceilingBytes,
        headroomBytes: ceilingBytes - entry.gzipBytes,
        fileNames: entry.fileNames,
      };
    })
    .sort((a, b) => b.gzipBytes - a.gzipBytes);

  const over = chunks.filter((c) => c.gzipBytes > c.ceilingBytes);
  // Measured sizes belong in the verdict either way — a reader should see
  // headroom shrinking, not just the tick that precedes a red gate.
  const table = chunks
    .map(
      (c) =>
        `  ${c.gzipBytes > c.ceilingBytes ? '❌' : '✅'} ${c.name.padEnd(20)} ` +
        `${kb(c.gzipBytes).padStart(9)} KB / ${kb(c.ceilingBytes)} KB ceiling ` +
        `(${c.headroomBytes >= 0 ? `headroom ${kb(c.headroomBytes)}` : `OVER by ${kb(-c.headroomBytes)}`} KB)` +
        `${c.fileNames.length > 1 ? ` [${c.fileNames.length} chunks]` : ''}`,
    )
    .join('\n');

  if (over.length > 0) {
    return {
      ...base,
      chunks,
      over: over.map((c) => c.name),
      status: 'fail',
      message:
        `${over.length} eager chunk${over.length === 1 ? ' is' : 's are'} over ` +
        `${over.length === 1 ? 'its' : 'their'} per-chunk budget:\n${table}\n` +
        `These bytes are inside the aggregate ceiling's headroom, which is exactly why this ` +
        `check exists (objectui#5490): one chunk growing while others shrink is invisible to a ` +
        `single total.\n` +
        `If the growth is intended, raise that chunk's entry in PER_CHUNK_GZIP_CEILINGS in ` +
        `scripts/check-eager-closure-budget.mjs deliberately, move PER_CHUNK_BASELINE with it, ` +
        `and say in the PR what the bytes buy — do not widen it just to get a green check.`,
    };
  }

  return {
    ...base,
    chunks,
    status: 'pass',
    message: `Per-chunk eager budgets (${chunks.length} chunks weighed):\n${table}`,
  };
}

/**
 * Weigh every ceiling against the payload it governs, and refuse a ceiling that
 * has drifted out of range of the regression it exists to catch (objectui#5924).
 *
 * ## The failure this exists for
 *
 * Both other halves answer "is the bundle under its line?". Neither can answer
 * "is that line still close enough to the bundle to mean anything?", and that
 * question has a silent wrong answer: a ceiling far above the payload passes
 * everything, prints a green tick with a large `headroom:` figure beside it, and
 * reads as a healthy bundle. The header records the measurement — the aggregate
 * ceiling was 8.6x the regression size above the live payload, and a +154 KB
 * eager regression went green through it.
 *
 * The invariant was not missing, it was checked in the wrong place: the unit
 * test compared {@link MAX_EAGER_CLOSURE_GZIP_BYTES} with
 * {@link BASELINE}.gzipBytes, two literals frozen in this module, so it was true
 * no matter what the console weighed. This function computes the same quantity
 * from the report the gate just read, so drift reds the moment it opens instead
 * of the day someone re-measures by hand.
 *
 * ## Why `error` and not `fail`
 *
 * `fail` is a verdict about the BUNDLE — it grew past a line. Nothing has grown
 * here; the ceiling has stopped being a measurement of anything. That is a
 * verdict about the GAUGE, which is what exit 2 means in this file, and it is
 * the same asymmetry {@link evaluatePerChunkBudgets} applies to a budgeted chunk
 * that is absent: a check that passes by measuring nothing must be LOUDER than
 * one that fails by measuring something, never quieter.
 *
 * ## ONE side of the range — the lower bound was RETIRED (objectui#10148)
 *
 * A ceiling stops measuring at either end, and this function used to say so at
 * both. Too far above the payload and its green tick cannot tell "no
 * regression" from the motivating incident — that is the bound this function
 * still enforces, one whole regression wide. Too CLOSE and its green tick is
 * about the next change rather than this one — that was objectui#8554's lower
 * bound, and a maintainer ruling retired it. The ruling, and the in-file
 * prohibition it overrules, are recorded in the RETIRED block where those
 * constants used to stand; ⛔ read it before putting a floor back here.
 *
 * ⇒ what remains is ONE predicate, `headroomBytes >= regressionBytes`, and it
 * is a verdict about the GAUGE — `error` and exit 2 — because a ceiling that
 * far above its payload is not measuring the payload. A ceiling that is merely
 * TIGHT is a pass: its headroom is still printed on its row, and no predicate
 * reads it.
 *
 * ## What it deliberately does not do
 *
 * It does not treat a NEGATIVE headroom — a ceiling under the payload — as its
 * business. That is an over-budget bundle, the other two halves own it, and
 * reporting it here as well would turn one regression into an error and teach a
 * reader to distrust the exit code. Over-budget rows are still printed, marked
 * as such, so the table is a complete picture of every ceiling — ⛔ printed
 * here, and weighed by the halves that own them.
 *
 * @param {object} input
 * @param {unknown} input.report
 * @param {number} [input.budgetBytes]      the aggregate ceiling
 * @param {Record<string, number>} [input.ceilings]  the per-chunk ceilings
 * @param {number} [input.regressionBytes]  the size this gate must stay able to catch
 * @param {string} [input.reportPath]
 * @returns {{ status: 'pass' | 'error', message: string,
 *             sites: { key: string, label: string, constant: string, measuredBytes: number,
 *                      ceilingBytes: number, headroomBytes: number, multiple: number }[],
 *             blind: string[] }}
 */
export function evaluateHeadroomSensitivity({
  report,
  budgetBytes = MAX_EAGER_CLOSURE_GZIP_BYTES,
  ceilings = PER_CHUNK_GZIP_CEILINGS,
  regressionBytes = REGRESSION_THIS_GATE_MUST_CATCH_BYTES,
  reportPath = DEFAULT_REPORT_PATH,
} = {}) {
  const base = { sites: [], blind: [] };

  if (report === null || report === undefined) {
    return {
      ...base,
      status: 'error',
      message:
        `No eager-closure report at ${reportPath}, so no ceiling could be weighed against the ` +
        `payload it governs. Sensitivity is a property of the ceiling AND the measurement — ` +
        `with only one of them there is nothing to check. This is a broken gauge, not a ` +
        `sensitive gate.`,
    };
  }

  const problems = validateReport(report);
  if (problems.length > 0) {
    return {
      ...base,
      status: 'error',
      message: `Ceiling sensitivity cannot be judged from ${reportPath}:\n  - ${problems.join('\n  - ')}`,
    };
  }

  const measured = measureChunksByName(report);
  const sites = [
    {
      key: 'aggregate',
      label: 'aggregate closure',
      constant: 'MAX_EAGER_CLOSURE_GZIP_BYTES',
      measuredBytes: /** @type {{ eagerGzipBytes: number }} */ (report).eagerGzipBytes,
      ceilingBytes: budgetBytes,
    },
  ];
  const absent = [];
  for (const [name, ceilingBytes] of Object.entries(ceilings)) {
    const entry = measured.get(name);
    // A budgeted chunk with nothing to weigh has no headroom to judge. It is
    // already an ERROR one level up, and inventing a verdict for it here (0
    // bytes measured, so "drifted") would be a second wrong reason for the
    // right exit code. Refuse the whole judgement instead of guessing part of it.
    if (entry === undefined) {
      absent.push(name);
      continue;
    }
    sites.push({
      key: name,
      label: `chunk \`${name}\``,
      constant: `PER_CHUNK_GZIP_CEILINGS['${name}']`,
      measuredBytes: entry.gzipBytes,
      ceilingBytes,
    });
  }

  if (absent.length > 0) {
    return {
      ...base,
      status: 'error',
      message:
        `Cannot judge ceiling sensitivity: budgeted chunk${absent.length === 1 ? '' : 's'} ` +
        `${absent.map((n) => `\`${n}\``).join(', ')} ${absent.length === 1 ? 'is' : 'are'} absent ` +
        `from ${reportPath}, so ${absent.length === 1 ? 'its ceiling governs' : 'their ceilings govern'} ` +
        `nothing measurable. See the per-chunk verdict for what to do about it.`,
    };
  }

  const rows = sites.map((site) => {
    const headroomBytes = site.ceilingBytes - site.measuredBytes;
    return { ...site, headroomBytes, multiple: headroomBytes / regressionBytes };
  });
  // The ONLY predicate this half applies (objectui#10148 retired the other).
  // A LOWER bound used to stand right here; the RETIRED block above records the
  // maintainer ruling that took it out and what putting it back would take.
  const blind = rows.filter((row) => row.headroomBytes >= regressionBytes);

  const table = rows
    .map((row) => {
      // ⭐ The headroom figure is REPORTING and stays (objectui#10148). What was
      // retired is the predicate that failed a build on a SMALL one, ⛔ not the
      // number: a reader watching a row tighten is exactly who the ruling left
      // this column for, and a tick beside it now means "under its line".
      const band =
        row.headroomBytes < 0
          ? `OVER by ${kb(-row.headroomBytes)} KB — the size verdict owns this row, not this one`
          : `headroom ${kb(row.headroomBytes)} KB = ${row.multiple.toFixed(2)}x the ` +
            `${kb(regressionBytes)} KB regression`;
      const failing = row.headroomBytes >= regressionBytes;
      return (
        `  ${failing ? '❌' : '✅'} ${row.label.padEnd(28)} ` +
        `${kb(row.measuredBytes).padStart(9)} KB measured / ${kb(row.ceilingBytes)} KB ceiling ` +
        `(${band})  [${row.constant}]`
      );
    })
    .join('\n');

  const headlines = [];
  const prose = [];

  if (blind.length > 0) {
    headlines.push(
      `${blind.length} ceiling${blind.length === 1 ? '' : 's'} ` +
        `${blind.length === 1 ? 'has' : 'have'} DRIFTED more than one ` +
        `${kb(regressionBytes)} KB regression above the payload ` +
        `${blind.length === 1 ? 'it governs' : 'they govern'}:`,
    );
    prose.push(
      `A ceiling that far above today's measurement cannot tell "no regression" from a repeat ` +
        `of objectui#5266 — its green tick carries no information, which makes this a verdict ` +
        `about the GAUGE and not about the bundle (objectui#5924: an aggregate ceiling at 8.6x ` +
        `passed a demonstrated +154 KB eager regression).\n` +
        `The payload almost certainly SHRANK, which is good news — and good news is RE-PINNED ` +
        `deliberately, never inferred: lower the named constant, move its baseline with it in ` +
        `the same commit, and say in the PR what the new headroom is.\n` +
        `⛔ Never lower a ceiling BELOW the measured figure to express an aspiration. A ceiling ` +
        `under today's reality lands red on \`main\`, which is how a budget gets switched off ` +
        `rather than met.`,
    );
  }

  if (headlines.length > 0) {
    return {
      sites: rows,
      blind: blind.map((row) => row.key),
      status: 'error',
      // One table, however many verdicts named it: a reader comparing two
      // renderings of the same five rows is reading for differences that are
      // not there.
      message: `${headlines.join('\n')}\n${table}\n${prose.join('\n')}`,
    };
  }

  return {
    sites: rows,
    blind: [],
    status: 'pass',
    message:
      `Ceiling sensitivity (${rows.length} ceilings, each weighed against the report just read):\n` +
      `${table}`,
  };
}

/**
 * The constants a verdict from this file is COMPUTED FROM — the three the three
 * evaluators above take as their defaults, and no others.
 *
 * {@link BASELINE} and {@link PER_CHUNK_BASELINE} are deliberately absent. They
 * record the measurements the ceilings were derived from and are read by the
 * unit test and by a human; no verdict depends on them. Listing them here would
 * make a baseline-only or comment-only edit on the base branch read as a
 * superseded ceiling, and a freshness check that cries wolf is one people learn
 * to click past.
 */
export const VERDICT_CEILING_CONSTANTS = Object.freeze([
  'MAX_EAGER_CLOSURE_GZIP_BYTES',
  'PER_CHUNK_GZIP_CEILINGS',
  'REGRESSION_THIS_GATE_MUST_CATCH_BYTES',
]);

/**
 * Read one `export const NAME = ...;` initializer out of module SOURCE TEXT,
 * with comments dropped and formatting normalised.
 *
 * Text, not values, because the two sides of the freshness comparison are this
 * file at two different commits and only one of them can be imported: the other
 * is a blob from the base branch. Comparing `89 * 1024` against `91136` would
 * be comparing an expression with an evaluation, so both sides are read the
 * same way — through this function — and a difference means a difference.
 *
 * What normalisation deliberately erases, because none of it moves a ceiling:
 * comments, line breaks and indentation, trailing commas, and the `_` numeric
 * separators (`3_345_000` and `3345000` are the same number). What it keeps is
 * everything else, so a changed digit is a changed ceiling.
 *
 * @param {string} source
 * @param {number} from index just past the `=`
 * @returns {string | null} the normalised initializer, or null if unterminated
 */
function readInitializer(source, from) {
  let depth = 0;
  const out = [];
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    const pair = source.slice(i, i + 2);
    if (pair === '//') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out.push(' ');
      continue;
    }
    if (pair === '/*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) return null;
      i = end + 2;
      out.push(' ');
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const literal = readStringLiteral(source, i);
      if (literal === null) return null;
      out.push(literal.text);
      i = literal.end;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ';' && depth === 0) return normaliseDeclaration(out.join(''));
    out.push(ch);
    i += 1;
  }
  return null;
}

/** @param {string} source @param {number} start index of the opening quote */
function readStringLiteral(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) return { text: source.slice(start, i + 1), end: i + 1 };
    i += 1;
  }
  return null;
}

/** @param {string} text */
function normaliseDeclaration(text) {
  return text
    .replace(/(\d)_(?=\d)/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/,(\s*[}\])])/g, '$1')
    .trim();
}

/**
 * Pull the {@link VERDICT_CEILING_CONSTANTS} declarations out of module source.
 *
 * A name this cannot find goes in `missing` and is an ERROR upstream, never a
 * skipped comparison: "I could not read the ceiling" and "the ceiling agrees"
 * are the two answers a freshness check must never confuse, and only one of
 * them is safe to be quiet about.
 *
 * @param {string | null | undefined} source
 * @param {readonly string[]} [names]
 * @returns {{ declarations: Map<string, string>, missing: string[] }}
 */
export function extractCeilingDeclarations(source, names = VERDICT_CEILING_CONSTANTS) {
  const declarations = new Map();
  const missing = [];
  const text = typeof source === 'string' ? source : '';
  for (const name of names) {
    const anchor = new RegExp(`^export const ${name}\\s*=`, 'm').exec(text);
    const initializer = anchor === null ? null : readInitializer(text, anchor.index + anchor[0].length);
    if (initializer === null || initializer === '') {
      missing.push(name);
      continue;
    }
    declarations.set(name, initializer);
  }
  return { declarations, missing };
}

/**
 * The FOURTH half: is the ceiling this run weighed against still the ceiling in
 * force on the base branch? (objectui#6245)
 *
 * ## The race
 *
 * A `pull_request` run checks out the MERGE REF — a merge of the PR head with
 * the base branch as GitHub last computed it. GitHub does not re-run a PR's
 * checks when the base branch moves, so a green verdict can be computed against
 * ceiling constants that `main` has since replaced, and what this job then
 * publishes is a verdict about a ceiling that no longer exists.
 *
 * ## This check's blocking power — and ⛔ what is NOT claimed about it
 *
 * This paragraph, and seven more across this file, its test and
 * `.github/workflows/performance-budget.yml`, used to open by classifying
 * `Bundle Analysis` against the branch-protection set (objectui#9155). ⛔ No
 * sentence here does that any more, in either direction. That set is not
 * readable from inside a checkout — AGENTS.md says so — so neither the claim
 * nor its negation can be re-derived by a reader, and a classification nobody
 * can re-derive drifts silently while nothing goes red: the same shape as the
 * stale figures objectui#7528 and objectui#8964 each caught one column over.
 * ⛔ The retired sentence is not quoted back here either, for the reason the
 * objectui#8964 note gives — a reader cannot tell a quotation from a claim. It
 * lives in the card.
 *
 * Two readings the tree DOES answer, cited rather than restated:
 *
 *   - `scripts/dependabot-merge-gate.mjs` lists `Bundle Analysis` under
 *     `OPTIONAL_CONTEXTS`, and spells its own reason there: this workflow
 *     filters at the TRIGGER, so the check is simply absent on a pull request
 *     touching none of those paths. Read that constant's docblock for what the
 *     classification governs and what it does not — it is that gate's own
 *     admission rule for Dependabot merges, ⛔ not a mirror of branch
 *     protection, and its header says which in as many words.
 *   - `.github/workflows/performance-budget.yml` subscribes `push` and
 *     `pull_request` and nothing else: there is no `merge_group` leg in its
 *     `on:` block, so this job cannot hold the merge queue the way `Lint` can.
 *     Re-derive it by reading that block; that workflow's job-ceiling comment
 *     already did, and disagreed with the sentence four lines above itself.
 *
 * ⚠️ Neither reading weakens the race above, which is why they are stated here
 * rather than the sentence simply deleted: `OPTIONAL_CONTEXTS` membership means
 * present ⇒ must be `success`, absent ⇒ ignored, so this check is blocking
 * WHENEVER IT RUNS on either reading — and a stale green is exactly a run that
 * happened. The freshness half below is owed on the measurement, ⛔ never on the
 * classification.
 *
 * Observed live rather than reasoned about: run 32804357171 started at
 * 03:13:27Z, six minutes and fifty seconds after `0409b766d` lowered
 * {@link MAX_EAGER_CLOSURE_GZIP_BYTES} from 4,086,000 to 3,345,000 on `main`,
 * and published `BUDGET_CLOSURE_BUDGET_KB: 3990.2` — 4,086,000 bytes, the
 * retired ceiling — with `conclusion: success`. It did not bite: the payload was
 * 3222.6 KB, under both numbers. What bounds how much the NEXT one could hide is
 * the aggregate headroom in force, which `pnpm check:eager-closure` prints and
 * this comment deliberately does not restate: the figure that stood here was two
 * re-baselines out of date (objectui#7518).
 *
 * ## Why THREE readings and not two
 *
 * Comparing this checkout's ceilings against the base branch's is not enough: a
 * re-baseline PR differs from the base branch ON PURPOSE, and failing it would
 * make the one PR that must land unlandable. So the question is not "do they
 * differ" but "did the BASE BRANCH move them out from under this checkout":
 *
 *   - `prBaseSource` — the checker at the base commit this checkout was
 *     computed from. What the base branch said when the merge ref was made.
 *   - `baseSource` — the checker at the base branch tip right now. What the
 *     merge would actually land on.
 *   - `headSource` — the checker in this checkout. What the verdict used.
 *
 * A ceiling is SUPERSEDED when it moved between the first two AND this checkout
 * does not carry the move. A re-baseline PR moves it in `headSource` only, the
 * first two agree, and nothing fires.
 *
 * ## Why `error` (exit 2) and not `fail`
 *
 * `fail` is a verdict about the BUNDLE — it grew past a line. Nothing has grown
 * here and no ceiling has drifted; the measurement above is sound and the
 * ceilings on the base branch are sound. What is wrong is that they were never
 * weighed against each other. That is a verdict about the GAUGE, which is what
 * exit 2 means in this file, and the message says so in as many words — a
 * freshness failure that reads like "the bundle grew" would send its reader
 * hunting a regression that is not there.
 *
 * ## What this closes, and what it does not
 *
 * It closes the window this card recorded: a run that EXECUTES after the
 * constants move, with a checkout that predates it. It cannot close the window
 * where the run finishes BEFORE the constants move and the PR is merged after —
 * no code of ours runs at that moment. That residual is what the `push`-on-main
 * run detects after the fact, and closing it needs "require branches to be up to
 * date before merging", a repository setting and a maintainer-floor decision
 * this file has no business making.
 *
 * @param {object} input
 * @param {string} [input.eventName]     `GITHUB_EVENT_NAME`
 * @param {string | null} [input.headSource]     this checkout's copy of this file
 * @param {string | null} [input.prBaseSource]   this file at the checkout's base commit
 * @param {string | null} [input.baseSource]     this file at the base branch tip
 * @param {string} [input.prBaseSha]
 * @param {string} [input.baseSha]
 * @param {string} [input.baseRef]
 * @returns {{ status: 'pass' | 'error' | 'not-applicable', message: string,
 *             moved: string[], superseded: string[] }}
 */
export function evaluateCeilingFreshness({
  eventName,
  headSource,
  prBaseSource,
  baseSource,
  prBaseSha,
  baseSha,
  baseRef,
} = {}) {
  const base = { moved: [], superseded: [] };
  const branch = baseRef ? `\`${baseRef}\`` : 'the base branch';

  // A `push` run's checkout IS the branch being weighed, and a local run has no
  // merge to gate. Neither can hold a superseded ceiling, so neither gets a
  // verdict — this half exists for the merge ref and nothing else.
  if (eventName !== 'pull_request') {
    return {
      ...base,
      status: 'not-applicable',
      message:
        `Ceiling freshness: not applicable to a ${eventName ? `\`${eventName}\`` : 'local'} run. ` +
        `This check compares a pull_request merge ref against the branch it would land on; a ` +
        `checkout that IS that branch cannot be behind it.`,
    };
  }

  const absent = [
    prBaseSource ? null : 'EAGER_CLOSURE_PR_BASE_SOURCE',
    baseSource ? null : 'EAGER_CLOSURE_BASE_SOURCE',
  ].filter((name) => name !== null);
  if (absent.length > 0) {
    return {
      ...base,
      status: 'error',
      message:
        `Ceiling freshness cannot be judged on this pull_request run: ${absent.join(' and ')} ` +
        `named no readable file.\n` +
        `Those are exported by the \`Resolve the base-branch ceiling constants\` step in ` +
        `.github/workflows/performance-budget.yml; on a pull_request run their absence means ` +
        `that step did not complete, NOT that the ceilings agree.\n` +
        `An unreadable base branch is an ERROR and never a quiet pass: from inside this ` +
        `checkout a superseded ceiling looks exactly like a current one.`,
    };
  }

  const sides = /** @type {[string, string | null | undefined][]} */ ([
    ['this checkout', headSource],
    ['the base commit this checkout was made from', prBaseSource],
    [`the ${baseRef ? `\`${baseRef}\`` : 'base branch'} tip`, baseSource],
  ]);
  const read = sides.map(([label, source]) => ({ label, ...extractCeilingDeclarations(source) }));
  const unreadable = read.filter((side) => side.missing.length > 0);
  if (unreadable.length > 0) {
    return {
      ...base,
      status: 'error',
      message:
        `Ceiling freshness cannot be judged — the ceiling declarations could not be located:\n` +
        unreadable
          .map((side) => `  - in ${side.label}: ${side.missing.map((n) => `\`${n}\``).join(', ')}`)
          .join('\n') +
        `\nBoth sides are read by \`extractCeilingDeclarations\`, which looks for ` +
        `\`export const NAME = ... ;\` at the top level of this file. A name it cannot find has ` +
        `been renamed, moved, or reshaped — re-point VERDICT_CEILING_CONSTANTS at the ceilings ` +
        `the verdict is now computed from. It is an error rather than a skipped comparison for ` +
        `the same reason an absent budgeted chunk is: a check that weighs nothing passes forever.`,
    };
  }

  const [head, prBase, current] = read.map((side) => side.declarations);
  const moved = [...VERDICT_CEILING_CONSTANTS].filter(
    (name) => prBase.get(name) !== current.get(name),
  );
  const superseded = moved.filter((name) => head.get(name) !== current.get(name));

  if (superseded.length === 0) {
    return {
      ...base,
      moved,
      status: 'pass',
      message:
        moved.length === 0
          ? `Ceiling freshness: all ${VERDICT_CEILING_CONSTANTS.length} ceiling constants are ` +
            `unchanged on ${branch} since this checkout's base${baseSha ? ` (${baseSha})` : ''}, ` +
            `so the verdicts above were weighed against the ceilings actually in force.`
          : `Ceiling freshness: ${moved.map((n) => `\`${n}\``).join(', ')} moved on ${branch} ` +
            `since this checkout's base, and this checkout already carries the new ` +
            `value${moved.length === 1 ? '' : 's'} — the verdicts above are current.`,
    };
  }

  const table = superseded
    .map(
      (name) =>
        `  ❌ ${name}\n` +
        `       weighed here : ${head.get(name)}\n` +
        `       in force now : ${current.get(name)}`,
    )
    .join('\n');

  return {
    moved,
    superseded,
    status: 'error',
    message:
      `${superseded.length} ceiling constant${superseded.length === 1 ? '' : 's'} this run ` +
      `weighed against ${superseded.length === 1 ? 'has' : 'have'} been SUPERSEDED: ${branch} ` +
      `moved ${superseded.length === 1 ? 'it' : 'them'} after this checkout was made` +
      `${prBaseSha && baseSha ? ` (${prBaseSha} -> ${baseSha})` : ''}, and nothing re-ran the ` +
      `verdicts above.\n${table}\n` +
      `⛔ NOTHING GREW. This is not a size regression and it is not a drifted ceiling: the ` +
      `measurement above is sound, and so are the ceilings on ${branch}. The only thing wrong is ` +
      `that they were never weighed against each other, so a green tick here would gate the ` +
      `merge on a ceiling that no longer exists (objectui#6245).\n` +
      `Fix: update this branch onto ${branch} — merge or rebase — and let Bundle Analysis run ` +
      `again. ⛔ Do NOT widen a ceiling to clear this; re-baselining is a separate, deliberate ` +
      `act and this run has no evidence for one.`,
  };
}

/**
 * The biggest eager chunks, so a failure names suspects instead of a total.
 * @param {{ files?: { fileName: string, gzipBytes: number }[] }} report
 * @param {number} [limit]
 */
export function renderTopChunks(report, limit = 12) {
  const files = [...(report?.files ?? [])].sort((a, b) => b.gzipBytes - a.gzipBytes).slice(0, limit);
  return files.map((f) => `  ${kb(f.gzipBytes).padStart(9)} KB  ${f.fileName}`).join('\n');
}

/**
 * Read a source file for {@link evaluateCeilingFreshness}, or null when the
 * path is absent or unreadable. Null is never "the same as" — it routes to a
 * loud ERROR upstream.
 * @param {string | undefined} sourcePath
 */
export function readSource(sourcePath) {
  if (!sourcePath) return null;
  try {
    return fs.readFileSync(sourcePath, 'utf8');
  } catch {
    return null;
  }
}

/** @param {string} reportPath */
export function readReport(reportPath) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every status the halves are declared to produce, and the only ones
 * {@link foldHalfStatuses} knows how to weigh.
 *
 * DERIVED, not invented: it is the union of the `@returns` unions above —
 * {@link evaluateClosureBudget}, {@link evaluatePerChunkBudgets} and
 * {@link evaluatePerChunkMembership} (`pass | fail | error`),
 * {@link evaluateHeadroomSensitivity} (`pass | error`), and
 * {@link evaluateCeilingFreshness} (`pass | error | not-applicable`). `scripts/__tests__/` re-derives that union
 * from this file's own text and reds when the two disagree, so a half that
 * gains a FIFTH status cannot gain it without also being given a code here.
 * That test is the reason this list may be written down at all (AGENTS.md #9):
 * an instrument re-derives it.
 */
export const RECOGNISED_HALF_STATUSES = Object.freeze([
  'pass',
  'fail',
  'error',
  'not-applicable',
]);

/**
 * Folds the halves' verdicts into one exit code, and names every half whose
 * status this file does not recognise.
 *
 * objectui#9006 — the fold this replaces enumerated only the statuses that
 * FAIL (`includes('error')`, then `includes('fail')`) and returned `0` for
 * everything else. `pass` and `not-applicable` were meant to land there; a
 * status NOBODY enumerated landed there too, while the printer above — which
 * asks a different question, `status === 'pass'` — rendered that same value as
 * ❌. A run could print a red cross and exit 0.
 *
 * ⛔ The repair is a DISTINCTION, not a tightening. Nothing that exists today
 * moves: `pass` → 0, `fail` → 1, `error` → 2, and `not-applicable` stays
 * exactly as INERT as the paragraph below says it must be — it is the absence
 * of a question, not the answer `pass`, and it still contributes nothing.
 * Only the unrecognised class changes, from silence to 2.
 *
 * WHY 2, AND WHY NOT A `throw`. Both were on the table (objectui#9006 lists
 * four candidate shapes); the measurement that decides between them is what
 * Node does with an uncaught exception:
 *
 *   - An uncaught `throw` exits Node with **1** — this file's "over budget"
 *     code. A gauge that produced nothing would then be reported as a size
 *     regression, which is the exact collapse the paragraph below refuses. A
 *     `throw` is not louder; in the only unit a workflow reads, it is
 *     MIS-LABELLED. It would also break `main`'s contract of RETURNING a code,
 *     which both this file's entrypoint (`process.exit(main())`) and every
 *     caller in the test file depend on.
 *   - `2` is this file's own "no trustworthy verdict" code, and an
 *     unrecognised status is precisely a check that measured nothing. The rule
 *     stated below — a check that passes by measuring nothing must be LOUDER
 *     than one that fails by measuring something, never quieter — is satisfied
 *     by the ordering that already exists, rather than by inventing a rank
 *     outside it.
 *
 * @param {Record<string, string>} halves  half name -> the status it declared
 * @returns {{ code: number, unrecognised: { half: string, status: string }[] }}
 *          `code` is 0, 1 or 2; `unrecognised` is empty on every run whose
 *          halves all declared a recognised status.
 */
export function foldHalfStatuses(halves) {
  const entries = Object.entries(halves);
  const unrecognised = entries
    .filter(([, status]) => !RECOGNISED_HALF_STATUSES.includes(status))
    .map(([half, status]) => ({ half, status }));

  // Ahead of the `error` test on purpose. Both return 2, so the ORDER cannot
  // change an exit code — what it changes is whether the caller is told. A
  // sibling half erroring in the same run must not be allowed to absorb the
  // one signal that a status nobody enumerated exists at all.
  if (unrecognised.length > 0) return { code: 2, unrecognised };

  const statuses = entries.map(([, status]) => status);
  if (statuses.includes('error')) return { code: 2, unrecognised };
  return { code: statuses.includes('fail') ? 1 : 0, unrecognised };
}

/** Appends `name=value` lines to $GITHUB_OUTPUT when running in Actions. */
function writeGithubOutput(entries, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  const lines = Object.entries(entries).map(([k, v]) => `${k}=${v}\n`);
  fs.appendFileSync(outputPath, lines.join(''));
}

/**
 * Exit codes: `0` within budget and in place, `1` over budget — the aggregate
 * ceiling or any per-chunk ceiling — or a budgeted package that landed outside
 * the chunk the console config declares for it (objectui#9345), and `2` no
 * trustworthy verdict (report missing,
 * stale-shaped, internally inconsistent, missing a budgeted chunk, governed by
 * a ceiling that has drifted out of range of the regression it must catch, or
 * — objectui#6245 — weighed against a ceiling the base branch has since
 * replaced).
 *
 * ⛔ A ceiling with almost no headroom LEFT is no longer one of them. It was,
 * between objectui#8554 and objectui#10148, and the maintainer ruling that
 * retired it is recorded in the RETIRED block above `SUPPORTED_REPORT_VERSION`.
 * ⇒ a chunk that goes OVER its ceiling still exits 1; a chunk that merely sits
 * close to one exits 0 with its headroom printed.
 *
 * The last of those is the one exit 2 case with a PERFECTLY GOOD measurement
 * behind it, so nothing downstream may word exit 2 as "nothing was measured".
 *
 * `2` covers the unbuilt tree, and deliberately so: with no
 * `apps/console/dist/eager-closure.json` this check reports a BROKEN GAUGE and
 * the workflow fails the step. It never prints a verdict about a bundle nobody
 * weighed, and it never exits 0 having measured nothing.
 *
 * EVERY half is evaluated and printed before any of them decides the code: a
 * run that reports the total and hides which chunk moved (or hides whether
 * either line still means anything, or whether the line it used is the line in
 * force, or whether the budgeted chunks still hold what they are named for)
 * teaches readers to ignore the half they cannot see.
 */
export function main(argv = process.argv.slice(2), env = process.env) {
  const flagIndex = argv.indexOf('--report');
  const reportPath = flagIndex === -1 ? DEFAULT_REPORT_PATH : argv[flagIndex + 1];
  const resolved = path.resolve(reportPath);
  const report = readReport(resolved);
  const result = evaluateClosureBudget({ report, reportPath });
  const perChunk = evaluatePerChunkBudgets({ report, reportPath });
  // The fifth half reads a DIFFERENT artifact — `chunk-membership.json`, from
  // the same build — because it asks a question `eager-closure.json` carries no
  // field for: WHERE a budgeted group's declared packages landed, counted over
  // every emitted chunk rather than the eager closure alone (objectui#9345).
  const membershipPath = path.join(path.dirname(resolved), MEMBERSHIP_REPORT_FILE_NAME);
  const membership = evaluatePerChunkMembership({
    membership: readMembershipReport(membershipPath),
    // The SAME build's eager closure, by chunk name — needed only to admit a
    // carve-out into a chunk no ceiling governs, which is admissible only while
    // that chunk stays out of the closure. `null` when the report is unreadable,
    // and the half then refuses such a carve-out rather than assuming it lazy.
    eagerChunkNames: Array.isArray(report?.files)
      ? report.files.map((/** @type {{ name?: unknown }} */ file) => String(file?.name ?? ''))
      : null,
    reportPath: membershipPath,
  });
  const sensitivity = evaluateHeadroomSensitivity({ report, reportPath });
  // The fourth half asks about the CEILING rather than the payload, so its
  // inputs are source texts and not the report: this file as checked out,
  // and this file at two commits on the base branch. See
  // {@link evaluateCeilingFreshness}.
  const freshness = evaluateCeilingFreshness({
    eventName: env.GITHUB_EVENT_NAME,
    headSource: readSource(fileURLToPath(import.meta.url)),
    prBaseSource: readSource(env.EAGER_CLOSURE_PR_BASE_SOURCE),
    baseSource: readSource(env.EAGER_CLOSURE_BASE_SOURCE),
    prBaseSha: env.EAGER_CLOSURE_PR_BASE_SHA,
    baseSha: env.EAGER_CLOSURE_BASE_SHA,
    baseRef: env.EAGER_CLOSURE_BASE_REF,
  });

  if (result.status === 'pass') {
    console.log(`✅ ${result.message}`);
  } else {
    console.error(`❌ ${result.message}`);
  }
  if (perChunk.status === 'pass') {
    console.log(`✅ ${perChunk.message}`);
  } else {
    console.error(`❌ ${perChunk.message}`);
  }
  if (membership.status === 'pass') {
    console.log(`✅ ${membership.message}`);
  } else {
    console.error(`❌ ${membership.message}`);
  }
  if (sensitivity.status === 'pass') {
    console.log(`✅ ${sensitivity.message}`);
  } else {
    console.error(`❌ ${sensitivity.message}`);
  }
  // `not-applicable` is printed rather than skipped. A half that says nothing
  // is indistinguishable from a half that was switched off, and this file's
  // whole argument is that silence must never read as a pass.
  if (freshness.status === 'pass') {
    console.log(`✅ ${freshness.message}`);
  } else if (freshness.status === 'not-applicable') {
    console.log(`ℹ️  ${freshness.message}`);
  } else {
    console.error(`❌ ${freshness.message}`);
  }
  if (report?.files?.length) {
    console.log('');
    console.log('Largest eagerly loaded chunks (gzipped):');
    console.log(renderTopChunks(report));
  }

  writeGithubOutput({
    closure_status: result.status,
    closure_gzip_kb: result.gzipBytes === null ? '' : kb(result.gzipBytes),
    closure_budget_kb: kb(result.budgetBytes),
    closure_chunks: result.chunkCount === null ? '' : String(result.chunkCount),
    closure_chunk_status: perChunk.status,
    closure_membership_status: membership.status,
    closure_headroom_status: sensitivity.status,
    // Empty on a run this half does not apply to, so the PR comment's half
    // table filters it out instead of rendering a blank verdict as a row.
    closure_freshness_status: freshness.status === 'not-applicable' ? '' : freshness.status,
    // `env`, not `process.env`: every other input this function reads comes from
    // the injected environment, and a default that reaches around it would make
    // the outputs untestable through the same seam as the verdicts.
  }, env.GITHUB_OUTPUT);

  // Distinct codes so the workflow can tell "over budget" (a real verdict about
  // the bundle) from "the gauge produced nothing" (a verdict about the gauge).
  // Collapsing them to 1 would let a broken report be reported as a size
  // regression, and a size regression reported as a broken report — each of
  // which teaches readers to ignore the other.
  //
  // `error` outranks `fail` across ALL FOUR halves for the same reason it does
  // within one: a report that cannot be trusted — or a ceiling that no longer
  // measures the thing it names, or that is no longer the ceiling in force —
  // makes its own size verdict meaningless, whichever half noticed first.
  // objectui#5490 established that ordering over two halves; objectui#5924
  // added the third and objectui#6245 the fourth, each under the same rule
  // rather than taking a code of its own. `not-applicable` is inert in the
  // fold: it is the absence of a question, not the answer `pass`.
  //
  // objectui#9006 — the fold itself lives in {@link foldHalfStatuses}, which
  // recognises those four statuses BY NAME and refuses to weigh any other. The
  // halves are passed as a NAMED map rather than an array so the refusal can
  // say which half produced the status nobody enumerated.
  const { code, unrecognised } = foldHalfStatuses({
    closure: result.status,
    'per-chunk': perChunk.status,
    membership: membership.status,
    sensitivity: sensitivity.status,
    freshness: freshness.status,
  });
  for (const { half, status } of unrecognised) {
    // A ❌, matching what the printer above already rendered for this value:
    // the two predicates now agree, which is the whole of objectui#9006.
    console.error(
      `❌ The \`${half}\` half declared an UNRECOGNISED status ${JSON.stringify(status)}, ` +
        `so this run has no verdict to give and exits 2 rather than 0.\n` +
        `Recognised statuses are ` +
        `${RECOGNISED_HALF_STATUSES.map((s) => `\`${s}\``).join(', ')}. A half that gained a ` +
        `fifth one must be given a code in RECOGNISED_HALF_STATUSES and in foldHalfStatuses — ` +
        `until it is, this gate refuses to read its silence as a pass.`,
    );
  }
  return code;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
