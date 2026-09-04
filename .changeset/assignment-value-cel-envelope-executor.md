---
"@objectstack/service-automation": minor
"@objectstack/lint": minor
---

feat(service-automation): an `assignment` value may be a CEL envelope — evaluated at run time, validated at `registerFlow` and `objectstack validate` (#15137, the executor half of #14149)

**BREAKING** in the accept-set sense, landing in the launch window as `minor`
(the lockstep convention; the level also follows the 2026-09-04 bump ruling —
this adds `AutomationEngine.evaluateValueEnvelope` to a published surface, and an
additive widening is at least `minor`). No ADR-0087 conversion: no authorable key
is renamed or retired, and the shape this refuses was never a shape any surface
offered.

The maintainer's 2026-09-02 ruling on #14149 made an assignment value able to be
a CEL **value** expression, so the declared stdlib (`joinNonEmpty`, `map`, `size`
…) is finally reachable from metadata — until now CEL was only ever asked for a
boolean. The spec half landed the contract (PR #15113); this is the half that
makes it do something.

```yaml
# before: written into the variable verbatim, and rendered by `notify` as
#         {"dialect":"cel","source":"joinNonEmpty(...)"}
# now:    evaluated — digest is "Renewal due\nInvoice overdue"
assignments:
  digest: { dialect: cel, source: 'joinNonEmpty(rows.map(r, r.subject), "\n")' }
```

- **Evaluated at run time.** The built-in `assignment` executor evaluates a
  `value`-role envelope with the expression engine and assigns the result, in the
  same CEL scope a flow predicate is evaluated in (one shared scope builder, so a
  predicate and a value expression cannot disagree about what `rows` means). A
  plain string keeps today's `{token}` interpolation, and every other literal is
  still assigned as data.
- **Refused at registration and at build.** A malformed envelope now stops the
  flow registering (`registerFlow` throws, the severity a malformed predicate
  gets) and surfaces as a located `objectstack validate` finding naming the node
  and the author's own variable — `config.assignments.digest`. Malformed means:
  no `source`, an empty `source`, a dialect other than `cel`, or CEL that does not
  parse. Registration and evaluation derive that set from ONE call, so a flow that
  registers can never fault for being malformed, and none is refused for a shape
  the executor would have run.
- **Only the canonical map.** The ledger declares `assignment.assignments.*` and
  nothing else, so the two legacy shapes the executor still normalizes — the
  `assignments: [{ variable, value }]` array and the bare `{ <variable>: <value> }`
  config — keep every meaning they had, envelope-shaped values included.
  `AssignmentConfigSchema` is deliberately NOT wired into `parseNodeConfig` for the
  array form: refusing it would break flows that register today, and that refusal
  is a maintainer ruling rather than a lane's call (#15137 ask 3).

**What changes silently, and how far it reaches.** A flow that today authors an
envelope-shaped object *as data* in the canonical `assignments` map now evaluates
it — no error on either side, a different value. The discriminator is the spec's
own `isExpressionEnvelopeShaped`: a plain object naming a **string** `dialect`,
in the declared map only. Data that names no `dialect`, names a non-string one,
nests the envelope one level down, or sits in either legacy shape is untouched
and byte-identical. The remaining overlap — a well-formed
`{ dialect: 'cel', source: … }` written as data in the canonical map — is exactly
the spelling the ruling reinterprets; every malformed near-miss now refuses
loudly at registration instead of changing value in silence.
