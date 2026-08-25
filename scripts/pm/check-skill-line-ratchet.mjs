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
 *
 * Missing file or empty read is RED, never a pass (#4690: a gate that cannot
 * find its input must fail, not skip).
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
  ['.claude/skills/pm-dispatch/SKILL.md', 1005],
  // Raised 223 → 244 by the triage reading-cost card (maintainer ruling
  // 2026-08-20, quoted in the raising PR): three mandated conventions land in
  // the runbook's triage sections. Landed count, headroom 0, same convention.
  // Lowered 244 → 243: the decision-analysis template entry became a pointer
  // to the reference file below (lowering is always legitimate).
  // Lowered 243 → 242 by the restructuring round: the stale hourly-fire
  // rationale clause collapsed into a pointer at contract-review.md.
  ['.claude/skills/pm-dispatch/references/dispatch-runbook.md', 274],
  // Whole-text restructuring round (maintainer ruling 2026-08-23, Q1 = A):
  // mechanism detail extracted from SKILL.md — the four long state-table rows
  // (state-machine.md) and the clause-② review-chain operational detail
  // (contract-review.md). Set at landed line counts (headroom 0, same
  // convention as the entries above).
  ['.claude/skills/pm-dispatch/references/state-machine.md', 43],
  ['.claude/skills/pm-dispatch/references/contract-review.md', 48],
  // Business-perspective decision-analysis writing guide (maintainer ruling
  // 2026-08-20: the four-facet analysis must argue from the business
  // standpoint). Set at landed line count (headroom 0, same convention).
  ['.claude/skills/pm-dispatch/references/decision-analysis.md', 48],
  // 134 → 133: whole-text restructuring round, PR-2 (maintainer ruling
  // 2026-08-23) — the three write-side sanitizer rows consolidated to one
  // author rule + one measured-behaviour row per surface (body / comment).
  // 133 → 130 (LOWERED, no ruling needed — shrinking is always legitimate):
  // the REST-default read-order flip (maintainer ruling 2026-08-23, 「1+2+3」)
  // consolidated the three channel-partition rows into two, and the per-
  // operation channel mapping moved out to references/rest-channel.md below.
  // The two right-sized-reads rows the same ruling ordered were paid from that
  // saving in place, and three lines came back. Headroom 0 again.
  ['.claude/skills/pm-dispatch/references/platform-readings.md', 314],
  // Per-operation REST/GraphQL/git channel mapping — which fleet operation has
  // a REST twin (each row executed in a real session, provenance date carried
  // per row), the handful that are GraphQL-only, and the queue-routing
  // readings. The policy lives in platform-readings.md's quota section; this
  // file is the lookup table it points at, so the policy flip did not have to
  // grow the hot file. Set at landed line count (headroom 0, same convention
  // as the entries above).
  ['.claude/skills/pm-dispatch/references/rest-channel.md', 87],
  ['.claude/skills/pm-dispatch/references/review-checklist.md', 84],
  ['.claude/skills/pm-dispatch/references/landing-operations.md', 80],
  // Release-aftercare duties — what a lane PM still owes AFTER a tagged release
  // rolls to production, which the landing window (ends at MERGED) never
  // covered: post-roll placement/latency reading with the waker-bias re-draw
  // physics, one real user-path probe, the tourniquet rule for replayed live
  // state, orphaned-loop resumption, and the honesty clause. Set at landed line
  // count (headroom 0, same convention as the entries above). Its pointer from
  // landing-operations.md rides existing slack on that file's last
  // MERGED-tracking line, so that ceiling stays at 82 — no re-wrap, no cut.
  ['.claude/skills/pm-dispatch/references/release-aftercare.md', 58],
  ['.claude/skills/pm-dispatch/references/seat-post-protocol.md', 105],
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
  ['.claude/skills/pm-dispatch/references/true-green.md', 34],
  // Lane job descriptions (maintainer ruling 2026-08-19: per-lane PM job
  // descriptions move from seat-post prose into versioned skill references).
  // Set at landed line counts (headroom 0, same convention as above).
  // Each −1: whole-text restructuring round, PR-2 (maintainer ruling
  // 2026-08-23) — the patrol-anchor sentence was carried verbatim by all seven
  // lanes and now lives once in SKILL.md 执行座位职责, so every lane drops it.
  // cli.md pays −2 because it was carrying the map's last line of headroom.
  ['.claude/skills/pm-dispatch/references/lanes/engine.md', 40],
  ['.claude/skills/pm-dispatch/references/lanes/services.md', 30],
  ['.claude/skills/pm-dispatch/references/lanes/cli.md', 35],
  ['.claude/skills/pm-dispatch/references/lanes/devx.md', 39],
  ['.claude/skills/pm-dispatch/references/lanes/skills.md', 35],
  ['.claude/skills/pm-dispatch/references/lanes/spec.md', 46],
  // repo:hotcrm lane charter (maintainer rulings 2026-08-20: exemplar-app repo —
  // platform capabilities implemented upstream, 展现平台能力, 不扩散需求, runs on
  // community edition). Set at landed line count (headroom 0, same convention).
  // 45 → 44: same patrol-anchor hoist deletion as the six lanes above.
  ['.claude/skills/pm-dispatch/references/lanes/hotcrm.md', 57],
  // 399 → 405 (#11126): maintainer-ruled (2026-08-23, option B, quoted in that
  // PR) — the +6-line cross-repo dispatch-gates caveat, sized so the queued
  // #11137 (395→399 on main) and this PR's +6 compose to exactly 405.
  ['.claude/agents/os-dev.md', 470],
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
  ['AGENTS.md', 1158],
  // #9965: root CLAUDE.md is the other repo-root instruction file — same read
  // path (every seat session), same governance (Prime Directive #14). It is
  // structurally growth-prone in the way the ratchet is built for: it exists to
  // inline the rules that must never be missed, so every new must-never-miss
  // rule is an argument for appending to it. Maintainer ruling 2026-08-20,
  // verbatim and untranslated: 「其他接受你的建议。」 (issue #9965, comment
  // 5353931707) — rationale on record: a one-line ceiling now prevents compound
  // growth cheaply. Set at its line count on `origin/main` (headroom 0, same
  // convention as the entries above).
  ['CLAUDE.md', 86],
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

function breakLegal(a, b) {
  const last = a.text[a.text.length - 1];
  if (NO_BREAK_AFTER.includes(last)) return false;
  if (NO_BREAK_BEFORE.includes(b.text[0])) return false;
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
      if (!breakLegal(atoms[k - 1], atoms[k]) || startsBlock(atoms, k)) continue;
      if (bytes(renderSeg(atoms, from, k, pfx)) <= limit) chosen = k;
      else break;                 // segment length is monotonic in k
    }
    if (chosen === -1) {          // nothing fits: take the first legal break at all, if any
      for (let k = from + 1; k < atoms.length; k++) {
        if (breakLegal(atoms[k - 1], atoms[k]) && !startsBlock(atoms, k)) { chosen = k; break; }
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
  if (failed) process.exit(1);
}

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
    ['all seven lane job descriptions are covered', ['engine', 'services', 'cli', 'devx', 'skills', 'spec', 'hotcrm'].every((n) => CEILINGS.has(`.claude/skills/pm-dispatch/references/lanes/${n}.md`)), true],
    ['the other four skills are covered (#9473)', ['checklist-test', 'checklist-author', 'dogfood-verification', 'spec-property-retirement'].every((n) => CEILINGS.has(`.claude/skills/${n}/SKILL.md`)), true],
    ['root AGENTS.md is covered (#9792)', CEILINGS.has('AGENTS.md'), true],
    ['root CLAUDE.md is covered (#9965)', CEILINGS.has('CLAUDE.md'), true],
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
  ].map((c) => (Array.isArray(c[1]) || (c[1] && typeof c[1] === 'object') ? [c[0], JSON.stringify(c[1]), JSON.stringify(c[2])] : c));
  let failed = 0;
  for (const [name, actual, expected] of cases) {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  if (failed) {
    console.error(`✗ check-skill-line-ratchet self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-skill-line-ratchet self-test: ${cases.length} cases pass.`);
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) selfTest();
else run();
