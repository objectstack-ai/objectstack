---
"@objectstack/service-automation": minor
"@objectstack/lint": minor
---

feat(service-automation): an `assignment` value may be a CEL envelope — evaluated at run time, validated at `registerFlow`, `objectstack validate` and the runtime publish gate (#15137, the executor half of #14149)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is renamed, retired or re-typed: the `assignments` map and every value form it accepted still parse. The only newly refused shape is a malformed CEL value envelope, a spelling declared one day earlier in #15113 and offered by no authoring surface before it, so `objectstack migrate meta` has nothing to rewrite and this changeset carries no rewrite instructions for a consumer to follow. -->

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
- **Refused at three doors.** A malformed envelope now stops the flow registering
  (`registerFlow` throws, the severity a malformed predicate gets) and surfaces as
  a located `error` finding naming the node and the author's own variable —
  `config.assignments.digest` — both at `objectstack validate` and at the runtime
  publish gate a Studio / REST / MCP flow write goes through
  (`validateStackExpressions` is registered `CLI_AND_RUNTIME`, `runtimeTypes:
  ['flow']`). Malformed is a composition, not a fixed list: whatever
  `AssignmentValueSchema` refuses in the envelope's shape — among them a missing,
  empty or non-string `source`, a dialect other than `cel`, a non-object `meta` —
  and then CEL that does not parse. All three doors derive that set from the same
  two published validators, so none refuses a shape the executor would have run,
  and a registered flow never faults for a shape those validators judge malformed.
  Two shapes sit outside what either validator can judge — an `ast`-only envelope
  and a whitespace-only `source` (it passes `min(1)` and reads as "not authored"
  to the validator, while the CEL engine parses it untrimmed) — and those fault
  loudly at run time rather than assigning a value. Both are pinned and tracked in
  #15430.
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
the spelling the ruling reinterprets; every near-miss the two validators can
judge now refuses loudly at registration instead of changing value in silence.
