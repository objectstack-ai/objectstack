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
# ⛔ The retired lanes (domain:engine, domain:ui) are deliberately ABSENT —
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
  gh label create finding             -R "$R" -c c2e0c6 -d "Recorded observation — held, not dispatchable until the findings triage round grades it" 2>/dev/null || true
  gh label create pm:epic             -R "$R" -c 5319e7 -d "Parent delegated to a dedicated epic PM (session + territory in the parent's own body) — other PMs never dispatch into its subtree" 2>/dev/null || true
done

# Routing labels exist only on the main backlog repo, and mark SEAM cards only
# (file-at-destination ruling: pure sibling-repo fixes live in the target repo).
gh label create repo:objectui -R objectstack-ai/objectstack -c fbca04 -d "Seam card: cross-repo ordering with objectui is the substance (pure objectui fixes live in objectui)" 2>/dev/null || true
gh label create repo:cloud    -R objectstack-ai/objectstack -c c5def5 -d "Seam card: cross-repo ordering with cloud is the substance (pure cloud fixes live in cloud)" 2>/dev/null || true

# Domain lanes — the roster lives in SKILL.md's domain table; keep both in sync
# BY PR whenever a lane is added or retired.
for D in engine-core metadata drivers services identity devx spec spec-surface cli spec-tooling skills; do
  gh label create "domain:$D" -R objectstack-ai/objectstack -c bfd4f2 -d "Domain lane — seat card indexed by label:pm:seat" 2>/dev/null || true
done

echo "✓ ensure-pm-labels: label vocabulary ensured (idempotent)."
