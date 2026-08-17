#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# ensure-pm-labels.sh — idempotent creation of the pm-dispatch label vocabulary.
# Run once at the start of a first round (safe to rerun any time).
#
#   bash scripts/pm/ensure-pm-labels.sh
#
# The label set IS the PM state machine (.claude/skills/pm-dispatch/SKILL.md,
# "State model"): every label here is consumed by a named query or gate.
# ⛔ The retired lanes (domain:engine, domain:ui; domain:spec-surface and
# domain:spec-tooling, retired 2026-08-16 — maintainer ruling 「A」 merged both
# into the single domain:spec lane; the sub-lane criteria survive as the spec
# seat's internal dispatch reference in SKILL.md) are deliberately ABSENT —
# recreating a retired label puts an ownerless lane back into GitHub's
# autocomplete. Their leftover label OBJECTS may still exist in the repos;
# deleting those objects is a separate, deliberate PM action.
#
# Requires the `gh` CLI. Where only the GitHub MCP tools are available, mirror
# these creations through them — the protocol is identical.

set -uo pipefail

for R in objectstack-ai/objectstack objectstack-ai/objectui objectstack-ai/cloud; do
  gh label create pm:queue            -R "$R" -c 0e8a16 -d "Ready for the PM dispatch loop" 2>/dev/null || true
  gh label create pm:dispatched       -R "$R" -c 1d76db -d "Dispatched to a dev agent by /pm-dispatch" 2>/dev/null || true
  gh label create needs-user-decision -R "$R" -c d93f0b -d "Blocked on a maintainer decision — do not dispatch" 2>/dev/null || true
  gh label create pm:on-hold          -R "$R" -c e4e669 -d "Decision made, deliberately deferred — do not dispatch, do not nag; restart condition in the hold comment" 2>/dev/null || true
  gh label create pm:blocked          -R "$R" -c b60205 -d "Blocked by another issue/PR — body carries Blocked-by: #N" 2>/dev/null || true
  # pm:blocking is a derived CACHE, never hand state (maintainer opinion
  # 2026-08-13, superseding the earlier derived-only-no-stored-label ruling):
  # the triage sweep writes/removes it from the Blocked-by: reverse index, and
  # it comes off when every dependent closes. Named consumers: the lane queue
  # pull order (p0 > blocking > target board > Bug > age; SKILL.md 选择优先级)
  # and list-page scans. A hand-set instance is mislabeling — the sweep
  # corrects it against the index.
  gh label create pm:blocking         -R "$R" -c 8250df -d "Derived cache from the Blocked-by reverse index: open card with open dependents — never hand-set" 2>/dev/null || true
  gh label create finding             -R "$R" -c c2e0c6 -d "Recorded observation — held, not dispatchable until the findings triage round grades it" 2>/dev/null || true
  gh label create pm:epic             -R "$R" -c 5319e7 -d "Parent delegated to a dedicated epic PM (session + territory in the parent's own body) — other PMs never dispatch into its subtree" 2>/dev/null || true
done

# needs:contract-review — the clause-② enqueue gate's re-review chain (SKILL.md
# 入队与落地): a PR whose ACTUAL diff touches the contract surface but was
# dispatched below the contract-review tier waits outside the queue under this
# label until the review sub-round clears it. Named consumers: the enqueue gate
# and the triage sub-round's label query. Main repo only — the contract surface
# (packages/spec) lives here. The label names WHAT is reviewed, never a model;
# the tier's single source is CONTRACT_REVIEW_TIER in scripts/pm/dispatch-gates.mjs.
gh label create needs:contract-review -R objectstack-ai/objectstack -c d93f0b -d "Clause-② enqueue gate: contract-surface diff dispatched below the contract-review tier — blocked from enqueue until the review sub-round clears it" 2>/dev/null || true

# Routing labels exist only on the main backlog repo, and mark SEAM cards only
# (file-at-destination ruling: pure sibling-repo fixes live in the target repo).
gh label create repo:objectui -R objectstack-ai/objectstack -c fbca04 -d "Seam card: cross-repo ordering with objectui is the substance (pure objectui fixes live in objectui)" 2>/dev/null || true
gh label create repo:cloud    -R objectstack-ai/objectstack -c c5def5 -d "Seam card: cross-repo ordering with cloud is the substance (pure cloud fixes live in cloud)" 2>/dev/null || true

# Domain lanes — the roster lives in SKILL.md's domain table; keep both in sync
# BY PR whenever a lane is added or retired.
for D in engine-core metadata drivers services identity devx spec cli skills; do
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
# and their current colour and description are left exactly as they are.
for V in v17; do
  for R in objectstack-ai/objectstack objectstack-ai/objectui objectstack-ai/cloud; do
    gh label create "target:$V" -R "$R" -c ededed -d "Release blocker for $V — stays on the release board until fixed, dropped as no longer valid, or explicitly accepted for GA" 2>/dev/null || true
  done
done

echo "✓ ensure-pm-labels: label vocabulary ensured (idempotent)."
