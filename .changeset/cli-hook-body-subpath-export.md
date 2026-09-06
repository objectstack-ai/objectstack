---
'@objectstack/cli': minor
---

Ratify `./hook-body` as a public subpath export — `extractHookBody`, `HookBodyExtractionError`, `HookBodyRefusalKind` and `ExtractedBody` were reachable as a deep `dist/utils/extract-hook-body.js` import until #13123 sealed the surface, and an app's hook-body fidelity harness (hotcrm's `test/helpers/action-sandbox.ts`) consumes them to run the SAME body-only lowering `os build` ships through the real QuickJS runner, so a test executes what production executes rather than a lookalike. The #13123 body names exactly this remedy for an out-of-repo consumer — ratify the subpath as public surface rather than read `dist/` paths — and 17.3.0 applied it to `./console` for cloud's `objectos-runtime`; this applies it to the second consumer (#15325). `@objectstack/cli/hook-body` is a dedicated entry that re-exports those four names and nothing else; the deep `dist/` path stays sealed. Also admits `./package.json`, so the ordinary tooling idiom of reading a dependency's own manifest resolves again.

`minor`, not `patch`: a new subpath on a published package's `exports` map is a purely additive widening of its public surface — a new accepted key — which takes at least `minor` under the maintainer's 2026-09-04 rule (decision batch #35, on #15294) in the Check Changeset step's "WHICH LEVEL" prose; the commit type never lowers it.
