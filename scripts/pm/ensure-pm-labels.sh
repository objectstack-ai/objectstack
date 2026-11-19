#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# ensure-pm-labels.sh — idempotent creation of the pm-dispatch label vocabulary,
# and, on demand, reconciliation of the live label objects with it.
# Run once at the start of a first round (safe to rerun any time).
#
#   bash scripts/pm/ensure-pm-labels.sh              # create-if-missing (default)
#   bash scripts/pm/ensure-pm-labels.sh --reconcile  # …and align existing objects
#
# ## The two modes, and why the default is the timid one
#
# DEFAULT — create-if-missing. A label this file names that does not exist on a
# repo is created with the colour and description below; a label that already
# exists is left completely alone, whatever it says. This is the posture the
# script has always had, and it stays the default because the common case is a
# round-start rerun by whoever happens to be holding label-write credentials:
# that rerun must never be able to rewrite the vocabulary as a side effect.
#
# --reconcile — the deliberate PM action that the create-only posture kept
# deferring. Every label named in this file has its colour and description SET
# to the values below, whether or not it already matched. This exists because
# create-if-missing cannot repair drift by construction, and drift is not
# hypothetical: a label object auto-created by GitHub the first time someone
# applies an as-yet-uncreated label gets the default grey and an EMPTY
# description, and no number of reruns of the default mode will ever fix it.
# Measured 2026-08-20, all 21 vocabulary labels in objectstack-ai/objectstack
# and all 11 in objectstack-ai/objectui differed from the values below.
#
# ⛔ Reconcile ALIGNS ONLY. It sets colour and description on the labels THIS
# FILE NAMES. It never deletes a label, never renames one (it never passes
# `--name`), and never touches a label this file does not name — the retired
# lanes below, and any repo-local label, are left exactly as they are. Deleting
# a retired label object remains a separate, deliberate PM action. Running it
# twice changes nothing the second time.
#
# The label set IS the PM state machine (.claude/skills/pm-dispatch/SKILL.md,
# "State model"): every label here is consumed by a named query or gate.
# ⛔ The retired lanes (domain:spec-surface and domain:spec-tooling,
# retired 2026-08-16 — maintainer ruling 「A」 merged both into the single
# domain:spec lane, the sub-lane criteria surviving as the spec seat's dispatch
# reference; domain:engine-core / domain:metadata / domain:drivers /
# domain:identity, retired 2026-08-19 — maintainer ruling 「engine-core +
# metadata + drivers -> engine, identity + services → services 怎么样?」 folded
# the engine-side three into domain:engine, which thereby RE-ENTERS circulation
# after its own earlier retirement, and identity into domain:services) are
# deliberately ABSENT — recreating a retired label puts an ownerless lane back
# into GitHub's autocomplete. Their leftover label OBJECTS may still exist in
# the repos; deleting those objects is a separate, deliberate PM action. One
# TRANSITIONAL exception, recorded at its rows in the domain-lane block below:
# the three lanes that folded into domain:server on 2026-10-22, and the
# domain:rest spelling read the same way since 2026-11-06, keep alias rows
# until their last open card lands.
# The objectui-repo STREAM labels domain:spec / domain:devx / domain:tooling,
# retired in objectui only on 2026-10-22 (maintainer ruling 「甲，现在做」), are
# recorded beside the objectui domain:ui row further down, for the reason the
# next paragraph gives for `repo:objectstack`.
#
# ⛔ One RETIRED ROUTING label is held on those same two terms — deliberately
# absent, object deliberately kept — but is recorded beside the `repo:*` rows
# further down rather than in this paragraph: `repo:objectstack`, retired from
# circulation 2026-09-01. It is filed there because this paragraph answers
# "what is retired?", while the question that actually recreates a label is
# "should there be a fourth `repo:*` row?" — and that one is only ever asked
# where those rows are.
#
# Requires the `gh` CLI. Where only the GitHub MCP tools are available, mirror
# these creations through them — the protocol is identical.
#
# ⚠️ GitHub hard-caps label descriptions at 100 characters: `gh label create`
# / `gh label edit` get HTTP 422 above that, and the `|| true` (needed for
# idempotent reruns) swallows the failure — an over-long -d line means the
# label is NEVER created on a repo where it doesn't exist yet, silently, and a
# rerun can never repair it. Keep every -d in this file ≤100 characters
# (measured: a ~145-char description 422'd in live use). `check:pm-label-desc-cap`
# (scripts/pm/check-label-desc-cap.mjs) enforces that cap on every -d below, and
# because reconcile re-sends those SAME strings (see the shim), the cap covers
# the edit path too. Reconcile deliberately does NOT swallow its failures the way
# creation must: a failed edit means the drift is still there, so it is reported
# and the script exits non-zero.

set -uo pipefail

RECONCILE=0
RECONCILE_FAILURES=0

usage() {
  cat <<'EOF'
usage: bash scripts/pm/ensure-pm-labels.sh [--reconcile]

  (no flags)   create-if-missing: create the labels this file names where they
               are absent; leave every existing label object untouched.
  --reconcile  additionally SET colour and description on the labels this file
               names, aligning objects that have drifted. Never deletes, never
               renames, never touches a label this file does not name.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --reconcile) RECONCILE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    # An unrecognised flag is a HARD error, never a silent create-only run: a
    # mistyped `--reconsile` that fell through to the default would print the
    # ordinary success line, and the operator would read a reconciliation that
    # never happened as done.
    *) printf 'ensure-pm-labels: unknown argument: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

# ── The reconcile shim ───────────────────────────────────────────────────────
# Every vocabulary line below is written ONCE, in the ordinary
# `gh label create <name> -R <repo> -c <colour> -d "<description>"` form, and
# this function is what those lines actually call. It shadows the `gh` CLI
# rather than sitting behind a differently-named wrapper for two reasons:
#
#   1. ONE literal per label. Reconcile re-sends the very string the create line
#      carries, so there is no second, separately-maintained edit table to drift
#      from this one — and `check:pm-label-desc-cap`, which measures the -d text
#      on these create lines, thereby bounds the edited description as well. A
#      hand-written edit table would be measured by nothing.
#   2. No line can opt out. Someone adding a label a year from now writes the
#      ordinary create line and gets reconcile behaviour for free; there is no
#      prefix to forget and no way to add a label that reconcile then ignores.
#
# Anything that is not a `label create` is passed straight through.
gh() {
  if [ "${1:-}" != "label" ] || [ "${2:-}" != "create" ]; then
    command gh "$@"
    return $?
  fi

  local argv=("$@")
  command gh "$@"
  local create_status=$?
  [ "$RECONCILE" = 1 ] || return $create_status

  local name="${argv[2]:-}" repo="" colour="" description=""
  local i=3
  while [ "$i" -lt "${#argv[@]}" ]; do
    case "${argv[$i]}" in
      -R|--repo)        repo="${argv[$((i + 1))]:-}"; i=$((i + 2)) ;;
      -c|--color)       colour="${argv[$((i + 1))]:-}"; i=$((i + 2)) ;;
      -d|--description) description="${argv[$((i + 1))]:-}"; i=$((i + 2)) ;;
      *) i=$((i + 1)) ;;
    esac
  done
  if [ -z "$name" ] || [ -z "$repo" ]; then
    printf '  ✗ cannot reconcile (missing label name or -R repo): %s\n' "${argv[*]}"
    RECONCILE_FAILURES=$((RECONCILE_FAILURES + 1))
    return $create_status
  fi

  # ⛔ colour and description only — never --name (rename), never `label delete`.
  # stderr is captured rather than inherited because the call sites below send
  # stderr to /dev/null for the create; a swallowed edit failure would be the
  # exact silence this mode exists to end.
  local err
  if err=$(command gh label edit "$name" -R "$repo" --color "$colour" --description "$description" 2>&1 >/dev/null); then
    printf '  ↻ %s @ %s\n' "$name" "$repo"
  else
    printf '  ✗ %s @ %s — gh label edit FAILED: %s\n' "$name" "$repo" "${err//$'\n'/ }"
    RECONCILE_FAILURES=$((RECONCILE_FAILURES + 1))
  fi
  return $create_status
}

# objectos joined the triage sweep under Option B (maintainer ruling 2026-08-18,
# 「就按 B,带你补的两条,落地吧」): it gets the full pm state-machine vocabulary
# below, but stays OUT of the domain-lane loop (lanes are main-repo-only — its
# execution folds into domain:devx). That absence is deliberate, not an
# oversight. Actually RUNNING this against objectos is a PM
# landing step (needs label-write credentials on that repo).
#
# hotcrm enrolled on the SAME Option B terms when its execution seat was opened
# (maintainer ruling 2026-08-20, verbatim prefix — the full quote lives on the
# lane-registration card: 「新增了 hotcrm 仓库的席位,这个仓库作为 objectstack 的样板工程,
# 使用元数据开发crm应用…」). It is the EXEMPLAR APP repo, so like objectos it sits
# outside the spec dependency chain: it gets the full pm state-machine vocabulary
# below, and stays OUT of the domain-lane loop (lanes are main-repo-only — hotcrm
# is a REPO lane, seated through the repo:hotcrm seam label further down). That
# absence is deliberate, not an oversight.
# Actually RUNNING this against hotcrm is a PM landing step, same as objectos
# (needs label-write credentials on that repo).
#
# mobile enrolled on the same terms when its on-demand repo lane was registered
# (maintainer choice 2026-11-02, verbatim: "Register, seat on demand
# (Recommended)"): the native shell that hosts the Console. Full pm vocabulary,
# OUT of the domain-lane loop, and no
# repo:mobile seam row until a seam card gives one a reader. Running this
# against mobile is a PM landing step, same as hotcrm.
for R in objectstack-ai/objectstack objectstack-ai/objectui objectstack-ai/cloud objectstack-ai/objectos objectstack-ai/hotcrm objectstack-ai/mobile; do
  gh label create pm:queue            -R "$R" -c 0e8a16 -d "Ready for the PM dispatch loop" 2>/dev/null || true
  gh label create pm:dispatched       -R "$R" -c 1d76db -d "Dispatched to a dev agent by /pm-dispatch" 2>/dev/null || true
  # needs-user-decision is the RULING inbox and lives on ISSUES only (SKILL.md 状态模型: 只挂决策卡,
  # ⛔ 永不挂 PR). A PR waiting on the maintainer's own review and merge carries pm:awaiting-merge
  # (below) instead — the maintainer ruled the two inboxes apart so the decision count and the
  # awaiting-merge count never share a label.
  gh label create needs-user-decision -R "$R" -c d93f0b -d "Blocked on a maintainer decision — do not dispatch; decision cards only, never on a PR" 2>/dev/null || true
  gh label create pm:on-hold          -R "$R" -c e4e669 -d "Decision made, deliberately deferred — no dispatch, no nag; restart condition in the hold comment" 2>/dev/null || true
  gh label create pm:blocked          -R "$R" -c b60205 -d "Blocked by another issue/PR — body carries Blocked-by: #N" 2>/dev/null || true
  # pm:awaiting-maintainer — the state for a card whose remaining work is a
  # MANUAL maintainer action (maintainer ruling 2026-08-23, verbatim: 「可以新标
  # 签,最好 pm: 开头」; the spelling was finalized in the implementing PR).
  # It exists because the two adjacent states are both wrong for that shape and
  # the specimen card oscillated between them: needs-user-decision is the RULING
  # inbox (here the ruling is already given, and parking an act there inflates
  # the count of decisions owed), while pm:on-hold requires a machine-fireable
  # Restart-when: line — H9 counts `Restart-when: manual — …` as MISSING by
  # design, so a hold is the one state this card can never be well-formed in.
  # ⛔ MUTUALLY EXCLUSIVE with pm:queue / pm:dispatched / pm:blocked /
  # pm:on-hold / needs-user-decision: the state labels are one-of, and a second
  # state claim declares a second release mechanism that does not exist.
  # Named consumers, all in scripts/pm/check-half-states.mjs: H25 (that
  # exclusivity), H11 (its parked inventory — an important card in a state with
  # no machine exit ages out of sight unless a human is re-asked), H13's
  # PM_STATE_LABELS (a card in this state HAS a state, so it must not read as
  # the half-annotated shape) and H22's PM_RESIDUE_LABELS (a claim that an act
  # is still owed is residue on a closed card). Per-repo loop for the same
  # reason priority:p0 and pm:retriage are in it: the sweep is repo-parameterized
  # (PM_SWEEP_REPO) and the state-model row requires the label in every repo of the loop.
  # Colour: needs-user-decision's family (a HUMAN owes something), one shade
  # lighter because the ruling here is already given.
  gh label create pm:awaiting-maintainer -R "$R" -c e99695 -d "Awaiting a manual maintainer action — ruling already given; no dispatch, no machine exit" 2>/dev/null || true
  # pm:awaiting-merge — a PULL REQUEST whose landing waits on the maintainer's
  # own review and merge (SKILL.md 复核 ②: 「PR 悬着等人批,同笔挂 pm:awaiting-merge」;
  # maintainer ruling, verbatim: 「同意 pm:awaiting-merge」). It exists because that
  # PR used to carry needs-user-decision, so the maintainer's one inbox mixed
  # decision cards (a letter owed) with PRs (a review and a click owed) and no
  # count could tell them apart. ⛔ PRs ONLY — never on an issue; it is NOT one
  # of the six card states (SKILL.md 状态模型: 不入六态) and never joins
  # PM_EXCLUSIVE_STATE_LABELS. Kept distinct from pm:awaiting-maintainer, which
  # is an ISSUE waiting on a human act OUTSIDE GitHub. Named consumers: SKILL.md
  # 复核 ② (the seat writes it beside the approval request), H48 in
  # scripts/pm/check-half-states.mjs (GOVERNED_PR_AWAITING_MERGE_LABEL: a
  # governed PR with an ACCEPT verdict must carry it), acceptedPullWait in
  # scripts/pm/check-handover.mjs (a stay-behind pull "awaits a human approval"
  # by this label), and scripts/pm/fleet-roster.mjs (the "awaiting merge" column
  # and the 「决策卡 N · 待您审合 PR M」 summary line). Per-repo loop: the sweep is
  # repo-parameterized and a governed PR can be opened on any repo of the loop.
  # Colour: the same HUMAN-owes family as needs-user-decision, between it and
  # pm:awaiting-maintainer, because here the click is still owed.
  gh label create pm:awaiting-merge   -R "$R" -c e07b63 -d "PR only: landing waits on the maintainer's own review and merge (SKILL.md 复核 ②); never on an issue" 2>/dev/null || true
  # priority:p0 is the QUEUE-JUMP tier of the lane pull order, and ordering
  # only: a p0 card still obeys the same-file serial queue and the claim
  # protocol (SKILL.md state model, 「优先是排序,不是豁免」). Set by the triage
  # seat when it grades a card; removed by triage when the grade changes. Named
  # consumers: the lane pull order (p0, then p1 from any area, then the next
  # card of the area or sub-epic the maintainer named, p2 before p3 inside it;
  # references/execution-duties.md 取卡全序) — which is also where a release
  # blocker sits, as p0 inside the release window — and the half-state sweep's
  # H10 (stale unclaimed p0) and H11 (important card parked) in
  # scripts/pm/check-half-states.mjs. It is in this
  # per-repo loop because that sweep is repo-parameterized (PM_SWEEP_REPO) and
  # grading is a per-repo triage duty — the same reasoning as pm:retriage
  # below. Measured 2026-08-20: objectui carries a live priority:p0 card whose
  # label OBJECT was auto-created by that first application, so it has GitHub's
  # default colour and an EMPTY description — exactly the drift this row closes
  # for the next repo. The objects that already exist keep their colour and
  # description under the default mode; `--reconcile` is what aligns them.
  # Measured 2026-08-20 — the specimen that motivated the reconcile mode: this
  # repo's live object read "Critical: blocker, must ship before MVP", the
  # OPPOSITE of the state model (SKILL.md: 插队 is ORDERING, explicitly not an
  # exemption), on a surface that is read by hovering.
  gh label create priority:p0         -R "$R" -c b60205 -d "Queue-jump: outranks batch and breaks the round — never exempts claiming or same-file serial" 2>/dev/null || true
  # tracking marks a generated/standing anchor issue, never dispatchable
  # work, and is load-bearing twice over: it is what the half-state-patrol
  # (and release-coverage-patrol) workflow's ANCHOR_ISSUE lookup finds the
  # anchor by in whichever repo it is installed in, and it is an
  # H13_EXEMPT_LABELS member in scripts/pm/check-half-states.mjs, so it is
  # what stops the anchor itself from appearing as a finding in the very
  # sweep it hosts. Same per-repo loop as priority:p0 above, on the rule
  # stated beside it, quoted rather than paraphrased: "It is in this
  # per-repo loop because that sweep is repo-parameterized (PM_SWEEP_REPO)
  # and grading is a per-repo triage duty — the same reasoning as
  # pm:retriage below." For tracking the repo-parameterized sweep is
  # check-half-states.mjs's H13 check rather than triage grading, but the
  # test it applies is the same one: a label belongs in this loop when the
  # sweep reads it in every repo the sweep itself runs in, and H13 runs in
  # every repo of the loop. Measured 2026-09-03: objectstack and objectui both carry a
  # live `tracking` object with GitHub's default colour `ededed` and an
  # empty description — the same drift the priority:p0 comment above
  # records for objectui.
  gh label create tracking            -R "$R" -c cfd3d7 -d "Generated anchor/tracker issue — not dispatchable; exempt from the half-state sweep's findings" 2>/dev/null || true
  # pm:blocking is a derived CACHE, never hand state (maintainer opinion
  # 2026-08-13, superseding the earlier derived-only-no-stored-label ruling):
  # the triage sweep writes/removes it from the Blocked-by: reverse index, and
  # it comes off when every dependent closes. Since 2026-11-18 it is NOT a rank
  # of the pull order and raises no grade (「有人在等」 is not a grading
  # criterion): a card carries it only when the card it blocks is in an area
  # being dispatched. Named consumers: the seat pulling inside that area, which
  # reads it as "this card unblocks dispatched work" (execution-duties.md
  # 取卡全序 orders by `Blocked-by:`), and list-page scans. A hand-set instance
  # is mislabeling — the sweep corrects it against the index.
  gh label create pm:blocking         -R "$R" -c 8250df -d "Derived cache from the Blocked-by reverse index: open card with open dependents — never hand-set" 2>/dev/null || true
  # pm:retriage is a QUESTION put to the triage seat (a re-grade, a lane for a
  # cross-domain PR, a re-route, a split, a disposition fork a dev report left
  # open); it COEXISTS with the standing pm:* label and ⛔ never replaces it
  # (maintainer ruling 2026-08-19/20, 「同意 并存」): the objecting seat sets it in
  # the same write as its objection comment, which states what it asks, and the
  # triage Routine is the only remover — hanging and removing belong to two
  # different parties, which is what makes the state safe. Named consumers: the
  # dispatchable-candidate query (a pm:queue card carrying it is skipped — the
  # question is unanswered, no dispatch) and the triage round's answer pass,
  # which answers what the objection comment asks each fire and drops the label
  # in the same write (SKILL.md 「`pm:retriage` 每 fire 先答异议评论所求,答后同笔
  # 摘标;须维护者答的进收件箱,标照摘」). It is in this per-repo loop because the
  # state-model row requires the label to exist in every repo of the loop; where a first
  # application already auto-created the object, creation here is a no-op and
  # `--reconcile` is what gives it this colour and description (measured
  # 2026-08-20: grey with an empty description in objectstack, and absent
  # entirely from objectui).
  gh label create pm:retriage         -R "$R" -c d4c5f9 -d "Question for triage, answered each fire; coexists with the standing pm:* label; no dispatch" 2>/dev/null || true
  gh label create finding             -R "$R" -c c2e0c6 -d "Recorded observation — held, not dispatchable until the findings triage round grades it" 2>/dev/null || true
  # tooling marks a card whose fix lands in a gate, script, workflow, skill,
  # seat protocol or PM tooling file (scripts/**, .github/**, .claude/**,
  # packages/lint gate rules, packages/spec/scripts/**) rather than in a product
  # package. Triage applies it at FIRST GRADING, in the same label write as
  # domain:* and priority:*; a filer may pre-apply it. Three named consumers, all
  # in the pm-dispatch charter (SKILL.md 状态模型 row, 分诊座位职责 and 候选与批次):
  # the execution seat's candidate query, which excludes a tooling card carrying
  # neither an `Unblocks: #N` line nor a named published surface; the triage
  # first-touch close; and the census / half-state patrol, for which a tooling
  # card open in pm:queue with neither line is a half-state. (No fleet-wide
  # in-flight count: the take-order alone sequences tooling cards.) It is in this
  # per-repo loop on the rule stated
  # beside priority:p0 above — the sweep that reads it is repo-parameterized
  # (PM_SWEEP_REPO) and first-touch grading is a per-repo triage duty. Measured
  # 2026-09-21 in objectstack, where the label is live on 44 queue cards: the
  # object is GitHub's default `ededed` with an EMPTY description, because until
  # this row nothing here named it — the exact drift the header describes, and
  # one no rerun of the default mode can repair. The -d below is 100 characters,
  # at the hard cap (check:pm-label-desc-cap).
  gh label create tooling             -R "$R" -c fbca04 -d "Fix lands in tooling, not a product package — enters pm:queue only with Unblocks: or a named surface" 2>/dev/null || true
  gh label create pm:epic             -R "$R" -c 5319e7 -d "Reserved by a dedicated epic PM, parent or sub-issue; other PMs never take it; never with pm:queue" 2>/dev/null || true
  # pm:mailbox marks a project's cross-account mailbox PR (#25417): a draft PR
  # on `mailbox/<login>` that a resident thread subscribes to, because a PR
  # comment wakes a subscribed session and an issue comment wakes nothing
  # (measured on #25392: 70 s from the relay, 4 s from a second account). It is
  # never merged and closed on account handover. Named consumers: every query
  # that enumerates open PRs for landing appends `-label:pm:mailbox`
  # (LEDGER_EXCLUSION, scripts/pm/mailbox-open.mjs, the one opener and closer),
  # and a subscribed thread reads it as "owes no CI". In this per-repo loop
  # because a lane project may keep its mailbox on any board it works.
  gh label create pm:mailbox          -R "$R" -c c5def5 -d "A project's cross-account mailbox PR — never merged, owes no CI, excluded from every ledger" 2>/dev/null || true
done

# needs:pack-smoke — the opt-in pre-merge pack smoke (#14214, derived from the
# #14000 ruling; maintainer-approved 2026-09-01, director batch #23, 「同意」).
# Its named consumer is a GATE rather than a query: the job guard in
# `.github/workflows/pack-smoke-optin.yml`, which runs the packed-install smoke
# on the PR's merge preview only while this label is on the PR.
#
# ⚠️ It is the first label in this file that is NOT part of the PM state
# machine, and the difference matters to anyone extending it. Every pm:* row
# above is a state a PM seat writes; this one is written by the PR AUTHOR about
# their own diff — the ruling's word is 自声明 — and it names a property of the
# CHANGE, not a position on the board. So it is one-of with nothing, it blocks
# no dispatch, and no sweep in scripts/pm/ reads it. It is declared here anyway
# because this file is the repo's only declared home for a label OBJECT, and an
# undeclared label is the grey / empty-description drift the header describes:
# auto-created by its first application and unrepairable by any rerun.
#
# ⛔ Never auto-applied. Nothing in .github/labeler.yml may grow a rule for it
# (the workflow header argues why: path-derived application is a different
# design from the one that was ruled, and it puts the ~45-minute cost back into
# the default inner loop the ruling kept it out of). Like every other row here,
# this file only ensures the OBJECT — it never hangs the label on a PR.
#
# Main repo only, for the ordinary reason: the workflow that consumes it lives
# here. Colour 006b75 is deliberately outside every family above — this is not a
# lane, not a state, and not a routing seam, and borrowing one of their colours
# would assert a kinship the paragraph above spends its length denying.
gh label create needs:pack-smoke -R objectstack-ai/objectstack -c 006b75 -d "Opt-in pre-merge pack smoke: self-declared breaking auth/audience change (see CONTRIBUTING.md)" 2>/dev/null || true

# needs:upgrade-harness — the opt-in pre-merge 18.x upgrade harness (#24522;
# ruling record 6266750393 on #15194, R2). Its consumer is the job guard in
# `.github/workflows/upgrade-harness-optin.yml`, which boots the PR's merge
# preview on the 18.0 fixture only while this label is on the PR. Like
# needs:pack-smoke it names a property of the CHANGE, not a board position: the
# epic seat hangs it on each 18.x line PR, nothing auto-applies it, and no sweep
# in scripts/pm/ reads it. Same colour as needs:pack-smoke, the one family it
# belongs to: an opt-in pre-merge check.
gh label create needs:upgrade-harness -R objectstack-ai/objectstack -c 006b75 -d "Opt-in pre-merge 18.x upgrade harness: an 18.0 database boots on this PR's merge preview (#24522)" 2>/dev/null || true

# needs:contract-review — a MARKER, never a gate; rules in
# .claude/skills/pm-dispatch/references/contract-review.md 〈等 L2 标记〉. The
# dispatching seat hangs it on the PR at ACCEPT when either clause-② limb hits
# and no same-form PASS is on the current head; the seat posting that PASS, or
# the dispatching seat at merge/close, clears it (a FAIL leaves it on). Named
# readers: the maintainer's PR-list filter
# `is:pr is:open label:needs:contract-review` and each seat's patrol and
# handover. ⛔ No check, workflow, queue guard or patrol script reads it — the
# queue releases on the `## Contract review` record alone.
# Restored by the maintainer's instruction recorded on #19973, verbatim:
# 「恢复 needs:contract-review，把这句原话写进一张 skills 车道的卡」 — answering a
# question that proposed a marker, not a gate. The gate role, `--pair`, the
# double carrier and the independence pair that ruling record 5770886272
# retired stay retired. Main repo only: the clause-② contract surface lives
# here. Colour bfdadc sits outside the state and red (blocked / decision)
# families.
gh label create needs:contract-review -R objectstack-ai/objectstack -c bfdadc -d "Marker only — PR awaits its at-tier Contract review PASS; no check reads it, the record decides" 2>/dev/null || true

# pinned and work-in-progress — the two STALE-SWEEP EXEMPTION labels. Their
# reader is a WORKFLOW rather than a query: `.github/workflows/stale.yml`
# (actions/stale) skips any issue or PR carrying one of them. Like the needs:*
# rows above they are not PM states, not lanes and not routing seams: one-of
# with nothing, they block no dispatch, and no sweep in scripts/pm/ reads them.
# Measured 2026-10-28 on objectstack-ai/objectstack: both answered 404 — the
# exemption the workflow declares for them was dead, because a label that does
# not exist cannot be applied (triage grade 6464839941 on #27151: create both).
#
# pinned — named readers: stale.yml `exempt-issue-labels` AND
# `exempt-pr-labels`, and `scripts/pm/mailbox-open.mjs` (PR #27143), which sends
# it as STALE_EXEMPT_LABEL in PR_LABELS on every mailbox `pr_create`, so a
# mailbox PR — never merged, often quiet for weeks — is not marked stale at 30
# days and closed 7 days later. Applied by that tool, or by hand to any issue or
# PR that must outlive the sweep.
#
# work-in-progress — one named reader only: stale.yml `exempt-pr-labels`. No
# tool applies it; it is applied by hand to a PR that must survive a quiet
# stretch. It is declared here so that the exemption the workflow already
# declares is not dead — the alternative, editing it out of stale.yml, is a
# Tier H change this file does not make.
#
# Main repo only, for the needs:* rows' reason: the workflow that reads them
# lives here (the other four repos' workflows were not readable from the seat
# that measured this — widening the rows is a vocabulary decision, not a
# maintenance edit). Colour cfd3d7 is the sweep-exempt family `tracking` and
# `status:parked` already share; `tracking` is itself in the same stale.yml
# exemption list.
gh label create pinned           -R objectstack-ai/objectstack -c cfd3d7 -d "Exempt from the stale sweep (stale.yml, issues and PRs); every pm:mailbox PR carries it" 2>/dev/null || true
gh label create work-in-progress -R objectstack-ai/objectstack -c cfd3d7 -d "PR exempt from the stale sweep (stale.yml exempt-pr-labels); applied by hand, no tool sets it" 2>/dev/null || true

# lease:<area> — the AREA-LEASE family (.claude/skills/pm-dispatch/references/
# area-lease.md). An area session hangs `lease:<area>` in the same write as its
# dispatch pair when it claims a card, and reads it back with the pair; every
# other area that reads a foreign `lease:*` on a card leaves the card alone. Those
# two area-lease.md lines are the named readers; no script in scripts/pm/ reads
# the family, and label-write.mjs sends it like any other label.
#
# The values are the lease table's area names, and the table is re-derived at
# every seat, hand-over or shift (area-lease.md 〈分不分区,动态定〉), so the loop
# below seeds the CURRENT table only — today the server lane's eight pilot areas,
# whose objects already exist as GitHub's auto-created grey with an empty
# description, which only `--reconcile` repairs. When a lane re-cuts its table,
# MOVE the values here, as the release-board loop further down moves its window;
# a retired area's object stays on its closed cards as history and needs no row.
# A value with no row is auto-created grey on first use, so it owes one. Main
# repo only: every lane that runs the mode keeps its cards here. Colour 0052cc is
# outside every family above — a lease is an ownership seam, not a state, a lane
# or a marker.
for A in A1 A2 A3 A4 A5 E1 E2 E2b; do
  gh label create "lease:$A" -R objectstack-ai/objectstack -c 0052cc -d "Area lease $A: the card belongs to that area's thread session; other areas leave it alone" 2>/dev/null || true
done

# Routing labels exist only on the main backlog repo, and mark SEAM cards only
# (file-at-destination ruling: pure sibling-repo fixes live in the target repo).
#
# repo:hotcrm joined 2026-08-20 with the hotcrm execution seat. The seam reading
# is the ordinary one and needs no special case: a card is repo:hotcrm only when
# cross-repo ORDERING with hotcrm is its substance. The charter's own routing rule
# runs the OTHER way and produces no label here — a platform gap discovered while
# building the exemplar app is filed AT the platform repo (never worked around in
# hotcrm), which makes it an ordinary platform card, not a seam card.
#
# ⚠️ Colour: the two rows below already disagree (fbca04 / c5def5), so there is no
# single family colour to inherit. This row takes objectui's fbca04 — also the
# colour the published pm-dispatch skill's routing-label example carries — so the
# family converges on two spellings instead of gaining a third. ⛔ Do NOT "tidy"
# repo:cloud to match while you are here: under --reconcile that rewrites a LIVE
# label object's colour, which is a deliberate PM action and not this row's.
gh label create repo:objectui -R objectstack-ai/objectstack -c fbca04 -d "Seam card: cross-repo ordering with objectui is the substance (pure objectui fixes live in objectui)" 2>/dev/null || true
gh label create repo:cloud    -R objectstack-ai/objectstack -c c5def5 -d "Card routed whole to the cloud PM: needs cloud code, a producer or a fact (cloud owns it to closure)" 2>/dev/null || true
gh label create repo:hotcrm   -R objectstack-ai/objectstack -c fbca04 -d "Seam card: cross-repo ordering with hotcrm is the substance (pure hotcrm fixes live in hotcrm)" 2>/dev/null || true

# ⛔ There is no fourth `repo:*` row, and that absence is now DECLARED rather
# than merely true: `repo:objectstack` is RETIRED FROM CIRCULATION — triage
# ruling on #13991, 2026-09-01, verbatim: 「裁定:方向 2(退役)。一个在自己每一个
# 承载卡上都零信息、又反转家族语义的标签,声明它只是把例外写进文档;退役它把家族
# 恢复成单义。」
#
# The retirement SHAPE differs from the retired lanes in the header, and that
# difference is why this block exists at all. Those lanes were created by this
# file once and had their rows deleted. `repo:objectstack` never had a row: the
# object was auto-created by a hand-application (the grey / empty-description
# drift the header describes), so its absence here was UNDECLARED, and a reader
# of the three rows above could not tell an oversight from a decision — the
# honest default reading being oversight. This block is the decision, written
# where a future author would otherwise supply the missing row.
#
# The two measured grounds, both from #13991 and the triage sweep on it:
#   1. ZERO INFORMATION ON EVERY CARRIER. All 4 open carriers — #12237, #12238,
#      #12243, #12311, label sets read 2026-08-31 — already carry
#      `documentation` + `domain:devx`, which fully determines their routing.
#      The label adds nothing on any card that has it.
#   2. IT INVERTS THE FAMILY. Each row above says "the ordering is cross-repo,
#      the audience is elsewhere"; a `repo:` label naming THIS repo says the
#      opposite. Declaring it instead (the rejected option) would have bought a
#      documented exception in exchange for no routing power at all.
#
# ⛔ Retirement here means STOP CIRCULATING, never delete. The label OBJECT
# stays: deleting it would strip the label from CLOSED cards as well and
# destroy the record of what was routed this way — the header's rule, unchanged
# by this row, and a separate deliberate PM action either way. Being absent from
# this file, it is a label `--reconcile` does not name, so it can be neither
# recreated nor description-aligned. That is the intended end state.
#
# ⛔ Two acts this record deliberately does NOT perform. Stripping the label off
# those 4 live carriers is a BOARD act for the PM at the landing window —
# nothing in this file ever hangs or clears a label on a card. And the
# `repo:*` predicate in `scripts/pm/check-half-states.mjs` H14 stays LITERAL:
# narrowing it is a predicate change ruled on #13992, never a side effect of a
# vocabulary record. SKILL.md names no `repo:objectstack` (checked 2026-09-01),
# so the BY-PR prose sync the domain-lane block below requires has, here,
# nothing to carry.

# pm:seat marks a SEAT REGISTRY post — the protocol carrier, not dispatchable
# work (SKILL.md state model): one post per seat, its body is the single-writer
# authority, and the `label:pm:seat` list page is therefore the fleet status
# board. Set when a seat post is created; it never comes off — the post IS the
# seat, and a vacated seat flips its TITLE to ⏳ vacant and drops the assignee
# instead. Named consumers: the `domain:$D` description just below, which
# indexes seat cards by label:pm:seat; the triage round's seat-liveness patrol,
# which scans that same list page (references/dispatch-runbook.md); and the
# half-state sweep's H5 (title/assignee desync) and H6 (oversized body) in
# scripts/pm/check-half-states.mjs. Main repo only: there is exactly one seat
# per `domain:*` / `repo:*` lane and both of those families are main-repo-only
# (lanes are main-repo-only — the objectos Option B comment above), so the seat
# index can only be read here. Measured 2026-08-20: zero pm:seat cards in
# objectui and objectos. Creation is create-if-missing, so this repo's existing
# object keeps its current colour and description until `--reconcile` runs
# (measured 2026-08-20: the colour already matches; the description had drifted
# to an older wording).
# A sister-repo seat keeps its post in its own repository — hotcrm's posts
# live in hotcrm and fleet-roster.mjs reads that repo by default — so the
# "main repo only" sentence above holds for the domain:* lanes, not for repo
# lanes. mobile's charter (lanes/mobile.md) puts its seat post in mobile, so
# the label is created there too (one invocation per repo, one parsed line —
# check-label-desc-cap measures distinct descriptions per line); fleet-roster's
# DEFAULT_REPOS lists mobile.
for R in objectstack-ai/objectstack objectstack-ai/mobile; do
  gh label create pm:seat -R "$R" -c 1d76db -d "Seat registry post — protocol carrier, not dispatchable work; the label page is the fleet board" 2>/dev/null || true
done

# Domain lanes — the roster lives in SKILL.md's domain table; keep both in sync
# BY PR whenever a lane is added or retired.
#
# domain:server — the engine, services and cli lanes folded into ONE lane
# (maintainer ruling 2026-10-22, verbatim: 「就叫 server 吧」, then 「同意」 on
# letter 乙). Its three former labels are the one TRANSITIONAL exception to the
# header's retired-lanes-are-absent rule: they keep a row each below so that
# `--reconcile` writes the "retired, alias of domain:server" description the
# ruling asks for onto the live objects — in-flight cards keep their old label
# until they land and open cards are relabelled by triage only after the merge
# lands, so the objects stay in use for a while and a reader hovering one must
# learn where it went. The description is the whole point of those rows:
# create-if-missing is a no-op on objects that exist. domain:rest, never a lane
# of its own and carried by no card, joins them on the maintainer's 2026-11-06
# 「车道的问题同意」 so its object stops reading as a live lane. The readers that
# keep seeing every card through the old spellings live in
# scripts/pm/check-half-states.mjs (LANE_LABEL_ALIASES), and the write doors
# (issue-create, label-write, fleet-write/dispatch) read that same map to write
# domain:server in an alias's place. The cleanup PR that retires the objects
# (zero open cards on each) deletes these rows and that map together, and the
# header's rule resumes for them.
for D in server devx spec skills ui; do
  gh label create "domain:$D" -R objectstack-ai/objectstack -c bfd4f2 -d "Domain lane — seat card indexed by label:pm:seat" 2>/dev/null || true
done
gh label create domain:engine   -R objectstack-ai/objectstack -c bfd4f2 -d "Retired 2026-10-22, alias of domain:server (engine surface); in-flight cards keep it until they land" 2>/dev/null || true
gh label create domain:services -R objectstack-ai/objectstack -c bfd4f2 -d "Retired 2026-10-22, alias of domain:server (services surface); in-flight cards keep it until landed" 2>/dev/null || true
gh label create domain:cli      -R objectstack-ai/objectstack -c bfd4f2 -d "Retired 2026-10-22, alias of domain:server (cli surface); in-flight cards keep it until they land" 2>/dev/null || true
gh label create domain:rest     -R objectstack-ai/objectstack -c bfd4f2 -d "Retired 2026-11-06, alias of domain:server (rest surface); the relay writes domain:server instead" 2>/dev/null || true

# domain:cloud routes a WHOLE card to the cloud PM (the `repo:cloud` seat): any
# card that needs cloud code, a cloud producer, a cloud fact or carries a cloud
# half. No objectstack lane claims it; it rides with `repo:cloud`, the label the
# cloud seat's scope reads. Maintainer ruling 2026-10-27, verbatim: 「一个issue只要
# 涉及 cloud ，就归 cloud pm 处理」, superseding the 2026-09-18 parking ruling
# (「云服务旅程混在 objectstack / objectui 里的 ⇒保留 domain:cloud 标签 等 cloud 项目经理
# 迁移」): parked journeys are the cloud PM's too. The object already exists in
# objectstack (auto-created, so `--reconcile` is what aligns it) and is absent in
# objectui; the roster makes both. SKILL.md's domain table carries the matching
# row, and references/cross-repo-coordination.md the routing rule.
gh label create domain:cloud -R objectstack-ai/objectstack -c bfd4f2 -d "Touches cloud: the whole card is the cloud PM's (repo:cloud seat); no objectstack lane claims it" 2>/dev/null || true
gh label create domain:cloud -R objectstack-ai/objectui    -c bfd4f2 -d "Touches cloud: the whole card is the cloud PM's (repo:cloud seat); objectui lanes never claim it" 2>/dev/null || true
# status:parked is the other half of parking: the backlog sweep's disjunct ③
# (有 domain:* 无 pm-state) and check-half-states.mjs's H13 read it as the
# exemption (H13_EXEMPT_LABELS; SKILL.md 排除 `status:parked`), so a card that
# carries domain:cloud WITHOUT it is listed and "cured" with a pm state every
# fire, against the ruling above. The object exists in objectstack (auto-created)
# and was absent in objectui; the roster makes both. Colour matches `tracking`,
# the other sweep-exempt label. Descriptions differ per repo on purpose: the
# check:pm-label-desc-cap dry run wants one distinct description per parsed line.
gh label create status:parked -R objectstack-ai/objectstack -c cfd3d7 -d "Parked — exempt from the PM sweep and half-state patrol until its owner migrates it (e.g. cloud PM)" 2>/dev/null || true
gh label create status:parked -R objectstack-ai/objectui    -c cfd3d7 -d "Parked in objectui — exempt from the PM sweep until the cloud PM migrates it (with domain:cloud)" 2>/dev/null || true

# objectui workload lanes — TWO since the maintainer's ruling of 2026-10-22,
# quoted verbatim: 「objectui 只有 skills 是特殊的，他本身没有 spec 的概念。devx
# 我感觉可以和 ui 合并」, and on the options put to them, 「甲，现在做」. The
# three-stream vocabulary it replaces (maintainer rulings 2026-08-21, verbatim:
# 「B:两车道」→「现在本身就有 domain:devx」→「不要搞出那么多车道名称」→「也有
# domain:spec」「其他就是 domain:ui ?」, naming finalized 「按 domain:ui 定稿」)
# streamed objectui cards by the surface their FIX lands on into domain:devx
# (engineering face), domain:spec (contract face) and domain:ui (the rest).
# Measured on objectui, 2026-10-08 → 2026-10-22: every domain:spec card was
# objectui's own packages/types, docs and widgets catching up with the protocol
# and was worked by objectui hands — the protocol itself lives only in
# objectstack — and every domain:devx card was objectui CI, test shards, pin
# and release tooling, worked by ui seats. So objectui has exactly two lanes:
#   domain:ui     — ALL objectui code: the published library (components,
#                   plugin-*, fields, layout, core) and the apps; packages/types,
#                   the schema corpus and the @objectstack/spec pin coupling;
#                   .github/, scripts/, the build/publish/release pipeline and
#                   the gate tooling; docs, which follow the surface they
#                   document. Worked by the objectui execution seat.
#   domain:skills — the published skills/** (a governed surface). No objectui
#                   row here: this file has never created that object; a row
#                   arrives by PR with the reader that names it.
# ⛔ RETIRED in objectui only, 2026-10-22: domain:spec, domain:devx and
# domain:tooling. This script stops creating the first two (domain:tooling was
# never a row here); their leftover label OBJECTS on objectui are cleaned up by
# the separate, deliberate PM act the header describes — a "retired, use
# domain:ui" description, or deletion. objectstack's own domain:spec and
# domain:devx lanes are untouched: the retirement is per repo. The protocol
# stays objectstack domain:spec's — a cross-layer feature keeps its parent plus
# per-layer children, spec and backend first, and its objectui child is now
# domain:ui. Cards whose landing surface is undetermined stay unstreamed for
# triage first-touch rather than guessed. The row below creates the objectui-
# repo label OBJECT. Since objectui moved into this repository's ui/ tree
# (objectstack#25677), domain:ui is also a main-repo lane, in the loop above
# and SKILL.md's domain table. Named consumer: the objectui execution seat's candidate query
# (.claude/skills/pm-dispatch/references/lanes/ui.md). Re-laning the open
# objectui backlog onto domain:ui was triage's act on the ruling's day, by
# file-path evidence — not this script's.
gh label create domain:ui -R objectstack-ai/objectui -c bfd4f2 -d "objectui ui lane: all objectui code — library, apps, packages/types, .github/, scripts/, docs" 2>/dev/null || true

# The PRODUCT AREA — `area:*`, one per public card, eight values. It is the
# PLANNING axis: an area is chosen by what the user feels is broken, never by
# file or layer, and `domain:*` beside it decides only which seat may edit
# which files. Six values are the standing product areas (ai, build, data,
# workflow, ux, package); two are not product (fleet: the fleet's own tooling;
# cloud: any card related to the cloud repository — it needs to read cloud
# code, or its change serves only the hosted edition — and such a card takes
# area:cloud in place of its product area; a seat with cloud access filters on
# it). What each area covers, its core-feature list and the boundaries
# between areas live in docs/NORTH-STAR.md ("Product areas") and are ⛔ not
# copied here: the -d strings below are a label hover, not the definition.
# Maintainer ruling 2026-11-18, verbatim: 「立一张专题卡，开始执行」, given on
# the plan that named this set; the rollout epic's body quotes the exchange.
#
# ⛔ Two values that deliberately do not exist in THIS repository's set.
# Security: a security problem here is a private advisory and carries no
# `area:*` (cloud is a private repository and its set below does have
# area:security). Performance: slowness goes to the area of what is slow — a
# slow query is data, a slow page load is ux.
#
# A card the fleet files carries it from its filer, together with the card's
# GitHub issue type (Bug / Feature / Task: a native type, not a label, so this
# file creates nothing for it) and its grade, or the filing gate refuses the
# card. On a maintainer's or an outsider's card triage applies both at FIRST
# TOUCH — step one of grading, in the same label write as `domain:*` — and it
# reviews what a fleet filer set. The repository is judged before the area: a
# platform root cause is fixed here, wherever it showed up. A card that fits no
# area is said so on the card and reported to the maintainer — ⛔ never a new
# row here. The existing backlog is backfilled only under an epic the
# maintainer authorised.
#
# Four named consumers (SKILL.md 状态模型, 「一个标签存在当且仅当有具名读者」):
# the maintainer's board view by area; triage grading, which reads that area's
# core-feature list in the North Star to tell a broken core feature from an
# impeded one; the parent-card grouping; and the execution seat's pull order,
# where the area or sub-epic the maintainer named decides what is dispatched
# after p0 and p1 (references/execution-duties.md 取卡全序). The checklist end
# is machine-readable: every docs/qa/platform-checklist/areas/*.json carries a
# top-level `axis` naming the product area most of its items serve.
#
# ⛔ RETIRED 2026-11-18, on the header's terms — row absent, label OBJECT left
# exactly as it is: area:records, area:access, area:reports, area:identity,
# area:api, area:files, area:i18n, area:studio and area:devpath, the
# feature-axis values this set replaces. The objects area:auth, area:automation
# and area:formula never had a row here and are left alone the same way. Open
# cards carry these until the backfill moves each one to its new area; deleting
# the objects afterwards is the maintainer's call, never a side effect of this
# file. area:ai and area:workflow keep their names under new meanings, and
# area:data gains its first row, so on those three `--reconcile` is what
# rewrites the live description (default mode leaves an existing object alone).
#
# TWO repos, each with its OWN set, and not the per-repo loop above: the eight
# rows here and cloud's nine further down. The objectui repository no longer
# exists — its code is this repository's ui/ tree — so the two-repo loop this
# block used to be is gone. objectos is the docs/site repo. hotcrm is a
# product whose rules, areas included, live in its own repository; it has no
# rows here, and a platform gap found there is filed here, where it gets this
# repository's area. Widening this to another repository is a vocabulary
# decision, not a maintenance edit.
#
# ⚠️ Every -d below is ≤100 characters (`check:pm-label-desc-cap`), and each
# names what the CUSTOMER gets rather than the packages that implement it — the
# area is read by the maintainer planning product, not by a seat routing files.
# One shade of its own, `d2dae2`, so an area label is recognisable at a glance
# in a label list that already carries `domain:*` in `bfd4f2`.
gh label create area:ai       -R objectstack-ai/objectstack -c d2dae2 -d "AI: asking for data, writing data, MCP, AI chat, product skills, evals and scenario cards" 2>/dev/null || true
gh label create area:build    -R objectstack-ai/objectstack -c d2dae2 -d "Building apps: starting a project, writing and verifying metadata, Studio, the CLI" 2>/dev/null || true
gh label create area:data     -R objectstack-ai/objectstack -c d2dae2 -d "Data and permissions: records, search, query and report numbers, files, sign-in, orgs, audit" 2>/dev/null || true
gh label create area:workflow -R objectstack-ai/objectstack -c d2dae2 -d "Flows and integration: flows, approvals, notifications, print, schedules, the API, connectors" 2>/dev/null || true
gh label create area:ux       -R objectstack-ai/objectstack -c d2dae2 -d "Experience: looks right, easy to use, gives feedback; i18n, mobile, navigation, page load" 2>/dev/null || true
gh label create area:package  -R objectstack-ai/objectstack -c d2dae2 -d "Packages and install: install, enable, disable, uninstall, seed data, upgrades, release notes" 2>/dev/null || true
gh label create area:fleet    -R objectstack-ai/objectstack -c d2dae2 -d "Not product — the fleet's own tooling: CI, tests, lint, PM tools, internal skills, governance" 2>/dev/null || true
gh label create area:cloud    -R objectstack-ai/objectstack -c d2dae2 -d "Not product — related to the cloud repo: needs to read cloud code, or serves only the hosted edition" 2>/dev/null || true

# The cloud repository's OWN product areas — nine values, one per cloud card.
# ⛔ This file is not their definition: what each area covers, cloud's core
# functions and its grading rules live in the cloud repository
# (docs/strategy/core-functions.md and docs/strategy/triage-rules.md), and the
# pm-dispatch skill only points there. The rows sit here because this script
# is the one place the fleet's label vocabulary is created and reconciled, for
# every repo; the -d strings are the cloud seat's own wording, copied.
#
# All nine label objects already exist on cloud — created by first use, grey
# and with no description — so the default create-only mode changes nothing
# there and `--reconcile` is what gives them this colour and these
# descriptions. Same shade as the eight above: an area is an area in either
# repository's label list.
gh label create area:control     -R objectstack-ai/cloud -c d2dae2 -d "云控制台:注册登录、组织与成员、套餐与计费、平台邮件、开发者版" 2>/dev/null || true
gh label create area:environment -R objectstack-ai/cloud -c d2dae2 -d "云环境:环境运行时、域名路由、租户库、pin 升级、推送" 2>/dev/null || true
gh label create area:marketplace -R objectstack-ai/cloud -c d2dae2 -d "市场与发布:市场装应用、发布者上架与审核、套件、连接的运行时" 2>/dev/null || true
gh label create area:ai          -R objectstack-ai/cloud -c d2dae2 -d "云端 AI:托管的 AI 搭建、问数、写数、MCP 入口" 2>/dev/null || true
gh label create area:enterprise  -R objectstack-ai/cloud -c d2dae2 -d "企业版:安装升级、许可证、登录、已发版企业功能、企业版新功能" 2>/dev/null || true
gh label create area:security    -R objectstack-ai/cloud -c d2dae2 -d "云端安全:鉴权、跨组织、密钥、隐私删除" 2>/dev/null || true
gh label create area:ops         -R objectstack-ai/cloud -c d2dae2 -d "运维与上线:备份、告警、厂商额度、生产密钥与配置、上线验收" 2>/dev/null || true
gh label create area:fleet       -R objectstack-ai/cloud -c d2dae2 -d "车队工具:CI、测试工具、部署流水线、PM 流程(不是产品)" 2>/dev/null || true
gh label create area:ux          -R objectstack-ai/cloud -c d2dae2 -d "体验:控制台和环境里的慢、难用、步骤多、难懂、界面不一致" 2>/dev/null || true

# No `target:<major>` family. A release blocker is `priority:p0` inside the
# release window and nothing else (pm-dispatch references/filing-gate.md
# 定级判据, 「⛔ 不打 `target:`」), and the maintainer's release list reads
# `label:priority:p0 is:open` in each repo (references/seat-post-protocol.md
# 〈发版板运维〉), so no reference reads a `target:` label as a blocker. This file
# therefore seeds none — and `--reconcile` no longer rewrites an existing
# object's description to call it a release blocker. The `target:*` objects
# already in the repos are left exactly as they are, like a retired lane's (see
# the header); deleting them is the maintainer's call, never a side effect of
# this file.

if [ "$RECONCILE" = 1 ]; then
  if [ "$RECONCILE_FAILURES" -gt 0 ]; then
    # Loud and non-zero: a swallowed edit failure leaves the drift in place while
    # printing the success line — the failure shape this mode exists to end.
    echo "❌ ensure-pm-labels: $RECONCILE_FAILURES label(s) failed to reconcile — the drift above is STILL LIVE."
    exit 1
  fi
  echo "✓ ensure-pm-labels: label vocabulary ensured and existing objects reconciled (idempotent)."
else
  echo "✓ ensure-pm-labels: label vocabulary ensured (idempotent, create-only — rerun with --reconcile to align existing objects)."
fi
