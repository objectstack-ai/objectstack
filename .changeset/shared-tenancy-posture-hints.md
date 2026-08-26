---
"@objectstack/cli": patch
---

refactor(cli): single-source the tenancy posture hint table `os serve` and `os doctor` both print (#12492)

`serve.ts` and `doctor.ts` each declared their own `TENANCY_POSTURE_FIX_HINTS`,
and the two tables were **byte-identical** — sha256 `97497ea8…` on both, modulo
the expression spelling the package name — under no cross-check of any kind.

The `isolated` entry at least carried a package literal the spec-owned
`PLATFORM_PLUGIN_WIRED_RUNTIMES` roster could be pinned against (#12464 / PR
#12496). **`single` and `group` were the worse half**: they touch no roster, so
nothing anywhere could ever have noticed them drift apart. A reword of one
command's copy left the other describing the same posture differently to the
same operator, with every gate green.

Both tables now come from one CLI-internal module,
`packages/cli/src/utils/tenancy-posture-hints.ts`, which also holds the single
`ORGANIZATIONS_RUNTIME_PKG` declaration. `Serve.ORGANIZATIONS_RUNTIME_PKG`
becomes a **re-export** of it rather than a second declaration, keeping the
stable handle `serve`'s boot path and the roster pin already address; the
module-local const #12464 added to `doctor.ts` is **deleted**, which is the
deletion condition that const's own docblock recorded against this card. The
literal is now declared twice (the roster key and this module) instead of three
times.

Each command keeps its **own bullet assembly** — doctor renders
`• OS_TENANCY_POSTURE=<p> — <hint>` inside a health-check fix list, serve renders
`• set OS_TENANCY_POSTURE=<p> — <hint>` inside a FATAL refusal, at different
indents. Only the table was ever duplicated.

The two sibling spelling pins are **retargeted, not dropped** — including the
roster leg, which is the load-bearing one (a rename of the package value leaves
the rendered leg green; only the roster leg catches it). Each gains one new leg
asserting that every posture bullet, `single` and `group` included, renders the
**shared** table's entry verbatim — so a command that re-grows a local copy goes
red instead of drifting in silence.

**No behaviour change.** The rendered text is byte-identical before and after
for all three postures at both commands, verified by capturing both commands'
full rendered fix lists on `origin/main` and on this branch and diffing them.
