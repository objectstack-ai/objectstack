---
"@objectstack/spec": patch
---

fix(spec): repoint the `agent`, `skill` and `action` liveness citations at the real cloud path (#13272)

The `liveness/` ledgers ship inside this package's npm tarball (they are named
in `files`), so this is a published-data change even though no runtime
behaviour moves and no schema key changes. No `status` verdict is altered.

Twenty-two `evidence` citations across `liveness/agent.json` (11),
`liveness/skill.json` (8) and `liveness/action.json` (3) named
`packages/services/service-ai/...` — a path that exists in **neither**
repository. The framework has no service-ai tree at all (`packages/services/`
ships every sibling service except it), and cloud's real layout, measured at
cloud@`15f55df`, is `packages/service-ai/...`. Each `_note` additionally
repeated the claim that the framework's own tree "is a stale build artifact
with no `src/`", which is false in the opposite direction from the one it
suggests: absent, not stale.

Why twenty-two dead pointers sat green, and why the repair is not a plain
re-spelling: `FOREIGN_PATH_PREFIXES` in `scripts/liveness/evidence.mts` lists
the *stale* spelling, so those citations were silently treated as foreign and
never resolved — they did not survive scrutiny, they were exempt from it. The
real cloud path is repo-rooted in shape and is not in that list, so a naive
repoint resolves as LOCAL and fails CI. Measured on this branch by ablation:
stripping the realm markers moves the gate from `467 repo-local ... 467
resolved` to `489 ... 467 resolved, 22 MISSING` and exit 1. Every repointed
citation therefore carries the explicit `cloud` realm marker, which is the
attribution `scanEvidence` reads directly rather than a special case for one
prefix. The constant is deliberately left alone: adding the real path to it
would let an unmarked citation pass silently, trading one unfalsifiable
spelling for another.

Scope boundary recorded in each `_note`: this corrects the package root from
the measurement above only. The cited consumers were **not** re-read against a
cloud checkout, so no `verifiedAt` is stamped and no `#symbol` anchor is added
— the gate never resolves a foreign anchor, so an unverified one would
re-create the very unfalsifiable pointer this repair removes.
