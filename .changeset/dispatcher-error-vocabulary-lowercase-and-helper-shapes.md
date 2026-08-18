---
"@objectstack/runtime": patch
---

fix(tooling): `check:dispatcher-error-vocabulary` reports lowercase codes and the two stamp positions it could not see — a live 403 had been invisible to both vocabulary gates (#9460)

The gate's published bound said it scanned "only SCREAMING_SNAKE literals", and
handed lowercase to `check:error-code-casing`. Half of that delegation was real
and half was a hole, and the hole is where `plugin-security`'s live 403
`owd_widening_forbidden` sat through two ADR-0112 sweeps: both gates read the
file, both reported nothing, each leaving it to the other.

**The card's premise was that the scan's patterns are case-sensitive. They are
not** — the literal shapes already matched `[A-Za-z]`. Two explicit filters
dropped the value after the match, and the producer was invisible for a
different reason entirely, so the prescribed one-line widening would not have
found it. Measured before changing anything: reporting every lowercase stamp
took the scan from 12 sites to 94, and **all 82 new findings were D6/D6b/D6c
neighbours or Zod's own issue codes** — it would have called
`ctx.addIssue({ code: 'custom' })` an unregistered ObjectStack error code.

So lowercase is now reported **except** in the two positions where
`check:error-code-casing` reads the identical characters (`code: 'x'`,
`.code = 'x'`). There the delegation is genuine: that gate carries the
D6/D6b/D6c discrimination this one does not have. Everywhere else — a constant,
a template, a helper parameter — there is no quoted literal at the stamp site
for a `code`-anchored pattern to match, that gate is structurally blind, and
dropping the value reported it to nobody. What is measured is now "outside the
vocabulary **and** unowned by the gate we delegate lowercase to", never "is it
SCREAMING_SNAKE".

Three stamp positions the scan could not see, all of them widenings:

- **`codehelper`** — a file declares one factory and throws through it
  everywhere (`postureError(code, message)`, `makeError(status, code, message)`,
  a `constructor(code, message)`). The stamp `(err as any).code = code` knows
  the token `code` but not the value; the call site knows the value and never
  writes the token. Every pattern in **both** gates anchors on that token. The
  join is the parameter, so its **index** names the argument to read — derived,
  never assumed to be zero, because two live helpers put `code` second and a
  first-argument rule reads a number and an English sentence as error codes.
- **`assignconst`** — `err.code = DENY_CODE`, the assign position's constant
  sibling. #9223 closed exactly this gap for object literals; the assign
  position kept it.
- **`assign`** with a cast on the left. The old anchor demanded a bare
  identifier where `(err as any).code = 'X'` puts a `)`.

The scan goes from 12 classified sites to 18, and from 0 to 2 codes awaiting a
ledger entry — the ratchet moving in the direction it exists to move.
`FLOW_CONVERSION_CONFLICT` (a live 409 from the metadata write path) and
`owd_widening_forbidden` are recorded as `pending-registration`; four
`MigrationJournalRefusal` codes are `boot-refusal` (their only consumers are two
CLI commands, no HTTP boundary). ⛔ No allowlist entry, no narrowed pattern, no
raised ceiling: **registering or renaming a code stays the `packages/spec`
lane's call**, and these rows record the measurement rather than prescribing the
remedy.
