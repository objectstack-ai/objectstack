---
"@objectstack/cli": patch
---

chore(cli): spell the multi-org runtime from ONE declaration, with the static keeping its name (#12579)

`Serve.ORGANIZATIONS_RUNTIME_PKG` carried a second copy of
`@objectstack/organizations`, beside the declaration in
`utils/tenancy-posture-hints.ts` that `os doctor` reads. That duplication was
deliberate: the host-anchoring sweep in `serve-cluster-host-resolution.test.ts`
resolved serve's organizations `import()` through that static and needed a
LITERAL in that file — written as a re-export, the specifier stopped resolving
and the load dropped OUT of the swept population instead of failing inside it
(#11614's silent-vacuity mode, which #12492 hit and measured). That constraint
died at `1ca763b60` (#12533), which taught the sweep to follow an import alias
into a sibling module of the same package.

The static is now assigned from the shared const. It keeps its NAME — the roster
pin (`test/serve-capability-vocabulary.test.ts`), the sweep and the
rendered-message pins all address `Serve.ORGANIZATIONS_RUNTIME_PKG`, and only the
spelling moved — and the equality assertion that kept the duplication CHECKED
(site 8 of `serve-organizations-message-spelling.test.ts`) retires with its
subject, in the same change. The gap is still never closed in the other
direction: `os doctor` must not depend on a `serve` export to spell a package
name (#12464's coupling ruling, untouched).

**No behaviour change, measured rather than argued.** Every operator-facing
string that names the runtime — both install-remedy branches, the ADR-0093 D5
fatal refusal, the degraded-boot warning, the stage-2 mount refusal and the
tenancy-posture fix list — was rendered before and after the change and compared:
byte-identical, 5257 bytes, sha256 `d545248b91e52d05…`.
