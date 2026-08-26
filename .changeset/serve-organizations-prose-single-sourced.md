---
"@objectstack/cli": patch
---

chore(cli): spell the multi-org runtime from its one declaration in `serve`'s operator-facing prose (#12151)

`serve` prints `@objectstack/organizations` at operators in five places: the
two-branch install remedy, the ADR-0093 D5 fatal refusal when a walled tenancy
posture cannot load the runtime, the degraded-boot warning, the stage-2 mount
refusal, and the `isolated` posture description in the tenancy-posture fix list.
#11614 single-sourced the name `serve` RESOLVES onto
`Serve.ORGANIZATIONS_RUNTIME_PKG` and pinned that declaration against the
spec-owned `PLATFORM_PLUGIN_WIRED_RUNTIMES` roster, but the sentences kept their
own copies — so a roster-key rename would leave operator instructions naming a
package that no longer exists while boot reached for the new one, with every gate
green (the roster pin only sees the declaration).

All five now interpolate the constant, and a new test asserts what they RENDER
rather than that the constant appears in the source — the affected line compared
whitespace-included against text built from the same declaration. The message
bodies moved into pure formatters (`formatOrganizationsInstallRemedy`,
`formatOrganizationsAbsentFatal`, `formatDegradedTenancyWarning`,
`formatOrganizationsMountFatal`), the seam shape `resolveTenancyPostureOrRefusal`
in the same file already uses, so the rendering is reachable without spawning a
boot; `chalk` and the `process.exit` stay at the call site.

**No behaviour change.** The declared value is byte-identical to the literal it
replaces, and the rendered output was verified byte-for-byte against the
pre-change expressions across every branch (both remedy kinds, both walled
postures, `mountCode` present and absent). The three comments in `serve.ts` that
legitimately name the package are untouched — the tempting "no bare literal
outside the declaration" source scan is deliberately not built, since it would
have to exclude comments and that shape is easy to get wrong.
