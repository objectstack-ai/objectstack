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

## What a pipeline gating on the payload has to read

`--strict` gates on the text face's warning list, and that list is **not** the payload's
`warnings` field. The two differ by the ADR-0087 load-time conversion notices: the text
face folds them into its warning block, while the payload carries them separately under
`conversions`. So a pipeline that wants to reproduce `--strict` from the document must
read **both**:

```
warnings.length > 0 || conversions.length > 0
```

Gating on `warnings` alone is strictly weaker than `--strict` — a config whose only
advisories are conversion notices passes that check and fails `--strict`. That is the
same silent under-reporting this change exists to remove, so do not reach for the
narrower spelling.

The consequence is reachable and worth stating outright, because it is surprising: a
conversions-only config now exits **1** with `"warnings": []` and a populated
`conversions`. Predicting the exit code from `warnings.length` alone will be wrong for
exactly that config. Nothing is missing from the document — both advisory streams are in
it — but they sit in two fields and the exit code answers to both.

If a pipeline genuinely wants the old exit status, the honest fix is to say so rather
than to keep passing a flag that means the opposite: drop `--strict` and read the
payload. If it goes red instead, the advisories were always there — the text face had
been printing them all along.

<!-- adr-0087: not-required (no-migration-prescription) An exit-code parity fix on a CLI flag. No authorable key, export, config field or stored `sys_metadata` shape changes, so there is nothing for `objectstack migrate meta` or the upgrade guide to carry — the remedy is a pipeline-side choice of flag, not a rewrite of anything an author wrote. -->
