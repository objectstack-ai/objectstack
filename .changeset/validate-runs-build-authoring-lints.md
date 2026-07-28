---
"@objectstack/cli": patch
---

fix(cli): `os validate` runs the four authoring lints `os build` runs — "validate clean, build fails" is gone (#3782)

`os validate` is documented, and used in CI, as the **read-only superset** of the
gates `os build` runs: same checks, no artifact. It wasn't. Four authoring lints
were wired into `compile.ts` only, and **two of them already fail the build**:

| Lint | Emits `error` | `os build` | `os validate` (before) |
|---|---|---|---|
| `lintAutonumberFormats` | yes | ✓ | — |
| `lintViewRefs` (#2554) | yes | ✓ | — |
| `lintFlowPatterns` (#1874) | not yet | ✓ | — |
| `lintLivenessProperties` | no | ✓ | — |

So an autonumber format naming a field that doesn't exist, or a form action
target naming a LIST view, passed `os validate` cleanly and then failed
`os build`. Reproduced verbatim on `main` against `examples/app-todo`:
`os validate` → "✓ Validation passed"; `os build` → "✗ Autonumber format
validation failed". Worst for the CI setups that gate on `validate` and only
discover the break at deploy time.

The drift was invisible for a structural reason worth naming: every *other* gate
on both commands is a shared `@objectstack/lint` import, while these four are
CLI-local `../utils/lint-*` modules that only `compile.ts` ever imported. Nothing
made adding a gate to the build also add it to validate.

**The fix is two parts.** `validate.ts` now runs all four, mirroring
`compile.ts`'s per-lint severity handling (`error` → exit 1, everything else →
advisory, and into the `warnings` array under `--json`). And a new source-level
test asserts that every `lintFoo(`/`validateFoo(` call site in `compile.ts` also
appears in `validate.ts`, failing with the list of missing gates. That test is
the actual fix for the class of bug — the wiring is just today's instance.

**What you may newly see.** `os validate` now surfaces every rule these lints
carry, including the advisory ones, so existing projects can see new warnings.
Only `autonumber-*` and view-reference `error` findings change the exit code —
and any project they now fail was already failing `os build`.

`FlowLintFinding` also gains an optional `severity`, honoured by both surfaces.
No rule sets it today, so flow findings stay advisory; it is the seam that lets
#3760's blocking `flow-runas-unscoped` gate `os validate` and `os build`
together the moment it lands, with no further wiring.
