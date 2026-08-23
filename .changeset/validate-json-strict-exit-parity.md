---
"@objectstack/cli": minor
---

fix(cli): `os validate --json --strict` exits 1 on the configs `--strict` already exits 1 for (#11174)

`commands/validate.ts` emitted the `--json` payload and `return`ed *above* the only
`flags.strict` reader, which sat inside the text-rendering block. So on one config,
one flag, two answers:

```
os validate --strict          → exit 1   ("Strict mode: warnings treated as errors")
os validate --json --strict   → exit 0
```

`--strict` was accepted, documented — `content/docs/deployment/cli.mdx` spells
`os validate --json --strict` twice in its CI/CD section, once as a GitHub Actions
step — and inert whenever `--json` was also passed. That combination is the one
audience the flag exists for: a pipeline gating on the exit status of the documented
invocation read 0 and concluded the stack was clean.

The `--strict` gate now reads the text face's own warning list, which is assembled
once and consumed by both faces, so the two exit codes cannot drift apart again. The
gate deliberately does **not** read the payload's `warnings` field: the two differ by
the ADR-0087 load-time conversion notices, which the text face folds into its warning
block while the payload carries them under `conversions`. Gating on the field would
have left the same divergence in place for a config whose only advisories are
conversion notices. `specVersionGap` stays outside `--strict` on both faces, as it
always has been on the text one.

`valid: true` beside a non-zero exit is the text face verbatim, not a contradiction:
that path prints "Validation passed" and *then* fails for strict. The stack is
schema-valid; `--strict` is what promotes its advisories to a failure.

**BREAKING** for one caller shape, and the reason this is not a patch: a pipeline
running `os validate --json --strict` over a stack that raises non-blocking
advisories was green and will now be red. Nothing was removed or renamed and no
authored metadata changes — the accept set is identical and the exit status is the
only thing that moves — but a release a CI system can take unattended must not flip
a green build to red, so this does not belong in a patch. It is not a major either:
the new behaviour *restores* what `--strict` declares ("Treat warnings as errors")
and what the docs already advertise, rather than contradicting a contract. Under
this repo's launch-window convention (breaking changes ship as `minor` while the
stack versions in lockstep) `minor` is the honest slot.

If a pipeline wants the old exit status, the fix is to say so rather than to pass a
flag that means the opposite: drop `--strict` and gate on the payload's `warnings`
array, which has carried the full advisory set since #10953. If it goes red instead,
the advisories were always there — the text face had been printing them all along.

<!-- adr-0087: not-required (no-migration-prescription) An exit-code parity fix on a CLI flag. No authorable key, export, config field or stored `sys_metadata` shape changes, so there is nothing for `objectstack migrate meta` or the upgrade guide to carry — the remedy is a pipeline-side choice of flag, not a rewrite of anything an author wrote. -->
