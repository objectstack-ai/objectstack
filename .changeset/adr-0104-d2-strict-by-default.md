---
"@objectstack/runtime": major
---

feat(runtime)!: action params are enforced by default, and the opt-in is gone (#3438, ADR-0104 D2)

A request bag that violates an action's declared `params[]` — a missing
`required` param, a value outside its `options`, a scalar where `multiple`
declares an array, a non-id where a `reference` declares one, or a key the
action never declared — is now **rejected before the handler runs**:
`400 VALIDATION_FAILED` on REST, a thrown error on MCP. It used to be logged
and passed through.

```diff
- OS_ACTION_PARAMS_STRICT_ENABLED=1   # removed — enforcement is the default
+ OS_ALLOW_LAX_ACTION_PARAMS=1        # escape hatch: warn and pass, as before
```

**What breaks.** Only calls that were *already* wrong. The declaration was a
complete contract that informed nothing but the client dialog, so a bag the
server accepted could still have been silently ignored by the handler — which
is exactly how a correctly-intended `reference: 'sys_user'` degraded into a
paste-a-UUID box (#3405) with a success envelope on top. Those calls now fail
loudly instead of quietly. Actions declaring no `params` are untouched, and the
dispatcher's own `recordId` / `objectName` are allowlisted
(`ACTION_PARAM_BUILTIN_KEYS`), so the keys dispatch itself merges in were never
candidates for the unknown-key error.

**Fixing a rejection** takes one edit at the call site: the message names the
offending param and the declared list. If an integration you cannot reach in
time is affected, set `OS_ALLOW_LAX_ACTION_PARAMS=1` to restore the old
pass-through — the violation still logs once per action, so the drift stays
visible rather than becoming invisible again.

**Why 17.0 rather than a warn window in 17 and the flip in 18.** R3 asked for
warn-then-error, and ADR-0104's 2026-07-30 addendum declined it on the merits
rather than postponing. What a violation strands is a **caller**, not data: the
rejection reaches a developer or an agent who can fix it in one edit, no stored
row is made unwritable, and the escape hatch makes it reversible in a restart.
Deferring that by a major would have charged every deployment a second upgrade
ceremony — 16→17 is already a substantial, tested migration — to postpone a
break that costs one edited call. v17 already carries harsher zero-window
flips (`allowExport` unset now means denied; an undeclared action handler 404s
with no opt-out at all), so holding the milder change to a stricter standard
would have been inconsistent rather than cautious.

For AI and MCP callers specifically — the population D2 was built for — a 400
is corrective feedback consumed in-loop, while a server-side warning is
feedback nobody ever reads.

D1's value-shape half went the opposite way for the opposite reason: it rejects
on the basis of **stored data**, which an author cannot edit their way out of,
so it stays gated per deployment on that deployment's own migration evidence.
