---
"@objectstack/spec": patch
---

`check:api-surface` (and every other gate that reads `packages/spec/dist`) no longer refuses a dist that is exactly current because a source file's mtime moved without its bytes changing.

The freshness rule shared by four gates and the pre-commit hook compares `dist/**/*.d.ts` mtimes against `src/**/*.ts` mtimes. That is the right primitive — it is the artifact those gates consume, and it sees the hand-edited dist and the toolchain change no content digest can — but it cannot tell a real edit from a rewrite that left the bytes alone. A `git merge` re-checks-out an unchanged source file and bumps its mtime; the build that follows correctly does not run, because turbo's cache hashes content, so it is a cache hit that rewrites nothing and leaves every `dist/` mtime where the previous build left it. The gate then refused a correct dist, and prescribed a full rebuild — minutes, under the shared verify lock — of an artifact that needed none.

The mtime rule keeps its power to convict and gains one way to be answered. `packages/spec`'s build now records a second stamp beside the existing one, `dist/.build-input-hash-dts`, holding the same build-input digest — but written **only** by a build that actually emitted declarations, so `OS_SKIP_DTS=1` leaves it alone. When that digest equals the sources on disk, the declarations demonstrably describe them and the refusal is cleared. The evidence may only ever **acquit**: a missing, unreadable or mismatched stamp leaves the mtime verdict standing, so nothing that passed before can start failing, and the `OS_SKIP_DTS=1`-on-a-built-tree shape that ruled out `dist/.build-input-hash` for this purpose still fails, because that build never refreshes the new file.

The refusal message was wrong in the same case and is now driven by what was measured: it names a real content change and prints both digests when the stamp disagrees, says plainly that there is nothing to compare against when no stamp exists, and no longer sends every reader after `OS_SKIP_DTS` regardless of cause. It also notes that a repo-wide `pnpm build` may be a cache hit that rewrites nothing, so the remedy names the package build directly.

The published tarball gains one 65-byte file next to the stamp it already shipped.
