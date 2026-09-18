#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# os-regen-merge.sh — the mechanized merge sequence for a branch that touches
# os-regen-driven generated artifacts. Run INSIDE the feature branch's worktree.
#
#   bash scripts/pm/os-regen-merge.sh
#   bash scripts/pm/os-regen-merge.sh --self-test   # verify this script
#
# ## Why a script (and why the ORDER is the whole point)
#
# Paths routed to `merge=os-regen` in .gitattributes merge with exit 0 and zero
# conflict markers while SILENTLY DROPPING one side's changes — only a full
# regeneration exposes the loss. And running `gen:schema` while the tree is
# still in MERGE state silently rolls the authorable-surface anchor back to the
# branch's old fork point; the rolled-back anchor is still *authentic*, so every
# gate passes while a landed advance is quietly undone. Both traps are ordering
# traps, so the fix is a fixed order, executed mechanically:
#
#   1. git merge origin/main               (⛔ never rebase / force-push)
#   2. take main's side of every os-regen path THE BRANCH HAS NOT EDITED
#      since the merge base — worktree only, never the index (both halves of
#      that sentence are load-bearing; see the two sections below)
#   3. COMMIT THE MERGE FIRST, then assert the hand-off tree is committed
#   4. regenerate the whole chain, then run the generated-artifact gates and
#      assert every sibling PR's entries — and the previous PR's IMPLEMENTATION
#      BODY — still exist (quoted-exact-name git grep against origin/main).
#
# This script performs steps 1–3 and prints step 4 (the regen chain varies by
# what the branch touches; running it blind would hide a red).
#
# ## ⛔ The base is `origin/main`, ALWAYS — stacked branches are out of scope
#
# There is no `--base`, and `origin/main` is hardcoded at every step that has a
# side: the fetch, the merge base, step 1's `git merge`, step 2's
# `git restore --source=`, step 3's commit message and step 4's grep target. On a
# branch whose real base is ANOTHER FEATURE BRANCH this does not refuse, because
# `git merge-base HEAD origin/main` still answers — with the TRUNK's fork point. It
# runs, merges `origin/main` instead of the parent branch, and step 2 takes main's
# side of generated artifacts the parent branch owns. A silently wrong answer, not
# an error, in exactly the situation this script exists to make safe.
#
# ⛔ The remedy is NOT a `--base` flag. AGENTS.md Multi-agent discipline §2 rules a
# stacked series out as a supported form outright — "⛔ No gate or merge-policy
# change is made for it" — and prescribes a TRUNK branch for a multi-card change.
# Teaching this helper a second base would be tooling for the form that ruling
# refuses. So: land the trunk onto `main`, and run this script on the trunk.
#
# ## What "SILENTLY" above means, measured — and why no post-merge check sees it
#
# The opening claim is the premise of the whole ordering, so it is a reading, not
# a recollection. Reproduced 2026-09-17 in a scratch repo with this clone's real
# driver registered, on the routed path `packages/spec/spec-changes.json`, both
# sides editing it, plus one ordinary hand-written file edited on the INCOMING
# side as a firing control:
#
#   git merge, driver ON                        exit 0
#   incoming side's token in the merged file    0 occurrences   <- THE LOSS
#   our side's token in the merged file         1
#   control: incoming prose in the plain file   1               <- the merge worked
#
# and then, read against the merge commit it produced:
#
#   git show --stat / git log -1 --stat         names the routed path 0 times
#   git diff / git diff HEAD                    0 lines
#   git status --porcelain                      0 lines
#   control: first-parent diffstat              names the control file 1 time
#   git diff --stat HEAD^2 HEAD                 names the routed path 1 time
#
# The merged result IS our side, so it differs from the first parent in nothing —
# which is why a merge commit's combined diffstat omits it and `git diff` reads
# clean. ⛔ So there is no ordinary post-merge check to catch this, and "the tree
# is clean" is the symptom, not the all-clear. The drop is visible in exactly four
# places, every one of which has to be looked at ON PURPOSE: the driver's own
# record `$GIT_DIR/os-regen-pending`, the `pre-commit` refusal that marker drives,
# the STAGED diff after regenerating (step 4.4), and a diff against the SECOND
# parent — the side that was dropped. That is the whole reason step 2 prints a
# per-path notice and step 4 is not optional.
#
# ## Step 2 chooses a side PER FILE — an unconditional one reverts committed work
#
# Step 2 used to run `git checkout origin/main -- <path>` for every os-regen
# path unconditionally, and that is wrong for any branch whose own change IS a
# hand-edit inside a generated artifact — a retirement branch, above all, whose
# deletions of released baseline lines are the deliverable. Measured twice on
# one retirement branch, on two consecutive sync rounds: a committed
# hand-deletion of a manifest key and of the released authorable-surface /
# authorable-defaults lines came back from main's side, and step 3 then
# COMMITTED the revert. Root cause was established rather than assumed — main
# had changed none of the shards in the merge window (empty per-file diffs), so
# the reintroduction was purely this step. The published-schema and
# authorable-key deletion gates then refused the build ("N previously published
# schema(s) disappeared…"), which is those gates working as hand-deletion
# validators — but it reads as a scary red on the branch that is *supposed* to
# delete them, and it invites exactly the wrong repair: re-adding the keys.
#
# The side is therefore chosen PER FILE, against the merge base captured BEFORE
# the merge, and the two cases are OPPOSITES:
#
#   the branch changed it and MAIN DID NOT — git already resolved that path
#   trivially to the branch's bytes; there was nothing to reconcile, so taking
#   main's side is a pure revert with no merge content behind it. This is the
#   measured incident. ⇒ KEEP the branch's bytes, print a per-path notice.
#
#   BOTH sides changed it — the merge driver ran, exited 0 and silently kept one
#   side. This is the ONLY case where step 2 has any work to do, and doing it is
#   the whole reason the step exists: main's dropped side is restored, and step
#   4's regeneration re-derives the branch's generated content on a known-good
#   base. ⇒ TAKE main's side, and print the loud per-path notice — if the
#   branch's edit here was a HAND edit (a released-baseline deletion no
#   regeneration reproduces), restore those bytes before regenerating.
#
# ⚠️ That split is measured, because the simpler rule — skip EVERY path the
# branch edited — looks right and is not: it makes step 2 INERT. Git invokes a
# merge driver only where both sides changed a path, so every path step 2 can
# act on is by construction a path the branch edited. Skip them all and step 2
# takes nothing, step 3 has nothing to commit, and the driver's silent drop
# rides into the merge commit unrepaired — trading the revert hazard for the
# silent-drop hazard this whole script exists to close. Fixture: one regen path
# edited on both sides with the driver keeping ours, one edited on the branch
# only; the blanket-skip rule leaves the first still dropped.
#
# ⚠️ Per FILE, not per pattern — the hot patterns are directory globs over dozens
# of shards, and a per-pattern decision would let one hand-edited shard govern
# the whole directory.
#
# ⚠️ The base must be read BEFORE step 1. After the merge, HEAD contains
# origin/main, so `git merge-base HEAD origin/main` is origin/main's own tip and
# every file reads as "the branch edited it".
#
# ## Step 2 writes the WORKTREE, never the INDEX — and step 4 reads the index
#
# `git checkout <ref> -- <path>` writes the index as well as the tree. That is
# the second measured hazard: with main's side STAGED by step 2 and the
# regeneration landing in the working tree only, the path sits in `MM`, and a
# bare `git commit` builds from the INDEX — it lands main's side, silently
# reverting the branch in a commit whose message claims the opposite. Two sync
# rounds caught it only by staging the regenerated files explicitly and reading
# the staged diff. `git restore --source=<ref> -- <path>` writes the tree only,
# leaving a lone unstaged `M`, where a bare `git commit` lands NOTHING instead
# of the wrong side — a loud no-op beats a quiet revert.
#
# ⛔ THE RUNBOOK SENTENCE, for step 4 and for anyone doing this by hand:
# **inspect the STAGED diff, not the working-tree diff, before committing**
# (`git add <paths>` then `git diff --cached`). `git diff` and `git diff HEAD`
# never consult the index, so both read clean over exactly this trap.
#
# Step 3 closes the sequence with a hand-off assertion: every os-regen path must
# be COMMITTED before step 4 begins. `MM` is the state the card names, and it is
# the superset — any uncommitted regen path at hand-off means step 4's "commit
# the regeneration as its own commit" would absorb something nobody read.
#
# ## Step 3 and the pre-commit hook agree (#8047)
#
# They used to contradict each other: this script deliberately produces the
# commit the `os-regen` pre-commit hook refused, so following the procedure
# meant skipping the hook — and `--no-verify` skips EVERY pre-commit check, not
# just this one. Ruled 2026-08-12 (#8047): the hook gained a DEFERRAL mode —
# but it applies only to a merge commit finished BY HAND, `MERGE_HEAD` present
# at commit time. Step 1 here is `git merge --no-edit`, which auto-commits with
# NO hook run at all (git skips pre-commit for a merge it completes itself), so
# the marker is untouched going into step 3. Step 3's commit is therefore an
# ORDINARY commit — the hook's `refuse-stale` path, not its deferral path, and
# it DOES refuse. Measured (2026-09-01):
#   content/docs/permissions/system-context.mdx - stale
#   Regenerate the 1 stale artifact(s) above
# That is the DESIGNED outcome, not a dropped side — step 1's merge already
# landed. The fallback above clears it; the repair commit then prints
#   content/docs/permissions/system-context.mdx - current
#   os-regen: all deferred artifacts are current - marker cleared
# So step 3 needs no bypass, and step 4 is what clears the marker.
#
# ## ⛔ A local `merge-tree` says NOTHING about GitHub's mergeability (#15815)
#
# The corollary AGENTS.md §11 leaves unstated, and it costs a round trip:
# **a local `merge-tree` of any `merge=os-regen` path, in a clone where the driver
# is registered, is not evidence about whether GitHub can merge the PR.**
# `git merge-tree --write-tree` runs the same merge-ort machinery as `git merge`,
# so it HONOURS the driver — and GitHub runs no custom merge driver at all. The two
# are answering different questions. Already paid for once: a probe read MERGES
# CLEAN where the PR page read `dirty`, and a merge-conflict card was dispatched
# for a contradiction that was really an instrument mismatch.
#
# The sound probe is one where the driver is genuinely ABSENT — a throwaway bare
# clone sharing the object store, which is GitHub's actual condition:
#
#   git clone --bare --shared . PROBE.git
#   git --git-dir=PROBE.git merge-tree --write-tree --name-only <base> <head>
#   rm -rf PROBE.git                       # exit 1 + the paths = really conflicted
#
# ⛔ NOT `git -c merge.os-regen.driver= merge-tree --write-tree <base> <head>`, and
# ⛔ NOT `git -c merge.os-regen.driver=false merge-tree …` either. NEITHER spelling
# DISABLES the driver — git still tries to RUN the configured program (nothing, or
# `false`), it fails, and the path is marked conflicted, so BOTH report a conflict
# for EVERY routed path including ones whose text merges perfectly. Both are spelled
# out here because readers grep the LITERAL: `=false` is the spelling actually in
# circulation, and "same family as the empty string" is a thing no grep finds.
# MEASURED (git 2.43.0, two pairs
# over packages/spec/spec-changes.json, ground truth = `git merge-file` on the
# three blobs, which is what a driver-less server-side merge runs):
#
#   pair                     truth   driver ON   `=` and `=false`   bare shared clone
#   same line, both sides    exit 1  exit 0 ✗    exit 1 ✓           exit 1 ✓
#   1996 lines apart         exit 0  exit 0 ✓    exit 1 ✗           exit 0 ✓
#
# The middle column is the trap this section is about; the third is a false
# POSITIVE instrument that agrees with the truth only by coincidence, printing
# `error: cannot run : No such file or directory` while it does (the `=false` half
# prints nothing at all, which is worse). Only the last column tracks the truth in
# both rows. The `=false` half of column three is its own reading, taken 2026-09-17
# on the same instrument over two pairs of its own — a 200-line routed blob, one
# pair editing the SAME line and one editing ~190 lines apart — and it answered
# exit 1 / exit 1, cell for cell what the empty string answers, false POSITIVE and
# all, while the bare shared clone answered exit 1 / exit 0.
#
# ⚠️ Which way the driver errs is input-dependent, so the trap is intermittent: on
# a MIXED row it defers (exit 0) only when the incoming side carries nothing but
# the generated half, and text-merges deliberately when it carries prose. "Is
# `merge-tree` lying here" therefore has no fixed answer, and a probe that agreed
# with GitHub once proves nothing about the next one. Use the driver-free
# instrument always rather than reasoning about when the driver is trustworthy.
#
# A probe with the driver ON also used to leave `$GIT_DIR/os-regen-pending`
# behind, and the next ORDINARY commit in that checkout was refused by
# `pre-commit` for a merge that never happened. `git-merge-regen.mjs` now declines
# to record a marker when no index lock is held (i.e. under `merge-tree`); the
# measurement, and why the two obvious env-var signals are wrong, are in that
# file's `isProbeInvocation()`. The driver-free probe above never had the problem.
#
# The os-regen path list is read from .gitattributes AT RUN TIME — the one copy
# that cannot rot is the one that does not exist.
#
# ## Step 1's conflict report partitions by GENERATEDNESS, not by routing (#18047)
#
# The partition used to be a set difference against the `merge=os-regen` list:
# conflicted MINUS routed was labelled "NON-generated". That names the complement
# of a ROUTING decision after a property of the FILE, and the two are not the
# same set — `scripts/regen-artifacts.mjs`'s `NOT_DRIVER_MANAGED` exists exactly
# to hold the paths a generator touches that are deliberately NOT routed.
# Measured on origin/main: `git check-attr merge` answers `unspecified` for
# `packages/spec/src/migrations/registry.ts` (the lit control, an
# authorable-surface shard, answers `os-regen`), so a conflict there drew the
# "NON-generated files — resolve those by hand" message WITH its "do not resolve
# generated files textually" line three lines below it. Two sentences about one
# file, and nothing saying which governs. `.gitattributes` calls that same file
# "generated, committed, unsharded, NOT_DRIVER_MANAGED" and says every
# registration touches it by construction, so this is not an exotic path.
#
# The conflicted set is therefore partitioned into THREE classes, generatedness
# first and routing second:
#
#   1. neither routed nor declared — an ordinary hand-written file. Today's
#      message, unchanged, and now the only one carrying the blanket "do not
#      resolve generated files textually" line, which is true of a set that by
#      construction holds no generated file.
#   2. ROUTED and conflicted — necessarily a MIXED row the driver declined to
#      defer. Today's message, unchanged: that is #14733's fix and it is right.
#   3. declared in `NOT_DRIVER_MANAGED` — generator-touched, deliberately
#      unrouted. A new message, because neither of the other two is true of it.
#
# ## Class 3 is not ONE instruction, and the ledger is what shows it
#
# "Resolve by regeneration" is correct for three of the ledger's thirty tracked
# entries and WRONG for the rest, so membership alone cannot carry the message:
#
#   `packages/spec/src/migrations/registry.ts`, `skills/README.md` and
#   `content/docs/ai/skills-reference.mdx` are MIXED — a generator owns the text
#   between a marker pair, a human owns everything outside it. A conflict INSIDE
#   a region is resolved by rerunning that generator and by nothing else; the
#   prose outside it is a hand merge. The module's own header names these three
#   as the files `NOT_DRIVER_MANAGED` "turns away", and one more of that shape
#   (`content/docs/permissions/tenant-audit-census.mdx`) is reached through a
#   directory entry rather than named outright.
#
#   the fifteen `test-typecheck-debt.json` ledgers, `docs-import-surface.
#   baseline.json` and their neighbours are SHRINK-ONLY RATCHETS whose own
#   entries say a merge must NEVER recompute them: a mid-merge regeneration
#   records whatever the half-merged tree happens to compile to and enters it as
#   merge noise instead of as red. `objectui-lockstep.json` cannot be
#   regenerated here at all (it needs a sibling checkout), and the scaffold
#   templates' generator refuses a file it did not already stamp. Every one of
#   these is resolved BY HAND and regenerated later, or not at all.
#
# So class 3 prints one of two per-path readings, and the discriminator is ⛔ NOT
# the entry's `gen` field. `gen` is an ACCOUNTING field (#13731) — recorded where
# the generator appears in no `REGEN_ARTIFACTS` row — so every ratchet above
# carries one, while `docs-import-surface.baseline.json`, which `gen:docs` really
# does write, carries none. Keying the message on it would send seventeen paths
# to a regeneration their own ledger entry forbids: this card's defect again, one
# class over.
#
# The discriminator is the MARKER PAIR IN THE CONFLICTED FILE, which is the
# property the message actually depends on — a file with generated regions has a
# part a regeneration restores and a part it cannot. Both vocabularies the tree
# writes are recognised, and both are spelled here as a CONSUMER of a convention
# the generators own; `check-role-word.mjs` spells the second one once for the
# same reason and states the rule: a rename happens at the generators and
# arrives here, never the other way round.
#
# ## The caveat the remedy itself needs — the discarded side's prose
#
# "Take either side, commit the merge, then regenerate" is sound only while the
# discarded side changed nothing OUTSIDE the generated regions. Measured on
# PR #17835: `registry.ts` was resolved that way and two hand-authored append
# regions outside the markers — a step's `conversionIds` and its `rationale` —
# were dropped silently, so a 17-to-18 conversion stopped applying while a
# 115-family gate sweep stayed GREEN. `check:migration-registry` exit 0 proves
# the file equals its generated sources and nothing more; it is not a witness
# for the prose, and the one thing that caught the loss was a fixture that
# happened to exercise the dropped id.
#
# So the script does not merely repeat "check the discarded side": it reads both
# sides out of the index it already holds (`:2:` ours, `:3:` theirs), strips the
# generated regions from each, and REPORTS whether the remainders differ. The
# question is answered where it is asked, rather than delegated to an operator
# who has just been told the file is safe to take a side of.

set -euo pipefail

# Absolute, because `--self-test` runs this script from inside fixture repos it
# `cd`s into — a relative `$0` resolves to nothing there.
SELF="${BASH_SOURCE[0]}"
case "$SELF" in
  /*) ;;
  *) SELF="$(pwd)/$SELF" ;;
esac

usage() {
  cat <<'EOF'
usage:
  os-regen-merge.sh              run the merge sequence (steps 1–3, print step 4)
  os-regen-merge.sh --self-test  verify this script against synthetic fixtures
  os-regen-merge.sh --help       this text

Run INSIDE the feature branch's worktree, on a clean tree.

⛔ The base is ALWAYS `origin/main`; there is no `--base` and none is planned. A
branch stacked on another feature branch is OUT OF SCOPE: this script would merge
`origin/main` into it and take main's side of the parent branch's generated
artifacts. AGENTS.md Multi-agent discipline §2 rules that form out and prescribes a
TRUNK branch instead — land the trunk onto `main` and run this script there.
EOF
}

# --- the generated-but-deliberately-unrouted ledger ---------------------------

# `NOT_DRIVER_MANAGED` from scripts/regen-artifacts.mjs, read AT RUN TIME for the
# same reason .gitattributes is read at run time: the one copy that cannot rot is
# the one that does not exist. One line per TRACKED entry,
# `<path or pattern><TAB><regeneration command>`.
#
# `untracked: true` rows are skipped — they are gitignored build output git never
# merges, so they cannot appear in a conflict set and a pathspec naming them
# could only mislabel a neighbour.
#
# The command is built by the module's own `ownerRunCommand`, never assembled
# here: #13585 is what a second assembler costs, and the string this script
# PRINTS has to be the command the `pre-commit` gate SPAWNS.
#
# Failure is the caller's to report, loudly — a silent empty list would put every
# conflicted generated path back in the non-generated class, which is this
# card's own defect with the evidence removed.
read_not_driver_managed() {
  node --input-type=module -e '
const { pathToFileURL } = await import("node:url");
const mod = await import(pathToFileURL(process.argv[1]).href);
if (!Array.isArray(mod.NOT_DRIVER_MANAGED)) throw new Error("NOT_DRIVER_MANAGED is not an array");
if (typeof mod.ownerRunCommand !== "function" || typeof mod.ownerOf !== "function") {
  throw new Error("ownerRunCommand/ownerOf are not both exported");
}
for (const e of mod.NOT_DRIVER_MANAGED) {
  if (e.untracked) continue;
  process.stdout.write(e.path + "\t" + (e.gen ? mod.ownerRunCommand(mod.ownerOf(e), e.gen) : "") + "\n");
}
' "$1" 2>/dev/null
}

# The regeneration command recorded for a ledger row, or the empty string.
# $1 = path or pattern, $2 = the rows.
ndm_command_for() {
  printf '%s\n' "$2" | awk -F'\t' -v want="$1" '$1 == want { print $2; exit }'
}

# Both generated-region marker vocabularies the tree writes, as awk `index()`
# probes rather than a regex, so no spelling here needs escaping twice.
#
# ⛔ Neither token is this script's to rename: they belong to the generators that
# emit them (`build-migration-registry.ts` writes the first, `build-skill-docs.ts`
# the second), and `check-role-word.mjs` states the rule for a consumer that has
# to spell one — the rename happens at the generator and arrives here.
GENERATED_REGION_PROBE='
  index($0, "</os-generated ") || index($0, "END GENERATED:") { hit = 1 }
  index($0, "<os-generated ")  || index($0, "BEGIN GENERATED:") { hit = 1 }
  END { exit hit ? 0 : 1 }
'

# Drop every generated REGION from stdin, keeping the marker lines themselves so
# a moved or deleted marker still reads as a difference. What survives is the
# hand-written remainder — the half no regeneration can restore.
GENERATED_REGION_STRIP='
  index($0, "</os-generated ") || index($0, "END GENERATED:") { inside = 0; print; next }
  index($0, "<os-generated ")  || index($0, "BEGIN GENERATED:") { print; inside = 1; next }
  inside != 1 { print }
'

# Report ONE class-3 conflict: which sub-shape it takes, the command that
# resolves it when there is one, and — for the marked shape — whether taking a
# side would silently drop the other side's hand-written text.
# $1 = path, $2 = its recorded regeneration command (may be empty).
report_ndm_conflict() {
  rn_path="$1"
  rn_cmd="$2"
  rn_ours="$(mktemp "${TMPDIR:-/tmp}/os-regen-merge-ours.XXXXXX")"
  rn_theirs="$(mktemp "${TMPDIR:-/tmp}/os-regen-merge-theirs.XXXXXX")"
  rn_sides=both
  git show ":2:$rn_path" >"$rn_ours" 2>/dev/null || rn_sides=partial
  git show ":3:$rn_path" >"$rn_theirs" 2>/dev/null || rn_sides=partial

  if cat "$rn_ours" "$rn_theirs" | awk "$GENERATED_REGION_PROBE"; then
    echo "    ⚠ $rn_path — GENERATED IN MARKED REGIONS, deliberately NOT driver-managed." >&2
    echo "      ⛔ Do NOT hand-merge the generated regions — resolve them by REGENERATION:" >&2
    echo "      take either side to reach a committable state, commit the merge (step 3)," >&2
    if [ -n "$rn_cmd" ]; then
      echo "      then run its generator and commit that as its own commit:" >&2
      echo "        $rn_cmd" >&2
    else
      echo "      then run its generator and commit that as its own commit (this entry" >&2
      echo "      records no generator — read its \`why\` in scripts/regen-artifacts.mjs)." >&2
    fi
    if [ "$rn_sides" = both ]; then
      rn_diff="$(diff <(awk "$GENERATED_REGION_STRIP" "$rn_ours") \
                      <(awk "$GENERATED_REGION_STRIP" "$rn_theirs") | grep -c '^[<>]' || true)"
      if [ "$rn_diff" -gt 0 ]; then
        echo "      ⚠ THE TWO SIDES DIFFER OUTSIDE THE GENERATED REGIONS ($rn_diff line(s))." >&2
        echo "        Taking a side DROPS the other side's hand-written text there —" >&2
        echo "        silently, and with every gate green: a \`check:\` on this file proves" >&2
        echo "        it equals its generated sources and is no witness for the prose." >&2
        echo "        ⛔ Carry those lines over BEFORE you regenerate." >&2
      else
        echo "      ✓ the two sides are identical outside the generated regions, so taking" >&2
        echo "        either side drops no hand-written text." >&2
      fi
    else
      echo "      ⚠ only one side of this path is in the index, so the outside-the-regions" >&2
      echo "        check was NOT made — ⛔ make it by hand before taking a side." >&2
    fi
  else
    echo "    ⚠ $rn_path — generator-touched and deliberately NOT driver-managed." >&2
    echo "      It carries no generated-region markers, so there is no half a" >&2
    echo "      regeneration would restore: resolve it BY HAND (semantic merge, both" >&2
    echo "      intents stack). ⛔ Do NOT regenerate it as part of this merge — the" >&2
    echo "      ledger keeps the driver off it because a mid-merge recompute describes" >&2
    echo "      the half-merged tree; its \`why\` in scripts/regen-artifacts.mjs is the" >&2
    echo "      authority on what it may be regenerated from, and when." >&2
  fi
  rm -f "$rn_ours" "$rn_theirs"
}

# --- the sequence ------------------------------------------------------------

mode_run() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "✗ not inside a git worktree" >&2
    exit 1
  fi

  branch="$(git rev-parse --abbrev-ref HEAD)"
  case "$branch" in
    main | HEAD)
      echo "✗ refusing to run on '$branch' — run inside the feature branch's worktree" >&2
      exit 1
      ;;
  esac

  if [ -n "$(git status --porcelain)" ]; then
    echo "✗ working tree not clean — commit or drop local changes first (⛔ never git stash)" >&2
    exit 1
  fi

  echo "→ base: origin/main — always; there is no --base (see --help). A branch stacked"
  echo "        on another feature branch is OUT OF SCOPE here: this would merge origin/main"
  echo "        into it and take main's side of the parent branch's generated artifacts."
  echo "→ fetching origin/main"
  git fetch origin main

  # Captured BEFORE step 1, on purpose — see the header. After the merge both
  # readings answer a different question, and both answer it plausibly.
  branch_tip="$(git rev-parse HEAD)"
  if ! merge_base="$(git merge-base HEAD origin/main)"; then
    echo "✗ no merge base with origin/main — refusing to guess which side is yours" >&2
    exit 1
  fi
  echo "→ branch tip $(git rev-parse --short "$branch_tip") · merge base $(git rev-parse --short "$merge_base")"

  # The single authoritative list, read at run time.
  #
  # READ LOOP, NOT `mapfile` — THE BASH 3.2 FLOOR. `mapfile`/`readarray` are bash
  # 4 builtins and `/usr/bin/env bash` is bash 3.2.57 on macOS (Apple ships no
  # bash 4+, for licensing reasons). This script is run BY HAND, in an agent's or
  # a maintainer's worktree, and it has no CI path at all — nothing in
  # `.github/workflows/` invokes it — so a bash-4 builtin here does not fail on a
  # fringe host, it fails on the ordinary one, and no CI run can ever say so.
  # Measured with the builtin disabled (`enable -n mapfile readarray` via
  # `BASH_ENV`, which reproduces the macOS symptom byte for byte):
  # `mapfile: command not found`, then `set -e` kills the run at status 127 —
  # AFTER `git fetch origin main` and BEFORE step 1, i.e. with the merge sequence
  # whose ORDER is this script's entire reason for existing not begun. The
  # operator is left to perform steps 1–3 by hand, which is the trap the script
  # was written to remove.
  #
  # Keep this loop bash-3.2-clean: no `mapfile`, no `readarray`, no `declare -A`,
  # no `${x^^}`/`${x,,}`. Two details are load-bearing and neither is obvious:
  #
  #   `regen_paths=()` BEFORE the loop. Under `set -u` a loop that appends
  #   nothing never creates the array at all, so `${#regen_paths[@]}` below
  #   aborts with `unbound variable` — and "grep matched nothing" is precisely
  #   the case the refusal below exists to REPORT. Measured: without the
  #   declaration the empty input dies at `regen_paths: unbound variable`; with
  #   it, `count=0` and the refusal prints.
  #
  #   `if [[ -n … ]]; then …; fi`, not a trailing `[[ -n … ]] && …`. Measured:
  #   with the `&&` form the `while` takes status 1 whenever the LAST line read
  #   fails the test, and under `set -e` that kills the caller the moment such a
  #   loop is the last command of a function — silently correct today, a landmine
  #   for the next refactor. The `if` form returns 0 on the same input. (This is
  #   the form #12142 standardised; its own note attributes the trap to the empty
  #   list, which measures clean — an all-empty read leaves the body unexecuted
  #   and the `while` at status 0.)
  #
  # The READER admits only what git itself routes, and .gitattributes' grammar
  # was MEASURED for this rather than assumed (git 2.43.0, scratch repos):
  #
  #   a leading-`#` line is a COMMENT, and leading whitespace does not undo
  #   that — `  # foo bar` assigns nothing to a file named `#`, while the
  #   escaped-pattern control `\# foo bar` on that same file assigns `foo` and
  #   `bar`. So comment lines must be dropped BEFORE the field split.
  #
  #   there is NO inline trailing comment. `x merge=os-regen # note` does not
  #   route x with a note on the end; git rejects the LINE — `# is not a valid
  #   attribute name: .gitattributes:1` on stderr, and `git check-attr merge --
  #   x` then answers `unspecified`. Nothing to strip, because no such row can
  #   ever be live. Pinned in the self-test against real git, so the day git
  #   grows one this decision reddens instead of rotting.
  #
  #   attributes are WHITESPACE-delimited tokens, so `merge=os-regenX` is a
  #   different driver and not this one — hence the token anchor below rather
  #   than a bare substring.
  #
  # The spelling this replaced was `grep 'merge=os-regen' .gitattributes | awk
  # '{print $1}'`, which also matched the header comment that quotes the
  # literal in prose and took ITS first field, so the list carried a pathspec
  # that was literally `#`. Harmless by luck — `#` matches no tracked path, so
  # both `git diff`s below ignored it — but the COUNT printed just below is the
  # operator's only check that this script is looking at the right surface, and
  # it was off by one in the one place the design deliberately keeps no second
  # copy to compare against. Measured at the repair on origin/main: 19 entries
  # produced, 1 of them literally `#`, 18 real patterns. It had already been
  # wrong at two different values (18 then 19) across an intervening edit, so
  # the impurity is in the construction, not in one snapshot of the file.
  #
  # `scripts/git-merge-regen.mjs`'s own reader (`reconcileAttributes`) already
  # skipped comment lines; this is that same rule, in awk.
  #
  # `[ \t]` rather than `[[:space:]]`: the bash 3.2 floor above is a macOS
  # floor, and that host's awk is not gawk.
  regen_paths=()
  regen_line=''
  while IFS= read -r regen_line; do
    if [[ -n "$regen_line" ]]; then regen_paths+=("$regen_line"); fi
  done < <(awk '
    /^[ \t]*#/ { next }
    /(^|[ \t])merge=os-regen([ \t]|$)/ { print $1 }
  ' .gitattributes)
  if [ "${#regen_paths[@]}" -eq 0 ]; then
    echo "✗ no merge=os-regen entries found in .gitattributes — refusing to guess" >&2
    exit 1
  fi
  echo "→ os-regen paths (from .gitattributes, ${#regen_paths[@]} patterns):"
  printf '    %s\n' "${regen_paths[@]}"

  # Which side moved which generated file, read against the pre-merge tip. Two
  # `git diff`s for the whole set — a per-file loop over the hot directory globs
  # would spawn a process per shard. Kept as newline-delimited STRINGS with a
  # leading and trailing newline, so membership is a `case` glob and costs no
  # process at all; a path can never contain a newline (git quotes those).
  NL='
'
  branch_edited=()
  edited_line=''
  while IFS= read -r edited_line; do
    if [[ -n "$edited_line" ]]; then branch_edited+=("$edited_line"); fi
  done < <(git diff --name-only "$merge_base" "$branch_tip" -- "${regen_paths[@]}")
  main_edited="$NL$(git diff --name-only "$merge_base" origin/main -- "${regen_paths[@]}")$NL"

  echo "→ step 1: git merge origin/main"
  # Captured rather than left to inherit the terminal, so a conflict can be
  # classified below AND the driver's own notice (printed on stderr, for any
  # os-regen path it declined to defer) is still shown to the operator instead
  # of scrolling past unread.
  merge_log="$(mktemp "${TMPDIR:-/tmp}/os-regen-merge-log.XXXXXX")"
  if ! git merge --no-edit origin/main >"$merge_log" 2>&1; then
    cat "$merge_log" >&2
    rm -f "$merge_log"

    # Partition the conflicted set against the os-regen path list already read
    # above (:216-226) — reusing it as a `git diff` pathspec is the same trick
    # step 2 already relies on for `branch_edited`/`main_edited` (:239-240), so
    # this needs no glob-matching code of its own and no new inputs.
    #
    # Any conflict on a regen path is necessarily one the merge driver declined
    # to defer (see git-merge-regen.mjs: a non-`mixed` row always resolves with
    # exit 0, no markers — only a MIXED row whose deferral would be unsafe falls
    # through to a real text merge, which is what can conflict here). So a
    # regen-path conflict always means: hand-resolve the prose, never "take one
    # side" — the opposite of what a wholly-generated path would call for, and
    # the reason the blanket "do not resolve generated files textually" line
    # below is wrong, and suppressed, whenever a regen path shows up here.
    all_conflicts=()
    conflict_line=''
    while IFS= read -r conflict_line; do
      if [[ -n "$conflict_line" ]]; then all_conflicts+=("$conflict_line"); fi
    done < <(git diff --name-only --diff-filter=U)
    regen_conflicts=()
    regen_conflict_line=''
    while IFS= read -r regen_conflict_line; do
      if [[ -n "$regen_conflict_line" ]]; then regen_conflicts+=("$regen_conflict_line"); fi
    done < <(git diff --name-only --diff-filter=U -- "${regen_paths[@]}")

    NL='
'
    TAB="$(printf '\t')"
    regen_set="$NL"
    for c in "${regen_conflicts[@]+"${regen_conflicts[@]}"}"; do regen_set="$regen_set$c$NL"; done

    # Class 3: conflicted paths DECLARED in `NOT_DRIVER_MANAGED` — generated and
    # deliberately unrouted (see the header). Read here rather than beside the
    # .gitattributes list on purpose: the ledger is only ever a question about a
    # conflict, so a clean run pays nothing for it and prints nothing new.
    ndm_rows=''
    ndm_read_ok=yes
    if ! ndm_rows="$(read_not_driver_managed "$(git rev-parse --show-toplevel)/scripts/regen-artifacts.mjs")"; then
      ndm_read_ok=no
      ndm_rows=''
    fi

    # One `git diff` per ledger ROW rather than one over all of them: the row
    # that matched is what carries the regeneration command, and a single
    # all-patterns call cannot say which one did. Bounded by the ledger (tens of
    # rows), on a path that is already printing a failure report — and ⛔ never
    # with an empty pathspec, which `git diff --diff-filter=U --` reads as
    # EVERYTHING, promoting every conflict into class 3. An empty ledger here
    # runs no `git diff` at all.
    ndm_conflicts=()
    ndm_set="$NL"
    ndm_cmd_rows="$NL"
    ndm_row=''
    while IFS= read -r ndm_row; do
      if [[ -z "$ndm_row" ]]; then continue; fi
      ndm_pattern="$(printf '%s' "$ndm_row" | cut -f1)"
      ndm_cmd="$(printf '%s' "$ndm_row" | cut -f2)"
      ndm_hit=''
      while IFS= read -r ndm_hit; do
        if [[ -z "$ndm_hit" ]]; then continue; fi
        # Routed wins: a path in both lists is class 2, and `git-merge-regen.mjs`
        # refuses that overlap in its own reconciliation anyway.
        case "$regen_set" in
          *"$NL$ndm_hit$NL"*) continue ;;
        esac
        case "$ndm_set" in
          *"$NL$ndm_hit$NL"*) continue ;;
        esac
        ndm_conflicts+=("$ndm_hit")
        ndm_set="$ndm_set$ndm_hit$NL"
        ndm_cmd_rows="$ndm_cmd_rows$ndm_hit$TAB$ndm_cmd$NL"
      done < <(git diff --name-only --diff-filter=U -- "$ndm_pattern")
    done < <(printf '%s\n' "$ndm_rows")

    non_regen_conflicts=()
    for c in "${all_conflicts[@]+"${all_conflicts[@]}"}"; do
      case "$regen_set" in
        *"$NL$c$NL"*) continue ;;
      esac
      case "$ndm_set" in
        *"$NL$c$NL"*) continue ;;
      esac
      non_regen_conflicts+=("$c")
    done

    if [ "$ndm_read_ok" = no ]; then
      echo "⚠ could NOT read NOT_DRIVER_MANAGED from scripts/regen-artifacts.mjs, so" >&2
      echo "  generatedness was not consulted for this report: a generated file that is" >&2
      echo "  deliberately unrouted is named below as though it were hand-written." >&2
      echo "  ⛔ Check every path named here against that ledger before resolving it." >&2
    fi

    if [ "${#ndm_conflicts[@]}" -eq 0 ]; then
      if [ "${#regen_conflicts[@]}" -eq 0 ]; then
        echo "✗ merge stopped on conflicts in NON-generated files — resolve those by hand" >&2
        echo "  (semantic merge, both intents stack), then rerun this script to redo the" >&2
        echo "  generated-artifact half. ⛔ Do not resolve generated files textually." >&2
      elif [ "${#non_regen_conflicts[@]}" -eq 0 ]; then
        echo "✗ merge stopped on conflicts in GENERATED files the driver declined to defer" >&2
        echo "  (MIXED — a generated half plus hand-written prose; see its notice above)." >&2
        echo "  Hand-resolve the prose; the anchor numbers do not matter here — take" >&2
        echo "  either side of them, then run the regeneration command the driver printed" >&2
        echo "  above, then continue with step 4:" >&2
        printf '    %s\n' "${regen_conflicts[@]}" >&2
      else
        echo "✗ merge stopped on conflicts in BOTH non-generated and generated files:" >&2
        echo "  non-generated (resolve by hand — semantic merge, both intents stack):" >&2
        printf '    %s\n' "${non_regen_conflicts[@]}" >&2
        echo "  generated, MIXED — the driver declined to defer these (see its notice" >&2
        echo "  above). Hand-resolve the prose; the anchor numbers do not matter here —" >&2
        echo "  take either side of them, then run the regeneration command the driver" >&2
        echo "  printed above:" >&2
        printf '    %s\n' "${regen_conflicts[@]}" >&2
        echo "  Resolve both, then rerun this script to redo the generated-artifact half." >&2
      fi
    else
      echo "✗ merge stopped on conflicts, and some are in files a generator writes which" >&2
      echo "  are deliberately NOT driver-managed — ⛔ neither the non-generated rule nor" >&2
      echo "  the MIXED one governs those, so each is named below with its own:" >&2
      for c in "${ndm_conflicts[@]}"; do
        report_ndm_conflict "$c" "$(ndm_command_for "$c" "$ndm_cmd_rows")"
      done
      if [ "${#non_regen_conflicts[@]}" -gt 0 ]; then
        echo "  non-generated (resolve by hand — semantic merge, both intents stack):" >&2
        printf '    %s\n' "${non_regen_conflicts[@]}" >&2
      fi
      if [ "${#regen_conflicts[@]}" -gt 0 ]; then
        echo "  generated, MIXED — the driver declined to defer these (see its notice" >&2
        echo "  above). Hand-resolve the prose; the anchor numbers do not matter here —" >&2
        echo "  take either side of them, then run the regeneration command the driver" >&2
        echo "  printed above:" >&2
        printf '    %s\n' "${regen_conflicts[@]}" >&2
      fi
      echo "  Resolve every class above by ITS OWN rule, then rerun this script to redo" >&2
      echo "  the generated-artifact half." >&2
    fi
    exit 1
  fi
  cat "$merge_log"
  rm -f "$merge_log"

  echo "→ step 2: taking origin/main's side of the generated artifacts main moved"
  # ⚠️ bash 3.2 expands `"${arr[@]}"` of an EMPTY array as an unbound variable
  # under `set -u` (fixed only in 4.4), and "the branch edited no generated
  # artifact" is the ordinary case. `${arr[@]+"${arr[@]}"}` is the 3.2-safe
  # spelling: it expands to nothing at all when the array is empty.
  excludes=()
  if [ "${#branch_edited[@]}" -gt 0 ]; then
    for edited in "${branch_edited[@]}"; do
      case "$main_edited" in
        *"$NL$edited$NL"*)
          # Both sides moved it: the driver ran and dropped one side. Taking
          # main's side is the point of this step — but say so per path, loudly.
          echo "   ⚠ TAKING main's side of $edited (both sides changed it)"
          echo "     — the os-regen driver merged it with exit 0 and silently kept one side."
          echo "       MEASURED: nothing downstream reports that drop — it is absent from the"
          echo "       merge commit's diffstat and \`git diff\`/\`git status\` read clean over it."
          echo "       Step 4's regeneration re-derives the generated content on top. If this"
          echo "       branch HAND-edited this file (a released-baseline deletion no generator"
          echo "       reproduces), restore the branch bytes before regenerating."
          ;;
        *)
          excludes+=(":(exclude)$edited")
          echo "   ⚠ KEEPING the branch's bytes of $edited"
          echo "     — the branch changed it and main did not, so git resolved it trivially"
          echo "       and there is nothing to reconcile. Taking main's side here would be a"
          echo "       pure revert of a COMMITTED change (a retirement branch's hand-deletions"
          echo "       are the deliverable). Step 4 regenerates it as usual."
          ;;
      esac
    done
  fi
  for p in "${regen_paths[@]}"; do
    # a pattern may match nothing on this branch — that is fine
    git restore --source=origin/main -- "$p" ${excludes[@]+"${excludes[@]}"} 2>/dev/null || true
  done

  echo "→ step 3: committing the merge BEFORE any regeneration"
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    if ! git commit --no-edit -m "merge origin/main (os-regen artifacts taken from main; regeneration follows)"; then
      echo "✗ step 3's commit was refused — the merge is staged but NOT committed." >&2
      echo "  ⛔ Do not regenerate yet: with a staged index a bare \`git commit\` after" >&2
      echo "     regeneration lands the STAGED side, not the tree you inspected." >&2
      echo "  Clear what the hook reported, then \`git add -A && git commit\` before step 4." >&2
      exit 1
    fi
  else
    echo "   (merge left no additional changes to commit)"
  fi

  # Hand-off assertion: step 4 regenerates on top of this tree and commits the
  # result, so anything uncommitted here rides into that commit unread.
  handoff="$(git status --porcelain -- "${regen_paths[@]}")"
  if [ -n "$handoff" ]; then
    echo "✗ refusing to hand off to step 4 — generated paths are not committed:" >&2
    printf '%s\n' "$handoff" >&2
    echo "  A regen path whose INDEX and WORKTREE disagree (porcelain \`MM\`) is the trap:" >&2
    echo "  \`git commit\` builds from the INDEX, so it lands the side you did not inspect —" >&2
    echo "  a commit whose message claims the opposite of its contents. Commit or discard" >&2
    echo "  these first; ⛔ \`git diff\` and \`git diff HEAD\` read clean right over it." >&2
    exit 1
  fi

  cat <<'EOF'
→ step 4 (yours, in this order — the script stops here on purpose):
   1. build the spec build closure, then regenerate the WHOLE chain
      (e.g. pnpm --filter @objectstack/spec build && the gen:* scripts your
      surface touches);
   2. run the generated-artifact gates until fully green;
   3. assert every sibling PR's entries AND the previous PR's implementation
      body still exist: quoted-exact-name `git grep "<symbol>" origin/main -- <path>`
      — entries are the index, the implementation body is what gets swallowed;
   4. `git add` the regenerated paths and INSPECT THE STAGED DIFF, NOT THE
      WORKING-TREE DIFF, BEFORE COMMITTING (`git diff --cached`) — a commit is
      built from the index, and `git diff`/`git diff HEAD` never read it;
   5. commit the regeneration as its own commit and push.
EOF
}

# --- self-test ---------------------------------------------------------------
#
# Fixtures are whole synthetic repos, because every behaviour here is a claim
# about what git does to an index and a worktree — a mock of git would pin the
# mock. Each case builds a bare origin plus a clone, so `origin/main` is a real
# remote-tracking ref and `git fetch origin main` is a real fetch.

st_fail=0

st_case() {
  # st_case <label> <got> <want>
  if [ "$2" = "$3" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n        got:  %s\n        want: %s\n' "$1" "$2" "$3"
    st_fail=$((st_fail + 1))
  fi
}

# Build a fixture repo in $1 and leave the cwd in its clone, on branch
# `feature`. One fixture exercises all three per-file cases at once:
#
#   gen/baseline.txt  branch only  — a COMMITTED hand-deletion, main untouched
#   gen/both.txt      both sides   — the driver runs and silently keeps ours
#   gen/mainonly.txt  main only    — git resolves it to main trivially
#
# The `os-regen` driver is registered as `true`, which is the real driver's
# measured shape for this purpose: exit 0, keep ours, say nothing. Without it
# git never invokes a driver at all and the both-sides case cannot exist.
st_fixture() {
  fx="$1"
  rm -rf "$fx"
  mkdir -p "$fx"
  git init -q --bare -b main "$fx/origin.git"
  git clone -q "$fx/origin.git" "$fx/work" 2>/dev/null
  cd "$fx/work"
  git config user.email selftest@example.invalid
  git config user.name os-regen-merge-selftest
  git config commit.gpgsign false
  git config merge.os-regen.name 'os-regen (fixture: exit 0, silently keeps ours)'
  git config merge.os-regen.driver true

  mkdir -p gen src
  printf 'gen/**   merge=os-regen\n' > .gitattributes
  st_write_ndm_ledger ''
  printf 'ManifestConfig\nPreviewModeConfig\nRuntimeConfig\n' > gen/baseline.txt
  printf 'both v0\n' > gen/both.txt
  printf 'mainonly v0\n' > gen/mainonly.txt
  printf 'source v1\n' > src/app.txt
  git add -A
  git commit -qm seed
  git push -q origin main

  git checkout -q -b feature
  printf 'ManifestConfig\nRuntimeConfig\n' > gen/baseline.txt   # the hand-deletion
  printf 'both v1-BRANCH\n' > gen/both.txt
  printf 'source v2 (branch)\n' > src/app.txt
  git add -A
  git commit -qm 'retire PreviewModeConfig: hand-delete the released baseline line'

  git worktree add -q "$fx/mainwt" main
  (
    cd "$fx/mainwt"
    git config user.email selftest@example.invalid
    git config user.name os-regen-merge-selftest
    git config commit.gpgsign false
    printf 'unrelated main change\n' > src/other.txt
    printf 'both v1-MAIN\n' > gen/both.txt
    printf 'mainonly v1-MAIN\n' > gen/mainonly.txt
    git add -A
    git commit -qm 'main: unrelated change plus two regenerations'
    git push -q origin main
  )
  cd "$fx/work"
  # Released so a case can `git checkout main` in the clone — a checked-out
  # branch cannot be checked out twice.
  git worktree remove "$fx/mainwt"
  git fetch -q origin main
}

# Build a fixture repo in $1 whose only conflict(s) are a REAL text-merge
# conflict on a `merge=os-regen` path — the MIXED shape `git-merge-regen.mjs`
# takes when a deferral would be unsafe (:14064 in the driver's own header),
# not the clean silent-deferral shape `st_fixture` above exercises. $2, if
# `both`, also gives the branch a conflicting NON-regen edit, for the "both
# classes present" case.
#
# The driver here is a tiny fixture script, not `true`: it runs
# `git merge-file` (a REAL 3-way text merge) and, on conflict, prints a
# driver-shaped remedy naming a fixture regen command before exiting
# non-zero — the same move the real driver makes for an unsafe MIXED row
# (`git-merge-regen.mjs`'s `textMergeInPlace` + its `NOT deferred` notice).
# Kept as a separate file (not inlined in .gitattributes config) so its exit
# code — not `true`'s constant 0 — is what git sees for this path.
st_fixture_regen_conflict() {
  fx="$1"
  both="${2:-}"
  rm -rf "$fx"
  mkdir -p "$fx"

  cat > "$fx/driver.sh" <<'DRIVER'
#!/usr/bin/env bash
set -uo pipefail
ancestor="$1"; ours="$2"; theirs="$3"; path="$4"
git merge-file "$ours" "$ancestor" "$theirs"
rc=$?
if [ "$rc" -eq 0 ]; then
  exit 0
fi
{
  printf '  \xe2\x9a\xa0 %s\n' "$path"
  printf '     NOT deferred: the incoming side carries hand-written changes that no regeneration can restore.\n'
  printf '     This file is MIXED — a generated half plus hand-written prose — so keeping one\n'
  printf "     side whole would delete the other side's prose with no conflict and no red gate.\n"
  printf '     Text-merged instead, and it CONFLICTS. Resolve the prose by hand; the anchor\n'
  printf '     numbers do not matter here — take either side and then run:\n'
  printf '       pnpm gen:fixture-mixed\n'
  printf '     which re-derives them from the merged tree.\n'
} >&2
exit "$rc"
DRIVER
  chmod +x "$fx/driver.sh"

  git init -q --bare -b main "$fx/origin.git"
  git clone -q "$fx/origin.git" "$fx/work" 2>/dev/null
  cd "$fx/work"
  git config user.email selftest@example.invalid
  git config user.name os-regen-merge-selftest
  git config commit.gpgsign false
  git config merge.os-regen.name 'os-regen (fixture: real text merge, conflicts on MIXED prose)'
  git config merge.os-regen.driver "bash $fx/driver.sh %O %A %B %P"

  mkdir -p gen src
  printf 'gen/**   merge=os-regen\n' > .gitattributes
  st_write_ndm_ledger ''
  printf 'hand-written prose: original\n' > gen/mixed.txt
  printf 'source v1\n' > src/app.txt
  if [ "$both" = both ]; then
    printf 'prose v1\n' > src/prose.txt
  fi
  git add -A
  git commit -qm seed
  git push -q origin main

  git checkout -q -b feature
  printf 'hand-written prose: BRANCH\n' > gen/mixed.txt
  if [ "$both" = both ]; then
    printf 'prose BRANCH\n' > src/prose.txt
  fi
  git add -A
  git commit -qm 'feature: hand-edit the MIXED prose'

  git worktree add -q "$fx/mainwt" main
  (
    cd "$fx/mainwt"
    git config user.email selftest@example.invalid
    git config user.name os-regen-merge-selftest
    git config commit.gpgsign false
    printf 'hand-written prose: MAIN\n' > gen/mixed.txt
    if [ "$both" = both ]; then
      printf 'prose MAIN\n' > src/prose.txt
    fi
    git add -A
    git commit -qm 'main: also hand-edit the MIXED prose'
    git push -q origin main
  )
  cd "$fx/work"
  git worktree remove "$fx/mainwt"
  git fetch -q origin main
}

# Build the standard fixture in $1, then replace its .gitattributes with one
# shaped like the REAL file: prose that quotes the literal `merge=os-regen`,
# and exactly THREE real rows. Leaves the cwd in the clone, on `feature`, with
# the new routing committed.
#
# Two prose shapes, on purpose, because they fail the reader differently:
#   the header line quotes the literal in BACKTICKS — caught by the token
#   anchor even with comment-skipping off;
#   the indented line mentions it whitespace-delimited — caught ONLY by
#   comment-skipping, which is what makes it the discriminator for 8b.
# The real .gitattributes carries the backticked shape (its line 36); the
# indented one is the near neighbour that a future edit can add for free.
st_fixture_list_bait() {
  st_fixture "$1" >/dev/null 2>&1
  cat > .gitattributes <<'ATTRS'
# Routed generated artifacts. `merge=os-regen` hands these to the driver.
#
  #   an indented comment that also mentions merge=os-regen in prose
gen/**                    merge=os-regen
docs/generated-guide.md   merge=os-regen
data/*.json               merge=os-regen
ATTRS
  git add -A
  git commit -qm 'route three paths, with prose that quotes the literal'
}

# Write a fixture `scripts/regen-artifacts.mjs` exporting the three names the
# ledger reader requires. The fixtures carry one for the same reason they carry
# their own `.gitattributes` and their own driver: the reading MECHANISM is what
# is under test here, and pinning it against the real ledger would make every
# case a hostage to a disposition somebody legitimately changes. The real
# ledger's own shape is pinned separately, in case 9d.
#
# $1 is the entry list, as JS array elements.
st_write_ndm_ledger() {
  mkdir -p scripts
  {
    printf '// fixture ledger — the shape scripts/regen-artifacts.mjs exports.\n'
    printf 'export const NOT_DRIVER_MANAGED = Object.freeze([\n'
    printf '%s\n' "$1"
    printf ']);\n'
    printf 'export function ownerOf(entry) { return entry.owner ?? "@fixture/owner"; }\n'
    printf 'export function ownerRunCommand(owner, script) { return "pnpm " + script; }\n'
  } > scripts/regen-artifacts.mjs
}

# Build a fixture in $1 whose conflicts are all UNROUTED, and whose ledger
# declares three of the four — the shape this script was blind to until #18047.
# One fixture carries every reading class 3 has to make:
#
#   generated/marked.txt        declared + marker pair, and the two sides differ
#                               OUTSIDE the regions — the PR #17835 shape, where
#                               taking a side drops hand-written text silently
#   generated/regions-only.txt  declared + marker pair, differing only INSIDE
#                               the regions — the firing control for the finding
#                               above, which would otherwise be unfalsifiable
#   ledgers/whole.json          declared, NO markers — a ratchet-shaped file,
#                               where "resolve by regeneration" is the WRONG
#                               instruction and the ledger says so
#   build/ignored.json          declared `untracked`, yet tracked here — the
#                               reader drops those rows, so this must NOT be
#                               read as class 3
#   src/plain.txt               ⛔ NOT declared and not routed — today's class 1,
#                               and the discriminating half of the reading: the
#                               card's own dark-control note says an unlisted
#                               path reads exactly like a non-generated one, so
#                               a fixture that only proved "listed ⇒ class 3"
#                               would pass with the membership test deleted.
st_fixture_ndm_conflict() {
  fx="$1"
  rm -rf "$fx"
  mkdir -p "$fx"
  git init -q --bare -b main "$fx/origin.git"
  git clone -q "$fx/origin.git" "$fx/work" 2>/dev/null
  cd "$fx/work"
  git config user.email selftest@example.invalid
  git config user.name os-regen-merge-selftest
  git config commit.gpgsign false

  mkdir -p gen generated ledgers build src
  printf 'gen/**   merge=os-regen\n' > .gitattributes
  printf 'untouched\n' > gen/untouched.txt
  st_write_ndm_ledger "  { path: 'generated/marked.txt', gen: 'gen:fixture-marked', why: 'fixture' },
  { path: 'generated/regions-only.txt', gen: 'gen:fixture-regions', why: 'fixture' },
  { path: 'ledgers/whole.json', gen: 'gen:fixture-whole', why: 'fixture' },
  { path: 'build/ignored.json', gen: 'gen:fixture-ignored', untracked: true, why: 'fixture' },"
  st_marked_file generated/marked.txt table:1 original row-a
  st_marked_file generated/regions-only.txt table:2 stable row-x
  printf '{ "entries": 1 }\n' > ledgers/whole.json
  printf '{ "ignored": 1 }\n' > build/ignored.json
  printf 'plain v0\n' > src/plain.txt
  git add -A
  git commit -qm seed
  git push -q origin main

  git checkout -q -b feature
  st_marked_file generated/marked.txt table:1 BRANCH row-a-BRANCH
  st_marked_file generated/regions-only.txt table:2 stable row-x-BRANCH
  printf '{ "entries": 2 }\n' > ledgers/whole.json
  printf '{ "ignored": 2 }\n' > build/ignored.json
  printf 'plain BRANCH\n' > src/plain.txt
  git add -A
  git commit -qm 'feature: edit every declared path plus one undeclared one'

  git worktree add -q "$fx/mainwt" main
  (
    cd "$fx/mainwt"
    git config user.email selftest@example.invalid
    git config user.name os-regen-merge-selftest
    git config commit.gpgsign false
    st_marked_file generated/marked.txt table:1 MAIN row-a-MAIN
    st_marked_file generated/regions-only.txt table:2 stable row-x-MAIN
    printf '{ "entries": 3 }\n' > ledgers/whole.json
    printf '{ "ignored": 3 }\n' > build/ignored.json
    printf 'plain MAIN\n' > src/plain.txt
    git add -A
    git commit -qm 'main: edit the same paths differently'
    git push -q origin main
  )
  cd "$fx/work"
  git worktree remove "$fx/mainwt"
  git fetch -q origin main
}

# A file generated only BETWEEN a marker pair, written the way the tree writes
# one. $1 path, $2 region id, $3 the word the hand-written lines carry, $4 the
# row inside the region.
st_marked_file() {
  {
    printf 'hand-written intro: %s\n' "$3"
    printf '// <os-generated %s>\n' "$2"
    printf '%s\n' "$4"
    printf '// </os-generated %s>\n' "$2"
    printf 'hand-written outro: %s\n' "$3"
  } > "$1"
}

mode_self_test() {
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/os-regen-merge-selftest.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT INT TERM
  here="$(pwd)"
  printf 'os-regen-merge --self-test\n'

  # --- 1. all three per-file cases, in one run
  st_fixture "$tmp/a" >/dev/null 2>&1
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'a clean run exits 0' "$rc" 0
  # branch-only: the committed hand-deletion survives — HAZARD 1
  st_case 'branch-only regen path keeps the branch bytes' \
    "$(grep -c 'PreviewModeConfig' gen/baseline.txt || true)" 0
  st_case 'and is not reverted in the commit either' \
    "$(git show HEAD:gen/baseline.txt | grep -c 'PreviewModeConfig' || true)" 0
  st_case 'and the run names it as kept' \
    "$(printf '%s' "$out" | grep -c 'KEEPING the branch.s bytes of gen/baseline.txt' || true)" 1
  # both sides: the driver dropped main's side; step 2 must put it back
  st_case 'both-sides regen path takes main s side' \
    "$(grep -c 'both v1-MAIN' gen/both.txt || true)" 1
  st_case 'and the run names it as taken, loudly' \
    "$(printf '%s' "$out" | grep -c "TAKING main.s side of gen/both.txt" || true)" 1
  st_case 'and that repair is what step 3 commits' \
    "$(git show HEAD:gen/both.txt | grep -c 'both v1-MAIN' || true)" 1
  # main-only: git already resolved it; nothing to say and nothing to do
  st_case 'main-only regen path holds main s side' \
    "$(grep -c 'mainonly v1-MAIN' gen/mainonly.txt || true)" 1
  st_case 'and draws no per-path notice at all' \
    "$(printf '%s' "$out" | grep -cE '(KEEPING|TAKING).*gen/mainonly[.]txt' || true)" 0
  st_case 'step 4 carries the staged-diff sentence' \
    "$(printf '%s' "$out" | grep -c 'INSPECT THE STAGED DIFF' || true)" 1
  st_case 'the hand-off leaves no uncommitted regen path' \
    "$(git status --porcelain -- 'gen/**' | wc -l | tr -d ' ')" 0
  cd "$here"

  # --- 2. step 2 writes the WORKTREE, never the INDEX.
  #
  # ⚠️ This one is pinned at the SOURCE, deliberately. The property is about the
  # state between step 2 and step 3, and step 3's `git add -A` stages the same
  # bytes a moment later either way — so no assertion on a COMPLETED run can
  # tell `git restore --source` from `git checkout <ref> --`. What the spelling
  # buys is the abort path (a refused hook, a Ctrl-C, the sequence resumed by
  # hand): main's side never sits in the index alone, so a bare `git commit`
  # there lands nothing instead of the wrong side. A behavioural pin that cannot
  # fail would be worse than no pin, so the scan says what it really checks.
  # Comment lines are excluded: the header quotes the banned spelling to explain
  # it, and a scan that cannot tell prose from code would red on its own docs.
  st_case 'step 2 uses the non-staging spelling' \
    "$(sed -n '1,/^# --- self-test/p' "$SELF" | grep -v '^[[:space:]]*#' \
       | grep -c 'git restore --source=origin/main' || true)" 1
  st_case 'and never the staging one' \
    "$(sed -n '1,/^# --- self-test/p' "$SELF" | grep -v '^[[:space:]]*#' \
       | grep -c 'git checkout origin/main --' || true)" 0

  # Behaviour that IS observable: after a run, a regeneration on top is a lone
  # unstaged `M` — the state where a bare `git commit` commits nothing at all.
  st_fixture "$tmp/b" >/dev/null 2>&1
  bash "$SELF" >/dev/null 2>&1 || true
  printf 'ManifestConfig\nRuntimeConfig\nregenerated\n' > gen/baseline.txt
  st_case 'a regeneration on top of the run is unstaged M, never MM' \
    "$(git status --porcelain -- gen/baseline.txt | cut -c1-2)" ' M'
  cd "$here"

  # --- 3. the hand-off assertion REFUSES an uncommitted regen path.
  #        Reached through a pre-commit hook that rewrites the worktree after
  #        the index is built — the ordinary formatter shape.
  st_fixture "$tmp/c" >/dev/null 2>&1
  printf '#!/bin/sh\nprintf "hook rewrote this\\n" >> gen/untouched.txt\nexit 0\n' \
    > .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'an uncommitted regen path at hand-off is refused' "$rc" 1
  st_case 'and the refusal names the index/worktree split' \
    "$(printf '%s' "$out" | grep -c 'INDEX and WORKTREE disagree' || true)" 1
  cd "$here"

  # --- 4. a refused step-3 commit exits non-zero and names the staged index
  st_fixture "$tmp/d" >/dev/null 2>&1
  printf '#!/bin/sh\nexit 1\n' > .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'a refused step-3 commit fails the run' "$rc" 1
  st_case 'and warns against regenerating over a staged index' \
    "$(printf '%s' "$out" | grep -c 'Do not regenerate yet' || true)" 1
  cd "$here"

  # --- 5. the pre-existing refusals still hold
  st_fixture "$tmp/e" >/dev/null 2>&1
  printf 'dirt\n' > src/app.txt
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'a dirty tree is refused' "$rc" 1
  st_case 'and says so' \
    "$(printf '%s' "$out" | grep -c 'working tree not clean' || true)" 1
  git checkout -q -- src/app.txt
  git checkout -q main
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'running on main is refused' "$rc" 1
  git checkout -q feature
  printf 'nothing routed here\n' > .gitattributes
  git add -A && git commit -qm 'drop the os-regen routes'
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'an empty os-regen path list is refused' "$rc" 1
  st_case 'and refuses to guess' \
    "$(printf '%s' "$out" | grep -c 'refusing to guess' || true)" 1
  cd "$here"

  # --- 6. a MIXED-conflict on a regen path ONLY. The trap this closes: step 1
  #        must not tell the operator these conflicts are "in NON-generated
  #        files" (they are not), and must not tell them to leave the file
  #        alone (⛔ "do not resolve generated files textually") — the driver
  #        has just asked them to hand-resolve exactly this one.
  st_fixture_regen_conflict "$tmp/f"
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'a regen-only MIXED conflict fails the run' "$rc" 1
  st_case 'and does NOT call it a non-generated-file conflict' \
    "$(printf '%s' "$out" | grep -c 'conflicts in NON-generated files' || true)" 0
  # THE ABSENCE ASSERTION THAT MATTERS (#14671): this exact line is correct
  # advice for a deferrable regen path and wrong, silently-destructive advice
  # for a MIXED one — see the driver's own notice, echoed a few lines above in
  # the same run's output, saying the opposite.
  st_case 'and does NOT forbid textual resolution of the generated file' \
    "$(printf '%s' "$out" | grep -c 'Do not resolve generated files textually' || true)" 0
  st_case 'and DOES say the file needs hand-resolving' \
    "$(printf '%s' "$out" | grep -c 'Hand-resolve the prose' || true)" 1
  st_case 'and names the conflicted regen path' \
    "$(printf '%s' "$out" | grep -q 'gen/mixed.txt' && echo present || echo absent)" present
  st_case "and the driver's own notice is still shown" \
    "$(printf '%s' "$out" | grep -c 'NOT deferred: the incoming side carries hand-written changes' || true)" 1
  st_case "and the driver's regeneration command is still shown" \
    "$(printf '%s' "$out" | grep -c 'pnpm gen:fixture-mixed' || true)" 1
  cd "$here"

  # --- 6b. THE DISCRIMINATING MUTATION. A self-test that can never fail is
  #         worse than none: prove the absence assertion above actually
  #         distinguishes the fixed script from the original bug by
  #         reintroducing the old unconditional line and watching case 6 red.
  mutated="$tmp/mutated-os-regen-merge.sh"
  # Literal (non-regex) replacement via perl's \Q..\E, keyed off the anchor
  # line so this stays robust to reflow — same dependency scripts/pm/ already
  # takes for something bash 3.2 cannot do (os-verify-lock.sh's Time::HiRes).
  MUT_ANCHOR='echo "✗ merge stopped on conflicts in GENERATED files the driver declined to defer" >&2' \
  MUT_INSERT='echo "✗ merge stopped on conflicts in NON-generated files — resolve those by hand" >&2
    echo "  ⛔ Do not resolve generated files textually." >&2' \
    perl -0777 -pe 's/\Q$ENV{MUT_ANCHOR}\E/$ENV{MUT_INSERT}/' "$SELF" > "$mutated"
  # Scanned only up to the `--- self-test` marker (the same trick the script's
  # own step-2-spelling pin uses above) — past that point the phrase also
  # appears inside THIS self-test's own assertion strings, which the mutation
  # never touches and which would otherwise inflate the count.
  st_case 'the mutation anchor was found and replaced (falsifiability check)' \
    "$(sed -n '1,/^# --- self-test/p' "$mutated" | grep -c 'Do not resolve generated files textually' || true)" 2
  st_case 'the mutation actually changed the script text' \
    "$(diff -q "$SELF" "$mutated" >/dev/null 2>&1; echo $?)" 1
  st_case 'and the mutated script still parses' \
    "$(bash -n "$mutated" >/dev/null 2>&1; echo $?)" 0
  st_fixture_regen_conflict "$tmp/f-mutated"
  mut_out="$(bash "$mutated" 2>&1)" && mut_rc=0 || mut_rc=$?
  st_case 'mutated: the suppressed line is back (proves the assertion bites)' \
    "$(printf '%s' "$mut_out" | grep -c 'Do not resolve generated files textually' || true)" 1
  cd "$here"

  # --- 7. BOTH classes present: a non-regen conflict alongside the regen-path
  #        MIXED conflict. Each file must be named under its own class, and
  #        the suppressed line stays suppressed here too — some of the
  #        generated conflicts in this run DO need hand-resolution, so the
  #        blanket "do not resolve generated files textually" would be just as
  #        wrong here as in the regen-only case.
  st_fixture_regen_conflict "$tmp/g" both
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'a mixed-classes conflict fails the run' "$rc" 1
  st_case 'and says BOTH classes are present' \
    "$(printf '%s' "$out" | grep -c 'conflicts in BOTH non-generated and generated files' || true)" 1
  st_case 'and names the non-generated file' \
    "$(printf '%s' "$out" | grep -q 'src/prose.txt' && echo present || echo absent)" present
  st_case 'and names the generated (regen) file' \
    "$(printf '%s' "$out" | grep -q 'gen/mixed.txt' && echo present || echo absent)" present
  st_case 'and the suppressed line is absent here too' \
    "$(printf '%s' "$out" | grep -c 'Do not resolve generated files textually' || true)" 0
  cd "$here"

  # --- 8. THE LIST ITSELF. The printed pattern count is the operator's ONLY
  #        check that this script is reading the right surface — the header
  #        says so, and says why there is deliberately no second copy to check
  #        it against. So it is pinned here, against a fixture .gitattributes
  #        carrying the prose shape that used to enter the list as a pathspec
  #        literally `#`.
  #
  #        The assertion is an EXACT COUNT, never "no entry equals `#`": a
  #        count also reds the day the read silently matches ZERO lines, which
  #        an absence assertion passes with flying colours.
  st_fixture_list_bait "$tmp/h"
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'a run over the bait .gitattributes exits 0' "$rc" 0
  st_case 'the pattern count counts ROWS, not prose that quotes the literal' \
    "$(printf '%s' "$out" | sed -n 's/^→ os-regen paths (from .gitattributes, \([0-9]*\) patterns):$/\1/p')" 3
  st_case 'and no phantom # pathspec is listed' \
    "$(printf '%s' "$out" | grep -c '^    #$' || true)" 0
  st_case 'and the three real rows all are' \
    "$(printf '%s' "$out" | grep -cE '^    (gen/[*][*]|docs/generated-guide[.]md|data/[*][.]json)$' || true)" 3
  # The fixture really is bait: the pre-repair spelling over-counts it by two.
  st_case 'the pre-repair spelling over-counts the same file (fixture is bait)' \
    "$(grep 'merge=os-regen' .gitattributes | awk '{print $1}' | wc -l | tr -d ' ')" 5
  cd "$here"

  # --- 8a. THE GRAMMAR the reader was decided against, pinned against REAL git
  #         rather than assumed. .gitattributes has no inline trailing comment:
  #         git rejects the whole row and routes nothing. That measurement is
  #         why the reader strips comment LINES only and does not try to trim a
  #         trailing `#`. If git ever grows one, this reddens and the decision
  #         gets revisited instead of rotting.
  st_fixture "$tmp/i" >/dev/null 2>&1
  printf 'inline.txt merge=os-regen # trailing note\n' > .gitattributes
  : > inline.txt
  st_case 'git does NOT admit an inline trailing comment — the row routes nothing' \
    "$(git check-attr merge -- inline.txt 2>/dev/null)" 'inline.txt: merge: unspecified'
  st_case 'and names # as the invalid attribute name' \
    "$(git check-attr merge -- inline.txt 2>&1 >/dev/null | grep -c 'is not a valid attribute name' || true)" 1
  # Firing control for the two absences above: the same row WITHOUT the trailing
  # comment does route. Without it, a git that stopped reading .gitattributes at
  # all would pass both cases above.
  printf 'inline.txt merge=os-regen\n' > .gitattributes
  st_case 'control: the same row without the note DOES route' \
    "$(git check-attr merge -- inline.txt 2>/dev/null)" 'inline.txt: merge: os-regen'
  cd "$here"

  # --- 8b. THE DISCRIMINATING MUTATION for case 8. Disable the reader's
  #         comment-line skip and watch the count come back one too high — the
  #         phantom is exactly what that rule removes. Same perl/\Q..\E literal
  #         replacement 6b uses, keyed off the awk rule rather than a message.
  mutated_list="$tmp/mutated-list-os-regen-merge.sh"
  MUT_ANCHOR='    /^[ \t]*#/ { next }' \
  MUT_INSERT='    /^[ \t]*#ZZ-NEVER-MATCHES-ZZ/ { next }' \
    perl -0777 -pe 's/\Q$ENV{MUT_ANCHOR}\E/$ENV{MUT_INSERT}/' "$SELF" > "$mutated_list"
  st_case 'the list mutation actually changed the script text' \
    "$(diff -q "$SELF" "$mutated_list" >/dev/null 2>&1; echo $?)" 1
  st_case 'and the mutated script still parses' \
    "$(bash -n "$mutated_list" >/dev/null 2>&1; echo $?)" 0
  st_fixture_list_bait "$tmp/h-mutated"
  mut_out="$(bash "$mutated_list" 2>&1)" && mut_rc=0 || mut_rc=$?
  st_case 'mutated: the phantom # is back in the list (proves case 8 bites)' \
    "$(printf '%s' "$mut_out" | grep -c '^    #$' || true)" 1
  st_case 'mutated: and the count is one too high' \
    "$(printf '%s' "$mut_out" | sed -n 's/^→ os-regen paths (from .gitattributes, \([0-9]*\) patterns):$/\1/p')" 4
  cd "$here"

  # --- 9. CLASS 3: generated, deliberately NOT routed (#18047). The trap this
  #        closes is the exact inverse of case 6's: these paths are not routed,
  #        so the old set difference labelled them "NON-generated" and sent them
  #        to a hand merge — while the same message's third line forbids
  #        resolving a generated file textually. Neither sentence could be
  #        obeyed, and `.gitattributes` says a registration touches such a file
  #        by construction.
  st_fixture_ndm_conflict "$tmp/j"
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'a declared-but-unrouted conflict fails the run' "$rc" 1
  # THE ABSENCE ASSERTIONS (#18047): neither class-1 sentence may be printed
  # over a set that now contains generated files.
  st_case 'and does NOT call the whole set a non-generated-file conflict' \
    "$(printf '%s' "$out" | grep -c 'conflicts in NON-generated files' || true)" 0
  st_case 'and does NOT forbid textual resolution across the whole set' \
    "$(printf '%s' "$out" | grep -c 'Do not resolve generated files textually' || true)" 0
  # The marked shape: resolve the regions by regeneration, and the command is
  # the ledger's own, built by `ownerRunCommand` rather than assembled here.
  st_case 'the marked file is named as generated in marked regions' \
    "$(printf '%s' "$out" | grep -c '⚠ generated/marked.txt — GENERATED IN MARKED REGIONS' || true)" 1
  st_case 'and both marked files are sent to REGENERATION, not to a hand merge' \
    "$(printf '%s' "$out" | grep -c 'Do NOT hand-merge the generated regions' || true)" 2
  st_case "and carries the ledger's own regeneration command" \
    "$(printf '%s' "$out" | grep -c 'pnpm gen:fixture-marked' || true)" 1
  # THE ADDENDUM'S CAVEAT, answered rather than delegated: both sides edited
  # prose outside the regions, so taking either one drops the other's text.
  st_case 'and REPORTS that the two sides differ outside the generated regions' \
    "$(printf '%s' "$out" | grep -c 'THE TWO SIDES DIFFER OUTSIDE THE GENERATED REGIONS' || true)" 1
  st_case 'and counts the hand-written lines at stake' \
    "$(printf '%s' "$out" | sed -n 's/.*DIFFER OUTSIDE THE GENERATED REGIONS (\([0-9]*\) line(s)).*/\1/p')" 4
  # THE FIRING CONTROL for that finding — without it the report above could be
  # a constant. Same marker pair, both sides differing only INSIDE the regions.
  st_case 'and clears the file whose sides differ only inside the regions' \
    "$(printf '%s' "$out" | grep -c 'identical outside the generated regions' || true)" 1
  # The unmarked shape: a ratchet-shaped declared file. ⛔ Regeneration is the
  # WRONG instruction for it, and its ledger entry is what says so.
  st_case 'the declared file with no markers is NOT sent to regeneration' \
    "$(printf '%s' "$out" | grep -c '⚠ ledgers/whole.json — generator-touched' || true)" 1
  st_case 'and is told NOT to regenerate as part of this merge' \
    "$(printf '%s' "$out" | grep -c 'Do NOT regenerate it as part of this merge' || true)" 1
  # THE DISCRIMINATING HALF. An UNLISTED path must still read as class 1 — the
  # card's dark-control note: `unspecified` is the default, so "not listed"
  # and "not generated" look identical from the routing side alone.
  st_case 'an unlisted, unrouted path is still reported as non-generated' \
    "$(printf '%s' "$out" | grep -cE '^    src/plain[.]txt$' || true)" 1
  st_case 'and is NOT given any class-3 reading' \
    "$(printf '%s' "$out" | grep -c '⚠ src/plain.txt' || true)" 0
  # An `untracked` ledger row is dropped by the reader, so a tracked file at
  # that path is class 1 — and `git-merge-regen.mjs --self-test` is what reds
  # the day such a path really becomes tracked.
  st_case 'a row declared untracked buys no class-3 reading' \
    "$(printf '%s' "$out" | grep -c '⚠ build/ignored.json' || true)" 0
  st_case 'and that path is reported as non-generated instead' \
    "$(printf '%s' "$out" | grep -cE '^    build/ignored[.]json$' || true)" 1
  cd "$here"

  # --- 9b. THE DISCRIMINATING MUTATION for case 9. Empty the ledger read and
  #         watch the whole set collapse back into class 1 — which is the
  #         defect #18047 reported, reproduced on demand. Same perl/\Q..\E
  #         literal replacement 6b and 8b use, keyed off the reader's skip line.
  mutated_ndm="$tmp/mutated-ndm-os-regen-merge.sh"
  MUT_ANCHOR='  if (e.untracked) continue;' \
  MUT_INSERT='  if (true) continue;' \
    perl -0777 -pe 's/\Q$ENV{MUT_ANCHOR}\E/$ENV{MUT_INSERT}/' "$SELF" > "$mutated_ndm"
  st_case 'the ledger mutation actually changed the script text' \
    "$(diff -q "$SELF" "$mutated_ndm" >/dev/null 2>&1; echo $?)" 1
  st_case 'and the mutated script still parses' \
    "$(bash -n "$mutated_ndm" >/dev/null 2>&1; echo $?)" 0
  st_fixture_ndm_conflict "$tmp/j-mutated"
  mut_out="$(bash "$mutated_ndm" 2>&1)" && mut_rc=0 || mut_rc=$?
  st_case 'mutated: the class-3 reading is gone (proves case 9 bites)' \
    "$(printf '%s' "$mut_out" | grep -c 'GENERATED IN MARKED REGIONS' || true)" 0
  st_case 'mutated: and the generated file is called NON-generated again' \
    "$(printf '%s' "$mut_out" | grep -c 'conflicts in NON-generated files' || true)" 1
  st_case 'mutated: with the instruction it cannot obey, back alongside it' \
    "$(printf '%s' "$mut_out" | grep -c 'Do not resolve generated files textually' || true)" 1
  cd "$here"

  # --- 9c. THE REAL LEDGER, pinned against the module itself rather than
  #         against the fixture that models it — case 8a's discipline, one
  #         surface over. The fixtures prove the reading mechanism; this proves
  #         the surface it reads still has the shape and still declares the path
  #         the card is about. If a later change routes that file or drops its
  #         entry, this reddens and the classification gets revisited instead of
  #         silently reverting to the old label.
  ndm_real="$(read_not_driver_managed "$(dirname "$SELF")/../regen-artifacts.mjs")" || ndm_real=''
  st_case 'the real ledger is readable and non-empty' \
    "$([ "$(printf '%s' "$ndm_real" | grep -c . || true)" -gt 0 ] && echo yes || echo no)" yes
  st_case 'and still declares the migrations registry (the card s path)' \
    "$(printf '%s\n' "$ndm_real" | awk -F'\t' '$1 == "packages/spec/src/migrations/registry.ts"' | grep -c . || true)" 1
  st_case 'and records the generator that resolves its regions' \
    "$(printf '%s\n' "$ndm_real" | awk -F'\t' '$1 == "packages/spec/src/migrations/registry.ts" { print $2 }' \
       | grep -c 'gen:migration-registry' || true)" 1
  st_case 'control: a fabricated path is not in it' \
    "$(printf '%s\n' "$ndm_real" | awk -F'\t' '$1 == "packages/spec/no-such-ledger-entry.json"' | grep -c . || true)" 0
  st_case 'control: that file really is unrouted, so it can only reach class 3' \
    "$(cd "$(dirname "$SELF")/../.." && git check-attr merge -- packages/spec/src/migrations/registry.ts)" \
    'packages/spec/src/migrations/registry.ts: merge: unspecified'

  # --- 9d. AN UNREADABLE LEDGER IS LOUD, never a silent class-1 sweep. This is
  #         the failure mode that would restore the defect with the evidence
  #         removed: no ledger, no generatedness, every conflict labelled
  #         non-generated again — so the run says so in as many words.
  st_fixture_ndm_conflict "$tmp/k"
  git rm -q scripts/regen-artifacts.mjs
  git commit -qm 'drop the ledger the reader needs'
  out="$(bash "$SELF" 2>&1)" && rc=0 || rc=$?
  st_case 'an unreadable ledger still fails the run' "$rc" 1
  st_case 'and says the ledger could not be read' \
    "$(printf '%s' "$out" | grep -c 'could NOT read NOT_DRIVER_MANAGED' || true)" 1
  st_case 'and makes no class-3 claim it cannot support' \
    "$(printf '%s' "$out" | grep -c 'GENERATED IN MARKED REGIONS' || true)" 0
  cd "$here"

  if [ "$st_fail" -ne 0 ]; then
    printf '✗ os-regen-merge self-test: %d case(s) failed.\n' "$st_fail"
    return 1
  fi
  printf '✓ os-regen-merge self-test: all cases pass.\n'
  return 0
}

# --- dispatch ----------------------------------------------------------------

main() {
  case "${1:-}" in
    --self-test)
      mode_self_test
      exit $?
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    '')
      mode_run
      ;;
    *)
      echo "✗ unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
