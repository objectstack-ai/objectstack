---
'@objectstack/core': patch
'@objectstack/plugin-auth': patch
'@objectstack/organizations': patch
---

Build freshness: these three packages now write the repo's build-input content
stamp as the last step of their own build, and are checked for freshness (not
merely existence) by `check:dev-prereqs`.

What changes for a consumer: each tarball now carries two extra inert metadata
files inside `dist/` — `.build-input-hash` and `.build-input-hash-dts`, the same
pair `@objectstack/spec` has always shipped. Nothing is imported, executed or
resolved from them, no export moves and no runtime behaviour changes.

Why: a sibling checkout that links these packages by `link:` compiles against
their `dist/`, so a dist built from an older tree surfaces as a type error
naming an import nobody touched, with the symbol present in `src/` the whole
time. A HEAD-versus-pin comparison is silent through that; a content stamp
written by the build itself is not.
