#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-governed-merges — report-only post-merge audit of the governed
 * surfaces (#9495), across the four governed repos (#9619), plus the
 * pre-arm `--test` predicate every seat runs before flipping ready (#9550).
 * Enumerates the PRs that MERGED into `main` since a given date/ref whose diff
 * touched a governed surface, with merge attribution, for the PM round report
 * and the report-only patrol family (the `check-half-states.mjs` precedent: a
 * completed sweep exits 0 whether it found 0 or 40 entries; non-zero exits
 * classify the ENVIRONMENT, not the tree).
 *
 *   node scripts/pm/check-governed-merges.mjs                  # sweep, last 24h, all four repos
 *   node scripts/pm/check-governed-merges.mjs --since 7d       # or 36h, or ISO date
 *   node scripts/pm/check-governed-merges.mjs --since-ref v5.0.0-rc.3       # topological, exact
 *   node scripts/pm/check-governed-merges.mjs --since-ref objectstack=<tip> --since-ref objectui=<tip>
 *   node scripts/pm/check-governed-merges.mjs --repos objectstack,objectui
 *   node scripts/pm/check-governed-merges.mjs --repo-root cloud=/srv/cloud
 *   node scripts/pm/check-governed-merges.mjs --json           # for round reports
 *   node scripts/pm/check-governed-merges.mjs --test AGENTS.md src/x.ts   # pre-arm predicate
 *   node scripts/pm/check-governed-merges.mjs --self-test      # offline, no network
 *
 * ## Exit codes — the refusal to read as clean, in one table
 *
 * Sweep mode (default):
 *   0  swept COMPLETELY — every governed repo audited, every entry attributed.
 *      Zero entries and forty entries both exit 0; the list is the product.
 *   1  could not sweep at all — bad args, unreadable `--since-ref`.
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
 *   3  the given paths ARE governed — human merge only. Deliberately NOT 1 or
 *      2: a governed verdict must be impossible to confuse with the sweep's
 *      "could not sweep" / "incomplete", so `if cmd; then` and `$?` readings
 *      cannot silently turn a governed answer into an environment complaint.
 *   1  bad args — no paths given. ⛔ Silence never reads as "not governed":
 *      `--test` with an empty path list is a failure, never a green light.
 *   The register rows in `GENERATED_SURFACE_EXCEPTIONS` carry a provenance-
 *   aware exception (the generated-artifact sections below): a hit on a
 *   generator-owned path answers 0 only when that file byte-equals its own
 *   generator's output recomputed on the tree under test — every other reading
 *   of those paths, and every other path, is unchanged.
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
 * ## The generated-artifact exception (#9866; maintainer 2026-08-20 + 2026-08-22)
 *
 * Exactly one file under `.claude/**` is not instruction-tree prose but a
 * required gate's own `--write` artifact: `check:docs-audit-scope` keeps its
 * generated `ALL_HANDWRITTEN` page-scope block inside
 * `.claude/workflows/docs-accuracy-audit.js` (the workflow runs in a `node:vm`
 * sandbox that cannot read files, so the list must live inline). Adding a docs
 * page reddens that gate, the gate's own `--write` regenerates the block, and
 * the block sat inside this fence — so EVERY page-adding docs PR crossed the
 * governed surface (measured 5-for-5 on #9866), and three of the crossings
 * merged with nobody recording them. A fence that fires on routine traffic
 * trains every seat to read past it.
 *
 * The maintainer ruled for the provenance-aware exception — #10277's Option C
 * = #9866's shape 2 — verbatim 「10277 同意 C」 (2026-08-20), re-confirmed over
 * the same day's earlier relocate-the-artifact ruling: 「A:按方案 2(最新裁
 * 定)」 (2026-08-22). Four load-bearing constraints, each pinned by
 * `--self-test`; drop one and the exception is a hole:
 *
 *   1. RECOMPUTE, never compare to a stored baseline. The pass criterion is
 *      "the file's diff byte-equals what
 *      `node scripts/docs-audit/check-audit-scope.mjs --write` produces on the
 *      tree under test" — concretely, the tree's copy of the file must equal
 *      the generator's `replaceBlock(baseFile, docsDerivedFromThisTree)`. Any
 *      stored or cached comparison can be constructed against.
 *   2. BYTE-EXACT, no shape heuristics. There is no "only the ALL_HANDWRITTEN
 *      block changed, so allow it" — a reordered-but-equal list rejects too.
 *   3. A NAMED single-file exception, not a class mechanism.
 *      `GENERATED_SURFACE_EXCEPTIONS` is structurally a list, seeded with this
 *      one entry by ruling; every other governed-surface judgment — the rest
 *      of `.claude/**` included — is character-for-character unchanged.
 *   4. FAIL CLOSED, and the mixed-diff rule is untouched: provenance that
 *      cannot be recomputed (no base version, unreadable file, generator
 *      failure, empty derivation) keeps the path governed, and a hit on any
 *      OTHER governed path still forks the whole PR — 「混合 diff 一条命中即整
 *      PR 分叉」.
 *
 * ### The generator co-edit is fenced out (#11084) — a NARROWING, not a widening
 *
 * Constraint 1 makes the recompute run the tree under test's OWN
 * `scripts/docs-audit/**` (it must — the derivation has to reflect the PR's
 * own docs). So a PR that edits the generator AND hand-edits the artifact in
 * one diff could in principle construct a derivation whose recomputed splice
 * byte-equals its hand-edited block: the tree would be certifying itself.
 * Cheap fence, `--test` only: if the submitted path list contains ANY
 * `scripts/docs-audit/**` path, the recompute is SKIPPED and the path stays
 * governed with that reason stated. This only ever moves verdicts toward
 * governed — the pure-regeneration path with an untouched generator lifts
 * exactly as it did before, and no path that was governed becomes clear.
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
 *      write (`objectstack-upgrade` and `objectstack-pm-dispatch` have no
 *      SKILL_MAP entry today) is absent from the manifest and stays governed,
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
 * ## The governed REPOS (maintainer 「同意」 2026-08-18, wired here by #9619)
 *
 * The same day, asked whether the rule reaches the sibling repos — 「任何对
 * agents.md 等文件的修改…包括 objectui cloud仓库」 — the maintainer answered
 * 「同意」. So the surface register above is REPO-AGNOSTIC: the same five
 * globs are governed in `objectstack`, `objectui`, `cloud` and `objectos`,
 * and this sweep covers all four in one invocation regardless of the working
 * directory it is run from.
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
 * Deepening is never done here: this sweep reads four checkouts it does not
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
 * one repo and not a broken channel. Wherever that clone survives, this sweep
 * printed `✓ audited objectstack-ai/cloud — tip 15f55df2d ... 0 mainline
 * commit(s) in window` and exited 0 — and would have printed it FOREVER, since
 * the row's own prescribed remedy (`git fetch origin main`) is exactly the
 * command that 404s. The control had not degraded; it had been silently
 * switched off for one of the four repos it covers while continuing to print a
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
 *      dating four repos' windows is the same class of bug as the one above.
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
 * on the local tree under test (the #9866 row reads the file, `git
 * merge-base`/`git show` for the base version and the docs derivation; a
 * #11705 row runs that generator's own `--check` once, ~3 s, for every path it
 * owns in the diff) — still zero API calls; every other `--test` run reads
 * only the register in this file.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyHorizon } from './git-history.mjs';
import { isEntrypoint } from '../invoked-as.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);

/** The exit contract, named so the table above is machine-checkable. */
export const EXIT_SWEPT = 0;
export const EXIT_CANNOT_SWEEP = 1;
export const EXIT_INCOMPLETE = 2;
export const EXIT_TEST_GOVERNED = 3;
export const EXIT_TEST_NOT_GOVERNED = 0;

/**
 * The governed surfaces, in report order — the 2026-08-18 unified definition
 * (see header). `prefix` entries match path prefixes; `exact` entries match
 * one repo-relative path byte-for-byte (the repo-ROOT instruction files, not
 * `examples/AGENTS.md`, not template copies). One path hit governs a whole
 * PR — 「混合 diff 一条命中即整 PR 分叉」; proportion is never a question.
 * The register is repo-agnostic: it applies in all of `GOVERNED_REPOS`.
 */
export const GOVERNED_SURFACES = Object.freeze([
  Object.freeze({ id: 'adr', prefix: 'docs/adr/', glob: 'docs/adr/**', what: 'architecture decision records' }),
  Object.freeze({ id: 'claude-tree', prefix: '.claude/', glob: '.claude/**', what: 'the agent instruction tree (skills, agents, hooks, settings)' }),
  Object.freeze({ id: 'skills-catalog', prefix: 'skills/', glob: 'skills/**', what: 'the published skills catalog' }),
  Object.freeze({ id: 'agents-md', exact: 'AGENTS.md', glob: 'AGENTS.md', what: 'the repo-root agent instruction file' }),
  Object.freeze({ id: 'claude-md', exact: 'CLAUDE.md', glob: 'CLAUDE.md', what: 'the repo-root Claude instruction file' }),
]);

/**
 * The register's repo-ROOT rows, declared for `scripts/pm/dispatch-gates.mjs`
 * (#9979, applying #9964's pattern).
 *
 * That tool derives a card's gate list from the path literals in each gate's
 * own source, and "looks like a path" there means "carries a separator". The
 * three `prefix` rows above have one and reach dispatch-gates already — the
 * `skills/**` row is one of the three specimens that motivated reading a hint
 * AS WRITTEN. The two `exact` rows do not: a repo-root FILE carries no
 * separator, so an `AGENTS.md` or `CLAUDE.md` card derived this gate not at all
 * while the same card is GOVERNED by it (draft-only PR, maintainer merge) —
 * the loudest possible thing to learn late.
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
 *                  exactly one file the register can name (the #9866 row).
 *   `candidate`  — a NARROWING gate for a generator whose output set is
 *                  enumerated at run time: matching it earns a path the
 *                  question, never the answer. See the header — a candidate
 *                  cannot lift anything by itself, in either direction.
 *   `verify`     — the sink-generator recompute (#11705): run this package
 *                  script's `--check` on the tree under test and read the
 *                  output manifest it declares. Absent ⇒ the #9866 splice
 *                  recompute.
 *   `generator`  — the command an operator runs to regenerate; rendered in
 *                  every verdict, lifted or not.
 *   `trustedGeneratorPrefixes` — the tree whose co-edit fences this row
 *                  (#11084): a PR that edits the instrument cannot be measured
 *                  by it.
 */
export const GENERATED_SURFACE_EXCEPTIONS = Object.freeze([
  Object.freeze({
    id: 'docs-audit-scope',
    ruling: '#9866',
    path: '.claude/workflows/docs-accuracy-audit.js',
    surfaceId: 'claude-tree',
    generator: 'node scripts/docs-audit/check-audit-scope.mjs --write',
    trustedGeneratorPrefixes: Object.freeze(['scripts/docs-audit/']),
    what: "the docs-audit workflow's generated ALL_HANDWRITTEN scope block (a gate-owned --write artifact, not instruction-tree prose)",
  }),
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
    candidate: /^skills\/[^/]+\/(references\/react-blocks\.md|contracts\/react-blocks\.contract\.json)$/,
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
 * The generator tree the #9866 row's recompute TRUSTS: constraint 1 executes
 * this directory's `affected-docs.mjs` and imports its `check-audit-scope.mjs`
 * `replaceBlock`, both from the tree under test. A PR that edits anything
 * here is editing the instrument the certificate is measured with. Kept as a
 * named export because it is that row's own prefix; every row carries its own
 * list in `trustedGeneratorPrefixes`.
 */
export const TRUSTED_GENERATOR_PREFIX = 'scripts/docs-audit/';

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
 * A docs PR that also edits the spec generator tree has not touched the
 * docs-audit generator, and fencing it there would refuse a regeneration the
 * ruling allows.
 */
export function generatorCoEditProvenance(paths, entry = GENERATED_SURFACE_EXCEPTIONS[0]) {
  const prefixes = entry?.trustedGeneratorPrefixes ?? [TRUSTED_GENERATOR_PREFIX];
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
 * The byte-exact provenance verdict, pure so `--self-test` pins all four
 * ruled cases offline. Inputs: the file at the PR's merge base
 * (`baseSource`), the file on the tree under test (`prSource`), the doc set
 * derived from that same tree (`derivedDocs`), and the generator's own
 * `replaceBlock`. Pass ⟺ `prSource === replaceBlock(baseSource, derivedDocs)`
 * — which is exactly "the PR's diff to this file equals the diff `--write`
 * produces on the PR's own tree": the generated block must be the recomputed
 * render (rejects in-block hand edits, reorderings included) AND everything
 * outside the block must be untouched relative to base (rejects out-of-block
 * hand edits, which `--write` itself would preserve and so cannot vouch for).
 * Every non-pass answers with a stated reason; there is no heuristic branch.
 */
export function docsAuditRegenVerdict({ baseSource, prSource, derivedDocs, replaceBlock }) {
  if (typeof prSource !== 'string') {
    return { pureRegeneration: false, reason: 'the file could not be read from the tree under test — fail closed: the path stays governed' };
  }
  if (typeof baseSource !== 'string') {
    return { pureRegeneration: false, reason: 'no base version to diff against (file added, or unreadable at the merge base) — a whole new workflow file is not a regeneration; fail closed' };
  }
  if (!Array.isArray(derivedDocs) || derivedDocs.length === 0) {
    return { pureRegeneration: false, reason: 'the derived doc set is empty or unreadable — refusing to certify a regeneration of nothing (the generator itself refuses the same); fail closed' };
  }
  let expected;
  try {
    expected = replaceBlock(baseSource, derivedDocs);
  } catch (error) {
    return { pureRegeneration: false, reason: `the generator could not splice the base file (${String(error?.message ?? error).split('\n')[0]}) — fail closed` };
  }
  if (prSource === expected) {
    return { pureRegeneration: true, reason: 'byte-equal to the generator output recomputed on this tree (no stored baseline consulted)' };
  }
  return {
    pureRegeneration: false,
    reason:
      'differs from the generator output recomputed on this tree — byte-exact equality is the only pass, so a hand edit ' +
      '(inside or outside the generated block, a reordering included) keeps the path governed',
  };
}

/**
 * Apply the exception register to a `--test` verdict. Pure: provenance
 * arrives as a Map of path → `docsAuditRegenVerdict`-shaped result. A
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
    exceptions,
  };
}

/**
 * The four repos the 2026-08-18 cross-repo extension governs. `id` doubles as
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
]);

export const SELF_REPO_ID = 'objectstack';

/**
 * The governed slice of a path list, grouped by surface. Surfaces with no hit
 * are absent — `matched.length === 0` IS the clean path.
 */
export function governedPathsIn(paths) {
  const list = Array.isArray(paths) ? paths : [];
  return GOVERNED_SURFACES.map((surface) => ({
    ...surface,
    files: list.filter((p) =>
      typeof p === 'string' && (surface.prefix ? p.startsWith(surface.prefix) : p === surface.exact),
    ),
  })).filter((surface) => surface.files.length > 0);
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
 * commit row, its changed paths, and (multi-repo) which repo it came from;
 * attribution is stitched on later.
 */
export function classifyCommit({ sha, date, subject }, changedPaths, repo = null) {
  const surfaces = governedPathsIn(changedPaths);
  if (surfaces.length === 0) return null;
  return {
    repoId: repo?.id ?? null,
    repoSlug: repo?.slug ?? null,
    sha,
    date,
    subject,
    pr: pullNumberFromSubject(subject),
    surfaces,
  };
}

// ── the --test predicate (#9550): "would a PR touching these be governed?" ───

/**
 * The pre-arm answer, as data. Pure and repo-agnostic — the register is the
 * same in all four governed repos, so a seat can run this from anywhere with
 * the file list of any PR in any of them.
 */
export function testVerdict(paths) {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p !== '');
  const matched = governedPathsIn(list);
  const hit = new Set(matched.flatMap((s) => s.files));
  return {
    governed: matched.length > 0,
    checked: list.length,
    surfacesChecked: GOVERNED_SURFACES.length,
    matched,
    hitPaths: [...hit],
    clearPaths: list.filter((p) => !hit.has(p)),
  };
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
          ? `  ℹ️  generated-surface exception (${e.ruling ?? '#9866'}): ${e.path} is a PURE REGENERATION —\n` +
            `      byte-equal to \`${e.generator}\` recomputed on THIS tree (never a stored baseline),\n` +
            `      so this path does not govern the PR by itself. Any other governed hit still forks the whole PR.`
          : `  ⛔  generated-surface exception (${e.ruling ?? '#9866'}) did NOT lift ${e.path}:\n` +
            `      ${e.reason}\n` +
            `      The path stays governed; a pure \`${e.generator}\` regeneration is the only thing the exception passes.`,
      )
      .join('\n')
  );
}

/** The words a seat reads before flipping ready. Pure, so --self-test pins them. */
export function renderTestVerdict(verdict) {
  const head = `governed-surface predicate: ${verdict.hitPaths.length} of ${verdict.checked} path(s) hit the register (${verdict.surfacesChecked} surfaces, repo-agnostic).`;
  if (!verdict.governed) {
    return (
      `${head}\n` +
      `  ✅  NOT governed — ordinary queue landing applies to a PR with exactly this file list.\n` +
      `      Derived from GOVERNED_SURFACES, not recalled. Re-run on the FINAL file list: the register\n` +
      `      has grown several times in two days, and a reading taken earlier in the session is recall.` +
      renderExceptionLines(verdict)
    );
  }
  const lines = verdict.matched.map((s) => {
    const files = s.files.slice(0, 8).map((f) => `        - ${f}`).join('\n');
    return `      ${s.glob} ×${s.files.length} — ${s.what}\n${files}`;
  });
  const clear = verdict.clearPaths.length > 0 ? `\n  paths not on the register: ${verdict.clearPaths.slice(0, 8).join(', ')}` : '';
  return (
    `${head}\n` +
    `  ⛔  GOVERNED — a human merge is the review record for this PR (#9495 regime).\n` +
    `      No seat flips it ready, enqueues it, or arms auto-merge (AGENTS.md Prime Directive #14).\n` +
    `      One hit governs the whole PR — 「混合 diff 一条命中即整 PR 分叉」; proportion is not a question.\n` +
    `${lines.join('\n')}${clear}` +
    renderExceptionLines(verdict)
  );
}

/**
 * The real recompute behind the exception, on the local tree at `root` (the
 * tree under test — run the PR's own copy of this script from the PR's own
 * checkout, or point `--root` at it). Constraint 1 in code: the expected
 * bytes are produced HERE, from this tree's docs derivation spliced by the
 * generator's own exported `replaceBlock`, never read from anywhere stored.
 * Every failure path answers fail-closed with a stated reason. No network.
 */
export async function recomputeDocsAuditProvenance(root, exception, { baseRef = null } = {}) {
  const failClosed = (reason) => ({ pureRegeneration: false, reason: `${reason} — fail closed: the path stays governed` });
  let replaceBlock;
  try {
    ({ replaceBlock } = await import('../docs-audit/check-audit-scope.mjs'));
    if (typeof replaceBlock !== 'function') return failClosed('the generator module exports no replaceBlock');
  } catch (error) {
    return failClosed(`could not load the generator module (${String(error?.message ?? error).split('\n')[0]})`);
  }
  let prSource;
  try {
    prSource = readFileSync(join(root, exception.path), 'utf8');
  } catch (error) {
    return failClosed(`could not read ${exception.path} from the tree under test (${String(error?.message ?? error).split('\n')[0]})`);
  }
  let baseSource;
  try {
    // `baseRef` is how a merge-group build names its base (it has no reason to
    // hold `origin/main`); a seat run resolves the merge base itself.
    const base = baseRef ?? git(root, ['merge-base', 'origin/main', 'HEAD']).trim();
    baseSource = git(root, ['show', `${base}:${exception.path}`]);
  } catch (error) {
    return failClosed(`could not read the base version of ${exception.path} (${String(error?.message ?? error).split('\n')[0]})`);
  }
  let derivedDocs;
  try {
    derivedDocs = JSON.parse(
      execFileSync(process.execPath, [join(root, 'scripts/docs-audit/affected-docs.mjs'), '--all', '--json'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ).docs;
  } catch (error) {
    return failClosed(`could not derive the doc set on this tree (${String(error?.message ?? error).split('\n')[0]})`);
  }
  return docsAuditRegenVerdict({ baseSource, prSource, derivedDocs, replaceBlock });
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
 * hypothetical: the merge-group guard job installs no dependencies (see the
 * header), so there it fails closed on every run.
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
    for (const path of paths) provenance.set(path, await recomputeDocsAuditProvenance(root, entry, { baseRef }));
  }
  return provenance;
}

// ── local git (enumeration + diff paths; zero API) ──────────────────────────

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
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
      reason:
        `NOT MEASURED: '${ref}' does not name a remote-tracking ref, so this sweep cannot establish that ` +
        `any remote was consulted for ${path}. A local ref is not evidence of a remote reading (#13307).`,
    };
  }
  if (!remote || remote.reachable !== true) {
    return {
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
      reason:
        `NOT MEASURED: the remote '${parts.remote}' answered for ${path} but named no commit on ` +
        `'${parts.branch}' (read: ${JSON.stringify(remote.sha ?? null)}). An unreadable remote tip is a ` +
        `FAILED reading, never a match — comparing it to an equally unreadable local tip would certify a ` +
        `dead mirror as verified (#13307).`,
    };
  }
  if (!isObjectId(localSha)) {
    return {
      reason:
        `NOT MEASURED: '${ref}' in ${path} did not resolve to a commit id (read: ` +
        `${JSON.stringify(localSha ?? null)}), so there is nothing to compare the remote tip against. ` +
        `Remedy: git -C ${path} fetch ${parts.remote} ${parts.branch}`,
    };
  }
  if (localSha.trim() !== remote.sha.trim()) {
    return {
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

/** The paths a mainline commit changed, against its first parent. */
export function commitPaths(root, sha) {
  const out = git(root, ['diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-only', '-m', '--first-parent', sha]);
  return out.split('\n').filter((p) => p !== '');
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

/** The node flag that points fetch at the session proxy, and the re-exec guard. */
export const PROXY_FLAG = '--use-env-proxy';
export const PROXY_REARM_GUARD = 'OS_GOVERNED_MERGES_PROXY_REARMED';

/**
 * Does this run need to be re-executed with `PROXY_FLAG` before it can reach
 * GitHub at all? Pure, so every branch is offline-testable — and the branches
 * are the whole point: a proxied run without the flag reads 401/403 on every
 * channel and looks exactly like a credential problem (#9642).
 */
export function proxyRearmPlan({ env = {}, execArgv = [], flagSupported = true }) {
  const proxy = env.HTTPS_PROXY || env.https_proxy || null;
  if (!proxy) return { rearm: false, hint: false, reason: 'no HTTPS_PROXY in the environment — fetch reaches GitHub directly' };
  if (execArgv.includes(PROXY_FLAG) || (env.NODE_OPTIONS ?? '').includes(PROXY_FLAG)) {
    return { rearm: false, hint: false, reason: `already running with ${PROXY_FLAG}` };
  }
  if (env[PROXY_REARM_GUARD] === '1') return { rearm: false, hint: false, reason: 'already re-armed once this run' };
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
      attribution: { mergedBy: body?.merged_by?.login ?? null, mergedAt: body?.merged_at ?? null, title: body?.title ?? null },
      channel: channel.id,
    };
  }
  return { attribution: null, channel: null, failure: failures.join('; ') };
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

/** The whole report as text — pure, so --self-test asserts on the words. */
export function renderReport({ window, repos, scanned, entries, lookups, sweepCode = null }) {
  const audited = repos.filter((r) => r.status === 'audited');
  const unaudited = repos.filter((r) => r.status !== 'audited');
  const edged = audited.filter((r) => r.windowIncomplete);
  const head =
    `governed-merges sweep: ${entries.length} governed merge(s) since ${window.requestedIso} ` +
    `across ${audited.length}/${repos.length} governed repo(s)\n` +
    `  scanned ${scanned} mainline commit(s); ${lookups} API lookup(s).\n` +
    (sweepCode ? `${describeSweepCode(sweepCode)}\n` : '') +
    describeWindow(window);
  const auditedLines = audited.map(
    (r) => `  ✓ audited  ${r.slug} — tip ${r.tip ? `${r.tip.sha.slice(0, 9)} @ ${r.tip.date}` : '(unknown)'}; ${r.scanned ?? 0} mainline commit(s) in window${r.windowMode ? `; window ${r.windowMode}${r.windowBase ? ` from ${r.windowBase.sha.slice(0, 9)}` : ''}${r.windowFellBack ? ` (fell back — ${r.windowFellBack})` : ''}${r.straddlers ? `, ${r.straddlers} boundary re-listing(s)` : ''}` : ''}${r.horizon ? `; history ${r.horizon}` : ''}${r.remote ? `; remote ${describeRemote(r.remote)}` : ''}${r.quiet ? (r.remote ? ' — none in window, and the remote tip was reached and matches this mirror: a MEASURED zero, not an unread one' : ' — none in window; ⚠️ no remote reading is recorded for this row, so the zero is not a measured one') : ''}`,
  );
  const unauditedLines = unaudited.map((r) => `  ⚠️  UNAUDITED  ${r.slug} — ${r.reason}`);
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
  ];
  const preamble = [head, ...auditedLines, ...unauditedLines, ...edgeLines, ...unauditedNote, ...nextRoundRefLine(repos), ...contract].join('\n');

  if (entries.length === 0) {
    if (unaudited.length > 0) return `${preamble}\n  no governed surface was merged in the audited repo(s) — NOT a clean window; see UNAUDITED above.`;
    if (edged.length > 0) return `${preamble}\n  no governed surface was merged inside the PROVEN part of the window — NOT a clean window; see WINDOW EDGE above.`;
    return `${preamble}\n  ✅  clean window — no governed surface was merged in any governed repo.`;
  }

  const lines = entries.map((e) => {
    const surfaces = e.surfaces.map((s) => `${s.glob} ×${s.files.length}`).join(', ');
    const who = attributionCell(e);
    const prName = e.pr != null ? `PR #${e.pr}` : '⚠️  NO PR NUMBER IN SUBJECT — direct push to main? investigate';
    const files = e.surfaces.flatMap((s) => s.files.slice(0, 6)).slice(0, 8);
    return `  • ${e.repoSlug ? `${e.repoSlug} ` : ''}${prName} — ${e.subject}\n      commit ${e.sha.slice(0, 9)} @ ${e.date}; ${who}\n      surfaces: ${surfaces}\n${files.map((f) => `        - ${f}`).join('\n')}`;
  });

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

// ── CLI ─────────────────────────────────────────────────────────────────────

const invokedDirectly = isEntrypoint(import.meta.url);

async function runTestMode(args) {
  const i = args.indexOf('--test');
  const paths = [];
  const tail = args.slice(i + 1);
  for (let j = 0; j < tail.length; j++) {
    if (tail[j] === '--root') { j++; continue; } // `--root <path>`'s value is a flag argument, not a PR path
    if (tail[j].startsWith('--')) continue;
    paths.push(tail[j]);
  }
  if (paths.length === 0) {
    console.error(
      `❌  --test wants the PR's changed paths, and got none. An empty path list is a failure, never\n` +
        `    a "not governed" answer. Derive the list rather than typing it, e.g.\n` +
        `      node scripts/pm/check-governed-merges.mjs --test $(gh pr diff --name-only <pr>)`,
    );
    return EXIT_CANNOT_SWEEP;
  }
  let verdict = testVerdict(paths);
  // The provenance-aware exceptions (#9866 + #11705): recompute only when a
  // registered path is actually among the hits, so every other `--test` run
  // stays the zero-git, zero-cost read it always was. The driver applies each
  // row's #11084 co-edit fence before spending anything — a diff that edits a
  // generator alongside its artifact would otherwise certify itself.
  const hitsByEntry = groupHitsByException(verdict.hitPaths);
  if (hitsByEntry.size > 0) {
    const rootIdx = args.indexOf('--root');
    const root = resolve(rootIdx > -1 && args[rootIdx + 1] ? args[rootIdx + 1] : resolve(scriptDir, '..', '..'));
    verdict = applyGeneratedExceptions(verdict, await recomputeProvenanceFor(root, hitsByEntry, { allPaths: paths }));
  }
  if (args.includes('--json')) console.log(JSON.stringify(verdict, null, 2));
  else console.log(renderTestVerdict(verdict));
  return verdict.governed ? EXIT_TEST_GOVERNED : EXIT_TEST_NOT_GOVERNED;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--test')) return await runTestMode(args);

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
  const rearm = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
  if (rearm.rearm) {
    console.error(`ℹ️  re-exec with ${rearm.flag}: ${rearm.reason}. Attribution would otherwise fail on every channel.`);
    // The proxy agent is experimental and says so once per run; the operator
    // cannot act on that notice, so keep it out of the report where the node
    // in use can silence it by code.
    const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
    const child = spawnSync(process.execPath, [rearm.flag, ...quiet, scriptPath, ...args], {
      stdio: 'inherit',
      env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
    });
    if (typeof child.status === 'number') return child.status;
    console.error(`⚠️  could not re-exec with ${rearm.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — attribution may fail.`);
  }

  const entries = [];
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
      repo.reason = `cannot read ${ref} in ${repo.path}: ${String(error.message ?? error).split('\n')[0]} — run \`git fetch origin main\` there`;
      continue;
    }
    repo.scanned = commits.length;
    repo.quiet = commits.length === 0;
    scanned += commits.length;
    for (const commit of commits) {
      const entry = classifyCommit(commit, commitPaths(repo.path, commit.sha), repo);
      if (entry) entries.push(entry);
    }
  }

  if (repos.every((r) => r.status !== 'audited')) {
    console.error(
      `❌  no governed repo could be audited — not one checkout resolved. This is a failed sweep, not a\n` +
        `    clean window.\n${repos.map((r) => `    • ${r.slug}: ${r.reason}`).join('\n')}`,
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

  const unaudited = repos.filter((r) => r.status !== 'audited');
  const edged = repos.filter((r) => r.status === 'audited' && r.windowIncomplete);
  const complete = !attributionFailed && unaudited.length === 0 && edged.length === 0;
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
    const why = [];
    if (unaudited.length > 0) why.push(`${unaudited.length} governed repo(s) unaudited (${unaudited.map((r) => r.slug).join(', ')})`);
    if (edged.length > 0) why.push(`${edged.length} governed repo(s) at the WINDOW EDGE (${edged.map((r) => r.slug).join(', ')}) — the boundary could not be proven`);
    if (attributionFailed) why.push('at least one entry has no merged_by reading on any channel');
    console.error(
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
  return EXIT_SWEPT;
}

if (invokedDirectly && !process.argv.includes('--self-test')) {
  process.exitCode = await main();
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
  'spec-react-blocks': 'skills/objectstack-ui/contracts/react-blocks.contract.json',
};

async function selfTest() {
  let checked = 0;
  const failures = [];
  const assert = (name, cond, detail) => {
    checked++;
    if (!cond) failures.push(`${name}: ${detail ?? ''}`);
  };
  // Report fixtures take a REAL window from the real resolver, never a
  // hand-built object: a shape drifting from `resolveWindow`'s would render
  // green here and print nothing an operator could read.
  const dateWindowFor = (iso) => resolveWindow({ sinceArg: iso });

  // ── the governed predicate: the 2026-08-18 unified list, exactly ──────────
  const ids = (paths) => governedPathsIn(paths).map((s) => s.id);
  assert('all-five-surfaces-declared-in-order', GOVERNED_SURFACES.map((s) => s.id).join(',') === 'adr,claude-tree,skills-catalog,agents-md,claude-md', GOVERNED_SURFACES.map((s) => s.id).join(','));
  assert('adr-prefix', ids(['docs/adr/0001-x.md']).join() === 'adr');
  assert('whole-claude-tree-not-only-skills', ids(['.claude/hooks/guard-main-checkout.sh', '.claude/agents/os-dev.md', '.claude/settings.json']).join() === 'claude-tree');
  assert('published-skills-catalog-is-governed', ids(['skills/objectstack-ui/SKILL.md']).join() === 'skills-catalog');
  assert('root-agents-md-exact', ids(['AGENTS.md']).join() === 'agents-md');
  assert('root-claude-md-exact', ids(['CLAUDE.md']).join() === 'claude-md');
  // Near misses, each load-bearing: prefixes need their trailing slash; the
  // exact entries are the repo-root files only (see header).
  assert('near-misses-stay-out', ids(['docs/adrs/z.md', '.claude-x/y.md', 'skillsx/a.md', 'examples/AGENTS.md', 'packages/create-objectstack/src/templates/AGENTS.md', 'apps/CLAUDE.md.bak']).length === 0, JSON.stringify(ids(['examples/AGENTS.md'])));
  assert('a-mixed-diff-groups-by-surface', ids(['docs/adr/0001.md', 'AGENTS.md', 'package.json']).join() === 'adr,agents-md');

  // ── the dispatch-gates declaration (#9979) ───────────────────────────────
  //
  // Enforcement cannot hold any of these: the declaration is read by another
  // tool entirely, so a wrong or missing entry runs perfectly green here and
  // shows up only as a dev dispatched on a root-file card who is not told that
  // the card is GOVERNED.
  const rootExacts = GOVERNED_SURFACES.filter((s) => s.exact).map((s) => s.exact);
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

  // ── --since parsing ───────────────────────────────────────────────────────
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
    classifyCommit(qs7.commits.find((c) => c.sha === qs7Governed.sha), ['docs/adr/0029-kernel-object-ownership.md']) !== null);
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
  assert('ungoverned-commit-classifies-null', classifyCommit({ sha: 'a'.repeat(40), date: '2026-08-18T00:00:00Z', subject: 'fix: x (#1)' }, ['packages/spec/src/index.ts']) === null);
  for (const replay of REPLAYS) {
    const entry = classifyCommit({ sha: 'b'.repeat(40), date: '2026-08-18T00:00:00Z', subject: replay.subject }, replay.files);
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
  assert('four-governed-repos-declared', GOVERNED_REPOS.map((r) => r.id).join(',') === 'objectstack,objectui,cloud,objectos', GOVERNED_REPOS.map((r) => r.id).join(','));
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
  assert('all-four-repos-are-resolved-not-just-the-self-repo', resolved.length === 4);
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
  assert('the-verified-row-says-what-was-reached-and-what-matched', describeRemote(reached) === `origin/main reached at origin, tip ${liveTip.slice(0, 9)} matches this mirror`, describeRemote(reached));

  // ── the REAL prober, on real git fixtures (#13307) ────────────────────────
  //
  // The verdicts above are pure and take the probe result as data, so all of
  // them would stay green while `probeRemoteTip` answered `reachable: true`
  // for a remote that is gone — the pure half cannot pin the half that
  // actually reads the world. These fixtures are local bare repos over the
  // FILE transport: real `git ls-remote`, no network, ~1 s, so `--self-test`
  // stays offline exactly as its usage line claims.
  const fxRoot = mkdtempSync(join(tmpdir(), 'governed-merges-remote-'));
  try {
    const g = (cwd, ...rest) =>
      execFileSync('git', ['-c', 'user.email=t@t.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...rest], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const seed = join(fxRoot, 'seed');
    g(fxRoot, 'init', '-q', seed);
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
    const declareOrigin = (co, bare) => {
      g(co, 'remote', 'set-url', 'origin', 'https://github.com/objectstack-ai/cloud');
      g(co, 'config', `url.${bare}.insteadOf`, 'https://github.com/objectstack-ai/cloud');
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

  // ── an unreachable remote never renders as a clean window (#13307) ────────
  //
  // Same register, same words, same suppressed tick as an absent checkout —
  // that sameness IS the fix: no second mechanism was introduced, so this row
  // cannot drift away from the #4690 rule the others obey. Assert on the TICK
  // (the phrase "NOT a clean window" contains "clean window").
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

  // ── the attribution column's THIRD case (#12645) ──────────────────────────
  // The two fixtures above are cases 1 and 2; the PR-less mainline entry —
  // the loudest line the sweep prints — is case 3, and it used to render
  // case 2's words with zero channels tried. All three are pinned as a set,
  // because the defect was a two-way split covering three facts.
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
  const governedCase = testVerdict(['AGENTS.md']);
  assert('--test-on-the-#9527-file-list-answers-GOVERNED', governedCase.governed === true && governedCase.hitPaths.join() === 'AGENTS.md', JSON.stringify(governedCase));
  assert('--test-governed-renders-the-no-flip-no-enqueue-no-arm-instruction', renderTestVerdict(governedCase).includes('GOVERNED') && renderTestVerdict(governedCase).includes('arms auto-merge'), renderTestVerdict(governedCase));
  const mixedCase = testVerdict(['packages/spec/src/index.ts', '.claude/agents/os-dev.md', 'README.md']);
  assert('--test-on-a-mixed-diff-answers-GOVERNED-on-one-hit', mixedCase.governed === true && mixedCase.hitPaths.join() === '.claude/agents/os-dev.md', JSON.stringify(mixedCase.hitPaths));
  assert('--test-lists-the-paths-that-are-NOT-on-the-register-too', mixedCase.clearPaths.join() === 'packages/spec/src/index.ts,README.md', JSON.stringify(mixedCase.clearPaths));
  const clearCase = testVerdict(['packages/spec/src/index.ts', 'scripts/pm/check-governed-merges.mjs']);
  assert('--test-on-an-ordinary-diff-answers-NOT-governed', clearCase.governed === false && clearCase.hitPaths.length === 0, JSON.stringify(clearCase));
  assert('this-very-file-is-not-itself-a-governed-surface', testVerdict(['scripts/pm/check-governed-merges.mjs']).governed === false);
  assert('--test-not-governed-renders-the-re-run-on-the-final-list-warning', renderTestVerdict(clearCase).includes('NOT governed') && renderTestVerdict(clearCase).includes('recall'), renderTestVerdict(clearCase));
  // Near misses on the predicate, the class the incident turns on: the seat
  // reasoned about a name, not a register.
  const nearMiss = testVerdict(['examples/AGENTS.md', 'docs/adrs/x.md', '.claude-x/y', 'skillsx/a.md', 'apps/CLAUDE.md.bak', 'packages/create-objectstack/src/templates/AGENTS.md']);
  assert('--test-near-misses-answer-NOT-governed', nearMiss.governed === false && nearMiss.clearPaths.length === 6, JSON.stringify(nearMiss.hitPaths));
  assert('--test-with-an-empty-path-list-is-never-a-not-governed-answer', testVerdict([]).checked === 0 && testVerdict([]).governed === false && runTestModeExitFor([]) === EXIT_CANNOT_SWEEP);
  // Every governed surface answers 3 through its own glob — an uninvoked
  // surface is the phantom shape this self-test exists to refuse.
  for (const surface of GOVERNED_SURFACES) {
    const sample = surface.prefix ? `${surface.prefix}sample.md` : surface.exact;
    assert(`--test-answers-governed-for-${surface.id}`, testVerdict([sample]).governed === true, sample);
  }

  // ── the generated-artifact exception (#9866; rulings 2026-08-20 + -22) ───
  //
  // Safety-relevant merge-gate code: a bug here waves real instruction edits
  // past the fence. The four ruled cases are pinned against the GENERATOR'S
  // OWN exported render/splice functions, not imitations, so the fixtures are
  // real `--write` output; if the generator ever renames its block markers,
  // `replaceBlock` stops splicing these fixtures and the pure-regen case goes
  // red HERE — loud, which is the point.
  const { renderBlock: genRender, replaceBlock: genReplace } = await import('../docs-audit/check-audit-scope.mjs');
  // The register: every row is ruled, and the #9866 row is still the exact
  // single file its ruling named. A row must also name a surface its own paths
  // are actually governed by — an exception for an ungoverned path would be a
  // register row nothing reads.
  assert('every-register-row-cites-the-ruling-that-put-it-there',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => typeof e.ruling === 'string' && /^#\d+$/.test(e.ruling)),
    JSON.stringify(GENERATED_SURFACE_EXCEPTIONS.map((e) => [e.id, e.ruling])));
  assert('the-9866-row-is-still-the-exact-single-file-its-ruling-named',
    GENERATED_SURFACE_EXCEPTIONS[0].path === '.claude/workflows/docs-accuracy-audit.js' && GENERATED_SURFACE_EXCEPTIONS[0].ruling === '#9866',
    JSON.stringify(GENERATED_SURFACE_EXCEPTIONS[0]));
  assert('a-row-matches-either-an-exact-path-or-a-narrowing-candidate-never-neither-and-never-both',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => (typeof e.path === 'string') !== (e.candidate instanceof RegExp)),
    JSON.stringify(GENERATED_SURFACE_EXCEPTIONS.map((e) => [e.id, typeof e.path, String(e.candidate)])));
  assert('no-candidate-carries-the-g-flag-a-stateful-regexp-would-answer-differently-every-other-call',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => !e.candidate || !e.candidate.global));
  assert('the-exception-names-a-path-its-surface-actually-governs',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => {
      const m = governedPathsIn([e.path ?? REGISTER_SAMPLES[e.id]]);
      return m.length === 1 && m[0].id === e.surfaceId;
    }), JSON.stringify(GENERATED_SURFACE_EXCEPTIONS.map((e) => e.path ?? REGISTER_SAMPLES[e.id])));
  assert('every-row-names-its-generator-command-and-its-trusted-instrument-tree',
    GENERATED_SURFACE_EXCEPTIONS.every((e) => typeof e.generator === 'string' && e.generator !== '' && (e.trustedGeneratorPrefixes ?? []).length > 0));
  assert('the-exception-names-its-generator-command',
    GENERATED_SURFACE_EXCEPTIONS[0].generator.includes('check-audit-scope.mjs --write'));

  const oldDocs = ['content/docs/a.mdx'];
  const newDocs = ['content/docs/a.mdx', 'content/docs/new-page.mdx'];
  const baseWorkflow =
    `// header prose\n// <generated:docs-audit-scope>${genRender(oldDocs)}// </generated:docs-audit-scope>\n` +
    `const RELEASE_OWNED_PREFIX = 'content/docs/releases/'\n// footer\n`;
  const pureRegen = genReplace(baseWorkflow, newDocs);
  const regen = (prSource, over = {}) =>
    docsAuditRegenVerdict({ baseSource: baseWorkflow, prSource, derivedDocs: newDocs, replaceBlock: genReplace, ...over });
  assert('the-pure-regen-fixture-is-a-real-diff-not-a-no-op', pureRegen !== baseWorkflow && pureRegen.includes('new-page.mdx'));
  // Ruled case 1: a pure regeneration passes.
  const pureVerdict = regen(pureRegen);
  assert('ruled-case-1-pure-regeneration-passes', pureVerdict.pureRegeneration === true, pureVerdict.reason);
  assert('a-pass-says-it-recomputed-and-consulted-no-stored-baseline', /recomputed on this tree/.test(pureVerdict.reason) && /no stored baseline/.test(pureVerdict.reason), pureVerdict.reason);
  // Ruled case 2: an in-block hand edit rejects.
  const inBlockEdit = pureRegen.replace('  "content/docs/new-page.mdx",', '  "content/docs/new-page.mdx",\n  "content/docs/sneaked-in.mdx",');
  assert('the-in-block-mutation-applied', inBlockEdit !== pureRegen);
  assert('ruled-case-2-in-block-hand-edit-rejects', regen(inBlockEdit).pureRegeneration === false);
  // Ruled case 3: an out-of-block edit rejects — `--write` itself would
  // PRESERVE it, which is exactly why the compare runs from the base file.
  const outOfBlockEdit = pureRegen.replace('// footer', '// footer, hand-edited');
  assert('the-out-of-block-mutation-applied', outOfBlockEdit !== pureRegen);
  assert('ruled-case-3-out-of-block-edit-rejects', regen(outOfBlockEdit).pureRegeneration === false);
  // Ruled case 4: mixed regeneration + hand edit rejects.
  const mixedEdit = inBlockEdit.replace('// footer', '// footer, hand-edited');
  assert('ruled-case-4-mixed-regen-plus-hand-edit-rejects', regen(mixedEdit).pureRegeneration === false);
  // Byte-exact means byte-exact: the same doc SET reordered is not a pass —
  // the "only the block changed, and to equivalent content" heuristic is the
  // shape the ruling forbids.
  const reordered = pureRegen.replace(
    '  "content/docs/a.mdx",\n  "content/docs/new-page.mdx",',
    '  "content/docs/new-page.mdx",\n  "content/docs/a.mdx",',
  );
  assert('the-reorder-mutation-applied', reordered !== pureRegen);
  assert('an-equal-set-in-a-different-order-rejects-no-shape-heuristics', regen(reordered).pureRegeneration === false);
  // Fail-closed inputs, each with its own stated reason.
  assert('no-base-version-rejects-an-added-workflow-file-is-not-a-regeneration', regen(pureRegen, { baseSource: null }).pureRegeneration === false);
  assert('an-unreadable-tree-file-rejects', regen(null).pureRegeneration === false);
  assert('an-empty-derivation-rejects-like-the-generator-itself-refuses-it', regen(pureRegen, { derivedDocs: [] }).pureRegeneration === false);
  assert('a-generator-splice-failure-rejects', regen(pureRegen, { baseSource: 'no markers here at all' }).pureRegeneration === false);

  // Applying the exception to a verdict — the fence semantics.
  const wfPath = GENERATED_SURFACE_EXCEPTIONS[0].path;
  const verified = new Map([[wfPath, { pureRegeneration: true, reason: 'byte-equal (fixture)' }]]);
  const liftedVerdict = applyGeneratedExceptions(testVerdict(['content/docs/x.mdx', wfPath]), verified);
  assert('a-verified-pure-regen-lifts-the-only-hit-and-the-pr-is-not-governed',
    liftedVerdict.governed === false && liftedVerdict.hitPaths.length === 0 && liftedVerdict.matched.length === 0, JSON.stringify(liftedVerdict.hitPaths));
  assert('a-lifted-path-is-recorded-as-an-exception-never-as-a-clear-path',
    !liftedVerdict.clearPaths.includes(wfPath) && liftedVerdict.exceptions.length === 1 && liftedVerdict.exceptions[0].pureRegeneration === true, JSON.stringify(liftedVerdict.exceptions));
  const rejectedVerdict = applyGeneratedExceptions(testVerdict([wfPath]), new Map([[wfPath, { pureRegeneration: false, reason: 'differs (fixture)' }]]));
  assert('a-failed-provenance-keeps-the-path-governed', rejectedVerdict.governed === true && rejectedVerdict.hitPaths.join() === wfPath);
  const absentProvenance = applyGeneratedExceptions(testVerdict([wfPath]), new Map());
  assert('absent-provenance-fails-closed-never-open', absentProvenance.governed === true && /fail closed/.test(absentProvenance.exceptions[0].reason), JSON.stringify(absentProvenance.exceptions));
  // The mixed-diff rule is untouched: one hit on any OTHER governed path
  // still forks the whole PR, provenance verified or not.
  const mixedGoverned = applyGeneratedExceptions(testVerdict([wfPath, '.claude/skills/x/SKILL.md']), verified);
  assert('one-hit-on-any-OTHER-governed-path-still-forks-the-whole-pr',
    mixedGoverned.governed === true && mixedGoverned.hitPaths.join() === '.claude/skills/x/SKILL.md', JSON.stringify(mixedGoverned.hitPaths));
  assert('and-the-lifted-path-is-still-reported-as-lifted-on-a-mixed-diff', mixedGoverned.exceptions[0].pureRegeneration === true);
  // A NAMED single file, not a class: a sibling workflow file never consults
  // provenance, even provenance that claims to be verified.
  const sibling = '.claude/workflows/some-other-workflow.js';
  const siblingVerdict = applyGeneratedExceptions(testVerdict([sibling]), new Map([[sibling, { pureRegeneration: true, reason: 'x' }]]));
  assert('a-sibling-workflow-file-is-not-excepted-single-file-not-a-class',
    siblingVerdict.governed === true && siblingVerdict.exceptions.length === 0, JSON.stringify(siblingVerdict.exceptions));
  assert('a-verdict-that-never-consulted-the-exception-carries-no-exceptions-field', testVerdict(['AGENTS.md']).exceptions === undefined);

  // ── the generator co-edit fence (#11084), pinned in BOTH directions ──────
  //
  // The fence decides whether `--test` recomputes at all, so a bug in either
  // direction is load-bearing: too loose re-opens the self-certification, too
  // tight would break the ruled pure-regeneration lift. The register's own
  // generator command must live under the fenced prefix — if the generator
  // ever relocates, the fence must follow, and this goes red first.
  assert('the-fence-covers-the-directory-the-registered-generator-actually-runs-from',
    GENERATED_SURFACE_EXCEPTIONS[0].generator.includes(TRUSTED_GENERATOR_PREFIX), GENERATED_SURFACE_EXCEPTIONS[0].generator);
  // Direction A — co-edit: the generator is touched, so no recompute happens
  // and the artifact stays governed, with the stated reason.
  const coEditPaths = [wfPath, 'scripts/docs-audit/affected-docs.mjs'];
  const coEdit = generatorCoEditProvenance(coEditPaths);
  assert('a-generator-co-edit-answers-fail-closed-before-any-recompute',
    coEdit !== null && coEdit.pureRegeneration === false, JSON.stringify(coEdit));
  assert('the-co-edit-reason-states-the-ruled-words-and-names-the-co-edited-file',
    /modifies the generator this exception trusts — the path stays governed/.test(coEdit?.reason ?? '') &&
      (coEdit?.reason ?? '').includes('scripts/docs-audit/affected-docs.mjs'), String(coEdit?.reason));
  // A neutered fence must fail LOUD and READABLE here, not crash the run: the
  // absent answer is itself the finding, so it is asserted, never dereferenced.
  const coEditVerdict = applyGeneratedExceptions(testVerdict(coEditPaths), new Map(coEdit ? [[wfPath, coEdit]] : []));
  assert('a-generator-co-edit-keeps-the-artifact-governed-the-exception-does-not-lift',
    coEditVerdict.governed === true && coEditVerdict.hitPaths.join() === wfPath && coEditVerdict.exceptions[0].pureRegeneration === false,
    JSON.stringify(coEditVerdict.hitPaths));
  const coEditRender = renderTestVerdict(coEditVerdict);
  assert('the-co-edit-render-stays-GOVERNED-and-tells-the-seat-why-it-did-not-lift',
    coEditRender.includes('GOVERNED') && coEditRender.includes('did NOT lift') &&
      coEditRender.includes('modifies the generator this exception trusts'), coEditRender);
  assert('the-dot-slash-spelling-of-a-generator-path-is-fenced-too-recognising-more-only-tightens',
    generatorCoEditProvenance([wfPath, './scripts/docs-audit/check-audit-scope.mjs']) !== null);
  // Direction B — untouched generator: the fence abstains (`null`), the
  // recompute runs exactly as before, and a verified pure regeneration still
  // lifts. This is the narrowing's whole obligation: nothing else moves.
  const regenOnlyPaths = [wfPath, 'content/docs/new-page.mdx'];
  assert('an-untouched-generator-abstains-so-the-recompute-runs-exactly-as-before',
    generatorCoEditProvenance(regenOnlyPaths) === null);
  const regenOnlyVerdict = applyGeneratedExceptions(testVerdict(regenOnlyPaths), verified);
  assert('a-pure-regen-with-an-untouched-generator-still-lifts-and-the-pr-is-not-governed',
    regenOnlyVerdict.governed === false && regenOnlyVerdict.hitPaths.length === 0 && regenOnlyVerdict.exceptions[0].pureRegeneration === true,
    JSON.stringify(regenOnlyVerdict));
  assert('a-docs-only-pr-that-never-hits-the-register-is-untouched-by-the-fence',
    generatorCoEditProvenance(['content/docs/a.mdx']) === null && testVerdict(['content/docs/a.mdx']).governed === false);
  // A prefix on the real directory, not a substring: a sibling directory whose
  // name merely starts the same way is not the trusted generator.
  assert('a-near-miss-sibling-directory-is-not-mistaken-for-the-generator-tree',
    generatorCoEditProvenance(['scripts/docs-auditing/other.mjs']) === null);

  // ── the #11705 generator-owned rows inside `skills/**` ───────────────────
  //
  // The ruling's own limit is the thing to pin: a file qualifies ONLY by being
  // reproducible from its generator, proven per file. Two halves, both the
  // generator's own answer — it declared the path among its outputs, and its
  // `--check` reported no drift — and every other input fails closed.
  const skillRefs = GENERATED_SURFACE_EXCEPTIONS.find((e) => e.id === 'spec-skill-refs');
  const reactBlocks = GENERATED_SURFACE_EXCEPTIONS.find((e) => e.id === 'spec-react-blocks');
  const genIndex = REGISTER_SAMPLES['spec-skill-refs'];
  const handAuthored = 'skills/objectstack-ui/SKILL.md';
  // Real, and the reason this case is not hypothetical: `objectstack-upgrade`
  // and `objectstack-pm-dispatch` are shipped skills with NO SKILL_MAP entry,
  // so an `_index.md` under either would be hand-written prose at a path the
  // candidate matches.
  const unownedIndex = 'skills/objectstack-upgrade/references/_index.md';
  const declaredOutputs = [genIndex, 'skills/objectstack-data/references/_index.md'];
  const cleanRun = { ok: true, outputs: declaredOutputs, reason: 'the generator reported no drift' };

  assert('both-ruled-generator-rows-are-registered-under-the-skills-catalog-surface',
    skillRefs?.surfaceId === 'skills-catalog' && reactBlocks?.surfaceId === 'skills-catalog' && skillRefs.ruling === '#11705' && reactBlocks.ruling === '#11705');
  assert('every-sample-is-matched-by-the-row-it-illustrates',
    Object.entries(REGISTER_SAMPLES).every(([id, p]) => generatedExceptionFor(p)?.id === id), JSON.stringify(REGISTER_SAMPLES));
  assert('a-generated-index-routes-to-the-skill-refs-generator', generatedExceptionFor(genIndex) === skillRefs);
  assert('both-react-blocks-outputs-route-to-their-own-generator',
    generatedExceptionFor('skills/objectstack-ui/references/react-blocks.md') === reactBlocks &&
      generatedExceptionFor('skills/objectstack-ui/contracts/react-blocks.contract.json') === reactBlocks);
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
  assert('the-fences-are-per-row-neither-tree-fences-the-other-rows-generator',
    generatorCoEditProvenance(['packages/spec/scripts/build-skill-references.ts'], GENERATED_SURFACE_EXCEPTIONS[0]) === null &&
      generatorCoEditProvenance(['scripts/docs-audit/affected-docs.mjs'], skillRefs) === null);

  // Applied to a verdict: the #11685 shape lifts, and the ruled limit holds.
  const specPr = applyGeneratedExceptions(testVerdict(['packages/spec/src/ui/responsive.zod.ts', genIndex]), new Map([[genIndex, genuine]]));
  assert('the-#11685-shape-a-spec-pr-carrying-its-own-regenerated-index-is-NOT-governed',
    specPr.governed === false && specPr.hitPaths.length === 0 && specPr.exceptions[0].pureRegeneration === true, JSON.stringify(specPr.hitPaths));
  const withHandAuthored = applyGeneratedExceptions(testVerdict([genIndex, handAuthored]), new Map([[genIndex, genuine]]));
  assert('but-one-hand-authored-skills-file-beside-it-still-forks-the-whole-pr',
    withHandAuthored.governed === true && withHandAuthored.hitPaths.join() === handAuthored, JSON.stringify(withHandAuthored.hitPaths));
  const fabricated = applyGeneratedExceptions(testVerdict([handAuthored]), new Map([[handAuthored, { pureRegeneration: true, reason: 'claims to be verified' }]]));
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
  const liveRun = runSinkGenerator(resolve(scriptDir, '..', '..'), skillRefs);
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
    liftedRender.includes('PURE REGENERATION') && liftedRender.includes('check-audit-scope.mjs --write') && liftedRender.includes('THIS tree'), liftedRender);
  assert('a-lifted-render-still-warns-that-any-other-governed-hit-forks', liftedRender.includes('forks the whole PR'), liftedRender);
  const rejectedRender = renderTestVerdict(rejectedVerdict);
  assert('a-rejected-render-stays-GOVERNED-and-says-why-the-exception-did-not-lift',
    rejectedRender.includes('GOVERNED') && rejectedRender.includes('did NOT lift') && rejectedRender.includes('differs (fixture)'), rejectedRender);
  assert('a-verdict-without-exceptions-renders-exactly-as-before', renderExceptionLines(testVerdict(['AGENTS.md'])) === '' && !renderTestVerdict(testVerdict(['AGENTS.md'])).includes('#9866'));

  if (failures.length > 0) {
    console.error(`✗ check-governed-merges --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(`✓ check-governed-merges --self-test: ${checked} assertions (the unified governed predicate + near misses, subject→PR spellings, window parsing, the #12633 landing window — the QS-7 regression pin in both directions, the topological close beyond the budget, the unproven-boundary EDGE, the listed-or-INCOMPLETE invariant over every fixture, the escalating floors, per-repo --since-ref resolution and its named fallback, and the window words — the replay fixtures, the four-repo resolution incl. absent/wrong-origin/relocated checkouts, the attribution channel chain + its proxy-transport re-arm plan and its one named fallback line, the three-way attribution column (resolved · every-channel-failed · NOT LOOKED UP, and the note pointer that belongs to the middle one alone), the --test pre-arm predicate, the generated-artifact provenance exception — the four ruled cases against the generator's own splice, byte-exactness, fail-closed inputs, the untouched mixed-diff rule, single-file-not-a-class, the #11084 generator co-edit fence in both directions, and its render words — the #11705 generator-owned rows inside skills/** (a genuine generated file passes, the same path hand-edited does not, a path no generator declares is hand-authored content, per-row fences, and the enumeration read from the real generator), the exit table, the report wording pins, and the #13307 remote-reachability leg — the pure freshness verdicts in every branch (unreachable · a remote naming no commit · an unreadable local tip · a mirror behind its remote · the two-unreadable-shas degenerate case that must never read as a match), the report words in both directions (an unreachable repo never renders the tick, a reachable one still says a MEASURED zero, and a row with no remote reading never claims one), and the REAL prober on local bare-repo fixtures over the file transport — a live remote, a deleted one, the --exit-code branch, and a mirror the remote moved past).\n  ${liveNote}`);
}

/** The exit code `--test` would return for a path list — pinned without spawning. */
function runTestModeExitFor(paths) {
  if (paths.length === 0) return EXIT_CANNOT_SWEEP;
  return testVerdict(paths).governed ? EXIT_TEST_GOVERNED : EXIT_TEST_NOT_GOVERNED;
}

// `invokedDirectly` for the same reason line 810 carries it: this module is
// imported for its exported predicates (`proxyRearmPlan` — see
// scripts/pm/ci-failure.mjs), and an unguarded trigger ran THIS file's 77
// assertions inside the importer's own `--self-test`, printing a second
// summary and putting an unrelated file's failures on the importer's exit
// code. A self-test is a mode of the file that is being RUN, never a side
// effect of importing it.
if (invokedDirectly && process.argv.includes('--self-test')) {
  await selfTest();
}
