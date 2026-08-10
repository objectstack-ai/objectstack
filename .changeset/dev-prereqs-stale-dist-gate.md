---
"@objectstack/spec": patch
---

fix(devx): gate `pnpm dev` on a STALE `packages/spec/dist`, not only a missing one (#5864)

`check:dev-prereqs` (PR #5863) asserted that every workspace package's declared
`dist/` entry point exists. That covered one half of #5726 — a **missing**
artifact, which fails loudly — and left the other half ungated: a dist that is
present but **stale**, which does not fail at all. It lies, and it lies about
somebody else's code. #5726's 20+ TypeScript errors read exactly like real
contract drift while `isAppResolvedDefaultToken` was exported from `src/` the
whole time and merely absent from a stale `packages/spec/dist`.

Worse, the existence gate made that half slightly more misleading than before:
the developer was told the workspace was fine seconds before the fake drift
appeared, so a green line was vouching for something it had never checked.

**The definition, so a gate can decide it.** `packages/spec`'s build now records
a sha256 of its own build inputs into `packages/spec/dist/.build-input-hash` as
its last step; `check:dev-prereqs` recomputes that hash and compares. Stale ⇔
the two differ. Inputs are everything under `src/`, the package manifest, the
package's own tsconfig/tsup config, and turbo.json's `globalDependencies` —
read from turbo.json rather than restated, so the build's own declaration of a
global input is also the gate's.

**Content, never mtime.** PR #5863 refused this half because comparing source
mtimes against `dist` false-reds after any checkout, and a gate that cries wolf
on day one gets switched off. A content hash is immune to all of it — `git
worktree add`, `git checkout`, restored backups, clock skew, `touch`. Verified
on the real tree: a source file rewritten with identical bytes and an mtime one
hour in the future (so `src` is strictly newer than `dist`) stays green.

**Scope, stated rather than implied.** Freshness is asserted for `packages/spec`
alone — AGENTS.md §9's stale-artefact table names exactly one dist that presents
as *other people's* contract drift. The pass line now says which claim is which:
existence for all 67 packages, freshness for the one. An unstamped amplifier
dist is red rather than a warning, because that is precisely the tree #5726 was
run on, and a gate that cannot find its freshness input has verified nothing
(#4690).

**For consumers of `@objectstack/spec`:** no API, type or runtime change. The
published tarball gains one 65-byte file, `dist/.build-input-hash`, which is the
build's own input digest and is read only by this repo's dev gate.
