---
'@objectstack/spec': patch
---

fix(spec): the dist-freshness refusal derives its package label and build remedy from `pkgDir` (#11250)

`inspectDistFreshness()` / `inspectBundleFreshness()` in `packages/spec/scripts/lib/dist-freshness.ts`
already take an arbitrary `pkgDir`, but their refusal `cause` strings and the `pnpm --filter <pkg> build`
remedy line hardcoded `packages/spec` / `@objectstack/spec` regardless of it. Every real caller passed
`SPEC_DIR` until #10969 gave `check:skill-examples` a second surface (`packages/client-react` /
`packages/client`) — confirmed live: a stale-dist refusal on that surface named `packages/spec` while
`packages/spec` was freshly built and `client`/`client-react` were the actually-unbuilt packages, so
following the printed remedy verbatim rebuilt an already-fresh package and re-red identically.

Both cause strings now interpolate a `packages/<name>` label derived from `pkgDir`'s own path (falling
back to the raw path when the shape doesn't match), and the build-remedy line now reads
`package.json#name` from `pkgDir` (falling back to the same label when it's missing or unparsable). The
freshness verdict itself, and every caller's own `rerun` argument, are unchanged — this is diagnostic
text only.
