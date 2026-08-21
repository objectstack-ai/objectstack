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
# ⛔ The retired lanes (domain:ui; domain:spec-surface and domain:spec-tooling,
# retired 2026-08-16 — maintainer ruling 「A」 merged both into the single
# domain:spec lane, the sub-lane criteria surviving as the spec seat's dispatch
# reference; domain:engine-core / domain:metadata / domain:drivers /
# domain:identity, retired 2026-08-19 — maintainer ruling 「engine-core +
# metadata + drivers -> engine, identity + services → services 怎么样?」 folded
# the engine-side three into domain:engine, which thereby RE-ENTERS circulation
# after its own earlier retirement, and identity into domain:services) are
# deliberately ABSENT — recreating a retired label puts an ownerless lane back
# into GitHub's autocomplete. Their leftover label OBJECTS may still exist in
# the repos; deleting those objects is a separate, deliberate PM action.
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
# execution folds into domain:devx) and OUT of the target:<major> loop (docs/site
# repo, no changeset/release flow, no release board). Those absences are
# deliberate, not oversights. Actually RUNNING this against objectos is a PM
# landing step (needs label-write credentials on that repo).
#
# hotcrm enrolled on the SAME Option B terms when its execution seat was opened
# (maintainer ruling 2026-08-20, verbatim prefix — the full quote lives on the
# lane-registration card: 「新增了 hotcrm 仓库的席位,这个仓库作为 objectstack 的样板工程,
# 使用元数据开发crm应用…」). It is the EXEMPLAR APP repo, so like objectos it sits
# outside the spec dependency chain: it gets the full pm state-machine vocabulary
# below, and stays OUT of the domain-lane loop (lanes are main-repo-only — hotcrm
# is a REPO lane, seated through the repo:hotcrm seam label further down) and OUT
# of the target:<major> loop (no changeset/release flow of its own, so no release
# board unless one is later ruled). Those absences are deliberate, not oversights.
# Actually RUNNING this against hotcrm is a PM landing step, same as objectos
# (needs label-write credentials on that repo).
for R in objectstack-ai/objectstack objectstack-ai/objectui objectstack-ai/cloud objectstack-ai/objectos objectstack-ai/hotcrm; do
  gh label create pm:queue            -R "$R" -c 0e8a16 -d "Ready for the PM dispatch loop" 2>/dev/null || true
  gh label create pm:dispatched       -R "$R" -c 1d76db -d "Dispatched to a dev agent by /pm-dispatch" 2>/dev/null || true
  gh label create needs-user-decision -R "$R" -c d93f0b -d "Blocked on a maintainer decision — do not dispatch" 2>/dev/null || true
  gh label create pm:on-hold          -R "$R" -c e4e669 -d "Decision made, deliberately deferred — no dispatch, no nag; restart condition in the hold comment" 2>/dev/null || true
  gh label create pm:blocked          -R "$R" -c b60205 -d "Blocked by another issue/PR — body carries Blocked-by: #N" 2>/dev/null || true
  # priority:p0 is the QUEUE-JUMP tier of the lane pull order, and ordering
  # only: a p0 card still obeys the same-file serial queue and the claim
  # protocol (SKILL.md state model, 「优先是排序,不是豁免」). Set by the triage
  # seat when it grades a card; removed by triage when the grade changes. Named
  # consumers: the lane pull order below (p0 > pm:blocking > target board > Bug
  # > the rest) and the half-state sweep's H10 (stale unclaimed p0) and H11
  # (important card parked) in scripts/pm/check-half-states.mjs. It is in this
  # five-repo loop because that sweep is repo-parameterized (PM_SWEEP_REPO) and
  # grading is a five-repo triage duty — the same reasoning as pm:retriage
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
  # pm:blocking is a derived CACHE, never hand state (maintainer opinion
  # 2026-08-13, superseding the earlier derived-only-no-stored-label ruling):
  # the triage sweep writes/removes it from the Blocked-by: reverse index, and
  # it comes off when every dependent closes. Named consumers: the lane queue
  # pull order (p0 > blocking > target board > Bug > age; SKILL.md 选择优先级)
  # and list-page scans. A hand-set instance is mislabeling — the sweep
  # corrects it against the index.
  gh label create pm:blocking         -R "$R" -c 8250df -d "Derived cache from the Blocked-by reverse index: open card with open dependents — never hand-set" 2>/dev/null || true
  # pm:retriage COEXISTS with the standing pm:* label and ⛔ never replaces it
  # (maintainer ruling 2026-08-19/20, 「同意 并存」): the objecting seat sets it in
  # the same write as its evidence comment, and the triage Routine is the only
  # remover — hanging and removing belong to two different parties, which is
  # what makes the state safe. Named consumers: the dispatchable-candidate
  # query (a pm:queue card carrying it is skipped — objection undecided, no
  # dispatch) and the triage round's high-priority re-judgement pass. It is in
  # this five-repo loop because the state-model row requires the label to exist
  # in all five; where a first application already auto-created the object,
  # creation here is a no-op and `--reconcile` is what gives it this colour and
  # description (measured 2026-08-20: grey with an empty description in
  # objectstack, and absent entirely from objectui).
  gh label create pm:retriage         -R "$R" -c d4c5f9 -d "Awaiting triage re-judgement — coexists with the standing pm:* label; queued cards skip dispatch" 2>/dev/null || true
  gh label create finding             -R "$R" -c c2e0c6 -d "Recorded observation — held, not dispatchable until the findings triage round grades it" 2>/dev/null || true
  gh label create pm:epic             -R "$R" -c 5319e7 -d "Parent delegated to a dedicated epic PM — other PMs never dispatch into its subtree" 2>/dev/null || true
done

# needs:contract-review — the clause-② enqueue gate's re-review chain (SKILL.md
# 入队与落地): a PR whose ACTUAL diff touches the contract surface — or whose
# card's claim comment declares `Clause-②: yes` (the content limb, judged from
# the card, path-independent) — but was dispatched below the contract-review
# tier waits outside the queue under this label until the review sub-round
# clears it. Named consumers: the enqueue gate and the triage sub-round's label
# query. Main repo only — the contract surface (packages/spec) lives here. The
# label names WHAT is reviewed, never a model; the tier's single source is
# CONTRACT_REVIEW_TIER in scripts/pm/dispatch-gates.mjs. The -d below is kept
# ≤100 chars (the hard cap — see the header). It did NOT match the live label
# object: measured 2026-08-20, that object was grey with an EMPTY description,
# so the claim this comment used to make had never been true — nothing had ever
# checked it. `--reconcile` is what makes it true.
gh label create needs:contract-review -R objectstack-ai/objectstack -c d93f0b -d "Clause-② enqueue gate: dispatched below contract-review tier — blocked until the review clears it" 2>/dev/null || true

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
gh label create repo:cloud    -R objectstack-ai/objectstack -c c5def5 -d "Seam card: cross-repo ordering with cloud is the substance (pure cloud fixes live in cloud)" 2>/dev/null || true
gh label create repo:hotcrm   -R objectstack-ai/objectstack -c fbca04 -d "Seam card: cross-repo ordering with hotcrm is the substance (pure hotcrm fixes live in hotcrm)" 2>/dev/null || true

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
gh label create pm:seat -R objectstack-ai/objectstack -c 1d76db -d "Seat registry post — protocol carrier, not dispatchable work; the label page is the fleet board" 2>/dev/null || true

# Domain lanes — the roster lives in SKILL.md's domain table; keep both in sync
# BY PR whenever a lane is added or retired.
for D in engine services devx spec cli skills; do
  gh label create "domain:$D" -R objectstack-ai/objectstack -c bfd4f2 -d "Domain lane — seat card indexed by label:pm:seat" 2>/dev/null || true
done

# Release board — `target:<major>` marks a release BLOCKER for that major
# (SKILL.md "发版板"). Its consumer is a named query, one per backlog:
# `label:target:<major> is:open`, and all three boards reading empty IS the
# release condition — so the family belongs in all three repos, not just the
# main one.
#
# Seed the CURRENT release window only. A major seeded ahead of its window puts
# an empty board into every autocomplete with no producer behind it — the same
# harm as recreating a retired lane above. At the start of a new window MOVE the
# value here rather than accumulating them; a closed window's label object stays
# in the repos as history and needs no entry.
#
# Creation is create-if-missing, so where these already exist this is a no-op
# and their current colour and description are left exactly as they are;
# `--reconcile` aligns them. Note the window is part of the description, so a
# stale object describes the WRONG major: measured 2026-08-20, objectui's
# target:v17 still carried a 2026-08-04 hand-written description.
for V in v17; do
  for R in objectstack-ai/objectstack objectstack-ai/objectui objectstack-ai/cloud; do
    gh label create "target:$V" -R "$R" -c ededed -d "Release blocker for $V — on the board until fixed, dropped as no longer valid, or accepted for GA" 2>/dev/null || true
  done
done

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
