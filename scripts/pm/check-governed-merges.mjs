#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-governed-merges — report-only post-merge audit of the governed
 * surfaces (#9495), across the six governed repos (#9619, #14867, mobile), plus the
 * pre-arm `--test` predicate every seat runs before flipping ready (#9550).
 * Enumerates the PRs that MERGED into `main` since a given date/ref whose diff
 * touched a governed surface — and, since #19036, every landing over
 * `HUMAN_MERGE_LINE_THRESHOLD` changed lines whatever its paths (the "SIZE
 * predicate" section below) — with merge attribution, for the PM round report
 * and the report-only patrol family (the `check-half-states.mjs` precedent: a
 * completed sweep exits 0 whether it found 0 or 40 entries; non-zero exits
 * classify the ENVIRONMENT, not the tree).
 *
 *   node scripts/pm/check-governed-merges.mjs                  # sweep, last 24h, all six repos
 *   node scripts/pm/check-governed-merges.mjs --since 7d       # or 36h, or ISO date
 *   node scripts/pm/check-governed-merges.mjs --since-ref v5.0.0-rc.3       # topological, exact
 *   node scripts/pm/check-governed-merges.mjs --since-ref objectstack=<tip> --since-ref objectui=<tip>
 *   node scripts/pm/check-governed-merges.mjs --repos objectstack,objectui
 *   node scripts/pm/check-governed-merges.mjs --repo-root cloud=/srv/cloud
 *   node scripts/pm/check-governed-merges.mjs --json           # for round reports
 *   node scripts/pm/check-governed-merges.mjs --test AGENTS.md src/x.ts   # pre-arm predicate, list from the CALLER
 *   node scripts/pm/check-governed-merges.mjs --pr 16997       # same predicate, list DERIVED from the API
 *   node scripts/pm/check-governed-merges.mjs --pr objectstack-ai/objectui#42   # any governed repo
 *   node scripts/pm/check-governed-merges.mjs --branch claude/issue-17003-x     # DERIVED offline, merge-base
 *   node scripts/pm/check-governed-merges.mjs --pr 18971       # --pr and --branch read the SIZE too (additions + deletions)
 *   node scripts/pm/check-governed-merges.mjs --test src/x.ts --additions 238310 --deletions 119   # the size, passed in
 *   node scripts/pm/check-governed-merges.mjs --self-test      # offline, no network
 *
 * ## Exit codes — the refusal to read as clean, in one table
 *
 * Sweep mode (default):
 *   0  swept COMPLETELY — every governed repo audited, every entry attributed.
 *      Zero entries and forty entries both exit 0; the list is the product.
 *   1  could not sweep at all — bad args (a flag the sweep does not read
 *      among them: "The argv is closed" below), unreadable `--since-ref`.
 *   2  swept, but INCOMPLETE — at least one repo unaudited (no checkout, wrong
 *      origin, unreadable `origin/main`, a remote that could not be REACHED,
 *      or a local mirror behind the remote it claims to audit — #13307)
 *      and/or at least one entry's
 *      attribution unresolved on every channel. Incomplete must never read as
 *      clean (#4690): an unaudited repo is not a repo with nothing to report,
 *      and a list whose whole point is "does the maintainer recognise every
 *      entry" is incomplete without the who-merged-it column.
 *
 * `--test` mode is a PREDICATE, so it answers on its own codes and shares only
 * the failure code with the sweep:
 *   0  the given paths are NOT governed — ordinary queue landing applies.
 *   3  the given paths ARE governed — landing per the TIER the verdict line and
 *      `--json` name (Tier H: a human merge or an authorized approval; Tier S:
 *      a review of record on the PR thread — "The two landing tiers" below).
 *      ONE code for both tiers, deliberately: every reader of this status asks
 *      "may a seat arm this on green alone?", and the answer is no for both;
 *      the tier is a second fact and travels in the words and the JSON, never
 *      in the status, so no `$?` reader learns a new number. Deliberately NOT 1 or
 *      2: a governed verdict must be impossible to confuse with the sweep's
 *      "could not sweep" / "incomplete", so `if cmd; then` and `$?` readings
 *      cannot silently turn a governed answer into an environment complaint.
 *      ALSO the answer when the diff's SIZE crosses `HUMAN_MERGE_LINE_THRESHOLD`
 *      (the "SIZE predicate" section below) — deliberately the SAME code, so
 *      every caller that already routes GOVERNED to the human terminal routes
 *      an oversized PR there without learning a new code. Which limb fired is
 *      in the words and in `--json`: `governed` is the PATH limb, `humanMerge`
 *      is either limb. Half a `--additions`/`--deletions` pair is bad args
 *      (1, below): the size is their SUM, and half a pair is no reading.
 *   1  bad args — no paths given, or a flag `--test` does not read. ⛔ Silence
 *      never reads as "not governed": `--test` with an empty path list is a
 *      failure, never a green light.
 *   The register rows in `GENERATED_SURFACE_EXCEPTIONS` carry a provenance-
 *   aware exception (the generated-artifact sections below): a hit on a
 *   generator-owned path answers 0 only when that file byte-equals its own
 *   generator's output recomputed on the tree under test — every other reading
 *   of those paths, and every other path, is unchanged.
 *
 * `--pr <n>` and `--branch <ref>` ask `--test`'s question about a list they
 * DERIVE themselves, so they answer on `--test`'s codes byte-for-byte — 0 NOT
 * governed, 3 GOVERNED — and give the derivation's own failure the code that
 * already means "could not answer":
 *   1  could not DERIVE the list — an unresolvable ref, a merge-base that
 *      cannot be computed, an unreachable API, a page walk that came back
 *      short, a PR object missing its `additions`/`deletions` pair, a
 *      `--numstat` that did not read (the size leg, below), or `--additions`/
 *      `--deletions` handed to a mode that reads the number itself (two
 *      readings of one number). ⛔ A derivation that cannot be made is a REFUSAL, never a
 *      quieter answer: see the section below for why the fallback everyone
 *      reaches for is the defect itself. Also a USAGE refusal, before any API read:
 *      a flag the mode does not read, or a bare `--pr <n>` beside a
 *      `PM_SWEEP_REPO` naming another repository ("The argv is closed").
 *
 * `--self-test` mode answers on the sweep's 0 and 1, and adds the repo-wide third:
 *   0  every declared battery ran, and every case held.
 *   1  a FINDING about this file — a case failed, or a battery fell below its
 *      pinned floor because cases really did stop registering.
 *   3  PREREQUISITE NOT MET — the toolchain the live #11705 battery EXECS is not
 *      installed in this checkout, so that battery could not load its cases and
 *      NOTHING was measured. ⛔ NOT a finding. Same number, same words and the
 *      same frame as `scripts/import-prerequisite.mjs`, whose
 *      `reportPrerequisiteNotMet` prints it; that module's header carries the
 *      argument for a code of its own, and is not restated here.
 *      It shares the digit with `--test`'s GOVERNED and cannot be confused with
 *      it: the two are answers to different questions asked by different flags,
 *      and no invocation passes both. Reading this condition as a shrunken
 *      battery was the defect: a fresh worktree before `pnpm install` reported
 *      5 of that battery's 7 cases and prescribed a hunt through the generator
 *      for deleted code that was never deleted.
 *
 * ## The register is scoped per row (ruled B2, 2026-10-13)
 *
 * The maintainer's word 「两仓加治理行」 put `.github/workflows/**` on the
 * governed surface of the two public repositories; this register is read for
 * five, so a plain row would have governed `objectos` and `hotcrm` too, which
 * no ruling names. The ruling (letter B2, 「同意」) gives the register a
 * per-row repository scope instead: a row's `repos` key names the ids it
 * governs, a row with none governs every repository in `GOVERNED_REPOS`, and
 * the `workflows` row lists `objectstack`, `objectui` and `cloud` — the two
 * ruled, plus cloud because its own table already carries the row, so the
 * central audit and cloud's table agree.
 *
 * Consequence for every reader: the register's question has a repository in
 * it. `governedPathsIn(paths, repo)`, `governedTierFor`, `testVerdict` and
 * `classifyCommit` all REQUIRE one and refuse a call without it
 * (`assertGovernedRepo`) — ⛔ never a silent "all": a scoped row answers
 * differently per repository, so a default is a wrong answer in one of them.
 * Where each caller gets its repository: the sweep iterates `GOVERNED_REPOS`
 * and has it; `--pr` names one inline and resolves it (`repoIdForSlug`);
 * `--test` and `--branch` read the checkout at `--root` (`checkoutRepoFor`) —
 * the same "this checkout's own repository" a bare `--pr <n>` already means —
 * and print which one they judged; the queue guard resolves the repository
 * its workflow runs in; the half-states patrol binds its swept board at load.
 * The verdict carries `repo`, and `surfacesChecked` counts the rows that
 * govern it rather than the whole table.
 *
 * ## The argv is closed (#21675)
 *
 * Each mode reads a closed set of flags (`ARGV_MODES`) and refuses every other
 * on exit 1, before any git read, network read or child process. An ignored
 * flag does not stop a run — it prints a verdict about a question nobody
 * asked, under the same ✅ as a real answer. Measured at filing:
 * `--pr 11590 --repo objectstack-ai/objectui` read objectstack's PR 11590 (7
 * files) and answered NOT governed about an objectui PR of 18; so did
 * `PM_SWEEP_REPO=objectstack-ai/objectui --pr 11590`, and `--pr 11590
 * --bogus-flag x`. Only the qualified spelling read objectui.
 *
 * ⛔ One spelling names a PR's repository: `--pr <owner>/<repo>#<n>`. There is
 * no `--repo` (refused like any unread flag, with that spelling prescribed),
 * and `PM_SWEEP_REPO` is read only to REFUSE a bare `--pr <n>` when it names a
 * repository other than the one a bare number answers — this checkout's own
 * (`bareTargetRefusal`) — never to redirect the answer. A qualified `--pr` is
 * answered exactly as before, whatever the environment says.
 *
 * `--self-test` is outside this: its exit 1 means a finding about this file,
 * and it takes its own `--fixture-child` marker.
 *
 * ## The predicate is correct and its INPUT was undefined (#17003)
 *
 * `--test` takes a path list and nothing said how that list is to be derived.
 * The two obvious derivations disagree on every branch that is behind `main`:
 *
 *   git diff --name-only origin/main    HEAD    # TWO-dot   — a SUPERSET
 *   git diff --name-only origin/main... HEAD    # THREE-dot — what the PR changes
 *
 * The two-dot list also carries `main`'s OWN newer commits, rendered as
 * reversions because the branch has not taken them. Measured on PR #16997:
 * seven paths two-dot, two paths three-dot, five of them `main`'s. The
 * superset fails safe in one direction and unsafe in the other — it can never
 * HIDE a governed hit, but it can MANUFACTURE one, and a manufactured hit
 * parks a correct ordinary PR under a rule whose reflex is to escalate rather
 * than to re-derive the input. `skills/**` is regenerated by `gen:skill-refs`
 * and moves on ordinary landings, so a branch a few hours old carrying that
 * path in its two-dot diff is not a contrived case.
 *
 * Nothing in the predicate can detect this: a path list is a path list. So the
 * derivation moved INTO the tool. `--pr <n>` reads the API's changed-files
 * list, which is three-dot by construction; `--branch <ref>` computes the
 * merge base and diffs from it. Both PRINT the derivation they used, so the
 * reading is self-describing the way this file's output already is, and
 * `--test` keeps working with one line naming the form its caller owes it.
 *
 * ### Three decisions the derivations make, and why
 *
 * **A refusal, never a fallback.** `git merge-base origin/main <ref>` exits 1
 * with EMPTY output on a shallow clone (measured: the CI container's own
 * checkout cannot compute one for a fetched PR head). The recipe everyone
 * writes — `git diff --name-only $(git merge-base origin/main REF) REF` —
 * then degrades in the worst possible way: command substitution collapses to
 * nothing, git reads the remaining single argument as a diff against the
 * WORKING TREE, and the run exits 0 with a superset (measured: 650 paths where
 * the branch had none). Every unresolvable input is therefore a stated refusal
 * on exit 1. A wrong answer that reads like an answer is worse than no answer.
 *
 * **Renames contribute BOTH paths.** A rename OUT of a governed path is still
 * a change to that path — moving `AGENTS.md` to `docs/AGENTS.md` edits the
 * governed surface. The API says so directly (`status: 'renamed'` carries
 * `previous_filename`), so both are read. Local git does NOT, by default:
 * `git diff --name-only` with rename detection prints only the NEW path, so
 * the same rename would read as ungoverned. `--branch` therefore diffs with
 * `--no-renames`, which prints the old and the new path as a delete and an
 * add — the same two paths the API reports. That holds for the PATH list
 * only: the SIZE count below is read rename-aware (#30718), because that is
 * how GitHub counts the lines.
 *
 * **A short page walk is a refusal too.** The changed-files endpoint pages at
 * 100 (measured on PR #17076: 100 + 100 + 60 = 260, `Link rel="next"` present
 * on the first two responses and absent on the third) and truncates at the
 * API's own file ceiling. Counting a short page as the end is a heuristic that
 * is wrong on any exact multiple of 100, so the walk follows `Link` and then
 * proves itself against the PR's own `changed_files` count. A walk that cannot
 * prove it collected the whole list refuses instead of answering on part of it.
 *
 * ## The SIZE predicate (maintainer ruling, 2026-09-18; the line, 2026-10-09)
 *
 * The maintainer, verbatim, in the same exchange as ruling C on PR #18971:
 *
 *   「还有应该完善skills，修改代码量超过某个行数（比如5000）就应该人工审核。」
 *
 * and on 2026-10-09, lowering the line, verbatim and untranslated:
 *
 *   「这种大额改动就应该人工审核,我还是建议5000行的人工审核门槛降到 3000,立卡。」
 *
 * Read as: a pull request whose changed line count exceeds 3,000 lands by the
 * same terminal as a Tier H governed diff (ACCEPT on the card,
 * `pm:awaiting-merge` on the PR, a final 维护者速读, review requested from
 * `GOVERNED_APPROVERS`), whatever paths it touches — on 2026-09-18 that meant
 * the maintainer's own merge alone; since 2026-09-27 it means the two landings
 * a Tier H path has (the "SIZE limb's LIFT" section below). 「比如」 made the
 * 2026-09-18 figure the ruled DEFAULT; the 2026-10-09 word lowered it to 3,000.
 * It is declared once as `HUMAN_MERGE_LINE_THRESHOLD` so it moves by one word
 * from the maintainer and by one edit here — which is how it moved.
 *
 * The count is GitHub's `additions + deletions` on the PR — the number the API
 * and the size labeller report — and generated files are INCLUDED. The case
 * that prompted the ruling was PR #18971: +238,310 / −119, of which 237,706
 * lines were regenerated artefacts, landed through the queue on an AI review
 * alone. An exemption for generated files would exempt exactly that PR, so
 * there is none: no regen family, no docs build and no revert is carved out.
 * `GENERATED_SURFACE_EXCEPTIONS` lifts a PATH off the governed predicate on
 * proven provenance; it lifts nothing from the size predicate, and the
 * self-test pins that a certified regeneration over the threshold still lands
 * by a human merge. A label (`size/xl`) is not a gate — the gate reads the
 * numbers.
 *
 * Where the number comes from, per mode:
 *   `--pr <n>`        `additions` / `deletions` off the same `GET /pulls/{n}`
 *                     read that gives the `changed_files` count — one read, one
 *                     channel. A PR object without both numbers is a REFUSAL on
 *                     the derivation code (exit 1): never a "not governed"
 *                     answer and never a size of zero.
 *   `--branch <ref>`  `git diff --numstat -M <merge-base> <ref>` — the range
 *                     the path list is taken from, read RENAME-AWARE (#30718):
 *                     a moved file counts its content change, as GitHub
 *                     counts it, not a whole delete plus a whole add (with
 *                     `--no-renames` PR #30594 read 4324 against GitHub's
 *                     1806). A binary file counts 0 lines here as it does on
 *                     GitHub.
 *   `--test <paths>`  `--additions <n> --deletions <n>`, both or neither. With
 *                     neither the size is NOT MEASURED and the verdict says so
 *                     on STDOUT — the path answer is complete and exits on its
 *                     own codes, but the words say a seat has not read the
 *                     size and which mode reads it. Handing the flags to a mode
 *                     that reads the number itself is two readings of one
 *                     number and is refused, the way two mode flags are.
 *   sweep (default)   `git diff-tree --numstat -M -m --first-parent` on each
 *                     mainline commit (#19036, rename-aware since #30718) —
 *                     the LANDED diff, beside the `--no-renames` call that
 *                     lists the commit's paths, zero API. A
 *                     landing over the line is a sweep ENTRY on the size limb
 *                     alone, listed beside the governed merges with the same
 *                     attribution column, so a PR that slipped through the
 *                     queue is visible to the audit half too. GitHub's own pair,
 *                     read off the attribution GET the row already pays for, is
 *                     printed beside the landed number when the two differ; the
 *                     LISTING is decided on the landed number, which counts a
 *                     rename the way GitHub does (`-M`). A move git does not
 *                     pair (past its rename limit) falls back to a delete plus
 *                     an add, which reads over GitHub's number, never under.
 *
 * What did NOT change: `testVerdict(paths)` with no size answers the PATH
 * question exactly as before (the queue guard's governed leg imports it for
 * that question; since #19036 its SIZE leg hands this file the pull object's
 * pair through `testVerdict([], { size, approval })` and judges
 * `landsByHumanMerge`, so the queue and the seat-side pre-check read one
 * predicate); the governed answer, its words and the exception register are
 * untouched. The one addition to every rendering is the size line — measured,
 * or NOT MEASURED with the remedy — because a verifier that silently skips a
 * leg it could not run reports success it did not measure.
 *
 * ## The SIZE limb's LIFT (maintainer ruling, 2026-09-27; objectstack#20153)
 *
 * The maintainer, asked why PR #20125 (about 11.5k changed lines, APPROVED by
 * `os-zhuang`) was dequeued twice on this limb, verbatim and untranslated:
 *
 *   「所以阈值写死成 5000 行 , 维护者已经批准了就是可以合并。」
 *
 * So an authorized APPROVED review lifts the SIZE limb EXACTLY as it lifts a
 * Tier H path: an account in `GOVERNED_APPROVERS` (the queue guard's constant)
 * holding a latest-decisive APPROVED review, on ANY commit (the 2026-09-04
 * unpinning); dismissed, superseded and unauthorized approvals never count; an
 * unreadable review list fails closed. After the approval the OWNING seat lands
 * the PR through the queue (席位落地); the maintainer's direct merge stays the
 * other landing, unchanged. The threshold, the strict `>` and the generated-
 * files inclusion are UNCHANGED — `exceeds` still reads true over the line;
 * what the ruling adds is `lifted` beside it, and `landsByHumanMerge` reads the
 * pair through `sizeLimbFires`. The FORK limb is untouched: no approval lifts
 * it, and the post-merge sweep still LISTS every oversized landing (it hands the
 * predicate no approval, so a landing over the line is an entry as before).
 *
 * ⭐ ONE derivation of the approval, and it is NOT here: the review list is
 * reduced to an authorized-approval verdict by the queue guard's
 * `authorizedApprovalVerdict` (its file declares `GOVERNED_APPROVERS`; this
 * file cannot import it — the module cycle is measured under "This is a MIRROR"
 * below). That verdict OBJECT is handed in through the one front door,
 * `testVerdict(paths, { size, approval })`, and `sizeLiftFrom` reads only its
 * `state` and its `approvals` — the authorized derivation's own field naming the
 * login and the commit each counted approval was given on, which the generic
 * per-reviewer reduction does not carry, so a verdict that never asked WHO can
 * lift nothing. This file never re-derives the approval from a review list
 * (#11705, "⛔ do not author a second mechanism"), which is also why `--pr`,
 * `--branch` and `--test` read no reviews: they answer the SIZE question the way
 * they answer the PATH question — over the line is exit 3, and the words name
 * the two landings the queue leg then holds the pull request to.
 *
 * ## The FORK predicate (maintainer ruling, 2026-09-21)
 *
 * Batch 207 item 1, letter 是 (the director's record there carries the four-step intake): a PR whose head lives in
 * another repository — `head.repo.full_name` ≠ `base.repo.full_name`, or `head.repo` null because the fork was deleted
 * (fail closed) — is a PROPOSAL, never a delivery, whatever its paths: no AI seat flips it ready, enqueues it, arms
 * auto-merge on it or approves it; the owning seat adopts the diff onto an internal branch (`Co-authored-by:` the
 * contributor) and lands THAT. A third limb beside PATH and SIZE, read off the `GET /pulls/{n}` `--pr` already pays for
 * and exiting on the GOVERNED code through the Tier H terminal with its own reason; `--branch` / `--test` see no head
 * and say NOT MEASURED. A fork's CI runs only once a maintainer approves it, so ZERO check runs on the head (one
 * `GET /commits/{sha}/check-runs`, same channel) read NOT MEASURED, never green.
 *
 * ## The regime this audit belongs to (maintainer ruling, 2026-08-18)
 *
 * A human merge IS the review record for a governed PR. The seat put it as
 * (verbatim): 「人工合并即人工审核:governed PR 的审核记录 = 你按下合并/入队那
 * 个动作本身」, with an after-the-fact audit replacing the always-red per-PR
 * check: 「事后审计代替事前门 … 巡检脚本列出「governed 面合并清单」,出现在轮
 * 次报告里。清单上每一条都应该对应你的一次亲手合并;出现任何一条你不认识的 ⇒
 * 席位违规,立案回滚」. The maintainer's reply: 「同意。」
 *
 * So the contract of this list is: EVERY entry should correspond to a merge
 * the maintainer performed or ordered in person. An entry the maintainer does
 * not recognise is the violation signal — a seat merged, enqueued, or armed
 * auto-merge on a governed PR. That is filed as an incident and rolled back;
 * this script only surfaces the list, it judges nothing.
 *
 * The pre-merge line of defense is DISCIPLINE, not machinery: agent seats
 * never flip ready, never enqueue, never arm auto-merge on a governed PR
 * (AGENTS.md Prime Directive #14; pm-dispatch SKILL.md ACCEPT fork). The
 * per-PR check that used to sit beside that discipline — `ADR maintainer
 * approval`, `.github/workflows/adr-merge-approval.yml` +
 * `scripts/check-adr-merge-approval.mjs` — was retired by the same ruling:
 * it was red on every governed PR by design (红灯常态化本身有毒 — a
 * permanently red check trains everyone to ignore red), it sat OUTSIDE the
 * required-context set (attested by the maintainer's own reading of the
 * ruleset, 2026-08-18: exactly six required contexts, this one not among
 * them; confirmed empirically the same day when a PR carrying the check at
 * `conclusion: failure` with zero approving reviews landed through the merge
 * queue), and so it never actually blocked anything.
 *
 * ## The governed surface (unified definition, maintainer 「同意」 2026-08-18)
 *
 * Asked 「任何对 agents.md 等文件的修改是不是也需要人类审核?」 the maintainer
 * approved the seat's unified list, verbatim: 「`docs/adr/**` + `.claude/**`
 * (含 agents/hooks/settings,不只 skills)+ `skills/**` + `AGENTS.md` +
 * `CLAUDE.md`。混合 diff 照现行规则一条命中即整 PR 分叉」. The two file
 * entries are the REPO-ROOT instruction files exactly — not
 * `examples/AGENTS.md` (an example-tree file) and not the
 * `create-objectstack` template copy (product content).
 *
 * ## The generated-artifact exception (#9866) is RETIRED — its subject moved out
 *
 * History worth keeping, because the shape recurs. Exactly one file under
 * `.claude/**` was not instruction-tree prose but a required gate's own
 * `--write` artifact: `check:docs-audit-scope` kept its generated
 * `ALL_HANDWRITTEN` page-scope block inside
 * `.claude/workflows/docs-accuracy-audit.js`, because the workflow runs in a
 * `node:vm` sandbox that cannot read files. Adding a docs page reddened that
 * gate, the gate's `--write` regenerated the block, and the block sat inside
 * this fence — so EVERY page-adding docs PR crossed the governed surface
 * (measured 5-for-5 on #9866), and three of the crossings merged with nobody
 * recording them. A fence that fires on routine traffic trains every seat to
 * read past it.
 *
 * The first remedy was a provenance-aware exception in this register — a row
 * that lifted that one path when the tree's copy byte-equalled the generator's
 * own recomputed splice (#10277 Option C, 「10277 同意 C」 2026-08-20, re-confirmed
 * 「A:按方案 2(最新裁定)」 2026-08-22 over the same day's earlier
 * relocate-the-artifact proposal).
 *
 * ⚖️ On 2026-09-01 the maintainer ruled the other way, verbatim 「同意」 on
 * #13591's option 2: MOVE THE LIST OFF THE GOVERNED SURFACE. It now lives in
 * `scripts/docs-audit/handwritten-docs.json`, and the workflow's caller hands it
 * to the sandbox as `args.handwritten` — the read happens outside the vm, so the
 * inline copy that made the exception necessary no longer exists. The newer
 * ruling supersedes the older, so the row is GONE rather than dormant. Keeping
 * it would have been actively unsafe: with no generated artifact left at that
 * path, a row still naming it could only ever be asked to certify hand-authored
 * instruction prose, which is precisely what the fence exists to stop.
 *
 * ⚠️ What did NOT change, in either direction: `GOVERNED_SURFACES` is
 * character-for-character the same list — `.claude/**` included. #13591's option
 * 3, carving `.claude/workflows/**` out of the register, was considered and
 * explicitly REJECTED by the same ruling. Removing this row NARROWS what the
 * exception machinery lifts; nothing that was governed became clear.
 *
 * ## The two landing tiers (#19133, ruled 2026-09-18)
 *
 * The maintainer, on the skills seat's proposal, verbatim 「同意改规则。」, then
 * 「我觉得这些我也没必要确认:.claude/settings.json、.claude/hooks/**」. The
 * proposal, verbatim: 「把『受管 = 人合』的范围缩到真正的法——`AGENTS.md`、
 * `CLAUDE.md`、`docs/adr/**`、`docs/NORTH-STAR.md`、`.claude/settings.json`、
 * `.claude/hooks/**`;而 `.claude/skills/**`、`.claude/agents/**` 这些舰队自己的
 * 仪器,凭席内 `CONTRACT_REVIEW_TIER` 复核 PASS 就走队列,事后由总监席的受管合并
 * 审计(职责四)抽查。」 — and the amendment moved settings and hooks over too.
 *
 * MEMBERSHIP did not move: every row below still governs exactly what it did,
 * one hit still forks the whole PR, and `--test` still exits 3 on every one of
 * them. What moved is the LANDING each row waits for, carried as `tier` on the
 * row and derived per PR by `governedTierFor`:
 *
 *   H  人合 — every register row except objectstack's `.claude/**`, and the split
 *      rows where their reading says S (today: `docs/adr/**`,
 *      `docs/NORTH-STAR.md`, `skills/**`, `AGENTS.md`, `CLAUDE.md`, and since
 *      the B2 ruling of 2026-10-13 the `workflows` row, `.github/workflows/**`,
 *      scoped to objectstack, objectui and cloud — in objectstack split by
 *      content since ruling record 6722205630, "The workflows row's split"
 *      below): the maintainer's hand, or
 *      an authorized APPROVED review by `GOVERNED_APPROVERS` and then the
 *      owning seat lands it. The tier ruling left this landing as it was; the
 *      list itself grew by one row on 2026-10-13. The `.claude/**` row of every
 *      repository but objectstack lands here too (#25199): its `tierRepos` names
 *      objectstack alone, because no other repository's own queue guard has a
 *      Tier S arm (objectui's, measured, refuses `.claude/**` without an
 *      authorized approval; cloud's, objectos' and hotcrm's are unread and fail
 *      closed to H).
 *   S  席内达档 L2 审核落地 — objectstack's `.claude/**` tree (since 2026-11-19 less its
 *      hooks and settings, and only on a verified declaration — section "The guard
 *      instruments and the `.claude/**` declaration split" below): the owning seat lands it
 *      through the queue once the PR thread (or its card) carries a
 *      `## Contract review` record for the PR's CURRENT head with
 *      `Served-tier: CONTRACT_REVIEW_TIER` and `**VERDICT: PASS**` and every
 *      check is green.
 *      Exactly the path the fact layer (`.claude/skills/pm-dispatch/references/`)
 *      used since #17950, generalised to the tier; the post-merge audit (this
 *      sweep) and the director seat's 职责四 are the compensating control, and a
 *      Tier S merge without a PASS record is that audit's finding.
 *
 * ⭐ ALL, not ANY: a PR is Tier S only when EVERY governed path in it lies under
 * a Tier S row — 「混合 diff 一条命中即整 PR 分叉」 one level down. One Tier H path
 * and the whole PR is Tier H; an empty or ungoverned list answers H (fail
 * closed — the tier of nothing is never the cheaper one), and the tier is
 * recomputed on the LIFTED slice, since a certified regeneration under
 * `skills/**` can be the only Tier H hit in a diff. `.claude/settings.json` is
 * the permission set itself and lands under Tier S by the amendment; the
 * auto-mode classifier still refuses AI writes to it, so the maintainer's hand
 * stays its writer and the tier removes only the approval click.
 *
 * Published `skills/**` stays a Tier H ROW: the 2026-09-18 seat did not propose
 * moving it, and no row moved since. What moved on 2026-11-14 is a READING on
 * the two catalog rows (section "The low-risk skills arm" below).
 * `check-governed-queue-guard.mjs` reads `tier` and `governedTierFor` from HERE
 * (a module-scope import; the cycle that forces its mirrors is with
 * `check-half-states.mjs`, not with this file), so there is ONE register and one
 * tier function, and `check-governed-prose.mjs` keeps pinning the SET of globs
 * the instruction prose names — the tier is an attribute the prose states in
 * words, which that gate deliberately does not parse.
 *
 * ## The low-risk skills arm (#33501, maintainer ruling 2026-11-14)
 *
 * The maintainer, verbatim 「同意 把低风险的 Tier H 放权给座位」, then 「把低风险的
 * Tier H 放权给座位，立 p1 卡优化」, agreeing to the scope the coordinator put to
 * him: pure docs, ADR annotations or notes, and skills wording land on the
 * seat's own contract review; anything touching a contract (spec or published
 * types, Clause ②, narrowing) or security stays with him.
 *
 * Modelled as the workflows split is: the `skills-catalog` and
 * `ui-skills-catalog` rows KEEP `tier: H` — every path-only reader (`--test`,
 * `--branch`, the prose gate) answers exactly as before, while the CODEOWNERS
 * mirror reads the arm and keeps both rows out of the file (ruling record
 * 6891850019) — and carry `lowRisk`, scoped to objectstack. The relay's review plan is not
 * path-only from #33540: `governedReviewPlan` (`scripts/pm/fleet-write/execute.mjs`)
 * reads the arm with its readers. A READING of the pull request
 * (`lowRiskArmVerdict`: every changed path, the body, the label names, the
 * timeline, the fork predicate and the changesets read at the head) moves them
 * to Tier S only when ALL hold:
 *
 *   - every governed path lies under a catalog row (or the `adr` row, read
 *     add-only: the ADR leg below) — `.claude/**`, a workflow, `AGENTS.md`,
 *     `docs/NORTH-STAR.md` or any other row beside it is H;
 *   - every changed path lies under a hit catalog row or matches
 *     `LOW_RISK_RIDER_PATTERNS` (a changeset, Markdown prose under the docs
 *     trees) — an ALLOWLIST, so `packages/**`, `ui/packages/**`, a gate script,
 *     a ratchet ceiling or a lockfile is H — and under a catalog row only
 *     Markdown and `evals/*.json` (`LOW_RISK_ARM_FILE_PATTERNS`);
 *   - the body carries exactly ONE bare `Clause-②: no` and ONE bare
 *     `Metadata-protocol: none` (`readBareDeclaration`, the fleet's readers run
 *     per line): `yes`, an arm, trailing words, a second declaration, or the
 *     line quoted or fenced is H;
 *   - with a catalog path, at least one changeset; each read at the head, releasing nothing but
 *     `'@objectstack/skills': patch` and carrying the same two bare lines;
 *   - the labels were read and none is `security`, and the timeline was read and
 *     never removed one; and no catalog path names security, auth or permission
 *     (`LOW_RISK_SECURITY_NAME`, any segment below the row, any case) — the label
 *     OR the name sends the PR to H; security teaching the name cannot see is
 *     the reviewer's to state (the record stage below), and the seat adopting
 *     such a record adds the `security` label (the reviewer brief says so);
 *   - the head lives in the base repository (`forkVerdict`);
 *   - every catalog path is a MODIFIED regular file with the same mode at both ends
 *     — an added, deleted, renamed or copied skill or eval, a symlink, a mode change
 *     or a status not read is H (`catalogFiles`);
 *   - the RECORD STAGE, read last (`lowRiskRecordStageReasons`): the
 *     `## Contract review` record on this head carries, as a machine line,
 *     exactly ONE bare `Security-touching: no` (`contractReviewRecordReading`'s
 *     `securityTouching`, the fleet's one record reader) — the line absent,
 *     unreadable, doubled, quoted, fenced, `yes`, or the record absent, unsigned,
 *     unread or carried over a hop that moved catalog text is H;
 *   - and EVERY card the pull request names was read and neither carries the
 *     `security` label nor ever had it removed (its labels and its timeline) —
 *     no derivable card, or a named card that cannot be read, is H.
 *
 * The record stage is a SECOND read (`recordStage`): a reading that hands none
 * in is Tier H — `pending` when every condition above holds, and then the
 * caller (the queue leg, the relay, `--pr`, the sweep) reads the record and the
 * card and asks again. ⛔ No stand-in answers it: a favourable stand-in read
 * (`armSettledWithoutUnread`) leaves it pending and settles nothing.
 *
 * Then the landing is Tier S's: a `## Contract review` record for the current
 * head at `CONTRACT_REVIEW_TIER` (the record recognisers' `rules` face — no
 * lower tier stands on a governed path) that READS PASS — the queue guard reads
 * the verdict for this arm — and every check green; the owning seat enqueues.
 * ⛔ Fail closed: no reading or an unmeasured one is H. `--pr` reads it off the
 * same pull object and file walk; the queue guard's `merge_group` leg
 * off the pull it already reads, over every commit of the PR in the group.
 *
 * The ADR leg (#33539, the same ruling's "ADR annotations or notes"): the `adr`
 * row keeps `tier: H` too and carries `lowRisk` with `addOnly`, one more path
 * family under the SAME arm and the same conditions above — but a path cannot
 * tell a note from a changed decision, so the arm reads the DIFF at the head
 * (`addOnlyNoteReasons`, merge base to head; each queued commit against its
 * first parent at the queue), one full-context hunk per file: every ADR path
 * is a modified Markdown file (no record created, renamed or deleted), the hunk
 * removes no line, and no added line is a `Status:` line, a heading naming the
 * decision or the status, or a line under one (`addOnlyHeadingReading`; the
 * record's title scopes nothing). An ADR note publishes nothing, so it owes no
 * changeset; one it carries is held to the catalog's shape. `ui/docs/adr/**`
 * and `docs/NORTH-STAR.md` stay Tier H. Ungoverned `docs/**` and
 * `content/docs/**` prose needs nothing — it was never on the register.
 *
 * The post-merge sweep (#33603) still lists every catalog merge (membership did
 * not move), and reads each one again with the queue guard's own arm and record
 * readers on the landed commit (`readArmLanding`): an arm landing is listed APART
 * from the maintainer's merges, a `pass` on a same-head at-tier PASS record that
 * existed when it landed, a ⛔ `breach` without one or on a record stage that
 * read Tier H then (read only where the landed commit's own tree carries the
 * stage, `armRecordStageBound`); the arm's Tier H stays on
 * the maintainer's list with its reasons, and so does an arm landing an
 * authorized approval or enqueue cleared first (the guard's own leg order); a
 * record counts only on a pull GitHub says landed AS this commit
 * (`merge_commit_sha`), and only from an author the guard trusts
 * (`recordAuthorTrusted`); a read that fails is NOT MEASURED and
 * the sweep INCOMPLETE (exit 2). Its reads ride the channel that attributed the
 * row; the body and labels are the pull's NOW (the timeline keeps a removed
 * `security` label). ⛔ It cannot tell a record written by the run that served
 * it from a false one — reading the record is all the audit adds.
 *
 * ## The workflows row's split (#31538, ruling record 6722205630, letter C)
 *
 * In objectstack the `workflows` row's tier is read off the DIFF, not the
 * path (`split` on the row; objectui and cloud stay Tier H by path):
 *
 *   H by PATH — the release, publish and deploy files in
 *      `WORKFLOW_TIER_H_FILES`, each with its reason, any edit at all.
 *   H by DIFF (C2) — an added or changed `permissions:`; a `secrets` or
 *      job-token line (`github.token` in any case, any `github[…]` index,
 *      `toJSON(github)`) added, changed or moved;
 *      `pull_request_target`; a `uses:` (or image) no workflow uses at the
 *      base (`.github/actions/**` vouches for nothing: no register row
 *      governs it); a deleted job, a changed literal check-run name or a changed
 *      `needs:`; a new `continue-on-error`; an `if:` the base does not hold for
 *      the same owner with the same text, unless its job is new on the head.
 *   S otherwise — a contract-review PASS on the current head, every check
 *      green, and the owning seat lands it (the Tier S landing above).
 *
 * ⛔ Biased to H, because this surface can switch the other gates off: a
 * changed job, step or workflow that holds a secret or a write token; an
 * added `|| true`, `set +e`, `exit 0` or `OS_SKIP_`/`OS_DISABLE_`/`OS_ALLOW_`;
 * a gate invocation or a `uses:` dropped from the file, or from an existing
 * job (a gate moved into a new job that never runs); a changed trigger set or workflow
 * name; a new job with a computed or colliding name; a new, deleted or
 * non-YAML file. ⛔ Fail closed: a copy the line reader refuses (anchors,
 * tags, tabs, flow mappings, flow spanning lines, double-quoted escapes, a
 * line led by an indicator, a valued node with children…), an unreadable
 * commit, a missing base or no reading at all is H — so `--test`, which has
 * paths only, always says H, and `--pr` reads the diff only on a checkout
 * holding both commits.
 *
 * Known limit, S by the ruling: the TEXT of a `run:` or `shell:` edit is not
 * judged beyond a dropped gate token or an added risky pattern, so
 * `echo "pnpm check:x"`, `|| :` or `shell: bash {0}` read S. A gate token is
 * one `WORKFLOW_INVOCATIONS` spelling: `check:*`, a `scripts/` path, vitest,
 * eslint, tsc, playwright, lychee, `turbo run X`, `pnpm X`, `git diff
 * --exit-code` / `--quiet` with its arguments, `npx X`, or `node` / `bash` /
 * `sh` on a file path. A gate spelled any other way (`python3 -c`,
 * `/bin/bash x.sh`, an inline `test` / `[`, a bin `pnpm exec` names) is not
 * tracked per job, so moving it out of its job reads S. The contract
 * review of record is the control there.
 *
 * `readWorkflowDiff` is the one reader; the queue guard calls it per queued
 * commit and `--branch` / `--pr` per PR. The reader is dependency-free on
 * purpose: the guard's `pull_request` leg runs before any install.
 *
 * ## The guard instruments and the `.claude/**` declaration split (2026-11-19)
 *
 * The maintainer, in the review-split thread on 2026-11-19, verbatim and
 * untranslated: 「1+2+4」 — point 1 hands fleet rule text back to him,
 * overriding the 2026-09-18 amendment that moved all of `.claude/**` to a
 * seat's contract review — and 「「已裁定的照抄只核对、不再审」 同意」. The
 * scope he gave "rule text" (card #35321): what an agent may do without him
 * (merge, bypass checks, change repo settings); what gets done and in what
 * order (grading, dispatch, scope); what must go to him (decisions, maintainer
 * actions). Process steps, scripts, wording, slimming and file moves stay with
 * the reviewer. Three register facts follow:
 *
 *   - THE GUARD INSTRUMENTS ARE ROWS, Tier H, objectstack alone: this file,
 *     `check-governed-queue-guard.mjs`, `record-recognisers.mjs` (the record
 *     readers the guard loads) and `dispatch-gates.mjs` (it holds
 *     `CONTRACT_REVIEW_TIER`). Measured on 00cfb78f, `--test` answered 0 of 3
 *     hits on the first three — and the queue leg runs the guard from the merge
 *     group's own tree, so a PR that edited the guard was judged by its own
 *     copy. `governed-surface-guard.yml` joins `WORKFLOW_TIER_H_FILES`.
 *   - `.claude/hooks/**`, `.claude/settings.json` and
 *     `.claude/settings.local.json` — the agents' own guardrails and
 *     permissions — are Tier H rows of their own that OVERLAP the `.claude/**`
 *     row: one of them in a diff makes it Tier H whatever the rest reads.
 *   - THE `.claude/**` ROW SPLITS BY DECLARATION (`ruleChange` on the row,
 *     objectstack alone; `applyRuleChangeSplit`). The row keeps `tier: S`, so a
 *     path-only reader answers as before; the queue guard hands in a READING,
 *     and the row holds S only when the PR body carries ONE bare
 *     `Rule-change: none` — or `Rule-change: ruled` beside a line-start
 *     `Ruling-ref:` quoting the maintainer's words, source and time, the PR
 *     that only writes down a ruling he already gave — AND the review of record
 *     on the current head carries the SAME value on its `Rule-change-verified:`
 *     line. A missing line, `Rule-change: yes`, a record without the line or
 *     with another value: Tier H. ⛔ No reading, or an unmeasured one, is H; a
 *     body that holds with no record read yet is `pending`, never S.
 *     ⚠️ Known gap, stated rather than discovered: `--test`, `--branch`, `--pr`,
 *     the sweep and the relay's review plan read paths and the low-risk arm
 *     only, so they still say S for a `.claude/**` PR declaring
 *     `Rule-change: yes`; the queue guard is where the split is enforced.
 *
 * A narrowed metadata protocol landing only by the maintainer is the queue
 * guard's own leg ("The narrowing leg" there): it reads PR bodies and
 * changesets, never paths, so no register row carries it.
 *
 * ### The generator co-edit fence (#11084) — a NARROWING, not a widening
 *
 * A recompute has to run the tree under test's OWN generator (it must — the
 * derivation has to reflect the PR's own content). So a PR that edits the
 * generator AND hand-edits its artifact in one diff could in principle construct
 * a derivation whose recomputed output byte-equals its hand edit: the tree would
 * be certifying itself. Cheap fence, `--test` only: if the submitted path list
 * contains ANY path under that row's own trusted generator tree, the recompute is
 * SKIPPED and the path stays governed with that reason stated. This only ever
 * moves verdicts toward governed — a pure regeneration with an untouched
 * generator lifts exactly as before, and no path that was governed becomes clear.
 *
 * The remaining constraints, each pinned by `--self-test`; drop one and an
 * exception row is a hole:
 *
 *   1. RECOMPUTE, never compare to a stored baseline. Any stored or cached
 *      comparison can be constructed against.
 *   2. BYTE-EXACT, no shape heuristics — a reordered-but-equal artifact rejects.
 *   3. Rows are NAMED and ruled, never a class mechanism.
 *   4. FAIL CLOSED, and the mixed-diff rule is untouched: provenance that cannot
 *      be recomputed keeps the path governed, and a hit on any OTHER governed
 *      path still forks the whole PR — 「混合 diff 一条命中即整 PR 分叉」.
 *
 * The exception applies to the `--test` predicate only. The post-merge SWEEP
 * still lists a pure-regeneration merge: under-enumeration is the one
 * direction the sweep must never be wrong in (#9902), recomputing a generator
 * against historical trees is a different machine, and the maintainer
 * recognising a regen entry costs a glance — so the list stays complete and
 * the predicate stops forcing the crossing in the first place.
 *
 * ## Generator-owned files inside `skills/**` (#11705; maintainer 2026-08-25)
 *
 * The same collision, one surface over, and this time the strict reading was
 * not merely heavy but UNWORKABLE. `skills/<skill>/references/_index.md` is
 * written by `gen:skill-refs` and verified by the required `check:skill-refs`;
 * a spec PR that moves an indexed headline MUST carry the regenerated index or
 * main goes red on that gate. Measured on PR #11685 (2026-08-24): the
 * dispatching seat read the regenerated line as a hand-authored `skills/**`
 * edit and split it out under the governed fork — head `7125cdc6e` went red on
 * `check:skill-refs` (job 97435569091), because the artifact must ride the
 * source change. Under the strict reading every such spec PR also loses
 * merge-queue eligibility for one mechanical line.
 *
 * The maintainer ruled option A (2026-08-25, issue #11705 comment 5406727512),
 * verbatim from the ruling: "files that are **generator-owned outputs** inside
 * `skills/**` are carved out of the governed-merge fork. The generator plus its
 * verifying gate (`gen:skill-refs` + `check:skill-refs`) **are** the review for
 * these files — no agent-authored instruction content can enter through them,
 * which is what the governed fence exists to stop." And on the shape: "The
 * exemption is **enumerated from the generator**, never a hand-copied path list
 * … Extend that registry; ⛔ do not author a second mechanism." And the limit:
 * "⛔ **Hand-authored `skills/**` content is untouched** — it stays governed,
 * human-merge-only. A file qualifies only by being reproducible from its
 * generator, and the checker must prove that per-file rather than trust the
 * path."
 *
 * So these rows are NOT path exemptions. Each names a generator, and a hit is
 * lifted only when BOTH halves are proven on the tree under test:
 *
 *   1. THE GENERATOR OWNS THE PATH. The spec generators write through the
 *      shared sink (`packages/spec/scripts/lib/generated-output.ts`), which
 *      declares its output set on demand — `--generated-manifest=<file>` writes
 *      the repo-relative paths of everything a real run emits, from the same
 *      map the write disposition uses. The register consults THAT list; it
 *      never restates it. An `_index.md` under a skill the generator does not
 *      write (`objectstack-upgrade` has no SKILL_MAP entry today) is absent
 *      from the manifest and stays governed,
 *      which is the ruling's own limit in code.
 *   2. THE BYTES MATCH. The generator's own `--check` — "the real run minus the
 *      writes", by the sink's construction — must report no drift. One
 *      hand-edited byte reddens it, so it cannot certify a hand edit; and
 *      because `--check` also fails on a stale owned file, the pass covers the
 *      whole generated surface, not just the hit path.
 *
 * A row's `candidate` regexp is a NARROWING gate and nothing else: matching it
 * only earns a path the QUESTION, never the answer. Too narrow and a real
 * regeneration stays governed (heavy, safe); too wide and the manifest refuses
 * it anyway (safe). No spelling of it can lift a file on its own — the same
 * property the #11084 fence has, and the self-test pins both directions.
 *
 * Fail-closed is unchanged and now covers a third way to fail: an environment
 * with no generator toolchain (the merge-group guard job installs no
 * dependencies) cannot recompute, so it keeps the path GOVERNED and says so.
 * ⚠️ Consequence worth knowing before reading a queue-build log: in that job
 * these rows never lift, so a spec PR carrying a regenerated index is still
 * governed THERE. The seat-side `--test` — the predicate the measured incident
 * turned on — runs in a dev container and lifts it. Closing that gap means
 * giving the guard job dependencies, which is a CI-cost decision no ruling
 * covers; it is filed rather than taken.
 *
 * ## The governed REPOS (maintainer 「同意」 2026-08-18, wired here by #9619;
 * ## `hotcrm` added by the 2026-09-03 ruling on #14867)
 *
 * The same day, asked whether the rule reaches the sibling repos — 「任何对
 * agents.md 等文件的修改…包括 objectui cloud仓库」 — the maintainer answered
 * 「同意」. So the surface register above reaches every governed repository:
 * by default each row governs all six — `objectstack`, `objectui`, `cloud`,
 * `objectos`, `hotcrm` and `mobile` — and since the B2 ruling of 2026-10-13 (header
 * section "The register is scoped per row") a row may be scoped to a subset:
 * the `workflows` row names `objectstack`, `objectui` and `cloud`. This sweep
 * still covers all six repos in one invocation, judging each against the
 * rows that govern it; `--test` and `--branch` answer for ONE repository, the
 * checkout at `--root` (`checkoutRepoFor`), and say which one on stderr.
 *
 * ⚠️ The 2026-08-18 quotation above names two sibling repos and the register
 * below holds six, so read that quote as the repos IN VIEW that day — an
 * enumeration, never an exclusion, and never the register. The definition it
 * states (agent instruction files, judged the same across repos — still true
 * of every row that declares no `repos` scope) already covered `hotcrm`, a
 * repo agents edit daily; only the CONFIGURATION lagged,
 * and it lagged in the direction that reads as safety. Measured cost of the
 * lag, #14867: the `repo:hotcrm` seat treated that repo's `AGENTS.md` chain
 * as governed and paid for hand-merges on it, while this sweep printed no row
 * for hotcrm at all — and a repo that produces NO ROW is indistinguishable in
 * this output from a repo that swept clean. That is the #4690 rule failing one
 * level up: a configured repo that cannot be read is loudly UNAUDITED, but an
 * unconfigured repo is silent, so absence of coverage can only be made loud by
 * configuring the repo. Ruled 2026-09-03 (#14867, sibling #14881 ruled with
 * it), maintainer verbatim 「其他同意」 adopting 纳入 — `GOVERNED_REPOS` gains
 * `hotcrm`, and every "CLEAN WINDOW" this sweep published before that date is
 * re-read as "clean over the FOUR repos then configured".
 *
 * ⚠️ Until #9619 that was not true, and the gap was not theoretical: run from
 * the objectui checkout the sweep still enumerated objectstack PRs, so a
 * governed merge in objectstack showed up and the identical merge in objectui
 * did not. objectui PR #5188 (`AGENTS.md` + `skills/**`) landed on
 * 2026-08-18 and appeared in no audit output at all — a seat happened to
 * catch it reading `git log` by hand.
 *
 * Sibling repos are not always checked out. An absent checkout reports as
 * **UNAUDITED** and exits 2 — never as a clean repo (#4690). "Nothing was
 * found" and "nothing was looked at" are different facts and this sweep is
 * required to keep them apart.
 *
 * ## A TRUNCATED history is the same fact, and it used to be invisible (#9902)
 *
 * "Nothing was looked at" has a third form that no missing-checkout test
 * catches: the checkout is present and healthy, and its history simply stops
 * inside the window. `git log --since` answers from whatever part of the
 * window is present, **exits 0, and prints no warning**. Agent containers
 * clone shallow, and the real sweep is a seat command (CI runs only
 * `--self-test`), so that is where this sweep actually runs.
 *
 * Measured in one such container, 2026-08-21, graft floor 2026-06-02, window
 * 2026-05-23 → the floor:
 *
 *   | reading                                    | governed merges reported |
 *   |--------------------------------------------|--------------------------|
 *   | this sweep, before this guard               | **0** — and it rendered  |
 *   |                                             | `✅ clean window`, exit 0 |
 *   | truth (GitHub commit list, same window)     | 38 commits touched       |
 *   |                                             | `docs/adr/**`, 13 touched |
 *   |                                             | `AGENTS.md`              |
 *
 * The green tick printed over ~40 governed merges, and the line above it said
 * `✓ audited`. Under-enumeration is the one direction this list must never be
 * wrong in — a short list reads as COMPLIANCE. So a repo whose history does
 * not cover the window is UNAUDITED, exactly like an absent checkout, and the
 * ✅ cannot print at all. The predicate is `historyHorizon()` in
 * `git-history.mjs` (shared, so it cannot drift from the other adopters); it
 * asks whether the floor predates the window rather than whether the clone is
 * shallow, so a shallow container with enough depth — the common case, since
 * the default window is 24h — still sweeps exactly as before, with no fetch.
 * Deepening is never done here: this sweep reads six checkouts it does not
 * own, so the remedy is printed as a command for the operator to run.
 *
 * ## And a DEAD MIRROR is the same fact again, in the direction that reads as
 * ## safety (#13307)
 *
 * "Nothing was looked at" has a fourth form, and it is the worst of them: the
 * checkout is present, its origin remote is the right slug, its history is
 * complete, `origin/main` resolves, its tip carries a real date — and the
 * remote it mirrors is GONE, or has simply moved on without it. Enumeration
 * succeeds. Every clause the row prints is literally TRUE about the local
 * snapshot. Only the conclusion a reader draws from it — no governed merge
 * happened there in this window — is unsupported, and nothing on the row marks
 * that.
 *
 * Measured 2026-08-30, three independent probes in the same minute:
 * `objectstack-ai/cloud` answered `Could not resolve to a Repository` on the
 * API, was absent from the account's visible repository list, and
 * `git fetch origin main` in the surviving local clone answered
 * `fatal: repository ... not found`; `objectos`, `hotcrm`, `objectui` and
 * `objectstack` all resolved in the same batch, so this was a scope change for
 * one repo and not a broken channel. (⚠️ Read that batch with its date: on
 * 2026-08-30 `hotcrm` was probed BY HAND, as a control this sweep had no row
 * for — it was not configured here until the 2026-09-03 ruling above. The
 * reading stands as measured; what changed is that those four names are now
 * four of the six repos this sweep audits itself.) Wherever that clone
 * survives, this sweep
 * printed `✓ audited objectstack-ai/cloud — tip 15f55df2d ... 0 mainline
 * commit(s) in window` and exited 0 — and would have printed it FOREVER, since
 * the row's own prescribed remedy (`git fetch origin main`) is exactly the
 * command that 404s. The control had not degraded; it had been silently
 * switched off for one of the repos it covers while continuing to print a
 * tick for it.
 *
 * So reachability is a MEASURED PRECONDITION, asked of every governed repo in
 * every window mode before enumeration begins: one `git ls-remote --exit-code`
 * per repo (git wire protocol, zero API calls). It answers both halves at once
 * and the second half is the sharper one:
 *
 *   - UNREACHABLE ⇒ the repo is UNAUDITED and its reason opens `NOT MEASURED`.
 *     ⛔ A local tip is not evidence the remote was consulted.
 *   - REACHED, but the remote names a DIFFERENT commit ⇒ also UNAUDITED. This
 *     is the bounded-staleness requirement, answered by identity rather than
 *     by dates: a tip DATE older than the window cannot separate a quiet repo
 *     from a dead mirror (which is why the row used to be able to do no better
 *     than hedge — "if that tip predates your last fetch, run `git fetch`"),
 *     while tip IDENTITY separates them exactly.
 *   - REACHED and MATCHING ⇒ the row audits, and its zero is now a MEASURED
 *     zero that says so. ⭐ This direction is not a nicety: a fix that turned
 *     every zero into NOT MEASURED would be exactly as useless as the false
 *     zero it replaced, so being able to say a true zero is part of the
 *     contract and is pinned by `--self-test` alongside the refusals.
 *
 * ⛔ The fix this is NOT: dropping `cloud` from `GOVERNED_REPOS`. That trades
 * a loud hole for a silent one. Whether the repo is still in this platform's
 * scope is a maintainer question; until it is answered the audit's honest
 * reading of it is NOT MEASURED, and the sweep is INCOMPLETE while it stands.
 *
 * ⚠️ Consequence, stated rather than discovered: this sweep now requires
 * network reachability to each governed remote, and an offline run refuses
 * every repo (exit 1, "no governed repo could be audited"). That is the
 * intended reading — an audit run with no way to consult any remote has not
 * swept a clean window — and there is deliberately NO flag to suppress the
 * probe, because a flag that let the rows read `✓ audited` without it would
 * reintroduce precisely the false green this leg exists to remove.
 *
 * ### The #13307 reopen: the probe was never gated — the RUNS were stale
 *
 * The reopen asked, in words: is the reachability probe gated on
 * `--repo-root`? The answer is NO, and it never was: the probe runs in
 * `main()`'s sweep loop for every repo whose checkout resolved, discovered
 * conventionally or overridden, in every window mode. What actually happened
 * (measured, 2026-08-31): the two audit runs that printed the false green
 * AFTER the fix landed quoted a row ending `— none in window; if that tip
 * predates your last fetch, run \`git fetch origin main\` there` — and that
 * text exists ONLY in the pre-fix render (the fix replaced it with the
 * MEASURED-zero / unmeasured-zero split). Those runs executed a PRE-FIX COPY
 * of this script from a stale tree; in a container whose shared checkout has
 * its HEAD switched by other agents, `node scripts/pm/check-governed-merges.mjs`
 * runs whatever version that tree happens to hold, and nothing in the output
 * said which. So the header now prints `sweep code:` — the executing tree's
 * HEAD and this file's own blob id, with a loud mismatch line when the
 * running bytes are not the copy that HEAD records — making a stale-script
 * run attributable instead of indistinguishable from the landed behaviour.
 * ⛔ It cannot PREVENT a stale run (a stale tree prints a stale sha,
 * truthfully); it makes the reading checkable, which is what the reopen's
 * false conclusion lacked.
 *
 * ### The nondeterministic audit surface (#13836): the flip is the freshness
 * ### leg failing closed, and it must be attributable without footer diffing
 *
 * Measured 2026-08-31: two identical invocations, same cwd, ~15 minutes
 * apart — run 1 audited objectui and enumerated 12 entries, run 2 put
 * objectui among the unaudited and enumerated zero, with nothing local
 * touching that checkout between them. Root cause, by ENUMERATION plus
 * REPRODUCTION rather than by the card's first suspect: for a repo pinned
 * topologically (its anchor resolving), the only per-run preconditions that
 * can change with zero local writes live in the freshness leg — the remote
 * probe and the tip-identity comparison. The recorded shallow-boundary-
 * connectivity hypothesis is structurally unreachable in that mode: the
 * #9902 horizon guard runs only where a DATE window is in force (`if
 * (!base)`), the anchor resolves from the object store (an upstream push
 * moves neither), and enumeration reads the local graph. `--self-test`
 * reproduces the flip on real fixtures: the same argv audits (exit 0, a
 * true zero), the remote receives ONE push, and it refuses BEHIND — the
 * safe direction (#4690), on a busy remote, as often as the remote moves.
 *
 * What the flip OWED was attribution, and that is the fix: every unaudited
 * row now carries a machine-readable precondition category
 * (`no-checkout` · `unparseable-origin` · `wrong-origin` ·
 * `unreachable-remote` · `remote-tip-unreadable` · `local-tip-unreadable` ·
 * `stale-mirror` · `unprobeable-ref` · `history-horizon` · `ref-unreadable`),
 * printed on the row, in the INCOMPLETE footer per repo, and in `--json` —
 * so two footers minutes apart differ by a stated reason, never only by a
 * slug list an operator has to diff across runs. (A pin that does not
 * resolve is NOT one of these: by the #12633 route-B ruling it falls back to
 * the date window and the row says so via `fellBack` — loud already.)
 *
 * Queue-batch TOPOLOGY (#11996) is a separate question from the window below,
 * and it is answered: measured NON-BLIND 2026-08-27 (six batch topologies plus
 * a live batch replay) — re-measure if the repo's merge method changes, or if
 * the mainline-commits / commit-paths enumeration is reworked.
 *
 * ## The WINDOW is landing order, not committer dates (#12633)
 *
 * The merge queue writes a batch entry's commit when the batch is BUILT, and
 * `main` receives it when the batch LANDS. Measured on two governed PRs of one
 * batch, 2026-08-26: #12440 committed 05:00:27Z, merged 05:25:22Z (1,495 s);
 * #12443 committed 05:00:49Z, merged 05:33:08Z (1,939 s). So a commit can sit
 * ABOVE another on `main`'s first-parent chain — it landed later — while
 * carrying an EARLIER committer date. Re-measured on this mainline 2026-08-27:
 * 10 inversions in 3,613 first-parent pairs, max 874 s, median 539 s; two of
 * the ten inverted commits touch a governed surface.
 *
 * `git log --since=DATE` cuts on committer date, so at a knife-edge boundary —
 * the previous round's tip, or an exact previous-round timestamp, which is what
 * 「实跑 `--since 上轮`」 invites — a governed landing that is above the
 * boundary but dated below it is simply absent. Measured on real history:
 * `--since 2026-08-14T05:55:02Z` reports 190 governed entries and `01a7337fc0`
 * (PR #8620, an ADR) is not among them; `--since 2026-08-14T05:44:52Z` reports
 * 191 and lists it. Same tree, same landed set, boundaries ten minutes apart —
 * and nothing in the first output marks the gap. Where that landing is the only
 * one in the window, the sweep prints a clean window and exits 0 = "swept
 * COMPLETELY", the one reading #4690 and #9902 say must never be producible.
 *
 * Ruled 2026-08-27 on #12633: **B for `--since-ref`, A for `--since`** — C
 * (detect and refuse, answering with a problem instead of an answer) and D
 * (document the hole) both declined. Three parts, and the third is what keeps
 * the invariant rather than the budget:
 *
 *   1. `--since-ref` IS TOPOLOGICAL. The window is the first-parent range from
 *      the ref to `origin/main`; committer dates are not consulted at all, so
 *      no skew of any size can move the boundary. Multi-repo: a bare
 *      `--since-ref` is tried in every governed repo and used wherever it
 *      resolves, and `--since-ref <repoId>=<ref>` pins one repo (repeatable).
 *      A repo no ref resolves in falls back to the date window below, and its
 *      report line SAYS which repos got which window — one repo's ref silently
 *      dating every other repo's window is the same class of bug as the one
 *      above.
 *      Recording the previous round's tip is the CALLER's obligation (this
 *      script keeps no state), so every sweep prints the `--since-ref` line to
 *      use next round. Bonus property: for a topological window the #9902
 *      horizon question answers itself — the presence of the ref in a checkout
 *      is necessary and sufficient for the range to be complete.
 *   2. A bare `--since` IS A DATE WINDOW, BACKED OFF BY A DECLARED BUDGET.
 *      `SKEW_BUDGET_SECONDS` = 3600: 1.86× the largest directly measured
 *      build-to-land skew (1,939 s, PR #12443) and 4.1× the largest
 *      committer-date inversion on this mainline (874 s, re-measured
 *      2026-08-27). ⛔ It is deliberately NOT the measured maximum — a bound
 *      written exactly at today's worst case invalidates itself the first time
 *      a slower batch lands. The cost is re-listing whatever landed in the hour
 *      before the boundary, and the report line says so out loud: a re-listed
 *      entry is RE-RECOGNITION (one glance from the maintainer, who recognised
 *      it last round), while a dropped entry is never seen again.
 *   3. THE DATE WINDOW IS CLOSED TOPOLOGICALLY, AND REFUSES TO READ CLEAN WHEN
 *      IT CANNOT PROVE IT. The emitted set is every first-parent commit at or
 *      above the DEEPEST commit whose committer date falls inside the budgeted
 *      window — a prefix of the chain, so no entry is ever dropped for being
 *      dated below something that landed before it, whatever the budget is.
 *      The proof obligation is the other half: the walk must actually SEE a
 *      commit dated below the boundary, or that deepest commit cannot be shown
 *      to be the deepest one. When it cannot, the repo is WINDOW EDGE — the ✅
 *      is suppressed and the sweep exits 2, because a skew larger than the
 *      budget must read as INCOMPLETE and never as clean-and-absent. Before
 *      giving up it widens the walk: one budget below the boundary, then a
 *      week, then the whole first-parent chain; a walk that reaches the root
 *      commit is complete by construction and never an edge. ⚠️ Stated
 *      plainly, because a backstop mistaken for the primary defense is how the
 *      primary one stops being maintained: on a COMPLETE clone the widened walk
 *      always reaches the root, so the edge cannot fire, and on a shallow one
 *      the #9902 horizon guard classifies the repo UNAUDITED before enumeration
 *      begins. This is the mechanical statement of the invariant standing
 *      behind a predicate that lives in another file — not the path a real
 *      sweep is expected to take. `--self-test` is where it is exercised.
 *
 * ## Institutional memory — why governed surfaces are guarded at all
 *
 * This history moved here from the retired gate's header when the gate
 * retired; it is the case law behind the discipline, not dead weight.
 *
 * - 2026-08-08, #6741 (maintainer, verbatim): 「adr 只能由维护者自己确认,
 *   人工合并,ai 不得擅自合并。」 Filed at 13:52Z. Within the following hour
 *   two DIFFERENT AI-operated seats merged docs/adr/** PRs anyway — one at
 *   14:23Z, one at 14:38Z, the second while the PR was in DRAFT state — both
 *   with ZERO reviews of any kind. Measured lessons: a ruling written into an
 *   issue does not reach sessions that never read that issue, and parking a
 *   PR as draft is not a barrier either.
 * - 2026-08-12, #8161: the gate's original identity proxy ("the maintainer's
 *   own account approved") became unsatisfiable — human and agent GitHub
 *   accounts are not stably partitioned (maintainer: 「人工专属账号 和 agent
 *   账户一直在切换,暂时没固定」), cloud sessions began authoring under the
 *   maintainer's own account, and GitHub forbids self-approval — so the gate
 *   was permanently red exactly when the human WAS driving. Ruling, verbatim:
 *   「门禁改成只要求「APPROVED review 存在」」/「不要指定具体的人」. Accepted
 *   cost, stated out loud then and still true: no identity-based signal can
 *   prove a review is human — an AI seat's approval satisfied the reworked
 *   gate too, which is half of why the per-PR gate ultimately retired.
 * - 2026-08-12, #8012: an AI seat ENABLED AUTO-MERGE on a live docs/adr/**
 *   PR at ~11:15Z. Arming is not merging — it is a standing instruction to
 *   merge later, and the next approving review would have merged the PR
 *   unattended with every check green. Hence the discipline names arming
 *   alongside merging and enqueueing, and armed+approved — not
 *   armed+unapproved — is the state in which the unattended merge actually
 *   fires. Disarming alone does not dequeue: converting the PR back to draft
 *   is what removes it from the merge queue.
 * - 2026-08-17, #9319 (from PR #9238): a `.claude/skills/**` PR whose own
 *   body said "draft, awaiting a human merge" was flipped ready and enqueued
 *   by an unidentified seat, and the merge queue landed it with ZERO reviews.
 *   All seats share one GitHub login, so "which seat flipped it" was not
 *   forensically answerable. The skill files are the operating protocol every
 *   LATER dispatch reads, so a bad landing there propagates into work nobody
 *   has started yet — that is why the governed surface covers the agent
 *   instruction tree, and (2026-08-18) the repo-root instruction files too.
 * - 2026-08-18, #9550 — the first datapoint on the bet this regime made, and
 *   it arrived NINETEEN MINUTES in. Measured timeline, one file in the diff
 *   (`AGENTS.md`, PR #9527): 07:32:55Z #9495 lands (86ea8df7d) and the
 *   repo-root instruction files become governed → 07:51:53Z a PM seat flips
 *   the PR `ready_for_review` (+19 min) → 07:52:06Z the same seat enqueues it
 *   (+13 s) → 08:08:35Z `github-merge-queue[bot]` removes it, on a merge
 *   CONFLICT against 86ea8df7d, the very commit that had made the file
 *   governed → 08:52:08Z another seat converts it back to draft. Both the
 *   flip and the enqueue are forbidden on a governed PR. ⭐ The conflict, not
 *   the discipline, is what stopped it: had #9495 touched a different part of
 *   `AGENTS.md`, this would be a governed merge nobody authorised. The seat's
 *   own root cause, verbatim from its own report: at the moment of arming it
 *   reasoned 「`AGENTS.md` is none of those. So arming is fine」 — RECALL of a
 *   register that had changed 19 minutes earlier, not DERIVATION from it, by
 *   the same seat that had written "re-read it rather than recalling it" into
 *   a dispatch prompt hours before. ⇒ That is the whole reason `--test`
 *   exists: derivation is now ONE command, so a seat cannot be wrong about a
 *   list it never re-read. Detection existed; this is the missing prevention
 *   primitive, and it costs one process spawn.
 *
 * ## Attribution readings, measured not assumed
 *
 * ⚠️ Read this before treating a resolved `merged_by` as an answer.
 * `merged_by` names an ACCOUNT, not a PRINCIPAL, and the two do not
 * correspond: the maintainer also operates the seat accounts. Measured
 * 2026-08-18 — objectui PR #5188, a governed-surface merge, read
 * `merged_by: os-steve` (a seat account) and was filed as a possible seat
 * violation; asked directly, the maintainer answered 「5188 是我合并的」. So a
 * token that resolves the column would NOT have answered the question; it
 * would have returned a seat login and left the audit exactly as uncertain,
 * while looking authoritative. The column is a PROMPT for the maintainer's
 * recognition, never a substitute for it — which is why the report prints
 * that caveat on every sweep that resolves anything, and why the fix for the
 * 401 wall (below) is a channel chain, not a claim of authority.
 * This is the same shared-identity trap the claim protocol documents, where
 * the workaround is the session ID inside the claim comment; a merge carries
 * no equivalent discriminator, and inventing one is a maintainer decision
 * this script does not take (#9619 records the three options).
 * On this repo `merged_by` has read as the human account for BOTH merge flows
 * (measured 2026-08-18: a queue-flow landing and a direct merge both read
 * `merged_by: hotlong`). If a future reading shows a bot login, report it
 * verbatim and extend the audit to read the enqueue actor from the issue
 * timeline (`added_to_merge_queue`) — never remap silently. A mainline commit
 * whose subject names NO PR is listed as its own loud entry (a direct push to
 * `main` is more anomalous than any PR merge, not less). Such an entry has no
 * pull request to query, so its attribution column reads NOT LOOKED UP, never
 * "every channel failed" — the three-way column at `attributionCell` (#12645)
 * carries that distinction and the reason it is not cosmetic.
 *
 * ### The attribution channel chain (#9619, measured on the PM container)
 *
 * The PM session container exports no usable `GITHUB_TOKEN`/`GH_TOKEN` —
 * GitHub reaches it through the MCP server, not the raw API — so the old
 * single-channel read answered HTTP 401 for EVERY entry and the sweep's
 * default outcome was "incomplete". An audit that always degrades to
 * incomplete is one a reader learns to skim, which is how a real violation
 * gets waved through. Channels are therefore tried in order and the first
 * success wins:
 *
 *   1. env token — `GITHUB_TOKEN` / `GH_TOKEN`, when one is exported.
 *   2. anonymous REST — no `authorization` header at all. Measured working
 *      2026-08-18 for the public repos (`objectstack`, `objectui` and
 *      `objectos` all answered 200 with `merged_by` populated); `cloud`
 *      answered 403 at the session proxy, which is exactly the case the named
 *      fallback line below is for.
 *
 * ⚠️ NEITHER channel reaches GitHub at all unless node's fetch is pointed at
 * the session proxy, and this is the trap that made the original 401 reading
 * look like a token problem when it was a TRANSPORT problem. Measured
 * 2026-08-18 in the PM container, all four readings on the same URL:
 *
 *   curl (reads HTTPS_PROXY)                        → 200, merged_by present
 *   node fetch, no flag, anonymous                  → 403
 *   node fetch, no flag, with the env token         → 401
 *   node fetch, NODE_OPTIONS=--use-env-proxy        → 200, merged_by present
 *
 * Node's global fetch does NOT read `HTTPS_PROXY` on its own (Node 22), so a
 * curl probe proves nothing about what this script will see — and the env
 * token in an agent container is the literal string `proxy-injected`, a
 * placeholder the PROXY swaps for a real credential. Bypass the proxy and it
 * is a bad token (401); go through the proxy and both channels answer 200.
 * `scripts/check-required-contexts.mjs` hit the identical trap (#9642) and
 * names this file as sharing it. `--use-env-proxy` must be set at process
 * start — assigning `process.env.NODE_USE_ENV_PROXY` from inside the script
 * is too late (measured: still 403) — so sweep mode RE-EXECS itself once with
 * the flag when a proxy is configured and the flag is absent, guarded by
 * `process.allowedNodeEnvironmentFlags` so an older node gets the printed
 * hint instead of a bad-option crash. `--test` and `--self-test` never
 * re-exec: they touch no network.
 *
 * When every channel fails for an entry, the entry still prints (marked
 * UNAVAILABLE, never silently blank) and the reason is stated ONCE per
 * repo+reason group as a NAMED line that says which channels were tried and
 * what each answered — instead of the per-entry error string that used to
 * bury the list it was attached to. The sweep still exits 2.
 *
 * ## Cost discipline
 *
 * Enumeration and diff-path reading are pure LOCAL git over each repo's
 * `origin/main` — zero API calls; the sweep header prints every audited
 * repo's tip and date. The one network cost before attribution is the #13307
 * reachability probe: ONE `git ls-remote --exit-code` per otherwise-auditable
 * repo, over the git wire protocol rather than the REST API, so the sweep's
 * API budget is unchanged. That probe is what upgraded the old stale-mirror
 * HEDGE into a reading: a repo with no mainline commit in the window used to
 * print an informational note naming its tip date, because local git cannot
 * distinguish "quiet repo" from "stale mirror" — it can now, by comparing tip
 * IDENTITY with the remote, so that case is either a MEASURED zero or an
 * UNAUDITED row, and never an advisory the reader has to act on. The GitHub
 * API is consulted only for
 * ATTRIBUTION, one `GET /pulls/{n}` per governed entry — on the ordinary day
 * with no governed merges the sweep costs ZERO lookups. `--test` never
 * touches the network, and spends anything at all in exactly one case: a hit
 * on a `GENERATED_SURFACE_EXCEPTIONS` row recomputes that generator's output
 * on the local tree under test (a #11705 row runs that generator's own
 * `--check` once, ~3 s, for every path it owns in the diff) — still zero API
 * calls; every other `--test` run reads only the register in this file.
 * `--branch` stays in that budget — two `git rev-parse`, one `git merge-base`
 * and one `git diff`, all local. `--pr` is the one mode that must reach the
 * API to answer at all, and it costs `1 + ceil(files / 100)` reads: one
 * `GET /pulls/{n}` for the `changed_files` count the page walk proves itself
 * against, then the pages. It reuses the sweep's channel chain and its proxy
 * re-arm; it opens no second client and wants no second token.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyHorizon } from './git-history.mjs';
import { gitFreeEnv, withoutGitEnv } from '../git-env.mjs';
import { quoteLine, readClause2Line, readMetadataProtocolLine } from './clause2-line.mjs';
import { EXIT_PREREQUISITE_NOT_MET, INSTALL_FIX, reportPrerequisiteNotMet } from '../import-prerequisite.mjs';
import { isEntrypoint } from '../invoked-as.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'the governed predicate: the 2026-08-18 unified list, exactly': 9,
  'the dispatch-gates declaration (#9979)': 9,
  '⚖️ the two landing tiers (#19133, ruled 2026-09-18)': 19,
  "a row's tier is scoped per repository (#25199)": 13,
  'since parsing': 4,
  'the window: landing order, not committer dates (#12633)': 15,
  'since-ref is topological (#12633 route B)': 7,
  '#13424: every ref resolves in ITS OWN repo, never only in self': 8,
  'the words an operator reads about the window': 4,
  'classification + replay fixtures': 11,
  'multi-repo scope (#9619)': 17,
  'remote reachability + mirror freshness (#13307)': 12,
  'the REAL prober, on real git fixtures (#13307)': 11,
  '#13836, the shallow-clone path, both directions': 6,
  'sweep-code provenance (#13307 reopen)': 5,
  'the report words an operator reads': 6,
  'an unreachable remote never renders as a clean window (#13307)': 9,
  'a truncated history is UNAUDITED, not a clean sweep (#9902)': 11,
  'attribution: the channel chain and its named fallback (#9619)': 19,
  'the attribution column\'s THIRD case (#12645)': 13,
  'the --test pre-arm predicate (#9550)': 31,
  'the generator co-edit fence (#11084), pinned in BOTH directions': 10,
  'the #11705 generator-owned rows inside `skills/**`': 23,
  '#11705 end to end, against the REAL generator': 7,
  "the live battery's prerequisite, and the floor it was misread as": 17,
  '⭐ #15406: the sweep row names the register it does not recompute': 10,
  '⭐ #17003: the list is DERIVED three-dot, or refused': 43,
  '⭐ #18055: the INCOMPLETE banner is BUILT, never thrown away': 11,
  '⭐ the SIZE predicate: over the human-merge line threshold, whatever the paths': 44,
  '⭐ #18989: the guard is the CALLER\'s name, and the mirror is pinned to its owner': 16,
  '⭐ #19036: the sweep lists an OVERSIZED landing beside the governed ones': 20,
  '⭐ the FORK predicate: head repo ≠ base repo is a proposal, never a delivery': 6,
  '⭐ the argv is CLOSED: a flag the mode does not read, or a second repository beside a bare --pr, is refused': 22,
  'the per-row repository scope (ruled B2, 2026-10-13)': 20,
  'the nested `ui/` workspace rows, on the register (#25712)': 16,
  '⭐ the workflows split: Tier H by path or by C2 trigger, else Tier S (ruling record 6722205630)': 75,
  // 74 → 95 with the arm's record stage: sixteen pins on the two conjuncts and the stage's three states, five on `--pr`;
  // 95 → 100 with every other card the pull names (`others`): labelled, unread, not said to be read, each its own
  // reason, and one on `--pr`.
  '⚖️ the low-risk skills arm: skills wording on Clause-② no lands Tier S, everything else stays H (#33501)': 100,
  // 51 → 66 with the record stage as the sweep reads it at the landing: ten pins, and five on which landings it binds;
  // 66 → 71 with the other cards as they stood at the landing (four pins) and the stage's two NOT MEASURED reads.
  '⚖️ #33603: the sweep lists a low-risk arm landing APART and judges it on a same-head at-tier PASS record': 71,
  '⭐ the weekly audit card: every reading the job files on, both ways (#33814)': 54,
  '⚖️ #33539: the ADR leg of the low-risk arm — an add-only note lands Tier S, any other ADR change stays H': 52,
  '⚖️ the guard instruments and the `.claude/**` declaration split (ruled 2026-11-19)': 36,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too. Raised 35 → 36 with the
// workflows split battery (ruling record 6722205630): one battery, one row.
// Raised 36 → 37 with the low-risk skills arm battery (#33501), 37 → 38 with its post-merge leg (#33603),
// 38 → 39 with the weekly audit card's battery (#33814), 39 → 40 with the arm's ADR leg (#33539),
// 40 → 41 with the guard instruments and the `.claude/**` declaration split (ruled 2026-11-19).
const SELF_TEST_BATTERY_FLOOR = 41;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

/**
 * The floor, as a FUNCTION OF A LEDGER (#13489's rule, unchanged in every word
 * it prints) — every declared battery ran, and ran its cases.
 *
 * Lifted out of `selfTest`'s body and given its ledger as an argument for one
 * reason: the floor is what renders a battery's silence, and until it took its
 * inputs it could not be handed a ledger to render. It had no pin of its own,
 * so the direction that matters most — a genuinely deleted case still reds, and
 * still names WHICH battery — was asserted nowhere. It is now, on fixture
 * ledgers built from this roster, next to the prerequisite that must be judged
 * BEFORE it. ⛔ Behaviour is unchanged: same order, same messages, same trailing
 * line. Rewording any string here rewords a verdict a reader acts on.
 *
 * ⚠️ The counts are a FLOOR, not an equality — adding cases is ordinary work and
 * must not red.
 *
 * @param {Map<string, number>} ledger  cases registered, per battery
 * @param {Record<string, number>} declared  the roster to judge against
 * @param {number} rosterFloor  the pinned size of that roster
 * @returns {string[]} the failures, empty when every floor holds
 */
function batteryFloorFailures(ledger, declared = SELF_TEST_BATTERIES, rosterFloor = SELF_TEST_BATTERY_FLOOR) {
  const declaredBatteries = Object.keys(declared);
  const problems = [];
  if (declaredBatteries.length < rosterFloor) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${rosterFloor} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of ledger) {
    if (declaredBatteries.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = ledger.get(name) ?? 0;
    if (count >= declared[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${declared[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${declared[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length > 0) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }
  return problems;
}

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);

/** The exit contract, named so the table above is machine-checkable. */
export const EXIT_SWEPT = 0;
export const EXIT_CANNOT_SWEEP = 1;
export const EXIT_INCOMPLETE = 2;
export const EXIT_TEST_GOVERNED = 3;
export const EXIT_TEST_NOT_GOVERNED = 0;

/**
 * The two landing tiers (header section "The two landing tiers"). Every register
 * row carries one as `tier`; `governedTierFor` derives a PR's tier from the rows
 * its governed paths hit. The VALUES are single letters on purpose — they render
 * inside verdict lines and `--json`, and a reader greps `Tier H` / `Tier S`.
 * `landing` is the sentence a verdict prints for the tier: what lifts the four
 * prohibitions, and who lands after that.
 */
export const GOVERNED_TIER_H = 'H';
export const GOVERNED_TIER_S = 'S';
export const GOVERNED_TIERS = Object.freeze({
  [GOVERNED_TIER_H]: Object.freeze({
    id: GOVERNED_TIER_H,
    name: 'Tier H(人合)',
    landing: "the maintainer's hand, or an authorized APPROVED review (GOVERNED_APPROVERS) and then the owning seat lands it",
  }),
  [GOVERNED_TIER_S]: Object.freeze({
    id: GOVERNED_TIER_S,
    name: 'Tier S(席内达档 L2 审核落地)',
    landing:
      'the owning seat lands it through the queue on a `## Contract review` record for the CURRENT head ' +
      '(`Served-tier: CONTRACT_REVIEW_TIER`, `**VERDICT: PASS**`) and every check green',
  }),
});

/**
 * The human-merge line threshold — the maintainer's 2026-09-18 ruling, its
 * 「比如5000」 taken as the ruled default, lowered on 2026-10-09 by the
 * maintainer's word (header: "The SIZE predicate"), verbatim and untranslated:
 *
 *   「这种大额改动就应该人工审核,我还是建议5000行的人工审核门槛降到 3000,立卡。」
 *
 * ONE declaration: the predicate, the words it prints, `dispatch-gates.mjs`'s
 * dispatch-time reading and the self-test's pins on both sides all read it
 * from here, so moving it is one word from the maintainer and one edit — the
 * 2026-10-09 move was exactly that. `additions + deletions` STRICTLY greater:
 * 3,000 changed lines is under the threshold, 3,001 is over; the self-test
 * pins the pair.
 */
export const HUMAN_MERGE_LINE_THRESHOLD = 3000;

/**
 * The governed surfaces, in report order — the 2026-08-18 unified definition
 * (see header), tiered by the 2026-09-18 ruling. `prefix` entries match path
 * prefixes; `exact` entries match one repo-relative path byte-for-byte (the
 * repo-ROOT instruction files, not `examples/AGENTS.md`, not template copies —
 * and `docs/NORTH-STAR.md`, the maintainer's North Star, joined 2026-09-18 on
 * his word as the law above `AGENTS.md`; the PM skill cites it by section). One
 * path hit governs a whole PR — 「混合 diff 一条命中即整 PR 分叉」; proportion is
 * never a question, and `tier` decides only what the landing waits for, never
 * whether the path is governed.
 *
 * The register is scoped PER ROW (maintainer ruling B2, 2026-10-13, header
 * section "The register is scoped per row"): by default a row governs every
 * repository in `GOVERNED_REPOS`, and a row may be scoped by a `repos` key
 * naming the subset it governs — ids from `GOVERNED_REPOS`, never slugs. A row
 * that declares no `repos` key carries the default; `surfaceRepos` is the one
 * reader of that default. The `workflows` row is scoped to the two public
 * repositories the ruling 「两仓加治理行」 names plus `cloud`, whose own table
 * already carries the same row, and since 2026-11-19 `hotcrm` (an audit
 * mirror: hotcrm's own AGENTS.md lists `.github/workflows/**` as governed;
 * maintainer, review-split thread, 「1+2+4」): `objectos` is NOT governed by
 * it — no ruling names it, and a new gate defaults to no. Every reader of
 * this table therefore asks for ONE repository (`governedPathsIn(paths,
 * repo)`), and a call that names none is refused, never answered for "all".
 *
 * A row's `tier` may be scoped the same way, by a `tierRepos` key naming the
 * ids where it holds; in every other repository the row governs, it lands
 * Tier H, the fail-closed tier. `surfaceTierIn` is the one reader of that key,
 * and `governedSurfacesFor` hands every matcher the tier for its repository.
 * The `claude-tree` row's Tier S holds in objectstack alone: the tier is the
 * landing the repository's own queue guard enforces, and only objectstack's
 * has a Tier S arm (#25199).
 *
 * The six `ui-*` rows are objectui's own register, carried under `ui/` now
 * that objectui's tree is this repository's `ui/` workspace (#25677, #25712):
 * every root row but the North Star, prefixed, scoped to objectstack (no other
 * repository has a `ui/` tree), and all Tier H — `ui/.claude/**` included,
 * which stays Tier H until it folds into the root `.claude/**` (maintainer
 * ruling 2026-10-25, director item 16). A root row never reaches into `ui/`
 * and a `ui-*` row never reaches the root: prefixes and exact paths both
 * anchor at the repository root.
 *
 * The seven rows after them govern objectstack alone and are all Tier H
 * (header section "The guard instruments and the `.claude/**` declaration
 * split"): `.claude/hooks/**` and both settings files, which OVERLAP the
 * `.claude/**` row on purpose — a path hits both, and one Tier H row among the
 * hits makes the whole PR Tier H, so no reading of the `.claude/**` row can
 * move them — and the four guard instruments, exact paths.
 */
/** The `workflows` row's prefix, which its content-aware split reads (`readWorkflowDiff`). */
export const WORKFLOWS_PREFIX = '.github/workflows/';

export const GOVERNED_SURFACES = Object.freeze([
  Object.freeze({ id: 'adr', prefix: 'docs/adr/', glob: 'docs/adr/**', tier: GOVERNED_TIER_H, lowRisk: Object.freeze({ repos: Object.freeze(['objectstack']), addOnly: true }), what: 'architecture decision records' }),
  Object.freeze({ id: 'claude-tree', prefix: '.claude/', glob: '.claude/**', tier: GOVERNED_TIER_S, tierRepos: Object.freeze(['objectstack']), ruleChange: Object.freeze({ repos: Object.freeze(['objectstack']) }), what: 'the agent instruction tree (skills, agents, hooks, settings)' }),
  Object.freeze({ id: 'skills-catalog', prefix: 'skills/', glob: 'skills/**', tier: GOVERNED_TIER_H, lowRisk: Object.freeze({ repos: Object.freeze(['objectstack']) }), what: 'the published skills catalog' }),
  Object.freeze({ id: 'agents-md', exact: 'AGENTS.md', glob: 'AGENTS.md', tier: GOVERNED_TIER_H, what: 'the repo-root agent instruction file' }),
  Object.freeze({ id: 'claude-md', exact: 'CLAUDE.md', glob: 'CLAUDE.md', tier: GOVERNED_TIER_H, what: 'the repo-root Claude instruction file' }),
  Object.freeze({ id: 'north-star', exact: 'docs/NORTH-STAR.md', glob: 'docs/NORTH-STAR.md', tier: GOVERNED_TIER_H, what: "the maintainer's North Star — the law above AGENTS.md" }),
  Object.freeze({ id: 'workflows', prefix: '.github/workflows/', glob: '.github/workflows/**', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack', 'objectui', 'cloud', 'hotcrm']), split: Object.freeze({ repos: Object.freeze(['objectstack']), reader: 'readWorkflowDiff' }), what: 'CI, deploy and release workflows: what runs on every push, what deploys, what gates the queue' }),
  Object.freeze({ id: 'ui-adr', prefix: 'ui/docs/adr/', glob: 'ui/docs/adr/**', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: "the ui workspace's architecture decision records" }),
  Object.freeze({ id: 'ui-claude-tree', prefix: 'ui/.claude/', glob: 'ui/.claude/**', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: "the ui workspace's agent instruction tree" }),
  Object.freeze({ id: 'ui-skills-catalog', prefix: 'ui/skills/', glob: 'ui/skills/**', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), lowRisk: Object.freeze({ repos: Object.freeze(['objectstack']) }), what: "the ui workspace's published skills catalog" }),
  Object.freeze({ id: 'ui-agents-md', exact: 'ui/AGENTS.md', glob: 'ui/AGENTS.md', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: "the ui workspace's agent instruction file" }),
  Object.freeze({ id: 'ui-claude-md', exact: 'ui/CLAUDE.md', glob: 'ui/CLAUDE.md', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: "the ui workspace's Claude instruction file" }),
  Object.freeze({ id: 'ui-workflows', prefix: 'ui/.github/workflows/', glob: 'ui/.github/workflows/**', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: "the ui workspace's workflow files" }),
  // The agents' own permissions and guardrails, always Tier H inside the `.claude/**` row (header section
  // "The guard instruments and the `.claude/**` declaration split"). Both settings files Claude Code reads.
  Object.freeze({ id: 'claude-hooks', prefix: '.claude/hooks/', glob: '.claude/hooks/**', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: "the agents' own guardrail hooks" }),
  Object.freeze({ id: 'claude-settings', exact: '.claude/settings.json', glob: '.claude/settings.json', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: "the agents' own permission set" }),
  Object.freeze({ id: 'claude-settings-local', exact: '.claude/settings.local.json', glob: '.claude/settings.local.json', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: "the agents' local permission set" }),
  // The guard's own instruments: the register and audit, the queue guard, the record readers it loads, and the
  // file that holds `CONTRACT_REVIEW_TIER`. A PR that edits one is judged by its own copy at the queue.
  Object.freeze({ id: 'guard-merges', exact: 'scripts/pm/check-governed-merges.mjs', glob: 'scripts/pm/check-governed-merges.mjs', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: 'the governed register, its tier functions and the post-merge audit' }),
  Object.freeze({ id: 'guard-queue', exact: 'scripts/pm/check-governed-queue-guard.mjs', glob: 'scripts/pm/check-governed-queue-guard.mjs', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: 'the merge-queue guard itself' }),
  Object.freeze({ id: 'guard-records', exact: 'scripts/pm/record-recognisers.mjs', glob: 'scripts/pm/record-recognisers.mjs', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: 'the contract-review record readers the queue guard loads' }),
  Object.freeze({ id: 'guard-dispatch-gates', exact: 'scripts/pm/dispatch-gates.mjs', glob: 'scripts/pm/dispatch-gates.mjs', tier: GOVERNED_TIER_H, repos: Object.freeze(['objectstack']), what: 'the file that holds `CONTRACT_REVIEW_TIER`, the tier a record must stand at' }),
]);

/**
 * The register's repo-ROOT rows, declared for `scripts/pm/dispatch-gates.mjs`
 * (#9979, applying #9964's pattern).
 *
 * That tool derives a card's gate list from the path literals in each gate's
 * own source, and "looks like a path" there means "carries a separator". The
 * three `prefix` rows above have one and reach dispatch-gates already — the
 * `skills/**` row is one of the three specimens that motivated reading a hint
 * AS WRITTEN. The two repo-ROOT `exact` rows do not: a repo-root FILE carries
 * no separator, so an `AGENTS.md` or `CLAUDE.md` card derived this gate not at
 * all while the same card is GOVERNED by it (draft-only PR, maintainer merge)
 * — the loudest possible thing to learn late. The `docs/NORTH-STAR.md` row is
 * `exact` WITH a separator: it reaches dispatch-gates as written and declares
 * no hint (the self-test pins that an exact row with a separator has none).
 *
 * `<file>/**` is the form that reaches one: the extractor accepts it, and
 * `collapseHint` reduces it back to that single path. `examples/AGENTS.md` and
 * the `create-objectstack` template copy stay out, exactly as the `exact` rows
 * intend.
 *
 * ⚠️ Provenance, NOT a matcher. `governedSlice` compares against `exact`, and
 * `glob` is the spelling the instruction files must carry verbatim
 * (`check-governed-prose.mjs` asserts prose containment against it, and both
 * files spell these two as bare filenames). Rewriting either field into the
 * glob form would silently change what this register GOVERNS and what the
 * prose gate demands; this list is read by neither. The self-test pins both
 * halves.
 */
export const ROOT_FILE_WATCH_HINTS = ['AGENTS.md/**', 'CLAUDE.md/**'];

/**
 * The provenance-aware exception register (#9866 + #11705; the header sections
 * above carry both rulings verbatim). Every row is a GENERATOR, not a path
 * exemption — ⛔ do not add a row without a ruling of its own, and ⛔ never add
 * one whose membership test is a hand-copied list of output paths: the ruled
 * shape is "the checker proves per-file that the content matches its
 * generator's output".
 *
 * Row fields:
 *   `path`       — an exact repo-relative path, for a generator that owns
 *                  exactly one file the register can name. No row uses this
 *                  today; it is kept because `generatedExceptionFor` reads it
 *                  and the shape is the cheaper one when it fits.
 *   `candidate`  — a NARROWING gate for a generator whose output set is
 *                  enumerated at run time: matching it earns a path the
 *                  question, never the answer. See the header — a candidate
 *                  cannot lift anything by itself, in either direction.
 *   `verify`     — the sink-generator recompute (#11705): run this package
 *                  script's `--check` on the tree under test and read the
 *                  output manifest it declares. REQUIRED: a row with no
 *                  recompute cannot prove anything, so it fails closed.
 *   `generator`  — the command an operator runs to regenerate; rendered in
 *                  every verdict, lifted or not.
 *   `trustedGeneratorPrefixes` — the tree whose co-edit fences this row
 *                  (#11084): a PR that edits the instrument cannot be measured
 *                  by it.
 */
export const GENERATED_SURFACE_EXCEPTIONS = Object.freeze([
  Object.freeze({
    id: 'spec-skill-refs',
    ruling: '#11705',
    candidate: /^skills\/[^/]+\/references\/_index\.md$/,
    surfaceId: 'skills-catalog',
    generator: 'pnpm --filter @objectstack/spec gen:skill-refs',
    verify: Object.freeze({ pkg: '@objectstack/spec', script: 'scripts/build-skill-references.ts', gate: 'check:skill-refs' }),
    trustedGeneratorPrefixes: Object.freeze(['packages/spec/scripts/']),
    what: "a skill's generated schema reference index (gen:skill-refs output, enumerated from the generator — not hand-authored skill content)",
  }),
  Object.freeze({
    id: 'spec-react-blocks',
    ruling: '#11705',
    candidate: /^skills\/[^/]+\/references\/react-blocks\.md$/,
    surfaceId: 'skills-catalog',
    generator: 'pnpm --filter @objectstack/spec gen:react-blocks',
    verify: Object.freeze({ pkg: '@objectstack/spec', script: 'scripts/build-react-blocks-contract.ts', gate: 'check:react-blocks' }),
    trustedGeneratorPrefixes: Object.freeze(['packages/spec/scripts/']),
    what: 'the react-tier component contract (gen:react-blocks output, enumerated from the generator — not hand-authored skill content)',
  }),
]);

/**
 * The register row a path belongs to, or null. THE membership test — both
 * scripts call this one function, so neither can hold a second, drifting copy
 * of "which paths are registered" (the queue guard used to derive its own set
 * from `.path`, which reads `undefined` for a row that has none).
 *
 * An exact row matches byte-for-byte; a `candidate` row matches its narrowing
 * regexp. Neither answer lifts anything: a matched path still has to survive
 * its row's recompute, and an unmatched path never consults provenance at all.
 */
export function generatedExceptionFor(path) {
  if (typeof path !== 'string' || path === '') return null;
  return GENERATED_SURFACE_EXCEPTIONS.find((e) => (e.path ? e.path === path : e.candidate.test(path))) ?? null;
}

/**
 * The #11084 fence, pure so `--self-test` pins both directions offline. Given
 * the PR's submitted path list and the register row under consideration,
 * answer a fail-closed provenance verdict when the tree under test also
 * modifies that row's trusted generator — or `null` when it does not, which is
 * the ONLY branch that goes on to recompute.
 *
 * Direction matters: a `null` answer changes nothing (the recompute runs and
 * rules exactly as before), and a non-null answer can only keep a path
 * GOVERNED. There is no branch here that lifts anything, so no spelling this
 * function fails to recognise can open the fence — recognising a co-edit is
 * strictly a tightening, which is why the leading `./` spelling is folded in
 * rather than left to `startsWith` alone.
 *
 * PER ROW, not global: the fence names the instrument that measures THIS row.
 * A PR that edits some OTHER generator tree has not touched this row's, and
 * fencing it there would refuse a regeneration the ruling allows. `entry` is
 * therefore required — there is no "the" row to default to, and a default would
 * silently measure one row's diff against another row's instrument.
 */
export function generatorCoEditProvenance(paths, entry) {
  const prefixes = entry?.trustedGeneratorPrefixes ?? [];
  if (prefixes.length === 0) {
    // No row, or a row that names no instrument tree: there is nothing to fence
    // WITH, so the honest answer is not "no co-edit" (which would send the path on
    // to be recomputed) but fail-closed — the one direction that cannot open a hole.
    return {
      pureRegeneration: false,
      reason:
        'the register row names no trusted generator tree, so a generator co-edit cannot be ruled out — ' +
        'fail closed: the path stays governed',
    };
  }
  const coEdited = (Array.isArray(paths) ? paths : []).filter(
    (p) => typeof p === 'string' && prefixes.some((prefix) => p.startsWith(prefix) || p.startsWith(`./${prefix}`)),
  );
  if (coEdited.length === 0) return null;
  return {
    pureRegeneration: false,
    reason:
      'the tree under test modifies the generator this exception trusts — the path stays governed ' +
      `(co-edited here: ${coEdited.join(', ')}). The recompute would run this PR's own generator, so it ` +
      'cannot certify this PR; land the generator change and the artifact regeneration as separate PRs.',
  };
}

/**
 * Apply the exception register to a `--test` verdict. Pure: provenance
 * arrives as a Map of path → `{ pureRegeneration, reason }` result. A
 * registered path with verified pure-regeneration provenance is LIFTED from
 * the hit set (recorded under `exceptions`, never under `clearPaths` — it is
 * on the register, exempted, not absent); a registered path with failed or
 * ABSENT provenance stays governed (constraint 4: fail closed). Unregistered
 * paths never consult provenance at all, and a hit on any other governed
 * path keeps the whole PR governed — the mixed-diff rule is untouched.
 */
export function applyGeneratedExceptions(verdict, provenanceByPath = new Map()) {
  const exceptions = verdict.hitPaths
    .map((path) => ({ path, entry: generatedExceptionFor(path) }))
    .filter(({ entry }) => entry !== null)
    .map(({ path, entry }) => {
      const provenance = provenanceByPath.get(path) ?? null;
      return {
        path,
        generator: entry.generator,
        ruling: entry.ruling,
        pureRegeneration: provenance?.pureRegeneration === true,
        reason: provenance?.reason ?? 'provenance was not recomputed — fail closed: the path stays governed',
      };
    });
  const lifted = new Set(exceptions.filter((e) => e.pureRegeneration).map((e) => e.path));
  if (lifted.size === 0) return { ...verdict, exceptions };
  const matched = verdict.matched
    .map((s) => ({ ...s, files: s.files.filter((f) => !lifted.has(f)) }))
    .filter((s) => s.files.length > 0);
  return {
    ...verdict,
    matched,
    hitPaths: verdict.hitPaths.filter((p) => !lifted.has(p)),
    governed: matched.length > 0,
    // Recomputed on the LIFTED slice (#19133): the lifted path may have been
    // the only Tier H hit, and a stale pre-lift `H` would send a Tier S diff to
    // the maintainer's click the ruling removed.
    tier: matched.length > 0 ? landingTierOf(matched) : null,
    // A lift moves a PATH off the register and moves the SIZE not at all
    // (the 2026-09-18 ruling has no exemption for generated files).
    humanMerge: matched.length > 0 || verdict.size?.exceeds === true || verdict.fork?.isFork === true,
    exceptions,
  };
}

/**
 * The six governed repos: the four the 2026-08-18 cross-repo extension named,
 * plus `hotcrm`, added by the 2026-09-03 ruling on #14867 (「其他同意」 → 纳入)
 * because the definition's own terms already covered it, plus `mobile`, the
 * native shell that hosts the Console, registered as an on-demand repo lane
 * by the maintainer's 2026-11-02 choice "Register, seat on demand
 * (Recommended)". Its workflows stay outside the scoped `workflows` row, as
 * hotcrm's do. `id` doubles as
 * the sibling directory name beside this checkout — the layout every session
 * container uses — and `--repo-root <id>=<path>` overrides it for any other
 * layout. A checkout whose `origin` remote is not `slug` is treated as ABSENT
 * (unaudited), never audited under the wrong name.
 */
export const GOVERNED_REPOS = Object.freeze([
  Object.freeze({ id: 'objectstack', slug: 'objectstack-ai/objectstack', what: 'the framework repo (this script lives here)' }),
  Object.freeze({ id: 'objectui', slug: 'objectstack-ai/objectui', what: 'the UI repo (live skills/** tree)' }),
  Object.freeze({ id: 'cloud', slug: 'objectstack-ai/cloud', what: 'the cloud repo' }),
  Object.freeze({ id: 'objectos', slug: 'objectstack-ai/objectos', what: 'the objectos repo' }),
  Object.freeze({ id: 'hotcrm', slug: 'objectstack-ai/hotcrm', what: 'the hotcrm exemplar app repo (#14867, ruled 2026-09-03)' }),
  Object.freeze({ id: 'mobile', slug: 'objectstack-ai/mobile', what: 'the mobile native shell repo that hosts the Console (on-demand repo lane, 2026-11-02)' }),
]);

export const SELF_REPO_ID = 'objectstack';

/** The `GOVERNED_REPOS` id whose `slug` is `owner/name` (case-insensitive), or null for a repository outside the register. Pure. */
export function repoIdForSlug(slug) {
  const wanted = String(slug ?? '').trim().toLowerCase();
  if (wanted === '') return null;
  return GOVERNED_REPOS.find((r) => r.slug.toLowerCase() === wanted)?.id ?? null;
}

/**
 * The repositories ONE register row governs: its `repos` key when it declares
 * one, else every id in `GOVERNED_REPOS` — the default the B2 ruling gives a
 * row that names no scope. Pure, and the only reader of that default.
 */
export function surfaceRepos(surface) {
  return Array.isArray(surface?.repos) ? [...surface.repos] : GOVERNED_REPOS.map((r) => r.id);
}

/**
 * The landing tier ONE register row carries in `repo`: its `tier` when it
 * declares no `tierRepos` or names `repo` there, else Tier H — the fail-closed
 * tier, so a repository added to `GOVERNED_REPOS` later never inherits a
 * cheaper landing than its own guard enforces. Pure, and the only reader of
 * `tierRepos`.
 */
export function surfaceTierIn(surface, repo) {
  if (!Array.isArray(surface?.tierRepos) || surface.tierRepos.includes(repo)) return surface?.tier;
  return GOVERNED_TIER_H;
}

/**
 * The register's question has a repository in it, or it has no answer. Throws
 * on a missing or unknown id — loudly, naming the ids this register knows —
 * rather than answering for every repository: a scoped row answers differently
 * per repository, so "all" is not a default, it is a wrong answer in one of
 * them. `caller` names the function whose contract was missed.
 */
export function assertGovernedRepo(repo, caller = 'governedPathsIn') {
  const ids = GOVERNED_REPOS.map((r) => r.id);
  if (typeof repo !== 'string' || repo === '') {
    throw new TypeError(
      `${caller} wants the repository the paths belong to, as a GOVERNED_REPOS id (${ids.join(', ')}); it got ` +
        `${JSON.stringify(repo ?? null)}. The register is scoped per row, so a call that names no repository has no ` +
        `answer — pass the id of the repository the paths are in (a slug resolves through repoIdForSlug).`,
    );
  }
  if (!ids.includes(repo)) {
    throw new TypeError(
      `${caller} got repository ${JSON.stringify(repo)}, which is not a GOVERNED_REPOS id (${ids.join(', ')}). ` +
        'A slug resolves through repoIdForSlug; a repository outside the register is outside the governed regime and ' +
        'is refused, never answered as clear.',
    );
  }
  return repo;
}

/**
 * The register's rows that govern `repo`, in report order — the per-repository
 * view every matcher reads, each carrying the tier it lands in `repo`
 * (`surfaceTierIn`): a row whose tier holds there is handed over as the table's
 * own frozen row, any other as a frozen copy carrying Tier H. Refuses a missing
 * or unknown repository.
 *
 * `register` is the table read, `GOVERNED_SURFACES` unless a caller hands in
 * another. ⛔ No production caller does: it is the seam the self-tests drive
 * with rows that are not on the register yet (the nested `ui/` workspace rows,
 * objectstack#25712), so the matchers are proven on those rows before the
 * register carries them. A register handed in is read exactly as the real one.
 */
export function governedSurfacesFor(repo, register = GOVERNED_SURFACES) {
  assertGovernedRepo(repo, 'governedSurfacesFor');
  return register.filter((surface) => surfaceRepos(surface).includes(repo)).map((surface) => {
    const tier = surfaceTierIn(surface, repo);
    return tier === surface.tier ? surface : Object.freeze({ ...surface, tier });
  });
}

/**
 * The governed slice of a path list in `repo`, grouped by surface. Surfaces
 * with no hit are absent — `matched.length === 0` IS the clean path. `repo`
 * is REQUIRED: the rows consulted are the ones that govern it, and a call
 * without one is refused (`assertGovernedRepo`).
 */
export function governedPathsIn(paths, repo, register = GOVERNED_SURFACES) {
  assertGovernedRepo(repo, 'governedPathsIn');
  const list = Array.isArray(paths) ? paths : [];
  return governedSurfacesFor(repo, register).map((surface) => ({
    ...surface,
    files: list.filter((p) =>
      typeof p === 'string' && (surface.prefix ? p.startsWith(surface.prefix) : p === surface.exact),
    ),
  })).filter((surface) => surface.files.length > 0);
}

/**
 * The landing tier of an already-matched governed slice (`governedPathsIn`'s
 * shape — post-lift callers hand in the lifted slice, so a certified
 * regeneration that was the only Tier H hit no longer decides). Pure.
 *
 * ⭐ ALL, not ANY: `S` only when every matched row is Tier S. An EMPTY slice
 * answers `H` — fail closed: a caller that reached a tier question with nothing
 * governed has lost the fact the question rests on, and the tier of nothing is
 * never the cheaper one. `testVerdict` reports `null` for that case itself,
 * before asking here.
 */
export function landingTierOf(matched) {
  const list = Array.isArray(matched) ? matched : [];
  if (list.length === 0) return GOVERNED_TIER_H;
  return list.every((s) => s?.tier === GOVERNED_TIER_S) ? GOVERNED_TIER_S : GOVERNED_TIER_H;
}

/**
 * The landing tier of a PR with these paths — `H` or `S`, never anything else.
 * Register-keyed: the rows the paths hit carry the answer, so no second copy of
 * "which surfaces land on a record" exists anywhere (the queue guard imports
 * THIS function). Ungoverned riders in the list are not consulted and cannot
 * demote a Tier H list or promote a Tier S one; an empty or wholly ungoverned
 * list answers `H` (see `landingTierOf`). `repo` is required, as for
 * `governedPathsIn`: the rows consulted are the ones that govern it.
 */
export function governedTierFor(paths, repo, register = GOVERNED_SURFACES, workflowDiff = null, lowRisk = null, ruleChange = undefined) {
  const id = assertGovernedRepo(repo, 'governedTierFor');
  // `ruleChange` left out (every path-only caller) passes the `.claude/**` row through unread; see `applyRuleChangeSplit`.
  return landingTierOf(applyRuleChangeSplit(applyLowRiskArm(applyWorkflowSplit(governedPathsIn(paths, id, register), id, workflowDiff), id, lowRisk), id, ruleChange));
}

// ── the `workflows` row's content-aware tier (ruling record 6722205630, letter C) ──

/**
 * Where the split is ruled and what it reads (header section "The workflows
 * row's split"). The row keeps `tier: H` — every path-only reader of the
 * register (the relay's review request, the CODEOWNERS mirror, the record
 * face) still answers H, the fail-closed tier. Only a reader that hands in a
 * READING of the diff (`readWorkflowDiff`) can move a workflow path to Tier S,
 * and only in the repositories the row's `split.repos` names.
 */
export const WORKFLOW_SPLIT_RULING = 'ruling record 6722205630, letter C';

/**
 * Tier H by PATH: the release, publish and deploy workflows, read off this
 * repository's own files (`push: true`, `npm publish`, `vercel deploy`, a wiki
 * push) and the row's own `what` ("what deploys"). Every edit to one of these
 * is Tier H whatever its content. `fleet-write.yml` is not a release — it is
 * the relay that holds the App key every fleet write leaves through, biased
 * to H for the credential. `governed-surface-guard.yml` runs the queue guard
 * (2026-11-19, the guard instruments ruling): measured on its own text, a new
 * step ahead of the guard step that overwrites the guard script reads S by
 * content, so the file is H by path. ⛔ A row here is a ruling-sized edit: it
 * widens the maintainer's queue, never the seats'.
 */
export const WORKFLOW_TIER_H_FILES = Object.freeze([
  Object.freeze({ path: '.github/workflows/release.yml', why: 'publishes the packages and queues the `release` deployment (Prime Directive #15)' }),
  Object.freeze({ path: '.github/workflows/docker-publish.yml', why: 'pushes the runtime image (`push: true`, `packages: write`)' }),
  Object.freeze({ path: '.github/workflows/framework-build-base.yml', why: 'pushes the framework build base image (`push: true`, `packages: write`)' }),
  Object.freeze({ path: '.github/workflows/docs-deploy.yml', why: 'deploys the docs site (`vercel deploy --prebuilt`, the deploy token)' }),
  Object.freeze({ path: '.github/workflows/checklist-status.yml', why: 'publishes the checklist status pages to the wiki (`contents: write`)' }),
  Object.freeze({ path: '.github/workflows/fleet-write.yml', why: "the fleet's write relay and its App key (biased to H: the credential, not a release)" }),
  Object.freeze({ path: '.github/workflows/governed-surface-guard.yml', why: 'runs the queue guard itself: a step added ahead of the guard step can rewrite the guard it then runs, and that edit reads S by content' }),
]);

/** The patterns an ADDED line may not carry without Tier H (biased cases: each can turn a check off or skip a gate). */
const WORKFLOW_RISKY_LINE = /\|\|\s*true\b|\bset\s+\+e\b|\bexit\s+0\b|\bOS_(?:SKIP|DISABLE|ALLOW)_[A-Z0-9_]+/;
/** `secrets`, or the job's token: `github.token` in any case, any `github[…]` index, or `toJSON(github)` whole. */
const WORKFLOW_CREDENTIAL = /\bsecrets\b|\bgithub\s*(?:\.\s*token\b|\[)|\btojson\s*\(\s*github\s*\)/i;
/**
 * The gate invocations a run block carries, each as a token; one dropped from a file is Tier H (biased: a removed check).
 * `git diff --exit-code` / `--quiet` keeps its arguments (a narrowed pathspec is a narrowed gate); `npx` drops the
 * package's `@version` (a bump is not a lost gate); `node` / `bash` / `sh` take the first file path after them.
 */
const WORKFLOW_INVOCATIONS = Object.freeze([
  [/check:[A-Za-z0-9:._-]+/g, (m) => m[0]],
  [/scripts\/[A-Za-z0-9._/-]+\.(?:mjs|cjs|js|mts|ts|sh|py)/g, (m) => m[0]],
  [/\b(vitest|eslint|tsc|playwright|lychee)\b/g, (m) => m[1]],
  [/\bturbo\s+run\s+([A-Za-z0-9:._-]+)/g, (m) => `turbo run ${m[1]}`],
  [/\bpnpm(?:\s+--?[A-Za-z][\w-]*(?:[= ](?!-)\S+)?)*\s+(?:run\s+)?([A-Za-z][\w:.-]*)/g, (m) => `pnpm ${m[1]}`],
  [/\bgit\s+diff\b(?=[^;&|)\n]*\s--(?:exit-code|quiet)\b)[^;&|)\n]*/g, (m) => m[0].replace(/\s+/g, ' ').trim()],
  [/\bnpx(?:\s+--?[A-Za-z][\w-]*(?:=\S+)?)*\s+["']?(@?[A-Za-z0-9][\w.-]*(?:\/[\w.-]+)?)/g, (m) => `npx ${m[1]}`],
  [/(?<![\w./-])(node|bash|sh)\s[^;&|\n]*?["']?(?:\.\/)?((?:[\w.@-]+\/)*[\w@-][\w.@-]*\.(?:mjs|cjs|js|mts|ts|sh|py))\b/g, (m) => `${m[1]} ${m[2]}`],
]);

const unquote = (value) => {
  const v = String(value ?? '').trim();
  return (v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1) ? v.slice(1, -1) : v;
};

/**
 * One line's YAML comment removed, quote-aware: a `#` opens a comment at the
 * line start or after whitespace, never inside a quoted scalar. A quote opens
 * only at a token start, so `don't` in a plain scalar is text. Returns null on
 * a quote that never closes on the line — the reader refuses those.
 */
function stripYamlComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote === '"') {
      if (c === '\\') i += 1;
      else if (c === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (c === "'") quote = null;
      continue;
    }
    const prev = i === 0 ? ' ' : line[i - 1];
    if ((c === '"' || c === "'") && /[\s[{,:]/.test(prev)) quote = c;
    else if (c === '#' && /\s/.test(prev)) return line.slice(0, i).trimEnd();
  }
  return quote === null ? line : null;
}

/** Why a scalar value cannot be read on one line, or null. */
function unreadableValue(value) {
  const v = value.trim();
  if (/^[&*!]/.test(v)) return 'an anchor, alias or tag';
  // A flow mapping hides its keys (`- { name: Gate, if: false }`) from this reader, so any one but `{}` is refused.
  if (v !== '{}' && /[{}]/.test(v.replace(/\$\{\{.*?\}\}/g, '').replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ''))) return 'a flow mapping';
  if (v.startsWith('{') || v.startsWith('[')) {
    let depth = 0;
    for (const c of v.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '')) {
      if (c === '{' || c === '[') depth += 1;
      else if (c === '}' || c === ']') depth -= 1;
    }
    if (depth !== 0) return 'a flow collection spanning lines';
  }
  return null;
}

/**
 * A line-model reader of ONE workflow file — the subset of YAML the
 * repository's workflows are written in: block mappings, block sequences,
 * one-line flow sequences, quoted and plain scalars (a plain scalar may
 * continue on deeper lines), and `|` / `>` block scalars. Pure, no dependency:
 * the queue guard's job imports this file before any install.
 *
 * ⛔ Fail closed: a tab in the indentation, a document marker or directive, an
 * anchor, alias, tag or merge key, a flow mapping other than `{}`, a flow
 * collection spanning lines, a quote that never closes, a double-quoted
 * escape that spells a character, a line led by a YAML indicator, a child
 * under a node with a scalar value, or a line that is neither a key, an item
 * nor a continuation answers `{ ok: false, line, reason }` — and an unread file is
 * Tier H. Returns `{ ok: true, root }`: nodes `{ indent, key, value, item,
 * children, block, line }`.
 */
export function readWorkflowTree(text) {
  if (typeof text !== 'string') return { ok: false, line: 0, reason: 'there is no text to read' };
  const root = { indent: -1, key: null, value: '', item: false, children: [], block: [], line: 0 };
  const stack = [root];
  const fail = (line, reason) => ({ ok: false, line, reason });
  const attach = (node) => {
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (top.indent < node.indent) break;
      // A compact sequence: `steps:` and its `- ` items at the same indent.
      if (node.item && top.indent === node.indent && !top.item && top.key !== null && top.value === '' && top.blockStyle === undefined) break;
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    // A node with a scalar value and children is not YAML: refuse it rather than guess which one GitHub reads.
    if (parent !== root && parent.value !== '') return false;
    parent.children.push(node);
    stack.push(node);
    return true;
  };
  let block = null;
  let last = null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const n = i + 1;
    if (block !== null) {
      const indentOf = raw.length - raw.trimStart().length;
      if (raw.trim() === '' || indentOf > block.indent) {
        block.node.block.push(raw.trim());
        continue;
      }
      block = null;
    }
    const lead = /^[ \t]*/.exec(raw)[0];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (lead.includes('\t')) return fail(n, 'a tab in the indentation');
    if (lead === '' && (/^(?:---|\.\.\.)(?:\s|$)/.test(trimmed) || trimmed.startsWith('%'))) return fail(n, 'a document marker or directive');
    let rest = stripYamlComment(trimmed);
    if (rest === null) return fail(n, 'a quote that never closes on its line');
    // `"i\x66"` is the key `if`: an escape that spells a character is refused, never compared raw.
    if ((rest.match(/"(?:[^"\\]|\\.)*"/g) ?? []).some((q) => /\\[xuUNLP_]/.test(q))) return fail(n, 'a double-quoted escape (`\\x`, `\\u`, `\\U`, …)');
    let indent = lead.length;
    let item = null;
    while (rest === '-' || rest.startsWith('- ')) {
      item = { indent, key: null, value: '', item: true, children: [], block: [], line: n };
      if (!attach(item)) return fail(n, 'a child under a node that already has a scalar value');
      if (rest === '-') {
        rest = '';
        break;
      }
      const after = rest.slice(2);
      indent += 2 + (after.length - after.trimStart().length);
      rest = after.trimStart();
    }
    if (rest === '') {
      last = item;
      continue;
    }
    const kv = /^("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_$][A-Za-z0-9_.$/-]*)\s*:(?:\s+(.*))?$/.exec(rest);
    if (kv) {
      const key = unquote(kv[1]);
      const value = (kv[2] ?? '').trim();
      if (key === '<<') return fail(n, 'a merge key');
      const why = unreadableValue(value);
      if (why) return fail(n, why);
      const node = { indent, key, value, item: false, children: [], block: [], line: n };
      if (/^[|>][0-9+-]*$/.test(value)) {
        node.value = '';
        node.blockStyle = value;
        block = { node, indent };
      }
      if (!attach(node)) return fail(n, 'a child under a node that already has a scalar value');
      last = node;
      continue;
    }
    const why = unreadableValue(rest);
    if (why) return fail(n, why);
    if (item !== null) {
      item.value = rest;
      last = item;
      continue;
    }
    // A continuation never starts with an indicator: `? permissions` / `: write-all` is an explicit key, not text.
    if (/^[?:\-,[\]{}#&*!|>'"%@`]/.test(rest)) return fail(n, `a line led by the YAML indicator \`${rest[0]}\``);
    if (last !== null && indent > last.indent && last.blockStyle === undefined && last.children.length === 0) {
      last.value = `${last.value} ${rest}`.trim();
      continue;
    }
    return fail(n, 'a line that is neither a key, a list item nor a continuation');
  }
  return { ok: true, root };
}

/** A node's subtree, indentation-free, as one comparable string. */
function serializeNode(node) {
  return JSON.stringify([node.item ? '-' : '', node.key, node.value, node.block, node.children.map(serializeNode)]);
}

/** A node's own text: key, value and block lines — what a pattern is matched against. */
function ownText(node) {
  return [`${node.key ?? ''}: ${node.value}`, ...node.block].join('\n');
}

/** A flow list, a scalar, or the block items / keys under a node, as names. */
function namesUnder(node) {
  if (!node) return [];
  if (node.value !== '') {
    const v = node.value.trim();
    return (v.startsWith('[') ? v.slice(1, -1).split(',') : [v]).map(unquote).map((s) => s.trim()).filter(Boolean);
  }
  return node.children.map((c) => unquote(c.item ? c.value : c.key)).filter(Boolean);
}

/** The identity a `uses:` or image names, its version dropped: a bump of an action already in use is the same identity. */
export function workflowUsesIdentity(value) {
  const v = unquote(value);
  if (v.startsWith('docker://')) return v.replace(/@sha256:[0-9a-f]+$/, '').replace(/:[^/:]+$/, '');
  if (v.startsWith('./')) return v;
  return v.replace(/@.*$/, '');
}

const childOf = (node, key) => node?.children.find((c) => !c.item && c.key === key) ?? null;

/**
 * The facts of ONE workflow file the classifier compares — or the reader's
 * refusal. Every fact names its OWNER (`workflow`, `job:ID`, or
 * `job:ID/step:KEY`), so a line moved inside its owner is the same fact and a
 * line moved to another job is not. A step's KEY is its `id`, `name`, `uses`
 * identity or first run line, in that order, numbered when repeated.
 */
export function workflowFacts(text) {
  const tree = readWorkflowTree(text);
  if (!tree.ok) return tree;
  const top = (key) => childOf(tree.root, key);
  const facts = {
    ok: true,
    name: top('name') ? unquote(top('name').value) : null,
    events: [...new Set(namesUnder(top('on')))].sort(),
    jobs: new Map(),
    owners: new Map([['workflow', serializeNode(tree.root)]]),
    permissions: [], ifs: [], coes: [], credentialLines: [], risky: [],
    credentialOwners: new Set(), writeOwners: new Set(),
    uses: [], invocations: new Set(),
    // Per JOB: the gate tokens and `uses:` identities it holds, so a step moved out of an existing job is seen.
    jobTokens: new Map(),
  };
  const holdToken = (owner, token) => {
    if (!owner.startsWith('job:')) return;
    const id = owner.split('/')[0].slice('job:'.length);
    if (!facts.jobTokens.has(id)) facts.jobTokens.set(id, new Set());
    facts.jobTokens.get(id).add(token);
  };
  const visit = (node, owner) => {
    const text = ownText(node);
    if (node.key === 'permissions') {
      facts.permissions.push(JSON.stringify([owner, serializeNode(node)]));
      if (/\bwrite(?:-all)?\b/.test(serializeNode(node))) facts.writeOwners.add(owner);
    }
    if (node.key === 'if') facts.ifs.push([owner, [node.value, ...node.block].join(' ').replace(/\s+/g, ' ').trim()]);
    if (node.key === 'continue-on-error' && !/^(?:false|'false'|"false")$/.test(node.value)) facts.coes.push(JSON.stringify([owner, node.value]));
    if (WORKFLOW_CREDENTIAL.test(text)) {
      facts.credentialOwners.add(owner);
      facts.credentialLines.push(JSON.stringify([owner, text]));
    }
    for (const line of [node.value, ...node.block]) {
      if (!line.trim().startsWith('#') && WORKFLOW_RISKY_LINE.test(line)) facts.risky.push(JSON.stringify([owner, line.trim()]));
    }
    if (node.key === 'uses' || (node.key === 'image' && node.value !== '')) {
      facts.uses.push(workflowUsesIdentity(node.value));
      holdToken(owner, `uses: ${workflowUsesIdentity(node.value)}`);
    }
    if (node.key === 'run') {
      for (const line of [node.value, ...node.block]) {
        if (line.trim().startsWith('#')) continue;
        for (const [pattern, token] of WORKFLOW_INVOCATIONS) {
          for (const m of line.matchAll(pattern)) {
            facts.invocations.add(token(m));
            holdToken(owner, token(m));
          }
        }
      }
    }
    for (const child of node.children) visit(child, owner);
  };
  for (const child of tree.root.children) {
    if (child.key !== 'jobs') visit(child, 'workflow');
  }
  const jobsNode = top('jobs');
  for (const job of jobsNode?.children ?? []) {
    if (job.item) continue;
    const id = job.key;
    const owner = `job:${id}`;
    const steps = [];
    const seen = new Map();
    const stepsNode = childOf(job, 'steps');
    for (const step of stepsNode?.children ?? []) {
      if (!step.item) continue;
      const pick = (k) => childOf(step, k);
      const run = pick('run');
      const base =
        unquote(pick('id')?.value ?? '') ||
        unquote(pick('name')?.value ?? '') ||
        (pick('uses') ? workflowUsesIdentity(pick('uses').value) : '') ||
        (run ? [run.value, ...run.block].find((l) => l.trim() !== '') ?? '' : '') ||
        '(anonymous)';
      const k = (seen.get(base) ?? 0) + 1;
      seen.set(base, k);
      const stepOwner = `${owner}/step:${base}${k > 1 ? `#${k}` : ''}`;
      steps.push(stepOwner);
      facts.owners.set(stepOwner, serializeNode(step));
      for (const child of step.children) visit(child, stepOwner);
    }
    for (const child of job.children) {
      if (child !== stepsNode) visit(child, owner);
    }
    facts.owners.set(owner, serializeNode(job));
    facts.jobs.set(id, { name: unquote(childOf(job, 'name')?.value ?? '') || id, needs: namesUnder(childOf(job, 'needs')), steps });
  }
  return facts;
}

/**
 * What a base tree already uses and names, across every workflow (the files
 * `readWorkflowDiff` hands in, never `.github/actions/**`, which is no register
 * row): the `uses:` / image identities a head may use without Tier H, and
 * the job names a NEW job may not take (two jobs, one check-run name). An
 * unparseable file still contributes its `uses:` lines, read by pattern.
 */
export function workflowInventory(files) {
  const uses = new Set();
  const jobNames = new Set();
  for (const { text } of Array.isArray(files) ? files : []) {
    const facts = workflowFacts(text);
    if (facts.ok) {
      for (const u of facts.uses) uses.add(u);
      for (const job of facts.jobs.values()) jobNames.add(job.name);
    }
    for (const m of String(text ?? '').matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) uses.add(workflowUsesIdentity(m[1]));
  }
  return { uses, jobNames };
}

/** The members of `b` not matched one-for-one in `a` — a multiset difference. Pure. */
function addedIn(a, b) {
  const pool = new Map();
  for (const x of a) pool.set(x, (pool.get(x) ?? 0) + 1);
  const out = [];
  for (const x of b) {
    const left = pool.get(x) ?? 0;
    if (left > 0) pool.set(x, left - 1);
    else out.push(x);
  }
  return out;
}

const ownerWords = (owner) => (owner === 'workflow' ? 'the workflow level' : `\`${owner}\``);

/**
 * The Tier H triggers between two parsed copies of one workflow file, as
 * reasons — empty means Tier S. The C2 list of the ruling, then the cases
 * biased to H. Pure.
 */
export function workflowDiffReasons(a, b, inventory) {
  const reasons = [];
  const say = (reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  // C2 — permissions, credentials, pull_request_target.
  if (addedIn(a.permissions, b.permissions).length + addedIn(b.permissions, a.permissions).length > 0) say('a `permissions:` block added, changed or removed');
  for (const line of [...addedIn(a.credentialLines, b.credentialLines), ...addedIn(b.credentialLines, a.credentialLines)]) say(`a \`secrets.*\` / token reference added, changed or moved at ${ownerWords(JSON.parse(line)[0])}`);
  if (a.events.includes('pull_request_target') || b.events.includes('pull_request_target')) say('a `pull_request_target` workflow: every edit runs with the base repository\'s credentials');
  // C2 — a `uses:` (or image) the base tree does not already use anywhere.
  if (!inventory) say('no inventory of the base tree\'s actions was read, so a new `uses:` cannot be ruled out');
  else for (const u of new Set(b.uses)) if (!inventory.uses.has(u)) say(`a \`uses:\` / image not used anywhere on the base tree: \`${u}\``);
  // C2 — a deleted job, or a changed check-run name set.
  for (const [id, job] of a.jobs) {
    const now = b.jobs.get(id);
    if (!now) say(`a deleted job: \`${id}\``);
    else {
      // A required context is a literal name (`check:required-contexts` refuses a matrix on one), so a rename
      // between two COMPUTED names — a matrix job's shard count — changes no required context.
      const computed = (name) => name.includes('${{');
      if (now.name !== job.name && !(computed(now.name) && computed(job.name))) say(`a job's check-run name changed: \`${id}\` \`${job.name}\` → \`${now.name}\``);
      // Either direction: a job whose dependency is skipped is skipped, and a skipped required check reads green.
      // A gate step moved out of an existing job (into a new job that never runs) is a dropped gate there.
      const held = b.jobTokens.get(id) ?? new Set();
      for (const token of a.jobTokens.get(id) ?? []) if (!held.has(token)) say(`an existing job no longer holds \`${token}\`: \`${id}\``);
      if ([...new Set(job.needs)].sort().join() !== [...new Set(now.needs)].sort().join()) say(`a job's \`needs:\` changed: \`${id}\` [${job.needs.join(', ')}] → [${now.needs.join(', ')}]`);
    }
  }
  for (const [id, job] of b.jobs) {
    if (a.jobs.has(id)) continue;
    if (job.name.includes('${{')) say(`a new job whose check-run name is computed: \`${id}\``);
    else if (inventory && inventory.jobNames.has(job.name)) say(`a new job takes a check-run name already in use: \`${id}\` \`${job.name}\``);
  }
  if (a.name !== b.name) say('the workflow `name:` changed');
  if (a.events.join() !== b.events.join()) say(`the trigger set changed: [${a.events.join(', ')}] → [${b.events.join(', ')}]`);
  // C2 — a new `continue-on-error`, or an `if:` the base does not hold for the same owner with the same text.
  // An owner is a name the author picks, so only a job NEW on the head may bring its own `if:`: a renamed step
  // given `if: false` beside a dummy under the old name is in an existing job, and is H.
  for (const fact of addedIn(a.coes, b.coes)) say(`a new \`continue-on-error\` at ${ownerWords(JSON.parse(fact)[0])}`);
  for (const fact of addedIn(a.ifs.map((f) => JSON.stringify(f)), b.ifs.map((f) => JSON.stringify(f)))) {
    const [owner] = JSON.parse(fact);
    const jobId = owner === 'workflow' ? null : owner.split('/')[0].slice('job:'.length);
    if (jobId === null || a.jobs.has(jobId)) say(`an \`if:\` added or changed in a job that already ran: ${ownerWords(owner)}`);
  }
  // Biased to H — each listed in the report.
  for (const owner of new Set([...a.credentialOwners, ...b.credentialOwners, ...a.writeOwners, ...b.writeOwners])) {
    const before = a.owners.get(owner);
    const after = b.owners.get(owner);
    if (before !== undefined && after !== undefined && before !== after) say(`a changed ${ownerWords(owner)} that already holds a secret or a write token`);
  }
  for (const fact of addedIn(a.risky, b.risky)) say(`an added line that can skip a check: \`${JSON.parse(fact)[1].trim().slice(0, 80)}\``);
  for (const token of a.invocations) if (!b.invocations.has(token)) say(`a gate invocation dropped from the file: \`${token}\``);
  for (const u of new Set(a.uses)) if (!b.uses.includes(u)) say(`a \`uses:\` / image dropped from the file: \`${u}\``);
  return reasons;
}

/**
 * ONE workflow file's tier between two commits: `{ path, tier, reasons }`,
 * `S` only when no reason holds. Pure over the texts (`null` = absent at
 * that commit). ⛔ Fail closed on every reading the classifier cannot make:
 * a pinned release/publish/deploy file, a file that is not YAML, a new or
 * deleted file, a copy that does not parse — each is Tier H with its reason.
 */
export function classifyWorkflowChange({ path, base = null, head = null, inventory = null }) {
  const reasons = [];
  const pinned = WORKFLOW_TIER_H_FILES.find((f) => f.path === path);
  if (pinned) reasons.push(`a release, publish or deploy workflow, Tier H by path: ${pinned.why}`);
  else if (!/\.ya?ml$/.test(String(path))) reasons.push('not a `.yml` / `.yaml` file, so the classifier cannot read it');
  else if (base === null && head === null) reasons.push('absent at both commits: nothing was read');
  else if (base === null) reasons.push('a new workflow file: every trigger, job and permission in it is new');
  else if (head === null) reasons.push('a deleted workflow file: every job in it is deleted');
  else if (base !== head) {
    const a = workflowFacts(base);
    const b = workflowFacts(head);
    if (!a.ok) reasons.push(`the base copy does not parse (line ${a.line}: ${a.reason})`);
    if (!b.ok) reasons.push(`the head copy does not parse (line ${b.line}: ${b.reason})`);
    if (a.ok && b.ok) reasons.push(...workflowDiffReasons(a, b, inventory));
  }
  return { path, tier: reasons.length === 0 ? GOVERNED_TIER_S : GOVERNED_TIER_H, reasons };
}

/**
 * The READING the split needs: every changed workflow path classified between
 * `base` and `head`, with `inventoryBase`'s actions and job names as what is
 * "already in use". `git(argv)` returns stdout and throws on failure — the
 * seam the self-test drives and both scripts' callers fill. `cache` (a Map)
 * keeps one inventory per base across the rows of one run.
 *
 * ⛔ Fail closed: no base, an unreadable commit or any git failure answers
 * `{ measured: false, reason }`, and an unmeasured reading is Tier H.
 */
export function readWorkflowDiff({ paths, base, head, inventoryBase = base, git, cache = null }) {
  const unmeasured = (reason) => ({ measured: false, reason, base: base ?? null, head: head ?? null, files: [] });
  const wanted = [...new Set((Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p.startsWith(WORKFLOWS_PREFIX)))];
  if (typeof base !== 'string' || base === '') return unmeasured('no base commit was named, so the workflow diff has nothing to be read against');
  if (typeof head !== 'string' || head === '') return unmeasured('no head commit was named, so the workflow diff cannot be read');
  if (typeof git !== 'function') return unmeasured('no git reader was supplied');
  try {
    // ⛔ `-z`, split on NUL, never trimmed: without it git C-quotes a non-ASCII or control-character name, and
    // the quoted spelling equals no path the row carries (enumerateRows reads its paths `-z` too).
    const listAt = (rev, ...dirs) => git(['ls-tree', '-r', '-z', '--name-only', rev, '--', ...dirs]).split('\0').filter(Boolean);
    const show = (rev, path) => git(['show', `${rev}:${path}`]);
    let inventory = cache?.get(inventoryBase) ?? null;
    if (inventory === null) {
      // Workflows only: `.github/actions/**` is no register row, so an action used there alone vouches for
      // nothing. The listing argv is unchanged (the queue guard pins it read once per run); the filter drops them.
      const files = listAt(inventoryBase, '.github/workflows', '.github/actions').filter((p) => p.startsWith(WORKFLOWS_PREFIX) && /\.ya?ml$/.test(p));
      inventory = workflowInventory(files.map((p) => ({ path: p, text: show(inventoryBase, p) })));
      cache?.set(inventoryBase, inventory);
    }
    const baseFiles = new Set(listAt(base, WORKFLOWS_PREFIX));
    const headFiles = new Set(listAt(head, WORKFLOWS_PREFIX));
    const files = wanted.map((path) =>
      classifyWorkflowChange({ path, base: baseFiles.has(path) ? show(base, path) : null, head: headFiles.has(path) ? show(head, path) : null, inventory }),
    );
    return { measured: true, reason: null, base, head, inventoryBase, files };
  } catch (error) {
    return unmeasured(`git could not read the workflow files (${String(error?.stderr || error?.message || error).trim().split('\n')[0]})`);
  }
}

/** Several readings of one pull request (one per queued commit) as one: unmeasured if any is, else every file, H winning a path read twice. Pure. */
export function mergeWorkflowReadings(readings) {
  const list = (Array.isArray(readings) ? readings : []).filter((r) => r !== null && r !== undefined);
  if (list.length === 0) return null;
  const unread = list.find((r) => r.measured !== true);
  if (unread) return { measured: false, reason: unread.reason ?? 'a reading was not measured', base: unread.base ?? null, head: unread.head ?? null, files: [] };
  const byPath = new Map();
  for (const file of list.flatMap((r) => r.files)) {
    const seen = byPath.get(file.path);
    byPath.set(file.path, seen ? { path: file.path, tier: seen.tier === GOVERNED_TIER_S && file.tier === GOVERNED_TIER_S ? GOVERNED_TIER_S : GOVERNED_TIER_H, reasons: [...seen.reasons, ...file.reasons] } : file);
  }
  return { measured: true, reason: null, base: list[0].base, head: list[list.length - 1].head, files: [...byPath.values()] };
}

/**
 * The split verdict for one matched row's files: `S` only when the reading was
 * measured and classified EVERY file `S`. A path the reading did not classify,
 * or no reading at all, is H. Pure.
 */
export function workflowSplitVerdict(files, reading) {
  const list = Array.isArray(files) ? files : [];
  if (!reading || reading.measured !== true) {
    return { tier: GOVERNED_TIER_H, measured: false, reason: reading?.reason ?? 'no reading of the diff was handed in — a path list alone cannot say what a workflow edit changes', files: [] };
  }
  const byPath = new Map(reading.files.map((f) => [f.path, f]));
  const judged = list.map((p) => byPath.get(p) ?? { path: p, tier: GOVERNED_TIER_H, reasons: ['the reading did not classify this path'] });
  return { tier: judged.length > 0 && judged.every((f) => f.tier === GOVERNED_TIER_S) ? GOVERNED_TIER_S : GOVERNED_TIER_H, measured: true, reason: null, files: judged, base: reading.base ?? null, head: reading.head ?? null };
}

/**
 * The matched slice with every split row's tier read off the diff, in `repo`.
 * A row without `split`, or a repository its `split.repos` does not name,
 * passes through as the same object — so every reading without a workflow
 * hit is byte-identical to before. Pure.
 */
export function applyWorkflowSplit(matched, repo, reading = null) {
  return (Array.isArray(matched) ? matched : []).map((surface) => {
    if (!surface?.split || !surface.split.repos.includes(repo)) return surface;
    const splitVerdict = workflowSplitVerdict(surface.files, reading);
    return Object.freeze({ ...surface, tier: splitVerdict.tier, splitVerdict });
  });
}

/**
 * The split's words under a verdict, or '' when no split row was hit (every
 * other rendering byte-identical). Pure.
 */
export function renderWorkflowSplitLines(matched) {
  const rows = (Array.isArray(matched) ? matched : []).filter((s) => s?.splitVerdict);
  return rows
    .map(({ splitVerdict: v }) => {
      if (!v.measured) {
        return (
          `      ⚖️ ${WORKFLOWS_PREFIX}** split (${WORKFLOW_SPLIT_RULING}): content NOT MEASURED — ${v.reason}.\n` +
          '         Tier H, fail closed. `--branch <ref>`, or `--pr <n>` on a checkout holding both commits, reads it.\n'
        );
      }
      if (v.tier === GOVERNED_TIER_S) {
        return `      ⚖️ ${WORKFLOWS_PREFIX}** split (${WORKFLOW_SPLIT_RULING}): Tier S by content — ${v.files.length} file(s) read, no Tier H trigger.\n`;
      }
      const hot = v.files.filter((f) => f.tier !== GOVERNED_TIER_S);
      return (
        `      ⚖️ ${WORKFLOWS_PREFIX}** split (${WORKFLOW_SPLIT_RULING}): Tier H by content —\n` +
        hot.map((f) => `        - ${f.path}: ${f.reasons.slice(0, 4).join('; ')}${f.reasons.length > 4 ? `; +${f.reasons.length - 4} more` : ''}\n`).join('')
      );
    })
    .join('');
}

// ── the low-risk skills arm (maintainer ruling 2026-11-14, card #33501) ─────

/**
 * Where the arm is ruled (header section "The low-risk skills arm"), printed on
 * every reading so a queue log names what moved a skills PR to Tier S.
 */
export const LOW_RISK_ARM_RULING = 'maintainer ruling 2026-11-14 on #33501, 「同意 把低风险的 Tier H 放权给座位」';

/**
 * The ungoverned paths a low-risk PR may carry BESIDE its low-risk rows: a
 * changeset (the one the published catalog owes) and Markdown prose under the
 * docs trees the register does not govern. ⭐ An ALLOWLIST of path SHAPES, never
 * a denylist of published trees: anything else — `packages/**`,
 * `ui/packages/**`, a gate script, a ratchet ceiling, a lockfile, a non-prose
 * file under a docs tree — keeps the PR Tier H however harmless it reads,
 * because the ruling's arm is wording and a denylist fails open on the next
 * published tree. `docs/adr/**` and `docs/NORTH-STAR.md` match the prose shape
 * but are register rows: the first is the arm's ADR leg (read add-only), the
 * second sits outside the arm, so the governed-rows rule keeps it H.
 */
export const LOW_RISK_RIDER_PATTERNS = Object.freeze([/^\.changeset\/[^/]+\.md$/, /^(?:content\/)?docs\/.+\.mdx?$/]);

/** Does this matched row carry the arm in `repo`? */
function lowRiskArmIn(surface, repo) {
  return Boolean(surface?.lowRisk) && Array.isArray(surface.lowRisk.repos) && surface.lowRisk.repos.includes(repo);
}

/**
 * The file SHAPES a low-risk row may change: skill wording and its evals,
 * nothing else. A script, a JSON or YAML outside an `evals/` folder, an image or
 * any other file under `skills/**` keeps the PR H.
 */
export const LOW_RISK_ARM_FILE_PATTERNS = Object.freeze([/\.md$/, /(?:^|\/)evals\/[^/]+\.json$/]);

// ── the ADR leg of the arm: add-only notes (card #33539, same ruling) ────────

/**
 * The file SHAPE an add-only row (`lowRisk.addOnly`, the `adr` row) may change: a numbered record directly under
 * the row (`docs/adr/NNNN-slug.md`). The generated index (`README.md`, which also states the registry's
 * conventions), a subfolder, an image or any other file under `docs/adr/**` keeps the PR H.
 */
export const LOW_RISK_ADD_ONLY_FILE_PATTERNS = Object.freeze([/^docs\/adr\/\d{4}-[^/]+\.md$/]);

/**
 * The context the add-only diff is read at: enough lines that ONE hunk carries
 * the whole file, so every line's heading is read off the diff itself, on both
 * sides, rather than off a second read. A file longer than this reads as
 * several hunks, which the reader refuses (H).
 */
export const LOW_RISK_ADD_ONLY_CONTEXT = 1000000;

/**
 * A heading whose text names the decision or the status, in the spellings the registry uses (English and
 * Chinese): every line under it is the record's ruling or its state.
 */
export const LOW_RISK_ADD_ONLY_RULED_HEADING = /decision|\bstatus\b|\bdecided\b|\bruling\b|\bresolution\b|决策|决定|裁决|状态|決策|決定|裁決|狀態/i;

/**
 * The same words read with spaces, punctuation and symbols squeezed out (case folded): a letter-spaced
 * `D e c i s i o n` or `S.t.a.t.u.s` names the ruling too. Wider than the word test on purpose, so it only ever
 * REFUSES: whether a record names a ruled heading at all is read by the word test alone (`## Stat usage` names none).
 */
export const LOW_RISK_ADD_ONLY_RULED_SQUEEZED = /decision|status|decided|ruling|resolution|决策|决定|裁决|状态|決策|決定|裁決|狀態/i;

/**
 * A status line: after its quote markers, list bullet, table bar, emphasis, HTML tags, link brackets and
 * zero-width characters are stripped (NFKC-normalised), a line that STARTS with a status word, in any tail:
 * `Status:`, `| Status |`, `Status (2026-11-15): …`, `Superseded by …`, `Deprecated:`, `**状态**:…`.
 */
export const LOW_RISK_ADD_ONLY_STATUS_LINE = /^(?:(?:status|superseded|deprecated|withdrawn|replaced)\b|状态|狀態)/i;

/**
 * The ALLOWLIST an added non-blank line must match (contract review round 4: a denylist over Markdown fails open,
 * the same stance `LOW_RISK_RIDER_PATTERNS` takes). Exactly one of:
 *   - a plain ATX heading at column 0: one to six `#`, ONE space, and text of ASCII letters and digits, Han
 *     characters, spaces and plain punctuation only — no other script (a look-alike letter), emphasis, code, link,
 *     HTML, `#` or `\` (`LOW_RISK_ADD_ONLY_PLAIN_HEADING`);
 *   - plain prose at column 0, optionally behind `>` quote markers and then ONE list marker with ONE space, whose
 *     text starts with a letter, a digit, an opening quote or bracket, or emphasis or code opening onto one —
 *     never `#`, `>`, `[`, `|`, `<`, `-`, `+`, `=`, a second list marker or whitespace
 *     (`LOW_RISK_ADD_ONLY_PLAIN_PROSE`).
 * Every added line also carries no `<` (raw HTML, an autolink), no fence marker (three backticks or tildes), no
 * tab, and no character reference. Anything else is refused: ⛔ fail closed.
 */
export const LOW_RISK_ADD_ONLY_PLAIN_HEADING = /^#{1,6} [A-Za-z0-9\p{Script=Han}](?:[A-Za-z0-9\p{Script=Han} .,:;!?'"()\/·、，。：；（）—–-]*[A-Za-z0-9\p{Script=Han}.!?)）])?$/u;
export const LOW_RISK_ADD_ONLY_PLAIN_PROSE = /^(?:> ?)*(?:(?:[-*+]|\d{1,9}[.)]) )?(?!\d{1,9}[.)](?:[ ]|$))(?:\*\*|__|\*|_|`)?[\p{L}\p{N}(“"'‘（]/u;

/** Characters a hunk line may not carry: a bare CR, VT, FF and the Unicode line and paragraph separators end a line to a renderer. */
const ADD_ONLY_LINE_BREAKERS = /[\r\v\f\u2028\u2029]/;

/**
 * The git argv that reads one add-only file's diff at full context: `head` the subcommand and its own flags
 * (`['diff']`, or `['diff-tree', '-p', …]` at the queue), `revs` the two ends or the one commit. The path is a
 * literal pathspec, so a name with glob characters names that one file. Pure.
 */
export function addOnlyDiffArgv(head, revs, path) {
  return [...head, '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', `--unified=${LOW_RISK_ADD_ONLY_CONTEXT}`, ...revs, '--', `:(literal)${path}`];
}

/**
 * A heading's text as the ruled-heading test reads it: NFKC-normalised, default-ignorable characters (zero-width,
 * soft hyphen) and the emphasis, code and strike markers removed, so `**Dec**ision` and ``Deci`sion` `` read `Decision`. Pure.
 */
function addOnlyHeadingText(text) {
  return String(text ?? '').normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '').replace(/[*_`~]/g, '');
}

/** One Markdown line stripped to its words: quote markers, list bullet, table bar, HTML tags, link brackets, emphasis, zero-width characters. Pure. */
function addOnlyBareLine(line) {
  return String(line)
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/^[ \t]*(?:>[ \t]?)*/, '')
    .replace(/^[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+)?/, '')
    .replace(/^\|[ \t]*/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|[`*_[\]]/g, '')
    .trim();
}

/**
 * Each line's heading reading: `{ heading: null | { level, text }, under: [{ level, text }], title, code }` —
 * `under` the headings the line sits beneath (its own excluded), `code` true inside a fence or the frontmatter.
 * ATX headings (up to three SPACES of indent; a tab is code) and setext underlines, inside a blockquote or a list
 * item too; never inside a fenced block (closed by the opener's character at least as long, with nothing after
 * it, at the opener's quote depth — or by any line at a shallower one) or a leading frontmatter block. The FIRST
 * level-1 heading is the record's title and scopes nothing; every other heading does, at any level. Pure.
 */
export function addOnlyHeadingReading(lines) {
  const list = Array.isArray(lines) ? lines.map(String) : [];
  const unquote = (l) => l.replace(/^ {0,3}(?:>[ ]?)*/, '').replace(/^ {0,3}(?:[-*+]|\d+[.)])[ ]+(?=#)/, '');
  const depth = (l) => (/^ {0,3}((?:>[ ]?)*)/.exec(l)?.[1].replace(/[ ]/g, '').length ?? 0);
  const out = list.map(() => ({ heading: null, under: [] }));
  const kinds = list.map(() => null);
  const code = list.map(() => false);
  let fence = null;
  let fenceDepth = 0;
  let start = 0;
  if (list[0]?.trim() === '---') {
    const close = list.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (close > 0) {
      start = close + 1;
      for (let i = 0; i < start; i += 1) code[i] = true;
    }
  }
  for (let i = start; i < list.length; i += 1) {
    const bare = unquote(list[i]);
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(bare);
    // A fence opened inside a block quote ends with the quote: a line at a shallower depth closes it.
    if (fence !== null && depth(list[i]) < fenceDepth) fence = null;
    if (fence === null && marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      fence = marker[1];
      fenceDepth = depth(list[i]);
      kinds[i] = 'fence';
      code[i] = true;
      continue;
    }
    if (fence !== null) {
      if (marker && depth(list[i]) === fenceDepth && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === '') fence = null;
      kinds[i] = 'fence';
      code[i] = true;
      continue;
    }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(bare);
    if (atx) {
      kinds[i] = { level: atx[1].length, text: String(atx[2] ?? '').trim() };
      continue;
    }
    // A setext underline makes a heading of a PARAGRAPH line in the same container only: a list item or a quote
    // line above an unquoted `---` is a list or a quote and a thematic break, never a heading.
    const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(bare);
    const prev = i - 1 >= start ? unquote(list[i - 1]) : '';
    const paragraph = i - 1 >= start && depth(list[i - 1]) === depth(list[i]) && !/^ {0,3}(?:[-*+]|\d+[.)])(?:[ \t]|$)/.test(prev);
    if (underline && paragraph && kinds[i - 1] === null && prev.trim() !== '') {
      kinds[i - 1] = { level: underline[1][0] === '=' ? 1 : 2, text: prev.trim(), setext: true };
      kinds[i] = { underline: true };
    }
  }
  const stack = [];
  let titled = false;
  for (let i = 0; i < list.length; i += 1) {
    const kind = kinds[i];
    if (kind && typeof kind.level === 'number') {
      while (stack.length > 0 && stack[stack.length - 1].level >= kind.level) stack.pop();
      out[i] = { heading: kind, under: [...stack], title: kind.level === 1 && !titled, code: false };
      if (kind.level === 1 && !titled) titled = true;
      else stack.push(kind);
      continue;
    }
    // A setext underline belongs to the heading above it.
    out[i] = { heading: kind?.underline ? out[i - 1].heading : null, under: kind?.underline ? out[i - 1].under : [...stack], title: kind?.underline ? out[i - 1].title : false, code: code[i] };
  }
  return out;
}

/**
 * Why one ADR file's diff is not an add-only note, or [] when it is. `patch` is the file's unified diff read at
 * `LOW_RISK_ADD_ONLY_CONTEXT` (merge base to head on `--pr` and the relay, each commit against its first parent at
 * the queue), so ONE hunk, starting at line 1, carries the whole file — both sides are read off it. Pure.
 *
 * Add-only, every one of:
 *   - the hunk removes no line, adds at least one, and its counts match its header; no hunk line carries a bare
 *     CR, VT, FF or a Unicode line separator (each ends a line to a renderer);
 *   - every EXISTING line reads the same heading and the same section before and after (`addOnlyHeadingReading`
 *     on both sides): an added line never turns an existing line into a heading, opens a fence or frontmatter
 *     over one, or re-scopes existing text under a new heading;
 *   - the record names a decision or status heading (`LOW_RISK_ADD_ONLY_RULED_HEADING`), so a note's place can be
 *     judged at all;
 *   - no run of added lines sits in the header block (above the first section heading), and a run inserted inside
 *     a ruled section opens, at its first non-blank line, a heading at or above that section's level;
 *   - every added non-blank line is on the allowlist (`LOW_RISK_ADD_ONLY_PLAIN_HEADING`, `…_PLAIN_PROSE`), and
 *     none is a status line (`LOW_RISK_ADD_ONLY_STATUS_LINE`), a ruled heading, or a line under one;
 *   - the record carries no shape the heading reader does not model (a list-borne or indented fence, a raw HTML
 *     block).
 * A diff that does not parse as exactly one text hunk of one existing file is a reason too: ⛔ fail closed.
 */
export function addOnlyNoteReasons(file) {
  const path = String(file?.path ?? '(unnamed)');
  if (typeof file?.patch !== 'string') return [`the diff of \`${path}\` was not read`];
  const lines = file.patch.split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines.filter((l) => l.startsWith('diff --git ')).length > 1) return [`the diff of \`${path}\` carries more than one file`];
  if (lines.some((l) => /^Binary files /.test(l) || l === 'GIT binary patch')) return [`\`${path}\` reads as a binary diff`];
  const headers = lines.map((l, i) => [l, i]).filter(([l]) => l.startsWith('@@ '));
  if (headers.length === 0) return [`the diff of \`${path}\` shows no hunk`];
  if (headers.length > 1) return [`the diff of \`${path}\` reads as ${headers.length} hunks, where the whole file at full context is one`];
  const [[header, at]] = headers;
  const counts = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!counts) return [`the hunk header of \`${path}\` does not parse (${quoteLine(header, 60)})`];
  const oldCount = counts[2] === undefined ? 1 : Number(counts[2]);
  const newCount = counts[4] === undefined ? 1 : Number(counts[4]);
  if (oldCount === 0) return [`\`${path}\` was empty or absent at the base, so the diff creates it`];
  if (counts[1] !== '1' || counts[3] !== '1') return [`the hunk of \`${path}\` starts at line ${counts[1]}/${counts[3]}, not 1, so it is not the whole file`];
  const ops = [];
  let noNewline = false;
  const body = lines.slice(at + 1);
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  for (const line of body) {
    if (line.startsWith('\\')) {
      noNewline = true;
      continue;
    }
    const mark = line[0];
    if (mark !== '+' && mark !== ' ' && mark !== '-') return [`the diff of \`${path}\` carries a line that is no hunk line (${quoteLine(line, 60)})`];
    if (ADD_ONLY_LINE_BREAKERS.test(line.slice(1))) return [`the diff of \`${path}\` carries a bare CR, VT, FF or Unicode line separator inside a line, which a renderer reads as a line break`];
    ops.push({ mark, text: line.slice(1) });
  }
  const oldLines = [];
  const newLines = [];
  for (const op of ops) {
    if (op.mark !== '+') { op.old = oldLines.length; oldLines.push(op.text); }
    if (op.mark !== '-') { op.new = newLines.length; newLines.push(op.text); }
  }
  const added = ops.filter((op) => op.mark === '+');
  const removed = ops.filter((op) => op.mark === '-').length;
  const reasons = [];
  if (oldLines.length !== oldCount || newLines.length !== newCount) reasons.push(`the hunk of \`${path}\` reads ${oldLines.length} old and ${newLines.length} new line(s), where its header says ${oldCount} and ${newCount}`);
  if (removed > 0) reasons.push(`\`${path}\` removes ${removed} line(s) — an add-only note changes no existing line${noNewline ? ' (a record with no newline at its end shows its last line removed and re-added: end it with one first)' : ''}`);
  if (added.length === 0) reasons.push(`\`${path}\` adds no line`);
  if (reasons.length > 0) return reasons;

  const before = addOnlyHeadingReading(oldLines);
  const after = addOnlyHeadingReading(newLines);
  // An existing shape the heading reader does not model — a fence behind a list marker or indented four or more,
  // or a raw HTML block outside a fence — could hide or invent a heading: where a note sits is then unknown.
  const unmodelled = oldLines.map((l, i) => [l, i]).filter(([l, i]) => !before[i].code && (/^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)+(?:>[ \t]?)*[ \t]*(?:`{3,}|~{3,})/.test(l) || /^(?: {4,}|\t)[ \t]*(?:`{3,}|~{3,})/.test(l) || /^ {0,3}(?:>[ ]?)*[ \t]*<[A-Za-z!?/]/.test(l))).map(([, i]) => i);
  if (unmodelled.length > 0) return [`\`${path}\` carries a list-borne or indented fence, or a raw HTML block, at line ${unmodelled.slice(0, 3).map((n) => n + 1).join(', ')}, which the heading reader does not model`];
  // `ruledWord` decides whether the record names a ruled heading at all (a pass condition); `ruled` adds the
  // squeezed reading and is used only where it refuses.
  const ruledWord = (h) => Boolean(h) && LOW_RISK_ADD_ONLY_RULED_HEADING.test(addOnlyHeadingText(h.text));
  const ruled = (h) => ruledWord(h) || (Boolean(h) && LOW_RISK_ADD_ONLY_RULED_SQUEEZED.test(addOnlyHeadingText(h.text).replace(/[\s\p{P}\p{S}]/gu, '')));
  const at1 = (list) => list.slice(0, 3).map((n) => `${n + 1}`).join(', ') + (list.length > 3 ? ` (+${list.length - 3} more)` : '');
  const sig = (r) => JSON.stringify([r.heading ? [r.heading.level, r.heading.text] : null, r.under.map((h) => [h.level, h.text])]);
  // Existing lines read as they read before: the added lines changed no heading and re-scoped nothing.
  const moved = ops.filter((op) => op.mark === ' ' && sig(before[op.old]) !== sig(after[op.new])).map((op) => op.new);
  if (moved.length > 0) reasons.push(`\`${path}\`'s added lines change the heading or the section of existing line ${at1(moved)} (a new heading, fence, frontmatter or setext underline over existing text)`);
  if (!before.some((r) => !r.title && ruledWord(r.heading))) reasons.push(`\`${path}\` names no decision or status heading, so where a note sits cannot be judged`);
  const firstSection = before.findIndex((r) => r.heading && !r.title);
  // Runs of consecutive added lines, each with the existing line it follows (-1: the top of the file).
  const runs = [];
  let prevOld = -1;
  for (const op of ops) {
    if (op.mark === ' ') { prevOld = op.old; continue; }
    const last = runs[runs.length - 1];
    if (last && last.after === prevOld && last.end === op.new - 1) { last.lines.push(op.new); last.end = op.new; } else runs.push({ after: prevOld, lines: [op.new], end: op.new });
  }
  const inHeader = [];
  const inside = [];
  const joins = [];
  for (const run of runs) {
    // A non-blank added line directly above an existing setext heading joins that heading's text.
    const next = run.end + 1;
    if (newLines[run.end].trim() !== '' && next < newLines.length && (after[next].heading?.setext || (next + 1 < newLines.length && after[next + 1].heading?.setext && after[next + 1].heading === after[next].heading))) joins.push(run.end);
    if (firstSection < 0 || run.after < firstSection) { inHeader.push(run.lines[0]); continue; }
    const r = before[run.after];
    const scope = r.heading && !r.title ? [...r.under, r.heading] : r.under;
    const ruledLevels = scope.filter(ruled).map((h) => h.level);
    if (ruledLevels.length === 0) continue;
    const lead = run.lines.find((n) => newLines[n].trim() !== '');
    // The opening heading is a bare ATX line — no quote, no list marker, no setext underline below a line.
    // A blank line above it too, so no HTML block or paragraph above can swallow it.
    const opens = lead !== undefined && (lead === 0 || newLines[lead - 1].trim() === '') && /^ {0,3}#{1,6}(?:[ \t]|$)/.test(newLines[lead]) && after[lead].heading && !after[lead].title && after[lead].heading.level <= Math.min(...ruledLevels);
    if (!opens) inside.push(run.lines[0]);
  }
  if (joins.length > 0) reasons.push(`\`${path}\` adds line ${at1(joins)} directly above an existing setext heading, which it joins`);
  if (inHeader.length > 0) reasons.push(`\`${path}\` adds line ${at1(inHeader)} in the record's header block, above its first section heading`);
  if (inside.length > 0) reasons.push(`\`${path}\` adds line ${at1(inside)} inside a section that names the decision or the status, without opening a heading of that section's level first`);
  const words = added.filter((op) => op.text.trim() !== '');
  // A status word at the start (behind any opening punctuation), or `… status:` anywhere on the line.
  const statusText = (t) => addOnlyBareLine(t).normalize('NFKC').replace(/^[^\p{L}\p{N}]+/u, '');
  const statusLines = words.filter((op) => LOW_RISK_ADD_ONLY_STATUS_LINE.test(statusText(op.text)) || /(?:\bstatus\b|状态|狀態)[^\p{L}\p{N}]*[:：]/iu.test(statusText(op.text))).map((op) => op.new);
  // The allowlist: a plain heading or plain prose, and no `<`, fence marker, tab or character reference anywhere.
  const plain = (t) => (LOW_RISK_ADD_ONLY_PLAIN_HEADING.test(t) || (!t.startsWith('#') && LOW_RISK_ADD_ONLY_PLAIN_PROSE.test(t))) && !/[<\t]|`{3}|~{3}|&#?[A-Za-z0-9]+;/.test(t);
  const unplain = words.filter((op) => !plain(op.text)).map((op) => op.new);
  const mixed = words.filter((op) => /[A-Za-z][\u0370-\u03ff\u0400-\u052f]|[\u0370-\u03ff\u0400-\u052f][A-Za-z]|\p{Default_Ignorable_Code_Point}/u.test(op.text)).map((op) => op.new);
  const ruledHeadings = words.filter((op) => ruled(after[op.new].heading)).map((op) => op.new);
  const underRuled = words.filter((op) => !ruledHeadings.includes(op.new) && after[op.new].under.some(ruled)).map((op) => op.new);
  if (statusLines.length > 0) reasons.push(`\`${path}\` adds a status line at line ${at1(statusLines)}`);
  if (unplain.length > 0) reasons.push(`\`${path}\` adds line ${at1(unplain)} that is neither a plain heading nor plain prose — an add-only note is \`#\` headings of plain text and prose (quoted or one list level), with no raw HTML or autolink (\`<\`), fence, tab, character reference, link definition or nested marker`);
  if (mixed.length > 0) reasons.push(`\`${path}\` adds a zero-width or other invisible character, or a Latin word mixed with Greek or Cyrillic letters, at line ${at1(mixed)}`);
  if (ruledHeadings.length > 0) reasons.push(`\`${path}\` adds a heading that names the decision or the status at line ${at1(ruledHeadings)}`);
  if (underRuled.length > 0) {
    const names = [...new Set(underRuled.map((n) => after[n].under.filter(ruled).pop().text))].slice(0, 2);
    reasons.push(`\`${path}\` adds line ${at1(underRuled)} under ${names.map((n) => quoteLine(n, 50)).join(', ')}, a heading that names the decision or the status`);
  }
  return reasons;
}

/**
 * The security NAME test (maintainer ruling on the security-scope card, 「标签和路径都读」):
 * a changed path under a catalog row whose name below the row — any segment, so a
 * skill FOLDER named for it counts as well as a file — says security, auth or
 * permission (any case) keeps the PR H, with or without the label. A segment
 * rather than the basename alone, because a security skill's entry file is
 * `SKILL.md`. Teaching the name cannot see is flagged in the review's record and
 * labelled by the seat adopting it.
 */
export const LOW_RISK_SECURITY_NAME = /security|auth|permission/i;

/**
 * The file modes a catalog path may carry: a regular file. A symlink (`120000`)
 * or a submodule (`160000`) under a catalog row keeps the PR H.
 */
export const LOW_RISK_REGULAR_MODES = Object.freeze(['100644', '100755']);

/** A changeset path, as the rider allowlist spells it. */
export const LOW_RISK_CHANGESET_PATH = /^\.changeset\/[^/]+\.md$/;

/** The ONE frontmatter line a low-risk changeset may carry (none is allowed too): the catalog, at patch. */
export const LOW_RISK_CHANGESET_RELEASE = /^(['"])@objectstack\/skills\1[ \t]*:[ \t]*patch[ \t]*$/;

/**
 * The ONE bare declaration of `key` in `text`, read with the fleet's reader LINE
 * BY LINE (never a second parser), or the reason it is not there. Pure.
 *
 * Every line the reader reads as `declared` or `malformed` is a declaration
 * line, fenced and quoted ones included. Exactly ONE must exist, outside any
 * ``` or ~~~ fence and any `>` quote, and with its list bullet, bold and
 * backticks stripped it must read EXACTLY `<key>: <value>`. So a second
 * declaration (a quoted `no` before a real `yes`), trailing words (`no — but`)
 * and an arm (`no (narrowing)`) are each a reason, and the arm reads them as H.
 */
export function readBareDeclaration(text, reader, key, value) {
  const hits = [];
  let fence = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const read = reader(line);
    if (read && (read.kind === 'declared' || read.kind === 'malformed')) hits.push({ line, fenced: fence !== null });
    const marker = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})/.exec(line);
    if (marker) fence = fence === null ? marker[1][0] : marker[1][0] === fence ? null : fence;
  }
  // `value` may name several values the one line may carry (the `Rule-change:` split reads `none` or `ruled`);
  // a single value reads, and words its reasons, exactly as before. `value` on an `ok` answer is the one it read.
  const values = Array.isArray(value) ? value : [value];
  const want = values.map((v) => `\`${key}: ${v}\``).join(' or ');
  const lines = hits.length;
  if (hits.length === 0) return { ok: false, reason: `no \`${key}:\` line`, value: null, lines };
  if (hits.length > 1) return { ok: false, reason: `${hits.length} \`${key}:\` lines, where exactly one bare ${want} is read`, value: null, lines };
  const [{ line, fenced }] = hits;
  if (fenced) return { ok: false, reason: `its one \`${key}:\` line sits inside a code fence`, value: null, lines };
  if (/^[ \t]*>/.test(line)) return { ok: false, reason: `its one \`${key}:\` line is a quote (${quoteLine(line)})`, value: null, lines };
  const bare = line.replace(/^[ \t]*(?:[-*][ \t]+)?/, '').replace(/\*\*|`/g, '').replace(/[ \t]+/g, ' ').trim();
  const read = values.find((v) => bare === `${key}: ${v}`);
  if (read === undefined) return { ok: false, reason: `its \`${key}:\` line reads ${quoteLine(line)}, not exactly ${want}`, value: null, lines };
  return { ok: true, reason: null, value: read, lines };
}

/**
 * Why one changeset read at the head keeps the arm H, or [] (M1). Pure. Its
 * frontmatter may release `'@objectstack/skills': patch` and nothing else, and
 * its body carries one bare `Clause-②: no` and one bare `Metadata-protocol: none`.
 */
export function lowRiskChangesetReasons(file) {
  const path = String(file?.path ?? '(unnamed)');
  if (typeof file?.text !== 'string') return [`\`${path}\` was not read at the head`];
  const lines = file.text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (lines[0]?.trim() !== '---' || close < 0) return [`\`${path}\` carries no frontmatter block`];
  const reasons = [];
  const releases = lines.slice(1, close).filter((l) => l.trim() !== '' && !LOW_RISK_CHANGESET_RELEASE.test(l.trim()));
  if (releases.length > 0) reasons.push(`\`${path}\` releases ${releases.slice(0, 2).map((l) => quoteLine(l.trim(), 60)).join(', ')}; the arm allows only \`'@objectstack/skills': patch\``);
  const body = lines.slice(close + 1).join('\n');
  for (const [reader, key, value] of [[readClause2Line, 'Clause-②', 'no'], [readMetadataProtocolLine, 'Metadata-protocol', 'none']]) {
    const read = readBareDeclaration(body, reader, key, value);
    if (!read.ok) reasons.push(`\`${path}\`: ${read.reason}`);
  }
  return reasons;
}

/**
 * The arm's verdict over one matched slice, from a READING of the pull request:
 * `{ measured: true, paths, body, labels, timeline, fork, changesets, catalogFiles }`
 * — every changed path (ungoverned ones included), the PR body, its label names,
 * its timeline events, `forkVerdict` of the pull object, the changesets read at
 * the head (`{ measured, reason, files: [{ path, text }] }`) and the status and
 * modes of each catalog file (`{ measured, reason, files: [{ path, status,
 * oldMode, mode, patch? }] }`, one row per commit that touched it; `patch` the
 * full-context diff of a modified file under an add-only row). Pure.
 *
 * Tier S only when ALL of these hold, each a reason when it does not:
 *   - every governed row hit is a low-risk row (a `.claude/**`, workflow or
 *     any Tier H row beside it is H — the card's "no other governed path");
 *   - every changed path lies under a hit low-risk row or matches `LOW_RISK_RIDER_PATTERNS`,
 *     every path under a catalog row matches `LOW_RISK_ARM_FILE_PATTERNS`, and every
 *     path under an add-only row (`lowRisk.addOnly`, the ADR leg) `LOW_RISK_ADD_ONLY_FILE_PATTERNS`;
 *   - every status row of an add-only path carries its diff (`patch`) and reads add-only
 *     (`addOnlyNoteReasons`, card #33539);
 *   - the reading's path list holds every governed file of the slice;
 *   - the body carries one bare `Clause-②: no` and one bare `Metadata-protocol: none`
 *     (`readBareDeclaration` over the fleet's readers);
 *   - with a catalog path, at least one changeset; every one read at the head and clean
 *     (`lowRiskChangesetReasons`) — an ADR-only PR owes none;
 *   - no path below a low-risk row names security, auth or permission
 *     (`LOW_RISK_SECURITY_NAME`, any segment, any case; ruling B on card #33501);
 *   - every catalog path's every status row reads `modified`, with a regular mode
 *     (`LOW_RISK_REGULAR_MODES`) at both ends and the same mode at both ends — an
 *     add, delete, rename, copy, symlink, mode change or unread row is H (ruling A);
 *   - the labels were read and none is `security`, and the timeline was read and
 *     never removed a `security` label;
 *   - the head lives in the base repository (no fork);
 *   - the RECORD STAGE, the two conjuncts read off the review rather than the pull (`lowRiskRecordStageReasons`):
 *     the contract-review record on this head carries one bare `Security-touching: no` line
 *     (`reading.record`), and no card the PR names carries a `security` label, now or
 *     removed (`reading.cardLabels`).
 * ⛔ Fail closed: no reading, or one not measured, is Tier H with its reason.
 *
 * `recordStage` says how far the record stage got. The pull-read conjuncts cost the caller nothing
 * more than the pull it already holds; the record stage costs two threads and the card, so a caller
 * hands it in SECOND, and only when it can matter:
 *   `not-reached`  a pull-read conjunct already gave a reason and no record-stage reading was handed
 *                  in — Tier H on those reasons, nothing more to read;
 *   `pending`      every pull-read conjunct holds and no record-stage reading was handed in — Tier H,
 *                  with the one reason that says so. The caller reads the stage and asks again;
 *   `read`         a record-stage reading was handed in and judged, each failure a reason.
 * ⛔ `pending` is never Tier S, and nothing a caller leaves out is read as `no`: a stand-in for an
 * unread input may answer a pull-read conjunct, never this stage.
 */
export function lowRiskArmVerdict(matched, repo, reading = null) {
  const rows = (Array.isArray(matched) ? matched : []).filter(Boolean);
  if (!reading || reading.measured !== true) {
    return {
      tier: GOVERNED_TIER_H,
      measured: false,
      reason: reading?.reason ?? 'no reading of the pull request was handed in — a path list alone cannot say what its body declares or which labels it carries',
      reasons: [],
      recordStage: LOW_RISK_RECORD_STAGE.notReached,
    };
  }
  const reasons = [];
  const more = (list, n) => `${list.slice(0, n).join(', ')}${list.length > n ? ` (+${list.length - n} more)` : ''}`;
  const armRows = rows.filter((s) => lowRiskArmIn(s, repo));
  const outside = rows.filter((s) => !lowRiskArmIn(s, repo));
  if (armRows.length === 0) reasons.push('no low-risk row was hit');
  if (outside.length > 0) reasons.push(`a governed path outside the arm: ${outside.map((s) => `\`${s.glob}\``).join(', ')}`);
  const paths = (Array.isArray(reading.paths) ? reading.paths : []).filter((p) => typeof p === 'string' && p !== '');
  if (paths.length === 0) reasons.push('the reading carries no path list');
  const armPrefixes = armRows.map((s) => s.prefix).filter(Boolean);
  const underArm = (p) => armPrefixes.some((prefix) => p.startsWith(prefix));
  // The ADR leg (#33539): a row whose arm reads `addOnly` takes Markdown only, and each of its files is read hunk by hunk.
  const addOnlyPrefixes = armRows.filter((s) => s.lowRisk.addOnly === true).map((s) => s.prefix).filter(Boolean);
  const underAddOnly = (p) => addOnlyPrefixes.some((prefix) => p.startsWith(prefix));
  const stray = paths.filter((p) => !underArm(p) && !LOW_RISK_RIDER_PATTERNS.some((re) => re.test(p)));
  if (stray.length > 0) reasons.push(`a path outside skills wording and prose: ${more(stray, 4)}`);
  const odd = paths.filter((p) => underArm(p) && !underAddOnly(p) && !LOW_RISK_ARM_FILE_PATTERNS.some((re) => re.test(p)));
  if (odd.length > 0) reasons.push(`a skills file that is neither Markdown nor an \`evals/*.json\`: ${more(odd, 4)}`);
  const oddRecord = paths.filter((p) => underAddOnly(p) && !LOW_RISK_ADD_ONLY_FILE_PATTERNS.some((re) => re.test(p)));
  if (oddRecord.length > 0) reasons.push(`an ADR-tree file that is not Markdown: ${more(oddRecord, 4)}`);
  const securityNamed = paths.filter((p) => {
    const prefix = armPrefixes.find((pre) => p.startsWith(pre));
    return prefix !== undefined && LOW_RISK_SECURITY_NAME.test(p.slice(prefix.length));
  });
  if (securityNamed.length > 0) reasons.push(`a catalog path that names security, auth or permission: ${more(securityNamed, 4)}`);
  // ⭐ Only a MODIFIED regular catalog file is wording: adding, deleting or renaming a skill or an eval
  // changes what the catalog teaches, not how it words it. Status and mode come from `catalogFiles`
  // (`{ measured, reason, files: [{ path, status, oldMode, mode }] }`), one row per commit that touched
  // the path. Both ends are read: a symlink turned regular file can be called `modified`, so a regular
  // mode at the head alone proves nothing, and any change of mode is H.
  const armPaths = paths.filter(underArm);
  if (armPaths.length > 0) {
    const catalog = reading.catalogFiles;
    if (!catalog || catalog.measured !== true || !Array.isArray(catalog.files)) {
      reasons.push(`the status and mode of its catalog files were not read (${catalog?.reason ?? 'no reading'})`);
    } else {
      const unread = [];
      const notModified = new Set();
      const notRegular = new Set();
      const modeChanged = new Set();
      for (const p of armPaths) {
        const rows = catalog.files.filter((f) => f?.path === p);
        if (rows.length === 0) unread.push(p);
        for (const r of rows) {
          if (r?.status !== 'modified') notModified.add(`${p} (${r?.status || 'no status'})`);
          else if (![r?.oldMode, r?.mode].every((m) => LOW_RISK_REGULAR_MODES.includes(String(m ?? '')))) notRegular.add(`${p} (${r?.oldMode ?? 'base mode not read'} to ${r?.mode ?? 'head mode not read'})`);
          else if (r.oldMode !== r.mode) modeChanged.add(`${p} (${r.oldMode} to ${r.mode})`);
        }
      }
      if (unread.length > 0) reasons.push(`no status was read for ${more(unread, 4)}`);
      if (notModified.size > 0) reasons.push(`a catalog file added, deleted or renamed rather than modified: ${more([...notModified], 4)}`);
      if (notRegular.size > 0) reasons.push(`a catalog path that is not a regular file at both ends: ${more([...notRegular], 4)}`);
      if (modeChanged.size > 0) reasons.push(`a catalog file whose mode changed: ${more([...modeChanged], 4)}`);
      // ⭐ The ADR leg: every row of every ADR file read add-only (`addOnlyNoteReasons`); a row with no diff is H.
      const notAddOnly = new Set();
      for (const p of armPaths.filter(underAddOnly)) {
        for (const r of catalog.files.filter((f) => f?.path === p && f?.status === 'modified')) for (const why of addOnlyNoteReasons({ path: p, patch: r.patch })) notAddOnly.add(why);
      }
      if (notAddOnly.size > 0) reasons.push(`an ADR change that is not an add-only note: ${more([...notAddOnly], 3)}`);
    }
  }
  const listed = new Set(paths);
  const unlisted = rows.flatMap((s) => s.files ?? []).filter((f) => !listed.has(f));
  if (paths.length > 0 && unlisted.length > 0) reasons.push(`the reading's path list does not hold ${unlisted.slice(0, 2).join(', ')}`);
  for (const [reader, key, value] of [[readClause2Line, 'Clause-②', 'no'], [readMetadataProtocolLine, 'Metadata-protocol', 'none']]) {
    const read = readBareDeclaration(reading.body, reader, key, value);
    if (!read.ok) reasons.push(`the PR body: ${read.reason}`);
  }
  const changesetPaths = paths.filter((p) => LOW_RISK_CHANGESET_PATH.test(p));
  const changesets = reading.changesets;
  // The catalog publishes and owes its changeset; an ADR note publishes nothing (`skip-changeset`), so an
  // ADR-only PR owes none — any changeset it does carry is read and held to the same clean shape.
  const owesChangeset = paths.some((p) => underArm(p) && !underAddOnly(p));
  if (changesetPaths.length === 0) {
    if (owesChangeset) reasons.push('the PR carries no changeset');
  } else if (!changesets || changesets.measured !== true) reasons.push(`its changesets were not read at the head (${changesets?.reason ?? 'no reading'})`);
  else {
    const files = Array.isArray(changesets.files) ? changesets.files : [];
    for (const path of changesetPaths) {
      const read = files.filter((f) => f?.path === path);
      for (const r of read.length > 0 ? read : [{ path, text: null }]) reasons.push(...lowRiskChangesetReasons(r));
    }
  }
  if (!Array.isArray(reading.labels)) reasons.push('the labels were not read');
  else if (reading.labels.some((l) => String(l ?? '').toLowerCase() === 'security')) reasons.push('the PR carries the `security` label');
  const timeline = reading.timeline;
  if (!timeline || timeline.measured !== true || !Array.isArray(timeline.events)) reasons.push(`its timeline was not read (${timeline?.reason ?? 'no reading'}), so a removed \`security\` label cannot be ruled out`);
  else if (timeline.events.some((e) => e?.event === 'unlabeled' && String(e?.label?.name ?? '').toLowerCase() === 'security')) reasons.push('its timeline shows the `security` label removed');
  const fork = reading.fork;
  if (!fork || fork.measured !== true) reasons.push('its head repository was not read, so a fork cannot be ruled out');
  else if (fork.isFork === true) reasons.push(`its head lives in a fork (${fork.headRepo ?? 'a deleted repository'})`);
  // ── the RECORD STAGE, last: the review's own statement and the labels of the cards it names ──
  // Judged whenever a reading of it was handed in. With none handed in it is consulted only when every
  // pull-read conjunct above holds, and then it is the one reason left: Tier H until the caller reads it.
  const handed = reading.record != null || reading.cardLabels != null;
  let recordStage = LOW_RISK_RECORD_STAGE.notReached;
  if (handed) {
    recordStage = LOW_RISK_RECORD_STAGE.read;
    reasons.push(...lowRiskRecordStageReasons(reading.record ?? null, reading.cardLabels ?? null));
  } else if (reasons.length === 0) {
    recordStage = LOW_RISK_RECORD_STAGE.pending;
    reasons.push(LOW_RISK_RECORD_STAGE_PENDING_REASON);
  }
  return { tier: reasons.length === 0 ? GOVERNED_TIER_S : GOVERNED_TIER_H, measured: true, reason: null, reasons, recordStage };
}

/** How far the arm's record stage got (`lowRiskArmVerdict`'s `recordStage`). */
export const LOW_RISK_RECORD_STAGE = Object.freeze({ notReached: 'not-reached', pending: 'pending', read: 'read' });

/**
 * The record's machine line the arm stands on, spelled as the arm's reasons print it. The key and the value are
 * the record reader's own (`CONTRACT_REVIEW_SECURITY_TOUCHING_KEY` and its values, `check-half-states.mjs`): this
 * file cannot import that one at module scope (see `proxyRearmPlan`), so the self-test holds the two together.
 */
export const LOW_RISK_RECORD_LINE = 'Security-touching: no';

/** The reason a `pending` record stage reads Tier H on: nothing of it was read. */
export const LOW_RISK_RECORD_STAGE_PENDING_REASON =
  `its contract-review record and the labels of its card were not read, so neither a \`${LOW_RISK_RECORD_LINE}\` line nor a card free of the \`security\` label is established`;

/**
 * Why the record stage keeps the arm at Tier H, or [] — the arm's last two conjuncts. Pure.
 *
 * `record` is the reading of the review of record on this head (the queue guard's `lowRiskRecordStage`
 * builds it from the same threads its record leg reads):
 *   `{ measured: true, located: 'found' | 'unsigned' | 'absent', where, id,
 *      carried: null | { from, ok, reason }, securityTouching: { state, value?, reason? } }`
 * or `{ measured: false, reason }`. The conjunct holds only for a record FOUND on this head — one
 * carried from an older head only over hops that moved nothing the arm reads — whose
 * `Security-touching:` line was READ and reads `no`. A record that is absent, unsigned, unread,
 * carried over a hop that moved catalog text, or whose line is missing, unreadable or `yes`, is
 * each a reason.
 *
 * `cardLabels` is the reading of the cards the pull request names — the one whose thread may carry
 * its record on top, every other under `others`, each `{ measured, reason, card, labels, timeline }`:
 *   `{ measured: true, card, labels: string[], timeline: { measured, reason, events }, others: { measured, reason, cards } }`
 * or `{ measured: false, reason }` — no derivable card included, since a label on a card nobody
 * could name cannot be ruled out. The conjunct holds only when each card's labels were read and none is
 * `security`, and its timeline was read and never removed one: the PR's own rule, on every card it names.
 */
export function lowRiskRecordStageReasons(record, cardLabels) {
  return [...lowRiskRecordLineReasons(record), ...lowRiskCardLabelReasons(cardLabels)];
}

/** The record stage's first conjunct: the review of record on this head reads `Security-touching: no`. Pure. */
function lowRiskRecordLineReasons(record) {
  const key = LOW_RISK_RECORD_LINE.split(':')[0];
  if (!record || record.measured !== true) {
    return [`its contract-review record was not read (${record?.reason ?? 'no reading'}), so no \`${LOW_RISK_RECORD_LINE}\` line is established`];
  }
  if (record.located !== 'found') {
    return [record.located === 'unsigned'
      ? `its contract-review record on this head names no reviewer, so its \`${key}:\` line does not count`
      : `no contract-review record names this head, so no \`${LOW_RISK_RECORD_LINE}\` line is established`];
  }
  const reasons = [];
  const which = `its contract-review record (${record.where ?? 'a'} comment ${record.id ?? '(no id)'})`;
  const line = record.securityTouching;
  if (record.carried && record.carried.ok !== true) reasons.push(`${which} ${record.carried.reason ?? 'was carried from an older head over hops that could not be read'}`);
  if (!line || line.state === 'missing') reasons.push(`${which} carries no \`${key}:\` line`);
  else if (line.state !== 'read') reasons.push(`the \`${key}:\` line of ${which} is unreadable: ${line.reason ?? 'no reason recorded'}`);
  else if (line.value !== 'no') reasons.push(`${which} reads \`${key}: ${String(line.value)}\``);
  return reasons;
}

/** What ONE card's reading says against the arm: it carries `security`, had it removed, or its timeline is unread. Pure. */
function cardLabelFacts(reading, card) {
  const reasons = [];
  if (reading.labels.some((l) => String(l ?? '').toLowerCase() === 'security')) reasons.push(`${card} carries the \`security\` label`);
  const timeline = reading.timeline;
  if (!timeline || timeline.measured !== true || !Array.isArray(timeline.events)) reasons.push(`the timeline of ${card} was not read (${timeline?.reason ?? 'no reading'}), so a removed \`security\` label cannot be ruled out`);
  else if (timeline.events.some((e) => e?.event === 'unlabeled' && String(e?.label?.name ?? '').toLowerCase() === 'security')) reasons.push(`the timeline of ${card} shows the \`security\` label removed`);
  return reasons;
}

/**
 * The record stage's second conjunct: NO card the pull request names ever carried `security` — the card
 * whose thread may hold its record (the top of the reading) and every other card it names (`others`: a
 * `Part of` beside a `Fixes`, a `Refs`, the card its branch is named for; `readCardLabels`, the queue
 * guard). ⛔ A reading that does not say it read the others is a reason, never "it names no other". Pure.
 */
function lowRiskCardLabelReasons(cardLabels) {
  if (!cardLabels || cardLabels.measured !== true || !Array.isArray(cardLabels.labels)) {
    return [`the labels of its card were not read (${cardLabels?.reason ?? 'no reading'}), so a \`security\` label on the card cannot be ruled out`];
  }
  const reasons = cardLabelFacts(cardLabels, `its card #${cardLabels.card ?? '(no number)'}`);
  const others = cardLabels.others;
  if (!others || others.measured !== true || !Array.isArray(others.cards)) {
    reasons.push(`the other cards it names were not read (${others?.reason ?? 'no reading'}), so a \`security\` label on one of them cannot be ruled out`);
    return reasons;
  }
  for (const other of others.cards) {
    const card = `card #${other?.card ?? '(no number)'}, which it also names,`;
    if (!other || other.measured !== true || !Array.isArray(other.labels)) reasons.push(`the labels of ${card} were not read (${other?.reason ?? 'no reading'}), so a \`security\` label on it cannot be ruled out`);
    else reasons.push(...cardLabelFacts(other, card));
  }
  return reasons;
}

/**
 * The matched slice with every low-risk row's tier read off the pull request,
 * in `repo`. A slice with no low-risk row in `repo` is returned AS IS — every
 * reading without a skills hit is byte-identical to before. Run AFTER the
 * workflow split, so a split workflow row beside a skills path is a governed
 * row outside the arm. Pure.
 */
export function applyLowRiskArm(matched, repo, reading = null) {
  const list = Array.isArray(matched) ? matched : [];
  if (!list.some((s) => lowRiskArmIn(s, repo))) return list;
  const lowRiskVerdict = lowRiskArmVerdict(list, repo, reading);
  return list.map((s) => (lowRiskArmIn(s, repo) ? Object.freeze({ ...s, tier: lowRiskVerdict.tier, lowRiskVerdict }) : s));
}

/** The arm's words under a verdict, once, or '' when no low-risk row was hit. Pure. */
export function renderLowRiskLines(matched) {
  const v = (Array.isArray(matched) ? matched : []).find((s) => s?.lowRiskVerdict)?.lowRiskVerdict;
  if (!v) return '';
  if (!v.measured) {
    return (
      `      ⚖️ low-risk skills arm (${LOW_RISK_ARM_RULING}): NOT MEASURED — ${v.reason}.\n` +
      '         Tier H, fail closed. `--pr <n>` on a checkout holding the head reads the PR; the queue guard reads it on the queue leg.\n'
    );
  }
  if (v.tier === GOVERNED_TIER_S) {
    return `      ⚖️ low-risk skills arm (${LOW_RISK_ARM_RULING}): Tier S — modified skill files, add-only ADR notes and prose only, one bare \`Clause-②: no\` and \`Metadata-protocol: none\`, clean changesets, no \`security\` label ever on the PR or a card it names and no catalog path named for it, no fork, and a record on this head reading \`${LOW_RISK_RECORD_LINE}\`.\n`;
  }
  return `      ⚖️ low-risk skills arm (${LOW_RISK_ARM_RULING}): Tier H —\n${v.reasons.map((r) => `        - ${r}\n`).join('')}`;
}

// ── the `.claude/**` declaration split (header section "The guard instruments and the `.claude/**` declaration split") ──

/** Where the split is ruled, printed under every verdict it decides. */
export const RULE_CHANGE_RULING = 'maintainer ruling 2026-11-19, review-split thread';

/** The PR body's line, the record's line, and the line a `ruled` declaration quotes the maintainer on. */
export const RULE_CHANGE_KEY = 'Rule-change';
export const RULE_CHANGE_VERIFIED_KEY = 'Rule-change-verified';
export const RULING_REF_KEY = 'Ruling-ref';

/** Every value either line may carry; `yes` is read, and it is Tier H. */
export const RULE_CHANGE_VALUES = Object.freeze(['none', 'ruled', 'yes']);
/** The two values Tier S may hold on, declared in the body and verified, the same one, on the record. */
export const RULE_CHANGE_LANDING_VALUES = Object.freeze(['none', 'ruled']);

/** The reason a `pending` record stage reads Tier H on: the record was not read. */
export const RULE_CHANGE_PENDING_REASON = `its contract-review record was not read, so no \`${RULE_CHANGE_VERIFIED_KEY}:\` line is established`;

/**
 * A reader for one `KEY:` line, in the shape `readBareDeclaration` asks of the fleet's readers:
 * `{ kind: 'declared' }` for a line that carries the key at its start — after a `>` quote, a list
 * bullet, bold or backticks, each of which the bare test then refuses or strips — and null for every
 * other line. ⛔ The exact key, in its exact case: `Rule-change-verified:` is no `Rule-change:` line,
 * and a body spelling `rule-change:` carries no declaration at all (Tier H). Pure.
 */
export function keyLineReader(key) {
  if (!/^[A-Za-z][A-Za-z-]*$/.test(String(key ?? ''))) throw new TypeError(`keyLineReader wants a plain key, got ${JSON.stringify(key)}`);
  const re = new RegExp(`^[ \\t]*(?:>[ \\t]*)*(?:[-*][ \\t]+)?(?:\\*\\*)?\`?${key}\`?(?:\\*\\*)?[ \\t]*:`);
  return (line) => (re.test(String(line ?? '')) ? { kind: 'declared' } : null);
}

/**
 * The `Ruling-ref:` lines a `Rule-change: ruled` body carries: at a line start, outside any ``` or ~~~
 * fence, not quoted, with words after the colon. Their content — the maintainer's words, source and
 * time — is the reviewer's to check against the diff (`Rule-change-verified: ruled`); this reads only
 * that one is there. Pure.
 */
export function rulingRefLines(text) {
  const reader = keyLineReader(RULING_REF_KEY);
  const found = [];
  let fence = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (fence === null && reader(line) && !/^[ \t]*>/.test(line) && line.slice(line.indexOf(':') + 1).trim() !== '') found.push(line);
    const marker = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})/.exec(line);
    if (marker) fence = fence === null ? marker[1][0] : marker[1][0] === fence ? null : fence;
  }
  return found;
}

/**
 * The PR body's declaration: exactly ONE bare `Rule-change: none` or `Rule-change: ruled`
 * (`readBareDeclaration`), and beside `ruled` at least one `Ruling-ref:` line (`rulingRefLines`).
 * `{ ok, value, reason }`. A missing line, `yes`, a second line, a quoted or fenced one, trailing
 * words, or `ruled` with no reference is `ok: false` with its reason. Pure.
 */
export function ruleChangeDeclaration(body) {
  const read = readBareDeclaration(body, keyLineReader(RULE_CHANGE_KEY), RULE_CHANGE_KEY, RULE_CHANGE_LANDING_VALUES);
  if (!read.ok) return { ok: false, value: null, reason: read.reason };
  if (read.value === 'ruled' && rulingRefLines(body).length === 0) {
    return { ok: false, value: 'ruled', reason: `it declares \`${RULE_CHANGE_KEY}: ruled\` with no line-start \`${RULING_REF_KEY}:\` line quoting the maintainer's words, source and time` };
  }
  return { ok: true, value: read.value, reason: null };
}

/**
 * The record's `Rule-change-verified:` line, read off the record comment's body with the same bare
 * reader: `{ state: 'read', value }` (one of `RULE_CHANGE_VALUES`), `{ state: 'missing' }` (no such
 * line) or `{ state: 'unreadable', reason }` (two lines, a quoted or fenced one, another value). Pure.
 */
export function ruleChangeVerifiedReading(recordBody) {
  const read = readBareDeclaration(recordBody, keyLineReader(RULE_CHANGE_VERIFIED_KEY), RULE_CHANGE_VERIFIED_KEY, RULE_CHANGE_VALUES);
  if (read.ok) return { state: 'read', value: read.value };
  if (read.lines === 0) return { state: 'missing' };
  return { state: 'unreadable', reason: read.reason };
}

/**
 * Where the split leaves the record to the record leg, or null when it read one: a record that was not read,
 * or none found signed on this head. Tier S on Tier S's own terms — it lands only on a PASS record on this head,
 * which the record leg reads off the SAME locator and the SAME threads, and an absent, unsigned or unread record
 * is that leg's refusal. ⛔ So the split never clears anything by itself: it can only move the row to H. Pure.
 */
function ruleChangeDeferral(record) {
  if (!record || record.measured !== true) return `its contract-review record was not read (${record?.reason ?? 'no reading'}): the record leg refuses an unread record`;
  if (record.located !== 'found') return `no signed contract-review record names this head yet: the record leg refuses until one does, and its \`${RULE_CHANGE_VERIFIED_KEY}:\` line is read then`;
  return null;
}

/** The record stage's one conjunct: the record found on this head verifies the body's value. Pure. */
function ruleChangeRecordReasons(record, declared) {
  const key = RULE_CHANGE_VERIFIED_KEY;
  if (ruleChangeDeferral(record) !== null) return [];
  const which = `its contract-review record (${record.where ?? 'a'} comment ${record.id ?? '(no id)'})`;
  // A record carried from an older head stands only when the hops moved no `.claude/` path: the reviewer
  // verified the declaration against the diff it read, never against one written after it.
  if (record.carried && record.carried.ok !== true) return [`${which} ${record.carried.reason ?? 'was carried from an older head over hops this leg did not read'}, so its \`${key}:\` line does not stand for this head`];
  const line = record.ruleChangeVerified;
  if (!line || line.state === 'missing') return [`${which} carries no \`${key}:\` line`];
  if (line.state !== 'read') return [`the \`${key}:\` line of ${which} is unreadable: ${line.reason ?? 'no reason recorded'}`];
  if (line.value !== declared) return [`${which} reads \`${key}: ${String(line.value)}\`, where the PR body declares \`${RULE_CHANGE_KEY}: ${declared}\``];
  return [];
}

/**
 * The split's verdict over the `.claude/**` row, from a READING of the pull request:
 * `{ measured: true, body, record? }` — the PR body, and the record stage (`record`: the review of
 * record on this head, the shape `lowRiskRecordStage` builds, with its `ruleChangeVerified` line).
 * Tier S only when the body carries one bare `Rule-change: none` or `Rule-change: ruled` (with a
 * `Ruling-ref:` line) AND the record found on this head carries the SAME value on its
 * `Rule-change-verified:` line. A record absent, unsigned or unread is `deferred` (`ruleChangeDeferral`):
 * the row stays S and the record leg, which lands Tier S only on a PASS record it reads off the same
 * locator, refuses it. `recordStage` says how far it got, as the low-risk arm's does:
 * `not-reached` (the body already failed and no record was handed in), `pending` (the body holds and
 * no record was handed in — Tier H, the caller reads the record and asks again), `read`.
 * ⛔ Fail closed: no reading, or one not measured, is Tier H with its reason; `pending` is never S.
 */
export function ruleChangeSplitVerdict(reading) {
  if (!reading || reading.measured !== true) {
    return {
      tier: GOVERNED_TIER_H,
      measured: false,
      reason: reading?.reason ?? 'no reading of the pull request was handed in — a path list alone cannot say what its body declares',
      reasons: [],
      declared: null,
      recordStage: LOW_RISK_RECORD_STAGE.notReached,
    };
  }
  const reasons = [];
  const declared = ruleChangeDeclaration(reading.body);
  if (!declared.ok) reasons.push(`the PR body: ${declared.reason}`);
  let recordStage = LOW_RISK_RECORD_STAGE.notReached;
  let deferred = null;
  if (reading.record != null) {
    recordStage = LOW_RISK_RECORD_STAGE.read;
    if (declared.ok) {
      reasons.push(...ruleChangeRecordReasons(reading.record, declared.value));
      deferred = ruleChangeDeferral(reading.record);
    }
  } else if (reasons.length === 0) {
    recordStage = LOW_RISK_RECORD_STAGE.pending;
    reasons.push(RULE_CHANGE_PENDING_REASON);
  }
  return { tier: reasons.length === 0 ? GOVERNED_TIER_S : GOVERNED_TIER_H, measured: true, reason: null, reasons, declared: declared.ok ? declared.value : null, recordStage, deferred };
}

/** Does this row carry the declaration split in `repo`? Pure; the only reader of `ruleChange`. */
export function ruleChangeSplitIn(surface, repo) {
  return Array.isArray(surface?.ruleChange?.repos) && surface.ruleChange.repos.includes(repo);
}

/**
 * The matched slice with the `.claude/**` row's tier read off its declaration, in `repo`.
 * `reading === undefined` — every path-only caller, and every caller that predates the split — passes
 * the slice through AS IS, byte-identical; the queue guard hands a reading in (null included: Tier H).
 * Read only where it can decide: with another governed row in the slice already at Tier H the PR is H
 * whatever the body says, so the slice passes through and nothing is left pending. Run LAST, after the
 * workflow split and the low-risk arm, whose rows it reads as they stand. Pure.
 */
export function applyRuleChangeSplit(matched, repo, reading) {
  const list = Array.isArray(matched) ? matched : [];
  if (reading === undefined || !list.some((s) => ruleChangeSplitIn(s, repo))) return list;
  if (list.some((s) => !ruleChangeSplitIn(s, repo) && s?.tier !== GOVERNED_TIER_S)) return list;
  const ruleChangeVerdict = ruleChangeSplitVerdict(reading);
  return list.map((s) => (ruleChangeSplitIn(s, repo) ? Object.freeze({ ...s, tier: ruleChangeVerdict.tier, ruleChangeVerdict }) : s));
}

/** The split's words under a verdict, once, or '' when it decided nothing. Pure. */
export function renderRuleChangeLines(matched) {
  const v = (Array.isArray(matched) ? matched : []).find((s) => s?.ruleChangeVerdict)?.ruleChangeVerdict;
  if (!v) return '';
  const head = `      ⚖️ \`.claude/**\` declaration split (${RULE_CHANGE_RULING})`;
  if (!v.measured) return `${head}: NOT MEASURED — ${v.reason}.\n         Tier H, fail closed.\n`;
  if (v.tier === GOVERNED_TIER_S) {
    const body = `the body declares one bare \`${RULE_CHANGE_KEY}: ${v.declared}\`${v.declared === 'ruled' ? ` beside a \`${RULING_REF_KEY}:\` line` : ''}`;
    if (v.deferred) return `${head}: Tier S on the declaration — ${body}; ${v.deferred}.\n`;
    return `${head}: Tier S — ${body} and the record on this head verifies it (\`${RULE_CHANGE_VERIFIED_KEY}: ${v.declared}\`).\n`;
  }
  return `${head}: Tier H —\n${v.reasons.map((r) => `        - ${r}\n`).join('')}`;
}

/** `owner/name` out of any git remote spelling, or null. Pure. */
export function slugFromRemote(url) {
  const m = /(?:github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?\/*\s*$/.exec(String(url ?? ''));
  return m ? m[1] : null;
}

/**
 * Where each governed repo's checkout is, and whether it can be audited at
 * all. Pure: `probe(path)` answers `{ exists, slug, origin }`, so the whole
 * absent/unparseable/wrong-origin/present fork is offline-testable. An
 * unresolvable repo is `status: 'unaudited'` with a stated reason — the #4690
 * rule in code: absence must be loud, and must never render as a clean repo.
 *
 * ⚠️ IDENTITY IS PROVEN, NEVER ASSUMED (#13423). The wrong-origin refusal used
 * to be spelled `if (seen.slug && seen.slug !== repo.slug)`, so a checkout
 * whose origin `slugFromRemote` could not parse — a filesystem path, an SSH
 * shorthand, no origin remote at all — had a falsy `seen.slug`, slipped the
 * guard, and fell straight through to `status: 'audited'` UNDER THE GOVERNED
 * NAME with no evidence it is that repo. Same class as the #13307 leg one
 * function down: "a local checkout is not evidence it is the repo you think",
 * and it failed in the direction that reads as safety. The #13421 reachability
 * probe raised the bar without closing this — a local or mirror remote is
 * REACHABLE, so it passed the new probe and still slipped the slug check. The
 * enumeration of every "parse failure ⇒ success branch" shape this function
 * held is now zero by construction: `audited` is the single fall-through, and
 * it is reachable only with `seen.slug === repo.slug` — a parsed, matching
 * identity. (A `probe` that answers null/undefined coerces to
 * `exists: false`, which refuses too.)
 *
 * What an unparseable origin SHOULD do is the judgment #13421 deliberately
 * left unfixed (a legitimate mirror URL and a bogus one are both unparseable,
 * and the tree has no basis for telling them apart) — so the answer is the
 * register's standing one: NOT MEASURED. Never a policy of which spellings
 * are trustworthy; the row states what is missing (proof of identity) and the
 * remedy, and the sweep is INCOMPLETE while it stands.
 */
export function resolveRepoCheckouts({ repos = GOVERNED_REPOS, selfId = SELF_REPO_ID, selfRoot, siblingDir, overrides = {}, probe }) {
  return repos.map((repo) => {
    const candidate = overrides[repo.id] ?? (repo.id === selfId ? selfRoot : join(siblingDir, repo.id));
    const seen = probe(candidate) ?? { exists: false, slug: null, origin: null };
    if (!seen.exists) {
      return { ...repo, path: candidate, status: 'unaudited', precondition: 'no-checkout', reason: `no git checkout at ${candidate}` };
    }
    if (!seen.slug) {
      const declared = seen.origin ? `origin '${seen.origin}'` : 'no origin remote (or an unreadable one)';
      return {
        ...repo,
        path: candidate,
        status: 'unaudited',
        precondition: 'unparseable-origin',
        reason:
          `NOT MEASURED: the checkout at ${candidate} has ${declared}, which does not parse to a ` +
          `github.com owner/name slug — nothing proves this checkout is ${repo.slug}, so auditing it under ` +
          `that name would certify an arbitrary tree (#13423). A reachable remote is not identity: a local ` +
          `or mirror remote passes the #13307 probe and is still not evidence of WHICH repo this is. ` +
          `Remedy: point the checkout's origin at https://github.com/${repo.slug} (a transport rewrite ` +
          `belongs in \`url.<base>.insteadOf\`, which keeps the declared origin readable), or pass ` +
          `--repo-root ${repo.id}=<a checkout whose origin declares ${repo.slug}>.`,
      };
    }
    if (seen.slug !== repo.slug) {
      return { ...repo, path: candidate, status: 'unaudited', precondition: 'wrong-origin', reason: `the checkout at ${candidate} has origin ${seen.slug}, not ${repo.slug}` };
    }
    return { ...repo, path: candidate, status: 'audited', precondition: null, reason: null };
  });
}

/**
 * The PR number a mainline commit subject names, in either spelling GitHub
 * writes: a merge commit's `Merge pull request #N from ...` or a squash
 * commit's trailing `(#N)` (a subject citing an issue mid-title keeps only
 * the TRAILING parenthetical — that one is the PR).
 */
export function pullNumberFromSubject(subject) {
  if (typeof subject !== 'string') return null;
  let m = /^Merge pull request #(\d+)\b/.exec(subject);
  if (m) return Number(m[1]);
  m = /\(#(\d+)\)\s*$/.exec(subject.trim());
  if (m) return Number(m[1]);
  return null;
}

/**
 * `--since` in three spellings: `<N>d` / `<N>h` relative to `now`, or an ISO
 * date/datetime taken verbatim. Returns an ISO string, or null on nonsense —
 * a window this sweep cannot parse is a hard failure, never a default.
 */
export function parseSince(arg, now = new Date()) {
  if (typeof arg !== 'string' || arg === '') return null;
  const rel = /^(\d+)([dh])$/.exec(arg);
  if (rel) {
    const ms = Number(rel[1]) * (rel[2] === 'd' ? 86_400_000 : 3_600_000);
    return new Date(now.getTime() - ms).toISOString();
  }
  const t = Date.parse(arg);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * One sweep entry from one mainline commit. Pure: the caller supplies the
 * commit row, its changed paths, (multi-repo) which repo it came from, and —
 * since #19036 — the size of the landed diff; attribution is stitched on later.
 *
 * ⭐ ONE predicate, the same one `--test` / `--pr` / `--branch` and the queue
 * guard answer with, reached through its front door: `testVerdict` reads the
 * PATH register and the SIZE line, `landsByHumanMerge` reads either limb. A
 * landing is an entry when EITHER fired — a governed merge exactly as before,
 * and an oversized landing with no governed path at all, which used to be
 * invisible to this audit. With no size handed in the size limb is NOT
 * MEASURED and can fire nothing, so every pre-#19036 caller gets the entry it
 * always got, now carrying `size.measured: false` rather than a phantom zero.
 *
 * `repo` is REQUIRED since the register became scoped per row: it is the
 * `GOVERNED_REPOS` entry the commit landed in, and the rows consulted are the
 * ones that govern that repository. A call without one is refused by the
 * predicate, never classified against every row.
 */
export function classifyCommit({ sha, date, subject }, changedPaths, repo, size = null) {
  const verdict = testVerdict(changedPaths, { repo: assertGovernedRepo(repo?.id, 'classifyCommit'), size });
  if (!landsByHumanMerge(verdict)) return null;
  return {
    repoId: repo?.id ?? null,
    repoSlug: repo?.slug ?? null,
    sha,
    date,
    subject,
    pr: pullNumberFromSubject(subject),
    surfaces: verdict.matched,
    size: verdict.size,
    humanMerge: verdict.humanMerge,
  };
}

// ── the --test predicate (#9550): "would a PR touching these be governed?" ───

/**
 * The pre-arm answer, as data. Pure, and answered for ONE repository: `repo`
 * (a `GOVERNED_REPOS` id) is required, because the register is scoped per row
 * and a scoped row answers differently per repository. A seat can still run
 * this from anywhere with the file list of any PR in any governed repository —
 * it names which one, and the verdict carries it (`repo`, and
 * `surfacesChecked` counts the rows that govern it, not the whole table).
 */
export function testVerdict(paths, { repo, size = null, fork = null, checks = null, approval = null, workflowDiff = null, lowRisk = null } = {}) {
  assertGovernedRepo(repo, 'testVerdict');
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p !== '');
  // The `workflows` row's tier is read off the diff where a reading was handed in (the split): H otherwise.
  // The low-risk skills rows' tier is read off the pull request's body, labels and whole path list: H otherwise.
  const matched = applyLowRiskArm(applyWorkflowSplit(governedPathsIn(list, repo), repo, workflowDiff), repo, lowRisk);
  const hit = new Set(matched.flatMap((s) => s.files));
  const sized = sizeVerdict(size, approval);
  const forked = fork && typeof fork === 'object' ? fork : forkVerdict(null); // the FORK limb, or NOT MEASURED
  return {
    repo,
    governed: matched.length > 0,
    // The landing tier (#19133): `H` / `S` while governed, `null` when nothing
    // is — a `--json` reader never sees a tier for a diff that has none.
    tier: matched.length > 0 ? landingTierOf(matched) : null,
    checked: list.length,
    surfacesChecked: governedSurfacesFor(repo).length,
    matched,
    hitPaths: [...hit],
    clearPaths: list.filter((p) => !hit.has(p)),
    size: sized,
    fork: forked, checks: checks && typeof checks === 'object' ? checks : null,
    humanMerge: matched.length > 0 || sizeLimbFires(sized) || forked.isFork === true,
  };
}

/** The lift's citation, printed on every lifted reading so a queue log names what lifted it. */
export const SIZE_LIFT_RULING = 'maintainer ruling 2026-09-27, objectstack#20153';
/** The enqueue lift's citation: the maintainer's own enqueue from an authorized account (2026-10-26). */
export const SIZE_ENQUEUE_LIFT_RULING = 'maintainer ruling 2026-10-26, the enqueue from an authorized account';

/**
 * The lift an authorized-approval verdict grants the SIZE limb (maintainer
 * ruling 2026-09-27, header section "The SIZE limb's LIFT"). Pure, and a READER
 * of the queue guard's `authorizedApprovalVerdict` result — never a derivation
 * of its own: it asks for `state: 'approved'` AND a non-empty `approvals` list
 * (`{ login, commitId }` per counted approver), the field only the AUTHORIZED
 * reduction carries. The generic per-reviewer reduction, an `unapproved` or an
 * `unreadable` verdict, and no verdict at all answer null: no lift, fail closed.
 *
 * ⭐ The SECOND lift (maintainer ruling 2026-10-26): the queue guard hands the
 * same verdict with its enqueue reading attached as `enqueue`, and an entry an
 * account in `GOVERNED_APPROVERS` put in the queue is lifted the way an
 * authorized approval lifts it — the size limb "lands the way a Tier H surface
 * does", and the maintainer's own enqueue is now one of those landings. Still a
 * READER: it asks for the guard's `authorized` state and a login, and decides
 * nothing about who is authorized. The approval lift is read FIRST; an
 * `unauthorized` or `undetermined` enqueue lifts nothing.
 */
export function sizeLiftFrom(approval = null) {
  if (approval?.state === 'approved' && Array.isArray(approval.approvals) && approval.approvals.length > 0) {
    const approvals = approval.approvals
      .filter((a) => typeof a?.login === 'string' && a.login !== '')
      .map((a) => ({ login: a.login, commitId: typeof a.commitId === 'string' ? a.commitId : '' }));
    if (approvals.length > 0) return { approvers: approvals.map((a) => a.login), approvals, ruling: SIZE_LIFT_RULING };
  }
  const enqueue = approval?.enqueue;
  if (enqueue?.state === 'authorized' && typeof enqueue.login === 'string' && enqueue.login !== '') {
    return {
      approvers: [],
      approvals: [],
      enqueuedBy: { login: enqueue.login, at: typeof enqueue.at === 'string' ? enqueue.at : null },
      ruling: SIZE_ENQUEUE_LIFT_RULING,
    };
  }
  return null;
}

/**
 * The SIZE limb (maintainer ruling 2026-09-18, header section "The SIZE
 * predicate"), as data. Pure. `size` is `{ additions, deletions, source? }` or
 * null; anything that is not a pair of non-negative integers is NOT MEASURED —
 * never a size of zero, which would read as under the threshold. `approval`
 * is the queue guard's authorized-approval verdict, or null when the caller
 * read no reviews: `lifted` is that verdict's lift (2026-09-27) and exists only
 * over the line — under it there is nothing to lift; `approvalState` records
 * what was handed in (`null` when nothing was) so a `--json` reader can tell
 * "no approval" from "no reading".
 */
export function sizeVerdict(size = null, approval = null) {
  const additions = size?.additions;
  const deletions = size?.deletions;
  const approvalState = typeof approval?.state === 'string' ? approval.state : null;
  const measured =
    Number.isInteger(additions) && additions >= 0 && Number.isInteger(deletions) && deletions >= 0;
  if (!measured) {
    return { measured: false, additions: null, deletions: null, changedLines: null, threshold: HUMAN_MERGE_LINE_THRESHOLD, exceeds: false, lifted: null, approvalState, source: null };
  }
  const changedLines = additions + deletions;
  const exceeds = changedLines > HUMAN_MERGE_LINE_THRESHOLD;
  return {
    measured: true,
    additions,
    deletions,
    changedLines,
    threshold: HUMAN_MERGE_LINE_THRESHOLD,
    exceeds,
    lifted: exceeds ? sizeLiftFrom(approval) : null,
    approvalState,
    source: typeof size?.source === 'string' && size.source !== '' ? size.source : null,
  };
}

/** Does the SIZE limb send this PR to the human terminal? Over the line AND not lifted (2026-09-27). Pure. */
export function sizeLimbFires(size) {
  return size?.exceeds === true && !size?.lifted;
}

/** The FORK limb (header section "The FORK predicate") off the PR object. Pure: NOT MEASURED without a `base.repo`; a deleted fork is a fork, fail closed. */
export function forkVerdict(pull = null) {
  const baseRepo = pull?.base?.repo?.full_name;
  if (typeof baseRepo !== 'string' || baseRepo === '') return { measured: false, isFork: false, headRepo: null, baseRepo: null };
  const headRepo = typeof pull?.head?.repo?.full_name === 'string' ? pull.head.repo.full_name : null;
  return { measured: true, isFork: headRepo === null || headRepo !== baseRepo, headRepo, baseRepo };
}

/**
 * Any limb: the PATH register, the SIZE threshold (unless an authorized approval
 * lifted it — 2026-09-27, `sizeLimbFires`) or a FORK head. The exit code reads
 * this, never `governed` alone.
 */
export function landsByHumanMerge(verdict) {
  return verdict?.governed === true || sizeLimbFires(verdict?.size) || verdict?.fork?.isFork === true;
}

/**
 * The exception lines a verdict carries, rendered under either branch. Empty
 * string when no registered exception path was among the hits, so every
 * verdict that never consulted the exception renders byte-identically to the
 * pre-exception form (constraint 3: every other judgment unchanged).
 */
export function renderExceptionLines(verdict) {
  const exceptions = verdict.exceptions ?? [];
  if (exceptions.length === 0) return '';
  return (
    '\n' +
    exceptions
      .map((e) =>
        e.pureRegeneration
          ? `  ℹ️  generated-surface exception (${e.ruling ?? '(unruled row)'}): ${e.path} is a PURE REGENERATION —\n` +
            `      byte-equal to \`${e.generator}\` recomputed on THIS tree (never a stored baseline),\n` +
            `      so this path does not govern the PR by itself. Any other governed hit still forks the whole PR.`
          : `  ⛔  generated-surface exception (${e.ruling ?? '(unruled row)'}) did NOT lift ${e.path}:\n` +
            `      ${e.reason}\n` +
            `      The path stays governed; a pure \`${e.generator}\` regeneration is the only thing the exception passes.`,
      )
      .join('\n')
  );
}

/** The words a seat reads before flipping ready. Pure, so --self-test pins them. */
export function renderTestVerdict(verdict) {
  // `hitPaths` is the POST-lift set, so on a diff whose only register hit was a
  // certified regeneration this counted 0 — printed directly above the exception
  // line naming that very path as a register hit (#15406, measured on PR #15284:
  // "0 of 11 path(s) hit the register" over one lifted hit). The count keeps its
  // meaning — what is STILL governed — and now says when the register lifted the
  // difference. ⛔ Byte-identical when nothing was lifted: the clause appears only
  // when there is a lift to name.
  const liftedCount = (verdict.exceptions ?? []).filter((e) => e.pureRegeneration).length;
  const head =
    `governed-surface predicate: ${verdict.hitPaths.length} of ${verdict.checked} path(s) hit the register` +
    (liftedCount > 0 ? ` after ${liftedCount} generated-artifact lift(s)` : '') +
    ` (${verdict.surfacesChecked} surfaces govern ${verdict.repo}).`;
  const size = verdict.size ?? sizeVerdict(null);
  const intake = renderForkLines(verdict.fork, verdict.checks);
  if (!verdict.governed) {
    if (sizeLimbFires(size) || verdict.fork?.isFork === true) {
      // The PATH limb is clear and the SIZE or FORK limb is not: the "ordinary
      // queue landing applies" sentence would be false here, so it is not printed.
      return (
        `${head}\n` +
        `  paths: none on the register — the ${verdict.fork?.isFork === true ? 'HEAD REPO' : 'SIZE'} decides this PR:\n` +
        `${intake}${renderSizeLines(size)}` +
        renderExceptionLines(verdict)
      );
    }
    return (
      `${head}\n` +
      `  ✅  NOT governed — ordinary queue landing applies to a PR with exactly this file list.\n` +
      `      Derived from GOVERNED_SURFACES, not recalled. Re-run on the FINAL file list: the register\n` +
      `      has grown several times in two days, and a reading taken earlier in the session is recall.\n` +
      `${intake}${renderSizeLines(size)}` +
      renderExceptionLines(verdict)
    );
  }
  const lines = verdict.matched.map((s) => {
    const files = s.files.slice(0, 8).map((f) => `        - ${f}`).join('\n');
    return `      ${s.glob} ×${s.files.length} — ${s.what}\n${files}`;
  });
  const clear = verdict.clearPaths.length > 0 ? `\n  paths not on the register: ${verdict.clearPaths.slice(0, 8).join(', ')}` : '';
  // The tier (#19133): Tier H keeps its wording word for word and gains one
  // line naming its tier; Tier S prints its OWN verdict block naming the
  // record-on-thread landing. Both say GOVERNED and the same three verbs, so
  // every grep reader of this text keeps its answer; both exit 3.
  const tier = verdict.tier ?? landingTierOf(verdict.matched);
  if (tier === GOVERNED_TIER_S) {
    return (
      `${head}\n` +
      `  ⛔  GOVERNED — Tier S(席内达档 L2 审核落地): every governed path here lies under a Tier S surface, so the OWNING\n` +
      `      seat lands this PR through the queue once its thread (or its card) carries a \`## Contract review\` record\n` +
      `      for the CURRENT head — \`Served-tier: CONTRACT_REVIEW_TIER\`, \`**VERDICT: PASS**\` — and every\n` +
      `      check green (AGENTS.md Prime Directive #14).\n` +
      `      Before that record no seat flips it ready, enqueues it, or arms auto-merge; ⛔ no seat approves it either,\n` +
      `      and no maintainer click is waited for. One hit governs the whole PR — 「混合 diff 一条命中即整 PR 分叉」;\n` +
      `      one Tier H path among the hits and the whole PR would be Tier H.\n` +
      `${lines.join('\n')}${clear}\n` +
      renderWorkflowSplitLines(verdict.matched) +
      renderLowRiskLines(verdict.matched) +
      `${intake}${renderSizeLines(size)}` +
      renderExceptionLines(verdict)
    );
  }
  return (
    `${head}\n` +
    `  ⛔  GOVERNED — a human merge is the review record for this PR (#9495 regime).\n` +
    `      No seat flips it ready, enqueues it, or arms auto-merge (AGENTS.md Prime Directive #14).\n` +
    `      One hit governs the whole PR — 「混合 diff 一条命中即整 PR 分叉」; proportion is not a question.\n` +
    `      ⚖️ landing tier: H(人合) — ${GOVERNED_TIERS[GOVERNED_TIER_H].landing}.\n` +
    `${lines.join('\n')}${clear}\n` +
    renderWorkflowSplitLines(verdict.matched) +
    renderLowRiskLines(verdict.matched) +
    `${intake}${renderSizeLines(size)}` +
    renderExceptionLines(verdict)
  );
}

/**
 * The SIZE limb's words (maintainer ruling 2026-09-18). Pure, so `--self-test`
 * pins all three readings: over, under, and NOT MEASURED. Printed under every
 * verdict — a reading that is silent about a leg it did not run reports a
 * clearance it never measured.
 */
export function renderSizeLines(size) {
  const s = size ?? sizeVerdict(null);
  const t = s.threshold;
  if (!s.measured) {
    return (
      `  ⚠️  size: NOT MEASURED — this verdict answers the PATH question only. A PR whose changed lines\n` +
      `      (additions + deletions, generated files INCLUDED) exceed ${t} lands only by a human merge; read\n` +
      `      the number with \`--pr <n>\` or \`--branch <ref>\`, or hand it to --test as \`--additions <n> --deletions <n>\`.`
    );
  }
  // The provenance of the number is NOT in these words — it is on the
  // derivation line (`--pr`, `--branch`) or the stderr note (`--test`), so the
  // verdict stays byte-identical across modes on the same list and numbers.
  const reading = `${s.changedLines} changed line(s) (+${s.additions} / -${s.deletions})`;
  if (!s.exceeds) return `  size: ${reading} ≤ ${t} — under the human-merge threshold (generated files included in the count).`;
  if (s.lifted) {
    return (
      `  ✅  SIZE LIFTED — ${reading} > ${t}, over the human-merge line, and an authorized APPROVED review lifts it\n` +
      `      (${s.lifted.ruling}): ${renderLiftApprovals(s.lifted)}.\n` +
      `      The OWNING seat lands this PR through the queue (席位落地); the maintainer's direct merge is the other landing.`
    );
  }
  return (
    `  ⛔  HUMAN MERGE OR AUTHORIZED APPROVAL — ${reading} > ${t}: over the human-merge line (maintainer ruling 2026-09-18;\n` +
    `      generated files INCLUDED — no exemption for regen artefacts, docs builds or reverts). The same terminal\n` +
    `      as a Tier H governed diff: no seat flips it ready, enqueues it, or arms auto-merge until an account in\n` +
    `      GOVERNED_APPROVERS has APPROVED it, on ANY commit (${SIZE_LIFT_RULING}) — then the OWNING seat lands it\n` +
    `      through the queue; the maintainer's own merge is the other landing. ACCEPT on the card,\n` +
    `      \`pm:awaiting-merge\` on the PR, the final 维护者速读, review requested from GOVERNED_APPROVERS.`
  );
}

/** The approver(s) and the commit each approval was given on — or the authorized enqueuer and when — as one clause. Pure; `--self-test` pins it. */
export function renderLiftApprovals(lifted) {
  if (lifted?.enqueuedBy?.login) return `${lifted.enqueuedBy.login} (enqueued it${lifted.enqueuedBy.at ? ` at ${lifted.enqueuedBy.at}` : ''})`;
  return (lifted?.approvals ?? [])
    .map((a) => `${a.login} (on ${a.commitId ? a.commitId.slice(0, 12) : 'a commit the review did not name'})`)
    .join(', ');
}

/** The FORK limb's words + the head's check-run count (header section "The FORK predicate"). Pure; `--self-test` pins every branch. */
export function renderForkLines(fork, checks = null) {
  const f = fork ?? forkVerdict(null);
  let out = '';
  if (!f.measured) out += `  ⚠️  head repo: NOT MEASURED — this verdict cannot tell a fork PR from an internal one; \`--pr <n>\` reads it.\n`;
  else if (f.isFork) out += `  ⛔  FORK PR — head ${f.headRepo ?? '(deleted fork repo)'} ≠ base ${f.baseRepo}: a PROPOSAL, never a delivery, whatever its paths.\n` +
      `      The Tier H terminal, with its own reason: no AI seat flips it ready, enqueues it, arms auto-merge on it or approves it —\n` +
      `      ever; a seat's review is required INPUT, never the permission. The owning seat adopts the diff onto an internal branch\n` +
      `      (\`Co-authored-by:\` the contributor) and lands THAT through the ordinary gates; requests to the contributor go only as\n` +
      `      review comments here, and this PR closes with thanks and the landing link.\n`;
  if (checks && checks.total === 0) out += `  ⚠️  check runs on head ${String(checks.sha ?? '').slice(0, 10)}: 0 — NOT MEASURED, never green: a fork's CI does not run until a\n` +
      `      maintainer approves it, and a head that never ran looks exactly like one that passed. No seat approves it to run.\n`;
  else if (checks && checks.total === null) out += `  ⚠️  check runs on the head: NOT READ (${checks.reason}) — read as NOT MEASURED, never green.\n`;
  return out;
}

// ── deriving the path list (#17003): three-dot, or a refusal ────────────────

/** The size flags' counterpart of the note below — same stream, same reason. */
export const CALLER_SIZED_NOTE =
  'ℹ️  the size above came from the CALLER (--additions/--deletions) — this predicate cannot see how it was\n' +
  '    counted. `--pr <n>` reads the pair off the PR object and `--branch <ref>` counts the merge-base range itself.';

/**
 * What `--test` says about its own INPUT. Printed on STDERR, deliberately: this
 * mode's STDOUT is a machine-read surface (`--json` hands any caller a JSON
 * verdict), and a predicate that changes what it hands its consumers in
 * order to warn its humans has broken something to say something. So `--test`'s
 * stdout is byte-identical to the pre-#17003 form in both renderings, and the
 * note travels beside it.
 */
export const CALLER_DERIVED_NOTE =
  'ℹ️  the paths above came from the CALLER — this predicate cannot see how they were derived.\n' +
  '    Derive them THREE-dot (`git diff --name-only origin/main...HEAD`), ⛔ never two-dot\n' +
  '    (`git diff --name-only origin/main HEAD`): on a branch behind main the two-dot list also\n' +
  "    carries main's OWN newer files, so it answers GOVERNED for paths this PR never touched\n" +
  '    (#17003 — measured 7 paths two-dot vs 2 three-dot on PR #16997).\n' +
  '    Better: let this script derive it — `--pr <n>` or `--branch <ref>`.';

/**
 * `--pr`'s argument, as data. `16997` means this checkout's own repo; the
 * qualified spelling names any of the governed repos, because the PM audits
 * six of them from one checkout — and since the register is scoped per row,
 * the repository named here is also the one the verdict answers for. Pure.
 */
export function parsePullTarget(value, selfSlug = null) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return { error: '--pr wants a PR number (`--pr 16997`) or `<owner>/<repo>#<n>`; it got nothing.' };
  const qualified = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(raw);
  if (qualified) return { slug: qualified[1], pull: Number(qualified[2]) };
  const bare = /^#?(\d+)$/.exec(raw);
  if (bare) {
    if (!selfSlug) {
      return {
        error:
          `--pr ${raw} names no repo, and this checkout's origin does not parse to one — ` +
          `spell it \`<owner>/<repo>#${bare[1]}\`.`,
      };
    }
    return { slug: selfSlug, pull: Number(bare[1]) };
  }
  return { error: `--pr wants \`<n>\` or \`<owner>/<repo>#<n>\`; it got '${raw}'.` };
}

/**
 * The `Link` header's `rel="next"` URL, or null. Pure.
 *
 * ⚠️ This, not a short page, is what ends the walk. "Stop when a page returns
 * fewer than `per_page` rows" is wrong on every exact multiple of 100 — it
 * reads the last full page as the last page and drops everything after it,
 * silently and only on some PRs.
 */
export function linkNext(header) {
  for (const part of String(header ?? '').split(',')) {
    const m = /^\s*<([^>]+)>\s*;\s*(.+)$/.exec(part);
    if (m && /\brel\s*=\s*"?next"?/.test(m[2])) return m[1];
  }
  return null;
}

/**
 * The governed READING of an API changed-files page set: every `filename`,
 * plus every `previous_filename` a rename carries. Pure.
 *
 * ⭐ The old path is not optional. A rename out of a governed path — say
 * `AGENTS.md` to `docs/AGENTS.md` — changes the governed surface, and reading
 * only the new name answers NOT governed for a diff that deletes a governed
 * file. Both paths are read, and the pair is reported so the operator can see
 * which hit came from a rename.
 */
export function pullPathsFrom(files) {
  const list = Array.isArray(files) ? files : [];
  const paths = [];
  const renames = [];
  const seen = new Set();
  const add = (p) => {
    if (typeof p !== 'string' || p === '' || seen.has(p)) return;
    seen.add(p);
    paths.push(p);
  };
  for (const file of list) {
    add(file?.filename);
    const previous = file?.previous_filename;
    if (typeof previous === 'string' && previous !== '') {
      add(previous);
      renames.push({ from: previous, to: typeof file?.filename === 'string' ? file.filename : '(unnamed)' });
    }
  }
  return { paths, renames, entries: list.length };
}

/**
 * Did the page walk collect the whole list? Pure — returns the refusal's
 * reason, or null when the walk is provably complete.
 *
 * The proof is the PR's own `changed_files` count, because the endpoint has a
 * ceiling of its own and a truncated list is a SUBSET: the one direction that
 * can hide a governed hit outright.
 */
export function pullTruncationReason({ collected, changedFiles, pages, pageCap, morePages = false }) {
  if (morePages) {
    return (
      `the page walk hit its ${pageCap}-page cap with ${collected} file(s) collected and more pages still ` +
      `pending. A truncated list is a SUBSET, and a subset can hide a governed hit outright.`
    );
  }
  if (typeof changedFiles !== 'number' || !Number.isFinite(changedFiles)) {
    return (
      `the PR reports no \`changed_files\` count, so a walk that collected ${collected} file(s) over ` +
      `${pages} page(s) cannot be proven whole. An unproven list is not a governed-surface answer.`
    );
  }
  if (collected === changedFiles) return null;
  return (
    `the page walk collected ${collected} file(s) over ${pages} page(s) but the PR reports ${changedFiles}. ` +
    `A list that does not match its own count is not one this predicate will answer on.`
  );
}

/** The words every failed derivation prints. Pure, so `--self-test` pins them. */
export function renderDerivationRefusal({ mode, reason, remedy = null }) {
  return (
    `❌  cannot derive ${mode}'s file list — ${reason}\n` +
    `    ⛔ Refusing rather than falling back to a two-dot diff (\`origin/main HEAD\`): on a branch\n` +
    `       behind main that list carries main's own newer files, so this predicate would answer\n` +
    `       GOVERNED for paths the PR never touched (#17003). A wrong answer is worse than none.` +
    (remedy ? `\n    Remedy: ${remedy}` : '')
  );
}

/**
 * `--branch <ref>`, offline: the three-dot path list, or a refusal. Pure given
 * `run`, which takes a git argv and answers `{ ok, out, error }` — so
 * `--self-test` pins every branch, including the ones a real checkout cannot
 * be made to reach on demand.
 *
 * ⚠️ Each input is resolved and CHECKED before the next one is spent. An empty
 * merge base is the whole reason this function exists: `git merge-base` exits
 * 1 with no output on a shallow clone, and the shell recipe that reads it
 * inline then diffs against the working tree and exits 0 with a superset.
 */
export function deriveBranchPaths({ ref, base = 'origin/main', run }) {
  const refuse = (reason, remedy) => ({ ok: false, reason, remedy });
  const commit = (spec) => run(['rev-parse', '--verify', '--quiet', `${spec}^{commit}`]);

  const baseRead = commit(base);
  if (!baseRead.ok || !isObjectId(baseRead.out)) {
    return refuse(
      `\`${base}\` does not resolve to a commit in this checkout${baseRead.error ? ` (${baseRead.error})` : ''}.`,
      `\`git fetch origin main\`, then re-run. ⛔ Do not substitute a local \`main\` — it is not what the PR merges into.`,
    );
  }
  const refRead = commit(ref);
  if (!refRead.ok || !isObjectId(refRead.out)) {
    return refuse(
      `\`${ref}\` does not resolve to a commit in this checkout${refRead.error ? ` (${refRead.error})` : ''}.`,
      `Fetch the branch (\`git fetch origin ${ref}\`) or name one this checkout has.`,
    );
  }
  const mergeBase = run(['merge-base', baseRead.out, refRead.out]);
  if (!mergeBase.ok || !isObjectId(mergeBase.out)) {
    return refuse(
      `\`git merge-base ${base} ${ref}\` computed nothing` +
        `${mergeBase.error ? ` (${mergeBase.error})` : ' (it exited non-zero with empty output)'} — ` +
        `a shallow clone or unrelated histories. There is no three-dot list to take.`,
      `\`git fetch --deepen 200 origin main\` (or \`--unshallow\`) until the two histories meet, then re-run.`,
    );
  }
  // ⛔ --no-renames on purpose: with rename detection git prints ONLY the new
  // path, so a rename out of a governed path would read as ungoverned. Without
  // it the rename is a delete plus an add — the same two paths the API reports.
  // ⛔ `-z`, split on NUL: without it git C-quotes a path holding a non-ASCII or
  // control character, and the quoted spelling matches no governed prefix.
  const diff = run(['diff', '-z', '--name-only', '--no-renames', mergeBase.out, refRead.out]);
  if (!diff.ok) {
    return refuse(`\`git diff\` failed against the merge base ${mergeBase.out.slice(0, 10)} (${diff.error}).`, null);
  }
  const paths = diff.out.split('\0').filter((l) => l !== '');
  // The SIZE limb (2026-09-18 ruling) is read off the SAME range the list is:
  // `--numstat` per file, summed, a binary row counting 0 as it does on GitHub.
  // ⚠️ `-M`, NOT `--no-renames` (#30718): the threshold's authority is GitHub's
  // additions + deletions, which count a moved file by its content change.
  const numstat = run(['diff', '--numstat', '-M', mergeBase.out, refRead.out]);
  if (!numstat.ok) {
    return refuse(
      `\`git diff --numstat\` failed against the merge base ${mergeBase.out.slice(0, 10)} (${numstat.error}) — ` +
        `the size leg cannot be answered, and an unanswered size is never a size of zero.`,
      null,
    );
  }
  const size = { ...parseNumstat(numstat.out), source: 'git diff --numstat -M (rename-aware, as GitHub counts) on the same merge-base range' };
  return {
    ok: true,
    paths,
    size,
    derivation: {
      kind: 'branch',
      base,
      baseSha: baseRead.out,
      ref,
      refSha: refRead.out,
      mergeBase: mergeBase.out,
      command: `git diff -z --name-only --no-renames ${mergeBase.out.slice(0, 10)} ${refRead.out.slice(0, 10)}`,
      count: paths.length,
      size,
    },
  };
}

/**
 * `git diff --numstat` → the pair the size predicate reads. Pure. A binary row
 * (`-\t-\tpath`) is counted as a file and as 0 changed lines — GitHub reports
 * 0/0 for a binary file too, so the local number matches the PR's.
 */
export function parseNumstat(text) {
  let additions = 0;
  let deletions = 0;
  let files = 0;
  let binaryFiles = 0;
  for (const line of String(text ?? '').split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(line);
    if (!m) continue;
    files += 1;
    if (m[1] === '-' || m[2] === '-') {
      binaryFiles += 1;
      continue;
    }
    additions += Number(m[1]);
    deletions += Number(m[2]);
  }
  return { additions, deletions, files, binaryFiles };
}

/** The self-describing line every derived reading prints above its verdict. Pure. */
export function renderDerivation(derivation) {
  if (derivation?.kind === 'pull') {
    const renameLines = (derivation.renames ?? []).map(
      (r) => `    renamed — BOTH paths read, the old one included: ${r.from} → ${r.to}`,
    );
    const sizeLine = derivation.size
      ? [`    size: +${derivation.size.additions} / -${derivation.size.deletions} — additions and deletions as GitHub reports them on the PR object.`]
      : [];
    return [
      `derived from GET ${derivation.endpoint} (three-dot by construction): ${derivation.count} path(s) ` +
        `from ${derivation.entries} changed file(s), over ${derivation.pages} page(s).`,
      ...renameLines,
      ...sizeLine,
    ].join('\n');
  }
  if (derivation?.kind === 'branch') {
    const sizeLine = derivation.size
      ? `\n    size: +${derivation.size.additions} / -${derivation.size.deletions} over ${derivation.size.files} file(s)` +
        ` (${derivation.size.binaryFiles} binary, counted 0) — \`git diff --numstat -M\` (rename-aware, as GitHub counts) on the same range.`
      : '';
    return (
      `derived from \`${derivation.command}\` (three-dot): ${derivation.count} path(s).\n` +
      `    ${derivation.base} = ${derivation.baseSha.slice(0, 10)}, ${derivation.ref} = ${derivation.refSha.slice(0, 10)}, ` +
      `merge-base = ${derivation.mergeBase.slice(0, 10)}.${sizeLine}`
    );
  }
  return 'derived from an unnamed source — ⛔ do not act on this reading.';
}

/**
 * The #11705 verdict, pure so `--self-test` pins every branch offline. Inputs:
 * the hit `path`, its register `entry`, and `run` — what the generator answered
 * on the tree under test, as `{ ok, outputs, reason }`.
 *
 * Pass ⟺ the generator DECLARED this path among its outputs AND its own
 * `--check` reported no drift. Both halves are the generator's own answer, not
 * this file's: the first is the ruling's "enumerated from the generator", the
 * second is its "proven per-file". Every other input answers fail-closed with a
 * stated reason, and there is no heuristic branch — a path the manifest does
 * not name is hand-authored content sitting beside generated output, which is
 * exactly the case the ruling says stays governed.
 */
export function sinkGeneratorVerdict({ path, entry, run }) {
  const failClosed = (reason) => ({ pureRegeneration: false, reason: `${reason} — fail closed: the path stays governed` });
  if (!run || typeof run !== 'object') return failClosed('the generator was not run');
  if (!Array.isArray(run.outputs) || run.outputs.length === 0) {
    return failClosed(
      `the generator declared no output set (${run.reason ?? 'no manifest was produced'}); ` +
        "without the generator's own list of the files it writes there is nothing to prove ownership against",
    );
  }
  if (!run.outputs.includes(path)) {
    return failClosed(
      `\`${entry.generator}\` does not write ${path} — it is not among the ${run.outputs.length} file(s) that generator ` +
        'declared on this tree, so it is hand-authored content sitting beside generated output',
    );
  }
  if (run.ok !== true) {
    return failClosed(
      `\`${entry.verify?.gate ?? "the generator's --check"}\` does not certify this tree (${run.reason ?? 'no reason reported'}); ` +
        'byte-exact agreement with the generator is the only pass, so a hand edit keeps the path governed',
    );
  }
  return {
    pureRegeneration: true,
    reason:
      `byte-equal to \`${entry.generator}\` recomputed on this tree — the generator declared ${run.outputs.length} output(s), ` +
      `this path among them, and its own \`${entry.verify?.gate ?? '--check'}\` reported no drift across all of them ` +
      '(no stored baseline consulted)',
  };
}

/**
 * Run a sink-based generator's `--check` on the tree under test and read the
 * output set it declares. The generator is the tree's OWN copy, run through
 * the package manager exactly as an operator would; nothing here re-implements
 * it, and the manifest is written by the generator, to a temp file, never into
 * the repo.
 *
 * Every failure — no toolchain, spawn error, unreadable manifest, drift —
 * returns `ok: false` with the reason, and `sinkGeneratorVerdict` turns that
 * into a governed verdict. ⚠️ "No toolchain" is a real environment here, not a
 * hypothetical. It used to be the merge-group guard job's PERMANENT state: that
 * job installed nothing, so every row with a `verify` failed closed there while
 * the seat-side `--test` lifted the same diff. #14063 gave the job an install
 * (maintainer 2026-09-01, quoted in `check-governed-queue-guard.mjs`'s header),
 * and made every step of it `continue-on-error` — so this branch is now the
 * DEGRADED path rather than the normal one, and it degrades to exactly the
 * fail-closed behaviour that preceded it.
 */
export function runSinkGenerator(root, entry) {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'os-governed-manifest-'));
  } catch (error) {
    return { ok: false, outputs: null, reason: `could not create a temp dir for the output manifest (${String(error?.message ?? error).split('\n')[0]})` };
  }
  const manifest = join(dir, 'outputs.json');
  try {
    const res = spawnSync(
      'pnpm',
      ['--filter', entry.verify.pkg, 'exec', 'tsx', entry.verify.script, '--check', `--generated-manifest=${manifest}`],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 },
    );
    let outputs = null;
    try {
      outputs = JSON.parse(readFileSync(manifest, 'utf8')).outputs ?? null;
    } catch {
      outputs = null;
    }
    if (res.error) {
      return {
        ok: false,
        outputs,
        reason:
          `could not run \`${entry.generator}\` on this tree (${String(res.error.message).split('\n')[0]}) — ` +
          'the generator toolchain is not available in this environment',
      };
    }
    if (res.status !== 0) {
      const drift = `${res.stderr ?? ''}${res.stdout ?? ''}`
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^[+~-] /.test(l) || /out of date|✗/.test(l))
        .slice(0, 4)
        .join(' | ');
      return { ok: false, outputs, reason: `the generator's own --check exited ${res.status ?? 'by signal'}${drift ? `: ${drift}` : ''}` };
    }
    if (!outputs) return { ok: false, outputs: null, reason: 'the generator ran clean but declared no readable output manifest' };
    return { ok: true, outputs, reason: 'the generator reported no drift' };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a leftover temp dir is not a provenance answer */
    }
  }
}

/**
 * The runner `runSinkGenerator` hands the generator to. Named, because the
 * prerequisite probe below has to look for the same binary the recompute execs,
 * and two spellings of it would be two answers to one question.
 */
export const GENERATOR_TOOLCHAIN_RUNNER = 'tsx';

/**
 * Can the row's recompute run on this tree AT ALL? `null` when it can, a stated
 * refusal when it cannot.
 *
 * ## Why this exists, and why it must be asked BEFORE the floors
 *
 * `runSinkGenerator` is fail-closed by design, and right to be: for the AUDIT, a
 * generator that cannot run means the path stays governed. But every one of its
 * failures wears the same shape — `outputs: null` with a reason string — and the
 * self-test's live #11705 battery branches on that shape, registering fewer
 * cases when there is no output set to assert against. In a freshly created
 * worktree, before `pnpm install`, that is what happens: measured, `pnpm
 * --filter @objectstack/spec exec tsx …` exits 254 with
 * `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsx" not found`, the battery
 * registers 5 of its pinned 7, and the FLOOR renders that as
 * "cases that used to run no longer do — the battery is the bug", prescribing a
 * hunt for an early return or a deleted block. Nothing was deleted. The
 * toolchain was absent, and the run measured nothing.
 *
 * ⛔ The reason string cannot carry this distinction: an uninstalled checkout and
 * a generator that genuinely reports drift BOTH arrive as a non-zero `--check`
 * exit, and classifying by that text would fold a real finding into a refusal —
 * the expensive direction. So the question is asked of the ENVIRONMENT instead,
 * before anything runs, and it is answered by looking for the same binary
 * `pnpm exec` would.
 *
 * ## What this can and cannot change
 *
 * It is strictly a NARROWING of one exit code into another: a tree whose
 * toolchain resolves takes the identical path it took before this existed, and
 * a tree whose toolchain does not resolve exits 3 instead of 1. There is no
 * branch here that turns a red into a green — nothing it answers can lift a
 * governed path, silence a case, or lower a floor, and the audit
 * (`--test`, the sweep) never consults it.
 *
 * Two remedies, kept apart because they are different acts: nothing installed at
 * all, and an install that does not carry the runner. Anything this probe cannot
 * see still falls through to the fail-closed reading exactly as before — it
 * removes the measured cause of the misdiagnosis, and claims nothing wider.
 *
 * @param {string} root  the tree the recompute would run in
 * @param {object} entry  the register row whose generator would be run
 * @returns {{ headline: string, detail: string[], fix: string } | null}
 */
export function generatorToolchainPrerequisite(root, entry) {
  const modules = join(root, 'node_modules');
  const runner = join(modules, '.bin', GENERATOR_TOOLCHAIN_RUNNER);
  const generator = entry?.generator ?? "the register row's generator";
  if (!existsSync(modules)) {
    return {
      headline: `this checkout has no \`node_modules\`, so \`${generator}\` cannot be run here.`,
      detail: [
        `Looked for:  ${modules}`,
        '',
        'The live #11705 case runs that generator on THIS tree and reads the output set the',
        'generator itself declares — the one case a fixture cannot stand in for. With nothing',
        `installed, the recompute cannot exec \`${GENERATOR_TOOLCHAIN_RUNNER}\`; the run comes back with no output`,
        'set, and the battery registers fewer cases than it pins. That is a battery that could',
        'not LOAD, not one that shrank.',
        '',
        'Re-run:  pnpm check:pm-governed-merges — the advisory below names this file by PATH,',
        'and without `--self-test` that command runs the network SWEEP, not these cases.',
      ],
      fix: INSTALL_FIX,
    };
  }
  if (!existsSync(runner)) {
    return {
      headline: `\`${GENERATOR_TOOLCHAIN_RUNNER}\` is not installed in this checkout, so \`${generator}\` cannot be run here.`,
      detail: [
        `Looked for:  ${runner}`,
        '',
        '`node_modules` is present, so this checkout was installed at least once — but the',
        `runner \`${generator}\` execs is not on it, which a partial, pruned or interrupted`,
        'install produces. The live #11705 case reaches the generator exactly as it does in a',
        'checkout with nothing installed at all, and measures nothing either way.',
        '',
        'Re-run:  pnpm check:pm-governed-merges — the advisory below names this file by PATH,',
        'and without `--self-test` that command runs the network SWEEP, not these cases.',
      ],
      fix: INSTALL_FIX,
    };
  }
  return null;
}

/**
 * The hit paths that consult the register, grouped by the row they belong to.
 * Pure; the grouping is what lets one generator run answer for every path it
 * owns in the same diff.
 */
export function groupHitsByException(hitPaths) {
  const groups = new Map();
  for (const path of Array.isArray(hitPaths) ? hitPaths : []) {
    const entry = generatedExceptionFor(path);
    if (!entry) continue;
    const bucket = groups.get(entry) ?? [];
    bucket.push(path);
    groups.set(entry, bucket);
  }
  return groups;
}

/**
 * THE recompute driver — one mechanism, both scripts (#11705 ruled: "⛔ do not
 * author a second mechanism"). Answers a path → provenance Map for every
 * registered hit, applying the per-row co-edit fence FIRST (it can only keep a
 * path governed, and it costs no process), then the row's own recompute.
 *
 * `allPaths` is the whole diff under test, which the fence reads; `baseRef`
 * names the base a merge-group build must diff against; `cache` lets a caller
 * that judges several commits of one build pay for each generator run once —
 * the run reads the TREE, which does not change between those rows.
 */
export async function recomputeProvenanceFor(root, hitsByEntry, { allPaths = [], baseRef = null, cache = new Map() } = {}) {
  const provenance = new Map();
  for (const [entry, paths] of hitsByEntry) {
    const coEdit = generatorCoEditProvenance(allPaths, entry);
    if (coEdit) {
      for (const path of paths) provenance.set(path, coEdit);
      continue;
    }
    if (entry.verify) {
      if (!cache.has(entry.id)) cache.set(entry.id, runSinkGenerator(root, entry));
      const run = cache.get(entry.id);
      for (const path of paths) provenance.set(path, sinkGeneratorVerdict({ path, entry, run }));
      continue;
    }
    // A row with no recompute cannot prove anything about its paths. There is no
    // "trust the row" branch here — that would lift a governed path on the strength
    // of a register entry alone, which is the one thing no row is allowed to do.
    for (const path of paths) {
      provenance.set(path, {
        pureRegeneration: false,
        reason:
          `the register row \`${entry.id}\` declares no recompute (\`verify\`), so nothing can prove this ` +
          'file matches its generator on the tree under test — fail closed: the path stays governed',
      });
    }
  }
  return provenance;
}

// ── local git (enumeration + diff paths; zero API) ──────────────────────────

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * The same call as `git()`, with the failure as DATA — `{ ok, out, error }`,
 * `out` already trimmed. `deriveBranchPaths` needs every leg's exit status,
 * and `git rev-parse --verify --quiet` reports a missing ref by exiting 1 with
 * empty output, which a throwing helper turns into an exception carrying
 * nothing an operator can read.
 */
function tryGit(root, args) {
  try {
    return { ok: true, out: git(root, args).trim(), error: '' };
  } catch (error) {
    // git's own diagnosis or NOTHING. `error.message` here is node's wrapper
    // ("Command failed: git merge-base <sha> <sha>"), which says only that the
    // call failed — a caller quoting it prints two raw shas where a reason
    // belongs. An empty string is honest; the failure itself is `ok: false`.
    return { ok: false, out: '', error: String(error?.stderr ?? '').trim().split('\n')[0] };
  }
}

/**
 * Why a repo with a truncated history is UNAUDITED rather than swept. Pure, so
 * `--self-test` pins the words: this reason is the only thing standing between
 * a short list and a maintainer reading it as a clean window.
 */
export function truncatedHorizonReason({ ref, horizon }) {
  return (
    `cannot audit the whole window on ${ref} — ${horizon.reason}. ` +
    `Enumerating anyway would UNDER-report, and a short governed-merge list reads as COMPLIANCE: ` +
    `the merges below the boundary are invisible to \`git log\`, which reports no error (#9902). ` +
    `Remedy: ${horizon.remedy}`
  );
}

/** The horizon an audited repo was swept against, for the report line. */
export function describeHorizon(horizon) {
  return horizon.shallow ? `shallow, oldest visible ${horizon.floor} (predates the window)` : 'complete clone';
}

// ── remote reachability + mirror freshness (#13307) ─────────────────────────

/**
 * The third form of "nothing was looked at", and the one that reads as the
 * loudest possible green: the checkout is present, healthy, complete, its
 * `origin/main` resolves, its tip has a real date — and the remote it mirrors
 * is GONE, or has simply moved on without it. Every clause the row prints is
 * literally true ABOUT THE LOCAL SNAPSHOT, and the conclusion a reader draws —
 * no governed merge happened there in this window — is unsupported.
 *
 * Measured 2026-08-30 (#13307): `objectstack-ai/cloud` left this fleet's
 * GitHub scope — the API answers `Could not resolve to a Repository`, the repo
 * is absent from the account's visible list, and `git fetch origin main` in
 * the local clone answers `fatal: repository ... not found`. Wherever that
 * clone survives, this sweep printed
 * `✓ audited objectstack-ai/cloud — tip 15f55df2d ... 0 mainline commit(s) in
 * window` and exited 0, and it would have printed that FOREVER: the remediation
 * the row itself prescribes is exactly the command that 404s. Reproduced
 * synthetically on this branch against the unmodified script (a checkout whose
 * origin bare repo was deleted): `✓ audited ... 2 mainline commit(s) in window`
 * followed by `✅ clean window`, exit 0.
 *
 * ⚠️ This is a PARALLEL LEG in the same refusal register, not an extension of
 * the #9902 horizon guard, and the difference is load-bearing rather than
 * stylistic. Three reasons, in the order that decided it:
 *
 *   1. THE HORIZON GUARD IS NOT ASKED OF EVERY REPO. `historyHorizon` runs
 *      only where a DATE window is in force (`if (!base)` — a topological
 *      `--since-ref` window answers its own completeness question and skips
 *      it). Reachability has to be asked of every repo in every window mode;
 *      keyed onto that branch it would be silently absent from exactly the
 *      invocation this card's own re-check command uses.
 *   2. `historyHorizon` LIVES IN `git-history.mjs`, shared with other adopters
 *      precisely so the predicate cannot drift. It is zero-network by
 *      construction; teaching it to reach the network would change every
 *      adopter's cost and failure surface for one caller's question.
 *   3. THE QUESTIONS ARE DIFFERENT. "Does my local history reach back far
 *      enough" and "is my local history the remote's history at all" fail
 *      independently: a complete clone can be a dead mirror, and a fresh
 *      mirror can be too shallow.
 *
 * What is REUSED — and it is the part that matters — is the refusal register
 * itself: `status: 'unaudited'` plus a stated reason, rendered `⚠️ UNAUDITED`,
 * counted by the `#4690` note, and classified INCOMPLETE (exit 2) by the exit
 * contract. No second mechanism, no new exit code, no new report section.
 *
 * ⛔ Deliberately NOT the fix: dropping `cloud` from `GOVERNED_REPOS`. That
 * converts a loud hole into a silent one — whether the repo is still in scope
 * is a maintainer question, and until it is answered the honest reading is
 * NOT MEASURED, which is what this leg produces.
 */
export const REMOTE_PROBE_TIMEOUT_MS = 20_000;

/**
 * `origin/main` → `{ remote: 'origin', branch: 'main' }`, or null for a ref
 * this cannot probe. Null is a REFUSAL upstream, never a skip: a ref whose
 * remote cannot be named is a ref whose remote was never consulted.
 */
export function remoteRefParts(ref) {
  const m = /^([^/]+)\/(.+)$/.exec(typeof ref === 'string' ? ref : '');
  return m ? { remote: m[1], branch: m[2] } : null;
}

/** A 40-hex object id and nothing else. Empty is NOT a value — it is a failure. */
function isObjectId(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value.trim());
}

/**
 * Is this checkout a live mirror of the repo it claims to audit? Pure — the
 * probe RESULT arrives as data, so every branch is offline-testable and
 * `--self-test` pins all of them. Answers null when the mirror is provably
 * current (the only branch that lets the row stay `audited`), or
 * `{ reason }` — the words the UNAUDITED row prints.
 *
 * ⚠️ THE SHAPE CHECKS COME BEFORE THE EQUALITY TEST, and that ordering is the
 * whole guard. `local === remote` is the SUCCESS condition; two unreadable
 * shas are also equal, so a total failure of both readings would satisfy it
 * and certify a dead mirror as verified — a guard whose success condition
 * equals its total-failure condition must refuse instead. So an absent,
 * empty, or non-object-id sha on EITHER side is a stated failure, never a
 * match, and the equality test is only ever reached with two real object ids.
 *
 * The freshness half also subsumes, more sharply, the "bound the staleness"
 * requirement the card states in terms of dates. A tip DATE older than the
 * window cannot distinguish a quiet repo from a dead mirror — local git has
 * no way to tell them apart, which is why the old row could only hedge
 * ("if that tip predates your last fetch, run `git fetch origin main`"). Tip
 * IDENTITY can: the mirror is behind exactly when the remote names a
 * different commit, whatever the dates say. So a genuinely quiet repo still
 * says a TRUE ZERO — required, since a fix that turns every zero into NOT
 * MEASURED is as useless as the false zero it replaced — and a stale one
 * refuses.
 */
export function remoteFreshnessVerdict({ ref, path, localSha, remote }) {
  const parts = remoteRefParts(ref);
  if (!parts) {
    return {
      precondition: 'unprobeable-ref',
      reason:
        `NOT MEASURED: '${ref}' does not name a remote-tracking ref, so this sweep cannot establish that ` +
        `any remote was consulted for ${path}. A local ref is not evidence of a remote reading (#13307).`,
    };
  }
  if (!remote || remote.reachable !== true) {
    return {
      precondition: 'unreachable-remote',
      reason:
        `NOT MEASURED: the remote '${parts.remote}' could not be reached from ${path} ` +
        `(${remote?.error ?? 'no probe result'}). ⛔ A local tip is NOT evidence the remote was consulted: ` +
        `a clone of a repo that has left this fleet's scope still resolves '${ref}', still reports a real ` +
        `tip and date, and would print \`✓ audited … 0 mainline commit(s) in window\` forever, because the ` +
        `remedy such a row prescribes is the very command that fails (#13307). "I looked and found nothing" ` +
        `and "I could not look" are different facts and this sweep is required to keep them apart (#4690). ` +
        `Remedy: establish whether ${parts.remote} is still in scope for this fleet — if the repo was ` +
        `retired deliberately that is a maintainer decision to record, and ⛔ not something this audit may ` +
        `assume by dropping the repo from its list.`,
    };
  }
  if (!isObjectId(remote.sha)) {
    return {
      precondition: 'remote-tip-unreadable',
      reason:
        `NOT MEASURED: the remote '${parts.remote}' answered for ${path} but named no commit on ` +
        `'${parts.branch}' (read: ${JSON.stringify(remote.sha ?? null)}). An unreadable remote tip is a ` +
        `FAILED reading, never a match — comparing it to an equally unreadable local tip would certify a ` +
        `dead mirror as verified (#13307).`,
    };
  }
  if (!isObjectId(localSha)) {
    return {
      precondition: 'local-tip-unreadable',
      reason:
        `NOT MEASURED: '${ref}' in ${path} did not resolve to a commit id (read: ` +
        `${JSON.stringify(localSha ?? null)}), so there is nothing to compare the remote tip against. ` +
        `Remedy: git -C ${path} fetch ${parts.remote} ${parts.branch}`,
    };
  }
  if (localSha.trim() !== remote.sha.trim()) {
    return {
      precondition: 'stale-mirror',
      reason:
        `NOT MEASURED: this mirror is BEHIND its remote — '${ref}' here is ${localSha.trim().slice(0, 9)} ` +
        `but ${parts.remote} names ${remote.sha.trim().slice(0, 9)} on '${parts.branch}'. Enumerating ` +
        `anyway would answer over a snapshot rather than over the branch, and it would UNDER-report by ` +
        `exactly the merges this checkout has not fetched — a short governed-merge list reads as ` +
        `COMPLIANCE (#9902). Remedy: git -C ${path} fetch ${parts.remote} ${parts.branch}`,
    };
  }
  return null;
}

/**
 * The words an audited row prints once its mirror is PROVEN live — the other
 * half of the same measurement, and the reason a zero from this sweep is now
 * stronger than it was. Pure, so `--self-test` pins them.
 */
export function describeRemote(remote) {
  return `${remote.ref} reached at ${remote.remoteName}, tip ${remote.sha.slice(0, 9)} matches this mirror`;
}

// ── the window (#12633): landing order, not committer dates ─────────────────

/**
 * The declared build-to-land skew budget, in seconds — subtracted from every
 * operator-supplied date boundary (route A of the #12633 ruling), and stated in
 * the report line so a re-listed boundary entry reads as re-recognition.
 *
 * 3600 s = 1.86× the largest directly measured build-to-land skew (1,939 s, PR
 * #12443, 2026-08-26) and 4.1× the largest committer-date inversion on this
 * mainline (874 s of 10 inversions in 3,613 first-parent pairs, re-measured
 * 2026-08-27). ⛔ Never set to the measured maximum: a bound written exactly at
 * today's worst case invalidates itself the first time a slower batch lands.
 */
export const SKEW_BUDGET_SECONDS = 3600;

/** The ref pinned for a repo — its own `<id>=<ref>`, else the bare one, else none. */
export function refForRepo(window, repoId) {
  return window.pinnedRefs?.get(repoId) ?? window.bareRef ?? null;
}

/**
 * The window a sweep runs against, as data. Pure: `resolveRefDate` is injected,
 * so every branch — including the unresolvable ref — is offline-testable.
 *
 * Returns `{ error }` for a window this sweep cannot parse. A window it cannot
 * parse is a hard failure, never a default (the `parseSince` rule, one level up).
 *
 * ⚠️ EVERY REF RESOLVES IN ITS OWN REPO (#13424). The refs are per-repo by
 * construction — `<id>=<ref>` pins one repo, a bare ref is tried wherever it
 * resolves — and the fallback DATE this function derives is now resolved the
 * same way: `resolveRefDate(ref, repoId)` is asked per pair, an `<id>=<ref>`
 * pin only in its own repo, a bare ref across `repoIds`. It used to be asked
 * of the SELF checkout only, so a sweep pinning only sibling-repo tips
 * (`--since-ref objectui=TIP`, no objectstack pin) exited 1 with `does not
 * resolve to a commit` although every ref resolved perfectly in its own
 * repository — a false red: a usable sweep rejected, the constraint
 * undeclared and incidental. The hard failure survives exactly where it is
 * honest: no named ref resolves in ANY repo it names.
 */
export function resolveWindow({
  sinceRefArgs = [],
  sinceArg = null,
  now = new Date(),
  budgetSeconds = SKEW_BUDGET_SECONDS,
  repoIds = GOVERNED_REPOS.map((r) => r.id),
  resolveRefDate = () => null,
} = {}) {
  const pinnedRefs = new Map();
  let bareRef = null;
  for (const raw of sinceRefArgs) {
    const arg = String(raw);
    const eq = arg.indexOf('=');
    if (eq > 0) pinnedRefs.set(arg.slice(0, eq), arg.slice(eq + 1));
    else bareRef = arg;
  }
  const backOff = (iso) => new Date(Date.parse(iso) - budgetSeconds * 1000).toISOString();

  if (bareRef === null && pinnedRefs.size === 0) {
    const requestedIso = parseSince(sinceArg ?? '24h', now);
    if (!requestedIso) return { error: `--since wants <N>d, <N>h, or an ISO date; got '${sinceArg}'.` };
    return { mode: 'date', bareRef: null, pinnedRefs, requestedIso, effectiveIso: backOff(requestedIso), budgetSeconds };
  }

  // The topological window still carries a date: it is what a repo the ref does
  // not resolve in falls back to, and what `historyHorizon` is asked about
  // there. The OLDEST resolved ref date is the conservative choice — a wider
  // fallback window over-lists, which this audit tolerates by design. Each
  // pair resolves in ITS OWN repo (#13424): a pin in the repo it names, a bare
  // ref in every governed checkout.
  const pairs = [
    ...[...pinnedRefs].map(([repoId, r]) => ({ repoId, ref: r })),
    ...(bareRef !== null ? repoIds.map((repoId) => ({ repoId, ref: bareRef })) : []),
  ];
  const dates = pairs
    .map(({ repoId, ref }) => resolveRefDate(ref, repoId))
    .filter((d) => typeof d === 'string' && d !== '' && !Number.isNaN(Date.parse(d)));
  if (dates.length === 0) {
    const named = [...new Set(pairs.map((p) => p.ref))];
    return {
      error:
        `--since-ref ${named.map((r) => `'${r}'`).join(', ')} does not resolve to a commit in any repo it names ` +
        `(an <id>=<ref> pin resolves in that repo's own checkout, a bare ref in every governed checkout — ` +
        `never only in the self checkout, #13424).`,
    };
  }
  const requestedIso = new Date(Math.min(...dates.map((d) => Date.parse(d)))).toISOString();
  return { mode: 'topological', bareRef, pinnedRefs, requestedIso, effectiveIso: backOff(requestedIso), budgetSeconds };
}

/**
 * The landing window over an already-walked first-parent chain (newest first).
 * Pure, and the heart of #12633: the emitted set is the chain PREFIX down to
 * the DEEPEST commit dated inside the window, so a commit that landed after
 * something inside the window is never dropped for carrying an earlier date.
 *
 * `anchorAtEdge` is the proof obligation. The anchor is the deepest DATED-IN
 * commit *of what was walked*; if nothing below it was walked, it cannot be
 * shown to be the deepest one, and the caller must report INCOMPLETE rather
 * than a clean window. `straddlers` are the entries a bare `--since` cut would
 * have dropped — the re-listings the report line names.
 */
export function landingWindowFrom(rows, windowStartMs) {
  let anchor = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (Date.parse(rows[i].date) >= windowStartMs) {
      anchor = i;
      break;
    }
  }
  if (anchor === -1) return { commits: [], anchor: -1, anchorAtEdge: false, straddlers: [] };
  const commits = rows.slice(0, anchor + 1);
  return {
    commits,
    anchor,
    anchorAtEdge: anchor === rows.length - 1,
    straddlers: commits.filter((c) => Date.parse(c.date) < windowStartMs),
  };
}

/** One first-parent walk, newest first — a date floor, a range, or the whole chain. */
export function firstParentLog(root, ref, { sinceIso = null, base = null } = {}) {
  const args = ['log', '--first-parent', '--format=%H%x09%cI%x09%s'];
  if (sinceIso) args.push(`--since=${sinceIso}`);
  args.push(base ? `${base}..${ref}` : ref);
  return git(root, args)
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const [sha, date, ...rest] = l.split('\t');
      return { sha, date, subject: rest.join('\t') };
    });
}

/** Has this commit no parent at all? Then a walk that ended on it saw everything. */
function isRootCommit(root, sha) {
  try {
    return git(root, ['rev-list', '--parents', '-n', '1', sha]).trim().split(/\s+/).length === 1;
  } catch {
    return false;
  }
}

/** The topological base for one repo — the pinned/bare ref, resolved HERE, or null. */
export function topologicalBaseIn(root, window, repoId, resolve = (r, s) => git(r, ['rev-parse', '--verify', '--quiet', `${s}^{commit}`]).trim()) {
  if (window.mode !== 'topological') return null;
  const ref = refForRepo(window, repoId);
  if (!ref) return null;
  try {
    const sha = resolve(root, ref);
    return sha ? { ref, sha } : null;
  } catch {
    return null;
  }
}

/**
 * The date window, walked with escalating floors until the anchor is PROVEN —
 * one budget below the boundary (the common case, one walk), then a week, then
 * the whole chain. Only a walk that still ends on the anchor, with a parent
 * below it that was never read, is a WINDOW EDGE.
 */
export function datedWindowCommits(root, ref, window, { log = firstParentLog, isRoot = isRootCommit } = {}) {
  const startMs = Date.parse(window.effectiveIso);
  const budgetMs = Math.max(Number(window.budgetSeconds) || 0, 1) * 1000;
  const floors = [new Date(startMs - budgetMs).toISOString(), new Date(startMs - 7 * 86_400_000).toISOString(), null];
  let picked = null;
  for (const floorIso of floors) {
    const rows = log(root, ref, floorIso ? { sinceIso: floorIso } : {});
    const found = landingWindowFrom(rows, startMs);
    const bottom = rows.length > 0 ? rows[rows.length - 1] : null;
    const atEdge = found.anchorAtEdge && !(floorIso === null && bottom !== null && isRoot(root, bottom.sha));
    picked = { ...found, anchorAtEdge: atEdge, floorIso, walked: rows.length };
    if (!atEdge) break;
  }
  return picked;
}

/**
 * The mainline commits of `ref` inside `window`, newest first — topological
 * where a ref resolves here, the budgeted date window otherwise, and never a
 * bare `--since` cut. `fellBack` names WHY a topological sweep took the date
 * window in this repo, so the report can say it per repo.
 */
export function mainlineCommitsInWindow(root, ref, window, { repoId = null, log = firstParentLog, isRoot = isRootCommit, base = undefined } = {}) {
  const resolved = base === undefined ? topologicalBaseIn(root, window, repoId) : base;
  if (window.mode === 'topological' && resolved) {
    return { commits: log(root, ref, { base: resolved.sha }), mode: 'topological', base: resolved, anchorAtEdge: false, straddlers: [], fellBack: null };
  }
  const fellBack =
    window.mode !== 'topological'
      ? null
      : refForRepo(window, repoId)
        ? `'${refForRepo(window, repoId)}' does not resolve in this checkout`
        : 'no --since-ref names this repo';
  return { ...datedWindowCommits(root, ref, window, { log, isRoot }), mode: 'date', base: null, fellBack };
}

/**
 * The paths a mainline commit changed against its first parent, AND the size
 * of that change — `git diff-tree --numstat` per commit (#19036), where a
 * `--name-only` used to read the paths alone. The path list is the same list
 * byte for byte (the self-test pins it against `--name-only` on a real
 * fixture), read `--no-renames` so a rename names BOTH paths; the size is the
 * LANDED diff's off a second, RENAME-AWARE read (`-M`, #30718), summed by
 * `parseNumstat` exactly as `--branch` sums its range — a moved file counts its
 * content change and a binary row 0 lines, as on GitHub. Two local reads, zero
 * API: the sweep can classify an oversized landing whose paths touch nothing
 * governed without a pull read, which is what lets it list one at all.
 *
 * ⚠️ `-m --first-parent` on purpose, unchanged: a merge commit is read against
 * its first parent, so the whole branch's change is one row, never the
 * per-parent split `-m` alone would print.
 *
 * ⛔ The PATH read is `-z`, one NUL-ended `added<TAB>deleted<TAB>path` record
 * per file (`--no-renames`, so never the three-field rename form): without it
 * git C-quotes a path holding a non-ASCII or control character, and the quoted
 * spelling matches no governed prefix. The SIZE read only sums the two counts,
 * which quoting never touches.
 */
export function commitChanges(root, sha) {
  const out = git(root, ['diff-tree', '-r', '--no-commit-id', '--no-renames', '--numstat', '-z', '-m', '--first-parent', sha]);
  const paths = [];
  for (const record of out.split('\0')) {
    const m = /^(?:\d+|-)\t(?:\d+|-)\t([^]+)$/.exec(record);
    if (m) paths.push(m[1]);
  }
  const sized = git(root, ['diff-tree', '-r', '--no-commit-id', '-M', '--numstat', '-m', '--first-parent', sha]);
  return { paths, size: { ...parseNumstat(sized), source: 'git diff-tree --numstat -M (rename-aware, as GitHub counts) against the first parent' } };
}

/**
 * Is `path` a git checkout, and of what? The real `probe` for
 * resolveRepoCheckouts. The identity read is the DECLARED origin —
 * `git config --get remote.origin.url`, the URL the checkout claims — never
 * `git remote get-url origin`, which applies `url.<base>.insteadOf` rewrites
 * first (measured: with a rewrite in force, `get-url` answers the rewrite
 * target — a filesystem path — while the raw config still names github.com).
 * A transport rewrite is an operator's routing choice; the declared URL is the
 * identity claim this sweep audits under, and `git ls-remote` (#13307) applies
 * the same rewrites itself, so transport stays exactly as git resolves it.
 */
function probeCheckout(path) {
  try {
    git(path, ['rev-parse', '--git-dir']);
  } catch {
    return { exists: false, slug: null, origin: null };
  }
  try {
    const origin = git(path, ['config', '--get', 'remote.origin.url']).trim();
    return { exists: true, slug: slugFromRemote(origin), origin: origin || null };
  } catch {
    return { exists: true, slug: null, origin: null };
  }
}

/**
 * The real remote reading behind `remoteFreshnessVerdict` (#13307): one
 * `git ls-remote` per otherwise-auditable repo. Zero API calls — this is the
 * git wire protocol, not the REST API — and it answers BOTH halves of the
 * question in one round trip: whether the remote resolves at all, and which
 * commit it names on the branch this sweep enumerates.
 *
 * `--exit-code` is not decoration. WITHOUT it, a remote that resolves but
 * carries no such branch exits 0 with EMPTY output, so "reachable, tip
 * unknown" would arrive at the call site wearing the same clothes as success.
 * With it, that answer is a non-zero exit and reaches the verdict as a
 * failure. `GIT_TERMINAL_PROMPT=0` so a credential prompt can never block a
 * sweep, and a timeout so an unresponsive host cannot either — a probe that
 * hangs is a sweep that never reports, which is its own kind of silence.
 */
function probeRemoteTip(root, ref) {
  const parts = remoteRefParts(ref);
  if (!parts) return { reachable: false, sha: null, error: `'${ref}' does not name a remote-tracking ref`, ref, remoteName: null };
  try {
    const out = execFileSync('git', ['ls-remote', '--exit-code', parts.remote, `refs/heads/${parts.branch}`], {
      cwd: root,
      encoding: 'utf8',
      timeout: REMOTE_PROBE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const first = out.split('\n').map((l) => l.trim()).filter((l) => l !== '')[0] ?? '';
    return { reachable: true, sha: first.split(/\s+/)[0] || null, error: null, ref, remoteName: parts.remote };
  } catch (error) {
    // The DIAGNOSIS line, not the last line. git's remote failures end on
    // boilerplate — "Please make sure you have the correct access rights / and
    // the repository exists." — and the tail of that, quoted inside a NOT
    // MEASURED row, reads as an assertion that the repository DOES exist.
    // Measured on this branch's fixture before the fix: the row's reason ended
    // `(and the repository exists.)`. Prefer the first line git marks as the
    // fault; fall back to the first non-empty line, never the last.
    const stderr = String(error?.stderr ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
    const diagnosis = stderr.find((l) => /^(fatal|error|remote):/i.test(l)) ?? stderr[0];
    return {
      reachable: false,
      sha: null,
      error: diagnosis ?? `git ls-remote failed: ${String(error?.message ?? error).split('\n')[0]}`,
      ref,
      remoteName: parts.remote,
    };
  }
}

// ── attribution (the only API surface) ──────────────────────────────────────

function apiContext(env) {
  return { apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '') };
}

/**
 * The channel chain, in try order. Anonymous is ALWAYS present and ALWAYS
 * last — it is what makes the PM container (no usable token) resolvable at
 * all for public repos, and it costs nothing when the token works.
 */
export function attributionChannels(env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || null;
  const channels = [];
  if (token) channels.push({ id: 'env-token', name: 'env token (GITHUB_TOKEN/GH_TOKEN)', headers: { authorization: `Bearer ${token}` } });
  channels.push({ id: 'anonymous', name: 'anonymous REST', headers: {} });
  return channels;
}

/**
 * The node flag that points fetch at the session proxy, and the re-exec guard
 * THIS file sets on the child it re-execs.
 *
 * ⚠️ The guard is a NAME, and it is this file's own. Every instrument in this
 * family sets its own variable, so a plan that reads one hard-coded name
 * answers "already re-armed" for a tool that never re-armed — see the plan
 * below, whose `guard` parameter is what keeps each name to its owner.
 */
export const PROXY_FLAG = '--use-env-proxy';
export const PROXY_REARM_GUARD = 'OS_GOVERNED_MERGES_PROXY_REARMED';

/**
 * Does this run need to be re-executed with `PROXY_FLAG` before it can reach
 * GitHub at all? Pure, so every branch is offline-testable — and the branches
 * are the whole point: a proxied run without the flag reads 401/403 on every
 * channel and looks exactly like a credential problem (#9642).
 *
 * ## The guard is a NAME, and it belongs to the CALLER (#18939, #18989)
 *
 * This plan was also imported by a second PM tool (since deleted), and each of
 * those two tools set its OWN variable on the child it re-execs. While the
 * guard was read from one hard-coded name — this file's — either tool's
 * variable, once inherited by the other, answered "already re-armed" for a run
 * that had never re-armed; the suppressed run then took the bypassed route and
 * answered 401 Bad credentials on every endpoint, `/rate_limit` included. A
 * uniform 401 is a self-consistent story — the credential is dead — and it was
 * read as one for about an hour against a channel that was alive the whole
 * time. `guard` is therefore a parameter: a caller passes the name it actually
 * sets, and only its own guard can stop its own re-exec.
 *
 * And a suppressed run must not be a SILENT one. `rearm: false, hint: false`
 * prints nothing at any consumer, so the suppression left no line anywhere in
 * the run log, which is the whole cost of that chain. The guard branch
 * therefore sets `hint: true` — the branch every consumer prints — and its
 * reason names the variable, the route and the 401 it would be mistaken for. It
 * can only fire on the anomaly: a real re-exec's child carries `PROXY_FLAG` in
 * its `execArgv` and is answered by the branch above, never here.
 *
 * ## ⛔ This is a MIRROR of `check-half-states.mjs`'s plan, and it cannot be an
 *    import — both directions measured
 *
 * The patrol OWNS this decision (that file's `proxyRearmPlan` carries the same
 * branch set and the same `guard` contract). A second implementation forks every
 * future invariant, so the copy is a debt, not a design — but the edge that
 * would retire it deadlocks the process, measured on 2026-09-19 in a throwaway
 * copy of `scripts/`:
 *
 *   + import { proxyRearmPlan } from './check-half-states.mjs';   // module scope
 *     node scripts/pm/check-governed-merges.mjs --test AGENTS.md
 *       -> exit 13, "Detected unsettled top-level await at
 *          check-half-states.mjs:10044" (that file's `GOVERNED_REGISTER`)
 *     control, same argv, no import                -> exit 3, the GOVERNED verdict
 *
 *   + const patrol = await import('./check-half-states.mjs');     // in selfTest()
 *     node scripts/pm/check-governed-merges.mjs --self-test
 *       -> exit 13, unsettled top-level await at THIS file's `await selfTest()`
 *
 * The cycle is real and short: that file resolves its H43 register at module
 * scope with a top-level `await loadGovernedRegister()`, which awaits
 * `import('./check-governed-queue-guard.mjs')`, which imports THIS file at
 * module scope. The lazy door `check-governed-queue-guard.mjs`'s
 * `REVIEW_OF_RECORD_LOCATION` describes was shut here while this file's own
 * dispatch was a module-scope `await`; since #33603 neither dispatch awaits at
 * module scope (the arm leg takes that door). And the reverse edge is
 * barred for a second, independent reason the patrol's own header records: that
 * file TRAVELS — a sibling repo's `scripts/pm/` holds it alone — so it can
 * never statically import the governed pair either.
 *
 * So the mirror stays, and the `--self-test` battery pins it to its OWNER the
 * way the guard's mirror is pinned: by reading that file's SOURCE off disk,
 * plus the REASON — when the patrol's module-scope `await` goes away, the case
 * that fails says to make this a real import.
 *
 * @param {{ env?: Record<string,string|undefined>, execArgv?: string[],
 *           flagSupported?: boolean, guard?: string }} [ctx]
 * @returns {{ rearm: boolean, hint: boolean, flag?: string, guarded?: string, reason: string }}
 */
export function proxyRearmPlan({ env = {}, execArgv = [], flagSupported = true, guard = PROXY_REARM_GUARD } = {}) {
  const proxy = env.HTTPS_PROXY || env.https_proxy || null;
  if (!proxy) return { rearm: false, hint: false, reason: 'no HTTPS_PROXY in the environment — fetch reaches GitHub directly' };
  if (execArgv.includes(PROXY_FLAG) || (env.NODE_OPTIONS ?? '').includes(PROXY_FLAG)) {
    return { rearm: false, hint: false, reason: `already running with ${PROXY_FLAG}` };
  }
  if (env[guard] === '1') {
    return {
      rearm: false,
      hint: true,
      guarded: guard,
      reason:
        `${guard}=1 is set and this process is NOT running with ${PROXY_FLAG}, so the one re-exec this run ` +
        `allows was already spent and every request below bypasses ${proxy} — if they answer 401 Bad credentials, ` +
        `that inherited guard is why, and unsetting ${guard} is the fix rather than a new token`,
    };
  }
  if (!flagSupported) {
    return { rearm: false, hint: true, reason: `this node does not accept ${PROXY_FLAG}; fetch will bypass ${proxy}` };
  }
  return { rearm: true, hint: false, flag: PROXY_FLAG, reason: `HTTPS_PROXY is set (${proxy}) and node's fetch does not read it` };
}

/** One PR read for `merged_by` / `merged_at`, over every channel in turn. */
async function fetchPullAttribution({ apiUrl }, slug, pull, channels) {
  const url = `${apiUrl}/repos/${slug}/pulls/${pull}`;
  const failures = [];
  for (const channel of channels) {
    let res;
    try {
      res = await fetch(url, {
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...channel.headers },
      });
    } catch (error) {
      failures.push(`${channel.name}: request failed (${error?.message ?? error})`);
      continue;
    }
    if (!res.ok) {
      failures.push(`${channel.name}: HTTP ${res.status}`);
      continue;
    }
    const body = await res.json();
    return {
      attribution: {
        mergedBy: body?.merged_by?.login ?? null,
        mergedAt: body?.merged_at ?? null,
        // The commit GitHub says this pull landed as (#33711 S2): the arm leg ties a record's head to the landed
        // commit through it, so a commit that only NAMES the pull in its subject is never excused by its record.
        mergeCommitSha: body?.merge_commit_sha ?? null,
        title: body?.title ?? null,
        // GitHub's own `additions` / `deletions` (#19036), off the read this row
        // already pays for — printed beside the LANDED number when they differ,
        // never the number the listing is decided on (that one is local).
        size: pullSizeFrom(body),
      },
      channel: channel.id,
    };
  }
  return { attribution: null, channel: null, failure: failures.join('; ') };
}

/** One JSON read over one channel, with the `Link` header the walk needs. */
async function fetchJsonOver(fetchImpl, url, channel) {
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...channel.headers },
    });
  } catch (error) {
    return { ok: false, reason: `${channel.name}: request failed (${error?.message ?? error})` };
  }
  if (!res.ok) return { ok: false, reason: `${channel.name}: HTTP ${res.status}` };
  let body;
  try {
    body = await res.json();
  } catch (error) {
    return { ok: false, reason: `${channel.name}: the response was not JSON (${error?.message ?? error})` };
  }
  return { ok: true, body, link: typeof res.headers?.get === 'function' ? res.headers.get('link') : null };
}

/** How many pages the changed-files walk will follow before it refuses. */
export const PULL_FILES_PAGE_CAP = 40;

/**
 * `--pr`'s derivation (#17003): the PR's changed files, over the sweep's own
 * channel chain. `fetchImpl` is injected so `--self-test` pins the page walk,
 * the rename reading and the truncation refusal offline.
 *
 * ⚠️ The channel is chosen ONCE, on the `GET /pulls/{n}` that reads the
 * `changed_files` count, and every page is then read over that same channel. A
 * walk that fell through to the next channel mid-list would be splicing two
 * readings — taken at different instants, possibly at different permissions —
 * into one list and calling it the PR's.
 */
export async function fetchPullFiles({ apiUrl, slug, pull, channels, fetchImpl = fetch, pageCap = PULL_FILES_PAGE_CAP }) {
  const pullUrl = `${apiUrl}/repos/${slug}/pulls/${pull}`;
  const failures = [];
  let chosen = null;
  let head = null;
  for (const channel of channels) {
    const read = await fetchJsonOver(fetchImpl, pullUrl, channel);
    if (read.ok) {
      chosen = channel;
      head = read.body;
      break;
    }
    failures.push(read.reason);
  }
  if (!chosen) {
    return {
      ok: false,
      reason: `no channel could read ${slug}#${pull} — channels tried: ${failures.join('; ')}.`,
      remedy: 'Derive the list from a local checkout instead: `--branch <ref>`. It needs no network at all.',
    };
  }
  const changedFiles = typeof head?.changed_files === 'number' ? head.changed_files : null;
  // The SIZE limb (2026-09-18 ruling) rides the same read as the count. A PR
  // object without the pair is a refusal here, before a page is spent: an
  // unanswered size is never a size of zero and never a "not governed" answer.
  const pair = pullSizeFrom(head);
  if (pair === null) {
    return {
      ok: false,
      reason:
        `${slug}#${pull} reports no \`additions\` / \`deletions\` pair (got ${JSON.stringify(head?.additions ?? null)} / ` +
        `${JSON.stringify(head?.deletions ?? null)}), so the size predicate cannot be answered — and an unanswered size ` +
        `is a REFUSAL, never a size of zero and never a "not governed" answer.`,
      remedy: 'Re-run; if the API keeps omitting the pair, read the branch locally: `--branch <ref>` counts the same range with `git diff --numstat`.',
    };
  }
  const size = { ...pair, source: `GET /repos/${slug}/pulls/${pull}` };
  // The FORK limb + the head's check-run count ride this read (header section "The FORK predicate"): one more GET, same channel.
  const fork = forkVerdict(head);
  const sha = typeof head?.head?.sha === 'string' ? head.head.sha : null;
  const checksRead = sha ? await fetchJsonOver(fetchImpl, `${apiUrl}/repos/${slug}/commits/${sha}/check-runs?per_page=1`, chosen) : null;
  const checks = checksRead?.ok && Number.isInteger(checksRead.body?.total_count) ? { sha, total: checksRead.body.total_count, reason: null }
    : { sha, total: null, reason: !sha ? 'the PR object carries no head sha' : checksRead.ok ? 'the check-runs answer carries no total_count' : checksRead.reason };

  const files = [];
  let pages = 0;
  let next = `${pullUrl}/files?per_page=100`;
  while (next && pages < pageCap) {
    const read = await fetchJsonOver(fetchImpl, next, chosen);
    if (!read.ok) {
      return {
        ok: false,
        reason: `page ${pages + 1} of ${slug}#${pull}'s changed files did not read — ${read.reason}.`,
        remedy: 'A partial list is a SUBSET, and a subset can hide a governed hit. Re-run, or use `--branch <ref>`.',
      };
    }
    if (!Array.isArray(read.body)) {
      return { ok: false, reason: `page ${pages + 1} of ${slug}#${pull}'s changed files answered no list.`, remedy: null };
    }
    files.push(...read.body);
    pages += 1;
    next = linkNext(read.link);
  }
  const truncation = pullTruncationReason({
    collected: files.length,
    changedFiles,
    pages,
    pageCap,
    morePages: Boolean(next) && pages >= pageCap,
  });
  if (truncation) {
    return {
      ok: false,
      reason: truncation,
      remedy: 'Derive the list from a local checkout instead: `--branch <ref>`, which reads the whole diff at once.',
    };
  }
  const { paths, renames, entries } = pullPathsFrom(files);
  return {
    // Each file's status (#33501's arm: only a MODIFIED catalog file is wording); `--pr` adds the modes.
    catalogStatuses: pullCatalogStatuses(files),
    ok: true,
    paths,
    size,
    fork,
    checks,
    // The low-risk skills arm's reading (#33501), off the SAME pull object and file walk, plus the timeline
    // over the same channel — read only when a path sits under an arm row, so no other `--pr` pays for it.
    lowRisk: pullLowRiskReading(head, paths, {
      timeline: lowRiskRowHit(paths) ? await fetchTimelineOver({ fetchImpl, url: `${apiUrl}/repos/${slug}/issues/${pull}/timeline`, channel: chosen, pageCap }) : null,
    }),
    // What the arm's record stage derives the card from (`pullRecordStage`): the body and the head branch.
    pullHead: { number: pull, body: typeof head?.body === 'string' ? head.body : '', head: { ref: typeof head?.head?.ref === 'string' ? head.head.ref : null } },
    derivation: {
      kind: 'pull',
      slug,
      pull,
      headSha: sha,
      baseSha: typeof head?.base?.sha === 'string' ? head.base.sha : null,
      baseRef: typeof head?.base?.ref === 'string' && head.base.ref !== '' ? head.base.ref : null,
      endpoint: `/repos/${slug}/pulls/${pull}/files`,
      channel: chosen.id,
      pages,
      entries,
      count: paths.length,
      renames,
      size,
    },
  };
}

/**
 * The low-risk skills arm's reading off a PR object and its WHOLE changed-path
 * list (`lowRiskArmVerdict`). Pure. Labels the object does not carry as a list
 * read `null`, which the arm reads as H; a body that is not a string reads as
 * an empty body, which declares nothing and is H too. The fork predicate is
 * read off the same object; the timeline and the changesets arrive as their own
 * readings, and one not handed in is NOT MEASURED, so H. The record stage
 * (`record`, `cardLabels`) is the caller's second read: see `lowRiskArmVerdict`.
 */
export function pullLowRiskReading(head, paths, { timeline = null, changesets = null, catalogFiles = null, record = null, cardLabels = null } = {}) {
  const labels = Array.isArray(head?.labels) ? head.labels.map((l) => (typeof l === 'string' ? l : String(l?.name ?? ''))) : null;
  return {
    // The record stage (`lowRiskRecordStageReasons`), carried only when a caller read it: left out, the arm
    // answers `pending` once the pull-read conjuncts hold, and the caller reads the stage and asks again.
    ...(record == null ? {} : { record }),
    ...(cardLabels == null ? {} : { cardLabels }),
    measured: true,
    reason: null,
    paths: Array.isArray(paths) ? [...paths] : [],
    body: typeof head?.body === 'string' ? head.body : '',
    labels,
    fork: forkVerdict(head),
    timeline: timeline ?? { measured: false, reason: 'the timeline was not read', events: null },
    changesets: changesets ?? { measured: false, reason: 'the changesets were not read at the head', files: [] },
    catalogFiles: catalogFiles ?? { measured: false, reason: 'the status and mode of the changed files were not read', files: [] },
  };
}

/**
 * Each changed file's STATUS off the API's file walk (`added`, `removed`,
 * `modified`, `renamed`, ...). A rename's old name is carried as `renamed`;
 * any other row's `previous_filename` (a copy's source) as `<status> source`,
 * never `modified`, so it reads H. Pure; the modes are not on the API row, so
 * `pullCatalogReading` reads them.
 */
export function pullCatalogStatuses(files) {
  const out = [];
  for (const file of Array.isArray(files) ? files : []) {
    const status = typeof file?.status === 'string' ? file.status : '';
    if (typeof file?.filename === 'string' && file.filename !== '') out.push({ path: file.filename, status });
    if (typeof file?.previous_filename === 'string' && file.previous_filename !== '') out.push({ path: file.previous_filename, status: status === 'renamed' ? 'renamed' : `${status || 'unread'} source` });
  }
  return out;
}

/**
 * `--pr`'s status-and-mode reading for the arm: the API's status per path, and
 * the mode of each modified catalog path at the merge base (`oldMode`) and at
 * the PR's head (`mode`) from THIS checkout (`git ls-tree`) — the API's status
 * alone cannot tell a symlink replaced by a regular file from an edit. No
 * statuses, a head or base not here, or no merge base is NOT MEASURED (Tier H).
 */
export function pullCatalogReading({ derivation, statuses, paths, sameCheckout, run }) {
  const unmeasured = (reason) => ({ measured: false, reason, files: [] });
  if (!Array.isArray(statuses)) return unmeasured('the file walk carried no status per file');
  const headSha = derivation?.headSha;
  const baseSha = derivation?.baseSha;
  if (!sameCheckout) return unmeasured('the PR is not in the repository this checkout holds, so its file modes cannot be read here');
  if (!isObjectId(headSha) || !isObjectId(baseSha)) return unmeasured('the PR object named no head or base commit');
  const missing = [headSha, baseSha].filter((sha) => !run(['cat-file', '-e', `${sha}^{commit}`]).ok);
  if (missing.length > 0) return unmeasured(`${missing.map((sha) => sha.slice(0, 10)).join(' and ')} not in this checkout — ${pullFetchHint(derivation, missing)}`);
  const mergeBase = run(['merge-base', baseSha, headSha]);
  if (!mergeBase.ok || !isObjectId(mergeBase.out)) return unmeasured('no merge base of the PR head and its base could be computed here (a shallow clone?)');
  const modeAt = (sha, path) => {
    const tree = run(['ls-tree', sha, '--', path]);
    return tree.ok ? (/^(\d{6}) /.exec(tree.out)?.[1] ?? null) : null;
  };
  const wanted = new Set((Array.isArray(paths) ? paths : []).filter((p) => GOVERNED_SURFACES.some((s) => s.lowRisk && p.startsWith(s.prefix))));
  // The ADR leg (#33539): a modified file under an add-only row carries its diff, merge base to head, at full context.
  const addOnly = (p) => GOVERNED_SURFACES.some((s) => s.lowRisk?.addOnly === true && p.startsWith(s.prefix));
  const files = statuses.filter((f) => wanted.has(f.path)).map((f) => {
    if (f.status !== 'modified') return { ...f, oldMode: null, mode: null };
    const row = { ...f, oldMode: modeAt(mergeBase.out, f.path), mode: modeAt(headSha, f.path) };
    if (!addOnly(f.path)) return row;
    const diff = run(addOnlyDiffArgv(['diff'], [mergeBase.out, headSha], f.path));
    return { ...row, patch: diff.ok ? diff.out : null };
  });
  return { measured: true, reason: null, files };
}

/**
 * The fetch that brings a PR's missing commits into this checkout: the head by
 * `pull/N/head`, the base by the PR's own base ref — never an assumed `main`,
 * since a PR can target any branch — or by its sha when the ref was not read.
 * Pure.
 */
export function pullFetchHint(derivation, missing) {
  const want = new Set(Array.isArray(missing) ? missing : []);
  const refs = [
    want.has(derivation?.headSha) ? `pull/${derivation?.pull}/head` : null,
    want.has(derivation?.baseSha) ? (derivation?.baseRef ?? derivation?.baseSha) : null,
  ].filter(Boolean);
  return `\`git fetch origin ${refs.join(' ')}\``;
}

/** Does any of these paths sit under a register row that carries the low-risk arm? Pure. */
export function lowRiskRowHit(paths) {
  const list = Array.isArray(paths) ? paths : [];
  return GOVERNED_SURFACES.some((s) => s.lowRisk && list.some((p) => typeof p === 'string' && p.startsWith(s.prefix)));
}

/**
 * The PR's issue timeline over the channel that read the PR, every page or NOT
 * MEASURED: the event the arm looks for (a removed `security` label) can sit on
 * any page, so a cut list is no reading.
 */
export async function fetchTimelineOver({ fetchImpl, url, channel, pageCap = PULL_FILES_PAGE_CAP }) {
  const events = [];
  let pages = 0;
  let next = `${url}?per_page=100`;
  while (next && pages < pageCap) {
    const read = await fetchJsonOver(fetchImpl, next, channel);
    if (!read.ok) return { measured: false, reason: `page ${pages + 1} of the timeline did not read — ${read.reason}`, events: null };
    if (!Array.isArray(read.body)) return { measured: false, reason: `page ${pages + 1} of the timeline answered no list`, events: null };
    events.push(...read.body);
    pages += 1;
    next = linkNext(read.link);
  }
  if (next) return { measured: false, reason: `the timeline runs past ${pageCap} page(s)`, events: null };
  return { measured: true, reason: null, events };
}

/**
 * `--pr`'s read of the arm's RECORD STAGE (`lowRiskArmVerdict`), taken SECOND and only when the first read left it
 * `pending` — every pull-read condition holds — so no other `--pr` pays for it. ⭐ ONE reader: the queue guard's own
 * `readLowRiskRecordStage` (the card it derives, the threads cut to trusted authors, `lowRiskRecordStage`,
 * `readCardLabels`), loaded lazily (`loadArmReaders`), so `--pr` cannot read a record differently from the queue.
 * `fetchers` are `{ fetchComments, fetchLabels, fetchTimeline }` over the channel that read the PR; `runGit` re-tests
 * a carried record and is null when the PR is not in this checkout, which refuses the carry.
 * ⛔ Readers that did not load are NOT MEASURED, so Tier H — never a stand-in and never `no`.
 * Returns the reading with `record` and `cardLabels` added, or the reading AS IS when the stage is not pending.
 */
export async function pullRecordStage({ lowRisk, paths, repo, workflowDiff = null, pullHead, derivation, readers, fetchers = {}, runGit = null }) {
  if (!lowRisk) return lowRisk;
  const surfaces = applyLowRiskArm(applyWorkflowSplit(governedPathsIn(paths, repo), repo, workflowDiff), repo, lowRisk);
  if (!surfaces.some((s) => s?.lowRiskVerdict?.recordStage === LOW_RISK_RECORD_STAGE.pending)) return lowRisk;
  const loaded = typeof readers === 'function' ? await readers() : readers;
  if (loaded?.available !== true) {
    const reason = loaded?.reason ?? 'the queue guard readers were not loaded';
    return { ...lowRisk, record: { measured: false, reason }, cardLabels: { measured: false, reason: `not read: ${reason}` } };
  }
  const built = typeof fetchers === 'function' ? fetchers(loaded.guard) : fetchers;
  const stage = await loaded.guard.readLowRiskRecordStage({
    pr: derivation?.pull ?? pullHead?.number ?? null,
    pull: pullHead ?? null,
    headSha: derivation?.headSha ?? null,
    paths,
    repo,
    runGit,
    baseRef: derivation?.baseSha ?? null,
    recognisers: loaded.recognisers,
    fetchComments: built?.fetchComments ?? null,
    fetchLabels: built?.fetchLabels ?? null,
    fetchTimeline: built?.fetchTimeline ?? null,
  });
  return { ...lowRisk, record: stage.record, cardLabels: stage.cardLabels };
}

/**
 * `--pr`'s changeset reading for the arm: each `.changeset/*.md` the PR changes,
 * read at the PR's own head from THIS checkout. Anything short of that is NOT
 * MEASURED (Tier H) naming the fetch that cures it. A path that does not read at
 * the head (a deleted changeset) is carried with no text, which the arm reads as H.
 */
export function pullChangesetReading({ derivation, paths, sameCheckout, run }) {
  const unmeasured = (reason) => ({ measured: false, reason, files: [] });
  const headSha = derivation?.headSha;
  if (!sameCheckout) return unmeasured('the PR is not in the repository this checkout holds, so its head cannot be read here');
  if (!isObjectId(headSha)) return unmeasured('the PR object named no head commit');
  if (!run(['cat-file', '-e', `${headSha}^{commit}`]).ok) return unmeasured(`${headSha.slice(0, 10)} is not in this checkout — \`git fetch origin pull/${derivation.pull}/head\``);
  const files = (Array.isArray(paths) ? paths : []).filter((p) => LOW_RISK_CHANGESET_PATH.test(p)).map((path) => {
    const read = run(['show', `${headSha}:${path}`]);
    return { path, text: read.ok ? read.out : null };
  });
  return { measured: true, reason: null, files };
}

/**
 * The `additions` / `deletions` pair off a PR object, or null when the object
 * does not carry both as non-negative integers. Pure; null is the caller's
 * refusal, never a zero.
 */
export function pullSizeFrom(head) {
  const additions = head?.additions;
  const deletions = head?.deletions;
  if (!Number.isInteger(additions) || additions < 0 || !Number.isInteger(deletions) || deletions < 0) return null;
  return { additions, deletions };
}

/**
 * The arm leg (#33603): a skills landing the low-risk arm put at Tier S is a SEAT landing, listed apart from the
 * maintainer's merges, and it stands only on a same-head at-tier PASS record. ⭐ ONE reader: the queue guard's own
 * functions, run on the landed commit — the commit the merge group judged — so the audit cannot read a landing
 * differently from the queue that let it in: `decomposeGovernedWork` → `readLowRiskTier` (the register's
 * `lowRiskArmVerdict`) → `landsOnLowRiskArm`, then `recordVerdict` → `lowRiskRecordVerdict`. Imported LAZILY: the
 * guard imports this file at module scope, which is why neither dispatch below awaits at module scope.
 */
export const ARM_READER_SOURCE = './check-governed-queue-guard.mjs';

/** The guard exports the arm leg reads with. A missing one is NOT MEASURED, never a second parser here. */
export const ARM_READER_EXPORTS = Object.freeze(['decomposeGovernedWork', 'readLowRiskTier', 'landsOnLowRiskArm', 'recordAuthorTrusted', 'ignoredAuthorLines', 'authorizedApprovalVerdict', 'enqueuerFromTimeline', 'authorizedEnqueueVerdict', 'loadRecordRecognisers', 'recordVerdict', 'lowRiskRecordVerdict', 'lowRiskRecordStagePending', 'lowRiskRecordStage', 'readCardLabels', 'namedCardsOf', 'readLowRiskRecordStage', 'makePullReader', 'makeReviewReader', 'makeCommentReader', 'makeTimelineReader', 'makeLabelReader']);

/** Load the guard's readers and the record recognisers once per run. Never throws: a failed load is the reason. */
export async function loadArmReaders(load = (specifier) => import(specifier)) {
  try {
    const guard = await load(ARM_READER_SOURCE);
    const missing = ARM_READER_EXPORTS.filter((name) => typeof guard?.[name] !== 'function');
    if (missing.length > 0) return { available: false, reason: `${ARM_READER_SOURCE} loaded without ${missing.join(', ')} — follow the rename, never restate the reader here` };
    return { available: true, guard, recognisers: await guard.loadRecordRecognisers() };
  } catch (error) {
    return { available: false, reason: `${ARM_READER_SOURCE} would not load: ${String(error?.message ?? error).split('\n')[0]}` };
  }
}

/**
 * One governed entry's arm reading, or null when no catalog row was hit or no PR names it. `paths` is every path
 * of the landed commit; `fetchers` are `{ fetchPull, fetchReviews, fetchTimeline, fetchComments }` (the guard's
 * readers); `attribution` is the row's pull read (`mergedAt`, `mergeCommitSha`), or null when it failed.
 * ⭐ The legs run in the guard's own order (`entrySatisfied`): an authorized approval, then an authorized enqueue,
 * then the record — so an entry the maintainer cleared is the maintainer's merge, never a seat's BREACH (#33711 S1).
 * Each leg reads only what existed before the landing: reviews and timeline events strictly before `merged_at`
 * (the queue's `removed_from_merge_queue` shares the merge's instant, measured on #33555, #33632 and #33616), and
 * comments by an author the guard trusts (`recordAuthorTrusted`, #33711 S3), created AND last edited at or before
 * it (#33711 N4). The record's head is the landed commit's only
 * when GitHub's `merge_commit_sha` is that commit (#33711 S2).
 * #33729: a review dismissed AFTER the landing is read in the state it had when the queue read it (the timeline's
 * `review_dismissed` event names it, N8); a git read the arm needed that failed, or a fork predicate not measured, is
 * `not-measured`, never `tier-h` (N5); a trusted comment edited after the landing is named only when it is the row
 * the record leg would have read had it not been edited, on every BREACH reason (N9, N10); a recogniser set with no
 * trusted-author list is `not-measured` (N11), and the comments the author binding dropped are counted in the
 * guard's own words (`ignoredAuthorLines`, N11).
 * #33765: an unread labels list is unread too (N-b), and a Tier H the measured inputs settle alone stays `tier-h`
 * with its unread inputs named (N-a, `armSettledWithoutUnread`); an edited `Regen-provenance:` hop is named (N-e).
 * The carry test's `baseRef` is the landed commit's first parent (N6): between it and the merge group's base lie
 * only the squash commits of entries ahead in the same group, which no queued head contains, so `git merge-base`
 * of either base with a head names the same commit and the carry reads the same.
 * The arm's RECORD STAGE is read as the queue reads it, SECOND and only for an entry nothing else cleared: the first
 * arm read leaves it pending (`lowRiskRecordStagePending`) when every pull-read condition holds, and a first read
 * that is not pending is Tier H on a pull-read reason. Past the approval and enqueue legs, a record that stands and
 * reads PASS must also carry the arm's line and every card it names be free of the `security` label AS THEY STOOD AT
 * THE LANDING: the line off the same as-landed rows (`lowRiskRecordStage`), each card's labels rebuilt from its timeline
 * (`cardLabelsAsLanded`; `fetchers.fetchLabels` reads them, absent ⇒ `not-measured`). A stage that then reads Tier H
 * is a `breach` flagged `stage: true` — the queue would have refused that landing — and a stage that could not be
 * read is `not-measured`, ⛔ never `tier-h` and never a stand-in. The stage is read only for a landing whose own tree
 * carries it (`armRecordStageBound`): an earlier landing is a `pass` on its record alone, flagged `stageBound: false`.
 * States: `pass` (an arm landing on a same-head at-tier PASS record whose record stage holds), `breach` (an arm
 * landing without one, on a record stage at Tier H, or whose pull did not land as this commit), `cleared` (the
 * arm's pull-read conditions held, but an authorized approval or enqueue cleared it before the record was read: the
 * maintainer's merge), `tier-h` (the arm read H on what the pull shows: the maintainer's merge), `not-measured`
 * (a read failed: listed with the maintainer's merges, and the sweep is INCOMPLETE). Never throws.
 */
export async function readArmLanding(entry, { paths, repo, readers, fetchers, runGit, attribution = null }) {
  if (!entry || entry.pr == null || !(entry.surfaces ?? []).some((s) => s?.lowRiskVerdict)) return null;
  const why = (error) => String(error?.message ?? error).split('\n')[0];
  let headSha = null;
  const unmeasured = (reason) => ({ state: 'not-measured', reason, headSha });
  if (readers?.available !== true) return unmeasured(readers?.reason ?? 'the queue guard readers were not loaded');
  const { guard, recognisers } = readers;
  const [work] = guard.decomposeGovernedWork([{ pr: entry.pr, sha: entry.sha, subject: entry.subject, paths }], repo).governed;
  if (!work) return null;
  let pull;
  let events;
  try {
    pull = await fetchers.fetchPull(entry.pr);
    headSha = pull.sha;
    events = await fetchers.fetchTimeline(entry.pr);
  } catch (error) {
    return unmeasured(`${pull ? 'its timeline' : 'its pull request'} could not be read (${why(error)})`);
  }
  const head = { number: entry.pr, body: pull.body, labels: pull.labels, fork: pull.fork, head: { ref: pull.headRef } };
  // N5: every git read the arm takes is recorded when it throws. The guard folds such a read into Tier H with a
  // reason (fail closed in the queue), but here an H read on a failed read cannot say whether the queue read S.
  const gitFailures = [];
  const armGit = (argv) => {
    try {
      return runGit(argv);
    } catch (error) {
      gitFailures.push({ argv, why: why(error) });
      throw error;
    }
  };
  guard.readLowRiskTier(work, repo, head, { timeline: { measured: true, reason: null, events }, runGit: armGit });
  // ⭐ The first read hands in no record stage, so it never reads Tier S: `pending` says every pull-read condition
  // holds, and anything else is Tier H on what the pull shows — the branch below, unchanged by the record stage.
  if (!guard.lowRiskRecordStagePending(work)) {
    const reasons = work.surfaces.find((s) => s?.lowRiskVerdict)?.lowRiskVerdict?.reasons ?? [];
    // #33765 N-b: an unread labels list is an unread input too, though no git read failed.
    const inputs = armUnreadInputs(gitFailures, pull.fork, runGit, pull.labels);
    if (inputs.length > 0) {
      const unread = inputs.map((u) => u.words);
      // #33765 N-a: a reason the measured inputs give on their own settles Tier H whatever the unread ones say.
      const settled = armSettledWithoutUnread({ guard, entry, paths, repo, head, events, runGit, inputs });
      if (settled) return { state: 'tier-h', headSha, reasons: settled, unread };
      return unmeasured(`the low-risk arm could not read ${unread.join('; ')}, so its Tier H cannot say how the queue read it (arm: ${reasons.join('; ') || 'no reason recorded'})`);
    }
    return { state: 'tier-h', headSha, reasons };
  }
  if (sizeLimbFires(entry.size)) return { state: 'tier-h', headSha, reasons: [`the landed diff crosses the ${HUMAN_MERGE_LINE_THRESHOLD}-line human-merge line`] };
  // S2: the record's head is tied to THIS commit only through the pull's own merge. A pull GitHub says is not
  // merged, or merged as another commit, cannot excuse this one: never `pass`.
  if (!attribution) return unmeasured('its merge could not be read, so no record can be tied to this commit');
  const landed = Date.parse(attribution.mergedAt ?? '');
  if (attribution.mergedAt == null || Number.isNaN(landed)) {
    return { state: 'breach', headSha, reason: `#${entry.pr} is not merged (no \`merged_at\`), so no record on it covers this commit` };
  }
  const merged = String(attribution.mergeCommitSha ?? '').toLowerCase();
  if (merged !== String(entry.sha ?? '').toLowerCase()) {
    return { state: 'breach', headSha, reason: `#${entry.pr} landed as ${merged ? merged.slice(0, 12) : '(no merge_commit_sha)'}, not as this commit, so its record does not cover it` };
  }
  const before = (at) => Date.parse(at ?? '') < landed;
  // S1, the approval leg then the enqueue leg, each as the queue read them before the merge.
  let reviews;
  try {
    reviews = await fetchers.fetchReviews(entry.pr);
  } catch (error) {
    return unmeasured(`its reviews could not be read (${why(error)})`);
  }
  const approval = guard.authorizedApprovalVerdict(reviewsAsLanded(reviews.filter((r) => before(r?.submitted_at)), events, landed), headSha);
  if (approval.state === 'approved') return { state: 'cleared', by: 'review', who: approval.approvers, headSha };
  const enqueue = guard.authorizedEnqueueVerdict(guard.enqueuerFromTimeline(events.filter((e) => before(e?.created_at))));
  if (enqueue.state === 'authorized') return { state: 'cleared', by: 'enqueue', who: [enqueue.login], headSha };
  if (recognisers?.available !== true) return unmeasured(recognisers?.reason ?? 'the record recognisers were not loaded');
  // N11: no trusted-author list is a reading that is missing, not a thread with no record in it. Defensive only
  // (#33765 N-c): the guard's `loadRecordRecognisers` answers `available: false` rather than a set without the
  // list, and a list it builds always holds the relay's login, so only a hand-built recogniser set reaches here.
  if (!Array.isArray(recognisers.trustedAuthors) || recognisers.trustedAuthors.length === 0) {
    return unmeasured('the record recognisers carry no trusted-author list, so no comment can be read as a record');
  }
  const card = recognisers.deliveredCard(head);
  let baseRef = null;
  try {
    baseRef = String(runGit(['rev-parse', '--verify', `${entry.sha}^1`])).trim() || null;
  } catch { /* a carried record then reads unreadable, never stands */ }
  const pair = { pr: entry.pr, card: card.card, headSha, runGit, baseRef, paths: work.paths, repo };
  // The same threads with the rows edited after the landing put back: what the record leg would have read had
  // nobody edited them. Only ever read to NAME a dropped row (N9, N10), never to decide a state.
  const unedited = { ...pair };
  const editedAfter = new Map();
  const ignoredAuthors = [];
  for (const thread of recognisers.threads) {
    const number = pair[thread.number];
    try {
      const rows = number === null || number === undefined ? [] : await fetchers.fetchComments(number);
      // The guard's AUTHOR binding (#33687, #33711 S3) first: a row its author does not earn is dropped, as the queue
      // drops it, so it can neither be the record nor shadow one. Then a row counts only when it existed, unedited
      // since, when the commit landed; a missing time never counts. A trusted row edited after it is noted (N7).
      const existedAt = (r) => Date.parse(r?.created_at ?? '') <= landed;
      const trusted = rows.filter((r) => guard.recordAuthorTrusted(r, recognisers.trustedAuthors));
      for (const r of rows) if (!trusted.includes(r) && existedAt(r)) ignoredAuthors.push(String(r?.user?.login ?? '(unreadable author)'));
      const existed = trusted.filter(existedAt);
      pair[thread.rows] = existed.filter((r) => Date.parse(r?.updated_at ?? r?.created_at ?? '') <= landed);
      unedited[thread.rows] = existed;
      for (const r of existed) if (!pair[thread.rows].includes(r) && r?.id != null) editedAfter.set(r.id, `${thread.where} comment ${r.id}`);
    } catch (error) {
      return unmeasured(`${thread.where} #${number}'s comment thread could not be read (${why(error)})`);
    }
  }
  const cardNote = card.card === null ? `no card thread searched — ${card.reason}` : `card #${card.card}`;
  const record = guard.lowRiskRecordVerdict(guard.recordVerdict({ pair, recognisers, cardNote }), pair, recognisers);
  if (record.state === 'unreadable') return unmeasured(record.reason);
  const found = { where: record.where ?? null, id: record.id ?? null, at: record.at ?? null, cardNote };
  const ignored = guard.ignoredAuthorLines({ ignoredAuthors }).map((line) => line.trim());
  if (record.state === 'stands') {
    // The stage binds a landing only when the queue that judged it ran it (`armRecordStageBound`): a landing whose
    // own tree predates the stage stood on its record alone, as its queue read it, and nothing below is read for it.
    const bound = armRecordStageBound(runGit, entry.sha);
    if (bound === null) return unmeasured(`its landed tree's \`${ARM_RULE_PATH}\` could not be read, so whether the queue read the record stage for it is not known`);
    if (bound === false) return { state: 'pass', headSha, record: found, stageBound: false, ...(ignored.length > 0 ? { ignored } : {}) };
    // ⭐ The arm's record stage, as the queue read it: the line off the rows that existed, unedited, at the landing,
    // and the labels of every card it names as they stood then. ⛔ Anything unread is NOT MEASURED — never a stand-in, never `no`.
    const stage = guard.lowRiskRecordStage({ pair, recognisers });
    if (stage.measured !== true) return unmeasured(`its record's \`${LOW_RISK_RECORD_LINE.split(':')[0]}:\` line could not be read (${stage.reason})`);
    const carded = await guard.readCardLabels({ card, named: guard.namedCardsOf(recognisers, head), fetchLabels: fetchers.fetchLabels, fetchTimeline: fetchers.fetchTimeline });
    const named = card.card !== null && card.card !== undefined;
    if (named && (carded.reading.measured !== true || carded.reading.timeline?.measured !== true)) {
      return unmeasured(`the labels of its card #${card.card} could not be read as they stood at the landing (${carded.reading.reason ?? carded.reading.timeline?.reason ?? 'no reading'})`);
    }
    // Every other card the pull names is read the same way: one that was not read, or whose timeline was not,
    // cannot be rebuilt as it stood at the landing — NOT MEASURED, never a BREACH on what it shows today.
    // ⛔ More cards than the leg reads (`overLimit`) is no failed read: the queue counted the same names and
    // refused the landing, so the conjunct below judges it — a stage BREACH.
    const others = named ? carded.reading.others : null;
    if (named && (!others || others.measured !== true || !Array.isArray(others.cards))) {
      if (others?.overLimit !== true) return unmeasured(`the other cards it names could not be read as they stood at the landing (${others?.reason ?? 'no reading'})`);
    } else if (named) {
      const unread = others.cards.find((o) => o?.measured !== true || o?.timeline?.measured !== true);
      if (unread) return unmeasured(`the labels of card #${unread?.card ?? '(no number)'}, which it also names, could not be read as they stood at the landing (${unread?.reason ?? unread?.timeline?.reason ?? 'no reading'})`);
    }
    const cardLabels = named ? cardLabelsAsLanded(carded.reading, landed) : carded.reading;
    guard.readLowRiskTier(work, repo, head, { timeline: { measured: true, reason: null, events }, runGit: armGit, record: stage, cardLabels });
    if (guard.landsOnLowRiskArm(work)) return { state: 'pass', headSha, record: found, ...(ignored.length > 0 ? { ignored } : {}) };
    // A git read that failed on this second pass is an unread input, not a reason the queue had.
    if (gitFailures.length > 0) return unmeasured(`the low-risk arm could not re-read ${gitFailures.map((f) => `\`git ${(f.argv ?? []).slice(0, 2).join(' ')}\` (${f.why})`).join('; ')} for its record stage`);
    const stageReasons = work.surfaces.find((s) => s?.lowRiskVerdict)?.lowRiskVerdict?.reasons ?? [];
    return { state: 'breach', stage: true, headSha, reason: stageReasons.join('; ') || 'no reason recorded', record: found, ...(ignored.length > 0 ? { ignored } : {}) };
  }
  // N9, N10: the edit is named on every BREACH reason, and only for the row the record leg would have read.
  let edited = '';
  if (editedAfter.size > 0) {
    try {
      const would = guard.recordVerdict({ pair: unedited, recognisers, cardNote });
      if (would?.id != null && editedAfter.has(would.id)) edited = `; ${editedAfter.get(would.id)} was edited after the landing, so it does not count (it is the record this leg would otherwise have read)`;
      // #33765 N-e: a record the unedited threads reach through a carry also rests on its `Regen-provenance:` hops.
      // An edited row is named when leaving it out of the unedited threads changes what the leg would have read.
      if (would?.carriedFrom) {
        const same = (v) => v?.state === would.state && v?.id === would.id && v?.carriedFrom === would.carriedFrom;
        for (const [id, where] of editedAfter) {
          if (id === would.id) continue;
          const without = { ...unedited };
          for (const thread of recognisers.threads) if (Array.isArray(without[thread.rows])) without[thread.rows] = without[thread.rows].filter((r) => r?.id !== id);
          if (!same(guard.recordVerdict({ pair: without, recognisers, cardNote }))) edited += `; ${where} was edited after the landing, so it does not count (it is a \`Regen-provenance:\` hop of the carry this leg would otherwise have read)`;
        }
      }
    } catch { /* a name only; the BREACH stands without it */ }
  }
  const reason = (record.state === 'absent' ? `no \`## Contract review\` record on its head (${record.readSummary})`
    : record.state === 'below-tier' ? 'its record does not stand at the tier its face owes'
      : record.state === 'unsigned' ? 'its record names no reviewer'
        : `its record does not read PASS (${record.verdictReason ?? record.state})`) + edited;
  return { state: 'breach', headSha, reason, record: found, ...(ignored.length > 0 ? { ignored } : {}) };
}

/** This file, as a tree names it: where a landed commit keeps the rule its queue ran. */
export const ARM_RULE_PATH = 'scripts/pm/check-governed-merges.mjs';

/** The record stage's own declaration, at a line start: a tree whose copy of this file has it ran the stage. */
export const LOW_RISK_RECORD_STAGE_DECLARED = /^export const LOW_RISK_RECORD_STAGE = /m;

/**
 * Did the queue that judged this landing read the arm's record stage? The queue leg runs this file from the merge
 * group's own tree (`governed-surface-guard.yml` checks out the `merge_group` ref itself), and a queue landing IS
 * that merge-group commit, so the rule its queue applied is the one in the landed commit's tree: the stage bound the
 * landing exactly when that tree's copy of this file declares it (`LOW_RISK_RECORD_STAGE_DECLARED`).
 * ⛔ Without this read the first sweeps after the stage lands would read every earlier arm landing — whose record
 * could not carry a line no template printed yet — as a stage BREACH, and file it as an incident.
 * `true` bound, `false` the tree predates the stage, `null` the tree could not be read: NOT MEASURED, never a guess.
 * `cat-file`, never `show`: `show` is the spelling the arm's own reads take (`ARM_CHANGESET_SHOW`), and this read
 * is the sweep's, not the arm's — it is never stood in for and never counted among the arm's unread inputs.
 */
export function armRecordStageBound(runGit, sha) {
  try {
    return LOW_RISK_RECORD_STAGE_DECLARED.test(String(runGit(['cat-file', '-p', `${sha}:${ARM_RULE_PATH}`])));
  } catch {
    return null;
  }
}

/**
 * A card's labels as they stood when the commit landed, for the arm's record stage: the reading `readCardLabels`
 * took NOW, rebuilt from the card's own timeline. Only `security` is rebuilt, the one label the arm reads:
 *   - its `labeled` / `unlabeled` events before the landing are kept as the timeline (so one removed before the
 *     landing reads as removed), and the newest of them says whether the card carried it at the landing;
 *   - with no such event before the landing, the card carried it then only if it carries it now and no `labeled`
 *     event at or after the landing explains that — a label with no event behind it is read as already there.
 * An event with no readable time is read as before the landing: toward BREACH, never toward clean.
 * Every other card the pull names (`others`) is rebuilt by the same rule. Pure.
 */
export function cardLabelsAsLanded(reading, landed) {
  const first = oneCardAsLanded(reading, landed);
  const others = reading?.others;
  // Every other card the pull names is rebuilt the same way; an `others` that was not read stays as it is.
  return others?.measured === true && Array.isArray(others.cards) ? { ...first, others: { ...others, cards: others.cards.map((o) => (o?.measured === true ? oneCardAsLanded(o, landed) : o)) } } : first;
}

/** One card's reading as it stood at the landing — `cardLabelsAsLanded`'s rule, for the first card and each other. Pure. */
function oneCardAsLanded(reading, landed) {
  const events = Array.isArray(reading?.timeline?.events) ? reading.timeline.events : [];
  const isSecurity = (e) => (e?.event === 'labeled' || e?.event === 'unlabeled') && String(e?.label?.name ?? '').toLowerCase() === 'security';
  const after = (e) => Date.parse(e?.created_at ?? '') >= landed;
  const prior = events.filter((e) => isSecurity(e) && !after(e));
  const now = (Array.isArray(reading?.labels) ? reading.labels : []).some((l) => String(l ?? '').toLowerCase() === 'security');
  const carried = prior.length > 0
    ? prior[prior.length - 1].event === 'labeled'
    : now && !events.some((e) => isSecurity(e) && e.event === 'labeled' && after(e));
  return { ...reading, labels: carried ? ['security'] : [], timeline: { measured: true, reason: null, events: prior } };
}

/**
 * The reviews as they stood when the commit landed (#33729 N8): a review GitHub now reads DISMISSED, whose
 * dismissal the timeline dates at or after the landing, is put back in the state the timeline's `review_dismissed`
 * event names (`dismissed_review.state`). A dismissal with no such event, no review id or no readable time stays
 * DISMISSED: toward BREACH, never toward cleared. A dismissal in the same second as the landing is read as after
 * it and restores the approval (#33765 N-g, pinned as is): GitHub's times are whole seconds, so that order is
 * unknowable, and the restored approval is the maintainer's own, so the entry reads cleared, never `pass`. Pure.
 */
export function reviewsAsLanded(reviews, events, landed) {
  const restored = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    if (e?.event !== 'review_dismissed') continue;
    const at = Date.parse(e?.created_at ?? '');
    const id = e?.dismissed_review?.review_id;
    const state = e?.dismissed_review?.state;
    if (Number.isNaN(at) || at < landed || id == null || typeof state !== 'string' || state === '') continue;
    restored.set(id, state.toUpperCase());
  }
  return (Array.isArray(reviews) ? reviews : []).map((r) =>
    String(r?.state ?? '').toUpperCase() === 'DISMISSED' && restored.has(r?.id) ? { ...r, state: restored.get(r.id) } : r);
}

/**
 * The arm's inputs that were NOT measured (#33729 N5): each git read that threw, and the fork predicate when the
 * pull read did not measure it. One exception, read rather than assumed: `git show SHA:PATH` throws for a changeset
 * the commit deleted, and the arm reads that H on its own ("not read at the head"). A `git ls-tree` of that path at
 * that commit answering nothing proves the deletion, so it is a measured H; any other answer, or a throw, is unread.
 * Pure but for `runGit`.
 */
export function armReadsNotMeasured(gitFailures, fork, runGit, labels = []) {
  return armUnreadInputs(gitFailures, fork, runGit, labels).map((u) => u.words);
}

/**
 * The guard's changeset read, `git show SHA:PATH`, as the deleted-changeset exception and the favourable answer
 * both key on it (#33765 N-f). The self-test records the argv the guard really sends and holds it to this.
 */
export const ARM_CHANGESET_SHOW = /^([0-9a-f]{7,40}):(.+)$/;

/** `armReadsNotMeasured`'s inputs, each `{ words, argv }` (`argv` null for a non-git input). Pure but for `runGit`. */
function armUnreadInputs(gitFailures, fork, runGit, labels) {
  const unread = [];
  for (const { argv, why } of Array.isArray(gitFailures) ? gitFailures : []) {
    const shown = argv?.[0] === 'show' ? ARM_CHANGESET_SHOW.exec(String(argv[1] ?? '')) : null;
    if (shown) {
      let listed = null;
      try {
        listed = String(runGit(['ls-tree', '-z', '--name-only', shown[1], '--', shown[2]]));
      } catch { /* unread */ }
      if (listed === '') continue;
    }
    unread.push({ words: `\`git ${(argv ?? []).slice(0, 2).join(' ')}\` (${why})`, argv });
  }
  if (!fork || fork.measured !== true) unread.push({ words: 'its head repository (the fork predicate)', argv: null });
  if (!Array.isArray(labels)) unread.push({ words: 'its labels', argv: null });
  return unread;
}

/** A clean low-risk changeset: the answer to an unread `git show SHA:PATH` that gives the arm no reason. */
const ARM_FAVOURABLE_CHANGESET = "---\n'@objectstack/skills': patch\n---\n\nClause-②: no\nMetadata-protocol: none\n";

/**
 * The answer to one of the arm's git reads that gives the arm no reason (#33765 N-a): a clean changeset for the
 * guard's `show SHA:PATH`, and every path a modified regular file for its `diff-tree --raw` status read; null for
 * any other read — the ADR leg's `diff-tree -p` patch read included (#33539: a status listing is no patch, and
 * no stand-in patch is favourable) — which then cannot be answered the arm's way. Pure.
 */
export function favourableArmGitRead(argv, paths) {
  if (argv?.[0] === 'show' && ARM_CHANGESET_SHOW.test(String(argv[1] ?? ''))) return ARM_FAVOURABLE_CHANGESET;
  if (argv?.[0] === 'diff-tree' && argv.includes('--raw') && !argv.includes('-p')) return (Array.isArray(paths) ? paths : []).map((p) => `:100644 100644 ${'0'.repeat(40)} ${'0'.repeat(40)} M\0${p}\0`).join('');
  return null;
}

/**
 * Does the arm read H on its measured inputs alone (#33765 N-a)? The guard's own arm re-reads a fresh
 * decomposition with every unread input answered the way that gives the arm no reason: the git read by
 * `favourableArmGitRead`, the fork predicate as no fork, the labels as none. The arm's verdict is a conjunction,
 * so if it still reads H, the reasons it gives come from measured inputs and settle Tier H: those reasons, or null
 * (a read with no such answer, a read that fails anew, or an arm that would read S), which stays NOT MEASURED.
 * ⛔ The arm's record stage is never answered here: no stand-in record is handed in, so a re-read whose pull-read
 * conditions all hold comes back `pending` — the arm WOULD go on to its record — and that is null, never a reason
 * that settles Tier H and never a `Security-touching: no`.
 * Never throws.
 */
function armSettledWithoutUnread({ guard, entry, paths, repo, head, events, runGit, inputs }) {
  try {
    const answers = new Map();
    for (const { argv } of inputs) {
      if (!argv) continue;
      const answer = favourableArmGitRead(argv, paths);
      if (answer === null) return null;
      answers.set(JSON.stringify(argv), answer);
    }
    const [work] = guard.decomposeGovernedWork([{ pr: entry.pr, sha: entry.sha, subject: entry.subject, paths }], repo).governed;
    if (!work) return null;
    const failures = [];
    const git = (argv) => {
      const key = JSON.stringify(argv);
      if (answers.has(key)) return answers.get(key);
      try {
        return runGit(argv);
      } catch (error) {
        failures.push({ argv, why: String(error?.message ?? error).split('\n')[0] });
        throw error;
      }
    };
    const fork = head.fork?.measured === true ? head.fork : { measured: true, isFork: false };
    const labels = Array.isArray(head.labels) ? head.labels : [];
    guard.readLowRiskTier(work, repo, { ...head, fork, labels }, { timeline: { measured: true, reason: null, events }, runGit: git });
    if (guard.landsOnLowRiskArm(work) || guard.lowRiskRecordStagePending(work) || armUnreadInputs(failures, fork, runGit, labels).length > 0) return null;
    const reasons = work.surfaces.find((s) => s?.lowRiskVerdict)?.lowRiskVerdict?.reasons ?? [];
    return reasons.length > 0 ? reasons : null;
  } catch {
    return null;
  }
}

/** The arm cell under a sweep row, or ''. Pure. */
export function armCell(entry) {
  const a = entry?.arm;
  if (!a) return '';
  const head = a.headSha ? ` on head ${String(a.headSha).slice(0, 12)}` : '';
  const ignored = (a.ignored ?? []).map((line) => `\n         ${line}`).join('');
  const unbound = a.stageBound === false ? ' (its landed tree predates the record stage, so its queue read the record alone)' : '';
  if (a.state === 'pass') return `\n      ✅ low-risk arm landing${head}: same-head at-tier PASS record ${a.record?.where ?? ''} comment ${a.record?.id ?? '(no id)'}${unbound}${ignored}`;
  if (a.state === 'breach' && a.stage === true) return `\n      ⛔ BREACH — low-risk arm landing${head} on a record stage that reads Tier H: ${a.reason}${ignored}`;
  if (a.state === 'breach') return `\n      ⛔ BREACH — low-risk arm landing${head} WITHOUT a same-head at-tier PASS record: ${a.reason}${ignored}`;
  if (a.state === 'cleared') return `\n      low-risk arm: its pull-read conditions held${head}, cleared by an authorized ${a.by === 'review' ? 'approval' : 'enqueue'} (${(a.who ?? []).join(', ')}) before the record was read — the maintainer's merge`;
  if (a.state === 'not-measured') return `\n      ⚠️  low-risk arm NOT MEASURED${head} — ${a.reason}; listed here, unjudged`;
  const reasons = a.reasons ?? [];
  const unread = (a.unread ?? []).length > 0 ? `; settled without the unread ${a.unread.join('; ')}` : '';
  return `\n      low-risk arm: Tier H${head} — ${reasons.slice(0, 2).join('; ') || 'no reason recorded'}${reasons.length > 2 ? ` (+${reasons.length - 2} more)` : ''}${unread}`;
}

/**
 * The per-run NAMED fallback lines (#9619): one line per repo+reason group
 * naming which channels were tried and what each answered — replacing the
 * per-entry error string that buried the list. Pure.
 */
export function summariseAttributionFailures(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.attributionError) continue;
    const key = JSON.stringify([entry.repoSlug ?? '(repo)', entry.attributionError]);
    const group = groups.get(key) ?? { slug: entry.repoSlug ?? '(repo)', reason: entry.attributionError, prs: [] };
    group.prs.push(entry.pr);
    groups.set(key, group);
  }
  return [...groups.values()].map(
    (g) =>
      `⚠️  attribution unavailable for ${g.slug} — ${g.prs.length} entr${g.prs.length === 1 ? 'y' : 'ies'} ` +
      `(PR ${g.prs.map((n) => `#${n}`).join(', ')}); channels tried — ${g.reason}.`,
  );
}

// ── sweep-code provenance (#13307 reopen) ───────────────────────────────────

/**
 * Which sweep ran? The reopen's false green was a PRE-FIX copy of this script
 * executing from a stale tree, and nothing in the output said so — the reading
 * was taken as the landed version's behaviour. Pure: `describeSweepCode` turns
 * the reads into the line the header prints, so `--self-test` pins every
 * branch; `readSweepCode` does the three local git reads (no network), and
 * every failure is a stated UNKNOWN, never a crash and never a silent omission
 * — a sweep that cannot attribute its own code says that out loud too.
 */
export function describeSweepCode(code) {
  if (!code || !code.head || !code.blob) {
    return (
      `  sweep code: UNKNOWN (${code?.error ?? 'no reading'}) — this run cannot be attributed to a tree; ` +
      `a version-dependent conclusion drawn from it is unattributed (#13307).`
    );
  }
  if (code.headBlob && code.headBlob === code.blob) {
    return `  sweep code: HEAD ${code.head} — the running file byte-matches that tree's copy (blob ${code.blob.slice(0, 10)}).`;
  }
  return (
    `  ⚠️  sweep code: HEAD ${code.head}, but the RUNNING copy of this script (blob ${code.blob.slice(0, 10)}) is not ` +
    `the copy that HEAD records (${code.headBlob ? `blob ${code.headBlob.slice(0, 10)}` : 'unreadable'}) — a locally ` +
    `modified or stale copy. ⛔ Do not read this sweep as any landed version's behaviour (#13307: a pre-fix copy ` +
    `printed a false green that was then attributed to the landed fix).`
  );
}

/** The three local reads behind the line above — each failure is carried, not thrown. */
function readSweepCode() {
  const root = resolve(scriptDir, '..', '..');
  const rel = 'scripts/pm/check-governed-merges.mjs';
  const code = { head: null, blob: null, headBlob: null, error: null };
  try {
    code.blob = git(root, ['hash-object', '--', scriptPath]).trim() || null;
  } catch (error) {
    code.error = String(error?.message ?? error).split('\n')[0];
  }
  try {
    code.head = git(root, ['rev-parse', '--short', 'HEAD']).trim() || null;
    code.headBlob = git(root, ['rev-parse', `HEAD:${rel}`]).trim() || null;
  } catch (error) {
    code.error = code.error ?? String(error?.message ?? error).split('\n')[0];
  }
  return code;
}

// ── rendering ───────────────────────────────────────────────────────────────

/**
 * The attribution column, THREE ways (#12645) — because "nothing was found"
 * and "nothing was looked at" are different facts, and this report keeps them
 * apart everywhere else (#4690: an unaudited repo is not a clean repo, a
 * window whose boundary is unproven is not an empty window).
 *
 * The column used to be picked on `entry.attribution` alone, so an entry with
 * no attribution rendered "every channel failed; see the attribution note
 * below" — and the ONE entry shape that can reach that branch without a single
 * channel having been tried is the loudest line the sweep prints: a mainline
 * commit whose subject names no PR (`main()` skips it: `if (entry.pr == null)
 * continue` — there is no pull request to query). Measured 2026-08-27 on a
 * constructed sweep, that line claimed every channel failed four lines under a
 * printed `0 API lookup(s)`, and referred the reader to a note
 * `summariseAttributionFailures` never produces for it (that function groups
 * only entries carrying `attributionError`, and this one carries none). A
 * false claim on the most anomalous entry in the list is exactly the line a
 * reader learns to discount.
 *
 *   1. resolved       — a channel answered; it names which one.
 *   2. UNAVAILABLE    — `attributionError` is present: channels WERE tried and
 *                       all failed. ⚠️ This is the only branch that may point
 *                       at the attribution note, because it is the only one
 *                       `summariseAttributionFailures` writes a line for.
 *   3. NOT LOOKED UP  — no reading was attempted. The reason is READ off the
 *                       entry, never assumed: absent PR number is the case
 *                       `main()` produces, and an entry that has a PR number
 *                       yet reached here gets the honest residual instead of
 *                       being told it has no PR number — asserting an untried
 *                       channel and asserting an absent PR number are the same
 *                       defect wearing different words.
 *
 * ⛔ Report-only. This changes no judgment: `attributionFailed` (and with it
 * the INCOMPLETE exit) is still set only by a real channel failure, and a
 * PR-less entry is still its own loud entry — a direct push to `main` is more
 * anomalous than any PR merge, not less. Pure, so `--self-test` asserts on the
 * words.
 */
export function attributionCell(entry) {
  if (entry.attribution) {
    return (
      `merged_by ${entry.attribution.mergedBy ?? '(none)'} @ ${entry.attribution.mergedAt ?? '(unknown)'} ` +
      `(via ${entry.attributionChannel ?? 'unknown channel'})`
    );
  }
  if (entry.attributionError) return `merged_by UNAVAILABLE — every channel failed; see the attribution note below`;
  if (entry.pr == null) {
    return `merged_by NOT LOOKED UP — no PR number in the subject, so there is no pull request to query (not a channel failure)`;
  }
  return `merged_by NOT LOOKED UP — no attribution reading was recorded for this entry (not a channel failure)`;
}

/**
 * The register reading a row carries, or `''` — report-only, and pure so
 * `--self-test` pins the words.
 *
 * ⚠️ WHY A ROW SAYS THIS AT ALL (#15406). This sweep classifies with
 * `governedPathsIn` and nothing else: it never consults the exception register,
 * because provenance is a recompute against the tree a commit landed on and
 * this sweep holds no such tree. That conservatism is right — the row is listed
 * either way — but it left the row silent about a fact its reader needs.
 * Measured on PR #15284: its one `skills/**` path was the register's
 * `spec-react-blocks` row, the queue leg recomputed it on that tree, certified
 * it byte-exact and LIFTED it, and the landing cleared exactly as the
 * 2026-09-01 ruling provides for — while this report rendered a row identical
 * in every visible way to a hand-authored governed merge.
 *
 * ⛔ This cell LIFTS NOTHING and excuses nothing, and it is not a second
 * membership mechanism: it calls the register's own `generatedExceptionFor`,
 * and it repeats that function's own doctrine rather than softening it — a
 * candidate earns the QUESTION, never the answer. Certification, if any, is in
 * that landing's own queue-guard log, and this cell says so and says where.
 */
export function registerCell(entry) {
  const governed = (entry?.surfaces ?? []).flatMap((s) => s.files);
  const rows = governed.map((path) => ({ path, row: generatedExceptionFor(path) })).filter((x) => x.row !== null);
  if (rows.length === 0) return '';
  const named = rows.slice(0, 4).map((x) => `${x.path} → ${x.row.id} (${x.row.ruling})`);
  const all = rows.length === governed.length;
  return (
    `\n      ℹ️  REGISTER: ${all ? 'every' : `${rows.length} of ${governed.length}`} governed path(s) on this row ` +
    `${all ? 'is' : 'are'} a generated-artifact CANDIDATE:\n` +
    named.map((n) => `            ${n}`).join('\n') +
    (rows.length > named.length ? `\n            … and ${rows.length - named.length} more` : '') +
    '\n          A candidate earns the QUESTION, never the answer: this sweep does NOT recompute provenance' +
    '\n          (it holds no tree to recompute against), so whether the queue leg certified it byte-exact and' +
    '\n          LIFTED it is recorded in the Governed Surface Queue Guard log of that landing. A hand edit to' +
    '\n          the same path is never lifted.' +
    (all
      ? ''
      : '\n          The other governed path(s) on this row are on no register row at all, so this row is governed' +
        '\n          regardless of any recompute.')
  );
}

/**
 * The window, in the words the operator reads — pure, and the half of route A
 * the #12633 ruling names explicitly: the back-off has to be SAID, or a
 * re-listed boundary entry reads as noise instead of as re-recognition.
 */
export function describeWindow(window) {
  if (window.mode === 'topological') {
    const refs = [
      ...(window.bareRef ? [`any repo it resolves in: ${window.bareRef}`] : []),
      ...[...(window.pinnedRefs ?? new Map())].map(([id, ref]) => `${id}: ${ref}`),
    ].join('; ');
    return [
      `  window: TOPOLOGICAL — the first-parent range from the ref to origin/main, per repo (${refs}).`,
      `      Committer dates are not consulted, so no build-to-land skew of any size can move this`,
      `      boundary. A repo no ref resolves in falls back to the date window below and says so.`,
    ].join('\n');
  }
  return [
    `  window: DATE boundary ${window.requestedIso}, backed off by the ${window.budgetSeconds} s build-to-land`,
    `      skew budget to ${window.effectiveIso}, then closed topologically down to the deepest commit`,
    `      inside it (#12633). An entry you recognised last round may be RE-LISTED at the boundary —`,
    `      that is RE-RECOGNITION, not noise; a dropped entry is never seen again.`,
  ].join('\n');
}

/**
 * Why a repo whose walk never reached below the boundary is INCOMPLETE rather
 * than clean. Pure, and the #4690 invariant in one place: a skew larger than
 * the budget must be readable as "we could not tell", never as an empty list.
 */
export function windowEdgeReason({ budgetSeconds }) {
  return (
    `the walk never saw a commit dated BELOW the boundary, so the deepest commit inside the window ` +
    `cannot be shown to be the deepest one. A governed landing skewed further than the ${budgetSeconds} s ` +
    `budget would be missing from the list above with nothing marking it — and a short governed list ` +
    `reads as COMPLIANCE (#9902). Remedy: re-run with \`--since-ref <a tip you recorded>\` for a ` +
    `topological window, or widen \`--since\`.`
  );
}

/** The `--since-ref` line for the NEXT round — this script keeps no state of its own. */
export function nextRoundRefLine(repos) {
  const pins = repos.filter((r) => r.status === 'audited' && r.tip).map((r) => `--since-ref ${r.id}=${r.tip.sha.slice(0, 12)}`);
  if (pins.length === 0) return [];
  return [
    `  next round, exactly: ${pins.join(' ')}`,
    `      (record these tips — a topological window is exact, and this script stores nothing for you).`,
  ];
}

/**
 * The SIZE cell of a sweep row (#19036). Pure. Empty for a row classified with
 * no size — the pre-#19036 fixtures and callers render exactly as they did —
 * a plain reading under the line, and the ⛔ form over it, which names the
 * limb the row is listed on: alone (no governed path) or beside the register.
 * GitHub's own pair, when the attribution read carried one and it differs
 * from the landed number, is printed beside it; it never decides the listing.
 */
export function sizeCell(entry) {
  const s = entry?.size;
  if (s?.measured !== true) return '';
  const local = `${s.changedLines} changed line(s) (+${s.additions} / -${s.deletions})`;
  const gh = entry?.attribution?.size ?? null;
  const ghNote =
    gh && (gh.additions !== s.additions || gh.deletions !== s.deletions)
      ? `; GitHub reports +${gh.additions} / -${gh.deletions} on the pull request`
      : '';
  if (!s.exceeds) return `\n      size: ${local}, at or under ${s.threshold}${ghNote}`;
  const alone = (entry?.surfaces?.length ?? 0) === 0;
  return (
    `\n      ⛔ SIZE: ${local} EXCEEDS the human-merge line ${s.threshold} (additions + deletions, generated files INCLUDED)${ghNote} —` +
    `\n          this landing was due a HUMAN MERGE (2026-09-18 ruling), whatever its paths; it is listed on that limb ` +
    `${alone ? 'ALONE' : 'as well as on the register'}.`
  );
}

/** The whole report as text — pure, so --self-test asserts on the words. */
export function renderReport({ window, repos, scanned, entries, lookups, sweepCode = null }) {
  const audited = repos.filter((r) => r.status === 'audited');
  const unaudited = repos.filter((r) => r.status !== 'audited');
  const edged = audited.filter((r) => r.windowIncomplete);
  // Counted APART (#19036): a row with no governed path is on the list for its
  // SIZE, and "N governed merge(s)" must keep meaning the register's rows.
  const oversizedOnly = entries.filter((e) => (e.surfaces?.length ?? 0) === 0);
  // Listed APART (#33603): a seat landing through the low-risk arm is not the maintainer's to recognise.
  const armLandings = entries.filter((e) => e.arm?.state === 'pass' || e.arm?.state === 'breach');
  const breaches = armLandings.filter((e) => e.arm.state === 'breach').length;
  const head =
    `governed-merges sweep: ${entries.length - oversizedOnly.length} governed merge(s)` +
    (oversizedOnly.length > 0 ? ` and ${oversizedOnly.length} oversized landing(s) with no governed path` : '') +
    ` since ${window.requestedIso} ` +
    `across ${audited.length}/${repos.length} governed repo(s)\n` +
    (armLandings.length > 0 ? `  of which ${armLandings.length} landed through the low-risk skills arm, ${breaches} of them ⛔ BREACH (no same-head at-tier PASS record, or a record stage at Tier H)\n` : '') +
    `  scanned ${scanned} mainline commit(s); ${lookups} API lookup(s).\n` +
    (sweepCode ? `${describeSweepCode(sweepCode)}\n` : '') +
    describeWindow(window);
  const auditedLines = audited.map(
    (r) => `  ✓ audited  ${r.slug} — tip ${r.tip ? `${r.tip.sha.slice(0, 9)} @ ${r.tip.date}` : '(unknown)'}; ${r.scanned ?? 0} mainline commit(s) in window${r.windowMode ? `; window ${r.windowMode}${r.windowBase ? ` from ${r.windowBase.sha.slice(0, 9)}` : ''}${r.windowFellBack ? ` (fell back — ${r.windowFellBack})` : ''}${r.straddlers ? `, ${r.straddlers} boundary re-listing(s)` : ''}` : ''}${r.horizon ? `; history ${r.horizon}` : ''}${r.remote ? `; remote ${describeRemote(r.remote)}` : ''}${r.quiet ? (r.remote ? ' — none in window, and the remote tip was reached and matches this mirror: a MEASURED zero, not an unread one' : ' — none in window; ⚠️ no remote reading is recorded for this row, so the zero is not a measured one') : ''}`,
  );
  const unauditedLines = unaudited.map((r) => `  ⚠️  UNAUDITED  ${r.slug} — [${r.precondition ?? 'unstated'}] ${r.reason}`);
  const edgeLines = edged.map((r) => `  ⚠️  WINDOW EDGE  ${r.slug} — ${r.windowIncomplete}`);
  const unauditedNote =
    unaudited.length > 0
      ? [
          `  ⛔  ${unaudited.length} governed repo(s) were NOT audited. An unaudited repo is not a clean repo (#4690):`,
          `      nothing was found there because nothing was looked at. Check the repo out (or pass`,
          `      \`--repo-root <id>=<path>\`) and re-run before reading this sweep as clean.`,
        ]
      : [];
  const contract = [
    `  Every entry below should correspond to a merge the maintainer performed or ordered in person.`,
    `  An entry the maintainer does not recognise is the violation signal — file it as an incident (#9495 regime).`,
    `  A landing over ${HUMAN_MERGE_LINE_THRESHOLD} changed lines (additions + deletions, generated files INCLUDED) is listed too, on SIZE`,
    `  alone — it was due a human merge (2026-09-18 ruling), whatever its paths; the number is the LANDED diff's, read locally.`,
  ];
  const preamble = [head, ...auditedLines, ...unauditedLines, ...edgeLines, ...unauditedNote, ...nextRoundRefLine(repos), ...contract].join('\n');

  if (entries.length === 0) {
    const nothing = `no governed surface was merged, and no landing crossed ${HUMAN_MERGE_LINE_THRESHOLD} changed lines,`;
    if (unaudited.length > 0) return `${preamble}\n  ${nothing} in the audited repo(s) — NOT a clean window; see UNAUDITED above.`;
    if (edged.length > 0) return `${preamble}\n  ${nothing} inside the PROVEN part of the window — NOT a clean window; see WINDOW EDGE above.`;
    return `${preamble}\n  ✅  clean window — ${nothing} in any governed repo.`;
  }

  const row = (e) => {
    const surfaces = e.surfaces.map((s) => `${s.glob} ×${s.files.length}`).join(', ');
    const who = attributionCell(e);
    const prName = e.pr != null ? `PR #${e.pr}` : '⚠️  NO PR NUMBER IN SUBJECT — direct push to main? investigate';
    const files = e.surfaces.flatMap((s) => s.files.slice(0, 6)).slice(0, 8);
    // A row on the list for its SIZE alone has no surface and no file to name;
    // its size cell — printed right under the attribution — is the reason.
    const surfaceBlock =
      e.surfaces.length === 0
        ? '      surfaces: (none — listed on SIZE alone)'
        : `      surfaces: ${surfaces}\n${files.map((f) => `        - ${f}`).join('\n')}`;
    return `  • ${e.repoSlug ? `${e.repoSlug} ` : ''}${prName} — ${e.subject}\n      commit ${e.sha.slice(0, 9)} @ ${e.date}; ${who}${sizeCell(e)}${armCell(e)}\n${surfaceBlock}${registerCell(e)}`;
  };
  const lines = entries.filter((e) => !armLandings.includes(e)).map(row);
  if (armLandings.length > 0) {
    lines.push(
      `  Low-risk skills arm landings (${LOW_RISK_ARM_RULING}): the arm reads them Tier S, so they land on the`,
      "  seat's own review and are NOT the maintainer's to recognise, whoever merged_by names. Each stands only on a",
      '  same-head at-tier PASS record the queue could read; a ⛔ BREACH row is the violation signal — file it as an incident.',
      ...armLandings.map(row),
    );
  }

  const notes = summariseAttributionFailures(entries).map((l) => `  ${l}`);
  const caveat = entries.some((e) => e.attribution)
    ? [
        `  ℹ️  merged_by names an ACCOUNT, not a principal — the maintainer also operates the seat accounts`,
        `      (measured 2026-08-18: objectui PR #5188 read merged_by os-steve; asked directly, the maintainer`,
        `      answered 「5188 是我合并的」). The column PROMPTS recognition; it never settles it.`,
      ]
    : [];
  return [preamble, ...lines, ...notes, ...caveat].join('\n');
}

// ── the weekly audit card (`governed-merges-audit` in fleet-patrols.yml) ─────

/**
 * The readings behind the weekly audit's ONE card. They lived inline in the job's two `github-script` steps,
 * where no `--self-test` could reach them; the job now imports them from its own checkout (so a pull request
 * runs the version it carries) and keeps every API call. Everything here is pure: the sweep's JSON → the
 * findings the job files on (`readAuditSweep`), a card body → its keyed rows (`readAuditCardRows`), the closed
 * cards → the rows they rule (`ruledAuditRows`), and findings + the open card → the next body and its comment
 * (`composeAuditCard`).
 *
 * ⛔ What the card serves is unchanged: the maintainer's option 0 「每周定时工作流」, recorded on #33717 — a clean
 * week files nothing; a BREACH or an unread week opens or refreshes one card, labelled and found as before. The
 * readings below change only where the job's own reading was wrong, each pinned both ways in the battery
 * "⭐ the weekly audit card".
 */
export const AUDIT_CARD = Object.freeze({
  breachHeading: '## ⛔ BREACH',
  unreadHeading: '## NOT MEASURED',
  ruledHeading: '## Already ruled',
  // The body's footer: its first line, then the re-read prescription. The reader stops at the LAST one.
  footer: 'The full sweep JSON is the `governed-merges-audit` artifact',
  footerTail: 'hand: `node scripts/pm/check-governed-merges.mjs',
  // Every carried row ends in this mark and its reason; the reader splits it off, whichever reason it gives.
  carriedMark: ' · _carried: ',
  breachCap: 100,
  unreadCap: 40,
  // One row's text past this is cut, so no single subject or reason can crowd the others off the card.
  rowChars: 1000,
  stderrChars: 6000,
  // GitHub refuses an issue body over 65,536 characters, and a refused update repeats every week until the card
  // is closed. The body is fitted under this bound, NOT MEASURED rows first, then BREACH rows from the tail.
  bodyChars: 60000,
  // The refresh comment names at most this many dropped keys per group, then counts the rest; the comment has
  // the same 65,536-character limit as the body.
  droppedKeysCap: 500,
  // How long a closed card's ruling is read. A row this week's sweep reads landed less than 7 days plus the
  // sweep's 1 h skew budget ago, and a card can only have listed it after that, so a card closed earlier ruled
  // on other landings. 10 covers the window with room. It is the window's bound, not the clone depth
  // (`AUDIT_HISTORY_DAYS` in the job), which only happens to share the number.
  ruledHorizonDays: 10,
});

/** A card row's key: its leading `PR #N` or `commit SHA12`. */
export const AUDIT_ROW_KEY = /^- (PR #\d+|commit [0-9a-f]{7,40})\b/;

/** Text bound for an issue body: no angle bracket survives the sanitizer, and no `@` may ping anyone. */
export function auditClean(s) {
  return String(s ?? '').replace(/</g, '‹').replace(/>/g, '›').replace(/@/g, '@​').replace(/\s+/g, ' ').trim();
}

/** A sweep entry's row key, and the name a row prints for it. */
export function auditRowKey(e) {
  return e?.pr != null ? `PR #${e.pr}` : `commit ${String(e?.sha ?? '').slice(0, 12)}`;
}
export function auditRowName(e) {
  return e?.pr != null ? auditRowKey(e) : `${auditRowKey(e)} (no PR number in its subject)`;
}

/** What this run read for an entry, in the words a carried row's mark quotes. */
function auditReadingOf(e) {
  switch (e?.arm?.state) {
    case 'breach': return 'BREACH';
    case 'not-measured': return 'NOT MEASURED on the low-risk arm';
    case 'pass': return 'a landing on a same-head at-tier PASS record';
    case 'cleared': return 'cleared by an authorized approval or enqueue';
    case 'tier-h': return "Tier H, the maintainer's merge";
    default: return e?.pr == null ? 'NOT MEASURED (no PR number in its subject)' : 'a governed landing off the low-risk arm';
  }
}

const auditCut = (s, n = AUDIT_CARD.rowChars) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The sweep's output → the findings the job files on. Never throws: a JSON it cannot read is itself the
 * NOT MEASURED row. `readings` maps every entry's row key to what this run read for it, so a carried row can
 * say that it WAS read, in another state (#33814 N9).
 *
 * #33814 N4: an entry whose subject names no pull request reads NOT MEASURED. The sweep lists it as its own loud
 * entry but reads no merge, review or record for it (there is no pull request to ask), so it never reaches the
 * arm and, before this, the job read it as nothing at all: a governed landing on `main` that only a clean week
 * could follow.
 */
export function readAuditSweep({ exit = '', raw = '', stderr = '' } = {}) {
  const code = String(exit ?? '').trim();
  const err = String(stderr ?? '').trim();
  let sweep = null;
  let parseError = null;
  if (String(raw ?? '').trim()) {
    try { sweep = JSON.parse(raw); } catch (error) { parseError = String(error?.message ?? error).split('\n')[0]; }
  }
  const breaches = [];
  const unread = [];
  const readings = {};
  const readable = Boolean(sweep && Array.isArray(sweep.entries) && Array.isArray(sweep.repos));
  if (readable) {
    for (const r of sweep.repos) {
      if (r?.status !== 'audited') unread.push(`\`${auditClean(r?.slug)}\` UNAUDITED [${auditClean(r?.precondition ?? 'unstated')}]: ${auditClean(r?.reason)}`);
      else if (r.windowIncomplete) unread.push(`\`${auditClean(r.slug)}\` WINDOW EDGE: ${auditClean(r.windowIncomplete)}`);
    }
    for (const e of sweep.entries) {
      const key = auditRowKey(e);
      if (!(key in readings) || e?.arm?.state === 'breach') readings[key] = auditReadingOf(e);
      if (e?.arm?.state === 'breach') {
        const who = e.attribution ? `merged_by ${auditClean(e.attribution.mergedBy ?? '(none)')} at ${auditClean(e.attribution.mergedAt ?? '(unknown)')}` : 'merge attribution unavailable';
        const head = e.arm.headSha ? ` on head \`${String(e.arm.headSha).slice(0, 12)}\`` : '';
        breaches.push({ key, line: `${auditRowName(e)} — ${auditClean(e.subject)} — commit \`${String(e.sha ?? '').slice(0, 12)}\`; ${who}${head}: ${auditClean(e.arm.reason)}` });
      }
      if (e?.arm?.state === 'not-measured') unread.push(`${auditRowName(e)} low-risk arm NOT MEASURED: ${auditClean(e.arm.reason)}`);
      if (e?.attributionError) unread.push(`${auditRowName(e)} attribution unavailable: ${auditClean(e.attributionError)}`);
      if (e?.pr == null) {
        unread.push(`${auditRowName(e)} NOT MEASURED — ${auditClean(e.subject)}: a governed landing with no pull request, so no merge, review or record could be read for it. A re-run reads it the same way: rule on it in a comment; it leaves this card when it leaves the 7-day window`);
      }
    }
    if (code !== '0' && unread.length === 0) unread.push(`the sweep exited ${code || '(not recorded)'} but its JSON names no unread row — read the run log`);
    if (code === '0' && sweep.complete !== true) unread.push('the sweep exited 0 but its JSON does not say `complete: true` — read the run log');
  } else {
    unread.push(`the sweep left no readable JSON (exit ${code || 'not recorded'}${parseError ? `; parse error: ${auditClean(parseError)}` : ''}) — it could not sweep at all${err ? '; its stderr is quoted below' : ', and it wrote nothing to stderr'}`);
  }
  const verdict = breaches.length > 0 ? (unread.length > 0 ? 'breach-and-unread' : 'breach') : unread.length > 0 ? 'unread' : 'clean';
  const counts = readable
    ? `${sweep.entries.length} governed entr${sweep.entries.length === 1 ? 'y' : 'ies'} over ${sweep.scanned ?? '?'} mainline commit(s) since ${auditClean(sweep.since)}`
    : 'no sweep reading';
  // Both fence markers are defused, so a stderr line can neither close the quote nor open a fence of its own.
  const stderrTail = !readable && err ? err.slice(-AUDIT_CARD.stderrChars).replace(/```/g, "'''").replace(/~~~/g, "'''") : '';
  return { verdict, counts, breaches, unread, readings, stderrTail };
}

/** The NOT MEASURED section, `shown` rows of it, the stderr tail only when `withStderr`. Lines, no trailing join. */
export function renderAuditUnreadSection(unread, stderrTail = '', shown = AUDIT_CARD.unreadCap, withStderr = true) {
  if (!Array.isArray(unread) || unread.length === 0) return [];
  const n = Math.min(shown, unread.length);
  const lines = [`${AUDIT_CARD.unreadHeading} — ${unread.length} reading(s) the sweep could not make`, '', ...unread.slice(0, n).map((u) => `- ${auditCut(u)}`)];
  if (n < unread.length) lines.push(`… and ${unread.length - n} more — see the run log`);
  lines.push('');
  if (withStderr && stderrTail) lines.push('```', stderrTail, '```', '');
  return lines;
}

/** This run's findings as the run summary prints them: its BREACH rows, then its NOT MEASURED rows. */
export function renderAuditRunSummary(findings) {
  const breaches = findings?.breaches ?? [];
  const lines = [];
  if (breaches.length > 0) {
    const n = Math.min(AUDIT_CARD.breachCap, breaches.length);
    lines.push(`${AUDIT_CARD.breachHeading} — ${breaches.length} low-risk skills arm landing(s) without a same-head at-tier PASS record`, '', ...breaches.slice(0, n).map((b) => `- ${b.line}`));
    if (n < breaches.length) lines.push(`… and ${breaches.length - n} more — see the run log`);
    lines.push('');
  }
  lines.push(...renderAuditUnreadSection(findings?.unread ?? [], findings?.stderrTail ?? ''));
  return lines;
}

/**
 * A card body → its keyed rows under `headings` (any of `AUDIT_CARD`'s three), the lines under them that carry
 * no key, and the keyed rows found OUTSIDE every section this audit writes. Blank lines are never counted, and a
 * row set apart by one is still read.
 *
 *   * #33814 N13: a keyed row outside every known section (under a reworded heading, or moved above the first
 *     one) is counted in `stray`, so a row the carry-forward cannot see is reported instead of vanishing with a
 *     zero `unkeyed` count.
 *   * N14: a fenced block is never read: the quoted stderr may hold a line that starts with a heading. A fence
 *     closes only on its own marker, at least as long and with nothing after it, and one still open at the end
 *     of the read is reported in `openFence` (review S2), since every line after its opener went unread.
 *   * N16: only the LAST footer ends the reading, so a maintainer's line that starts with the footer's words
 *     does not cut a section short.
 *   * N17: the footer's second line bounds the reading too, and `footer: false` says when neither was found
 *     (the last section was then read to the end of the body).
 */
export function readAuditCardRows(text, headings) {
  const lines = String(text ?? '').split(/\r?\n/);
  let end = lines.length;
  let footer = false;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith(AUDIT_CARD.footer)) { end = i; footer = true; break; }
    if (lines[i].startsWith(AUDIT_CARD.footerTail)) {
      end = i > 0 && lines[i - 1].startsWith(AUDIT_CARD.footer) ? i - 1 : i;
      footer = true;
      break;
    }
  }
  const known = [AUDIT_CARD.breachHeading, AUDIT_CARD.unreadHeading, AUDIT_CARD.ruledHeading];
  const rows = [];
  const stray = [];
  let unkeyed = 0;
  let section = null;
  let fence = null;
  for (const raw of lines.slice(0, end)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
    if (fence === null && marker) { fence = marker[1]; continue; }
    if (fence !== null) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (raw.startsWith('## ')) { section = known.find((h) => raw.startsWith(h)) ?? 'other'; continue; }
    if (!raw.trim() || raw.startsWith('… and ')) continue;
    const m = AUDIT_ROW_KEY.exec(raw);
    if (section !== null && section !== 'other') {
      if (!headings.includes(section)) continue;
      if (m) rows.push({ key: m[1], line: raw.slice(2).split(AUDIT_CARD.carriedMark)[0].trimEnd() });
      else unkeyed += 1;
    } else if (m) {
      stray.push(m[1]);
    }
  }
  return { rows, unkeyed, stray, footer, openFence: fence !== null };
}

/**
 * Which closed cards are worth a close-event read: not a duplicate, closed within the ruled horizon. `now` is
 * epoch milliseconds.
 */
export function auditRulingCandidates(closed, now) {
  const since = now - AUDIT_CARD.ruledHorizonDays * 86400000;
  return (closed ?? []).filter((i) => i?.state_reason !== 'duplicate' && Date.parse(i?.closed_at ?? '') >= since);
}

/**
 * Whether a closed card's close is a ruling: `null` when it is, else the reason it is not (#33814 N10). A close
 * rules ("every BREACH row here is ruled") ONLY when the actor login of the card's last `closed` event is in
 * `GOVERNED_APPROVERS` and the event carries no commit: another account's close (the relay bot, the stale bot),
 * a closing keyword in a merged pull request (the event names a commit), or a close whose event could not be
 * read rules nothing, so the rows it held are announced again.
 * `card.close` is `{ actor, commitId, app }` from that event, or null; `app` is the event's
 * `performed_via_github_app` value AS SERVED — `undefined` when the key is absent, else `null` or an object.
 *
 * ⚠️ This is a LOGIN test, and its residual is named (review S1 on #33814): an approver's login is also a seat
 * account, so a seat session closing the card on an approver's account reads as that approver's close. The app
 * field is read best-effort and by PRESENCE, never by name: absent ⇒ the event is unreadable and rules nothing;
 * present and an object (with or without a slug or name) ⇒ an app's act, rules nothing; present and null ⇒ the
 * login test decides. The platform serves it null on every close event today (measured 2026-11-15 on the
 * issue-events and timeline endpoints, the relay bot's own closes included), so the object branch does not
 * fire on today's platform, and the login test is what decides.
 */
export function auditCloseRuling(card, { now, approvers }) {
  if (card?.state_reason === 'duplicate') return 'closed as a duplicate';
  const at = Date.parse(card?.closed_at ?? '');
  if (Number.isNaN(at) || at < now - AUDIT_CARD.ruledHorizonDays * 86400000) return `closed more than ${AUDIT_CARD.ruledHorizonDays} days ago, before any landing this window reads`;
  if (!Array.isArray(approvers) || approvers.length === 0) return 'the authorized approver list could not be loaded';
  if (!card.close) return 'its close event could not be read';
  if (card.close.commitId) return `closed by commit \`${String(card.close.commitId).slice(0, 12)}\` (a closing keyword), not by hand`;
  if (card.close.app === undefined) return 'its close event does not carry `performed_via_github_app`, so whether an app closed it is unreadable';
  if (card.close.app !== null) return `closed through a GitHub App on ${auditClean(card.close.actor ?? '(unknown)')}'s account, not by hand`;
  if (!approvers.includes(card.close.actor)) return `closed by ${auditClean(card.close.actor ?? '(unknown)')}, not by an authorized approver`;
  return null;
}

/**
 * The rows the closed cards rule: the BREACH and already-ruled keys of EVERY card whose close is a ruling
 * (#33814 N12: one card read hid an older ruling behind a newer close that held only NOT MEASURED rows), each
 * mapped to the newest such card. `unruled` names each closed card whose close rules nothing, and why.
 */
export function ruledAuditRows(cards, { now, approvers }) {
  const ruled = new Map();
  const unruled = [];
  for (const card of [...(cards ?? [])].sort((a, b) => b.number - a.number)) {
    const why = auditCloseRuling(card, { now, approvers });
    if (why !== null) { unruled.push({ number: card.number, why }); continue; }
    for (const r of readAuditCardRows(card.body, [AUDIT_CARD.breachHeading, AUDIT_CARD.ruledHeading]).rows) {
      if (!ruled.has(r.key)) ruled.set(r.key, card.number);
    }
  }
  return { ruled, unruled };
}

/** The `Swept` line's cadence: a weekly `M H * * D` cron makes its deadline decidable; any other form says so. */
export function auditSweptExpectation(schedule, sweptAt) {
  const s = String(schedule ?? '').trim();
  const f = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/.exec(s);
  if (!f || Number(f[1]) > 59 || Number(f[2]) > 23) {
    return `⚠️ expected cadence UNSTATED — PATROL_SCHEDULE is \`${s}\`, not the weekly \`M H * * D\` form this step computes a deadline from`;
  }
  const next = new Date(sweptAt);
  next.setUTCHours(Number(f[2]), Number(f[1]), 0, 0);
  next.setUTCDate(next.getUTCDate() + ((Number(f[3]) - next.getUTCDay() + 7) % 7));
  if (next <= sweptAt) next.setUTCDate(next.getUTCDate() + 7);
  return `expected weekly (cron \`${s}\` UTC) · next by ${next.toISOString().slice(0, 16)}Z`;
}

/**
 * Findings + the open card → what the job writes: `{ action: 'none' | 'create' | 'update', body, comment,
 * notice }`. Throws on findings with nothing to file (the job never calls it on a clean verdict).
 *
 * A refresh never drops a BREACH row that fits: every keyed row under the open card's BREACH heading this run
 * did not read again is carried, marked; #33814 N9: the mark says when this run DID read the row, in another
 * state, rather than claiming it was not read. A row already on the open card stays live; a row a ruling covers
 * and the open card does not hold is listed as already ruled, not as new. #33814 N8: the body is fitted under
 * `AUDIT_CARD.bodyChars` (the stderr tail, then NOT MEASURED rows, then BREACH rows from the tail), and the
 * BREACH heading counts the rows ON the card, naming apart the ones that did not fit and so are not carried.
 *
 * `meta`: `{ marker, runUrl, sha, event, exit, verdict, counts, schedule, sweptAt }`.
 */
export function composeAuditCard({ findings, existing = null, ruling = { ruled: new Map(), unruled: [] }, prior = null, meta }) {
  const current = Array.isArray(findings?.breaches) ? findings.breaches : [];
  const unread = Array.isArray(findings?.unread) ? findings.unread : [];
  const readings = findings?.readings ?? {};
  const stderrTail = String(findings?.stderrTail ?? '');
  if (current.length === 0 && unread.length === 0) throw new Error(`verdict ${meta?.verdict} but no findings were rendered — refusing to file an empty card`);
  const ruled = ruling?.ruled instanceof Map ? ruling.ruled : new Map();
  const unruled = Array.isArray(ruling?.unruled) ? ruling.unruled : [];

  const thisRun = new Set(current.map((b) => b.key));
  const onCard = new Set();
  const carried = [];
  let read = { rows: [], unkeyed: 0, stray: [], footer: true };
  if (existing) {
    read = readAuditCardRows(existing.body, [AUDIT_CARD.breachHeading]);
    for (const r of read.rows) {
      if (onCard.has(r.key)) continue;
      onCard.add(r.key);
      if (!thisRun.has(r.key)) carried.push(r);
    }
  }
  const alreadyRuled = current.filter((b) => !onCard.has(b.key) && ruled.has(b.key));
  const live = current.filter((b) => onCard.has(b.key) || !ruled.has(b.key));
  if (live.length === 0 && carried.length === 0 && unread.length === 0) {
    return {
      action: 'none',
      notice: `every BREACH row this run read (${alreadyRuled.map((b) => `${b.key} on card #${ruled.get(b.key)}`).join(', ')}) is already ruled, and nothing is unread — nothing filed.`,
    };
  }

  const mark = (key) => (readings[key]
    ? `${AUDIT_CARD.carriedMark}on this card from an earlier run; this run read it as ${readings[key]}, not as a BREACH; it stays until this card is closed_`
    : `${AUDIT_CARD.carriedMark}on this card from an earlier run and not in this run's reading; it stays until this card is closed_`);
  const breachRows = [
    ...live.map((b) => ({ key: b.key, md: `- ${auditCut(b.line)}`, live: true })),
    ...carried.map((b) => ({ key: b.key, md: `- ${auditCut(b.line)}${mark(b.key)}`, live: false })),
  ];
  const ruledLines = alreadyRuled.length === 0 ? [] : [
    `${AUDIT_CARD.ruledHeading} — ${alreadyRuled.length} BREACH row(s) this run read again, ruled when the card named was closed on an authorized approver's account; not re-announced`,
    '',
    ...alreadyRuled.map((b) => `- ${b.key} — ruled on card #${ruled.get(b.key)}`),
    '',
  ];
  const sweptAt = meta?.sweptAt instanceof Date ? meta.sweptAt : new Date(meta?.sweptAt ?? Date.now());
  const priorWhy = prior ? unruled.find((u) => u.number === prior.number)?.why ?? null : null;
  const priorLines = !prior ? []
    : priorWhy
      ? [`⚠️ The previous audit card #${prior.number} was closed, but that close rules nothing here (${priorWhy}), so its rows are not read as ruled.`, '']
      : [`⚠️ The previous audit card #${prior.number} was closed on its own merits and a later week is bad again; its conclusion is in that issue.`, ''];

  const render = (breachShown, unreadShown, withStderr) => {
    const shown = breachRows.slice(0, breachShown);
    const liveShown = shown.filter((r) => r.live).length;
    const dropped = breachRows.slice(breachShown);
    const overflow = dropped.length;
    const droppedCarried = dropped.filter((r) => !r.live).length;
    const breachLines = breachRows.length === 0 ? [] : [
      `${AUDIT_CARD.breachHeading} — ${shown.length} low-risk skills arm landing(s) without a same-head at-tier PASS record on this card (${liveShown} read by this run, ${shown.length - liveShown} carried from earlier runs)${overflow > 0 ? `; ${overflow} more did not fit` : ''}`,
      '',
      ...shown.map((r) => r.md),
      // Review S3: a carried row that does not fit is in no run's reading any more, so only this run's are in the
      // run log and the artifact; the refresh comment names every dropped key.
      ...(overflow > 0 ? [`… and ${overflow} more did not fit, so they are NOT on this card and not carried: ${overflow - droppedCarried} read by this run (in its run log and artifact)${droppedCarried > 0 ? `, ${droppedCarried} carried from earlier runs and held by no run's reading` : ''}`] : []),
      '',
    ];
    const body = [
      `${meta?.marker} — machine-findable marker for this generated card. ⛔ Do not delete this line: it is how the weekly audit finds this card instead of filing a new one.`,
      '',
      'Maintainer-action: rule on each ⛔ BREACH row below (kept, or rolled back) and record that ruling as a comment on this card, and re-run the `governed-merges-audit` job of Fleet Patrols by hand for any NOT MEASURED row — done when every BREACH row has your ruling recorded on this card and a manual run reads no NOT MEASURED row; then close this card. A BREACH row never reads clean on a re-run (the arm reads only evidence that existed before the landing, so the row reads BREACH until it leaves the 7-day window): only your ruling closes it.',
      '',
      '# Weekly governed-merges audit: a BREACH or an unread week on `main`',
      '',
      `_Swept ${sweptAt.toISOString()} · ${auditSweptExpectation(meta?.schedule, sweptAt)} · [run log](${meta?.runUrl}) · commit \`${meta?.sha}\` · trigger \`${meta?.event}\` · sweep exit ${meta?.exit || '(not recorded)'} · verdict \`${meta?.verdict}\` · ${meta?.counts}._`,
      '',
      'This card is for the maintainer: the weekly post-merge governed audit (AGENTS.md Prime Directive 14, the',
      'compensating control for seat-landed governed merges) found a low-risk skills arm landing with no same-head',
      'at-tier PASS record, or could not read the whole week. A seat landing without its record is a seat violation,',
      'filed and rolled back, and no seat judges it. ⛔ No seat dispatches this card. The audit files nothing on a',
      'clean week and closes nothing, so a `Swept` line past its `next by` deadline means the audit died OR the',
      'week was clean; the Actions run list tells the two apart. Ruling: option 0, recorded on #33717.',
      '',
      'A refresh rewrites this body and comments here. BREACH rows are carried from run to run until this card is',
      'closed; NOT MEASURED rows are the latest run\'s only. Deleting a row by hand does not retire it (a row still',
      'inside the window is read again and returns): rule on it in a comment, and close this card when all are ruled.',
      `Rows on a card closed within the last ${AUDIT_CARD.ruledHorizonDays} days by an authorized approver's account, with no closing commit, count as`,
      'ruled and are not announced again; a card closed by any other account, by a closing keyword or as a duplicate rules nothing.',
      '',
      ...priorLines,
      ...breachLines,
      ...renderAuditUnreadSection(unread, stderrTail, unreadShown, withStderr),
      ...ruledLines,
      `${AUDIT_CARD.footer} of the run above (kept 30 days). Re-read the week by`,
      `${AUDIT_CARD.footerTail} --since 7d --repos objectstack\` from a fresh \`origin/main\`.`,
    ].join('\n');
    return { body, shown: shown.length, liveShown, overflow, dropped };
  };
  let breachShown = Math.min(AUDIT_CARD.breachCap, breachRows.length);
  let unreadShown = Math.min(AUDIT_CARD.unreadCap, unread.length);
  let withStderr = true;
  let out = render(breachShown, unreadShown, withStderr);
  while (out.body.length > AUDIT_CARD.bodyChars) {
    if (withStderr && stderrTail) withStderr = false;
    else if (unreadShown > 0) unreadShown -= 1;
    else if (breachShown > 0) breachShown -= 1;
    else break;
    out = render(breachShown, unreadShown, withStderr);
  }

  if (!existing) {
    return { action: 'create', body: out.body, notice: `${meta?.verdict} — a new card is filed.` };
  }
  // Only a row that made it onto the card is "new to this card"; one that did not fit is named with the dropped.
  const shownKeys = new Set(breachRows.slice(0, out.shown).map((r) => r.key));
  const fresh = live.filter((b) => !onCard.has(b.key) && shownKeys.has(b.key)).map((b) => b.key);
  const again = live.filter((b) => onCard.has(b.key)).length;
  const keyList = (rows) => (rows.length > AUDIT_CARD.droppedKeysCap
    ? `${rows.slice(0, AUDIT_CARD.droppedKeysCap).map((r) => r.key).join(', ')} and ${rows.length - AUDIT_CARD.droppedKeysCap} more`
    : rows.map((r) => r.key).join(', '));
  const comment = [
    `Weekly governed-merges audit refreshed this card — [run log](${meta?.runUrl}) · trigger \`${meta?.event}\` · sweep exit ${meta?.exit || '(not recorded)'} · verdict \`${meta?.verdict}\`.`,
    '',
    `- ⛔ BREACH rows new to this card: ${fresh.length > 0 ? fresh.join(', ') : 'none'}.`,
    `- BREACH rows read again by this run: ${again}; carried from earlier runs: ${out.shown - out.liveShown} on the card. They stay until this card is closed.`,
    ...(out.overflow > 0 ? [
      `- ⚠️ ${out.overflow} BREACH row(s) did not fit the card and are NOT carried${out.dropped.some((r) => r.live) ? `; read by this run (in its run log and artifact): ${keyList(out.dropped.filter((r) => r.live))}` : ''}${out.dropped.some((r) => !r.live) ? `; carried from earlier runs and held by no run's reading, so this comment is their last record: ${keyList(out.dropped.filter((r) => !r.live))}` : ''}.`,
    ] : []),
    ...(alreadyRuled.length > 0 ? [`- Read again but already ruled, so not announced: ${alreadyRuled.map((b) => `${b.key} (card #${ruled.get(b.key)})`).join(', ')}.`] : []),
    `- Lines under the BREACH heading that carried no row key (hand-edited, so not carried): ${read.unkeyed}.`,
    `- Keyed rows outside every section this audit reads (a reworded heading, or a row moved out of its section), so not carried: ${read.stray.length}${read.stray.length > 0 ? ` (${read.stray.join(', ')})` : ''}.`,
    ...(read.footer ? [] : ['- ⚠️ This card\'s footer was not found, so its last section was read to the end of the body.']),
    ...(read.openFence ? ['- ⚠️ A fenced block on this card is never closed, so every line after its opening marker went unread (rows there are not carried).'] : []),
    ...(unruled.length > 0 ? [`- Closed audit cards whose close rules nothing: ${unruled.map((u) => `#${u.number} (${u.why})`).join('; ')}.`] : []),
    `- NOT MEASURED readings in this run: ${unread.length}${unread.length > 0 ? ' (listed in the body; a clean manual re-run answers those it can read)' : ''}.`,
  ].join('\n');
  return { action: 'update', body: out.body, comment, notice: `${meta?.verdict} — card #${existing.number} refreshed (${fresh.length} new BREACH, ${out.shown - out.liveShown} carried).` };
}

/** The approvers whose hand close is a ruling: the queue guard's `GOVERNED_APPROVERS`, loaded lazily as the arm is. */
export async function loadAuditRulingAccounts(load = (specifier) => import(specifier)) {
  try {
    const guard = await load(ARM_READER_SOURCE);
    const accounts = guard?.GOVERNED_APPROVERS;
    if (!Array.isArray(accounts) || accounts.length === 0) return { available: false, accounts: [], reason: `${ARM_READER_SOURCE} exports no GOVERNED_APPROVERS list` };
    return { available: true, accounts: [...accounts] };
  } catch (error) {
    return { available: false, accounts: [], reason: `${ARM_READER_SOURCE} would not load: ${String(error?.message ?? error).split('\n')[0]}` };
  }
}

/**
 * The refresh's write order, read off the job's own card step (#33814 N9): the comment is posted BEFORE the body
 * is rewritten, so a failed comment leaves the old body and the next run announces the rows again, never the
 * reverse (a new body with its announcement lost). `null` when the order holds, else the fault.
 */
export function auditRefreshOrderFault(stepText) {
  const s = String(stepText ?? '');
  const comment = s.indexOf('issues.createComment(');
  const update = s.indexOf('issues.update(');
  if (comment < 0 || update < 0) return 'the card step names no `issues.createComment(` or no `issues.update(` call';
  return comment < update ? null : 'the card step rewrites the body before it posts the comment that announces the refresh';
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const invokedDirectly = isEntrypoint(import.meta.url);

/** The tree a provenance recompute — and `--branch`'s git — runs against. */
function rootFromArgs(args) {
  const rootIdx = args.indexOf('--root');
  return resolve(rootIdx > -1 && args[rootIdx + 1] ? args[rootIdx + 1] : resolve(scriptDir, '..', '..'));
}

/**
 * The verdict half, shared by every mode that asks the register a question:
 * `--test` with the caller's list, `--pr` and `--branch` with one they derived.
 *
 * ⭐ ONE emitter is the point of #17003's fix. The answer must not depend on
 * how the list was obtained — a derivation that also reworded the verdict would
 * leave two readings of the same register in circulation, which is the shape
 * the card is about. `--self-test` pins the identity end to end.
 */
async function emitVerdict(paths, args, derivation = null, size = null, intake = null, repo = undefined, workflowDiff = null, lowRisk = null) {
  let verdict = testVerdict(paths, { repo, size, ...(intake ?? {}), workflowDiff, lowRisk });
  // The provenance-aware exceptions (#9866 + #11705): recompute only when a
  // registered path is actually among the hits, so every other run stays the
  // zero-git, zero-cost read it always was. The driver applies each row's
  // #11084 co-edit fence before spending anything — a diff that edits a
  // generator alongside its artifact would otherwise certify itself.
  const hitsByEntry = groupHitsByException(verdict.hitPaths);
  if (hitsByEntry.size > 0) {
    verdict = applyGeneratedExceptions(
      verdict,
      await recomputeProvenanceFor(rootFromArgs(args), hitsByEntry, { allPaths: paths }),
    );
  }
  if (args.includes('--json')) console.log(JSON.stringify(derivation ? { ...verdict, derivation } : verdict, null, 2));
  else console.log(renderTestVerdict(verdict));
  // Either limb exits on the GOVERNED code (header: the SIZE predicate) — one
  // code, so every caller that routes 3 to the human terminal routes both.
  return landsByHumanMerge(verdict) ? EXIT_TEST_GOVERNED : EXIT_TEST_NOT_GOVERNED;
}

/** The two flags the SIZE limb takes from a caller, and the words for a half pair. */
export const SIZE_FLAGS = Object.freeze(['--additions', '--deletions']);

/**
 * `--additions <n> --deletions <n>` off argv: both (the pair), neither (no
 * size — NOT MEASURED downstream), or a refusal. Pure. Half a pair is refused
 * rather than read as a zero on the missing side: the count is their SUM, and
 * a zero nobody typed would read as under the threshold.
 */
export function readSizeFlags(args) {
  const read = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return { present: false, raw: null, n: null };
    const raw = args[i + 1];
    const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
    return { present: true, raw: raw ?? null, n };
  };
  const a = read('--additions');
  const d = read('--deletions');
  if (!a.present && !d.present) return { ok: true, size: null };
  if (!a.present || !d.present) {
    return {
      ok: false,
      error:
        `--additions and --deletions travel together (the count is their SUM; half a pair is no reading) — ` +
        `got only ${a.present ? '--additions' : '--deletions'}.`,
    };
  }
  if (a.n === null || d.n === null) {
    return { ok: false, error: `--additions / --deletions want non-negative integers; got '${a.raw}' / '${d.raw}'.` };
  }
  return { ok: true, size: { additions: a.n, deletions: d.n, source: '--additions/--deletions, from the CALLER' } };
}

/** A derived mode handed the size flags is two readings of one number — refused, like two mode flags. */
function refuseSizeFlagsIn(args, mode, reads) {
  if (!SIZE_FLAGS.some((f) => args.includes(f))) return null;
  console.error(
    `❌  ${mode} reads the size itself (${reads}); --additions/--deletions beside it would be two readings of one ` +
      `number, and this predicate answers on one. Drop the flags, or ask --test with them.`,
  );
  return EXIT_CANNOT_SWEEP;
}

/**
 * The repository a `--test` / `--branch` run answers for: the one the checkout
 * at `--root` belongs to, read off its `origin` remote and resolved to a
 * `GOVERNED_REPOS` id — the same reading a bare `--pr <n>` already makes of
 * "this checkout's own repository". The register is scoped per row, so the
 * question has a repository in it; this tool takes none from a flag (the
 * closed-argv ruling: one spelling, `--pr <owner>/<repo>#<n>`, no `--repo`)
 * and none from the environment, so the checkout is the only honest source. A
 * path list from another governed repository is judged from THAT repository's
 * checkout (`--root <its path>`); an origin that parses to no governed
 * repository is a refusal, never a default. Pure given `origin` (the
 * `remote.origin.url` read, or null). Returns `{ repo, slug }` or `{ error }`.
 */
export function checkoutRepoFor(origin, mode) {
  const slug = slugFromRemote(origin);
  const repo = slug ? repoIdForSlug(slug) : null;
  if (repo) return { repo, slug };
  const ids = GOVERNED_REPOS.map((r) => r.id).join(', ');
  const read = typeof origin === 'string' && origin.trim() !== '' ? JSON.stringify(origin.trim()) : 'no origin remote';
  return {
    error:
      `${mode} answers for the repository the checkout at --root belongs to, and that checkout's origin (${read}) ` +
      `${slug ? `names ${slug}, which is not a governed repository` : 'parses to no owner/name'} — the governed ` +
      `repositories are ${ids}. The register is scoped per row, so the question has a repository in it: run from a ` +
      'checkout of the repository the paths are in, or point --root at one.',
  };
}

/** The stderr line naming the repository a checkout-derived verdict answers for, beside the caller notes. */
export function checkoutRepoNote({ repo, slug }) {
  return (
    `ℹ️  judged for ${repo} (${slug}, the checkout at --root): the register is scoped per row, so a list from another\n` +
    '    governed repository is judged from that repository\'s own checkout — `--root <its path>`.'
  );
}

async function runTestMode(args) {
  const i = args.indexOf('--test');
  const paths = [];
  const tail = args.slice(i + 1);
  for (let j = 0; j < tail.length; j++) {
    // `--root <path>`'s and the size flags' values are flag arguments, not PR paths.
    if (tail[j] === '--root' || SIZE_FLAGS.includes(tail[j])) { j++; continue; }
    if (tail[j].startsWith('--')) continue;
    paths.push(tail[j]);
  }
  const flags = readSizeFlags(args);
  if (!flags.ok) {
    console.error(`❌  ${flags.error}`);
    return EXIT_CANNOT_SWEEP;
  }
  if (paths.length === 0) {
    console.error(
      `❌  --test wants the PR's changed paths, and got none. An empty path list is a failure, never\n` +
        `    a "not governed" answer. Derive the list rather than typing it — best of all, let this\n` +
        `    script derive it and say how:\n` +
        `      node scripts/pm/check-governed-merges.mjs --pr <n>\n` +
        `      node scripts/pm/check-governed-merges.mjs --branch <ref>\n` +
        `      node scripts/pm/check-governed-merges.mjs --test $(gh pr diff --name-only <pr>)`,
    );
    return EXIT_CANNOT_SWEEP;
  }
  // The repository (ruling B2): the checkout at --root, or a refusal.
  const root = rootFromArgs(args);
  const origin = tryGit(root, ['config', '--get', 'remote.origin.url']);
  const where = checkoutRepoFor(origin.ok ? origin.out : null, '--test');
  if (where.error) {
    console.error(`❌  ${where.error}`);
    return EXIT_CANNOT_SWEEP;
  }
  // #17003: on STDERR, so this mode's STDOUT stays byte-identical in both
  // renderings for any consumer that parses it (the `--json` form is a
  // machine-read surface). A predicate that changes what it hands its callers in
  // order to warn its humans has broken something in order to say something.
  console.error(CALLER_DERIVED_NOTE);
  if (flags.size) console.error(CALLER_SIZED_NOTE);
  console.error(checkoutRepoNote(where));
  return await emitVerdict(paths, args, null, flags.size, null, where.repo);
}

/** `--branch <ref>` (#17003): the three-dot list from a local checkout, or a refusal. */
async function runBranchMode(args) {
  const ref = args[args.indexOf('--branch') + 1];
  if (!ref || ref.startsWith('--')) {
    console.error('❌  --branch wants a git ref (`--branch claude/issue-17003-x`); it got none.');
    return EXIT_CANNOT_SWEEP;
  }
  const refusedFlags = refuseSizeFlagsIn(args, `--branch ${ref}`, '`git diff --numstat` on the merge-base range');
  if (refusedFlags !== null) return refusedFlags;
  const root = rootFromArgs(args);
  // The repository (ruling B2): the checkout the branch is read from, or a refusal.
  const origin = tryGit(root, ['config', '--get', 'remote.origin.url']);
  const where = checkoutRepoFor(origin.ok ? origin.out : null, `--branch ${ref}`);
  if (where.error) {
    console.error(`❌  ${where.error}`);
    return EXIT_CANNOT_SWEEP;
  }
  const derived = deriveBranchPaths({ ref, run: (argv) => tryGit(root, argv) });
  if (!derived.ok) {
    console.error(renderDerivationRefusal({ mode: `--branch ${ref}`, reason: derived.reason, remedy: derived.remedy }));
    return EXIT_CANNOT_SWEEP;
  }
  if (derived.paths.length === 0) {
    console.error(
      `❌  --branch ${ref} derived ZERO paths — it changes nothing against its merge base with ` +
        `${derived.derivation.base}. An empty list is a failure, never a "not governed" answer.`,
    );
    return EXIT_CANNOT_SWEEP;
  }
  if (!args.includes('--json')) console.log(renderDerivation(derived.derivation));
  console.error(checkoutRepoNote(where));
  // The `workflows` split reads the same merge-base range the path list came from.
  const workflowDiff = derived.paths.some((p) => p.startsWith(WORKFLOWS_PREFIX))
    ? readWorkflowDiff({ paths: derived.paths, base: derived.derivation.mergeBase, head: derived.derivation.refSha, git: (argv) => git(root, argv) })
    : null;
  return await emitVerdict(derived.paths, args, derived.derivation, derived.size, null, where.repo, workflowDiff);
}

/**
 * `--pr`'s reading for the `workflows` split: the PR's own head and base
 * commits, read from THIS checkout when it is the PR's repository and holds
 * both — the API's patch text is no tree, so nothing else is read. Anything
 * short of that is an unmeasured reading (Tier H) naming the fetch that cures it.
 */
export function pullWorkflowDiff({ derivation, paths, sameCheckout, run, git: readGit }) {
  const unmeasured = (reason) => ({ measured: false, reason, base: null, head: derivation?.headSha ?? null, files: [] });
  const headSha = derivation?.headSha;
  const baseSha = derivation?.baseSha;
  if (!sameCheckout) return unmeasured('the PR is not in the repository this checkout holds, so its commits cannot be read here');
  if (!isObjectId(headSha) || !isObjectId(baseSha)) return unmeasured('the PR object named no head or base commit');
  const missing = [headSha, baseSha].filter((sha) => !run(['cat-file', '-e', `${sha}^{commit}`]).ok);
  if (missing.length > 0) return unmeasured(`${missing.map((sha) => sha.slice(0, 10)).join(' and ')} not in this checkout — ${pullFetchHint(derivation, missing)}`);
  const mergeBase = run(['merge-base', baseSha, headSha]);
  if (!mergeBase.ok || !isObjectId(mergeBase.out)) return unmeasured('no merge base of the PR head and its base could be computed here (a shallow clone?)');
  return readWorkflowDiff({ paths, base: mergeBase.out, head: headSha, git: readGit });
}

/** `--pr <n>` (#17003): the API's changed-files list — three-dot by construction — or a refusal. */
async function runPullMode(args) {
  const raw = args[args.indexOf('--pr') + 1];
  const refusedFlags = refuseSizeFlagsIn(args, `--pr ${raw}`, 'the `additions` / `deletions` pair on the PR object');
  if (refusedFlags !== null) return refusedFlags;
  const root = rootFromArgs(args);
  const origin = tryGit(root, ['config', '--get', 'remote.origin.url']);
  const selfSlug = origin.ok ? slugFromRemote(origin.out) : null;
  const target = parsePullTarget(raw && !raw.startsWith('--') ? raw : '', selfSlug);
  if (target.error) {
    console.error(`❌  ${target.error}`);
    return EXIT_CANNOT_SWEEP;
  }
  // #21675: a bare number beside a PM_SWEEP_REPO naming another repository is
  // refused before the first read — the variable never redirects the answer.
  const ambiguous = bareTargetRefusal({ raw, target, sweepRepo: process.env.PM_SWEEP_REPO });
  if (ambiguous !== null) {
    console.error(ambiguous);
    return EXIT_CANNOT_SWEEP;
  }
  // The repository (ruling B2): the one `--pr` names, resolved to its register
  // id. A slug outside GOVERNED_REPOS has no rows scoped to it, so the answer
  // is a refusal — never "not governed", which reads as a clearance.
  const repo = repoIdForSlug(target.slug);
  if (repo === null) {
    console.error(
      `❌  --pr ${target.slug}#${target.pull} names a repository outside the governed register ` +
        `(${GOVERNED_REPOS.map((r) => r.id).join(', ')}). The register is scoped per row and has no row for it, so ` +
        'there is no governed answer for that pull request — this predicate judges the governed repositories only.',
    );
    return EXIT_CANNOT_SWEEP;
  }
  const derived = await fetchPullFiles({
    ...apiContext(process.env),
    slug: target.slug,
    pull: target.pull,
    channels: attributionChannels(process.env),
  });
  if (!derived.ok) {
    console.error(
      renderDerivationRefusal({ mode: `--pr ${target.slug}#${target.pull}`, reason: derived.reason, remedy: derived.remedy }),
    );
    return EXIT_CANNOT_SWEEP;
  }
  if (derived.paths.length === 0) {
    console.error(
      `❌  ${target.slug}#${target.pull} reports no changed files at all. An empty list is a failure, ` +
        `never a "not governed" answer.`,
    );
    return EXIT_CANNOT_SWEEP;
  }
  if (!args.includes('--json')) console.log(renderDerivation(derived.derivation));
  const workflowDiff = derived.paths.some((p) => p.startsWith(WORKFLOWS_PREFIX))
    ? pullWorkflowDiff({ derivation: derived.derivation, paths: derived.paths, sameCheckout: target.slug === selfSlug, run: (argv) => tryGit(root, argv), git: (argv) => git(root, argv) })
    : null;
  // The arm's changesets, read at the PR's head from this checkout, as the workflow split reads its trees.
  const lowRisk = derived.lowRisk && lowRiskRowHit(derived.paths)
    ? {
        ...derived.lowRisk,
        changesets: pullChangesetReading({ derivation: derived.derivation, paths: derived.paths, sameCheckout: target.slug === selfSlug, run: (argv) => tryGit(root, argv) }),
        catalogFiles: pullCatalogReading({ derivation: derived.derivation, statuses: derived.catalogStatuses, paths: derived.paths, sameCheckout: target.slug === selfSlug, run: (argv) => tryGit(root, argv) }),
      }
    : derived.lowRisk ?? null;
  // ⭐ The arm's record stage: the readers load and the threads are read only when the stage is pending, over the
  // channel that read the PR (a token rides only on the env-token channel, as the sweep's arm leg sends it).
  const sameCheckout = target.slug === selfSlug;
  const staged = await pullRecordStage({
    lowRisk,
    paths: derived.paths,
    repo,
    workflowDiff,
    pullHead: derived.pullHead,
    derivation: derived.derivation,
    readers: () => loadArmReaders(),
    fetchers: (guard) => {
      const token = derived.derivation.channel === 'env-token' ? process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null : null;
      const api = { ...apiContext(process.env), slug: target.slug, token };
      return { fetchComments: guard.makeCommentReader(api), fetchLabels: guard.makeLabelReader(api), fetchTimeline: guard.makeTimelineReader(api) };
    },
    runGit: sameCheckout ? (argv) => git(root, argv) : null,
  });
  return await emitVerdict(derived.paths, args, derived.derivation, derived.size, { fork: derived.fork, checks: derived.checks }, repo, workflowDiff, staged);
}

/**
 * The transport re-arm, shared by the sweep's attribution and `--pr`'s
 * changed-files read (#9642): a proxied run whose fetch bypasses the proxy
 * answers 401/403 on every channel and reads as a credential problem. The flag
 * has to be set at process start, so re-exec. Returns the child's exit status,
 * or null when this process should carry on and do the work itself.
 */
function rearmProxyOrNull(args, what, whatLower) {
  const rearm = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
    guard: PROXY_REARM_GUARD,
  });
  // ⭐ A suppressed re-exec SPEAKS here (#18989). Both `hint` branches — an
  // older node, and a guard already set — used to return through the
  // `!rearm.rearm` line below without printing anything, so the only place the
  // hint ever reached a reader was the sweep's INCOMPLETE banner, and only when
  // the incompleteness was about attribution. Every other mode bypassed the
  // proxy in silence and reported the resulting 401 as the container's verdict.
  if (rearm.hint) {
    console.error(`⚠️  ${rearm.reason}. ${what} below may be answered by the ROUTE, not by the credential.`);
    return null;
  }
  if (!rearm.rearm) return null;
  console.error(`ℹ️  re-exec with ${rearm.flag}: ${rearm.reason}. ${what} would otherwise fail on every channel.`);
  // The proxy agent is experimental and says so once per run; the operator
  // cannot act on that notice, so keep it out of the report where the node
  // in use can silence it by code.
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [rearm.flag, ...quiet, scriptPath, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${rearm.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — ${whatLower} may fail.`);
  return null;
}

/**
 * The sweep's INCOMPLETE banner, and the exit code that belongs with it
 * (#18055).
 *
 * Lifted out of `main()`, and its shape IS the reason: the banner is built
 * inside a `console.error` ARGUMENT, so anything that throws while building
 * that argument deletes the call and the `return` behind it — the reader is
 * handed a full findings list, a complete-looking tail note, and no
 * incompleteness warning on either stream. That is exactly what an unbound
 * `rearm` did here. `main()` reads git and the network and cannot be driven
 * down the attribution-failure path offline, so the banner owns a function
 * that can be: the re-arm plan its hint branch reads arrives as an argument,
 * and `emit` is the sink, defaulting to the stream the sweep prints on.
 *
 * ⛔ Behaviour is unchanged — same words, same order, same stream, same exit
 * code. Rewording any string here rewords a verdict a maintainer acts on.
 *
 * @param {{ unaudited: { slug: string, precondition?: string }[],
 *           edged: { slug: string }[],
 *           attributionFailed: boolean,
 *           rearm: { hint?: boolean, reason?: string } }} state
 * @param {(banner: string) => void} emit  where the banner goes; stderr in the sweep
 * @returns {number} EXIT_INCOMPLETE — the classification the banner announces
 */
function reportSweepIncomplete({ unaudited, edged, attributionFailed, rearm, armUnmeasured = 0 }, emit = console.error) {
  const why = [];
  // The footer names WHICH precondition failed per repo (#13836): two
  // footers minutes apart used to differ only by a slug list, so a repo
  // dropped between identical invocations was attributable only by
  // cross-run diffing against the rows above the fold.
  if (unaudited.length > 0) why.push(`${unaudited.length} governed repo(s) unaudited (${unaudited.map((r) => `${r.slug}: ${r.precondition ?? 'unstated'}`).join(', ')})`);
  if (edged.length > 0) why.push(`${edged.length} governed repo(s) at the WINDOW EDGE (${edged.map((r) => r.slug).join(', ')}) — the boundary could not be proven`);
  if (attributionFailed) why.push('at least one entry has no merged_by reading on any channel');
  if (armUnmeasured > 0) why.push(`${armUnmeasured} skills landing(s) whose low-risk arm reading or record could not be read — listed with the maintainer's merges, unjudged`);
  emit(
    `\n⚠️  sweep INCOMPLETE — ${why.join('; ')}. The list above is printed, but it must not read as\n` +
      `    clean (#4690): "does the maintainer recognise every entry" cannot be answered over repos that\n` +
      `    were never looked at, windows whose boundary could not be proven, or entries with no\n` +
      `    who-merged-it column.` +
      (attributionFailed && rearm.hint
        ? `\n    ⚠️  ${rearm.reason} — node's fetch is bypassing the session proxy, which answers 401/403 here.\n` +
          `        Re-run as NODE_OPTIONS=${PROXY_FLAG} before concluding anything about credentials (#9642).`
        : ''),
  );
  return EXIT_INCOMPLETE;
}

/** The three ways to ask the register one question. Exactly one per run. */
const PREDICATE_MODES = ['--test', '--pr', '--branch'];

// ── The argv is CLOSED, per mode (#21675) ───────────────────────────────────
//
// Every flag each mode reads, and how it takes its value: `value` consumes the
// next argument, `list` is `--test`'s path list (every non-flag argument after
// it), `switch` takes none. A flag the RUNNING mode does not read is a usage
// refusal on exit 1 — the refusal `label-write.mjs`, `post-stamped.mjs` and
// `issue-create.mjs` already make — because an ignored flag does not stop the
// run: it prints a verdict about a question nobody asked, under the same ✅ as
// a real answer. Measured at filing: `--pr 11590 --repo objectstack-ai/objectui`
// read objectstack's PR 11590 (7 files) and answered NOT governed for an
// objectui PR of 18.
//
// PER MODE, not one tool-wide list: `--repos objectui` is a real flag of the
// sweep, and beside `--pr 11590` it was ignored in exactly the same way; so was
// `--since 7d` beside `--test`, whose value then joined the path list.
//
// `--additions`/`--deletions` are listed for `--pr` and `--branch` although
// neither mode takes them: each refuses them in its own, older words
// (`refuseSizeFlagsIn` — two readings of one number), so this table lets them
// through to that refusal rather than replacing it.
//
// ⛔ No mode reads a repository from anywhere but its own spelling: `--pr`
// names one inline (`<owner>/<repo>#<n>`), the sweep narrows by `--repos`,
// and `--test` / `--branch` answer for the checkout at `--root` (its origin —
// `checkoutRepoFor`), which is what the per-row scope of the register makes
// them need. There is no `--repo` here, by ruling — one spelling, the
// documented one — and the environment's half is `bareTargetRefusal`.
export const ARGV_MODES = Object.freeze({
  sweep: Object.freeze({
    name: 'the sweep',
    flags: Object.freeze({ '--since': 'value', '--since-ref': 'value', '--repos': 'value', '--repo-root': 'value', '--root': 'value', '--json': 'switch' }),
    usage: '[--since <7d|36h|ISO date>] [--since-ref [<id>=]<ref>]… [--repos <id>,…] [--repo-root <id>=<path>]… [--root <path>] [--json]',
  }),
  '--test': Object.freeze({
    name: '--test',
    flags: Object.freeze({ '--test': 'list', '--additions': 'value', '--deletions': 'value', '--root': 'value', '--json': 'switch' }),
    usage: '--test <path>… [--additions <n> --deletions <n>] [--root <path>] [--json]',
  }),
  '--pr': Object.freeze({
    name: '--pr',
    flags: Object.freeze({ '--pr': 'value', '--root': 'value', '--json': 'switch', '--additions': 'value', '--deletions': 'value' }),
    usage: '--pr <n> | --pr <owner>/<repo>#<n>   [--root <path>] [--json]',
  }),
  '--branch': Object.freeze({
    name: '--branch',
    flags: Object.freeze({ '--branch': 'value', '--root': 'value', '--json': 'switch', '--additions': 'value', '--deletions': 'value' }),
    usage: '--branch <ref> [--root <path>] [--json]',
  }),
});

/** How every prescription below spells this tool. */
const SELF_COMMAND = 'node scripts/pm/check-governed-merges.mjs';

/**
 * The flags in `args` that `mode` does not read, in order. Pure. A token is a
 * flag when it starts with `-` followed by anything but a digit (a lone `-` and
 * a negative number are values). A `value` flag consumes the next argument
 * unless that argument is itself a `--` flag, so `--pr --bogus` still names
 * `--bogus` rather than swallowing it as a PR number.
 */
export function unreadFlagsIn(args, mode) {
  const flags = ARGV_MODES[mode]?.flags ?? {};
  const unread = [];
  for (let i = 0; i < args.length; i++) {
    const token = String(args[i]);
    if (!/^-(?:-|\D)/.test(token)) continue; // a value, a --test path, a lone `-`, a negative number
    if (!Object.hasOwn(flags, token)) {
      unread.push(token);
      continue;
    }
    if (flags[token] === 'value' && i + 1 < args.length && !String(args[i + 1]).startsWith('--')) i += 1;
  }
  return unread;
}

/**
 * The words for a run carrying flags its mode does not read, or null when it
 * carries none. Pure; `main()` prints them on stderr and exits 1 before any git
 * read, any network read, or any verdict.
 *
 * `--repo` gets the prescription the ruling asks for: it is the spelling that
 * produced the measured wrong answer, and beside a bare `--pr <n>` the fix is
 * the qualified number, spelled out with the caller's own repository and PR.
 */
export function argvRefusal(args, mode) {
  const unread = unreadFlagsIn(args, mode);
  if (unread.length === 0) return null;
  const spec = ARGV_MODES[mode];
  const names = unread.map((f) => `\`${f}\``).join(', ');
  const lines = [
    `❌  ${names} ${unread.length === 1 ? 'is not a flag' : 'are not flags'} ${spec.name} reads. An unrecognised flag is REFUSED, never ignored:`,
    '    an ignored flag still lets the run print a verdict, about a question nobody asked, under the same ✅ as a',
    '    real answer.',
  ];
  const repoFlag = unread.find((f) => f === '--repo' || f.startsWith('--repo='));
  if (repoFlag) {
    const at = args.indexOf(repoFlag);
    const value = repoFlag.includes('=') ? repoFlag.slice(repoFlag.indexOf('=') + 1) : args[at + 1];
    const id = GOVERNED_REPOS.find((r) => r.id === value);
    const repo = id ? id.slug : typeof value === 'string' && /^[\w.-]+\/[\w.-]+$/.test(value) ? value : '<owner>/<repo>';
    const prAt = args.indexOf('--pr');
    const bare = prAt > -1 ? /^#?(\d+)$/.exec(String(args[prAt + 1] ?? '').trim()) : null;
    if (mode === '--pr' && bare) {
      lines.push(
        `    This tool takes no \`--repo\`, and a bare \`--pr ${bare[1]}\` answers THIS checkout's own repository whatever`,
        '    `--repo` names. Name the repository inside --pr, the one spelling it takes:',
        `      ${SELF_COMMAND} --pr ${repo}#${bare[1]}`,
      );
    } else {
      lines.push(`    This tool takes no \`--repo\`: \`--pr\` names its repository inline (\`--pr ${repo}#<n>\`), and the sweep narrows by \`--repos <id>,…\`.`);
    }
  }
  for (const f of unread) {
    const eq = f.indexOf('=');
    const name = eq > 0 ? f.slice(0, eq) : null;
    if (name && Object.hasOwn(spec.flags, name) && spec.flags[name] === 'value') {
      lines.push(`    ${name} takes its value as the NEXT argument — \`${name} ${f.slice(eq + 1)}\`, never \`${f}\`.`);
    }
  }
  lines.push(`    ${spec.name} reads:  ${SELF_COMMAND} ${spec.usage}`);
  lines.push('    usage — each mode reads its own flags and refuses every other:');
  for (const m of Object.values(ARGV_MODES)) lines.push(`      ${SELF_COMMAND} ${m.usage}`);
  lines.push(`      ${SELF_COMMAND} --self-test`);
  return lines.join('\n');
}

/**
 * A bare `--pr <n>` answers THIS checkout's own repository — the slug its
 * origin parses to, `objectstack-ai/objectstack` wherever this tool lives — and
 * nothing in the environment moves it. `PM_SWEEP_REPO` is how the board tools
 * are told which repository they answer, so a seat with it set is a seat that
 * believes it has said which repository it means; read here ONLY to refuse,
 * never to change the answer (one spelling: the qualified number). Returns the
 * refusal words when a bare number meets a `PM_SWEEP_REPO` naming any other
 * repository, or null. Pure.
 *
 * A qualified `<owner>/<repo>#<n>` names its own repository and is answered as
 * it always was, whatever the environment says.
 */
export function bareTargetRefusal({ raw, target, sweepRepo }) {
  if (!target || target.error) return null;
  const bare = /^#?(\d+)$/.exec(String(raw ?? '').trim());
  if (!bare) return null;
  const named = String(sweepRepo ?? '').trim();
  if (named === '' || named.toLowerCase() === String(target.slug).toLowerCase()) return null;
  const spelled = /^[\w.-]+\/[\w.-]+$/.test(named) ? named : '<owner>/<repo>';
  return [
    `❌  --pr ${bare[1]} is a bare number, and a bare number answers THIS checkout's own repository (${target.slug}) —`,
    `    but PM_SWEEP_REPO names ${named}. This tool takes no repository from the environment, so the run is`,
    '    refused rather than answered about a different PR in a different repository. Name the repository',
    '    inside --pr, the one spelling it takes:',
    `      ${SELF_COMMAND} --pr ${spelled}#${target.pull}`,
    "    or, if this checkout's own PR is the one you mean:",
    `      ${SELF_COMMAND} --pr ${target.slug}#${target.pull}`,
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  // ⛔ One list per run. Two mode flags would ask the same question about two
  // different lists and print one verdict — the ambiguity #17003 is about.
  const modes = PREDICATE_MODES.filter((m) => args.includes(m));
  if (modes.length > 1) {
    console.error(
      `❌  ${modes.join(' and ')} each name a DIFFERENT file list, and this predicate answers about one. ` +
        `Run them separately.`,
    );
    return EXIT_CANNOT_SWEEP;
  }
  // ⛔ Closed argv (#21675): a flag this mode does not read is refused here,
  // before any git read, network read or child process — never ignored.
  const unreadRefusal = argvRefusal(args, modes[0] ?? 'sweep');
  if (unreadRefusal !== null) {
    console.error(unreadRefusal);
    return EXIT_CANNOT_SWEEP;
  }
  if (args.includes('--test')) return await runTestMode(args);
  if (args.includes('--branch')) return await runBranchMode(args);
  if (args.includes('--pr')) {
    const rearmed = rearmProxyOrNull(args, 'The changed-files read', 'the changed-files read');
    if (rearmed !== null) return rearmed;
    return await runPullMode(args);
  }

  const argOf = (name) => {
    const i = args.indexOf(name);
    return i > -1 ? args[i + 1] : null;
  };
  const argsOf = (name) => args.map((a, i) => (a === name ? args[i + 1] : null)).filter((v) => v != null);

  const selfRoot = resolve(argOf('--root') ?? resolve(scriptDir, '..', '..'));
  const ref = 'origin/main';

  const overrides = {};
  for (const pair of argsOf('--repo-root')) {
    const eq = pair.indexOf('=');
    if (eq < 1) {
      console.error(`❌  --repo-root wants <id>=<path>; got '${pair}'.`);
      return EXIT_CANNOT_SWEEP;
    }
    overrides[pair.slice(0, eq)] = resolve(pair.slice(eq + 1));
  }

  const only = (argOf('--repos') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  const known = new Set(GOVERNED_REPOS.map((r) => r.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    console.error(`❌  --repos names no governed repo: ${unknown.join(', ')}. Known: ${[...known].join(', ')}.`);
    return EXIT_CANNOT_SWEEP;
  }
  const repoSet = only.length > 0 ? GOVERNED_REPOS.filter((r) => only.includes(r.id)) : GOVERNED_REPOS;

  // The checkouts resolve BEFORE the window (#13424): the window's fallback
  // date is derived per repo, so the resolver needs to know where each repo's
  // checkout is. This runs again in the re-exec'd child (below) — a handful of
  // local `git rev-parse`/`config` reads per repo, paid twice by design rather
  // than threaded through an exec boundary.
  const repos = resolveRepoCheckouts({
    repos: repoSet,
    selfRoot,
    siblingDir: dirname(selfRoot),
    overrides,
    probe: probeCheckout,
  });
  const repoById = new Map(repos.map((r) => [r.id, r]));

  // The window (#12633). `--since-ref` is topological and `--since` is a date
  // boundary backed off by the declared skew budget; both are resolved here as
  // data so the report can SAY which one it ran and what it cost. Each ref
  // resolves in ITS OWN repo's checkout (#13424), never only in the self one.
  const window = resolveWindow({
    sinceRefArgs: argsOf('--since-ref'),
    sinceArg: argOf('--since'),
    repoIds: repoSet.map((r) => r.id),
    resolveRefDate: (r, repoId) => {
      const repo = repoById.get(repoId);
      if (!repo) return null;
      try {
        return git(repo.path, ['log', '-1', '--format=%cI', `${r}^{commit}`]).trim() || null;
      } catch {
        return null;
      }
    },
  });
  if (window.error) {
    console.error(`❌  ${window.error}`);
    return EXIT_CANNOT_SWEEP;
  }

  // Transport before credentials, and only once every argument has validated
  // (a bad-arg run must not pay for a child process): a proxied run whose fetch
  // bypasses the proxy answers 401/403 on every channel and reads as a token
  // problem (#9642). The flag has to be set at process start, so re-exec.
  const rearmed = rearmProxyOrNull(args, 'Attribution', 'attribution');
  if (rearmed !== null) return rearmed;

  const entries = [];
  const pathsBySha = new Map(); // every path of each listed landing, for the arm leg's allowlist (#33603)
  let scanned = 0;
  for (const repo of repos) {
    if (repo.status !== 'audited') continue;
    let commits;
    try {
      const [sha, date] = git(repo.path, ['log', '-1', '--format=%H%x09%cI', ref]).trim().split('\t');
      repo.tip = { sha, date };
      // Before enumerating anything: is this checkout a LIVE mirror of the
      // repo it claims to audit? (#13307) Asked of every repo in every window
      // mode, and asked FIRST — a horizon reading over a dead snapshot is a
      // true statement about the wrong tree. One `git ls-remote`, zero API
      // calls, and it answers reachability and freshness together.
      const remote = probeRemoteTip(repo.path, ref);
      const stale = remoteFreshnessVerdict({ ref, path: repo.path, localSha: sha, remote });
      if (stale) {
        repo.status = 'unaudited';
        repo.precondition = stale.precondition ?? 'unstated';
        repo.reason = stale.reason;
        continue;
      }
      repo.remote = remote;
      // Before enumerating: can this checkout SEE the whole window? A short
      // answer here reads as compliance, so it must not be produced at all. A
      // TOPOLOGICAL window answers that itself — the range is complete exactly
      // when the ref is present here — so the date horizon is asked only of the
      // repos that actually run a date window (#12633).
      const base = topologicalBaseIn(repo.path, window, repo.id);
      if (!base) {
        const horizon = historyHorizon({ cwd: repo.path, ref, sinceMs: Date.parse(window.effectiveIso) });
        if (!horizon.covered) {
          repo.status = 'unaudited';
          repo.precondition = 'history-horizon';
          repo.reason = truncatedHorizonReason({ ref, horizon });
          continue;
        }
        repo.horizon = describeHorizon(horizon);
      }
      const walked = mainlineCommitsInWindow(repo.path, ref, window, { repoId: repo.id, base });
      commits = walked.commits;
      repo.windowMode = walked.mode;
      repo.windowBase = walked.base;
      repo.windowFellBack = walked.fellBack;
      repo.straddlers = walked.straddlers.length;
      if (walked.anchorAtEdge) repo.windowIncomplete = windowEdgeReason({ budgetSeconds: window.budgetSeconds });
    } catch (error) {
      repo.status = 'unaudited';
      repo.precondition = 'ref-unreadable';
      repo.reason = `cannot read ${ref} in ${repo.path}: ${String(error.message ?? error).split('\n')[0]} — run \`git fetch origin main\` there`;
      continue;
    }
    repo.scanned = commits.length;
    repo.quiet = commits.length === 0;
    scanned += commits.length;
    for (const commit of commits) {
      // Paths AND size off one local read (#19036): the size limb has to be
      // answered before a row is an entry, and only an entry is ever attributed.
      const { paths, size } = commitChanges(repo.path, commit.sha);
      const entry = classifyCommit(commit, paths, repo, size);
      if (entry) {
        entries.push(entry);
        pathsBySha.set(commit.sha, paths);
      }
    }
  }

  if (repos.every((r) => r.status !== 'audited')) {
    console.error(
      `❌  no governed repo could be audited — not one checkout resolved. This is a failed sweep, not a\n` +
        `    clean window.\n${repos.map((r) => `    • ${r.slug} [${r.precondition ?? 'unstated'}]: ${r.reason}`).join('\n')}`,
    );
    return EXIT_CANNOT_SWEEP;
  }

  // Attribution — the only API surface, and only when there is something to
  // attribute. Failures fall back through the channel chain, then group into
  // named per-run lines; the sweep is classified incomplete either way.
  const ctx = apiContext(process.env);
  const channels = attributionChannels(process.env);
  let lookups = 0;
  let attributionFailed = false;
  for (const entry of entries) {
    if (entry.pr == null) continue; // its own loud entry; nothing to look up
    lookups += 1;
    const got = await fetchPullAttribution(ctx, entry.repoSlug ?? GOVERNED_REPOS[0].slug, entry.pr, channels);
    if (got.attribution) {
      entry.attribution = got.attribution;
      entry.attributionChannel = got.channel;
    } else {
      attributionFailed = true;
      entry.attributionError = got.failure;
    }
  }

  // The arm leg (#33603): each skills landing read with the queue guard's own readers, over the channel that
  // attributed it, so a seat landing is listed apart and judged on its record.
  let armUnmeasured = 0;
  const armCandidates = entries.filter((e) => e.pr != null && (e.surfaces ?? []).some((s) => s?.lowRiskVerdict));
  const armReaders = armCandidates.length > 0 ? await loadArmReaders() : null;
  for (const entry of armCandidates) {
    const token = entry.attributionChannel === 'env-token' ? process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null : null;
    const api = { apiUrl: ctx.apiUrl, slug: entry.repoSlug ?? GOVERNED_REPOS[0].slug, token };
    const counted = (read) => async (n) => {
      lookups += 1;
      return read(n);
    };
    const fetchers = armReaders.available
      ? { fetchPull: counted(armReaders.guard.makePullReader(api)), fetchReviews: counted(armReaders.guard.makeReviewReader(api)), fetchTimeline: counted(armReaders.guard.makeTimelineReader(api)), fetchComments: counted(armReaders.guard.makeCommentReader(api)), fetchLabels: counted(armReaders.guard.makeLabelReader(api)) }
      : null;
    const root = repoById.get(entry.repoId)?.path;
    entry.arm = await readArmLanding(entry, { paths: pathsBySha.get(entry.sha) ?? [], repo: entry.repoId, readers: armReaders, fetchers, runGit: (argv) => git(root, argv), attribution: entry.attribution ?? null });
    if (entry.arm?.state === 'not-measured') armUnmeasured += 1;
  }

  const unaudited = repos.filter((r) => r.status !== 'audited');
  const edged = repos.filter((r) => r.status === 'audited' && r.windowIncomplete);
  const complete = !attributionFailed && unaudited.length === 0 && edged.length === 0 && armUnmeasured === 0;
  const sweepCode = readSweepCode();

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          since: window.requestedIso,
          sweepCode,
          window: {
            mode: window.mode,
            requested: window.requestedIso,
            effective: window.effectiveIso,
            skewBudgetSeconds: window.budgetSeconds,
            refs: { bare: window.bareRef ?? null, pinned: Object.fromEntries(window.pinnedRefs ?? new Map()) },
          },
          repos: repos.map((r) => ({
            id: r.id,
            slug: r.slug,
            path: r.path,
            status: r.status,
            precondition: r.precondition ?? null,
            reason: r.reason,
            tip: r.tip ?? null,
            remote: r.remote ? { ref: r.remote.ref, remote: r.remote.remoteName, sha: r.remote.sha, matchesLocalTip: true } : null,
            horizon: r.horizon ?? null,
            scanned: r.scanned ?? 0,
            windowMode: r.windowMode ?? null,
            windowBase: r.windowBase?.sha ?? null,
            windowFellBack: r.windowFellBack ?? null,
            windowIncomplete: r.windowIncomplete ?? null,
            straddlers: r.straddlers ?? 0,
          })),
          scanned,
          complete,
          channelsTried: channels.map((c) => c.id),
          entries,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(renderReport({ window, repos, scanned, entries, lookups, sweepCode }));
  }

  if (!complete) {
    // ⭐ The plan the banner's hint branch reads, bound HERE — in the scope
    // that reads it — out of the same inputs `rearmProxyOrNull` builds its own
    // from (#18055). It used to be read off a `rearm` this scope never had, so
    // the reference threw while the banner's ARGUMENT was being built: an
    // argument that throws means the call never happens, so the crash deleted
    // the one warning saying the list above must not read as clean — and the
    // `return` behind it.
    const rearm = proxyRearmPlan({
      env: process.env,
      execArgv: process.execArgv,
      flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
      guard: PROXY_REARM_GUARD,
    });
    return reportSweepIncomplete({ unaudited, edged, attributionFailed, rearm, armUnmeasured });
  }
  return EXIT_SWEPT;
}

// ⛔ No module-scope `await` in either dispatch (#33603): the arm leg imports the queue guard lazily, and the
// guard imports THIS file at module scope, so an awaiting dispatch would deadlock that import (exit 13).
if (invokedDirectly && !process.argv.includes('--self-test')) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error?.stack ?? error);
      process.exitCode = EXIT_CANNOT_SWEEP;
    },
  );
}

// ── self-test (offline: pure functions + replay fixtures) ───────────────────

/**
 * Replay fixtures — the measured violations this audit regime descends from
 * (see the header's institutional-memory section), plus the first two merges
 * of the new regime. Real path lists and subjects, not imitations. Predicted
 * direction: every one of them LISTS — under a post-merge audit the healthy
 * and the violating merge look identical on the list; the maintainer's
 * recognition, not the script, is the judgement.
 */
const REPLAYS = [
  { name: 'the 14:23Z ADR merge of 2026-08-08 (zero reviews)', subject: 'docs(adr): cross-package metadata collision (#6671)', files: ['docs/adr/0048-cross-package-metadata-collision.md'], pr: 6671 },
  { name: 'the 14:38Z draft-state ADR merge of 2026-08-08', subject: 'docs(adr): record display name (#6732)', files: ['docs/adr/0079-record-display-name.md', 'scripts/check-adr-anchors.mjs'], pr: 6732 },
  { name: 'the queue-landed skills PR of 2026-08-17 (zero reviews)', subject: 'docs(pm-skill): seat protocol updates (#9238)', files: ['.claude/skills/pm-dispatch/SKILL.md', '.claude/skills/pm-dispatch/references/platform-readings.md'], pr: 9238 },
  { name: 'the first human merge under the new regime', subject: 'docs(pm-skill): stale-premise check covers ruling-named cards; triage self-exit guard sees in-flight sibling rounds (#9501)', files: ['.claude/skills/pm-dispatch/SKILL.md'], pr: 9501 },
];

/**
 * One REAL path per candidate row, for the surface-membership case below. A
 * sample is evidence, never mechanism: nothing lifts because a path appears
 * here, and the row's own candidate has to match it — asserted below, so a
 * sample that stops being representative fails loudly rather than pinning a
 * row against a path it no longer covers.
 */
const REGISTER_SAMPLES = {
  'spec-skill-refs': 'skills/objectstack-ui/references/_index.md',
  'spec-react-blocks': 'skills/objectstack-ui/references/react-blocks.md',
};

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-governed-merges self-test reached its verdict';

async function selfTest() {
  // ── The prerequisite, asked BEFORE a single case runs ────────────────────
  //
  // Placed here rather than beside the live battery it guards, so the frame's
  // load-bearing clause — "this gate exited before running a single check" — is
  // literally true when it prints. A run that refuses here has measured
  // NOTHING, and says so; a run that gets past this line is in a checkout where
  // the live battery's generator can be executed, and every floor below judges
  // exactly as it did before this guard existed.
  const repoRoot = resolve(scriptDir, '..', '..');
  const liveGeneratorRow = GENERATED_SURFACE_EXCEPTIONS.find((e) => e.id === 'spec-skill-refs');
  const unmetPrerequisite = generatorToolchainPrerequisite(repoRoot, liveGeneratorRow);
  if (unmetPrerequisite) {
    // Prints the shared frame and exits `EXIT_PREREQUISITE_NOT_MET`; never returns.
    reportPrerequisiteNotMet(
      import.meta.url,
      unmetPrerequisite,
      'the governed predicate, the exception register or the battery floors hold',
    );
  }

  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  let checked = 0;
  const failures = [];
  const assert = (name, cond, detail) => {
    registerCase();
    checked++;
    if (!cond) failures.push(`${name}: ${detail ?? ''}`);
  };
  // The repository every register question below is asked for, unless a case
  // is ABOUT the scope and names another one: this checkout's own. The scope
  // battery pins that the matchers refuse a call that names none.
  const REPO = SELF_REPO_ID;
  // Report fixtures take a REAL window from the real resolver, never a
  // hand-built object: a shape drifting from `resolveWindow`'s would render
  // green here and print nothing an operator could read.
  const dateWindowFor = (iso) => resolveWindow({ sinceArg: iso });

  // ── the governed predicate: the 2026-08-18 unified list, exactly ──────────
  battery('the governed predicate: the 2026-08-18 unified list, exactly');
  const ids = (paths) => governedPathsIn(paths, REPO).map((s) => s.id);
  assert('all-twenty-surfaces-declared-in-order', GOVERNED_SURFACES.map((s) => s.id).join(',') === 'adr,claude-tree,skills-catalog,agents-md,claude-md,north-star,workflows,ui-adr,ui-claude-tree,ui-skills-catalog,ui-agents-md,ui-claude-md,ui-workflows,claude-hooks,claude-settings,claude-settings-local,guard-merges,guard-queue,guard-records,guard-dispatch-gates', GOVERNED_SURFACES.map((s) => s.id).join(','));
  assert('adr-prefix', ids(['docs/adr/0001-x.md']).join() === 'adr');
  assert('whole-claude-tree-not-only-skills-and-hooks-and-settings-also-hit-their-own-rows', ids(['.claude/hooks/guard-main-checkout.sh', '.claude/agents/os-dev.md', '.claude/settings.json']).join() === 'claude-tree,claude-hooks,claude-settings' && ids(['.claude/agents/os-dev.md']).join() === 'claude-tree');
  assert('published-skills-catalog-is-governed', ids(['skills/objectstack-ui/SKILL.md']).join() === 'skills-catalog');
  assert('root-agents-md-exact', ids(['AGENTS.md']).join() === 'agents-md');
  assert('root-claude-md-exact', ids(['CLAUDE.md']).join() === 'claude-md');
  assert('north-star-exact', ids(['docs/NORTH-STAR.md']).join() === 'north-star');
  // Near misses, each load-bearing: prefixes need their trailing slash; the
  // exact entries are the repo-root files only (see header).
  assert('near-misses-stay-out', ids(['docs/adrs/z.md', '.claude-x/y.md', 'skillsx/a.md', 'examples/AGENTS.md', 'packages/create-objectstack/src/templates/AGENTS.md', 'apps/CLAUDE.md.bak', 'docs/north-star.md', 'docs/NORTH-STAR.md.bak', 'examples/docs/NORTH-STAR.md', 'docs/NORTH-STAR.mdx', 'content/docs/concepts/north-star.mdx']).length === 0, JSON.stringify(ids(['examples/AGENTS.md'])));
  assert('a-mixed-diff-groups-by-surface', ids(['docs/adr/0001.md', 'AGENTS.md', 'package.json']).join() === 'adr,agents-md');

  // ── the per-row repository scope (maintainer ruling B2, 2026-10-13) ──────
  //
  // The workflows row is the first SCOPED row, and the scope is a new axis of
  // the register, so every direction is pinned: which rows carry the default
  // and which a scope, that a scope is a subset of the roster, that each of
  // the three named repositories answers GOVERNED Tier H and each of the two
  // unnamed ones answers NOT governed, and that every front door REFUSES a
  // call naming no repository rather than answering for all of them.
  battery('the per-row repository scope (ruled B2, 2026-10-13)');
  const everyRepo = GOVERNED_REPOS.map((r) => r.id);
  const workflowsRow = GOVERNED_SURFACES.find((s) => s.id === 'workflows');
  assert('the-six-pre-existing-rows-declare-no-scope-and-so-govern-every-repository', GOVERNED_SURFACES.filter((s) => ['adr', 'claude-tree', 'skills-catalog', 'agents-md', 'claude-md', 'north-star'].includes(s.id)).every((s) => s.repos === undefined && surfaceRepos(s).join() === everyRepo.join()), JSON.stringify(GOVERNED_SURFACES.map((s) => [s.id, s.repos ?? null])));
  assert('the-workflows-row-is-scoped-to-objectstack-objectui-cloud-and-hotcrm-exactly', surfaceRepos(workflowsRow).join() === 'objectstack,objectui,cloud,hotcrm' && workflowsRow.tier === GOVERNED_TIER_H && workflowsRow.glob === '.github/workflows/**', JSON.stringify(workflowsRow));
  assert('every-declared-scope-is-a-non-empty-duplicate-free-subset-of-GOVERNED_REPOS-ids', GOVERNED_SURFACES.every((s) => s.repos === undefined || (Array.isArray(s.repos) && s.repos.length > 0 && new Set(s.repos).size === s.repos.length && s.repos.every((id) => everyRepo.includes(id)))), JSON.stringify(GOVERNED_SURFACES.map((s) => [s.id, s.repos ?? null])));
  assert('the-workflows-row-is-a-prefix-row-with-a-separator-so-it-reaches-dispatch-gates-as-written-and-declares-no-hint', workflowsRow.prefix === '.github/workflows/' && !ROOT_FILE_WATCH_HINTS.some((h) => h.startsWith('.github/')));
  const wf = '.github/workflows/lint.yml';
  assert('an-objectstack-workflow-path-is-governed-Tier-H', ids([wf]).join() === 'workflows' && governedTierFor([wf], 'objectstack') === GOVERNED_TIER_H && testVerdict([wf], { repo: 'objectstack' }).tier === GOVERNED_TIER_H);
  assert('an-objectui-workflow-path-is-governed-Tier-H', governedPathsIn([wf], 'objectui').map((s) => s.id).join() === 'workflows' && governedTierFor([wf], 'objectui') === GOVERNED_TIER_H);
  assert('a-cloud-workflow-path-is-governed-Tier-H', governedPathsIn([wf], 'cloud').map((s) => s.id).join() === 'workflows' && governedTierFor([wf], 'cloud') === GOVERNED_TIER_H && testVerdict([wf], { repo: 'cloud' }).governed === true);
  assert('an-objectos-workflow-path-is-NOT-governed', governedPathsIn([wf], 'objectos').length === 0 && testVerdict([wf], { repo: 'objectos' }).governed === false && testVerdict([wf], { repo: 'objectos' }).clearPaths.join() === wf);
  assert('a-hotcrm-workflow-path-is-governed-Tier-H-the-2026-11-19-audit-mirror', governedPathsIn([wf], 'hotcrm').map((s) => s.id).join() === 'workflows' && governedTierFor([wf], 'hotcrm') === GOVERNED_TIER_H && testVerdict([wf], { repo: 'hotcrm' }).governed === true);
  assert('the-default-rows-still-govern-objectos-and-hotcrm-the-scope-narrows-one-row-not-the-register', ['objectos', 'hotcrm'].every((r) => governedPathsIn(['AGENTS.md', 'docs/adr/0001-x.md', '.claude/agents/os-dev.md'], r).map((s) => s.id).join() === 'adr,claude-tree,agents-md'));
  assert('the-near-misses-for-the-workflows-row-stay-out', ids(['.github/ISSUE_TEMPLATE/bug.md', '.github/workflows.bak/x.yml', '.github/workflowsx/y.yml', 'github/workflows/z.yml', '.github/CODEOWNERS', 'packages/x/.github/workflows/w.yml']).length === 0);
  assert('surfacesChecked-counts-the-rows-that-govern-the-repository-not-the-table', testVerdict(['README.md'], { repo: 'objectstack' }).surfacesChecked === 20 && testVerdict(['README.md'], { repo: 'objectos' }).surfacesChecked === 6 && governedSurfacesFor('cloud').length === 7 && governedSurfacesFor('hotcrm').map((s) => s.id).join() === 'adr,claude-tree,skills-catalog,agents-md,claude-md,north-star,workflows');
  assert('the-verdict-carries-the-repository-it-answered-for', testVerdict([wf], { repo: 'cloud' }).repo === 'cloud' && JSON.parse(JSON.stringify(testVerdict([wf], { repo: 'objectui' }))).repo === 'objectui');
  const refuses = (fn) => { try { fn(); return null; } catch (error) { return error; } };
  const noRepo = refuses(() => governedPathsIn([wf]));
  assert('⛔ no-repository-is-an-ERROR-never-an-answer-for-every-repository', noRepo instanceof TypeError && /governedPathsIn wants the repository/.test(noRepo.message) && /objectstack, objectui, cloud, objectos, hotcrm/.test(noRepo.message), String(noRepo?.message));
  assert('⛔ and-every-front-door-refuses-alike', [() => governedTierFor([wf]), () => testVerdict([wf]), () => testVerdict([wf], {}), () => classifyCommit({ sha: 'a'.repeat(40), date: 'd', subject: 'x (#1)' }, [wf]), () => governedSurfacesFor(undefined), () => governedPathsIn([wf], ''), () => governedPathsIn([wf], null)].every((fn) => refuses(fn) instanceof TypeError));
  const unknownRepo = refuses(() => governedPathsIn([wf], 'objectstack-ai/objectstack'));
  assert('⛔ a-slug-or-any-unknown-id-is-refused-and-the-words-point-at-repoIdForSlug', unknownRepo instanceof TypeError && /not a GOVERNED_REPOS id/.test(unknownRepo.message) && /repoIdForSlug/.test(unknownRepo.message) && refuses(() => governedTierFor([wf], 'Objectstack')) instanceof TypeError, String(unknownRepo?.message));
  assert('the-refusal-names-the-caller-whose-contract-was-missed', /^testVerdict wants/.test(refuses(() => testVerdict([wf])).message) && /^classifyCommit wants/.test(refuses(() => classifyCommit({ sha: 'a'.repeat(40), date: 'd', subject: 'x' }, [wf])).message) && /^governedTierFor wants/.test(refuses(() => governedTierFor([wf])).message));
  assert('repoIdForSlug-resolves-the-roster-case-insensitively-and-nothing-else', repoIdForSlug('objectstack-ai/cloud') === 'cloud' && repoIdForSlug('ObjectStack-AI/ObjectUI') === 'objectui' && repoIdForSlug(' objectstack-ai/hotcrm ') === 'hotcrm' && repoIdForSlug('someone/objectstack') === null && repoIdForSlug('objectstack') === null && repoIdForSlug('') === null && repoIdForSlug(null) === null);
  assert('every-GOVERNED_REPOS-slug-resolves-to-its-own-id', GOVERNED_REPOS.every((r) => repoIdForSlug(r.slug) === r.id));
  const fromThisCheckout = checkoutRepoFor('https://github.com/objectstack-ai/objectstack.git', '--test');
  assert('--test-and---branch-answer-for-the-checkout-at---root-its-origin-resolved-to-an-id', fromThisCheckout.repo === 'objectstack' && fromThisCheckout.slug === 'objectstack-ai/objectstack' && checkoutRepoFor('git@github.com:objectstack-ai/cloud.git', '--branch x').repo === 'cloud', JSON.stringify(fromThisCheckout));
  const foreign = checkoutRepoFor('https://github.com/someone/fork.git', '--test');
  const noOrigin = checkoutRepoFor(null, '--branch x');
  assert('⛔ a-checkout-outside-the-roster-or-with-no-origin-is-REFUSED-never-defaulted', typeof foreign.error === 'string' && /someone\/fork, which is not a governed repository/.test(foreign.error) && /point --root at one/.test(foreign.error) && typeof noOrigin.error === 'string' && /no origin remote/.test(noOrigin.error) && /parses to no owner\/name/.test(noOrigin.error), `${foreign.error}\n${noOrigin.error}`);
  assert('the-checkout-note-names-the-repository-judged-and-the---root-remedy', /judged for cloud \(objectstack-ai\/cloud, the checkout at --root\)/.test(checkoutRepoNote({ repo: 'cloud', slug: 'objectstack-ai/cloud' })) && /--root <its path>/.test(checkoutRepoNote({ repo: 'cloud', slug: 'objectstack-ai/cloud' })));
  assert('the-verdict-head-names-the-repository-and-counts-its-rows', renderTestVerdict(testVerdict([wf], { repo: 'cloud' })).split('\n')[0] === 'governed-surface predicate: 1 of 1 path(s) hit the register (7 surfaces govern cloud).' && renderTestVerdict(testVerdict([wf], { repo: 'objectos' })).split('\n')[0] === 'governed-surface predicate: 0 of 1 path(s) hit the register (6 surfaces govern objectos).', renderTestVerdict(testVerdict([wf], { repo: 'objectos' })).split('\n')[0]);

  // ── the nested `ui/` workspace rows (#25712) ─────────────────────────────
  //
  // The objectui tree arrives as the `ui/` workspace of this repository, and
  // its own register's six rows govern it here under that prefix (see the
  // register's header). #25712's first PR proved the matchers on these rows as
  // a fixture handed in through the `register` seam, before they landed; they
  // are the live rows now, so every case below reads the register itself, and
  // the seam is held by the one register that does NOT carry them. Both
  // directions are pinned: each row's specimen is governed Tier H in
  // objectstack, and a `ui/` source path, a nested copy of an instruction file
  // and every other repository answer NOT governed.
  // ── the `workflows` row's content-aware split (ruling record 6722205630, letter C) ──
  //
  // One pin per C2 trigger, the near-misses that must stay Tier S, the cases
  // biased to H, and every fail-closed door. The fixtures are workflow TEXTS,
  // classified pure; `readWorkflowDiff` is driven through an injected git.
  battery('⭐ the workflows split: Tier H by path or by C2 trigger, else Tier S (ruling record 6722205630)');
  {
    const WF = '.github/workflows/ci.yml';
    const BASE_WF = [
      'name: CI',
      'on:',
      '  pull_request:',
      '    paths:',
      "      - 'packages/**'",
      '  merge_group:',
      'jobs:',
      '  build:',
      '    name: Build Core',
      '    runs-on: ubuntu-latest',
      '    timeout-minutes: 20',
      '    steps:',
      '      - uses: actions/checkout@v7',
      '      - name: Restore cache',
      '        uses: actions/cache@v4',
      '        with:',
      '          key: core-${{ hashFiles(\'pnpm-lock.yaml\') }}',
      '      - name: Gate',
      "        if: github.event_name != 'schedule'",
      '        run: |',
      '          # the gate',
      '          pnpm check:generated',
      '          node scripts/check-required-contexts.mjs',
      '      - name: Build with the cache token',
      '        env:',
      '          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}',
      '        run: pnpm turbo run build --filter=@objectstack/spec',
      '  shards:',
      '    name: Test UI (${{ matrix.shard }}/16)',
      '    needs: [build]',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: pnpm vitest run',
      '',
    ].join('\n');
    const edit = (from, to) => {
      if (!BASE_WF.includes(from)) throw new Error(`fixture anchor missing: ${from}`);
      return BASE_WF.replace(from, to);
    };
    const INVENTORY = workflowInventory([{ path: WF, text: BASE_WF }]);
    const tierOf = (head, opts = {}) => classifyWorkflowChange({ path: opts.path ?? WF, base: opts.base === undefined ? BASE_WF : opts.base, head, inventory: opts.inventory === undefined ? INVENTORY : opts.inventory });
    const isH = (r, re) => r.tier === GOVERNED_TIER_H && r.reasons.some((x) => re.test(x));
    const isS = (r) => r.tier === GOVERNED_TIER_S && r.reasons.length === 0;
    const show = (r) => JSON.stringify(r.reasons);

    // The register: the row keeps `tier: H` for every path-only reader; the split is a reading, in objectstack alone.
    const row = GOVERNED_SURFACES.find((s) => s.id === 'workflows');
    assert('the-workflows-row-keeps-tier-H-and-carries-a-split-scoped-to-objectstack-alone', row.tier === GOVERNED_TIER_H && Object.isFrozen(row.split) && row.split.repos.join() === 'objectstack' && GOVERNED_SURFACES.filter((s) => s.split).map((s) => s.id).join() === 'workflows', JSON.stringify(row));
    assert('the-split-repositories-are-a-subset-of-the-rows-own', row.split.repos.every((r) => surfaceRepos(row).includes(r)));
    assert('the-reader-parses-the-fixture-and-the-baseline-is-S-against-itself', workflowFacts(BASE_WF).ok === true && isS(tierOf(BASE_WF)) && isS(tierOf(`${BASE_WF}\n`)), show(tierOf(BASE_WF)));

    // Tier H by PATH: the six release, publish and deploy files, each on disk under its own name.
    const PINNED = WORKFLOW_TIER_H_FILES.map((f) => f.path);
    assert('seven-files-are-Tier-H-by-path-release-docker-base-image-docs-wiki-the-write-relay-and-the-queue-guard-workflow', PINNED.join() === ['release', 'docker-publish', 'framework-build-base', 'docs-deploy', 'checklist-status', 'fleet-write', 'governed-surface-guard'].map((n) => `${WORKFLOWS_PREFIX}${n}.yml`).join(), PINNED.join());
    assert('every-pinned-path-is-a-real-workflow-file-of-this-repository', PINNED.every((p) => existsSync(resolve(scriptDir, '..', '..', p))), PINNED.filter((p) => !existsSync(resolve(scriptDir, '..', '..', p))).join());
    assert('a-pinned-file-is-H-even-on-a-comment-only-edit', PINNED.every((p) => isH(classifyWorkflowChange({ path: p, base: BASE_WF, head: `# a comment\n${BASE_WF}`, inventory: INVENTORY }), /Tier H by path/)));

    // Tier H by DIFF: one pin per C2 trigger.
    assert('C2-permissions-added-is-H', isH(tierOf(edit('    timeout-minutes: 20', '    timeout-minutes: 20\n    permissions:\n      contents: write')), /`permissions:` block/), show(tierOf(edit('    timeout-minutes: 20', '    timeout-minutes: 20\n    permissions:\n      contents: write'))));
    const READ_PERMS = edit('jobs:\n', 'permissions:\n  contents: read\njobs:\n');
    const widened = tierOf(READ_PERMS.replace('contents: read', 'contents: write'), { base: READ_PERMS });
    assert('C2-a-changed-permissions-key-is-H', isH(widened, /`permissions:` block/), show(widened));
    const tokened = tierOf(edit('      - run: pnpm vitest run', '      - run: pnpm vitest run\n        env:\n          GH_TOKEN: ${{ github.token }}'));
    assert('C2-a-github-token-reference-added-is-H', isH(tokened, /secrets\.\*|github\.token/), show(tokened));
    assert('C2-a-secrets-reference-added-is-H', isH(tierOf(edit('      - run: pnpm vitest run', '      - run: pnpm vitest run\n        env:\n          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}')), /secrets\.\*/));
    assert('C2-pull_request_target-is-H', isH(tierOf(edit('  merge_group:', '  merge_group:\n  pull_request_target:')), /pull_request_target/));
    assert('C2-a-uses-no-workflow-on-the-base-uses-is-H', isH(tierOf(edit('      - uses: actions/checkout@v7', '      - uses: actions/checkout@v7\n      - uses: someone/new-action@v1')), /not used anywhere on the base tree: `someone\/new-action`/));
    assert('C2-a-deleted-job-is-H', isH(tierOf(BASE_WF.slice(0, BASE_WF.indexOf('  shards:'))), /a deleted job: `shards`/));
    assert('C2-a-literal-check-run-name-changed-is-H', isH(tierOf(edit('    name: Build Core', '    name: Build Core v2')), /check-run name changed/));
    assert('C2-a-new-continue-on-error-is-H', isH(tierOf(edit('        run: |', '        continue-on-error: true\n        run: |')), /new `continue-on-error`/));
    assert('C2-an-if-that-disables-a-step-is-H', isH(tierOf(edit("        if: github.event_name != 'schedule'", '        if: false')), /`if:` added or changed/));
    assert('C2-an-if-that-disables-a-job-is-H', isH(tierOf(edit('    timeout-minutes: 20', '    timeout-minutes: 20\n    if: false')), /`if:` added or changed .*`job:build`/));

    // The contract review's holes (FAIL at d51132be): each is H now, pinned with the shape that slipped past.
    const GATE_STEP = "      - name: Gate\n        if: github.event_name != 'schedule'\n";
    const renamedDummy = tierOf(edit(GATE_STEP, "      - name: Gate2\n        if: false\n").replace('      - name: Build with the cache token', '      - name: Gate\n        run: echo ok\n      - name: Build with the cache token'));
    assert('⛔ M1-a-renamed-gate-step-given-if-false-beside-a-dummy-under-the-old-name-is-H', isH(renamedDummy, /`if:` added or changed in a job that already ran: `job:build\/step:Gate2`/), show(renamedDummy));
    const idDummy = tierOf(edit(GATE_STEP, "      - id: gate2\n        name: Gate\n        if: false\n"));
    assert('⛔ M1-a-gate-step-re-keyed-by-an-id-and-given-if-false-is-H', isH(idDummy, /`if:` added or changed in a job that already ran/), show(idDummy));
    const newStepIf = tierOf(edit('      - run: pnpm vitest run', "      - run: pnpm vitest run\n      - name: Extra\n        if: github.ref == 'refs/heads/main'\n        run: echo extra"));
    assert('⛔ M1-a-new-step-with-its-own-if-inside-an-existing-job-is-H', isH(newStepIf, /in a job that already ran: `job:shards\/step:Extra`/), show(newStepIf));
    const flowStep = tierOf(edit(GATE_STEP, '      - { name: Gate, if: false }\n'));
    assert('⛔ M2a-a-flow-mapped-step-is-refused-and-H', isH(flowStep, /does not parse .*a flow mapping/), show(flowStep));
    assert('M2a-an-empty-flow-mapping-and-an-expression-still-parse', workflowFacts(edit('  merge_group:', '  merge_group: {}')).ok === true && workflowFacts(edit('    runs-on: ubuntu-latest\n    timeout', "    runs-on: ${{ inputs.os || 'ubuntu-latest' }}\n    timeout")).ok === true);
    const escaped = tierOf(edit("        if: github.event_name != 'schedule'", '        "i\\x66": false'));
    assert('⛔ M2b-a-double-quoted-escape-spelling-a-key-is-refused-and-H', isH(escaped, /does not parse .*double-quoted escape/), show(escaped));
    const escapedValue = tierOf(edit('          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}', '          TURBO_TOKEN: "${{ secre\\x74s.TURBO_TOKEN }}"'));
    assert('⛔ M2b-an-escape-inside-a-value-is-refused-too', isH(escapedValue, /does not parse .*double-quoted escape/), show(escapedValue));
    for (const spelling of ['${{ Secrets.NPM_TOKEN }}', '${{ SECRETS.NPM_TOKEN }}', "${{ github['token'] }}", '${{ GitHub.Token }}', '${{ github . token }}']) {
      const r = tierOf(edit('      - run: pnpm vitest run', `      - run: pnpm vitest run\n        env:\n          T: ${spelling}`));
      assert(`⛔ M2c-a-credential-spelled-${spelling}-is-H`, isH(r, /token reference added, changed or moved/), show(r));
    }
    const explicitKey = tierOf(edit('    timeout-minutes: 20\n', '    timeout-minutes: 20\n    ? permissions\n    : write-all\n'));
    assert('⛔ M2d-an-explicit-key-line-is-refused-and-H', isH(explicitKey, /does not parse .*YAML indicator/), show(explicitKey));
    const valuedParent = tierOf(edit('    name: Build Core\n', '    name: Build Core\n      if: false\n'));
    assert('⛔ M2d-a-child-under-a-node-with-a-scalar-value-is-refused-and-H', isH(valuedParent, /does not parse/), show(valuedParent));
    assert('M2d-a-plain-scalar-continuation-still-reads', workflowFacts(edit('    name: Build Core\n', '    name: Build\n      Core\n')).ok === true);
    // The delta review's holes (FAIL at 87f686fc): a gate moved into a new job that never runs; two token spellings.
    const GATE_BLOCK = "      - name: Gate\n        if: github.event_name != 'schedule'\n        run: |\n          # the gate\n          pnpm check:generated\n          node scripts/check-required-contexts.mjs\n";
    const movedOff = tierOf(`${edit(GATE_BLOCK, '')}  gate2:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n${GATE_BLOCK}`);
    assert('⛔ D1-a-gate-step-moved-into-a-new-job-with-if-false-is-H', isH(movedOff, /an existing job no longer holds `check:generated`: `build`/), show(movedOff));
    const movedBehind = tierOf(`${edit(GATE_BLOCK, '')}  opt-in:\n    if: contains(github.event.pull_request.labels.*.name, 'x')\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo opt\n  gate2:\n    needs: [opt-in]\n    runs-on: ubuntu-latest\n    steps:\n${GATE_BLOCK}`);
    assert('⛔ D1-a-gate-step-moved-into-a-new-job-behind-an-opt-in-needs-is-H', isH(movedBehind, /an existing job no longer holds `scripts\/check-required-contexts\.mjs`: `build`/), show(movedBehind));
    const actionMoved = tierOf(`${edit("      - name: Restore cache\n        uses: actions/cache@v4\n        with:\n          key: core-${{ hashFiles('pnpm-lock.yaml') }}\n", '')}  cache2:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/cache@v4\n`);
    assert('⛔ D1-a-uses-moved-out-of-an-existing-job-is-H', isH(actionMoved, /an existing job no longer holds `uses: actions\/cache`: `build`/), show(actionMoved));
    for (const spelling of ['${{ toJSON(github) }}', "${{ github[format('tok{0}', 'en')] }}"]) {
      const r = tierOf(edit('      - run: pnpm vitest run', `      - run: pnpm vitest run\n        env:\n          T: ${spelling}`));
      assert(`⛔ D2-the-job-token-reached-as-${spelling}-is-H`, isH(r, /token reference added, changed or moved/), show(r));
    }
    const addedNeeds = tierOf(edit('    needs: [build]', '    needs: [build, opt-in]'));
    assert('⛔ S1-a-needs-added-on-an-existing-job-is-H', isH(addedNeeds, /`needs:` changed: `shards` \[build\] → \[build, opt-in\]/), show(addedNeeds));
    // The review nits N5: gate spellings WORKFLOW_INVOCATIONS did not see — each moved out of its job is H.
    const GATE_LINE = '          node scripts/check-required-contexts.mjs\n';
    for (const [spelling, token] of [
      ['git diff --exit-code -- packages/spec/json-schema', 'git diff --exit-code -- packages/spec/json-schema'],
      ['if ! git diff --quiet -- sdui.manifest.json; then exit 1; fi', 'git diff --quiet -- sdui.manifest.json'],
      ['npx --yes publint@0.3.2 --strict', 'npx publint'],
      ['npx -y "@arethetypeswrong/cli@0.17.0" --pack .', 'npx @arethetypeswrong/cli'],
      ['node ui/e2e/check-gate.mjs --strict', 'node ui/e2e/check-gate.mjs'],
      ['bash ./tools/verify.sh "$RUNNER_TEMP"', 'bash tools/verify.sh'],
    ]) {
      const base = edit(GATE_LINE, `${GATE_LINE}          ${spelling}\n`);
      const moved = tierOf(`${base.replace(`          ${spelling}\n`, '')}  gate2:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${spelling}\n`, { base });
      const re = new RegExp(`an existing job no longer holds \`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`: \`build\``);
      assert(`⛔ N5-a-gate-spelled-${token}-moved-out-of-its-job-is-H`, isH(moved, re), show(moved));
    }
    const npxBase = edit(GATE_LINE, `${GATE_LINE}          npx --yes publint@0.3.2 --strict\n          node ./tools/gate.mjs\n`);
    const npxBumped = tierOf(npxBase.replace('publint@0.3.2', 'publint@0.3.3').replace('node ./tools/gate.mjs', 'node tools/gate.mjs'), { base: npxBase });
    assert('N5-near-miss-an-npx-version-bump-and-a-dropped-dot-slash-are-S', isS(npxBumped), show(npxBumped));

    // The near-misses: each is Tier S.
    const BUILD_RUN = '        run: pnpm turbo run build --filter=@objectstack/spec';
    const reordered = edit(
      "      - name: Gate\n        if: github.event_name != 'schedule'\n        run: |\n          # the gate\n          pnpm check:generated\n          node scripts/check-required-contexts.mjs\n",
      '',
    ).replace(`${BUILD_RUN}\n`, `${BUILD_RUN}\n` + "      - name: Gate\n        if: github.event_name != 'schedule'\n        run: |\n          # the gate\n          pnpm check:generated\n          node scripts/check-required-contexts.mjs\n");
    assert('near-miss-a-moved-if-that-disables-nothing-is-S', reordered !== BASE_WF && isS(tierOf(reordered)), show(tierOf(reordered)));
    assert('near-miss-a-uses-bump-of-an-action-already-in-use-is-S', isS(tierOf(edit('actions/cache@v4', 'actions/cache@v5'))), show(tierOf(edit('actions/cache@v4', 'actions/cache@v5'))));
    assert('near-miss-a-timeout-edit-is-S', isS(tierOf(edit('timeout-minutes: 20', 'timeout-minutes: 30'))));
    assert('near-miss-a-path-filter-edit-is-S', isS(tierOf(edit("      - 'packages/**'", "      - 'packages/**'\n      - 'ui/**'"))));
    assert('near-miss-a-shard-count-in-a-computed-matrix-name-is-S', isS(tierOf(edit('(${{ matrix.shard }}/16)', '(${{ matrix.shard }}/20)'))), show(tierOf(edit('(${{ matrix.shard }}/16)', '(${{ matrix.shard }}/20)'))));
    assert('near-miss-a-cache-key-edit-is-S', isS(tierOf(edit("key: core-${{ hashFiles('pnpm-lock.yaml') }}", "key: core-v2-${{ hashFiles('pnpm-lock.yaml') }}"))));
    assert('near-miss-a-comment-edit-is-S', isS(tierOf(edit('          # the gate', '          # the gate, reworded'))) && isS(tierOf(edit('jobs:', '# a note\njobs:'))));
    assert('near-miss-a-new-job-with-a-fresh-name-and-its-own-if-is-S', isS(tierOf(`${BASE_WF}  extra:\n    name: Extra advisory\n    runs-on: ubuntu-latest\n    steps:\n      - name: report\n        if: always()\n        run: pnpm check:extra\n`)));

    // Biased to H (each named in the report).
    assert('biased-an-added-or-true-is-H', isH(tierOf(edit('          pnpm check:generated', '          pnpm check:generated || true')), /can skip a check/));
    assert('biased-a-dropped-gate-invocation-is-H', isH(tierOf(edit('          node scripts/check-required-contexts.mjs\n', '')), /gate invocation dropped/));
    assert('biased-a-changed-step-that-holds-a-secret-is-H', isH(tierOf(edit('--filter=@objectstack/spec', '--filter=@objectstack/core')), /already holds a secret or a write token/));
    assert('biased-a-needs-that-lost-a-job-is-H', isH(tierOf(edit('    needs: [build]\n', '')), /`needs:` changed: `shards` \[build\] → \[\]/));
    assert('biased-a-changed-trigger-set-is-H', isH(tierOf(edit('  merge_group:\n', '')), /trigger set changed/));
    assert('biased-a-new-job-taking-a-name-already-in-use-is-H', isH(tierOf(`${BASE_WF}  again:\n    name: Build Core\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`), /already in use/));

    // Fail closed.
    assert('closed-an-unparseable-head-is-H', isH(tierOf(edit('jobs:', 'jobs: &anchor')), /head copy does not parse/) && isH(tierOf(edit('    runs-on: ubuntu-latest\n    timeout', '\truns-on: x\n    timeout')), /does not parse/));
    assert('closed-a-new-a-deleted-and-a-non-yaml-file-are-H', isH(tierOf(BASE_WF, { base: null }), /new workflow file/) && isH(tierOf(null), /deleted workflow file/) && isH(tierOf('x', { path: `${WORKFLOWS_PREFIX}notes.md` }), /not a `.yml`/));
    assert('closed-no-inventory-is-H', isH(tierOf(edit('timeout-minutes: 20', 'timeout-minutes: 30'), { inventory: null }), /no inventory/));
    const fakeGit = (tree) => (argv) => {
      // ls-tree honours its pathspecs (argv after `--`), as git does: the inventory's directory list is under test.
      // `-z` names come back NUL-separated, as the reader now asks for them.
      if (argv[0] === 'ls-tree') return Object.keys(tree[argv[4]] ?? (() => { throw new Error(`unknown revision ${argv[4]}`); })()).filter((p) => argv.slice(6).some((d) => p.startsWith(d.endsWith('/') ? d : `${d}/`))).join('\0');
      const [rev, path] = argv[1].split(':');
      if (tree[rev]?.[path] === undefined) throw new Error(`fatal: path '${path}' does not exist in '${rev}'`);
      return tree[rev][path];
    };
    const TREES = { b: { [WF]: BASE_WF }, h: { [WF]: edit('timeout-minutes: 20', 'timeout-minutes: 30') }, x: { [WF]: edit('        run: |', '        continue-on-error: true\n        run: |') } };
    const readS = readWorkflowDiff({ paths: [WF, 'README.md'], base: 'b', head: 'h', git: fakeGit(TREES) });
    const readH = readWorkflowDiff({ paths: [WF], base: 'b', head: 'x', git: fakeGit(TREES) });
    assert('readWorkflowDiff-classifies-only-the-workflow-paths-it-read', readS.measured === true && readS.files.length === 1 && readS.files[0].tier === GOVERNED_TIER_S && readH.files[0].tier === GOVERNED_TIER_H, JSON.stringify(readS));
    // The review nit N3: an action used only under `.github/actions/**` (no register row) vouches for nothing.
    const ACTION = '.github/actions/setup/action.yml';
    const ACTION_TEXT = "name: setup\nruns:\n  using: composite\n  steps:\n    - uses: someone/composite-only@v1\n";
    const ADOPT = (u) => edit('      - uses: actions/checkout@v7\n', `      - uses: actions/checkout@v7\n      - uses: ${u}\n`);
    const ADOPTING = { b: { [WF]: BASE_WF, [ACTION]: ACTION_TEXT }, n: { [WF]: ADOPT('someone/composite-only@v1'), [ACTION]: ACTION_TEXT }, c: { [WF]: ADOPT('actions/cache@v4'), [ACTION]: ACTION_TEXT } };
    const adopted = readWorkflowDiff({ paths: [WF], base: 'b', head: 'n', git: fakeGit(ADOPTING) });
    assert('⛔ N3-a-workflow-adopting-an-action-used-only-under-github-actions-on-the-base-is-H', adopted.measured === true && isH(adopted.files[0], /not used anywhere on the base tree: `someone\/composite-only`/), JSON.stringify(adopted.files));
    const reused = readWorkflowDiff({ paths: [WF], base: 'b', head: 'c', git: fakeGit(ADOPTING) });
    assert('N3-control-an-action-a-base-workflow-already-uses-is-S', reused.measured === true && isS(reused.files[0]), JSON.stringify(reused.files));
    const noBase = readWorkflowDiff({ paths: [WF], base: null, head: 'h', git: fakeGit(TREES) });
    const badRev = readWorkflowDiff({ paths: [WF], base: 'gone', head: 'h', git: fakeGit(TREES) });
    assert('closed-a-missing-base-or-a-git-failure-is-UNMEASURED', noBase.measured === false && /no base commit/.test(noBase.reason) && badRev.measured === false && /unknown revision gone/.test(badRev.reason), JSON.stringify([noBase.reason, badRev.reason]));
    assert('closed-an-unmeasured-reading-or-none-is-H-and-a-path-it-did-not-read-is-H', [noBase, null, undefined].every((r) => governedTierFor([WF], REPO, GOVERNED_SURFACES, r) === GOVERNED_TIER_H) && workflowSplitVerdict([WF, `${WORKFLOWS_PREFIX}lint.yml`], readS).tier === GOVERNED_TIER_H && workflowSplitVerdict([], readS).tier === GOVERNED_TIER_H);
    assert('mergeWorkflowReadings-H-wins-a-path-read-twice-and-unmeasured-wins-the-set', mergeWorkflowReadings([readS, readH]).files[0].tier === GOVERNED_TIER_H && mergeWorkflowReadings([readS, noBase]).measured === false && mergeWorkflowReadings([readS]).files[0].tier === GOVERNED_TIER_S && mergeWorkflowReadings([]) === null);

    // The verdict: the split reaches testVerdict and governedTierFor, ALL-not-ANY still holds, and the scope holds.
    assert('a-Tier-S-reading-makes-a-workflow-only-PR-Tier-S-still-GOVERNED-exit-3', (({ governed, tier, humanMerge }) => governed && tier === GOVERNED_TIER_S && humanMerge)(testVerdict([WF], { repo: REPO, workflowDiff: readS })) && governedTierFor([WF], REPO, GOVERNED_SURFACES, readS) === GOVERNED_TIER_S);
    assert('beside-a-claude-path-it-stays-S-beside-AGENTS-md-it-is-H', testVerdict([WF, '.claude/agents/os-dev.md'], { repo: REPO, workflowDiff: readS }).tier === GOVERNED_TIER_S && testVerdict([WF, 'AGENTS.md'], { repo: REPO, workflowDiff: readS }).tier === GOVERNED_TIER_H);
    assert('the-same-reading-moves-nothing-in-objectui-or-cloud-whose-guards-have-no-split-arm', ['objectui', 'cloud'].every((r) => testVerdict([WF], { repo: r, workflowDiff: readS }).tier === GOVERNED_TIER_H));
    assert('no-reading-is-byte-identical-to-before-for-a-path-only-caller', testVerdict([WF], { repo: REPO }).tier === GOVERNED_TIER_H && (() => { const m = governedPathsIn(['AGENTS.md', '.claude/x.md'], REPO); return applyWorkflowSplit(m, REPO, readS).every((s, i) => s === m[i]); })());
    const textS = renderTestVerdict(testVerdict([WF], { repo: REPO, workflowDiff: readS }));
    const textH = renderTestVerdict(testVerdict([WF], { repo: REPO, workflowDiff: readH }));
    const textN = renderTestVerdict(testVerdict([WF], { repo: REPO }));
    assert('the-words-name-the-split-in-all-three-readings', /Tier S\(席内达档 L2 审核落地\)/.test(textS) && /Tier S by content/.test(textS) && /Tier H by content/.test(textH) && /new `continue-on-error`/.test(textH) && /content NOT MEASURED/.test(textN) && /landing tier: H/.test(textN), `${textS}\n${textH}\n${textN}`);
    assert('a-verdict-with-no-workflow-hit-prints-no-split-line', !/split \(ruling record/.test(renderTestVerdict(testVerdict(['AGENTS.md'], { repo: REPO }))) && renderWorkflowSplitLines([]) === '');
    const pr = (over = {}) => pullWorkflowDiff({ derivation: { pull: 7, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) }, paths: [WF], sameCheckout: true, run: () => ({ ok: false, out: '' }), git: () => '', ...over });
    assert('--pr-reads-the-split-only-from-a-checkout-holding-both-commits-else-UNMEASURED', pr().measured === false && /not in this checkout/.test(pr().reason) && pr({ sameCheckout: false }).measured === false && pr({ derivation: { pull: 7 } }).measured === false, JSON.stringify([pr().reason, pr({ sameCheckout: false }).reason]));
  }

  battery('⚖️ the low-risk skills arm: skills wording on Clause-② no lands Tier S, everything else stays H (#33501)');
  {
    const REPO = 'objectstack';
    const SK = 'skills/objectstack-data/SKILL.md';
    const UISK = 'ui/skills/objectui-views/SKILL.md';
    const CS = '.changeset/33501-skills-wording.md';
    const CS_TEXT = "---\n'@objectstack/skills': patch\n---\n\nskills: wording\n\nClause-②: no\nMetadata-protocol: none\n";
    // Every catalog path a MODIFIED regular file — the shape a wording PR has.
    const catFiles = (paths, status = 'modified', mode = '100644') => paths.filter((p) => /^(?:ui\/)?skills\//.test(p)).map((path) => ({ path, status, oldMode: mode, mode }));
    const csFiles = (paths, text = CS_TEXT) => paths.filter((p) => LOW_RISK_CHANGESET_PATH.test(p)).map((path) => ({ path, text }));
    // The arm's RECORD STAGE, read and favourable: a record on this head whose one line reads `no`, and a card that
    // never carried `security`. Every reading below carries it, so a row that pins Tier S pins it on the whole
    // conjunction, and the record-stage rows further down each drop one piece.
    const stageRecord = (over = {}) => ({ measured: true, reason: null, located: 'found', where: 'PR', id: 9001, carried: null, securityTouching: { state: 'read', value: 'no' }, ...over });
    // `others`: every OTHER card the pull names, each read like the first; none here unless a row says so.
    const stageCard = (over = {}) => ({ measured: true, reason: null, card: 1, labels: [], timeline: { measured: true, reason: null, events: [] }, others: { measured: true, reason: null, cards: [] }, ...over });
    const read = (paths, over = {}) => ({
      measured: true, reason: null, paths, body: 'Fixes #1\n\nClause-②: no\nMetadata-protocol: none\n', labels: [],
      timeline: { measured: true, reason: null, events: [] },
      fork: { measured: true, isFork: false, headRepo: 'o/r', baseRepo: 'o/r' },
      changesets: { measured: true, reason: null, files: csFiles(paths) },
      catalogFiles: { measured: true, reason: null, files: catFiles(paths) },
      record: stageRecord(),
      cardLabels: stageCard(),
      ...over,
    });
    const tier = (paths, reading, repo = REPO) => governedTierFor(paths, repo, GOVERNED_SURFACES, null, reading);
    const reasons = (paths, reading) => lowRiskArmVerdict(governedPathsIn(paths, REPO), REPO, reading).reasons.join(' | ');

    // The register: the two catalog rows and the ADR row (#33539, add-only) carry the arm, scoped to objectstack;
    // the row tier stays H for every path-only reader.
    const armRows = GOVERNED_SURFACES.filter((s) => s.lowRisk);
    assert('the-arm-rides-exactly-the-two-catalog-rows-and-the-ADR-row-scoped-to-objectstack-and-all-keep-row-tier-H',
      armRows.map((s) => s.id).join() === 'adr,skills-catalog,ui-skills-catalog' && armRows.every((s) => s.tier === GOVERNED_TIER_H && Object.isFrozen(s.lowRisk) && s.lowRisk.repos.join() === REPO) &&
      armRows.filter((s) => s.lowRisk.addOnly === true).map((s) => s.id).join() === 'adr', JSON.stringify(armRows.map((s) => [s.id, s.tier, s.lowRisk])));
    const rider = (p) => LOW_RISK_RIDER_PATTERNS.some((re) => re.test(p));
    assert('the-rider-allowlist-is-changesets-and-Markdown-prose-under-the-docs-trees-only', Object.isFrozen(LOW_RISK_RIDER_PATTERNS) && [CS, 'docs/agents/x.md', 'content/docs/guides/x.mdx'].every(rider) && !['.changeset/config.json', 'docs/x.ts', 'content/docs/x.json', 'content/x.md', 'packages/docs/x.md', '.changeset/a/b.md'].some(rider));

    // ⛔ Fail closed: no reading, or an unmeasured one, is H — the path-only readers (`--test`, `--branch`, the prose gate) answer as before.
    assert('⛔ no-reading-is-Tier-H-and-says-NOT-MEASURED', tier([SK], null) === GOVERNED_TIER_H && governedTierFor([SK], REPO) === GOVERNED_TIER_H && testVerdict([SK], { repo: REPO }).tier === GOVERNED_TIER_H && /low-risk skills arm .*NOT MEASURED/.test(renderTestVerdict(testVerdict([SK], { repo: REPO }))));
    assert('⛔ an-unmeasured-reading-is-Tier-H-with-its-own-reason', tier([SK], { measured: false, reason: 'the pull could not be read' }) === GOVERNED_TIER_H && /the pull could not be read/.test(renderTestVerdict(testVerdict([SK], { repo: REPO, lowRisk: { measured: false, reason: 'the pull could not be read' } }))));

    // ⭐ The arm: pure skills wording, with its changeset and prose riders, on `Clause-②: no` and no security label.
    assert('⭐ a-pure-skills-diff-with-its-changeset-on-Clause-2-no-is-Tier-S', tier([SK, CS], read([SK, CS])) === GOVERNED_TIER_S && testVerdict([SK, CS], { repo: REPO, lowRisk: read([SK, CS]) }).tier === GOVERNED_TIER_S, reasons([SK, CS], read([SK, CS])));
    assert('⭐ with-its-changeset-and-docs-prose-riders-it-stays-Tier-S', tier([SK, CS, 'content/docs/guides/x.mdx', 'docs/agents/x.md'], read([SK, CS, 'content/docs/guides/x.mdx', 'docs/agents/x.md'])) === GOVERNED_TIER_S);
    assert('a-ui-skills-diff-and-both-catalogs-together-are-Tier-S', tier([UISK, CS], read([UISK, CS])) === GOVERNED_TIER_S && tier([SK, UISK, CS], read([SK, UISK, CS])) === GOVERNED_TIER_S);
    assert('the-words-name-the-arm-and-the-Tier-S-landing', (() => { const t = renderTestVerdict(testVerdict([SK, CS], { repo: REPO, lowRisk: read([SK, CS]) })); return /Tier S\(席内达档 L2 审核落地\)/.test(t) && /low-risk skills arm .*Tier S/.test(t) && t.includes(LOW_RISK_ARM_RULING); })());

    // ⛔ Published source or any path outside the allowlist: H.
    assert('⛔ skills-plus-packages-spec-stays-H', tier([SK, 'packages/spec/src/data/field.zod.ts'], read([SK, 'packages/spec/src/data/field.zod.ts'])) === GOVERNED_TIER_H && /outside skills wording and prose: packages\/spec/.test(reasons([SK, 'packages/spec/src/data/field.zod.ts'], read([SK, 'packages/spec/src/data/field.zod.ts']))));
    assert('⛔ skills-plus-ui-packages-stays-H', tier([UISK, 'ui/packages/react/src/x.tsx'], read([UISK, 'ui/packages/react/src/x.tsx'])) === GOVERNED_TIER_H);
    assert('⛔ skills-plus-a-gate-script-or-a-lockfile-stays-H-the-list-is-an-allowlist', tier([SK, 'scripts/check-skills-token-ratchet.mjs'], read([SK, 'scripts/check-skills-token-ratchet.mjs'])) === GOVERNED_TIER_H && tier([SK, 'pnpm-lock.yaml'], read([SK, 'pnpm-lock.yaml'])) === GOVERNED_TIER_H);
    assert('⛔ a-reading-whose-path-list-misses-a-governed-file-or-is-empty-is-H', tier([SK, UISK], read([SK])) === GOVERNED_TIER_H && tier([SK], read([])) === GOVERNED_TIER_H);

    // ⛔ Any other governed row beside it: H, Tier S rows included (the card's "no other governed path").
    assert('⛔ skills-beside-AGENTS-md-an-ADR-or-NORTH-STAR-is-H', [['AGENTS.md'], ['docs/adr/0001-x.md'], ['docs/NORTH-STAR.md']].every(([p]) => tier([SK, p], read([SK, p])) === GOVERNED_TIER_H));
    assert('⛔ skills-beside-a-Tier-S-claude-path-is-H-too', tier([SK, '.claude/agents/os-dev.md'], read([SK, '.claude/agents/os-dev.md'])) === GOVERNED_TIER_H && /outside the arm: `\.claude\/\*\*`/.test(reasons([SK, '.claude/agents/os-dev.md'], read([SK, '.claude/agents/os-dev.md']))));

    // ⛔ The declaration: only a bare `Clause-②: no` lands on the seat.
    const body = (line) => read([SK, CS], { body: `Fixes #1\n\n${line}\nMetadata-protocol: none\n` });
    assert('⛔ Clause-2-yes-or-no-narrowing-or-yes-widening-is-H', ['Clause-②: yes', 'Clause-②: no (narrowing)', 'Clause-②: yes (widening)', 'Clause-②: yes (narrowing)'].every((l) => tier([SK, CS], body(l)) === GOVERNED_TIER_H));
    assert('⛔ a-malformed-absent-or-near-miss-Clause-2-line-is-H', ['Clause-②: maybe', 'no declaration here', 'Clause 2: no', '`Clause-②:` no', ''].every((l) => tier([SK, CS], body(l)) === GOVERNED_TIER_H) && tier([SK, CS], read([SK, CS], { body: null })) === GOVERNED_TIER_H);
    assert('a-decorated-Clause-2-no-line-reads-as-the-one-reader-reads-it', tier([SK, CS], body('- `Clause-②`: no')) === GOVERNED_TIER_S && tier([SK, CS], body('- **Clause-②:** no')) === GOVERNED_TIER_S && tier([SK, CS], body('Clause-②: no')) === GOVERNED_TIER_S);

    // ⛔ Security: the label keeps it with the maintainer; labels not read is H.
    assert('⛔ a-security-label-in-any-case-is-H', tier([SK, CS], read([SK, CS], { labels: ['security'] })) === GOVERNED_TIER_H && tier([SK, CS], read([SK, CS], { labels: ['docs', 'Security'] })) === GOVERNED_TIER_H);
    assert('⛔ labels-not-read-is-H', tier([SK, CS], read([SK, CS], { labels: null })) === GOVERNED_TIER_H && tier([SK, CS], read([SK, CS], { labels: undefined })) === GOVERNED_TIER_H);

    // The scope: the arm moves nothing outside objectstack, and nothing without a catalog hit.
    assert('the-same-S-reading-moves-nothing-in-objectui-cloud-or-hotcrm', tier([SK, CS], read([SK, CS])) === GOVERNED_TIER_S && ['objectui', 'cloud', 'hotcrm'].every((r) => tier([SK, CS], read([SK, CS]), r) === GOVERNED_TIER_H));
    assert('a-slice-with-no-catalog-row-is-returned-as-is-byte-identical', (() => { const m = governedPathsIn(['AGENTS.md', '.claude/x.md'], REPO); return applyLowRiskArm(m, REPO, read(['AGENTS.md', '.claude/x.md'])) === m && renderLowRiskLines(m) === ''; })() && tier(['.claude/agents/os-dev.md'], read(['.claude/agents/os-dev.md'])) === GOVERNED_TIER_S);

    // ── The RECORD STAGE: the arm's last two conditions — the review's own `Security-touching: no` line and a card
    // that never carried `security` — one row per piece. Every row holds the pull-read conditions fixed (`read`).
    const staged = (over) => read([SK, CS], over);
    const stageTier = (over) => tier([SK, CS], staged(over));
    const stageWhy = (over) => reasons([SK, CS], staged(over));
    const stageOf = (reading, paths = [SK, CS]) => lowRiskArmVerdict(governedPathsIn(paths, REPO), REPO, reading).recordStage;
    const unstaged = (over = {}) => { const { record: _record, cardLabels: _cardLabels, ...rest } = staged(over); return rest; };
    const recordH = (record, re) => (stageTier({ record }) === GOVERNED_TIER_H && re.test(stageWhy({ record })) ? true : stageWhy({ record }));
    const cardH = (cardLabels, re) => (stageTier({ cardLabels }) === GOVERNED_TIER_H && re.test(stageWhy({ cardLabels })) ? true : stageWhy({ cardLabels }));
    assert('⭐ RECORD-STAGE-CONTROL a-record-on-this-head-reading-no-and-a-card-never-labelled-security-is-Tier-S-and-the-stage-says-read',
      stageTier({}) === GOVERNED_TIER_S && stageOf(staged({})) === LOW_RISK_RECORD_STAGE.read && stageWhy({}) === '' && stageTier({ cardLabels: stageCard({ labels: ['docs', 'skip-changeset'], timeline: { measured: true, reason: null, events: [{ event: 'unlabeled', label: { name: 'docs' } }, { event: 'labeled', label: { name: 'docs' } }] } }) }) === GOVERNED_TIER_S, stageWhy({}));
    assert('⛔ RECORD-LINE a-record-with-NO-Security-touching-line-is-Tier-H-and-the-reason-names-the-comment',
      recordH(stageRecord({ securityTouching: { state: 'missing' } }), /^its contract-review record \(PR comment 9001\) carries no `Security-touching:` line$/) === true &&
      recordH(stageRecord({ securityTouching: null, where: 'card', id: 9002 }), /^its contract-review record \(card comment 9002\) carries no `Security-touching:` line$/) === true &&
      recordH(stageRecord({ securityTouching: undefined }), /carries no `Security-touching:` line/) === true);
    assert('⛔ RECORD-LINE a-line-reading-yes-or-any-value-but-a-bare-no-is-Tier-H',
      recordH(stageRecord({ securityTouching: { state: 'read', value: 'yes' } }), /reads `Security-touching: yes`$/) === true &&
      ['No', 'NO', ' no', 'none', '', null, undefined, false, 0].every((value) => recordH(stageRecord({ securityTouching: { state: 'read', value } }), /reads `Security-touching: /) === true));
    assert('⛔ RECORD-LINE an-unreadable-line-is-Tier-H-with-the-record-readers-own-reason',
      recordH(stageRecord({ securityTouching: { state: 'unreadable', reason: 'it carries 2 `Security-touching:` lines, and a record states exactly one' } }), /the `Security-touching:` line of its contract-review record \(PR comment 9001\) is unreadable: it carries 2 /) === true &&
      recordH(stageRecord({ securityTouching: { state: 'unreadable' } }), /is unreadable: no reason recorded$/) === true);
    assert('⛔ RECORD-LINE no-record-on-this-head-an-unsigned-one-or-one-that-was-not-read-is-Tier-H',
      recordH(stageRecord({ located: 'absent', where: null, id: null, securityTouching: null }), /^no contract-review record names this head, so no `Security-touching: no` line is established$/) === true &&
      recordH(stageRecord({ located: 'unsigned' }), /names no reviewer, so its `Security-touching:` line does not count$/) === true &&
      recordH({ measured: false, reason: "PR #2's comment thread could not be read (HTTP 502)" }, /^its contract-review record was not read \(PR #2's comment thread could not be read \(HTTP 502\)\), so no `Security-touching: no` line is established$/) === true &&
      recordH(stageRecord({ located: 'unreadable' }), /no contract-review record names this head/) === true);
    assert('⛔ RECORD-LINE a-record-CARRIED-over-hops-that-moved-what-the-arm-reads-is-Tier-H-and-one-carried-clean-stays-S',
      recordH(stageRecord({ carried: { from: 'd'.repeat(40), ok: false, reason: 'was carried from `dddddddddddd` over hops that moved skills/a/SKILL.md, which the arm reads, after the review' } }), /\(PR comment 9001\) was carried from `dddddddddddd` over hops that moved skills\/a\/SKILL\.md/) === true &&
      recordH(stageRecord({ carried: { from: 'd'.repeat(40), ok: false } }), /over hops that could not be read$/) === true &&
      recordH(stageRecord({ carried: { from: 'd'.repeat(40) } }), /over hops that could not be read$/) === true &&
      stageTier({ record: stageRecord({ carried: { from: 'd'.repeat(40), ok: true, reason: null } }) }) === GOVERNED_TIER_S);
    // ⛔ Fail closed on SHAPE: only a measured record FOUND on this head whose line was READ as exactly `no` passes,
    // so no stand-in, partial or mistyped reading — whatever built it — can read `no`.
    assert('⛔ RECORD-LINE no-reading-short-of-a-measured-found-record-whose-line-was-READ-as-no-passes-whatever-its-shape',
      [true, 'no', {}, [], { measured: true }, { measured: 'true', located: 'found', securityTouching: { state: 'read', value: 'no' } }, { measured: true, located: 'found' },
        { measured: true, located: 'found', securityTouching: 'no' }, { measured: true, located: 'found', securityTouching: { value: 'no' } }, { measured: true, located: 'found', securityTouching: { state: 'read' } },
        { measured: true, located: 'Found', securityTouching: { state: 'read', value: 'no' } }, { measured: true, securityTouching: { state: 'read', value: 'no' } },
        { measured: true, located: 'found', securityTouching: { state: 'Read', value: 'no' } }].every((record) => stageTier({ record }) === GOVERNED_TIER_H));
    assert('⛔ CARD-LABEL a-card-carrying-the-security-label-in-any-case-is-Tier-H',
      cardH(stageCard({ card: 69, labels: ['security'] }), /^its card #69 carries the `security` label$/) === true &&
      cardH(stageCard({ labels: ['docs', 'Security'] }), /its card #1 carries the `security` label/) === true && cardH(stageCard({ labels: ['SECURITY'] }), /carries the `security` label/) === true);
    assert('⛔ CARD-LABEL a-security-label-REMOVED-from-the-card-is-Tier-H-though-its-labels-no-longer-show-it',
      cardH(stageCard({ card: 69, timeline: { measured: true, reason: null, events: [{ event: 'labeled', label: { name: 'security' } }, { event: 'unlabeled', label: { name: 'Security' } }] } }), /^the timeline of its card #69 shows the `security` label removed$/) === true &&
      stageTier({ cardLabels: stageCard({ timeline: { measured: true, reason: null, events: [{ event: 'unlabeled', label: { name: 'security-review' } }, { event: 'closed', label: { name: 'security' } }] } }) }) === GOVERNED_TIER_S);
    assert('⛔ CARD-LABEL labels-or-a-timeline-that-were-not-read-or-a-card-nobody-could-name-are-Tier-H',
      cardH({ measured: false, reason: 'no card could be derived for it — the body names no card' }, /^the labels of its card were not read \(no card could be derived for it — the body names no card\), so a `security` label on the card cannot be ruled out$/) === true &&
      cardH({ measured: false, reason: "card #69's labels could not be read (HTTP 502)" }, /were not read \(card #69's labels could not be read \(HTTP 502\)\)/) === true &&
      cardH(stageCard({ labels: null }), /the labels of its card were not read \(no reading\)/) === true && cardH({}, /the labels of its card were not read/) === true && cardH(true, /the labels of its card were not read/) === true &&
      cardH(stageCard({ card: 69, timeline: { measured: false, reason: 'HTTP 502', events: null } }), /^the timeline of its card #69 was not read \(HTTP 502\), so a removed `security` label cannot be ruled out$/) === true &&
      cardH(stageCard({ timeline: null }), /the timeline of its card #1 was not read \(no reading\)/) === true && cardH(stageCard({ timeline: { measured: true, events: 'none' } }), /was not read/) === true);
    // ── EVERY card the pull request names (`others`, read by the queue guard's `readCardLabels`): a `security`
    // label on a card it merely names beside the one that carries its record keeps the arm at Tier H too.
    const otherCard = (over = {}) => ({ measured: true, reason: null, card: 71, labels: [], timeline: { measured: true, reason: null, events: [] }, ...over });
    const withOthers = (cards) => stageCard({ card: 69, others: { measured: true, reason: null, cards } });
    assert('⛔ NAMED-CARDS a-security-label-now-or-removed-on-ANOTHER-card-the-pull-names-is-Tier-H-and-the-reason-names-that-card',
      cardH(withOthers([otherCard({ labels: ['docs', 'Security'] })]), /^card #71, which it also names, carries the `security` label$/) === true &&
      cardH(withOthers([otherCard(), otherCard({ card: 72, timeline: { measured: true, reason: null, events: [{ event: 'unlabeled', label: { name: 'SECURITY' } }] } })]), /^the timeline of card #72, which it also names, shows the `security` label removed$/) === true &&
      stageTier({ cardLabels: withOthers([otherCard({ labels: ['docs'] }), otherCard({ card: 72 })]) }) === GOVERNED_TIER_S);
    assert('⛔ NAMED-CARDS another-card-whose-labels-or-timeline-were-not-read-is-Tier-H',
      cardH(withOthers([{ measured: false, reason: "card #71's labels could not be read (HTTP 502)", card: 71 }]), /^the labels of card #71, which it also names, were not read \(card #71's labels could not be read \(HTTP 502\)\), so a `security` label on it cannot be ruled out$/) === true &&
      cardH(withOthers([otherCard({ timeline: { measured: false, reason: 'HTTP 403', events: null } })]), /^the timeline of card #71, which it also names, was not read \(HTTP 403\), so a removed `security` label cannot be ruled out$/) === true &&
      cardH(withOthers([null]), /^the labels of card #\(no number\), which it also names, were not read \(no reading\)/) === true && cardH(withOthers([otherCard({ labels: 'security' })]), /the labels of card #71, which it also names, were not read/) === true);
    assert('⛔ NAMED-CARDS a-reading-that-does-not-say-it-read-the-other-cards-is-Tier-H-never-read-as-none-named',
      cardH(stageCard({ others: undefined }), /^the other cards it names were not read \(no reading\), so a `security` label on one of them cannot be ruled out$/) === true &&
      cardH(stageCard({ others: { measured: false, reason: 'it names 9 more cards (#71, #72, #73, …), over the 8 this leg reads', cards: null } }), /^the other cards it names were not read \(it names 9 more cards \(#71, #72, #73, …\), over the 8 this leg reads\), so/) === true &&
      [{ measured: true, reason: null, cards: 'none' }, { measured: 'true', cards: [] }, { cards: [] }, [], true, null].every((others) => cardH(stageCard({ others }), /the other cards it names were not read/) === true));
    assert('⛔ NAMED-CARDS each-card-prints-its-own-reason-the-first-card-and-every-other',
      (() => { const why = stageWhy({ cardLabels: stageCard({ card: 69, labels: ['security'], others: { measured: true, reason: null, cards: [otherCard({ labels: ['security'] }), otherCard({ card: 72, labels: ['security'] })] } }) });
        return why === 'its card #69 carries the `security` label | card #71, which it also names, carries the `security` label | card #72, which it also names, carries the `security` label' ? true : why; })() === true);
    // ⛔ PENDING: every pull-read condition holds and no record stage was handed in. Tier H on ONE reason, and the
    // caller (the queue leg, the relay, `--pr`, the sweep) reads the stage and asks again. Never Tier S.
    assert('⛔ RECORD-STAGE a-reading-with-no-record-stage-handed-in-is-Tier-H-PENDING-on-one-reason',
      tier([SK, CS], unstaged()) === GOVERNED_TIER_H && stageOf(unstaged()) === LOW_RISK_RECORD_STAGE.pending && reasons([SK, CS], unstaged()) === LOW_RISK_RECORD_STAGE_PENDING_REASON &&
      LOW_RISK_RECORD_STAGE_PENDING_REASON.includes(`\`${LOW_RISK_RECORD_LINE}\``) && testVerdict([SK, CS], { repo: REPO, lowRisk: unstaged() }).tier === GOVERNED_TIER_H &&
      tier([SK, CS], { ...unstaged(), record: null, cardLabels: undefined }) === GOVERNED_TIER_H && stageOf({ ...unstaged(), record: null, cardLabels: undefined }) === LOW_RISK_RECORD_STAGE.pending, reasons([SK, CS], unstaged()));
    assert('RECORD-STAGE a-pull-read-reason-leaves-the-stage-NOT-REACHED-with-no-pending-reason-and-an-unmeasured-reading-too',
      stageOf(unstaged({ labels: ['security'] })) === LOW_RISK_RECORD_STAGE.notReached && !reasons([SK, CS], unstaged({ labels: ['security'] })).includes('contract-review record') &&
      stageOf(null) === LOW_RISK_RECORD_STAGE.notReached && stageOf({ measured: false, reason: 'x' }) === LOW_RISK_RECORD_STAGE.notReached && Object.isFrozen(LOW_RISK_RECORD_STAGE) && Object.values(LOW_RISK_RECORD_STAGE).join() === 'not-reached,pending,read');
    assert('⛔ RECORD-STAGE half-a-stage-is-a-stage-READ-and-the-half-not-handed-in-is-a-reason',
      tier([SK, CS], { ...unstaged(), record: stageRecord() }) === GOVERNED_TIER_H && stageOf({ ...unstaged(), record: stageRecord() }) === LOW_RISK_RECORD_STAGE.read && /^the labels of its card were not read \(no reading\)/.test(reasons([SK, CS], { ...unstaged(), record: stageRecord() })) &&
      tier([SK, CS], { ...unstaged(), cardLabels: stageCard() }) === GOVERNED_TIER_H && stageOf({ ...unstaged(), cardLabels: stageCard() }) === LOW_RISK_RECORD_STAGE.read && /^its contract-review record was not read \(no reading\)/.test(reasons([SK, CS], { ...unstaged(), cardLabels: stageCard() })));
    assert('⛔ RECORD-STAGE a-stage-handed-in-is-judged-beside-the-pull-read-reasons-and-each-piece-prints-its-own',
      (() => { const why = reasons([SK, CS], staged({ labels: ['security'], record: stageRecord({ securityTouching: { state: 'read', value: 'yes' } }), cardLabels: stageCard({ labels: ['security'], timeline: { measured: true, reason: null, events: [{ event: 'unlabeled', label: { name: 'security' } }] } }) }));
        return /the PR carries the `security` label/.test(why) && /reads `Security-touching: yes`/.test(why) && /its card #1 carries the `security` label/.test(why) && /timeline of its card #1 shows the `security` label removed/.test(why) ? true : why; })() === true &&
      lowRiskRecordStageReasons(stageRecord(), stageCard()).length === 0 && lowRiskRecordStageReasons(null, null).length === 2);
    // The line the arm prints is the record reader's own key and value — this file cannot import that one at
    // module scope, so the two are held together here — and the reader's reading is the shape the arm reads.
    {
      const recognisers = await import('./record-recognisers.mjs');
      const line = (text) => recognisers.contractReviewRecordReading(`## Contract review\n\n${text}\n\n**VERDICT: PASS**\n`).securityTouching;
      assert('the-line-the-arm-stands-on-is-the-record-readers-own-key-and-first-value-and-its-reading-is-the-shape-the-arm-reads',
        LOW_RISK_RECORD_LINE === `${recognisers.CONTRACT_REVIEW_SECURITY_TOUCHING_KEY}: ${recognisers.CONTRACT_REVIEW_SECURITY_TOUCHING_VALUES[0]}` &&
        stageTier({ record: stageRecord({ securityTouching: line(LOW_RISK_RECORD_LINE) }) }) === GOVERNED_TIER_S &&
        stageTier({ record: stageRecord({ securityTouching: line('Security-touching: yes') }) }) === GOVERNED_TIER_H &&
        stageTier({ record: stageRecord({ securityTouching: line('Reviewed-by: `session_01SEAT`') }) }) === GOVERNED_TIER_H &&
        stageTier({ record: stageRecord({ securityTouching: line(`${LOW_RISK_RECORD_LINE}\n${LOW_RISK_RECORD_LINE}`) }) }) === GOVERNED_TIER_H &&
        stageTier({ record: stageRecord({ securityTouching: line(`> ${LOW_RISK_RECORD_LINE}`) }) }) === GOVERNED_TIER_H, JSON.stringify(line(LOW_RISK_RECORD_LINE)));
    }
    assert('the-Tier-S-words-name-the-record-line-and-the-card', (() => { const t = renderTestVerdict(testVerdict([SK, CS], { repo: REPO, lowRisk: read([SK, CS]) })); return t.includes(`a record on this head reading \`${LOW_RISK_RECORD_LINE}\``) && /no `security` label ever on the PR or a card it names/.test(t); })());

    // The H words name every reason; `--pr` reads the arm off the SAME pull object and file walk.
    assert('the-H-words-list-each-reason', (() => { const t = renderTestVerdict(testVerdict([SK, 'packages/core/src/x.ts'], { repo: REPO, lowRisk: read([SK, 'packages/core/src/x.ts'], { labels: ['security'] }) })); return /low-risk skills arm .*Tier H/.test(t) && /packages\/core/.test(t) && /`security` label/.test(t) && /landing tier: H/.test(t); })());
    const SAME = { head: { ref: 'claude/project-thread-x', repo: { full_name: 'o/r' } }, base: { repo: { full_name: 'o/r' } } };
    const fromPull = pullLowRiskReading({ ...SAME, body: 'Clause-②: no', labels: [{ name: 'skip-changeset' }, { name: 'security' }] }, [SK]);
    assert('pullLowRiskReading-takes-body-label-names-the-whole-path-list-and-the-fork-predicate', fromPull.measured === true && fromPull.body === 'Clause-②: no' && fromPull.labels.join() === 'skip-changeset,security' && fromPull.paths.join() === SK && fromPull.fork.measured === true && fromPull.fork.isFork === false && pullLowRiskReading({}, [SK]).labels === null && pullLowRiskReading({ body: 7, labels: [] }, [SK]).body === '', JSON.stringify(fromPull));
    assert('⛔ pullLowRiskReading-without-a-timeline-or-changesets-handed-in-reads-both-NOT-MEASURED-so-H', fromPull.timeline.measured === false && fromPull.changesets.measured === false && tier([SK, CS], pullLowRiskReading({ ...SAME, body: 'Clause-②: no\nMetadata-protocol: none', labels: [] }, [SK, CS])) === GOVERNED_TIER_H);
    {
      const respond = (b) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => b });
      const urls = [];
      const walk = (paths, timeline) => fetchPullFiles({
        apiUrl: 'https://api', slug: 'o/r', pull: 2, channels: [{ id: 'fixture', name: 'fixture channel', headers: {} }],
        fetchImpl: async (url) => {
          urls.push(url);
          if (/\/files/.test(url)) return respond(paths.map((filename) => ({ filename })));
          if (/\/timeline/.test(url)) return timeline === 'fail' ? { ok: false, status: 403, headers: { get: () => null }, json: async () => ({}) } : respond(timeline);
          return respond({ ...SAME, changed_files: paths.length, additions: 3, deletions: 1, body: 'Clause-②: no\nMetadata-protocol: none', labels: [{ name: 'docs' }] });
        },
      });
      const walked = await walk([SK, CS], []);
      const withCs = (r) => ({ ...r, changesets: { measured: true, reason: null, files: csFiles([SK, CS]) }, catalogFiles: { measured: true, reason: null, files: catFiles([SK]) } });
      // The first read hands in no record stage, so with every pull-read condition holding `--pr` reads PENDING at
      // Tier H; `pullRecordStage` then reads the stage through the queue guard's own reader (rows below).
      assert('⭐ --pr-carries-the-arm-reading-off-the-same-GET-file-walk-and-timeline-and-with-its-changesets-read-its-record-stage-is-PENDING-at-Tier-H', walked.ok === true && walked.lowRisk?.measured === true && walked.lowRisk.paths.join() === `${SK},${CS}` && walked.lowRisk.timeline.measured === true && urls.some((u) => /\/issues\/2\/timeline\?per_page=100$/.test(u)) &&
        tier(walked.paths, withCs(walked.lowRisk)) === GOVERNED_TIER_H && stageOf(withCs(walked.lowRisk), walked.paths) === LOW_RISK_RECORD_STAGE.pending &&
        JSON.stringify(walked.pullHead) === JSON.stringify({ number: 2, body: 'Clause-②: no\nMetadata-protocol: none', head: { ref: 'claude/project-thread-x' } }), JSON.stringify(walked.lowRisk ?? walked.reason));
      {
        const armReaders = await loadArmReaders();
        const PRHEAD = 'b'.repeat(40);
        const RELAY_BOT = armReaders.recognisers?.trustedAuthors?.[0] ?? '(relay unread)';
        const { CONTRACT_REVIEW_TIER_NAME: AT_TIER } = await import('./record-recognisers.mjs');
        const review = (line = LOW_RISK_RECORD_LINE, over = {}) => ({
          id: 700, created_at: '2026-11-15T04:00:00Z', user: { login: RELAY_BOT },
          body: ['## Contract review', '', `Served-tier: \`${AT_TIER}\``, `Head-sha: \`${PRHEAD}\``, 'Reviewed-by: `session_01SEAT`', ...(line === null ? [] : [line]), '', '**VERDICT: PASS**'].join('\n'), ...over,
        });
        const calls = [];
        let loads = 0;
        const stagePr = ({ rows = [review()], cardRows = [], labels = [], labelsBy = {}, events = [], body = 'Fixes #69\n\nClause-②: no\nMetadata-protocol: none', rd = armReaders, reading = withCs(walked.lowRisk), throws = null, fetchers = undefined } = {}) => pullRecordStage({
          lowRisk: reading, paths: walked.paths, repo: REPO, pullHead: { number: 2, body, head: { ref: 'claude/project-thread-x' } }, derivation: { pull: 2, headSha: PRHEAD, baseSha: null },
          readers: () => { loads += 1; return rd; },
          fetchers: fetchers !== undefined ? fetchers : {
            fetchComments: async (n) => { calls.push(`comments ${n}`); if (throws === 'comments') throw new Error('HTTP 502'); return n === 2 ? rows : n === 69 ? cardRows : []; },
            fetchLabels: async (n) => { calls.push(`labels ${n}`); if (throws === 'labels') throw new Error('HTTP 502'); return labelsBy[n] ?? labels; },
            fetchTimeline: async (n) => { calls.push(`timeline ${n}`); if (throws === 'timeline') throw new Error('HTTP 502'); return events; },
          },
        });
        const prTier = async (over) => tier(walked.paths, await stagePr(over));
        const prH = async (over, re) => { const r = await stagePr(over); const why = reasons(walked.paths, r); return tier(walked.paths, r) === GOVERNED_TIER_H && re.test(why) ? true : why; };
        calls.length = 0;
        const clean = await stagePr();
        assert('⭐ --pr-RECORD-STAGE a-record-on-the-head-reading-no-and-a-card-free-of-security-answers-Tier-S-off-both-threads-the-labels-and-the-card-timeline',
          tier(walked.paths, clean) === GOVERNED_TIER_S && calls.join() === 'comments 2,comments 69,labels 69,timeline 69' && clean.record.located === 'found' && clean.record.where === 'PR' && clean.record.id === 700 && clean.cardLabels.card === 69 &&
          await prTier({ rows: [], cardRows: [review(LOW_RISK_RECORD_LINE, { id: 701 })] }) === GOVERNED_TIER_S, `${calls.join()} ${reasons(walked.paths, clean)}`);
        assert('⛔ --pr-RECORD-LINE an-arm-PR-whose-record-LACKS-the-line-reads-Tier-H-and-so-does-yes-a-doubled-line-or-no-record',
          await prH({ rows: [review(null)] }, /^its contract-review record \(PR comment 700\) carries no `Security-touching:` line$/) === true &&
          await prH({ rows: [review('Security-touching: yes')] }, /reads `Security-touching: yes`$/) === true &&
          await prH({ rows: [review(`${LOW_RISK_RECORD_LINE}\n${LOW_RISK_RECORD_LINE}`)] }, /is unreadable: it carries 2 `Security-touching:` lines/) === true &&
          await prH({ rows: [] }, /^no contract-review record names this head/) === true &&
          await prH({ rows: [review(LOW_RISK_RECORD_LINE, { user: { login: 'some-commenter' } })] }, /^no contract-review record names this head/) === true &&
          await prH({ rows: [review(), review(null, { id: 702, created_at: '2026-11-15T04:30:00Z' })] }, /\(PR comment 702\) carries no `Security-touching:` line/) === true);
        assert('⛔ --pr-CARD-LABEL a-card-carrying-security-one-that-had-it-removed-or-a-PR-naming-no-card-reads-Tier-H',
          await prH({ labels: ['docs', 'security'] }, /^its card #69 carries the `security` label$/) === true &&
          await prH({ events: [{ event: 'unlabeled', label: { name: 'security' } }] }, /^the timeline of its card #69 shows the `security` label removed$/) === true &&
          await prH({ body: 'Clause-②: no\nMetadata-protocol: none' }, /^the labels of its card were not read \(no card could be derived for it/) === true);
        assert('⛔ --pr-NAMED-CARDS a-security-label-on-ANOTHER-card-the-PR-names-reads-Tier-H-with-both-cards-read-and-clears-when-that-card-is-clean', await (async () => {
          const TWO = 'Fixes #69\n\nPart of #71\n\nClause-②: no\nMetadata-protocol: none';
          calls.length = 0;
          const labelled = await prH({ body: TWO, labelsBy: { 71: ['docs', 'security'] } }, /^card #71, which it also names, carries the `security` label$/);
          const read = calls.join();
          return labelled === true && read === 'comments 2,comments 69,labels 69,timeline 69,labels 71,timeline 71' && await prTier({ body: TWO }) === GOVERNED_TIER_S ? true : `${labelled} ${read}`;
        })() === true);
        assert('⛔ --pr-RECORD-STAGE readers-that-did-not-load-or-any-read-that-threw-is-NOT-MEASURED-so-Tier-H',
          await prH({ rd: { available: false, reason: 'no guard' } }, /its contract-review record was not read \(no guard\).*labels of its card were not read \(not read: no guard\)/) === true &&
          await prH({ rd: { ...armReaders, recognisers: { available: false, reason: 'recognisers did not load' } } }, /was not read \(recognisers did not load\)/) === true &&
          await prH({ throws: 'comments' }, /was not read \(PR #2's comment thread could not be read \(HTTP 502\)\)/) === true &&
          await prH({ throws: 'labels' }, /card #69's labels could not be read \(HTTP 502\)/) === true &&
          await prH({ throws: 'timeline' }, /the timeline of its card #69 was not read \(HTTP 502\)/) === true &&
          await prH({ fetchers: {} }, /no comment reader was supplied.*no label reader was supplied/) === true && await prH({ fetchers: null }, /no comment reader was supplied/) === true);
        calls.length = 0;
        loads = 0;
        const labelled = withCs({ ...walked.lowRisk, labels: ['security'] });
        assert('--pr-reads-no-record-stage-and-loads-no-reader-unless-the-stage-is-pending',
          (await stagePr({ reading: labelled })) === labelled && (await stagePr({ reading: null })) === null && (await stagePr({ reading: walked.lowRisk })) === walked.lowRisk && calls.length === 0 && loads === 0 &&
          (await stagePr()) !== withCs(walked.lowRisk) && loads === 1, `${calls.join()} loads=${loads}`);
      }
      const removed = await walk([SK, CS], [{ event: 'labeled', label: { name: 'security' } }, { event: 'unlabeled', label: { name: 'security' } }]);
      assert('⛔ S1-a-security-label-REMOVED-in-the-timeline-the-pull-object-no-longer-shows-is-H', tier(removed.paths, withCs(removed.lowRisk)) === GOVERNED_TIER_H && /`security` label removed/.test(lowRiskArmVerdict(governedPathsIn(removed.paths, REPO), REPO, withCs(removed.lowRisk)).reasons.join()));
      const blind = await walk([SK, CS], 'fail');
      assert('⛔ S1-a-timeline-that-does-not-read-is-NOT-MEASURED-so-H', blind.ok === true && blind.lowRisk.timeline.measured === false && tier(blind.paths, withCs(blind.lowRisk)) === GOVERNED_TIER_H);
      urls.length = 0;
      await walk(['packages/core/src/x.ts'], []);
      assert('a-PR-with-no-arm-row-hit-spends-no-timeline-read', urls.length > 0 && !urls.some((u) => /\/timeline/.test(u)), urls.join());
    }

    // ⛔ M1: the changesets, read at the head — the catalog at patch only, each with a bare `Clause-②: no` and `Metadata-protocol: none`.
    const cs = (text, paths = [SK, CS]) => read(paths, { changesets: { measured: true, reason: null, files: csFiles(paths, text) } });
    const CS_BODY = '\n\nskills: wording\n\nClause-②: no\nMetadata-protocol: none\n';
    assert('⛔ M1-a-PR-with-no-changeset-is-H', tier([SK], read([SK])) === GOVERNED_TIER_H && /no changeset/.test(reasons([SK], read([SK]))));
    assert('⛔ M1-changesets-not-read-at-the-head-are-H-with-their-reason', tier([SK, CS], read([SK, CS], { changesets: { measured: false, reason: 'not in this checkout', files: [] } })) === GOVERNED_TIER_H && /not in this checkout/.test(reasons([SK, CS], read([SK, CS], { changesets: { measured: false, reason: 'not in this checkout', files: [] } }))) && tier([SK, CS], read([SK, CS], { changesets: undefined })) === GOVERNED_TIER_H);
    assert('⛔ M1-a-changeset-releasing-any-other-package-or-the-catalog-above-patch-is-H',
      [`---\n'@objectstack/spec': patch\n---${CS_BODY}`, `---\n'@objectstack/skills': minor\n---${CS_BODY}`, `---\n'@objectstack/skills': patch\n'@objectstack/core': patch\n---${CS_BODY}`, `---\n'@objectstack/skills': major\n---${CS_BODY}`].every((t) => tier([SK, CS], cs(t)) === GOVERNED_TIER_H) && /releases/.test(reasons([SK, CS], cs(`---\n'@objectstack/spec': patch\n---${CS_BODY}`))));
    assert('M1-the-catalog-at-patch-in-either-quote-or-an-empty-frontmatter-is-S', [`---\n"@objectstack/skills": patch\n---${CS_BODY}`, `---\n---${CS_BODY}`, `---\n'@objectstack/skills':  patch \n---${CS_BODY}`].every((t) => tier([SK, CS], cs(t)) === GOVERNED_TIER_S));
    assert('⛔ M1-a-changeset-without-a-bare-Clause-2-no-or-Metadata-protocol-none-is-H',
      [`---\n'@objectstack/skills': patch\n---\n\nx\n\nMetadata-protocol: none\n`, `---\n'@objectstack/skills': patch\n---\n\nx\n\nClause-②: no\n`, `---\n'@objectstack/skills': patch\n---\n\nClause-②: no\nMetadata-protocol: added\n`, `---\n'@objectstack/skills': patch\n---\n\nClause-②: no (narrowing)\nMetadata-protocol: none\n`, `---\n'@objectstack/skills': patch\n---\n\nClause-②: no, wording\nMetadata-protocol: none\n`].every((t) => tier([SK, CS], cs(t)) === GOVERNED_TIER_H));
    assert('⛔ M1-a-changeset-with-no-frontmatter-or-that-did-not-read-at-the-head-is-H', tier([SK, CS], cs(`'@objectstack/skills': patch${CS_BODY}`)) === GOVERNED_TIER_H && tier([SK, CS], cs(null)) === GOVERNED_TIER_H && /was not read at the head/.test(reasons([SK, CS], cs(null))));
    assert('⛔ M1-a-changed-changeset-the-reading-holds-no-file-for-is-H', tier([SK, CS, '.changeset/other.md'], read([SK, CS, '.changeset/other.md'], { changesets: { measured: true, reason: null, files: csFiles([SK, CS]) } })) === GOVERNED_TIER_H);
    assert('⛔ M1-the-PR-body-needs-a-bare-Metadata-protocol-none-too', ['Clause-②: no\n', 'Clause-②: no\nMetadata-protocol: semantic\n', 'Clause-②: no\nMetadata-protocol: none (wording)\n'].every((b) => tier([SK, CS], read([SK, CS], { body: b })) === GOVERNED_TIER_H) && /Metadata-protocol/.test(reasons([SK, CS], read([SK, CS], { body: 'Clause-②: no\n' }))));
    assert('lowRiskChangesetReasons-is-empty-for-the-clean-changeset-and-names-the-file-otherwise', lowRiskChangesetReasons({ path: CS, text: CS_TEXT }).length === 0 && lowRiskChangesetReasons({ path: CS, text: `---\n---\n` }).every((r) => r.includes(CS)) && lowRiskChangesetReasons({ path: CS, text: `---\n---\n` }).length === 2);

    // ⛔ S2: exactly ONE bare `Clause-②: no` — trailing words, a second declaration, a quoted or fenced `no` are each H.
    const bodyOf = (text) => read([SK, CS], { body: `${text}\nMetadata-protocol: none\n` });
    assert('⛔ S2-trailing-text-after-no-is-H', ['Clause-②: no — wording only', 'Clause-②: no, see below', 'Clause-②: no.'].every((l) => tier([SK, CS], bodyOf(l)) === GOVERNED_TIER_H));
    assert('⛔ S2-two-declarations-are-H-even-two-of-no', tier([SK, CS], bodyOf('Clause-②: no\nClause-②: no')) === GOVERNED_TIER_H && /2 `Clause-②:` lines/.test(reasons([SK, CS], bodyOf('Clause-②: no\nClause-②: no'))));
    assert('⛔ S2-a-QUOTED-no-before-a-real-yes-is-H', tier([SK, CS], bodyOf('> Clause-②: no\n\nClause-②: yes')) === GOVERNED_TIER_H);
    assert('⛔ S2-a-FENCED-no-before-a-real-yes-is-H-backtick-and-tilde', tier([SK, CS], bodyOf('```\nClause-②: no\n```\nClause-②: yes')) === GOVERNED_TIER_H && tier([SK, CS], bodyOf('~~~md\nClause-②: no\n~~~\nClause-②: yes (widening)')) === GOVERNED_TIER_H);
    assert('⛔ S2-a-lone-fenced-or-quoted-no-is-H', tier([SK, CS], bodyOf('```\nClause-②: no\n```')) === GOVERNED_TIER_H && tier([SK, CS], bodyOf('> Clause-②: no')) === GOVERNED_TIER_H && /code fence/.test(reasons([SK, CS], bodyOf('```\nClause-②: no\n```'))) && /a quote/.test(reasons([SK, CS], bodyOf('> Clause-②: no'))));
    assert('S2-a-fence-that-closed-before-the-real-line-leaves-it-bare', tier([SK, CS], bodyOf('```js\nconst x = 1;\n```\nClause-②: no')) === GOVERNED_TIER_S);
    assert('readBareDeclaration-runs-the-one-reader-per-line', readBareDeclaration('a\nClause-②: no\nb', readClause2Line, 'Clause-②', 'no').ok === true && readBareDeclaration('Metadata-protocol: none', readMetadataProtocolLine, 'Metadata-protocol', 'none').ok === true && readBareDeclaration('Clause-②: maybe', readClause2Line, 'Clause-②', 'no').ok === false);

    // ⛔ S1: a `security` label removed before the queue read; the timeline unread.
    const tl = (events) => read([SK, CS], { timeline: { measured: true, reason: null, events } });
    assert('⛔ S1-any-unlabeled-security-event-is-H-in-any-case', tier([SK, CS], tl([{ event: 'unlabeled', label: { name: 'security' } }])) === GOVERNED_TIER_H && tier([SK, CS], tl([{ event: 'unlabeled', label: { name: 'Security' } }])) === GOVERNED_TIER_H);
    assert('S1-another-label-removed-or-security-on-another-event-stays-S', tier([SK, CS], tl([{ event: 'unlabeled', label: { name: 'docs' } }, { event: 'commented', label: { name: 'security' } }])) === GOVERNED_TIER_S);
    assert('⛔ S1-a-timeline-not-read-or-not-a-list-is-H', tier([SK, CS], read([SK, CS], { timeline: { measured: false, reason: 'HTTP 403', events: null } })) === GOVERNED_TIER_H && tier([SK, CS], read([SK, CS], { timeline: { measured: true, reason: null, events: null } })) === GOVERNED_TIER_H && tier([SK, CS], read([SK, CS], { timeline: undefined })) === GOVERNED_TIER_H);

    // ⛔ S3: a fork head, or a head repository not read.
    assert('⛔ S3-a-fork-PR-is-H', tier([SK, CS], read([SK, CS], { fork: { measured: true, isFork: true, headRepo: 'someone/fork', baseRepo: 'o/r' } })) === GOVERNED_TIER_H && /fork \(someone\/fork\)/.test(reasons([SK, CS], read([SK, CS], { fork: { measured: true, isFork: true, headRepo: 'someone/fork', baseRepo: 'o/r' } }))));
    assert('⛔ S3-a-deleted-head-repo-or-an-unread-fork-predicate-is-H', tier([SK, CS], read([SK, CS], { fork: forkVerdict({ head: { repo: null }, base: { repo: { full_name: 'o/r' } } }) })) === GOVERNED_TIER_H && tier([SK, CS], read([SK, CS], { fork: forkVerdict({}) })) === GOVERNED_TIER_H && tier([SK, CS], read([SK, CS], { fork: undefined })) === GOVERNED_TIER_H);

    // ⛔ S4: under the catalog rows only Markdown and `evals/*.json`.
    assert('S4-skill-Markdown-and-an-evals-json-are-S', tier([SK, 'skills/objectstack-data/evals/evals.json', CS], read([SK, 'skills/objectstack-data/evals/evals.json', CS])) === GOVERNED_TIER_S && tier(['ui/skills/x/evals/a.json', CS], read(['ui/skills/x/evals/a.json', CS])) === GOVERNED_TIER_S);
    assert('⛔ S4-any-other-file-under-the-catalog-is-H', ['skills/objectstack-data/hook.js', 'skills/objectstack-data/data.json', 'skills/objectstack-data/evals/sub/a.json', 'skills/objectstack-data/evals/a.yaml', 'skills/objectstack-data/logo.png', 'ui/skills/x/run.sh'].every((p) => tier([p, CS], read([p, CS])) === GOVERNED_TIER_H) && /neither Markdown nor/.test(reasons(['skills/x/hook.js', CS], read(['skills/x/hook.js', CS]))));
    // ⛔ The security NAME test: the label OR the path sends the PR to H (ruling 「标签和路径都读」).
    const SEC_MAIN = ['skills/objectstack-api/evals/endpoints-auth-routes.json', 'skills/objectstack-data/evals/hooks-security-seeds-datasources.json', 'skills/objectstack-data/rules/security.md', 'skills/objectui/evals/auth-permissions.json', 'skills/objectui/guides/auth-permissions.md'];
    assert('⛔ SEC-a-security-named-Markdown-file-is-H-and-the-reason-names-it', tier(['skills/objectstack-data/rules/security.md', CS], read(['skills/objectstack-data/rules/security.md', CS])) === GOVERNED_TIER_H && /names security, auth or permission: skills\/objectstack-data\/rules\/security\.md/.test(reasons(['skills/objectstack-data/rules/security.md', CS], read(['skills/objectstack-data/rules/security.md', CS]))));
    assert('⛔ SEC-an-auth-named-evals-json-is-H', tier(['skills/objectstack-api/evals/endpoints-auth-routes.json', CS], read(['skills/objectstack-api/evals/endpoints-auth-routes.json', CS])) === GOVERNED_TIER_H);
    assert('⛔ SEC-each-of-the-five-matching-files-on-main-is-H-ui-catalog-and-any-case-too', SEC_MAIN.every((p) => tier([p, CS], read([p, CS])) === GOVERNED_TIER_H) && tier(['ui/skills/x/guides/Permissions.md', CS], read(['ui/skills/x/guides/Permissions.md', CS])) === GOVERNED_TIER_H && tier(['skills/x/rules/SECURITY.md', CS], read(['skills/x/rules/SECURITY.md', CS])) === GOVERNED_TIER_H);
    assert('⛔ SEC-a-skill-FOLDER-named-for-it-is-H-though-its-file-is-SKILL-md', tier(['skills/objectstack-security/SKILL.md', CS], read(['skills/objectstack-security/SKILL.md', CS])) === GOVERNED_TIER_H);
    assert('⛔ SEC-a-rename-INTO-a-security-name-is-H-both-paths-are-read', tier(['skills/a/rules/guide.md', 'skills/a/rules/permission-guide.md', CS], read(['skills/a/rules/guide.md', 'skills/a/rules/permission-guide.md', CS])) === GOVERNED_TIER_H);
    assert('⛔ SEC-a-rename-OUT-OF-a-security-name-is-H-both-paths-are-read', tier(['skills/a/rules/security.md', 'skills/a/rules/guide.md', CS], read(['skills/a/rules/security.md', 'skills/a/rules/guide.md', CS])) === GOVERNED_TIER_H);
    assert('SEC-CONTROL-the-name-test-reads-below-the-catalog-row-only-a-security-word-in-a-rider-path-stays-S', tier([SK, CS, 'docs/agents/security-notes.md'], read([SK, CS, 'docs/agents/security-notes.md'])) === GOVERNED_TIER_S && tier(['skills/objectstack-data/rules/hooks.md', CS], read(['skills/objectstack-data/rules/hooks.md', CS])) === GOVERNED_TIER_S);
    // ⛔ Only a MODIFIED regular catalog file is wording: add, delete, rename, a symlink, or no status is H.
    const cat = (paths, files) => read(paths, { catalogFiles: { measured: true, reason: null, files } });
    assert('⛔ STATUS-adding-a-new-skill-file-is-H', tier([SK, CS], cat([SK, CS], [{ path: SK, status: 'added', mode: '100644' }])) === GOVERNED_TIER_H && /added, deleted or renamed rather than modified: skills\/objectstack-data\/SKILL\.md \(added\)/.test(reasons([SK, CS], cat([SK, CS], [{ path: SK, status: 'added', mode: '100644' }]))));
    assert('⛔ STATUS-deleting-a-skill-is-H-on-either-spelling', ['removed', 'deleted'].every((st) => tier([SK, CS], cat([SK, CS], [{ path: SK, status: st, mode: null }])) === GOVERNED_TIER_H));
    assert('⛔ STATUS-a-rename-inside-the-catalog-is-H-both-sides', tier(['skills/a/x.md', 'skills/a/y.md', CS], cat(['skills/a/x.md', 'skills/a/y.md', CS], [{ path: 'skills/a/y.md', status: 'renamed', mode: '100644' }, { path: 'skills/a/x.md', status: 'renamed', mode: null }])) === GOVERNED_TIER_H);
    assert('⛔ STATUS-an-eval-added-in-one-commit-and-modified-in-the-next-is-H', tier(['skills/a/evals/e.json', CS], cat(['skills/a/evals/e.json', CS], [{ path: 'skills/a/evals/e.json', status: 'added', mode: '100644' }, { path: 'skills/a/evals/e.json', status: 'modified', mode: '100644' }])) === GOVERNED_TIER_H);
    assert('⛔ STATUS-a-symlink-or-a-mode-not-read-is-H-an-executable-regular-file-is-not', tier([SK, CS], cat([SK, CS], [{ path: SK, status: 'modified', oldMode: '120000', mode: '120000' }])) === GOVERNED_TIER_H && /not a regular file at both ends: skills\/objectstack-data\/SKILL\.md \(120000 to 120000\)/.test(reasons([SK, CS], cat([SK, CS], [{ path: SK, status: 'modified', oldMode: '120000', mode: '120000' }]))) && tier([SK, CS], cat([SK, CS], [{ path: SK, status: 'modified', oldMode: '100644', mode: null }])) === GOVERNED_TIER_H && tier([SK, CS], cat([SK, CS], [{ path: SK, status: 'modified', oldMode: '100755', mode: '100755' }])) === GOVERNED_TIER_S);
    // ⛔ N10 (record 6888217778): the API can call a symlink replaced by a regular file `modified`, so the
    // BASE mode is read too, and any change of mode is H — a regular mode at the head alone proves nothing.
    assert('⛔ MODE-a-symlink-turned-regular-file-called-modified-is-H-on-its-base-mode', tier([SK, CS], cat([SK, CS], [{ path: SK, status: 'modified', oldMode: '120000', mode: '100644' }])) === GOVERNED_TIER_H && /not a regular file at both ends: skills\/objectstack-data\/SKILL\.md \(120000 to 100644\)/.test(reasons([SK, CS], cat([SK, CS], [{ path: SK, status: 'modified', oldMode: '120000', mode: '100644' }]))));
    assert('⛔ MODE-a-regular-file-made-executable-or-back-is-H-any-mode-change-is', ['100644', '100755'].every((from) => { const to = from === '100644' ? '100755' : '100644'; const c = cat([SK, CS], [{ path: SK, status: 'modified', oldMode: from, mode: to }]); return tier([SK, CS], c) === GOVERNED_TIER_H && new RegExp(`mode changed: skills/objectstack-data/SKILL\\.md \\(${from} to ${to}\\)`).test(reasons([SK, CS], c)); }));
    assert('⛔ MODE-a-base-mode-not-read-is-H-the-head-mode-alone-never-reads-S', tier([SK, CS], cat([SK, CS], [{ path: SK, status: 'modified', mode: '100644' }])) === GOVERNED_TIER_H && /\(base mode not read to 100644\)/.test(reasons([SK, CS], cat([SK, CS], [{ path: SK, status: 'modified', mode: '100644' }]))));
    assert('⛔ STATUS-a-catalog-path-with-no-status-row-or-no-status-reading-is-H', tier([SK, CS], cat([SK, CS], [])) === GOVERNED_TIER_H && /no status was read for/.test(reasons([SK, CS], cat([SK, CS], []))) && tier([SK, CS], read([SK, CS], { catalogFiles: { measured: false, reason: 'not here', files: [] } })) === GOVERNED_TIER_H && tier([SK, CS], read([SK, CS], { catalogFiles: undefined })) === GOVERNED_TIER_H && tier([SK, CS], cat([SK, CS], [{ path: SK, status: '', mode: '100644' }])) === GOVERNED_TIER_H);
    assert('STATUS-a-changeset-or-docs-rider-ADDED-beside-a-modified-skill-stays-S-the-status-test-reads-catalog-paths-only', tier([SK, CS, 'docs/agents/new.md'], read([SK, CS, 'docs/agents/new.md'])) === GOVERNED_TIER_S);
    assert('pullCatalogStatuses-reads-each-status-and-a-renames-old-name', (() => {
      const st = pullCatalogStatuses([{ filename: 'a.md', status: 'modified' }, { filename: 'b.md', status: 'renamed', previous_filename: 'c.md' }, { filename: 'd.md' }]);
      return JSON.stringify(st) === JSON.stringify([{ path: 'a.md', status: 'modified' }, { path: 'b.md', status: 'renamed' }, { path: 'c.md', status: 'renamed' }, { path: 'd.md', status: '' }]);
    })());
    // N10: a copy's source is not renamed — it is carried as `copied source`, never `modified`, so still H.
    assert('⛔ pullCatalogStatuses-carries-a-copys-source-as-copied-source-never-renamed-or-modified-and-it-reads-H', (() => {
      const st = pullCatalogStatuses([{ filename: 'skills/a/new.md', status: 'copied', previous_filename: SK }, { filename: 'e.md', status: 'modified', previous_filename: 'f.md' }]);
      return JSON.stringify(st) === JSON.stringify([{ path: 'skills/a/new.md', status: 'copied' }, { path: SK, status: 'copied source' }, { path: 'e.md', status: 'modified' }, { path: 'f.md', status: 'modified source' }]) &&
        tier([SK, CS], cat([SK, CS], [{ path: SK, status: 'copied source', oldMode: '100644', mode: '100644' }])) === GOVERNED_TIER_H;
    })());
    assert('pullCatalogReading-reads-the-mode-of-each-modified-catalog-file-at-the-merge-base-and-the-head-or-is-NOT-MEASURED', (() => {
      const Hd = 'a'.repeat(40);
      const Bs = 'b'.repeat(40);
      const Mb = 'c'.repeat(40);
      // SK was a symlink at the merge base and is a regular file at the head: the API calls it `modified`.
      const modeOf = (sha, p) => (p === SK ? (sha === Mb ? '120000' : '100644') : '100644');
      const run = (argv) => (argv[0] === 'cat-file' ? { ok: true, out: '' } : argv[0] === 'merge-base' ? { ok: true, out: Mb } : argv[0] === 'ls-tree' ? { ok: true, out: `${modeOf(argv[1], argv[3])} blob ${'f'.repeat(40)}\t${argv[3]}` } : { ok: false, out: '' });
      const statuses = [{ path: SK, status: 'modified' }, { path: UISK, status: 'modified' }, { path: 'skills/a/new.md', status: 'added' }, { path: CS, status: 'added' }];
      const derivation = { headSha: Hd, baseSha: Bs, pull: 2 };
      const r = pullCatalogReading({ derivation, statuses, paths: [SK, UISK, 'skills/a/new.md', CS], sameCheckout: true, run });
      const noBase = pullCatalogReading({ derivation, statuses, paths: [SK], sameCheckout: true, run: (argv) => (argv[0] === 'cat-file' && argv[2] === `${Bs}^{commit}` ? { ok: false, out: '' } : run(argv)) });
      return r.measured === true && r.files.length === 3 && r.files[0].oldMode === '120000' && r.files[0].mode === '100644' && r.files[1].oldMode === '100644' && r.files[1].mode === '100644' && r.files[2].mode === null && r.files[2].oldMode === null &&
        tier([SK, CS], read([SK, CS], { catalogFiles: pullCatalogReading({ derivation, statuses, paths: [SK, CS], sameCheckout: true, run }) })) === GOVERNED_TIER_H &&
        noBase.measured === false && /bbbbbbbbbb not in this checkout — `git fetch origin bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`$/.test(noBase.reason) &&
        pullCatalogReading({ derivation: { ...derivation, baseRef: 'release/v4' }, statuses, paths: [SK], sameCheckout: true, run: () => ({ ok: false, out: '' }) }).reason.endsWith('`git fetch origin pull/2/head release/v4`') &&
        pullCatalogReading({ derivation: { headSha: Hd, pull: 2 }, statuses, paths: [SK], sameCheckout: true, run }).measured === false &&
        pullCatalogReading({ derivation, statuses, paths: [SK], sameCheckout: true, run: (argv) => (argv[0] === 'merge-base' ? { ok: false, out: '' } : run(argv)) }).measured === false &&
        pullCatalogReading({ derivation, statuses, paths: [SK], sameCheckout: false, run }).measured === false &&
        pullCatalogReading({ derivation, statuses: null, paths: [SK], sameCheckout: true, run }).measured === false &&
        pullCatalogReading({ derivation, statuses, paths: [SK], sameCheckout: true, run: () => ({ ok: false, out: '' }) }).measured === false;
    })());
    assert('LOW_RISK_ARM_FILE_PATTERNS-are-frozen-and-two', Object.isFrozen(LOW_RISK_ARM_FILE_PATTERNS) && LOW_RISK_ARM_FILE_PATTERNS.length === 2);
    assert('pullChangesetReading-reads-each-changeset-at-the-head-or-is-NOT-MEASURED', (() => {
      const H = 'a'.repeat(40);
      const run = (argv) => (argv[0] === 'cat-file' ? { ok: true, out: '' } : argv[1] === `${H}:${CS}` ? { ok: true, out: CS_TEXT } : { ok: false, out: '' });
      const ok = pullChangesetReading({ derivation: { headSha: H, pull: 2 }, paths: [SK, CS, '.changeset/gone.md'], sameCheckout: true, run });
      const away = pullChangesetReading({ derivation: { headSha: H, pull: 2 }, paths: [CS], sameCheckout: true, run: () => ({ ok: false, out: '' }) });
      return ok.measured === true && ok.files.length === 2 && ok.files[0].text === CS_TEXT && ok.files[1].text === null &&
        away.measured === false && /git fetch origin pull\/2\/head/.test(away.reason) &&
        pullChangesetReading({ derivation: { headSha: H, pull: 2 }, paths: [CS], sameCheckout: false, run }).measured === false &&
        pullChangesetReading({ derivation: { headSha: null, pull: 2 }, paths: [CS], sameCheckout: true, run }).measured === false;
    })());
    assert('lowRiskRowHit-reads-the-arm-rows-only', lowRiskRowHit([SK]) && lowRiskRowHit(['x', UISK]) && lowRiskRowHit(['docs/adr/1.md']) && !lowRiskRowHit(['.claude/x.md', 'packages/a.ts', 'ui/docs/adr/1.md', 'docs/NORTH-STAR.md']) && !lowRiskRowHit(null));
  }

  battery('the nested `ui/` workspace rows, on the register (#25712)');
  const UI_ROWS = GOVERNED_SURFACES.filter((s) => s.id.startsWith('ui-'));
  const ROOT_ROWS = Object.freeze(GOVERNED_SURFACES.filter((s) => !s.id.startsWith('ui-')));
  const UI_SPECIMENS = { 'ui-adr': 'ui/docs/adr/0001-master-detail-subform.md', 'ui-claude-tree': 'ui/.claude/skills/verify/SKILL.md', 'ui-skills-catalog': 'ui/skills/objectui/SKILL.md', 'ui-agents-md': 'ui/AGENTS.md', 'ui-claude-md': 'ui/CLAUDE.md', 'ui-workflows': 'ui/.github/workflows/ci.yml' };
  assert('the-ui-rows-are-six-well-formed-register-rows', UI_ROWS.length === 6 && UI_ROWS.every((r) => (r.prefix ? r.prefix.endsWith('/') && r.glob === `${r.prefix}**` && r.exact === undefined : r.glob === r.exact) && r.tier === GOVERNED_TIER_H && r.tierRepos === undefined && surfaceRepos(r).join() === 'objectstack') && new Set(GOVERNED_SURFACES.map((r) => r.id)).size === GOVERNED_SURFACES.length, JSON.stringify(UI_ROWS.map((r) => r.id)));
  assert('the-ui-rows-mirror-the-six-rows-objectui-governs-each-under-ui', UI_ROWS.map((r) => r.glob).join() === ROOT_ROWS.filter((s) => s.id !== 'north-star' && surfaceRepos(s).includes('objectui')).map((s) => `ui/${s.glob}`).join(), UI_ROWS.map((r) => r.glob).join());
  for (const row of UI_ROWS) {
    assert(`the-${row.id}-specimen-is-governed-by-its-own-row-alone`, ids([UI_SPECIMENS[row.id]]).join() === row.id, ids([UI_SPECIMENS[row.id]]).join());
  }
  assert('every-ui-row-lands-Tier-H-the-ui-claude-tree-included', Object.values(UI_SPECIMENS).every((p) => governedTierFor([p], REPO) === GOVERNED_TIER_H) && governedTierFor([UI_SPECIMENS['ui-claude-tree'], '.claude/agents/os-dev.md'], REPO) === GOVERNED_TIER_H);
  assert('--test-judges-a-ui-claude-path-Tier-H-and-a-ui-package-source-path-not-governed', testVerdict(['ui/.claude/x'], { repo: REPO }).tier === GOVERNED_TIER_H && testVerdict(['ui/packages/x/src/y.ts'], { repo: REPO }).governed === false && testVerdict(['ui/packages/x/src/y.ts'], { repo: REPO }).tier === null);
  assert('a-ui-source-path-is-NOT-governed', ids(['ui/packages/components/src/index.ts', 'ui/apps/console/src/App.tsx', 'ui/package.json', 'ui/.changeset/config.json']).length === 0);
  assert('nested-copies-and-near-misses-stay-out', ids(['ui/examples/AGENTS.md', 'ui/packages/x/AGENTS.md', 'ui/packages/x/.github/workflows/w.yml', 'ui/.claude-x/y.md', 'ui/skillsx/a.md', 'ui/docs/adrs/z.md', 'ui/.github/CODEOWNERS', 'xui/AGENTS.md']).length === 0);
  assert('the-root-rows-do-not-reach-into-ui-and-the-ui-rows-do-not-reach-the-root', ids(['ui/.github/workflows/ci.yml', '.github/workflows/lint.yml', 'ui/AGENTS.md', 'AGENTS.md']).join() === 'agents-md,workflows,ui-agents-md,ui-workflows');
  assert('the-ui-rows-govern-objectstack-alone', ['objectui', 'cloud', 'objectos', 'hotcrm'].every((r) => governedPathsIn(Object.values(UI_SPECIMENS), r).length === 0) && governedSurfacesFor('objectui').length === 7);
  assert('a-register-handed-in-is-counted-by-the-same-reader', governedSurfacesFor(REPO, ROOT_ROWS).length === governedSurfacesFor(REPO).length - UI_ROWS.length && governedPathsIn(Object.values(UI_SPECIMENS), REPO, ROOT_ROWS).length === 0);
  assert('the-register-knows-ui-the-rows-are-live', ids(Object.values(UI_SPECIMENS)).length === UI_ROWS.length && governedSurfacesFor(REPO).length === 20);

  // ── the dispatch-gates declaration (#9979) ───────────────────────────────
  //
  // Enforcement cannot hold any of these: the declaration is read by another
  // tool entirely, so a wrong or missing entry runs perfectly green here and
  // shows up only as a dev dispatched on a root-file card who is not told that
  // the card is GOVERNED.
  battery('the dispatch-gates declaration (#9979)');
  // Only the SEPARATOR-LESS exact rows need a hint; an exact row that carries a
  // separator (`docs/NORTH-STAR.md`) reaches dispatch-gates as written.
  const rootExacts = GOVERNED_SURFACES.filter((s) => s.exact && !s.exact.includes('/')).map((s) => s.exact);
  assert('an-exact-row-with-a-separator-declares-no-hint', GOVERNED_SURFACES.filter((s) => s.exact && s.exact.includes('/')).every((s) => !ROOT_FILE_WATCH_HINTS.includes(`${s.exact}/**`)) && GOVERNED_SURFACES.some((s) => s.exact === 'docs/NORTH-STAR.md'));
  assert('every-exact-root-row-declares-a-watch-hint', rootExacts.every((f) => ROOT_FILE_WATCH_HINTS.includes(`${f}/**`)), JSON.stringify(rootExacts));
  assert('the-declaration-names-no-file-this-register-does-not-govern', ROOT_FILE_WATCH_HINTS.every((h) => rootExacts.includes(h.replace(/\/\*+$/, ''))), JSON.stringify(ROOT_FILE_WATCH_HINTS));
  assert('both-root-instruction-files-are-declared', ROOT_FILE_WATCH_HINTS.join(',') === 'AGENTS.md/**,CLAUDE.md/**', ROOT_FILE_WATCH_HINTS.join(','));
  // Provenance, never a matcher: `governedSlice` compares against `exact` and
  // `check-governed-prose.mjs` demands `glob` verbatim in the instruction
  // files. The glob spelling appearing in either field would change what this
  // register governs, and what that gate requires the prose to say.
  assert('the-declared-form-is-neither-an-exact-nor-a-glob-value', !GOVERNED_SURFACES.some((s) => ROOT_FILE_WATCH_HINTS.includes(s.exact) || ROOT_FILE_WATCH_HINTS.includes(s.glob)));

  // ── subject → PR (both GitHub spellings; the trailing parenthetical wins) ─
  assert('squash-subject', pullNumberFromSubject('fix(api): envelope the error paths (#9456)') === 9456);
  assert('merge-subject', pullNumberFromSubject('Merge pull request #123 from x/y') === 123);
  assert('mid-title-issue-citation-is-not-the-pr', pullNumberFromSubject('docs: checklist names the renamed check run (#9420) (#9490)') === 9490);
  assert('no-pr-in-subject', pullNumberFromSubject('chore: direct push') === null);

  // ── the two landing tiers (#19133, ruled 2026-09-18) ─────────────────────
  //
  // Membership is pinned above and unchanged; what this battery pins is the
  // LANDING attribute: which rows carry S, that a PR is S only when every
  // governed path is S, that the verdict line and `--json` carry the tier while
  // the exit stays shared, and that a lift recomputes it.
  battery('⚖️ the two landing tiers (#19133, ruled 2026-09-18)');
  const tierOf = (id) => GOVERNED_SURFACES.find((s) => s.id === id)?.tier;
  assert('every-row-carries-a-tier-and-it-is-H-or-S', GOVERNED_SURFACES.every((s) => s.tier === GOVERNED_TIER_H || s.tier === GOVERNED_TIER_S), JSON.stringify(GOVERNED_SURFACES.map((s) => [s.id, s.tier])));
  assert('the-tier-values-are-distinct-single-letters-a-reader-greps', GOVERNED_TIER_H === 'H' && GOVERNED_TIER_S === 'S' && Object.keys(GOVERNED_TIERS).join() === 'H,S');
  assert('Tier-S-is-exactly-the-whole-claude-tree-row', GOVERNED_SURFACES.filter((s) => s.tier === GOVERNED_TIER_S).map((s) => s.id).join() === 'claude-tree');
  assert('Tier-H-is-the-law-adr-north-star-skills-catalog-agents-md-claude-md-the-workflows-row-the-six-ui-rows-hooks-settings-and-the-guard-instruments', GOVERNED_SURFACES.filter((s) => s.tier === GOVERNED_TIER_H).map((s) => s.id).join() === 'adr,skills-catalog,agents-md,claude-md,north-star,workflows,ui-adr,ui-claude-tree,ui-skills-catalog,ui-agents-md,ui-claude-md,ui-workflows,claude-hooks,claude-settings,claude-settings-local,guard-merges,guard-queue,guard-records,guard-dispatch-gates');
  assert('settings-and-hooks-are-Tier-H-again-by-the-2026-11-19-ruling-each-alone', ['.claude/settings.json', '.claude/settings.local.json', '.claude/hooks/guard-main-checkout.sh'].every((p) => governedTierFor([p], REPO) === GOVERNED_TIER_H) && governedTierFor(['.claude/agents/os-dev.md', '.claude/settings.json'], REPO) === GOVERNED_TIER_H);
  assert('skills-agents-and-the-fact-layer-are-Tier-S', governedTierFor(['.claude/skills/pm-dispatch/SKILL.md', '.claude/agents/os-dev.md', '.claude/skills/pm-dispatch/references/contract-review.md'], REPO) === GOVERNED_TIER_S);
  assert('each-Tier-H-surface-answers-H-alone', ['docs/adr/0001-x.md', 'docs/NORTH-STAR.md', 'skills/objectstack-ui/SKILL.md', 'AGENTS.md', 'CLAUDE.md'].every((p) => governedTierFor([p], REPO) === GOVERNED_TIER_H));
  assert('ALL-not-ANY-one-Tier-H-path-makes-the-whole-list-Tier-H', governedTierFor(['.claude/agents/os-dev.md', '.claude/settings.json', 'AGENTS.md'], REPO) === GOVERNED_TIER_H);
  assert('an-ungoverned-rider-neither-demotes-a-Tier-H-list-nor-promotes-a-Tier-S-one', governedTierFor(['README.md', 'AGENTS.md'], REPO) === GOVERNED_TIER_H && governedTierFor(['README.md', '.claude/agents/os-dev.md'], REPO) === GOVERNED_TIER_S);
  assert('an-EMPTY-or-UNGOVERNED-list-answers-H-fail-closed', governedTierFor([], REPO) === GOVERNED_TIER_H && governedTierFor(undefined, REPO) === GOVERNED_TIER_H && governedTierFor(['README.md'], REPO) === GOVERNED_TIER_H);
  assert('the-published-skills-catalog-stays-Tier-H-the-seat-did-not-propose-moving-it', tierOf('skills-catalog') === GOVERNED_TIER_H);
  assert('--test-carries-the-tier-and-null-when-nothing-is-governed', testVerdict(['.claude/agents/os-dev.md'], { repo: REPO }).tier === GOVERNED_TIER_S && testVerdict(['AGENTS.md'], { repo: REPO }).tier === GOVERNED_TIER_H && testVerdict(['README.md'], { repo: REPO }).tier === null);
  const tierSCase = testVerdict(['packages/spec/src/index.ts', '.claude/agents/os-dev.md'], { repo: REPO });
  const tierHCase = testVerdict(['packages/spec/src/index.ts', '.claude/agents/os-dev.md', 'AGENTS.md'], { repo: REPO });
  const tierSText = renderTestVerdict(tierSCase);
  const tierHText = renderTestVerdict(tierHCase);
  assert('a-Tier-S-verdict-renders-its-OWN-block-naming-the-record-on-thread-landing', /Tier S/.test(tierSText) && /## Contract review/.test(tierSText) && /CONTRACT_REVIEW_TIER/.test(tierSText) && !/--pair/.test(tierSText), tierSText);
  assert('and-still-says-GOVERNED-with-the-three-verbs-so-every-grep-reader-keeps-its-answer', /GOVERNED/.test(tierSText) && /arms auto-merge/.test(tierSText) && !/human merge is the review record/.test(tierSText), tierSText);
  assert('a-Tier-H-verdict-keeps-its-wording-word-for-word-and-names-its-tier', /a human merge is the review record for this PR/.test(tierHText) && /landing tier: H/.test(tierHText) && !/Tier S/.test(tierHText), tierHText);
  assert('a-mixed-list-renders-H-the-one-Tier-H-path-decides', tierHCase.tier === GOVERNED_TIER_H && tierHCase.hitPaths.join() === '.claude/agents/os-dev.md,AGENTS.md', JSON.stringify(tierHCase.hitPaths));
  assert('exit-3-is-SHARED-by-both-tiers-the-tier-lives-in-the-words-and-the-json-never-the-status', runTestModeExitFor(['.claude/agents/os-dev.md'], REPO) === EXIT_TEST_GOVERNED && runTestModeExitFor(['AGENTS.md'], REPO) === EXIT_TEST_GOVERNED && runTestModeExitFor(['README.md'], REPO) === EXIT_TEST_NOT_GOVERNED);
  // A lift can change the tier: a diff whose only Tier H hit is a certified
  // regeneration under `skills/**` is, post-lift, a Tier S diff — the tier is
  // recomputed on the lifted slice, never read off the pre-lift one.
  const liftPath = 'skills/objectstack-ui/references/_index.md';
  const lifted = new Map([[liftPath, { pureRegeneration: true, reason: 'byte-equal to the generator' }]]);
  const preLift = testVerdict([liftPath, '.claude/agents/os-dev.md'], { repo: REPO });
  const postLift = applyGeneratedExceptions(preLift, lifted);
  assert('the-tier-is-recomputed-on-the-LIFTED-slice', preLift.tier === GOVERNED_TIER_H && postLift.tier === GOVERNED_TIER_S && postLift.governed === true, JSON.stringify([preLift.tier, postLift.tier]));
  const allLifted = applyGeneratedExceptions(testVerdict([liftPath], { repo: REPO }), lifted);
  assert('and-null-once-every-hit-is-lifted', allLifted.governed === false && allLifted.tier === null, JSON.stringify(allLifted.tier));
  assert('the-tier-words-name-the-landing-each-waits-for', /GOVERNED_APPROVERS/.test(GOVERNED_TIERS.H.landing) && /Contract review/.test(GOVERNED_TIERS.S.landing) && !/--pair/.test(GOVERNED_TIERS.S.landing));

  // ── a row's tier is scoped per repository (#25199) ───────────────────────
  //
  // The tier a row lands on is the one the repository's OWN queue guard
  // enforces, and only objectstack's guard has a Tier S arm: objectui's refuses
  // a `.claude/**` diff without an authorized approval. So the `claude-tree`
  // row's Tier S holds in objectstack alone and every other repository reads
  // it Tier H — membership untouched, the raw row untouched for the readers of
  // its glob words (the queue guard's `tierSGlobs`).
  battery('a row\'s tier is scoped per repository (#25199)');
  const claudeRow = GOVERNED_SURFACES.find((s) => s.id === 'claude-tree');
  const HOOK = '.claude/hooks/x.sh';
  const PR_13320 = ['guard-main-checkout-bash', 'guard-shared-stash', 'guard-tree-enum'].flatMap((h) => [`.claude/hooks/${h}.selftest.sh`, `.claude/hooks/${h}.sh`]);
  const elsewhere = everyRepo.filter((r) => r !== 'objectstack');
  assert('the-claude-tree-row-holds-Tier-S-in-objectstack-alone', claudeRow.tier === GOVERNED_TIER_S && claudeRow.tierRepos?.join() === 'objectstack' && claudeRow.repos === undefined, JSON.stringify(claudeRow));
  assert('it-is-the-only-row-that-scopes-its-tier', GOVERNED_SURFACES.filter((s) => s.tierRepos !== undefined).map((s) => s.id).join() === 'claude-tree');
  assert('every-tier-scope-is-a-non-empty-duplicate-free-subset-of-the-rows-own-repositories-on-a-Tier-S-row', GOVERNED_SURFACES.every((s) => s.tierRepos === undefined || (s.tier === GOVERNED_TIER_S && Array.isArray(s.tierRepos) && s.tierRepos.length > 0 && new Set(s.tierRepos).size === s.tierRepos.length && s.tierRepos.every((id) => surfaceRepos(s).includes(id)))));
  const AGENT_DEF = '.claude/agents/x.md';
  assert('an-objectstack-claude-path-is-Tier-S-unchanged', governedTierFor([AGENT_DEF], 'objectstack') === GOVERNED_TIER_S && testVerdict([AGENT_DEF], { repo: 'objectstack' }).tier === GOVERNED_TIER_S);
  assert('but-an-objectstack-hook-path-reads-Tier-H-by-its-own-row-2026-11-19', governedTierFor([HOOK], 'objectstack') === GOVERNED_TIER_H && governedPathsIn([HOOK], 'objectstack').map((s) => `${s.id}:${s.tier}`).join() === 'claude-tree:S,claude-hooks:H');
  assert('an-objectui-claude-path-is-governed-by-the-same-row-and-lands-Tier-H', governedPathsIn([HOOK], 'objectui').map((s) => `${s.id}:${s.tier}`).join() === 'claude-tree:H' && governedTierFor([HOOK], 'objectui') === GOVERNED_TIER_H && testVerdict([HOOK], { repo: 'objectui' }).governed === true);
  assert('cloud-objectos-and-hotcrm-read-Tier-H-their-guards-unread-so-fail-closed', elsewhere.every((r) => governedTierFor([HOOK], r) === GOVERNED_TIER_H && governedPathsIn([HOOK], r).map((s) => s.id).join() === 'claude-tree'));
  assert('a-repository-the-scope-does-not-name-answers-H-including-one-added-later', surfaceTierIn(claudeRow, 'objectstack') === GOVERNED_TIER_S && surfaceTierIn(claudeRow, 'a-future-repo') === GOVERNED_TIER_H && GOVERNED_SURFACES.filter((s) => s.tierRepos === undefined).every((s) => everyRepo.every((r) => surfaceTierIn(s, r) === s.tier)));
  assert('the-scope-moves-no-membership-every-repository-keeps-its-rows-in-order', everyRepo.every((r) => governedSurfacesFor(r).map((s) => s.id).join() === GOVERNED_SURFACES.filter((s) => surfaceRepos(s).includes(r)).map((s) => s.id).join()));
  assert('objectstack-is-handed-the-tables-own-frozen-rows-and-the-raw-row-keeps-S-for-the-glob-words', governedSurfacesFor('objectstack').every((s) => GOVERNED_SURFACES.includes(s)) && governedSurfacesFor('objectui').find((s) => s.id === 'claude-tree') !== claudeRow && Object.isFrozen(governedSurfacesFor('objectui').find((s) => s.id === 'claude-tree')) && claudeRow.tier === GOVERNED_TIER_S);
  const ui13320 = testVerdict(PR_13320, { repo: 'objectui' });
  const ui13320Text = renderTestVerdict(ui13320);
  assert('the-objectui-13320-replay-reads-GOVERNED-Tier-H-and-says-so', ui13320.governed === true && ui13320.tier === GOVERNED_TIER_H && ui13320.hitPaths.length === 6 && /landing tier: H/.test(ui13320Text) && !/Tier S/.test(ui13320Text), ui13320Text);
  assert('and-the-same-six-paths-in-objectstack-now-read-Tier-H-by-the-hooks-row-2026-11-19', testVerdict(PR_13320, { repo: 'objectstack' }).tier === GOVERNED_TIER_H && /landing tier: H/.test(renderTestVerdict(testVerdict(PR_13320, { repo: 'objectstack' }))));
  assert('an-objectui-mixed-diff-stays-H-and-the-exit-stays-the-shared-3', governedTierFor([HOOK, 'README.md'], 'objectui') === GOVERNED_TIER_H && governedTierFor([HOOK, 'AGENTS.md'], 'objectui') === GOVERNED_TIER_H && runTestModeExitFor([HOOK], 'objectui') === EXIT_TEST_GOVERNED);

  // ── the guard instruments and the `.claude/**` declaration split (ruled 2026-11-19) ──
  //
  // Each branch the ruling names, both ways: a guard instrument, a hook or a settings file is Tier H by
  // its own row whatever the body says; a `.claude/**` path is Tier S only on one bare `Rule-change: none`
  // (or `ruled` beside a `Ruling-ref:` line) that the record on this head verifies with the SAME value.
  battery('⚖️ the guard instruments and the `.claude/**` declaration split (ruled 2026-11-19)');
  {
    const GUARDS = ['scripts/pm/check-governed-merges.mjs', 'scripts/pm/check-governed-queue-guard.mjs', 'scripts/pm/record-recognisers.mjs', 'scripts/pm/dispatch-gates.mjs'];
    const NEW_ROWS = ['claude-hooks', 'claude-settings', 'claude-settings-local', 'guard-merges', 'guard-queue', 'guard-records', 'guard-dispatch-gates'];
    const rows = NEW_ROWS.map((id) => GOVERNED_SURFACES.find((s) => s.id === id));
    assert('the-seven-rows-are-Tier-H-and-govern-objectstack-alone', rows.every((s) => s && s.tier === GOVERNED_TIER_H && surfaceRepos(s).join() === 'objectstack' && s.tierRepos === undefined && !s.split && !s.lowRisk && !s.ruleChange), JSON.stringify(rows.map((s) => s?.id)));
    assert('the-four-guard-rows-match-each-instrument-by-its-exact-path-and-it-exists', GUARDS.every((p, i) => rows[3 + i].exact === p && rows[3 + i].prefix === undefined && existsSync(resolve(scriptDir, '..', '..', p))), GUARDS.join());
    assert('each-guard-instrument-alone-lands-Tier-H-in-objectstack-and-is-ungoverned-in-objectui', GUARDS.every((p) => governedTierFor([p], 'objectstack') === GOVERNED_TIER_H && governedPathsIn([p], 'objectstack').length === 1 && governedPathsIn([p], 'objectui').length === 0));
    const SKILL = '.claude/skills/pm-dispatch/SKILL.md';
    const REC = (value, extra = {}) => ({ measured: true, reason: null, located: 'found', where: 'PR', id: 7, carried: null, ruleChangeVerified: value === undefined ? { state: 'missing' } : { state: 'read', value }, ...extra });
    const READ = (body, record) => ({ measured: true, reason: null, body, ...(record === undefined ? {} : { record }) });
    const tierWith = (paths, reading, repo = 'objectstack') => governedTierFor(paths, repo, GOVERNED_SURFACES, null, null, reading);
    const verdictOf = (reading, paths = [SKILL], repo = 'objectstack') => applyRuleChangeSplit(governedPathsIn(paths, repo), repo, reading).find((s) => s.ruleChangeVerdict)?.ruleChangeVerdict ?? null;
    const NONE = 'Fixes #1\n\nRule-change: none\n';
    const RULED = 'Fixes #1\n\nRule-change: ruled\nRuling-ref: 「以上都同意」 — the maintainer, review-split thread, 2026-11-19T03:16Z\n';
    const S_NONE = READ(NONE, REC('none'));
    for (const p of ['.claude/settings.json', '.claude/settings.local.json', '.claude/hooks/guard-x.sh']) {
      assert(`${p}-is-Tier-H-even-beside-a-verified-declaration`, tierWith([p], S_NONE) === GOVERNED_TIER_H && governedTierFor([p], 'objectstack') === GOVERNED_TIER_H);
    }
    assert('only-the-claude-tree-row-carries-the-split-and-only-in-objectstack', GOVERNED_SURFACES.filter((s) => s.ruleChange).map((s) => s.id).join() === 'claude-tree' && ruleChangeSplitIn(GOVERNED_SURFACES.find((s) => s.id === 'claude-tree'), 'objectstack') && !ruleChangeSplitIn(GOVERNED_SURFACES.find((s) => s.id === 'claude-tree'), 'objectui'));
    const pathOnly = governedPathsIn([SKILL], 'objectstack');
    assert('a-path-only-reader-passes-the-slice-through-as-is-and-still-reads-Tier-S', applyRuleChangeSplit(pathOnly, 'objectstack', undefined) === pathOnly && governedTierFor([SKILL], 'objectstack') === GOVERNED_TIER_S && testVerdict([SKILL], { repo: 'objectstack' }).tier === GOVERNED_TIER_S);
    assert('none-declared-and-verified-none-is-Tier-S', tierWith([SKILL], S_NONE) === GOVERNED_TIER_S && verdictOf(S_NONE)?.declared === 'none', JSON.stringify(verdictOf(S_NONE)));
    assert('ruled-beside-a-Ruling-ref-and-verified-ruled-is-Tier-S', tierWith([SKILL], READ(RULED, REC('ruled'))) === GOVERNED_TIER_S, JSON.stringify(verdictOf(READ(RULED, REC('ruled')))));
    const noRef = verdictOf(READ('Rule-change: ruled\n', REC('ruled')));
    assert('ruled-with-no-Ruling-ref-line-is-Tier-H-and-says-so', noRef?.tier === GOVERNED_TIER_H && /no line-start `Ruling-ref:`/.test(noRef.reasons.join()), JSON.stringify(noRef));
    assert('a-quoted-fenced-or-empty-Ruling-ref-does-not-count', ['> Ruling-ref: x', '```\nRuling-ref: x\n```', 'Ruling-ref:   '].every((ref) => tierWith([SKILL], READ(`Rule-change: ruled\n${ref}\n`, REC('ruled'))) === GOVERNED_TIER_H));
    const missing = verdictOf(READ('Fixes #1\n', REC('none')));
    assert('a-missing-line-is-Tier-H-and-asks-for-no-record', missing?.tier === GOVERNED_TIER_H && /no `Rule-change:` line/.test(missing.reasons.join()) && missing.reasons.length === 1, JSON.stringify(missing));
    assert('yes-is-Tier-H-even-when-the-record-verifies-yes', tierWith([SKILL], READ('Rule-change: yes\n', REC('yes'))) === GOVERNED_TIER_H);
    for (const [name, body] of [['a-second-line', `${NONE}Rule-change: none\n`], ['a-quoted-line', '> Rule-change: none\n'], ['a-fenced-line', '```\nRule-change: none\n```\n'], ['trailing-words', 'Rule-change: none (prose only)\n'], ['a-lowercase-key', 'rule-change: none\n'], ['only-a-Rule-change-verified-line', 'Rule-change-verified: none\n']]) {
      assert(`${name}-in-the-body-is-Tier-H`, tierWith([SKILL], READ(body, REC('none'))) === GOVERNED_TIER_H);
    }
    assert('a-bulleted-bold-or-backticked-bare-line-still-reads', ['- Rule-change: none', '**Rule-change:** none', '`Rule-change:` none'].every((line) => tierWith([SKILL], READ(`${line}\n`, REC('none'))) === GOVERNED_TIER_S));
    const unverified = verdictOf(READ(NONE, REC(undefined)));
    assert('a-record-with-no-Rule-change-verified-line-is-Tier-H', unverified?.tier === GOVERNED_TIER_H && /carries no `Rule-change-verified:` line/.test(unverified.reasons.join()), JSON.stringify(unverified));
    assert('a-record-verifying-the-other-value-or-yes-is-Tier-H', tierWith([SKILL], READ(NONE, REC('ruled'))) === GOVERNED_TIER_H && tierWith([SKILL], READ(RULED, REC('none'))) === GOVERNED_TIER_H && tierWith([SKILL], READ(NONE, REC('yes'))) === GOVERNED_TIER_H);
    assert('an-unreadable-line-is-Tier-H', tierWith([SKILL], READ(NONE, REC('none', { ruleChangeVerified: { state: 'unreadable', reason: '2 lines' } }))) === GOVERNED_TIER_H);
    const deferrals = [REC('none', { located: 'unsigned' }), { measured: true, reason: null, located: 'absent', where: null, id: null, carried: null }, { measured: false, reason: 'the threads could not be read' }].map((record) => verdictOf(READ(NONE, record)));
    assert('an-unsigned-absent-or-unread-record-is-DEFERRED-to-the-record-leg-which-refuses-it-never-a-clear-of-its-own', deferrals.every((v) => v?.tier === GOVERNED_TIER_S && typeof v.deferred === 'string' && /record leg refuses/.test(v.deferred)) && /Tier S on the declaration/.test(renderRuleChangeLines(applyRuleChangeSplit(governedPathsIn([SKILL], 'objectstack'), 'objectstack', READ(NONE, { measured: false, reason: 'x' })))) && verdictOf(S_NONE).deferred === null, JSON.stringify(deferrals));
    assert('a-record-carried-over-hops-that-moved-a-claude-path-is-Tier-H-and-a-standing-carry-is-S', tierWith([SKILL], READ(NONE, REC('none', { carried: { from: 'abc', ok: false, reason: 'was carried from `abc` over hops that moved .claude/x' } }))) === GOVERNED_TIER_H && tierWith([SKILL], READ(NONE, REC('none', { carried: { from: 'abc', ok: true, reason: null } }))) === GOVERNED_TIER_S);
    const pending = verdictOf(READ(NONE));
    assert('the-body-alone-with-no-record-is-pending-and-Tier-H', pending?.tier === GOVERNED_TIER_H && pending.recordStage === LOW_RISK_RECORD_STAGE.pending && pending.reasons.join() === RULE_CHANGE_PENDING_REASON, JSON.stringify(pending));
    assert('a-body-that-fails-is-not-reached-never-pending', verdictOf(READ('Fixes #1\n'))?.recordStage === LOW_RISK_RECORD_STAGE.notReached);
    const unread = verdictOf(null);
    assert('a-null-reading-is-NOT-MEASURED-Tier-H', unread?.tier === GOVERNED_TIER_H && unread.measured === false && tierWith([SKILL], { measured: false, reason: 'x' }) === GOVERNED_TIER_H);
    const mixed = applyRuleChangeSplit(governedPathsIn([SKILL, '.claude/hooks/x.sh'], 'objectstack'), 'objectstack', S_NONE);
    assert('a-mixed-diff-with-a-hook-stays-H-and-the-split-decides-nothing', landingTierOf(mixed) === GOVERNED_TIER_H && mixed.every((s) => !s.ruleChangeVerdict) && renderRuleChangeLines(mixed) === '');
    assert('an-ungoverned-path-beside-it-does-not-move-the-S', tierWith([SKILL, 'README.md'], S_NONE) === GOVERNED_TIER_S);
    assert('objectui-reads-H-whatever-the-declaration-and-the-split-is-not-read-there', tierWith([SKILL], S_NONE, 'objectui') === GOVERNED_TIER_H && verdictOf(S_NONE, [SKILL], 'objectui') === null);
    assert('the-record-line-reader-reads-read-missing-and-unreadable', ruleChangeVerifiedReading('Rule-change-verified: ruled').value === 'ruled' && ruleChangeVerifiedReading('PASS').state === 'missing' && ruleChangeVerifiedReading('Rule-change-verified: maybe').state === 'unreadable' && ruleChangeVerifiedReading('Rule-change-verified: none\nRule-change-verified: none').state === 'unreadable');
    let threw = false;
    try { keyLineReader('Rule.change'); } catch (error) { threw = error instanceof TypeError; }
    assert('the-key-reader-refuses-a-key-it-cannot-spell-as-a-plain-pattern', threw && keyLineReader(RULE_CHANGE_KEY)('Rule-change-verified: none') === null && keyLineReader(RULE_CHANGE_KEY)('Rule-change: none')?.kind === 'declared');
    const sWords = renderRuleChangeLines(applyRuleChangeSplit(governedPathsIn([SKILL], 'objectstack'), 'objectstack', S_NONE));
    const hWords = renderRuleChangeLines(applyRuleChangeSplit(governedPathsIn([SKILL], 'objectstack'), 'objectstack', READ(NONE, REC(undefined))));
    const nmWords = renderRuleChangeLines(applyRuleChangeSplit(governedPathsIn([SKILL], 'objectstack'), 'objectstack', null));
    assert('the-words-in-each-branch-name-the-ruling-and-the-two-lines', sWords.includes(RULE_CHANGE_RULING) && /Tier S/.test(sWords) && sWords.includes('`Rule-change: none`') && sWords.includes('`Rule-change-verified: none`') && /Tier H —\n {8}- /.test(hWords) && /NOT MEASURED/.test(nmWords) && renderRuleChangeLines(pathOnly) === '', `${sWords}\n${hWords}\n${nmWords}`);
    assert('the-queue-guard-workflow-is-Tier-H-by-path-on-a-comment-only-edit', classifyWorkflowChange({ path: '.github/workflows/governed-surface-guard.yml', base: 'on: push\n', head: '# c\non: push\n', inventory: null }).tier === GOVERNED_TIER_H);
  }

  // ── --since parsing ───────────────────────────────────────────────────────
  battery('since parsing');
  const now = new Date('2026-08-18T12:00:00Z');
  assert('since-hours', parseSince('24h', now) === '2026-08-17T12:00:00.000Z');
  assert('since-days', parseSince('7d', now) === '2026-08-11T12:00:00.000Z');
  assert('since-iso', parseSince('2026-08-01', now) !== null);
  assert('since-nonsense-is-null-never-a-default', parseSince('yesterday', now) === null);

  // ── the window: landing order, not committer dates (#12633) ──────────────
  //
  // The fixtures are the measured shapes, not imitations: QS-7 is a queue chain
  // whose governed entry carries a committer date 874 s — the measured maximum
  // inversion on this mainline — BEFORE its own first parent, with the boundary
  // set at that parent's date, which is exactly what `--since <上轮>` produces.
  // The old semantics dropped it and printed a clean window; the assertions
  // below pin BOTH halves of the replacement — that it is listed, and that a
  // skew the budget cannot cover reads as INCOMPLETE rather than as absent.
  battery('the window: landing order, not committer dates (#12633)');
  const ROUND_TIP_DATE = '2026-08-14T05:55:02Z';
  const qs7Governed = { sha: '01a7337fc0'.padEnd(40, '0'), date: '2026-08-14T05:40:28Z', subject: 'docs(adr): kernel object ownership (#8620)' };
  // Newest first, as `git log --first-parent` prints it. `qs7Governed` sits
  // ABOVE the round tip — it landed later — while dated 874 s earlier.
  const qs7Chain = [
    { sha: 'a'.repeat(40), date: '2026-08-14T06:30:00Z', subject: 'chore: a later landing (#900)' },
    qs7Governed,
    { sha: 'b'.repeat(40), date: ROUND_TIP_DATE, subject: 'chore: the round tip (#899)' },
    { sha: 'c'.repeat(40), date: '2026-08-14T04:00:00Z', subject: 'chore: well below the boundary (#898)' },
  ];
  const budgeted = resolveWindow({ sinceArg: ROUND_TIP_DATE });
  assert('a-bare---since-is-a-date-window-backed-off-by-the-declared-budget',
    budgeted.mode === 'date' && budgeted.budgetSeconds === SKEW_BUDGET_SECONDS && budgeted.effectiveIso === '2026-08-14T04:55:02.000Z',
    JSON.stringify(budgeted));
  assert('the-budget-is-never-the-measured-maximum-a-bound-at-todays-worst-case-self-invalidates',
    SKEW_BUDGET_SECONDS > 874 && SKEW_BUDGET_SECONDS > 1939, String(SKEW_BUDGET_SECONDS));
  // The control: the semantics this replaces. A bare committer-date cut at the
  // round tip loses the governed entry, which is the whole card.
  const naiveCut = qs7Chain.filter((c) => Date.parse(c.date) >= Date.parse(ROUND_TIP_DATE));
  assert('QS-7-control-the-old-bare-date-cut-DROPS-the-governed-entry',
    !naiveCut.some((c) => c.sha === qs7Governed.sha) && naiveCut.length === 2, JSON.stringify(naiveCut.map((c) => c.sha.slice(0, 4))));
  const qs7 = landingWindowFrom(qs7Chain, Date.parse(budgeted.effectiveIso));
  assert('QS-7-regression-pin-the-budgeted-window-LISTS-the-skewed-governed-entry',
    qs7.commits.some((c) => c.sha === qs7Governed.sha) && qs7.anchorAtEdge === false, JSON.stringify(qs7.commits.map((c) => c.sha.slice(0, 4))));
  assert('and-the-entry-classifies-as-governed-once-it-is-in-the-window',
    classifyCommit(qs7.commits.find((c) => c.sha === qs7Governed.sha), ['docs/adr/0029-kernel-object-ownership.md'], GOVERNED_REPOS[0]) !== null);
  // The second mechanism, free of the budget: an entry dated BELOW the boundary
  // that landed ABOVE something inside it is carried by the topological close,
  // whatever the skew. This is the inversion class the budget cannot bound.
  const beyondBudget = [
    { sha: 'd'.repeat(40), date: '2026-08-14T06:30:00Z', subject: 'chore: later (#901)' },
    { sha: 'e'.repeat(40), date: '2026-08-14T03:00:00Z', subject: 'docs(adr): skewed far past the budget (#8621)' },
    { sha: 'f'.repeat(40), date: ROUND_TIP_DATE, subject: 'chore: the round tip (#899)' },
    { sha: '0'.repeat(40), date: '2026-08-13T00:00:00Z', subject: 'chore: below (#897)' },
  ];
  const closed = landingWindowFrom(beyondBudget, Date.parse(budgeted.effectiveIso));
  assert('an-entry-skewed-PAST-the-budget-is-still-carried-by-the-topological-close',
    closed.commits.some((c) => c.sha === 'e'.repeat(40)) && closed.straddlers.length === 1, JSON.stringify(closed.straddlers.map((c) => c.sha.slice(0, 4))));
  assert('and-those-re-listings-are-counted-so-the-report-can-name-them', closed.straddlers[0]?.sha === 'e'.repeat(40));
  // The third case, and the invariant's teeth: a walk that never reached below
  // the boundary cannot prove its anchor is the deepest one.
  const unproven = landingWindowFrom(qs7Chain.slice(0, 3), Date.parse(budgeted.effectiveIso));
  assert('a-walk-that-never-saw-a-commit-below-the-boundary-is-an-EDGE-not-a-clean-window',
    unproven.anchorAtEdge === true, JSON.stringify(unproven));
  assert('an-empty-walk-is-a-PROVEN-empty-window-not-an-edge',
    landingWindowFrom([], Date.parse(budgeted.effectiveIso)).anchorAtEdge === false);
  // The #4690 invariant itself, over every fixture: LISTED, or INCOMPLETE.
  // Never clean-and-absent. Written as a property so a fourth fixture inherits it.
  for (const [name, chain, watch] of [
    ['QS-7', qs7Chain, qs7Governed.sha],
    ['beyond-budget', beyondBudget, 'e'.repeat(40)],
    ['unproven', qs7Chain.slice(0, 3), qs7Governed.sha],
  ]) {
    const got = landingWindowFrom(chain, Date.parse(budgeted.effectiveIso));
    assert(`the-invariant-holds-on-${name}-listed-or-INCOMPLETE-never-clean-and-absent`,
      got.commits.some((c) => c.sha === watch) || got.anchorAtEdge === true, JSON.stringify({ listed: got.commits.map((c) => c.sha.slice(0, 4)), edge: got.anchorAtEdge }));
  }
  // The escalating floors: one budget below the boundary answers the ordinary
  // case in ONE walk, and only a chain that stays at the edge pays for more.
  const walks = [];
  const fakeLog = (root, ref, opts) => {
    walks.push(opts.sinceIso ?? null);
    return opts.sinceIso && Date.parse(opts.sinceIso) > Date.parse('2026-08-14T03:00:00Z') ? qs7Chain.slice(0, 3) : qs7Chain;
  };
  const escalated = datedWindowCommits('/w', 'origin/main', budgeted, { log: fakeLog, isRoot: () => false });
  assert('the-walk-widens-until-the-anchor-is-proven-and-stops-there',
    walks.length === 2 && escalated.anchorAtEdge === false && escalated.commits.length === 3, JSON.stringify({ walks, n: escalated.commits.length }));
  const alwaysEdge = datedWindowCommits('/w', 'origin/main', budgeted, { log: () => qs7Chain.slice(0, 3), isRoot: () => false });
  assert('a-chain-that-stays-at-the-edge-through-every-floor-reports-the-EDGE-not-a-clean-window',
    alwaysEdge.anchorAtEdge === true && alwaysEdge.floorIso === null, JSON.stringify(alwaysEdge.floorIso));
  const rootStop = datedWindowCommits('/w', 'origin/main', budgeted, { log: () => qs7Chain.slice(0, 3), isRoot: () => true });
  assert('but-a-walk-that-reached-the-ROOT-commit-is-complete-by-construction-never-an-edge',
    rootStop.anchorAtEdge === false, JSON.stringify(rootStop.floorIso));

  // ── --since-ref is topological (#12633 route B) ───────────────────────────
  battery('since-ref is topological (#12633 route B)');
  const refDates = { 'v5.0.0-rc.3': '2026-08-14T05:55:02Z', deadbee: '2026-08-13T00:00:00Z' };
  const topo = resolveWindow({ sinceRefArgs: ['v5.0.0-rc.3'], resolveRefDate: (r) => refDates[r] ?? null });
  assert('a-bare---since-ref-is-a-TOPOLOGICAL-window', topo.mode === 'topological' && topo.bareRef === 'v5.0.0-rc.3', JSON.stringify(topo));
  const pinned = resolveWindow({ sinceRefArgs: ['objectstack=v5.0.0-rc.3', 'objectui=deadbee'], resolveRefDate: (r) => refDates[r] ?? null });
  assert('--since-ref-<id>=<ref>-pins-one-repo-and-is-repeatable',
    pinned.pinnedRefs.get('objectstack') === 'v5.0.0-rc.3' && pinned.pinnedRefs.get('objectui') === 'deadbee', JSON.stringify([...pinned.pinnedRefs]));
  assert('a-repos-own-pin-wins-over-the-bare-ref-and-an-unnamed-repo-takes-the-bare-one',
    refForRepo(resolveWindow({ sinceRefArgs: ['v5.0.0-rc.3', 'objectui=deadbee'], resolveRefDate: (r) => refDates[r] ?? null }), 'objectui') === 'deadbee' &&
      refForRepo(resolveWindow({ sinceRefArgs: ['v5.0.0-rc.3', 'objectui=deadbee'], resolveRefDate: (r) => refDates[r] ?? null }), 'cloud') === 'v5.0.0-rc.3');
  assert('the-fallback-date-of-a-topological-window-is-the-OLDEST-resolved-ref-a-wider-window-over-lists-never-under-lists',
    pinned.requestedIso === '2026-08-13T00:00:00.000Z', pinned.requestedIso);
  assert('and-it-carries-the-budget-too-so-a-fallback-repo-is-no-worse-off-than-a---since-run',
    pinned.effectiveIso === '2026-08-12T23:00:00.000Z', pinned.effectiveIso);
  assert('an-unresolvable---since-ref-is-a-hard-failure-never-a-default-window',
    typeof resolveWindow({ sinceRefArgs: ['nope'], resolveRefDate: () => null }).error === 'string');
  assert('and-so-is-an-unparseable---since', typeof resolveWindow({ sinceArg: 'yesterday' }).error === 'string');
  // ── #13424: every ref resolves in ITS OWN repo, never only in self ────────
  // The measured defect: `--since-ref objectui=TIP` with no objectstack pin
  // exited 1 `does not resolve to a commit`, because the DATE derivation asked
  // the self checkout about a sibling's tip. The control below is the old
  // self-only resolver, verbatim in behaviour: it still errors, which is what
  // proves the fix moved the question and not the failure.
  battery('#13424: every ref resolves in ITS OWN repo, never only in self');
  const uiOnly = resolveWindow({
    sinceRefArgs: ['objectui=uitip000000'],
    resolveRefDate: (r, repoId) => (repoId === 'objectui' && r === 'uitip000000' ? '2026-08-14T05:55:02Z' : null),
  });
  assert('a-sweep-pinning-only-a-sibling-repo-tip-resolves-its-date-in-that-repo-and-is-not-an-error',
    uiOnly.error === undefined && uiOnly.mode === 'topological' && uiOnly.requestedIso === '2026-08-14T05:55:02.000Z', JSON.stringify(uiOnly));
  const selfOnlyControl = resolveWindow({
    sinceRefArgs: ['objectui=uitip000000'],
    resolveRefDate: (r, repoId) => (repoId === 'objectstack' ? '2026-08-14T05:55:02Z' : null),
  });
  assert('control-a-resolver-that-answers-only-for-self-still-errors-the-defect-was-WHERE-the-question-went',
    typeof selfOnlyControl.error === 'string' && selfOnlyControl.error.includes('does not resolve to a commit'), JSON.stringify(selfOnlyControl.error));
  // A pin is asked ONLY of its own repo — asking self about a sibling's tip is
  // the exact read the defect was made of, so the resolver records its calls.
  const askedPairs = [];
  resolveWindow({
    sinceRefArgs: ['objectui=uitip000000', 'cloud=cloudtip0000'],
    resolveRefDate: (r, repoId) => {
      askedPairs.push(`${repoId}=${r}`);
      return repoId === 'objectui' ? '2026-08-14T05:55:02Z' : null;
    },
  });
  assert('a-pinned-ref-is-resolved-in-its-own-repo-only-never-in-self',
    askedPairs.join(',') === 'objectui=uitip000000,cloud=cloudtip0000', JSON.stringify(askedPairs));
  // A bare ref is tried in every governed checkout, and resolving ANYWHERE is
  // enough — the old shape resolved it in self alone.
  const bareAnywhere = resolveWindow({
    sinceRefArgs: ['v9.9.9'],
    repoIds: ['objectstack', 'objectui'],
    resolveRefDate: (r, repoId) => (repoId === 'objectui' ? '2026-08-13T00:00:00Z' : null),
  });
  assert('a-bare-ref-that-resolves-in-any-governed-checkout-is-enough',
    bareAnywhere.error === undefined && bareAnywhere.requestedIso === '2026-08-13T00:00:00.000Z', JSON.stringify(bareAnywhere));
  assert('the-per-repo-error-says-where-refs-are-resolved-so-the-constraint-is-declared-not-incidental',
    selfOnlyControl.error.includes('its own') || selfOnlyControl.error.includes('own checkout'), selfOnlyControl.error);
  // The enumeration itself: topological consults NO date, and a repo the ref
  // does not resolve in says why it took the date window instead.
  const topoWalk = mainlineCommitsInWindow('/w/objectstack', 'origin/main', topo, {
    repoId: 'objectstack',
    base: { ref: 'v5.0.0-rc.3', sha: 'f'.repeat(40) },
    log: (root, ref, opts) => (opts.base === 'f'.repeat(40) ? qs7Chain : []),
  });
  assert('a-topological-sweep-enumerates-the-range-and-never-a-date-cut',
    topoWalk.mode === 'topological' && topoWalk.commits.length === 4 && topoWalk.anchorAtEdge === false, JSON.stringify(topoWalk.mode));
  assert('and-it-lists-the-skewed-governed-entry-with-no-budget-involved-at-all',
    topoWalk.commits.some((c) => c.sha === qs7Governed.sha));
  const fellBack = mainlineCommitsInWindow('/w/cloud', 'origin/main', topo, { repoId: 'cloud', base: null, log: () => qs7Chain, isRoot: () => false });
  assert('a-repo-the-ref-does-not-resolve-in-falls-back-to-the-budgeted-date-window-and-NAMES-why',
    fellBack.mode === 'date' && /does not resolve in this checkout/.test(fellBack.fellBack), JSON.stringify(fellBack.fellBack));

  // ── the words an operator reads about the window ─────────────────────────
  battery('the words an operator reads about the window');
  const dateWords = describeWindow(budgeted);
  assert('the-date-window-line-states-the-budget-it-subtracted-and-both-boundaries',
    dateWords.includes('3600 s') && dateWords.includes(budgeted.requestedIso) && dateWords.includes('2026-08-14T04:55:02.000Z'), dateWords);
  assert('and-says-a-re-listed-boundary-entry-is-RE-RECOGNITION-not-noise',
    dateWords.includes('RE-RECOGNITION') && dateWords.includes('never seen again'), dateWords);
  const topoWords = describeWindow(topo);
  assert('the-topological-line-says-committer-dates-are-not-consulted-at-all',
    topoWords.includes('TOPOLOGICAL') && topoWords.includes('Committer dates are not consulted') && topoWords.includes('v5.0.0-rc.3'), topoWords);
  const edgeWords = windowEdgeReason({ budgetSeconds: SKEW_BUDGET_SECONDS });
  assert('the-window-edge-reason-names-the-budget-the-DIRECTION-and-a-runnable-remedy',
    edgeWords.includes('3600 s') && /COMPLIANCE/.test(edgeWords) && edgeWords.includes('--since-ref'), edgeWords);

  // ── classification + replay fixtures ─────────────────────────────────────
  battery('classification + replay fixtures');
  assert('ungoverned-commit-classifies-null', classifyCommit({ sha: 'a'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'fix: x (#1)' }, ['packages/spec/src/index.ts'], GOVERNED_REPOS[0]) === null);
  for (const replay of REPLAYS) {
    const entry = classifyCommit({ sha: 'b'.repeat(40), date: '2026-08-18T00:00:00Z', subject: replay.subject }, replay.files, GOVERNED_REPOS[0]);
    assert(`replay-lists: ${replay.name}`, entry !== null && entry.pr === replay.pr, JSON.stringify(entry));
  }
  const uiEntry = classifyCommit({ sha: 'f'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'docs: seat protocol (#5188)' }, ['AGENTS.md', 'skills/x/SKILL.md'], GOVERNED_REPOS[1]);
  assert('an-entry-carries-the-repo-it-came-from', uiEntry.repoSlug === 'objectstack-ai/objectui' && uiEntry.pr === 5188, JSON.stringify(uiEntry));

  // ── the exit contract, as a table (#9550 picked 3 so it cannot be read as
  //    the sweep's failure/incomplete codes) ─────────────────────────────────
  assert('exit-swept-is-0', EXIT_SWEPT === 0);
  assert('exit-cannot-sweep-is-1', EXIT_CANNOT_SWEEP === 1);
  assert('exit-incomplete-is-2', EXIT_INCOMPLETE === 2);
  assert('exit-test-governed-is-3-and-collides-with-no-sweep-code', EXIT_TEST_GOVERNED === 3 && ![EXIT_SWEPT, EXIT_CANNOT_SWEEP, EXIT_INCOMPLETE].includes(EXIT_TEST_GOVERNED));
  assert('exit-test-not-governed-is-0', EXIT_TEST_NOT_GOVERNED === 0);

  // ── multi-repo scope (#9619) ──────────────────────────────────────────────
  battery('multi-repo scope (#9619)');
  assert('six-governed-repos-declared', GOVERNED_REPOS.map((r) => r.id).join(',') === 'objectstack,objectui,cloud,objectos,hotcrm,mobile', GOVERNED_REPOS.map((r) => r.id).join(','));
  // #14867: hotcrm pinned by SLUG as well as id. The defect this closes is not
  // a wrong row — it is NO row: an unconfigured repo prints nothing at all, so
  // a later removal would restore a silence indistinguishable from a clean
  // sweep. Pinned separately from the ordered-ids assertion above so a removal
  // reds a check that NAMES hotcrm rather than one that reads as a reordering.
  assert('hotcrm-is-a-governed-repo-with-its-slug (#14867)',
    GOVERNED_REPOS.some((r) => r.id === 'hotcrm' && r.slug === 'objectstack-ai/hotcrm'),
    JSON.stringify(GOVERNED_REPOS.map((r) => `${r.id}=${r.slug}`)));
  assert('slug-from-https-remote', slugFromRemote('https://github.com/objectstack-ai/objectui') === 'objectstack-ai/objectui');
  assert('slug-from-ssh-remote-with-suffix', slugFromRemote('git@github.com:objectstack-ai/cloud.git') === 'objectstack-ai/cloud');
  assert('slug-from-nonsense-is-null', slugFromRemote('/some/local/path') === null);

  const layout = {
    '/w/objectstack': { exists: true, slug: 'objectstack-ai/objectstack' },
    '/w/objectui': { exists: true, slug: 'objectstack-ai/objectui' },
    '/w/objectos': { exists: true, slug: 'objectstack-ai/objectos' },
    // /w/cloud deliberately absent — the live case measured on the PM
    // container 2026-08-18 (no checkout, and the API 403s for it too).
  };
  const resolved = resolveRepoCheckouts({ selfRoot: '/w/objectstack', siblingDir: '/w', probe: (p) => layout[p] ?? { exists: false, slug: null } });
  const byId = Object.fromEntries(resolved.map((r) => [r.id, r]));
  assert('all-six-repos-are-resolved-not-just-the-self-repo', resolved.length === 6);
  // /w/hotcrm is absent from the layout too, so this fixture also pins the
  // property #14867 bought: a governed repo with no checkout is UNAUDITED and
  // says so, where an unconfigured repo said nothing.
  // ⚠️ Read defensively. `assert` COLLECTS failures and prints them at the
  // end, so a throw here aborts the run before the two pins that NAME hotcrm
  // are ever printed — measured on the #14867 ablation: dropping the register
  // entry turned three named red lines into one TypeError stack.
  assert('a-configured-repo-with-no-checkout-is-UNAUDITED-never-silent',
    byId.hotcrm?.status === 'unaudited' && /no git checkout at \/w\/hotcrm/.test(String(byId.hotcrm?.reason)), JSON.stringify(byId.hotcrm ?? null));
  assert('the-self-repo-is-audited-from-the-scripts-own-root-not-cwd', byId.objectstack.status === 'audited' && byId.objectstack.path === '/w/objectstack');
  assert('a-sibling-checkout-beside-it-is-audited', byId.objectui.status === 'audited' && byId.objectos.status === 'audited');
  assert('an-absent-checkout-is-UNAUDITED-never-clean', byId.cloud.status === 'unaudited' && /no git checkout at \/w\/cloud/.test(byId.cloud.reason), JSON.stringify(byId.cloud));
  const wrongOrigin = resolveRepoCheckouts({
    repos: [GOVERNED_REPOS[1]],
    selfRoot: '/w/objectstack',
    siblingDir: '/w',
    probe: () => ({ exists: true, slug: 'someone-else/objectui' }),
  })[0];
  assert('a-checkout-with-the-wrong-origin-is-UNAUDITED-not-audited-under-the-wrong-name', wrongOrigin.status === 'unaudited' && wrongOrigin.reason.includes('someone-else/objectui'), JSON.stringify(wrongOrigin));
  // ── the #13423 hole: a slug the parser cannot read must refuse, not audit ──
  // The old guard was `if (seen.slug && seen.slug !== repo.slug)` — a null
  // slug slipped it and fell through to `audited` under the governed name.
  // Both null-slug shapes are pinned (an unparseable URL, and no origin remote
  // at all), plus the property the fix makes structural: `audited` is
  // reachable only through a parsed, MATCHING slug.
  const unparseable = resolveRepoCheckouts({
    repos: [GOVERNED_REPOS[2]],
    selfRoot: '/w/objectstack',
    siblingDir: '/w',
    probe: () => ({ exists: true, slug: null, origin: '/srv/mirrors/cloud' }),
  })[0];
  assert('an-origin-no-slug-parses-from-is-UNAUDITED-never-audited-under-the-governed-name',
    unparseable.status === 'unaudited' && unparseable.reason.includes('NOT MEASURED') && unparseable.reason.includes('/srv/mirrors/cloud') && unparseable.reason.includes('objectstack-ai/cloud'),
    JSON.stringify(unparseable));
  assert('and-that-refusal-says-a-reachable-remote-is-not-identity', unparseable.reason.includes('not evidence of WHICH repo'), unparseable.reason);
  const noRemote = resolveRepoCheckouts({
    repos: [GOVERNED_REPOS[2]],
    selfRoot: '/w/objectstack',
    siblingDir: '/w',
    probe: () => ({ exists: true, slug: null, origin: null }),
  })[0];
  assert('a-checkout-with-no-origin-remote-refuses-too-and-names-that-shape',
    noRemote.status === 'unaudited' && noRemote.reason.includes('no origin remote'), JSON.stringify(noRemote));
  assert('a-probe-that-answers-nothing-at-all-still-refuses',
    resolveRepoCheckouts({ repos: [GOVERNED_REPOS[2]], selfRoot: '/w', siblingDir: '/w', probe: () => null })[0].status === 'unaudited');
  assert('the-only-fall-through-to-audited-is-a-parsed-MATCHING-slug',
    resolveRepoCheckouts({ repos: [GOVERNED_REPOS[2]], selfRoot: '/w', siblingDir: '/w', probe: () => ({ exists: true, slug: 'objectstack-ai/cloud', origin: 'https://github.com/objectstack-ai/cloud.git' }) })[0].status === 'audited');
  const overridden = resolveRepoCheckouts({ repos: [GOVERNED_REPOS[2]], selfRoot: '/w/objectstack', siblingDir: '/w', overrides: { cloud: '/srv/cloud' }, probe: (p) => (p === '/srv/cloud' ? { exists: true, slug: 'objectstack-ai/cloud' } : { exists: false, slug: null }) })[0];
  assert('--repo-root-relocates-a-checkout', overridden.status === 'audited' && overridden.path === '/srv/cloud');

  // ── remote reachability + mirror freshness (#13307) ───────────────────────
  //
  // The leg that answers "is this checkout a live mirror at all". Every branch
  // is pinned because the defect it replaces was a row every clause of which
  // was literally TRUE about the local snapshot.
  battery('remote reachability + mirror freshness (#13307)');
  assert('a-remote-tracking-ref-splits-into-remote-and-branch', JSON.stringify(remoteRefParts('origin/main')) === '{"remote":"origin","branch":"main"}', JSON.stringify(remoteRefParts('origin/main')));
  assert('a-ref-that-names-no-remote-does-not-parse', remoteRefParts('main') === null && remoteRefParts('') === null && remoteRefParts(null) === null);

  const liveTip = 'a'.repeat(40);
  const otherTip = 'b'.repeat(40);
  const reached = { reachable: true, sha: liveTip, error: null, ref: 'origin/main', remoteName: 'origin' };
  const fresh = remoteFreshnessVerdict({ ref: 'origin/main', path: '/w/objectos', localSha: liveTip, remote: reached });
  assert('a-live-mirror-whose-tip-matches-the-remote-is-the-ONLY-verdict-that-audits', fresh === null, JSON.stringify(fresh));

  // The card's live case: the repo left the fleet's GitHub scope, and the
  // clone that outlives it still resolves origin/main and still has a tip.
  const gone = remoteFreshnessVerdict({
    ref: 'origin/main',
    path: '/w/cloud',
    localSha: liveTip,
    remote: { reachable: false, sha: null, error: "fatal: repository 'https://github.com/objectstack-ai/cloud/' not found", ref: 'origin/main', remoteName: 'origin' },
  });
  assert('an-unreachable-remote-is-NOT-MEASURED-never-a-zero',
    gone !== null && gone.reason.includes('NOT MEASURED') && gone.reason.includes('not found') && gone.reason.includes('A local tip is NOT evidence'), JSON.stringify(gone));

  // ⭐ The degenerate guard, and the reason the shape checks precede the
  // equality test: `local === remote` is the success condition, and two
  // FAILED readings are also equal. A guard whose success condition equals its
  // total-failure condition must refuse — so both empty and both null refuse,
  // in the same words a single failed reading would earn.
  const bothEmpty = remoteFreshnessVerdict({ ref: 'origin/main', path: '/w/x', localSha: '', remote: { reachable: true, sha: '', error: null, ref: 'origin/main', remoteName: 'origin' } });
  const bothNull = remoteFreshnessVerdict({ ref: 'origin/main', path: '/w/x', localSha: null, remote: { reachable: true, sha: null, error: null, ref: 'origin/main', remoteName: 'origin' } });
  assert('two-unreadable-shas-are-a-FAILED-reading-never-a-match', bothEmpty !== null && bothNull !== null && bothEmpty.reason.includes('NOT MEASURED') && bothNull.reason.includes('NOT MEASURED'), JSON.stringify([bothEmpty, bothNull]));
  // ⚠️ `?? ''` rather than a bare dereference, here and in the render fixture
  // below: these read `.reason` off a verdict whose whole job is to be
  // non-null, so a regression that returns null makes the ASSERTION throw and
  // the run dies at the first casualty — every later pin then reports neither
  // green nor red, which is the #10814 collector lesson wearing a different
  // hat. Measured: ablating the verdict to `return null` crashed this file at
  // this line instead of listing what broke.
  assert('a-remote-that-answers-with-no-commit-says-so-rather-than-matching', (bothEmpty?.reason ?? '').includes('named no commit'), JSON.stringify(bothEmpty));
  const noLocal = remoteFreshnessVerdict({ ref: 'origin/main', path: '/w/x', localSha: 'not-a-sha', remote: reached });
  assert('an-unreadable-LOCAL-tip-refuses-too-not-only-the-remote-one', noLocal !== null && noLocal.reason.includes('did not resolve to a commit id'), JSON.stringify(noLocal));
  assert('a-short-or-abbreviated-sha-is-not-an-object-id', remoteFreshnessVerdict({ ref: 'origin/main', path: '/w/x', localSha: liveTip.slice(0, 9), remote: reached }) !== null);

  // Staleness, bounded by IDENTITY rather than by dates — the sharper form of
  // the card's requirement 3, and the one local git can actually answer.
  const behind = remoteFreshnessVerdict({ ref: 'origin/main', path: '/w/objectos', localSha: liveTip, remote: { ...reached, sha: otherTip } });
  assert('a-mirror-BEHIND-its-remote-is-NOT-MEASURED-and-names-both-tips',
    behind !== null && behind.reason.includes('BEHIND') && behind.reason.includes(liveTip.slice(0, 9)) && behind.reason.includes(otherTip.slice(0, 9)) && behind.reason.includes('git -C /w/objectos fetch origin main'), JSON.stringify(behind));
  const badRef = remoteFreshnessVerdict({ ref: 'main', path: '/w/x', localSha: liveTip, remote: reached });
  assert('a-ref-whose-remote-cannot-be-named-refuses-rather-than-skipping', badRef !== null && badRef.reason.includes('NOT MEASURED'), JSON.stringify(badRef));
  // #13836: every freshness refusal carries a machine-readable precondition,
  // so a dropped repo is attributable from the footer, not from footer diffs.
  assert('every-freshness-refusal-names-its-precondition-category',
    gone?.precondition === 'unreachable-remote' && behind?.precondition === 'stale-mirror' && bothEmpty?.precondition === 'remote-tip-unreadable' &&
      noLocal?.precondition === 'local-tip-unreadable' && badRef?.precondition === 'unprobeable-ref',
    JSON.stringify([gone?.precondition, behind?.precondition, bothEmpty?.precondition, noLocal?.precondition, badRef?.precondition]));
  assert('the-verified-row-says-what-was-reached-and-what-matched', describeRemote(reached) === `origin/main reached at origin, tip ${liveTip.slice(0, 9)} matches this mirror`, describeRemote(reached));

  // ── the REAL prober, on real git fixtures (#13307) ────────────────────────
  //
  // The verdicts above are pure and take the probe result as data, so all of
  // them would stay green while `probeRemoteTip` answered `reachable: true`
  // for a remote that is gone — the pure half cannot pin the half that
  // actually reads the world. These fixtures are local bare repos over the
  // FILE transport: real `git ls-remote`, no network, ~1 s, so `--self-test`
  // stays offline exactly as its usage line claims.
  battery('the REAL prober, on real git fixtures (#13307)');
  const fxRoot = mkdtempSync(join(tmpdir(), 'governed-merges-remote-'));
  try {
    const g = (cwd, ...rest) =>
      execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...rest], {
        cwd,
        encoding: 'utf8',
        env: gitFreeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const seed = join(fxRoot, 'seed');
    g(fxRoot, 'init', '-q', seed);
    // Three commits, the first two BACKDATED, so a --depth 2 clone is a real
    // shallow clone whose floor still predates the default 24 h window (the
    // covered case), while --depth 1 puts the floor INSIDE it (#13836's
    // shallow-clone path, both directions).
    const backdated = (msg, when) =>
      execFileSync(
        'git',
        ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', msg],
        { cwd: seed, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...gitFreeEnv(), GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when } },
      );
    backdated('chore: forty days ago', new Date(Date.now() - 40 * 86_400_000).toISOString());
    backdated('chore: thirty-five days ago', new Date(Date.now() - 35 * 86_400_000).toISOString());
    execFileSync('sh', ['-c', `printf 'x\\n' > "${join(seed, 'README.md')}"`]);
    g(seed, 'add', '-A');
    g(seed, 'commit', '-qm', 'chore: seed');
    const bareLive = join(fxRoot, 'live.git');
    const bareGone = join(fxRoot, 'gone.git');
    g(fxRoot, 'clone', '-q', '--bare', seed, bareLive);
    g(fxRoot, 'clone', '-q', '--bare', seed, bareGone);
    const coLive = join(fxRoot, 'co-live');
    const coGone = join(fxRoot, 'co-gone');
    g(fxRoot, 'clone', '-q', bareLive, coLive);
    g(fxRoot, 'clone', '-q', bareGone, coGone);
    // Each checkout DECLARES the governed origin and routes its transport to
    // the local bare via `url.<base>.insteadOf` — the split the #13423 fix
    // reads deliberately: identity is the raw configured URL, transport is
    // git's own resolution (ls-remote applies the rewrite; measured, so these
    // fixtures stay offline while carrying a parseable governed identity).
    const declareOrigin = (co, bare, slug = 'objectstack-ai/cloud') => {
      g(co, 'remote', 'set-url', 'origin', `https://github.com/${slug}`);
      g(co, 'config', `url.${bare}.insteadOf`, `https://github.com/${slug}`);
    };
    declareOrigin(coLive, bareLive);
    declareOrigin(coGone, bareGone);
    rmSync(bareGone, { recursive: true, force: true }); // the repo leaves the fleet's scope

    const liveProbe = probeRemoteTip(coLive, 'origin/main');
    const localTip = g(coLive, 'rev-parse', 'origin/main').trim();
    assert('the-real-prober-reaches-a-live-remote-and-names-its-tip',
      liveProbe.reachable === true && /^[0-9a-f]{40}$/.test(String(liveProbe.sha)) && liveProbe.sha === localTip, JSON.stringify(liveProbe));
    assert('a-live-matching-mirror-audits-end-to-end',
      remoteFreshnessVerdict({ ref: 'origin/main', path: coLive, localSha: localTip, remote: liveProbe }) === null);

    const goneProbe = probeRemoteTip(coGone, 'origin/main');
    assert('the-real-prober-REFUSES-a-remote-that-no-longer-exists',
      goneProbe.reachable === false && goneProbe.sha === null && typeof goneProbe.error === 'string' && goneProbe.error !== '', JSON.stringify(goneProbe));
    assert('and-the-diagnosis-quoted-is-the-fault-line-not-gits-closing-boilerplate',
      !/the repository exists\.?$/.test(goneProbe.error), goneProbe.error);
    const goneVerdict = remoteFreshnessVerdict({ ref: 'origin/main', path: coGone, localSha: g(coGone, 'rev-parse', 'origin/main').trim(), remote: goneProbe });
    assert('a-dead-mirror-with-a-perfectly-good-local-tip-is-still-NOT-MEASURED',
      goneVerdict !== null && goneVerdict.reason.includes('NOT MEASURED'), JSON.stringify(goneVerdict));

    // ⭐ The `--exit-code` claim itself. WITHOUT that flag a reachable remote
    // carrying no such branch exits 0 with empty output, and this would come
    // back `{ reachable: true, sha: null }` — "reachable, tip unknown" wearing
    // the clothes of success. Pin it against the same live remote, so the only
    // difference from the passing case is the branch name.
    const noSuchBranch = probeRemoteTip(coLive, 'origin/no-such-branch-here');
    assert('a-reachable-remote-that-lacks-the-branch-is-a-FAILED-reading-not-a-null-tip',
      noSuchBranch.reachable === false, JSON.stringify(noSuchBranch));

    // ⭐ The CALL SITE, end to end — and this one is not belt-and-braces.
    // Every assertion above is on a pure verdict or on the prober; not one of
    // them fails if `main()` simply stops CONSULTING them. Measured on this
    // branch by deleting the four-line call site in the sweep loop: all of the
    // pins above stayed GREEN while the live sweep went straight back to
    // `✓ audited … ✅ clean window` over a dead remote, exit 0. An instrument
    // that structurally cannot fail in the direction it exists to detect is
    // this card's own subject, so the wiring is pinned by RUNNING the sweep
    // rather than by trusting it — both directions, against the same fixtures.
    const sweepEnv = { ...process.env, [PROXY_REARM_GUARD]: '1' };
    const deadSweep = spawnSync(process.execPath, [scriptPath, '--repos', 'cloud', '--repo-root', `cloud=${coGone}`], { encoding: 'utf8', env: sweepEnv });
    const deadOut = `${deadSweep.stdout ?? ''}${deadSweep.stderr ?? ''}`;
    // ⚠️ The audited-row test is LINE-ANCHORED, and finding that out cost a
    // red run worth keeping: the refusal's own reason QUOTES the string
    // `✓ audited … 0 mainline commit(s) in window` while explaining what it is
    // refusing to print, so a bare substring test reads the explanation as the
    // symptom. Same trap as the `✅` / "NOT a clean window" pin above — assert
    // on the ROW, not on the phrase.
    const auditedRow = /^\s*✓ audited/m;
    assert('the-SWEEP-itself-refuses-a-dead-mirror-not-merely-its-helpers',
      deadSweep.status !== 0 && deadOut.includes('NOT MEASURED') && !auditedRow.test(deadOut) && !deadOut.includes('✅'),
      `status=${deadSweep.status} out=${deadOut.slice(0, 500)}`);
    assert('and-the-dead-mirror-refusal-names-its-precondition',
      /objectstack-ai\/cloud \[unreachable-remote\]/.test(deadOut), deadOut.slice(-600));
    const liveSweep = spawnSync(process.execPath, [scriptPath, '--repos', 'cloud', '--repo-root', `cloud=${coLive}`], { encoding: 'utf8', env: sweepEnv });
    const liveOut = `${liveSweep.stdout ?? ''}${liveSweep.stderr ?? ''}`;
    assert('and-the-same-sweep-over-a-LIVE-mirror-still-audits-and-still-says-a-true-zero',
      liveSweep.status === 0 && auditedRow.test(liveOut) && liveOut.includes('✅'),
      `status=${liveSweep.status} out=${liveOut.slice(0, 500)}`);
    assert('every-real-sweep-prints-which-sweep-code-ran', liveOut.includes('sweep code:'), liveOut.slice(0, 400));

    // ── #13423, end to end: a raw clone-from-a-path keeps its local-path
    // origin — exactly the spelling the card names — and the SWEEP must
    // refuse it. Wired like the dead-mirror pin above and for the same
    // reason: the pure refusal alone stays green if `probeCheckout` stops
    // reading the raw declared URL, or if `resolveRepoCheckouts` stops being
    // consulted. This run never touches the network — the identity refusal
    // comes before the reachability probe.
    const coLocal = join(fxRoot, 'co-local');
    g(fxRoot, 'clone', '-q', bareLive, coLocal);
    const localSweep = spawnSync(process.execPath, [scriptPath, '--repos', 'cloud', '--repo-root', `cloud=${coLocal}`], { encoding: 'utf8', env: sweepEnv });
    const localOut = `${localSweep.stdout ?? ''}${localSweep.stderr ?? ''}`;
    assert('the-SWEEP-refuses-a-checkout-whose-origin-parses-to-no-slug',
      localSweep.status !== 0 && localOut.includes('does not parse') && localOut.includes('NOT MEASURED') && !auditedRow.test(localOut) && !localOut.includes('✅'),
      `status=${localSweep.status} out=${localOut.slice(0, 500)}`);

    // ── #13836, the shallow-clone path, both directions ──────────────────────
    // A shallow clone DEEP ENOUGH for the window audits exactly as a complete
    // one (its row names the floor it was swept against); one whose floor sits
    // inside the window refuses with the precondition NAMED in the footer, so
    // a dropped repo needs no cross-run footer diffing to attribute.
  battery('#13836, the shallow-clone path, both directions');
    const coShallowCovered = join(fxRoot, 'co-shallow-covered');
    const coShallowInside = join(fxRoot, 'co-shallow-inside');
    g(fxRoot, 'clone', '-q', '--depth', '2', `file://${bareLive}`, coShallowCovered);
    g(fxRoot, 'clone', '-q', '--depth', '1', `file://${bareLive}`, coShallowInside);
    declareOrigin(coShallowCovered, bareLive);
    declareOrigin(coShallowInside, bareLive);
    const coveredSweep = spawnSync(process.execPath, [scriptPath, '--repos', 'cloud', '--repo-root', `cloud=${coShallowCovered}`], { encoding: 'utf8', env: sweepEnv });
    const coveredOut = `${coveredSweep.stdout ?? ''}${coveredSweep.stderr ?? ''}`;
    assert('a-shallow-clone-deep-enough-for-the-window-still-audits-and-names-its-floor',
      coveredSweep.status === 0 && auditedRow.test(coveredOut) && coveredOut.includes('history shallow, oldest visible'),
      `status=${coveredSweep.status} out=${coveredOut.slice(0, 500)}`);
    const insideSweep = spawnSync(process.execPath, [scriptPath, '--repos', 'cloud', '--repo-root', `cloud=${coShallowInside}`], { encoding: 'utf8', env: sweepEnv });
    const insideOut = `${insideSweep.stdout ?? ''}${insideSweep.stderr ?? ''}`;
    assert('a-shallow-clone-whose-floor-sits-inside-the-window-refuses-with-the-precondition-NAMED',
      insideSweep.status !== 0 && /objectstack-ai\/cloud \[history-horizon\]/.test(insideOut) && !auditedRow.test(insideOut) && !insideOut.includes('✅'),
      `status=${insideSweep.status} out=${insideOut.slice(0, 500)}`);

    // ── #13424, end to end: a sweep pinning ONLY a sibling repo's tip — no
    // pin for the self repo — must produce a report, not exit 1. This exact
    // invocation shape used to answer `does not resolve to a commit` because
    // the window's date derivation asked the self checkout about the pin.
    const siblingPinSweep = spawnSync(
      process.execPath,
      [scriptPath, '--repos', 'cloud', '--repo-root', `cloud=${coLive}`, '--since-ref', `cloud=${localTip}`],
      { encoding: 'utf8', env: sweepEnv },
    );
    const siblingPinOut = `${siblingPinSweep.stdout ?? ''}${siblingPinSweep.stderr ?? ''}`;
    assert('a-sweep-pinning-only-a-sibling-tip-produces-a-report-instead-of-exit-1',
      siblingPinSweep.status === 0 && auditedRow.test(siblingPinOut) && siblingPinOut.includes('window topological') && !siblingPinOut.includes('does not resolve'),
      `status=${siblingPinSweep.status} out=${siblingPinOut.slice(0, 500)}`);

    // Freshness by IDENTITY: advance the remote, leave the mirror untouched.
    const pusher = join(fxRoot, 'pusher');
    g(fxRoot, 'clone', '-q', bareLive, pusher);
    execFileSync('sh', ['-c', `printf 'y\\n' >> "${join(pusher, 'README.md')}"`]);
    g(pusher, 'add', '-A');
    g(pusher, 'commit', '-qm', 'chore: landed after the mirror was taken');
    g(pusher, 'push', '-q', 'origin', 'main');
    const behindProbe = probeRemoteTip(coLive, 'origin/main');
    const behindVerdict = remoteFreshnessVerdict({ ref: 'origin/main', path: coLive, localSha: localTip, remote: behindProbe });
    assert('a-mirror-the-remote-has-moved-past-is-NOT-MEASURED-on-a-real-repo',
      behindProbe.reachable === true && behindProbe.sha !== localTip && behindVerdict !== null && behindVerdict.reason.includes('BEHIND'), JSON.stringify({ behindProbe, behindVerdict }));

    // ── #13836, the flip REPRODUCED: the identical invocation that audited
    // above (exit 0, ✓ audited, a true zero) now refuses — the only delta is
    // ONE upstream push, nothing local touched the mirror. This is the
    // measured run-1-vs-run-2 shape: the freshness leg failing closed on a
    // busy remote, in the safe direction (#4690) — and the run must be
    // attributable from its own output: the row and the INCOMPLETE footer
    // both name the stale-mirror precondition, so two footers minutes apart
    // differ by a stated reason, never only by a slug list.
    const flipSweep = spawnSync(process.execPath, [scriptPath, '--repos', 'cloud', '--repo-root', `cloud=${coLive}`], { encoding: 'utf8', env: sweepEnv });
    const flipOut = `${flipSweep.stdout ?? ''}${flipSweep.stderr ?? ''}`;
    assert('the-run-1-vs-run-2-flip-reproduces-with-zero-local-writes-and-refuses-loudly',
      flipSweep.status !== 0 && flipOut.includes('BEHIND') && /objectstack-ai\/cloud \[stale-mirror\]/.test(flipOut) && !auditedRow.test(flipOut) && !flipOut.includes('✅'),
      `status=${flipSweep.status} out=${flipOut.slice(0, 500)}`);

    // And the INCOMPLETE footer form of the same attribution: one repo still
    // audits while the flipped one refuses, so the sweep exits 2 and the
    // footer names slug AND precondition — the reading the measured incident
    // could only reconstruct by diffing two footers across runs.
    const coFresh = join(fxRoot, 'co-fresh-objectos');
    g(fxRoot, 'clone', '-q', bareLive, coFresh);
    declareOrigin(coFresh, bareLive, 'objectstack-ai/objectos');
    const mixedSweep = spawnSync(
      process.execPath,
      [scriptPath, '--repos', 'cloud,objectos', '--repo-root', `cloud=${coLive}`, '--repo-root', `objectos=${coFresh}`],
      { encoding: 'utf8', env: sweepEnv },
    );
    const mixedOut = `${mixedSweep.stdout ?? ''}${mixedSweep.stderr ?? ''}`;
    assert('a-mixed-sweep-attributes-the-dropped-repo-in-the-INCOMPLETE-footer-itself',
      mixedSweep.status === 2 && /✓ audited\s+objectstack-ai\/objectos/m.test(mixedOut) &&
        /UNAUDITED\s+objectstack-ai\/cloud — \[stale-mirror\]/.test(mixedOut) &&
        /unaudited \([^)]*objectstack-ai\/cloud: stale-mirror[^)]*\)/.test(mixedOut),
      `status=${mixedSweep.status} out=${mixedOut.slice(0, 700)}`);
  } catch (error) {
    // ⛔ Never a silent skip: an environment that cannot run these is an
    // environment where this leg is unpinned, and that must read as red.
    assert('the-live-remote-prober-fixtures-could-be-built-and-run', false, String(error?.message ?? error).split('\n')[0]);
  } finally {
    rmSync(fxRoot, { recursive: true, force: true });
  }

  // ── sweep-code provenance (#13307 reopen) ─────────────────────────────────
  //
  // The reopen's false green was a pre-fix copy of this script running from a
  // stale tree, read as the landed version's behaviour. Every branch of the
  // line that now makes such a run attributable is pinned, and the structural
  // reads are asserted against THIS repo — direction-agnostically, because a
  // dev iterating on this very file legitimately runs it with uncommitted
  // edits, and that state must render as the loud mismatch, not as a red pin.
  battery('sweep-code provenance (#13307 reopen)');
  const blobA = 'a'.repeat(40);
  const blobB = 'b'.repeat(40);
  const matchLine = describeSweepCode({ head: 'abc1234', blob: blobA, headBlob: blobA, error: null });
  assert('a-matching-sweep-code-line-names-the-head-and-the-blob',
    matchLine.includes('sweep code: HEAD abc1234') && matchLine.includes('byte-matches') && matchLine.includes(blobA.slice(0, 10)), matchLine);
  const staleLine = describeSweepCode({ head: 'abc1234', blob: blobA, headBlob: blobB, error: null });
  assert('a-stale-or-modified-copy-is-a-LOUD-mismatch-naming-both-blobs',
    staleLine.includes('⚠️') && staleLine.includes('not') && staleLine.includes(blobA.slice(0, 10)) && staleLine.includes(blobB.slice(0, 10)) &&
      staleLine.includes('Do not read this sweep as any landed version'), staleLine);
  const unknownLine = describeSweepCode({ head: null, blob: null, headBlob: null, error: 'not a git repository' });
  assert('an-unattributable-run-says-UNKNOWN-with-the-reason-never-crashes-or-omits',
    unknownLine.includes('UNKNOWN') && unknownLine.includes('not a git repository') && unknownLine.includes('unattributed'), unknownLine);
  assert('a-null-reading-is-the-UNKNOWN-branch-too', describeSweepCode(null).includes('UNKNOWN'));
  const withCode = renderReport({
    window: dateWindowFor('2026-08-17T00:00:00Z'),
    repos: resolved.map((r) => ({ ...r, status: 'audited', reason: null, tip: { sha: 'c'.repeat(40), date: '2026-08-18T00:00:00Z' }, scanned: 3 })),
    scanned: 12, entries: [], lookups: 0,
    sweepCode: { head: 'abc1234', blob: blobA, headBlob: blobA, error: null },
  });
  assert('the-report-head-carries-the-sweep-code-line-when-a-reading-is-supplied', withCode.includes('sweep code: HEAD abc1234'), withCode);

  // ── the report words an operator reads ────────────────────────────────────
  battery('the report words an operator reads');
  const allAudited = resolved.map((r) => ({ ...r, status: 'audited', reason: null, tip: { sha: 'c'.repeat(40), date: '2026-08-18T00:00:00Z' }, scanned: 3 }));
  const clean = renderReport({ window: dateWindowFor('2026-08-17T00:00:00Z'), repos: allAudited, scanned: 12, entries: [], lookups: 0 });
  assert('clean-window-says-clean-and-costs-zero-lookups', clean.includes('clean window') && clean.includes('0 API lookup(s)'), clean);
  assert('a-clean-sweep-names-every-repo-it-audited', GOVERNED_REPOS.every((r) => clean.includes(r.slug)), clean);
  const withAbsent = renderReport({ window: dateWindowFor('2026-08-17T00:00:00Z'), repos: resolved.map((r) => ({ ...r, tip: r.status === 'audited' ? { sha: 'c'.repeat(40), date: '2026-08-18T00:00:00Z' } : undefined, scanned: 3 })), scanned: 9, entries: [], lookups: 0 });
  // The ✅ marker, not the words: "NOT a clean window" contains "clean window",
  // so a substring test on the phrase alone would pass while the green tick
  // still printed. Assert on the tick and on the refusal sentence together.
  assert('an-unaudited-repo-never-renders-as-a-clean-window', !withAbsent.includes('✅') && withAbsent.includes('UNAUDITED') && withAbsent.includes('NOT a clean window'), withAbsent);
  assert('and-the-clean-case-does-print-the-tick', clean.includes('✅'), clean);
  assert('the-unaudited-line-names-the-repo-and-the-reason', withAbsent.includes('objectstack-ai/cloud') && withAbsent.includes('no git checkout'), withAbsent);
  assert('and-it-carries-the-machine-readable-precondition-tag', withAbsent.includes('[no-checkout]'), withAbsent);

  // ── an unreachable remote never renders as a clean window (#13307) ────────
  //
  // Same register, same words, same suppressed tick as an absent checkout —
  // that sameness IS the fix: no second mechanism was introduced, so this row
  // cannot drift away from the #4690 rule the others obey. Assert on the TICK
  // (the phrase "NOT a clean window" contains "clean window").
  battery('an unreachable remote never renders as a clean window (#13307)');
  const deadMirror = renderReport({
    window: dateWindowFor('2026-08-17T00:00:00Z'),
    repos: [
      ...allAudited.slice(0, 3),
      { ...byId.cloud, path: '/w/cloud', status: 'unaudited', reason: remoteFreshnessVerdict({ ref: 'origin/main', path: '/w/cloud', localSha: 'a'.repeat(40), remote: { reachable: false, sha: null, error: 'fatal: repository not found', ref: 'origin/main', remoteName: 'origin' } })?.reason ?? '(the verdict returned no refusal — see the reachability pins above)' },
    ],
    scanned: 9,
    entries: [],
    lookups: 0,
  });
  assert('a-repo-whose-remote-is-unreachable-never-renders-the-green-tick',
    !deadMirror.includes('✅') && deadMirror.includes('UNAUDITED') && deadMirror.includes('NOT MEASURED') && deadMirror.includes('NOT a clean window'), deadMirror);

  // ⭐ Non-vacuity, in the report words: a fix that turned every zero into NOT
  // MEASURED would be as useless as the false zero it replaced. A repo whose
  // remote WAS reached and matches still says a zero — and now says it is a
  // measured one — while a row carrying no remote reading must ⛔ not claim it.
  const measuredZero = renderReport({
    window: dateWindowFor('2026-08-17T00:00:00Z'),
    repos: allAudited.map((r) => ({ ...r, scanned: 4, quiet: true, remote: { ...reached, sha: 'c'.repeat(40) } })),
    scanned: 16,
    entries: [],
    lookups: 0,
  });
  assert('a-reachable-repo-with-no-governed-merge-still-says-a-TRUE-ZERO',
    measuredZero.includes('✅') && measuredZero.includes('clean window') && measuredZero.includes('a MEASURED zero'), measuredZero);
  assert('the-audited-row-names-the-remote-tip-it-verified', measuredZero.includes('remote origin/main reached at origin'), measuredZero);
  const unmeasuredZero = renderReport({ window: dateWindowFor('2026-08-17T00:00:00Z'), repos: allAudited.map((r) => ({ ...r, scanned: 0, quiet: true })), scanned: 0, entries: [], lookups: 0 });
  assert('a-row-with-no-remote-reading-does-NOT-claim-one', !unmeasuredZero.includes('a MEASURED zero') && unmeasuredZero.includes('no remote reading is recorded'), unmeasuredZero);

  // ── an unproven window boundary never renders as a clean window (#12633) ──
  //
  // The same shape as the UNAUDITED case and for the same reason: a repo whose
  // boundary could not be proven is not a repo with nothing to report. Assert
  // on the TICK, not on the phrase — "NOT a clean window" contains the phrase.
  const withEdge = renderReport({
    window: dateWindowFor('2026-08-17T00:00:00Z'),
    repos: [{ ...allAudited[0], windowMode: 'date', straddlers: 0, windowIncomplete: windowEdgeReason({ budgetSeconds: SKEW_BUDGET_SECONDS }) }, ...allAudited.slice(1)],
    scanned: 12,
    entries: [],
    lookups: 0,
  });
  assert('a-repo-at-the-window-edge-never-renders-the-green-tick',
    !withEdge.includes('✅') && withEdge.includes('WINDOW EDGE') && withEdge.includes('NOT a clean window'), withEdge);
  assert('and-the-edge-line-names-the-repo-and-what-could-not-be-proven',
    withEdge.includes('objectstack-ai/objectstack') && withEdge.includes('deepest commit inside the window'), withEdge);
  assert('every-sweep-prints-the---since-ref-line-to-record-for-the-next-round',
    clean.includes('next round, exactly:') && clean.includes('--since-ref objectstack=cccccccccccc'), clean);
  const relisting = renderReport({
    window: dateWindowFor('2026-08-17T00:00:00Z'),
    repos: [{ ...allAudited[0], windowMode: 'date', straddlers: 2 }, ...allAudited.slice(1)],
    scanned: 12,
    entries: [],
    lookups: 0,
  });
  assert('a-repo-line-says-which-window-it-ran-and-how-many-boundary-re-listings-it-cost',
    relisting.includes('window date') && relisting.includes('2 boundary re-listing(s)'), relisting);
  const topoReport = renderReport({
    window: resolveWindow({ sinceRefArgs: ['v5.0.0-rc.3'], resolveRefDate: () => '2026-08-17T00:00:00Z' }),
    repos: [{ ...allAudited[0], windowMode: 'topological', windowBase: { ref: 'v5.0.0-rc.3', sha: 'e'.repeat(40) }, straddlers: 0 }, ...allAudited.slice(1)],
    scanned: 12,
    entries: [],
    lookups: 0,
  });
  assert('a-topological-repo-line-names-the-base-it-windowed-from',
    topoReport.includes('window topological from eeeeeeeee'), topoReport);

  // ── a truncated history is UNAUDITED, not a clean sweep (#9902) ───────────
  //
  // The measured shape: a window crossing this container's graft floor swept
  // ONE mainline commit, found no governed surface on it, and rendered
  // `✅ clean window` over ~40 governed merges that GitHub lists for the same
  // window. The tick is what a maintainer reads, so the assertions below are
  // on the tick and on the direction the reason names, not on the phrase.
  battery('a truncated history is UNAUDITED, not a clean sweep (#9902)');
  const truncated = truncatedHorizonReason({
    ref: 'origin/main',
    horizon: {
      reason: "this clone is shallow and its oldest visible commit on 'origin/main' is 2026-06-02, which sits INSIDE the window",
      remedy: 'git -C /w/objectstack fetch --unshallow origin',
    },
  });
  assert('a-truncated-horizon-reason-names-the-ref-and-the-floor', truncated.includes('origin/main') && truncated.includes('2026-06-02'), truncated);
  assert('and-it-names-the-DIRECTION-under-enumeration-reads-as-compliance', /COMPLIANCE/.test(truncated), truncated);
  assert('and-it-carries-a-runnable-remedy', truncated.includes('fetch --unshallow'), truncated);
  const withTruncated = renderReport({
    window: dateWindowFor('2026-05-23T00:00:00Z'),
    repos: [{ ...allAudited[0], status: 'unaudited', reason: truncated, scanned: 1 }, ...allAudited.slice(1)],
    scanned: 1,
    entries: [],
    lookups: 0,
  });
  assert('a-repo-whose-history-stops-inside-the-window-never-renders-the-green-tick',
    !withTruncated.includes('✅') && withTruncated.includes('UNAUDITED') && withTruncated.includes('NOT a clean window'), withTruncated);
  assert('and-the-sweep-says-which-repo-could-not-see-the-window', withTruncated.includes('objectstack-ai/objectstack') && withTruncated.includes('INSIDE the window'), withTruncated);

  // The other leg, and the one a bare `--is-shallow-repository` guard would
  // have broken: a shallow checkout deep enough for the window sweeps as
  // normal, and its answer carries the floor it was computed against.
  assert('a-shallow-clone-whose-floor-predates-the-window-describes-itself-as-such',
    describeHorizon({ shallow: true, floor: '2026-06-02' }) === 'shallow, oldest visible 2026-06-02 (predates the window)');
  assert('a-complete-clone-says-so-instead', describeHorizon({ shallow: false, floor: null }) === 'complete clone');
  const sweptShallow = renderReport({
    window: dateWindowFor('2026-08-20T00:00:00Z'),
    repos: allAudited.map((r) => ({ ...r, horizon: describeHorizon({ shallow: true, floor: '2026-06-02' }) })),
    scanned: 12,
    entries: [],
    lookups: 0,
  });
  assert('an-audited-repo-prints-the-horizon-it-was-swept-against',
    sweptShallow.includes('history shallow, oldest visible 2026-06-02'), sweptShallow);
  assert('and-a-covered-shallow-sweep-is-still-allowed-to-be-clean', sweptShallow.includes('✅'), sweptShallow);
  const noPr = classifyCommit({ sha: 'd'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'chore: direct push' }, ['AGENTS.md'], GOVERNED_REPOS[0]);
  const loud = renderReport({ window: dateWindowFor('2026-08-17T00:00:00Z'), repos: allAudited, scanned: 3, entries: [noPr], lookups: 0 });
  assert('a-pr-less-mainline-commit-is-its-own-loud-entry', loud.includes('NO PR NUMBER IN SUBJECT'), loud);
  assert('the-violation-contract-is-stated-on-every-sweep', clean.includes('violation signal') && loud.includes('violation signal'));

  // ── attribution: the channel chain and its named fallback (#9619) ─────────
  battery('attribution: the channel chain and its named fallback (#9619)');
  const anonOnly = attributionChannels({});
  assert('with-no-token-anonymous-REST-is-still-tried', anonOnly.length === 1 && anonOnly[0].id === 'anonymous', JSON.stringify(anonOnly.map((c) => c.id)));
  const both = attributionChannels({ GITHUB_TOKEN: 'x' });
  assert('with-a-token-the-token-goes-first-and-anonymous-remains-the-fallback', both.map((c) => c.id).join(',') === 'env-token,anonymous', both.map((c) => c.id).join(','));
  assert('GH_TOKEN-is-honoured-too', attributionChannels({ GH_TOKEN: 'x' }).map((c) => c.id).join(',') === 'env-token,anonymous');
  assert('the-token-channel-sends-an-authorization-header-and-anonymous-sends-none', both[0]?.headers?.authorization === 'Bearer x' && Object.keys(both[1]?.headers ?? { unset: 1 }).length === 0, JSON.stringify(both.map((c) => c.id)));

  // The transport branch (#9642's trap, measured again here): every channel
  // reads 401/403 when a proxied run's fetch bypasses the proxy, so the plan
  // is pinned in all five directions — no proxy, flag present in either
  // spelling, guard set, unsupported flag, and the one case that re-execs.
  assert('no-proxy-means-no-rearm', proxyRearmPlan({ env: {} }).rearm === false);
  const proxied = proxyRearmPlan({ env: { HTTPS_PROXY: 'http://127.0.0.1:1' } });
  assert('a-proxied-run-without-the-flag-re-arms', proxied.rearm === true && proxied.flag === PROXY_FLAG, JSON.stringify(proxied));
  assert('the-flag-in-execArgv-stops-the-rearm', proxyRearmPlan({ env: { HTTPS_PROXY: 'http://x' }, execArgv: [PROXY_FLAG] }).rearm === false);
  assert('the-flag-in-NODE_OPTIONS-stops-the-rearm-too', proxyRearmPlan({ env: { HTTPS_PROXY: 'http://x', NODE_OPTIONS: `--enable-source-maps ${PROXY_FLAG}` } }).rearm === false);
  assert('the-guard-env-stops-an-infinite-rearm-loop', proxyRearmPlan({ env: { HTTPS_PROXY: 'http://x', [PROXY_REARM_GUARD]: '1' } }).rearm === false);
  const unsupported = proxyRearmPlan({ env: { https_proxy: 'http://x' }, flagSupported: false });
  assert('an-older-node-gets-the-printed-hint-not-a-bad-option-crash', unsupported.rearm === false && unsupported.hint === true, JSON.stringify(unsupported));
  assert('only-the-unsupported-branch-asks-for-the-hint', proxied.hint === false && proxyRearmPlan({ env: {} }).hint === false);

  const failedEntries = [
    { ...classifyCommit({ sha: 'e'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'docs: a (#101)' }, ['AGENTS.md'], GOVERNED_REPOS[2]), attributionError: 'env token (GITHUB_TOKEN/GH_TOKEN): HTTP 401; anonymous REST: HTTP 403' },
    { ...classifyCommit({ sha: 'e'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'docs: b (#102)' }, ['AGENTS.md'], GOVERNED_REPOS[2]), attributionError: 'env token (GITHUB_TOKEN/GH_TOKEN): HTTP 401; anonymous REST: HTTP 403' },
  ];
  const notes = summariseAttributionFailures(failedEntries);
  assert('two-failures-with-one-cause-collapse-to-ONE-named-line-not-per-entry-spam', notes.length === 1, JSON.stringify(notes));
  assert('the-named-line-names-repo-entries-and-every-channel-tried', notes[0].includes('objectstack-ai/cloud') && notes[0].includes('#101, #102') && notes[0].includes('HTTP 401') && notes[0].includes('anonymous REST'), notes[0]);
  assert('two-different-causes-do-not-collapse', summariseAttributionFailures([failedEntries[0], { ...failedEntries[1], attributionError: 'anonymous REST: request failed (ENOTFOUND)' }]).length === 2);
  const unresolvedReport = renderReport({ window: dateWindowFor('2026-08-17T00:00:00Z'), repos: allAudited, scanned: 3, entries: failedEntries, lookups: 2 });
  assert('an-unattributed-entry-is-marked-UNAVAILABLE-never-silently-blank', unresolvedReport.includes('merged_by UNAVAILABLE'), unresolvedReport);
  assert('the-reason-appears-once-below-the-list-not-inside-every-entry', unresolvedReport.split('HTTP 401').length - 1 === 1, unresolvedReport);
  const resolvedReport = renderReport({
    window: dateWindowFor('2026-08-17T00:00:00Z'),
    repos: allAudited,
    scanned: 3,
    entries: [{ ...classifyCommit({ sha: 'e'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'docs: a (#5188)' }, ['AGENTS.md'], GOVERNED_REPOS[1]), attribution: { mergedBy: 'os-steve', mergedAt: '2026-08-18T09:00:00Z' }, attributionChannel: 'anonymous' }],
    lookups: 1,
  });
  assert('a-resolved-entry-names-the-channel-it-came-from', resolvedReport.includes('merged_by os-steve') && resolvedReport.includes('(via anonymous)'), resolvedReport);
  assert('a-resolved-column-carries-the-account-is-not-a-principal-caveat', resolvedReport.includes('names an ACCOUNT, not a principal'), resolvedReport);
  assert('the-caveat-is-absent-when-nothing-resolved', !unresolvedReport.includes('names an ACCOUNT, not a principal'));

  // ── ⭐ #18989: the re-exec guard is the CALLER's name, and this copy is a
  // ── MIRROR pinned to its OWNER ────────────────────────────────────────────
  //
  // Two facts, one battery, because the card is one mechanism seen twice. The
  // guard the plan reads is the CALLER's, so no sibling instrument's inherited
  // variable can silence a tool that never re-armed (#18939's chain, replayed in
  // a second plan); and the plan itself is a mirror of `check-half-states.mjs`'s,
  // kept only because both edges that would retire it are measured deadlocks —
  // so the mirror is pinned to its owner's SOURCE, and so is the REASON.
  battery('⭐ #18989: the guard is the CALLER\'s name, and the mirror is pinned to its owner');
  const guardProxy = { HTTPS_PROXY: 'http://127.0.0.1:40309' };
  const SIBLING_GUARD = 'OS_SIBLING_PROXY_REARMED';
  const ownGuarded = proxyRearmPlan({ env: { ...guardProxy, [PROXY_REARM_GUARD]: '1' } });
  assert('the-default-guard-is-still-THIS-files-own-name-so-its-own-re-exec-is-unchanged',
    ownGuarded.rearm === false && ownGuarded.guarded === PROXY_REARM_GUARD, JSON.stringify(ownGuarded));
  assert('a-caller-that-names-its-OWN-guard-is-suppressed-by-that-one',
    proxyRearmPlan({ env: { ...guardProxy, [SIBLING_GUARD]: '1' }, guard: SIBLING_GUARD }).rearm === false);
  assert('and-THIS-files-name-does-NOT-suppress-it-the-cross-suppression-is-gone',
    proxyRearmPlan({ env: { ...guardProxy, [PROXY_REARM_GUARD]: '1' }, guard: SIBLING_GUARD }).rearm === true);
  assert('and-the-suppressing-variable-is-reported-machine-readably',
    proxyRearmPlan({ env: { ...guardProxy, [SIBLING_GUARD]: '1' }, guard: SIBLING_GUARD }).guarded === SIBLING_GUARD);
  // Silence is the whole cost of this chain: `rearm:false, hint:false` prints
  // nothing at any consumer. The guard branch HINTS, which every consumer prints.
  assert('a-guard-that-suppresses-SPEAKS-rather-than-closing-the-route-silently', ownGuarded.hint === true, JSON.stringify(ownGuarded));
  assert('the-line-names-the-variable-a-reader-has-to-unset', ownGuarded.reason.includes(PROXY_REARM_GUARD), ownGuarded.reason);
  assert('and-names-the-401-the-silence-would-otherwise-be-read-as', ownGuarded.reason.includes('401 Bad credentials'), ownGuarded.reason);
  assert('and-the-proxy-the-request-was-supposed-to-take', ownGuarded.reason.includes('http://127.0.0.1:40309'), ownGuarded.reason);
  // The Actions-runner leg, re-pinned ACROSS the new branch: a guard set where
  // no proxy is configured must still spawn nothing, hint nothing, print nothing.
  assert('with-no-proxy-configured-the-guard-is-inert-the-Actions-runner-leg',
    proxyRearmPlan({ env: { [PROXY_REARM_GUARD]: '1' } }).rearm === false && proxyRearmPlan({ env: { [PROXY_REARM_GUARD]: '1' } }).hint === false);
  assert('and-an-already-flagged-run-is-answered-by-the-FLAG-not-by-the-guard',
    Boolean(proxyRearmPlan({ env: { ...guardProxy, [PROXY_REARM_GUARD]: '1' }, execArgv: [PROXY_FLAG] }).guarded) === false);
  // Structural: the DEFAULT is not the contract, because `guard` is a parameter.
  // Both live call sites hand it this file's own name.
  const ownPlanSource = readFileSync(scriptPath, 'utf8');
  assert('structural-both-live-call-sites-hand-the-plan-THIS-files-guard',
    (ownPlanSource.match(/^\s+guard: PROXY_REARM_GUARD,$/gm) ?? []).length === 2,
    String((ownPlanSource.match(/^\s+guard: PROXY_REARM_GUARD,$/gm) ?? []).length));
  // ⭐ The owner's half, read from ITS source rather than typed from memory, so
  // a rename on either side reds here.
  const guardSpellingIn = (rel, decl) => {
    try {
      const source = readFileSync(join(repoRoot, rel), 'utf8');
      return { source, guard: new RegExp(`^${decl} PROXY_REARM_GUARD = '([^']+)';$`, 'm').exec(source)?.[1] ?? null };
    } catch (error) {
      return { source: null, guard: null, error: String(error?.message ?? error).split('\n')[0] };
    }
  };
  const patrol = guardSpellingIn('scripts/pm/check-half-states.mjs', 'export const');
  assert('the-patrol-file-is-readable-so-the-mirror-can-be-pinned-at-all',
    typeof patrol.source === 'string', `${patrol.error ?? 'ok'}`);
  // ⭐ The MIRROR: the patrol OWNS this decision. Its spelling and its `guard`
  // contract are read off disk — a constant asserting against itself proves
  // nothing — and its name must not silence this file either.
  assert('the-patrol-owns-an-equivalent-plan-whose-guard-is-its-OWN-name',
    typeof patrol.guard === 'string' && patrol.guard !== PROXY_REARM_GUARD, String(patrol.guard));
  assert('and-the-patrols-inherited-guard-does-NOT-suppress-THIS-files-re-exec',
    patrol.guard !== null && proxyRearmPlan({ env: { ...guardProxy, [patrol.guard]: '1' } }).rearm === true, String(patrol.guard));
  assert('the-owners-plan-takes-the-CALLERS-guard-too-so-the-two-mirrors-agree',
    /export function proxyRearmPlan\(\{[^)]*guard = PROXY_REARM_GUARD/.test(patrol.source ?? ''), 'the owner no longer takes a `guard` parameter');
  // ⭐ And the REASON the plan is mirrored instead of imported. Measured
  // 2026-09-19 on a throwaway copy of `scripts/`: a module-scope import of the
  // owner exits 13 ("Detected unsettled top-level await") against a control
  // exit 3, and a lazy `await import(…)` inside this very function exited 13 too
  // while this file's `--self-test` dispatch was itself a module-scope await (no longer, #33603).
  // When the line below goes away, the cycle may be gone with it — and then this
  // mirror should become a real import.
  assert('⭐-the-REASON-this-plan-is-a-mirror-and-not-an-import-is-still-true',
    /^export const GOVERNED_REGISTER = await loadGovernedRegister\(\);$/m.test(patrol.source ?? ''),
    'the owner no longer resolves its register with a module-scope await — re-measure the cycle and make this an import',
  );

  // ── the attribution column's THIRD case (#12645) ──────────────────────────
  // The two fixtures above are cases 1 and 2; the PR-less mainline entry —
  // the loudest line the sweep prints — is case 3, and it used to render
  // case 2's words with zero channels tried. All three are pinned as a set,
  // because the defect was a two-way split covering three facts.
  battery('the attribution column\'s THIRD case (#12645)');
  const notLookedUp = renderReport({ window: dateWindowFor('2026-08-13T00:00:00Z'), repos: allAudited, scanned: 3, entries: [noPr], lookups: 0 });
  assert('a-pr-less-entry-is-NOT-LOOKED-UP-not-a-failed-lookup', notLookedUp.includes('merged_by NOT LOOKED UP') && !notLookedUp.includes('every channel failed'), notLookedUp);
  assert('and-it-says-WHY-nothing-was-queried', notLookedUp.includes('no PR number in the subject') && notLookedUp.includes('not a channel failure'), notLookedUp);
  // The dangling pointer half of the defect: it named a note that this very
  // report never prints for it, because the note groups attributionError only.
  assert('a-not-looked-up-entry-points-at-no-attribution-note', !notLookedUp.includes('attribution note below'), notLookedUp);
  assert('and-the-report-prints-none-for-it', summariseAttributionFailures([noPr]).length === 0, JSON.stringify(summariseAttributionFailures([noPr])));
  assert('the-note-pointer-belongs-to-the-every-channel-failed-case-alone', unresolvedReport.includes('attribution note below'), unresolvedReport);
  // Report-only: the loud entry stays loud, and a case-3 column is still not
  // a resolved one (no ACCOUNT-not-a-principal caveat, nothing to prompt on).
  assert('the-third-case-does-not-soften-the-direct-push-warning', notLookedUp.includes('NO PR NUMBER IN SUBJECT — direct push to main? investigate'), notLookedUp);
  assert('and-carries-no-resolved-column-caveat', !notLookedUp.includes('names an ACCOUNT, not a principal'));
  // The cell function itself, all three classes plus the residual.
  assert('cell-case-1-resolved-names-its-channel',
    attributionCell({ attribution: { mergedBy: 'os-steve', mergedAt: '2026-08-18T09:00:00Z' }, attributionChannel: 'anonymous', pr: 5188 })
      === 'merged_by os-steve @ 2026-08-18T09:00:00Z (via anonymous)');
  assert('cell-case-2-every-channel-failed-needs-an-attributionError',
    attributionCell({ pr: 101, attributionError: 'anonymous REST: HTTP 403' }).startsWith('merged_by UNAVAILABLE — every channel failed'));
  assert('cell-case-3-no-pr-number-is-nothing-to-query', attributionCell({ pr: null }).startsWith('merged_by NOT LOOKED UP — no PR number in the subject'));
  // ⛔ An entry that HAS a PR number must never be told it has none: asserting
  // an untried channel and asserting an absent PR number are the same defect.
  const residual = attributionCell({ pr: 4242 });
  assert('cell-residual-never-invents-a-missing-pr-number', residual.startsWith('merged_by NOT LOOKED UP') && !residual.includes('no PR number'), residual);
  assert('and-the-residual-is-not-a-channel-failure-either', !residual.includes('every channel failed') && !residual.includes('attribution note below'), residual);
  // An attributionError never outranks a real reading, and a resolved entry
  // is never demoted by a stale PR-less shape.
  assert('a-resolved-reading-outranks-a-stale-error',
    attributionCell({ attribution: { mergedBy: 'x', mergedAt: 'y' }, attributionChannel: 'env-token', pr: null, attributionError: 'HTTP 401' })
      === 'merged_by x @ y (via env-token)');

  // ── the --test pre-arm predicate (#9550) ──────────────────────────────────
  battery('the --test pre-arm predicate (#9550)');
  const governedCase = testVerdict(['AGENTS.md'], { repo: REPO });
  assert('--test-on-the-#9527-file-list-answers-GOVERNED', governedCase.governed === true && governedCase.hitPaths.join() === 'AGENTS.md', JSON.stringify(governedCase));
  assert('--test-governed-renders-the-no-flip-no-enqueue-no-arm-instruction', renderTestVerdict(governedCase).includes('GOVERNED') && renderTestVerdict(governedCase).includes('arms auto-merge'), renderTestVerdict(governedCase));
  const mixedCase = testVerdict(['packages/spec/src/index.ts', '.claude/agents/os-dev.md', 'README.md'], { repo: REPO });
  assert('--test-on-a-mixed-diff-answers-GOVERNED-on-one-hit', mixedCase.governed === true && mixedCase.hitPaths.join() === '.claude/agents/os-dev.md', JSON.stringify(mixedCase.hitPaths));
  assert('--test-lists-the-paths-that-are-NOT-on-the-register-too', mixedCase.clearPaths.join() === 'packages/spec/src/index.ts,README.md', JSON.stringify(mixedCase.clearPaths));
  const clearCase = testVerdict(['packages/spec/src/index.ts', 'scripts/pm/check-half-states.mjs'], { repo: REPO });
  assert('--test-on-an-ordinary-diff-answers-NOT-governed', clearCase.governed === false && clearCase.hitPaths.length === 0, JSON.stringify(clearCase));
  assert('this-very-file-IS-a-governed-surface-since-2026-11-19-Tier-H-in-objectstack-and-ungoverned-elsewhere', testVerdict(['scripts/pm/check-governed-merges.mjs'], { repo: REPO }).governed === true && testVerdict(['scripts/pm/check-governed-merges.mjs'], { repo: REPO }).tier === GOVERNED_TIER_H && testVerdict(['scripts/pm/check-governed-merges.mjs'], { repo: 'cloud' }).governed === false);
  assert('--test-not-governed-renders-the-re-run-on-the-final-list-warning', renderTestVerdict(clearCase).includes('NOT governed') && renderTestVerdict(clearCase).includes('recall'), renderTestVerdict(clearCase));
  // Near misses on the predicate, the class the incident turns on: the seat
  // reasoned about a name, not a register.
  const nearMiss = testVerdict(['examples/AGENTS.md', 'docs/adrs/x.md', '.claude-x/y', 'skillsx/a.md', 'apps/CLAUDE.md.bak', 'packages/create-objectstack/src/templates/AGENTS.md'], { repo: REPO });
  assert('--test-near-misses-answer-NOT-governed', nearMiss.governed === false && nearMiss.clearPaths.length === 6, JSON.stringify(nearMiss.hitPaths));
  assert('--test-with-an-empty-path-list-is-never-a-not-governed-answer', testVerdict([], { repo: REPO }).checked === 0 && testVerdict([], { repo: REPO }).governed === false && runTestModeExitFor([], REPO) === EXIT_CANNOT_SWEEP);
  // Every governed surface answers 3 through its own glob — an uninvoked
  // surface is the phantom shape this self-test exists to refuse.
  for (const surface of GOVERNED_SURFACES) {
    const sample = surface.prefix ? `${surface.prefix}sample.md` : surface.exact;
    assert(`--test-answers-governed-for-${surface.id}`, testVerdict([sample], { repo: REPO }).governed === true, sample);
  }

  // ── the generated-artifact exception register (#9866 · #11084 · #11705) ──
  //
  // Safety-relevant merge-gate code: a bug here waves real instruction edits
  // past the fence. ⚖️ The #9866 docs-audit row RETIRED on 2026-09-01 (header
  // section above): its subject — the audit workflow's inline page list — was
  // moved off the governed surface by ruling, so there is no generated artifact
  // under `.claude/**` for any row to certify, and a row still naming that path
  // could only ever be asked to vouch for hand-authored instruction prose. The
  // register's SEMANTICS are pinned exactly as before, against the rows that
  // remain: the invariants, the lift / reject / fail-closed behaviour of
  // `applyGeneratedExceptions`, the untouched mixed-diff rule, and the #11084
  // co-edit fence in both directions.
  //
  // The register: every row is ruled, every row can actually prove something,
  // and every row names a surface its own paths are governed by — an exception
  // for an ungoverned path would be a register row nothing reads.
  assert('every-register-row-cites-the-ruling-that-put-it-there',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => typeof e.ruling === 'string' && /^#\d+$/.test(e.ruling)),
    JSON.stringify(GENERATED_SURFACE_EXCEPTIONS.map((e) => [e.id, e.ruling])));
  // The retirement, asserted rather than remembered: nothing may quietly
  // reinstate a lift over the instruction tree. Both row shapes are checked,
  // because a `candidate` regexp could re-admit the path without a `path` field.
  assert('no-row-lifts-anything-under-.claude-the-retired-9866-row-stays-retired',
    GENERATED_SURFACE_EXCEPTIONS.every((e) =>
      !(e.path ?? '').startsWith('.claude/') &&
      !(e.candidate?.test('.claude/workflows/docs-accuracy-audit.js') ?? false)),
    JSON.stringify(GENERATED_SURFACE_EXCEPTIONS.map((e) => [e.id, e.path ?? String(e.candidate)])));
  assert('the-audit-workflow-is-plainly-governed-again-with-no-provenance-consulted',
    testVerdict(['.claude/workflows/docs-accuracy-audit.js'], { repo: REPO }).governed === true &&
      generatedExceptionFor('.claude/workflows/docs-accuracy-audit.js') === null);
  assert('a-row-matches-either-an-exact-path-or-a-narrowing-candidate-never-neither-and-never-both',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => (typeof e.path === 'string') !== (e.candidate instanceof RegExp)),
    JSON.stringify(GENERATED_SURFACE_EXCEPTIONS.map((e) => [e.id, typeof e.path, String(e.candidate)])));
  assert('no-candidate-carries-the-g-flag-a-stateful-regexp-would-answer-differently-every-other-call',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => !e.candidate || !e.candidate.global));
  assert('the-exception-names-a-path-its-surface-actually-governs',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => {
      const m = governedPathsIn([e.path ?? REGISTER_SAMPLES[e.id]], REPO);
      return m.length === 1 && m[0].id === e.surfaceId;
    }), JSON.stringify(GENERATED_SURFACE_EXCEPTIONS.map((e) => e.path ?? REGISTER_SAMPLES[e.id])));
  assert('every-row-names-its-generator-command-and-its-trusted-instrument-tree',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => typeof e.generator === 'string' && e.generator !== '' && (e.trustedGeneratorPrefixes ?? []).length > 0));
  // A row with no recompute can prove nothing, so it must not exist: the
  // dispatcher fails such a row closed, and this refuses it one level earlier.
  assert('every-row-declares-the-recompute-that-proves-its-paths',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => e.verify && typeof e.verify.gate === 'string' && typeof e.verify.pkg === 'string'),
    JSON.stringify(GENERATED_SURFACE_EXCEPTIONS.map((e) => [e.id, e.verify ?? null])));
  {
    const noVerify = Object.freeze({ id: 'fixture-row', ruling: '#0', trustedGeneratorPrefixes: Object.freeze(['x/']) });
    const answered = await recomputeProvenanceFor('/nonexistent', new Map([[noVerify, ['skills/x/references/_index.md']]]));
    const only = [...answered.values()][0];
    assert('a-row-that-declares-no-recompute-fails-closed-rather-than-lifting',
      only?.pureRegeneration === false && /declares no recompute/.test(only?.reason ?? ''), JSON.stringify(only));
  }

  // Applying the exception to a verdict — the fence semantics, on a real
  // registered path. Provenance is a fixture here on purpose: these cases pin
  // what the register DOES with a verdict, not how a verdict is reached.
  const regPath = REGISTER_SAMPLES['spec-skill-refs'];
  const verified = new Map([[regPath, { pureRegeneration: true, reason: 'byte-equal (fixture)' }]]);
  const liftedVerdict = applyGeneratedExceptions(testVerdict(['content/docs/x.mdx', regPath], { repo: REPO }), verified);
  assert('a-verified-pure-regen-lifts-the-only-hit-and-the-pr-is-not-governed',
    liftedVerdict.governed === false && liftedVerdict.hitPaths.length === 0 && liftedVerdict.matched.length === 0, JSON.stringify(liftedVerdict.hitPaths));
  assert('a-lifted-path-is-recorded-as-an-exception-never-as-a-clear-path',
    !liftedVerdict.clearPaths.includes(regPath) && liftedVerdict.exceptions.length === 1 && liftedVerdict.exceptions[0].pureRegeneration === true, JSON.stringify(liftedVerdict.exceptions));
  const rejectedVerdict = applyGeneratedExceptions(testVerdict([regPath], { repo: REPO }), new Map([[regPath, { pureRegeneration: false, reason: 'differs (fixture)' }]]));
  assert('a-failed-provenance-keeps-the-path-governed', rejectedVerdict.governed === true && rejectedVerdict.hitPaths.join() === regPath);
  const absentProvenance = applyGeneratedExceptions(testVerdict([regPath], { repo: REPO }), new Map());
  assert('absent-provenance-fails-closed-never-open', absentProvenance.governed === true && /fail closed/.test(absentProvenance.exceptions[0].reason), JSON.stringify(absentProvenance.exceptions));
  // The mixed-diff rule is untouched: one hit on any OTHER governed path
  // still forks the whole PR, provenance verified or not.
  const mixedGoverned = applyGeneratedExceptions(testVerdict([regPath, '.claude/skills/x/SKILL.md'], { repo: REPO }), verified);
  assert('one-hit-on-any-OTHER-governed-path-still-forks-the-whole-pr',
    mixedGoverned.governed === true && mixedGoverned.hitPaths.join() === '.claude/skills/x/SKILL.md', JSON.stringify(mixedGoverned.hitPaths));
  assert('and-the-lifted-path-is-still-reported-as-lifted-on-a-mixed-diff', mixedGoverned.exceptions[0].pureRegeneration === true);
  // NAMED rows, not a class: a file the register does not cover never consults
  // provenance, even provenance that claims to be verified.
  const sibling = '.claude/workflows/some-other-workflow.js';
  const siblingVerdict = applyGeneratedExceptions(testVerdict([sibling], { repo: REPO }), new Map([[sibling, { pureRegeneration: true, reason: 'x' }]]));
  assert('an-unregistered-file-is-not-excepted-named-rows-not-a-class',
    siblingVerdict.governed === true && siblingVerdict.exceptions.length === 0, JSON.stringify(siblingVerdict.exceptions));
  assert('a-verdict-that-never-consulted-the-exception-carries-no-exceptions-field', testVerdict(['AGENTS.md'], { repo: REPO }).exceptions === undefined);

  // ── the generator co-edit fence (#11084), pinned in BOTH directions ──────
  //
  // The fence decides whether `--test` recomputes at all, so a bug in either
  // direction is load-bearing: too loose re-opens the self-certification, too
  // tight would break the ruled pure-regeneration lift.
  battery('the generator co-edit fence (#11084), pinned in BOTH directions');
  const fenceRow = GENERATED_SURFACE_EXCEPTIONS.find((e) => e.id === 'spec-skill-refs');
  const fencePrefix = fenceRow.trustedGeneratorPrefixes[0];
  // Direction A — co-edit: the generator is touched, so no recompute happens
  // and the artifact stays governed, with the stated reason.
  const coEditPaths = [regPath, `${fencePrefix}build-skill-references.ts`];
  const coEdit = generatorCoEditProvenance(coEditPaths, fenceRow);
  assert('a-generator-co-edit-answers-fail-closed-before-any-recompute',
    coEdit !== null && coEdit.pureRegeneration === false, JSON.stringify(coEdit));
  assert('the-co-edit-reason-states-the-ruled-words-and-names-the-co-edited-file',
    /modifies the generator this exception trusts — the path stays governed/.test(coEdit?.reason ?? '') &&
      (coEdit?.reason ?? '').includes(`${fencePrefix}build-skill-references.ts`), String(coEdit?.reason));
  // A neutered fence must fail LOUD and READABLE here, not crash the run: the
  // absent answer is itself the finding, so it is asserted, never dereferenced.
  const coEditVerdict = applyGeneratedExceptions(testVerdict(coEditPaths, { repo: REPO }), new Map(coEdit ? [[regPath, coEdit]] : []));
  assert('a-generator-co-edit-keeps-the-artifact-governed-the-exception-does-not-lift',
    coEditVerdict.governed === true && coEditVerdict.hitPaths.join() === regPath && coEditVerdict.exceptions[0].pureRegeneration === false,
    JSON.stringify(coEditVerdict.hitPaths));
  const coEditRender = renderTestVerdict(coEditVerdict);
  assert('the-co-edit-render-stays-GOVERNED-and-tells-the-seat-why-it-did-not-lift',
    coEditRender.includes('GOVERNED') && coEditRender.includes('did NOT lift') &&
      coEditRender.includes('modifies the generator this exception trusts'), coEditRender);
  assert('the-dot-slash-spelling-of-a-generator-path-is-fenced-too-recognising-more-only-tightens',
    generatorCoEditProvenance([regPath, `./${fencePrefix}build-skill-references.ts`], fenceRow) !== null);
  // Direction B — untouched generator: the fence abstains (`null`), the
  // recompute runs exactly as before, and a verified pure regeneration still
  // lifts. This is the narrowing's whole obligation: nothing else moves.
  const regenOnlyPaths = [regPath, 'packages/spec/src/ui/responsive.zod.ts'];
  assert('an-untouched-generator-abstains-so-the-recompute-runs-exactly-as-before',
    generatorCoEditProvenance(regenOnlyPaths, fenceRow) === null);
  const regenOnlyVerdict = applyGeneratedExceptions(testVerdict(regenOnlyPaths, { repo: REPO }), verified);
  assert('a-pure-regen-with-an-untouched-generator-still-lifts-and-the-pr-is-not-governed',
    regenOnlyVerdict.governed === false && regenOnlyVerdict.hitPaths.length === 0 && regenOnlyVerdict.exceptions[0].pureRegeneration === true,
    JSON.stringify(regenOnlyVerdict));
  assert('a-docs-only-pr-that-never-hits-the-register-is-untouched-by-the-fence',
    generatorCoEditProvenance(['content/docs/a.mdx'], fenceRow) === null && testVerdict(['content/docs/a.mdx'], { repo: REPO }).governed === false);
  // A prefix on the real directory, not a substring: a sibling directory whose
  // name merely starts the same way is not the trusted generator.
  assert('a-near-miss-sibling-directory-is-not-mistaken-for-the-generator-tree',
    generatorCoEditProvenance([`${fencePrefix.replace(/\/$/, '')}-x/other.ts`], fenceRow) === null);
  // A row that names no instrument tree cannot rule a co-edit out, so it must
  // fail closed rather than abstain — abstaining would send it on to recompute.
  {
    const unfenced = generatorCoEditProvenance([regPath], { id: 'fixture', trustedGeneratorPrefixes: [] });
    assert('a-row-with-no-trusted-generator-tree-fails-closed-rather-than-abstaining',
      unfenced !== null && unfenced.pureRegeneration === false && /names no trusted generator tree/.test(unfenced.reason), JSON.stringify(unfenced));
  }

  // ── the #11705 generator-owned rows inside `skills/**` ───────────────────
  //
  // The ruling's own limit is the thing to pin: a file qualifies ONLY by being
  // reproducible from its generator, proven per file. Two halves, both the
  // generator's own answer — it declared the path among its outputs, and its
  // `--check` reported no drift — and every other input fails closed.
  battery('the #11705 generator-owned rows inside `skills/**`');
  const skillRefs = GENERATED_SURFACE_EXCEPTIONS.find((e) => e.id === 'spec-skill-refs');
  const reactBlocks = GENERATED_SURFACE_EXCEPTIONS.find((e) => e.id === 'spec-react-blocks');
  const genIndex = REGISTER_SAMPLES['spec-skill-refs'];
  const handAuthored = 'skills/objectstack-ui/SKILL.md';
  // Real, and the reason this case is not hypothetical: `objectstack-upgrade`
  // is a shipped skill with NO SKILL_MAP entry, so an `_index.md` under it
  // would be hand-written prose at a path the candidate matches.
  const unownedIndex = 'skills/objectstack-upgrade/references/_index.md';
  const declaredOutputs = [genIndex, 'skills/objectstack-data/references/_index.md'];
  const cleanRun = { ok: true, outputs: declaredOutputs, reason: 'the generator reported no drift' };

  assert('both-ruled-generator-rows-are-registered-under-the-skills-catalog-surface',
    skillRefs?.surfaceId === 'skills-catalog' && reactBlocks?.surfaceId === 'skills-catalog' && skillRefs.ruling === '#11705' && reactBlocks.ruling === '#11705');
  assert('every-sample-is-matched-by-the-row-it-illustrates',
    Object.entries(REGISTER_SAMPLES).every(([id, p]) => generatedExceptionFor(p)?.id === id), JSON.stringify(REGISTER_SAMPLES));
  assert('a-generated-index-routes-to-the-skill-refs-generator', generatedExceptionFor(genIndex) === skillRefs);
  assert('the-react-blocks-output-routes-to-its-own-generator',
    generatedExceptionFor('skills/objectstack-ui/references/react-blocks.md') === reactBlocks);
  // The retirement, asserted rather than remembered (#14296 item 3 = A): the
  // generator emits ONE rendering, so the JSON path it used to write is not a
  // register member any more. A candidate that still matched it would hand a
  // deleted path a recompute nothing can satisfy.
  assert('the-retired-json-rendering-is-no-longer-a-register-member',
    generatedExceptionFor('skills/objectstack-ui/contracts/react-blocks.contract.json') === null);
  // ⭐ The ruled limit, stated as a membership question: hand-authored skill
  // content is not on the register at all, so it never reaches a generator.
  assert('a-hand-authored-skills-file-is-not-registered-and-is-never-consulted-against-a-generator',
    generatedExceptionFor(handAuthored) === null && generatedExceptionFor('skills/objectstack-ui/references/plugin-hooks.md') === null &&
      generatedExceptionFor('skills/objectstack-ui/references/_index.mdx') === null);

  // Ruled case A — a genuine generated file passes.
  const genuine = sinkGeneratorVerdict({ path: genIndex, entry: skillRefs, run: cleanRun });
  assert('11705-case-A-a-genuine-generated-file-passes-the-exemption', genuine.pureRegeneration === true, genuine.reason);
  assert('and-the-pass-names-the-recompute-and-consults-no-stored-baseline',
    /recomputed on this tree/.test(genuine.reason) && /no stored baseline/.test(genuine.reason), genuine.reason);
  // Ruled case B — the SAME path with one hand-edited byte does not. That edit
  // is what reddens the generator's own `--check`, so this is the shape the
  // measured ablation produced (see the PR body): exit 1 with a drift line.
  const handEdited = sinkGeneratorVerdict({
    path: genIndex,
    entry: skillRefs,
    run: { ok: false, outputs: declaredOutputs, reason: "the generator's own --check exited 1: ~ skills/objectstack-ui/references/_index.md (out of date)" },
  });
  assert('11705-case-B-the-same-path-with-one-hand-edited-byte-does-NOT-pass', handEdited.pureRegeneration === false, handEdited.reason);
  assert('and-the-refusal-quotes-the-generators-own-drift-line-rather-than-asserting-one',
    handEdited.reason.includes('out of date') && handEdited.reason.includes('check:skill-refs'), handEdited.reason);
  // Ruled case C — a path the generator does not write is hand-authored
  // content beside generated output, whatever the candidate says.
  const notOwned = sinkGeneratorVerdict({ path: unownedIndex, entry: skillRefs, run: cleanRun });
  assert('11705-case-C-a-path-the-generator-never-declared-stays-governed', notOwned.pureRegeneration === false, notOwned.reason);
  assert('and-that-refusal-says-the-generator-does-not-write-it-not-that-it-differs',
    notOwned.reason.includes('does not write') && notOwned.reason.includes('hand-authored'), notOwned.reason);
  // Fail-closed inputs, each with its own stated reason — including the one
  // real environment that cannot recompute at all.
  assert('a-row-whose-generator-never-ran-fails-closed', sinkGeneratorVerdict({ path: genIndex, entry: skillRefs, run: null }).pureRegeneration === false);
  const noManifest = sinkGeneratorVerdict({ path: genIndex, entry: skillRefs, run: { ok: true, outputs: [], reason: 'x' } });
  assert('an-empty-output-set-fails-closed-rather-than-vacuously-passing',
    noManifest.pureRegeneration === false && /nothing to prove ownership against/.test(noManifest.reason), noManifest.reason);
  const noToolchain = sinkGeneratorVerdict({
    path: genIndex,
    entry: skillRefs,
    run: { ok: false, outputs: null, reason: 'could not run `pnpm …` on this tree (spawn pnpm ENOENT) — the generator toolchain is not available in this environment' },
  });
  assert('an-environment-with-no-generator-toolchain-fails-closed-and-says-so',
    noToolchain.pureRegeneration === false && /toolchain is not available/.test(noToolchain.reason), noToolchain.reason);

  // The fence is PER ROW: the instrument that measures a row is that row's
  // generator tree, and the shared sink both spec generators write through is
  // part of it. Editing spec SOURCE is not a co-edit — the derivation is
  // REQUIRED to reflect it, which is the whole reason the artifact rides the
  // source PR.
  assert('editing-the-spec-generator-fences-the-row-it-would-certify',
    generatorCoEditProvenance([genIndex, 'packages/spec/scripts/build-skill-references.ts'], skillRefs) !== null);
  assert('and-the-shared-output-sink-counts-as-the-instrument-too',
    generatorCoEditProvenance([genIndex, 'packages/spec/scripts/lib/generated-output.ts'], skillRefs) !== null);
  assert('editing-spec-SOURCE-is-not-a-generator-co-edit', generatorCoEditProvenance([genIndex, 'packages/spec/src/ui/view.zod.ts'], skillRefs) === null);
  // PER ROW, not global: a row is fenced by ITS OWN instrument tree and by no
  // other. Pinned against a fixture row rather than a sibling register row,
  // because the two live rows happen to share a prefix today — and a property
  // that only holds while two rows differ is not the property being asserted.
  {
    const elsewhere = { id: 'fixture', trustedGeneratorPrefixes: ['tools/other-generator/'] };
    assert('the-fences-are-per-row-neither-tree-fences-the-other-rows-generator',
      generatorCoEditProvenance(['packages/spec/scripts/build-skill-references.ts'], elsewhere) === null &&
        generatorCoEditProvenance(['tools/other-generator/gen.ts'], skillRefs) === null);
  }

  // Applied to a verdict: the #11685 shape lifts, and the ruled limit holds.
  const specPr = applyGeneratedExceptions(testVerdict(['packages/spec/src/ui/responsive.zod.ts', genIndex], { repo: REPO }), new Map([[genIndex, genuine]]));
  assert('the-#11685-shape-a-spec-pr-carrying-its-own-regenerated-index-is-NOT-governed',
    specPr.governed === false && specPr.hitPaths.length === 0 && specPr.exceptions[0].pureRegeneration === true, JSON.stringify(specPr.hitPaths));
  const withHandAuthored = applyGeneratedExceptions(testVerdict([genIndex, handAuthored], { repo: REPO }), new Map([[genIndex, genuine]]));
  assert('but-one-hand-authored-skills-file-beside-it-still-forks-the-whole-pr',
    withHandAuthored.governed === true && withHandAuthored.hitPaths.join() === handAuthored, JSON.stringify(withHandAuthored.hitPaths));
  const fabricated = applyGeneratedExceptions(testVerdict([handAuthored], { repo: REPO }), new Map([[handAuthored, { pureRegeneration: true, reason: 'claims to be verified' }]]));
  assert('provenance-that-claims-to-be-verified-cannot-lift-an-unregistered-skills-file',
    fabricated.governed === true && fabricated.exceptions.length === 0, JSON.stringify(fabricated.exceptions));
  const grouped = groupHitsByException([genIndex, 'skills/objectstack-data/references/_index.md', 'skills/objectstack-ui/references/react-blocks.md', handAuthored]);
  assert('grouping-pays-for-one-generator-run-per-row-not-per-path',
    grouped.size === 2 && grouped.get(skillRefs).length === 2 && grouped.get(reactBlocks).length === 1, JSON.stringify([...grouped.values()]));
  assert('and-an-unregistered-path-is-in-no-group-at-all', ![...grouped.values()].flat().includes(handAuthored));

  // ── #11705 end to end, against the REAL generator ────────────────────────
  //
  // A fixture cannot show that the enumeration still reaches the register: the
  // output set is the GENERATOR's answer, and this is the only case that asks
  // it. Read-only — `--check` writes nothing to the tree, and the manifest goes
  // to a temp file. Both branches assert; a missing toolchain is the merge-group
  // guard job's real environment, where fail-closed is the correct answer, so
  // it is pinned rather than skipped.
  battery('#11705 end to end, against the REAL generator');
  const liveRun = runSinkGenerator(repoRoot, skillRefs);
  let liveNote;
  if (Array.isArray(liveRun.outputs) && liveRun.outputs.length > 0) {
    assert('the-live-generator-declares-the-output-set-itself-never-a-hand-copied-list',
      liveRun.outputs.includes(genIndex), JSON.stringify(liveRun.outputs.slice(0, 4)));
    assert('and-a-skill-it-does-not-write-is-absent-from-that-set',
      !liveRun.outputs.includes(unownedIndex), JSON.stringify(liveRun.outputs));
    const live = sinkGeneratorVerdict({ path: genIndex, entry: skillRefs, run: liveRun });
    assert('the-live-verdict-is-exactly-the-generators-own-verdict',
      live.pureRegeneration === (liveRun.ok === true), `${live.reason} / run.ok=${liveRun.ok}`);
    liveNote = liveRun.ok
      ? `live: the real generator declared ${liveRun.outputs.length} output(s) and certified this tree`
      : `live: the real generator declared ${liveRun.outputs.length} output(s) and REFUSED this tree (${liveRun.reason}) — the row stayed governed`;
  } else {
    assert('with-no-generator-toolchain-the-live-row-fails-closed-and-names-why',
      sinkGeneratorVerdict({ path: genIndex, entry: skillRefs, run: liveRun }).pureRegeneration === false, JSON.stringify(liveRun));
    liveNote = `live: no generator toolchain in this environment (${liveRun.reason}) — the row failed closed, which is the ruled answer here`;
  }

  // The words a seat reads.
  const liftedRender = renderTestVerdict(liftedVerdict);
  assert('a-lifted-render-names-the-exception-the-generator-and-the-recompute',
    liftedRender.includes('PURE REGENERATION') && liftedRender.includes(generatedExceptionFor(regPath).generator) && liftedRender.includes('THIS tree'), liftedRender);
  assert('a-lifted-render-still-warns-that-any-other-governed-hit-forks', liftedRender.includes('forks the whole PR'), liftedRender);
  const rejectedRender = renderTestVerdict(rejectedVerdict);
  assert('a-rejected-render-stays-GOVERNED-and-says-why-the-exception-did-not-lift',
    rejectedRender.includes('GOVERNED') && rejectedRender.includes('did NOT lift') && rejectedRender.includes('differs (fixture)'), rejectedRender);
  assert('a-verdict-without-exceptions-renders-exactly-as-before', renderExceptionLines(testVerdict(['AGENTS.md'], { repo: REPO })) === '' && !renderTestVerdict(testVerdict(['AGENTS.md'], { repo: REPO })).includes('#9866'));

  // ── the live battery's prerequisite, and the floor it was misread as ─────
  //
  // Two conditions that used to print the same verdict, pinned apart. An absent
  // toolchain is NOT MEASURED — exit 3, the prerequisite named. A case that
  // genuinely stopped registering is a FINDING — exit 1, the battery named. The
  // floor is not one case weaker for it; what changed is that the unmeasurable
  // condition no longer reaches it wearing a finding's clothes.
  battery("the live battery's prerequisite, and the floor it was misread as");
  const emptyCheckout = mkdtempSync(join(tmpdir(), 'os-governed-prereq-empty-'));
  const prunedCheckout = mkdtempSync(join(tmpdir(), 'os-governed-prereq-pruned-'));
  const copiedCheckout = mkdtempSync(join(tmpdir(), 'os-governed-prereq-copy-'));
  try {
    // An install that produced a tree but not the runner — a pruned, partial or
    // interrupted one. It reaches the live battery exactly as an empty checkout
    // does, and its remedy is the same, but the two are not the same reading.
    mkdirSync(join(prunedCheckout, 'node_modules', '.bin'), { recursive: true });
    const noInstall = generatorToolchainPrerequisite(emptyCheckout, liveGeneratorRow);
    const noRunner = generatorToolchainPrerequisite(prunedCheckout, liveGeneratorRow);
    assert('an-uninstalled-checkout-is-a-prerequisite-miss-not-a-shrunken-battery',
      noInstall !== null && noInstall.headline.includes('node_modules'), JSON.stringify(noInstall));
    assert('and-it-prescribes-the-install-never-a-hunt-for-code-nobody-deleted',
      noInstall?.fix === INSTALL_FIX && noInstall.detail.some((l) => l.includes('not one that shrank')), JSON.stringify(noInstall));
    assert('an-install-that-lacks-the-runner-names-the-RUNNER-not-a-missing-tree',
      noRunner !== null && noRunner.headline.includes(GENERATOR_TOOLCHAIN_RUNNER) && !noRunner.headline.includes('has no'), JSON.stringify(noRunner));
    assert('the-checkout-this-run-loaded-from-MEETS-it-so-every-floor-below-judges-as-before',
      generatorToolchainPrerequisite(repoRoot, liveGeneratorRow) === null, repoRoot);
    assert('the-refusal-code-is-the-repo-wide-3-and-never-a-findings-1',
      EXIT_PREREQUISITE_NOT_MET === 3 && EXIT_PREREQUISITE_NOT_MET !== EXIT_CANNOT_SWEEP, String(EXIT_PREREQUISITE_NOT_MET));

    // End to end, on the card's own repro: THIS file, in a checkout with no
    // `node_modules`, read back through the exit code a shell actually sees.
    // The copied set is self-verifying — an import added here and not added
    // there fails to load, and the exit-3 assertion below reds rather than
    // passing on a process that died for an unrelated reason.
    const moduleGraph = [
      'scripts/pm/check-governed-merges.mjs',
      'scripts/pm/git-history.mjs',
      'scripts/pm/clause2-line.mjs',
      'scripts/import-prerequisite.mjs',
      'scripts/cli-build-prerequisite.mjs',
      'scripts/git-env.mjs',
      'scripts/invoked-as.mjs',
    ];
    // ⛔ And the child must never spawn a child of its own. It reaches this
    // battery only when the probe did NOT refuse — and there its fixture tree
    // is a perfect seed for the next copy. Measured, with the probe ablated:
    // an unbounded chain of self-tests, one per second, each waiting on the
    // next, 67 processes before it was cut off by hand. A HANG is the worst
    // reading a gate can return — neither green nor red, and nothing in CI
    // distinguishes it from slow — so a marked run refuses to spawn and FAILS
    // these cases with the reason, in the same number of them.
    const childArgv = [join(copiedCheckout, 'scripts/pm/check-governed-merges.mjs'), '--self-test', '--fixture-child'];
    const nestedFixture = process.argv.includes('--fixture-child');
    let refused;
    if (nestedFixture) {
      refused = {
        status: null,
        stdout: '',
        stderr: 'this run was spawned BY the prerequisite battery and then reached that battery itself, '
          + 'which can only happen when the probe did not refuse. Refusing to spawn a grandchild.',
      };
    } else {
      for (const rel of moduleGraph) {
        mkdirSync(join(copiedCheckout, dirname(rel)), { recursive: true });
        cpSync(join(repoRoot, rel), join(copiedCheckout, rel));
      }
      refused = spawnSync(process.execPath, childArgv, {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
      });
    }
    const said = `${refused.stderr ?? ''}${refused.stdout ?? ''}`;
    assert('the-fixture-child-is-marked-so-it-can-never-spawn-one-of-its-own',
      childArgv.includes('--fixture-child') && nestedFixture === false, JSON.stringify(childArgv.slice(1)));
    assert('an-uninstalled-checkout-refuses-end-to-end-with-that-very-code',
      refused.status === EXIT_PREREQUISITE_NOT_MET, `status=${refused.status} ${said.slice(0, 400)}`);
    assert('and-the-refusal-names-the-class-the-prerequisite-and-the-remedy',
      said.includes('PREREQUISITE NOT MET') && said.includes('node_modules') && said.includes(INSTALL_FIX), said.slice(0, 400));
    assert('and-states-in-words-that-NOTHING-was-measured',
      said.includes('Nothing was measured') && said.includes('It is NOT a finding'), said.slice(0, 400));
    assert('and-hands-the-reader-the-command-that-actually-re-runs-these-cases',
      said.includes('pnpm check:pm-governed-merges'), said.slice(0, 400));
    assert('and-the-confidently-wrong-diagnosis-is-GONE-from-what-it-prints',
      !said.includes('below its pinned floor') && !said.includes('cases that used to run no longer do'), said.slice(0, 400));

    // The other direction — the floor is still the floor. Ledger fixtures are
    // built FROM this roster, so each message quotes the real pinned number and
    // a floor moved without a case cannot leave these green.
    const fullLedger = () => new Map(Object.entries(SELF_TEST_BATTERIES));
    const liveBattery = '#11705 end to end, against the REAL generator';
    const oneShort = fullLedger();
    oneShort.set(liveBattery, SELF_TEST_BATTERIES[liveBattery] - 1);
    const shortMessages = batteryFloorFailures(oneShort);
    const neverRan = fullLedger();
    neverRan.delete(liveBattery);
    const stray = fullLedger();
    stray.set(UNATTRIBUTED_BATTERY, 2);
    const trimmedRoster = Object.fromEntries(Object.entries(SELF_TEST_BATTERIES).slice(0, SELF_TEST_BATTERY_FLOOR - 1));
    assert('a-battery-one-case-short-still-reds-and-still-names-ITSELF',
      shortMessages.some((m) => m.includes(liveBattery) && m.includes(`below its pinned floor of ${SELF_TEST_BATTERIES[liveBattery]}`)), JSON.stringify(shortMessages));
    assert('a-battery-that-registered-nothing-at-all-is-named-as-DID-NOT-RUN',
      batteryFloorFailures(neverRan).some((m) => m.includes(liveBattery) && m.includes('DID NOT RUN')), JSON.stringify(batteryFloorFailures(neverRan)));
    assert('an-assertion-attributed-to-no-declared-battery-is-named-too',
      batteryFloorFailures(stray).some((m) => m.includes(UNATTRIBUTED_BATTERY) && m.includes('nothing floors')), JSON.stringify(batteryFloorFailures(stray)));
    assert('a-roster-that-lost-an-entry-is-caught-by-the-rosters-own-size-floor',
      batteryFloorFailures(fullLedger(), trimmedRoster).some((m) => m.includes('takes its own floor with it')), JSON.stringify(batteryFloorFailures(fullLedger(), trimmedRoster).slice(0, 2)));
    assert('and-a-ledger-that-meets-every-floor-produces-no-failure-at-all',
      batteryFloorFailures(fullLedger()).length === 0, JSON.stringify(batteryFloorFailures(fullLedger())));
    assert('every-breach-still-closes-with-the-restore-it-line-exactly-once',
      shortMessages.filter((m) => m.includes('the battery is the bug, not the number')).length === 1 && shortMessages.at(-1).includes('restore it'), JSON.stringify(shortMessages.at(-1)));
  } finally {
    for (const dir of [emptyCheckout, prunedCheckout, copiedCheckout]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* a leftover temp dir is not a verdict */
      }
    }
  }

  // ── ⭐ #15406: the sweep row names the register it does not recompute ─────
  //
  // Replays objectstack PR #15284, the landing filed as "the mixed-diff
  // diversion did not fire". The diversion had fired and found nothing to fork:
  // the diff's one governed path was this register's `spec-react-blocks` row,
  // the queue leg recomputed it on that tree, certified it byte-exact and
  // LIFTED it. Two report-side readings made a compliant landing read as a
  // mechanism failure, and both are pinned here:
  //
  //   1. the `--test` head counted the POST-lift set, printing "0 of 11 path(s)
  //      hit the register" immediately above the exception line naming the hit;
  //   2. this sweep classifies with `governedPathsIn` alone — deliberately, it
  //      holds no tree to recompute against — so the row it renders for a
  //      certified regeneration is indistinguishable from one for a
  //      hand-authored governed merge.
  //
  // ⛔ Neither the predicate nor what gets LISTED changes: (2) is still listed,
  // still governed, still the director's to read. Only the words change.
  battery('⭐ #15406: the sweep row names the register it does not recompute');
  const pr15284Files = [
    '.changeset/list-view-grouping-server-side-contract.md',
    'content/docs/references/ui/view.mdx',
    'packages/spec/src/ui/view.zod.ts',
    'skills/objectstack-ui/references/react-blocks.md',
  ];
  const pr15284ReactBlocks = 'skills/objectstack-ui/references/react-blocks.md';
  // The audit leg, unchanged and asserted to be unchanged: this sweep still
  // classifies that commit as a governed merge. The register is NOT consulted
  // here, and this case is what stops a later reader from "fixing" that.
  const pr15284Entry = classifyCommit(
    { sha: 'f502898a49530a1c85e58f3c4d2b340c0e1cb909', date: '2026-09-04T13:08:11Z', subject: 'feat(spec): list-view grouping is server-side (#15284)' },
    pr15284Files,
    GOVERNED_REPOS[0],
  );
  assert(
    '⭐ the-sweep-still-CLASSIFIES-a-certified-regeneration-as-a-governed-merge',
    pr15284Entry !== null && pr15284Entry.pr === 15284 && pr15284Entry.surfaces.flatMap((s) => s.files).join() === pr15284ReactBlocks,
    JSON.stringify(pr15284Entry),
  );
  const cell15284 = registerCell(pr15284Entry);
  assert('the-row-names-the-register-row-and-its-ruling', cell15284.includes(`${pr15284ReactBlocks} → spec-react-blocks (#11705)`), cell15284);
  assert('the-row-says-EVERY-governed-path-on-it-is-a-candidate', /REGISTER: every governed path\(s\) on this row is a generated-artifact CANDIDATE/.test(cell15284), cell15284);
  assert(
    '⭐ the-row-states-that-this-sweep-does-NOT-recompute-and-says-where-certification-is-recorded',
    /does NOT recompute provenance/.test(cell15284) && /Governed Surface Queue Guard log/.test(cell15284),
    cell15284,
  );
  assert(
    '⭐ the-row-repeats-the-registers-doctrine-rather-than-softening-it-a-candidate-is-a-QUESTION',
    /A candidate earns the QUESTION, never the answer/.test(cell15284) && /A hand edit to\n          the same path is never lifted\./.test(cell15284),
    cell15284,
  );
  // A row with no registered path renders EXACTLY as before — the cell is empty
  // string, so every ordinary governed merge keeps its pre-#15406 rendering.
  const handAuthoredEntry = classifyCommit(
    { sha: 'e'.repeat(40), date: '2026-09-04T00:00:00Z', subject: 'docs: rewrite a skill (#15285)' },
    ['skills/objectstack-ui/SKILL.md'],
    GOVERNED_REPOS[0],
  );
  assert('a-row-with-no-registered-path-renders-byte-identically-the-cell-is-empty', registerCell(handAuthoredEntry) === '', JSON.stringify(registerCell(handAuthoredEntry)));
  // Mixed: one registered path beside a hand-authored one. The row is governed
  // regardless of any recompute, and must say so rather than reading as partly
  // excused.
  const mixedEntry = classifyCommit(
    { sha: 'b'.repeat(40), date: '2026-09-04T00:00:00Z', subject: 'chore: regenerate and edit (#15286)' },
    [pr15284ReactBlocks, 'skills/objectstack-ui/SKILL.md'],
    GOVERNED_REPOS[0],
  );
  const mixedCell = registerCell(mixedEntry);
  assert(
    'a-mixed-row-counts-the-candidates-and-says-it-is-governed-regardless',
    /REGISTER: 1 of 2 governed path\(s\) on this row are a generated-artifact CANDIDATE/.test(mixedCell) &&
      /governed\n          regardless of any recompute/.test(mixedCell),
    mixedCell,
  );
  // End to end in the report an operator actually reads: the row is still
  // listed, still carries its attribution cell, and now carries the register
  // reading beneath it.
  const swept15284 = renderReport({
    window: dateWindowFor('2026-09-04T00:00:00Z'),
    repos: allAudited,
    scanned: 40,
    entries: [{ ...pr15284Entry, attribution: { mergedBy: 'os-justin', mergedAt: '2026-09-04T13:08:11Z', title: 'x' }, attributionChannel: 'rest' }],
    lookups: 1,
  });
  assert(
    'the-rendered-sweep-still-LISTS-the-row-and-now-carries-the-register-reading',
    swept15284.includes('PR #15284') && swept15284.includes('merged_by os-justin') && swept15284.includes('spec-react-blocks (#11705)'),
    swept15284,
  );
  assert('and-the-sweep-never-suppresses-such-a-row-it-still-counts-as-a-governed-merge', swept15284.includes('governed-merges sweep: 1 governed merge(s)'), swept15284);
  // The `--test` head line, both directions. `hitPaths` is the post-lift set,
  // so the count itself is right; what was missing is the reason it moved.
  const liftedTest = applyGeneratedExceptions(
    testVerdict(pr15284Files, { repo: REPO }),
    new Map([[pr15284ReactBlocks, { pureRegeneration: true, reason: 'byte-equal (fixture)' }]]),
  );
  const liftedHead = renderTestVerdict(liftedTest).split('\n')[0];
  assert(
    '⭐ the-test-head-no-longer-reports-a-post-lift-zero-as-if-nothing-had-hit-the-register',
    liftedHead === 'governed-surface predicate: 0 of 4 path(s) hit the register after 1 generated-artifact lift(s) (20 surfaces govern objectstack).',
    liftedHead,
  );
  const plainHead = renderTestVerdict(testVerdict(['packages/spec/src/ui/view.zod.ts'], { repo: REPO })).split('\n')[0];
  assert(
    'and-a-verdict-with-no-lift-keeps-its-head-line-byte-for-byte',
    plainHead === 'governed-surface predicate: 0 of 1 path(s) hit the register (20 surfaces govern objectstack).',
    plainHead,
  );

  // ── ⭐ #17003: the list is DERIVED three-dot, or the run refuses ──────────
  //
  // The predicate was correct and its INPUT was undefined. Every case here is
  // about the list ARRIVING right — the API reading, the local reading, the
  // refusals that must never soften into a two-dot superset, and the identity
  // that keeps ONE register answer in circulation however the list was got.
  battery('⭐ #17003: the list is DERIVED three-dot, or refused');

  // The page walk's terminator. Real headers, measured on PR #17076 (260
  // files): the first two responses carry `rel="next"`, the third does not.
  const linkPage1 =
    '<https://api.github.com/repositories/1136691870/pulls/17076/files?per_page=100&page=2>; rel="next", ' +
    '<https://api.github.com/repositories/1136691870/pulls/17076/files?per_page=100&page=3>; rel="last"';
  const linkPage3 =
    '<https://api.github.com/repositories/1136691870/pulls/17076/files?per_page=100&page=2>; rel="prev", ' +
    '<https://api.github.com/repositories/1136691870/pulls/17076/files?per_page=100&page=1>; rel="first"';
  assert('the-walk-follows-rel-next-while-one-is-offered',
    linkNext(linkPage1) === 'https://api.github.com/repositories/1136691870/pulls/17076/files?per_page=100&page=2',
    String(linkNext(linkPage1)));
  assert('and-the-last-page-offers-none-so-the-walk-ends',
    linkNext(linkPage3) === null && linkNext(null) === null && linkNext('') === null, String(linkNext(linkPage3)));
  assert('a-rel-last-or-rel-prev-is-never-mistaken-for-a-rel-next',
    linkNext('<https://x/?page=9>; rel="last"') === null && linkNext('<https://x/?page=1>; rel="prev"') === null);

  // ⭐ A rename contributes BOTH paths. Reading only `filename` answers NOT
  // governed for a diff that moves AGENTS.md off the governed surface — the
  // one direction a governance predicate must never fail in.
  const renamedOut = [{ status: 'renamed', filename: 'docs/AGENTS.md', previous_filename: 'AGENTS.md' }];
  const renameRead = pullPathsFrom(renamedOut);
  assert('a-rename-yields-the-new-path-AND-the-old-one',
    renameRead.paths.join() === 'docs/AGENTS.md,AGENTS.md' && renameRead.entries === 1, JSON.stringify(renameRead));
  assert('⭐ a-rename-OUT-of-a-governed-path-is-still-a-change-TO-that-path',
    testVerdict(renameRead.paths, { repo: REPO }).governed === true && testVerdict(['docs/AGENTS.md'], { repo: REPO }).governed === false,
    JSON.stringify(testVerdict(renameRead.paths, { repo: REPO }).hitPaths));
  assert('and-the-pair-is-reported-so-the-operator-sees-which-hit-came-from-a-rename',
    renameRead.renames.length === 1 && renameRead.renames[0].from === 'AGENTS.md' && renameRead.renames[0].to === 'docs/AGENTS.md',
    JSON.stringify(renameRead.renames));
  assert('an-ordinary-page-set-carries-no-rename-and-no-duplicate-paths',
    pullPathsFrom([{ filename: 'a.ts' }, { filename: 'a.ts' }, { filename: 'b.ts' }]).paths.join() === 'a.ts,b.ts');

  // A short list is a SUBSET — the one direction that can hide a hit outright.
  assert('a-walk-that-matches-the-PRs-own-count-is-proven-whole',
    pullTruncationReason({ collected: 260, changedFiles: 260, pages: 3, pageCap: 40 }) === null);
  assert('a-walk-that-does-not-match-that-count-refuses-and-names-both-numbers',
    /collected 100 file\(s\) over 1 page\(s\) but the PR reports 260/.test(
      String(pullTruncationReason({ collected: 100, changedFiles: 260, pages: 1, pageCap: 40 }))));
  assert('a-PR-that-reports-no-count-cannot-prove-the-walk-so-it-refuses-too',
    /cannot be proven whole/.test(String(pullTruncationReason({ collected: 5, changedFiles: null, pages: 1, pageCap: 40 }))));
  assert('and-a-walk-still-pending-pages-at-the-cap-refuses-on-the-cap-itself',
    /hit its 40-page cap/.test(String(pullTruncationReason({ collected: 4000, changedFiles: 4000, pages: 40, pageCap: 40, morePages: true }))));

  // `--pr`'s argument. The qualified spelling exists because the PM audits
  // five repos from one checkout; the repository it names is also the one the
  // scoped register answers for.
  assert('a-bare-number-means-this-checkouts-own-repo',
    JSON.stringify(parsePullTarget('16997', 'objectstack-ai/objectstack')) === JSON.stringify({ slug: 'objectstack-ai/objectstack', pull: 16997 }));
  assert('a-qualified-spelling-names-any-governed-repo',
    JSON.stringify(parsePullTarget('objectstack-ai/objectui#42', 'objectstack-ai/objectstack')) === JSON.stringify({ slug: 'objectstack-ai/objectui', pull: 42 }));
  assert('a-bare-number-with-no-readable-origin-is-an-error-never-a-guessed-repo',
    typeof parsePullTarget('42', null).error === 'string' && parsePullTarget('42', null).slug === undefined);
  assert('and-nonsense-is-an-error-never-a-silent-zero',
    typeof parsePullTarget('main', 'o/r').error === 'string' && typeof parsePullTarget('', 'o/r').error === 'string');

  // `--branch`, every leg, on an injected git. Each refusal is asserted for the
  // words a reader acts on — and for what it must NEVER say.
  const gitScript = (answers) => (argv) => {
    for (const [match, answer] of answers) if (argv.join(' ').includes(match)) return answer;
    return { ok: false, out: '', error: 'unexpected git call: ' + argv.join(' ') };
  };
  const ok40 = (sha) => ({ ok: true, out: sha, error: '' });
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const M = 'c'.repeat(40);
  const noBase = deriveBranchPaths({ ref: 'feature', run: gitScript([['rev-parse --verify --quiet origin/main', { ok: false, out: '', error: '' }]]) });
  assert('an-unfetched-origin-main-refuses-and-says-to-fetch-it',
    noBase.ok === false && /does not resolve to a commit/.test(noBase.reason) && /git fetch origin main/.test(noBase.remedy), JSON.stringify(noBase));
  const noRef = deriveBranchPaths({ ref: 'ghost', run: gitScript([
    ['rev-parse --verify --quiet origin/main', ok40(A)],
    ['rev-parse --verify --quiet ghost', { ok: false, out: '', error: '' }],
  ]) });
  assert('a-ref-this-checkout-does-not-have-refuses-rather-than-diffing-something-else',
    noRef.ok === false && /`ghost` does not resolve/.test(noRef.reason), JSON.stringify(noRef));
  // ⭐ The measured failure this whole mode exists for: `git merge-base` exits
  // 1 with EMPTY output on a shallow clone, and the shell recipe that reads it
  // inline then diffs against the WORKING TREE and exits 0 with a superset.
  const noMergeBase = deriveBranchPaths({ ref: 'feature', run: gitScript([
    ['rev-parse --verify --quiet origin/main', ok40(A)],
    ['rev-parse --verify --quiet feature', ok40(B)],
    ['merge-base', { ok: false, out: '', error: '' }],
  ]) });
  assert('⭐ an-uncomputable-merge-base-REFUSES-it-never-falls-back-to-two-dot',
    noMergeBase.ok === false && /computed nothing/.test(noMergeBase.reason) && noMergeBase.paths === undefined &&
      /deepen|unshallow/.test(noMergeBase.remedy), JSON.stringify(noMergeBase));
  const refusalWords = renderDerivationRefusal({ mode: '--branch feature', reason: noMergeBase.reason, remedy: noMergeBase.remedy });
  assert('and-the-refusal-tells-the-reader-why-a-fallback-would-be-worse-than-no-answer',
    refusalWords.includes('cannot derive') && refusalWords.includes('two-dot') && refusalWords.includes('#17003') &&
      refusalWords.includes('worse than none') && !refusalWords.includes('NOT governed'), refusalWords);
  const derived = deriveBranchPaths({ ref: 'feature', run: gitScript([
    ['rev-parse --verify --quiet origin/main', ok40(A)],
    ['rev-parse --verify --quiet feature', ok40(B)],
    ['merge-base', ok40(M)],
    ['diff -z --name-only --no-renames', { ok: true, out: 'src/a.ts\0src/b.ts\0', error: '' }],
    ['diff --numstat -M', { ok: true, out: '3\t1\tsrc/a.ts\n10\t0\tsrc/b.ts\n', error: '' }],
  ]) });
  assert('a-derivable-branch-answers-the-three-dot-list-from-the-merge-base',
    derived.ok === true && derived.paths.join() === 'src/a.ts,src/b.ts' && derived.derivation.mergeBase === M, JSON.stringify(derived));
  assert('and-the-size-off-the-same-range-rides-with-it',
    derived.size.additions === 13 && derived.size.deletions === 1 && derived.derivation.size.files === 2, JSON.stringify(derived.size));
  const noNumstat = deriveBranchPaths({ ref: 'feature', run: gitScript([
    ['rev-parse --verify --quiet origin/main', ok40(A)],
    ['rev-parse --verify --quiet feature', ok40(B)],
    ['merge-base', ok40(M)],
    ['diff -z --name-only --no-renames', { ok: true, out: 'src/a.ts\0', error: '' }],
    ['diff --numstat -M', { ok: false, out: '', error: 'fatal: numstat unavailable' }],
  ]) });
  assert('a---numstat-that-does-not-read-REFUSES-the-whole-derivation-never-a-size-of-zero',
    noNumstat.ok === false && /numstat/.test(noNumstat.reason) && /never a size of zero/.test(noNumstat.reason) && noNumstat.paths === undefined, JSON.stringify(noNumstat));
  assert('⛔ the-diff-is-taken-with---no-renames-so-a-rename-out-of-a-governed-path-still-hits',
    derived.derivation.command.includes('--no-renames'), derived.derivation.command);
  // #30718: the PATH list stays --no-renames, the SIZE read is rename-aware.
  const branchCalls = [];
  deriveBranchPaths({ ref: 'feature', run: (argv) => {
    branchCalls.push(argv.join(' '));
    return gitScript([
      ['rev-parse --verify --quiet origin/main', ok40(A)],
      ['rev-parse --verify --quiet feature', ok40(B)],
      ['merge-base', ok40(M)],
      ['diff -z --name-only --no-renames', { ok: true, out: 'src/a.ts\0', error: '' }],
      ['diff --numstat -M', { ok: true, out: '1\t1\tsrc/a.ts\n', error: '' }],
    ])(argv);
  } });
  const numstatCalls = branchCalls.filter((c) => c.includes('--numstat'));
  assert('⭐ #30718 the---branch-SIZE-read-is-rename-aware-M-and-never---no-renames-while-the-path-list-keeps---no-renames',
    numstatCalls.length === 1 && numstatCalls[0].includes(' -M ') && !numstatCalls[0].includes('--no-renames') &&
      branchCalls.some((c) => c.startsWith('diff -z --name-only --no-renames')), JSON.stringify(branchCalls));
  const branchLine = renderDerivation(derived.derivation);
  assert('the-branch-reading-names-its-command-its-base-and-its-merge-base',
    branchLine.includes('three-dot') && branchLine.includes('--no-renames') && branchLine.includes(M.slice(0, 10)) &&
      branchLine.includes('origin/main'), branchLine);
  assert('and-an-unnamed-derivation-is-never-rendered-as-a-reading-to-act-on',
    /do not act on this reading/.test(renderDerivation(null)));

  // The caller-derived note `--test` prints: it must name the right form, the
  // wrong one, and the two ways out.
  assert('the---test-note-names-three-dot-forbids-two-dot-and-points-at-both-derivations',
    CALLER_DERIVED_NOTE.includes('origin/main...HEAD') && CALLER_DERIVED_NOTE.includes('never two-dot') &&
      CALLER_DERIVED_NOTE.includes('--pr') && CALLER_DERIVED_NOTE.includes('--branch'), CALLER_DERIVED_NOTE);

  // `--pr`'s page walk, against an injected fetch. The shape is PR #17076's,
  // measured: 100 + 100 + 60 = 260 over three pages.
  {
    const respond = (body, link) => ({
      ok: true,
      status: 200,
      headers: { get: (k) => (String(k).toLowerCase() === 'link' ? link : null) },
      json: async () => body,
    });
    const denied = { ok: false, status: 403, headers: { get: () => null }, json: async () => ({}) };
    const rows = (from, n) => Array.from({ length: n }, (_, i) => ({ filename: `packages/p/f${from + i}.ts`, status: 'modified' }));
    const filesUrl = (page) => `<https://api/repos/o/r/pulls/1/files?per_page=100&page=${page}>`;
    const pageFor = (url) => (/page=3/.test(url) ? respond(rows(200, 60), `${filesUrl(2)}; rel="prev"`)
      : /page=2/.test(url) ? respond(rows(100, 100), `${filesUrl(3)}; rel="next"`)
        : respond(rows(0, 100), `${filesUrl(2)}; rel="next"`));
    const one = [{ id: 'fixture', name: 'fixture channel', headers: {} }];
    const walk = await fetchPullFiles({
      apiUrl: 'https://api', slug: 'o/r', pull: 1, channels: one,
      fetchImpl: async (url) => (/\/files/.test(url) ? pageFor(url) : respond({ changed_files: 260, additions: 260, deletions: 0 }, null)),
    });
    assert('⭐ the-walk-follows-Link-to-the-end-and-collects-every-page',
      walk.ok === true && walk.paths.length === 260 && walk.derivation.pages === 3 && walk.derivation.entries === 260,
      JSON.stringify({ ok: walk.ok, n: walk.paths?.length, reason: walk.reason }));
    assert('and-the-reading-says-which-endpoint-and-how-many-pages-it-cost',
      renderDerivation(walk.derivation).includes('three-dot by construction') &&
        renderDerivation(walk.derivation).includes('/repos/o/r/pulls/1/files') &&
        renderDerivation(walk.derivation).includes('3 page(s)'), renderDerivation(walk.derivation));
    const short = await fetchPullFiles({
      apiUrl: 'https://api', slug: 'o/r', pull: 1, channels: one,
      fetchImpl: async (url) => (/\/files/.test(url) ? respond(rows(0, 100), null) : respond({ changed_files: 260, additions: 260, deletions: 0 }, null)),
    });
    assert('⭐ a-walk-the-PRs-own-count-contradicts-REFUSES-rather-than-answering-on-a-subset',
      short.ok === false && /but the PR reports 260/.test(short.reason) && short.paths === undefined, JSON.stringify(short));
    // The channel is chosen once and kept: a fall-through mid-walk would splice
    // two readings, taken at two instants, into one list and call it the PR's.
    const two = [{ id: 'first', name: 'first channel', headers: {} }, { id: 'second', name: 'second channel', headers: {} }];
    let seen = 0;
    const pickSecond = await fetchPullFiles({
      apiUrl: 'https://api', slug: 'o/r', pull: 1, channels: two,
      fetchImpl: async (url, init) => {
        if (!/\/files/.test(url)) { seen += 1; return seen === 1 ? denied : respond({ changed_files: 1, additions: 1, deletions: 0 }, null); }
        return respond([{ filename: 'a.ts' }], null);
      },
    });
    assert('a-denied-channel-falls-through-to-the-next-one-on-the-first-read',
      pickSecond.ok === true && pickSecond.derivation.channel === 'second', JSON.stringify(pickSecond));
    const dropMidWalk = await fetchPullFiles({
      apiUrl: 'https://api', slug: 'o/r', pull: 1, channels: two,
      fetchImpl: async (url) => {
        if (!/\/files/.test(url)) return respond({ changed_files: 200, additions: 200, deletions: 0 }, null);
        if (/page=2/.test(url)) return denied; // the SECOND page, on the channel that served the first
        return respond(rows(0, 100), `${filesUrl(2)}; rel="next"`);
      },
    });
    assert('⛔ but-a-page-that-fails-mid-walk-refuses-it-never-switches-channel-and-splices',
      dropMidWalk.ok === false && /did not read/.test(dropMidWalk.reason), JSON.stringify(dropMidWalk));
    const renamedPr = await fetchPullFiles({
      apiUrl: 'https://api', slug: 'o/r', pull: 1, channels: one,
      fetchImpl: async (url) => (/\/files/.test(url) ? respond(renamedOut, null) : respond({ changed_files: 1, additions: 1, deletions: 0 }, null)),
    });
    assert('and-a-renamed-governed-file-reaches-the-predicate-as-BOTH-of-its-paths',
      renamedPr.ok === true && testVerdict(renamedPr.paths, { repo: REPO }).governed === true &&
        renderDerivation(renamedPr.derivation).includes('AGENTS.md → docs/AGENTS.md'), JSON.stringify(renamedPr.paths));
  }

  // ── the card's own shape, on a REAL repo, end to end ─────────────────────
  //
  // ⭐ Every pure case above stays green if `main()` simply stops CONSULTING
  // these derivations — the precedent this file already sets for its #13307
  // wiring. So the reproduction is RUN: a branch behind a `main` that has since
  // touched a governed path, two-dot against three-dot, through the real CLI.
  const derFx = mkdtempSync(join(tmpdir(), 'governed-merges-derive-'));
  try {
    const g2 = (cwd, ...rest) =>
      execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...rest],
        { cwd, encoding: 'utf8', env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const repo = join(derFx, 'repo');
    g2(derFx, 'init', '-q', repo);
    // The fixture is a checkout OF a governed repository: `--branch` / `--test`
    // answer for the checkout at --root, read off its origin (ruling B2).
    g2(repo, 'remote', 'add', 'origin', 'https://github.com/objectstack-ai/objectstack.git');
    const put = (rel, text) => {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      writeFileSync(join(repo, rel), text, 'utf8');
    };
    put('README.md', 'seed\n');
    put('AGENTS.md', 'the governed root instruction file\n');
    g2(repo, 'add', '-A');
    g2(repo, 'commit', '-qm', 'chore: seed');
    const forkPoint = g2(repo, 'rev-parse', 'HEAD').trim();
    // `main` moves on and touches a GOVERNED path this branch never will —
    // exactly what `gen:skill-refs` does to `skills/**` on ordinary landings.
    put('.claude/hooks/guard.sh', '# main only\n');
    g2(repo, 'add', '-A');
    g2(repo, 'commit', '-qm', 'chore: main touches the governed tree');
    g2(repo, 'update-ref', 'refs/remotes/origin/main', g2(repo, 'rev-parse', 'main').trim());
    // The branch forks BEFORE that and changes one ordinary file.
    g2(repo, 'checkout', '-q', '-b', 'feature', forkPoint);
    put('src/a.ts', 'export const a = 1;\n');
    g2(repo, 'add', '-A');
    g2(repo, 'commit', '-qm', 'feat: an ordinary change');
    // A second branch, also behind main, that renames the governed root file.
    g2(repo, 'checkout', '-q', '-b', 'rename-out', forkPoint);
    g2(repo, 'mv', 'AGENTS.md', 'docs-AGENTS.md');
    g2(repo, 'commit', '-qm', 'chore: move the root instruction file');
    // And one with no shared history at all — the merge-base refusal, for real.
    g2(repo, 'checkout', '-q', '--orphan', 'lonely');
    g2(repo, 'rm', '-rq', '--cached', '.');
    put('unrelated.txt', 'no shared history\n');
    g2(repo, 'add', '-A');
    g2(repo, 'commit', '-qm', 'chore: unrelated history');
    g2(repo, 'checkout', '-q', 'main');

    const run = (...argv) => {
      const r = spawnSync(process.execPath, [scriptPath, ...argv], { encoding: 'utf8', env: { ...process.env, [PROXY_REARM_GUARD]: '1' } });
      return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
    };
    const twoDot = g2(repo, 'diff', '--name-only', 'origin/main', 'feature').trim().split('\n').filter(Boolean);
    const threeDot = deriveBranchPaths({ ref: 'feature', run: (argv) => tryGit(repo, argv) });
    assert('⭐ the-cards-reproduction-two-dot-really-does-carry-mains-own-governed-path',
      twoDot.includes('.claude/hooks/guard.sh') && testVerdict(twoDot, { repo: REPO }).governed === true, JSON.stringify(twoDot));
    assert('⭐ and-the-three-dot-derivation-of-the-same-branch-is-NOT-governed',
      threeDot.ok === true && threeDot.paths.join() === 'src/a.ts' && testVerdict(threeDot.paths, { repo: REPO }).governed === false,
      JSON.stringify(threeDot.paths ?? threeDot));
    const branchRun = run('--branch', 'feature', '--root', repo);
    assert('⭐ and-the-CLI-itself-answers-NOT-governed-and-says-how-it-derived-the-list',
      branchRun.status === EXIT_TEST_NOT_GOVERNED && branchRun.out.includes('derived from') && branchRun.out.includes('NOT governed'),
      `status=${branchRun.status} out=${branchRun.out.slice(0, 400)}`);
    const twoDotRun = run('--test', ...twoDot);
    assert('while-the-two-dot-list-through---test-still-answers-GOVERNED-the-defect-is-the-INPUT',
      twoDotRun.status === EXIT_TEST_GOVERNED, `status=${twoDotRun.status} out=${twoDotRun.out.slice(0, 300)}`);
    // Zone (e)'s identity: one register, one answer, however the list was got.
    // The size `--branch` read off the range is handed to `--test` as the pair,
    // so the two readings are of the same list AND the same number.
    const sameListRun = run('--test', ...threeDot.paths, '--additions', String(threeDot.size.additions), '--deletions', String(threeDot.size.deletions));
    assert('⭐ the-verdict-is-BYTE-IDENTICAL-through---branch-and-through---test-on-the-same-list',
      branchRun.out.endsWith(sameListRun.out) && sameListRun.out !== '', JSON.stringify({ b: branchRun.out.slice(-120), t: sameListRun.out.slice(-120) }));
    assert('and---test-keeps-its-stdout-to-itself-the-three-dot-note-travels-on-stderr',
      !sameListRun.out.includes('#17003') && sameListRun.err.includes('never two-dot'), sameListRun.out);
    // ⭐ The rename, end to end. Default rename detection prints only the NEW
    // path, so the same branch reads as ungoverned through the obvious command.
    const renameDefault = g2(repo, 'diff', '--name-only', `${forkPoint}`, 'rename-out').trim().split('\n').filter(Boolean);
    assert('⭐ gits-own-rename-detection-hides-the-old-path-so-the-obvious-command-under-reports',
      renameDefault.join() === 'docs-AGENTS.md' && testVerdict(renameDefault, { repo: REPO }).governed === false, JSON.stringify(renameDefault));
    const renameRun = run('--branch', 'rename-out', '--root', repo);
    assert('⭐ while---branch-reads-both-paths-and-answers-GOVERNED',
      renameRun.status === EXIT_TEST_GOVERNED && renameRun.out.includes('AGENTS.md'),
      `status=${renameRun.status} out=${renameRun.out.slice(0, 400)}`);
    // ⭐ The refusal, end to end — and the superset it refuses to become.
    const collapsed = g2(repo, 'diff', '--name-only', 'lonely').trim().split('\n').filter(Boolean);
    const lonelyRun = run('--branch', 'lonely', '--root', repo);
    assert('⭐ an-uncomputable-merge-base-exits-1-with-a-refusal-and-NO-verdict-at-all',
      lonelyRun.status === EXIT_CANNOT_SWEEP && lonelyRun.err.includes('cannot derive') &&
        !lonelyRun.out.includes('governed-surface predicate'),
      `status=${lonelyRun.status} out=${lonelyRun.out.slice(0, 300)} err=${lonelyRun.err.slice(0, 300)}`);
    assert('⭐ and-the-collapsed-shell-recipe-it-refuses-to-imitate-really-is-a-superset',
      collapsed.length > 0 && testVerdict(collapsed, { repo: REPO }).governed === true, JSON.stringify(collapsed));
    // Silence is not a verdict, in this mode either.
    const emptyRun = run('--branch', 'main', '--root', repo);
    assert('a-branch-that-changes-nothing-is-a-failure-never-a-not-governed-answer',
      emptyRun.status === EXIT_CANNOT_SWEEP && emptyRun.err.includes('ZERO paths'), `status=${emptyRun.status} err=${emptyRun.err.slice(0, 200)}`);
    const bothRun = run('--test', 'AGENTS.md', '--branch', 'feature', '--root', repo);
    assert('two-mode-flags-name-two-lists-and-one-verdict-cannot-be-about-both',
      bothRun.status === EXIT_CANNOT_SWEEP && bothRun.err.includes('DIFFERENT file list'), `status=${bothRun.status} err=${bothRun.err.slice(0, 200)}`);
    const noRefRun = run('--branch', '--root', repo);
    assert('and---branch-with-no-ref-is-bad-args-never-a-sweep',
      noRefRun.status === EXIT_CANNOT_SWEEP && noRefRun.err.includes('--branch wants a git ref'), noRefRun.err.slice(0, 200));
  } finally {
    rmSync(derFx, { recursive: true, force: true });
  }

  // ── ⭐ the SIZE predicate (maintainer ruling 2026-09-18) ──────────────────
  //
  // Header section "The SIZE predicate". Pinned on both sides of the threshold,
  // on the number that prompted the ruling, on every mode's reading of the
  // number, and on the one thing an exemption would have exempted: a
  // generated-artifact lift moves a PATH off the register and moves the size
  // not at all.
  battery('⭐ the SIZE predicate: over the human-merge line threshold, whatever the paths');
  assert('the-threshold-is-the-ruled-3000-of-2026-10-09-declared-once', HUMAN_MERGE_LINE_THRESHOLD === 3000, String(HUMAN_MERGE_LINE_THRESHOLD));
  const atThreshold = sizeVerdict({ additions: HUMAN_MERGE_LINE_THRESHOLD, deletions: 0 });
  const overByOne = sizeVerdict({ additions: HUMAN_MERGE_LINE_THRESHOLD, deletions: 1 });
  assert('⭐ exactly-3000-changed-lines-is-UNDER-the-threshold',
    atThreshold.measured === true && atThreshold.changedLines === 3000 && atThreshold.exceeds === false, JSON.stringify(atThreshold));
  assert('⭐ 3001-changed-lines-is-OVER-it-the-count-is-additions-PLUS-deletions',
    overByOne.measured === true && overByOne.changedLines === 3001 && overByOne.exceeds === true, JSON.stringify(overByOne));
  const prompting = sizeVerdict({ additions: 238310, deletions: 119 });
  assert('the-PR-that-prompted-the-ruling-reads-238429-changed-lines-and-is-over',
    prompting.changedLines === 238429 && prompting.exceeds === true, JSON.stringify(prompting));
  assert('no-size-is-NOT-MEASURED-never-a-size-of-zero',
    sizeVerdict(null).measured === false && sizeVerdict(null).exceeds === false && sizeVerdict(null).changedLines === null && sizeVerdict({}).measured === false);
  assert('a-negative-or-non-integer-count-is-NOT-MEASURED-too',
    sizeVerdict({ additions: -1, deletions: 0 }).measured === false && sizeVerdict({ additions: 1.5, deletions: 0 }).measured === false &&
      sizeVerdict({ additions: '5001', deletions: 0 }).measured === false);
  // Through the verdict: the exit code is the GOVERNED one, the words say SIZE.
  const bigClean = testVerdict(['packages/spec/src/index.ts'], { repo: REPO, size: { additions: 6000, deletions: 0, source: 'a fixture' } });
  assert('⭐ an-oversized-PR-with-no-governed-path-is-NOT-governed-by-path-and-lands-by-HUMAN-MERGE',
    bigClean.governed === false && bigClean.size.exceeds === true && bigClean.humanMerge === true, JSON.stringify(bigClean));
  assert('and-it-exits-on-the-GOVERNED-code-so-every-existing-caller-routes-it-to-the-same-terminal',
    runTestModeExitFor(['packages/spec/src/index.ts'], REPO, bigClean.size) === EXIT_TEST_GOVERNED);
  const bigWords = renderTestVerdict(bigClean);
  assert('the-words-say-HUMAN-MERGE-the-number-the-threshold-and-that-generated-files-are-INCLUDED',
    bigWords.includes('HUMAN MERGE') && bigWords.includes('6000 changed line(s)') && bigWords.includes(`> ${HUMAN_MERGE_LINE_THRESHOLD}`) &&
      bigWords.includes('generated files INCLUDED') && bigWords.includes('arms auto-merge') && !bigWords.includes('a fixture'), bigWords);
  assert('and-the-provenance-of-the-number-stays-OFF-the-verdict-it-lives-on-the-derivation-line-or-the-stderr-note',
    bigClean.size.source === 'a fixture' && !renderSizeLines(bigClean.size).includes('fixture') && CALLER_SIZED_NOTE.includes('--additions'), renderSizeLines(bigClean.size));
  assert('and-they-never-say-ordinary-queue-landing-applies', !bigWords.includes('ordinary queue landing applies'), bigWords);
  const smallClean = testVerdict(['packages/spec/src/index.ts'], { repo: REPO, size: { additions: 10, deletions: 2 } });
  assert('an-ordinary-sized-ordinary-diff-still-answers-NOT-governed-and-says-the-size-is-under',
    smallClean.humanMerge === false && runTestModeExitFor(['packages/spec/src/index.ts'], REPO, smallClean.size) === EXIT_TEST_NOT_GOVERNED &&
      renderTestVerdict(smallClean).includes('under the human-merge threshold') && renderTestVerdict(smallClean).includes('12 changed line(s)'),
    renderTestVerdict(smallClean));
  const unmeasured = testVerdict(['packages/spec/src/index.ts'], { repo: REPO });
  assert('⭐ with-no-size-handed-in-the-verdict-says-NOT-MEASURED-on-stdout-and-names-the-modes-that-read-it',
    unmeasured.size.measured === false && unmeasured.humanMerge === false && renderTestVerdict(unmeasured).includes('NOT MEASURED') &&
      renderTestVerdict(unmeasured).includes('--pr') && renderTestVerdict(unmeasured).includes('--additions'), renderTestVerdict(unmeasured));
  assert('and-testVerdict-with-no-size-keeps-its-PATH-answer-byte-for-byte-the-queue-guard-imports-it',
    unmeasured.governed === false && JSON.stringify(unmeasured.hitPaths) === '[]' &&
      JSON.stringify(unmeasured.clearPaths) === '["packages/spec/src/index.ts"]' && testVerdict(['AGENTS.md'], { repo: REPO }).governed === true);
  const bigGoverned = testVerdict(['AGENTS.md'], { repo: REPO, size: { additions: 6000, deletions: 0 } });
  assert('a-governed-path-AND-an-oversized-diff-renders-both-limbs-and-stays-on-the-governed-code',
    bigGoverned.governed === true && bigGoverned.humanMerge === true && renderTestVerdict(bigGoverned).includes('GOVERNED') &&
      renderTestVerdict(bigGoverned).includes('HUMAN MERGE'), renderTestVerdict(bigGoverned));
  // ⛔ No exemption for generated files: the register lifts a PATH, never a line count.
  const regenPath = REGISTER_SAMPLES['spec-skill-refs'];
  const liftedBig = applyGeneratedExceptions(
    testVerdict([regenPath], { repo: REPO, size: { additions: 237706, deletions: 0 } }),
    new Map([[regenPath, { pureRegeneration: true, reason: 'byte-equal to the generator (fixture)' }]]),
  );
  assert('⭐ a-certified-pure-regeneration-lifts-the-PATH-and-lifts-NOTHING-from-the-size',
    liftedBig.governed === false && liftedBig.exceptions.some((e) => e.pureRegeneration) && liftedBig.humanMerge === true && liftedBig.size.exceeds === true,
    JSON.stringify({ governed: liftedBig.governed, humanMerge: liftedBig.humanMerge }));
  assert('and-the-rendering-carries-both-the-lift-and-the-HUMAN-MERGE',
    renderTestVerdict(liftedBig).includes('PURE REGENERATION') && renderTestVerdict(liftedBig).includes('HUMAN MERGE'), renderTestVerdict(liftedBig));
  // ── the SIZE limb's LIFT (maintainer ruling 2026-09-27, objectstack#20153) ──
  // The approval verdict is the queue guard's `authorizedApprovalVerdict` SHAPE,
  // handed in as data; this file derives nothing from a review list. Fixtures
  // spell that shape once, and the non-lift cases are the card's own list: no
  // approval, an unauthorized one (the authorized reduction leaves it OUT of
  // `approvals`), a dismissed/superseded one (`unapproved`), an unreadable list.
  const LIFT_SHA = 'e4ead748' + '0'.repeat(32);
  const authorizedVerdict = (approvals, extra = {}) => ({
    state: approvals.length > 0 ? 'approved' : 'unapproved', approvers: approvals.map((a) => a.login), approvals,
    approvalsOnEarlierCommits: [], unauthorizedApprovers: [], changesRequestedBy: [], reviewsRead: 1, headSha: LIFT_SHA, ...extra,
  });
  const liftedByApproval = testVerdict(['packages/spec/src/index.ts'], { repo: REPO, size: { additions: 10764, deletions: 999, source: 'a fixture' }, approval: authorizedVerdict([{ login: 'os-zhuang', commitId: LIFT_SHA }]) });
  assert('⭐ an-authorized-APPROVED-review-LIFTS-the-size-limb-exceeds-stays-TRUE-and-the-PR-no-longer-lands-by-human-merge',
    liftedByApproval.size.exceeds === true && liftedByApproval.size.changedLines === 11763 && liftedByApproval.size.lifted !== null &&
      liftedByApproval.size.lifted.approvers.join() === 'os-zhuang' && liftedByApproval.size.lifted.approvals[0].commitId === LIFT_SHA &&
      liftedByApproval.humanMerge === false && landsByHumanMerge(liftedByApproval) === false && sizeLimbFires(liftedByApproval.size) === false,
    JSON.stringify(liftedByApproval.size));
  assert('and-the-threshold-the-strict-comparison-and-the-generated-files-inclusion-are-UNCHANGED-by-the-lift',
    liftedByApproval.size.threshold === 3000 && sizeVerdict({ additions: 3000, deletions: 0 }, authorizedVerdict([{ login: 'os-zhuang', commitId: LIFT_SHA }])).exceeds === false &&
      sizeVerdict({ additions: 3000, deletions: 1 }, null).exceeds === true);
  const liftedWords = renderTestVerdict(liftedByApproval);
  assert('and-the-words-print-the-lift-the-approver-the-commit-and-this-card-and-name-the-seat-landing',
    liftedWords.includes('SIZE LIFTED') && liftedWords.includes('os-zhuang (on e4ead7480000)') && liftedWords.includes('objectstack#20153') &&
      liftedWords.includes('2026-09-27') && liftedWords.includes('OWNING seat lands this PR through the queue') && !liftedWords.includes('HUMAN MERGE OR') &&
      liftedWords.includes('NOT governed'), liftedWords);
  assert('and-it-exits-on-the-NOT-governed-code-the-queue-lands-it', runTestModeExitFor(['packages/spec/src/index.ts'], REPO, { additions: 10764, deletions: 999 }, authorizedVerdict([{ login: 'os-zhuang', commitId: LIFT_SHA }])) === EXIT_TEST_NOT_GOVERNED);
  const overSize = { additions: 6000, deletions: 0 };
  assert('⛔ NO-approval-handed-in-still-lands-by-human-merge-or-authorized-approval-the-2026-09-18-reading-unchanged',
    sizeLimbFires(sizeVerdict(overSize, null)) === true && sizeVerdict(overSize, null).lifted === null && sizeVerdict(overSize, null).approvalState === null);
  assert('⛔ an-UNAPPROVED-verdict-dismissed-or-superseded-lifts-nothing',
    sizeLimbFires(sizeVerdict(overSize, authorizedVerdict([]))) === true && sizeVerdict(overSize, authorizedVerdict([])).approvalState === 'unapproved');
  assert('⛔ an-UNAUTHORIZED-approval-is-outside-approvals-and-lifts-nothing',
    sizeLimbFires(sizeVerdict(overSize, authorizedVerdict([], { unauthorizedApprovers: ['not-authorized'] }))) === true);
  assert('⛔ an-UNREADABLE-review-list-fails-CLOSED',
    sizeLimbFires(sizeVerdict(overSize, { state: 'unreadable', approvers: [], changesRequestedBy: [], reviewsRead: 0, reason: 'HTTP 403' })) === true &&
      sizeVerdict(overSize, { state: 'unreadable' }).approvalState === 'unreadable');
  assert('⛔ the-GENERIC-per-reviewer-reduction-carries-no-approvals-field-and-lifts-nothing-a-verdict-that-never-asked-WHO',
    sizeLimbFires(sizeVerdict(overSize, { state: 'approved', approvers: ['anyone'], changesRequestedBy: [], reviewsRead: 1 })) === true &&
      sizeLiftFrom({ state: 'approved', approvers: ['os-zhuang'], approvals: [] }) === null && sizeLiftFrom({ state: 'approved', approvals: [{ commitId: 'x' }] }) === null);
  // ── the ENQUEUE lift (maintainer ruling 2026-10-26, objectstack#26066) ──
  // The guard hands its approval verdict with the enqueue reading attached; an
  // AUTHORIZED enqueue lifts, every other enqueue reading lifts nothing, and an
  // authorized approval is still the lift that is read first.
  const enqueued = (state, login = 'os-zhuang') => authorizedVerdict([], { enqueue: { state, login, at: '2026-10-26T15:00:00Z' } });
  const liftedByEnqueue = sizeVerdict(overSize, enqueued('authorized'));
  assert('⭐ an-AUTHORIZED-enqueue-LIFTS-the-size-limb-and-the-lift-names-the-enqueuer-and-the-ruling',
    sizeLimbFires(liftedByEnqueue) === false && liftedByEnqueue.lifted?.enqueuedBy?.login === 'os-zhuang' && liftedByEnqueue.lifted.ruling === SIZE_ENQUEUE_LIFT_RULING &&
      liftedByEnqueue.lifted.approvals.length === 0 && renderLiftApprovals(liftedByEnqueue.lifted) === 'os-zhuang (enqueued it at 2026-10-26T15:00:00Z)',
    JSON.stringify(liftedByEnqueue.lifted));
  assert('⛔ an-UNAUTHORIZED-or-UNDETERMINED-enqueue-lifts-nothing',
    sizeLimbFires(sizeVerdict(overSize, enqueued('unauthorized', 'objectstack-fleet[bot]'))) === true &&
      sizeLimbFires(sizeVerdict(overSize, enqueued('undetermined', null))) === true &&
      sizeLiftFrom({ state: 'unapproved', approvals: [], enqueue: { state: 'authorized', login: '' } }) === null);
  assert('an-authorized-APPROVAL-is-the-lift-read-first-even-with-an-authorized-enqueue-beside-it',
    sizeLiftFrom(authorizedVerdict([{ login: 'os-zhuang', commitId: LIFT_SHA }], { enqueue: { state: 'authorized', login: 'os-zhuang' } })).ruling === SIZE_LIFT_RULING);
  assert('an-approval-under-the-line-lifts-nothing-because-there-is-nothing-to-lift',
    sizeVerdict({ additions: 10, deletions: 2 }, authorizedVerdict([{ login: 'os-zhuang', commitId: LIFT_SHA }])).lifted === null && sizeVerdict(null, authorizedVerdict([{ login: 'os-zhuang', commitId: LIFT_SHA }])).lifted === null);
  const liftedGoverned = testVerdict(['AGENTS.md'], { repo: REPO, size: overSize, approval: authorizedVerdict([{ login: 'os-zhuang', commitId: LIFT_SHA }]) });
  assert('⭐ the-lift-moves-the-SIZE-limb-only-a-governed-PATH-still-lands-per-its-tier-and-a-FORK-head-is-untouched',
    liftedGoverned.governed === true && landsByHumanMerge(liftedGoverned) === true && liftedGoverned.size.lifted !== null &&
      landsByHumanMerge(testVerdict(['x.ts'], { repo: REPO, size: overSize, approval: authorizedVerdict([{ login: 'os-zhuang', commitId: LIFT_SHA }]), fork: forkVerdict({ base: { repo: { full_name: 'o/r' } }, head: { repo: { full_name: 'f/r' } } }) })) === true);
  assert('⭐ the-post-merge-sweep-hands-in-NO-approval-so-an-oversized-landing-is-STILL-listed',
    classifyCommit({ sha: 'b'.repeat(40), date: '2026-09-27T02:02:33Z', subject: 'feat!: retire the saved-report stack (#20125)' }, ['packages/x.ts'], GOVERNED_REPOS[0], { additions: 10764, deletions: 999 }) !== null);
  assert('and-the-not-lifted-words-name-BOTH-landings-the-authorized-approval-and-the-maintainers-merge',
    bigWords.includes('until an account in') && bigWords.includes('GOVERNED_APPROVERS has APPROVED it, on ANY commit') && bigWords.includes('objectstack#20153') &&
      bigWords.includes("the maintainer's own merge is the other landing") && !bigWords.includes('lands only by a human merge'), bigWords);
  // The number's sources. `--numstat`, parsed: text rows sum, a binary row counts 0 as on GitHub.
  const numstat = parseNumstat('3\t1\tsrc/a.ts\n-\t-\timg/logo.png\n10\t0\tsrc/b.ts\n\n');
  assert('numstat-sums-text-rows-and-counts-a-binary-row-as-zero-lines',
    numstat.additions === 13 && numstat.deletions === 1 && numstat.files === 3 && numstat.binaryFiles === 1, JSON.stringify(numstat));
  assert('and-an-empty-numstat-is-zero-of-everything-not-a-crash',
    JSON.stringify(parseNumstat('')) === JSON.stringify({ additions: 0, deletions: 0, files: 0, binaryFiles: 0 }) && parseNumstat(null).files === 0);
  // The PR object: the pair, or null for the caller to refuse on.
  assert('a-PR-object-with-the-pair-yields-the-pair',
    JSON.stringify(pullSizeFrom({ additions: 238310, deletions: 119 })) === JSON.stringify({ additions: 238310, deletions: 119 }));
  assert('a-PR-object-without-the-pair-yields-null-never-zero',
    pullSizeFrom({ changed_files: 3 }) === null && pullSizeFrom({ additions: 3 }) === null && pullSizeFrom({ additions: '3', deletions: 0 }) === null && pullSizeFrom(null) === null);
  // The caller's flags: both, neither, or a refusal.
  assert('no-size-flags-is-no-size', JSON.stringify(readSizeFlags(['--test', 'a.ts'])) === JSON.stringify({ ok: true, size: null }));
  const bothFlags = readSizeFlags(['--test', 'a.ts', '--additions', '5000', '--deletions', '1']);
  assert('both-flags-read-as-the-pair-and-name-the-caller-as-the-source',
    bothFlags.ok === true && bothFlags.size.additions === 5000 && bothFlags.size.deletions === 1 && /CALLER/.test(bothFlags.size.source), JSON.stringify(bothFlags));
  assert('one-flag-without-the-other-is-refused-the-count-is-their-SUM',
    readSizeFlags(['--additions', '5']).ok === false && /travel together/.test(readSizeFlags(['--additions', '5']).error) && readSizeFlags(['--deletions', '5']).ok === false);
  assert('a-non-integer-or-negative-value-is-refused',
    readSizeFlags(['--additions', 'x', '--deletions', '1']).ok === false && readSizeFlags(['--additions', '-1', '--deletions', '1']).ok === false &&
      readSizeFlags(['--additions', '--deletions', '1']).ok === false);
  // `--pr`'s read, on the injected fetch: the pair rides the same GET as the count; its absence REFUSES.
  {
    const respond = (body, link) => ({ ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === 'link' ? link : null) }, json: async () => body });
    const one = [{ id: 'fixture', name: 'fixture channel', headers: {} }];
    const sized = await fetchPullFiles({
      apiUrl: 'https://api', slug: 'o/r', pull: 18971, channels: one,
      fetchImpl: async (url) => (/\/files/.test(url)
        ? respond([{ filename: 'packages/spec/api-surface/x.json' }], null)
        : respond({ changed_files: 1, additions: 238310, deletions: 119 }, null)),
    });
    assert('⭐ --pr-reads-additions-and-deletions-off-the-same-GET-that-gives-the-changed_files-count',
      sized.ok === true && sized.size.additions === 238310 && sized.size.deletions === 119 && /GET \/repos\/o\/r\/pulls\/18971/.test(sized.size.source) &&
        sized.derivation.size.additions === 238310, JSON.stringify(sized.size ?? sized));
    assert('and-the-derivation-line-prints-the-pair',
      renderDerivation(sized.derivation).includes('+238310 / -119'), renderDerivation(sized.derivation));
    const unsized = await fetchPullFiles({
      apiUrl: 'https://api', slug: 'o/r', pull: 2, channels: one,
      fetchImpl: async (url) => (/\/files/.test(url) ? respond([{ filename: 'a.ts' }], null) : respond({ changed_files: 1, merged: false }, null)),
    });
    assert('⭐ a-PR-object-missing-the-pair-REFUSES-never-a-not-governed-answer-and-never-a-size-of-zero',
      unsized.ok === false && /additions/.test(unsized.reason) && /never a size of zero/.test(unsized.reason) && unsized.paths === undefined, JSON.stringify(unsized));
  }
  // End to end, on a real repository: `--branch` counts the same range it lists,
  // the flags reach `--test`, and the verdict is still ONE emitter.
  const sizeFx = mkdtempSync(join(tmpdir(), 'governed-merges-size-'));
  try {
    const g3 = (cwd, ...rest) =>
      execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...rest],
        { cwd, encoding: 'utf8', env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const repo = join(sizeFx, 'repo');
    g3(sizeFx, 'init', '-q', repo);
    g3(repo, 'remote', 'add', 'origin', 'https://github.com/objectstack-ai/objectstack.git'); // the checkout's repository (ruling B2)
    const put = (rel, data) => {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      writeFileSync(join(repo, rel), data);
    };
    put('README.md', 'a\nb\nc\n');
    g3(repo, 'add', '-A');
    g3(repo, 'commit', '-qm', 'chore: seed');
    g3(repo, 'update-ref', 'refs/remotes/origin/main', g3(repo, 'rev-parse', 'main').trim());
    g3(repo, 'checkout', '-q', '-b', 'feature');
    put('README.md', 'a\nc\n'); // -1
    put('src/a.ts', 'l1\nl2\nl3\nl4\nl5\nl6\n'); // +6
    put('img/blob.bin', Buffer.from([0, 1, 2, 3, 0])); // binary: 0 lines, as on GitHub
    g3(repo, 'add', '-A');
    g3(repo, 'commit', '-qm', 'feat: sized');
    g3(repo, 'checkout', '-q', 'main');
    const run = (...argv) => {
      const r = spawnSync(process.execPath, [scriptPath, ...argv], { encoding: 'utf8', env: { ...process.env, [PROXY_REARM_GUARD]: '1' } });
      return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
    };
    const local = deriveBranchPaths({ ref: 'feature', run: (argv) => tryGit(repo, argv) });
    assert('⭐ --branch-counts-the-range-it-lists-with---numstat-binary-files-at-zero',
      local.ok === true && local.size.additions === 6 && local.size.deletions === 1 && local.size.binaryFiles === 1 && local.size.files === 3, JSON.stringify(local.size ?? local));
    const branchRun = run('--branch', 'feature', '--root', repo);
    assert('and-the-CLI-prints-the-reading-under-the-threshold-and-exits-NOT-governed',
      branchRun.status === EXIT_TEST_NOT_GOVERNED && branchRun.out.includes('7 changed line(s)') && branchRun.out.includes('under the human-merge threshold'),
      `status=${branchRun.status} out=${branchRun.out.slice(0, 500)}`);
    const sameNumbers = run('--test', ...local.paths, '--additions', '6', '--deletions', '1');
    assert('⭐ the-verdict-is-BYTE-IDENTICAL-through---branch-and-through---test-once-the-same-numbers-are-handed-in',
      branchRun.out.endsWith(sameNumbers.out) && sameNumbers.out !== '', JSON.stringify({ b: branchRun.out.slice(-160), t: sameNumbers.out.slice(-160) }));
    const overRun = run('--test', 'src/a.ts', '--additions', String(HUMAN_MERGE_LINE_THRESHOLD), '--deletions', '1');
    assert('⭐ --test-with-3001-changed-lines-on-an-ordinary-path-exits-3-and-says-HUMAN-MERGE',
      overRun.status === EXIT_TEST_GOVERNED && overRun.out.includes('HUMAN MERGE') && !overRun.out.includes('ordinary queue landing'),
      `status=${overRun.status} out=${overRun.out.slice(0, 400)}`);
    assert('and-the-flag-values-never-leak-into-the-path-list',
      overRun.out.includes('0 of 1 path(s) hit the register'), overRun.out.slice(0, 200));
    const atRun = run('--test', 'src/a.ts', '--additions', String(HUMAN_MERGE_LINE_THRESHOLD), '--deletions', '0');
    assert('and-exactly-3000-exits-0-the-threshold-is-strictly-greater',
      atRun.status === EXIT_TEST_NOT_GOVERNED && atRun.out.includes('under the human-merge threshold'), `status=${atRun.status} out=${atRun.out.slice(0, 300)}`);
    const jsonRun = run('--test', 'src/a.ts', '--additions', '3001', '--deletions', '0', '--json');
    let jsonBody = null;
    try { jsonBody = JSON.parse(jsonRun.out); } catch { /* asserted below */ }
    assert('--json-carries-governed-false-humanMerge-true-and-the-size-block',
      jsonRun.status === EXIT_TEST_GOVERNED && jsonBody?.governed === false && jsonBody?.humanMerge === true && jsonBody?.size?.exceeds === true &&
        jsonBody?.size?.changedLines === 3001, jsonRun.out.slice(0, 300));
    const noneRun = run('--test', 'src/a.ts');
    assert('--test-with-no-size-flags-still-answers-the-path-question-and-prints-NOT-MEASURED-on-stdout',
      noneRun.status === EXIT_TEST_NOT_GOVERNED && noneRun.out.includes('NOT MEASURED'), `status=${noneRun.status} out=${noneRun.out.slice(0, 300)}`);
    assert('and-the-caller-sized-note-travels-on-stderr-only-when-the-flags-were-given',
      sameNumbers.err.includes('came from the CALLER (--additions') && !noneRun.err.includes('came from the CALLER (--additions') && !sameNumbers.out.includes('CALLER'),
      sameNumbers.err.slice(0, 300));
    const halfRun = run('--test', 'src/a.ts', '--additions', '5001');
    assert('one-size-flag-is-bad-args-exit-1-and-no-verdict',
      halfRun.status === EXIT_CANNOT_SWEEP && halfRun.err.includes('travel together') && !halfRun.out.includes('governed-surface predicate'),
      `status=${halfRun.status} err=${halfRun.err.slice(0, 200)}`);
    const twoReadings = run('--branch', 'feature', '--root', repo, '--additions', '1', '--deletions', '1');
    assert('--branch-with-the-flags-is-two-readings-of-one-number-and-is-refused',
      twoReadings.status === EXIT_CANNOT_SWEEP && twoReadings.err.includes('two readings') && !twoReadings.out.includes('governed-surface predicate'),
      `status=${twoReadings.status} err=${twoReadings.err.slice(0, 200)}`);
  } finally {
    rmSync(sizeFx, { recursive: true, force: true });
  }

  // ── ⭐ the FORK predicate (maintainer ruling 2026-09-21) — header section "The FORK predicate" ──
  battery('⭐ the FORK predicate: head repo ≠ base repo is a proposal, never a delivery');
  const pullFrom = (headRepo, sha = 'feedface0001') => ({ head: { sha, repo: headRepo === null ? null : { full_name: headRepo } }, base: { repo: { full_name: 'o/r' } } });
  const forkOf = (headRepo) => forkVerdict(pullFrom(headRepo));
  const wordsOf = (paths, intake) => renderTestVerdict(testVerdict(paths, { repo: REPO, ...intake }));
  const forkPlain = testVerdict(['packages/spec/src/index.ts'], { repo: REPO, fork: forkOf('someone/r') });
  const forkWords = renderTestVerdict(forkPlain);
  assert('⭐ a-fork-head-on-ordinary-paths-is-NOT-governed-by-path-and-lands-by-HUMAN-MERGE-on-the-fork-limb-the-GOVERNED-exit-with-the-fork-sentence-a-PROPOSAL-never-a-delivery-adopted-onto-an-internal-branch',
    forkPlain.governed === false && forkPlain.fork.measured === true && forkPlain.fork.isFork === true && forkPlain.humanMerge === true && landsByHumanMerge(forkPlain) === true &&
      forkWords.includes('FORK PR — head someone/r ≠ base o/r') && forkWords.includes('PROPOSAL, never a delivery') && forkWords.includes('arms auto-merge') && forkWords.includes('approves it') &&
      forkWords.includes('Co-authored-by') && forkWords.includes('HEAD REPO decides') && !forkWords.includes('ordinary queue landing applies'), forkWords);
  assert('⭐ head.repo-null-a-deleted-fork-is-a-FORK-fail-closed',
    forkOf(null).isFork === true && landsByHumanMerge(testVerdict(['x.ts'], { repo: REPO, fork: forkOf(null) })) && wordsOf(['x.ts'], { fork: forkOf(null) }).includes('(deleted fork repo) ≠ base o/r'), wordsOf(['x.ts'], { fork: forkOf(null) }));
  const sameRepo = wordsOf(['packages/spec/src/index.ts'], { fork: forkOf('o/r'), size: { additions: 1, deletions: 0 } });
  assert('a-same-repo-head-on-ordinary-paths-is-unchanged-NOT-governed-ordinary-queue-landing-and-no-fork-line',
    forkOf('o/r').isFork === false && forkOf('o/r').measured === true && landsByHumanMerge(testVerdict(['x.ts'], { repo: REPO, fork: forkOf('o/r') })) === false && sameRepo.includes('ordinary queue landing applies') && !sameRepo.includes('head repo') && !sameRepo.includes('FORK'), sameRepo);
  const forkTierOf = (path, headRepo) => testVerdict([path], { repo: REPO, fork: forkOf(headRepo) });
  const S_PATH = '.claude/agents/os-dev.md';
  assert('a-same-repo-governed-head-keeps-its-tier-H-or-S-word-for-word-while-a-fork-head-on-a-Tier-S-path-still-prints-the-fork-sentence-the-seat-adopts-it-never-lands-it',
    forkTierOf('AGENTS.md', 'o/r').tier === GOVERNED_TIER_H && !wordsOf(['AGENTS.md'], { fork: forkOf('o/r') }).includes('FORK') && wordsOf(['AGENTS.md'], { fork: forkOf('o/r') }).includes('H(人合)') &&
      forkTierOf(S_PATH, 'o/r').tier === GOVERNED_TIER_S && wordsOf([S_PATH], { fork: forkOf('o/r') }).includes('Tier S') && !wordsOf([S_PATH], { fork: forkOf('o/r') }).includes('head repo') &&
      forkTierOf(S_PATH, 'someone/r').tier === GOVERNED_TIER_S && forkTierOf(S_PATH, 'someone/r').humanMerge === true && wordsOf([S_PATH], { fork: forkOf('someone/r') }).includes('FORK PR'), wordsOf([S_PATH], { fork: forkOf('someone/r') }));
  const zeroChecks = wordsOf(['src/x.ts'], { fork: forkOf('someone/r'), checks: { sha: 'feedface0001', total: 0, reason: null } });
  assert('⭐ ZERO-check-runs-on-the-head-read-NOT-MEASURED-never-green-a-head-whose-checks-ran-prints-no-such-line-an-unread-count-is-NOT-MEASURED-too-and-so-is-a-fork-limb-with-no-PR-object',
    forkVerdict(null).measured === false && forkVerdict(null).isFork === false && forkVerdict({}).measured === false && wordsOf(['src/x.ts']).includes('head repo: NOT MEASURED') &&
      zeroChecks.includes('check runs on head feedface00: 0 — NOT MEASURED, never green') && zeroChecks.includes('No seat approves it to run') && !wordsOf(['src/x.ts'], { checks: { sha: 'a', total: 43, reason: null } }).includes('check runs') && wordsOf(['src/x.ts'], { checks: { sha: 'a', total: null, reason: 'HTTP 403' } }).includes('NOT READ (HTTP 403)'), zeroChecks);
  const respondWith = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
  const forkWalk = await fetchPullFiles({ apiUrl: 'https://api', slug: 'o/r', pull: 1, channels: [{ id: 'fixture', name: 'fixture channel', headers: {} }],
    fetchImpl: async (url) => (/\/files/.test(url) ? respondWith([{ filename: 'src/a.ts', status: 'modified' }]) : /\/commits\/feedface0001\/check-runs/.test(url) ? respondWith({ total_count: 0 })
      : respondWith({ changed_files: 1, additions: 1, deletions: 0, ...pullFrom('someone/r') })) });
  assert('⭐ --pr-reads-the-head-repo-off-its-own-GET-and-the-check-run-count-off-the-head-sha-on-the-same-channel',
    forkWalk.ok === true && forkWalk.fork.isFork === true && forkWalk.fork.headRepo === 'someone/r' && forkWalk.checks.total === 0 && forkWalk.checks.sha === 'feedface0001', JSON.stringify({ fork: forkWalk.fork, checks: forkWalk.checks }));

  // ── ⭐ #19036: the sweep lists an OVERSIZED landing beside the governed ones ─
  //
  // The queue half of #19036 lives in the guard; this is the audit half. Until
  // now the sweep classified on the PATH register alone, so PR #18971's shape
  // — over the line, nothing governed — was invisible to the after-the-fact
  // list as well as to the queue. The size is read LOCALLY off the landed
  // diff, on the same `git diff-tree` that lists the commit's paths: the
  // attribution GET is paid only for a row that is already an entry, so no
  // read of the API could ever have made one.
  battery('⭐ #19036: the sweep lists an OVERSIZED landing beside the governed ones');
  const LINE = HUMAN_MERGE_LINE_THRESHOLD;
  const commitAt = (sha, subject) => ({ sha, date: '2026-09-19T00:00:00Z', subject });
  const bigPlain = classifyCommit(commitAt('1'.repeat(40), 'chore(spec): regenerate (#18971)'), ['packages/spec/api-surface/x.json'], GOVERNED_REPOS[0], { additions: 238310, deletions: 119 });
  assert('⭐ an-oversized-landing-with-NO-governed-path-is-a-sweep-ENTRY-on-the-size-limb-alone',
    bigPlain !== null && bigPlain.surfaces.length === 0 && bigPlain.size.exceeds === true && bigPlain.size.changedLines === 238429 && bigPlain.humanMerge === true && bigPlain.pr === 18971,
    JSON.stringify(bigPlain));
  assert('⭐ exactly-the-threshold-is-NOT-listed-the-comparison-is-strictly-greater',
    classifyCommit(commitAt('2'.repeat(40), 'x (#2)'), ['packages/x.ts'], GOVERNED_REPOS[0], { additions: LINE, deletions: 0 }) === null &&
      classifyCommit(commitAt('2'.repeat(40), 'x (#2)'), ['packages/x.ts'], GOVERNED_REPOS[0], { additions: LINE - 1, deletions: 1 }) === null);
  assert('threshold-plus-one-IS-listed-additions-PLUS-deletions',
    classifyCommit(commitAt('3'.repeat(40), 'x (#3)'), ['packages/x.ts'], GOVERNED_REPOS[0], { additions: LINE, deletions: 1 })?.size.exceeds === true);
  assert('an-ungoverned-landing-with-NO-size-reading-is-still-not-an-entry-unmeasured-never-lists',
    classifyCommit(commitAt('4'.repeat(40), 'x (#4)'), ['packages/x.ts'], GOVERNED_REPOS[0]) === null);
  const govSmall = classifyCommit(commitAt('5'.repeat(40), 'docs: a (#5)'), ['AGENTS.md'], GOVERNED_REPOS[0], { additions: 10, deletions: 2 });
  assert('a-governed-merge-under-the-line-is-listed-as-before-and-now-carries-its-measured-size',
    govSmall !== null && govSmall.surfaces.length === 1 && govSmall.size.measured === true && govSmall.size.exceeds === false && govSmall.size.changedLines === 12,
    JSON.stringify(govSmall?.size));
  const govLegacy = classifyCommit(commitAt('6'.repeat(40), 'docs: a (#6)'), ['AGENTS.md'], GOVERNED_REPOS[0]);
  assert('a-governed-merge-classified-with-NO-size-keeps-its-entry-shape-and-says-NOT-MEASURED',
    govLegacy !== null && govLegacy.surfaces[0].id === 'agents-md' && govLegacy.size.measured === false && govLegacy.humanMerge === true);
  const govBig = classifyCommit(commitAt('7'.repeat(40), 'docs: b (#7)'), ['AGENTS.md', 'packages/x.ts'], GOVERNED_REPOS[0], { additions: LINE + 5, deletions: 0 });
  assert('a-governed-AND-oversized-landing-is-ONE-entry-carrying-both-limbs', govBig.surfaces.length === 1 && govBig.size.exceeds === true);
  // ⚠️ Every pin below that reads a classified entry guards the null first: under
  // the landing PR's ablation (the comparison inverted in `sizeVerdict`) the
  // oversized fixture classifies to NOTHING, and a pin that dereferenced it
  // would abort the whole run with a TypeError — a self-test that crashes hides
  // every other failure it had already collected. A red case must be a NAMED one.
  assert('⭐ classifyCommit-IS-the-landed-predicate-landsByHumanMerge-on-testVerdict-never-a-restated-comparison',
    [bigPlain, govSmall, govLegacy, govBig].every((e) => e !== null && landsByHumanMerge(testVerdict(e.surfaces.flatMap((s) => s.files), { repo: REPO, size: e.size.measured ? e.size : null })) === true));
  // The report an operator reads.
  const bigEntry = bigPlain === null
    ? null
    : { ...bigPlain, attribution: { mergedBy: 'os-elon-musk', mergedAt: '2026-09-18T09:00:00Z', title: 'x', size: { additions: 238310, deletions: 119 } }, attributionChannel: 'rest' };
  const bigReport = bigEntry === null ? '' : renderReport({ window: dateWindowFor('2026-09-18T00:00:00Z'), repos: allAudited, scanned: 3, entries: [bigEntry], lookups: 1 });
  assert('⭐ the-head-counts-the-oversized-landing-APART-from-the-governed-merges',
    bigReport.includes('governed-merges sweep: 0 governed merge(s) and 1 oversized landing(s) with no governed path since'), bigReport);
  assert('and-the-row-names-the-PR-the-number-the-threshold-the-limb-and-the-HUMAN-MERGE-it-was-due',
    bigReport.includes('PR #18971') && bigReport.includes('⛔ SIZE: 238429 changed line(s) (+238310 / -119)') && bigReport.includes(`EXCEEDS the human-merge line ${LINE}`) &&
      bigReport.includes('generated files INCLUDED') && bigReport.includes('HUMAN MERGE') && bigReport.includes('listed on that limb ALONE') &&
      bigReport.includes('surfaces: (none — listed on SIZE alone)'),
    bigReport);
  assert('and-still-carries-the-attribution-column-the-audit-asks-of-every-row', bigReport.includes('merged_by os-elon-musk'), bigReport);
  assert('and-a-GitHub-pair-EQUAL-to-the-landed-number-prints-nothing-extra', !bigReport.includes('GitHub reports'), bigReport);
  const skewed = bigEntry === null
    ? ''
    : renderReport({
        window: dateWindowFor('2026-09-18T00:00:00Z'), repos: allAudited, scanned: 3, lookups: 1,
        entries: [{ ...bigEntry, attribution: { ...bigEntry.attribution, size: { additions: 238000, deletions: 119 } } }],
      });
  assert('a-GitHub-pair-that-DIFFERS-from-the-landed-number-is-printed-beside-it-and-decides-nothing', skewed.includes('GitHub reports +238000 / -119') && skewed.includes('⛔ SIZE: 238429'), skewed);
  const smallReport = renderReport({ window: dateWindowFor('2026-09-18T00:00:00Z'), repos: allAudited, scanned: 3, entries: [govSmall], lookups: 0 });
  assert('a-governed-row-under-the-line-keeps-its-head-byte-for-byte-and-prints-its-size-as-a-plain-reading',
    smallReport.includes('governed-merges sweep: 1 governed merge(s) since') && !smallReport.includes('oversized') &&
      smallReport.includes(`size: 12 changed line(s) (+10 / -2), at or under ${LINE}`) && !smallReport.includes('⛔ SIZE'),
    smallReport);
  const bothReport = renderReport({ window: dateWindowFor('2026-09-18T00:00:00Z'), repos: allAudited, scanned: 3, entries: [govBig], lookups: 0 });
  assert('a-governed-AND-oversized-row-counts-as-a-governed-merge-and-carries-the-SIZE-line-as-well-as-the-register',
    bothReport.includes('governed-merges sweep: 1 governed merge(s) since') && bothReport.includes('⛔ SIZE') && bothReport.includes('as well as on the register') && bothReport.includes('AGENTS.md'),
    bothReport);
  const legacyReport = renderReport({ window: dateWindowFor('2026-09-18T00:00:00Z'), repos: allAudited, scanned: 1, entries: [govLegacy], lookups: 0 });
  assert('a-row-classified-with-NO-size-prints-NO-size-line-so-the-pre-19036-fixtures-render-as-they-did',
    sizeCell(govLegacy) === '' && !legacyReport.includes('\n      size:') && !legacyReport.includes('⛔ SIZE'), legacyReport);
  assert('the-clean-window-line-now-says-the-size-was-checked-too', clean.includes(`no landing crossed ${LINE} changed lines`) && clean.includes('✅'), clean);
  assert('and-the-contract-lines-state-the-size-limb-on-every-sweep', clean.includes('listed too, on SIZE') && bigReport.includes('listed too, on SIZE'));
  // The LANDED diff, read locally: one `git diff-tree --numstat` per mainline
  // commit — paths AND size, zero API — on a real repository, then the CLI end
  // to end on a checkout that claims to be a governed repo (the banner
  // fixture's own recipe), attribution offline.
  const overFx = mkdtempSync(join(tmpdir(), 'governed-merges-oversized-'));
  try {
    const og = (cwd, ...rest) =>
      execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...rest],
        { cwd, encoding: 'utf8', env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const seed = join(overFx, 'seed');
    og(overFx, 'init', '-q', seed);
    for (const [msg, ago] of [['chore: forty days ago', 40], ['chore: thirty-five days ago', 35]]) {
      const when = new Date(Date.now() - ago * 86_400_000).toISOString();
      execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', msg], {
        cwd: seed, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...gitFreeEnv(), GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when },
      });
    }
    const lines = (n) => `${Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')}\n`;
    mkdirSync(join(seed, 'packages'), { recursive: true });
    writeFileSync(join(seed, 'README.md'), 'a\nb\nc\n');
    og(seed, 'add', '-A');
    og(seed, 'commit', '-qm', 'chore: seed (#1)');
    writeFileSync(join(seed, 'packages', 'at.txt'), lines(LINE)); // exactly the line: NOT listed
    og(seed, 'add', '-A');
    og(seed, 'commit', '-qm', 'feat: exactly at the line (#3000)');
    writeFileSync(join(seed, 'packages', 'over.txt'), lines(LINE + 1)); // one over, plus a binary at 0: LISTED
    writeFileSync(join(seed, 'packages', 'blob.bin'), Buffer.from([0, 1, 2, 3, 0]));
    og(seed, 'add', '-A');
    og(seed, 'commit', '-qm', 'feat: one over the line (#3001)');
    og(seed, 'checkout', '-q', '-b', 'topic'); // a MERGE commit: first-parent diff = the branch's whole change
    writeFileSync(join(seed, 'README.md'), 'a\nc\n'); // -1
    writeFileSync(join(seed, 'packages', 'topic.txt'), 'x\ny\n'); // +2
    og(seed, 'add', '-A');
    og(seed, 'commit', '-qm', 'feat: topic');
    og(seed, 'checkout', '-q', 'main');
    og(seed, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from topic', 'topic');
    const shaOf = (ref) => og(seed, 'rev-parse', ref).trim();
    const overSha = shaOf('main~1');
    const atSha = shaOf('main~2');
    const mergeSha = shaOf('main');
    const overRead = commitChanges(seed, overSha);
    assert('⭐ commitChanges-reads-paths-AND-size-off-ONE-numstat-binary-at-zero',
      overRead.paths.join() === 'packages/blob.bin,packages/over.txt' && overRead.size.additions === LINE + 1 && overRead.size.deletions === 0 &&
        overRead.size.binaryFiles === 1 && overRead.size.files === 2,
      JSON.stringify(overRead));
    const nameOnly = og(seed, 'diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-only', '-z', '-m', '--first-parent', overSha).split('\0').filter((p) => p !== '');
    assert('and-its-path-list-equals-the-pre-19036-name-only-reading-byte-for-byte', JSON.stringify(overRead.paths) === JSON.stringify(nameOnly), JSON.stringify(nameOnly));
    const mergeRead = commitChanges(seed, mergeSha);
    assert('a-MERGE-commit-is-read-against-its-FIRST-parent-the-whole-branch-change',
      mergeRead.paths.join() === 'README.md,packages/topic.txt' && mergeRead.size.additions === 2 && mergeRead.size.deletions === 1, JSON.stringify(mergeRead));
    const atRead = commitChanges(seed, atSha);
    assert('the-at-threshold-commit-classifies-to-nothing-and-the-over-by-one-to-an-entry-on-the-LANDED-diff',
      classifyCommit({ sha: atSha, date: 'd', subject: 'feat: exactly at the line (#3000)' }, atRead.paths, GOVERNED_REPOS[2], atRead.size) === null &&
        classifyCommit({ sha: overSha, date: 'd', subject: 'feat: one over the line (#3001)' }, overRead.paths, GOVERNED_REPOS[2], overRead.size)?.size.exceeds === true,
      JSON.stringify(atRead.size));
    const bare = join(overFx, 'live.git');
    og(overFx, 'clone', '-q', '--bare', seed, bare);
    const co = join(overFx, 'co');
    og(overFx, 'clone', '-q', bare, co);
    og(co, 'remote', 'set-url', 'origin', 'https://github.com/objectstack-ai/cloud');
    og(co, 'config', `url.${bare}.insteadOf`, 'https://github.com/objectstack-ai/cloud');
    const overEnv = { ...process.env, [PROXY_REARM_GUARD]: '1', GITHUB_API_URL: 'http://127.0.0.1:1' };
    const sweepRun = spawnSync(process.execPath, [scriptPath, '--repos', 'cloud', '--repo-root', `cloud=${co}`], { encoding: 'utf8', env: overEnv });
    const sweepOut = sweepRun.stdout ?? '';
    assert('⭐ a-REAL-sweep-LISTS-the-over-by-one-landing-on-the-size-limb-and-NOT-the-at-threshold-one',
      sweepOut.includes('PR #3001') && sweepOut.includes('⛔ SIZE') && sweepOut.includes(`${LINE + 1} changed line(s) (+${LINE + 1} / -0)`) &&
        !sweepOut.includes('PR #3000') && !sweepOut.includes('PR #7') && sweepOut.includes('1 oversized landing(s) with no governed path'),
      `status=${sweepRun.status} out=${sweepOut.slice(0, 900)} err=${(sweepRun.stderr ?? '').slice(0, 300)}`);
    assert('and-attributes-it-like-any-row-so-an-offline-attribution-still-marks-the-sweep-INCOMPLETE',
      sweepRun.status === EXIT_INCOMPLETE && sweepOut.includes('attribution unavailable'), `status=${sweepRun.status}`);
    const jsonRun = spawnSync(process.execPath, [scriptPath, '--repos', 'cloud', '--repo-root', `cloud=${co}`, '--json'], { encoding: 'utf8', env: overEnv });
    let jsonBody = null;
    try { jsonBody = JSON.parse(jsonRun.stdout); } catch { /* asserted below */ }
    assert('and---json-carries-the-entry-with-its-size-block-and-an-empty-surface-list',
      jsonBody?.entries?.length === 1 && jsonBody.entries[0].pr === 3001 && jsonBody.entries[0].surfaces.length === 0 &&
        jsonBody.entries[0].size.exceeds === true && jsonBody.entries[0].size.changedLines === LINE + 1,
      (jsonRun.stdout ?? '').slice(0, 400));
  } catch (error) {
    // ⛔ Never a silent skip: an environment that cannot run this leaves the
    // audit half of #19036 unpinned, and that must read as red.
    assert('the-oversized-sweep-fixture-could-be-built-and-run', false, String(error?.message ?? error).split('\n')[0]);
  } finally {
    rmSync(overFx, { recursive: true, force: true });
  }

  // ── ⭐ #30718: a RENAMED file counts by its rename-aware numstat ──────────
  //
  // The threshold's authority is GitHub's additions + deletions, which pair a
  // moved file and count its content change. With `--no-renames` a move read
  // as a whole delete plus a whole add (PR #30594: 4324 against GitHub's
  // 1806). On a real repo: a 400-line file moved with ONE line edited counts
  // +1 / -1 over ONE file through --branch and through the sweep's
  // commitChanges, while both paths still reach the PATH list.
  const renFx = mkdtempSync(join(tmpdir(), 'governed-merges-rename-size-'));
  try {
    const rg = (cwd, ...rest) =>
      execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...rest],
        { cwd, encoding: 'utf8', env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const repo = join(renFx, 'repo');
    rg(renFx, 'init', '-q', repo);
    rg(repo, 'config', 'diff.renames', 'false'); // a config that turns rename detection off must not reach the size read
    const body = Array.from({ length: 400 }, (_, i) => `line ${i}`);
    mkdirSync(join(repo, 'old'), { recursive: true });
    writeFileSync(join(repo, 'old', 'moved.txt'), `${body.join('\n')}\n`);
    rg(repo, 'add', '-A');
    rg(repo, 'commit', '-qm', 'chore: seed');
    rg(repo, 'update-ref', 'refs/remotes/origin/main', rg(repo, 'rev-parse', 'main').trim());
    rg(repo, 'checkout', '-q', '-b', 'feature');
    mkdirSync(join(repo, 'new'), { recursive: true });
    rg(repo, 'mv', 'old/moved.txt', 'new/moved.txt');
    body[7] = 'line seven, edited';
    writeFileSync(join(repo, 'new', 'moved.txt'), `${body.join('\n')}\n`);
    rg(repo, 'add', '-A');
    rg(repo, 'commit', '-qm', 'refactor: move the file (#30718)');
    rg(repo, 'checkout', '-q', 'main');
    const control = parseNumstat(rg(repo, 'diff', '--numstat', '--no-renames', 'main', 'feature'));
    assert('the-rename-fixture-is-a-real-rename-the---no-renames-control-reads-a-whole-delete-plus-a-whole-add',
      control.additions === 400 && control.deletions === 400 && control.files === 2, JSON.stringify(control));
    const renamed = deriveBranchPaths({ ref: 'feature', run: (argv) => tryGit(repo, argv) });
    assert('⭐ #30718 --branch-counts-a-renamed-file-by-its-rename-aware-numstat-plus-1-minus-1-over-ONE-file',
      renamed.ok === true && renamed.size.additions === 1 && renamed.size.deletions === 1 && renamed.size.files === 1,
      JSON.stringify(renamed.size ?? renamed));
    assert('and-the-PATH-list-still-carries-BOTH-paths-of-the-rename',
      renamed.ok === true && renamed.paths.join() === 'new/moved.txt,old/moved.txt', JSON.stringify(renamed.paths));
    assert('and-the-branch-reading-names-the-rename-aware-read',
      renderDerivation(renamed.derivation).includes('`git diff --numstat -M`'), renderDerivation(renamed.derivation));
    const landed = commitChanges(repo, rg(repo, 'rev-parse', 'feature').trim());
    assert('⭐ #30718 the-sweep-counts-the-same-landed-rename-plus-1-minus-1-and-lists-BOTH-paths',
      landed.size.additions === 1 && landed.size.deletions === 1 && landed.size.files === 1 &&
        landed.paths.join() === 'new/moved.txt,old/moved.txt',
      JSON.stringify(landed));
  } catch (error) {
    assert('the-rename-size-fixture-could-be-built-and-run', false, String(error?.message ?? error).split('\n')[0]);
  } finally {
    rmSync(renFx, { recursive: true, force: true });
  }

  // ⛔ #33620: governed paths git would C-quote, read through REAL git with a GIT_*-free environment (gitFreeEnv):
  // a non-ASCII name and a name holding a newline. Without `-z` each path list (--branch, the sweep's
  // commitChanges, the workflow split's ls-tree) spells them `"skills/a/\346\226\207\346\241\243.md"` and
  // `"skills/a/two\nlines.md"`, which match no governed prefix. `core.quotePath=true` is pinned on the command line:
  // gitFreeEnv strips GIT_* but not a user or system gitconfig, and `core.quotePath=false` there spells the non-ASCII
  // names raw, which reds the CONTROL witness below.
  const quotedFx = mkdtempSync(join(tmpdir(), 'governed-merges-quoted-paths-'));
  try {
    const fg = (cwd, ...rest) =>
      execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'core.quotePath=true', ...rest],
        { cwd, encoding: 'utf8', env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const repo = join(quotedFx, 'repo');
    fg(quotedFx, 'init', '-q', repo);
    const CJK = 'skills/a/\u6587\u6863.md';
    const NL = 'skills/a/two\nlines.md';
    const WFQ = `${WORKFLOWS_PREFIX}caf\u00e9.yml`;
    const wf = (minutes) => `name: Q\non:\n  pull_request:\njobs:\n  q:\n    runs-on: ubuntu-latest\n    timeout-minutes: ${minutes}\n    steps:\n      - run: echo q\n`;
    mkdirSync(join(repo, WORKFLOWS_PREFIX), { recursive: true });
    writeFileSync(join(repo, WFQ), wf(10));
    writeFileSync(join(repo, 'README.md'), 'seed\n');
    fg(repo, 'add', '-A');
    fg(repo, 'commit', '-qm', 'chore: seed');
    const qBase = fg(repo, 'rev-parse', 'HEAD').trim();
    fg(repo, 'update-ref', 'refs/remotes/origin/main', qBase);
    fg(repo, 'checkout', '-q', '-b', 'feature');
    mkdirSync(join(repo, 'skills/a'), { recursive: true });
    writeFileSync(join(repo, CJK), 'wording\n');
    writeFileSync(join(repo, NL), 'wording\n');
    writeFileSync(join(repo, WFQ), wf(20));
    fg(repo, 'add', '-A');
    fg(repo, 'commit', '-qm', 'docs(skills): names git quotes (#7)');
    const qHead = fg(repo, 'rev-parse', 'HEAD').trim();
    const want = [CJK, NL, WFQ].sort().join('|');
    const governedOf = (paths) => governedPathsIn(paths, SELF_REPO_ID).flatMap((surface) => surface.files).sort().join('|');
    // The witness that the fixture exercises the quoting at all: the same list without `-z` spells no name raw.
    const quoted = fg(repo, 'diff', '--name-only', '--no-renames', qBase, qHead).split('\n').filter(Boolean);
    assert('⛔ #33620 CONTROL the-fixture-names-are-ones-git-C-quotes-without--z',
      quoted.length === 3 && quoted.every((p) => p.startsWith('"')) && governedOf(quoted) === '', JSON.stringify(quoted));
    const fRun = (argv) => {
      try {
        return { ok: true, out: fg(repo, ...argv).trim(), error: '' };
      } catch (error) {
        return { ok: false, out: '', error: String(error?.stderr || error?.message || error).trim().split('\n')[0] };
      }
    };
    const qBranch = deriveBranchPaths({ ref: 'feature', run: fRun });
    assert('⛔ #33620 --branch-reads-a-non-ASCII-and-a-newline-path-raw-and-each-is-GOVERNED',
      qBranch.ok === true && [...qBranch.paths].sort().join('|') === want && governedOf(qBranch.paths) === want, JSON.stringify(qBranch.paths ?? qBranch));
    const qLanded = withoutGitEnv(() => commitChanges(repo, qHead));
    assert('⛔ #33620 the-sweep-commitChanges-reads-the-same-paths-raw-and-each-is-GOVERNED',
      [...qLanded.paths].sort().join('|') === want && governedOf(qLanded.paths) === want && qLanded.size.files === 3, JSON.stringify(qLanded));
    const qWorkflow = readWorkflowDiff({ paths: qBranch.paths ?? [], base: qBase, head: qHead, git: (argv) => fg(repo, ...argv) });
    const qFile = qWorkflow.files?.[0];
    assert('⛔ #33620 the-workflow-split-lists-a-non-ASCII-workflow-at-BOTH-commits-and-classifies-the-edit',
      qWorkflow.measured === true && qWorkflow.files.length === 1 && qFile.path === WFQ &&
        !qFile.reasons.some((r) => /absent at both|new workflow file|deleted workflow file/.test(r)),
      JSON.stringify(qWorkflow));
  } catch (error) {
    assert('#33620 the-quoted-path-fixture-could-be-built-and-run', false, String(error?.message ?? error).split('\n')[0]);
  } finally {
    rmSync(quotedFx, { recursive: true, force: true });
  }

  // ── ⭐ #18055: the INCOMPLETE banner is BUILT, never thrown away ──────────
  //
  // The banner is assembled inside the ARGUMENT of the call that prints it, and
  // `main()` read the re-arm plan's `hint` off a binding that scope never
  // had. An argument that throws means the call never happens: the measured
  // consequence was not a survivable crash but a DELETED WARNING — 11 governed
  // rows, a complete-looking attribution note, and no incompleteness banner on
  // either stream, with the `return EXIT_INCOMPLETE` behind it never reached.
  //
  // The three pre-existing re-arm assertions were green throughout, because all
  // three call `proxyRearmPlan` directly and none of them reaches the banner.
  // Measured on this branch, on a copy of the file: with the `attributionFailed`
  // branch made to throw unconditionally, the whole battery still passed — 317
  // assertions, exit 0. So these cases drive the BANNER: offline through the
  // function that owns it, and end to end through a real sweep whose every
  // attribution channel fails.
  battery('⭐ #18055: the INCOMPLETE banner is BUILT, never thrown away');
  const hintPlan = proxyRearmPlan({ env: { HTTPS_PROXY: 'http://proxy.invalid:8080' }, flagSupported: false });
  const noHintPlan = proxyRearmPlan({ env: {} });
  assert('the-fixture-plans-are-the-REAL-planners-output-not-a-hand-built-shape',
    hintPlan.hint === true && noHintPlan.hint === false, JSON.stringify([hintPlan, noHintPlan]));
  const bannerOf = (state, rearm) => {
    const lines = [];
    const code = reportSweepIncomplete(
      { unaudited: [], edged: [], attributionFailed: false, ...state, rearm },
      (line) => lines.push(line),
    );
    return { code, text: lines.join('\n'), calls: lines.length };
  };
  const attrOnly = bannerOf({ attributionFailed: true }, noHintPlan);
  assert('the-attribution-failure-path-BUILDS-the-banner-instead-of-throwing-while-building-it',
    attrOnly.calls === 1 && attrOnly.text.includes('sweep INCOMPLETE') &&
      attrOnly.text.includes('at least one entry has no merged_by reading on any channel') &&
      attrOnly.text.includes('must not read as'), JSON.stringify(attrOnly));
  assert('and-it-returns-EXIT_INCOMPLETE-the-return-the-throw-used-to-eat-along-with-the-banner',
    attrOnly.code === EXIT_INCOMPLETE, String(attrOnly.code));
  const attrHinted = bannerOf({ attributionFailed: true }, hintPlan);
  assert('a-plan-that-says-hint-renders-its-reason-and-the-re-run-prescription',
    attrHinted.text.includes(hintPlan.reason) && attrHinted.text.includes(`NODE_OPTIONS=${PROXY_FLAG}`) &&
      attrHinted.text.includes('#9642') && attrHinted.code === EXIT_INCOMPLETE, JSON.stringify(attrHinted));
  assert('and-a-plan-that-does-not-leaves-the-hint-EMPTY-while-the-banner-itself-still-prints',
    !attrOnly.text.includes('bypassing the session proxy') && !attrOnly.text.includes('NODE_OPTIONS=') &&
      attrOnly.text.includes('sweep INCOMPLETE'), attrOnly.text);
  // The `&&` is load-bearing in the other direction too: a hinting plan on a
  // sweep whose attribution SUCCEEDED must print no proxy advice at all.
  const edgeOnly = bannerOf({ unaudited: [{ slug: 'objectstack-ai/cloud', precondition: 'stale-mirror' }] }, hintPlan);
  assert('an-INCOMPLETE-that-is-not-about-attribution-renders-no-proxy-hint-even-on-a-hinting-plan',
    !edgeOnly.text.includes('bypassing the session proxy') && edgeOnly.text.includes('sweep INCOMPLETE') &&
      edgeOnly.code === EXIT_INCOMPLETE, edgeOnly.text);
  const everyReason = bannerOf(
    {
      unaudited: [{ slug: 'objectstack-ai/cloud', precondition: 'stale-mirror' }],
      edged: [{ slug: 'objectstack-ai/objectui' }],
      attributionFailed: true,
    },
    noHintPlan,
  );
  assert('the-banner-names-every-reason-it-was-given-slug-and-precondition-included',
    everyReason.text.includes('objectstack-ai/cloud: stale-mirror') && everyReason.text.includes('WINDOW EDGE') &&
      everyReason.text.includes('at least one entry has no merged_by reading on any channel'), everyReason.text);

  // ⭐ End to end, on the card's own shape: a real sweep, a real governed
  // merge in the window, and attribution that fails on EVERY channel. The
  // assertions above all call the banner directly and would stay green if
  // `main()` stopped reaching it — or reached it with an unbound plan again,
  // which is the defect. This one runs the sweep and reads the streams the
  // operator reads, separately, by capture — ⛔ never through a pipe, which is
  // what turned the measured `exit 1` into a reported `exit 0`.
  const bannerFx = mkdtempSync(join(tmpdir(), 'governed-merges-banner-'));
  try {
    const bg = (cwd, ...rest) =>
      execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...rest], {
        cwd,
        encoding: 'utf8',
        env: gitFreeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const bannerSeed = join(bannerFx, 'seed');
    bg(bannerFx, 'init', '-q', bannerSeed);
    // Two BACKDATED commits so the window's boundary is provable here: without
    // them the run is also INCOMPLETE at the window EDGE, and the case would
    // pass on a reason it is not about.
    for (const [msg, ago] of [['chore: forty days ago', 40], ['chore: thirty-five days ago', 35]]) {
      const when = new Date(Date.now() - ago * 86_400_000).toISOString();
      execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', msg], {
        cwd: bannerSeed, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...gitFreeEnv(), GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when },
      });
    }
    mkdirSync(join(bannerSeed, 'docs', 'adr'), { recursive: true });
    writeFileSync(join(bannerSeed, 'docs', 'adr', '0001-fixture.md'), '# a governed path\n');
    bg(bannerSeed, 'add', '-A');
    bg(bannerSeed, 'commit', '-qm', 'docs(adr): a governed merge the sweep must attribute (#424242)');
    const bannerBare = join(bannerFx, 'live.git');
    bg(bannerFx, 'clone', '-q', '--bare', bannerSeed, bannerBare);
    const bannerCo = join(bannerFx, 'co');
    bg(bannerFx, 'clone', '-q', bannerBare, bannerCo);
    bg(bannerCo, 'remote', 'set-url', 'origin', 'https://github.com/objectstack-ai/cloud');
    bg(bannerCo, 'config', `url.${bannerBare}.insteadOf`, 'https://github.com/objectstack-ai/cloud');
    // Attribution over a port nothing listens on: every channel fails at the
    // transport, offline, in milliseconds. ⛔ Not a 404 — this has to be the
    // every-channel-failed branch, not a resolved reading.
    const bannerEnv = { ...process.env, [PROXY_REARM_GUARD]: '1', GITHUB_API_URL: 'http://127.0.0.1:1' };
    const bannerRun = spawnSync(process.execPath, [scriptPath, '--repos', 'cloud', '--repo-root', `cloud=${bannerCo}`], { encoding: 'utf8', env: bannerEnv });
    const bannerOut = bannerRun.stdout ?? '';
    const bannerErr = bannerRun.stderr ?? '';
    assert('a-sweep-whose-every-attribution-channel-fails-exits-EXIT_INCOMPLETE-not-a-crash',
      bannerRun.status === EXIT_INCOMPLETE, `status=${bannerRun.status} err=${bannerErr.slice(0, 400)}`);
    assert('⭐ and-the-INCOMPLETE-banner-REACHES-STDERR-the-one-thing-the-crash-deleted',
      bannerErr.includes('sweep INCOMPLETE') && bannerErr.includes('at least one entry has no merged_by reading on any channel') &&
        !bannerErr.includes('governed repo(s) unaudited'), `err=${bannerErr.slice(-600)}`);
    assert('with-the-cards-own-positive-controls-on-stdout-rows-and-a-complete-looking-note',
      bannerOut.includes('attribution unavailable') && bannerOut.includes('#424242') && !bannerOut.includes('sweep INCOMPLETE'),
      `out=${bannerOut.slice(0, 600)}`);
    assert('and-nothing-on-either-stream-is-a-ReferenceError',
      !bannerErr.includes('ReferenceError') && !bannerOut.includes('ReferenceError'), `err=${bannerErr.slice(0, 400)}`);
  } catch (error) {
    // ⛔ Never a silent skip: an environment that cannot run this leaves the
    // banner's wiring unpinned, and that must read as red.
    assert('the-banner-end-to-end-fixture-could-be-built-and-run', false, String(error?.message ?? error).split('\n')[0]);
  } finally {
    rmSync(bannerFx, { recursive: true, force: true });
  }

  // ── ⭐ the argv is CLOSED (#21675) ─────────────────────────────────────────
  //
  // Header section "The argv is closed". The pure rows pin the table, the walker
  // and both refusals' words; the end-to-end rows replay the card's own
  // invocation table against a fake API on 127.0.0.1 that RECORDS every read,
  // so each refusal is pinned as exit 1 + the prescription + no verdict +
  // NOTHING READ, and the qualified spelling as the verdict, read from the
  // repository it names. Before this battery, rows 1–3 of that table read
  // objectstack's PR and printed ✅ NOT governed on exit 0.
  battery('⭐ the argv is CLOSED: a flag the mode does not read, or a second repository beside a bare --pr, is refused');
  assert('every-flag-a-modes-usage-line-names-is-a-flag-that-mode-reads',
    Object.values(ARGV_MODES).every((m) => (m.usage.match(/--[a-z][a-z-]*/g) ?? []).every((f) => Object.hasOwn(m.flags, f))),
    JSON.stringify(Object.values(ARGV_MODES).map((m) => m.usage)));
  assert('and-every-mode-the-dispatch-can-select-has-exactly-one-row-the-sweep-included',
    [...PREDICATE_MODES, 'sweep'].every((m) => ARGV_MODES[m] !== undefined) && Object.keys(ARGV_MODES).length === PREDICATE_MODES.length + 1,
    Object.keys(ARGV_MODES).join());
  // Preservation: every argv shape the batteries above spawn still passes —
  // including the size flags beside --branch, whose own older refusal ("two
  // readings") must still be the one that fires.
  const argvPasses = [
    [['--repos', 'cloud', '--repo-root', 'cloud=/x', '--since-ref', 'cloud=abc', '--json'], 'sweep'],
    [['--since', '7d', '--repos', 'objectstack,objectui'], 'sweep'],
    [['--test', 'AGENTS.md', 'src/x.ts', '--additions', '238310', '--deletions', '119', '--json'], '--test'],
    [['--branch', 'claude/issue-17003-x', '--root', '/r', '--additions', '1', '--deletions', '1'], '--branch'],
    [['--branch', '--root', '/r'], '--branch'],
    [['--pr', 'objectstack-ai/objectui#42', '--json'], '--pr'],
    [['--pr', '16997', '--root', '/r'], '--pr'],
  ];
  assert('every-argv-the-modes-already-read-still-passes-the-closed-set',
    argvPasses.every(([a, m]) => argvRefusal(a, m) === null), JSON.stringify(argvPasses.filter(([a, m]) => argvRefusal(a, m) !== null)));
  // …and so does every usage example this file's header spells, read off the
  // header itself: a new example naming a flag the table lacks reds here, so
  // the table and the documented usage cannot drift apart.
  const headerExamples = readFileSync(scriptPath, 'utf8').split('\n').slice(0, 40)
    .filter((line) => line.startsWith(' *   node scripts/pm/check-governed-merges.mjs'))
    .map((line) => line.slice(' *   node scripts/pm/check-governed-merges.mjs'.length).split(/\s+#\s/)[0].trim().split(/\s+/).filter(Boolean))
    .filter((argv) => !argv.includes('--self-test'));
  const headerRefused = headerExamples.filter((argv) => argvRefusal(argv, PREDICATE_MODES.find((m) => argv.includes(m)) ?? 'sweep') !== null);
  assert('every-usage-example-the-header-spells-passes-the-closed-set-and-there-are-at-least-13',
    headerExamples.length >= 13 && headerRefused.length === 0, JSON.stringify({ n: headerExamples.length, headerRefused }));
  const bogusWords = argvRefusal(['--pr', '11590', '--bogus-flag', 'x'], '--pr');
  assert('⭐ an-unknown-flag-is-refused-by-name-never-ignored',
    typeof bogusWords === 'string' && bogusWords.includes('`--bogus-flag` is not a flag --pr reads') && bogusWords.includes('REFUSED, never ignored'),
    String(bogusWords));
  assert('and-the-refusal-carries-the-modes-own-usage-line-and-every-other-modes',
    String(bogusWords).includes(`--pr reads:  ${SELF_COMMAND} ${ARGV_MODES['--pr'].usage}`) &&
      Object.values(ARGV_MODES).every((m) => String(bogusWords).includes(`${SELF_COMMAND} ${m.usage}`)) && String(bogusWords).includes('--self-test'),
    String(bogusWords));
  const reposWords = argvRefusal(['--pr', '11590', '--repos', 'objectui'], '--pr');
  assert('⭐ a-flag-of-ANOTHER-mode-is-refused-too-the-sweeps---repos-beside---pr-was-ignored-the-same-way',
    typeof reposWords === 'string' && reposWords.includes('`--repos` is not a flag --pr reads'), String(reposWords));
  const sinceWords = argvRefusal(['--test', 'src/x.ts', '--since', '7d'], '--test');
  assert('and-a-sweep-flag-beside---test-is-refused-before-its-value-can-join-the-path-list',
    typeof sinceWords === 'string' && sinceWords.includes('`--since` is not a flag --test reads'), String(sinceWords));
  const eqWords = argvRefusal(['--since=7d'], 'sweep');
  assert('an-equals-spelling-is-refused-and-told-the-spelling-the-flag-takes',
    typeof eqWords === 'string' && eqWords.includes('`--since=7d` is not a flag the sweep reads') && eqWords.includes('`--since 7d`'), String(eqWords));
  assert('a-value-flag-followed-by-a-flag-consumes-nothing-so-that-flag-is-still-judged',
    JSON.stringify(unreadFlagsIn(['--pr', '--bogus'], '--pr')) === JSON.stringify(['--bogus']) &&
      JSON.stringify(unreadFlagsIn(['-h'], 'sweep')) === JSON.stringify(['-h']),
    JSON.stringify([unreadFlagsIn(['--pr', '--bogus'], '--pr'), unreadFlagsIn(['-h'], 'sweep')]));
  const repoWords = argvRefusal(['--pr', '11590', '--repo', 'objectstack-ai/objectui'], '--pr');
  assert('⭐ --pr-N---repo-objectui-is-refused-and-prescribes---pr-objectui#N-the-documented-spelling',
    typeof repoWords === 'string' && repoWords.includes('`--repo` is not a flag --pr reads') &&
      repoWords.includes(`${SELF_COMMAND} --pr objectstack-ai/objectui#11590`) && repoWords.includes("answers THIS checkout's own repository"),
    String(repoWords));
  assert('and---repo-is-no-new-spelling-anywhere-a-governed-id-is-spelled-as-its-slug-and-a-qualified---pr-is-told-to-drop-it',
    String(argvRefusal(['--pr', '7', '--repo=objectui'], '--pr')).includes('--pr objectstack-ai/objectui#7') &&
      String(argvRefusal(['--pr', 'objectstack-ai/objectui#7', '--repo', 'objectstack-ai/objectui'], '--pr')).includes('This tool takes no `--repo`') &&
      argvRefusal(['--pr', '7', '--repo', 'objectstack-ai/objectstack'], '--pr') !== null,
    String(argvRefusal(['--pr', '7', '--repo=objectui'], '--pr')));
  const selfSlugFx = 'objectstack-ai/objectstack';
  const bareFx = parsePullTarget('11590', selfSlugFx);
  const envWords = bareTargetRefusal({ raw: '11590', target: bareFx, sweepRepo: 'objectstack-ai/objectui' });
  assert('⭐ PM_SWEEP_REPO-naming-another-repo-refuses-a-bare---pr-and-prescribes-both-qualified-spellings',
    typeof envWords === 'string' && envWords.includes('PM_SWEEP_REPO names objectstack-ai/objectui') &&
      envWords.includes(`${SELF_COMMAND} --pr objectstack-ai/objectui#11590`) && envWords.includes(`${SELF_COMMAND} --pr ${selfSlugFx}#11590`),
    String(envWords));
  assert('while-PM_SWEEP_REPO-naming-this-checkouts-own-repo-in-any-case-blank-or-unset-refuses-nothing',
    bareTargetRefusal({ raw: '11590', target: bareFx, sweepRepo: 'ObjectStack-AI/ObjectStack' }) === null &&
      bareTargetRefusal({ raw: '#11590', target: parsePullTarget('#11590', selfSlugFx), sweepRepo: '  ' }) === null &&
      bareTargetRefusal({ raw: '11590', target: bareFx, sweepRepo: undefined }) === null);
  assert('and-a-qualified---pr-names-its-own-repo-so-PM_SWEEP_REPO-changes-nothing-in-either-direction',
    bareTargetRefusal({ raw: 'objectstack-ai/objectui#11590', target: parsePullTarget('objectstack-ai/objectui#11590', selfSlugFx), sweepRepo: 'objectstack-ai/objectui' }) === null &&
      bareTargetRefusal({ raw: 'objectstack-ai/objectstack#11590', target: parsePullTarget('objectstack-ai/objectstack#11590', selfSlugFx), sweepRepo: 'objectstack-ai/objectui' }) === null);

  // End to end, the card's table. The fake API answers any `/repos/<slug>/…`
  // PR read with one ordinary file and records the URL; a token never leaves
  // this process (both token variables are blanked for the child).
  const argvFx = mkdtempSync(join(tmpdir(), 'cgm-argv-'));
  const apiReads = [];
  const fakeApi = createServer((req, res) => {
    apiReads.push(req.url);
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    const m = /^\/repos\/([^/]+\/[^/]+)\/(?:pulls\/(\d+)(\/files)?|commits\/[0-9a-f]+\/check-runs)$/.exec(path);
    let body = null;
    if (m && m[3]) body = [{ filename: 'src/argv-fixture.ts', status: 'modified' }];
    else if (m && m[2]) body = { number: Number(m[2]), changed_files: 1, additions: 3, deletions: 1, head: { sha: 'f'.repeat(40), repo: { full_name: m[1] } }, base: { repo: { full_name: m[1] } } };
    else if (m) body = { total_count: 1 };
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { message: 'Not Found' }));
  });
  try {
    await new Promise((ok, fail) => {
      fakeApi.once('error', fail);
      fakeApi.listen(0, '127.0.0.1', ok);
    });
    fakeApi.unref();
    const apiUrl = `http://127.0.0.1:${fakeApi.address().port}`;
    // A checkout whose origin IS objectstack, so the bare number's repository is
    // fixed by the fixture rather than by whatever clone runs this.
    const argvRoot = join(argvFx, 'objectstack');
    execFileSync('git', ['init', '-q', argvRoot], { env: gitFreeEnv(), stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/objectstack-ai/objectstack.git'], { cwd: argvRoot, env: gitFreeEnv(), stdio: 'ignore' });
    const runArgv = (argv, env = {}) => new Promise((done) => {
      apiReads.length = 0;
      const child = spawn(process.execPath, [scriptPath, ...argv, '--root', argvRoot], {
        env: {
          ...process.env,
          [PROXY_REARM_GUARD]: '1',
          GITHUB_API_URL: apiUrl,
          GITHUB_TOKEN: '',
          GH_TOKEN: '',
          PM_SWEEP_REPO: '',
          NO_PROXY: '127.0.0.1,localhost',
          no_proxy: '127.0.0.1,localhost',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('error', (e) => done({ status: null, out, err: `${err}${e?.message ?? e}`, reads: [...apiReads] }));
      child.on('close', (status) => done({ status, out, err, reads: [...apiReads] }));
    });
    const said = (r) => `status=${r.status} reads=${JSON.stringify(r.reads)} out=${r.out.slice(0, 300)} err=${r.err.slice(0, 400)}`;
    const bogusRun = await runArgv(['--pr', '11590', '--bogus-flag', 'x']);
    assert('⭐ e2e-pr-N-with-a-bogus-flag-exits-1-names-it-prints-no-verdict-and-READS-NOTHING',
      bogusRun.status === EXIT_CANNOT_SWEEP && bogusRun.err.includes('`--bogus-flag`') && !bogusRun.out.includes('governed-surface predicate') && bogusRun.reads.length === 0,
      said(bogusRun));
    const repoRun = await runArgv(['--pr', '11590', '--repo', 'objectstack-ai/objectui']);
    assert('⭐ e2e-pr-N---repo-objectui-exits-1-prescribes---pr-objectui#N-and-READS-NOTHING',
      repoRun.status === EXIT_CANNOT_SWEEP && repoRun.err.includes('--pr objectstack-ai/objectui#11590') && !repoRun.out.includes('governed-surface predicate') && repoRun.reads.length === 0,
      said(repoRun));
    const envRun = await runArgv(['--pr', '11590'], { PM_SWEEP_REPO: 'objectstack-ai/objectui' });
    assert('⭐ e2e-PM_SWEEP_REPO-objectui-with-a-bare---pr-N-exits-1-prescribes---pr-objectui#N-and-READS-NOTHING',
      envRun.status === EXIT_CANNOT_SWEEP && envRun.err.includes('--pr objectstack-ai/objectui#11590') && !envRun.out.includes('governed-surface predicate') && envRun.reads.length === 0,
      said(envRun));
    const qualifiedRun = await runArgv(['--pr', 'objectstack-ai/objectui#11590']);
    assert('⭐ e2e---pr-objectui#N-answers-as-today-NOT-governed-on-exit-0-every-read-from-objectuis-PR-N',
      qualifiedRun.status === EXIT_TEST_NOT_GOVERNED && qualifiedRun.out.includes('derived from GET /repos/objectstack-ai/objectui/pulls/11590/files') &&
        qualifiedRun.out.includes('NOT governed') && qualifiedRun.reads.length === 3 && qualifiedRun.reads.every((u) => u.startsWith('/repos/objectstack-ai/objectui/')),
      said(qualifiedRun));
    const qualifiedEnvRun = await runArgv(['--pr', 'objectstack-ai/objectui#11590'], { PM_SWEEP_REPO: 'objectstack-ai/objectui' });
    assert('and-PM_SWEEP_REPO-beside-the-qualified-spelling-changes-not-one-byte-of-the-answer',
      qualifiedEnvRun.status === qualifiedRun.status && qualifiedEnvRun.out === qualifiedRun.out && qualifiedEnvRun.out !== '' &&
        JSON.stringify(qualifiedEnvRun.reads) === JSON.stringify(qualifiedRun.reads),
      said(qualifiedEnvRun));
    const ownRun = await runArgv(['--pr', '11590'], { PM_SWEEP_REPO: 'objectstack-ai/objectstack' });
    assert('control-PM_SWEEP_REPO-naming-this-checkouts-own-repo-answers-the-bare-number-from-that-repo',
      ownRun.status === EXIT_TEST_NOT_GOVERNED && ownRun.out.includes('derived from GET /repos/objectstack-ai/objectstack/pulls/11590/files') &&
        ownRun.reads.length === 3 && ownRun.reads.every((u) => u.startsWith('/repos/objectstack-ai/objectstack/')),
      said(ownRun));
    const sinceRun = await runArgv(['--test', 'src/x.ts', '--since', '7d']);
    assert('e2e---test-with-a-sweep-flag-exits-1-and-prints-no-verdict-over-a-path-list-its-value-would-have-joined',
      sinceRun.status === EXIT_CANNOT_SWEEP && sinceRun.err.includes('`--since` is not a flag --test reads') && !sinceRun.out.includes('governed-surface predicate'),
      said(sinceRun));
  } catch (error) {
    // ⛔ Never a silent skip: a fixture that cannot be built leaves the card's
    // table unpinned end to end, and that must read as red.
    assert('the-closed-argv-end-to-end-fixture-could-be-built-and-run', false, String(error?.message ?? error).split('\n')[0]);
  } finally {
    fakeApi.closeAllConnections?.();
    fakeApi.close();
    rmSync(argvFx, { recursive: true, force: true });
  }

  battery('⚖️ #33539: the ADR leg of the low-risk arm — an add-only note lands Tier S, any other ADR change stays H');
  {
    const REPO = 'objectstack';
    const ADR = 'docs/adr/0097-upstream-availability.md';
    const SK = 'skills/objectstack-data/SKILL.md';
    const CS = '.changeset/33539-adr-note.md';
    const CS_TEXT = "---\n'@objectstack/skills': patch\n---\n\nwording\n\nClause-②: no\nMetadata-protocol: none\n";
    const RECORD = ['# ADR-0097: Upstream availability', '', '**Status**: Accepted (2026-07-15)', '', '## Context', '', 'Why.', '', '## Decision', '', '### D1 — refuse', '', 'Refuse it.', '', '## Consequences', '', 'Some.'];
    // A full-context unified diff over `ops` ([' ', text] | ['+', text] | ['-', text]), the shape `addOnlyDiffArgv` reads.
    const patchOf = (ops, path = ADR) => {
      const oldN = ops.filter(([m]) => m !== '+').length;
      const newN = ops.filter(([m]) => m !== '-').length;
      return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,${oldN} +1,${newN} @@\n${ops.map(([m, t]) => `${m}${t}`).join('\n')}\n`;
    };
    const keep = (lines = RECORD) => lines.map((t) => [' ', t]);
    // The note a seat lands: a new section after the last one, a blank line first.
    const NOTE = [...keep(), ['+', ''], ['+', '## Amendment notes'], ['+', ''], ['+', '> **Note (2026-11-15, #1).** The refusal now names its code.']];
    const insertAfter = (index, ...added) => [...keep(RECORD.slice(0, index + 1)), ...added.map((t) => ['+', t]), ...keep(RECORD.slice(index + 1))];
    const adrRow = (patch, over = {}) => ({ path: ADR, status: 'modified', oldMode: '100644', mode: '100644', patch, ...over });
    const read = (paths, catalog, over = {}) => ({
      measured: true, reason: null, paths, body: 'Fixes #1\n\nClause-②: no\nMetadata-protocol: none\n', labels: [],
      timeline: { measured: true, reason: null, events: [] },
      fork: { measured: true, isFork: false, headRepo: 'o/r', baseRepo: 'o/r' },
      changesets: { measured: true, reason: null, files: paths.filter((p) => LOW_RISK_CHANGESET_PATH.test(p)).map((path) => ({ path, text: CS_TEXT })) },
      catalogFiles: { measured: true, reason: null, files: catalog },
      // The arm's record stage, read and favourable (the skills battery pins each piece of it).
      record: { measured: true, reason: null, located: 'found', where: 'PR', id: 9001, carried: null, securityTouching: { state: 'read', value: 'no' } },
      cardLabels: { measured: true, reason: null, card: 1, labels: [], timeline: { measured: true, reason: null, events: [] }, others: { measured: true, reason: null, cards: [] } },
      ...over,
    });
    const tier = (paths, reading, repo = REPO) => governedTierFor(paths, repo, GOVERNED_SURFACES, null, reading);
    const why = (paths, reading) => lowRiskArmVerdict(governedPathsIn(paths, REPO), REPO, reading).reasons.join(' | ');
    const noteOnly = read([ADR], [adrRow(patchOf(NOTE))]);

    // ⭐ Row 1: an add-only note passes — no changeset owed (the record publishes nothing), the verdict says Tier S.
    assert('⭐ ROW-1-an-add-only-ADR-note-on-Clause-2-no-is-Tier-S-with-no-changeset', tier([ADR], noteOnly) === GOVERNED_TIER_S && testVerdict([ADR], { repo: REPO, lowRisk: noteOnly }).tier === GOVERNED_TIER_S, why([ADR], noteOnly));
    assert('⭐ a-note-inserted-under-Context-or-a-note-in-a-quote-under-Consequences-is-Tier-S', [insertAfter(6, '', '> **Note (2026-11-15).** Context grew.'), insertAfter(16, '', '> Note: still true.')].every((ops) => tier([ADR], read([ADR], [adrRow(patchOf(ops))])) === GOVERNED_TIER_S));
    assert('an-ADR-note-beside-its-docs-prose-rider-and-a-skills-wording-change-with-its-changeset-is-Tier-S', tier([ADR, SK, CS, 'docs/agents/x.md'], read([ADR, SK, CS, 'docs/agents/x.md'], [adrRow(patchOf(NOTE)), { path: SK, status: 'modified', oldMode: '100644', mode: '100644' }])) === GOVERNED_TIER_S);
    assert('a-changeset-an-ADR-note-carries-is-still-read-and-held-to-the-catalog-patch-shape', tier([ADR, CS], read([ADR, CS], [adrRow(patchOf(NOTE))])) === GOVERNED_TIER_S && tier([ADR, CS], read([ADR, CS], [adrRow(patchOf(NOTE))], { changesets: { measured: true, reason: null, files: [{ path: CS, text: "---\n'@objectstack/spec': patch\n---\n\nClause-②: no\nMetadata-protocol: none\n" }] } })) === GOVERNED_TIER_H);
    // ⛔ Row 2: a removed line — an edit is a removal plus an addition.
    const edited = patchOf([...keep(RECORD.slice(0, 12)), ['-', 'Refuse it.'], ['+', 'Refuse it loudly.'], ...keep(RECORD.slice(13))]);
    assert('⛔ ROW-2-a-removed-or-edited-line-stays-H', tier([ADR], read([ADR], [adrRow(edited)])) === GOVERNED_TIER_H && /removes 1 line/.test(why([ADR], read([ADR], [adrRow(edited)]))) && tier([ADR], read([ADR], [adrRow(patchOf([...keep(RECORD.slice(0, 16)), ['-', 'Some.']]))])) === GOVERNED_TIER_H);
    // ⛔ Row 3: a changed Status — and an ADDED status line in any spelling, with no removal at all.
    const restatus = patchOf([...keep(RECORD.slice(0, 2)), ['-', RECORD[2]], ['+', '**Status**: Superseded by ADR-0154'], ...keep(RECORD.slice(3))]);
    assert('⛔ ROW-3-a-changed-Status-line-stays-H', tier([ADR], read([ADR], [adrRow(restatus)])) === GOVERNED_TIER_H && /removes 1 line/.test(why([ADR], read([ADR], [adrRow(restatus)]))));
    assert('⛔ an-added-Status-line-bold-bulleted-quoted-tabled-or-in-frontmatter-spelling-stays-H-even-with-no-removal',
      ['**Status**: Amended (2026-11-15)', '- **Status:** Accepted', '> Status: Superseded', '| **Status** | Deprecated |', 'status: superseded'].every((l) => tier([ADR], read([ADR], [adrRow(patchOf(insertAfter(3, l)))])) === GOVERNED_TIER_H) &&
      // In a section that rules nothing too, every spelling the review found: a dash, a link, HTML, a zero-width lead, `Superseded by`.
      ['**Status** — Superseded', '[Status](#x): Superseded', '<b>Status</b>: Superseded', '\u200bStatus: Superseded', '**Superseded by**: ADR-0154', 'Deprecated: yes'].every((l) => /adds a status line/.test(why([ADR], read([ADR], [adrRow(patchOf(insertAfter(16, '', l)))])))));
    // ⛔ Row 4: a line under a Decision heading — nested sub-headings, a blank line and a Decision heading of one's own included.
    assert('⛔ ROW-4-a-line-under-a-Decision-heading-stays-H', tier([ADR], read([ADR], [adrRow(patchOf(insertAfter(12, '', '> **Note.** D1 now also logs.')))])) === GOVERNED_TIER_H && /under `?D1 — refuse`?|under .*Decision/.test(why([ADR], read([ADR], [adrRow(patchOf(insertAfter(12, '', '> **Note.** D1 now also logs.')))]))));
    assert('⛔ a-blank-line-under-Decision-a-new-Decision-heading-or-a-Status-section-stays-H',
      [insertAfter(9, ''), [...keep(), ['+', ''], ['+', '## Decision addendum'], ['+', 'More.']], [...keep(), ['+', ''], ['+', '## Status'], ['+', 'Superseded.']], [...keep(), ['+', ''], ['+', 'Decisions'], ['+', '---'], ['+', 'Setext.']]]
        .every((ops) => tier([ADR], read([ADR], [adrRow(patchOf(ops))])) === GOVERNED_TIER_H));
    // ⛔ Rows 5 and 6: a new ADR file and a rename (read with `--no-renames`, so a delete plus an add) — and a delete.
    const created = { path: 'docs/adr/0200-new.md', status: 'added', oldMode: null, mode: null };
    assert('⛔ ROW-5-a-new-ADR-file-stays-H', tier(['docs/adr/0200-new.md'], read(['docs/adr/0200-new.md'], [created])) === GOVERNED_TIER_H && /added, deleted or renamed/.test(why(['docs/adr/0200-new.md'], read(['docs/adr/0200-new.md'], [created]))));
    const moved = ['docs/adr/0097-upstream-availability.md', 'docs/adr/0097-upstream.md'];
    assert('⛔ ROW-6-a-renamed-or-deleted-ADR-file-stays-H', tier(moved, read(moved, [{ path: moved[0], status: 'deleted', oldMode: '100644', mode: '000000' }, { path: moved[1], status: 'added', oldMode: '000000', mode: '100644' }])) === GOVERNED_TIER_H &&
      tier(moved, read(moved, [{ path: moved[1], status: 'renamed', oldMode: null, mode: null }, { path: moved[0], status: 'renamed', oldMode: null, mode: null }])) === GOVERNED_TIER_H &&
      tier([ADR], read([ADR], [{ path: ADR, status: 'deleted', oldMode: '100644', mode: '000000' }])) === GOVERNED_TIER_H);

    // ⛔ Fail closed: no diff, an unparseable one, several hunks, a short read, a binary, a non-Markdown file.
    assert('⛔ a-modified-ADR-row-with-no-diff-read-stays-H', tier([ADR], read([ADR], [adrRow(null)])) === GOVERNED_TIER_H && /the diff of `docs\/adr\/0097-upstream-availability\.md` was not read/.test(why([ADR], read([ADR], [adrRow(null)]))) && tier([ADR], read([ADR], [adrRow(undefined)])) === GOVERNED_TIER_H);
    assert('⛔ several-hunks-no-hunk-a-binary-a-second-file-or-counts-that-disagree-stay-H', [
      `${patchOf(NOTE)}@@ -40,1 +44,2 @@\n x\n+y\n`, 'diff --git a/x b/x\n', 'diff --git a/x b/x\nBinary files a/x and b/x differ\n', `${patchOf(NOTE)}diff --git a/y b/y\n`, patchOf(NOTE).replace(/@@ -1,(\d+) \+1,(\d+) @@/, '@@ -1,$1 +1,99 @@'),
    ].every((p) => tier([ADR], read([ADR], [adrRow(p)])) === GOVERNED_TIER_H));
    assert('⛔ an-image-or-JSON-under-the-ADR-tree-stays-H', tier(['docs/adr/img/x.png'], read(['docs/adr/img/x.png'], [{ path: 'docs/adr/img/x.png', status: 'modified', oldMode: '100644', mode: '100644' }])) === GOVERNED_TIER_H && /not Markdown/.test(why(['docs/adr/img/x.png'], read(['docs/adr/img/x.png'], []))));
    assert('⛔ two-commits-one-add-only-and-one-editing-stays-H-every-row-is-read', tier([ADR], read([ADR], [adrRow(patchOf(NOTE)), adrRow(edited)])) === GOVERNED_TIER_H);
    // ⛔ The arm's other conditions, reused for the ADR leg, not re-spelled.
    assert('⛔ the-arm-conditions-hold-for-the-ADR-leg-Clause-2-yes-a-security-label-or-name-a-fork-or-an-unmeasured-reading-is-H',
      tier([ADR], read([ADR], [adrRow(patchOf(NOTE))], { body: 'Clause-②: yes\nMetadata-protocol: none\n' })) === GOVERNED_TIER_H &&
      tier([ADR], read([ADR], [adrRow(patchOf(NOTE))], { labels: ['security'] })) === GOVERNED_TIER_H &&
      tier(['docs/adr/0143-connector-auth-open-tier.md'], read(['docs/adr/0143-connector-auth-open-tier.md'], [adrRow(patchOf(NOTE), { path: 'docs/adr/0143-connector-auth-open-tier.md' })])) === GOVERNED_TIER_H &&
      tier([ADR], read([ADR], [adrRow(patchOf(NOTE))], { fork: { measured: true, isFork: true, headRepo: 'x/f', baseRepo: 'o/r' } })) === GOVERNED_TIER_H &&
      tier([ADR], { measured: false, reason: 'unread' }) === GOVERNED_TIER_H && tier([ADR], null) === GOVERNED_TIER_H && governedTierFor([ADR], REPO) === GOVERNED_TIER_H);
    assert('⛔ the-ADR-leg-moves-nothing-beside-another-governed-row-in-another-repository-or-under-ui-docs-adr',
      tier([ADR, 'docs/NORTH-STAR.md'], read([ADR, 'docs/NORTH-STAR.md'], [adrRow(patchOf(NOTE))])) === GOVERNED_TIER_H &&
      tier([ADR, 'AGENTS.md'], read([ADR, 'AGENTS.md'], [adrRow(patchOf(NOTE))])) === GOVERNED_TIER_H &&
      ['objectui', 'cloud', 'hotcrm'].every((r) => tier([ADR], noteOnly, r) === GOVERNED_TIER_H) &&
      tier(['ui/docs/adr/0001-x.md'], read(['ui/docs/adr/0001-x.md'], [adrRow(patchOf(NOTE), { path: 'ui/docs/adr/0001-x.md' })])) === GOVERNED_TIER_H);
    assert('⛔ a-skills-change-beside-an-ADR-note-still-owes-its-changeset', tier([ADR, SK], read([ADR, SK], [adrRow(patchOf(NOTE)), { path: SK, status: 'modified', oldMode: '100644', mode: '100644' }])) === GOVERNED_TIER_H && /no changeset/.test(why([ADR, SK], read([ADR, SK], [adrRow(patchOf(NOTE)), { path: SK, status: 'modified', oldMode: '100644', mode: '100644' }]))));

    // ⛔ Review round 1 (fail-open shapes): what an added line does to EXISTING lines is read on both sides.
    const H_ = (ops, path = ADR) => tier([path], read([path], [adrRow(patchOf(ops, path), { path })])) === GOVERNED_TIER_H;
    assert('⛔ R1-a-heading-added-inside-Decision-that-re-scopes-existing-decision-text-stays-H', H_(insertAfter(12, '', '## Exception', '', 'Except when Y, allow it.')) && H_(insertAfter(8, '', '## Scope note', 'Narrower.')) && /change the heading or the section of existing line/.test(why([ADR], read([ADR], [adrRow(patchOf(insertAfter(8, '', '## Scope note', 'Narrower.')))]))));
    assert('⛔ R1-a-setext-underline-or-a-tab-indented-heading-under-decision-text-stays-H', H_(insertAfter(12, '---', '', 'Except when Y.')) && H_(insertAfter(12, '\t## except on Tuesdays', 'Allowed then.')) && H_(insertAfter(12, '- ## Decision', 'Allowed.')) && H_(insertAfter(16, '', '<h2>Decision</h2>', 'Allowed.')));
    // A fence is closed only by its opener's character at least as long: `````/```/````` is ONE balanced block (S), a lone ``` hides the rest (H).
    // Since review round 4 (the allowlist) an added fence is refused anywhere, a balanced one in Context too.
    assert('⛔ R1-a-fence-or-frontmatter-added-above-the-Decision-heading-stays-H-and-so-does-a-balanced-code-block-in-Context', H_(insertAfter(6, '', '````', '```', '````', '')) && H_([['+', '---'], ...keep(RECORD.slice(0, 7)), ['+', '---'], ...keep(RECORD.slice(7))]) && H_(insertAfter(6, '```')));
    assert('⛔ R1-a-bare-CR-VT-FF-or-line-separator-inside-an-added-line-stays-H', ['Tracking: #1\rStatus: Superseded', 'note\r\r## Decision\r\rWe now allow X.', 'a\vb', 'a\fb', 'a\u2028b', 'a\u2029b'].every((l) => H_([...keep(), ['+', ''], ['+', '## Notes'], ['+', l]])) && /bare CR/.test(why([ADR], read([ADR], [adrRow(patchOf([...keep(), ['+', 'x\ry']]))]))));
    const ZH = ['# ADR-0121: 记录', '', '**Status**: Accepted', '', '## 背景', '', '缘由。', '', '## 决定', '', '### D1', '', '拒绝。', '', '## 后果', '', '若干。'];
    assert('⛔ R1-a-Chinese-decision-heading-rules-too-and-a-record-with-none-cannot-take-a-note', H_([...keep(ZH.slice(0, 13)), ['+', '也记日志。'], ...keep(ZH.slice(13))]) && !H_([...keep(ZH), ['+', ''], ['+', '## 修订注记'], ['+', '注记。']]) &&
      H_([...keep(['# ADR-0043: x', '', '**Status**: Accepted', '', '## Mechanics', '', 'Tokens expire.']), ['+', 'Tokens may be reused within 5 minutes.']]) && /names no decision or status heading/.test(why([ADR], read([ADR], [adrRow(patchOf([...keep(['# t', '', '## Mechanics', '', 'x']), ['+', 'y']]))]))));
    assert('⛔ R1-the-generated-index-a-subfolder-and-a-hunk-not-at-line-1-stay-H', H_(NOTE, 'docs/adr/README.md') && H_(NOTE, 'docs/adr/sub/0001-x.md') && tier([ADR], read([ADR], [adrRow(patchOf(NOTE).replace('@@ -1,', '@@ -500,'))])) === GOVERNED_TIER_H);
    assert('⭐ R1-a-new-section-opened-at-the-Decision-level-between-Decision-and-Consequences-is-S-a-deeper-one-is-H', !H_(insertAfter(13, '## Notes', '', '> **Note.** D1 now logs.', '')) && H_(insertAfter(13, '### Notes', '', '> **Note.** D1 now logs.', '')));
    assert('a-record-with-no-final-newline-says-why-its-appended-note-reads-H', /no newline at its end/.test(why([ADR], read([ADR], [adrRow(`${patchOf([...keep(RECORD.slice(0, 16)), ['-', 'Some.']])}\\ No newline at end of file\n+Some.\n+\n+## Notes\n`)]))));
    assert('addOnlyDiffArgv-passes-the-path-as-a-literal-pathspec', addOnlyDiffArgv(['diff'], ['a', 'b'], 'docs/adr/x[1].md').slice(-2).join(' ') === '-- :(literal)docs/adr/x[1].md');

    // ⛔ Review round 2: a phantom setext heading, raw HTML, a link definition and a disguised Decision heading.
    assert('⛔ R2-a-list-item-or-quote-line-over-a-dash-rule-is-no-heading-so-text-at-the-end-of-Decision-stays-H', H_(insertAfter(13, '- note', '---', 'We now also allow X.', '')) && H_(insertAfter(13, '> note', '---', 'We now also allow X.', '')) && H_(insertAfter(13, '- ## Notes', 'We now also allow X.', '')) &&
      addOnlyHeadingReading(['- note', '---'])[0].heading === null && addOnlyHeadingReading(['> note', '---'])[0].heading === null && addOnlyHeadingReading(['note', '---'])[0].heading?.level === 2);
    assert('⛔ R2-raw-HTML-that-hides-existing-text-stays-H', H_(insertAfter(6, '<!--')) && H_([...keep(RECORD.slice(0, 7)), ['+', '<!--'], ...keep(RECORD.slice(7, 14)), ['+', '-->'], ...keep(RECORD.slice(14))]) && H_(insertAfter(6, '<pre>')) && H_(insertAfter(16, '', '<h2>Decision</h2>')));
    assert('⛔ R2-a-zero-width-or-homoglyph-Decision-heading-and-a-link-reference-definition-stay-H', H_([...keep(), ['+', ''], ['+', '## De\u200bcision'], ['+', 'We now allow X.']]) && H_([...keep(), ['+', ''], ['+', '## Decisi\u043en'], ['+', 'We now allow X.']]) && H_(insertAfter(6, '[a]: https://example.invalid/'))
      && !H_(insertAfter(6, '', 'See [the note][a] and `[x]: y` in prose.')));

    // ⛔ Review round 3: a Decision heading split by inline markup, an entity or a soft hyphen; an opener with no blank line above.
    const appendRuled = (heading) => H_([...keep(), ['+', ''], ['+', heading], ['+', 'We now allow X.']]);
    assert('⛔ R3-a-Decision-heading-split-by-emphasis-code-an-entity-or-a-soft-hyphen-stays-H', appendRuled('## **Dec**ision') && appendRuled('## Deci`sion`') && appendRuled('## Dec&#105;sion') && appendRuled('## Deci\u00adsion') &&
      H_([...keep(), ['+', ''], ['+', '## Notes'], ['+', 'S&#116;atus: Superseded']]) && H_([...keep(), ['+', ''], ['+', '## **Notes**'], ['+', 'We now allow X.']]));
    assert('⛔ R3-an-opener-with-no-blank-line-above-it-stays-H-an-autolink-says-why', H_([...keep(RECORD.slice(0, 13)), ['+', '## Notes'], ['+', 'We now also allow X.']]) && !H_([...keep(RECORD.slice(0, 13)), ['+', ''], ['+', '## Notes'], ['+', ''], ['+', 'We now also allow X.']]) &&
      /autolink/.test(why([ADR], read([ADR], [adrRow(patchOf(insertAfter(16, '', '<https://example.invalid/>')))]))));

    // ⛔ Contract review round 4 (comment 6896800633): every probe string, as the record gives it, reads H; the
    // allowlist that closes them still passes plain notes.
    const append = (...added) => H_([...keep(), ['+', ''], ...added.map((t) => ['+', t])]);
    const inContext = (...added) => H_(insertAfter(6, '', ...added));
    assert('⛔ R4-M1-a-quoted-fence-opener-above-an-unquoted-Decision-heading-stays-H', append('> ```', '## Decision', 'We now allow X.') && append('> ~~~', '', '## Notes', 'x') &&
      addOnlyHeadingReading(['> ```', '## Decision', 'x'])[1].heading?.text === 'Decision' && addOnlyHeadingReading(['```', '> ```', '## Decision', '```'])[2].heading === null);
    assert('⛔ R4-M2-a-list-borne-Decision-heading-stays-H-in-every-spelling', append('-\t## Decision', 'We now allow X.') && append('- - ## Decision', 'We now allow X.') && append('- > ## Decision', 'We now allow X.') &&
      append('- 1. ## Decision', 'We now allow X.') && append('* ## Decision') && append('1. ## Notes', 'x'));
    assert('⛔ R4-M3-a-Decision-heading-split-by-an-empty-link-or-an-empty-HTML-element-stays-H', append('## De[](#)cision', 'We now allow X.') && append('## De<b></b>cision', 'We now allow X.') && append('## Notes [x](#y)', 'x') && append('## Notes \\', 'x'));
    assert('⛔ R4-S1-inline-or-unclosed-raw-HTML-mid-line-stays-H', inContext('Note <s') && inContext('Text <h2>Decision</h2>') && inContext('a < b'));
    assert('⛔ R4-S2-a-Chinese-or-dated-status-line-stays-H', append('## Notes', '**状态**:已被 ADR-0154 取代') && append('## Notes', 'Status (2026-11-15): Superseded by ADR-0154') && append('## Notes', '> Status of D1: superseded'));
    assert('⛔ R4-N1-a-link-reference-definition-inside-a-list-item-or-quote-stays-H', inContext('- [a]: https://example.invalid/') && inContext('> [a]: https://example.invalid/') && inContext('[a]: https://example.invalid/'));
    assert('⛔ R4-a-record-whose-existing-text-the-reader-does-not-model-takes-no-note', H_([...keep(RECORD.slice(0, 7)), [' ', '- ```'], [' ', '## Notes'], [' ', '```'], ...keep(RECORD.slice(7)), ['+', ''], ['+', '## Later'], ['+', 'x']]) &&
      H_([...keep(RECORD.slice(0, 7)), [' ', '<!--'], [' ', '## Notes'], [' ', '-->'], ...keep(RECORD.slice(7)), ['+', ''], ['+', '## Later'], ['+', 'x']]));
    assert('⭐ R4-the-allowlist-still-passes-plain-notes-quoted-listed-emphasised-linked-and-Chinese', !append('## Amendment notes', '', '> **Note (2026-11-15, #1).** The refusal now names its code.') &&
      !append('## Notes', '', '- One point, see [PR 1](https://example.invalid/1).', '- *Another* point with `code`.', '1. A numbered point.') && !append('## 修订注记', '', '注记：D1 现在也记日志。') &&
      !inContext('A plain sentence in Context, (with brackets) and “quotes”.') && !append('### Note 2026-11-15: D1, logged', '', 'x'));

    // ⛔ Contract review round 5 (comment 6897145164): S3 a line joined onto a setext heading; S4 look-alike and
    // letter-spaced ruled headings; N3 a status word behind punctuation or after a word.
    const SETEXT = [...RECORD.slice(0, 8), 'Decision', '--------', ...RECORD.slice(9)];
    assert('⛔ R5-S3-a-line-added-directly-above-a-setext-Decision-heading-joins-it-and-stays-H', H_([...keep(SETEXT.slice(0, 8)), ['+', 'No longer the'], ...keep(SETEXT.slice(8))]) &&
      /joins/.test(why([ADR], read([ADR], [adrRow(patchOf([...keep(SETEXT.slice(0, 8)), ['+', 'No longer the'], ...keep(SETEXT.slice(8))]))]))) &&
      !H_([...keep(SETEXT.slice(0, 7)), ['+', ''], ['+', 'A note in Context.'], ...keep(SETEXT.slice(7))]));
    assert('⛔ R5-S4-a-look-alike-or-letter-spaced-ruled-heading-stays-H', append('## \u0501\u0435\u0441\u0456\u0455\u0456\u043e\u0578', 'We now allow X.') && append('## D e c i s i o n', 'We now allow X.') &&
      append('## S.t.a.t.u.s', 'x') && append('## 决 策', 'x') && append('## 状-态', 'x') && append('## Ünïcode notes', 'x') && !append('## 修订注记', '', '注记。') && !append('## Notes 2', 'x'));
    assert('⛔ R5-N3-a-status-word-behind-punctuation-or-after-a-word-stays-H', append('## Notes', '(Status): Superseded by ADR-0154') && append('## Notes', '"Status": superseded') && append('## Notes', 'Current status: superseded') &&
      append('## Notes', '当前状态：已取代') && !append('## Notes', 'The status page now links here.'));

    // ⛔ Contract review round 6 (comment 6897472749): S5 traditional Chinese ruled words; S6 the squeezed reading
    // never makes a record count as naming a ruled heading.
    const TW = ['# ADR-0122: 記錄', '', '**Status**: Accepted', '', '## 背景', '', '緣由。', '', '## 決定', '', '拒絕。'];
    assert('⛔ R6-S5-a-traditional-Chinese-ruled-heading-rules-and-is-refused-as-an-added-heading', H_([...keep(TW), ['+', '也記日誌。']]) && append('## 決策', 'x') && append('## 裁決', 'x') && append('## 狀態', 'x') &&
      ['決策', '決定', '裁決', '狀態'].every((w) => LOW_RISK_ADD_ONLY_RULED_HEADING.test(w) && LOW_RISK_ADD_ONLY_RULED_SQUEEZED.test(w)) && !H_([...keep(TW), ['+', ''], ['+', '## 修訂註記'], ['+', '註記。']]));
    const STAT = ['# ADR-0123: Counters', '', '## Context', '', 'Why.', '', '## Stat usage', '', 'Some.'];
    assert('⛔ R6-S6-a-record-whose-only-near-heading-is-Stat-usage-names-no-ruled-heading-and-stays-H', H_([...keep(STAT), ['+', ''], ['+', '## Notes'], ['+', 'x']]) &&
      /names no decision or status heading/.test(why([ADR], read([ADR], [adrRow(patchOf([...keep(STAT), ['+', ''], ['+', '## Notes'], ['+', 'x']]))]))));

    // The heading reader: the title scopes nothing; fences and frontmatter hide headings; setext and quoted headings count.
    const h = addOnlyHeadingReading(['---', 'title: x', '---', '# ADR: a decision record', 'top', '```', '## Decision', '```', 'after fence', 'Decision', '========', 'under setext', '> ## Status', 'under quoted']);
    assert('addOnlyHeadingReading-the-title-scopes-nothing-fences-and-frontmatter-hide-headings-setext-and-quoted-ones-count',
      h[4].under.length === 0 && h[6].heading === null && h[8].under.length === 0 && h[9].heading?.text === 'Decision' && h[10].heading?.text === 'Decision' &&
      h[11].under.map((x) => x.text).join() === 'Decision' && h[12].heading?.text === 'Status' && h[13].under.map((x) => x.text).join() === 'Decision,Status', JSON.stringify(h));
    assert('a-title-naming-a-decision-does-not-make-every-note-H-and-CRLF-reads-the-same', tier([ADR], read([ADR], [adrRow(patchOf([[' ', '# ADR-0099: one axis for tier decisions'], [' ', ''], ...keep(RECORD.slice(1)), ['+', ''], ['+', '> Note.']]))])) === GOVERNED_TIER_S &&
      tier([ADR], read([ADR], [adrRow(patchOf(NOTE).replace(/\n/g, '\r\n'))])) === GOVERNED_TIER_S);
    assert('the-ADR-constants-are-frozen-and-read-as-the-card-says', Object.isFrozen(LOW_RISK_ADD_ONLY_FILE_PATTERNS) && LOW_RISK_ADD_ONLY_FILE_PATTERNS.length === 1 && LOW_RISK_ADD_ONLY_RULED_HEADING.test('2. Decision') && LOW_RISK_ADD_ONLY_RULED_HEADING.test('Current status') && !LOW_RISK_ADD_ONLY_RULED_HEADING.test('Consequences') && !LOW_RISK_ADD_ONLY_RULED_HEADING.test('Statuses'));
    assert('the-H-words-name-the-ADR-reason', /low-risk skills arm .*Tier H/.test(renderTestVerdict(testVerdict([ADR], { repo: REPO, lowRisk: read([ADR], [adrRow(edited)]) }))) && /not an add-only note/.test(renderTestVerdict(testVerdict([ADR], { repo: REPO, lowRisk: read([ADR], [adrRow(edited)]) }))));

    // `--pr` and the relay: `pullCatalogReading` carries each modified ADR file's diff, merge base to head, at full context.
    assert('pullCatalogReading-carries-the-full-context-diff-of-a-modified-ADR-file-and-none-for-a-skill-or-an-added-file', (() => {
      const [Hd, Bs, Mb] = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
      const seen = [];
      const run = (argv) => {
        if (argv[0] === 'cat-file') return { ok: true, out: '' };
        if (argv[0] === 'merge-base') return { ok: true, out: Mb };
        if (argv[0] === 'ls-tree') return { ok: true, out: `100644 blob ${'f'.repeat(40)}\t${argv[3]}` };
        if (argv[0] === 'diff') { seen.push(argv); return { ok: true, out: patchOf(NOTE).trim() }; }
        return { ok: false, out: '' };
      };
      const statuses = [{ path: ADR, status: 'modified' }, { path: SK, status: 'modified' }, { path: 'docs/adr/0200-new.md', status: 'added' }];
      const r = pullCatalogReading({ derivation: { headSha: Hd, baseSha: Bs, pull: 2 }, statuses, paths: [ADR, SK, 'docs/adr/0200-new.md'], sameCheckout: true, run });
      const failed = pullCatalogReading({ derivation: { headSha: Hd, baseSha: Bs, pull: 2 }, statuses: [{ path: ADR, status: 'modified' }], paths: [ADR], sameCheckout: true, run: (argv) => (argv[0] === 'diff' ? { ok: false, out: '' } : run(argv)) });
      return r.measured === true && typeof r.files[0].patch === 'string' && !('patch' in r.files[1]) && !('patch' in r.files[2]) &&
        seen.length === 1 && seen[0].join(' ') === addOnlyDiffArgv(['diff'], [Mb, Hd], ADR).join(' ') && seen[0].includes(`--unified=${LOW_RISK_ADD_ONLY_CONTEXT}`) && seen[0].includes('--no-renames') && seen[0].includes('--no-textconv') &&
        tier([ADR], read([ADR], r.files.filter((f) => f.path === ADR))) === GOVERNED_TIER_S && failed.files[0].patch === null && tier([ADR], read([ADR], failed.files)) === GOVERNED_TIER_H;
    })());

    // REAL git: the argv reads one hunk over the whole file, trimmed as `tryGit` trims, in both directions.
    const adrFx = mkdtempSync(join(tmpdir(), 'governed-merges-adr-leg-'));
    try {
      const fg = (cwd, ...rest) =>
        execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...rest],
          { cwd, encoding: 'utf8', env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      fg(adrFx, 'init', '-q', '.');
      mkdirSync(join(adrFx, 'docs/adr'), { recursive: true });
      const long = [...RECORD, '', '## Notes', '', ...Array.from({ length: 40 }, (_, i) => `Filler ${i}.`)];
      writeFileSync(join(adrFx, ADR), `${long.join('\n')}\n`);
      fg(adrFx, 'add', '-A');
      fg(adrFx, 'commit', '-qm', 'seed');
      const base = fg(adrFx, 'rev-parse', 'HEAD').trim();
      const at = (lines) => { writeFileSync(join(adrFx, ADR), `${lines.join('\n')}\n`); fg(adrFx, 'commit', '-qam', 'x'); return fg(adrFx, 'rev-parse', 'HEAD').trim(); };
      const notedLines = [...long.slice(0, 7), '', '> Note (2026-11-15): seen.', ...long.slice(7), '', '> **Note.** And at the end.'];
      const noted = at(notedLines);
      const underD = at([...notedLines.slice(0, 15), 'Also log.', ...notedLines.slice(15)]);
      const viaGit = (from, to) => addOnlyNoteReasons({ path: ADR, patch: tryGit(adrFx, addOnlyDiffArgv(['diff'], [from, to], ADR)).out });
      const viaTree = (sha) => addOnlyNoteReasons({ path: ADR, patch: git(adrFx, addOnlyDiffArgv(['diff-tree', '-p', '--no-commit-id', '-m', '--first-parent'], [sha], ADR)) });
      assert('⭐ REAL-git-an-add-only-note-far-apart-from-another-reads-as-ONE-hunk-and-passes-by-diff-and-by-diff-tree', viaGit(base, noted).length === 0 && viaTree(noted).length === 0, JSON.stringify([viaGit(base, noted), viaTree(noted)]));
      assert('⛔ REAL-git-a-line-under-Decision-reads-H-by-its-own-commit-and-by-the-whole-range', viaTree(underD).some((r) => /under/.test(r)) && viaGit(noted, underD).some((r) => /under/.test(r)) && viaGit(base, underD).some((r) => /under/.test(r)), JSON.stringify([viaTree(underD), viaGit(base, underD)]));
    } catch (error) {
      assert('the-ADR-leg-real-git-fixture-could-be-built-and-run', false, String(error?.message ?? error).split('\n')[0]);
    } finally {
      rmSync(adrFx, { recursive: true, force: true });
    }
  }

  battery('⚖️ #33603: the sweep lists a low-risk arm landing APART and judges it on a same-head at-tier PASS record');
  {
    const readers = await loadArmReaders();
    const { CONTRACT_REVIEW_TIER_NAME: TIER_NAME } = await import('./record-recognisers.mjs');
    const OS = GOVERNED_REPOS.find((r) => r.id === 'objectstack');
    const SK = 'skills/objectstack-data/SKILL.md';
    const CS = '.changeset/33603-wording.md';
    const CS_TEXT = "---\n'@objectstack/skills': patch\n---\n\nskills: wording\n\nClause-②: no\nMetadata-protocol: none\n";
    const LANDED = 'a'.repeat(40);
    const HEAD = 'b'.repeat(40);
    const BODY = 'Fixes #69\n\nClause-②: no\nMetadata-protocol: none\n';
    const MERGED_AT = '2026-11-15T05:00:00Z';
    // This file as a landed tree holds it: with the record stage declared, and as it read before the stage.
    const RULE_TREE = "/** the register */\nexport const LOW_RISK_RECORD_STAGE = Object.freeze({ pending: 'pending' });\n";
    const OLD_RULE_TREE = "/** the register, before the stage */\nexport function lowRiskArmVerdict() {}\n// 'export const LOW_RISK_RECORD_STAGE = ' only quoted\n";
    // The landed commit as git answers the guard's readers: a MODIFIED skill and an added changeset.
    const runGit = (args) => {
      if (args[0] === 'diff-tree') return `:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} M\0${SK}\0:000000 100644 ${'0'.repeat(40)} ${'3'.repeat(40)} A\0${CS}\0`;
      if (args[0] === 'show' && args[1] === `${LANDED}:${CS}`) return CS_TEXT;
      if (args[0] === 'rev-parse') return `${'c'.repeat(40)}\n`;
      // The landed tree's own copy of this file declares the record stage: its queue ran the stage.
      if (args[0] === 'cat-file' && args[2] === `${LANDED}:${ARM_RULE_PATH}`) return RULE_TREE;
      throw new Error(`fatal: unexpected git ${args.join(' ')}`);
    };
    const RELAY = readers.recognisers?.trustedAuthors?.[0] ?? '(relay unread)';
    // The record an arm landing stands on carries the arm's line (`line: null` leaves it out).
    const record = ({ head = HEAD, tier = TIER_NAME, signed = true, verdict = '**VERDICT: PASS**', at = '2026-11-15T04:00:00Z', id = 900, by = RELAY, line = LOW_RISK_RECORD_LINE } = {}) => ({
      id, created_at: at, user: { login: by },
      body: ['## Contract review', '', `Served-tier: \`${tier}\``, `Head-sha: \`${head}\``, ...(signed ? ['Reviewed-by: `session_01SEAT`'] : []), ...(line === null ? [] : [line]), '', verdict].join('\n'),
    });
    const entryOf = (paths = [SK, CS], size = null) => classifyCommit({ sha: LANDED, date: '2026-11-15T04:30:00Z', subject: 'docs(skills): wording (#70)' }, paths, OS, size);
    const LANDING = { mergedAt: MERGED_AT, mergeCommitSha: LANDED };
    // Card #69 as the label reader and the timeline reader answer it NOW: `cardLabels` its labels, `cardEvents` its
    // timeline (`labelReader: false` hands the leg no label reader at all). Another card the pull names answers
    // `cardLabelsBy[n]` and `cardEventsBy[n]` (`'throw'` throws), else no label and no event.
    const run = async ({ prRows = [record()], cardRows = [], pull = {}, throws = null, paths = [SK, CS], size = null, rd = readers, attribution = LANDING, reviews = [], events = [], git = runGit, cardLabels = [], cardEvents = [], cardLabelsBy = {}, cardEventsBy = {}, labelReader = true, seen = null } = {}) => readArmLanding(entryOf(paths, size), {
      paths, repo: 'objectstack', readers: rd, runGit: git, attribution,
      fetchers: {
        fetchPull: async () => { if (throws === 'pull') throw new Error('HTTP 502'); return { sha: HEAD, body: BODY, labels: [], fork: { measured: true, isFork: false, headRepo: 'o/r', baseRepo: 'o/r' }, headRef: 'claude/project-thread-x', ...pull }; },
        fetchReviews: async () => { if (throws === 'reviews') throw new Error('HTTP 502'); return reviews; },
        fetchTimeline: async (n) => { if (throws === 'timeline' || (throws === 'card-timeline' && n === 69) || cardEventsBy[n] === 'throw') throw new Error('HTTP 502'); return n === 69 ? cardEvents : n === 70 ? events : (cardEventsBy[n] ?? []); },
        fetchComments: async (n) => { if (throws === 'comments') throw new Error('HTTP 502'); return n === 70 ? prRows : n === 69 ? cardRows : []; },
        ...(labelReader ? { fetchLabels: async (n) => { seen?.push(n); if (throws === 'labels' || cardLabelsBy[n] === 'throw') throw new Error('HTTP 502'); return n === 69 ? cardLabels : (cardLabelsBy[n] ?? []); } } : {}),
      },
    });

    assert('the-guard-readers-load-lazily-from-the-sweep-every-export-and-the-recognisers', readers.available === true && ARM_READER_EXPORTS.every((n) => typeof readers.guard[n] === 'function') && readers.recognisers?.available === true, readers.reason);
    assert('⛔ a-guard-missing-an-export-or-failing-to-load-is-NOT-available-with-the-reason', await (async () => {
      const missing = await loadArmReaders(async () => ({}));
      const thrown = await loadArmReaders(async () => { throw new Error('ERR_MODULE_NOT_FOUND'); });
      return missing.available === false && missing.reason.includes('readLowRiskTier') && thrown.available === false && thrown.reason.includes('ERR_MODULE_NOT_FOUND');
    })());
    const pass = await run();
    assert('⭐ an-arm-landing-on-a-same-head-at-tier-PASS-record-on-the-PR-is-PASS', pass?.state === 'pass' && pass.record.where === 'PR' && pass.record.id === 900 && pass.headSha === HEAD, JSON.stringify(pass));
    const onCard = await run({ prRows: [], cardRows: [record({ id: 901 })] });
    assert('⭐ the-record-may-sit-on-the-card-the-body-delivers', onCard?.state === 'pass' && onCard.record.where === 'card' && onCard.record.id === 901, JSON.stringify(onCard));
    const breach = async (over, re) => { const v = await run(over); return v?.state === 'breach' && re.test(v.reason) ? true : JSON.stringify(v); };
    assert('⛔ no-record-is-a-BREACH', await breach({ prRows: [] }, /no `## Contract review` record on its head/) === true);
    assert('⛔ a-FAIL-record-is-a-BREACH', await breach({ prRows: [record({ verdict: '**VERDICT: FAIL**' })] }, /does not read PASS/) === true);
    assert('⛔ a-PASS-record-on-another-head-is-a-BREACH', await breach({ prRows: [record({ head: 'd'.repeat(40) })] }, /no `## Contract review` record on its head/) === true);
    assert('⛔ a-PASS-record-below-the-tier-is-a-BREACH', await breach({ prRows: [record({ tier: 'TIER_DEFAULT' })] }, /does not stand at the tier/) === true);
    assert('⛔ an-unsigned-PASS-record-is-a-BREACH', await breach({ prRows: [record({ signed: false })] }, /names no reviewer/) === true);
    assert('⛔ a-PASS-record-posted-AFTER-the-landing-is-a-BREACH-the-queue-could-not-read-it', await breach({ prRows: [record({ at: '2026-11-15T06:00:00Z' })] }, /no `## Contract review` record on its head/) === true);
    assert('⛔ a-PASS-record-EDITED-after-the-landing-does-not-count-and-the-BREACH-says-it-was-edited', await breach({ prRows: [{ ...record(), updated_at: '2026-11-15T06:00:00Z' }] }, /no `## Contract review` record on its head .*PR comment 900 was edited after the landing/) === true);
    // #33711 S3: the guard's author binding — a row from an author it does not trust is dropped, as the queue drops it.
    assert('⛔ a-PASS-record-from-an-UNTRUSTED-author-is-not-PASS', await breach({ prRows: [record({ by: 'some-commenter' })] }, /no `## Contract review` record on its head/) === true);
    assert('⭐ an-UNTRUSTED-FAIL-after-a-trusted-PASS-does-not-shadow-it', (await run({ prRows: [record(), record({ id: 902, verdict: '**VERDICT: FAIL**', at: '2026-11-15T04:20:00Z', by: 'some-commenter' })] }))?.state === 'pass' &&
      await breach({ prRows: [record(), record({ id: 902, verdict: '**VERDICT: FAIL**', at: '2026-11-15T04:20:00Z' })] }, /does not read PASS/) === true);
    // #33711 S2: the record's head is tied to the landed commit only through the pull's own merge.
    assert('⛔ a-pull-that-landed-as-ANOTHER-commit-is-never-PASS', await breach({ attribution: { ...LANDING, mergeCommitSha: 'f'.repeat(40) } }, /landed as ffffffffffff, not as this commit/) === true);
    assert('⛔ a-pull-closed-UNMERGED-is-never-PASS', await breach({ attribution: { ...LANDING, mergedAt: null } }, /is not merged/) === true);
    // #33711 S1: the guard's order — an authorized approval, then an authorized enqueue, then the record.
    const APPROVED = (login, at = '2026-11-15T04:10:00Z') => ({ id: 1, state: 'APPROVED', user: { login }, commit_id: HEAD, submitted_at: at });
    const cleared = async (over, by) => { const v = await run(over); return v?.state === 'cleared' && v.by === by ? true : JSON.stringify(v); };
    assert('⭐ an-authorized-APPROVAL-before-the-landing-clears-it-the-maintainers-merge-not-a-BREACH', await cleared({ prRows: [], reviews: [APPROVED('os-zhuang')] }, 'review') === true);
    // The timeline a queue merge leaves, measured on #33555, #33632 and #33616: the removal shares the merge's instant.
    const QUEUED = (login) => [
      { event: 'added_to_merge_queue', actor: { login }, created_at: '2026-11-15T04:40:00Z' },
      { event: 'merged', actor: { login }, created_at: MERGED_AT },
      { event: 'removed_from_merge_queue', actor: { login: 'github-merge-queue[bot]' }, created_at: MERGED_AT },
    ];
    assert('⭐ an-authorized-ENQUEUE-clears-it-read-on-the-timeline-as-the-queue-saw-it-before-the-merge', await cleared({ prRows: [], events: QUEUED('os-zhuang') }, 'enqueue') === true);
    assert('control-a-seat-account-enqueue-clears-nothing-the-record-decides', (await run({ events: QUEUED('objectstack-fleet[bot]') }))?.state === 'pass' &&
      await breach({ prRows: [], events: QUEUED('objectstack-fleet[bot]') }, /no `## Contract review` record/) === true);
    assert('⛔ an-approval-AFTER-the-landing-or-by-an-unauthorized-account-clears-nothing',
      await breach({ prRows: [], reviews: [APPROVED('os-zhuang', '2026-11-15T06:00:00Z')] }, /no `## Contract review` record/) === true &&
      await breach({ prRows: [], reviews: [APPROVED('os-someone')] }, /no `## Contract review` record/) === true);
    const tierH = async (over, re) => { const v = await run(over); return v?.state === 'tier-h' && v.reasons.some((r) => re.test(r)) ? true : JSON.stringify(v); };
    assert('⭐ the-arm-reading-H-a-security-label-stays-on-the-maintainers-list', await tierH({ pull: { labels: ['security'] } }, /`security` label/) === true);
    assert('⭐ the-arm-reading-H-a-Clause-2-yes-body-stays-on-the-maintainers-list', await tierH({ pull: { body: 'Fixes #69\n\nClause-②: yes\nMetadata-protocol: none\n' } }, /Clause-②/) === true);
    assert('⭐ the-arm-reading-H-a-path-outside-the-allowlist-in-the-same-commit', await tierH({ paths: [SK, CS, 'packages/spec/src/a.zod.ts'] }, /outside skills wording/) === true);
    assert('⛔ an-arm-landing-over-the-size-line-was-the-maintainers', await tierH({ size: { additions: HUMAN_MERGE_LINE_THRESHOLD + 1, deletions: 0 } }, /human-merge line/) === true);
    const unmeasured = async (over, re) => { const v = await run(over); return v?.state === 'not-measured' && re.test(v.reason) ? true : JSON.stringify(v); };
    assert('⛔ an-unread-pull-is-NOT-MEASURED', await unmeasured({ throws: 'pull' }, /its pull request could not be read/) === true);
    assert('⛔ an-unread-timeline-is-NOT-MEASURED', await unmeasured({ throws: 'timeline' }, /its timeline could not be read/) === true);
    assert('⛔ unread-reviews-are-NOT-MEASURED', await unmeasured({ throws: 'reviews' }, /its reviews could not be read/) === true);
    assert('⛔ an-unread-merge-is-NOT-MEASURED-never-a-record-on-an-untied-head', await unmeasured({ attribution: null }, /its merge could not be read/) === true);
    assert('⛔ an-unread-comment-thread-is-NOT-MEASURED', await unmeasured({ throws: 'comments' }, /comment thread could not be read/) === true);
    assert('⛔ readers-that-did-not-load-are-NOT-MEASURED', await unmeasured({ rd: { available: false, reason: 'no guard' } }, /no guard/) === true);
    assert('no-catalog-row-or-no-PR-number-is-no-arm-reading', (await run({ paths: ['AGENTS.md'] })) === null &&
      (await readArmLanding({ ...entryOf(), pr: null }, { paths: [SK], repo: 'objectstack', readers, fetchers: {}, runGit })) === null);

    // The arm's RECORD STAGE, as the queue read it at the landing: a record that stands and reads PASS must also carry
    // the arm's line, and the card must have been free of `security` THEN. A stage at Tier H is a BREACH flagged
    // `stage` (the queue would have refused the landing); a piece that could not be read is NOT MEASURED.
    const stageBreach = async (over, re) => { const v = await run(over); return v?.state === 'breach' && v.stage === true && re.test(v.reason) ? true : JSON.stringify(v); };
    const AT = (event, at, name = 'security') => ({ event, created_at: at, label: { name } });
    assert('⛔ RECORD-LINE an-arm-landing-on-a-PASS-record-with-NO-Security-touching-line-is-a-stage-BREACH-and-so-is-yes',
      await stageBreach({ prRows: [record({ line: null })] }, /^its contract-review record \(PR comment 900\) carries no `Security-touching:` line$/) === true &&
      await stageBreach({ prRows: [record({ line: 'Security-touching: yes' })] }, /^its contract-review record \(PR comment 900\) reads `Security-touching: yes`$/) === true &&
      await stageBreach({ prRows: [record({ line: `- ${LOW_RISK_RECORD_LINE}\n- ${LOW_RISK_RECORD_LINE}` })] }, /is unreadable: it carries 2 `Security-touching:` lines/) === true &&
      await stageBreach({ prRows: [], cardRows: [record({ id: 901, line: null })] }, /^its contract-review record \(card comment 901\) carries no `Security-touching:` line$/) === true);
    assert('⛔ CARD-LABEL a-card-carrying-security-AT-the-landing-is-a-stage-BREACH-whether-or-not-it-still-carries-it',
      await stageBreach({ cardLabels: ['security'] }, /^its card #69 carries the `security` label$/) === true &&
      await stageBreach({ cardLabels: ['docs', 'Security'], cardEvents: [AT('labeled', '2026-11-15T03:00:00Z')] }, /^its card #69 carries the `security` label$/) === true &&
      await stageBreach({ cardLabels: [], cardEvents: [AT('labeled', '2026-11-15T03:00:00Z'), AT('unlabeled', '2026-11-15T06:00:00Z')] }, /^its card #69 carries the `security` label$/) === true);
    assert('⛔ CARD-LABEL a-security-label-REMOVED-from-the-card-before-the-landing-is-a-stage-BREACH',
      await stageBreach({ cardEvents: [AT('labeled', '2026-11-15T03:00:00Z'), AT('unlabeled', '2026-11-15T03:30:00Z')] }, /^the timeline of its card #69 shows the `security` label removed$/) === true &&
      await stageBreach({ cardEvents: [{ event: 'unlabeled', label: { name: 'security' } }] }, /shows the `security` label removed$/) === true);
    assert('⭐ CARD-LABEL a-label-put-on-the-card-AFTER-the-landing-does-not-reach-back-the-queue-could-not-read-it',
      (await run({ cardLabels: ['security'], cardEvents: [AT('labeled', '2026-11-15T06:00:00Z')] }))?.state === 'pass' &&
      (await run({ cardLabels: ['security'], cardEvents: [AT('labeled', MERGED_AT)] }))?.state === 'pass' &&
      (await run({ cardLabels: [], cardEvents: [AT('labeled', '2026-11-15T06:00:00Z'), AT('unlabeled', '2026-11-15T07:00:00Z')] }))?.state === 'pass' &&
      (await run({ cardLabels: ['docs'], cardEvents: [AT('labeled', '2026-11-15T03:00:00Z', 'docs'), AT('unlabeled', '2026-11-15T03:10:00Z', 'pm:queue')] }))?.state === 'pass');
    assert('⛔ CARD-LABEL a-landing-whose-PR-names-no-card-is-a-stage-BREACH-the-arm-reads-Tier-H-on-it',
      await stageBreach({ pull: { body: 'Clause-②: no\nMetadata-protocol: none\n' } }, /^the labels of its card were not read \(no card could be derived for it/) === true);
    assert('⛔ CARD-LABEL card-labels-or-a-card-timeline-that-could-not-be-read-are-NOT-MEASURED-never-PASS-and-never-a-BREACH',
      await unmeasured({ throws: 'labels' }, /the labels of its card #69 could not be read as they stood at the landing \(card #69's labels could not be read \(HTTP 502\)\)/) === true &&
      await unmeasured({ throws: 'card-timeline' }, /the labels of its card #69 could not be read as they stood at the landing \(HTTP 502\)/) === true &&
      await unmeasured({ labelReader: false }, /no label reader was supplied to this leg/) === true);
    // Every OTHER card the pull names is read as it stood at the landing too: a `Part of` beside the `Fixes`, the card
    // the branch is named for, a `Refs` — the cards the delivery relation does not answer with.
    const ALSO = { pull: { body: `${BODY}\nPart of #71\n` } };
    const alsoCarries = /^card #71, which it also names, carries the `security` label$/;
    assert('⛔ NAMED-CARDS another-card-the-pull-names-carrying-security-AT-the-landing-is-a-stage-BREACH-that-names-it',
      await stageBreach({ ...ALSO, cardLabelsBy: { 71: ['security'] } }, alsoCarries) === true &&
      await stageBreach({ pull: { headRef: 'claude/issue-71-x' }, cardLabelsBy: { 71: ['docs', 'Security'] } }, alsoCarries) === true &&
      await stageBreach({ pull: { body: `${BODY}\nRefs #71\n` }, cardEventsBy: { 71: [AT('labeled', '2026-11-15T03:00:00Z'), AT('unlabeled', '2026-11-15T06:00:00Z')] } }, alsoCarries) === true &&
      await stageBreach({ ...ALSO, cardEventsBy: { 71: [AT('labeled', '2026-11-15T03:00:00Z'), AT('unlabeled', '2026-11-15T03:30:00Z')] } }, /^the timeline of card #71, which it also names, shows the `security` label removed$/) === true);
    assert('⭐ NAMED-CARDS both-cards-clean-is-PASS-with-both-read-and-a-label-put-on-the-other-card-AFTER-the-landing-is-not-the-landing', await (async () => {
      const seen = [];
      const clean = await run({ ...ALSO, seen });
      const after = await run({ ...ALSO, cardLabelsBy: { 71: ['security'] }, cardEventsBy: { 71: [AT('labeled', '2026-11-15T06:00:00Z')] } });
      const onAndOffAfter = await run({ ...ALSO, cardEventsBy: { 71: [AT('labeled', '2026-11-15T06:00:00Z'), AT('unlabeled', '2026-11-15T07:00:00Z')] } });
      return clean?.state === 'pass' && seen.join() === '69,71' && after?.state === 'pass' && onAndOffAfter?.state === 'pass' ? true : JSON.stringify([clean, seen, after, onAndOffAfter]);
    })() === true);
    assert('⛔ NAMED-CARDS another-card-that-could-not-be-read-as-it-stood-is-NOT-MEASURED-never-PASS-and-never-a-BREACH',
      await unmeasured({ ...ALSO, cardLabelsBy: { 71: 'throw' } }, /^the labels of card #71, which it also names, could not be read as they stood at the landing \(card #71's labels could not be read \(HTTP 502\)\)$/) === true &&
      await unmeasured({ ...ALSO, cardLabelsBy: { 71: ['security'] }, cardEventsBy: { 71: 'throw' } }, /^the labels of card #71, which it also names, could not be read as they stood at the landing \(HTTP 502\)$/) === true &&
      await unmeasured({ ...ALSO, rd: { ...readers, recognisers: { ...readers.recognisers, namedCards: undefined } } }, /^the other cards it names could not be read as they stood at the landing \(the cards the pull request names were not listed for this leg\)$/) === true);
    assert('⛔ NAMED-CARDS a-landing-that-names-more-cards-than-the-leg-reads-is-a-stage-BREACH-not-a-failed-read-and-reads-only-its-first-card', await (async () => {
      const seen = [];
      const over = await stageBreach({ seen, pull: { body: `${BODY}\n${Array.from({ length: 9 }, (_, i) => `Part of #${71 + i}`).join('\n')}\n` } }, /^the other cards it names were not read \(it names 9 more cards \(#71, #72, #73, …\), over the 8 this leg reads\), so a `security` label on one of them cannot be ruled out$/);
      return over === true && seen.join() === '69' ? true : `${over} ${seen.join()}`;
    })() === true);
    // ⛔ The two reads the stage itself can lose are NOT MEASURED, never a BREACH and never a PASS: a line the guard's
    // stage reader could not read (defensive: a record that stands was read by the same recognisers, so only a guard
    // that answers so reaches it), and a git read that answered the first arm read and failed the second.
    assert('⛔ RECORD-STAGE a-stage-whose-line-could-not-be-read-and-a-git-read-that-failed-on-the-second-pass-are-NOT-MEASURED', await (async () => {
      const seen = [];
      const noReader = await run({ seen, rd: { ...readers, guard: { ...readers.guard, lowRiskRecordStage: () => ({ measured: false, reason: 'the record reader was not loaded' }) } }, cardLabels: ['security'] });
      // The rule-age read sits between the two arm reads, so a `diff-tree` after it is the second pass's.
      const failsSecond = () => { let bound = false; return (a) => { if (a[0] === 'cat-file') bound = true; if (bound && a[0] === 'diff-tree') throw new Error('fatal: bad object'); return runGit(a); }; };
      const secondPass = await run({ git: failsSecond() });
      const secondPassNoLine = await run({ git: failsSecond(), prRows: [record({ line: null })] });
      return noReader?.state === 'not-measured' && noReader.reason === "its record's `Security-touching:` line could not be read (the record reader was not loaded)" && seen.length === 0 &&
        secondPass?.state === 'not-measured' && secondPass.reason === 'the low-risk arm could not re-read `git diff-tree -r` (fatal: bad object) for its record stage' &&
        secondPassNoLine?.state === 'not-measured' && secondPassNoLine.reason === secondPass.reason ? true : JSON.stringify([noReader, secondPass, secondPassNoLine, seen]);
    })() === true);
    assert('the-record-stage-is-read-only-on-a-record-that-stands-past-the-approval-and-enqueue-legs', await (async () => {
      const seen = [];
      await run({ seen, reviews: [APPROVED('os-zhuang')] });
      await run({ seen, events: QUEUED('os-zhuang') });
      await run({ seen, pull: { labels: ['security'] } });
      await run({ seen, prRows: [] });
      await run({ seen, prRows: [record({ verdict: '**VERDICT: FAIL**' })] });
      const before = seen.length;
      await run({ seen });
      return before === 0 && seen.join() === '69' ? true : JSON.stringify(seen);
    })() === true);
    {
      const landedAt = Date.parse(MERGED_AT);
      const asLanded = (labels, events) => cardLabelsAsLanded({ measured: true, reason: null, card: 69, labels, timeline: { measured: true, reason: null, events } }, landedAt);
      const onThenOffAfter = asLanded([], [AT('labeled', '2026-11-15T03:00:00Z'), AT('unlabeled', '2026-11-15T06:00:00Z')]);
      const onThenOffBefore = asLanded([], [AT('labeled', '2026-11-15T03:00:00Z'), AT('unlabeled', '2026-11-15T03:30:00Z')]);
      assert('cardLabelsAsLanded-rebuilds-the-security-label-from-the-card-timeline-and-reads-an-untimed-event-as-before-the-landing',
        asLanded(['security'], []).labels.join() === 'security' && asLanded([], []).labels.length === 0 && asLanded(['docs', 'security'], []).labels.join() === 'security' &&
        asLanded(['security'], [AT('labeled', '2026-11-15T06:00:00Z')]).labels.length === 0 && asLanded(['security'], [AT('labeled', MERGED_AT)]).labels.length === 0 &&
        onThenOffAfter.labels.join() === 'security' && onThenOffAfter.timeline.events.length === 1 && onThenOffBefore.labels.length === 0 && onThenOffBefore.timeline.events.length === 2 &&
        asLanded([], [{ event: 'unlabeled', label: { name: 'security' } }]).timeline.events.length === 1 && asLanded([], [{ event: 'labeled', label: { name: 'Security' } }]).labels.join() === 'security' &&
        asLanded(['docs'], [AT('labeled', '2026-11-15T03:00:00Z', 'docs')]).timeline.events.length === 0 && onThenOffAfter.card === 69 && onThenOffAfter.measured === true && onThenOffAfter.timeline.measured === true,
        JSON.stringify([onThenOffAfter, onThenOffBefore]));
    }
    assert('the-stage-BREACH-cell-names-the-record-stage-and-the-CLEARED-cell-claims-no-tier-the-record-stage-was-never-read',
      armCell({ arm: { state: 'breach', stage: true, headSha: HEAD, reason: 'x' } }).endsWith('⛔ BREACH — low-risk arm landing on head bbbbbbbbbbbb on a record stage that reads Tier H: x') &&
      armCell({ arm: { state: 'breach', headSha: HEAD, reason: 'x' } }).endsWith('WITHOUT a same-head at-tier PASS record: x') &&
      (() => { const cell = armCell({ arm: { state: 'cleared', by: 'review', who: ['os-zhuang'], headSha: HEAD } }); return cell.includes('its pull-read conditions held on head bbbbbbbbbbbb, cleared by an authorized approval (os-zhuang) before the record was read') && !cell.includes('Tier S'); })());
    // ⛔ A favourable stand-in read never answers the record stage: an unread git input whose stand-in leaves every
    // pull-read condition holding comes back PENDING, which settles nothing — NOT MEASURED, never `tier-h` on the
    // pending reason and never a `Security-touching: no`.
    assert('⛔ RECORD-STAGE a-favourable-stand-in-read-leaves-the-stage-PENDING-so-it-settles-nothing-and-never-reads-no', await (async () => {
      const failing = (a) => { if (a[0] === 'diff-tree') throw new Error('fatal: bad object'); return runGit(a); };
      const withLine = await run({ git: failing });
      const without = await run({ git: failing, prRows: [record({ line: null })] });
      return withLine?.state === 'not-measured' && without?.state === 'not-measured' && !withLine.reason.includes('Security-touching') && /so its Tier H cannot say how the queue read it/.test(without.reason) ? true : JSON.stringify([withLine, without]);
    })() === true);

    // The record stage binds a landing only when its own tree carries it: the queue leg runs this file from the merge
    // group's tree, so a landing whose tree predates the stage stood on its record alone and is no BREACH of a rule
    // that did not exist yet. ⛔ A tree that cannot be read is NOT MEASURED — never PASS on a guess, never a BREACH.
    const treeGit = (text) => (a) => { if (a[0] !== 'cat-file') return runGit(a); if (text === null) throw new Error('fatal: path does not exist'); return text; };
    assert('⭐ RULE-AGE a-landing-whose-own-tree-predates-the-record-stage-is-PASS-on-its-record-alone-and-reads-no-card', await (async () => {
      const seen = [];
      const noLine = await run({ seen, git: treeGit(OLD_RULE_TREE), prRows: [record({ line: null })] });
      const labelled = await run({ seen, git: treeGit(OLD_RULE_TREE), cardLabels: ['security'] });
      const cell = armCell({ arm: noLine });
      return noLine?.state === 'pass' && noLine.stageBound === false && noLine.record.id === 900 && labelled?.state === 'pass' && labelled.stageBound === false && seen.length === 0 &&
        cell.includes('same-head at-tier PASS record PR comment 900 (its landed tree predates the record stage, so its queue read the record alone)') ? true : JSON.stringify([noLine, labelled, seen, cell]);
    })() === true);
    assert('⛔ RULE-AGE control-the-same-landings-on-a-tree-that-carries-the-stage-are-stage-BREACHES-and-a-bound-PASS-carries-no-flag',
      await stageBreach({ git: treeGit(RULE_TREE), prRows: [record({ line: null })] }, /carries no `Security-touching:` line$/) === true &&
      await stageBreach({ git: treeGit(RULE_TREE), cardLabels: ['security'] }, /^its card #69 carries the `security` label$/) === true &&
      !('stageBound' in (await run({ git: treeGit(RULE_TREE) }))) && !armCell({ arm: pass }).includes('predates'));
    assert('⛔ RULE-AGE a-landed-tree-that-cannot-be-read-is-NOT-MEASURED-never-PASS-and-never-a-BREACH',
      await unmeasured({ git: treeGit(null) }, /^its landed tree's `scripts\/pm\/check-governed-merges\.mjs` could not be read, so whether the queue read the record stage for it is not known$/) === true &&
      await unmeasured({ git: treeGit(null), prRows: [record({ line: null })] }, /could not be read, so whether the queue read the record stage/) === true);
    assert('⛔ RULE-AGE an-earlier-tree-excuses-only-the-record-stage-a-landing-with-no-record-is-still-a-BREACH',
      await breach({ git: treeGit(OLD_RULE_TREE), prRows: [] }, /no `## Contract review` record on its head/) === true &&
      await breach({ git: treeGit(OLD_RULE_TREE), prRows: [record({ verdict: '**VERDICT: FAIL**' })] }, /does not read PASS/) === true &&
      await tierH({ git: treeGit(OLD_RULE_TREE), pull: { labels: ['security'] } }, /`security` label/) === true);
    assert('⛔ RULE-AGE the-declaration-the-sweep-looks-for-is-this-files-own-and-a-quoted-copy-of-it-does-not-count',
      LOW_RISK_RECORD_STAGE_DECLARED.test(readFileSync(scriptPath, 'utf8')) && scriptPath.replaceAll('\\', '/').endsWith(`/${ARM_RULE_PATH}`) &&
      armRecordStageBound(() => RULE_TREE, LANDED) === true && armRecordStageBound(() => OLD_RULE_TREE, LANDED) === false && armRecordStageBound(() => { throw new Error('x'); }, LANDED) === null &&
      (() => { const sent = []; armRecordStageBound((a) => { sent.push(a); return ''; }, LANDED); return JSON.stringify(sent) === JSON.stringify([['cat-file', '-p', `${LANDED}:${ARM_RULE_PATH}`]]); })());

    // #33729 N5: a git read the arm needed that failed, or a fork predicate not measured, is NOT MEASURED, never Tier H.
    const gitWith = (over) => (args) => (over(args) ?? runGit(args));
    assert('⛔ #33729-N5-an-unread-diff-tree-status-is-NOT-MEASURED-not-tier-h', await unmeasured({ git: gitWith((a) => { if (a[0] === 'diff-tree') throw new Error('fatal: bad object'); }) }, /could not read `git diff-tree.*bad object.*so its Tier H cannot say how the queue read it/) === true);
    assert('⛔ #33729-N5-an-unread-changeset-the-commit-still-holds-is-NOT-MEASURED', await unmeasured({ git: gitWith((a) => {
      if (a[0] === 'show') throw new Error('fatal: unable to read');
      if (a[0] === 'ls-tree') return `${CS}\0`;
    }) }, /could not read `git show/) === true);
    assert('⛔ #33729-N5-a-fork-predicate-not-measured-is-NOT-MEASURED', await unmeasured({ pull: { fork: { measured: false, isFork: false } } }, /the fork predicate/) === true);
    assert('#33729-N5-control-a-changeset-the-commit-DELETED-is-a-measured-Tier-H-not-a-read-failure', await tierH({ git: gitWith((a) => {
      if (a[0] === 'diff-tree') return `:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} M\0${SK}\0:100644 000000 ${'3'.repeat(40)} ${'0'.repeat(40)} D\0${CS}\0`;
      if (a[0] === 'show') throw new Error(`fatal: path '${CS}' does not exist in '${LANDED}'`);
      if (a[0] === 'ls-tree') return '';
    }) }, /was not read at the head/) === true);
    assert('#33729-N5-a-tier-h-cell-says-how-many-reasons-it-did-not-print', armCell({ arm: { state: 'tier-h', reasons: ['a', 'b', 'c', 'd'] } }).endsWith('a; b (+2 more)') && armCell({ arm: { state: 'tier-h', reasons: ['a', 'b'] } }).endsWith('a; b'));
    // #33729 N8: an authorized approval the queue read, dismissed after the landing, still clears it.
    const DISMISSED = (at, state = 'approved') => [...QUEUED('objectstack-fleet[bot]'), { event: 'review_dismissed', created_at: at, dismissed_review: { review_id: 1, state } }];
    const dismissedReview = { ...APPROVED('os-zhuang'), state: 'DISMISSED' };
    assert('⭐ #33729-N8-an-authorized-approval-DISMISSED-after-the-landing-still-clears-it', await cleared({ prRows: [], reviews: [dismissedReview], events: DISMISSED('2026-11-15T06:00:00Z') }, 'review') === true);
    assert('⛔ #33729-N8-a-dismissal-BEFORE-the-landing-or-with-no-event-clears-nothing',
      await breach({ prRows: [], reviews: [dismissedReview], events: DISMISSED('2026-11-15T04:50:00Z') }, /no `## Contract review` record/) === true &&
      await breach({ prRows: [], reviews: [dismissedReview], events: QUEUED('objectstack-fleet[bot]') }, /no `## Contract review` record/) === true &&
      await breach({ prRows: [], reviews: [dismissedReview], events: DISMISSED('2026-11-15T06:00:00Z', 'changes_requested') }, /no `## Contract review` record/) === true);
    // #33729 N9, N10: the edited row is named on every BREACH reason, and only when it is the row the record leg would have read.
    assert('⛔ #33729-N9-an-edited-PASS-beside-an-older-FAIL-is-named-on-the-not-PASS-reason', await breach({ prRows: [record({ verdict: '**VERDICT: FAIL**', at: '2026-11-15T03:00:00Z' }), { ...record({ id: 902 }), updated_at: '2026-11-15T06:00:00Z' }] }, /does not read PASS .*PR comment 902 was edited after the landing/) === true);
    assert('#33729-N10-a-claim-edited-after-the-landing-is-not-named-as-if-it-were-a-record', await (async () => {
      const v = await run({ prRows: [{ id: 950, created_at: '2026-11-15T04:00:00Z', updated_at: '2026-11-15T06:00:00Z', user: { login: RELAY }, body: 'Claim: PM loop' }] });
      return v?.state === 'breach' && /no `## Contract review` record/.test(v.reason) && !v.reason.includes('950') && !v.reason.includes('edited') ? true : JSON.stringify(v);
    })() === true);
    assert('#33729-N10-one-edited-record-beside-an-edited-claim-names-the-record-alone', await (async () => {
      const v = await run({ prRows: [{ ...record(), updated_at: '2026-11-15T06:00:00Z' }, { id: 950, created_at: '2026-11-15T04:00:00Z', updated_at: '2026-11-15T06:00:00Z', user: { login: RELAY }, body: 'Claim: PM loop' }] });
      return v?.state === 'breach' && v.reason.includes('PR comment 900 was edited') && !v.reason.includes('950') ? true : JSON.stringify(v);
    })() === true);
    // #33729 N11: the record leg's own half of the author binding.
    assert('⛔ #33729-N11-a-recogniser-set-that-is-not-available-is-NOT-MEASURED', await unmeasured({ rd: { ...readers, recognisers: { available: false, reason: 'recognisers did not load' } } }, /recognisers did not load/) === true);
    assert('⛔ #33729-N11-a-recogniser-set-with-no-trusted-author-list-is-NOT-MEASURED-never-trust-everyone', await unmeasured({ rd: { ...readers, recognisers: { ...readers.recognisers, trustedAuthors: null } } }, /no trusted-author list/) === true &&
      await unmeasured({ rd: { ...readers, recognisers: { ...readers.recognisers, trustedAuthors: [] } } }, /no trusted-author list/) === true);
    assert('#33729-N11-an-untrusted-PASS-says-its-author-was-not-read-in-the-guards-words', await (async () => {
      const v = await run({ prRows: [record({ by: 'some-commenter' })] });
      const cell = armCell({ arm: v });
      return v?.state === 'breach' && v.ignored?.length === 1 && cell.includes('some-commenter') && cell.includes('#33541') ? true : JSON.stringify(v);
    })() === true);

    // #33765 N-a: a git read that failed, beside a reason the measured inputs give alone, is a measured Tier H.
    const diffTreeThrows = gitWith((a) => { if (a[0] === 'diff-tree') throw new Error('fatal: bad object'); });
    assert('⭐ #33765-N-a-an-unread-diff-tree-beside-a-security-label-is-a-measured-Tier-H-naming-what-it-did-not-read', await (async () => {
      const v = await run({ git: diffTreeThrows, pull: { labels: ['security'] } });
      return v?.state === 'tier-h' && v.reasons.some((r) => /`security` label/.test(r)) && !v.reasons.some((r) => /status and mode/.test(r)) &&
        v.unread?.some((u) => /git diff-tree/.test(u)) && armCell({ arm: v }).includes('settled without the unread `git diff-tree') ? true : JSON.stringify(v);
    })() === true);
    assert('⭐ #33765-N-a-an-unread-changeset-beside-a-Clause-2-yes-body-and-an-unread-fork-beside-a-fork-free-reason-are-Tier-H',
      await tierH({ git: gitWith((a) => { if (a[0] === 'show') throw new Error('fatal: unable to read'); if (a[0] === 'ls-tree') return `${CS}\0`; }), pull: { body: 'Fixes #69\n\nClause-②: yes\nMetadata-protocol: none\n' } }, /Clause-②/) === true &&
      await tierH({ pull: { fork: { measured: false, isFork: false }, labels: ['security'] } }, /`security` label/) === true);
    assert('⛔ #33765-N-a-control-an-unread-read-that-alone-keeps-the-arm-H-stays-NOT-MEASURED-never-measured-S',
      await unmeasured({ git: diffTreeThrows }, /could not read `git diff-tree/) === true &&
      await unmeasured({ git: gitWith((a) => { if (a[0] === 'diff-tree') throw new Error('fatal: bad object'); if (a[0] === 'show') throw new Error('fatal: unable to read'); if (a[0] === 'ls-tree') return `${CS}\0`; }) }, /could not read `git show.*`git diff-tree/) === true);
    assert('⛔ #33765-N-a-an-unread-read-the-arm-has-no-favourable-answer-for-stays-NOT-MEASURED', favourableArmGitRead(['rev-parse', 'x'], [SK]) === null &&
      favourableArmGitRead(['show', `${LANDED}:${CS}`], [SK]) !== null && favourableArmGitRead(['diff-tree', '--raw', LANDED], [SK]).includes(`M\0${SK}\0`));
    // #33539 S7: the ADR leg's patch read has no favourable answer; one that fails alone leaves the landing NOT MEASURED.
    const ADRP = 'docs/adr/0097-upstream-availability.md';
    const adrPatchThrows = (args) => {
      if (args[0] === 'diff-tree' && args.includes('-p')) throw new Error('fatal: bad object');
      if (args[0] === 'diff-tree') return `:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} M\0${ADRP}\0`;
      return runGit(args);
    };
    assert('⛔ #33539-S7-an-ADR-landing-whose-patch-read-alone-fails-stays-NOT-MEASURED-only-the-raw-read-has-a-favourable-answer',
      await unmeasured({ paths: [ADRP], git: adrPatchThrows }, /could not read `git diff-tree/) === true &&
      favourableArmGitRead(addOnlyDiffArgv(['diff-tree', '-p', '--no-commit-id', '-m', '--first-parent'], [LANDED], ADRP), [ADRP]) === null &&
      favourableArmGitRead(['diff-tree', '-r', '--no-commit-id', '--no-renames', '--raw', '-z', '-m', '--first-parent', LANDED], [ADRP]) !== null);
    // #33765 N-b: an unread labels list is an unread input, though no git read failed.
    assert('⛔ #33765-N-b-an-unread-labels-list-alone-is-NOT-MEASURED-not-tier-h', await unmeasured({ pull: { labels: null } }, /could not read its labels/) === true &&
      armReadsNotMeasured([], { measured: true }, runGit, null).includes('its labels') && armReadsNotMeasured([], { measured: true }, runGit).length === 0);
    assert('#33765-N-b-an-unread-labels-list-beside-a-Clause-2-yes-body-is-a-measured-Tier-H', await tierH({ pull: { labels: null, body: 'Fixes #69\n\nClause-②: yes\nMetadata-protocol: none\n' } }, /Clause-②/) === true);
    // #33765 N-f: the argv the guard really sends for a changeset is the spelling the deletion exception and the
    // favourable answer key on; a renamed read reds here instead of folding the exception into NOT MEASURED.
    assert('⛔ #33765-N-f-the-guards-changeset-and-status-reads-are-the-spellings-the-arm-keys-on', await (async () => {
      const sent = [];
      await run({ git: (a) => { sent.push(a); return runGit(a); } });
      const shows = sent.filter((a) => a[0] === 'show');
      const trees = sent.filter((a) => a[0] === 'diff-tree');
      return shows.length > 0 && trees.length > 0 && shows.every((a) => a.length === 2 && ARM_CHANGESET_SHOW.test(a[1]) && a[1] === `${LANDED}:${CS}`) &&
        [...shows, ...trees].every((a) => favourableArmGitRead(a, [SK, CS]) !== null) ? true : JSON.stringify(sent);
    })() === true);
    // #33765 N-e: an edited `Regen-provenance:` hop that breaks the carry is named on the BREACH reason.
    const OLD = 'd'.repeat(40);
    const HOP = (over = {}) => ({ id: 905, created_at: '2026-11-15T04:10:00Z', user: { login: RELAY }, body: `Regen-provenance: 900 · \`${OLD}\` → \`${HEAD}\` · \`git diff --name-only\` → (empty)`, ...over });
    const carryGit = gitWith((a) => {
      if (a[0] === 'diff') return '';
      if (a[0] === 'rev-parse' && String(a[1]).endsWith('^{commit}')) return `${String(a[1]).slice(0, -'^{commit}'.length)}\n`;
    });
    assert('#33765-N-e-control-a-record-carried-over-an-unedited-hop-is-PASS', (await run({ prRows: [record({ head: OLD, at: '2026-11-15T03:00:00Z' }), HOP()], git: carryGit }))?.state === 'pass');
    assert('⛔ #33765-N-e-a-Regen-provenance-hop-edited-after-the-landing-is-named-on-the-BREACH', await breach({ prRows: [record({ head: OLD, at: '2026-11-15T03:00:00Z' }), HOP({ updated_at: '2026-11-15T06:00:00Z' })], git: carryGit },
      /no `## Contract review` record on its head .*PR comment 905 was edited after the landing.*`Regen-provenance:` hop/) === true);
    assert('#33765-N-e-an-edited-claim-beside-a-carry-is-still-not-named', await (async () => {
      const v = await run({ prRows: [record({ head: OLD, at: '2026-11-15T03:00:00Z' }), HOP({ updated_at: '2026-11-15T06:00:00Z' }), { id: 950, created_at: '2026-11-15T04:00:00Z', updated_at: '2026-11-15T06:00:00Z', user: { login: RELAY }, body: 'Claim: PM loop' }], git: carryGit });
      return v?.state === 'breach' && v.reason.includes('PR comment 905') && !v.reason.includes('950') ? true : JSON.stringify(v);
    })() === true);
    // #33765 N-g, pinned as is: a dismissal in the landing's own second is read as after it and restores the approval.
    assert('#33765-N-g-a-dismissal-in-the-same-second-as-the-landing-restores-the-approval-pinned-as-is', await cleared({ prRows: [], reviews: [dismissedReview], events: DISMISSED(MERGED_AT) }, 'review') === true);

    const at = (e, arm) => ({ ...e, attribution: { mergedBy: 'os-zhuang', mergedAt: MERGED_AT, title: 't', size: null }, attributionChannel: 'env-token', arm });
    const human = at(classifyCommit({ sha: 'e'.repeat(40), date: MERGED_AT, subject: 'docs(adr): x (#71)' }, ['docs/adr/0001-x.md'], OS), undefined);
    const report = renderReport({ window: dateWindowFor('2026-11-14T00:00:00Z'), repos: allAudited, scanned: 3, lookups: 3,
      entries: [at(entryOf(), pass), at({ ...entryOf(), pr: 72, subject: 'docs(skills): y (#72)' }, { state: 'breach', headSha: HEAD, reason: 'no record', record: {} }), human,
        at({ ...entryOf(), pr: 73, subject: 'docs(skills): z (#73)' }, { state: 'cleared', by: 'enqueue', who: ['os-zhuang'], headSha: HEAD })] });
    const apart = report.indexOf('Low-risk skills arm landings');
    assert('⭐ the-report-head-counts-the-arm-landings-and-their-breaches', report.includes('of which 2 landed through the low-risk skills arm, 1 of them ⛔ BREACH'), report);
    assert('⭐ arm-landings-are-listed-AFTER-the-maintainers-list-never-in-it', apart > report.indexOf('PR #71') && report.indexOf('PR #70') > apart && report.indexOf('PR #72') > apart, report);
    assert('⭐ a-CLEARED-arm-landing-stays-on-the-maintainers-list-and-says-who-cleared-it', report.indexOf('PR #73') < apart && report.includes('cleared by an authorized enqueue (os-zhuang)'), report);
    assert('the-PASS-row-names-its-record-and-the-BREACH-row-says-BREACH', report.includes('same-head at-tier PASS record PR comment 900') && report.includes('⛔ BREACH — low-risk arm landing'), report);
    assert('tier-h-and-not-measured-rows-stay-on-the-maintainers-list-with-their-reason', armCell({ arm: { state: 'tier-h', reasons: ['the PR carries the `security` label'] } }).includes('Tier H') &&
      armCell({ arm: { state: 'not-measured', reason: 'x' } }).includes('NOT MEASURED') && armCell({}) === '');
    assert('a-report-with-no-arm-reading-prints-no-arm-line', !renderReport({ window: dateWindowFor('2026-11-14T00:00:00Z'), repos: allAudited, scanned: 1, lookups: 1, entries: [human] }).includes('low-risk'));
    const banner = [];
    const code = reportSweepIncomplete({ unaudited: [], edged: [], attributionFailed: false, rearm: { hint: false }, armUnmeasured: 2 }, (l) => banner.push(l));
    assert('⛔ an-unmeasured-arm-reading-makes-the-sweep-INCOMPLETE-and-says-so', code === EXIT_INCOMPLETE && banner.join('').includes('2 skills landing(s) whose low-risk arm reading or record could not be read'), banner.join(''));
    const own = readFileSync(scriptPath, 'utf8');
    assert('⛔ structural-neither-dispatch-awaits-at-module-scope-or-the-lazy-guard-import-deadlocks', !/^\s*process\.exitCode = await main\(\);$/m.test(own) && !/^\s*if \(\(await selfTest\(\)\)/m.test(own) && /^\s*main\(\)\.then\(/m.test(own) && /^\s*selfTest\(\)\.then\(/m.test(own));
  }

  // ── ⭐ the weekly audit card: every reading the job files on, both ways (#33814) ──
  //
  // The readings the `governed-merges-audit` job of fleet-patrols.yml files its card on, lifted out of the job's
  // inline scripts. Each review follow-up the card fixes is pinned with its control: the reading that changed,
  // and the neighbouring input that must still read as it did.
  battery('⭐ the weekly audit card: every reading the job files on, both ways (#33814)');
  {
    const SHA = (c) => c.repeat(40);
    const sweepOf = (entries, extra = {}) => JSON.stringify({ since: '2026-11-08T00:00:00Z', scanned: 9, complete: true, repos: [{ slug: 'objectstack-ai/objectstack', status: 'audited' }], entries, ...extra });
    const armEntry = (pr, arm, more = {}) => ({ pr, sha: SHA(String(pr % 10)), subject: `docs(skills): x (#${pr})`, arm, attribution: { mergedBy: 'os-steve', mergedAt: '2026-11-10T00:00:00Z' }, ...more });

    // N4: a governed landing with no PR number reads NOT MEASURED, never clean.
    const noPr = readAuditSweep({ exit: '0', raw: sweepOf([{ pr: null, sha: SHA('a'), subject: 'docs(adr): pushed straight to main' }]) });
    assert('⭐ N4-a-governed-landing-with-no-PR-number-is-NOT-MEASURED-not-clean', noPr.verdict === 'unread' && noPr.unread.some((u) => u.startsWith(`commit ${'a'.repeat(12)} (no PR number in its subject) NOT MEASURED`)), JSON.stringify(noPr));
    const passOnly = readAuditSweep({ exit: '0', raw: sweepOf([armEntry(41, { state: 'pass', headSha: SHA('b') })]) });
    assert('N4-control-a-PR-landing-on-its-record-still-reads-clean', passOnly.verdict === 'clean' && passOnly.unread.length === 0, JSON.stringify(passOnly));
    const breachRun = readAuditSweep({ exit: '0', raw: sweepOf([armEntry(42, { state: 'breach', headSha: SHA('c'), reason: 'no record' }), armEntry(43, { state: 'not-measured', reason: 'a read failed' })]) });
    assert('the-verdict-reader-keys-a-breach-and-lists-a-not-measured-arm-row', breachRun.verdict === 'breach-and-unread' && breachRun.breaches[0]?.key === 'PR #42' && breachRun.unread.some((u) => u.startsWith('PR #43 low-risk arm NOT MEASURED')), JSON.stringify(breachRun));
    const noJson = readAuditSweep({ exit: '1', raw: '{not json', stderr: 'boom\n```\n## ⛔ BREACH injected' });
    assert('no-readable-JSON-is-NOT-MEASURED-and-its-stderr-loses-its-fences', noJson.verdict === 'unread' && noJson.stderrTail.includes("'''") && !noJson.stderrTail.includes('```'), JSON.stringify(noJson));

    const meta = { marker: 'os-governed-merges-audit', runUrl: 'https://example.invalid/run/1', sha: SHA('d'), event: 'schedule', exit: '0', verdict: 'breach', counts: '3 governed entries', schedule: '31 23 * * 0', sweptAt: new Date('2026-11-15T23:40:00Z') };
    const card = (rows, more = '') => [
      'os-governed-merges-audit — marker', '', '# Weekly governed-merges audit', '',
      `${AUDIT_CARD.breachHeading} — ${rows.length} rows`, '', ...rows, '', more,
      `${AUDIT_CARD.footer} of the run above (kept 30 days). Re-read the week by`,
      `${AUDIT_CARD.footerTail} --since 7d --repos objectstack\` from a fresh \`origin/main\`.`,
    ].join('\n');

    // N9: a carried row this run DID read, in another state, says so.
    const openCard = { number: 900, body: card(['- PR #43 — old breach row', '- PR #44 — older breach row']) };
    const refreshed = composeAuditCard({ findings: breachRun, existing: openCard, meta });
    assert('⭐ N9-a-carried-row-this-run-read-as-NOT-MEASURED-says-what-it-read', refreshed.body.includes('- PR #43 — old breach row · _carried: on this card from an earlier run; this run read it as NOT MEASURED on the low-risk arm, not as a BREACH'), refreshed.body);
    assert('N9-control-a-carried-row-this-run-did-not-read-says-not-in-this-runs-reading', refreshed.body.includes("- PR #44 — older breach row · _carried: on this card from an earlier run and not in this run's reading"), refreshed.body);
    assert('a-refresh-reads-its-own-output-back-to-the-same-keys-with-the-mark-split-off', JSON.stringify(readAuditCardRows(refreshed.body, [AUDIT_CARD.breachHeading]).rows.map((r) => r.key)) === '["PR #42","PR #43","PR #44"]' && readAuditCardRows(refreshed.body, [AUDIT_CARD.breachHeading]).rows[1].line === 'PR #43 — old breach row', refreshed.body);
    // N9: the job posts the comment BEFORE it rewrites the body.
    const workflow = readFileSync(resolve(repoRoot, '.github/workflows/fleet-patrols.yml'), 'utf8');
    const cardStep = workflow.slice(workflow.indexOf('- name: File or refresh the audit card'), workflow.indexOf('- name: Fail the run if the sweep did not read its whole window'));
    assert('⭐ N9-the-job-posts-the-refresh-comment-before-it-rewrites-the-body', auditRefreshOrderFault(cardStep) === null, auditRefreshOrderFault(cardStep));
    assert('N9-control-the-order-reader-reds-the-reverse-order', auditRefreshOrderFault('issues.update({}); issues.createComment({})') !== null);
    const named = [...new Set([...workflow.matchAll(/\baudit\.([A-Za-z]+)\(/g)].map((m) => m[1]))];
    const own = await import(import.meta.url);
    assert('every-audit-reader-the-job-calls-is-an-export-of-this-file', named.length >= 7 && named.every((n) => typeof own[n] === 'function'), named.join(', '));

    // N8: the body is bounded in characters, and the counts are of the rows ON the card.
    const many = Array.from({ length: 120 }, (_, i) => ({ key: `PR #${1000 + i}`, line: `PR #${1000 + i} — ${'x'.repeat(2000)}` }));
    const huge = composeAuditCard({ findings: { breaches: many, unread: ['one unread row'], readings: {} }, existing: null, meta });
    const hugeRows = readAuditCardRows(huge.body, [AUDIT_CARD.breachHeading]).rows.length;
    assert('⭐ N8-a-card-of-120-long-rows-is-fitted-under-the-body-bound', huge.body.length <= AUDIT_CARD.bodyChars && hugeRows > 0 && hugeRows < 100, `${huge.body.length} chars, ${hugeRows} rows`);
    assert('⭐ N8-the-heading-counts-the-rows-on-the-card-and-names-the-rest', huge.body.includes(`— ${hugeRows} low-risk skills arm landing(s) without a same-head at-tier PASS record on this card (${hugeRows} read by this run, 0 carried from earlier runs); ${120 - hugeRows} more did not fit`), huge.body.split('\n').find((l) => l.startsWith(AUDIT_CARD.breachHeading)));
    const small = composeAuditCard({ findings: { breaches: many.slice(0, 3).map((b) => ({ ...b, line: `${b.key} — short` })), unread: [], readings: {} }, existing: null, meta });
    assert('N8-control-a-small-card-keeps-every-row-and-names-no-overflow', readAuditCardRows(small.body, [AUDIT_CARD.breachHeading]).rows.length === 3 && !small.body.includes('did not fit'), small.body);
    const capped = composeAuditCard({ findings: { breaches: many.map((b) => ({ ...b, line: `${b.key} — short` })), unread: [], readings: {} }, existing: { number: 901, body: card([]) }, meta });
    assert('N8-past-the-row-cap-the-comment-counts-carried-rows-on-the-card-and-the-overflow-apart', capped.comment.includes('carried from earlier runs: 0 on the card.') && capped.comment.includes('20 BREACH row(s) did not fit the card and are NOT carried'), capped.comment);
    // Review S3: the dropped rows are NAMED, and a dropped carried row is never said to be in the run log.
    assert('⭐ S3-the-refresh-comment-names-every-dropped-key-read-by-this-run', capped.comment.includes(`read by this run (in its run log and artifact): ${many.slice(100).map((b) => b.key).join(', ')}.`) && !capped.comment.includes('held by no run'), capped.comment);
    const carriedOver = composeAuditCard({ findings: { breaches: many.slice(0, 100).map((b) => ({ ...b, line: `${b.key} — short` })), unread: [], readings: {} }, existing: { number: 904, body: card(['- PR #7001 — carried a', '- PR #7002 — carried b']) }, meta });
    assert('⭐ S3-a-dropped-carried-row-is-named-as-held-by-no-runs-reading', carriedOver.comment.includes("carried from earlier runs and held by no run's reading, so this comment is their last record: PR #7001, PR #7002.") && carriedOver.body.includes("2 carried from earlier runs and held by no run's reading") && !carriedOver.body.includes('see the run log and the artifact'), carriedOver.comment);
    const newLine = capped.comment.split('\n').find((l) => l.includes('new to this card')) ?? '';
    assert('a-row-that-did-not-fit-is-not-announced-as-new-to-this-card', newLine.includes('PR #1099') && !newLine.includes('PR #1100'), newLine);
    const flood = composeAuditCard({ findings: { breaches: Array.from({ length: 100 + AUDIT_CARD.droppedKeysCap + 7 }, (_, i) => ({ key: `PR #${20000 + i}`, line: `PR #${20000 + i} — s` })), unread: [], readings: {} }, existing: { number: 906, body: card([]) }, meta });
    assert('the-dropped-key-list-is-capped-and-counts-the-rest', flood.comment.includes(' and 7 more.') && flood.comment.length < 65536, flood.comment.length);
    assert('S3-control-a-card-that-fits-names-no-dropped-row', !refreshed.comment.includes('did not fit') && !refreshed.body.includes('did not fit'), refreshed.comment);

    // N10: a close is a ruling only by an authorized approver's hand.
    const now = Date.parse('2026-11-15T23:40:00Z');
    const closedCard = (number, close, more = {}) => ({ number, body: card(['- PR #50 — ruled row']), state_reason: 'completed', closed_at: '2026-11-12T00:00:00Z', close, ...more });
    // The approver list is the queue guard's own `GOVERNED_APPROVERS`, loaded exactly as the job loads it: no second
    // literal list here to drift from the constant (2026-11-17 removed `hotlong` from it — 「hotlong 从批准账户中去掉，只保留
    // os-zhuang」 — and that account's hand close is pinned below as ruling nothing).
    const rulingAccounts = await loadAuditRulingAccounts();
    const approvers = rulingAccounts.accounts;
    assert('N10-the-approver-list-is-the-queue-guards-GOVERNED_APPROVERS-not-a-copy', rulingAccounts.available && approvers.join() === 'os-zhuang', JSON.stringify(rulingAccounts));
    const byHand = ruledAuditRows([closedCard(910, { actor: 'os-zhuang', commitId: null, app: null })], { now, approvers });
    assert('⭐ N10-an-approvers-hand-close-rules-its-rows', byHand.ruled.get('PR #50') === 910 && byHand.unruled.length === 0, JSON.stringify([...byHand.ruled]));
    for (const [name, c, more] of [
      ['a-seats-close', { actor: 'objectstack-fleet[bot]', commitId: null, app: null }, {}],
      ['a-closing-keyword-by-an-approver', { actor: 'os-zhuang', commitId: SHA('e'), app: null }, {}],
      ['the-stale-bot', { actor: 'github-actions[bot]', commitId: null, app: null }, { state_reason: 'not_planned' }],
      ['an-unreadable-close-event', null, {}],
      ['a-duplicate-close', { actor: 'os-zhuang', commitId: null, app: null }, { state_reason: 'duplicate' }],
      ['a-hand-close-by-the-account-removed-from-the-approvers-2026-11-17', { actor: 'hotlong', commitId: null, app: null }, {}],
    ]) {
      const r = ruledAuditRows([closedCard(911, c, more)], { now, approvers });
      assert(`⭐ N10-${name}-rules-nothing`, r.ruled.size === 0 && r.unruled[0]?.number === 911, JSON.stringify(r.unruled));
    }
    // Review S1: the app field is read by PRESENCE. An object (named or not) rules nothing, an absent key is an
    // unreadable event, and null (what the platform serves on every close today) leaves the login test to decide.
    const viaApp = ruledAuditRows([closedCard(913, { actor: 'os-zhuang', commitId: null, app: { slug: 'claude' } }), closedCard(916, { actor: 'os-zhuang', commitId: null, app: {} })], { now, approvers });
    assert('⭐ S1-a-close-with-an-app-object-named-or-not-rules-nothing', viaApp.ruled.size === 0 && viaApp.unruled.length === 2 && viaApp.unruled.every((u) => /closed through a GitHub App on os-zhuang/.test(u.why)), JSON.stringify(viaApp.unruled));
    const noKey = ruledAuditRows([closedCard(917, { actor: 'os-zhuang', commitId: null })], { now, approvers });
    assert('⭐ S1-a-close-event-without-the-app-key-is-unreadable-and-rules-nothing', noKey.ruled.size === 0 && /does not carry `performed_via_github_app`/.test(noKey.unruled[0]?.why ?? ''), JSON.stringify(noKey.unruled));
    assert('S1-control-the-same-account-closing-with-a-null-app-rules', ruledAuditRows([closedCard(914, { actor: 'os-zhuang', commitId: null, app: null })], { now, approvers }).ruled.size === 1);
    assert('S1-the-job-passes-the-app-field-through-by-presence-not-by-name', /'performed_via_github_app' in last/.test(cardStep) && !/performed_via_github_app\?\.(slug|name)/.test(cardStep), cardStep.slice(0, 200));
    assert('N10-no-approver-list-rules-nothing', ruledAuditRows([closedCard(912, { actor: 'os-zhuang', commitId: null, app: null })], { now, approvers: [] }).ruled.size === 0);

    // N12: every ruled card counts, not only the newest.
    const newerUnreadOnly = { number: 920, body: [`${AUDIT_CARD.unreadHeading} — 1`, '', '- PR #60 low-risk arm NOT MEASURED: x', '', `${AUDIT_CARD.footer} x`].join('\n'), state_reason: 'completed', closed_at: '2026-11-14T00:00:00Z', close: { actor: 'os-zhuang', commitId: null, app: null } };
    const older = closedCard(915, { actor: 'os-zhuang', commitId: null, app: null });
    const both = ruledAuditRows([newerUnreadOnly, older], { now, approvers });
    assert('⭐ N12-an-older-ruling-behind-a-newer-NOT-MEASURED-only-close-still-rules', both.ruled.get('PR #50') === 915 && !both.ruled.has('PR #60'), JSON.stringify([...both.ruled]));
    const olderBySeat = ruledAuditRows([newerUnreadOnly, closedCard(915, { actor: 'os-steve', commitId: null, app: null })], { now, approvers });
    assert('N12-control-an-older-close-that-is-no-ruling-still-rules-nothing', olderBySeat.ruled.size === 0, JSON.stringify([...olderBySeat.ruled]));
    const ruledRun = composeAuditCard({ findings: { breaches: [{ key: 'PR #50', line: 'PR #50 — again' }], unread: [], readings: {} }, existing: null, ruling: both, meta });
    assert('a-run-whose-every-breach-row-is-ruled-and-nothing-unread-files-nothing', ruledRun.action === 'none', JSON.stringify(ruledRun));

    // N15: the ruled horizon is the window's bound, and its edge holds both ways.
    assert('⭐ N15-the-ruled-horizon-covers-the-7-day-window-plus-the-skew-budget', AUDIT_CARD.ruledHorizonDays * 86400 >= 7 * 86400 + 3600);
    const at = (days) => new Date(now - days * 86400000).toISOString();
    assert('N15-a-card-closed-inside-the-horizon-rules-and-one-closed-before-it-does-not',
      ruledAuditRows([closedCard(930, { actor: 'os-zhuang', commitId: null, app: null }, { closed_at: at(AUDIT_CARD.ruledHorizonDays - 1) })], { now, approvers }).ruled.size === 1
      && ruledAuditRows([closedCard(931, { actor: 'os-zhuang', commitId: null, app: null }, { closed_at: at(AUDIT_CARD.ruledHorizonDays + 1) })], { now, approvers }).ruled.size === 0
      && auditRulingCandidates([{ number: 1, closed_at: at(AUDIT_CARD.ruledHorizonDays + 1) }, { number: 2, closed_at: at(1) }, { number: 3, closed_at: at(1), state_reason: 'duplicate' }], now).map((c) => c.number).join() === '2');

    // N18: the card body states the day bound and who rules.
    assert('⭐ N18-the-card-body-states-the-day-bound-of-a-ruling', small.body.includes(`closed within the last ${AUDIT_CARD.ruledHorizonDays} days by an authorized approver's account, with no closing commit, count as`) && !small.body.includes('Rows on the newest closed card count as ruled'), small.body);

    // N13: a keyed row the reader cannot see is counted, not lost.
    const reworded = ['intro', '- PR #70 — moved above every heading', '## ⛔ Breaches (reworded)', '', '- PR #71 — under a reworded heading', `${AUDIT_CARD.footer} x`].join('\n');
    const rw = readAuditCardRows(reworded, [AUDIT_CARD.breachHeading]);
    assert('⭐ N13-rows-under-a-reworded-heading-or-above-every-heading-are-counted-stray', rw.rows.length === 0 && rw.stray.join() === 'PR #70,PR #71', JSON.stringify(rw));
    const kept = readAuditCardRows(card(['- PR #72 — row', 'hand note']), [AUDIT_CARD.breachHeading]);
    assert('N13-control-rows-under-the-real-heading-are-read-and-nothing-is-stray', kept.rows.map((r) => r.key).join() === 'PR #72' && kept.unkeyed === 1 && kept.stray.length === 0, JSON.stringify(kept));
    const strayComment = composeAuditCard({ findings: breachRun, existing: { number: 902, body: reworded }, meta }).comment;
    assert('N13-the-refresh-comment-names-the-stray-rows', strayComment.includes('so not carried: 2 (PR #70, PR #71)'), strayComment);

    // N14: a fenced line that starts with a heading is never a section.
    const fenced = ['## NOT MEASURED — 1', '', '- the sweep left no readable JSON', '', '```', '## ⛔ BREACH from stderr', '- PR #80 — inside the fence', '```', '', `${AUDIT_CARD.footer} x`].join('\n');
    assert('⭐ N14-a-heading-inside-the-quoted-stderr-opens-no-section', readAuditCardRows(fenced, [AUDIT_CARD.breachHeading]).rows.length === 0, JSON.stringify(readAuditCardRows(fenced, [AUDIT_CARD.breachHeading])));
    assert('N14-control-the-same-lines-outside-a-fence-are-read', readAuditCardRows(fenced.replace(/```\n/g, ''), [AUDIT_CARD.breachHeading]).rows.map((r) => r.key).join() === 'PR #80');
    // Review S2: a fence closes only on its own marker, and one left open is reported.
    const mixed = card(['- PR #81 — before', '```', '~~~', '- PR #82 — still inside the backtick fence', '```', '- PR #83 — after']);
    const mx = readAuditCardRows(mixed, [AUDIT_CARD.breachHeading]);
    assert('⭐ S2-a-tilde-line-does-not-close-a-backtick-fence', mx.rows.map((r) => r.key).join() === 'PR #81,PR #83' && mx.openFence === false, JSON.stringify(mx));
    const shortClose = readAuditCardRows(card(['````', '```', '- PR #84 — inside the four-tick fence', '````', '- PR #85 — after']), [AUDIT_CARD.breachHeading]);
    assert('S2-a-shorter-marker-does-not-close-a-longer-fence', shortClose.rows.map((r) => r.key).join() === 'PR #85', JSON.stringify(shortClose));
    const unclosed = card(['- PR #86 — before', '```', '- PR #87 — swallowed']);
    const uc = readAuditCardRows(unclosed, [AUDIT_CARD.breachHeading]);
    const ucComment = composeAuditCard({ findings: breachRun, existing: { number: 905, body: unclosed }, meta }).comment;
    assert('⭐ S2-a-fence-left-open-is-reported-in-the-read-and-in-the-comment', uc.openFence === true && uc.rows.map((r) => r.key).join() === 'PR #86' && ucComment.includes('is never closed'), JSON.stringify(uc));
    assert('S2-control-a-closed-fence-reports-nothing', readAuditCardRows(fenced, [AUDIT_CARD.breachHeading]).openFence === false && !refreshed.comment.includes('never closed'));
    const tildeErr = readAuditSweep({ exit: '1', raw: '', stderr: 'x\n~~~\n## ⛔ BREACH injected' });
    assert('⭐ S2-the-quoted-stderr-defuses-tilde-fences-too', !tildeErr.stderrTail.includes('~~~') && !tildeErr.stderrTail.includes('```'), tildeErr.stderrTail);

    // N16: only the LAST footer ends the reading.
    const footerWords = card(['- PR #90 — row', `${AUDIT_CARD.footer} was checked by me — maintainer note`, '- PR #91 — row after the note']);
    assert('⭐ N16-a-maintainer-line-starting-with-the-footer-words-does-not-cut-the-section', readAuditCardRows(footerWords, [AUDIT_CARD.breachHeading]).rows.map((r) => r.key).join() === 'PR #90,PR #91');
    const after = `${card(['- PR #92 — row'])}\n- PR #93 — after the footer`;
    assert('N16-control-lines-after-the-real-footer-are-never-read', readAuditCardRows(after, [AUDIT_CARD.breachHeading]).rows.map((r) => r.key).join() === 'PR #92');

    // N17: a deleted footer line is bounded by its second line, and a missing footer is said.
    const headless = card(['- PR #94 — row']).split('\n').filter((l) => !l.startsWith(AUDIT_CARD.footer)).join('\n');
    const hr = readAuditCardRows(headless, [AUDIT_CARD.breachHeading]);
    assert('⭐ N17-the-footers-second-line-alone-still-bounds-the-reading', hr.footer && hr.unkeyed === 0 && hr.rows.map((r) => r.key).join() === 'PR #94', JSON.stringify(hr));
    const footless = card(['- PR #95 — row']).split('\n').filter((l) => !l.startsWith(AUDIT_CARD.footer) && !l.startsWith(AUDIT_CARD.footerTail)).concat(['trailing prose']).join('\n');
    const fl = readAuditCardRows(footless, [AUDIT_CARD.breachHeading]);
    const flComment = composeAuditCard({ findings: breachRun, existing: { number: 903, body: footless }, meta }).comment;
    assert('N17-no-footer-at-all-is-reported-not-silent', fl.footer === false && fl.unkeyed === 1 && flComment.includes("footer was not found"), JSON.stringify(fl));
    assert('N17-control-a-whole-footer-is-found-and-the-comment-says-nothing-of-it', readAuditCardRows(card([]), [AUDIT_CARD.breachHeading]).footer === true && !refreshed.comment.includes('footer was not found'));

    // The card's own body round-trips through the reader, and the loader degrades to a reason.
    assert('a-created-body-ends-in-the-footer-pair-the-reader-stops-at', readAuditCardRows(`${small.body}\n- PR #99 — after`, [AUDIT_CARD.breachHeading]).rows.length === 3, small.body.slice(-300));
    const loaded = await loadAuditRulingAccounts();
    const refused = await loadAuditRulingAccounts(async () => ({}));
    assert('the-ruling-accounts-load-from-the-queue-guard-and-a-guard-without-them-is-a-reason', loaded.available && loaded.accounts.length > 0 && !refused.available && refused.accounts.length === 0, JSON.stringify([loaded, refused]));
    assert('the-swept-line-names-the-next-weekly-deadline-and-refuses-an-unreadable-cron', auditSweptExpectation('31 23 * * 0', new Date('2026-11-15T23:40:00Z')).includes('next by 2026-11-22T23:31Z') && auditSweptExpectation('*/5 * * * *', new Date()).includes('UNSTATED'));
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  failures.push(...batteryFloorFailures(batterySeen));

  if (failures.length > 0) {
    console.error(`✗ check-governed-merges --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(`✓ check-governed-merges --self-test: ${checked} assertions (the unified governed predicate + near misses, subject→PR spellings, window parsing, the #12633 landing window — the QS-7 regression pin in both directions, the topological close beyond the budget, the unproven-boundary EDGE, the listed-or-INCOMPLETE invariant over every fixture, the escalating floors, per-repo --since-ref resolution and its named fallback, and the window words — the replay fixtures, the five-repo resolution incl. absent/wrong-origin/relocated checkouts, the attribution channel chain + its proxy-transport re-arm plan and its one named fallback line, the three-way attribution column (resolved · every-channel-failed · NOT LOOKED UP, and the note pointer that belongs to the middle one alone), the --test pre-arm predicate, the generated-artifact provenance exception — the register's invariants incl. the RETIRED #9866 row staying retired (no row lifts anything under .claude/**, and the audit workflow is plainly governed again), a row with no recompute failing closed, lift/reject/absent-provenance semantics, the untouched mixed-diff rule, named-rows-not-a-class, the #11084 generator co-edit fence in both directions incl. a row with no instrument tree, and its render words — the #11705 generator-owned rows inside skills/** (a genuine generated file passes, the same path hand-edited does not, a path no generator declares is hand-authored content, per-row fences, and the enumeration read from the real generator), the exit table, the report wording pins, and the #13307 remote-reachability leg — the pure freshness verdicts in every branch (unreachable · a remote naming no commit · an unreadable local tip · a mirror behind its remote · the two-unreadable-shas degenerate case that must never read as a match), the report words in both directions (an unreachable repo never renders the tick, a reachable one still says a MEASURED zero, and a row with no remote reading never claims one), and the REAL prober on local bare-repo fixtures over the file transport — a live remote, a deleted one, the --exit-code branch, and a mirror the remote moved past — the #13423 identity leg (an origin no slug parses from refuses, pure and end-to-end, with audited reachable only through a parsed matching slug), the #13424 per-repo window resolution (a sibling-only pin resolves in its own repo, the self-only control still errors, and the end-to-end sibling-pin sweep reports instead of exiting 1), the #13307 sweep-code provenance line in all three branches, and the #13836 attribution set — every refusal carries its precondition category on the row, in the footer, and in --json; the shallow-clone path in both directions; and the run-1-vs-run-2 flip reproduced on real fixtures with zero local writes — and the live battery's own PREREQUISITE, asked before a single case runs: an uninstalled checkout refuses with the repo-wide NOT-MEASURED code end to end instead of reporting a shrunken battery, while the floor still names the battery, by itself, for a case that genuinely stopped registering) — and the #15406 replay of PR #15284: the sweep still CLASSIFIES a certified regeneration as a governed merge and still lists it, its row now names the register row it does not recompute and where certification is recorded, and the --test head no longer reports a post-lift zero as if nothing had hit the register — and the #17003 derivation set: the Link walk that ends on rel=next rather than on a short page, a rename reaching the predicate as BOTH of its paths, a walk the PR's own count contradicts refusing rather than answering on a subset, a channel chosen once and never spliced mid-walk, every --branch leg on an injected git incl. the uncomputable merge base that REFUSES instead of falling back to two-dot, and the card's own reproduction run end to end on a real repo — a branch behind a main that has since touched a governed path answers GOVERNED two-dot and NOT governed three-dot, a rename out of a governed path is a hit only because the diff is taken --no-renames, the merge-base refusal prints no verdict at all, and the verdict is byte-identical through --branch and through --test on the same list. — and the #18055 banner set: the INCOMPLETE banner is BUILT on the attribution-failure path instead of throwing while it is built, it still returns EXIT_INCOMPLETE, the proxy hint renders from the plan the sweep now binds and stays empty both when the plan says no hint and when the incompleteness is not about attribution, and a real sweep whose every attribution channel fails prints the banner on STDERR and exits 2 — and the #19133 landing tiers: every register row carries H or S, Tier S is exactly the .claude/** row, a list is S only when every governed path is S (empty or ungoverned answers H), the verdict line and --json carry the tier while both tiers share exit 3, and the tier is recomputed on the lifted slice. — and the 2026-09-18 SIZE predicate: the ruled line, 3,000 since the maintainer's 2026-10-09 word, declared once and pinned on both sides and on the PR that prompted it; the number read off --pr's own GET (its absence a refusal), off --branch's --numstat on the range it lists (binary files at zero, a failed read a refusal), or off --additions/--deletions handed to --test (half a pair refused, the pair refused where the mode reads it itself); NOT MEASURED said on stdout when nothing read it; a certified regeneration lifting the path and not the size; and the verdict still ONE emitter — the governed code for either limb, byte-identical across --branch and --test on the same list and numbers. — and the #18989 guard set: the re-exec guard is the CALLER's name — the default is still this file's own, a caller that names its own guard is suppressed by that one alone, and the patrol's name does not silence this file any more — a suppressed run SPEAKS, naming the variable to unset, the 401 the silence would be read as and the proxy the request was supposed to take, while the Actions-runner leg stays inert and an already-flagged run is still answered by the FLAG; and the plan is declared a MIRROR pinned to its OWNER's source: the patrol's spelling, the patrol's own caller-guard parameter, and the module-scope await that is the measured REASON this is a copy rather than an import. — and the #19036 audit half: the sweep classifies on the SAME predicate the queue and the pre-check answer with (\`landsByHumanMerge\` on \`testVerdict\`), the size read LOCALLY off the landed diff by one \`git diff-tree --numstat\` per mainline commit that also lists its paths (byte-identical to the old \`--name-only\` list, a merge commit read against its first parent, a binary row at zero), so an oversized landing with NO governed path is an entry on the size limb alone — counted apart in the head, listed with the ⛔ SIZE row and the same attribution column, GitHub's pair printed beside the landed number only when it differs, exactly the threshold NOT listed, a governed AND oversized row carrying both limbs, a row classified with no size rendering as it did — and a REAL sweep over a fixture repo listing the over-by-one landing and not the at-threshold one, on stdout and in --json. — and the 2026-09-21 FORK predicate: a fork head (or a deleted fork repo) lands by human merge through the Tier H terminal with its own reason sentence, a same-repo head changes nothing on either tier, --test / --branch say NOT MEASURED for a head they cannot see, ZERO check runs read NOT MEASURED and never green, and both readings ride --pr's own GET. — and the closed argv: each mode reads a closed flag set and refuses every other on exit 1 (an unknown flag, another mode's flag, an equals spelling, a --repo, which prescribes the qualified --pr spelling), a bare --pr beside a PM_SWEEP_REPO naming another repository is refused with both qualified spellings, and the card's own invocation table replayed against a recording fake API: every refusal READS NOTHING, the qualified spelling answers from the repository it names, byte-identical with PM_SWEEP_REPO set. — and the #30718 rename-aware size: --branch and the sweep count a moved file by its \`-M\` numstat, as GitHub does (a 400-line move with one edit reads +1 / -1 over one file, a \`diff.renames=false\` config notwithstanding), while both PATH lists keep \`--no-renames\` and so still carry both paths. — and the weekly audit card's readings (#33814), each pinned with its control: a PR-less governed landing reads NOT MEASURED, a carried row names the state this run read it in, the body is fitted under the issue-body limit with its counts taken on the card, a close rules only when its event's actor is an authorized approver and it names no commit (an app object or an absent app key rules nothing) and every such card within the horizon counts, the section reader ignores fences (closed only by their own marker, an unclosed one reported), counts stray rows and stops at the last footer, and every BREACH row that does not fit is named.\n  ${liveNote}`);

  return SELF_TEST_VERDICT;
}

/** The exit code `--test` would return for a path list in `repo` — pinned without spawning. */
function runTestModeExitFor(paths, repo, size = null, approval = null) {
  if (paths.length === 0) return EXIT_CANNOT_SWEEP;
  return landsByHumanMerge(testVerdict(paths, { repo, size, approval })) ? EXIT_TEST_GOVERNED : EXIT_TEST_NOT_GOVERNED;
}

// `invokedDirectly` for the same reason the main-invocation guard above
// carries it: this module is imported for its exported predicates
// (`GOVERNED_REPOS`, `governedPathsIn` and more), and an unguarded
// trigger ran this file's whole self-test inside the importer's own
// `--self-test`, printing a second summary and putting an unrelated file's
// failures on the importer's exit code. The suite was 77 assertions at PR
// #9897, where this guard landed, and is now more than three times that: the
// 77 is anchored to that PR and frozen as a historical fact, while the
// multiple is a FLOOR and is written as one on purpose. The live figure is
// whatever `--self-test` prints from `checked`; it moves on most edits to
// this file and has never once gone down across this file's history, so a
// floor stays true where a reading rots. Both figures that stood here had
// rotted before anyone looked — 77 was written as THIS file's current size
// and was by then off by a factor of three, and the neighbouring "line 810"
// had drifted onto unrelated code — so do not "helpfully" refresh either
// back into a reading. A self-test is a mode of the file that is being RUN,
// never a side effect of importing it.
// No module-scope `await` here either (#33603): the arm battery imports the queue guard lazily, as the sweep does.
if (invokedDirectly && process.argv.includes('--self-test')) {
  selfTest().then(
    (verdict) => {
      if (verdict === SELF_TEST_VERDICT) return;
      console.error(
        '\n✗ check-governed-merges self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    },
    (error) => {
      console.error(error?.stack ?? error);
      process.exit(1);
    },
  );
}
