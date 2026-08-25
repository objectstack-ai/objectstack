---
'@objectstack/cli': patch
---

refactor(cli): `serve` resolves `@objectstack/organizations` through one declaration the spec roster pins (#11614)

`PLATFORM_PLUGIN_WIRED_RUNTIMES` (`packages/spec`) is the provenance roster for
`plugins[]`-wired out-of-repo runtimes, keyed by npm package name — the single
machine-readable answer to "is this `@objectstack/*` package real, and where
does it ship from?". It exists because a **fabricated** `@objectstack/framework`
sat next to the real `@objectstack/organizations` in published docs for months,
indistinguishable by inspection (#10921).

`serve` is the only runtime that prints one of those names AT OPERATORS — the
install remedy, the fatal refusal when a walled tenancy posture cannot load the
multi-org runtime, and the degraded-boot warning. It spelled the package as a
bare literal at the resolution site, under no pin at all, so the roster and the
name `serve` actually resolves could diverge in silence: rename the roster key,
or mistype the literal, and every gate stays green while boot reaches for a
package that does not exist and the fatal message tells the operator to install
it.

The name is now declared once, as `Serve.ORGANIZATIONS_RUNTIME_PKG`, and both
resolution-path uses read it — `importFromHost(…)` and the `readHostDeclaration(…)`
that decides which of the two absence remedies to print. A drift pin in
`serve-capability-vocabulary.test.ts` (the suite that already holds the two
rosters to each other) asserts that value is a roster **key** and that its row is
the `enterprise` edition.

**Load semantics are untouched.** Which postures load the runtime, the two-stage
import/mount failure classification, and what `OS_ALLOW_DEGRADED_TENANCY` does
and does not cover are all exactly as they were; the roster is deliberately not a
resolution registry and is not consulted at boot. This single-sources the
spelling and nothing else, so there is no behaviour or output change — the
declared value is byte-identical to the literal it replaces.
