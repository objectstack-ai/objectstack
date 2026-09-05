#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * pm instruction-surface line ratchet (#7341 item 1, #5925 item 7; per-file
 * extension #8700) — shrink-only ceilings on every file the PM protocol and
 * the dev-agent definition are made of.
 *
 *   node scripts/pm/check-skill-line-ratchet.mjs               # the gate
 *   node scripts/pm/check-skill-line-ratchet.mjs --self-test   # verify the checker
 *
 * ## Why ceilings
 *
 * `.claude/skills/pm-dispatch/SKILL.md` is read in full by every seat session
 * and every Routine fire. It reached 3,013 lines (~235 KB) before #7341's
 * extraction, and 2,568 before the #7885 principles-only rewrite (maintainer
 * ruling 2026-08-12: 「现有的项目经理 skills 应该大幅简化,只需要说原则,不需要
 * 写细节」) landed it at its current ceiling. The ratchet held it at 0% growth
 * — while the UN-ratcheted references/ and os-dev.md grew +31% in one shift
 * (maintainer ruling 2026-08-14: 「8685 字太多了 并且综合审查一下相关的skills是
 * 不是应该压缩字数。」). So the ceiling now covers the whole surface, per file:
 * the main file carries principles; references/ carries on-demand detail
 * (provenance is one line; stories live on cards, not in operational text);
 * incident case law lives in git history (issue-ID dereference is deprecated —
 * see check-skill-id-lint.mjs). Without a gate that intent erodes one
 * well-meaning paragraph at a time.
 *
 * ## What is covered — and the published catalog, which deliberately is not
 *
 * "The whole surface" above means the CEILINGS map below, which is an
 * ENUMERATION, never a root glob: the pm-dispatch surface (SKILL.md, its
 * references/, the per-lane job descriptions), the four other
 * `.claude/skills/` playbook SKILL.md files, the dev-agent definition
 * `.claude/agents/os-dev.md`, and both root instruction files — `AGENTS.md`
 * and `CLAUDE.md`. Read a file's absence from the map as a fact to check, not
 * an oversight to infer — `.claude/hooks/` and `.claude/settings.json` carry no
 * ceiling.
 *
 * The **published** `skills/` catalog — the one that ships to customer projects
 * — is deliberately OUTSIDE the ceiling. It is the omission worth stating
 * because it is by far the larger surface: eleven published SKILL.md totalling
 * ~10,400 lines, against ~3,700 covered here. Two reasons, both about the cost
 * curve the ratchet prices rather than about size (#9923):
 *
 *   - What the ratchet prices is a full-file token read paid PER SEAT SESSION
 *     and PER ROUTINE FIRE, which is what every covered file above costs. The
 *     published catalog is read by customer projects, not by this repo's seats
 *     — a different cost curve, and not the one this gate was built against.
 *   - The published catalog is already a governed, human-merge-only surface
 *     (Prime Directive #14), so growth there passes a human eye by
 *     construction — a control a ratchet would merely duplicate. Note this
 *     reason does not separate the two roots by itself: the covered files are
 *     governed at merge too. What no reviewer prices THERE is the recurring
 *     per-session read of reason one, which is why they still carry ceilings
 *     and the published catalog does not.
 *
 * Extending coverage to the published root is therefore a POLICY CHANGE, not a
 * maintenance edit: it needs its own card and a maintainer's ruling, not a
 * CEILINGS row added in passing. The self-test pins this boundary, because
 * enforcement cannot — a published-root entry would run perfectly green.
 *
 * ## The ratchet discipline (shrink-only, per file)
 *
 *   - A ceiling may be LOWERED by any PR that shrinks its file — lowering is
 *     always legitimate and encouraged.
 *   - RAISING one requires a maintainer ruling quoted in the raising PR's body
 *     (the same evidence bar as Guardrails' `.claude/` tooling exception).
 *     A protocol change that would cross a ceiling pays its way by moving
 *     narrative out (SKILL.md → references/) or compressing in place, instead
 *     of raising the roof.
 *   - The headroom between a file's count and its ceiling is the budget for
 *     ordinary rule edits between compressions; it is deliberately small.
 *   - A same-PR CROSS-FILE MOVE is the one raise an author may take without a
 *     per-instance ruling — under the three conditions in the section below, and
 *     never as a way to grow the corpus.
 *
 * Missing file or empty read is RED, never a pass (#4690: a gate that cannot
 * find its input must fail, not skip).
 *
 * ## The one raise an author may take alone: a same-PR CROSS-FILE MOVE
 *
 * Maintainer ruling, 2026-09-03, adopting the measured option A of the skills
 * optimization programme's third decision batch — verbatim and untranslated:
 * 「同意」, and the adopted text in the ruling comment's own words, which every
 * declaration below cites as {@link RULING_CITATION}:
 *
 *   the per-file line ratchet admits a cross-file move in one PR when the
 *   destination's allowance rises by no more than the source's net decrease and
 *   total lines do not increase, with the ruling cited in the ratchet comment
 *
 * The defect it repairs is structural rather than a hardship claim: a FACT can
 * be in the wrong FILE. A per-repo gate reading written into one lane charter is
 * read by that lane and missed by the other six, and its single source is
 * `references/platform-readings.md`. Consolidating it there REDUCES the corpus —
 * one copy, one reader path — yet under a shrink-only per-file ceiling it was
 * impossible without a per-instance maintainer ruling, because the destination
 * sits at headroom 0 like every other entry. The ratchet was pricing a move as
 * though it were growth, and the file's own remedy sentence — move narrative out
 * rather than raise the roof — was the very act it could not price.
 *
 * ⛔ It is NOT a general raise, and it is not a re-wrap: deletion at the source
 * pays, restatement does not. Three conditions, all checked below against
 * {@link CROSS_FILE_MOVES}:
 *
 *   (a) the destination's raise is at most the NET DECREASE of the sources that
 *       move declares, per move;
 *   (b) the sum of ceilings over the whole map does not increase;
 *   (c) the raised entry declares the ruling that authorises it.
 *
 * ### What this gate can see, and what stays a reviewer's job
 *
 * The script reads the WORKING TREE and its own map. It never sees the PR diff,
 * so it cannot know that a raise happened at all, still less that a decrease
 * landed in the same PR. What it can do — and now does — is hold a DECLARED move
 * to its own arithmetic: every participant records the ceiling it carried BEFORE
 * the move, so the raise, the decreases and the map-wide total are computable
 * from the tree alone. Deterministic, hermetic, and available in a shallow CI
 * checkout — which is why the declaration is in-tree data and not a
 * `git show origin/main:<this file>` baseline diff. A baseline mode would read a
 * ref that a shallow clone need not have and that a sibling's fetch moves under
 * the run, and it would answer nothing at all once the move had landed.
 *
 * What stays with the reviewer is COMPLETENESS: that each recorded `was` is the
 * value on `origin/main`, and that no OTHER entry moved in the same PR. Both are
 * one `git diff` away in the raising PR and neither is inferable from a tree. It
 * is the bar this map has always used — every ceiling in it is an author's
 * number, read at review against the diff — so a declaration weakens nothing: it
 * is the first raise path here that a machine can check at all.
 *
 * ⚠️ (b) is belt and braces, not a second independent control. Over declarations
 * whose participants are disjoint — which {@link crossFileMoveTotalVerdict}
 * requires — it follows from (a) summed over the moves. It is written out
 * because it is the ruling's own wording, and because it is the condition that
 * would still be right if (a) were ever loosened.
 *
 * ### A move's raise and an ORDINARY ruled raise are separate quantities
 *
 * A destination does not stop being an ordinary ceiling once a move lands on it.
 * When the maintainer later raises it the ordinary way — the header's own exit, a
 * ruling quoted in the raising PR — that raise belongs to the RULING, not to the
 * move, and this declaration must not claim it. `was` is a single number, so the
 * first author to meet the case had one lever only: carry the destination's `was`
 * forward by the ruled amount, which keeps the move's arithmetic right while
 * making the field mean two things at once. Measured on the tree, with `was` left
 * at its literal pre-move value: the gate read the move as `314 → 358 = +44
 * against −11` and went red twice — condition (a) and the map-wide total — for
 * lines no source was ever asked to pay.
 *
 * So the two quantities are recorded separately. A declaration may carry
 * `ruledRaises`: one record per ordinary ruled raise taken on the destination
 * SINCE the move, each with the ruling's own words and its date, subtracted
 * before the move's own raise is measured. `was` goes back to meaning exactly one
 * thing — the destination's ceiling on the day the move landed — which is what
 * the reviewer's completeness check has always held it to, for the destination
 * and its sources alike.
 *
 * ⛔ The subtraction is the load-bearing risk, and it mirrors the one (a) already
 * guards: a record nobody ruled would license corpus growth under a move's
 * warrant, silently and for as long as the declaration stands. Two shape bars
 * answer it — a record quoting no ruling is RED, and so is a set of records
 * claiming more lines than the destination's ceiling actually stands above `was`,
 * which is what stops an inflated record from reading as PAID DOWN. Neither bar
 * can prove the maintainer said the words, and neither pretends to: that is the
 * same completeness check the reviewer already runs on every `was` here, and it
 * is why the bar is a QUOTATION rather than a flag an author may simply set.
 *
 *
 * ## The max-line-length rule (#11106) — what makes a LINE a unit again
 *
 * The ratchet counts LINES while the paragraph above prices a per-session token
 * read, and tokens track BYTES, not lines. The drift was measured, not inferred:
 * one PR added five fact entries to `references/platform-readings.md` and grew it
 * 16,953 → 22,559 bytes (+33%) at a flat 134/134 line count, green on every run,
 * no ceiling raised and nothing in this gate able to see it. A file whose lines
 * run 400–830 bytes lets an author add arbitrary content at zero measured cost,
 * while an author who wraps at 80 columns pays a line per 80 bytes — the
 * incentive points at the less readable spelling.
 *
 * Maintainer ruling 2026-08-23 (option B), verbatim and untranslated:
 * 「10950 不考虑存量,其他接受你的建议」 — a max-line-length rule on the
 * ceilinged files plus a one-off re-wrap of the legacy long lines, restoring the
 * proportionality the line count was always assumed to have. Deliberately NOT a
 * second ratchet (option A) and not a disclaimer in this header (option C).
 *
 * ### Why 120 bytes
 *
 * It is the corpus's OWN upper bound, not a new house style: measured over the
 * 4,028 lines of the map above, 34 land at exactly 120 bytes and both wrap styles
 * already present sit under it — ASCII prose wraps at ≤91 bytes (~88 columns),
 * CJK prose at ≤120 bytes (50–60 characters, ~100–120 display columns, a CJK
 * character being 3 bytes and 2 columns wide). 120 is the one number both
 * conventions already satisfy, so the rule codifies what the careful authors were
 * doing rather than reflowing the corpus to an invented width. Bytes — not
 * characters, not columns — because bytes is what the header prices.
 *
 * ### The exemptions live in the RULE, and are STRUCTURAL
 *
 * A length rule that can demand an ILLEGAL wrap is worse than no rule: it teaches
 * authors to break a table, split a fence, or — the sharpest case here — wrap a
 * 行锚定 directive line (`Blocked-by:` / `Restart-when:` / `Restart-touch:`),
 * whose entire contract is that a grep finds it ANCHORED AT A LINE. So every
 * exemption is derived from the line's own syntax, and there is deliberately NO
 * exemption registry and no per-file allowlist: a list of blessed long lines
 * would be precisely the ratchet-expanding remedy #8435 keeps out of an author's
 * reach, and it would rot. The exempt classes are {@link EXEMPTION_CLASSES}.
 *
 * `unbreakable` is the load-bearing one: the gate asks only for wraps it can
 * itself produce. {@link wrapLine} is the canonical form, and an over-long line
 * is RED exactly when re-wrapping it would change it. A bare URL, a long path or
 * a single long code span has no legal break point, so it comes back unchanged
 * and passes — the rule never asks for the impossible.
 *
 * Two of the classes are about what a WRAP COSTS rather than what markdown
 * allows, and both were found by running the re-wrap and reading what broke:
 * `blockquote` (a continuation must repeat `>`, so the wrap would insert a
 * non-whitespace byte into a quotation) and `quotation` (a 「…」 ruling that
 * already spans lines is left exactly as its author broke it — moving the break
 * moved a phrase across it and turned `check-skill-frame-sync` red). Both cost
 * the corpus a handful of long lines, and both are cheaper than a rule that
 * edits a verbatim maintainer ruling to satisfy itself.
 *
 * ### What a wrap may move, stated once
 *
 * ONLY whitespace: a space becomes a newline, or a newline is inserted between
 * two East Asian characters (a segment break there is removed by the CSS
 * segment-break transformation rules, which is why the corpus already wraps CJK
 * prose mid-run). No break is offered at a CJK↔Latin junction without a space,
 * because that one WOULD render as a space. That property is what let the one-off
 * re-wrap prove itself: every file compared byte-identical after whitespace
 * normalization, with its inline code spans identical in sequence.
 *
 * ### The junction that leaked (#12081), and why it is invisible in the source
 *
 * One junction escaped the paragraph above and had to be measured to be found: a
 * break directly after an ASCII `,` `;` `:` that follows a HAN character. It is
 * not a CJK↔Latin junction — both sides are Chinese — but the MARK between them
 * is a narrow byte, so the segment break is not between two wide characters and
 * renders as a space. 34 such breaks survived the #11106 re-wrap across 15
 * ratcheted files. ⚠️ The defect is invisible in the source and visible only in
 * the render, which is the inverse of the usual reading: a reviewer reads these
 * files as source, where the break looks like ordinary wrapping, while the space
 * exists only for the agent that reads the RENDERED text — and that is the whole
 * population these files are written for.
 *
 * ⭐ It is also SELF-CONCEALING under re-wrap, which is why the mechanism is
 * written down here rather than left to a PR body. Re-flowing such a paragraph
 * and re-wrapping it FAITHFULLY must PRESERVE the space (it is what the text
 * renders as), so the space migrates out of the line break and into a literal
 * `", "` in the source. It then looks like the re-wrap introduced a space. It did
 * not — it only made an existing render visible. Anyone auditing a re-wrap by eye
 * will reach the wrong conclusion here. {@link hanAsciiPunctTail} closes the
 * channel at its source by refusing to OFFER the break, so no future wrap has to
 * choose between preserving a defect and hiding it.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { isEntrypoint } from '../invoked-as.mjs';

const REPO_ROOT = new URL('../../', import.meta.url);

// Post-compression counts (#8700 one-time pass; SKILL.md keeps its #7885
// value). Shrink-only: lower freely, raise only with a maintainer ruling
// quoted in the raising PR (see header).
//
// ⚠️ RE-PINNED ONCE, WHOLESALE, BY #11106. Eighteen of these numbers moved in a
// single stroke and NONE of them is a content raise: the one-off re-wrap that
// landed the max-line-length rule above re-flowed 555 legacy over-long lines,
// and a line that used to hold 400–830 bytes is now three to seven lines holding
// the same bytes. Each file's content was proved byte-identical after whitespace
// normalization before its ceiling moved (per-file arithmetic in that PR's body).
// So the pre-#11106 numbers are not comparable to these, and reading a jump like
// 666 → 1,050 as slack would be exactly backwards — headroom is 0 on every one of
// them, and each line is now capped at 120 bytes, which is what makes the count
// track the token read the header prices. `landing-operations.md` moved the other
// way (82 → 80, its standing headroom locked in) and `state-machine.md`,
// `lanes/{engine,services,cli,skills}.md` and `CLAUDE.md` did not move at all —
// they were already within budget on every line.
export const CEILINGS = new Map([
  // Lowered 682 → 666 by the maintainer-ordered whole-text restructuring round
  // (ruling 2026-08-23, verbatim: 「接受你的重构提案」): the four long
  // state-table rows and the clause-② review-chain bullets sank to the two new
  // references below, and the report-contract JSON is single-sourced from the
  // dev-agent definition. Landed count, headroom 0, same convention.
  // Lowered 1008 → 1005 by the run-to-empty triage ruling (maintainer
  // 2026-08-25): the per-round 3–5-card budget and the `finding` >15
  // concentrated-round trigger both left the 发现分诊轮 paragraph, and the
  // ≤5-same-family batch convention that replaces them costs less than they
  // did. Landed count, headroom 0, same convention (lowering is always
  // legitimate).
  // Lowered 1005 → 811 by the rules-only rewrite (maintainer ruling: provenance
  // narratives, incident post-mortems and rationale tails leave the corpus; one
  // rule per ≤120-byte line, 红线 first, templates last). Landed count, headroom
  // 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/SKILL.md', 811],
  // Raised 223 → 244 by the triage reading-cost card (maintainer ruling
  // 2026-08-20, quoted in the raising PR): three mandated conventions land in
  // the runbook's triage sections. Landed count, headroom 0, same convention.
  // Lowered 244 → 243: the decision-analysis template entry became a pointer
  // to the reference file below (lowering is always legitimate).
  // Lowered 243 → 242 by the restructuring round: the stale hourly-fire
  // rationale clause collapsed into a pointer at contract-review.md.
  // 274 -> 278 (maintainer ruling, 2026-08-29, PM chat, verbatim: 「12813 同意」 — option A):
  // one ruling sized to the merged end-state of the three stacked PRs on this file. The +4 is
  // the measured residual of the ⑦-method section after compression to its reasoned floor and
  // real-deletion cuts were exhausted; re-wrap funding was refused per the 2026-08-17 rule.
  // 278 -> 280 (maintainer ruling, 2026-09-02, live PM chat with the director seat, replying to
  // decision batch #4 in which this card was item 2 — verbatim and untranslated:
  // 「13973 帮我综合分析，并参考主流平台的方案，并给我解释为什么不能都用日期类型。其他同意」
  // — 「其他同意」 adopts option A): the stop-condition bullet becomes the MERGED bullet, carrying the
  // executability criterion — a fence clause is executable by a one-shot dev only if the action it
  // demands is TERMINAL within the run — plus the two executable rewrite forms, so neither can be
  // copied without the other. Prose, never a table row: the widest-table-row pin below stays at 0,
  // which is what forecloses the compact two-row table the card and its triage both used. Funding
  // the growth by deleting sibling rationale was refused by the same ruling (option D). Landed
  // count, headroom 0, same convention.
  // Lowered 280 → 241 by the rules-only rewrite of the seven core references
  // (maintainer ruling: provenance narratives, incident post-mortems and rationale
  // tails leave the corpus; one rule per ≤120-byte line, no rule already stated in
  // SKILL.md). Landed count, headroom 0, same convention (lowering is always
  // legitimate).
  ['.claude/skills/pm-dispatch/references/dispatch-runbook.md', 241],
  // Whole-text restructuring round (maintainer ruling 2026-08-23, Q1 = A):
  // mechanism detail extracted from SKILL.md — the four long state-table rows
  // (state-machine.md) and the clause-② review-chain operational detail
  // (contract-review.md). Set at landed line counts (headroom 0, same
  // convention as the entries above).
  // Raised 43 → 44 by the generated-artifact carve-out ruling (maintainer
  // 2026-08-25, verbatim: "files that are generator-owned outputs inside
  // `skills/**` are carved out of the governed-merge fork", with the follow-up
  // ordering "the exemption in `check-governed-merges.mjs` plus the one-line
  // state-machine doc note"). ONE line, and it could not be paid in place: the
  // file holds 34 content lines over 3,467 bytes, and every bullet is already
  // packed to its own minimum at the 120-byte cap (measured per bullet), so the
  // only in-place payment available was deleting a ruled clause. Landed count,
  // headroom 0 again, same convention.
  // Lowered 44 → 42 by the rules-only rewrite of the seven core references
  // (maintainer ruling: provenance narratives, incident post-mortems and rationale
  // tails leave the corpus; one rule per ≤120-byte line, no rule already stated in
  // SKILL.md). Landed count, headroom 0, same convention (lowering is always
  // legitimate).
  ['.claude/skills/pm-dispatch/references/state-machine.md', 42],
  // Raised 48 → 51 by the clause-② CONTENT-limb applicability ruling (maintainer
  // 2026-08-31, 第 6 场总监席决裁批 #12, verbatim 「同意」, adopting A + C: published
  // `skills/**` changes making a falsifiable operator/contract semantic claim fall
  // under the CONTENT limb, with the criterion narrowed to 「可证伪的语义主张」 and
  // NOT 「提到契约」). The ruling sizes it at 补一句 and it landed as three lines,
  // which could not be paid in place: the file's 41 content lines carry 577 bytes
  // of total slack under the 120-byte cap (mean width 105.9), so absorbing the
  // addition's 332 bytes without a new line means re-wrapping the whole file —
  // re-wrap funding is refused per the 2026-08-17 rule, exactly as on the
  // dispatch-runbook entry above — and the only other in-place payment available
  // was deleting a ruled clause, refused on the state-machine precedent. Landed
  // count, headroom 0 again, same convention.
  // Raised 51 → 57 by the in-seat contract-review rework (maintainer ruling
  // 2026-08-31, verbatim: 「项目经理是fable 或者可以派fable的子任务都可以自己
  // contract view吧?」— the clause-② release moves from the external review
  // chain to the dispatching seat). The judgment checklist, the context-isolated
  // fable review subagent and the chain's demotion to optional audit land HERE
  // so the ratcheted main file stays principles-only (it paid its own bullet
  // down to a pointer). Paid in place first: the wheel-ownership bullet, the
  // request-review clause and the standalone qualification bullet were deleted
  // or folded; the residual +6 could not be paid without deleting ruled clauses
  // (refused on the state-machine precedent). Landed count, headroom 0, same
  // convention.
  // Raised 57 → 60 by the clear-equals-land CRITERIA encoding — the 清标即落地
  // section gains the arm-precondition list it never carried: an in-seat at-tier
  // PASS on record, `needs:contract-review` cleared on BOTH carriers, and ALL of
  // the PR's checks green (never the required subset), with the per-pair
  // mechanical reading (`check-clause2-carriers --pair`) and its exit register,
  // and the governed-surface boundary restated as unchanged. The rule is the
  // 2026-08-31 director batch #17 ruling, verbatim and untranslated: 「同意」,
  // which ordered the text into THIS file and THIS section; the raise itself is
  // authorized by the maintainer on 2026-09-01, director decision batch A,
  // verbatim and untranslated: 「同意。」 — that ruling also chose the FULL
  // encoding over the 58-line bare minimum, so the two extra lines are ruled
  // content, not slack. Paid in place first: the downgrade-fuse bullet's
  // restatement of the served-tier READING collapsed to the platform-readings
  // pointer it already carried (4 lines → 3, 437 B → 353 B), the one real
  // deletion the surface had; the residual +4 could not be paid without deleting
  // a ruled clause, and the nearest candidates were the governed-surface
  // boundary and the terminal clause (refused on the state-machine precedent).
  // Landed count, headroom 0, same convention.
  // Raised 60 → 65 by the clause-② GRADING ruling — the criterion itself, which
  // this file carried nowhere: the claim-time `Clause-②: yes|no` declaration is
  // PROVISIONAL by design (it fixes the conservative dispatch tier; the real gate
  // is the at-tier review at PR/report time, where the evidence and the cost
  // live, and a declaration overturned there is the mechanism working, not a seat
  // fault); the mechanical floor (any NEW exported symbol or NEW key on an
  // already-published payload is always `yes`, checkable in the tree at claim
  // time); and the conformance class held back from mechanization (populating an
  // already-declared field, re-selecting an input class between two published
  // codes), which needs at-tier judgement and dispatches as `yes` when the claim
  // cannot tell — a false `yes` self-corrects, a false `no` ships. The full
  // taxonomy and the claim-time decision procedure are BOTH declined under the
  // startup-scope lens, and that refusal is itself ruled content here.
  // The ruling is the maintainer's, 2026-09-01, verbatim and untranslated:
  // 「同意」; it authorizes this raise in its own words, verbatim and
  // untranslated, in comment 5494466874:
  //   「若触行数天花板,按 #13900 裁决同型引用本评论提额」
  // Paid in place FIRST, and the payment is real deleted bytes, never a re-wrap:
  // the 放行 bullet's restated FAIL / 卡在决策 triple went (single source is
  // SKILL.md 条款②入队闸门, which this file's own header already points at), and
  // with it the 三样不变 clause — self-declared as 「单源见主文件」, and its
  // governed-surface limb survives in-file in 落地前检三条 (「受管面不适用,
  // draft-only 终局不变」). That bullet fell 6 lines → 4. Two further restatements
  // were measured and REJECTED as payment because a LINE ratchet cannot bank
  // them: 停靠短暂 in the 双载体 bullet (−45 B, 3 lines → 3) and 非放行必要条件
  // in the 外部评审链 bullet (−24 B, 4 lines → 4). The residual +5 is the ruled
  // addition at its reasoned floor — 773 bytes of ruled content is 7 lines at the
  // 120-byte cap, and no sixth-line spelling exists that keeps 不是出货缺陷, the
  // ruling's own justification for declining the taxonomy. Landed count, headroom
  // 0, same convention.
  // Raised 65 → 68 by the review-INDEPENDENCE carrier — the template half of
  // direction A, whose guard half (finding row C4 in
  // `check-clause2-carriers.mjs`) landed on its own and has been INERT ever
  // since, because no verdict on the board carries the two lines it compares.
  // The addition is one bullet in 复核归属与资格(席内): the verdict declares
  // `Implemented-by:` (the identity that produced the diff — a `mode:subagent`
  // dev's BRANCH, since a subagent has no session of its own, and a
  // `mode:remote` dev's session id) and `Reviewed-by:` (the reviewing seat's
  // session); the same session on both lines is a SELF-REVIEW and is not an
  // independent review, while a verdict carrying neither line stays silent
  // forever. Two rulings authorise it, both verbatim and untranslated. The
  // direction (maintainer, 2026-09-01, live session with the director seat):
  //   「同意 A」
  // and the raise itself together with the spelling reading (maintainer,
  // 2026-09-02, live PM chat, decision batch #12, adopting the recommendation
  // "(i) approve the raise, (ii) reading a"):
  //   「同意」
  // The 2026-09-02 batch #1 ruling 「14324 等我发版，其他同意」 authorised the
  // same raise on the branch that has since merged guard-only; ruling (i) above
  // re-issues it for THIS patch round, which is why the raise is not a seat's
  // own judgement about its own diff — the one act this card exists to record.
  // Paid in place FIRST, and the payment is not available: the file's 64 lines
  // hold 2,007 bytes of slack under the 120-byte cap (mean width 88.6), so the
  // 436 bytes of ruled addition would fit only by re-flowing the whole file —
  // re-wrap funding is refused per the 2026-08-17 rule, exactly as on the two
  // raises above — and the only other in-place payment is deleting a ruled
  // clause, refused on the state-machine precedent. The CROSS-FILE MOVE path
  // below does not apply either: no other ceilinged file holds this fact, so
  // there is no source deletion to pay with, and manufacturing one to dodge a
  // ruled raise would grow the corpus by exactly the same lines with the
  // warrant hidden. Landed count, headroom 0, same convention.
  // Lowered 68 → 60 by the rules-only rewrite of the seven core references
  // (maintainer ruling: provenance narratives, incident post-mortems and rationale
  // tails leave the corpus; one rule per ≤120-byte line, no rule already stated in
  // SKILL.md). Landed count, headroom 0, same convention (lowering is always
  // legitimate).
  ['.claude/skills/pm-dispatch/references/contract-review.md', 60],
  // Business-perspective decision-analysis writing guide (maintainer ruling
  // 2026-08-20: the four-facet analysis must argue from the business
  // standpoint). Set at landed line count (headroom 0, same convention).
  // Lowered 48 → 46 by the #12081 soft-break closure (lowering is always
  // legitimate): three of this file's measured Han+ASCII-punct breaks merged
  // back into their paragraphs, and two of the three paid for themselves.
  // Raised 46 → 54 by TWO same-day maintainer rulings on the decision frame,
  // both of which explicitly order their own encoding into the skills. Verbatim
  // and untranslated — the decision-batch presentation rule:
  //   「每批5张详细解释，不是这样一堆列给我，这个也要写入skills」
  // and the axis-weighting rule, whose card-face half lands here (its full
  // statement is in the frame's single source, SKILL.md 「升级与决策」, paid from
  // that file's existing headroom):
  //   「四维分析中，长期合理应该权重最高，至少50%」
  // +5 for the presentation teeth (exactly-5 / stop-and-wait / ⛔ multi-batch,
  // and the prose-per-card duty with its applicability boundary — presenting
  // items for a RULING, never already-decided result statements), +3 for the
  // weight floor with its two guards (read through axis ①'s own definition, so
  // it cannot underwrite speculative expansion; recommendation-only, so it
  // cannot move the human floor). Could not be paid in place: all 46 lines are
  // already packed to their own minimum at the 120-byte cap (measured per line
  // — the file was densified at phrase boundaries by #13389 and the widest
  // reflow saving available is zero), and re-wrap funding is refused per the
  // 2026-08-17 rule in any case; the only other in-place payment was deleting a
  // ruled clause, refused on the state-machine precedent. Landed count, headroom
  // 0 again, same convention.
  // Lowered 54 → 50 by the rules-only rewrite of the seven core references
  // (maintainer ruling: provenance narratives, incident post-mortems and rationale
  // tails leave the corpus; one rule per ≤120-byte line, no rule already stated in
  // SKILL.md). Landed count, headroom 0, same convention (lowering is always
  // legitimate).
  ['.claude/skills/pm-dispatch/references/decision-analysis.md', 50],
  // 134 → 133: whole-text restructuring round, PR-2 (maintainer ruling
  // 2026-08-23) — the three write-side sanitizer rows consolidated to one
  // author rule + one measured-behaviour row per surface (body / comment).
  // 133 → 130 (LOWERED, no ruling needed — shrinking is always legitimate):
  // the REST-default read-order flip (maintainer ruling 2026-08-23, 「1+2+3」)
  // consolidated the three channel-partition rows into two, and the per-
  // operation channel mapping moved out to references/rest-channel.md below.
  // The two right-sized-reads rows the same ruling ordered were paid from that
  // saving in place, and three lines came back. Headroom 0 again.
  // 314 → 324 by the CROSS-FILE MOVE the 2026-09-03 ruling authorises —
  // #14685 item 5 (comment 5520452691), declared in CROSS_FILE_MOVES below and
  // re-derived there on every run. Three misplaced per-repo facts consolidate
  // into the file that is their single source: the objectstack required-check
  // set with its `in_progress` and advisory boundaries (lanes/cli.md, −4), the
  // two aggregate-reading gate boundaries (lanes/services.md, −2), and the
  // merge_group count-is-not-a-mechanism tombstone (rest-channel.md, −5, moved
  // byte-identically). The per-job-conclusion rule the first of those carried
  // was NOT copied: this file already states it in 队列成员资格 above, so the
  // moved bullet points at it instead — a move that restated it would be paying
  // for a second copy. +10 against a net source decrease of 11, so the map's
  // total falls by one; that is the ruling's own condition and the reason this
  // is a move rather than a raise. Landed count, headroom 0, same convention.
  // Raised 324 -> 358 by the intake-family ruling — an ORDINARY raise under this
  // map's own maintainer exit, ⛔ not a cross-file move. Maintainer, live PM chat,
  // 2026-09-04, decision batch #27, verbatim and untranslated: 「同意」 on option A,
  // and the sentences that ruling adopts, in the director record's own words:
  //   the ceiling for `.claude/skills/pm-dispatch/references/platform-readings.md`
  //   is raised by the measured need, +34, to 358 — a named, sized raise under the
  //   ratchet's own maintainer exit … The +34 is a ceiling of the raise, not a
  //   target: if the eight readings land in fewer lines, the raise is the smaller
  //   number.
  // Spent in full, and measured per member by writing each reading and wrapping it
  // rather than estimating: chain head +5 (the page-walk 422 refusal at offset
  // ~9,900 and the asc + desc partition recipe), payload channel +5, search query
  // shape +3, channel envelope +6, merge-queue instrument +8, queue progress +2,
  // end-of-shift report +3, body repair +2 = +34 exactly. Could not be paid in
  // place: the deletions this file can offer were measured at 0 whole lines (~307
  // bytes spread over three bullets, none of them completing a line inside its own
  // bullet), and re-wrap funding is refused per the 2026-08-17 rule. Landed count,
  // headroom 0, same convention.
  // Raised 358 -> 397 by the third-increment ruling — again an ORDINARY raise
  // under this map's own maintainer exit, ⛔ not a cross-file move. Maintainer,
  // decision batch #34, 2026-09-04, verbatim and untranslated: 「决裁批 #34 同意」
  // on the presented recommendation, item 1 = A; the director record's own
  // sentence for that item: "raise the ceiling by the measured +39, 358 → 397".
  // Spent in full, and measured the same way — each member written in the file's
  // voice and wrapped by this module's own `wrapLine` rather than estimated:
  // attribution-footer scoping +12 (the row is true per CHANNEL and per
  // ACTION/INPUT over four observations, and names what is untested instead of
  // resolving the mechanism into a law), the MCP-side rate refusal read as a
  // window reading rather than a signal about the PR +6, the CDN cause behind
  // 「本档的缺席不是读数」 +5, and the Routine transport family +16 (no connector
  // tools in a fired session · self-binding's trade and its orphan-recovery rule
  // · neither `sources` nor `model` on the create end) = +39 exactly. Two members
  // shrank against `origin/main` before landing, because the file already carried
  // the fact: a reading the table states is cited, never re-spelled. Nothing was
  // paid in place — the deletions this file can offer were measured at 0 whole
  // lines under the previous raise and nothing has been added since to delete —
  // and re-wrap funding is refused per the 2026-08-17 rule. Landed count,
  // headroom 0, same convention.
  // Item 2 of the same ruling = C: the two quota sentences this increment leaves
  // in tension — the standing 「⛔ 不据限流报文里的 user ID 推…」 and the new
  // member's 未裁 clause beside it — BOTH STAY AS WRITTEN, pending a
  // discriminating read. ⛔ Neither is edited here or there.
  // ⚠️ This entry is also the DESTINATION of the cross-file move declared below,
  // and NEITHER ordinary raise above is part of it. Both are recorded there as
  // `ruledRaises` records quoting their own rulings, which is what keeps that
  // declaration's `was` at this file's literal pre-move 314 while the move's own
  // raise still reads +10 against the sources' −11.
  // Lowered 397 → 359 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/platform-readings.md', 359],
  // Per-operation REST/GraphQL/git channel mapping — which fleet operation has
  // a REST twin (each row executed in a real session, provenance date carried
  // per row), the handful that are GraphQL-only, and the queue-routing
  // readings. The policy lives in platform-readings.md's quota section; this
  // file is the lookup table it points at, so the policy flip did not have to
  // grow the hot file. Set at landed line count (headroom 0, same convention
  // as the entries above).
  // Raised 87 → 93 by a maintainer ruling (2026-09-01, 总监批 #22) that names
  // this ceiling and orders its own encoding — the ratchet's own legitimate
  // exit, and the raising PR quotes the ruling comment. Verbatim and
  // untranslated (one quotation, wrapped only to fit this comment):
  //   「**B 获授权**:`rest-channel.md` 天花板 87 → **≤93 行**,提额 PR 引用本裁决
  //   评论(棘轮自己的合法出口);两条处方按 dev 已测的忠实版落(两个拒绝 +
  //   `&page=N` 短页终止条件 + `open_issues_count` 减开放 PR 交叉核对 + 成因未知
  //   边界 + 关键词对照结构性盲区注记)」
  // and, same batch, the content-ownership call that says what is paid in place:
  //   「**C 同批**:退役 L58 对红窗常设规则的复述 —— 内容归属裁定:**红窗规则由
  //   `platform-readings.md` 配额段独家持有**,`rest-channel.md` 只留指路」
  // Paid in place: that restatement and its adjacent blank are retired (−2), and
  // the pointer the ruling permits is folded into the 不可迁移 heading at zero
  // line cost — so the red-window rule now has exactly one home. Spent: +8, the
  // two enumeration-completeness prescriptions (both refusals, the `&page=N`
  // short-page termination, the `open_issues_count`-minus-open-PRs cross-check,
  // the cause-unknown boundary, and the note that a keyword positive control is
  // structurally blind to this class) plus the closed-inclusive dedup obligation
  // the same batch ruled onto this file (「提额预算一次用足」). Could not be paid
  // by re-wrap: the file measures zero reclaimable lines under this gate's own
  // wrapLine, and re-wrap funding is refused per the 2026-08-17 rule in any
  // case. Landed count, headroom 0, same convention.
  // Lowered 93 → 88 as a SOURCE of the cross-file move recorded on
  // platform-readings.md above: the merge_group count-is-not-a-mechanism
  // tombstone left this table for the readings file, byte-identically. This
  // file's own header already routes the queue-section readings there and
  // refuses to keep a second copy, so nothing is left behind but the rows that
  // are channel mappings. Landed count, headroom 0, same convention.
  // Lowered 88 → 82 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/rest-channel.md', 82],
  // Lowered 84 → 77 by the rules-only rewrite of the seven core references
  // (maintainer ruling: provenance narratives, incident post-mortems and rationale
  // tails leave the corpus; one rule per ≤120-byte line, no rule already stated in
  // SKILL.md). Landed count, headroom 0, same convention (lowering is always
  // legitimate).
  ['.claude/skills/pm-dispatch/references/review-checklist.md', 77],
  // Lowered 80 → 69 by the rules-only rewrite of the seven core references
  // (maintainer ruling: provenance narratives, incident post-mortems and rationale
  // tails leave the corpus; one rule per ≤120-byte line, no rule already stated in
  // SKILL.md). Landed count, headroom 0, same convention (lowering is always
  // legitimate).
  ['.claude/skills/pm-dispatch/references/landing-operations.md', 69],
  // Release-aftercare duties — what a lane PM still owes AFTER a tagged release
  // rolls to production, which the landing window (ends at MERGED) never
  // covered: post-roll placement/latency reading with the waker-bias re-draw
  // physics, one real user-path probe, the tourniquet rule for replayed live
  // state, orphaned-loop resumption, and the honesty clause. Set at landed line
  // count (headroom 0, same convention as the entries above). It is pointed at
  // from landing-operations.md, whose ceiling is the entry directly above and is
  // deliberately not restated here: a live number copied into a neighbour's
  // comment goes stale the next time that file moves — which is what happened to
  // the arithmetic this sentence replaces.
  // Lowered 58 → 50 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/release-aftercare.md', 50],
  // Lowered 105 → 91 by the rules-only rewrite of the seven core references
  // (maintainer ruling: provenance narratives, incident post-mortems and rationale
  // tails leave the corpus; one rule per ≤120-byte line, no rule already stated in
  // SKILL.md). Landed count, headroom 0, same convention (lowering is always
  // legitimate).
  ['.claude/skills/pm-dispatch/references/seat-post-protocol.md', 91],
  // Per-repo「真绿」跑法索引 — the canonical test invocation, the gates a CI-log
  // grep cannot see, and the local preflight, one fact per line per repo. Added
  // by the protocol-text family PR, which could not carry its own ceiling: that
  // dispatch declared a closed file surface (SKILL.md + os-dev.md + the new page
  // + one pointer line) with stop-on-breach, and this script sat outside it. A
  // pm-dispatch references file is read per seat session like every entry above,
  // so its absence here was a coverage gap, not the header's deliberate omission
  // (that one is the published `skills/` catalog, and only it). Set at the landed
  // line count read from this ratchet's own run — headroom 0, same convention as
  // the entries above.
  // Lowered 34 → 32 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/true-green.md', 32],
  // Per-surface compile/typecheck coverage index — which surfaces a repo-wide
  // typecheck actually reaches, which are compiled only by their own package's
  // script, and the frozen ones. #12098: after true-green.md above it was the
  // LAST pm-dispatch references file with no row, found by enumerating the
  // directory against this map rather than by noticing one file. A references
  // file is read per seat session like every entry above, so its absence was a
  // coverage gap, not the header's deliberate omission (that one is the
  // published `skills/` catalog, and only it). Set at the landed line count read
  // from this ratchet's own run — headroom 0, same convention. ⚠️ Its seven
  // over-120B lines are all `table` rows, structurally exempt and NOT
  // re-wrappable; they are metered instead by MAX_TABLE_ROW_BYTES below.
  // Lowered 26 → 24 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/compile-surfaces.md', 24],
  // Plain-language digest of the corpus's binding rules, one rule per line, added
  // under the 2026-09-04 rules-only ruling so the maintainer reviews the rules
  // instead of the corpus. Set at the landed line count (headroom 0, same
  // convention as every entry above); it is a NEW file, so this is an added row
  // and no other row moves.
  ['.claude/skills/pm-dispatch/references/core-rules.md', 150],
  // Lane job descriptions (maintainer ruling 2026-08-19: per-lane PM job
  // descriptions move from seat-post prose into versioned skill references).
  // Set at landed line counts (headroom 0, same convention as above).
  // Each −1: whole-text restructuring round, PR-2 (maintainer ruling
  // 2026-08-23) — the patrol-anchor sentence was carried verbatim by all seven
  // lanes and now lives once in SKILL.md 执行座位职责, so every lane drops it.
  // cli.md pays −2 because it was carrying the map's last line of headroom.
  // Lowered 40 → 32 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/lanes/engine.md', 32],
  // Lowered 30 → 28 and 35 → 31 as the other two SOURCES of the cross-file
  // move recorded on platform-readings.md above. A per-repo gate reading in a
  // lane charter is read by one lane and missed by the other six, which is the
  // whole defect the move repairs: services.md gave up the two aggregate-
  // reading boundaries, cli.md the required-check set with its `in_progress`
  // and advisory clauses. Landed counts, headroom 0, same convention.
  // Lowered 28 → 27 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/lanes/services.md', 27],
  // Lowered 31 → 29 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/lanes/cli.md', 29],
  // Lowered 39 → 38 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/lanes/devx.md', 38],
  // Lowered 35 → 33 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/lanes/skills.md', 33],
  // Lowered 46 → 43 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/lanes/spec.md', 43],
  // repo:hotcrm lane charter (maintainer rulings 2026-08-20: exemplar-app repo —
  // platform capabilities implemented upstream, 展现平台能力, 不扩散需求, runs on
  // community edition). Set at landed line count (headroom 0, same convention).
  // 45 → 44: same patrol-anchor hoist deletion as the six lanes above.
  // Lowered 57 → 53 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/lanes/hotcrm.md', 53],
  // Project Director seat charter (maintainer ruling 2026-08-27, verbatim in the
  // file: 「项目总监 由人工定期指挥，负责处理 contract-review 类别的和需要决裁的。」) — a
  // human-invoked seat owning the contract-review chain, the adjudication duty and
  // the maintainer-action ledger. A lane charter is read per seat session like
  // every entry above. Set at the landed line count read from this ratchet's own
  // run (headroom 0, same convention as the entries above).
  // 75 → 77: maintainer-directed placement (2026-08-27, verbatim: 「创业阶段不渐进
  // 应该写入项目总监skills」) — the no-gradualism standing rule lands here by that
  // directive; the file sat at headroom 0 with no losslessly compressible slack in
  // the touched sections (arithmetic in the raising PR), so the directive is the
  // ruling that pays for exactly the two lines it dictates.
  // Lowered 77 → 72 by the rules-only rewrite (maintainer 2026-09-04:
  // 「各条规则的出处叙事、事故复盘 根本不重要啊，不需要写入skills啊」) — provenance dates,
  // ruling citations and incident narrative left; every rule stayed. Landed count,
  // headroom 0, same convention (lowering is always legitimate).
  ['.claude/skills/pm-dispatch/references/lanes/director.md', 72],
  // 399 → 405 (#11126): maintainer-ruled (2026-08-23, option B, quoted in that
  // PR) — the +6-line cross-repo dispatch-gates caveat, sized so the queued
  // #11137 (395→399 on main) and this PR's +6 compose to exactly 405.
  // Lowered 470 → 466 by the #12081 residual soft-break paydown (lowering is
  // always legitimate, and the same closure lowered decision-analysis.md above):
  // this file's last 8 Han+ASCII-punct breaks merged back into their paragraphs,
  // and 4 of the 8 paid for themselves. Zero content change — the diff is
  // byte-identical after whitespace normalization (39,313 B both sides), so the
  // 4 lines are re-flow slack, never a cut. Headroom 0 again, same convention.
  // Raised 466 → 469 by the axis-weighting ruling (maintainer 2026-09-01, PM
  // chat, verbatim and untranslated): 「四维分析中，长期合理应该权重最高，至少50%」.
  // This file is not a `check:skill-frame-sync` COPIES entry, but it names the
  // decision frame's mechanism (the dev reads it from the PM's pasted copy at
  // dispatch time), and a rule that changes which recommendation the frame
  // yields still has to reach that description — the #5130 drift is exactly a
  // frame-semantics change that skipped a mirror. +3 lines,
  // folded into the existing binding sentence rather than added as a new
  // paragraph. ⚠️ Re-wrap funding was AVAILABLE here and was REFUSED: three
  // paragraphs nearby carry wrap artifacts (two orphan lines of 6 and 8 bytes)
  // worth exactly the 3 lines needed, and merging them would have landed this
  // file at 466/466 with no raise — that is 筹行, banned by the 2026-08-17
  // ruling, since the ratchet governs content volume and lines are only its
  // machine-readable proxy. Measured both ways before reverting to the raise.
  // The density fix is legitimate on its own and belongs in a net-reducing PR
  // (2026-08-29 ruling), not this one. Landed count, headroom 0, same convention.
  // Lowered 469 → 403 by the rules-only rewrite (maintainer ruling: provenance
  // narratives, incident post-mortems and rationale tails leave the corpus; one
  // rule per ≤120-byte line; the frontmatter, section order, pinned spellings and
  // the report JSON keep their operative content). Landed count, headroom 0, same
  // convention (lowering is always legitimate).
  ['.claude/agents/os-dev.md', 403],
  // #9473: the other four `.claude/skills/` are read in full by the sessions
  // that use them too — the erosion mechanism the ratchet exists to stop
  // isn't specific to the pm-dispatch surface. Set at current counts on
  // `origin/main` (headroom 0, same convention as the entries above).
  ['.claude/skills/checklist-test/SKILL.md', 238],
  ['.claude/skills/checklist-author/SKILL.md', 62],
  ['.claude/skills/dogfood-verification/SKILL.md', 157],
  // 328 → 334 (#10848): maintainer-ruled (2026-08-22, Option A) — convention 5
  // replaced with the pin's house sentence AND the pin docblock's one allowed
  // variant shape carried into the skill, +6 lines within the card's budget.
  ['.claude/skills/spec-property-retirement/SKILL.md', 337],
  // #9792: root AGENTS.md is the largest, most-read, most binding instruction
  // file in the repo and had no ceiling — the hole the oversized 39-line
  // read-layer clause (compacted by #9715) entered through. Set at its line
  // count on `origin/main` after #9715 landed (headroom 0, same convention).
  //
  // 958 → 961 (#10126): the ONE raise this map has taken, by the header's own
  // escape hatch. The queue-incident remediation adds a three-line convention to
  // § Build & Test — clocked windows measure behaviour, never loading — and the
  // section it joins had two lines of lossless rewrap headroom against a
  // three-line cost, so it could not be paid for in place. Maintainer ruling
  // 2026-08-20, verbatim and untranslated: 「A — 抬上限到 961 (Recommended)」
  // (issue #10126, comment 5353111732). Headroom is 0 again by construction, and
  // the next author needing a line is back to compressing.
  //
  // 1149 → 1150 (#11819): Prime Directive #15's warrant sentence described the
  // Version Packages PR as regenerated "on every push to main" — false since the
  // #11233 trigger split. The correct sentence (six-hourly schedule; push drives
  // the publish lane) is longer, and the whole paragraph measures zero lossless
  // rewrap headroom, so the correction costs one line. Maintainer ruling
  // 2026-08-25, verbatim and untranslated, accepting the measured +1/D1 option:
  // 「我看到了,你分析过了,接受你的建议」. Headroom is 0 again by construction.
  //
  // 1150 → 1158 (#10855 / PR #11908): the published-spellings mirror re-sync.
  // AGENTS.md's copy of check-cross-package-test-inputs' RECOGNISED_PATH_SPELLINGS
  // had drifted — the two findUp ANCHOR seeds and the ⛔ manifest-name prohibition
  // qualifying them were missing. Twice before, the stale line over there was the
  // stated REASON FOR A PROHIBITION (#10163, #10854), so a rotting mirror does not
  // merely misinform: it launders an obsolete rule into a live one. The honest
  // re-sync measures +8 on the reflowed (#11948) layout — published block 11 → 17
  // lines, prose paragraph 4 → 6 — and lossless rewrap headroom across that
  // section measures 0, so it cannot be paid in place. From here the mirror is
  // mechanically enforced by check-published-list-mirrors.mjs, which prices any
  // later drift at the moment it is incurred rather than letting it accrue.
  // Maintainer ruling 2026-08-25 (option C1), verbatim and untranslated:
  // 「我看到了,你分析过了,接受你的建议」 — recorded on PR #11908. Headroom is 0
  // again by construction.
  //
  // 1158 → 1162 (#12756, folding #12896 + the #12874-A line): PD #14's editable
  // prose amended to the 2026-08-27 approve-gated queue ruling — the superseded
  // "Reviewed + approved + fully green does not override this" replaced by the
  // GOVERNED_APPROVERS pinned-approval landing path, the agent-never-approves
  // prohibition, and the pure-regeneration proactive-approval line (the queue leg
  // then installed nothing, so the byte-equality lift never evaluated; SUPERSEDED
  // 2026-09-01/#14067); § Skills' twin sentence reconditioned in place at net 0.
  // All three PD #14 paragraphs measure 0 lossless-rewrap headroom under wrapLine
  // and the card's seven-cut ledger was exhausted first: held draft +2, the
  // proactive-approval rider +2 (a 161-byte minimal variant still wraps to +2;
  // anything smaller drops ruled content), fold 0. Maintainer batch ruling
  // 2026-08-29, verbatim and untranslated: 「执行，批 #1 其他卡同意」 — recorded
  // on #12756 and quoted in the PR. Headroom is 0 again by construction.
  //
  // 1162 → 1058: the rules-only rewrite — every incident narrative, ruling date and
  // quotation out, every rule kept as one sentence; re-pinned at the landed count,
  // headroom 0 (lowering is always legitimate).
  ['AGENTS.md', 1058],
  // #9965: root CLAUDE.md is the other repo-root instruction file — same read
  // path (every seat session), same governance (Prime Directive #14). It is
  // structurally growth-prone in the way the ratchet is built for: it exists to
  // inline the rules that must never be missed, so every new must-never-miss
  // rule is an argument for appending to it. Maintainer ruling 2026-08-20,
  // verbatim and untranslated: 「其他接受你的建议。」 (issue #9965, comment
  // 5353931707) — rationale on record: a one-line ceiling now prevents compound
  // growth cheaply. Set at its line count on `origin/main` (headroom 0, same
  // convention as the entries above).
  // 86 → 41: the ownership excerpt rewritten by role in the same rules-only pass;
  // re-pinned at the landed count, headroom 0.
  ['CLAUDE.md', 41],
]);

/**
 * The ruling that authorises a cross-file move, spelled once. Every declaration
 * in {@link CROSS_FILE_MOVES} must name it; a raise that names nothing is a
 * raise, not a move, and the header's escape hatch (a maintainer ruling quoted
 * in the raising PR) is the only other way one lands.
 */
export const RULING_CITATION = '#14685 item 5 (comment 5520452691)';

/**
 * Declared same-PR CROSS-FILE MOVES — the raise path the header section above
 * authorises. Keyed by DESTINATION (the entry whose ceiling rose); one
 * declaration per destination, and no path appears twice across the map.
 *
 * Each declaration carries the ceilings its participants held BEFORE the move,
 * which is what makes the whole arithmetic computable from this file alone:
 *
 *   ruling   the authorising ruling — must name {@link RULING_CITATION}
 *   was      the destination's ceiling before the move — its LITERAL pre-move
 *            value, never carried forward past a later ordinary raise
 *   sources  [path, ceiling-before-the-move] for every file that paid for it
 *   ruledRaises
 *            optional; one `{ruling, date, delta}` record per ORDINARY ruled
 *            raise taken on the destination SINCE the move, subtracted before
 *            this move's raise is measured (header: the two quantities). Its
 *            `ruling` carries the maintainer's own words as a verbatim
 *            quotation, in either spelling the ceilings above already use —
 *            「…」 or "…" — and a record without one is RED.
 *
 * ⛔ NOT somewhere to record a raise no move paid for. A declaration is a CLAIM
 * about an arithmetic, and {@link crossFileMoveVerdict} re-derives that
 * arithmetic from the live map on every run rather than trusting the prose
 * beside it.
 *
 * ⚠️ A declaration keeps working after its PR lands, and the two directions are
 * deliberately asymmetric. Lowering the destination later is always legitimate,
 * so a destination that has fallen back to or below its `was` reads as PAID
 * DOWN and passes. Raising a SOURCE later is the loophole the move mechanism
 * would otherwise open — the destination keeps the lines it was given while the
 * files that paid for them grow back, and the corpus is up on net with the
 * move's warrant silently spent — so the sum is re-checked against the sources'
 * pre-move values for as long as the declaration stands. That red belongs to
 * the later raise, not to this one, and its author is holding the ruling that
 * has to account for it.
 *
 * ⚠️ A later ORDINARY raise on the destination is a THIRD direction and is
 * neither of those two: it is the maintainer's, so it neither re-opens the move
 * nor pays it down. It belongs in `ruledRaises`, where it is subtracted — which
 * is what lets `was` stay one fact instead of a running total.
 */
export const CROSS_FILE_MOVES = new Map([
  // The readings consolidation — the first move taken under the ruling, and the
  // one it was ruled for. Sources' `was` values are their ceilings on
  // `origin/main` at f3ae441fa2; the reviewer holds them against that diff.
  [
    '.claude/skills/pm-dispatch/references/platform-readings.md',
    {
      ruling: 'per-repo readings consolidation, authorised by #14685 item 5 (comment 5520452691)',
      // The destination's LITERAL ceiling on the day this move landed, and one
      // fact: it is NOT carried forward past the ordinary ruled raise the same
      // entry took on 2026-09-04, which is recorded below instead. So the
      // reviewer's completeness check keeps the single shape it has always had —
      // every `was` here, destination and sources alike, is that participant's
      // ceiling on `origin/main` at f3ae441fa2, held against that diff.
      was: 314,
      // ORDINARY ruled raises taken on this destination SINCE the move. Each is
      // the maintainer's rather than this move's, so each is subtracted before
      // the move's raise is measured: 397 − 314 − (34 + 39) leaves the +10 the
      // move landed with, against the same net source decrease of 11. Recording
      // them here rather than inside `was` is the whole point — with neither, the
      // same tree reads the move as +83 against −11 and reds twice, for lines no
      // source was ever asked to pay. The list GROWS by one record per ruled
      // raise; ⛔ `was` never moves, so the reviewer's completeness check keeps
      // the one shape it has always had.
      ruledRaises: [
        {
          // Quoted beside this entry's ceiling above, where the +34 is accounted
          // for line by line. Copied from there, not paraphrased.
          ruling:
            'the intake-family raise on `.claude/skills/pm-dispatch/references/platform-readings.md`'
            + ' — maintainer, live PM chat, 2026-09-04, decision batch #27, verbatim and'
            + ' untranslated: 「同意」 on option A, and the sentences that ruling adopts, in the'
            + ' director record\'s own words: "the ceiling for'
            + ' `.claude/skills/pm-dispatch/references/platform-readings.md` is raised by the'
            + ' measured need, +34, to 358 — a named, sized raise under the ratchet\'s own'
            + ' maintainer exit … The +34 is a ceiling of the raise, not a target: if the eight'
            + ' readings land in fewer lines, the raise is the smaller number."',
          date: '2026-09-04',
          delta: 34,
        },
        // RETIRED HERE, and retired rather than re-numbered, because the ceiling
        // above no longer stands high enough to carry both records. The rules-only
        // rewrite gave 38 of these 73 ruled lines back (397 → 359), so 35 of them
        // still stand while the destination is only 45 above `was` — and a set of
        // records claiming more than that reads as an over-claim, which is exactly
        // what `crossFileMoveVerdict` refused. The header names the remedy: a ruled
        // raise since given back is spent, so retire its record. The THIRD-INCREMENT
        // record is the one retired (maintainer, decision batch #34, 2026-09-04,
        // 「决裁批 #34 同意」, +39, quoted in full beside the ceiling above) rather
        // than the intake-family record below it, and the choice is the conservative
        // direction rather than a preference: 34 declared against 35 actually
        // standing prices this move at +11 for a raise that took +10, while keeping
        // the +39 instead would price it at +6 — under-pricing the move is the
        // failure the header warns about. Neither ruling is reopened by this: both
        // are still quoted beside the ceiling, which is where a reader gets back to
        // them, and the lines they bought are the lines this rewrite handed back.
      ],
      sources: [
        ['.claude/skills/pm-dispatch/references/lanes/cli.md', 35],
        ['.claude/skills/pm-dispatch/references/lanes/services.md', 30],
        ['.claude/skills/pm-dispatch/references/rest-channel.md', 93],
      ],
    },
  ],
]);

/**
 * Per-file MAX TABLE ROW BYTES — the second ratchet, and the only metered thing
 * in this file that is not a line count (#11947).
 *
 * ## The hole it closes
 *
 * The 120-byte line rule above exempts a markdown table row by shape, and that
 * exemption is correct — a wrapped `|` row is a different table. But it is not
 * free, and until this map nothing measured what flowed through it. A table row
 * grows by WIDENING A CELL, which costs zero lines and passes both existing
 * controls: the line ratchet counts it as one line, and the length rule exempts
 * it. Measured on the corpus when this landed, the five longest surviving lines
 * were all table rows, led by `AGENTS.md` at 1,081 bytes.
 *
 * The widening is not hypothetical and not broad decay — it is HEAVY-TAIL, which
 * is what sized this remedy. Per-row byte drift keyed by first cell between two
 * refs of `origin/main`: of ~100 matched rows, essentially none moved, while the
 * corpus's two longest lines both reached their length inside two weeks through
 * exactly this channel (`AGENTS.md` 639 → 1,081 bytes; one `domain:engine` row
 * 101 → 765, a 7x). A corpus-wide new RULE would be sized for a defect that
 * lives in two or three rows per file; a shrink-only PIN catches precisely the
 * measured defect and nothing else.
 *
 * ## The ruling
 *
 * Maintainer ruling 2026-08-25 (issue #11947, comment 5406811814), verbatim and
 * untranslated: 「同意」 — accepting option 1, the A-ratchet, over option 2 (a
 * whole-file byte ceiling on the two table-heavy files, the narrowed form of the
 * option already declined corpus-wide by #11106) and option 3 (nothing, refuted
 * by the measurement above). The other five structural exemption classes —
 * quotation, blockquote, unbreakable, anchored, fence — are untouched and remain
 * load-bearing and human-audited.
 *
 * ## The discipline, which is the ceilings' discipline
 *
 * Seeded at each file's OWN widest table row on the day this landed, read from
 * {@link scanTableRows} rather than measured by hand — no invented constants,
 * the same idiom as the ceilings above and {@link MAX_LINE_BYTES}. Shrink-only:
 * lowering is always legitimate and consolidation pays the pin down; raising one
 * requires a maintainer ruling quoted in the raising PR.
 *
 * ⚠️ A pin of 0 is a MEASUREMENT, not a disabled row: that file has no table row
 * today, so its widest is 0. It is deliberately not an omission — an uncovered
 * file is the one place a row could widen unmetered again, which is the whole
 * defect. Every key of {@link CEILINGS} carries a pin and the self-test holds the
 * two maps in step, because enforcement cannot: a missing pin would simply never
 * be consulted. Since every pin is seeded at headroom 0, ANY positive headroom
 * means a row has since been paid down and the pin should follow it — `run`
 * prints that as a hint rather than a failure.
 */
export const MAX_TABLE_ROW_BYTES = new Map([
  // The five files that carry a table row today, each seeded at its own widest.
  // The corpus's #1 longest LINE of any shape is the AGENTS.md row below.
  // Lowered 642 → 342 by the rules-only rewrite: the state-model and domain
  // rows lost their in-cell provenance and rationale; the widest survivor is
  // the `domain:engine` row. Landed width, headroom 0 (lowering is always
  // legitimate).
  ['.claude/skills/pm-dispatch/SKILL.md', 342],
  ['.claude/skills/pm-dispatch/references/dispatch-runbook.md', 0],
  ['.claude/skills/pm-dispatch/references/state-machine.md', 0],
  ['.claude/skills/pm-dispatch/references/contract-review.md', 0],
  ['.claude/skills/pm-dispatch/references/decision-analysis.md', 0],
  ['.claude/skills/pm-dispatch/references/platform-readings.md', 0],
  ['.claude/skills/pm-dispatch/references/rest-channel.md', 0],
  ['.claude/skills/pm-dispatch/references/review-checklist.md', 0],
  ['.claude/skills/pm-dispatch/references/landing-operations.md', 0],
  ['.claude/skills/pm-dispatch/references/release-aftercare.md', 0],
  ['.claude/skills/pm-dispatch/references/seat-post-protocol.md', 0],
  ['.claude/skills/pm-dispatch/references/true-green.md', 0],
  ['.claude/skills/pm-dispatch/references/compile-surfaces.md', 352],
  ['.claude/skills/pm-dispatch/references/core-rules.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/engine.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/services.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/cli.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/devx.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/skills.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/spec.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/hotcrm.md', 0],
  ['.claude/skills/pm-dispatch/references/lanes/director.md', 0],
  ['.claude/agents/os-dev.md', 0],
  ['.claude/skills/checklist-test/SKILL.md', 221],
  ['.claude/skills/checklist-author/SKILL.md', 0],
  ['.claude/skills/dogfood-verification/SKILL.md', 0],
  ['.claude/skills/spec-property-retirement/SKILL.md', 328],
  // Lowered 1081 → 768 by the rules-only rewrite: the translations row lost its
  // in-cell narrative; the widest survivor is that same row. Landed width, headroom 0.
  ['AGENTS.md', 768],
  ['CLAUDE.md', 0],
]);

/**
 * The repo-ROOT files of the map above, spelled so `scripts/pm/dispatch-gates.mjs`
 * can derive this gate from a card that touches one.
 *
 * ## The gap this closes
 *
 * That tool reads a gate's population out of the path literals in the gate's own
 * source, and "looks like a path" there means "carries a separator" (plus a short
 * allowlist of dotted top-level dirs). Every key above satisfies that except the
 * repo-root files — a repo-root FILE has no separator to be found by. So before
 * this list existed an AGENTS.md card derived ZERO gates, and the dev met this
 * ratchet as red CI instead of as a local command. That lands on the largest
 * ceiling in the map at headroom 0, where one added paragraph crosses it. CI
 * still enforces either way (lint.yml carries no path filter) — what was missing
 * was discoverability, and this restores it.
 *
 * ## Why the subtree spelling, and why it covers exactly the root files
 *
 * `<file>/**` is the only form that reaches a repo-root file: the extractor
 * requires the separator, and dispatch-gates collapses a hint's globs before
 * comparing, which reduces each back to its bare filename and matches that path
 * alone. Nothing in the tree lives under `AGENTS.md/` or `CLAUDE.md/`, so neither
 * claims a directory — measured at exactly one (gate, file) pair added per root
 * file, one family gaining coverage.
 *
 * The alternative was widening the extractor to accept bare top-level `*.md`
 * literals. Measured over 114 families x 6326 tracked files it is cheap by
 * VOLUME (+17 pairs) and fails on PROVENANCE: 8 of those 17 are fabricated,
 * because gates spell `README.md` and `CHANGELOG.md` as BASENAMES they join with
 * a package directory (a manifest `files` entry, a per-package exclusion, a
 * remote directory listing). A README.md card would come back with six leads of
 * which five name a gate that never reads that file — the false-lead class
 * dispatch-gates' own header errs against, one extension over from the
 * `package.json` basenames it already refuses.
 *
 * ## This is provenance, NOT a lookup key
 *
 * `run` opens files through CEILINGS. This list is read by nothing in this
 * script, and deliberately does not live in that map: a key rewritten into the
 * glob form would send the ratchet looking for a file that does not exist. The
 * self-test pins both halves — every separator-less ceiling is declared here,
 * and nothing declared here is a CEILINGS key.
 */
export const ROOT_FILE_WATCH_HINTS = ['AGENTS.md/**', 'CLAUDE.md/**'];

export function verdict(rel, lineCount, maxLines) {
  if (lineCount === 0) return { ok: false, msg: `${rel} read as empty — refusing to treat a missing/empty input as a pass (#4690).` };
  if (lineCount > maxLines) {
    return {
      ok: false,
      msg:
        `${rel} is ${lineCount} lines; the ratchet ceiling is ${maxLines}. ` +
        'Keep the surface compressed: principles in SKILL.md, on-demand detail in ' +
        '.claude/skills/pm-dispatch/references/ — provenance is one line, stories live on cards, ' +
        'not in operational text. Raising a ceiling requires a maintainer ruling quoted in the PR.',
    };
  }
  return { ok: true, msg: `${rel} is ${lineCount} lines (ceiling ${maxLines}; headroom ${maxLines - lineCount}).` };
}

function countLines(text) {
  return text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/**
 * A VERBATIM QUOTATION, in either spelling the ceilings above already use: 「…」
 * for the maintainer's own Chinese, and "…" for the English text a ruling adopts
 * (both are present up there — the 2026-08-25 generated-artifact carve-out is
 * quoted the second way). The bar is the quotation, never the bracket.
 */
const VERBATIM_QUOTATION = /「[^」]+」|"[^"]+"|“[^”]+”/u;

/** When the ruling was given, `YYYY-MM-DD` — how a reader gets back to it. */
const RULED_RAISE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The ORDINARY ruled raises recorded against a move's DESTINATION — validated,
 * then summed, so {@link crossFileMoveVerdict} can take them out of the rise
 * before it prices the move.
 *
 * Every bar here exists because the subtraction is a licence to grow: lines it
 * removes from the move's raise are lines the sources are never asked to pay
 * for. So a record must name a positive line count, quote the ruling that
 * authorised it, and date it. None of that proves the maintainer said the words
 * — that is the reviewer's completeness check, the same one every `was` in this
 * map has always relied on — but it does mean a record nobody ruled has to be
 * written as a forgery rather than reached by an oversight.
 *
 * @param {string} dest destination path, for the message
 * @param {{ruledRaises?: Array<{ruling?: string, date?: string, delta?: number}>}} move
 * @returns {{ok: true, total: number} | {ok: false, msg: string}}
 */
function ruledRaisesVerdict(dest, move) {
  const bad = (msg) => ({ ok: false, msg });
  const records = move?.ruledRaises ?? [];
  if (!Array.isArray(records)) {
    return bad(`cross-file move into ${dest} states its ordinary ruled raises as something other than a list, so they cannot be measured — red, not a skip (#4690).`);
  }
  let total = 0;
  for (const record of records) {
    const where = `cross-file move into ${dest}: an ordinary ruled raise recorded against the destination`;
    if (!Number.isInteger(record?.delta) || record.delta <= 0) {
      return bad(`${where} names no usable line count ("delta"). A ruled raise is a positive number of lines; lowering is always legitimate and is never recorded here.`);
    }
    if (!VERBATIM_QUOTATION.test(String(record?.ruling ?? ''))) {
      return bad(`${where} (${record.delta} lines) quotes no ruling. A raise is the maintainer's or it is not a raise, so the record carries the ruling's own words verbatim — 「…」 or "…", the way every ceiling in this map quotes one. Un-ruled, this subtraction would take lines out of the move's raise that the sources were never asked to pay for.`);
    }
    if (!RULED_RAISE_DATE.test(String(record?.date ?? ''))) {
      return bad(`${where} (${record.delta} lines) carries no ruling date (YYYY-MM-DD), which is how a reader gets from this record back to the ruling it quotes.`);
    }
    total += record.delta;
  }
  return { ok: true, total };
}

/**
 * The same sum with no verdict, for {@link crossFileMoveTotalVerdict}. A
 * malformed record is already RED in {@link crossFileMoveVerdict}, which reads
 * every declaration on every run, so a green run never reaches this with one.
 *
 * @param {{ruledRaises?: Array<{delta?: number}>}} move
 */
function ruledRaiseSum(move) {
  const records = Array.isArray(move?.ruledRaises) ? move.ruledRaises : [];
  return records.reduce((sum, r) => sum + (Number.isInteger(r?.delta) && r.delta > 0 ? r.delta : 0), 0);
}

/**
 * One declared cross-file move, re-derived from the live ceiling map.
 *
 * Conditions (a) and (c) of the ruling; (b) is map-wide and lives in
 * {@link crossFileMoveTotalVerdict}. Every failure names the arithmetic it read,
 * because the author's next move is to correct one of those numbers and a
 * verdict that hides them cannot be acted on.
 *
 * @param {string} dest destination path — a key of `ceilings`
 * @param {{ruling?: string, was?: number, sources?: Array<[string, number]>}} move
 * @param {Map<string, number>} ceilings
 */
export function crossFileMoveVerdict(dest, move, ceilings) {
  const bad = (msg) => ({ ok: false, msg });
  if (!ceilings.has(dest)) {
    return bad(`cross-file move declares ${dest} as its destination, which carries no ceiling — red, not a skip (#4690). A move can only land between files this map covers.`);
  }
  if (!String(move?.ruling ?? '').includes(RULING_CITATION)) {
    return bad(`cross-file move into ${dest} cites no authorising ruling — it must name "${RULING_CITATION}". An undeclared raise is a raise, and raising a ceiling otherwise requires a maintainer ruling quoted in the raising PR.`);
  }
  if (!Number.isInteger(move.was) || move.was <= 0) {
    return bad(`cross-file move into ${dest} records no usable pre-move ceiling ("was"), so its raise cannot be measured — red, not a skip (#4690).`);
  }
  const sources = move.sources ?? [];
  if (sources.length === 0) {
    return bad(`cross-file move into ${dest} names no source file. The raise is paid by deletion somewhere else in this map, and a move with nothing to pay it is a raise.`);
  }
  for (const [src, wasSrc] of sources) {
    if (src === dest) return bad(`cross-file move into ${dest} names itself as a source; a file cannot pay its own raise.`);
    if (!ceilings.has(src)) return bad(`cross-file move into ${dest} names source ${src}, which carries no ceiling — red, not a skip (#4690).`);
    if (!Number.isInteger(wasSrc) || wasSrc <= 0) return bad(`cross-file move into ${dest} records no usable pre-move ceiling for source ${src}.`);
  }
  const gross = ceilings.get(dest) - move.was;
  const parts = sources.map(([src, wasSrc]) => `${src} ${wasSrc}→${ceilings.get(src)}`).join(', ');
  if (gross <= 0) {
    return { ok: true, msg: `cross-file move into ${dest} is paid down: its ceiling is ${ceilings.get(dest)}, at or below the ${move.was} it moved from (sources: ${parts}).` };
  }
  const ruled = ruledRaisesVerdict(dest, move);
  if (!ruled.ok) return ruled;
  if (ruled.total > gross) {
    return bad(`cross-file move into ${dest} states ${ruled.total} lines of ordinary ruled raise on its destination, an over-claim: its ceiling stands only ${gross} above the ${move.was} it moved from. Lowering is always legitimate, but a ruled raise since given back is spent — retire its record, because leaving it here prices this move's own raise below what the move actually took.`);
  }
  const raise = gross - ruled.total;
  const less = ruled.total > 0 ? `, less ${ruled.total} line${ruled.total === 1 ? '' : 's'} of ordinary ruled raise` : '';
  if (raise <= 0) {
    return { ok: true, msg: `cross-file move into ${dest} is paid down: its ceiling is ${ceilings.get(dest)}, and all ${gross} line${gross === 1 ? '' : 's'} it stands above the ${move.was} it moved from are ordinary ruled raises recorded against it, so this move keeps none of them (sources: ${parts}).` };
  }
  const decrease = sources.reduce((sum, [src, wasSrc]) => sum + (wasSrc - ceilings.get(src)), 0);
  if (raise > decrease) {
    return bad(`cross-file move into ${dest} raises its ceiling ${move.was}→${ceilings.get(dest)}${less} (+${raise}) against a net source decrease of ${decrease} (${parts}). A move pays for itself by DELETION at the source; re-wrapping does not pay, and a raise the sources do not cover is an ordinary raise, which needs a maintainer ruling quoted in the raising PR. If part of that rise IS such a raise, record it under \`ruledRaises\` with the ruling's own words instead of carrying \`was\` forward: an ordinary ruled raise and a move's raise are separate quantities, and this arithmetic measures only the second.`);
  }
  return { ok: true, msg: `cross-file move into ${dest}: +${raise} (${move.was}→${ceilings.get(dest)}${less}) against a net source decrease of ${decrease} (${parts}); authorised by ${RULING_CITATION}.` };
}

/**
 * Condition (b): the sum of ceilings over the whole map does not increase.
 *
 * Computed as the map-wide sum with every declared participant restored to its
 * pre-move value, minus the map-wide sum today — untouched entries cancel, so
 * the difference is exactly the declared participants' net movement. A
 * destination's ordinary ruled raises are restored ALONGSIDE its `was`, for the
 * same reason {@link crossFileMoveVerdict} subtracts them: those lines are the
 * maintainer's and were never this move's to move, so they must cancel here
 * exactly as an untouched entry does. Left in, they would report a corpus
 * growing by lines the ruling already paid for. Disjoint
 * participants are REQUIRED, and that is what keeps the reduction honest: a
 * source named by two declarations would have its single decrease counted twice
 * by (a) and once here, and the two conditions would stop agreeing.
 *
 * @param {Map<string, {was?: number, sources?: Array<[string, number]>}>} moves
 * @param {Map<string, number>} ceilings
 */
export function crossFileMoveTotalVerdict(moves, ceilings) {
  const seen = new Map();
  let net = 0;
  for (const [dest, move] of moves) {
    for (const [path, was] of [[dest, move.was + ruledRaiseSum(move)], ...(move.sources ?? [])]) {
      if (seen.has(path)) {
        return { ok: false, msg: `${path} is a participant in two cross-file moves (${seen.get(path)} and ${dest}). Declarations must be disjoint: one file's single decrease cannot pay for two raises, and counting it twice is how a total that grew reads as a total that did not.` };
      }
      seen.set(path, dest);
      if (!ceilings.has(path) || !Number.isInteger(was)) continue;
      net += ceilings.get(path) - was;
    }
  }
  if (net > 0) {
    return { ok: false, msg: `the declared cross-file moves raise the map's total by ${net} line${net === 1 ? '' : 's'}. The ruling admits a move only while total lines do not increase: pay the difference by deleting more at a source, or take the raise the ordinary way — a maintainer ruling quoted in the raising PR.` };
  }
  return { ok: true, msg: `declared cross-file moves: ${moves.size}, total ceilings ${net === 0 ? 'unchanged' : `down ${-net} line${net === -1 ? '' : 's'}`}.` };
}

// ─────────────────────────────────────────────────────────────────────────────
// The max-line-length rule (#11106). See the header for why 120 and why bytes.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_LINE_BYTES = 120;

/** The closed, structural exemption set — no registry, no per-file allowlist. */
export const EXEMPTION_CLASSES = Object.freeze({
  fence: 'fenced code block (``` / ~~~), fence lines included — a wrapped fence is a different program',
  table: 'markdown table row — a wrapped `|` row is a different table',
  heading: 'ATX heading — a heading has no continuation line',
  frontmatter: 'YAML front matter — a scalar is not markdown prose',
  anchored: 'line-anchored directive example (Blocked-by: / Restart-when: / Restart-touch: / Unlock-when:) — 行锚定: the contract IS that a grep finds it at a line start, so wrapping one teaches a broken spelling',
  quotation: 'a line inside a MULTI-line 「…」/『…』 verbatim maintainer ruling — the quote already spans lines exactly as its author wrote it, and re-flowing it moves where phrases split. Measured: an earlier cut of the #11106 wrapper moved one break and turned check-skill-frame-sync red, because 「我们是一个创业项目,…」 stopped being findable on one line. A quote that fits on ONE line is not exempt — it is an atom instead, so surrounding prose still wraps around it intact',
  blockquote: 'blockquote line — its continuation must repeat `>`, so wrapping one INSERTS a non-whitespace byte. Every blockquote in this corpus is a verbatim maintainer ruling, and a length rule may not demand a content edit to a quotation. (Lazy continuation would avoid the marker and is refused for the same reason it is refused by hand: a later blank line silently drops text out of the quote.)',
  unbreakable: 'no legal break point — a bare URL, a long path or one long code span; wrapLine returns it unchanged, so the gate never demands a wrap it cannot produce',
});

const bytes = (s) => Buffer.byteLength(s, 'utf8');

// Wide (East Asian) characters: a segment break BETWEEN two of these is removed
// by the CSS segment-break transformation rules, which is why the corpus already
// wraps CJK prose mid-run with no space. A break at a CJK↔Latin junction with no
// space would render AS a space, so it is not a legal break and is not offered.
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
// Kinsoku: never strand a closing mark at a line head, never leave an opener at a line tail.
const NO_BREAK_BEFORE = '。，、;；:：?？!!)）]】}』」〉》·…%,.;:?!)]}’”';
const NO_BREAK_AFTER = '(（[【{『「〈《‘“';
// #12081 — the OTHER no-break-after class, and the reason it is a separate test
// rather than three more characters in the string above. `,` `;` `:` are legal
// break points in ASCII prose ("first, second") and must stay legal there. What
// is never legal is one of them written directly after a HAN character: this
// corpus spells CJK sentence-internal punctuation in ASCII throughout (measured
// on `.claude/agents/os-dev.md`: 197 ASCII commas after a Han character, 0
// fullwidth U+FF0C), so such a mark is a CJK sentence mark that happens to be a
// narrow byte. A segment break after it is NOT between two wide characters, so
// the CSS segment-break transformation KEEPS it and it renders as a SPACE —
// mid-sentence, in prose that has no spaces anywhere else. The successor
// character is irrelevant to that: the mark itself is narrow, so the break
// renders as a space whatever follows.
const HAN = /\p{Script=Han}/u;
// Sequences markdown reads as the start of a NEW block — a continuation line may never begin with one.
const BLOCK_START = /^(#{1,6}(\s|$)|[-*+](\s|$)|\d+[.)](\s|$)|>|\||`{3}|~{3}|-{3}|={3})/;

const isFence = (line) => /^\s*(```|~~~)/.test(line);
const isTableRow = (line) => /^\s*\|/.test(line);
const isHeading = (line) => /^\s*#{1,6}(\s|$)/.test(line);
// Anchored at the line's own head, after at most an indent, a quote/list marker and an opening backtick.
const isAnchoredDirective = (line) =>
  /^\s*(?:>\s*)?(?:[-*+]\s+)?`?(?:Blocked-by|Restart-when|Restart-touch|Unlock-when):/.test(line);

/**
 * Split a line into its markdown prefix, the continuation prefix a wrapped tail
 * inherits, and the body to be re-flowed. List continuations align under the
 * marker's content column; blockquote continuations repeat the quote marker.
 */
export function splitPrefix(line) {
  let m;
  if ((m = /^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(line))) return { head: m[1], cont: ' '.repeat(m[1].length), body: line.slice(m[1].length) };
  if ((m = /^(\s*>+\s?)/.exec(line))) return { head: m[1], cont: m[1], body: line.slice(m[1].length) };
  m = /^(\s*)/.exec(line);
  return { head: m[1], cont: m[1], body: line.slice(m[1].length) };
}

/**
 * Break the body into atoms — the units a wrap may be placed BETWEEN, never
 * inside. Inline code spans, markdown links, autolinks and bare URLs are single
 * atoms (that is what protects `Blocked-by: #N` written as a code span, and every
 * URL in the corpus); a CJK character is its own atom; everything else is a word.
 *
 * 「…」 and 『…』 are atoms too, and that one is load-bearing rather than tidy.
 * A corner-bracket quotation in this corpus is a VERBATIM maintainer ruling —
 * AGENTS.md 语言规则 requires it be carried untranslated and unrewritten — and
 * things GREP it. Measured while landing #11106: an earlier cut of this wrapper
 * broke 「我们是一个创业项目,…」 across two lines and turned
 * `check-skill-frame-sync`'s self-test red, because a phrase inside a governed
 * quotation stopped being findable on one line. A soft break does not change what
 * a reader sees, but it does change what a matcher sees, and quoted rulings are
 * the text most likely to be matched.
 */
export function atomize(body) {
  const atoms = [];
  let sp = false;
  for (let i = 0; i < body.length; ) {
    if (/\s/.test(body[i])) { sp = true; i++; continue; }
    const rest = body.slice(i);
    const m =
      /^(`+)[\s\S]*?\1/.exec(rest) ||
      /^「[^」\n]*」/.exec(rest) ||          // verbatim maintainer ruling — see below
      /^『[^』\n]*』/.exec(rest) ||
      /^!?\[[^\]\n]*\]\([^)\s]*\)/.exec(rest) ||
      /^<https?:[^>\s]*>/.exec(rest) ||
      /^https?:\/\/\S+/.exec(rest);
    if (m) { atoms.push({ text: m[0], cjk: false, sp }); i += m[0].length; sp = false; continue; }
    if (WIDE.test(body[i])) { atoms.push({ text: body[i], cjk: true, sp }); i++; sp = false; continue; }
    let j = i;
    while (j < body.length && !/\s/.test(body[j]) && !WIDE.test(body[j])) {
      if (j > i && (body[j] === '`' || body[j] === '[' || /^https?:\/\//.test(body.slice(j)))) break;
      j++;
    }
    atoms.push({ text: body.slice(i, j), cjk: false, sp });
    i = j;
    sp = false;
  }
  return atoms;
}

/**
 * Does `atoms[i]` end in an ASCII `,` `;` `:` that itself follows a Han
 * character? Then a break placed AFTER it renders as a space (see the comment
 * on {@link HAN}) and {@link breakLegal} refuses it.
 *
 * The mark can sit either inside the atom (`态,` never happens — a wide char is
 * its own atom — but `PR,` and `第2章,` do) or be the whole atom, in which case
 * the Han character is the tail of the PRECEDING atom and only when no space
 * separates them: `常态, 不是` has the mark after `态`, while `见 , 后` does not.
 */
export function hanAsciiPunctTail(atoms, i) {
  const a = atoms[i];
  if (!a || !/[,;:]$/.test(a.text)) return false;
  const inner = a.text.slice(0, -1);
  if (inner.length > 0) return HAN.test(inner[inner.length - 1]);
  if (a.sp) return false;         // whitespace before the mark — it follows nothing
  const prev = atoms[i - 1];
  return !!prev && HAN.test(prev.text[prev.text.length - 1]);
}

export function breakLegal(atoms, k) {
  const a = atoms[k - 1];
  const b = atoms[k];
  const last = a.text[a.text.length - 1];
  if (NO_BREAK_AFTER.includes(last)) return false;
  if (NO_BREAK_BEFORE.includes(b.text[0])) return false;
  if (hanAsciiPunctTail(atoms, k - 1)) return false;   // #12081 — renders as a space
  if (b.sp) return true;          // an existing space becomes the newline
  return a.cjk && b.cjk;          // segment break between two wide chars renders as nothing
}

function renderSeg(atoms, from, to, pfx) {
  let s = pfx;
  for (let i = from; i < to; i++) s += (i > from && atoms[i].sp ? ' ' : '') + atoms[i].text;
  return s;
}

// A break is refused when the tail it starts would read as a new markdown block.
// Tested on the tail alone: the continuation prefix is whitespace (or a repeated
// quote marker), which is the block context being CONTINUED, never a new one.
function startsBlock(atoms, k) {
  const tail = atoms[k].text + (atoms[k + 1] ? (atoms[k + 1].sp ? ' ' : '') + atoms[k + 1].text : '');
  return BLOCK_START.test(tail);
}

/**
 * The canonical wrapped form of one line. Greedy, and it only ever moves
 * WHITESPACE: a space becomes a newline, or a newline is inserted between two
 * wide characters. Returns `[line]` unchanged when the line already fits or when
 * no legal break exists — which is exactly the `unbreakable` exemption.
 */
export function wrapLine(line, limit = MAX_LINE_BYTES) {
  if (bytes(line) <= limit) return [line];
  const { head, cont, body } = splitPrefix(line);
  const trail = /\s*$/.exec(body)[0];
  const atoms = atomize(body.slice(0, body.length - trail.length));
  if (atoms.length === 0) return [line];
  const out = [];
  let from = 0;
  let pfx = head;
  for (;;) {
    const full = renderSeg(atoms, from, atoms.length, pfx);
    if (bytes(full) <= limit) { out.push(full); break; }
    let chosen = -1;
    for (let k = from + 1; k < atoms.length; k++) {
      if (!breakLegal(atoms, k) || startsBlock(atoms, k)) continue;
      if (bytes(renderSeg(atoms, from, k, pfx)) <= limit) chosen = k;
      else break;                 // segment length is monotonic in k
    }
    if (chosen === -1) {          // nothing fits: take the first legal break at all, if any
      for (let k = from + 1; k < atoms.length; k++) {
        if (breakLegal(atoms, k) && !startsBlock(atoms, k)) { chosen = k; break; }
      }
    }
    if (chosen === -1) { out.push(full); break; }
    out.push(renderSeg(atoms, from, chosen, pfx));
    from = chosen;
    pfx = cont;
  }
  out[out.length - 1] += trail;
  return out.length === 1 ? [line] : out;
}

/**
 * Classify one line of `text` at index `i` (0-based) given the block state the
 * scan carries. Returns an exemption key, `null` when the line is compliant, or
 * `'over'` when it is over budget and re-wrappable — the RED case.
 */
/** The block state a line-by-line scan carries. Both the gate and any re-wrap must advance it identically. */
export function initialState() {
  return { fence: false, frontMatter: false, quote: false };
}

const quoteMarks = (line) => [/「/g, /」/g, /『/g, /』/g].map((r) => (line.match(r) ?? []).length);

/** Advance the block state PAST `line` (index `i`, 0-based). Pure — returns a new state. */
export function advanceState(line, state, i) {
  const s = { ...state };
  if (i === 0 && line.trim() === '---') { s.frontMatter = true; return s; }
  if (state.frontMatter) { if (line.trim() === '---') s.frontMatter = false; return s; }
  if (isFence(line)) { s.fence = !s.fence; return s; }
  if (s.fence) return s;
  const [open, close, open2, close2] = quoteMarks(line);
  const opens = open + open2;
  const closes = close + close2;
  if (s.quote) { if (closes > 0 && closes >= opens) s.quote = false; }
  else if (opens > closes) s.quote = true;
  return s;
}

export function classifyLine(line, state) {
  if (state.frontMatter) return 'frontmatter';
  if (state.fence || isFence(line)) return 'fence';
  // A multi-line ruling quote is judged before the budget: its line structure is
  // the author's, and it stays whether or not this particular line is long.
  const [open, close, open2, close2] = quoteMarks(line);
  if (state.quote || open + open2 > close + close2) return bytes(line) <= MAX_LINE_BYTES ? null : 'quotation';
  if (bytes(line) <= MAX_LINE_BYTES) return null;
  if (isTableRow(line)) return 'table';
  if (isHeading(line)) return 'heading';
  if (isAnchoredDirective(line)) return 'anchored';
  if (/^\s*>/.test(line)) return 'blockquote';
  if (wrapLine(line).length === 1) return 'unbreakable';
  return 'over';
}

/** Scan a whole file; returns `{ offenders, exempt }`, offenders being 1-based line numbers. */
export function scanLineLengths(text) {
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  let state = initialState();
  const offenders = [];
  const exempt = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kind = classifyLine(line, state);
    state = advanceState(line, state, i);
    if (kind === 'over') offenders.push({ line: i + 1, bytes: bytes(line) });
    else if (kind) exempt.set(kind, (exempt.get(kind) ?? 0) + 1);
  }
  return { offenders, exempt };
}

// ─────────────────────────────────────────────────────────────────────────────
// The max-table-row-bytes pin (#11947). See MAX_TABLE_ROW_BYTES for why.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The widest markdown table row in `text`, in bytes, with its 1-based line
 * number. Fenced and front-matter regions are not table rows however they are
 * spelled, so the block state is carried exactly as {@link scanLineLengths}
 * carries it. A file with no table row measures 0 — that is a MEASUREMENT, not a
 * sentinel, and it is what seeds the pin of every such file.
 */
export function scanTableRows(text) {
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  let state = initialState();
  let widest = 0;
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const before = state;
    state = advanceState(line, state, i);
    if (before.fence || isFence(line) || before.frontMatter) continue;
    if (!isTableRow(line)) continue;
    const b = bytes(line);
    if (b > widest) { widest = b; at = i + 1; }
  }
  return { widest, line: at };
}

export function tableRowVerdict(rel, widest, at, pin) {
  if (pin === undefined) {
    return {
      ok: false,
      msg:
        `${rel} has no max-table-row-bytes pin — red, not a skip (#4690). Every file in the ` +
        'ceiling map carries one, seeded at its own widest table row, so an uncovered file is the ' +
        'one place a row could widen unmetered again.',
    };
  }
  if (widest > pin) {
    return {
      ok: false,
      msg:
        `${rel} has a ${widest}-byte table row at L${at}; the max-table-row-bytes pin is ${pin}. ` +
        'A table row is the one shape the 120-byte line rule cannot reach — a wrapped `|` row is a ' +
        'different table — so its width is metered here instead, and widening a cell costs zero ' +
        'lines. Move the row\'s detail into prose or a reference file, or consolidate two rows into ' +
        'one; either pays the pin down. There is no allowlist, and raising a pin requires a ' +
        'maintainer ruling quoted in the PR.',
    };
  }
  return { ok: true, msg: `${rel}: widest table row is ${widest} bytes (pin ${pin}; headroom ${pin - widest}).` };
}

export function lengthVerdict(rel, offenders) {
  if (offenders.length === 0) return { ok: true, msg: `${rel}: every line is within ${MAX_LINE_BYTES} bytes (or structurally exempt).` };
  const shown = offenders.slice(0, 5).map((o) => `L${o.line} (${o.bytes}B)`).join(', ');
  return {
    ok: false,
    msg:
      `${rel} has ${offenders.length} line(s) over the ${MAX_LINE_BYTES}-byte budget: ${shown}` +
      `${offenders.length > 5 ? `, +${offenders.length - 5} more` : ''}. ` +
      'The ratchet counts lines to price a per-session token read, so a long line is an unmetered tax — ' +
      'wrap each one at a legal break point (a space, or between two CJK characters), keeping its content ' +
      'byte-identical. Tables, fences, headings, front matter, line-anchored `Blocked-by:`-family directives ' +
      'and lines with no legal break point are already exempt by shape — the exemptions are structural and ' +
      'there is no allowlist to add a line to.',
  };
}

function run() {
  let failed = 0;
  for (const [rel, maxLines] of CEILINGS) {
    let text;
    try {
      text = readFileSync(new URL(rel, REPO_ROOT), 'utf8');
    } catch {
      console.error(`✗ check-skill-line-ratchet: cannot read ${rel} — red, not a skip (#4690).`);
      failed++;
      continue;
    }
    const lv = lengthVerdict(rel, scanLineLengths(text).offenders);
    if (!lv.ok) {
      failed++;
      console.error(`✗ check-skill-line-ratchet: ${lv.msg}`);
    }
    const tr = scanTableRows(text);
    const tv = tableRowVerdict(rel, tr.widest, tr.line, MAX_TABLE_ROW_BYTES.get(rel));
    if (!tv.ok) {
      failed++;
      console.error(`✗ check-skill-line-ratchet: ${tv.msg}`);
    } else {
      const slack = MAX_TABLE_ROW_BYTES.get(rel) - tr.widest;
      if (slack > 0) {
        console.log(`ℹ️  ${rel}: max-table-row-bytes headroom is ${slack} — every pin is seeded at 0 headroom, so a row has been paid down; lower the pin to ${tr.widest} (shrink-only ratchets tighten opportunistically).`);
      }
      console.log(`✓ check-skill-line-ratchet: ${tv.msg}`);
    }
    const v = verdict(rel, countLines(text), maxLines);
    if (!v.ok) {
      failed++;
      console.error(`✗ check-skill-line-ratchet: ${v.msg}`);
      continue;
    }
    if (maxLines - countLines(text) > 120) {
      console.log(`ℹ️  ${rel}: headroom is ${maxLines - countLines(text)} lines — consider lowering its ceiling (shrink-only ratchets tighten opportunistically).`);
    }
    console.log(`✓ check-skill-line-ratchet: ${v.msg}`);
  }
  for (const [dest, move] of CROSS_FILE_MOVES) {
    const mv = crossFileMoveVerdict(dest, move, CEILINGS);
    if (!mv.ok) {
      failed++;
      console.error(`✗ check-skill-line-ratchet: ${mv.msg}`);
    } else {
      console.log(`✓ check-skill-line-ratchet: ${mv.msg}`);
    }
  }
  const totals = crossFileMoveTotalVerdict(CROSS_FILE_MOVES, CEILINGS);
  if (!totals.ok) {
    failed++;
    console.error(`✗ check-skill-line-ratchet: ${totals.msg}`);
  } else {
    console.log(`✓ check-skill-line-ratchet: ${totals.msg}`);
  }
  if (failed) process.exit(1);
}

// -- The self-test's own battery roster and floor (#13489) ------------------
//
// `--self-test` reaching its verdict used to be this self-test's ONLY success
// condition, so "every case held" and "the cases never ran" printed the same
// line. Closed the PR #13487 way: what is pinned is the registered NAMES, not a
// number.
//
// This self-test is TABLE-DRIVEN -- one `cases` table, one loop over it, and a
// sink (`failed++`) that writes only when a case FAILS. Routing THAT sink
// through `registerCase()` would register a case only when it fails: a fully
// green run would register 0 and every battery would read DID NOT RUN, the
// floor inverted rather than installed. So the roster is the table's own rows.
// Each row LABEL is a declared battery, verbatim, with a floor of 1, and
// `registerCase(name)` is the first statement of the driving loop body -- so the
// case is attributed to the row actually being run. There is no `battery()`
// opener: for a table-driven self-test the ROW is the battery.
//
// ⭐ ALL 155 rows are floored, the four `...(() => { ... })()` spreads included.
// Those spreads were flagged in the batch-8 census as an IIFE-produced block
// whose rows could not take a literal roster key. Measured here, that premise
// does not hold for this file: each IIFE is a SCOPING device that declares
// local fixture consts and then `return [...]`s an array of LITERAL
// `[label, actual, expected]` rows. No row label is a template string, none is
// computed, and no row is produced by a `map`/`push`/loop. Three independent
// readings agree on 155 -- the source labels extracted by indentation, the
// literal row starts, and the `cases.length` the green line prints on a run --
// so nothing here is the `extra`-call residue of PR #15286, and leaving any row
// outside the roster would have been the lossy reading.
//
// A pinned TOTAL is not the repair, and neither is a roster DERIVED from the
// table: `cases.length` moves with the table, so a deleted row would delete its
// own floor. The roster below is a LITERAL the table is checked against, which
// is what lets a deleted or renamed row name ITSELF in the refusal.
//
// The counts are a FLOOR, not an equality -- a row that grows into several
// registrations must not red. 1 is the honest floor for a table row: the loop
// reaches it exactly once per run.
const SELF_TEST_BATTERIES = Object.freeze({
  'under the ceiling -> green': 1,
  'at the ceiling -> green': 1,
  'over the ceiling -> red': 1,
  'red message names the file': 1,
  'red message names the remedy': 1,
  'red message names the authoring rule': 1,
  'empty read -> red, not a skip': 1,
  'every covered file has a positive ceiling': 1,
  'SKILL.md is covered': 1,
  'the dev-agent definition is covered': 1,
  'all five compressed references are covered': 1,
  'all eight lane/seat job descriptions are covered': 1,
  'the other four skills are covered (#9473)': 1,
  'root AGENTS.md is covered (#9792)': 1,
  'root CLAUDE.md is covered (#9965)': 1,
  'references/compile-surfaces.md is covered (#12098)': 1,
  'every separator-less ceiling declares a root-file watch hint': 1,
  'and the declaration names no file the map does not cover': 1,
  'both root instruction files are declared': 1,
  'the declared form is NOT a CEILINGS key': 1,
  'the published skills/ catalog is deliberately uncovered': 1,
  'budget is 120 bytes': 1,
  'a short ASCII line -> green': 1,
  'a long ASCII line -> RED': 1,
  'a short CJK line -> green': 1,
  'a long CJK line -> RED': 1,
  'the RED message names the budget': 1,
  'the RED message names the line number': 1,
  'the RED message offers NO allowlist to add a line to': 1,
  'no offenders -> green verdict': 1,
  'a long line inside a fence is exempt': 1,
  '...and the SAME line outside one is RED': 1,
  'scan: a fenced long line yields no offender': 1,
  'scan: the fence closes again': 1,
  'a long table row is exempt': 1,
  '...and the same cells as prose are RED': 1,
  'a long heading is exempt': 1,
  '...and the same text as a paragraph is RED': 1,
  'front matter is exempt': 1,
  'scan: front matter closes at the second ---': 1,
  'an anchored Blocked-by: line is exempt': 1,
  'Restart-when: too': 1,
  'Restart-touch: too': 1,
  'but a MID-PROSE mention is not exempt — the escape hatch is line-anchored only': 1,
  'a long blockquote line is exempt': 1,
  '...including one indented inside a list': 1,
  '...and the same quotation unquoted is RED': 1,
  'a bare over-long URL is exempt': 1,
  'a single over-long code span is exempt': 1,
  '...but prose LEADING to that URL is RED (wrap first, URL lands alone)': 1,
  'wrapLine splits a long CJK line': 1,
  'every wrapped CJK segment is within budget': 1,
  'wrapping a CJK line changes NOTHING but whitespace': 1,
  'wrapping an ASCII line changes NOTHING but whitespace': 1,
  'a list continuation is indented under the marker': 1,
  'no continuation line opens a new markdown block': 1,
  'wrapLine is idempotent — its output is the canonical form': 1,
  'wrapLine leaves a short line untouched': 1,
  'wrapLine never breaks inside a code span': 1,
  'wrapLine never breaks inside a 「…」 ruling quote': 1,
  '...nor inside a 『…』 one': 1,
  'a quote longer than the budget makes its line unbreakable, not RED': 1,
  'a line OPENING an unterminated 「 is exempt': 1,
  'a line INSIDE an open quote is exempt': 1,
  '...and the same line outside one is RED — the exemption is the quote, not the text': 1,
  'a SHORT line inside a quote is simply green, not counted exempt': 1,
  'advanceState opens on an unmatched 「': 1,
  'advanceState closes on the matching 」': 1,
  'a quote opened and closed on ONE line does not open the state': 1,
  'advanceState does not track quotes inside a fence': 1,
  'scan: a two-line quote yields quotation exemptions, not offenders': 1,
  'wrapLine never strands a closing 。 at a line head': 1,
  'an ASCII , after a Han character is a no-break-after mark': 1,
  '...and ; and : are the same mark class': 1,
  '...but after a LATIN word it stays an ordinary break point': 1,
  '...and a mark with a space before it follows nothing': 1,
  '...and an atom not ending in one is never the mark': 1,
  'breakLegal refuses the break after a Han+ASCII mark': 1,
  '...a mark with no following space was never a break point to begin with': 1,
  '...still allows the CJK-to-CJK break one atom earlier': 1,
  '...and still allows an ordinary ASCII space break': 1,
  'wrapLine splits the trap line': 1,
  'no wrapped line ends on a Han+ASCII mark — the break is no longer OFFERED': 1,
  '...the line it took instead is still within budget': 1,
  '...and it moved only whitespace, as every wrap must': 1,
  'the SAME shape with a Latin word before the mark still breaks there': 1,
  'wrapLine is still idempotent under the new rule': 1,
  'a long table row is EXEMPT from the 120-byte line rule': 1,
  '...and the same row is METERED by its file pin': 1,
  'at exactly the pin -> green': 1,
  'one byte wider -> RED (widening a cell is the measured defect)': 1,
  'narrower than the pin -> green': 1,
  'a pin of 0 is a measurement — a file with no table row passes it': 1,
  '...and the FIRST table row in such a file is RED': 1,
  'a missing pin is RED, not a skip (#4690)': 1,
  '...and says so rather than naming a width': 1,
  'the RED message names the width': 1,
  'the RED message names the line': 1,
  'the RED message names the remedy': 1,
  'the RED message names consolidation as the way to pay it down': 1,
  'the RED message offers NO allowlist': 1,
  'the RED message says raising needs a maintainer ruling': 1,
  'scanTableRows finds the widest row': 1,
  '...and reports its line number': 1,
  'a `|` line inside a FENCE is not a table row': 1,
  'a `|` line in FRONT MATTER is not a table row': 1,
  'a file with no table row measures 0': 1,
  'every ceilinged file carries a pin': 1,
  'and the pin map names no file the ceiling map does not cover': 1,
  'every pin is a non-negative integer': 1,
  'the published skills/ catalog is uncovered here too': 1,
  'the citation is the ruling this file was given': 1,
  'cross-file move — a raise covered by its sources\' net decrease PASSES': 1,
  '...and the green verdict states the arithmetic it read': 1,
  'cross-file move — a raise whose sources did NOT shrink is RED (the whole defect: a `move` that licenses an ordinary raise would run green forever)': 1,
  '...and the RED verdict names the raise and the net decrease it fell short of': 1,
  '...and sends the author to the ordinary path rather than to a bigger declaration': 1,
  'cross-file move — a raise EXCEEDING the net decrease is RED, even by one line': 1,
  '...while a raise exactly equal to it is legal': 1,
  'cross-file move — a declaration citing no ruling is RED, however sound its arithmetic': 1,
  '...and the RED verdict spells the citation it wanted': 1,
  'cross-file move — declarations whose net movement is 0 leave the map total unchanged': 1,
  'cross-file move — a declaration whose participants net POSITIVE fails the total (+2 here)': 1,
  '...and the RED total names the lines it grew by': 1,
  '...and a net-negative move reports the corpus shrinking': 1,
  'cross-file move — one source may not pay for two destinations': 1,
  'cross-file move — a destination lowered back to or below its pre-move ceiling reads as PAID DOWN, never as red (lowering is always legitimate)': 1,
  '...and says so rather than reporting an arithmetic it can no longer measure': 1,
  'cross-file move — a SOURCE grown back past what it paid re-opens the move (the loophole: the destination keeps the lines while the payers grow back)': 1,
  'cross-file move — an unknown destination is RED, not a skip (#4690)': 1,
  'cross-file move — an unknown source is RED, not a skip (#4690)': 1,
  'cross-file move — a file may not pay its own raise': 1,
  'cross-file move — a declaration naming no source at all is RED': 1,
  'every live declaration cites the ruling': 1,
  'every live declaration names its destination\'s pre-move ceiling and at least one source': 1,
  'every live participant is a file this map covers': 1,
  'ruled raise — a destination that later took an ordinary ruled raise PASSES with `was` at its literal pre-move value': 1,
  '...and the verdict prices the MOVE, not the ruling: +10 against the sources\' net 11': 1,
  '...and names the ruled lines it took out, so the arithmetic can be read back': 1,
  '...while the SAME tree with the raise unrecorded is the double red this record ends': 1,
  '...whose first half reads the ruling as the move\'s: +44 against 11': 1,
  '...and which now sends the author to the record rather than to `was`': 1,
  'ruled raise — the map-wide total subtracts it too, and reads the corpus DOWN 1': 1,
  '...where the unrecorded twin reports the corpus growing by 33': 1,
  'ruled raise — a record quoting NO ruling is RED (the licence is the maintainer\'s or it does not exist)': 1,
  '...and the RED verdict says what it wanted': 1,
  '...while an ENGLISH ruling quoted the way this map already quotes one passes': 1,
  'ruled raise — a record with no line count is RED': 1,
  'ruled raise — a NEGATIVE line count is RED: lowering is always legitimate and is never recorded here': 1,
  'ruled raise — a record with no ruling DATE is RED': 1,
  'ruled raise — records claiming MORE lines than the ceiling stands above `was` are RED': 1,
  '...which is the loophole that closes: an inflated record would otherwise read the move as paid down and pass forever': 1,
  'ruled raise — a destination whose whole rise is ruled keeps none of it for the move, and reads as paid down': 1,
  'ruled raise — a declaration carrying no record behaves exactly as before (every case above this group is one)': 1,
  'every live ruled-raise record quotes its ruling, dates it, and names a positive line count': 1,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. This pin is also half of
// the duplicate-label refusal: two rows sharing a label collapse to ONE key in
// the literal above, so the roster falls below this number; the table
// cross-check in the floor block is the other half, and names WHICH label
// collided.
const SELF_TEST_BATTERY_FLOOR = 155;

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-skill-line-ratchet self-test reached its verdict';

function selfTest() {
  const rel = '.claude/skills/pm-dispatch/SKILL.md';
  const cases = [
    ['under the ceiling -> green', verdict(rel, 2900, 3050).ok, true],
    ['at the ceiling -> green', verdict(rel, 3050, 3050).ok, true],
    ['over the ceiling -> red', verdict(rel, 3051, 3050).ok, false],
    ['red message names the file', verdict(rel, 9999, 3050).msg.includes(rel), true],
    ['red message names the remedy', verdict(rel, 9999, 3050).msg.includes('references/'), true],
    ['red message names the authoring rule', verdict(rel, 9999, 3050).msg.includes('stories live on cards'), true],
    ['empty read -> red, not a skip', verdict(rel, 0, 3050).ok, false],
    ['every covered file has a positive ceiling', [...CEILINGS.values()].every((n) => Number.isInteger(n) && n > 0), true],
    ['SKILL.md is covered', CEILINGS.has('.claude/skills/pm-dispatch/SKILL.md'), true],
    ['the dev-agent definition is covered', CEILINGS.has('.claude/agents/os-dev.md'), true],
    ['all five compressed references are covered', ['dispatch-runbook', 'platform-readings', 'review-checklist', 'landing-operations', 'seat-post-protocol'].every((n) => CEILINGS.has(`.claude/skills/pm-dispatch/references/${n}.md`)), true],
    ['all eight lane/seat job descriptions are covered', ['engine', 'services', 'cli', 'devx', 'skills', 'spec', 'hotcrm', 'director'].every((n) => CEILINGS.has(`.claude/skills/pm-dispatch/references/lanes/${n}.md`)), true],
    ['the other four skills are covered (#9473)', ['checklist-test', 'checklist-author', 'dogfood-verification', 'spec-property-retirement'].every((n) => CEILINGS.has(`.claude/skills/${n}/SKILL.md`)), true],
    ['root AGENTS.md is covered (#9792)', CEILINGS.has('AGENTS.md'), true],
    ['root CLAUDE.md is covered (#9965)', CEILINGS.has('CLAUDE.md'), true],
    // #12098: the last uncovered pm-dispatch references file. Found by
    // enumerating the directory against this map, not by noticing one file.
    ['references/compile-surfaces.md is covered (#12098)', CEILINGS.has('.claude/skills/pm-dispatch/references/compile-surfaces.md'), true],
    // The dispatch-gates declaration (#9964). Enforcement cannot hold any of
    // these: the declaration is read by another tool entirely, so a wrong or
    // missing entry runs perfectly green here and only shows up as a dev
    // dispatched on a root-file card with an empty gate brief.
    ['every separator-less ceiling declares a root-file watch hint', [...CEILINGS.keys()].filter((k) => !k.includes('/')).every((k) => ROOT_FILE_WATCH_HINTS.includes(`${k}/**`)), true],
    ['and the declaration names no file the map does not cover', ROOT_FILE_WATCH_HINTS.every((h) => CEILINGS.has(h.replace(/\/\*+$/, ''))), true],
    ['both root instruction files are declared', ROOT_FILE_WATCH_HINTS.join(',') === 'AGENTS.md/**,CLAUDE.md/**', true],
    // Provenance, never a lookup key: `run` opens every CEILINGS key, so the
    // glob form appearing there would make the ratchet read a path that does
    // not exist — red under #4690's cannot-read rule, for a file that is fine.
    ['the declared form is NOT a CEILINGS key', [...CEILINGS.keys()].some((k) => ROOT_FILE_WATCH_HINTS.includes(k)), false],
    // The boundary the header states, pinned (#9923). Enforcement cannot hold
    // it: a ceiling on a real published SKILL.md runs green like any other row,
    // so without this case the header paragraph could drift from the map
    // silently. Extending coverage to the published catalog is a policy change
    // — it lands with a maintainer ruling that also deletes this case.
    ['the published skills/ catalog is deliberately uncovered', [...CEILINGS.keys()].some((k) => k.startsWith('skills/')), false],
    // ── The max-line-length rule (#11106): red/green pairs, one per class ────
    // Each pair is the SAME content in a compliant and a non-compliant shape, so
    // a case can only pass by the rule actually discriminating. The exemption
    // cases carry a RED twin in a non-exempt shape for the same reason: an
    // exemption that swallowed everything would run green against a bare assert.
    ...(() => {
      const clean = { fence: false, frontMatter: false };
      const asciiShort = `- ${'word '.repeat(20).trim()}`;                       // 104 bytes
      const asciiLong = `- ${'word '.repeat(30).trim()}`;                        // 154 bytes
      const cjkShort = `${'中文内容'.repeat(9)}。`;                                // 111 bytes
      const cjkLong = `${'中文内容'.repeat(20)}。`;                                // 243 bytes
      const url = `  <https://example.invalid/${'x'.repeat(200)}>`;
      const wrapped = wrapLine(cjkLong);
      const wrappedAscii = wrapLine(asciiLong);
      return [
        ['budget is 120 bytes', MAX_LINE_BYTES, 120],
        ['a short ASCII line -> green', classifyLine(asciiShort, clean), null],
        ['a long ASCII line -> RED', classifyLine(asciiLong, clean), 'over'],
        ['a short CJK line -> green', classifyLine(cjkShort, clean), null],
        ['a long CJK line -> RED', classifyLine(cjkLong, clean), 'over'],
        ['the RED message names the budget', lengthVerdict('f.md', [{ line: 1, bytes: 200 }]).msg.includes('120-byte'), true],
        ['the RED message names the line number', lengthVerdict('f.md', [{ line: 7, bytes: 200 }]).msg.includes('L7'), true],
        ['the RED message offers NO allowlist to add a line to', lengthVerdict('f.md', [{ line: 1, bytes: 200 }]).msg.includes('no allowlist'), true],
        ['no offenders -> green verdict', lengthVerdict('f.md', []).ok, true],
        // E1 fence
        ['a long line inside a fence is exempt', classifyLine(cjkLong, { fence: true, frontMatter: false }), 'fence'],
        ['...and the SAME line outside one is RED', classifyLine(cjkLong, clean), 'over'],
        ['scan: a fenced long line yields no offender', scanLineLengths(`\`\`\`js\n// ${'x'.repeat(200)}\n\`\`\`\n`).offenders.length, 0],
        ['scan: the fence closes again', scanLineLengths(`\`\`\`\nx\n\`\`\`\n${cjkLong}\n`).offenders.length, 1],
        // E2 table
        ['a long table row is exempt', classifyLine(`| a | ${cjkLong} |`, clean), 'table'],
        ['...and the same cells as prose are RED', classifyLine(`a ${cjkLong}`, clean), 'over'],
        // E3 heading / front matter
        ['a long heading is exempt', classifyLine(`## ${cjkLong}`, clean), 'heading'],
        ['...and the same text as a paragraph is RED', classifyLine(cjkLong, clean), 'over'],
        ['front matter is exempt', classifyLine(`description: ${cjkLong}`, { fence: false, frontMatter: true }), 'frontmatter'],
        ['scan: front matter closes at the second ---', scanLineLengths(`---\nname: x\n---\n${cjkLong}\n`).offenders.length, 1],
        // E4 line-anchored directives — 行锚定 doctrine
        ['an anchored Blocked-by: line is exempt', classifyLine(`Blocked-by: #1 ${cjkLong}`, clean), 'anchored'],
        ['Restart-when: too', classifyLine(`- \`Restart-when: closed o/r#1\` ${cjkLong}`, clean), 'anchored'],
        ['Restart-touch: too', classifyLine(`> Restart-touch: a/b.ts ${cjkLong}`, clean), 'anchored'],
        ['but a MID-PROSE mention is not exempt — the escape hatch is line-anchored only', classifyLine(`${cjkLong} \`Blocked-by:\``, clean), 'over'],
        // E6 blockquote — wrapping one would INSERT a `>`, i.e. a content edit
        ['a long blockquote line is exempt', classifyLine(`> ${cjkLong}`, clean), 'blockquote'],
        ['...including one indented inside a list', classifyLine(`    > ${cjkLong}`, clean), 'blockquote'],
        ['...and the same quotation unquoted is RED', classifyLine(cjkLong, clean), 'over'],
        // E5 unbreakable — the class that keeps the gate from demanding the impossible
        ['a bare over-long URL is exempt', classifyLine(url, clean), 'unbreakable'],
        ['a single over-long code span is exempt', classifyLine(`\`${'p/'.repeat(80)}\``, clean), 'unbreakable'],
        ['...but prose LEADING to that URL is RED (wrap first, URL lands alone)', classifyLine(`${cjkShort} ${url.trim()}`, clean), 'over'],
        // wrapLine: the canonical form, and it only ever moves whitespace
        ['wrapLine splits a long CJK line', wrapped.length > 1, true],
        ['every wrapped CJK segment is within budget', wrapped.every((l) => Buffer.byteLength(l, 'utf8') <= 120), true],
        ['wrapping a CJK line changes NOTHING but whitespace', wrapped.join('').replace(/\s+/g, ''), cjkLong.replace(/\s+/g, '')],
        ['wrapping an ASCII line changes NOTHING but whitespace', wrappedAscii.join(' ').replace(/\s+/g, ' '), asciiLong],
        ['a list continuation is indented under the marker', wrappedAscii.slice(1).every((l) => l.startsWith('  ') && !l.startsWith('   ')), true],
        ['no continuation line opens a new markdown block', [...wrapped.slice(1), ...wrappedAscii.slice(1)].every((l) => !/^([-*+>|]|#{1,6}|\d+[.)])(\s|$)/.test(l.trimStart())), true],
        ['wrapLine is idempotent — its output is the canonical form', wrapped.flatMap((l) => wrapLine(l)).join('\n'), wrapped.join('\n')],
        ['wrapLine leaves a short line untouched', wrapLine(cjkShort), [cjkShort]],
        ['wrapLine never breaks inside a code span', wrapLine(`${cjkShort} \`a b c d\` ${cjkShort}`).every((l) => (l.match(/`/g) ?? []).length % 2 === 0), true],
        // A verbatim ruling quote is grep-visible only while it stays on one line.
        ['wrapLine never breaks inside a 「…」 ruling quote', wrapLine(`${cjkShort}(维护者指示:「我们是一个创业项目,核心能力优先」)${cjkShort}`).every((l) => (l.match(/[「」]/g) ?? []).length !== 1), true],
        ['...nor inside a 『…』 one', wrapLine(`${cjkShort}『${'引文'.repeat(12)}』${cjkShort}`).every((l) => (l.match(/[『』]/g) ?? []).length !== 1), true],
        ['a quote longer than the budget makes its line unbreakable, not RED', classifyLine(`「${'引文'.repeat(30)}」`, clean), 'unbreakable'],
        // E7 multi-line ruling quotes — line structure preserved, not re-flowed
        ['a line OPENING an unterminated 「 is exempt', classifyLine(`维护者指示:「${'引文'.repeat(30)}`, clean), 'quotation'],
        ['a line INSIDE an open quote is exempt', classifyLine(cjkLong, { fence: false, frontMatter: false, quote: true }), 'quotation'],
        ['...and the same line outside one is RED — the exemption is the quote, not the text', classifyLine(cjkLong, clean), 'over'],
        ['a SHORT line inside a quote is simply green, not counted exempt', classifyLine(cjkShort, { fence: false, frontMatter: false, quote: true }), null],
        ['advanceState opens on an unmatched 「', advanceState('说:「引文', initialState(), 3).quote, true],
        ['advanceState closes on the matching 」', advanceState('引文结束」后续', { fence: false, frontMatter: false, quote: true }, 4).quote, false],
        ['a quote opened and closed on ONE line does not open the state', advanceState('说:「引文」完', initialState(), 3).quote, false],
        ['advanceState does not track quotes inside a fence', advanceState('说:「引文', { fence: true, frontMatter: false, quote: false }, 3).quote, false],
        ['scan: a two-line quote yields quotation exemptions, not offenders', scanLineLengths(`维护者:「${'引'.repeat(60)}\n${'文'.repeat(60)}」\n`).offenders.length, 0],
        ['wrapLine never strands a closing 。 at a line head', wrapped.slice(1).every((l) => !'。,、;:?!)]}'.includes(l.trimStart()[0])), true],
      ];
    })(),
    // ── #12081: no break after an ASCII `,;:` that follows a Han character ───
    // Every case is a PAIR discriminating on the Han condition alone, because
    // the failure mode of a blunt fix is silently forbidding the ASCII-prose
    // comma break too, which no corpus line would ever reveal.
    ...(() => {
      const hanComma = atomize('常态,不是许可');           // 常 态 , 不 是 许 可
      const hanCommaSpaced = atomize('常态, 不是');        // 常 态 , 不(sp) 是
      const asciiComma = atomize('first, second');       // "first," · "second"
      const spaced = atomize('常态 , 不是');               // the mark follows a space
      // The one shape where the OLD wrapper actually took the break: the atom
      // after the mark carries a space and is too long to append, so the only
      // segment that fits ends ON the mark.
      const hanTrap = `${'中文内容'.repeat(9)}, \`${'p/'.repeat(40)}\``;
      const latinTwin = `${'word '.repeat(18)}end, \`${'p/'.repeat(40)}\``;
      const wrappedTrap = wrapLine(hanTrap);
      const wrappedTwin = wrapLine(latinTwin);
      return [
        ['an ASCII , after a Han character is a no-break-after mark', hanAsciiPunctTail(hanComma, 2), true],
        ['...and ; and : are the same mark class', ['常态;不是', '常态:不是'].every((s) => hanAsciiPunctTail(atomize(s), 2)), true],
        ['...but after a LATIN word it stays an ordinary break point', hanAsciiPunctTail(asciiComma, 0), false],
        ['...and a mark with a space before it follows nothing', hanAsciiPunctTail(spaced, 2), false],
        ['...and an atom not ending in one is never the mark', hanAsciiPunctTail(hanComma, 1), false],
        ['breakLegal refuses the break after a Han+ASCII mark', breakLegal(hanCommaSpaced, 3), false],
        // Why only ONE shape ever leaked, pinned so the case above cannot pass
        // for the wrong reason: with no space after the mark there was never a
        // legal break there anyway (neither side is wide), so the defect could
        // only enter where the author had written `, ` and the wrapper spent it.
        ['...a mark with no following space was never a break point to begin with', breakLegal(hanComma, 3), false],
        ['...still allows the CJK-to-CJK break one atom earlier', breakLegal(hanComma, 1), true],
        ['...and still allows an ordinary ASCII space break', breakLegal(asciiComma, 1), true],
        // End to end, on the shape that used to produce the defect.
        ['wrapLine splits the trap line', wrappedTrap.length > 1, true],
        ['no wrapped line ends on a Han+ASCII mark — the break is no longer OFFERED', wrappedTrap.every((l) => !/\p{Script=Han}[,;:]$/u.test(l)), true],
        ['...the line it took instead is still within budget', wrappedTrap.every((l) => Buffer.byteLength(l, 'utf8') <= 120), true],
        ['...and it moved only whitespace, as every wrap must', wrappedTrap.join('').replace(/\s+/g, ''), hanTrap.replace(/\s+/g, '')],
        // The RED twin: identical shape, Latin before the mark. If this one also
        // stopped breaking, the rule would be over-broad and the case above
        // would pass for the wrong reason.
        ['the SAME shape with a Latin word before the mark still breaks there', wrappedTwin.some((l) => l.endsWith('end,')), true],
        ['wrapLine is still idempotent under the new rule', wrappedTrap.flatMap((l) => wrapLine(l)).join('\n'), wrappedTrap.join('\n')],
      ];
    })(),
    // ── #11947: the per-file max-table-row-bytes pin ────────────────────────
    ...(() => {
      const row = `| a | ${'中文内容'.repeat(20)} |`;      // 6 + 240 + 2 = 248 bytes
      const doc = `# t\n\n| a | b |\n|---|---|\n${row}\n`; // the row lands on line 5
      const fenced = `\`\`\`\n| a | ${'x'.repeat(200)} |\n\`\`\`\n`;
      const clean = { fence: false, frontMatter: false };
      const red = tableRowVerdict('f.md', 999, 3, 100);
      return [
        // The pairing that IS this card: the length rule exempts the row by
        // shape, and the pin meters the same row instead. A case asserting only
        // one half would pass under either control alone.
        ['a long table row is EXEMPT from the 120-byte line rule', classifyLine(row, clean), 'table'],
        ['...and the same row is METERED by its file pin', tableRowVerdict('f.md', 248, 5, 247).ok, false],
        ['at exactly the pin -> green', tableRowVerdict('f.md', 248, 5, 248).ok, true],
        ['one byte wider -> RED (widening a cell is the measured defect)', tableRowVerdict('f.md', 249, 5, 248).ok, false],
        ['narrower than the pin -> green', tableRowVerdict('f.md', 100, 5, 248).ok, true],
        ['a pin of 0 is a measurement — a file with no table row passes it', tableRowVerdict('f.md', 0, 0, 0).ok, true],
        ['...and the FIRST table row in such a file is RED', tableRowVerdict('f.md', 30, 4, 0).ok, false],
        ['a missing pin is RED, not a skip (#4690)', tableRowVerdict('f.md', 0, 0, undefined).ok, false],
        ['...and says so rather than naming a width', tableRowVerdict('f.md', 0, 0, undefined).msg.includes('no max-table-row-bytes pin'), true],
        ['the RED message names the width', red.msg.includes('999-byte'), true],
        ['the RED message names the line', red.msg.includes('L3'), true],
        ['the RED message names the remedy', red.msg.includes('reference file'), true],
        ['the RED message names consolidation as the way to pay it down', red.msg.includes('consolidate'), true],
        ['the RED message offers NO allowlist', red.msg.includes('no allowlist'), true],
        ['the RED message says raising needs a maintainer ruling', red.msg.includes('maintainer ruling'), true],
        // scanTableRows — the seed instrument. The pins were read from it, so a
        // wrong scan would have written wrong pins that then ran green forever.
        ['scanTableRows finds the widest row', scanTableRows(doc).widest, 248],
        ['...and reports its line number', scanTableRows(doc).line, 5],
        ['a `|` line inside a FENCE is not a table row', scanTableRows(fenced).widest, 0],
        ['a `|` line in FRONT MATTER is not a table row', scanTableRows('---\n| a |\n---\n').widest, 0],
        ['a file with no table row measures 0', scanTableRows('中文内容\n').widest, 0],
        // The two maps must stay in step; enforcement cannot hold this, because
        // a file missing from the pin map is simply never consulted.
        ['every ceilinged file carries a pin', [...CEILINGS.keys()].every((k) => MAX_TABLE_ROW_BYTES.has(k)), true],
        ['and the pin map names no file the ceiling map does not cover', [...MAX_TABLE_ROW_BYTES.keys()].every((k) => CEILINGS.has(k)), true],
        ['every pin is a non-negative integer', [...MAX_TABLE_ROW_BYTES.values()].every((n) => Number.isInteger(n) && n >= 0), true],
        ['the published skills/ catalog is uncovered here too', [...MAX_TABLE_ROW_BYTES.keys()].some((k) => k.startsWith('skills/')), false],
      ];
    })(),
    // ── The cross-file move (the 2026-09-03 ruling) ─────────────────────────
    // Every case is a PAIR or a near-twin of a legal declaration, because the
    // failure mode of a loose implementation is a `move` that licenses an
    // ordinary raise — which would run green forever and retire the ratchet.
    ...(() => {
      const ceil = (o) => new Map(Object.entries(o));
      const cited = `moved from a.md + b.md — ${RULING_CITATION}`;
      const decl = { ruling: cited, was: 100, sources: [['a.md', 30], ['b.md', 20]] };
      // Paid: dest +5 against sources that shed 3 and 4.
      const paid = ceil({ 'dest.md': 105, 'a.md': 27, 'b.md': 16 });
      // Same declaration, sources untouched — the raise nobody paid for.
      const unpaid = ceil({ 'dest.md': 105, 'a.md': 30, 'b.md': 20 });
      // Paid in part only: +5 against a net decrease of 3.
      const short = ceil({ 'dest.md': 105, 'a.md': 27, 'b.md': 20 });
      // The destination lowered again after the move landed.
      const paidDown = ceil({ 'dest.md': 98, 'a.md': 27, 'b.md': 16 });
      // A source grown back after the move landed: the payment undone.
      const regrown = ceil({ 'dest.md': 105, 'a.md': 33, 'b.md': 16 });
      const uncited = { ...decl, ruling: 'moved from a.md + b.md' };
      const mv = (map, d = decl) => crossFileMoveVerdict('dest.md', d, map);
      const total = (map, moves) => crossFileMoveTotalVerdict(new Map(moves), map);
      // The shape this separation exists for, at the real numbers it was measured
      // on: a live move whose destination later took an ORDINARY ruled raise. The
      // ceilings are platform-readings.md's and its three sources', so the pin
      // fails if the two quantities are ever folded back together.
      const readings = ceil({ 'dest.md': 358, 'a.md': 31, 'b.md': 28, 'c.md': 88 });
      const ruledRec = { ruling: 'maintainer, 2026-09-04, verbatim: 「同意」', date: '2026-09-04', delta: 34 };
      const moved = { ...decl, was: 314, sources: [['a.md', 35], ['b.md', 30], ['c.md', 93]] };
      const withRuled = { ...moved, ruledRaises: [ruledRec] };
      const rr = (over) => crossFileMoveVerdict('dest.md', { ...moved, ruledRaises: [{ ...ruledRec, ...over }] }, readings);
      const mvR = (d = withRuled) => crossFileMoveVerdict('dest.md', d, readings);
      return [
        ['the citation is the ruling this file was given', RULING_CITATION, '#14685 item 5 (comment 5520452691)'],
        // (1) A legal move passes — the assertion the other three are read against.
        ['cross-file move — a raise covered by its sources\' net decrease PASSES', mv(paid).ok, true],
        ['...and the green verdict states the arithmetic it read', mv(paid).msg.includes('+5') && mv(paid).msg.includes('decrease of 7'), true],
        // (2) A raise with no decrease behind it is an ordinary raise.
        ['cross-file move — a raise whose sources did NOT shrink is RED (the whole defect: a `move` that licenses an ordinary raise would run green forever)', mv(unpaid).ok, false],
        ['...and the RED verdict names the raise and the net decrease it fell short of', mv(unpaid).msg.includes('+5') && mv(unpaid).msg.includes('decrease of 0'), true],
        ['...and sends the author to the ordinary path rather than to a bigger declaration', mv(unpaid).msg.includes('maintainer ruling quoted in the raising PR'), true],
        // (3) Partly paid is not paid — the boundary case, one line short.
        ['cross-file move — a raise EXCEEDING the net decrease is RED, even by one line', mv(short).ok, false],
        ['...while a raise exactly equal to it is legal', crossFileMoveVerdict('dest.md', { ...decl, was: 98 }, ceil({ 'dest.md': 105, 'a.md': 27, 'b.md': 16 })).ok, true],
        // (4) The citation. A raise that names no ruling is not a move at all.
        ['cross-file move — a declaration citing no ruling is RED, however sound its arithmetic', mv(paid, uncited).ok, false],
        ['...and the RED verdict spells the citation it wanted', mv(paid, uncited).msg.includes(RULING_CITATION), true],
        // (5) Condition (b), map-wide. Stated separately because it is the
        // ruling's own wording; over disjoint participants it follows from (a).
        ['cross-file move — declarations whose net movement is 0 leave the map total unchanged', total(paid, [['dest.md', decl]]).ok, true],
        ['cross-file move — a declaration whose participants net POSITIVE fails the total (+2 here)', total(short, [['dest.md', decl]]).ok, false],
        ['...and the RED total names the lines it grew by', total(short, [['dest.md', decl]]).msg.includes('by 2 lines'), true],
        ['...and a net-negative move reports the corpus shrinking', total(paidDown, [['dest.md', decl]]).msg.includes('down 9 lines'), true],
        // (6) Disjointness — the one thing that makes (a) summed equal (b).
        ['cross-file move — one source may not pay for two destinations', total(ceil({ 'dest.md': 105, 'other.md': 105, 'a.md': 27, 'b.md': 16 }), [['dest.md', decl], ['other.md', { ruling: RULING_CITATION, was: 100, sources: [['a.md', 30]] }]]).ok, false],
        // (7) Lifecycle, both directions — asymmetric on purpose.
        ['cross-file move — a destination lowered back to or below its pre-move ceiling reads as PAID DOWN, never as red (lowering is always legitimate)', mv(paidDown).ok, true],
        ['...and says so rather than reporting an arithmetic it can no longer measure', mv(paidDown).msg.includes('paid down'), true],
        ['cross-file move — a SOURCE grown back past what it paid re-opens the move (the loophole: the destination keeps the lines while the payers grow back)', mv(regrown).ok, false],
        // (8) Participants must be files this map covers — a typo is RED, not a skip.
        ['cross-file move — an unknown destination is RED, not a skip (#4690)', crossFileMoveVerdict('nope.md', decl, paid).ok, false],
        ['cross-file move — an unknown source is RED, not a skip (#4690)', mv(paid, { ...decl, sources: [['nope.md', 30]] }).ok, false],
        ['cross-file move — a file may not pay its own raise', mv(paid, { ...decl, sources: [['dest.md', 130]] }).ok, false],
        ['cross-file move — a declaration naming no source at all is RED', mv(paid, { ...decl, sources: [] }).ok, false],
        // (9) The live map. Enforcement covers the arithmetic; what it cannot
        // cover is the shape of a declaration nobody has written yet, so the
        // fields every declaration must carry are pinned here.
        ['every live declaration cites the ruling', [...CROSS_FILE_MOVES.values()].every((m) => String(m.ruling ?? '').includes(RULING_CITATION)), true],
        ['every live declaration names its destination\'s pre-move ceiling and at least one source', [...CROSS_FILE_MOVES.values()].every((m) => Number.isInteger(m.was) && Array.isArray(m.sources) && m.sources.length > 0), true],
        ['every live participant is a file this map covers', [...CROSS_FILE_MOVES].every(([d, m]) => CEILINGS.has(d) && m.sources.every(([s]) => CEILINGS.has(s))), true],
        // (10) An ORDINARY ruled raise on the destination is not this move's.
        // The whole group is one pair: the same tree, recorded and unrecorded.
        ['ruled raise — a destination that later took an ordinary ruled raise PASSES with `was` at its literal pre-move value', mvR().ok, true],
        ['...and the verdict prices the MOVE, not the ruling: +10 against the sources\' net 11', mvR().msg.includes('+10') && mvR().msg.includes('decrease of 11'), true],
        ['...and names the ruled lines it took out, so the arithmetic can be read back', mvR().msg.includes('less 34 lines of ordinary ruled raise'), true],
        ['...while the SAME tree with the raise unrecorded is the double red this record ends', mvR(moved).ok, false],
        ['...whose first half reads the ruling as the move\'s: +44 against 11', mvR(moved).msg.includes('+44') && mvR(moved).msg.includes('decrease of 11'), true],
        ['...and which now sends the author to the record rather than to `was`', mvR(moved).msg.includes('ruledRaises'), true],
        ['ruled raise — the map-wide total subtracts it too, and reads the corpus DOWN 1', total(readings, [['dest.md', withRuled]]).ok && total(readings, [['dest.md', withRuled]]).msg.includes('down 1 line'), true],
        ['...where the unrecorded twin reports the corpus growing by 33', total(readings, [['dest.md', moved]]).msg.includes('by 33 lines'), true],
        // The subtraction is a licence to grow, so every bar on it is pinned.
        ['ruled raise — a record quoting NO ruling is RED (the licence is the maintainer\'s or it does not exist)', rr({ ruling: 'the intake-family raise, +34 lines' }).ok, false],
        ['...and the RED verdict says what it wanted', rr({ ruling: 'the intake-family raise, +34 lines' }).msg.includes('quotes no ruling'), true],
        ['...while an ENGLISH ruling quoted the way this map already quotes one passes', rr({ ruling: 'maintainer 2026-09-04, verbatim: "the ceiling is raised by the measured need, +34"' }).ok, true],
        ['ruled raise — a record with no line count is RED', rr({ delta: undefined }).ok, false],
        ['ruled raise — a NEGATIVE line count is RED: lowering is always legitimate and is never recorded here', rr({ delta: -34 }).ok, false],
        ['ruled raise — a record with no ruling DATE is RED', rr({ date: undefined }).ok, false],
        ['ruled raise — records claiming MORE lines than the ceiling stands above `was` are RED', rr({ delta: 90 }).ok, false],
        ['...which is the loophole that closes: an inflated record would otherwise read the move as paid down and pass forever', rr({ delta: 90 }).msg.includes('over-claim'), true],
        ['ruled raise — a destination whose whole rise is ruled keeps none of it for the move, and reads as paid down', rr({ delta: 44 }).ok && rr({ delta: 44 }).msg.includes('paid down'), true],
        ['ruled raise — a declaration carrying no record behaves exactly as before (every case above this group is one)', mv(paid).ok && mv(paid).msg.includes('+5'), true],
        ['every live ruled-raise record quotes its ruling, dates it, and names a positive line count', [...CROSS_FILE_MOVES.values()].every((m) => (m.ruledRaises ?? []).every((r) => VERBATIM_QUOTATION.test(String(r?.ruling ?? '')) && RULED_RAISE_DATE.test(String(r?.date ?? '')) && Number.isInteger(r?.delta) && r.delta > 0)), true],
      ];
    })(),
  ].map((c) => (Array.isArray(c[1]) || (c[1] && typeof c[1] === 'object') ? [c[0], JSON.stringify(c[1]), JSON.stringify(c[2])] : c));
  // The ledger this self-test's floor is evaluated against (#13489).
  const batterySeen = new Map();
  const registerCase = (name) => {
    batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  };

  let failed = 0;
  for (const [name, actual, expected] of cases) {
    registerCase(name);
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  // -- The floor: every declared row RAN, and ran its case (#13489) --------
  //
  // Evaluated after every row has had its chance and BEFORE the verdict, so the
  // success line below can only be printed by a run in which the set of rows
  // that registered EQUALS the set declared. A set difference names WHICH row
  // stopped; a count says only that something did.
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed++;
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  const rowLabels = cases.map(([name]) => name);
  const duplicated = [...new Set(rowLabels.filter((name, i) => rowLabels.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    floorBreached = true;
    floorFailure(
      `the cases table uses ${duplicated.map((n) => JSON.stringify(n)).join(', ')} as a row label more than once — `
        + 'two rows sharing a label are ONE battery, so the second can stop running while the first keeps the floor met.',
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed that case holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (a deleted row, a renamed label, a loop that no longer '
        + 'reaches it) and restore it.',
    );
  }

  if (failed) {
    console.error(`✗ check-skill-line-ratchet self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`✓ check-skill-line-ratchet self-test: ${cases.length} cases pass.`);

  return SELF_TEST_VERDICT;
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
  if (selfTest() !== SELF_TEST_VERDICT) {
    console.error(
      '\n✗ check-skill-line-ratchet self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
} else run();
